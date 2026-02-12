# 量化系统全局架构

**版本**: 1.0  
**最后更新**: 2026-02-12  
**维护者**: bot-001  
**适用对象**: 开发者、运维人员、策略开发师

---

## 系统概览

量化交易系统采用 **三层分离架构**，实现策略开发、系统引擎、数据存储的解耦，支持回测、模拟交易、实盘交易三种运行模式。

### 三层架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                       策略层 (Strategy Layer)                    │
│                    开发者: bot-004 (策略开发师)                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  策略 JavaScript 文件 (quant-lab/strategies/)              │ │
│  │  ┌──────────────┬───────────────┬────────────────────────┐│ │
│  │  │ gales-simple │ grid-magnet   │ custom-strategy.js     ││ │
│  │  │    .js       │    .js        │  (用户自定义策略)      ││ │
│  │  └──────────────┴───────────────┴────────────────────────┘│ │
│  │                                                             │ │
│  │  生命周期函数:                                              │ │
│  │  - st_init()           // 初始化                           │ │
│  │  - st_heartbeat(tick)  // 行情更新回调                     │ │
│  │  - st_onOrderUpdate()  // 订单状态变化                     │ │
│  │  - st_onParamsUpdate() // 参数热更新                       │ │
│  │  - st_stop()           // 清理资源                         │ │
│  │                                                             │ │
│  │  Bridge API (策略调用系统功能):                             │ │
│  │  - bridge_log()        // 日志输出                         │ │
│  │  - bridge_getPrice()   // 获取最新价格                     │ │
│  │  - bridge_placeOrder() // 下单                             │ │
│  │  - bridge_cancelOrder()// 撤单                             │ │
│  │  - bridge_stateGet/Set()// 状态持久化                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      系统层 (System Layer)                       │
│                    开发者: bot-001 (开发总工)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  QuickJS 沙箱运行器 (quant-lab/src/sandbox/)               │ │
│  │  - QuickJSStrategy.ts  // 沙箱管理                         │ │
│  │  - 代码热重载          // 文件变化自动重启                 │ │
│  │  - 参数热更新          // 无需重启调参                     │ │
│  │  - 错误隔离            // 策略崩溃不影响系统               │ │
│  └────────────────────────────────────────────────────────────┘ │
│                            │                                     │
│  ┌────────────────────────┼────────────────────────────────────┐│
│  │     策略引擎 (quant-lab/src/engine/)                        ││
│  │                        │                                     ││
│  │  ┌─────────────────────┼────────────────────────────────┐  ││
│  │  │  BacktestEngine     │  LiveEngine                    │  ││
│  │  │  (回测引擎)         │  (实盘引擎)                    │  ││
│  │  │  - 事件驱动         │  - WebSocket 行情              │  ││
│  │  │  - 仓位管理         │  - Provider 抽象               │  ││
│  │  │  - 订单模拟         │  - 风控管理                    │  ││
│  │  │  - 盈亏计算         │  - 状态持久化                  │  ││
│  │  │  - 性能指标         │  - 订单管理                    │  ││
│  │  └──────────────────────────────────────────────────────┘  ││
│  └──────────────────────────┬──────────────────────────────────┘│
│                             │                                    │
│  ┌──────────────────────────┼───────────────────────────────┐  │
│  │  Provider 层 (quant-lab/src/providers/)                   │  │
│  │                          │                                 │  │
│  │  ┌────────────┬──────────┼─────────┬──────────────────┐  │  │
│  │  │ Simulated  │ Paper    │ Bybit   │ Binance          │  │  │
│  │  │ Provider   │ Trading  │ Provider│ Provider         │  │  │
│  │  │ (模拟行情) │ (模拟盘) │(实盘)   │ (实盘)           │  │  │
│  │  └────────────┴──────────┴─────────┴──────────────────┘  │  │
│  └────────────────────────────┬──────────────────────────────┘  │
└────────────────────────────────┼─────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                       数据层 (Data Layer)                        │
│                    开发者: bot-001 (开发总工)                    │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  quant-lib (数据管理库)                                    │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  KlineDatabase (分区表 + 压缩)                       │ │ │
│  │  │  - 哈希分区: symbol_id % 100                         │ │ │
│  │  │  - 压缩算法: Delta + Gorilla                         │ │ │
│  │  │  - 文件数: 9000 → 300 (减少 97%)                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  StreamingIndicators (实时指标)                      │ │ │
│  │  │  - SMA/EMA/StdDev/Min/Max                            │ │ │
│  │  │  - 多 symbol 管理 + 批量回填                         │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  │                                                             │ │
│  │  ┌──────────────────────────────────────────────────────┐ │ │
│  │  │  Data Providers (数据源)                             │ │ │
│  │  │  - BinanceProvider (K线/Ticker)                      │ │ │
│  │  │  - TradingViewProvider (实时行情)                    │ │ │
│  │  │  - InvestingProvider (基本面数据)                    │ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────────────┘ │
│                             │                                    │
│  ┌──────────────────────────┼───────────────────────────────┐  │
│  │  ndtsdb (时序数据库)                                      │  │
│  │                          │                                 │  │
│  │  ┌───────────────────────┼────────────────────────────┐  │  │
│  │  │  PartitionedTable     │  AppendWriter              │  │  │
│  │  │  - 分区管理           │  - Gorilla 压缩            │  │  │
│  │  │  - SQL 查询           │  - Delta/RLE 编码          │  │  │
│  │  │  - 索引优化           │  - 流式写入                │  │  │
│  │  └───────────────────────┴────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────┘  │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   外部系统 (External Systems)                    │
│  ┌──────────────┬──────────────┬───────────────────────────┐   │
│  │ Bybit API    │ Binance API  │ TradingView WebSocket     │   │
│  │ - REST       │ - REST       │ - 实时行情                │   │
│  │ - WebSocket  │ - WebSocket  │ - 历史数据                │   │
│  │ - 下单/撤单  │ - 下单/撤单  │ - 技术指标                │   │
│  └──────────────┴──────────────┴───────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 数据流向

