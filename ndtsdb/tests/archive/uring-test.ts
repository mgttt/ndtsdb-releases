// io_uring 测试
import { isUringAvailable, uringReadFiles, isNdtsReady } from '../src/ndts-ffi.js';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

console.log('🧪 io_uring 测试\n');
console.log(`FFI Ready: ${isNdtsReady()}`);
console.log(`io_uring Available: ${isUringAvailable()}`);

if (!isUringAvailable()) {
  console.log('\n⚠️ io_uring 不可用 (可能是非 Linux 或内核太旧)');
  process.exit(0);
}

// 创建测试文件
const TEST_DIR = './tests/fixtures/uring-test';
const FILE_COUNT = 100;
const FILE_SIZE = 4096;

console.log(`\n📁 创建 ${FILE_COUNT} 个测试文件...`);
rmSync(TEST_DIR, { recursive: true, force: true });
mkdirSync(TEST_DIR, { recursive: true });

const paths: string[] = [];
for (let i = 0; i < FILE_COUNT; i++) {
  const path = join(TEST_DIR, `file-${i}.ndts`);
  const data = Buffer.alloc(FILE_SIZE);
  data.writeUInt32LE(i, 0); // 写入文件索引作为验证
  writeFileSync(path, data);
  paths.push(path);
}

// 基准: 同步读取
console.log('\n📊 性能对比:\n');

const RUNS = 5;

// 同步读取
let syncTotal = 0;
for (let r = 0; r < RUNS; r++) {
  const t1 = performance.now();
  const results = paths.map(p => readFileSync(p));
  syncTotal += performance.now() - t1;
}
console.log(`同步读取: ${(syncTotal / RUNS).toFixed(2)}ms (${FILE_COUNT} 文件)`);

// io_uring 读取
let uringTotal = 0;
for (let r = 0; r < RUNS; r++) {
  const t1 = performance.now();
  const results = await uringReadFiles(paths);
  uringTotal += performance.now() - t1;
  
  // 验证数据
  if (r === 0) {
    let valid = true;
    for (let i = 0; i < results.length; i++) {
      const view = new DataView(results[i].buffer, results[i].byteOffset);
      if (view.getUint32(0, true) !== i) {
        console.log(`❌ 验证失败: file-${i}`);
        valid = false;
        break;
      }
    }
    if (valid) console.log('✅ 数据验证通过');
  }
}
console.log(`io_uring: ${(uringTotal / RUNS).toFixed(2)}ms (${FILE_COUNT} 文件)`);

const speedup = syncTotal / uringTotal;
console.log(`\n⚡ 加速比: ${speedup.toFixed(2)}x`);

// 清理
rmSync(TEST_DIR, { recursive: true, force: true });
