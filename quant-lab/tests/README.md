# quant-lab/tests

这里放的是 **Bun 可直接运行的测试/验证脚本**（很多是 smoke / regression / 手动验证，不是严格意义的单元测试框架）。

## 运行约定

- 推荐从仓库根目录执行（`/home/devali/moltbaby`）：
  - `bun quant-lab/tests/<file>.ts`
- 部分脚本假设工作目录是 `quant-lab/`（README 里单独标注）。
- `live/*` 与部分脚本会访问 **真实交易所 / 真实账号**，必须人工确认 + 盯盘。

## 目录

- `e2e/`：Director → Pool → Worker → Strategy 的端到端联通测试
- `live/`：真实账号/真实环境测试（高风险，手动）
- `archived/`：历史脚本（不再维护，仅保留参考）

---

## 测试清单（用途 + 状态）

### 回测 / 性能

- `backtest-simple-ma.ts`
  - 用途：回测引擎最小样例（双均线策略）
  - 状态：✅ active（示例/回归用）

- `parallel-backtest.ts`
  - 用途：并行回测/调参性能验证（StrategyScheduler）
  - 状态：✅ active（性能/压测性质，手动跑）

### Provider / 交易所连通

- `bybit-live-smoke.ts`
  - 用途：BybitProvider REST smoke（余额/持仓/下单前检查）
  - 依赖：`~/.config/quant-lab/accounts.json`
  - 状态：✅ active（手动）

### QuickJS / 沙箱 / 策略执行

- `test-quickjs-sandbox.ts`
  - 用途：QuickJS VM 基础能力验证（bridge 注入、执行）
  - 状态：✅ active

- `test-quickjs-gales.ts`
  - 用途：QuickJS Gales 策略在 PaperTradingProvider 上跑通
  - 状态：✅ active（手动）

- `test-param-hot-update.ts`
  - 用途：策略参数热更新验证（QuickJSStrategy）
  - 状态：✅ active

- `run-simulated-strategy.ts`
  - 用途：用 SimulatedProvider 跑任意 QuickJS 策略（支持内置 scenario / random-walk / sine / step）
  - 状态：✅ active（开发调试工具）

- `run-strategy-generic.ts`
  - 用途：通用策略启动器（paper / demo / live），用于快速验证策略文件
  - 状态：✅ active（开发/运维工具）

### SimulatedProvider 功能回归

- `test-simulated-provider.ts`
  - 用途：SimulatedProvider 各模式（random-walk 等）功能测试
  - 状态：✅ active

- `test-autorecenter.ts`
  - 用途：autoRecenter 场景验证（快速下跌触发）
  - 状态：✅ active

- `test-asymmetric-grid.ts`
  - 用途：非对称网格行为验证（不同方向不同间距/金额）
  - 状态：✅ active

### PaperTrade / 下单链路回归

- `test-cancel-pending.ts`
  - 用途：P0 回归：cancelOrder 对 pending 订单的保护逻辑（防止误撤单/误发API）
  - 状态：✅ active（回归脚本）

- `test-papertrade-p0-fixes.ts`
  - 用途：P0 修复“核对清单”（通过 pattern 扫描代码验证关键修复点仍在）
  - 备注：会读取 `tests/archived/run-gales-quickjs-bybit.ts`
  - 状态：✅ active（但属于“静态核对”，不是端到端执行）

### LiveEngine（非真实交易所 / Paper）

- `live-simple-ma.ts`
  - 用途：LiveEngine + 简单双均线策略的最小跑通（不连真实交易所）
  - 状态：✅ active（示例/回归）

- `live-paper-trading.ts`
  - 用途：LiveEngine + PaperTradingProvider 跑策略（模拟交易）
  - 状态：✅ active

### 实盘 / 高风险（必须人工确认）

- `run-gales-live.ts`
  - 用途：GalesStrategy + BybitProvider 实盘启动脚本
  - 状态：⚠️ active（高风险，必须盯盘）

- `live/run.ts`
  - 用途：真实账号最小金额测试（含 `--yes` 确认门槛）
  - 状态：⚠️ active（高风险，必须盯盘）

### E2E

- `e2e/run.ts`
  - 用途：端到端：Director → Pool → Worker → Strategy
  - 状态：✅ active

- `e2e-test.sh`
  - 用途：E2E 测试套件脚本（curl 健康检查/任务触发/多 worker）
  - 状态：✅ active

### 工具类 / 数据

- `generate-test-data.ts`
  - 用途：生成测试用 K 线数据（BTC/USDT 1d 365 bars）
  - 状态：✅ active

- `test-strategy-cli-sim.ts`
  - 用途：验证 `quant-lab/tools/strategy-cli.ts sim` 子命令（帮助/参数校验等）
  - 状态：✅ active

- `validation-log-20260211.md`
  - 用途：历史验证日志（不是可执行测试）
  - 状态：🗄️ archived

### archived/

- `archived/run-gales-quickjs-bybit.ts`
  - 用途：QuickJS 沙箱 + Bybit 实盘（早期“独立简化版”集成）
  - 状态：🗄️ archived（保留参考；同时被 `test-papertrade-p0-fixes.ts` 用作静态核对对象）
