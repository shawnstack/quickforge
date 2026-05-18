# `server/tools/` — 工作区工具

当 YOLO 模式启用时，Agent 可获得的工作区工具。工具定义和执行 handler 都在此目录。

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [definitions.mjs](../../server/tools/definitions.mjs) | 工具元数据定义 (名称、参数 Schema) | 122 |
| [index.mjs](../../server/tools/index.mjs) | 工具执行 handler | 677 |

---

## definitions.mjs (122 行)

使用 TypeBox 定义工具参数 Schema，是工具元数据的单一数据源。

### 内置工具列表

| 工具名 | 说明 |
|--------|------|
| `read_file` | 读取文件内容 |
| `grep_files` | 文本/正则搜索文件 |
| `write_file` | 创建或覆写文件 |
| `edit_file` | 替换文件中的文本 |
| `replace_in_files` | 基于 ripgrep 搜索候选并批量替换文件，默认 dry-run 预览 diff |
| `run_command` | 在工作区目录执行 shell 命令，也用于查看目录内容 |
| `activate_skill` | 加载 Agent Skill 指令 |
| `read_skill_resource` | 读取 Skill 资源文件 |

`write_file`、`edit_file` 和 `replace_in_files` 标记为 `executionMode: 'sequential'` 以确保执行顺序。

## index.mjs (677 行)

实现每个工具的 execute handler。

### 工具处理器清单

| Handler | 对应工具 | 功能描述 |
|---------|---------|---------|
| `toolReadFile` | `read_file` | 读取文件，支持 offset/limit 分页 |
| `toolGrepFiles` | `grep_files` | 使用内置 ripgrep 优先搜索文件内容，支持正则、glob、上下文和只返回匹配文件；异常时回退 Node.js 搜索 |
| `toolWriteFile` | `write_file` | 写入文件，自动创建父目录 |
| `toolEditFile` | `edit_file` | 查找并替换文本，验证唯一性 |
| `toolReplaceInFiles` | `replace_in_files` | 使用 ripgrep 查找候选文件并跨文件替换，默认 dry-run 返回 diff 预览 |
| `toolRunCommand` | `run_command` | 执行 shell 命令，支持超时 |
| `toolActivateSkill` | `activate_skill` | 激活 Agent Skill |
| `toolReadSkillResource` | `read_skill_resource` | 读取技能资源 |

### 安全特性
- **路径安全**: `resolveWorkspacePath()` 确保操作不超出工作区范围
- **敏感路径保护**: `assertSafeWorkspacePath()` 阻止访问 `.git/`、`.env`、密钥文件等
- **ripgrep 内置搜索**: `grep_files` 优先使用 `@vscode/ripgrep` 随包提供的 `rg`，支持 glob、上下文行、只返回匹配文件；不可用或正则不兼容时回退 Node.js 实现
- **搜索安全边界**: ripgrep 调用使用 `spawn(..., { shell: false })`，强制排除敏感文件 glob，并默认保持旧搜索行为（`--hidden --no-ignore` + 内置排除规则）
- **写入防误**: `write_file` 验证文件在项目内；`edit_file` 确保 `oldText` 唯一匹配；`replace_in_files` 默认 `dryRun=true` 只预览 diff，显式 `dryRun=false` 才写入
- **命令超时**: `run_command` 支持可配置超时，自动清理子进程
- **Error 对象传递**: 工具错误通过 `statusCode` 属性传递 HTTP 状态码
