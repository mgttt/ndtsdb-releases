# ndtsdb SQL 功能评估报告

**评估时间**: 2026-02-09
**评估对象**: 下游应用的 SQL 需求 vs ndtsdb 当前实现

---

## 1. 当前已实现功能

### 1.1 解析器 (parser.ts)

| 功能 | 状态 | 说明 |
|------|------|------|
| SELECT | ✅ | 支持列选择、*通配符 |
| FROM | ✅ | 单表查询 |
| WHERE | ✅ | 多条件 AND/OR，比较运算符 |
| ORDER BY | ✅ | 支持 ASC/DESC |
| LIMIT/OFFSET | ✅ | 结果限制 |
| GROUP BY | ✅ | 基础分组聚合 |
| INSERT | ✅ | 批量插入 |
| UPSERT | ✅ | INSERT ON CONFLICT / UPSERT INTO |
| CREATE TABLE | ✅ | 建表 |

### 1.2 执行器 (executor.ts) - 已支持的聚合/窗口函数

| 函数 | 类型 | 状态 | 说明 |
|------|------|------|------|
| COUNT | 聚合 | ✅ | count(*) / count(col) |
| SUM | 聚合 | ✅ | 数值求和 |
| AVG | 聚合 | ✅ | 平均值 |
| MIN/MAX | 聚合 | ✅ | 最值 |
| FIRST/LAST | 聚合 | ✅ | 首尾值 |
| VARIANCE/VAR | 聚合 | ✅ | 样本方差 |
| STDDEV/STD | 聚合 | ✅ | 样本标准差 |
| STDDEV | 窗口 | ✅ | ROWS BETWEEN 窗口 |
| ROW_NUMBER | 窗口 | ✅ | 行号 |
| COUNT | 窗口 | ✅ | 窗口计数 |
| SUM/AVG/MIN/MAX | 窗口 | ✅ | 基础窗口聚合 |

---

## 2. 需求缺口分析

### 2.1 🔴 高优先级缺失（阻塞现有功能）

#### 2.1.1 CTE (WITH 子句)

**需求来源**: 下游“波动率/指标计算”的典型 SQL 模式（CTE + 窗口函数）

```sql
WITH periods AS (
  SELECT 
    base_currency,
    quote_currency,
    STDDEV(close) OVER (...) as vol_1d,
    ...
  FROM klines
  WHERE ...
)
SELECT ... FROM periods WHERE rn = 1
```

**当前状态**: ✅ 已支持
**实现方式**: 执行器会将每个 CTE 查询结果 materialize 成临时表，再执行主查询。
- 支持 CTE 引用前面定义的 CTE
- 临时表支持 string 列（用于 `||`、多列 IN 等）
- 但二进制持久化 `saveToFile/loadFromFile` 暂不支持 string（CTE 场景不需要）

---

#### 2.1.2 PARTITION BY (窗口函数分区)

**需求来源**: 下游“多分区窗口计算”（PARTITION BY + ORDER BY + ROWS frame）

```sql
STDDEV(close) OVER (
  PARTITION BY base_currency, quote_currency  -- ❌ 不支持
  ORDER BY timestamp 
  ROWS BETWEEN 96 PRECEDING AND CURRENT ROW
)
```

**当前状态**: ✅ 已支持
- executor 有 `parsePartitionBy` 方法
- 通用路径 `computeWindowColumn` 支持 PARTITION BY
- **新增** `tryExecutePartitionTail` 快速路径：专门优化 CTE + PARTITION BY + ROW_NUMBER + WHERE rn=1 模式（波动率脚本典型查询），避免全表物化
- **新增** Inline Window 支持：表达式中嵌套窗口函数如 `STDDEV(close) OVER (...) / price * 100`

---

#### 2.1.3 多列 IN 子句

**需求来源**: 下游“多标的筛选”常用写法（tuple IN）

```sql
WHERE (base_currency, quote_currency) IN (('AAPL', 'USD'), ('TSLA', 'USD'))
```

**当前状态**: ✅ 已支持
**说明**: 已支持元组 IN：`(a,b) IN ((1,2),(3,4))`（字符串/数字均可，取决于列类型）

---

### 2.2 🟡 中优先级缺失（影响易用性）

#### 2.2.1 字符串拼接运算符

**需求来源**: 下游 symbol 格式化（base/quote 拼接）

```sql
SELECT base_currency || '/' || quote_currency as symbol
```

**当前状态**: ✅ 已支持 `||` 运算符（SQLite 风格）

---

#### 2.2.2 ROUND 函数

**需求来源**: 下游指标输出格式化（ROUND/百分比等）

```sql
ROUND(vol_1d / price * 100, 2) as vol_1d_pct
```

**当前状态**: ✅ 已支持

---

#### 2.2.3 SQRT 函数

**需求来源**: 下游归一化表达式（/ SQRT(n) 等）

```sql
STDDEV(close) OVER (...) / SQRT(1)
```

**当前状态**: ✅ 已支持

---

### 2.3 🟢 低优先级缺失（锦上添花）

#### 2.3.1 JOIN (表连接)

**当前状态**: ❌ 不支持
**影响**: 无法多表关联查询
**评估**: 当前典型场景多为单表时序数据，JOIN 需求不强烈

#### 2.3.2 子查询 (Subquery)

**当前状态**: ❌ 不支持
**影响**: WHERE col IN (SELECT ...) 等写法不可用
**Workaround**: 应用层分步查询

#### 2.3.3 HAVING 子句

**当前状态**: ❌ 不支持
**影响**: GROUP BY 后无法过滤聚合结果

---

## 3. 结论

ndtsdb SQL 目前定位为 **SQLite/DuckDB 常用子集**，优先覆盖“单表时序分析 + 常见窗口/聚合 + 轻量表达式计算”的需求。

### 3.1 当前 SQL 能力评估（引擎视角）

| 维度 | 评分 | 说明 |
|------|------|------|
| 基础查询 | ⭐⭐⭐⭐⭐ | SELECT/WHERE/ORDER BY/LIMIT/OFFSET |
| 聚合查询 | ⭐⭐⭐⭐ | COUNT/SUM/AVG/MIN/MAX/STDDEV/VARIANCE/FIRST/LAST |
| 窗口函数 | ⭐⭐⭐⭐ | PARTITION BY + ROWS frame；并包含针对“取每分区最后一行”的 fast-path |
| 复杂查询 | ⭐⭐ | 暂无 JOIN/子查询/HAVING |
| 函数/表达式 | ⭐⭐⭐ | 基础算术、`||`、ROUND/SQRT 等常用函数 |

### 3.2 不在引擎评估范围内

- 下游应用如何封装 Provider/业务封装层/缓存/迁移脚本
- 具体脚本的迁移策略与业务语义（timestamp 单位、symbol 规范化等）

这些内容应由上层库文档承载，不应写入 ndtsdb 发布文档。
