# ndtsdb Next Steps - 并发推进计划

**更新时间**: 2026-02-10 18:05

---

## 📋 总体策略

**双线并发推进**：
- **线程 A**：测试增强（补完测试脚本、真实数据验证）
- **线程 B**：quant-lib/quant-lab 适配（实战验证 + 上层封装）

**目标**：
- 通过**真实应用场景**验证 ndtsdb 稳定性
- 发现潜在问题并快速修复
- 逐步构建量化交易封装库

---

## 🧪 线程 A：测试增强

### A1. 压缩功能测试增强（P0）

**当前状态**：
- ✅ 基础压缩测试（int64 delta、int32 rle、向后兼容）
- ⚠️ 缺少边界情况测试

**需补充**：
1. **大规模压缩测试**（10k/100k/1M 行）
   - 验证内存占用
   - 验证读写性能
   - 验证压缩率

2. **边界情况测试**
   - 空数据（0 行）
   - 单行数据
   - 全部相同值（RLE 最优场景）
   - 完全随机值（压缩率最差场景）
   - 混合场景（部分列压缩、部分不压缩）

3. **文件格式兼容性测试**
   - 旧格式文件 → 新版本读取
   - 新格式文件（压缩） → 旧版本读取（应报错或优雅回退）
   - reopen 追加（旧格式 → 新格式，新格式 → 旧格式）

**测试脚本**：
```bash
bun run ndtsdb/tests/compression-stress.ts
```

---

### A2. 真实数据验证（P0）⭐⭐⭐⭐⭐

**目标**：用真实 Binance/TV K 线验证 ndtsdb

**数据源**：
- Binance 历史 K 线（CSV/JSON）
- TradingView 数据（通过现有 Provider）

**验证指标**：
1. **压缩效果**
   - 实际压缩率（vs 合成数据）
   - 不同压缩算法对比（delta vs rle vs none）
   - 按数据特征分组测试（高波动 vs 低波动）

2. **查询性能**
   - 全表扫描（SELECT * FROM klines）
   - 范围查询（WHERE timestamp BETWEEN ... AND ...）
   - 聚合查询（GROUP BY symbol）
   - 窗口函数（SMA/EMA/STDDEV）

3. **内存占用**
   - mmap 模式（3000 symbols）
   - 内存表模式
   - 分区表模式

4. **回放性能**
   - 3000 symbols × 1 year daily klines
   - MinHeap 归并回放速度
   - ASOF JOIN 性能

**测试脚本**：
```bash
# 下载真实数据
bun run ndtsdb/scripts/download-binance-klines.ts

# 验证压缩
bun run ndtsdb/tests/real-data-compression.ts

# 验证查询
bun run ndtsdb/tests/real-data-query.ts

# 验证回放
bun run ndtsdb/tests/real-data-replay.ts
```

---

### A3. 性能基准测试套件（P1）

**目标**：建立性能回归测试基准

**测试场景**：
1. **写入性能**
   - ColumnarTable 批量写入
   - AppendWriter 追加写入
   - 启用/不启用压缩对比

2. **读取性能**
   - 全表扫描
   - 索引查询
   - 分区查询

3. **SQL 执行性能**
   - 简单 SELECT
   - JOIN
   - 窗口函数
   - 复杂子查询

4. **压缩/解压性能**
   - 不同算法对比
   - 不同数据模式对比

**测试脚本**：
```bash
bun run ndtsdb/tests/benchmark-suite.ts
```

**输出格式**：
```
=== ndtsdb Performance Benchmark ===
版本: 0.9.3.8
时间: 2026-02-10 18:00

[写入性能]
- ColumnarTable.appendBatch: 6.9M rows/s
- AppendWriter.append (无压缩): 3.3M rows/s
- AppendWriter.append (delta): 2.8M rows/s (-15%)
- AppendWriter.append (rle): 2.5M rows/s (-24%)

[读取性能]
- AppendWriter.readAll (无压缩): 8.5M rows/s
- AppendWriter.readAll (delta): 7.2M rows/s (-15%)
- AppendWriter.readAll (rle): 6.8M rows/s (-20%)

[压缩率]
- Delta (int64 timestamp): 75%
- RLE (int32 symbol_id): 92%
- 混合场景: 83%
```

