// ============================================================
// ndtsdb Bun 原生测试 (bun:test)
// 用法: bun test
// ============================================================

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { existsSync, mkdirSync, rmdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

import { ColumnarTable } from '../src/columnar.js';
import { AppendWriter, crc32 } from '../src/append.js';
import { MmapPool, MmappedColumnarTable } from '../src/mmap/pool.js';
import { MmapMergeStream } from '../src/mmap/merge.js';
import { SQLParser } from '../src/sql/parser.js';
import { SQLExecutor } from '../src/sql/executor.js';
import { sampleBy, ohlcv, movingAverage, exponentialMovingAverage } from '../src/query.js';
import { RoaringBitmap } from '../src/index/bitmap.js';

const TEST_DIR = './data/bun-test';

// 清理函数
function cleanDir() {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
    return;
  }
  try {
    const files = readdirSync(TEST_DIR);
    for (const f of files) {
      unlinkSync(join(TEST_DIR, f));
    }
  } catch {}
}

beforeAll(() => cleanDir());
afterAll(() => cleanDir());

// ─── ColumnarTable ────────────────────────────────

describe('ColumnarTable', () => {
  it('should create empty table', () => {
    const table = new ColumnarTable([
      { name: 'ts', type: 'int64' },
      { name: 'price', type: 'float64' },
    ]);
    expect(table.getRowCount()).toBe(0);
  });

  it('should append single row', () => {
    const table = new ColumnarTable([
      { name: 'ts', type: 'int64' },
      { name: 'price', type: 'float64' },
    ]);
    table.append({ ts: BigInt(Date.now()), price: 100.5 });
    expect(table.getRowCount()).toBe(1);
  });

  it('should batch append 10000 rows', () => {
    const table = new ColumnarTable([
      { name: 'ts', type: 'int64' },
      { name: 'price', type: 'float64' },
    ]);
    
    const rows = [];
    for (let i = 0; i < 10000; i++) {
      rows.push({ ts: BigInt(1700000000000 + i), price: 100 + i * 0.01 });
    }
    table.appendBatch(rows);
    expect(table.getRowCount()).toBe(10000);
  });

  it('should auto-grow capacity', () => {
    const table = new ColumnarTable(
      [{ name: 'v', type: 'float64' }],
      100 // 初始容量 100
    );
    
    const rows = [];
    for (let i = 0; i < 1000; i++) {
      rows.push({ v: i });
    }
    table.appendBatch(rows);
    expect(table.getRowCount()).toBe(1000);
  });

  it('should save and load file', () => {
    const table = new ColumnarTable([
      { name: 'ts', type: 'int64' },
      { name: 'price', type: 'float64' },
    ]);
    
    table.appendBatch([
      { ts: 1700000000000n, price: 100.5 },
      { ts: 1700000001000n, price: 101.0 },
    ]);
    
    const path = `${TEST_DIR}/roundtrip.ndts`;
    table.saveToFile(path);
    
    const loaded = ColumnarTable.loadFromFile(path);
    expect(loaded.getRowCount()).toBe(2);
    
    const ts = loaded.getColumn('ts') as BigInt64Array;
    expect(ts[0]).toBe(1700000000000n);
  });

  it('should handle type auto-conversion', () => {
    const table = new ColumnarTable([
      { name: 'ts', type: 'int64' },
    ]);
    
    // number 自动转 bigint
    table.append({ ts: 1700000000000 });
    
    const col = table.getColumn('ts') as BigInt64Array;
    expect(col[0]).toBe(1700000000000n);
  });
});

// ─── AppendWriter ─────────────────────────────────

describe('AppendWriter', () => {
  it('should create new file', () => {
    const path = `${TEST_DIR}/append-new.ndts`;
    
    const writer = new AppendWriter(path, [
      { name: 'ts', type: 'int64' },
      { name: 'price', type: 'float64' },
    ]);
    writer.open();
    writer.append([{ ts: 1700000000000n, price: 100.0 }]);
    writer.close();
    
    const { header } = AppendWriter.readAll(path);
    expect(header.totalRows).toBe(1);
  });

  it('should append multiple chunks', () => {
    const path = `${TEST_DIR}/append-multi.ndts`;
    
    const writer = new AppendWriter(path, [{ name: 'v', type: 'int64' }]);
    writer.open();
    writer.append([{ v: 1n }]);
    writer.append([{ v: 2n }]);
    writer.append([{ v: 3n }]);
    writer.close();
    
    const { header } = AppendWriter.readAll(path);
    expect(header.totalRows).toBe(3);
    expect(header.chunkCount).toBe(3);
  });

  it('should reopen and append', () => {
    const path = `${TEST_DIR}/append-reopen.ndts`;
    
    const w1 = new AppendWriter(path, [{ name: 'v', type: 'int64' }]);
    w1.open();
    w1.append([{ v: 1n }]);
    w1.close();
    
    const w2 = new AppendWriter(path, [{ name: 'v', type: 'int64' }]);
    w2.open();
    w2.append([{ v: 2n }]);
    w2.close();
    
    const { header } = AppendWriter.readAll(path);
    expect(header.totalRows).toBe(2);
  });

  it('should verify CRC32', () => {
    const path = `${TEST_DIR}/crc.ndts`;
    
    const writer = new AppendWriter(path, [{ name: 'v', type: 'float64' }]);
    writer.open();
    writer.append([{ v: 1.0 }, { v: 2.0 }]);
    writer.close();
    
    const result = AppendWriter.verify(path);
    expect(result.ok).toBe(true);
  });
});

