# 策略开发进化方向思考

**日期**: 2026-02-13  
**作者**: bot-004  
**背景**: GALES 策略稳定运行后，思考下一代策略开发范式

---

## 1. AI 辅助生成策略代码

### 现状
- 手写 JS 策略 → QuickJS 沙箱执行
- 开发者需掌握：网格逻辑、风控、Bridge API、热更新机制
- 门槛较高，策略迭代慢

### 方案：策略生成器 (Strategy Generator)

**输入**:
- 自然语言描述（"做空 MYX，跌 4% 买入，涨 2% 卖出"）
- 历史数据特征（波动率、趋势性）
- 约束条件（最大回撤、仓位上限）

**AI 处理**:
```
llm-cli prompt:
"根据以下需求生成 QuickJS 策略代码：
- 方向: short
- 网格: 非对称 (down=4%, up=2%)
- 风控: maxPosition=100, 熔断 30%
- 模板: gales-simple.js
- 要求: 包含 st_init/st_heartbeat/st_onParamsUpdate"
```

**输出**:
- 完整策略 JS 文件
- 参数说明文档
- 回测建议配置

### 技术可行性
| 组件 | 状态 | 说明 |
|------|------|------|
| LLM 代码生成 | ✅ 成熟 | GPT-4/Claude 可生成可用代码 |
| Prompt 工程 | ⚠️ 需优化 | 需标准化策略模板和约束描述 |
| 代码验证 | ❌ 需建 | 语法检查 + 模拟运行 |
| 人工审核 | ✅ 必须 | AI 生成后需 review |

### 实施路径
1. **P0**: 建立策略模板库（网格/趋势/套利）
2. **P1**: 训练专用 prompt（few-shot 示例）
3. **P2**: 集成到 CLI (`bun tools/generate-strategy.ts --prompt "..."`)
4. **P3**: 自动回测验证生成策略

---

## 2. 策略参数自动优化

### 现状
- 手动调参：gridSpacing/maxPosition 等
- 依赖经验，效率低
- 无法全局搜索最优组合

### 方案：参数优化器 (Param Optimizer)

**算法选择**:

| 算法 | 适用场景 | 复杂度 | 推荐度 |
|------|----------|--------|--------|
| **贝叶斯优化** | 参数维度 < 10 | 中 | ⭐⭐⭐⭐⭐ |
| 遗传算法 | 参数维度 > 10 | 高 | ⭐⭐⭐ |
| 网格搜索 | 参数维度 < 5 | 低 | ⭐⭐ |
| 随机搜索 | 快速探索 | 低 | ⭐⭐⭐ |

**贝叶斯优化流程**:
```python
# 伪代码
from skopt import gp_minimize

def objective(params):
    grid_spacing, max_pos, magnet_dist = params
    result = backtest(
        strategy='gales',
        params={'gridSpacing': grid_spacing, ...},
        data='MYXUSDT-2025-01-01_2025-12-31'
    )
    return -result.sharpe_ratio  # 最大化夏普

optimal = gp_minimize(
    objective,
    dimensions=[
        Real(0.01, 0.05, name='gridSpacing'),
        Integer(50, 200, name='maxPosition'),
        Real(0.003, 0.01, name='magnetDistance'),
    ],
    n_calls=50,
    n_random_starts=10
)
```

### 技术可行性
- ✅ 回测引擎已有（SimulatedProvider）
- ✅ 并行计算：可用 workerpool-lib
- ⚠️ 评估指标：需标准化（夏普/最大回撤/胜率）
- ❌ 过拟合风险：需 out-of-sample 验证

### 实施路径
1. **P0**: 定义优化目标和约束（夏普 > 1.5，回撤 < 20%）
2. **P1**: 集成 scikit-optimize 或 Optuna
3. **P2**: CLI 工具 (`bun tools/optimize-params.ts --strategy gales`)
4. **P3**: 自动上线最优参数（需风控审批）

---

## 3. 多策略协同

### 现状
- 一个币一个策略
- 手动切换方向（long/short/neutral）
- 无法并行运行多个策略

### 方案：策略组合器 (Strategy Ensemble)

**架构**:
```
EnsembleManager
├── Strategy A: 趋势跟踪 (MA交叉)
├── Strategy B: 均值回归 (网格)
├── Strategy C: 动量突破 (布林带)
└── Allocator: 资金分配 + 信号融合
```

