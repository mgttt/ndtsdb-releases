# Quant-Lab 架构设计 v2 - 平衡与扩展

> 核心简单完备，扩展分层可选

---

## 设计原则

1. **核心最小** - 只保留必需功能，稳定可靠
2. **扩展分层** - 高级功能通过扩展/插件实现
3. **渐进增强** - 从简单开始，按需启用高级功能
4. **无 breaking change** - 核心 API 稳定，扩展不破坏已有代码

---

## 三层架构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: 扩展层 (Extensions) - 可选，按需启用            │
│  ├── AutoSave          自动保存扩展                      │
│  ├── SnapshotHistory   快照历史扩展                      │
│  ├── RuntimeGuard      运行时监控扩展                    │
│  └── HealthCheck       健康检查扩展                      │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 核心层 (Core) - 简单完备，稳定                  │
│  ├── StateManager      基础状态管理 (get/set/save/load)  │
│  ├── SignalHandler     基础信号处理 (SIGINT/SIGTERM)     │
│  ├── APIProvider       交易所接口统一封装                 │
│  ├── IndicatorEngine   指标计算 (纯函数)                 │
│  └── StrategyRunner    策略生命周期管理                   │
├─────────────────────────────────────────────────────────┤
│  Layer 1: 基础层 (Base) - 最简抽象，几乎不变              │
│  ├── Storage           存储接口 (DuckDB)                 │
│  ├── Timer             定时器封装                        │
│  └── Logger            日志接口                          │
└─────────────────────────────────────────────────────────┘
```

---

## 核心层设计 (Layer 2)

### 1. CoreStateManager - 极简状态管理

**职责**: 最基本的持久化  
**功能**: get / set / save / load  
**不做的**: 自动保存、快照、回滚 (这些是扩展)

```typescript
class CoreStateManager {
  get(key: string): any;
  set(key: string, value: any): void;
  save(): Promise<void>;     // 显式调用
  load(): Promise<void>;     // 显式调用
}

// 使用
const state = new CoreStateManager({
  strategyId: 'my-strat',
  stateDir: './state',
});

await state.load();
state.set('counter', 1);
await state.save();  // 显式保存，简单可靠
```

**为什么不用自动保存？**  
- 简单：用户控制保存时机，不隐式触发  
- 可靠：不会在不恰当的时机保存中间状态  
- 可测试：没有后台定时器，完全同步

---

### 2. CoreSignalHandler - 极简信号处理

**职责**: 最基本的进程信号响应  
**功能**: onExit 回调  
**不做的**: 超时控制、资源监控 (这些是扩展)

```typescript
class CoreSignalHandler {
  onExit(callback: () => void): void;
}

// 使用
const signals = new CoreSignalHandler();
signals.onExit(async () => {
  await state.save();  // 退出前保存
  process.exit(0);
});
```

---

### 3. APIProvider - 交易所接口

**当前设计已 OK**，保持简单

```typescript
class BybitProvider {
  async getPositions(): Promise<Position[]>;
  async placeOrder(order: Order): Promise<OrderResult>;
  // 没有：自动重试、熔断、缓存 (这些是扩展)
}
```

---

### 4. IndicatorEngine - 指标计算

**纯函数，当前设计 OK**

```typescript
export function sma(data: number[], period: number): number[];
export function macd(...): MACDResult;
// 无状态，简单可靠
```

---

### 5. CoreStrategyRunner - 极简策略运行器

**职责**: 只执行生命周期，不组装模块  
**依赖**: 外部传入 (不自己创建)

```typescript
interface CoreRunnerOptions {
  strategy: StrategyModule;           // 策略代码
  state: CoreStateManager;            // 状态管理
  onExit?: () => Promise<void>;       // 退出回调
  heartbeatMs?: number;               // 心跳间隔
}

class CoreStrategyRunner {
  constructor(options: CoreRunnerOptions);
  async start(): Promise<void>;        // 启动
  async stop(): Promise<void>;         // 停止
}

// 使用 - 显式组装
const runner = new CoreStrategyRunner({
  strategy: myStrategy,
  state: new CoreStateManager({...}),
  onExit: async () => { await cleanup(); },
  heartbeatMs: 60000,
});

await runner.start();
```

**为什么不自动组装？**  
- 透明：用户清楚知道用了哪些模块  
- 灵活：可以替换任何模块  
- 简单：没有隐式逻辑

---

## 扩展层设计 (Layer 3)

### 1. AutoSave Extension - 自动保存扩展

```typescript
class AutoSaveExtension {
  constructor(state: CoreStateManager, intervalMs: number);
  start(): void;   // 启用自动保存
  stop(): void;    // 停止自动保存
}

// 使用 - 按需启用
const state = new CoreStateManager({...});
const autoSave = new AutoSaveExtension(state, 30000);
autoSave.start();  // 启用扩展
```

**何时启用？** 需要自动保存时才用，默认不用

---

### 2. SnapshotHistory Extension - 快照历史扩展

```typescript
class SnapshotHistoryExtension {
  constructor(state: CoreStateManager, maxSnapshots: number);
  async createSnapshot(): Promise<void>;
  async rollback(timestamp: number): Promise<void>;
  listSnapshots(): Snapshot[];
}

