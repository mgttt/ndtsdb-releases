# workpool-lib v2.1

通用资源编排框架 - 统一调度 AI Agent、容器、终端会话等资源。

## 目录结构

```
workpool-lib/
├── src/
│   ├── index.ts              # 主入口，导出所有类型
│   ├── core/                 # 核心抽象
│   │   ├── Task.ts           # 任务定义
│   │   ├── Worker.ts         # 工作节点
│   │   ├── Pool.ts           # 资源池
│   │   └── Scheduler.ts      # 调度器
│   ├── engine/
│   │   └── Engine.ts         # 编排引擎（主类）
│   ├── control/
│   │   └── ControlBus.ts     # 控制信号总线
│   ├── store/
│   │   ├── FileStore.ts      # 文件存储
│   │   └── MemoryStore.ts    # 内存存储
│   ├── lock/
│   │   └── FileLock.ts       # 文件锁（分布式互斥）
│   └── helpers.ts            # 辅助函数
├── package.json
└── tsconfig.json
```

## 核心概念

### Resource（资源）
任意可执行工作的实体：AI Bot、容器、tmux 会话等。

### Work（工作单元）
任意待执行的任务：部署指令、交易信号、爬取请求等。

### Engine（编排引擎）
核心调度器，负责资源分配、生命周期管理、全局控制。

## 使用模式

### 1. 常驻模式（Daemon）
适合服务器、高频交易、实时系统。

### 2. Cron 模式（Stateless）
适合笔记本、边缘设备、CI/CD，带文件锁防并发。

### 3. 混合模式（Hybrid）
自适应，无常驻实例时自动启动。

## 快速开始

```typescript
import { Engine, FileStore } from '@moltbaby/workpool-lib';

const engine = new Engine({
  store: new FileStore('.ipc/my-pool')
});

// 注册资源
await engine.register('bot-007', ['code', 'deploy'], 2);

// 提交工作
await engine.submit('task-001', { cmd: 'deploy.sh' }, ['deploy']);

// 启动调度
engine.start();
```

## 双模式示例

### 常驻模式
```typescript
engine.start();  // 内部 setInterval
```

### Cron 模式（带锁）
```typescript
const executed = await engine.tickWithLock();
if (!executed) process.exit(0);  // 未获取到锁，退出
```

## 锁机制

支持多锁共存，同一目录可运行多个独立调度器：

```typescript
// 调度器 A
new Engine({ store, lock: { name: 'scheduler-a' } });

// 调度器 B
new Engine({ store, lock: { name: 'scheduler-b' } });
```

## 适用场景

- AI Agent 协调
- 量化交易策略调度
- 容器/Pod 编排
- tmux/终端会话管理
- CI/CD 构建队列
- 浏览器自动化农场

## 设计原则

1. 完全泛型 - 不预设资源类型
2. 双模式支持 - 常驻 + Cron
3. 分布式锁 - 文件锁防并发
4. 原子写入 - 防数据损坏
5. 可插拔存储 - File/Memory/Redis
