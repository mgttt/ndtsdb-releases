# CI/CD 版本号同步指南

## 概述

ndtsdb 使用独立的 `VERSION` 文件管理版本号，CI/CD 工具可以读取此文件并自动同步到 `README.md` 和 `package.json`。

## 文件说明

| 文件 | 作用 | 格式 |
|------|------|------|
| `VERSION` | 版本号唯一来源 | 纯文本，如 `0.9.2.6` |
| `README.md` | 显示版本号 | 包含 `<!-- VERSION_START -->` 标记 |
| `package.json` | npm 版本号 | JSON 的 `version` 字段 |
| `scripts/sync-version.sh` | 同步脚本 | Bash 脚本 |

## 本地使用

```bash
# 1. 修改版本号
echo "0.9.2.7" > VERSION

# 2. 运行同步脚本
./scripts/sync-version.sh

# 3. 提交变更
git add VERSION README.md package.json
git commit -m "Bump version to 0.9.2.7"
git push
```

## CI/CD 集成

### GitHub Actions 示例

复制 `scripts/sync-version.yml.example` 到 `.github/workflows/sync-version.yml`：

```bash
cp scripts/sync-version.yml.example .github/workflows/sync-version.yml
```

当 `VERSION` 文件被推送到 main 分支时，工作流会自动：
1. 读取 `VERSION` 文件
2. 更新 `README.md` 中的版本标识
3. 更新 `package.json` 的 `version` 字段
4. 自动提交变更

### 其他 CI/CD 工具

核心命令：

```bash
# 读取版本
VERSION=$(cat VERSION)

# 更新 README（使用 sed 或自定义脚本）
sed -i "s/<!-- VERSION_START -->.*<!-- VERSION_END -->/<!-- VERSION_START -->\\n**Version: $VERSION**\\n<!-- VERSION_END -->/" README.md

# 更新 package.json（使用 jq 或 Node.js）
jq ".version = \"$VERSION\"" package.json > package.json.tmp && mv package.json.tmp package.json
```

## 版本号格式

采用语义化版本（SemVer）扩展格式：

```
主版本.次版本.修订版本.构建号
  0.   9.    2.      6
```

- **主版本**：重大变更，不兼容 API
- **次版本**：新增功能，向下兼容
- **修订版本**：Bug 修复
- **构建号**：CI/CD 构建计数或补丁版本

## 多仓库同步

如果 ndtsdb 发布到独立的 release 仓库（如 `ndtsdb-release`），同步流程：

```
ndtsdb (开发仓库)
  └─ push VERSION ──► CI/CD ──► ndtsdb-release (发布仓库)
                                      ├─ 同步 VERSION
                                      ├─ 同步 README.md
                                      └─ 同步 package.json
```

### 推荐的同步策略

1. **开发仓库**（ndtsdb）：
   - 手动更新 `VERSION` 文件
   - 提交代码变更
   - 打 Git 标签：`git tag v0.9.2.6`

2. **CI/CD 触发**：
   - 检测 `VERSION` 变更
   - 运行同步脚本
   - 推送到 release 仓库

3. **Release 仓库**（ndtsdb-release）：
   - 接收同步的代码
   - 发布 npm 包（可选）
   - 创建 GitHub Release

## 常见问题

### Q: README.md 中的版本没有更新？

检查是否有 `<!-- VERSION_START -->` 和 `<!-- VERSION_END -->` 标记：

```markdown
<!-- VERSION_START -->
**Version: 0.9.2.6**
<!-- VERSION_END -->
```

### Q: 如何手动验证同步？

```bash
# 检查 VERSION
cat VERSION

# 检查 README
grep -A1 "VERSION_START" README.md

# 检查 package.json
grep '"version"' package.json
```

### Q: 可以在不修改 VERSION 的情况下更新 README 吗？

不推荐。`VERSION` 文件是版本号的唯一来源，所有版本标识应从此文件派生。

## 参考

- [语义化版本 2.0.0](https://semver.org/lang/zh-CN/)
- [npm version](https://docs.npmjs.com/cli/v10/commands/npm-version)
