# `src/components/` — React 组件

## 目录结构

```
components/
├── chat/
│   ├── ChatPanelHost.tsx           # 聊天面板宿主 (1456 行)
│   ├── ModelSetupEmptyState.tsx    # 模型未配置时的空状态引导 (43 行)
│   ├── chat-utils.ts               # 共享类型、DOM 工具、token 估算 (300 行)
│   ├── command-suggestions.ts      # 聊天输入框 / 斜杠菜单：指令·技能·子智能体三分组补全 + 选中态 chip（方案 A）(479 行)
│   ├── file-reference-suggestions.ts # Composer @ 当前项目文件搜索、键盘选择与结构化文件 chip (404 行)
│   ├── capability-suggestions.ts   # + 菜单插件能力目录与结构化能力 chip（不再占用 @）
│   ├── capability-icons.ts         # Slash/能力菜单共享的中立图标表
│   ├── slash-invocation-chip.ts    # Slash 选中态 chip：输入框内联覆盖层控制器 + 消息流 chip 共享元素 (541 行)
│   ├── context-usage.ts            # 上下文用量环状指示器 (78 行)
│   ├── panel-decoration.ts         # 聊天面板 DOM 装饰兼容入口 / editor 编排 facade (286 行)
│   ├── scroll-sync.ts              # 自动滚动同步 + 触顶加载回调 (174 行)
│   └── windowed-messages.ts        # 超长会话窗口化渲染（只渲染最近 3 轮，向上滚动逐页加载更早轮次）
├── cloud/
│   └── CloudAccountSettingsPage.tsx # 云身份、额度、设备和退出管理
├── git/
│   ├── GitBranchMenu.tsx           # 标题栏 / Git 工具中的分支搜索、切换、创建分支和 Git 图谱入口
│   ├── GitCommitPushDialog.tsx     # Git 提交 / 提交并推送 / 推送弹窗，支持 AI 生成提交信息
│   ├── GitToolsPinnedSummary.tsx   # 顶部工具栏 Git 置顶摘要，支持收起胶囊和展开工具卡片
│   └── GitGraphDialog.tsx          # Git 提交图谱大弹窗
├── agent-profiles/
│   └── AgentProfilesPage.tsx        # Agent Profiles 独立管理页面
├── scheduled-tasks/
│   └── ScheduledTasksPage.tsx      # 定时任务和执行历史页面
├── share/
│   ├── ShareConversationDialog.tsx # 分享对话对话框 (199 行)
│   └── SharedConversationPage.tsx  # 查看分享的对话页面 (266 行)
├── sidebar/
│   └── ChatSidebar.tsx             # 聊天侧边栏（Projects / Tasks 标题区支持鼠标、触摸与键盘排序）
├── workspace/
│   ├── WorkspaceInspector.tsx      # 右侧统一工作区检查器，顶部 Tab 支持拖动排序；含文件/审查/终端/浏览器/subagent 运行详情
│   ├── SubagentRunDetailContent.tsx # Workspace Inspector 中的 subagent 单次运行详情内容
│   ├── WorkspaceFileTree.tsx       # 项目文件树
│   ├── WorkspaceChangesList.tsx    # Git 工作区变更列表
│   ├── MonacoCodeViewer.tsx        # Monaco 只读代码查看器
│   └── MonacoDiffViewer.tsx        # Monaco 单文件 Diff 查看器
├── terminal/
│   ├── TerminalDock.tsx             # 多会话终端 Dock，支持新建时选择 Shell profile
│   ├── TerminalPane.tsx             # xterm.js 终端实例面板
│   ├── terminal-api.ts              # 终端 REST API 客户端
│   └── terminal-types.ts            # 终端会话/能力/Profile 类型
├── ui/
│   ├── button.tsx                  # 按钮组件 (40 行)
│   ├── confirm-dialog.tsx          # 确认对话框 (95 行)
│   ├── input.tsx                   # 输入框组件 (19 行)
│   ├── prompt-dialog.tsx           # 提示输入对话框 (116 行)
│   └── toast.tsx                   # Toast 通知组件 (113 行)
├── ErrorBoundary.tsx               # 错误边界组件 (53 行)
├── project-directory-picker.tsx    # 项目目录选择器 (247 行)
└── skills-dialog.tsx               # Skills 管理面板与项目技能对话框
```

## 核心组件说明

### CloudAccountSettingsPage.tsx

- 位于「设置 → 账户与云服务」，顶部配置独立受管 QuickForge Cloud 服务连接（只读服务类型、Cloud URL、来源、health/ready 测试和保存），不展示 Provider Key，也不写入自定义 Provider。
- 同页展示可选云身份、剩余额度、重置/到期时间、公开模型目录和连接设备；一次刷新同步请求 config/status/usage/installations/models，其中 usage/installations/models 独立提交结果：单项失败会清除该项旧数据并在对应区块提供重试，其余成功内容继续展示。
- 页面明确区分未配置、本地无 Session、Session 可用、Session URL 不匹配、Cloud 不可达和详情单项失败；旧 Session URL 不匹配时不请求详情、不自动创建游客，只展示显式重建入口。
- 用户仍需明确确认数据发送说明后才创建游客，页面挂载和刷新不会自动注册。
- 有活动 Session 时跨 URL 保存会显示先退出或“重建身份并切换”的明确引导；后者要求危险确认，先本地 reset 再保存，不自动重试，也不把旧 Refresh Token 发给新服务；旧 Session 缺少 URL 绑定时同样按不匹配处理。若 reset 成功但 URL 保存失败，页面保留目标 URL 草稿，并明确显示“身份已重建、URL 保存失败”，用户可直接重试保存而无需再次 reset。
- 可撤销其他设备；当前设备退出由本地 BFF 先完成云端撤销，失败时保留本地凭据供重试。
- 退出后再次体验会创建新游客身份和额度，不宣称恢复旧游客。
- 成功启用或退出后派发 `quickforge:cloud-state-changed`，清空 `useCloudModels` 的内存云模型缓存。

