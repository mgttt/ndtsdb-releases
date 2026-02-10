# Quant-Lab 树状 Worker Pool 设计

> 从扁平到树状，支持层级调度

---

## 为什么需要树状？

### 扁平结构的局限

```
WorkerPool: [worker-001, worker-002, worker-003, worker-004, worker-005]

问题：
- worker-001 (日本) 空闲，但策略需要美国IP → 不能分配
- worker-002,003 (美国) 忙碌 → 策略无法启动
- 没有层级概念，调度逻辑复杂
```

### 树状结构的优势

```
root/
├── asia/
│   ├── japan/
│   │   ├── worker-tokyo-001  ← 日本IP，8890代理
│   │   └── worker-tokyo-002
│   └── singapore/
│       └── worker-sg-001
├── americas/
│   └── us/
│       ├── worker-us-west-001
│       └── worker-us-east-001
└── europe/
    └── frankfurt/
        └── worker-de-001

调度逻辑：
- 策略需要日本IP → 直接找 /root/asia/japan/*
- 策略需要美国IP → 直接找 /root/americas/us/*
- 策略无区域要求 → 从 root/* 递归查找
```

---

## 核心概念

### 1. 树节点 (PoolNode)

```typescript
interface PoolNode {
  id: string;              // 节点ID: "asia", "japan", "worker-tokyo-001"
  path: string;            // 完整路径: "/root/asia/japan/worker-tokyo-001"
  type: 'root' | 'region' | 'worker';  // 节点类型
  
  // 树结构
  parent?: PoolNode;
  children: Map<string, PoolNode>;
  
  // Worker 特有属性
  worker?: Worker;         // type='worker' 时才有
  
  // 区域聚合信息 (动态计算)
  stats: {
    totalWorkers: number;      // 子树总worker数
    availableWorkers: number;  // 可用worker数
    runningStrategies: number; // 运行中策略数
  };
}
```

### 2. Worker 注册到树

```typescript
// Worker 启动时注册到指定路径
worker.register({
  path: '/asia/japan/worker-tokyo-001',  // 树状路径
  capabilities: {
    region: 'JP',
    proxy: 'http://127.0.0.1:8890',
    apis: ['bybit'],
  }
});

// 树自动创建中间节点
// root/asia/japan/worker-tokyo-001
```

### 3. 策略调度路径匹配

```typescript
// 策略指定资源要求
const strategy = {
  id: 'grid-btc-jp',
  requirements: {
    // 方式1: 精确路径
    path: '/asia/japan/*',
    
    // 方式2: 标签匹配
    region: 'JP',
    proxy: 'http://127.0.0.1:8890',
    
    // 方式3: 模糊匹配
    pathPattern: '/asia/*/worker-*',
  }
};

// 调度器查找匹配路径的 Worker
const workers = pool.findWorkers('/asia/japan/*');
// → [worker-tokyo-001, worker-tokyo-002]
```

---

## 树操作 API

### 注册 Worker

```typescript
// 创建树 (如果不存在则自动创建)
pool.ensurePath('/asia/japan');

// 注册 Worker 到指定路径
pool.registerWorker('/asia/japan/worker-tokyo-001', {
  id: 'worker-tokyo-001',
  region: 'JP',
  proxy: 'http://127.0.0.1:8890',
  maxStrategies: 5,
});

// 树结构自动创建：
// root
// └── asia
//     └── japan
//         └── worker-tokyo-001
```

### 查找 Worker

```typescript
// 精确路径查找
const worker = pool.get('/asia/japan/worker-tokyo-001');

// 通配符查找
const workers = pool.find('/asia/japan/*');
// → [worker-tokyo-001, worker-tokyo-002]

// 标签匹配查找
const workers = pool.findByTags({
  region: 'JP',
  proxy: 'http://127.0.0.1:8890',
});

// 递归查找所有可用 Worker
const workers = pool.findAvailable('/asia/*', {
  minMemory: 100,
});
```

### 节点选择策略

```typescript
// 在匹配的路径中选择最优 Worker
const worker = pool.select('/asia/japan/*', {
  strategy: 'least-loaded',  // 最少负载
  // strategy: 'round-robin',  // 轮询
  // strategy: 'random',       // 随机
});
```

---

## 调度流程

