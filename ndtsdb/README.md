# ndtsdb

**High-performance embedded time series database for TypeScript** — 8.9M ticks/sec, 487K snapshots/sec, 3000 products loaded in 60ms.

<!-- VERSION_START -->
**Version: 0.9.5.0**
<!-- VERSION_END -->

```
TypeScript · Bun · Embedded · Columnar Storage · Gorilla Compression · Zero-Copy · mmap
```

---

## Why ndtsdb?

| Feature | ndtsdb | InfluxDB | TimescaleDB | QuestDB |
|---------|--------|----------|-------------|---------|
| **Embedded** | ✅ Zero setup | ❌ Server required | ❌ PostgreSQL required | ❌ Server/JVM required |
| **TypeScript Native** | ✅ First-class | ⚠️ Client library only | ⚠️ Client library only | ⚠️ Client library only |
| **Cold Start** | 60ms (3000 files) | ~10s | ~5s | ~3s |
| **Memory Footprint** | <50MB baseline | 500MB+ | 1GB+ (PostgreSQL) | 500MB+ (JVM) |
| **Deployment** | `bun add ndtsdb` | Docker/binary | PostgreSQL setup | Docker/binary |
| **Use Case** | SDK/library embedding | Production server | Enterprise OLTP+TSDB | High-throughput server |

**When to choose ndtsdb:**
- ✅ Embedding TSDB in your app/library (no external server)
- ✅ TypeScript/Bun environment (native performance + JS fallback)
- ✅ Financial tick data, IoT sensors, real-time streaming
- ✅ Fast prototyping and lightweight deployments

---

## Quick Start

```typescript
import { ColumnarTable, AppendWriter } from 'ndtsdb';

// Create table
const table = new ColumnarTable([
  { name: 'timestamp', type: 'int64' },
  { name: 'price', type: 'float64' },
  { name: 'volume', type: 'float64' },
]);

// Add data
table.addRow({ timestamp: Date.now(), price: 100.5, volume: 1000 });

// Query
const results = table.query(row => row.price > 100);

// Persist
table.saveToFile('./data/BTCUSDT.ndts');
```

**Installation:**
```bash
bun add ndtsdb
```

---

## Features

### 🚀 Storage Engine
- **Columnar Storage**: 8-byte aligned TypedArray for SIMD optimization
- **AppendWriter**: Chunked append-only format with CRC32 integrity checks
- **Compression**: Gorilla (70-95%), Delta/Delta-of-Delta, RLE
- **Partitioning**: Automatic time/hash-based partitioning for large datasets
- **mmap**: Zero-copy reads for multi-gigabyte datasets

### 📊 Query & Analytics
- **SQL Subset**: SELECT/FROM/WHERE/JOIN/GROUP BY/HAVING/ORDER BY/LIMIT
- **Window Functions**: STDDEV/VARIANCE/ROW_NUMBER OVER (PARTITION BY ...)
- **Time-Series Extensions**: `sampleBy()`, `ohlcv()`, `latestOn()`
- **Indexing**: BTree + composite indexes for range queries
- **Streaming Aggregation**: Incremental SMA/EMA/StdDev without full recomputation

### ⚡ Performance
- **Native Acceleration**: C FFI (libndts) with 8-platform pre-compiled binaries
- **Automatic Fallback**: Pure JavaScript implementation (no native dependency required)
- **Technical Indicators**: SMA (268M/s), EMA (204M/s), Binary Search (2.3B ops/s)
- **Multi-Way Merge**: MinHeap-based tick replay for backtesting

### 🔧 Developer Experience
- **TypeScript First**: Full type safety and IntelliSense
- **Bun Optimized**: Leverages Bun's FFI and native performance
- **8-Platform Support**: Linux (x64/ARM64/musl), macOS (x64/ARM64), Windows (x64/x86/ARM64)
- **Zero Config**: Works out of the box with automatic platform detection

---

## Benchmarks

### Write Performance
| Operation | Speed |
|-----------|-------|
| Bulk Insert (ColumnarTable) | 6.9M rows/sec |
| Incremental Append (AppendWriter) | 3.3M rows/sec |
| Batch UPSERT (SQL) | 508K rows/sec |

### Read Performance
| Operation | Speed |
|-----------|-------|
| Scan + Filter (C FFI) | 143M rows/sec |
| Sum Aggregation (C FFI) | 1.16B rows/sec |
| Binary Search (C FFI) | 2.36B ops/sec |