---

### A4. 边界情况 & 错误处理测试（P2）

**场景**：
1. **文件损坏**
   - CRC 校验失败
   - Header 不完整
   - Chunk 截断

2. **并发场景**（目前不支持，但需测试）
   - 多进程读取同一文件
   - 写入时读取（应报错或阻塞）

3. **磁盘满/权限错误**
   - 写入失败时的回滚
   - tmp 文件清理

**测试脚本**：
```bash
bun run ndtsdb/tests/error-handling.ts
```

---

## 🚀 线程 B：quant-lib/quant-lab 适配

### B1. quant-lib 适配 ndtsdb v0.9.3.8（P0）

**当前状态**：
- ✅ KlineDatabase 已适配 ndtsdb（基础读写）
- ⚠️ 未使用压缩、分区表、流式聚合等新功能

**适配任务**：

#### 1. 启用压缩（P0）✅ 部分完成 + ⏳ Gorilla 集成中

**当前状态（2026-02-10）**：
```typescript
// quant-lib/src/storage/kline-database.ts
const writer = new AppendWriter(path, columns, {
  compression: {
    enabled: true,
    algorithms: {
      timestamp: 'delta',    // ✅ int64，已支持
      trades: 'delta',       // ✅ int32，已支持
      open: 'none',          // ⚠️ float64，暂不压缩
      high: 'none',
      low: 'none',
      close: 'none',
      volume: 'none',
      quoteVolume: 'none',
      takerBuyVolume: 'none',
      takerBuyQuoteVolume: 'none',
    },
  },
});
```

**测试结果**：
- 文件大小：28.30 KB（365 根 K 线）
- 每行字节数：79.39 bytes
- 压缩率：**0.77%**（仅 int64/int32 列压缩）

**发现问题** ⚠️：
- ndtsdb v0.9.3.8 的 Delta 压缩仅支持 int64/int32
- K 线数据主要是 float64（OHLC 价格占比 >70%）
- **Gorilla 压缩算法已实现**（`compression.ts`），但**未集成到 AppendWriter 文件格式**

---

#### 1.1 Gorilla 压缩集成到 AppendWriter（新增）⭐⭐⭐⭐

**目标**：让 float64 列可以使用 Gorilla 压缩，提升压缩率到 70-85%

**当前状态**：
- ✅ Gorilla 算法已实现（`ndtsdb/src/compression.ts`）
  - `GorillaEncoder.compress(Float64Array) -> Buffer`
  - `GorillaDecoder.decompress(Buffer, length) -> Float64Array`
- ❌ 未集成到 `append.ts` 的 `compressColumn` / `decompressColumn`

**修改点**：

1. **`append.ts` - `compressColumn` 支持 Gorilla**
```typescript
// ndtsdb/src/append.ts

private compressColumn(buf: Buffer, type: string, algorithm: 'delta' | 'rle' | 'gorilla' | 'none', rowCount: number): Buffer | null {
  try {
    switch (algorithm) {
      case 'delta':
        // 已实现 int64/int32
        ...
      case 'rle':
        // 已实现 int32
        ...
      case 'gorilla': // 新增
        if (type === 'float64') {
          const arr = new Float64Array(buf.buffer, buf.byteOffset, rowCount);
          return GorillaEncoder.compress(arr);
        }
        return null;
      default:
        return null;
    }
  } catch (e) {
    console.error(`Compression failed for ${type}/${algorithm}:`, e);
    return null;
  }
}
```

