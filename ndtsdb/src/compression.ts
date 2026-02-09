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

// Varint 编码器 (简化版)
class VarintWriter {
  private buffer: number[] = [];

  writeFloat64(value: number): void {
    const arr = new Float64Array([value]);
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
