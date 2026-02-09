# 全市场回测存储架构评估

## 🚨 关键瓶颈确认

**你说得对！几千个文件确实是致命瓶颈。**

### 当前 data-lib 的问题
```
data/
├── AAPL.bin      (1个产品1个文件)
├── GOOGL.bin
├── MSFT.bin
├── ...
└── ZZZZ.bin      (3000个文件！)
```

**问题**:
- Linux 文件句柄限制: 1024 (可调到 65535，但...)
- 打开 3000 个文件耗时: ~300-500ms
- 内存映射 3000 个文件: 内存碎片化
- SSD 随机读取: IOPS 爆炸

**结论**: 当前架构无法支撑几千产品的全市场回测

---

## ✅ 解决方案: 单文件多产品存储

### 方案 1: 单文件分区存储 (推荐 ⭐⭐⭐)

```
market_data.bin  (单个文件存储所有产品)
├── Header
│   └── 分区索引 (symbol → 偏移量)
├── 分区1: AAPL_202401
│   └── 1分钟K线数据
├── 分区2: AAPL_202402
├── 分区3: GOOGL_202401
└── 分区N: ZZZZ_202412
```

**优势**:
- 只有一个文件句柄 ✅
- 顺序读取性能极佳 ✅
- 内存映射一次 ✅
- 按时间分区，查询裁剪 ✅

**实现复杂度**: 中等（需要重写存储层）

### 方案 2: 分层合并存储 (LSM-Tree 风格)

```
data/
├── hot/                    # 内存表
│   └── today.mem
├── level0/                 # 小时级文件
│   ├── 20240101_10.bin   # 10点数据 (所有产品)
│   └── 20240101_11.bin
├── level1/                 # 日级文件
│   └── 20240101.bin
└── level2/                 # 月级文件
    └── 202401.bin
```

**优势**:
- 写性能极佳 ✅
- 自动合并小文件 ✅
- 冷热分离 ✅

**劣势**:
- 读时需要合并多文件
- 实现复杂度高

### 方案 3: 混合方案 (推荐 ⭐⭐)

```
market_data/
├── index.json              # 全局索引
├── 2024-01.bin            # 按月分区 (所有产品)
├── 2024-02.bin
├── 2024-03.bin
└── ...
```

**优势**:
- 平衡了单文件大小和查询效率
- 12个文件支撑1年数据
- 每个文件包含所有产品该月数据

---

## 🏗️ 推荐架构: MultiSymbolStore

```typescript
class MultiSymbolStore {
  // 单文件存储所有产品
  private dataFile: string;
  
  // 内存索引: symbol → 分区列表
  private index: Map<string, Array<{
    month: string;      // 2024-01
    offset: number;     // 文件偏移
    count: number;      // 行数
  }>>;

  // 查询时
  query(symbols: string[], start: Date, end: Date) {
    // 1. 查索引定位分区
    // 2. mmap 读取对应区块
    // 3. 内存中过滤
  }
}
```

### 文件格式设计

```
[File Header 1KB]
├── Magic: "DATAMKT"
├── Version: 1
├── Symbol Count: 3000
├── Index Offset: 1024
├── Index Size: 60000  // 20 bytes × 3000

[Symbol Index Table]
├── Symbol: "AAPL" (8 bytes)
├── Partition Count: 12
├── Partitions Offset: 1048576
└── ... (每个 symbol 20 bytes)

[Partition Data]
├── Partition Header
│   ├── Month: "2024-01"
│   ├── Row Count: 44640 (31天 × 1440分钟)
│   └── Columns: [timestamp, open, high, low, close, volume]
├── Compressed Data (Gorilla + Delta)
└── ...
```

---

## 📊 性能对比

| 方案 | 文件数 | 打开时间 | 查询延迟 | 实现难度 |
|------|--------|----------|----------|----------|
| 当前 (1产品1文件) | 3000 | 500ms | 100ms | 低 |
| 单文件多产品 | 1 | 10ms | 5ms | 中 |
| LSM-Tree | 100+ | 50ms | 20ms | 高 |
| 按月分区 | 12 | 20ms | 10ms | 低 |

---

## 🎯 建议实施计划

### 阶段 1: 紧急修复 (2-3天)
**目标**: 立即支持几千产品回测

1. **实现 MultiSymbolStore**
   - 单文件存储所有产品
   - 内存索引 symbol → 偏移量
   - 支持批量查询

2. **数据迁移脚本**
   - 把现有多文件合并为单文件
   - 自动生成索引

### 阶段 2: 性能优化 (1周)
**目标**: 生产级性能

1. **压缩存储**
   - Gorilla 压缩价格
   - Delta 压缩时间戳
   - 预计节省 70-90% 空间

2. **预聚合**
   - 预计算日级、周级聚合
   - 回测时快速加载

3. **智能缓存**
   - LRU 缓存热点产品
   - 预加载策略

### 阶段 3: 高级功能 (1-2周)
**目标**: 支持复杂策略

1. **ASOF JOIN** (时间对齐)
2. **回放引擎** (时序流)
3. **实时指标** (滑动窗口)

---

## 💡 临时方案 (今天可用)

如果你需要 **今天就开始回测**，可以：

```typescript
// 1. 把 3000 个产品数据加载到内存
const allData = new Map<string, ColumnarTable>();

// 2. 分批加载，避免同时打开所有文件
const BATCH_SIZE = 100;
for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
  const batch = symbols.slice(i, i + BATCH_SIZE);
  for (const symbol of batch) {
    allData.set(symbol, loadSync(`${symbol}.bin`));
  }
  // 回测这 100 个
  backtest(batch);
  // 释放内存
  for (const symbol of batch) {
    allData.delete(symbol);
  }
}
```

**缺点**: 不能跨产品套利（一次只能处理100个）

---

## 🤔 决策点

请确认：

1. **数据量**: 3000 产品 × 1分钟 × 1年 = 15亿条，对吧？
2. **存储预算**: 压缩后约 10-30GB，可以接受吗？
3. **回测频率**: 每天回测一次，还是开发阶段频繁回测？
4. **是否接受**: 先实现临时方案（分批加载），还是直接做重构？

**我的建议**: 立即开始实现 MultiSymbolStore，这是地基问题！
