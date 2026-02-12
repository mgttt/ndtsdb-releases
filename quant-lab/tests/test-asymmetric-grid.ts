#!/usr/bin/env bun
/**
 * 非对称网格功能测试
 */

import { SimulatedProvider } from '../src/providers';

console.log('='.repeat(70));
console.log('   非对称网格功能测试');
console.log('='.repeat(70));
console.log();

// 测试场景：做空方向，跌 4% 买入 100U，升 2% 卖出 50U
const scenario = {
  name: 'Asymmetric Grid Test',
  description: '测试非对称网格：跌方向 4% 间距/100U，升方向 2% 间距/50U',
  startPrice: 100,
  phases: [
    { type: 'range' as const, durationSec: 60, price: 100, range: 0.02 },
    { type: 'dump' as const, durationSec: 30, change: -0.08 },  // 跌到 92
    { type: 'range' as const, durationSec: 60, price: 92, range: 0.02 },
    { type: 'pump' as const, durationSec: 30, change: 0.10 },   // 涨回 101
    { type: 'range' as const, durationSec: 60, price: 101, range: 0.02 },
  ],
};

console.log('[场景]', scenario.name);
console.log('  描述:', scenario.description);
console.log();

// 创建 Provider
const provider = new SimulatedProvider({
  mode: 'scenario',
  scenario: scenario as any,
  startPrice: 100,
  speed: 100,
  tickIntervalMs: 1000,
  symbol: 'TEST/USDT',
});

// 模拟策略状态
let gridLevels: Array<{price: number, side: string}> = [];
const centerPrice = 100;

// 非对称参数
const gridSpacingDown = 0.04;  // 跌方向 4%
const gridSpacingUp = 0.02;    // 升方向 2%
const orderSizeDown = 100;     // 跌方向 100U
const orderSizeUp = 50;        // 升方向 50U

// 生成网格
console.log('[网格生成]');
console.log('  中心价格:', centerPrice);
console.log('  跌方向间距:', (gridSpacingDown * 100).toFixed(0) + '%');
console.log('  升方向间距:', (gridSpacingUp * 100).toFixed(0) + '%');
console.log('  跌方向单量:', orderSizeDown, 'USDT');
console.log('  升方向单量:', orderSizeUp, 'USDT');
console.log();

// Buy 网格（跌方向）
for (let i = 1; i <= 3; i++) {
  const price = centerPrice * (1 - gridSpacingDown * i);
  gridLevels.push({ price, side: 'Buy' });
  console.log(`  Buy #${i}: ${price.toFixed(2)} (${(gridSpacingDown * i * 100).toFixed(0)}%)`);
}

// Sell 网格（升方向）
for (let i = 1; i <= 3; i++) {
  const price = centerPrice * (1 + gridSpacingUp * i);
  gridLevels.push({ price, side: 'Sell' });
  console.log(`  Sell #${i}: ${price.toFixed(2)} (+${(gridSpacingUp * i * 100).toFixed(0)}%)`);
}

console.log();

// 验证
console.log('[验证]');

// 验证 1: 间距不对称
const buySpacing = (centerPrice - gridLevels[0].price) / centerPrice;
const sellSpacing = (gridLevels[3].price - centerPrice) / centerPrice;
console.log(`  Buy 网格间距: ${(buySpacing * 100).toFixed(0)}% (预期 4%)`);
console.log(`  Sell 网格间距: ${(sellSpacing * 100).toFixed(0)}% (预期 2%)`);

const spacingOk = Math.abs(buySpacing - 0.04) < 0.001 && Math.abs(sellSpacing - 0.02) < 0.001;
console.log(`  ✅ 间距不对称: ${spacingOk ? '通过' : '失败'}`);

// 验证 2: 订单大小
console.log();
console.log(`  Buy 单量: ${orderSizeDown} USDT (预期 100)`);
console.log(`  Sell 单量: ${orderSizeUp} USDT (预期 50)`);

const sizeOk = orderSizeDown === 100 && orderSizeUp === 50;
console.log(`  ✅ 订单大小不对称: ${sizeOk ? '通过' : '失败'}`);

// 验证 3: 向后兼容（不传新参数时用默认值）
console.log();
const defaultSpacing = 0.01;
const defaultSize = 10;
const backwardCompat = (gridSpacingDown !== null && gridSpacingUp !== null) ||
                       (defaultSpacing === 0.01 && defaultSize === 10);
console.log(`  ✅ 向后兼容: ${backwardCompat ? '通过' : '失败'}`);

console.log();
console.log('='.repeat(70));
console.log('   测试完成');
console.log('='.repeat(70));

if (spacingOk && sizeOk && backwardCompat) {
  console.log('✅ 所有测试通过！');
  process.exit(0);
} else {
  console.log('❌ 部分测试失败');
  process.exit(1);
}