2. **`append.ts` - `decompressColumn` 支持 Gorilla**
```typescript
static decompressColumn(buf: Buffer, type: string, algorithm: string, rowCount: number): Buffer | null {
  try {
    switch (algorithm) {
      case 'delta':
        // 已实现
        ...
      case 'rle':
        // 已实现
        ...
      case 'gorilla': // 新增
        if (type === 'float64') {
          const arr = GorillaDecoder.decompress(buf, rowCount);
          return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
        }
        return null;
      default:
        return null;
    }
  } catch (e) {
    console.error(`Decompression failed for ${type}/${algorithm}:`, e);
    return null;
  }
}
```

3. **`append.ts` - `autoSelectAlgorithm` 支持 float64**
```typescript
private autoSelectAlgorithm(type: string): 'delta' | 'rle' | 'gorilla' | 'none' {
  switch (type) {
    case 'int64':
      return 'delta';
    case 'int32':
      return 'delta';
    case 'float64':
      return 'gorilla'; // 新增
    default:
      return 'none';
  }
}
```

**测试**：
```typescript
// ndtsdb/tests/gorilla-compression.test.ts

it('should compress float64 column with Gorilla', async () => {
  const writer = new AppendWriter('/tmp/test-gorilla.ndts', [
    { name: 'timestamp', type: 'int64' },
    { name: 'price', type: 'float64' },
  ], {
    compression: {
      enabled: true,
      algorithms: {
        timestamp: 'delta',
        price: 'gorilla',
      },
    },
  });
  
  writer.open();
  writer.append([
    { timestamp: 1000n, price: 100.5 },
    { timestamp: 2000n, price: 101.2 },
    // ... 100 rows
  ]);
  await writer.close();
  
  // 验证压缩率
  const stats = statSync('/tmp/test-gorilla.ndts');
  const compressionRatio = 1 - (stats.size / (100 * (8 + 8))); // timestamp + price
  expect(compressionRatio).toBeGreaterThan(0.70); // 至少 70%
});
```

**预期效果**：
- quant-lib K 线数据压缩率：0.77% → **70-85%**
- 文件大小：28.30 KB → **~5 KB**（压缩 85% 时）

**预计工期**：1-2 天

---

#### 1.2 quant-lib 更新压缩配置（P0）

Gorilla 集成完成后，更新 quant-lib：
```typescript
compression: {
  enabled: true,
  algorithms: {
    timestamp: 'delta',
    open: 'gorilla',         // ✅ 改为 gorilla
    high: 'gorilla',
    low: 'gorilla',
    close: 'gorilla',
    volume: 'gorilla',
    quoteVolume: 'gorilla',
    trades: 'delta',
    takerBuyVolume: 'gorilla',
    takerBuyQuoteVolume: 'gorilla',
  },
}
```

**验证**：
- 压缩率（预期 70-85%）
- 写入性能（预期 -10~-20%）
- 读取性能（预期 -10~-15%）

---

#### 2. 迁移到分区表（P0）⭐⭐⭐⭐

**动机**：
- 当前每个 symbol 一个文件（3000 个文件）
- 分区表可按日期分区，减少文件数

