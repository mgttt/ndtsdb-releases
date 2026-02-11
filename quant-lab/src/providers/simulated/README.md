# SimulatedProvider - 模拟行情 Provider

快速策略验证工具，支持时间加速（10x-1000x），让策略验证从"等行情"变成"即时触发"。

## 特性

- ✅ **多种模式**: random-walk / sine / trend / scenario
- ✅ **时间加速**: 10x-1000x 倍速
- ✅ **场景 DSL**: 自定义价格走势
- ✅ **订单成交**: 自动模拟成交
- ✅ **单步调试**: 逐步执行（可选）

---

## 快速开始

### 1. 使用内置场景

```bash
bun tests/run-simulated-strategy.ts ./strategies/gales-simple.js \
  --scenario range-then-dump \
  --speed 100
```

### 2. 随机游走模式

```bash
bun tests/run-simulated-strategy.ts ./strategies/gales-simple.js \
  --mode random-walk \
  --speed 50 \
  --volatility 0.02
```

### 3. 正弦波动模式

```bash
bun tests/run-simulated-strategy.ts ./strategies/gales-simple.js \
  --mode sine \
  --speed 200
```

---

## 内置场景

| 场景 | 描述 | 适用场景 |
|------|------|----------|
| `range-then-dump` | 区间震荡 → 下跌 10% | 测试 autoRecenter |
| `sine-wave` | 正弦波动，振幅 5% | 测试网格成交 |
| `slow-drift` | 缓慢上涨 +5% | 测试持仓暴露 |
| `pump-then-dump` | 先涨 5% 再跌 8% | 测试双向网格 |
| `gap-down` | 跳空下跌 15% | 测试异常处理 |
| `high-volatility` | 高频振荡 ±3% | 测试订单密集度 |
| `extreme-dump` | 暴跌 30% | 测试风控 |

---

## API 使用

### 基础用法

```typescript
import { SimulatedProvider, SCENARIOS } from './providers';

const provider = new SimulatedProvider({
  mode: 'scenario',
  startPrice: 100,
  scenario: SCENARIOS['range-then-dump'],
  speed: 100, // 100x 加速
});

provider.onPrice((price: number) => {
  console.log('价格更新:', price);
});

provider.onOrder((order: any) => {
  if (order.status === 'Filled') {
    console.log('订单成交:', order);
  }
});

provider.start();
```

### 随机游走

```typescript
const provider = new SimulatedProvider({
  mode: 'random-walk',
  startPrice: 100,
  volatility: 0.01, // 1% 波动率
  speed: 50,
});
```

### 正弦波动

```typescript
const provider = new SimulatedProvider({
  mode: 'sine',
  startPrice: 100,
  amplitude: 0.03,  // 3% 振幅
  period: 120,      // 2 分钟周期
  speed: 100,
});
```

### 趋势模式

```typescript
const provider = new SimulatedProvider({
  mode: 'trend',
  startPrice: 100,
  trendRate: 0.0001, // 每秒 0.01%
  speed: 100,
});
```

---

## 自定义场景

```typescript
import type { Scenario } from './providers';

const customScenario: Scenario = {
  name: 'My Custom Scenario',
  description: '自定义场景描述',
  startPrice: 100,
  phases: [
    {
      type: 'range',
      durationSec: 300,  // 震荡 5 分钟
      price: 100,
      range: 0.02,       // ±2%
    },
    {
      type: 'dump',
      durationSec: 60,   // 下跌 1 分钟
      change: -0.10,     // -10%
    },
    {
      type: 'range',
      durationSec: 300,  // 新区间震荡 5 分钟
      price: 90,
      range: 0.02,
    },
  ],
};

const provider = new SimulatedProvider({
  mode: 'scenario',
  startPrice: 100,
  scenario: customScenario,
  speed: 100,
});
```

---

## 场景阶段类型

### range - 区间震荡

