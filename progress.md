# Progress

## Completed Feature：cloud-settings-url-row-redesign

- Feature: 云服务设置页移除「启用云服务」开关行与登录安全说明 + Cloud API 地址行样式重设计·方案 A（cloud-settings-url-row-redesign，**已完成**）
- Status: done — ①「登录或注册」安全说明文字已删；②「启用云服务」开关行及描述已删（连带 setCloudServiceEnabled 与 4 个 i18n key；.quickforge-settings-switch 样式保留给其他设置页）；③设计稿 `design-mockups/cloud-url-row-redesign.html`（现状对比 + A/B/C、深浅主题、交互演示）经用户选型 **A** 后实现：URL 行改为 `quickforge-settings-row-form` 紧凑表单组——标签上置、「来源」caption 移至标签行右端、输入框通栏与「测试连接」「保存修改」同排、错误提示与「重建身份并切换」保持在下方；index.css 新增三条规则（纵向堆叠 / min-height 0 / 悬停不高亮），tests 新增源码契约 describe 锁定布局。**边界**：服务端默认 enabled=false，开关原是唯一 UI 启用入口——已装实例 saved enabled=true 不受影响（PUT config 合并语义），新装实例默认关闭暂无 UI 开关；用户未要求改默认值，server/cloud/service-config.mjs 未动。
- Verification: 定向 vitest 3 files / 23 tests 全通过；eslint 改动文件 0 error；tsc -b 通过；npm run build 成功（仅既有 chunk size warning）。未跑全量 test/lint。
- Boundaries: 未新增依赖；docs/wiki/src/components/README.md 已同步；未 commit/tag/push；设计稿保留。
- Next step: 无 blocker。遗留决策（用户未答）：新装实例云服务默认关闭是否改为默认开启（改 candidateFrom 默认值，一行）。

## Completed Feature：update-check-npm-registry-config

- Feature: 检查更新遵循 npm registry 配置（update-check-npm-registry-config，**已完成**）
- Status: done — 会话首段调研确认「检查更新」为直接 fetch npm registry packument 取 dist-tags.latest，registry 仅读 `npm_config_registry` 环境变量、默认官方源，用户 `.npmrc` 镜像配置不生效（国内网络 5 秒超时易失败）；与用户确认不改用 `npm view` 命令方案（更慢、依赖本机 npm、超时控制更复杂，且 npm 命令底层请求同一接口），按「读取当前 npm 配置的源」落地：`server/utils/package-update.mjs` 新增 `resolveRegistry(packageName, options)`——环境变量 `npm_config_registry` / `NPM_CONFIG_REGISTRY` > 用户级 `.npmrc`（`NPM_CONFIG_USERCONFIG` / `npm_config_userconfig` 或 `~/.npmrc`，`@scope:registry` 覆盖通用 `registry`，容忍注释/空行/引号值，去尾部斜杠；只读 registry 键、不触碰凭据）> 默认 `https://registry.npmjs.org/`；缺文件/空值/非法内容静默回退。`getRegistryPackageUrl` 改 async 接入，`fetchLatestVersion`/`checkForUpdates`（`/api/system/update/check`）与 5 分钟冷却缓存行为不变。`bin/quickforge.mjs` 删除本地复制的 registry/fetch 副本，先初始化网络代理再委托 server 模块 `fetchLatestVersion`。
- Verification: 定向 `npx vitest run tests/server/utils/package-update.test.mjs` → 1 file / 11 tests 全通过（resolveRegistry 7 用例 + fetchLatestVersion 按 npm 配置构造 URL）；`npx eslint` 3 个改动文件 0 error；`node --check` 两模块通过；真实冒烟 `node bin/quickforge.mjs check-update` 走共享模块与本机 npm 配置成功返回 1.9.0。未跑全量。
- Boundaries: 不改冷却缓存、超时、packument 端点与更新执行链（update-supervisor）；Desktop 渠道（GitHub Releases）不受影响；未新增依赖，未 commit/tag/push；docs/wiki server/utils（补收 package-update.mjs 条目）与 bin 已同步。
- Next step: 无 blocker；调研中识别的可选后续：packument → 轻量 `/-/package/<name>/dist-tags` 端点（该包版本多、元数据大）；bin 与 server 模块仍各有一份相同的 compareVersions 复制（本轮未动）。

## Completed Feature：cloud-settings-remove-remote-identity-sections

- Feature: 云服务设置页下线「远程访问」与「云身份」状态区块（cloud-settings-remove-remote-identity-sections，**已完成**）
- Status: done — 用户确认远程访问状态展示与云身份状态行均不需要，要求下线。`CloudAccountSettingsPage.tsx`：整块移除远程访问 section（远程访问标题/描述、「Agent 不可用」等状态徽标、授权中提示、错误警告）及全部关联逻辑（remoteStatus state、refreshRemoteStatus、1.75s 轮询、visibilitychange 刷新、retryRemoteAuthorization、remoteStatusLabel），不再请求 `/api/cloud/remote-status`；「云身份」section 移除头部状态行（云身份标题、identityDescription 描述、modeLabel 徽标）与 cloud-unavailable、session-mismatch 警告行，改为仅在连接后渲染邮箱/套餐、剩余额度、重置时间、退出登录功能行——未连接用户的页面只剩「云服务连接」配置区。`cloud-account-settings-state.ts`：移除 shouldPollCloudRemoteStatus、getCloudRemoteAuthorizationUi、CloudRemoteAuthorizationUi 及失去消费者的 getCloudAccountViewState/CloudAccountViewState。`i18n.ts`：中英文成对删除 31 个 key；`cloudSessionServiceMismatch` 有意保留（cloud-error-message.ts 错误码映射）。cloud-client.ts 的 remote-status API 绑定与服务端端点保留（cloud-client.test.ts 仍覆盖）。说明：用户消息中仍看到「绑定服务 http://127.0.0.1:5176/」，该行已于上一 feature（cloud-settings-remove-devices-simplify）删除，属旧构建/未刷新界面。
- Verification: 定向 `npx vitest run tests/frontend/cloud-account-settings-page.test.ts tests/frontend/cloud-i18n.test.ts tests/frontend/cloud-client.test.ts` → 3 files / 21 tests 全通过；`npx eslint` 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；grep 确认删除标识符/key 无残留。未跑全量。
- Boundaries: 页面行为/UI 精简，不改服务端与 API 契约；docs/wiki src/README.md 与 components/README.md 已同步；未新增依赖，未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：todo-summary-capsule-redesign

- Feature: Todo 任务摘要胶囊化——未展开时收缩为进度胶囊、展开/收起带动画过渡（todo-summary-capsule-redesign，**已完成**）
- Status: done — 先按用户要求产出 `design-mockups/todo-capsule-summary.html` 设计稿（用户确认并要求胶囊水平居中），随后落地实现：`todo-write-summary.ts` toggle 外加居中 toggle-row（flex-grow 0→1 插值驱动宽度动画），toggle 子元素一次性创建并跨快照持久（ring 环+对勾、heading、完整 stats、aria-hidden 紧凑 stats-compact、updated、spacer、chevron），进度弧经内联 `--quickforge-todo-ring-offset` 变量驱动 450ms 动画，root 新增 data-complete/data-running（对勾交叉淡化 / 收起态呼吸）；`index.css` 整段替换 todo 摘要样式：胶囊（999px、muted/55%、1.5rem、居中）⇄ 展开整行（8px、透明背景），标题/双统计 max-width+opacity 交叉淡化，列表 grid-rows 0fr→1fr + 阶梯淡入，body hidden 仍即时赋值、display:none 由 `transition-behavior: allow-discrete` 延迟 + `@starting-style` 进入动画（无 JS 两帧协调），环双 SVG 用 grid 同格叠放保持正常流契约，reduced-motion/移动端分支同步。用户追加：完成态对勾改绿色——复用 slash agent chip 既有 emerald 语义色（浅 rgb(4 143 101)/深 rgb(110 231 183)），整体单色、绿色仅完成刻出现，设计稿同步。wiki 两处同步（行为段 + 模块 360 行）。
- Verification: 定向 vitest 3 files / 58 tests 全通过（含新增 5 个胶囊结构契约用例）；eslint 0 error；tsc -b 通过；npm run build 成功且 dist CSS 保留 @starting-style/allow-discrete/ring-offset 变量。未跑全量 test/lint。
- Boundaries: 复用既有语义 token 与轻盈模式，无新视觉范式，DESIGN_LANGUAGE 未改；不改服务端协议、无新增依赖；未 commit/tag/push；设计稿保留作决策记录。
- Next step: 无 blocker；可选真机目视深浅主题下胶囊⇄展开动画、收起态呼吸与全完成对勾自动收起。

## Completed Feature：cloud-settings-remove-devices-simplify

- Feature: 云服务设置页精简——移除「绑定服务」URL/Agent PID 行与设备管理区块（cloud-settings-remove-devices-simplify，**已完成**）
- Status: done — 用户要求移除远程访问区的「绑定服务 http://127.0.0.1:5176/」展示、不再需要设备管理并精简界面。`CloudAccountSettingsPage.tsx`：删除 cloudRemoteServerUrl（绑定服务 URL）与 cloudRemotePid（Agent PID）两行，远程访问区收敛为「标题+描述+状态徽标（Agent 不可用等）+授权中提示+错误警告」；整块移除「已连接设备」区块（列表/当前设备徽标/撤销按钮/重名提示）及 revoke 回调、installationId/installationName 辅助、重名统计。`cloud-account-settings-state.ts`：CloudDetailsState/loaders/loadCloudAccountDetails 移除 installations（详情只加载 usage+models），getCloudAccountViewState 的 cloud-unavailable 判定 3→2 加载器全失败。`i18n.ts` 中英文成对删除 13 个仅设备 UI 使用的 key。保留边界：cloud-client.ts 的 installations API 绑定与服务端端点未动（移动端 CloudRemotePage 走独立 remote-client 链路选择连接设备，功能必需，不受影响）；远程 Agent 启停/轮询/自动授权逻辑不变。
- Verification: 定向 `npx vitest run tests/frontend/cloud-account-settings-page.test.ts tests/frontend/cloud-i18n.test.ts tests/frontend/cloud-client.test.ts` → 3 files / 27 tests 全通过；`npx eslint` 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；grep 确认删除 key 无残留。未跑全量。
- Boundaries: 纯 UI 精简，不改架构/模块职责/公共入口，docs/wiki 无需更新；未新增依赖，未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：sidebar-show-more-muted-color

