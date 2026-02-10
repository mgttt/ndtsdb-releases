# Quant-Lab 策略 API 设计 v2.0

> 参考 Backtrader、QuantConnect LEAN、Zipline 最佳实践

---

## 设计原则

1. **事件驱动** - 回调函数处理市场事件、订单事件
2. **状态隔离** - `context` 对象保存策略状态（类似 Zipline）
3. **数据流式** - `next()` 每根 K 线触发（类似 Backtrader）
4. **声明式配置** - `initialize()` 定义参数和订阅
5. **类型安全** - TypeScript 风格接口

---

## 核心架构

```
┌─────────────────────────────────────────────────────────────┐
│                        Strategy                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ initialize  │→ │    next     │→ │   notify_order      │  │
│  │  (配置)      │  │  (主逻辑)    │  │   (订单回调)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│         ↓                ↓                  ↓               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  context    │  │  data feeds │  │    portfolio        │  │
│  │ (状态持久化) │  │  (行情数据)  │  │    (账户信息)        │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 策略生命周期

```javascript
// 1. 初始化（只执行一次）
async function initialize(context) {
  // 设置参数、订阅数据、初始化指标
}

// 2. 数据预热（历史数据填充指标）
async function warmup(context, data) {
  // 预热期间不交易，只更新指标
}

// 3. 主循环（每根 K 线执行）
async function next(context, data) {
  // 交易逻辑
}

// 4. 订单回调（订单状态变化）
async function notify_order(context, order) {
  // 处理订单成交/取消/失败
}

// 5. 成交回调（交易完成）
async function notify_trade(context, trade) {
  // 处理交易完成，更新统计
}
```

---

## 全局对象

### `context` - 策略上下文（自动持久化）

```typescript
interface Context {
  // 策略信息（只读）
  strategy: {
    id: string;           // 策略 ID
    name: string;         // 策略名称
    version: string;      // 版本
    params: Record<string, any>;  // 传入参数
  };
  
  // 账户信息（自动更新）
  portfolio: {
    cash: number;         // 可用现金
    equity: number;       // 总权益
    margin: number;       // 已用保证金
    positions: Position[]; // 持仓列表
    orders: Order[];      // 活跃订单
  };
  
  // 用户自定义状态（自动持久化）
  state: Record<string, any>;
  
  // 运行时统计
  stats: {
    startTime: string;    // 启动时间
    barCount: number;     // 已处理 K 线数
    tradeCount: number;   // 成交次数
    lastRunAt: string;    // 最后运行时间
  };
}

interface Position {
  symbol: string;         // 交易对
  size: number;           // 数量（正多/负空）
  avgPrice: number;       // 平均成本
  unrealizedPnl: number;  // 未实现盈亏
  leverage: number;       // 杠杆倍数
}

interface Order {
  id: string;             // 订单 ID
  symbol: string;         // 交易对
  side: 'buy' | 'sell';   // 方向
  type: 'market' | 'limit' | 'stop' | 'stop_limit';  // 类型
  size: number;           // 数量
  price?: number;         // 价格（限价单）
  stopPrice?: number;     // 触发价（止损单）
  status: 'pending' | 'open' | 'filled' | 'canceled' | 'rejected';
  filled: number;         // 已成交数量
  remaining: number;      // 剩余数量
  createdAt: string;      // 创建时间
}

interface Trade {
  id: string;             // 交易 ID
  orderId: string;        // 关联订单 ID
  symbol: string;         // 交易对
  side: 'buy' | 'sell';   // 方向
  size: number;           // 数量
  price: number;          // 成交价
  pnl?: number;           // 盈亏（平仓时）
  commission: number;     // 手续费
  timestamp: string;      // 成交时间
}
```

---

## 数据接口

### `data` - 行情数据

```typescript
interface DataFeed {
  // 基本信息
  symbol: string;         // 交易对，如 "BTCUSDT"
  timeframe: string;      // 周期，如 "1m", "5m", "1h", "1d"
  
  // OHLCV（当前 K 线）
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  
  // 时间
  timestamp: number;      // 毫秒时间戳
  datetime: string;       // ISO 格式
  
  // 历史数据访问
  history: {
    // 获取 N 根前的数据
    get(offset: number): OHLCV | null;
    
    // 获取最近 N 根
    recent(n: number): OHLCV[];
    
    // 获取范围
    range(start: number, end: number): OHLCV[];
    
    // 长度
    length: number;
  };
}

interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}
```

---

## 交易接口

### 订单操作

```javascript
// 市价单
await buy(context, symbol, size, { 
  comment: '开仓做多' 
});

await sell(context, symbol, size, { 
  comment: '平仓' 
});

// 限价单
await limit_buy(context, symbol, size, price, {
  timeInForce: 'GTC',  // GTC/IOC/FOK
  comment: '抄底'
});

await limit_sell(context, symbol, size, price, {
  timeInForce: 'GTC',
  comment: '止盈'
});

// 止损单（触发后变市价）
await stop_buy(context, symbol, size, stopPrice, {
  comment: '突破追涨'
});

await stop_sell(context, symbol, size, stopPrice, {
  comment: '止损'
});

// 止盈止损单（触发后变限价）
await stop_limit_buy(context, symbol, size, stopPrice, limitPrice);
await stop_limit_sell(context, symbol, size, stopPrice, limitPrice);

// 批量订单
await order(context, {
  symbol: 'BTCUSDT',
  side: 'buy',
  type: 'limit',
  size: 0.1,
  price: 40000,
  params: {
    timeInForce: 'GTC',
    postOnly: true,      // 只做 maker
    reduceOnly: false,    // 只减仓
  }
});

// 取消订单
await cancel(context, orderId);
await cancel_all(context, symbol);

// 修改订单
await modify(context, orderId, {
  price: 41000,
  size: 0.2,
});
```

### 仓位操作（简化版）

```javascript
// 目标仓位模式（推荐）
await target_position(context, 'BTCUSDT', 0.5, {
  // 目标仓位 = 0.5 BTC
  // 系统自动计算需要买/卖多少
  comment: '调仓至0.5BTC'
});

// 平仓
await close_position(context, 'BTCUSDT', {
  comment: '全部平仓'
});

// 仓位对冲
await hedge(context, 'BTCUSDT', 0.3);  // 对冲30%风险
```

---

## 指标系统

### 内置指标

```javascript
// 在 initialize 中声明指标
async function initialize(context) {
  // 简单移动平均
  context.sma20 = indicator.sma({ period: 20 });
  context.sma50 = indicator.sma({ period: 50 });
  
  // 指数移动平均
  context.ema12 = indicator.ema({ period: 12 });
  context.ema26 = indicator.ema({ period: 26 });
  
  // MACD
  context.macd = indicator.macd({ 
    fast: 12, 
    slow: 26, 
    signal: 9 
  });
  
  // RSI
  context.rsi = indicator.rsi({ period: 14 });
  
  // 布林带
  context.bbands = indicator.bollinger({ 
    period: 20, 
    stdDev: 2 
  });
  
  // ATR（真实波动幅度）
  context.atr = indicator.atr({ period: 14 });
  
  // 自定义指标
  context.custom = indicator.custom({
    name: 'my_indicator',
    calc: (data) => {
      return data.close * 2;
    }
  });
}

// 在 next 中使用
async function next(context, data) {
  const sma20 = context.sma20.value;      // 当前 SMA20 值
  const sma20_prev = context.sma20.prev;  // 上一根 SMA20 值
  
  // MACD
  const macd_line = context.macd.macd;
  const signal_line = context.macd.signal;
  const histogram = context.macd.histogram;
  
  // 检查金叉
  if (macd_line > signal_line && context.macd.prev.macd <= context.macd.prev.signal) {
    log('MACD 金叉');
  }
}
```

### 指标接口

```typescript
interface Indicator<T = number> {
  // 当前值
  value: T;
  
  // 上一根值
  prev: T;
  
  // 历史值
  history: T[];
  
  // 更新（自动调用）
  update(ohlcv: OHLCV): void;
  
  // 是否已初始化（有足够的 bars）
  isReady: boolean;
}
```

---

## 风险管理

### 风控规则

```javascript
async function initialize(context) {
  // 设置风控参数
  context.risk = {
    // 最大仓位（占总权益比例）
    maxPositionRatio: 0.9,
    
    // 单标的最大仓位
    maxPositionPerSymbol: 0.5,
    
    // 最大杠杆
    maxLeverage: 10,
    
    // 单笔最大亏损（占权益比例）
    maxLossPerTrade: 0.02,
    
    // 日最大亏损
    maxDailyLoss: 0.1,
    
    // 回撤止损
    maxDrawdown: 0.2,
    
    // 强制平仓线
    liquidationBuffer: 0.1,
  };
}