### 1. 历史数据获取流程

```
┌──────────────┐
│ 交易所 API   │
│ (Binance)    │
└──────┬───────┘
       │ REST API 批量获取
       ▼
┌─────────────────────────────────────┐
│ quant-lib/src/providers/binance.ts │
│ - fetchKlines()                     │
│ - 时间范围分片                      │
│ - 去重 + 验证                       │
└──────────┬──────────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ quant-lib/src/storage/         │
│ KlineDatabase                  │
│ - insert() 批量写入            │
│ - Delta 压缩 timestamp         │
│ - Gorilla 压缩 price           │
└──────────┬─────────────────────┘
           │ 持久化
           ▼
┌─────────────────────────────────┐
│ ndtsdb PartitionedTable        │
│ - 分区文件: data/klines/1m/    │
│   - partition_000.ndts         │
│   - partition_001.ndts         │
│   - ...                        │
│ - 索引: .idx 文件              │
└────────────────────────────────┘
```

### 2. 实时行情 → 策略 → 下单流程

```
┌──────────────┐
│ 交易所       │
│ WebSocket    │
└──────┬───────┘
       │ 推送 Ticker/Trade
       ▼
┌──────────────────────────────────┐
│ quant-lab Provider               │
│ (BybitProvider/BinanceProvider)  │
│ - onTicker()                     │
│ - onTrade()                      │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ LiveEngine                       │
│ - 更新 lastPrice                 │
│ - 检查风控规则                   │
│ - 触发策略回调                   │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ QuickJSStrategy                  │
│ - bridge_getPrice()              │
│ - 策略逻辑计算                   │
│ - bridge_placeOrder()            │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ LiveEngine                       │
│ - 验证订单参数                   │
│ - 检查仓位限制                   │
│ - provider.placeOrder()          │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Provider (Bybit/Binance)         │
│ - 调用交易所下单 API             │
│ - 保存 orderId 映射              │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 交易所                           │
│ - 订单进入撮合引擎               │
│ - WebSocket 推送订单状态         │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ Provider.onOrderUpdate()         │
│ - 解析订单状态                   │
│ - 调用策略回调                   │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ QuickJSStrategy                  │
│ - st_onOrderUpdate()             │
│ - 更新策略状态                   │
│ - 触发后续逻辑                   │
└──────────────────────────────────┘
```

