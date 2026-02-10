// ============================================================
// 数据库 Provider 抽象层
// 支持多种后端：ndtsdb (Columnar), 内存
// ============================================================

import type { Kline } from '../types/kline';

export type DatabaseProviderType = 'ndtsdb' | 'memory';

export interface DatabaseProviderConfig {
  type: DatabaseProviderType;
  // ndtsdb 配置
  dataDir?: string;
  partitionBy?: 'hour' | 'day' | 'month';
  // 通用配置
  cacheSize?: number;
}

export interface QueryOptions {
  symbol?: string;
  interval?: string;
  startTime?: Date;
  endTime?: Date;
  limit?: number;
}

export interface AggregateOptions {
  symbol: string;
  interval: string;
  bucketSize: string;  // '1m', '5m', '1h', etc.
  aggregations: Array<{
    column: 'open' | 'high' | 'low' | 'close' | 'volume';
    op: 'first' | 'last' | 'min' | 'max' | 'sum' | 'avg';
  }>;
}

export interface DatabaseStats {
  totalRows: number;
  symbols: string[];
  intervals: string[];
  oldestBar?: Date;
  newestBar?: Date;
}

/**
 * 数据库 Provider 接口
 * 所有数据库实现必须遵循此接口
 */
export interface DatabaseProvider {
  readonly type: DatabaseProviderType;
  
  // 连接管理
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // 数据写入
  insertKlines(klines: Kline[]): Promise<number>;  // 返回插入数量
  upsertKlines(klines: Kline[]): Promise<number>;  // 返回更新/插入数量
  
  // 数据查询
  queryKlines(options: QueryOptions): Promise<Kline[]>;
  getKline(symbol: string, interval: string, timestamp: number): Promise<Kline | null>;
  getLatestKline(symbol: string, interval: string): Promise<Kline | null>;
  
  // 聚合查询
  sampleBy(options: AggregateOptions): Promise<Array<Record<string, number | Date>>>;
  
  // 统计信息
  getStats(): Promise<DatabaseStats>;
  getSymbolStats(symbol: string, interval: string): Promise<{
    count: number;
    earliest: Date;
    latest: Date;
    avgPrice: number;
    minPrice: number;
    maxPrice: number;
  }>;
  
  // 维护操作
  vacuum(): Promise<void>;
  backup(path: string): Promise<void>;
}

// 导出具体实现
export { NdtsdbProvider } from './providers/ndtsdb-provider';
export { MemoryProvider } from './providers/memory-provider';
