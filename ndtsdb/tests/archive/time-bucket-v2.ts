// ============================================================
// 时间桶方案 v2 — 进一步优化
// ============================================================

import { MmapPool } from '../src/mmap/pool.js';

const PRODUCT_COUNT = 3000;
const testDir = './data/benchmark';

console.log('🧪 时间桶方案 v2 — 进一步优化\n');

const pool = new MmapPool();
const symbols: string[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  symbols.push(`SYM${String(i).padStart(5, '0')}`);
}
pool.init(symbols, testDir);

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

// ─── 优化 1: 扁平化索引结构 ────────────────────────────

console.log('📦 构建扁平化时间桶索引...');
const indexStart = performance.now();

// 收集所有 (timestamp, symIdx, cursor) 三元组
const totalTicks = tsArrays.reduce((s, a) => s + a.length, 0);
const tickData = new Float64Array(totalTicks); // timestamp
const tickSym = new Int32Array(totalTicks);     // symIdx
const tickCursor = new Int32Array(totalTicks);  // cursor

let tickIdx = 0;
for (let symIdx = 0; symIdx < PRODUCT_COUNT; symIdx++) {
  const ts = tsArrays[symIdx];
  for (let cursor = 0; cursor < ts.length; cursor++) {
    tickData[tickIdx] = ts[cursor];
    tickSym[tickIdx] = symIdx;
    tickCursor[tickIdx] = cursor;
    tickIdx++;
  }
}

// 按时间戳排序 (argsort)
const sortedIndices = new Int32Array(totalTicks);
for (let i = 0; i < totalTicks; i++) sortedIndices[i] = i;
sortedIndices.sort((a, b) => tickData[a] - tickData[b]);

// 找出 snapshot 边界
const snapshotStarts: number[] = [0];
let prevTs = tickData[sortedIndices[0]];
for (let i = 1; i < totalTicks; i++) {
  const ts = tickData[sortedIndices[i]];
  if (ts !== prevTs) {
    snapshotStarts.push(i);
    prevTs = ts;
  }
}
snapshotStarts.push(totalTicks);

const indexTime = performance.now() - indexStart;
const snapshotCount = snapshotStarts.length - 1;

console.log(`  索引构建: ${indexTime.toFixed(1)}ms`);
console.log(`  Snapshots: ${snapshotCount}`);
console.log(`  Total ticks: ${totalTicks}`);

// ─── 优化 2: TypedArray 替代对象属性 ────────────────────

console.log('\n🚀 回放 (TypedArray 版)...');

const pricePool = new Float64Array(PRODUCT_COUNT);
const volumePool = new Int32Array(PRODUCT_COUNT);

const replayStart = performance.now();
let snapshots = 0;

for (let s = 0; s < snapshotCount; s++) {
  const start = snapshotStarts[s];
  const end = snapshotStarts[s + 1];
  
  // 批量更新
  for (let i = start; i < end; i++) {
    const idx = sortedIndices[i];
    const symIdx = tickSym[idx];
    const cursor = tickCursor[idx];
    pricePool[symIdx] = priceArrays[symIdx][cursor];
    volumePool[symIdx] = volumeArrays[symIdx][cursor];
  }
  
  snapshots++;
}

const replayTime = performance.now() - replayStart;
const snapsPerSec = snapshots / replayTime * 1000;

console.log(`  回放时间: ${replayTime.toFixed(1)}ms`);
console.log(`  速度: ${(snapsPerSec / 1000).toFixed(1)}K snapshots/s`);

// ─── 优化 3: 预排列数据避免间接寻址 ────────────────────

console.log('\n🚀 回放 (预排列数据版)...');

// 预排列：按排序后顺序存储 (symIdx, cursor)
const sortedSymIdx = new Int32Array(totalTicks);
const sortedCursor = new Int32Array(totalTicks);
for (let i = 0; i < totalTicks; i++) {
  const idx = sortedIndices[i];
  sortedSymIdx[i] = tickSym[idx];
  sortedCursor[i] = tickCursor[idx];
}

// 清空
pricePool.fill(0);
volumePool.fill(0);

const replay2Start = performance.now();
let snapshots2 = 0;

for (let s = 0; s < snapshotCount; s++) {
  const start = snapshotStarts[s];
  const end = snapshotStarts[s + 1];
  
  for (let i = start; i < end; i++) {
    const symIdx = sortedSymIdx[i];
    const cursor = sortedCursor[i];
    pricePool[symIdx] = priceArrays[symIdx][cursor];
    volumePool[symIdx] = volumeArrays[symIdx][cursor];
  }
  
  snapshots2++;
}

const replay2Time = performance.now() - replay2Start;
const snaps2PerSec = snapshots2 / replay2Time * 1000;

console.log(`  回放时间: ${replay2Time.toFixed(1)}ms`);
console.log(`  速度: ${(snaps2PerSec / 1000).toFixed(1)}K snapshots/s`);

// ─── 优化 4: 完全扁平化价格/成交量 ────────────────────

console.log('\n🚀 回放 (完全扁平化版)...');

// 预排列价格和成交量
const sortedPrices = new Float64Array(totalTicks);
const sortedVolumes = new Int32Array(totalTicks);
for (let i = 0; i < totalTicks; i++) {
  const symIdx = sortedSymIdx[i];
  const cursor = sortedCursor[i];
  sortedPrices[i] = priceArrays[symIdx][cursor];
  sortedVolumes[i] = volumeArrays[symIdx][cursor];
}

pricePool.fill(0);
volumePool.fill(0);

const replay3Start = performance.now();
let snapshots3 = 0;

for (let s = 0; s < snapshotCount; s++) {
  const start = snapshotStarts[s];
  const end = snapshotStarts[s + 1];
  
  for (let i = start; i < end; i++) {
    const symIdx = sortedSymIdx[i];
    pricePool[symIdx] = sortedPrices[i];
    volumePool[symIdx] = sortedVolumes[i];
  }
  
  snapshots3++;
}

const replay3Time = performance.now() - replay3Start;
const snaps3PerSec = snapshots3 / replay3Time * 1000;

console.log(`  回放时间: ${replay3Time.toFixed(1)}ms`);
console.log(`  速度: ${(snaps3PerSec / 1000).toFixed(1)}K snapshots/s`);

// ─── 总结 ────────────────────────────────────────────

console.log('\n' + '═'.repeat(50));
console.log('📊 总结\n');

console.log(`  原始 Heap:    ~7.4K/s`);
console.log(`  时间桶 v1:    58.3K/s`);
console.log(`  TypedArray:   ${(snapsPerSec / 1000).toFixed(1)}K/s`);
console.log(`  预排列:       ${(snaps2PerSec / 1000).toFixed(1)}K/s`);
console.log(`  完全扁平化:   ${(snaps3PerSec / 1000).toFixed(1)}K/s`);

const best = Math.max(snapsPerSec, snaps2PerSec, snaps3PerSec);
if (best > 100000) {
  console.log(`\n  ✅ 达到目标 100K/s!`);
} else {
  console.log(`\n  ⚠️ 还需 ${(100000 / best).toFixed(2)}x`);
}

pool.close();
