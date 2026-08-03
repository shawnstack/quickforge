# `src/` — React 前端

基于 React 19 + TypeScript 6 + Tailwind CSS 4 的前端应用。

## 目录结构

```
src/
├── components/          # React 组件
│   ├── chat/            # 聊天面板（含多个子模块）
│   ├── preview/          # 网页预览内容组件（iframe 加载本地 dev server URL）
│   ├── scheduled-tasks/ # 定时任务页面
│   ├── share/           # 对话分享
│   ├── sidebar/         # 侧边栏
│   ├── terminal/         # xterm.js 多终端 Dock
│   ├── ui/              # 基础 UI 组件
├── hooks/               # 自定义 React Hooks (14 个)
├── lib/                 # 前端工具库 (28 个模块)
├── App.tsx              # 主应用组件 (625 行)
├── index.css            # 全局样式 (293 行)
└── main.tsx             # 入口文件，初始化补丁并注册生产环境 PWA Service Worker
```

## 顶层文件

| 文件 | 说明 | 行数 |
|------|------|------|
| [main.tsx](../src/main.tsx) | React 入口，挂载 App，生产环境注册 PWA Service Worker | 24 |
| [App.tsx](../src/App.tsx) | 主组件，管理全局状态、Agent、路由、调度 | 684 |
| [index.css](../src/index.css) | 全局样式 (Tailwind + pi-web-ui + 自定义) | 346 |

### main.tsx (24 行)

- 从 `react-dom/client` 创建根节点
- 应用全局 CSS（`index.css`）
- 调用 `patchThinkingSelector()` 修补 pi-web-ui 的模型选择器
- 设置界面由 `components/settings/SettingsWorkspacePage.tsx` 以工作区式布局承载：左侧复用侧边栏背景与导航风格，右侧复用主对话区域背景；`hooks/useModelActions.ts` 负责打开设置页并选择初始 tab，`lib/settings-tabs.ts` 组装多个 `SettingsTab`，包含模型、Agent、MCP、插件、定时任务等管理页，其中“常规”页包含默认模型、工具展示、上下文管理、超过 30 天未更新对话的自动归档、网络代理和终端 Shell 配置；网络代理提供直连、跟随操作系统真实代理、手动 HTTP(S) 地址和 PAC 地址四种模式，自定义 PAC 地址仅 Desktop 支持，本地 API 始终直连；自动归档默认关闭，归档记录不会删除，可在“已归档对话”页查看和恢复；`lib/channels-settings-tab.ts` 的“渠道”页用于管理本地外部应用 bridge（当前内置微信渠道，通过 `weixin-acp` 接入 `qf acp`，默认使用全局默认工作区，也可选择已有项目启动；外部 ACP 会话持久化后通过 `sessions-changed` SSE 精准更新侧边栏，不使用固定轮询）；底部包含 `lib/about-settings-tab.ts` 的“关于”页，用于展示 GitHub、检查 npm 更新、触发本机外部更新器和重启后端服务；更新/重启期间页面轮询 `/api/health`，服务重启后自动刷新
- 调用 `applyClipboardPolyfill()` 应用剪贴板兼容处理
- 生产环境注册 `/sw.js`，启用轻量 PWA 安装和前端静态资源缓存；Capacitor 原生环境不注册 Service Worker
- Android 薄壳入口由 `components/mobile/MobileServerConnectPage.tsx` 与 `lib/mobile-server.ts` 提供：仅接受 `.ts.net` MagicDNS 完整域名或 Tailscale `100.64.0.0/10` 地址，可保存多个服务器地址并点击切换，直接导航到远端 QuickForge 页面，保持页面、REST、SSE 和 LAN Cookie 同源；下次启动自动连接最后使用的地址，侧栏底部可通过当前地址返回服务器设置
- 在 `<StrictMode>` 中渲染 `<App />` 组件

### App.tsx (684 行)

**用途**: 应用主组件，协调所有子组件和 hooks。

**核心状态**:
- `storageRef` — 存储实例引用
- `activeModelRef` — 当前活动模型
- `agentAccessModeRef` — Agent 权限模式状态（默认权限 / 完全访问权限）
- `activeProjectRef` — 当前活动的项目
- `needsModelSetup` — 是否需要模型设置
- `view` — 当前视图（chat / share-view）；Agent、MCP、插件、定时任务等管理能力收拢在工作区式设置页中