- Feature: 侧边栏「显示更多」弱化至与分区标题一致的灰色（sidebar-show-more-muted-color，**已完成**）
- Status: done — 用户反馈项目会话列表的「显示更多」颜色太深、与会话标题区分不开，应对齐「项目」分区标题的灰色。定位：`SessionDisplayControls`（ChatSidebar.tsx，三处共用——项目视图会话、时间线视图、全局对话）按钮为 `text-muted-foreground/60`，仅比会话标题 `text-muted-foreground/70` 浅 10% 肉眼难辨，而分区标题为 `text-muted-foreground/50`。修复：resting 色 `/60`→`/50` 与分区标题一致（与会话标题拉开 20% 差），hover `/80` 保留（悬停时有背景色，不影响区分度）；tests/frontend/sidebar-section-order.test.ts:198 硬编码断言同步 `/60`→`/50`。
- Verification: 定向 `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 18 tests 全通过；`npx eslint` 两个改动文件 0 error；grep 确认无其他测试引用旧颜色字符串。
- Boundaries: 仅调整透明度档位，`/50` 为该文件既有写法（分区标题、菜单标签），未引入新视觉模式，DESIGN_LANGUAGE.md 无具体档位约定、无需更新；未 commit/tag/push。
- Next step: 无 blocker。

## Completed Feature：release-v1.9.0

- Feature: minor 发布 v1.9.0（release-v1.9.0，**已完成**）
- Status: done — v1.8.1 tag（35e0863）之后 dev 累计 11 个提交（文档预览+移动端 H5、Monaco 本地打包、SSE/Cloud/git 状态修复、SQLite persist 优化与 synchronous=NORMAL、vendor node-pty、包体裁剪、todo 图标），含新功能与分发行为变化，经用户确认按 **minor** 发布 v1.9.0；npm 1.8.1 从未发布，用户决策跳过、由 1.9.0 直接取代。
- Release changes: `npm version minor` 1.8.1→1.9.0（package.json + package-lock.json）；CHANGELOG.md 顶部新增 `[1.9.0] - 2026-08-26` 章节（Added/Changed/Fixed/Released，基于 v1.8.1..HEAD 11 个提交整理）；README.md 版本徽章更新为 1.9.0（安装命令使用 @latest，无其他版本引用）。
- Verification: 完整 `npm run test` → **259 files / 2340 tests 全部通过**（发布硬门禁 100%）；`npm run lint` → 0 errors / 1 既有 warning（server/cloud/identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`prepare-runtime-package` + `prepare-offline-package` + `npm pack` → `package-offline/shawnstack-quickforge-1.9.0.tgz`（7.4MB / unpacked 24.2MB / 453 files，含 vendor/node-pty 四平台）；打包元数据校验 version 1.9.0、8 个运行时 dependencies + @vscode/ripgrep optionalDependencies。
- Release sequence: 本轮变更构成 release commit（7 个预期发布文件），随后 master 快进到发布提交、创建 `v1.9.0` tag、原子推送 `master`/`dev`/tag；GitHub Desktop Release 与 `npm publish` 由用户执行。

## Completed Feature：git-status-connection-pool-guard

- Feature: git/status 慢请求钉死浏览器连接池的防护（git-status-connection-pool-guard，**已完成**）
- Status: done — 用户反馈 `GET /api/git/status` 请求「导致后续请求全部被阻止」。日志定位（`~/.quickforge/logs/server-2026-08-26.log`）：12:28:46 页面刷新后同时对 default 与 97e168b3 两项目发起 4 个无 signal、无超时的 git/status（App.tsx 标题栏 `refreshTitleGitStatus` 与 ChatPanelHost 分支探测各一），这两个仓库各需 141-146s（`listGitStatus` 的 `git status --porcelain=v1 -z --untracked-files=all` + numstat + 未跟踪文件行数统计在大仓库上极慢；73cb87e5 项目仅 ~500ms）；4 条慢连接 + 2 条常驻 SSE（channels/agents events）恰好占满 HTTP/1.1 同源 6 连接池，期间服务端其他请求全部 1ms 正常完成（非服务端阻塞），12:31:08 慢请求结束后积压的 default-options 请求立即成串放出，证实浏览器侧连接耗尽。修复（服务端不动）：`workspace-api.ts` `getGitStatus` 统一组合 20s 超时（TimeoutError DOMException 中止、成功结算后清理计时器、桥接外部 signal 的 abort）；`App.tsx` 新增 `titleGitAbortRef` 中止上一请求、abort/超时静默不写警告、项目 scope 切换 effect 立即中止在途请求；`ChatPanelHost.tsx` 分支探测挂 AbortController，卸载或 `gitProjectId`/`revision` 变化即中止。WorkspaceInspector 既有 force-abort 逻辑不变，超时落入既有 error+重试按钮路径。用户最初贴的 e14ed8a7 请求 503 为另一现象：命中 dev server 重启后 ~1s 启动维护窗口（`resolveMaintenanceGate` fail-closed），与连接池问题无关、无需修复。
- Verification: 定向 `npx vitest run tests/frontend/git-status-request-lifecycle.test.ts` → 1 file / 8 tests 全通过（20s 超时边界 19999/20000、外部 abort 即时传播、预先 aborted signal、成功后计时器清零，及三个调用方源码契约）；相关回归 5 files / 29 tests 全通过；`npx eslint` 4 个改动文件 0 error；`npx tsc -b --pretty false` 通过。未跑全量 test/lint/build。
- Boundaries: 未改服务端 git 路由与 `listGitStatus` 实现；未新增依赖；未 commit/tag/push；`docs/wiki/src/components/README.md` 已同步（ChatPanelHost 行数 1552→1581 + git status 请求生命周期一条）。
- Next step: 无 blocker。Notes（后续独立事项）：①`listGitStatus` 在 default/97e168b3 仓库耗时 100-146s，候选方向为 `--untracked-files` 粒度/仓库级配置、轻量 status 端点（标题栏与分支徽标只需 branch/counts 却调用全量端点）、并发去重或 fsmonitor/untrackedCache；②release-v1.8.1 发布门禁需含本改动全量重跑 test/lint/build。

## Completed Feature：switch-sqlite-synchronous-normal

- Feature: SQLite synchronous FULL→NORMAL（switch-sqlite-synchronous-normal，**已完成**）
- Status: done — 用户知情决策（已向用户完整解释权衡后拍板"改一下"）：接受 OS 崩溃/断电回滚「最后一次 checkpoint 以来已提交事务」的有界窗口，消除大 persist COMMIT 段的逐事务 fsync（含杀毒扫描/机械盘/网络盘下的延迟尖刺）。`server/sqlite/database.mjs`：`SQLITE_SYNCHRONOUS` 2→1（注释含决策历史链）、`configurePragmas` 以常量注入 `PRAGMA synchronous`、`publicHealth` 摘要从硬编码 `'full'` 改为 `SQLITE_SYNCHRONOUS_NAMES` 按常量派生、safety argument 注释改写为 NORMAL 语义（WAL 帧校验和保证任意崩溃模式下事务原子性/文件不撕裂；NORMAL 仅放弃逐 COMMIT fsync，进程崩溃安全；quick_check 7 天节奏不变，仍管 bit-rot）。文档按 §3.1 预设的回退条款格式显式记录：`sqlite-storage-foundation.zh-CN.md` §3.1 追加 2026-08-26 修订段（明确会话域存储 v2 无 mirror JSON 兜底、窗口内丢失即真实丢失）、`session-storage-current-architecture.zh-CN.md` 已定案条目更新为现况、wiki pragma 校验行同步。测试：foundation 断言 `.toBe(2)`→`.toBe(1)`、health `'full'`→`'normal'`。
- Verification: 定向 vitest 8 文件（sqlite-storage-foundation/lifecycle、quick-check-gate、compatibility-spike、session-state-repository/service/phase3、agent-manager.persist-session-state）→ 8 files / 66 tests 全通过；eslint 改动文件 0 error。
- Boundaries: 只动 pragma 值与派生逻辑，未改事务协议/连接管理；唯一 DB 打开点 database.mjs:301 每次都经 configurePragmas，全连接生效；未新增依赖；未 commit/tag/push。
- Next step: 无 blocker。与 optimize-persist-encoding-yield 叠加后，大 persist 的事件循环占用 = 分批编码微停顿 + 单段同步写（无逐事务 fsync）；观察 200ms 慢日志确认分布。release-v1.8.1 发布门禁需含本改动全量重跑。

## Completed Feature：optimize-persist-encoding-yield

- Feature: 大会话持久化优化——单遍 canonical 序列化 + 编码分批让出事件循环 + 慢日志阈值 200ms（optimize-persist-encoding-yield，**已完成**）
- Status: done — 背景：Node 单线程事件循环上，大会话 persist 的「每条消息 3 遍 JSON 序列化 + 同步 SQLite 事务」会独占线程，卡住所有在途请求（代码注释自认，SLOW_PERSIST_LOG_MS 慢日志可观测）。按用户拍板实施评估项 ①+③ 与阈值调整，synchronous=NORMAL 与 worker 线程不动。① 新增 `server/sqlite/canonical-json.mjs`：单遍 canonical 序列化器，与旧 `JSON.stringify(canonicalize(JSON.parse(JSON.stringify(x))))` 流水线**字节级等价**（toJSON 一次语义、undefined/function/symbol 对象值丢弃/数组位补 null、bigint 抛 TypeError、数字/字符串委托 JSON.stringify 格式化、键 UTF-16 码元排序），`tests/server/canonical-json.test.mjs` 差分测试 54 用例钉死等价（含 Date/toJSON 变体/null-proto/稀疏数组/lone surrogate/200 层嵌套/500 条消息）；repository 的 encodeMessage/messageDigest 切换至新序列化器，消息编码 CPU ≈ 原 1/3，digest 与既有库行完全兼容（jsonAndDigest 保留 round-trip——其调用方消费规范化 value 副本且仅处理小 body）。③ repository 新增 `encodeMessagesChunked`（默认 50 条/批，批间 setImmediate 让出事件循环）+ `normalizeRecord` 接受对齐的内部 `messagesEncoded` 预编码旁路；service 层 `savePair` 拆出 `savePairWithPlan` + 新增 `savePairChunked`：仅当 `saveSessionStatePair` 带 expectedRevision（CAS）时走「先 plan → 分批编码（yield）→ 同步事务」，yield 间隙并发提交由前置 revision CAS 转为 conflict 重试（saveInTransaction 先查 revision 再写行，无撕裂写窗口）；无 CAS 调用方保持全同步路径，`saveSessionBody`/`atomicSessionRecordUpdate` 等同步 facade 零波及。**评估并否决**「跨 yield 持事务分批 INSERT」：事务跨 await 期间其他同步写者会经 savepoint 加入该事务，中途失败 ROLLBACK 连带回滚其已确认写入（换独立连接则 busy_timeout 同步阻塞重造全局停顿），故事务内 INSERT+COMMIT 保持单段同步——残余的同步写突刺（INSERT+fsync）由慢日志量化后决定是否升级 worker 线程方案。观测：`SLOW_PERSIST_LOG_MS` 1000→200（注释同步更新），`persistAuthoritativeSessionState` 对异步化后的 saveSessionStatePair 补 await（phase3 测试同步调用点同步补 await）。
- Verification: 定向 vitest 13 文件（canonical-json、session-state-repository/service/messages/backup/import/lifecycle/phase3/offline-export、storage facade、auto-archive、session-index-sqlite-source、agent-manager.persist-session-state）→ 13 files / 166 tests 全通过；新增用例：差分 54、encodeMessagesChunked 的 FIFO immediates 有序性证明（events ['external','done']）、预编码旁路与同步路径落库逐行字节一致、messagesEncoded 错位抛 TypeError；eslint 7 个改动文件 0 error。早期一轮并行全量出现 1 例时序抖动，随后两轮全量均绿。未跑完整 test/lint/build（服务端聚焦改动；release-v1.8.1 发布门禁时全量重跑）。
- Boundaries: SQLite 事务语义/事务包装器/WAL+synchronous=FULL 未动；digest 算法不变（差分测试保证跨版本兼容）；未新增依赖；docs/wiki/server/README.md 已同步 repository/service 两条描述；未 commit/tag/push。
- Next step: 无 blocker。建议跑一段时间 200ms 慢日志观察真实分布：若同步写突刺（INSERT+COMMIT 段）仍显著，后续候选为 worker 线程承载 SQLite（根治）或 replace 模式按 digest 差异只重写变更行（缩事务）；synchronous=NORMAL 属产品权衡待用户单独拍板。

## Completed Feature：vendor-node-pty-runtime

- Feature: 终端 node-pty 运行时 vendor 化——npm 包自带四平台预编译（vendor-node-pty-runtime，**已完成**）
- Status: done — 背景：node-pty 1.1.0 npm 包全平台一锅端（tarball 15MB / 解压 61MB，约 48MB .pdb 死重），作为 optionalDependencies 使消费端安装沉重且离线包终端不可用；经调研（功能层面无可替代、@lydell/node-pty 为 beta、上游 npm 包已内置四平台 prebuilds 且运行时经 lib/utils.js `loadNativeModule` 按 build/Release→prebuilds/<platform>-<arch> 相对路径自解析、N-API ABI 跨 Node 稳定、MIT 允许再分发）实施本地挑运行集方案：新增 `vendor/node-pty/`（5.3MB：lib/*.js 13 文件 + win32-x64/arm64、darwin-x64/arm64 prebuilds 全部去 pdb + LICENSE + licenses/ 第三方文本），目录内 `{"type":"commonjs"}` package.json 标记解决仓库根 ESM 与 CJS lib 冲突（否则 require 报 exports is not defined），`VENDOR.json` 记录来源 node-pty@1.1.0 与平台清单，winpty/conpty MIT 许可文本从 rprichard/winpty 与 microsoft/terminal 官方仓库补齐（上游 npm 包未携带）。`scripts/vendor-node-pty.mjs` 一键重新同步（升级 node-pty devDependency 后 `npm install && node scripts/vendor-node-pty.mjs`，保留 licenses/ 与 README）。`server/terminal/terminal-manager.mjs` loadPty() 改 vendor 优先 → `require('node-pty')` 回退 → 双失败 503（PTY_UNAVAILABLE_MESSAGE 更新为平台运行时缺失语义），导出 vendoredPtyEntryPath()，darwin 加载成功后 ensureVendoredSpawnHelperExecutable() 自愈 spawn-helper 执行位（macOS posix_spawn 直接执行该二进制、Windows 打包 tarball 丢失执行位，git index 对两个 darwin spawn-helper 标记 100755，Windows 重新生成后需重设）；node-pty 自 optionalDependencies 移至 devDependencies（仅作同步源），npm 消费端不再安装 15MB 依赖、win/mac 终端开箱即用且离线可用，Linux 无上游预编译、终端需自装 node-pty 否则优雅降级。package.json files、prepare-runtime/offline-package copyEntries、electron-builder files+asarUnpack 均纳入 vendor。
- Verification: node 冒烟：vendor 入口 require + cmd.exe spawn 收到 200 字节输出 + onExit 正常（kill 阶段 `AttachConsole failed` 为上游 1.1.0 已知噪音，官方 node_modules 副本同样存在，与 vendor 无关）；定向 vitest `tests/server/terminal-vendor-runtime.test.mjs` → 5 tests 全通过（布局/许可/排除 pdb 契约 + terminalCapabilities() enabled 且 require.cache 断言真实从 vendor 加载）；eslint 3 个改动文件 0 error；`npm install --package-lock-only` 同步 lock；`npm pack --dry-run` → 7.4MB / 452 files（vendor 前 4.8MB，+2.6MB）；完整 `npm run test` → 257 files / 2275 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（identity.mjs:92）；`npm run build` 成功（仅既有 KaTeX/chunk size warnings）。
- Boundaries: 已同步 docs/wiki/server/README.md（terminal/ 节新增「PTY 运行时加载」）、docs/wiki/root-config.md（发布包含 vendor/）、docs/architecture/patch-release-runbook.zh-CN.md（3.6 与注意事项改为 vendor 语义）；docs/bug/server-bugs.md 的 node-pty 提及为 API/生命周期议题、与分发无关未动；未手工修改 `dist/`、`package-dist/`、`package-offline/`；未创建 commit/tag/push。desktop 安装包会随 vendor 带入全部四平台二进制（各平台安装器多 ~2.6MB 压缩前），如需按目标平台裁剪 electron files 可作后续优化。
- Next step: 无 blocker；发布门禁（release-v1.8.1 或其后版本）需纳入本改动重新完整验证；可选真机验证 npm 消费端安装后终端开箱即用、macOS arm64 实测 vendor 加载、Electron 桌面包终端可用（asarUnpack 生效）。升级 node-pty 时记得跑同步脚本并核对 licenses/。

## Completed Feature：package-size-trim

- Feature: 包体裁剪——qf-agent 暂时下线 + 前端依赖归位 + Monaco 语言 worker 移除（package-size-trim，**已完成**）
- Status: done — 三项裁剪按用户决策落地：①qf-agent 不再随包分发：package.json files、prepare-runtime/offline 两个脚本 copyEntries 移除 runtime-assets，electron-builder 删除 agent extraResources 与平台 helper，electron-main 删除 desktopAgentPath/qfAgentPath，git rm 五平台二进制 52MB；server/cloud/qf-agent-process.mjs 不动，二进制缺失时状态 unavailable，QUICKFORGE_QF_AGENT_PATH 仍可外部指定，恢复分发只需还原二进制与四处打包引用。②mermaid/react-markdown/remark-gfm/@dnd-kit×3/@capacitor×3 移回 devDependencies（服务端运行时仅需 9 个真依赖），lock 仅 dev 标记变化；npm 消费端每次安装省约 93MB，并消除桌面 asar 吸入 mermaid 的隐患。③Monaco 只读查看器去掉 json/css/html/ts 语言 worker（叠加于 monaco-local-bundled-loading）：monaco-local.ts 改为 editor.api + editor.all + monaco-basic-languages.ts 聚合 Monarch + 仅 editor.worker，不引入 vs/language 贡献；TS/JS/CSS/SCSS/LESS/HTML 由 Monarch 着色，JSON 无 Monarch 以纯文本呈现（已知取舍）；新增 src/monaco-esm.d.ts 补深路径类型。
- Verification: 定向 vitest（monaco-local、qf-agent-process、public-api、electron-desktop-notifications-structure、workspace-inspector tabs/on-demand）全通过；eslint 改动文件 0 error；node --check 打包/desktop 文件通过；tsc -b 通过；npm run build 成功（dist 26MB→17MB，四个语言 worker chunk 消失，editor.worker 保留）；npm run lint 0 errors / 1 既有 warning；完整 npm run test → 256 files / 2269 tests 全通过；prepare-runtime-package 重建 + npm pack --dry-run → 4.8MB / 414 files（对照 v1.7.10 24.1MB），打包 dependencies 仅 9 个运行时依赖。
- Boundaries: vite.config.ts 保持并行会话最新状态未改动（monaco 无 manual chunk 为其刻意决策）；server/cloud/qf-agent-process.mjs 与 public-api.mjs qfAgentPath option 未动；已同步 docs/architecture/quickforge-cloud-client.zh-CN.md、docs/design/remote-access-p2p.md、docs/wiki/server/README.md、docs/wiki/src/components/README.md；未新增/升级依赖版本，未 commit/tag/push。
- Next step: 无 blocker；发布时注意 v1.8.1 之后的版本 tarball 将从 ~24MB 降至 ~5MB；Cloud 远程访问功能处于不可用（unavailable）状态直到恢复 agent 分发（或用户经 QUICKFORGE_QF_AGENT_PATH 自备二进制）；可选真机目视 Reader/Diff 中 TS/CSS 着色正常、JSON 纯文本呈现。

## Completed Feature：monaco-local-bundled-loading

- Feature: Monaco 编辑器本地打包加载（monaco-local-bundled-loading，**已完成**）
- Status: done — 起因：Edge Tracking Prevention 提示 jsdelivr 存储访问，且 package-offline 断网时 Monaco 编辑器加载不出（`@monaco-editor/react` 默认经 `@monaco-editor/loader` 从 `cdn.jsdelivr.net` 运行时拉取 monaco-editor@0.55.1）。现新增 `src/components/workspace/monaco-local.ts`：`ensureLocalMonaco()` 模块级单例，函数内 `Promise.all` 动态 import `monaco-editor` 与 editor/json/css/html/ts 五个 `?worker`，设置 `self.MonacoEnvironment.getWorker` 按 label 分发，再经 `loader.config({ monaco })` 注册本地实例；顶层只 import `loader`（Environment 为 type-only），monaco 本体不进首屏静态图。`MonacoCodeViewer.tsx` / `MonacoDiffViewer.tsx` 增加 `monacoReady` gate（useEffect + cancelled 清理，保证 config 先于 `loader.init()`；未 ready 返回 null，其余 props/options 不变）。`vite.config.ts` 删除 monaco manualChunks 分支：实测保留 manual chunk 时 rolldown 会把共享 vite/preload-helper 收编进 monaco chunk、经 modulepreload 把 4MB 拖回首屏；删除后 monaco 家族为纯异步 chunk（editor.api2 3.63MB/gzip 926KB + 5 个独立 worker），index.html preload 11 项与入口静态闭包均不含 monaco，首屏不变。`@monaco-editor/loader` 默认 config 的 jsdelivr 字符串为死代码（dist 残留 1 处、无运行时网络请求）。
- Verification: 定向 vitest 4 files / 29 tests（monaco-local 5 + markdown-reader 2 + workspace-inspector-tabs 19 + mobile-fullscreen-adaptation 3）全通过；eslint 5 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；dist 只读检查确认 preload/静态闭包无 monaco、worker 正常生成、jsdelivr 仅 1 处死字符串。未跑全量 test/lint。
- Boundaries: 未新增依赖（monaco-editor@0.55.1 本就是 devDependency 且已安装）；未手工修改 `dist/`、`package-dist/`、`package-offline/`（build 仅重建被忽略的 dist/）；未 commit/tag/push；cloud-models-timeout-nonblocking 并行改动未触碰。已同步 `docs/wiki/src/components/README.md`。
- Next step: 无 blocker；可选真机（含断网 offline 包/Electron）验证代码/Diff 查看器加载与语法高亮；`release-v1.8.1` 发布门禁需纳入本改动重新完整验证。

## Completed Feature：cloud-models-timeout-nonblocking

- Feature: Cloud 模型超时正确映射与非阻塞加载（cloud-models-timeout-nonblocking，**已完成**）
- 根因: 用户反馈 `GET /api/cloud/models` 500。日志证实为 dev server 重启后冷缓存回源 `https://qf.shawnstack.com/v1/models`，上游偶发慢响应超过默认 10s 超时（`TimeoutError` 非 `CloudApiError`）被全局 `sendError` 兜底成 500；且 `/api/models/catalog` 在 `server/model-catalog.mjs` 串行 await Cloud 目录导致主目录接口同步挂 ~10s（日志中与失败同一毫秒返回）。
- Status: done — 服务端：`server/cloud/client.mjs` 将 fetch `TimeoutError` → `CloudApiError(504, cloud_timeout, retryable)`、网络 `TypeError` → `502 cloud_unreachable`，外部 AbortError 原样抛出；`server/model-catalog.mjs` 新增 2s 短截止（`CLOUD_MODELS_CATALOG_WAIT_MS`，可注入 `cloudWaitMs`），超时先降级仅本地/自定义模型，底层请求继续暖 60s identity 缓存，raced promise 挂 catch 防 unhandled rejection。前端：`useCloudModels` 失败后 30s 负缓存（非 refresh 直接返回 `[]`）；`resolveNewSessionModel` 与 `useAppBootstrap` 持久化 Cloud 模型恢复最多等 5s（`CLOUD_MODEL_RESOLUTION_TIMEOUT_MS`），超时走既有本地 configured 回退；`default-options-settings-tab` 首屏不再 await Cloud 目录，Cloud 到达后带 `loadSettingsGeneration` 代数守卫增量合并并按 defaults 重新解析自动选中（手动改选不覆盖），类加 `export` 供测试实例化。
- Verification: 定向 `npx vitest run` 10 files / 98 tests 全通过（client 504/502/AbortError 分类、catalog 短截止与后台失败、负缓存与 refresh 绕过、5s 回退、设置页增量合并，含 routes/cloud、cloud identity/models、cloud-client 回归）；`npx eslint` 12 个改动文件 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 已同步 `docs/architecture/quickforge-cloud-client.zh-CN.md`、`docs/wiki/server/routes/README.md`、`docs/wiki/src/hooks/README.md`、`docs/wiki/src/lib/README.md`；未新增依赖，未手工修改生成产物，未 commit/tag/push；工作区 Monaco 相关并行改动（`MonacoCodeViewer/MonacoDiffViewer/monaco-local.*`、`docs/wiki/src/components/README.md`）未触碰。慢而正常的上游（>2s）下 catalog 该次响应不含 Cloud 模型，下一次请求命中缓存即恢复，属可接受降级。
- Next step: 无 blocker；可选真机验证：断网/慢代理下模型选择器、新建会话与 Defaults 设置页不再长时间阻塞，网络恢复后 Cloud 模型自动回来。

## Completed Feature：mobile-h5-fullscreen-sidebar-and-inspector

- Feature: 移动端 H5 侧栏整屏与 Inspector 全屏覆盖（mobile-h5-fullscreen-sidebar-and-inspector，**已完成**）
- Status: done — 左侧会话侧栏移动抽屉 100% 整屏：`ChatSidebar.tsx` 移动分支改为 `isMobile ? 'flex h-full w-full flex-col'`，`App.tsx` 抽屉包装 div 移除 `max-w-[85vw]`，桌面宽度/resize/inline style 不动。右上工具栏 PanelRight 开关由 `hidden ... lg:inline-flex` 改为全断点 `inline-flex`（disabled/onClick/aria-label 不变），移动端可打开 Inspector。`WorkspaceInspector.tsx` 新增 `narrowViewport`（`matchMedia('(min-width: 1024px)')`，对应 Tailwind lg 断点，防御式写法兼容 vitest node 无 matchMedia）与 `mobileOverlay = narrowViewport && mounted`：根 aside 在 mobileOverlay 时复用既有 `quickforge-workspace-inspector-fullscreen` 以 z-20 全屏覆盖（原首行 `hidden` 移入条件分支；不设 width style、隐藏 resize separator），header 继续走 `pr-[5.5rem]` 为右上工具栏预留、PanelRight 可点关闭；桌面 fullscreen z-40、Maximize2、Escape 逻辑不变。
- Verification: `npx vitest run` 定向 7 files / 66 tests 全通过（含新建 `tests/frontend/mobile-fullscreen-adaptation.test.ts` 3 个源码契约用例与更新的 side-chat-workspace-tab 首用例）；`npx eslint`（App/ChatSidebar/WorkspaceInspector/两个测试文件）→ 0 error；`npx tsc -b --pretty false` → 通过；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；feature JSON 解析通过。未跑全量 test/lint。
- Boundaries: 不动 `GitToolsPinnedSummary` 的 `hidden md:flex` 与小屏隐藏“更改”入口（Inspector 已提供移动覆盖布局，GitTools 更改入口维持现状）；不动 Inspector 内部桌面 fullscreen/Maximize2/Escape 逻辑；未新增依赖，未手工修改生成产物（`dist/` 为 build 命令自动生成），未 commit/tag/push；`docs/wiki/src/components/README.md` 已同步 ChatSidebar/WorkspaceInspector/GitToolsPinnedSummary 三处。
- Next step: 无 blocker；可选真机（H5/Android WebView）目视验证整屏侧栏、PanelRight 开关与 Inspector 全屏覆盖的关闭交互。

## Completed Feature：todo-pending-status-icon-hollow-circle

