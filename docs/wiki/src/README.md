# `src/` — React 前端

基于 React 19 + TypeScript 6 + Tailwind CSS 4 的前端应用，使用 `@mariozechner/pi-web-ui` 和 `@mariozechner/pi-ai` 作为 AI SDK。

## 目录结构

```
src/
├── components/          # React 组件
│   ├── chat/            # 聊天面板
│   ├── scheduled-tasks/ # 定时任务页面
│   ├── share/           # 对话分享
│   ├── sidebar/         # 侧边栏
│   └── ui/              # 基础 UI 组件
├── hooks/               # 自定义 React Hooks
├── lib/                 # 前端工具库
├── App.tsx              # 主应用组件 (548 行)
├── index.css            # 全局样式 (337 行)
└── main.tsx             # 入口文件 (14 行)
```

## 顶层文件

| 文件 | 说明 |
|------|------|
| [main.tsx](main.tsx.md) | React 入口，挂载 App，执行 `patchThinkingSelector` |
| [App.tsx](App.tsx.md) | 主组件，管理全局状态、Agent、路由、调度 |
| [index.css](index.css.md) | 全局样式 (Tailwind + pi-web-ui + 自定义) |