### ChatPanelHost.tsx (1456 行)

- 核心聊天面板宿主
- 封装 `@earendil-works/pi-web-ui` 的 `ChatPanel` 组件
- 集成 Agent 权限模式选择器、Plan 模式输入态、工作区工具渲染、分享对话渲染
- 支持本地工具渲染器 (`getLocalWorkspaceTools`)；为兼容历史会话，既有 `generate_image` 结果仍不并入普通工具汇总，而是独立显示图片、模型信息、打开原图与下载入口，并与中间 Markdown、Thinking 和其他工具过程一起归入当前回合唯一的“执行中/已执行”顶层折叠区域；当前 Agent 不再暴露该工具。
- 分享页使用 `/api/shared/:shareId/assets/:assetId` 加载已授权会话的生成图片
- 工具审批卡使用轻量语义容器和左侧 3px 状态线：普通工具为 warning，自动上下文压缩为 info；命令、路径、MCP/Plugin 服务与工具等关键参数始终可见，完整参数可展开查看；subagent 来源以徽标展示。提交期间禁用按钮，失败后保留卡片并允许重试；成功或拒绝后仍移除卡片，不保留持久历史。
- `ChatPanelHost` 通过独立的 `approvalReadOnly` / `approvalReadOnlyMessage` 控制审批可操作性，不与消息发送 `readOnly` 混用。分享页即使具有 operate 权限也只读展示实时审批，并提示回到分享者原始对话处理；刷新无法恢复分享页既有 pending 审批是当前已知限制。
- 消息回滚、分叉、复制功能
- 对话消息在恢复后一次性完整渲染，不再按轮次窗口化或触顶分页；初始加载和 DOM 成本相应增加，但左侧轮次导航点击时目标消息节点已存在，可直接平滑定位。`windowed-messages.ts` 保留显式透传模式及原窗口控制能力，主聊天面板当前使用透传模式；子代理 process 消息列表不受影响。`decorateMessages` 使用全量消息且 `messageIndexOffset` 为 0，回滚、重试、复制继续使用全量索引。
- 主对话页提供左侧用户轮次导航（`turn-navigation.ts`）：每条用户消息对应一个节点，当前轮次随滚动高亮；悬停或键盘聚焦节点时显示截断的用户消息与该轮最后一条 assistant 消息（Final Answer），点击直接平滑定位到已渲染的对应用户消息。分享页默认不显示该导航，移动端隐藏。
- 草稿恢复支持；Composer 草稿持久化由 `src/lib/composer-drafts.ts` 直接使用浏览器 `localStorage`，不再经过 `AppStorage/settings` 或后端存储；正文为空但有结构化文件引用或能力 chip 也视为草稿，`text`、`contextReferences` 与 `selectedCapabilities` 按项目/会话 draft key 隔离并持久化：能力选择会防御规范化、按 `type+pluginName+name` 去重且最多 4 个；普通附件仍不持久化。回滚、模型切换等外部恢复草稿按一次性事件消费，发送、编辑或 Session 切换会取消旧的延迟恢复任务；已消费恢复草稿 ID 使用有界 Set，发送或明确清空会立即删除运行时与持久化草稿。

### WorkspaceInspector.tsx / SubagentRunDetailContent.tsx

- subagent 单次运行详情是 Workspace Inspector 的一种运行时 Tab，与文件、审查、终端、浏览器 Tab 并存，可独立切换、排序和关闭。
- 点击聊天中的 subagent 摘要会派发 `quickforge:open-subagent-run`；同一 `runId` 复用并激活已有 Tab，不同运行创建独立 Tab。无项目的全局会话也可打开 subagent Tab。
- 聊天中不再使用 `<details>` 展开完整过程；任务、上下文、期望输出、过程 message-list 和结果统一在 Tab 中显示。Tab 继续遵循工具显示配置并复用原详情样式：`concise / compact` 保持简洁，`detailed` 才额外展示工具调用统计、允许工具以及 input/details JSON。
- `SubagentRunDetailContent` 通过 Lit 宿主 `subagent-run-detail-body` 复用 `local-tools.ts` 的 `renderSubagentRunBody`；实时更新订阅 `subagentRunStore`（`ServerAgent` 的 `tool_execution_start/update/end` SSE 与 `local-tools` 的安全恢复回填发布到该 store），严格按 canonical `toolCallId` 更新已打开 Tab，不做 fallback→canonical 迁移。canonical 摘要打开时可取 store 中最新同 ID 快照；无 canonical 的历史终态摘要直接使用当前消息载荷，避免相同 `name:task` 历史记录串线。
- 侧边详情内部的 process `message-list` 与聊天内共用同一装饰路径：宿主每次渲染（首次挂载、payload 实时更新、运行状态变化）后调度 `decorateSubagentProcessBlocks`（`panel-decoration/message-actions.ts`），对 `message-list[data-quickforge-subagent-process]` 应用与聊天一致的 process folding / 过程分组装饰与交互；装饰幂等、不重复叠加，卸载随 DOM 回收。
- 聊天中的 subagent 摘要按钮是打开侧边详情的入口：原生 button 语义 + `aria-label`/`title`，并带轻量 hover / focus-visible 反馈（浅背景 + 焦点环）；新运行在尚未取得 canonical `toolCallId` 时按钮禁用，不会创建 `name:task` 错误 Tab，已完成历史消息仍可用兼容 fallback 打开。
- subagent Tab 不写入项目持久化，刷新后不恢复；其他工作区 Tab 的持久化规则不变。

