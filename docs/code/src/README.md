# `src/` — React 前端源代码

**目录**: `src/`

前端使用 React 19 + TypeScript + Vite + Tailwind CSS 4 构建。UI 组件基于 `@mariozechner/pi-web-ui` 库构建。

## 目录结构

```
src/
├── main.tsx           # 应用入口
├── App.tsx            # 主应用组件（548行）
├── index.css          # 全局样式 + Tailwind
├── components/        # UI 组件
│   ├── chat/          # 聊天面板相关
│   ├── scheduled-tasks/ # 定时任务页面
│   ├── share/         # 分享对话相关
│   ├── sidebar/       # 侧边栏
│   └── ui/            # 通用 UI 组件
├── hooks/             # 自定义 React Hooks（14个）
└── lib/               # 工具库和模块（18个文件）
```

---

## 文件详情

### [`main.md`](main.md)

**用途**: 应用入口文件。挂载 React 根节点并调用 `patchThinkingSelector()` 修复 DeepSeek 推理模式。

**关键功能**:
- 调用 `patchThinkingSelector()` 修复模型选择器
- 在 `#root` 元素上渲染 `<App />` 组件

### [`App.md`](App.md)

**用途**: 主应用组件（548 行），负责应用的整体布局和状态协调。

**主要功能**:
- 管理 Storage、Model、YOLO 模式、Project 等顶级状态
- 集成所有 hooks：`useProject`, `useYoloMode`, `useCrossTabSync`, `useAgentManager`, `useSessionPagination`, `useTaskToasts`, `useAppBootstrap`, `useModelActions`, `useChatActions`, `useProjectActions`, `useSessionActions`, `useYoloActions`, `useVisibleRuntimeStatuses`
- 渲染主要 UI 区域：侧边栏、聊天面板、定时任务页面、分享对话框
- 处理 SSE 事件订阅（定时任务通知）
- 管理 Toast 通知

### [`index.css`](index.css)

**用途**: 全局样式文件，导入 Tailwind CSS 和 `pi-web-ui` 样式。

**关键内容**:
- 导入 `@mariozechner/pi-web-ui/app.css` 和 Tailwind
- 自定义 `@theme` 变量
- 修复 `md:block` 优先级覆盖问题
- 基础样式重置（box-sizing、字体、滚动）

---

## [`components/`](components/README.md)

包含所有 UI 组件的子目录。
