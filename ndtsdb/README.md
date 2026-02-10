# ndtsdb

**N-Dimensional Time Series Database** — 高性能多维时序数据库，为量化交易而生。

<!-- VERSION_START -->
**Version: 0.9.2.6**
<!-- VERSION_END -->

- Scope / Non-Goals: `docs/SCOPE.md`
- Features: `docs/FEATURES.md`
- Roadmap: `docs/ROADMAP.md`

```
Bun · TypeScript · C FFI · mmap · zero-copy · Gorilla compression
```

## 性能

| 操作 | 速度 |
|------|------|
| 写入 | 6.9M rows/s |
| 增量追加 (AppendWriter) | 3.3M rows/s |
| 扫描/过滤 (C FFI) | 143M rows/s |
| 求和 (C FFI) | 1,162M rows/s |
| OHLCV K 线 | 11.7M rows/s |
| SMA/EMA (C FFI) | 200-270M rows/s |
| 二分查找 (C FFI) | 2,356M ops/s |
| 压缩 (Gorilla) | 70-95% |
| 3000 文件加载 | 60ms |
| 3000 产品 tick 回放 | **8.9M ticks/s** |
| 3000 产品 snapshot 回放 | **487K snapshots/s** |

## 安装

```bash
bun add ndtsdb
```

## 快速开始

```typescript
import { ColumnarTable, MmapMergeStream, sma, ema, binarySearchI64 } from 'ndtsdb';

// 创建表
const table = new ColumnarTable([
  { name: 'timestamp', type: 'bigint' },
  { name: 'price', type: 'float64' },
  { name: 'volume', type: 'float64' },
]);

// 添加数据
table.addRow({ timestamp: Date.now(), price: 100.5, volume: 1000 });

// 保存
table.saveToFile('./data/BTCUSDT.ndts');

// 多路归并回放
const stream = new MmapMergeStream(files.map(f => ({ file: f, symbol: 'BTCUSDT' })));
for (const tick of stream.replayTicks()) {
  console.log(tick);
}

// 技术指标 (FFI 加速)
const prices = new Float64Array([...]);
const sma20 = sma(prices, 20);  // 268M/s
const ema20 = ema(prices, 20);  // 204M/s
```

## 核心模块

| 模块 | 功能 |
|------|------|
| `ColumnarTable` | 列式存储 + 8 字节对齐 |
| `AppendWriter` | 增量追加 + CRC32 校验 |
| `MmapMergeStream` | mmap + MinHeap 多路归并 |
| `sampleBy` / `ohlcv` | 时间桶聚合 |
| `sma` / `ema` / `rollingStd` | 技术指标 (FFI 加速) |
| `gorillaCompress` | Gorilla XOR 压缩 |
| `binarySearchI64` | 二分查找 (FFI 加速) |

## libndts (Native Core)

C FFI 加速层，8 平台预编译：

| 平台 | 文件 |
|------|------|
| Linux x64 | `libndts-lnx-x86-64.so` |
| Linux ARM64 | `libndts-lnx-arm-64.so` |
| Linux musl | `libndts-lnx-x86-64-musl.so` |
| macOS x64 | `libndts-osx-x86-64.dylib` |
| macOS ARM64 | `libndts-osx-arm-64.dylib` |
| Windows x64 | `libndts-win-x86-64.dll` |
| Windows x86 | `libndts-win-x86-32.dll` |
| Windows ARM64 | `libndts-win-arm-64.dll` |

### FFI 函数

| 函数 | 用途 | 加速比 |
|------|------|--------|
| `int64_to_f64` | BigInt → Float64 | 5x |
| `counting_sort_apply` | 时间戳排序 | 10x |
| `gather_batch4` | 数据重排列 | 3x |
| `binary_search_i64` | 二分查找 | 4.3x |
| `gorilla_compress` | 浮点压缩 | 3.9M/s |
| `gorilla_decompress` | 浮点解压 | 11.5M/s |
| `sma_f64` | 简单移动平均 | 1.4x |
| `ema_f64` | 指数移动平均 | 1.6x |
| `rolling_std_f64` | 滚动标准差 | 1.6x |
| `prefix_sum_f64` | 累积和 | 2.0x |

## 目录结构

