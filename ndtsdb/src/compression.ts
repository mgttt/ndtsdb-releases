// ============================================================
// Gorilla 压缩 - Facebook 时序数据压缩算法
// 浮点数压缩率: 70-90%
// 时间戳压缩率: 90-95%
// ============================================================

/**
 * Gorilla XOR 压缩器 (浮点数)
 * 原理: 相邻值的 XOR 结果通常有很多前导零，只存储有效位
 */
function countTrailingZeros64(n: bigint): number {
  // n is treated as unsigned 64-bit
  n = BigInt.asUintN(64, n);
  if (n === 0n) return 64;
  let count = 0;
  while ((n & 1n) === 0n) {
    n >>= 1n;
    count++;
  }
  return count;
}

export class GorillaCompressor {
  private buffer: Uint8Array;
  private bitPos: number = 0;
  private bytePos: number = 0;
  private prevValue: bigint = 0n;
  private prevLeadingZeros: number = -1;
  private prevTrailingZeros: number = 0;
  private first: boolean = true;

  constructor(maxSize: number = 1024 * 1024) {
    this.buffer = new Uint8Array(maxSize);
  }

  /**
   * 压缩一个浮点数
   */
  compress(value: number): void {
    const bits = BigInt.asUintN(64, BigInt(DoubleToBits(value)));

    if (this.first) {
      // 第一个值：完整存储
      this.writeBits(bits, 64);
      this.prevValue = bits;
      this.first = false;
      return;
    }

    const xor = bits ^ this.prevValue;

    if (xor === 0n) {
      // 值相同：写 0
      this.writeBit(0);
    } else {
      // 值不同：写 1
      this.writeBit(1);

      const leadingZeros = BigInt(xor).toString(2).padStart(64, '0').indexOf('1');
      const trailingZeros = countTrailingZeros64(xor);

      if (this.prevLeadingZeros !== -1 &&
          leadingZeros >= this.prevLeadingZeros &&
          trailingZeros >= this.prevTrailingZeros) {
        // 使用之前的块描述
        this.writeBit(0);
        const meaningfulBits = 64 - this.prevLeadingZeros - this.prevTrailingZeros;
        this.writeBits(xor >> BigInt(this.prevTrailingZeros), meaningfulBits);
      } else {
        // 新的块描述
        this.writeBit(1);
        this.writeBits(BigInt(leadingZeros), 6);
        const meaningfulBits = 64 - leadingZeros - trailingZeros;
        this.writeBits(BigInt(meaningfulBits), 6);
        this.writeBits(xor >> BigInt(trailingZeros), meaningfulBits);
        
        this.prevLeadingZeros = leadingZeros;
        this.prevTrailingZeros = trailingZeros;
      }
    }

    this.prevValue = bits;
  }

  /**
   * 完成压缩，返回结果
   */
  finish(): Uint8Array {
    // 补齐最后一个字节
    if (this.bitPos > 0) {
      this.bytePos++;
    }
    return this.buffer.slice(0, this.bytePos);
  }

  private writeBit(bit: number): void {
    if (this.bitPos === 0) {
      this.buffer[this.bytePos] = 0;
    }
    if (bit) {
      this.buffer[this.bytePos] |= (1 << (7 - this.bitPos));
    }
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
  }

  private writeBits(value: bigint, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.writeBit(Number((value >> BigInt(i)) & 1n));
    }
  }
}

/**
 * Gorilla XOR 解压器
 */
export class GorillaDecompressor {
  private buffer: Uint8Array;
  private bitPos: number = 0;
  private bytePos: number = 0;
  private prevValue: bigint = 0n;
  private prevLeadingZeros: number = -1;
  private prevTrailingZeros: number = 0;
  private first: boolean = true;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  /**
   * 解压下一个值
   */
  decompress(): number | null {
    if (this.first) {
      const bits = this.readBits(64);
      this.prevValue = bits;
      this.first = false;
      return BitsToDouble(Number(bits));
    }

    if (this.bytePos >= this.buffer.length) {
      return null;
    }

    const same = this.readBit();
    if (same === 0) {
      // 值相同
      return BitsToDouble(Number(this.prevValue));
    }

    let leadingZeros: number;
    let meaningfulBits: number;

    const usePrevious = this.readBit();
    if (usePrevious === 0) {
      // 使用之前的块描述
      leadingZeros = this.prevLeadingZeros;
      meaningfulBits = 64 - leadingZeros - this.prevTrailingZeros;
    } else {
      // 新的块描述
      leadingZeros = Number(this.readBits(6));
      meaningfulBits = Number(this.readBits(6));
      this.prevTrailingZeros = 64 - leadingZeros - meaningfulBits;
    }

    const xor = this.readBits(meaningfulBits) << BigInt(this.prevTrailingZeros);
    const value = this.prevValue ^ xor;
    
    this.prevValue = value;
    this.prevLeadingZeros = leadingZeros;

    return BitsToDouble(Number(value));
  }

