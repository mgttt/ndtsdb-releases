#!/usr/bin/env bun
/**
 * AutoRecenter 功能验证测试
 * 
 * 测试场景：价格快速下跌 10%，验证 autoRecenter 触发
 */

import { SimulatedProvider, SCENARIOS } from '../src/providers';

console.log('='.repeat(70));
console.log('   AutoRecenter 功能验证');
console.log('='.repeat(70));
console.log();

// 使用 range-then-dump 场景
const scenario = SCENARIOS['range-then-dump'];

// 自定义场景：快速下跌
const customScenario = {
  name: 'Fast Dump Test',
  description: '快速下跌 10%，测试 autoRecenter',
  startPrice: 100,
  phases: [
    {
      type: 'range' as const,
      durationSec: 30,  // 30秒震荡
      price: 100,
      range: 0.01,
    },
    {
      type: 'dump' as const,
      durationSec: 30,  // 30秒下跌 10%
      change: -0.10,
    },
    {
      type: 'range' as const,
      durationSec: 120, // 2分钟新区间
      price: 90,
      range: 0.02,
    },
  ],
};

console.log('[场景]', customScenario.name);
console.log('  描述:', customScenario.description);
console.log('  阶段:');
customScenario.phases.forEach((p, i) => {
  console.log(`    ${i + 1}. ${p.type} ${p.durationSec}s ${p.change ? `(${p.change * 100}%)` : ''}`);
});
console.log();

// 配置 Provider - 100x 加速
const provider = new SimulatedProvider({
  mode: 'scenario',
  scenario: customScenario as any,
  startPrice: 100,
  speed: 100,
  tickIntervalMs: 1000,
  symbol: 'SIM/USDT',
});

// 记录关键事件
let tickCount = 0;
const events: Array<{tick: number, price: number, event?: string}> = [];

provider.onPrice((price: number) => {
  tickCount++;
  
  // 记录每个价格点
  events.push({ tick: tickCount, price });
  
  // 输出关键价格变化
  if (tickCount <= 10 || tickCount % 10 === 0) {
    const lastPrice = events.length > 1 ? events[events.length - 2].price : price;
    const change = ((price - lastPrice) / lastPrice * 100).toFixed(2);
    console.log(`[Tick ${tickCount.toString().padStart(4)}] 价格: ${price.toFixed(4)} (${change}%)`);
  }
});

// 启动
console.log('[启动] 100x 加速...');
console.log();

provider.start();

// 30秒后停止
setTimeout(() => {
  provider.stop();
  
  console.log();
  console.log('='.repeat(70));
  console.log('   结果分析');
  console.log('='.repeat(70));
  console.log();
  
  const startPrice = events[0]?.price || 100;
  const minPrice = Math.min(...events.map(e => e.price));
  const maxPrice = Math.max(...events.map(e => e.price));
  const endPrice = events[events.length - 1]?.price || 0;
  
  console.log(`总 Tick 数: ${tickCount}`);
  console.log(`起始价格: ${startPrice.toFixed(4)}`);
  console.log(`最低价格: ${minPrice.toFixed(4)} (${((minPrice - startPrice) / startPrice * 100).toFixed(2)}%)`);
  console.log(`最高价格: ${maxPrice.toFixed(4)} (${((maxPrice - startPrice) / startPrice * 100).toFixed(2)}%)`);
  console.log(`结束价格: ${endPrice.toFixed(4)} (${((endPrice - startPrice) / startPrice * 100).toFixed(2)}%)`);
  console.log();
  
  // 检查是否有 3% 以上的下跌
  const dumpPhase = events.filter(e => e.price < startPrice * 0.97);
  if (dumpPhase.length > 0) {
    console.log('✅ 价格下跌超过 3%，autoRecenter 应该触发');
    console.log(`   下跌持续: ${dumpPhase.length} ticks`);
  } else {
    console.log('❌ 价格下跌未超过 3%');
  }
  
  console.log();
  console.log('注意: autoRecenter 触发条件:');
  console.log('  1. 价格偏离中心 >= 3%');
  console.log('  2. 连续 30 ticks 无成交');
  console.log('  3. 无活跃订单');
  console.log('  4. 10分钟冷却');
  
  process.exit(0);
}, 3000); // 3秒 = 模拟 5 分钟