### ChatSidebar.tsx

- 左侧聊天列表面板
- 支持全局会话 / 项目会话切换
- 支持“按项目 / 时间线”视图切换，以及按更新时间或创建时间排序；两项偏好均保存在浏览器 `localStorage`，刷新后恢复，不参与后端备份或跨设备同步
- 搜索、置顶、归档会话；归档内容可在设置页的“已归档对话”中恢复或永久删除
- 折叠/展开项目分组
- “按项目”视图支持拖拽排序并持久化；拖拽预览横向锁定且限制在 Projects 自身的 `overflow-y-auto` 视口内，dnd-kit 自动滚动仅允许该容器并在真实顶部/底部停止，拖动期间会话分组继续临时折叠
- 无限滚动加载会话 (Intersection Observer)
- 搜索入口、全局 Skills 设置入口
- 项目分组和会话列表折叠/展开
- Projects 与 Tasks（源码仍沿用 conversations 状态/key）作为两个完整顶层区块按 `sectionOrder` 动态渲染；不再使用标题旁专用拖拽图标，现有标题主 toggle 同时作为 `useSortable` activator：普通单击仍折叠/展开，PointerSensor 超过 6px 后开始鼠标/触摸拖拽，`touch-none` 与 grab/grabbing 光标提供反馈；KeyboardSensor 配合 `sortableKeyboardCoordinates` 继续支持聚焦标题后以 Space 开始、方向键移动、Space 放下。右侧折叠全部项目、添加、筛选和新建任务等操作按钮不绑定 attributes/listeners。置顶区固定在排序区外；顶层区块使用 `sidebar-section:*` 命名空间 ID，Projects 列表内部原有独立 dnd-kit 排序、视口边界和 `onReorderProjects` 持久化保持不变
- 开始拖动任一区块后，Projects 与 Tasks 都仅在视觉上临时折叠：Chevron、`aria-expanded`、外层 `SortableSidebarSection` 尺寸和内容 grid 统一使用派生折叠状态，内容收缩期间禁用过渡以稳定 DnD 测量；cancel/end 清除 `draggingSectionId` 后按各自原 `projectsCollapsed` / `conversationsCollapsed` 状态恢复，不修改持久折叠偏好
- 顶层排序容器保持 `flex / min-h-0 / overflow-hidden`，区块视觉折叠后使用 `shrink-0` 并按当前顺序紧贴；展开时 Tasks 才占用剩余高度（`flex-1`），Projects 继续限制为 `max-h-[55%]`。两区内部滚动容器不变，底部设置区继续以 `mt-auto shrink-0` 固定
- 顶层区块顺序由 `src/lib/sidebar-section-order.ts` 安全读写浏览器 `localStorage`；桌面与移动侧栏共用 App 中同一状态，刷新后恢复，不参与后端备份或跨设备同步
- 渠道会话在列表、搜索和对话页标题中按普通文字显示“渠道名 · 标题”，不改变真实标题，也不使用徽标或差异化样式
- 长会话标题默认单行省略；桌面端仅在标题实际溢出时悬停滚动，并遵循系统的“减少动态效果”设置
- 当前对话顶部“更多”菜单由 `src/App.tsx` 管理，提供置顶、重命名、分享和归档操作；手机端在标题栏下方以视口内固定浮层展示，Android 移动壳横屏时仍保持移动布局
- 小于 `640px` 的手机布局会在会话标题下方以弱化辅助行展示当前项目和 Git 分支；两项分别截断且保持单行，平板与桌面标题栏布局不变

### ScheduledTasksPage.tsx

- 定时任务管理页面，包含 Tasks / History 两个页签
- 创建/编辑/删除/手动触发定时任务
- 支持多种调度类型: once / daily / weekly / monthly / interval / cron
- 任务运行历史查看
- AI 模型选择、参数配置
- 定时任务可选择执行 Agent；任务卡片、详情和运行历史展示 Agent 信息
- 每个定时任务可配置执行模式：默认串行，避免同一任务重叠执行；可切换为并行以允许同一任务重叠运行，不同任务之间仍并行触发

### AgentProfilesPage.tsx

- 与定时任务平级的 Agent Profiles 独立管理页面
- 创建自定义 Agent，配置系统提示词、模型、思考等级、工具白名单、运行时间、工具调用次数和是否启用为 sub agent；最大运行时间在界面按分钟填写（至少 1 秒，即 `1000/60000` 分钟，且不超过 60，支持小数），API 与配置文件仍使用毫秒字段
- 创建/编辑弹窗支持用默认模型 AI 填充 Agent 名称、显示名称、描述和系统提示词，不自动修改工具白名单或运行限制
- 展示内置 Agent Profiles；内置项的定义只读，但允许设置继承模型或固定模型

### skills-dialog.tsx

