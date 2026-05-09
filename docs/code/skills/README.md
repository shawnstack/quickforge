# `skills/` — Agent Skills 定义

**路径**: `skills/`

QuickForge 自带四个预定义的 Agent Skills，位于 `skills/` 目录下。这些 skills 可以在设置中启用，为 Agent 提供专项能力。

---

| Skill 目录 | skill.json | SKILL.md | 用途 |
|------------|-----------|----------|------|
| `ai-context-package/` | ✓ | 3080 行 | AI 上下文打包工具 |
| `code-review/` | ✓ | 943 行 | 代码审查执行 |
| `frontend-react/` | ✓ | 842 行 | React 前端开发指导 |
| `quickforge-project/` | ✓ | 981 行 | QuickForge 项目开发指导 |

---

## ai-context-package/

**用途**: 提供 AI 上下文打包能力。将项目的关键文件（README、配置文件、目录结构等）打包成一个上下文包，方便 AI 快速理解项目。

**技能配置** (`skill.json`):
```json
{
  "name": "ai-context-package",
  "displayName": "AI Context Package",
  "description": "...",
  "version": "1.0.0"
}
```

## code-review/

**用途**: 提供代码审查执行能力。在指定变更范围上运行代码审查流程，检查代码质量、安全性和最佳实践。

## frontend-react/

**用途**: 为 Agent 提供 React 前端开发的专业指导，包括组件结构、Hooks 使用、样式管理等最佳实践。

## quickforge-project/

**用途**: 为 QuickForge 项目本身的开发提供指导，包含项目架构、代码规范、构建流程等信息。

---

## Skill 搜索机制

Skills 的搜索优先级：
1. 项目工作区 `<workspace>/.ai/skills/`（项目级 skills）
2. 用户目录 `~/.quickforge/skills/`（用户级全局 skills）
3. `~/.agents/skills/`（共享 skills）
4. 应用内置 `skills/` 目录（bundled skills）
