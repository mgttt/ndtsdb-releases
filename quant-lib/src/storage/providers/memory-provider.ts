// ============================================================
// 内存 Provider 实现
// 纯内存存储，最高性能，不持久化
// ============================================================

import type { Kline } from '../../types/kline';
import type { 
  DatabaseProvider, 
  DatabaseProviderConfig, 
  QueryOptions, 
  AggregateOptions,
  DatabaseStats 
} from '../provider';

export class MemoryProvider implements DatabaseProvider {
  readonly type = 'memory' as const;
  private data: Kline[] = [];
  private config: DatabaseProviderConfig;

  constructor(config: DatabaseProviderConfig) {
    this.config = config;
  }

  async connect(): Promise<void> {
    // 内存数据库无需连接
    this.data = [];
  }

  async disconnect(): Promise<void> {
    this.data = [];
  }

  isConnected(): boolean {
    return true;
  }

  async insertKlines(klines: Kline[]): Promise<number> {
    this.data.push(...klines);
    // 保持按时间排序
    this.data.sort((a, b) => a.timestamp - b.timestamp);
    return klines.length;
  }

  async upsertKlines(klines: Kline[]): Promise<number> {
    // 简单的 upsert：先删除再插入
    for (const k of klines) {
      const idx = this.data.findIndex(
        d => d.symbol === k.symbol && 
             d.interval === k.interval && 
             d.timestamp === k.timestamp
      );
      if (idx >= 0) {
        this.data[idx] = k;
      } else {
        this.data.push(k);
      }
    }
    this.data.sort((a, b) => a.timestamp - b.timestamp);
    return klines.length;
  }

  async queryKlines(options: QueryOptions): Promise<Kline[]> {
    let results = [...this.data];

    if (options.symbol) {
      results = results.filter(k => k.symbol === options.symbol);
    }
    if (options.interval) {
      results = results.filter(k => k.interval === options.interval);
    }
    // timestamp 统一为 Unix 秒
    if (options.startTime) {
      const start = Math.floor(options.startTime.getTime() / 1000);
      results = results.filter(k => k.timestamp >= start);
    }
    if (options.endTime) {
      const end = Math.floor(options.endTime.getTime() / 1000);
      results = results.filter(k => k.timestamp <= end);
    }

    if (options.limit) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async getKline(symbol: string, interval: string, timestamp: number): Promise<Kline | null> {
    return this.data.find(
      k => k.symbol === symbol && k.interval === interval && k.timestamp === timestamp
    ) || null;
  }

  async getLatestKline(symbol: string, interval: string): Promise<Kline | null> {
    const filtered = this.data.filter(
      k => k.symbol === symbol && k.interval === interval
    );
    if (filtered.length === 0) return null;
    return filtered.reduce((latest, k) => k.timestamp > latest.timestamp ? k : latest);
  }

  async sampleBy(options: AggregateOptions): Promise<Array<Record<string, number | Date>>> {
    const filtered = await this.queryKlines({
      symbol: options.symbol,
      interval: options.interval
    });

    if (filtered.length === 0) return [];

    // 按时间桶分组
    const intervalSec = this.parseIntervalSec(options.bucketSize);
    const buckets = new Map<number, Kline[]>();

    for (const k of filtered) {
      const bucket = Math.floor(k.timestamp / intervalSec) * intervalSec;
      if (!buckets.has(bucket)) {
        buckets.set(bucket, []);
      }
      buckets.get(bucket)!.push(k);
    }

    // 聚合
    const results: Array<Record<string, number | Date>> = [];

    for (const [bucketTime, klines] of buckets) {
      const result: Record<string, number | Date> = { 
        bucket: new Date(bucketTime * 1000),
        timestamp: new Date(bucketTime * 1000)
      };

      for (const agg of options.aggregations) {
        const values = klines.map(k => k[agg.column]);
        
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

    return results.sort((a, b) => (a.bucket as Date).getTime() - (b.bucket as Date).getTime());
  }

  private parseIntervalSec(bucketSize: string): number {
  const match = bucketSize.match(/^(\d+)([smhd])$/);
  if (!match) return 60;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(num) * multipliers[unit];
}


  async getStats(): Promise<DatabaseStats> {
    const symbols = [...new Set(this.data.map(k => k.symbol))];
    const intervals = [...new Set(this.data.map(k => k.interval))];

    return {
      totalRows: this.data.length,
      symbols,
      intervals
    };
  }

  async getSymbolStats(symbol: string, interval: string): Promise<{
    count: number;
    earliest: Date;
    latest: Date;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
  }> {
    const filtered = this.data.filter(
      k => k.symbol === symbol && k.interval === interval
    );

    if (filtered.length === 0) {
      return { count: 0, earliest: new Date(0), latest: new Date(0), avgPrice: 0, minPrice: 0, maxPrice: 0 };
    }

    const closes = filtered.map(k => k.close);
    const timestamps = filtered.map(k => k.timestamp);

    return {
      count: filtered.length,
      earliest: new Date(Math.min(...timestamps)),
      latest: new Date(Math.max(...timestamps)),
      avgPrice: closes.reduce((a, b) => a + b, 0) / closes.length,
      minPrice: Math.min(...filtered.map(k => k.low)),
      maxPrice: Math.max(...filtered.map(k => k.high))
    };
  }

  async vacuum(): Promise<void> {
    // 内存数据库不需要 vacuum
  }

  async backup(path: string): Promise<void> {
    // 简化实现：将数据序列化到文件
    const { writeFileSync } = await import('fs');
    writeFileSync(path, JSON.stringify(this.data));
  }

  // 从文件加载
  async loadFromFile(path: string): Promise<void> {
    const { readFileSync, existsSync } = await import('fs');
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8');
      this.data = JSON.parse(content);
    }
  }
}

function parseIntervalMs(bucketSize: string): number {
  const match = bucketSize.match(/^(\d+)([smhd])$/);
  if (!match) return 60000;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return parseInt(num) * multipliers[unit];
}
