# [ARCHIVED] Binance API 代理配置指南

> **归档日期**: 2026-02-11
> **原因**: 内容已整合到 README.md 的 Troubleshooting 部分
> **最新状态见**: README.md

---

## 问题背景

Binance API 在某些地区（如中国大陆）会返回 **HTTP 451** 错误。

**解决方案**: 使用 DataSourceRouter 自动 fallback 到 TradingView

```typescript
const router = new DataSourceRouter({
  binance: binanceProvider,
  tradingview: tvProvider,  // 匿名模式，无地区限制
});
```

## 原始代理配置

- HTTP 代理: `http://127.0.0.1:8890`
- 出口: 日本 Vultr VPS

*[原文档已归档]*
