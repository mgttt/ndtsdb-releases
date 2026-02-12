# [ARCHIVED] three-layer-with-quickjs

> **归档日期**: 2026-02-11
> **原因**: 设计已迭代/功能已实现/方案已废弃
> **最新状态见**: README.md / DESIGN.md / ROADMAP.md

---

# Quant-Lab 三层架构 v3.1 - 含 QuickJS 沙箱

> workerpool 基建 | st-worker (Node.js) | QuickJS 沙箱 (策略 JS)

---

## 关键修正

**之前遗漏：策略JS在 QuickJS 沙箱里运行，不是直接 Node.js！**

```
Worker (Node.js/Bun 进程)
    ├── st_worker_init/heartbeat/exit  ← TypeScript
    └── QuickJSContext  ← 沙箱
            └── 策略 JS (st_init/heartbeat/exit)
                    └── ctx.api.xxx (桥接调用)
                            └── Worker 的 API 客户端
```

---

## 完整架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: QuickJS 沙箱 (隔离环境)                            │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  策略 JS (用户代码)                                  │   │
│  │  ├── st_init(ctx)           ← 初始化                 │   │
│  │  ├── st_heartbeat(ctx, tick) ← 业务逻辑              │   │
│  │  └── st_exit(ctx, reason)    ← 清理                  │   │
│  │                                                      │   │
│  │  ctx 对象 (沙箱内):                                   │   │
│  │  ├── ctx.state.get/set     ← 状态读写                │   │
│  │  ├── ctx.api.bybit.xxx     ← API调用 (桥接到Worker)  │   │
│  │  ├── ctx.log.info          ← 日志 (桥接到Worker)      │   │
│  │  └── ctx.indicator.sma     ← 指标计算 (沙箱内纯函数)  │   │
│  └─────────────────────────────────────────────────────┘   │
│              ↑                                             │
│              │ QuickJS 上下文桥接                            │
│              ↓                                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: st-worker (Node.js 进程)                          │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Worker 生命周期 (TypeScript)                        │   │
│  │  ├── st_worker_init(wctx)                           │   │
│  │  ├── st_worker_heartbeat(wctx, tick)                │   │
│  │  └── st_worker_exit(wctx, reason)                   │   │
│  │                                                      │   │
│  │  QuickJSContext 管理:                               │   │
│  │  ├── createContext()        ← 创建沙箱             │   │
│  │  ├── injectAPI()            ← 注入桥接函数          │   │
│  │  ├── evalStrategy()         ← 执行策略代码          │   │
│  │  └── destroyContext()       ← 销毁沙箱             │   │
│  │                                                      │   │
│  │  API 桥接函数 (宿主导出给沙箱):                      │   │
│  │  ├── bridge_getPositions()  ← 调用真实API           │   │
│  │  ├── bridge_placeOrder()    ← 调用真实API           │   │
│  │  ├── bridge_logInfo()       ← 转发日志              │   │
│  │  └── bridge_stateGet/Set()  ← 状态同步              │   │
│  │                                                      │   │
│  │  预加载 API 客户端:                                   │   │
│  │  ├── wctx.apis.set('wjcgm@bbt-sub1', bybitClient)   │   │
│  │  └── 供桥接函数使用                                   │   │
│  └─────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: workerpool 基建                                   │
│  ├── Engine: 任务调度                                        │
│  ├── Resource<WorkerSpec>: Worker 注册                       │
│  ├── Work<StrategySpec>: 策略任务                            │
│  ├── FileLock: 分布式锁                                      │
│  └── FileStore: 状态存储                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键设计：沙箱桥接

### 1. Worker 创建 QuickJS 上下文

```typescript
// Worker (Node.js)
import { QuickJSContext } from './quickjs/QuickJSContext';

async function startStrategy(wctx: WorkerContext, work: Work) {
  const { strategyId, strategyCode } = work.payload;
  
  // 1. 创建 QuickJS 沙箱
  const qjs = new QuickJSContext({
    timeoutMs: 60000,       // 策略执行超时
    memoryLimitMB: 64,      // 内存限制
  });
  
  // 2. 注入桥接函数
  injectBridgeFunctions(qjs, wctx, strategyId);
  
  // 3. 执行策略代码
  await qjs.eval(strategyCode);
  
  // 4. 调用 st_init
  const config = await qjs.call('st_init', [createContextProxy(qjs)]);
  
  // 5. 保存 QuickJS 上下文
  wctx.strategies.set(strategyId, {
    id: strategyId,
    qjs,  // 保存引用
    status: 'running',
    lastHeartbeat: Date.now(),
  });
}
```