// 风控回调
async function on_risk_trigger(context, event) {
  log('风控触发:', event.type, event.message);
  
  switch (event.type) {
    case 'max_position':
      // 仓位超限
      await close_position(context, event.symbol);
      break;
      
    case 'max_drawdown':
      // 回撤超限，全部平仓
      await close_all_positions(context);
      notify('回撤超限，全部平仓');
      break;
      
    case 'liquidation_warning':
      // 即将爆仓警告
      notify('爆仓警告！请立即处理');
      break;
  }
}
```

---

## 事件通知

### 系统事件

```javascript
// 策略启动
async function on_start(context) {
  log('策略启动:', context.strategy.name);
  notify(`策略 ${context.strategy.name} 已启动`);
}

// 策略停止
async function on_stop(context) {
  log('策略停止');
  
  // 清理工作
  await cancel_all_orders(context);
  
  notify(`策略 ${context.strategy.name} 已停止`);
}

// 错误处理
async function on_error(context, error) {
  log.error('策略错误:', error.message);
  
  // 严重错误时通知
  if (error.severity === 'critical') {
    notify('策略严重错误: ' + error.message);
  }
}

// 定时任务（替代 setInterval）
async function on_schedule(context, event) {
  // 每 5 分钟执行一次（在 initialize 中配置）
  if (event.type === '5m') {
    await check_positions(context);
  }
}
```

---

## 日志与通知

```javascript
// 日志级别
log.debug('调试信息');     // 详细调试
c.log.info('普通信息');      // 一般信息
c.log.warn('警告');        // 警告
log.error('错误');         // 错误

// 带标签的日志
log.tag('signal', '买入信号触发');
log.tag('risk', '仓位接近上限');

// 结构化日志
log.metric('pnl', context.portfolio.equity - context.portfolio.initialEquity);
log.metric('sharpe', calculate_sharpe(context));

// 通知
notify('重要事件');                      // 普通通知
notify.urgent('紧急事件');               // 紧急通知
notify.telegram('Telegram 消息');        // 指定渠道
```

---

## 完整示例：双均线策略

```javascript
/**
 * 双均线交叉策略（Golden Cross / Death Cross）
 * 
 * 规则：
 * - SMA20 上穿 SMA50，买入
 * - SMA20 下穿 SMA50，卖出
 * - 固定止损 2%
 */

// 1. 初始化
async function initialize(context) {
  // 策略参数
  context.params = {
    fastPeriod: 20,       // 快均线周期
    slowPeriod: 50,       // 慢均线周期
    symbol: 'BTCUSDT',    // 交易对
    size: 0.1,            // 每次交易数量
    stopLoss: 0.02,       // 止损比例 2%
  };
  
  // 初始化指标
  context.smaFast = indicator.sma({ period: context.params.fastPeriod });
  context.smaSlow = indicator.sma({ period: context.params.slowPeriod });
  context.atr = indicator.atr({ period: 14 });
  
  // 风控设置
  context.risk = {
    maxPositionRatio: 0.8,
    maxLossPerTrade: 0.02,
  };
  
  log('策略初始化完成:', context.strategy.name);
}

// 2. 数据预热
async function warmup(context, data) {
  // 预热期间更新指标但不交易
  context.smaFast.update(data);
  context.smaSlow.update(data);
  
  if (context.smaFast.isReady && context.smaSlow.isReady) {
    log('指标预热完成');
  }
}

// 3. 主交易逻辑
async function next(context, data) {
  const { symbol, size, stopLoss } = context.params;
  const fast = context.smaFast.value;
  const slow = context.smaSlow.value;
  const fastPrev = context.smaFast.prev;
  const slowPrev = context.smaSlow.prev;
  
  // 获取当前持仓
  const position = get_position(context, symbol);
  const hasPosition = position && position.size > 0;
  
  // 金叉：快线上穿慢线
  const goldenCross = fast > slow && fastPrev <= slowPrev;
  
  // 死叉：快线下穿慢线
  const deathCross = fast < slow && fastPrev >= slowPrev;
  
  if (goldenCross && !hasPosition) {
    // 买入信号
    log.tag('signal', `金叉买入 ${symbol} @ ${data.close}`);
    
    const order = await buy(context, symbol, size, {
      comment: '金叉买入'
    });
    
    // 设置止损
    const stopPrice = data.close * (1 - stopLoss);
    await stop_sell(context, symbol, size, stopPrice, {
      comment: '固定止损'
    });
    
  } else if (deathCross && hasPosition) {
    // 卖出信号
    log.tag('signal', `死叉卖出 ${symbol} @ ${data.close}`);
    
    // 取消止损单
    await cancel_all(context, symbol);
    
    // 市价平仓
    await close_position(context, symbol, {
      comment: '死叉卖出'
    });
  }
  
  // 记录指标值
  log.metric('sma_spread', fast - slow);
}

