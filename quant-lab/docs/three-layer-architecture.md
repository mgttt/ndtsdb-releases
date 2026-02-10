# Quant-Lab 三层架构 v3 - 双生命周期设计

> workerpool 基建 | st-worker 工作轮 | st 策略 JS
> 
> 每层都有 st_init/st_heartbeat/st_exit 生命周期

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: st 策略 JS (业务逻辑)                              │
│  ├── st_init(ctx)        ← 初始化策略                        │
│  ├── st_heartbeat(ctx)   ← 执行业务逻辑                      │
│  └── st_exit(ctx)        ← 清理资源                          │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: st-worker 工作轮 (执行环境)                         │
│  ├── st_worker_init(wctx)      ← 初始化 Worker               │
│  ├── st_worker_heartbeat(wctx) ← 管理策略生命周期             │
│  └── st_worker_exit(wctx)      ← 清理 Worker                 │
│                                                              │
│  职责:                                                       │
│  - 加载/卸载策略                                             │
│  - 传递消息给策略                                            │
│  - 监控策略健康                                              │
│  - 上报自身状态                                              │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: workerpool 底层基建 (资源管理)                      │
│  ├── 资源编排 (Resource<WorkerSpec, WorkerState>)            │
│  ├── 任务调度 (Work<StrategySpec, StrategyResult>)           │
│  ├── 分布式锁 (FileLock)                                     │
│  └── 状态存储 (FileStore)                                    │
└─────────────────────────────────────────────────────────────┘
```

---

## 关键设计：双生命周期

### 为什么 Worker 也要有生命周期？

```
传统: Worker 只是执行器
    Worker ──→ 执行策略
    
新设计: Worker 是独立生命体
    Worker (st_worker_heartbeat)
        ↓ 管理
    策略 A (st_heartbeat)
    策略 B (st_heartbeat)
    策略 C (st_heartbeat)
```

**Worker 可以**:
- 动态加载/卸载策略
- 监控策略健康，失败时重启
- 上报自身资源状态
- 优雅关闭时先停策略

---

## Layer 1: workerpool 基建

**保持现状，不改**，已完备 ✅

```typescript
// workpool-lib 提供
- Engine: 任务调度引擎
- Resource<WorkerSpec, WorkerState>: Worker 作为资源
- Work<StrategySpec, StrategyResult>: 策略作为任务
- FileLock: 分布式锁
- FileStore: 状态存储
```

---

## Layer 2: st-worker 工作轮

### Worker 上下文 (wctx)

```typescript
interface WorkerContext {
  // Worker 身份
  worker: {
    id: string;              // worker-001
    name: string;            // 显示名
    region: string;          // JP/US
    host: string;            // 所在机器
  };
  
  // Worker 状态
  state: {
    status: 'idle' | 'busy' | 'stopping';
    load: {
      cpu: number;
      memory: number;
      runningStrategies: number;
    };
  };
  
  // 管理的策略
  strategies: Map<string, {
    id: string;
    status: 'running' | 'paused' | 'error';
    process?: any;           // StrategyRunner 实例
    lastHeartbeat: number;
    errorCount: number;
  }>;
  
  // API 客户端池
  apis: Map<string, any>;    // bybit-wjcgm@bbt-sub1 → client
  
  // 基础设施
  pool: WorkPool;            // workpool-lib 引擎
  log: Logger;
  
  // 消息传递
  sendToStrategy(strategyId: string, msg: any): void;
  broadcastToAll(msg: any): void;
}
```

### Worker 生命周期函数

```typescript
/**
 * Worker 初始化
 * - 连接 workpool-lib
 * - 加载 API 客户端
 * - 注册到 Director
 */
export async function st_worker_init(wctx: WorkerContext) {
  wctx.log.info(`Worker ${wctx.worker.id} 初始化`);
  
  // 1. 注册到 workpool-lib
  const resource: Resource<WorkerSpec, WorkerState> = {
    id: wctx.worker.id,
    spec: {
      region: wctx.worker.region,
      proxy: process.env.HTTP_PROXY,
      maxStrategies: 5,
    },
    state: {
      status: 'ready',
      load: { cpu: 0, memory: 0, runningStrategies: 0 }
    }
  };
  
  await wctx.pool.registerResource(resource);
  
  // 2. 预加载 API 客户端（根据配置）
  const apiConfig = loadApiConfig();  // 从 env.jsonl
  for (const [key, config] of Object.entries(apiConfig)) {
    if (config.type === 'bybit') {
      wctx.apis.set(key, new BybitClient(config));
    }
  }
  
  wctx.log.info(`预加载 ${wctx.apis.size} 个 API 客户端`);
  
  // 3. 启动状态上报
  startStatusReporting(wctx, 30000);  // 30秒上报一次
}

/**
 * Worker 心跳
 * - 检查 workpool-lib 分配的任务
 * - 管理策略生命周期（启动/停止/监控）
 * - 上报自身状态
 */