  private readBit(): number {
    if (this.bytePos >= this.buffer.length) return 0;
    const bit = (this.buffer[this.bytePos] >> (7 - this.bitPos)) & 1;
    this.bitPos++;
    if (this.bitPos === 8) {
      this.bitPos = 0;
      this.bytePos++;
    }
    return bit;
  }

  private readBits(bits: number): bigint {
    let result = 0n;
    for (let i = 0; i < bits; i++) {
      result = (result << 1n) | BigInt(this.readBit());
    }
    return result;
  }
}

function countTrailingZeros64(n: bigint): number {
  n = BigInt.asUintN(64, n);
  if (n === 0n) return 64;
  let count = 0;
  while ((n & 1n) === 0n) {
    n >>= 1n;
    count++;
  }
  return count;
}

/**
 * Delta-of-Delta 时间戳压缩
 * 适合规律的时间序列（如每秒一个数据点）
 */
export class DeltaCompressor {
  private timestamps: number[] = [];
  private deltas: number[] = [];

  compress(timestamps: number[]): Uint8Array {
    if (timestamps.length < 2) {
      return new Uint8Array(new Float64Array(timestamps).buffer);
    }

    // 第一个时间戳
    let prev = timestamps[0];
    let prevDelta = timestamps[1] - timestamps[0];

    // 使用 Varint 编码 delta-of-delta
    const writer = new VarintWriter();
    writer.writeFloat64(prev);
    writer.writeVarint(prevDelta);

    for (let i = 2; i < timestamps.length; i++) {
      const delta = timestamps[i] - prev;
      const deltaOfDelta = delta - prevDelta;
      
      writer.writeVarint(deltaOfDelta);
      
      prev = timestamps[i];
      prevDelta = delta;
    }

    return writer.finish();
  }

  decompress(buffer: Uint8Array): number[] {
    const reader = new VarintReader(buffer);
    const result: number[] = [];

    let prev = reader.readFloat64();
    let prevDelta = reader.readVarint();

    result.push(prev);
    result.push(prev + prevDelta);

    while (reader.hasMore()) {
      const deltaOfDelta = reader.readVarint();
      const delta = prevDelta + deltaOfDelta;
      const timestamp = prev + delta;
      
      result.push(timestamp);
      
      prev = timestamp;
      prevDelta = delta;
    }

    return result;
  }
}

/**
 * Delta 编码器（int64/bigint）
 * 适用于单调递增序列（如 ID、递增的 timestamp）
 */
export class DeltaEncoderInt64 {
  compress(values: BigInt64Array): Uint8Array {
    if (values.length === 0) return new Uint8Array(0);
    if (values.length === 1) {
      const buf = Buffer.allocUnsafe(8);
      buf.writeBigInt64LE(values[0]);
      return new Uint8Array(buf);
    }

    const writer = new VarintWriter();
    writer.writeBigInt64(values[0]); // 第一个值完整存储

    for (let i = 1; i < values.length; i++) {
      const delta = Number(values[i] - values[i - 1]);
      writer.writeVarint(delta);
    }

    return writer.finish();
  }

  decompress(buffer: Uint8Array, count: number): BigInt64Array {
    if (buffer.length === 0) return new BigInt64Array(0);

    const reader = new VarintReader(buffer);
    const result = new BigInt64Array(count);

    result[0] = reader.readBigInt64();

    for (let i = 1; i < count; i++) {
      const delta = BigInt(reader.readVarint());
      result[i] = result[i - 1] + delta;
    }

    return result;
  }
}

/**
 * Delta 编码器（int32）
 */