**迁移方案**：
```typescript
// quant-lib/src/storage/kline-database.ts

class KlineDatabase {
  // 新架构：全局分区表（按 symbol + date 分区）
  private partitionedTable: PartitionedTable;

  constructor(dataDir: string) {
    this.partitionedTable = new PartitionedTable(
      `${dataDir}/klines-partitioned`,
      [
        { name: 'symbol_id', type: 'int32' },
        { name: 'timestamp', type: 'int64' },
        { name: 'open', type: 'float64' },
        { name: 'high', type: 'float64' },
        { name: 'low', type: 'float64' },
        { name: 'close', type: 'float64' },
        { name: 'volume', type: 'float64' },
      ],
      { type: 'time', column: 'timestamp', interval: 'day' },
      {
        compression: { enabled: true, algorithms: { /* ... */ } },
      }
    );
  }

  // 写入（自动分区）
  async appendKlines(symbol: string, klines: Kline[]) {
    const symbolId = this.symbolTable.getId(symbol);
    const rows = klines.map(k => ({
      symbol_id: symbolId,
      timestamp: BigInt(k.timestamp),
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
      volume: k.volume,
    }));
    this.partitionedTable.append(rows);
  }

  // 查询（WHERE 时间范围自动优化分区扫描）
  async queryKlines(symbol: string, startTime: number, endTime: number): Promise<Kline[]> {
    const symbolId = this.symbolTable.getId(symbol);
    const results = this.partitionedTable.query(
      row => row.symbol_id === symbolId && row.timestamp >= BigInt(startTime) && row.timestamp <= BigInt(endTime),
      { min: BigInt(startTime), max: BigInt(endTime) } // 优化分区扫描
    );
    return results.map(row => ({
      timestamp: Number(row.timestamp),
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));
  }
}
```

**验证**：
- 文件数量减少（3000 → ~365 天 = 365 个分区文件）
- 查询性能（WHERE 时间范围提前过滤分区）
- 写入性能（自动选择分区，无锁竞争）

---

#### 3. 集成流式聚合（P1）

**场景**：实时指标计算（如实时 SMA/EMA/波动率）

```typescript
// quant-lib/src/indicators/streaming-indicators.ts

class StreamingIndicators {
  private aggregators = new Map<string, StreamingAggregator>();

  addSymbol(symbol: string) {
    const agg = new StreamingAggregator();
    agg.addAggregator('sma20', new StreamingSMA(20));
    agg.addAggregator('ema12', new StreamingEMA(12));
    agg.addAggregator('ema26', new StreamingEMA(26));
    agg.addAggregator('stddev20', new StreamingStdDev(20));
    this.aggregators.set(symbol, agg);
  }

  updatePrice(symbol: string, price: number): IndicatorValues {
    const agg = this.aggregators.get(symbol);
    if (!agg) throw new Error(`Symbol ${symbol} not registered`);
    return agg.add(price);
  }
}

// 用于实时行情监控
const indicators = new StreamingIndicators();
indicators.addSymbol('BTCUSDT');
indicators.addSymbol('ETHUSDT');

// WebSocket 行情回调
onTick(symbol, price) {
  const values = indicators.updatePrice(symbol, price);
  console.log(`${symbol} SMA20=${values.sma20}, EMA12=${values.ema12}`);
}
```

---

### B2. quant-lab 策略运行时（P1）

**目标**：构建策略回测 + 实盘运行时框架

**架构设计**：
```
quant-lab/
├── runtime/
│   ├── backtest-engine.ts      # 回测引擎
│   ├── live-engine.ts          # 实盘引擎
│   ├── strategy-interface.ts   # 策略接口
│   └── event-bus.ts            # 事件总线
├── strategies/
│   ├── ma-cross.ts             # 均线交叉策略
│   ├── mean-reversion.ts       # 均值回归
│   └── volatility-breakout.ts # 波动率突破
└── analysis/
    ├── performance.ts          # 绩效分析
    └── risk-metrics.ts         # 风险指标
```

**策略接口**：
```typescript
// quant-lab/runtime/strategy-interface.ts

interface Strategy {
  name: string;
  version: string;

  // 初始化（加载历史数据、计算初始指标）
  init(ctx: StrategyContext): Promise<void>;

  // 行情更新回调
  onTick(tick: Tick, ctx: StrategyContext): Promise<void>;

  // K线完成回调
  onBar(bar: Bar, ctx: StrategyContext): Promise<void>;

  // 订单状态更新
  onOrder(order: Order, ctx: StrategyContext): Promise<void>;
}

interface StrategyContext {
  // 数据访问
  db: KlineDatabase;
  indicators: StreamingIndicators;

  // 交易操作
  buy(symbol: string, qty: number): Promise<Order>;
  sell(symbol: string, qty: number): Promise<Order>;
  getPosition(symbol: string): Position | null;

  // 日志
  log(msg: string): void;
}
```