// 使用
const snapshots = new SnapshotHistoryExtension(state, 10);
await snapshots.createSnapshot();  // 手动创建快照
```

---

### 3. RuntimeGuard Extension - 运行时监控扩展

```typescript
class RuntimeGuardExtension {
  constructor(options: { memoryLimitMB: number });
  start(onViolation: () => void): void;
  stop(): void;
}

// 使用
const guard = new RuntimeGuardExtension({ memoryLimitMB: 512 });
guard.start(() => {
  console.warn('Memory limit exceeded');
});
```

---

### 4. FullFeaturedRunner - 全功能运行器 (组装好的)

**给不想自己组装的用户**

```typescript
class FullFeaturedRunner {
  constructor(options: {
    strategyId: string;
    strategyFile: string;
    enableAutoSave?: boolean;      // 默认 false
    enableSnapshot?: boolean;      // 默认 false
    enableRuntimeGuard?: boolean;  // 默认 false
    heartbeatMs: number;
  });
  
  async start(): Promise<void>;
  async stop(): Promise<void>;
}

// 使用 - 一键启动，但功能可选
const runner = new FullFeaturedRunner({
  strategyId: 'grid-001',
  strategyFile: './strategy.ts',
  heartbeatMs: 60000,
  // 默认都不启用，显式开启
  enableAutoSave: true,
  enableSnapshot: true,
});
```

---

## 使用方式对比

### 方式 A: 极简使用 (推荐新手)

```typescript
import { FullFeaturedRunner } from 'quant-lab';

const runner = new FullFeaturedRunner({
  strategyId: 'my-strat',
  strategyFile: './strategy.ts',
  heartbeatMs: 60000,
  // 其他功能默认关闭
});

await runner.start();
```

**特点**: 简单，可控，透明

---

### 方式 B: 显式组装 (推荐生产)

```typescript
import {
  CoreStateManager,
  CoreSignalHandler,
  CoreStrategyRunner,
  BybitProvider,
} from 'quant-lab';

// 显式创建模块
const state = new CoreStateManager({ strategyId: 'my-strat' });
const signals = new CoreSignalHandler();
const api = new BybitProvider({ accountId: 'wjcgm@bbt-sub1' });

// 显式组装
const runner = new CoreStrategyRunner({
  strategy: myStrategy,
  state,
  api,  // 注入 API
  onExit: async () => {
    await state.save();
  },
});

// 可选：启用扩展
import { AutoSaveExtension } from 'quant-lab/extensions';
const autoSave = new AutoSaveExtension(state, 30000);
autoSave.start();

await runner.start();
```

**特点**: 完全控制，灵活，可替换任何模块

---

### 方式 C: 渐进增强 (推荐迭代)

```typescript
// 1. 先跑通核心
const runner = new CoreStrategyRunner({
  strategy: myStrategy,
  state: new CoreStateManager({...}),
});
await runner.start();

// 2. 发现需要自动保存，加上扩展
import { AutoSaveExtension } from 'quant-lab/extensions';
const autoSave = new AutoSaveExtension(state, 30000);
autoSave.start();

// 3. 发现需要快照，再加上
import { SnapshotExtension } from 'quant-lab/extensions';
const snapshot = new SnapshotExtension(state);
// 定时创建快照
setInterval(() => snapshot.createSnapshot(), 60000);
```

**特点**: 按需启用，不一开始就复杂

---

## 模块依赖关系

```
CoreStrategyRunner
    ↓ uses
CoreStateManager ← AutoSaveExtension (optional)
    ↑              ← SnapshotExtension (optional)
CoreSignalHandler
    ↑
APIProvider
    ↑
IndicatorEngine (no deps)
```

**核心层之间**：显式依赖，构造函数注入  
**扩展到核心**：扩展依赖核心，核心不依赖扩展  
**扩展之间**：无依赖，独立

---

## 当前需要调整

| 当前实现 | 问题 | 调整方案 |
|---------|------|---------|
| StateManager | 功能过多（自动保存+快照+回滚） | 拆分为 Core + 扩展 |
| SignalHandler | 功能过多（信号+资源监控） | 拆分为 Core + 扩展 |
| StrategyRunner | 自己组装模块，隐式逻辑 | 改为显式注入，或提供 FullFeatured 版本 |

---

## 文件结构调整

```
quant-lab/src/
├── core/                          # 核心层 - 简单稳定
│   ├── StateManager.ts            # 基础状态管理
│   ├── SignalHandler.ts           # 基础信号处理
│   ├── StrategyRunner.ts          # 基础策略运行器
│   └── index.ts                   # 核心导出
├── extensions/                    # 扩展层 - 可选高级功能
│   ├── AutoSaveExtension.ts       # 自动保存
│   ├── SnapshotExtension.ts       # 快照历史
│   ├── RuntimeGuardExtension.ts   # 运行时监控
│   └── index.ts                   # 扩展导出
├── providers/                     # 交易所接口
│   ├── BybitProvider.ts
│   └── index.ts
├── indicators/                    # 指标计算
│   └── index.ts
├── full-featured/                 # 全功能组装版
│   └── FullFeaturedRunner.ts      # 一键启动
└── index.ts                       # 主入口
```

---

## 总结

**平衡原则**：
- 80% 用户用 **FullFeaturedRunner** - 简单
- 20% 用户用 **Core + 扩展** - 灵活
- 核心层 **永不复杂** - 稳定
- 扩展层 **按需启用** - 不强制

这样设计平衡吗？🦀