export class DeltaEncoderInt32 {
  compress(values: Int32Array): Uint8Array {
    if (values.length === 0) return new Uint8Array(0);
    if (values.length === 1) {
      const buf = Buffer.allocUnsafe(4);
      buf.writeInt32LE(values[0]);
      return new Uint8Array(buf);
    }

    const writer = new VarintWriter();
    writer.writeInt32(values[0]);

    for (let i = 1; i < values.length; i++) {
      const delta = values[i] - values[i - 1];
      writer.writeVarint(delta);
    }

    return writer.finish();
  }

  decompress(buffer: Uint8Array, count: number): Int32Array {
    if (buffer.length === 0) return new Int32Array(0);

    const reader = new VarintReader(buffer);
    const result = new Int32Array(count);

    result[0] = reader.readInt32();

    for (let i = 1; i < count; i++) {
      const delta = reader.readVarint();
      result[i] = result[i - 1] + delta;
    }

    return result;
  }
}

/**
 * Gorilla 编码器（Float64 数组）
 * 适用于浮点数时序数据（价格、指标等）
 * 压缩率：70-90%
 */
export class GorillaEncoder {
  compress(values: Float64Array): Uint8Array {
    if (values.length === 0) return new Uint8Array(0);

    const compressor = new GorillaCompressor(values.length * 8 * 2); // 预留空间
    for (let i = 0; i < values.length; i++) {
      compressor.compress(values[i]);
    }
    return compressor.finish();
  }

  decompress(buffer: Uint8Array, count: number): Float64Array {
    if (buffer.length === 0) return new Float64Array(0);

    const decompressor = new GorillaDecompressor(buffer);
    const result = new Float64Array(count);

    for (let i = 0; i < count; i++) {
      const value = decompressor.decompress();
      if (value === null) break;
      result[i] = value;
    }

    return result;
  }
}

/**
 * RLE (Run-Length Encoding) 编码器
 * 适用于有大量重复值的序列（如状态字段、symbol ID）
 */
export class RLEEncoder {
  compress(values: Int32Array): Uint8Array {
    if (values.length === 0) return new Uint8Array(0);

    const writer = new VarintWriter();
    let runValue = values[0];
    let runLength = 1;

    for (let i = 1; i < values.length; i++) {
      if (values[i] === runValue) {
        runLength++;
      } else {
        writer.writeInt32(runValue);
        writer.writeVarint(runLength);
        runValue = values[i];
        runLength = 1;
      }
    }

    // 写入最后一个 run
    writer.writeInt32(runValue);
    writer.writeVarint(runLength);

    return writer.finish();
  }

  decompress(buffer: Uint8Array, count: number): Int32Array {
    const reader = new VarintReader(buffer);
    const result = new Int32Array(count);
    let pos = 0;

    while (reader.hasMore() && pos < count) {
      const value = reader.readInt32();
      const length = reader.readVarint();

      for (let i = 0; i < length && pos < count; i++) {
        result[pos++] = value;
      }
    }

    return result;
  }
}

// Varint 编码器 (简化版)
class VarintWriter {
  private buffer: number[] = [];

  writeFloat64(value: number): void {
    const arr = new Float64Array([value]);
    const bytes = new Uint8Array(arr.buffer);
    this.buffer.push(...bytes);
  }

  writeBigInt64(value: bigint): void {
    const arr = new BigInt64Array([value]);
    const bytes = new Uint8Array(arr.buffer);
    this.buffer.push(...bytes);
  }

  writeInt32(value: number): void {
    const arr = new Int32Array([value]);
    const bytes = new Uint8Array(arr.buffer);
    this.buffer.push(...bytes);
  }

  writeVarint(value: number): void {
    // 使用 zigzag 编码处理负数
    value = value < 0 ? (Math.abs(value) * 2 - 1) : (value * 2);
    
    while (value >= 128) {
      this.buffer.push((value & 0x7f) | 0x80);
      value >>= 7;
    }
    this.buffer.push(value);
  }

  finish(): Uint8Array {
    return new Uint8Array(this.buffer);
  }
}

