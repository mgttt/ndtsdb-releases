/**
 * ndtsdb 性能瓶颈全面分析
 */

import { isNdtsReady, gorillaCompress, gorillaDecompress } from '../src/ndts-ffi.js';
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'fs';
import { join } from 'path';

console.log('🔬 ndtsdb 性能瓶颈全面分析\n');
console.log(`FFI: ${isNdtsReady() ? '✅' : '❌'}`);
console.log('═'.repeat(60));

// ─────────────────────────────────────────────────────────────
// 1. I/O 分析 - 原始文件读写
// ─────────────────────────────────────────────────────────────

console.log('\n📁 [1] I/O 瓶颈分析\n');

const TEST_DIR = './tests/fixtures/bottleneck';
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const fileSizes = [10, 100, 1000]; // KB per file
const fileCount = 1000;

for (const sizeKB of fileSizes) {
  const data = Buffer.alloc(sizeKB * 1024);
  for (let i = 0; i < data.length; i++) data[i] = i & 0xff;
  
  // 写入
  const t1 = performance.now();
  for (let i = 0; i < fileCount; i++) {
    writeFileSync(join(TEST_DIR, `f${i}.ndts`), data);
  }
  const writeTime = performance.now() - t1;
  
  // 读取 (冷)
  const t2 = performance.now();
  for (let i = 0; i < fileCount; i++) {
    readFileSync(join(TEST_DIR, `f${i}.ndts`));
  }
  const readTime = performance.now() - t2;
  
  const totalMB = fileCount * sizeKB / 1024;
  console.log(`${fileCount} × ${sizeKB}KB (${totalMB.toFixed(0)}MB): 写 ${(totalMB/writeTime*1000).toFixed(0)} MB/s | 读 ${(totalMB/readTime*1000).toFixed(0)} MB/s`);
  
  // 清理
  for (let i = 0; i < fileCount; i++) rmSync(join(TEST_DIR, `f${i}.ndts`), { force: true });
}

rmSync(TEST_DIR, { recursive: true, force: true });

// ─────────────────────────────────────────────────────────────
// 2. CPU 分析
// ─────────────────────────────────────────────────────────────

console.log('\n⚡ [2] CPU 瓶颈分析\n');

const sizes = [100_000, 1_000_000, 10_000_000];

for (const size of sizes) {
  console.log(`${(size/1e6).toFixed(1)}M 行:`);
  
  const f64 = new Float64Array(size);
  const i64 = new BigInt64Array(size);
  for (let i = 0; i < size; i++) {
    f64[i] = Math.random() * 1000;
    i64[i] = BigInt(Date.now() + i);
  }
  
  // BigInt → Float64
  const t1 = performance.now();
  const converted = new Float64Array(size);
  for (let i = 0; i < size; i++) converted[i] = Number(i64[i]);
  const convertTime = performance.now() - t1;
  
  // TypedArray 排序 (更接近实际使用)
  const u32 = new Uint32Array(size);
  for (let i = 0; i < size; i++) u32[i] = i;
  
  const t2 = performance.now();
  u32.sort((a, b) => a - b);
  const sortTime = performance.now() - t2;
  
  console.log(`  BigInt→f64: ${(size/convertTime/1000).toFixed(1)}M/s | TypedArray.sort: ${(size/sortTime/1000).toFixed(2)}M/s`);
  
  // Gorilla 压缩/解压
  if (isNdtsReady() && size <= 1_000_000) {
    const t3 = performance.now();
    const compressed = gorillaCompress(f64);
    const compressTime = performance.now() - t3;
    
    const t4 = performance.now();
    gorillaDecompress(compressed, size);
    const decompressTime = performance.now() - t4;
    
    const ratio = compressed.byteLength / f64.byteLength * 100;
    console.log(`  Gorilla: 压缩 ${(size/compressTime/1000).toFixed(1)}M/s (${ratio.toFixed(0)}%) | 解压 ${(size/decompressTime/1000).toFixed(1)}M/s`);
  }
}

// ─────────────────────────────────────────────────────────────
// 3. 内存带宽
// ─────────────────────────────────────────────────────────────

console.log('\n🧠 [3] 内存带宽\n');

const memSizes = [1_000_000, 10_000_000, 100_000_000];

