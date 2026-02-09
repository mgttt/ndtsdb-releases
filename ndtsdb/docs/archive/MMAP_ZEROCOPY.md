# mmap + Zero-Copy 全市场回放方案

## 🎯 核心思路

**现状**: Symbol分区（高性能写入）→ **保留**  
**优化**: mmap + 预读 + zero-copy → **最小化资源占用**

```
磁盘 (3000个文件)
     ↓ mmap (虚拟内存映射)
虚拟地址空间 (巨大，但实际不占用物理内存)
     ↓
OS页缓存 (自动管理，热数据保留，冷数据换出)
     ↓ zero-copy读取
策略回测引擎
```

---

## ✅ 方案设计

### 1. 内存映射池 (MmapPool)

```typescript
class MmapPool {
  private maps: Map<string, MmappedColumnarTable> = new Map();
  private maxActiveMaps: number = 100;  // 同时活跃100个文件

  async init(symbols: string[]) {
    // 不真正加载数据，只建立内存映射
    for (const symbol of symbols) {
      const mmapped = new MmappedColumnarTable(`data/${symbol}.bin`);
      mmapped.open();  // 只 mmap，不读数据到内存
      this.maps.set(symbol, mmapped);
    }
    
    console.log(`✅ Mapped ${symbols.length} files to virtual memory`);
    console.log(`   Virtual memory: ~${(symbols.length * 100 / 1024).toFixed(1)} GB`);
    console.log(`   Physical memory: 0 MB (on-demand)`);
  }

  // 获取数据时触发缺页，OS自动加载
  getColumn(symbol: string, column: string): Float64Array {
    const mmapped = this.maps.get(symbol)!;
    return mmapped.getColumn(column);  // zero-copy读取
  }

  // 预读策略
  prefetch(symbols: string[], columns: string[]) {
    for (const symbol of symbols) {
      const mmapped = this.maps.get(symbol)!;
      // madvise: 提示OS预读这些列
      mmapped.adviseSequential(columns);
    }
  }
}
```

**资源占用**:
- 虚拟内存：3000 × 100MB = 300GB（看起来很大，但实际...）
- 物理内存：取决于 OS 实际加载的页（可能只有 1-2GB）

---

### 2. Zero-Copy 读取

```typescript
class MmappedColumnarTable {
  private fd: number;
  private buffer: ArrayBuffer;  // mmap映射的缓冲区
  private header: any;

  open() {
    // 1. 打开文件
    this.fd = fs.openSync(this.path, 'r');
    
    // 2. 获取文件大小
    const stats = fs.fstatSync(this.fd);
    const size = stats.size;
    
    // 3. mmap映射 (关键！)
    this.buffer = mmap(size, fd);  // 虚拟内存映射
    
    // 4. 解析header (只读header部分，触发1-2个页加载)
    this.header = this.parseHeader();
    
    // 5. madvise: 提示OS顺序读取优化
    madvise(this.buffer, MADV_SEQUENTIAL);
  }

  getColumn(name: string): Float64Array {
    const colInfo = this.header.columns[name];
    
    // Zero-copy: 直接返回mmap缓冲区的视图
    // 不分配新内存，不拷贝数据
    return new Float64Array(
      this.buffer,           // 同一个mmap缓冲区
      colInfo.offset,        // 列在文件中的偏移
      colInfo.count          // 元素数量
    );
  }

  // 预读提示
  adviseSequential(columns: string[]) {
    for (const col of columns) {
      const info = this.header.columns[col];
      // 提示OS预读这个列的数据
      madvise(
        this.buffer,
        info.offset,
        info.byteLength,
        MADV_WILLNEED  // "我会很快需要这些数据"
      );
    }
  }
}
```

**Zero-Copy 关键**:
- `new Float64Array(buffer, offset, length)` 只是创建视图
- 数据还在 mmap 的缓冲区里，没有被拷贝
- 访问时触发缺页中断，OS 从磁盘加载页到缓存

---

### 3. 智能预读策略

```typescript
class SmartPrefetcher {
  private pool: MmapPool;
  private activeWindow: Set<string> = new Set();
  private lookahead: number = 100;  // 预读100个产品

  constructor(pool: MmapPool) {
    this.pool = pool;
  }

  // 滑动窗口预读
  async slideWindow(allSymbols: string[], currentIndex: number) {
    // 确定窗口
    const windowStart = Math.max(0, currentIndex - 50);
    const windowEnd = Math.min(allSymbols.length, currentIndex + this.lookahead);
    const window = allSymbols.slice(windowStart, windowEnd);

    // 窗口内的产品：预读
    for (const symbol of window) {
      if (!this.activeWindow.has(symbol)) {
        this.pool.prefetch([symbol], ['timestamp', 'price', 'volume']);
        this.activeWindow.add(symbol);
      }
    }

    // 窗口外的产品：释放 (madvise MADV_DONTNEED)
    for (const symbol of this.activeWindow) {
      if (!window.includes(symbol)) {
        this.pool.madvise(symbol, MADV_DONTNEED);  // "这些数据可以释放了"
        this.activeWindow.delete(symbol);
      }
    }
  }
}
```