**回测引擎示例**：
```typescript
// quant-lab/runtime/backtest-engine.ts

class BacktestEngine {
  async run(strategy: Strategy, config: BacktestConfig): Promise<BacktestResult> {
    const db = new KlineDatabase(config.dataDir);
    const ctx = new BacktestContext(db, config);

    await strategy.init(ctx);

    // 按时间顺序回放 K 线
    for await (const bar of db.replayBars(config.symbols, config.startTime, config.endTime)) {
      await strategy.onBar(bar, ctx);
    }

    return ctx.getResult();
  }
}

// 使用示例
const engine = new BacktestEngine();
const result = await engine.run(new MACrossStrategy(), {
  dataDir: './data',
  symbols: ['BTCUSDT', 'ETHUSDT'],
  startTime: Date.parse('2024-01-01'),
  endTime: Date.parse('2024-12-31'),
});

console.log(`Total Return: ${result.totalReturn}%`);
console.log(`Sharpe Ratio: ${result.sharpeRatio}`);
```

---

### B3. 在实战中发现 ndtsdb 问题（P0）⭐⭐⭐⭐⭐

**策略**：边用边修

**流程**：
1. 在 quant-lib/quant-lab 开发中使用 ndtsdb
2. 发现性能瓶颈/边界问题/API 不便
3. 立即在 ndtsdb 中修复/优化
4. 快速验证并迭代

**典型问题场景**：
- SQL 执行慢（优化 planner）
- 分区查询不如预期（优化分区过滤）
- 压缩率低于预期（调整算法/参数）
- 内存占用过高（优化内存管理）

**记录方式**：
```bash
# 发现问题时立即记录
echo "## Issue: XXX" >> ndtsdb/docs/ISSUES.md
echo "- 场景: ..." >> ndtsdb/docs/ISSUES.md
echo "- 复现: ..." >> ndtsdb/docs/ISSUES.md
echo "- 修复: ..." >> ndtsdb/docs/ISSUES.md
```

---

## 📅 时间规划

### Week 1（2026-02-10 ~ 02-16）

**线程 A**：
- [ ] A1: 压缩功能测试增强（2 天）
- [ ] A2: 真实数据验证脚本（3 天）

**线程 B**：
- [ ] B1.1: quant-lib 启用压缩（1 天）
- [ ] B1.2: 迁移到分区表（2-3 天）

### Week 2（2026-02-17 ~ 02-23）

**线程 A**：
- [ ] A3: 性能基准测试套件（3 天）
- [ ] A4: 边界情况测试（2 天）

**线程 B**：
- [ ] B1.3: 集成流式聚合（2 天）
- [ ] B2: quant-lab 策略运行时（3 天）

---

## 🎯 成功指标

**线程 A - 测试增强**：
- ✅ 所有测试通过（64+ pass）
- ✅ 真实数据验证完成（Binance K 线）
- ✅ 压缩率符合预期（70-85%）
- ✅ 性能基准建立（无回归）

**线程 B - 应用适配**：
- ✅ quant-lib 完全迁移到 ndtsdb v0.9.3.8
- ✅ 压缩/分区/流式聚合全部启用
- ✅ quant-lab 策略运行时可运行简单策略
- ✅ 实战中发现并修复 0-3 个 ndtsdb 问题

---

## 📝 备注

- **并发推进**：两条线可由不同 bot 或同一 bot 交替执行
- **快速迭代**：发现问题立即修复，不囤积 issue
- **文档同步**：每个功能完成后立即更新文档
- **版本管理**：重大修复/优化后递增版本号（0.9.3.x）

---

**下一步行动**：你想先推进哪条线？或者两条线同时开工？
