// io_uring vs 同步读取 - 大文件批量读取
import { isUringAvailable, uringReadFiles, isNdtsReady } from '../src/ndts-ffi.js';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

console.log('🧪 io_uring 大文件批量读取测试\n');
console.log(`FFI Ready: ${isNdtsReady()}`);
console.log(`io_uring Available: ${isUringAvailable()}`);

const TEST_DIR = './tests/fixtures/uring-bench';

async function benchmark(fileCount: number, fileSize: number) {
  console.log(`\n━━━ ${fileCount} 文件 × ${(fileSize/1024).toFixed(0)}KB ━━━`);
  
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  
  const paths: string[] = [];
  const data = Buffer.alloc(fileSize);
  for (let i = 0; i < fileSize; i++) data[i] = i & 0xff;
  
  for (let i = 0; i < fileCount; i++) {
    const path = join(TEST_DIR, `file-${i}.ndts`);
    writeFileSync(path, data);
    paths.push(path);
  }
  
  // Warmup
  readFileSync(paths[0]);
  if (isUringAvailable()) await uringReadFiles([paths[0]]);
  
  const RUNS = 3;
  
  // 同步读取
  let syncTotal = 0;
  for (let r = 0; r < RUNS; r++) {
    const t1 = performance.now();
    for (const p of paths) readFileSync(p);
    syncTotal += performance.now() - t1;
  }
  const syncAvg = syncTotal / RUNS;
  
  // io_uring
  let uringTotal = 0;
  if (isUringAvailable()) {
    for (let r = 0; r < RUNS; r++) {
      const t1 = performance.now();
      await uringReadFiles(paths);
      uringTotal += performance.now() - t1;
    }
  }
  const uringAvg = uringTotal / RUNS;
  
  const totalMB = (fileCount * fileSize) / (1024 * 1024);
  console.log(`同步: ${syncAvg.toFixed(1)}ms (${(totalMB / syncAvg * 1000).toFixed(0)} MB/s)`);
  if (isUringAvailable()) {
    console.log(`uring: ${uringAvg.toFixed(1)}ms (${(totalMB / uringAvg * 1000).toFixed(0)} MB/s)`);
    console.log(`加速: ${(syncAvg / uringAvg).toFixed(2)}x`);
  }
  
  rmSync(TEST_DIR, { recursive: true, force: true });
}

// 测试不同场景
await benchmark(10, 1024 * 1024);    // 10 × 1MB
await benchmark(100, 100 * 1024);    // 100 × 100KB
await benchmark(1000, 10 * 1024);    // 1000 × 10KB
await benchmark(256, 64 * 1024);     // 256 × 64KB (典型场景)

console.log('\n✅ 测试完成');
