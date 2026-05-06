---
name: ai-context-package
description: Use this skill when the user wants to prepare, fill, review, or enforce an AI task context package before coding, including task scope, constraints, validation commands, stop conditions, and expected output format.
metadata:
  displayName: AI Context Package
  version: "1.0.0"
  tags: context, planning, template
---
# AI Context Package Skill

## Purpose

Produce a clear, bounded context package that helps an AI coding assistant understand the project, task goal, accepted scope, constraints, validation commands, and expected delivery format.

## Template

```md
# AI 上下文包：{TASK_NAME}

## 1. 项目概况
- 项目名称：{PROJECT_NAME}
- 项目定位：{PROJECT_SUMMARY}
- 技术栈：{TECH_STACK}
- 当前环境：{ENV}

## 2. 相关文档
- 项目知识地图：{PROJECT_KNOWLEDGE_DOC_PATH}
- 技术栈学习地图：{TECH_STACK_DOC_PATH}
- 模块设计文档：{MODULE_DOC_PATH}
- 解决方案文档：{SOLUTION_DOC_PATH}
- 接口文档/产品文档：{REQUIREMENT_DOC_PATH}

## 3. 任务目标
{BUSINESS_GOAL}

## 4. 验收标准
{ACCEPTANCE_CRITERIA}

## 5. 变更范围
允许修改：
{ALLOWED_FILES_OR_MODULES}

禁止修改：
{FORBIDDEN_FILES_OR_MODULES}

## 6. 相关代码入口
| 类型 | 路径 | 说明 |
|---|---|---|
| 入口/API | | |
| Service | | |
| DAO/Repository | | |
| 配置 | | |
| 测试 | | |

## 7. 已确定方案
{SOLUTION_SUMMARY}

## 8. 约束条件
- 不做无关重构。
- 不引入新依赖，除非明确说明。
- 不改变公共接口契约，除非有兼容方案。
- 不修改数据库结构，除非有迁移和回滚。
- 不泄露密钥和敏感数据。
- {OTHER_CONSTRAINTS}

## 9. 验证方式
- 测试命令：{TEST_COMMAND}
- 构建命令：{BUILD_COMMAND}
- 手工验证步骤：{MANUAL_VALIDATION}

## 10. 停止条件
遇到以下情况先停止，不要继续改代码：
- 代码事实与方案文档冲突。
- 需要扩大修改范围。
- 涉及数据库破坏性变更。
- 涉及权限扩大或敏感数据。
- 测试命令不可用且无法判断影响。
- {OTHER_STOP_CONDITIONS}

## 11. 期望 AI 输出
- 修改前理解。
- 修改文件清单。
- 每个文件变更说明。
- 测试/构建结果。
- 风险点。
- 回滚方式。
- 未完成项。
```

## Workflow

1. If the user provides only the template, treat it as a reusable task-context skill/template.
2. If fields are missing, ask only for the fields needed to proceed, or fill safe placeholders like `待补充` when the user wants a draft.
3. Before coding, restate the task understanding and explicitly list allowed and forbidden change scope.
4. Inspect the relevant docs/code entries before changing files.
5. Stop and ask for confirmation when any stop condition is met.
6. After changes, report using the expected AI output sections.

## Output Rules

- Keep the context package structured and copyable as Markdown.
- Do not invent requirements. Mark unknown values as `待补充`.
- Prefer concrete file/module paths over broad descriptions.
- Keep validation commands explicit.
