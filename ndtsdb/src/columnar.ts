// ============================================================
// 列式存储表 - 性能优化版本
// 使用 TypedArray 替代对象数组，实现真正的列式存储
// ============================================================

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

export type ColumnarType = 'int64' | 'float64' | 'int32' | 'int16' | 'string';

interface ColumnDef {
  name: string;
  type: ColumnarType;
}

type ColumnArray = BigInt64Array | Float64Array | Int32Array | Int16Array | string[];

type TypedNumericArray = BigInt64Array | Float64Array | Int32Array | Int16Array;

export class ColumnarTable {
  private columns: Map<string, ColumnArray> = new Map();
  private columnDefs: ColumnDef[];
  private rowCount = 0;
  private capacity: number;
  private readonly growthFactor = 1.5;

  /**
   * 从现有 TypedArray 直接创建表视图（零拷贝）。
   * 主要用于：AppendWriter.readAll / mmap 读出来后，用 SQL 引擎做分析。
   */
  static fromColumns(
    columnDefs: ColumnDef[],
    columns: Map<string, ColumnArray>,
    rowCount?: number,
  ): ColumnarTable {
    const first = columnDefs[0];
    const firstArr = first ? columns.get(first.name) : undefined;
    const inferred = firstArr ? firstArr.length : 0;
    const rc = rowCount ?? inferred;

    const t = new ColumnarTable(columnDefs, Math.max(1, rc));
    t.columns = columns;
    t.rowCount = rc;
    t.capacity = rc;

    return t;
  }

  constructor(columnDefs: ColumnDef[], initialCapacity = 1000) {
    this.columnDefs = columnDefs;
    this.capacity = initialCapacity;
    
    // 初始化列
    for (const def of columnDefs) {
      this.columns.set(def.name, this.createTypedArray(def.type, initialCapacity));
    }
  }

