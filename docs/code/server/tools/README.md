# `server/tools/` — 工具定义与处理器

**路径**: `server/tools/`

---

## definitions.mjs (121 行)

**用途**: 工具定义的唯一权威来源。使用 TypeBox 定义参数 schema。

### Workspace 工具列表

| 工具名 | 用途 | 关键参数 |
|--------|------|---------|
| `get_project_info` | 获取当前绑定的项目信息 | 无参数 |
| `list_dir` | 列出目录内容 | `path` (可选) |
| `read_file` | 读取文件内容 | `path`, `offset`, `limit` |
| `grep_files` | 搜索文件内容 | `query`, `path`, `regex`, `caseSensitive`, `limit` |
| `write_file` | 创建或覆盖文件 | `path`, `content` |
| `edit_file` | 替换编辑文件 | `path`, `oldText`, `newText` |
| `run_command` | 运行 Shell 命令 | `command`, `timeoutSeconds` |
| `activate_skill` | 加载 Agent Skill | `name` |
| `read_skill_resource` | 读取技能资源文件 | `skill`, `path`, `offset`, `limit` |

`write_file` 和 `edit_file` 标记为 `executionMode: 'sequential'` 以确保执行顺序。

## index.mjs (375 行)

**用途**: 工具处理器的具体实现。

### 工具处理器清单

| 函数 | 对应工具 | 功能描述 |
|------|---------|---------|
| `toolGetProjectInfo` | `get_project_info` | 返回活动项目的名称、路径和 ID |
| `toolListDir` | `list_dir` | 读取目录并格式化输出（按类型排序） |
| `toolReadFile` | `read_file` | 读取文件，支持 offset/limit 分页 |
| `toolGrepFiles` | `grep_files` | 递归搜索文件内容，支持正则 |
| `toolWriteFile` | `write_file` | 写入文件，自动创建父目录 |
| `toolEditFile` | `edit_file` | 查找并替换文本，验证唯一性 |
| `toolRunCommand` | `run_command` | 执行 shell 命令，支持超时 |
| `toolActivateSkill` | `activate_skill` | 激活 Agent Skill |
| `toolReadSkillResource` | `read_skill_resource` | 读取技能资源 |

### 安全特性
- **路径安全**: `resolveWorkspacePath()` 确保操作不超出工作区范围
- **敏感路径保护**: `assertSafeWorkspacePath()` 阻止访问 `.git/`、`.env`、密钥文件等
- **写入防误**: `write_file` 验证文件在项目内；`edit_file` 确保 `oldText` 唯一匹配
- **命令超时**: `run_command` 支持可配置超时，自动清理子进程
- **Error 对象传递**: 工具错误通过 `statusCode` 属性传递 HTTP 状态码