### 3. 回测数据流程

```
┌──────────────┐
│ 回测脚本     │
│ backtest.ts  │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────┐
│ KlineDatabase                    │
│ - query(symbol, timeRange)       │
│ - 分区裁剪优化                   │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ ndtsdb PartitionedTable          │
│ - 读取分区文件                   │
│ - 解压缩数据                     │
│ - 返回 K 线数组                  │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ BacktestEngine                   │
│ - 逐条回放 K 线                  │
│ - 触发策略 heartbeat             │
│ - 模拟订单成交                   │
│ - 计算盈亏/指标                  │
└──────────┬───────────────────────┘
           │
           ▼
┌──────────────────────────────────┐
│ 回测报告                         │
│ - 总收益率 / 夏普比率            │
│ - 最大回撤 / 胜率                │
│ - 权益曲线图                     │
└──────────────────────────────────┘
```

---

## 各层 API 边界

### 策略层 → 系统层 (Bridge API)

策略 JavaScript 只能通过 Bridge API 与系统交互，**不能直接访问系统内部**。

| Bridge 函数 | 参数 | 返回值 | 说明 |
|------------|------|--------|------|
| `bridge_log(level, msg)` | level: 'info'/'warn'/'error'<br>msg: string | void | 输出日志 |
| `bridge_getPrice(symbol)` | symbol: string | `{price: number}` | 获取最新价格 |
| `bridge_placeOrder(params)` | `{symbol, side, qty, price, ...}` | `{orderId, status}` | 下单 |
| `bridge_cancelOrder(orderId)` | orderId: string | `{success: boolean}` | 撤单 |
| `bridge_stateGet(key, default)` | key: string, default: string | string (JSON) | 读取持久化状态 |
| `bridge_stateSet(key, value)` | key: string, value: string (JSON) | void | 保存持久化状态 |
| `bridge_getPosition(symbol)` | symbol: string | `{size, entryPrice}` | 获取当前仓位 |
| `bridge_getAccount()` | - | `{balance, equity}` | 获取账户信息 |

**约束**:
- ✅ 所有 Bridge 函数都是同步调用（QuickJS 限制）
- ✅ 复杂对象通过 JSON 字符串传递
- ❌ 策略不能直接访问文件系统、网络、数据库
- ❌ 策略不能直接 import TypeScript 模块

---

### 系统层 → 数据层 (quant-lib API)

系统层通过 quant-lib 的导出接口访问数据。

| API | 说明 | 示例 |
|-----|------|------|
| `KlineDatabase.insert()` | 批量写入 K 线 | `db.insert(symbol, klines)` |
| `KlineDatabase.query()` | 查询 K 线 | `db.query(symbol, {start, end})` |
| `KlineDatabase.getLatest()` | 获取最新 K 线 | `db.getLatest(symbol, limit)` |
| `StreamingIndicators.update()` | 更新实时指标 | `indicators.update(symbol, price)` |
| `StreamingIndicators.getSMA()` | 获取 SMA | `indicators.getSMA(symbol, period)` |
| `BinanceProvider.fetchKlines()` | 获取历史数据 | `provider.fetchKlines(symbol, interval)` |

**约束**:
- ✅ 所有 API 都是 async/await
- ✅ 错误通过 throw Error 抛出
- ✅ 自动处理压缩/解压缩
- ❌ 不暴露 ndtsdb 的底层 API

---

### 数据层 → ndtsdb (内部 API)

quant-lib 内部使用 ndtsdb，**不对外暴露**。

| ndtsdb API | 说明 |
|-----------|------|
| `PartitionedTable.insert()` | 插入数据 |
| `PartitionedTable.query()` | SQL 查询 |
| `AppendWriter.write()` | 追加写入 |
| `AppendWriter.compact()` | 合并碎片文件 |

**压缩格式**:
- `timestamp` (int64): Delta 编码
- `open/high/low/close` (float64): Gorilla 压缩
- `volume` (float64): Gorilla 压缩

---

## 运行模式

### 1. SimulatedProvider（模拟行情，开发调试）

