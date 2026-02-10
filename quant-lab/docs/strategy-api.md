# Quant-Lab 策略 API v3.0 - 生命周期驱动

> st_init / st_heartbeat / st_exit 设计

---

## 核心设计

```javascript
/**
 * 策略生命周期
 * 
 * st_init     →  初始化（一次）
 *     ↓
 * st_heartbeat → 循环执行（定时触发）
 *     ↓
 * st_exit     →  清理（一次）
 */
```

---

## 函数签名

```typescript
/**
 * 初始化 - 策略启动时执行一次
 * @param ctx 策略上下文
 * @returns 可选的配置对象
 */
async function st_init(ctx: StrategyContext): Promise<StrategyConfig | void>;

/**
 * 心跳 - 定时执行（核心逻辑）
 * @param ctx 策略上下文
 * @param tick 当前 tick 信息
 */
async function st_heartbeat(ctx: StrategyContext, tick: TickInfo): Promise<void>;

/**
 * 退出 - 策略停止时执行一次
 * @param ctx 策略上下文
 * @param reason 退出原因
 */
async function st_exit(ctx: StrategyContext, reason: ExitReason): Promise<void>;

/**
 * 事件回调 - 订单状态变化（可选）
 * @param ctx 策略上下文
 * @param event 订单事件
 */
async function st_on_order(ctx: StrategyContext, event: OrderEvent): Promise<void>;

/**
 * 事件回调 - 成交（可选）
 * @param ctx 策略上下文
 * @param event 成交事件
 */
async function st_on_trade(ctx: StrategyContext, event: TradeEvent): Promise<void>;

/**
 * 事件回调 - 错误（可选）
 * @param ctx 策略上下文
 * @param error 错误信息
 */
async function st_on_error(ctx: StrategyContext, error: Error): Promise<void>;
```

---

## 上下文对象 (ctx)

```typescript
interface StrategyContext {
  // ===== 策略信息 =====
  strategy: {
    id: string;           // 策略唯一 ID
    name: string;         // 策略名称
    version: string;      // 版本
    params: Record<string, any>;  // 传入参数（st_init 可修改）
  };
  
  // ===== API 客户端（从 st_init 声明）=====
  api: {
    // 声明后自动注入：await ctx.use('bybit', 'wjcgm@bbt')
    bybit?: BybitAPI;
    futu?: FutuAPI;
    // ... 其他 API
  };
  
  // ===== 状态存储（自动持久化）=====
  state: {
    // 读写自动持久化
    get<T>(key: string, defaultValue?: T): T;
    set<T>(key: string, value: T): void;
    delete(key: string): void;
    
    // 批量操作
    load(): Record<string, any>;   // 加载全部
    save(data: Record<string, any>): void;  // 保存全部
  };
  
  // ===== 日志 =====
  log: {
    debug(...args: any[]): void;
    info(...args: any[]): void;
    warn(...args: any[]): void;
    error(...args: any[]): void;
    
    // 带标签的日志
    tag(label: string, ...args: any[]): void;
  };
  
  // ===== 通知 =====
  notify: {
    // 发送通知
    send(message: string, options?: NotifyOptions): void;
    
    // 快捷方式
    telegram(message: string): void;
    email(subject: string, body: string): void;
  };
  
  // ===== 定时器（动态创建）=====
  timer: {
    // 创建一次性定时器
    setTimeout(fn: () => void, ms: number): string;
    
    // 创建周期性定时器
    setInterval(fn: () => void, ms: number): string;
    
    // 取消定时器
    clear(id: string): void;
    
    // 下次执行时间（st_heartbeat 用）
    nextTick: Date;
    intervalMs: number;
  };
  
  // ===== 数据访问 =====
  data: {
    // 获取历史 K 线（从 quant-lib）
    async klines(params: {
      symbol: string;
      interval: string;
      limit?: number;
    }): Promise<Kline[]>;
    
    // 获取实时行情
    async ticker(symbol: string): Promise<Ticker>;
    
    // 订阅实时数据（返回取消函数）
    subscribe(symbol: string, callback: (data: any) => void): () => void;
  };
  
  // ===== 指标计算（从 quant-lib）=====
  indicator: {
    // 函数式指标
    sma(data: number[], period: number): number[];
    ema(data: number[], period: number): number[];
    macd(data: number[], fast: number, slow: number, signal: number): MACDResult;
    rsi(data: number[], period: number): number[];
    bollinger(data: number[], period: number, stdDev: number): BollingerResult;
    atr(high: number[], low: number[], close: number[], period: number): number[];
  };
  
  // ===== 时间 =====
  time: {
    now(): Date;           // 当前时间
    timestamp(): number;   // Unix 毫秒
    format(fmt: string): string;  // 格式化
    sleep(ms: number): Promise<void>;  // 异步等待
  };
}

// Tick 信息（st_heartbeat 参数）
interface TickInfo {
  count: number;          // 第几次执行（从1开始）
  timestamp: number;      // 当前时间戳
  intervalMs: number;     // 心跳间隔
  elapsedMs: number;      // 上次执行耗时
  isFirst: boolean;       // 是否是第一次
  isLast: boolean;        // 是否是最后一次（收到停止信号）
}

// 退出原因
interface ExitReason {
  type: 'manual' | 'error' | 'signal' | 'shutdown';
  message?: string;
  error?: Error;
}

// 订单事件
interface OrderEvent {
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  status: 'pending' | 'filled' | 'partial' | 'canceled' | 'rejected';
  filledQty: number;
  remainingQty: number;
  price?: number;
  timestamp: number;
}

// 成交事件
interface TradeEvent {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  price: number;
  pnl?: number;           // 盈亏（平仓时）
  commission: number;     // 手续费
  timestamp: number;
}
```