class VarintReader {
  private buffer: Uint8Array;
  private pos = 0;

  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
  }

  readFloat64(): number {
    const bytes = this.buffer.slice(this.pos, this.pos + 8);
    this.pos += 8;
    return new Float64Array(bytes.buffer)[0];
  }

  readBigInt64(): bigint {
    const bytes = this.buffer.slice(this.pos, this.pos + 8);
    this.pos += 8;
    return new BigInt64Array(bytes.buffer)[0];
  }

  readInt32(): number {
    const bytes = this.buffer.slice(this.pos, this.pos + 4);
    this.pos += 4;
    return new Int32Array(bytes.buffer)[0];
  }

  readVarint(): number {
    let result = 0;
    let shift = 0;
    
    while (this.pos < this.buffer.length) {
      const byte = this.buffer[this.pos++];
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    
    // zigzag 解码
    return (result & 1) ? -(result >> 1) - 1 : result >> 1;
  }

  hasMore(): boolean {
    return this.pos < this.buffer.length;
  }
}

// 辅助函数: double <-> bits
function DoubleToBits(value: number): number {
  const arr = new Float64Array(1);
  arr[0] = value;
  return new BigInt64Array(arr.buffer)[0];
}

function BitsToDouble(bits: number): number {
  const arr = new BigInt64Array(1);
  arr[0] = BigInt(bits);
  return new Float64Array(arr.buffer)[0];
}

/**
 * 测试 Gorilla 压缩
 */
export function testGorilla(): void {
  console.log('🧪 Testing Gorilla compression...\n');

  // 测试数据：模拟股票价格
  const prices: number[] = [];
  let price = 100.0;
  for (let i = 0; i < 1000; i++) {
    price += (Math.random() - 0.5) * 0.01;  // 微小变化
    prices.push(price);
  }

  // 压缩
  const compressor = new GorillaCompressor();
  for (const p of prices) {
    compressor.compress(p);
  }
  const compressed = compressor.finish();

  // 计算压缩率
  const originalSize = prices.length * 8;  // 8 bytes per double
  const compressedSize = compressed.length;
  const ratio = ((originalSize - compressedSize) / originalSize * 100).toFixed(1);

  console.log(`Original size: ${originalSize} bytes`);
  console.log(`Compressed size: ${compressedSize} bytes`);
  console.log(`Compression ratio: ${ratio}%`);

  // 解压验证
  const decompressor = new GorillaDecompressor(compressed);
  const decompressed: number[] = [];
  
  while (true) {
    const val = decompressor.decompress();
    if (val === null) break;
    decompressed.push(val);
  }

  // 验证
  let match = true;
  for (let i = 0; i < prices.length; i++) {
    if (Math.abs(prices[i] - decompressed[i]) > 0.0001) {
      match = false;
      break;
    }
  }

  console.log(`Verification: ${match ? '✅ PASSED' : '❌ FAILED'}`);

  // 测试时间戳压缩
  console.log('\n🧪 Testing Delta-of-Delta timestamp compression...\n');

  const timestamps: number[] = [];
  let ts = Date.now();
  for (let i = 0; i < 1000; i++) {
    timestamps.push(ts);
    ts += 1000;  // 每秒一个点
  }

  const deltaComp = new DeltaCompressor();
  const tsCompressed = deltaComp.compress(timestamps);
  const tsOriginalSize = timestamps.length * 8;
  const tsCompressedSize = tsCompressed.length;
  const tsRatio = ((tsOriginalSize - tsCompressedSize) / tsOriginalSize * 100).toFixed(1);

  console.log(`Original size: ${tsOriginalSize} bytes`);
  console.log(`Compressed size: ${tsCompressedSize} bytes`);
  console.log(`Compression ratio: ${tsRatio}%`);

  // 验证
  const tsDecompressed = deltaComp.decompress(tsCompressed);
  const tsMatch = timestamps.every((v, i) => v === tsDecompressed[i]);
  console.log(`Verification: ${tsMatch ? '✅ PASSED' : '❌ FAILED'}`);
}

/**
 * 综合性能基准测试
 */
