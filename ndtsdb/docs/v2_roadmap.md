# ndtsdb v2 Roadmap - 分布式演进

## 背景

基于对 [DeepSeek 3FS](https://github.com/deepseek-ai/3FS) 的技术研究，评估其分布式文件系统架构对 ndtsdb 的优化启发。

---

## 3FS 核心技术

### 1. Disaggregated Architecture（分离式架构）
- **存储层**：180 节点 × 16 NVMe SSD + 2×200Gbps RDMA
- **聚合吞吐**：6.6 TiB/s
- **locality-oblivious**：应用层无需关心数据物理位置

### 2. CRAQ (Chain Replication with Apportioned Queries)
- **强一致性**：写操作通过 chain 复制
- **读写分离**：读操作可命中 replica 节点

### 3. 无状态元数据层
- **存储后端**：FoundationDB (分布式事务 KV)
- **接口**：标准 POSIX 文件 API

### 4. RDMA 网络
- **零拷贝**：内核旁路，DMA 直达应用内存
- **低延迟**：微秒级（vs 毫秒级 TCP）

### 5. 性能指标
| 测试 | 配置 | 吞吐 |
|------|------|------|
| Peak Read | 180 存储节点 + 500 客户端 | 6.6 TiB/s |
| GraySort | 110.5 TiB 数据 / 8192 分区 | 3.66 TiB/min |
| KVCache | 推理缓存读取 | 40 GiB/s (峰值) |

---

## ndtsdb 当前架构

### 优势
- **列式存储** + mmap zero-copy (3000 文件 60ms 加载)
- **C FFI SIMD** 加速 (143M rows/s 扫描，1.16B/s 求和)
- **Gorilla 压缩** (70-95% 压缩率)
- **K-way 归并回放** (8.9M ticks/s, 487K snapshots/s)
- **轻量灵活** (Bun + TypeScript，可单机可集群)

### 瓶颈
- **单机容量限制**：存储受限于单节点磁盘
- **网络 I/O 未优化**：全市场回放需要本地磁盘，无法远程拉取
- **缺乏分布式能力**：无法水平扩展存储和计算

---

## 技术启发与适用性分析

### ✅ 适合采用

#### 1. RDMA 网络优化 ⭐⭐⭐⭐⭐

**场景**：多节点回测集群，计算节点从存储节点拉取 tick 数据

**当前问题**：
- TCP socket + 序列化 (JSON/Protobuf) → 高延迟 + CPU 开销
- 数据需要拷贝多次：磁盘 → 内核缓冲区 → 用户空间 → 网络

**优化方案**：RDMA read → 直接 DMA 到计算节点内存
```typescript
// 存储节点暴露 RDMA 内存区域
const storage = new RDMAMemoryRegion(mmap_buffer, { 
  address: symbolTable[symbolId].offset,
  length: symbolTable[symbolId].size 
});

// 计算节点直接 RDMA read（零拷贝）
const ticks = await rdma.read(storageNode, symbolId, startTs, endTs);
```

**收益**：
- 延迟：ms 级 → μs 级
- 吞吐：10-100x 提升
- CPU：释放序列化开销

**硬件需求**：
- Mellanox/Intel RDMA NIC (RoCE v2 或 InfiniBand)
- 软件栈：libibverbs + Rust binding (rdma-sys)

**成本**：
- RoCE 网卡：$200-500/张 (复用现有以太网交换机)
- InfiniBand：$500-1500/张 + IB 交换机

---

#### 2. 分布式元数据层 ⭐⭐⭐⭐

**当前问题**：
- 符号表管理靠文件系统，无法支持：
  - 跨节点查询 (`SELECT * FROM ticks WHERE symbol IN (...)`)
  - 分片/副本管理
  - 快照/版本控制

**方案**：引入轻量级分布式 KV 存储

| KV Store | 优势 | 劣势 |
|----------|------|------|
| **etcd** | 成熟稳定，K8s 生态 | 写入吞吐受限 (~10K ops/s) |
| **TiKV** | 高吞吐，Raft 复制 | 部署复杂，资源占用高 |
| **FoundationDB** | ACID 事务，强一致 | 配置复杂，社区较小 |

**推荐**：etcd (首选) / TiKV (高吞吐场景)

**元数据模型**：
```
符号表: /symbols/{symbol} → { shards: [node1:shard1, node2:shard2], ... }
分片表: /shards/{shardId} → { replicas: [node1, node2, node3], primary: node1 }
索引表: /indexes/{symbol}/{tsRange} → { shardId, offset, length }
```

**收益**：
- 支持 SQL 跨产品聚合查询
- 水平扩展存储容量 (分片)
- 高可用 (多副本)

---

#### 3. 存储节点池化 ⭐⭐⭐

**当前**：单机模式（应用 + 存储同进程）

**优化**：存储服务 + 计算服务分离

```
┌──────────────────────────┐
│   计算节点 (策略回测)      │
│   Bun + Strategy Engine   │
│   无状态，可水平扩展        │
└───────────┬──────────────┘
            │ RDMA read
┌───────────▼──────────────┐
│      存储节点池            │
│   mmap + SIMD + Gorilla   │
│   180 nodes × 16 SSDs     │
│   聚合容量：~40 PB         │
└──────────────────────────┘
```

**API 设计**：
```typescript
const client = new NDTSClient({ 
  metaStore: 'etcd://meta.cluster:2379',
  storageNodes: ['rdma://node1:9000', 'rdma://node2:9000', ...] 
});

// 自动路由到对应存储节点
const stream = await client.replayTicks(['BTCUSDT', 'ETHUSDT'], {
  start: Date.now() - 86400_000,
  end: Date.now()
});

for await (const tick of stream) {
  strategy.onTick(tick);
}
```

**收益**：
- **弹性扩展**：计算节点按需启动，存储节点独立扩容
- **成本优化**：存储节点用 HDD/QLC SSD，计算节点用高 CPU
- **资源复用**：多个回测任务共享存储池

---

### ❌ 不适合采用

#### 1. CRAQ 强一致性复制

**原因**：
- ndtsdb 是**时序数据库**，append-only 写入为主
- 不需要 ACID 事务（K 线数据不会回滚）
- 强一致性会牺牲写入吞吐（chain 复制的同步开销）

**替代方案**：
- **异步复制** + 最终一致性
- **Checksum 校验** (CRC32) 保证数据完整性
- 读操作优先本地副本，降低延迟

---

#### 2. 通用文件接口 (POSIX)

**原因**：
- 3FS 暴露 POSIX 是为了兼容已有应用（减少迁移成本）
- ndtsdb 已有专用列式格式 (`.ndts`)，针对时序数据优化
- 通用文件接口会引入不必要的抽象层

**保持现状**：
- 继续使用 `.ndts` 二进制格式
- 存储节点暴露专用 RPC 接口 (RDMA read/write)

---

## 实施路线图

### Phase 1: RDMA 原型验证 (2 周)

**目标**：验证 RDMA 在 ndtsdb 场景下的性能收益

**任务**：
1. **环境搭建**
   - 2 台服务器 + RDMA 网卡 (RoCE v2)
   - 安装 libibverbs + rdma-core

2. **代码实现**
   - Rust FFI: RDMA read/write primitive
   - Bun 绑定：`rdma.read(addr, len) → Uint8Array`

3. **性能基准**
   - 本地 mmap: 加载 1GB tick 数据耗时
   - RDMA read: 远程拉取 1GB tick 数据耗时
   - 对比延迟/吞吐

**成功标准**：
- RDMA read 延迟 < 100μs (vs mmap ~10ms 冷启动)
- 吞吐 > 10 GiB/s (单链路 25Gbps RDMA)

---

### Phase 2: 元数据服务 (3 周)

**目标**：实现分布式符号表和分片管理

**任务**：
1. **技术选型**
   - etcd vs TiKV 压测
   - 元数据 schema 设计

2. **核心功能**
   - 符号注册：`registerSymbol(symbol) → symbolId`
   - 分片分配：`getShards(symbol) → [node1, node2, ...]`
   - 路由查询：`locate(symbol, timestamp) → {node, offset, length}`

3. **客户端集成**
   - `NDTSClient` 自动查询元数据
   - 连接池管理

**成功标准**：
- 符号查询延迟 < 1ms (etcd 本地缓存)
- 支持 1000+ 符号的元数据管理

---

### Phase 3: 存储节点池化 (4 周)

**目标**：存储和计算分离，支持多节点部署

**任务**：
1. **存储服务进程**
   - RDMA server 监听
   - mmap 管理 + SIMD 加速
   - Gorilla 压缩/解压

2. **计算节点客户端**
   - `NDTSClient` 连接池
   - 负载均衡 (round-robin / least-loaded)
   - 失败重试 + 故障转移

3. **回测集群部署**
   - 3 存储节点 (各 16 SSDs)
   - 10 计算节点 (无状态)
   - etcd 元数据集群 (3 节点)

**成功标准**：
- 全市场回放吞吐 > 50M ticks/s (vs 单机 8.9M)
- 故障节点自动摘除，无数据丢失

---

### Phase 4: 生产优化 (持续)

**任务**：
1. **监控体系**
   - Prometheus + Grafana
   - 关键指标：RDMA 吞吐、延迟分布、缓存命中率

2. **自动化运维**
   - 节点健康检查
   - 分片自动平衡
   - 数据副本自动修复

3. **成本优化**
   - 冷数据归档到对象存储 (S3/MinIO)
   - 热数据保留在 RDMA 存储池

---

## 架构对比

| 维度 | v1 (当前) | v2 (分布式) |
|------|-----------|------------|
| **部署** | 单机模式 | 存储 + 计算分离 |
| **容量** | 单节点磁盘 (~40TB) | 池化扩展 (~PB 级) |
| **吞吐** | 8.9M ticks/s | 50M+ ticks/s |
| **延迟** | 本地 mmap (~ms) | RDMA 远程读 (~μs) |
| **高可用** | 无 | 多副本 + 故障转移 |
| **成本** | 低 (开发机) | 中 (集群硬件 + 网络) |
| **复杂度** | 低 | 中高 (分布式协调) |

---

## 兼容性设计

**核心原则**：v1 单机模式和 v2 分布式模式统一 API，按需切换

**统一接口**：
```typescript
// v1: 单机模式
const client = new NDTSClient({ 
  mode: 'standalone',
  dataDir: './data'
});
const table = await client.loadSymbol('BTCUSDT');

// v2: 分布式模式
const client = new NDTSClient({ 
  mode: 'distributed',
  metaStore: 'etcd://...',
  storageNodes: [...] 
});
const table = await client.loadSymbol('BTCUSDT');
```

**渐进式迁移**：
1. 单机用户：`mode: 'standalone'` (默认)
2. 集群用户：`mode: 'distributed'` + 配置元数据服务
3. 代码无需修改，只需切换配置

---

## 风险评估

| 风险 | 严重性 | 缓解措施 |
|------|--------|---------|
| **RDMA 硬件成本** | 中 | 先用 RoCE (复用以太网)，再考虑 IB |
| **etcd 单点故障** | 高 | 3 节点 Raft 集群，定期备份 |
| **网络分区** | 中 | 客户端重试 + 降级到本地缓存 |
| **元数据不一致** | 高 | etcd 强一致性保证 + CRC 校验 |
| **架构复杂度** | 中 | 统一 API，模式切换只需配置 |

---

## 总结

**核心启发**：
1. **RDMA 是关键** — 3FS 的 6.6 TiB/s 主要来自 RDMA，ndtsdb 的 mmap 已优化本地路径，下一步应优化网络路径
2. **分离式架构** — 存储和计算分离可独立扩展，符合云原生趋势
3. **灵活部署** — 单机和集群模式统一架构，用户按需选择

**优先级**：
- **P0**: RDMA 原型验证 (2 周) — 验证技术可行性
- **P1**: 元数据服务 (3 周) — 分布式基础设施
- **P1**: 存储节点池化 (4 周) — 水平扩展能力
- **P2**: 生产优化 (持续) — 监控/运维/成本

**下一步行动**：
1. 采购 2 张 RoCE 网卡 + RDMA 测试环境
2. 实现 Rust RDMA FFI 原型
3. 基准测试：本地 mmap vs 远程 RDMA read

---

*2026-02-09 - 基于 DeepSeek 3FS 技术研究*
