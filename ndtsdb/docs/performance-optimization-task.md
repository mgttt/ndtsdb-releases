# ndtsdb 性能优化任务

**创建时间**: 2026-02-11  
**优先级**: P0  
**分配给**: bot-001  
**预期工期**: 1-2天

---

## 问题描述

**症状**：`PartitionedTable.query()` 是 O(n) 全表扫描，导致查询最新时间戳非常慢

**实际影响**：
- 30个symbol查询最新时间戳：~300秒
- 每个symbol ~4000条K线 × 全表扫描 = 10秒/symbol

**当前临时方案**：
- 固定拉取最近100根K线，依赖 `upsertKlines()` 去重
- 权衡：避免查询，但每次多拉~99条重复数据

---

## 需求

### 1. 添加索引支持

为 `PartitionedTable` 添加高效的时间戳索引：

```typescript
// 目标API
const maxTimestamp = table.getMaxTimestamp(symbolId);
// 预期性能：O(1) 或 O(log n)
```

**实现方向**：
- 每个partition维护 `{symbolId → maxTimestamp}` 映射
- 插入/更新时自动维护索引
- 查询时直接返回缓存值

---

### 2. 优化 `query()` 性能

**当前问题**：
```typescript
// 全表扫描，即使 limit=1 也要遍历所有行
const rows = table.query(row => row.symbol_id === symbolId);
```

**优化方向**：
- 提前退出：找到N条匹配后立即返回（当指定limit时）
- 分区裁剪：利用时间范围跳过无关分区
- 倒序扫描：查最新数据时从尾部开始

---

## 验证标准

**性能目标**：
```
30个symbol查询最新时间戳：从 300秒 → <1秒
```

**测试用例**：
```typescript
// 1. 单symbol查询
const ts = db.getMaxTimestamp('BTC/USDT', '15m');
// 预期：<10ms

// 2. 批量查询
for (const sym of 30symbols) {
  const ts = db.getMaxTimestamp(sym, '15m');
}
// 预期：总耗时 <1秒

// 3. 索引一致性
await db.insertKlines([newKline]);
const ts = db.getMaxTimestamp(symbol, interval);
// 预期：ts === newKline.timestamp
```

---

## 优先级

**P0（高）**：实现 `getMaxTimestamp()` API  
**P1（中）**：优化 `query()` 提前退出  
**P2（低）**：分区裁剪优化

---

## 上下文

**相关文件**：
- `ndtsdb/src/partition.ts` - PartitionedTable实现
- `quant-lib/src/storage/database.ts` - KlineDatabase封装

**相关commit**：
- `76f0d33f2` - 临时方案：固定拉取避免查询

**性能测试脚本**：
- `quant-lib/scripts/collect-volatility-data.ts`

---

## 交付物

1. ✅ `PartitionedTable.getMaxTimestamp(symbolId)` API实现
2. ✅ `query()` 支持 `limit` 提前退出优化
3. ✅ 性能测试通过（<1秒完成30个symbol查询）
4. ✅ 单元测试（索引一致性验证）
5. ✅ 更新文档（API使用说明）

---

**目标**：让ndtsdb支持高效的"查最新时间戳"场景，消除全表扫描瓶颈 🎯