- `SkillsManagerPanel` 提供可嵌入的 Skills 选择、搜索、阅读和保存能力
- 全局 Skills 通过设置页 Skills tab 嵌入展示，左侧 Skills 图标会跳转到该设置 tab
- 项目级 Skills 仍由项目菜单打开 `SkillsDialog` 对话框
- 支持搜索过滤和读取 Skill 内容

### 聊天子模块

**chat-utils.ts** (300 行)
- 共享类型定义（MessageEditorElement, CommandSuggestionElement 等）；`FileContextReference`（`{type:'file',projectId,path}`）与 `ComposerCapabilitySelection` 为 @ 文件引用 / 能力 chip 的结构化草稿类型，`MessageEditorElement` 相应扩展 `contextReferences` / `selectedCapabilities` / `requestUpdate` 字段
- DOM 工具函数（`replaceSvg`, `patchContent` 等）
- Token 估算和上下文用量计算（`getContextUsage`, `estimateTokens`）；前端仅作为后端 `contextUsage` 缺失时的回退估算
- 草稿运行时管理（`hasDraft` 等）；`ComposerDraft` 携带 `contextReferences` / `selectedCapabilities`，`hasDraft` 口径为正文、附件、文件引用、能力 chip 任一非空；持久化在 `src/lib/composer-drafts.ts`，使用浏览器 `localStorage` 保存当前浏览器本地草稿，不迁移旧的 settings 后端草稿，也不参与后端备份/跨设备同步

**command-suggestions.ts** (479 行)
- 聊天输入框 "/" 斜杠菜单，三个分组依次渲染：指令（内置 /init /plan /review /summary /compact /clear /help + 项目自定义命令）、技能、子智能体；每组 sticky 组头（label + 条数），整组无命中时隐藏
- 技能/子智能体目录经 Options.loadSlashCatalog 懒加载（首次触发 / 时请求，见 `src/lib/slash-catalog.ts`）：idle → loading（技能/子智能体组渲染 2 行骨架，容器 aria-busy）→ ready（resolve 即含 null 目录，自动重渲染）/ error（本次打开仅指令组，菜单从关闭到重新打开允许重试一次）；无 loader 时同样仅指令组
- 过滤口径：query = 去掉前导 / 的文本（trim + 小写），haystack = 用法文本（含 argumentHint，去前导 /）+ agent label·description，空白归一后 includes；query 为单词且命中名称段时 `<b>` 加粗命中段，argumentHint 渲染为 muted hint 子 span
- 行结构三列 grid（图标/用法/描述）：指令琥珀、技能蓝（复用 `capability-icons.ts` 的 capabilityIcons）、子智能体翠绿（slash-invocation-chip 共享的 slashAgentIcon）；行 button role=option + aria-selected，data-quickforge-insert 存完整插入文本（指令 `/name `、技能 `/skill <name> `、子智能体 `/agent <name> `，统一经 restoreDraftIntoComposer 插入并聚焦置尾）
- 键盘（textarea capture handler）：↑↓ 在可视行间循环移动 active（aria-selected 同步、scrollIntoView nearest）；Tab 补全 active 行（初始首行）；Escape 关闭菜单 / 退出 chip 选中态；Backspace 在 chip 右边界一次删除整段命令前缀；Enter 不拦截（发送原文）；Shift+Tab 放行给 Composer Plan 模式，isComposing/Process 守卫
- 选中态 chip（方案 A，`slash-invocation-chip.ts`）：选中技能/子智能体后输入框内 `/skill <name> ` / `/agent <name> ` 前缀以带图标 chip 内联显示——textarea 原文不变（服务端零改动、草稿/发送不受影响），`.quickforge-composer-shell` 内挂覆盖层镜像（chip + 定宽 spacer + 任务文本，光标对齐补偿保证幽灵层换行/滚动与 textarea 一致），textarea 文字透明、光标保留；IME composition 期间覆盖层保持显示、预编辑文本以弱下划线镜像进幽灵层；前缀失配（编辑/更长的 name）自动自毁恢复原文，覆盖层/textarea 被外部重渲染移除时按匹配文本自愈重建；chip 激活时菜单不再弹出；catalog ready 后手输/草稿恢复完整命令自动 engage；Esc 退出保留文本（同前缀变化前不再自动 engage）
- 底部 sticky 键位提示条（↑↓/Tab/Enter/Esc 四段 kbd + i18n 标签）；外部 pointerdown 关闭；浮层挂载在 editor.parentElement.insertBefore(浮层, editor)

**file-reference-suggestions.ts**
- Composer 内独立 `@` 文件引用控制器，只在当前 QuickForge 项目、可编辑会话启用；OpenCode、分享页、无项目和只读页禁用，插件不会进入 `@` 结果。
- token 规则为 `(^|\\s)@([^\\s@]*)$`；裸 `@` 与 1 字符 query 只显示继续输入提示，不提供最近文件；2+ 字符经 300ms debounce 请求 `/api/workspace/mention-search?projectId&query&limit=8`，AbortController + generation 丢弃旧响应；仅接受 `type:'file'` 且安全相对路径。
- 菜单复用 Composer 浮层视觉，支持 loading/empty/error、名称/路径匹配高亮、8 行上限、ArrowUp/Down 循环、Enter/Tab 选择、Esc 关闭和 IME 放行，并与 `/`、`+` 菜单互斥。
- 选择后删除活动 `@token` 而不插入 `@path`，保留 token 前后正文、附件和 caret；结构化 `contextReferences` 最多 8 个并去重，显示可删除文件 chip（文件名 + 项目相对路径 title），绝不显示绝对路径。