// 4. 订单回调
async function notify_order(context, order) {
  if (order.status === 'filled') {
    log(`订单成交: ${order.side} ${order.filled} @ ${order.price}`);
    
    // 更新统计
    context.stats.tradeCount++;
    
  } else if (order.status === 'rejected') {
    log.error('订单被拒绝:', order.rejectReason);
  }
}

// 5. 交易回调
async function notify_trade(context, trade) {
  const pnl = trade.pnl || 0;
  const emoji = pnl > 0 ? '✅' : pnl < 0 ? '❌' : '➖';
  
  log(`${emoji} 交易完成: ${trade.side} ${trade.size} @ ${trade.price}, PnL: ${pnl.toFixed(2)}`);
  
  // 发送通知
  if (Math.abs(pnl) > 100) {
    notify(`大额交易: ${trade.symbol} PnL ${pnl.toFixed(2)}`);
  }
}
```

---

## 多标的同时交易

```javascript
async function initialize(context) {
  // 订阅多个交易对
  context.symbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
  
  // 为每个标的创建指标
  for (const symbol of context.symbols) {
    context[`rsi_${symbol}`] = indicator.rsi({ period: 14, symbol });
  }
}

async function next(context, data) {
  // data.symbol 表示当前是哪个标的的 K 线
  const symbol = data.symbol;
  const rsi = context[`rsi_${symbol}`].value;
  
  if (rsi < 30) {
    await buy(context, symbol, 0.1, { comment: 'RSI超卖' });
  } else if (rsi > 70) {
    await sell(context, symbol, 0.1, { comment: 'RSI超买' });
  }
}
```

---

## 网格策略示例

```javascript
async function initialize(context) {
  context.params = {
    symbol: 'BTCUSDT',
    upperPrice: 50000,    // 网格上界
    lowerPrice: 30000,    // 网格下界
    gridCount: 10,        // 网格数量
    gridAmount: 0.01,     // 每格数量
  };
  
  // 计算网格线
  const { upperPrice, lowerPrice, gridCount } = context.params;
  const step = (upperPrice - lowerPrice) / gridCount;
  context.grids = [];
  
  for (let i = 0; i <= gridCount; i++) {
    context.grids.push(lowerPrice + step * i);
  }
  
  // 初始化订单状态
  context.state.gridOrders = {};  // 每个网格的订单 ID
}

async function next(context, data) {
  const { symbol, gridAmount } = context.params;
  const price = data.close;
  
  // 找到最近的网格
  for (let i = 0; i < context.grids.length - 1; i++) {
    const lower = context.grids[i];
    const upper = context.grids[i + 1];
    
    if (price >= lower && price < upper) {
      const gridKey = `grid_${i}`;
      
      // 如果当前网格没有买单，挂买入限价单
      if (!context.state.gridOrders[gridKey]) {
        const order = await limit_buy(context, symbol, gridAmount, lower, {
          comment: `网格${i}买入`
        });
        context.state.gridOrders[gridKey] = order.id;
      }
      
      // 如果上一个网格有买单成交，挂卖出单
      if (i > 0) {
        const prevGridKey = `grid_${i-1}`;
        // ... 检查并挂卖单
      }
    }
  }
}
```

---

## 待实现 API 清单

- [ ] `context` 完整实现（自动持久化）
- [ ] `data` 多周期数据（1m, 5m, 1h, 1d）
- [ ] `indicator.*` 指标库（SMA, EMA, MACD, RSI, Bollinger, ATR）
- [ ] `buy/sell/limit_buy/limit_sell` 交易接口
- [ ] `target_position` 目标仓位模式
- [ ] `notify_order/notify_trade` 事件回调
- [ ] `risk` 风控系统
- [ ] `notify` 通知系统
- [ ] `log.metric` 结构化日志

---

## 参考资源

- **Backtrader**: https://www.backtrader.com/docu/
- **QuantConnect LEAN**: https://www.quantconnect.com/docs/v2/writing-algorithms
- **Zipline**: https://zipline.ml4trading.io/
- **vn.py**: https://www.vnpy.com/docs/cn/quickstart.html

---

**版本**: v2.0  
**日期**: 2026-02-07  
**设计**: OpenClaw 🦀
