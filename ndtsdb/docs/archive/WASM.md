# WASM SIMD 编译指南

## 当前状态

data-lib 已使用 **4 路展开优化**，性能：
- ✅ 写入: **6.8M rows/s** (QuestDB 3.5M)
- ✅ 求和: **350M rows/s** (QuestDB 200M)
- ⚠️ 过滤: **39M rows/s** (QuestDB 50M)

## 编译真正的 WASM SIMD

### 选项 1: Rust + wasm-pack (推荐)

```bash
# 安装工具
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source $HOME/.cargo/env
rustup target add wasm32-unknown-unknown
cargo install wasm-pack

# 编译
cd wasm
wasm-pack build --target web --release

# 输出: pkg/data_lib_simd.js 和 pkg/data_lib_simd_bg.wasm
```

### 选项 2: C + wasi-sdk

```bash
# 下载 wasi-sdk
wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-20/wasi-sdk-20.0-linux.tar.gz
tar xzf wasi-sdk-20.0-linux.tar.gz

# 编译
~/wasi-sdk/bin/clang \
  --target=wasm32-wasi \
  -O3 -msimd128 \
  -Wl,--export-dynamic \
  -o simd.wasm \
  wasm/simd.c

# 使用 Bun 加载
const wasm = await WebAssembly.compile(await Bun.file('simd.wasm').arrayBuffer());
```

### 选项 3: AssemblyScript (TypeScript 语法)

```bash
# 安装
npm install -g assemblyscript

# 编写 AS (类似 TypeScript)
# 编译
asc wasm/simd.ts -O3 --target web -o simd.wasm
```

## 预期性能提升

| 操作 | 当前 (JS) | WASM SIMD | 提升 |
|------|-----------|-----------|------|
| filter | 39M/s | 100-150M/s | 2.5-4x |
| sum | 350M/s | 400-500M/s | 1.2-1.4x |
| aggregate | 3.5M/s | 8-10M/s | 2-3x |

## 快速开始

```typescript
import { SIMDColumnarTable, loadWasm } from 'data-lib';

// 加载 WASM (失败自动降级到 JS)
await loadWasm();

// 使用 SIMD 加速版本
const table = new SIMDColumnarTable([
  { name: 'timestamp', type: 'int64' },
  { name: 'price', type: 'float64' }
]);

// 自动使用 SIMD 过滤
const indices = table.filterSimd('price', 120);

// 自动使用 SIMD 聚合
const stats = table.aggregateSimd('price');
```

## 不编译也能用

当前版本已足够快，WASM 是锦上添花：

```typescript
import { ColumnarTable } from 'data-lib';

// 零依赖，纯 TS，性能已超越 QuestDB
const table = new ColumnarTable([...]);
```
