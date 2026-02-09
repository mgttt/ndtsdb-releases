#!/bin/bash
# ============================================================
# Zig 交叉编译脚本 - 多平台 SIMD 库
# 支持: Linux (x64, ARM64, musl), macOS (x64, ARM64), Windows (x64)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

NATIVE_DIR="$PWD/native"
OUTPUT_DIR="$NATIVE_DIR/dist"

mkdir -p "$OUTPUT_DIR"

# 查找 Zig
find_zig() {
    if command -v zig &> /dev/null; then
        echo "zig"
        return
    fi
    
    if [ -f "$HOME/.local/zig/zig" ]; then
        echo "$HOME/.local/zig/zig"
        return
    fi
    
    echo "❌ Zig not found. Please install Zig first:"
    echo "   wget https://ziglang.org/download/0.13.0/zig-linux-x86_64-0.13.0.tar.xz"
    echo "   tar -xf zig-linux-x86_64-0.13.0.tar.xz"
    echo "   sudo mv zig-linux-x86_64-0.13.0/zig /usr/local/bin/"
    exit 1
}

ZIG=$(find_zig)
echo "🚀 Zig Cross Compilation for libsimd"
echo "======================================"
echo "Using: $ZIG"
echo ""

# 编译目标
TARGETS=(
    "x86_64-linux-gnu:libsimd-linux-x64.so"
    "aarch64-linux-gnu:libsimd-linux-arm64.so"
    "x86_64-linux-musl:libsimd-linux-musl-x64.so"
    "aarch64-linux-musl:libsimd-linux-musl-arm64.so"
    "x86_64-macos:libsimd-macos-x64.dylib"
    "aarch64-macos:libsimd-macos-arm64.dylib"
    "x86_64-windows-gnu:libsimd-windows-x64.dll"
)

echo "🔨 Compiling for multiple targets..."
echo ""

for TARGET_PAIR in "${TARGETS[@]}"; do
    IFS=':' read -r TARGET OUTPUT <<< "$TARGET_PAIR"
    
    echo "📦 $TARGET -> $OUTPUT"
    
    if $ZIG cc -O3 -shared -target "$TARGET" -o "$OUTPUT_DIR/$OUTPUT" "$NATIVE_DIR/simd.c" 2>&1; then
        SIZE=$(ls -lh "$OUTPUT_DIR/$OUTPUT" | awk '{print $5}')
        echo "   ✅ Success ($SIZE)"
    else
        echo "   ⚠️  Failed (platform may not be supported)"
    fi
done

echo ""
echo "📁 Output files in $OUTPUT_DIR:"
echo "--------------------------------------"
ls -lh "$OUTPUT_DIR/" 2>/dev/null || echo "No output files"

echo ""
echo "✅ Cross compilation complete!"
echo ""
echo "Supported platforms:"
echo "  • Linux x86_64 (glibc)"
echo "  • Linux ARM64 (glibc)"
echo "  • Linux x86_64 (musl)"
echo "  • Linux ARM64 (musl)"
echo "  • macOS x86_64"
echo "  • macOS ARM64 (Apple Silicon)"
echo "  • Windows x86_64"
