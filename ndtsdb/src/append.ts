// ============================================================
// 增量写入 + CRC32 完整性校验
// append-only 模式，不重写整个文件
// ============================================================

import { openSync, closeSync, writeSync, readSync, fstatSync, existsSync, mkdirSync, renameSync, rmSync } from 'fs';
import { dirname } from 'path';
import { TombstoneManager } from './tombstone.js';

/**
 * CRC32 计算 (IEEE 802.3)
 * 纯 TypeScript 实现，无依赖
 */
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let crc = i;
  for (let j = 0; j < 8; j++) {
    crc = (crc & 1) ? (0xEDB88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  CRC32_TABLE[i] = crc;
}

export function crc32(data: Uint8Array, initial = 0xFFFFFFFF): number {
  let crc = initial;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 文件格式 v2 (增量写入)
 *
 * ┌──────────────────────────────────┐
 * │ Magic: "NDTS" (4 bytes)         │
 * │ Header length (4 bytes LE)      │
 * │ Header JSON                     │
 * │ Padding (8-byte align)          │
 * │ CRC32 of header (4 bytes LE)    │
 * ├──────────────────────────────────┤
 * │ Chunk 0:                        │
 * │   row count (4 bytes LE)        │
 * │   column 0 data                 │
 * │   column 1 data                 │
 * │   ...                           │
 * │   CRC32 of chunk (4 bytes LE)   │
 * ├──────────────────────────────────┤
 * │ Chunk 1: ...                    │
 * └──────────────────────────────────┘
 *
 * 每次 append 写一个新 chunk，不重写旧数据。
 * 读取时合并所有 chunk。
 */

const MAGIC = Buffer.from('NDTS');

export interface AppendFileHeader {
  columns: Array<{ name: string; type: string }>;
  totalRows: number;    // 所有 chunk 的总行数
  chunkCount: number;   // chunk 数量
}

export type AppendRewriteResult = {
  beforeRows: number;
  afterRows: number;
  deletedRows: number;
  chunksWritten: number;
};

export type AppendRewriteOptions = {
  batchSize?: number; // 控制输出 chunk 大小（默认 10k）
  tmpPath?: string;
  backupPath?: string;
  keepBackup?: boolean;
  mode?: 'stream' | 'readAll'; // 默认 stream（不展开全表）
};

/**
 * 增量写入器
 */
export class AppendWriter {
  private path: string;
  private columns: Array<{ name: string; type: string }>;
  private fd: number = -1;
  private totalRows = 0;
  private chunkCount = 0;
  private tombstone: TombstoneManager;

  constructor(path: string, columns: Array<{ name: string; type: string }>) {
    this.path = path;
    this.columns = columns;
    this.tombstone = new TombstoneManager(path);
  }

  /**
   * 打开文件 (创建或追加)
   */
  open(): void {
    const dir = dirname(this.path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    if (existsSync(this.path)) {
      // 已有文件 — 读取 header，定位到末尾
      this.fd = openSync(this.path, 'r+');
      const header = this.readHeader();
      this.totalRows = header.totalRows;
      this.chunkCount = header.chunkCount;
    } else {
      // 新文件 — 写入 header
      this.fd = openSync(this.path, 'w+');
      this.writeHeader();
    }
  }

  /**
   * 追加数据 (append-only)
   */
  append(rows: Record<string, any>[]): void {
    if (this.fd === -1) throw new Error('File not opened');
    if (rows.length === 0) return;

    const rowCount = rows.length;

    // 构建 chunk: [rowCount(4)] + [col0 data] + [col1 data] + ... + [crc32(4)]
    const parts: Buffer[] = [];

    // Row count
    const rcBuf = Buffer.allocUnsafe(4);
    rcBuf.writeUInt32LE(rowCount);
    parts.push(rcBuf);

    // Column data
    for (const col of this.columns) {
      const byteLen = this.getByteLength(col.type);
      const buf = Buffer.allocUnsafe(byteLen * rowCount);

      for (let i = 0; i < rowCount; i++) {
        const val = rows[i][col.name];
        switch (col.type) {
          case 'int64':
            buf.writeBigInt64LE(BigInt(val), i * 8);
            break;
          case 'float64':
            buf.writeDoubleLE(Number(val), i * 8);
            break;
          case 'int32':
            buf.writeInt32LE(Number(val), i * 4);
            break;
          case 'int16':
            buf.writeInt16LE(Number(val), i * 2);
            break;
        }
      }
      parts.push(buf);
    }

    // 合并计算 CRC
    const chunkData = Buffer.concat(parts);
    const checksum = crc32(new Uint8Array(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength));
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32LE(checksum);

    // 写入文件末尾
    const stat = fstatSync(this.fd);
    writeSync(this.fd, chunkData, 0, chunkData.length, stat.size);
    writeSync(this.fd, crcBuf, 0, 4, stat.size + chunkData.length);

    // 更新 header
    this.totalRows += rowCount;
    this.chunkCount++;
    this.updateHeader();
  }

  /**
   * 关闭文件
   */
  close(): void {
    if (this.fd !== -1) {
      closeSync(this.fd);
      this.fd = -1;
    }
    // 保存 tombstone
    this.tombstone.save();
  }

  /**
   * 标记行为已删除（tombstone）
   */
  markDeleted(rowIndex: number): void {
    this.tombstone.markDeleted(rowIndex);
  }

  /**
   * 批量标记删除
   */
  markDeletedBatch(rowIndices: number[]): void {
    this.tombstone.markDeletedBatch(rowIndices);
  }

  /**
   * 获取已删除行数
   */
  getDeletedCount(): number {
    return this.tombstone.getDeletedCount();
  }

  /**
   * 读取并过滤 tombstone
   */
  readAllFiltered(): { header: AppendFileHeader; data: Map<string, ArrayLike<any>> } {
    const { header, data } = AppendWriter.readAll(this.path);
    
    // 过滤已删除行
    const deletedRows = this.tombstone.getDeletedRows();
    if (deletedRows.length === 0) {
      return { header, data };
    }

    const deletedSet = new Set(deletedRows);
    const validCount = header.totalRows - deletedRows.length;
    const filteredData = new Map<string, ArrayLike<any>>();

    for (const [name, col] of data) {
      const colDef = this.columns.find((c) => c.name === name);
      if (!colDef) continue;

      // 创建新数组，不包含已删除行
      let newCol: any;

      switch (colDef.type) {
        case 'int64':
          newCol = new BigInt64Array(validCount);
          break;
        case 'float64':
          newCol = new Float64Array(validCount);
          break;
        case 'int32':
          newCol = new Int32Array(validCount);
          break;
        case 'int16':
          newCol = new Int16Array(validCount);
          break;
        case 'string':
          newCol = new Array(validCount);
          break;
        default:
          newCol = new Array(validCount);
      }

      let writeIdx = 0;
      for (let i = 0; i < header.totalRows; i++) {
        if (!deletedSet.has(i)) {
          newCol[writeIdx++] = (col as any)[i];
        }
      }

      filteredData.set(name, newCol);
    }

    return {
      header: { ...header, totalRows: validCount },
      data: filteredData,
    };
  }

  /**
   * 使用 tombstone 标记删除（O(1)，延迟清理）
   */
  deleteWhereWithTombstone(predicate: (row: Record<string, any>, index: number) => boolean): number {
    const { header, data } = AppendWriter.readAll(this.path);
    const toDelete: number[] = [];

    for (let i = 0; i < header.totalRows; i++) {
      const row: Record<string, any> = {};
      for (const [name, col] of data) {
        row[name] = (col as any)[i];
      }
      if (predicate(row, i)) {
        toDelete.push(i);
      }
    }

    this.tombstone.markDeletedBatch(toDelete);
    this.tombstone.save();
    return toDelete.length;
  }

  /**
   * 删除并立即 compact（兼容旧接口）
   */
  async deleteWhereAndCompact(
    predicate: (row: Record<string, any>, index: number) => boolean,
    options: AppendRewriteOptions = {}
  ): Promise<AppendRewriteResult> {
    this.deleteWhereWithTombstone(predicate);
    return this.compact(options);
  }

  /**
   * Compact：清理 tombstone + 重写文件
   */
  async compact(options: AppendRewriteOptions = {}): Promise<AppendRewriteResult> {
    const deletedCount = this.tombstone.getDeletedCount();
    if (deletedCount === 0) {
      return { beforeRows: this.totalRows, afterRows: this.totalRows, deletedRows: 0, chunksWritten: 0 };
    }

    // 读取并过滤
    const { header, data } = this.readAllFiltered();
    
    // 重写文件
    const tmpPath = options.tmpPath || this.path + '.tmp';
    const writer = new AppendWriter(tmpPath, this.columns);
    writer.open();

    const batchSize = options.batchSize || 10000;
    const rows: Record<string, any>[] = [];

    for (let i = 0; i < header.totalRows; i++) {
      const row: Record<string, any> = {};
      for (const [name, col] of data) {
        row[name] = (col as any)[i];
      }
      rows.push(row);

      if (rows.length >= batchSize) {
        writer.append(rows);
        rows.length = 0;
      }
    }

    if (rows.length > 0) {
      writer.append(rows);
    }

    writer.close();

    // 原子替换
    const backupPath = options.backupPath || this.path + '.bak';
    if (existsSync(this.path)) {
      renameSync(this.path, backupPath);
    }
    renameSync(tmpPath, this.path);

    if (!options.keepBackup && existsSync(backupPath)) {
      rmSync(backupPath);
    }

    // 清空 tombstone
    this.tombstone.clear();
    this.tombstone.save();

    // 重新打开
    if (this.fd !== -1) {
      closeSync(this.fd);
      this.fd = -1;
    }
    this.open();

    return {
      beforeRows: this.totalRows + deletedCount,
      afterRows: this.totalRows,
      deletedRows: deletedCount,
      chunksWritten: Math.ceil(header.totalRows / batchSize),
    };
  }

  // ─── Header 操作 ───────────────────────────────────

  private writeHeader(): void {
    const headerJson = JSON.stringify({
      columns: this.columns,
      totalRows: 0,
      chunkCount: 0,
    });
    const headerBuf = Buffer.from(headerJson);

    // 对齐
    const headerEndOffset = 4 + 4 + headerBuf.length;
    const paddingSize = (8 - (headerEndOffset % 8)) % 8;

    const headerLenBuf = Buffer.allocUnsafe(4);
    headerLenBuf.writeUInt32LE(headerBuf.length);

    const headerBlock = Buffer.concat([
      MAGIC,
      headerLenBuf,
      headerBuf,
      Buffer.alloc(paddingSize),
    ]);

    // Header CRC
    const headerCrc = crc32(new Uint8Array(headerBlock.buffer, headerBlock.byteOffset, headerBlock.byteLength));
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32LE(headerCrc);

    writeSync(this.fd, headerBlock, 0, headerBlock.length, 0);
    writeSync(this.fd, crcBuf, 0, 4, headerBlock.length);
  }

  private updateHeader(): void {
    // 重写 header JSON 中的 totalRows 和 chunkCount
    // 只改 header 区域，不动 chunk 数据
    const headerJson = JSON.stringify({
      columns: this.columns,
      totalRows: this.totalRows,
      chunkCount: this.chunkCount,
    });
    const headerBuf = Buffer.from(headerJson);
    const headerLenBuf = Buffer.allocUnsafe(4);
    headerLenBuf.writeUInt32LE(headerBuf.length);

    const headerEndOffset = 4 + 4 + headerBuf.length;
    const paddingSize = (8 - (headerEndOffset % 8)) % 8;

    const headerBlock = Buffer.concat([
      MAGIC,
      headerLenBuf,
      headerBuf,
      Buffer.alloc(paddingSize),
    ]);

    const headerCrc = crc32(new Uint8Array(headerBlock.buffer, headerBlock.byteOffset, headerBlock.byteLength));
    const crcBuf = Buffer.allocUnsafe(4);
    crcBuf.writeUInt32LE(headerCrc);

    writeSync(this.fd, headerBlock, 0, headerBlock.length, 0);
    writeSync(this.fd, crcBuf, 0, 4, headerBlock.length);
  }

  private readHeader(): AppendFileHeader {
    // 读取 magic
    const magicBuf = Buffer.allocUnsafe(4);
    readSync(this.fd, magicBuf, 0, 4, 0);
    if (!magicBuf.equals(MAGIC)) throw new Error('Invalid file magic');

    // 读取 header 长度
    const lenBuf = Buffer.allocUnsafe(4);
    readSync(this.fd, lenBuf, 0, 4, 4);
    const headerLen = lenBuf.readUInt32LE();

    // 读取 header JSON
    const headerBuf = Buffer.allocUnsafe(headerLen);
    readSync(this.fd, headerBuf, 0, headerLen, 8);

    return JSON.parse(headerBuf.toString());
  }

  private getByteLength(type: string): number {
    switch (type) {
      case 'int64': return 8;
      case 'float64': return 8;
      case 'int32': return 4;
      case 'int16': return 2;
      default: return 8;
    }
  }

  // ─── 读取 ─────────────────────────────────────────

  /**
   * 读取所有 chunk 并合并
   * 返回: { [columnName]: TypedArray }
   */
  static readAll(path: string): { header: AppendFileHeader; data: Map<string, ArrayLike<any>> } {
    const fd = openSync(path, 'r');
    const stat = fstatSync(fd);

    // 读取 magic + header
    const magicBuf = Buffer.allocUnsafe(4);
    readSync(fd, magicBuf, 0, 4, 0);
    if (!magicBuf.equals(MAGIC)) {
      closeSync(fd);
      throw new Error('Invalid file magic');
    }

    const lenBuf = Buffer.allocUnsafe(4);
    readSync(fd, lenBuf, 0, 4, 4);
    const headerLen = lenBuf.readUInt32LE();

    const headerBuf = Buffer.allocUnsafe(headerLen);
    readSync(fd, headerBuf, 0, headerLen, 8);
    const header: AppendFileHeader = JSON.parse(headerBuf.toString());

    // 跳过 header + padding + CRC
    const headerEndOffset = 4 + 4 + headerLen;
    const paddingSize = (8 - (headerEndOffset % 8)) % 8;
    let offset = headerEndOffset + paddingSize + 4; // +4 for header CRC

    // 分配结果数组
    const data = new Map<string, any>();
    for (const col of header.columns) {
      switch (col.type) {
        case 'int64': data.set(col.name, new BigInt64Array(header.totalRows)); break;
        case 'float64': data.set(col.name, new Float64Array(header.totalRows)); break;
        case 'int32': data.set(col.name, new Int32Array(header.totalRows)); break;
        case 'int16': data.set(col.name, new Int16Array(header.totalRows)); break;
      }
    }

    // 读取所有 chunk
    let rowOffset = 0;
    for (let c = 0; c < header.chunkCount; c++) {
      // Row count
      const rcBuf = Buffer.allocUnsafe(4);
      readSync(fd, rcBuf, 0, 4, offset);
      const chunkRows = rcBuf.readUInt32LE();
      offset += 4;

      // 计算 chunk 数据大小
      let chunkDataSize = 0;
      for (const col of header.columns) {
        const byteLen = col.type === 'int64' || col.type === 'float64' ? 8 : col.type === 'int32' ? 4 : 2;
        chunkDataSize += byteLen * chunkRows;
      }

      // 读取列数据
      for (const col of header.columns) {
        const byteLen = col.type === 'int64' || col.type === 'float64' ? 8 : col.type === 'int32' ? 4 : 2;
        const colBytes = byteLen * chunkRows;
        const buf = Buffer.allocUnsafe(colBytes);
        readSync(fd, buf, 0, colBytes, offset);
        offset += colBytes;

        // 复制到结果数组
        const targetArr = data.get(col.name)!;
        for (let i = 0; i < chunkRows; i++) {
          switch (col.type) {
            case 'int64': targetArr[rowOffset + i] = buf.readBigInt64LE(i * 8); break;
            case 'float64': targetArr[rowOffset + i] = buf.readDoubleLE(i * 8); break;
            case 'int32': targetArr[rowOffset + i] = buf.readInt32LE(i * 4); break;
            case 'int16': targetArr[rowOffset + i] = buf.readInt16LE(i * 2); break;
          }
        }
      }

      // 跳过 CRC
      offset += 4;
      rowOffset += chunkRows;
    }

    closeSync(fd);
    return { header, data };
  }

  /**
   * 只读取 header（不读取 chunk）
   */
  static readHeaderOnly(path: string): AppendFileHeader {
    const fd = openSync(path, 'r');
    try {
      const magicBuf = Buffer.allocUnsafe(4);
      readSync(fd, magicBuf, 0, 4, 0);
      if (!magicBuf.equals(MAGIC)) {
        throw new Error('Invalid file magic');
      }

      const lenBuf = Buffer.allocUnsafe(4);
      readSync(fd, lenBuf, 0, 4, 4);
      const headerLen = lenBuf.readUInt32LE();

      const headerBuf = Buffer.allocUnsafe(headerLen);
      readSync(fd, headerBuf, 0, headerLen, 8);
      return JSON.parse(headerBuf.toString());
    } finally {
      closeSync(fd);
    }
  }

  /**
   * 读取最后一行（不展开全表；按 chunk 跳转到最后一个 chunk）
   */
  static readLastRow(path: string): Record<string, any> | null {
    const fd = openSync(path, 'r');

    const getByteLen = (t: string) => {
      switch (t) {
        case 'int64':
        case 'float64':
          return 8;
        case 'int32':
          return 4;
        case 'int16':
          return 2;
        default:
          return 8;
      }
    };

    try {
      // header
      const magicBuf = Buffer.allocUnsafe(4);
      readSync(fd, magicBuf, 0, 4, 0);
      if (!magicBuf.equals(MAGIC)) throw new Error('Invalid file magic');

      const lenBuf = Buffer.allocUnsafe(4);
      readSync(fd, lenBuf, 0, 4, 4);
      const headerLen = lenBuf.readUInt32LE();

      const headerBuf = Buffer.allocUnsafe(headerLen);
      readSync(fd, headerBuf, 0, headerLen, 8);
      const header: AppendFileHeader = JSON.parse(headerBuf.toString());

      if (header.totalRows === 0 || header.chunkCount === 0) return null;

      // 跳过 header + padding + CRC
      const headerEndOffset = 4 + 4 + headerLen;
      const paddingSize = (8 - (headerEndOffset % 8)) % 8;
      let offset = headerEndOffset + paddingSize + 4; // +4 for header CRC

      // 走到最后一个 chunk
      for (let c = 0; c < header.chunkCount; c++) {
        const rcBuf = Buffer.allocUnsafe(4);
        readSync(fd, rcBuf, 0, 4, offset);
        const chunkRows = rcBuf.readUInt32LE();

        // 最后一个 chunk
        if (c === header.chunkCount - 1) {
          offset += 4;
          const out: Record<string, any> = {};

          for (const col of header.columns) {
            const byteLen = getByteLen(col.type);
            const lastPos = offset + (chunkRows - 1) * byteLen;
            const buf = Buffer.allocUnsafe(byteLen);
            readSync(fd, buf, 0, byteLen, lastPos);

            switch (col.type) {
              case 'int64':
                out[col.name] = buf.readBigInt64LE(0);
                break;
              case 'float64':
                out[col.name] = buf.readDoubleLE(0);
                break;
              case 'int32':
                out[col.name] = buf.readInt32LE(0);
                break;
              case 'int16':
                out[col.name] = buf.readInt16LE(0);
                break;
              default:
                out[col.name] = buf.readDoubleLE(0);
            }

            offset += byteLen * chunkRows;
          }

          return out;
        }

        // 跳过当前 chunk：rowCount(4) + 每列数据 + CRC(4)
        offset += 4;
        let chunkDataBytes = 0;
        for (const col of header.columns) {
          chunkDataBytes += getByteLen(col.type) * chunkRows;
        }
        offset += chunkDataBytes;
        offset += 4; // chunk CRC
      }

      return null;
    } finally {
      closeSync(fd);
    }
  }

  // (types moved to top-level)

  // (types moved to top-level)

  /**
   * Rewrite/Compact：读取旧文件 → 逐行 transform → 写入新文件 → 原子替换。
   *
   * - transform 返回 null 表示删除该行
   * - transform 返回新 row 表示保留/更新
   */
  static rewrite(
    path: string,
    transform: (row: Record<string, any>, index: number) => Record<string, any> | null,
    options: AppendRewriteOptions = {}
  ): AppendRewriteResult {
    // 兼容：需要旧行为时可强制 readAll（调试/小文件）
    if (options.mode === 'readAll') {
      if (!existsSync(path)) {
        return { beforeRows: 0, afterRows: 0, deletedRows: 0, chunksWritten: 0 };
      }

      const { header, data } = AppendWriter.readAll(path);
      const beforeRows = header.totalRows;

      const tmpPath = options.tmpPath || `${path}.tmp`;
      const backupPath = options.backupPath || `${path}.bak`;
      const batchSize = options.batchSize ?? 10_000;

      try {
        if (existsSync(tmpPath)) rmSync(tmpPath);
      } catch {}
      try {
        if (existsSync(backupPath)) rmSync(backupPath);
      } catch {}

      const writer = new AppendWriter(tmpPath, header.columns);
      writer.open();

      let deletedRows = 0;
      let afterRows = 0;
      let chunksWritten = 0;

      const batch: Record<string, any>[] = [];

      for (let i = 0; i < beforeRows; i++) {
        const row: Record<string, any> = {};
        for (const col of header.columns) {
          const arr = data.get(col.name) as any;
          row[col.name] = arr ? arr[i] : undefined;
        }

        const out = transform(row, i);
        if (out == null) {
          deletedRows++;
          continue;
        }

        batch.push(out);
        afterRows++;

        if (batch.length >= batchSize) {
          writer.append(batch);
          chunksWritten++;
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        writer.append(batch);
        chunksWritten++;
      }

      writer.close();

      // 原子替换：path -> bak, tmp -> path
      if (existsSync(path)) renameSync(path, backupPath);
      renameSync(tmpPath, path);

      if (!options.keepBackup) {
        try {
          if (existsSync(backupPath)) rmSync(backupPath);
        } catch {}
      }

      return { beforeRows, afterRows, deletedRows, chunksWritten };
    }

    return AppendWriter.rewriteStreaming(path, transform, options);
  }

  /**
   * rewrite 的 streaming 实现：不展开全表（按 chunk 读取），同时可自然“compact”（把旧 chunk 合并成更大的 chunk）。
   */
  static rewriteStreaming(
    path: string,
    transform: (row: Record<string, any>, index: number) => Record<string, any> | null,
    options: AppendRewriteOptions = {}
  ): AppendRewriteResult {
    if (!existsSync(path)) {
      return { beforeRows: 0, afterRows: 0, deletedRows: 0, chunksWritten: 0 };
    }

    const fd = openSync(path, 'r');

    const getByteLen = (t: string) => {
      switch (t) {
        case 'int64':
        case 'float64':
          return 8;
        case 'int32':
          return 4;
        case 'int16':
          return 2;
        default:
          return 8;
      }
    };

    const readValue = (t: string, buf: Buffer, offset: number) => {
      switch (t) {
        case 'int64':
          return buf.readBigInt64LE(offset);
        case 'float64':
          return buf.readDoubleLE(offset);
        case 'int32':
          return buf.readInt32LE(offset);
        case 'int16':
          return buf.readInt16LE(offset);
        default:
          return buf.readDoubleLE(offset);
      }
    };

    try {
      // header
      const magicBuf = Buffer.allocUnsafe(4);
      readSync(fd, magicBuf, 0, 4, 0);
      if (!magicBuf.equals(MAGIC)) throw new Error('Invalid file magic');

      const lenBuf = Buffer.allocUnsafe(4);
      readSync(fd, lenBuf, 0, 4, 4);
      const headerLen = lenBuf.readUInt32LE();

      const headerBuf = Buffer.allocUnsafe(headerLen);
      readSync(fd, headerBuf, 0, headerLen, 8);
      const header: AppendFileHeader = JSON.parse(headerBuf.toString());

      const beforeRows = header.totalRows;

      // 跳过 header + padding + CRC
      const headerEndOffset = 4 + 4 + headerLen;
      const paddingSize = (8 - (headerEndOffset % 8)) % 8;
      let offset = headerEndOffset + paddingSize + 4; // +4 for header CRC

      const tmpPath = options.tmpPath || `${path}.tmp`;
      const backupPath = options.backupPath || `${path}.bak`;
      const batchSize = options.batchSize ?? 10_000;

      try {
        if (existsSync(tmpPath)) rmSync(tmpPath);
      } catch {}
      try {
        if (existsSync(backupPath)) rmSync(backupPath);
      } catch {}

      const writer = new AppendWriter(tmpPath, header.columns);
      writer.open();

      let deletedRows = 0;
      let afterRows = 0;
      let chunksWritten = 0;
      const batch: Record<string, any>[] = [];

      let globalIndex = 0;

      for (let c = 0; c < header.chunkCount; c++) {
        const rcBuf = Buffer.allocUnsafe(4);
        readSync(fd, rcBuf, 0, 4, offset);
        const chunkRows = rcBuf.readUInt32LE();
        offset += 4;

        const colBufs: Buffer[] = [];
        const colByteLens: number[] = [];

        for (const col of header.columns) {
          const byteLen = getByteLen(col.type);
          const buf = Buffer.allocUnsafe(byteLen * chunkRows);
          if (buf.length > 0) {
            readSync(fd, buf, 0, buf.length, offset);
          }
          offset += buf.length;
          colBufs.push(buf);
          colByteLens.push(byteLen);
        }

        // skip chunk CRC
        offset += 4;

        for (let i = 0; i < chunkRows; i++) {
          const row: Record<string, any> = {};
          for (let k = 0; k < header.columns.length; k++) {
            const col = header.columns[k];
            const byteLen = colByteLens[k];
            const buf = colBufs[k];
            row[col.name] = readValue(col.type, buf, i * byteLen);
          }

          const out = transform(row, globalIndex);
          globalIndex++;

          if (out == null) {
            deletedRows++;
            continue;
          }

          batch.push(out);
          afterRows++;

          if (batch.length >= batchSize) {
            writer.append(batch);
            chunksWritten++;
            batch.length = 0;
          }
        }
      }

      if (batch.length > 0) {
        writer.append(batch);
        chunksWritten++;
      }

      writer.close();

      // 原子替换：path -> bak, tmp -> path
      if (existsSync(path)) renameSync(path, backupPath);
      renameSync(tmpPath, path);

      if (!options.keepBackup) {
        try {
          if (existsSync(backupPath)) rmSync(backupPath);
        } catch {}
      }

      return { beforeRows, afterRows, deletedRows, chunksWritten };
    } finally {
      closeSync(fd);
    }
  }

  static deleteWhere(
    path: string,
    predicate: (row: Record<string, any>, index: number) => boolean,
    options: AppendRewriteOptions = {}
  ): AppendRewriteResult {
    return AppendWriter.rewrite(
      path,
      (row, i) => (predicate(row, i) ? null : row),
      options
    );
  }

  static updateWhere(
    path: string,
    predicate: (row: Record<string, any>, index: number) => boolean,
    patchOrUpdater: Partial<Record<string, any>> | ((row: Record<string, any>) => Partial<Record<string, any>>),
    options: AppendRewriteOptions = {}
  ): AppendRewriteResult {
    const isFn = typeof patchOrUpdater === 'function';
    return AppendWriter.rewrite(
      path,
      (row, i) => {
        if (!predicate(row, i)) return row;
        const patch = isFn ? (patchOrUpdater as any)(row) : patchOrUpdater;
        return { ...row, ...patch };
      },
      options
    );
  }

  /**
   * 验证文件完整性 (所有 CRC32)
   */
  static verify(path: string): { ok: boolean; errors: string[] } {
    const errors: string[] = [];
    const fd = openSync(path, 'r');
    const stat = fstatSync(fd);

    try {
      // 验证 magic
      const magicBuf = Buffer.allocUnsafe(4);
      readSync(fd, magicBuf, 0, 4, 0);
      if (!magicBuf.equals(MAGIC)) {
        errors.push('Invalid magic');
        return { ok: false, errors };
      }

      // 读取 header
      const lenBuf = Buffer.allocUnsafe(4);
      readSync(fd, lenBuf, 0, 4, 4);
      const headerLen = lenBuf.readUInt32LE();

      const headerEndOffset = 4 + 4 + headerLen;
      const paddingSize = (8 - (headerEndOffset % 8)) % 8;
      const headerBlockSize = headerEndOffset + paddingSize;

      // 验证 header CRC
      const headerBlock = Buffer.allocUnsafe(headerBlockSize);
      readSync(fd, headerBlock, 0, headerBlockSize, 0);
      const expectedHeaderCrc = Buffer.allocUnsafe(4);
      readSync(fd, expectedHeaderCrc, 0, 4, headerBlockSize);
      const actualHeaderCrc = crc32(new Uint8Array(headerBlock.buffer, headerBlock.byteOffset, headerBlock.byteLength));

      if (expectedHeaderCrc.readUInt32LE() !== actualHeaderCrc) {
        errors.push(`Header CRC mismatch: expected ${expectedHeaderCrc.readUInt32LE()}, got ${actualHeaderCrc}`);
      }

      // 读取 header JSON
      const headerBuf = Buffer.allocUnsafe(headerLen);
      readSync(fd, headerBuf, 0, headerLen, 8);
      const header: AppendFileHeader = JSON.parse(headerBuf.toString());

      // 验证每个 chunk 的 CRC
      let offset = headerBlockSize + 4;
      for (let c = 0; c < header.chunkCount; c++) {
        const rcBuf = Buffer.allocUnsafe(4);
        readSync(fd, rcBuf, 0, 4, offset);
        const chunkRows = rcBuf.readUInt32LE();

        let chunkDataSize = 4; // 包含 row count
        for (const col of header.columns) {
          const byteLen = col.type === 'int64' || col.type === 'float64' ? 8 : col.type === 'int32' ? 4 : 2;
          chunkDataSize += byteLen * chunkRows;
        }

        const chunkBuf = Buffer.allocUnsafe(chunkDataSize);
        readSync(fd, chunkBuf, 0, chunkDataSize, offset);

        const expectedCrc = Buffer.allocUnsafe(4);
        readSync(fd, expectedCrc, 0, 4, offset + chunkDataSize);
        const actualCrc = crc32(new Uint8Array(chunkBuf.buffer, chunkBuf.byteOffset, chunkBuf.byteLength));

        if (expectedCrc.readUInt32LE() !== actualCrc) {
          errors.push(`Chunk ${c} CRC mismatch: expected ${expectedCrc.readUInt32LE()}, got ${actualCrc}`);
        }

        offset += chunkDataSize + 4;
      }
    } finally {
      closeSync(fd);
    }

    return { ok: errors.length === 0, errors };
  }
}
