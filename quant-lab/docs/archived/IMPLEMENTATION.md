# [ARCHIVED] IMPLEMENTATION

> **归档日期**: 2026-02-11
> **原因**: 设计已迭代/功能已实现/方案已废弃
> **最新状态见**: README.md / DESIGN.md / ROADMAP.md

---

# Quant-Lab 最终设计 - v1.0 实施版

> 2026-02-08 固化版本

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: QuickJS 沙箱 (策略业务)                            │
│  ├── st_init(ctx)                                           │
│  ├── st_heartbeat(ctx, tick)                                │
│  └── st_exit(ctx, reason)                                   │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Worker (Node.js 进程)                              │
│  ├── st_worker_init(wctx)                                   │
│  ├── st_worker_heartbeat(wctx, tick)                        │
│  ├── st_worker_exit(wctx, reason)                           │
│  └── 管理 QuickJS 沙箱生命周期                               │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: workpool-lib (资源调度)                            │
│  ├── Engine: 任务分配                                        │
│  ├── Resource<WorkerSpec>: Worker 注册                       │
│  └── Work<StrategySpec>: 策略任务                            │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心接口

### 1. 策略 JS (Layer 3)

```typescript
// strategies/my-strategy.ts
export async function st_init(ctx: StrategyContext): Promise<StrategyConfig>;
export async function st_heartbeat(ctx: StrategyContext, tick: TickInfo): Promise<void>;
export async function st_exit(ctx: StrategyContext, reason: ExitReason): Promise<void>;

interface StrategyContext {
  strategy: { id: string; name: string; params: any };
  state: { get(key, defaultValue?); set(key, value); batch(changes) };
  api: { bybit: { call(method, ...params) } };
  log: { debug(...args); info(...args); error(...args) };
  notify: { telegram(msg) };
  indicator: { sma(data, period); macd(data, fast, slow, signal) };
}
```

### 2. Worker (Layer 2)

```typescript
// src/worker/worker-lifecycle.ts
export async function st_worker_init(wctx: WorkerContext): Promise<void>;
export async function st_worker_heartbeat(wctx: WorkerContext, tick: TickInfo): Promise<void>;
export async function st_worker_exit(wctx: WorkerContext, reason: ExitReason): Promise<void>;

interface WorkerContext {
  worker: { id: string; region: string };
  pool: WorkPool;
  apis: APIPool;
  sandboxes: Map<string, QuickJSContext>;
  log: Logger;
}
```

### 3. workpool-lib (Layer 1)

```typescript
// 保持不变，使用现有实现
import { Engine, Resource, Work, FileLock, FileStore } from '@moltbaby/workpool-lib';
```

---

## 实施计划

### Phase 1: Worker 基础框架 (本周)

**目标**: Worker 能启动，能管理沙箱生命周期

| 任务 | 文件 | 验收标准 |
|------|------|---------|
| Worker 生命周期 | `src/worker/lifecycle.ts` | st_worker_init/heartbeat/exit 可调用 |
| 沙箱管理器 | `src/worker/sandbox-manager.ts` | 创建/销毁/恢复 QuickJS 沙箱 |
| 基础桥接 | `src/worker/bridge-core.ts` | state/log 桥接可用 |
| Worker 启动脚本 | `src/worker/start.ts` | 可独立启动 Worker 进程 |

**测试**: 
```bash
bun src/worker/start.ts --worker-id=worker-001 --region=JP
```

---

### Phase 2: API 桥接与优化 (下周)

**目标**: 策略能调用 API，状态批量优化

| 任务 | 文件 | 验收标准 |
|------|------|---------|
| API 连接池 | `src/worker/api-pool.ts` | 预加载 Bybit 客户端 |
| API 桥接 | `src/worker/bridge-api.ts` | ctx.api.bybit.call() 可用 |
| 批量状态 | `src/worker/bridge-state.ts` | ctx.state.batch() 可用 |
| 日志缓冲 | `src/worker/bridge-log.ts` | 批量发送日志 |

**测试**:
```typescript
// 策略能获取持仓
const positions = await ctx.api.bybit.call('getPositions', 'linear');
```

---

### Phase 3: workpool 集成 (第三周)

**目标**: Worker 接入 workpool-lib，接受调度

