# quant-lib 多数据库 Provider 架构

quant-lib 现在支持**参数化配置化并行使用多个数据库供应**。

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    DatabaseFactory                          │
│                     (数据库工厂)                             │
├─────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   DuckDB     │  │   ndtsdb    │  │    Memory    │      │
│  │  (关系查询)   │  │ (高性能写入)  │  │  (极速内存)   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                           │
                    ┌──────┴──────┐
                    ▼             ▼
              读操作          写操作
              (Reader)       (Writer)
```

## 责任边界（重要）

- **ndtsdb**：底层时序/列式存储引擎（AppendWriter/ColumnarTable/SQLExecutor 等）
- **quant-lib**：应用封装层（Provider 接口、缓存、`KlineDatabase` 兼容封装等）

因此：`KlineDatabase` / `SmartKlineCache` 这类“业务便利 API”的兼容性修复，应该落在 **quant-lib**，不应该回灌到 ndtsdb 引擎层。

更完整的分层与职责说明见：`quant-lib/docs/STORAGE_LAYERING.md`。

## 支持的数据库

| Provider | 类型 | 适用场景 | 性能 |
|----------|------|---------|------|
| **DuckDBProvider** | 关系型 | 通用查询、SQL 分析 | 9.5K writes/s |
| **NdtsdbProvider** | 列式 | 高频写入、时序分析 | **678K writes/s** |
| **MemoryProvider** | 内存 | 临时计算、缓存 | **13.8M writes/s** |

## 快速开始

### 1. 简单使用（单数据库）

```typescript
import { NdtsdbProvider } from 'quant-lib';

const db = new NdtsdbProvider({
  type: 'ndtsdb',
  dataDir: './data/ndtsdb'
});

await db.connect();
await db.insertKlines(klines);
const results = await db.queryKlines({ symbol: 'BTCUSDT', limit: 100 });
```

### 2. 多数据库管理（推荐）

```typescript
import { DatabaseFactory } from 'quant-lib';

const factory = new DatabaseFactory({
  defaultProvider: 'duckdb',
  providers: {
    duckdb: { 
      type: 'duckdb', 
      path: './data/klines.duckdb' 
    },
    ndtsdb: { 
      type: 'ndtsdb', 
      dataDir: './data/ndtsdb',
      partitionBy: 'hour'
    },
    memory: { 
      type: 'memory' 
    }
  },
  // 智能切换阈值
  switchThreshold: {
    minRowsForNdtsdb: 5000,   // >5K 行使用 ndtsdb
    maxRowsForMemory: 100      // <100 行使用内存
  }
});

await factory.initAll();

// 智能选择最佳数据库
const db1 = factory.getSmart('batch', 50000);  // → ndtsdb
const db2 = factory.getSmart('read', 50);      // → memory
const db3 = factory.getSmart('write', 1000);   // → duckdb
```

### 3. 读写分离

```typescript
const factory = new DatabaseFactory({
  defaultProvider: 'duckdb',
  readProvider: 'memory',      // 读走内存
  writeProvider: 'ndtsdb'     // 写走 ndtsdb
});

const reader = factory.getReader();
const writer = factory.getWriter();
```

### 4. 数据迁移

```typescript
// 将数据从 DuckDB 迁移到 ndtsdb
await factory.migrate('duckdb', 'ndtsdb', {
  symbols: ['BTCUSDT', 'ETHUSDT'],
  intervals: ['1m', '5m']
});
```

## 统一接口

所有 Provider 实现相同的接口：

```typescript
interface DatabaseProvider {
  // 连接管理
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  
  // 数据写入
  insertKlines(klines: Kline[]): Promise<number>;
  upsertKlines(klines: Kline[]): Promise<number>;
  
  // 数据查询
  queryKlines(options: QueryOptions): Promise<Kline[]>;
  getLatestKline(symbol: string, interval: string): Promise<Kline | null>;
  
  // 聚合查询
  sampleBy(options: AggregateOptions): Promise<Array<Record<string, number | Date>>>;
  
  // 统计信息
  getStats(): Promise<DatabaseStats>;
}
```

## 性能对比

```bash
bun run tests/multi-provider.ts
```

输出示例：

```
📊 数据量: 10,000 行
  🤖 智能选择: ndtsdb
  📝 写入: 14.74ms | 678,599 rows/s ✅

📊 数据量: 1,000 行  
  🤖 智能选择: duckdb
  📝 写入: 104.66ms | 9,555 rows/s

🔸 MEMORY:
  📝 写入: 3.61ms | 13,833,838 rows/s ⚡
```

## 智能切换逻辑

```typescript
function getSmart(operation, estimatedRows) {
  if (estimatedRows < 100) {
    return memoryProvider;      // 小数据用内存
  } else if (estimatedRows > 5000 && operation === 'batch') {
    return dataLibProvider;     // 大数据批量写入用 ndtsdb
  } else {
    return duckDBProvider;      // 默认用 DuckDB
  }
}
```

## 项目结构

```
quant-lib/src/storage/
├── provider.ts                    # Provider 接口定义
├── factory.ts                     # 工厂模式 + 智能切换
├── providers/
│   ├── duckdb-provider.ts         # DuckDB 实现
│   ├── ndtsdb-provider.ts        # ndtsdb 实现
│   └── memory-provider.ts         # 内存实现
├── database.ts                    # KlineDatabase（legacy 兼容封装，底层可走 ndtsdb）
└── index.ts                       # 统一导出
```

## 配置参考

```typescript
interface DatabaseFactoryConfig {
  // 默认使用的数据库
  defaultProvider: 'duckdb' | 'ndtsdb' | 'memory';
  
