#!/usr/bin/env bun
/**
 * 真实账号测试
 * 
 * 测试策略在真实环境的运行（最小金额）
 */

import { st_worker_init, startStrategy } from '../src/worker/lifecycle';
import type { WorkerContext } from '../src/worker/types';

// 测试配置
const TEST_CONFIG = {
  workerId: 'test-worker-jp-001',
  region: 'JP',
  workDir: '/tmp/quant-lab-live-test',
  strategyFile: './strategies/short-martingale/index.ts',
  strategyId: 'test-short-martingale-001',
};

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(level: 'info' | 'success' | 'error' | 'warn' | 'step', message: string) {
  const prefix = {
    info: '[TEST]',
    success: `[${colors.green}✓${colors.reset}]`,
    error: `[${colors.red}✗${colors.reset}]`,
    warn: `[${colors.yellow}⚠${colors.reset}]`,
    step: `[${colors.cyan}→${colors.reset}]`,
  }[level];
  console.log(`${prefix} ${message}`);
}

// ===== 测试步骤 =====

async function step1_initWorker(): Promise<WorkerContext> {
  log('step', 'Step 1: Initialize Worker');

  const wctx = await st_worker_init({
    workerId: TEST_CONFIG.workerId,
    region: TEST_CONFIG.region,
    workDir: TEST_CONFIG.workDir,
  });

  log('success', `Worker ${wctx.worker.id} initialized`);
  log('info', `  Region: ${wctx.worker.region}`);
  log('info', `  APIs: ${wctx.apiPool.size}`);

  return wctx;
}

async function step2_verifyAccount(wctx: WorkerContext): Promise<void> {
  log('step', 'Step 2: Verify Account Access');

  try {
    // P1修复：账号必须通过环境变量配置（删除硬编码）
    const accountId = process.env.TEST_ACCOUNT_ID;
    if (!accountId) {
      throw new Error('TEST_ACCOUNT_ID environment variable required. Example: export TEST_ACCOUNT_ID=your-test-account');
    }

    log('info', `Testing account: ${accountId}`);

    // 获取余额
    const client = wctx.apiPool.get(accountId);
    if (!client) {
      throw new Error(`Account ${accountId} not found in API pool`);
    }

    const balance = await client.getBalance('UNIFIED');
    log('success', `Balance fetched: ${balance.totalEquity} USDT`);

    // 获取持仓
    const positions = await client.getPositions('linear');
    log('success', `Positions: ${positions.length} open`);

    // 检查账号类型 (1000U 子账号)
    if (parseFloat(balance.totalEquity) < 500 || parseFloat(balance.totalEquity) > 2000) {
      log('warn', `Equity ${balance.totalEquity} USDT is not in expected 1000U range`);
    } else {
      log('success', `Equity ${balance.totalEquity} USDT in expected range`);
    }

  } catch (error: any) {
    log('error', `Account verification failed: ${error.message}`);
    throw error;
  }
}

async function step3_startStrategy(wctx: WorkerContext): Promise<void> {
  log('step', 'Step 3: Start Strategy (Test Mode)');

  try {
    // 启动策略（测试模式，使用小金额）
    await startStrategy(wctx, TEST_CONFIG.strategyId, TEST_CONFIG.strategyFile);

    log('success', `Strategy ${TEST_CONFIG.strategyId} started`);

    // 等待几个心跳，观察策略运行
    log('info', 'Waiting for 3 heartbeats (30s)...');

    for (let i = 1; i <= 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 10000));

      const strategyInfo = wctx.strategies.get(TEST_CONFIG.strategyId);
      if (!strategyInfo) {
        log('error', 'Strategy not found in registry');
        return;
      }

      log('info', `Heartbeat ${i}: status=${strategyInfo.status}, errors=${strategyInfo.errorCount}`);
    }

    // 停止策略
    log('info', 'Stopping strategy...');
    const strategyInfo = wctx.strategies.get(TEST_CONFIG.strategyId)!;
    await strategyInfo.strategy.qjs.call('st_exit', [{ type: 'test_complete' }]);

    log('success', 'Strategy stopped gracefully');

  } catch (error: any) {
    log('error', `Strategy test failed: ${error.message}`);
    throw error;
  }
}

async function step4_checkOrders(wctx: WorkerContext): Promise<void> {
  log('step', 'Step 4: Check Orders (Manual)');

  log('info', 'Please verify in Bybit:');
  log('info', '  1. No unintended orders placed');
  log('info', '  2. No unintended positions opened');
  log('info', '  3. All test orders are within expected range');

  // 获取最近订单
  try {
    const client = wctx.apiPool.get(accountId);  // P1修复：使用环境变量账号
    if (client) {
      const orders = await client.getOrders({ category: 'linear', limit: 10 });
      log('info', `Recent orders: ${orders.length}`);

      for (const order of orders.slice(0, 5)) {
        log('info', `  - ${order.symbol} ${order.side} ${order.qty} @ ${order.price || 'market'}`);
      }
    }
  } catch (error: any) {
    log('warn', `Could not fetch orders: ${error.message}`);
  }
}

// ===== 主函数 =====

async function main() {
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log('║     Quant-Lab Live Account Test                ║');
  console.log(`║     Test Account (${accountId})         ║`);  // P1修复：显示实际账号
  console.log('╚════════════════════════════════════════════════╝\n');

  log('warn', 'This will test with REAL account but MINIMAL size');
  log('warn', 'Make sure:');
  log('warn', '  1. Proxy 8890 is running (Japan IP)');
  log('warn', '  2. Account has 1000 USDT');
  log('warn', '  3. You are monitoring the account\n');

  let wctx: WorkerContext | undefined;

  try {
    // Step 1: 初始化 Worker
    wctx = await step1_initWorker();

    // Step 2: 验证账号
    await step2_verifyAccount(wctx);

    // Step 3: 启动策略测试
    await step3_startStrategy(wctx);

    // Step 4: 检查订单
    await step4_checkOrders(wctx);

    console.log('\n' + '═'.repeat(50));
    log('success', 'Live account test completed!');
    console.log('═'.repeat(50) + '\n');

  } catch (error: any) {
    console.log('\n' + '═'.repeat(50));
    log('error', `Test failed: ${error.message}`);
    console.log('═'.repeat(50) + '\n');
    process.exit(1);

  } finally {
    // 清理
    if (wctx) {
      const { st_worker_exit } = await import('../src/worker/lifecycle');
      await st_worker_exit(wctx, { type: 'test_complete' });
    }
  }
}

// 确认提示
if (process.argv.includes('--yes')) {
  main();
} else {
  console.log('\nRun with --yes to skip confirmation\n');
  console.log('Example: bun tests/live/run.ts --yes\n');
  process.exit(0);
}