### Real-World Workloads
| Scenario | Performance |
|----------|-------------|
| Load 3000 NDTS files | 60ms |
| Replay 3000 products (ticks) | **8.9M ticks/sec** |
| Replay 3000 products (snapshots) | **487K snapshots/sec** |
| OHLCV K-line generation | 11.7M rows/sec |

### Technical Indicators (FFI-accelerated)
| Indicator | Speed |
|-----------|-------|
| SMA (Simple Moving Average) | 268M rows/sec |
| EMA (Exponential Moving Average) | 204M rows/sec |
| Rolling StdDev | 270M rows/sec |

### Compression
| Algorithm | Compression Ratio |
|-----------|-------------------|
| Gorilla (float64) | 70-90% |
| Delta (timestamp) | 90-95% |
| RLE (symbol ID) | 95%+ |

---

## Architecture

### Core Modules
| Module | Purpose |
|--------|---------|
| `ColumnarTable` | In-memory columnar storage |
| `AppendWriter` | Append-only disk format with compression |
| `PartitionedTable` | Automatic time/hash partitioning |
| `MmapMergeStream` | Multi-way merge for tick replay |
| `SQLParser` / `SQLExecutor` | SQL query engine |
| `StreamingAggregator` | Incremental window computations |

### Native Acceleration (libndts)
Pre-compiled binaries for 8 platforms:

| Platform | Binary |
|----------|--------|
| Linux x64 | `libndts-lnx-x86-64.so` |
| Linux ARM64 | `libndts-lnx-arm-64.so` |
| Linux musl | `libndts-lnx-x86-64-musl.so` |
| macOS x64 | `libndts-osx-x86-64.dylib` |
| macOS ARM64 | `libndts-osx-arm-64.dylib` |
| Windows x64 | `libndts-win-x86-64.dll` |
| Windows x86 | `libndts-win-x86-32.dll` |
| Windows ARM64 | `libndts-win-arm-64.dll` |

**FFI Functions:**
- `int64_to_f64`, `counting_sort_apply`, `gather_batch4`
- `binary_search_i64` (4.3x faster than JS)
- `gorilla_compress` / `gorilla_decompress` (3.9M/s compress, 11.5M/s decompress)
- `sma_f64`, `ema_f64`, `rolling_std_f64`, `prefix_sum_f64`

---

## Advanced Examples

### Multi-Way Merge Stream (Tick Replay)
```typescript
import { MmapMergeStream } from 'ndtsdb';

const files = ['BTC.ndts', 'ETH.ndts', 'SOL.ndts'];
const stream = new MmapMergeStream(
  files.map(f => ({ file: f, symbol: f.replace('.ndts', '') }))
);

for (const tick of stream.replayTicks()) {
  console.log(`${tick.symbol}: ${tick.price} @ ${tick.timestamp}`);
}
// Output: chronologically ordered ticks across all symbols
```

### Partitioned Table (Auto Time Partitioning)
```typescript
import { PartitionedTable } from 'ndtsdb';

const table = new PartitionedTable(
  '/data/klines',
  [
    { name: 'timestamp', type: 'int64' },
    { name: 'symbol', type: 'string' },
    { name: 'open', type: 'float64' },
    { name: 'high', type: 'float64' },
    { name: 'low', type: 'float64' },
    { name: 'close', type: 'float64' },
  ],
  { type: 'time', column: 'timestamp', interval: 'day' }
);

// Automatic partitioning by day
table.append([
  { timestamp: 1704153600000n, symbol: 'BTC', open: 42000, high: 43000, low: 41000, close: 42500 },
]);

// Cross-partition query optimization
const btcData = table.query(
  row => row.symbol === 'BTC' && row.timestamp >= 1704067200000n,
  { min: 1704067200000n, max: 1704326400000n } // Partition pruning
);
```

### SQL Query Engine
```typescript
import { SQLParser, SQLExecutor, ColumnarTable } from 'ndtsdb';

const table = new ColumnarTable([
  { name: 'symbol', type: 'string' },
  { name: 'timestamp', type: 'int64' },
  { name: 'close', type: 'float64' },
]);

table.addRow({ symbol: 'BTC', timestamp: 1704153600000n, close: 42000 });
table.addRow({ symbol: 'ETH', timestamp: 1704153600000n, close: 2200 });

const executor = new SQLExecutor();
executor.registerTable('klines', table);

const result = executor.execute(
  executor.parser.parse(`
    SELECT symbol, AVG(close) as avg_price
    FROM klines
    WHERE timestamp >= 1704067200000
    GROUP BY symbol
    ORDER BY avg_price DESC
  `)
);

console.log(result.rows);
```

