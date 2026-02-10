# ndtsdb Roadmap

## 现状总结 (2026-02-10)

**核心已完成** - 从零到一个功能完整的高性能多维时序数据库。

### 迁移中暴露的引擎限制（仅记录 *引擎* 侧问题）

> ndtsdb 的职责边界与非目标见：`docs/SCOPE.md`。

从典型时序场景迁移/落地过程中，和"引擎本体"强相关的限制：

| 限制 | 影响 | 当前方案 | 状态 |
|------|------|----------|------|
| ~~Append-only 写入~~ | ~~无法原地 DELETE/UPDATE~~ | ✅ Tombstone 软删除 + 自动 compact（延迟清理 + 文件重写） | ✅ **已解决** |
| ~~有限 SQL 支持~~ | ~~JOIN、子查询、复杂 WHERE 覆盖不足~~ | ✅ JOIN/子查询/HAVING/复杂 WHERE（括号优先级）/ORDER BY expr | ✅ **已解决** |
| ~~无二级索引~~ | ~~范围查询/复合过滤退化为全表扫描~~ | ✅ BTree 二级索引 + 复合索引（自动维护 + SQL planner 自动优化） | ✅ **已解决** |
| ~~字符串持久化~~ | ~~string 仅内存可用~~ | ✅ 字典编码（string → int32 id，header.stringDicts 固定空间） | ✅ **已解决** |
| **无事务支持** | 无 ACID/WAL | CRC + 原子重写（未来 WAL） | 🟡 **计划中** |

> ⚠️ 诸如 Provider/业务封装/缓存/时间戳单位等"集成层/业务层"议题，**不在 ndtsdb roadmap** 内，应由上层应用库负责。

---

| 能力 | 实现 | 性能 |
|------|------|------|
| 列式存储 | ColumnarTable, 8 字节对齐 | 6.9M writes/s |
| 增量写入 | AppendWriter, DLv2 chunked 格式 | 3.3M rows/s |
| 完整性校验 | CRC32 header + per-chunk | ✅ |
| C SIMD (libndts) | 8 平台预编译 (Zig CC) | 143M rows/s |
| Gorilla 压缩 | Delta-of-Delta + XOR | 70-95% |
| SQL | 递归下降解析器 + 窗口函数 + GROUP BY | 5.9M rows/s |
| 索引 | Roaring Bitmap + B-Tree | ✅ |
| mmap 回放 | MinHeap O(log N) 多路归并 | 1.0M ticks/s @ 3000 |
| ASOF JOIN | 点查 + snapshot 回放 | <12ms @ 3000 |
| SAMPLE BY | 时间桶聚合 + OHLCV | 11.7M rows/s |
| LATEST ON | 每个 symbol 最新值 | ✅ |
| 窗口函数 | SMA / EMA / StdDev | 82-102M rows/s |
| 并行查询 | Promise.all 多分区 | ✅ |
| 云存储 | S3/MinIO 接口 | 接口层 |
| 导出 | 38 个 API 统一 index.ts | ✅ |

**代码量**: ~5600 行 TypeScript + 100 行 C

---

## 下一步方向

> 已完成功能详见 `docs/FEATURES.md`

### 📋 Benchmark 发现的问题（2026-02-10）

> 来源：`ndtsdb/scripts/benchmark-compare.ts` 测试过程

| 问题 | 影响 | 优先级 | 状态 |
|------|------|--------|------|
| **AVG() 函数未实现** | SQL 无法计算平均值 | 🔴 高 | 待修复 |
| **COUNT(*) 语法不支持** | 无法统计行数 | 🔴 高 | 待修复 |
| **SUM() 函数未实现** | SQL 无法求和 | 🔴 高 | 待修复 |
| **全表聚合性能低** | 100K 行聚合 ~477ms（2 ops/sec） | 🟡 中 | 待优化 |

**修复建议**：
1. `sql/executor.ts` 的 `evalNode` 函数需要添加 AVG/SUM/COUNT 支持
2. COUNT(*) 需要特殊处理（当前 parser 不支持 `*` 作为函数参数）
3. 聚合性能优化：考虑使用 FFI 加速或提前终止

---

### 🔵 进行中（2026-02-10）

**并发推进计划** - 两条线同时进行：

#### 线程 A：测试增强（bot-007）⏳
**任务卡**: `tasks/assigned/bot-007-ndtsdb-testing-enhancement.md`

- [ ] A1: 压缩功能测试增强（大规模/边界情况/兼容性）
- [ ] A2: 真实数据验证（Binance/TV K 线）
- [ ] A3: 性能基准测试套件
- [ ] A4: 边界情况 & 错误处理测试

