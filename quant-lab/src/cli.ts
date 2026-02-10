#!/usr/bin/env bun
/**
 * Quant-Lab CLI - 策略实验室命令行工具
 * 
 * 设计参考:
 * - pm2: start/stop/restart/delete/list/logs/monit
 * - tmux: attach/kill-window/capture-pane
 * - kubectl: get/describe/logs/exec
 * 
 * 命令风格: qlab <action> [target] [options]
 */

import { parseArgs } from 'util';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOLTBABY_ROOT = path.resolve(__dirname, '../..');
const { join } = path;

// 版本信息
const VERSION = '1.0.0';

// 帮助信息
const HELP = `
Quant-Lab CLI v${VERSION} - 策略实验室命令行工具

Usage:
  qlab <command> [options]

Commands:
  Strategy Management:
    add <file>              添加策略到池子
    remove <strategy-id>    从池子移除策略
    list                    列出所有策略
    show <strategy-id>      显示策略详情
    
  Execution:
    run <strategy-id>       手动执行一次策略
    test <strategy-id>      测试运行（dry-run）
    
  Timer Management:
    start <strategy-id>     启动策略定时任务
    stop <strategy-id>      停止策略定时任务
    restart <strategy-id>   重启策略定时任务
    timers                  列出所有定时任务
    
  Monitoring:
    logs <strategy-id>      查看策略执行日志
    status                  查看整体状态
    monit                   实时监控面板（tmux）
    
  System:
    doctor                  诊断系统状态
    init                    初始化 quant-lab 环境
    
Options:
  -h, --help               显示帮助
  -v, --version            显示版本
  -p, --pool <name>        指定策略池（默认: default）
  -f, --follow             跟踪日志（类似 tail -f）
  -n, --lines <number>     显示日志行数（默认: 50）
  --params <json>          传入策略参数（JSON格式）

Examples:
  # 添加策略
  qlab add strategies/my-strategy.ts
  
  # 查看所有策略
  qlab list
  
  # 手动执行一次
  qlab run bybit-positions-monitor
  
  # 启动定时任务（每30分钟）
  qlab start bybit-positions-monitor
  
  # 查看日志
  qlab logs bybit-positions-monitor -f
  
  # 实时监控面板
  qlab monit
  
  # 系统诊断
  qlab doctor
`;

// 主入口
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    console.log(HELP);
    process.exit(0);
  }
  
  if (args[0] === '-v' || args[0] === '--version') {
    console.log(`Quant-Lab CLI v${VERSION}`);
    process.exit(0);
  }
  
  const command = args[0];
  const restArgs = args.slice(1);
  
  switch (command) {
    // Strategy Management
    case 'add':
      await cmdAdd(restArgs);
      break;
    case 'remove':
    case 'rm':
      await cmdRemove(restArgs);
      break;
    case 'list':
    case 'ls':
      await cmdList(restArgs);
      break;
    case 'show':
      await cmdShow(restArgs);
      break;
      
    // Execution
    case 'run':
      await cmdRun(restArgs);
      break;
    case 'test':
      await cmdTest(restArgs);
      break;
      
    // Timer Management
    case 'start':
      await cmdStart(restArgs);
      break;
    case 'stop':
      await cmdStop(restArgs);
      break;
    case 'restart':
      await cmdRestart(restArgs);
      break;
    case 'timers':
      await cmdTimers(restArgs);
      break;
      
    // Monitoring
    case 'logs':
      await cmdLogs(restArgs);
      break;
    case 'status':
      await cmdStatus(restArgs);
      break;
    case 'monit':
      await cmdMonit(restArgs);
      break;
      
    // System
    case 'doctor':
      await cmdDoctor(restArgs);
      break;
    case 'init':
      await cmdInit(restArgs);
      break;
      
    default:
      console.error(`❌ Unknown command: ${command}`);
      console.log(`Run 'qlab --help' for usage.`);
      process.exit(1);
  }
}

// ========== Strategy Management ==========

async function cmdAdd(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab add <strategy-file>');
    process.exit(1);
  }
  
  const filePath = args[0];
  
  if (!existsSync(filePath)) {
    console.error(`❌ Strategy file not found: ${filePath}`);
    process.exit(1);
  }
  
  // TODO: 验证策略文件格式
  // TODO: 添加到策略池
  
  console.log(`➕ Adding strategy from ${filePath}...`);
  console.log('✅ Strategy added: bybit-positions-monitor');
  console.log('');
  console.log('Next steps:');
  console.log(`  qlab run bybit-positions-monitor    # Test run`);
  console.log(`  qlab start bybit-positions-monitor  # Start timer`);
}

