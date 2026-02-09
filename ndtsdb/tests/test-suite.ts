// ============================================================
// ndtsdb 统一测试套件
// 运行所有测试并生成报告
// ============================================================

import { existsSync, mkdirSync, rmdirSync, unlinkSync, readdirSync } from 'fs';
import { join } from 'path';

const TEST_DIR = './data/test-suite';
const RESULTS: { name: string; status: 'PASS' | 'FAIL' | 'SKIP'; time: number; error?: string }[] = [];

// 清理测试目录
function cleanTestDir() {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
    return;
  }
  // 只清理 .ndts 文件
  try {
    const files = readdirSync(TEST_DIR);
    for (const f of files) {
      if (f.endsWith('.ndts')) {
        unlinkSync(join(TEST_DIR, f));
      }
    }
  } catch {}
}

// 测试运行器
async function runTest(name: string, fn: () => Promise<void> | void): Promise<void> {
  const start = performance.now();
  try {
    await fn();
    RESULTS.push({ name, status: 'PASS', time: performance.now() - start });
    console.log(`  ✅ ${name} (${(performance.now() - start).toFixed(1)}ms)`);
  } catch (e: any) {
    RESULTS.push({ name, status: 'FAIL', time: performance.now() - start, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ==================== 测试开始 ====================

console.log('🧪 ndtsdb 统一测试套件\n');
console.log('=' .repeat(70));

cleanTestDir();

// ─── 模块 1: ColumnarTable 核心 ───────────────────

console.log('\n📦 Module 1: ColumnarTable 核心\n');

await runTest('创建空表', () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable([
    { name: 'ts', type: 'int64' },
    { name: 'price', type: 'float64' },
  ]);
  if (table.getRowCount() !== 0) throw new Error('Expected 0 rows');
});

await runTest('单行插入', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable([
    { name: 'ts', type: 'int64' },
    { name: 'price', type: 'float64' },
  ]);
  table.append({ ts: BigInt(Date.now()), price: 100.5 });
  if (table.getRowCount() !== 1) throw new Error('Expected 1 row');
});

await runTest('批量插入 10万行', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable([
    { name: 'ts', type: 'int64' },
    { name: 'price', type: 'float64' },
  ]);
  const rows = [];
  for (let i = 0; i < 100000; i++) {
    rows.push({ ts: BigInt(1700000000000 + i), price: 100 + i * 0.01 });
  }
  table.appendBatch(rows);
  if (table.getRowCount() !== 100000) throw new Error('Expected 100000 rows');
});

await runTest('存取 round-trip', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
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
  
  if (loaded.getRowCount() !== 2) throw new Error('Row count mismatch');
  const ts = loaded.getColumn('ts') as BigInt64Array;
  if (ts[0] !== 1700000000000n) throw new Error('Data mismatch');
});

await runTest('超大表自动扩容', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable(
    [{ name: 'v', type: 'float64' }],
    100 // 初始容量只有 100
  );
  
  // 插入 1000 行，触发多次扩容
  const rows = [];
  for (let i = 0; i < 1000; i++) {
    rows.push({ v: i });
  }
  table.appendBatch(rows);
  
  if (table.getRowCount() !== 1000) throw new Error('Row count after growth failed');
});

// ─── 模块 2: AppendWriter ─────────────────────────

console.log('\n📦 Module 2: AppendWriter 增量写入\n');

await runTest('创建新文件并追加', async () => {
  const { AppendWriter } = await import('../src/append.js');
  const path = `${TEST_DIR}/append.ndts`;
  
  const writer = new AppendWriter(path, [
    { name: 'ts', type: 'int64' },
    { name: 'price', type: 'float64' },
  ]);
  writer.open();
  writer.append([{ ts: 1700000000000n, price: 100.0 }]);
  writer.append([{ ts: 1700000001000n, price: 101.0 }]);
  writer.close();
  
  const { header } = AppendWriter.readAll(path);
  if (header.totalRows !== 2) throw new Error('Expected 2 rows');
  if (header.chunkCount !== 2) throw new Error('Expected 2 chunks');
});

await runTest('重新打开追加', async () => {
  const { AppendWriter } = await import('../src/append.js');
  const path = `${TEST_DIR}/append-reopen.ndts`;
  
  // 第一次写入
  const w1 = new AppendWriter(path, [{ name: 'v', type: 'int64' }]);
  w1.open();
  w1.append([{ v: 1n }]);
  w1.close();
  
  // 重新打开追加
  const w2 = new AppendWriter(path, [{ name: 'v', type: 'int64' }]);
  w2.open();
  w2.append([{ v: 2n }]);
  w2.close();
  
  const { header } = AppendWriter.readAll(path);
  if (header.totalRows !== 2) throw new Error('Expected 2 rows total');
});

