# Quant-Lab Worker Pool 编排设计

> CEO → Director → Executor 三层调度
> 
> 策略JS（st_系列）是业务逻辑，编排层是基础设施

---

## 架构定位

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 4: 业务层 (Business) - 用户编写，已定型 ✅            │
│  ├── 策略脚本: st_init/st_heartbeat/st_exit                 │
│  └── 交易逻辑: 网格/马丁/趋势...                             │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: 编排层 (Orchestration) - 本层重点 🦀              │
│  ├── StrategyPool      策略池 (管理多个策略实例)              │
│  ├── WorkerPool        Worker池 (分配执行资源)                │
│  ├── Scheduler         调度器 (决定哪个worker执行哪个策略)     │
│  └── Monitor           监控器 (健康检查、故障恢复)              │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: 执行层 (Execution) - 已完善 ✅                    │
│  ├── StrategyRunner    执行单个策略生命周期                   │
│  ├── StateManager      状态管理                             │
│  └── APIProvider       交易所接口                            │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 基础设施 (Infrastructure) - 已完善 ✅             │
│  ├── Storage, Timer, Logger...                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 核心问题

### 1. 什么是策略实例？

```typescript
// 不是策略代码，而是运行中的策略
interface StrategyInstance {
  id: string;                    // 唯一ID: "grid-btc-001"
  name: string;                  // 显示名
  strategyFile: string;          // 策略代码文件
  params: Record<string, any>;   // 策略参数
  config: StrategyConfig;        // 运行时配置
  
  // 运行时状态
  status: 'pending' | 'queued' | 'running' | 'paused' | 'error' | 'stopped';
  workerId?: string;             // 分配到哪个worker
  startedAt?: number;
  stoppedAt?: number;
  errorCount: number;
  lastError?: string;
}
```

### 2. 什么是 Worker？

```typescript
// 执行策略的"工人"，可以是：
// - 一个进程
// - 一个线程  
// - 一个容器
// - 一个bot实例

interface Worker {
  id: string;                    // worker-001, worker-002...
  status: 'idle' | 'busy' | 'offline';
  
  // 能力
  capabilities: {
    maxStrategies: number;       // 最多同时执行几个策略
    supportedApis: string[];     // 支持哪些交易所
  };
  
  // 当前负载
  currentLoad: {
    runningStrategies: string[]; // 正在执行的策略ID列表
    cpu: number;                 // CPU使用率
    memory: number;              // 内存使用
  };
  
  // 元数据
  metadata: {
    host: string;                // 所在机器
    region?: string;             // 区域 (用于IP限制)
    proxy?: string;              // 代理配置
  };
}
```

---

## 编排层核心组件

### 1. StrategyPool - 策略池

**职责**: 管理所有策略实例的生命周期

```typescript
class StrategyPool {
  // 注册策略（配置）
  async register(instance: StrategyInstance): Promise<void>;
  
  // 启动策略（调度器决定何时何地执行）
  async start(instanceId: string): Promise<void>;
  
  // 停止策略
  async stop(instanceId: string): Promise<void>;
  
  // 暂停/恢复
  async pause(instanceId: string): Promise<void>;
  async resume(instanceId: string): Promise<void>;
  
  // 查询
  list(): StrategyInstance[];
  get(instanceId: string): StrategyInstance | null;
  
  // 状态变更监听
  onStatusChange(callback: (instanceId: string, status: Status) => void): void;
}
```

**关键设计**: 
- 策略实例与Worker解耦，策略不知道自己在哪运行
- 状态持久化，重启后可恢复

---

### 2. WorkerPool - Worker池

**职责**: 管理所有Worker，提供资源视图

```typescript
class WorkerPool {
  // 注册Worker（启动时上报）
  async register(worker: Worker): Promise<void>;
  
  // 心跳上报
  async heartbeat(workerId: string, load: LoadInfo): Promise<void>;
  
  // 查询可用Worker
  findAvailable(requirements: {
    api: string;           // 需要支持哪个交易所
    region?: string;       // 需要在哪个区域
    minMemory?: number;    // 最小内存要求
  }): Worker | null;
  
  // 获取所有Worker状态
  list(): Worker[];
  
  // 监听Worker变化
  onWorkerChange(callback: (workerId: string, status: WorkerStatus) => void): void;
}
```

**关键设计**:
- Worker主动上报心跳
- 支持动态扩缩容
- 区域感知（日本IP锁定策略必须分配到日本Worker）

---

### 3. Scheduler - 调度器（核心）

**职责**: 决定哪个策略在哪个Worker上执行

```typescript
interface SchedulePolicy {
  // 选择Worker的策略
  selectWorker(
    instance: StrategyInstance,
    availableWorkers: Worker[]
  ): Worker | null;
}

// 内置策略
class RoundRobinPolicy implements SchedulePolicy {
  // 轮询，简单均衡
}

class LoadBasedPolicy implements SchedulePolicy {
  // 基于负载，选择最空闲的
}

class RegionAffinityPolicy implements SchedulePolicy {
  // 区域亲和，策略要求日本IP就选日本Worker
}

class FailoverPolicy implements SchedulePolicy {
  // 故障转移，Worker故障时迁移策略
}

class Scheduler {
  constructor(
    strategyPool: StrategyPool,
    workerPool: WorkerPool,
    policy: SchedulePolicy
  );
  
  // 调度一个策略
  async schedule(instanceId: string): Promise<boolean>;
  
  // 重新调度（Worker故障时）
  async reschedule(instanceId: string, fromWorkerId: string): Promise<boolean>;
  
  // 定时重平衡
  startRebalancing(intervalMs: number): void;
}
```

