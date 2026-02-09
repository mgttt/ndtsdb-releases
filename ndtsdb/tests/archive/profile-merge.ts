// Profile merge.ts 热点分析
import { MmapPool } from '../src/mmap/pool.js';
import { MmapMergeStream } from '../src/mmap/merge.js';

const DATA_DIR = './data/test-3000';

async function profile() {
  console.log('🔬 Profiling merge.ts bottlenecks...\n');

  const pool = new MmapPool();
  await pool.init(DATA_DIR);
  
  const symbols = pool.getSymbols();
  console.log(`Symbols: ${symbols.length}`);

  const stream = new MmapMergeStream(pool);
  
  // ─── Phase 1: init() 耗时 ───
  const t0 = performance.now();
  stream.init({ symbols });
  const initMs = performance.now() - t0;
  console.log(`\n📊 init() time: ${initMs.toFixed(1)}ms`);

  // ─── Phase 2: 分段计时 snapshot replay ───
  let heapOps = 0;
  let yieldCount = 0;
  let tickCount = 0;

  const t1 = performance.now();
  
  // 取 10000 个 snapshot 采样
  const sampleSize = 10000;
  let count = 0;
  
  for (const snapshot of stream.replaySnapshots()) {
    yieldCount++;
    tickCount += snapshot.prices.size;
    count++;
    if (count >= sampleSize) break;
  }
  
  const replayMs = performance.now() - t1;
  const snapshotsPerSec = (yieldCount / replayMs) * 1000;
  const ticksPerSec = (tickCount / replayMs) * 1000;

  console.log(`\n📊 Replay sample (${sampleSize} snapshots):`);
  console.log(`   Time: ${replayMs.toFixed(1)}ms`);
  console.log(`   Snapshots: ${yieldCount} (${snapshotsPerSec.toFixed(0)}/s)`);
  console.log(`   Ticks: ${tickCount} (${ticksPerSec.toFixed(0)}/s)`);
  console.log(`   Avg ticks/snapshot: ${(tickCount/yieldCount).toFixed(1)}`);

  // ─── Phase 3: 微基准 - 隔离各部分 ───
  console.log('\n🔬 Micro-benchmarks:');

  // 3a. 纯 heap 操作
  const heapTest = 100000;
  class TestHeap {
    private heap: {ts: number, idx: number}[] = [];
    push(ts: number, idx: number) {
      this.heap.push({ts, idx});
      let i = this.heap.length - 1;
      while (i > 0) {
        const p = ((i-1)/4)|0;
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
        const base = 4*i+1;
        if (base >= n) break;
        let smallest = i;
        let smallestTs = heap[i].ts;
        for (let c = 0; c < 4 && base+c < n; c++) {
          if (heap[base+c].ts < smallestTs) {
            smallest = base+c;
            smallestTs = heap[base+c].ts;
          }
        }
        if (smallest === i) break;
        [heap[i], heap[smallest]] = [heap[smallest], heap[i]];
        i = smallest;
      }
    }
    get size() { return this.heap.length; }
  }

  const th = new TestHeap();
  for (let i = 0; i < 3000; i++) th.push(Math.random() * 1e9, i);
  
  const t2 = performance.now();
  for (let i = 0; i < heapTest; i++) {
    th.fixTop();
  }
  const heapMs = performance.now() - t2;
  console.log(`   Heap fixTop x${heapTest}: ${heapMs.toFixed(1)}ms (${(heapTest/heapMs*1000).toFixed(0)}/s)`);

  // 3b. 对象属性写入
  const objTest = 100000;
  const objs: Record<string, number>[] = [];
  for (let i = 0; i < 3000; i++) {
    objs.push({ price: 0, volume: 0 });
  }
  
  const t3 = performance.now();
  for (let i = 0; i < objTest; i++) {
    const idx = i % 3000;
    objs[idx].price = i * 1.1;
    objs[idx].volume = i;
  }
  const objMs = performance.now() - t3;
  console.log(`   Object prop write x${objTest}: ${objMs.toFixed(1)}ms (${(objTest/objMs*1000).toFixed(0)}/s)`);

  // 3c. TypedArray 读取
  const arrTest = 100000;
  const f64 = new Float64Array(3000 * 1000);
  for (let i = 0; i < f64.length; i++) f64[i] = Math.random();
  
  const t4 = performance.now();
  let sum = 0;
  for (let i = 0; i < arrTest; i++) {
    sum += f64[i * 10];
  }
  const arrMs = performance.now() - t4;
  console.log(`   TypedArray read x${arrTest}: ${arrMs.toFixed(1)}ms (${(arrTest/arrMs*1000).toFixed(0)}/s)`);

  // 3d. Generator yield 开销
  function* gen() {
    for (let i = 0; i < 100000; i++) yield i;
  }
  const t5 = performance.now();
  let genSum = 0;
  for (const v of gen()) genSum += v;
  const genMs = performance.now() - t5;
  console.log(`   Generator yield x100000: ${genMs.toFixed(1)}ms (${(100000/genMs*1000).toFixed(0)}/s)`);

  console.log('\n✅ Profile complete');
  pool.close();
}

profile().catch(console.error);