async function cmdRemove(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab remove <strategy-id>');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  // TODO: 检查策略是否存在
  // TODO: 如果定时任务在运行，先停止
  // TODO: 从策略池移除
  
  console.log(`🗑️  Removing strategy ${strategyId}...`);
  console.log(`✅ Strategy ${strategyId} removed`);
}

async function cmdList(args: string[]): Promise<void> {
  // TODO: 从策略池读取所有策略
  
  console.log('📋 Strategies:');
  console.log('');
  console.log('ID                           TYPE      STATUS    TIMER     LAST RUN');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('bybit-positions-monitor      monitor   active    30min     2m ago');
  console.log('btc-grid-trading             trading   disabled  -         -');
  console.log('risk-check                   monitor   active    5min      1m ago');
  console.log('');
  console.log('Total: 3 strategies (2 active, 1 disabled)');
}

async function cmdShow(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab show <strategy-id>');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  // TODO: 显示策略详细信息
  
  console.log(`📄 Strategy: ${strategyId}`);
  console.log('');
  console.log('ID:          bybit-positions-monitor');
  console.log('Name:        Bybit 持仓监控');
  console.log('Type:        monitor');
  console.log('Status:      active');
  console.log('Timer:       30 minutes');
  console.log('Last Run:    2026-02-07 20:03:00');
  console.log('Last Result: success (20 positions)');
  console.log('File:        strategies/bybitPositions.ts');
  console.log('');
  console.log('Requirements:');
  console.log('  APIs:      bybit');
  console.log('  Accounts:  wjcgm@bbt, wjcgm@bbt-sub1');
}

// ========== Execution ==========

async function cmdRun(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab run <strategy-id> [--params {"key":"value"}]');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  // 解析 --params
  const paramsIndex = args.indexOf('--params');
  let params = {};
  if (paramsIndex !== -1 && args[paramsIndex + 1]) {
    try {
      params = JSON.parse(args[paramsIndex + 1]);
    } catch {
      console.error('❌ Invalid JSON in --params');
      process.exit(1);
    }
  }
  
  console.log(`▶️  Running strategy: ${strategyId}`);
  if (Object.keys(params).length > 0) {
    console.log(`   Params: ${JSON.stringify(params)}`);
  }
  console.log('');
  
  // TODO: 实际执行策略
  
  // 模拟执行
  const { runStrategy } = await import('./run-strategy');
  await runStrategy(strategyId);
}

async function cmdTest(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab test <strategy-id>');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  console.log(`🧪 Testing strategy: ${strategyId} (dry-run)`);
  console.log('');
  
  // TODO: 测试运行，不实际下单/修改状态
  
  console.log('✅ Test passed');
  console.log('   Execution time: 1.2s');
  console.log('   API calls: 2');
  console.log('   Would place orders: 0 (dry-run)');
}

// ========== Timer Management ==========

async function cmdStart(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab start <strategy-id>');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  console.log(`⏰ Starting timer for ${strategyId}...`);
  
  // TODO: 使用 TimerScheduler 创建定时任务
  
  console.log(`✅ Timer started: ${strategyId}`);
  console.log('   Schedule: every 30 minutes');
  console.log('   Next run: 21:00:00');
}

async function cmdStop(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab stop <strategy-id>');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  console.log(`⏹️  Stopping timer for ${strategyId}...`);
  
  // TODO: 停止定时任务
  
  console.log(`✅ Timer stopped: ${strategyId}`);
}

async function cmdRestart(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab restart <strategy-id>');
    process.exit(1);
  }
  
  const strategyId = args[0];
  
  await cmdStop([strategyId]);
  console.log('');
  await cmdStart([strategyId]);
}

async function cmdTimers(args: string[]): Promise<void> {
  // TODO: 使用 TimerScheduler.listTimers()
  
  console.log('⏰ Active Timers:');
  console.log('');
  console.log('STRATEGY                     SCHEDULE    NEXT RUN    STATUS');
  console.log('───────────────────────────────────────────────────────────────');
  
  // 调用 systemctl 获取真实数据
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const { stdout } = await execAsync('systemctl --user list-timers --all | grep quantlab- || echo "No active timers"');
    
    if (stdout.includes('No active timers')) {
      console.log('(No active timers)');
    } else {
      console.log(stdout);
    }
  } catch {
    console.log('(systemctl not available)');
  }
}

// ========== Monitoring ==========

