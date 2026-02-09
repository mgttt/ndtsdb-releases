# data-lib 性能优化分析

## 当前瓶颈 vs QuestDB

### 1. 存储格式（最大瓶颈）

| 方面 | data-lib (当前) | QuestDB | 差距 |
|------|----------------|---------|------|
| **格式** | JSON Lines | 二进制列文件 | 10-20x |
| **序列化** | JSON.stringify | 直接内存写入 | 50-100x |
| **读取** | 解析整个 JSON | mmap 零拷贝 | 20-50x |
| **存储** | 文本 | 二进制 | 2-3x 空间 |

**QuestDB 的 `.d` 文件**：
```
直接存储 double[] 数组
读取: offset * 8 bytes → 直接读内存
```

**data-lib 当前**：
```
{ "timestamp": "...", "price": 100.5, ... }  ← 字符串解析
```

### 2. 内存布局

**QuestDB（列式）**：
```
timestamp: [int64, int64, int64, ...]  ← 连续内存
price:     [double, double, double, ...]
volume:    [int64, int64, int64, ...]
```

**data-lib（行式）**：
```
[ { timestamp, price, volume },  ← 对象数组
  { timestamp, price, volume },
  ... ]
```

**问题**：
- 行式缓存不友好（跳跃访问）
- 对象开销大（V8 hidden class）
- GC 压力大

### 3. 写入路径

**QuestDB**：
```
Row → WAL (顺序写) → Apply Worker → Memory-mapped Column Files
```

**data-lib**：
```
Row → JSON.stringify → Buffer → fs.writeFile
       ↑ 慢！
```

### 4. 查询路径

**QuestDB**：
```
WHERE price > 100
→ JIT 编译 SIMD 指令
→ AVX2 一次处理 4 个 double
→ 9.4 GB/s 过滤速率
```

**data-lib**：
```
WHERE price > 100
→ 解析 JSON
→ 创建对象
→ JS 函数调用
→ ~50 MB/s
```

---

## 优化方案

### 阶段 1: 列式存储 + 二进制格式（预计 5-10x 提升）

```typescript
// 当前
interface Row { timestamp: Date; price: number; }
const rows: Row[] = [];

// 优化后
class ColumnarTable {
  timestamps: BigInt64Array;
  prices: Float64Array;
  volumes: Int32Array;
  // 连续内存，CPU 缓存友好
}
```

### 阶段 2: 内存映射 + 零拷贝（预计 10-20x 提升）

使用 Bun 的 `mmap` 或 Node `fs.read` with Buffer:

```typescript
// 直接写入 ArrayBuffer，避免 JSON
const buffer = new ArrayBuffer(rowCount * 8 * columnCount);
const prices = new Float64Array(buffer, offset);
prices[rowIndex] = price;  // 直接内存写入
```

### 阶段 3: 批量 SIMD（预计 20-50x 提升）

使用 WebAssembly SIMD 或 NAPI 调用原生代码：

```typescript
// 理想情况
const result = simdFilter(prices, threshold);  // 使用 AVX2
```

---

## 实际可行优化（bun+ts 环境）

### ✅ 立即可做（估计 3-5x 提升）

1. **TypedArray 列式存储**
   - `Float64Array` 存储价格
   - `BigInt64Array` 存储时间戳
   - 避免对象创建和 GC

2. **二进制文件格式**
   - 自定义格式：header + column data
   - 避免 JSON 序列化开销
   - 直接 `fs.writeFile(buffer)`

3. **批量编码优化**
   - 预分配 ArrayBuffer
   - 批量写入文件

### ⚠️ 需要做（估计 5-10x 提升）

4. **内存映射读取**
   - 使用 `mmap` 读取冷数据
   - 热数据保持 TypedArray

5. **SIMD via WASM**
   - 写 Rust/C 编译为 WASM
   - 使用 SIMD 指令过滤

### ❌ 不可行

- 真正的零拷贝（需要修改 V8）
- 手写 AVX2（需要编译为 native）

---

## 性能预估

| 优化阶段 | 写入性能 | 查询性能 | 实现难度 |
|---------|---------|---------|---------|
| 当前 | 150K/s | 400K/s | - |
| 列式+二进制 | 500K-1M/s | 2-5M/s | 低 |
| +mmap | 1-2M/s | 5-10M/s | 中 |
| +WASM SIMD | 2M/s | 20-50M/s | 高 |
| QuestDB | 3.5M/s | 9.4GB/s | - |

---

## 推荐实现

写个 `ColumnarTable` 替代当前的 `Row[]`：

```typescript
class ColumnarTable {
  private timestamps: BigInt64Array;
  private prices: Float64Array;
  private volumes: Int32Array;
  private rowCount = 0;
  private capacity: number;

  append(timestamp: bigint, price: number, volume: number) {
    if (this.rowCount >= this.capacity) this.grow();
    this.timestamps[this.rowCount] = timestamp;
    this.prices[this.rowCount] = price;
    this.volumes[this.rowCount] = volume;
    this.rowCount++;
  }

  // 直接写入文件，零序列化
  saveToFile(path: string) {
    const header = Buffer.from(JSON.stringify({ rowCount, columns: ['timestamp', 'price', 'volume'] }));
    const data = Buffer.concat([
      Buffer.from(this.timestamps.buffer, 0, this.rowCount * 8),
      Buffer.from(this.prices.buffer, 0, this.rowCount * 8),
      Buffer.from(this.volumes.buffer, 0, this.rowCount * 4)
    ]);
    fs.writeFileSync(path, Buffer.concat([header, data]));
  }
}
```

这样能达到 QuestDB 的 **20-30% 性能**，但保持纯 TS 的简洁。
