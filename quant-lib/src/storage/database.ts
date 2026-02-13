// ============================================================
// ndtsdb 数据库管理 - 基于 PartitionedTable
//
// 架构：每个 interval 一个 PartitionedTable，按 symbol_id 哈希分区
// 文件数：300 个文件（3 intervals × 100 partitions）vs 旧架构 9000 个文件
// ============================================================

import { PartitionedTable, SymbolTable } from 'ndtsdb';
import type { Kline } from '../types/kline';
import type { DatabaseConfig } from '../types/common';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const KLINE_COLUMNS = [
  { name: 'symbol_id', type: 'int32' },
  { name: 'timestamp', type: 'int64' },
  { name: 'open', type: 'float64' },
  { name: 'high', type: 'float64' },
  { name: 'low', type: 'float64' },
  { name: 'close', type: 'float64' },
  { name: 'volume', type: 'float64' },
  { name: 'quoteVolume', type: 'float64' },
  { name: 'trades', type: 'int32' },
  { name: 'takerBuyVolume', type: 'float64' },
  { name: 'takerBuyQuoteVolume', type: 'float64' },
] as const;

const PARTITION_BUCKETS = 100; // 100 个分区

export class KlineDatabase {
  private dataDir: string;
  private symbols: SymbolTable;
  private tables: Map<string, PartitionedTable> = new Map(); // interval -> PartitionedTable
  private config: DatabaseConfig;

  constructor(config: DatabaseConfig | string = `${process.env.HOME}/.quant-lib/data/ndtsdb-v2`) {
    if (typeof config === 'string') {
      this.config = {
        path: config,
        accessMode: 'READ_WRITE',
        autoInit: true
      };
      this.dataDir = config;
    } else {
      this.config = {
        accessMode: 'READ_WRITE',
        autoInit: true,
        ...config
      };
      this.dataDir = config.path || `${process.env.HOME}/.quant-lib/data/ndtsdb-v2`;
    }

    // 确保目录存在
    if (!existsSync(this.dataDir)) {
      mkdirSync(this.dataDir, { recursive: true });
    }

    // 初始化 SymbolTable
    this.symbols = new SymbolTable(join(this.dataDir, 'symbols.json'));
  }

