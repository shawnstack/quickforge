# goal 过程 icon 清单报告

> 范围：仅设计稿/文档交付，未改动任何代码。以下结论以源码为准（调研快照）。
> 配套视觉稿：`docs/design/goal-tool-conversation-mockup.html`。

## 0. 一句话结论

goal 的各状态**没有一对一专属图标**，前端统一把 status 映射成 tone（info / active / warning / success / danger），再取 5 个内联 SVG；`GoalIcon` 只作 goal 身份图标；对话内 `goal_report` 工具卡目前**复用 `todo_write` 图标**，无专属工具图标；迭代分隔线只区分「成功勾 / 失败感叹」两种。

## 1. goal 工具与状态模型（来源）

- 工具 schema：`server/tools/definitions.mjs` L96-132 `goalReportTool`
  - action：`plan` / `progress` / `complete` / `blocked` / `needs_review`
  - criterion status：`pending` / `passed` / `failed` / `needs_review`
- 前端工具卡渲染：`src/lib/local-tools.ts` L1048 `GoalReportToolRenderer`，L1258 `registerToolRenderer('goal_report', ...)`
- 历史视图模型：`src/lib/goal-report-history.ts` L16-22（action → 文案）
- 活 goal 状态类型：`src/lib/goal.ts` L10-23（13 种 status）

## 2. status → tone 映射（13 status → 5 tone）

来源：`goal-card.ts` / `goal-control-strip.ts` 的 `toneForStatus()`（约 L108-114）。

| status | tone | 图标语义 |
|---|---|---|
| planning | info | info（圆圈 + i） |
| awaiting_confirmation | info | info |
| running | active | active（圆圈 + 表盘指针） |
| verifying | active | active |
| awaiting_input | active | active |
| awaiting_approval | active | active |
| pausing | active | active |
| paused | active | active |
| blocked | warning | warning（三角感叹） |
| needs_review | warning | warning |
| completed | success | success（圆圈 + 勾） |
| failed | danger | danger（圆圈 + 叉） |
| cancelled | danger | danger |

## 3. tone 图标（5，内联 SVG）

来源：`src/components/chat/panel-decoration/goal-card.ts` L221-227 `STATUS_ICON`；
`src/components/chat/panel-decoration/goal-control-strip.ts` L142-148 另有一份相同实现。
均为 `<svg viewBox="0 0 24 24">`，`fill:none`、`stroke:currentColor`、`stroke-width:2` 风格。

| tone | 语义 | SVG path | 色值 |
|---|---|---|---|
| info | 圆圈 + i | `<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>` | `#3478d4` |
| active | 圆圈 + 表盘指针 | `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>` | `#3478d4` |
| warning | 三角感叹 | `<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>` | `#d97706` |
| success | 圆圈 + 勾 | `<circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/>` | `rgb(4 143 101)` |
| danger | 圆圈 + 叉 | `<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6"/><path d="M9 9l6 6"/>` | `var(--destructive)` |

## 4. goal_report action → tone（对话中的 goal 工具显示）

| action | tone | 色值 |
|---|---|---|
| plan | info | `#3478d4` |
| progress | active | `#3478d4` |
| blocked | warning | `#d97706` |
| needs_review | warning | `#d97706` |
| complete | success | `rgb(4 143 101)` |

## 5. criteria 状态图标（4）

来源：`goal-card.ts` L484-490；颜色由 `src/index.css` L7158-7179 控制。

| criterion status | 图标语义 | SVG path | 颜色 |
|---|---|---|---|
| pending | 空圆圈 | `<circle cx="12" cy="12" r="9"/>` | 灰（muted） |
| passed | 勾 | `<path d="m8 12 2.5 2.5L16 9"/>` | `rgb(4 143 101)`（dark：`rgb(110 231 183)`） |
| failed | 叉 | `<path d="M15 9l-6 6"/><path d="M9 9l6 6"/>` | `var(--destructive)` |
| needs_review | 圆圈 + i | `<circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/>` | `#d97706` |

## 6. 迭代分隔线图标（2）

