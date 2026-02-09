// ============================================================
// 使用示例
// ============================================================

import { TSDB } from '../src/index.js';
import type { ColumnDef } from '../src/index.js';

// 定义表结构
const tickSchema: ColumnDef[] = [
  { name: 'timestamp', type: 'timestamp' },
  { name: 'symbol', type: 'symbol', index: true },
  { name: 'price', type: 'double' },
  { name: 'volume', type: 'long' },
  { name: 'side', type: 'symbol' }  // 'buy' | 'sell'
];

async function main() {
  console.log('🚀 data-lib 使用示例\n');

  // 1. 创建数据库实例
  const db = new TSDB({
    dataDir: './data/ticks',
    partitionBy: { column: 'timestamp', granularity: 'hour' },
    walEnabled: true,
    cacheSize: 5000
  });

  // 2. 创建表
  console.log('📊 创建 tick_data 表...');
  db.createTable('tick_data', tickSchema);

  // 3. 模拟写入 Tick 数据
  console.log('📝 写入 10000 条模拟 Tick 数据...');
  const symbols = ['AAPL', 'GOOGL', 'MSFT', 'TSLA', 'NVDA'];
  const batch: Parameters<typeof db.insertBatch>[1] = [];

  const baseTime = Date.now() - 3600000; // 1小时前
  
  for (let i = 0; i < 10000; i++) {
    batch.push({
      timestamp: new Date(baseTime + i * 360), // 每 360ms 一条
      symbol: symbols[i % symbols.length],
      price: 100 + Math.random() * 50,
      volume: Math.floor(Math.random() * 1000),
      side: i % 2 === 0 ? 'buy' : 'sell'
    });
  }

  const startWrite = performance.now();
  db.insertBatch('tick_data', batch);
  const writeTime = performance.now() - startWrite;
  console.log(`✅ 写入完成: ${(10000 / writeTime * 1000).toFixed(0)} rows/s\n`);

  // 4. 查询最近 10 分钟的 Tick 数据
  console.log('🔍 查询最近 10 分钟的 AAPL Tick 数据...');
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  
  const startQuery = performance.now();
  const recentTicks = db.query({
    table: 'tick_data',
    start: tenMinutesAgo,
    end: new Date(),
    where: row => row.symbol === 'AAPL',
    limit: 5
  });
  const queryTime = performance.now() - startQuery;

  console.log(`⏱️ 查询耗时: ${queryTime.toFixed(2)}ms`);
  console.log('📋 结果样例:', recentTicks);

  // 5. SAMPLE BY 聚合（1分钟 OHLC）
  console.log('\n📈 生成 1分钟 OHLCV 数据...');
  const ohlcv = db.sampleBy('tick_data', '1m', [
    { name: 'price', agg: 'first' },  // open
    { name: 'price', agg: 'max' },    // high  
    { name: 'price', agg: 'min' },    // low
    { name: 'price', agg: 'last' },   // close
    { name: 'volume', agg: 'sum' }    // volume
  ], {
    start: new Date(baseTime),
    end: new Date(baseTime + 3600000)
  });

  console.log(`🕯️ 生成 ${ohlcv.length} 根 K 线`);
  console.log('样例:', ohlcv.slice(0, 3));

  // 6. 统计信息
  console.log('\n📊 数据库统计:');
  const stats = db.getStats('tick_data');
  console.log(`- 总行数: ${stats.rowCount.toLocaleString()}`);
  console.log(`- 分区数: ${stats.partitions}`);
  console.log(`- Symbol 种类:`, stats.symbols);

  // 7. 关闭
  db.close();
  console.log('\n👋 数据库已关闭');
}

main().catch(console.error);
