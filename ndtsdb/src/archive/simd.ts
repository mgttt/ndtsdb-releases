// ============================================================
// WASM SIMD 加载器
// ============================================================

// WASM 内存和实例
let wasmMemory: WebAssembly.Memory | null = null;
let wasmInstance: WebAssembly.Instance | null = null;
let wasmExports: any = null;

// 对齐分配内存
function alignMemory(size: number, align: number): number {
    return Math.ceil(size / align) * align;
}

// 加载 WASM
export async function loadWasm(): Promise<boolean> {
    if (wasmInstance) return true;

    try {
        // 尝试加载预编译的 WASM
        const wasmPath = new URL('./simd.wasm', import.meta.url);
        const response = await fetch(wasmPath);
        
        if (!response.ok) {
            console.log('WASM not found, falling back to JS implementation');
            return false;
        }

        const wasmBuffer = await response.arrayBuffer();
        
        // 创建内存 (64MB，可增长)
        wasmMemory = new WebAssembly.Memory({
            initial: 1024,  // 64MB
            maximum: 16384  // 1GB
        });

        const importObject = {
            env: {
                memory: wasmMemory,
                __memory_base: 0,
                __table_base: 0,
            }
        };

        const wasmModule = await WebAssembly.compile(wasmBuffer);
        wasmInstance = await WebAssembly.instantiate(wasmModule, importObject);
        wasmExports = wasmInstance.exports;

        console.log('✅ WASM SIMD loaded successfully');
        return true;
    } catch (err) {
        console.log('WASM load failed:', err);
        return false;
    }
}

// 检查 WASM 是否可用
export function isWasmReady(): boolean {
    return wasmInstance !== null;
}

// 获取 WASM 内存视图
export function getWasmMemory(): WebAssembly.Memory {
    if (!wasmMemory) throw new Error('WASM not loaded');
    return wasmMemory;
}

// 将 TypedArray 拷贝到 WASM 内存
function copyToWasm(src: TypedArray, offset: number = 0): number {
    if (!wasmMemory) throw new Error('WASM not loaded');
    
    const mem = new Uint8Array(wasmMemory.buffer);
    const srcBytes = new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
    mem.set(srcBytes, offset);
    
    return offset + srcBytes.length;
}

// 从 WASM 内存读取结果
function readFromWasm(offset: number, length: number, type: 'i32' | 'f64' = 'i32'): Int32Array | Float64Array {
    if (!wasmMemory) throw new Error('WASM not loaded');
    
    const mem = wasmMemory.buffer;
    if (type === 'f64') {
        return new Float64Array(mem, offset, length);
    }
    return new Int32Array(mem, offset, length);
}

// SIMD 过滤 f64 > threshold
export function simdFilterF64GT(data: Float64Array, threshold: number): Uint32Array {
    if (!wasmExports) {
        // Fallback to JS
        return fallbackFilterF64GT(data, threshold);
    }

    const n = data.length;
    const dataOffset = 16;  // 跳过计数器位置
    const resultOffset = dataOffset + alignMemory(n * 8, 8);
    const maxResults = n;

    // 拷贝数据到 WASM
    copyToWasm(data, dataOffset);

    // 调用 WASM
    wasmExports.filter_f64_gt(dataOffset, n, threshold, resultOffset + 4);

    // 读取结果数量
    const mem32 = new Int32Array(wasmMemory!.buffer);
    const count = mem32[(resultOffset / 4)];

    // 读取结果索引
    const result = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        result[i] = mem32[(resultOffset / 4) + 1 + i];
    }

    return result;
}

// SIMD 求和
export function simdSumF64(data: Float64Array): number {
    if (!wasmExports) {
        return fallbackSumF64(data);
    }

    const n = data.length;
    const dataOffset = 16;

    copyToWasm(data, dataOffset);

    return wasmExports.sum_f64_simd(dataOffset, n);
}

// SIMD 聚合
export function simdAggregateF64(data: Float64Array): { sum: number; min: number; max: number } {
    if (!wasmExports) {
        return fallbackAggregateF64(data);
    }

    const n = data.length;
    const dataOffset = 16;
    const resultOffset = dataOffset + alignMemory(n * 8, 8);

    copyToWasm(data, dataOffset);

    wasmExports.aggregate_f64(dataOffset, n, resultOffset, resultOffset + 8, resultOffset + 16);

    const result = new Float64Array(wasmMemory!.buffer, resultOffset, 3);
    return {
        sum: result[0],
        min: result[1],
        max: result[2]
    };
}