- Feature: Todo 未开始状态图标改为空心圆（todo-pending-status-icon-hollow-circle，**已完成**）
- Status: done — 先在 `design-mockups/todo-pending-icon-options.html` 提供 5 个候选（A 空心圆 / B 点状虚线圆 / C 缺口环 / D 圈+短横线 / E 纯实心点），均按真实面板样式与 14px 实际尺寸渲染并支持深浅主题切换，用户选定方案 A。实现仅替换 `src/components/chat/panel-decoration/todo-write-summary.ts` 中 `statusIcon()` pending 分支的 SVG 字符串：删除中心实心小圆点只留外圈。三态统一为「外圈+内部符号」语言：无符号 = 未开始、时钟指针 = 进行中、对勾 = 已完成。颜色、尺寸、`fill:none; stroke:currentColor; stroke-width:2` 约束不变，未改 CSS。
- Verification: `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts` → 2 files / 30 tests 全通过；`npx eslint src/components/chat/panel-decoration/todo-write-summary.ts` → 0 error；`npm run build` → 成功（仅既有 KaTeX 字体与 chunk size warnings）。未跑全量 test/lint。
- Boundaries: 纯局部图标替换不改变架构、模块职责或公共入口，docs/wiki 无需更新；复用既有描边图标体系，无新视觉模式，DESIGN_LANGUAGE 无需修改。未新增依赖，未手工修改生成产物，未 commit/tag/push；设计稿保留作决策记录。
- Next step: 无 blocker；可选真机目视深浅主题下任务摘要三态图标。

## Completed Feature：workspace-document-preview

- Feature: Workspace 文档预览 — PDF/DOCX/XLS/XLSX（**已完成**）
- Status: done — WorkspaceInspector 新增顶层 `document` Tab，Files 文件树与 `present_files` 两条入口统一按 `artifactPreviewMode` 三路分流（Reader/Browser/Document）。服务端 `inferPresentedFileKind` 与前端 `tool-artifacts.ts` 识别 `pdf/docx/excel`（XLS/XLSX 合并为 excel），`preview:false` 仅禁止自动打开、仍可手动预览。二进制复用 `/api/workspace/preview` 路由：仅扩展允许扩展名与 MIME（pdf/docx/xls/xlsx），50 MiB 上限、路径安全校验、realpath 复查、敏感文件拦截、ETag/304 与 `__quickforge_check=1` 预检全部沿用；未新增 document API、HEAD 或 Range。
- Renderer: `WorkspaceDocumentContent` 按格式动态 import 解析库（避免 Vitest Node 顶层 DOMMatrix 问题）：PDF 用 pdfjs-dist + 本地 Worker URL + IntersectionObserver 可见页懒渲染（DPR 上限 2、缩放 ≤2、render 按 canvas+viewport）；DOCX 用 docx-preview `renderAsync`（breakPages/页眉/页脚，独立 body/style 容器隔离样式）；Excel 用 xlsx 主线程解析、多 Sheet 切换 + 100 行/页分页 + 5000 行截断提示；数据重新加载后 sheet/页码自动重置。Tab 仅持久化 `{path, format}`，同路径复用并递增 `reloadNonce` 刷新；`revision` 由 `max(reloadNonce, manualNonce)` 派生，无 effect 内 setState。
- Dependencies: `pdfjs-dist@5.4.394`、`docx-preview@0.3.7`、`xlsx@0.20.3`（SheetJS CDN tarball 源不变）由 pi-web-ui 传递依赖提升为 QuickForge 直接 devDependencies，版本与既有锁定完全一致；lock 仅新增 3 行直接依赖声明，无升级、无新库类别。构建确认动态 import 复用既有 pi-web-ui chunk 模块，未重复打包。
- Verification: 定向 `npx vitest run`（tool-artifacts/artifact-preview-utils/workspace-inspector-tabs/server tools index+definitions/workspace-preview）→ 6 files / 169 tests 全通过；完整 `npm run test` → 253 files / 2247 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92`）；`npm run build` → 成功（仅既有 KaTeX 字体与 chunk size warnings）。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/server/tools/README.md`、`docs/wiki/server/routes/README.md`；未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push。PPT/PPTX/DOC/XLSM 不在本期范围，仍为 unsupported。
- Next step: 无 blocker；可选后续为真机（Electron/Android 远程）目视验证大文件 PDF/Excel 渲染与内存表现。

## Completed Feature：fix-cutover-startup-bugs

- Feature: 修复 cutover 启动链缺陷（fix-cutover-startup-bugs，**已完成；本轮完成 Share/LAN/Scheduled Runs 启动完整性收口**）
- Status: done — migration 12 原子物理删除 Share/LAN 在线 `record_digest`；repository 不再逐行维护或验证派生哈希。Share/LAN 的 `sqlite_authoritative_json_pending` 与 `authoritative` 常规启动只 drain 事务性 JSON mirror outbox，清空后保留已有 storage state 元数据并提升 authoritative，不做全表扫描或域内 `quick_check`。Scheduled Runs authoritative 常规启动不再调用 health quick check；SQLite 打开、schema 与 migration 等真正整库门禁仍由 `initializeSqliteStorage()` 负责。首次 cutover 的双读/备份/replace/快照 count-digest/关系校验及 backup/restore/export 边界保持严格。
- Share consistency: 普通 update 和未显式 tokens 的重复 create 保留现有 tokens；密码变化时清 token，若显式提供替代 tokens 则统一绑定新的 `authVersion`；supersede 物理删除旧 token；issue/prune 的返回值、数据库 `updated_at` 和 mirror 时间一致。启动恢复指引改为停进程、完整复制整个 dataDir（含 SQLite/WAL/SHM）、按实际错误域诊断，禁止删库或盲跑 session downgrade。
- Verification: 定向回归 17 files / 135 tests 通过；Share 修复聚焦回归 5 files / 34 tests 通过；完整 `npm run test` → 253 files / 2219 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Boundaries: 已同步 Share/LAN/SQLite 架构文档及 server Wiki；未新增依赖，未手工修改 `dist/`、`package-dist/`、`package-offline/`，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。当前未实现域级 `READY_DEGRADED` 或统一离线 restore CLI，这些不属于本轮最小收口。
- Next step: 无 blocker。

## Completed Feature：sidebar-five-item-display-shared-scroll

- Feature: 侧栏会话五条递增展示与统一中部滚动（**已完成**）
- Status: Projects 时间线、每个展开项目和 Tasks 默认显示 5 条；唯一可见控件“显示更多”每次增加 5 条，不显示“收起”。显示更多行复用普通 session 行的 `text-sm / leading-5`、`py-1.5 / px-2`、圆角、水平布局和整行点击区域，仅以 muted 灰色降低视觉层级；中英文 show-less i18n 已删除。只有下一组超过当前已加载数据时才调用既有 `loadMore`，并等待分页层确认确有新增数据后才提交展示数量；异步失败保持原数量、允许重试。每个 timeline/global/project key 独立维护 generation 与 pending generation：快速重复点击仍合并为单请求；用户在 pending 期间折叠 Projects/Tasks、折叠单项目、折叠全部项目或切换时间线视图触发重置时，对应 generation 立即递增，旧 Promise resolve true 后也不会提交旧 nextVisibleCount。`useSessionPagination` 的 `PAGE_SIZE=20` 保持不变且无页码。共享折叠 props、展开项目集合和 `sessionViewMode` 变化会让桌面/移动两个本地实例都执行 previous ref + effect 兜底重置；视图模式变化时每个实例将 timeline 恢复 5 条并 invalidate pending generation，初始挂载跳过，区块/项目 DnD 临时视觉折叠不重置展示数量。
- Layout / DnD: Pinned、Projects、Tasks 共用侧栏中部唯一纵向滚动容器，移除了 Pinned/Projects/Tasks 和项目子列表固定高度及内部纵向滚动，内容自然撑开；底部服务器/更新/设置区仍固定在外部。Pinned sentinel 保留且折叠时禁用；Projects 时间线、项目内列表、Tasks sentinel 已删除。项目拖拽自动滚动只允许共享侧栏容器，预览边界由纯函数计算 Projects 内容区域与共享视口的合法可见交集；矩形缺失、交集为空或夹紧上下界反转时只锁定横向、不构造 `top > bottom` 的非法边界。
- UX / i18n: 仅新增中英文“Show more / 显示更多”；显示更多整行与普通 session 的字号、行高、水平布局、圆角和点击区域一致，使用 muted 灰色及克制 hover/focus ring。无可见“收起”按钮，show-less 中英文 i18n 已删除；符合现有 DESIGN_LANGUAGE，未修改规范本身。
- Verification: 局部收口后，定向 `npx vitest run tests/frontend/sidebar-session-display-limit.test.ts tests/frontend/sidebar-section-order.test.ts tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/session-pagination-bootstrap.test.ts tests/frontend/project-drag-boundary.test.ts` → 5 files / 48 tests 全通过；新增契约锁定显示更多与普通 session 共用行/标题基类、muted 灰色、无 `onCollapse`/show-less key，并继续覆盖共享 `sessionViewMode`、折叠重置与 generation 竞态保护。目标 ESLint 0 error；完整 `npm run test` → 253 files / 2210 tests 全通过；`npm run lint` → 0 errors / 1 既有 warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 与 feature JSON 解析通过。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`；未新增依赖，未手工修改生成产物，未 commit/tag/push；两个无关未跟踪 design-mockups 文件未触碰。

## Current Feature：release-v1.8.1（已完成）

- Feature: patch 发布 v1.8.1（release-v1.8.1，**已完成**）
- Status: done — 最终基线为 `35e0863`（b81effaa + 发布说明文档刷新），`v1.8.1` tag 已创建并推送远端，master/dev 均已同步到该提交。
- Release facts: npm 上 1.8.1 从未发布（latest 停留在 1.8.0）；经用户决策跳过补发，由 v1.9.0 直接取代（见上方 release-v1.9.0）。
- Next step: 无。后续发布流程见 release-v1.9.0。


## Completed Feature：remove-side-chat-title-entry-global-inspector-access

- Feature: 移除对话顶部 Side Chat 入口并保持全局 Inspector 可达（remove-side-chat-title-entry-global-inspector-access，**已完成**）
- Status: done — `App.tsx` 已彻底移除主对话标题区 Side Chat 按钮、`openWorkspaceSideChat`，以及只为该按钮显隐服务的 `sideChatTabOpen / onSideChatPresenceChange` 状态链；`sideChatOpen` 中英文 i18n 键因全仓无引用一并删除。
- Inspector: Side Chat 仍保留在 Workspace Inspector 的 `+` 菜单和空 Tab 入口，继续要求活动主会话与可用模型，重复打开只激活单实例运行时 Tab；关闭自身、关闭其他、关闭全部和切换 runtime scope 仍会 reset/abort/清空。桌面主工具栏 `PanelRight` 按钮不再依赖 `currentToolProject.id`，global/无项目会话也会挂载并可展开 Inspector；仍保留 `needsModelSetup` 禁用和 `lg:inline-flex` 桌面断点，移动端未新增入口。
- Verification: 定向 `npx vitest run tests/frontend/side-chat-workspace-tab.test.ts tests/frontend/workspace-inspector-tabs.test.ts tests/frontend/workspace-inspector-on-demand-source.test.ts tests/frontend/workspace-inspector-open-state.test.ts tests/frontend/workspace-inspector-request.test.ts` → 5 files / 46 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` → 成功，仅既有 KaTeX 字体解析与 chunk size warnings；`git diff --check` → 通过。
- Boundaries: 已同步 `docs/wiki/src/components/README.md`；无需修改 `DESIGN_LANGUAGE.md`，因为没有新增视觉或移动交互模式。未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿未触碰。
- Next step: 无 blocker；可选桌面真机确认 global/无项目会话主工具栏右侧栏按钮可展开 Inspector，以及 Inspector 内两类 Side Chat 入口仍为单实例。

## Completed Feature：remove-todo-summary-bottom-border

- Feature: 移除 TodoWrite 任务摘要底部横线（remove-todo-summary-bottom-border，**已完成**）
- Status: done — 仅删除 `src/index.css` 中 `.quickforge-todo-summary` 的 `border-bottom` 声明；任务摘要的布局、背景、交互及其他业务代码/样式均未改。
- Verification: `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/slash-invocation-chip.test.ts` → 2 files / 44 tests 全通过；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Boundaries: 局部样式调整不改变架构、模块职责或公共入口，docs/wiki 与 `DESIGN_LANGUAGE.md` 无需更新；未新增依赖，未手工修改生成产物，未创建 commit/tag/push；既有未跟踪设计稿未触碰。
- Next step: 无 blocker；可选真机目视确认输入框上方任务摘要底部横线已消失。

## Completed Feature：todo-write-sticky-summary

- Feature: TodoWrite 输入框上方任务摘要与专用历史渲染（todo-write-sticky-summary，**已完成**）
- Status: done（位置调整、审查 major 修复、定向验证与完整门禁均已完成）
- Scope: 服务端完整快照型 `todo_write` 协议与持久化语义不变。前端最新成功快照现位于 Composer Dock 内、`message-editor` 前的正常流任务摘要：展开时自然压缩消息区，不覆盖消息或输入框；长列表在摘要内部滚动，桌面约显示 4 项、移动端约显示 3 项。Composer sibling 顺序为任务摘要 → command/file 临时建议菜单 → `message-editor` → stats，菜单紧邻输入框；历史工具调用仍在既有过程折叠中，并由专用 renderer 提供 running/error/success/clear/neutral 历史事件摘要。
- Behavior: 无有效 Todo 不显示；首次未完成自动展开；后续未完成快照保留用户手动展开/收起状态，相同内容的新 toolCall 仍提示“已更新”；全完成自动收起但允许重开；成功空数组或回滚到无快照时移除；editor/shell 重建时按当前快照自愈；`readOnly` 无 Composer Dock 时不显示。QuickForge/OpenCode 提取继续按成功快照与 `toolCallId` 配对，错误、畸形或未完成结果不覆盖已有有效快照。
- Review fixes: 两个 major 已修复：①任务摘要从聊天消息区顶部调整为 Composer Dock 正常流 sibling，并补齐 sibling 顺序、内部滚动、readOnly、重建自愈与移除边界；② Slash invocation overlay 同时观察 textarea 与 composer shell，摘要插入/展开/收起导致布局变化时重算几何，observer 在重建和卸载路径成对 cleanup。历史 renderer 文案只陈述“更新任务清单 / 清空任务清单”，不再声称同步当前 UI；running/error/neutral 与 `detailed` JSON 语义保持准确。
- Verification: 定向 `npx vitest run tests/frontend/todo-write-summary.test.ts tests/frontend/todo-write-renderer.test.ts tests/frontend/slash-invocation-chip.test.ts tests/server/tools/definitions.test.mjs tests/server/tools/index.test.mjs tests/server/routes/tools.todo-write.test.mjs` → 6 files / 89 tests passed；`npx tsc -b --pretty false` → exit 0。最终完整门禁：`npm run test -- --reporter=dot` → 242 files / 2112 tests passed；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → passed，仅既有 KaTeX 字体解析与 chunk size warning。
- Verification process: 首次完整 `test/lint/build` 链通过；为了提取数量二次运行全量 test 时，`tests/server/cloud/qf-agent-process.test.mjs` 的 “does not double start while a restart timer is pending” 出现一次无关定时器波动（1 failed / 2111 passed）。该单文件复跑 28/28 通过，随后全量 242 files / 2112 tests 通过；未为此修改代码。
- Boundaries: 未新增或升级依赖；未新增存储表；未手工修改 `dist/`、`package-dist/`、`package-offline/` 等生成物；`DESIGN_LANGUAGE.md` 未更新，因为复用既有轻盈内嵌工具模式。
- Existing workspace noise: 任务开始前 `package-lock.json` 已有 43 行 npm peer 元数据噪音（当前 diff 14 增/29 删），本功能未修改、还原或纳入正式功能；`artifacts/todo-write-interaction-prototype.html` 为保留的 HTML 设计原型，正式实现不依赖，未归入功能 files/交付范围；无关未跟踪 `').Groups[1].Value` 未触碰、不纳入本功能。
- Next step: 仅可选真机目视输入框上方任务摘要、长列表、`/` 与 `@` 菜单、slash chip、深浅主题及窄屏。未创建 commit/tag/push。

## Current State

- Feature: 侧边聊天 Workspace Tab（side-chat-workspace-tab，**已完成**）
- Status: done — Side Chat 最终收敛为直接复用主聊天 `ChatConversationSurface → ChatPanelHost → pi-web-ui ChatPanel/MessageList/MessageEditor`：纯文本发送、停止、复制、Markdown/代码块、滚动与轮次导航正常；`+`、模型、Access、rollback/retry/fork 等主控件原位复用但 native disabled，不再实现 Side Chat 专属模型、附件、Slash、插件、文件引用、Plan、历史分叉或工具 Agent。最小内存 Agent/NDJSON 只传 user/assistant 纯文本，显示最多 40 条，请求从最新向前按完整消息裁剪至 200,000 字符；切普通 Tab 保留，关闭/关闭其他/关闭全部/切主会话时 abort/reset，Tab 不持久化。Host 隔离 localStorage、Git、通知、artifact、审批、终端、context usage/compaction 等副作用；Side Chat 初始化 `ChatPanel.setAgent()` 时保存并恢复主聊天全局 artifacts renderer，禁用装饰只关闭当前 panel 所属模型/Access 菜单。入口仅在活动主会话和模型可用时启用。服务端读取活动主会话权威纯文本上下文，固定 `tools: []`，tool call fail closed，不创建、调用或持久化主 Agent。
- Verification: 定向 Vitest 11 files / 97 tests 与隔离修复聚焦 9 files / 71 tests 全通过；`npx tsc -b --pretty false`、MJS syntax、`git diff --check` 通过；完整 `npm run test` → 249 files / 2148 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）。
- Next step: 无 blocker；Wiki 与状态已同步，本次仅提交 Side Chat，未 tag/push；未新增依赖，未手工修改生成产物。Plan pill 只在主聊天已进入 Plan 模式时存在，Side Chat 从不进入该模式，因此不额外伪造控件。

- Feature: Prompt HTTP 失败时在聊天区显示具体错误原因（prompt-http-error-message，**已完成**）
- Status: done — `ServerAgent.prompt()` 的 HTTP fetch 失败分支继续仅在乐观 user message 仍是尾部时精确回滚，随后追加唯一合法 assistant error message：空 text block、当前模型 `api/provider/id`、完整零 usage/cost、`stopReason:'error'`、服务端具体 `errorMessage` 与 timestamp。同步清理 streaming 状态，保留 error 事件，并让本地 `agent_end` 携带 `status:'error'`、`errorMessage` 和最终 messages，因此 Chat 消息区可直接显示如 `Selected model is not configured in QuickForge.` 的具体原因。
- Verification: `npx vitest run tests/frontend/server-agent.test.ts` → 1 file / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Next step: 无 blocker；已同步 src/lib Wiki。未创建 commit/tag/push，未新增依赖，未修改生成产物或架构/设计语言文档。

- Feature: 修复 Side Chat assistant 上下文缺失 usage（fix-side-chat-assistant-usage-contract，**已完成**）
- Status: done — `server/routes/side-chat.mjs` 在服务端最终模型解析、主上下文/侧聊历史纯文本安全投影和既有字符预算裁剪之后，统一物化 pi-ai 消息：user 保持合法纯文本 user message；assistant 固定为单一 text block，使用最终 `model.api/provider/id`，完整零 `usage`（含 input/output/cacheRead/cacheWrite/totalTokens 与五项 cost）、`stopReason:'stop'`、timestamp。客户端或历史中的 usage/details/tool/thinking 等字段均不信任、不回传；既有压缩语义、120k/200k 字符预算、权限和工具 fail-closed、`tools: []` 均未改。
- Verification: `npx vitest run tests/server/routes/side-chat.test.mjs tests/frontend/side-chat-agent.test.ts` → 2 files / 13 tests 全通过；目标 ESLint 0 error；`node --check` 两个 MJS 通过；`npx tsc -b --pretty false` 通过；`git diff --check` 通过。
- Next step: 无 blocker；已同步 routes Wiki 一句服务端消息契约。未创建 commit/tag/push，未触碰生成产物或其他并行文件。

