/**
 * 生成测试数据
 * 
 * 生成 1 年的 BTC/USDT 日线数据（365 根 K线）
 */

import { KlineDatabase } from 'quant-lib';
import type { Kline } from 'quant-lib';

console.log('📊 生成测试数据...');

const db = new KlineDatabase({
  path: './data/ndtsdb',
});

await db.init();

// 生成 1 年的日线数据
const symbol = 'BTC/USDT';
const interval = '1d';
const days = 365;
const startTime = Math.floor(Date.parse('2024-01-01') / 1000);
const oneDay = 24 * 60 * 60;

const klines: Kline[] = [];

let basePrice = 40000;  // 起始价格
let trend = 0;          // 趋势

for (let i = 0; i < days; i++) {
  const timestamp = startTime + i * oneDay;
  
  // 模拟价格波动：长期趋势 + 随机波动
  // 每 50 天改变一次趋势
  if (i % 50 === 0) {
    trend = (Math.random() - 0.5) * 2000; // -1000 ~ +1000
  }
  
  // 日内波动
  const dailyChange = (Math.random() - 0.5) * 2000; // -1000 ~ +1000
  const open = basePrice;
  const close = open + trend / 50 + dailyChange;
  const high = Math.max(open, close) + Math.random() * 500;
  const low = Math.min(open, close) - Math.random() * 500;
  
  basePrice = close; // 下一天的起始价格
  
  const volume = 1000 + Math.random() * 500;
  
  klines.push({
    symbol,
    exchange: 'BINANCE',
    baseCurrency: 'BTC',
    quoteCurrency: 'USDT',
    interval,
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    quoteVolume: close * volume,
    trades: 100,
    takerBuyVolume: volume * 0.5,
    takerBuyQuoteVolume: close * volume * 0.5,
  } as any);
}

console.log(`生成 ${klines.length} 根 K线`);
console.log(`  Symbol: ${symbol}`);
console.log(`  Interval: ${interval}`);
console.log(`  时间范围: ${new Date(klines[0].timestamp * 1000).toISOString()} ~ ${new Date(klines[klines.length - 1].timestamp * 1000).toISOString()}`);
console.log(`  价格范围: ${Math.min(...klines.map(k => k.low)).toFixed(2)} ~ ${Math.max(...klines.map(k => k.high)).toFixed(2)}`);

await db.insertKlines(klines);

console.log('✅ 数据写入完成');

// 验证
const latest = await db.getLatestKline(symbol, interval);
console.log(`\n验证: 最新 K线时间 ${new Date(latest!.timestamp * 1000).toISOString()}, close=${latest!.close.toFixed(2)}`);

await db.close();

console.log('\n✅ 完成');