```bash
# 使用场景：快速验证策略逻辑
bun tools/strategy-cli.ts sim ./strategies/gales-simple.js \
  --scenario sine-wave \
  --speed 100

# 特点：
# - 时间加速（10x-1000x）
# - 7 个内置场景
# - 订单即时成交
# - 无需真实数据/API
```

**优点**: 秒级验证，无需等待真实行情  
**缺点**: 无法模拟真实市场复杂性

---

### 2. PaperTrading（模拟盘，真实行情）

```bash
# 使用场景：真实行情下验证策略
bun tests/run-gales-quickjs-bybit.ts
# (默认 DRY_RUN=true，不会调用真实下单 API)

# 特点：
# - 真实行情数据
# - 模拟订单撮合
# - 价格触及 → 成交
# - 保存订单历史
```

**优点**: 真实行情，接近实盘  
**缺点**: 需要等待行情波动

---

### 3. LiveTrading（实盘，真金白银）

```bash
# 使用场景：实盘交易
DRY_RUN=false bun tests/run-gales-quickjs-bybit.ts

# 特点：
# - 调用真实下单 API
# - 真实资金
# - 风控限制
# - 订单状态回推
```

**优点**: 真实盈亏  
**缺点**: 有资金风险

---

### 4. Backtest（回测，历史验证）

```bash
# 使用场景：验证策略历史表现
bun tests/backtest-simple-ma.ts

# 特点：
# - 使用历史 K 线
# - 快速回放
# - 完整性能指标
# - 权益曲线
```

**优点**: 快速验证历史表现  
**缺点**: 无法预测未来

---

## 故障排查手册

### 问题 1: 实盘策略不下单

**症状**: 策略正常运行，但没有订单产生

**排查步骤**:

```bash
# 1. 检查策略日志
tail -f ~/path/to/strategy.log

# 2. 检查价格是否更新
# 在策略 JS 中添加：
bridge_log('info', `价格: ${tick.price}`)

# 3. 检查订单逻辑
# 确认策略条件是否满足

# 4. 检查 DRY_RUN 模式
echo $DRY_RUN  # 应该是 false（实盘）

# 5. 检查 Provider 连接
# 查看 WebSocket 日志，确认行情推送正常
```

**常见原因**:
- ❌ 策略条件未满足（价格不在触发范围）
- ❌ DRY_RUN=true（Paper Trade 模式）
- ❌ WebSocket 断连（行情未更新）
- ❌ 风控限制（已达最大持仓）

---

### 问题 2: 订单成交后策略未收到回调

**症状**: 订单在交易所成交，但 `st_onOrderUpdate()` 未被调用

**排查步骤**:

```bash
# 1. 检查 Provider 是否实现 pollOrderStatus
# 查看 quant-lab/tests/run-gales-quickjs-bybit.ts

# 2. 检查 orderId 映射
# orderSymbolMap 是否正确维护

# 3. 查看 WebSocket 订单推送日志
# Bybit: private.order 频道
# Binance: USER_DATA stream

# 4. 手动触发订单查询
# 在 Provider 中添加日志
```

**解决方案**:
```typescript
// 确保 Provider 实现了订单状态轮询
private async pollOrderStatus() {
  const orders = await this.client.getOpenOrders(symbol);
  for (const order of orders) {
    if (order.status !== localOrder.status) {
      // 触发 st_onOrderUpdate
      await this.callFunction('st_onOrderUpdate', order);
    }
  }
}
```

---

### 问题 3: 策略频繁报错/崩溃

**症状**: QuickJS 沙箱频繁重启，策略逻辑异常

**排查步骤**:

```bash
# 1. 查看错误堆栈
journalctl --user -u openclaw-gateway | grep -A 10 "QuickJS"

# 2. 检查策略 JavaScript 语法
# 使用 bun run 验证语法
bun run --dry-run ./strategies/your-strategy.js

# 3. 检查 Bridge API 调用
# 确认参数格式正确（JSON 字符串）

# 4. 降低速度调试
# SimulatedProvider --speed 10（慢速观察）
```

**常见错误**:
```javascript
// ❌ 错误：直接传对象
bridge_stateSet('state', {value: 123})

// ✅ 正确：JSON 字符串
bridge_stateSet('state', JSON.stringify({value: 123}))

// ❌ 错误：未定义变量
console.log(undefinedVar)

// ✅ 正确：使用 bridge_log
bridge_log('info', 'message')
```

