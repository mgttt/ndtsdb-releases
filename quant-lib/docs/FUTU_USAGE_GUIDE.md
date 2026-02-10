# FUTU Provider 使用指南

**最后更新**: 2026-02-01  
**版本**: v1.0

---

## ⚠️ 关键概念（必读）

### 客户端架构

**✅ 正确**: 使用我们自己实现的 TypeScript 客户端
```typescript
import { FutuNativeClient } from '../../futu-trader/src/native-client/FutuNativeClient';
// 这是我们自己基于 FUTU Protobuf 协议实现的客户端
```

**❌ 错误**: 使用 FUTU 官方 Python SDK 或 Python wrapper
```typescript
// ❌ 已废弃，不要使用
import { QuoteClient, TradeClient } from './client/QuoteClient';
// 这些是旧的 Python wrapper，性能差、依赖多
```

**架构对比**:
```
❌ 旧方案（已废弃）:
TypeScript → Python Wrapper → FUTU 官方 Python SDK → FutuOpenD
- 缺点：启动慢、双语言维护、依赖多

✅ 新方案（当前使用）:
TypeScript (我们自己实现) → TCP Socket + Protobuf → FutuOpenD
- 优点：纯 TypeScript、性能快 10-50 倍、完全掌控
```

---

## 🚀 快速开始

### 1. 行情数据采集

```typescript
import { FutuProvider } from '../src/providers/futu';
import { KlineDatabase } from '../src/storage/database';

const futu = new FutuProvider();
await futu.connect();

// 获取K线数据（⚠️ 注意：单对象参数）
const klines = await futu.getKlines({
  symbol: '700/HKD',    // quant-lib 格式
  interval: '15m',      // 时间周期
  limit: 5000,          // 数量
});

// 存储到数据库
const db = new KlineDatabase();
await db.connect();
await db.upsertKlines(klines);

await db.close();
await futu.disconnect();
```

### 2. 持仓查询

```typescript
import { FutuNativeClient, TrdEnv, TrdMarket } from '../../futu-trader/src/native-client/FutuNativeClient';

const client = new FutuNativeClient();
await client.connect();

// 获取账户列表
const accounts = await client.getAccountList();

// 查询持仓（⚠️ 必须设置 needGeneralSecAccount: true）
for (const account of accounts) {
  const positions = await client.getPositions({
    trdEnv: account.trdEnv,
    accID: account.accID.toString(),
    trdMarket: account.trdMarket,
    needGeneralSecAccount: true,  // ⭐ 必须！否则看不到综合账户持仓
  });
  
  console.log(`账户 ${account.accID}: ${positions.length} 个持仓`);
}

await client.disconnect();
```

---

## 📖 常见问题

### Q1: 为什么 `getPositions()` 返回空数组？

**A**: 99% 的情况是因为没有设置 `needGeneralSecAccount: true`

**问题**:
```typescript
// ❌ 错误：只能看到单市场持仓
const positions = await client.getPositions({
  trdEnv: TrdEnv.REAL,
  accID: '...',
  trdMarket: TrdMarket.HK,
});
```

**解决**:
```typescript
// ✅ 正确：包含所有市场持仓
const positions = await client.getPositions({
  trdEnv: TrdEnv.REAL,
  accID: '...',
  trdMarket: TrdMarket.HK,
  needGeneralSecAccount: true,  // ⭐ 加上这个！
});
```

---

### Q2: 为什么解析持仓代码时报 "未知市场"？

**A**: FUTU API 返回的代码格式是 `市场号.代码`，不是 `市场代码.代码`

**代码格式**:
```typescript
// ✅ 实际格式（从 API 返回）:
"1.00700"   // 港股（市场号 1）
"2.AAPL"    // 美股（市场号 2）
"21.600000" // A股沪市（市场号 21）

// ❌ 错误理解（容易搞错）:
"HK.00700"  // 这不是 API 返回的格式
"US.AAPL"
```

**正确解析**:
```typescript
const [marketNum, code] = position.code.split('.');

let symbol: string;
if (marketNum === '1') {
  // 港股：去掉前导零
  const num = parseInt(code, 10);
  symbol = `${num}/HKD`;
} else if (marketNum === '2') {
  // 美股
  symbol = `${code}/USD`;
} else if (marketNum === '21' || marketNum === '22') {
  // A股
  symbol = `${code}/CNY`;
} else {
  console.log(`⚠️  跳过未知市场号: ${marketNum}`);
}
```

