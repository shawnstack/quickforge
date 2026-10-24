# `src/styles/` — 全局样式架构

全局样式分为两类：

1. **有序入口 + 领域模块（本目录）**：所有全局规则通过 `src/styles/index.css` 的 `@import` 图进入级联，构建后仍是单个 CSS bundle。
2. **组件自持样式**：`chat/trace/conversation-trace.css`、`workspace/goal-inspector.css`、`git/goal-summary.css` 由懒加载 surface 自己 import，必须使用独占 class 前缀，不得覆盖全局 selector。

## 入口契约

- `index.css` 只放注释、`@import "tailwindcss"` 与相对模块 import，不写具体规则。
- **import 顺序就是级联契约**：它等于拆分前单体 `src/index.css` 的源顺序。不要重排；确需调整时先审计跨模块同特异性的覆盖。
- 模块之间不得互相 `@import`；新增模块必须在入口登记。
- 共享设计 token 仍保持 unlayered（见 `foundation.css`），不要迁到 Tailwind `@theme`，否则会被 `@layer theme` 降权。
- 不使用 CSS Modules：大量 class 由 panel-decoration、`querySelector` 和测试按字符串消费，模块化会破坏 DOM 契约。

## 模块地图

```
src/styles/
├── index.css                    # 唯一入口：Tailwind + 有序 import
├── foundation.css               # unlayered token、body 基线、滚动条、共享 keyframes
├── layout.css                   # 窗口工具栏、titlebar-safe 面板、设置宿主
├── motion.css                   # 共享动效原语（dialog / menu / list）
├── startup.css                  # 启动 splash、迁移进度、会话加载过渡
├── markdown.css                 # 聊天正文排版（qf-markdown-block）
├── highlight.css                # 代码块语法高亮 token（qf-hl-*）
├── ui/
│   └── info-tip.css             # 问号说明浮层与 rollback popover 箭头
├── settings/
│   ├── shell.css                # 设置栈、分组、子标签
│   ├── appearance.css           # 外观主题选择与预览
│   ├── forms.css                # 页头、行、列表头、输入行布局
│   ├── select.css               # 自定义下拉框（桌面 + 移动模型选择）
│   └── controls.css             # 数字/分段/滑杆、消息、列表项、按钮、开关等
├── chat/
│   ├── messages.css             # 消息滚动、轮次导航、用量行、用户气泡、输入收起
│   ├── code-blocks.css          # 代码块/SVG/Mermaid 卡片兼容规则
│   ├── markdown-content.css     # subagent trace 字号、文件路径链接、用户消息首尾距
│   ├── context-compaction.css   # 上下文压缩提示卡
│   ├── observer-strips.css      # persist-degraded / 会话写租约观察条
│   ├── waiting-bubble.css       # assistant 等待气泡
│   ├── process.css              # 过程组/阶段折叠
│   ├── tool-summary.css         # 工具摘要行排版与标题
│   ├── math.css                 # KaTeX 展示公式横滑
│   ├── running-state.css        # 工具运行扫光与思考流光
│   ├── process-timeline.css     # 思考 header、跑马灯、工具行压平、阶段展开
│   ├── tool-output.css          # 命令控制台、diff、diff 比例条
│   ├── composer.css             # composer 外壳、textarea、回到顶部、命令建议
│   ├── composer-overlays.css    # slash chip、文件引用建议
│   ├── composer-controls.css    # 附件、plus 菜单、思考/权限、模型菜单、发送/停止
│   ├── empty-state.css          # 任务启动器、空对话、项目选择
│   ├── compact.css              # 对话区 icon-only 紧凑模式
│   ├── interaction-cards.css    # 审批卡与 ask-user 向导卡
│   ├── runtime-notices.css      # 排队消息、SSE 重连、轮次错误
│   ├── artifact-cards.css       # 产物文件卡与变更文件聚合卡
│   ├── goal-workflow.css        # goal 条带/报告、todo 历史、workflow 摘要卡
│   ├── todo-summary.css         # Composer 上方 TodoWrite 收拢胶囊 + 悬停任务浮层
│   ├── pinned-summary.css       # 桌面置顶摘要浮窗
│   └── file-rollback.css        # 会话文件回滚弹窗
└── workspace/
    ├── workflow-detail.css      # run_workflow 运行详情单页（吸顶轴 / 阶段跨度条 / 共享网格层与运行游标 / 并行组 bracket / 日志 console 块 / 错误定位闪烁；步骤行 = 复用聊天卡 + 右侧轨道列 grid，绝对定位层轨道列宽走 --wf-tl-track-plot，见 components 文档同名小节的基准说明）
    └── inspector-tabs.css       # Workspace Inspector 顶部 Tab 条
```

## 归属规则

- 新样式写到拥有该功能的模块；没有归属再新建模块并在入口登记。不要把规则继续堆到入口或相邻模块。
- 同一 selector 默认只属于一个模块。确需跨模块覆盖时，在 `tests/frontend/css-architecture.test.ts` 的 `crossModuleSelectors` 登记并说明原因；当前只有 4 组（`:root` / `.dark` 的 token 命名空间、subagent 摘要行的排版与交互态、tool-summary detail 的布局与 reduced-motion）。
- 共享 token、keyframes、动效原语放 `foundation.css` / `motion.css`，功能模块只消费。
- 组件自持 CSS 只允许懒加载、class 前缀独占的 surface 使用；新增前先确认不会覆盖全局 selector。

## 测试与验证

- 架构守卫：`npx vitest run tests/frontend/css-architecture.test.ts`。
- 全局样式契约统一从 `tests/helpers/app-css.ts` 的 `appCss` 读取；它按入口 import 图递归内联，测试不需要知道模块边界。
- 结构迁移或大范围搬移后运行 `npm run build`，对比构建前后 CSS：规则集（selector → declarations）应保持一致。本次从单体拆分时 3393 条规则、0 语义差异。