### Streaming Aggregation
```typescript
import { StreamingAggregator, StreamingSMA, StreamingEMA } from 'ndtsdb';

const agg = new StreamingAggregator();
agg.addAggregator('sma20', new StreamingSMA(20));
agg.addAggregator('ema12', new StreamingEMA(12));

// Real-time metric updates (no full recomputation)
const tick1 = agg.add(100.5); // { sma20: null, ema12: 100.5 }
const tick2 = agg.add(101.2); // { sma20: null, ema12: 100.85 }
// ... (after 20 ticks, sma20 becomes available)
```

---

## Use Cases

### Financial Tick Data
- High-frequency trading backtesting (8.9M ticks/sec replay)
- Real-time K-line generation (OHLCV aggregation)
- Technical indicator computation (SMA/EMA/RSI)

### IoT & Sensor Data
- Embedded time series storage (zero server dependency)
- Real-time anomaly detection (streaming aggregation)
- Multi-sensor data fusion (multi-way merge)

### Monitoring & Observability
- Application metrics collection
- Log aggregation and analysis
- Resource utilization tracking

---

## Documentation

- **[FEATURES.md](docs/FEATURES.md)** — Complete feature list with examples
- **[SCOPE.md](docs/SCOPE.md)** — Design philosophy and project boundaries
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Technical architecture and data flow
- **[FFI.md](docs/FFI.md)** — Native library compilation guide
- **[ROADMAP.md](docs/ROADMAP.md)** — Completed features and future plans

---

## Testing

```bash
# Core benchmarks
bun run tests/benchmark-3000.ts --full  # 3000-product benchmark suite
bun run tests/ffi-benchmark.ts          # FFI performance tests

# Functional tests
bun run tests/mmap-basic.ts             # mmap fundamentals
bun run tests/merge-stream.ts           # MinHeap multi-way merge
bun run tests/append-test.ts            # AppendWriter persistence
bun run tests/query-test.ts             # Query engine
bun run tests/sql-test.ts               # SQL parser + executor
```

---

## Version History

- **v0.9.5.0** (2026-02-15)
  - Version unified to 0.9.5.0 (package.json/VERSION/README aligned)
  - All previous 0.9.2.6 features included

- **v0.9.2.6** (2026-02-10)
  - SQL extensions: CTE (WITH), multi-column IN, string concatenation `||`, ROUND/SQRT
  - ORDER BY expression support (alias/ordinal)
  - Unified version management (VERSION file)

- **v0.9.2** (2026-02-09)
  - SymbolTable.getId() / has() — read-only queries without auto-creation
  - quant-lib NdtsdbProvider migration support

- **v0.9.1** (2026-02-09)
  - UPSERT SQL support (INSERT ON CONFLICT / UPSERT INTO)
  - ColumnarTable.updateRow() method
  - Automatic number ↔ bigint type conversion

- **v0.9.0** (2026-02-09)
  - 8-platform libndts cross-compilation
  - New FFI functions: binary_search, sma, ema, rolling_std, prefix_sum
  - io_uring evaluation (conclusion: not suitable for small-file workloads)
  - Renamed data-lib → ndtsdb

---

## Sponsorship

If ndtsdb helps your project, consider supporting development:

**TON Wallet**: `UQC9Q9NuCkI8Wmuk5l_flSWfNf21XToXmVbJikw3P9MflhzG`

> 💎 Donate in **$X** (X Empire) or **TON**  
> 🔗 [TON Foundation](https://ton.foundation/)

<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=UQC9Q9NuCkI8Wmuk5l_flSWfNf21XToXmVbJikw3P9MflhzG" alt="TON Wallet QR Code" width="200" />

---

## Keywords

`time series database` `TSDB` `embedded database` `TypeScript database` `Bun database` `high performance database` `real-time database` `streaming database` `columnar storage` `Gorilla compression` `financial data` `tick data` `kline` `OHLCV` `IoT database` `sensor data` `quantitative trading` `backtesting` `technical indicators` `SMA` `EMA` `time series analysis` `in-memory database` `append-only storage` `mmap` `zero-copy` `FFI` `native performance` `TypeScript native` `Bun native` `embedded TSDB` `lightweight database` `fast time series` `high-throughput` `low-latency` `cross-platform` `SQL time series` `window functions` `partitioned table` `multi-way merge` `data compression` `delta encoding` `RLE compression`

---

**License**: MIT