**效果**:
- 物理内存只保留活跃窗口的数据（比如100个产品 × 10MB = 1GB）
- 其他数据在虚拟内存里，不占物理内存
- OS 自动管理页缓存，LRU换出

---

### 4. 多路归并优化 (基于 mmap)

```typescript
class MmapMergeStream {
  private pool: MmapPool;
  private cursors: Map<string, number> = new Map();
  private buffers: Map<string, { ts: BigInt64Array; price: Float64Array }> = new Map();

  async init(symbols: string[]) {
    // 1. 建立所有文件的 mmap
    await this.pool.init(symbols);

    // 2. 为每个产品获取列数据 (zero-copy)
    for (const symbol of symbols) {
      this.buffers.set(symbol, {
        ts: this.pool.getColumn(symbol, 'timestamp'),
        price: this.pool.getColumn(symbol, 'price'),
      });
      this.cursors.set(symbol, 0);
    }
  }

  *replay(): Generator<{ timestamp: bigint; prices: Map<string, number> }> {
    while (this.hasData()) {
      // 在所有产品中找最小时间戳
      let minTs = Infinity;
      let minSymbol = '';

      for (const [symbol, { ts }] of this.buffers) {
        const cursor = this.cursors.get(symbol)!;
        if (cursor < ts.length) {
          const currentTs = Number(ts[cursor]);
          if (currentTs < minTs) {
            minTs = currentTs;
            minSymbol = symbol;
          }
        }
      }

      // 收集同一时刻的所有产品
      const batch = new Map<string, number>();
      const batchTs = this.buffers.get(minSymbol)!.ts[this.cursors.get(minSymbol)!];

      for (const [symbol, { ts, price }] of this.buffers) {
        const cursor = this.cursors.get(symbol)!;
        if (cursor < ts.length && ts[cursor] === batchTs) {
          batch.set(symbol, price[cursor]);
          this.cursors.set(symbol, cursor + 1);
        }
      }

      yield { timestamp: batchTs, prices: batch };
    }
  }
}
```

**关键优化**:
- 使用 mmap 的缓冲区直接比较时间戳（zero-copy）
- 不拷贝数据到新的缓冲区
- OS 自动处理页缓存

---

## 📊 资源对比

| 方案 | 虚拟内存 | 物理内存 | 硬盘I/O | 延迟 |
|------|---------|---------|---------|------|
| 全量加载 | 8GB | 8GB | 8GB顺序读 | 微秒 |
| **mmap zero-copy** | **300GB** | **1-2GB** | **按需加载** | **微秒** |
|  naive 多路归并 | - | 低 | 随机I/O爆炸 | 毫秒 |

---

## 💡 关键优势

### 1. 资源节省
- 虚拟内存可以很大（300GB），但物理内存只占用1-2GB（活跃数据）
- OS 自动管理，不需要自己实现 LRU

### 2. 零拷贝
- `new Float64Array(mmapBuffer, offset, length)` 只是创建视图
- 没有 `memcpy`，CPU 利用率低

### 3. 透明扩展
- 更多数据？mmap 更大的虚拟地址空间
- 内存不够？OS 自动换出冷数据

### 4. 多进程共享
- 多个回测进程可以 mmap 同一个文件
- OS 页缓存共享，物理内存只存一份

---

## 🎯 实施计划

### 阶段 1: MmapPool 实现 (1-2天)
```typescript
- 封装 mmap 操作
- 实现 zero-copy 列读取
- madvise 预读提示
```

### 阶段 2: 智能预读 (1天)
```typescript
- 滑动窗口策略
- 动态释放冷数据
- 性能监控
```

### 阶段 3: 多路归并 (1-2天)
```typescript
- 基于 mmap 的 merge stream
- 时间戳对齐输出
- 回放速度控制
```

**总计: 3-5 天实现生产级方案**

---

## 🤔 技术细节

### madvise 选项
```c
MADV_SEQUENTIAL:  "我会顺序访问" → OS预读优化
MADV_RANDOM:      "我会随机访问" → 禁用预读
MADV_WILLNEED:    "我很快需要这些数据" → 异步预加载
MADV_DONTNEED:    "这些数据可以释放了" → 回收物理内存
```

### 页大小
- 默认 4KB
- 大页 (HugePage) 2MB/1GB → 减少TLB miss
- 对于时序数据，大页可能更好

---

这个方案的核心是：**利用 OS 的虚拟内存机制，而不是自己管理内存**。OS 比我们的 LRU 实现更高效！
