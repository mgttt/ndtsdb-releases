# 量化系统架构摘要

**日期**: 2026-02-12  
**理解程度**: 90%

---

## 1. 三层架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Strategy 层 (策略)                       │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ gales-simple.js │  │ QuickJS 沙箱                     │  │
│  │ - 网格策略逻辑   │  │ - st_init/st_heartbeat/st_stop  │  │
│  │ - P0 熔断修复   │  │ - st_onOrderUpdate (订单回调)    │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                    Engine 层 (引擎)                         │
│  ┌─────────────────┐  ┌─────────────────────────────────┐  │
│  │ BacktestEngine  │  │ LiveEngine                       │  │
│  │ (回测模式)      │  │ (实盘模式)                       │  │
│  │ - 模拟数据回放   │  │ - 连接 Provider                 │  │
│  │ - 虚拟成交      │  │ - 订单管理                       │  │
│  └─────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                   Provider 层 (交易所)                      │
│  ┌───────────────┐ ┌─────────────┐ ┌───────────────────┐   │
│  │ PaperTrading  │ │ Bybit       │ │ Binance           │   │
│  │ (纸交易)      │ │ (实盘)      │ │ (实盘)            │   │
│  │ - 模拟成交     │ │ - REST API  │ │ - REST/WebSocket  │   │
│  │ - 订单轮询     │ │ - 订单推送  │ │ - 订单推送        │   │
│  └───────────────┘ └─────────────┘ └───────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. P0 修复概要

### 2.1 熔断机制 (gales-simple.js)

**位置**: `strategies/gales-simple.js` (lines 59-68, 258-320)

**作用**: 防止单边行情导致巨额亏损

**触发条件**:
- 最大回撤 30% (`maxDrawdown: 0.30`)
- 仓位使用率 90% (`maxPositionRatio: 0.90`)
- 价格偏离中心 50% (`maxPriceDrift: 0.50`)

**行为**: 
1. 触发时撤销所有订单
2. 进入冷却期 10 分钟
3. 冷却结束后恢复交易

```javascript
// 熔断配置
CONFIG.circuitBreaker = {
  enabled: true,
  maxDrawdown: 0.30,
  maxPositionRatio: 0.90,
  maxPriceDrift: 0.50,
  cooldownAfterTrip: 600,  // 秒
};
```

### 2.2 订单轮询 (paper-trading.ts)

**位置**: `src/providers/paper-trading.ts`

**作用**: PaperTrade 模式下模拟订单成交和状态同步

**工作原理**:
```typescript
// 1. 策略通过 bridge_placeOrder() 下单
// 2. PaperTrading 接收订单，加入 openOrders 列表
// 3. 轮询检查价格触达：
for (const order of this.openOrders) {
  if (order.side === 'Buy' && low <= order.price) {
    order.status = 'Filled';  // 模拟成交
    this.notifyStrategy(order);  // 回调 st_onOrderUpdate
  }
}
```

### 2.3 QuickJS 订单回调 (gales-simple.js)

**位置**: `strategies/gales-simple.js` (需要实现 st_onOrderUpdate)

**触发流程**:
```
Provider 订单状态变更
    ↓
LiveEngine/BacktestEngine 接收更新
    ↓
QuickJS Bridge 调用 js 函数
    ↓
st_onOrderUpdate(orderJson) 被触发
    ↓
策略更新内部状态 (positionNotional, openOrders)
```

**示例代码**:
```javascript
function st_onOrderUpdate(orderJson) {
  const order = JSON.parse(orderJson);
  
  // 更新本地订单状态
  const localOrder = state.openOrders.find(o => o.orderId === order.orderId);
  if (localOrder) {
    localOrder.status = order.status;
    localOrder.filledQty = order.filledQty;
  }
  
  // 更新仓位
  if (order.status === 'Filled') {
    updatePosition(order);
  }
  
  saveState();
}
```

---

## 3. 数据流

### 3.1 市场数据 → Engine → Strategy

```
Provider (tick/quote)
    ↓
LiveEngine.onTick(tick)
    ↓
QuickJSBridge.st_heartbeat(JSON.stringify(tick))
    ↓
st_heartbeat(tickJson) { 策略处理 }
```

### 3.2 Strategy 下单 → Provider → 交易所

```
st_heartbeat() 中调用 bridge_placeOrder()
    ↓
LiveEngine.placeOrder()
    ↓
BybitProvider.createOrder()
    ↓
Bybit API (POST /v5/order/create)
    ↓
返回 orderId
```

### 3.3 订单状态 → 回推 → st_onOrderUpdate

```
Bybit WebSocket (order channel)
    ↓
BybitProvider.onOrderUpdate()
    ↓
LiveEngine.emit('orderUpdate', order)
    ↓
QuickJSBridge.st_onOrderUpdate(JSON.stringify(order))
    ↓
st_onOrderUpdate(orderJson) { 策略更新状态 }
```

---

## 4. 关键文件映射

| 功能 | 文件路径 |
|------|----------|
| 策略逻辑 | `strategies/gales-simple.js` |
| 熔断配置 | `strategies/gales-simple.js` (CONFIG.circuitBreaker) |
| 纸交易 Provider | `src/providers/paper-trading.ts` |
| Bybit Provider | `src/providers/bybit.ts` |
| Binance Provider | `src/providers/binance.ts` |
| 回测引擎 | `src/engine/backtest.ts` |
| 实盘引擎 | `src/engine/live.ts` |
| QuickJS 桥接 | `src/sandbox/QuickJSStrategy.ts` |

---

## 5. 问题清单

无关键问题，架构理解清晰。
