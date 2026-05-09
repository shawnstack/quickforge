# `skills/` — 内置 Agent Skills

QuickForge 内置的 Agent Skills 定义。每个 Skill 包含 `skill.json` (元数据) 和 `SKILL.md` (指令内容)。

## 目录结构

```
skills/
├── ai-context-package/    # AI 上下文包 Skill
├── code-review/           # 代码审查 Skill
├── frontend-react/        # React 前端开发 Skill
└── quickforge-project/    # QuickForge 项目自身 Skill
```

## Skills 详情

### `ai-context-package/`

| 字段 | 值 |
|------|-----|
| name | `ai-context-package` |
| displayName | AI Context Package |
| 版本 | 1.0.0 |
| 标签 | context, planning, task, requirements, ai |
| 触发词 | 上下文包, AI 上下文, context package, 任务上下文, 验收标准, 变更范围 |

**功能**: 创建结构化的 AI 任务上下文包，包含:
- 项目概况、相关文档
- 任务目标、验收标准
- 变更范围 (允许/禁止修改)
- 相关代码入口
- 约束条件
- 验证方式和停止条件
- 期望 AI 输出格式

### `code-review/`

| 字段 | 值 |
|------|-----|
| name | `code-review` |
| displayName | Code Review |
| 版本 | 1.0.0 |
| 标签 | code, review, quality |

**功能**: 代码审查流程:
- 审查正确性、回归、安全、数据丢失、性能、可维护性
- 优先具体发现，而非泛泛建议
- 输出按风险排序，包含位置、风险、原因和修复建议

### `frontend-react/`

| 字段 | 值 |
|------|-----|
| name | `frontend-react` |
| displayName | React Frontend |
| 版本 | 1.0.0 |
| 标签 | react, frontend, typescript, ui |

**功能**: React 前端开发指南:
- 匹配现有组件风格和设计语言
- 简单的受控状态和小型组件
- 可访问性 (label, aria, 键盘行为)
- 不添加无关依赖

### `quickforge-project/`

| 字段 | 值 |
|------|-----|
| name | `quickforge-project` |
| displayName | QuickForge Project |
| 版本 | 1.0.0 |
| 标签 | quickforge, project, local-agent |

**功能**: QuickForge 项目自身修改指南:
- 手术式变更，避免大范围重构
- API 变更限于 `server/routes` 或专用模块
- 保持本地安全假设
- 构建验证 (`npm run build`)
