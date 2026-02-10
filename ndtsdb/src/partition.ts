// ============================================================
// 分区表管理 - 按时间/symbol 自动分区
// ============================================================

import { AppendWriter, AppendFileHeader, AppendWriterOptions } from './append.js';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';

/**
 * 分区策略
 */
export type PartitionStrategy =
  | { type: 'time'; column: string; interval: 'day' | 'month' | 'year' }
  | { type: 'range'; column: string; ranges: Array<{ min: number; max: number; label: string }> }
  | { type: 'hash'; column: string; buckets: number };

/**
 * 分区元数据
 */
export interface PartitionMeta {
  label: string; // 分区标识（如 "2024-01"）
  path: string; // 分区文件路径
  minValue?: bigint | number; // 分区最小值（时间/范围分区）
  maxValue?: bigint | number; // 分区最大值
  rows: number; // 分区行数
  createdAt: number; // 创建时间
}

/**
 * 分区表管理器
 */
export class PartitionedTable {
  private basePath: string;
  private columns: Array<{ name: string; type: string }>;
  private strategy: PartitionStrategy;
  private options?: AppendWriterOptions;
  private partitions: Map<string, PartitionMeta> = new Map();
  private writers: Map<string, AppendWriter> = new Map();

  constructor(
    basePath: string,
    columns: Array<{ name: string; type: string }>,
    strategy: PartitionStrategy,
    options?: AppendWriterOptions
  ) {
    this.basePath = basePath;
    this.columns = columns;
    this.strategy = strategy;
    this.options = options;

    // 确保基础目录存在
    if (!existsSync(basePath)) {
      mkdirSync(basePath, { recursive: true });
    }

    // 加载已有分区
    this.loadPartitions();
  }

  /**
   * 加载已有分区元数据
   */
  private loadPartitions(): void {
    if (!existsSync(this.basePath)) return;

    const files = readdirSync(this.basePath).filter(f => f.endsWith('.ndts'));

    for (const file of files) {
      const path = join(this.basePath, file);
      const label = file.replace('.ndts', '');

      try {
        const header = AppendWriter.readHeader(path);
        const stat = statSync(path);

        this.partitions.set(label, {
          label,
          path,
          rows: header.totalRows,
          createdAt: stat.birthtimeMs,
        });
      } catch (e) {
        console.warn(`Failed to load partition ${label}:`, e);
      }
    }

    console.log(`[PartitionedTable] Loaded ${this.partitions.size} partitions`);
  }

  /**
   * 根据策略确定分区标签
   */
  private getPartitionLabel(row: Record<string, any>): string {
    switch (this.strategy.type) {
      case 'time': {
        const colValue = row[this.strategy.column];
        const timestamp = typeof colValue === 'bigint' ? Number(colValue) : colValue;
        const date = new Date(timestamp);

        switch (this.strategy.interval) {
          case 'day':
            return date.toISOString().slice(0, 10); // YYYY-MM-DD
          case 'month':
            return date.toISOString().slice(0, 7); // YYYY-MM
          case 'year':
            return date.toISOString().slice(0, 4); // YYYY
        }
        break;
      }

      case 'range': {
        const colValue = Number(row[this.strategy.column]);
        for (const range of this.strategy.ranges) {
          if (colValue >= range.min && colValue < range.max) {
            return range.label;
          }
        }
        return 'default';
      }

      case 'hash': {
        const colValue = String(row[this.strategy.column]);
        const hash = this.simpleHash(colValue);
        const bucket = hash % this.strategy.buckets;
        return `bucket-${bucket}`;
      }
    }

    return 'default';
  }

  /**
   * 简单哈希函数
   */
  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * 获取分区的 AppendWriter（自动创建）
   */
  private getWriter(label: string): AppendWriter {
    if (this.writers.has(label)) {
      return this.writers.get(label)!;
    }

    const path = join(this.basePath, `${label}.ndts`);
    const writer = new AppendWriter(path, this.columns, this.options);

    const isNew = !existsSync(path);
    writer.open(); // open() 会自动创建文件如果不存在

    if (isNew) {
      this.partitions.set(label, {
        label,
        path,
        rows: 0,
        createdAt: Date.now(),
      });
    }

    this.writers.set(label, writer);
    return writer;
  }

