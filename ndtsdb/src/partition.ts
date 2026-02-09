// ============================================================
// 分区管理器
// 借鉴 QuestDB 三层存储架构：
// - 热数据：内存中的当前分区
// - 温数据：磁盘上的近期分区
// - 冷数据：可归档到 Parquet/S3
// ============================================================

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import type { PartitionConfig, PartitionInfo, Row, ColumnDef } from './types.js';

interface Partition {
  name: string;
  startTime: Date;
  endTime: Date;
  rows: Row[];
  dirty: boolean;
  filePath: string;
}

export class PartitionManager {
  private readonly dataDir: string;
  private readonly config: PartitionConfig;
  private currentPartition: Partition | null = null;
  private readonly maxRowsInMemory: number;

  constructor(dataDir: string, config: PartitionConfig, options: { maxRowsInMemory?: number } = {}) {
    this.dataDir = dataDir;
    this.config = config;
    this.maxRowsInMemory = options.maxRowsInMemory || 100000;

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
  }

  /**
   * 获取行所属的分区名称
   */
  getPartitionName(timestamp: Date): string {
    const ts = timestamp.getTime();
    
    switch (this.config.granularity) {
      case 'hour':
        return `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}-${String(timestamp.getUTCHours()).padStart(2, '0')}`;
      case 'day':
        return `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}-${String(timestamp.getUTCDate()).padStart(2, '0')}`;
      case 'month':
        return `${timestamp.getUTCFullYear()}-${String(timestamp.getUTCMonth() + 1).padStart(2, '0')}`;
      default:
        throw new Error(`Unknown granularity: ${this.config.granularity}`);
    }
  }

  /**
   * 写入行到对应分区
   */
  writeRow(row: Row, timestamp: Date): void {
    const partitionName = this.getPartitionName(timestamp);
    
    if (!this.currentPartition || this.currentPartition.name !== partitionName) {
      this.switchPartition(partitionName, timestamp);
    }

    this.currentPartition.rows.push(row);
    this.currentPartition.dirty = true;

    // 内存分区满了，刷盘
    if (this.currentPartition.rows.length >= this.maxRowsInMemory) {
      this.flushCurrent();
    }
  }

  /**
   * 批量写入
   */
  writeRows(rows: Row[], timestamps: Date[]): void {
    for (let i = 0; i < rows.length; i++) {
      this.writeRow(rows[i], timestamps[i]);
    }
  }

  /**
   * 查询分区数据
   */
  query(start: Date, end: Date, filter?: (row: Row) => boolean): Row[] {
    const results: Row[] = [];
    const partitions = this.getPartitionsInRange(start, end);

    for (const partition of partitions) {
      const rows = this.readPartition(partition);
      for (const row of rows) {
        const ts = new Date(row[this.config.column] as string | number);
        if (ts >= start && ts <= end) {
          if (!filter || filter(row)) {
            results.push(row);
          }
        }
      }
    }

    return results;
  }

  /**
   * 获取分区列表
   */
  listPartitions(): PartitionInfo[] {
    const partitions: PartitionInfo[] = [];
    
    try {
      const entries = readdirSync(this.dataDir);
      for (const entry of entries) {
        if (entry.endsWith('.jsonl')) {
          const filePath = join(this.dataDir, entry);
          const stats = statSync(filePath);
          const name = entry.replace('.jsonl', '');
          
          partitions.push({
            name,
            startTime: this.parsePartitionTime(name),
            endTime: this.getPartitionEnd(name),
            rowCount: this.countRows(filePath),
            fileSize: stats.size
          });
        }
      }
    } catch {}

    return partitions.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
  }

  /**
   * 强制刷盘当前分区
   */
  flush(): void {
    this.flushCurrent();
  }

  private switchPartition(name: string, timestamp: Date): void {
    // 先刷盘旧分区
    if (this.currentPartition && this.currentPartition.dirty) {
      this.flushCurrent();
    }

    // 加载或创建新分区
    const filePath = join(this.dataDir, `${name}.jsonl`);
    let rows: Row[] = [];

    if (existsSync(filePath)) {
      rows = this.loadPartition(filePath);
    }

    this.currentPartition = {
      name,
      startTime: timestamp,
      endTime: this.getPartitionEnd(name),
      rows,
      dirty: false,
      filePath
    };
  }

  private flushCurrent(): void {
    if (!this.currentPartition || !this.currentPartition.dirty) return;

    const { filePath, rows } = this.currentPartition;
    
    // 确保目录存在
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // 追加写入（JSON Lines 格式）
    const lines = rows.map(r => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(filePath, lines);
    
    this.currentPartition.dirty = false;
    this.currentPartition.rows = []; // 清空内存
  }

  private loadPartition(filePath: string): Row[] {
    try {
      const content = readFileSync(filePath, 'utf-8');
      return content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  private readPartition(name: string): Row[] {
    // 如果是当前分区，直接返回
    if (this.currentPartition?.name === name) {
      return this.currentPartition.rows;
    }

    // 从磁盘读取
    const filePath = join(this.dataDir, `${name}.jsonl`);
    return this.loadPartition(filePath);
  }

  private getPartitionsInRange(start: Date, end: Date): string[] {
    const partitions = this.listPartitions();
    return partitions
      .filter(p => p.startTime <= end && p.endTime >= start)
      .map(p => p.name);
  }

  private parsePartitionTime(name: string): Date {
    const parts = name.split('-').map(Number);
    if (parts.length === 4) { // hour
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3]));
    } else if (parts.length === 3) { // day
      return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    } else { // month
      return new Date(Date.UTC(parts[0], parts[1] - 1, 1));
    }
  }

  private getPartitionEnd(name: string): Date {
    const start = this.parsePartitionTime(name);
    
    switch (this.config.granularity) {
      case 'hour':
        return new Date(start.getTime() + 60 * 60 * 1000);
      case 'day':
        return new Date(start.getTime() + 24 * 60 * 60 * 1000);
      case 'month':
        return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      default:
        return new Date(start.getTime() + 24 * 60 * 60 * 1000);
    }
  }

  private countRows(filePath: string): number {
    try {
      const content = readFileSync(filePath, 'utf-8');
      return content.trim().split('\n').filter(Boolean).length;
    } catch {
      return 0;
    }
  }
}
