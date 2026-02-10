# ndtsdb Features

> ndtsdb 的 scope / non-goals：见 `docs/SCOPE.md`。

本文档列出 **ndtsdb 引擎本体**已具备的主要能力（用于发布仓库/产品说明）。

---

## 1. Storage Engine

### AppendWriter (DLv2)
- chunked append-only
- header + per-chunk CRC32
- reopen & append 无需重写
- **rewrite/compact**：`rewrite/deleteWhere/updateWhere`（写 tmp + 原子替换）

### ColumnarTable
- 内存列式表
- 数值列使用 TypedArray
- **string 列仅内存可用**（用于 SQL/CTE/materialize）；二进制持久化暂不支持

### SymbolTable
- 字典编码：string → int

---

## 2. Query / Analytics

### 2.1 SQL 子集

- SELECT / FROM（单表 + JOIN）
- WHERE（括号优先级 + AND/OR/NOT；基础比较 + LIKE + IN）
- JOIN（INNER/LEFT；ON 目前支持等值 + AND 链）
- ORDER BY（列名 / alias / ordinal(ORDER BY 1) / 标量表达式；多 key 支持 ASC/DESC）
- LIMIT / OFFSET
- GROUP BY（基础聚合）
- HAVING（GROUP BY 后过滤；支持 alias/标量表达式条件）
- CTE / WITH（materialize 临时表）
- 子查询（FROM (SELECT ...) 派生表；WHERE col IN (SELECT ...)）
- CREATE TABLE / INSERT / UPSERT

### 2.2 标量表达式（SQLite/DuckDB 常用子集）

- 运算符：`+ - * / %`、括号
- 字符串拼接：`||`
- 常用函数：`ROUND/SQRT/ABS/LN/LOG/EXP/POW(MIN/MAX)`

### 2.3 窗口函数

支持 `... OVER (PARTITION BY ... ORDER BY ... ROWS BETWEEN N PRECEDING AND CURRENT ROW)`：
- `STDDEV/VARIANCE`
- `COUNT/SUM/AVG/MIN/MAX`
- `ROW_NUMBER`

#### Inline Window
- 支持表达式中嵌套窗口函数，例如：
  - `STDDEV(close) OVER (...) / price * 100`

#### PARTITION BY fast-path
- 专门优化模式：`CTE + PARTITION BY + ROW_NUMBER + WHERE rn = 1`
- 用于“每分区只取最后一行 + 多个窗口指标”的典型时序报表场景

---

## 3. Time-series Extensions

- `sampleBy()` / `ohlcv()`
- `latestOn()`
- `movingAverage()` / `exponentialMovingAverage()` / `rollingStdDev()`

---

## 4. Native Acceleration (libndts)

- 可选 native 加速（8 平台预编译）
- 自动 JS fallback（无原生库/非 Bun 环境也可运行）

---

## 5. Not Yet (Planned)

- tombstone/增量 compact（避免全量重写；可选）
- 二级索引（BTree 等）
- string 持久化（透明字典编码/变长编码）
