# Progress

## Current State

- Feature: 上下文统计纯输入口径 + 删除预留输出展示（context-usage-input-only-metrics）
- Status: **done**（服务端+前端+测试+文档完成；针对性 vitest 2 文件 22 项、全量 test 205 文件 1670 项 100%、lint 0 error、build 通过；已提交，工作区其他遗留改动未提交）
- Blockers: 无
- Next step: 人工 UI 验证（模型环 hover popover 不再出现“预留输出”行，“输入 / 上下文”行显示 input / window；百分比按纯输入口径下降）；随下个 patch 发布前完整跑 test/lint/build

## 上下文统计纯输入口径 — 完成

- 背景：上一 feature（context-usage-reserved-output-clamp）曾让 reservedOutputTokens 模拟 pi-ai 真实请求的 clamp 收缩，percent = (input + reserved) / window。经确认真实请求链路 pi-ai `clampMaxTokensToContext` 每次都会按窗口收缩 max_tokens，统计侧模拟预留输出既不增加安全性又让口径复杂，本次改为纯输入口径并删除 UI“预留输出”展示。
- 改动：
  - `server/context-usage.mjs`：删除 `OUTPUT_SAFETY_TOKENS` 常量与 `clampReservedOutputTokens` 导出；`estimateContextUsage` 的 percent 改按 `inputTokens / contextWindow`（保留 ×1000/10 round），返回对象删除 `reservedOutputTokens`（顶层与 breakdown），`totalTokens` 对齐为 `inputTokens`（兼容保留字段，注释说明）；`shouldCompactContextByPercent` 判据由 totalTokens 改为 inputTokens 并更新语义注释。
  - `server/auto-compaction.mjs`：空会话分支删除顶层与 breakdown 的 `reservedOutputTokens: 0`；压缩策略本身未动。
  - `server/agent-manager.mjs`：grep 确认 L495/L2511/L2852/L2953 均为 `getSessionContextUsage()` 结果透传，无 removed 字段直接引用，零改动。
  - `src/components/chat/chat-utils.ts`：删除 TS 版 `clampReservedOutputTokens`/`OUTPUT_SAFETY_TOKENS`；`ContextUsageInfo` 与 breakdown 删 reserved 字段；`getContextUsage` 去掉 `maxTokens` 参数（tsconfig `noUnusedParameters` 强制），percent 纯输入、totalTokens 对齐 inputTokens。
  - `src/components/chat/context-usage.ts`：类型与 `normalizeServerContextUsage` 删 reserved（totalTokens 恒等 inputTokens）；tooltip title 删“预留输出”行、`contextUsageUsed` 的 used 改 inputTokens；popover 删“预留输出”行与冗余独立“总量”行（取舍：保留带标签的“输入 / 上下文”行，值扩为 `input / window` 以保留窗口信息）；inline label 改 `inputTokens / window`；`getMaxTokens` 选项与调用管线移除。
  - `src/components/chat/ChatPanelHost.tsx`：删除 `getMaxTokens: () => agent.state.model?.maxTokens` 传参。
  - `src/lib/server-agent.ts`：`ServerAgentContextUsage`/`Breakdown` 类型删 reserved 字段（totalTokens 保留）。
  - `src/lib/i18n.ts`：删除 `contextUsageReservedOutputLabel`、`contextUsageReservedOutput` 及随之失去消费者的 `contextUsageTotal`（popover 总量行已删）共 3 key × 中英双语。
