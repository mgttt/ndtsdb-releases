/**
 * 找出 CPU 热点 - 可下发到 libndts 的候选操作
 */

import { isNdtsReady } from '../src/ndts-ffi.js';

console.log('🔥 CPU 热点分析 - libndts 下发候选\n');
console.log(`FFI: ${isNdtsReady() ? '✅' : '❌'}`);
console.log('═'.repeat(50));

const SIZE = 1_000_000;

// 准备数据
const f64 = new Float64Array(SIZE);
const i64 = new BigInt64Array(SIZE);
const u32 = new Uint32Array(SIZE);
for (let i = 0; i < SIZE; i++) {
  f64[i] = Math.random() * 1000;
  i64[i] = BigInt(Date.now() + i);
  u32[i] = i;
}

const ops: { name: string; fn: () => void; }[] = [];

// 1. BigInt → Number 转换
ops.push({
  name: 'BigInt → Number',
  fn: () => {
    const out = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) out[i] = Number(i64[i]);
  }
});

// 2. 求和
ops.push({
  name: 'Float64 求和',
  fn: () => {
    let sum = 0;
    for (let i = 0; i < SIZE; i++) sum += f64[i];
  }
});

// 3. 最大最小值
ops.push({
  name: 'MinMax',
  fn: () => {
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < SIZE; i++) {
      if (f64[i] < min) min = f64[i];
      if (f64[i] > max) max = f64[i];
    }
  }
});

// 4. 条件过滤
ops.push({
  name: '条件过滤 (>500)',
  fn: () => {
    const indices: number[] = [];
    for (let i = 0; i < SIZE; i++) {
      if (f64[i] > 500) indices.push(i);
    }
  }
});

// 5. 数据重排列 (gather)
ops.push({
  name: 'Gather (重排列)',
  fn: () => {
    const out = new Float64Array(SIZE);
    for (let i = 0; i < SIZE; i++) out[i] = f64[u32[i]];
  }
});

// 6. 差分编码
ops.push({
  name: '差分编码 (Delta)',
  fn: () => {
    const out = new Float64Array(SIZE);
    out[0] = f64[0];
    for (let i = 1; i < SIZE; i++) out[i] = f64[i] - f64[i-1];
  }
});

// 7. 累积和
ops.push({
  name: '累积和 (Prefix Sum)',
  fn: () => {
    const out = new Float64Array(SIZE);
    out[0] = f64[0];
    for (let i = 1; i < SIZE; i++) out[i] = out[i-1] + f64[i];
  }
});

// 8. 移动平均
ops.push({
  name: 'SMA-20',
  fn: () => {
    const out = new Float64Array(SIZE);
    const window = 20;
    let sum = 0;
    for (let i = 0; i < SIZE; i++) {
      sum += f64[i];
      if (i >= window) sum -= f64[i - window];
      out[i] = i >= window - 1 ? sum / window : NaN;
    }
  }
});

// 9. EMA
ops.push({
  name: 'EMA-20',
  fn: () => {
    const out = new Float64Array(SIZE);
    const alpha = 2 / 21;
    out[0] = f64[0];
    for (let i = 1; i < SIZE; i++) {
      out[i] = alpha * f64[i] + (1 - alpha) * out[i-1];
    }
  }
});

// 10. 标准差
ops.push({
  name: '标准差',
  fn: () => {
    let sum = 0, sum2 = 0;
    for (let i = 0; i < SIZE; i++) {
      sum += f64[i];
      sum2 += f64[i] * f64[i];
    }
    const mean = sum / SIZE;
    const variance = sum2 / SIZE - mean * mean;
    const std = Math.sqrt(variance);
  }
});

// 11. 二分查找
ops.push({
  name: '二分查找 ×1000',
  fn: () => {
    const sorted = new BigInt64Array(SIZE);
    for (let i = 0; i < SIZE; i++) sorted[i] = BigInt(i * 1000);
    
    for (let q = 0; q < 1000; q++) {
      const target = BigInt(q * 1000 + 500);
      let lo = 0, hi = SIZE;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (sorted[mid] < target) lo = mid + 1;
        else hi = mid;
      }
    }
  }
});

// 12. OHLCV 聚合
ops.push({
  name: 'OHLCV 聚合 (1000桶)',
  fn: () => {
    const buckets = 1000;
    const perBucket = SIZE / buckets;
    const open = new Float64Array(buckets);
    const high = new Float64Array(buckets);
    const low = new Float64Array(buckets);
    const close = new Float64Array(buckets);
    
    for (let b = 0; b < buckets; b++) {
      const start = b * perBucket;
      const end = start + perBucket;
      open[b] = f64[start];
      close[b] = f64[end - 1];
      let h = -Infinity, l = Infinity;
      for (let i = start; i < end; i++) {
        if (f64[i] > h) h = f64[i];
        if (f64[i] < l) l = f64[i];
      }
      high[b] = h;
      low[b] = l;
    }
  }
});

// 运行基准测试
console.log('\n');
const results: { name: string; speed: number; }[] = [];

for (const op of ops) {
  // Warmup
  op.fn();
  
  const RUNS = 10;
  const t1 = performance.now();
  for (let r = 0; r < RUNS; r++) op.fn();
  const avg = (performance.now() - t1) / RUNS;
  
  const speed = SIZE / avg / 1000; // M/s
  results.push({ name: op.name, speed });
  
  console.log(`${op.name.padEnd(25)} ${speed.toFixed(1).padStart(6)} M/s`);
}

// 排序显示最慢的
console.log('\n' + '═'.repeat(50));
console.log('📊 按速度排序 (最慢 = 最值得优化)\n');

results.sort((a, b) => a.speed - b.speed);
for (const r of results.slice(0, 6)) {
  const priority = r.speed < 50 ? '🔴' : r.speed < 100 ? '🟡' : '🟢';
  console.log(`${priority} ${r.name.padEnd(25)} ${r.speed.toFixed(1).padStart(6)} M/s`);
}