### 场景：日本 IP 策略调度

```typescript
// 1. 策略注册
const strategy = {
  id: 'grid-btc-jp',
  requirements: {
    path: '/asia/japan/*',  // 必须在日本区域
  }
};

// 2. 调度器查找
const candidates = pool.find('/asia/japan/*');
// → [worker-tokyo-001, worker-tokyo-002]

// 3. 选择最优
const selected = pool.select('/asia/japan/*', { strategy: 'least-loaded' });
// → worker-tokyo-001 (负载更低)

// 4. 分配策略
selected.assignStrategy(strategy);
```

### 场景：无区域要求策略

```typescript
// 策略无区域要求
const strategy = {
  id: 'monitor-global',
  requirements: {},  // 空，任意 Worker
};

// 从整棵树查找
const candidates = pool.find('/*/*/*');  // 所有 Worker
// → [worker-tokyo-001, worker-tokyo-002, worker-us-west-001, ...]

// 全局最优选择
const selected = pool.select('/*/*/*', { strategy: 'least-loaded' });
```

---

## 树索引实现

### 1. 路径解析

```typescript
class TreeIndex {
  private root: PoolNode;
  private index = new Map<string, PoolNode>();  // 快速查找
  
  // 解析路径: "/asia/japan/worker-001" → ['asia', 'japan', 'worker-001']
  parsePath(path: string): string[] {
    return path.split('/').filter(Boolean);
  }
  
  // 获取或创建节点
  ensurePath(path: string): PoolNode {
    const segments = this.parsePath(path);
    let current = this.root;
    
    for (const segment of segments) {
      if (!current.children.has(segment)) {
        const newNode: PoolNode = {
          id: segment,
          path: current.path + '/' + segment,
          type: 'region',
          parent: current,
          children: new Map(),
          stats: { totalWorkers: 0, availableWorkers: 0, runningStrategies: 0 },
        };
        current.children.set(segment, newNode);
        this.index.set(newNode.path, newNode);
      }
      current = current.children.get(segment)!;
    }
    
    return current;
  }
}
```

### 2. 通配符匹配

```typescript
// 匹配路径模式
matchPattern(path: string, pattern: string): boolean {
  const pathSegments = this.parsePath(path);
  const patternSegments = this.parsePath(pattern);
  
  if (patternSegments.length !== pathSegments.length) {
    return false;
  }
  
  for (let i = 0; i < patternSegments.length; i++) {
    const patternSeg = patternSegments[i];
    const pathSeg = pathSegments[i];
    
    if (patternSeg === '*') {
      continue;  // 通配符匹配任意
    }
    
    if (patternSeg !== pathSeg) {
      return false;
    }
  }
  
  return true;
}

// 查找匹配的所有 Worker
find(pattern: string): Worker[] {
  const results: Worker[] = [];
  
  for (const [path, node] of this.index) {
    if (node.type !== 'worker') continue;
    
    if (this.matchPattern(path, pattern)) {
      results.push(node.worker!);
    }
  }
  
  return results;
}
```

### 3. 标签索引

```typescript
// 多维度标签索引
class TagIndex {
  private byRegion = new Map<string, Set<Worker>>();
  private byProxy = new Map<string, Set<Worker>>();
  private byAPI = new Map<string, Set<Worker>>();
  
  // Worker 注册时建立索引
  index(worker: Worker) {
    const { region, proxy, apis } = worker.capabilities;
    
    if (region) {
      if (!this.byRegion.has(region)) {
        this.byRegion.set(region, new Set());
      }
      this.byRegion.get(region)!.add(worker);
    }
    
    if (proxy) {
      if (!this.byProxy.has(proxy)) {
        this.byProxy.set(proxy, new Set());
      }
      this.byProxy.get(proxy)!.add(worker);
    }
    
    for (const api of apis) {
      if (!this.byAPI.has(api)) {
        this.byAPI.set(api, new Set());
      }
      this.byAPI.get(api)!.add(worker);
    }
  }
  
  // 多标签交集查询
  findByTags(tags: Partial<WorkerCapabilities>): Worker[] {
    const sets: Set<Worker>[] = [];
    
    if (tags.region) {
      sets.push(this.byRegion.get(tags.region) || new Set());
    }
    
    if (tags.proxy) {
      sets.push(this.byProxy.get(tags.proxy) || new Set());
    }
    
    if (tags.apis) {
      for (const api of tags.apis) {
        sets.push(this.byAPI.get(api) || new Set());
      }
    }
    
    // 取交集
    if (sets.length === 0) return [];
    
    const result = new Set(sets[0]);
    for (let i = 1; i < sets.length; i++) {
      for (const worker of result) {
        if (!sets[i].has(worker)) {
          result.delete(worker);
        }
      }
    }
    
    return Array.from(result);
  }
}
```