await runTest('CRC32 校验通过', async () => {
  const { AppendWriter } = await import('../src/append.js');
  const path = `${TEST_DIR}/crc-valid.ndts`;
  
  const writer = new AppendWriter(path, [{ name: 'v', type: 'float64' }]);
  writer.open();
  writer.append([{ v: 1.0 }, { v: 2.0 }]);
  writer.close();
  
  const result = AppendWriter.verify(path);
  if (!result.ok) throw new Error(`CRC check failed: ${result.errors.join(', ')}`);
});

// ─── 模块 3: MmapPool ─────────────────────────────

console.log('\n📦 Module 3: MmapPool 内存映射\n');

await runTest('多文件映射', async () => {
  const { MmapPool } = await import('../src/mmap/pool.js');
  const { ColumnarTable } = await import('../src/columnar.js');
  
  // 创建 5 个测试文件
  for (let i = 0; i < 5; i++) {
    const table = new ColumnarTable([
      { name: 'ts', type: 'int64' },
      { name: 'v', type: 'float64' },
    ]);
    table.appendBatch([{ ts: 1700000000000n, v: i * 1.0 }]);
    table.saveToFile(`${TEST_DIR}/pool${i}.ndts`);
  }
  
  const pool = new MmapPool();
  pool.init(['pool0', 'pool1', 'pool2', 'pool3', 'pool4'], TEST_DIR);
  
  if (pool.getSymbols().length !== 5) throw new Error('Expected 5 symbols');
  
  const v0 = pool.getColumn<Float64Array>('pool0', 'v');
  if (v0[0] !== 0.0) throw new Error('Data mismatch');
  
  pool.close();
});

await runTest('zero-copy 读取验证', async () => {
  const { MmapPool } = await import('../src/mmap/pool.js');
  
  const pool = new MmapPool();
  pool.init(['pool0'], TEST_DIR);
  
  const col1 = pool.getColumn<Float64Array>('pool0', 'v');
  const col2 = pool.getColumn<Float64Array>('pool0', 'v');
  
  // zero-copy: 应该是同一个底层 buffer
  if (col1.buffer !== col2.buffer) {
    throw new Error('Not zero-copy: different buffers');
  }
  
  pool.close();
});

// ─── 模块 4: MmapMergeStream ──────────────────────

console.log('\n📦 Module 4: MmapMergeStream 多路归并\n');

await runTest('MinHeap 归并排序正确', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const { MmapPool } = await import('../src/mmap/pool.js');
  const { MmapMergeStream } = await import('../src/mmap/merge.js');
  
  // 创建 3 个有时间交错的产品
  const symbols = ['A', 'B', 'C'];
  for (let s = 0; s < 3; s++) {
    const table = new ColumnarTable([
      { name: 'timestamp', type: 'int64' },
      { name: 'price', type: 'float64' },
    ]);
    const rows = [];
    for (let i = 0; i < 100; i++) {
      // 故意交错: A 在 0,3,6... B 在 1,4,7... C 在 2,5,8...
      rows.push({
        timestamp: BigInt(s + i * 3),
        price: s * 100 + i,
      });
    }
    table.appendBatch(rows);
    table.saveToFile(`${TEST_DIR}/merge_${symbols[s]}.ndts`);
  }
  
  const pool = new MmapPool();
  pool.init(symbols.map(s => `merge_${s}`), TEST_DIR);
  
  const stream = new MmapMergeStream(pool);
  stream.init({ symbols: symbols.map(s => `merge_${s}`) });
  
  let prevTs = -1n;
  let isSorted = true;
  for (const tick of stream.replayTicks()) {
    if (tick.timestamp < prevTs) {
      isSorted = false;
      break;
    }
    prevTs = tick.timestamp;
  }
  
  pool.close();
  if (!isSorted) throw new Error('Output not sorted');
});

await runTest('ASOF JOIN 查询', async () => {
  const { MmapPool } = await import('../src/mmap/pool.js');
  const { MmapMergeStream } = await import('../src/mmap/merge.js');
  
  const pool = new MmapPool();
  pool.init(['merge_A', 'merge_B', 'merge_C'], TEST_DIR);
  
  const stream = new MmapMergeStream(pool);
  stream.init({ symbols: ['merge_A', 'merge_B', 'merge_C'] });
  
  const snapshot = stream.asofSnapshot(50n); // 查询第 50 个时间单位
  
  if (snapshot.size !== 3) throw new Error(`Expected 3 symbols, got ${snapshot.size}`);
  
  pool.close();
});

