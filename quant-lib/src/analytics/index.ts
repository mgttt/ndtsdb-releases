// ============================================================
// 交易分析数据库 - 实时落盘 (ndtsdb 版本)
//
// 特性：
// - 使用 ndtsdb AppendWriter 增量写入
// - 批量写入（缓冲区 + 定时落盘）
// - JSON 备份兜底
// ============================================================

import { AppendWriter, ColumnarTable, SymbolTable } from 'ndtsdb';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface TradeRecord {
  tradeId: string;
  orderId: string;
  symbol: string;
  side: string;
  qty: number;
  price: number;
  fee: number;
  pnl?: number;
  timestamp?: Date;
}

export interface EquitySnapshot {
  accountName: string;
  timestamp: Date;
  totalEquity: number;
  availableBalance: number;
  positionValue: number;
  unrealisedPnl: number;
  positionsJson: string;
}

export interface AnalyticsConfig {
  dataDir?: string;
  batchSize?: number;
  flushIntervalMs?: number;
  jsonBackupDir?: string;
}

const TRADE_COLUMNS = [
  { name: 'trade_id', type: 'int64' },      // 用 hash 存
  { name: 'order_id', type: 'int64' },
  { name: 'symbol_id', type: 'int32' },
  { name: 'side', type: 'int16' },          // 1=buy, -1=sell
  { name: 'qty', type: 'float64' },
  { name: 'price', type: 'float64' },
  { name: 'fee', type: 'float64' },
  { name: 'pnl', type: 'float64' },
  { name: 'timestamp', type: 'int64' },
] as const;

const SNAPSHOT_COLUMNS = [
  { name: 'timestamp', type: 'int64' },
  { name: 'total_equity', type: 'float64' },
  { name: 'available_balance', type: 'float64' },
  { name: 'position_value', type: 'float64' },
  { name: 'unrealised_pnl', type: 'float64' },
] as const;

export class TradeAnalytics {
  private dataDir: string;
  private batchSize: number;
  private flushIntervalMs: number;
  private jsonBackupDir: string;
  private batchBuffer: TradeRecord[] = [];
  private snapshotBuffer: EquitySnapshot[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private isInitialized = false;
  private symbols: SymbolTable;
  private accounts: SymbolTable;

  constructor(config: AnalyticsConfig = {}) {
    this.dataDir = config.dataDir || './runtime/analytics';
    this.batchSize = config.batchSize || 100;
    this.flushIntervalMs = config.flushIntervalMs || 5000;
    this.jsonBackupDir = config.jsonBackupDir || './runtime/analytics-backup';

    // 确保目录存在
    if (!existsSync(this.dataDir)) {
      mkdir(this.dataDir, { recursive: true });
    }
    if (!existsSync(this.jsonBackupDir)) {
      mkdir(this.jsonBackupDir, { recursive: true });
    }

    // 初始化 SymbolTable
    this.symbols = new SymbolTable(join(this.dataDir, 'symbols.json'));
    this.accounts = new SymbolTable(join(this.dataDir, 'accounts.json'));
  }

  /**
   * 初始化数据库
   */
  async init(): Promise<void> {
    if (this.isInitialized) return;

    // ndtsdb 不需要显式建表，AppendWriter 自动处理
    this.isInitialized = true;

    // 启动定时刷新
    this.flushTimer = setInterval(() => {
      this.flush().catch(console.error);
    }, this.flushIntervalMs);

    console.log('[TradeAnalytics] ndtsdb 初始化完成:', this.dataDir);
  }

  /**
   * 记录成交
   */
  recordTrade(trade: TradeRecord): void {
    this.batchBuffer.push({
      ...trade,
      timestamp: trade.timestamp || new Date(),
    });

    if (this.batchBuffer.length >= this.batchSize) {
      this.flush().catch(console.error);
    }
  }

  /**
   * 记录资金快照
   */
  recordEquity(snapshot: EquitySnapshot): void {
    this.snapshotBuffer.push(snapshot);

    if (this.snapshotBuffer.length >= this.batchSize) {
      this.flush().catch(console.error);
    }
  }

  /**
   * 刷新缓冲区到磁盘
   */
  async flush(): Promise<void> {
    if (this.batchBuffer.length === 0 && this.snapshotBuffer.length === 0) return;

    const tradesToFlush = [...this.batchBuffer];
    const snapshotsToFlush = [...this.snapshotBuffer];
    this.batchBuffer = [];
    this.snapshotBuffer = [];

    // 并行写入
    await Promise.all([
      this.flushTrades(tradesToFlush),
      this.flushSnapshots(snapshotsToFlush),
    ]);
  }

  /**
   * 写入交易记录
   */
  private async flushTrades(trades: TradeRecord[]): Promise<void> {
    if (trades.length === 0) return;

    const path = join(this.dataDir, 'trades.ndts');
    const writer = new AppendWriter(path, TRADE_COLUMNS.map(c => ({ name: c.name, type: c.type })));
    writer.open();

    const rows = trades.map(t => ({
      trade_id: hashString(t.tradeId),
      order_id: hashString(t.orderId),
      symbol_id: this.symbols.getOrCreateId(t.symbol),
      side: t.side === 'buy' ? 1 : -1,
      qty: t.qty,
      price: t.price,
      fee: t.fee,
      pnl: t.pnl || 0,
      timestamp: BigInt((t.timestamp || new Date()).getTime()),
    }));

    writer.append(rows);
    writer.close();

    // JSON 备份
    await this.backupToJson('trades', trades);
  }

  /**
   * 写入资金快照
   */
  private async flushSnapshots(snapshots: EquitySnapshot[]): Promise<void> {
    if (snapshots.length === 0) return;

    // 按 account 分组存储
    for (const snapshot of snapshots) {
      const accountId = this.accounts.getOrCreateId(snapshot.accountName);
      const path = join(this.dataDir, 'snapshots', `${accountId}.ndts`);

      await mkdir(dirname(path), { recursive: true });

      const writer = new AppendWriter(path, SNAPSHOT_COLUMNS.map(c => ({ name: c.name, type: c.type })));
      writer.open();

      writer.append([{
        timestamp: BigInt(snapshot.timestamp.getTime()),
        total_equity: snapshot.totalEquity,
        available_balance: snapshot.availableBalance,
        position_value: snapshot.positionValue,
        unrealised_pnl: snapshot.unrealisedPnl,
      }]);

      writer.close();
    }

    // JSON 备份
    await this.backupToJson('snapshots', snapshots);
  }

  /**
   * JSON 备份
   */
  private async backupToJson(type: string, data: any[]): Promise<void> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = join(this.jsonBackupDir, `${type}-${timestamp}.json`);
    await writeFile(backupPath, JSON.stringify(data, null, 2));
  }

