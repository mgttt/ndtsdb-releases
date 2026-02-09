# ndtsdb

<p align="center">
  <b>N-Dimensional Time Series Database</b><br>
  <i>全功能时序数据库 · 为极速量化交易而生</i>
</p>

<p align="center">
  <a href="#性能">Performance</a> •
  <a href="#架构">Architecture</a> •
  <a href="#跨平台">Platforms</a> •
  <a href="#使用">Usage</a>
</p>

---

## 性能

| 操作 | 速度 | 备注 |
|------|------|------|
| 写入 | **6.9M rows/s** | 列式批量写入 |
| 增量追加 | **3.3M rows/s** | Append-only with CRC32 |
| 扫描/过滤 | **143M rows/s** | C FFI SIMD 加速 |
| 求和聚合 | **1,162M rows/s** | 原生向量化计算 |
| OHLCV K线 | **11.7M rows/s** | 时间桶聚合 |
| SMA/EMA | **200-270M rows/s** | FFI 技术指标 |
| 二分查找 | **2,356M ops/s** | i64 时间戳定位 |
| 全市场回放 | **8.9M ticks/s** | 3000 产品并发 |
| 文件加载 | **60ms** | 3000 文件 mmap |
| 压缩率 | **70-95%** | Gorilla XOR 编码 |

---

## 架构

**技术栈**
- **Runtime**: Bun — 高性能 JS 运行时，原生 FFI、mmap 支持
- **语言**: TypeScript — 核心逻辑，类型安全
- **原生加速**: C + SIMD — 向量化过滤/聚合
- **交叉编译**: Zig CC — 一套源码编译 8 平台
- **内存映射**: mmap — 虚拟地址映射，OS 页缓存管理
- **零拷贝**: TypedArray views — 无 memcpy 直接映射
- **压缩**: Gorilla 编码 — Delta-of-Delta + XOR

📖 [详细架构文档 →](ndtsdb/docs/ARCHITECTURE.md)

---

## 跨平台

**8 平台预编译库**（开箱即用）

| 平台 | 架构 | 文件 |
|------|------|------|
| Linux | x64 | `libndts-lnx-x86-64.so` |
| Linux | ARM64 | `libndts-lnx-arm-64.so` |
| Linux | musl | `libndts-lnx-x86-64-musl.so` |
| macOS | x64 | `libndts-osx-x86-64.dylib` |
| macOS | ARM64 | `libndts-osx-arm-64.dylib` |
| Windows | x64 | `libndts-win-x86-64.dll` |
| Windows | x86 | `libndts-win-x86-32.dll` |
| Windows | ARM64 | `libndts-win-arm-64.dll` |

📖 [FFI 编译指南 →](ndtsdb/docs/FFI.md)

---

## 使用

```bash
# 安装
bun add ndtsdb

# 或下载预编译库
wget https://github.com/mgttt/ndtsdb-releases/releases/download/latest/libndts-lnx-x86-64.so
```

```typescript
import { ColumnarTable, MmapMergeStream, sma, ema } from 'ndtsdb';

// 创建表
const table = new ColumnarTable([
  { name: 'timestamp', type: 'bigint' },
  { name: 'price', type: 'float64' },
  { name: 'volume', type: 'float64' },
]);

// 写入数据
table.addRow({ timestamp: Date.now(), price: 100.5, volume: 1000 });

// 保存
table.saveToFile('./data/BTCUSDT.ndts');

// 多路归并回放（3000 产品并发）
const stream = new MmapMergeStream(files.map(f => ({ file: f, symbol: 'BTCUSDT' })));
for (const tick of stream.replayTicks()) {
  console.log(tick);
}

// 技术指标 (FFI 加速)
const prices = new Float64Array([...]);
const sma20 = sma(prices, 20);  // 268M/s
const ema20 = ema(prices, 20);  // 204M/s
```

---

## 文档导航

| 文档 | 内容 |
|------|------|
| [📐 架构设计](ndtsdb/docs/ARCHITECTURE.md) | 技术栈 · 数据流 · 存储格式 · 模块架构 |
| [🔧 FFI 编译](ndtsdb/docs/FFI.md) | C 库编译指南 · 交叉编译脚本 |
| [🗺️ 路线图](ndtsdb/docs/ROADMAP.md) | 已完成 · 进行中 · 下一步计划 |
| [📦 源代码](ndtsdb/) | TypeScript 源码 · 测试 · 脚本 |

---

## 版本

**Current**: v0.9.2.3 — 统一文件后缀为 `.ndts`，修复 Buffer pooling，新增完整测试套件

📦 [查看所有 Releases →](../../releases)

---

<p align="center">
  <sub>Powered by Bun · TypeScript · C FFI · mmap · SIMD</sub>
</p>