**capability-suggestions.ts / capability-icons.ts**
- 插件目录只供 `+ → 能力` 使用，来源仍是 enabled + loaded 插件；选择后产生可删除结构化能力 chip，不向正文插入 `@Documents`，发送时 `consumeSelectedCapabilities()` 只消费显式选择，不从文本推断。
- 能力选择与正文、文件引用一起写入当前 Composer 的 `localStorage` 草稿；恢复时防御规范化、按 `type+pluginName+name` 去重且最多 4 个，附件仍不持久化。`capability-icons.ts` 是 Slash、能力 chip/菜单共享的中立图标模块，避免 command-suggestions 依赖插件控制器。

**slash-invocation-chip.ts** (541 行)
- Slash 选中态 chip 子系统（design-mockups/slash-menu-expansion.html 方案 A）：纯逻辑（前缀解析 parseSlashInvocationPrefix / 匹配校验 slashInvocationPrefixMatches / 消息流剥前缀计划 planSlashChipText / spacer 宽度 max(0, 前缀宽度 - chip 宽度)）+ 共享 chip 元素工厂（输入框与消息流同一样式类 quickforge-slash-chip ± skill 蓝/agent 翠绿变体与 html.dark 调亮）+ 控制器工厂 createSlashInvocationChip
- 控制器状态机：engage（显式选中，重置 dismissed）→ update（每次输入同步，失配自毁、文本不动；**自愈**——React/Lit 重渲染移除覆盖层或重建 textarea 时按匹配文本重挂覆盖层而非放弃选中态，保证打字过程中 chip 不消失）→ clear（Esc 退出，记 dismissed 前缀）→ removePrefix（退格边界删整段前缀含一个空格，同步 editor.value/onInput/input 事件后聚焦置 0）；光标进入前缀区域（document selectionchange）**降级为原文显示**（隐藏覆盖层、移除透明类，不销毁选中态），光标回尾部继续输入时自愈恢复；IME composition 期间覆盖层保持显示——预编辑文本经 compositionupdate 镜像进幽灵层尾部并以 `.quickforge-slash-preedit` 弱下划线提示输入中（Chromium 下 value 已含预编辑则从任务文本剥离去重，WebKit compositionend 先于 value 同步时手动拼接兜底）
- 覆盖层几何：textarea 与 shell 的 getBoundingClientRect 差值定位，宽高取 clientWidth/clientHeight；ResizeObserver 监听 textarea 重同步；幽灵层从 getComputedStyle 同步字体/行高/内边距/tabSize，scroll 事件同步 scrollTop；度量经 env 注入（canvas.measureText / offsetWidth），node 环境可单测

**context-usage.ts**
- 上下文用量环状指示器，优先展示后端 session state 返回的权威 `contextUsage`（后端统计复用 `pi-agent-core` / `pi-ai`），缺失时回退到前端本地估算
- 在现有模型选择按钮左侧单独显示中心镂空的彩色环，指示当前对话所占模型上下文窗口比例；悬停、聚焦或点击后显示结构化 Token 明细、统计来源与上下文范围；该圆环及详情可在“设置 → 常规”中开启，默认关闭