- Feature: Side Chat 与主聊天共享完整对话显示壳（side-chat-shared-conversation-surface，**已完成**）
- Status: done — 新增极薄 `ChatConversationSurface`，统一主聊天和 Side Chat 的 `relative/flex/min-h-0/flex-1/flex-col/overflow-hidden` 与 `--quickforge-main-bg`。App 主聊天保留 `quickforge-empty-chat`、`quickforge-conversation-enter`、Hero、`NewChatProjectPicker`、`ErrorBoundary`、`Suspense` 与首次使用引导；Side Chat 用同一 surface 包住同一 `ChatPanelHost mode="side-chat"`，保持普通空白空状态，移除 `showTurnNavigation={false}`，不自绘 textarea/messages/button，不新增 side-chat CSS/class。Host 的 mode 仅保留安全能力关闭、空 tools、内存草稿与副作用隔离；DOM return/插入无视觉 mode 分支。
- Verification: 定向 Vitest 5 files / 38 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 247 files / 2108 tests 全通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Next step: 无 blocker；实际可见差异只来自主聊天区与 Inspector 的容器宽度，消息、Composer、轮次导航和布局由同一响应式规则自然适配。未创建 commit/tag/push，未手工修改生成产物。

- Feature: 上下文统计增加 Skills/MCP 来源行（context-usage-skills-mcp-breakdown，**已完成**）
- Status: done — 服务端 `contextUsage.breakdown` 新增可选 `skillsTokens` / `mcpTokens`。最终审查收口后，Skills 不再扫描全部同名标签：以 `activate_skill` / `read_skill_resource` definition 参数枚举作为 enabled Skills 的结构化证据，只选择最后一个带系统固定介绍且包含全部启用名称的真实 catalog，再归集 Skills definitions 与已关联调用/结果；无 enabled Skills 时伪标签/伪调用为 0。MCP definition 仅接受非数组对象 `mcp` 且 `serverName` / `toolName` 为非空字符串；名称回退通过共享 `server/mcp/tool-name.mjs` 复用 registry 的真实 server canonical 与 tool sanitize/encode 规则，解析后重建并要求和原字符串完全一致，因此三处带空格、空 segment、非法 server 与未编码 tool 名均拒绝，同时接受 registry helper 生成的 canonical 名称，且未收紧 `registry.isMcpToolName()` / `callMcpTool()` 的既有公共行为。toolResult 有非空 `toolCallId` 时仅按已识别 MCP call ID 关联，错误/孤立 ID 不再降级凭名称；ID 缺失/空时才允许按已识别 canonical `toolName` 关联；ID/name 都缺失时才接受完整 `details: {mcp:true,server,tool}`。两项复用 `pi-agent-core.estimateTokens()`，是跨系统提示词/工具定义/消息三类的来源归因，不参与总量或百分比二次相加。Tooltip 在现有三行后按正数追加 `Skills` / `MCP`，缺失或 0 隐藏；圆环和总量不变。
- Verification: 最终审查定向 Vitest 3 files / 40 tests 全通过；MCP registry 额外回归 1 file / 6 tests 全通过；完整 `npm run test` → 247 files / 2119 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；`git diff --check` 通过。
- Next step: 无 blocker；已同步 server/components Wiki。架构、模块职责和公共入口未改变，无需更大文档更新。保留 `docs/prototypes/context-usage-source-attribution.html`，未迁移原型演示控件；未创建 commit/tag/push，未手工修改生成产物。

- Feature: 工具调用标题与参数运行态扫光（tool-call-running-title-sweep，**已完成**）
- Status: done — 普通 `LocalWorkspaceToolRenderer` 仅在 running 时为 `quickforge-tool-label` 追加 `quickforge-tool-running-sweep`，标题与参数摘要以低强度从左到右循环扫光；运行态隐藏 `renderStatus` 的 spinner/耗时，done/error/called 原状态不变。`aria-busy` 保留语义；reduced motion 关闭扫光且不增加静态运行状态；`run_command` 输出和终止按钮不变，共享 `renderStatus` 未修改。实现文件为 `src/lib/local-tools.ts`、`src/index.css`、`tests/frontend/local-tool-running-sweep.test.ts`，设计探索稿为 `design-mockups/tool-call-running-light-sweep.html`。
- Verification: 目标 Vitest 4 files / 31 tests 全通过；目标 ESLint 通过；`npm run build` 成功（仅既有 KaTeX 字体与 chunk size warnings）；`feature_list.json` JSON 可解析；`git diff --check` 通过。
- Next step: 无代码 blocker；局部视觉状态反馈不改架构、模块职责或公共入口，docs/wiki 无需更新；符合现有 DESIGN_LANGUAGE，未修改规范。未创建 commit/tag/push，未手工修改生成产物。

- Feature: 右侧 Inspector subagent Tab 图标复用设计稿 Bot（subagent-tab-bot-icon，**已完成**）
- Status: done — 用户要求右侧边显示 subagent 过程的 Tab 图标复用 subagent 设计里的 icon。调研确认：设计稿 `design-mockups/subagent-tool-marquee-impl.html` / `subagent-marquee-roll-switch.html` 的 subagent 类型图标即 Lucide `Bot`，且与聊天内 run_subagent 摘要卡（`local-tools.ts` renderToolIcon）和 Slash agent 图标（`slash-icons.ts` agent=Bot）一致；右侧 Inspector 现状是 `WorkspaceInspector.tsx` 两处内联 `SquareActivity`（顶部 Tab 栏 + ChevronDown Tab 下拉列表），`panelTabMeta` 对 subagent 不提供 meta。改动仅将两处 `SquareActivity` 换为 `Bot` 并同步 import（SquareActivity 全仓库无其他使用）。`workspace-inspector-tabs.test.ts` 新增源码契约测试锁定两处分支与 import。
- Verification: 定向 `npx vitest run` inspector 相关 5 files / 37 tests 全通过（含新增契约用例）；`npx eslint` 改动源码/测试 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。纯图标替换，docs/wiki 与 DESIGN_LANGUAGE 无需更新（不改架构/职责/入口，无新视觉模式）。未创建 commit/tag/push。
- Next step: 无代码 blocker；可选真机目视深浅主题下 subagent Tab 图标观感。

- Feature: 侧边聊天 Workspace Tab（side-chat-workspace-tab，**已完成**）
- Status: done — 已实现单实例、非持久化 Workspace Side Chat，并改为真实复用主对话核心 UI。`SideChatTabContent` 仅包装 `ChatPanelHost mode="side-chat"`；消息列表、Markdown/代码块、滚动、Composer、Enter/Shift+Enter/IME、复制、发送/停止与流式等待均走主对话同一链路。主聊天标题栏、Workspace `+` 与空 Tab 入口重复打开只激活同一 Tab；无可用模型时三类入口均不允许打开。App 稳定持有内存 `SideChatAgent` 与输入 ref，切换其他 Workspace Tab 保留；关闭自身/关闭全部/在其他 Tab 关闭其他/切换主会话时 abort/reset、清空并恢复主标题入口。
- Server: 新增 `POST /api/side-chat/stream` NDJSON 路由。只读取当前活动主会话的权威消息、模型、thinking 与有效压缩上下文；主线上下文仅投影 user/assistant 纯文本，忽略 system/tool/toolCall/thinking/details/非文本块，按 120,000 字符从最新向前裁剪并尽量保留 compact summary；主线与侧聊合计不超过 200,000 字符。QuickForge 使用会话权威模型，OpenCode 使用前端当前 QuickForge `modelRef`，不调用 ACP。模型上下文固定 `tools: []`，任何 `toolcall_*` / `toolUse` fail closed；不调用 `runPrompt`、不创建/恢复 Agent、不写会话或持久化，断连会 abort。
- Verification: 定向 Vitest 11 files / 76 tests 全通过；目标 ESLint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test` → 245 files / 2095 tests 全通过；完整 `npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选真机确认深浅主题、主标题入口、Workspace `+`、Tab 生命周期、OpenCode 主会话与流式停止。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`，未跟踪原型 `design-mockups/side-chat-tab.html` 保持未修改。

- Feature: 修复左侧 Tasks 普通收起闪烁（fix-tasks-collapse-flicker，**已完成**）
- Status: done — 根因是 Tasks 普通收起时，外层 `SortableSidebarSection` 同一提交从展开态 `flex-1` 切为折叠态 `shrink-0`，内层内容面板仍执行 200ms `grid-template-rows` / `opacity` 关闭动画；配合 `h-full`、flex 与滚动树会产生中间绘制帧。现在仅 Tasks 面板在 `conversationsVisuallyCollapsed` 为 true 时追加现有 `transition-none`，普通收起和拖拽临时收起均瞬时关闭；展开时该类移除，保留既有 200ms 动画。Projects 未改。
- Verification: `npx vitest run tests/frontend/sidebar-section-order.test.ts` → 1 file / 15 tests 全通过；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` → 0 error；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Next step: 无代码 blocker；可选真机确认桌面/移动 Tasks 普通收起无闪烁且展开动画仍存在。局部视觉 bugfix 不改变架构、模块职责或公共入口，因此未更新 docs/wiki，也无需修改 DESIGN_LANGUAGE。未创建 commit/tag/push；未手工修改生成目录，build 仅重建被忽略的 `dist/`；无关 `design-mockups/side-chat-tab.html` 保持不动。

- Feature: 拆分侧栏默认新建与 Tasks 显式全局新建（tasks-new-chat-inherits-current-task-project，**已完成**）
- Status: done — `ChatSidebar` 顶部“发起新对话”与 Tasks 标题 MessageSquarePlus 已拆为 `onStartNewDefaultChat` / `onStartNewGlobalChat`。顶部继续调用 `startNewDefaultSession`，有 `activeProject` 时按默认规则新建该项目对话，否则新建 global。Tasks 标题 desktop/mobile 调用独立 `startNewExplicitGlobalSession`：先 `setEmptyStateProjectDismissed(true)`，再 `startNewGlobalSession()`；标记只在离开当前新对话空状态后复位，因此 active-project 自动项目 effect 不会把显式 global 切回项目。global 使用默认 Workspace（`~/.quickforge/workspace`），不读取 `activeProject`、当前任务、`chatScope` 或 `currentToolProject`。移动包装保持先关闭侧栏；项目行 `onStartNewProjectChat(item)` 未改。上一轮错误 helper、测试与 lib Wiki 条目已移除。
- Verification: `npx vitest run tests/frontend/sidebar-new-chat-routing.test.ts tests/frontend/sidebar-section-order.test.ts` → 2 files / 19 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`feature_list.json` 解析与 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机分别点击桌面/移动的顶部、Tasks 标题和项目行三个入口确认。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`，无关的 `design-mockups/side-chat-tab.html` 保持不动。

- Feature: 准备 v1.8.0 minor release（release-v1.8.0，**已完成**）
- Status: done — 本次为 minor 发布：先以功能提交 `56d435d`（feat: 增加 /commit 与自定义模型设置入口）纳入当前全部工作区改动（20 条目），并以 `--ff-only` 将 `master` 快进，无 merge commit。package 双文件 1.7.12→1.8.0；CHANGELOG 已按 `v1.7.12..HEAD` 的 17 个提交新增 `[1.8.0]` 条目；README 无固定版本引用，未修改。完整 `npm run test`（239 files / 2068 tests）全通过，`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；runtime/offline 包及 tarball 已生成并完成元数据、依赖处理与清单校验。生成目录均被 Git 忽略，release commit 范围为 6 个预期发布文件。
- Release sequence: 本变更用于 release commit，随后创建 tag `v1.8.0`，`dev` 快进至发布提交，原子推送 `master`/`dev`/`v1.8.0`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.8.0.tgz --access public`。

- Feature: 主聊天模型选择器底部打开自定义模型设置（main-chat-model-selector-settings-entry，**已完成**）
- Status: done — `custom-model-selector` 新增语义独立的可选无参 `onOpenModelSettings`，不复用旧的模型编辑参数；仅 `useModelActions` 主聊天入口传既有 `openModelSettings`。桌面浮层与移动抽屉底部按条件显示低强调“自定义模型”，点击先统一关闭选择器并复位 trigger `aria-expanded`，再打开 `customModels` 设置页。共享对话、Agent 表单等不传回调的复用场景不显示。移动 footer 在可滚动 model list 之外保持固定，样式遵循既有分隔线、muted 文字及 hover/focus token。
- Verification: 定向 `npx vitest run tests/frontend/custom-model-selector.test.ts tests/frontend/use-model-actions-cloud.test.ts tests/frontend/i18n-language-snapshot.test.ts tests/server/routes/shared-conversation.model-visibility.test.mjs` → 4 files / 15 tests 全通过；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；需求文件 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机目视桌面/移动、深浅主题及移动长模型列表。未创建 commit/tag/push，未手工修改生成目录；build 只重建被忽略的 `dist/`。

- Feature: Composer @ 从项目根目录逐层浏览文件（file-reference-root-browser，**已完成**）
- Status: done — 新增严格 `projectId` 的 `/api/workspace/mention-children`，只返回当前目录全部直接安全子节点且目录优先，不递归、不分页、不回退默认 workspace；敏感路径、真实目标和项目外符号链接继续按 mention 边界过滤。审查修正后，目录完成 stat/realpath 解析仍按真实/链接目标路径分段排除 `SKIP_DIRS`：普通 `node_modules`、名为 `node_modules` 的目录链接与安全别名指向 `node_modules` 子树均不返回；普通安全目录链接仍允许。Composer 裸 `@` 默认浏览根目录；点击/Enter/Tab 目录逐层进入，选择文件才沿用既有 `contextReferences`；`@src` 等仅在当前目录本地筛选，不发全项目搜索请求；当前层全部渲染并由菜单滚动。旧 `mention-search` 保留兼容但 Composer 不再调用。
- Verification: 审查收口 `npx vitest run tests/server/routes/workspace-tree-on-demand.test.mjs tests/frontend/file-reference-controller.test.ts` → 2 files / 29 tests 全通过（含请求竞态、remove Abort 与 cleanup listener）；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` 通过（仅既有 CRLF→LF warning）。完整门禁：`npm run test` → 238 files / 2062 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。
- Next step: 可选真机确认深浅主题、长目录滚动、鼠标/键盘逐层进入、当前层筛选及文件 chip；未创建 commit/tag/push。

- Feature: / 斜杠菜单点击菜单外任意区域收起（slash-menu-click-outside-dismiss，**已完成**）
- Status: done — 用户关闭与内部删除已分离。菜单外任意 pointerdown（包括 textarea/Composer 控件）、Escape 或公开 `remove()` 会收起菜单、清理 document listener，并进入等待下一次显式输入的抑制态；即使正文仍以 `/` 开头，MutationObserver 装饰刷新、catalog resolve/reject 回调等无参数 `update()` 也不会立即重开。下一次真实输入调用 `update(value)` 时解除抑制并正常打开/过滤。选中菜单项、chip 激活、非 Slash 文本、无结果等内部删除走不抑制的统一 `removeMenu()`；document listener 为控制器级单例，重复渲染不累积，`cleanupTextareaHandler()` 同步清理。菜单本体 pointerdown 仍不关闭；`@` 文件引用菜单保持既有行为未改。
- Verification: `npx vitest run tests/frontend/command-suggestions.test.ts` → 1 file / 18 tests passed；`npx vitest run tests/frontend/command-suggestions.test.ts tests/frontend/slash-invocation-chip.test.ts tests/frontend/composer-plus-menu.test.ts` → 3 files / 49 tests passed；目标 `npx eslint` → 0 error；`npx tsc -b --pretty false` → exit 0；`git diff --check` → exit 0（仅 `feature_list.json` 既有 CRLF→LF warning）。
- Next step: 无代码 blocker；可选真机确认点击输入框/消息区收起、继续输入重开、点击菜单行仍正常插入。未创建 commit/tag/push。

- Feature: 内置 Slash 指令 `/commit [message]`（builtin-slash-commit，**已完成**）
- Status: done — 后端 catalog/help、内部解析与 agent-manager 命令状态已接入 `/commit`；参数可省略。当前轮权限固定为 `allowEdit=false`、`allowCommands=true`、`allowSubagents=false`。简短 6 条 prompt 要求仅显式暂存并提交当前任务相关文件，禁止 `git add .` / `-A` / `--all`，验证失败停止，不修改代码、不混入无关改动、不绕过 hooks，最多一个本地 commit，禁止 push/tag/release/publish；无 message 时按 diff 与仓库风格生成，最后报告 hash/message/验证/剩余改动。前端菜单显示 `/commit [message]` 并插入 `/commit `，中英文描述、README 和 server/components Wiki 已同步。
- Verification: 定向 `npx vitest run tests/server/custom-commands.test.mjs tests/server/slash-skill-agent.test.mjs tests/frontend/command-suggestions.test.ts` → 3 files / 78 tests passed；目标 `npx eslint` 0 error；`npx tsc -b --pretty false` exit 0；完整 `npm run test` → 238 files / 2050 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；未创建 commit/tag/push，`package-lock.json` 的既有 peer 元数据改动未触碰。

- Feature: 点击 Composer 内 Slash chip 不再降级显示命令原文（slash-chip-click-keeps-chip，**已完成**）
- Status: done — 用户真机反馈：选中 agent 后输入框内的小 tab（slash chip）一点击就露出 `/agent <name>` 原文。根因是覆盖层整体 `pointer-events:none`，点击穿透到 textarea 前缀区，光标进入前缀触发 selectionchange 降级逻辑。修复：CSS 仅对 `.quickforge-slash-overlay .quickforge-slash-chip` 开启 `pointer-events:auto`（消息流 chip 保持纯展示），控制器在 `renderChipContent` 为覆盖层 chip 挂 `pointerdown`：preventDefault 后聚焦 textarea 并把光标移到文本末尾，chip 保持显示不降级；键盘方向键进入前缀区的降级/自愈、IME、自愈重建逻辑均未改。共享工厂 `createSlashChipElement` 未挂监听，消息流 chip 不受影响。
- Verification: 定向 `npx vitest run tests/frontend/slash-invocation-chip.test.ts tests/frontend/command-suggestions.test.ts` → 2 files / 36 tests passed（新增 chip pointerdown 用例：preventDefault、光标移末尾、不降级、CSS 契约）；相邻 `message-actions` / `composer-plus-menu` / `slash-catalog` 3 files / 29 tests passed；`npx eslint` 改动源码/测试 0 error；`npx tsc -b --pretty false` exit 0。
- Next step: 无代码 blocker；可选真机点击 skill/agent chip 确认光标落末尾且原文不露出（含触屏）。