**预计完成**: 2026-02-16（Week 1）或 2026-02-23（Week 2）

---

#### 线程 B：quant-lib/quant-lab 适配（bot-001）⏳
**任务卡**: `tasks/in-progress/bot-001-quant-lib-adaptation.md`

**B1. quant-lib 适配 ndtsdb v0.9.3.8**:
- [x] B1.1: 启用压缩（部分完成）✅
  - ✅ int64/int32 列使用 delta 压缩
  - ⚠️ float64 列暂不压缩（压缩率仅 0.77%）
  - 📝 **发现问题**：Gorilla 压缩算法已实现（`compression.ts`），但未集成到 AppendWriter 文件格式
- [ ] B1.1.1: **Gorilla 压缩集成**（新增）⭐⭐⭐⭐
  - 目标：让 float64 列可以使用 Gorilla 压缩
  - 修改：`append.ts` 中 `compressColumn` / `decompressColumn` 支持 Gorilla
  - 预期压缩率提升：0.77% → 70-85%
  - 预计工期：1-2 天
- [ ] B1.2: 迁移到分区表（按 symbol 哈希分区）
  - 当前：3000 symbols × 3 intervals = 9000 个文件
  - 目标：100 个分区文件（文件数减少 90%）
  - 预计工期：2-3 天
- [ ] B1.3: 集成流式聚合（实时 SMA/EMA/StdDev）
  - 预计工期：1-2 天

**B2. quant-lab 策略运行时**:
- [ ] 回测引擎 + 实盘引擎 + 策略接口
- 预计工期：3-5 天

**B3. 实战验证**:
- 边用边修（发现 ndtsdb 问题 → 立即修复）

**预计完成**: 2026-02-16（Week 1）或 2026-02-23（Week 2）

---

### 🔴 高优先级 - ✅ 全部完成

- ✅ SQL 子集补齐（CTE/JOIN/子查询/HAVING/复杂 WHERE/ORDER BY expr）
- ✅ 二级索引 + 复合索引（BTree + SQL 自动优化）
- ✅ Tombstone 删除 + 自动 compact（RoaringBitmap + 多触发条件）
- ✅ 原生字符串类型（字典编码 + 固定 header 空间）

### 🟡 中优先级 - ✅ 全部完成

- ✅ 列式压缩（Delta/RLE + 文件格式集成 + 向后兼容）
- ✅ 分区表（自动分区 + 跨分区查询 + SQL 集成）
- ✅ 流式聚合（SMA/EMA/StdDev + 滑动窗口）

### 🟢 低优先级（打磨 & 扩展）

**1. 真实数据验证 & 测试增强** ⭐⭐⭐⭐

- 真实 Binance/TV K 线验证（压缩率/回放性能/内存占用）
- 补充压缩相关测试
- 性能基准测试套件

**2. 错误处理规范化**

- 可恢复错误: 返回 Result 类型
- 不可恢复: throw 标准 Error 子类

**3. 轻量级事务（WAL）**

- 多 chunk 批量写入的原子性
- 回滚机制
- WAL 用于崩溃恢复

### 不急的 (低收益或过度工程)

- ~~npm 发布~~ - 目前只有内部使用，不需要
- ~~Parquet/Arrow 兼容~~ - 自有格式够用
- ~~分布式/复制~~ - 单机足够，过度工程
- ~~GPU 加速~~ - 场景不匹配
- ~~JIT 编译~~ - V8 已经做了

### 已评估放弃的方向 ❌

**io_uring 批量文件读取**

我们实现并测试了 Linux io_uring 用于批量读取文件，**结论：不适合当前场景**。

| 场景 | 同步读取 | io_uring | 结论 |
|------|----------|----------|------|
| 10 × 1MB | 8.8ms | 7.0ms | ✅ 有优势 |
| 100 × 100KB | 9.9ms | 18.8ms | ❌ 更慢 |
| 1000 × 10KB | 18.2ms | 39.0ms | ❌ 更慢 |
| 256 × 64KB | 12.7ms | 14.6ms | ❌ 略慢 |

**原因**：
- io_uring 的 SQE/CQE 设置开销对小文件占主导
- Node.js/Bun 同步文件 IO 已足够高效（libuv/liburing 底层优化）
- mmap + 内核 page cache 已做好优化
- 我们的场景是 3000+ 个 ~20KB 小文件，正好落在最差区间

**保留**：代码在 `native/ndts.c` 中（`uring_*` 函数），供未来大文件场景参考。