  /**
   * 写入数据（自动分区）
   */
  append(rows: Record<string, any>[]): void {
    // 按分区分组
    const groups = new Map<string, Record<string, any>[]>();

    for (const row of rows) {
      const label = this.getPartitionLabel(row);
      if (!groups.has(label)) {
        groups.set(label, []);
      }
      groups.get(label)!.push(row);
    }

    // 写入各分区
    for (const [label, partitionRows] of groups) {
      const writer = this.getWriter(label);
      writer.append(partitionRows);

      // 更新元数据
      const meta = this.partitions.get(label)!;
      meta.rows += partitionRows.length;
    }
  }

  /**
   * 查询（跨分区）
   * @param filter 行过滤函数
   * @param timeRange 时间范围过滤（可选，用于优化分区扫描）
   */
  query(
    filter?: (row: Record<string, any>) => boolean,
    timeRange?: { min?: number | bigint; max?: number | bigint }
  ): Array<Record<string, any>> {
    const results: Array<Record<string, any>> = [];

    // 智能分区过滤（仅扫描时间范围内的分区）
    let partitionsToScan = Array.from(this.partitions.values());

    if (timeRange && this.strategy.type === 'time') {
      partitionsToScan = this.filterPartitionsByTimeRange(timeRange);
    }

    // 扫描分区
    for (const meta of partitionsToScan) {
      const { header, data } = AppendWriter.readAll(meta.path);

      for (let i = 0; i < header.totalRows; i++) {
        const row: Record<string, any> = {};
        for (const [colName, colData] of data) {
          row[colName] = (colData as any)[i];
        }

        if (!filter || filter(row)) {
          results.push(row);
        }
      }
    }

    return results;
  }

  /**
   * 根据时间范围过滤分区
   */
  private filterPartitionsByTimeRange(timeRange: { min?: number | bigint; max?: number | bigint }): PartitionMeta[] {
    if (this.strategy.type !== 'time') {
      return Array.from(this.partitions.values());
    }

    const min = timeRange.min ? Number(timeRange.min) : -Infinity;
    const max = timeRange.max ? Number(timeRange.max) : Infinity;

    return Array.from(this.partitions.values()).filter((meta) => {
      // 从分区标签推断时间范围
      const partitionTime = this.getPartitionTimeRange(meta.label);
      if (!partitionTime) return true; // 无法推断，保留

      // 检查分区时间范围是否与查询范围重叠
      return !(partitionTime.max < min || partitionTime.min > max);
    });
  }

  /**
   * 从分区标签推断时间范围
   */
  private getPartitionTimeRange(label: string): { min: number; max: number } | null {
    if (this.strategy.type !== 'time') return null;

    try {
      switch (this.strategy.interval) {
        case 'day': {
          // label 格式: YYYY-MM-DD
          const date = new Date(label);
          const min = date.getTime();
          const max = min + 24 * 60 * 60 * 1000 - 1;
          return { min, max };
        }

        case 'month': {
          // label 格式: YYYY-MM
          const [year, month] = label.split('-').map(Number);
          const min = new Date(year, month - 1, 1).getTime();
          const max = new Date(year, month, 0, 23, 59, 59, 999).getTime();
          return { min, max };
        }

        case 'year': {
          // label 格式: YYYY
          const year = parseInt(label);
          const min = new Date(year, 0, 1).getTime();
          const max = new Date(year, 11, 31, 23, 59, 59, 999).getTime();
          return { min, max };
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  /**
   * 获取所有分区元数据
   */
  getPartitions(): PartitionMeta[] {
    return Array.from(this.partitions.values());
  }

  /**
   * 关闭所有打开的 writer
   */
  async closeAll(): Promise<void> {
    for (const writer of this.writers.values()) {
      await writer.close();
    }
    this.writers.clear();
  }
}
