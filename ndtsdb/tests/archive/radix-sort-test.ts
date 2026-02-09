// Radix Sort argsort 优化
const TOTAL_ROWS = 3_000_000;

console.log('🔬 排序算法对比\n');

// 生成测试数据（模拟时间戳）
const baseTime = 1700000000000;
const tickTs = new Float64Array(TOTAL_ROWS);
for (let i = 0; i < TOTAL_ROWS; i++) {
  tickTs[i] = baseTime + Math.floor(Math.random() * 100000);
}

// ─── JS 内置排序 ───
console.log('1. JS Array.sort (argsort)...');
const indices1 = new Int32Array(TOTAL_ROWS);
for (let i = 0; i < TOTAL_ROWS; i++) indices1[i] = i;

const t1 = performance.now();
indices1.sort((a, b) => tickTs[a] - tickTs[b]);
const jsTime = performance.now() - t1;
console.log(`   时间: ${jsTime.toFixed(1)}ms`);

// ─── Counting Sort (适合时间戳范围有限) ───
console.log('\n2. Counting Sort...');

// 找到范围
let minTs = tickTs[0], maxTs = tickTs[0];
for (let i = 1; i < TOTAL_ROWS; i++) {
  if (tickTs[i] < minTs) minTs = tickTs[i];
  if (tickTs[i] > maxTs) maxTs = tickTs[i];
}
const range = maxTs - minTs + 1;
console.log(`   范围: ${range} (${minTs} - ${maxTs})`);

const t2 = performance.now();

// 计数
const count = new Int32Array(range);
for (let i = 0; i < TOTAL_ROWS; i++) {
  count[tickTs[i] - minTs]++;
}

// 累加
for (let i = 1; i < range; i++) {
  count[i] += count[i - 1];
}

// 输出
const indices2 = new Int32Array(TOTAL_ROWS);
for (let i = TOTAL_ROWS - 1; i >= 0; i--) {
  const bucket = tickTs[i] - minTs;
  indices2[--count[bucket]] = i;
}

const countingTime = performance.now() - t2;
console.log(`   时间: ${countingTime.toFixed(1)}ms`);

// ─── Bucket + 局部排序 ───
console.log('\n3. Bucket Sort (利用范围有限)...');

const t3 = performance.now();

// 每个时间戳一个桶
const buckets: number[][] = new Array(range);
for (let i = 0; i < range; i++) buckets[i] = [];

for (let i = 0; i < TOTAL_ROWS; i++) {
  buckets[tickTs[i] - minTs].push(i);
}

// 输出
const indices3 = new Int32Array(TOTAL_ROWS);
let idx = 0;
for (let b = 0; b < range; b++) {
  const bucket = buckets[b];
  for (let j = 0; j < bucket.length; j++) {
    indices3[idx++] = bucket[j];
  }
}

const bucketTime = performance.now() - t3;
console.log(`   时间: ${bucketTime.toFixed(1)}ms`);

// ─── 验证 ───
console.log('\n🔍 验证排序正确性...');
let ok = true;
for (let i = 1; i < TOTAL_ROWS; i++) {
  if (tickTs[indices2[i]] < tickTs[indices2[i-1]]) {
    ok = false;
    break;
  }
}
console.log(`   Counting Sort: ${ok ? '✅' : '❌'}`);

ok = true;
for (let i = 1; i < TOTAL_ROWS; i++) {
  if (tickTs[indices3[i]] < tickTs[indices3[i-1]]) {
    ok = false;
    break;
  }
}
console.log(`   Bucket Sort: ${ok ? '✅' : '❌'}`);

// ─── 总结 ───
console.log('\n' + '═'.repeat(40));
console.log('📊 总结\n');
console.log(`  JS sort:       ${jsTime.toFixed(1)}ms`);
console.log(`  Counting Sort: ${countingTime.toFixed(1)}ms (${(jsTime/countingTime).toFixed(1)}x)`);
console.log(`  Bucket Sort:   ${bucketTime.toFixed(1)}ms (${(jsTime/bucketTime).toFixed(1)}x)`);