**主要 UI 区域**:
1. **侧边栏** (`ChatSidebar`) — 左侧导航
2. **聊天面板** (`ChatPanelHost`) — 主聊天区域
3. **空状态** (`ModelSetupEmptyState`) — 未配置模型时显示
4. **分享对话框** (`ShareConversationDialog`)
5. **共享会话页面** (`SharedConversationPage`)
6. **右侧工作区面板** (`WorkspaceInspector`) — 右侧统一工作区入口，顶部采用标签页式工作区，可打开文件、审查、终端、浏览器四类标签；Tab、活动 `activePanelTabId` 和 Review 子视图按 `projectId` 本地持久化。项目切换时通过 `key` 重建 Inspector，加载目标项目自己的状态；标题栏 Git、聊天文件链接、Reader / Browser 产物入口通过携带 `projectId` 的一次性请求打开，消费后即清除，因此折叠后重新展开不会重放。Markdown 和代码走 reader，HTML、SVG 和图片走 Browser；Markdown Reader 会优先渲染文档中的 Mermaid fenced code block，并保留源码切换和失败回退。
7. **项目目录选择器** (`ProjectDirectoryPicker`)
9. **Skills 管理** (`SkillsManagerPanel` / `SkillsDialog`) — 全局 Skills 从设置页进入，项目 Skills 仍由项目菜单打开对话框
10. **设置工作区页** (`SettingsWorkspacePage`) — 页面式设置界面，左侧设置导航复用侧边栏视觉，右侧设置内容复用主对话区域视觉，包含 Agent、Skills、MCP、插件、定时任务等管理页
11. **Toast 容器** — 后台任务通知
12. **错误边界** (`ErrorBoundary`) — 全局错误捕获

**关键函数**:
- `handleChatPanelEvent()` — 处理聊天面板事件
- `handleScheduledTaskNotification()` — 处理定时任务通知事件
- `subscribeToAgentEvents()` — 订阅全局 Agent 事件

### index.css 样式架构

全局样式入口 `src/index.css`，按顺序 `@import` pi-web-ui 预构建样式与 Tailwind，再叠加本地自定义。理解其层级关系是正确覆盖设计 token 的前提。

**覆盖 pi-web-ui 的设计 token 必须写在 unlayered `:root`，而非 `@theme`。** pi-web-ui 的 `app.css` 通过 *unlayered* `:root,:host{}` 输出设计 token（`--text-sm`、`--font-sans`、`--font-mono` 等），而 Tailwind v4 会把本地 `@theme` 块编译进 `@layer theme`。按 CSS 层叠规则，unlayered 声明优先级高于任何 `@layer`，因此在 `@theme` 中覆盖 pi-web-ui 已有的 token 会**静默失效**。正确做法：把需要覆盖的 token 写在 `@import` pi-web-ui **之后**的 unlayered `:root{}` 中——同属 unlayered、源顺序后者胜，覆盖才能生效。此结论已通过 Chrome headless 读取 `getComputedStyle` 实测确认。

**字体栈集中定义**：`--font-sans` / `--font-mono` 在 unlayered `:root` 统一定义一次，全局通过 `var(--font-sans)` / `var(--font-mono)` 引用（终端、Monaco、代码块等），避免逐组件复制字体栈。系统字体优先（不打包自定义 UI 字体），并显式补 CJK 回退（`PingFang SC` / `Microsoft YaHei` / `Noto Sans CJK SC`）保证中文跨平台度量一致。

**字号体系**：`html { font-size }` 是基准（默认 13px）；界面字号设置由 `lib/font-size-settings.ts` 的 `applyFontSizeSettings()` 写入 `root.style.fontSize` 驱动所有 rem 单位。`--text-sm` 刻意等于 `1rem`（随界面字号缩放），消息正文字号走独立的 `--quickforge-message-font-size` 变量。Monaco 与终端等固定像素字号场景通过 `getCodeFontMetrics()` / `getTerminalFontMetrics()` 从界面字号派生，并监听 `quickforge:font-size-settings-changed` 做运行时刷新。

**本地 Tailwind utilities 源顺序坑**：本地 Tailwind 构建产物晚于 pi-web-ui 的预构建 utilities 输出，`index.css` 中已用一段显式 `@media (width >= 48rem) { .md\:block { display: block } }` 修正侧边栏 `md:block` 被后续 `.hidden` 覆盖的问题。
