// ============================================================
// Storage 模块统一导出
// 支持多数据库 Provider：DuckDB, ndtsdb, Memory
// ============================================================

// ndtsdb 数据库实现（基于 PartitionedTable）
export { KlineDatabase, type SyncMetadata, type CurrencyStats } from './database';

// Provider 抽象层
export {
  type DatabaseProvider,
  type DatabaseProviderConfig,
  type DatabaseProviderType,
  type QueryOptions,
  type AggregateOptions,
  type DatabaseStats
} from './provider';

// 具体 Provider 实现
export { NdtsdbProvider } from './providers/ndtsdb-provider';
export { MemoryProvider } from './providers/memory-provider';

// 工厂模式
export { DatabaseFactory, type DatabaseFactoryConfig } from './factory';

// 使用示例：
//
// 1. 简单使用（单数据库）
// const db = new NdtsdbProvider({ type: 'ndtsdb', dataDir: './data/ndtsdb' });
// await db.connect();
//
// 2. 使用工厂（多数据库管理）
// const factory = new DatabaseFactory({
//   defaultProvider: 'ndtsdb',
//   providers: {
//     ndtsdb: { type: 'ndtsdb', dataDir: './data/ndtsdb' },
//     memory: { type: 'memory' }
//   },
//   switchThreshold: {
//     minRowsForNdtsdb: 10000,
//     maxRowsForMemory: 1000
//   }
// });
// await factory.initAll();
//
// // 3. 智能选择数据库
// const db = factory.getSmart('batch', 50000); // 返回 ndtsdb
// const db = factory.getSmart('read', 500);    // 返回 memory
