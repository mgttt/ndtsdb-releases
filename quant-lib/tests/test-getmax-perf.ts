#!/usr/bin/env bun
/**
 * 测试 getMaxTimestamp() 性能
 * 
 * 对比：
 * 1. 旧实现：table.query() + 手动扫描
 * 2. 新实现：table.getMax() + 只扫描必要分区
 */

import { KlineDatabase } from '../src/storage/database';
import type { Kline } from '../src/types/kline';

async function main() {
  console.log('======================================================================');
  console.log('   getMaxTimestamp() 性能测试');
  console.log('======================================================================\n');

  // 1. 初始化数据库
  const db = new KlineDatabase('./data/test-getmax');
  await db.init();

  // 2. 生成测试数据（3 个 symbol × 1000 条 K线）
  console.log('[准备] 生成测试数据...');

  const symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  const testKlines: Kline[] = [];

  const startTime = Date.now() - 1000 * 1000_000; // 1000 秒前

  for (const symbol of symbols) {
    for (let i = 0; i < 1000; i++) {
      testKlines.push({
        symbol,
        exchange: 'bybit',
        baseCurrency: symbol.slice(0, -4),
        quoteCurrency: 'USDT',
        interval: '1m',
        timestamp: startTime + i * 60_000,
        open: 50000 + Math.random() * 1000,
        high: 50000 + Math.random() * 1000,
        low: 50000 + Math.random() * 1000,
        close: 50000 + Math.random() * 1000,
        volume: Math.random() * 1000,
        quoteVolume: Math.random() * 50_000_000,
        trades: Math.floor(Math.random() * 1000),
        takerBuyVolume: Math.random() * 500,
        takerBuyQuoteVolume: Math.random() * 25_000_000,
      });
    }
  }

  await db.insertKlines(testKlines);

  console.log(`[准备] 已插入 ${testKlines.length} 条 K线数据\n`);

  // 3. 测试新实现（getMaxTimestamp）
  console.log('[测试] 新实现：getMaxTimestamp()');

  const t1 = performance.now();

  for (const symbol of symbols) {
    const maxTs = await db.getMaxTimestamp(symbol, '1m');
    console.log(`  ${symbol}: ${maxTs} (${new Date(maxTs!).toISOString()})`);
  }

  const t2 = performance.now();
  const elapsed1 = t2 - t1;

  console.log(`\n[性能] 新实现耗时: ${elapsed1.toFixed(2)} ms\n`);

  // 4. 验证正确性
  console.log('[验证] 检查结果正确性...');

  for (const symbol of symbols) {
    const maxTs = await db.getMaxTimestamp(symbol, '1m');
    const expected = testKlines
      .filter(k => k.symbol === symbol)
      .map(k => k.timestamp)
      .reduce((a, b) => Math.max(a, b), 0);

    if (maxTs === expected) {
      console.log(`  ✅ ${symbol}: ${maxTs} === ${expected}`);
    } else {
      console.log(`  ❌ ${symbol}: ${maxTs} !== ${expected}`);
    }
  }

  console.log('\n[验证] 索引一致性测试...');

  // 插入新 K线
  const newKline: Kline = {
    symbol: 'BTCUSDT',
    exchange: 'bybit',
    baseCurrency: 'BTC',
    quoteCurrency: 'USDT',
    interval: '1m',
    timestamp: startTime + 1000 * 60_000,
    open: 51000,
    high: 51500,
    low: 50800,
    close: 51200,
    volume: 100,
    quoteVolume: 5_100_000,
    trades: 50,
    takerBuyVolume: 50,
    takerBuyQuoteVolume: 2_550_000,
  };

  await db.insertKlines([newKline]);

  const maxTs = await db.getMaxTimestamp('BTCUSDT', '1m');

  if (maxTs === newKline.timestamp) {
    console.log(`  ✅ 插入后立即查询：${maxTs} === ${newKline.timestamp}`);
  } else {
    console.log(`  ❌ 插入后立即查询：${maxTs} !== ${newKline.timestamp}`);
  }

  // 5. 清理
  await db.close();

  console.log('\n✅ 测试完成');
}

main().catch(console.error);