---

## 配置声明

```typescript
interface StrategyConfig {
  // 心跳间隔（毫秒）
  // - 0: 只执行一次（st_init 后直接 st_exit）
  // - >0: 周期性执行 st_heartbeat
  heartbeatMs?: number;
  
  // 使用的 API（st_init 中会自动注入 ctx.api）
  apis?: Array<{
    name: 'bybit' | 'futu' | 'binance';
    account?: string;     // 账号 ID（如 'wjcgm@bbt'）
    readonly?: boolean;   // 是否只读（不能下单）
  }>;
  
  // 风控配置
  risk?: {
    maxPositionUsd?: number;      // 最大仓位（美元）
    maxDailyLossUsd?: number;     // 日最大亏损
    maxOrdersPerMinute?: number;  // 每分钟最大订单数
  };
  
  // 日志配置
  log?: {
    level: 'debug' | 'info' | 'warn' | 'error';
  };
}
```

---

## 完整示例：持仓监控策略

```javascript
/**
 * 持仓监控策略
 * 每30分钟查询 Bybit 两个账号的持仓情况
 */

// ===== 1. 初始化 =====
async function st_init(ctx) {
  ctx.log.info('持仓监控策略启动');
  
  // 声明需要的 API
  return {
    heartbeatMs: 30 * 60 * 1000,  // 30分钟
    apis: [
      { name: 'bybit', account: 'wjcgm@bbt', readonly: true },
      { name: 'bybit', account: 'wjcgm@bbt-sub1', readonly: true }
    ],
    log: { level: 'info' }
  };
}

// ===== 2. 心跳（核心逻辑） =====
async function st_heartbeat(ctx, tick) {
  ctx.log.info(`第 ${tick.count} 次执行`);
  
  const accounts = ['wjcgm@bbt', 'wjcgm@bbt-sub1'];
  const results = [];
  
  for (const accountId of accounts) {
    ctx.log.tag('query', `查询账号: ${accountId}`);
    
    try {
      // 从 ctx.api 获取客户端
      const bybit = ctx.api.bybit[accountId];
      
      // 查询持仓和余额
      const [positions, balance] = await Promise.all([
        bybit.getPositions('linear'),
        bybit.getBalance('UNIFIED')
      ]);
      
      // 保存结果
      results.push({
        account: accountId,
        positionCount: positions.length,
        totalEquity: balance.totalEquity,
        positions: positions.map(p => ({
          symbol: p.symbol,
          side: p.side,
          size: p.size,
          pnl: p.unrealizedPnl
        })),
        timestamp: ctx.time.timestamp()
      });
      
      ctx.log.info(`✅ ${accountId}: ${positions.length} 个持仓, 权益 $${balance.totalEquity}`);
      
    } catch (error) {
      ctx.log.error(`❌ ${accountId} 查询失败:`, error.message);
      results.push({
        account: accountId,
        error: error.message,
        timestamp: ctx.time.timestamp()
      });
      
      // 通知告警
      ctx.notify.telegram(`⚠️ 账号 ${accountId} 查询失败: ${error.message}`);
    }
  }
  
  // 保存到状态（自动持久化）
  const history = ctx.state.get('history', []);
  history.push({
    tick: tick.count,
    timestamp: ctx.time.timestamp(),
    results
  });
  
  // 只保留最近100条
  if (history.length > 100) {
    history.shift();
  }
  
  ctx.state.set('history', history);
  ctx.state.set('lastResults', results);
  
  ctx.log.info('本次执行完成，结果已保存');
}

// ===== 3. 退出 =====
async function st_exit(ctx, reason) {
  ctx.log.info('策略退出:', reason.type, reason.message || '');
  
  // 清理资源（如果有）
  ctx.notify.telegram('📴 持仓监控策略已停止');
}

// ===== 4. 错误处理（可选） =====
async function st_on_error(ctx, error) {
  ctx.log.error('策略错误:', error);
  
  // 严重错误通知
  if (error.severity === 'critical') {
    ctx.notify.telegram(`🚨 策略严重错误: ${error.message}`);
  }
}
```