- 测试：删除 `tests/frontend/context-usage-clamp.test.ts`（vitest include 为 `tests/**/*.test.{mjs,ts}` glob，无文件级引用，删除安全）；`tests/frontend/context-usage.test.ts` 迁入 3 项纯输入用例（provider 输入驱动 percent=30 且 totalTokens==inputTokens 且无 reserved 键、近满窗 97%<100、本地估算回退+零窗口 percent=0）并更新 3 处 serverUsage fixture（去 reserved/total、percent 25→20）；`tests/server/auto-compaction.test.mjs` 两 clamp 场景改写为纯输入断言（31_000→percent 31、97_000→percent 97）+ provider 恢复场景 percent 12.5→8.5。
- 验证：`npx vitest run tests/server/auto-compaction.test.mjs tests/frontend/context-usage.test.ts` 22/22；`node --test tests/server/auto-compaction.test.mjs` 不可用为既有情况（文件首行 import 'vitest'，本就只能 vitest 运行）；`npm run test` 205 文件 1670 项 100%；`npm run lint` 0 error（仅既有 cloud/identity.mjs warning）；`npm run build` 通过（仅既有 KaTeX 字体/大 chunk warning）。
- 残留检查：git grep `reservedOutputTokens`/`ReservedOutput`/`clampReservedOutputTokens`/`OUTPUT_SAFETY_TOKENS`/`contextUsageTotal`——源码与测试无残留（测试中仅存 `'reservedOutputTokens' in usage === false` 刻意断言）；剩余匹配仅为 feature_list.json/progress.md 历史记录条目（如实记录上一 feature 的过往改动，保留不改写）。
- 文档：docs/wiki/server/README.md 两处（L102 agent-manager 上下文统计、L355 auto-compaction.mjs 模块说明）公式改写为 `percent = inputTokens / contextWindow`，删除预留输出公式与字段列举中的 reservedOutputTokens；src/components wiki 仅列函数名无口径描述，无需同步。
- 未新增依赖；未创建 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`（dist 为 npm run build 验证产物）。

## 上下文统计预留输出 clamp — 完成

- 根因：`estimateContextUsage`（server/context-usage.mjs）与 `getContextUsage`（src/components/chat/chat-utils.ts）的 `reservedOutputTokens = max(0, maxTokens || 4096)` 无上限封顶；真实请求链路中 pi-ai `clampMaxTokensToContext`（simple-options.js，CONTEXT_SAFETY_TOKENS=4096）每次请求都会将实际 maxTokens 收缩为 min(配置值, contextWindow − estimatedInput − 4096)，下限 1。统计用未收缩配置值导致 maxTokens ≥ contextWindow 时（内置目录 14% 模型、自定义连接可任意填写）percent 恒 ≥100%、自动压缩判定恒触发。
- 改动：
  - `server/context-usage.mjs`：新增 `OUTPUT_SAFETY_TOKENS = 4096`（注释对齐 pi-ai）与导出 `clampReservedOutputTokens(requestedMaxTokens, inputTokens, contextWindow)`；`estimateContextUsage` 中 `reservedOutputTokens` 移到 inputTokens（provider 与本地估算较大值）计算后取 `clampReservedOutputTokens(model?.maxTokens, inputTokens, contextWindow)`，返回值顶层与 breakdown 均自动使用新值。
  - `src/components/chat/chat-utils.ts`：`getContextUsage` 上方新增同口径导出 `clampReservedOutputTokens`（TS 版）与 `OUTPUT_SAFETY_TOKENS`；函数内改 `clampReservedOutputTokens(maxTokens, usedTokens, contextWindow)`，保持单行 return 风格。
  - 未改 `shouldCompactContextByPercent`（口径自动跟随）与空会话 reserved=0 路径（auto-compaction.mjs L292-311，确认不受影响）。
- 测试：`tests/server/auto-compaction.test.mjs` +2——退化场景（cw 100_000/mt 120_000/最后 assistant usage totalTokens 31_000）断言 reserved 64_904（= 100_000−31_000−4_096，provider inputTokens 取 usage.totalTokens 口径）、totalTokens 95_904、percent<100；溢出场景（输入 97_000/mt 8_000）断言 reserved 0、percent<100。新增 `tests/frontend/context-usage-clamp.test.ts` 4 项（前端 provider 输入优先取 usage.input：退化 reserved 65_904/total 95_904；溢出 reserved 0；正常 mt 4_000 不受 clamp；helper 边界：无窗口返回原值/undefined 回退 4096/下限 0）。既有 percent 12.5 用例继续通过。
- 验证：`npx vitest run tests/server/auto-compaction.test.mjs tests/frontend/context-usage.test.ts tests/frontend/context-usage-clamp.test.ts` 3 文件 23 项通过；回归（composer-draft-restoration/composer-plus-menu/context-compaction-notice/editor-bindings）4 文件 17 项通过；`npx eslint`（4 个改动文件）0 error/0 warning；`npx tsc --noEmit -p tsconfig.app.json` 通过。
- 文档：docs/wiki/server/README.md 两处补 clamp 口径句（agent-manager「上下文统计」条目、auto-compaction.mjs 模块说明）；src/components wiki 仅列举函数名无口径描述，无需同步。
- 未新增依赖；未创建 commit/tag/push；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## 启动 health 超时 5 分钟 + 子进程死亡提前退出 — 完成

> 曾为 Current State：已随 v1.7.9 发布，全量 test/lint/build 与发布流程由主 Agent 执行。

## 启动 health 超时 5 分钟 + 子进程死亡提前退出 — 完成

- 根因：升级后首次启动触发 SQLite cutover 迁移超过 15 秒 health check 窗口，`qf start`/`qf restart` 报 `health check timed out`；`startService` 超时后 terminate 子进程并清 PID，形成启动失败循环。
- 改动：
  - `bin/quickforge.mjs`：新增 `STARTUP_HEALTH_TIMEOUT_MS = 300000`；`waitForHealth` 默认 `timeoutMs` 使用该常量；轮询循环内当 `expectedPid && !isProcessRunning(expectedPid)`（spawn 子进程已死）时 `sleep(300)` 后返回 null——300ms 让 `child.once('exit')` 异步派发，`startService` 的 `exitInfo` 就绪即报 `process exited early (code/signal)`，未就绪则降级为 `health check timed out`（仅措辞差异，正确性不受影响）。
  - `server/public-api.mjs`：同样新增 `STARTUP_HEALTH_TIMEOUT_MS = 300000` 与 `isProcessRunning()` 帮助函数；`waitForQuickForge` 默认超时改 300000 并支持 `expectedPid` 死亡提前退出（grace sleep 300ms 同上）；仅 spawn 模式调用点传 `{ ...options, expectedPid: child.pid }`，inline 模式（进程内启动）保持 `waitForQuickForge(options)` 不加子进程检查。
- 测试：新增 `tests/server/startup-health-timeout.test.mjs` 5 项——源码断言（两处默认 300000 常量与默认参数、调用点不覆盖 timeoutMs、提前退出分支、仅 spawn 模式带 expectedPid）+ 行为测试（blocker HTTP 服务占住目标端口返回 404，`startQuickForge` spawn 的真实 server EADDRINUSE 后 `process.exit(1)`，秒级 rejects `process exited early (code`，elapsed < 45s；`mkdtemp` 数据目录隔离不污染 `~/.quickforge`，端口用 `listen(0)` 随机分配）。`bin/quickforge.mjs` 因 `main()` 在 import 时无条件执行无法安全导入做行为测试，采用源码断言（项目已有 source 测试先例）。
- 验证：`node --check bin/quickforge.mjs server/public-api.mjs` 通过；`npx eslint bin/quickforge.mjs server/public-api.mjs tests/server/startup-health-timeout.test.mjs` 0 error/0 warning；`npx vitest run tests/server/startup-health-timeout.test.mjs tests/server/public-api.test.mjs` 2 文件 12 项通过（行为测试 1.6s）。
- 文档：docs/wiki/bin/README.md 启动流程第 3 条补充默认最长 5 分钟与提前退出说明（start/lan/restart 共用）；docs/wiki/server/README.md 未改——该文件无 public-api/SDK 小节（public-api.mjs 未登记于 server wiki 目录），无启动超时描述可同步。
- 未新增依赖；未创建 commit/tag/push；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## 侧栏展开项目挤压底部设置区 — 完成

- 根因：`src/components/sidebar/ChatSidebar.tsx` 桌面端置顶会话区（981 行）与项目区（1009 行）带 `md:shrink-0` + `max-h-[28%]`/`max-h-[55%]`，与顶部固定区（~240px）和底部设置区高度互不感知；展开多个项目后总高度需求超过视口，唯一可收缩的对话区（`flex-1 min-h-0`）先缩到 0，剩余溢出被 aside 的 `overflow-hidden` 从底部裁切，设置区被推出可视区。
- 修复（方案 A，2 行）：移除两处 `md:shrink-0`；保留 `max-h`、`min-h-0`、内部 `overflow-y-auto`。空间不足时置顶/项目区按 flex 收缩并转为内部滚动（section header 因 `min-height:auto` 保持完整），底部设置区（`shrink-0`）始终可见；`md:` 断点以下移动端行为不变。
- 验证：`npx eslint src/components/sidebar/ChatSidebar.tsx` 0 error/0 warning；`npx tsc --noEmit -p tsconfig.app.json` 通过；仓库无 sidebar 相关测试文件。
- 未新增依赖；未创建 commit/tag/push；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## qf-agent 首次设备授权自动批准 — 完成

- server/cloud/auto-approval.mjs：新增 `beginAgentAutoApprovalWithDesktopSession(userCode, { policy, now, authorize, hasDesktopSession })`——先 `beginAgentAutoApproval`，仅当返回 `none`/`expired`、`policy !== 'manual'` 且 desktop 会话有效时 `armAgentAutoApproval()` 再 `beginAgentAutoApproval(userCode)`；已有 armed/pending/consumed/failed 意图直接返回现有结果，不重复 arm。默认会话检查 `defaultHasDesktopSession()` 走 `getCloudRuntime().identity.status()` 公开状态（`hasSession === true` 且无 `sessionServiceMismatch`），只读不发起网络请求。文件头安全边界注释同步改写。
- server/cloud/qf-agent-process.mjs：`startQfAgent` 新增 `autoApprovalPolicy` 选项（归一化为 'manual'/'auto'，默认 'auto'）并记入 launchOptions；authorizing 日志携带 userCode 时改调 `beginAgentAutoApprovalWithDesktopSession(userCode, { policy: launchOptions?.autoApprovalPolicy })`。TTL 10 分钟、一次性消费、失败保留脱敏错误等语义不变。
- server/routes/cloud.mjs + server/index.mjs：`PUT /api/cloud/config` 对认证远程客户端（`isLocalRequest !== true`）触发的变更在 notify 传 `{ urlChanged, autoApprovalPolicy: 'manual' }`（本机请求仍传 `{ urlChanged }`）；`applyCloudServiceConfig` 透传该选项至 `startQfAgent`。本机 disabled→enabled 立即 arm 的既有路径不变。
- 默认云地址：`server/cloud/service-config.mjs` `DEFAULT_CLOUD_URL` 与 `src/lib/i18n.ts` 两处 `cloudUrlPlaceholder` 由 `http://127.0.0.1:8082/` 改为 `https://qf.shawnstack.com/`（尾斜杠与 parseCloudBaseUrl 规范化一致）；service-config 测试用常量符号断言，无需改动。
- 文档：docs/architecture/quickforge-cloud-client.zh-CN.md 更新“自动批准远程 Agent”安全声明段落（两个意图来源、manual 边界、无有效意图时引导本机登录并重新启用）与产品默认 URL 两处。
- 测试：auto-approval.test.mjs +7；qf-agent-process.test.mjs +3（新增 runtime.mjs mock 与意图重置）；routes/cloud.test.mjs +2；前端 cloud-account-settings-page.test.ts 15 项回归无改动通过。
- 验证：vitest 目标 4 文件 95 项、tests/server/cloud 目录 10 文件 93 项、index.tunnel-host 集成 + 前端 cloud-client/cloud-i18n 16 项全部通过；改动文件 ESLint 0 error / 0 warning。

## F15 Workspace Preview Cache — 完成（HTTP ETag 方案闭环）

- 前置评估结论（explore 核实）：HTTP 方案完全可行无阻碍——preview URL 稳定（`workspacePreviewUrl` 纯函数、`?r=` reloadToken 为死代码无人传参、markdown 图片后缀来自静态源文件）；WebPreviewContent 重载机制在 React key（remount iframe 导航同 URL）不在 URL；iframe/img 走浏览器原生 HTTP 缓存；LAN cookie 鉴权与同源 iframe/img 加载兼容；Android WebView 无 SW 也有原生 HTTP 缓存。按 feature 约定**不以 IndexedDB 闭环**，零前端改动。
- 服务端（server/routes/workspace.mjs）：新增导出 `buildPreviewEtag(stat)`（强 ETag `"\"<mtimeMs>-<size>\""`，源=inspect 已有 stat 零额外 IO）与 `ifNoneMatchSatisfied`（精确/`*`/逗号列表 trim）；handleWorkspacePreview：If-None-Match 命中 → 304（etag + `private, no-cache` + nosniff，不读文件体零传输）；未命中 → 200 增加 etag 与 content-length（stat.size），cache-control 由 no-store 改为 `private, no-cache`（每次协商、文件变化立即生效）；`?__quickforge_check=1` 响应补 mtimeMs；错误分支零改动。
- 测试：tests/server/routes/workspace-preview.test.mjs 扩展 7 项（buildPreviewEtag 直测 + mockReq/mockRes 经真实 handleWorkspaceApi 分发器：首请求 200 头与 fs.stat 精确一致/304 精确匹配/`*` 与逗号列表/陈旧 ETag 200 新值/__quickforge_check mtimeMs/403・404・415 no-store 回归），mkdtemp 零残留。
- 验证：node --check 通过；目标 ESLint 0/0；针对性 4 文件 43 项；**全量 test 203 文件/1629 项 100%、lint 0 error、build exit 0**。
- 文档：docs/architecture/browser-cache-strategy.zh-CN.md（preview 从"禁止缓存"移入新增"协商缓存"分级+第 6 节说明）、docs/wiki/server/routes/README.md 两处 preview 端点补 etag/304/no-cache/mtimeMs。
- 效果：同文件重复预览（iframe remount/img 重新加载/文件树缩略图/Markdown 图片）由每次全量重传变为 304 零 body 重传；文件被修改（mtimeMs/size 变化）立即返回新内容。

## F14 App Settings SWR Cache — 完成

- 调研：启动序列 boot()（useAppBootstrap.ts）约 11 次串行 await（health + 8 settings GET + project + catalog）；语言/外观/字号/工具显示均在 hook 内以副作用 apply（不依赖返回值契约）；i18n 缺"只应用不写库"导出；settings 写全部收敛于 HttpStorageBackend.set（含 font 迁移直写/启动默认写）。
- 实现：
  - 新增 `src/lib/app-settings-cache.ts`（store 'app-settings'，白名单 4 键 language/appearance-settings/font-size-settings/tool-display-settings；null 哨兵=无快照；结构校验坏条目删除；单值 >4KB 跳写；`updateAppSettingSnapshotFromStorageSet` storeName+白名单过滤；全静默降级）。
  - i18n.ts 新增导出 `applyAppLanguageFromSnapshot`（复用 isAppLanguage+setCurrentLanguage，不 PUT 不 reload）；tool-display-settings.ts 新增 `applyToolDisplaySettingsValue`。
  - useAppBootstrap.ts：boot 开头（任何 await 前）`void Promise.all(4 reads).then(preapply)`（逐键 try/catch 静默、与 health 并行不阻塞）；既有 await 序列即校准（各 load* 自然重 apply）；`setReady(true)` 前 fire-and-forget 回写 4 键（仅成功路径）；access-mode/default-options/active-model/cloud 完全不动。load* 本就返回值，未改签名。
  - http-storage-backend.ts：`set()` 成功后 `void updateAppSettingSnapshotFromStorageSet(...)` 写通（返回语义不变），覆盖全部 settings 写点。
- 测试：新增 tests/frontend/app-settings-cache.test.ts 6 项 + use-app-bootstrap-snapshot.test.ts 4 项（预应用时序/miss 零调用/校准回写/预应用抛错不阻断）+ i18n-language-snapshot.test.ts 2 项 + http-storage-backend.test.ts 扩展 4 项写通；共新增 16 项。
- 验证：tsc 0 错；目标 ESLint 0/0；针对性 9 文件 63/63；**全量 test 203 文件/1622 项 100%、lint 0 error、build exit 0**。
- 有意取舍：过期快照预应用后服务器校准可能一次静默切换（SWR 固有，写通保证快照通常最新）；backend 显式 baseUrl 场景写通用当前后端 serverKey（生产恒 ''，无偏差）。
- 文档：wiki src/hooks（启动序列按现状重写，补 cloud prefetch + 快照 SWR）与 src/lib（app-settings-cache.ts）已由实现同步。
- 边界遵守：未改 settings API/服务端校验；未缓存 access-mode；无 SW 拦截；无新依赖；未 commit。

## F13 Workspace Inspector Cache — 完成

- 调研关键事实：children 条目无 mtime/size、file 响应有 size 无 mtime——失效戳需服务端最小增量提供。
- 服务端（server/routes/workspace.mjs）：抽出 `statWorkspaceTextFile`（resolve+安全校验+stat+isFile/413，不读内容）；`readWorkspaceTextFile` 返回增加 `mtimeMs`（零额外 IO）；`handleWorkspaceFile` 支持 `?meta=1` 轻量模式（同一安全校验/stat，仅返回 {path,size,mtimeMs,language,readonly} 不读内容）。50MB/错误语义/其余路由不动。
- 前端：新增 `src/lib/workspace-cache.ts`（复用 IndexedDbCache store 'workspace-cache' maxEntries 240/32MB + resolveServerCacheKey；目录条目（完整未截断才写）+ 展开路径 + 文件条目（size+mtimeMs 失效戳、>1MB 跳写）；`isWorkspaceDirectoryCacheFresh` TTL 30s（0≤age≤ttl 新鲜）、`workspaceFileMatchesMeta`（字段齐全且相等才 true）纯函数；坏条目删除、不可用 no-op）；workspace-api.ts 新增 `getWorkspaceFileMeta`。
- WorkspaceInspector.tsx 接线（最小侵入，seed 复用现有 reducer success action）：`loadTreeDirectory` 非 force/append 且 idle 时读目录缓存——TTL 内 dispatch seed 即返回（零网络），过期 seed 后继续原 fetch（SWR）；fetch success 仅"非 append 且 nextCursor===null 且未 truncated"时写缓存；`toggleTreeDirectory` 同步持久化展开路径，恢复 effect（项目 id ref 防重复）重开 Inspector 时恢复 expandedPaths 并逐目录 loadTreeDirectory；Reader 统一 helper `loadReaderFileFromCacheOrServer`（命中→立即写回 tab+后台 meta 校验→一致即结束/不一致全量重拉覆写；未命中→原流程+成功写缓存；校准失败静默保留缓存）；`refreshWorkspace` 经 `refreshedReaderIdsRef` 标记 bypass 缓存读（刷新=权威），openFileTab 新 tab 分支注册 loading key 消除既有双请求。
- 测试：新增 tests/frontend/workspace-cache.test.ts 7 项 + tests/server/routes/workspace-file-meta.test.mjs 3 项（mtimeMs 与 fs.stat 精确一致/meta=1 无 content/ENOENT+413 不回归）+ workspace-inspector-on-demand-source.test.ts 扩展 3 项接线断言。
- 验证：tsc 0 错；目标 ESLint 0 error/0 warning；针对性 6 文件 44 项 + 回归 6 文件 62 项；**全量 test 200 文件/1606 项 100%、lint 0 error、build exit 0**。
- 有意取舍：TTL 30s 内目录变更不自动出现（手动刷新/force 即权威）；stale seed 与 fetch 间短暂 loading；stat→read TOCTOU 最多多拉一次全量（无害）。
- 文档：wiki server/routes（file mtimeMs+meta）、src/lib（workspace-cache.ts）、src/components（Inspector 缓存行为）同步。无新依赖；未 commit。
- Next step: F12 `session-message-indexeddb-cache`（pending，IndexedDB 会话消息只读快照缓存）已登记，依赖 F9 done、阻塞已清；下一会话可从 Phase 1（基准+设计）启动。IndexedDB 应用规划已全部登记：F12（消息快照+共享模块）→ F13 `workspace-inspector-cache`（文件树+文件内容，依赖 F12）→ F14 `app-settings-swr-cache`（启动 settings SWR，依赖 F12）→ F15 `workspace-preview-cache`（前置评估 HTTP 缓存替代，无依赖可提前评估）；P3 项（模型目录/composer 附件/subagent 详情）按需暂缓不登记

## F11 LAN Access Storage Migration — Phase 3（backup/restore 纳入 + 离线工具 + 全量门禁）

- **backup route**（`server/routes/backup.mjs`）：
  - 导出：`backupScopes` 新增 `lan-access`；`all`/`lan-access` scope 在 authoritative 下经新模块 `server/lan-access-backup.mjs` 的 `exportLanAccessStateForBackup()` 导出——lan-access 维护锁内 `quick_check` + `verifyIntegrity` + `exportSnapshot`，count/digest 校验 fail closed；`data.lanAccess` 为单个配置对象（**只含 token 哈希非明文、剔除 revision**）；包新增顶层 `lanAccessState: { phase, count, digest }`（count = token 数）；非权威路径直接读 `security/lan-access.json`。
  - 恢复：`restoreSectionIds` 新增 `lanAccess`；authoritative 下经 `restoreLanAccessStateSnapshot()`（lan-access 维护锁 + `lan-access-restore-plan.json` 计划文件 + 失败补偿，replace 全量 / merge 保留本地配置字段与 tokens、backup 同 key 覆盖）；只触碰 lan-access 三表，route 测试断言 F5 `scheduled_task_runs`/F7 `session_index`/F9 `session_messages`/F10 `share_sessions` 行数不变；维护锁占用时含 lanAccess 的 import 返回 423 `lan_access_maintenance`；v1 `lan-access.json` 形状（无 envelope、token 缺 issuedAt）经 `buildLanAccessJsonSnapshot` 归一化导入（issuedAt 缺失 → 哨兵 `1970-01-01T00:00:00.000Z`）；恢复覆盖 enabled 开关 → inspect 警告新增「将替换局域网访问配置」；恢复含 sessions/shares/lanAccess 时安全备份 scope 为 all。
  - `recoverLanAccessRestorePlan()` 接入 `server/index.mjs` 启动链（`initializeLanAccessCutover` → `initializeLanAccessService` → `recoverLanAccessRestorePlan` → `drainLanAccessJsonMirror`），applying 类 roll-forward、compensating 类 rollback。
- **离线工具**：
  - `server/maintenance/export-lan-access-v1.mjs`：停机权威 v1 导出（quick_check+verifyIntegrity+exportSnapshot、count/digest fail closed、临时文件重读再校验后 rename）；`cutover_running`/`json_authoritative` 拒绝。
  - `server/maintenance/downgrade-lan-access-v1.mjs`：`--dry-run` 只读报告（零写入）；默认 drain 物化完整 `security/lan-access.json` 并对拍 SQLite 快照（tokenCount/digest 精确）；`--commit` 校验通过后切回 `json_authoritative`；失败不留部分输出/不改变相位。
- **测试**：新增 `tests/server/backup.authoritative-lan-access.test.mjs`（7 项：scope=lan-access/all 导出含 lanAccessState+digest+token 哈希+无 revision、replace 且 F5/F7/F9/F10 行数不变、merge 保留本地字段与 tokens、legacy v1 无 envelope 归一化、维护锁 423、inspect 警告含「将替换局域网访问配置」、restore 后 verifyLanAccessToken 任何输入 fail-closed）+ `tests/server/lan-access-offline-export.test.mjs`（7 项：停机导出、导出→恢复 roundtrip digest 对拍、json_authoritative/cutover_running 拒绝、dry-run 零写入、materialize 后 JSON 可读 + --commit 相位切换、mirror 不匹配拒绝、失败不留部分输出）。
- **Electron full-chain smoke**（`tests/fixtures/session-state-full-chain-electron-smoke.mjs`）：扩展覆盖 lanAccess——authoritative 下 exportLanAccessStateForBackup/restoreLanAccessStateSnapshot digest 对拍、offline export 工具导出、downgrade-lan-access-v1 dry-run 零写入→materialize→--commit 相位切换；输出 `lanAccess: { phase, count: 1, roundtripDigestOk, mirrorOk, revokeAllOk, backupRestoreOk, downgrade: { dryRunOk, materialized: 1, committed, phaseAfterCommit } }`；Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）实测通过，既有 4 个 Electron fixtures 复跑全部通过。
- **全量门禁**：`npm run test` **196 文件 / 1566 项 100% 通过**；`npm run lint` **0 error**（仅既有 `server/cloud/identity.mjs` 1 条 warning，非本次改动）；`npm run build` **exit 0**（仅既有 KaTeX 字体与大 chunk warning）。`index.tunnel-host.integration.test.mjs` 真实启动链（含 recoverLanAccessRestorePlan）4/4 通过。
- **最终审计**：authoritative 下 LAN 写路径均经 repository/service（`writeLanAccessFile` 5 处调用全部位于非权威 JSON 分支；`writeLanAccessJsonFile` 仅 mirror 物化 / cutover 源兜底 / 非权威 route restore 使用），无 JSON 权威旁路；verifyLanAccessToken 任何输入 fail-closed（store 整体 try/catch + repository 版本号/常数时间哈希，含 backup/restore/downgrade 后状态异常）；F1-F11 链最终一致性：schema 最新 v9、scheduled/session/share/lan 四域权威闭环（启动链依次 cutover，full-chain smoke 端到端覆盖）；未 commit；未手工修改 `dist/`/`package-dist/`/`package-offline/`（build 生成的 `dist/` 由脚本完成）。
- 文档：`docs/architecture/lan-access-storage-migration.zh-CN.md` §8/§9/§10 更新为完成状态（backup/restore 语义、离线工具、已知限制：restore 覆盖 enabled、token 可重建故 cutover 失败最坏损失重登、mirror 含哈希非明文）；`docs/wiki/server/README.md`（lan-access-backup 模块 + 两个离线工具 + 启动链 + 行数）、`docs/wiki/server/routes/README.md`（backup 端点 lan-access scope/section/423）同步。

## F12 Session Message IndexedDB Cache — Phase 2+3（实现+集成，完成）

- 实现（general subagent，主 Agent 审查 diff 后接受）：
  - `src/lib/indexeddb-cache.ts`（新）：通用只读封装。`computeCacheKey`/`selectEvictionKeys` 纯函数（LRU+字节双预算，永不淘汰最后一条）；`IndexedDbCache` 惰性单例 open（onupgradeneeded 建库、versionchange/blocked 静默失败）、条目级 schemaVersion、get 命中更新 lastUsed、put 后按策略淘汰；所有异常降级 null/false；import 期零副作用。
  - `src/lib/session-message-cache.ts`（新）：`resolveServerCacheKey`（baseUrl 归一化→getDirectBackendBaseUrl→location.origin→'unknown'）；`readSessionMessageSnapshot` 结构校验（schemaVersion=1/messages Array/stateVersion、messageCount 非负 number/snapshot object），坏条目删除返回 null；`writeSessionMessageSnapshot` per-key 1.5s trailing debounce（覆盖式 pending builder）、flush 时 stateVersion 高水位守卫（新≤旧跳写）、build null 跳写；`flushPending`/`cancelPending`；`getSessionMessageCache` 惰性单例（store 'session-messages'，maxEntries 40，默认 64MB 预算）。
  - `src/lib/server-agent.ts`：restore 缓存命中快路径——读缓存（signal aborted 跳过）→ `cachedSnapshotToStateSnapshot` 水合 → `initialStateFromSnapshot` 构造 agent → 后台 `refreshStateFromServer({notify:true, forceMessages:false})` 校准（不 POST /restore）→ 校准后调度一次写快照；`_doRefreshStateFromServer` skip 优化：非 forceMessages 且 `serverStateVersion === lastServerStateVersion`（在水位赋值前捕获）且 split `summary.count === state.messages.length` → 跳过 reconcile（不请求 /messages）；`MESSAGE_CACHE_EVENT_TYPES` 8 类 SSE 事件（state/agent_end/message_end/turn_end/messages_replaced/tool_execution_start/update/end）订阅回调后统一 debounce 写快照；`sessionCacheMetadata` 私有字段在 restore/create/缓存水合三处设置（全部 `new ServerAgent` 调用点均在类内）保留 title/scope 等元数据；dispose 不取消 pending 写（模块级 timer 落盘最后状态是安全上界）。
  - 关键偏离（合理）：restore/create 写入改为统一 builder 读 agent 实时状态（语义等价且更保鲜）；server-agent 测试 mock 完全替换 debounce（调度次数+显式 flush 断言），debounce 计时语义由 session-message-cache 独立 fake timers 用例覆盖。
- 测试：新增 `tests/frontend/indexeddb-cache.test.ts` 13 项（文件内 fake IDBFactory/DB/Tx/Store/Request ~100 行，queueMicrotask 回调模型）+ `tests/frontend/session-message-cache.test.ts` 8 项 + `server-agent.test.ts` 扩展 6 项（27→33，vi.mock session-message-cache 内存 Map fake）：缓存命中即时渲染且 /state 版本一致时不请求 /messages、版本前进走 after= 补拉、未命中原路径+物化后写快照、create 写快照、SSE message_end 增量帧写快照、校准 /state 抛错 agent 不崩且保持缓存消息。
- 已知限制（可接受）：同版本不同内容场景高水位守卫会阻塞回写（既有 reconcile 在该场景同为 no-op，无新回归面）；isStreaming=true 缓存水合会提前启动 watchdog 轮询（期望行为）；页面关闭 debounce 窗口（≤1.5s）内更新丢失（缓存上界语义）；超大会话快照可能被字节预算挤出。
- 验证：`npx tsc -b` 0 错；目标 ESLint 0 error/0 warning（6 文件）；针对性 54/54 + deferred-session-agent 回归 6/6；**全量门禁：`npm run test` 198 文件/1593 项 100% 通过、`npm run lint` 0 error（仅既有 identity.mjs 1 warning）、`npm run build` exit 0（仅既有 KaTeX/大 chunk warning）**。
- 文档：`docs/wiki/src/lib/README.md` 表格新增两模块 + server-agent 小节新增缓存行为说明。
- 边界遵守：服务器 SQLite 唯一权威；SSE 帧语义/noteSseEvent/versionBefore 守卫/syncState 公共行为/API shape 全部不变；无新依赖；未触碰 dist/；未 commit。
- 备注：工作区存在其他智能体并行改动（cloud/workspace 等），全量门禁在并行改动共存下通过。

## F12 Session Message IndexedDB Cache — Phase 1（基准+设计，完成）

- **基准证据**（`node scripts/session-message-benchmark.mjs 500 2000 --runs 3 --reads 5`，本机 Windows / Node 24 / SQLite 3.50.4 / schema v9）：
  - 500 条（≈64k tokens）：messagesBytes 297,251 B；2000 条（≈256k tokens）：messagesBytes 1,189,001 B（decision `transport: true`，超 1MB 用户可感知阈值；F9 Phase 3 已实测拆分后 state 帧 278B）。
  - 前端行为（explore 核实）：页面刷新 / `?session=` 进入 / 空闲 agent 被 LRU 逐出（`agent-task-retention.ts` MAX_IDLE_AGENT_TASKS=5）后重进 → `ServerAgent.restore` POST /restore（split 会话仅 278B summary）+ `fetchAllSessionMessages` 分页全量重拉（500/页，前端不传 limit）≈ messagesBytes 量级；内存驻留之外无任何持久缓存。
- **决策**：证据充分，实施 F12。刷新/重进每次重传 0.3~1.2MB（更大会话线性放大），是用户可感知瓶颈；save/read 服务端均远低于阈值，纯前端缓存层即可。
- **设计**（Phase 2/3 规格）：
  - 缓存 key：`${serverKey}::${sessionId}`，serverKey = `getDirectBackendBaseUrl() || location.origin`（移动壳天然同源加载服务器页；无现成"服务器标识" API，backend-url.ts 即权威来源）。
  - 快照：`{ schemaVersion:1, serverKey, sessionId, stateVersion, messageCount, messages, snapshot(完整 restore 响应形状), savedAt }`；失效戳只用服务端权威字段 stateVersion（SSE noteSseEvent 单调高水位，消息必随版本单调应用）。
  - SWR：restore 命中缓存 → 用缓存的 snapshot 立即构造 agent（instant render）→ 后台 `refreshStateFromServer({notify:true, forceMessages:false})` 校准；`/state` 的 stateVersion === 缓存 stateVersion 且 split summary.count === 本地条数 → 跳过 /messages 补拉（版本相等=自缓存后无任何状态变更，安全）；不等 → 走既有 reconcile（尾部增量 or 全量重取，versionBefore 守卫不变）。
  - 写入：restore 全量物化、create 物化后写快照；SSE 事件驱动写走模块级 debounce（~1500ms trailing，flush 时读 builder 快照）；写时 stateVersion 高水位守卫（低于既有条目则跳写）；全部 best-effort 静默降级。
  - 容量：单 key LRU（lastUsed）+ 条数上限（40）+ 字节预算（64MB）裁剪；读侧 schemaVersion/结构校验，坏条目按 miss 处理。
  - 测试策略：无 jsdom、禁新依赖 → IndexedDbCache 的 IDB 边界用测试内 ~100 行 fake IDBFactory 验证；策略函数（LRU 选择、key、守卫）纯函数直测；server-agent 集成用例 vi.mock('@/lib/session-message-cache')（内存 Map 实现）。
- 验证：基准脚本运行成功（scratchDir 自动清理）；本阶段未改代码。

## F11 LAN Access Storage Migration — Phase 2（lan-access-store 接入 + 生命周期 + routes）

- `lan-access-store.mjs` 全部读写路径按 phase 路由（F10 share-store 同款模式）：`repositoryActive()` = service 的 pending/authoritative；`updateLanAccessSettings`→`updateSettings`（单事务 authVersion+1 清 tokens、密码≥8 校验与 enabled 无密码 400 保持、hashPassword 仍在 store 层）、`issueLanAccessToken`→`issueToken`（403/401 语义保持、≤100 裁剪、TTL 语义不变）、`verifyLanAccessToken`→`verifyToken`（`verifyLanAccessTokenRecord` 版本号+常数时间 fail-closed，整体 try/catch 兜底任何存储异常/输入畸形一律返回 false，无 fail-open 路径）、`revokeLanAccessTokenById`→`revokeTokenById`（404 保持）、`revokeLanAccessToken`（logout）→`revokeToken`（版本门控）、`revokeLanAccessTokens`→`revokeAll`（authVersion+1）；`readLanAccessStatus`/`readLanAccessConfig`→repository read（config 行缺失抛 503 fail-closed，不静默按默认处理）。
- 写后 `requestLanAccessJsonMirrorDrain()`；维护锁 423 `LAN_ACCESS_MAINTENANCE_ACTIVE` 仅 authoritative 写路径（`assertLanAccessWritesAllowed`），json_authoritative/cutover_running 保留旧 JSON 路径（enqueueWrite 队列语义不变）；保留 normalizeConfig 语义与 ENOENT 兜底默认配置。
- 生命周期（`server/index.mjs`）：share cutover 之后接入 `initializeLanAccessCutover()` → `initializeLanAccessService()` → `drainLanAccessJsonMirror()`；pending/authoritative 完整性失败 fail-closed 阻止启动、json_authoritative 失败安全保留旧 JSON 路径；`shutdownRuntime` finally 在 `closeSqliteStorage` 之前调 `stopLanAccessService()`（清 mirror timer）。
- routes：`routes/lan-access.mjs` 无需改动即消费 repository 记录（store 内部路由、API shape 不变）；CAS 409 `LAN_ACCESS_STATE_CONFLICT` / 维护锁 423 经 `sendError` 稳定映射；`isAuthorizedRemoteRequest` 已消费 `store.verifyLanAccessToken`（自动路由到 repository verifyToken，fail-closed）；暴力破解 attempts Map 与 `requireLocal` 完全未动；`renderLanUnlockPage` 不变。
- 测试：新增 `tests/server/lan-access-store.authoritative.test.mjs`（8 项：authoritative 全生命周期 settings 改密码清 tokens/issue/verify/revoke-all authVersion/logout 版本门控/revoke by id 404；CAS 409 + 维护锁 423（settings/issue/revoke/revoke-by-id）且释放后恢复；json_authoritative/cutover_running 回退 JSON 路径不触 SQLite；mirror drain 后 lan-access.json 可读（无 revision）；启动顺序 cutover→service→drain + shutdown 释放后数据库可重开且 phase 持久化；pending integrity 破坏 fail-closed 阻止启动（store 在 pending 已走 repository）；≤100 裁剪经 store；鉴权回归——失效/过期/版本不匹配/畸形输入/记录缺失一律拒绝）。
- Electron full-chain smoke：fixture 增加 F11 Phase 2 store 段（authoritative 下 store 读写路由 repository、改密码清 tokens 旧 token 失效、store issue/verify/版本门控、logout、revoke-all、drain 后镜像 authVersion 对拍）。
- 回归：`lan-access-store.test.mjs` 既有 2 it 与 `routes/lan-access.test.mjs` 既有 2 it 全部通过（JSON 路径不回归）；routes 目录 + share authoritative + backup share 回归 19 文件 / 123 项通过。
- 验证：`node --check` 改动文件通过；目标 ESLint 0 error / 0 warning（store/index/smoke fixture/新测试）；Vitest 针对性 6 文件 / 33 项（store 2 + routes 2 + service 4 + cutover 6 + store.authoritative 8 + repository 11）+ Electron full-chain smoke（schemaVersion 9 / lanAccess authoritative / store 链路）通过。
- 按 Phase 2 要求未运行全量 build，未标 done；未 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。
- 安全门禁：authoritative 下无 JSON 权威写路径（JSON 仅 mirror 物化）；verifyLanAccessToken 任何输入 fail-closed（repository 异常/记录缺失/格式异常均不放行）；测试全部隔离 dataDir（mkdtemp）；暴力破解防护（routes 内存 attempts Map）未触碰。
- Phase 3 待办：backup/restore（`lanAccessState` envelope + `recoverLanAccessRestorePlan` 接入启动链）、离线工具（export-lan-access-v1 / downgrade-lan-access-v1，参考 F10 share 同款）、全量门禁（test/lint/build 全部通过后标记 done）。

## F11 LAN Access Storage Migration — Phase 1（登记 + schema v9 + lan-access repository + service/cutover 核心层）

- 决策已确认（调研结论）：整体迁移（配置+token 一起）、直接权威切换+可靠性外壳（LAN token 可重建）、JSON 降级 best-effort mirror、纳入 backup/restore 与离线工具、鉴权 fail-closed 不回归。
- schema v9 `lan_access_storage_migration`：`lan_access_state`（单配置行 singleton=1 PK，enabled/password_hash/salt/version/auth_version/session_ttl_hours/updated_at/revision CAS/record_digest/extra_json，CHECK enabled=1 必须有密码对）+ `lan_access_tokens`（token_id PK + seq 插入序 + token_hash/issued_at/expires_at/auth_version/remote_address/user_agent，≤100 按 seq 裁剪）+ `lan_access_storage_state`/`lan_access_maintenance_lock`/`lan_access_json_mirror_queue` 独立域表；v8→v9 失败全回滚（测试证明 F5/F7/F9/F10 数据保留），新库 schemaVersion 9。
- repository `server/sqlite/lan-access-repository.mjs`：严格对象映射与白名单（已知配置字段→列、其余 extra_json roundtrip）；`normalizeLanAccessConfig` 共享 cutover/镜像（password 对、enabled 需密码、token 结构、过期裁剪、slice(-100)）；`lanAccessConfigDigest` 含 tokens 与未知字段（排除 revision）；单事务 `updateSettings`（密码变更或 enabled 切换 authVersion+1 且清空 tokens，与配置更新+mirror 入队同事务）、`issueToken`（enabled+passwordHash 校验 403、生成 secret/hash、过期清理+≤100 裁剪、返回 token/expiresAt/maxAge）；CAS revision（409 `LAN_ACCESS_STATE_CONFLICT`）；`revokeTokenById`（404）/`revokeToken`（logout 版本门控）/`revokeAll`（authVersion+1 清空）；`verifyToken`=`verifyLanAccessTokenRecord`（版本号匹配 + 常数时间 `safeHashEqual` + 过期过滤，fail-closed）；`replaceAll`/`exportSnapshot`/`verifyIntegrity`（record_digest、password 对、≤100、孤儿、authVersion 一致）/`count`/`digest`/`listMirrorQueue`/`acknowledgeMirror`/`failMirror`。
- service `server/lan-access-service.mjs`：独立域四相状态机（`lan_access_storage_state`）；`drainLanAccessJsonMirror` single-flight（失败 attempts+1 保留、成功 acknowledge、定时重试）；`createDefaultLanAccessMirror()` 经 `materializeLanAccessJsonEntry` 原子物化 `security/lan-access.json`（tmp+rename）。
- cutover `server/lan-access-cutover.mjs`：`buildLanAccessJsonSnapshot` 整包校验（enabled/passwordHash 成对、tokens 结构）；`readLanAccessJsonSource` 默认读源——文件缺失/损坏统一 ENOENT 兜底默认禁用配置（fail-closed）并物化稳定副本；双快照 tokenCount/digest → v1 backup（`quickforge-lan-access-cutover-*.json` 临时文件重读校验后 rename）→ 三读 → `replaceAll`+pending 同事务 → verifyIntegrity 对拍 → drain → authoritative；pending 前失败回 json_authoritative、pending 后 fail-closed 保持 pending 可恢复；独立 `lan_access_maintenance_lock`（PID+fencing+heartbeat+expiry，`runLanAccessMaintenance`）。
- 测试：新增 `tests/server/lan-access-repository.test.mjs`（11 项：v9 迁移回滚 F5/F7/F9/F10 保留、settings+清 tokens 单事务、issue+≤100 裁剪+过期、verifyToken fail-closed（版本/哈希/过期/禁用）、CAS 409、revoke by id/logout/revoke-all、exportSnapshot roundtrip（哈希非明文）、未知字段 roundtrip、mirror 队列+事务回滚、count/digest、legacy token id 归一化）、`tests/server/lan-access-cutover.test.mjs`（6 项：buildSnapshot 校验、双快照+backup+pending、不稳定回 JSON+pending 恢复+integrity fail-closed、cutover_running 恢复、exportSnapshot roundtrip、维护锁 fencing/heartbeat）、`tests/server/lan-access-service.test.mjs`（4 项：phase 路由、真实文件 mirror 物化、失败重试、缺失/损坏文件 ENOENT 兜底）。
- 既有 v8 硬编码断言升级 v9：sqlite-storage-foundation（迁移/表清单/health/tooNew 10/failing 10/concurrent 9）、scheduled-task-runs-repository（health/迁移清单/v2 降级补 DROP lan_access 表/concurrent）、session-index-repository、session-index-query、session-state-repository（末迁移名）、share-repository（末迁移名）、index.tunnel-host.integration（schemaVersion 9 / migrationCount 9）、session-state-full-chain-electron-smoke 测试 + 4 个 Electron fixtures（schemaVersion 9）；full-chain fixture 增加 F11 lan-access 全链段（cutover→authoritative、issue/verify/版本门控、exportSnapshot→replaceAll digest 对拍、mirror 物化、revokeAll）。
- 文档：新增 `docs/architecture/lan-access-storage-migration.zh-CN.md`（决策/schema/repository/service/cutover/边界/Phase 2-3 待办）；`docs/wiki/server/README.md` sqlite 小节更新 migration 9 与 lan-access 四模块。
- 验证：`node --check` 全部改动通过；目标 ESLint 0 error / 0 warning（20 个改动/新增文件）；`tests/server` 全量 **123 文件 / 927 项 100% 通过**（含新增 3 文件 21 项 + v9 断言升级 + lan-access-store/routes 回归 + share/session/scheduled-runs 全回归）；`index.tunnel-host.integration.test.mjs` 真实启动链（schemaVersion 9 / migrationCount 9）4/4 通过；Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）full-chain smoke 输出 `{"ok":true,"schemaVersion":9,...,"lanAccess":{"phase":"authoritative","count":0,"roundtripDigestOk":true,"mirrorOk":true,"revokeAllOk":true}}`，既有 5 个 Electron fixtures 复跑全部 schemaVersion 9 通过。
- 按 Phase 1 要求未运行全量 build，未将 F11 标记 done；未 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

## F10 Share Token Storage Migration — Phase 3（backup/restore 纳入 + 离线工具 + 全量门禁）

- **backup route**（`server/routes/backup.mjs`）：
  - 导出：`backupScopes` 新增 `shares`；`all`/`shares` scope 在 authoritative 下经新模块 `server/share-backup.mjs` 的 `exportShareStateForBackup()` 导出——share 维护锁内 `quick_check` + `verifyIntegrity` + `exportSnapshot`，count/digest 校验 fail closed；导出记录含 tokens（哈希）、剔除 revision/deletedAt；包新增顶层 `shareState: { phase, count, digest }`；非权威路径直接读 `conversation-shares.json`。
  - 恢复：`restoreSectionIds` 新增 `shares`；authoritative 下经 `restoreShareStateSnapshot()`（share 维护锁 + `share-restore-plan.json` 计划文件 + 失败补偿，replace 全量替换 / merge 保留 local-only、backup 同 key 覆盖）；只触碰 share 三表，不破坏 F5 `scheduled_task_runs`、F7 `session_index`、F9 `session_messages`（route 测试断言 scheduled_task_runs 不变 + 源码断言不含 session_index/sessionIndex）；维护锁占用时含 shares 的 import 返回 423 `share_maintenance`；v1 `conversation-shares.json` 形状（含旧版单令牌字段）经 `buildShareJsonSnapshot` 归一化导入；空 `shares: {}` 语义：replace 清空、merge 保留；inspect 增加 shares 替换警告；恢复 sessions/shares 时安全备份 scope 为 all。
  - `recoverShareRestorePlan()` 接入 `server/index.mjs` 启动链（`initializeShareCutover` → `initializeShareService` → `recoverShareRestorePlan` → `drainShareJsonMirror`），applying 类 roll-forward、compensating 类 rollback。
- **离线工具**：
  - `server/maintenance/export-share-v1.mjs`：停机权威 v1 导出（quick_check+verifyIntegrity+exportSnapshot、count/digest fail closed、临时文件重读再校验后 rename）；`cutover_running`/`json_authoritative` 拒绝。
  - `server/maintenance/downgrade-share-v1.mjs`：`--dry-run` 只读报告（零写入）；默认 drain 物化完整 JSON 并对拍 SQLite 快照（count/digest 精确）；`--commit` 校验通过后切回 `json_authoritative`；失败不留部分输出/不改变相位。
- **完整性修复**（F10 范围内）：①`normalizeShareRecord` token issuedAt 缺失时归一化为确定性哨兵 `1970-01-01T00:00:00.000Z`（与 `share_tokens.issued_at NOT NULL` 存储表示一致），遗留 v1 导入 cutover/backup 两侧 digest 1:1 对拍；②`repository.create` 新记录路径行 `created_at` 与 record_digest 使用同一输入值（此前用当前时间导致输入 createdAt ≠ now 时 verifyIntegrity invalidDigests）。
- **测试**：新增 `tests/server/backup.authoritative-share.test.mjs`（6 项：scope=shares/all 导出含 shareState+digest+tokens、replace 且 F5 不变、merge 保留 local-only、legacy v1 无 envelope 归一化、维护锁 423、空 shares 语义）+ `tests/server/share-offline-export.test.mjs`（7 项：停机导出、导出→恢复 roundtrip digest 对拍、json_authoritative/cutover_running 拒绝、dry-run 零写入、materialize 后 JSON 可读 + --commit 相位切换、mirror 不匹配拒绝、失败不留部分输出）。
- **Electron full-chain smoke**（`tests/fixtures/session-state-full-chain-electron-smoke.mjs`）：扩展覆盖 share——JSON seed → share cutover → authoritative、create/read/issueToken/verify/revoke 经真实 share-store、exportShareStateForBackup/restoreShareStateSnapshot digest 对拍、mirror drain 后 JSON 可读、downgrade-share-v1 dry-run 零写入→materialize→--commit 相位切换；输出 `{"ok":true,"schemaVersion":8,...,"share":{"phase":"authoritative","count":2,"restoreDigestOk":true,"mirrorOk":true,"downgrade":{"dryRunOk":true,"materialized":1,"committed":true,"phaseAfterCommit":"json_authoritative"}}}`；Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）实测通过。
- **全量门禁**：`npm run test` **190 文件 / 1523 项 100% 通过**；`npm run lint` **0 error**（仅既有 `server/cloud/identity.mjs` 1 条 warning，非本次改动）；`npm run build` **exit 0**（仅既有大 chunk warning）。`index.tunnel-host.integration.test.mjs` 真实启动链（含 recoverShareRestorePlan）通过。
- **最终审计**：authoritative 下 share 写路径均经 repository/service（backup restore 走 replaceAll、share-store 写走 repository、JSON 文件仅为 best-effort mirror；`writeSharesJsonFile` 仅 mirror 物化与非权威 legacy 分支使用）；F11 边界（LAN token 缓存独立安全域，`lan-access-store.mjs`）未越界；未 commit；未手工修改 `dist/`/`package-dist/`/`package-offline/`（build 生成的 `dist/` 由脚本完成）。
- 文档：`docs/architecture/share-token-storage-migration.zh-CN.md` §9 更新为 Phase 3（backup/restore 语义、离线工具、digest 稳定性、已知限制）；`docs/wiki/server/README.md`（share-backup 模块 + 两个离线工具 + 启动链）、`docs/wiki/server/routes/README.md`（backup 端点）同步。

## F10 Share Token Storage Migration — Phase 2（share-store 接入 + 生命周期 + routes）

- share-store 全部读写路径按 phase 路由（`server/share-store.mjs`）：`pending`/`authoritative` 下 `createConversationShare`/`readConversationShare`/`listConversationShares`/`revoke`/`restore`/`updateConversationShare`/`updateConversationShareExpiration`/`delete`/`issueConversationShareToken`/`verifyShareToken`/`pruneShareTokens`（新增导出）经 `getShareRepository()`（share-service 新增访问器）——create 幂等更新当前记录 + supersede 其余同 session 记录（事件 superseded/updated 语义与 JSON 一致、密码未提供时保留原密码、accessCount/lastAccessedAt 保留）；token issue/verify/revoke/update 后失效、7天/≤50/authVersion 语义不变；read/list 走 repository（list 显式 `includeRevoked:true` 维持 UI 展示已禁用分享）。
- JSON 文件降级为 best-effort mirror：repository 写后 `requestShareJsonMirrorDrain()` 调度 drain（默认 mirror 物化回 `conversation-shares.json`，保留可读）；authoritative 下无 JSON 权威写路径。
- 保留：`onConversationShareInvalidated` 事件、`assertShareActive` 404/410 状态机、operate 需密码、`shareCookieName`/`parseCookies`、API shape 不变；authoritative 下维护锁被持有写路径返回 423 `SHARE_MAINTENANCE_ACTIVE`。
- 生命周期（`server/index.mjs`）：session state cutover 之后按序 `initializeShareCutover()` → `initializeShareService()` → `drainShareJsonMirror()`；pending/authoritative 完整性失败 fail-closed 阻止启动、json_authoritative 失败安全保留旧 JSON 路径；`shutdownRuntime` finally 调 `stopShareService()`（清 mirror timer）。
- `share-service.mjs`：补回 `json` 配置项 + `requireShareJsonAdapter`（session-state-service 同款 jsonAdapter 扩展点）+ `getShareRepository()` 导出。
- routes：`routes/shares.mjs` restore 改用 `readConversationShare`（get 含 revoked 记录，不再依赖 list 过滤）；`routes/shared-conversation.mjs` 无改动即消费 repository 记录（verifyShareToken 分支到 repository.verifyToken）；CAS 409/维护锁 423 经 `sendError` 稳定映射。
- 测试：新增 `tests/server/share-store.authoritative.test.mjs`（4 项：authoritative 全生命周期走 repository——supersede 单事务 + token issue/verify/revoke 失效 + list includeRevoked + 事件；CAS 409 + 维护锁 423；json_authoritative/cutover_running 回退 JSON 路径不触 SQLite；mirror 写后 drain 文件可读）与 `tests/server/share-lifecycle.test.mjs`（5 项：启动顺序 cutover→service init→mirror drain、authoritative 完整性 fail-closed、unstable 源回 json_authoritative 保 JSON 路径、mirror 队列跨启动恢复、shutdown 释放后队列保留）。
- 回归：share-store.test.mjs 既有 4 it（disable→restore→delete、token 失效、过期时间、权限/密码更新）与 rollback-atomic 2 it 不回归；routes/shares、shared-conversation model-visibility、前端 share-client 不回归；session-state/storage/sqlite/scheduled-runs 回归批通过。
- 文档：`docs/architecture/share-token-storage-migration.zh-CN.md` 新增 §8 Phase 2 与 §9 Phase 3 待办；`docs/wiki/server/README.md` share 三模块 + share-store 小节更新。
- 验证：`node --check` 全部改动通过；目标 ESLint 0 error / 0 warning（6 个改动/新增文件）；Vitest 针对性 19 文件 / 105 项通过（新增 2 文件 9 项 + share 7 文件 32 项 + routes 2 文件 3 项 + 前端 share-client 1 项 + sqlite/session 回归 10 文件 62 项 + electron smoke 1 项）；`index.tunnel-host.integration.test.mjs` 真实启动链（含 share cutover）通过；Electron full-chain smoke schemaVersion 8 通过。
- 按 Phase 2 要求未运行全量 build，未标 done；未 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

## F10 Share Token Storage Migration — Phase 1（登记 + schema v8 + share repository + cutover/service 核心层）

- 决策已确认：①完整套路（影子双写→cutover→维护锁→backup/restore/离线工具）②`share_tokens` 独立表 ③纳入 backup/restore。Phase 1 不接线 share-store/routes/backup。
- schema v8 `share_storage_migration`：`share_sessions`（share_id PK、session_id、permission、title_snapshot、scope/project_id、password_hash/salt/version、auth_version、allow_cloud_usage、created/updated、expires/revoked/superseded_at、access_count、last_accessed_at、created_from_host、last_updated_from_host、revision CAS、record_digest、deleted_at tombstone、extra_json 未知字段）+ `share_tokens`（share_id FK CASCADE、token_hash、issued_at、expires_at、auth_version，UNIQUE(share_id,token_hash)，≤50 由写入方事务内裁剪）+ `share_storage_state`/`share_maintenance_lock`/`share_json_mirror_queue` 独立存储域；v7→v8 失败全回滚（测试证明 F5/F7/F9 数据保留），新库 schemaVersion 8。
- repository `server/sqlite/share-repository.mjs`：严格对象映射与白名单（已知字段→列，其余→extra_json roundtrip）；`normalizeShareRecord` 供 cutover 复用保证两侧 digest 一致；单事务 create（supersede 同 session 多记录 + 清令牌 + 可选新令牌同事务签发）、幂等（重复 create 更新当前记录）；CAS revision 全变更覆盖（409 SHARE_STATE_CONFLICT）；list 按 sessionId 过滤默认排除 superseded/revoked（`includeRevoked` 供 Phase 2 restore）；delete 走 tombstone 防复活（stale 写入 404）；token issue/verify/prune（过期清理 + 更新 record_digest）；replaceAll/exportSnapshot/verifyIntegrity（record_digest 含 tokens 校验、≤50、孤儿令牌、authVersion 一致）/count/digest/listMirrorQueue/acknowledgeMirror/failMirror。
- service `server/share-service.mjs`：独立域 phase 状态机（json_authoritative/cutover_running/sqlite_authoritative_json_pending/authoritative）；`drainShareJsonMirror` single-flight drain（失败 attempts+1 保留、成功 acknowledge）；`createDefaultShareMirror()` 物化到 `shares/conversation-shares.json`（whole-file 原子写，保留作为 mirror/backup）。
- cutover `server/share-cutover.mjs`：`buildShareJsonSnapshot` 全量校验（shareId/sessionId 必填、tokens 数组结构、password 哈希字段成对、key/id 一致、重复 shareId blocker）；双快照 count/digest → v1 backup 重读校验 → 三读稳定性 → `replaceAll` 与 pending phase 同事务 → verifyIntegrity 对拍 → drain → authoritative；pending 恢复（integrity 失败 fail closed 保持 pending）、cutover_running 安全回 JSON 重跑；**失败保持 pending 不回 JSON 权威**；独立 `share_maintenance_lock`（PID+expiry+fencing+heartbeat，`runShareMaintenance`）。
- 测试：新增 `tests/server/share-repository.test.mjs`（9 项：v8 迁移回滚 F5/F7/F9 保留、单事务 supersede+token、CAS、list 过滤、token prune/verify/≤50/authVersion 失效、tombstone delete、update/revoke/restore 410/409、roundtrip/verifyIntegrity、mirror 队列+事务回滚）、`tests/server/share-cutover.test.mjs`（6 项：v1 JSON 校验/重复 shareId blocker、双快照+pending、不稳定回 JSON+pending 恢复+integrity fail-closed、cutover_running 恢复、exportSnapshot roundtrip、锁 fencing/heartbeat）、`tests/server/share-service.test.mjs`（3 项：phase 路由、真实文件 mirror 物化 upsert/delete、失败重试）。既有 v7 硬编码断言升级 v8：sqlite-storage-foundation（迁移清单/表清单/failing 9/tooNew 9/concurrent 8）、scheduled-task-runs-repository（health/迁移清单/v2 降级补 DROP share 表/concurrent）、session-index-repository、session-index-query、session-state-repository（末迁移名）、index.tunnel-host.integration、session-state-full-chain-electron-smoke 测试 + 4 个 Electron fixtures。
- 文档：新增 `docs/architecture/share-token-storage-migration.zh-CN.md`（决策/schema/repository/service/cutover/边界）；`docs/wiki/server/README.md` sqlite 小节更新 migration 8 与 share 三模块。
- 验证：`node --check` 全部改动通过；目标 ESLint 0 error / 0 warning；Vitest 针对性 22 文件 / 208 项通过（新增 3 文件 18 项 + 既有 v8 断言升级 10 文件 54 项 + share/session 回归 12 文件 77 项 + sqlite 邻近 10 文件 77 项）；Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）4 个既有 fixtures 复跑全部输出 schemaVersion 8；`index.tunnel-host.integration.test.mjs` 真实启动链（schemaVersion 8 / migrationCount 8）通过；按 Phase 1 要求未运行全量 build，未标 done。
- 未 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

## F9 Session Message Incremental Storage — Phase 3（集成 + SSE/前端传输下降 + backup/downgrade + 全量门禁）

### agent-manager 增量接线（显式 delta + 拆分冲突检测）

- `saveSessionStatePair` 返回 `messageStoragePlan`（inline/body-only/replace/append）与权威 `messageCount`；`persistAuthoritativeSessionState` 按 plan 显式传 delta——变长走 `appendMessages` 只写新增尾部行、截断/尾部修改走 `replaceMessages`，维护 `session.persistedMessageStorage` / `persistedMessageCount` / `persistedTailDigest`；空会话删除路径重置计数。
- 新增 service 辅助 `storedMessagesState(sessionId)`（拆分行数 + 尾部行 digest）与 `sessionMessagesTailDigest(messages)`；CAS 冲突重试分支除 body 规范化比较外，对拆分会话额外比较存储行 count/tail digest，判定「storage 只改了 storage-owned 字段（pin/archive）」才采纳新 revision 重试，并发消息写入记为 `persistConflictCount` 并拒绝覆盖（测试证明另一写者 append 不被 agent 覆盖）。
- `restoreAgent` 一次读取权威 record，恢复 `persistedStorageRevision`/`persistedStateJson`/`persistedMessageStorage`/`persistedMessageCount`/`persistedTailDigest`（拆分/内联语义均正确）；`getSessionState` 增加 `messageStorage` 字段。

### route / SSE（stateVersion 语义不变）

- 拆分会话的 `GET /api/agents/:id/state`、`POST /restore`、SSE 初始 `event: state` 帧与 `emitSessionEvent` 下发的 `state` 事件均不携带全量 messages，改为 `messagesSummary: { count }`（`stripSplitSessionState` / `transformSplitSessionEvent`）；非拆分会话与旧客户端逐字节不变。
- 新增增量 SSE 通道：拆分会话的 `message_end`/`agent_end`/`messages_replaced` 帧只发尾部（`messagesAfter` + `messages` + `messagesIncremental: true`）+ `messagesSummary`；尾部为空时仅 summary（截断/rollback）。
- 新增 `GET /api/agents/:id/messages?after=N&limit=…`（默认 500/上限 5000）分页拉取，返回 `{ after, count, hasMore, messages }`；`count < after` 表示服务端截断；会话未在内存时先 restore。
- SSE `stateVersion` 语义严格不变：`noteSseEvent` 旧事件拒绝、poll `versionBeforeFetch` 过期丢弃逻辑原样保留。

### 实测传输下降（Phase 3 benchmark）

- `scripts/session-message-benchmark.mjs` 扩展拆分帧测量（`splitStateBytes`/`splitAppendBytes`/`stateFrameReduction`，隔离 mkdtemp 零残留）：
  - **2000 条会话（≈256k tokens）**：整包 SSE state 帧 **1,189,252 B（1.19MB，Phase 1 基线）** → 拆分后 **278 B**（`stateFrameReduction=0.9998`，-99.98%）；增量 message_end 帧（5 条新消息）**10,538 B（10.3KB）**。
  - 说明：首次冷加载仍需经 `/messages` 传一次全量（状态帧变小，首次总字节接近）；收益在页面刷新/SSE 重连/流式运行期间不再重复重传整包。

### 前端（server-agent.ts）

- `ServerAgentStateSnapshot` 增加 `messageStorage`/`messagesSummary`；新增 `mergeIncrementalMessages`（position + message id/内容去重）、`fetchSessionMessagesPage`/`fetchAllSessionMessages`。
- state 帧 summary 处理 `reconcileMessagesFromSummary`：`summary.count < 本地条数` → 全量重取替换；否则按 `after=本地条数` 拉缺失尾部增量合并；`message_end`/`agent_end`/`messages_replaced` 增量帧同路径合并；快照式过期守卫（`versionBefore`）保证并发 SSE 事件优先。
- `restore()`/`create()` 收到 summary 时先经 `/messages` 物化全量；http-storage-backend 未改动（batch 不受影响）。
- 新增前端测试 6 项：mergeIncrementalMessages 单元、重连 summary 补齐、summary 截断全量重取、message_end 增量合并（零额外 fetch）、messages_replaced summary 全量重取、/restore summary 物化。

### backup / restore（拆分会话端到端）

- 导出重组完整 body；修复 Phase 2 潜在 bug：`snapshotValues` 对「已组装」拆分会话记录（来自 `normalizeSessionSnapshotValues`）此前用 `record.messages ?? []` 清空 messages，导致含拆分会话的备份 restore 后 count/digest 对拍失败；现同时兼容两种形态。
- 新测试：导出含重组 messages、restore 后 `after.digest === exported.digest` 精确对拍、`readSessionStateValue` 组装正确、mirror 端到端（append 后 `drainSessionJsonMirror` 重组正确且 pending=0）。v1 导出格式不变（导出即组装），v1 兼容不回归。

### downgrade（拆分会话完整 v1 整包物化）

- `downgrade-session-state-v1.mjs` 对拆分会话不再 fail closed：drain 物化完整 body（标记 + messages 内联）；SQLite 侧对拍改用 assembled 表示 digest（`{ ...storedState, messages }` + 空 messages digest），与 `buildSessionJsonSnapshot` 一致。
- 新测试：dry-run 零写入（pending mirror 不落盘、phase 不变）→ 默认物化（完整 205 条重组）→ `--commit` 后 phase=json_authoritative 且 JSON 完整可读。

### 全量门禁与验证

- `node --check` 全部改动通过；目标 ESLint 0 error / 0 warning。
- `npm run test`：**183 文件 / 1483 项 100% 通过**（Phase 3 新增：session-state-phase3 4、agent-manager.persist 拆分 3、routes/agent 拆分 state+messages+SSE 帧 7、offline-export downgrade 拆分 1、benchmark 拆分帧断言；更新 Electron full-chain smoke）。
- `npm run lint`：0 error（仅既有 `server/cloud/identity.mjs` 1 条 warning）。
- `npm run build`：exit 0（仅既有 KaTeX 字体与大 chunk warning）。
- Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）ELECTRON_RUN_AS_NODE=1：full-chain smoke 输出 `{"ok":true,"schemaVersion":7,"phase":"authoritative","count":2,"mirrorPending":0,"downgrade":{"dryRunOk":true,"materialized":210,"committed":true,"phaseAfterCommit":"json_authoritative"}}`，覆盖 split save→read→append→SSE 帧字节→backup/restore digest 对拍→mirror drain→scheduled runs 不回归→离线 downgrade；既有 5 个 Electron fixtures 复跑全部通过。
- 安全：SSE stateVersion 语义不变；F5/F7 表结构与查询权威未触碰；authoritative 下新增消息仅经 facade/service 写 SQLite（无 JSON 权威旁路）；测试全部隔离 dataDir（mkdtemp）无真实残留；未 commit；未手工修改 `dist/`/`package-dist/`/`package-offline/`。

## F9 Session Message Incremental Storage — Phase 2（核心存储层）

- schema v7：新增 `session_messages`（复合 PK scope/projectId/sessionId + seq，UNIQUE(…, message_id) 可空，行含 message_json/message_digest/created/updated）+ session_id 索引；v6→v7 迁移失败全回滚，存量 `state_json.messages` 原地保留不回填（拆分为可选的"拆分后写入"）；F5/F7/v6 数据不丢失（回滚测试证明）。
- digest/CAS 语义（已写入架构文档 9.2）：body digest 覆盖存储表示（拆分会话不含 messages 带 `messageStorage:'split'` 标记，未拆分含内联 messages）；行级 message_digest = 规范化 JSON sha256；会话级 messages digest = `sha256(seq\0digest 行)`，无行 = ''；快照 digest 每会话行追加 `\0messages_digest`（`snapshotDigestLine` 统一 cutover/repository/backup 计划 digest）；CAS revision 覆盖 body 与 messages 增量写（appendMessages/replaceMessages 同事务 CAS）；跨 bucket 重复 ID 检测保持。
- repository 增量 API：`appendMessages`（批量、同事务 CAS+行+body+index+outbox，带 message_id 幂等去重，未拆分会话拒绝）、`replaceMessages`（恢复/镜像重组/拆分过渡用）、`readMessagesPage`（seq 稳定排序、limit/offset/afterSeq、返回 digest）、`messageCount`；`delete` 级联删 messages；`verifyIntegrity` 新增 invalidMessageDigests/orphanMessages/invalidMessageRepresentations；`exportSnapshot` 含 messages/messagesDigest 可恢复（replaceAll 按标记拆回，digest 往返不变）；`applyBatch`/`saveMany` 保持单事务（upsert 项支持 messages+messagesMode）。
- service：`saveSessionStatePair`/`saveSessionBody`/`applySessionBatch`/原子更新按 `messageStoragePlan` 路由（inline/body-only/replace/append）；拆分阈值 `MESSAGES_SPLIT_THRESHOLD=200`（可调），≥200 条或空数组清空走 replace，拆分会话变长只 append 新尾部行（边界 digest 校验兜底同长度尾部修改），截断走全量 replace；`readSessionStateValue`/`readSessionStateStore('sessions')`/`exportSessionStateSnapshot` 未拆分从 body、拆分从 body+messages 组装；`deriveMetadata` messageCount/preview 按消息源（未拆分会话兼容）；原子更新传组装后 state；`drainSessionJsonMirror` 拆分会话物化前重组完整 body；phase 语义不变（json_authoritative 不误读 SQLite）。
- cutover：digest 行格式与 repository 对齐（JSON 导入非拆分贡献空 messages digest）；`buildSessionJsonSnapshot` 仍校验 messages 数组；拆分后新写路径与旧 JSON 导入兼容；mirror 物化能重组完整 body。
- backup/离线导出最小无损适配：`exportSessionStateForBackup`/`snapshotValues`/`export-session-state-v1.mjs` 对拆分会话组装完整 body 再导出；restore 计划 digest 用 `splitStateForStorage` 按存储表示计算，恢复后 `sessionState.digest` 不变（表示形式精确往返）。
- 测试：新增 `tests/server/session-state-messages.test.mjs`（13 项：v7 迁移回滚、append/read page 稳定排序、message_id 去重、digest 语义、exportSnapshot roundtrip、v6 迁移内联兼容、阈值拆分/增量 append/清空、边界修改兜底、batch 单事务拆分、原子更新组装、delete 级联、mirror 重组、verifyIntegrity 消息检查、多进程 append CAS）；新增 `tests/fixtures/session-state-messages-cas-worker.mjs`（复用 F8 模式：双进程同 expectedRevision append 仅一个胜出，败者 409 actualRevision=2）；full-chain Electron smoke 扩展拆分会话（save→读重组→增量 append→mirror 重组→delete 级联）。
- 既有断言更新：schema v6 硬编码 → v7（sqlite-storage-foundation、scheduled-task-runs-repository、session-index-repository、session-index-query、index.tunnel-host.integration、session-state-repository 迁移名/表清单、4 个 Electron fixtures + full-chain smoke test）；scheduled-task-runs-repository v2 迁移测试补 DROP session_messages；未改变查询权威行为。
- 文档：`docs/architecture/session-state-transactional-storage.zh-CN.md` 边界声明改为"F9 拆分开始"并新增第 9 节（拆分策略/阈值、digest 版本定义、repository 增量 API、service 适配、已知限制：计数启发式仅验边界、downgrade 对拆分会话 fail closed 属 Phase 3）；`docs/wiki/server/README.md` sqlite 小节更新 v7 与 repository/service 描述。

## F9 Phase 2 Verification

- `node --check`：全部改动文件通过。
- 目标 ESLint：19 个改动/新增文件 0 error / 0 warning。
- Vitest 针对性：14 文件 / 97 项通过（messages 13 + repository 6 + service 5 + cutover 5 + lifecycle 5 + backup 9 + offline 6 + full-chain smoke 1 + facade 17 + agent persist 5 + backup authoritative 6 + foundation 10 + scheduled-runs repo 8 + benchmark 1），另 routes/agent、session-index 相关 20 项通过；`tests/server` 全量 111 文件 / 850 项通过（排除 full-chain smoke 单独跑）。
- Electron 39.8.10（Node 22.22.1 / SQLite 3.51.2）ELECTRON_RUN_AS_NODE=1：full-chain smoke 输出 `{"ok":true,"schemaVersion":7,"phase":"authoritative","count":1,"mirrorPending":0}`（含拆分会话 save/append/镜像重组/删除）；session-state/index/scheduled-runs 三个既有 fixtures 复跑 schemaVersion 7 通过。
- 按阶段要求未运行全量 build，未将 F9 标记 done。

## F9 Session Message Incremental Storage — Phase 1

- 决策原则：先基准后决策，仅当实测数据证明全量 messages 读写/传输是用户可感知瓶颈才拆分；SSE stateVersion 语义不变；不越界 F5/F7；mirror/backup/restore/downgrade 保持兼容。
- 登记：`feature_list.json` 新增 F9 `message-incremental-storage`（dependencies 含 `session-state-transactional-storage`，status in_progress）。
- 基准脚本：新增 `scripts/session-message-benchmark.mjs`（仿 `session-index-query-benchmark.mjs` 风格，不进入 runtime/常规 CI）：
  - 隔离安全：`mkdtemp` 临时 dataDir，且因 `server/utils/logger.mjs` 静态引入 `server/storage.mjs`（其 `dataDir` 在模块求值时固化），脚本将全部项目模块改为动态导入并在 `QUICKFORGE_DATA_DIR` 指向隔离目录后再加载，确保任何路径都不会触碰真实 `~/.quickforge`；运行后 `rm` 清理（Vitest 断言 scratchDir 删除 + 外部 guard 目录零写入）。
  - 规模可参数化：`node scripts/session-message-benchmark.mjs [count...] [--contentChars N] [--runs N] [--reads N]`，默认 500/2000 条、content 512 字符/条（≈4 字符/token 估算）。
  - 指标：authoritative `saveSessionStatePair` 单次提交（含 synchronize + 规范化 JSON 序列化 + SHA-256 digest + BEGIN IMMEDIATE INSERT + session_index upsert + mirror 入队）、`readSessionStateValue` 全量反序列化、GET /state 与 SSE `event: state` 初始帧字节量（复刻 routes/agent.mjs writeSseEvent 帧格式）、非权威 JSON `writeSessionValue` 真实路径（storage.mjs，pretty JSON + tmp/rename 原子写）；另输出 messages 字节占比与"拆分 messages 预计消除占比"（serializationShare=消息字节占比；saveTimeLowerBound=占比×(encodeMs/saveMs)）。
  - 阈值标注：单次保存/读取 >100ms、单会话传输 >1MB 判定 `exceeded`；输出 JSON Lines（scale/meta/decision）+ stderr 可读汇总。
- 实测数据（本机 Windows / Node 24.12 / SQLite 3.50.4，schema v6，content 512 字符/条，runs=5 reads=10）：

  | 消息数 | tokens≈ | save(ms)中位 | save max | read(ms) | GET/SSE 字节 | JSON写(ms) | 传输>1MB |
  | --- | --- | --- | --- | --- | --- | --- | --- |
  | 500 | 64k | 15.1 | 17.2 | 1.1 | 0.29MB | 3.6 | 否 |
  | 2000 | 256k | 39.0 | 55.1 | 4.4 | 1.19MB | 6.6 | **是** |
  | 5000 | 640k | 89.7 | 117.2 | 10.8 | 2.97MB | 12.6 | **是** |

  - messages 占 state JSON 字节 99.6%~99.99%（拆分可消除的序列化/传输占比上界）。
  - 判定：单次保存中位在所有实测规模均 <100ms（5000 条 max 117.2ms 偶发越线），读取远低于阈值；**传输在 2000 条（≈256k tokens）即达 1.19MB 超过 1MB 阈值，5000 条 2.97MB**——真实长会话（大量 tool 结果）可达此规模，且每次页面刷新/SSE 重连都会重传整包，为可感知瓶颈。
- 数据驱动决策：**证据充分，拆分 messages 方向成立（传输瓶颈为主导；保存存在 O(n²) 累积风险但当前中位未越线，非主因）**。F9 保持 in_progress，第一阶段完成；本阶段不实施拆分。
- 第二阶段待办（若启动拆分）：schema v7（新增 `session_messages` 等表）、digest 语义（state_digest 排除/纳入 messages 的定义与 CAS 兼容）、cutover（迁移消息行）、mirror（消息增量镜像物化）、backup/restore（v2 导出格式与恢复补偿）、downgrade（v1 物化回整包）5 条链同步改；SSE 增量下发不改变 stateVersion 语义；F5/F7 表结构不动。
- 针对性验证：`node --check` 通过；目标 ESLint 0 error；新增 `tests/server/session-message-benchmark.test.mjs`（1 文件/1 项）通过——断言 JSON Lines 格式（scale/meta/decision 字段）、阈值结构、scratchDir 删除（零残留）、外部 guard dataDir 零写入。
- 未 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`。

## F8 Session State Transactional Storage — Phase 3

- backup route 权威导出：`buildBackup` 在 authoritative 下走 `exportSessionStateForBackup()`（维护锁内 `quick_check` + `verifyIntegrity` + `exportSnapshot`，count/digest 校验 fail closed），导出包新增顶层 `sessionState: { phase, count, digest }`；非权威路径不变。
- restore：新增 `server/session-state-backup.mjs` `restoreSessionStateSnapshot()`，维护锁内 before→target→单事务 `replaceAll`→count/digest+integrity 验证→计划清理；merge 语义保留 local-only、backup 同 key 覆盖；应用失败自动补偿回 before，补偿失败保留 `compensation_failed` 计划；`recoverSessionStateRestorePlan()` 已接入 `server/index.mjs` 启动链（applying 类 roll-forward、compensating 类 rollback）；route 在维护锁占用时对含 conversations 的 import 返回 423 `session_state_maintenance`；metadata-only 会话恢复权威模式 400；restore 只触碰会话表，不影响 F5 `scheduled_task_runs`（测试证明）；v1 JSON 备份（含无 envelope 旧格式）经归一化导入，body-only 自动派生 metadata。
- 离线工具：`server/maintenance/export-session-state-v1.mjs`（停机权威 v1 导出，cutover_running/json_authoritative 拒绝，临时文件验证后 rename）；`server/maintenance/downgrade-session-state-v1.mjs`（`--dry-run` 只读报告 / 默认物化 JSON mirror 并对拍 SQLite 快照 / `--commit` 校验后切回 json_authoritative）。
- Electron 全链路：新增 `tests/fixtures/session-state-full-chain-electron-smoke.mjs` + `tests/server/session-state-full-chain-electron-smoke.test.mjs`，覆盖 schema v6 下启动 cutover→authoritative、会话 save/read/delete、CAS 409、backup/restore、mirror drain、scheduled runs 不回归；Node 与 Electron（39.8.10 / Node 22.22.1 / SQLite 3.51.2，ELECTRON_RUN_AS_NODE=1）均通过；既有 session-state/scheduled-task-runs/scheduled-runs-cutover Electron fixtures 复跑通过。
- 文档：新增 `docs/architecture/session-state-transactional-storage.zh-CN.md`（schema v6、phase 状态机、CAS、mirror、backup/restore、离线工具、磁盘占用、已知限制：网络盘/WAL 三件套/最低 Node 22.19/multi-version dataDir 拒绝旧版本）；更新 `docs/wiki/server/README.md`（启动链 + sqlite 模块清单 + maintenance 工具）与 `docs/wiki/server/routes/README.md`（backup/storage batch 端点）；DESIGN_LANGUAGE.md 无 UI 改动、不受影响。
- 修复：测试初始化必须显式传 `readBuckets`/`mirror`，避免 storage.mjs 默认路径触及真实 dataDir；已清理一次误写入真实 `~/.quickforge` 的测试残留（global one.json + metadata 条目、projects/p1 桶）。

## F8 Phase 3 Verification

- `node --check`：F8 全部改动通过。
- 目标 ESLint：F8 改动与新增测试 0 error / 0 warning。
- Vitest 针对性：18 文件 / 125 项通过（backup 模块 9、route 权威 6、offline 6、full-chain smoke 1 + F5/F7/生命周期/facade/agent 回归）。
- Electron：full-chain fixture 在 Electron 39.8.10（Node 22.22.1、SQLite 3.51.2）ELECTRON_RUN_AS_NODE=1 输出 `{"ok":true,"schemaVersion":6,"phase":"authoritative","count":1,"mirrorPending":0}`；既有 3 个 Electron fixtures 复跑全部通过。
- 全量门禁：`npm run test` 180 文件 / 1447 项 100% 通过；`npm run lint` 0 error（仅既有 `server/cloud/identity.mjs` 1 条 warning）；`npm run build` exit 0（仅既有 KaTeX 字体与大 chunk warning）。
- 安全审计：全仓 session 写路径（agent-manager/backup route/storage facade 单条/批量/clear）在 pending/authoritative 下均经 facade/service 委托，无 JSON 权威旁路；维护工具（downgrade）为显式运维操作；F9 边界（不拆 messages）未越界。
- 未 commit/tag/push；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 生成 `dist/` 由脚本完成）。

## F8 Session State Transactional Storage — Phase 2

- 启动链：`server/index.mjs` 在 `recoverStaleScheduledTaskRuns` 之后、`initializeSessionIndex`/`startScheduledTaskRunner` 之前接入 `initializeSessionStateCutover()` → `initializeSessionStateService()` → `drainSessionJsonMirror()`；pending/authoritative integrity 失败 fail closed 阻止启动，json_authoritative 失败安全保留 JSON 路径；`shutdownRuntime` finally 调用 `stopSessionStateService()` 清理 mirror timer 后关闭 SQLite。真实 server 集成测试（spawn index.mjs）在新临时数据目录完成首启 cutover→authoritative 并返回 schemaVersion 6。
- route：新增窄 `POST /api/storage/batch`（单请求一次提交 sessions+sessions-metadata set/delete，expectedStateVersion 可选），`SESSION_STATE_CONFLICT`/`SESSION_STATE_DUPLICATE_ID`/`SESSION_STATE_REQUIRED`/`SESSION_FULL_DELETE_REQUIRED` 稳定映射 409，维护锁 active 返回 423；单 PUT sessions 走 `writeSessionValueWithMetadata`（自动派生/merge metadata，不再制造 body orphan）；DELETE 走 `deleteSessionWithMetadata` 幂等；GET/API shape 不变。
- frontend：`src/lib/http-storage-backend.ts` transaction() 当 ops 仅涉及 sessions/sessions-metadata 且无本地 override 时收集为一次 batch 提交（`SessionsStore.save/delete` 单次 POST，测试证明不发两次独立提交），其他 store 保持逐操作透传。
- storage facade 全部写路径在 authoritative/pending 下委托 service（single/scoped/all body/metadata、atomic update、delete、bulk `applySessionBatch`、clear），禁止递归；metadata PUT 要求 body 存在（409 SESSION_STATE_REQUIRED）；DELETE 整会话幂等；bulk 单事务无半状态；DB commit 后 assets/cloud 清理 best-effort 失败不回滚。
- agent-manager：`persistSessionUnlocked` authoritative 分支单事务保存并恢复 `persistedStorageRevision`/`persistedStateVersion`/`persistedStateJson`；empty session 单次 delete；CAS metadata-only 并发（pin/archive）读取当前状态、仅 storage-owned 变化则有限 merge 重试（≤3），agent-owned 冲突记录 `persistConflictCount` 不伪成功；未知 storage 字段与 metadata-owned pin/archive 保留；SSE stateVersion 语义不变。`resetStaleTaskStatuses` 改为 atomicUpdate 单次读改写。
- auto-archive authoritative 分支改为单次 `atomicSessionRecordUpdate`（body+metadata 同事务归档，无半状态）；share-store `rollbackSharedSessionMessages` fallback 改为单次 atomicSessionRecordUpdate（body+metadata 一致 + preview/messageCount）。
- mirror：启动 drain + 写后 best-effort drain，失败 queue 保留、定时重试；JSON upsert body→metadata、delete metadata→body；mirror 失败不传播业务 commit 失败；重启 drain 与 pending recovery 测试通过。

## F8 Phase 2 Verification

- `node --check`：F8 二阶段全部改动与新增测试通过。
- 目标 ESLint：F8 二阶段改动 + 新测试 0 error / 0 warning。
- `npx tsc -b`：通过（src/lib/http-storage-backend.ts 变更）。
- Vitest：26 文件 / 156 项通过，覆盖 F8 核心 + 新增 lifecycle/facade/route batch/409/幂等删除/维护 gate/http-storage-backend 单提交/agent persist/restore/CAS merge/autoarchive/share 原子/mirror restart，以及 agent-manager/scheduled-tasks/session-index/backup 回归；`index.tunnel-host.integration.test.mjs` 真实启动链（schemaVersion 6 断言已同步）通过。
- 安全门禁：全量审计 server 模块，正式 session 写路径（routes/agent-manager/auto-archive/share-store/storage 内部）均经 facade 委托，authoritative 下无 JSON 权威写路径，自动 cutover 可安全启动。
- 按阶段要求未运行全量 build，未将 F8 标记 done。

## F8 Session State Transactional Storage — Phase 1

- schema v6 新增 `session_states`、delete tombstone、`session_storage_state`、JSON mirror outbox 与维护锁；v5→v6 故障回滚测试确认 F5 scheduled runs 与 F7 session index 数据保留，新库为 schemaVersion 6。
- repository 以复合 bucket key 写入，并在单个 SQLite immediate transaction 内原子提交 body、metadata、session_index、mirror outbox；canonical SHA-256 digest、opaque/unknown 字段 roundtrip、id/scope/project/stateVersion 强同步、跨 bucket duplicate 检测已覆盖。
- CAS 覆盖 insert/update/delete；冲突稳定返回 409 + `SESSION_STATE_CONFLICT`，跨 bucket 重复为 `SESSION_STATE_DUPLICATE_ID`；delete tombstone 阻止 stale writer 复活。多进程 CAS fixture 使用 `shell:false` 与 15 秒硬超时。
- repository 已提供批量 set/delete 单事务、replaceAll/exportSnapshot/verifyIntegrity/rebuildIndex；index/outbox/batch 冲突故障均验证全事务回滚。
- service phase 严格区分：`json_authoritative`/`cutover_running` 只走注入 JSON adapter，pending/authoritative 只走 SQLite；body 保存保留 metadata-owned pin/archive 与未知字段，metadata-only 要求 body 已存在并同步必要 body 投影，多 session batch 为单事务；diagnostics 包含 phase/authority/integrity/mirror pending。
- cutover 校验 body object/messages array、metadata object、bucket 路径与 scope/project，一票否决跨 bucket duplicate 和 metadata-only orphan；body-only 生成确定性 metadata 并记录 diagnostics。v1 临时 backup 重读 count+digest；双 snapshot + backup 后第三次稳定性门禁；SQLite replace 与 pending phase 在同一事务提交。
- pending mirror failure 保持 pending，后续启动可恢复 drain；pending/authoritative integrity failure fail-closed，不回 JSON；cutover_running 安全回到 JSON 后重跑。维护锁具备 PID+expiry takeover、fencing、renew heartbeat 与 stale lease release 防护。
- 未接 `server/index.mjs`，未做 backup route 或前端大改；`server/storage.mjs` 仅保留既有 internal physical bucket/mirror helper 与 facade 骨架，不扩大生命周期接线。

## F8 Phase 1 Verification

- `node --check`：F8 核心模块、新增 repository/service/cutover tests 与 fixtures 全部通过。
- 目标 ESLint：F8 核心、storage helper、schema 回归 tests/fixtures 全部 0 error / 0 warning。
- Vitest：7 文件 / 40 项通过，覆盖 F8 核心及 F6/F7 schemaVersion 6 回归；其中新增 F8 3 文件 / 15 项全部通过。
- Electron 39 runtime smoke：schemaVersion 6，repository/service revision 2，SQLite 3.51.2，通过。
- 按阶段要求未运行全量 build，未将 F8 标记 done。

## F7 Session Index Query Migration

- schema v5 只增加 5 个查询索引：scoped created/modified、projects timeline created/modified、aggregate modified；v4→v5 故障事务回滚不影响 F5 scheduled runs 数据。
- repository 采用 scope/archive/sort/direction allowlist，`listPage` 在 deferred 事务内执行 count + 真实 LIMIT/OFFSET；支持 all/global/project/projects、archive exclude/only/include、pinnedOnly、message_count NULL/非零语义和旧 NULL placement。
- repository 分析 aggregate duplicate sessionId 与完整排序键 tie；不增加 sessionId tie-break。EXPLAIN 测试确认 projects timeline 命中新 v5 索引。
- service diagnostics 明确 uninitialized/ready/degraded，未初始化 dirty=true；记录 source/index count+digest、lastVerifiedAt、compatibility、rebuild generation；TTL integrity verify 与 single-flight 后台 rebuild 生效。
- source snapshot 检测 key/id mismatch、scope/project 正文冲突、created/modified/pinned 非 canonical ISO/non-string、archivedAt 不可表达值；投影完整性异常、digest mismatch、repository error 均回 JSON。
- storage route 保留原 `readIndexedValues` fallback；只有 sessions-metadata、受支持 index、严格十进制 limit/offset、合法 direction/archive/pinned/scope 才尝试 SQL。duplicate/tie/readiness/compatibility/repository/shadow 任一失败 fallback。
- shadow sampler 可注入；生产默认低比例，每 query shape 首次与 rebuild generation 变化后首次强制；比较 total、顺序、完整 canonical metadata，mismatch 当前请求 JSON、标 dirty/degraded 并安排 rebuild，日志不含正文或 ID。
- 普通 created/modified 排序 pinned 永远优先且 pinnedAt desc；pinnedOnly 只对 canonical 日期 eligible；archive 保留旧 truthy 语义，不可投影值直接 fallback。
- ACP session/list、auto-archive、stale reset、backup 与 session 主体未切 SQL；lifecycle 测试明确边界。
- 新增 `scripts/session-index-query-benchmark.mjs`：默认 1k/10k，可传 50k；输出 JSON Lines、等价结果与 EXPLAIN，不进入 runtime/常规 CI。
- 文档新增 `docs/architecture/session-index-query-migration.zh-CN.md`，并更新 F6 foundation、storage 设计、server/routes/scripts Wiki。

## F7 Verification

- `node --check`：F7 server/scripts/tests 全部通过。
- 目标 ESLint：通过；`npx tsc -b`：通过。
- F7/schema v5 针对性：8 文件 / 58 项通过；新增 readiness/route/lifecycle 回归也通过。
- benchmark smoke：1k 等价为 true；warm SQL 命中 `session_index_aggregate_modified_query_idx`。
- Electron 39.8.10 / Node 22.22.1 / SQLite 3.51.2：schema v5 session query smoke 与 F5 scheduled runs smoke 均通过。
- `npm run test`：168 文件 / 1376 项全部通过（100%）。
- `npm run lint`：0 error；仅 `server/cloud/identity.mjs` 既有 1 条并行 warning。
- `npm run build`：通过；仅既有 KaTeX 字体与大 chunk warning。

## Notes

- 无关问题（2026-08-18 全量 lint）：`server/cloud/identity.mjs:92` 存在既有 warning（no-useless-assignment，'record' 赋值后未使用），与 context-usage-reserved-output-clamp 无关，留待后续单独处理。
- 未新增依赖，未 commit/tag/push。
- 未手工修改 `dist/`、`package-dist/`、`package-offline/`；build 生成 `dist/` 由脚本完成。
- 工作区仍有大量并行修改；后续提交必须显式限定本 feature 相关文件（F9 Phase 2：`server/sqlite/migrations.mjs`、`server/sqlite/session-state-repository.mjs`、`server/session-state-service.mjs`、`server/session-state-cutover.mjs`、`server/session-state-backup.mjs`、`server/maintenance/export-session-state-v1.mjs`、`tests/server/session-state-messages.test.mjs`、`tests/fixtures/session-state-messages-cas-worker.mjs`、schema v6→v7 断言更新的测试/夹具、`docs/architecture/session-state-transactional-storage.zh-CN.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`），禁止整体暂存、回滚或清理未知文件。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行，避免 storage.mjs 默认 `~/.quickforge` 被测试污染。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；任何要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`（本基准用全动态导入实现）。基准开发早期版本曾因该求值顺序问题将 `bench-100.json` 误写入真实 `~/.quickforge/storage/conversations/global/sessions/`（metadata 与 project 桶无残留），已精确删除并复核零残留；后续运行均经 Vitest guard 目录验证零写入。
- F9 Phase 2 教训：repository 层 `readMessagesPage` 早期版本漏写 OFFSET 子句导致 offset 分页返回错误页，已修复并被稳定排序测试覆盖；`savePair` 对显式传入的 metadata.preview 不得覆盖（改为仅当 undefined 时派生），避免 facade 原子更新测试回归。
