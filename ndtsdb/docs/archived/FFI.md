# [ARCHIVED] C FFI 多平台支持

> **归档日期**: 2026-02-11
> **原因**: 内容已合并到 ARCHITECTURE.md
> **最新状态见**: docs/ARCHITECTURE.md

---

ndtsdb 支持 **多平台原生 SIMD**，使用 Zig 交叉编译。

## 支持的平台

| 平台 | 架构 | 文件名 | 大小 |
|------|------|--------|------|
| **Linux** | x86_64 | `libsimd-linux-x64.so` | 12KB |
| **Linux** | ARM64 | `libsimd-linux-arm64.so` | 12KB |
| **Linux** | x86_64 (musl) | `libsimd-linux-musl-x64.so` | 12KB |
| **macOS** | x86_64 | `libsimd-macos-x64.dylib` | 17KB |
| **macOS** | ARM64 | `libsimd-macos-arm64.dylib` | 50KB |
| **Windows** | x86_64 | `libsimd-windows-x64.dll` | 144KB |

*[原文档已归档]*