  // 各数据库的配置
  providers: {
    duckdb: { type: 'duckdb', path: string };
    ndtsdb: { type: 'ndtsdb', dataDir: string, partitionBy?: 'hour' | 'day' };
    memory: { type: 'memory' };
  };
  
  // 读写分离
  readProvider?: DatabaseProviderType;
  writeProvider?: DatabaseProviderType;
  
  // 智能切换阈值
  switchThreshold?: {
    minRowsForNdtsdb?: number;
    maxRowsForMemory?: number;
  };
}
```

## 迁移状态与兼容层 (2026-02-10 更新)

### DuckDB → ndtsdb 迁移进度

| 组件 | 状态 | 说明 |
|------|------|------|
| **NdtsdbProvider** | ✅ 完成 | ndtsdb 存储引擎已接入，提供 insertKlines/upsertKlines/queryKlines 等完整接口 |
| **DatabaseFactory** | ✅ 完成 | 工厂模式支持 ndtsdb/duckdb/memory 三 provider 智能切换 |
| **KlineDatabase 兼容层** | ✅ 完成 | 已补齐 DuckDB 风格兼容方法（`connect/upsertKlines/getLatestTimestamp/getLatestKline`） |
| **SmartKlineCache** | ✅ 可用 | 已恢复增量缓存写入链路 |

### KlineDatabase 兼容层（已修复）

`KlineDatabase` 是 **quant-lib 应用封装层**（面向上层业务的“便利 API”），底层实际存储由 Provider（如 `NdtsdbProvider`）负责；**它不是 ndtsdb 引擎的一部分**。

迁移到 ndtsdb 时曾出现接口不兼容问题（`connect/upsert/getLatest*` 缺失），已在 `quant-lib/src/storage/database.ts` 中补齐。

**已实现的兼容方法**：

```typescript
export class KlineDatabase {
  // ndtsdb-backed 实现（quant-lib 封装层）
  async init(): Promise<void>
  async connect(): Promise<void>           // init() 的别名
  async close(): Promise<void>

  async insertKlines(klines: Kline[]): Promise<void>
  async upsertKlines(klines: Kline[]): Promise<void>

  async queryKlines(options: QueryOptions): Promise<Kline[]>
  async getLatestTimestamp(symbol: string, interval: string): Promise<number | null>
  async getLatestKline(symbol: string, interval: string): Promise<Kline | null>
}
```

**影响范围**:
- `SmartKlineCache` - 使用 `upsertKlines()` 和 `getLatestTimestamp()`
- 采集调度策略 - 依赖 `getLatestTimestamp()` 计算增量

**修复方案**（在 quant-lib 层实现，不涉及 ndtsdb）：
1. ✅ **方案 A（已完成）**: 在 `KlineDatabase` 中补齐兼容方法（保证上层无需大改）
2. 🟡 **方案 B（可选长期）**: 让 `SmartKlineCache` 直接依赖 `DatabaseProvider` 接口（减少 legacy 包袱）

**注意事项**:
- ⚠️ 这是 **quant-lib 层**的适配工作，不是 ndtsdb 引擎的问题
- ⚠️ ndtsdb 已提供所有必要的基础能力（`insertKlines`、`queryKlines` 等）
- ⚠️ `NdtsdbProvider` 已经完整实现了所有方法，可直接使用

---

## 迁移指南

### 从旧版升级

**旧代码** (仅支持 DuckDB):
```typescript
import { KlineDatabase } from 'quant-lib';
const db = new KlineDatabase('./data/klines.duckdb');
```

**新代码** (多数据库，推荐):
```typescript
import { DatabaseFactory, NdtsdbProvider } from 'quant-lib';

// 方式 1: 使用 Factory（推荐）
const factory = new DatabaseFactory({
  defaultProvider: 'ndtsdb',
  providers: { ndtsdb: { type: 'ndtsdb', dataDir: './data/ndtsdb' } }
});
await factory.initAll();
const db = factory.getDefault();

// 方式 2: 直接使用 NdtsdbProvider（简单场景）
const db = new NdtsdbProvider({ type: 'ndtsdb', dataDir: './data/ndtsdb' });
await db.connect();
```

**如果你还在用 KlineDatabase**（legacy 代码）:
```typescript
// 现在已恢复 connect/upsert/getLatest* 兼容性，可继续使用
// 但新代码更推荐直接用 NdtsdbProvider / DatabaseFactory（Provider 接口更清晰）
```

## 最佳实践

1. **高频写入场景**: 使用 `NdtsdbProvider`
2. **复杂 SQL 查询**: 使用 `DuckDBProvider`
3. **临时计算/缓存**: 使用 `MemoryProvider`
4. **混合场景**: 使用 `DatabaseFactory` 自动切换

## 测试

```bash
# 多数据库整合测试
bun run tests/multi-provider.ts
```
