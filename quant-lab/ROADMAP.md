# Quant-Lab 开发路线图

> **版本**: v3.0 (2026-02-10)  
> **架构**: Strategy Interface + Backtest/Live Engines

---

## 🎯 当前状态

| 模块 | 完成度 | 说明 |
|------|--------|------|
| **策略接口** | ✅ 100% | Strategy / StrategyContext |
| **回测引擎** | ✅ 100% | BacktestEngine（事件驱动 + 完整指标） |
| **实盘引擎** | ✅ 100% | LiveEngine（WebSocket + Provider + 风控） |
| **Provider 生态** | ⏳ 40% | Paper ✅ / Binance 📝 / Bybit 📝 |
| **测试覆盖** | ⏳ 30% | 基础测试已有，待完善 |
| **文档** | ✅ 80% | README + Provider 指南已有 |

---

## 📋 已完成（2026-02-10）

### Phase 1: 核心引擎 ✅
- [x] Strategy 接口定义
- [x] StrategyContext API
- [x] BacktestEngine 实现
  - [x] 仓位管理（LONG/SHORT/FLAT）
  - [x] 订单执行（MARKET/LIMIT + 手续费 + 滑点）
  - [x] 盈亏跟踪（已实现 + 未实现）
  - [x] 权益曲线记录
  - [x] 回测指标（回报/回撤/夏普/胜率/盈亏比）
- [x] LiveEngine 实现
  - [x] WebSocket 架构
  - [x] Provider 集成
  - [x] 风控管理（最大仓位/回撤限制）
  - [x] 状态持久化（可选 KlineDatabase）

### Phase 2: Provider 生态 ⏳
- [x] TradingProvider 接口定义
- [x] PaperTradingProvider（模拟交易，完整实现）
- [ ] BinanceProvider（框架 + TODO）
- [ ] BybitProvider（框架 + TODO）

### Phase 3: 示例策略 ⏳
- [x] SimpleMAStrategy（双均线交叉）
- [x] 回测测试（backtest-simple-ma.ts）
- [x] 实盘测试（live-paper-trading.ts）
- [ ] 更多策略（网格/马丁/趋势跟踪）

---

## 🔥 待完成任务

### 最高优先级（本周）⭐

#### 1. QuickJS 沙箱策略运行器
**目标**：支持 `.js` 策略文件，提升迭代速度

**核心优势**：
- ✅ 热重载（无需重启引擎）
- ✅ 安全隔离（沙箱运行）
- ✅ 纯 JS（无需编译 TypeScript）
- ✅ 快速迭代（修改策略立即生效）

**实现任务**：
- [x] QuickJS 沙箱初始化（基于 v2.0 架构）✅
- [x] 策略 API 注入（bridge: log/state）✅
- [x] 生命周期适配（onInit/onBar/onTick → st_init/st_heartbeat）✅
- [x] 状态持久化（bridge_stateGet/Set）✅
- [x] 示例策略迁移（Gales.js）✅
- [ ] **完善 bridge_placeOrder**（连接 StrategyContext 真实下单）🔥 进行中
- [ ] **完善 bridge_cancelOrder**（连接真实撤单 API）🔥 进行中
- [ ] **添加 bridge_getPrice**（获取最新价格）🔥 进行中
- [ ] **添加 bridge_getPosition**（获取持仓）🔥 进行中
- [ ] **添加 bridge_getAccount**（获取账户）🔥 进行中
- [ ] 错误隔离与重启（异常捕获 + 自动恢复）

**预估工期**：1-2 天  
**当前进度**：60% → 完善 Bridge API

**参考**：
- `archived/v2.0-director-worker/worker/strategy-loader.ts` - v2.0 实现
- `archived/v2.0-director-worker/strategies/grid-magnet/grid-magnet.js` - 策略示例

---

#### 2. ndtsdb 数据持久化 ⏸️ 延后
**目标**：订单事件 + 盈亏分析 + 回测验证

**实现任务**：
- [ ] 订单事件写入（gales-event → ndtsdb）
- [ ] 策略状态快照（定期持久化）
- [ ] 盈亏分析查询（SQL 聚合）
- [ ] 回测数据对比（paper vs backtest）

**预估工期**：1 天  
**状态**：待 QuickJS 集成完成后推进

**参考**：
- `ndtsdb/` - 时序数据库
- `quant-lib/src/storage/database.ts` - KlineDatabase 示例

---

#### 3. 实盘风控增强 ⏸️ 延后
**目标**：保护实盘资金安全

**实现任务**：
- [ ] 最大回撤限制（实时监控 + 自动停止）
- [ ] 紧急停止机制（Ctrl+C / API 触发）
- [ ] 仓位监控告警（超限推送 Telegram）
- [ ] 订单簿监控（防止异常订单）

**预估工期**：0.5-1 天  
**状态**：待 QuickJS 集成完成后推进

---

### 高优先级（本周）

#### 4. 完善 BinanceProvider / BybitProvider
**目标**：让实盘引擎可连接真实交易所

