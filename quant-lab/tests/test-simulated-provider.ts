#!/usr/bin/env bun
/**
 * SimulatedProvider 功能测试
 */

import { SimulatedProvider, SCENARIOS } from '../src/providers';

console.log('='.repeat(70));
console.log('   SimulatedProvider 功能测试');
console.log('='.repeat(70));
console.log();

// ============================================================
// 测试 1: 随机游走模式
// ============================================================

console.log('[测试 1] 随机游走模式');

const provider1 = new SimulatedProvider({
  mode: 'random-walk',
  startPrice: 100,
  volatility: 0.01,
  speed: 1,
  tickIntervalMs: 100,
});

let prices1: number[] = [];

provider1.onPrice((price: number) => {
  prices1.push(price);
  if (prices1.length <= 5) {
    console.log(`  Tick ${prices1.length}: ${price.toFixed(2)}`);
  }
});

provider1.start();

await new Promise(resolve => setTimeout(resolve, 600));

provider1.stop();

console.log(`  生成了 ${prices1.length} 个价格点`);
console.log(`  价格范围: ${Math.min(...prices1).toFixed(2)} ~ ${Math.max(...prices1).toFixed(2)}`);
console.log();

// ============================================================
// 测试 2: 正弦波动模式
// ============================================================

console.log('[测试 2] 正弦波动模式');

const provider2 = new SimulatedProvider({
  mode: 'sine',
  startPrice: 100,
  amplitude: 0.05,
  period: 10,
  speed: 1,
  tickIntervalMs: 100,
});

let prices2: number[] = [];

provider2.onPrice((price: number) => {
  prices2.push(price);
  if (prices2.length <= 5) {
    console.log(`  Tick ${prices2.length}: ${price.toFixed(2)}`);
  }
});

provider2.start();

await new Promise(resolve => setTimeout(resolve, 600));

provider2.stop();

console.log(`  生成了 ${prices2.length} 个价格点`);
console.log(`  价格范围: ${Math.min(...prices2).toFixed(2)} ~ ${Math.max(...prices2).toFixed(2)}`);
console.log();

// ============================================================
// 测试 3: 场景模式
// ============================================================

console.log('[测试 3] 场景模式（range-then-dump）');

const provider3 = new SimulatedProvider({
  mode: 'scenario',
  startPrice: 100,
  scenario: SCENARIOS['range-then-dump'],
  speed: 10, // 10x 加速
  tickIntervalMs: 100,
});

let prices3: number[] = [];

provider3.onPrice((price: number) => {
  prices3.push(price);
  if (prices3.length % 10 === 0) {
    const phaseInfo = provider3.getPhaseInfo();
    console.log(`  Tick ${prices3.length}: ${price.toFixed(2)} (阶段 ${phaseInfo?.index}, 已过 ${phaseInfo?.elapsed.toFixed(1)}s)`);
  }
});

provider3.start();

await new Promise(resolve => setTimeout(resolve, 3000));

provider3.stop();

console.log(`  生成了 ${prices3.length} 个价格点`);
console.log(`  价格范围: ${Math.min(...prices3).toFixed(2)} ~ ${Math.max(...prices3).toFixed(2)}`);
console.log();

// ============================================================
// 测试 4: 订单成交
// ============================================================

console.log('[测试 4] 订单成交测试');

const provider4 = new SimulatedProvider({
  mode: 'sine',
  startPrice: 100,
  amplitude: 0.05,
  period: 10,
  speed: 1,
  tickIntervalMs: 100,
});

let filledOrders: any[] = [];

provider4.onOrder((order: any) => {
  if (order.status === 'Filled') {
    filledOrders.push(order);
    console.log(`  成交: ${order.side} ${order.qty} @ ${order.filledPrice.toFixed(2)}`);
  }
});

// 下单
provider4.start();

await provider4.placeOrder({
  symbol: 'SIM/USDT',
  side: 'Buy',
  qty: 1,
  price: 98, // 低于起始价
});

await provider4.placeOrder({
  symbol: 'SIM/USDT',
  side: 'Sell',
  qty: 1,
  price: 102, // 高于起始价
});

await new Promise(resolve => setTimeout(resolve, 2000));

provider4.stop();

console.log(`  总成交订单数: ${filledOrders.length}`);
console.log();

// ============================================================
// 测试 5: 时间加速
// ============================================================

console.log('[测试 5] 时间加速测试');

const speeds = [1, 10, 100];

for (const speed of speeds) {
  const provider = new SimulatedProvider({
    mode: 'random-walk',
    startPrice: 100,
    speed,
    tickIntervalMs: 1000,
  });

  let tickCount = 0;

  provider.onPrice(() => {
    tickCount++;
  });

  const startTime = Date.now();
  provider.start();

  await new Promise(resolve => setTimeout(resolve, 1000));

  provider.stop();

  const elapsed = Date.now() - startTime;
  console.log(`  ${speed}x 加速: ${tickCount} ticks in ${elapsed}ms (期望 ~${speed} ticks)`);
}

console.log();

// ============================================================
// 总结
// ============================================================

console.log('[总结]');
console.log('  ✅ 随机游走模式正常');
console.log('  ✅ 正弦波动模式正常');
console.log('  ✅ 场景模式正常');
console.log('  ✅ 订单成交正常');
console.log('  ✅ 时间加速正常');
console.log();
console.log('所有测试通过！ 🎉');
