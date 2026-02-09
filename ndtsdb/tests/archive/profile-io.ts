// 分析 I/O 瓶颈
import { MmapPool } from '../src/mmap/pool.js';
import { MmapMergeStream } from '../src/mmap/merge.js';

const DATA_DIR = './tests/fixtures/bench-3000';
const symbols = Array.from({ length: 3000 }, (_, i) => `SYM${String(i).padStart(4, '0')}`);

console.log('📊 I/O 性能分析\n');

// 1. 文件加载时间
const t1 = performance.now();
const pool = new MmapPool();
pool.init(symbols, DATA_DIR);
const loadTime = performance.now() - t1;
console.log(`1. 文件加载 (mmap): ${loadTime.toFixed(1)}ms`);

// 2. 冷读取 (第一次访问，触发 page fault)
const t2 = performance.now();
const stream = new MmapMergeStream(pool);
stream.init({ symbols });
const initTime = performance.now() - t2;
console.log(`2. Stream 初始化: ${initTime.toFixed(1)}ms`);

// 3. 热读取 (数据已在内存)
const t3 = performance.now();
let tickCount = 0;
for (const tick of stream.replayTicks()) {
  tickCount++;
  if (tickCount >= 1000000) break;
}
const replayTime = performance.now() - t3;
console.log(`3. Tick 回放 (1M ticks): ${replayTime.toFixed(1)}ms`);
console.log(`   速度: ${(tickCount / replayTime * 1000 / 1e6).toFixed(2)}M/s`);

// 4. 分析每个阶段的占比
console.log('\n📈 时间占比:');
const total = loadTime + initTime + replayTime;
console.log(`   加载: ${(loadTime / total * 100).toFixed(1)}%`);
console.log(`   初始化: ${(initTime / total * 100).toFixed(1)}%`);
console.log(`   回放: ${(replayTime / total * 100).toFixed(1)}%`);

console.log('\n💡 io_uring 可优化:');
console.log('   - 批量预读取文件头 (减少 page fault)');
console.log('   - 异步预加载下一批数据');
