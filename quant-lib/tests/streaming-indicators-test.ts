/**
 * 流式指标测试
 */

import { StreamingIndicators } from '../src/indicators/streaming-indicators';

console.log('\n📊 测试 1: 基本功能');

const indicators = new StreamingIndicators();

// 添加 BTC 配置
indicators.addSymbol('BTC/USDT', {
  sma: [5, 10],
  ema: [12, 26],
  stddev: [20],
  min: [5],
  max: [5],
});

console.log('✅ 配置完成:', indicators.getStatus());

// 生成测试数据：100 个价格点（模拟真实价格波动）
const prices: number[] = [];
const basePrice = 40000;

for (let i = 0; i < 100; i++) {
  // 使用正弦波 + 随机噪声模拟价格波动
  const trend = Math.sin(i / 10) * 1000; // 趋势
  const noise = (Math.random() - 0.5) * 200; // 噪声
  const price = basePrice + trend + noise;
  prices.push(price);
}

console.log('\n📊 测试 2: 批量回填历史数据');

const result = indicators.batchUpdate('BTC/USDT', prices);

console.log('最后一个指标结果:');
console.log(`  Close: ${result.close.toFixed(2)}`);
console.log(`  SMA5: ${result.sma?.sma5.toFixed(2)}`);
console.log(`  SMA10: ${result.sma?.sma10.toFixed(2)}`);
console.log(`  EMA12: ${result.ema?.ema12.toFixed(2)}`);
console.log(`  EMA26: ${result.ema?.ema26.toFixed(2)}`);
console.log(`  StdDev20: ${result.stddev?.stddev20.toFixed(2)}`);
console.log(`  Min5: ${result.min?.min5.toFixed(2)}`);
console.log(`  Max5: ${result.max?.max5.toFixed(2)}`);

console.log('\n📊 测试 3: 实时更新（模拟 WebSocket）');

// 模拟实时行情
for (let i = 0; i < 5; i++) {
  const newPrice = basePrice + (Math.random() - 0.5) * 500;
  const result = indicators.update('BTC/USDT', newPrice, Date.now());

  console.log(`\n[${i + 1}] Close: ${result.close.toFixed(2)}`);
  console.log(`    SMA5: ${result.sma?.sma5.toFixed(2)}, SMA10: ${result.sma?.sma10.toFixed(2)}`);
  console.log(`    EMA12: ${result.ema?.ema12.toFixed(2)}, EMA26: ${result.ema?.ema26.toFixed(2)}`);
}

console.log('\n📊 测试 4: 多 symbol 管理');

// 添加 ETH
indicators.addSymbol('ETH/USDT', {
  sma: [20],
  ema: [12],
});

const ethPrices = [2000, 2010, 2020, 2015, 2025];
indicators.batchUpdate('ETH/USDT', ethPrices);

console.log('✅ 多 symbol 状态:', indicators.getStatus());

// 更新 BTC
const btcResult = indicators.update('BTC/USDT', 40500);
console.log(`BTC: Close=${btcResult.close}, SMA5=${btcResult.sma?.sma5.toFixed(2)}`);

// 更新 ETH
const ethResult = indicators.update('ETH/USDT', 2030);
console.log(`ETH: Close=${ethResult.close}, SMA20=${ethResult.sma?.sma20.toFixed(2)}`);

console.log('\n📊 测试 5: 重置 symbol');

indicators.resetSymbol('BTC/USDT');
console.log('✅ 重置 BTC/USDT');

// 重置后再更新
const resetResult = indicators.update('BTC/USDT', 40000);
console.log(`重置后: Close=${resetResult.close}, SMA5=${resetResult.sma?.sma5.toFixed(2)} (应该等于 close)`);

console.log('\n✅ 测试完成');
