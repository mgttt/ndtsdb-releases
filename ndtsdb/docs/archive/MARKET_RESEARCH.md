# 时序数据库全市场回放方案调研

## 📚 主流方案总结

### 1. QuestDB 的方案

**关键词**: ASOF JOIN, SIMD, 内存映射

```sql
-- QuestDB 的 ASOF JOIN（时间对齐）
SELECT 
  a.timestamp,
  a.price as aapl_price,
  b.price as googl_price
FROM aapl AS a
ASOF JOIN googl AS b
WHERE a.timestamp >= b.timestamp
```

**实现原理**:
- 数据按时间分区存储（parquet/二进制）
- 查询时 mmap 映射分区到内存
- ASOF JOIN 使用 SIMD 加速归并
- 支持纳秒级时间戳

**QuestDB 如何处理多产品**:
- 每个 symbol 独立分区文件
- 查询时按需加载分区
- 使用 LATEST ON 语法获取最新值
- **缺点**: 3000产品同时回放仍需加载3000个分区

---

### 2. ClickHouse 的方案

**关键词**: MergeTree, 向量化执行, 稀疏索引

```sql
-- ClickHouse 的多产品查询
SELECT 
  timestamp,
  groupArray((symbol, price)) as prices
FROM trades
WHERE timestamp BETWEEN '2024-01-01' AND '2024-01-02'
GROUP BY timestamp
ORDER BY timestamp
```

**实现原理**:
- MergeTree 引擎：按时间排序的 LSM 结构
- 稀疏索引：每8192行一个索引标记
- 向量化执行：一次处理多行
- 预聚合：物化视图加速

**ClickHouse 如何处理多产品**:
- 数据按 (symbol, timestamp) 排序存储
- 稀疏索引快速定位
- **缺点**: 大量随机读仍是问题

---

### 3. TimescaleDB 的方案

**关键词**: Hypertable, 连续聚合, 压缩

```sql
-- TimescaleDB 的超表
SELECT 
  time_bucket('1 minute', timestamp) as minute,
  symbol,
  avg(price) as avg_price
FROM trades
GROUP BY minute, symbol
```

**实现原理**:
- Hypertable：自动分片（按时间）
- 连续聚合：自动维护物化视图
- 压缩：旧数据自动压缩

**TimescaleDB 如何处理多产品**:
- 超表自动管理分区
- 查询时可能涉及多个分区
- **缺点**: 分区过多时性能下降

---

### 4. 专业交易系统方案

#### kdb+/q

**业界标准**（金融高频交易）

```q
// kdb+ 的 splayed table（分区表）
/ 每个 symbol 一个目录
/ 查询时按需加载

// 多产品对齐
select timestamp, price by symbol from trades where timestamp within (start; end)
```

**实现原理**:
- Splayed table：每个 symbol 一个目录
- 内存映射：mmap 映射到内存
- 列式存储：向量化处理
- **优点**: 成熟稳定，华尔街广泛使用
- **缺点**: 3000产品仍需打开3000个文件

#### Onetick

**专业级方案**

**关键设计**:
- 数据按 **时间分区** 而非 symbol 分区
- 单文件包含所有产品某一时间段数据
- 查询时只需打开时间范围内的文件

```
data/
├── 2024-01-01.bin  # 当天所有产品
├── 2024-01-02.bin  # 当天所有产品
└── ...
```

**优点**:
- 回放时顺序读取（最优）
- 时间范围查询极快
- 跨产品分析高效

**缺点**:
- 单文件写入需要锁
- 不适合高频写入场景

---

## 🎯 关键洞察

### 问题核心

**3000产品回放的本质问题**:
- 不是"如何存储"
- 而是"如何最小化硬盘随机I/O"

### 业界共识

| 方案 | 适用场景 | 3000产品回放支持 |
|------|---------|-----------------|
| Symbol分区（现状） | 单产品查询 | ❌ 3000个文件 |
| 时间分区（Onetick） | 全市场回放 | ✅ 顺序读 |
| 内存数据库（kdb+） | 高频交易 | ✅ 预加载 |
| 分布式存储 | 大规模集群 | ⚠️ 网络开销 |

### 推荐方案

**对于你的场景（回测）**:

**方案 1: 时间分区（推荐）**
```
data/
├── 2024-01-01.bin  # 当天3000产品
├── 2024-01-02.bin
└── ...
```
- 回放时顺序读取（SSD满速）
- 365个文件，打开无压力
- 跨天查询合并结果

**方案 2: 内存预热（推荐）**
```typescript
// 回测前加载到内存
const data = await loadAll(symbols);  // 3-8GB
for (const tick of replay(data)) {
  strategy.onTick(tick);
}
```
- 零硬盘访问
- 微秒级延迟
- 内存占用可控

---

## 💡 结论

**没有银弹，必须做权衡**:

1. **高频写入 + 单产品查询** → Symbol分区（现状）
2. **全市场回放 + 读多写少** → 时间分区（推荐）
3. **极致性能 + 内存充足** → 内存数据库（推荐）

**你的场景是"全市场回放"，应该选方案 2 或 3**。
