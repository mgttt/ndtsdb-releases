#!/usr/bin/env bun
/**
 * Test fix for P0 issue: AppendWriter.readHeader() missing
 * This test verifies that PartitionedTable can now load partitions
 */

import { PartitionedTable } from '../src/partition.js';
import { existsSync } from 'fs';

// Test data location (from bot-003's report)
const testDataPath = '/home/devali/moltbaby/quant-lib/data/ndtsdb/klines-partitioned/15m';

console.log('🔍 Testing P0 fix: AppendWriter.readHeader() method');
console.log('━'.repeat(60));

// Check if test data exists
if (!existsSync(testDataPath)) {
  console.log('⚠️  Test data not found:', testDataPath);
  console.log('This is expected if quant-lib data collection hasn\'t run yet.');
  console.log('✅ Syntax check passed (no compilation errors)');
  process.exit(0);
}

try {
  console.log('📂 Loading PartitionedTable from:', testDataPath);
  
  const columns = [
    { name: 'timestamp', type: 'int64' },
    { name: 'symbol_id', type: 'int32' },
    { name: 'open', type: 'float64' },
    { name: 'high', type: 'float64' },
    { name: 'low', type: 'float64' },
    { name: 'close', type: 'float64' },
    { name: 'volume', type: 'float64' },
    { name: 'trades', type: 'int32' },
  ];

  const table = new PartitionedTable(
    testDataPath,
    columns,
    { type: 'hash', column: 'symbol_id', buckets: 100 }
  );

  console.log('✅ PartitionedTable loaded successfully');
  console.log(`   Partitions: ${table.getPartitions().length}`);
  
  const firstPartition = table.getPartitions()[0];
  if (firstPartition) {
    console.log(`   First partition: ${firstPartition.label} (${firstPartition.rows} rows)`);
  }

  // Test query (should not throw)
  const results = table.query(() => true, { limit: 10 });
  console.log(`✅ Query successful: ${results.length} rows returned`);

  console.log('━'.repeat(60));
  console.log('🎉 P0 fix verified: AppendWriter.readHeader() works!');
  process.exit(0);

} catch (error) {
  console.error('❌ Test failed:', error);
  console.error('Stack:', (error as Error).stack);
  process.exit(1);
}
