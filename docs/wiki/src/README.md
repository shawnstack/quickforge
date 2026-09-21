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
├── hooks/               # 自定义 React Hooks (18 个)
├── lib/                 # 前端工具库 (87 个模块)
├── storage/             # 自研存储层（StorageBackend 契约 + 4 个 Store + AppStorage 单例，见 [storage/](storage/)）
├── App.tsx              # 主应用组件 (2340 行)
├── index.css            # 全局样式 (8039 行)
└── main.tsx             # 入口文件，初始化补丁并注册生产环境 PWA Service Worker
```

## 顶层文件

| 文件 | 说明 | 行数 |
|------|------|------|
| [main.tsx](../src/main.tsx) | React 入口，渲染前经 Web Locks 单窗口守卫再挂载 App，生产环境注册 PWA Service Worker | 83 |
| [App.tsx](../src/App.tsx) | 主组件，管理全局状态、Agent、路由、调度 | 2340 |
| [index.css](../src/index.css) | 全局样式 (Tailwind + 自托管设计 token + 自定义) | 8039 |

### main.tsx (69 行)

- 从 `react-dom/client` 创建根节点
- 应用全局 CSS（`index.css`）
- 设置界面由 `components/settings/SettingsWorkspacePage.tsx` 以工作区式布局承载：左侧复用侧边栏背景与导航风格，右侧复用主对话区域背景；`hooks/useModelActions.ts` 负责打开设置页并选择初始 tab；`lib/settings-tabs.ts` 用 `settingsTabDefinitions` 声明导航顺序并导出 `SettingsInitialTab` 类型，各项内容由 `lib/react-settings-tabs.tsx` 的 `ReactSettingsTabContent` 渲染，包含模型、Agent、MCP、插件、定时任务和分享链接等管理页；「分享链接」由 `components/share/ShareLinksSettingsPage.tsx` 统一管理当前实例全部对话分享，支持搜索、复制、打开、停用、按新有效期恢复和永久删除；其中“常规”页包含默认模型、工具展示、上下文管理、超过 30 天未更新对话的自动归档、网络代理和终端 Shell 配置；网络代理提供直连、跟随操作系统真实代理、手动 HTTP(S) 地址和 PAC 地址四种模式，自定义 PAC 地址仅 Desktop 支持，本地 API 始终直连；自动归档默认关闭，归档记录不会删除，可在“已归档对话”页查看和恢复；`components/settings/tabs/ChannelsSettingsTab.tsx` 的“渠道”页用于管理本地外部应用 bridge（当前内置微信渠道，通过 `weixin-acp` 接入 `qf acp`，默认使用全局默认工作区，也可选择已有项目启动；外部 ACP 会话持久化后通过 `sessions-changed` 事件（经 `GET /api/agents/events` 全局流转发）精准更新侧边栏，不使用固定轮询）；底部包含 `components/settings/tabs/AboutSettingsTab.tsx` 的“关于”页，用于展示 GitHub、检查 npm 更新、触发本机外部更新器和重启后端服务；更新/重启期间页面轮询 `/api/health`，服务重启后自动刷新
- 调用 `applyClipboardPolyfill()` 应用剪贴板兼容处理
- 生产环境注册 `/sw.js`，启用轻量 PWA 安装和前端静态资源缓存；Capacitor 原生环境不注册 Service Worker
- Android 薄壳入口由 `components/mobile/MobileServerConnectPage.tsx` 与 `lib/mobile-server.ts` 提供：启动后先由用户选择服务器连接方式（局域网 / Tailscale 直连）；服务器选择页以已保存列表为主，点击服务器行才会连接，`lastUsedUrl` 仅用于显示“上次使用”标记。添加表单仅在首次使用或主动添加时展开；表单会提示支持的 Tailscale 地址范围并预览规范化地址，别名编辑与删除收拢在服务器管理区，删除前需要确认。连接地址仅接受 `.ts.net` MagicDNS 完整域名或 Tailscale `100.64.0.0/10` 地址，远端页面继续保持页面、REST、SSE 和 LAN Cookie 同源；侧栏底部可通过当前地址返回服务器选择页
- 渲染前调用 `lib/window-guard.ts` 的 `acquireAppWindowGuard()`（Web Locks 严格单窗口，ifAvailable 抢锁很快）：granted/unsupported 正常渲染 App；blocked 窗口只渲染 `WindowGuardNotice` 拦截页——不加载 App、不建立 SSE 连接，纯静态提示用户关闭本窗口并回到已有窗口使用（不提供关闭按钮：浏览器不允许脚本关闭手动打开的标签页）
- 在 `<StrictMode>` 中渲染 `<App />` 组件

### App.tsx (684 行)

**用途**: 应用主组件，协调所有子组件和 hooks。

终端请求、顶栏 Git 编排、启动/会话加载过渡已分别移入 `useAppTerminal.ts`、`useAppGit.ts`、`useAppLoadingTransitions.ts`（参见 [hooks 导航](hooks/README.md#app-三域编排phase-hooks)）。各模块按 state/effects/actions 分阶段调用，保留原 effect 相对顺序；跨域 project scope 失效处理、JSX、URL 基础 hooks 仍由原入口持有，不新增 context 或重建既有基础 hooks。

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
6. **右侧工作区面板** (`WorkspaceInspector`) — 右侧统一工作区入口，顶部采用标签页式工作区，可打开文件、审查、终端、浏览器和 subagent 单次运行详情。点击聊天中的 subagent 运行摘要会打开或激活对应 `runId` 的运行时 Tab；同一次运行复用原 Tab，不同运行独立并存并实时更新。Goal 入口也复用该侧栏：运行条编辑 icon 打开 edit，置顶摘要 Goal 分组（标题 + 计数 + criteria 只读行）的导航按钮打开 progress；`GoalInspectorContent` 承担进度/验收/阶段动作与目标编辑；预算耗尽的继续入口打开 progress 内联额度确认，展示真实 usage 与耗尽维度默认增量（仅耗尽轮次追加配置轮次，默认 20，并移除旧时间上限）。`ServerAgent` 预检绑定确认时旧 goalId/revision，仅 `extend_resume` 使用服务端 CAS；失败对账不盲重发，关闭仅取消未发 POST、已发等待结算。追加保留 usage/计划证据，仍不足保持 paused；足够后无计划 planning、有计划 running（不需要确认），当前无需人工批准计划。Goal Tab 按 `sessionId + goalId` 复用，进度/edit 为同一运行时 Tab 的子视图。Goal 与 subagent Tab 不持久化；其余 Tab、活动 `activePanelTabId`、Review 子视图、Reader 左侧导航显示状态按 `projectId + sessionId` 本地隔离恢复；Inspector 展开状态不再持久化/恢复，页面生命周期内默认收起、仅用户手动或「附着后新 present_files 自动预览」时打开。新建空白会话先使用不落盘的 deferred runtime scope；首次发送创建真实 `sessionId` 时沿用该 runtime scope，不改变组件 `key`，因此内存状态保留并随后写入真实会话 key。普通会话切换会更换 runtime scope 并重建 Inspector。标题栏、聊天文件 resolve、产物预览和 subagent 等一次性打开请求携带 `projectId + runtimeScopeId`，发起、异步完成与 Inspector 消费均校验，避免同项目旧会话请求串入新会话；历史无项目 subagent 请求仍按兼容语义处理。Inspector 整体宽度仍是全局布局偏好。Markdown 和代码走 Reader，HTML、SVG 和图片走 Browser；Markdown Reader 会优先渲染文档中的 Mermaid fenced code block，并保留源码切换和失败回退。
7. **项目目录选择器** (`ProjectDirectoryPicker`) — 支持路径输入与目录树浏览，目录列表头部提供「新建目录」按钮（内联输入名称，创建成功直接进入新目录）；快捷入口来自服务端 filesystem roots（Home/Desktop/Documents/当前项目/盘符）
8. **Skills 管理** (`SkillsManagerPanel` / `SkillsDialog`) — 全局 Skills 从设置页进入，项目 Skills 仍由项目菜单打开对话框
9. **设置工作区页** (`SettingsWorkspacePage`) — 页面式设置界面，左侧设置导航复用侧边栏视觉，右侧设置内容复用主对话区域视觉，包含 Agent、Skills、MCP、插件、定时任务等管理页
10. **Toast 容器** — 后台任务通知
11. **错误边界** (`ErrorBoundary`) — 全局错误捕获

**关键函数**:
- `handleChatPanelEvent()` — 处理聊天面板事件
- `handleScheduledTaskNotification()` — 处理定时任务通知事件
- `subscribeToAgentEvents()` — 订阅全局 Agent 事件

### index.css 样式架构

全局样式入口 `src/index.css`，先 `@import "tailwindcss"`，再以 unlayered 块自托管主题基础（设计 token、body 基线、全局细滚动条、动画；此前来自 UI 包的预构建 `app.css`，该包已卸载），最后叠加本地自定义。理解其层级关系是正确覆盖设计 token 的前提。

**覆盖设计 token 必须写在 unlayered `:root`，而非 `@theme`。** 这些 token 现在由 `src/index.css` 顶部以 *unlayered* `:root{}` / `.dark{}` 自托管（值沿用卸载前主题默认值的原值，含 `--text-sm`、`--font-sans`、`--font-mono` 等），而 Tailwind v4 会把本地 `@theme` 块编译进 `@layer theme`。按 CSS 层叠规则，unlayered 声明优先级高于任何 `@layer`，因此在 `@theme` 中覆盖这些 token 会**静默失效**。正确做法：把需要覆盖的 token 写在 token 块**之后**的 unlayered `:root{}`（`index.css` 中已有一段专门承载覆盖）里——同属 unlayered、源顺序后者胜，覆盖才能生效。此结论已通过 Chrome headless 读取 `getComputedStyle` 实测确认。

**字体栈集中定义**：`--font-sans` / `--font-mono` 在 unlayered `:root` 统一定义一次，全局通过 `var(--font-sans)` / `var(--font-mono)` 引用（终端、Monaco、代码块等），避免逐组件复制字体栈。系统字体优先（不打包自定义 UI 字体），并显式补 CJK 回退（`PingFang SC` / `Microsoft YaHei` / `Noto Sans CJK SC`）保证中文跨平台度量一致。

**字号体系**：`html { font-size }` 是基准（默认 13px）；界面字号设置由 `lib/font-size-settings.ts` 的 `applyFontSizeSettings()` 写入 `root.style.fontSize` 驱动所有 rem 单位。`--text-sm` 刻意等于 `1rem`（随界面字号缩放），消息正文字号走独立的 `--quickforge-message-font-size` 变量。聊天区内与消息同屏的行统一取消息字号基准 `calc(var(--quickforge-message-font-size, 14px) * 0.875)`：过程摘要行、阶段/工具组摘要、接管后的思考行（`.quickforge-process-thinking-header`）以及工具摘要行（local / MCP / subagent 壳、兜底工具卡首行、generate_image 首行）——避免界面字号与消息字号两套基准在同一屏漂移（默认 R=M=13px 下 = 11.375px）。Monaco 与终端等固定像素字号场景通过 `getCodeFontMetrics()` / `getTerminalFontMetrics()` 从界面字号派生，并监听 `quickforge:font-size-settings-changed` 做运行时刷新。

**本地 Tailwind utilities 源顺序坑**：`index.css` 中已用一段显式 `@media (width >= 48rem) { .md\:block { display: block } }` 修正侧边栏 `md:block` 被后续 `.hidden` 覆盖的问题。

**决策记录（R1/R2 相关，勿误判为回归）**
- **`dark:` 变体走系统媒体查询**：`index.css` 没有 `@custom-variant dark`，`dark:` 变体沿用 Tailwind 默认的 `prefers-color-scheme` 媒体查询；移除 pi-web-ui 的 `app.css` 前后行为一致（已核实预编译产物中该指令本就被剥离）。因此「界面外观 = 暗色 + 系统 = 亮色」时，部分 `dark:` 工具类不随 `.dark` class 切换，属既有行为而非本次回归。若要改成 class 驱动，需显式加入 `@custom-variant dark (&:where(.dark, .dark *))` 并单独评估改动面（token 侧仍由 unlayered `.dark{}` 提供）。
- **数学公式已恢复（KaTeX，2026-09-19 第十七轮）**：聊天 Markdown 重新按 KaTeX 渲染数学公式——`src/lib/chat-math.ts` 三段式（preprocessLatexDelimiters 在进 react-markdown 前把 \(...\)/\[...\] 换成占位 token + `rehypeQfMath` rehype 插件生成 `qf-math` 元素 + `src/components/chat/surface/KatexMath.tsx` 渲染，`katex/dist/katex.min.css` 在组件内引入），四定界符（行内 `$…$`、块级 `$$…$$`、行内反斜杠圆括号、块级反斜杠方括号）与旧 marked 扩展对齐：**行中与行首的 `$$…$$` 一样渲染为块级公式**（对齐旧 `blockMathDollar` 的 `start` 非空即起块、`level:'block'` 注册为 `startBlock`），保留「定界符内容不含 `$`、`.trim()`」两项旧约束；行中公式按旧块级标记拆段输出（`<p>前文 </p>` + `<div class="my-4">` 公式 + `<p> 后文</p>`），不再嵌进段落，`katex` 提升为直接 devDependency（^0.16.47，与 mermaid 传递依赖同一副本）；护栏 `tests/frontend/chat-math.test.ts`。代码块语法高亮曾随 highlight.js 依赖移除而缺失（迁移缺口），现已由自研 `src/lib/code-highlight.ts` 补齐（25 组语言：16 组既有 + 对齐轮新增 toml/ini/dockerfile/makefile/powershell/graphql/protobuf/nginx/apache；未知语言走保守通用回退；200KB 护栏；局限见该模块与 [lib 文档](src/lib/README.md)），无新增依赖。
- **语义色分数透明度类 = 旧版 dead（勿误判为回归）**：HEAD `3e10f58` 的 `src/index.css` 没有语义色 `--color-*` 映射（旧版本由 pi-web-ui 预构建 CSS 提供），因此源码里自写的语义色透明度类（`text-foreground/90`、`hover:bg-muted/45`、`bg-border/70` …）在移除依赖前不会被 Tailwind 生成（dead，删除无视觉影响）；旧产物 `package-dist/dist/assets/index-B1G0LqYR.css` 的 `@layer utilities` 中真实存在的语义色工具类只有 **78 个**（109 处选择器）。工作区新增 `@theme inline` 全量映射后这些类会真实生效——第八轮用户反馈的「文字变淡」根因即在此。约定：新代码不得使用白名单之外的透明度档位（需要半透明时改用白名单已有档位，或旧产物已支持的 `*-[color-mix(in_oklab,var(--x)_NN%,transparent)]` 任意值写法），契约由 `tests/frontend/semantic-color-class-parity.test.ts` 固化；**白名单变更前必须重新核对旧/新产物**。同一判据下，`ui/Input` 的聚焦反馈由 dead 的 `focus-visible:border-primary` 改为白名单组合 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring`，属**有意补齐**（与移除依赖前实际渲染不同——旧组合是死类，该输入框此前不渲染聚焦边框）。
