# 小版本发布方案

## 1. 适用场景

当用户说“发布一个小版本”“发一个小版本”“小版本发布”等类似指令时，按本方案执行 patch 版本发布准备流程。

适用于：

- 当前分支已有待发布变更。
- 需要将 `package.json` / `package-lock.json` 的 patch 版本号递增。
- 需要更新 `CHANGELOG.md` 和 `README.md` 中的当前发布版本信息。
- 需要执行构建、lint、运行时包、离线包生成。
- 需要提交 Git、打 tag、推送远端。
- npm 发布需要由用户在本地登录后手动执行，或用户明确授权且环境已登录 npm 后再执行。

## 2. 不适用场景

以下情况不要自动执行，需先向用户确认：

- 需要 minor/major 版本，而不是 patch 小版本。
- 工作区存在用户未说明的未提交变更，且不确定是否纳入发布。
- 涉及生产数据库迁移、密钥、权限、支付等高风险变更。
- 当前分支不是预期发布分支，或远端状态异常。
- `npm whoami` 未登录时，不要尝试 npm 发布。

## 3. 标准执行步骤

### 3.1 发布前检查

```bash
git status --short
git branch --show-current
git log --oneline -10 --decorate --all
```

如果工作区有未提交变更：

- 若变更正是本次待发布内容，可继续。
- 若变更来源不明，先询问用户。

### 3.2 版本递增

默认执行 patch 版本递增：

```bash
npm version patch --no-git-tag-version
```

该命令会更新：

- `package.json`
- `package-lock.json`

### 3.3 更新发布文档

更新 `CHANGELOG.md`：

- 在顶部新增当前版本章节。
- 日期使用当前日期。
- 内容基于上一个 tag 到当前 HEAD 的 commit 摘要整理。
- 保留 `Released` 小节，写明 npm 包名和离线包路径。

可用命令辅助识别变更：

```bash
git describe --tags --abbrev=0
git log --oneline <last-tag>..HEAD
git diff --stat <last-tag>..HEAD
```

更新 `README.md`：

- 版本徽章更新为新版本。
- npm 安装命令更新为新版本。
- 离线包路径更新为新版本。
- tag 文案更新为新版本。

### 3.4 验证与构建

必须执行：

```bash
npm run build
npm run lint
```

如命令失败：

- 停止发布。
- 汇总失败命令、关键错误、建议修复点。
- 不提交 release commit，不打 tag，不推送。

### 3.5 生成运行时包和离线包

执行：

```bash
node scripts/prepare-runtime-package.cjs
node scripts/prepare-offline-package.cjs
cd package-offline
npm install --omit=dev --ignore-scripts
cd ..
node scripts/prune-offline-package.cjs
cd package-offline
npm pack
cd ..
```

预期生成：

```text
package-offline/shawnstack-quickforge-<version>.tgz
```

注意：`dist/`、`package-dist/`、`package-offline/` 通常被 `.gitignore` 忽略，不纳入 Git 提交。

离线包生成时会将 `@vscode/ripgrep` 保持为 `optionalDependencies` 且不加入 bundled dependencies，避免把构建机平台绑定的 ripgrep 二进制（如 Windows `rg.exe`）发布给其他平台。`node-pty` 也作为 optional dependency 不打入离线 tarball，用于避免捆绑大型平台 PTY 预构建二进制；离线安装后若无法联网安装 `node-pty`，内置终端面板会禁用，其余聊天、项目、工具和文件搜索功能仍可用。在线安装该包时，npm 会按用户平台安装对应的可选依赖；如果目标环境无法联网安装 ripgrep，安装不会因此失败，运行时会继续回退到系统 `rg` 或 Node 搜索实现。

### 3.6 Git 提交、打 tag、推送

先确认差异：

```bash
git diff -- CHANGELOG.md README.md package.json package-lock.json
git status --short
```

提交并推送：

```bash
git add package.json package-lock.json CHANGELOG.md README.md
git commit -m "chore(release): v<version>"
git tag v<version>
git push origin <branch> --tags
```

推送后检查：

```bash
git status --short
git log --oneline -1
git tag --points-at HEAD
```

## 4. npm 发布策略

默认不要替用户发布 npm，除非同时满足：

1. 用户明确说“继续发布 npm”或等价指令。
2. `npm whoami` 成功，确认当前 npm 账号已登录。
3. 包内容已构建、离线包已生成、Git tag 已推送。

如果未登录 npm，最终只给用户完整发布指令。

检查 npm 登录：

```bash
npm whoami
```

用户手动发布指令：

```bash
cd package-offline
npm publish --access public
```

发布后可验证：

```bash
npm view @shawnstack/quickforge version
npm view @shawnstack/quickforge dist-tags
```

## 5. 风险与处理

- `npm run build` 可能出现已知 warning，例如 Vite externalized module、KaTeX 字体未解析、大 chunk。只要 exit code 为 0，可记录 warning 后继续。
- `npm install --omit=dev --ignore-scripts` 可能出现 audit/deprecated warning。只要 exit code 为 0，可记录 warning 后继续。
- `node scripts/prune-offline-package.cjs` 会删除离线包 `node_modules` 中的 sourcemap、TypeScript 类型/源码和 tsbuildinfo 等非运行文件，用于控制 npm bundled 包的 unpacked size。
- 离线包将 `@vscode/ripgrep` 和 `node-pty` 作为 optionalDependencies 且不 bundle；在线安装时 npm 会按用户平台安装对应可选依赖。若目标环境无法联网且没有系统 `rg`，文件搜索会自动回退到 Node 实现，功能可用但大仓库搜索性能可能下降；若无法安装 `node-pty`，内置终端面板会禁用，其余功能可用。
- 如果 `git push origin <branch> --tags` 推送了历史本地 tag，需要在结果里说明。
- 如果 tag 已存在，不要覆盖；先停止并提示用户确认处理方式。

## 6. 回滚方式

如果已 commit 但未 push：

```bash
git tag -d v<version>
git reset --hard HEAD~1
```

如果已 push commit 和 tag：

```bash
git revert <release-commit>
git push origin <branch>
git push origin :refs/tags/v<version>
git tag -d v<version>
```

如果 npm 已发布：

- npm 包通常不建议删除或覆盖。
- 优先发布下一个 patch 版本修复。
- 如必须废弃当前版本：

```bash
npm deprecate @shawnstack/quickforge@<version> "Deprecated release, please upgrade to a newer patch version."
```

## 7. 触发口令与执行约定

当用户说：

- “发布一个小版本”
- “发一个小版本”
- “小版本发布”
- “你帮我发个 patch 版本”

默认执行：

1. 检查工作区和分支。
2. patch 递增版本。
3. 更新 `CHANGELOG.md` / `README.md`。
4. 执行 `npm run build`、`npm run lint`。
5. 生成 `package-dist` 和 `package-offline`，并 `npm pack` 离线包。
6. Git commit、tag、push。
7. 不自动 npm publish；最终给用户完整 npm 发布指令。

最终回复必须包含：

- 新版本号。
- release commit。
- tag。
- 构建、lint、离线包生成结果。
- 离线包路径。
- npm 发布指令。
- 发现的 warning / 风险。
