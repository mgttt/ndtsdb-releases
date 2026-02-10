/**
 * 回测测试：简单双均线策略
 */

import { BacktestEngine } from '../src/engine/backtest';
import type { Strategy, StrategyContext, BacktestConfig } from '../src/engine/types';
import type { Kline } from 'quant-lib';
import { KlineDatabase } from 'quant-lib';

/**
 * 简单双均线策略
 * - 快线：5 日均线
 * - 慢线：20 日均线
 * - 金叉买入，死叉卖出
 */
class SimpleMAStrategy implements Strategy {
  name = 'SimpleMA';
  
  private fastPeriod = 5;
  private slowPeriod = 20;
  private symbol: string;
  
  constructor(symbol: string) {
    this.symbol = symbol;
  }
  
  async onInit(ctx: StrategyContext): Promise<void> {
    ctx.log(`[${this.name}] 策略初始化`);
    ctx.log(`  快线: MA${this.fastPeriod}`);
    ctx.log(`  慢线: MA${this.slowPeriod}`);
  }
  
  async onBar(bar: Kline, ctx: StrategyContext): Promise<void> {
    // 只处理指定 symbol
    if (bar.symbol !== this.symbol) return;
    
    // 获取历史 K线
    const bars = ctx.getBars(this.symbol, this.slowPeriod + 1);
    if (bars.length < this.slowPeriod + 1) {
      // 数据不足
      return;
    }
    
    // 计算均线
    const closes = bars.map(b => b.close);
    const fastMA = this.sma(closes, this.fastPeriod);
    const slowMA = this.sma(closes, this.slowPeriod);
    
    // 前一根 K线的均线（判断交叉）
    const prevFastMA = this.sma(closes.slice(0, -1), this.fastPeriod);
    const prevSlowMA = this.sma(closes.slice(0, -1), this.slowPeriod);
    
    const account = ctx.getAccount();
    const position = ctx.getPosition(this.symbol);
    const hasPosition = position && position.side === 'LONG' && position.quantity > 0;
    
    // 金叉买入
    if (fastMA > slowMA && prevFastMA <= prevSlowMA && !hasPosition) {
      const quantity = Math.floor(account.balance * 0.95 / bar.close * 100) / 100; // 95% 资金，保留 2 位小数
      if (quantity > 0) {
        try {
          await ctx.buy(this.symbol, quantity);
          ctx.log(`[${this.name}] 金叉买入: ${quantity} @ ${bar.close.toFixed(2)}`);
        } catch (e: any) {
          ctx.log(`[${this.name}] 买入失败: ${e.message}`, 'error');
        }
      }
    }
    
    // 死叉卖出
    if (fastMA < slowMA && prevFastMA >= prevSlowMA && hasPosition) {
      try {
        await ctx.sell(this.symbol, position!.quantity);
        ctx.log(`[${this.name}] 死叉卖出: ${position!.quantity} @ ${bar.close.toFixed(2)}`);
      } catch (e: any) {
        ctx.log(`[${this.name}] 卖出失败: ${e.message}`, 'error');
      }
    }
  }
  
  /**
   * 计算简单移动平均
   */
  private sma(data: number[], period: number): number {
    if (data.length < period) return 0;
    const slice = data.slice(-period);
    const sum = slice.reduce((a, b) => a + b, 0);
    return sum / period;
  }
}

// ============================================================
// 运行回测
// ============================================================

console.log('📊 加载数据库...');

const db = new KlineDatabase({
  path: './data/ndtsdb',
  accessMode: 'READ_ONLY',
});

await db.init();

const symbol = 'BTC/USDT';

console.log('\n📊 检查数据...');

// 检查是否有数据
const latestKline = await db.getLatestKline(symbol, '1d');
if (!latestKline) {
  console.error(`❌ 没有找到 ${symbol} 1d 数据`);
  console.log('请先运行数据采集脚本，或使用以下命令生成测试数据：');
  console.log('  bun run quant-lib/tests/database-v2-test.ts');
  process.exit(1);
}

console.log(`✅ 找到数据: 最新 K线时间 ${new Date(latestKline.timestamp * 1000).toISOString()}`);

// 回测配置
const config: BacktestConfig = {
  initialBalance: 10000,
  symbols: [symbol],
  interval: '1d',
  startTime: latestKline.timestamp - 365 * 24 * 60 * 60, // 最近 1 年
  endTime: latestKline.timestamp,
  commission: 0.001,  // 0.1%
  slippage: 0.0005,   // 0.05%
};

console.log('\n📊 开始回测...\n');

const strategy = new SimpleMAStrategy(symbol);
const engine = new BacktestEngine(db, strategy, config);

const result = await engine.run();

console.log('\n' + '='.repeat(60));
console.log('📊 回测报告');
console.log('='.repeat(60));
console.log(`策略: ${strategy.name}`);
console.log(`品种: ${symbol}`);
console.log(`周期: ${config.interval}`);
console.log(`时间: ${new Date(config.startTime * 1000).toISOString().slice(0, 10)} ~ ${new Date(config.endTime * 1000).toISOString().slice(0, 10)}`);
console.log('');
console.log(`初始资金: $${result.initialBalance.toLocaleString()}`);
console.log(`最终权益: $${result.finalBalance.toLocaleString()}`);
console.log(`总回报: ${(result.totalReturn * 100).toFixed(2)}%`);
console.log(`年化回报: ${(result.annualizedReturn * 100).toFixed(2)}%`);
console.log('');
console.log(`最大回撤: ${(result.maxDrawdown * 100).toFixed(2)}%`);
console.log(`夏普比率: ${result.sharpeRatio.toFixed(2)}`);
console.log('');
console.log(`总交易: ${result.totalTrades}`);
console.log(`胜率: ${(result.winRate * 100).toFixed(2)}%`);
console.log(`胜/负: ${result.winningTrades} / ${result.losingTrades}`);
console.log(`平均盈利: $${result.averageWin.toFixed(2)}`);
console.log(`平均亏损: $${result.averageLoss.toFixed(2)}`);
console.log(`盈亏比: ${result.profitFactor.toFixed(2)}`);
console.log('');

if (result.trades.length > 0) {
  console.log('最近 5 笔交易:');
  const recentTrades = result.trades.slice(-5);
  for (const trade of recentTrades) {
    const pnlSign = trade.pnl > 0 ? '✅' : '❌';
    console.log(`  ${pnlSign} ${trade.side} ${trade.quantity.toFixed(2)} @ ${trade.exitPrice.toFixed(2)} → PnL: $${trade.pnl.toFixed(2)} (${(trade.pnlPercent * 100).toFixed(2)}%)`);
  }
}

console.log('\n' + '='.repeat(60));

await db.close();
