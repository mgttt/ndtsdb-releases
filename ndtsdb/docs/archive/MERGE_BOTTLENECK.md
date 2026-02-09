# 多路归并的硬盘瓶颈分析

## 🚨 问题确认

你说得对！**多路归并的瓶颈确实在硬盘**。

### 为什么？

```
3000个文件同时读取
     ↓
SSD: "我要随机读3000个位置！"
     ↓
IOPS 爆炸 💥
```

### 具体计算

假设：
- 每个文件读取块：4KB
- 3000个文件同时读
- 每次迭代读取：3000 × 4KB = 12MB
- 15.8亿条记录 ÷ 1000条/块 = 158万次读取
- 总读取量：158万 × 12MB = **19TB**（不可能！）

**结论**： naive 的多路归并会把硬盘搞挂

---

## ✅ 解决方案

### 方案 1: 大缓冲区 + 批量读取 (推荐)

```typescript
class BufferedMergeStream {
  private buffers: Map<string, ArrayBuffer> = new Map();
  private pointers: Map<string, number> = new Map();
  private BUFFER_SIZE = 10 * 1024 * 1024; // 10MB 缓冲区

  async init(symbols: string[]) {
    for (const symbol of symbols) {
      // 每个文件预读 10MB 到内存
      this.buffers.set(symbol, await readChunk(symbol, 0, this.BUFFER_SIZE));
      this.pointers.set(symbol, 0);
    }
  }

  *merge(): Generator<{ timestamp: bigint; symbol: string; price: number }> {
    while (this.hasData()) {
      // 在内存中找到最小时间戳
      let minTimestamp = Infinity;
      let minSymbol = '';
      
      for (const [symbol, buffer] of this.buffers) {
        const ptr = this.pointers.get(symbol)!;
        if (ptr < buffer.length) {
          const ts = this.readTimestamp(buffer, ptr);
          if (ts < minTimestamp) {
            minTimestamp = ts;
            minSymbol = symbol;
          }
        }
      }

      // 输出最小时间戳的记录
      yield this.readRecord(minSymbol);

      // 推进指针
      this.pointers.set(minSymbol, this.pointers.get(minSymbol)! + 1);

      // 缓冲区空了，异步加载更多
      if (this.needRefill(minSymbol)) {
        this.refillBuffer(minSymbol); // 异步，不阻塞
      }
    }
  }
}
```

**硬盘访问模式**：
- 顺序读 10MB → 内存处理 1000条 → 再顺序读 10MB
- 每个文件：~160次顺序读取（而不是158万次随机读取）
- **总读取量**：38GB（原始数据量，合理）

---

### 方案 2: 分层归并 (Merge Tree)

```
Round 1:                     Round 2:                    Round 3:
┌─────┐ ┌─────┐ ┌─────┐     ┌───────┐ ┌───────┐        ┌─────────┐
│AAPL │ │GOOGL│ │MSFT │ ──→ │group-0│ │group-1│ ──→    │  final  │
└─────┘ └─────┘ └─────┘     └───────┘ └───────┘        └─────────┘
 100个   100个   100个         3000个
 文件    文件    文件

先100路归并，再30路归并，最后1路输出
```

**优势**：
- 每次只打开 100 个文件（不是3000个）
- 分层处理，内存压力小
- 可以并行执行（多核）

**劣势**：
- 需要临时文件（中间结果）
- 实现复杂度高

---

### 方案 3: 内存映射 + 预读

```typescript
class MmapMergeStream {
  private mmaps: Map<string, MmapManager> = new Map();
  private prefetchQueue: string[] = [];

  async init(symbols: string[]) {
    for (const symbol of symbols) {
      const mmap = new MmapManager(`${symbol}.bin`);
      mmap.open();
      this.mmaps.set(symbol, mmap);
      
      // 告诉OS预读这个文件
      mmap.adviseSequential();
    }
  }

  // OS 会自动做预读优化
  *merge(): Generator<Record> {
    while (true) {
      // 找到最小时间戳
      const min = this.findMin();
      if (!min) break;
      
      yield min.record;
      
      // 推进该文件的指针
      // OS 会在后台预读下一页
    }
  }
}
```

**依赖**：OS 的 readahead 机制
**效果**：SSD 上接近顺序读性能

---

## 📊 性能对比

| 方案 | 同时打开文件 | 随机I/O | 内存占用 | 实现复杂度 |
|------|------------|---------|----------|-----------|
| Naive 多路归并 | 3000 | 158万次 | 低 | 低 |
| **大缓冲区** | 3000 | **0** (批量顺序读) | **300MB** (10MB×30) | 中 |
| **分层归并** | **100** | **0** | 低 | 高 |
| **Mmap+预读** | 3000 | 依赖OS | 低 | 低 |

---

## 🎯 推荐实现

### 针对你的场景（3000产品，回测）

**推荐：大缓冲区 + 批量读取**

原因：
1. **实现简单** - 比分层归并简单很多
2. **性能好** - 接近纯顺序读
3. **内存可控** - 10MB × 30 = 300MB（可调整）
4. **SSD友好** - 顺序读最大化SSD性能

```typescript
// 核心优化：批量读取 + 内存归并
class OptimizedMergeStream {
  private readonly BATCH_SIZE = 10000; // 每次读10000条
  private buffers: Map<string, ArrayBuffer> = new Map();
  
  async *stream(): Generator<UnifiedRecord> {
    // 1. 批量读取所有文件的头部
    await this.prefillBuffers();
    
    // 2. 内存中归并（零硬盘访问）
    while (this.hasData()) {
      const min = this.findMinInMemory();
      yield min.record;
      
      // 3. 异步填充缓冲区（不阻塞）
      if (this.bufferLow(min.symbol)) {
        this.asyncRefill(min.symbol);
      }
    }
  }
}
```

---

## 🤔 最终结论

**硬盘瓶颈确实存在，但可以通过以下方式解决：**

1. **大缓冲区** (10MB per file)
2. **批量顺序读取** (不是4KB随机读)
3. **异步预加载** (不阻塞归并流程)

**这样可以把随机I/O变成顺序I/O，SSD可以handle 3000路顺序读。**

**HDD的话，必须用分层归并，限制同时打开文件数。**

---

## 💡 简单实现（今天要）

```typescript
// 最简单的可行方案：预加载到内存
// 8GB 内存服务器完全可以handle

async function loadAllToMemory(symbols: string[]) {
  const allData = [];
  
  // 分批加载，避免同时打开3000文件
  for (const batch of chunk(symbols, 100)) {
    const batchData = await Promise.all(
      batch.map(s => loadFile(s))
    );
    allData.push(...batchData);
  }
  
  // 统一排序
  return mergeAndSort(allData);
}

// 然后直接在内存中回放，零硬盘访问
```

**要我立即实现这个吗？**
