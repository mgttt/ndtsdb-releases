// 细粒度 Snapshot 回放 Profiling
import { MmapPool } from '../src/mmap/pool.js';

const PRODUCT_COUNT = 3000;
const testDir = './data/benchmark';

console.log('🔬 Snapshot 回放瓶颈分析\n');

// 加载数据
const pool = new MmapPool();
const symbols: string[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  symbols.push(`SYM${String(i).padStart(5, '0')}`);
}
pool.init(symbols, testDir);

// 获取原始数据
const tsArrays: Float64Array[] = [];
const priceArrays: Float64Array[] = [];
const volumeArrays: Int32Array[] = [];

console.log('📦 预处理数据...');
const prepStart = performance.now();

for (let i = 0; i < symbols.length; i++) {
  const sym = symbols[i];
  const ts = pool.getColumn<BigInt64Array>(sym, 'timestamp');
  const price = pool.getColumn<Float64Array>(sym, 'price');
  const volume = pool.getColumn<Int32Array>(sym, 'volume');
  
  // 转换 BigInt64 -> Float64
  const tsNum = new Float64Array(ts.length);
  for (let j = 0; j < ts.length; j++) tsNum[j] = Number(ts[j]);
  
  tsArrays.push(tsNum);
  priceArrays.push(price);
  volumeArrays.push(volume);
}
console.log(`  预处理: ${(performance.now() - prepStart).toFixed(1)}ms\n`);

// ─── 微基准测试 ───────────────────────────────────────

console.log('🔬 微基准测试:\n');

// 1. 4-ary Heap siftDown
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

// 初始化堆
const heap = new MinHeap4();
for (let i = 0; i < PRODUCT_COUNT; i++) {
  if (tsArrays[i].length > 0) {
    heap.push(tsArrays[i][0], i, 0);
  }
}

// 测试纯 heap 操作速度
const ITER = 100000;
const heapClone = new MinHeap4();
for (let i = 0; i < PRODUCT_COUNT; i++) heapClone.push(Math.random() * 1e9, i, 0);

const t1 = performance.now();
for (let i = 0; i < ITER; i++) {
  heapClone.heap[0].ts = Math.random() * 1e9;
  heapClone.fixTop();
}
const heapMs = performance.now() - t1;
console.log(`  1. Heap fixTop (3000 nodes) x${ITER}: ${heapMs.toFixed(1)}ms → ${(ITER/heapMs*1000).toFixed(0)}/s`);

// 2. 对象属性写入
const dataPool: Record<string, number>[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  dataPool.push({ price: 0, volume: 0 });
}

const t2 = performance.now();
for (let i = 0; i < ITER; i++) {
  const idx = i % PRODUCT_COUNT;
  dataPool[idx].price = i * 1.1;
  dataPool[idx].volume = i;
}
const objMs = performance.now() - t2;
console.log(`  2. Object prop write x${ITER}: ${objMs.toFixed(1)}ms → ${(ITER/objMs*1000).toFixed(0)}/s`);

// 3. TypedArray 随机读
const t3 = performance.now();
let sum = 0;
for (let i = 0; i < ITER; i++) {
  const symIdx = i % PRODUCT_COUNT;
  const cursor = (i * 7) % 1000;
  sum += priceArrays[symIdx][cursor];
}
const readMs = performance.now() - t3;
console.log(`  3. TypedArray random read x${ITER}: ${readMs.toFixed(1)}ms → ${(ITER/readMs*1000).toFixed(0)}/s`);

// 4. Generator yield 开销
function* testGen() {
  for (let i = 0; i < ITER; i++) yield { ts: i, data: dataPool[0] };
}
const t4 = performance.now();
let cnt = 0;
for (const _ of testGen()) cnt++;
const genMs = performance.now() - t4;
console.log(`  4. Generator yield x${ITER}: ${genMs.toFixed(1)}ms → ${(ITER/genMs*1000).toFixed(0)}/s`);