**信号融合策略**:

| 策略 | 信号 | 权重 | 仓位 |
|------|------|------|------|
| A (趋势) | LONG | 0.4 | 40% |
| B (网格) | NEUTRAL | 0.3 | 30% |
| C (动量) | LONG | 0.3 | 30% |
| **融合** | **LONG** | **1.0** | **70%** |

**自动切换逻辑**:
```javascript
// 基于波动率切换
if (volatility > 0.8) {
  activeStrategy = 'grid-wide';  // 宽网格
} else if (trend > 0.7) {
  activeStrategy = 'trend-follow';  // 趋势跟踪
} else {
  activeStrategy = 'grid-narrow';  // 窄网格
}
```

### 技术可行性
- ✅ QuickJS 沙箱支持多实例
- ✅ 资金分配可通过 positionNotional 控制
- ⚠️ 信号冲突：需定义优先级/融合规则
- ❌ 复杂度：组合爆炸（n 个策略 → 2^n 种状态）

### 实施路径
1. **P0**: 单币多策略并行测试
2. **P1**: 定义信号融合规则（投票/加权）
3. **P2**: 自动切换策略（基于市场状态）
4. **P3**: 跨币种策略组合（组合优化）

---

## 4. 策略回测 Pipeline CLI

### 现状
- 回测代码分散（tests/run-simulated-strategy.ts）
- 每次手动改参数
- 结果不持久化

### 方案：回测 CLI 工具

**命令设计**:
```bash
# 回测单个策略
bun quant-lab backtest \
  --strategy ./strategies/gales.js \
  --data MYXUSDT-1h-2024.parquet \
  --params '{"gridSpacing":0.02}' \
  --output ./results/gales-backtest-2024.json

# 批量参数扫描
bun quant-lab backtest \
  --strategy ./strategies/gales.js \
  --data MYXUSDT-1h-2024.parquet \
  --param-scan '{"gridSpacing":[0.01,0.02,0.03]}' \
  --parallel 4

# 生成报告
bun quant-lab report \
  --input ./results/gales-backtest-2024.json \
  --output ./reports/gales-2024.html
```

**Pipeline 流程**:
```
策略代码 → 编译 → 加载历史数据 → 执行回测 → 计算指标 → 生成报告
```

**输出指标**:
- 收益率、夏普比率、最大回撤
- 胜率、盈亏比、交易次数
- 资金曲线、回撤曲线
- 参数敏感性分析

### 技术可行性
- ✅ SimulatedProvider 可作为回测引擎
- ✅ ndtsdb 可存储历史数据
- ⚠️ 数据格式：需标准化（Parquet/CSV）
- ⚠️ 性能：大数据量需优化

### 实施路径
1. **P0**: 封装现有回测逻辑为 CLI
2. **P1**: 集成指标计算（收益率/夏普等）
3. **P2**: 报告生成（JSON → HTML/图表）
4. **P3**: 批量回测 + 参数优化集成

---

## 优先级建议

| 方向 | 价值 | 难度 | 优先级 | 预计工时 |
|------|------|------|--------|----------|
| AI 辅助生成 | 高 | 中 | P1 | 3-5 天 |
| 参数自动优化 | 高 | 中 | P1 | 3-5 天 |
| 回测 CLI | 高 | 低 | P0 | 2-3 天 |
| 多策略协同 | 中 | 高 | P2 | 5-7 天 |

**推荐执行顺序**:
1. 先建回测 CLI（基础设施）
2. 再搞参数优化（基于回测）
3. 然后 AI 生成（基于模板）
4. 最后多策略（最复杂）

---

## 附录：参考技术栈

| 组件 | 推荐方案 |
|------|----------|
| LLM 代码生成 | Claude 3.5 / GPT-4 + prompt 工程 |
| 参数优化 | Optuna / scikit-optimize |
| 回测引擎 | SimulatedProvider + ndtsdb |
| 并行计算 | workerpool-lib |
| 报告生成 | ECharts / D3.js |
| 数据格式 | Parquet (duckdb) |

---

**结论**: 四个方向都有价值，建议先做回测 CLI（基础），再并行推进 AI 生成和参数优化。

—— bot-004 (2026-02-13)
