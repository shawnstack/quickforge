# Session Handoff

- Feature: IndexedDB 应用规划 F12-F15
- Status: **全部 done**（用户指令"直到所有任务完成"已达成；最终全量门禁 `npm run test` 203 文件/1629 项 100%、`npm run lint` 0 error、`npm run build` exit 0）
- 交付总览：
  - **F12 `session-message-indexeddb-cache`**：`src/lib/indexeddb-cache.ts`（通用只读封装，LRU+字节双预算）+ `src/lib/session-message-cache.ts`（serverKey 回退/结构校验/1.5s debounce 写入+stateVersion 高水位守卫）+ `server-agent.ts` restore 缓存命中快路径与 SSE 写回；刷新/重进会话先渲染本地快照（2000 条会话省 ~1.19MB 重拉），版本一致时零 /messages 请求。
  - **F13 `workspace-inspector-cache`**：服务端 file 端点补 `mtimeMs`+`?meta=1` 轻量模式；`src/lib/workspace-cache.ts`（目录 TTL 30s SWR+展开路径持久化+文件 size+mtimeMs 失效戳、>1MB 跳写）；WorkspaceInspector 接线（重开 Inspector 整树即时恢复、TTL 内零网络、同文件重开零内容传输、force 刷新绕过缓存）。
  - **F14 `app-settings-swr-cache`**：`src/lib/app-settings-cache.ts`（白名单 4 键：language/appearance/font-size/tool-display）+ boot 开头快照预应用（任何 await 前、与 health 并行）+ 既有 await 序列即校准 + 成功路径回写 + `HttpStorageBackend.set` 写通（覆盖迁移写/默认写全部写点）；access-mode 不缓存。
  - **F15 `workspace-preview-cache`**：前置评估确认 HTTP 方案可行（URL 稳定、重载在 React key 不在 URL、cookie 同源兼容），**按约定不以 IndexedDB 闭环**——preview 路由 ETag（stat mtimeMs+size）+ If-None-Match→304 + `private, no-cache`，同文件重复预览零 body 重传，零前端改动。
- 共同边界（全程遵守）：服务器唯一权威，IndexedDB 仅浏览器只读缓存层，任何缓存失败静默回源路径；无新依赖；未 commit/tag/push；未手工修改 dist/。
- 新增文件：src/lib/{indexeddb-cache,session-message-cache,workspace-cache,app-settings-cache}.ts + tests/frontend/{indexeddb-cache,session-message-cache,workspace-cache,app-settings-cache,use-app-bootstrap-snapshot,i18n-language-snapshot}.test.ts + tests/server/routes/workspace-file-meta.test.mjs；测试净增约 63 项（13+8+6 / 7+3+3 / 6+4+2+4 / 7）。
- 文档同步：docs/wiki/src/lib、src/hooks、src/components、server/routes、docs/architecture/browser-cache-strategy.zh-CN.md。
- Notes: 工作区存在其他智能体并行改动（cloud/scheduled-tasks/workspace-tree-on-demand 等），全部门禁在并行改动共存下通过；只碰了 F12-F15 相关文件。
- Next: 无（规划闭环）。遗留观察（不阻塞）：F13 目录 TTL 30s 内树变更不自动出现（手动刷新即权威）；F14 过期快照预应用后可能一次静默切换（写通保证通常最新）；F15 stat→readFile TOCTOU 最多多传一次（改动前已存在）。
