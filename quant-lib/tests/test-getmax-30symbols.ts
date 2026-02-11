#!/usr/bin/env bun
/**
 * 测试 getMaxTimestamp() 性能 - 30 个 symbol 场景
 * 
 * 场景：
 * - 30 个 symbol
 * - 每个 symbol 4000 条 K 线
 * - 查询所有 symbol 的最新时间戳
 */

import { KlineDatabase } from '../src/storage/database';
import type { Kline } from '../src/types/kline';

async function main() {
  console.log('======================================================================');
  console.log('   getMaxTimestamp() 性能测试 - 30 个 symbol × 4000 条');
  console.log('======================================================================\n');

  // 1. 初始化数据库
  const db = new KlineDatabase('./data/test-30symbols');
  await db.init();

  // 2. 生成测试数据（30 个 symbol × 4000 条）
  console.log('[准备] 生成测试数据...');

  const symbols = Array.from({ length: 30 }, (_, i) => {
    if (i < 10) return `BTC${i}USDT`;
    if (i < 20) return `ETH${i - 10}USDT`;
    return `SOL${i - 20}USDT`;
  });

  const testKlines: Kline[] = [];
  const startTime = Date.now() - 4000 * 60_000; // 4000 分钟前

  for (const symbol of symbols) {
    for (let i = 0; i < 4000; i++) {
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

  console.log(`[准备] 插入数据: ${symbols.length} 个 symbol × 4000 条 = ${testKlines.length.toLocaleString()} 条 K 线`);
  
  const t0 = performance.now();
  await db.insertKlines(testKlines);
  const t1 = performance.now();

  console.log(`[准备] 插入耗时: ${(t1 - t0).toFixed(2)} ms\n`);

  // 3. 测试查询性能（第一轮：冷启动，需要扫描数据）
  console.log('[测试] 第一轮查询（冷启动）...\n');

  const t2 = performance.now();

  const results1: Array<{ symbol: string; maxTs: number | null; elapsed: number }> = [];

  for (const symbol of symbols) {
    const tStart = performance.now();
    const maxTs = await db.getMaxTimestamp(symbol, '1m');
    const tEnd = performance.now();

    results1.push({
      symbol,
      maxTs: maxTs || 0,
      elapsed: tEnd - tStart,
    });
  }

  const t3 = performance.now();
  
  console.log(`第一轮总耗时: ${(t3 - t2).toFixed(2)} ms`);
  console.log(`平均每个 symbol: ${((t3 - t2) / symbols.length).toFixed(2)} ms\n`);

  // 4. 测试查询性能（第二轮：热缓存，应该命中索引）
  console.log('[测试] 第二轮查询（热缓存）...\n');

  const t4 = performance.now();

  const results2: Array<{ symbol: string; maxTs: number | null; elapsed: number }> = [];

  for (const symbol of symbols) {
    const tStart = performance.now();
    const maxTs = await db.getMaxTimestamp(symbol, '1m');
    const tEnd = performance.now();

    results2.push({
      symbol,
      maxTs: maxTs || 0,
      elapsed: tEnd - tStart,
    });
  }

  const t5 = performance.now();
  
  console.log(`第二轮总耗时: ${(t5 - t4).toFixed(2)} ms`);
  console.log(`平均每个 symbol: ${((t5 - t4) / symbols.length).toFixed(2)} ms`);
  console.log(`加速比: ${((t3 - t2) / (t5 - t4)).toFixed(1)}x\n`);

  // 5. 输出详细结果
  console.log('第一轮前 5 个结果：');
  for (let i = 0; i < 5; i++) {
    const r = results1[i];
    console.log(`  ${r.symbol}: ${r.maxTs} (${new Date(r.maxTs).toISOString().slice(11, 19)}) - ${r.elapsed.toFixed(2)} ms`);
  }

  console.log('\n第二轮前 5 个结果：');
  for (let i = 0; i < 5; i++) {
    const r = results2[i];
    console.log(`  ${r.symbol}: ${r.maxTs} (${new Date(r.maxTs).toISOString().slice(11, 19)}) - ${r.elapsed.toFixed(2)} ms`);
  }

  console.log('\n第一轮最慢的 5 个：');
  const sorted1 = results1.slice().sort((a, b) => b.elapsed - a.elapsed);
  for (let i = 0; i < 5; i++) {
    const r = sorted1[i];
    console.log(`  ${r.symbol}: ${r.elapsed.toFixed(2)} ms`);
  }

  console.log('\n第二轮最慢的 5 个：');
  const sorted2 = results2.slice().sort((a, b) => b.elapsed - a.elapsed);
  for (let i = 0; i < 5; i++) {
    const r = sorted2[i];
    console.log(`  ${r.symbol}: ${r.elapsed.toFixed(2)} ms`);
  }

  // 6. 验证正确性
  console.log('\n[验证] 检查结果正确性...');

  let errors = 0;
  for (const symbol of symbols.slice(0, 5)) {
    const maxTs = await db.getMaxTimestamp(symbol, '1m');
    const expected = testKlines
      .filter(k => k.symbol === symbol)
      .map(k => k.timestamp)
      .reduce((a, b) => Math.max(a, b), 0);

    if (maxTs === expected) {
      console.log(`  ✅ ${symbol}: ${maxTs} === ${expected}`);
    } else {
      console.log(`  ❌ ${symbol}: ${maxTs} !== ${expected}`);
      errors++;
    }
  }

  // 7. 性能评估
  console.log('\n[性能评估]');

  const time1 = t3 - t2;
  const time2 = t5 - t4;
  const avgTime1 = time1 / symbols.length;
  const avgTime2 = time2 / symbols.length;

  console.log(`  第一轮（冷启动）: ${time1.toFixed(2)} ms, 平均 ${avgTime1.toFixed(2)} ms/symbol`);
  console.log(`  第二轮（热缓存）: ${time2.toFixed(2)} ms, 平均 ${avgTime2.toFixed(2)} ms/symbol`);

  if (time2 < 1000) {
    console.log(`  ✅ 第二轮总耗时 ${time2.toFixed(2)} ms < 1000 ms（达到目标！）`);
  } else {
    console.log(`  ❌ 第二轮总耗时 ${time2.toFixed(2)} ms >= 1000 ms（未达目标）`);
  }

  if (avgTime2 < 10) {
    console.log(`  ✅ 第二轮平均耗时 ${avgTime2.toFixed(2)} ms < 10 ms（优秀！）`);
  } else {
    console.log(`  ⚠️  第二轮平均耗时 ${avgTime2.toFixed(2)} ms（可接受）`);
  }

  // 8. 对比旧实现（理论估算）
  console.log('\n[对比旧实现]');
  
  const oldEstimate = 30 * 10_000; // 30 个 symbol × 10 秒/symbol
  const speedup = oldEstimate / time2;

  console.log(`  旧实现（全表扫描）: ~${(oldEstimate / 1000).toFixed(0)} 秒`);
  console.log(`  新实现（索引缓存）: ${(time2 / 1000).toFixed(2)} 秒`);
  console.log(`  加速比: ${speedup.toFixed(0)}x\n`);

  // 8. 清理
  await db.close();

  console.log('✅ 测试完成');

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
