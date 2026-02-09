// ============================================================
// 时间桶方案 POC — 消除 Heap 操作
// ============================================================

import { MmapPool } from '../src/mmap/pool.js';

const PRODUCT_COUNT = 3000;
const testDir = './data/benchmark';

console.log('🧪 时间桶方案 POC\n');

// ─── 加载数据 ────────────────────────────────────────

const pool = new MmapPool();
const symbols: string[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  symbols.push(`SYM${String(i).padStart(5, '0')}`);
}
pool.init(symbols, testDir);

// ─── 方案对比 ────────────────────────────────────────

// 预处理数据
const tsArrays: Float64Array[] = [];
const priceArrays: Float64Array[] = [];
const volumeArrays: Int32Array[] = [];

for (let i = 0; i < symbols.length; i++) {
  const sym = symbols[i];
  const ts = pool.getColumn<BigInt64Array>(sym, 'timestamp');
  const price = pool.getColumn<Float64Array>(sym, 'price');
  const volume = pool.getColumn<Int32Array>(sym, 'volume');
  
  const tsNum = new Float64Array(ts.length);
  for (let j = 0; j < ts.length; j++) tsNum[j] = Number(ts[j]);
  
  tsArrays.push(tsNum);
  priceArrays.push(price);
  volumeArrays.push(volume);
}

// ─── 时间桶预索引 ────────────────────────────────────

console.log('📦 构建时间桶索引...');
const indexStart = performance.now();

// 收集所有唯一时间戳
const allTimestamps = new Set<number>();
for (let i = 0; i < PRODUCT_COUNT; i++) {
  const ts = tsArrays[i];
  for (let j = 0; j < ts.length; j++) {
    allTimestamps.add(ts[j]);
  }
}

// 排序时间戳
const sortedTs = Float64Array.from(allTimestamps).sort();
const tsCount = sortedTs.length;

// 为每个时间戳创建 symbol 列表
// timeBuckets[tsIndex] = [symIdx, cursor, symIdx, cursor, ...]
const timeBuckets: Int32Array[] = new Array(tsCount);
const tsToIndex = new Map<number, number>();
for (let i = 0; i < tsCount; i++) {
  tsToIndex.set(sortedTs[i], i);
  timeBuckets[i] = new Int32Array(0); // 临时空数组
}

// 构建每个时间戳包含的 (symIdx, cursor) 对
const bucketBuilders: number[][] = new Array(tsCount);
for (let i = 0; i < tsCount; i++) bucketBuilders[i] = [];

for (let symIdx = 0; symIdx < PRODUCT_COUNT; symIdx++) {
  const ts = tsArrays[symIdx];
  for (let cursor = 0; cursor < ts.length; cursor++) {
    const tsIndex = tsToIndex.get(ts[cursor])!;
    bucketBuilders[tsIndex].push(symIdx, cursor);
  }
}

// 转为 Int32Array
for (let i = 0; i < tsCount; i++) {
  timeBuckets[i] = Int32Array.from(bucketBuilders[i]);
}

const indexTime = performance.now() - indexStart;
console.log(`  索引构建: ${indexTime.toFixed(1)}ms`);
console.log(`  唯一时间戳: ${tsCount}`);
console.log(`  总 ticks: ${bucketBuilders.reduce((s, b) => s + b.length / 2, 0)}`);

// ─── 时间桶回放 ────────────────────────────────────────

console.log('\n🚀 时间桶回放...');

const dataPool: Record<string, number>[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  dataPool.push({ price: 0, volume: 0 });
}

const replayStart = performance.now();
let snapshots = 0;
let ticks = 0;

for (let tsIdx = 0; tsIdx < tsCount; tsIdx++) {
  const bucket = timeBuckets[tsIdx];
  const bucketLen = bucket.length;
  
  // 更新这个时间戳的所有 symbol
  for (let i = 0; i < bucketLen; i += 2) {
    const symIdx = bucket[i];
    const cursor = bucket[i + 1];
    dataPool[symIdx].price = priceArrays[symIdx][cursor];
    dataPool[symIdx].volume = volumeArrays[symIdx][cursor];
    ticks++;
  }
  
  // yield snapshot (模拟)
  snapshots++;
}

