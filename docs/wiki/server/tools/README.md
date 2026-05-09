# `server/tools/` — 工作区工具

当 YOLO 模式启用时，Agent 可获得的工作区工具。工具定义和执行 handler 都在此目录。

## 文件清单

| 文件 | 说明 |
|------|------|
| [definitions.mjs](definitions.mjs.md) | 工具元数据定义 (名称、参数 Schema) |
| [index.mjs](index.mjs.md) | 工具执行 handler (375 行) |

---

## `definitions.mjs` (121 行)

使用 TypeBox 定义工具参数 Schema，是工具元数据的单一数据源。

### 内置工具列表

| 工具名 | 说明 |
|--------|------|
| `get_project_info` | 获取项目目录信息 |
| `list_dir` | 列出目录内容 |
| `read_file` | 读取文件内容 |
| `grep_files` | 文本/正则搜索文件 |
| `write_file` | 创建或覆写文件 |
| `edit_file` | 替换文件中的文本 |
| `run_command` | 在工作区目录执行 shell 命令 |
| `activate_skill` | 加载 Agent Skill 指令 |
| `read_skill_resource` | 读取 Skill 资源文件 |

### 工具参数 Schema

- 使用 TypeBox 的 `Type.Object` 定义结构化参数
- 支持可选/必填参数、描述、默认值
- 所有文件操作限制在工作区根目录内 (安全约束)

## `index.mjs` (375 行)

实现每个工具的 execute handler。

| Handler | 功能 |
|---------|------|
| `toolGetProjectInfo` | 读取项目配置，返回项目名、路径、ID |
| `toolListDir` | 调用 `fs.readdir` + 递归 `walkFiles` |
| `toolReadFile` | 调用 `fs.readFile`，支持行数截断 |
| `toolGrepFiles` | 调用 `grep` 或 JS 实现的正则搜索 |
| `toolWriteFile` | 调用 `fs.writeFile`，先创建父目录 |
| `toolEditFile` | 使用 `text-diff` 实现精确文本替换 |
| `toolRunCommand` | 使用 `child_process.spawn` 执行命令 |
| `activateSkill` | 加载并激活指定 Skill 的指令内容 |
| `readSkillResource` | 读取 Skill 绑定的资源文件 |

### 安全限制

- 所有文件路径经 `assertSafeWorkspacePath` 校验
- Shell 命令从工作区目录启动
- 文件读写限制在工作区根目录内
- 文本差异编辑 (edit_file) 使用自有 diff 算法而非 `diff` 工具
