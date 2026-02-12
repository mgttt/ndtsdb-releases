# [ARCHIVED] IMPLEMENTATION-v2

> **归档日期**: 2026-02-11
> **原因**: 设计已迭代/功能已实现/方案已废弃
> **最新状态见**: README.md / DESIGN.md / ROADMAP.md

---

# Quant-Lab 实施计划 v2.0 - 树状 Worker Pool

> 更新日期: 2026-02-08  
> 主要变更: 新增树状 Worker Pool 作为 Phase 2

---

## 架构确认

```
Layer 3: 策略 JS (QuickJS 沙箱) ✅ 已定
Layer 2: Worker (Node.js) + 树状 Worker Pool 🔄 当前
Layer 1: workpool-lib (资源调度) ✅ 已定
```

---

## 新实施计划

### Phase 1: Worker 基础框架 ✅ 已完成

**文件**:
- `worker/lifecycle.ts` - st_worker_init/heartbeat/exit
- `worker/sandbox-manager.ts` - QuickJS 沙箱管理
- `worker/api-pool.ts` - API 预加载
- `worker/log-buffer.ts` - 日志缓冲

---

### Phase 2: 树状 Worker Pool 🔄 当前

**目标**: 实现树状索引和路径调度

**任务**:

| 优先级 | 任务 | 文件 | 验收标准 |
|--------|------|------|---------|
| P0 | TreeIndex 实现 | `pool/tree-index.ts` | 路径解析、节点创建、通配符匹配 |
| P0 | TagIndex 实现 | `pool/tag-index.ts` | 多维度标签索引、交集查询 |
| P0 | TreeWorkerPool | `pool/tree-pool.ts` | 集成 workpool-lib + 树索引 |
| P1 | Worker 路径注册 | `worker/registration.ts` | 支持路径注册到树 |
| P1 | 路径调度器 | `pool/scheduler.ts` | 支持路径匹配调度 |

**关键接口**:

```typescript
// Worker 注册到树
pool.registerWorker('/asia/japan/worker-001', {
  id: 'worker-001',
  capabilities: { region: 'JP', proxy: 'http://127.0.0.1:8890' }
});

// 策略调度
const strategy = { requirements: { path: '/asia/japan/*' } };
const worker = pool.scheduleStrategy(strategy);
```

---

### Phase 3: API 桥接与策略运行

**目标**: 策略能在沙箱内调用 API

**任务**:

| 优先级 | 任务 | 文件 |
|--------|------|------|
| P0 | 桥接函数 | `worker/bridge/` |
| P0 | 测试策略 | `strategies/test/bridge-test.ts` |
| P1 | Worker 启动加载策略 | `worker/strategy-loader.ts` |

---

### Phase 4: workpool 集成与完整测试

**目标**: 完整端到端测试

**任务**:
- 集成 workpool-lib Engine
- Director 调度器实现
- 故障恢复测试
- 性能测试

---

## 立即开始 Phase 2

创建树状 Worker Pool 核心实现 🦀