export function benchmarkCompression(): void {
  console.log('📊 Compression Benchmark\n');
  console.log('='.repeat(80));

  // 测试 1: 单调递增 int64 (timestamp)
  console.log('\n[1] Monotonic int64 (timestamps)');
  const timestamps = new BigInt64Array(10000);
  let ts = BigInt(Date.now());
  for (let i = 0; i < timestamps.length; i++) {
    timestamps[i] = ts;
    ts += 1000n; // 每秒递增
  }

  const deltaInt64 = new DeltaEncoderInt64();
  const t1Start = performance.now();
  const t1Compressed = deltaInt64.compress(timestamps);
  const t1CompressTime = performance.now() - t1Start;

  const t1Original = timestamps.length * 8;
  const t1Ratio = ((t1Original - t1Compressed.length) / t1Original * 100).toFixed(1);

  console.log(`  Original: ${t1Original} bytes`);
  console.log(`  Compressed: ${t1Compressed.length} bytes`);
  console.log(`  Ratio: ${t1Ratio}%`);
  console.log(`  Compress time: ${t1CompressTime.toFixed(2)}ms`);

  const t1DecompStart = performance.now();
  const t1Decompressed = deltaInt64.decompress(t1Compressed, timestamps.length);
  const t1DecompressTime = performance.now() - t1DecompStart;
  console.log(`  Decompress time: ${t1DecompressTime.toFixed(2)}ms`);

  const t1Match = timestamps.every((v, i) => v === t1Decompressed[i]);
  console.log(`  Verification: ${t1Match ? '✅' : '❌'}`);

  // 测试 2: 随机 int32
  console.log('\n[2] Random int32');
  const randomInts = new Int32Array(10000);
  for (let i = 0; i < randomInts.length; i++) {
    randomInts[i] = Math.floor(Math.random() * 1000);
  }

  const deltaInt32 = new DeltaEncoderInt32();
  const t2Start = performance.now();
  const t2Compressed = deltaInt32.compress(randomInts);
  const t2CompressTime = performance.now() - t2Start;

  const t2Original = randomInts.length * 4;
  const t2Ratio = ((t2Original - t2Compressed.length) / t2Original * 100).toFixed(1);

  console.log(`  Original: ${t2Original} bytes`);
  console.log(`  Compressed: ${t2Compressed.length} bytes`);
  console.log(`  Ratio: ${t2Ratio}% ${parseInt(t2Ratio) < 0 ? '(worse!)' : ''}`);
  console.log(`  Compress time: ${t2CompressTime.toFixed(2)}ms`);

  const t2DecompStart = performance.now();
  const t2Decompressed = deltaInt32.decompress(t2Compressed, randomInts.length);
  const t2DecompressTime = performance.now() - t2DecompStart;
  console.log(`  Decompress time: ${t2DecompressTime.toFixed(2)}ms`);

  const t2Match = randomInts.every((v, i) => v === t2Decompressed[i]);
  console.log(`  Verification: ${t2Match ? '✅' : '❌'}`);

  // 测试 3: 重复值 (RLE)
  console.log('\n[3] Repeated values (RLE)');
  const repeated = new Int32Array(10000);
  for (let i = 0; i < repeated.length; i++) {
    repeated[i] = Math.floor(i / 100); // 每 100 个值重复
  }

  const rle = new RLEEncoder();
  const t3Start = performance.now();
  const t3Compressed = rle.compress(repeated);
  const t3CompressTime = performance.now() - t3Start;

  const t3Original = repeated.length * 4;
  const t3Ratio = ((t3Original - t3Compressed.length) / t3Original * 100).toFixed(1);

  console.log(`  Original: ${t3Original} bytes`);
  console.log(`  Compressed: ${t3Compressed.length} bytes`);
  console.log(`  Ratio: ${t3Ratio}%`);
  console.log(`  Compress time: ${t3CompressTime.toFixed(2)}ms`);

  const t3DecompStart = performance.now();
  const t3Decompressed = rle.decompress(t3Compressed, repeated.length);
  const t3DecompressTime = performance.now() - t3DecompStart;
  console.log(`  Decompress time: ${t3DecompressTime.toFixed(2)}ms`);

  const t3Match = repeated.every((v, i) => v === t3Decompressed[i]);
  console.log(`  Verification: ${t3Match ? '✅' : '❌'}`);

  console.log('\n' + '='.repeat(80));
  console.log('Summary:');
  console.log('  Delta (int64):  Best for monotonic sequences (timestamps)');
  console.log('  Delta (int32):  May expand random data (use with care)');
  console.log('  RLE:            Excellent for repeated values (>90% compression)');
  console.log('='.repeat(80) + '\n');
}
