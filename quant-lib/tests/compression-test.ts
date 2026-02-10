/**
 * 测试 KlineDatabase 压缩功能
 */

import { KlineDatabase } from '../src/storage/database';
import type { Kline } from '../src/types/kline';
import { rmSync, existsSync, statSync } from 'fs';

const TEST_DIR = '/tmp/klinedb-compression-test';

// 清理测试目录
if (existsSync(TEST_DIR)) {
  rmSync(TEST_DIR, { recursive: true });
}

// 创建数据库
const db = new KlineDatabase(TEST_DIR);
await db.init();

// 生成测试 K 线（365 天日线）
const klines: Kline[] = [];
const startTime = Date.parse('2024-01-01') / 1000; // Unix 秒
const oneDay = 24 * 60 * 60;

for (let i = 0; i < 365; i++) {
  const timestamp = startTime + i * oneDay;
  const basePrice = 100 + Math.sin(i / 30) * 10; // 模拟价格波动

  klines.push({
    symbol: 'BTC/USDT',
    exchange: 'BINANCE',
    baseCurrency: 'BTC',
    quoteCurrency: 'USDT',
    interval: '1d',
    timestamp,
    open: basePrice,
    high: basePrice + Math.random() * 2,
    low: basePrice - Math.random() * 2,
    close: basePrice + (Math.random() - 0.5) * 1,
    volume: 1000 + Math.random() * 500,
    quoteVolume: basePrice * (1000 + Math.random() * 500),
    trades: Math.floor(100 + Math.random() * 50),
    takerBuyVolume: 500 + Math.random() * 250,
    takerBuyQuoteVolume: basePrice * (500 + Math.random() * 250),
  } as any);
}

console.log(`📊 生成测试数据: ${klines.length} 根 K 线`);

// 写入数据库
await db.insertKlines(klines);
console.log('✅ 写入完成');

// 检查文件大小
const filePath = `${TEST_DIR}/klines/1d/0.ndts`; // symbol ID 从 0 开始
if (existsSync(filePath)) {
  const stats = statSync(filePath);
  const fileSizeKB = (stats.size / 1024).toFixed(2);
  const bytesPerRow = (stats.size / klines.length).toFixed(2);

  console.log(`\n📁 文件大小: ${fileSizeKB} KB`);
  console.log(`📏 每行字节数: ${bytesPerRow} bytes`);

  // 估算压缩率（假设未压缩约 80 bytes/row）
  const uncompressedBytes = klines.length * 80;
  const compressionRatio = ((1 - stats.size / uncompressedBytes) * 100).toFixed(2);
  console.log(`🗜️  估算压缩率: ${compressionRatio}%`);
} else {
  console.error('❌ 文件未创建');
}

// 验证读取
const readKlines = await db.queryKlines({ symbol: 'BTC/USDT', interval: '1d' });
console.log(`\n📖 读取验证: ${readKlines.length} 根 K 线`);
console.log(`   第一根: ${new Date(readKlines[0].timestamp * 1000).toISOString()}, close=${readKlines[0].close.toFixed(2)}`);
console.log(`   最后一根: ${new Date(readKlines[readKlines.length - 1].timestamp * 1000).toISOString()}, close=${readKlines[readKlines.length - 1].close.toFixed(2)}`);

// 关闭数据库
await db.close();

console.log('\n✅ 压缩测试完成');