**适用场景**（非本库）：
- 单文件 >1MB 的批量读取
- 网络 socket IO
- 需要真正异步不阻塞主线程的场景

**WASM SIMD 备选方案**

曾实现 Rust → wasm-bindgen 的 WASM SIMD 版本（51KB），**结论：不需要**。

| 方案 | 性能 | 部署 | 结论 |
|------|------|------|------|
| C FFI (libndts) | 143M rows/s | 8 平台预编译 | ✅ 主力方案 |
| WASM SIMD | ~86M rows/s | 单文件，浏览器可用 | ❌ 不需要 |
| 纯 JS | 45M rows/s | 零依赖 | ✅ 自动回退 |

**原因**：
- Bun 的 FFI 已足够高效，无 N-API 开销
- libndts 覆盖 8 平台，无需浏览器兼容性
- WASM 增加 51KB 体积，性能不如 C FFI
- 纯 JS 回退已足够应对无原生库场景

---

## ✅ 已实现功能（不再放 roadmap）

已实现能力清单不再在 roadmap 重复维护，统一放在：`docs/FEATURES.md`。

---

## 里程碑

### 已完成

| 版本 | 时间 | 完成 |
|------|------|------|
| v0.8 | 02-08 | 列式存储 + C SIMD + SQL + 压缩 + 索引 + mmap |
| v0.8 | 02-09 AM | MinHeap 归并 + ASOF JOIN + AppendWriter + CRC32 + SAMPLE BY + 窗口函数 |
| **v0.9.0** | 02-09 PM | **libndts 跨平台编译** (8 架构: lnx/osx/win × x86/arm × 32/64) |
| **v0.9.0** | 02-09 PM | **新增 FFI**: binary_search, sma, ema, rolling_std, prefix_sum |
| **v0.9.0** | 02-09 PM | **io_uring 评估** → 结论：不适合小文件场景 |
| **v0.9.0** | 02-09 PM | **Gorilla 压缩移入 C** (3.9M/s 压缩, 11.5M/s 解压) |
| **v0.9.0** | 02-09 PM | **重命名 data-lib → ndtsdb** |
| **v0.10.0** | 02-09 PM | **下游集成验证**：DuckDB 依赖移除 |
| **v0.10.1** | 02-09 22:15 | **下游脚本修复**：接口/路径收敛（connect/init、旧路径迁移） |
| **v0.10.2** | 02-09 23:00 | **SQL 窗口函数**: 已实现 STDDEV/ROW_NUMBER/AVG... OVER (ORDER BY ... ROWS BETWEEN) |
| **v0.10.2** | 02-09 23:00 | **SQL GROUP BY**: 已实现 COUNT/SUM/AVG/MIN/MAX/STDDEV/VARIANCE/FIRST/LAST |
| **v0.9.3.0** | 02-10 15:56 | **复合索引 + 自动 compact**（SQL 侧复合索引支持；tombstone 比例触发） |
| **v0.9.3.1** | 02-10 16:05 | **Auto compact 扩展**（时间/大小/chunk/写入量触发） |
| **v0.9.3.2** | 02-10 16:08 | **N 列复合索引 SQL 优化**（前缀匹配 + 最优索引选择） |
| **v0.9.3.3** | 02-10 16:15 | **压缩算法实现**（Delta/Delta-of-Delta/RLE；基准测试；未集成存储） |
| **v0.9.3.4** | 02-10 16:20 | **分区表 v1**（时间/范围/哈希分区；自动分区文件管理；跨分区查询） |
| **v0.9.3.5** | 02-10 16:25 | **流式聚合 v1**（SMA/EMA/StdDev/Min/Max；滑动窗口；多指标组合） |
| **v0.9.3.6** | 02-10 16:30 | **分区查询优化 v1**（timeRange 提前过滤分区扫描） |
| **v0.9.3.7** | 02-10 16:45 | **压缩工具导出** + **PartitionedTable 与 SQL 集成**（extractTimeRange + queryPartitionedTableToColumnar） |
| **v0.9.3.8** | 02-10 17:10 | **AppendWriter 压缩文件格式集成 v1**（启用压缩时写入 colLen+colData，读取端自动解压；兼容旧格式） |
| **v0.9.3.9** | 02-10 18:35 | **Gorilla 压缩集成到 AppendWriter**（float64 列支持；GorillaEncoder 导出；quant-lib 压缩率 0.77% → 12%） |
| **v0.9.3.10** | 02-10 18:45 | **SQL 聚合函数补全**（支持无 GROUP BY 的 AVG/SUM/COUNT(*)；整体聚合逻辑；79 tests pass） |