  /**
   * 批量追加行（最高性能路径）
   * 直接写入 TypedArray，零对象创建
   */
  appendBatch(data: Record<string, number | bigint | string | null>[]): void {
    const requiredCapacity = this.rowCount + data.length;
    if (requiredCapacity > this.capacity) {
      this.growTo(requiredCapacity);
    }

    for (const def of this.columnDefs) {
      const col = this.columns.get(def.name)!;

      switch (def.type) {
        case 'string': {
          const out = col as string[];
          for (let i = 0; i < data.length; i++) {
            const v = data[i][def.name];
            out[this.rowCount + i] = v == null ? '' : String(v);
          }
          break;
        }
        case 'int64': {
          const out = col as BigInt64Array;
          const vals = new BigInt64Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const v = data[i][def.name];
            if (typeof v === 'bigint') vals[i] = v;
            else if (typeof v === 'number') vals[i] = BigInt(Math.trunc(v));
            else if (typeof v === 'string' && v.length > 0 && /^-?\d+$/.test(v)) vals[i] = BigInt(v);
            else vals[i] = 0n;
          }
          out.set(vals, this.rowCount);
          break;
        }
        case 'float64': {
          const out = col as Float64Array;
          const vals = new Float64Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const v = data[i][def.name];
            vals[i] = v == null ? 0 : Number(v);
          }
          out.set(vals, this.rowCount);
          break;
        }
        case 'int32': {
          const out = col as Int32Array;
          const vals = new Int32Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const v = data[i][def.name];
            vals[i] = v == null ? 0 : (Number(v) | 0);
          }
          out.set(vals, this.rowCount);
          break;
        }
        case 'int16': {
          const out = col as Int16Array;
          const vals = new Int16Array(data.length);
          for (let i = 0; i < data.length; i++) {
            const v = data[i][def.name];
            vals[i] = v == null ? 0 : (Number(v) | 0);
          }
          out.set(vals, this.rowCount);
          break;
        }
      }
    }

    this.rowCount += data.length;
  }

  /**
   * 追加单行
   */
  append(row: Record<string, number | bigint | string | null>): void {
    if (this.rowCount >= this.capacity) {
      this.grow();
    }

    for (const def of this.columnDefs) {
      const col = this.columns.get(def.name)!;
      const value = row[def.name] ?? 0;
      
      switch (def.type) {
        case 'string':
          (col as string[])[this.rowCount] = value == null ? '' : String(value);
          break;
        case 'int64':
          // 自动转换 number → bigint
          (col as BigInt64Array)[this.rowCount] = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
          break;
        case 'float64':
          (col as Float64Array)[this.rowCount] = Number(value);
          break;
        case 'int32':
          (col as Int32Array)[this.rowCount] = Number(value) | 0;
          break;
        case 'int16':
          (col as Int16Array)[this.rowCount] = Number(value) | 0;
          break;
      }
    }

    this.rowCount++;
  }

  /**
   * 更新指定行
   */
  updateRow(index: number, row: Record<string, number | bigint | string | null>): void {
    if (index < 0 || index >= this.rowCount) {
      throw new Error(`Row index out of bounds: ${index}`);
    }

    for (const [name, value] of Object.entries(row)) {
      const col = this.columns.get(name);
      if (!col) continue;
      
      const def = this.columnDefs.find(d => d.name === name);
      if (!def) continue;
      
      switch (def.type) {
        case 'string':
          (col as string[])[index] = value == null ? '' : String(value);
          break;
        case 'int64':
          // 自动转换 number → bigint
          (col as BigInt64Array)[index] = typeof value === 'bigint' ? value : BigInt(Math.trunc(Number(value)));
          break;
        case 'float64':
          (col as Float64Array)[index] = Number(value);
          break;
        case 'int32':
          (col as Int32Array)[index] = Number(value) | 0;
          break;
        case 'int16':
          (col as Int16Array)[index] = Number(value) | 0;
          break;
      }
    }
  }

  /**
   * 过滤查询（使用 TypedArray 直接访问）
   */
  filter(predicate: (row: Record<string, any>, index: number) => boolean): Record<string, any>[] {
    const results: Record<string, any>[] = [];
    
    for (let i = 0; i < this.rowCount; i++) {
      const row = this.getRow(i);
      if (predicate(row, i)) {
        results.push(row);
      }
    }
    
    return results;
  }

  /**
   * 范围查询（利用连续内存优势）
   */
  slice(start: number, end: number): Record<string, any>[] {
    const results: Record<string, any>[] = [];
    const actualEnd = Math.min(end, this.rowCount);
    
    for (let i = start; i < actualEnd; i++) {
      results.push(this.getRow(i));
    }
    
    return results;
  }

  /**
   * 聚合查询（SIMD 友好）
   */
  aggregate(column: string, op: 'sum' | 'min' | 'max' | 'avg' | 'count'): number {
    const col = this.columns.get(column);
    if (!col) throw new Error(`Column ${column} not found`);

    const arr = col.subarray(0, this.rowCount);
    
    switch (op) {
      case 'sum':
        return this.sumTypedArray(arr);
      case 'min':
        return this.minTypedArray(arr);
      case 'max':
        return this.maxTypedArray(arr);
      case 'avg':
        return this.sumTypedArray(arr) / this.rowCount;
      case 'count':
        return this.rowCount;
      default:
        throw new Error(`Unknown operation: ${op}`);
    }
  }

  /**
   * SAMPLE BY 聚合（时间桶）
   * @param intervalSize 桶大小（与 timestamp 同单位，Kline 场景下为秒）
   */
  sampleBy(timeColumn: string, intervalSize: number, aggregations: { column: string; op: 'first' | 'last' | 'min' | 'max' | 'sum' | 'avg' }[]): Record<string, number | bigint>[] {
    const timestamps = this.columns.get(timeColumn) as BigInt64Array;
    if (!timestamps) throw new Error(`Time column ${timeColumn} not found`);

    // 按时间桶分组
    const buckets = new Map<number, number[]>(); // bucketTime -> row indices

    for (let i = 0; i < this.rowCount; i++) {
      const ts = Number(timestamps[i]);
      const bucket = Math.floor(ts / intervalSize) * intervalSize;
      
      if (!buckets.has(bucket)) {
        buckets.set(bucket, []);
      }
      buckets.get(bucket)!.push(i);
    }

    // 聚合每个桶
    const results: Record<string, number | bigint>[] = [];
    
    for (const [bucketTime, indices] of buckets) {
      const result: Record<string, number | bigint> = { [timeColumn]: BigInt(bucketTime) };

      for (const agg of aggregations) {
        const col = this.columns.get(agg.column);
        if (!col) continue;

        const values = indices.map(i => this.getTypedArrayValue(col, i));
        
        switch (agg.op) {
          case 'first':
            result[`${agg.column}_${agg.op}`] = values[0];
            break;
          case 'last':
            result[`${agg.column}_${agg.op}`] = values[values.length - 1];
            break;
          case 'min':
            result[`${agg.column}_${agg.op}`] = Math.min(...values);
            break;
          case 'max':
            result[`${agg.column}_${agg.op}`] = Math.max(...values);
            break;
          case 'sum':
            result[`${agg.column}_${agg.op}`] = values.reduce((a, b) => a + b, 0);
            break;
          case 'avg':
            result[`${agg.column}_${agg.op}`] = values.reduce((a, b) => a + b, 0) / values.length;
            break;
        }
      }

      results.push(result);
    }

    return results.sort((a, b) => Number(a[timeColumn]) - Number(b[timeColumn]));
  }

  /**
   * 保存为二进制文件（零序列化）
   * Format: header(JSON) + column1_data + column2_data + ...
   */
  saveToFile(path: string): void {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Header: 列定义和行数
    const header = Buffer.from(JSON.stringify({
      version: 1,
      rowCount: this.rowCount,
      columns: this.columnDefs
    }));

    // 各列数据
    const columnBuffers: Buffer[] = [];
    let totalSize = 0;

    for (const def of this.columnDefs) {
      if (def.type === 'string') {
        throw new Error('ColumnarTable.saveToFile: string columns are not supported');
      }
      const col = this.columns.get(def.name)! as TypedNumericArray;
      const byteLength = this.getByteLength(def.type) * this.rowCount;
      const buf = Buffer.from(col.buffer, col.byteOffset, byteLength);
      columnBuffers.push(buf);
      totalSize += buf.length;
    }

    // 计算对齐 padding (确保列数据从 8 字节对齐位置开始)
    const headerEndOffset = 4 + header.length;
    const paddingSize = (8 - (headerEndOffset % 8)) % 8;
    const paddingBuf = Buffer.alloc(paddingSize); // 填充 0

    // 合并写入
    const headerLengthBuf = Buffer.allocUnsafe(4);
    headerLengthBuf.writeUInt32LE(header.length);

    const finalBuffer = Buffer.concat([
      headerLengthBuf,
      header,
      paddingBuf,
      ...columnBuffers
    ], 4 + header.length + paddingSize + totalSize);

    writeFileSync(path, finalBuffer);
  }

  /**
   * 从二进制文件加载
   */
  static loadFromFile(path: string): ColumnarTable {
    const buffer = readFileSync(path);
    
    // 读取 header 长度
    const headerLength = buffer.readUInt32LE(0);
    
    // 读取 header
    const header = JSON.parse(buffer.subarray(4, 4 + headerLength).toString());
    
    // 创建表
    const table = new ColumnarTable(header.columns, header.rowCount);
    table.rowCount = header.rowCount;

    // 读取各列数据 (考虑 8 字节对齐)
    let offset = 4 + headerLength;
    offset = Math.ceil(offset / 8) * 8; // 对齐到 8 字节边界
    
    for (const def of header.columns) {
      if (def.type === 'string') {
        throw new Error('ColumnarTable.loadFromFile: string columns are not supported');
      }

      const byteLength = table.getByteLength(def.type) * header.rowCount;
      const colData = buffer.subarray(offset, offset + byteLength);
      
      // 复制到 TypedArray
      const col = table.columns.get(def.name)! as TypedNumericArray;
      const targetArray = new Uint8Array(col.buffer, col.byteOffset, byteLength);
      targetArray.set(colData);
      
      offset += byteLength;
    }

    return table;
  }

  getRowCount(): number {
    return this.rowCount;
  }

  getColumn(name: string): ColumnArray | undefined {
    return this.columns.get(name);
  }

  getColumnNames(): string[] {
    return this.columnDefs.map(def => def.name);
  }

  private getRow(index: number): Record<string, any> {
    const row: Record<string, any> = {};
    
    for (const def of this.columnDefs) {
      const col = this.columns.get(def.name)!;
      row[def.name] = this.getTypedArrayValue(col, index);
    }
    
    return row;
  }

  private getTypedArrayValue(arr: ColumnArray, index: number): number | bigint | string {
    if (Array.isArray(arr)) return arr[index] ?? '';
    if (arr instanceof BigInt64Array) return arr[index];
    if (arr instanceof Float64Array) return arr[index];
    if (arr instanceof Int32Array) return arr[index];
    if (arr instanceof Int16Array) return arr[index];
    return (arr as any)[index];
  }

  private createTypedArray(type: ColumnarType, size: number): ColumnArray {
    switch (type) {
      case 'string': return new Array(size).fill('');
      case 'int64': return new BigInt64Array(size);
      case 'float64': return new Float64Array(size);
      case 'int32': return new Int32Array(size);
      case 'int16': return new Int16Array(size);
    }
  }

  private getByteLength(type: ColumnarType): number {
    switch (type) {
      case 'string':
        throw new Error('ColumnarTable.saveToFile: string columns are not supported for binary persistence');
      case 'int64':
        return 8;
      case 'float64':
        return 8;
      case 'int32':
        return 4;
      case 'int16':
        return 2;
    }
  }

  private grow(): void {
    this.growTo(Math.floor(this.capacity * this.growthFactor));
  }

  private growTo(newCapacity: number): void {
    this.capacity = Math.max(newCapacity, this.capacity * 2);
    
    for (const def of this.columnDefs) {
      const oldCol = this.columns.get(def.name)!;
      const newCol = this.createTypedArray(def.type, this.capacity);

      if (def.type === 'string') {
        const oldArr = oldCol as string[];
        const newArr = newCol as string[];
        for (let i = 0; i < this.rowCount; i++) newArr[i] = oldArr[i] ?? '';
      } else {
        (newCol as TypedNumericArray).set((oldCol as TypedNumericArray).subarray(0, this.rowCount));
      }

      this.columns.set(def.name, newCol);
    }
  }

  private sumTypedArray(arr: TypedNumericArray): number {
    let sum = 0;
    for (let i = 0; i < arr.length; i++) {
      sum += Number(arr[i]);
    }
    return sum;
  }

  private minTypedArray(arr: TypedNumericArray): number {
    let min = Infinity;
    for (let i = 0; i < arr.length; i++) {
      const val = Number(arr[i]);
      if (val < min) min = val;
    }
    return min;
  }

  private maxTypedArray(arr: TypedNumericArray): number {
    let max = -Infinity;
    for (let i = 0; i < arr.length; i++) {
      const val = Number(arr[i]);
      if (val > max) max = val;
    }
    return max;
  }
}

// (TypedArray alias removed; use ColumnArray / TypedNumericArray)