---

## 与现有 workpool-lib 集成

```typescript
// workpool-lib 提供基础资源管理
import { Engine, Resource, Work } from '@moltbaby/workpool-lib';

// TreePool 在 workpool-lib 之上构建树状索引
class TreeWorkerPool {
  private engine: Engine;
  private treeIndex: TreeIndex;
  private tagIndex: TagIndex;
  
  constructor(engine: Engine) {
    this.engine = engine;
    this.treeIndex = new TreeIndex();
    this.tagIndex = new TagIndex();
  }
  
  // Worker 注册 (同时注册到 workpool-lib 和树索引)
  async registerWorker(path: string, worker: Worker) {
    // 1. 注册到 workpool-lib
    const resource: Resource<WorkerSpec, WorkerState> = {
      id: worker.id,
      spec: worker.spec,
      state: worker.state,
    };
    await this.engine.registerResource(resource);
    
    // 2. 注册到树索引
    const node = this.treeIndex.ensurePath(path);
    node.type = 'worker';
    node.worker = worker;
    
    // 3. 注册到标签索引
    this.tagIndex.index(worker);
  }
  
  // 策略调度 (使用树索引快速查找)
  async scheduleStrategy(strategy: Strategy): Promise<Worker | null> {
    // 1. 解析策略的资源要求
    const requirements = strategy.requirements;
    
    // 2. 查找候选 Worker
    let candidates: Worker[];
    
    if (requirements.path) {
      // 使用树路径查找
      candidates = this.treeIndex.find(requirements.path);
    } else if (requirements.tags) {
      // 使用标签查找
      candidates = this.tagIndex.findByTags(requirements.tags);
    } else {
      // 全局查找
      candidates = this.treeIndex.find('/*/*/*');
    }
    
    // 3. 过滤可用 Worker
    const available = candidates.filter(w => w.state.status === 'ready');
    
    // 4. 选择最优
    if (available.length === 0) return null;
    
    return this.selectBest(available);
  }
}
```

---

## 典型使用场景

### 场景 1: 日本 IP 策略

```typescript
// Worker 注册
pool.registerWorker('/asia/japan/tokyo-001', {
  id: 'worker-tokyo-001',
  capabilities: { region: 'JP', proxy: 'http://127.0.0.1:8890' }
});

// 策略调度
const strategy = {
  requirements: { path: '/asia/japan/*' }
};

const worker = pool.scheduleStrategy(strategy);
// → worker-tokyo-001 或 worker-tokyo-002
```

### 场景 2: 多区域备份

```typescript
// 策略需要日本IP，但主 Worker 故障
const strategy = {
  requirements: { path: '/asia/japan/*' },
  failover: { path: '/asia/singapore/*' }  // 故障时转新加坡
};

// 主调度
let worker = pool.scheduleStrategy(strategy);

// 主故障，使用备份
if (!worker || worker.state.status === 'offline') {
  worker = pool.scheduleStrategy({ requirements: strategy.failover });
}
```

### 场景 3: 全局负载均衡

```typescript
// 策略无区域要求，全局最优
const strategy = {
  requirements: {}  // 空，任意 Worker
};

const worker = pool.select('/*/*/*', { strategy: 'least-loaded' });
// → 从整棵树找负载最低的 Worker
```

---

## 实施步骤

1. **TreeIndex 实现** - 路径解析、节点创建、通配符匹配
2. **TagIndex 实现** - 多维度标签索引、交集查询
3. **TreeWorkerPool 封装** - 集成 workpool-lib + 树索引
4. **Worker 注册改造** - 支持路径注册
5. **调度器改造** - 支持路径匹配调度

这样设计树状 Worker Pool OK？🦀