**panel-decoration.ts** (286 行)
- 聊天面板 DOM 装饰的兼容入口，继续向 `ChatPanelHost.tsx` re-export 消息装饰、草稿、审批卡、上下文压缩提示和等待气泡等能力
- `decorateEditor` 仅保留 Composer/editor 编排：占位符、只读清理、model selector 开关、left/right controls 定位，以及调用各 focused helper
- 细分实现位于 `panel-decoration/` 子目录：`message-actions.ts`（复制/回滚/重试/分叉；另在装饰纯文本用户消息时调用 `decorateUserMessageInputClamp`——给 `.user-message-container` 挂 `quickforge-input-clamp` 收起结构：长内容约 6 行定高、底部渐隐 + 居中「展开/收起」按钮，`user-with-attachments` 不参与，实现见 `src/lib/input-clamp.ts`；以及 `decorateUserSlashInvocationChip`——用户消息 `/skill <name>` / `/agent <name>` 前缀渲染为行内 chip（复用 slash-invocation-chip 的共享 chip 元素，消息流内 0.8rem 微调），首文本节点剥前缀、chip dataset 记录被剥字符实现幂等还原，复制仍走 draftTextFromUserMessage 原文不受影响）、`decorateUserFileReferences`——用户消息 `details.contextReferences`（≤8 条、仅 `type:'file'`）在 `.user-message-container` 顶部渲染 `.quickforge-message-context-references` 文件 chip 行（复用 file-reference-suggestions 的 `createFileReferenceChip`，aria-label「引用的文件」，`replaceChildren` 幂等更新，无引用时移除节点）、`composer-plus-menu.ts`（附件和内置插件菜单；插件项选择走 `selectPluginCapability` 产生结构化能力 chip，不再向正文插入 @mention，菜单打开时与 `/`、`@` 建议浮层互斥）、`agent-access-menu.ts`、`plan-mode-controls.ts`、`send-stop-button.ts`、`model-controls.ts`、`opencode-config-menu.ts`（OpenCode `configOptions` 配置菜单）、`opencode-mode-menu.ts`（OpenCode ACP modes 独立模式按钮/菜单）、`editor-bindings.ts`、`code-blocks.ts`、`process-folding.ts`、`context-compaction.ts`、`scroll-to-bottom-button.ts`（对话区上翻较深时居中悬浮于输入框上方的“回到底部”按钮：280px/120px 滞回显隐、未读徽标、点击平滑回底并恢复自动跟随；readOnly 会话无 composer dock 时自动移除）等；`process-folding.ts` 为每个用户回合维护唯一的“执行中/已执行 · 耗时”顶层状态与折叠入口，中间 Markdown、Thinking、工具和 Subagent 均位于该层级；每段中间 Markdown 后的过程片段继续显示内层阶段聚合标题（状态 + 工具调用数、命令数、编辑文件数），运行中和已完成阶段均默认收起并维护独立折叠状态，普通连续工具仍保留更内层的工具摘要，只有最终回答正文留在组外
- Plan 按钮和 Shift+Tab 切换前端 Plan 模式；发送时复用 `/plan <任务>` 的单轮计划逻辑
- OpenCode 会话下原生模型选择器关闭，ACP modes（Build/Plan/...）以独立模式按钮显示在 composer 右侧（原模型选择器位置、发送按钮之前，保持发送按钮 `:last-child`），复用 model trigger/menu/menu-item 样式并右对齐；按钮 label 显示 currentModeId 对应 mode.name（无匹配回退 currentModeId），无 availableModes 时不渲染；左侧 OpenCode 配置菜单仅展示 `configOptions`。模式菜单与 config/agent-access/composer-plus/model 菜单打开时显式互斥
- Assistant Markdown 中的 ```svg 和 ```mermaid 代码块会在流式输出结束后默认进入安全图片预览，可在代码块右上角切换预览/源码；Mermaid 按需加载并在失败时保留源码
- `panel-decoration/ask-user-card.ts` 是 ask_user 工具的交互卡（与审批卡同族的注入式卡片，`data-ask-id` + displaySignature 去重）：向导式多问题（单选点选自动进下一问；多选或含自由输入的问句另有显式「下一问」前进，导航按钮统一在卡片底部操作行——上一问/下一问/提交/跳过同行，注入时创建常驻、renderStep 按问型显隐）；自由输入为可叠加补充——展开不清空已选 choices，选项与补充可共存，textarea Enter 确认前进（Shift+Enter 换行），回执按「选项 + 补充」合并显示；末步回执摘要统一提交，每行「修改」按钮直达该题回改，与「上一问」同走 renderStep 并 disarmSkip）；「跳过」语义为跳过全部提问（服务端 skipped 回传后所有问题按未回答处理），两步确认防误触丢答案（首击仅切换为确认文案，5s 未复击或 back/提交/自动前进时自动复位，armed 下再击才真正跳过）；提交/跳过经 `onAnswerAsk` 回调（App → server-agent `answerAsk` → `POST /api/agents/:id/answer-ask`）放行服务端 pending Promise；回答后卡片移除，ask_user 调用作为普通工具消息留在消息流由既有折叠机制收纳；readOnly/share 视图禁用并提示

**scroll-sync.ts** (174 行)
- 自动滚动同步管理
- 新消息时自动滚到底部；用户主动上滚时暂停自动滚动
- 用户滚回底部时重新启用自动滚动
- 上翻较深时的“回到底部”悬浮按钮（`panel-decoration/scroll-to-bottom-button.ts`）复用同一滚动容器的 scroll 监听独立判定显隐，点击后经 `scrollSync.enable()` 恢复尾部跟随；显隐阈值（280px 出 / 120px 消）与 scroll-sync 的 `isNearBottom`（80px）体系对齐但各自独立

### 标题栏 Git 组件 (`git/`)

- `GitBranchMenu.tsx` 挂载在主对话标题栏的分支 chip 和 `GitToolsPinnedSummary` 展开卡片中，提供分支搜索、当前未提交变更摘要、分支切换、创建并检出新分支，以及 Git 图谱入口。
- `GitToolsPinnedSummary.tsx` 显示在顶部窗口工具栏中，收起态为 Git 摘要图标，展开后提供更改统计、分支操作和提交/推送入口。小屏 H5 与 Android WebView 使用标题栏下方、限制视口高度的固定浮层，支持点击外部或 Escape 关闭；由于 Workspace Inspector 暂未提供移动布局，小屏隐藏“更改”入口，桌面端仍可跳转 Changes/审查面板。
- `GitCommitPushDialog.tsx` 提供提交、提交并推送、推送操作；默认只提交已暂存文件，可展开确认文件范围并显式选择是否包含全部未暂存更改；AI 仅生成可编辑的提交文案，不会自动继续提交。弹窗打开时刷新 Git 状态，detached HEAD 会阻止提交/推送；提交成功但推送失败时会保留成功状态并提供仅重试推送。
- `GitGraphDialog.tsx` 使用 `/api/git/log` 渲染居中的 Git 提交图谱弹窗，包含图线、描述、日期、作者和提交短哈希列，并支持刷新和关闭。

### Workspace Inspector (`workspace/`)