---

## 另一个示例：双均线交易策略

```javascript
/**
 * 双均线策略
 * SMA20 上穿 SMA50 买入，下穿卖出
 */

async function st_init(ctx) {
  // 从参数获取配置
  const symbol = ctx.strategy.params.symbol || 'BTCUSDT';
  const fastPeriod = ctx.strategy.params.fast || 20;
  const slowPeriod = ctx.strategy.params.slow || 50;
  
  ctx.log.info(`双均线策略: ${symbol}, 快线${fastPeriod}, 慢线${slowPeriod}`);
  
  // 初始化状态
  ctx.state.set('symbol', symbol);
  ctx.state.set('fastPeriod', fastPeriod);
  ctx.state.set('slowPeriod', slowPeriod);
  ctx.state.set('position', 0);  // 当前仓位
  ctx.state.set('orders', []);   // 订单记录
  
  return {
    heartbeatMs: 5 * 60 * 1000,  // 5分钟（足够交易）
    apis: [
      { name: 'bybit', account: 'wjcgm@bbt', readonly: false }  // 需要下单权限
    ]
  };
}

async function st_heartbeat(ctx, tick) {
  const symbol = ctx.state.get('symbol');
  const fastPeriod = ctx.state.get('fastPeriod');
  const slowPeriod = ctx.state.get('slowPeriod');
  
  ctx.log.tag('signal', `分析 ${symbol}`);
  
  // 获取 K 线数据
  const klines = await ctx.data.klines({
    symbol,
    interval: '15m',  // 15分钟线
    limit: slowPeriod + 10  // 足够计算 SMA
  });
  
  const closes = klines.map(k => k.close);
  
  // 计算指标
  const smaFast = ctx.indicator.sma(closes, fastPeriod);
  const smaSlow = ctx.indicator.sma(closes, slowPeriod);
  
  const fastCurrent = smaFast[smaFast.length - 1];
  const fastPrev = smaFast[smaFast.length - 2];
  const slowCurrent = smaSlow[smaSlow.length - 1];
  const slowPrev = smaSlow[smaSlow.length - 2];
  
  // 判断信号
  const goldenCross = fastCurrent > slowCurrent && fastPrev <= slowPrev;
  const deathCross = fastCurrent < slowCurrent && fastPrev >= slowPrev;
  
  const position = ctx.state.get('position');
  const bybit = ctx.api.bybit['wjcgm@bbt'];
  
  if (goldenCross && position <= 0) {
    // 金叉买入
    ctx.log.tag('signal', `🟢 金叉买入 ${symbol}`);
    
    const order = await bybit.placeOrder({
      symbol,
      side: 'Buy',
      type: 'Market',
      qty: 0.01  // 或者根据资金计算
    });
    
    ctx.state.set('position', 1);
    ctx.state.get('orders').push(order);
    
    ctx.notify.telegram(`✅ 买入 ${symbol} @ 市价`);
    
  } else if (deathCross && position > 0) {
    // 死叉卖出
    ctx.log.tag('signal', `🔴 死叉卖出 ${symbol}`);
    
    const order = await bybit.placeOrder({
      symbol,
      side: 'Sell',
      type: 'Market',
      qty: 0.01
    });
    
    ctx.state.set('position', 0);
    ctx.state.get('orders').push(order);
    
    ctx.notify.telegram(`✅ 卖出 ${symbol} @ 市价`);
  } else {
    ctx.log.info(`无信号，继续持有 (position=${position})`);
  }
}

async function st_on_order(ctx, event) {
  ctx.log.info(`订单更新: ${event.orderId} - ${event.status}`);
  
  if (event.status === 'filled') {
    ctx.log.tag('fill', `成交: ${event.filledQty} @ ${event.price}`);
  }
}

async function st_exit(ctx, reason) {
  ctx.log.info('双均线策略停止');
  
  // 可选：平仓
  const position = ctx.state.get('position');
  if (position > 0) {
    ctx.log.warn('策略停止时仍有持仓，建议手动处理');
    ctx.notify.telegram('⚠️ 策略停止时仍有持仓！');
  }
}
```

