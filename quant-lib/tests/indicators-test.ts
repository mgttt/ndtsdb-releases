#!/usr/bin/env bun
/**
 * 技术指标测试
 */

import {
  sma,
  ema,
  macd,
  rsi,
  bollingerBands,
  atr,
  obv,
  wma,
  momentum,
  roc,
} from '../src/indicators';

console.log('🧪 技术指标测试');
console.log('='.repeat(60));

// 测试数据（模拟 10 天价格）
const prices = [100, 102, 101, 105, 107, 106, 108, 110, 109, 112];
const high = [101, 103, 102, 106, 108, 107, 109, 111, 110, 113];
const low = [99, 101, 100, 104, 106, 105, 107, 109, 108, 111];
const volume = [1000, 1200, 900, 1500, 1300, 1100, 1400, 1600, 1200, 1700];

console.log('\n📊 测试数据:');
console.log('Prices:', prices);
console.log('\n');

// 测试 SMA
console.log('✅ SMA (5):', sma(prices, 5).slice(-5).map(x => x.toFixed(2)));

// 测试 EMA
console.log('✅ EMA (5):', ema(prices, 5).slice(-5).map(x => x.toFixed(2)));

// 测试 WMA
console.log('✅ WMA (5):', wma(prices, 5).slice(-5).map(x => x.toFixed(2)));

// 测试 MACD
const macdResult = macd(prices);
console.log('✅ MACD:');
console.log('   MACD:', macdResult.macd.slice(-3).map(x => isNaN(x) ? 'NaN' : x.toFixed(4)));
console.log('   Signal:', macdResult.signal.slice(-3).map(x => isNaN(x) ? 'NaN' : x.toFixed(4)));
console.log('   Histogram:', macdResult.histogram.slice(-3).map(x => isNaN(x) ? 'NaN' : x.toFixed(4)));

// 测试 RSI
const rsiValues = rsi(prices, 5);
console.log('✅ RSI (5):', rsiValues.slice(-5).map(x => isNaN(x) ? 'NaN' : x.toFixed(2)));

// 测试布林带
const bb = bollingerBands(prices, 5, 2);
console.log('✅ Bollinger Bands (5, 2):');
console.log('   Upper:', bb.upper.slice(-3).map(x => isNaN(x) ? 'NaN' : x.toFixed(2)));
console.log('   Middle:', bb.middle.slice(-3).map(x => isNaN(x) ? 'NaN' : x.toFixed(2)));
console.log('   Lower:', bb.lower.slice(-3).map(x => isNaN(x) ? 'NaN' : x.toFixed(2)));

// 测试 ATR
const atrValues = atr(high, low, prices, 5);
console.log('✅ ATR (5):', atrValues.slice(-5).map(x => isNaN(x) ? 'NaN' : x.toFixed(2)));

// 测试 OBV
const obvValues = obv(prices, volume);
console.log('✅ OBV:', obvValues.slice(-5));

// 测试动量
const momentumValues = momentum(prices, 5);
console.log('✅ Momentum (5):', momentumValues.slice(-5).map(x => isNaN(x) ? 'NaN' : x.toFixed(2)));

// 测试 ROC
const rocValues = roc(prices, 5);
console.log('✅ ROC (5):', rocValues.slice(-5).map(x => isNaN(x) ? 'NaN' : x.toFixed(2) + '%'));

console.log('\n='.repeat(60));
console.log('🎉 所有指标测试完成！');
console.log('\n✅ 已实现的指标：');
console.log('  - SMA (Simple Moving Average)');
console.log('  - EMA (Exponential Moving Average)');
console.log('  - WMA (Weighted Moving Average)');
console.log('  - MACD (Moving Average Convergence Divergence)');
console.log('  - RSI (Relative Strength Index)');
console.log('  - Bollinger Bands');
console.log('  - ATR (Average True Range)');
console.log('  - OBV (On-Balance Volume)');
console.log('  - Momentum');
console.log('  - ROC (Rate of Change)');
console.log('\n总计：10 个技术指标 ✅');