---

### 2. 注入桥接函数

```typescript
function injectBridgeFunctions(
  qjs: QuickJSContext, 
  wctx: WorkerContext,
  strategyId: string
) {
  const api = wctx.apis.get('wjcgm@bbt-sub1');  // 预加载的API
  
  // ===== API 桥接 =====
  
  // 桥接: ctx.api.bybit.getPositions()
  qjs.inject('bridge_getPositions', async (category: string) => {
    const positions = await api.getPositions(category);
    return JSON.stringify(positions);  // 序列化传给沙箱
  });
  
  // 桥接: ctx.api.bybit.placeOrder()
  qjs.inject('bridge_placeOrder', async (params: string) => {
    const orderParams = JSON.parse(params);
    const result = await api.placeOrder(orderParams);
    return JSON.stringify(result);
  });
  
  // ===== 日志桥接 =====
  
  qjs.inject('bridge_logInfo', (...args: any[]) => {
    wctx.log.info(`[${strategyId}]`, ...args);
  });
  
  qjs.inject('bridge_logError', (...args: any[]) => {
    wctx.log.error(`[${strategyId}]`, ...args);
  });
  
  // ===== 状态桥接 =====
  
  // 策略状态存在 Worker，同步到沙箱
  const state = new Map();
  
  qjs.inject('bridge_stateGet', (key: string, defaultValue?: string) => {
    const value = state.get(key);
    return value !== undefined ? value : defaultValue;
  });
  
  qjs.inject('bridge_stateSet', (key: string, value: string) => {
    state.set(key, value);
    // 同步到 Worker 的 state，再持久化
    wctx.syncState(strategyId, key, value);
  });
  
  // ===== 通知桥接 =====
  
  qjs.inject('bridge_notifyTelegram', (message: string) => {
    wctx.notify.telegram(`[${strategyId}] ${message}`);
  });
}
```

---

### 3. 策略 JS 中使用桥接

```javascript
// 策略 JS (在 QuickJS 沙箱里运行)

// 沙箱内的 ctx 对象 (由 Worker 创建)
const ctx = {
  strategy: {
    id: 'grid-btc-001',
    params: { ... }
  },
  
  // 状态 (桥接到 Worker)
  state: {
    get(key, defaultValue) {
      return JSON.parse(bridge_stateGet(key, JSON.stringify(defaultValue)));
    },
    set(key, value) {
      bridge_stateSet(key, JSON.stringify(value));
    }
  },
  
  // API (桥接到 Worker)
  api: {
    bybit: {
      async getPositions(category) {
        const result = await bridge_getPositions(category);
        return JSON.parse(result);
      },
      async placeOrder(params) {
        const result = await bridge_placeOrder(JSON.stringify(params));
        return JSON.parse(result);
      }
    }
  },
  
  // 日志 (桥接到 Worker)
  log: {
    info: bridge_logInfo,
    error: bridge_logError,
  },
  
  // 通知 (桥接到 Worker)
  notify: {
    telegram: bridge_notifyTelegram,
  },
  
  // 指标 (沙箱内纯函数，不桥接)
  indicator: {
    sma: (data, period) => { /* 纯函数实现 */ },
    macd: (data, fast, slow, signal) => { /* 纯函数实现 */ },
  }
};

// ===== 策略生命周期函数 =====

async function st_init() {
  ctx.log.info('策略初始化');
  
  // 通过桥接调用真实 API
  const positions = await ctx.api.bybit.getPositions('linear');
  ctx.log.info('当前持仓:', positions.length);
  
  // 通过桥接保存状态
  ctx.state.set('positions', positions);
  
  return {
    heartbeatMs: 60000
  };
}

async function st_heartbeat(tick) {
  ctx.log.info(`心跳 ${tick.count}`);
  
  // 调用 API
  const ticker = await ctx.api.bybit.getTicker('BTCUSDT');
  
  // 计算指标 (沙箱内)
  const data = [/* 价格数组 */];
  const sma20 = ctx.indicator.sma(data, 20);
  
  // 交易逻辑
  if (shouldBuy(sma20)) {
    await ctx.api.bybit.placeOrder({
      symbol: 'BTCUSDT',
      side: 'Buy',
      qty: '0.01'
    });
    
    ctx.notify.telegram('买入 BTCUSDT');
  }
}

async function st_exit(reason) {
  ctx.log.info('策略退出:', reason.type);
}
```