- Feature: 用户消息显示本轮插件标签并在重试/分享中保留（user-message-selected-plugin-chips，**已完成**）
- Status: done — 审查收口修复 M1/M2：服务端 `selectedCapabilitiesFromMessage` 改为历史快照投影，retry/continue 只能恢复 `type/pluginName/name/label`，历史 `details.description` 即使伪造也不会进入 LLM prompt；新发送请求顶层 description 仍仅用于当前轮临时 prompt。前后端历史读取边界均有同构测试。`decorateUserContextChips` 做最小导出，message-actions 新增真实 fake DOM 行为测试，实际执行插件在文件前、重复调用替换不重复、混合→空移除、历史 chip 无 ×、仅插件/仅文件/混合 aria-label，并经 `decorateMessages` 点击 copy 验证仍复制原始正文。Wiki 行数/表格已按当前源码修正；feature 保持 done。
- Verification: 审查收口定向 Vitest 9 文件 / 87 用例全通过；目标 eslint 0 error；`npx tsc -b --pretty false`、`git diff --check`、feature JSON 解析通过；完整 `npm run test` 238 文件 / 2043 用例 100% 全通过；完整 `npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）。`package-lock.json` blob hash 仍为 `a7f0bb9fcb4de96f8953024be8ac588435dcc3ab`，未修改/还原；未触碰并行 `slash-invocation-chip.ts` 及其测试/专属逻辑，未手工修改生成目录，未 commit/tag/push。
- Next step: 无代码 blocker；可选真机目视多插件、未知插件、仅插件/仅文件/混合消息及分享页。

- Feature: Composer 插件标签移入输入卡片并统一插件术语（composer-plugin-chips-inside-editor，**已完成**）
- Status: done — 审查修复已完成：`ensureComposerContextChips` 继续从 textarea 父元素定位真正输入卡片；新增共享 `syncComposerContextChipsAriaLabel`，两个控制器在完成自身 chip 增删后统一调用，按仅插件=`Selected plugins / 已选插件`、仅文件=`Referenced files / 引用的文件`、混合=`Selected plugins and referenced files / 已选插件和引用的文件` 同步可访问名称，空容器仍移除。插件与文件引用两类 chip 在任一同步/删除顺序下互不删除；内部 capability 类型、`selectedCapabilities` 草稿字段与发送协议不变。插件多选、去重、草稿恢复、× 删除和发送消费保持；documents/spreadsheets/presentations 使用现有专用图标，未知插件回退通用图标。CSS 仅收紧标签尺寸/间距和有标签时 textarea 顶部 padding，保留 composer `> div:first-child` 根卡片选择器及文件标签色。
- Verification: 审查修复定向 vitest 9 文件 / 77 用例全通过（含双控制器 file-first/plugin-first 两种同步顺序、互相保留、分别删除、最后一项删除移除空容器及仅文件/仅插件/混合 aria-label）；目标 eslint 0 error；`npx tsc -b --pretty false` 通过；完整 `npm run test -- --reporter=dot` 236 文件 / 2024 用例全通过；完整 `npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选真机目视深浅主题下多插件+文件混合标签、删除按钮、窄输入框换行及读屏名称。`package-lock.json` 仍为任务前既有 43 行 peer 元数据差异，本次未修改/还原；未创建 commit/tag/push，未手工修改生成目录（build 仅重建被忽略的 `dist/`）。

- Commit 收尾：本轮并行三功能已提交——`4f0182f`（slash chip 点击修复，含 index.css 专属 hunk 拆分）、`abbc7cd`（插件标签链路与用户消息插件回显；composer-plugin-chips-inside-editor 与 user-message-selected-plugin-chips 在多文件内交织，合并一笔）；状态文档随后以独立 docs commit 收口。提交前完整门禁：`npm run test` 238 files / 2043 tests 全通过、`npm run lint` 0 errors / 1 existing warning、`npm run build` 成功。`package-lock.json` peer 元数据噪音仍未提交、未丢弃。未 tag、未 push。

- Commit 收尾：剩余功能代码已按逻辑提交为 `d66a3e7`（Workspace Inspector 会话隔离）、`924e8c5`（Slash canonical name + 中性 Lucide 图标）、`b64a4b2`（Composer hover）；此前侧栏区块功能已在 `72ac7e09`，会话状态 clear 修复已在 `6c337aeb`。状态文档将在本次独立 docs commit 收口；未 tag、未 push。
- 最终验证：`npm run test` → 236 files / 2020 tests 全通过；`npm run lint` → 0 errors / 1 existing warning（`server/cloud/identity.mjs:92 no-useless-assignment`）；`npm run build` → 成功（仅既有 KaTeX 字体解析与 chunk size warning）；`git diff --check` 与 `feature_list.json` / `package.json` / `package-lock.json` JSON 解析通过。
- 保留未提交：`package-lock.json` 仅有 43 行 npm `peer` 元数据翻转；`package.json` 无依赖/版本变化，且用当前 npm 11.6.2 对 HEAD 锁文件执行隔离 `npm install --package-lock-only` 可复现同一结果，判定为工具链规范化噪音。按要求未提交、未丢弃。

- Feature: 侧栏区块改用标题拖拽并在排序时临时折叠（sidebar-section-title-drag-collapse，**已完成**）
- Status: done — Projects / Tasks 不再显示专用 GripVertical；各自标题主 toggle 直接接收 `setActivatorNodeRef` / attributes / listeners，普通单击仍走原折叠回调，仅独立 `draggableSectionTitleClass` 添加 `touch-none` 与 grab/grabbing 反馈；共享 `sectionToggleClass` 保持普通折叠标题样式，Pinned 继续使用默认 pointer/触摸行为。PointerSensor 超过 6px 才启动拖拽，右侧 action buttons 保持隔离。拖动任一区块时，两个区块通过派生视觉状态同时临时折叠，Chevron、`aria-expanded`、外层尺寸与内容 grid 一致；收缩禁用过渡，cancel/end 清理 `draggingSectionId` 后恢复各自原持久折叠状态。compact layout、设置底部固定和 Projects 内部 DnD/边界保持不变。
- Verification: 定向 vitest 2 文件 / 21 用例（含 Pinned 不使用 draggable class、Projects/Tasks 使用的契约）、目标 eslint、`tsc -b`、`git diff --check` 全通过；前一轮完整 `npm run test` 236 文件 / 2020 用例全通过、完整 lint 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）、build 成功（仅既有 KaTeX/chunk warnings），本次极小局部修复未重复全量门禁。
- Next step: 无代码 blocker；可选真机分别从 Projects/Tasks 标题短按折叠与拖动换位，确认 6px 阈值、两个区块瞬时收缩、右侧操作按钮隔离以及结束/取消恢复。

- Feature: 修复侧栏 Projects / Tasks 折叠后不贴合（sidebar-collapsed-sections-compact-layout，**已完成**）
- Status: done — `SortableSidebarSection` 现在接收按 `sectionId` 推导的折叠状态；折叠时使用 `shrink-0`，Tasks 不再保留 `flex-1` 撑出大段空白，两个标题会按当前排序紧贴。展开时 Tasks 仍为 `flex-1`，Projects 仍为 `max-h-[55%]`；顶层排序容器的 `flex/min-h-0/overflow-hidden`、两区内部滚动和底部设置 `mt-auto shrink-0` 均保留。拖拽语义、传感器、命名空间 ID、排序存储和项目内部 DnD 未改。
- Verification: 定向 vitest 2 文件 / 20 用例、目标 eslint、`tsc -b` 全通过；完整 `npm run test` 236 文件 / 2019 用例全通过；完整 lint 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；build 成功（仅既有 KaTeX/chunk warnings）；`git diff --check` 通过。
- Next step: 无代码 blocker；可选在桌面/移动分别测试 Projects→Tasks 与 Tasks→Projects 顺序下单独/同时折叠，确认标题紧贴、展开区滚动与设置底部固定。

- Feature: 统一 Slash 图标并取消类别色（unify-neutral-slash-icons，**已完成**）
- Status: done — command/skill/agent 分别复用已有 Lucide `SquareTerminal` / `BookOpen` / `Bot`，通过 `slash-icons.ts` 静态映射供斜杠菜单、输入框选中 chip 与消息流复用 chip 使用；移除本 Slash 功能新增的自绘类别 glyph。菜单三类图标默认统一 `var(--muted-foreground)`，hover/selected 仅增强为 `var(--foreground)`；共享 chip 只将 `.quickforge-slash-chip-icon` 覆盖为中性色，因此 skill/agent chip 原有蓝/绿背景与文字语义色、结构和行为保持不变。非 Slash 能力菜单继续使用 `capability-icons.ts`，未扩大范围。
- Verification: 定向 vitest 2 文件 / 35 用例全过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` 通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build`、`git diff --check` 均通过；build 仅既有 KaTeX/chunk warnings。`package-lock.json` SHA-256 前后均为 `1176cf21fa40c0ddec54adaf769f5ef85d09e296ca2a8c0176da757b0daa8042`，未触碰既有变更。
- Next step: 可选真机目视确认深浅主题下菜单三类中性图标，以及输入框/消息流 chip 的图标中性但 chip 背景与文字仍保留原语义色。已随 canonical-name 合并提交为 `924e8c5`，未 tag、未 push。

- Feature: 侧栏 Projects / Tasks 完整区块拖拽换位并持久化（sidebar-section-reorder，**已完成**）
- Status: done — App 中单一 `SidebarSectionOrder` 状态同时传给桌面/移动侧栏并安全持久化到 `quickforge:sidebar-section-order:v1`。置顶区固定在顶层排序区外；Projects 与现有 conversations UI（ID 映射为 `tasks`）两个完整区块由 `sectionOrder` 动态渲染，并由区块级 `DndContext + SortableContext + SortableSidebarSection` 排序。唯一 activator 是标题旁弱化 `GripVertical` 手柄（PointerSensor 6px 激活阈值支持鼠标/触摸；KeyboardSensor + `sortableKeyboardCoordinates` 支持聚焦后 Space、方向键、Space 排序；aria-label/title 保持与 dnd-kit attributes 一致）；折叠、添加、筛选、菜单按钮无拖拽监听。顶层 ID 使用 `sidebar-section:*` 命名空间，start/cancel/end 状态完整并锁定 x=0/关闭 autoScroll；Projects 内部嵌套 DnD、视口边界、自动滚动限制与 `onReorderProjects` 持久化保持不变。
- Verification: 定向 vitest 2 文件 / 19 用例全过（新增外层 `sectionSensors` 同时含 PointerSensor、KeyboardSensor 与 `sortableKeyboardCoordinates` 的契约测试；现有测试为源码接线契约架构，无低成本真实 DOM 键盘行为 harness，未扩大基础设施）；`npx eslint src/components/sidebar/ChatSidebar.tsx tests/frontend/sidebar-section-order.test.ts` 0 error；`npx tsc -b --pretty false` 通过；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warning）；feature JSON 解析与 `git diff --check` 通过。
- Next step: 无代码 blocker；可选真机分别在桌面/移动用鼠标或触摸拖动 Projects/Tasks，并聚焦手柄后执行 Space → 方向键 → Space，确认顺序同步、刷新恢复、置顶区固定、标题操作按钮不误触，以及项目内部排序继续正常。

- Feature: Workspace Inspector 状态按会话隔离恢复（session-scoped-workspace-inspector-state，**已完成**）
- Status: done — Inspector 展开/收起、可恢复 tabs、`activePanelTabId`、Review 子视图与 Reader 左侧导航显示按 `projectId + sessionId` 写入 localStorage。AgentManager 维护独立 runtime scope：pending deferred session 首次发送晋升真实 session 时沿用原 scope，`WorkspaceInspector` key 不变，内存状态保留，并在真实 `sessionId` 到达后写入真实会话 storage；普通会话切换或确认创建另一 deferred session 才滚动 scope。App wrapper 不再提前重置，底层新建返回 `created/reused/cancelled`。一次性 Inspector request 携带 `projectId + runtimeScopeId`，在发起、聊天文件异步 resolve 完成和 Inspector 消费处三重校验；历史无项目 subagent 请求兼容。pending 本身仍不持久化，旧项目级状态不迁移，整体宽度保持全局。
- Next step: 无本 feature 代码 blocker；已提交为 `d66a3e7`，未 tag、未 push。
- Verification note: 定向 6 文件 / 41 用例通过；相关 eslint 0 error；`npx tsc -b --pretty false` 通过；最终合并工作区 `npm run test` 为 236 文件 / 2020 用例全通过；`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`）；`npm run build` 成功（仅既有 KaTeX 字体解析与 chunk size warnings）；feature/package/lock JSON 与 `git diff --check` 通过。

- Feature: Composer 控件 hover 改为背景反馈且不位移（composer-controls-hover-background，**已完成**）
- Status: done — 保留全局 Composer 按钮 hover 位移规则，仅用精确选择器覆盖 +、权限、模型、发送/停止：五类目标均 `transform:none`；三个中性控件使用 `var(--quickforge-sidebar-hover-bg)` 与合适前景色且不影响 disabled；发送态以 92% primary 混少量 sidebar hover token 保持 primary 层级和 `primary-foreground`；停止态保留既有 hover 背景。Plan、OpenCode config、chip/菜单项未改，model trigger 同时覆盖 OpenCode mode 符合定案。
- Verification: 定向 vitest 3 文件 / 16 用例全过；新增测试 eslint 0 error；最终合并工作区 `npm run test` 236 文件 / 2020 用例全过，`npm run lint` 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功（仅既有 KaTeX/chunk warnings）；feature/package/lock JSON 解析与 `git diff --check` 通过。未改 Wiki/DESIGN_LANGUAGE（纯视觉反馈且现有“hover 有感知、不跳动”规范已覆盖）。`package-lock.json` 无 `package.json` 依赖或版本对应变更，确认为 npm 11.6.2 重算 peer 元数据噪音，未纳入功能提交且未丢弃。
- Next step: 可选真机目视确认深浅主题下 +/权限/模型 hover 与侧栏会话项一致、发送按钮仍明显为 primary、停止态背景变化保留且五类按钮无垂直跳动。已提交为 `b64a4b2`，未 tag、未 push。

- Feature: 修复取消置顶与归档恢复未清除会话状态（fix-session-state-clear-actions，**已完成**）
- Status: done — 按服务端既有三态契约（字符串=设置、`null`=清除、字段缺失=保留），取消置顶 payload 改为 `pinnedAt:null`，归档恢复对 session/metadata 两个 save payload 均写 `archivedAt:null`，避免 `JSON.stringify` 丢弃 undefined 或 batch merge 保留旧值。前端与服务端定向回归测试 27/27 通过，验证序列化 payload、state/metadata、SQLite `pinned_at`/`archived_at` 与 pinned/archive 查询索引状态均正确清除；改动文件 eslint、`tsc -b`、build、diff check 通过。
- Next step: 无代码 blocker；未改 Wiki（仅恢复既有行为契约）。

- Feature: 斜杠菜单技能与子智能体仅显示 canonical name（slash-menu-canonical-name-display，**已完成**）
- Status: done — 普通 command 主文本仍显示完整 usage（如 `/plan [task]`）；skill/agent 行主文本仅显示 `SlashEntry.name`，不再展示 `/skill` / `/agent` 前缀。`usage` 与 `insertText` 未改，因此 `skill ` / `agent ` 类型前缀搜索仍有效，选中和 dataset 仍使用完整 `/skill <name> ` / `/agent <name> `。定向测试 13/13、改动文件 eslint、tsc、build、diff check 均通过；build 仅既有 KaTeX/chunk warnings。
- Next step: 可选真机目视确认三组菜单主文本与 Tab/点击插入行为。已与中性 Slash 图标合并提交为 `924e8c5`，未 tag、未 push。

- Feature: 输入框 @ 引用当前项目文件并与插件能力解耦（file-reference-mention，**已完成**）
- Status: done — `@` 仅搜索当前 QuickForge 项目文件：裸 `@` 和 1 字符只提示，2+ 字符经 300ms debounce 调用严格 projectId 的 files-only mention-search，并支持键盘选择与结构化文件 chip；`+ → 能力` 生成独立能力 chip，不再插入 `@Documents` 或从正文推断。`text`、`contextReferences`、`selectedCapabilities` 已写入 localStorage 草稿（能力防御规范化、按 `type+pluginName+name` 去重、最多 4），附件仍不持久化；文件引用随下一次 prompt 一次性发送，服务端重新校验项目/路径/敏感边界，注入相对路径提示并持久化 history details，失败回滚/retry 链路已覆盖。OpenCode/shared 禁用或拒绝非空引用；mention-search 对未知/已删除 projectId 返回 404 `PROJECT_NOT_FOUND`，普通 workspace search/children 等兼容回退不变。验证：合并定向 vitest 20 files / 242 tests passed；相关 eslint 0；`tsc -b` passed；`npm run build` passed（仅既有 KaTeX/chunk warnings）；`git diff --check` passed。
- MVP 限制 / Next step: 输入框只有 chip、没有正文且没有附件时不能发送；裸 `@` 不提供最近文件；真机目视待用户（键盘选择、深浅主题、草稿恢复、发送后历史 chip 与敏感/错误提示）。

- Feature: Wiki 文档同步——补齐 file-reference-mention / slash-menu-expansion 未提交改动的文档缺口（wiki-sync-uncommitted-features，**已完成**）
- Status: done — 纯文档维护（用户明令禁止修改代码，未触碰任何代码/测试）。对照工作区两条未提交功能链审计 docs/wiki 六个页面并补缺口：context-references.mjs 独立小节（含 CONTEXT_REFERENCE_* 错误码）、utils workspace.mjs 现状行为（大小写不敏感敏感路径 + realpath 复查 + 稳定 errorCode）、src/lib 新增 deferred-session-agent.ts 条目与章节（此前完全未收录）、server-agent/shared-server-agent 补 setPromptMode 泛化与 no-op 语义、slash chip 的 IME/selectionchange/自愈行为更正为最终实现、message-actions 补 decorateUserFileReferences、chat-utils 补新类型与 hasDraft 口径、多文件过期行数与 src/lib 模块总数（28→86）修正。
- Next step: 无。file-reference-mention 功能本体仍由并行会话推进（feature_list 尚未登记该 feature），其收尾时 wiki 已就位，只需按最终实现复核增量。

- Feature: 侧栏“对话”分组标题更名为“任务”（rename-sidebar-conversations-to-tasks，**已完成**）
- Status: done — i18n `conversations` key 中文 ‘对话’→‘任务’、英文 ‘Conversations’→‘Tasks’（唯一使用处为 ChatSidebar 左侧边栏分组标题）；DESIGN_LANGUAGE.md 3 处分组标题示例同步为 Tasks。验证：eslint i18n.ts 0 error；i18n-language-snapshot + sidebar-session-sort-mode 定向测试 11/11 通过。全量 `tsc -b` 失败均为并行会话 file-reference-mention 中间态错误（与本改动无关，已有记录）。未改 wiki（纯显示文案，不影响模块职责或公共入口）。
- Next step: 真机目视确认左栏标题显示“任务”（英文 Tasks）；其余“对话”相关文案（置顶、暂无对话、已归档对话、重命名对话等）按最小范围保持不变，如需一并更名待用户确认。

