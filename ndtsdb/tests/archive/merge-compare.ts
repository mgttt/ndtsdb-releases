// MinHeap vs 预排序 归并策略对比
const streamCount = 3000;
const rowsPerStream = 1000;

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

console.log('🔄 归并策略对比 (3000 streams × 1000 rows)\n');

// 生成测试数据
const streams: BigInt64Array[] = [];
const baseTs = Date.now();
for (let i = 0; i < streamCount; i++) {
  const ts = new BigInt64Array(rowsPerStream);
  for (let j = 0; j < rowsPerStream; j++) {
    ts[j] = BigInt(baseTs + j * 1000 + Math.floor(Math.random() * 500));
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

console.log(`MinHeap:  ${heapTime.toFixed(0)}ms (${(heapTicks/heapTime/1000).toFixed(2)}M ticks/s)`);

// 预排序归并
const t2 = performance.now();
const allTicks: { ts: bigint; idx: number }[] = [];
for (let i = 0; i < streamCount; i++) {
  for (let j = 0; j < rowsPerStream; j++) {
    allTicks.push({ ts: streams[i][j], idx: i });
  }
}
allTicks.sort((a, b) => Number(a.ts - b.ts));
const sortTime = performance.now() - t2;

console.log(`预排序:  ${sortTime.toFixed(0)}ms (${(allTicks.length/sortTime/1000).toFixed(2)}M ticks/s)`);

// 时间桶 (Counting Sort 思路)
const t3 = performance.now();
const minTs = baseTs;
const maxTs = baseTs + rowsPerStream * 1000 + 500;
const bucketCount = Math.ceil((maxTs - minTs) / 100); // 100ms 桶
const buckets: number[][] = Array.from({ length: bucketCount }, () => []);

for (let i = 0; i < streamCount; i++) {
  for (let j = 0; j < rowsPerStream; j++) {
    const ts = Number(streams[i][j]);
    const bucket = Math.floor((ts - minTs) / 100);
    buckets[bucket].push(i * rowsPerStream + j);
  }
}
// 桶内排序
for (const bucket of buckets) {
  bucket.sort((a, b) => {
    const ai = Math.floor(a / rowsPerStream);
    const aj = a % rowsPerStream;
    const bi = Math.floor(b / rowsPerStream);
    const bj = b % rowsPerStream;
    return Number(streams[ai][aj] - streams[bi][bj]);
  });
}
const bucketTime = performance.now() - t3;

console.log(`时间桶:  ${bucketTime.toFixed(0)}ms (${(heapTicks/bucketTime/1000).toFixed(2)}M ticks/s)`);