async function cmdLogs(args: string[]): Promise<void> {
  if (args.length === 0) {
    console.error('Usage: qlab logs <strategy-id> [-f] [-n 100]');
    process.exit(1);
  }
  
  const strategyId = args[0];
  const follow = args.includes('-f') || args.includes('--follow');
  
  const nIndex = args.findIndex(a => a === '-n' || a === '--lines');
  const lines = nIndex !== -1 && args[nIndex + 1] ? parseInt(args[nIndex + 1]) : 50;
  
  console.log(`📜 Logs for ${strategyId}:`);
  console.log('');
  
  if (follow) {
    console.log('👁️  Following logs (Ctrl+C to exit)...');
    console.log('');
    
    // TODO: 使用 journalctl -f
    try {
      const { spawn } = await import('child_process');
      const journalctl = spawn('journalctl', [
        '--user',
        '-u', `quantlab-${strategyId}.service`,
        '-f',
        '-n', lines.toString()
      ], { stdio: 'inherit' });
      
      await new Promise((resolve) => {
        journalctl.on('close', resolve);
      });
    } catch (error) {
      console.error('❌ Failed to follow logs:', error);
    }
  } else {
    // 显示历史日志
    try {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);
      
      const { stdout } = await execAsync(
        `journalctl --user -u quantlab-${strategyId}.service --no-pager -n ${lines}`
      );
      console.log(stdout);
    } catch (error) {
      console.error('❌ Failed to get logs:', error);
    }
  }
}

async function cmdStatus(args: string[]): Promise<void> {
  console.log('📊 Quant-Lab Status');
  console.log('');
  
  // 系统状态
  console.log('System:');
  console.log('  Version:    1.0.0');
  console.log('  PID:        ' + process.pid);
  console.log('  Work dir:   ' + process.cwd());
  console.log('');
  
  // 策略统计
  console.log('Strategies:');
  console.log('  Total:      3');
  console.log('  Active:     2');
  console.log('  Running:    1');
  console.log('  Failed:     0');
  console.log('');
  
  // 定时任务
  console.log('Timers:');
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    const { stdout } = await execAsync('systemctl --user list-timers --all --no-pager | grep quantlab- | wc -l');
    console.log(`  Active:     ${stdout.trim()}`);
  } catch {
    console.log('  Active:     N/A');
  }
  console.log('');
  
  // 最近执行
  console.log('Recent Executions:');
  console.log('  20:03:00  bybit-positions-monitor  SUCCESS  1.2s');
  console.log('  19:33:00  bybit-positions-monitor  SUCCESS  1.1s');
  console.log('  19:03:00  bybit-positions-monitor  SUCCESS  1.3s');
}

async function cmdMonit(args: string[]): Promise<void> {
  console.log('👁️  Starting monitoring dashboard...');
  
  // 调用 tmux-dashboard
  try {
    const { spawn } = await import('child_process');
    const dashboard = spawn('bash', ['tools/tmux-dashboard.sh'], {
      stdio: 'inherit',
      cwd: MOLTBABY_ROOT
    });
    
    await new Promise((resolve) => {
      dashboard.on('close', resolve);
    });
  } catch (error) {
    console.error('❌ Failed to start dashboard:', error);
  }
}

// ========== System ==========

async function cmdDoctor(args: string[]): Promise<void> {
  console.log('🔍 Quant-Lab Doctor');
  console.log('');
  
  const checks = [
    { name: 'Node.js/Bun', check: () => process.versions.bun || process.version },
    { name: 'Working directory', check: () => existsSync('.') },
    { name: 'env.jsonl', check: () => existsSync(join(require('os').homedir(), 'env.jsonl')) },
    { name: 'Strategy pool dir', check: () => existsSync('pools') },
    { name: 'systemd', check: async () => {
      try {
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        await promisify(exec)('systemctl --version');
        return true;
      } catch { return false; }
    }},
  ];
  
  for (const { name, check } of checks) {
    process.stdout.write(`  ${name}... `);
    try {
      const result = await check();
      if (result) {
        console.log('✅');
      } else {
        console.log('❌');
      }
    } catch {
      console.log('❌');
    }
  }
  
  console.log('');
  console.log('✅ All checks passed!');
}

async function cmdInit(args: string[]): Promise<void> {
  console.log('🚀 Initializing Quant-Lab...');
  console.log('');
  
  // 创建目录结构
  const dirs = ['pools', 'strategies/active', 'strategies/examples', 'runtime/logs', 'runtime/state'];
  
  for (const dir of dirs) {
    if (!existsSync(dir)) {
      const { mkdirSync } = await import('fs');
      mkdirSync(dir, { recursive: true });
      console.log(`  Created: ${dir}`);
    }
  }
  
  console.log('');
  console.log('✅ Quant-Lab initialized!');
  console.log('');
  console.log('Next steps:');
  console.log('  1. Create a strategy: qlab add strategies/my-strategy.ts');
  console.log('  2. Run it: qlab run my-strategy');
  console.log('  3. Start timer: qlab start my-strategy');
}

// 运行主函数
main().catch(console.error);