for (const size of memSizes) {
  const data = new Float64Array(size);
  for (let i = 0; i < size; i++) data[i] = i;
  
  // 顺序读取
  const t1 = performance.now();
  let sum = 0;
  for (let i = 0; i < size; i++) sum += data[i];
  const seqTime = performance.now() - t1;
  
  // 随机读取
  const randCount = Math.min(size, 1_000_000);
  const indices = new Uint32Array(randCount);
  for (let i = 0; i < randCount; i++) indices[i] = Math.floor(Math.random() * size);
  
  const t2 = performance.now();
  sum = 0;
  for (let i = 0; i < randCount; i++) sum += data[indices[i]];
  const randTime = performance.now() - t2;
  
  const seqBW = data.byteLength / 1024 / 1024 / seqTime * 1000;
  const randBW = randCount * 8 / 1024 / 1024 / randTime * 1000;
  
  console.log(`${(size/1e6).toFixed(0)}M: 顺序 ${seqBW.toFixed(0)} MB/s | 随机 ${randBW.toFixed(0)} MB/s`);
}

// ─────────────────────────────────────────────────────────────
// 4. FFI 开销
// ─────────────────────────────────────────────────────────────

console.log('\n🔗 [4] FFI 调用开销\n');

if (isNdtsReady()) {
  const callSizes = [100, 1000, 10000, 100000, 1000000];
  
  for (const size of callSizes) {
    const data = new Float64Array(size);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 1000;
    
    const RUNS = size < 10000 ? 1000 : (size < 100000 ? 100 : 10);
    
    const t1 = performance.now();
    for (let r = 0; r < RUNS; r++) gorillaCompress(data);
    const avgTime = (performance.now() - t1) / RUNS;
    
    console.log(`${size.toString().padStart(7)} 元素: ${avgTime.toFixed(3)}ms/call`);
  }
}

// ─────────────────────────────────────────────────────────────
// 5. MinHeap vs 时间桶对比
// ─────────────────────────────────────────────────────────────

console.log('\n🔄 [5] 归并策略对比\n');

const streamCount = 3000;
const rowsPerStream = 1000;

// 模拟多路归并
class MinHeap {
  private heap: { ts: bigint; idx: number }[] = [];
  
  push(ts: bigint, idx: number) {
    this.heap.push({ ts, idx });
    this.siftUp(this.heap.length - 1);
  }
  
  pop(): { ts: bigint; idx: number } | undefined {
    if (this.heap.length === 0) return undefined;
    const top = this.heap[0];
    const last = this.heap.pop()!;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }
  
  private siftUp(i: number) {
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.heap[p].ts <= this.heap[i].ts) break;
      [this.heap[p], this.heap[i]] = [this.heap[i], this.heap[p]];
      i = p;
    }
  }
  
  private siftDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let min = i;
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      if (l < n && this.heap[l].ts < this.heap[min].ts) min = l;
      if (r < n && this.heap[r].ts < this.heap[min].ts) min = r;
      if (min === i) break;
      [this.heap[i], this.heap[min]] = [this.heap[min], this.heap[i]];
      i = min;
    }
  }
  
  get size() { return this.heap.length; }
}

// 生成测试数据
const streams: BigInt64Array[] = [];
const baseTs = Date.now();
for (let i = 0; i < streamCount; i++) {
  const ts = new BigInt64Array(rowsPerStream);
  for (let j = 0; j < rowsPerStream; j++) {
    ts[j] = BigInt(baseTs + j * 1000 + Math.random() * 500);
  }
  streams.push(ts);
}

// MinHeap 归并
const t1 = performance.now();
const heap = new MinHeap();
const cursors = new Uint32Array(streamCount);
for (let i = 0; i < streamCount; i++) {
  heap.push(streams[i][0], i);
}
let heapTicks = 0;
while (heap.size > 0) {
  const { idx } = heap.pop()!;
  heapTicks++;
  cursors[idx]++;
  if (cursors[idx] < rowsPerStream) {
    heap.push(streams[idx][cursors[idx]], idx);
  }
}
const heapTime = performance.now() - t1;

console.log(`MinHeap: ${heapTicks.toLocaleString()} ticks, ${heapTime.toFixed(0)}ms (${(heapTicks/heapTime/1000).toFixed(2)}M/s)`);

// 时间桶归并 (预排序)
const t2 = performance.now();
const allTicks: { ts: bigint; idx: number }[] = [];
for (let i = 0; i < streamCount; i++) {
  for (let j = 0; j < rowsPerStream; j++) {
    allTicks.push({ ts: streams[i][j], idx: i });
  }
}
allTicks.sort((a, b) => Number(a.ts - b.ts));
const bucketTime = performance.now() - t2;

console.log(`预排序: ${allTicks.length.toLocaleString()} ticks, ${bucketTime.toFixed(0)}ms (${(allTicks.length/bucketTime/1000).toFixed(2)}M/s)`);

// ─────────────────────────────────────────────────────────────
// 总结
// ─────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(60));
console.log('📊 瓶颈分析总结');
console.log('═'.repeat(60) + '\n');
