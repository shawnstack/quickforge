# `.github/` — GitHub 工作流和模板

## 目录结构

```
.github/
├── workflows/
│   ├── ci.yml              # CI 工作流 (29 行)
│   └── desktop-build.yml   # 桌面三端构建工作流
├── ISSUE_TEMPLATE/
│   ├── bug_report.md        # Bug 报告模板 (38 行)
│   └── feature_request.md   # 功能请求模板 (23 行)
└── PULL_REQUEST_TEMPLATE.md # PR 模板 (23 行)
```

---

## `workflows/ci.yml` — CI 工作流 (29 行)

- **触发**: push / pull request 到 main 或 master 分支
- **运行环境**: ubuntu-latest
- **Node 版本**: 22.19.x
- **步骤**:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` (带 npm 缓存)
  3. `npm ci`
  4. `npm run lint`
  5. `npm run test`
  6. `npm run build`

## `workflows/desktop-build.yml` — 桌面三端构建工作流

- **触发**: 手动 `workflow_dispatch`，或推送 `v*` 标签
- **权限**: 默认 `contents: read`；仅 Release job 使用 `contents: write` 创建 GitHub Release 和上传 assets；不发布 npm
- **运行环境**:
  - Windows: `windows-latest` → `npm run desktop:build:win`
  - macOS: `macos-latest` → `npm run desktop:build:mac`
  - Linux: `ubuntu-latest` → `npm run desktop:build:linux`
- **Node 版本**: 22.19.x
- **步骤**:
  1. `actions/checkout@v4`
  2. `actions/setup-node@v4` (带 npm 缓存)
  3. Linux runner 额外安装 `libarchive-tools` 和 FUSE 2 兼容库（`libfuse2t64`，回退 `libfuse2`），并设置 `APPIMAGE_EXTRACT_AND_RUN=1` 以支持 AppImage 工具链
  4. `npm ci`
  5. 按平台执行桌面构建脚本；Linux AppImage 显式使用安全可执行名 `quickforge`，避免从 scoped npm 包名推导出非法路径字符
  6. 上传 `desktop-dist/` 中的安装包和更新元数据为 workflow artifacts
  7. 推送 `v*` 标签触发时，构建全部成功后下载三端 artifacts，创建 GitHub Release 并上传桌面构建产物；手动触发只生成 workflow artifacts

## `ISSUE_TEMPLATE/bug_report.md`

Bug 报告模板，包含:
- Bug 描述
- 复现步骤
- 期望行为
- 截图
- 环境信息 (OS, Node 版本, QuickForge 版本, 浏览器)

## `ISSUE_TEMPLATE/feature_request.md`

功能请求模板，包含:
- 问题描述
- 期望解决方案
- 备选方案
- 额外上下文

## `PULL_REQUEST_TEMPLATE.md`

PR 模板，包含:
- 变更摘要
- 关联 Issue
- 变更类型 (复选框)
- 检查清单 (lint, build, CHANGELOG, 测试, 文档)