- 右侧专业工作区检查器入口为 `WorkspaceInspector.tsx`，采用类浏览器顶部 Tab 工作区；`+` 菜单提供 Files / Review / Terminal / Browser 入口。Tab 下拉列表的条目区最多显示 10 行并在超出时独立纵向滚动，同时按视口高度兜底；“关闭其他 / 关闭全部”操作区固定在滚动区外。Inspector 展开/收起状态、Tab 列表、活动 `activePanelTabId`、Review 的 Overview/Changes 子视图以及 Reader 左侧导航显示状态按 `projectId + sessionId` 写入浏览器 `localStorage`。新建空白会话先使用不落盘的 deferred runtime scope，默认关闭、空 Tab、显示 Reader 导航；首次发送创建真实 `sessionId` 时 AgentManager 保留同一个 runtime scope，组件 `key` 不变，内存中的 open/tabs/active/Review/导航状态不会因晋升重建，并由现有持久化 effect 写入真实 `projectId + sessionId` key。切换到其他已存在会话或确认创建另一空白 deferred session 时才更换 runtime scope 并重建 Inspector；底层新建动作 reuse、取消或失败不会由 App wrapper 提前滚动 scope。旧项目级 key 不迁移。Inspector 整体宽度继续使用全局 `quickforge_workspaceInspectorWidth_v2`；Reader 导航分栏宽度等纯布局运行时偏好不纳入会话状态。
- 标题栏 Git、聊天文件链接、文件 Reader、产物 Browser 与 subagent 等外部入口通过一次性请求打开对应 Tab。新请求携带 `projectId + runtimeScopeId`，App 发起时校验当前 scope，聊天文件路径 resolve 等异步完成后再次校验，Inspector 消费时第三次校验；因此同一项目 session A 的迟到请求不会被 session B 接收或持久化。历史无项目且无 scope 的 subagent 请求继续按兼容语义处理；请求消费后即清除，普通折叠后重新展开不会重放。
- Files tab 使用 `/api/workspace/children` 按需加载：首次激活只读根目录，首次展开目录才请求下一层；目录状态按归一化相对路径管理，已加载目录折叠重开不重复请求，根目录和子目录都提供 loading/error/retry 与分页“加载更多”。服务端 cursor 是 offset 而非快照；Inspector 会话内保留各目录已加载页和展开状态。刷新时旧 entries 保持可见，并按父到子重抓根目录及已展开目录：至少恢复刷新前覆盖量；若旧目录尚未在已抓页中出现则继续读到确认存在或目录完整，之后才递归清理真正消失目录的后代状态与展开路径。append 失败重试复用原 cursor，不清空前页；刷新按钮覆盖整个树刷新过程。
- Files 搜索在输入至少 2 个字符后约 300ms 调用 `/api/workspace/search`，会立即隐藏上一 query 结果、取消旧请求并搜索整个项目，而非只过滤已加载节点；搜索状态下点击刷新或错误重试会立即重新执行当前 query，不刷新隐藏的普通树。loading/empty/error/truncated 采用单一状态展示。搜索结果中的目录明确按不可展开结果显示，不写入普通树的 expandedPaths；文件结果仍可打开。空搜索恢复普通按需树。Files、Review、Reader 三类加载相互解耦：Inspector 打开后会独立异步加载树根，因此直接通过 Reader、Browser 或外部请求进入时侧边 Files 导航仍可用，但 Reader/Browser 内容不等待该请求，且不会因此触发 Git；Review 使用显式 idle/loading/loaded/error，clean Git 仓库的空数组也算 loaded，不会重复请求，首次错误不会自动循环但会显示手动重试入口；局部目录错误不会遮挡 Reader/Review。
- 已知限制：单个超大目录的 `children` 仍需在服务端读取并排序整层后再切分页；offset cursor 不是目录快照，分页间目录变化可能导致重复或跳过；浏览器端 AbortController 取消请求后，不保证服务端已经开始的文件系统扫描立即停止。
- IndexedDB 只读缓存（F13，`lib/workspace-cache.ts`）：目录条目按 `serverKey::projectId::path` 缓存（仅完整未截断目录），Inspector 重开时 TTL 30s 内直接 seed 零网络、过期先 seed 再后台校准（SWR）；展开路径随缓存持久化，重开后整树即时恢复；Reader 文件内容按 `size+mtimeMs` 失效戳缓存（>1MB 不缓存），重开同文件先渲染缓存再经 `?meta=1` 轻量校验，mtime/size 一致即零内容传输；刷新按钮/强制刷新绕过缓存读并覆写缓存（"刷新=权威"）；错误与 truncated 不写缓存，IndexedDB 不可用全程回退网络路径。
- 从 Files 中打开普通文件时，会提升为独立顶部 reader tab，Tab 标题显示文件名，内容区左侧使用 Monaco Editor / Markdown Reader 只读展示，右侧保留可显隐、可拖拽调宽的工作目录树；Reader 顶部左侧显示“项目名 > 工作区相对路径”的分段面包屑，当前文件名增强显示，长路径自动截断并通过悬停展示完整路径；复制路径、复制文件内容和自动换行收拢到更多菜单，提供当前文件的资源管理器 / VS Code / IntelliJ IDEA 外部打开入口。Markdown Reader 基于 `react-markdown` 与 `remark-gfm` 渲染标准 Markdown/GFM，保留 Mermaid 代码块预览，并将本地图片相对路径按当前 Markdown 文件目录转换到工作区预览接口；默认展示预览，并在右侧操作区通过“查看源代码 / 返回预览”切换，原始 HTML 不直接渲染。更多操作始终保留，自动换行仅在源码视图可用。普通代码文件默认关闭自动换行并常驻横向滚动条，用户可按文件临时启用自动换行；文件 reader tab 按项目保存路径，恢复时重新加载最新内容。Markdown 和代码产物进入 reader，HTML、SVG 和图片产物进入 Browser。
- Review tab 通过 `/api/git/status` 展示 Git 工作区变更，并在同一个 Review/Changes tab 内通过 `/api/git/file-diff` 展示单文件差异；Changes 顶部刷新按钮右侧提供提交入口并打开 `GitCommitPushDialog`，提交入口左侧常驻项目打开方式菜单：未选择变更文件时在资源管理器、VS Code 或 IntelliJ IDEA 中打开项目，选择文件后则在资源管理器中打开其所在目录或在编辑器中直接打开该文件；Changes 列表提供单文件还原、暂存、退回未暂存、在新标签中打开文件，以及底部批量还原/暂存/退回操作，分别调用 `/api/git/restore`、`/api/git/stage`、`/api/git/unstage`、`/api/git/restore-all`、`/api/git/stage-all`、`/api/git/unstage-all`；标题栏 Git 更改入口会聚焦该 Review/Changes 工作区。
- 标题栏 Git 分支 chip 通过 `/api/git/branches`、`/api/git/checkout`、`/api/git/create-branch` 和 `/api/git/log` 提供分支切换、创建并检出新分支和 Git 图谱弹窗；Workspace Inspector 仍聚焦文件浏览、产物预览和 diff review
- AI 产物展示统一进入 Workspace Inspector：`present_files` 可用于 HTML、SVG/图片、Markdown、代码、配置、报告和其他可读文本；Markdown/代码/文本打开项目级 Reader Tab，HTML/SVG/图片打开项目级 Browser Tab，不支持直接展示的文件仍保留在产物列表。工具卡片的预览按钮使用相同分流规则，可在关闭后重新打开对应 Reader 或 Browser Tab；Tab 恢复由项目级持久化状态负责。Browser 在加载工作区文件前通过预检接口统一识别文件不存在、不支持类型、文件过大、路径受限和服务异常等状态，以轻量空状态展示友好说明，并在可展开的“错误详情”中保留状态码、错误代码、文件路径和后端原始报错。
- 重复预览同一文件时复用已有 tab 而非叠加新 tab：Reader 命中已打开的 file tab 时激活并置为 loading、清除 error，复用统一加载 effect 重新读取最新内容；Browser 按同一底层文件路径（`browserTabFilePath`/`panelTabFilePath` 归一化，兼容 Windows 路径分隔符）或精确 web URL 查找已有 browser tab，命中则激活并递增不持久化的 `reloadNonce`，经 `WebPreviewContent` 的 `externalReloadToken` 纳入 iframe key 强制重载，未命中才新建 tab。仅同 kind 去重，不做 Reader/Browser 跨类型合并，也不改变 tab 的 localStorage 序列化格式。

