// ============================================================
// 数据库工厂
// 统一管理多种数据库 Provider
// ============================================================

import type { 
  DatabaseProvider, 
  DatabaseProviderConfig, 
  DatabaseProviderType 
} from './provider';
import { NdtsdbProvider } from './providers/ndtsdb-provider';
import { MemoryProvider } from './providers/memory-provider';

export interface DatabaseFactoryConfig {
  // 默认使用的数据库
  defaultProvider: DatabaseProviderType;
  
  // 各数据库的配置
  providers: Record<DatabaseProviderType, DatabaseProviderConfig>;
  
  // 读写分离配置
  readProvider?: DatabaseProviderType;  // 读操作使用的数据库
  writeProvider?: DatabaseProviderType; // 写操作使用的数据库
  
  // 自动切换阈值
  switchThreshold?: {
    minRowsForNdtsdb?: number;  // 超过此行数切换到 ndtsdb
    maxRowsForMemory?: number;   // 低于此行数使用内存
  };
}

export class DatabaseFactory {
  private providers: Map<DatabaseProviderType, DatabaseProvider> = new Map();
  private config: DatabaseFactoryConfig;
  private connected: Set<DatabaseProviderType> = new Set();

  constructor(config: DatabaseFactoryConfig) {
    this.config = {
      defaultProvider: 'ndtsdb',
      providers: {
        ndtsdb: { type: 'ndtsdb', dataDir: './data/ndtsdb' },
        memory: { type: 'memory' }
      },
      ...config
    };
  }

  /**
   * 初始化所有配置的数据库
   */
  async initAll(): Promise<void> {
    for (const [type, config] of Object.entries(this.config.providers)) {
      await this.connect(type as DatabaseProviderType, config);
    }
  }

  /**
   * 连接指定类型的数据库
   */
  async connect(type: DatabaseProviderType, config?: DatabaseProviderConfig): Promise<DatabaseProvider> {
    if (this.providers.has(type)) {
      return this.providers.get(type)!;
    }

    const providerConfig = config || this.config.providers[type];
    if (!providerConfig) {
      throw new Error(`No configuration for provider type: ${type}`);
    }

    let provider: DatabaseProvider;
    
    switch (type) {
      case 'ndtsdb':
        provider = new NdtsdbProvider(providerConfig);
        break;
      case 'memory':
        provider = new MemoryProvider(providerConfig);
        break;
      default:
        throw new Error(`Unknown provider type: ${type}`);
    }

    await provider.connect();
    this.providers.set(type, provider);
    this.connected.add(type);
    
    console.log(`✅ Connected to ${type} database`);
    return provider;
  }

  /**
   * 获取默认数据库
   */
  getDefault(): DatabaseProvider {
    return this.get(this.config.defaultProvider);
  }

  /**
   * 获取指定类型的数据库
   */
  get(type: DatabaseProviderType): DatabaseProvider {
    const provider = this.providers.get(type);
    if (!provider) {
      throw new Error(`Provider ${type} not connected. Call connect() first.`);
    }
    return provider;
  }

  /**
   * 获取读操作数据库（支持读写分离）
   */
  getReader(): DatabaseProvider {
    const type = this.config.readProvider || this.config.defaultProvider;
    return this.get(type);
  }

  /**
   * 获取写操作数据库（支持读写分离）
   */
  getWriter(): DatabaseProvider {
    const type = this.config.writeProvider || this.config.defaultProvider;
    return this.get(type);
  }

  /**
   * 智能选择数据库
   * 根据数据量和操作类型自动选择最合适的数据库
   */
  getSmart(operation: 'read' | 'write' | 'batch', estimatedRows?: number): DatabaseProvider {
    const { switchThreshold } = this.config;
    
    // 批量写入优先使用 ndtsdb
    if (operation === 'batch' && estimatedRows && estimatedRows > (switchThreshold?.minRowsForNdtsdb || 10000)) {
      return this.get('ndtsdb');
    }
    
    // 小数据量使用内存
    if (operation === 'read' && estimatedRows && estimatedRows < (switchThreshold?.maxRowsForMemory || 1000)) {
      return this.get('memory');
    }
    
    // 默认使用配置的 provider
    return operation === 'read' ? this.getReader() : this.getWriter();
  }

  /**
   * 数据迁移：从源数据库复制到目标数据库
   */
  async migrate(
    sourceType: DatabaseProviderType,
    targetType: DatabaseProviderType,
    options?: { symbols?: string[]; intervals?: string[] }
  ): Promise<{ copied: number }> {
    const source = this.get(sourceType);
    const target = this.get(targetType);

    console.log(`🔄 Migrating from ${sourceType} to ${targetType}...`);

    // 获取源数据库统计
    const stats = await source.getStats();
    
    // 按 symbol 和 interval 分批迁移
    let totalCopied = 0;
    const symbols = options?.symbols || stats.symbols;
    const intervals = options?.intervals || stats.intervals;

    for (const symbol of symbols) {
      for (const interval of intervals) {
        const klines = await source.queryKlines({ symbol, interval });
        if (klines.length > 0) {
          await target.insertKlines(klines);
          totalCopied += klines.length;
          console.log(`  📦 ${symbol}/${interval}: ${klines.length} rows`);
        }
      }
    }

    console.log(`✅ Migration complete: ${totalCopied} rows copied`);
    return { copied: totalCopied };
  }

  /**
   * 性能对比测试
   */
  async benchmark(operation: 'write' | 'read' | 'aggregate', dataSize: number): Promise<Record<DatabaseProviderType, number>> {
    const results: Record<string, number> = {};
    
    // 生成测试数据
    const testData = generateTestKlines(dataSize);
    
    for (const type of this.connected) {
      const provider = this.get(type);
      const start = performance.now();
      
      switch (operation) {
        case 'write':
          await provider.insertKlines(testData);
          break;
        case 'read':
          await provider.queryKlines({ limit: dataSize });
          break;
        case 'aggregate':
          await provider.sampleBy({
            symbol: 'TEST',
            interval: '1m',
            bucketSize: '1h',
            aggregations: [{ column: 'close', op: 'avg' }]
          });
          break;
      }
      
      results[type] = performance.now() - start;
    }
    
    return results;
  }

  /**
   * 关闭所有数据库连接
   */
  async closeAll(): Promise<void> {
    for (const [type, provider] of this.providers) {
      await provider.disconnect();
      console.log(`🔌 Disconnected from ${type} database`);
    }
    this.providers.clear();
    this.connected.clear();
  }

  /**
   * 获取已连接的数据库列表
   */
  getConnectedProviders(): DatabaseProviderType[] {
    return Array.from(this.connected);
  }
}

// 生成测试数据
function generateTestKlines(count: number): Array<{
  symbol: string;
  interval: string;
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}> {
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => ({
    symbol: 'TEST',
    interval: '1m',
    timestamp: now - (count - i) * 60000,
    open: 100 + Math.random() * 10,
    high: 110 + Math.random() * 10,
    low: 90 + Math.random() * 10,
    close: 100 + Math.random() * 10,
    volume: Math.random() * 1000
  }));
}