---

### 问题 4: 数据库查询返回空数组

**症状**: `KlineDatabase.query()` 返回 `[]`

**排查步骤**:

```bash
# 1. 检查数据是否存在
ls -lh ~/moltbaby/data/klines/1m/

# 2. 检查 symbol 格式
# 正确格式：BTCUSDT（无斜杠）

# 3. 检查时间范围
# 确保 start < end，且在数据范围内

# 4. 手动查询测试
bun -e "
import {KlineDatabase} from './quant-lib/src/storage/database.ts';
const db = new KlineDatabase('./data');
const result = await db.query('BTCUSDT', {
  start: new Date('2024-01-01'),
  end: new Date('2024-01-02')
});
console.log(result.length);
"

# 5. 检查分区文件
ls ~/moltbaby/data/klines/1m/partition_*.ndts
```

**解决方案**:
```typescript
// 确保时间范围正确
const klines = await db.query(symbol, {
  start: new Date(Date.now() - 7 * 86400 * 1000), // 7 天前
  end: new Date(), // 现在
});

// 检查返回结果
if (klines.length === 0) {
  console.log('无数据，可能需要先采集');
}
```

---

### 问题 5: Bybit/Binance API 报错

**症状**: `HTTP 401 Unauthorized` 或 `签名错误`

**排查步骤**:

```bash
# 1. 检查 API Key 配置
cat ~/.config/quant-lab/accounts.json

# 2. 验证 API Key 权限
# Bybit: https://www.bybit.com/app/user/api-management
# Binance: https://www.binance.com/en/my/settings/api-management

# 3. 检查系统时间
date  # 时间误差 > 5s 会导致签名失败
ntpdate -q pool.ntp.org

# 4. 测试 API 连接
curl -X GET 'https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT'

# 5. 查看详细错误
# 在 Provider 中添加日志
console.log('API 请求:', url, params);
console.log('API 响应:', response);
```

**常见原因**:
- ❌ API Key 过期/被删除
- ❌ IP 白名单限制
- ❌ 系统时间不准（签名失败）
- ❌ 权限不足（需要 Trade 权限）

---

### 问题 6: 策略参数热更新失败

**症状**: 调用 `updateParams()` 后参数未生效

**排查步骤**:

```bash
# 1. 检查 st_onParamsUpdate 是否实现
grep "st_onParamsUpdate" ./strategies/your-strategy.js

# 2. 检查参数格式
# 必须是 JSON 对象

# 3. 查看日志
# 确认 st_onParamsUpdate 被调用

# 4. 验证参数值
# 在策略中打印 ctx.strategy.params
bridge_log('info', JSON.stringify(ctx.strategy.params))
```

**正确实现**:
```javascript
function st_onParamsUpdate() {
  // 重新读取参数
  const paramsJson = bridge_stateGet('params', '{}');
  const params = JSON.parse(paramsJson);
  
  // 重新初始化网格
  initializeGrid(params.gridCount, params.gridSpacing);
  
  // 撤销旧订单（可选）
  cancelAllOrders();
  
  bridge_log('info', '参数已更新');
}
```

---

### 问题 7: 压缩数据损坏

**症状**: `ndtsdb` 读取文件报错 `Invalid compression format`

**排查步骤**:

```bash
# 1. 检查文件完整性
ls -lh ~/moltbaby/data/klines/1m/partition_*.ndts

# 2. 验证文件头
xxd ~/moltbaby/data/klines/1m/partition_000.ndts | head -5

# 3. 尝试读取 header
bun -e "
import {AppendWriter} from './ndtsdb/src/append.ts';
const header = AppendWriter.readHeader('./data/klines/1m/partition_000.ndts');
console.log(header);
"

# 4. 备份并删除损坏文件
mv partition_000.ndts partition_000.ndts.bak

# 5. 重新采集数据
bun scripts/collect-klines.ts
```

**预防措施**:
- ✅ 定期备份数据目录
- ✅ 使用 Git 管理策略代码
- ✅ 监控磁盘空间（避免写入中断）

