#!/bin/bash
# ============================================================
# Podman 容器编译 libndts
# 使用 Zig 交叉编译到多平台
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NATIVE_DIR="$SCRIPT_DIR/../native"
IMAGE_NAME="ndts-zig-builder"

cd "$NATIVE_DIR"

echo "🐳 libndts Podman Build"
echo "======================="
echo ""

# 检查 podman
if ! command -v podman &> /dev/null; then
    echo "❌ Podman not found. Please install podman first."
    exit 1
fi

# 构建镜像 (如果不存在或有更新)
if [[ "$1" == "--rebuild" ]] || ! podman image exists "$IMAGE_NAME"; then
    echo "📦 Building container image..."
    podman build -t "$IMAGE_NAME" -f Containerfile.zig .
    echo ""
fi

# 运行编译
echo "🔨 Running cross-compilation..."
podman run --rm \
    -v "$NATIVE_DIR:/src:Z" \
    "$IMAGE_NAME"

echo ""
echo "📁 Output in: $NATIVE_DIR/dist/"
ls -lh "$NATIVE_DIR/dist/libndts-"* 2>/dev/null || echo "No output files"