- Feature: 斜杠菜单扩展——/ 触发指令 / 技能 / 子智能体三类补全 + 方案 A 选中态 chip（slash-menu-expansion，**已完成**）
- Status: done — 两轮定稿实现：①主功能（三分组菜单 + /skill /agent 内部命令 + 懒加载目录）；②方案 A 选中态呈现（用户定稿）：新增 slash-invocation-chip.ts（输入行内联 chip 覆盖层——原文不变仅视觉替换、computed 度量同步、光标对齐补偿 spacer=max(0,前缀宽-chip宽)、IME composition 防护、光标入前缀区自毁、ResizeObserver/scroll 同步）+ command-suggestions 集成（选中即 engage、菜单抑制、手输/草稿恢复自动 engage、Backspace 边界删前缀、Esc 退出）+ message-actions 用户消息前缀 chip 装饰（幂等，复制走原文）。实现取舍：还原机制用 chip 自带前缀标记（Lit 重渲染会替换 container dataset）；selectionchange 自毁不记 dismissed（Esc 才记）；update 校验加词边界（防 /agent explore-deep 误留 explore chip）。input-clamp 既有源码断言随 if 块化同步修正（守卫语义不变）。合并门禁：npm run test 226 files / 1945 tests、lint 0 errors / 1 existing warning、tsc -b、build、git diff --check 均通过。
- Next step: 真机目视留待用户（重点：选中态 chip 与光标对齐、中文 IME 输入、窄列宽换行、退格边界删除、消息流 chip、深浅主题；未知名称提示文本）。**追加修复已落地（用户反馈打字后 chip 消失）**：自愈式三层防御——update 重建被外部移除的 overlay/textarea（isConnected 检查）、selectionchange 降级显示而非自毁（光标回尾部自愈）、自动 engage 兜底；最小复现环境（无头 Edge CDP 全链路：选中/打字/逐字符/IME）无法复现核心链路问题，判定破坏源在真实 app React/Lit 生命周期。门禁全过、dist 已重建。

- Feature: 限制侧栏项目排序拖拽的顶部/底部边界（fix-sidebar-project-drag-bottom-boundary，**已完成**）
- Status: done — Projects 的实际 `overflow-y-auto` 容器成为拖拽预览边界和唯一自动滚动容器；纯函数按拖拽矩形、视口矩形及拖拽期间 `scrollTop` 增量锁定横向并夹紧纵向，覆盖 dnd-kit modifier 后滚动补偿。保留 closestCenter、verticalListSortingStrategy、MeasuringStrategy.Always、拖动折叠会话、排序持久化与视觉样式。定向测试 7/7、改动文件 eslint、tsc、build、diff check 均通过。
- Next step: 无代码 blocker；需手工浏览器验证长项目列表拖到顶部/底部时预览不越界、仅 Projects 滚动且真实边界停止。

- Feature: 暂时下线 generate_image 工具（temporarily-disable-generate-image-tool，**已完成**）
- Status: done — 已从 `workspaceTools` 移除 `generate_image`，Agent 与 `GET /api/tools` 不再暴露；handler、图片生成模块、`directRouteDisabledTools`、会话资产与前端历史结果渲染全部保留。definitions 定向测试 20/20、历史兼容测试 63/63、lint（0 errors / 1 existing warning）与 build 均通过；用户指南和 server/src wiki 已同步为“仅历史会话兼容”。
- Next step: 无 blocker；未创建 commit/tag/push。

- Feature: 删除基础系统提示词中的最简实现与最小局部修改规则（remove-base-prompt-minimalism-rules，**已完成**）
- Status: done — `BASE_SYSTEM_PROMPT` 已删除 “Prefer the simplest solution that satisfies the request.”、“Make surgical changes only.” 和语义重复的 “Make minimal, focused changes.”；保留 “Do not refactor unrelated code.” 等其他规则。新增反向契约测试。验证：系统提示词定向 vitest 1 文件 / 5 用例全通过；未改 Wiki（仅提示词措辞调整，不改变模块职责、公共入口或配置方式）。
- Next step: 无。

