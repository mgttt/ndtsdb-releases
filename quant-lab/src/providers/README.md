# Trading Providers

Trading Providers 是连接交易所的适配器，实现统一的 `TradingProvider` 接口。

---

## 📋 Provider 列表

| Provider | 状态 | 功能 | 备注 |
|----------|------|------|------|
| **PaperTradingProvider** | ✅ **完整** | 模拟交易 | 用于测试，支持手续费 + 滑点 |
| **BybitProvider** | ✅ **完整** | Bybit 合约 | WebSocket K线 + REST 订单/持仓 ✅ 实盘验证 |
| **CoinExProvider** | ⚠️ **框架** | CoinEx 合约 | v2 API框架完成，待测试 |
| **HTXProvider** | ⚠️ **框架** | HTX 合约 | USDT永续框架完成，待测试 |
| **BinanceProvider** | ⚠️ 框架 | Binance 现货 | 优先级低（需代理/地区限制）|

> **交易所优先级**: Bybit ✅ → CoinEx 🔄 → HTX 🔄 → Binance ⏸️

---

## 🔌 TradingProvider 接口

```typescript
interface TradingProvider {
  // WebSocket 订阅
  subscribeKlines(symbols: string[], interval: string, callback: (bar: Kline) => void): Promise<void>;
  subscribeTicks?(symbols: string[], callback: (tick: Tick) => void): Promise<void>;
  
  // 订单执行
  buy(symbol: string, quantity: number, price?: number): Promise<Order>;
  sell(symbol: string, quantity: number, price?: number): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  
  // 账户查询
  getAccount(): Promise<Account>;
  getPosition(symbol: string): Promise<Position | null>;
  getPositions(): Promise<Position[]>;
}
```

---

## 🚀 使用示例

### PaperTradingProvider（模拟交易）

```typescript
import { LiveEngine } from '../engine/live';
import { PaperTradingProvider } from './paper-trading';

// 创建 Provider
const provider = new PaperTradingProvider({
  initialBalance: 10000,
  commission: 0.001,  // 0.1%
  slippage: 0.0005,   // 0.05%
});

// 创建引擎
const engine = new LiveEngine(strategy, config, provider);
await engine.start();

// 测试推送 K线
await provider.pushKline(bar);
```

### BinanceProvider（框架，待完善）

```typescript
import { LiveEngine } from '../engine/live';
import { BinanceProvider } from './binance';

// 创建 Provider（需要 API Key）
const provider = new BinanceProvider({
  apiKey: 'YOUR_API_KEY',
  apiSecret: 'YOUR_API_SECRET',
  testnet: true,  // 使用测试网
});

// 创建引擎
const engine = new LiveEngine(strategy, config, provider);
await engine.start();

// Provider 会自动订阅 K线 + 执行订单
```

### BybitProvider（框架，待完善）

```typescript
import { LiveEngine } from '../engine/live';
import { BybitProvider } from './bybit';

// 创建 Provider（需要 API Key）
const provider = new BybitProvider({
  apiKey: 'YOUR_API_KEY',
  apiSecret: 'YOUR_API_SECRET',
  category: 'linear',  // 合约类型
  testnet: true,
});

// 创建引擎
const engine = new LiveEngine(strategy, config, provider);
await engine.start();
```

---

## 📝 BinanceProvider / BybitProvider 实现清单

### 待实现功能

#### 1. WebSocket K线订阅
- [ ] 连接 WebSocket
- [ ] 订阅 K线 topic
- [ ] 解析 K线数据
- [ ] 调用回调函数
- [ ] 错误处理 + 重连机制

#### 2. REST API 订单执行
- [ ] 签名算法（HMAC SHA256）
- [ ] POST 下单接口
- [ ] 解析订单响应
- [ ] 错误处理

#### 3. REST API 账户查询
- [ ] GET 账户余额
- [ ] GET 持仓信息
- [ ] 解析响应数据

#### 4. 错误处理
- [ ] 速率限制（Rate Limit）
- [ ] 网络错误重试
- [ ] 签名错误提示
- [ ] 余额不足提示

---

## 🔗 参考资料

### Binance API
- REST API: https://binance-docs.github.io/apidocs/spot/en/
- WebSocket: https://binance-docs.github.io/apidocs/spot/en/#websocket-market-streams

### Bybit API
- REST API: https://bybit-exchange.github.io/docs/v5/intro
- WebSocket: https://bybit-exchange.github.io/docs/v5/ws/connect

---

## 🤝 贡献指南

如需实现 BinanceProvider / BybitProvider，请参考：
1. `paper-trading.ts` - 实现示例
2. `quant-lib/src/providers/binance.ts` - Binance 数据提供者（REST API）
3. `quant-lib/src/providers/bybit.ts` - Bybit 数据提供者（REST API）

可以复用 quant-lib 的 REST API 代码，只需添加 WebSocket 订阅即可。