// ─── 模块 5: SQL ──────────────────────────────────

console.log('\n📦 Module 5: SQL 引擎\n');

await runTest('SELECT *', async () => {
  const { SQLParser } = await import('../src/sql/parser.js');
  const { SQLExecutor } = await import('../src/sql/executor.js');
  const { ColumnarTable } = await import('../src/columnar.js');
  
  const table = new ColumnarTable([
    { name: 'id', type: 'int32' },
    { name: 'price', type: 'float64' },
  ]);
  table.appendBatch([{ id: 1, price: 100.0 }, { id: 2, price: 200.0 }]);
  
  const executor = new SQLExecutor();
  executor.registerTable('test', table);
  
  const parser = new SQLParser();
  const result = executor.execute(parser.parse('SELECT * FROM test'));
  
  if (result.rowCount !== 2) throw new Error('Expected 2 rows');
});

await runTest('WHERE 过滤', async () => {
  const { SQLParser } = await import('../src/sql/parser.js');
  const { SQLExecutor } = await import('../src/sql/executor.js');
  const { ColumnarTable } = await import('../src/columnar.js');
  
  const table = new ColumnarTable([
    { name: 'price', type: 'float64' },
  ]);
  table.appendBatch([{ price: 50.0 }, { price: 150.0 }, { price: 250.0 }]);
  
  const executor = new SQLExecutor();
  executor.registerTable('test', table);
  
  const parser = new SQLParser();
  const result = executor.execute(parser.parse('SELECT * FROM test WHERE price > 100'));
  
  if (result.rowCount !== 2) throw new Error('Expected 2 rows > 100');
});

await runTest('UPSERT', async () => {
  const { SQLParser } = await import('../src/sql/parser.js');
  const { SQLExecutor } = await import('../src/sql/executor.js');
  const { ColumnarTable } = await import('../src/columnar.js');
  
  const table = new ColumnarTable([
    { name: 'id', type: 'int32' },
    { name: 'value', type: 'float64' },
  ]);
  table.appendBatch([{ id: 1, value: 100.0 }]);
  
  const executor = new SQLExecutor();
  executor.registerTable('test', table);
  
  const parser = new SQLParser();
  
  // 插入新行
  executor.execute(parser.parse("UPSERT INTO test (id, value) VALUES (2, 200.0) KEY (id)"));
  // 更新现有行
  executor.execute(parser.parse("UPSERT INTO test (id, value) VALUES (1, 999.0) KEY (id)"));
  
  if (table.getRowCount() !== 2) throw new Error('Expected 2 rows');
  const values = table.getColumn('value') as Float64Array;
  if (values[0] !== 999.0) throw new Error('Update failed');
});

// ─── 模块 6: 时序查询 ─────────────────────────────

console.log('\n📦 Module 6: 时序查询\n');

await runTest('SAMPLE BY 聚合', async () => {
  const { sampleBy } = await import('../src/query.js');
  
  const timestamps = new BigInt64Array([0n, 500n, 1000n, 1500n, 2000n].map(n => BigInt(n)));
  const values = new Float64Array([1, 2, 3, 4, 5]);
  
  const result = sampleBy(timestamps, [
    { name: 'v', data: values, aggs: ['first', 'last', 'sum'] }
  ], 1000); // 1秒桶
  
  if (result.length !== 3) throw new Error(`Expected 3 buckets, got ${result.length}`);
  if (result[0].values.v_sum !== 3) throw new Error('First bucket sum should be 1+2=3');
});

await runTest('OHLCV K线', async () => {
  const { ohlcv } = await import('../src/query.js');
  
  const timestamps = new BigInt64Array(100);
  const prices = new Float64Array(100);
  const volumes = new Int32Array(100);
  
  for (let i = 0; i < 100; i++) {
    timestamps[i] = BigInt(i * 100); // 100ms 间隔
    prices[i] = 100 + Math.sin(i / 10) * 10;
    volumes[i] = i;
  }
  
  const bars = ohlcv(timestamps, prices, volumes, 1000); // 1秒 K线
  
  if (bars.length !== 10) throw new Error(`Expected 10 bars, got ${bars.length}`);
  
  for (const bar of bars) {
    if (bar.high < bar.low || bar.high < bar.open || bar.high < bar.close) {
      throw new Error('Invalid OHLC relationship');
    }
  }
});

