# 全市场回放模拟需求评估

## 📊 需求分析

**场景**: 几千个产品同时回放模拟
**数据量**: 假设 3000 个产品 × 1分钟 K线 × 1年 = 15亿条记录
**关键要求**:
1. 多路数据流同时输出
2. 严格时间对齐（所有产品同一时刻）
3. 实时聚合计算（指数、波动率等）
4. 可控制回放速度（1x, 2x, 10x）
5. 低延迟（<100ms）

---

## ✅ 目前 data-lib 能支持的部分

| 能力 | 状态 | 说明 |
|------|------|------|
| 存储 15亿条记录 | ✅ | mmap + 压缩，支持 TB 级 |
| 查询性能 | ✅ | 143M/s 扫描，足够快 |
| 多线程读取 | ✅ | 并行查询已实现 |
| 时间范围查询 | ✅ | B-Tree 索引 O(log n) |
| Symbol 过滤 | ✅ | Bitmap 索引 O(1) |

---

## ❌ 目前 **缺少** 的关键实现

### 1. ASOF JOIN（时间序列对齐）⭐⭐⭐
**这是什么**: 把多个产品的数据按时间戳对齐到同一时间点

```sql
-- 对齐 AAPL 和 GOOGL 的价格
SELECT 
  AAPL.timestamp,
  AAPL.price as aapl_price,
  GOOGL.price as googl_price
FROM AAPL
ASOF JOIN GOOGL ON AAPL.timestamp >= GOOGL.timestamp
```

**为什么重要**: 
- 不同产品交易时间可能不同（停牌、熔断）
- 需要对齐到同一时刻才能计算相关性、价差等

**实现复杂度**: 中等（需要排序合并算法）

### 2. 流式聚合引擎 ⭐⭐⭐
**这是什么**: 持续查询，数据写入时自动更新聚合结果

```typescript
// 实时计算 VWAP
const vwapStream = table.createStream()
  .groupBy('symbol')
  .window('1m')  // 1分钟滚动窗口
  .aggregate({
    vwap: 'sum(price * volume) / sum(volume)',
    volume: 'sum(volume)'
  });

// 每来一条新数据，自动输出更新后的 VWAP
vwapStream.on('data', (update) => {
  console.log(update); // { symbol: 'AAPL', vwap: 150.5, volume: 10000 }
});
```

**为什么重要**:
- 回放时需要实时计算指标
- 不能每次都全表扫描

**实现复杂度**: 高（需要流式计算框架）

### 3. 多路合并流（MergeStream）⭐⭐⭐
**这是什么**: 把多个 symbol 的数据流按时间戳合并成一个有序流

```typescript
const streams = symbols.map(s => table.getStream(s));

const merged = new MergeStream(streams, {
  keySelector: row => row.timestamp,
  bufferSize: 1000  // 预缓冲 1000 条
});

// 按时间顺序输出所有产品的数据
merged.on('data', (row) => {
  console.log(row.timestamp, row.symbol, row.price);
});
```

**为什么重要**:
- 回放时需要严格按时间顺序输出
- 需要处理不同产品的数据到达延迟

**实现复杂度**: 中等（优先队列 + 缓冲）

### 4. 回放控制器 ⭐⭐
**这是什么**: 控制回放速度、暂停、跳转

```typescript
const player = new ReplayController(table, {
  speed: 2.0,        // 2倍速
  startTime: '2024-01-01T09:30:00',
  endTime: '2024-01-01T16:00:00',
  symbols: ['AAPL', 'GOOGL', 'MSFT']  // 3000个
});

player.on('tick', (batch) => {
  // 同一时刻的所有产品数据
  console.log(batch.timestamp);
  console.log(batch.data); // [{symbol: 'AAPL', price: 150}, ...]
});

player.play();
player.pause();
player.seek('2024-01-01T12:00:00');
player.setSpeed(10); // 切换到 10 倍速
```

**实现复杂度**: 低（主要是定时器 + 缓冲）

### 5. 窗口函数（TUMBLE/HOP）⭐⭐
**这是什么**: 滑动窗口、跳跃窗口聚合

```sql
-- 每 5 分钟计算一次 10 分钟 VWAP
SELECT 
  symbol,
  TUMBLE(timestamp, '10m') as window,
  sum(price * volume) / sum(volume) as vwap
FROM trades
GROUP BY symbol, TUMBLE(timestamp, '10m')
EMIT WITH DELAY '5m'  -- 每 5 分钟输出一次
```

**为什么重要**:
- 回放时需要计算滑动指标
- 不同策略可能需要不同窗口

**实现复杂度**: 中等

---

## 🎯 诚实评估

### 目前 data-lib 能做什么？
- ✅ 存储和查询历史数据（没问题）
- ✅ 单产品回放（可以）
- ❌ 多产品时间对齐回放（缺 ASOF JOIN）
- ❌ 实时聚合（缺流式引擎）
- ❌ 严格时序输出（缺 MergeStream）

### 最小可行方案（MVP）
如果要 **立即支持** 全市场回放，最少需要：

1. **ASOF JOIN** - 时间对齐（2-3天）
2. **MergeStream** - 多路合并（2-3天）
3. **ReplayController** - 回放控制（1-2天）

**合计**: 1 周左右可以实现基础版

### 完整方案
如果要 **生产级** 支持：

1. ASOF JOIN（3天）
2. 流式聚合引擎（1周）
3. MergeStream（3天）
4. ReplayController（2天）
5. 窗口函数（3天）
6. 性能优化（3天）

**合计**: 3-4 周

---

## 💡 建议实现路径

### 阶段 1: 立即可用（1周）
实现 ASOF JOIN + MergeStream + ReplayController
- 支持基础的多产品回放
- 速度控制、暂停、跳转
- 简单聚合（预计算）

### 阶段 2: 生产级（+2-3周）
实现流式聚合引擎 + 窗口函数
- 实时指标计算
- 复杂策略支持
- 高性能优化

---

## 🤔 需要确认的问题

1. **数据源**: 是读取历史数据回放，还是接实时行情？
2. **聚合复杂度**: 需要实时计算哪些指标？（VWAP、RSI、波动率？）
3. **延迟要求**: 毫秒级还是秒级可以接受？
4. **产品数量**: 同时回放 3000 个还是更多？
5. **回放速度**: 需要支持 100x 快放吗？

请提供这些信息，我可以给出更精确的评估！
