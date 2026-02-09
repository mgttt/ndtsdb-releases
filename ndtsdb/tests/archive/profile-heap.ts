/**
 * 测试 heap 操作 vs 属性赋值的开销
 */

// Test 1: 纯 heap 操作
class MinHeap {
  private heap: { ts: number; idx: number }[] = [];
  
  push(ts: number, idx: number) {
    this.heap.push({ ts, idx });
    this.siftUp(this.heap.length - 1);
  }
  
  pop() {
    if (this.heap.length <= 1) return this.heap.pop();
    const result = this.heap[0];
    this.heap[0] = this.heap.pop()!;
    this.siftDown(0);
    return result;
  }
  
  peek() { return this.heap[0]; }
  
  fixTop() { if (this.heap.length > 1) this.siftDown(0); }
  
  get size() { return this.heap.length; }
  
  private siftUp(i: number) {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.heap[parent].ts <= this.heap[i].ts) break;
      const tmp = this.heap[i];
      this.heap[i] = this.heap[parent];
      this.heap[parent] = tmp;
      i = parent;
    }
  }
  
  private siftDown(i: number) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = left + 1;
      if (left < n && this.heap[left].ts < this.heap[smallest].ts) smallest = left;
      if (right < n && this.heap[right].ts < this.heap[smallest].ts) smallest = right;
      if (smallest === i) break;
      const tmp = this.heap[i];
      this.heap[i] = this.heap[smallest];
      this.heap[smallest] = tmp;
      i = smallest;
    }
  }
}

const N = 3000;
const TICKS = 3_000_000;

// Init heap with N symbols
const heap = new MinHeap();
for (let i = 0; i < N; i++) {
  heap.push(i * 30 + Math.floor(Math.random() * 30), i);
}

// Test pure heap fixTop
console.log('--- Test: Pure heap fixTop ---');
const t1 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const entry = heap.peek()!;
  entry.ts += 100;
  heap.fixTop();
}
console.log(`Time: ${(performance.now() - t1).toFixed(1)}ms for ${TICKS.toLocaleString()} ops`);

// Test property assignment
const records: Record<string, number>[] = Array.from({ length: N }, () => ({ price: 0, volume: 0 }));

console.log('--- Test: Property assignment (string key) ---');
const t2 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const idx = i % N;
  records[idx]['price'] = i * 0.01;
  records[idx]['volume'] = i;
}
console.log(`Time: ${(performance.now() - t2).toFixed(1)}ms for ${TICKS.toLocaleString()} ops`);

// Test array assignment
const arrays: Float64Array[] = Array.from({ length: N }, () => new Float64Array(2));

console.log('--- Test: Array assignment (index) ---');
const t3 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const idx = i % N;
  arrays[idx][0] = i * 0.01;
  arrays[idx][1] = i;
}
console.log(`Time: ${(performance.now() - t3).toFixed(1)}ms for ${TICKS.toLocaleString()} ops`);

// Combined
console.log('--- Test: Heap + Property ---');
const heap2 = new MinHeap();
for (let i = 0; i < N; i++) {
  heap2.push(i * 30 + Math.floor(Math.random() * 30), i);
}
const t4 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const entry = heap2.peek()!;
  const idx = entry.idx;
  records[idx]['price'] = i * 0.01;
  records[idx]['volume'] = i;
  entry.ts += 100;
  heap2.fixTop();
}
console.log(`Time: ${(performance.now() - t4).toFixed(1)}ms for ${TICKS.toLocaleString()} ops`);

// Combined with array
console.log('--- Test: Heap + Array ---');
const heap3 = new MinHeap();
for (let i = 0; i < N; i++) {
  heap3.push(i * 30 + Math.floor(Math.random() * 30), i);
}
const t5 = performance.now();
for (let i = 0; i < TICKS; i++) {
  const entry = heap3.peek()!;
  const idx = entry.idx;
  arrays[idx][0] = i * 0.01;
  arrays[idx][1] = i;
  entry.ts += 100;
  heap3.fixTop();
}
console.log(`Time: ${(performance.now() - t5).toFixed(1)}ms for ${TICKS.toLocaleString()} ops`);
