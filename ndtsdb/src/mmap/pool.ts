// ============================================================
// MmapPool - 内存映射池 (简化版 v1)
// 先用标准文件读取验证框架，再引入 mmap 优化
// ============================================================

import { readFileSync, openSync, closeSync, fstatSync } from 'fs';

// madvise 常量
export const MADV_NORMAL = 0;
export const MADV_SEQUENTIAL = 2;
export const MADV_WILLNEED = 3;
export const MADV_DONTNEED = 4;

type TypedArray = BigInt64Array | Float64Array | Int32Array | Int16Array;

/**
 * 内存映射的 ColumnarTable
 */
export class MmappedColumnarTable {
  private path: string;
  private buffer: ArrayBuffer | null = null;
  private byteOffset: number = 0;
  private byteLength: number = 0;
  private size: number = 0;
  private header: any = null;
  private isMmapped: boolean = false;
  private columnOffsets: Map<string, { offset: number; byteLength: number; type: string }> = new Map();

  constructor(path: string) {
    this.path = path;
  }

  /**
   * 打开文件并建立内存映射
   */
  open(): void {
    // 使用 Bun.mmap 建立内存映射
    if (typeof Bun !== 'undefined' && 'mmap' in Bun) {
      const mapped = (Bun as any).mmap(this.path);
      // 保持原始 ArrayBuffer 引用，避免 slice() 复制导致 zero-copy 丢失
      this.buffer = mapped.buffer;
      this.byteOffset = mapped.byteOffset;
      this.byteLength = mapped.byteLength;
      this.size = this.byteLength;
      this.isMmapped = true;
    } else {
      // 回退：标准文件读取（Node.js）
      // 注意：Node 的 Buffer 可能来自 slab 池，nodeBuffer.buffer 可能比文件大。
      // 为避免后续（header/rowCount 异常等）导致越界 view 读到 slab 其它内容，这里复制为“刚好大小”的 ArrayBuffer。
      const nodeBuffer = readFileSync(this.path);
      const ab = nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
      this.buffer = ab;
      this.byteOffset = 0;
      this.byteLength = ab.byteLength;
      this.size = this.byteLength;
      this.isMmapped = false;
    }

    // 解析文件头
    this.parseHeader();

    // 设置顺序访问优化
    if (this.isMmapped) {
      this.advise(MADV_SEQUENTIAL);
    }
  }

  /**
   * 解析 ColumnarTable 文件头
   */
  private parseHeader(): void {
    if (!this.buffer) throw new Error('File not opened');

    const view = new DataView(this.buffer, this.byteOffset, this.byteLength);
    const headerLength = view.getUint32(0, true); // little-endian

    if (headerLength <= 0 || headerLength > this.byteLength - 4) {
      throw new Error(`Invalid headerLength: ${headerLength}`);
    }

    const headerBytes = new Uint8Array(this.buffer, this.byteOffset + 4, headerLength);
    const header = JSON.parse(new TextDecoder().decode(headerBytes));

    // 确保 offset 8字节对齐
    let offset = 4 + headerLength;
    offset = Math.ceil(offset / 8) * 8;

    for (const col of header.columns) {
      const byteLength = this.getByteLength(col.type) * header.rowCount;

      // 边界检查：不允许 column view 超过文件实际大小
      if (offset + byteLength > this.byteLength) {
        throw new Error(`Column out of bounds: ${col.name} offset=${offset} len=${byteLength} fileLen=${this.byteLength}`);
      }

      this.columnOffsets.set(col.name, {
        offset,
        byteLength,
        type: col.type,
      });
      offset += byteLength;
    }

    this.header = header;
  }

  /**
   * 获取列数据 (zero-copy)
   */
  getColumn<T extends TypedArray>(name: string): T {
    if (!this.buffer) throw new Error('File not opened');

    const colInfo = this.columnOffsets.get(name);
    if (!colInfo) throw new Error(`Column ${name} not found`);

    return this.createView(colInfo.offset, colInfo.byteLength, colInfo.type) as T;
  }