### 计划中（2026-02-10 ~ 02-23）

| 版本 | 预计时间 | 计划内容 |
|------|----------|----------|
| **quant-lib v1** | 02-12 ~ 02-14 | **分区表迁移**（按 symbol 哈希分区；文件数减少 90%；优化单 symbol 查询） |
| **quant-lib v2** | 02-14 ~ 02-16 | **流式聚合集成**（实时 SMA/EMA/StdDev；WebSocket 行情回调） |
| **quant-lab v1** | 02-17 ~ 02-23 | **策略运行时**（回测引擎 + 实盘引擎 + 策略接口） |

**并行任务**：
- **ndtsdb 测试增强**（bot-007）：压缩测试/真实数据验证/性能基准（02-10 ~ 02-23）

---

### 后续计划（按优先级）

**🔴 高优先级（全部完成 ✅）**：
- ✅ **SQL CTE (WITH) + 多列 IN + `||` + ROUND/SQRT**
- ✅ **Inline Window + PARTITION BY fast-path 统一**
- ✅ **复杂 WHERE（括号优先级 / AND-OR-NOT）**
- ✅ **ORDER BY <expr>（alias/ordinal/expr）**
- ✅ **SQL 子查询（FROM 派生表 + WHERE IN 子查询）**
- ✅ **二级索引（BTree on 数值列 + SQL 自动优化）**
- ✅ **UPDATE/DELETE tombstone 优化**（独立 .tomb 文件 + RoaringBitmap 压缩 + 延迟 compact）
- ✅ **原生字符串类型**（字典编码 + 固定 header 空间，透明存储为 int32 id）
- ✅ **复合索引**（多列组合查询加速，如 (symbol, timestamp)）
- ✅ **自动 compact 策略**（tombstone 比例触发，可配置阈值）

**🟡 中优先级 - ✅ 全部完成**：
- ~~二级索引（BTree on 数值列 + SQL 自动优化）~~ ✅ v0.9.3.0-v0.9.3.2
- ~~复合索引（多列组合查询加速）~~ ✅ v0.9.3.0-v0.9.3.2
- ~~原生字符串类型（字典编码 + 固定 header 空间）~~ ✅ v0.9.3.0
- ~~UPDATE/DELETE tombstone 优化（RoaringBitmap + 延迟 compact）~~ ✅ v0.9.3.0
- ~~自动 compact 策略（多触发条件）~~ ✅ v0.9.3.0-v0.9.3.1
- ~~列式压缩（Delta/RLE + 文件格式集成）~~ ✅ v0.9.3.3 + v0.9.3.8
- ~~分区表（自动分区 + 跨分区查询）~~ ✅ v0.9.3.4 + v0.9.3.6
- ~~流式聚合（增量计算 SMA/EMA/StdDev）~~ ✅ v0.9.3.5
- ~~PartitionedTable 与 SQL 打通~~ ✅ v0.9.3.7

**🟢 低优先级**：
- 事务支持（WAL + 原子写入）
- 分布式扩展（replication / sharding）

---

## 设计原则

1. **零依赖优先** — `import` 即用，不需要独立服务
2. **零依赖核心** - 核心模块不依赖第三方库
3. **渐进式加速** - JS → C FFI，自动回退到 JS
4. **保持精简** - ~5600 行 TS，不膨胀
5. **分阶段演进** - 核心时序能力优先，OLAP/ACID 等能力逐步完善

### 当前最佳适用场景

✅ **已成熟支持**：
- K线/Tick 数据采集（追加写入）
- 全市场回测（mmap 多路归并）
- 实时指标计算（SAMPLE BY + 窗口函数）
- 日志/事件流存储

🚧 **开发中/未来支持**：
- 复杂 UPDATE/DELETE 操作（v0.12+  CompactWriter）
- 多表 JOIN 查询（v0.13+）
- ACID 事务（v1.0+ WAL + 原子写入）
- 完整 OLAP 分析能力（持续迭代）

### 与 DuckDB 对比

| 场景 | DuckDB | ndtsdb | 建议 |
|------|--------|--------|------|
| K线存储 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ndtsdb（更快，更小） |
| SQL 分析 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ndtsdb（持续完善中） |
| 事务处理 | ⭐⭐⭐⭐ | ⭐⭐ | ndtsdb（v1.0+ 支持 ACID） |
| 零依赖部署 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ndtsdb（无需服务） |
| 部署体积 | ~100MB | ~100KB | ndtsdb（轻量） |