  /**
   * 查询交易记录
   */
  async queryTrades(options: {
    symbol?: string;
    startTime?: Date;
    endTime?: Date;
    limit?: number;
  } = {}): Promise<TradeRecord[]> {
    const path = join(this.dataDir, 'trades.ndts');
    if (!existsSync(path)) return [];

    const { header, data } = AppendWriter.readAll(path);
    if (header.totalRows === 0) return [];

    const timestamps = data.get('timestamp') as BigInt64Array;
    const symbolIds = data.get('symbol_id') as Int32Array;
    const sides = data.get('side') as Int16Array;
    const qtys = data.get('qty') as Float64Array;
    const prices = data.get('price') as Float64Array;
    const fees = data.get('fee') as Float64Array;
    const pnls = data.get('pnl') as Float64Array;

    const trades: TradeRecord[] = [];
    const startTs = options.startTime?.getTime();
    const endTs = options.endTime?.getTime();
    const targetSymbolId = options.symbol ? this.symbols.getId(options.symbol) : undefined;

    for (let i = header.totalRows - 1; i >= 0; i--) {
      const ts = Number(timestamps[i]);
      if (startTs && ts < startTs) continue;
      if (endTs && ts > endTs) continue;
      if (targetSymbolId !== undefined && symbolIds[i] !== targetSymbolId) continue;

      trades.push({
        tradeId: String(i), // 简化
        orderId: String(i),
        symbol: this.symbols.getName(symbolIds[i]) || '',
        side: sides[i] === 1 ? 'buy' : 'sell',
        qty: qtys[i],
        price: prices[i],
        fee: fees[i],
        pnl: pnls[i],
        timestamp: new Date(ts),
      });

      if (options.limit && trades.length >= options.limit) break;
    }

    return trades;
  }

  /**
   * 查询资金曲线
   */
  async getEquityCurve(accountName: string): Promise<Array<{ timestamp: Date; equity: number }>> {
    const accountId = this.accounts.getId(accountName);
    if (accountId === undefined) return [];

    const path = join(this.dataDir, 'snapshots', `${accountId}.ndts`);
    if (!existsSync(path)) return [];

    const { header, data } = AppendWriter.readAll(path);
    if (header.totalRows === 0) return [];

    const timestamps = data.get('timestamp') as BigInt64Array;
    const equities = data.get('total_equity') as Float64Array;

    const curve: Array<{ timestamp: Date; equity: number }> = [];
    for (let i = 0; i < header.totalRows; i++) {
      curve.push({
        timestamp: new Date(Number(timestamps[i])),
        equity: equities[i],
      });
    }

    return curve;
  }

  /**
   * 计算交易统计
   */
  async getTradeStats(): Promise<{
    totalTrades: number;
    winCount: number;
    lossCount: number;
    totalPnl: number;
    avgPnl: number;
    winRate: number;
  }> {
    const trades = await this.queryTrades();

    const totalTrades = trades.length;
    const winCount = trades.filter(t => (t.pnl || 0) > 0).length;
    const lossCount = trades.filter(t => (t.pnl || 0) < 0).length;
    const totalPnl = trades.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
    const winRate = totalTrades > 0 ? (winCount / totalTrades) * 100 : 0;

    return {
      totalTrades,
      winCount,
      lossCount,
      totalPnl,
      avgPnl,
      winRate,
    };
  }

  /**
   * 关闭数据库
   */
  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    // 最后刷新
    await this.flush();

    // 保存 symbol 映射
    this.symbols.save();
    this.accounts.save();

    console.log('[TradeAnalytics] 已关闭');
  }

  /**
   * 重置数据
   */
  async reset(): Promise<void> {
    await this.flush();
    this.batchBuffer = [];
    this.snapshotBuffer = [];

    // 删除数据文件
    const { rmSync } = await import('fs');
    if (existsSync(this.dataDir)) {
      rmSync(this.dataDir, { recursive: true });
    }
  }
}

/**
 * 字符串哈希（用于 trade_id / order_id）
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
