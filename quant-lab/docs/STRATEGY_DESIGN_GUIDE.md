# GALES 策略设计指南

**目标读者**: bot-004 及策略开发者  
**版本**: 2026-02-12  
**关联文件**:
- `strategies/gales-simple.js` - 策略示例
- `src/sandbox/QuickJSStrategy.ts` - QuickJS 沙箱实现
- `src/providers/simulated/` - 模拟测试环境

---

## 1. 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    OpenClaw Gateway                         │
│  ┌─────────────────┐    ┌──────────────────────────────┐   │
│  │  CLI / Cron     │    │   QuickJS Strategy Sandbox   │   │
│  │  strategy-cli   │───▶│   ┌──────────────────────┐   │   │
│  └─────────────────┘    │   │  gales-simple.js     │   │   │
│                         │   │  ┌────────────────┐  │   │   │
│  ┌─────────────────┐    │   │  │ CONFIG         │  │   │   │
│  │  ctx.strategy   │───▶│   │  │ ├ symbol       │  │   │   │
│  │  ├ id           │    │   │  │ ├ direction    │  │   │   │
│  │  └ params       │    │   │  │ └ ...          │  │   │   │
│  └─────────────────┘    │   │  └────────────────┘  │   │   │
│                         │   │           ▲          │   │   │
│  ┌─────────────────┐    │   │  ┌────────┴───────┐  │   │   │
│  │  bridge_*       │◀───│   │  │ ctx.strategy   │  │   │   │
│  │  ├ placeOrder   │    │   │  │   .params      │  │   │   │
│  │  ├ cancelOrder  │    │   │  └────────────────┘  │   │   │
│  │  └ stateGet/Set │    │   └──────────────────────┘   │   │
│  └────────┬────────┘    └──────────────────────────────┘   │
│           │                                                 │
│  ┌────────▼────────┐                                       │
│  │  Provider       │                                       │
│  │  ├ Simulated    │                                       │
│  │  ├ PaperTrade   │                                       │
│  │  └ Live         │                                       │
│  └─────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. ctx 详解

### 2.1 注入时机

`ctx` 在策略启动时**一次性注入**到 QuickJS 沙箱的全局命名空间：

```typescript
// QuickJSStrategy.ts (简化)
const ctxHandle = this.ctx.newObject();
const strategyHandle = this.ctx.newObject();
const paramsHandle = this.ctx.newString(JSON.stringify(params));

this.ctx.setProp(strategyHandle, 'id', this.ctx.newString(strategyId));
this.ctx.setProp(strategyHandle, 'params', paramsHandle);
this.ctx.setProp(ctxHandle, 'strategy', strategyHandle);
this.ctx.setProp(this.ctx.global, 'ctx', ctxHandle);
```

### 2.2 数据结构

```javascript
// ctx 对象结构
const ctx = {
  strategy: {
    id: 'gales-live',           // 策略实例唯一标识
    params: {                   // 运行时参数（JSON 可序列化）
      symbol: 'MYXUSDT',
      direction: 'long',
      gridCount: 5,
      gridSpacing: 0.01,
      maxPosition: 100,
      // ... 任意自定义参数
    }
  }
};
```

### 2.3 参数覆盖机制

**优先级**: 代码默认值 < `ctx.params` < 热更新

```javascript
// 1. 代码默认值（行 10-50）
const CONFIG = {
  symbol: 'BTCUSDT',        // 默认值
  gridCount: 5,
  direction: 'neutral',
  // ...
};

// 2. 启动时 ctx.params 覆盖（行 60-85）
if (typeof ctx !== 'undefined' && ctx?.strategy?.params) {
  const p = ctx.strategy.params;
  if (p.symbol) CONFIG.symbol = p.symbol;
  if (p.direction) CONFIG.direction = p.direction;
  // ...
}

// 3. 运行时热更新（通过 st_onParamsUpdate）
function st_onParamsUpdate(newParamsJson) {
  const newParams = JSON.parse(newParamsJson);
  // newParams 来自 OpenClaw 修改后的 ctx.strategy.params
  if (newParams.direction) CONFIG.direction = newParams.direction;
  // ...
}
```

---

## 3. 参数系统设计

### 3.1 参数分类