| 任务 | 文件 | 验收标准 |
|------|------|---------|
| Worker 注册 | `src/worker/pool-adapter.ts` | Worker 注册为 Resource |
| 任务接收 | `src/worker/task-handler.ts` | 接收 Strategy Work |
| 状态上报 | `src/worker/status-reporter.ts` | 定期上报 Worker 状态 |
| 故障恢复 | `src/worker/recovery.ts` | 策略崩溃自动重启 |

**测试**:
```bash
# Director 分配任务给 Worker
bun scripts/start-worker.ts --worker-id=worker-001
bun scripts/submit-task.ts --strategy=grid-btc --worker=worker-001
```

---

### Phase 4: 完整测试 (第四周)

**目标**: 端到端测试，策略能完整运行

| 任务 | 验收标准 |
|------|---------|
| 单元测试 | Worker/桥接/沙箱 单元测试通过 |
| 集成测试 | 策略完整生命周期测试 |
| 压力测试 | 10个策略同时运行稳定 |
| 故障测试 | Worker崩溃/策略崩溃恢复测试 |

**测试策略**:
- grid-martingale-1000x 在测试网运行
- 模拟各种故障场景

---

## 文件结构

```
quant-lab/src/
├── worker/                          # Layer 2: Worker
│   ├── index.ts                     # 导出
│   ├── lifecycle.ts                 # st_worker_init/heartbeat/exit
│   ├── types.ts                     # WorkerContext 类型
│   ├── sandbox-manager.ts           # QuickJS 沙箱管理
│   ├── api-pool.ts                  # API 客户端池
│   ├── bridge/
│   │   ├── index.ts                 # 桥接函数注册
│   │   ├── state.ts                 # 状态桥接
│   │   ├── api.ts                   # API 桥接
│   │   └── log.ts                   # 日志桥接
│   ├── pool-adapter.ts              # workpool-lib 适配
│   └── start.ts                     # Worker 启动入口
│
├── quickjs/                         # QuickJS 封装
│   ├── index.ts
│   ├── context.ts                   # QuickJSContext
│   └── promise-bridge.ts            # Promise 桥接
│
├── strategy/                        # Layer 3: 策略支持
│   ├── index.ts
│   ├── types.ts                     # StrategyContext 类型
│   └── indicators.ts                # 沙箱内指标计算
│
├── scripts/                         # 脚本
│   ├── start-worker.ts              # 启动 Worker
│   ├── start-director.ts            # 启动 Director
│   └── submit-task.ts               # 提交任务
│
└── strategies/                      # 策略目录
    └── examples/
        ├── grid-martingale-1000x.ts
        ├── short-martingale-1000x.ts
        └── positions-monitor.ts
```

---

## 关键实现决策

### 1. 状态同步

```typescript
// 策略侧 (沙箱内)
ctx.state.set('key', value);  // 缓冲
ctx.state.batch({ ... });     // 批量提交

// Worker 侧
// 1. 接收批量变更
// 2. 更新内存
// 3. 异步持久化 (不阻塞)
```

### 2. API 调用

```typescript
// 策略侧
const result = await ctx.api.bybit.call('getPositions', 'linear');

// Worker 侧
// 1. 从 apiPool 获取客户端
// 2. 调用真实 API
// 3. 序列化返回给沙箱
```

### 3. 错误恢复

```typescript
// 策略错误
if (errorCount <= 3) {
  // 恢复快照
  await sandboxManager.recover(strategyId);
} else {
  // 停止策略
  await stopStrategy(strategyId);
  await pool.reschedule(strategyId);  // 让 Director 重新调度
}
```

---

## 验收标准

### 功能验收

- [ ] Worker 能独立启动
- [ ] Worker 能创建 QuickJS 沙箱
- [ ] 策略能在沙箱内运行 st_heartbeat
- [ ] 策略能调用 ctx.api.bybit
- [ ] 策略能读写 ctx.state
- [ ] Worker 崩溃后策略能恢复
- [ ] 策略错误后能自动重启

### 性能验收

- [ ] 单 Worker 支持 10+ 策略
- [ ] 状态批量写入延迟 < 100ms
- [ ] API 调用延迟 < 200ms
- [ ] 沙箱恢复时间 < 5s

### 稳定性验收

- [ ] 连续运行 24h 无内存泄漏
- [ ] 策略崩溃 10次后仍能恢复
- [ ] Worker 重启后策略状态不丢失

---

## 先开始哪个 Phase？

**A.** Phase 1: Worker 基础框架 (推荐，先跑通核心)  
**B.** Phase 2+3 并行: 桥接 + workpool 集成  
**C.** 其他建议

从哪个 Phase 开始？🦀
