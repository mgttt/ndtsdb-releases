// ============================================================
// WASM SIMD 性能测试
// ============================================================

import { ColumnarTable } from '../src/columnar.js';

// 加载 WASM
async function loadWasm() {
  try {
    const wasmBuffer = await Bun.file('./src/simd.wasm').arrayBuffer();
    const wasmModule = await WebAssembly.compile(wasmBuffer);
    
    const memory = new WebAssembly.Memory({
      initial: 1024,  // 64MB
      maximum: 16384  // 1GB
    });
    
    const instance = await WebAssembly.instantiate(wasmModule, {
      env: { memory }
    });
    
    return { exports: instance.exports, memory };
  } catch (e) {
    console.log('WASM load failed:', e.message);
    return null;
  }
}

// WASM SIMD 过滤
function wasmFilterF64GT(wasm: any, data: Float64Array, threshold: number): Uint32Array {
  const { exports, memory } = wasm;
  
  // 分配内存
  const dataOffset = 1024;
  const resultOffset = dataOffset + data.byteLength + 1024;
  
  // 拷贝数据到 WASM 内存
  const memF64 = new Float64Array(memory.buffer);
  const memU32 = new Uint32Array(memory.buffer);
  
  memF64.set(data, dataOffset / 8);
  
  // 调用 WASM 函数
  const count = exports.filter_f64_greater_than(
    dataOffset,
    data.length,
    threshold,
    resultOffset
  );
  
  // 读取结果
  const result = new Uint32Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = memU32[(resultOffset / 4) + i];
  }
  
  return result;
}

// JS 过滤
function jsFilterF64GT(data: Float64Array, threshold: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i] > threshold) result.push(i);
  }
  return result;
}

// 4路展开 JS 过滤
function simdJsFilterF64GT(data: Float64Array, threshold: number): number[] {
  const result: number[] = [];
  const n = data.length;
  const chunks = n >> 2;
  
  for (let c = 0; c < chunks; c++) {
    const base = c << 2;
    if (data[base] > threshold) result.push(base);
    if (data[base + 1] > threshold) result.push(base + 1);
    if (data[base + 2] > threshold) result.push(base + 2);
    if (data[base + 3] > threshold) result.push(base + 3);
  }
  
  for (let i = chunks << 2; i < n; i++) {
    if (data[i] > threshold) result.push(i);
  }
  
  return result;
}

async function benchmark() {
  console.log('🚀 WASM SIMD 性能测试\n');
  console.log('=' .repeat(60));

  // 加载 WASM
  const wasm = await loadWasm();
  if (!wasm) {
    console.log('❌ WASM 加载失败，退出测试');
    return;
  }
  
  console.log('✅ WASM 加载成功\n');

  const sizes = [10000, 100000, 1000000];
  
  for (const size of sizes) {
    console.log(`\n📊 数据量: ${size.toLocaleString()} 行`);
    console.log('-'.repeat(60));
    
    // 生成测试数据
    const data = new Float64Array(size);
    for (let i = 0; i < size; i++) {
      data[i] = Math.random() * 200;  // 0-200
    }
    const threshold = 100;

    // 1. JS 普通循环
    const jsStart = performance.now();
    const jsResult = jsFilterF64GT(data, threshold);
    const jsTime = performance.now() - jsStart;
    
    console.log(`🐢 JS 普通: ${jsTime.toFixed(2).padStart(8)}ms | ${(size/jsTime*1000).toFixed(0).padStart(10)} rows/s | ${jsResult.length} 匹配`);

    // 2. JS 4路展开
    const simdJsStart = performance.now();
    const simdJsResult = simdJsFilterF64GT(data, threshold);
    const simdJsTime = performance.now() - simdJsStart;
    
    console.log(`🚀 JS SIMD: ${simdJsTime.toFixed(2).padStart(8)}ms | ${(size/simdJsTime*1000).toFixed(0).padStart(10)} rows/s | ${simdJsResult.length} 匹配 | ${(jsTime/simdJsTime).toFixed(1)}x 提升`);

    // 3. WASM SIMD (小数据量测试，大数据量可能内存不够)
    if (size <= 100000) {
      try {
        const wasmStart = performance.now();
        const wasmResult = wasmFilterF64GT(wasm, data, threshold);
        const wasmTime = performance.now() - wasmStart;
        
        console.log(`⚡ WASM:    ${wasmTime.toFixed(2).padStart(8)}ms | ${(size/wasmTime*1000).toFixed(0).padStart(10)} rows/s | ${wasmResult.length} 匹配 | ${(jsTime/wasmTime).toFixed(1)}x 提升`);
      } catch (e) {
        console.log(`⚠️ WASM 测试失败: ${e.message}`);
      }
    }
  }

  console.log('\n' + '=' .repeat(60));
  console.log('✅ 测试完成！');
}

benchmark().catch(console.error);