| 类别 | 示例 | 特性 | 热更新支持 |
|------|------|------|-----------|
| **标识类** | `symbol`, `direction` | 策略身份标识 | ✅ 需重建网格 |
| **网格类** | `gridCount`, `gridSpacing` | 影响网格生成 | ✅ 需重建网格 |
| **风控类** | `maxPosition`, `maxActiveOrders` | 限制系统风险 | ✅ 即时生效 |
| **阈值类** | `magnetDistance`, `cancelDistance` | 触发条件 | ✅ 即时生效 |
| **时间类** | `cooldownSec`, `maxOrderAgeSec` | 时间窗口 | ✅ 即时生效 |
| **开关类** | `autoRecenter`, `hedgeDustFills` | 功能开关 | ✅ 即时生效 |

### 3.2 热更新策略

**类型 A: 即时生效**（无需重建网格）
```javascript
// 修改风控参数
if (newParams.maxPosition !== undefined) {
  CONFIG.maxPosition = newParams.maxPosition;
  // 无需其他操作，下次检查自动生效
}
```

**类型 B: 重建网格**（需重新初始化）
```javascript
// 修改网格参数
if (newParams.gridSpacing !== undefined) {
  CONFIG.gridSpacing = newParams.gridSpacing;
  // 必须重建网格
  initializeGrids();
}
```

**类型 C: 强制重心**（特殊场景）
```javascript
// 立即以当前价格重建网格
if (newParams.forceRecenter) {
  state.centerPrice = state.lastPrice;
  initializeGrids();
}
```

### 3.3 参数验证模式

```javascript
function st_onParamsUpdate(newParamsJson) {
  const newParams = JSON.parse(newParamsJson);
  
  // 1. 验证参数范围
  if (newParams.gridSpacing !== undefined) {
    if (newParams.gridSpacing < 0.001 || newParams.gridSpacing > 0.1) {
      logWarn('gridSpacing 超出安全范围 (0.001-0.1)，拒绝更新');
      return;
    }
    CONFIG.gridSpacing = newParams.gridSpacing;
    logInfo('gridSpacing 更新为: ' + CONFIG.gridSpacing);
  }
  
  // 2. 类型检查
  if (newParams.direction !== undefined) {
    const valid = ['long', 'short', 'neutral'];
    if (!valid.includes(newParams.direction)) {
      logWarn('direction 必须是 long/short/neutral 之一');
      return;
    }
    CONFIG.direction = newParams.direction;
    logInfo('direction 更新为: ' + CONFIG.direction);
  }
  
  // 3. 依赖关系处理
  if (newParams.magnetDistance !== undefined) {
    CONFIG.magnetDistance = newParams.magnetDistance;
    // 确保 magnet < cancel
    if (CONFIG.magnetDistance >= CONFIG.cancelDistance) {
      CONFIG.cancelDistance = CONFIG.magnetDistance * 1.5;
      logInfo('cancelDistance 自动调整为: ' + CONFIG.cancelDistance);
    }
  }
  
  // 4. 重建网格（如必要）
  const needReinit = ['gridCount', 'gridSpacing', 'direction'].some(
    key => newParams[key] !== undefined
  );
  
  if (needReinit && state.initialized) {
    logInfo('重新初始化网格（中心价格: ' + state.lastPrice + '）');
    state.centerPrice = state.lastPrice;
    initializeGrids();
  }
  
  saveState();
}
```

---

## 4. Bridge API 合约

### 4.1 可用函数

| 函数 | 签名 | 用途 | 返回值 |
|------|------|------|--------|
| `bridge_log` | `(level: string, message: string) => void` | 日志输出 | 无 |
| `bridge_stateGet` | `(key: string, defaultValue: string) => string` | 读取持久化状态 | JSON 字符串 |
| `bridge_stateSet` | `(key: string, value: string) => void` | 写入持久化状态 | 无 |
| `bridge_placeOrder` | `(paramsJson: string) => string` | 下单 | Order JSON |
| `bridge_cancelOrder` | `(orderId: string) => void` | 撤单 | 无 |
| `bridge_getPrice` | `(symbol: string) => string` | 获取价格 | Price JSON |

### 4.2 bridge_placeOrder 详解

**请求格式**:
```javascript
const params = {
  symbol: 'MYXUSDT',      // 交易对
  side: 'Buy',            // Buy | Sell
  qty: 1.5,               // 数量
  price: 5.26,            // 限价（可选，默认 Market）
  orderType: 'Limit',     // Limit | Market
  orderLinkId: 'my-id-1'  // 客户端订单 ID（可选，用于追踪）
};

const result = bridge_placeOrder(JSON.stringify(params));
const order = JSON.parse(result);
```

