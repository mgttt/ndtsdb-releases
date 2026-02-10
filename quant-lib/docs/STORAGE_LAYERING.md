# Storage Layering & Responsibility Boundaries

这份文档的目标是把 **ndtsdb（引擎）** 与 **quant-lib（应用封装）** 的职责边界隔离到足够清晰：

- ndtsdb 会被作为第一轮发布产品（同步到 `ndtsdb-release`），因此 ndtsdb 的文档/roadmap 必须保持“引擎视角”。
- quant-lib 承担所有“业务便利 API / 兼容层 / Provider / 缓存 / 迁移脚本”等集成层工作。

---

## 1. 分层结构

```
┌───────────────────────────────────────────────┐
│                Application / Strategy         │
│        (quant-lab / scripts / services)       │
└───────────────────────────────────────────────┘
                    ▲
                    │ (business API)
┌───────────────────────────────────────────────┐
│                 quant-lib                     │
│  Provider 接口 / DatabaseFactory / Cache      │
│  + 业务便利封装（如 KlineDatabase facade）     │
└───────────────────────────────────────────────┘
                    ▲
                    │ (engine API)
┌───────────────────────────────────────────────┐
│                   ndtsdb                      │
│  AppendWriter / ColumnarTable / SQLExecutor   │
│  + 可选 native(libndts) 加速                   │
└───────────────────────────────────────────────┘
```

---

## 2. ndtsdb（引擎）负责什么

- **存储**：Append-only 文件格式、CRC 校验、读写基础设施
- **列式内存表**：ColumnarTable（用于 SQL / CTE / materialize / 临时计算）
- **分析能力**：SQL 子集、聚合/窗口函数、SAMPLE BY / OHLCV 等
- **性能与可移植性**：libndts（可选）+ JS fallback

> 引擎的 scope/non-goals：见 `ndtsdb/docs/SCOPE.md`（引擎仓库发布文档）。

---

## 3. quant-lib（应用封装层）负责什么

### 3.1 Provider & Factory
- 统一 `DatabaseProvider` 接口（duckdb/ndtsdb/memory 等实现）
- `DatabaseFactory`：按场景选择读写 Provider（可选智能切换）

### 3.2 业务便利 API（Facade）
- **KlineDatabase**：历史遗留的业务封装类，上层（如 SmartKlineCache）直接依赖。
  - 它属于 **quant-lib**，不是 ndtsdb 的一部分。
  - 兼容性修复（connect/upsert/getLatest* 等）应在 quant-lib 完成。

### 3.3 缓存/增量策略
- SmartKlineCache：增量拉取、缓存命中统计
- 调度策略（定时任务、优先级采集、额度分配等）

### 3.4 业务语义统一（非常重要）
- **timestamp 单位**：全链路统一为 **Unix 秒**
  - 对外 API（如 Binance REST）由 Provider 内部做秒↔毫秒转换
- symbol 规范化：BTC/USDT、AAPL/USD 等
- interval/bucket 的业务定义（交易时区、交易日等）

---

## 4. 约束：什么不应该回灌到 ndtsdb

以下内容即使“看起来和数据库有关”，也应留在 quant-lib/上层：

- Provider 选择策略、缓存策略、业务接口兼容层
- timestamp 语义/时区/交易日等业务规则
- 迁移脚本/导入导出工具链（除非明确做成 ndtsdb 的独立工具产品）

原因：这些会引入业务耦合，破坏 ndtsdb 作为“可发布引擎”的独立性与稳定性。

---

## 5. 推荐用法（新代码）

- **新代码**优先依赖 `DatabaseProvider` / `DatabaseFactory`
- 仅在 legacy 代码需要时使用 `KlineDatabase`

这可以让“引擎升级 / Provider 替换 / 多库并行”变得更简单。