**待实现**：
- [ ] WebSocket K线订阅
- [ ] REST API 订单执行
- [ ] 账户/持仓查询
- [ ] HMAC SHA256 签名
- [ ] 错误处理 + 重连机制

**预估工期**：1-2 天

**参考**：
- `src/providers/paper-trading.ts` - 实现示例
- `quant-lib/src/providers/binance.ts` - REST API 参考
- `src/providers/README.md` - 实现指南

---

#### 2. 策略库扩展
**目标**：提供更多示例策略

**计划策略**：
- [ ] GridStrategy（网格交易）
- [ ] MartingaleStrategy（马丁格尔）
- [ ] TrendFollowingStrategy（趋势跟踪）
- [ ] MeanReversionStrategy（均值回归）

**预估工期**：每个策略 0.5-1 天

---

#### 3. 测试覆盖
**目标**：提升测试覆盖率

**待补充**：
- [ ] BacktestEngine 单元测试
- [ ] LiveEngine 单元测试
- [ ] Provider 单元测试
- [ ] 集成测试（完整回测 + 实盘流程）
- [ ] 性能测试（10K+ bars 回测）

**预估工期**：2-3 天

---

### 中优先级（下周）

#### 4. 回测结果可视化
**目标**：生成可视化回测报告

**功能**：
- [ ] 权益曲线图
- [ ] 回撤曲线图
- [ ] 交易分布图
- [ ] 月度收益表
- [ ] HTML 报告导出

**技术栈**：Chart.js / D3.js

**预估工期**：2-3 天

---

#### 5. 策略参数优化
**目标**：自动寻找最优策略参数

**功能**：
- [ ] 网格搜索
- [ ] 遗传算法
- [ ] 贝叶斯优化
- [ ] 参数敏感性分析

**预估工期**：3-5 天

---

#### 6. 风控增强
**目标**：更完善的风控系统

**功能**：
- [ ] 单日最大亏损限制
- [ ] 单笔最大亏损限制
- [ ] 持仓时间限制
- [ ] 止损/止盈自动执行
- [ ] 杠杆控制

**预估工期**：2-3 天

---

### 低优先级（后续）

#### 7. 多账户管理
**目标**：支持多个交易所账户

**功能**：
- [ ] 账户池管理
- [ ] 资金分配策略
- [ ] 跨账户风险聚合

**预估工期**：3-5 天

---

#### 8. 实时监控
**目标**：实盘运行监控

**功能**：
- [ ] Prometheus metrics 导出
- [ ] Grafana 仪表盘
- [ ] 告警系统（Telegram/Email）
- [ ] 策略健康检查

**预估工期**：3-5 天

---

#### 9. 策略市场
**目标**：策略分享平台

**功能**：
- [ ] 策略发布/订阅
- [ ] 策略版本管理
- [ ] 策略性能排行榜
- [ ] 策略评论/评分

**预估工期**：1-2 周

---

## 🚀 下一步行动

### 本周（2026-02-10 ~ 2026-02-16）
1. 实现 BinanceProvider / BybitProvider
2. 补充 GridStrategy 示例
3. 完善测试覆盖

### 下周（2026-02-17 ~ 2026-02-23）
4. 回测结果可视化
5. 策略参数优化
6. 风控增强

---

## 📝 架构演进

### v1.0（已弃用）
- 独立 TreeWorkerPool 实现

### v2.0（已归档）
- 基于 workpool-lib + Director + Worker + QuickJS Sandbox
- 复杂三层架构
- **归档位置**：`archived/v2.0-director-worker/`

### v3.0（当前）⭐
- Strategy Interface + Backtest/Live Engines + Providers
- 简洁两层架构
- 统一回测和实盘代码
- **完成日期**：2026-02-10

---

## 🎓 设计决策

### 为什么放弃 v2.0 架构？
1. **复杂度过高**：Director + Worker + QuickJS 三层，维护成本高
2. **文档不一致**：README 与实际代码不一致
3. **调试困难**：QuickJS 沙盒增加调试难度
4. **性能开销**：沙盒序列化/反序列化开销大

### v3.0 架构优势
1. **简洁**：两层架构，易于理解
2. **统一**：回测和实盘使用相同代码
3. **可测试**：标准 TypeScript，易于单元测试
4. **高性能**：无沙盒开销，直接执行

---

## 📊 里程碑

| 版本 | 目标 | 完成日期 |
|------|------|----------|
| v1.0 | 独立实现 | ✅ 已弃用 |
| v2.0 | workpool-lib 集成 | ✅ 已归档（2026-02-10） |
| v3.0 | Strategy Engine | ✅ 2026-02-10 |
| v3.1 | Provider 生态完善 | ⏳ 2026-02-16 |
| v3.2 | 可视化 + 优化 | ⏳ 2026-02-23 |
| v3.3 | 多账户 + 监控 | ⏳ 2026-03-xx |

---

*最后更新: 2026-02-10*  
*维护者: OpenClaw 🦀*