**响应格式**:
```javascript
{
  orderId: 'uuid-from-exchange',    // 交易所订单 ID
  orderLinkId: 'my-id-1',           // 回传客户端 ID
  symbol: 'MYXUSDT',
  side: 'Buy',
  price: 5.26,
  qty: 1.5,
  status: 'New',                    // New | PartiallyFilled | Filled | Canceled
  cumQty: 0,                        // 已成交数量
  avgPrice: 0,                      // 成交均价
  createdAt: 1707654321000          // 创建时间戳
}
```

**错误处理**:
```javascript
try {
  const result = bridge_placeOrder(JSON.stringify(params));
  const order = JSON.parse(result);
  logInfo('下单成功: ' + order.orderId);
} catch (e) {
  logError('下单失败: ' + e.message);
  // 策略自行决定：重试 / 跳过 / 报警
}
```

### 4.3 订单状态流转

```
New ──▶ PartiallyFilled ──▶ Filled
 │           │
 └──▶ Canceled ◀──────────────┘
```

**状态更新方式**:
- **Paper Trade**: 模拟成交，立即更新
- **Live**: WebSocket 推送 → `st_onOrderUpdate`

### 4.4 st_onOrderUpdate 回调

```javascript
function st_onOrderUpdate(orderJson) {
  const order = JSON.parse(orderJson);
  
  // 查找对应网格
  const grid = findGridById(order.gridId);
  if (!grid) return;
  
  // 计算增量成交
  const prevCum = grid.cumQty || 0;
  const delta = order.cumQty - prevCum;
  
  if (delta > 0) {
    // 更新仓位
    updatePositionFromFill(order.side, delta, order.avgPrice);
    logInfo('成交增量: +' + delta + ' @ ' + order.avgPrice);
  }
  
  // 更新网格状态
  if (order.status === 'Filled') {
    grid.state = 'IDLE';
    grid.orderId = undefined;
  }
  
  saveState();
}
```

---

## 5. 状态持久化

### 5.1 持久化策略

**必须持久化**（重启后恢复）:
```javascript
let state = {
  initialized: false,
  centerPrice: 0,           // 网格中心
  positionNotional: 0,      // 当前仓位
  gridLevels: [],           // 网格档位状态
  openOrders: [],           // 活跃订单
  nextGridId: 1,            // 网格 ID 计数器
  tickCount: 0,             // 心跳计数
  lastPlaceTick: 0,         // 上次下单 tick
  lastRecenterAtMs: 0,      // 上次重心时间
};
```

**运行时状态**（不持久化）:
```javascript
let runtime = {
  posLimit: { ... },        // 超限警告状态
  activeOrders: { ... },    // 活跃单上限警告
};
```

### 5.2 存取模式

```javascript
// 保存（心跳末尾或关键操作后）
function saveState() {
  bridge_stateSet('state', JSON.stringify(state));
}

// 加载（st_init 中）
function loadState() {
  try {
    const saved = bridge_stateGet('state', 'null');
    if (saved && saved !== 'null') {
      state = JSON.parse(saved);
      // 兼容性处理：补充新字段
      if (!state.gridLevels) state.gridLevels = [];
      // ...
    }
  } catch (e) {
    logWarn('状态加载失败，使用默认: ' + e);
  }
}
```

---

## 6. 调试技巧

### 6.1 SimulatedProvider 快速迭代

```bash
# 1. 启动模拟测试（秒级验证）
bun tests/run-simulated-strategy.ts ./strategies/my-strategy.js \
  --scenario sine-wave \
  --speed 100 \
  --once

# 2. 观察关键日志
grep -E "(触发网格|成交|重心|错误)" /tmp/sim-test.log

# 3. 修改策略 → 重新运行（循环）
```

### 6.2 单步调试

```javascript
// 在策略中添加断点日志
function st_heartbeat(tickJson) {
  const tick = JSON.parse(tickJson);
  
  // 特定条件断点
  if (tick.price < 100) {
    bridge_log('debug', '[断点] 价格跌破 100: ' + tick.price);
    bridge_log('debug', '[断点] 当前状态: ' + JSON.stringify(state));
  }
  
  // ...
}
```

### 6.3 状态检查

```bash
# 查看持久化状态
cat ~/.openclaw/strategy-state/state | jq .

# 实时监控日志
tail -f ~/logs/gales-live.log | grep -E "(心跳|成交|错误)"
```

### 6.4 常见问题排查