export async function st_worker_heartbeat(wctx: WorkerContext, tick: TickInfo) {
  // 1. 从 workpool-lib 获取分配的任务
  const works = await wctx.pool.getAssignedWorks(wctx.worker.id);
  
  for (const work of works) {
    const strategyId = work.payload.strategyId;
    const existing = wctx.strategies.get(strategyId);
    
    if (!existing) {
      // 新策略，启动
      await startStrategy(wctx, work);
      
    } else if (existing.status === 'error') {
      // 策略错误，尝试重启
      wctx.log.warn(`策略 ${strategyId} 错误，尝试重启`);
      await restartStrategy(wctx, strategyId);
    }
  }
  
  // 2. 检查策略健康
  for (const [strategyId, info] of wctx.strategies) {
    const timeSinceHeartbeat = Date.now() - info.lastHeartbeat;
    
    if (timeSinceHeartbeat > 60000) {  // 1分钟无心跳
      wctx.log.error(`策略 ${strategyId} 心跳超时`);
      info.status = 'error';
      info.errorCount++;
    }
    
    // 连续错误过多，停止策略
    if (info.errorCount > 5) {
      wctx.log.error(`策略 ${strategyId} 错误过多，停止`);
      await stopStrategy(wctx, strategyId);
    }
  }
  
  // 3. 更新 Worker 负载
  wctx.state.load = {
    cpu: process.cpuUsage().user / 1000000,  // 简化
    memory: process.memoryUsage().heapUsed / 1024 / 1024,
    runningStrategies: wctx.strategies.size,
  };
  
  // 4. 上报到 workpool-lib
  await wctx.pool.updateResourceState(wctx.worker.id, wctx.state);
}

/**
 * Worker 退出
 * - 优雅停止所有策略
 * - 断开 workpool-lib
 * - 清理资源
 */
export async function st_worker_exit(wctx: WorkerContext, reason: ExitReason) {
  wctx.log.info(`Worker ${wctx.worker.id} 退出: ${reason.type}`);
  
  // 1. 停止所有策略
  const stopPromises = [];
  for (const [strategyId, info] of wctx.strategies) {
    if (info.process) {
      stopPromises.push(info.process.stop({ type: 'worker_exit' }));
    }
  }
  
  await Promise.all(stopPromises);
  wctx.log.info('所有策略已停止');
  
  // 2. 注销 workpool-lib
  await wctx.pool.unregisterResource(wctx.worker.id);
  
  // 3. 清理 API 客户端
  for (const [key, api] of wctx.apis) {
    await api.disconnect?.();
  }
}

// ===== 辅助函数 =====

async function startStrategy(wctx: WorkerContext, work: Work<StrategySpec, any>) {
  const { strategyId, strategyFile, params } = work.payload;
  
  wctx.log.info(`启动策略: ${strategyId}`);
  
  // 创建 StrategyRunner
  const runner = new StrategyRunner({
    workDir: `./strategies/${strategyId}`,
  });
  
  // 注入 API（根据策略需要的 account）
  const apiKey = params.account;  // 'wjcgm@bbt-sub1'
  const api = wctx.apis.get(apiKey);
  
  // 启动策略
  runner.run(strategyFile, {
    strategyId,
    ...params,
    // 注入 API 客户端
    apiProvider: api,
  });
  
  // 记录
  wctx.strategies.set(strategyId, {
    id: strategyId,
    status: 'running',
    process: runner,
    lastHeartbeat: Date.now(),
    errorCount: 0,
  });
  
  wctx.log.info(`策略 ${strategyId} 启动完成`);
}

async function stopStrategy(wctx: WorkerContext, strategyId: string) {
  const info = wctx.strategies.get(strategyId);
  if (!info || !info.process) return;
  
  wctx.log.info(`停止策略: ${strategyId}`);
  
  await info.process.stop({ type: 'manual' });
  info.status = 'stopped';
  
  wctx.strategies.delete(strategyId);
}

async function restartStrategy(wctx: WorkerContext, strategyId: string) {
  await stopStrategy(wctx, strategyId);
  
  // 重新获取 work 配置
  const work = await wctx.pool.getWork(strategyId);
  if (work) {
    await startStrategy(wctx, work);
  }
}
```

---

## Layer 3: st 策略 JS

**保持现有设计，不改 ✅**

```typescript
export async function st_init(ctx: StrategyContext) {
  // 初始化
}

export async function st_heartbeat(ctx: StrategyContext, tick: TickInfo) {
  // 业务逻辑
}

export async function st_exit(ctx: StrategyContext, reason: ExitReason) {
  // 清理
}
```

**关键：ctx.api 由 Worker 注入**

```typescript
// Worker 在启动策略时注入 API
const runner = new StrategyRunner({
  apiProvider: wctx.apis.get('wjcgm@bbt-sub1'),  // 注入
});

// 策略中通过 ctx.api 访问
export async function st_heartbeat(ctx) {
  const bybit = ctx.api.bybit['wjcgm@bbt-sub1'];  // 直接使用
  const positions = await bybit.getPositions();
}
```

---

## 数据流

```
Director (workpool-lib 调度器)
    ↓ 分配任务 Work
Worker (st_worker_heartbeat)
    ↓ 启动
StrategyRunner
    ↓ 调用
st_heartbeat (策略业务逻辑)
    ↑ 返回结果
StrategyRunner
    ↑ 上报状态
Worker (更新策略心跳时间)
    ↑ 上报 Worker 状态
Director
```

---

## 优势

| 传统设计 | 双生命周期设计 |
|---------|--------------|
| Worker 只是执行器 | Worker 是独立生命体，可自愈 |
| 策略崩溃 = Worker 崩溃 | 策略崩溃，Worker 可重启策略 |
| Worker 无状态上报 | Worker 主动上报负载，便于调度 |
| 策略直接依赖基础设施 | 策略只依赖 Worker 注入的 API，解耦 |

---

## 实现文件

```
quant-lab/src/
├── worker/                        # st-worker 工作轮
│   ├── types.ts                   # WorkerContext 类型
│   ├── worker-lifecycle.ts        # st_worker_init/heartbeat/exit
│   ├── strategy-manager.ts        # 管理策略生命周期
│   └── api-pool.ts                # API 客户端池
├── strategy/                      # st 策略 (已有)
│   ├── types.ts                   # StrategyContext
│   ├── StrategyRunner.ts          # 执行器
│   └── ...
└── index.ts
```

---

这样设计对齐三层架构了吗？🦀