---

## 性能优化建议

### 数据库性能

| 操作 | 优化前 | 优化后 | 方法 |
|------|--------|--------|------|
| **写入** | 10K rows/s | 21K rows/s | 批量插入 + 压缩 |
| **查询（全表）** | 5s | 0.8s | 分区裁剪 + 索引 |
| **getMax()** | 449ms | 160ms | 内存缓存 |
| **聚合** | 110ms | 12ms | 提前退出优化 |

**建议**:
1. ✅ 使用分区表（减少扫描范围）
2. ✅ 启用压缩（减少磁盘 I/O）
3. ✅ 建立索引（加速查询）
4. ✅ 批量操作（减少调用次数）

---

### 策略性能

| 指标 | 目标 | 说明 |
|------|------|------|
| **心跳延迟** | < 100ms | tick 到策略回调 |
| **下单延迟** | < 500ms | 策略决策到订单发出 |
| **内存占用** | < 1GB | QuickJS 沙箱 |
| **CPU 占用** | < 50% | 单核占用 |

**建议**:
1. ✅ 减少日志输出（`bridge_log` 有性能开销）
2. ✅ 缓存计算结果（避免重复计算）
3. ✅ 使用简单数据结构（数组 > 对象）
4. ❌ 避免深度递归（QuickJS 栈有限）

---

## 安全性

### API Key 管理

```bash
# ✅ 正确：使用配置文件
~/.config/quant-lab/accounts.json

# ❌ 错误：硬编码在策略中
const apiKey = "sk-xxx..."  // 不要这样做！

# ✅ 权限最小化
# Bybit: 只开启 Trade 权限，不开 Withdraw
# Binance: 只开启 Spot & Margin Trading
```

---

### 风控限制

```typescript
// 必须配置风控参数
const riskLimits = {
  maxPosition: 100,        // 最大持仓（USDT）
  maxDrawdown: 0.20,       // 最大回撤 20%
  maxOrderSize: 10,        // 单笔最大订单
  dailyLossLimit: 50,      // 每日最大亏损
};
```

---

## 监控和日志

### 日志位置

| 组件 | 日志位置 |
|------|---------|
| OpenClaw Gateway | `journalctl --user -u openclaw-gateway` |
| 策略日志 | `bridge_log()` 输出到 Gateway 日志 |
| ndtsdb | 文件操作错误会输出到 stderr |

### 监控指标

```bash
# CPU/内存
top -p $(pgrep -f openclaw-gateway)

# 磁盘空间
df -h ~/moltbaby/data/

# 网络连接
ss -tnp | grep -E "bybit|binance"
```

---

## 开发工作流

### 策略开发流程（bot-004）

```
1. 编写策略 JS → strategies/my-strategy.js
2. SimulatedProvider 快速验证 → 100x 加速
3. 修复 bug → 重复步骤 2
4. PaperTrade 真实行情验证 → DRY_RUN=true
5. 小资金实盘测试 → DRY_RUN=false
6. 正式上线
```

### 系统开发流程（bot-001）

```
1. 需求分析 → 写 ROADMAP
2. 架构设计 → 更新文档
3. 代码实现 → 单元测试
4. 集成测试 → 性能测试
5. 文档更新 → Git 提交
```

---

## 相关文档

- [quant-lab ROADMAP](../ROADMAP.md) - 策略引擎开发路线图
- [quant-lib ROADMAP](../../quant-lib/ROADMAP.md) - 数据层开发路线图
- [ndtsdb ROADMAP](../../ndtsdb/docs/ROADMAP.md) - 时序数据库开发路线图
- [STRATEGY_GUIDE](../STRATEGY_GUIDE.md) - 策略开发手册
- [CLI_QUICK_START](../CLI_QUICK_START.md) - CLI 工具快速上手
- [SIMULATED_PROVIDER_GUIDE](../SIMULATED_PROVIDER_GUIDE.md) - 模拟行情使用指南

---

**问题反馈**: 
- 系统问题 → bot-001
- 策略问题 → bot-004
- 实盘问题 → bot-009

---

*文档版本: 1.0*  
*最后更新: 2026-02-12*  
*维护者: bot-001*
