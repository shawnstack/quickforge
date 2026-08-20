# 工具卡片实时 ±行数滚动计数器 — 设计稿

> 视觉样稿：`diff-odometer-counter.html`（浏览器直接打开，含重播按钮）
> 状态：设计阶段，未实施。

## 目标

Edit / Write 类文件修改工具执行时，工具卡片上实时显示 `+N −M` 行数，
数字变化时以里程计（odometer）逐位滚动动画呈现；工具结束后定格为最终值。

## 现状与差距

- 服务端 `server/tools/index.mjs`：`toolWriteFile`（L489）/ `toolEditFile`（L539）只在
  **执行结束**时生成 `details.diff = { addedLines, removedLines, text, ... }`
  （由 `server/utils/text-diff.mjs` `createTextDiff` 计算）。
- 前端 `src/lib/local-tools.ts` L277-330 仅在结果到达后渲染一次性
  `quickforge-diff-badge-add/del` 静态徽章；running 期间没有任何行数信息。
- 事件链路已支持实时更新：`tool_execution_start/update/end` →
  `tool-execution-events.ts` 按 toolCallId upsert，update 时 details 浅合并
  （`server/agent-manager.mjs` L586-620），即**前端已具备热更新的数据通道**，
  缺的只是工具执行中途的 diff 产出与展示。

## 方案

### 1. 服务端：中途产出增量 diff 计数

- `toolEditFile`：逐个 apply replace。每完成一次 replace，对「已应用部分」调用
  `createTextDiff`（或直接累计 added/removed 行数，成本更低），通过
  `tool_execution_update` 发出 `partialResult.details = { running: true, diff: { addedLines, removedLines } }`。
  多数编辑只有 1-2 处 replace，节奏天然是「跳几格、滚一下」。
- `toolWriteFile`：整文件一次写入，中途无中间态；不伪造数据，结束时
  直接从 0 滚动到最终值（odometer 本身的滚动即是「出现」动画）。
- 保持 `diff.text` 仅在 end 事件携带，避免 update 事件体积膨胀。

### 2. 前端：odometer 数字组件

新组件 `src/lib/diff-counter.ts`（lit 自定义元素 `quickforge-diff-counter`，纯展示）：

- `+`/`−` 符号 + 每位数字一列；列内 0-9 垂直堆叠，`translateY(-digit * 1em)`
  + `cubic-bezier(.22,1,.36,1)` 过渡实现滚动；`font-variant-numeric: tabular-nums`
  防抖动。
- 位数增长（进位）时新列从上方淡入下落；位数不変时仅位移。
- running 期间整组 1.6s 呼吸（opacity 轻微起伏）；结束后取消呼吸定格。
- 颜色复用现有 diff 徽章的 add/del 色（绿/红），符合 DESIGN_LANGUAGE 的克制原则：
  无新色、无阴影，只是已有徽章的动态化。

### 3. 接入点

- `local-tools.ts` 工具摘要卡：running 且 `details.diff.addedLines` 存在时，
  用 `quickforge-diff-counter` 替换静态徽章渲染；`toolStatus()` 判定 running 的
  现有逻辑（`isStreaming || details.running`）直接复用。
- 现有 end 时的静态 `+A -R` 徽章与 diff 折叠块不变，计数器结束后与徽章合流
  （或直接由计数器充当徽章，折叠展开后仍显示完整 diff 块）。

## 不做的事

- 不在前端流式解析 arguments 估算行数（args 是整包到达，估算不可靠且重复服务端逻辑）。
- 不给 Write 伪造中途数字。
- 不改动 diff 折叠块、审批卡等既有视觉。

## 验证计划

- `tests/frontend/diff-counter.test.ts`：数字位数变化、进位列新增、running→done 状态。
- `local-tools` 相关 lit reactivity 测试补充：partial diff 到达时计数器替换静态徽章。