---

### 4. Worker 心跳管理沙箱

```typescript
export async function st_worker_heartbeat(wctx: WorkerContext, tick: TickInfo) {
  for (const [strategyId, info] of wctx.strategies) {
    if (info.status !== 'running') continue;
    
    try {
      // 调用沙箱内的 st_heartbeat
      const tickInfo = {
        count: tick.count,
        timestamp: Date.now(),
      };
      
      await info.qjs.call('st_heartbeat', [tickInfo]);
      
      info.lastHeartbeat = Date.now();
      info.errorCount = 0;
      
    } catch (error) {
      // 策略执行错误
      info.errorCount++;
      wctx.log.error(`策略 ${strategyId} 错误:`, error);
      
      if (info.errorCount > 5) {
        // 重启策略
        await restartStrategy(wctx, strategyId);
      }
    }
  }
}
```

---

## 序列图

```
Worker                      QuickJS 沙箱                    真实世界
  │                              │                              │
  ├─ createContext() ───────────>│                              │
  ├─ injectAPI() ───────────────>│                              │
  ├─ eval(strategyCode) ────────>│                              │
  ├─ call('st_init') ───────────>│                              │
  │                              ├─ ctx.api.getPositions() ─────>│
  │                              │                              ├─ Bybit API
  │                              │<─────────────────────────────┤
  │<─────────────────────────────┤                              │
  │                              │                              │
  ├─ call('st_heartbeat') ──────>│                              │
  │                              ├─ ctx.api.placeOrder() ──────>│
  │                              │                              ├─ Bybit API
  │                              │<─────────────────────────────┤
  │<─────────────────────────────┤                              │
```

---

## 文件结构

```
quant-lab/src/
├── worker/                          # st-worker (Node.js)
│   ├── types.ts                     # WorkerContext
│   ├── worker-lifecycle.ts          # st_worker_init/heartbeat/exit
│   ├── strategy-sandbox.ts          # 管理 QuickJS 沙箱
│   ├── bridge-functions.ts          # 桥接函数注入
│   └── api-pool.ts                  # API 客户端池
│
├── quickjs/                         # QuickJS 封装
│   ├── QuickJSContext.ts            # 沙箱上下文管理
│   ├── promise-bridge.ts            # Promise 桥接
│   └── inject-host-functions.ts     # 宿主导出函数
│
├── strategy/                        # 策略相关
│   ├── types.ts                     # StrategyContext (沙箱内)
│   └── indicators.ts                # 沙箱内指标计算
│
└── index.ts
```

---

## 关键实现点

### 1. Promise 桥接

QuickJS 是同步的，需要桥接异步 API：

```typescript
// 宿主导出异步函数
qjs.inject('bridge_asyncCall', async (params) => {
  const result = await realApi.call(params);
  return result;
});

// 沙箱内使用 (通过 QuickJS 的 Promise 支持)
const result = await bridge_asyncCall(params);
```

### 2. 状态同步

沙箱内的 state 变更需要同步到 Worker：

```typescript
// 沙箱内
ctx.state.set('key', value);  // → 调用 bridge_stateSet

// Worker 内
bridge_stateSet: (key, value) => {
  // 1. 保存到 Worker 内存
  // 2. 触发持久化 (异步，不阻塞沙箱)
  wctx.syncState(key, value);
}
```

### 3. 沙箱销毁

Worker 退出时清理沙箱：

```typescript
async function st_worker_exit(wctx, reason) {
  for (const [strategyId, info] of wctx.strategies) {
    // 1. 调用策略 st_exit
    await info.qjs.call('st_exit', [reason]);
    
    // 2. 销毁沙箱
    info.qjs.destroy();
  }
}
```

---

## 修正后的设计是否 OK？🦀

**三层清晰分离**:
- Layer 1: workpool-lib (资源调度)
- Layer 2: Worker (Node.js + QuickJS 管理)
- Layer 3: 策略 JS (QuickJS 沙箱内)

**关键修正**:
- 策略 JS 在沙箱里，通过桥接函数访问外部
- Worker 管理沙箱生命周期
- 状态/日志/API 都通过桥接

这样设计对吗？
