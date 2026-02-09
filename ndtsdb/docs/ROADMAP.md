# data-lib Roadmap

## 现状总结 (2026-02-09)

**核心已完成** — 从零到一个功能完整的嵌入式时序数据库。

| 能力 | 实现 | 性能 |
|------|------|------|
| 列式存储 | ColumnarTable, 8 字节对齐 | 6.9M writes/s |
| 增量写入 | AppendWriter, DLv2 chunked 格式 | 3.3M rows/s |
| 完整性校验 | CRC32 header + per-chunk | ✅ |
| C SIMD (libndts) | 8 平台预编译 (Zig CC) | 143M rows/s |
| WASM SIMD | Rust → wasm-bindgen | 备选 |
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

### 值得做 (高收益)

**1. quant-lab 新工具逐步接入** ⭐⭐⭐

quant-lab 中已有的 DuckDB 使用保持不动（成熟稳定）。
新增工具/模块优先用 data-lib，逐步验证：
- 新的数据采集管道 → AppendWriter
- 新的回测引擎 → MmapMergeStream
- 新的分析工具 → SAMPLE BY / 窗口函数

**2. 真实数据验证**

现有基准都是合成数据。需要用真实 Binance/TV K 线数据测试：
- 实际压缩率
- 实际回放性能
- 实际内存占用

### 可以做 (中等收益)

**4. 错误处理规范化**

目前异常处理不一致（有些 throw，有些 console.warn）。统一为：
- 可恢复错误: 返回 Result 类型
- 不可恢复: throw 标准 Error 子类

**5. `bun test` 自动化**

10 个测试文件都是手动运行的。改为 bun test 格式，加 CI。

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

---

## 里程碑

| 版本 | 时间 | 完成 |
|------|------|------|
| v0.8 | 02-08 | 列式存储 + C SIMD + SQL + 压缩 + 索引 + mmap |
| v0.8 | 02-09 AM | MinHeap 归并 + ASOF JOIN + AppendWriter + CRC32 + SAMPLE BY + 窗口函数 |
| **v0.9.0** | 02-09 PM | **libndts 跨平台编译** (8 架构: lnx/osx/win × x86/arm × 32/64) |
| **v0.9.0** | 02-09 PM | **新增 FFI**: binary_search, sma, ema, rolling_std, prefix_sum |
| **v0.9.0** | 02-09 PM | **io_uring 评估** → 结论：不适合小文件场景 |
| **v0.9.0** | 02-09 PM | **Gorilla 压缩移入 C** (3.9M/s 压缩, 11.5M/s 解压) |
| **v0.9.0** | 02-09 PM | **重命名 data-lib → ndtsdb** |
| TBD | - | quant-lib 集成 |
| TBD | - | 格式统一 (v1 → DLv2) |
| TBD | - | 真实数据验证 |

---

## 设计原则

1. **嵌入式优先** — `import` 即用，不需要独立服务
2. **零依赖核心** — 核心模块不依赖第三方库
3. **渐进式加速** — JS → WASM → C FFI，自动降级
4. **保持精简** — ~5600 行 TS，不膨胀
