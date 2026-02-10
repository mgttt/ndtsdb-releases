// ============================================================
// 多数据库 Provider 整合测试
// 演示 quant-lib 如何同时使用 DuckDB、ndtsdb 和 Memory
// ============================================================

import { DatabaseFactory, MemoryProvider, NdtsdbProvider } from '../src/storage/index';
import type { DatabaseProviderConfig } from '../src/storage/provider';

// 生成测试 K线数据
function generateKlines(symbol: string, interval: string, count: number, startTime: number) {
  const klines = [];
  for (let i = 0; i < count; i++) {
    const basePrice = 100 + Math.sin(i / 100) * 20;
    klines.push({
      symbol,
      interval,
      timestamp: startTime + i * 60,  // 1分钟间隔 (秒)
      open: basePrice + Math.random() * 5,
      high: basePrice + 5 + Math.random() * 5,
      low: basePrice - 5 - Math.random() * 5,
      close: basePrice + Math.random() * 5,
      volume: Math.floor(Math.random() * 10000)
    });
  }
  return klines;
}

async function main() {
  console.log('🚀 quant-lib 多数据库 Provider 整合测试');
  console.log('==========================================\n');

  // 配置多数据库
  const factory = new DatabaseFactory({
    defaultProvider: 'duckdb',
    providers: {
      duckdb: { 
        type: 'duckdb', 
        path: './data/test-duckdb.duckdb' 
      },
      ndtsdb: { 
        type: 'ndtsdb', 
        dataDir: './data/test-ndtsdb',
        partitionBy: 'hour'
      },
      memory: { 
        type: 'memory' 
      }
    },
    // 智能切换阈值
    switchThreshold: {
      minRowsForNdtsdb: 5000,   // 超过5000行使用 ndtsdb
      maxRowsForMemory: 100      // 少于100行使用内存
    }
  });

  // 1. 初始化所有数据库
  console.log('1️⃣ 初始化所有数据库连接...');
  await factory.initAll();
  console.log(`   ✅ 已连接: ${factory.getConnectedProviders().join(', ')}\n`);

  // 2. 测试数据
  const testSizes = [100, 1000, 10000];
  const startTime = Math.floor(Date.now() / 1000) - 24 * 60 * 60;  // 24小时前 (Unix 秒)

  for (const size of testSizes) {
    console.log(`\n📊 测试数据量: ${size.toLocaleString()} 行`);
    console.log('-'.repeat(50));

    const klines = generateKlines('BTCUSDT', '1m', size, startTime);

    // 3. 智能选择数据库
    const provider = factory.getSmart('batch', size);
    console.log(`   🤖 智能选择: ${provider.type}`);

    // 4. 写入测试
    const writeStart = performance.now();
    await provider.insertKlines(klines);
    const writeTime = performance.now() - writeStart;
    const writeSpeed = size / writeTime * 1000;
    console.log(`   📝 写入: ${writeTime.toFixed(2)}ms | ${writeSpeed.toFixed(0).padStart(10)} rows/s`);

    // 5. 查询测试
    const queryStart = performance.now();
    const results = await provider.queryKlines({
      symbol: 'BTCUSDT',
      interval: '1m',
      limit: 10
    });
    const queryTime = performance.now() - queryStart;
    console.log(`   🔍 查询: ${queryTime.toFixed(2)}ms | 返回 ${results.length} 行`);

    // 6. SAMPLE BY 测试
    if (size >= 1000) {
      const aggStart = performance.now();
      const ohlcv = await provider.sampleBy({
        symbol: 'BTCUSDT',
        interval: '1m',
        bucketSize: '1h',
        aggregations: [
          { column: 'open', op: 'first' },
          { column: 'high', op: 'max' },
          { column: 'low', op: 'min' },
          { column: 'close', op: 'last' },
          { column: 'volume', op: 'sum' }
        ]
      });
      const aggTime = performance.now() - aggStart;
      console.log(`   📈 SAMPLE BY: ${aggTime.toFixed(2)}ms | 生成 ${ohlcv.length} 根 K线`);
    }

    // 7. 统计信息
    const stats = await provider.getStats();
    console.log(`   📊 统计: ${stats.totalRows.toLocaleString()} 行, ${stats.symbols.length} symbols`);
  }

  // 8. 跨数据库查询对比
  console.log('\n\n📈 跨数据库性能对比');
  console.log('='.repeat(50));

  const bigData = generateKlines('ETHUSDT', '1m', 50000, startTime);

  for (const type of ['memory', 'ndtsdb'] as const) {
    const provider = factory.get(type);
    
    console.log(`\n🔸 ${type.toUpperCase()}:`);
    
    // 清空并重新插入
    if (type === 'memory') {
      await (provider as MemoryProvider).connect();  // 重置内存
    }

    const writeStart = performance.now();
    await provider.insertKlines(bigData);
    const writeTime = performance.now() - writeStart;
    
    const queryStart = performance.now();
    await provider.queryKlines({ symbol: 'ETHUSDT', interval: '1m' });
    const queryTime = performance.now() - queryStart;

    console.log(`   写入: ${writeTime.toFixed(2)}ms | ${(50000/writeTime*1000).toFixed(0)} rows/s`);
    console.log(`   查询: ${queryTime.toFixed(2)}ms`);
  }

  // 9. 数据迁移演示
  console.log('\n\n🔄 数据迁移演示');
  console.log('='.repeat(50));
  
  // 将 Memory 数据迁移到 ndtsdb
  const memoryData = generateKlines('MIGRATE', '1m', 1000, startTime);
  await factory.get('memory').insertKlines(memoryData);
  
  console.log('   Memory 数据:', (await factory.get('memory').getStats()).totalRows, '行');
  console.log('   ndtsdb 迁移前:', (await factory.get('ndtsdb').getStats()).totalRows, '行');
  
  await factory.migrate('memory', 'ndtsdb', { symbols: ['MIGRATE'] });
  
  console.log('   ndtsdb 迁移后:', (await factory.get('ndtsdb').getStats()).totalRows, '行');
  console.log('   ✅ 迁移完成');

  // 10. 关闭所有连接
  console.log('\n\n👋 关闭所有连接...');
  await factory.closeAll();
  console.log('   ✅ 全部关闭');

  // 最终总结
  console.log('\n' + '='.repeat(70));
  console.log('✅ 整合测试完成！');
  console.log('\n💡 使用建议:');
  console.log('   • 小数据量 (<1000): 使用 MemoryProvider');
  console.log('   • 中等数据量 (1K-100K): 使用 DuckDBProvider');
  console.log('   • 大数据量 (>10K) 高频写入: 使用 NdtsdbProvider');
  console.log('   • 使用 DatabaseFactory 自动智能切换');
  console.log('\n📁 新增文件:');
  console.log('   - src/storage/provider.ts        # Provider 接口');
  console.log('   - src/storage/providers/         # 各 Provider 实现');
  console.log('   - src/storage/factory.ts         # 工厂模式');
  console.log('   - src/storage/index.ts           # 统一导出');
  console.log('='.repeat(70));
}

main().catch(console.error);
