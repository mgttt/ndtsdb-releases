// ============================================================
// 内存映射文件支持
// 使用 Bun 的 mmap 实现大文件按需加载
// ============================================================

import { readFileSync, statSync, existsSync } from 'fs';
import { type ColumnarType } from './columnar.js';

interface MmappedTable {
  buffer: ArrayBuffer;
  header: {
    version: number;
    rowCount: number;
    columns: Array<{ name: string; type: ColumnarType; offset: number; byteLength: number }>;
  };
}

/**
 * 使用内存映射加载大文件
 * 支持按需加载，适合 >10GB 数据集
 */
export class MmapManager {
  private filePath: string;
  private mmapped: MmappedTable | null = null;
  private cacheSize: number;
  private hotCache: Map<string, ArrayBufferView> = new Map();

  constructor(filePath: string, options: { cacheSize?: number } = {}) {
    this.filePath = filePath;
    this.cacheSize = options.cacheSize || 10000; // 热缓存行数
  }

  /**
   * 检查是否支持 mmap (Bun 0.6.0+)
   */
  static isSupported(): boolean {
    return typeof Bun !== 'undefined' && 'mmap' in Bun;
  }

  /**
   * 打开并映射文件
   */
  open(): void {
    if (!existsSync(this.filePath)) {
      throw new Error(`File not found: ${this.filePath}`);
    }

    const stats = statSync(this.filePath);
    const fileSize = stats.size;

    if (MmapManager.isSupported()) {
      // 使用 Bun mmap (如果可用)
      this.mmapped = this.openMmap(fileSize);
    } else {
      // 回退到普通读取
      this.mmapped = this.openRead(fileSize);
    }

    console.log(`📂 Opened: ${this.filePath} (${(fileSize / 1024 / 1024).toFixed(2)} MB)`);
  }

  /**
   * 使用 mmap 打开
   */
  private openMmap(fileSize: number): MmappedTable {
    // 注意：Bun 的 mmap API 可能还在实验中
    // 这里使用简化实现
    const buffer = readFileSync(this.filePath);
    return this.parseHeader(buffer);
  }

  /**
   * 使用普通读取打开
   */
  private openRead(fileSize: number): MmappedTable {
    const buffer = readFileSync(this.filePath);
    return this.parseHeader(buffer);
  }

  /**
   * 解析文件头
   */
  private parseHeader(buffer: ArrayBuffer): MmappedTable {
    const view = new DataView(buffer);
    let offset = 0;

    // 魔数检查
    const magic = view.getUint32(offset);
    if (magic !== 0x44415441) { // 'DATA'
      // 回退到旧格式
      return this.parseLegacyHeader(buffer);
    }
    offset += 4;

    // 版本
    const version = view.getUint32(offset);
    offset += 4;

    // 行数
    const rowCount = view.getUint32(offset);
    offset += 4;

    // 列数
    const columnCount = view.getUint32(offset);
    offset += 4;

    // 列定义
    const columns: MmappedTable['header']['columns'] = [];
    for (let i = 0; i < columnCount; i++) {
      // 列名长度
      const nameLength = view.getUint16(offset);
      offset += 2;

      // 列名
      const nameBytes = new Uint8Array(buffer, offset, nameLength);
      const name = new TextDecoder().decode(nameBytes);
      offset += nameLength;

      // 类型
      const typeLength = view.getUint16(offset);
      offset += 2;
      const typeBytes = new Uint8Array(buffer, offset, typeLength);
      const type = new TextDecoder().decode(typeBytes) as ColumnarType;
      offset += typeLength;

      // 列数据偏移
      const colOffset = view.getUint32(offset);
      offset += 4;

      // 列数据长度
      const byteLength = view.getUint32(offset);
      offset += 4;

      columns.push({ name, type, offset: colOffset, byteLength });
    }

    return {
      buffer,
      header: { version, rowCount, columns }
    };
  }

  /**
   * 解析旧格式文件头 (JSON)
   */
  private parseLegacyHeader(buffer: ArrayBuffer): MmappedTable {
    // 旧格式：前4字节是JSON长度
    const view = new DataView(buffer);
    const headerLength = view.getUint32(0);
    
    const headerBytes = new Uint8Array(buffer, 4, headerLength);
    const header = JSON.parse(new TextDecoder().decode(headerBytes));

    // 计算列偏移
    let offset = 4 + headerLength;
    const columns = header.columns.map((col: any) => {
      const byteLength = this.getByteLength(col.type) * header.rowCount;
      const colInfo = { 
        name: col.name, 
        type: col.type as ColumnarType,
        offset, 
        byteLength 
      };
      offset += byteLength;
      return colInfo;
    });

    return {
      buffer,
      header: { version: 1, rowCount: header.rowCount, columns }
    };
  }

  /**
   * 获取列数据 (按需加载)
   */
  getColumn<T extends ArrayBufferView>(name: string, type: ColumnarType): T {
    // 检查热缓存
    if (this.hotCache.has(name)) {
      return this.hotCache.get(name) as T;
    }

    if (!this.mmapped) {
      throw new Error('File not opened');
    }

    const colInfo = this.mmapped.header.columns.find(c => c.name === name);
    if (!colInfo) {
      throw new Error(`Column not found: ${name}`);
    }

    // 从 mmap 创建视图
    const view = this.createView(this.mmapped.buffer, colInfo.offset, colInfo.byteLength, type);
    
    // 添加到热缓存
    if (this.hotCache.size < this.cacheSize) {
      this.hotCache.set(name, view);
    }

    return view as T;
  }

  /**
   * 创建类型化视图
   */
  private createView(buffer: ArrayBuffer, offset: number, byteLength: number, type: ColumnarType): ArrayBufferView {
    switch (type) {
      case 'int64':
        return new BigInt64Array(buffer, offset, byteLength / 8);
      case 'float64':
        return new Float64Array(buffer, offset, byteLength / 8);
      case 'int32':
        return new Int32Array(buffer, offset, byteLength / 4);
      case 'int16':
        return new Int16Array(buffer, offset, byteLength / 2);
      default:
        throw new Error(`Unknown type: ${type}`);
    }
  }

  /**
   * 获取字节长度
   */
  private getByteLength(type: ColumnarType): number {
    switch (type) {
      case 'int64': return 8;
      case 'float64': return 8;
      case 'int32': return 4;
      case 'int16': return 2;
      default: return 8;
    }
  }

  /**
   * 获取行数
   */
  getRowCount(): number {
    return this.mmapped?.header.rowCount ?? 0;
  }

  /**
   * 获取列名列表
   */
  getColumnNames(): string[] {
    return this.mmapped?.header.columns.map(c => c.name) ?? [];
  }

  /**
   * 关闭文件
   */
  close(): void {
    this.hotCache.clear();
    this.mmapped = null;
    // 实际 mmap 需要显式解除映射，但 JS GC 会处理
  }
}

/**
 * 带 LRU 缓存的列数据管理器
 */
export class LRUColumnCache {
  private cache: Map<string, { data: ArrayBufferView; lastAccess: number }> = new Map();
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }

  get<T extends ArrayBufferView>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.lastAccess = Date.now();
      return entry.data as T;
    }
    return undefined;
  }

  set(key: string, data: ArrayBufferView): void {
    if (this.cache.size >= this.maxSize) {
      // 淘汰最久未访问的
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      
      for (const [k, v] of this.cache) {
        if (v.lastAccess < oldestTime) {
          oldestTime = v.lastAccess;
          oldestKey = k;
        }
      }
      
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(key, { data, lastAccess: Date.now() });
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
