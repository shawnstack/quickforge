# Session Handoff

- Feature: 侧栏展开项目挤压底部设置区修复（sidebar-sections-footer-squeeze-fix）
- Status: **done**（lint/tsc 通过；未创建 commit/tag/push）

## 当前目标（已达成）

桌面端侧栏展开多个项目后不再把底部设置区挤出可视区：置顶会话区与项目区在空间不足时按 flex 收缩并转为内部滚动，设置区始终可见。

## 改动文件

- `src/components/sidebar/ChatSidebar.tsx`：移除置顶会话区（981 行）与项目区（1009 行）的 `md:shrink-0`，保留 `max-h`、`min-h-0`、内部 `overflow-y-auto`（共 2 行 className 改动）。
- 状态文件：`feature_list.json`（新条目 done）、`progress.md`、`session-handoff.md`。

## 根因摘要

- `md:shrink-0` + `max-h-[28%]`/`max-h-[55%]` 与顶部固定区（~240px）、底部设置区高度互不感知；总需求超视口时对话区（`flex-1 min-h-0`）先缩到 0，剩余溢出被 aside `overflow-hidden` 从底部裁切，设置区被推出可视区。

## 验证结果

- `npx eslint src/components/sidebar/ChatSidebar.tsx`：0 error / 0 warning。
- `npx tsc --noEmit -p tsconfig.app.json`：通过。
- 仓库无 sidebar 相关测试文件；建议人工展开多个项目确认视觉效果。

## Blockers

- 无。

## Next step

- 无必须事项。建议下个发布窗口按 runbook 跑全量 test/lint/build。
