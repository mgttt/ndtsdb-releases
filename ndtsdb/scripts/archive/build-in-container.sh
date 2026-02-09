#!/bin/sh
# ============================================================
# 容器内编译脚本 - 编译 libndts 到多平台
# ============================================================

set -e

echo "🚀 libndts Cross Compilation (Zig in Container)"
echo "================================================"
echo "Zig version: $(zig version)"
echo ""

# 输出目录
mkdir -p /src/dist

# 编译目标 - 命名规范: libndts-{win,lnx,osx}-{arm,x86}-{64,32}
TARGETS="
x86_64-linux-gnu:libndts-lnx-x86-64.so
aarch64-linux-gnu:libndts-lnx-arm-64.so
x86_64-linux-musl:libndts-lnx-x86-64-musl.so
x86_64-macos:libndts-osx-x86-64.dylib
aarch64-macos:libndts-osx-arm-64.dylib
x86_64-windows-gnu:libndts-win-x86-64.dll
x86-windows-gnu:libndts-win-x86-32.dll
aarch64-windows-gnu:libndts-win-arm-64.dll
"

SUCCESS=0
FAILED=0

for pair in $TARGETS; do
    TARGET=$(echo "$pair" | cut -d: -f1)
    OUTPUT=$(echo "$pair" | cut -d: -f2)
    
    printf "📦 %-25s -> %s ... " "$TARGET" "$OUTPUT"
    
    if zig cc -O3 -ffast-math -shared -target "$TARGET" -o "/src/dist/$OUTPUT" /src/ndts.c 2>/dev/null; then
        SIZE=$(ls -lh "/src/dist/$OUTPUT" | awk '{print $5}')
        echo "✅ ($SIZE)"
        SUCCESS=$((SUCCESS + 1))
    else
        echo "⚠️ failed"
        FAILED=$((FAILED + 1))
    fi
done

echo ""
echo "════════════════════════════════════════════════"
echo "📊 Results: $SUCCESS success, $FAILED failed"
echo ""
echo "📁 Output files:"
ls -lh /src/dist/libndts-* 2>/dev/null || echo "No output files"
echo ""
echo "✅ Done!"
