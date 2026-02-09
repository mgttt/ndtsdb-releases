// 新 merge.ts 基准测试
import { MmapPool } from '../src/mmap/pool.js';
import { MmapMergeStream } from '../src/mmap/merge.js';

const PRODUCT_COUNT = 3000;
const testDir = './data/benchmark';

console.log('🚀 新 MmapMergeStream 基准测试\n');

const pool = new MmapPool();
const symbols: string[] = [];
for (let i = 0; i < PRODUCT_COUNT; i++) {
  symbols.push(`SYM${String(i).padStart(5, '0')}`);
}
pool.init(symbols, testDir);

const stream = new MmapMergeStream(pool);

// ─── init ───
console.log('📦 init()...');
const t0 = performance.now();
stream.init({ symbols });
const initTime = performance.now() - t0;
const stats = stream.getStats();
console.log(`  时间: ${initTime.toFixed(1)}ms`);
console.log(`  Ticks: ${stats.totalTicks.toLocaleString()}`);
console.log(`  Snapshots: ${stats.uniqueTimestamps.toLocaleString()}`);

// ─── Tick 回放 ───
console.log('\n📋 Tick 回放...');
const stream2 = new MmapMergeStream(pool);
stream2.init({ symbols });

let tickCount = 0;
const t1 = performance.now();
for (const tick of stream2.replayTicks()) {
  tickCount++;
}
const tickTime = performance.now() - t1;
console.log(`  时间: ${tickTime.toFixed(1)}ms`);
console.log(`  Ticks: ${tickCount.toLocaleString()}`);
console.log(`  速度: ${(tickCount / tickTime * 1000 / 1e6).toFixed(2)}M/s`);

// ─── Snapshot 回放 ───
console.log('\n📋 Snapshot 回放...');
const stream3 = new MmapMergeStream(pool);
stream3.init({ symbols });

let snapCount = 0;
let totalChanged = 0;
const t2 = performance.now();
for (const snap of stream3.replaySnapshots()) {
  snapCount++;
  totalChanged += snap.changedCount;
}
const snapTime = performance.now() - t2;
console.log(`  时间: ${snapTime.toFixed(1)}ms`);
console.log(`  Snapshots: ${snapCount.toLocaleString()}`);
console.log(`  速度: ${(snapCount / snapTime * 1000 / 1000).toFixed(1)}K/s`);
console.log(`  Avg changed/snap: ${(totalChanged / snapCount).toFixed(1)}`);

// ─── ASOF 点查 ───
console.log('\n📋 ASOF 点查...');
const stream4 = new MmapMergeStream(pool);
stream4.init({ symbols });

const baseTs = 1700000000000n;
const queries = [baseTs + 10000n, baseTs + 50000n, baseTs + 90000n];
for (const ts of queries) {
  const t = performance.now();
  const snap = stream4.asofSnapshot(ts);
  const time = performance.now() - t;
  const nonZero = snap.prices.filter(p => p !== 0).length;
  console.log(`  ts=+${Number(ts - baseTs) / 1000}s → ${nonZero} symbols, ${time.toFixed(2)}ms`);
}

// ─── 总结 ───
console.log('\n' + '═'.repeat(50));
console.log('📊 总结\n');
console.log(`  init 时间: ${initTime.toFixed(1)}ms`);
console.log(`  Tick 速度: ${(tickCount / tickTime * 1000 / 1e6).toFixed(2)}M/s`);
console.log(`  Snapshot 速度: ${(snapCount / snapTime * 1000 / 1000).toFixed(1)}K/s`);

const target = 100000;
if (snapCount / snapTime * 1000 >= target) {
  console.log(`\n  ✅ Snapshot 达标 (>100K/s)`);
} else {
  console.log(`\n  ⚠️ Snapshot 未达标`);
}

pool.close();
