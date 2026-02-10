# ndtsdb SQL 功能评估报告

**评估时间**: 2026-02-09
**评估对象**: quant-lib + quant-lab 的 SQL 需求 vs ndtsdb 当前实现

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

**需求来源**: `futu-positions-volatility.ts:183-220`

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

**需求来源**: `futu-positions-volatility.ts:190-215`

```sql
STDDEV(close) OVER (
  PARTITION BY base_currency, quote_currency  -- ❌ 不支持
  ORDER BY timestamp 
  ROWS BETWEEN 96 PRECEDING AND CURRENT ROW
)
```

**当前状态**: ⚠️ 部分支持
- executor 有 `parsePartitionBy` 方法
- 但 `tryExecuteTailWindow` 快速路径会拒绝带 PARTITION BY 的查询
- 通用路径 `computeWindowColumn` 支持 PARTITION BY

**问题**: 快速路径与通用路径行为不一致，导致部分查询失败
**建议**: 统一处理逻辑，确保 PARTITION BY 在所有场景可用

---

#### 2.1.3 多列 IN 子句

**需求来源**: `futu-positions-volatility.ts:225`

```sql
WHERE (base_currency, quote_currency) IN (('AAPL', 'USD'), ('TSLA', 'USD'))
```

**当前状态**: ✅ 已支持
**说明**: 已支持元组 IN：`(a,b) IN ((1,2),(3,4))`（字符串/数字均可，取决于列类型）

---

### 2.2 🟡 中优先级缺失（影响易用性）

#### 2.2.1 字符串拼接运算符

**需求来源**: `futu-positions-volatility.ts:235`

```sql
SELECT base_currency || '/' || quote_currency as symbol
```

**当前状态**: ✅ 已支持 `||` 运算符（SQLite 风格）

---

#### 2.2.2 ROUND 函数

**需求来源**: `futu-positions-volatility.ts:236-241`

```sql
ROUND(vol_1d / price * 100, 2) as vol_1d_pct
```

**当前状态**: ✅ 已支持

---

#### 2.2.3 SQRT 函数

**需求来源**: `futu-positions-volatility.ts:192`

```sql
STDDEV(close) OVER (...) / SQRT(1)
```

**当前状态**: ✅ 已支持

---

### 2.3 🟢 低优先级缺失（锦上添花）

#### 2.3.1 JOIN (表连接)

**当前状态**: ❌ 不支持
**影响**: 无法多表关联查询
**评估**: quant-lib 当前场景多为单表时序数据，JOIN 需求不强烈

#### 2.3.2 子查询 (Subquery)

**当前状态**: ❌ 不支持
**影响**: WHERE col IN (SELECT ...) 等写法不可用
**Workaround**: 应用层分步查询

#### 2.3.3 HAVING 子句

**当前状态**: ❌ 不支持
**影响**: GROUP BY 后无法过滤聚合结果

---

## 3. 现有功能验证

### 3.1 calculate-volatility.ts 兼容性 ✅

该脚本已改为使用 ndtsdb SQL:

```typescript
const sql = `SELECT
  close AS price,
  STDDEV(close) OVER (ORDER BY timestamp ROWS BETWEEN 96 PRECEDING AND CURRENT ROW) AS std_1d,
  ...
FROM klines
ORDER BY timestamp DESC
LIMIT 1`;
```

**验证结果**: ✅ 完全兼容
- 无 PARTITION BY
- 无 CTE
- 单表查询
- 使用已支持的窗口函数

### 3.2 futu-positions-volatility.ts 兼容性 ❌

该脚本仍使用 DuckDB SQL，包含不兼容特性:

| 特性 | 状态 | 影响 |
|------|------|------|
| CTE (WITH) | ✅ | 可直接按 DuckDB 风格写分层查询 |
| PARTITION BY | ⚠️ | 行为不一致，需验证 |
| 多列 IN | ✅ | 支持 (a,b) IN ((..),(..)) |
| 字符串拼接 || | ✅ | 已支持 |
| ROUND | ✅ | 已支持 |

---

## 4. 迁移建议

### 4.1 短期方案（立即可用）

将 `futu-positions-volatility.ts` 改写为 ndtsdb 兼容的 SQL:

```typescript
// 原 SQL（DuckDB）
const query = `
  WITH periods AS (...)
  SELECT ... FROM periods WHERE rn = 1
`;

// 新方案（ndtsdb 兼容）
// 1. 逐个 symbol 查询（避免 PARTITION BY）
// 2. 仍可使用 ROUND/SQRT/字符串拼接（SQL 层已支持）
// 3. 应用层过滤 rn = 1（取最后一条）

for (const symbol of symbols) {
  const sql = `
    SELECT 
      close as price,
      STDDEV(close) OVER (ORDER BY timestamp ROWS BETWEEN 96 PRECEDING AND CURRENT ROW) as std_1d,
      ...
    FROM klines
    WHERE symbol = '${symbol}'
    ORDER BY timestamp DESC
    LIMIT 1
  `;
  // 应用层计算标准化波动率
}
```

### 4.2 中期方案（需要开发）

按优先级实现缺失功能:

| 优先级 | 功能 | 工作量 | 指派 |
|--------|------|--------|------|
| 🔴 高 | ~~CTE (WITH)~~ ✅ | 已完成 | bot-001 |
| 🔴 高 | ~~多列 IN~~ ✅ | 已完成 | bot-001 |
| 🔴 高 | PARTITION BY 统一 | 1天 | bot-007 |
| 🟡 中 | ~~ROUND~~ ✅ | 已完成 | bot-001 |
| 🟡 中 | ~~字符串拼接 \|\|~~ ✅ | 已完成 | bot-001 |
| 🟢 低 | ~~SQRT~~ ✅ | 已完成 | bot-001 |
| 🟢 低 | JOIN | 3-5天 | 待定 |

---

## 5. 结论

### 5.1 当前 SQL 能力评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 基础查询 | ⭐⭐⭐⭐⭐ | SELECT/WHERE/ORDER BY/LIMIT 完善 |
| 聚合查询 | ⭐⭐⭐⭐ | COUNT/SUM/AVG/MIN/MAX/STDDEV 支持 |
| 窗口函数 | ⭐⭐⭐ | 基础窗口支持，缺 PARTITION BY 优化 |
| 复杂查询 | ⭐⭐ | 无 CTE/子查询/JOIN |
| 函数库 | ⭐⭐ | 仅聚合函数，缺数学/字符串函数 |

### 5.2 quant-lib 迁移状态

| 脚本 | 状态 | 说明 |
|------|------|------|
| `calculate-volatility.ts` | ✅ 已迁移 | 使用 ndtsdb SQL |
| `futu-positions-volatility.ts` | ❌ 未迁移 | 仍依赖 DuckDB，需改写或增强 ndtsdb |

### 5.3 最终建议

1. **短期**: 改写 `futu-positions-volatility.ts` 为 ndtsdb 兼容 SQL（逐个 symbol 查询）
2. **中期**: 统一/优化 PARTITION BY（尤其是与 fast-path 的一致性）
3. **长期**: 根据实际需求决定是否实现 JOIN/子查询

ndtsdb SQL 当前能力**基本满足**简单时序分析场景，但**不足以支持**复杂的多表/多层分析查询。
