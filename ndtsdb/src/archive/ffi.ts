// ============================================================
// Bun FFI 多平台 SIMD 绑定
// 自动检测平台并加载对应库
// ============================================================

import { dlopen, FFIType, suffix } from 'bun:ffi';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

// 平台检测
type Platform = 'linux' | 'darwin' | 'win32';
type Arch = 'x64' | 'arm64';

interface PlatformInfo {
  platform: Platform;
  arch: Arch;
  libName: string;
}

function getPlatformInfo(): PlatformInfo {
  const platform = process.platform as Platform;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  
  let libName: string;
  switch (platform) {
    case 'linux':
      libName = `libsimd-linux-${arch}.so`;
      break;
    case 'darwin':
      libName = `libsimd-macos-${arch}.dylib`;
      break;
    case 'win32':
      libName = `libsimd-windows-${arch}.dll`;
      break;
    default:
      libName = `libsimd.${suffix}`;
  }
  
  return { platform, arch, libName };
}

// 查找共享库路径
function findLibrary(): string {
  const { libName } = getPlatformInfo();
  
  const paths = [
    // 优先使用平台特定版本
    join(dirname(import.meta.path), `../native/dist/${libName}`),
    join(dirname(import.meta.path), `../../native/dist/${libName}`),
    join(process.cwd(), `native/dist/${libName}`),
    `./native/dist/${libName}`,
    // 回退到通用版本
    join(dirname(import.meta.path), `../native/libsimd.${suffix}`),
    join(dirname(import.meta.path), `../../native/libsimd.${suffix}`),
    join(process.cwd(), `native/libsimd.${suffix}`),
    `./native/libsimd.${suffix}`,
  ];
  
  for (const path of paths) {
    if (existsSync(path)) {
      console.log(`📦 Loading SIMD library: ${path}`);
      return path;
    }
  }
  
  throw new Error(`Library not found for ${getPlatformInfo().platform}-${getPlatformInfo().arch}. ` +
    `Expected: native/dist/${libName}`);
}

// 加载 FFI 库
let lib: any = null;
let platformInfo: PlatformInfo | null = null;

try {
  platformInfo = getPlatformInfo();
  const libPath = findLibrary();
  
  lib = dlopen(libPath, {
    // filter_f64_gt(data, n, threshold, out_indices) -> count
    filter_f64_gt: {
      args: [FFIType.ptr, FFIType.usize, FFIType.f64, FFIType.ptr],
      returns: FFIType.usize,
    },
    // sum_f64(data, n) -> sum
    sum_f64: {
      args: [FFIType.ptr, FFIType.usize],
      returns: FFIType.f64,
    },
    // aggregate_f64(data, n, out_result)
    aggregate_f64: {
      args: [FFIType.ptr, FFIType.usize, FFIType.ptr],
    },
    // copy_f64(src, dst, n)
    copy_f64: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.usize],
    },
    // filter_price_volume(prices, volumes, n, p_thresh, v_thresh, out_indices) -> count
    filter_price_volume: {
      args: [FFIType.ptr, FFIType.ptr, FFIType.usize, FFIType.f64, FFIType.i32, FFIType.ptr],
      returns: FFIType.usize,
    },
  });
  
  console.log(`✅ SIMD library loaded: ${platformInfo.platform}-${platformInfo.arch}`);
} catch (e: any) {
  console.log(`⚠️  Failed to load SIMD library: ${e.message}`);
}

// 检查 FFI 是否可用
export function isFFIReady(): boolean {
  return lib !== null;
}

// 获取平台信息
export function getPlatform(): PlatformInfo | null {
  return platformInfo;
}

// FFI 过滤: price > threshold
export function ffiFilterF64GT(data: Float64Array, threshold: number): Uint32Array {
  if (!lib) throw new Error('FFI not available');
  
  const outBuffer = new Uint32Array(data.length);
  
  const count = Number(lib.symbols.filter_f64_gt(
    data.buffer,
    data.length,
    threshold,
    outBuffer.buffer
  ));
  
  return outBuffer.subarray(0, count);
}

// FFI 求和
export function ffiSumF64(data: Float64Array): number {
  if (!lib) throw new Error('FFI not available');
  return lib.symbols.sum_f64(data.buffer, data.length);
}

// FFI 聚合
export interface FFIAggregateResult {
  sum: number;
  min: number;
  max: number;
  avg: number;
  count: number;
}

export function ffiAggregateF64(data: Float64Array): FFIAggregateResult {
  if (!lib) throw new Error('FFI not available');
  
  const resultBuffer = new Float64Array(5);
  
  lib.symbols.aggregate_f64(data.buffer, data.length, resultBuffer.buffer);
  
  return {
    sum: resultBuffer[0],
    min: resultBuffer[1],
    max: resultBuffer[2],
    avg: resultBuffer[3],
    count: Number(resultBuffer[4]),
  };
}

// FFI 两列过滤
export function ffiFilterPriceVolume(
  prices: Float64Array,
  volumes: Int32Array,
  priceThreshold: number,
  volumeThreshold: number
): Uint32Array {
  if (!lib) throw new Error('FFI not available');
  
  const outBuffer = new Uint32Array(prices.length);
  
  const count = Number(lib.symbols.filter_price_volume(
    prices.buffer,
    volumes.buffer,
    prices.length,
    priceThreshold,
    volumeThreshold,
    outBuffer.buffer
  ));
  
  return outBuffer.subarray(0, count);
}

// 关闭库
export function closeFFI(): void {
  if (lib) {
    lib.close();
    lib = null;
  }
}

export default {
  isFFIReady,
  getPlatform,
  ffiFilterF64GT,
  ffiSumF64,
  ffiAggregateF64,
  ffiFilterPriceVolume,
  closeFFI,
};