const replayTime = performance.now() - replayStart;
const snapsPerSec = snapshots / replayTime * 1000;

console.log(`  回放时间: ${replayTime.toFixed(1)}ms`);
console.log(`  Snapshots: ${snapshots}`);
console.log(`  Ticks: ${ticks}`);
console.log(`  速度: ${(snapsPerSec / 1000).toFixed(1)}K snapshots/s`);

// ─── 对比原始 Heap 方案 ────────────────────────────────

console.log('\n📊 对比原始 Heap 方案...');

class MinHeap4 {
  heap: { ts: number; idx: number; cursor: number }[] = [];
  
  push(ts: number, idx: number, cursor: number) {
    this.heap.push({ ts, idx, cursor });
    let i = this.heap.length - 1;
    while (i > 0) {
      const p = ((i - 1) / 4) | 0;
      if (this.heap[i].ts >= this.heap[p].ts) break;
      [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
      i = p;
    }
  }
  
  fixTop() {
    const heap = this.heap;
    const n = heap.length;
    let i = 0;
    while (true) {
      const base = 4 * i + 1;
      if (base >= n) break;
      let smallest = i, smallestTs = heap[i].ts;
      for (let c = 0; c < 4 && base + c < n; c++) {
        if (heap[base + c].ts < smallestTs) {
          smallest = base + c;
          smallestTs = heap[base + c].ts;
        }
      }
      if (smallest === i) break;
      [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
      i = smallest;
    }
  }
  
  peek() { return this.heap[0]; }
  pop() {
    const min = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.fixTop();
    }
    return min;
  }
  get size() { return this.heap.length; }
}

// 重置 dataPool
for (let i = 0; i < PRODUCT_COUNT; i++) {
  dataPool[i].price = 0;
  dataPool[i].volume = 0;
}

const heap = new MinHeap4();
for (let i = 0; i < PRODUCT_COUNT; i++) {
  if (tsArrays[i].length > 0) {
    heap.push(tsArrays[i][0], i, 0);
  }
}

const heapStart = performance.now();
let heapSnaps = 0;
let heapTicks = 0;
let pendingTs = -1;

while (heap.size > 0) {
  const entry = heap.peek()!;
  const ts = entry.ts;
  
  if (ts !== pendingTs) {
    if (pendingTs !== -1) heapSnaps++;
    pendingTs = ts;
  }
  
  const symIdx = entry.idx;
  const cursor = entry.cursor;
  dataPool[symIdx].price = priceArrays[symIdx][cursor];
  dataPool[symIdx].volume = volumeArrays[symIdx][cursor];
  heapTicks++;
  
  const nextCursor = cursor + 1;
  if (nextCursor < tsArrays[symIdx].length) {
    entry.ts = tsArrays[symIdx][nextCursor];
    entry.cursor = nextCursor;
    heap.fixTop();
  } else {
    heap.pop();
  }
}
if (pendingTs !== -1) heapSnaps++;

const heapTime = performance.now() - heapStart;
const heapSnapsPerSec = heapSnaps / heapTime * 1000;

console.log(`  Heap 回放时间: ${heapTime.toFixed(1)}ms`);
console.log(`  Heap Snapshots: ${heapSnaps}`);
console.log(`  Heap 速度: ${(heapSnapsPerSec / 1000).toFixed(1)}K snapshots/s`);

// ─── 总结 ────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log('📊 总结\n');

const speedup = snapsPerSec / heapSnapsPerSec;
console.log(`  时间桶方案: ${(snapsPerSec / 1000).toFixed(1)}K/s`);
console.log(`  Heap 方案:  ${(heapSnapsPerSec / 1000).toFixed(1)}K/s`);
console.log(`  加速比:     ${speedup.toFixed(1)}x`);

if (snapsPerSec > 100000) {
  console.log('\n  ✅ 达到目标 100K/s!');
} else {
  console.log(`\n  ⚠️ 未达目标，还需 ${(100000 / snapsPerSec).toFixed(1)}x`);
}

pool.close();