**调度流程**:
```
1. 用户调用 strategyPool.start('grid-btc-001')
2. StrategyPool 将状态改为 'queued'
3. Scheduler 收到调度请求
4. Scheduler 查询 WorkerPool 找可用 Worker
5. 根据 Policy 选择最合适的 Worker
6. 通知 Worker 执行策略
7. Worker 启动 StrategyRunner
8. 状态变为 'running'
```

---

### 4. Monitor - 监控器

**职责**: 健康检查、故障检测、自动恢复

```typescript
class Monitor {
  constructor(
    strategyPool: StrategyPool,
    workerPool: WorkerPool,
    scheduler: Scheduler
  );
  
  // 启动监控
  start(options: {
    heartbeatInterval: number;    // Worker心跳检查间隔
    strategyCheckInterval: number; // 策略状态检查间隔
    autoRecover: boolean;         // 是否自动恢复
  }): void;
  
  // 检查Worker健康
  private checkWorkerHealth(): void;
  
  // 检查策略健康
  private checkStrategyHealth(): void;
  
  // 自动恢复策略
  private autoRecover(instanceId: string): void;
}
```

**监控逻辑**:
```
每30秒:
  1. 检查所有Worker心跳
     - 超时未上报 → 标记为 offline
     - 触发 reschedule 迁移策略
  
  2. 检查所有Running策略
     - 策略心跳超时 → 标记为 error
     - autoRecover=true → 尝试重启
```

---

## 数据流

```
用户操作
    ↓
StrategyPool (更新实例状态)
    ↓
Scheduler (决定调度)
    ↓
WorkerPool (获取Worker信息)
    ↓
Worker (执行策略)
    ↓
StrategyRunner (运行 st_heartbeat)
    ↑
心跳上报
    ↑
Monitor (健康检查)
```

---

## 关键场景

### 场景1: 启动策略

```typescript
// 用户注册策略
await strategyPool.register({
  id: 'grid-btc-sub1',
  strategyFile: './grid-martingale.ts',
  params: { symbol: 'BTCUSDT', account: 'wjcgm@bbt-sub1' },
  config: { 
    heartbeatMs: 60000,
    requiredRegion: 'JP',  // 关键：需要日本IP
    requiredProxy: 'http://127.0.0.1:8890'
  }
});

// 启动
await strategyPool.start('grid-btc-sub1');

// 内部流程:
// 1. Scheduler 查找 Worker
// 2. 发现 worker-003 是 JP 区域，有 8890 代理
// 3. 分配策略到 worker-003
// 4. worker-003 启动 StrategyRunner
```

### 场景2: Worker 故障

```typescript
// worker-003 心跳超时
monitor.checkWorkerHealth();
// → 发现 worker-003 离线

// 自动恢复:
// 1. WorkerPool 标记 worker-003 offline
// 2. 查询 worker-003 上运行的策略
// 3. 对每个策略调用 scheduler.reschedule()
// 4. 迁移到另一个 JP 区域的 worker
// 5. 策略状态保持，继续执行
```

### 场景3: 策略错误

```typescript
// grid-btc-sub1 连续报错
monitor.checkStrategyHealth();
// → 发现 errorCount > 10

// 处理:
// 1. StrategyPool 标记策略为 'error'
// 2. 通知用户
// 3. 根据配置决定是否自动重启
```

---

## 与现有 workpool-lib 的关系

```
workpool-lib (通用资源池)
    ↓ 使用
┌─────────────────────────────────────┐
│  StrategyPool                       │
│  └── 用 workpool-lib 管理策略实例   │
├─────────────────────────────────────┤
│  WorkerPool                         │
│   └── 用 workpool-lib 管理 Worker   │
├─────────────────────────────────────┤
│  Scheduler                          │
│   └── 调度逻辑（业务层）             │
└─────────────────────────────────────┘
```

**workpool-lib 提供**: 资源抽象、锁、存储、引擎  
**编排层提供**: 策略/Worker 业务逻辑、调度策略、监控恢复

---

## 接口定义

```typescript
// 策略实例配置
interface StrategySpec {
  id: string;
  name: string;
  strategyFile: string;
  params: Record<string, any>;
  
  // 资源要求
  requirements: {
    api: string;           // bybit/futu/binance
    account: string;       // wjcgm@bbt-sub1
    region?: string;       // JP/US/EU
    proxy?: string;        // http://127.0.0.1:8890
    minMemory?: number;    // MB
  };
  
  // 调度策略
  scheduling: {
    autoRestart: boolean;
    maxRestarts: number;
    restartDelay: number;
  };
}

// Worker 配置
interface WorkerSpec {
  id: string;
  host: string;
  port: number;
  
  // 能力
  capabilities: {
    maxStrategies: number;
    supportedApis: string[];
  };
  
  // 元数据（用于调度匹配）
  metadata: {
    region: string;
    proxy: string;
  };
}
```

---

## 实现优先级

1. **StrategyPool** - 管理策略实例 CRUD ✅
2. **WorkerPool** - Worker 注册与心跳 ✅
3. **Scheduler** - 基础调度（轮询/负载）✅
4. **Monitor** - 健康检查与故障恢复 ✅
5. **RegionAffinity** - 区域感知调度（日本IP关键）⭐
6. **AutoRecover** - 自动故障恢复 ⭐

这样设计调顺了编排层吗？🦀
