# ndtsdb Scope / Non-Goals

ndtsdb 是一个**嵌入式**时序/列式存储与分析引擎，目标是：
- 以极低依赖与高吞吐写入（append-only）保存时序数据
- 以列式 + 窗口/聚合等能力支持常见分析计算
- 作为下游应用/库的底座（SDK/库内嵌使用），而不是一个“业务数据库产品套件”

## ✅ ndtsdb 负责什么（In Scope）

### 1) 存储引擎
- AppendWriter：chunked append-only 文件格式、CRC 校验
- ColumnarTable：内存列式表、基础列操作
- SymbolTable：字符串→整数的字典编码器（引擎工具能力）

### 2) 查询/分析
- SQL 子集（解析器 + 执行器）
- 常用聚合/窗口函数（STDDEV/VARIANCE/ROW_NUMBER 等）
- SAMPLE BY / OHLCV / moving average 等时序查询扩展

### 3) 跨平台/性能
- 可选 native 加速（libndts），并提供 JS fallback

## ❌ ndtsdb 不负责什么（Out of Scope / Non-Goals）

以下内容属于**上层应用封装**（例如各类业务库/应用）应处理的职责：

### A) 业务封装与兼容层
- 面向业务的便利 API（兼容旧接口、补齐缺失方法）
- 缓存策略、增量拉取策略、采集调度
- 各交易所/数据源 Provider（Binance/Bybit/Futu/TradingView…）

### B) 数据模型语义
- timestamp 单位/语义的统一（秒 vs 毫秒）
- interval/bucket 的业务含义（1m/15m/1d 的定义、交易日/时区等）
- symbol 规范化（BTC/USDT vs BTCUSDT、AAPL/USD 等）

### C) 运维与产品化套件
- 任务调度（cron/systemd timers）
- CI/CD、发布流水线
- “一键迁移工具链”（从 DuckDB 等外部 DB 导入/导出）的产品化

## 边界原则

- ndtsdb 应保持“底座”属性：**小而硬**、接口稳定、避免引入业务耦合。
- 上层库可以自由封装出更符合业务的 API；但该封装不应回灌到 ndtsdb。