```typescript
{
  type: 'range',
  durationSec: 300,
  price: 100,        // 中心价
  range: 0.02,       // 振幅 ±2%
}
```

### trend - 线性趋势

```typescript
{
  type: 'trend',
  durationSec: 600,
  change: 0.05,      // +5%
}
```

### pump / dump - 快速拉升/砸盘

```typescript
{
  type: 'pump',      // 或 'dump'
  durationSec: 120,
  change: 0.08,      // +8% 或 -8%
}
```

### gap - 跳空缺口

```typescript
{
  type: 'gap',
  durationSec: 1,    // 瞬间
  targetPrice: 85,   // 目标价
}
```

---

## 时间加速说明

| 倍速 | 真实时间 1 秒 = 模拟时间 |
|------|-------------------------|
| 1x   | 1 秒                    |
| 10x  | 10 秒                   |
| 100x | 1.67 分钟               |
| 1000x| 16.67 分钟              |

**示例**：

- 场景总时长 10 分钟
- 100x 加速 → **6 秒**真实运行时间
- 1000x 加速 → **0.6 秒**真实运行时间

---

## 订单成交规则

- **Buy 订单**: 当前价 ≤ 订单价 → 成交
- **Sell 订单**: 当前价 ≥ 订单价 → 成交
- 成交价 = 当前市场价（不是订单价）
- 自动触发 `onOrder` 回调

---

## 单步调试

```bash
# 启用单步模式
bun tests/run-simulated-strategy.ts ./strategies/gales-simple.js \
  --mode sine \
  --step
```

在单步模式下，每次价格更新需要手动触发：

```typescript
provider.pause();
provider.step(); // 执行一次 tick
provider.resume();
```

---

## 工具方法

```typescript
// 获取当前价格
const price = provider.getCurrentPrice();

// 获取配置
const config = provider.getConfig();

// 获取场景阶段信息
const phaseInfo = provider.getPhaseInfo();
console.log(`阶段 ${phaseInfo.index}, 已过 ${phaseInfo.elapsed}s`);

// 暂停/恢复
provider.pause();
provider.resume();

// 停止
provider.stop();
```

---

## 测试验证

```bash
# 运行功能测试
bun tests/test-simulated-provider.ts

# 测试内容：
# ✅ 随机游走模式
# ✅ 正弦波动模式
# ✅ 场景模式
# ✅ 订单成交
# ✅ 时间加速
```

---

## 与真实 Provider 对比

| 特性 | SimulatedProvider | Real Provider |
|------|------------------|---------------|
| 行情速度 | 10x-1000x 加速 | 实时 |
| 订单延迟 | 即时成交 | 网络延迟 |
| 历史数据 | 无需准备 | 需要下载 |
| API 费用 | 无 | 可能有限制 |
| 验证速度 | 秒级 | 小时/天级 |

---

## 使用建议

1. **策略验证**: 优先使用 `SimulatedProvider` 快速验证逻辑
2. **场景覆盖**: 使用内置场景测试边界情况
3. **真实验证**: 通过后再用 `PaperTradingProvider` + 真实行情
4. **实盘前**: 小资金实盘测试

---

## 常见问题

**Q: 为什么价格不完全按场景走？**  
A: 场景中加入了随机噪声，模拟真实市场的不确定性。

**Q: 订单为什么不成交？**  
A: 检查订单价格是否在价格波动范围内。可以降低 `speed` 观察。

**Q: 如何让策略跑得更快？**  
A: 增大 `speed` 参数（推荐 100x-1000x）。

**Q: 场景循环播放吗？**  
A: 是的，场景结束后会自动重新开始。

---

## 路线图

- [ ] 支持多交易对同时模拟
- [ ] 订单簿深度模拟
- [ ] 滑点和手续费模拟
- [ ] 场景可视化工具
- [ ] 场景导入/导出（JSON/YAML）

---

**提示**: 这是一个开发工具，不适用于生产环境。实盘交易请使用真实 Provider。
