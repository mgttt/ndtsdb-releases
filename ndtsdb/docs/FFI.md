# C FFI 多平台支持

ndtsdb 现在支持 **多平台原生 SIMD**，使用 Zig 交叉编译。

## 支持的平台

| 平台 | 架构 | 文件名 | 大小 |
|------|------|--------|------|
| **Linux** | x86_64 | `libsimd-linux-x64.so` | 12KB |
| **Linux** | ARM64 | `libsimd-linux-arm64.so` | 12KB |
| **Linux** | x86_64 (musl) | `libsimd-linux-musl-x64.so` | 12KB |
| **macOS** | x86_64 | `libsimd-macos-x64.dylib` | 17KB |
| **macOS** | ARM64 | `libsimd-macos-arm64.dylib` | 50KB |
| **Windows** | x86_64 | `libsimd-windows-x64.dll` | 144KB |

## 快速开始

### 1. 自动检测平台

```typescript
import { isNdtsReady, int64ToF64, countingSortArgsort } from 'ndtsdb';

if (isNdtsReady()) {
  // 例：把 int64 timestamp 转成 float64，然后做排序/argsort 等 SIMD/FFI 加速操作
  const tsF64 = int64ToF64(timestampsI64);
  const idx = countingSortArgsort(tsF64);
  console.log(idx.length);
}
```

### 2. 手动选择库

库文件位于 `native/dist/`，自动根据平台加载：

```
native/dist/
├── libsimd-linux-x64.so          # Linux x86_64
├── libsimd-linux-arm64.so        # Linux ARM64
├── libsimd-linux-musl-x64.so     # Linux musl (Alpine)
├── libsimd-macos-x64.dylib       # macOS Intel
├── libsimd-macos-arm64.dylib     # macOS Apple Silicon
└── libsimd-windows-x64.dll       # Windows
```

## 编译所有平台

### 使用脚本

```bash
./scripts/build-all-platforms.sh
```

### 手动编译

```bash
# 确保 zig 已安装
zig version  # 0.13.0

# Linux x86_64
zig cc -O3 -shared -target x86_64-linux-gnu -o dist/libsimd-linux-x64.so simd.c

# Linux ARM64
zig cc -O3 -shared -target aarch64-linux-gnu -o dist/libsimd-linux-arm64.so simd.c

# Linux musl (Alpine)
zig cc -O3 -shared -target x86_64-linux-musl -o dist/libsimd-linux-musl-x64.so simd.c

# macOS x86_64
zig cc -O3 -shared -target x86_64-macos -o dist/libsimd-macos-x64.dylib simd.c

# macOS ARM64 (Apple Silicon)
zig cc -O3 -shared -target aarch64-macos -o dist/libsimd-macos-arm64.dylib simd.c

# Windows x86_64
zig cc -O3 -shared -target x86_64-windows-gnu -o dist/libsimd-windows-x64.dll simd.c
```

## 安装 Zig

### Linux/macOS

```bash
# 下载
wget https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz

# 解压
tar -xf zig-linux-x86_64-0.13.0.tar.xz

# 安装到系统
sudo mv zig-linux-x86_64-0.13.0/zig /usr/local/bin/

# 或安装到本地
mkdir -p ~/.local/zig
mv zig-linux-x86_64-0.13.0/* ~/.local/zig/
export PATH="$HOME/.local/zig:$PATH"
```

### Windows

```powershell
# 使用 scoop
scoop install zig

# 或下载解压后添加到 PATH
```

## Docker/Podman 构建

```bash
# 使用 Alpine 容器
podman run --rm -v "$PWD/native:/src:Z" -w /src alpine:latest \
  sh -c 'apk add --no-cache zig && zig cc -O3 -shared -o dist/libsimd-linux-x64.so simd.c'
```

## 故障排除

### `Library not found`

确保库文件存在于以下位置之一：
- `native/dist/libsimd-{platform}-{arch}.{ext}`
- `native/libsimd.{ext}` (回退)

### 平台不支持

如果当前平台没有预编译库，会尝试使用回退库或报错。可以：
1. 使用 `./scripts/build-all-platforms.sh` 编译
2. 使用纯 JS 版本（性能稍低）

### macOS 安全警告

macOS 可能阻止未知 dylib 加载：
```bash
# 移除隔离属性
xattr -d com.apple.quarantine native/dist/libsimd-macos-*.dylib
```

## 性能对比

所有平台性能接近：

| 平台 | 过滤 (500万行) | 求和 (500万行) |
|------|---------------|---------------|
| Linux x64 | 132M/s | 1162M/s |
| Linux ARM64 | 125M/s | 1100M/s |
| macOS x64 | 128M/s | 1150M/s |
| macOS ARM64 | 140M/s | 1200M/s |
| Windows x64 | 130M/s | 1140M/s |

## 纯 JS 回退

如果 FFI 库加载失败，会自动回退到纯 JS 实现：

```typescript
if (isFFIReady()) {
  // 使用 C FFI (132M/s)
  return ffiFilterF64GT(data, threshold);
} else {
  // 回退到 JS (45M/s)
  return jsFilterF64GT(data, threshold);
}
```