---

### Q3: 为什么 `getKlines()` 报错 "undefined is not an object"？

**A**: 方法签名是单对象参数，不是多参数

**错误用法**:
```typescript
// ❌ 错误：传了两个参数
const klines = await futu.getKlines(symbol, { interval: '15m' });
```

**正确用法**:
```typescript
// ✅ 正确：只传一个对象参数
const klines = await futu.getKlines({
  symbol,
  interval: '15m',
  limit: 5000,
});
```

**原因**: `quant-lib` 的 Provider 接口设计：
```typescript
interface RestDataProvider {
  getKlines(query: KlineQuery): Promise<Kline[]>;
  //        ↑ 单个对象参数
}
```

---

### Q4: 市场号映射表是什么？

**A**: FUTU API 使用数字表示市场

| 市场号 | 市场 | 示例代码 | quant-lib 格式 | 货币 |
|--------|------|----------|----------------|------|
| 1 | 港股 | `1.00700` | `700/HKD` | HKD |
| 2 | 美股 | `2.AAPL` | `AAPL/USD` | USD |
| 21 | A股沪市 | `21.600000` | `600000/CNY` | CNY |
| 22 | A股深市 | `22.000001` | `1/CNY` | CNY |

**对应的枚举值**（在代码中使用）:
```typescript
import { TrdMarket } from '../../futu-trader/src/native-client/FutuNativeClient';

TrdMarket.HK    // 港股
TrdMarket.US    // 美股
TrdMarket.CN    // A股（需进一步区分沪深）
```

---

## 🎯 完整示例：持仓波动率分析

```typescript
#!/usr/bin/env bun
import { FutuNativeClient, TrdEnv } from '../../futu-trader/src/native-client/FutuNativeClient';
import { FutuProvider } from '../src/providers/futu';
import { KlineDatabase } from '../src/storage/database';

async function analyzePositionsVolatility() {
  // 1. 获取持仓
  const client = new FutuNativeClient();
  await client.connect();
  
  const accounts = await client.getAccountList();
  const allPositions: any[] = [];
  
  for (const account of accounts) {
    const positions = await client.getPositions({
      trdEnv: account.trdEnv,
      accID: account.accID.toString(),
      trdMarket: account.trdMarket,
      needGeneralSecAccount: true,  // ⭐ 必须！
    });
    
    allPositions.push(...positions);
  }
  
  await client.disconnect();
  
  // 2. 采集K线数据
  const futu = new FutuProvider();
  await futu.connect();
  
  const db = new KlineDatabase();
  await db.connect();
  
  for (const pos of allPositions) {
    // 解析市场号
    const [marketNum, code] = pos.code.split('.');
    
    let symbol: string;
    if (marketNum === '1') {
      symbol = `${parseInt(code, 10)}/HKD`;
    } else if (marketNum === '2') {
      symbol = `${code}/USD`;
    } else {
      continue;  // 跳过其他市场
    }
    
    // 获取K线（⚠️ 单对象参数）
    const klines = await futu.getKlines({
      symbol,
      interval: '15m',
      limit: 5000,
    });
    
    // 存储
    await db.upsertKlines(klines);
  }
  
  await db.close();
  await futu.disconnect();
  
  // 3. 计算波动率
  // ...（使用 DuckDB SQL 查询）
}

analyzePositionsVolatility().catch(console.error);
```

---

## 📚 相关文档

- **FUTU Skill 完整文档**: `/home/devali/moltbaby/skills/futu/SKILL.md`
- **原生客户端实现**: `/home/devali/moltbaby/futu-trader/src/native-client/`
- **Quant-Lib README**: `/home/devali/moltbaby/quant-lib/README.md`
- **FUTU 官方文档**: https://openapi.futunn.com/futu-api-doc/

---

## ⚠️ 重要提醒

1. **不要使用 Python wrapper**（已归档到 `futu-trader/archive/python-wrapper/`）
2. **持仓查询必须设置** `needGeneralSecAccount: true`
3. **代码格式**: `1.00700`（市场号.代码），不是 `HK.00700`
4. **方法参数**: `getKlines({ symbol, ... })`（单对象），不是 `getKlines(symbol, { ... })`（多参数）
5. **客户端**: 使用 `FutuNativeClient`（我们自己实现），不是 `QuoteClient/TradeClient`（已废弃）

---

**最后更新**: 2026-02-01 15:15  
**维护者**: OpenClaw AI