来源：`src/components/chat/panel-decoration/goal-iteration-divider.ts` L32-35。

| 场景 | 图标语义 | SVG path |
|---|---|---|
| planning 成功、所有 execution 轮 | 圆圈 + 勾 | `<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>` |
| planning 且 outcome 非 running（error/paused/blocked/cancelled） | 圆圈 + 感叹 | `<circle cx="12" cy="12" r="8"/><path d="M12 7v6m0 3v1"/>` |

注意：execution 阶段的 `blocked` / `needs_review` / `error` 分隔线也复用「圆圈 + 勾」。

## 7. goal 身份图标（GoalIcon）

来源：`src/components/goal-icon.tsx` L5-27（React 内联 SVG，箭头射向圆心靶标）。

```html
<circle cx="10" cy="14" r="8"/>
<circle cx="10" cy="14" r="4"/>
<path d="M21 3 10 14"/>
<path d="M10 10v4h4"/>
```

用途（身份图标，非状态图标）：
- `src/components/git/GitToolsPinnedSummary.tsx` L238：胶囊内 `<GoalIcon className="size-3.5" />`
- `src/components/git/GoalSummarySection.tsx` L20：汇总入口 `<GoalIcon className="size-3.5 shrink-0" />`
- `src/components/workspace/WorkspaceInspector.tsx` L1978 / L2057：goal tab 标签页图标

## 8. goal_report 工具卡图标

来源：`src/lib/local-tools.ts` L1066：`renderToolIcon('todo_write')` —— **goal_report 没有专属工具图标，复用 todo_write 图标**：

```html
<path d="M9 11l3 3L22 4"/>
<path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
```

## 9. 工具运行状态图标（4）

来源：`src/lib/local-tools.ts` `renderStatusIcon()` L473-481。

| 状态 | 图标语义 | SVG path | 颜色 |
|---|---|---|---|
| running | 旋转弧线 | `<path d="M21 12a9 9 0 1 1-6.2-8.6"/>` | `text-primary`（旋转动画） |
| done | 圆圈勾 | `<path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><path d="m9 11 3 3L22 4"/>` | 绿 |
| error | 圆圈叉 | `<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>` | `var(--destructive)` |
| called / pending | 实心小圆 | `<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/>` | 灰 |

## 10. 暂无专属 icon 的说明

- **13 个 goal status 均无专属 icon**：只按 tone 复用 5 个图标。例如 `awaiting_input` / `awaiting_approval` / `pausing` 与 `running` 共用 active 图标；`blocked` 与 `needs_review` 共用 warning 图标。
- **goal_report 工具本身无专属图标**：复用 `todo_write` 图标。
- **`/goal` slash 命令无专属图标**：`command-suggestions.ts` 对命令类统一用 `slash-icons.ts` 的 lucide `SquareTerminal`。
- **GoalInspector 状态条无 SVG 图标**：用 CSS 圆点 `quickforge-goal-inspector-status-dot`（`goal-inspector.css` L77-83）表达 tone。
- **GoalInspector 中的 criterion 无图标**：用文字徽章（`GoalInspectorContent.tsx` L209-211）。

## 11. 相关文件清单

- `src/components/goal-icon.tsx` — 唯一独立 GoalIcon 组件（inline SVG，无 .svg 资产文件）
- `src/components/chat/panel-decoration/goal-card.ts` — 完整 goal 卡（生产 UI 未挂载，历史 renderer 保留）
- `src/components/chat/panel-decoration/goal-control-strip.ts` — 输入框上方 goal 运行条
- `src/components/chat/panel-decoration/goal-iteration-divider.ts` — 迭代分隔线
- `src/lib/local-tools.ts` — `GoalReportToolRenderer`、`renderToolIcon`、`renderStatusIcon`
- `src/lib/goal-report-history.ts` — goal_report 历史视图模型
- `src/index.css` — goal 卡 / strip / 分隔线 / criterion 图标样式
- `src/components/workspace/goal-inspector.css` — Inspector 状态圆点 / 徽章样式
