# 从底层逻辑解决全市场回放

## 🧠 问题本质

**不是"怎么存"，而是"怎么加载到内存"**

### 计算一下
- 3000 产品 × 1年 × 1440分钟/天 = 15.8亿条记录
- 每条记录：timestamp(8) + price(8) + volume(8) = 24字节
- 原始：38GB
- Gorilla压缩后：**3-8GB**

**结论**：完全 fits 内存！现代服务器 64-128GB 很常见

---

## ✅ 底层解决方案

### 核心思想：内存数据库

```
磁盘 (3000个文件)          内存 (单一列式存储)
     ↓ 预加载                  ↓ 回测时
┌─────────┐              ┌─────────────────────────┐
│ AAPL.bin│ ───────┐     │ timestamp │ bigint[]    │
│ GOOGL   │ ───────┼──→  │ symbol    │ int32[]     │ ← 3000个产品
│ MSFT    │ ───────┤     │ price     │ float64[]   │   混在一起
│ ...     │ ───────┘     │ volume    │ int32[]     │
│ ZZZZ    │              └─────────────────────────┘
└─────────┘                      ↓
                              ASOF JOIN
                              按时间戳排序输出
```

---

## 🏗️ 架构设计

### 1. 统一内存格式

```typescript
class UnifiedMemoryStore {
  // 所有产品的数据混在一起，按列存储
  private timestamp: BigInt64Array;
  private symbol: Int32Array;      // symbol 编码为整数
  private price: Float64Array;
  private volume: Int32Array;

  // 加载时把所有文件合并
  async loadAll(symbols: string[]): Promise<void> {
    const totalRows = symbols.length * 365 * 1440; // 预估
    
    this.timestamp = new BigInt64Array(totalRows);
    this.symbol = new Int32Array(totalRows);
    this.price = new Float64Array(totalRows);
    this.volume = new Int32Array(totalRows);

    let offset = 0;
    for (let i = 0; i < symbols.length; i++) {
      const data = await loadFromFile(`${symbols[i]}.bin`);
      
      // 批量拷贝到统一数组
      this.timestamp.set(data.timestamps, offset);
      this.symbol.fill(i, offset, offset + data.length);
      this.price.set(data.prices, offset);
      this.volume.set(data.volumes, offset);
      
      offset += data.length;
    }

    // 按时间戳排序（关键！）
    this.sortByTimestamp();
  }

  // 回放时直接内存访问
  *replay(): Generator<{ timestamp: bigint; symbol: number; price: number }> {
    for (let i = 0; i < this.timestamp.length; i++) {
      yield {
        timestamp: this.timestamp[i],
        symbol: this.symbol[i],
        price: this.price[i],
        volume: this.volume[i],
      };
    }
  }
}
```

---

### 2. ASOF JOIN（内存中实现）

```typescript
class InMemoryASOFJoin {
  // 已经按时间戳排序的统一数据
  private data: UnifiedMemoryStore;

  // 获取某一时刻所有产品的快照
  getSnapshot(timestamp: bigint): Map<number, number> {
    const snapshot = new Map<number, number>();
    
    // 二分查找定位
    const idx = this.binarySearch(timestamp);
    
    // 向前找到该时刻的所有记录
    let i = idx;
    while (i >= 0 && this.data.timestamp[i] === timestamp) {
      snapshot.set(this.data.symbol[i], this.data.price[i]);
      i--;
    }
    
    // 向后找
    i = idx + 1;
    while (i < this.data.timestamp.length && this.data.timestamp[i] === timestamp) {
      snapshot.set(this.data.symbol[i], this.data.price[i]);
      i++;
    }
    
    return snapshot;
  }

  // 流式回放（严格时间顺序）
  *streamPlayback(): Generator<{ time: bigint; prices: Map<number, number> }> {
    let currentTime = this.data.timestamp[0];
    let currentBatch = new Map<number, number>();

    for (let i = 0; i < this.data.timestamp.length; i++) {
      if (this.data.timestamp[i] !== currentTime) {
        // 输出上一批
        yield { time: currentTime, prices: currentBatch };
        
        // 新的一批
        currentTime = this.data.timestamp[i];
        currentBatch = new Map();
      }
      
      currentBatch.set(this.data.symbol[i], this.data.price[i]);
    }
    
    // 最后一批
    yield { time: currentTime, prices: currentBatch };
  }
}
```

---

### 3. 并行加载（解决I/O瓶颈）

```typescript
async function parallelLoad(symbols: string[]): Promise<UnifiedMemoryStore> {
  // 使用 8 个并行读取
  const CONCURRENCY = 8;
  const chunks = chunk(symbols, Math.ceil(symbols.length / CONCURRENCY));

  const results = await Promise.all(
    chunks.map(chunk => 
      Promise.all(chunk.map(s => loadFromFile(`${s}.bin`)))
    )
  );

  // 合并结果
  return mergeResults(results.flat());
}

// 加载时间估算
// 3000 文件 × 1MB = 3GB
// SSD 顺序读：500MB/s
// 并行读：3GB / 500MB/s = 6秒
```

---

## 📊 性能预估

| 指标 | 数值 |
|------|------|
| 数据总量 | 3-8GB (压缩后) |
| 加载时间 | 6-10秒 (SSD并行) |
| 内存占用 | 8-16GB (解压后) |
| 回放速度 | >100M ticks/秒 (内存访问) |
| 延迟 | <1ms (纯内存) |

---

## 🎯 实施步骤

### 阶段 1: 统一内存格式（2天）
```typescript
// 新增 UnifiedMemoryStore 类
// 支持从多文件加载到单一列式存储
// 按时间戳排序
```

### 阶段 2: ASOF JOIN（2天）
```typescript
// 内存中实现时间对齐
// 支持流式回放
// 支持快照查询
```

### 阶段 3: 回放引擎（2天）
```typescript
// 速度控制 (1x, 10x, 100x)
// 暂停/继续/跳转
// 实时指标计算
```

**总计：1 周实现生产级全市场回放**

---

## 💡 关键点

1. **磁盘存储保持现状** - 不改现有文件格式
2. **回测前批量加载** - 把3000个文件合并到内存
3. **内存中统一格式** - 单一列式存储，便于计算
4. **预排序** - 加载时按时间戳排序，回放直接遍历
5. **ASOF JOIN在内存做** - O(1) 或 O(log n)，极快

---

## 🤔 这方案的优势

- ✅ **不改存储层** - 现有数据文件完全兼容
- ✅ **简单** - 没有复杂的文件格式设计
- ✅ **快** - 纯内存操作，微秒级延迟
- ✅ **灵活** - 支持任意复杂的时间对齐逻辑
- ✅ **可扩展** - 数据量再大可以分片加载

**这才是从底层逻辑解决问题：内存足够，就别纠结文件格式！**