// 5. Map.set 开销
const testMap = new Map<string, Record<string, number>>();
const t5 = performance.now();
for (let i = 0; i < ITER; i++) {
  testMap.set(symbols[i % PRODUCT_COUNT], dataPool[i % PRODUCT_COUNT]);
}
const mapMs = performance.now() - t5;
console.log(`  5. Map.set x${ITER}: ${mapMs.toFixed(1)}ms → ${(ITER/mapMs*1000).toFixed(0)}/s`);

// 6. Int32Array 写入
const changedBuffer = new Int32Array(PRODUCT_COUNT);
const t6 = performance.now();
for (let i = 0; i < ITER; i++) {
  changedBuffer[i % PRODUCT_COUNT] = i;
}
const arrWriteMs = performance.now() - t6;
console.log(`  6. Int32Array write x${ITER}: ${arrWriteMs.toFixed(1)}ms → ${(ITER/arrWriteMs*1000).toFixed(0)}/s`);

// ─── 模拟完整 Snapshot 循环 ────────────────────────────

console.log('\n🔬 模拟 Snapshot 回放分解:\n');

// 重置堆
const simHeap = new MinHeap4();
const cursors = new Int32Array(PRODUCT_COUNT);
for (let i = 0; i < PRODUCT_COUNT; i++) {
  if (tsArrays[i].length > 0) {
    simHeap.push(tsArrays[i][0], i, 0);
    cursors[i] = 0;
  }
}

// 计时各部分
let heapTime = 0, updateTime = 0, yieldTime = 0, otherTime = 0;
let snapshots = 0, ticks = 0;
const maxSnaps = 5000;

const simStart = performance.now();
let pendingTs = -1;
const changed = new Int32Array(PRODUCT_COUNT);
let changedLen = 0;

while (simHeap.size > 0 && snapshots < maxSnaps) {
  const tA = performance.now();
  const entry = simHeap.peek()!;
  const ts = entry.ts;
  
  if (ts !== pendingTs) {
    if (pendingTs !== -1) {
      const tY = performance.now();
      // yield 模拟 (只计数)
      snapshots++;
      yieldTime += performance.now() - tY;
      changedLen = 0;
    }
    pendingTs = ts;
  }
  
  const tU = performance.now();
  const symIdx = entry.idx;
  const cursor = entry.cursor;
  
  // 更新 dataPool
  dataPool[symIdx].price = priceArrays[symIdx][cursor];
  dataPool[symIdx].volume = volumeArrays[symIdx][cursor];
  changed[changedLen++] = symIdx;
  ticks++;
  updateTime += performance.now() - tU;
  
  const tH = performance.now();
  // 推进堆
  const nextCursor = cursor + 1;
  if (nextCursor < tsArrays[symIdx].length) {
    entry.ts = tsArrays[symIdx][nextCursor];
    entry.cursor = nextCursor;
    simHeap.fixTop();
  } else {
    simHeap.pop();
  }
  heapTime += performance.now() - tH;
}

// 最后一个 snapshot
if (pendingTs !== -1) {
  snapshots++;
}

const simTotal = performance.now() - simStart;
otherTime = simTotal - heapTime - updateTime - yieldTime;

console.log(`  总耗时: ${simTotal.toFixed(1)}ms`);
console.log(`  Snapshots: ${snapshots}, Ticks: ${ticks}`);
console.log(`  Snapshot/s: ${(snapshots / simTotal * 1000).toFixed(0)}`);
console.log('');
console.log('  时间分解:');
console.log(`    Heap ops:   ${heapTime.toFixed(1)}ms (${(heapTime/simTotal*100).toFixed(1)}%)`);
console.log(`    Update:     ${updateTime.toFixed(1)}ms (${(updateTime/simTotal*100).toFixed(1)}%)`);
console.log(`    Yield:      ${yieldTime.toFixed(1)}ms (${(yieldTime/yieldTime*100).toFixed(1)}%)`);
console.log(`    Other:      ${otherTime.toFixed(1)}ms (${(otherTime/simTotal*100).toFixed(1)}%)`);

pool.close();
console.log('\n✅ Profiling 完成');
