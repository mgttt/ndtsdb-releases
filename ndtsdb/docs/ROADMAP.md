# ndtsdb Roadmap

## 现状总结 (2026-02-09)

**核心已完成** — 从零到一个功能完整的嵌入式时序数据库。

### 迁移发现的问题 (quant-lib → ndtsdb)

从 DuckDB 迁移到 ndtsdb 过程中发现的架构限制：

| 限制 | 影响 | 当前 workaround | 优先级 |
|------|------|-----------------|--------|
| **Append-only 写入** | 无法 DELETE/UPDATE，需重写整个文件 | 读取→过滤→重写 | 🔴 高 |
| **有限 SQL 支持** | 无 JOIN、子查询、复杂 WHERE | 手动 TS 过滤 | 🔴 高 |
| **无二级索引** | SymbolTable 仅支持主键，无范围索引 | 全表扫描 | 🟡 中 |
| **字符串字典编码** | 需手动管理 SymbolTable | 封装在 Provider 层 | 🟡 中 |
| **无事务支持** | 无 ACID，chunk 写入可能部分失败 | CRC32 + 定期备份 | 🟡 中 |
| **分析能力弱** | 无 GROUP BY、窗口函数、统计函数 | 手动计算或导出 | 🟢 低 |

**结论**：ndtsdb 适合**追加型时序数据**（K线、Tick），不适合**频繁更新**的 OLTP 场景。

---

| 能力 | 实现 | 性能 |
|------|------|------|
| 列式存储 | ColumnarTable, 8 字节对齐 | 6.9M writes/s |
| 增量写入 | AppendWriter, DLv2 chunked 格式 | 3.3M rows/s |
| 完整性校验 | CRC32 header + per-chunk | ✅ |
| C SIMD (libndts) | 8 平台预编译 (Zig CC) | 143M rows/s |
| Gorilla 压缩 | Delta-of-Delta + XOR | 70-95% |
| SQL | 递归下降解析器 | 5.9M rows/s |
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

### 🔴 高优先级（解决迁移阻塞问题）

**1. 支持 UPDATE/DELETE（重写优化）** ⭐⭐⭐

Append-only 是最大限制。方案：
- 添加 `CompactWriter`：读取旧 chunk → 应用变更 → 写入新文件
- 支持 tombstone 标记（软删除，定期 compact）
- 参考 LSM-Tree 的合并策略

```typescript
// 目标 API
await table.deleteWhere({ symbol: 'BTC', before: 1700000000000 });
await table.updateWhere({ symbol: 'BTC' }, { status: 'archived' });
```

**2. 增强 SQL 执行器** ⭐⭐⭐

当前 SQL 仅支持简单 SELECT。需添加：
- JOIN 支持（至少 INNER JOIN）
- 复杂 WHERE（AND/OR 嵌套）
- 子查询（用于先过滤再聚合）
- 聚合函数（COUNT DISTINCT, STDDEV）

### 🟡 中优先级（提升易用性）

**3. 自动二级索引**

当前 SymbolTable 只支持 symbol → id 映射。需支持：
- 范围查询索引（BTree on timestamp）
- 多列复合索引
- 自动维护（写入时更新索引）

```typescript
const table = new IndexedTable([
  { name: 'timestamp', type: 'int64', index: 'btree' },
  { name: 'price', type: 'float64', index: 'bitmap' },
]);
```

**4. 字符串原生支持**

当前需手动用 SymbolTable。目标：
- ColumnarTable 直接支持 `string` 类型
- 内部自动字典编码（对用户透明）
- 可变长字符串存储（当前固定字典）

**5. 轻量级事务**

Chunk 级原子写入：
- 多 chunk 批量写入的原子性
- 回滚机制（写入失败时删除临时 chunk）
- WAL（Write-Ahead Log）用于崩溃恢复

### 🟢 低优先级（锦上添花）

**6. 错误处理规范化**

目前异常处理不一致（有些 throw，有些 console.warn）。统一为：
- 可恢复错误: 返回 Result 类型
- 不可恢复: throw 标准 Error 子类

**7. 真实数据验证**

现有基准都是合成数据。需用真实 Binance/TV K 线验证：
- 实际压缩率
- 实际回放性能
- 内存占用（特别是 mmap 场景）
- 与 DuckDB 的端到端性能对比

### 不急的 (低收益或过度工程)

- ~~npm 发布~~ — 目前只有内部使用，不需要
- ~~Parquet/Arrow 兼容~~ — 自有格式够用
- ~~分布式/复制~~ — 单机足够，过度工程
- ~~GPU 加速~~ — 场景不匹配
- ~~JIT 编译~~ — V8 已经做了

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
| **v0.10.0** | 02-09 | **quant-lib 完全迁移** → DuckDB 依赖移除 |

### 规划中

| 版本 | 优先级 | 目标 |
|------|--------|------|
| **v0.11.0** | 🔴 高 | UPDATE/DELETE 支持（CompactWriter / Tombstone） |
| **v0.12.0** | 🔴 高 | SQL JOIN + 复杂 WHERE |
| **v0.13.0** | 🟡 中 | 自动二级索引（BTree） |
| **v0.14.0** | 🟡 中 | 原生字符串类型（透明字典编码） |
| **v1.0.0** | 🟢 低 | 事务支持（WAL + 原子写入）|

---

## 设计原则

1. **嵌入式优先** — `import` 即用，不需要独立服务
2. **零依赖核心** — 核心模块不依赖第三方库
3. **渐进式加速** — JS → C FFI，自动回退到 JS
4. **保持精简** — ~5600 行 TS，不膨胀
5. **场景聚焦** — 专攻时序追加，不追求通用 OLTP

### 适用场景

✅ **强烈推荐**：
- K线/Tick 数据采集（追加写入）
- 全市场回测（mmap 多路归并）
- 实时指标计算（SAMPLE BY + 窗口函数）
- 日志/事件流存储

❌ **不建议使用**：
- 频繁 UPDATE/DELETE 的 OLTP
- 复杂关系查询（多表 JOIN）
- 需要 ACID 事务的金融交易
- 字符串为主的数据（如用户评论）

### 与 DuckDB 对比

| 场景 | DuckDB | ndtsdb | 建议 |
|------|--------|--------|------|
| K线存储 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ndtsdb（更快，更小） |
| SQL 分析 | ⭐⭐⭐⭐⭐ | ⭐⭐ | DuckDB（完整 SQL） |
| 事务处理 | ⭐⭐⭐⭐ | ⭐ | DuckDB（ACID） |
| 嵌入式 | ⭐⭐ | ⭐⭐⭐⭐⭐ | ndtsdb（零依赖） |
| 部署体积 | ~100MB | ~100KB | ndtsdb（轻量） |