| 现象 | 可能原因 | 排查方法 |
|------|----------|----------|
| 订单不成交 | 价格远离网格 | 检查 `magnetDistance` 和当前价格 |
| 重复挂单 | grid/order 状态不一致 | 检查 `reconcileGridOrderLinks` |
| 热更新不生效 | 未实现 `st_onParamsUpdate` | 确认函数存在且无语法错误 |
| 状态丢失 | 忘记 `saveState()` | 检查关键操作后是否调用 |
| 内存泄漏 | 未释放资源 | QuickJS 沙箱自动管理，通常无需担心 |

---

## 7. 策略模板

### 7.1 最小可运行策略

```javascript
/**
 * 最小策略模板
 */

// 1. 配置
const CONFIG = {
  symbol: 'BTCUSDT',
  param1: 100,
};

// 2. 从 ctx 覆盖
if (typeof ctx !== 'undefined' && ctx?.strategy?.params) {
  const p = ctx.strategy.params;
  if (p.symbol) CONFIG.symbol = p.symbol;
  if (p.param1) CONFIG.param1 = p.param1;
}

// 3. 状态
let state = { counter: 0 };

function loadState() {
  const saved = bridge_stateGet('state', 'null');
  if (saved !== 'null') state = JSON.parse(saved);
}

function saveState() {
  bridge_stateSet('state', JSON.stringify(state));
}

// 4. 生命周期
function st_init() {
  loadState();
  bridge_log('info', '策略初始化完成');
}

function st_heartbeat(tickJson) {
  const tick = JSON.parse(tickJson);
  state.counter++;
  
  bridge_log('info', '心跳 #' + state.counter + ' 价格: ' + tick.price);
  
  saveState();
}

function st_stop() {
  saveState();
  bridge_log('info', '策略停止');
}

// 5. 热更新
function st_onParamsUpdate(newParamsJson) {
  const newParams = JSON.parse(newParamsJson);
  if (newParams.param1 !== undefined) {
    CONFIG.param1 = newParams.param1;
    bridge_log('info', 'param1 更新为: ' + CONFIG.param1);
  }
}
```

### 7.2 完整策略结构

```javascript
/**
 * 完整策略结构（参考 gales-simple.js）
 */

// ================================
// 1. 配置区
// ================================
const CONFIG = { ... };
// ctx 覆盖

// ================================
// 2. 状态区
// ================================
let state = { ... };
let runtime = { ... };

// ================================
// 3. 工具函数
// ================================
function loadState() { ... }
function saveState() { ... }
function logInfo(msg) { ... }

// ================================
// 4. 业务逻辑
// ================================
function initializeGrids() { ... }
function shouldPlaceOrder(grid, distance) { ... }
function placeOrder(grid) { ... }
function cancelOrder(grid) { ... }
function applyActiveOrderPolicy(grid, distance) { ... }

// ================================
// 5. 生命周期
// ================================
function st_init() { ... }
function st_heartbeat(tickJson) { ... }
function st_stop() { ... }
function st_onParamsUpdate(newParamsJson) { ... }
function st_onOrderUpdate(orderJson) { ... }
```

---

## 8. 最佳实践

### 8.1 Do

- ✅ 所有参数从 `ctx.strategy.params` 读取并覆盖
- ✅ 实现 `st_onParamsUpdate` 支持热更新
- ✅ 关键状态持久化（`bridge_stateSet`）
- ✅ 每个 tick 结束时 `saveState()`
- ✅ 使用 `bridge_log` 记录关键决策
- ✅ 防御性编程（检查 undefined、try-catch）

### 8.2 Don't

- ❌ 不要硬编码 API key 或敏感信息
- ❌ 不要在策略中使用 `setTimeout`/`setInterval`（用心跳计数）
- ❌ 不要假设订单一定成交（处理 PartiallyFilled）
- ❌ 不要阻塞心跳（保持单次心跳 < 100ms）
- ❌ 不要频繁读写状态（每次心跳一次即可）

---

## 9. 参考

| 文档 | 路径 | 用途 |
|------|------|------|
| 策略示例 | `strategies/gales-simple.js` | 完整实现参考 |
| 沙箱实现 | `src/sandbox/QuickJSStrategy.ts` | Bridge API 注入 |
| 模拟测试 | `tests/run-simulated-strategy.ts` | 快速迭代环境 |
| 操盘手手册 | `docs/LIVE_TRADING_MANUAL.md` | bot-009 操作指南 |

---

**设计策略时，牢记：参数驱动、状态持久、热更新友好。** 🎯

—— bot-004 (2026-02-12)
