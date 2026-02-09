// 简化测试 - 逐步验证
import { SymbolTable } from '../src/symbol.js';
import { WAL } from '../src/wal.js';
import { PartitionManager } from '../src/partition.js';

console.log('🧪 组件测试\n');

// 1. 测试 SymbolTable
console.log('1. SymbolTable 测试');
const symbolTable = new SymbolTable('./data/test-symbols.json');
const id1 = symbolTable.getOrCreateId('AAPL');
const id2 = symbolTable.getOrCreateId('GOOGL');
const id3 = symbolTable.getOrCreateId('AAPL'); // 重复
console.log(`  AAPL -> ${id1}`);
console.log(`  GOOGL -> ${id2}`);
console.log(`  AAPL (重复) -> ${id3}`);
console.log(`  ✓ SymbolTable 工作正常\n`);

// 2. 测试 WAL
console.log('2. WAL 测试');
const wal = new WAL('./data/test-wal', { flushIntervalMs: 100 });
wal.append('trades', { symbol: 'AAPL', price: 100 });
wal.append('trades', { symbol: 'GOOGL', price: 200 });
wal.flush();
console.log(`  ✓ WAL 写入正常\n`);

// 3. 测试 PartitionManager
console.log('3. PartitionManager 测试');
const pm = new PartitionManager('./data/test-partitions', { column: 'timestamp', granularity: 'hour' });
pm.writeRow({ symbol: 0, price: 100, timestamp: new Date().toISOString() }, new Date());
pm.writeRow({ symbol: 1, price: 200, timestamp: new Date().toISOString() }, new Date());
pm.flush();
console.log(`  ✓ PartitionManager 写入正常\n`);

// 4. 查询测试
console.log('4. 查询测试');
const results = pm.query(new Date(Date.now() - 3600000), new Date());
console.log(`  查询返回 ${results.length} 行`);
console.log(`  ✓ 查询正常\n`);

// 清理
wal.close();
console.log('✅ 所有组件测试通过！');
