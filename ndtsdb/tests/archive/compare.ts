// ============================================================
// 性能对比测试：行式存储 vs 列式存储
// ============================================================

import { TSDB } from '../src/storage.js';
import { ColumnarTable } from '../src/columnar.js';
import type { ColumnDef } from '../src/types.js';

// 生成测试数据
function generateRows(count: number, symbols: string[]): Array<Record<string, string | number | Date>> {
  const now = Date.now();
  const rows: Array<Record<string, string | number | Date>> = [];
  
  for (let i = 0; i < count; i++) {
    rows.push({
      timestamp: new Date(now - (count - i) * 100),
      symbol: symbols[i % symbols.length],
      price: 100 + Math.random() * 50,
      volume: Math.floor(Math.random() * 10000),
      bid: 100 + Math.random() * 50 - 0.01,
      ask: 100 + Math.random() * 50 + 0.01
    });
  }
  
  return rows;
}

function generateColumnarData(count: number, symbols: string[]): Array<Record<string, number | bigint>> {
  const now = BigInt(Date.now());
  const rows: Array<Record<string, number | bigint>> = [];
  
  for (let i = 0; i < count; i++) {
    rows.push({
      timestamp: now - BigInt((count - i) * 100),
      symbol: symbols[i % symbols.length],  // 这里应该用编码后的 int，简化处理
      price: 100 + Math.random() * 50,
      volume: Math.floor(Math.random() * 10000),
      bid: 100 + Math.random() * 50 - 0.01,
      ask: 100 + Math.random() * 50 + 0.01
    });
  }
  
  return rows;
}

async function benchmark() {
  console.log('⚡ data-lib 性能对比测试');
  console.log('行式存储 (JSON) vs 列式存储 (TypedArray)\n');
  console.log('=' .repeat(60));

  const testSizes = [10000, 100000];
  const symbols = ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA'];

  for (const size of testSizes) {
    console.log(`\n📊 测试数据量: ${size.toLocaleString()} 行`);
    console.log('-'.repeat(60));

    // ===== 行式存储测试 =====
    console.log('\n📦 行式存储 (TSDB + JSON)');
    
    // 清理
    await Bun.$`rm -rf ./data/benchmark-row`.catch(() => {});
    
    const rowDb = new TSDB({
      dataDir: './data/benchmark-row',
      partitionBy: { column: 'timestamp', granularity: 'hour' },
      walEnabled: false,  // 关闭 WAL 公平对比
      cacheSize: 50000
    });

    const rowSchema: ColumnDef[] = [
      { name: 'timestamp', type: 'timestamp' },
      { name: 'symbol', type: 'symbol' },
      { name: 'price', type: 'double' },
      { name: 'volume', type: 'long' },
      { name: 'bid', type: 'double' },
      { name: 'ask', type: 'double' }
    ];

    rowDb.createTable('trades', rowSchema);

    const rowData = generateRows(size, symbols);

    // 写入测试
    let rowWriteStart = performance.now();
    rowDb.insertBatch('trades', rowData);
    let rowWriteTime = performance.now() - rowWriteStart;
    
    // 刷盘
    let rowFlushStart = performance.now();
    rowDb.flush();
    let rowFlushTime = performance.now() - rowFlushStart;

    // 查询测试
    let rowQueryStart = performance.now();
    const rowResults = rowDb.query({
      table: 'trades',
      where: row => row.price > 120
    });
    let rowQueryTime = performance.now() - rowQueryStart;

    rowDb.close();

    console.log(`  写入: ${rowWriteTime.toFixed(2).padStart(8)}ms | ${(size / rowWriteTime * 1000).toFixed(0).padStart(8)} rows/s`);
    console.log(`  刷盘: ${rowFlushTime.toFixed(2).padStart(8)}ms`);
    console.log(`  查询: ${rowQueryTime.toFixed(2).padStart(8)}ms (${rowResults.length.toLocaleString()} 行)`);

    // ===== 列式存储测试 =====
    console.log('\n🔲 列式存储 (TypedArray)');

    const colTable = new ColumnarTable([
      { name: 'timestamp', type: 'int64' },
      { name: 'symbol', type: 'int32' },  // 编码为 int
      { name: 'price', type: 'float64' },
      { name: 'volume', type: 'int32' },
      { name: 'bid', type: 'float64' },
      { name: 'ask', type: 'float64' }
    ]);

    const colData = generateColumnarData(size, symbols);

    // 写入测试
    let colWriteStart = performance.now();
    colTable.appendBatch(colData);
    let colWriteTime = performance.now() - colWriteStart;

    // 保存测试
    await Bun.$`rm -rf ./data/benchmark-col`.catch(() => {});
    let colSaveStart = performance.now();
    colTable.saveToFile('./data/benchmark-col/trades.ndts');
    let colSaveTime = performance.now() - colSaveStart;

    // 查询测试
    let colQueryStart = performance.now();
    const priceCol = colTable.getColumn('price') as Float64Array;
    const colResults: number[] = [];
    for (let i = 0; i < priceCol.length; i++) {
      if (priceCol[i] > 120) {
        colResults.push(i);
      }
    }
    let colQueryTime = performance.now() - colQueryStart;

    // 从文件加载测试
    let colLoadStart = performance.now();
    const loadedTable = ColumnarTable.loadFromFile('./data/benchmark-col/trades.ndts');
    let colLoadTime = performance.now() - colLoadStart;

    console.log(`  写入: ${colWriteTime.toFixed(2).padStart(8)}ms | ${(size / colWriteTime * 1000).toFixed(0).padStart(8)} rows/s`);
    console.log(`  保存: ${colSaveTime.toFixed(2).padStart(8)}ms`);
    console.log(`  加载: ${colLoadTime.toFixed(2).padStart(8)}ms`);
    console.log(`  查询: ${colQueryTime.toFixed(2).padStart(8)}ms (${colResults.length.toLocaleString()} 行)`);

    // ===== 对比 =====
    console.log('\n📈 性能对比');
    console.log(`  写入速度: ${(colWriteTime / rowWriteTime * 100).toFixed(0)}% (列式/行式)`);
    console.log(`  查询速度: ${(colQueryTime / rowQueryTime * 100).toFixed(0)}% (列式/行式)`);
    console.log(`  综合提升: ${((rowWriteTime + rowQueryTime) / (colWriteTime + colQueryTime)).toFixed(1)}x`);
  }

  console.log('\n✅ 测试完成');
}

benchmark().catch(console.error);