  /**
   * 获取或创建 interval 的 PartitionedTable
   */
  private getTable(interval: string): PartitionedTable {
    if (this.tables.has(interval)) {
      return this.tables.get(interval)!;
    }

    const tablePath = join(this.dataDir, 'klines-partitioned', interval);
    const table = new PartitionedTable(
      tablePath,
      KLINE_COLUMNS.map(c => ({ name: c.name, type: c.type })),
      { type: 'hash', column: 'symbol_id', buckets: PARTITION_BUCKETS },
      {
        compression: {
          enabled: true,
          algorithms: {
            symbol_id: 'delta',
            timestamp: 'delta',
            open: 'gorilla',
            high: 'gorilla',
            low: 'gorilla',
            close: 'gorilla',
            volume: 'gorilla',
            quoteVolume: 'gorilla',
            trades: 'delta',
            takerBuyVolume: 'gorilla',
            takerBuyQuoteVolume: 'gorilla',
          },
        },
      }
    );

    this.tables.set(interval, table);
    return table;
  }

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    console.log('[KlineDatabase] 初始化完成:', this.dataDir);
  }

  /**
   * 兼容旧接口
   */
  async connect(): Promise<void> {
    return this.init();
  }

  /**
   * 关闭数据库
   */
  async close(): Promise<void> {
    this.symbols.save();
    // PartitionedTable 会在内部自动管理 writer.close()
  }

  /**
   * 插入 K线数据
   */
  async insertKlines(klines: Kline[]): Promise<void> {
    if (klines.length === 0) return;

    // 按 interval 分组
    const groups = new Map<string, Kline[]>();
    for (const kline of klines) {
      if (!groups.has(kline.interval)) {
        groups.set(kline.interval, []);
      }
      groups.get(kline.interval)!.push(kline);
    }

    // 每个 interval 写入对应的 PartitionedTable
    for (const [interval, groupKlines] of groups) {
      const table = this.getTable(interval);

      const rows = groupKlines.map(k => {
        const symbolId = this.symbols.getOrCreateId(k.symbol);
        return {
          symbol_id: symbolId,
          timestamp: BigInt(k.timestamp),
          open: k.open,
          high: k.high,
          low: k.low,
          close: k.close,
          volume: k.volume,
          quoteVolume: k.quoteVolume || 0,
          trades: k.trades || 0,
          takerBuyVolume: k.takerBuyVolume || 0,
          takerBuyQuoteVolume: k.takerBuyQuoteVolume || 0,
        };
      });

      table.append(rows);
    }
  }

  /**
   * UPSERT K线数据（去重）
   */
  async upsertKlines(klines: Kline[]): Promise<void> {
    if (klines.length === 0) return;

    // 按 symbol + interval 分组
    const groups = new Map<string, Kline[]>();
    for (const kline of klines) {
      const key = `${kline.symbol}:${kline.interval}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(kline);
    }

    for (const [key, groupKlines] of groups) {
      const [symbol, interval] = key.split(':');

      // 排序 + 去重
      const sorted = groupKlines
        .slice()
        .sort((a, b) => a.timestamp - b.timestamp);

      const latest = await this.getLatestTimestamp(symbol, interval);
      const filtered = latest == null
        ? sorted
        : sorted.filter(k => k.timestamp > latest);

      if (filtered.length === 0) continue;

      await this.insertKlines(filtered);
    }
  }

  /**
   * 获取最新 timestamp（高效实现，避免全表扫描）
   * 
   * 优化：使用 PartitionedTable.getMax() API + partitionHint
   * - 哈希分区：只扫描 symbol_id 对应的 bucket（~100x 加速）
   * - 时间分区：只扫描最新分区
   */
  async getLatestTimestamp(symbol: string, interval: string): Promise<number | null> {
    const symbolId = this.symbols.getId(symbol);
    if (symbolId === undefined) return null;

    const table = this.getTable(interval);

    // 使用高效的 getMax API（传递 partitionHint 定位 bucket）
    const maxTs = table.getMax(
      'timestamp',
      row => row.symbol_id === symbolId,
      { symbol_id: symbolId } // partitionHint：直接定位到对应 bucket
    );

    if (maxTs === null) return null;

    // 转换 bigint → number
    return typeof maxTs === 'bigint' ? Number(maxTs) : maxTs;
  }

  /**
   * 别名：getMaxTimestamp
   */
  async getMaxTimestamp(symbol: string, interval: string): Promise<number | null> {
    return this.getLatestTimestamp(symbol, interval);
  }

  /**
   * 获取最新一根 K线（优化：利用 reverse + limit=1）
   */
  async getLatestKline(symbol: string, interval: string): Promise<Kline | null> {
    const symbolId = this.symbols.getId(symbol);
    if (symbolId === undefined) return null;

    const table = this.getTable(interval);
    
    // 优化：倒序扫描 + limit=1（只查一条）
    const rows = table.query(
      row => row.symbol_id === symbolId,
      { reverse: true, limit: 1 }
    );

    if (rows.length === 0) return null;

    const latest = rows[0];
    const [baseCurrency, quoteCurrency] = symbol.split('/');
    
    return {
      symbol,
      exchange: 'OTHER',
      baseCurrency,
      quoteCurrency,
      interval,
      timestamp: Number(latest.timestamp),
      open: Number(latest.open),
      high: Number(latest.high),
      low: Number(latest.low),
      close: Number(latest.close),
      volume: Number(latest.volume),
      quoteVolume: Number(latest.quoteVolume ?? 0),
      trades: Number(latest.trades ?? 0),
      takerBuyVolume: Number(latest.takerBuyVolume ?? 0),
      takerBuyQuoteVolume: Number(latest.takerBuyQuoteVolume ?? 0),
    } as any;
  }

  /**
   * 查询 K线数据
   */
  async queryKlines(options: {
    symbol: string;
    interval: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
  }): Promise<Kline[]> {
    const symbolId = this.symbols.getId(options.symbol);
    if (symbolId === undefined) return [];

    const table = this.getTable(options.interval);

    // 构建过滤条件
    const startTs = options.startTime ? BigInt(options.startTime) : undefined;
    const endTs = options.endTime ? BigInt(options.endTime) : undefined;

    const rows = table.query(
      row => {
        if (row.symbol_id !== symbolId) return false;
        if (startTs && row.timestamp < startTs) return false;
        if (endTs && row.timestamp > endTs) return false;
        return true;
      },
      { min: startTs, max: endTs } // 优化分区扫描（仅用于时间分区，哈希分区会忽略）
    );

    // 转换为 Kline
    const klines: Kline[] = rows.map(row => {
      const [baseCurrency, quoteCurrency] = options.symbol.split('/');
      return {
        symbol: options.symbol,
        exchange: 'OTHER',
        baseCurrency,
        quoteCurrency,
        interval: options.interval,
        timestamp: Number(row.timestamp),
        open: Number(row.open),
        high: Number(row.high),
        low: Number(row.low),
        close: Number(row.close),
        volume: Number(row.volume),
        quoteVolume: Number(row.quoteVolume ?? 0),
        trades: Number(row.trades ?? 0),
        takerBuyVolume: Number(row.takerBuyVolume ?? 0),
        takerBuyQuoteVolume: Number(row.takerBuyQuoteVolume ?? 0),
      } as any;
    });

    // 排序 + limit
    klines.sort((a, b) => a.timestamp - b.timestamp);

    if (options.limit) {
      return klines.slice(0, options.limit);
    }

    return klines;
  }

  /**
   * 获取数据库统计
   */
  async getStats(): Promise<{
    totalSymbols: number;
    totalBars: number;
    symbols: string[];
    intervals: string[];
  }> {
    const symbols = this.symbols.getAllSymbols();
    const intervals = Array.from(this.tables.keys());

    let totalBars = 0;
    for (const table of this.tables.values()) {
      const partitions = (table as any).partitions as Map<string, any>;
      for (const meta of partitions.values()) {
        totalBars += meta.rows;
      }
    }

    return {
      totalSymbols: symbols.length,
      totalBars,
      symbols,
      intervals,
    };
  }
}
