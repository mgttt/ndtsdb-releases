#!/bin/bash
# ============================================================
# WASM SIMD 编译脚本 (使用 Cargo 直接编译)
# ============================================================

set -e
source ~/.cargo/env

echo "🚀 开始编译 WASM SIMD"
echo "======================"

cd /home/devali/moltbaby/data-lib/wasm

# 添加 wasm32 目标
echo "📦 添加 wasm32 目标..."
rustup target add wasm32-unknown-unknown

# 编译为 WASM
echo "🔨 编译 Rust 代码为 WASM..."
cargo build --target wasm32-unknown-unknown --release

# 复制结果
echo "📋 复制编译结果..."
cp target/wasm32-unknown-unknown/release/data_lib_simd.wasm ../src/simd.wasm

echo "✅ WASM 编译完成!"
echo "输出: src/simd.wasm"
ls -lh ../src/simd.wasm
