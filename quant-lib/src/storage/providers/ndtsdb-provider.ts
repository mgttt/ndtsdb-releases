// ============================================================
// ndtsdb Provider 实现（分区：按 symbol + interval 分文件）
//
// 存储布局（v0.9 方案）：
//   <dataDir>/
//     symbols.json          (ndtsdb SymbolTable)
//     symbol-meta.json      (Kline 维度元信息)
//     klines/<interval>/<symbolId>.ndts   (AppendWriter NDTS chunked format)
//
// 说明：
// - Kline.timestamp 统一为 Unix 秒（number）
// - 本 provider 写入时使用 AppendWriter（追加 chunk，不重写整文件）
// - 读取时使用 AppendWriter.readAll（后续可升级为 mmap/索引读取）
// ============================================================

import { AppendWriter, ColumnarTable, SymbolTable } from 'ndtsdb';
import type { Kline } from '../../types/kline';
import type {
  DatabaseProvider,
  DatabaseProviderConfig,
  QueryOptions,
  AggregateOptions,
  DatabaseStats,
} from '../provider';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, renameSync, rmSync } from 'fs';
import { dirname, join } from 'path';

type SymbolMeta = Record<string, { exchange: string; baseCurrency: string; quoteCurrency: string }>;

const KLINE_COLUMNS = [
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

export class NdtsdbProvider implements DatabaseProvider {
  readonly type = 'ndtsdb' as const;
  private config: DatabaseProviderConfig;

  private symbols!: SymbolTable;
  private symbolMeta: SymbolMeta = {};
  private symbolMetaPath: string | null = null;

  // very small read cache
  private cache = new Map<string, { loadedAt: number; rows: Kline[] }>();

  private toRows(klines: Kline[]): Record<string, any>[] {
    return klines.map((k) => ({
      timestamp: BigInt(k.timestamp),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
      quoteVolume: k.quoteVolume ?? 0,
      trades: k.trades ?? 0,
      takerBuyVolume: k.takerBuyVolume ?? 0,
      takerBuyQuoteVolume: k.takerBuyQuoteVolume ?? 0,
    }));
  }

  constructor(config: DatabaseProviderConfig) {
    this.config = {
      dataDir: './data/ndtsdb',
      partitionBy: 'day',
      cacheSize: 100000,
      ...config,
    };
  }

  async connect(): Promise<void> {
    const dataDir = this.config.dataDir!;
    ensureDir(dataDir);

    this.symbols = new SymbolTable(join(dataDir, 'symbols.json'));

    this.symbolMetaPath = join(dataDir, 'symbol-meta.json');
    this.symbolMeta = {};
    try {
      if (existsSync(this.symbolMetaPath)) {
        this.symbolMeta = JSON.parse(readFileSync(this.symbolMetaPath, 'utf-8') || '{}');
      }
    } catch {
      this.symbolMeta = {};
    }

    ensureDir(join(dataDir, 'klines'));
  }

  async disconnect(): Promise<void> {
    try {
      this.symbols?.save();
    } catch {}

    if (this.symbolMetaPath) {
      try {
        writeFileSync(this.symbolMetaPath, JSON.stringify(this.symbolMeta, null, 2));
      } catch {}
    }

    this.cache.clear();
  }

  isConnected(): boolean {
    // SymbolTable 初始化即视为 connected
    return !!this.symbols;
  }

  async insertKlines(klines: Kline[]): Promise<number> {
    // insert-only path: assume no duplicates, append chunks directly
    if (!this.symbols) throw new Error('Database not connected');
    if (klines.length === 0) return 0;

    // still record meta
    for (const k of klines) {
      if (!this.symbolMeta[k.symbol]) {
        this.symbolMeta[k.symbol] = {
          exchange: k.exchange,
          baseCurrency: k.baseCurrency,
          quoteCurrency: k.quoteCurrency,
        };
      }
    }

    const groups = new Map<string, Kline[]>();
    for (const k of klines) {
      const interval = canonicalInterval(k.interval);
      const key = `${k.symbol}@@${interval}`;
      let arr = groups.get(key);
      if (!arr) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push({ ...k, interval });
    }

    for (const [key, arr] of groups) {
      const [symbol, interval] = key.split('@@');
      const symbolId = this.symbols.getOrCreateId(symbol);
      const filePath = this.getKlineFilePath(symbolId, interval);
      const metaPath = `${filePath}.meta.json`;
      ensureDir(dirname(filePath));

      arr.sort((a, b) => a.timestamp - b.timestamp);

      const incomingMin = arr[0].timestamp;
      const incomingMax = arr[arr.length - 1].timestamp;

      const meta = loadMeta(metaPath, filePath);

      const writer = new AppendWriter(filePath, [...KLINE_COLUMNS]);
      writer.open();
      writer.append(this.toRows(arr));
      writer.close();

      // update meta best-effort
      if (!meta) {
        saveMeta(metaPath, { minTs: incomingMin, maxTs: incomingMax, totalRows: arr.length, chunkCount: 1, updatedAt: Date.now() });
      } else {
        saveMeta(metaPath, {
          minTs: Math.min(meta.minTs, incomingMin),
          maxTs: Math.max(meta.maxTs, incomingMax),
          totalRows: meta.totalRows + arr.length,
          chunkCount: meta.chunkCount + 1,
          updatedAt: Date.now(),
        });
      }

      this.cache.delete(filePath);
    }

    try {
      this.symbols.save();
    } catch {}
    if (this.symbolMetaPath) {
      try {
        writeFileSync(this.symbolMetaPath, JSON.stringify(this.symbolMeta, null, 2));
      } catch {}
    }

    return klines.length;
  }

  async upsertKlines(klines: Kline[]): Promise<number> {
    if (!this.symbols) throw new Error('Database not connected');
    if (klines.length === 0) return 0;

    // 记录 symbol 元信息（首次出现时写入）
    for (const k of klines) {
      if (!this.symbolMeta[k.symbol]) {
        this.symbolMeta[k.symbol] = {
          exchange: k.exchange,
          baseCurrency: k.baseCurrency,
          quoteCurrency: k.quoteCurrency,
        };
      }
    }

    // group by (symbol, interval)
    const groups = new Map<string, Kline[]>();
    for (const k of klines) {
      const interval = canonicalInterval(k.interval);
      const key = `${k.symbol}@@${interval}`;
      let arr = groups.get(key);
      if (!arr) {
        arr = [];
        groups.set(key, arr);
      }
      arr.push({ ...k, interval });
    }

    for (const [key, arr] of groups) {
      const [symbol, interval] = key.split('@@');
      const symbolId = this.symbols.getOrCreateId(symbol);
      const filePath = this.getKlineFilePath(symbolId, interval);
      const metaPath = `${filePath}.meta.json`;
      ensureDir(dirname(filePath));

      // sort by timestamp asc
      arr.sort((a, b) => a.timestamp - b.timestamp);

      const incomingMin = arr[0].timestamp;
      const incomingMax = arr[arr.length - 1].timestamp;

      const meta = loadMeta(metaPath, filePath);

      // fast path: file doesn't exist
      if (!existsSync(filePath)) {
        const writer = new AppendWriter(filePath, [...KLINE_COLUMNS]);
        writer.open();
        writer.append(this.toRows(arr));
        writer.close();
        saveMeta(metaPath, {
          minTs: incomingMin,
          maxTs: incomingMax,
          totalRows: arr.length,
          chunkCount: 1,
          updatedAt: Date.now(),
        });
        this.cache.delete(filePath);
        continue;
      }

      // fast path: strictly append
      if (meta && incomingMin > meta.maxTs) {
        const writer = new AppendWriter(filePath, [...KLINE_COLUMNS]);
        writer.open();
        writer.append(this.toRows(arr));
        writer.close();
        saveMeta(metaPath, {
          minTs: meta.minTs,
          maxTs: Math.max(meta.maxTs, incomingMax),
          totalRows: meta.totalRows + arr.length,
          chunkCount: meta.chunkCount + 1,
          updatedAt: Date.now(),
        });
        this.cache.delete(filePath);
        continue;
      }

      // overlap path: rewrite with upsert-by-timestamp
      const merged = upsertMergeByTimestamp(filePath, arr);

      const tmpPath = `${filePath}.rewrite.tmp`;
      try {
        rmSync(tmpPath, { force: true });
      } catch {}

      const writer = new AppendWriter(tmpPath, [...KLINE_COLUMNS]);
      writer.open();

      // write in chunks to avoid huge buffers
      const CHUNK = 5000;
      for (let i = 0; i < merged.length; i += CHUNK) {
        writer.append(this.toRows(merged.slice(i, i + CHUNK)));
      }
      writer.close();

      // swap
      rmSync(filePath, { force: true });
      renameSync(tmpPath, filePath);

      saveMeta(metaPath, {
        minTs: merged.length ? merged[0].timestamp : 0,
        maxTs: merged.length ? merged[merged.length - 1].timestamp : 0,
        totalRows: merged.length,
        chunkCount: 1,
        updatedAt: Date.now(),
      });

      this.cache.delete(filePath);
    }

    // persist dictionaries
    try {
      this.symbols.save();
    } catch {}
    if (this.symbolMetaPath) {
      try {
        writeFileSync(this.symbolMetaPath, JSON.stringify(this.symbolMeta, null, 2));
      } catch {}
    }

    return klines.length;
  }

  async queryKlines(options: QueryOptions): Promise<Kline[]> {
    if (!this.symbols) throw new Error('Database not connected');

    // 目前强烈建议指定 symbol+interval；否则会退化成目录扫描
    if (!options.symbol || !options.interval) {
      return this.queryKlinesScan(options);
    }

    const interval = canonicalInterval(options.interval);

    const symbolId = this.symbols.getId(options.symbol);
    if (symbolId === undefined) return [];

    const filePath = this.getKlineFilePath(symbolId, interval);
    if (!existsSync(filePath)) return [];

    // cache
    const cached = this.cache.get(filePath);
    if (cached && Date.now() - cached.loadedAt < 2000) {
      return this.filterByTime(cached.rows, options);
    }

    const rows = this.readFileAsKlines(filePath, options.symbol, options.interval);
    this.cache.set(filePath, { loadedAt: Date.now(), rows });
    return this.filterByTime(rows, options);
  }

  async getKline(symbol: string, interval: string, timestamp: number): Promise<Kline | null> {
    const results = await this.queryKlines({
      symbol,
      interval,
      startTime: new Date(timestamp * 1000),
      endTime: new Date(timestamp * 1000),
      limit: 1,
    });
    return results[0] || null;
  }

  async getLatestKline(symbol: string, interval: string): Promise<Kline | null> {
    const rows = await this.queryKlines({ symbol, interval: canonicalInterval(interval) });
    if (rows.length === 0) return null;
    return rows.reduce((latest, k) => (k.timestamp > latest.timestamp ? k : latest));
  }

  async sampleBy(options: AggregateOptions): Promise<Array<Record<string, number | Date>>> {
    // v0.9: 先用 queryKlines + ColumnarTable 聚合（后续可优化为直接读 TypedArray）
    const filtered = await this.queryKlines({ symbol: options.symbol, interval: canonicalInterval(options.interval) });
    if (filtered.length === 0) return [];

    const tempTable = new ColumnarTable([
      { name: 'timestamp', type: 'int64' },
      { name: 'open', type: 'float64' },
      { name: 'high', type: 'float64' },
      { name: 'low', type: 'float64' },
      { name: 'close', type: 'float64' },
      { name: 'volume', type: 'float64' },
    ]);

    tempTable.appendBatch(
      filtered.map((k) => ({
        timestamp: BigInt(k.timestamp),
        open: k.open,
        high: k.high,
        low: k.low,
        close: k.close,
        volume: k.volume,
      }))
    );

    const rows = tempTable.sampleBy(
      'timestamp',
      parseIntervalSeconds(options.bucketSize),
      options.aggregations.map((a) => ({ column: a.column, op: a.op }))
    );

    // 兼容其他 provider：补 bucket(Date) + timestamp(Date)
    return rows.map((r: any) => {
      const tsSec = typeof r.timestamp === 'bigint' ? Number(r.timestamp) : Number(r.timestamp);
      const d = new Date(tsSec * 1000);
      return { ...r, bucket: d, timestamp: d };
    });
  }

  async getStats(): Promise<DatabaseStats> {
    const dataDir = this.config.dataDir!;
    const klinesDir = join(dataDir, 'klines');

    const intervals = existsSync(klinesDir)
      ? readdirSync(klinesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
      : [];

    // symbols from SymbolTable
    const symbols = this.symbols.getAllSymbols();

    // total rows: sum file headers (best effort)
    let totalRows = 0;
    for (const interval of intervals) {
      const dir = join(klinesDir, interval);
      if (!existsSync(dir)) continue;
      const files = readdirSync(dir).filter((f) => f.endsWith('.ndts'));
      for (const f of files) {
        const fp = join(dir, f);
        try {
          const header = readAppendHeader(fp);
          totalRows += header.totalRows || 0;
        } catch {}
      }
    }

    return { totalRows, symbols, intervals };
  }

  async getSymbolStats(symbol: string, interval: string): Promise<{ count: number; earliest: Date; latest: Date; avgPrice: number; minPrice: number; maxPrice: number; }> {
    const data = await this.queryKlines({ symbol, interval: canonicalInterval(interval) });
    if (data.length === 0) {
      return { count: 0, earliest: new Date(0), latest: new Date(0), avgPrice: 0, minPrice: 0, maxPrice: 0 };
    }

    const closes = data.map((k) => k.close);
    const timestamps = data.map((k) => k.timestamp);

    return {
      count: data.length,
      earliest: new Date(Math.min(...timestamps) * 1000),
      latest: new Date(Math.max(...timestamps) * 1000),
      avgPrice: closes.reduce((a, b) => a + b, 0) / closes.length,
      minPrice: Math.min(...data.map((k) => k.low)),
      maxPrice: Math.max(...data.map((k) => k.high)),
    };
  }

  async vacuum(): Promise<void> {
    // ndtsdb 不需要 vacuum
  }

  async backup(path: string): Promise<void> {
    // v0.9: 备份 dataDir 由上层自行打包/rsync
    ensureDir(dirname(path));
    writeFileSync(path, JSON.stringify({ ok: true, note: 'backup is directory-based for ndtsdb provider' }));
  }

  // ---------- internal ----------

  private getKlineFilePath(symbolId: number, interval: string): string {
    const dataDir = this.config.dataDir!;
    return join(dataDir, 'klines', interval, `${symbolId}.ndts`);
  }

  private readFileAsKlines(filePath: string, symbol: string, interval: string): Kline[] {
    const { data } = AppendWriter.readAll(filePath);

    const ts = data.get('timestamp') as BigInt64Array;
    const open = data.get('open') as Float64Array;
    const high = data.get('high') as Float64Array;
    const low = data.get('low') as Float64Array;
    const close = data.get('close') as Float64Array;
    const volume = data.get('volume') as Float64Array;

    const quoteVolume = data.get('quoteVolume') as Float64Array | undefined;
    const trades = data.get('trades') as Int32Array | undefined;
    const takerBuyVolume = data.get('takerBuyVolume') as Float64Array | undefined;
    const takerBuyQuoteVolume = data.get('takerBuyQuoteVolume') as Float64Array | undefined;

    const meta = this.symbolMeta[symbol];

    const out: Kline[] = [];
    for (let i = 0; i < ts.length; i++) {
      out.push({
        symbol,
        exchange: meta?.exchange || 'UNKNOWN',
        baseCurrency: meta?.baseCurrency || 'UNKNOWN',
        quoteCurrency: meta?.quoteCurrency || 'UNKNOWN',
        interval,
        timestamp: Number(ts[i]),
        open: open[i],
        high: high[i],
        low: low[i],
        close: close[i],
        volume: volume[i],
        quoteVolume: quoteVolume ? quoteVolume[i] : undefined,
        trades: trades ? trades[i] : undefined,
        takerBuyVolume: takerBuyVolume ? takerBuyVolume[i] : undefined,
        takerBuyQuoteVolume: takerBuyQuoteVolume ? takerBuyQuoteVolume[i] : undefined,
      });
    }

    // already append order; keep sorted just in case
    out.sort((a, b) => a.timestamp - b.timestamp);
    return out;
  }

  private filterByTime(rows: Kline[], options: QueryOptions): Kline[] {
    let out = rows;

    if (options.startTime) {
      const start = Math.floor(options.startTime.getTime() / 1000);
      out = out.filter((k) => k.timestamp >= start);
    }
    if (options.endTime) {
      const end = Math.floor(options.endTime.getTime() / 1000);
      out = out.filter((k) => k.timestamp <= end);
    }
    if (options.limit) {
      out = out.slice(0, options.limit);
    }

    return out;
  }

  private async queryKlinesScan(options: QueryOptions): Promise<Kline[]> {
    // fallback: scan files (slow path)
    const dataDir = this.config.dataDir!;
    const klinesDir = join(dataDir, 'klines');
    if (!existsSync(klinesDir)) return [];

    const intervals = options.interval ? [options.interval] : readdirSync(klinesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

    const out: Kline[] = [];

    for (const interval of intervals) {
      const dir = join(klinesDir, interval);
      if (!existsSync(dir)) continue;

      if (options.symbol) {
        const symbolId = this.symbols.getId(options.symbol);
        if (symbolId === undefined) continue;
        const fp = this.getKlineFilePath(symbolId, interval);
        if (!existsSync(fp)) continue;
        out.push(...this.filterByTime(this.readFileAsKlines(fp, options.symbol, interval), options));
      } else {
        const files = readdirSync(dir).filter((f) => f.endsWith('.ndts'));
        for (const f of files) {
          // best effort: resolve symbol name via SymbolTable id -> name
          const idStr = f.replace(/\.ndts$/, '');
          const id = Number(idStr);
          const sym = this.symbols.getName(id) || idStr;
          out.push(...this.filterByTime(this.readFileAsKlines(join(dir, f), sym, interval), options));
        }
      }
    }

    out.sort((a, b) => a.timestamp - b.timestamp);
    if (options.limit) return out.slice(0, options.limit);
    return out;
  }
}

function ensureDir(p: string) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

function canonicalInterval(interval: string): string {
  const s = String(interval).trim();

  // already canonical like 15m / 1h / 1d / 1w / 1M
  if (/^\d+(s|m|h|d|w|M)$/.test(s)) return s;

  // TradingView style: pure number means minutes
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    if (n === 60) return '1h';
    if (n === 120) return '2h';
    if (n === 240) return '4h';
    if (n === 360) return '6h';
    if (n === 480) return '8h';
    if (n === 720) return '12h';
    if (n === 1440) return '1d';
    return `${n}m`;
  }

  // fallback: keep raw
  return s;
}

function parseIntervalSeconds(bucketSize: string): number {
  const match = bucketSize.match(/^(\d+)([smhd])$/);
  if (!match) return 60;
  const [, num, unit] = match;
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return parseInt(num) * multipliers[unit];
}

type FileMeta = { minTs: number; maxTs: number; totalRows: number; chunkCount: number; updatedAt: number };

function loadMeta(metaPath: string, filePath: string): FileMeta | null {
  try {
    if (existsSync(metaPath)) {
      return JSON.parse(readFileSync(metaPath, 'utf-8')) as FileMeta;
    }
  } catch {}

  if (!existsSync(filePath)) return null;

  // fallback: derive totalRows/chunkCount from DLv2 header
  try {
    const hdr = readAppendHeader(filePath);
    return {
      minTs: 0,
      maxTs: 0,
      totalRows: hdr.totalRows,
      chunkCount: hdr.chunkCount,
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

function saveMeta(metaPath: string, meta: FileMeta) {
  try {
    writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  } catch {}
}

function upsertMergeByTimestamp(filePath: string, incoming: Kline[]): Kline[] {
  const { data } = AppendWriter.readAll(filePath);
  const ts = data.get('timestamp') as BigInt64Array;

  const open = data.get('open') as Float64Array;
  const high = data.get('high') as Float64Array;
  const low = data.get('low') as Float64Array;
  const close = data.get('close') as Float64Array;
  const volume = data.get('volume') as Float64Array;
  const quoteVolume = data.get('quoteVolume') as Float64Array | undefined;
  const trades = data.get('trades') as Int32Array | undefined;
  const takerBuyVolume = data.get('takerBuyVolume') as Float64Array | undefined;
  const takerBuyQuoteVolume = data.get('takerBuyQuoteVolume') as Float64Array | undefined;

  const proto = incoming[0];
  const base: Map<number, Kline> = new Map();
  for (let i = 0; i < ts.length; i++) {
    const t = Number(ts[i]);
    base.set(t, {
      symbol: proto?.symbol || 'UNKNOWN',
      exchange: proto?.exchange || 'UNKNOWN',
      baseCurrency: proto?.baseCurrency || 'UNKNOWN',
      quoteCurrency: proto?.quoteCurrency || 'UNKNOWN',
      interval: proto?.interval || 'UNKNOWN',
      timestamp: t,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
      volume: volume[i],
      quoteVolume: quoteVolume ? quoteVolume[i] : undefined,
      trades: trades ? trades[i] : undefined,
      takerBuyVolume: takerBuyVolume ? takerBuyVolume[i] : undefined,
      takerBuyQuoteVolume: takerBuyQuoteVolume ? takerBuyQuoteVolume[i] : undefined,
    });
  }

  for (const k of incoming) {
    base.set(k.timestamp, k);
  }

  const mergedTs = Array.from(base.keys()).sort((a, b) => a - b);
  const out: Kline[] = [];
  for (const t of mergedTs) out.push(base.get(t)!);
  return out;
}

function readAppendHeader(path: string): { totalRows: number; chunkCount: number } {
  // minimal header read for DLv2
  // Bun.file doesn't give sync reads; use node fs
  const { openSync, readSync, closeSync } = require('fs');
  const MAGIC = Buffer.from('NDTS');

  const f = openSync(path, 'r');
  try {
    const magicBuf = Buffer.allocUnsafe(4);
    readSync(f, magicBuf, 0, 4, 0);
    if (!magicBuf.equals(MAGIC)) throw new Error('Invalid magic');

    const lenBuf = Buffer.allocUnsafe(4);
    readSync(f, lenBuf, 0, 4, 4);
    const headerLen = lenBuf.readUInt32LE();

    const headerBuf = Buffer.allocUnsafe(headerLen);
    readSync(f, headerBuf, 0, headerLen, 8);
    const header = JSON.parse(headerBuf.toString());

    return { totalRows: header.totalRows || 0, chunkCount: header.chunkCount || 0 };
  } finally {
    closeSync(f);
  }
}
