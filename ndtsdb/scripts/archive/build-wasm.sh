#!/bin/bash
# ============================================================
# WASM SIMD 编译脚本
# 自动检测并安装编译工具
# ============================================================

set -e

echo "🚀 WASM SIMD 编译脚本"
echo "======================"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="$SCRIPT_DIR/../wasm"
OUTPUT_DIR="$SCRIPT_DIR/../src"

cd "$WASM_DIR"

# 检查编译工具
 check_wasm_pack() {
    if command -v wasm-pack &> /dev/null; then
        echo -e "${GREEN}✓ wasm-pack 已安装${NC}"
        return 0
    fi
    return 1
}

check_wasi_sdk() {
    if [ -d "$HOME/wasi-sdk" ] && [ -x "$HOME/wasi-sdk/bin/clang" ]; then
        echo -e "${GREEN}✓ wasi-sdk 已安装${NC}"
        return 0
    fi
    return 1
}

# 安装 wasm-pack
install_wasm_pack() {
    echo -e "${YELLOW}⚠ wasm-pack 未安装，尝试安装...${NC}"
    
    # 检查 Rust
    if ! command -v rustc &> /dev/null; then
        echo -e "${YELLOW}⚠ Rust 未安装，先安装 Rust...${NC}"
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
        source "$HOME/.cargo/env"
    fi
    
    # 安装 wasm-pack
    cargo install wasm-pack
    
    if check_wasm_pack; then
        echo -e "${GREEN}✓ wasm-pack 安装成功${NC}"
        return 0
    else
        echo -e "${RED}✗ wasm-pack 安装失败${NC}"
        return 1
    fi
}

# 安装 wasi-sdk
install_wasi_sdk() {
    echo -e "${YELLOW}⚠ wasi-sdk 未安装，尝试安装...${NC}"
    
    cd "$HOME"
    WASI_VERSION="20"
    WASI_ARCH="x86_64"
    
    if [ ! -f "wasi-sdk-${WASI_VERSION}.0-${WASI_ARCH}-linux.tar.gz" ]; then
        echo "📥 下载 wasi-sdk..."
        wget -q "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_VERSION}/wasi-sdk-${WASI_VERSION}.0-${WASI_ARCH}-linux.tar.gz" || {
            echo -e "${RED}✗ 下载失败${NC}"
            return 1
        }
    fi
    
    echo "📦 解压 wasi-sdk..."
    tar xzf "wasi-sdk-${WASI_VERSION}.0-${WASI_ARCH}-linux.tar.gz"
    mv "wasi-sdk-${WASI_VERSION}.0+${WASI_ARCH}-linux" wasi-sdk
    rm -f "wasi-sdk-${WASI_VERSION}.0-${WASI_ARCH}-linux.tar.gz"
    
    if check_wasi_sdk; then
        echo -e "${GREEN}✓ wasi-sdk 安装成功${NC}"
        return 0
    else
        echo -e "${RED}✗ wasi-sdk 安装失败${NC}"
        return 1
    fi
}

# 使用 Rust/wasm-pack 编译
compile_with_rust() {
    echo -e "\n${YELLOW}🔨 使用 Rust/wasm-pack 编译...${NC}"
    
    cd "$WASM_DIR"
    
    # 添加 wasm32 目标
    rustup target add wasm32-unknown-unknown 2>/dev/null || true
    
    # 编译
    wasm-pack build --target web --release --out-dir pkg
    
    if [ -f "pkg/data_lib_simd.js" ] && [ -f "pkg/data_lib_simd_bg.wasm" ]; then
        echo -e "${GREEN}✓ Rust WASM 编译成功${NC}"
        
        # 复制到 src 目录
        cp pkg/data_lib_simd.js "$OUTPUT_DIR/"
        cp pkg/data_lib_simd_bg.wasm "$OUTPUT_DIR/"
        
        echo -e "${GREEN}✓ WASM 文件已复制到 src/${NC}"
        return 0
    else
        echo -e "${RED}✗ 编译失败${NC}"
        return 1
    fi
}

# 使用 C/wasi-sdk 编译
compile_with_c() {
    echo -e "\n${YELLOW}🔨 使用 C/wasi-sdk 编译...${NC}"
    
    cd "$WASM_DIR"
    
    export WASI_SDK_PATH="$HOME/wasi-sdk"
    
    # 编译
    "$WASI_SDK_PATH/bin/clang" \
        --target=wasm32-wasi \
        -O3 \
        -flto \
        -Wl,--export-dynamic \
        -Wl,--allow-undefined \
        -o simd.wasm \
        simd.c 2>&1 || {
        echo -e "${RED}✗ C 编译失败${NC}"
        return 1
    }
    
    if [ -f "simd.wasm" ]; then
        echo -e "${GREEN}✓ C WASM 编译成功${NC}"
        
        # 复制到 src 目录
        cp simd.wasm "$OUTPUT_DIR/"
        
        echo -e "${GREEN}✓ WASM 文件已复制到 src/${NC}"
        return 0
    else
        echo -e "${RED}✗ 编译失败${NC}"
        return 1
    fi
}

# 主流程
main() {
    echo "📁 工作目录: $WASM_DIR"
    echo ""
    
    # 尝试 Rust
    if check_wasm_pack || install_wasm_pack; then
        if compile_with_rust; then
            echo -e "\n${GREEN}🎉 WASM SIMD 编译完成！${NC}"
            exit 0
        fi
    fi
    
    # 尝试 C
    if check_wasi_sdk || install_wasi_sdk; then
        if compile_with_c; then
            echo -e "\n${GREEN}🎉 WASM SIMD 编译完成！${NC}"
            exit 0
        fi
    fi
    
    echo -e "\n${RED}✗ 所有编译方式失败${NC}"
    echo "请手动安装 Rust + wasm-pack 或 wasi-sdk"
    exit 1
}

main "$@"
