/**
 * 实盘引擎测试：简单双均线策略
 * 
 * 模拟实盘运行（不连接真实交易所）
 */

import { LiveEngine } from '../src/engine/live';
import type { Strategy, StrategyContext, LiveConfig } from '../src/engine/types';
import type { Kline } from 'quant-lib';

/**
 * 简单双均线策略
 */
class SimpleMAStrategy implements Strategy {
  name = 'SimpleMA-Live';
  
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
    ctx.log(`  品种: ${this.symbol}`);
  }
  
  async onBar(bar: Kline, ctx: StrategyContext): Promise<void> {
    // 只处理指定 symbol
    if (bar.symbol !== this.symbol) return;
    
    // 获取历史 K线
    const bars = ctx.getBars(this.symbol, this.slowPeriod + 1);
    if (bars.length < this.slowPeriod + 1) {
      ctx.log(`[${this.name}] 数据不足: ${bars.length}/${this.slowPeriod + 1}`, 'warn');
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
    
    ctx.log(`[${this.name}] Bar: ${new Date(bar.timestamp * 1000).toISOString()}, Close: ${bar.close.toFixed(2)}, FastMA: ${fastMA.toFixed(2)}, SlowMA: ${slowMA.toFixed(2)}`);
    
    // 金叉买入
    if (fastMA > slowMA && prevFastMA <= prevSlowMA && !hasPosition) {
      const quantity = Math.floor(account.balance * 0.95 / bar.close * 100) / 100;
      if (quantity > 0) {
        try {
          await ctx.buy(this.symbol, quantity);
          ctx.log(`[${this.name}] 🚀 金叉买入: ${quantity} @ ${bar.close.toFixed(2)}`);
        } catch (e: any) {
          ctx.log(`[${this.name}] 买入失败: ${e.message}`, 'error');
        }
      }
    }
    
    // 死叉卖出
    if (fastMA < slowMA && prevFastMA >= prevSlowMA && hasPosition) {
      try {
        await ctx.sell(this.symbol, position!.quantity);
        ctx.log(`[${this.name}] 📉 死叉卖出: ${position!.quantity} @ ${bar.close.toFixed(2)}`);
        
        // 显示盈亏
        const pnl = position!.realizedPnl;
        ctx.log(`[${this.name}] 实现盈亏: $${pnl.toFixed(2)}`);
      } catch (e: any) {
        ctx.log(`[${this.name}] 卖出失败: ${e.message}`, 'error');
      }
    }
    
    // 显示账户状态
    if (hasPosition) {
      ctx.log(`[${this.name}] 持仓: ${position!.quantity.toFixed(2)} @ ${position!.entryPrice.toFixed(2)}, 未实现盈亏: $${position!.unrealizedPnl.toFixed(2)}`);
    }
    ctx.log(`[${this.name}] 账户: 余额=$${account.balance.toFixed(2)}, 权益=$${account.equity.toFixed(2)}`);
    ctx.log('');
  }
  
  async onStop(ctx: StrategyContext): Promise<void> {
    ctx.log(`[${this.name}] 策略停止`);
    
    const account = ctx.getAccount();
    ctx.log(`[${this.name}] 最终账户:`);
    ctx.log(`  余额: $${account.balance.toFixed(2)}`);
    ctx.log(`  权益: $${account.equity.toFixed(2)}`);
    ctx.log(`  已实现盈亏: $${account.totalRealizedPnl.toFixed(2)}`);
    ctx.log(`  未实现盈亏: $${account.totalUnrealizedPnl.toFixed(2)}`);
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
// 模拟实盘运行
// ============================================================

console.log('📊 启动实盘引擎测试（模拟模式）\n');

const symbol = 'BTC/USDT';

// 实盘配置
const config: LiveConfig = {
  symbols: [symbol],
  interval: '1d',
  initialBalance: 10000,
  maxPositionSize: 1.0,      // 最大持仓 1 BTC
  maxDrawdown: 0.20,         // 最大回撤 20%
  stopOnError: false,
  // dbPath: './data/ndtsdb',  // 可选：持久化 K线
};

const strategy = new SimpleMAStrategy(symbol);
const engine = new LiveEngine(strategy, config);

// 启动引擎
await engine.start();

// 模拟 K线推送（实际由 WebSocket 推送）
console.log('📊 模拟 K线推送（每 2 秒一根）\n');

// 生成模拟 K线
const startTime = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60; // 30 天前
const oneDay = 24 * 60 * 60;
let basePrice = 40000;

for (let i = 0; i < 30; i++) {
  // 模拟价格波动
  const dailyChange = (Math.random() - 0.5) * 2000;
  const open = basePrice;
  const close = open + dailyChange;
  const high = Math.max(open, close) + Math.random() * 500;
  const low = Math.min(open, close) - Math.random() * 500;
  
  basePrice = close;
  
  const bar: Kline = {
    symbol,
    exchange: 'BINANCE',
    baseCurrency: 'BTC',
    quoteCurrency: 'USDT',
    interval: '1d',
    timestamp: startTime + i * oneDay,
    open,
    high,
    low,
    close,
    volume: 1000 + Math.random() * 500,
    quoteVolume: close * (1000 + Math.random() * 500),
    trades: 100,
    takerBuyVolume: 500,
    takerBuyQuoteVolume: close * 500,
  } as any;
  
  // 推送 K线
  await engine.onKlineUpdate(bar);
  
  // 延迟 2 秒（模拟实时）
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // 检查是否停止
  if (!engine.isRunning()) {
    console.log('⚠️  引擎已停止（触发风控）');
    break;
  }
}

// 停止引擎
await engine.stop();

console.log('\n✅ 实盘引擎测试完成');
