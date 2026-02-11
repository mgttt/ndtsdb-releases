# [ARCHIVED] ndtsdb v2 Roadmap - 分布式演进

> **归档日期**: 2026-02-11
> **原因**: 3FS 研究为探索性内容，未进入实际开发
> **最新状态见**: docs/ROADMAP.md

---

## 背景

基于对 [DeepSeek 3FS](https://github.com/deepseek-ai/3FS) 的技术研究，评估其分布式文件系统架构对 ndtsdb 的优化启发。

## 3FS 核心技术

### 1. Disaggregated Architecture（分离式架构）
- **存储层**：180 节点 × 16 NVMe SSD + 2×200Gbps RDMA
- **聚合吞吐**：6.6 TiB/s
- **locality-oblivious**：应用层无需关心数据物理位置

### 2. CRAQ (Chain Replication with Apportioned Queries)
- **强一致性**：写操作通过 chain 复制
- **读写分离**：读操作可命中 replica 节点

*[原文档已归档，完整研究内容保留但不再维护]*