- Feature: 准备 v1.7.12 patch release（release-v1.7.12，**已完成**）
- Status: done — 版本与 CHANGELOG 已准备；完整 `npm run test`（219 files / 1865 tests）全通过，`npm run lint` 为 0 errors / 1 existing warning（`server/cloud/identity.mjs:92`），`npm run build` 成功；runtime/offline 包及 `package-offline/shawnstack-quickforge-1.7.12.tgz` 已生成并完成元数据、依赖处理与清单校验。生成目录均被 Git 忽略，release commit 范围为 6 个预期发布文件。
- Release sequence: 本变更用于 release commit，随后创建并推送 tag `v1.7.12`；npm publish 由用户执行：`npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

- Feature: 移除 Workspace Inspector subagent 执行区域最外层卡片外框（fix-workspace-inspector-subagent-trace-outer-card，**已完成**）
- Status: done — `.quickforge-subagent-trace` 根容器仅保留 `quickforge-subagent-trace p-2.5`，移除 `rounded-lg border border-border bg-background/60`，完整执行区域融入 Inspector 消息流；内部 `message-list` 及状态/耗时、process summary 分隔线、思考正文、工具统计、折叠交互和聊天摘要均未改。新增按 class token 提取的最小模板契约测试，避免大段字符串断言。验证：定向 vitest 1 文件 2 用例全过；改动文件 eslint 0 error；`npx tsc -b --pretty false`、`npm run build`、`git diff --check` 通过（build 仅既有 KaTeX 字体解析与 chunk size warning）。未改 wiki（纯视觉外框 bugfix，不改变行为契约、模块职责或公共入口）。
- Next step: 可选真机打开 Workspace Inspector 的 subagent 运行详情，目视确认执行区域无最外层圆角边框且内部过程分组/折叠视觉不变。

- Feature: 修复 subagent 跑马灯剩余宽度与重连重复视图（fix-subagent-marquee-width-reconnect，**已完成**）
- Status: done — `.quickforge-tool-title` 保持 `flex: 0 1 auto`，仅 `.quickforge-subagent-title` 改为 `flex: 1 1 auto`，使跑马灯获得摘要行剩余宽度；`QuickForgeToolMarquee` 重连时复用现有两组完整 view，异常结构才清理并重建，避免 connect-disconnect-reconnect 累计双视图，同时保留 attribute 驱动、动画时序与 ResizeObserver 策略。新增 CSS flex 契约和自定义元素重连行为回归测试。验证：定向 vitest 2 文件 16 用例全过；改动 TS/测试 eslint 0 error；`npx tsc -b --pretty false` 与 `git diff --check` 通过。未改 wiki（局部 bugfix 未改变模块职责、公共入口或既有行为契约）。
- Next step: 可选真机触发多工具 subagent，目视确认窄列宽下跑马灯占满剩余区域、过程分组搬移后仍仅两组视图。

- Feature: ask_user 历史工具消息展开复用回执样式（ask-user-history-review-style，**已完成**）
- Status: done — 非 detailed 展开体复用回执确认步样式：askUserReviewRowsFromDetails 解析持久化 toolResult.details（questions/answers/skipped/skipReason），已回答/跳过渲染只读回执行（复用 buildAskAnswerText 与 .quickforge-ask-review 样式，跳过态带原因行）并省略 output 文本块；detailed / pending / 旧消息维持原视图。验证：定向 vitest 2 文件 23 用例全过、eslint 改动文件 0 error、tsc -b 通过；真机目视留待用户；未提交 git。
- Next step: 真机目视确认（触发一次 ask_user 提交与跳过、重载会话展开历史工具消息观察回执样式/跳过原因行/detailed 对照）。

- Feature: 长输入内容定高收起——聊天用户消息与 subagent 详情任务块统一气泡样式（input-clamp-expand，**已完成**）
- Status: done — 新增 `src/lib/input-clamp.ts`（InputClampController 状态机：定高=computed line-height×6 行+纵向 chrome、data 属性状态、220ms max-height 过渡/展开后置 none/reduced-motion 直切；DOM 装饰入口 decorateUserMessageInputClamp / syncInputClampBoxes，i18n 标签注入式）；任务块模板改气泡视觉+收起结构，详情宿主 updated 后幂等度量；聊天装饰对纯文本 user 消息接入（附件消息不参与）；user-message-container 背景浓度 primary 10%→深色 6%/浅色（html:not(.dark)）3%，渐隐遮罩与展开按钮复用同色变量；新增 i18n expand/collapse 双语。追加真机反馈修复：`white-space: pre-wrap` 收窄到 task/context/expectedOutput 三个值节点，保留输入换行但不再放大 Lit 模板缩进；为共享收起盒注入 30px 流内按钮安全区，仅 overflowing 内容显示，展开/收起均不覆盖正文，fits 内容不留空白。验证：input-clamp 20/20；此前相关面 174、前端全量 87 文件 821 用例、eslint、tsc/build 均通过。真机目视确认留待用户（设计稿 design-mockups/input-clamp-expand.html 可对照，支持 #light/#dark hash 与浓度切换）。
- Next step: 无阻塞；真机目视确认（长用户消息与 subagent 详情任务块的收起/展开、深浅两主题气泡浓度观感）。

## Notes

- 全局 SSE 流首字节延迟修复（本轮）：用户反馈 `/api/agents/events`、`/api/channels/events` "请求时间长、易挂起"。诊断结论：两接口均为 SSE 长连接，DevTools 永久 Pending + Time 增长属正常表象；但 `handleGlobalStream`（server/routes/agent.mjs）`writeHead` 后无任何 body 写入，Node 会把响应头缓到第一次 `res.write`（15s ping 或首条事件）才发出，客户端 `onopen`/TTFB 最长延迟 15 秒——`handleChannelEvents` 因立即写 snapshot 无此问题。修复：`writeHead` 后加 `res.flushHeaders()` 立即刷头。新增针对性测试（tests/server/routes/agent.test.mjs：立即 flush 头 + close 时移除监听并 end），mock 的 `agentEvents` 补 `removeListener`。验证：定向 vitest 14 tests 全过，lint 仅既有 identity.mjs warning。剩余"挂起"因素（范围外，未改）：dev 下 server/Vite 重启断流后 EventSource 指数退避重连在 Network 面板呈现为新 Pending 请求；HTTP/1.1 同源 6 连接上限下每 tab 占 2-4 条 SSE（channels/events + agents/events + 会话级 stream + 设置页再开一条 channels/events），多 tab 会挤占连接池使普通 API 排队。

- 侧栏项目拖拽边界（本轮）：实际依赖为 `@dnd-kit/core@6.3.1`；其 `Modifier` 参数含 `draggingNodeRect`，`autoScroll.canScroll` 签名为 `(element: Element) => boolean`。非 DragOverlay 路径会在 modifier 后把滚动增量加回活动项 transform，因此边界纯函数显式接收拖拽开始后的 Projects `scrollTop` 增量进行抵消，避免自动滚动后预览突破底部。未新增依赖，未修改样式或生成产物。

- generate_image 暂时下线（本轮）：单一暴露源 `server/tools/definitions.mjs` 已移除定义，未删除 `server/tools/index.mjs` handler、`server/image-generation.mjs`、`server/routes/tools.mjs` 的 `directRouteDisabledTools`、session assets、前端 renderer/i18n/process-folding 等兼容代码；历史会话中的既有图片仍可查看/下载。未修改 CHANGELOG、依赖或生成产物。

- v1.7.12 release 收尾完成：`test` 219 files / 1865 tests 全通过，`lint` 0 errors / 1 existing warning，`build` 成功；runtime/offline 目录与 offline tarball 已生成并校验。生成产物被 `.gitignore` 排除，不进入 release commit；release commit 范围为 6 个预期发布文件。发布顺序为：本变更纳入 release commit，随后创建并推送 tag `v1.7.12`，最后由用户执行 `npm publish ./package-offline/shawnstack-quickforge-1.7.12.tgz --access public`。

- Workspace Inspector subagent trace 外框修复（本轮）：仅删除 trace 根容器的卡片视觉 utility，`message-list` 节点、数据属性与全部内部装饰链路保持逐字不变；契约测试只提取命中 `.quickforge-subagent-trace` 的 class 属性并比较 token，既锁定 `p-2.5` 又避免绑定整段 Lit 模板。

- ask-user-history-review-style 实现定案（本轮）：「所见即所提交」——ask_user 历史工具消息非 detailed 展开体复用回执样式而非原始问题清单+output 文本。数据依据：服务端 resolve 即把 {askId, questions(规范化), answers, skipped, skipReason} 随 toolResult.details 持久化（agent-manager.mjs finish()），旧渲染器只用了 timing。要点：纯函数 askUserReviewRowsFromDetails 自包含无外部依赖（可被测试经 ts.transpileModule 提取函数体单测，规避 local-tools 模块级 registerToolRenderer 副作用与 pi-web-ui 重依赖——同 local-tools-lit-reactivity.test.ts 惯例）；skipReason 实际取值仅 timeout/aborted/无 reason（用户跳过），'no-questions' 路径服务端 details 不含 questions（解析返回 null 走兜底原视图），映射 key 仍保留以对齐服务端 reason 枚举；跳过原因行复用 .quickforge-ask-review-answer 样式（视觉贴回执）而非 .quickforge-ask-note（后者 margin-left:auto 右对齐，属 actions 行）。
- diff-display-optimization 实现定案（本轮，并行会话）：用户在对比设计稿（design-mockups/diff-display-optimization.html：现状复刻/方案 A 基础改良/方案 B 字符级高亮三卡 + 亮暗主题切换 + edit 局部修改与 write 新文件双示例，页面内 JS 即 unified→结构化解析原型）中选定方案 B 落地。实现：新模块 src/lib/diff-view.ts（parseDiffRows 行号双侧/剥离前缀/hunk 间隙省略/配对删加行 token LCS 字符级变化段、parseDiffFileInfo 路径上提+新文件判定、乘积>40000 回退整行变化）；local-tools.ts renderDiff 改结构化行渲染并删除内联样式双保险（DIFF_* 常量/diffLineClass/diffLineStyle/styleMap），OpenCodeToolRenderer 复用自动受益；index.css 行号/gap/mark/path 样式 + html.dark 亮绿/亮红文字覆盖（含 diff 徽章与里程计 side——修复暗色下固定深绿/深红文字对比度不足这一现状缺陷）；i18n 新增 diffOmittedLines/diffNewFile 双语；服务端零改动。验证：定向 vitest 4 文件 35 用例全过（diff-view 新增 16）、eslint 0 error、tsc -b 过。真机目视（触发 edit/write 观察新 diff 块、亮暗两主题）留待用户；本会话改动未提交 git。追加修复（用户反馈）：长行横向滚动后行背景不覆盖滚动区——根因是行背景画在 code 单元格盒宽内（列宽=容器宽），溢出文本无背景；修复为整块单一 grid（`3.1rem 3.1rem minmax(max-content,1fr)`）+ 行 display:contents + gap 跨全列，第三列取 max(剩余宽,最宽行) 使全部行背景铺满横向滚动区，设计稿同步修复并加长行示例；验证：npm run build 过 + 无头 Edge 截图像素级确认（绿/红行背景延伸至块右缘）。
- input-clamp-expand 实现定案（本轮）：状态用 data 属性而非 class——Lit 模板重渲染会重写 class 属性，data 属性与注入式遮罩/按钮节点都不在模板 part 内，可跨实时 SSE 更新存活，因此无需按 runId 持久化展开态（元素在即状态在，重开 Tab 回落默认收起）；i18n 标签由调用方注入是硬约束——i18n.ts 运行时依赖 pi-web-ui（pdfjs 引 DOMMatrix），node 环境 vitest 导入即炸，input-clamp 保持零 i18n 依赖才可单测；浅色浓度 3% 的依据：真实浅色 token --background 为纯白（oklch 100%），往纯白混灰极易显脏，深色底则需 6% 才可见，设计稿工具栏留 2–10% 五档供对照；块注释里不能出现 `decorate*/sync*/` 这类写法（*/ 提前终止注释，oxc 解析报错）。设计稿 design-mockups/input-clamp-expand.html 支持 #light/#dark hash 直达与浓度切换，可作真机对照。
- 跑马灯切换滚动实现定案（本轮）：方向/时长/缓动沿用设计稿定稿（方案 A、260ms、里程计同族缓动）；视图元素用 span 而非 div（绝对定位自动块化，语义轻量）；非当前视图整体 aria-hidden（瞬态滚入内容不重复播报，元素本身有 aria-label 覆盖）；finishRoll 用滚动自身文本排程而非 this.text（中途换文结算时 this.text 已是新文本，会错排新当前视图）；同值 sync 增加自愈排程（当前视图完全静止时重排，覆盖 dispose 后同值恢复，旧契约为同值也重排）；旧实现验证页 subagent-tool-marquee-impl.html 标注为 v1 参考并指向新设计稿（其 dist CSS 链接本已失效）。
- subagent 跑马灯间隙保持实现定案（前轮）：不做元素级兜底（空列表时元素整个不渲染，控制器层兜不到），落在数据层——渲染函数改用带记忆数据源，模块级单例与渲染同生命周期；记忆按 runId 隔离（多 subagent 并行不串台），终态一律空列表不消费不污染记忆（恢复 running 间隙仍可回放）；有界淘汰语义对齐 SubagentRunStore（已存在 key 重复 remember 不改变插入顺序）。

- ask_user 评审遗留 ③④ 修复定案（本轮）：③自由输入语义改为可叠加补充——数据模型（buildAskAnswerText/formatAskResult）本就支持 choices+custom 组合，前端清空是多余互斥，删两行即可，文案从『其他想法（自由输入）』改为『补充说明（可选）』对齐语义；④回执直达修改按 backBtn 同构实现（同 renderStep 路径 + disarmSkip，不加动画状态），每行 ghost 式紧凑「修改」按钮（复用 custom-toggle/ghost 的透明底 + hover muted 模式），review-row 改 content 列 + 右侧按钮行布局。

- ask_user 交互评审遗留（前轮只读评审；①②③④已随后续轮次修复，其余未处理待定夺；另有真机反馈两问题——「下一问」与「上一问」分行、自由输入无就近确认入口——已随后续轮次修复：nextBtn 收敛到底部 actions 行 + textarea Enter 确认前进）：⑤30min 超时不可见且吞进行中作答（无倒计时/无提示即 skipped）；⑥刷新/重连后向导进度归零（pendingAsk 恢复但 step/answers 不持久）；⑦命令式 DOM 注入无行为级 E2E（现有测试均为源码字符串断言，按钮 wiring 无真实点击覆盖，含本轮 review 直达修改按钮）；⑧无障碍语义缺失（option 按钮无 role=radiogroup/checkbox、aria-checked，skip 两步确认无 aria-live 播报）；⑨schema 描述宣称 options 与 multiSelect mutually exclusive 但实现允许同用、options>4 超限静默截断；⑩回传给模型的回答文本固定中文（formatAskResult 硬编码『跳过』『未回答』等，英文会话也收中文）。
- 24h 变更风险审查（本轮，只读）：核心发现 H1——存储 v2（3493aeb）v11 迁移只 RENAME 旧表不搬数据，启动导入仅"新表空且 JSON 树有会话文件"才跑、否则静默跳过，全仓库无任何 `*_v10_backup` 读取者：升级前 SQLite 权威且 JSON 副本缺失/不完整的用户会话列表为空、零告警，数据锁死 backup 表（文档自认升级路径=删库重导，但代码零防护零校验）。M2——导入 `count>0` 即永不重跑，首导 skipped 条目永久不可见（修复源文件后自动链路不会 re-run，只能人工删库）。低危：`scripts/session-index-query-benchmark.mjs:7` 悬空 import（canonicalSessionMetadata/sessionMetadataDigest 已从 session-index-service 删除，脚本一跑即模块加载报错）；ACP stdio 入口（acp/server.mjs）不跑 JSON 导入，空库+仅 JSON 时会话列表为空无提示。前端未提交改动两个已核实缺陷：diff-counter `?running` 布尔 attribute 绑定（lit 真值渲染为空串 attribute）与元素侧 `getAttribute('running')==='true'` 不匹配→running 呼吸动画永不生效（对照 quickforge-elapsed-time 的 `running=${String(...)}` 字符串绑定即为正确写法）；OdometerDiffCounterController 整体覆写 `root.className` 丢失模板赋予的 `quickforge-tool-meta-hover shrink-0`→±行数计数器常显（原 hover 显示）且窄布局可被压缩。权限绕过（write/edit 的 onUpdate 在全部路径校验后、partial 无 diff.text 全文）、资源泄漏（新模块 dispose 路径完整）、跨端兼容（scrollend 有 900ms 兜底）未发现高置信问题。M1 已修（见前轮记录），其余未处理待定夺。
- M1 修复实现定案（本轮）：与模块既有单条目韧性语义对齐而非加开关——桶级 metadata 读取失败降级为空 metadata 继续，比跳过整桶更好（正文仍在、可推导），比中断更好（不再 STARTUP_FAILED）；diagnostics kind=metadata-bucket-error 含 scope/projectId/message，warn 日志同字段。

- ask-user-tool 真机两缺陷修复（本轮，用户反馈）：①卡片误显"当前视图无法作答"——propsRef 每渲染整体重建的同步 effect 漏了 onAnswerAsk，首帧后被覆写为 undefined 触发禁用判定；已补字段并加回归源断言（定位 propsRef effect 块内必须含 onAnswerAsk）。②ask_user 工具消息不走设置的工具显示模式——此前未注册渲染器落进 pi-web-ui 默认工具卡；新增 local-tools.ts AskUserToolRenderer（结构与 LocalWorkspaceToolRenderer 同构：toolDisplayMode==='detailed' 才出 input JSON，summary=「N 问 · 首问」，非 detailed 展开时直接列问题清单，output=回答文本，detailsOpen 记忆、isCustom 防默认卡壳）+ ask_user 问号图标 + i18n askUserSummaryCount + .quickforge-ask-tool-questions 样式。验证：定向 ask-user-card(9)+local-tools-lit-reactivity 全过、前端全量 760 用例过、lint 0 error、build 过。
- ask-user-tool 实现定案（前轮）：复刻审批链路但 resolve payload 扩展为 answers[{choices,custom}]；ask_user 无 toolHandlers 入口（agent-manager wrapAskUserToolDefinition 拦截绑定会话，仿 run_subagent）；单问题 schema 兼容（normalizeAskQuestions 接受 {question,options} 简写）；纯函数 normalizeAskQuestions/formatAskResult 放 ask-store.mjs（零依赖可单测）。前端卡片与审批卡同族注入（data-ask-id + displaySignature 去重，向导内部 DOM 变更不触发重建）。

- diff-odometer-counter 实现定案（本轮）：「实时」的落点是工具开始执行即算 diff 并立即发 partial（本仓 edit_file 是单次 oldText→newText 替换、write_file 单次写入，无更细中间态，不伪造数据）；partial 与 end 几乎同帧到达，实际观感=计数器从 0 逐位滚动到最终值的里程计动画。计数器列右对齐保 DOM 稳定（transition 不被打断），位数增长 unshift 新列到符号之后、380ms 后清 enter 标记防重放。设计稿 design-mockups/diff-odometer-counter.html（可重播演示）。

- subagent 跑马灯实现定案（本轮）：内容=「工具名 · 参数摘要」（用户选定，复用 summarizeParams，80 字符截断）；滚动=运行中自动循环（用户选定，非 hover）：35px/s 线性滚动→端部停顿 1s→ease-out 回弹（240–500ms 按时长比例）→起始停顿 1s→重复，起始延迟 400ms；text 变化才重建动画（SSE 150ms 节流同值刷新不打断）；结构=QuickForgeToolMarquee 自定义元素（attribute 驱动，仿 quickforge-elapsed-time，Lit 重渲染保实例）+ ToolMarqueeController 纯逻辑（DOM/定时器/动画注入，node 环境可单测）。「不遮挡」落实：跑马灯 flex:1 1 auto + min-width:0 只占标签与状态间的剩余弹性空间，列宽收缩时先自行退让（实测 340px 下标签仍完整可见带省略号）。
- 模块拆分（本轮）：summarizeParams 从 local-tools.ts 提取为 tool-param-summary.ts（纯函数化，附带 normalizeToolArguments/truncateSummary），local-tools 改 import 行为不变；subagent-run-detail.ts 新增 currentSubagentToolSummaries（pendingToolCalls × traceMessages toolCall chunk 交集，JSON 字符串 arguments 兼容）。
- 验证环境教训（本轮两条）：①本机 8931/8932 端口已有既有 http-server 占用（服务 dist/），python http.server 指定端口前必须 netstat 确认空闲，否则响应错位极难排查；②验证页连续快速拖宽度后动画计数为空是 RO 重启与 400ms 起始延迟的测试竞态（每次 RO 触发 sync(true) 会清掉未触发的起始 timer），干净加载后动画正常——宽度突变后不要立即断言动画状态，等 ≥500ms。
- 既有 lint warning（不变，待择机修复）：server/cloud/identity.mjs:92 no-useless-assignment。

- 回到底部按钮实现定案（本轮，设计稿经用户选定居中形态后落地）：交互——距底部>280px 淡入、<120px 淡出（滞回区间防临界抖动）；点击平滑回底（scrollend + 900ms 兜底，途中 wheel-up 视为用户打断、不恢复自动跟随，prefers-reduced-motion 直接跳底）并经 onJumpSettled→scrollSync.enable() 恢复尾部跟随（回调内再校验距底 ≤120px 才恢复，防打断后误拉回）；不在底部期间 assistant message_start 累计未读徽标，回底或点击清零，aria-label 随未读数切换（i18n en/zh 双 key）。视觉——复用 composer 卡片 token（78% border 混合、card 92% 透明混合、backdrop blur 12px、降一档浮层阴影），icon-only（arrow-down-to-line）居中悬浮于 .quickforge-composer-shell 上方 10px（shell 补 position:relative 作锚点，left/right:0+margin auto 居中，transform 留给出入场动画）；空会话态与 readOnly（dock 被移除）自动不渲染；html.dark 下徽标用亮 emerald。接入点——decorate() 尾部 setup()（与 scrollSync.setup() 同帧，幂等）；显隐独立监听滚动容器 scroll 事件，不侵入 scroll-sync 内部状态。
- 单测抓到实现 bug 一枚（记录）：createButton 内 renderBadge() 在模块级 button 赋值前调用导致初始 aria-label/title 缺失——构造函数内先赋值再渲染即可；测试驱动发现的顺序依赖问题值得保留该用例。
- 思考块高度封顶设计定案（本轮）：根因——thinking-block（pi-web-ui Lit 组件）展开后 markdown-block 全量渲染且无任何高度约束，装饰层折叠只是 display:none 开关，展开时全部高度进入消息列表文档流撑高 agent-interface 滚动容器；流式期间外层过程组默认展开，长思考边生成边撑长页面并触发自动滚底跳动。方案为纯 CSS 单点改动（复用 diff 块 28rem/code-block 24rem/压缩文本 18rem 的 max-height+overflow 先例）；用户确认两项参数：上限 min(60vh, 20rem)（小屏按视口收缩，兼顾 Capacitor Android）、流式期间保持阅读位置不做终端式跟随。交互细节：overscroll-behavior: contain 使思考块内滚到头不连锁滚动外层聊天；标题行在滚动容器外，折叠按钮始终可见；markdown-block 自带 display:block（connectedCallback），max-height 天然生效。
- 验证环境教训：临时 http 服务器给 .css 返回 text/html 会被浏览器 MIME 严格检查拒绝解析（styleSheets 规则数为 0 且 computed style 全默认），排查选择器匹配前先确认样式表实际解析条数。
- 发送按钮等待态设计定案（前轮）：分析确认按钮原为发送↑/停止■两态、无旋转态——prompt() 乐观同步置 isStreaming 使点击后下一帧即翻 Stop，无可感知空档；等待期反馈原仅由三点气泡承担。用户在小样（三方案：A2 方块步进/A1 方块平滑/B 环形）中选定 B 环形——与审批按钮 loading 完全同构、全应用单一旋转节奏。实现要点：::before 环形用 margin 居中而非 transform（transform 归 spin 动画所有，若用 translate 居中每圈末尾会跳位）；等待与生成的区分依赖 assistantWaitingActive（首个 assistant 文字增量即复位），agentic 循环后段工具阶段保持静止■（保守设计，避免图标反复起停）；等待期点击仍为 abort、aria-label 保持 Stop。附带补上了 send-stop-button 的首个单测（此前该模块零测试覆盖）。
- 遗留（记录不处理）：根目录空目录 design-preview/ 因句柄占用未能删除（内含文件已清空，重启后可删）；既有 lint warning server/cloud/identity.mjs:92 不变。

- 存储 v2 收尾（本轮）：重构主体（schema v11 三表/repository/service/importer/mirror+phase+cutover 链删除/auto_vacuum 回收）已在前序会话完成并全量测试通过，本轮补齐文档与簿记：新增单一事实文档 `docs/architecture/session-storage-v2.zh-CN.md`（背景写放大 5 份、三表布局、写入/删除/启动导入路径、删除机制清单、逃生通道、已知取舍、新旧对比表）；v1"当前架构"文档标注为历史参考；recovery runbook 顶部加 v2 修订提示（恢复路径=备份 restore 或删库重导，不再有"降级回 JSON 权威"）；sqlite-storage-foundation §4 补 v11 一段；wiki server README 存储层描述段全面更新为 v2 现状。后续候选（记录在案）：①S2b 发现 `repository()` 先求值 `getSqliteStorage()`——通过 configureSessionStateService 注入 repository 的测试仍需 SQLite 已初始化，若要纯内存 repository 测试需拆开两步（当前测试均先初始化 storage，未构成实际问题）；②`*_v10_backup` 六表稳定观察期后以独立 migration DROP 回收空间；③listPage lastModified 的 json_extract 表达式索引；④share/lan mirror 链后续同类清理候选。
- 存储重构动机留档：旧设计同一数据落盘 ≈5 份（state_json 巨列全量重写 + session_index 派生表 + mirror outbox 完整副本 + drain 物化 JSON 文件 + WAL/自由页永不回收），真实库膨胀至 2~3GB；v2 后每条数据一份、删除即时 incremental_vacuum 归还 OS。用户升级路径：删库文件重启即从 JSON 一次性重导（空库 + JSON 存在时启动链自动触发，每会话一事务幂等）。
- session 分页查询热路径优化（前一轮）：根因=每请求固定全量开销而非分页 SQL（本机库 24 会话 authoritative 纯 SQL 亚毫秒；大库 2415 会话时线性放大且同步阻塞事件循环）：verifyIntegrity TTL 5s 即做 session_states 全表扫+逐行 JSON.parse/SHA-256+session_index 两遍全表且无并发去重；syncMetadataCommit 置空 lastVerifiedAt 使下次分页必触发全量校验；analyzeQuery 每请求 2 条 GROUP BY 全表聚合。修复（session-index-service.mjs，不改导出/降级语义）：TTL 5s→60s + in-flight 共享去重；增量同步成功后保留校验时间戳（成功路径已全量重算 index digest）；analyzeQuery 按索引内容代际缓存（rebuild/增量同步失效，limit/offset 不参与键）。新增 5 测试；文档性能注记入 session-index-query-migration F8 节。基准留档：1k 行 0.8ms / 50k 行 93ms（OFFSET 翻页线性 → keyset/可见性列进索引为中期候选）。〔注：v2 重构后 session_index 派生表与该校验机制已整体退役，本条留作历史〕
- 测试观察（记录不处理）：session-state-background-migration.integration.test.mjs 用例 a) 出现过 EPERM rename %TEMP% .tmp→目标文件（Windows 文件锁/AV 嫌疑）；取样：带改动 4 跑 1 挂、stash 本次改动后通过、恢复后连跑 3 次全过——判定环境级 flaky 候选，与本次改动无关（未触碰 writeJsonAtomic 路径）。
- 后台迁移全部落地（前一轮）：启动秒级 READY（会话域退出维护窗口，窗口仅剩 scheduled-runs/share/lan 三小域秒级）；三机制实现见 feature_list 的 6 个 impl-bg-migration-* 条目。核心链路：index.mjs 按 phase 路由（resolveSessionStateStartupRoute）→ startSessionStateBackgroundMigration（维护锁全程持有）→ 逐桶 alignBucketStream（不 enqueue mirror）→ 收敛循环（逐桶只读 digest 对拍内存 Map）→ idle 信号（SSE 流计数+写静默）→ 切换窗口（全局 persist 锁→barrier→最终对拍→promoteAlignedSessionState→drain）。备份在 idle 期异步（复验已登记可复用、有界重试、与切换解耦）。
- boot 竞态修复（本轮追加，commit 1e959d4 已推送）：用户另一台机器部署新版后 UI 无法启动只显示错误卡——根因是 boot 阶段（initializePiStorage/设置校准）在迁移门之前发业务请求，撞上 migrating 窗口 503 落进通用错误卡。修复：catch 探测 migrating 转入迁移门（进度视图）+ ready 后自动重试 boot；waitForMigrationSettled 容忍单次轮询失败（连续 3 次才抛）。
- auto-archive 启动 49s 阻塞优化（本轮，quick_check 修复后用户机器二次实测发现）：三域 check 27ms/8ms 通过后仍有 49s 零日志空洞、浏览器请求堆积至同毫秒簇放行——事件循环被同步阻塞。根因：startAutoArchiveRunner 启动链末尾立即首次归档，扫描阶段逐候选 readSessionValue 全量加载正文（~2400 会话 2.9GB）。修复：元数据优先扫描（activityTime(metadata) 可判定零正文读；null 才回退；事务内全量复核保证归档正确性不变）+ 归档循环间 setImmediate + 首跑延迟 30s。附带根治 writeJsonAtomic 的 Defender rename EPERM 竞态（有界重试+失败清 tmp，本机测试 flake 与历史 tmp 残留共同成因）。用户机器预期：启动链 complete 从 lan-check 后 ~49s 降至秒级。注意：auto-archive 若有历史积压，会在启动 30s 后开始逐个归档（已让出循环，前台无感）。
- session_states 元数据覆盖索引（本轮终局修复）：启动分段计时实测——reset-stale-task-statuses 零写入仍 45.2s、session-index 同一扫描仅 1.5s（冷/热差）——定案根因：WITHOUT ROWID 表行内 state_json（GB 级）在 metadata_json 之前，读靠后列必须穿溢出页链，SELECT metadata_json 隐式读全库 2.9GB，每进程首次冷读必付。migration v10 覆盖索引（含 metadata_json/metadata_digest）使元数据读取 index-only（EXPLAIN 四形态验证命中），全部元数据热路径（readSessionMetadataBuckets/metadataBucketChanges/readSessionStateStore('sessions-metadata')/auto-archive 扫描/index 服务 readSnapshot）受益；升级后首启建索引一次性慢（listen 前），之后启动预期 reset-stale/session-index 均毫秒~秒级。纠正：前两条 49s/50s 空洞曾误归因 auto-archive（次要真实问题），大头一直是本条；剩余可见慢步骤为 session-state-cutover ~1.6s 与 session-index 热 ~1.5s，可接受。
- 启动 quick_check 检查税优化（本轮，commit 3d1ae01）：四域启动检查各自对同一 2.93GB 库文件全量 PRAGMA quick_check 3~4 遍（用户机器实测 session 16s+share 7s+lan 6.6s≈30s）。runSharedSqliteQuickCheck（database.mjs）：进程内按库路径去重 + marker 文件 7 天降频 + 维护端点/env force 逃生口；预期用户机器启动检查税 30s→秒级（更新后首启仍真扫一遍写 marker，之后 7 天内跳过）。已知取舍：备份导出/离线工具的 quick_check 也走 7 天门（内容级 count/digest fail-closed 校验不受影响，bit-rot 影响内容会被 digest 检出）；marker 不绑定库文件 mtime/size，外部替换库文件盲区最长 7 天（force 或删 marker 消除）。
- 启动 OOM 生产事故与修复（本轮，重要）：用户真实大库（2.93GB SQLite、authoritative 相位、今日两次全量 cutover 后首次进入 authoritative）每次启动 38 秒后 4GB 堆 OOM 崩溃，进程死掉→端口无监听→界面"无法启动"。取证链：四域 check 全过（authoritative）→ lan-access 之后 8 秒内崩 → sw.js 被同步阻塞 6.6s → 堆 4095MB Mark-Compact 全失败。根因：启动链 resetStaleTaskStatuses→atomicUpdate('sessions-metadata')→atomicSessionMetadataBucketUpdateViaFacade→readSessionStateStore('sessions-metadata')→repository().exportSnapshot() 全库（state_json+session_messages 重组）载入。修复三处同病灶：①readSessionStateStore('sessions-metadata') 复用 readSessionMetadataBuckets 只读 metadata_json（JSON 时代该 store 本就 metadata-only）；②metadataBucketChanges（updateSessionMetadataBucket 底层）current 构建弃用 exportSnapshot（不改则逐桶调用仍 OOM）；③atomicSessionMetadataBucketUpdateViaFacade 逐桶 RMW（顺带修掉全 scope 合并写 global 桶的跨桶混写错误，project 会话元数据不再错挂 global）。附带收益：readStore('sessions-metadata')（acp 列表/backup/auto-archive 路径）权威相位也变 metadata-only。教训：小测试库测不出 GB 级库的内存放大路径；exportSnapshot 全库快照类 API 只允许出现在维护锁内低频路径（restore/import），任何启动链/业务链路禁用。
- 测试观察（记录不处理）：agent-manager.external-sync.test.mjs 的 "keeps transient ACP context..." 用例在全量并发下出现过一次失败（单跑与全量复跑均绿），疑似 flaky 候选，后续择机排查。
- 集成测试发现 2 个真实缺陷并已修复：①严重——barrier-parked 业务写在 promote 后重放仍走 JSON 路径导致权威源丢写，storage.mjs 全部会话写入口补"执行时 facade 复检重路由"（*ViaFacade 助手，嵌套 metadata 写同覆盖）；②background.state 缺 converging（补 setState）。另理论风险已记录：parked 旧写覆盖 promote 后新写的窗口被"微任务级联+promote 要求空 mirror 队列"封闭，若后续引入窗口内宏任务间隙需复查 runSwitchWindow 的 release 顺序。
- 设计→实施主要偏差（已记入设计文档 §11）：promote 走 repository 内部 updateStorageState（避免循环依赖）；barrier park 从 drain 完成后生效（防嵌套入队自锁死锁）；backup.verify 无 sha256（避免 1.4GB 双读）；"写时间戳未变跳过重读"优化未实现（正确性优先）；cutover 模块 cutover_running 恢复分支保留（新链不再到达，维护工具可直调）。
- cutover_running 存量残留清退与双进程 status 可见性（设计 §10.1/§10.2）已落地：残留由后台任务锁内复位（backupFile 保留、phase.reset 日志）；锁忙 aborted 快照携带 lockOwner/lockOwnerPid/lockFencing，第二进程经 migration-status 可见。
- 未做（记录在案）：慢盘/大库内存上界断言（需大库装置，归 §10.3 真实库实测待办）；writeSessionValues/restore 类写在维护锁内运行无 parked 场景未加重放路由（如需防御性覆盖后续单独评估）。
- 前一轮设计阶段的产出与决策详见 git 历史中 feature_list.json 该轮提交；评审实施（review-* 11 feature）遗留事项不变：⑤门禁豁免不一致、⑥backupFile 复用旧快照、P2 减 pass 快照方案、"彻底不碰 JSON"三处架构依赖、前端 dispose 通知、agentSessions LRU、SQLite 大事务拆分等范围外候选。

## Notes

- 评审建议全部实施完成（本轮，11 个 feature 全 done，详情见 feature_list.json）：①split 中部编辑采样校验（body-only 多一次主键单行查询，顺带修复 split body 双重表示的预存 bug：normalizeRecord 剥离 split 标记 body 的内联 messages，旧库下次保存自愈）；②persist 冲突表面化（session.persistDegraded + SSE persist_degraded 事件 + 前端 panel-decoration 警告条，persist 成功自动清除；仅内存标记重启不恢复，语义合理）；③synchronous 实测定案并落地切 FULL（database.mjs，health 摘要同步）；④fail-closed 恢复指引（STARTUP_RECOVERY_GUIDANCE 附加段 + 一页式 runbook docs/architecture/session-storage-recovery-runbook.zh-CN.md + App.tsx 错误页 pre-wrap）；⑤保存热路径优化（IN 分批去重 O(增量)、readLastMessage 替深 OFFSET、WeakMap<handle,Map<sql,stmt>> 语句缓存）；⑥drain 同会话合并 + mirrorQueueRevision 取代跳过 + mirror 永久设施定位入文档（F8 §4.1）；⑦权威相位 index 就绪判定切 SQLite 源（readAuthoritativeSessionMetadataBuckets，index.mjs 与 acp/server.mjs 均切换；digest 口径与 upsertIndex 天然同构未动体系）+ F7 退役计划入文档；⑧当前架构单一事实文档 session-storage-current-architecture.zh-CN.md + 完整 phase 状态机 SVG；⑨cutover 恢复备份复核（verifyRegisteredCutoverBackup 包络 count/digest 对拍，损坏重写；不含中段 bit-rot，登记时未存文件 sha256 属范围外）+ POST /api/storage/maintenance/verify-session-integrity（full 逐行校验，维护锁内，409/423 门控）+ restore/roll-forward 后 checkpointWal；⑩mirror 死信 MIRROR_MAX_ATTEMPTS=12（diagnostics 暴露 mirrorDeadLetters，re-enqueue 复活）+ 无 id 消息整批 digest 重试去重 + 墓碑 GC 语义固化（现有 save 路径本已删同 key 墓碑，补注释+测试）。
- synchronous 实测定案（本轮）：新增 `scripts/sqlite-synchronous-benchmark.mjs`（2000 次单事务 upsert + 单事务批量 2000 条，state_json≈50KB，3 轮中位数）。本机（Win11/Node v24/SQLite 3.51.3/NVMe）实测：小事务 NORMAL 0.531ms/op vs FULL 0.989ms/op（1.86x，绝对增量仅 0.46ms）；批量导入 1.00x（fsync 被单事务摊薄）。定案：切换 FULL，结论与实测表已写入 `docs/architecture/sqlite-storage-foundation.zh-CN.md` §3.1；server 代码 PRAGMA 切换已由 `review-switch-sqlite-synchronous-full` 落地（done）。
- 会话 SQLite 迁移整体设计评审（本轮，纯文档产出）：`docs/architecture/session-sqlite-migration-design-review.zh-CN.md`（含写路径 SVG 图 `docs/architecture/assets/session-sqlite-write-path.svg`）。双路评审（设计文档 + 源码核查）+ 三个存疑点源码实证：①phase 切换与导入确认同事务提交，无中间态；②备份登记必在校验后，无"登记坏备份"窗口（残余低风险：登记后外部损坏不复核）；③权威态查询 fallback 读 SQLite 而非过期 JSON，无正确性问题（仅 pending 窗口性能降级 + ~1s 缓存瑕疵）。评审主要发现：高优先级——split 会话中部原位编辑静默丢弃（messageStoragePlan 尾 digest 启发式盲区）、persist 冲突三次重试后静默放弃（仅 warn 无用户反馈）、`synchronous=NORMAL` 丢失窗口无论证、fail-closed 启动缺用户可恢复通道；中优先级——append 去重 O(存量)（repository.mjs:361）、尾行深 OFFSET（service.mjs:327）、mirror drain 抵消 split 增量收益、exportSnapshot 被元数据操作调用、JSON mirror 双写无退役路线、F7 shadow/TTL 机制 F8 后冗余、文档碎片化。改进建议 10 条按优先级见报告 §7；本轮未改任何代码。
- P1 启动维护窗口（本轮）：listen 前仅 `ensureStorage()+initializeSqliteStorage()`（gate 与 migration-status 依赖 DB；失败置 failed 不退出），其余启动链逐字保留移入后台 `runStartupInitialization()`。维护窗口 gate 在 index.mjs `/api/` 分支 handleApi 之前：白名单（GET /api/health、GET /api/migration-status）放行，其余 503 `{ok:false,maintenance:true,state}`+Retry-After:5；非 /api（静态、/share/）放行。health 三态：migrating→`{ok:true,maintenance:true,...完整状态}`（getSystemStatus 异常降级精简）、ready→原样、failed→`{ok:false,startupError}`（进程存活，waitForQuickForge 持续轮询到超时保持"启动失败"语义）。listen 回调里的云 agent 改为等启动链 settle 后再起（failed 跳过），避免维护期撞 503。
- fail-closed 语义变化（有意）：从"进程退出"改为"服务存活但拒绝业务 API"。收益：desktop 窗口/CLI 已开的浏览器不再直接消失，用户看到错误页（含 startupError 原文）而非黑屏；代价：CLI spawn 模式失败表现为 5 分钟超时而非快速失败，需 qf stop/restart 恢复。架构文档中"block startup"表述的实质（阻止业务使用）未变，wiki server/README.md 与 routes/README.md 已更新说明新机制。
- P0 四项修复（本轮）：① scheduled-runs 偷锁双条件（`!expired || stalePid===null || pidAlive` 均不偷，与 session 域一致，复用注入 now()）；② retainedMaintenance 在 finally 正常释放分支复位（retain 错误路径不动，DB 锁行兜底 isScheduledRunsMaintenanceActive）；③ authoritative 分支拆两段 try：JSON 读取/slim 失败→diagnostic+warn 降级继续启动，health 失败→保持 throw blocked；④ session/share/lan cutover 补 logger（开始/完成/晋升/回退/fail-closed error/fallback warn，options.logger 注入模式），index.mjs 启动链 catch log.error+flushLogger。旧测试"authoritative JSON 校验失败 fail closed"语义已改为 fail-open（JSON 是非权威 mirror），新增 health 失败 fail-closed 用例补齐覆盖。
- 前端迁移进度（本轮）：`src/lib/migration-status.ts`（fetchMigrationStatus 网络/非200/坏 payload→{ok:false}、migrationPhaseStage 映射、waitForMigrationSettled 可注入轮询门支持取消）；useAppBootstrap 在 initializePiStorage 后插迁移门（migrating→setMigrationStatus+2s 轮询、ready→清状态继续原 boot、failed→{kind:'migration',detail:startupError} 错误），catch 里补一次 migration-status 探测覆盖"页面加载时服务端已 failed"路径；startupError 从 string 升级为 {message,kind,detail?}（注意：这是 hook 返回值形状变更，既有测试已同步加 mock）。MigrationProgressView 复用 splash 容器/图标动画（抽 StartupSplashIcon 共用），4 域状态点遵循 DESIGN_LANGUAGE 强度梯（border→foreground 呼吸→实心）。仓库无前端渲染测试先例（全 mock react 逻辑 harness），组件无渲染断言，逻辑由单测覆盖。
- 已知取舍/遗留：迁移轮询期间单次网络抖动会落错误卡片需手动 Retry（可后续加连续失败计数）；WebSocket upgrade（/api/terminal/*）未 gate（前端就绪后才连，风险低）；failed 时 CLI 5 分钟超时表现（见上）；migration-status 各域 count 字段名不同（runCount/stateCount/shareCount/lanTokenCount）。
- 语句复用优化（本轮早些）：cutover 导入（`replaceAll`/`replaceAllStream`）原在循环内每行 `db.prepare()` 重新编译 SQL。改法：SQL 提取为模块级常量（`UPSERT_SESSION_INDEX_SQL`/`ENQUEUE_SESSION_MIRROR_SQL`/`SHARE_SESSION_UPSERT_SQL`/`ENQUEUE_SHARE_MIRROR_SQL`），函数追加可选 `statement = null` 参数（不传走原路径，运行时调用方零影响），导入循环前 prepare 一次复用。node:sqlite `StatementSync` 与事务状态解耦，BEGIN 前/后 prepare、事务内多次 run 安全。未改 `lan-access-repository.mjs`（其 replaceAll 无循环，各函数只调用一次）；`replaceTokens`（DELETE+INSERT 各一次/调用）与 `writeMessages`（split-message 记录才触发）保持不动——share 域规模小/不在 cutover 主路径，收益趋零。
- cutover 性能调研结论（本轮，指导后续方向）：瓶颈在 CPU 侧——session-state 整库被完整 parse+规范化+digest 4 遍（双读校验/备份/导入），每条记录含 2×structuredClone + 2×JSON round-trip + 2×sha256；磁盘侧已被单事务 all-or-nothing + WAL + synchronous=NORMAL 规避（整个迁移只 COMMIT 时一次同步）。"分批读+分批插"打不中瓶颈：分页提交破坏可回滚语义且无 I/O 收益，分批读不减少 parse 次数。数量级收益要靠减 pass（文件级快照替代双读，需重新论证并发安全，属独立 feature）。
- SQLite/JSON 启动兼容设计评审（本轮产出）：遗留 bug 清单中 ①启动失败黑盒 ②scheduled-runs 锁偷锁只查 pid ③retainedMaintenance 泄漏 ④authoritative 读 JSON fail-closed 扩大化 已由 fix-cutover-startup-bugs 修复；仍未修：⑤门禁豁免不一致（调度 gate vs backup-export 豁免）、⑥失败回退后 backupFile 复用旧快照可能错位（语义待定/低概率，择机处理）。体验方案（listen 提前+进度 UI）已由 startup-maintenance-window 落地；"彻底不碰 JSON"仍受三处架构依赖制约（session_index 权威源仍是 JSON metadata、scheduled-tasks metadata 永久驻留 JSON、mirror outbox 持续写 JSON），属独立 feature。

## 并行会话记录（rebase 整合）

- ✅ 启动慢根因（远端会话 fix-startup-cutover-replay，修复代码未推送，**已在本仓库按其状态文件描述重建并验证通过**）：`session_storage_state` 卡在 `json_authoritative`（8-18 起 `Session state replace digest verification failed`），每次启动重放完整迁移（4 遍 1.6GB JSON 全量流读 + 1.4GB 备份写 + SQLite 全量导入再回滚）。排序不一致是核心 bug：JSON 源侧 summary digest 按 sessionId `localeCompare` 排序（`buildSessionJsonSnapshot`/`createStreamingSessionSource`/`writeCutoverBackupStream`），而仓储侧 `digestFromLines`/`verificationDigest` 按**整行字节序**排序。global+project 混合桶时两种排序必然交错不同（实测真实数据：`76eadc82…` vs `a40c7ee7…`），`replaceAllStream` 末尾 digest 校验必炸。现有测试数据集恰好两种排序同序，从未暴露。修复已在本仓库重建落地：`digestFromLines` 导出为唯一 canonical 实现，cutover 源侧三处（`buildSessionJsonSnapshot` / `createStreamingSessionSource` 的 `getSummary` / `writeCutoverBackupStream` 双 summary 校验）全部改用（records 迭代顺序与流式 bucket 内排序保持原行为，仅 digest 统一）；repository 新增 `checkpointWal()`（`PRAGMA wal_checkpoint(TRUNCATE)`，返回含 busy 的 pragma 行），两个 promote 成功点晋升 authoritative 后经 `checkpointWalAfterPromote` 调用（try/catch，失败仅 log.warn 不阻断）。新增混合桶测试（global 'Zeta' + project 'alpha'，localeCompare 与字节序不同序）：改源码前精确复现 `Session state replace digest verification failed` 回退 json_authoritative，改后端到端晋升 authoritative。与维护窗口互补：新版首次启动一次性完成迁移（预计 1-2 分钟）期间用户看到进度页。
- 事故记录（远端会话，已回滚）：验证时一次 `QUICKFORGE_DATA_DIR` 未设成功的 node 脚本误在真实库执行了 cutover——digest 修复实证生效（首次成功 commit，2415 会话入库），但违反独占前提（旧服务还在 JSON 模式写数据），随后手动补救被用户叫停。已将 `session_storage_state` 回退为 `json_authoritative`（JSON 权威未动，quick_check ok，5176 服务存活）；SQLite 残留条目会在下次 cutover 的 replaceAllStream 中整体清空重写。教训：对真实数据目录执行任何写路径前必须显式断言 dataDir 非默认值。
- 用户数据现状（远端会话记录，择机清理）：`conversations` 4.36GB 中 2.75GB 是 1045 个原子写 `.tmp` 残留（JSON 模式高频全量重写的副作用）；WAL 2.8GB 待新代码 cutover 成功后自动 TRUNCATE。npm 全局包（旧代码）在发布新版前仍是慢启动。
- 桌面端与 `qf` 共用 `server/index.mjs` 初始化链，同根因同修复；桌面端 `ready-to-show` 策略使首屏 6.5MB modulepreload（pi-web-ui 3.75MB + pi-ai 1.6MB）也计入可见时间（独立遗留项，未处理）。
- 字体滑块闪烁（远端会话）：滑块 @input 每步同步 `applyFontSizeSettings` 改 root font-size 造成整页 reflow；修复为 RAF 合并 + dirty-check + 仅 interface 字号变化时派发事件。
- 归档删除（远端会话）：设置页永久删除走 batch 两操作事务，旧 `applySessionBatch` 对 metadata delete 无条件拒绝；修复为配对 metadata delete 视为 no-op 放行。删除后复活路径已堵（路由删持久化前先 destroyAgent）。遗留竞态（范围外）：删除请求处理期间另一请求恰好 restore 同一 session 仍可能复活，彻底堵住需 tombstone 机制。

- 中止双消息根因（本轮，只读分析未改码）：用户点停止后同时出现「请求已中止」+「错误： Request was aborted」。链路：pi-ai 把中止定稿为 stopReason="aborted" 且塞 errorMessage="Request was aborted"（anthropic-messages.js catch 分支）→ pi-agent-core turn_end 无差别写入 state.errorMessage → agent-manager agent_end 订阅（agent-manager.mjs:2111）见 state.errorMessage 即 appendAssistantErrorMessageOnce 补一条 stopReason="error" 消息，而其去重只认末条 stopReason==="error"，对 aborted 末条失效 → 两条消息分别渲染成斜体中止行与红框错误行。修复方向（待定夺）：agent_end 补条前判 eventEndStatus==='aborted' 跳过 + 去重放宽到 aborted 末条同 errorMessage；i18n 补 'Request was aborted' key（现 key 是 'Request aborted' 少了 was，原文翻译不到）。

## 历史笔记

- 持久化锁修复（前轮）：`withSessionPersistenceLock` 从全局单链改为 keyed 队列（`session-persistence-lock.mjs`），默认 key（''）保持全局串行；`persistSession` 在 SQLite 权威模式下用 `session:${sessionId}` key，JSON 镜像模式保留全局 key（bucket 级 read-modify-write 需要）。正确性依据：authoritative 模式下正确性由 per-row revision CAS 独立保证，全局互斥是 JSON 时代遗留；SQLite 单连接 + DatabaseSync 同步 API + Node 单线程保证任意时刻至多一个事务执行。auto-archive 仍用全局 key；其与 per-session persist 的交错由 CAS + 写前重校验保证。锁 drain 后 Map 条目自动清理。
- 慢 persist 观测：`persistSession` 记录耗时（排队+编码+同步写），阈值已由 1s 降至 200ms（optimize-persist-encoding-yield）打 warn（含 messageCount），便于定位"大会话同步事务阻塞事件循环"。注意同步 SQLite 大事务本身的事件循环阻塞是 node:sqlite 固有行为，分锁只消除排队放大；编码段已由单遍序列化器+分批 yield 优化，残余同步写突刺（INSERT+COMMIT）需慢日志量化后再决定是否升级 worker 线程方案。
- `runTaskkill` 超时兜底（`server/utils/process-tree.mjs`）：taskkill.exe 挂起时 10s 后 resolve(false)，不再让 dispose()/destroyAgent 永久悬挂（Windows 上 OpenCode 子进程清理路径）。
- `/api/agents/:id/restore` 挂起+内存增长根因分析：① 前端切到一个 session 时并发发 POST /restore + GET /state + GET /messages + GET /status + SSE，这些路由在内存无 session 时都隐式回落 restoreAgent，而旧实现是 check-then-act，并发时各自 createAgent、最后一次 set 覆盖前面的——被覆盖的 session 永不销毁，形成孤儿泄漏。② 前端切 session 只 abort fetch，服务端 handler 照常建 session。③ agentSessions Map 唯一删除点是 destroyAgent。④ 全局 withSessionPersistenceLock 是无超时单链 promise 队列，persist 积压时阻塞事件循环 → 请求挂起。
- restore 修复（前轮）：`restoreAgent` 拆为外层去重 + `restoreAgentUnlocked`，`pendingRestores` Map 按 sessionId 共享 in-flight Promise，finally 清理。所有并发调用点收敛到模块内单个函数。
- 测试教训（锁单测）：模块级队列 Map 在同一测试文件内共享——测试失败路径泄漏的 pending 链会污染后续使用相同 key 的测试；每个测试用唯一 key + gate 必须 settle + `await new Promise(r => setTimeout(r, 0))` 排空微任务。
- 未实施的后续候选（见 session-handoff）：前端 dispose 通知服务端提前回收、agentSessions 上限 LRU、SQLite 大事务拆分、mcp/plugins registry withTimeout 吞错泄漏。
- 归档闪烁根因（前轮）：`archiveSession` 归档后调 `refreshSessions({ broadcast: true })` 的全量重置模式导致侧栏闪烁；修复为归档成功后本地乐观移除。
- 遗留（范围外，择机处理）：`ChatSidebar.confirmDeleteSession` 的 `deletingSessionId` 成功后不复位、`deleteAnimationTimeoutRef` 为共享单值 ref；置顶区删空后整块条件卸载（无高度过渡）。
- 分页死循环根因（前轮）：删除/归档改变服务端 total 与排序窗口后，前端 offset 分页 + uniqueSessions 去重可能整页全重复 → hasMore 恒 true 无限请求；修复为零进展时 total 收敛为 items.length。
- 已知取舍：若服务端确实还有更多数据但某页全为已加载项（去重误伤），hasMore 会提前置 false，需下次 refreshSessions 恢复。
- loadMoreGlobal/loadMoreProject 无 loading 守卫（零进展收敛已可终止循环）。
- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment，多会话前已存在。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地）。
- 前端分页测试技巧：mock React harness 中测 offset 分页必须显式传 offset，不能依赖 loadMore* 的闭包 state。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
