#!/bin/bash
# ============================================================
# 使用 Podman + Zig 容器交叉编译
# ============================================================

set -e

echo "🐳 Podman + Zig Cross Compilation"
echo "==================================="

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NATIVE_DIR="$SCRIPT_DIR/native"
OUTPUT_DIR="$NATIVE_DIR/dist"

mkdir -p "$OUTPUT_DIR"

# 尝试拉取 zig 镜像
ZIG_IMAGE="alpine:latest"

echo "📥 Pulling base image..."
podman pull "$ZIG_IMAGE" 2>&1 | tail -3

# 在容器中安装 zig 并编译
echo ""
echo "🔨 Building in container..."

# Linux x86_64
echo "📦 Building for Linux x86_64..."
podman run --rm \
    -v "$NATIVE_DIR:/src:Z" \
    -w /src \
    "$ZIG_IMAGE" \
    sh -c '
        apk add --no-cache zig build-base && \
        zig cc -O3 -shared -target x86_64-linux-gnu -o dist/libsimd-linux-x64.so simd.c
    ' 2>&1 | tail -5

# Linux ARM64
echo "📦 Building for Linux ARM64..."
podman run --rm \
    -v "$NATIVE_DIR:/src:Z" \
    -w /src \
    "$ZIG_IMAGE" \
    sh -c '
        apk add --no-cache zig build-base && \
        zig cc -O3 -shared -target aarch64-linux-gnu -o dist/libsimd-linux-arm64.so simd.c
    ' 2>&1 | tail -5

# Linux musl (静态链接友好)
echo "📦 Building for Linux musl x86_64..."
podman run --rm \
    -v "$NATIVE_DIR:/src:Z" \
    -w /src \
    "$ZIG_IMAGE" \
    sh -c '
        apk add --no-cache zig build-base && \
        zig cc -O3 -shared -target x86_64-linux-musl -o dist/libsimd-linux-musl-x64.so simd.c
    ' 2>&1 | tail -5

echo ""
echo "📁 Output files:"
ls -lh "$OUTPUT_DIR/" 2>/dev/null || echo "No output files yet"

echo ""
echo "✅ Build complete!"