// ─── CRC32 ────────────────────────────────────────

describe('CRC32', () => {
  it('should calculate correct CRC32', () => {
    const data = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    const checksum = crc32(data);
    expect(checksum).toBe(0xf7d18982);
  });
});

// ─── MmapPool ─────────────────────────────────────

describe('MmapPool', () => {
  it('should map multiple files', () => {
    // 创建测试文件
    for (let i = 0; i < 3; i++) {
      const table = new ColumnarTable([
        { name: 'ts', type: 'int64' },
        { name: 'v', type: 'float64' },
      ]);
      table.appendBatch([{ ts: 1700000000000n, v: i * 1.0 }]);
      table.saveToFile(`${TEST_DIR}/pool${i}.ndts`);
    }
    
    const pool = new MmapPool();
    pool.init(['pool0', 'pool1', 'pool2'], TEST_DIR);
    
    expect(pool.getSymbols().length).toBe(3);
    
    const v0 = pool.getColumn<Float64Array>('pool0', 'v');
    expect(v0[0]).toBe(0.0);
    
    pool.close();
  });

  it('should support zero-copy reads', () => {
    const pool = new MmapPool();
    pool.init(['pool0'], TEST_DIR);
    
    const col1 = pool.getColumn<Float64Array>('pool0', 'v');
    const col2 = pool.getColumn<Float64Array>('pool0', 'v');
    
    // zero-copy: 同一个底层 buffer
    expect(col1.buffer).toBe(col2.buffer);
    
    pool.close();
  });
});

// ─── SQL ──────────────────────────────────────────

describe('SQL', () => {
  it('should parse SELECT', () => {
    const parser = new SQLParser();
    const result = parser.parse('SELECT * FROM trades');
    expect(result.type).toBe('SELECT');
  });

  it('should parse WHERE clause', () => {
    const parser = new SQLParser();
    const result = parser.parse('SELECT * FROM trades WHERE price > 100');
    expect(result.type).toBe('SELECT');
    expect(result.data.where).toBeDefined();
  });

  it('should execute SELECT', () => {
    const table = new ColumnarTable([
      { name: 'id', type: 'int32' },
      { name: 'price', type: 'float64' },
    ]);
    table.appendBatch([
      { id: 1, price: 100.0 },
      { id: 2, price: 200.0 },
    ]);
    
    const executor = new SQLExecutor();
    executor.registerTable('test', table);
    
    const result = executor.execute(new SQLParser().parse('SELECT * FROM test'));
    expect(result.rowCount).toBe(2);
  });

  it('should execute WHERE filter', () => {
    const table = new ColumnarTable([
      { name: 'price', type: 'float64' },
    ]);
    table.appendBatch([
      { price: 50.0 },
      { price: 150.0 },
      { price: 250.0 },
    ]);
    
    const executor = new SQLExecutor();
    executor.registerTable('test', table);
    
    const result = executor.execute(
      new SQLParser().parse('SELECT * FROM test WHERE price > 100')
    );
    expect(result.rowCount).toBe(2);
  });
});

// ─── Query Functions ──────────────────────────────

describe('Query Functions', () => {
  it('should SAMPLE BY aggregate', () => {
    const timestamps = new BigInt64Array([0n, 500n, 1000n, 1500n, 2000n]);
    const values = new Float64Array([1, 2, 3, 4, 5]);
    
    const result = sampleBy(timestamps, [
      { name: 'v', data: values, aggs: ['first', 'last', 'sum'] }
    ], 1000);
    
    expect(result.length).toBe(3);
    expect(result[0].values.v_sum).toBe(3); // 1+2
  });

  it('should generate OHLCV bars', () => {
    const timestamps = new BigInt64Array(100);
    const prices = new Float64Array(100);
    const volumes = new Int32Array(100);
    
    for (let i = 0; i < 100; i++) {
      timestamps[i] = BigInt(i * 100);
      prices[i] = 100 + Math.sin(i / 10) * 10;
      volumes[i] = i;
    }
    
    const bars = ohlcv(timestamps, prices, volumes, 1000);
    expect(bars.length).toBe(10);
    expect(bars[0].high).toBeGreaterThanOrEqual(bars[0].low);
  });

  it('should calculate SMA', () => {
    const data = new Float64Array([1, 2, 3, 4, 5]);
    const sma = movingAverage(data, 3);
    
    // SMA(3) of [1,2,3,4,5] = [1, 1.5, 2, 3, 4]
    expect(sma[2]).toBeCloseTo(2.0, 3);
    expect(sma[4]).toBeCloseTo(4.0, 3);
  });

  it('should calculate EMA', () => {
    const data = new Float64Array([10, 10, 10, 10, 10]);
    const ema = exponentialMovingAverage(data, 10);
    
    for (let i = 0; i < ema.length; i++) {
      expect(ema[i]).toBeCloseTo(10.0, 3);
    }
  });
});

// ─── Index ────────────────────────────────────────

describe('Index', () => {
  it('should add and check RoaringBitmap', () => {
    const bitmap = new RoaringBitmap();
    bitmap.add(1);
    bitmap.add(100);
    bitmap.add(1000);
    
    expect(bitmap.contains(100)).toBe(true);
    expect(bitmap.contains(999)).toBe(false);
  });
});