---

## 与 v2 对比

| 特性 | v2 (next驱动) | v3 (heartbeat驱动) | 优势 |
|------|---------------|-------------------|------|
| 执行触发 | K线数据驱动 | 时间驱动 | 更灵活（可不依赖 K 线） |
| 函数名 | `next()` | `st_heartbeat()` | 语义更清晰 |
| API 获取 | `getApi()` | `ctx.api.xxx` | 声明式，自动注入 |
| 状态管理 | 手动读写文件 | `ctx.state.get/set` | 自动持久化 |
| 初始化 | `initialize()` | `st_init()` | 命名统一 |
| 错误处理 | 回调函数 | `st_on_error()` | 统一事件处理 |

---

## 执行器设计（简化版）

```typescript
class StrategyRunner {
  async run(strategyCode: string, params: any): Promise<void> {
    // 1. 创建 ctx
    const ctx = await this.createContext(params);
    
    // 2. 加载策略（假设 strategyCode 是文件路径或代码字符串）
    const strategy = await this.loadStrategy(strategyCode);
    
    // 3. 调用 st_init
    const config = await strategy.st_init(ctx);
    
    // 4. 注入 API
    if (config.apis) {
      for (const api of config.apis) {
        ctx.api[api.name] = await this.createAPIClient(api);
      }
    }
    
    // 5. 设置心跳定时器
    if (config.heartbeatMs > 0) {
      let count = 0;
      const runHeartbeat = async () => {
        count++;
        const tick = {
          count,
          timestamp: Date.now(),
          intervalMs: config.heartbeatMs,
          isFirst: count === 1,
          isLast: false  // 收到停止信号时设为 true
        };
        
        const start = Date.now();
        await strategy.st_heartbeat(ctx, tick);
        tick.elapsedMs = Date.now() - start;
      };
      
      // 立即执行第一次
      await runHeartbeat();
      
      // 设置定时器
      this.timer = setInterval(runHeartbeat, config.heartbeatMs);
    }
    
    // 6. 等待停止信号
    await this.waitForStopSignal();
    
    // 7. 调用 st_exit
    clearInterval(this.timer);
    await strategy.st_exit(ctx, { type: 'manual' });
  }
}
```

---

这个设计够简洁吗？核心就是：
1. **st_init** - 配置和初始化
2. **st_heartbeat** - 循环执行
3. **ctx** - 包含所有需要的 API

其他都是可选的（st_exit, st_on_order, st_on_error...）
