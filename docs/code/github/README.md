# `.github/` — GitHub 配置

**路径**: `.github/`

---

## workflows/ci.yml (501 行)

**用途**: GitHub CI 持续集成工作流。

**触发条件**: `push` 和 `pull_request` 到 `main` 分支。

**步骤**:
1. 检出代码
2. 设置 Node.js 环境
3. 安装依赖
4. 运行 Lint (`npm run lint`)
5. 运行构建 (`npm run build`)

---

## ISSUE_TEMPLATE/

### bug_report.md (646 行)

Bug 报告模板，包含：
- 描述、复现步骤、期望行为、实际行为
- 截图/日志
- 环境信息（版本、操作系统、浏览器等）

### feature_request.md (558 行)

功能请求模板，包含：
- 问题描述
- 期望解决方案
- 替代方案
- 额外上下文

---

## PULL_REQUEST_TEMPLATE.md (24 行)

PR 模板，包含：
- 变更摘要
- 相关 Issue
- 变更类型（复选框）
- Checklist（lint、build、CHANGELOG、测试、文档）
