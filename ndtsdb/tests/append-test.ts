// ============================================================
// 增量写入 + CRC32 校验测试
// ============================================================

import { AppendWriter, crc32 } from '../src/append.js';
import { existsSync, mkdirSync, unlinkSync } from 'fs';

console.log('🧪 增量写入 + CRC32 测试\n');
console.log('='.repeat(60));

const testDir = './data/append-test';
if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true });

const testFile = `${testDir}/test.ndts`;
if (existsSync(testFile)) unlinkSync(testFile);

const columns = [
  { name: 'timestamp', type: 'int64' },
  { name: 'price', type: 'float64' },
  { name: 'volume', type: 'int32' },
];

// ─── Test 1: CRC32 ──────────────────────────────────

console.log('\n📋 Test 1: CRC32\n');

const testData = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
const checksum = crc32(testData);
console.log(`  crc32("Hello") = 0x${checksum.toString(16)}`);
console.log(`  expected: 0xf7d18982`);
console.log(`  match: ${checksum === 0xf7d18982 ? '✅' : '❌'}`);

// ─── Test 2: 创建新文件 + 写入 ──────────────────────

console.log('\n📋 Test 2: 创建新文件 + 写入\n');

const writer = new AppendWriter(testFile, columns);
writer.open();

const batch1 = [];
for (let i = 0; i < 100; i++) {
  batch1.push({
    timestamp: BigInt(1700000000000 + i * 1000),
    price: 100 + Math.random() * 10,
    volume: Math.floor(Math.random() * 1000),
  });
}
writer.append(batch1);
console.log(`  写入 chunk 1: 100 行`);

const batch2 = [];
for (let i = 0; i < 200; i++) {
  batch2.push({
    timestamp: BigInt(1700000100000 + i * 1000),
    price: 110 + Math.random() * 10,
    volume: Math.floor(Math.random() * 2000),
  });
}
writer.append(batch2);
console.log(`  写入 chunk 2: 200 行`);

writer.close();
console.log(`  文件已关闭`);

// ─── Test 3: 读取合并 ───────────────────────────────

console.log('\n📋 Test 3: 读取合并\n');

const { header, data } = AppendWriter.readAll(testFile);
console.log(`  totalRows: ${header.totalRows}`);
console.log(`  chunkCount: ${header.chunkCount}`);
console.log(`  columns: ${header.columns.map(c => c.name).join(', ')}`);

const timestamps = data.get('timestamp') as BigInt64Array;
const prices = data.get('price') as Float64Array;
const volumes = data.get('volume') as Int32Array;

console.log(`  timestamp[0]: ${timestamps[0]}`);
console.log(`  timestamp[99]: ${timestamps[99]}`);
console.log(`  timestamp[100]: ${timestamps[100]}`);
console.log(`  price range: ${prices[0].toFixed(2)} ~ ${prices[299].toFixed(2)}`);

const rowsOk = header.totalRows === 300;
const chunksOk = header.chunkCount === 2;
console.log(`\n  总行数 300: ${rowsOk ? '✅' : '❌'}`);
console.log(`  chunk 数 2: ${chunksOk ? '✅' : '❌'}`);

// ─── Test 4: 追加写入 (reopen) ──────────────────────

console.log('\n📋 Test 4: 追加写入 (重新打开文件)\n');

const writer2 = new AppendWriter(testFile, columns);
writer2.open();

const batch3 = [];
for (let i = 0; i < 50; i++) {
  batch3.push({
    timestamp: BigInt(1700000300000 + i * 1000),
    price: 120 + Math.random() * 5,
    volume: Math.floor(Math.random() * 500),
  });
}
writer2.append(batch3);
writer2.close();
console.log(`  追加 chunk 3: 50 行`);

const { header: h2 } = AppendWriter.readAll(testFile);
console.log(`  totalRows: ${h2.totalRows} (期望 350)`);
console.log(`  chunkCount: ${h2.chunkCount} (期望 3)`);
console.log(`  正确: ${h2.totalRows === 350 && h2.chunkCount === 3 ? '✅' : '❌'}`);

// ─── Test 5: CRC32 校验 ─────────────────────────────

console.log('\n📋 Test 5: CRC32 完整性校验\n');

const verifyResult = AppendWriter.verify(testFile);
console.log(`  完整性: ${verifyResult.ok ? '✅' : '❌'}`);
if (!verifyResult.ok) {
  for (const err of verifyResult.errors) {
    console.log(`  ⚠️  ${err}`);
  }
}

// ─── Test 6: 性能 ───────────────────────────────────

console.log('\n📋 Test 6: 写入性能\n');

const perfFile = `${testDir}/perf.ndts`;
if (existsSync(perfFile)) unlinkSync(perfFile);

const perfWriter = new AppendWriter(perfFile, columns);
perfWriter.open();

const ROWS = 100000;
const bigBatch = [];
for (let i = 0; i < ROWS; i++) {
  bigBatch.push({
    timestamp: BigInt(1700000000000 + i * 100),
    price: 100 + Math.random() * 50,
    volume: Math.floor(Math.random() * 10000),
  });
}

const perfStart = performance.now();
perfWriter.append(bigBatch);
const perfTime = performance.now() - perfStart;
perfWriter.close();

console.log(`  ${ROWS.toLocaleString()} 行, ${perfTime.toFixed(1)}ms`);
console.log(`  速度: ${(ROWS / (perfTime / 1000) / 1e6).toFixed(2)}M rows/s`);

// 读取验证
const readStart = performance.now();
const { header: h3 } = AppendWriter.readAll(perfFile);
const readTime = performance.now() - readStart;

console.log(`  读取: ${readTime.toFixed(1)}ms`);
console.log(`  总行数: ${h3.totalRows.toLocaleString()} ${h3.totalRows === ROWS ? '✅' : '❌'}`);

// ─── Summary ─────────────────────────────────────────

console.log('\n' + '='.repeat(60));
console.log('\n✅ 全部测试完成！');
