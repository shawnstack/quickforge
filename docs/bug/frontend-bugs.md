# 前端 Bug 列表 (src/)

审查日期：2026-05-29  
处理分支：`fix/triage-docs-bugs`

本文件仅保留源码核对后仍需要修复或后续专项确认的问题；误判、过时记录、产品设计选择和纯最佳实践项已删除。

## 已在本分支修复

| # | 文件 | 处理 |
|---|------|------|
| F-01 | `src/lib/server-agent.ts`, `src/lib/shared-server-agent.ts` | 核对后当前代码已在 SSE/state 同步时设置 syncing flag；无需额外修改，原问题已不存在 |
| F-02 | `src/lib/deferred-session-agent.ts` | `DeferredSessionAgent.dispose()` 后清理异步创建完成的 real agent |
| F-03 | `src/lib/patch-thinking-selector.ts` | `patchThinkingSelector` 增加最长等待时间，避免无限 `setTimeout` 轮询 |
| F-07 | `src/components/terminal/TerminalDock.tsx` | 初始终端 session 异步创建完成后若组件已卸载，立即请求删除服务端 session |
| F-09 | `src/lib/server-agent.ts` | SSE reconnect timer 执行时再次检查是否仍有 handler |
| F-10 | `src/hooks/useCrossTabSync.ts` | BroadcastChannel 不可用或构造失败时优雅降级，保留 visibility refresh |
| F-11 | `src/components/ui/toast.tsx` | 追踪并清理 toast 自动关闭的二级 timer |
| F-13 | `src/components/chat/panel-decoration.ts` | readOnly 检查提前，避免给即将移除的 composer 注册 handler |
| F-14 | `src/lib/share-client.ts` | 分享密码生成优先使用 `crypto.getRandomValues`，仅在不可用时回退 `Math.random` |

## 保留：后续专项确认 / 修复

### F-06. 分享组件硬编码中文字符串

**文件:** `src/components/share/ShareConversationDialog.tsx`, `src/components/share/SharedConversationPage.tsx`

这属于 i18n/体验问题，不是核心功能 bug。需要统一梳理分享模块文案，并补充中英文翻译 key。

**建议:** 单独 i18n 分支处理，避免和 bug 修复混在一起。

---

### F-08. `ChatPanelHost` 恢复草稿使用多个未清理的定时器

**文件:** `src/components/chat/ChatPanelHost.tsx`

`restoreDraftForSession` 调度多个 timeout / animation frame / promise callback。修复需要稍微调整函数结构，让调用方持有 cleanup。

**建议:** 单独小改，快速切换会话/卸载场景手动验证。

---

### F-18. `useSentinel` IntersectionObserver 不在 DOM 节点变化时重新 observe

**文件:** `src/hooks/useSentinel.ts`

当前使用场景中 sentinel 节点较稳定，实际触发概率低。若后续列表 DOM 结构更频繁重建，再改为 callback ref + state 触发重新 observe。
