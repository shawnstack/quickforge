# 速构 QuickForge

React + Vite + Tailwind CSS 聊天应用，支持 YOLO 模式本地工作区工具。

## 技术栈
- **前端**：React 19、Vite 8、Tailwind CSS 4、shadcn 风格组件
- **聊天**：`@mariozechner/pi-web-ui`、`@mariozechner/pi-agent-core`、`@mariozechner/pi-ai`
- **服务端**：本地 Node.js 服务（`server/index.mjs`）
- **存储**：本地 JSON 文件，路径 `~/.quickforge/storage/`

## 常用命令

```bash
npm run dev      # 开发模式（服务端 + Vite，端口 :5176）
npm run build    # 生产构建
npm start        # 生产启动
npm run lint     # 代码检查
```

## 关键文件

| 路径 | 用途 |
|---|---|
| `src/` | React 前端 |
| `server/index.mjs` | 本地 API / 存储服务 |
| `vite.config.ts` | Vite 配置（Tailwind 插件） |
| `index.html` | 入口 HTML |
| `bin/quickforge.mjs` | CLI 入口 |

## YOLO 工具

开启 YOLO 模式后，智能体可调用：`list_dir`、`read_file`、`grep_files`、`write_file`、`edit_file`、`run_command`，操作范围限制在工作区根目录内。

## 存储

JSON 文件位于 `~/.quickforge/storage/`：`custom-providers.json`、`provider-keys.json`、`settings.json`、`sessions.json`、`sessions-metadata.json`。

## API 提供者

- OpenAI 兼容 `/v1/chat/completions`
- Anthropic Messages API
- 默认：LiteLLM 代理 `http://localhost:4000/v1`，模型 `anthropic/claude-sonnet-4`
