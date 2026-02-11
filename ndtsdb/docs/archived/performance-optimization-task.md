# [ARCHIVED] ndtsdb 性能优化任务

> **归档日期**: 2026-02-11
> **原因**: 任务已完成（getMax 优化、query limit 优化、分区裁剪优化）
> **最新状态见**: docs/ROADMAP.md

**原创建时间**: 2026-02-11  
**原优先级**: P0  
**分配给**: bot-001

---

## 原始问题（已解决）

**症状**：`PartitionedTable.query()` 是 O(n) 全表扫描

**解决方案**: 
- ✅ v0.9.4.0: 内存索引缓存 + O(1) 查询
- ✅ v0.9.4.1: limit + reverse 提前退出
- ✅ v0.9.4.3: 行级 timeRange 过滤

*[原文档已归档]*
