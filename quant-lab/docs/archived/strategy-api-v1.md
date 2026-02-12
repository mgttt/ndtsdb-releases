# [ARCHIVED] strategy-api-v1

> **归档日期**: 2026-02-11
> **原因**: 设计已迭代/功能已实现/方案已废弃
> **最新状态见**: README.md / DESIGN.md / ROADMAP.md

---

# 策略脚本 API 文档

> QuickJS 沙箱环境中可用的全局对象和方法

## 全局对象

### `log(...args)`
打印日志到策略执行日志。

```javascript
log('开始执行策略');
log('当前价格:', price);
log('对象:', JSON.stringify(data));
```

### `params`
策略执行时传入的参数对象。

```javascript
// 执行策略时传入: { symbol: 'BTCUSDT', threshold: 0.05 }
const symbol = params.symbol;
const threshold = params.threshold;
```

### `getApi(name, accountId?)`
获取 API 客户端。

| 参数 | 类型 | 说明 |
|------|------|------|
| name | string | API 名称: 'bybit', 'futu' |
| accountId | string | (可选) 账号 ID，如 'wjcgm@bbt' |

```javascript
// 获取默认 Bybit 客户端
const bybit = getApi('bybit');

// 获取指定账号
const bybitSub = getApi('bybit', 'wjcgm@bbt-sub1');
```

---

## Bybit API

### `bybit.getPositions(category?)`
查询持仓。

```javascript
const positions = await bybit.getPositions('linear');
// Returns: [{ symbol, side, size, entryPrice, markPrice, unrealizedPnl, leverage }]

for (const pos of positions) {
  log(pos.symbol, pos.side, pos.size, 'PnL:', pos.unrealizedPnl);
}
```

### `bybit.getBalance(accountType?)`
查询钱包余额。

```javascript
const balance = await bybit.getBalance('UNIFIED');
// Returns: { totalEquity, availableBalance, coin: [...] }

log('总权益:', balance.totalEquity);
```

---

## 工具函数

### `sleep(ms)`
异步等待（毫秒）。

```javascript
await sleep(1000); // 等待 1 秒
```

### `now()`
获取当前时间戳（毫秒）。

```javascript
const timestamp = now();
```

### `formatDate(date, format?)`
格式化日期。

```javascript
const today = formatDate(new Date(), 'YYYY-MM-DD');
const time = formatDate(new Date(), 'HH:mm:ss');
```

---

## 存储操作

### `storage.read(key)`
读取持久化数据。

```javascript
const lastPrice = await storage.read('lastPrice');
```

### `storage.write(key, value)`
写入持久化数据。

```javascript
await storage.write('lastPrice', currentPrice);
```

---

## 示例策略

### 持仓监控策略

```javascript
const accounts = ['wjcgm@bbt', 'wjcgm@bbt-sub1'];
const results = [];

for (const accountId of accounts) {
  log('查询账号:', accountId);
  
  const bybit = getApi('bybit', accountId);
  
  try {
    const positions = await bybit.getPositions('linear');
    const balance = await bybit.getBalance('UNIFIED');
    
    results.push({
      account: accountId,
      positions: positions.length,
      totalEquity: balance.totalEquity,
      timestamp: new Date().toISOString(),
    });
    
    log('✅', accountId, '成功:', positions.length, '个持仓');
    
  } catch (error) {
    log('❌', accountId, '失败:', error.message);
    results.push({
      account: accountId,
      error: error.message,
    });
  }
}

return {
  accountsQueried: accounts.length,
  results: results,
};
```

### 价格监控策略

```javascript
const symbol = params.symbol || 'BTCUSDT';
const threshold = params.threshold || 0.05;

const bybit = getApi('bybit');
const ticker = await bybit.getTicker(symbol);
const currentPrice = ticker.lastPrice;

const lastPrice = await storage.read(`price:${symbol}`);

if (lastPrice) {
  const change = Math.abs(currentPrice - lastPrice) / lastPrice;
  
  if (change > threshold) {
    log('🚨 价格变动超过阈值:', (change * 100).toFixed(2) + '%');
    // 可以在这里触发通知
  }
}

await storage.write(`price:${symbol}`, currentPrice);

return { symbol, price: currentPrice, change: change || 0 };
```

---

## 安全限制

| 限制 | 默认值 | 说明 |
|------|--------|------|
| 执行超时 | 60秒 | 可配置 |
| 内存限制 | 32MB | 可配置 |
| 网络访问 | 仅白名单 API | 无法访问外部 URL |
| 文件系统 | 只读 (除 storage) | 无法随意写文件 |
| CPU 时间 | 无限制 | 但超时会被终止 |

---

## 待补充 API

以下 API 正在开发中：

- [ ] `futu` - 富途 API 客户端
- [ ] `sendNotification(message)` - 发送通知
- [ ] `getKlines(symbol, interval, limit)` - 获取 K 线数据
- [ ] `placeOrder(params)` - 下单（仅限交易模式）
- [ ] `cancelOrder(orderId)` - 撤单

---

## 反馈

如需更多 API，请在 GitHub Issues 中提出。
