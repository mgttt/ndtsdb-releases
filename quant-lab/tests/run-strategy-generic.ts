#!/usr/bin/env bun
/**
 * 通用策略启动器
 * 
 * 用法:
 *   bun tests/run-strategy-generic.ts <strategy-file> [params-json] [exchange] [account]
 * 
 * 示例:
 *   bun tests/run-strategy-generic.ts ./strategies/gales-simple.js
 *   bun tests/run-strategy-generic.ts ./strategies/gales-simple.js '{"gridCount":10}'
 *   bun tests/run-strategy-generic.ts ./strategies/gales-simple.js '{}' bybit wjcgm@bbt-sub1
 */

import { QuickJSStrategy } from '../src/sandbox/QuickJSStrategy';
import { BybitProvider } from '../src/providers/bybit';
import { existsSync } from 'fs';

// ================================
// 参数解析
// ================================

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error('用法: run-strategy-generic.ts <strategy-file> [params-json] [exchange] [account]');
  process.exit(1);
}

const strategyFile = args[0];
const paramsJson = args[1] || '{}';
const exchange = args[2] || 'bybit';
const accountId = args[3] || 'wjcgm@bbt-sub1';

// 验证策略文件
if (!existsSync(strategyFile)) {
  console.error(`策略文件不存在: ${strategyFile}`);
  process.exit(1);
}

// 解析参数
let params;
try {
  params = JSON.parse(paramsJson);
} catch (e) {
  console.error(`参数 JSON 格式错误: ${e}`);
  process.exit(1);
}

// ================================
// 交易所配置
// ================================

const ACCOUNTS = {
  'wjcgm@bbt-sub1': {
    region: 'JP',
    credentials: {
      apiKey: process.env.BYBIT_API_KEY_WJCGM_SUB1 || '',
      apiSecret: process.env.BYBIT_API_SECRET_WJCGM_SUB1 || '',
    },
  },
  // 可以添加更多账号
};

// ================================
// 主流程
// ================================

async function main() {
  console.log('======================================================================');
  console.log('   通用策略启动器');
  console.log('======================================================================\n');

  console.log('[配置]', {
    strategyFile,
    params,
    exchange,
    accountId,
  });

  // 1. 初始化交易所连接
  let provider: any;

  if (exchange === 'bybit') {
    const accountConfig = ACCOUNTS[accountId as keyof typeof ACCOUNTS];
    if (!accountConfig) {
      console.error(`未找到账号配置: ${accountId}`);
      process.exit(1);
    }

    provider = new BybitProvider({
      accountId,
      region: accountConfig.region as any,
      credentials: accountConfig.credentials,
      useProxy: true,
    });

    await provider.connect();
    console.log('[Exchange] Bybit 连接成功\n');
  } else {
    console.error(`暂不支持的交易所: ${exchange}`);
    process.exit(1);
  }

  // 2. 创建策略实例
  const strategy = new QuickJSStrategy({
    strategyFile,
    params,
    maxRetries: 3,
    retryDelayMs: 5000,
    enableHotReload: true,
  });

  console.log('[QuickJS] 初始化沙箱...');
  await strategy.init();
  console.log('[QuickJS] 策略初始化完成\n');

  // 3. 获取交易对（从参数或默认）
  const symbol = params.symbol || 'MYXUSDT';

  console.log(`⚠️  [Paper Trade] 模拟模式（策略内 simMode，未连接真实订单流）`);
  console.log('[按 Ctrl+C 停止]\n');

  // 4. 启动心跳循环
  console.log('[QuickJS] 策略启动...');

  let tickCount = 0;

  const heartbeatInterval = setInterval(async () => {
    try {
      // 获取最新价格
      const ticker = await provider.getTicker(symbol);
      tickCount++;

      // 每 10 次心跳输出一次价格
      if (tickCount % 10 === 0) {
        console.log(`[QuickJS] 心跳 #${tickCount} - 价格: ${ticker.lastPrice}`);
      }

      // 构造 tick
      const tick = {
        count: tickCount,
        timestamp: Math.floor(Date.now() / 1000),
        price: ticker.lastPrice,
        volume: ticker.volume24h || 1000,
      };

      // 调用策略心跳
      await strategy.callFunction('st_heartbeat', tick);
    } catch (error: any) {
      console.error(`[QuickJS] 心跳错误: ${error.message}`);
      
      // 错误隔离：不中断循环
      if (strategy.errorCount > 10) {
        console.error(`[QuickJS] 错误次数过多，停止策略`);
        clearInterval(heartbeatInterval);
        process.exit(1);
      }
    }
  }, 5000); // 5 秒心跳

  // 5. 优雅退出
  process.on('SIGINT', async () => {
    console.log('\n[QuickJS] 正在停止策略...');
    clearInterval(heartbeatInterval);

    try {
      await strategy.callFunction('st_stop');
      await strategy.dispose();
      console.log('[QuickJS] 策略已停止');
    } catch (e) {
      console.error('[QuickJS] 停止失败:', e);
    }

    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n[QuickJS] 收到 SIGTERM，停止策略...');
    clearInterval(heartbeatInterval);

    try {
      await strategy.callFunction('st_stop');
      await strategy.dispose();
    } catch (e) {
      console.error('[QuickJS] 停止失败:', e);
    }

    process.exit(0);
  });
}

main().catch((error) => {
  console.error('[Fatal]', error);
  process.exit(1);
});