  /**
   * 创建类型化视图
   */
  private createView(offset: number, byteLength: number, type: string): TypedArray {
    const byteOffset = this.byteOffset + offset;
    switch (type) {
      case 'int64':
        return new BigInt64Array(this.buffer!, byteOffset, byteLength / 8);
      case 'float64':
        return new Float64Array(this.buffer!, byteOffset, byteLength / 8);
      case 'int32':
        return new Int32Array(this.buffer!, byteOffset, byteLength / 4);
      case 'int16':
        return new Int16Array(this.buffer!, byteOffset, byteLength / 2);
      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }

  /**
   * 获取字节长度
   */
  private getByteLength(type: string): number {
    switch (type) {
      case 'int64': return 8;
      case 'float64': return 8;
      case 'int32': return 4;
      case 'int16': return 2;
      default: return 8;
    }
  }

  /**
   * 访问优化提示 (v1: 空实现)
   */
  advise(advice: number): void {
    // v1: 空实现，后续使用 madvise
  }

  /**
   * 预读指定列 (v1: 已加载，无需预读)
   */
  prefetch(columns: string[]): void {
    // v1: 已加载到内存，无需预读
  }

  /**
   * 获取行数
   */
  getRowCount(): number {
    return this.header?.rowCount || 0;
  }

  /**
   * 获取列名列表
   */
  getColumnNames(): string[] {
    return Array.from(this.columnOffsets.keys());
  }

  /**
   * 关闭文件
   */
  close(): void {
    this.buffer = null;
    this.byteOffset = 0;
    this.byteLength = 0;
  }

  /**
   * 获取文件大小
   */
  getSize(): number {
    return this.size;
  }
}

/**
 * 内存映射池
 */
export class MmapPool {
  private maps: Map<string, MmappedColumnarTable> = new Map();
  private maxActiveMaps: number;

  constructor(options: { maxActiveMaps?: number } = {}) {
    this.maxActiveMaps = options.maxActiveMaps || 100;
  }

  /**
   * 初始化映射池
   */
  init(symbols: string[], basePath: string = './data'): void {
    console.log(`📂 Loading ${symbols.length} files...`);
    
    let totalSize = 0;
    
    for (const symbol of symbols) {
      const path = `${basePath}/${symbol}.ndts`;
      const mmapped = new MmappedColumnarTable(path);
      
      try {
        mmapped.open();
        this.maps.set(symbol, mmapped);
        totalSize += mmapped.getSize();
      } catch (e: any) {
        console.warn(`⚠️  Failed to load ${symbol}: ${e.message}`);
      }
    }

    console.log(`✅ Loaded ${this.maps.size} files`);
    console.log(`   Total size: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
  }

  /**
   * 获取列数据 (zero-copy)
   */
  getColumn<T extends TypedArray>(symbol: string, column: string): T {
    const mmapped = this.maps.get(symbol);
    if (!mmapped) throw new Error(`Symbol ${symbol} not found in pool`);
    return mmapped.getColumn<T>(column);
  }

  /**
   * 获取行数
   */
  getRowCount(symbol: string): number {
    const mmapped = this.maps.get(symbol);
    return mmapped?.getRowCount() || 0;
  }

  /**
   * 预读指定产品的列
   */
  prefetch(symbol: string, columns: string[]): void {
    const mmapped = this.maps.get(symbol);
    if (mmapped) {
      mmapped.prefetch(columns);
    }
  }

  /**
   * 设置访问优化提示
   */
  advise(symbol: string, advice: number): void {
    const mmapped = this.maps.get(symbol);
    if (mmapped) {
      mmapped.advise(advice);
    }
  }

  /**
   * 获取已加载的 symbols
   */
  getSymbols(): string[] {
    return Array.from(this.maps.keys());
  }

  /**
   * 关闭所有映射
   */
  close(): void {
    for (const [symbol, mmapped] of this.maps) {
      mmapped.close();
    }
    this.maps.clear();
  }
}
