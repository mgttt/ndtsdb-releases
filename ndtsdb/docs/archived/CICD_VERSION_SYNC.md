# [ARCHIVED] CI/CD 版本号同步指南

> **归档日期**: 2026-02-11
> **原因**: 内容已整合到开发文档
> **最新状态见**: scripts/sync-version.sh 注释

---

ndtsdb 使用独立的 `VERSION` 文件管理版本号，CI/CD 工具可以读取此文件并自动同步到 `README.md` 和 `package.json`。

## 文件说明

| 文件 | 作用 | 格式 |
|------|------|------|
| `VERSION` | 版本号唯一来源 | 纯文本，如 `0.9.2.6` |
| `README.md` | 显示版本号 | 包含 `<!-- VERSION_START -->` 标记 |
| `package.json` | npm 版本号 | JSON 的 `version` 字段 |
| `scripts/sync-version.sh` | 同步脚本 | Bash 脚本 |

*[原文档已归档]*