```
ndtsdb/
├── src/
│   ├── index.ts           # 统一导出
│   ├── columnar.ts        # 列式存储
│   ├── append.ts          # 增量写入
│   ├── query.ts           # 查询引擎
│   ├── ndts-ffi.ts        # C FFI 绑定
│   ├── mmap/
│   │   ├── merge.ts       # 多路归并
│   │   └── pool.ts        # 连接池
│   └── sql/
│       ├── parser.ts      # SQL 解析
│       └── executor.ts    # SQL 执行
├── native/
│   ├── ndts.c             # C 源码
│   └── dist/              # 预编译库
├── scripts/
│   ├── build-ndts.sh      # 本地编译
│   └── build-ndts-podman.sh # 容器编译
├── tests/
│   ├── benchmark-3000.ts  # 主基准测试
│   └── ...
└── docs/
    ├── ARCHITECTURE.md
    ├── FFI.md
    └── ROADMAP.md
```

## 测试

```bash
bun run tests/benchmark-3000.ts --full  # 3000 产品基准
bun run tests/mmap-basic.ts              # mmap 基础
bun run tests/merge-stream.ts            # MinHeap 归并
bun run tests/append-test.ts             # 增量写入
bun run tests/query-test.ts              # 查询引擎
bun run tests/sql-test.ts                # SQL 引擎
bun run tests/ffi-benchmark.ts           # FFI 性能
```

## 文档

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — 技术栈 · 数据流 · 模块架构
- [FFI.md](docs/FFI.md) — C 库编译指南
- [ROADMAP.md](docs/ROADMAP.md) — 已完成 & 下一步

## UPSERT

```sql
-- PostgreSQL 风格
INSERT INTO klines (symbol, interval, timestamp, open, high, low, close, volume)
VALUES (1, 15, 1700000000000, 100.0, 101.0, 99.0, 100.5, 1000)
ON CONFLICT (symbol, interval, timestamp)
DO UPDATE SET open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, 
              close=EXCLUDED.close, volume=EXCLUDED.volume;

-- 简洁语法
UPSERT INTO klines (symbol, interval, timestamp, open, high, low, close, volume)
VALUES (1, 15, 1700000000000, 100.0, 101.0, 99.0, 100.5, 1000)
KEY (symbol, interval, timestamp);
```

| 操作 | 性能 |
|------|------|
| 批量 INSERT | 508K rows/s |
| 批量 UPDATE | 360K rows/s |

## 版本

- **v0.9.2.6** (2026-02-10)
  - SQL 扩展: CTE (WITH), 多列 IN, 字符串拼接 `||`, ROUND/SQRT
  - ORDER BY 支持表达式 (alias/ordinal)
  - 统一版本号管理 (VERSION 文件)

- **v0.9.2** (2026-02-09)
  - SymbolTable.getId() / has() — 只读查询不创建新 ID
  - quant-lib NdtsdbProvider 迁移支持

- **v0.9.1** (2026-02-09)
  - 新增 UPSERT SQL 支持 (INSERT ON CONFLICT / UPSERT INTO)
  - ColumnarTable.updateRow() 方法
  - 自动 number ↔ bigint 类型转换

- **v0.9.0** (2026-02-09)
  - 8 平台 libndts 跨平台编译
  - 新增 FFI 函数: binary_search, sma, ema, rolling_std, prefix_sum
  - io_uring 评估 (结论：不适合小文件场景)
  - 重命名 data-lib → ndtsdb

---

## 赞助商

如果您觉得 ndtsdb 对您有帮助，欢迎通过以下方式支持项目发展：

**TON 链钱包**: `UQC9Q9NuCkI8Wmuk5l_flSWfNf21XToXmVbJikw3P9MflhzG`

> 💎 支持赞助 <a href="https://www.tradingview.com/symbols/XUSDT/markets/" target="_blank">**$X**</a>（金额随意）  
> 🔗 这是 [TON 链](https://ton.foundation/) 的钱包地址

**扫码支付** (Telegram Wallet):

<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=UQC9Q9NuCkI8Wmuk5l_flSWfNf21XToXmVbJikw3P9MflhzG" alt="TON Wallet Address QR" width="200" />

> 📱 扫码后点击「**切换币种**」→ 选择 **$X** (X Empire) 或 **TON**
>
> 💡 如需使用 **$X** 支付：复制上方地址 → 粘贴到 Bybit 或其他支持代币选择的钱包

---

MIT