// SIMD 两列过滤
export function simdFilterPriceVolume(
    prices: Float64Array,
    volumes: Int32Array,
    priceThreshold: number,
    volumeThreshold: number
): Uint32Array {
    if (!wasmExports) {
        return fallbackFilterPriceVolume(prices, volumes, priceThreshold, volumeThreshold);
    }

    const n = prices.length;
    const priceOffset = 16;
    const volumeOffset = priceOffset + alignMemory(n * 8, 8);
    const resultOffset = volumeOffset + alignMemory(n * 4, 8);

    copyToWasm(prices, priceOffset);
    copyToWasm(volumes, volumeOffset);

    wasmExports.filter_price_volume(priceOffset, volumeOffset, n, priceThreshold, volumeThreshold, resultOffset + 4);

    const mem32 = new Int32Array(wasmMemory!.buffer);
    const count = mem32[(resultOffset / 4)];

    const result = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
        result[i] = mem32[(resultOffset / 4) + 1 + i];
    }

    return result;
}

// SIMD 时间桶
export function simdTimeBucket(timestamps: BigInt64Array, intervalMs: number): Array<{ bucket: bigint; start: number; end: number }> {
    if (!wasmExports) {
        return fallbackTimeBucket(timestamps, intervalMs);
    }

    const n = timestamps.length;
    const tsOffset = 16;
    const bucketOffset = tsOffset + alignMemory(n * 8, 8);
    const startOffset = bucketOffset + alignMemory(n * 8, 4);
    const endOffset = startOffset + alignMemory(n * 4, 4);

    copyToWasm(timestamps as unknown as TypedArray, tsOffset);

    const countPtr = endOffset + alignMemory(n * 4, 4);

    wasmExports.time_bucket(tsOffset, n, BigInt(intervalMs), bucketOffset, startOffset, endOffset, countPtr);

    const mem32 = new Int32Array(wasmMemory!.buffer);
    const mem64 = new BigInt64Array(wasmMemory!.buffer);
    const count = mem32[countPtr / 4];

    const result: Array<{ bucket: bigint; start: number; end: number }> = [];
    for (let i = 0; i < count; i++) {
        result.push({
            bucket: mem64[(bucketOffset / 8) + i],
            start: mem32[(startOffset / 4) + i],
            end: mem32[(endOffset / 4) + i]
        });
    }

    return result;
}

// ===== Fallback JS 实现 =====

function fallbackFilterF64GT(data: Float64Array, threshold: number): Uint32Array {
    const result: number[] = [];
    for (let i = 0; i < data.length; i++) {
        if (data[i] > threshold) result.push(i);
    }
    return new Uint32Array(result);
}

function fallbackSumF64(data: Float64Array): number {
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
        sum += data[i];
    }
    return sum;
}

function fallbackAggregateF64(data: Float64Array): { sum: number; min: number; max: number } {
    if (data.length === 0) return { sum: 0, min: 0, max: 0 };
    
    let sum = 0;
    let min = data[0];
    let max = data[0];
    
    for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    
    return { sum, min, max };
}

function fallbackFilterPriceVolume(
    prices: Float64Array,
    volumes: Int32Array,
    priceThreshold: number,
    volumeThreshold: number
): Uint32Array {
    const result: number[] = [];
    for (let i = 0; i < prices.length; i++) {
        if (prices[i] > priceThreshold && volumes[i] > volumeThreshold) {
            result.push(i);
        }
    }
    return new Uint32Array(result);
}

function fallbackTimeBucket(timestamps: BigInt64Array, intervalMs: number): Array<{ bucket: bigint; start: number; end: number }> {
    if (timestamps.length === 0) return [];
    
    const result: Array<{ bucket: bigint; start: number; end: number }> = [];
    const interval = BigInt(intervalMs);
    let currentBucket = timestamps[0] / interval * interval;
    let startIdx = 0;
    
    for (let i = 0; i < timestamps.length; i++) {
        const bucket = timestamps[i] / interval * interval;
        if (bucket !== currentBucket) {
            result.push({ bucket: currentBucket, start: startIdx, end: i });
            currentBucket = bucket;
            startIdx = i;
        }
    }
    
    result.push({ bucket: currentBucket, start: startIdx, end: timestamps.length });
    return result;
}

// 工具函数
function alignMemory(size: number, align: number): number {
    return Math.ceil(size / align) * align;
}

type TypedArray = Float64Array | Int32Array | BigInt64Array | Uint8Array;

// 默认导出
export default {
    loadWasm,
    isWasmReady,
    simdFilterF64GT,
    simdSumF64,
    simdAggregateF64,
    simdFilterPriceVolume,
    simdTimeBucket
};
