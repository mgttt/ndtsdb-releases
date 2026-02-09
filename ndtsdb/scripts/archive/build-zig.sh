#!/bin/bash
# ============================================================
# Zig 交叉编译脚本
# 编译 libsimd 到多平台
# ============================================================

set -e

echo "🚀 Zig Cross Compilation for libsimd"
echo "======================================"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/native"
OUTPUT_DIR="$SRC_DIR/dist"

cd "$SRC_DIR"
mkdir -p "$OUTPUT_DIR"

# 检查 zig 是否可用
if ! command -v zig &> /dev/null; then
    echo "❌ Zig not found, installing..."
    
    # 下载并安装 zig
    ZIG_VERSION="0.13.0"
    ZIG_ARCH="x86_64-linux"
    
    wget -q "https://ziglang.org/download/${ZIG_VERSION}/zig-${ZIG_ARCH}-${ZIG_VERSION}.tar.xz"
    tar -xf "zig-${ZIG_ARCH}-${ZIG_VERSION}.tar.xz"
    
    # 使用本地 zig
    ZIG_BIN="$SRC_DIR/zig-${ZIG_ARCH}-${ZIG_VERSION}/zig"
else
    ZIG_BIN="zig"
fi

echo "✅ Using Zig: $ZIG_BIN"
echo ""

# 编译目标平台
# 格式: 目标三元组 -> 输出文件名
declare -A TARGETS=(
    ["x86_64-linux-gnu"]="libsimd-linux-x64.so"
    ["aarch64-linux-gnu"]="libsimd-linux-arm64.so"
    ["x86_64-linux-musl"]="libsimd-linux-musl-x64.so"
    ["aarch64-linux-musl"]="libsimd-linux-musl-arm64.so"
    ["x86_64-macos"]="libsimd-macos-x64.dylib"
    ["aarch64-macos"]="libsimd-macos-arm64.dylib"
    ["x86_64-windows-gnu"]="libsimd-windows-x64.dll"
    ["aarch64-windows-gnu"]="libsimd-windows-arm64.dll"
)

echo "🔨 Compiling for multiple targets..."
echo ""

for TARGET in "${!TARGETS[@]}"; do
    OUTPUT="${TARGETS[$TARGET]}"
    
    echo "📦 Building for $TARGET -> $OUTPUT"
    
    $ZIG_BIN cc \
        -O3 \
        -shared \
        -target "$TARGET" \
        -o "$OUTPUT_DIR/$OUTPUT" \
        simd.c 2>&1 || {
        echo "⚠️  Failed to build for $TARGET (may require additional setup)"
        continue
    }
    
    if [ -f "$OUTPUT_DIR/$OUTPUT" ]; then
        echo "   ✅ Success: $(ls -lh "$OUTPUT_DIR/$OUTPUT" | awk '{print $5}')"
    fi
done

echo ""
echo "📁 Output files in $OUTPUT_DIR:"
ls -lh "$OUTPUT_DIR/"

echo ""
echo "✅ Cross compilation complete!"
