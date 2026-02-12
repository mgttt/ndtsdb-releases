# [ARCHIVED] quant-lib 多数据库 Provider 架构

> **归档日期**: 2026-02-11
> **原因**: 架构已简化，当前仅使用 ndtsdb
> **最新状态见**: README.md / DESIGN.md

---

## 原始架构

支持多 Provider：DuckDB / ndtsdb / Memory

## 当前架构

统一使用 **ndtsdb** 作为底层存储引擎

```
quant-lib
    └── KlineDatabase (ndtsdb 封装)
```

*[原文档已归档]*
