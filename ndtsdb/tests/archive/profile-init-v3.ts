// init() 时间分解 (优化后)
import { MmapPool } from '../src/mmap/pool.js';

const PRODUCT_COUNT = 3000;
const testDir = './data/benchmark';

console.log('🔬 init() 时间分解 (优化后)\n');

const pool = new MmapPool();
const symbols: string[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  symbols.push(`SYM${String(i).padStart(5, '0')}`);
}
pool.init(symbols, testDir);

// ─── Phase 1: 加载列数据 + BigInt64→Float64 ───
let t = performance.now();

const tsArrays: Float64Array[] = [];
const priceArrays: Float64Array[] = [];
const volumeArrays: Int32Array[] = [];
let totalRows = 0;

for (let i = 0; i < PRODUCT_COUNT; i++) {
  const sym = symbols[i];
  const ts = pool.getColumn<BigInt64Array>(sym, 'timestamp');
  const price = pool.getColumn<Float64Array>(sym, 'price');
  const volume = pool.getColumn<Int32Array>(sym, 'volume');
  
  const tsNum = new Float64Array(ts.length);
  for (let j = 0; j < ts.length; j++) tsNum[j] = Number(ts[j]);
  
  tsArrays.push(tsNum);
  priceArrays.push(price);
  volumeArrays.push(volume);
  totalRows += ts.length;
}

const phase1 = performance.now() - t;
console.log(`1. 加载 + BigInt64→Float64: ${phase1.toFixed(1)}ms`);

// ─── Phase 2: 收集 tick 数据 (包括 price/volume) ───
t = performance.now();

const tickTs = new Float64Array(totalRows);
const tickSym = new Int32Array(totalRows);
const tickPrices = new Float64Array(totalRows);
const tickVolumes = new Int32Array(totalRows);

let idx = 0;
for (let symIdx = 0; symIdx < PRODUCT_COUNT; symIdx++) {
  const ts = tsArrays[symIdx];
  const prices = priceArrays[symIdx];
  const volumes = volumeArrays[symIdx];
  for (let cursor = 0; cursor < ts.length; cursor++) {
    tickTs[idx] = ts[cursor];
    tickSym[idx] = symIdx;
    tickPrices[idx] = prices[cursor];
    tickVolumes[idx] = volumes[cursor];
    idx++;
  }
}

const phase2 = performance.now() - t;
console.log(`2. 收集 tick 数据: ${phase2.toFixed(1)}ms`);

// ─── Phase 3: Counting Sort ───
t = performance.now();

let minTs = tickTs[0], maxTs = tickTs[0];
for (let i = 1; i < totalRows; i++) {
  if (tickTs[i] < minTs) minTs = tickTs[i];
  if (tickTs[i] > maxTs) maxTs = tickTs[i];
}
const range = maxTs - minTs + 1;

const count = new Int32Array(range);
for (let i = 0; i < totalRows; i++) {
  count[tickTs[i] - minTs]++;
}
for (let i = 1; i < range; i++) {
  count[i] += count[i - 1];
}
const sortedIndices = new Int32Array(totalRows);
for (let i = totalRows - 1; i >= 0; i--) {
  const bucket = tickTs[i] - minTs;
  sortedIndices[--count[bucket]] = i;
}

const phase3 = performance.now() - t;
console.log(`3. Counting Sort: ${phase3.toFixed(1)}ms`);

// ─── Phase 4: 构建扁平化数据 ───
t = performance.now();

const sortedSymIdx = new Int32Array(totalRows);
const sortedPrices = new Float64Array(totalRows);
const sortedVolumes = new Int32Array(totalRows);
const sortedTimestamps = new Float64Array(totalRows);

for (let i = 0; i < totalRows; i++) {
  const origIdx = sortedIndices[i];
  sortedSymIdx[i] = tickSym[origIdx];
  sortedTimestamps[i] = tickTs[origIdx];
  sortedPrices[i] = tickPrices[origIdx];
  sortedVolumes[i] = tickVolumes[origIdx];
}

const phase4 = performance.now() - t;
console.log(`4. 构建扁平化数据: ${phase4.toFixed(1)}ms`);

// ─── Phase 5: 找 snapshot 边界 ───
t = performance.now();

const snapshotStarts: number[] = [0];
let prevTs = sortedTimestamps[0];
for (let i = 1; i < totalRows; i++) {
  if (sortedTimestamps[i] !== prevTs) {
    snapshotStarts.push(i);
    prevTs = sortedTimestamps[i];
  }
}
snapshotStarts.push(totalRows);

const phase5 = performance.now() - t;
console.log(`5. 找 snapshot 边界: ${phase5.toFixed(1)}ms`);

const total = phase1 + phase2 + phase3 + phase4 + phase5;
console.log(`\n总计: ${total.toFixed(1)}ms`);

console.log('\n时间占比:');
console.log(`  加载:     ${(phase1/total*100).toFixed(1)}%`);
console.log(`  收集:     ${(phase2/total*100).toFixed(1)}%`);
console.log(`  排序:     ${(phase3/total*100).toFixed(1)}%`);
console.log(`  构建:     ${(phase4/total*100).toFixed(1)}%`);
console.log(`  边界:     ${(phase5/total*100).toFixed(1)}%`);

pool.close();