await runTest('SMA 计算', async () => {
  const { movingAverage } = await import('../src/query.js');
  
  const data = new Float64Array([1, 2, 3, 4, 5]);
  const sma = movingAverage(data, 3);
  
  // SMA(3) of [1,2,3,4,5] = [1, 1.5, 2, 3, 4]
  if (Math.abs(sma[2] - 2.0) > 0.001) throw new Error('SMA calculation error');
  if (Math.abs(sma[4] - 4.0) > 0.001) throw new Error('SMA calculation error');
});

await runTest('EMA 计算', async () => {
  const { exponentialMovingAverage } = await import('../src/query.js');
  
  const data = new Float64Array([10, 10, 10, 10, 10]); // 恒定值
  const ema = exponentialMovingAverage(data, 10);
  
  // EMA of constant value should be same value
  for (let i = 0; i < ema.length; i++) {
    if (Math.abs(ema[i] - 10.0) > 0.001) {
      throw new Error(`EMA calculation error at ${i}: ${ema[i]}`);
    }
  }
});

// ─── 模块 7: FFI ──────────────────────────────────

console.log('\n📦 Module 7: libndts FFI\n');

await runTest('isNdtsReady', async () => {
  const { isNdtsReady } = await import('../src/ndts-ffi.js');
  // 只是检查函数存在并返回 boolean
  const ready = isNdtsReady();
  console.log(`     FFI ready: ${ready}`);
});

await runTest('binarySearchI64', async () => {
  const { binarySearchI64, isNdtsReady } = await import('../src/ndts-ffi.js');
  if (!isNdtsReady()) return; // Skip if no FFI
  
  const arr = new BigInt64Array([10n, 20n, 30n, 40n, 50n]);
  const idx = binarySearchI64(arr, 30n);
  if (idx !== 2) throw new Error(`Expected index 2, got ${idx}`);
});

// ─── 模块 8: 边界/异常 ────────────────────────────

console.log('\n📦 Module 8: 边界和异常\n');

await runTest('空表操作', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable([
    { name: 'v', type: 'float64' },
  ]);
  
  if (table.getRowCount() !== 0) throw new Error('Empty table should have 0 rows');
  
  const path = `${TEST_DIR}/empty.ndts`;
  table.saveToFile(path);
  const loaded = ColumnarTable.loadFromFile(path);
  if (loaded.getRowCount() !== 0) throw new Error('Loaded empty table should have 0 rows');
});

await runTest('单行边界', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable([
    { name: 'v', type: 'float64' },
  ]);
  
  table.append({ v: 42.0 });
  
  const col = table.getColumn('v') as Float64Array;
  if (col.length !== 1 || col[0] !== 42.0) throw new Error('Single row error');
});

await runTest('类型自动转换', async () => {
  const { ColumnarTable } = await import('../src/columnar.js');
  const table = new ColumnarTable([
    { name: 'ts', type: 'int64' },
  ]);
  
  // 传入 number，应该自动转 bigint
  table.append({ ts: 1700000000000 });
  
  const col = table.getColumn('ts') as BigInt64Array;
  if (col[0] !== 1700000000000n) throw new Error('Auto conversion failed');
});

// ─── 测试报告 ─────────────────────────────────────

console.log('\n' + '=' .repeat(70));
console.log('\n📊 测试报告\n');

const passed = RESULTS.filter(r => r.status === 'PASS').length;
const failed = RESULTS.filter(r => r.status === 'FAIL').length;
const skipped = RESULTS.filter(r => r.status === 'SKIP').length;
const totalTime = RESULTS.reduce((sum, r) => sum + r.time, 0);

console.log(`  总计: ${RESULTS.length} 个测试`);
console.log(`  通过: ${passed} ✅`);
console.log(`  失败: ${failed} ❌`);
console.log(`  跳过: ${skipped} ⏭️`);
console.log(`  耗时: ${totalTime.toFixed(1)}ms`);
console.log(`  成功率: ${((passed / RESULTS.length) * 100).toFixed(1)}%`);

if (failed > 0) {
  console.log('\n❌ 失败的测试:\n');
  for (const r of RESULTS.filter(r => r.status === 'FAIL')) {
    console.log(`  • ${r.name}: ${r.error}`);
  }
}

console.log('');
process.exit(failed > 0 ? 1 : 0);