### Terminal Dock (`terminal/`)

- `TerminalDock.tsx` 管理底部多会话终端、会话 tab、新建/关闭和高度拖拽。
- `TerminalPane.tsx` 在 WebSocket 建连并收到服务端 `ready` 超过 10 秒时判定超时，连接中断后按 1/2/4 秒最多自动重试 3 次；重试复用同一 xterm 实例和后端 PTY 会话，因此终端标签与已有输出不会消失。服务端明确返回 `SESSION_NOT_FOUND` 时视为原 PTY 已不可恢复，立即停止重试且不向终端缓冲区重复写错误，保留界面并提供“启动新终端 / 关闭”。其他自动重试失败场景提供手动“重试”。状态点区分连接中/重连中、已连接、断开、会话失效和进程退出。
- 新建终端默认使用后端返回的默认 Shell profile，也可以从 Dock 右侧 Shell 下拉列表选择指定 profile 创建新会话；下拉列表来自后端按当前平台自动识别的内置 profiles 加用户自定义 profiles。
- `TerminalDock` 还接收 Markdown shell 代码块触发的 pending command：AI 回复中的 `bash`/`sh`/`powershell` 等代码块会在复制按钮旁显示“在终端中执行”，点击后打开当前项目终端并写入命令执行；多行或高风险命令会先确认。
- `terminal-api.ts` 封装 `/api/terminal/capabilities`、`/api/terminal/sessions` 和 `/api/terminal/sessions/:id/input` 相关请求。

### ShareConversationDialog.tsx

- 创建或更新当前对话的固定分享链接
- 设置权限 (read / operate)、密码保护和有效期
- 可复制当前链接并停用分享

### ShareLinksSettingsPage.tsx

- 位于「设置 → 分享链接」，统一列出当前 QuickForge 实例的全部分享
- 展示状态、权限、密码保护、创建/到期/最近访问时间和访问次数
- 支持搜索、复制、打开、修改有效期、停用、按新有效期恢复和永久删除
- 支持编辑权限与密码（可生成或取消密码），可操作分享必须保留非空密码
- 移动端行内操作收进「更多」底部弹层，编辑表单在小屏纵向排列
- 停用、过期或删除后，公共请求和已建立的 SSE 均失效

### SharedConversationPage.tsx

- 查看他人分享的对话
- 支持只读和操作模式
- SSE 流式加载分享对话消息
- 密码验证

### project-directory-picker.tsx (247 行)

- 文件系统目录选择器
- 树形浏览，支持选择任意目录作为项目路径
- 导航 (返回上级 / 进入子目录)
- 跨平台兼容（Windows 驱动器、macOS Volumes）

### UI 组件 (button, input, confirm, prompt, toast)

- shadcn 风格的轻量 UI 原语
- 使用 `class-variance-authority` 管理变体
- 使用 `tailwind-merge` 合并 class
- confirm / prompt 通过 `createPortal` 实现模态对话框
- toast 支持自动消失和动画

### ErrorBoundary.tsx (44 行)

React 类组件实现的错误边界，捕获子组件渲染错误并显示降级 UI。
