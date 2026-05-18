# 速构 QuickForge 使用教程

QuickForge 是一个本地优先的 AI 对话应用，支持普通聊天、项目对话、模型管理，以及 YOLO 模式下的本地工作区工具。

本教程按功能优先级组织：

- **P0：首次使用必须完成** — 不完成这些步骤无法正常开始对话。
- **P1：核心高频功能** — 日常使用最常用的能力。
- **P2：进阶增强功能** — 项目工具、YOLO 等高级用法。
- **P3：排错与维护** — 常见问题、数据位置和安全建议。

## 目录

- [P0：首次使用必须完成](#p0首次使用必须完成)
  - [1. 启动 QuickForge](#1-启动-quickforge)
  - [2. 配置第一个模型](#2-配置第一个模型)
  - [3. 开始第一轮普通对话](#3-开始第一轮普通对话)
- [P1：核心高频功能](#p1核心高频功能)
  - [4. 模型管理](#4-模型管理)
  - [5. 会话管理](#5-会话管理)
  - [6. 项目对话](#6-项目对话)
- [P2：进阶增强功能](#p2进阶增强功能)
  - [7. YOLO 模式与本地工具](#7-yolo-模式与本地工具)
  - [8. 本地工作区工具示例](#8-本地工作区工具示例)
- [P3：排错与维护](#p3排错与维护)
  - [9. 常见问题](#9-常见问题)
  - [10. 数据存储位置](#10-数据存储位置)
  - [11. 安全建议](#11-安全建议)

---

## P0：首次使用必须完成

### 1. 启动 QuickForge

在项目目录中安装依赖并启动：

```bash
npm install
npm run dev
```

开发模式会同时启动本地 Node.js 服务和 Vite 前端，默认访问地址：

```text
http://127.0.0.1:5176
```

生产模式：

```bash
npm run build
npm start
```

Windows 用户也可以双击：

- `dev-quickforge.bat`：开发模式
- `start-quickforge.bat`：生产模式

> QuickForge 依赖本地服务保存设置、API Key、会话和项目配置。如果页面提示“本地服务不可用”，请先确认启动命令是否仍在运行。

### 2. 配置第一个模型

第一次进入 QuickForge 时，如果还没有配置任何模型，聊天区会显示“还没有配置模型”的引导页，而不是显示一个默认模型。

推荐流程：

1. 点击聊天区的 **添加模型**。
2. 在设置页填写提供商信息。
3. 至少添加一个模型 ID。
4. 保存。
5. 关闭设置页后，QuickForge 会自动选择第一个可用模型并进入聊天界面。

需要填写的常见字段：

| 字段 | 说明 |
|---|---|
| Provider name | 提供商名称，例如 LiteLLM、OpenRouter、DeepSeek |
| Protocol type | 协议类型。大多数服务选择 OpenAI Compatible |
| Base URL | API 地址，通常以 `/v1` 结尾 |
| API Key | 服务商提供的密钥；本地服务或 Ollama 可留空 |
| Model ID | 模型 ID，例如 `anthropic/claude-sonnet-4` |
| Context Window | 上下文长度 |
| Max Tokens | 单次输出上限 |
| Reasoning / Thinking model | 如果模型支持推理/思考，可开启 |

#### LiteLLM 示例

```text
Provider name: LiteLLM
Protocol type: OpenAI Compatible
Base URL: http://localhost:4000/v1
Model ID: anthropic/claude-sonnet-4
API Key: 可留空，取决于你的 LiteLLM 配置
```

如果你正在使用 LiteLLM，也可以在首次引导页点击 **使用 LiteLLM 示例配置** 快速创建该配置。

#### OpenRouter 示例

```text
Provider name: OpenRouter
Protocol type: OpenAI Compatible
Base URL: https://openrouter.ai/api/v1
Model ID: anthropic/claude-3.5-sonnet
API Key: 你的 OpenRouter API Key
```

#### DeepSeek 示例

```text
Provider name: DeepSeek
Protocol type: OpenAI Compatible
Base URL: https://api.deepseek.com/v1
Model ID: deepseek-chat
API Key: 你的 DeepSeek API Key
```

如果使用 DeepSeek V4 等思考模型，请按实际模型能力开启 **Reasoning / Thinking model**。

#### Ollama 示例

```text
Provider name: Ollama
Protocol type: OpenAI Compatible
Base URL: http://localhost:11434/v1
Model ID: qwen2.5-coder:7b
API Key: 可留空
```

> 不同服务商的模型 ID 可能经常变化，请以服务商控制台或文档为准。

### 3. 开始第一轮普通对话

配置模型后，你会看到正常聊天界面。

常用操作：

- 在底部输入框描述问题或任务。
- 按发送按钮开始生成。
- 生成过程中可以停止。
- 助手回复下方可以复制回答。
- 普通对话不会绑定项目，也不会启用本地工作区工具。

---

## P1：核心高频功能

### 4. 模型管理

点击右上角 **设置** 进入模型配置。

你可以：

- 添加新的 Provider。
- 在一个 Provider 下添加多个模型。
- 编辑 Provider 名称、Base URL、协议和 API Key。
- 删除不再使用的 Provider。
- 点击聊天输入区附近的模型选择入口切换模型。

模型选择规则：

- QuickForge 只显示你已配置的自定义模型。
- 如果保存过当前模型，启动时会优先恢复该模型。
- 如果保存的模型已经不存在，会自动选择第一个已配置模型。
- 如果没有任何已配置模型，会进入“还没有配置模型”的引导页。

#### Reasoning / Thinking 模型

如果模型支持推理或思考模式，例如某些 DeepSeek、Qwen、OpenRouter 模型，可以开启 **Reasoning / Thinking model**。

建议：

- 不确定模型是否支持时，先关闭。
- 如果服务商文档明确支持 reasoning/thinking，再开启。
- 开启后 QuickForge 会默认使用更适合推理模型的 thinking 设置。

### 5. 会话管理

左侧栏展示项目和对话列表。

你可以：

- **新建普通对话**：点击新建对话入口。
- **打开历史会话**：在左侧会话列表中点击。
- **重命名对话**：对会话执行重命名操作。
- **删除对话**：删除后不可恢复。
- **复制助手回答**：在助手消息下方点击复制。
- **回滚对话**：在用户消息下方点击回滚，删除该轮之后的上下文。
- **分支对话**：在助手消息下方点击分支，从该位置创建新会话。

回滚和分支适合用于：

- 尝试不同提示词。
- 从某个中间状态重新生成。
- 保留原对话，同时开启新方向。

### 6. 项目对话

项目对话会绑定一个本地项目目录，用于后续启用工作区工具。

流程：

1. 在左侧栏点击 **添加项目**。
2. 选择或输入本地项目目录。
3. 在项目下新建项目对话。
4. 在项目对话中开启 YOLO 后，模型可以访问该项目目录内的文件。

普通对话和项目对话的区别：

| 类型 | 是否绑定项目 | 是否可使用本地工具 |
|---|---:|---:|
| 普通对话 | 否 | 否 |
| 项目对话 | 是 | 开启 YOLO 后可用 |

> 即使开启 YOLO，工具访问范围也会限制在绑定项目目录内。

---

## P2：进阶增强功能

### 7. YOLO 模式与本地工具

YOLO 模式用于授权模型直接操作本地项目工作区。它只在项目对话中有意义。

开启位置：

- 项目对话底部输入框附近的 **YOLO** 按钮。

开启后，模型可以调用这些工具：

| 工具 | 作用 |
|---|---|
| `read_file` | 读取项目内的文本文件 |
| `grep_files` | 搜索项目文件内容 |
| `replace_in_files` | 使用搜索结果批量替换文件内容，默认只预览 diff |
| `write_file` | 创建或覆盖文件 |
| `edit_file` | 用精确文本替换编辑文件 |
| `run_command` | 在项目目录中运行命令，也可用于通过 shell 查看目录 |

风险说明：

- YOLO 模式不会对每次工具调用弹出确认。
- 文件类工具会限制在项目根目录内。
- 如需查看目录，模型会通过 `run_command` 执行 shell 命令；`run_command` 只是从项目目录启动命令，并不是文件系统沙箱，命令会以当前系统用户权限运行。
- 建议只对可信模型和可信项目开启。
- 重要项目建议先提交 Git 或备份。

### 8. 本地工作区工具示例

下面是一些适合项目对话 + YOLO 的提示词。

#### 查看项目结构

```text
帮我查看这个项目的目录结构，并总结主要模块。
```

#### 搜索函数或关键词

```text
搜索所有使用 saveActiveModel 的地方，并说明调用链。
```

#### 修改文件

```text
把首次无模型时的提示文案改得更友好，并保持中英文一致。
```

#### 运行构建并修复错误

```text
运行 npm run build。如果有错误，请定位原因并修复。
```

#### 安全使用建议

可以先要求模型制定计划：

```text
先不要修改文件。请先阅读相关代码，说明你的修改方案，等我确认后再执行。
```

---

## P3：排错与维护

### 9. 常见问题

#### 页面提示“本地 QuickForge 服务不可用”

原因通常是本地服务没有启动或端口被占用。

处理方式：

1. 确认 `npm run dev` 或 `npm start` 仍在运行。
2. 检查终端是否有报错。
3. 确认访问地址是否为 `http://127.0.0.1:5176` 或实际配置端口。
4. 如果端口冲突，调整环境变量后重启。

#### 没有模型可选

原因：还没有保存任何自定义模型。

处理方式：

1. 点击 **添加模型** 或右上角 **设置**。
2. 添加 Provider、Base URL 和至少一个 Model ID。
3. 保存后关闭设置页。

#### API Key 不生效

检查：

- API Key 是否填在正确 Provider 下。
- Base URL 是否正确。
- Model ID 是否属于该服务商。
- 服务商账号是否有额度或权限。

#### 模型返回 401 / 403 / 404

常见含义：

| 状态码 | 可能原因 |
|---|---|
| 401 | API Key 错误或缺失 |
| 403 | 账号无权限、额度不足或模型不可用 |
| 404 | Base URL 或 Model ID 不正确 |

#### 本地工具无法使用

检查：

1. 当前是否是项目对话。
2. 是否已绑定项目目录。
3. 是否开启 YOLO。
4. 工具路径是否在项目目录范围内。

#### YOLO 开启后仍不能读写文件

可能原因：

- 当前对话不是项目对话。
- 项目目录已不存在或无权限。
- 文件路径超出项目根目录。
- 操作系统权限限制。

#### 项目目录切换失败

处理方式：

- 确认目录仍然存在。
- 确认当前用户有访问权限。
- 删除旧项目后重新添加。

### 10. 数据存储位置

QuickForge 使用本地 JSON 文件保存数据。

默认路径：

```text
~/.quickforge/storage/
```

Windows 通常为：

```text
%USERPROFILE%\.quickforge\storage\
```

主要文件：

| 文件 | 内容 |
|---|---|
| `custom-providers.json` | 自定义 Provider 和模型配置 |
| `provider-keys.json` | API Key |
| `settings.json` | 当前模型、YOLO 状态、语言等设置 |
| `sessions.json` | 完整会话内容 |
| `sessions-metadata.json` | 会话列表元数据 |

可通过环境变量调整数据目录：

```text
QUICKFORGE_DATA_DIR=/path/to/data
```

### 11. 安全建议

- API Key 保存在本机，请保护好本机账号和数据目录。
- 不要把 `~/.quickforge/storage/` 上传到公开仓库。
- 对重要项目开启 YOLO 前，建议先提交 Git。
- 对不可信模型，不建议开启 YOLO。
- 让模型运行命令前，可以先要求它解释命令用途。
- 如果模型要大规模改动文件，建议先让它列出计划，再确认执行。

---

## 推荐上手路径

如果你是第一次使用，按这个顺序即可：

1. 启动 QuickForge。
2. 添加第一个模型。
3. 进行普通对话。
4. 添加项目目录。
5. 新建项目对话。
6. 在可信项目中开启 YOLO。
7. 让模型阅读、修改、构建你的项目。
