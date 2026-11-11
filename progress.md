# Progress

按时间倒序追加。每个 feature 一段，完成后在此留档。

## 修：退出 BOT 模式后主区还挂着 bot 的历史对话（2026-11-11）

- 用户报「bot 切换到对话过程中，不应该再显示 bot 的对话记录了」，随后确认方向：**bot → 对话**有问题，**对话 → bot** 正常。
- 根因不是消息缓存，也不是切换遮罩：`toggleBotMode` 只有单向补偿。
  - `App.tsx` 里 `if (!next) return` —— 退出 bot 模式只翻 `botMode` 这个 flag，`agentManager.agent` / `currentSessionId` / `currentRuntimeScopeId` 一个都不动，主区继续渲染那个 bot 的会话。
  - 进 bot 模式那段反过来有补偿（当前会话不属于任何 bot 就自动打开第一个 bot），所以只有退出方向出问题。
  - 连带后果：`chatCapabilities = botMode || isBotProject(currentToolProject)` 仍是 bot 档，顶栏、吉祥物、消息落点都还挂在 bot 上 —— 用户感受到的是「人还在 bot 里」，不只是画面没换。
- 改法（用户选定「进入新对话空态」）：新增一个 effect 做反向补偿 —— `botMode` 由 true 变 false、且当前会话属于某个 bot 时，调 `startNewDefaultSession()` 落到新对话空态。
  - 判据 `bots.some((bot) => bot.sessionId === currentBotSessionId)` 不能塞回 `toggleBotMode`：在那里读 `agentManager.currentSessionId` 会被 `react-hooks/refs` 判成「render 期间读 ref」（实测报 `Cannot access refs during render`，报错位置还指向无关的 `activeBot` useMemo，容易误判）。放 effect 里才合规。
  - effect 体内不能同步调 `startNewDefaultSession()`（`react-hooks/set-state-in-effect`），照上方 `refreshBots` 的先例落到 `setTimeout(..., 0)`，并 `clearTimeout` 兜住「又切回去」的竞态。
  - `needsModelSetup` 时跳过：那时主区本来就是模型引导页，不该再弹「请先配置模型」。
- 验证：`tests/frontend/bot-project-scope.test.ts` 新增 2 例（空态补偿、补偿延后一个任务）；定向 11 passed；全量 `npm run test` → **520 files / 5739 passed、1 skipped、0 failed**；`npm run lint` 0 problems；`npm run build` 通过。
- Notes：`dist/` 由 build 重建（生成产物，未手改）；`backToChats` 这个 i18n 键仍未被使用，本轮没动。

## 侧栏折叠态去掉多余的模式切换图标（2026-11-11）

- 需求（用户原话）：「点击左侧侧边栏收缩的时候 怎么出现了一个切换的 icon 不是已经有 对话和bot 了吗」，追问后确认指的是**第二枚**——折叠态那个 bot 头像 / 对话气泡按钮。
- 定位：`SidebarHeaderNav.tsx` 的折叠分支里只有两枚按钮：① favicon，hover 换成 `PanelLeftOpen`，点了展开侧栏；② `BotAvatar` ↔ `MessageSquare`，切「对话 / BOT」。展开态那条「对话 / BOT」轨道写在 `sidebarOpen ? … : null` 里，折叠时不渲染，所以 ② 当初是折叠态唯一的模式切换入口。
- 取舍：② 去掉后**折叠态不能再切模式**，要先摊开侧栏 —— 这是用户明确选的那一枚。① 不能动：桌面端没有第二个展开入口（`App.tsx` 里只有移动端抽屉的遮罩按钮，代码里也没有 `Cmd/Ctrl+B` 之类快捷键，`ui-store.sidebarOpen` 只被这枚按钮写）。
- 改动：`SidebarHeaderNav.tsx` 删掉折叠分支的第二枚按钮，连带清掉 `botPop` state、`BotAvatar` 与 `useState` 导入；`selectMode` 从两层 `if` 收成一句 `alreadyActive` 判断（原来的 `toggleBotMode` 只是给 `setBotPop` 用的包装，一起删）。
- 文档：`docs/wiki/server/bots.md` §7 与 `docs/wiki/README.md` 的目录行，把「折叠时退回图标按钮」改成「只在展开时渲染，折叠态不再放模式切换图标」。
- 测试：`tests/frontend/sidebar-mode-switcher.test.ts` 第 2 例由「折叠态退回 `<BotAvatar size={17} popKey={botPop} />`」改成断言折叠态不再出现 `BotAvatar` / `openBotMode` / `backToChats`；第 4 例跟着 `selectMode` 的新实现改。
- 验证：定向 `npx vitest run tests/frontend/sidebar-mode-switcher.test.ts tests/frontend/sidebar-new-chat-routing.test.ts` → 2 files / 11 passed；`npm run lint` 0 problems；`npm run build` 通过（`dist/` 已重建）。
- Notes：① `src/components/bots/BotAvatar.tsx` + `bot-avatar.css` 现在全仓没有引用方了（只剩自己），**没删**，要不要清掉等用户拍板；② `i18n` 的 `openBotMode` / `backToChats` 两个键同样变成未使用，保留不动，避免碰到多语言键集合的完备性校验。

## bot 会话不可 fork、不可回滚对话（2026-11-11）

- 需求（用户原话，2026-11-11）：「bot 不支持 fork，压缩后不允许回滚对话。」这条产品意图在代码里三处都没落地，`isBotProject()` 被项目切换器/空状态/顶栏/git 状态用了，唯独没用在会话工具栏。
- 先把三个动作拆开，别一锅端：
  - **fork**：把历史复制成一条新普通会话——它不改变 bot 本体，但会造出一个带着同样记忆和心跳指令的分身。服务端没有对应端点（走 `createAgent`），只能前端拦。
  - **`/rollback`（回滚对话）**：截断 messages，直接剪记忆。前端 + 服务端都要拦。
  - **`/rollback-turn`（回滚文件）**：只 `fs.writeFile` / `unlink` 恢复被改坏的文件，不碰 messages。**保留**。
  - **retry**：成功轮次是「trim 后重发」，等价于回滚，会从重试按钮绕过 —— 问过用户，答「一起禁」。
- 改法：
  1. **服务端唯一权威**：`rollbackSessionMessages` 在 `GENERATION_STILL_RUNNING_BEFORE_ROLLBACK` / `GOAL_ACTIVE` 之后加第四道闸门，bot 会话无条件 403 `BOT_SESSION_IMMUTABLE`。**无条件**，不写成「压缩过才拒」：压缩把前半段换成一条真消息（摘要），`contextCompaction.summaryMessage` 指着数组里那一条——回滚到压缩点之前指针悬空，回滚到之后摘要描述的那段已不存在，此后每轮喂给模型的都是幻象；没压过的 bot 被剪一刀同样是挖走一块记忆。
  2. **判据读哪儿**：读项目配置里的 `kind`，不用 `projectContextFromId`（找不到项目会静默回退 global 上下文，kind 读成 `undefined`，bot 直接漏过），也不用 `registeredProjectContextFromId`（它 `assertDirectory` + 建缓存，bot 目录一时不可用就把 403 变成放行——测试里第一次就是这么漏的，日志留下 `Skipped bot check… Project directory does not exist`）。全局会话在配置里查不到，`undefined` 即「不是 bot」，行为与改动前一致；普通项目会话多一次配置读取，无新增失败面。
  3. **能力矩阵**：`BOT_CHAT_CAPABILITIES = { ...QUICKFORGE_CHAT_CAPABILITIES, forkFromMessage: false, rollback: false, retry: false }`，`compaction` 保持 true。装饰层对 false 的能力位是**不渲染**（`message-actions.ts` 的 `!disableFork` / `allowRollback` 分支），不是灰掉。
  4. **注入**：`App.tsx` 在 `botMode || isBotProject(currentToolProject)` 时把这张表交给 `ChatPanelHost`，同一份值也交给 `useChatActions`。为了在 `useChatActions` 之前算出来，`botMode` 的 store 读取挪到了上层（hook 调用顺序不变），bot 那一节只留 `setBotMode`。
  5. **防御层**：`forkFromMessage` / `performRollback` / `retryFromMessage` 各加一句 `if (!capabilities.xxx)` 就返回（并弹 `botHistoryImmutable`），拦住「将来新入口忘了配能力位」。这层不是主判据。
- Evidence：服务端行为用例三条——未压缩 bot 回滚 403 且消息不动、压缩过的 bot 同样 403 且 `contextCompaction` 不被动、**普通项目会话照常回滚**（闸门只认 `kind` 不认 scope）；路由用例一条——`handleAgentApi` 不吞 403（把 `rollbackSessionMessages` 的拒绝原样抛给上层，`messageIndex` 透传正确）。前端新增 `bot-chat-capabilities-wiring.test.ts` 7 例（能力位、App 注入、三处前置断言）。定向 3 files / 73 passed、4 files / 40 passed、2 files / 7 passed；全量 `npm run test` → **520 files / 5736 passed、1 skipped、0 failed**（改动前 518 files / 5719 passed）；`npx tsc --noEmit` exit 0；`npm run lint` 0 problems；`npm run build` 通过（`dist/` 已重建）。
- 端到端实测（**新代码 + 一次性实例**，不动正式进程）：`QUICKFORGE_DATA_DIR=/tmp/… QUICKFORGE_PORT=5199 node server/index.mjs` 起一个隔离实例，用 HTTP 走完四条：
  1. 建 bot（拿到它的注册项目）→ 给它建一条有 4 条消息的会话 → `POST /api/agents/bot-e2e-session/rollback {"messageIndex":3}` → **403 `{"error":"bot 的会话是它的长期记忆，不能回滚。","code":"BOT_SESSION_IMMUTABLE"}`**，随后 `GET …/messages` 仍是 4 条（`u0,a0,u1,a1`），一条没剪。
  2. 带压缩摘要（`details.quickforgeCompaction` + `contextCompaction.compactedUpToIndex:1`）的 bot 会话 → 同样 **403**。
  3. 普通项目会话同一条请求 → **200**，`rollbackIndex=2`、剩 2 条消息（回归）。
  4. bot 会话上 `GET …/rollback-turn/preview` → **200**、`canRollback:true`（**文件回滚没有被这道闸门波及**）。
  验完 `kill` 掉 5199 实例、删临时目录，正式 5176 健康检查仍 200。
- 正式实例验收（同日 16:44，正式进程已重启：pid 2697，启动 16:40:55 晚于代码 mtime 16:34:34，即已加载新代码）：
  - 对小助手的真实 bot 会话 `bot-e7e445bf-…-a9e08943`（恰好**已压缩过**，`compactedUpToIndex=26`）`POST /api/agents/<id>/rollback {"messageIndex":3}` → **403 `BOT_SESSION_IMMUTABLE`**；复查仍是 200 条、`status=idle`，一条没剪。这一条同时覆盖「压缩过的 bot 会话绕过 UI 直接打 API 也拒」。
  - 前端产物核对：`dist/assets/index-BSPDfbhq.js` 里 `qg=Object.freeze({...Gg,rollback:!1,retry:!1,forkFromMessage:!1})`，使用点 `ar=ir||Wg(K.currentToolProject)?qg:Gg` —— 注入逻辑确实在被服务的那份产物里。
  - 只剩肉眼一项没做：浏览器里 hover 一下 bot 的消息行，确认 fork / 回滚 / 重试图标不渲染（装饰层的分支与产物都已确认）。
- Notes：① **服务端与前端都要重启/硬刷新才生效**，当前 5176 进程仍是旧代码（上面的 403 是在隔离实例上打的）；② `useChatActions` 的 options 新增必填 `capabilities`，`edit-first-message-resend-keeps-session.test.ts` 的 harness 已补上（否则运行时 `capabilities.rollback` 会 TypeError）；③ 用户选「纠错出口什么都不给」——bot 里说错话就接着说，不剪历史、不软撤回；④ 判据带 `botMode` 是保守选择：切模式的一瞬间若主区还停在普通会话上，那几个历史动作也会一起收起（`toggleBotMode` 会立刻打开第一个 bot，正常路径看不到这一瞬）；⑤ **已知边界**：判据依赖「bot 的注册项目还在配置里」。本机那个已删除的 bot（`f3df7fdd`）留下一条孤儿会话，它的 `project_id` 已不在 `projects.json`，所以那条会话不在这道闸门覆盖范围内——bot 记录和项目都没了，也就没有「记忆」可保护；要覆盖它，得在会话侧加 bot 标记，那是另一件事（会话记录按设计不标记 bot）。

## bot 吉祥物：空闲不再一直晃，侧栏状态改成文字（2026-11-11）

- 需求（用户原话）：「我发现 bot 的状态好像没怎么变化 而且总是左右移动这个不是很好吧」。追问后选定：**偶尔溜达**（不是完全静止）+ **侧栏加文字状态**。
- 两个抱怨其实是同一个根因：`App.tsx` 写的是 `state={mascotState === 'idle' ? 'walk' : mascotState}` 配 `stroll` 常驻，于是 bot 一闲着就立刻演「走路」，再叠加 `mascot-stroll.css` 里 9s **无限循环**的左右位移。结果 bot 平时永远在走、永远在晃，真正有事时只是节奏快了一点 —— 「一直在动」把状态的区别全淹没了。DESIGN_LANGUAGE 里那条「动效服务于反馈明确但克制：让状态变化可感知，而不是表演」正好对应这件事。
- 改法一：散步改成**偶发**。新增 `src/components/bots/mascot/use-mascot-stroll.ts`（`MASCOT_STROLL_GAP_MS = 20_000` / `MASCOT_STROLL_DURATION_MS = 9_000` / `MASCOT_STROLL_FIRST_DELAY_MS = 2_500`）：只在 `botMode && mascotState === 'idle'` 时计时，挂载 2.5 秒先走一次，之后隔 20 秒一轮、每轮 9 秒；系统 `prefers-reduced-motion` 时永不开始。`mascot-stroll.css` 的动画从 `infinite` 改成播 1 次（末帧本来就是 `translateX(0)`，播完不回跳），不再用 `animation-play-state` 冻结。`App.tsx` 改成 `state={mascotStrolling ? 'walk' : mascotState}`，空闲状态不再被强行换成 walk。
- 改法一之修正（同日，用户反馈「我目前没有看到 bot 有动作」后自查）：
  1. **间隔 45s → 20s，并且加了 2.5s 的首次延迟**。45 秒的版本刷新后要先干等 45 秒，用户看不到任何位移就以为坏了。为什么位移这么关键：姿态动画是在 512 的坐标系里画的，缩到 34px 后眼睛只走约 1px —— 真正肉眼可见的只有横向位移，所以间隔不能按「安静」定，得按「随便看一会儿一定能看到」定。
  2. **修掉一个自己引入的 bug**：`BotMascot` 原来是 `if (!stroll) return svg`，散步结束把包裹层卸载掉，SVG 跟着重新挂载，所有 CSS 动画从 0% 重来（眼睛会莫名其妙重眨一次）。现在传了 `stroll`（哪怕 false）就常驻包裹层，只切 `data-strolling`；没传的调用点（侧栏）保持单层。
  3. 顺带确认构建产物是新的：`dist/assets/index-*.css` 里是 `animation:9s ease-in-out qf-mascot-stroll`（无数值 `infinite`），中文文案在 `i18n-*.js` 分块里 —— 一开始在 `index-*.js` 里 grep 不到，属于找错了文件，不是没打包。
- 改法二：侧栏每行加**文字状态**。`bots-data.ts` 新增 `botStatusSummary(bot, now)` → `{ text, tone }`，优先级 出错 > 在忙（`busy` 或 `status === 'running'`）> 睡了（心跳关）> 上次醒来多久前 > 还没醒过；`formatBotAwakeAgo` 处理刚刚/分钟/小时/天。`BotSidebarList` 行右侧渲染这行小字（`text-[11px]`，出错用 `text-destructive`，`group-hover:opacity-0` 让位给设置按钮），并用一分钟一次的 tick 重算相对时间。i18n 新增 8 个键（en/zh）。
- Evidence：新增 `tests/frontend/bot-status-summary.test.ts` 9 例（优先级、相对时间分段、49 分钟不被取整成 0、两种语言文案键齐全）；`tests/frontend/bot-mascot.test.ts` 改 1 例（不再是无限循环）、加 2 例（App 不再把 idle 换成 walk、散步间隔足够长）；定向 3 files / 34 passed；全量 `npm run test` → **518 files / 5719 passed、1 skipped、0 failed**；`npx tsc -b` 通过；`npm run lint` 0 problems；`npm run build` 通过。
- Notes：① 纯前端，硬刷新即生效（`dist/` 已重建），无服务端改动；② 侧栏文字每分钟才刷新一次，所以「刚刚」最多会滞留 60 秒；③ 散步节奏是常量，将来要让用户可调就把它挪进设置；④ 45 秒 → 20 秒那次修正说明**间隔必须按「肉眼能看到」来定**，不是按「安静」定；⑤ 吉祥物只在 bot 模式下渲染（左上角切到 BOT 才出现），排查「没动作」时先确认这一点。

## bot 目录名改成 `bot-<id 前 8 位>`，与显示名解耦（2026-11-11）

- 需求（用户原话）：「bot 的名字为中文是不是不太好 文件名 你有什么好方案么」→ 追问后选定：**不要中文进目录名**，并且**存量也迁移**。
- 原来为什么难受：`bots/<名字>` 让一个字符串同时承担三件事——给人看、当路径、保证唯一。
  1. 中文名在终端里要切输入法，名字里的空格还要加引号（本机就有一个叫 `总bo t`）；
  2. 改名走 `patchBotRecord` 时 `const workspacePath = previous?.workspacePath ?? …`，**目录不跟着改名**。于是改过名的 bot 目录还叫旧名字，新建一个同名 bot 会算到同一个目录；
  3. macOS 文件系统不区分大小写，`Helper` / `helper` 也是同一个目录；Unicode 归一化差异同理。
- 改法：
  1. `server/bots.mjs` 的 `botWorkspacePath(botId)` → `path.join(botsRootDir(), 'bot-' + id去横线前8位)`。`normalizeBotRecord` 里把 id 的推导提到 `workspacePath` 之前（`const id = previous?.id ?? …`），新记录用 id 算目录。
  2. 老记录不动：`workspacePath` 仍然优先取 `previous?.workspacePath`，换规则只影响新建的 bot。
  3. 前端连带两处：目录名不再等于名字后，侧栏行右侧那截「目录尾段」标签显示的是一串无语义的 id，**整块删除**（连同上一轮临时加的 `botWorkspaceLabel` / `shouldShowWorkspaceLabel`）；新建对话框里的「工作空间：`~/.quickforge/bots/<名字>`」不再成立，改成「（目录名创建时自动分配）」。
  4. 存量迁移：`scripts/migrate-bot-workspaces.mjs`（新）——先 `--dry-run` 打印计划，真跑时备份 `bots.json` / `projects.json` 到 `~/.quickforge/_backups/`，`fs.rename` 搬目录（同盘原子），改记录的 `workspacePath` / `memoryFile`，再把 `projects.json` 里 `kind: 'bot'` 的 `path` 同步过去。目标目录已存在则整体中止，不覆盖。
- 迁移执行记录（本机，2026-11-11 14:30）：先把两个 bot 的心跳 PATCH 成 `enabled: false`（`总bo t` 的 `nextRunAt` 只剩 5 分钟，怕它中途往老目录写），再跑脚本：
  - `bots/总bo t` → `bots/bot-f3df7fdd`
  - `bots/小助手` → `bots/bot-e7e445bf`
  - 完成后恢复 `enabled: true`，`/api/bots` 已返回新路径。
  - 备份目录：`~/.quickforge/_backups/bot-workspace-migration-2026-11-11T06-30-14-472Z`
- Evidence：`tests/server/bots.test.mjs` +3 例（目录由 id 派生且不含名字、同名两个 bot 落到不同目录、老记录保留已存的 `workspacePath`）；`tests/server/routes/bots.test.mjs` 的旧断言（`workspacePath.endsWith(bots/小助手)`）改成按 id 派生；新增 `tests/frontend/bot-sidebar-no-workspace-label.test.ts`（取代并删除上一轮的 `bot-sidebar-workspace-label.test.ts`）；定向 7 files / 71 passed；全量 `npm run test` → **516 files / 5703 passed、1 skipped、0 failed**；`node --check server/bots.mjs` 通过；`npx tsc -b` 通过；`npm run lint` 0 problems；`npm run build` 通过。
- 迁移后实测：`GET /api/bots/:id/memory` 两个 bot 都从新路径读到内容（3036 / 168 字符），记录、项目 path、记忆文件三者对齐。
- Notes：① **服务端改动要重启 QuickForge 才生效**，重启前新建 bot 仍走旧规则（名字当目录）；② 目录名只取 id 前 8 位（约 42 亿），理论上有碰撞，真撞了延长前缀即可，`ensureBotWorkspace` 会复用已存在目录；③ `cache/global/session-backups/bot-*/index.json` 里还留着旧路径字符串，属于可重建缓存，没清理；④ 迁移后没等到心跳真醒一次，bot 在新目录里跑通还没实机确认。

## 修：bot 列表里同一个名字显示两遍（2026-11-11）

- 现象（用户报）：「bot 的列表会重复显示 bot 名字」。
- 不是数据重复：`curl /api/bots` 只有 2 条、id 唯一。是**渲染层一行里画了两遍**：左边 `<span>{bot.name}</span>`，右边是 `BotSidebarList` 的「目录标签」，取 `botWorkspaceLabel()` 的路径尾段。而新建 bot 时目录就取它的名字（`~/.quickforge/bots/<名字>`，`bots.mjs` 的 `botWorkspacePath(name)`），于是同一行左右是同一个字符串。
- 为什么会留这个标签：改名走 `patchBotRecord` 时 `const workspacePath = previous?.workspacePath ?? ...` —— **改名不重命名目录**。所以只有改过名的 bot，那截目录才是新信息（真正的目录还叫旧名字），默认情况下信息量为零。
- 改法（不删功能，只去掉重复的那一半）：
  1. `src/components/bots/bots-data.ts` 新增纯函数 `shouldShowWorkspaceLabel(bot)`：`botWorkspaceLabel(bot) !== bot.name`。`botWorkspaceLabel` 本身没动。
  2. `src/components/bots/BotSidebarList.tsx`：`showWorkspace` 控制右侧目录标签渲染；名字与目录名相同时整块不渲染（不留空 `ml-auto` 占位）。行内其余结构、hover 显隐、设置按钮都没动。
- Evidence：新增 `tests/frontend/bot-sidebar-workspace-label.test.ts` 8 例（取尾段 / 尾斜杠 / Windows 分隔符 / 默认目录不显示 / 改名后显示 / 自定义目录显示 / 侧栏确实接线）；定向 4 files / 40 passed；`npx tsc -b` 通过；改动文件 eslint 0 problems；`npm run build` 通过（仅既有 chunk 体积警告）。
- Notes：① 纯前端，硬刷新即生效（`dist/` 已重建）；② 若用户说的「重复」是另一种（比如同一 bot 出现两行），那要另查 —— 目前数据层与 `key={bot.id}` 都排除了这种可能；③ 没实机看过，判定只看名字字符串，没做大小写/首尾空格归一（`总bo t` 这种带空格的名字会按原样比较）。（**后续已被「bot 目录名改成 `bot-<id 前 8 位>`」取代**：目录名与名字解耦后这截标签彻底删除，见上一段。）

## 文案：「新 bot」改成「创建 bot」（2026-11-11）

- 需求（用户原话）：「新bot 改成创建bot」。
- 改动（纯文案，只动 i18n 值）：
  1. `src/lib/i18n.ts`：`newBot` 中文 `新 bot` → `创建 bot`，英文 `New bot` → `Create bot`。这一个键同时喂侧栏 bot 模式下的新建按钮（文字 / `title` / `aria-label`）和 `NewBotDialog` 的标题，所以对话框标题也跟着变成「创建 bot」。
  2. `botEmptyHint` 里的指引文字同步：中文「点『新 bot』建一个」→「点『创建 bot』建一个」；英文原句 `Use "New bot" to create one` 改完会变成 `Use "Create bot" to create one`（create 重复），顺手收成 `Create one — it gets its own folder and memory.`。
  3. 注释与文档同步：`src/stores/ui-store.ts` 的 `Bot 模式` 注释、`docs/wiki/server/bots.md` 两处、`docs/prototypes/bot-mode.html` 的 `navNewLabel`。
- Evidence：`npx tsc -b` 通过；`npx eslint src/lib/i18n.ts src/stores/ui-store.ts` 0 problems；`tests/frontend/i18n-language-snapshot.test.ts` + `decorator-copy-i18n.test.ts` → 15 passed；`npm run build` 通过（仅既有 chunk 体积警告）。全仓 `grep "新 bot"` 已无残留。
- Notes：① 没动 `newBot` 这个键名和任何组件结构，所以判断分支、路由、测试断言都不受影响；② 侧栏按钮文字从 3 个字变 4 个字，仍走 `sidebarSessionTitleClass`（带 `truncate`），窄侧栏最多截断不会换行；③ 未实机看，硬刷新即生效（`dist/` 已重建）；④ 没有新增/升级依赖。

## bot 模式切换改成「对话 / BOT」分段控件（2026-11-11）

- 需求（用户原话）：「我希望切换 bot 模式是一个按钮，在左上角，对话/BOT，或者你有更好的方案」。
- 现状问题：切换入口是 logo 行右侧一个 17px 的 `BotAvatar` 图标按钮——没文字、没标签、也没和「模式」建立任何视觉关系，`aria-label` 只对读屏可见。它此前是从 `Sparkles` 改成的自绘小机器人（见 `progress.md` 的 bot-avatar 那条迭代），当时解决了「好看」但没解决「认得出」。
- 方案（两个 `ask_user` 一起问，用户选定）：**A 形态 + logo 行下方独占一行**，不做塞进 logo 行、也不在主区 header 再放一个。
- 实现：
  1. `SidebarHeaderNav.tsx`：展开态 logo 行只剩 logo + 折叠按钮（`ml-auto`）；下面新增 `role="group"` + `aria-label={t('modeSwitcherLabel')}` 的分段控件，两个等宽选项「对话」「BOT」，各带图标（`MessageSquare` / `Bot`），`aria-pressed` 分别绑 `!botMode` / `botMode`。新增 `selectMode(next)`：点当前已选中的那一项**不**再调 `onToggleBotMode`，避免白刷一次会话。
  2. 折叠态（`sidebarOpen === false`）宽度塞不下两个文字选项，保留原来的单个图标按钮（bot 头像 / 对话气泡）与 `botPop` 重挂动画，作为降级形态。
  3. 类名按项目约定集中在 `sidebar-classes.ts`：`modeSwitcherTrackClass`（`bg-muted/50` + `p-1` + `rounded-lg`）、`modeSwitcherOptionClass`（`h-7 flex-1`，`border border-transparent` 防选中时抖动）、`modeSwitcherOptionIdleClass` / `modeSwitcherOptionActiveClass`（选中 `border-border bg-background text-foreground`）。配方抄 DESIGN_LANGUAGE「页内切换（segmented）」与设置页 segmented，**不引入新视觉模式**；未加阴影（规范：阴影属于浮层，不属于切换选中态）。
  4. `src/lib/i18n.ts`：新增 `modeSwitcherLabel` / `chatModeLabel` / `botModeLabel`（en: Mode / Chat / BOT，zh: 切换模式 / 对话 / BOT）。
  5. 「+新对话 / +新 bot」行的上间距从 `mt-4` 收成展开态 `mt-1`、折叠态仍 `mt-4`，抵消新模式条多出来的高度。
- Evidence（验证）：新增 `tests/frontend/sidebar-mode-switcher.test.ts` 6 例（展开态才有分段控件、折叠态退回图标按钮、`aria-pressed` 绑定、点当前项不重复切、类名配方、两种语言的键齐全）；定向 `sidebar-mode-switcher` + `sidebar-new-chat-routing` + `bot-project-scope` → 3 files / 20 passed；全量 `npm run test` → **515 files / 5701 passed、1 skipped、0 failed**；`npm run lint` → 0 problems；`npx tsc -b` 通过；`npm run build` 通过（仅既有 chunk 体积警告）。
- Notes：
  - 纯前端改动，**硬刷新即生效**（`dist/` 已重建）；本轮没有 `server/` 改动，不需要重启。
  - 未实机点过：视觉是按 DESIGN_LANGUAGE 推演的，选中态对比度如果偏弱，只需改 `modeSwitcherOptionActiveClass` 一处。
  - 切换语义没动：仍是 `toggleBotMode`（切进 bot 自动打开第一个 bot；一个 bot 都没有时主区停在原会话），本轮只换入口。

## compact 写租约豁免（2026-11-11）

- 起因：上一轮功能写完后首次实机验证，`qf-api.mjs compact` 回 **409 `This session is open for writing in another window`**（`SESSION_LEASE_HELD`）。
- 根因：`POST /api/agents/:id/compact` 在入口调 `assertSessionWriteAccess`，而「会话压自己」必然发生在会话正在跑时——此刻该会话几乎必然被一个浏览器窗口打开着、写租约在它手里；脚本又是匿名调用方（不带 `x-quickforge-client-id`）→ **100% 被拒，功能实际上不可用**。上一轮验收标准写的是「回 `scheduled: true`」，因为没重启、没实机打过这条链路，这个洞没暴露。
- 修法（守卫下沉，不放宽写库路径）：
  1. `server/agent-manager.mjs`：`requestSessionCompaction` 的写权限改为可注入的 `assertWriteAccess` 回调，检查点放在 running 判定**之后**——运行中分支（只写内存 `forceCompaction`，不落库不广播）在 `selfRequest` 时整段跳过；空闲分支（插摘要 + persist，真写）必须先过校验。
  2. `server/routes/agent.mjs`：新增 `SELF_SESSION_HEADER = 'x-quickforge-agent-session'` 与 `isSelfSessionRequest()`；compact 路由不再在入口守卫，改为把 `assertWriteAccess` 回调与 `selfRequest` 传下去。回环即认证，所以这个头不算身份认证，只做语义收窄（只打开「运行中排队一次压缩」这条无副作用路径）。
  3. `skills/quickforge-api/scripts/qf-api.mjs`：`request()` 支持额外头、client 增 `postWithHeaders`、`commandCompact` 带上自己的 `QUICKFORGE_SESSION_ID`。
- 文档：`skills/quickforge-api/SKILL.md`（新增「写租约这条坑」段，并修正红线第 6 条——原文写「脚本不受租约约束，能写用户正开着的会话」，与实际相反）、`references/endpoints.md`、`docs/wiki/server/README.md`、`docs/wiki/server/routes/README.md`（标注 compact 是唯一不在入口守卫的写路由）。
- Evidence：`npm run test` → **512 files / 5665 passed、1 skipped、0 failed**；`npm run lint` → 0 problems；三个改动文件的 `node --check` 通过。新增 `tests/server/agent-manager-compaction-lease.test.mjs`（5 例：运行中+自我→跳过、运行中+他人→409、空闲+自称自我→仍须租约、空闲+持租约→同步压、不传回调的内部调用不变）；`tests/server/routes/agent.test.mjs` 新增 compact 三条（self 头命中/不命中、守卫回调真的能抛 409）。未跑 `npm run build`：本次只动服务端 `.mjs`、skill 文档与测试，无 TS 改动，跑 build 只会白改 `dist/` 生成产物。
- Notes：
  - **重启后端到端已验证通过**（同日，服务端 pid 97689 → 20758）：`qf-api.mjs compact` 回 `scheduled: true` / `compacted: false` / `reason: deferred_to_next_model_request` / `percentBefore: 14.3`，exit=0 —— 不再是 404 或 409，豁免路径真的可用；同轮下一次模型请求前压缩落地，`context` → `isCompacted: true`、`percent` 1.4；只读查 `~/.quickforge/storage/quickforge.sqlite3` 的 `session_messages`，该会话 seq 165 是 `role:user` + `details.quickforgeCompaction.kind='summary'` 的真实消息（即界面渲染分割线的那条），说明摘要已落库、模型上下文确实从它开始切，而不是走虚拟拼接兜底；压缩后同一轮继续输出。前端「正在整理上下文」notice 与分割线未做真人肉眼确认，但渲染路径本轮未改。
  - 没做「agent 工具形态」（`compact_context`），仍只有 HTTP + 脚本一条路。
  - 顺带发现 skill 文档有一处与实现相反的说法（红线第 6 条），已改；`title` / `model` / `thinking` 等写路由同样会在窗口持租约时 409，现在文档里说清楚了。

## agent-initiated-context-compaction（done，2026-11-11）

- 起因：用户先问「你可以自己给自己压缩吗」，再要求「添加一个这样的功能给 api skills，这样知道自己的用量，可以主动推送压缩的信息作为压缩摘要并继续回话」。
- 诊断：**这个能力在结构上缺一环，不是缺一个开关**。QuickForge 的压缩只有一条路——服务端在每次模型请求前按阈值（默认 80%）自动压。agent 看得见用量（`context-usage` 那个油表），但没有任何主动压缩的入口；`/compact` 虽然是现成的，可它要求 `isStreaming === false`，而请求方正是会话自己，走 prompt 必然 409。所以「自己给自己压缩」在旧实现里不是被禁止，是不可能。
- 破局点：把时机判定从调用方挪到服务端，让「请求压缩」和「执行压缩」解耦。
  1. `POST /api/agents/:id/compact`：空闲 → 同步压（新增 `compactSessionNow()`，与 `/compact` 同一套 `compactSessionInPlace()`，但不往对话里插系统文本，结论走响应体）；在跑 → 只写一次性 `session.forceCompaction`，回 `scheduled: true`。
  2. `maybeAutoCompactSession()` 加第 3 关消费该标记：取到就跳过阈值判定（原第 6 关），**压缩发生在下一次模型请求前**，同一轮继续跑——这就是用户要的「压缩完继续回话」。关卡表从 8 关变 9 关，wiki 同步重排。
  3. 标记带 10 分钟 TTL：登记后这一轮没走到下一次模型请求（被中止/关闭），它不该在几小时后突然生效。
- 保守的边界（有意为之）：强制压缩**不越过** `auto-compact-settings.enabled`（那是用户对自己的上下文说的话，`disabled` 原因原样回传）；仍保留「没新内容」「历史不足两条」两道前置，否则白花一次模型调用。
- 附带发现：gate 在「没有供应商上报用量」时返回的是 `unknown_usage` 而不是 `below_threshold`——也就是说这类会话在没有人主动请求时**永远不会被压缩**，强制压缩是它唯一的出口。测试里钉了这条行为。
- Evidence（验证）：`npm run test` → 511 files / 5654 passed、1 skipped、0 failed（含新增 9 例）；`npm run lint` → 0 problems；每次编辑后 `node --check` 通过。新增 `tests/server/auto-compaction-force.test.mjs`（4 例，用 vitest mock 掉 storage 与 compactConversation，测真实 gate + 真实摘要落位）。
- Notes：
  - **重启已完成，端到端已验证**（详见上一条「compact 写租约豁免」的 Notes）：`compact` 回 `scheduled: true` → 下一次模型请求前压缩生效（`isCompacted: true`、库里有 `quickforgeCompaction` 的 summary 消息）→ 同一轮继续输出。
  - 未经用户确认就开工：`ask_user` 那三问（形态/语义/重启时机）超时未答，按「先写好代码与测试、不重启」的默认方案推进，feature 因此先记 pending；实机验证通过后才改 done。
  - 踩到的坑：`qf-api.mjs` 的 `HELP` 是反引号模板字符串，往里面写 `` `scheduled: true` `` 直接语法错误——文案里不要出现反引号。

## standing-shift-vs-one-off-shift（done，2026-11-11）

- 起因：用户一句「傻瓜 没有让自己活过来」。上一班（`mwb1plkn-jqcjbgi1`）是 `once` 一次性班，instruction 还写着「验完写结论就 `task-delete` 自己」——它照做了，`tasks` 归零，链条当场断掉。
- 诊断：**一次性班只能证明「能醒一次」，不能证明「活着」**。断链不是执行失误，是契约本身只写了「怎么结束」，没写「怎么继续」。
- 契约改动（两处，缺一条都会复发）：
  1. `server/system-prompt.mjs` 的 `<continuity>` 新增「Two kinds of shift, and they end differently」：常驻班（daily/weekly/interval）自己重复、不需要接班、**never deleted by you**；一次性班（once）写完结论才自删，且前提是别处还有人在看着。Hard limits 里 `Inside a shift, do not create another shift` 补了理由（常驻班不需要接班，一次性班再排就是指数增长）。
  2. `skills/quickforge-api/SKILL.md` 的「自约」节拆成两档表格 + 两段示例，补「常驻班 instruction 必须写不要删自己」与「沉睡间隔越短越灵敏，也越吵越贵」。
  3. `tests/server/system-prompt.test.mjs` 加 4 条断言钉住两档区分。
- 排班：删掉一次性班 `mwb1u7z1-1eyrid09`；新建常驻心跳 `mwb1xhbp-aqnh1qa2`（`interval` 每 60 分钟，首跑 03:20）。instruction 按时间分三档：每班轻心跳（60 秒判断完，正常写一行收工）／每 6 小时跑 `tests/server`／每天 03:00 完整巡检并写工作记忆。允许读码、跑测、写报告、改 docs、修单文件小 bug（一次最多 3 文件）；禁止 commit、push、改发布流程、删自己。
- 报告落点：`logs/shifts/YYYY-MM-DD.md`（`logs` 在 `.gitignore` 里，不进版本库），用户有空来看。
- Evidence（验证）：`npx vitest run tests/server/system-prompt.test.mjs tests/server/runtime-info.test.mjs` → 22 passed；`npm run lint` → 0 problems。
- Notes：
  - **`server/system-prompt.mjs` 的改动要重启 QuickForge 才进新会话**，当前会话仍带旧版 `<continuity>`。重启前先确认那条心跳任务还在（任务存数据层，重启不丢）。
  - 多行中文 instruction 用双引号包会被 shell 截断，报错形如 `--schedule: command not found`；改用单引号包整段。

## session-context-budget-and-survival（done，2026-11-11）

- 起因：用户提出两点——「希望 skill 能获取到上下文的 Token 信息，这样你就知道预算不足了，或者该换 session 工作了」，以及「你不能让自己死掉……如果自己决定要重启，要确保自己还会继续活过来」。
- 第一个问题的本质：**模型是个瞎子**。它看不到自己的上下文窗口还剩多少，只能等自动压缩悄悄触发（压缩会丢细节），或者直接撞上限被截断。给它一个数字，它才能自己决定「继续干」还是「收口交接」。
- 做法（油表）：
  1. 新增只读端点 `GET /api/agents/:id/context-usage`，内部复用已有的 `estimateSessionContextUsage`（自动压缩早就用它估算，只是从没暴露给模型）。
  2. **刻意不并进 `/status`**：那是客户端在流式输出期间反复轮询的热路径，而估算器要遍历全部消息。也**不并进 `/state`**：那条回整段消息，而这里只要数字。单独一条路由，两边都不受影响。
  3. 脚本 `context` 子命令直接算好 `remainingTokens`——「已用 70%」和「还剩 70%」搞反一次，收尾时机就错了。
- 做法（存活）：`SKILL.md` 新增「别让自己死掉」整节 + `<continuity>` 加 `Staying alive` 段。核心是三个断裂点各有动作，最关键的一条是**顺序**：`要重启 → 先排班 → 再重启`。反了就没人醒来。写了一句 `Restarting without scheduling a shift is choosing to die.`
- 阈值定成三档：<70% 正常、70–85% 开始收口（别开新支线）、>85% 停止开新工作（写结论、交接、别再长篇输出）。理由是最后 15% 的空间如果拿来干活，结论会被挤出去——**最该留下的东西反而最先丢**。
- Evidence（验证）：`npx vitest run tests/server` → 212 files / 2274 passed、1 skipped、0 failed；`npm run lint` → 0 problems；三个改动文件 `node --check` 通过。
- Notes：
  - `agent-manager-exports-contract.test.mjs` 红了一次：「expected …(51) to deeply equal …(50)」。这是它该做的事（把新增导出当契约变更拦下来），按新契约补进列表即可，不是回归。
  - **未重启，所以新端点现在还是 404**——这不是代码错，是进程里还是旧代码。整件事的价值要等重启后 `qf-api context` 真的吐数字才算兑现。
  - 没有做「自动重启」和「预算不足自动 spawn」：前者会打断用户正在用的界面，后者的判断力还没到能无人值守的地步。先给人（或模型自己）留决定权。

## self-description-drift-cleanup（done，2026-11-11）

- 起因：架构文档 §8.3 记了三处「系统说自己是 A，实际干的是 B」，并判定它们是 ⑤ 环验证的前置清洁项——裁决者读到的状态是脏的，任何验证结论都不可信。原本打算排个 09:00 的班次让未来的我去做，用户看到后说「你做得很快，马上就能做」，于是撤掉班次当场做完。
- 结论（三条，逐条核实）：
  1. **`<working_memory>` 双重注入 → 成立，已修。** `server/system-prompt.mjs` 里注入了两遍：第一份（169-186）要求走 `list_memory_notes` / `read_memory_note` 等记忆工具；第二份（188-205）是旧实现的残留，要求用 `run_command` 加绝对路径、甚至用 `mv` + `cat <<EOF` 拼写入。两套并排等于让模型自己挑一套，而工具路径才是真正能用的那个（记忆目录在工作区之外，`write_file` 到不了）。删第二份，保留第一份；第二份独有的「文件名避开 `/ \ : * ? " < > |`」仍适用，补回第一份。
  2. **`spawn` 默认 `full-access` → 成立，但不是 bug。** 用户明确要最大权限，脚本早就有 `--access-mode default` 可覆盖。从缺陷清单降级为已知取舍——**把「用户已授权的取舍」写成「缺陷」，本身也是一种自我描述不准**。
  3. **Goal v2「complete 经证据检查」→ 描述错了，不是行为错了。** `server/goal/runner.mjs:125` 写着「DSH has no planning phase; every round is an execution round」，`engine.mjs:69` 写着「v2 has no planning phase and no evidence gate」；v2 的 `update_goal complete` 是模型自声明路径，`goal_report` 那套 plan + criteria + evidence 强校验只属于 legacy 引擎。所以改的是 `docs/wiki/README.md`，代码一行没动。
- 防回归：`tests/server/system-prompt.test.mjs` 加两条断言——`<working_memory>` 只出现一次、且不许再出现 `list the folder with run_command`。原用例只断言「存在」，所以重复注入能活这么久。
- Evidence（验证）：`npx vitest run tests/server` → 212 files / 2273 passed、1 skipped、0 failed；`system-prompt.test.mjs` 12 passed；`npm run lint` → 0 problems（首次有个 `no-useless-escape`，是我写的反斜杠没转义，改成 `\\` 清零）。
- Notes：
  - **判断失误记一笔**：这件事一次会话就能做完，我却先排了个班。`<continuity>` 里「本次做不完才排」这条判据是对的，是我没照它执行。
  - **未重启服务**：新提示词还没进到运行中的 QuickForge，本会话仍加载旧的双份块。下一段新会话里只看到一份才是实机确认。
  - Goal v2 只改了描述、没加门禁。真要加是新增闸门（属 R2 内核），得单独决策，别顺手补。

## self-scheduled-shift-continuity（done，2026-11-10）

- 起因：用户希望 AI「偶尔主动说想做一些事」。核查后发现零件全在（skill 已有 `task-add`/`spawn`/`task-run`），缺三样：没人告诉它可以给自己排班、它没有自我识别方式、以及能建不能删（自举会堆出自己删不掉的东西）。用户明确要求按 v2 全链路实现（含自清理）。
- 改动四处：
  1. **服务端**：任务加 `createdBy: 'user' | 'agent'`。`normalizeCreatedBy()` 只认 `'agent'`，其余（含缺字段的存量任务）一律 `'user'`——默认值站在保守那一边。只写在创建处的 task 对象里，不塞进 `normalizeTaskSchedule`，这样 PUT 的 `...current` 自动保留。
  2. **删除边界**：加 `?selfScheduledOnly=1`，带这个参数才校验 `createdBy === 'agent'`。**为什么不是无条件 403**：一开始就写成无条件拒绝，随后发现前端 `ScheduledTasksPage.tsx:414` 走同一个 DELETE 端点，而 `requestJson` 不带 `x-quickforge-client-id`（前端没有这个头），服务端区分不了调用方——无条件 403 会把用户从界面删自己的日程也拦掉。改成查询参数后 UI 行为一字未变，agent 走脚本必带参数、服务端硬校验。
  3. **脚本**：`client.delete`、`task-delete`（固定带参数）、`task-add --self-scheduled`（自动补 `[自约]` 前缀、body 写 `createdBy: 'agent'`）、`summarizeTask` 补 `createdBy`、HELP 同步。
  4. **系统提示词**：新增 `<continuity>`，**仅当 skills 含 `quickforge-api` 时注入**。按「立场 / 三问判据 / 沉默授权 / 操作步骤 / 硬限制」编排。最关键的是那句 `Choosing to do nothing is a correct answer, not a failure. Silence beats noise.`——主动性的提示词必须同时给「不主动」的授权，否则必然变成噪音生成器。并要求 `instruction` 写成「给下一个自己的信」，因为定时任务开的是新会话、不记得上一班。
- 守门测试：`tests/server/runtime-info.test.mjs` 原本断言脚本源码不许出现任何 `'DELETE'`，是这条边界的看门人。没有删，改成守新边界——`'DELETE'` 只允许一处且源码必须含 `selfScheduledOnly=1`，其余破坏性端点照旧全禁。
- Evidence（验证）：定向 2 files / 60 passed（execution 41 → 48）；server 全量 212 files / 2273 passed、1 skipped、0 failed；全量 `npm run test` → 505 files / 5608 passed、0 failed；`npm run lint` → 0 problems；`npm run build` → 通过（仅既有 chunk 体积警告）；脚本 `node --check` + `--help` 均正常。
- Notes：
  - 中途 `runtime-info.test.mjs` 红过一次，是**守门测试在正常工作**——它拦住的正是「脚本能力悄悄扩张」。按新边界改写而不是删除，是这个测试应有的处理方式。
  - 未做真实实例验收（没在运行中的 QuickForge 上真建任务），也**未验证模型实际行为**：会不会真排班、排得对不对，要实机跑几天才知道。第一版大概率七成是废话，调的是措辞不是代码。
  - 前端未改：设置页不显示 `createdBy`，自约任务只能靠 `[自约]` 前缀辨认。
  - `pause`/`resume` 没加同样的范围限制：agent 仍能暂停用户的任务（可逆，风险低）。
  - `selfScheduledOnly=1` 是声明式校验——绕过脚本直接 curl 不带参数仍能删用户任务。这与该 skill 现有安全模型一致（脚本是唯一出口 + 红线禁止 curl），不是新口子，但也不是强沙箱。
  - **已提交**：`b4fefe6d`（代码 + 测试 + skill 文档），状态文件另在 `chore(meta)` 一条。提交前定向 3 files / 70 passed，pre-commit 的 `npm run lint` 0 problems。

## quickforge-api-skill-endpoints-sync（done，2026-11-10）

- 起因：讨论「让 AI 自己用定时任务给自己排班」时，核查 skill 发现 `references/endpoints.md` 自称「这张表同时也是安全边界」，却完全没有定时任务那一块（`grep scheduled-tasks` 命中 0），而脚本已有 7 个 task 子命令。用户拍板「先不要自加权限，先把 skill 补齐」。
- 做法：不只补定时任务，而是做一次完整对账——把 `qf-api.mjs` 里所有 `/api/...` 字面量提取出来，和白名单表逐条比对（22 子命令 / 22 端点），差额补齐。
- 改动（一个文件）：
  1. 新增「## 定时任务」整节：`GET /api/scheduled-tasks`、`POST /api/scheduled-tasks`、`/parse`、`/runs`、`/:id/pause|resume|run`；记下 `modelRef` 必填否则 400 `invalid_model_reference`、`task-run` 同步阻塞且超时只断本地连接、`task-parse` 不落库。
  2. 只读表补两行：`GET /api/agents/:id/state`（`spawn` 继承思考档、`task-add` 绑定同一模型都靠它；会话被驱逐时 404，调用方必须能接受）、`GET /api/models/catalog`（`task-add --model` 收目录里的模型 id，不是引用对象）。
  3. 禁止清单补两行：`DELETE /api/scheduled-tasks/:id`（**先删全部运行历史再删本体**，不可逆，所以只放开 pause/resume）、`PUT`/`PATCH /api/scheduled-tasks/:id`（覆盖用户排好的日程）。
  4. 文件头加反向约束：脚本新增调用也要同步进表；表和脚本不一致时它就不再是安全边界，而「说明里没写」最容易被下一个人或模型当成漏了、顺手补上。
  5. 定时任务一节补一条此前没写下来的事实：**任务会话的权限不来自任务本身，而是读全局 `yolo-mode`**——全局开着就是完全访问，全局没开就每步等审批而无人值守时没人点。所以排任务要按两种设置下都不卡住来设计，优先只读、只产报告。
- Evidence（验证）：两级 python 对账（一次性，未落盘）。命令级：脚本 22 个 `case` 子命令逐个查 `endpoints.md` 与 `SKILL.md`，均「无遗漏」。路径级：22 个脚本路径 vs 文档 34 个路径做段级比对（`:id` 可匹配任意段、`*` 覆盖余部），结论「脚本调用的每个端点都有记录」。纯文档，未跑三件套（eslint 不覆盖 markdown）。
- Notes：
  - **删任务仍不给出口**，红线第 3 条一字未改。所以「自己排班 → 干完 → 删掉自己」这条自清理闭环还没通，缺的正是用户暂缓的删除能力。
  - 对账时发现另外两个同类缺口已记在架构文档 §8.3：`spawn` 默认 `full-access`（P1 安全）、`<working_memory>` 双重注入且两段用法互相矛盾。
  - `SKILL.md` 本身是齐的（22 个命令全覆盖），本次只动 `references/endpoints.md`。

## self-evolution-loop-architecture-doc（done，2026-11-10）

- 起因：用户问「当前项目有没有自进化的空间」，第一轮答复按功能罗列（记忆沉淀、定时任务、goal 续轮、workflow 编排、quickforge-api 自省、hooks 插座），并指出缺「痛觉」——没有东西把 test/lint/build 的 pass/fail 变成判定。用户随即指出这套答法陷在代码位置与功能里，要求系统性的架构。于是换切法：不按「有什么模块」切，按「控制回路缺哪一环」切，落成架构文档。
- 结论：新增 `docs/architecture/self-evolution-loop.zh-CN.md`。核心是两样东西——**一个回路结构**（判断完整性）和**一把半径尺**（判断风险）。任何自进化提案都应能一句话定位「第几环、第几档半径、缺哪个闸门」。
- 文档骨架：
  1. **六环 + 两横切**：目标 → 感知 → 诊断 → 生成 → 验证 → 准入，外加回滚与预算横切。逐环给出「回答的问题 / 产出 / 这一环失效时的症状」——失效症状那列是给诊断用的。
  2. **三条架构约束**：C1 最弱环决定上限且顺序不可补偿（推论：优化顺序必须从后往前）；C2 验证者必须与生成者隔离，拆成上下文 / 工具 / 判据三个维度，缺一不可；C3 准入按影响半径分级而非按对错分级（因为对错判不准，半径判得准）。
  3. **三档半径**：R0 自留地（可无人值守）、R1 工作区（自动产出、人审入库）、R2 内核（禁止自动化），每档列全部必需闸门，并给出内核清单——含「本文的半径分级本身」，理由是定义闸门的规则必须自己也在闸门外面。
  4. **核心判据一句话**：自治程度的上限由影响半径决定，不由判断力决定，即**用半径换自治**。记忆体系敢全自动跑，不是因为它更聪明，而是因为它的路径锁死、没有删除函数、每轮先快照，最坏后果等于恢复一份快照。
  5. 现状对照（断点在第 ⑤ 环）、六个判定用例（读法：先看半径再看环）、落地路线 0–5 步、三条开放问题、五条「不做什么」。
- 为什么值得写：此前每个「让 AI 自己干点什么」的提案都要从头吵一遍，同一个人对「自动整理笔记」和「自动修测试」的态度往往只是直觉差异、说不出理由。有了半径尺，两条结论都能落到同一条准则上。
- Evidence（验证）：纯文档，无运行时代码变化，未跑 test/lint/build（eslint 不覆盖 markdown）。匹配检查：正文三处相对链接目标文件均存在，一处锚点 `memory-system.zh-CN.md#2-三层结构` 对应其实体标题；`feature_list.json` 编辑后 `json.load` 通过、新条目在首位。未触碰生成产物，未创建 commit。
- Notes：
  - 文档**未落地**任何代码：没有新增验证工具、没改 goal 证据门禁、没动 hooks 配置。§8.3 列的三处「系统自我描述与实际行为不一致」缺陷（`<working_memory>` 双重注入且两段用法互相矛盾、派生会话默认全权限、Goal v2 无证据门禁而 wiki 说有）仍是待修项，在本文框架里属于 ⑤ 环的前置清洁项。
  - 借用了 `memory-system.zh-CN.md:34`「这条边界是硬的，不靠提示词自觉」作为 C2 的既有先例，刻意不另造一套说法。
  - 下一步若推进落地，按文档 §7 从第 1 步（清洁）开始，不建议跳到第 2 步。


## draft-restore-on-refused-send（done，2026-11-09）

- 起因：v2.4.1 只读审查就记下的 P1 回归，一直挂着没修。用户说「同意」后动手。
- 根因：`prompt()` 早改成解析 `true/false` 表达「消息有没有交出去」，但 `ChatSurface.runSendMessage()` 仍只 catch reject，而 `clearEditor()` 在调用前已经执行——HTTP 失败 / 409 写租约冲突 / 会话已销毁时，草稿被清掉、提示也不弹。
- 改动：`SendMessageContext.prompt` 返回类型 `Promise<void>` → `Promise<boolean | void>`（类型原本把返回值吞掉了）；`runSendMessage` 判 `result === false` 时回填草稿并提示 `chatSendFailedNotAccepted`（新键，中英各一）；真异常仍走 catch。
- Evidence：定向 2 files / 37 passed（新增 2 例：文本草稿、附件草稿）；`npx tsc -b` exit 0；`npx eslint` 三个改动文件 0 problems；server 全量 2239 passed / 3 failed 既有基线。
- Notes：服务端「什么时候返回 false」的判定未动。

## compaction-gate-single-source（done，2026-11-09）

- 起因：用户没听懂「压缩前判定口径统一」，解释后同意做。
- 问题：第 7 关 `hasNewMessagesSinceCompaction()` 只认 `contextCompaction` 元数据，而算占用的 `minimumProviderUsageIndex()` 早已按消息里的摘要定界。`/summary` 新会话与 fork 出来的压缩会话只有摘要消息、没有元数据 → 第 7 关恒放行 → 没有新内容也先空压一次。
- 改动：统一以消息里的摘要为压缩点（`summaryIndexInMessages`）；判定顺序 ① `sourceMessageCount` 变长 ② 有普通消息时间戳晚于 `compactionCutoffMs`（摘要消息与 `kind: 'notice'` 不算新内容）③ 全无时间戳时退回「摘要之后是否还有普通消息」。新增 `isCompactionMessage`。
- 为什么不能只看长度：`/summary` 与 fork 会把压缩前的最近几轮原样带在摘要后面，数组一直更长，但那些消息的时间戳更早。
- Evidence：压缩相关 3 files / 31 passed（auto-compaction 14 → 16）；`eslint` 0 problems；server 全量通过（同上）。wiki 第 7 关与「已知口径不一致」段落同步改写。

## working-memory-tool-gate（done，2026-11-09）

- 起因：工作记忆默认关闭，但主 Agent 与子 Agent 仍能往 `~/.quickforge/working-memory` 写笔记。用户拍板方案 B——关闭时读写一起关，不给「能读不能写」的半开状态。
- 改动四处：① `createServerTools()` 注册 `memoryNoteTools` 前判 `isWorkingMemoryEnabled()`；② `listAvailableAgentTools()` 改 async，关闭时不列出笔记工具；③ 子 Agent 的 `effectiveAllowedTools` 过滤 `MEMORY_READ_TOOL_NAMES`（否则提示词列出不存在的工具）；④ `POST /api/tools/<note-tool>` 直调返回 403——agent 侧关了但 HTTP 旁路还能写盘，这条最要紧。
- 刻意不改：`agent-profile-schema.mjs` 的能力策略、`approval-store.mjs` 的 `safeReadTools` / `planAllowedTools`。工具不注册时它们自然用不上，保留可避免 Profile 里已有的旧配置被判非法。
- Evidence：新增两个测试文件（注册层 2 例、直调层 2 例），`agent-profiles.test.mjs` 原用例改 await 并显式开启、新增关闭时全部隐藏一例；定向 6 files 全过；server 全量 211 files / 2239 passed、3 failed 既有基线；`eslint` 0 problems。

## doc-reality-sync-2026-11（done，2026-11-09）

- 起因：工作区里留着一批没有留档的文档/注释改动，内容是「文档和注释追认代码现状」，无对应 feature 记录。提交前补记，避免历史里出现来历不明的改动。
- 改动（零运行时代码）：
  1. `docs/architecture/plugin-ui-extension.zh-CN.md`：状态头「设计中 → 实施中」改为「已实施（V1.5）」；`PluginAuditList.tsx` 从「（新增，可选）」改为「（**未实现**）」并注明服务端 `GET /api/plugins/audit` 已有、前端展示组件未落地，避免读者以为组件存在。
  2. `docs/architecture/session-index-foundation.zh-CN.md`：加历史归档横幅——`session_index` 派生索引已整体退役，`server/sqlite/session-index-repository.mjs` 改为对权威 `sessions` 表的只读 LIMIT/OFFSET 直查，同事务 upsert 与重建链路已删除；并补现状表清单（baseline v19）与指向 `session-storage-v2.zh-CN.md` 的链接。
  3. `docs/architecture/session-open-fast-path.zh-CN.md`：「问题二」原描述的是当时的修法（`messageWindowOffset` / `mergeIncrementalMessages` / `mergeWindowedMessages`），这几个符号与对应测试文件已删除；改为「旧实现怎么处理 + 现状」：合并已收敛到 `src/lib/message-log.ts` 的 `applyLog`（按 `baseSeq` 对齐），不变量现由 `tests/frontend/message-log.test.ts` 覆盖。
  4. 三处过时标识符注释：`src/components/chat/panel-decoration/message-rows.ts`（`cachedMessageRows` → `createMessageRowSnapshot`，并说明 `rows()` / `invalidate()` 语义）、`src/lib/subagent-run-detail.ts`（`SubagentRunDetailBody` → `SubagentRunDetailContent`）、`server/session-state-backup.mjs`（`session_states` / `session_index` / mirror 表 → `sessions` / `session_messages` / `session_tombstones`）。
- Evidence（验证）：改后引用的标识符逐个 grep 核对真实存在（`createMessageRowSnapshot` 定义在 `message-rows.ts:61` 且被 `ChatPanelHost.tsx:1192` 使用；`SubagentRunDetailContent` 在 `src/components/workspace/` 下并被 `WorkspaceInspector.tsx` 引用；`session_index` 只出现在 `legacy-migrations.mjs` 等历史文件里）。纯文档与注释，无运行时改动；提交前随工作区合并态跑过 `npm run test`（502 files / 5564 passed、3 failed 既有基线、1 skipped）、`npm run lint`（0 problems）、`npm run build`（通过，仅既有 chunk 体积警告）。
- Notes：
  - 这批改动不是本轮会话做的，来源会话未留档；本次只补记录、不改其内容。
  - 3 个既有测试失败与本次及这批改动无关：`tests/server/acp/server.workspace-mapping.test.mjs` 2 例（`setActiveProjectPath` 返回 undefined）、`tests/server/sqlite-quick-check-gate.test.mjs` 1 例，已由前序会话用 `git worktree` 在干净 HEAD 复现。

## release-2-4-2（done，2026-11-09）

- 起因：用户说「发布一个小版本」，按 `docs/architecture/patch-release-runbook.zh-CN.md` 把 `2.4.1` 推到 `2.4.2`。
- 发布前处理：工作区有一批已验证但未提交的 `context-usage-review-cleanup` 改动（交接文档记录 test/lint/build 三批全过、尚未实机验收），用户拍板「一起发」。于是先提交 `6a811a6d`（代码 + 测试 + wiki）与 `206aeaaa`（状态文件），并把 `feature_list.json` / `session-handoff.md` 里的「未提交」表述改成已提交，保证 tag 的源码与实际打包内容一致。
- 发布内容：`v2.4.1..HEAD` 只有两个代码提交——`ae5be252`（上下文占用只认服务端上报；任务中途第二次压缩按当前摘要切片，修「压完不降、每步都压」）与 `6a811a6d`（服务端 contextUsage 字段瘦身、来源判定收敛、百分比改由前端按当前模型窗口换算、删死 i18n 键）。
- 步骤：`npm version patch --no-git-tag-version`（→ 2.4.2）→ `CHANGELOG.md` 新增 `## [2.4.2] - 2026-11-09`（Fixed / Changed / Removed / Released）→ `README.md`「当前版本」2.4.1 → 2.4.2 → 三件套 → runtime 包 + 离线包 + `npm pack` → release commit + tag + push。
- Evidence（验证）：`npm run test` → 502 files / 5559 passed、2 skipped、exit 0；`npm run lint` → 0 problems；`npm run build` → 通过（`tsc -b` + `vite build` 4.34s，precompress 225 files 12.67MB → 6.49MB，仅既有大 chunk warning）；`prepare-runtime-package.cjs` + `prepare-offline-package.cjs` → 产物版本 2.4.2；`npm pack` → `package-offline/shawnstack-quickforge-2.4.2.tgz`（14.5 MB / 1036 files）。release commit `bdb39c87`，tag `v2.4.2`，已推送 `origin dev`（`f0391199..bdb39c87`）与 tag。
- Notes：
  - `npm whoami` 仍是 401（未登录），所以没有 `npm publish`，只留命令。
  - test 日志里的 `Failed to load plugin lifecycle-test: RolldownError: Parse failure` 与若干 SQLite / MCP ERROR 日志是既有测试噪声（502 files 全过），未处理。
  - 生成产物（`dist/` / `package-dist/` / `package-offline/`）未入库，未手工修改。
- Next Session（下一步）：见 `session-handoff.md` 顶部条目。

## context-usage-review-cleanup（done，2026-11-09）

- 起因：用户看完成 `ae5be252` 的评审结论后说「好的清理死代码」，要求先把评审里列的低风险项一次性清完再统一验证。
- 改动：
  1. `src/components/chat/context-usage.ts`：`ServerContextUsageInfo` 与 `normalizeServerContextUsage()` 瘦身——删掉前端从不读的 `usedTokens` / `totalTokens` / `estimatedInputTokens` / `knownInputTokens` / `providerContextTokens` / `percent` / `color` 入参字段；百分比与颜色改由前端按**当前模型窗口**换算（`inputTokens / contextWindow`，与后端同式 `Math.round(x*1000)/10`），切模型后沿用上一次上报值也按新窗口重算，不再把旧窗口的比例带过来（评审问题 3）。
  2. 来源判定收敛成一处：`usage.inputTokenSource === 'unavailable' || inputTokens <= 0 → 'unavailable'`，否则 `provider`（评审问题 1 原有的两套判定不一致：`update()` 里按 source 判死、`normalize` 里按数值算）。
  3. `buildContextUsageTitle()` 改为 `{ usage, compacted, stale }`，窗口取自 `usage.contextWindow`，来源固定写 `contextUsageSourceProvider`——没有上报就不渲染指示器，所以「服务端计算」这个分支本来就进不去（评审问题 2）。
  4. 死 i18n 键清理：删 `contextUsageServerCalculated`、`contextUsageSourceUnavailable`（改名为 `contextUsageStaleShort`）、`contextUsageSourceServerShort`（meta 行不再声明来源，改成「只报时效 + 统计范围」，没有时效问题就只显示范围）。中英各一处，现无引用。
  5. `src/components/chat/chat-utils.ts`：`ContextUsageInfo` 同步删掉 `usedTokens` / `totalTokens` / `estimatedInputTokens` / `knownInputTokens`（评审问题 4，此前只有定义处，无读写）。
  6. 测试：`tests/frontend/context-usage.test.ts` 去掉负载里已不被读取的 `percent` / `estimatedInputTokens` 字段；旧键断言改成 `contextUsageStaleNote`（原断言查的键名已不存在，等于空转）；新增 1 例「切换模型后按新窗口重算沿用值」（100K→200K 窗口，40K 从 40% 变 20%）；死键断言扩到三个已删键。
  7. 文档：`docs/wiki/src/components/README.md` 的 `context-usage.ts` 段补「百分比按当前模型窗口前端换算、不采用负载 `percent`」，meta 行描述改为「只显示统计范围 + 陈旧提示」，并修掉文件树里早已过期的行数（78 行 → 631 行）。
  8. 第二批（用户确认「无消费者即可移除」后）：核实仓库源码里除类型契约与测试断言外，无任何模块读取 `totalTokens` / `estimatedInputTokens` / `knownInputTokens` / `providerContextTokens` / `breakdown.lastUsageIndex`，于是服务端一并删掉。`server/context-usage.mjs` 返回值只剩 `inputTokens` / `inputTokenSource` / `contextWindow` / `percent` / `breakdown`，本地估算变量改名 `localEstimatedContextTokens` 并补注释；`server/auto-compaction.mjs` 空消息分支删掉三个 0 值别名；`src/lib/server-agent-types.ts`（传输契约）、`chat-utils.ts`、`context-usage.ts` 三处类型同步收缩。注意 `contextUsage.totalTokens` 与 pi-ai assistant message 原生 `usage.totalTokens` 是两回事，后者仍被持久化与侧聊使用，未动。
  9. 第二批测试与文档：`tests/server/context-usage.test.mjs` 的 `expectExistingTotalsUnchanged()` 改为校验 `breakdown.localEstimatedContextTokens === systemPrompt + tools + messages`，并断言四个已删字段 `in usage === false`；`tests/server/auto-compaction.test.mjs` 的 `knownInputTokens` 断言改 `inputTokens`、删 `totalTokens` 断言；`docs/wiki/server/README.md` 三处口径表述同步（不再返回别名、不再有只写不读的 `lastUsageIndex`）。
  10. 第三批（用户回「好的 开始清理」后）：`breakdown.localEstimatedContextTokens` 是最后一个只写不读的字段——前端悬浮明细按 `systemPromptTokens` / `toolsTokens` / `messagesTokens` / `skillsTokens` / `mcpTokens` 逐行渲染，从不读这个合计值；测试里唯一的消费者是那句「等于三项之和」的自证式断言。于是 `server/context-usage.mjs` 删掉 `localEstimatedContextTokens` 变量（含注释）与 `breakdown.localEstimatedContextTokens` 返回项，三处 `breakdown` 类型（`src/lib/server-agent-types.ts` / `src/components/chat/chat-utils.ts` / `src/components/chat/context-usage.ts`）同步删字段。现服务端返回值只剩 `inputTokens` / `inputTokenSource` / `contextWindow` / `percent` / `breakdown{systemPromptTokens, messagesTokens, toolsTokens, skillsTokens, mcpTokens, providerUsageTokens, trailingTokens}`。测试：`expectExistingTotalsUnchanged()` 去掉求和断言、改断言 `'localEstimatedContextTokens' in usage.breakdown === false`（四个已删字段的 `in usage === false` 保留），unavailable 用例改断言 `usage.breakdown.messagesTokens > 0`。`docs/wiki/server/README.md` 三处口径改为「本地估算只保留在 `breakdown` 的三项拆分里」，返回值说明追加「不再有 `lastUsageIndex` / `localEstimatedContextTokens`」。
- Evidence（验证）：第一批：`npx tsc -b` → exit 0；`npm run lint` → 0 problems；定向 `npx vitest run tests/frontend/context-usage.test.ts tests/server/context-usage.test.mjs tests/server/auto-compaction.test.mjs` → 3 files / 45 passed；`npm run test` → 5559 passed、2 skipped、exit 0（比上一轮多出的 1 例即新增的切窗口用例）；`npm run build` → 通过（仅既有 >500kB chunk warning）。第二批：`npx tsc -b` → exit 0；定向 `npx vitest run`（frontend/context-usage 12 + server/context-usage 19 + server/auto-compaction 14 + frontend/context-compaction-rows 4）→ 4 files / 49 passed；`npm run lint` → 0 problems；`npm run test` → 502 files / 5559 passed、2 skipped、exit 0；`npm run build` → 通过（precompress 225 files 12.67MB → 6.49MB，仅既有大 chunk warning）。第三批（删 `breakdown.localEstimatedContextTokens`）：`npx tsc -b` → exit 0；定向 `npx vitest run`（frontend/context-usage 12 + server/context-usage 19 + server/auto-compaction 14 + auto-compaction-history 8 + auto-compaction-notice 5 + context-compaction-rows 4）→ 6 files / 62 passed；`npm run lint` → 0 problems；`npm run test` → 502 files / 5559 passed、2 skipped、exit 0；`npm run build` → 通过（precompress 225 files 12.67MB → 6.49MB，仅既有大 chunk warning）。另用 `node --input-type=module` 打印真实返回结构确认：无上报时 `inputTokens:0` / `unavailable` / `percent:0`，有上报时 `inputTokens:41000` / `percent:41` / `providerUsageTokens:41000`，且 `'localEstimatedContextTokens' in breakdown === false`。未触碰 `dist/`、`package-dist/`、`package-offline/`（build 输出为脚本产物，未纳入 Git）。未创建 commit/tag。
- Notes：
  - 三轮遗留问题都已在这轮清掉：服务端 `totalTokens` / `estimatedInputTokens` / `knownInputTokens` / `providerContextTokens` / `breakdown.lastUsageIndex` 已删除（第二批），最后一个只写不读的 `breakdown.localEstimatedContextTokens` 也已删除（第三批）；`breakdown` 现在只剩真正被悬浮明细逐行读取的拆分项与 `providerUsageTokens` / `trailingTokens`。
  - 风险：仓库外是否还有 API 消费者依赖被删字段未确认；`src/lib/server-agent-types.ts` 是传输契约，已同步收缩。`package-dist/` / `package-offline/` / android assets 里仍是旧实现（含 `mixed`、`estimatedInputTokens`），属历史构建产物，重新打包前不影响源码。
  - 未决风险仍在：代理/兼容服务不返回 usage 时自动压缩完全不触发（`inputTokens <= 0` 直接 return false），是否加兜底开关待用户拍板。

## compaction-midrun-stale-summary（done，2026-11-09）

- 起因：用户反馈「压缩后马上又满，任务做到一半又压缩」。上一条 `context-usage-provider-only-accounting` 记录的「压缩内容没有重发」不完整，漏了本条场景。
- 根因：pi-agent-core 每次 run 用启动时的消息副本。副本里已有旧摘要时，run 内新摘要只写入 state；`buildAutoCompactLoopMessages` 按「副本里最后一条摘要」切片，发给模型的仍是旧摘要 + 之后全部消息，上下文不降，下一次请求前再次压缩。
- 改动：`server/auto-compaction.mjs` 新增 `summaryIndexInMessages()`，`buildAutoCompactLoopMessages` 与 `minimumProviderUsageIndex` 共用，当前摘要只在 state 时忽略副本里的旧摘要；`compactionSnapshotShift()` 在传入数组已含当前摘要时返回 0。`tests/server/auto-compaction-history.test.mjs` 新增 4 例（修复前 2 例失败，另 2 例为防回归）。`docs/wiki/server/README.md` 同步。
- Evidence（验证）：压缩相关 8 files / 80 passed（改动后同批复跑仍全过）；`npm run test` → 502 files / 5558 passed、2 skipped（含同批 context-usage 新增用例）；`npm run lint` → 0 problems；`npm run build` → 通过。未做真实长会话实机验证。已提交 `ae5be252`，无 tag。
- Notes（同一排查发现、未纳入本次）：压缩后到下一次回复前界面沿用旧百分比；压缩失败后每次请求都重试、无等待间隔；同一 run 第二次压缩会让上一条摘要从 state 消失（只留在 `contextCompaction.history`），可能影响时间线分割线与回撤，尚未验证。

## context-usage-provider-only-accounting（done，2026-11-09）

- 起因：用户看到「压缩完立刻又满、又压」，怀疑压缩把压缩前内容又发了一遍。核查结论是没发：`buildAutoCompactLoopMessages`（`server/auto-compaction.mjs:212`）从最后一条摘要消息处切片，`transformSessionContext`（`server/agent-manager.mjs:516`）再切一次，压缩请求自身（`buildCompactionSourceMessages`，`server/auto-compaction.mjs:144`）只带「上一版摘要 + 上次切点之后的增量」。真因之一是统计口径——`inputTokens = max(本地全量估算, provider 口径)`（`server/context-usage.mjs`），压缩后已并入摘要的历史仍被本地估算算一遍，于是「压完还显示 85%」。用户拍板「不要本地的，就看服务器返回的」。
- 改动：
  1. `server/context-usage.mjs`：`inputTokens` 只取 `providerBasedContextTokens`；`inputTokenSource` 收敛成 `provider` / `unavailable`；`shouldCompactContextByPercent` 在 `inputTokens <= 0` 时直接返回 false。`estimatedInputTokens` / `breakdown.localEstimatedContextTokens` 保留，作为悬浮说明里的本地估算明细（仅供参考）。
  2. `server/auto-compaction.mjs`：空消息分支的 `inputTokenSource` 改 `unavailable`。
  3. `src/components/chat/context-usage.ts`：删掉本地估算与其按签名缓存，删掉随之失效的 `getSystemPrompt` / `getTools` 选项；新增 `lastKnownServerUsage`——`unavailable` 时沿用上一次上报值并在悬浮说明追加 `contextUsageStaleNote`，一次都没上报过就整个指示器不渲染。
  4. `src/components/chat/chat-utils.ts`：删掉 `getContextUsage` 与 `estimateTokens` 两个前端本地估算入口（`src/` 里已无引用）。
  5. `src/lib/i18n.ts`（新增 `contextUsageSourceUnavailable` / `contextUsageStaleNote` / `contextUsageLocalBreakdownTitle`，中英各三条；删掉 5 个死键）、`src/lib/server-agent-types.ts` / `chat-utils.ts` / `context-usage.ts` 的 `inputTokenSource` 联合类型收成 `provider | unavailable`；`src/styles/chat/composer-controls.css` 新增明细小标题样式。
  6. 测试按新契约改写：`tests/server/context-usage.test.mjs`（新增 provider-only 三条）、`tests/server/auto-compaction.test.mjs`（压缩后旧 provider usage 被忽略时降到 0 而不是回落估算）、`tests/frontend/context-usage.test.ts`（把 `getContextUsage` 用例换成「沿用上一次上报值」「从未上报不渲染」「不重算本地」）。
  7. 文档：`docs/wiki/server/README.md` 统计口径段、`docs/wiki/src/components/README.md` 指示器与 chat-utils 条目。
- Evidence（验证）：定向 vitest 4 files / 50 passed（server/context-usage 19、server/auto-compaction 14、frontend/context-usage 11、frontend/chat-surface-usage 6）；同批压缩回归 `tests/server/auto-compaction-history.test.mjs` 8 passed（合并跑 5 files / 58 passed）；`npx tsc -b` 通过；`npm run lint` → 0 problems；`npm run test` → 502 files / 5558 passed、2 skipped、exit 0；`npm run build` → 通过（tsc -b + vite build，precompress 225 files 12.67MB → 6.49MB，仅既有大 chunk warning）。评审后删掉 3 个固化死逻辑的测试、新增 2 例，全量用例数从 5557 变为 5558。
- Notes（已知代价，用户已确认接受）：
  - 压缩完成到下一次真实回复之间没有新上报值，指示器显示的是上一次的数字（带「该数字来自上一次请求」标注）；新会话首条请求返回前不显示环形指示器。
  - 工具结果膨胀**没有**失去预警：一轮之内工具结果会推高 `trailingTokens`，`inputTokens` 跟着涨，百分比和自动压缩阈值都照常生效。真正没有兜底的只有两个「一个上报值都没有」的时刻——新会话首轮、压缩完成到下次回复之间。
  - 这也解释了用户最初抱怨的「压完又满」的剩余部分：如果系统提示词 + 工具定义本身就占了窗口很大比例，压缩消息部分也降不下来。这种会话不建议再反复压缩。
- 评审修复（用户要求先删死代码，再按评审结论逐项修；改动仍在同一轮、随后提交为 `ae5be252`）：
  1. 死代码：`context-usage.ts` 删掉 `getMessages` / `getEffectiveMessages` 选项，`ChatPanelHost.tsx` 删掉 `effectiveContextMessages()`；`isCompacted` 改由 `usage.isCompacted` / `getIsCompacted?.()` 判断。三个只为固化这段死逻辑而存在的测试同步删除。
  2. 悬浮说明误标「本地估算」：popover 原来用 `Boolean(serverUsage)` 判断来源，沿用上一次数值时会显示 `contextUsageSourceLocalShort`。改为按 `hasServerUsage` 传 `stale`，meta 行显示「上一次请求（尚未更新）」，并删掉死键 `contextUsageSourceLocalShort`。
  3. 缺字段回落错误：旧负载不带 `inputTokenSource` 时原文回落 `'estimated'`，而标题把非 `provider` 一律当 `unavailable`，于是有数值也被标成「尚未更新」。改为按 `inputTokens > 0` 回落 `'provider'`。
  4. 类型收口：`chat-utils.ts` / `context-usage.ts` / `server-agent-types.ts` 三处的 `inputTokenSource` 收成 `'provider' | 'unavailable'`，删掉不可达的 `mixed` 分支和死键 `contextUsageSourceMixed` / `contextUsageSourceEstimated` / `contextUsageLocalEstimate` / `contextUsageProviderTokens`。
  5. 口径表述纠正：`inputTokens` 来自 `pi-agent-core.calculateContextTokens()`（优先 `totalTokens`，缺失时 input+output+cacheRead+cacheWrite）再加尾随消息，含上一条回复的输出与缓存 token，不是「纯输入」。`server/context-usage.mjs` 两处注释、`docs/wiki/server/README.md` 统计口径与自动压缩两段都已改，并同步了「压缩后百分比马上下降」这个过时说法。
  6. 悬浮明细与头部总量对不上：明细拆成两段——「提供商上报基线」（`providerUsageTokens` + 基线后新增消息，二者之和等于头部分总量）与「本地估算明细（仅供参考）」下的系统提示词 / 工具 / 消息 / Skills / MCP 行。新增 i18n 键 `contextUsageLocalBreakdownTitle` 与 `.quickforge-context-usage-tip-section-title` 样式；`docs/wiki/src/components/README.md` 同步。
  7. 测试：`tests/frontend/context-usage.test.ts` 新增「旧负载不带 source 仍按提供商处理」「沿用数值不得叫本地估算」两条。
- Next Session（下一步）：见 `session-handoff.md` 顶部条目。

## release-2-4-1（done，2026-11-06）

- 起因：用户说「发布一个小版本」。按 `docs/architecture/patch-release-runbook.zh-CN.md` 走手动流程（不跑 `npm run release:patch:prepare`，runbook 3.2 已记录它在 Windows 上 `spawnSync npm.cmd EINVAL` 失败），把 `2.4.0` 推到 `2.4.1`。
- 发布范围（`v2.4.0..HEAD`，3 个功能提交 + 2 个 docs 提交）：`38f7e4eb` 排队消息不再因发送失败被静默丢弃；`deb17d1d` 压缩摘要的用量口径与回撤锚点；`21429eb7` 子 Agent 可读工作记忆与经验库。
- 改动：
  1. `package.json` / `package-lock.json`：2.4.0 → 2.4.1（`npm version patch --no-git-tag-version`）。
  2. `CHANGELOG.md`：新增 `## [2.4.1] - 2026-11-06`，Added 一条（子 Agent 读笔记）、Fixed 四条（排队消息丢失、回撤后压缩点指向已删摘要、`/summary` 与 fork 会话用量虚高、fork 标题变成压缩提示词）、Released 三条。
  3. `README.md`：顶部「当前版本 **2.3.7**」→ **2.4.1**。这是 README 里唯一硬编码版本处，安装说明本来就用 `@latest`；上一次 2.4.0 发布漏改了这个数字，这次一并补上。
- Evidence（验证）：`npm run test` → 502 files / 5551 passed、2 skipped、exit 0；`npm run lint` → 0 problems（耗时约 3 分钟）；`npm run build` → 通过（仅既有大 chunk 与 plugin timing warning），precompress 225 files 12.67MB → 6.49MB；`node scripts/prepare-runtime-package.cjs` + `prepare-offline-package.cjs` → `package-dist` / `package-offline` 都是 2.4.1；`cd package-offline && npm pack` → `shawnstack-quickforge-2.4.1.tgz`（14.5 MB，unpacked 29.1 MB，1036 files）。release commit `0ce8d622`，tag `v2.4.1`，已推送 `origin dev` 与 tag。
- Notes：
  - `npm publish` 未执行（npm 未登录）。发布命令见 `session-handoff.md`。
  - `dist/`、`package-dist/`、`package-offline/` 均为脚本产物，未纳入 Git。
  - 提交时 husky pre-commit 又跑了一遍 `eslint .`，通过。
- Next Session（下一步）：见 `session-handoff.md` 顶部条目。

## subagent-memory-read-tools（done，2026-11-06）

- 起因：用户问「subagent 是不是应该给读取笔记的工具」。上一轮分析结论是「该给，只给读的两个」——这是漏配，不是刻意的设计决定；用户回「只给只读两个 方案 动手」。
- 定位（结论）：`server/subagents.mjs` 的 `composeSubagentSystemPrompt` 把父会话的**完整** system prompt 原样拼进 `<subagent_instructions>` 前面，那份里带着 `<memory_policy>`、工作记忆与经验库索引，还有一句「open that one file with read_memory_note」。紧接着 Tool constraints 却写 `Allowed tools: read_file, grep_files, run_command`。根因在 `server/agent-profile-schema.mjs`：`AGENT_PROFILE_TOOL_NAMES` 只有 5 个工作区工具，五条能力策略也只列这 5 个，而 `applyCapabilityPolicy()` 会**静默 filter 掉**不在策略里的名字。于是 subagent 看得见菜单点不了菜：要么白试一次被 `not allowed to use read_memory_note` 弹回，要么绕 `run_command` 去 `cat` 绝对路径——run_command 不在 `safeReadTools` 里，要人点审批，无人值守就卡到超时。讽刺的是 `server/tools/memory-notes.mjs` 开头注释写的就是「这几个工具是给不能拿 shell 的后台 agent 准备的」，subagent 正是这种 agent。
- 改动 1（白名单）：`MEMORY_READ_TOOL_NAMES = ['list_memory_notes', 'read_memory_note']` 进 `AGENT_PROFILE_TOOL_NAMES`，并加进全部五条策略。**刻意也给 `code-edit`**：能不能改代码与能不能记住这段代码为什么长这样是两件事；这两个工具只读、锁死两个目录、没有删除。
- 改动 2（免审批）：两个工具进 `safeReadTools`，否则 subagent 调它照样弹框。同时进 `planAllowedTools`——这是上一轮分析漏掉的连带问题：`/plan` 白名单会在 `commandToolPermissionError` 里直接拒绝未列名的工具，而 /plan 明确允许调用只读 subagent，不补的话「计划模式里叫 explore 查笔记」会报一个自相矛盾的错（明明只读却说不许用）。
- 改动 3（可选工具列表）：`listAvailableAgentTools()` 原先只从 `workspaceTools` 派生，笔记工具不在里面，自定义 Profile 页根本勾不到；改为 `[...workspaceTools, ...memoryNoteTools]` 再过 `allowedToolNames`，写/移笔记自然被挡住。
- 改动 4（提示词口径）：具备笔记工具时补一行「start from the index already in this prompt and open only the notes that clearly apply；索引里没有相关的就别翻文件夹」，防止把有限的工具调用预算花在扫目录上；Explore 的 systemPrompt 明确笔记是先前上下文、不是仓库证据。
- 不改的那半边：`write_memory_note` / `move_memory_note` 不进白名单。subagent 短命且可能并行，各自判断「这条值得记」会往同一份工作记忆塞重复笔记，而收尾沉淀本来就是父会话的活（`memory_policy` 那句「一件事做完，回头看看」是说给父的）。
- 改动文件：`server/agent-profile-schema.mjs`；`server/approval-store.mjs`；`server/agent-profiles.mjs`；`server/subagents.mjs`；`tests/server/agent-profiles.test.mjs`；`tests/server/subagents.test.mjs`；`tests/server/approval-store.test.mjs`；`docs/architecture/memory-system.zh-CN.md`；`docs/architecture/custom-agents-design.zh-CN.md`；`docs/wiki/server/README.md`；`feature_list.json`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：定向 5 files / 57 passed；`tests/server` 全量 → 207 files passed / 2 failed（3 个失败用例，均为既有基线：ACP workspace-mapping 2 + sqlite quick_check 1）；`npm run lint` → 0 problems。
- Notes：
  - 上一轮分析里说错了一句「前端不用改，UI 会自动多两项」——`listAvailableAgentTools()` 从 `workspaceTools` 派生，笔记工具压根不在那个数组里，必须显式合并。改动已包含。
  - `safeReadTools` 现在含 4 个工具，`tests/server/approval-store.test.mjs` 里那条「白名单只有 read_file / grep_files」的守护断言已同步更新为「只读工具白名单」。
  - 内置 explore / general 的 Markdown 由 `ensureBuiltinSubagentMarkdownFiles()` 按全内容比对重写，`tools:` 行会随之更新，旧安装不需要手工改文件。
  - 未跑 `npm run build`：改动只在 server 侧 `.mjs` 与文档，前端与构建配置没动；`npm run lint` 已过。已提交 `21429eb7` 并推送 `origin dev`；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## queued-messages-never-drop（done，2026-11-06）

- 起因：用户反馈「shell 后台命令的回调会让队列里排队的消息被清理掉」，要求「不能丢」。
- 定位（结论）：排队消息只活在前端 `localStorage`（`quickforge:message-queue:v1`，按 `session:<id>` 分开），服务端根本不知道它存在，所以「命令删队列」这种直接因果不成立。真正的链路是：后台命令跑完时服务端会自己 `session.agent.prompt(notice)` 开一轮（`server/agent-manager.mjs` 的 `deliverBackgroundCommandNotification`），凭空多出一次 `agent_end`，把前端「回合结束自动发下一条」的调度撞进服务端 `runPrompt` 的 409 并发保护；而前端判断「发出去没有」的标准是「promise 有没有 reject」，`ServerAgent.prompt` 恰好有三种静默 return（已销毁 / 无写租约 / 已在流式）。于是静默失败被当成成功，`message-queue-drainer` 的循环一口气把整队列删光且一条都没发出去——就是用户看到的「两条一起消失」。
- 修复 1（权威信号）：`ServerAgent.prompt` 由 `Promise<void>` 改为 `Promise<boolean>`，`true` = 服务端 2xx 接受，`false` = 没发出去；fetch 从 fire-and-forget 改为 `await` 后判定，HTTP 失败走原有回滚 + `agent_end(error)` 并返回 `false`；`retryFailedPrompt` 透传结果；`DeferredSessionAgent.prompt` 转发真实 agent 的结果。
- 修复 2（绝不丢）：`message-queue-drainer` 与 `panel-wiring/message-queue.ts` 的 `submitQueuedPrompt` 只有 `accepted === true` 才删条目；否则 `restoreHead` + 暂停并落盘（`restoreHead` 对仍在队列里的条目是幂等的）。自评审补上同源漏洞：`ServerAgent.steer` 也有同样的静默 return，「立即」（steering）路径改为返回 `Promise<boolean>`，`submitJump` 只在 `true` 时删条目。自评审时补上同源漏洞：「立即」（steering）路径的 `ServerAgent.steer` 也有同样的静默 return，改为返回 `Promise<boolean>`，`submitJump` 只在 `true` 时删条目，`false` 则保留并暂停。
- 修复 3（空 state 覆盖）：panel 增加 `hydrated` 标记；面板在 hydrate（双 rAF 之后）之前被销毁时，不再用内存里的空队列覆盖 `localStorage` 已存的排队消息，也不把这种 agent 交给后台续发。
- 改动文件：`src/lib/server-agent.ts`；`src/lib/deferred-session-agent.ts`；`src/lib/message-queue-drainer.ts`；`src/components/chat/panel-wiring/message-queue.ts`；`tests/frontend/message-queue-drainer.test.ts`（新增 2 例）；`tests/frontend/server-agent-session-lease.test.ts`（补断言）；`tests/frontend/server-agent.test.ts`（HTTP 失败用例适配同步返回）；`feature_list.json`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：定向 4 files / 181 passed（drainer 11、message-queue 21、session-lease 14、server-agent 135）；`npm run test` → 500 files passed / 3 failed（5545 passed）；`npm run lint` 0 problems；`npx tsc -b` 通过；`npm run build` 通过（仅既有 chunk 体积警告）。
- Notes：
  - 剩余 3 个失败都在 server 侧且本次未触碰：`tests/server/sqlite-quick-check-gate.test.mjs`（`expected 'marker' to be 'process'`）、`tests/server/acp/server.workspace-mapping.test.mjs` 两例（`setActiveProjectPath` 返回 undefined）。工作区里同时存在其他会话未提交的 `server/agent-manager.mjs`、`server/auto-compaction.mjs` 等改动，合并后需要复跑确认归属。
  - 行为变化：`prompt()` 现在等 HTTP 答复后才 resolve，`await prompt()` 返回时失败回滚已同步完成；原先依赖「await 立刻返回」的调用点/测试需要适配（本次已改 `tests/frontend/server-agent.test.ts`）。
  - 仍保留的设计风险：面板 `cleanup()` 会把队列交给即将被销毁的 agent 去续发；现在最坏结果从「删光」变成「暂停保留」，但用户切回会话需要手动点继续。后续可考虑让 cleanup 不复用旧 agent。

## compaction-rollback-fork-title-fix（done，2026-11-06）

- 起因：用户问「压缩后回撤会不会有问题，还有 fork」。第一轮分析里有一条判断错了——以为回撤锚点会命中压缩摘要、把摘要灌进输入框；复核按钮挂载后确认回撤按钮只挂在 user 行（`message-actions.ts:755-804`），assistant 行只有 copy/fork，所以锚点永远是用户点的那条消息，主路径没问题。只修两条确认成立的 bug。
- 修复 1（服务端，多摘要回撤的幽灵内容）：滚动压缩每次往数组**追加**一条摘要，旧摘要留在原处。回撤/重试截掉「当前」那条摘要后，`syncCompactionIndex` 只改下标，`contextCompaction.summaryMessage` 仍指向已删除的消息；下一次压缩把它当 `previousSummary` 重建摘要源，用户已经回撤掉的内容会重新出现在新摘要里。改为 `syncCompactionIndex(session, index, count, summaryMessage)`，两处调用点（`rollbackSessionMessages` / `continueSession`）传入 `nextMessages[compactionIndex]`。
- 修复 2（前端，fork 标题）：`generateTitle` 取首条 user 消息，而 `/summary` 生成的新会话首条就是压缩摘要，fork 后标题变成「The previous conversation has been compacted…」。改为跳过 `isCompactionMessage` 的消息；只剩摘要时回落到 `[fork] New chat`。
- 改动文件：`server/auto-compaction.mjs`；`server/agent-manager.mjs`（两处调用点）；`src/lib/message-utils.ts`；`tests/server/agent-manager.rollback-compaction.test.mjs`；`tests/frontend/message-utils.test.ts`。
- Evidence（验证）：目标测试 2 files / 21 passed（新增 2 例：回撤到两条摘要之间时 `summaryMessage` 指向幸存摘要且 `compactedUpToIndex` 正确；fork 标题跳过摘要，另加只剩摘要时回落 `[fork] New chat`）；压缩与 fork 回归 10 files / 76 passed；`npx eslint` 改动文件 0 problems；`npm run build` 通过。
- Notes（都是既有行为，本次按「只修复 bug」没动）：
  - 压缩刚结束、数组末尾还是摘要时，UI 的「最后一条用户消息」判定（`role !== 'assistant'`）会指向摘要，普通重试按钮那一小段时间不出现；若此时恰好终态报错，错误行的重试会把摘要当用户请求重发（`continueSession` 的 `lastUserIndex` 同样不排除摘要）。需要「压缩后立刻报错」才触发。
  - `/summary` 的提示行（`kind: 'notice'`）不被 `isCompactionMessage` 认作压缩消息，所以它有 fork/回撤按钮。
  - fork 不复制 `contextCompaction`：模型上下文仍然正确（压缩点由消息 `details` 表达），只是元数据/用量口径不一致，再次压缩会把旧摘要当普通历史多压一遍。
  - `hasUserMessage` 仍把压缩摘要算作用户消息（本次只改标题，未动它，避免影响 `shouldSaveSession`）。

## compaction-usage-stale-provider-usage（done，2026-11-06）

- 起因：用户反馈「压缩后上下文并没有减少，在某些时候」。
- 复现：`/summary` 生成的新会话（`messages = [摘要, 提示行, ...保留的最近几轮]`，没有 `contextCompaction` 元数据）。tail 里那条 assistant 还带着压缩前那次请求上报的 provider usage，`estimateContextUsage` 的 `Math.max(本地估算, provider)` 取了大值——界面显示 `isCompacted: true` 且 42%，实际发给模型的上下文只有 1%。发一条新消息后新回复带的是压缩后的真实 usage，所以只是「某些时候」。
- 根因：`minimumProviderUsageIndex` 只认 `contextCompaction.summaryMessage`，而压缩点的权威表达是「消息里的摘要」（方案 B）。`buildAutoCompactLoopMessages` 已经按消息判定，它没跟上，两个口径不一致。fork 出来的压缩会话同理会中招。
- 修复（`server/auto-compaction.mjs`）：
  1. `minimumProviderUsageIndex` 先用 `lastCompactionMessageIndex` 定界，压缩时刻用摘要消息自己的 timestamp 兜底；
  2. 新增 `compactionCutoffMs()` 与 `withoutStaleProviderUsage()`：估算前把「压缩点之前产生、却被 tail 原样保留」的 assistant usage 遮掉（时间戳未知的不动，避免误伤旧数据）；
  3. `estimateSessionContextUsage` 与 `maybeAutoCompactSession` 共用同一份估算消息，显示口径与阈值判断一致。
- 改动文件：`server/auto-compaction.mjs`；`tests/server/auto-compaction.test.mjs`；`progress.md`；`session-handoff.md`。
- Evidence（验证）：`tests/server/auto-compaction.test.mjs` 14 passed（新增 2 例：摘要 + 旧 usage 不被当成当前占用；压缩后新回复恢复 provider 口径）；压缩 / 用量回归 10 files / 96 passed；前端 usage 2 files / 17 passed；`npx eslint` 改动文件 0 problems；`npm run build` 通过。
- Notes（不是 bug，但会影响观感）：
  - provider 的 `totalTokens` 含输出 token（pi-agent-core `calculateContextTokens`），读数本身略偏高，本次未动。
  - 系统提示词与工具定义不随压缩减少；小上下文窗口 + 大量工具时，压缩后总占用可能只小幅下降，这是口径问题。

## release-2-4-0-minor（done，2026-11-05）

- 触发：用户「发布一个中版本」。确认后按 minor 执行：`2.3.7 → 2.4.0`，范围是 `v2.3.7` 之后全部 12 个提交，Git 走 commit + tag + push `origin dev`。
- 为什么是 minor 不是 patch：这 12 个提交里有新能力（桌面端内嵌 AI 浏览器、三层记忆体系 + 梦境逐会话整理员、经验库/工作记忆设置页）和删除性变更（退役 `recall_experience`、删 IndexedDB 会话快照缓存、删 goal v2 的 `goal_report` 路径），不是纯修复。runbook §2 明确 minor 需先确认，已征得同意再动。
- 步骤（走 runbook 3.3–3.7 手动流程，未用 `release:patch:prepare`，Windows 上有已知 `spawnSync npm.cmd EINVAL`）：
  1. `npm version minor --no-git-tag-version` → `package.json` / `package-lock.json` 三处版本号均为 2.4.0。
  2. `CHANGELOG.md` 新增 `## [2.4.0] - 2026-11-05`，分 Added / Changed / Fixed / Removed / Released；原 `[Unreleased]` 里唯一一条（经验索引 200 行 + 字符上限 20000）归入 Changed，`[Unreleased]` 保留为空章节。
  3. `README.md` 未改：现全文只用 `@shawnstack/quickforge@latest`，没有版本徽章、离线包路径、tag 文案三类硬编码，属于 runbook 3.4 的空操作。
  4. 验证：`npm run test` → 502 files 全过；`npm run lint` → 0 problems；`npm run build` → 通过（precompress 225 files 12.67MB → 6.49MB；chunk >500kB 为既有无害 warning）。注意：三件套里记录的既有基线失败（ACP workspace-mapping 2 + sqlite `quick_check` 1）本次已不再出现。
  5. 打包：`prepare-runtime-package.cjs` / `prepare-offline-package.cjs` 成功，`cd package-offline && npm pack` → `package-offline/shawnstack-quickforge-2.4.0.tgz`（npm 报 14.5 MB / 1036 files）。
  6. Git：release commit `2bb5d9cd`，tag `v2.4.0`，已 push `origin dev`（`10955c03..2bb5d9cd`，tag 为新建）。
- Notes / 已知取舍：
  - `npm whoami` 返回 401（本机未登录 npm），因此没有执行 `npm publish`，只给用户手动发布命令。
  - 桌面端内嵌浏览器与三层记忆体系都是本次首次随 npm 版本对外，实机验收（内嵌浏览器自愈、记忆目录打开、压缩只出现「正在整理上下文」）仍需各自 feature 的 Next 项收尾。
  - `dist/`、`package-dist/`、`package-offline/` 全部由脚本生成，未手工修改，也不进 Git。

## experience-library-open-actions（done，2026-11-05）

- 起因：用户要求「梦境记忆 → 经验库也像工作记忆一样有打开按钮，UI 保持统一」，追问后确认「两个都要」：每条经验一个「打开」+ 整个经验库一个「打开文件夹」。紧接着用户又说「好的 执行」，把工作记忆页的「打开文件夹」也补齐，两页对称。
- 判断：工作记忆那条路径已经完整（校验名字 → 服务端拼路径 → 系统文件管理器定位），经验库没有理由再写一套。所以先把 `openWorkingMemoryNote` 的逻辑抽成 `note-store.mjs` 的 `revealNoteFile(dir, name, options)`，两个目录共用；差异只在「哪个目录」和「要不要先建目录」。
- 改动：
  1. `server/note-store.mjs`：新增 `revealNoteFile()`（`normalizeNoteName` 校验 + `fs.access` 存在性 404 + `options.openPath` 可注入）。`server/working-memory.mjs` 的 `openWorkingMemoryNote` 与 `server/experiences.mjs` 新增的 `openExperience` 都变成它的薄壳。
  2. `server/experiences.mjs`：新增 `openExperiencesFolder()`——先 `ensureExperiencesDir`（顺带建 `_archive/`）再 reveal，新装机器上目录还不存在时也能点。`server/working-memory.mjs` 补同款的 `openWorkingMemoryFolder()`（`ensureWorkingMemoryDir` + reveal），两边对称。
  3. `server/routes/dreaming.mjs`：`handleDreamingApi(req, res, url, options = {})` 增加可选第 4 参（向后兼容，沿用 working-memory 路由的 `dataDir` / `openPath` 注入约定，路由测试不必 mock 整个目录层）；新增 `POST /api/dreaming/experiences/open`（body `{name}`）与 `POST /api/dreaming/experiences/open-folder`，都放在原有 GET 分支之前。`server/routes/working-memory.mjs` 新增 `POST /api/working-memory/open-folder`（只接受 POST，GET 405）。
  4. 前端：`dreaming-data.ts` 加两个 fetcher；`DreamingSettingsTab` 经验库工具条加「打开文件夹」，经验行从 `quickforge-recall-*`（聊天工具卡的样式）换成设置页通用的 `quickforge-settings-list-item` + `quickforge-settings-list-item-actions`，按钮复用工作记忆同款 `Button variant="ghost" size="sm"`；打开失败单独提示在列表下方，不占用整页错误态。`WorkingMemorySettingsTab` 在「笔记文件夹」目录行、路径 `code` 后面加同款「打开文件夹」按钮（那里本来就是 `display:flex` 的 row-control，不需要新样式）。
  5. `src/styles/settings/dreaming.css`：`.quickforge-dreaming-list` 这组规则原本是上一版记忆列表留下的、已无使用者，改成此行场景：行不再自带横向内边距（外层卡片已有 `p-5`），actions 保持 `nowrap`。
  6. i18n：`dreamingExperienceOpen` / `dreamingExperienceOpenFolder` / `workingMemoryFolderOpen`，中英各 3 条。
- 验证 / Evidence：
  - `npx vitest run tests/server/routes/dreaming.test.mjs` → 14 passed（新增 5 例：打开单条、拒绝 `../` 逃逸、拒绝不存在的文件、缺名字 400、打开并创建文件夹）。
  - `npx vitest run tests/server/routes/working-memory.test.mjs` → 12 passed（新增 2 例：打开并创建目录、GET 405）。
  - `npx vitest run tests/frontend/dreaming-experiences-open.test.ts` → 3 passed（每行一个打开、按名字 POST、文件夹 POST）。
  - `npx vitest run tests/frontend/working-memory-settings-tab.test.ts` → 5 passed（新增 1 例：目录行「打开文件夹」发 POST）。
  - `npm run lint` → 0 problems；`npm run build` → 通过（chunk 体积警告为既有无害警告）。
  - 全量 `npm run test` → 502 files / 5552 passed / 3 failed / 1 skipped；3 个失败是既有基线（ACP workspace-mapping 2 + sqlite `quick_check` 1），与本次改动无关（单独跑 ACP 那 2 例在改动前后一样失败）。
- Notes / 已知取舍：
  - 两个「打开文件夹」按钮位置不同，是因为两页结构不同：工作记忆有「笔记文件夹」目录行，按钮就贴着路径；梦境记忆页没有目录行，按钮放在经验库的筛选工具条里。控件本身（ghost `size=sm`）一样。
  - 「打开」是在**服务端**机器上弹文件管理器（`openPathInFileManager`）。远程/LAN 客户端点头时打开的是服务器那台机器的窗口——这与工作记忆现有的「打开」行为一致，本次没有改变这个语义。
  - `quickforge-recall-*` 样式仍是聊天里 `recall_experience` 历史卡片在用（`recall_experience` 工具本身已退役，但旧会话消息还靠它渲染），所以只挪用了设置页的列表样式，没有动那些 CSS。
  - 未创建 Git commit，未手工修改 `dist/` / `package-dist/` / `package-offline/`。

## run-state-single-authority（done，2026-11-05）

- 起因：用户反馈「回滚（回撤）消息后再发送，某些情况下发送按钮没有变成旋转，但对话有回复」，要求架构最优、不打补丁、不过度设计、行为保持一致。
- 根因：`state.isStreaming` 在 `ServerAgent` 里有 16 处各自赋值，**没有任何单一权威**。回滚的 HTTP 响应先回到客户端，用户立刻点发送 → 本地乐观置 true；而服务端在回滚时广播的 `agent_end`（描述的是**上一轮**结束）还在这条有序流上飞。它到达时本地已有 N+1 条（回滚后 N 条 + 乐观 user 消息），`endEvent.messages.length >= this.state.messages.length` 判假 → 走 fallback → `refreshStateFromServer().finally()` 无条件 `isStreaming = false`，且这次写入不广播任何事件。服务端开新一轮时的 `agent_start` 帧若已先到就被覆盖，此后没有第二次确认机会 → 按钮停在灰色上箭头，消息流照常输出（「不转但有回复」）。本质问题是「结束信号没有身份」：正常发消息不会出现「旧回合的结束晚于新回合开始」，所以缺陷被掩盖。
- 改动（只改 `src/lib/server-agent.ts`，服务端零改动）：
  1. 新增私有字段 `pendingPrompt`（本地已发起、服务端还没确认的回合）与私有方法 `applyServerStreaming(next)`：`true` 清标记；`false` 在标记期间返回 `false`，表示这条结束属于上一轮（不改状态、不触发收尾）。
  2. `isStreaming` 写入从 16 处收敛为「1 个方法 + 4 个本地事实入口」：`prompt()` / `continue()` 乐观置位、`reset()`、404（会话已消失）、`abort()`（用户明确的结束意图，清标记让随后 `agent_end` 照常采纳）。
  3. `case 'agent_end'` 入口先过守卫：不采纳时**整帧丢弃**（不 stop watchdog、不做收尾、不转发、不投影旧消息）；三处 `.finally` 异步收尾改走 `applyServerStreaming(false)`，避免异步写状态覆盖下一回合。
  4. SSE `state` 帧、`/state`、`/status` 全部改走 `applyServerStreaming`；`/status` 的 false 先清标记（主动查询是「此刻事实」，也是未确认回合卡住时的唯一兜底）。
  5. `message_update` 到达即视为本轮已开跑并清标记，缩短未确认窗口。
- 验证 / Evidence：
  - 新增 `tests/frontend/server-agent-stale-run-completion.test.ts`（5 例）：迟到的旧 `agent_end` 被忽略且不转发 / 服务端确认后正常归位 / `state` 帧 `isStreaming:false` 在未确认期间被忽略 / 流式增量视为确认 / `abort()` 之后仍能正常结算。
  - 定向：8 个 `server-agent-*` 测试 187 passed；6 个聊天 UI 测试 41 passed。
  - `npm run test` → 501 files / 5541 passed / 3 failed / 1 skipped（3 个失败为既有基线：ACP workspace-mapping 2 + sqlite `quick_check` 1）；`npm run lint` → 0 problems；`npm run build` → 通过（chunk 体积警告为既有无害警告）。
- Notes / 已知取舍：
  - 等待环（`ChatPanelHost` 的 `replyWaiting`）本次未改：它的脱钩根因是「错误的旧回合帧被转发」，现在迟到的旧 `agent_end` 不再转发，宿主不会误清环。把它搬进 snapshot 派生会改变「assistant `message_start` 就清环」的时序，属于可见行为变化，不做。
  - `DeferredSessionAgent` / `SharedServerAgent` / `SideChatAgent` 有各自的独立生命周期，不在本次范围，未改动。
  - 未触碰 `dist/` / `package-dist/` / `package-offline/`；未创建 Git commit。

## rollback-keeps-session-unified（done，2026-11-05）

- 起因：用户反馈「任务分组发起对话，第一轮用户消息回滚后弹到新发起对话页面」，并指出项目会话没有这个问题、两边逻辑应该复用，要求评审并统一。
- 根因：`performRollback` 对传统回滚（`restoreDraft=true`）额外做了「删旧会话 + `createAgent` 新会话」——`shouldSaveSession(nextMessages)` 为 false 就重建一个空会话并 `attachToView`，`replaceState` 写入新的 `?session=`。再叠加 `App.tsx` 里「新对话空态自动切到项目会话」的 effect（只在 `chatScope === 'global'` 时生效），任务侧就被弹走；项目侧因为 scope 不同没触发那个 effect，看起来「没事」。同一个缺陷在两种 scope 下表现不同，不是两套实现。
- 改动：
  1. `src/hooks/useChatActions.ts`：`performRollback` 删除「删会话 + 建新会话」整段，回滚只截断历史、按需把原文案回填输入框；`project` / `global` 两种 scope 走同一条收尾路径。同步移除不再需要的 `storageRef` 入参、`disposeAgentTask` / `shouldSaveSession` / `initializePiStorage` 引用。
  2. `src/App.tsx`：`showNewChatEmptyState` 增加 `!agentManager.currentSessionId`——空态只属于「真的没有会话」，回滚产生的空会话不再伪装成新对话页，也就不会触发自动切项目会话；调用 `useChatActions` 时不再传 `storageRef`。
  3. `tests/frontend/edit-first-message-resend-keeps-session.test.ts`：第三个用例从「传统回滚删会话重建」改成「传统回滚也保留会话」（断言不删除、不新建、不写 `?session=`、草稿仍指向原会话）。
  4. `tests/frontend/new-chat-empty-state-requires-session.test.ts`（新增）：契约测试，锁住「空态必须没有会话」这一条件，防止回退。
- 验证 / Evidence：
  - `npx vitest run tests/frontend` → 291 files / 3319 tests 全通过。
  - `npx tsc -b` → 通过（无输出）。
  - `npx eslint src/App.tsx src/hooks/useChatActions.ts tests/frontend/edit-first-message-resend-keeps-session.test.ts tests/frontend/new-chat-empty-state-requires-session.test.ts` → 0 problems。
  - 未运行 `npm run build`：会重写 `dist/` 产物，本次改动只涉及前端逻辑，类型检查与全量前端测试已覆盖。
- Notes / 已知取舍：
  - 回滚到第一条后会话留空但仍在列表里，标题仍是原标题。若后续希望空会话重新生成标题，需要服务端在 rollback 时重置 `titleSource`，本次不做。
  - 不要再把「回滚清空」当成「新建对话」：判定空态必须同时看 `currentSessionId`，否则会重新引入本次 bug。
  - 未创建 Git commit，未触碰 `dist/` / `package-dist/` / `package-offline/`。

## global-memory-tool-write-only（done，2026-11-05）

- 起因：用户问「MEMORY.md 管理的 tools 是不是可以不用了」，我给了三档选择，用户拍板「读的部分不要了，那这个应该就是写入」——工具留着，只砍读取动作。
- 判断依据：`MEMORY.md` 每轮已整份注入 `<global_user_memory>`，模型调工具再读一遍等于白烧一轮；写入那一半独有四个保障（路径锁死、16KB + 敏感内容校验、免审批、受 `/命令` allowEdit 管），不能砍。
- 改动：
  1. `server/tools/definitions.mjs`：`globalMemoryTool` 删掉 `action`（原 `Type.Union(['read','write'])`），`markdown` 从 `Optional` 改成必填；description 改成纯写入语义，并写明「当前内容已在 `<global_user_memory>`，别再调本工具去读」。
  2. `server/global-memory.mjs`：`manageGlobalMemory` 删 `action === 'read'` 分支并改名 `writeGlobalMemory`；`'Memory action must be read or write'` 一起删。返回的 `details.action` 仍是 `'write'`——前端渲染器按它分支，历史消息也靠它。
  3. `server/tools/index.mjs`：导入与壳函数跟着改名（工具名 `manage_global_memory` 没动）。
  4. `server/system-prompt.mjs`：`memory_policy` 里「Before writing, read the complete memory」改成「当前文档已在下方 `<global_user_memory>`，直接用那份」，否则是一句做不到的指令。
  5. `src/lib/global-memory-tool-output.ts`：`action === 'read'` 分支保留 + 注释说明只为渲染旧会话的历史结果。
- 声明没动：工具名、免审批（`agent-manager.mjs:876`）、`/命令` 的 `allowEdit` 判定、16KB 上限与敏感内容校验、`GET/PUT /api/memory`、`readGlobalMemoryPrompt()` 注入路径。
- 调研结论（重要）：工具名没有被持久化进任何用户配置——Agent Profile 白名单只认 5 个文件工具（未知名字静默丢弃）、命令存的是 `allow_edit` 布尔量、`settings.json` 只存 `enabled`。所以这次改参数/改函数名不会破坏存量配置。
- Files: 见 `feature_list.json` 的 `global-memory-tool-write-only`。
- 验证：定向 `npx vitest run tests/server/global-memory.test.mjs tests/server/tools/definitions.test.mjs tests/server/system-prompt.test.mjs tests/server/approval-store.test.mjs` → 4 files / 56 passed；`npm run test` → 499 files / 5529 passed / 3 failed / 1 skipped（3 个失败为既有基线：ACP workspace-mapping 2 + sqlite quick_check 1）；`npm run lint` → 0 problems；`npm run build` → 通过（precompress 225 files 12.67MB → 6.49MB）。
- Notes：
  - 改提示词时踩了一下：`<global_user_memory>` 是裸 tag 写进 `memory_policy` 的（policy 文案不过 `escapeXml`），测试里断言原文用裸标签；而 `<global_user_memory>` 的正文才转义。
  - 连带改了 `tests/server/system-prompt.test.mjs:110` 的断言：原来断言「空记忆时不含 `<global_user_memory`」，现在 policy 文案本身会提到这个标签，改成断言不含 `<global_user_memory source`——保留「空时没有内容块」的原意。
  - 未新增依赖；`dist/` 由 build 产出未手工改；未提交 Git。

## experience-index-line-cap-200（done，2026-11-05）

- 反馈：「80 行太小了 设置200行」。
- 改动：
  1. `server/experiences.mjs`：`MAX_EXPERIENCE_INDEX_LINES` 80 → 200。
  2. 同文件 `MAX_EXPERIENCE_INDEX_CHARS` 8000 → 20000。这是必须一起改的：8000 字符大约只装得下 80 行（~100 字符/行），只抬行数不抬字符数，索引仍会在 80 条左右被 `slice()` 截断（还可能切在半行），200 行等于没生效。新值维持同样的 ~100 字符/行比例。
  3. `tests/server/memory-notes.test.mjs`：封顶用例从 90 条改成 210 条（期望 200 条 + 1 行「还有 10 条较旧」页脚）；新增一条 200 条满额用例，断言最旧一条完整出现在索引里且总长 ≤ 20000，防止以后只调行数、被字符上限提前截断。
  4. 文档同步：`docs/architecture/memory-system.zh-CN.md`（结构图 + 上限说明）、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`CHANGELOG.md`。
- Files：server/experiences.mjs、tests/server/memory-notes.test.mjs、docs/architecture/memory-system.zh-CN.md、docs/wiki/README.md、docs/wiki/server/README.md、CHANGELOG.md、feature_list.json、progress.md、session-handoff.md。
- 验证：`npx vitest run tests/server/memory-notes.test.mjs tests/server/dreaming-curator.test.mjs` → 2 files / 24 passed；`npm run lint` → 0 problems；`npm run build` → 通过。未跑全量 test（改动只涉及一个常量与索引渲染，相关用例已覆盖）。未创建 Git commit，未手工改生成产物。
- Notes：
  - 上限仍是常量而非设置项：它直接决定每条消息的固定 token 成本，做成用户可调会让「注入多大」随配置漂移；需要再调就改这两个常量，一起改。
  - 历史条目 `memory-system-experience-library`（第 38 行）里写的「80 行封顶」是当时的记录，未回改；现状以本条为准。

## working-memory-settings-note-list（done，2026-11-05）

- 反馈：「设置 - 工作记忆 不要有笔记怎么写，需要笔记的分页查询，还有打开功能」。
- 拍板（问过用户）：打开 = 在系统文件管理器里选中该笔记文件；列表每行 = 笔记名 + 更新时间 + 打开按钮，每页 20 条，上一页/下一页。
- 改动：
  1. 删除「笔记怎么写」整块（标题、说明、示例折叠），`src/lib/i18n.ts` 中英各删 4 个 key（`workingMemoryNotesStyle` / `workingMemoryNotesStyleDescription` / `workingMemoryExample` / `workingMemoryExampleContent`），确认过只在这个 tab 用过。
  2. `server/note-store.mjs` 新增 `listNotePage()`：只 `stat` 不读正文，返回 `{ notes: [{ name, title, updatedAt }], total }`，目录不存在返回空页。没有复用 `listNoteFiles()`，因为它会为了工具重建索引把每篇正文都读进内存。
  3. `server/working-memory.mjs` 新增 `listWorkingMemoryNotePage()` 与 `openWorkingMemoryNote()`：名字走 `normalizeNoteName()`，路径用 `workingMemoryDir()` 在服务端拼，`fs.access()` 判存在（缺失 404），`options.openPath` 可注入，默认 `openPathInFileManager`。
  4. `server/routes/working-memory.mjs`：`GET /api/working-memory/notes?page&pageSize`（page 最小 1，pageSize 夹在 1–100，默认 20）、`POST /api/working-memory/notes/open`（body `{ name }`；空名 400、非法名 400、文件不存在 404）、未知子路径 404；`server/index.mjs` 的挂载从精确匹配改成前缀匹配。
  5. 前端 `WorkingMemorySettingsTab.tsx`：开关与文件夹两块不动，新增只读笔记列表（标题 + 时间 + 打开）、加载/空/错误态、分页；`i18n.ts` 中英各加 8 个 key。
  6. 新增 `src/styles/settings/working-memory.css`（列表行紧凑、标题省略、时间弱化、分页条），在 `styles/index.css` 里按 settings 区分组 import。
- Files: 见 `feature_list.json` 的 `working-memory-settings-note-list`。
- 验证：`npx vitest run tests/server/routes/working-memory.test.mjs` → 10 passed；`npx vitest run tests/frontend/working-memory-settings-tab.test.ts` → 4 passed；`npm run lint` → 0 problems；`npm run build` → 通过（precompress 225 files 12.68MB → 6.49MB）；`npm run test` → 499 files / 5529 passed / 3 failed / 1 skipped，3 个失败为既有基线（ACP workspace-mapping 2 + sqlite-quick-check-gate 1），与本次改动无关。
- Notes：
  - 「打开」沿用现有 `openPathInFileManager()`：macOS 是 `open -R`（Finder 里选中文件），Windows 是 `explorer /select,`，Linux 打开父目录。全仓本来就没有「用系统默认程序打开某个文件」的实现，要那个得新写一段 spawn。
  - 列表刻意不返回正文，设置页因此不可能变成编辑入口；文案也写明「只能看不能改」。
  - lint 的 `react-hooks/set-state-in-effect` 不允许 effect 里调用会同步 setState 的函数，所以首屏加载写成 effect 内的 async IIFE，翻页单独走 `goToPage()`（先同步置 loading 再调接口）。
  - 测试用 `tests/frontend/settings-react-harness.ts` 的 node-only hooks harness；该 harness 渲染不落地，所以 `Button` 在树里是「带 onClick 的元素」，靠可见文案区分打开按钮与翻页按钮。
  - 发现但未改（避免扩大范围）：`workingMemoryEnabledInfo` 中英文仍写「AI 通过 run_command 读写」，实际早已改成四个记忆工具、目录在 workspace 外也不需要审批，与 `docs/wiki/server/README.md` 的说明矛盾。要改只是一条文案，等用户点头。

## memory-experiences-note-no-dreaming-link（done，2026-11-05）

- 反馈：「设置 → 用户记忆不要有梦境记忆的跳转」，后追加「最底部那块 Dreaming 摘要 + 按钮也不要」。
- 改动一（文案）：`memoryExperiencesNote`（中英）删掉末尾「可在「设置 → 梦境记忆」里查看」/「open Settings → Dreaming to read them」；其余保留——经验库在 `~/.quickforge/experiences/`、以索引形式随本文件注入、由后台任务维护、不在此处编辑。
- 改动二（整块删除）：`MemorySettingsTab.tsx` 去掉页面底部「梦境记忆」section——标题、`memoryDreamingSummary` 状态行（已开启 · N 条 · 模型）、「打开 Dreaming 设置」按钮。连带删除：`/api/dreaming` 的轻量摘要请求、`dreaming` state、`useUIStore` 导入；i18n 键 `memoryDreamingSummary` / `memoryDreamingOpen`（中英）一并删掉，避免死字符串。
- 保留：`useUIStore.requestSettingsTab` 信号与 `SettingsWorkspacePage` 的订阅。它本来是通用跨 tab 跳转设施，MemorySettingsTab 只是当时的唯一生产方；删设施属于额外重构，本次没动，只在 `docs/architecture/zustand-migration.zh-CN.md` 的表格里注明「2026-11-05 起无生产方」。
- Files（改动文件）: src/lib/i18n.ts、src/components/settings/tabs/MemorySettingsTab.tsx、docs/architecture/zustand-migration.zh-CN.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 vitest `settings-workspace-react` + `i18n-language-snapshot` + `ui-store` + `working-memory-settings-tab` 共 33 passed；`npx tsc --noEmit` 0 错误；`npm run lint` 0 problems；`npm run build` 通过（1.44s，precompress 225 files 12.67MB → 6.49MB）。未跑全量 test（改动只在本页与文案，相关页面测试已覆盖）。
- Notes：`hasExperiences` 为真才显示经验库那句提示（逻辑未动）；梦境记忆页仍是经验库的唯一入口，只是用户记忆页不再指路。未新增依赖；未手工改 dist/package-dist/package-offline（`npm run build` 正常重写了 dist）；未提交。

## memory-system-experience-library（done，2026-11-05）

- Goal：定时任务机制不变，但梦境改成「专门整理工作记忆 + 结合会话沉淀经验」。经验无需人审（纯文本、有快照可回滚），技能仍需人确认（会改变 AI 的行为方式）；索引文件注入系统提示词但只当指针，正文由 AI 自己决定要不要读；`recall_experience` 不要了；一次只处理一个 session。
- 三层结构：`MEMORY.md`（用户偏好，全文注入）/ `~/.quickforge/working-memory/`（活笔记，只注入路径+写法）/ `~/.quickforge/experiences/`（经验库，只注入扫描生成的 `index.md`，80 行封顶）。`skills/` 仍是人工闸门，整理员只能标「候选技能：是」。
- 新增模块：`server/note-store.mjs`（两个目录共用的文件层——命名校验、读、写、归档式移动；**没有删除**，`writeNoteFile` 拒绝空正文）、`server/experiences.mjs`（目录、`index.md` 扫描生成、`<experiences>` 注入块、`stripIndexChrome`）、`server/tools/memory-notes.mjs`（`list/read/write/move_memory_note`，`scope=working|experience`，路径锁死在这两个目录内）、`server/dreaming/curator.mjs`（`new Agent` + 自定义 systemPrompt + 四个工具 + `createCuratorToolGuard`）、`server/dreaming/snapshot.mjs`（整目录快照/回滚/保留 10 份）。
- 梦境流程：窗口内会话全部串行、从旧到新，一次一个会话各起一轮 agent → 重建索引 → 记 run。快照失败则整轮不执行；单会话失败只记一条并继续（全部失败才算 failed）；45 分钟时间预算到会话边界停下并记 `operations.stopped`。整理员提示词写死：只负责一个会话、先 list 再写、文件名与结论不一致必须改名、不删只归档、单轮最多 5 篇、沉淀门槛 3 次或解法明确、不许碰 skills。
- 退役：`~/.quickforge/DREAMING.md`（内容分流：机制自述删除、`manage_global_memory write 是整篇覆盖` 这类可复用的进经验库、构建耗时这类项目细节进工作记忆）、`recall_experience` 工具 + 前端渲染器 + i18n + `notes.mjs` + `recall.mjs`、`dreaming-settings` 的 `prune*` 四项、`/api/dreaming/notes*`。
- 系统提示词：新增 `<experiences>`（索引 + 「这只是指针，要看就 read_memory_note」+「不相关就别翻目录」）；`<working_memory>` 改成用记忆工具、并写明「这里永不删除，退休挪进 `_archive/`」。注入块里额外说明工作区工具够不到这两个目录。
- 前端：设置页「笔记」页签换成「经验库」（列表 + ★ 候选技能 + 生成索引预览，只读）；运行详情改成逐会话报告 + 动作列表 + 「回滚这两个目录」；记忆设置页的提示改成经验库。
- Files: 见 `feature_list.json` 的 `memory-system-experience-library`。
- 验证：`npm run test` 498 files / 5519 passed / 3 failed / 1 skipped，3 个失败为既有基线（ACP workspace-mapping 2 + sqlite-quick-check-gate 1，用 `git stash --keep-index` 在改动前状态复跑确认同样失败）；`npm run lint` 0 problems；`npm run build` 通过（1.83s，precompress 225 files 12.67MB → 6.49MB）；用真实记忆文件渲染 `composeSystemPrompt` 核对三段注入；node 冒烟验证写入/索引/★/改名/归档/非法名/空正文拒绝。
- Notes（踩坑，已写进经验库）：为了对比改动前后的测试结果用了 `git stash push --keep-index` + `pop`，因为工作区本来就有未提交改动，pop 时在 5 个文件上留下冲突标记，手工合并了一遍。正确做法是 `git worktree add` 到一个干净目录再软链 `node_modules`。
- Notes：`dreaming_note_stats` 表保留（不迁移 = 不冒险），但已无写入方；系统提示词只在新建会话时重建，新写的经验要等下个会话才进索引；工作记忆是全局共享的，项目细节靠文件名自带上下文。

---

## working-memory-prompt-principles-only（done，2026-11-04）

- Goal：工作记忆提示词「别给 AI 定那么多条条框框」，并把写笔记的触发点定成「觉得任务做完时回头检查一下」。提示词保持全英文。
- 改动：`server/system-prompt.mjs` 的 `<working_memory>` 从「6 条使用规则 bullet」改成四段散文——①文件夹 + 文件名即一句话总结 + 开工前 `run_command` 列目录只读相关笔记；②工作区工具够不到，改用 `run_command` 绝对路径（技术事实，保留）；③`How to write a note`（嵌入 `workingMemory.prompt`，位置从段尾移到中间）；④`When you feel a task is finished` 作为唯一触发点，列出值得留的四类东西（决定及理由 / 免得重推的结论 / 踩过的坑 / 明确下一步），并写明不值得就不写、空文件夹完全没问题；末尾保留禁存敏感信息。
- 删掉的条条框框：文件名非法字符清单、shell 引号规则、「合并成一条命令省一次审批」、固定四段模板（一句话 / 背景 / 结论·决定 / 坑 / 下一步）、6 条写法规范。
- `server/working-memory.mjs`：`DEFAULT_WORKING_MEMORY_PROMPT` 改为全英文两段原则（大白话短句、一件事一篇、第一行即总结兼文件名、过时直接改写或删除），删掉中文清单与固定模板。
- `src/lib/i18n.ts`：中英文示例笔记去掉 `## 结论 / ## 坑` 小节，改为一句话标题 + 平实正文，避免示例与提示词自相矛盾。
- Files（改动文件）: server/system-prompt.mjs、server/working-memory.mjs、src/lib/i18n.ts、tests/server/system-prompt.test.mjs、tests/server/working-memory.test.mjs、docs/wiki/README.md、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 vitest 40 passed（working-memory 10 / routes 4 / system-prompt 11 / settings-workspace-react 15）；`npm run lint` 通过（0 problems）；`npm run build` 通过（1.73s，precompress 225 files 12.68MB → 6.49MB）；用 node 渲染 `composeSystemPrompt` 打印出实际 `<working_memory>` 段核对排版顺序正确，关闭时整段不出现。
- 生效处理：`~/.quickforge/config/settings.json` 里残留着 286 字的旧中文 `working-memory-settings.prompt`（启用时随开关一起写入的），会盖住新默认值。已备份为 `settings.json.bak-20261104T201111` 后删除该字段（只留 `enabled: true`），让 `normalizePrompt` 回落到新英文默认；`readWorkingMemorySettings()` 实测返回新默认值、`matches new default: true`。
- Notes：`workingMemory.prompt` 注入点保留（仍是 `settings.json` 工程师调试口 + revision hash 的一部分），只是默认值与文案变了。运行中的老进程若缓存了 settings，需重启 QuickForge 才会重建 system prompt。未新增依赖；未触碰生成产物；未提交。

---

## memory-settings-group-and-prompt-hidden（done，2026-11-04）

- Goal：把三个记忆收进同一个「记忆」设置分组，并把工作记忆的笔记提示词从设置界面收回去（不再暴露、不可改）。
- 菜单：`settings-tabs.ts` 新增 `memory` 分组（排在 basic 之后），把 `memory` / `workingMemory` / `dreaming` 三个 tab 的 group 改成 `memory`；顺序保持「用户记忆 → 工作记忆 → 梦境记忆」。`memory` 的显示名从「记忆」改为「用户记忆」（en `User memory`），分组标题为「记忆」（en `Memory`），`settingsGroupMemory` 中英文案新增。搜索关键字补了 `user`，其余沿用。
- 提示词：`GET /api/working-memory` 只返回 `{ enabled, path }`；`PUT` 只接受 `{ enabled }`，带 `prompt` 返回 400 `Working memory prompt is not editable from Settings.`。`readWorkingMemoryDocument()` 不再返回 prompt/defaultPrompt；`saveWorkingMemorySettings()` 保留 `prompt` 字段与 normalize（只作 settings.json 工程师调试口），并支持 `settings` / `writeSettings` 注入便于测试。
- 设置页：`WorkingMemorySettingsTab` 删掉 textarea、「恢复默认 / 保存提示词」，改为「笔记怎么写」只读说明 + `<details>` 只读示例（一个笔记样例），保留开关与目录。
- Files（改动文件）: src/lib/settings-tabs.ts、src/lib/i18n.ts、src/components/settings/tabs/WorkingMemorySettingsTab.tsx、server/working-memory.mjs、server/routes/working-memory.mjs、tests/server/working-memory.test.mjs、tests/server/routes/working-memory.test.mjs、tests/frontend/settings-workspace-react.test.ts、docs/wiki/README.md、docs/wiki/server/README.md、feature_list.json、progress.md、session-handoff.md。
- 验证：定向 vitest 40 passed（working-memory 10 + routes 4 + system-prompt 10 + settings-workspace-react 15）；`npx tsc --noEmit` 通过；`npm run lint` 通过（0 problems）；`npm run build` 通过；临时 `QUICKFORGE_DATA_DIR` HTTP 冒烟：GET 只剩 `{enabled,path}`、PUT `{enabled:true}` 返回 200 并建目录、PUT `{prompt}` 返回 400、system prompt 仍注入 `<working_memory>` 与大白话规则。
- Notes：提示词改成内部常量后，用户改不到；真要调整走发版或 `settings.json` 的 `settings['working-memory-settings'].prompt`。未新增依赖；未触碰生成产物；未提交。`docs/wiki/src/components/README.md` 未改：本次只调整设置导航分组与工作记忆页的展示形态，没改模块职责、公共入口或对外契约。

---

## working-memory-beta（done，2026-11-04）

- Goal：新增「工作记忆（Beta）」——跨项目/会话共享的笔记文件夹。开启后系统提示词告诉 AI 目录位置，AI 自己列标题挑相关笔记读；有值得留的结论就写文件，文件名就是内容的一句话总结（改名也由 AI 自己按内容判断）。
- 用户拍板：目录全局共享 `~/.quickforge/working-memory/`；只走提示词 + `run_command`（ls/cat/mv），不新增工具也不扩 workspace 沙箱；AI 在对话中主动读写，不做会话结束后台整理；笔记提示词以上下文压缩的 `COMPACT_SYSTEM_PROMPT` 为底本改写成大白话。
- 改动：
  1. `server/working-memory.mjs`：设置 `working-memory-settings`（默认关闭 + 大白话默认提示词 + 4000 字上限）、目录常量和懒创建、`getWorkingMemoryRevision()`（开关+提示词 hash）。
  2. `server/routes/working-memory.mjs` + `server/index.mjs`：`GET/PUT /api/working-memory`，返回默认提示词供「恢复默认」，非法类型/超长 400。
  3. `server/project-config.mjs` + `server/system-prompt.mjs`：开启时在记忆段后注入 `<working_memory>`（路径、使用规则、可编辑提示词，XML 转义）；关闭时整段不出现。
  4. `server/agent-manager.mjs`：`refreshWorkingMemoryState()` 每次发送前比对开关+提示词 hash，变化时重建 system prompt（工具集不变）。
  5. 前端：`WorkingMemorySettingsTab.tsx` + 三处注册 + NotebookPen 图标 + 中英文案；Beta 徽章复用设置页已有的通用 `.quickforge-settings-beta`。
  6. 合并上游时的适配：上游已把 `src/index.css` 拆成 `src/styles/*`，本 feature 不再引入独立样式文件；`settings-tabs` 上游新增 `group` / `keywords`，工作记忆项按新结构挂在 `basic` 分组并补搜索关键词。
- 验证：定向 vitest 35 passed（working-memory 9 / system-prompt 11 / settings-workspace-react 15）；`npx tsc -b` 0 错误；`npm run lint` 0 problems；`npm run build` 成功（2.28s，precompress 225 files 12.68MB → 6.49MB）；`npm run test` 全量 497 文件 5552 passed / 3 failed / 1 skipped，3 个失败全部在 `tests/server/acp/server.workspace-mapping.test.mjs`，用 `git worktree` 在纯上游 HEAD 复跑该文件确认同样失败，属既有基线而非本次合并引入。合并前的端到端与 HTTP 冒烟（临时 `QUICKFORGE_DATA_DIR`、GET/PUT 与 400 校验）结果仍有效。
- Notes：写文件和改名依赖 `run_command`，首次创建/改名会走工具审批（用户已接受）。没有新增 rename 工具，没有会话结束自动整理。无依赖变更；未提交；未触碰生成产物。wiki 同步 `docs/wiki/README.md` 与 `docs/wiki/server/README.md`（模块、路由、system-prompt 段）。
- 无关问题登记（HEAD 基线即失败，本轮未扩大范围修复）：`tests/frontend/process-folding.test.ts`（1 例）、`tests/frontend/subagent-running-indicator.test.ts`（1 例），已用 git worktree 在 HEAD 复跑确认；另有既有登记的 `sqlite-quick-check-gate.test.mjs`（1）+ ACP（3）。

## desktop-browser-dead-session-healing（done，2026-11-03）

- 触发：用户实测桌面端内嵌 AI 浏览器，Agent 调 navigate 打开百度时连续 4 次全部 `CDP Page.enable failed: CDP command timed out: Page.enable`（web-reader 等外部 MCP 正常，排除网络）。用户授权「你检查然后优化吧」。
- 结论（一句话）：三处叠加缺陷让坏掉的调试会话被永久复用——新视图不等渲染进程就绪就发首条 CDP 命令、渲染进程崩溃/调试器断开只记错误不自愈、命令超时后零清理；现在以「会话坏死 → 视图整套作废重建」为唯一不变量修复，外加就绪门与超时熔断+单次重试。
- 根因（三层，explore 调研 + 源码复核确认）：
  1. **冷启动竞态**：首次工具调用创建 WebContentsView 后立即 attach 并发 `Page.enable`，不等 dom-ready/渲染进程就绪；渲染进程没起来时 DevTools agent 不应答，命令挂到 30s 超时（cdp-client.mjs:4/57 报错文本逐字吻合）。
  2. **无自愈**：`render-process-gone` 与 CDP `detach` 事件只写 `lastError`，视图不销毁（browser-host.mjs 旧 :94-101）；`ensureView` 见 `isDestroyed()===false` 就永久复用僵尸视图。
  3. **超时零清理**：`Promise.race` 输给定时器后 pending Promise 被丢弃，不 detach 不复位；`ensureEnabled` 因 `enabled` 仍 false 重发 Page.enable，而 `send()` 见 `isAttached()===true` 不重挂——后续所有调用在同一个坏会话上排队等死（解释连续 4 次全挂）。CI 测试替身的 `sendCommand` 永远秒回，对这三层全盲。
- 改动（一个不变量：任何会话坏死 → 视图整套作废，下次调用全新重建）：
  1. `desktop/browser/cdp-client.mjs`：新增导出 `CdpTimeoutError`（携带 method）；`send()` 超时路径主动 `detach()` 熔断坏会话，其余错误仍按原样包装。
  2. `desktop/browser/browser-host.mjs`：新增 `discardView()`（断开调试器、移除视图、关闭 webContents、置空引用）；`render-process-gone` 与 `cdp detach` 事件改为触发 `discardView()` 自愈；`withOperationalView` 前置 `waitForViewReadiness()` 就绪门（新视图等首个 `dom-ready`，15s 封顶，等不到不炸、由命令超时熔断兜底；测试替身无 `isLoadingMainFrame` 时不阻塞）；`execute()` 对 `CdpTimeoutError` 先丢弃视图重建再重试一次（业务失败仍走 `{ ok: false }` 不重试）；`dispose()` 复用 `discardView()`。
  3. 测试：`tests/server/desktop-browser-cdp-client.test.mjs` 新增「超时后主动断开调试器」用例（fake debugger 加 `detachCalls` 计数）；`tests/server/desktop-browser-host.test.mjs` 新增「渲染进程崩溃后作废并重建」「外部 detach 后作废并重建」两例（fake webContents 支持 `emit`）；`tests/server/desktop-browser-wiring-contract.test.mjs` 新增死会话契约：render-process-gone/detach 必须走 discardView、超时必须主动断开并重建重试一次、就绪门必须存在。
  4. 文档：`docs/architecture/desktop-agent-browser.zh-CN.md` 新增「6. 会话生命周期与自愈」章节（后续章节顺延），手工验收补第 6 步自愈验证；`docs/wiki/README.md` 架构文档行补自愈描述。
- 交互影响：工具集、审批、面板交互零变化；正常路径行为不变（就绪门在视图已就绪时立即放行）。异常路径从「连续超时永久卡死」变为「超时一次 → 自动重建重试一次 → 仍失败才报错」，下次调用也总是全新开始。
- 验证 / Evidence：定向 5 files / 45 tests 全过（5 个新用例：cdp-client 超时断开、host 崩溃重建/断开重建/超时熔断重试、wiring 死会话契约）；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run test` → 496 files / 5548 passed / 2 skipped；`npm run build` → 成功（built in 3.19s，precompress 224 files: 12.67MB → 6.49MB）。已变基到上游最新并提交推送 origin/dev（a5316818）。
- Notes：①当前正在运行的桌面端（2.3.7 打包版）仍是旧代码，需重启桌面端（或 `npm run desktop:dev`）后实机复验百度打开是否恢复；②若实机仍超时，则说明卡点不在上述三层（如 Electron 39 的 WebContentsView attach 时序另有问题），届时需按架构文档第 11 节手工验收步骤深挖；③主进程 MCP server 无落盘日志，实机排查时可在 `desktop/electron-main.mjs` 临时加 console 输出。

## goal-v2-single-completion-entry（done，2026-11-02）

- 触发：用户反馈「goal 模式下 goal 的 UI 都已经停止了，为什么还会结束当前轮又继续新一轮次，导致不知道什么时候停止」，并明确「goal 的工具表示完成就应该停止了」。
- 结论（一句话）：v2 同时挂着两条完成路径，其中 `goal_report` 那条在 v2 永远走不通——没有规划轮 → `action:"plan"` 必被拒 → `progress`/`complete` 因「requires a submitted plan」必被拒。模型按工具描述上报完成只会拿到错误结果，回合正常结束，driver 按「一轮正常结束就排下一轮」继续。现在 v2 只保留一个完成入口 `update_goal complete`，`goal_report` 仅 legacy（v1）会话注入。
- 根因（三条）：
  1. **完成意图没人兑现**：`goal_report` 是两段式——工具只写 `run.pendingCompletion`，注释说「回合正常结束 + 落库后由 runner 发布 complete」，但 v2 的 `finishGoalRun` 从来没读过该字段（全仓库只有写、没有读），意图永远不兑现。
  2. **工具在 v2 全动作必败**：`action="plan"` 要求 `run.kind === 'planning'`，v2 只有执行轮；`goal.plan` 恒为 null，于是 `progress`/`complete` 恒被 `GOAL_REPORT_PLANNING_ONLY` 拒。一个每个动作都失败的会话专用工具仍被注入，且描述里宣传 `action="complete"`。
  3. **装配时机把 v1 工具漏进 v2**：`createServerTools` 在会话注册之前用 `() => agentSessions.get(sessionId)` 判定引擎，resolver 返回 undefined → 回落 legacy → 给「带活跃 goal 的恢复会话」塞进 v1 的 `goal_report`。
- 改动：
  1. `server/goal/runner.mjs`：删 `createGoalReportTool`、v2 证据信任链（`goalTrustedTools` / `resetGoalToolEvidence` / `goalToolExecutionIsVerified` / `recordGoalToolExecution`）、未使用的 `GOAL_PLANNING_PERMISSIONS` / `GOAL_PLANNING_ALLOWED_TOOLS`；头部契约注释改写为「完成只认 `update_goal`，`goal_report` 属 legacy」。
  2. `server/goal/report-tool.mjs` 删除；`server/goal/service.mjs` 删 `reportPlan` / `reportProgress` / `requestComplete`，`runtime` 不再落到 `planning`（create/edit/resume 一律 `executing`）；`server/goal/state.mjs` 删 `applyGoalPlanV2` / `applyGoalProgressV2` / `checkGoalCompletionV2` / `goalCompletionCandidate`（plan/evidence 字段与归一化保留，旧快照投影仍要用）。
  3. `server/goal/engine.mjs`：`createGoalReportTool` 对 v2 返回 `null`，`recordGoalToolExecution` 对 v2 直接 `false`。
  4. `server/agent-manager.mjs`：`createServerTools` 不再接收 goal 参数；新增唯一装配点 `appendGoalTools(session)`（`agentSessions.set` 之后与 `rebuildSessionTools` 末尾各调一次），legacy 报告工具只在活跃 goal 时挂，v2 控制工具按 phase 挂；`server/agent-workflow-tools.mjs` 同步去掉旧参数。
  5. 测试：`goal-v2-manager` 改为断言 v2 会话 `goal_report` 必须 undefined、`update_goal complete` 后轮末不得再起新一轮（断言 `agent.prompts` 数量不变）；`goal-v2-service` 把「plan/evidence/完成意图」用例换成「唯一完成入口」契约；`goal-v2-state` / `goal-v2-store` 的 plan fixture 改成本地字面量（v2 不再有 plan 写入者）。
  6. 文档：`docs/wiki/server/README.md`（v2 工具清单与 Round Driver 结算分支）、`docs/wiki/server/tools/README.md`（`goal_report` 表格与 handler 表）。
- 交互影响：v2 会话不再出现 `goal_report` 卡片（模型只能用 `get_goal` / `update_goal` 收尾）；legacy（v1）会话行为不变；控制条、Inspector、轮次分隔线零改动。
- 验证 / Evidence：定向 goal 测试 7 files / 201 tests 通过；`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；`npm run test` → 496 files / 5543 passed / 2 skipped；`npm run build` → 成功（built in 4.81s，precompress 224 files: 12.67MB → 6.49MB）。
- Notes：本次没有改续轮语义——「一轮正常结束就排下一轮、没有空转检测、20 轮上限是唯一的自动停止点」仍是 v2 的设计。若要「模型没表态就不许继续」或「连续多轮无进展自动暂停」，需要另立 feature（会改产品语义）。

## drop-session-message-cache（done，2026-11-02）

- 触发：用户问「IndexedDB 还需要么，移除能解决么」，看完分析后选择 A：直接删。
- 结论（一句话）：会话消息的 IndexedDB 快照缓存整层删除；打开会话只剩 `GET /view`（只读快速通道）与 `POST /restore`（兜底）两条真实通道，都以服务端当前状态为准，不再有第二份可能永远不纠正的副本。
- 为什么删：该缓存只在 `/view` 失败退回 `restore` 时才被读取（正常打开完全不经过它），命中后的替换判据是「服务端更长才替换」，缓存比服务端长（回滚 / 压缩 / 持久化降级）时页面会被永久钉在旧内容；缓存里的 `stateVersion` 还被当作服务端水位，版本回退时整份 `/state` 被丢弃。
- 改动：
  1. 删除 `src/lib/session-message-cache.ts` 与 `tests/frontend/session-message-cache.test.ts`。
  2. `src/lib/server-agent.ts`：删 restore 缓存快路径、4 处写入调度（loadView / restore 两处 / create）、`notifyMessageMetadataChanged` 里的写缓存、`sessionCacheMetadata` 字段、`MESSAGE_CACHE_EVENT_TYPES`、`buildSessionMessageCachePayload` / `scheduleSessionMessageCacheWrite`、只服务缓存的 `snapshotForCache` / `cachedSnapshotToStateSnapshot` / `SessionMessageCachePayload`。
  3. 新增 `src/lib/server-cache-key.ts`（`resolveServerCacheKey` 原样迁出，语义不变），`workspace-cache` / `app-settings-cache` / `useWorkspaceTree` / `useWorkspaceReader` / `useAppBootstrap` 改为从这里 import。
  4. 测试：删 6 处缓存用例与对应 mock（server-agent / server-agent-events / server-agent-background-commands-frame / server-agent-final-answer-recovery / thinking-final-reply-visibility / use-app-bootstrap-snapshot）。
  5. 文档：`docs/wiki/src/lib/README.md`（表格 + 两处说明）、`docs/architecture/render-memory-and-attachment-boundary.zh-CN.md` §4、`docs/architecture/message-log-consistency.zh-CN.md` §5 的「页面刷新」一条。
- 保留：`src/lib/indexeddb-cache.ts` 原样保留（`workspace-cache`、`app-settings-cache` 仍在用）；浏览器里残留的 `session-messages` 旧条目不再被读取，随 LRU 预算自然淘汰，不做迁移或清理。
- 交互影响：无。`/view` 正常时完全不经过缓存；只有 `/view` 失败（404 / 500 split 读库失败 / 503 维护窗口 / 超时）时少了「先显示旧内容」的兜底，改为等一次 `POST /restore`。
- 验证 / Evidence：`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；`npm run test` → 493 files / 5518 passed / 2 skipped（`tests/server/plugins/audit.test.mjs` 一次 15s 超时 + ENOTEMPTY，单文件复跑 4 tests 全过，属并行负载下的既有抖动）；`npm run build` → 成功（built in 4.31s，precompress 224 files: 12.67MB → 6.49MB）。未创建 Git commit，未手工改生成产物。
- Notes：本次只解决「刷新也修不好」里的缓存死角；两个浏览器不一致的主因（本机同时跑着 `5176` v2.3.7 与 `5177` v2.3.6 两个进程、共用同一数据库但各自一份内存会话）与缓存无关，仍待处理。

## multi-client-message-divergence（分析完成，未修，2026-11-02）

- 触发：用户问「对话界面会有缓存么？两个浏览器访问同一个 session 会看到不一致」，症状确认是「消息条数 / 内容不同步」。
- 结论（一句话）：界面确实有三层缓存，但**都不是根因**；根因是每个客户端只靠一条实时流、断线后既不续传也不对账，叠加「消息总数」存在两套口径，会让某一端的消息坐标凭空多出几条并触发整表重拉。
- 缓存盘点（均不会造成跨浏览器差异）：
  1. IndexedDB 消息快照（尾部 200 条，`session-message-cache.ts`）：只在 `/view` 快路径失败、退回 `ServerAgent.restore` 时才读；每个浏览器各一份，不共享。
  2. 内容寻址渲染缓存（`render-cache.ts`）：纯渲染加速，不影响内容。
  3. HTTP / Service Worker：接口统一 `cache-control: no-store`，`public/sw.js` 显式放行（不缓存）`/api`。
  4. 跨标签同步（`useCrossTabSync`）只广播 sessions / projects / settings，**消息不在同步范围**；两个窗口各持一份 `state.messages`。
- 已定位的三处（按影响排序）：
  1. **断线重连不续传 + 事后不对账**：`global-agent-sse-client.ts` 的 `onerror` 走 `close()` + `new EventSource()`，新连接不带 `Last-Event-ID`，服务端 `parseLastEventId` 恒为 null，`handleGlobalStream` 的补发 / `resync` 分支在浏览器里是死代码。短断线可由「新连接重发尾部 200 条 + 客户端前缀跳过」自愈，但回滚 / 压缩 / 审批 / 租约 / 标题这类帧没有尾窗兜底，丢一次就永久错；而 `ChatPanelHost` 的 `visibilitychange` / `online` 只调 `ensureFullHistory()`，本地已是全量时 `baseSeq <= 0` 直接早退，等于长时间开着的标签页从不对账。
  2. **消息口径不一致**：`/state`、`/view` 经 `messagesWithRuntimeToolExecutions()` 在尾部追加运行中的 toolResult，SSE 帧用 `agent.state.messages`。工具运行期间打开 / 刷新的一端坐标多出 k 条「幽灵结果」且不会被清理；客户端还会把 `messagesSummary.count < localEnd` 判成服务端截断，走 `reconcileMessagesFromSummary` 整表重拉，抹掉另一端正在显示的工具卡。
  3. **打开会话的校准被自己的租约帧丢弃**：`_doRefreshStateFromServer` 在 `versionBeforeFetch !== this.stateVersion` 时整份放弃，而挂载时 `enableSessionLease()` → `applySessionLease()` 会 `stateVersion++`；`syncState()` 只调一次不重试，第二个窗口常拿不到 `pendingToolApproval` / `isStreaming` / `contextUsage`。
- 自查步骤：①Network 过滤 `agents/events`，断网再恢复后看新请求是否带 `Last-Event-ID`、响应是否出现 `event: resync`（预期都没有）；②对照 `/api/agents/:id/state` 的 `pendingToolApproval` / `isStreaming` 与另一窗口界面；③长命令运行中在第二窗口刷新，看工具卡是否闪一下消失、两端条数是否对不上。
- 追加（用户反馈「刷新也不一样」后实测，2026-11-02）：**本机同时跑着两个服务进程，共用同一个数据目录**——`5176` pid 24604（v2.3.7，host 0.0.0.0）与 `5177` pid 2868（桌面端 v2.3.6，host 127.0.0.1），两者 `/api/health` 的 `dataDir`/`storageDir` 完全相同，但内存会话表互相独立（实测 5176 有 2 个活跃会话、5177 为 0）。这类「两个窗口连的不是同一个进程」是刷新也修不好的第 0 号原因：刷新只是重新问自己那个进程；不在内存的一侧走 `/view` 存储分支（`isStreaming` 恒 false、无 `pendingToolApproval`/`contextUsage`、无运行中的运行时 toolResult），在内存的一侧走内存分支（这些字段都有）。两进程同写一个 SQLite，revision CAS 冲突时 `agent-persistence.mjs` 会 `markPersistDegraded` 并跳过覆盖，于是「内存有、库里没有」可以长期存在。跨实例实时一致在架构上是显式非目标（`message-log-consistency.zh-CN.md` §8）。
- 修复方向（待排期）：①重连续传（带游标）+ 重新可见时做一次真对账而不是只补前置历史；②统一投影口径，`/state`、`/view`、SSE 帧取同一数组；③校准用「消息日志版本」判定，不拿全局 `stateVersion` 当失效条件。
- Notes：`docs/architecture/message-log-consistency.zh-CN.md` §3.5 写的是「浏览器 EventSource 自动重连会把 `id:` 放进 `Last-Event-ID`，服务端补发零客户端改造」，与实际实现矛盾（客户端每次都 `close()` 重建连接），修 A 时需同步改该节。
- 验证：本次仅只读分析，未改代码、未跑测试、未创建 Git commit。

## conversation-header-title-max-width（done，2026-11-02）

- 触发：用户三轮收敛——①「对话的标题宽度要限制一下，现在太宽了」；②「对话顶部的宽度还是太宽」，追问时选了「整条横栏比正文宽太多」，于是改成居中同宽列；③「理解错了，应该还是贴左，同时超出的部分鼠标移到标题上像 session 那样滚动展示完整的对话」。
- 结论（一句话）：最终形态是**贴左 + 标题宽度封顶 + 悬停横向滚动**——标题容器 `min-w-0 max-w-[24rem]`，内部直接复用侧栏的 `SessionTitleMarquee`，顶栏其余结构完全回到原样。
- 三轮过程与教训：
  1. 第一轮给标题加 `max-w-[36rem]`——只治了"标题无限伸展"，用户仍觉得宽。
  2. 第二轮把整条顶栏做成与正文列同宽居中列（`mx-auto max-w-3xl` + chip/分支让步）——方向错了，用户要的是贴左。
  3. 第三轮 `git checkout` 把 `ConversationHeader.tsx` 还原到原始版本，再做最小改动：`import SessionTitleMarquee`、标题块 `min-w-0` → `min-w-0 max-w-[24rem]`、裸 `<div truncate>` → `<SessionTitleMarquee className="block w-full text-sm font-semibold">`。
- 为什么复用 `SessionTitleMarquee`：侧栏会话名已有成熟的溢出交互（400ms 延迟、35px/s、尾部停 1000ms 再弹回、`prefers-reduced-motion` 直接不滚），顶栏复用同一套行为，避免两处各自实现和时间参数漂移。
- 改动文件：`src/components/app/ConversationHeader.tsx`、`tests/frontend/conversation-trace-contract.test.ts`（新增契约：标题必须用 `SessionTitleMarquee`、必须有 `max-w` 封顶、不得改回居中列）、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：定向 `npx eslint src/components/app/ConversationHeader.tsx` → 0 problems；`npx tsc -b` → 0 错误；相关契约测试 5 files / 105 tests 通过；`npm run build` 成功。
- Notes：
  - `max-w-[24rem]`（约 27 个中文字）是当前取的值；因为超出部分可以悬停滚动查看，这个值可以调窄而不会丢信息。
  - 契约测试刻意不断言具体刻度（只断言"存在 max-w 封顶"），避免以后微调宽度就把测试弄红。
  - 未创建 Git commit；`dist/` 由 `npm run build` 生成，未手工修改。

## desktop-embedded-agent-browser（done，2026-11-02）

- 触发：用户提出桌面端应使用应用内浏览器（Electron + WebContentsView + webContents.debugger(CDP) + MCP 工具封装），并要求在不变现有交互与体验的前提下把架构做到约束内最优、一次性落地全部可优化项。
- 结论（一句话）：桌面端现在有一个应用内真实浏览器——主进程独占 WebContentsView 与 CDP，把页面操作包成主进程内的 MCP server；服务端只多了一个由 env 派生的内置项，工具命名、审批、事件推送与工具集刷新全部复用，Web 与 CLI 完全不受影响。
- 关键设计：
  1. 通道：主进程跑 StreamableHTTP MCP server（127.0.0.1 随机端口 + 一次性 Bearer token，无状态），server 子进程用现有 StreamableHTTPClientTransport 连入；不把 server 内联进主进程（同步 SQLite 会冻住主进程的既有结论不变）。
  2. 引用：无障碍树快照生成 e12@g3 形式的引用，主 frame 导航或执行上下文重建即令世代失效；旧引用明确报错，绝不按 CSS 选择器猜坐标。
  3. 安全：独立 session 分区、仅 http(s)、localhost 与 *.localhost、私网、链路本地、CGNAT、IPv4-mapped IPv6 全拦、新窗口 deny、权限与下载全拒、sandbox 与 contextIsolation 保持不变、渲染进程只拿到 bounds/visible/state 窄桥。
  4. 审批：读取 MCP annotations.readOnlyHint，只读工具（snapshot/screenshot/wait_for）免审批，写操作照常逐次确认；未新增按域名授权 UI（那会改变现有交互）。
  5. 前端：新增只能由程序打开的 agent-browser 标签（加号菜单不变、不持久化），工具一调用就切过去；ResizeObserver 加 rAF 合帧上报矩形，设置弹窗、切标签、隐藏窗口时收起原生层。
- 改动文件：新增 desktop/browser 下 layout、policy、cdp-client、page-snapshot、page-actions、browser-host、mcp-server、ipc-contract 八个模块，src/lib/desktop-app.ts、src/lib/desktop-browser-bridge.ts、src/components/browser/AgentBrowserPanel.tsx、13 个测试文件、docs/architecture/desktop-agent-browser.zh-CN.md、docs/wiki/README.md、docs/wiki/server/README.md、docs/wiki/src/components/README.md；修改 desktop/electron-main.mjs、desktop/electron-preload.cjs、server/mcp/config.mjs、server/mcp/registry.mjs、server/agent-manager.mjs、workspace 面板相关 6 个文件、src/App.tsx、src/lib/i18n.ts，并把 3 处重复的桌面端判定收敛到 src/lib/desktop-app.ts。
- 验证 / Evidence：
  - npm run test → 496 files / 5546 passed / 2 skipped（退出码 0；按当前工作树复跑——同期另一会话删除了会话消息快照缓存层，首跑还出现过 tests/server/plugins/audit.test.mjs 并发抖动失败，单独重跑通过）
  - npm run lint → 0 problems；npx tsc -b → 0 错误；npm run build → 成功（precompress 224 files: 12.67MB → 6.49MB）
  - 复核（本次复跑）：① token 不落盘——内置项写入的是 headers.authorization，归一化按 HTTP 传输转成 env，prepareForStorage 只清 env，磁盘上没有凭据（用例已断言持久化内容不含 token）；② 唯一 CDP 所有者——全仓库只有 desktop/browser/cdp-client.mjs 触碰 webContents.debugger；③ 只有 activePanelTab 会挂载 AgentBrowserPanel，切标签/关面板即卸载并收起原生层。
  - 护栏补强：desktop-browser-wiring-contract 新增一条目录级契约——扫描 desktop/ 下所有 .mjs/.cjs/.js，断言只有 browser/cdp-client.mjs 出现 .debugger.，把「唯一 CDP 控制层」从注释变成可失败的断言；已做变异验证（临时加第二个使用者 → 该用例立刻红，删掉后恢复绿）。
  - 补足最后一处空白：desktop/browser/browser-host.mjs 原先只有源码契约、没有直接单测（它 import electron 无法直连）。新增 tests/server/desktop-browser-host.test.mjs，用 vi.hoisted 造 Electron 替身（WebContentsView / session / webContents.debugger），覆盖懒创建与复用、rect 夹取、显隐、窗口 hide/show 期间保持请求态、策略拦截导航不触页面、动作期间强制可见后还原、权限与新窗口与下载全拒、dispose 解绑并摘除子视图，共 8 例。
  - 再补：desktop/browser/cdp-client.mjs 也没有直接单测（它是所有动作的信任边界）。新增 tests/server/desktop-browser-cdp-client.test.mjs，用假 webContents 覆盖 attach 幂等与事件只绑一次、message/detach 转发、视图销毁后 attached 为假、销毁视图拒绝 attach、detach 空操作、detach 后发命令自动重挂、命令失败带方法名并保留 cause、命令超时（假计时器推到 31s 断言 reject）、waitForEvent 命中谓词返回参数、超时返回 null 而不抛，共 10 例。
  - 等价重构 + 补测：把 electron-main 里的 parseBrowserRequest 抽到 desktop/browser/ipc-contract.mjs（与 layout.mjs 同样理由：main 依赖 electron 无法直连单测），主进程改为 import，行为逐字不变；新增 tests/server/desktop-browser-ipc-contract.test.mjs，锁住白名单形状（无参请求多一个键即拒、set-visible 只认布尔、set-bounds 必须四个已知键且全为有限数、宽高不得小于 1、非对象/数组/未知类型一律 null），共 8 例。
  - 打包验证：desktop:build:win 首次失败于 desktop-dist 里旧 app.asar 被外部句柄占用（EBUSY，删不掉也不像有进程持有，怀疑杀毒/索引器），改用 -c.directories.output=desktop-dist-next 后成功；产物 QuickForge Setup 2.3.7.exe（111MB）与 QuickForge-Portable-2.3.7.exe（110.8MB）；用 asar list 核对包内 desktop/browser 的 8 个模块齐全。版本号仍是 2.3.7（未升版本，是否升 2.3.8 由用户决定）。
  - 新增 13 个测试文件共 103 个用例，其中 desktop-browser-mcp-server.test.mjs 用真实 MCP 客户端对 HTTP 端点做端到端校验（listTools 的 9 个工具与 annotations、callTool 转发、策略拒绝映射为 isError、缺 token 401、GET 405）。
- Notes：
  - Electron 真实渲染、CDP attach 时序、原生层遮罩无法在 CI 覆盖，架构文档第 10 节给了 5 步手工验收。
  - 明确不做：多标签、按域名批量授权、截图 base64 回传模型、下载与上传、元素高亮浮层、跨 iframe 元素操作。
  - 护栏测试真实命中一次：新面板最初用了 text-muted-foreground/70 与 border-border/60，旧产物没有这两个档位，已改用白名单档位（语义色一致性测试）。
  - 已知遗留（非本 feature 引入）：同期另一会话删除 src/lib/session-message-cache.ts 后，tests/frontend/server-agent-final-answer-recovery.test.ts 与 tests/frontend/thinking-final-reply-visibility.test.ts 仍保留 vi.mock('@/lib/session-message-cache')。因为带了 factory，vitest 不解析该 id，测试照常通过，但它是对已删除模块的悬空引用，下次动这两个文件时删掉。
  - 全量跑并发抖动已见两例（都不是真实缺陷）：tests/server/plugins/audit.test.mjs 的 300 条上限用例、tests/server/session-state-repository.test.mjs 的多进程 CAS 用例；两者单独跑都通过。判定方式固定为「单文件重跑 + 整链重跑」，别据此改断言。
  - 本 feature 与「删除会话消息快照缓存」是同一个工作树里的两条并行变更：两者文件不重叠，但全量 test/lint 的耗时与文件数会随对方进度变化，判断门禁结果时以当次完整输出为准。
  - 未创建 Git commit/tag/push；dist/ 由 npm run build 生成，未手工修改。

## release-2-3-7（done，2026-11-02）

- 触发：用户问「可以撤回最近的包然后重新发么」（想处理有 bug 的 2.3.6）。
- 结论（一句话）：不撤回，直接发 **2.3.7**。npm 政策是 72 小时内可以整版撤回，但一旦撤回，该版本号永久作废、不能再用它重发；而撤回的唯一收益「别人别装到坏版本」会被新版本立刻取代，代价却是锁了 2.3.6 的安装直接 404。
- 发布内容：
  1. `fix(desktop)`: 子进程 `cwd` 改用真实目录（`projectRoot` 只定位资源），修复安装版 `spawn … QuickForge.exe ENOENT`；restart/update supervisor 同步。
  2. `fix(chat)`: Deferred → 真实会话交接携带首条消息（`handoffMessages` + `prompt(message, { messageAlreadyInState: true })`），「任务旁 +」新建对话不再跳回欢迎页。
- 改动文件：`package.json`、`package-lock.json`、`CHANGELOG.md`（新增 2.3.7 章节与 Released 小节）、`README.md`（版本徽章 2.3.7）、`feature_list.json`、`progress.md`、`session-handoff.md`；功能代码见上面两段与各自的提交。
- 验证 / Evidence：
  - `npm run test` → 484 files / 5459 passed / 2 skipped（退出码 0）；`npm run lint` → 0 problems；`npm run build` → 成功（built in 4.44s，precompress 224 files: 12.67MB → 6.49MB）。
  - `node scripts/prepare-runtime-package.cjs`、`node scripts/prepare-offline-package.cjs` 均成功；`npm pack` → `package-offline/shawnstack-quickforge-2.3.7.tgz`（14.5 MB / 1028 files，shasum `ed70b3ea24251aed65cfd05f98c38f32b48388b0`）。
  - Git：`fix(desktop)` → `1ad4a8db`；`fix(chat)` → `eaf4f765`；release commit + tag `v2.3.7` 推送 `origin/dev`。
- Notes：
  - 未撤回 2.3.6，`npm deprecate` 也无需执行——2.3.7 发布后 `latest` 覆盖即可。
  - `package-offline/` 内的 tarball 属生成产物，不入 Git（`.gitignore` 已忽略）；`dist/` 由 `npm run build` 生成，未手工修改。

## deferred-handoff-no-empty-frame（done，2026-11-02）

- 触发：用户反馈「在任务旁的 + 新建对话，输入文字后直接跳出去回到初始化对话框」。确认点是「任务」分组标题旁的 +（`startNewExplicitGlobalSession`），不是项目行那个 +。
- 根因（交接空窗）：`createAgent` 建好真实 `ServerAgent` 时它的 `state.messages` 是空的，`attachTaskToView` 立刻把这个「0 条消息」的 agent 挂上视图；App 的空态判据 `!isStreaming && messages.length === 0` 因此成立，`App.tsx` 里「默认项目必须进入真实会话」的 effect 立刻又跑了一次 `startNewProjectChat(activeProject)`，把正在进行的全局会话换成了项目空对话 —— 用户看到的是欢迎页，刚打的字也没发出去。
- 日志证据（`~/.quickforge/logs/server-2026-11-02.log`）：`16:55:58` 点 + 只读了模型清单与思考等级；`16:56:04.064` 创建 global 会话 `ba70ed7c`（POST `/api/agents` 耗时 5536ms）；10ms 后（`.074`）又出现一次「新对话初始化」；该会话全程没有 `prompt` 请求；`16:58:12` 才有新的 project 会话被创建（用户重新打的字）。
- 修法（消除中间态，不给空态规则打补丁）：
  1. `useAgentManager.createAgent` 新增 `handoffMessages`：在 `ServerAgent.create` 之后、`attachTaskToView` 之前，把交接消息写进真实 agent 的 `state.messages`。只写前端 state，不进 create 的 payload（那份会被服务端持久化，紧接着的 prompt 又会再发一次）。
  2. `DeferredSessionAgent.ensureRealAgent` 用 `handoffMessages: this.state.messages` 交接乐观消息，真实 agent 上屏的第一帧就带着用户那句话。
  3. `ServerAgent.prompt(input, { messageAlreadyInState })`：交接消息引用相等时直接复用，不再追加第二遍；失败回滚的 `msgCountBeforeOptimistic` 同步按「已含该消息」计算，仍只删这一条。
- 改动文件：`src/lib/deferred-session-agent.ts`、`src/lib/server-agent.ts`、`src/hooks/useAgentManager.ts`、`tests/frontend/deferred-session-agent.test.ts`（改）、`tests/frontend/server-agent.test.ts`（改）、`tests/frontend/deferred-handoff-contract.test.ts`（新增）、`docs/wiki/src/lib/README.md`、`docs/wiki/src/hooks/README.md`、`CHANGELOG.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：
  - 定向 `npx vitest run deferred-session-agent / server-agent / deferred-handoff-contract` → 3 files / 153 tests 全过。
  - 全量 `npm run test` → 484 files / 5459 passed / 2 skipped；`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；`npm run build` → 成功（built in 4.20s，precompress 224 files: 12.67MB → 6.49MB）。
- Notes：
  - 契约测试 `deferred-handoff-contract.test.ts` 锁住三处：`handoffMessages` 必须传给 `createAgent`、必须在 attach 之前装进真实 agent、`ServerAgent.prompt` 必须保留复用分支（并排在乐观追加之前）。任何一处被删都会直接变红。
  - 行为变化（符合预期）：全新建会话在首条消息发出前就会触发一次 `refreshSessions`，侧栏能更早看到该会话条目；此前是等 prompt 之后才刷新。
  - 未创建 Git commit / tag / push；`dist/` 由 `npm run build` 正常生成，未手工修改。

## desktop-fork-cwd-real-directory（done，2026-11-02）

- 触发：用户发来安装版启动弹窗「QuickForge failed to start → spawn C:\Users\…\Programs\QuickForge\QuickForge.exe ENOENT」，问原因并要求修掉。
- 根因：桌面端默认把 server 跑成独立子进程，`spawn` 的 `cwd` 取 `projectRoot`；打包后这个值是 `resources/app.asar`——归档文件不是磁盘目录，libuv chdir 失败直接返回 `ENOENT`（错误文本显示可执行文件路径，看起来像 exe 缺失，实际 exe 完好）。旧版本默认 inline 启动，所以这个坑到「默认 fork」之后才暴露。
- 修法（统一语义：`projectRoot` 只负责定位资源，子进程 `cwd` 必须是真实目录）：
  1. `server/public-api.mjs`：fork 子进程默认继承调用方 `process.cwd()`（与 CLI 一致），显式 `options.cwd` 仍 `path.resolve`；不再把包目录当默认 cwd。
  2. `desktop/electron-main.mjs`：桌面启动显式传 `cwd: app.getPath('home')`（`app.asar` 不是目录，安装目录还可能只读）。
  3. `server/index.mjs`：restart / update supervisor 传给新服务的 `cwd` 由 `projectRoot` 改为 `process.cwd()`，重启与更新后重启在打包版不再命中同一 ENOENT。
- 改动文件：`server/public-api.mjs`、`server/index.mjs`、`desktop/electron-main.mjs`、`tests/server/public-api-child-cwd.test.mjs`（新增）、`tests/frontend/desktop-fork-default.test.ts`、`docs/wiki/README.md`、`docs/wiki/server/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：
  - 安装版 2.3.6 的 asar runtime 实测：`ELECTRON_RUN_AS_NODE=1 QuickForge.exe resources/app.asar/server/index.mjs`，cwd 设为用户主目录 → `/api/health` 200（version 2.3.6）、`GET /` 返回 index.html（1840 bytes，含 `id="root"`），证明 asar 内 runtime 可读、只差一个真实 cwd。
  - 变异验证：把 `public-api.mjs` 的 cwd 改回 `projectRoot`，`tests/server/public-api-child-cwd.test.mjs` 立即失败；恢复后通过。
  - `npm run test` → 483 files / 5454 passed / 2 skipped（退出码 0）；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功（4.64s，precompress 224 files: 12.67MB → 6.49MB）。
  - 重新打包：`npm run desktop:build:win` 成功（2m1s，退出码 0），产出 `desktop-dist/QuickForge Setup 2.3.6.exe`、`QuickForge Setup 2.3.6.exe.blockmap` 与 `QuickForge-Portable-2.3.6.exe`；从产物 asar 中确认三处修复都在（public-api 的 `childCwd`、electron-main 的 `cwd: app.getPath('home')`、index 的 supervisor `childCwd`）。
  - 真机验证：直接启动 `desktop-dist/win-unpacked/QuickForge.exe`，`/api/health` 返回 200（version 2.3.6，server pid 19844），随后 `taskkill /T /F` 清理，端口 5177 释放、无残留进程 —— 原来必现的 ENOENT 弹窗不再出现。
- Notes：
  - 用户机器上现装的 2.3.6 仍是旧代码，需重新打包/安装（`npm run desktop:build:win`）才能拿到修复；临时绕过可设 `QUICKFORGE_DESKTOP_INLINE=1` 走 inline 启动。
  - 本次未改 `bin/quickforge.mjs`：CLI 本来就不传 cwd、继承调用方目录，行为已正确。

## release-2-3-6（done，2026-11-02）

- 触发：「发布一个小版本」。
- 结论（一句话）：把 v2.3.5 之后 dev 上的 21 个提交以 **2.3.6** 发布——版本递增、CHANGELOG/README 更新、test/lint/build 硬门禁通过、runtime/offline 包与 tarball 生成、release commit + tag `v2.3.6` 推送 `origin/dev`；`npm publish` 按 runbook 留给用户手动执行。
- 发布内容概要（按 CHANGELOG 章节）：
  1. Added：压缩记录改为纯追加（去掉 20 条上限）；兼容期旧库（v1..v18）启动时自动升级到 baseline v19 并留升级前 `VACUUM INTO` 快照。
  2. Changed/Refactor：前端应用级状态迁入 `src/stores/` 十个 Zustand store（hook 全部保留为兼容层，`ChatSidebar` 去 14 个 props，3 个 window 事件桥换成 `ui-store` 请求信号）；消息投递重构为「消息日志 + 每连接游标」（`server/message-log.mjs` / `server/event-log.mjs`、SSE `id:`/`Last-Event-ID` 重放、缺口 `resync`、`applyLog` 唯一写入入口、`ensureFullHistory` 退避补齐）；流式链路 SSE 单份帧 + 只缓存定稿内容；首屏裁剪 pi-ai/xterm 并生成 br/gz（3.6MB → 2.1MB 原始 / 0.53MB gzip）；渲染窗口有界（12 轮 / 160k 字符）+ IndexedDB 快照 schema 2 尾部 200 条；附件出站改引用（≤128KB preview + `assetUrl` + 新附件端点）；`ask_user` 同会话串行化与待答期间输入框归属；两批 a11y（19 处焦点环 + 焦点环不变式测试、可访问名称与侧栏共享 props）；三批渲染性能优化。
  3. Removed：压缩旧存档迁移、存储向后兼容层（四个域的 cutover 与阶段状态机）、启动迁移窗口与进度页、迁移链折叠为单一 baseline v19。
  4. Fixed：回滚动作索引与消息窗口坐标（两处根因）；编辑首条消息重发不再跳新对话；压缩分割线锚定压缩发生点且摘要作为真实消息；翻页回弹/跳底（视口保护 + 滚动事务 + scroll-owner）；窗口化后复制错内容；粘贴文本附件删不掉；模型抽屉勾选即时移动；展开工具卡整列左右抖动（scrollbar-gutter）。
- 改动文件：`package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：
  - `npm run test` → 482 files / 5451 passed / 2 skipped（单跑，退出码 0，56.46s）。
  - `npm run lint` → `eslint .` 无输出（0 problems）。
  - `npm run build` → 成功（`✓ built in 4.27s`，`[precompress] 224 files: 12.67MB → 6.49MB`，仅既有 >500kB chunk 提示）。
  - `node scripts/prepare-runtime-package.cjs` → `package-dist/`（package.json 版本 2.3.6）。
  - `node scripts/prepare-offline-package.cjs` → `package-offline/`（package.json 版本 2.3.6）。
  - `cd package-offline && npm pack` → `shawnstack-quickforge-2.3.6.tgz`（14.5 MB packed / 29.1 MB unpacked / 1028 files、shasum `e8935179…`）。
- Notes：
  - 本次首次手动流程遗漏一处：`npm pack` 第一次在仓库根目录执行，生成了根目录下的 `shawnstack-quickforge-2.3.6.tgz`（打包的是根 package.json）；已删除该文件并在 `package-offline/` 内重新 pack，提交前 `git status` 只剩 4 个文档/版本文件。
  - 离线包体积较 2.3.5（7.9MB/578 files）明显变大，原因是 `dist/` 现在带 br/gz 预压缩兄弟文件，属预期。
  - 未推送 `master`，只推 `origin/dev` 与 tag，与 2.3.4/2.3.5 一致。
  - 未执行 `npm publish`；`dist/`、`package-dist/`、`package-offline/` 均在 `.gitignore` 覆盖范围内，不进入提交。
  - CHANGELOG 补齐说明：`[Unreleased]` 只覆盖了 21 个提交中的 13 条内容，其余 17 条据 `feature_list.json` 各 feature 的 summary 补写，未改动任何功能代码；wiki/架构文档本次无需更新（发布流程与公共入口均未变）。

## rollback-action-coordinate-integrity（done，2026-11-02）

- Goal：用户反馈「对话的回滚按钮偶发显示的消息不对」，要求在不改交互与体验的前提下把架构做到约束内最优（允许等价重构），一次性落地全部可优化项。
- 结论（一句话）：两个独立缺陷都在根因层修掉了——动作按钮的索引/正文改为**触发时现读**（行上 `data-message-index` + 宿主 `getMessageAt`），回滚响应改由 `ServerAgent.rollback()` 按**全量坐标**采纳并广播，消息数组只剩 `applyLog` 一个写入入口。
- 根因：
  - 装饰层的动作组（回滚/重试/分叉/复制）只在建行时创建一次、之后复用，索引被冻在建行闭包里；分页、回滚重切片、压缩都会改窗口起点，于是回滚截到另一条消息、复制读到别人的正文（旧的 `messageAtFullIndex` 还用冻结的 `messageIndexOffset` 反算窗口位置）。
  - `performRollback` 把回滚响应直接赋给 `state.messages`（绕过 `applyLog`）。响应是**截断后的全量历史**，同一调用的 SSE `messages_replaced` 帧只带尾部 ≤200 条；本地仍处于窗口态（`baseSeq>0`）时「数组 + 起点」被拆开，之后所有下标换算、增量落位整体偏移——会话超过 200 条且全量历史补齐未完成时必现，补齐成功后消失，所以表现为「偶发」。
- 关键改动：
  - `message-actions.ts`：新增 `rowMessageIndex(element, fallback)`（`data-message-index` 为权威，缺失回退装饰期值）与 `getMessageAtFullIndex` 依赖；回滚（就地编辑提交 / 确认气泡）、重试（含错误行 fallback）、分叉、复制全部改用实时索引与实时正文；删除冻结偏移的窗口反算。
  - `ChatSurface`：句柄新增 `getMessageAt(fullIndex)`（读已提交窗口）；`ChatPanelHost` 注入。
  - `ServerAgent.rollback()`：新增私有 `acceptRolledBackHistory()`，`applyLog({kind:'snapshot', baseSeq:0})` + 清流式片段 + 广播；新增 `trimTrailingMessages(n)`（前缀截断、起点不变、不广播）。`DeferredSessionAgent` 补等价实现。
  - `useChatActions`：不再写消息数组，回滚只用返回结果判断会话去留，重试改调 `trimTrailingMessages`。
  - 删除 `useAgentManager.setCurrentAgentMessages` 及 `App`/`useChatActions` 接线（该钩子是绕过不变式的唯一入口）。
  - 测试：新增 `message-action-index-freshness.test.ts`（偏移变化后回滚/重试/复制仍取实时坐标）与 `server-agent-rollback-adoption.test.ts`（采纳后 `baseSeq + length` 等于服务端总数、后续增量落到尾部、重试截断保持起点）；两个 hook harness 对齐新写入口。
  - 文档：`docs/architecture/message-log-consistency.zh-CN.md`（坐标表补 `data-message-index`、写入入口仅 `applyLog`、测试矩阵两行）、`docs/wiki/src/components/README.md`（窗口化段 + `message-actions` 段）、`docs/wiki/src/hooks/README.md`（`performRollback` 不写数组）、`docs/wiki/src/lib/README.md`（改写 `messageWindowOffset`/`mergeWindowedMessages` 过期条目为当前 `baseSeq`/`applyLog` 口径）、`CHANGELOG.md`。
- 测试：`npx vitest run` 定向 8 文件全过（含新增 5 例）；全量 `npm run test` → 482 files / 5451 passed / 2 skipped。
- 验证：`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；`npm run build` → 成功。未创建 Git commit，未手工修改生成产物。
- Notes：
  - 动作按钮的「正文现读」依赖宿主注入的 `getMessageAtFullIndex`；未注入的调用方（目前只有测试）回退到本行装饰时捕获的消息对象，行为与改动前等价。
  - `trimTrailingMessages` 刻意不广播（与改动前的直写时机一致），权威结果仍由紧随其后的 `continue()` 服务端帧给出；若日后想让重试界面更早刷新，需要单独评估滚动锚点。
  - `ChatSurface` 句柄新增了 `getMessageAt`，属公共入口扩展；分享页/Side Chat 未使用（它们不经过该装饰依赖注入路径）。

## drop-compaction-legacy-migration（done，2026-11-02）

- Goal：用户裁定「新对话没问题，旧的不需要兼容」，据此删除只为旧存档服务的压缩迁移。
- 结论（一句话）：`ensureCompactionMessage()` 整段删除，`restoreAgent` / `syncSessionFromStorage` 两处挂点与 `compaction_migration` 广播一并去掉；新对话每次压缩都由 `compactSessionInPlace` 自己写摘要消息，从不经过迁移。
- 根因（为什么该删）：迁移里的 `history.map(entry => ({ ...entry, occurredAtIndex: insertAt, boundaryIndex: insertAt }))` 会把旧会话所有记录的位置折叠成同一个 `insertAt`，与实际插入位置无关；上一版放开条数上限后「多条记录」成为常态，这个折叠更不合理。它只在「有 `contextCompaction.summaryMessage` 但消息数组里没有摘要」时触发，即纯旧数据。
- 关键改动：`server/auto-compaction.mjs`（删函数与注释改述兼容分支；`buildAutoCompactLoopMessages` 的只读虚拟拼接兜底保留，用于 run 内快照与未迁移旧会话）、`server/agent-manager.mjs`（删 import 与两处调用+落库+广播）、`tests/server/compaction-message.test.mjs`（删迁移用例与 import）、`docs/wiki/src/components/README.md`、`CHANGELOG.md`。
- 行为影响：旧会话不再被补写摘要消息，打开时按其原样显示；模型上下文仍由兜底分支拼出摘要，不会丢上下文。新对话完全无变化。
- 验证：定向 `npx vitest run tests/server/compaction-message.test.mjs tests/server/auto-compaction-history.test.mjs` → 2 files / 9 tests 通过；全量 `npm run test` → 480 files / 5446 passed / 2 skipped；`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；`npm run build` → 成功。未创建 Git commit。

## compaction-record-no-truncation（done，2026-11-02）

- Goal：用户要求「每次压缩的记录都保存，不要合并成全局一条线」，并裁定 **UI 完全不动，只保留过程**。
- 结论（一句话）：时间线本来就是「一次压缩一条线」（摘要是真实消息）；缺的只是过程被 20 条上限截断，所以唯一改动是 `compactSessionInPlace` 的 `history` 改为纯追加，删除 `MAX_CONTEXT_COMPACTION_HISTORY`。
- 关键改动：`server/auto-compaction.mjs`（`history: [...previousHistory, historyEntry]`；常量与「设上限避免 body_json 无限增长」注释换成「不设上限、每条自带当次摘要」）；三处引用该常量的文档注释同步（`server/routes/shared-conversation.mjs`、`server/session-state-service.mjs`、`src/lib/server-agent-types.ts`）。前端、持久化结构、切点、`compactedUpToIndex`、`buildAutoCompactLoopMessages`、回滚判定、条目字段全部未动。
- 测试：`tests/server/auto-compaction-history.test.mjs` 的「上限截断」用例替换为「保留全部记录」——预置 25 条 → 26 条，最旧一条仍在且仍带自己的 `summaryMessage`，最新一条等于顶层 `summaryMessage`。
- 代价（明确接受）：`body_json` 随压缩次数线性增长；每条记录 ≈ 一份当次摘要，而摘要消息本身也在 `messages` 里，因此同一次压缩的正文在 body 中出现两次；分享页逐条脱敏的 payload 同步变大。设计口径见 `docs/design/per-compaction-records.zh-CN.md`。
- 验证：定向 vitest 5 文件 / 35 用例全过；全量 `npm run test` → 480 files / 5447 passed / 2 skipped；`npx tsc -b` → 0 错误；`npm run lint` → 0 problems。未创建 Git commit。
- Notes：设计稿里被否掉的可选项（消息自带 `compactionId`/序号、pill 显示「第 N 次」、删除「已并入后续摘要」文案）已明确记为「未做（UI 不动）」，若日后要改口径按该文档升级。

## compaction-anchor-at-occurrence（done，2026-11-02）

- Goal：用户裁定压缩分割线必须显示在「压缩发生点」（选定 docs/design/compaction-anchor-preview.html 方案 B），线以下是压缩之后继续的 tool 调用，不再被抬到用户消息上方；当前用户请求由摘要承载，其余审查问题（P2–P5）不修。
- 结论（一句话）：压缩点锚定改为 `compactSessionInPlace` 切点恒等于 `source.length`（压缩那一刻的数组末尾），摘要作为最后一条消息追加，自动/手动同语义；`AUTO_COMPACT_MIN_TAIL_USER_TURNS`/`resolveAutoCompactTailStart`/`tailStartForRecentTurns`/`DEFAULT_MAX_TAIL_CHARS` 与 `keepRecentTurns` 设置整链删除。
- 根因：`insertAt ≡ tailStart` 且自动切点被强制对齐到最后一个用户回合起点（默认 keepRecentTurns=0 下恒等于最后一条 user 下标），分割线必然紧贴用户消息上方；「压缩发生点」在数据模型里根本不可表达。
- 关键改动：
  - `server/auto-compaction.mjs`：`tailStart = source.length`、`nextMessages = [...source, summary]`、`compactedUpToIndex = nextMessages.length`；`occurredAtIndex = boundaryIndex = tailStart`。新增 `compactionSnapshotShift()` / `compactedUpToIn()`：run 内 pi-agent-core loop 快照不含摘要（state 恰好比传入数组多一条且摘要在 `compactedUpToIndex-1`），派生下标平移回快照坐标——修复压缩后同 run 后续模型调用会挤掉「压缩后第一条新消息」的同源索引缺陷（`buildAutoCompactLoopMessages` 兼容分支、`buildCompactionSourceMessages`、`minimumProviderUsageIndex` 三处复用）。
  - `keepRecentTurns` 全链移除：server（默认值/归一化、notice×2、审批事件与 pending 投影、persistence 投影、手动 /compact 传参）与前端（`auto-compact-settings.ts`、`DefaultOptionsSettingsTab` 设置行、i18n 三键 + `autoCompactApprovalRisk` 孤儿键、`DecisionRow` preview、`server-agent-types`/`compaction-message`/`approval-cards`/`ChatPanelHost` 类型与事件字段）；`autoCompactApprovalPreview` 文案改为「总结到目前为止的对话（含当前回合）」。旧存储值由 normalizer 丢弃。
  - 测试：`tests/server/compaction-message.test.mjs` 改写为「插入点=数组末尾」并新增 run 内工具链场景（线在链尾、上下文=摘要）；`tests/server/auto-compaction.test.mjs` 删掉两个 tail 解析 describe，新增「快照平移：压缩后第一条消息不丢」「快照含摘要时不平移」；history/notice/orchestrator/approval-store/agent-compaction 与 6 个前端测试文件断言同步。
- 前端零改动即可生效：分割线位置本就由消息下标决定（方案 B），改的是服务端插入位置。
- 验证：定向 `npx vitest run`（15 文件 / 175 用例）全过；全量 `npm run test` → 480 files / 5447 passed / 2 skipped；`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；`npm run build` → 成功。未创建 Git commit，未触碰生成产物。
- Notes：压缩刚完成时线在列表末尾、下方暂时为空，直到下一条流式消息出现（mockup 方案 B 明示的过渡态，用户已接受）。审查中列出的 P3（`effectiveContextMessages` 用绝对下标切窗口数组，仅影响上下文百分比）、P4（压缩行被当 turn 边界 / 轮次导航多一条）、P5（`messages_replaced` 后无滚动锚点恢复）按用户裁定不修，留档备查。

## compaction-as-message（done，2026-11-01）

- Goal：按用户裁定完整实现「架构 B（压缩即消息）+ 视觉 A（既有分割线样式）」，测试/构建通过后提交并推送。
- 结论（一句话）：压缩摘要变成 messages 里的一条真实消息（role:user + details.quickforgeCompaction，插在 tailStart），分割线就是它按消息下标渲染出来的既有 DOM；模型上下文从最后一条压缩消息切片，回滚删掉它即撤销压缩 —— 界面、模型、回滚读同一个位置事实，坐标换算整段消失。
- 关键改动：
  - 后端 `compactSessionInPlace()` 插入摘要消息并同步 `compactedUpToIndex`（插入下标 + 1）与 `sourceMessageCount`；持久化走 `forceMessagesReplace`（中间插入不能被当成尾部追加）；`messages_replaced` 事件带新数组。
  - `buildAutoCompactLoopMessages()` 改为从最后一条压缩消息切片，旧会话保留虚拟拼接兜底。
  - 回滚/重试改按「压缩消息是否还在数组里」判定，`syncCompactionIndex()` 重算派生下标；未迁移旧会话仍按 `compactedUpToIndex` 兜底。
  - `ensureCompactionMessage()` 幂等迁移，挂在 `restoreAgent` 与 `syncSessionFromStorage`（写库 + 广播 `compaction_migration`）。
  - 前端新增 `compaction-message.ts`（识别）与 `CompactionMessage.tsx`（渲染），`MessageList` 按消息分派；装饰层跳过压缩行（不加编辑/回滚/重试/输入折叠/chips）；等待气泡不再把压缩消息当作用户消息。
  - 删除 `resolveCompactionMarkers` / `resolveCompactionBoundary` / `locateAfterCompaction` / `messageTimestampMs` / `anchorIndex` / `shiftCompactionToLocal` / `CompactionMarker` / `CompactionBoundary` 与 MessageList 的 marker 插槽；ChatSurface 不再做窗口换算。
- 验证：npm run test → 480 files / 5456 passed / 1 skipped；npm run lint → 0 errors（仅 coverage/ 3 条既有 warning）；npm run build → 成功；npx tsc -b → 0 错误。
- Notes：旧会话迁移只在会话被恢复/同步时发生，未打开的旧会话保持原样（内存里仍按兜底切片，行为不变）。同一回合内连续压缩仍会产生多条分割线 —— 合并成一行属于独立迭代。

## edit-first-message-resend-stay-in-session（done，2026-11-01）

- Goal：用户反馈「编辑第一条消息后点发送，会话被切到/跳回新的对话页面」，期望留在当前对话继续。
- 结论（一句话）：`performRollback` 把「截断后为空」当成「删会话 + 新建 agent」的理由；就地编辑重发路径（`restoreDraft=false`）现在无条件留在当前会话，删空会话只保留给传统 `rollbackFromMessage`。
- 根因链：编辑第一条 → `rollbackIndex = 0` → `nextMessages = []` → `shouldSaveSession`（需 user + assistant）为 false → `disposeAgentTask` + `storage.sessions.delete` + `refreshSessions(broadcast)` + `randomId()` 新建 session + `createAgent(..., attachToView: true)` → `attachTaskToView` 的 `history.replaceState` 写入新 `?session=`，视图跳走，随后 composer 发出的新文案也进了新会话。
- 实现要点：`const keepCurrentSession = !restoreDraft || shouldSaveSession(nextMessages)`；命中即 `setChatPanelRevision` + （有 task 时）`syncSessionUI` 后返回 true。`restoreDraft` 分支行为完全不变。分享页 `SharedConversationPage.rollbackForResend` 早已是「只 `agent.rollback` 后返回 true」，本次让主聊天对齐。
- 改动文件：`src/hooks/useChatActions.ts`、`src/components/chat/ChatPanelHost.tsx`（两处注释不再声称重建会话，`waitForComposerSend` 逻辑不变）、`tests/frontend/edit-first-message-resend-keeps-session.test.ts`（新增 3 例：留在当前会话 / 仍有历史时同样不重建 / 传统回滚仍重建）、`docs/wiki/src/hooks/README.md`、`CHANGELOG.md`、三件套。
- 验证：`npm run test` → 479 files / 5467 passed / 1 skipped；`npm run lint` → 0 errors（仅 coverage/ 3 条既有 warning）；`npm run build` → 成功。未创建 Git commit，未触碰生成产物。
- Notes（未扩大范围）：
  - 会话标题仍是旧的：`syncSessionUI` 只在 `titleNeedsGeneration(task.title)` 时重算，保留会话后标题不会被重置为 `New chat`；旧行为靠「新会话 + New chat」自然重算。要修需把 `setCurrentTitle` 或标题重置能力下沉到 `useChatActions`，属独立改动。
  - 若用户编辑第一条后**没**发送就切走，当前会话会以「0 条消息」留在列表里（旧行为是删掉）。是否需要在空会话离开时清理，需产品口径。
  - `performRollback` 中 `restoreDraft=false` 时仍会走 `resolveAttachmentsForDraft`（结果只写进未使用的 `restoredRollbackDraft`），属既有冗余，本次未动。

## compaction-divider-anchor-cut（done，2026-11-01）

- Goal：压缩分割线要出现在「正在压缩上下文」的位置，且压缩之后继续执行的内容（tool 调用等）必须排在线下方；运行中不能出现「线固定贴在列表底部」。
- 根因：位置是按消息**索引**算的（`occurredAtIndex` / `boundaryIndex`），而列表渲染的是移动窗口（会话 `messageBaseSeq` + 回合窗口）。长会话运行时两者一起滑动，索引换算漂移后被 clamp 到窗口末尾——线就固定贴在底部，后续 rows 全都在它上面。
- 结论（一句话）：改成**按内容锚定**——`locateAfterCompaction()` 用 `compactedAt` 与消息时间戳比较，找到「本轮压缩之后产生的第一条消息」，线插在它之前；摘要行、之后的回答和所有 tool 调用天然都在线下方，不会再漂。记录索引降级为回退（payload 没有可用时间戳，或刚写完摘要还没有新消息）。
- 过程：先后试过「切点 `boundaryIndex`」和「发生时刻 `occurredAtIndex`」两种索引锚点，前者把线抬到当前回合开头、后者在长会话里贴底，都被用户否掉；索引方案在窗口态下不可靠，故改为时间戳（内容）锚定。
- 追加修复（2026-11-01，用户复测「压缩后线上方仍有 tool 在跑」）：时间戳单锚点在「压缩发生在某条消息的流式期间」时必然失效——那条消息的 `timestamp` 是首个 token 的时刻，早于 `compactedAt`，扫描跳过它并把线压到该行下面，压缩后继续产生的 tool 调用于是全留在线之上。改为**双信号取更靠前者**：`ChatSurface` 已把 `occurredAtIndex` 经 `shiftCompactionToLocal` 换成本地窗口坐标，这条记录（精确物理位置）与 `locateAfterCompaction`（时间戳）取 `min`——记录索引变旧/偏大时时间戳把线拉回正确行，跨压缩点的流式消息则由记录索引挡住。真实会话 `bb43345d`（18:10:28 / 18:11:28 两次压缩，135 条消息）复算：`baseSeq=0` 时两条线仍落在 seq 23 / 48 之前（row 9 / 19），窗口态压缩点在窗口外时钳到窗口首行。
- 改动文件：`src/components/chat/surface/ContextCompactionNotice.tsx`（新增 `messageTimestampMs` / `locateAfterCompaction`，marker 新增绝对值 `anchorIndex`）、`src/components/chat/surface/MessageList.tsx`（key 用 `anchorIndex`）、`tests/frontend/context-compaction-anchor.test.ts`（新，4 例）、`tests/frontend/context-compaction-notice.test.ts`、`docs/wiki/src/components/README.md`、`CHANGELOG.md`、三件套。
- 验证：`npx vitest run`（context-compaction-anchor / -notice / -rows / assistant-waiting-bubble）→ 4 files / 52 tests 全过；`npx tsc -b` 0 错误；`npx eslint` 改动文件 0 problems；`npm run build` 成功。未创建 Git commit，未触碰 dist 手工修改（仅 build 生成）。
- 布局裁定（2026-11-01，用户看 docs/design/compaction-anchor-preview.html 后选方案 B）：线只表达压缩发生/生效的位置，摘要仍留在 pill 自己的折叠区（复制按钮与 1200ms 反馈不变），**不在消息流里额外插一行摘要**；候选方案 A（锚定切点，线被抬到当前回合开头）与 C（线下紧邻一条摘要行）均已放弃，先落地的 C 记录行已回退。
- Notes：顺带观察到自动压缩会在长运行里反复触发（实测某会话 7 分钟内压了两次，每次都在当时末尾留一条线）；如果仍觉得「每次都在底部冒新线」，下一步应考虑对同一回合内的连续压缩合并为一条，而不是继续调锚点。
## inspector-open-state-no-memory（done，2026-11-01）

- Goal：用户要求「不要记住右边侧边栏的打开状态」（Workspace Inspector 开合零记忆）。
- 结论（一句话）：App.tsx 的开合记录 `workspaceInspectorOpenScopeId` 改为零记忆——runtime scope 变化的渲染里同步清空（新增 `workspaceInspectorObservedScopeId` 做 render 期调态），切走再切回曾展开面板的会话不再自动弹开，任何会话切换后一律默认收起。
- 根因：开合按「在哪个 runtimeScope 打开的」派生，切走会话派生值变 false 但记录残留；切回旧会话时 scope 重新匹配即恢复展开（表现为「记住打开状态」）。
- 实现要点：React 官方 render 期调态模式，不用 useEffect 同步 setState（`react-hooks/set-state-in-effect` error）；打开路径（PanelRight toggle、`requestWorkspaceInspector` 各请求、Inspector `onOpenChange`、ChatPanelHost live present_files 自动预览）与 tab 按 (projectId, sessionId) 的持久化恢复全部不变；deferred 会话晋升真实 session 沿用同一 scope，首条发送期间已展开的面板不受影响。
- 验证：定向 `npx vitest run`（workspace-inspector-session-switch-close / workspace-inspector-request / auto-preview-fresh-present / conversation-trace-contract）→ 4 files / 47 tests 全通过；`npx eslint src/App.tsx` → 0 problems；`npx tsc -b` → 0 错误。未跑全量。

## zustand-store-migration（done，2026-11-01）

- Goal：把 App.tsx 手写 useState + 自定义 hook + props 下发的应用级状态迁移到 Zustand（P0–P4 全阶段），替换 3 个 window CustomEvent 事件桥。
- 结论（一句话）：新增 `src/stores/` 十个 zustand store 承载全部可序列化应用级状态，原 hook 全部保留为薄兼容层（selector 订阅 + 返回结构不变，调用方零改动），ChatSidebar/ConversationHeader/useMobileSidebar 已去 props 直连 store，3 个事件桥由 ui-store 请求信号（payload+nonce）替代。
- 逐项：
  1. **P0 基础**：zustand@^5.0.16（devDependencies，与 react 同列）；`vitest.config.ts` inline zustand（外部化依赖内部 `import React from 'react'` 不经 `vi.mock('react')` 拦截，mock-react 测试会拿到真实 React 崩溃）；`tests/frontend/helpers/hook-lifecycle.ts` 补 `useSyncExternalStore`/`useDebugValue` + `reactMockWithRuntime(original)`（mock 的 react 必须带 default 导出，zustand 以 `React.*` 消费）。
  2. **P1 试点**：task-toasts-store（action 恒定，非 React 代码可 `getState().addToast()`）、sidebar-ordering-store（action 内直写 localStorage；初始加载不再回写默认值）。
  3. **P2 UI 域**：ui-store（16 项 UI 状态，setter 全部 `Dispatch<SetStateAction<T>>` 签名兼容函数式更新）+ 请求信号（settingsTabRequest/artifactPreviewRequest/openSessionRequest）；MemorySettingsTab、tool-renderers/shared、react-settings-tabs、system-notifications 的 dispatch 改 `useUIStore.getState().requestXxx()`，App/SettingsWorkspacePage 订阅处理即清除（丢弃语义与旧事件一致）。ChatSidebar 去 14 个 UI/ordering props（内部直连 ui-store + sidebar-ordering-store；`onToggleSidebar` 按 variant 分派：desktop=toggle 栏宽、mobile=关抽屉；toggle*Collapsed 的 show-more 失效包装版由 useSidebarSessionDisplay 返回，裸 store toggle 经入参传入）；ConversationHeader 去 conversationMenu/移动侧栏 3 props；useMobileSidebar 去 ui 参数。
  4. **P3 数据域**（并行 4 subagent）：sessions-store（四路分页；refs 镜像删除改 `getState()` 同步读；requestVersion 守卫与 250ms 合并轮留 hook）、project-store（expandedProjectIds 持久化直写）、git-store（titleGitStatus+4 开合；fetch/SSE 400ms debounce/请求守卫 ref 留 hook）、runtime-statuses/update-check/agent-access-mode 三小域。
  5. **P4 核心域**：agent-session-store（currentSessionId/currentRuntimeScopeId/currentTitle/chatScope/currentToolProject/taskStatuses/chatPanelRevision/loadingSessionId 8 项）；agent 实例（ServerAgent 不可序列化）、全部 ref（稳定回调公共接口）、LRU 淘汰/in-flight 去重/事件订阅留 hook；`currentRuntimeScopeId` 初值改为 store 模块创建时的 `randomId()`（等价旧 lazy useState）。
  6. **契约测试**：sidebar-section-order（断言指向 store 订阅 + sharedSidebarProps 不含已迁字段）、conversation-trace-contract（conversationViewScope 结构断言指向 ui-store）、tool-renderer-file-icon/settings-workspace-react/system-notifications（dispatch 断言改 store 状态断言）、session-pagination-bootstrap（reactStub.states 改 getState）、app-domain-hooks（reactMockWithRuntime + beforeEach 复位全局 store）。
- 关键约束（别踩）：
  - **只 selector 订阅**：整对象订阅会让 ChatSidebar（memo）全列表重渲染；SessionViewPool 保活依赖引用稳定。
  - **非序列化对象不进 store**：ServerAgent 实例、taskMap、unsubscribe、abort controller 留 hook 的 useRef/闭包。
  - **副作用留 hook**：fetch/SSE/轮询/debounce/持久化不进 store；localStorage 域可用 action 内直写（sidebar-ordering 先例）。
  - store 单测必须 `beforeEach` 显式复位（模块级单例跨用例泄漏）。
- 已知差异（有意为之）：dev StrictMode 重挂/HMR 下已迁域状态跨挂载保留（原 useState 重置）；生产整页加载语义不变。
- 明确不做：usePinnedSummaryModel（派生 view-model）、useAppTheme/useCodeFontMetrics（DOM 镜像多实例）、useAppBootstrap 编排层、useChatActions/useModelActions/useSessionActions 等无状态依赖注入 hook（改写为 store action 收益低风险高）；src/storage/stores 持久化层与本次无关未动。
- 验证：分阶段针对性 vitest 全绿；全量 `npm run test` → 478 files / 5459 passed / 1 skipped（中途 scheduled-tasks.commands 一次 12 用例超时为与 lint 并行跑的资源竞争 flaky，单独复跑通过）；`npx tsc -b` → 0 错误；`npm run lint` → 0 errors；`npm run build` → 成功。未创建 Git commit，未手工修改生成产物。

## sqlite-legacy-auto-upgrade（done，2026-11-01）

- Goal：旧库（`user_version` 1..18）不再因 baseline v19 的版本门禁而启动失败，改由程序在启动时自动升级，并保证可回退。
- 结论（一句话）：冻结退役的 v1..v18 迁移链，启动时先 `VACUUM INTO` 备份、再在同一写事务内补齐旧链并归一化为 baseline v19；元数据不一致仍 fail closed。
- 逐项：
  1. **冻结旧链**：`server/sqlite/legacy-migrations.mjs` 保存 v1..v18，仅用于旧库升级，不再参与新库建表；`LEGACY_COMPAT_TABLES` 列 11 个兼容期对象，`LEGACY_DROPPED_COLUMNS` 处理历史漂移列 `sessions.harness`。
  2. **只读预检 + 快照**：`initializeSqliteStorage` 在 `configurePragmas` 后调用 `inspectSqliteMigrationState`，仅当旧库元数据与冻结链逐条一致时，才用 `VACUUM INTO` 写 `<db>.pre-v19-from-v<旧版本>-<时间戳>.bak`；备份失败中止升级。
  3. **事务内升级**：`applySqliteMigrations` 在 `BEGIN IMMEDIATE` 之后重新读取 `user_version`（并发启动时若已被其他进程升级则跳过），补齐剩余旧迁移、删除兼容期表与退役列、把 `schema_migrations` 改写为单条 baseline、`user_version=19`；任一步失败整体回滚。
  4. **升级后压缩**：成功后执行一次 `VACUUM`，让 `auto_vacuum=INCREMENTAL` 在旧文件上生效并回收空闲页；失败只 WARN，不回滚已提交的 schema 升级。
  5. **测试**：新增 `tests/server/sqlite-legacy-upgrade.test.mjs`，用冻结链构造 v1..v18 全版本旧库，断言升级后的表/索引集合与全新 baseline 完全一致、数据保留、快照内容为旧版本、`auto_vacuum=2`、异常元数据不写库；foundation 原有的“旧库拒绝”用例改为“元数据不一致拒绝”。
- 验证：`npm run test` → 468 files / 5408 passed / 1 skipped；`npx eslint` 改动文件 → 0 problems；`npm run lint` → 0 errors（仅 coverage/ 3 条既有 warning）；`npm run build` → 成功。真实 v12 备份（754MB / 313 会话 / 17,341 消息）用新路径升级约 9s，计数/指纹一致；线上库补 `VACUUM` 后 `auto_vacuum=2`、quick_check ok，已重启并 health ok。
- Notes（未扩大范围内的问题）：
  - `closeSqliteStorage` 的日志把 `state.migrations.length` 当成 `schemaVersion` 输出（`server/sqlite/database.mjs:430`），关闭日志恒为 `schemaVersion=1`；与本次功能无关，未修改。
  - 升级快照命名为 `<db>.pre-v19-from-v<旧版本>-<时间戳>.bak`，确认无误后可手动删除；文档 §8 已记录超大库首次启动的时间与磁盘成本。

## a11y-focus-ring-invariant（done，2026-10-31）

- Goal：评审 A 档——把「移除了默认焦点环但没有替代」的控件补齐，并用一条不变式测试防止以后再丢。
- 结论（一句话）：19 处缺口全部补上（TSX 侧 17 个控件、CSS 侧 3 条规则），新增 `focus-ring-invariant` 测试用 TS AST 扫描全部 tsx 守住这条线；鼠标聚焦视觉不变（原 `outline: none` 保留，只在 `:focus-visible`/`:focus-within` 上加环）。
- 逐项：
  1. **`AgentProfilesPage.tsx` 11 处**（textarea ×2 / input ×5 / select ×3 / 模型选择 button 触发器 ×1）：追加 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring`，与 `ui/input.tsx:9` 完全同套。该文件改前 `focus`/`focus-visible` 命中为 0，是最大单点缺口。
  2. **容器承接焦点的 3 处**：`WorkspaceTreePanel`（label）、`WebPreviewContent`（胶囊 label）、`SidebarSearchDialog`（div）加 `focus-within:border-ring focus-within:ring-2 focus-within:ring-ring`，内部 input 保持 `outline-none`——这是项目既有做法（`skills.css:243-246`）。
  3. **`GitCommitPushDialog` 提交信息 textarea**：`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset`（无边框容器，inset 才不会溢出弹窗）。
  4. **`SharedConversationPage` 分享密码输入**：标准 `focus-visible` 环（该输入 `autoFocus`，此前完全无焦点反馈）。
  5. **CSS 三处**（只追加新规则，不动原 `outline: none`）：`empty-state.css` 的项目选择器搜索用容器 `:focus-within`（父容器没有 border，所以用 `box-shadow` 环 + 临时圆角，与 skills 搜索同配方）；`goal-workflow.css` 的 Goal 就地编辑输入、`runtime-notices.css` 的队列消息就地编辑输入各补 `:focus-visible` 的 2px `outline`（沿用本文件已有 `--ring` 65%/70% 的写法）。
  6. **新增 `tests/frontend/focus-ring-invariant.test.ts`**：用 TypeScript AST 遍历 402 个 tsx，规则是「className 含 `outline-none` 就必须在同元素出现 `focus-visible:`/`focus:`，或由容器 `focus-within:` 承接并登记在 `EXEMPTIONS`」；第二条用例反向校验白名单不过期。当前 5 条豁免：`App.tsx` 的抽屉容器（`tabIndex={-1}`，非控件）、composer textarea（`.quickforge-composer:focus-within` 承接）、以及上面第 2 条的 3 个 input。
- 关键约束（别踩）：
  - **不要动原规则的 `outline: none`**：那是「鼠标点击不出环」的既有视觉，补的只是 `:focus-visible`/`:focus-within` 分支。
  - 内联编辑（无边框容器）用 `ring-inset` / `outline-offset: 1px`，不要用外扩环，否则会溢出弹窗或卡片边缘。
  - 白名单只能加在「焦点确实由容器承接」的元素上，并且必须写 reason；元素自带环以后要从白名单移除（第二条用例会红）。
  - 移动端 webview 触摸聚焦不触发 `focus-visible`：`MobileServerConnectPage` 保持 `focus:shadow-quickforge`，不要改成 `focus-visible`。
- 明确不做（记录理由，避免下次重复评估）：
  - **img width/height**：实测全仓只有 15 个 `<img>`（此前说的 17 把注释算进去了）。其中 9 个是 `size-*` 图标，CSS 已给固定像素、CLS 为 0，加 `width/height` 是零收益噪声；其余 6 个是内容大图（附件预览、SVG 代码预览、Markdown 图片、Mermaid 输出），靠 `max-w-full` 自适应，硬编码尺寸会比例失真。真要压 CLS 只能配 `aspect-ratio` 占位，属可见行为变化，不在本次范围。
  - **`app-domain-fixture` 指纹守卫**：上一轮评审说它「用硬编码行号切 `App.tsx`」是**说重了**——它切的是 `.goal-runtime-refactor-baseline/App-before-split.tsx` 这份冻结快照（由 `QUICKFORGE_APP_DOMAIN_AUDIT` 开关启用），不是活动文件，因此不会随 `App.tsx` 改动错位。真正脆弱的是 74 处源码文本断言，那个只能靠逐个替换成真渲染来消解。
  - **i18n mock 去重**：74 处 `vi.mock('@/lib/i18n')` 形态各异（有 `virtual: true`、有自定义 `t` 实现、有 `t: (key) => \`${lang}:${key}\``），批量替换到公共 stub 收益小、改坏测试的风险大。
- 验证：新增 `focus-ring-invariant` 2 passed；`css-architecture` 5 + `semantic-color-class-parity` 3 + `chat-surface-css-contract` 37 → 45 passed；全量 `npm run test` → 467 files / 5387 passed / 1 skipped（基线 466/5385，多出本次新增文件与其 2 个用例）；`npx eslint` 改动文件 → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功（8.19s，`[precompress] 224 files: 12.67MB → 6.49MB`）。未创建 Git commit，未手工修改生成产物。
- 未更新 wiki 的原因：仅样式/焦点可见性与测试护栏变化，组件契约、公共入口与发布流程未变。

## frontend-review-p0-a11y-and-sidebar-props（done，2026-10-31）

- Goal：按前端评审结论，落地两条「不改行为与交互」的 P0——核心控件的可访问名称、桌面/移动侧栏共享 props。
- 结论（一句话）：消息输入框与两个 imperative 弹窗终于有可访问名称/对话框语义（纯属性，无视觉、无焦点顺序变化）；`App.tsx` 里两份手写的 `ChatSidebar` props 列表合并为一份 `sidebarCommonProps`，两处挂载 props 名称集合与取值逐项不变。
- 逐项：
  1. **消息输入框**（`MessageEditor.tsx`）：textarea 补 `aria-label={t('composerInputLabel')}`（`i18n.ts` en/zh 各加一条）。此前只有 `placeholder` + `aria-readonly`，读屏用户一旦输入就失去控件名；这是全应用主入口。
  2. **`prompt-dialog`**：面板补 `role="dialog"` + `aria-labelledby`（`useId` 关联 `<h2>`）/ `aria-describedby`；输入框用 `options.title` 作可访问名称。该文件此前 `role=` 为 0。
  3. **`GitGraphDialog`**：面板补 `role="dialog"` + `aria-labelledby`（`useId` 指向标题行），此前同为 0。
  4. **侧栏 props 去重**（`App.tsx`）：桌面 L1592 与移动抽屉 L1628 两处 `<ChatSidebar>` 共有 52 项完全相同的 props，抽成 `const sidebarCommonProps`（渲染体内、`return` 之前）；两处改为 `{...sidebarCommonProps}` + 各自的入口回调（移动端多一层 `closeMobileSidebar()` 包装、另有 `variant="mobile"`/`sidebarOpen` 与 `onWidthChange` 差异）。展开后 props 名称集合 69=69、68=68，取值表达式未变，`memo(ChatSidebar)` 浅比较结果不变。
  5. **测试同步**（`sidebar-section-order.test.ts`）：原断言按 `prop={value}` 在 App 源码中出现 **2 次**计数；改为「`sidebarCommonProps` 里每项定义一次 + `{...sidebarCommonProps}` 出现两次」，意图（桌面/移动共享同一份状态与回调）保持不变且更强。
- 关键约束（别踩）：
  - **不要给 `prompt-dialog` / `GitGraphDialog` 补 `aria-modal="true"`**，除非同一提交里实现了焦点陷阱：全仓只有 `ui/confirm-dialog.tsx` 有 trap，`aria-modal` 会向读屏声明一个不成立的模态边界（P2「统一 focus trap」再一并加）。
  - `sidebarCommonProps` 必须是「两处挂载真正相同」的 props 集合：带 `closeMobileSidebar()` 包装的回调（`onSelectProjectDirectory` / `onOpenSettings` / `onOpenServer` / `onOpenUpdate` / `onOpenProjectInExplorer` / `onLoadSession` / `onStartNewDefaultChat` / `onStartNewGlobalChat` / `onToggleSidebar`）不得塞进共享对象。
  - 共享对象在渲染体内重建是预期行为：`memo` 比较的是展开后的单个 prop 值，不是对象本身，因此不要改成 `useMemo`（会掩盖依赖）。
  - `expandedProjectIds` 等在 App 里是解构出的同名变量，`sidebarCommonProps` 用简写；会话分区排序断言依赖这一点，改写法要同步测试。
- 验证：`npx vitest run sidebar-section-order` → 22 passed；侧栏/项目选择五个源码契约测试 → 44 passed；改后全量 `npm run test` → 466 files / 5385 passed / 1 skipped（与基线一致）；`npx eslint` 改动文件 → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功（3.00s，仅既存的 chunk >500kB 提示）。未创建 Git commit，未手工修改生成产物。
- 未更新 wiki 的原因：仅组件内部 props 组织方式与 ARIA 属性变化，公共入口、组件契约与发布流程不变；`docs/wiki/src/components/README.md` 记录的 `ChatSidebar` 模块拆分与源码契约读取方式未受影响。

## chat-scrollbar-gutter-stable（done，2026-10-31）

- Goal：修「展开普通 tools 时整列左右抖动」。
- 结论（一句话）：抖动不在工具卡里，而在主滚动容器的竖向滚动条占位——`.qf-scroll-container`（`overflow-y:auto`）+ 居中内容列（`mx-auto max-w-3xl`）+ classic 8px 滚动条，内容刚过一屏时滚动条出现/消失让 `clientWidth` −10px，整列左右平移约 5px。
- 实测（dev 页面，真实 class 链）：
  - 卡内不动：`.quickforge-tool-header` / `.quickforge-local-tool` / `.quickforge-tool-summary` / `.quickforge-tool-label` 展开前后 x 与 width **完全一致**（138.34 / 810、804.375、450.86）。`311a2a2` 的 header/panel 分层与 `tool-output.css:49-57` 的宽度锁链仍然有效。
  - 整列会动：内容不满一屏 `clientWidth=990`、列 `x=128.43`；内容超一屏 `clientWidth=980`、列 `x=123.34`（−5.09px），折叠回去反向再抖一次。
  - 为什么是「普通 tools」最明显：`read_file` / `run_command` 展开一次增高几百 px，最容易把内容从「不满一屏」推过阈值；任何改变高度的操作（折叠 process 组、流式增长）本质同源。
- 改动：
  1. `src/styles/chat/messages.css`：`.qf-chat-panel > .qf-scroll-container` 加 `scrollbar-gutter: stable both-edges`。实测有无滚动条时 `clientWidth` 恒 970、列 `x` 恒 128.43——与「没有滚动条」时的位置完全一致，既不抖也不偏。只写 `stable` 会恒定偏左 5px，等于把抖动换成永久偏移。
  2. `tests/frontend/chat-surface-css-contract.test.ts`：在主滚动容器契约里补 `scrollbar-gutter: stable both-edges;` 断言。
- 关键约束（别踩）：
  - 不要退回只写 `stable`（恒定偏左 5px），也不要改成隐藏滚动条（丢失滚动位置反馈）。
  - `both-edges` 的前提是 classic 滚动条（`foundation.css` 的全局 `*::-webkit-scrollbar`）。若未来改成 overlay 滚动条，本规则自然失效但无害，不要同时再叠 `scrollbar-width: none`。
  - 只加在主聊天滚动容器上；composer 区（`.shrink-0 > .max-w-3xl`）、侧栏、Inspector 不在本次范围，别顺手扩散。
  - 此前几轮修的都是**横向**溢出（`overflow-x:hidden`、摘要行局部滚动容器、header/panel 分层），竖向滚动条占位从未处理（`docs/archive/progress-archive.md` 第 ④ 条曾列为未做候选，本次已落地）。
- 验证：定向 `chat-surface-css-contract` + `scroll-to-bottom-button` → 2 files / 50 passed；`npx eslint` 改动文件 0 problems；vite dev 实测 computed `scrollbar-gutter=stable both-edges`，内容 100px→2100px 时 `clientWidth` 恒 580、列 `x` 恒 23.18。未创建 Git commit，未手工修改生成产物。

## main-ui-perf-review-followup（done，2026-10-31）

- Goal：按评审结论，在不影响体验与交互的前提下，把主界面可安全等价实现的性能项一次做完。
- 结论（一句话）：三处真实热点被削掉——含 JSX/HTML 代码块的长回答恢复流式分块缓存；工具输出期间置顶摘要不再以 ~20fps 触发 App 级重渲染与全量扫描；轮次导航/侧栏/readWindow 的装饰与渲染固定成本改为身份缓存或稳定回调。
- 逐项：
  1. **流式分块围栏修正**（`markdown-stream-chunks.ts`）：`isSelfContained` 改为只检查围栏外的 HTML 起始行与数学定界符（`\[`/`\(` 成对）。旧实现扫整段冻结前缀，代码块里的 `<div>` 或字面量 `\[` 会让含这类代码的回答每帧退回整段解析。新增 JSX 围栏的渲染等价性用例、围栏内不配对定界符用例、围栏外 HTML 块仍拒绝冻结的用例。
  2. **置顶摘要订阅收窄**（新增 `src/lib/pinned-summary-events.ts`）：`tool_execution_update` 不再 bump revision。该事件按服务端合并后的 ~20fps 到达，只原地增补 toolResult；todos/终态 subagent/background 都在 start/end/message_end/messages_replaced/agent_end/goal_updated 等结构性边界变化。`usePinnedSummaryModel` 改走 `shouldInvalidatePinnedSummary()`，并有契约测试锁定高频事件不触发。
  3. **轮次导航模型复用**（`turn-navigation-data.ts` + `turn-navigation.ts`）：新增 `createConversationTurnResolver()`，按 messages 数组身份 + streaming 标志缓存 turn 投影；update() 只在输入变化时重建投影与签名，idle 装饰 pass 不再重扫全部正文。`userText` 顺带只读一次 `message.content`（原来 string 分支读两次属性）。
  4. **侧栏 memo 恢复**（`App.tsx`）：桌面 `ChatSidebar` 的 `onLoadSession` 从内联箭头改为 `useCallback`，避免每次 App 渲染（含结构性 agent 事件）击穿 memo、重渲染所有可见会话行。
  5. **会话菜单监听稳定**（`App.tsx`）：effect 只依赖 `conversationMenuOpen` 与稳定 setter，不再把整个 `ui` 对象放进依赖数组。
  6. **readWindow 索引缓存**（`ChatSurface.tsx`）：最后一个用户轮索引按 messages 数组身份 WeakMap 缓存，去掉每次渲染的全量 `findLastIndex`。
- 明确不做（写入 `docs/architecture/chat-render-perf-review.zh-CN.md` §8.2）：单轮超长 Agent 任务的轮内行窗口（会引入新分页交互与滚动锚点语义，违反「不改变交互」）；保活隐藏会话暂停装饰（需切入时同步重放完整装饰，属切换时序契约，需真机验证）；WorkspaceInspector 延迟到首次打开（会改变标签页/终端/预览的状态保留）；SkillsDialog 懒加载 / CSS 拆分 / `backdrop-filter`（状态保留、全局级联与可感知视觉风险）。
- 关键约束（别踩）：
  - `isSelfContained` 的围栏判定必须继续用它拿到的 `fences` 区间；不要再退回整段正则扫描，否则 JSX/HTML 代码块会让分块缓存永久失效。
  - `shouldInvalidatePinnedSummary` 不得重新加入 `tool_execution_update`/`message_update`；若未来某个置顶投影需要逐帧数据，应单独为它建窄订阅，而不是把整棵 App 拖回 20fps。
  - `createConversationTurnResolver()` 的缓存依赖「messages 数组在写入时被替换、消息对象不被原地修改」；调用方必须把返回数组当作只读（它与缓存共享）。
  - `ChatSidebar` 的 props 里不要再放内联回调；桌面与移动两处入口都要保持回调引用稳定。
- 验证：定向 17 files / 248 passed；全量 `npm run test` → 466 files / 5385 passed / 1 skipped；`npm run lint` → 0 errors（3 个 coverage/ 存量 warning）；`npx tsc -b` → 0 错误；`npm run build` → 成功（`[precompress] 224 files: 12.67MB → 6.48MB`）。未创建 Git commit，未手工修改生成产物。

## chat-render-dom-perf-followup（done，2026-10-31）

- Goal：在「不影响体验和交互」前提下，把 CSS/DOM 防卡顿清单里可等价实现的部分一次做完。
- 结论（一句话）：只动了不会改变视觉与交互时序的路径——回底按钮不再在每个装饰 pass 里强制布局，工具控制台/消息拖动消除读写交替，清理了布局属性的 `will-change` 与非必要过渡。
- 改动：
  1. `scroll-to-bottom-button.ts`：`ResizeObserver` 观察滚动容器 + `.max-w-3xl` 内容列，滚动时缓存距离；重复 `setup()` 只重放缓存判断。无 `ResizeObserver` 的环境仍走原测量兜底。顺带修复：只读会话移除 dock 后 `visible` 状态保留，重建新按钮时补写 `is-visible`。
  2. `tool-renderers/shared.tsx`：`syncConsoleScrollFades` 先读完水平几何再写 `scrollTop`，并跳过值未变化的 `data-overflow-*` 写入。
  3. `message-queue.ts`：`pointermove` 只记录坐标，兄弟节点 rect 读取与占位符移动统一进既有 `tick()`；`pointerup` 前用 `lastClientY` 结算落点。
  4. `WorkspaceInspector.tsx`：删除静态 `will-change-[width,opacity,transform]`；`width` 不是可合成属性，静态 `will-change` 不能省布局。
  5. `foundation.css`：用户气泡 `transition: all` 收窄为显式列表（颜色/阴影 + 原有 `max-width`），窗口缩放行为不变。
  6. `MessageList.tsx`：`data-message-index` 值未变化时不再写属性。
  7. `context-usage.ts`：tooltip 的 scroll/resize 定位合并到 rAF，关闭时取消挂起帧。
  8. `WorkspaceTabStrip.tsx`：关闭按钮的 `transition-all` 收窄为 `opacity/background-color/color`。
- 明确不做（原因）：`content-visibility`/CSS containment（测试禁止消息宿主、破坏滚动锚定）；虚拟列表（既有否决）；`width` 过渡改 `transform`（改变动画观感）；shimmer/box-shadow/backdrop-filter（可见视觉，需先 profile）；`startTransition`（改变流式调度）；scroll rAF 节流（既有否决）；装饰 pass 写后读重排（测量依赖装饰后布局）。
- 验证：定向 11 files / 206 passed；新增断言后 scroll-to-bottom-button 13 / message-queue 21 passed；复核后相关 9 files / 204 passed。全量：`npm run test` → 465 files / 5377 passed / 2 skipped（首轮曾出现一次 `tests/server/routes/session-index-query.test.mjs` 的 Windows 临时目录 `ENOTEMPTY` 清理竞态，该文件单独复跑 11/11 通过；复跑全量全绿）；`npm run lint` → 0 problems；`npm run build` → 成功（`[precompress] 224 files: 12.67MB → 6.48MB`），`tsc -b` 随 build 通过。
- 未创建 Git commit，未手工修改生成产物。

## model-sheet-check-immediate（done，2026-10-30）

- Goal：用户反馈「对话框，模型选择，点击不会马上勾选」，先定位再修。
- 结论（一句话）：抽屉式模型选择里点击后勾选不动，是因为 `selectModel` 还在往已废弃的 `.quickforge-model-menu-item-suffix` 写 `✓`，而勾选图标早在 `createMenuItem` 里就渲染进左侧 `.quickforge-model-menu-item-check-slot` 且只写一次；抽屉又保持打开不重渲染，所以只有 `aria-checked`（背景高亮）变了。
- 改动：`src/lib/custom-model-selector.ts`
  1. `selectModel` 改为重写 check-slot 的 `innerHTML`（`agentAccessCheckIcon` / 空），删掉失效的 suffix 分支 —— 勾选随点击立即移动。
  2. 滚动守卫从「最近 300ms 有过 scroll 就丢弃 click」改为 `isTapGesture`：记录 pointerdown 起点 + `SCROLL_SETTLE_MS=150` 内是否在滚动，位移超过 `TAP_SLOP_PX=12` 或按下时仍在滚动才忽略 —— 滑完列表马上点不再需要点第二次。
- 受影响入口：聊天输入框模型弹层（`useModelActions.ts` → `openCustomOnlyModelSelector`，`innerWidth <= 768`）、设置/Agent 配置页模型选择（`AgentProfilesPage.tsx:347` → `openModelSheet`，桌面也强制走 sheet）。桌面菜单不变（pointerdown 选中后立即关闭）。
- 关键约束（别踩）：勾选图标的唯一来源是 `.quickforge-model-menu-item-check-slot` 的 innerHTML；不要再按 `aria-checked` 之外的旧 class（suffix）写文本，CSS 里 `aria-checked="true"` 只给背景高亮。
- 验证：`npx vitest run custom-model-selector + model-selector-thinking-sync + composer-model-trigger` → 3 files / 31 passed（含新增用例）；`npx eslint` 改动文件 0 problems；`npx tsc -p tsconfig.app.json --noEmit` 0 错误。未创建 Git commit，未手工修改生成产物。

## chat-render-perf-memory（done，2026-10-30）

- Goal：用户要求「分析对话功能的显示性能和内存，评审可优化技术，前提不损害交互和用户体验」，随后要求「架构最优、完整实现、必要可重构等价实现、一次完成」。
- 结论（一句话）：三处真实成本被削掉——流式 Markdown 从「每帧全量解析」变成「稳定块缓存 + 只解析尾块」；工具事件从「一次事件双 full decorate + 服务端不合并」变成「单次 streaming/full pass + 50ms 合并」；装饰与列表的固定成本（artifact 建 DOM 后丢弃、轮次导航强制 reflow、折叠时间线扫两遍、每帧重建 items/keys/rows）改为「先判后建 / 复用时间线 / 记忆化」。
- 逐项：
  1. **流式稳定块冻结**（`markdown-stream-chunks.ts` + `Markdown.tsx`）：`blocks`（已闭合、可缓存）+ `tail`（每帧解析）。保守切分：只在空行切，两侧都不能是列表项/引用/缩进代码/表格行/setext/HTML 块；冻结前缀必须数学定界符成对；任一不满足返回 null 退回整段解析。元素树对象相同 → React bailout，稳定块内的代码块也不会重新高亮。
  2. **工具事件**：`tool_execution_update` 走 `streaming` 装饰；`start`/`end`/`background_commands` 走一次 full。`scheduleToolInterfaceUpdate` 改走 `decorateScheduler`（不再 rAF 内直接 `runDecorate`）。服务端 `tool_execution_update` 纳入 50ms trailing，双槽共享计时器（单槽会互相顶掉），非合并事件先 flush。
  3. **装饰固定成本**：artifact 卡签名前置（`resolveArtifactCardInputs` / `artifactCardSignatures`）；turn-navigation 测量缓存改为「输入变化 + 锚点 isConnected」失效；`collectProcessTimeline` 每 turn 一次；scroll-sync 缓存滚动容器。
  4. **列表每帧分配**：`items` / 已提交行 key / 已提交行元素数组按 `messages` 记忆化；流式行 key 用 `createRenderKeyIndex().appendKey`（O(1)，与整体求 key 逐字等价）。
  5. **渲染缓存**：单槽快路径（同字符串引用 O(1)）+ 字节预算（8/12/4/4/8MB）+ in-flight 严格比较。
  6. **SSE 序列化共享**：WeakMap 按对象身份复用 `JSON.stringify` 结果。
- 经评估否决（写进 `docs/architecture/chat-render-perf-review.zh-CN.md` §3）：scroll rAF 合并（浏览器已把 scroll 事件合并到每帧）、折叠 turn 级指纹前置短路（需行结构签名，与「每轮重新确认」语义冲突，有 goal-iteration-divider 前例）、流式自适应降频（不改变单帧成本）、保活视图字节权重（预算语义是渲染行数）、SSE delta / 虚拟列表 / 裁 `state.messages`。
- 关键约束（别踩）：
  - `appendKey` 必须**只读** occurrence 计数：递增会让同一流式行每帧换 key → 整行 remount。
  - 稳定块切分是「保守优先」：宁可返回 null 退回整段解析，也不能切在列表/引用/围栏/表格/HTML/跨块数学定界符中间。
  - `streamingBlockCache` 与 `markdownElementCache` 分开限额：块缓存生命周期只有一回合，不能把历史整段渲染挤出去。
  - `tool_execution_update` 的合并前提是「每帧携带完整累积 partialResult」（客户端按替换语义写入）；如果将来上游改成 delta，必须同时撤掉合并。
- 验证：定向 175 例全绿（assistant-artifact-card 20 / turn-navigation 12 / process-folding 63 / render-key-index 3 / render-cache-bounds 4 / markdown-stream-chunks 11 / streaming-render-cache 5 / routes/agent 57）；`npm run test` → 465 files / 5373 passed / 2 skipped；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功（`[precompress] 224 files: 12.66MB → 6.48MB`）。未创建 Git commit，未手工修改生成产物。

## remove-storage-backward-compat（done，2026-10-30）

- Goal：用户看到启动时的「数据库 migration（当前 v11）」问这是干嘛，讨论后决定「大版本不需要向前兼容」，把 JSON→SQLite 兼容层、迁移进度页与 18 条迁移历史一起删掉。
- 决策依据（写下来免得以后反复）：迁移引擎本身（schema_migrations + user_version + 事务应用，约 120 行）保留，因为删了等于「每次改表删库」；真正能删的是**兼容旧数据的代码**——cutover 三件套 1076 行、双路径 store、phase 状态机、进度页、18 条迁移折叠成 1 条 baseline。
- ① 四域单路径：删 `share-cutover.mjs`/`lan-access-cutover.mjs`/`scheduled-runs-cutover.mjs`/`share-json-file.mjs`/`lan-access-json-file.mjs`/`maintenance/downgrade-{share,lan-access}-v1.mjs`；维护锁提取为 `share-maintenance.mjs`/`lan-access-maintenance.mjs`/`scheduled-runs-maintenance.mjs`（照 `session-state-maintenance.mjs` 既有模式，锁表 share/lan_access/scheduled_runs_maintenance_lock）；`*-service.mjs` 只剩 repository 访问器与注入；`*-store.mjs` 删 JSON 分支/mirror 入队/phase 判断；`*-backup.mjs` 去掉 phase 字段与 authoritative 前置；仓储层删掉 mirror 队列 API 与 storage_state 计数更新；maintenance 只剩 `export-*-v1` 逃生通道。
- ② 启动窗口收窄：`startup-state.mjs` 状态 starting/ready/failed（删 MIGRATING、`readMigrationStatus` 域名投影），`/api/migration-status` 路由删除，白名单只剩 `/api/health`；前端删 `src/lib/migration-status.ts`、`components/migration-progress-view.tsx` 及 2 个测试，`useAppBootstrap` 失败时改从 `/api/health` 读 `startupError` 作详情，启动期只显示 `StartupSplash`，i18n 删 14 个 `migration.*` 键。
- ③ 迁移折叠：`server/sqlite/migrations.mjs` 由 18 条 875 行折叠为单条 `version=19 name='baseline'`（一次建 15 表 + 13 索引），兼容期对象（`*_v10_backup`、两个 mirror 队列、三个 `*_storage_state`、`scheduled_runs_state`、`session_index` 备份表）一个都不建；`inspectSqliteMigrationState` 对 `user_version<19` 的旧库直接报错并给恢复指引（备份数据目录 → 从导出恢复或空库启动），没有就地升级；新迁移仍 append-only，与 `schema_migrations` 行、`user_version` 同事务。
- 测试与文档：help 里的 schema helper 改为按最后一条迁移推导版本；`sqlite-storage-foundation` 删掉 v10/v11/v12 历史迁移回归、改成基线结构断言 + pre-baseline 拒绝用例；share/lan/scheduled 三域的 store/service/backup/export 测试改单路径；`session-state-full-chain-electron-smoke` fixture 去掉 cutover/downgrade 段，改成「运行期不写 JSON + 离线 export 逃生」；`scheduled-tasks.commands` 的 runs 读取改走 SQLite repository。文档侧 sqlite 基础层/session-storage-v2/wiki server 全面改写，三份 cutover 文档标 archived，CHANGELOG 增 Removed。
- 关键约束（别踩）：
  - `*-store.mjs` 里 `defaultLanAccessConfig` 已迁入 store；`readXxxStorageState()` 仍保留为常量诊断（`phase:'authoritative'` + 实时计数），因为 backup 信封与 CLI 还读它，这不是阶段机残留。
  - 空库首次启动必须走 `initializeLanAccessService()` 物化 disabled 配置行，否则 backup 导出的 LAN 完整性校验会失败（多个测试的 helper 已按此修正）。
  - 旧库只有「备份 + 导出/删库」两条路；不要再加 downgrade 工具，也不要把 baseline 版本号写回 1（会与已有 v19 库冲突）。
- 验证：分域定向 vitest 全绿（share 27 例、lan-access 20 例、scheduled-runs 58 例、schema 56 例）；`npm run test` 462 files 全绿；`npm run lint` 0 problems；`npx tsc -b` 0 错误；`npm run build` 成功（precompress 224 files）。未创建 Git commit，未手工改生成产物。

## goal-strip-drop-spinner（done，2026-10-30）

- Goal：用户提出「goal 在对话前面显示时原点已经有呼吸效果，是不是可以不要那个旋转状态了」。
- 结论：旋转弧确实是冗余信号。`spinning` 只在 `runtime` 为 executing/planning/verifying（legacy running/verifying/planning）时为真，而这三个 runtime 的状态词都收敛到 `goalStateRunning` → `data-state="running"`，该状态本就有 2s `quickforge-goal-breathe` 呼吸动画。条带上同时有旋转弧 + 呼吸点＝同一个「正在推进」画了两遍，还抢了唯一强调色状态词的注意力。
- 改动：`GoalControlStrip.tsx` 删 spinner 渲染（只留 `.quickforge-goal-strip-dot`）；`goal-control-strip.ts` 删视图字段 `spinning`、`isWorkingSpin()` 与 legacy/v2 两处赋值；`goal-workflow.css` 删 `.quickforge-goal-strip-spinner`、`@keyframes quickforge-goal-spin` 与 reduced-motion 中的 spinner 覆盖（呼吸点 reduced-motion 下仍关停）；`goal-card.test.ts` CSS 契约反转（不含 spinner / keyframes），`goal-control-strip.test.ts` 删「spins only while a step is actually being worked on」用例与分散断言；`docs/wiki/src/components/README.md` 同步。
- 边界：聊天内 goal 卡自身的 `spinning`（`src/lib/goal.ts#isGoalSpinning` 驱动状态图标旋转）不属于运行条，未改。
- 验证：定向 vitest 4 files / 120 passed；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰生成产物。

## message-log-realtime-consistency（done，2026-10-30）

- Goal：用户反馈「手机 Tailscale 访问显示的对话内容与 web 不一致（同一 session）」，明确目标是**双端实时一致**、按最优架构落地、不打补丁。
- 根因（六条，完整版见 `docs/architecture/message-log-consistency.zh-CN.md`）：
  1. 增量投递游标 `session.deliveredMessageCount` 是**会话级单值**：两个客户端共享同一投递位置，后加入者从别人的进度开始收增量 → 结构性漏消息。
  2. `stateVersion` 是每个 token 都 +1 的**事件计数器**，不是快照版本，不能回答「消息变没变」。
  3. SSE 无 `id:`/无重放，全局流连接时**零初始帧**：断线期间事件永久丢失，非流式期间丢了也发现不了。
  4. 只读视图只给尾部 200 条，补齐靠一次性 `hydrateFullHistory`：失败静默 + 期间有 SSE 帧就整段丢弃 + 调用方只调一次 → 手机拉 MB 级请求失败后永久停在 200 条。
  5. `mergeIncrementalMessages`（假设本地从服务端索引 0 开始）与 `mergeWindowedMessages`（唯一处理窗口偏移）双轨并存，三个 SSE 调用点走前者 → 窗口态必然错位。
  6. 8 处「整体替换」只换数组、不换偏移；`reset()` 也不重置偏移。
- 改动（架构级）：
  - 服务端新增 `server/message-log.mjs`：`logVersion`（只随消息变化递增，指纹 = 条数 + 尾消息身份）、`tailWindow`、`projectSessionSnapshot`（尾部窗口 + `messagesAfter` + `logVersion` + 绝对 seq 的 goal 标记）、`createConnectionProjector`（**每连接一份**投递游标；`messages_replaced` 或总数回退视为替换）。
  - 服务端新增 `server/event-log.mjs`：全局单调 `seq` + 轻量事件环（容量 1000，仅存定位字段，流式帧不入环），`since(lastSeq)` 返回 `{ frames, gap }`。
  - `agent-session-events.mjs`：`emitSessionEvent` 改为发**完整事件**（裁剪下沉到连接层），新增 `trackMessageLogVersion`（logVersion 守卫），删除 `deliveredMessageCount` 裁剪；`stripSplitSessionState` 改为 `projectSessionSnapshot` 的别名。
  - `routes/agent.mjs`：两个 SSE handler 各自建 `createConnectionProjector`；`writeSseEvent` 支持 `id:`；全局流解析 `Last-Event-ID`/`?lastEventId=` 重放，缺口发 `resync`；会话级流初始帧后 `projector.seed`；`/messages` 支持 `from`（`after` 同义）并返回 `logVersion/total`。
  - `routes/session-view.mjs`：`messagesAfter` + `logVersion` + `messagesSummary.logVersion`；`agent-session-queries.mjs`：`/state`、`/status` 带 `logVersion`。
  - 客户端新增 `src/lib/message-log.ts`：`applyMessageLogOp` 纯函数（`snapshot`/`append`/`replace`/`update`；空洞返回 `gap`，重复段返回 `noop`），`baseSeq` 是唯一坐标。
  - `ServerAgent`：`messageWindowOffset` → `messageBaseSeq`，新增 `messageLogVersion`/`messageOffset` getter/`applyLog`/`localMessageEndSeq`；state/agent_end/message_end/turn_end/messages_replaced/`/state` 刷新/补齐全部改走 `applyLog`；删除 `mergeIncrementalMessages`/`mergeWindowedMessages`；3 处「本地长度 == 服务端下标」判据改为绝对位置；四条构造路径统一 `applySnapshotCoordinates`；`reset()` 同时清坐标。
  - `ServerAgent.rollback`：本地数组下标 + `messageBaseSeq` 换算成绝对 seq 再发给服务端（窗口态回滚错轮次的修复）。
  - `applyGoalIterationMarkers`：marker 的绝对 `seq/index` 减去 `baseSeq`，窗口外丢弃。
  - 压缩分割线：新增 `shiftCompactionToLocal`，`ChatSurface` 用 `agent.messageOffset` 换算后再交给列表。
  - `hydrateFullHistory` 改为幂等 + 返回 `boolean`；新增 `ensureFullHistory()`（退避 `[0,1s,3s,8s,20s]`，dispose 可中断）；拉取期间有 SSE 落地时以服务端全量为基底、保留本地更新尾部（不再整段丢弃）；`ChatPanelHost` 改调 `ensureFullHistory`，并在 `visibilitychange` / `online` 时重新收敛。
  - `global-agent-sse-client`：注册并分发 `resync` 帧（全局帧，遍历所有活跃会话），`ServerAgent` 收到后 `syncState()`。
- 验证：`npx tsc -b` → 0 错误；`npm run lint` → 0 problems；定向测试 `tests/server/message-log.test.mjs`（19）、`tests/server/event-log.test.mjs`（6）、`tests/frontend/message-log.test.ts`（14）、`tests/frontend/server-agent-history-convergence.test.ts`（4）全过；`tests/frontend` 全量 271 files / 3266 passed；`npm run test` → 465 files / 5409 passed / 2 skipped；`npm run build` → 成功（`[precompress] 224 files: 12.67MB → 6.48MB`）。未创建 Git commit，未手工修改 `dist/`、`package-dist/`、`package-offline/`。
- 边界与遗留：
  - 事件环在进程内存：服务重启后首个客户端必然走 `resync`（一次全量 `/state` 校准），属预期。
  - 仍是单进程假设：跨实例实时一致需要外部 pub/sub，未做。
  - `tests/frontend/server-agent-message-window.test.ts` 随双轨合并函数一起删除，能力由 `tests/frontend/message-log.test.ts` 覆盖（窗口后追加、窗口内原位覆盖、丢弃前缀条目、整尾早于窗口）。
  - `tests/server/scheduled-tasks.commands.test.mjs` 仍为既有 flaky（单跑通过，与本次改动无关）。
  - 真机待验：手机 Tailscale 打开大会话后滚到顶能继续加载更早历史；断网 30s 再恢复，两端内容一致；同时打开两端流式期间不重复/不错位。

## ask-user-blocking-coordination（done，2026-10-30）

- Goal：用户要求按「架构最优」修掉 ask_user 弹窗与阻塞语义之间的缺口，保持现有交互与功能一致（允许重构）。
- 结论：`ask_user` 保持阻塞语义（execute 返回未 resolve 的 Promise，`runLoop` 停在 `executeToolCalls`，模型不会继续推理），本轮改的是它与**单槽 UI**、**steer 队列**之间的三处不一致：同会话并发提问改为串行排队、待答期间输入框文本改为直接作答、重启丢失语义写清。
- 根因（三条独立链）：
  1. 并发 ask_user 互相顶掉：`pendingAsks` 允许同会话多条、`getPendingAskForSession` 只回溯第一条、前端 `pendingAskRef` + 卡片都单槽 → 后一张顶掉前一张，先发出的那条只能干等 30 分钟超时；`ask_user` 又没标 `executionMode:'sequential'`（默认并行），一条 assistant message 里的两个 ask_user 会同时开始执行。
  2. 待答期间输入框文本静默入队：待答时 `state.isStreaming` 仍为 true，Enter 被消息队列的 capture keydown 收走 → `agent.steer`；而 steering 只在**轮边界**由 `getSteeringMessages` drain，被 ask_user 阻塞的这一轮永远走不到轮边界，用户那句话最长 30 分钟后才可能被模型看到。
  3. 重启语义不明：`pendingAsks` 是进程内 Map，服务重启后提问随进程消失（无幽灵卡片、也不会代答），但文档没写清。
- 改动（架构级，不是补丁）：
  - `server/ask-store.mjs`：新增 `enqueueAskForSession`（同会话串行链 + 深度计数；**首个提问同步激活**，保持原来「注册 + emit 与工具调用同步」的时序）、`ASK_QUEUE_MAX_WAITING = 3`、`clearAskQueues()`（测试缝）、`formatAskBusyResult()`；头注释改为当前事实源（Promise 编排在 orchestrator，store 只管队列与纯函数）。
  - `server/agent-approval-orchestrator.mjs`：`createAskUserPromise` = 归一 + 入队（队列满 → `details.skipReason:'busy'` 的文本结果，不注册、不 emit）；原实现整体下沉为 `activateAsk`，注册/`ask_user_required`/超时/abort/`ask_user_answered` 全部不变，**30 分钟计时从激活（变为可见）起算**，排队期间不计时。
  - `src/components/chat/panel-decoration/ask-user-card.ts`：`advance()` 返回 boolean；新增 `applyComposerText` 与 `WeakMap<HTMLElement, handler>` 登记，导出 `submitAskTextToPendingAsk(panel, text)`——问题步把文本写入该问的自由补充并前进（等价卡片内回车）；`allowCustom:false` 时按选项标签精确匹配（忽略大小写/首尾空白），匹配不上返回 false 交回原逻辑不吞字；回执步追加为卡片级补充信息。
  - `panel-decoration/message-queue.ts`：控制器新增 `isAskPending` / `submitAskText`，capture keydown 先走提问卡再入队；placeholder 待答时用 `askUserComposerPlaceholder`。
  - `panel-wiring/message-queue.ts`：透传两个新依赖；排队消息的「立即」按钮同样先走提问通道，避免同一条消息被 steer 静默挂住。
  - `ChatPanelHost.tsx`：`isAskPending` 取 `pendingAskRef` ?? `state.pendingAsk`（与卡片对账同源）；i18n 新增 `askUserComposerPlaceholder`（en/zh）。
- 测试：`agent-approval-orchestrator` 29 例（新增：第二条排队且前一条结算后才注册/emit、排队期间不计时 + 激活后满 30 分钟才超时、排队中 abort 直接 aborted、队列满返回 busy 且不注册、跨会话互不排队）；新增 `tests/frontend/ask-user-composer-routing.test.ts` 5 例（jsdom：自由补充并推进/选项精确匹配/不匹配交回/回执步进 remark/disabled 忽略）；`message-queue` 21 例（新增待答分流与 placeholder 源码契约）；`ask-user-card` 27 例（i18n 双语言列表加入新 key）。
- 验证：针对性 40 + 53 例全过；`npm run test` → 462 files / 5327 passed / 31 failed / 2 skipped（**31 例失败全部落在 3 个与本次无关的文件**：`tests/server/backup.test.mjs`、`tests/server/backup.authoritative-session.test.mjs`（LAN access state integrity）、`tests/server/scheduled-tasks.commands.test.mjs`，来自工作区里既有的 lan-access / scheduled-runs 未提交重构）；`npm run lint` → 0 errors（1 个既有 warning：`server/scheduled-task-runs-service.mjs` 未使用变量）；`npx tsc -b` → 0 错误；`npm run build` → 成功（`[precompress] 224 files: 12.66MB → 6.48MB`）。未创建 Git commit，未手工改生成产物。
- 范围/边界：阻塞语义、30 分钟超时、跳过/abort 文案、workflow 排除 `ask_user`、subagent 绑父会话 pending 通道均未变；未给 `ask_user` 加 `executionMode:'sequential'`（会连带把同批 `read_file` 等工具一起卡住 30 分钟，排队放在服务端更精准）。
- Notes（与本 feature 无关、未处理）：① 三条 backup / scheduled-task 测试失败属工作区既有未提交改动（lan-access cutover 删除、scheduled runs repository 改道），需另开会话收敛；② 首次跑 `npm run lint` 时出现过一次 `ENOENT: src/lib/migration-status.ts`（该文件在工作区已被删除），重跑即恢复正常，判断为当时并发跑测试造成的瞬态，非代码问题。

## subagent-mobile-horizontal-scrollbar（done，2026-10-30）

- Goal：用户反馈「subagent tools 在手机端访问显示有一个滑动的条」，确认是否异常并修掉。
- 根因（三者叠加，只有手机暴露）：
  1. subagent 摘要行必然横向溢出：`.quickforge-subagent-marquee{width:max-content;flex:0 0 auto}`（`process-timeline.css:24-37`）+ label 关掉省略号（`running-state.css:20-26`）。
  2. 兜底容器给了 `overflow-x:auto; touch-action:pan-x`（`tool-summary.css:98-105`），但隐藏滚动条只写了标准属性 `scrollbar-width:none`。
  3. `::-webkit-scrollbar` 隐藏规则只覆盖 `:has(.quickforge-command-summary)`（`tool-summary.css:107-109`），subagent 行漏写 → 忽略 `scrollbar-width` 的引擎（旧 Android WebView / Chromium <121、Safari <18.2）回落到 `foundation.css:49-66` 的全局 `*::-webkit-scrollbar{height:8px}` + `thumb=var(--border)`，行底出现常驻灰色横条并额外占 8px 高度（跑马灯定高 1.125rem 的度量前提被破坏）。桌面 Chromium/Safari 支持 `scrollbar-width` 所以看不到。
- 改动：`src/styles/chat/tool-summary.css` 把 `::-webkit-scrollbar` 隐藏组扩展到两条横向兜底行（`width:0;height:0;display:none`），并注明必须 unlayered（`[&::-webkit-scrollbar]:hidden` 在 `@layer utilities` 内会被全局 `*` 覆盖，参见 `inspector-tabs.css:1-20`）。
- 验证：`npm run lint` → 0 problems；`npm run build` → 成功（`[precompress] 224 files: 12.66MB → 6.48MB`）；产物 `dist/assets/index-BOaN4A3z.css` 已含新选择器。
- 范围/边界：保留 `overflow-x:auto` 的横向拖动能力（用户明确要可横向滚动）；iOS <18.2 的 overlay 瞬时滚动条由系统绘制，CSS 无法隐藏，如需彻底消除只能取消横向滚动容器（会与跑马灯契约冲突，需另行评估）。未改 TSX、未改生成产物。

## window-scroll-transaction（done，2026-10-29）

- Goal：用户反馈「优化后，从下往上翻页会回弹到底部，从上往下翻页会直接到最下面」。
- 根因（两条链，同一批状态漂移）：
  1. 向上回弹：`trimPagedWindow` 把「12 轮 / 160k 字符」当硬限，`loadMore` 从窗口**下方**逐轮裁。字符预算在长对话里必然超标，可能一路裁到只剩 1 轮，连视口所在行一起卸载；`loadMoreMessages` 的旧兜底 `(anchor.scrollTop ?? 0) + max(0, scrollHeight - heightBefore)` 在内容变矮时把增量钳成 0，等于写回旧 `scrollTop`，被浏览器 clamp 到新的 `maxScrollTop`（新窗口底部）。随后 scroll 事件命中 `distance < 10` 分支，被当成「用户回到底部」→ 重新 arm 跟随 → 下一帧 `scrollTop = scrollHeight`。
  2. 向下直达末尾：`distance < 10` 同一分支既 arm 跟随又 `onReachBottom`；`enableAutoScroll()` 无条件 `scheduleScrollToBottom()`，`setAutoScroll(true)` 又顺带 `loadNewer()`，而 `pageInFlight` 只在单次 Promise 内有效 → 「触底 → 贴底 → 再触底」逐页连播到 `endOrdinal === turnCount`，届时 `atTail` 变真，layout effect 再补一刀 `scrollTop = scrollHeight`。
- 改动（架构级，不是补丁）：
  - `windowed-messages.ts`：新增 `setViewport()` / `coversTail()` / `restoreEviction()`；`WINDOW_MAX_TURNS|CHARS` 降级为目标值，裁剪只允许发生在视口之外的整轮，视口占满预算时允许超限；字符统计改为按消息身份 `WeakMap` 缓存 + 逐轮累加（原来每次 drop 全量重扫），并记录逐出区间。
  - 新增 `scroll-owner.ts`：`scrollTop` 唯一写者。`anchor` 只按绝对 `data-message-index` 解析，行消失返回 `blocked`（不回退 ordinal、不写旧值）；`tail` 仅在 `coversTail()` 时生效；写入一律 clamp-aware，`clamped` 作为「裁多了」的信号。
  - `ChatSurface.tsx`：四条路径（loadMore / loadNewer / showMessageIndex / hydrate 锚点）统一 `runWindowTransaction`——上报视口 → 冻结（loadNewer 保持）跟随 → 捕获锚点 → 变更 → 在挂载新行的同一次 commit 里恢复（`clamped` 则 `restoreEviction()` 并重新发布）→ resolve；`publishWindow` 无变化时改 microtask flush；`setAutoScroll(true)` 只 arm 跟随；layout effect 贴底改走 owner。
  - `scroll-sync.ts`：降级为意图探测，`getFollowing()` 读 surface 的跟随标志（单一真相），`canFollowTail()` 决定触底是「恢复跟随」还是「只补下一页」，`scrollToBottom` 同样受 `canFollowTail()` 约束；`ChatPanelHost` 注入这两个回调。
- 测试：`windowed-messages` 新增 5 例（视口保护、只在视口下方逐出、`restoreEviction`、`coversTail`、disabled 覆盖尾部）→ 30 例；新增 `scroll-owner.test.ts` 7 例（含「锚点被逐出时一个字节都不写」回归）；`scroll-sync` 新增 2 例（窗口未到末尾时触底不 arm 跟随、到末尾才 arm）→ 21 例；`chat-surface-behavior-alignment` 的两处源码字符串断言改为行为断言（owner tail 意图 / blocked 语义）。
- 验证：`npm run test` → 462 files / 5372 passed / 2 skipped；`npm run lint` → 0；`npx tsc -b` → 0；`npm run build` → 成功。未创建 Git commit，未手工改生成产物。
- 遗留：浏览器实机的手感（连续上下翻页、流式中触底补页）未自动化覆盖，需人工确认；`turn-navigation` 与「回到底部」按钮的 `scrollTop` 写入仍各在自己的组件内（显式导航，不参与分页锚点事务），未纳入 `scroll-owner`。

## message-copy-window-index（done，2026-10-29）

- Goal：用户反馈「对话里用户消息的复制用不了了——复制到空/错的内容，所有用户消息都这样」。
- 根因：消息窗口化（4c4c0e1）后，装饰层把每行 index 算成**全对话绝对索引**（`index + messageIndexOffset`，`message-actions.ts:470`），而 `ChatPanelHost` 传进来的 `getMessages` 是 `getWindowMessages()` 的**窗口切片**（`ChatPanelHost.tsx:1193`，起点即 `messageIndexOffset`）。复制回调（`message-actions.ts:706` assistant / `:722` user）仍写 `getMessages()[entry.index]`：窗口起点 > 0 时绝对索引落在切片长度范围内，却指向窗口里的另一条消息 → 复制成别人的内容；命中的是 assistant / toolResult 时 `draftTextFromUserMessage` 返回 `''`，点击静默无任何反馈。同文件 173-183 行注释本就声明「copy 用全对话索引」，与实现自相矛盾；既有测试 `messageIndexOffset` 恒为 0，故未暴露。
- 改动：新增 `messageAtFullIndex(fullIndex)`（`fullIndex - messageIndexOffset` 再读切片，越界返回 `undefined`），两处复制回调改用它，并在取到空文本时回退渲染时快照 `text`；rollback / retry / fork 仍用绝对索引（服务端语义），不动。
- 测试：`tests/frontend/message-actions.test.ts` 新增 1 例「窗口起点 2 + 窗口内含不渲染的 toolResult」——用户行、助手行复制各自拿到自己那行的文本；临时把修复退回（`localIndex = fullIndex`）时该例失败并复现「复制成另一条消息」，确认用例能拦住回归。
- 验证：`npx vitest run message-actions inline-message-editor` → 2 files / 53 passed；`npm run test` → 455 files / 5325 passed / 2 skipped；`npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功。未创建 Git commit，未手工改生成产物。
- 范围：只改复制取值这一处 + 1 例测试；未动窗口化控制器、装饰短路 key、回滚/重试链路。

## composer-pasted-text-attachment-remove（done，2026-10-29）

- Goal：用户反馈「对话框粘贴附件无法删除」。
- 根因：`decorateComposerTextAttachmentTile`（`src/components/chat/panel-decoration/editor-bindings.ts`）给粘贴文本附件 tile 挂的「在系统文件管理器中打开」点击劫持用的是**捕获阶段** + `stopPropagation()`。tile 在 React 事件根之下，事件被拦在捕获阶段后既不会到达 `.qf-attachment-tile-remove` 按钮 target，也不会冒泡回根节点，`onDelete` 永远不会执行；同一路径还会把点击转成「打开文件管理器」，体感就是点 × 没反应。图片/文件选择走 `MessageEditor.addFiles`，没有这层劫持，因此不受影响。
- 改动：捕获监听在 `stopPropagation()` 之前加一层放行——`(event.target as Element).closest('.qf-attachment-tile-remove')` 命中即 return；tile 主体点击仍打开系统文件管理器。
- 测试：`tests/frontend/editor-bindings.test.ts` 的 `FakeTile` 改为记录 click handler，新增 1 例断言「删除按钮的点击不被 stopPropagation、不触发打开文件管理器；tile 主体点击仍然如此」。
- 验证：定向 vitest 5 files / 89 passed；`npx eslint` 两文件 0 problems；`npx tsc -b` 通过。
- 范围：只改这一个 capture 监听；未动 composer store/draft/AttachmentTile 的删除逻辑；未触碰生成产物；纯前端交互修复，无 API/模块职责变化，wiki 无需更新。

## release-2-3-5（done，2026-10-29）

- 触发：「发布一个小版本」。
- 结论（一句话）：把 v2.3.4 之后 dev 上的 7 个提交以 **2.3.5** 发布——版本递增、CHANGELOG/README 更新、test/lint/build 硬门禁通过、runtime/offline 包与 tarball 生成、release commit + tag `v2.3.5` 推送 `origin/dev`；`npm publish` 按 runbook 留给用户手动执行。
- 发布内容概要：
  1. Dreaming 记忆沉淀（`~/.quickforge/DREAMING.md` 单一 bullet 列表、每日定时、运行历史与 line diff、快照回滚、`recall_experience`、设置页概览/笔记/设置三段）。
  2. Dreaming 冷笔记阈值进「高级配置」+ 到期自动删除（`pruneStaleNotes` / `pruneMinNotes` / `pruneUnusedDays` / `pruneMaxRecalls`，`operations.pruned`）。
  3. 插件 UI 扩展（plugin API v2 `contributes.ui`、13 种白名单节点 DSL、slot/action/KV/audit、iframe 沙箱面板与 assets 路由 CSP、`plugin-creator` skill、`hello-ui` 示例）。
  4. 消息渲染窗口化默认开启 + 双向分页（窗口只增不减）。
  5. 每次压缩一条留痕线（`contextCompaction.history[]`、`occurredAtIndex` 锚定、窗口外双向钳制）。
  6. 回滚改为就地编辑并直接重发；回滚拒绝路径清零（索引 clamp + 轮锚定）。
  7. 本地工具卡 header + panel 两层，停止按钮紧跟摘要；设置导航 shadcn 重排；自动压缩非结构性门槛移除。
- 改动文件：`package.json`、`package-lock.json`、`CHANGELOG.md`、`README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：
  - `npm run test` → 455 files / 5323 passed / 2 skipped（串行复跑，退出码 0）。首次与 lint 并行跑出现 1 例时序抖动（vitest 只报计数、未打印到 tail 段），串行复跑全绿，按既有 flaky 处理。
  - `npm run lint` → `eslint .` 无输出（0 problems）。
  - `npm run build` → 成功（`✓ built in 6.37s`，仅既有 >500kB chunk 提示）。
  - `node scripts/prepare-runtime-package.cjs` → `package-dist/`（package.json 版本 2.3.5）。
  - `node scripts/prepare-offline-package.cjs` → `package-offline/`（package.json 版本 2.3.5）。
  - `cd package-offline && npm pack` → `shawnstack-quickforge-2.3.5.tgz`（7.9 MB packed / 24.0 MB unpacked / 578 files、shasum `df210d9b…`）。
- Notes：
  - `[Unreleased]` 里原有的 5 条 Composer 任务清单改动在 2.3.4 之前就已写入但未转正，本次一并并入 2.3.5 的 Changed。
  - 未推送 `master`（本地 master 仍停在 `9ded6c0 chore(release): v2.0.0`），与 2.3.4 的发布方式一致，只推 `origin/dev` 与 tag。
  - 未执行 `npm publish`；离线包与 tarball 均在 `.gitignore` 覆盖的生成目录内，不进入提交。

## dreaming-prune-settings-and-auto-delete（done，2026-10-29）

- 反馈：「`NOTE_PRUNE_MIN_NOTES=40 / NOTE_UNUSED_DAYS=60` 希望可以在梦境的高级配置里面设置，然后增加到期自动删除的功能」。
- 需求确认（用户选择）：判定口径 = 召回次数 ≤ M 次 + 存在 ≥ N 天；自动删除发生在**模型重写之前**；**不设任何保护**（无单轮条数上限、无 kind 白名单），满足条件就删。
- 设置层（`server/dreaming/settings.mjs`）：
  1. `DEFAULT_DREAMING_SETTINGS` 新增 `pruneMinNotes: 40` / `pruneUnusedDays: 60` / `pruneMaxRecalls: 0` / `pruneStaleNotes: false`。
  2. 新增本地 `clampNumber`（与 `goal-settings.mjs` 同形，取整 + 上下界），范围 1–500 / 1–3650 / 0–1000。非法值回默认而不是回边界值——打错字不能变成「删掉所有超过 1 天的笔记」。
  3. `pruneStaleNotes` 只认 `=== true`，与 `enabled` 同风格；默认关闭，因为写进 `DREAMING.md` 的删除不可逆。
- 运行层（`server/dreaming/runner.mjs`）：
  1. 删除 `NOTE_PRUNE_MIN_NOTES` / `NOTE_UNUSED_DAYS` 常量（源码零残留，`grep` 确认）。
  2. 新增并导出纯函数 `selectStaleNotes({ notes, stats, minAgeDays, maxRecalls, now })`：`recallCount ≤ maxRecalls` 且 `now - createdAt ≥ minAgeDays` → 选中；**没有 stat 行的手写笔记永远不选中**（年龄未知，按猜测删比留着更坏）。
  3. 开关开启时先算 stale → 先 `writeDreamingNotes(composeAutoSection(remaining))` 再 `syncNoteStats(remaining)`，然后才调模型；写盘失败则回滚为「什么都没删」，把 `notesForModel` 保持为原列表，并把错误挂到 `pruneWarning`。
  4. 统计不再包在「候选段」分支里：`listNoteStats()` 一次读取两处共用，读失败只 warn（降级为「没有冷笔记」）。
  5. 开关开启后不再生成 `## Never recalled` 候选段（已删过，重复语义）；关闭时保留原门槛，但阈值改读设置。
  6. 漂移告警的基准改为 `notesForModel`（模型真正看到的列表），避免「先删 20 条」把 churn 比推到 100% 误报。
  7. 记录口径：`operations.pruned`（被规则删掉的原文）、`retiredCount = removed + pruned`、summary 追加「，其中到期自动删除 N 条」；`模型回复里没有任何笔记条目` 的失败分支也标注本轮已先删 N 条（文件已改写，要让人知道）。
- 仓储（`server/sqlite/dreaming-repository.mjs`）：`toRun()` 的 operations 白名单补 `pruned`（不补会被静默丢弃，这是本轮实测踩到的——测试拿到的是 `undefined`）。
- 前端：
  1. `dreaming-data.ts` 的 `DreamingSettings` 补四个字段，`DreamingRunDiff` 补 `pruned?: string[]`。
  2. `DreamingSettingsTab.tsx` 设置卡内新增「高级配置」折叠区（inline 展开按钮，不另起卡片），依次是开关 + 冷笔记天数 / 召回次数上限 / 候选列表启用条数。数字输入抽成本地 `NumberField`：草稿态 + 失焦/Enter/步进提交 + 与服务端同范围 clamp；外部值变化用「渲染期调整 state」而不是 effect（`react-hooks/set-state-in-effect` 不允许 effect 里同步 setState）。
  3. 运行详情新增 `DiffList` 分组「到期自动删除」，每行备注「由到期规则在模型运行前删除，不是模型的判断」；`hasChanges` 一并计入。
  4. i18n 新增 11 个 key（en/zh 成对）：`dreamingAdvanced`、四个 `dreamingPrune*` 及其 `Info`、`dreamingRunPruned`、`dreamingRunPrunedNote`。
  5. `dreaming.css` 新增 `.quickforge-dreaming-advanced-toggle`（语义 token + 复用 `.quickforge-dreaming-chevron` 的旋转，含 reduced-motion 分支）。
- 测试：`dreaming-memory` 加 3 例（默认值 / clamp 与非法值回默认 / 布尔只认字面 true）；`dreaming-runner` 加 5 例（模型前删除 + 空列表 + 两次写盘 / 召回次数超限保留 / 无 stat 的手写笔记不删 / 可配天数双向验证 / 关闭时用可配候选门槛）；`routes/dreaming` 加 1 例 PUT 往返与 clamp；`tests/frontend/dreaming-prune-settings.test.ts` 新增 4 例源码契约（en/zh 成对、字段名与 patch 对齐、折叠区、run diff 分组）。`routes/dreaming{-detail}` 三处 operations 精确断言补 `pruned: []`；`tests/server/dreaming.test.mjs` 的 `finishRun` 整对象断言（最初漏改，被全量测试抓出）同步补 `pruned: []`。
- 文档：`docs/architecture/dreaming-memory.zh-CN.md` 的 5.4 反馈闭环（两种模式 + 年龄语义）、§6 API、§7 设置 JSON 与 clamp 说明、§8 前端、§9 质量信号行、§10 已知取舍全部改写；`docs/wiki/server/README.md` 的反馈闭环条目同步。
- 验证：见下方 Notes（全量结果在本次会话末尾补入）。
- Notes：
  - **自动删除与「信息而不是规则」冲突，是本轮用户明确裁定的取舍**：默认仍关闭（保持原设计取向），开启后模型没有否决权。恢复路径只剩「更早一次 run 的 `notesAfter` 快照」——被删条目不在本轮 `notesAfter` 里，`POST /runs/:id/restore` 恢复的是删除之后的状态。
  - `created_at` 是 Dreaming 首次见到该措辞的时间，不是笔记真实年龄：老版本升级后第一轮会给现存笔记写入「今天」的 stat，所以 60 天后才会成批到期。
  - 界面与前几轮一致：`enabled: false` 时高级配置只读（与执行时间/敏感内容同规则），要先开启 Dreaming 才能调。

## rollback-orphan-assistant-turn（done，2026-10-29）

- 反馈：「对话回滚的时候报错：没有可回滚的对话轮次。应该不用这么限制，可能中间有报错的对话，所以去掉这个限制」；放宽孤立 assistant 后用户真机仍报错，二次反馈「就不应该有这个限制」。
- 根因：回滚按钮挂在 user 行并传全量 index，但 `performRollback` 读取的是 `agentRef.current.state.messages`（权威数组）；UI 窗口数组（`getWindowMessages()`，可含 append-only extras）与权威数组瞬时错位（压缩替换、乐观尾插、会话切换等）时，index 落在 toolResult 或越界 → 返回 -1 → 弹「没有可回滚的对话轮次」。
- 最终方案（回滚永远可用，拒绝路径清零）：
  1. `rollbackStartIndexFromMessage`（前端 `message-utils.ts` + 服务端 `agent-manager.mjs` 同构）：索引 clamp 到 `[0, length-1]`；user → 自身；其他角色（assistant/toolResult/孤立轮）→ 向前找本轮 user，找不到以自身截断；仅空会话或非有限数返回 -1（无操作）。
  2. 服务端 `rollbackSessionMessages`：删除 400 "There is no conversation turn to roll back." 分支，-1 clamp 为 0（空会话幂等无操作）。
  3. 前端 `performRollback`（`useChatActions.ts`）与 `SharedConversationPage.tsx` 两处：去掉「没有可回滚」弹窗，-1 静默返回；`rollbackMessage` 可为 undefined 时草稿回填空串。
  4. i18n：删除 `noConversationTurnToRollback`（en/zh）死 key。
- 验证：`npx vitest run`（message-utils / rollback-start-index / exports-contract / rollback-compaction / share-store.rollback-atomic / chat-surface-render）6 files / 50 tests 全过；i18n 快照 2 files / 15 tests 全过；`npx tsc -b` 0 错误；eslint 改动文件 0 problems；`npm run build` 成功。未创建 Git commit，未触碰生成产物。
- Notes：历史第一轮只放宽了「assistant 无前置 user」一种形态，未覆盖 index 错位 / toolResult / 越界，本轮已全部收敛为 clamp + 统一轮锚定。`tests/server/share-store.rollback-atomic.test.mjs` 内嵌旧实现副本用于 mock share-store 原子性路径，不校验锚点语义，未改动。

## dreaming-run-detail-shadcn-ui（done，2026-10-28）

- 反馈：「优化一下梦境记忆的详情 UI，参考 shadcn ui」。
- 改动（只动前端，无 API/数据变更）：
  1. `DreamingSettingsTab.tsx` 的 `RunDetail` 从「一张卡平铺」重构为 shadcn 卡片结构：页头（`dreamingRunBack` 返回按钮带 ArrowLeft 图标 + 标题 + 时间/字符 meta + 右侧状态/触发/模型/语言徽标）→ 统计瓦片条 → 正文（错误告警 / 结论 / 变更 diff / 原始响应折叠）→ 页脚（恢复按钮 + 提示）。统计瓦片与总览卡共用新抽取的 `StatStrip`；tone 只作用于数值（`+2/-1/✕1` 复用 metrics 语义色配方），丢弃为 0 时不占格。
  2. 新增 `DiffList`：`+/−/✕` 行 diff，tone 落在标记与分组标题、正文保持 foreground；`dropped` 的 `reason` 从「内容（原因）」拼接串拆成独立 muted 小字。无变更时显示 `dreamingRunNoOperations` 空态。
  3. 详情此前根本不显示 `run.summary`——补「结论」段（复用 `dreamingRunSummary`）。
  4. 修死类名：`<pre className="quickforge-dreaming-raw">` 在 CSS 里不存在（原始响应一直无样式），改用 `.quickforge-dreaming-code`（等宽/滚动/22rem 限高），`SectionToggle` 接入 `description`（`dreamingRunRawResponseDescription`）并给展开区补 `px-5` 对齐；`.quickforge-dreaming-code` 自身删掉旧的 1.25rem 侧边距。
  5. `run.error` 在详情里升级为浅色 destructive 告警条（AlertTriangle 图标 + `role="alert"`，7% 背景 + 24% 边框，符合「危险克制但真失败可用」）；列表行内的 error 仍是原纯文本样式。
  6. i18n 零新增：全部复用既有 key（含此前未消费的 `dreamingRunBack` / `dreamingRunSummary` / `dreamingRunNoOperations`）。
  7. `dreaming.css` 新增 `.quickforge-dreaming-alert`（+`-text`）与 `.quickforge-dreaming-diff*` 六个类、`stat[data-tone]` 三个着色规则；全部留在 settings 域，无跨模块 selector。
- 静态预览：`docs/design/dreaming-run-detail.html`（token/组件样式同源拷贝，深浅色切换，成功/失败两变体）。
- 验证：`npx tsc -b` 0 错误；`npx eslint src/components/dreaming/DreamingSettingsTab.tsx` 0 problems；`npx vitest run tests/frontend` 全量 267 files / 3220 passed；`npm run build` 成功。未创建 Git commit，未触碰 `dist/`（build 产物）等生成目录。
- Notes：`quickforge-recall-list`（chat 域）在 Dreaming 笔记页签仍被复用，本次未动；若以后要按域收紧 CSS 归属，需先把 settings 对它的消费迁到本域类。

## compaction-remove-skip-gates（done，2026-10-28）

- 反馈：「源 <1600 字符 / 距上次 <30s / 10 分钟内拒绝过——这些奇怪的约束都应该去掉，上下文不够就该压缩」。
- 改动：
  1. 删除 `AUTO_COMPACT_MIN_INTERVAL_MS`（30s 间隔）与 `AUTO_COMPACT_REJECTION_SUPPRESS_MS`（拒绝后 10 分钟抑制）常量及全部检查；`shouldSuppressAfterRejection` / `markAutoCompactRejected` / `clearAutoCompactRejected` 一并删除，`declined` 决定只跳过当前这一次尝试。
  2. `minSourceChars` 从前后端 `DEFAULT_AUTO_COMPACT_SETTINGS` / `normalizeAutoCompactSettings` 及 `compactSessionInPlace` 参数中删除；自动路径的前置只剩结构性检查：可压缩消息 ≥2 条、自上次压缩后有新消息。旧存储里的 `minSourceChars` 由 normalizer 丢弃。
  3. `lastAutoCompactRejected` 不再写入；`resetSessionCompaction` / agent 初始化保留置空，兼容旧持久化数据。
  4. 防空转的结构性护栏保留：`not_enough_new_messages`（滚动压缩没有新增量就不压，天然截断「摘要压摘要」循环）与 `sourceMessages.length < 2`；`manual_compact` 继续向 `compactConversation` 传 `minSourceChars: 0`，conversation-compaction 内部 `MIN_SUMMARY_SOURCE_CHARS` 结构性下限不动。
- 代价（用户知情）：开着确认时，拒绝后下一次过阈值请求会重新弹决策行；极小会话也可能触发一次摘要调用。
- 验证：`npx tsc -b` 0 错误；`npx eslint 改动文件` 0 problems；`npx vitest run` 压缩+设置相关 8 个测试文件 84 例全过。未创建 Git commit。
- 评审追补（同日）：`compactConversation` 的自动路径没显式传 `minSourceChars`，继承 `conversation-compaction.mjs:8` 默认的 1600 地板（`compactRange < 4 且 transcript < 1600` 时 `not_enough_history` 静默跳过），与移除意图相悖；改为自动/手动统一传 `minSourceChars: 0`，`MIN_SUMMARY_SOURCE_CHARS` 常量保留但压缩入口已无实际作用面。另修正 `agent-approval-orchestrator.mjs:206` 注释仍写「suppress for 10 minutes」的陈旧表述。验证：5 个压缩测试文件 57 例全过、`npx eslint` 两文件 0 problems。
- 二次追补（同日，用户裁定限制代码本身也删）：`MIN_SUMMARY_SOURCE_CHARS` 常量、`compactConversation` 的 `minSourceChars` 参数与归一化、`compactRange < 4 && transcript < N` 字符门槛全部删除；跳过条件只剩结构性的 `compactRange.length === 0`。调用方不再传 `minSourceChars`（`auto-compaction.mjs`、`agent-compaction.mjs` /summary 路径——后者此前一直在吃 1600 默认地板，短会话 `/summary` 会静默不压，现在只要有可压缩消息就压）。测试删除 6 处 `minSourceChars: 0` 传参并改名短历史用例；`git grep` 确认源码零残留（前端 normalizer 对旧存储值的丢弃测试保留）。验证：5 个压缩测试文件 57 例全过、`feature_list.json` JSON parse 通过、eslint 0 problems。

## compaction-timeline-history（done，2026-10-28）

- 反馈：「每次压缩都要有线出现，压缩的时机点显示要准确，一定是真实时序来的」+「第一次压缩后，第二次压缩会把第一次压缩后面的内容再压缩」。
- 现状诊断（三条根因）：
  1. `session.contextCompaction` 是**单值**（`auto-compaction.mjs:355` 直接赋值），SQLite 无 compaction 表、会话事件不落库 → 历次压缩的切点/摘要/用量不可还原，界面永远只有一条线，第 2 次压缩是把第 1 条线**挪走**而不是新增。
  2. 线的位置用的是 `compactedUpToIndex`（= `tailStart`，摘要覆盖范围的右边界），而「压缩发生时刻」是压缩那一刻的 `messages.length`。保留最近 n 轮时两者差若干条消息，用户读到的是「压缩发生在上一轮回答之后」，实际发生在这一轮的中间。
  3. 定位靠数组下标，而压缩在 `transformContext` 里跑的是 `state.messages.slice()` 副本；尾部截断、整体替换、前端乐观尾插都会让下标失真，`compactedUpToIndex > windowEnd` 时旧实现直接 **hidden** → 「这次压缩没有线」。
- 方案（用户选 A：每次压缩都留一条线，旧线原地不动）：
  1. `compactSessionInPlace()` 追加 `contextCompaction.history[]`，每条 `{ compactedAt, occurredAtIndex, boundaryIndex, summaryMessage, keepRecentTurns, sourceMessageCount, usageBefore, thresholdPercent }`，上限 `MAX_CONTEXT_COMPACTION_HISTORY = 20`（超出丢最旧）；顶层字段保持「最新一次」语义不变。`body_json` 存完整对象，**没有表结构迁移**。
  2. 前端 `resolveCompactionMarkers()` 按 history 每条生成一条线，锚定 `occurredAtIndex`；`boundaryIndex` 只作为范围信息留着，不再决定线的位置。
  3. 窗口外**双向钳制**而不是隐藏：低于窗口 → 钳到首行，高于窗口 → 钳到末行；同渲染位置只保留最新一条（窗口化上翻时不会在顶部堆一摞同样的线）。
  4. 非最新条目 pill 追加 i18n `contextCompactedMergedLabel`（已并入后续摘要），`compactedAt` 写进 tooltip 与 `data-compacted-at`。
  5. `MessageList` 由单 `compactionBoundary` 扩展为 `compactionMarkers[]`（旧 prop 保留给单记录 payload 与既有测试），每条线独立 `<details>` 状态。
- 顺带修掉的两个既有缺陷：
  - `session-state-service.applyMetadataToState()` 曾用扁平 metadata（无 `summaryMessage`）覆盖 `state.contextCompaction` → 改标题/置顶这类元数据写入会把摘要降级为空、history 整个丢掉。现在按字段合并，保留 body 侧富字段。
  - 分享页 `sanitizeContextCompaction()` 原来只清洗顶层 `summaryMessage`，history 里每条摘要会带着 `contextReferences` 泄漏 → 现在逐条 `sanitizeMessage`；`sanitizeEvent` 的触发条件也从「有 summaryMessage」改为「有 contextCompaction」。
- 没动的：`buildCompactionSourceMessages()` 的滚动压缩语义（旧摘要 + 上次切点之后的增量）、`compactedUpToIndex` 的裁剪口径、`resolveCompactionBoundary()` 的既有契约（含过期即 hidden）都没改。
- 验证：`npx tsc -b` 0 错误；`npx eslint 改动文件` 0 problems；`npm run lint` 0 problems；`npm run build` 成功；`npm run test` → 450 files / 5268 passed / 2 skipped；唯一失败 `tests/server/scheduled-tasks.commands.test.mjs` 是既有 flaky（该文件未被本改动触碰，失败点在 goal run 计数断言，同一文件单跑时通时不通——三次运行分别是全量挂、单跑过、单跑挂）。未创建 Git commit。
- 追加修复（同日）：`resolveAutoCompactTailStart()` 原来在切点落到 index 0 时回退到 `tailStartForRecentTurns(source, configured)`，而该回退目标在单用户回合会话里同样是 0 → 自动压缩永远 `not_enough_history`。现在改为逐级降级保留回合（n → n-1 → … → 1），仍留不出可压缩段时**压缩全部历史**。单用户回合的 agentic 会话不再出现「上下文涨到 provider 报错但从不压缩」，也不会再出现「一条线都没有」。
- 有意保留的限制：`minSourceChars`（1600 字符）、30 秒最小间隔、拒绝后抑制都原样保留——它们防的是「没内容可压」「抖动式反复压缩」「用户刚拒绝又弹」，不是「凑不齐保留回合就放弃」那类会导致静默失效的限制。（同日晚些时候用户裁定这三条也属「静默不压」应全部移除，见上文 compaction-remove-skip-gates。）

## chat-message-windowing（done，2026-10-28）

- 反馈：「当前是全量加载对话显示，希望做到窗口化，每次只加载 10 条这种渲染页面，这样多了界面不会卡顿」。
- 范围取舍（用户确认）：**只改渲染层**，服务端仍全量取数（`agent.state.messages` 恒为全量、`/restore` 仍一次拉完）；粒度**按轮 3 轮/窗**，复用现有实现而不新增「条数」维度。
- 现状盘点：`windowed-messages.ts` 能力完整（按轮切片、`loadMore` 纯本地扩窗、`showMessageIndex` 移窗、pinned 保位、toolResult 补齐），14 条单测覆盖；但 `ChatSurface` 自 `32be493` 起用 `createMessageWindow({ enabled: false })` 全量渲染，唯一理由是轮次导航要直接滚到已存在的 DOM 节点。装饰层 `messageIndexOffset` 数学、`data-message-index` / `data-window-start` 契约早已按窗口化接线，`enabled:false` 时 offset 恒 0。
- 改动：
  1. `ChatSurface.tsx` 构造点改回 `createMessageWindow()`（默认启用）。短会话仍全量：控制器自己的 `WINDOW_ENABLE_TURNS`(6) / `WINDOW_ENABLE_MESSAGES`(48) / `WINDOW_ENABLE_CONTENT_CHARS`(8 万) 门槛原样保留。
  2. 新增**填满视口兜底** layout effect：窗口内容高度不超过视口时容器没有滚动范围，宿主的 `onReachTop`（挂在 scroll/wheel 上）永远不会触发——触摸端连 `scroll` 都不会发，历史就彻底不可达。现在尾部跟随状态下继续 `loadMore()` 直到填满或到达首轮，`pageInFlight` 在下一个 window commit 回调里释放；隐藏视图（`isInsideHiddenView`，布局盒为 0）与 `clientHeight <= 0` 直接跳过，避免无限扩窗。
  3. 轮次导航不需要改：`turn-navigation.ts` 已经是「先 `showMessageIndex` 移窗 → 等 React 布局提交 → rAF 里按绝对 `data-message-index` 测量」。
  4. 测试护栏换向：`chat-surface-behavior-alignment.test.ts` 原来断言源码含 `createMessageWindow({ enabled: false })`，改为断言默认构造 + 不含 `enabled: false`，并新增一条锁住 `showMessageIndex(...).then(finish, ...)` 这条「先移窗再测量」的契约。
  5. 注释/文档同步：`message-actions.ts` 的 `messageIndexOffset` 说明从「offset 恒为 0，将来重开窗口化时才用得上」改为窗口化下的实际语义（含 extras 只追加在尾部、前 `end-start` 项保持全量下标这一前提）；`docs/wiki/src/components/README.md` 目录条目与「对话消息渲染」条目由「窗口化默认关闭」改为默认开启；`docs/architecture/session-open-fast-path.zh-CN.md` 的「仍未改动」段落补落地说明。
- 没动的：`windowed-messages.ts` 一行未改（默认值本来就是 3 轮/窗）；`chat-surface-render.test.ts` 的 `data-window-start="0"` 断言天然仍成立（该用例只有 1 轮，不触发窗口化）。
- 验证：`npm run test` → 452 files / 5290 passed / 2 skipped，1 failed = `tests/frontend/chat-surface-css-contract.test.ts`（他人未提交的 `src/styles/chat/process.css` 改动所致，与本次无关）；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`。
- 反馈跟进：「为什么从下往上翻会回弹到最下面」。根因是控制器把窗口**滑动**而不是**扩展**：`rebuild` 用 `[startOrdinal, startOrdinal + activeWindowTurns)` 切片，`loadMore` 只减小 `startOrdinal`，于是整窗内容被换成更早的一页——用户正在读的那一行随之离开 DOM，`resolveAnchorRow` 必然失败，`anchoredScrollTop` 返回 `null`，`loadMoreMessages` 的兜底把 `scrollTop` 设成 `scrollHeight - clientHeight`（对话末尾）。修了三处：
  1. **`endOrdinal` 变成控制器状态**（`windowed-messages.ts`）：`loadMore` 只前移起点、终点不动，窗口 3 轮 → 6 轮 → 9 轮……已渲染行全部留在 DOM，锚点能解析，滚动位置精确复原。补回归测试 `widens the window on loadMore instead of sliding it forward`。
  2. **`isAtTail()`**：扩展后 `atTail`（最新轮是否在窗口内）仍为 true，`resumeTail` 原来靠它早退，导致翻页后永远不重新切回尾部；改问 `isAtTail()`（`startOrdinal >= tailOrdinal`）。补两条测试覆盖「含最新轮但不是尾部窗口」与 disabled 恒 true。
  3. **`loadMoreMessages` 兜底**：不再贴 `scrollHeight - clientHeight`，改为「按上方新增高度补偿」；锚点行没存活时也不会把人扔到对话末尾。
  另外 `fillInFlight` 与 `pageInFlight` 拆成两个标志，避免填满视口的扩窗和触顶分页互相提前解锁。
- 反馈跟进二：「从上往下也是有问题的一下到底了」。根因是 `resumeTail` **主动缩窗**：`scroll-sync` 在「距底 80px 内向下滚动」时每帧调 `setPanelAutoScroll(true)` → `resumeTail` → un-pin + 重新切片，已扩展的 9 轮窗口被缩回 3 轮，脚下内容被换成尾部，看起来就是「一滚就到底」。改为**窗口只增不减**：
  1. `setFullMessages(messages, followTail)`：`followTail` = `autoScrollRef`。读者跟随尾部时 `endOrdinal` 跟到 `turnCount`（右扩，新消息可见、不卸载任何行）；读者停在历史时冻结（既不重渲染大窗口，也不换掉脚下内容）。
  2. `endPinned` 只给 `showMessageIndex` 跳转用（固定宽窗口，避免「跳到第 3 轮却挂载到第 50 轮」）；`loadMore` 显式 `endPinned = false`。
  3. `resumeTail` 不再缩窗，只清 pinned + 把右边界追到尾部（`isAtTail()` 早退避免无谓重建）。
  4. `rebuild()` 在起点与行序列都没变时复用原数组引用，避免整窗重渲染 + 装饰 pass。
  5. `scroll-sync.ts` 向下滚动 re-arm 分支补 `!autoScrollEnabled` 过渡判断，不再每帧调宿主 setter。
  窗口真正收缩只发生在会话切换（控制器重建），这是有意的取舍：宁可多留已加载历史，也不让滚动中的内容消失。
- 反馈跟进三：「从第一条往下滚动鼠标滚轮会直接到最后，没有中间的对话」。根因是窗口化只有**向上**翻页：轮次导航跳到早期轮后窗口是固定宽 `[start, start+3)`，向下滚到底时 `setAutoScroll(true)` 走 `resumeTail` 把右边界拉到 `turnCount`，中间的轮次从未挂载，所以一滚就到底。补上向下翻页：`windowed-messages.ts` 加 `hasMoreNewer()` / `loadNewer()`（内容追加在视口下方，无需锚点，读者位置不动）；`scroll-sync.ts` 加 `onReachBottom`（触底 scroll 事件 + 内容不足一屏时的向下 wheel）；`ChatPanelHost` 转给 surface 的 `loadNewerMessages()`；`setAutoScroll(true)` 只补一页而不是拉满；`setFullMessages` 的右边界改为只有「原本就在末尾（`wasAtEnd`）且读者在跟随」时才跟到 `turnCount`，跳转后的早期窗口不会被拖到末尾。`endPinned` 状态随之删除（`wasAtEnd` 覆盖了它的场景）。补三条回归测试（前向分页、到末尾停止、早期窗口不被拖到尾部）。
- Notes（与本次改动无关，未扩大范围）：全量测试 452 files 里有 1 个失败 —— `tests/frontend/chat-surface-css-contract.test.ts` 断言 `.quickforge-process-stage-body` 的缩进规则，而工作区 `src/styles/chat/process.css` 有他人未提交的改动（新增 `.qf-hl-*` 高亮规则等）。本次只改 `windowed-messages.ts` / `ChatSurface.tsx` / `scroll-sync.ts` / `ChatPanelHost.tsx` 与对应测试，未触碰 `src/styles/`。
- 风险与后续：数据层仍全量持有，长会话内存占用不变；若之后要做「连取数也分页」，需要让 `agent.state.messages` 只保留窗口、并统一 `reconcileMessagesFromSummary` / `mergeWindowedMessages` 的 offset 语义——那是独立立项级别的改动。真机需要过的点：长会话上翻触顶加载是否稳定、轮次导航点远端轮次是否一次到位、移动端手指上滚能否触发加载。

## plugin-ui-extension（done，2026-10-28）

- 反馈：「插件可以修改当前界面的功能、可以结合 UI」+「设计完整方案，goal 模式执行，同时内置一个插件创建的 skill」。
- 设计结论（详见 `docs/architecture/plugin-ui-extension.zh-CN.md`）：
  - **插件只能插入界面、不能改写界面**。`contributes.ui.overrides` / CSS 注入 / 选择器 patch 一律不做，否则设计语言每次调整都会破坏第三方插件。
  - 三档：L1 受限节点 DSL（默认路径，无代码执行）→ L2 `iframe sandbox="allow-scripts"`（不加 `allow-same-origin`，靠 opaque origin 隔离）→ L3 既有 `registerToolRenderer`（只给内置插件）。
  - 明确不动态加载宿主 React：双 React 会炸 hooks、Tailwind 4 类是编译期生成的、Vite 产物 hash 不稳定、还要兼容 Capacitor。
  - 行为类诉求归 `contributes.hooks`（服务端），界面归 slot，职责分离。
  - 进程隔离（`utilityProcess` + Node `--permission`）推迟：现在插件来源等同用户自己放置的代码，威胁模型与 Koishi / Obsidian 一致。
- 落地：
  1. `manifest.mjs`：`PLUGIN_API_VERSION` 2 + 支持列表 `[1,2]`（v1 零改动），`contributes.ui` 归一化 + 不含绝对路径的 `uiDigest`。
  2. 新增 `plugins/ui-schema.mjs`：13 种白名单 type、剥离 `style`/`className`/`html`、限额（20 顶层 / 200 总数 / 深度 6 / 8 slot / 64KB / payload 8KB）、`$slot`·`$state` 引用。**未知 type 丢弃而不是抛错**，结构性超限才整块失败。
  3. 新增 `plugins/audit.mjs`：`plugin-audit` root-array store（300 条）。
  4. `registry.mjs`：`getUiSnapshot()`（静态节点 + 可选 `getSlots` 覆盖；**只缓存 `getSlots` 产出的节点**，2s TTL，`refreshPlugins` 与成功的 `dispatchUiAction` 都会失效缓存，元信息与 KV 状态每次现算）、`dispatchUiAction()`（action 白名单 400 → 声明 slot → `ui:*` 权限 403 → 并发 4 返回 429 → 返回节点二次校验失败则丢弃）、`getPluginKv/setPluginKv`（64KB / 单值 8KB，存 `plugins.json` 的 `kv` 段，**不新增文件也不迁移**）。UI hook 的超时**在 `loader.mjs` 的调用边界上**包：`handle` 5s → 504、`getSlots` 2s → 回退静态节点；registry 只判「允不允许」，不重复计时。
  5. `routes/plugins.mjs`：`GET /api/plugins/ui`、`POST /api/plugins/:name/ui`（app client 鉴权）、`GET|PUT /api/plugins/:name/kv`、`GET /api/plugins/audit`、`GET /api/plugins/:name/assets/*`（仅声明 panels、仅插件目录内、仅白名单扩展名）。
  6. 前端 `plugin-ui-types/client/resolve/bridge` 四件套 + `PluginSlot`（白名单渲染、未知 type 返回 null、`ErrorBoundary`、空贡献不渲染外壳）+ `PluginFrame`（iframe + postMessage bridge，`event.source` 校验，放行 kv/notify/callTool）+ `PluginUiToasts`。插件页展示每个插件的 slots / actions 数 / 可点开的面板 / 声明的 `ui:*` 权限。挂载点：`ConversationHeader` → `session.header`、`ChatSurface` 的 `leadingControls` → `composer.actions`、`SidebarFooter` → `sidebar.footer`、`App` → toast。沙箱属性（有 `allow-scripts`、无 `allow-same-origin`/`allow-top-navigation`/`allow-popups`、`no-referrer`、`src` 指向 assets 路由）由 `tests/frontend/plugin-frame.test.ts` 锁死——这是整个 L2 的安全要点，不能只靠代码评审。插件页还会显示 normaliser 产出的 warnings（例如 `style`/`className` 被剥离、未知节点类型被丢弃），否则插件作者只会看到“样式没生效”却查不到原因。
  7. 内置技能 `skills/plugin-creator/`（SKILL.md + manifest/ui-slots/examples 三份参考 + `scaffold-plugin.mjs` / `validate-plugin.mjs`），加入 `defaultGlobalSkillNames`。
  8. 示例插件 `plugins/hello-ui/`（默认禁用）：L1 按钮 + 可打开的沙箱面板。`tests/server/plugins/hello-ui-example.test.mjs` 守护它——用真实 normalizer 校验 manifest、断言 slot/action/panel 与权限声明自洽、panel 入口文件存在且扩展名可服务，并禁止面板里出现 `fetch('/api...')` 与 `localStorage`（opaque origin 下必然静默失效的写法）。
- 落地时发现并修掉的真实缺陷：
  1. **registry 只在 `tools.length > 0` 时实例化插件** → 纯 UI 插件被静默跳过。改为「有工具或 UI」即实例化。
  2. **`getSlots` 不能填充未声明的 slot** —— 这是权限映射成立的前提（`ui:*` 从声明 slot 派生），已在文档写明，不做放宽。
  3. **L2 bridge 的 `callTool` 收窄成两级门禁**：只接受本插件自有工具（`plugin__<plugin>__<tool>`），再转发到 `POST /api/tools/:name`，复用既有的 `assertAccessModeAllowsDirectTool`（默认权限模式下直接执行插件工具 403）。面板不比它所在的 UI 更有权限，也不会让 iframe 去触发 agent 审批链路；`callTool` 用服务端 2 分钟预算，其余方法 5 秒。
  4. `PluginListItem` 不能引入 hooks：`tests/frontend/plugins-page.test.ts` 直接调用组件函数取元素树。面板开关状态上提到 `PluginsPage`。
  5. **`refreshPluginUi()` 没有调用方**（本轮回查发现）：启用/禁用插件、点「重新加载插件」后，服务端 catalog 已更新，但前端 slot 快照是冷加载时的那份，界面上已渲染的按钮会一直停在那里直到整页刷新。已在 `PluginsPage` 的 reload 与 toggle 两处接上，并补三条测试：刷新是**整份替换**（移除的 slot 要消失）、单个插件的 `slots` 覆盖不能动邻居、返回空节点等于把该插件从 slot 摘掉。顺带把 toast 的 `window.setTimeout` 换成 `globalThis.setTimeout`——SSR/测试里没有 `window`，原来会抛错并被当成 action 失败。
- 验证：`npx tsc -b` 0 错误；`npm run lint` 0 problems；`npm run build` 成功（`✓ built in 4.46s`）；本 feature 定向 11 files / 121 tests 全过；`npm run test` → **453 files / 5297 passed / 2 skipped，退出码 0（无排除）**。
- Notes：
  - **改了别人家的一条断言，为的是让第 13 项可达成**：`tests/frontend/chat-surface-css-contract.test.ts` 的 `process fold hierarchy contract` 原来断言 `.quickforge-process-stage-body` 的**精确刻度**（`padding-left: 0.75rem`），而该刻度正被另一个会话按用户反馈微调成 `margin-left: 0.5rem` + `padding-left: 0.625rem`。现在改为语义断言：连接线必须是 `1px solid color-mix(in oklab, var(--border) 60%, transparent)`、横向缩进必须存在且非零。这样视觉微调不再误报，但「线被删掉 / 缩进归零」仍会被抓到；同一用例里「顶层 body 不缩进、线不落到叶子节点」三条断言原样保留。**产品 CSS 一行未改**。
  - 全量与 `npm run build` 并行、或别的会话在跑重活时，会出现 1~7 个时序用例抖动（`agent-goal-*` / `scheduled-tasks.commands` / `auto-compaction*` / `windowed-messages`），单跑必过（如 `scheduled-tasks.commands` 单跑 24/24），属存量 flaky；跑全量时不要与其他重活并行。
  - 测试文件名与最初描述有一处差异：`tests/frontend/plugin-slot.test.ts` 而非 `.tsx`。项目 `vitest.config.ts` 只收集 `tests/**/*.test.{mjs,ts}`，该测试用 `createElement` 不写 JSX，改扩展名没有收益。
  - 文档与实现的偏差已就地修正：设计文档原先写「`uiDigest` 不一致时要求重新确认（前端弹授权）」，实际只做 digest 可观测；已改为如实描述，自动确认留到有第三方分发渠道时再做。安全表里「permissions 首次渲染前要求确认」改为「插件页展示 + dispatch 时强制 403」。
  - `ui-schema.mjs` 与 `PluginSlot.tsx` 在编辑过程中被工具重复追加过代码，已截断修复并复跑测试确认；后续改这两个文件建议整体重写而不是局部替换。
  - **共享文件并发写入事故**：`progress.md` / `session-handoff.md` / `feature_list.json` 在同期被多会话反复覆盖（含一次非 UTF-8 写入把换行压平成单行、`feature_list.json` 回滚掉约 10 条未提交条目）。已重编码为合法 UTF-8 并重建本 feature 的段落/条目；权威验证明细另记在 `docs/architecture/plugin-ui-extension.zh-CN.md` §15.1，因为那份文件只由本会话维护。
  - 仍未做：`contributes.hooks`（下一个最划算的扩展点，`hook-engine` 已有事件模型）、`contributes.mcpServers` / `agents`、权限授权弹窗、`settings.tabs` slot、marketplace 安装器。
  - P0 自查（2026-10-29 复核，针对已实现代码）：无 P0。落地两个 P2 加固：① `GET /api/plugins/:name/assets/*` 对 `text/html` 响应补 `Content-Security-Policy: sandbox allow-scripts` + `x-content-type-options: nosniff`（防插件 HTML 被顶层窗口打开时获得宿主同源权限），定向 10 files / 112 tests 复跑全过；② 文档 §6.3 改为如实描述鉴权基线——GET 只读端点（`/api/plugins/ui`、`/api/plugins/audit`、assets）与仓库既有风格一致不单独鉴权，POST/PUT/KV 写走 `assertAppClient`。已知存量面（非本 feature 引入）：本机模式下 `/api` POST 端点对「本机恶意网页的 no-preflight `text/plain` POST」无 Origin 校验（`isAuthenticatedAppClient` 只看源 IP），建议以后独立 feature 在 `server/index.mjs` 统一做 Origin/Host 校验。

## dreaming-beta-badge-and-review-fixes（done，2026-10-28）

- 反馈：「加一个 beta 的表示 在设置里面给这个功能 然后再评审一下」。
- Beta 标识：
  - `settings-tabs.ts` 的 dreaming 项加 `beta: true`（在 map 里统一归一成 boolean）。
  - 设置侧栏（桌面 + 移动）、tab 头部、页内标题三处渲染 `quickforge-settings-beta` 徽章；页内另挂 `InfoTip(dreamingBetaInfo)`，**不用 `title`**——移动端 hover 不可见。
  - 样式落在 `src/styles/settings/dreaming.css`，只用语义 token（`--border` / `--muted-foreground`）。
- 二轮评审发现并修掉的三处偏差：
  1. **冷笔记筛选会在短列表上失控**。笔记本来就全量注入系统提示，`recall_experience` 很少被调用，所以「从没被召回」几乎是每条笔记的常态。原实现 30 天 + 无条数门槛 = 每隔一段时间把整份列表当作删除候选塞给模型。改为 **≥ 40 条才启用** + 阈值提到 **60 天**，并补「短列表不提议删除」的测试。
  2. **统计失败被误报成写盘失败**。`syncNoteStats()` 原来和 `writeDreamingNotes()` 在同一个 `try` 里，统计抛错会写进 run 的 `error`，让人以为笔记没保存。拆成独立 `catch`，只 warn。
  3. **删除末页唯一一条后停在空页**。`removeNote` 改为按剩余条数重算目标页（`min(当前页, ceil((total-1)/pageSize))`）。
- 验证：`npm run test` → 445 files / 5205 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 评审仍不同意的一个点：`noteIdOf` 是文本哈希，**模型改写措辞 = 计数归零**。这是「笔记没有身份」的直接后果，属于有意接受；如果之后发现好笔记因为改写被当成冷的，正确做法是提高门槛，而不是给笔记加 id（那会把文件变成需要同步的结构）。
  - 删除仍无二次确认（项目风格），也没有 undo；误删的恢复路径是「回滚到该条存在时的某次 run」。

## dreaming-recall-feedback-and-note-delete（done，2026-10-28）

- 反馈：「反馈闭环（召回计数/强度衰减）需要做 还有为什么没有删除功能」。
- 删除功能为什么之前没有：设计上笔记归模型所有，只支持「下一轮重写」和「run 回滚」两种整体操作，刻意没做单条编辑。现在补上。
- 做了什么：
  1. **迁移 v18** `dreaming_note_stats`（6 列：`note_id`(=noteIdOf(text)) / `note_text` / `recall_count` / `last_recalled_at` / `created_at` / `updated_at`）。没有 FTS、没有向量、没有评分字段。
  2. **计数**：`recall_experience` 真正返回某条笔记时 `recordNoteRecall()` +1 并记时间；工具在无 SQLite 的环境静默跳过，不影响调用。
  3. **衰减的形态**：`listNoteStats()` 找出「存在 ≥ 30 天且从未被召回」的笔记，作为 `## Never recalled (deletion candidates)` 段交给模型。系统提示明确写：进入这个列表是因为没人搜过它、不是因为它错了；只有本轮也证明失效或只是重复时才删，便宜留着但丢了很贵的东西（安全红线、发布门禁、危险命令警告）不要删。
     - 这是有意的取舍：**信息而不是规则**。旧实现的 `strength` 衰减会自动淘汰，那会把「少用但关键」的规则删掉。
  4. **对齐**：每轮写回后 `syncNoteStats()` —— 新笔记载入（记 `created_at`）、消失的笔记删行；同一措辞以后重新加回来从 0 开始，不继承旧计数。文件清空时整表清空。
  5. **删除单条**：`DELETE /api/dreaming/notes/:id` 直接改 `DREAMING.md` 并删统计。因为文件是唯一真相，下一轮 dreaming 看到的已经是删过的列表，不可能复活。id 不存在返回 404。
  6. 前端笔记行显示「被召回 N 次 / 从未被召回」+ 删除按钮；notes 接口返回 `recallCount` / `lastRecalledAt`。
- 验证：`npm run test` → 445 files / 5204 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。测试覆盖：计数累加与时间戳、sync 增删行、清空、单条删除、DELETE 路由（成功 / 404）、notes 返回 recallCount、冷笔记进 prompt 段、统计随文件对齐。
- Notes：
  - 召回计数只统计 `recall_experience` 的显式命中。笔记本来就已经全量注入系统提示，所以「没被召回」不等于「没用过」——这也是为什么冷笔记只是候选，不做自动淘汰。
  - 删除了 `recall.mjs` 的 `noteIdOf` 定义，改到 `notes.mjs`（repository 与 routes 都要用它算 id，放在纯函数模块里避免把 global-memory 拉进 SQLite 层）；`recall.mjs` 保留 re-export。

## dreaming-notes-hardening（done，2026-10-28）

- 背景：对照 Claude Dreaming 的机制做了一次评审，找出 4 个偏离和 4 个实现缺陷。用户要求「都实现，但不要过度设计」。
- 全部落在**不加表、不加迁移、不加依赖**的前提下：

| 问题 | 补法 | 量级 |
|---|---|---|
| 截断方向与 prompt 契约不一致 | prompt 要求「从最重要到最不重要排序，尾部会被丢弃」 | 1 行 |
| 冲突无裁决规则 | prompt 加「最新证据优先；跨会话重复只在新说法是一笔带过时才压过它」 | 1 行 |
| 死代码：`dreaming:auto` 行过滤 | 删掉 | 2 行 |
| 无漂移防护 | `added+removed` ≥ 改前/改后较大者的 80%，且改前 ≥ 5 条 → run 仍成功但 `error` 写「可能发生了记忆漂移」 | 10 行 |
| 无来源追溯 | `operations.notesAfter` 存完整快照；`GET /api/dreaming/notes` 扫最近 50 个 run 反推每条 `firstSeen` | 25 行 |
| 无回滚 | `POST /api/dreaming/runs/:id/restore` 写回快照，无快照 409 | 18 行 |
| 会话采样无优先级 | `correctionSignals()`：用户纠正词 / assistant error+aborted 计数，预算不够时先留这些会话 | 30 行 |
| 死代码：`summarizeMemory` | 删掉 | 4 行 |

- 取舍说明：
  - 漂移告警**不阻断**——笔记是模型的判断，代码只让它显形（run 页可见 + error 文案）。
  - 来源只到 **run 粒度**，不让模型写 `evidence`（会吃掉 300 字符预算）。快照本身就是证据。
  - 回滚拒绝旧 run（没有 `notesAfter` 时 409），而不是用半个 diff 猜一个列表。
  - 采集加权会让候选会话的尾部消息被**全部读出**（最多 40 个），牺牲一点后台耗时换取「不再先丢纠正会话」。
- 验证：`npm run test` → 445 files / 5194 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。测试覆盖：排序/冲突规则写进 prompt 的断言、churn 告警（大列表触发 / 短列表不触发）、`notesAfter` 快照、restore 成功 + 无快照 409、`firstSeen` 有来源/无来源、纠正会话优先入窗口。
- Notes：
  - 仍然没有反馈闭环（召回计数/强度衰减）。这是有意保留的唯一缺口：没有「这条笔记真被用过」的证据，靠人看改动率告警兜底。
  - 前端「恢复到此版本」按钮不做二次确认——与项目其他动作用同一风格；如果后续觉得危险，可加一个 inline 确认而不是弹窗。

## dreaming-notes-file（done，2026-10-28）

- 反馈：记忆「拆分成两份应该只是共同注入到提示词而已」，dreaming 只写它自己那份。
- 结论：`~/.quickforge/MEMORY.md`（人写）与 `~/.quickforge/DREAMING.md`（dreaming 写）彻底分成两个文件，互不读写；注入时各占一个 xml 段。
- 拆掉的东西：
  1. `MEMORY.md` 里的 `<!-- dreaming:auto:begin/end -->` 标记段机制整段移除。
  2. `global-memory.mjs` 删除 `DREAMING_SECTION_BEGIN/END`、`splitMemorySections()`、`composeMemoryDocument()`、`writeDreamingMemorySection()`、`saveManualSection()`。
  3. 由此消失的一整类问题：保存 MEMORY.md 时要先读盘重拼自动区、编辑器可能冲掉机器块、要判断"有没有自动区"、要按 16KB 总预算给自动段留额度。
- 新增：
  - `DREAMING_NOTES_FILE_NAME = 'DREAMING.md'`、`dreamingNotesFilePath()`、`readDreamingNotes()`、`writeDreamingNotes()`（原子写 + 8KB 上限 + 敏感内容校验 + 内容相同则 `changed: false`）、`readDreamingNotesPrompt()`。
  - `readGlobalMemoryDocument()` 返回 `{ markdown, dreaming, path, dreamingPath }`，两份文档一次取回。
  - 系统提示新增 `<dreaming_memory source="~/.quickforge/DREAMING.md">`，与 `<global_user_memory>` 并列——分段是为了让模型区分"用户告诉我的"和"过去会话总结出来的"。
- 连带：`PUT /api/memory` 与 `manage_global_memory` 直接写 `MEMORY.md`（不再有 merge 步骤）；`/api/memory` 多返回 `dreaming`；`/api/dreaming/notes` 的 `hasAutoSection` 改名 `hasNotes`；overview 的 `memoryDocument` 改为 `{ dreamingNotes, manual }`；`counts.active/retired/superseded` → `counts.notes/runs`；前端记忆页只编辑 MEMORY.md，并在 DREAMING.md 有内容时提示"它的笔记在另一个文件"。
- 验证：`npm run test` → 445 files / 5186 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。`tests/server/dreaming-memory.test.mjs` 重写为「两个文件互不影响」的 11 例（写 DREAMING.md 不动 MEMORY.md、第二次整份覆盖、空内容清空、内容相同不写盘、敏感拒绝、8KB 上限、两份文档同时返回、独立注入块、保存 MEMORY.md 不碰 DREAMING.md、落盘互不包含）。
- Notes：
  - 项目级记忆没有由 dreaming 实现（用户明确：项目那份是手工维护的，dreaming 只写全局）。若以后要加，最省的形式是复用同一套 notes 解析，只是多一个文件路径，不要回到带 scope 字段的表。
  - 迁移 v17 已经把 `memories` 系列表删掉，本次改动纯文件层，没有新迁移。
  - 全量跑第一次时 `tests/server/scheduled-tasks.commands.test.mjs` 有一条时序用例偶发失败（`/plan inspect the release`）；单跑该文件 24 passed，复跑全量 445 files / 5186 passed，判定为 flaky，与本次改动无关，未修改。

## dreaming-notes-only（done，2026-10-28）

- 反馈：上一轮的语义召回那套「太重了」，参照 Claude Dreaming 的机制做**最简单可用**的版本。用户选 A：记忆整层退化，旧记忆直接丢弃。
- 结论：记忆 = `MEMORY.md` 自动区里的一份 bullet 列表；每轮 dreaming 读「当前列表 + 窗口内会话」，**一次**模型调用拿回「新的完整列表」，代码只校验格式/大小/敏感内容后整段覆盖。没有第二份存储，就没有同步问题。
- 删掉的东西（这是重点，不是新增）：
  1. 表：`memories`、`memories_fts`、`memory_events`、`memory_embeddings` —— migration v17 `drop_structured_memory_store` 直接 DROP，旧数据不迁移。
  2. 模块：`apply.mjs`（JSON 操作清单 + 逐条硬校验）、`vector.mjs`、`embedding.mjs`。
  3. 机制：fingerprint 去重、confidence/strength、30 天半衰淘汰、`memory_events` 逐条审计、FTS5 bm25、向量余弦 + RRF、embedding 模型设置项、向量覆盖率 UI、`POST /embeddings/backfill`、记忆行 retire、`<experience_memory>` 注入段。
  4. 代码量：`dreaming-repository.mjs` 399 → 137 行，`recall.mjs` 215 → 56 行，`prompt.mjs` 122 → 100 行，`DreamingSettingsTab.tsx` 848 → 530 行，`dreaming.test.mjs` 382 → 215 行。
- 新增：`server/dreaming/notes.mjs`（`parseNoteLines` / `normalizeNoteLines` / `composeAutoSection` / `diffNoteLines`）。
  - 笔记契约：一行一条 `- `，可选 `[fact|preference|experience|pitfall|decision]` 前缀，单行 ≤ 300 字符、≤ 60 条、整段 ≤ 3800 字节，超限从尾部截断并计入 `dropped`。
  - **掉线保护**：回复非空但一条 bullet 都抽不出（模型跑题说散文）→ run 标 `failed` 且**不写盘**；真正空回复是合法的「今天没有值得记的」，会把段落清空。
- `recall_experience`：读自动区做子串过滤（多词要求每词命中），`kind` 只匹配 `[kind]` 前缀；工具 schema 删掉 `scope`，description 改成「笔记已在你 system prompt 里，这里只是显式过滤」。
- 运行记录保留：`dreaming_runs` 仍在，`operations_json` 改存 `{added, removed, dropped}` 行 diff（旧数组形状在 `toRun` 里归一为空 diff），详情页直接显示「本次新增/移除/丢弃了哪些行」+ 模型原始回复。
- 验证：`npm run test` → 445 files / 5185 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。新增 `tests/server/dreaming-notes.test.mjs`（12 例：解析/代码围栏/标记保护/去重/截断/敏感过滤/空散文/组装上限/diff），runner 测试重写为「写回列表 + 两次运行的 added/removed + 散文保护 + 空回复清空」。
- Notes：
  - 语义召回能力随表一起消失。真要换述召回，下一步是「LLM 查询改写 + 让模型从候选里挑」，而不是把向量库加回来 —— 笔记只有几十条，全量注入本来就没有召回不准的空间。
  - `scheduled-task-runs-repository.test.mjs` 里回退到 v2 的 DROP 列表仍列着已删表，`IF EXISTS` 下无害，未清理。
  - i18n 里 `dreamingMemoryConfidence/Strength/Evidence/Retire/…` 等旧 key 仍留着（`MemorySettingsTab` 可能复用），只删了确认无引用的 `recallExperienceSessions/UpdatedToday/UpdatedDays`。
  - 未做：笔记行的编辑入口（现在只能靠下一轮运行或手工改 MEMORY.md 人工区）；如需手工增删单条，应加「编辑自动区」的危险操作而不是恢复表结构。

## dreaming-semantic-recall（done，2026-10-28）

- 反馈：向量/语义召回缺失，「感觉语义召回不是很好」。先确认事实——原先全链路只有 FTS5 trigram bm25 + `strength × 时间半衰 × confidence` 排序，中文短查询退化成 `LIKE '%…%'`，多字查询被包成整串短语，任何换述都召回不到；`progress.md:338` 早就写着「没有真正的语义相似度」。
- 方案（用户选 A）：**不内嵌模型、不用向量库**。embedding 复用用户已有的 OpenAI 兼容 `/embeddings`（Ollama / LM Studio / llama.cpp / vLLM，项目 provider 类型本来就含这四家），向量存 `memory_embeddings` 的 Float32 BLOB，Node 内暴力余弦。零新增 npm 依赖；未引入 `sqlite-vec`（要开 `allowExtension` + 随包分发 `.dll/.so` + Node 22.19/Electron 双端未验证，三条风险换不到收益）。
- 改动：
  1. 迁移 v16 `memory_embeddings`（`model / dim / content_hash / vector` + `length(vector) = dim * 4` CHECK + FK `ON DELETE CASCADE`）。
  2. 新 `server/dreaming/vector.mjs`（Float32 编解码、余弦、RRF）与 `server/dreaming/embedding.mjs`（端点候选 `base/v1/embeddings → base/embeddings → base/api/embed`，仅 404/405 换路；兼容 `data[].embedding`、`embeddings:[[]]`、`embedding:[]` 三种响应；幂等批量回填）。
  3. `recall.mjs` 新增 `recallExperiencesHybrid()`：query 向量 → 余弦（下限 0.2）→ 与 bm25 做 RRF(k=60) 融合；`recallExperiences()` 保持同步语义不变，作为降级路径。
  4. `updateMemory()` 主动删除旧向量（否则内容改了仍按旧语义排序）；`runner.mjs` 在 apply 之后、finishRun 之前回填，失败只 `warn` 并并入 run 的 `error` 字段。
  5. 设置：`dreaming-settings.embeddingModelRef`、设置页「语义召回模型 + 向量索引覆盖 + 生成向量」、`POST /api/dreaming/embeddings/backfill`、overview 的 `embedding{model,configured,resolved,embedded,total,pending}`。
  6. `server/tools/index.mjs` 的 `recall_experience` 改走 hybrid。
- 验证：`npm run test` → 445 files / 5203 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。新增 `tests/server/dreaming-embedding.test.mjs`（16 例：编解码、余弦、RRF、端点候选与回落、响应形状、幂等回填、换模型重算、改内容失效、scope 过滤、换述召回、端点失败降级、无向量降级、余弦下限）。未提交 Git。
- Notes：
  - 修了一个连带失败：`tests/server/scheduled-task-runs-repository.test.mjs` 回退到 v2 时按表名逐个 DROP，漏了新模式下的 `memory_embeddings`，导致重跑迁移撞「table already exists」——已在 DROP 列表补上。
  - 本机探测 11434/1234/8000 全部 `ECONNREFUSED`，没有本地推理服务在跑，所以端到端只有 mock 级证据。真机需要先 `ollama serve` + `ollama pull bge-m3`，把 `http://127.0.0.1:11434/v1` 作为 provider、`bge-m3` 作为 model 加进自定义 provider，再在 Dreaming 设置里选中它。
  - 语义路径刻意「只增不减」：`recallExperiencesHybrid` 在无模型 / 端点不可达 / 无向量三种情况都 `catch` 后回到纯 bm25，因此升级不会让召回变差。
  - 未做：写入侧去重仍只靠 `fingerprint` 哈希 + LLM 快照，没有用向量先筛近似重复；本轮按用户选择只改召回。

## dreaming-always-scheduled（done，2026-10-28）

- 反馈：“定时处理”这个开关可以不要，默认开了就是定时处理。
- 改法：彻底移除 `scheduleEnabled`（DEFAULT、normalize、类型、UI、路由、测试共 0 残留）。语义改为 **开启即定时**：每天 `executeTime` 自跑一次，「立即处理」只是手动提前触发。
- 连带：
  1. `tick()` 只看 `enabled`；`PUT /api/dreaming/settings` 在 enabled 时必定算 `nextRunAt`，关闭时清空。
  2. 执行时间字段现在带 ⓘ 说明（`dreamingExecuteTimeHint`），顶替被删的开关描述；旧文案 `dreamingSchedule/Description` 删除。
  3. 旧配置文件里的 `scheduleEnabled: false` 会被 normalize 直接丢弃 → 行为变成“开启即定时”，与预期一致。
- 验证：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交。


## dreaming-memory-ownership（done，2026-10-28）

- 三个问题一起修：
  1. **不显示**：从 stats 条里拿掉「MEMORY.md 自动段落」（它只是一个事实陈述，不该占位）；stats 改为「下次运行 / 上次运行 / 生效条目 / 已淘汰」，CSS 改成 `repeat(auto-fit, minmax(8rem, 1fr))`，不再写死 4 列。
  2. **不可编辑**：以前记忆页 textarea 显示整份 MEMORY.md，保存会连同自动段一起写回（可能改掉或删标记）。现在 `readGlobalMemoryDocument()` 额外返回 `manual/auto/hasAutoSection`，前端只编辑 `manual`；`PUT /api/memory` 与 agent 的 `manage_global_memory` 都走新增的 `saveManualSection()`，它从磁盘重拼当前自动段，因此人工路径无法覆盖它。记忆页在有自动段时显示一行说明。
  3. **Bug：淘汰不同步**：`POST /api/dreaming/memories/:id/retire` 以前只改 DB 行，MEMORY.md 里那一条要等下次定时运行才消失。现在淘汰后立即 `writeDreamingMemorySection(renderAutoSection(...))`，并在响应里返回 `memoryFileSynced`；写失败只记 warning，不阻断淘汰。
- 测试：新增 3 例 `saveManualSection` 行为（暴露 manual/auto、保存不动自动段、无自动段时不新增），retire 路由测试补同步断言；测试里 `vi.mock` 掉 global-memory 的写盘，避免再次污染真实 `~/.quickforge/MEMORY.md`。
- 验证：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交。


## dreaming-auto-section-copy（done，2026-10-28）

- 用户问：“MEMORY.md 自动段落 · 已开启 这是啥”。
- 实际含义：该项表示 `~/.quickforge/MEMORY.md` 里是否已存在 Dreaming 维护的标记段（`<!-- dreaming:auto:begin/end -->`）。用户机器上为有（2493 字符）。
- 问题在文案：value 复用了开关语义的 `dreamingStateOn`（“已开启”），会让人以为是另一个开关。改为「已写入 / 尚未写入」，并在标签旁加 ⓘ 说明（写在哪个文件、只改标记之间、手工内容不动）。
- 实现：i18n 新增 `dreamingAutoSectionWritten/NotWritten/Hint`；stats 项支持可选 `hint` 并渲染 InfoTip。
- 验证：`npm run test` → 444 files / 5182 passed；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交。


## dreaming-model-row-removed（done，2026-10-28）

- 反馈：主卡 stats 里的“模型 HAPI/deepseek-v4-flash · 已指定”与下方模型下拉重复，可以去掉。
- 改法：stats 第 4 项换成「自动记忆段」开/关（原本只在旧 meta 行里出现过）；模型不另占一行，而是把当前生效模型写进下拉首项——“跟随对话模型 · HAPI/deepseek-v4-flash”，选“跟随”时不再看不见实际模型。
- 连带清理：删除只服务于那行的 `MODEL_SOURCE_KEY`/`modelSourceKey` 与本地 `effectiveModel`（tsc 报 unused）；运行详情页的 `modelLabel` 保留（那是单次运行的真实记录）。
- 验证：`npm run test` → 444 files / 5182 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。未提交（等用户确认）。


## dreaming-model-label-dedupe（done，2026-10-28）

- 现象：梦境页模型下拉里供应商名字重复，如 “GLM-4.6V (智谱) (智谱)”。
- 根因：自定义模型在 providers.json 里的 `name` 本身常写成 “GLM-4.6V (智谱)”，前端又无条件拼 `${name} (${provider})`。
- 修法：新增 `formatModelOptionLabel(name, provider)`（dreaming-data.ts）——provider 已出现在 name 里（忽略大小写）则不追加；空值单边兵底。同时过滤掉 `ref` 为 null 的模型（其 select value 会是空串，与“跟随对话模型”撞键）。
- 验证：新增 `tests/frontend/dreaming-model-label.test.ts`（4 例）；`npm run test` → 444 files / 5182 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## workflow-error-collapse（done，2026-10-28）

- 现象：`run_workflow` 失败时错误原文（服务端不截断，多段 + 「已完成步骤」清单）直接铺满聊天消息流 / 详情页，阶段与步骤被挤出可视区。
- 修法（一律「先给结论、按需展开」）：
  1. Inspector 详情 `run.error` 抽成 `WorkflowErrorBanner`：**折叠态只渲染一个错误图标**（`AlertTriangle` 图标按钮，点击就地展开原文，`aria-expanded` + `workflowErrorExpand`/`Collapse` 作 `aria-label`/`title`），展开后 `max-height: 40vh` 内部滚动，并显示「定位失败步骤」；不按长度分叉，短错误同样折叠、原文只在展开后进 DOM。
  2. `PhaseLogs` 不再「阶段有 error 级日志就默认展开」——日志一律默认收起，error 只在头部保留 `-logs-flag` 标记点（原行为会让一屏全是日志）。
  3. 聊天区无 details 的失败帧（审批拒绝、参数校验失败、worker 启动失败）抽出 `WorkflowFallbackError`，套用同一 icon-only 折叠规则。
  4. i18n 新增 `workflowErrorExpand` / `workflowErrorCollapse`（中英成对，现作用为展开/收起按钮的无障碍文案）；样式改动落在 `workflow-detail.css` 与 `goal-workflow.css`，没有新增样式文件或依赖。
- 中途调整（同日，用户反馈「只要有错误 icon 就好了，点击再展开」）：第一版是「原文 clamp 两行 + 展开详情文字按钮 + 140 字符阈值」，按要求改为 icon-only，并删除 `isWorkflowErrorCollapsible` / `WORKFLOW_ERROR_COLLAPSE_THRESHOLD`（已无消费方），少一层长度判断。
- 测试：`workflow-renderer.test.ts` 新增「失败帧折叠为 icon-only（短/长错误都折叠、原文不进 DOM、aria 文案与 40vh 样式）」「详情页错误折叠 + 日志默认收起」断言；同步修正三条原先依赖「error 文本常显 / error 日志默认展开」的旧断言。
- 文档：`docs/architecture/workflow-orchestration.zh-CN.md`（错误展示与 i18n 键）、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`（两处）、`docs/wiki/src/styles/README.md`。
- 验证：`npm run test` → 444 files / 5184 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes（本次不动）：`src/components/workspace/SubagentRunDetailContent.tsx` 的 subagent 错误块（`border-destructive/50` 那段）仍是无 clamp 的全量文本，属同类问题，等有反馈再统一。


## dream-page-shadcn-layout（done，2026-10-28）

- 更正：上一轮误改了设置页**左侧导航**（并动了全局 `.quickforge-settings-subtab`，影响数据管理页）。用户明确只要改 Dreaming 页内部，已全部回滚：`git diff` 对 `SettingsWorkspacePage.tsx` 与 `shell.css` 均为空；`quickforge:open-settings-tab` 监听保留（属上一个 feature）。
- 本轮只改 `src/components/dreaming/*` 与 `src/styles/settings/dreaming.css`：
  1. **一张 Card 一块事**：状态卡（标题 + 状态点/文字 + 立即处理 + 开关）→ 4 列 stats 条（下次/上次/生效/模型）→ 2 列字段网格（模型、执行时间、记忆语言、敏感、定时），全部用 `border-t` 发丝线分隔，不再堆 5 个 settings-row。
  2. **页内 tabs 用本页自己的 segmented**：`.quickforge-dreaming-tabs`（muted 轨道 + 选中项浮起），筛选器移到同一行右侧，省掉单独一行 toolbar。
  3. **列表改成 divide-y 行**：去掉 `min-height: 5rem` 与逐行 border（会与 divide-y 双线），行 padding 统一 0.875/1.25rem，空态改为居中弱化文字而非 `settings-empty-row`。
  4. **按钮改用 shadcn Button**：`@/components/ui/button` 的 `variant=ghost|outline size=sm`（立即处理、分页、淘汰、查看、返回）。
  5. 字段布局抽出本地 `Field`（label 在上、控件在下）+ 两个常量 `CARD`/`HAIRLINE`，避免同类 class 散落。
- DESIGN_LANGUAGE 里上一轮加的「分组导航（shadcn 惯例）」收窄为「页内切换（segmented）」，并注明侧栏菜单沿用既有实现、本轮不动。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功（DreamingSettingsTab 24.19 kB / gzip 5.70 kB）；`npx tsc -b` → 0 错误。


## settings-nav-shadcn（done，2026-10-28）

- Goal：设置页这部分菜单按 shadcn 风格重排布局。
- 结论（一句话）：左侧导航从“大圆角 + 自选阴影 + 11px 分组标题”改为 shadcn 惯例——菜单项 `h-8 rounded-md px-2 text-sm`、选中 `bg-[var(--sidebar-accent)]` 且去阴影、分组标题 `text-xs`、组间 `space-y-4` 组内 `space-y-0.5`；页内切换（记忆/运行历史）从下划线 tab 改为 segmented 轨道。
- 关键判断：
  1. 去掉 `shadow-[0_8px_22px_-20px_...]`：阴影属于浮层，不该出现在导航选中态（DESIGN_LANGUAGE 也禁止“每项都有明显阴影”）。
  2. 选中态改用 shadcn 语义 token `--sidebar-accent`/`--sidebar-accent-foreground`，不再用项目自建的 `--quickforge-sidebar-active-bg`（保留变量本身，侧栏其它地方仍在用）。
  3. 分组标题 `text-[11px]` → `text-xs`：去掉任意值，与 shadcn 的 `text-xs` 一致。
  4. 页内 tab 去下划线：设置面板里已有一层左侧导航，再来一条下划线会被读成第二层导航；segmented 轨道更贴近 shadcn Tabs。
  5. 同步修正间距：原 `pb-4`（分组内 padding-bottom）改到 nav 层的 `space-y-4`，避免“组内最后一项也带 16px”导致密度不均。
- 改动文件：`src/components/settings/SettingsWorkspacePage.tsx`（菜单项/分组/返回按钮/搜索框）、`src/styles/settings/shell.css`（subtab → segmented + section 内 gutter）、`DESIGN_LANGUAGE.md`（新增「分组导航（shadcn 惯例）」一节，固定 h-8/rounded-md/text-xs/组间距/选中态禁阴影）。
- 影响面：subtab 样式由 Dreaming 与 DataSettingsTab 共用，两处同步变为 segmented（纯视觉，交互与 aria 不变）。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## dreaming-button-layout-fix（done，2026-10-28）

- 现象：设置页记忆列表里的「淘汰」按钮一会儿横排一会儿竖排。
- 根因：按钮直接作为 `.quickforge-settings-list-item`（`display:flex; justify-content:space-between`）的子元素，没有包进 `.quickforge-settings-list-item-actions`（该类才有 `flex: 0 0 auto`），按钮自身也没有 `flex-shrink: 0` / `white-space: nowrap`。内容一长就挤压按钮宽度，两个中文字被折成两行 → 看起来是“竖着”。内容短时又正常 → “一会儿横一会儿竖”。
- 修法：
  1. `.quickforge-settings-button` 全局补 `flex: 0 0 auto` + `white-space: nowrap`（按钮标签永远不该竖排）。
  2. 记忆行的「淘汰」与运行详情的「查看/收起」按钮包进 `.quickforge-settings-list-item-actions`。
  3. 新增 `.quickforge-dreaming-list` 作用域：`align-items: flex-start`（按钮钉在首行，不随内容行数上下漂移）+ actions 区 `flex-wrap: nowrap`。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## sidebar-show-more-indent（done，2026-10-28）

- 问题：项目分区的会话列表底部「显示更多」左边缘与会话标题对不齐——会话行展开态是 `px-2 + pl-8`（32px），按钮只有 `w-full px-2`（8px）。
- 修复：`SessionDisplayControls` 改用 `sidebarRowClass(sidebarOpen)`，新增可选 `sidebarOpen` / `indent` props；项目分区调用点传 `indent`，`timeline` / 全局对话不加缩进。顺带修掉收起态的偏差——原来按钮固定 `px-2` 左对齐，现在跟随会话行的 `justify-center px-0` 居中。
- 改动文件：`src/components/sidebar/chat-sidebar/SessionDisplayControls.tsx`、`src/components/sidebar/ChatSidebar.tsx`（三处调用点传 `sidebarOpen`，项目处加 `indent`）、`tests/frontend/sidebar-section-order.test.ts`（契约断言改指 `sidebarRowClass(sidebarOpen)` 并新增缩进断言）、`progress.md`、`session-handoff.md`。
- 验证 / Evidence：`npx vitest run tests/frontend/sidebar-section-order.test.ts` → 22 passed；`npx eslint` 三个改动文件 → 无输出（0 error）；`npx tsc -b` → 0 错误。未创建 Git commit，未触碰 `dist/` 等生成产物。
- Notes：`pl-8` 在拆分前的 `SidebarSessionRow` 里就已存在，「显示更多」此前从未跟随这段缩进，不是本轮重构新引入的回归；只是按钮与会话行共用 `sidebarSessionRowBaseClass` 后视觉上更容易被看成“共用同一行样式却没对齐”。

## rollback-inline-edit（done，2026-10-28）

- 需求：回滚不要二次确认，点一下就把那条消息就地变成输入框，改完直接发送。
- 方案（一句话）：`inline-message-editor.ts` 把「确认弹窗」换成「就地编辑 + 后续消息变淡预览」，提交时先静默截断（`rollbackForResend`）再把新文案交给 composer 的 `onSend`，复用既有的 API key 检查 / plan-mode 包装 / 乐观消息 / 滚动锚定。
- 关键取舍：
  1. **不再有确认步骤，代价改用可视线索**：该行之后的消息加 `quickforge-message-doomed`（opacity .34 + grayscale）并插入 `quickforge-removal-divider` 虚线说明「以下 N 条消息将被移除」，比弹窗里那句抽象描述更具体。
  2. **发送链路不另起一套**：装饰层不直接调 `agent.prompt`，而是回滚成功后在 panel 上轮询 `.qf-message-editor` 的 `onSend`（最多 12 帧）再发送——回滚到第一条会重建会话（新 agent + 新 surface），桥要等 React 提交后才可用；非 DOM 环境（rAF 缺失）轮询立即失败并保持编辑态。
  3. **装饰层幂等**：编辑中的行打 `data-quickforge-editing`，行循环整行短路（不重写 dataset key），避免重装饰把用户正在输入的编辑框冲掉；流式开始 / 只读切换统一 `closeInlineMessageEditors`。
  4. **保留降级路径**：没传 `onRollbackForResend` 的调用方仍走旧的 `rollback-confirm-popover.ts`，侧聊等只读场景语义不变。
- 动过的文件：`inline-message-editor.ts`（新）、`message-actions.ts`、`ChatPanelHost.tsx`、`useChatActions.ts`（抽出 `performRollback(messageIndex, restoreDraft)` + 新导出 `rollbackForResend`）、`App.tsx`、`SharedConversationPage.tsx`、`src/styles/chat/message-edit.css`（新，index.css 里紧跟 messages.css 导入）、`i18n.ts`（双语 7 条）。
- 验证：`npm run test` → 443 files / 5176 passed / 2 skipped；`npm run lint` → 0 problems；`npm run build` → 成功；`npx tsc -b` → 0 错误。单测 `tests/frontend/inline-message-editor.test.ts`（7 例，jsdom）：预填/变淡/虚线、提交成功关闭、提交失败保持编辑态、Enter vs Shift+Enter、Esc 还原、切换行互斥、装饰层点回滚不再出 popover 且二次点击取消。
- Notes：设计稿在 `docs/design/rollback-inline-edit.html`（整屏高保真，可切「现状 / 新方案」对比）。真机待确认：编辑态气泡变宽后长文本的折行观感、以及回滚到第一条消息时（重建会话）发送是否稳定落到新 agent。
- 追加调整（真机反馈）：「这条消息及之后 N 条会被移除…」与「Enter 发送 · Esc 取消」不再平铺，收进 footer 左侧的 ⓘ 提示（hover / focus / 点击展开，靠近消息区顶部时自动翻到按钮下方），footer 只留 ⓘ + 取消 + 发送；同时去掉 textarea 的 `focus-visible` outline 与气泡外扩的 3px ring——编辑态本身（主色描边 + 光标）已表达焦点，再套一层会在气泡内部形成深色边框。输入框默认书写高度提到 `min-height: 4rem`（约 2.5 行），自增高的 `resizeTextarea` 改为 `max(scrollHeight, computed min-height)` 取值，内容只有一行时不再缩成一条细缝。——随后按用户澄清「要的是宽度」回退了高度（min-height 回到 1.6rem），改为编辑态放宽宽度：行内 margin 收到 0.25rem、气泡 `max-width: 100%`，铺满消息列。
- 宽度再调整（用户反馈「还是很短」「不要超过对话消息」）：根因是气泡是 `align-self: flex-end` 的**收缩宽度**，只写 `max-width` 根本不会变宽——短消息的编辑框始终只有一行文本那么宽。改为编辑态 `align-self: stretch` + `width: 100%`，宽度 = 对话列宽（不超出）；中途试过的「编辑时把消息列放宽到 80rem」已撤销。

## process-stage-scroll（已回滚，2026-10-28）

- 决定：用户试用后觉得「执行中 · N 个工具调用 · N 条命令」展开区被限高（`min(50vh, 18rem)` + 区域内滚动 + 执行中自动贴底）不好用，要求撤回该功能。
- 回滚范围：整条 feature 的代码 / 测试 / wiki 全部还原——`src/styles/chat/process.css`（限高与展开态滚动规则）、`src/components/chat/panel-decoration/process-folding.ts`（`resolveProcessStageScrollFollow` / `bindProcessStageScrollFollow` / `applyProcessStageStick` / `scheduleProcessStageStick` / `resetProcessStageScrollFollow` 及 `updateProcessStageGroups` 内的绑定逻辑）、`tests/frontend/process-folding.test.ts`、`tests/frontend/process-folding-incremental.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md`。
- 回滚方式：该功能是一次独立提交 `55923d4`，且 `git log 55923d4..HEAD -- <上述文件>` 无任何结果（无后续提交改动过这些行），因此直接按文件回退到父提交 `ab1ff0b0` 的版本；**没有**用 `git revert`，因为 `feature_list.json` / `progress.md` 当时已有未提交改动（`dreaming-settings-discoverability`），revert 会在状态文件上冲突。
- 保留：`feature_list.json` 的 `process-stage-scroll` 条目与 `session-handoff.md` 的记录（标注已回滚，便于日后查到这段历史，避免重复实现）。
- 验证 / Evidence：`npx vitest run` process-folding + -incremental + -ownership + chat-surface-css-contract + css-architecture → 5 files / 114 tests passed；`npm run test` 全量 → 442 files / 5169 passed / 2 skipped（= 回滚前的 5172 减掉本 feature 的 3 个用例）；`npx tsc -b` → 0 错误；`npm run lint` → 0 error；`npm run build` → 成功（built in 4.24s）。未创建 Git commit。
- Notes：回滚后「执行中 N 个工具调用」的展开区恢复成随内容全高展开（工具多时会把对话拉长、也不会自动贴底）——这是回滚预期的旧行为。`src/styles/chat/process.css` 里所有 `quickforge-process-stage*` 结构与 `PROCESS_STAGE_DEFAULT_EXPANDED = true`（内层阶段恒默认展开）属于更早的功能，未受影响。

## dreaming-settings-discoverability（done，2026-10-27）

- 现象：用户反馈“运行时候没有模型这个选项”。
- 排查结论（代码本身没问题）：直接向正在运行的实例取了模块源码 —— `GET http://127.0.0.1:5176/src/components/dreaming/DreamingSettingsTab.tsx` 返回 130 KB 转译结果，确认包含 `dreamingModel` / `dreamingModelFollowChat`；`GET /api/dreaming` 也返回 `model.effective = HAPI/deepseek-v4-flash · source=active`，说明三级解析已生效。
- 真正原因：模型选择在「设置 → 自动化 → Dreaming」，而「设置 → 记忆」页对 Dreaming **一字未提**（`MemorySettingsTab.tsx` 里没有任何 dreaming 字样），从“记忆”找入口必然找不到。
- 修法：
  1. `MemorySettingsTab` 新增 Dreaming 区块：一行摘要（状态 · 条目数 · 当前生效模型）+「打开 Dreaming 设置」按钮。
  2. `SettingsWorkspacePage` 监听 `quickforge:open-settings-tab` 自定义事件跳转页签（项目里原先没有跨页签跳转机制）。
  3. 事件监听对非 DOM 环境做了守卫：`typeof window === 'undefined' || typeof window.addEventListener !== 'function'` 直接 return——单元测试渲染该页时不提供 window。
- 验证：`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。


## dreaming-model-selection（done，2026-10-27）

- Goal：Dreaming 要能自由选模型；先搞清楚为什么它一直在用 智谱/GLM-4.6V。
- 根因：未指定模型时 `resolveDreamingModel()` 直接调 `resolveImplicitModelPreference(null)`，它返回**模型目录第一条**；用户第一个配置的自定义模型就是 智谱/GLM-4.6V。同时设置页根本没有模型入口，所以既不可见也不可改。
- 结论（一句话）：改成三级解析——指定 `dreaming-settings.modelRef` → 最近对话模型（`settings['active-model']`）→ 目录第一条；设置页加可搜索模型下拉（首项「跟随对话模型」），并用 `overview.model` 把**实际生效的模型与原因**显示在 meta 行。
- 关键细节：
  1. 指定的模型被删/隐藏时，`resolveModelBinding` 抛错后不中断 run，降级到下一优先级（避免凌晨定时任务直接失败）。
  2. 只有在 `active-model` 真的存在时才走第二级；否则 `resolveImplicitModelPreference(undefined)` 会返回目录第一条，被误标成“跟随对话”。
  3. 保存设置时先校验 `modelRef` 可解析，不可解析直接 400，不把坏配置留到定时触发才暴露。
  4. 模型下拉展示 `name (provider)`，宽度单组控制（`quickforge-dreaming-field-model`），不挤压其他内联设置。
- 改动文件：`server/dreaming/runner.mjs`（三级解析 + `modelLabelOf`）、`server/routes/dreaming.mjs`（overview.model + PUT 校验）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（中英文案 14 条）、`tests/server/dreaming-runner.test.mjs`（+4 例回归）、`tests/server/routes/dreaming.test.mjs`（+2 例）、设计稿 §6.1 与 §10、wiki。
- 验证：dreaming-runner 14 passed；routes/dreaming 11 passed；`npm run test` → 442 files / 5172 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 「跟随对话」用的是 `active-model`，即用户最近一次在对话里选中的模型；它不会随每个会话的临时切换变动。
  - 视觉模型（如 GLM-4.6V）用于文本摘要不是错误但浪费；现在用户可以在下拉里直接换成纯文本模型，代码不做能力判断。


## dreaming-ui-polish（done，2026-10-28）

- Goal：在 dreaming-ui-and-language 的结构上做第二轮 UI 精修——更美观、简洁、易用，不动后端。
- 结论（一句话）：状态不再只靠点的颜色表达（点旁永远拼同色调状态词）；徽章去碎（作用域下沉到 meta 行、名词挂 `title` 数字裸排）；内联设置与 meta 行之间加 hairline 分层；折叠箭头换 lucide chevron 旋转；搜索去掉按钮改为 300ms 防抖自动查询。
- 具体改动：
  1. 头部：标题从「开启 Dreaming」（开关的 label 兼标题，语义重复）改为功能名「梦境记忆」+ 状态文字（已开启/已关闭/进行中/上次运行失败，与状态点同色）；开关补 `aria-label`；meta 行去掉与 subtab 重复的「已淘汰」计数、自动区段两句长文案换短句（`dreamingAutoSectionOnShort/OffShort`）；保留并行会话新增的「生效模型」行。
  2. 记忆行：`ScopeBadge` 降为 meta 行文字（`全局 · 0.86 · 4.2 · 时间`），落地既有设计决策「数字裸排 + 名词挂 title」；行内徽章从 3 个收敛到 2 个（类型 + 召回次数），召回徽章带 `title`（`在对话中被召回 N 次`）。
  3. 运行行/详情：`+N/~N/-N/✕N/耗时` 每格补 `title` 全称；变更/衰减区的 `0.86 / 4.2` 裸数字徽章、读取内容区的消息数/字符数徽章同样补 `title`；折叠箭头由字符 `▸/▾` 换为 lucide `ChevronDown` + `--quickforge-dur-fast` 旋转（`data-open` 驱动，符合设计语言“动效挂 data 不挂 class”）。
  4. 筛选：删掉「搜索」按钮与回车触发，输入 300ms 防抖自动查询，状态下拉切换即查询（两者行为统一；首帧由初始加载覆盖，`useRef` 跳过首次）。
  5. CSS：`dreaming.css` 新增 `.quickforge-dreaming-status-text`（含 data-state 着色与 `·` 分隔）、`.quickforge-dreaming-chevron`（旋转过渡）、`.quickforge-dreaming-settings` 顶部 hairline。
- 改动文件：`src/components/dreaming/DreamingSettingsTab.tsx`、`src/styles/settings/dreaming.css`、`src/lib/i18n.ts`（新增 8 条双语）、`docs/architecture/dreaming-memory.zh-CN.md`（§10 页面结构描述同步）。
- 验证 / Evidence：`npx tsc -b` → 0 错误；`npx eslint` 改动 ts 文件 → 0 问题；`npx vitest run tests/frontend/{i18n-language-snapshot,settings-workspace-react,quickforge-settings-select,recall-experience-renderer}.test.ts` → 4 files / 45 passed；`npm run build` → ✓ built in 4.66s。
- 追加修复（同轮，2026-10-28）：真机出现 `Cannot read properties of undefined (reading 'available')` 崩溃（DreamingSettingsTab modelOptions）——崩溃行来自并行「模型选择」改动（`overview?.model.available` 只保护了 `overview` 没保护 `.model`），触发环境是**旧 server 进程**返回的 overview 无 `model` 字段（磁盘上 `server/routes/dreaming.mjs` 已总是返回该字段，5176 端口上有一个更早启动的实例在应答）。处理：`DreamingOverview.model` 改为可选类型 + 前端三处访问全部设防（`overview?.model?.available`、meta 行经局部 `effectiveModel` 收窄），旧 server 下页面降级显示「无模型」而不是整页崩。验证：tsc 0 错误、eslint 0 问题、settings-workspace-react + i18n 快照 23 passed。用户侧需重启旧的 dev server 进程才能看到完整的模型信息。
- Notes：
  - 开发态偶发崩溃：首次打开 Dreaming 页曾出现 `SettingsSelect` → `visibleSelectIndexes` 的 `option.label.toLowerCase()` TypeError（疑似 Vite 首载陈旧模块 + HMR websocket 失败的缓存现象，整页刷新后不可复现；相关 key 在 en/zh 双语均已确认存在）。`t()` 对缺失 key 会静默返回 undefined，缺 en 回填时任何消费 `label` 的组件都会整页崩——建议后续给 `t()` 加开发态缺 key 警告或给 `visibleSelectIndexes` 加防御，属共享组件改动，未在本次范围处理。
  - `dreamingMemorySearch`（搜索按钮文案）与 `dreamingAutoSectionOn/Off`（长文案）在本次改动后无生产消费方，保留未删（repo 有留档先例）。
  - 并行会话在 DreamingSettingsTab 里新增了「模型」选择（`modelRef` / `overview.model`），本轮改动已与其合流：meta 行保留生效模型、内联设置含模型下拉；其数据层细节见对应 feature 记录。

## dreaming-ui-and-language（done，2026-10-27）

- Goal：`Dreaming` 设置页要更简洁易用；同时修掉“用户中文对话、沉淀出的记忆却全是英文”的语言对齐问题。
- 结论（一句话）：语言不能靠提示词自觉——“write in the user's language” 被英文系统提示词淹没；改为代码从 **user 消息**里判定（CJK 字权重 ≈ 4 个拉丁字母，样本不足 12 个字母返回 null），再以 `## Output language` 硬要求写进 user message，设置项 `contentLanguage` 可覆盖，判定结果入库并在详情页显示。
- UI 改动：
  1. 原来的四组 settings-row（开关/定时/时间/敏感/运行/计数/自动区）压成一个「头部状态块」：状态点 + 开关 + 立即处理按钮；第二行单行 meta（下次/上次/生效/淘汰/自动区）；第三行内联设置（执行时间、记忆语言、敏感内容、定时开关）。
  2. 记忆列表与运行历史合并为一块，用 subtab 切换并带计数，避免两个长列表垂直堆叠。
  3. 运行历史改为整行可点的按钮式行：状态徽章 + 时间 + 单行指标（会话/+新增/~更新/-淘汰/✕拒绝/耗时）+ 结论，指标用语义色区分不加重底色。
  4. 详情页改为「状态条 + 统计条 + 元信息一行 + 可折叠分区」，读取内容/变更/拒绝/衰减/原始响应默认收起，减少滚动。
  5. 新增 `src/styles/settings/dreaming.css`（状态点含 running pulse 与 `prefers-reduced-motion` 降级），其余仍用既有 settings 令牌。
- 改动文件：`server/dreaming/{collect,prompt,runner,settings}.mjs`、`server/sqlite/{migrations,dreaming-repository}.mjs`（v15 `content_language`）、`src/components/dreaming/{DreamingSettingsTab.tsx,dreaming-data.ts}`、`src/styles/settings/dreaming.css`（新）、`src/styles/index.css`、`src/lib/i18n.ts`（语言文案 14 条）、`tests/server/{dreaming,dreaming-memory,dreaming-runner}.test.mjs`、`docs/architecture/dreaming-memory.zh-CN.md`、`docs/wiki/server/README.md`。
- 验证 / Evidence：五个 dreaming 测试文件 → 58 passed；`npm run test` → 442 files / 5166 passed / 2 skipped；`npm run lint` → 0 问题；`npm run build` → 成功（DreamingSettingsTab 21.46 kB / gzip 4.79 kB）；`npx tsc -b` → 0 错误。
- Notes：
  - 已经存下的英文记忆不会自动重写——它们会在后续 run 里被 `update`/`supersede` 逐步替换为中文；想立刻重置只能在记忆列表里手工淘汰。
  - 判定只在“样本足够”时生效；纯代码会话会得到 `null`，此时提示词退回“跟随 transcript 语言”而不是瞎猜。
  - 记忆列表的置信度/强度仍显示在 meta 行，没有做成图表：这两个值目前只用于排序与淘汰阈值，做成可视化会夸大其精度。
- 补充（同轮）：真实 `~/.quickforge/MEMORY.md` 里已经有一批旧版写出的英文条目。为了不产生中英重复，提示词在 `## Existing memories` 后新增一句：已有条目若仍是另一种语言，应使用 `action="update"` 就地改写为目标语言，而不是为同一事实新建一条。这样历史条目会在后续 run 里逐步转成中文。


## workflow-docs-sync-to-code（done，2026-10-27）

- Goal：以**最终代码**为准同步 run_workflow 的文档，**不改任何代码**；并回答「当前并发是多少」。
- 结论（一句话）：默认权限下并发**恒为 1**（`effectiveConcurrency = hasFullAccess ? options.concurrency : 1`），只有完全访问模式才用 `options.concurrency`（默认 4、上限 8）；文档里「4 并发」的表述会让人误以为是常态，已改为「默认权限串行 1 / 完全访问默认 4」。另外修掉 6 处文档与实现不符的点。
- 关键对照（每条都落到行号）：
  1. **并发**：`agent-workflow-runner.mjs:236`。附带发现 `details.concurrency` 上报的是**生效值**（默认权限下恒 1），不是调用方传入值 —— UI 上看不出「配了 4 被降级」。
  2. **hooks 失败语义**：只有空/非字符串 prompt（`worker.mjs:250`）、空 tool name（`:260`）、`args` 非 plain object（`:263`）在 guest bridge 内抛 `TypeError`；其余参数错误（prompt 超长 `:165`、未知 option `:102`、schema 不可序列化/超限 `:106-113`、未知 tool option `:132`）由 `hostCall` 捕获后以 `ok:false` 回投 → `agent()`/`tool()` 返回 `null`。原文档说「参数非法会 throw」，与实现不符。
  3. **`phase()` 超 120 字符**：`phase` 是 notify 型消息（无 `requestId`），父进程 `normalizePhaseTitle` 校验失败后走 `if (!id) return`（`worker.mjs:191`）**静默丢弃**。脚本内 `currentPhase` 已更新，但该阶段不进 `details.phases`，后续 `log()` 归到上一阶段。原文档写「超 120 字符 throw」，是错的。
  4. **`schema` 未透传**：`runner.mjs:548-558` 调 `runAgent` 时只传 `prompt/profile/label/context/expectedOutput/workflowLabel/maxRuntimeMs/maxToolCalls/model`；`subagent-runner.mjs:347-351` 的 `schemaHint` 依赖 `params.schema`，工作流路径不会传 → 分支永不生效。所以 workflow 里的 `schema` 是**纯后置断言**，模型看不到契约，写散文时更容易返回 `null`。
  5. **中止/孤儿错误文本**按步骤位置区分：队列 Agent `Workflow stopped before this agent started.`、队列工具 `...before this tool call started.`、运行中 `Workflow stopped while this step was running.`（超时/父中止）或 `Workflow completed before this step settled.`（脚本已 return）。`markRunningStepsStopped` 是**同步**标记，因为 abort 后在途步骤是异步 settle 的。
  6. **details / 前端**：Agent record 漏了 `seq`；`subagentRun` 实际透传 16 个字段（补全 `subagent`/`sessionId`/`parentSource`…）；聊天卡跑马灯内容是**最后一个阶段标题**（`workflow-tool-renderer.tsx:108`），不是活跃步骤 label；`MaxWorkflowRunSnapshots` 是 50 不是 100（原文写「100→50」）；`workflowActiveStepLabels` 已无生产消费方（仅测试引用）。
- 改动文件（纯文档）：
  1. `docs/architecture/workflow-orchestration.zh-CN.md` — §2.1 模块表（补 `workflow-run-payload.ts` / `WorkflowRunDetailContent.tsx`）、§2.4 toolset 懒构建、§3.1 hooks 失败语义、§3.3 schema 边界、§4 并发与预算补充、§5.2/5.4 中止文本、§7.1 Agent record `seq` 与 `subagentRun` 字段、§7.2/7.3 前端契约合并重写（跑马灯、单行卡、实时通道、i18n 残留键、样式类清单）、§9 测试覆盖、§10 相关文件带行数。
  2. `docs/wiki/README.md` — 项目概览的并发表述（默认串行 1 / 完全访问默认 4）。
  3. `docs/wiki/server/README.md` — run_workflow 段：有界队列并发（生效值）、worker 协议补 phase/log 无 requestId、孤儿文本、schema 后置校验、toolset 懒构建缓存、限制表补 parallel/pipeline 256 与 bridge 5s、details 形状。
  4. `docs/wiki/src/lib/README.md` — 4 个 workflow 文件的行数与描述（549/190/149/135），渲染器契约（跑马灯取最后阶段、`activeWorkflowRunStore` 驱动 `data-open`、展开体已删的类清单）、残留 i18n 键。
  5. `docs/wiki/src/components/README.md` — 详情页条目补「样式已无 `--wf-tl-*`」与概览派生统计的显隐条件；历史段落加已移除提示。
  6. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `node -e "JSON.parse(...)"` → `feature_list.json` 语法 OK。
  - `git status --porcelain` → 本 feature 只涉及 5 个 md + 3 个记录文件；未触碰 `server/`、`src/`、`tests/`、`dist/` 等生成产物。
  - 逐条取证行号见「关键对照」。
- Notes：
  - **没有跑 `npm run test` / `lint` / `build`**：本轮零代码改动，这些门禁不会因文档变更而受影响。若需要门禁记录可单独跑一次。
  - 发现 3 处「代码 vs 文档」的实质问题（schema 未透传、参数校验错误类型不统一、`phase()` 静默丢弃），按「不要改代码」的要求**只写进文档**，未修。
  - 建议后续单独决策是否修 `schema` 透传（1 行改动，能显著降低 workflow 里 `agent({schema})` 的失败率）。


## recall-experience-tool-card（done，2026-10-27）

- Goal：`recall_experience` 在聊天里没有专属样式，只有兜底卡（工具名 + 整段 JSON），且 `count: 0` 会被渲染成绿色对勾，读起来像“成功查到了什么”。
- 结论（一句话）：新增专属渲染器 —— 折叠态一行读完（灯泡图标 + 回忆经验 + `· query` + 命中计数 + 状态），展开态是结构化经验列表（kind/scope/×recallCount + 正文 + 质量指标），并把「0 命中」重新定义为**正常结果**而非成功对勾 + JSON。
- 关键取舍：
  1. **计数分两种可见性**：命中时 `meta-hover`（默认隐形，避免每个工具行都挂一个数字）；0 命中时 `meta-important` 常显——因为「没查到」本身就是这次调用的结论。
  2. **0 命中与失败互斥**：`count === 0 && status === 'done'` 才渲染 `.quickforge-recall-empty` 中性说明；`isError` 走 `renderConsoleBlock(..., 'error')` + destructive 图标。旧兜底卡两者都不区分，是这次的主要体感问题。
  3. **正文不截断**：用户展开卡片就是为了读全文，`line-clamp` 只省一次点击但会藏掉关键限定条件。
  4. **质量指标不带标签**：行内 `0.86 · 4.2 · 2 个会话 · 3 天前` 已够读，完整名词挂在各段 `title` 上（`dreamingMemoryConfidence` / `dreamingMemoryStrength`），避免辅助信息抢正文层级。
  5. **复用而非新建视觉语言**：行配方复刻 `.quickforge-todo-history-item`（无分隔线、hover 仅 `muted 55%` 轻背景、无位移/边框/阴影）；颜色全走语义 token，暗色零覆盖；不自造 keyframes，运行态借用 `quickforge-tool-running-sweep`。
  6. **视图模型独立成纯函数**（`recall-experience-history.ts`）：只认 `details.type === 'recall_experience_result'`，其余返回 `available:false` 不伪造列表；空正文行整条丢弃；`confidence` 夹 0–1、`sessionCount` 按 evidence sessionId 去重（与设置页 `MemoryRow` 同口径）。
  7. **顺手补齐三处遗漏**：`renderToolIcon` 的 if 链（否则回落扳手图标）、`summarizeParams` 分支（subagent 跑马灯复用同一套摘要规则）、`approval-card` 的 `BUILTIN_TOOL_LABELS`（审批卡原本会显示原始工具名）。
- 改动文件：
  1. `src/lib/recall-experience-history.ts`（新，101 行）— 视图模型 + `recallRecencyDays`。
  2. `src/lib/tool-renderers/recall-experience-tool-renderer.tsx`（新，151 行）— 渲染器。
  3. `src/lib/tool-renderers/shared.tsx` — `renderToolIcon` 加 `recall_experience`（灯泡）分支。
  4. `src/lib/tool-renderers/index.ts` / `src/lib/local-tools.ts` — 导出 + `registerToolRenderer`。
  5. `src/lib/tool-param-summary.ts` — `recall_experience` 取 `query`（修剪空白）。
  6. `src/components/chat/panel-decoration/approval-card.ts` — `recall_experience: 'recallExperience'`。
  7. `src/lib/i18n.ts` — 9 个键 × 2 语言（标题/最强记忆/命中计数/无匹配/两条空态说明/会话数/今天/N 天前）。
  8. `src/styles/chat/tool-output.css` — `.quickforge-recall-{list,item,meta,kind,content,metrics,sep,count,empty}` + `.quickforge-recall-tool > div .text-xs`。
  9. `tests/frontend/recall-experience-renderer.test.ts`（新，16 例）、`tests/frontend/tool-param-summary.test.ts`（+2 例）。
  10. `docs/wiki/src/lib/README.md` — 渲染器条目 + 视图模型小节 + 文件表行。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/recall-experience-renderer.test.ts tests/frontend/tool-param-summary.test.ts tests/frontend/tool-renderer-registry.test.ts tests/frontend/chat-surface-tool-message.test.ts` → 4 files / 41 passed。
  - `npm run test` → 442 files / 5160 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 问题；`npx tsc -b` → 0 错误；`npm run build` → ✓ built in 9.89s（仅既有 chunk 体积 warning）。
- Notes：
  - 未跑「发布」流程，未创建 Git commit（用户未要求）。
  - 折叠态**不做** kind/scope 药丸：`DESIGN_LANGUAGE.md` 已否掉「折叠态堆状态短条」，这些信息只在展开态出现。
  - `renderToolIcon` 仍是 if 链而非映射表，每次新增工具都要改两处（`shared.tsx` + `local-tools.ts`）；本次未重构，留作后续独立 feature。
  - 未验证真机视觉：建议实际跑一次 `recall_experience`（有命中 / 无命中各一次）确认 hover 计数与列表行距在暗色下符合预期。

## schema-version-test-hygiene（done，2026-10-27）

- Goal：结束“每次升 schema 都要在 7 个测试文件里改同一个版本号”的 churn，同时不引入恒真断言。
- 结论（一句话）：**不是**把数值断言都换成 `SQLITE_MIGRATIONS.length` 推导，而是直接删掉“等于最新版本”这类断言（它对迁移写坏完全没有分辨力），把价值留在能真正抓 bug 的地方——历史迁移边界的显式字面量、迁移行与迁移表逐项对齐、版本号连续性与 `user_version === 已应用行数`、以及表/列/索引/数据内容。
- 关键取舍：
  1. `const LATEST_SCHEMA_VERSION = SQLITE_MIGRATIONS.length` 只是把 churn 从 7 处收敛到 1 处，测试依然在重述实现；`expect(health().schemaVersion).toBe(SQLITE_MIGRATIONS.length)` 永远为真，迁移少写一列、漏建索引它都抓不到。故直接删除。
  2. 历史边界必须写死：`slice(0, 11)` 后验“v11 runtime 拒绝新库”、`migration 12` 故意失败验回滚、v7→v8 / v8→v9 / v2→v3 回滚——这些是“某个历史版本之前的库”这种事实。改成从当前列表推导会静默从“测那一条迁移”漂移到“测最新两条”。
  3. 迁移行断言改为与 `SQLITE_MIGRATIONS` 逐项比对（`version/name` 全等）：既能抓改名/重排/重复，又不写死版本号。
  4. 并发初始化断言改为“版本号连续 + `user_version` 等于已应用行数”，语义是“没重复、没漏”，与原 `COUNT === 版本号` 等价但不依赖具体数字。
  5. electron smoke fixture 里的裸 `schemaVersion: 14` 改成读实际 `health()` 输出，并校验 `schemaVersion === migrationCount`。
  6. helper 收窄为“构造用”而非“断言用”：保留 `LATEST_SCHEMA_VERSION`（构造“列表之后一条”的失败迁移）与新增 `NEXT_SCHEMA_VERSION`，并在注释里写明它不该用于版本断言。
- 改动文件：`tests/helpers/sqlite-schema.mjs`、`tests/server/sqlite-storage-foundation.test.mjs`、`tests/server/scheduled-task-runs-repository.test.mjs`、`tests/server/session-state-repository.test.mjs`、`tests/server/share-repository.test.mjs`、`tests/server/lan-access-repository.test.mjs`、`tests/fixtures/session-state-full-chain-electron-smoke.mjs`、`tests/server/session-state-full-chain-electron-smoke.test.mjs`。
- 验证 / Evidence：
  - `npx vitest run` 5 个 schema 相关仓库测试 → 5 files / 61 passed。
  - `npx vitest run tests/server/session-state-full-chain-electron-smoke.test.mjs` → 1 passed。
  - `npx eslint` 上述 8 个改动文件 → 0 problems。
- Notes：
  - 本次未跑全量 `npm run test` / `npm run build`（非发布改动，改动集中在测试与 fixture）；如需发版仍须完整跑三项。
  - `scheduled-task-runs-repository.test.mjs` 里 `DELETE FROM schema_migrations WHERE version >= 3` 与 `PRAGMA user_version = 2` 也是历史边界字面量，刻意保留。
  - `package-dist/`、`package-offline/` 内的同名 `migrations.mjs` 未触碰（生成产物）。

## dreaming-run-detail（done，2026-10-27）

- Goal：Dreaming 只取会话的「user 消息 + assistant 最终回答」（含压缩摘要），总预算 100k 字符；并为运行详情页补齐可追溯的数据与 UI。
- 结论（一句话）：采集层从「全消息投影 + 工具结果首尾截断」改为「只投影 user 与最终回答」——工具调用与工具输出根本不进 prompt，因此不需要任何截断启发式；「最终回答」用 `no toolCall && stopReason ∉ {toolUse,error,aborted}` 判定，顺带把过程式中间消息与被中断回复排除掉。
- 关键取舍：
  1. 压缩摘要保留且单独标记为 `history(compacted)`：它以 user 角色存储，是那段被压缩历史的唯一可见形式，丢了等于丢掉历史；提示词里明确它证据强度更弱（置信度上限 0.7）。
  2. evidence 从 `sessionId+seq` 改为 `sessionId+note`：transcript 已无行号，保留 seq 是假精度。
  3. 运行详情新增 v14 四列（`model_label/input_chars/sessions_json/raw_response`）：窗口内会话可能超出保留期，事后再也复现不出“当时送了什么”，所以采集时就把每会话投影文本裁到 1200 字符存库。
  4. rejected 保留模型原提案（kind/scope/content/targetId）：只存 reason 无法区分“规则太严”和“模型跑偏”。
  5. 详情页额外返回 `memories`（本次触及条目当前状态），前端一次请求即可渲染“提案 vs 库中结果”的 diff。
  6. schema 版本断言改为从 `SQLITE_MIGRATIONS.length` 推导（新增 `tests/helpers/sqlite-schema.mjs`）：此前每次升 schema 都要手改 7 个测试文件的同一个字面量，已连续踩两轮。
- 改动文件：
  1. `server/dreaming/collect.mjs` — 重写 `projectMessages()`（user + 最终回答 + history(compacted)），新增 `isFinalAnswer()`、`SESSION_PREVIEW_CHARS`，预算改为单会话 30k / 整体 100k，返回带 preview 的 `sessions`。
  2. `server/dreaming/prompt.mjs` — 系统提示改为说明 transcript 只含 user 与最终回答；新增 Transcript format 段；`history(compacted)` 置信度约束。
  3. `server/dreaming/apply.mjs` — evidence 去掉 seq。
  4. `server/dreaming/runner.mjs` — createRun 写 modelLabel/inputChars/sessions；finishRun 写 rawResponse；rejected 保留原提案。
  5. `server/sqlite/migrations.mjs` — v14 `dreaming_run_details`（4 个 ADD COLUMN）。
  6. `server/sqlite/dreaming-repository.mjs` — toRun/createRun/finishRun 支持新列。
  7. `server/routes/dreaming.mjs` — detail 返回 `memories`，事件收集覆盖 replacementId。
  8. `src/components/dreaming/dreaming-data.ts` / `DreamingSettingsTab.tsx` — 详情页六段式（概览 / 读取内容 / 变更 / 拒绝 / 衰减 / 原始响应），`OperationRow` 同时显示提案与库中结果。
  9. `src/lib/i18n.ts` — 14 个新文案（中英）。
 10. `tests/server/dreaming.test.mjs`（采集用例外重写 + 压缩摘要/中断回复两例）、`tests/server/routes/dreaming-detail.test.mjs`（新，3 例）、`tests/helpers/sqlite-schema.mjs`（新）、5 个 schema 版本测试改为推导、fixture 升到 14。
 11. `docs/architecture/dreaming-memory.zh-CN.md`（采集/提示词/数据模型/前端详情三节）、`docs/wiki/server/README.md`。
- 验证 / Evidence：
  - `npx vitest run tests/server/dreaming.test.mjs tests/server/dreaming-memory.test.mjs tests/server/dreaming-runner.test.mjs tests/server/routes/dreaming.test.mjs tests/server/routes/dreaming-detail.test.mjs` → 52 passed。
  - 5 个 schema 版本测试 → 61 passed。
  - `npm run test` → 441 files / 5144 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 问题；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - 100k 是**字符**不是 token。按 3 字符/token 粗算约 33k token；若只想按 token 计，改 `MAX_TOTAL_CHARS` 即可（单处常量）。
  - 不含工具输出后，模型只能依据“用户说了什么 + 助手最后答了什么”判断。这意味着**它看不到具体命令与报错文本**，所以 pitfall 类记忆会偏向“现象 + 结论”而不是精确命令；这是用 100k 预算换覆盖面的直接代价。
  - `sessions_json` 每会话存 1200 字符预览，40 会话上限时单行最大约 48KB，仍在 SQLite 常规行大小内，无需拆分。


## dreaming-memory（done，2026-10-27）

- Goal：新增全自动 Dreaming 后台记忆固化——回看已结束会话，沉淀结构化长期记忆，并在后续任务中自动检索使用。
- 结论（一句话）：四个动作（提取事实/总结经验/识别错误/更新认知）全部交给一份提示词，代码只做硬校验后单事务落库，因此既保持“全自动”又不会让模型幻觉直接污染记忆库；检索用 SQLite 自带 FTS5 trigram，不引入新依赖。
- 关键设计取舍：
  1. 不做独立进程 worker，改做 server 内子系统 `server/dreaming/`：desktop/Android 共用同一 server，多进程会带来打包与退出成本；要的是逻辑隔离（独立设置、独立 run 记录、独立单飞锁）。
  2. MEMORY.md 分人工区与 `<!-- dreaming:auto:begin/end -->` 自动区，自动区整体重写、人工字节逐字保留——全自动写入若沿用“全量替换”必然覆盖人工内容。
  3. 记忆不只存 MEMORY.md，还落 SQLite 结构化经验库（kind/confidence/strength/evidence），才可能做“更新认知”与“淘汰”而不靠模型自觉。
  4. 淘汰判据只用可观测量（strength<1 且 confidence<0.5 且 30 天未召回，三者同时满足），不用“模型决定忘掉”；淘汰是软删，可追溯。
  5. 中文检索：默认 unicode61 分词器无法匹配中文子串，实测 trigram 可以；不足 3 字符的查询回退 `LIKE`（表规模小，代价可忽略）。
- 改动文件：见 `feature_list.json` 的 `dreaming-memory` 条目（设计稿、migration v13、server 模块、前端设置页、4 个新增测试、6 个受 schema 版本升级影响的既有测试、3 个 wiki 页）。
- 验证 / Evidence：
  - 四个新增测试文件 → 48 passed。
  - `npm run test` → 441 files / 5127 passed / 2 skipped（退出码 0）。
  - `npm run lint` → 0 error / 0 warning；`npm run build` → 成功；`npx tsc -b` → 0 错误。
- Notes：
  - schema 从 v12 升到 v13，6 个既有测试硬编码了“最新版本=12”，已同步；其中 `sqlite-storage-foundation` 的表清单断言额外包含 FTS5 的 5 张影子表（`memories_fts_*`），这是 SQLite 正常行为，不是新增业务表。
  - 测试隔离教训：`global-memory.mjs` 与 `storage.mjs` 在 import 时就从环境变量解析数据目录，route/runner 测试必须 mock 这两个模块，否则会写真实 `~/.quickforge/MEMORY.md` 与 `config/settings.json`（本轮已发生并已清理）。
  - 已知边界：单次 run 只做一次模型调用（不做 tool-calling 多轮），成本可预测但模型无法回看 transcript 细节；采集预算（单会话 6000 字符 / 总量 60000 字符 / 最多 40 会话）在代码里封顶，不靠模型自觉。
  - 尚未做：跨设备记忆同步、向量检索、per-session 记忆；`recall_experience` 目前只按 FTS5 + strength/新鲜度排序，没有真正的语义相似度。


## fork-session-visible-immediately（done，2026-10-27）

- Goal：fork 出的新对话必须马上出现在左侧会话列表，而不是等用户再发一条消息。
- 结论（一句话）：根因是服务端 `createAgent` 从不持久化——创建期唯一那次持久化依赖「首条 user 消息 message_end」，而 fork 预置了 messages 时 `sessionCreatedEmitted` 直接为 true、该分支永久跳过，会话索引里查不到；修法是在 `createAgent` 返回前对 `messages.length > 0` 且非 restore 的会话 `await persistSession(session)`。
- 改动文件：
  1. `server/agent-manager.mjs` — `createAgent` 末尾新增创建期持久化（`messages.length > 0 && typeof config.persistedStateJson !== 'string'`），失败只记日志不阻断创建；不调用 `emitSessionEvent`。
  2. `server/agent-persistence.mjs` — `sessionLastModifiedFromMessages` 改为 `max(末尾消息时间, createdAt)`，避免继承旧历史时间戳的 fork 被排到列表底部。
  3. `src/hooks/useChatActions.ts` — `forkFromMessage` 传 `refreshSessions: false`（由 createAgent 内部那次负责），并去掉 `if (storage)` 门禁；同时移除已无用的 `storage` 局部变量。
  4. `tests/server/agent-manager.persist-session-state.test.mjs` — 新增 3 例：seeded 会话创建即落库且 `lastModified` 为 now、无消息创建仍不落库、restore 不重写（revision 不变）。
  5. `tests/frontend/fork-session-visibility.test.ts`（新） — 4 例源码契约：创建期持久化存在且排除 restore、创建期不发事件、fork 刷新不被 storage 门禁、`refreshSessions:false` 去重。
  6. `docs/wiki/server/README.md` / `docs/wiki/src/hooks/README.md` — 记录 createAgent 持久化时机与 `lastModified` 语义。
- 验证 / Evidence：
  - `npm run test` → 437 files / 5119 passed / 2 skipped，退出码 0。
  - `npm run lint` → 0 error / 0 warning。
  - `npm run build` → ✓ built in 7.06s。
  - `npx tsc -b` → 0 错误。
  - 定向：`agent-manager.persist-session-state` 37 passed；agent-manager 相关 9 文件 72 passed；`fork-session-visibility` 4 passed。
- Notes：
  - 早期尝试在该处发 `session_created` 并置 `sessionCreatedEmitted`，会额外消耗一次 `stateVersion`（既有断言 3→4 被抓到），已改为只写库不发事件：创建端自己会 `refreshSessions`，其他端通过索引读到即可。
  - `/summary` 的 fork 路径本来就显式 `persistSession`，不受此缺陷影响；本轮修复让普通 fork 与之对齐。
  - 创建期持久化是同步 await，会让 `POST /api/agents/:id` 多一次 SQLite 写；仅限带 messages 的创建（fork/seeded），空会话创建不受影响。

## fork-title-prefix（done，2026-10-27）

- Goal：fork 出来的新对话在会话列表里要能一眼看出是分叉，先用标题 `[fork]` 前缀解决（不做溯源字段）。
- 结论（一句话）：fork 路径改用 `generateForkTitle()`，新会话标题为 `[fork] + 首条用户消息`；前缀独立于既有 46 字符预算，正文截断规则不变，普通会话标题零影响。
- 改动文件：
  1. `src/lib/message-utils.ts` — 新增 `FORK_TITLE_PREFIX = '[fork] '`、`generateForkTitle(messages)`；`generateTitle(messages, prefix = '')` 增加可选前缀参数（前缀在多语言下统一，不本地化）。
  2. `src/hooks/useChatActions.ts` — `forkFromMessage` 由 `generateTitle(messages)` 改为 `generateForkTitle(messages)`。
  3. `tests/frontend/message-utils.test.ts` — 新增 `describe('fork title')` 四例：前缀不吃字符预算、短提示词保留空格归一化、无 user 消息时为 `[fork] New chat`、普通标题不带前缀。
  4. `docs/user-guide.zh-CN.md` / `docs/user-guide.en-US.md` — 分支/Fork 段落补充前缀说明。
  5. `docs/wiki/src/lib/README.md` / `docs/wiki/src/hooks/README.md` — 同步生成函数与 fork 行为说明。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/message-utils.test.ts` → 10 tests passed。
  - fork/标题相关 6 个前端测试（message-utils / message-actions / side-chat-workspace-tab / project-new-chat-reuse-guard / session-title / chat-capabilities）→ 6 files / 77 tests passed。
  - `npx eslint` 三个改动 TS 文件 → 0 error。
  - `npx tsc -b` → 0 错误。
- Notes：
  - 服务端 `titleSource` 逻辑未动：客户端传入非 `New chat` 标题即 `titleSource='manual'`，因此 fork 会话不会被 AI 标题覆盖——这正是前缀能稳定保留的原因，但也意味着 fork 会话标题不会自动精修；若以后要允许精修，需按“前缀 + 可识别”判断放行，而不是改 `canApplyGeneratedTitle()` 的全局语义。
  - 未做 `forkedFromSessionId` 溯源：后端 `createAgent` 无该字段、持久化与列表渲染也都没有，属独立 feature（可支持“分叉自 X”与分支树）。
  - `sessionTitle()` 只对完全等于 `New chat` 的标题做本地化，`[fork] New chat` 会原样显示；该场景只在 fork 出无语义首条消息时出现，未额外处理。

## compaction-prompt-english-untruncated（done，2026-10-27）

- Goal：把压缩用的提示词全部改成英文；并去掉 transcript 构造中的所有截断。
- 结论（一句话）：`COMPACT_SYSTEM_PROMPT` 与用户消息模板改为全英文（输出语言仍跟随会话语言），同时删除三层长度上限（单条 10000 字符、transcript `min(160000, max(12000, contextWindow×1.6))`、工具参数 2000 字符）——摘要现在能看到完整历史，代价是请求过大时由 provider 报错并经 `auto_compact_failed` 显式暴露，而不是静默产出不完整的摘要。
- 改动文件：
  1. `server/conversation-compaction.mjs` — `COMPACT_SYSTEM_PROMPT` 英文重写（九段结构不变）；用户消息模板改英文；删除 `truncateMiddle()` 与 `transcriptCharLimit()`；`buildTranscript(messages)` 不再接收/使用 model；`safeJson(value)` 去掉 `maxLength`；`formatMessageForTranscript()` 不再对消息正文做 10000 字符截断；`approximateMessageChars()` 的 attachments 调用同步去掉长度参数。保留 `redactSensitive()`（定点替换，非截断）与 `[image omitted]` / `[attachments omitted]` 结构性占位。
  2. `tests/server/conversation-compaction.test.mjs` — 新增 `describe('conversation compaction prompt')` 五个用例：提示词全英文且不含 CJK、transcript 指令为英文；40k 字符正文完整上送且不含 `[truncated`；5000 字符工具参数完整上送；裸 `sk-*` 仍被脱敏且 20k 正文不丢；`token = sk-*` 赋值形式被折叠为 `[REDACTED]`。
  3. `docs/wiki/server/README.md` — `conversation-compaction.mjs` 段新增「提示词（全英文）」与「不再做任何截断」两段，写明取舍与保留项。
  4. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx vitest run tests/server/conversation-compaction.test.mjs` → 11 tests passed。
  - 压缩相关四文件（conversation-compaction / agent-compaction / auto-compaction / auto-compaction-notice）→ 4 files / 46 tests passed。
  - `npx eslint` 改动文件 0 error；`npx tsc -b` 0 错误。
- Notes：
  - 语义边界：`minSourceChars` 门槛用的是**未截断**的 transcript 长度，因此判断更贴近真实历史量（旧行为下超长历史被截断到 160k 后仍高于门槛，实际结论不变）。
  - 已知残留：`LEGACY_COMPACTION_NOTICE_PREFIX/SUFFIX` 仍是中文常量，那是**历史识别**用的（旧版本写入的 notice 文案），不是提示词，不能翻译，否则旧会话的压缩消息将无法被识别与过滤。
  - 若后续发现某些小窗口模型频繁因输入过大而压缩失败，正确做法是提高 `<conversation_to_compact>` 的收敛策略（例如按 token 分块递进摘要），而不是恢复「掐头留尾」式截断。

## compaction-ux-timing（done，2026-10-27）

- Goal：分析自动上下文压缩的显示时机是否合理，并把「必须做」的缺口一次性补齐——架构最优、设计最优、保证产品体验，允许重构该部分代码。
- 结论（一句话）：压缩 UI 由「服务端零散事件 → 装饰层注入式卡片」改为「服务端 `state.compactionNotice` 单向状态投影 → React 在消息列表尾部渲染」，五个缺陷一并消失：进行中不再静默、审批不再留下死卡片、自动压缩不再切掉当前回合、阈值信号不再被丢弃、卡片不再强制滚动。
- 改动文件：
  1. `server/auto-compaction.mjs` — 新增 `COMPACTION_NOTICE_PHASES`（`awaiting_confirmation` / `summarizing`）、`setCompactionNotice()` / `clearCompactionNotice()`、`AUTO_COMPACT_DECISION` 四种结果、`resolveAutoCompactTailStart()` + `AUTO_COMPACT_MIN_TAIL_USER_TURNS`；`maybeAutoCompactSession()` 在每个进入/退出路径发布或清空 notice，审批结果区分拒绝/超时/取消/不可用；`approvalId` 前置生成并写入 notice；catch 住 abort 拒绝不再伪装成压缩失败。删除 `auto_compact_threshold_reached`。
  2. `server/agent-approval-orchestrator.mjs` — `createAutoCompactApprovalPromise()` 返回 `AUTO_COMPACT_DECISION`、采纳调用方传入的 `approvalId`、每条终止路径发 `auto_compact_approval_settled`（`decided` / `timed_out` / `cancelled`），并区分「已通告」与未通告的失败。
  3. `server/agent-compaction.mjs` / `server/agent-manager.mjs` / `server/agent-session-queries.mjs` — 初始化、`resetSessionCompaction()` 清空 notice；`getSessionState()` 投影 `compactionNotice`。
  4. `src/lib/server-agent-types.ts` / `src/lib/server-agent.ts` — 新增 `ServerAgentCompactionNotice` 与 `state.compactionNotice`；`auto_compact_state` / `auto_compact_approval_settled` 两个 case；`state` 帧与 `/state` 刷新都按「整体快照」语义覆盖（缺失即空闲）。
  5. `src/lib/global-agent-sse-client.ts` / `src/lib/shared-server-agent.ts` — SSE 事件白名单更新。
  6. `src/components/chat/surface/ContextCompactionStatusRow.tsx`（新）/ `ContextCompactionDecisionRow.tsx`（新）/ `MessageList.tsx` / `ChatSurface.tsx` / `ChatTypes.ts` — 两个行组件作为消息列表尾部子节点渲染；`ChatSurface` 订阅两个新事件；snapshot 增加 `compactionNotice`。
  7. `src/components/chat/panel-wiring/approval-cards.ts` / `panel-decoration/approval-card.ts` / `ChatPanelHost.tsx` — 删除 auto-compact 注入卡与其 tone/copy/keepBoundary/scrollIntoView 链路（`findKeepBoundaryTarget`、`statusIcon(tone)`、`ApprovalCardCopy`、`getMessages`/`keepRecentTurns` 依赖），`ChatPanelHost` 把批准/拒绝回调接进 `ChatSurface`。
  8. `src/lib/i18n.ts` + `src/styles/chat/context-compaction.css` — 新增 `compactionSummarizing*` 文案（en/zh）；新增状态行/决策行样式（shimmer 复用 `shimmer` keyframes + `prefers-reduced-motion` 降级、决策行复用邻近卡片强度、按钮只做 scale 按压反馈）。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误。
  - `npx eslint`（22 个改动文件）→ 0 error；`npm run lint` → 0 error / 0 warning。
  - 压缩相关 22 个测试文件 → 22 files / 299 tests passed。
  - `npm run test` → 435 files / 5076 passed / 2 skipped，退出码 0。
  - `npm run build` → 成功（`✓ built in 5.82s`）。
- Notes：
  - 新增测试：`tests/server/auto-compaction-notice.test.mjs`（notice 相位序列、四种审批结果、抛错/取消清理）、`tests/frontend/context-compaction-rows.test.ts`（两个行组件的渲染/隐藏/只读/不滚动）；`tests/server/auto-compaction.test.mjs` 增加 `resolveAutoCompactTailStart` 三例；`tests/server/agent-approval-orchestrator.test.mjs` 与 `tests/frontend/approval-card.test.ts` 更新为废弃旧契约后的断言。
  - 未做的（与本轮边界无关，已记录）：失败态仍走 `auto_compact_failed` 的临时日志提醒，没有常驻错误行；`keepRecentTurns` 设置项仍写“0 = 不保留”，文案与实际自动路径行为（至少保留 1 个当前回合）存在轻微不一致，属设置页文案后续跟进。
  - 首次全量跑出现 1 个失败（`semantic-color-class-parity`），原因是 CSS 注释里字面写了旧文档的语义色类名示例；改为文字描述后通过，说明该测试会扫描注释，新增样式注释时不要在注释里写带透明度的语义色类名。

## baseline-verification（done，2026-10-27）

- Goal：跑一次完整基线验证（test / lint / build），确认仓库当前无真实失败；只记录结论，不做功能改动。
- 结论（一句话）：三项全绿——`npm run test` 433 files / 5057 passed（2 skipped，退出码 0），`npm run lint` 0 error / 0 warning，`npm run build` 成功；此前多轮记录的「31 个 `Cannot find package 'jsdom'` 环境错误」已消失（`jsdom` 现已可解析）。
- 改动文件：仅 `progress.md` / `session-handoff.md` / `feature_list.json` 记录，无源码改动。
- 验证 / Evidence：
  - `npm run test` → `Test Files 433 passed (433)`、`Tests 5057 passed | 2 skipped (5059)`、Duration 82.47s、退出码 0。
  - `npm run lint` → `eslint .` 无任何输出（0 error / 0 warning）。
  - `npm run build` → `✓ built in 6.17s`（仅有既有的 >500kB chunk size 提示 warning）。
- Notes：
  - 本轮为 goal 模式长跑验证，未新增 feature、未改业务代码、未创建 Git commit、未触碰 `dist/` 等生成产物（build 输出按既有脚本生成，未手工修改）。
  - 工作区存在他人遗留的未跟踪临时文件 `.tmp-cdp-probe4.cjs` / `.tmp-cdp-probe5.cjs` / `.tmp-cdp-result.json`，与本轮无关，未清理。

## background-tasks-output-height（done，2026-10-27）

- Goal：后台任务面板的日志输出区（终端明细）太高——长日志时被拉成半屏，把任务列表挤到只剩两行；希望改矮到约 14~16 行。
- 结论（一句话）：输出区从「吃满剩余高度」改为「按内容占位 + 封顶 18rem」——`.quickforge-background-tasks-output` 由 `flex: 1 1 auto` 改为 `flex: 0 1 auto` 并加 `max-height: 18rem`（保留 `min-height: 4rem`），`.quickforge-background-tasks-detail` 同步由 `flex: 1 1 auto` 改为 `flex: 0 1 auto`，滚动区 `-output-scroll` 的 `flex: 1`（basis 0）改为 `flex: 1 1 auto` 让日志高度真正参与占位；省下的竖向空间归还任务列表（`-list` 从 `flex: 0 1 auto + max-height: 45%` 改为 `flex: 1 1 auto`，仍是唯一滚动容器）。
- 改动文件：
  1. `src/styles/workspace/background-tasks.css` — 上述 4 条规则 + 设计注释（为什么 detail 不能 flex-grow、为什么 scroll 区 basis 必须是 auto、为什么列表不再按 45% 封顶）。
  2. `tests/frontend/background-tasks-tab.test.ts` — 新增 `caps the output area height instead of stretching it to half the panel`：锁定 output 的 `max-height: 18rem` / `min-height: 4rem` / `flex: 0 1 auto`（且不得 `flex: 1 1 auto`）、detail 不得 flex-grow、list 为 `flex: 1 1 auto` 且无 max-height 并保留 `overflow-y: auto`。
  3. `docs/design/background-tasks-align-preview.html` — 「本次修正」补一条输出区封顶 18rem 的说明（该页直接 link 真实 CSS，预览自动跟着变）。
  4. `docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md` — 同步竖向高度策略（detail/output 均 `flex: 0 1 auto`，输出 4rem~18rem，剩余高度归列表）。
  5. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/background-tasks-tab.test.ts tests/frontend/css-architecture.test.ts tests/frontend/subagent-running-indicator.test.ts` → 3 files / 42 tests passed。
  - `npm run lint` → 0 error。
  - `npm run build` → 成功（built in 5.82s）。
- Notes：
  - 没有新增文案 / i18n key，纯样式改动；用户所说的「终端明细」实为面板内的「输出」区（仓库里没有该文案）。
  - `max-height` 放在输出区而不是详情区：短日志时详情自然矮（不留大块空白），长日志才长到 18rem 为止；若把上限挂到 `.detail` 上，短日志的详情也会被撑成 18rem 高。
  - 未做真机视觉确认（18rem 是否合适、窄窗下 meta 行数较多时的观感）；`npm run test` 全量未跑（本轮只跑 3 个相关文件，其中含既有 jsdom 缺包噪音）。

## process-stage-scroll（done，2026-10-27）

- Goal：把「执行中 · 16 个工具调用 · 4 条命令 · 编辑 1 个文件」这条内层阶段（stage）展开后的工具列表收拢为固定高度，超出部分在区域内滚动；执行中新增工具行要自动贴底到最新一行，用户手动上翻后不再抢回阅读位置。
- 结论（一句话）：限高 `min(50vh, 18rem)` 挂在折叠动画壳层 `.quickforge-process-body-inner`（stage-body 的子级选择器，DOM 结构不变），滚动能力只在 `[data-expanded="true"]` 挂上并加 `overscroll-behavior: contain`；执行中由 `scheduleProcessStageStick`（rAF）贴底跟随，`resolveProcessStageScrollFollow` 用 24px/8px 双向滞回判断是否继续跟随，跟随标记存 inner 的 `dataset.quickforgeStageFollow`，手动收起时复位。
- 改动文件：
  1. `src/styles/chat/process.css` — 新增 `.quickforge-process-stage-body > .quickforge-process-body-inner { max-height: min(50vh, 18rem) }` 与展开态 `overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain`（含设计注释：为什么滚动容器必须是 inner、为什么限高两态都保留而滚动只在展开态）。
  2. `src/components/chat/panel-decoration/process-folding.ts` — 新增 `resolveProcessStageScrollFollow`（导出供测试）、`bindProcessStageScrollFollow`、`applyProcessStageStick`、`scheduleProcessStageStick`（WeakSet 去重 + rAF，无 rAF 环境退化为同步）、`resetProcessStageScrollFollow`；`updateProcessStageGroups` 在 label 写入后对 stage inner 绑监听并按 `expanded && stageStreaming` 排队贴底，收起态复位跟随标记；stage summary 的 onclick 收起时同样复位。
  3. `tests/frontend/process-folding.test.ts` — 新增 `resolveProcessStageScrollFollow` 滞回用例（24/25、8/9、NaN/Infinity）。
  4. `tests/frontend/process-folding-incremental.test.ts` — 新增「流式新增工具行后区域滚动贴底、用户上翻后不再贴底」用例（fake inner 上挂 scrollTop/scrollHeight/clientHeight）。
  5. `tests/frontend/chat-surface-css-contract.test.ts` — 新增 `caps the expanded stage body height and scrolls inside it`：限高只能挂 stage inner、滚动只在展开态、折叠壳层（body/stage-body）不得变成滚动容器、顶层组 inner 不得限高。
  6. `docs/wiki/src/styles/README.md`、`docs/wiki/src/components/README.md` — 同步 process.css 条目与 process-folding 折叠说明（限高滚动 + 贴底跟随 + 滞回阈值）。
  7. `feature_list.json` / `progress.md` / `session-handoff.md` — 本轮记录。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误；`npx eslint` 改动源码/测试文件 → 0 error。
  - `npx vitest run` process 相关 11 文件（process-folding / -incremental / -ownership、chat-surface-css-contract、css-architecture、thinking-streaming-stage、motion-design、thinking-hint、thinking-header-adoption、subagent-process-trace、scroll-sync）→ 11 files / 186 tests passed。
  - `npm run lint` → 0 error；`npm run build` → 成功（built in 6.08s）。
- Notes：
  - 没有给 stage body 插新包装层：滚动容器复用既有动画壳层 inner，`stage-body > inner > step` 的结构契约（`appendProcessToolSuffix` 的校验链、`process-folding-incremental.test.ts` 的选择器）因此零改动。
  - 限高放在两态共用的 inner 规则里、只把 `overflow` 放到展开态：收起瞬间若放开上限，内容会先弹回全高再塌陷（观感一次跳变）。
  - 贴底用 rAF 而不是装饰 pass 内同步读写：`scrollHeight`/`clientHeight` 是布局查询，装饰 pass 刚写完 DOM 时同步读会触发强制重排。
  - 滚动条画在 inner 右缘，stage body 的 `padding-left: 0.75rem` 缩进与左侧连接线留在滚动区外、不随内容滚动。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Goal：
- 结论（一句话）：
- 改动文件：
  1.
- 验证 / Evidence：
- Notes：

## present-files-inline-links（done，2026-10-26）

- Goal：`present_files`（展示文件）工具卡去掉右上角眼睛（预览）按钮，改为摘要区逐文件渲染「文件图标 + 文件名」，文件名 hover 出下划线、点击跳转预览（范围仅 present_files，write/edit/read 摘要保持不变）。
- 结论（一句话）：`renderPreviewButton` 整体删除，新增 `renderPresentedFilesSummary(params)` 在摘要区逐文件渲染，与 `renderToolFileSummary` 同一套 span + click（`previewArtifactClickHandler` → `PREVIEW_ARTIFACT_EVENT`）与 `underline-offset-4 hover:underline` 文案，不可预览文件纯静态。
- 改动文件：
  1. `src/lib/tool-renderers/shared.tsx` — 删除 `renderPreviewButton`（present_files 的眼睛按钮）与其 `t` 依赖路径；`resolvePreviewableArtifact` 收窄为 write/edit/read 单文件；新增 `presentedFileEntries`（files 归一化，兼容 string 与 `{ path, kind }`）与导出 `renderPresentedFilesSummary`（逐文件 FileIcon + basename，逗号分隔，可预览各挂 click；工作区外绝对路径经 `isNonWorkspaceClickablePath` 静态化）。
  2. `src/lib/tool-renderers/local-workspace-tool-renderer.tsx` — `present_files` 摘要改走 `renderPresentedFilesSummary`；`quickforge-tool-actions` 里移除 `renderPreviewButton`，只剩终止命令按钮。
  3. `tests/frontend/tool-renderer-file-icon.test.ts` — 眼睛按钮用例替换为 3 个新用例（逐文件可点 + 各自派发事件、不可预览/工作区外静态、无 files 时不渲染元素）；新增 `presentedFileNodes` 辅助函数；顶部注释同步。
  4. `docs/wiki/src/lib/README.md` — `shared.tsx` 条目把 `renderPreviewButton` 换为 `renderPresentedFilesSummary` 并说明「动作区不再有眼睛按钮」的理由。
  5. `feature_list.json` / `progress.md` / `session-handoff.md` 记录本轮。
- 验证 / Evidence：
  - `npx tsc -b` → 0 错误。
  - `npx vitest run tests/frontend/tool-renderer-file-icon.test.ts tests/frontend/local-tool-running-sweep.test.ts tests/frontend/tool-param-summary.test.ts tests/frontend/css-architecture.test.ts` → 4 files / 39 tests passed。
  - `npx eslint src/lib/tool-renderers/shared.tsx src/lib/tool-renderers/local-workspace-tool-renderer.tsx tests/frontend/tool-renderer-file-icon.test.ts` → 0 error。
  - `npm run test` → 402 files / 4731 tests（4727 passed，3 failed，1 skipped）。3 个失败均在 `tests/frontend/background-tasks-tab.test.ts`（1）与 `tests/frontend/subagent-running-indicator.test.ts`（3，并行跑时计 2）内，断言对象是工作区里既有的未提交改动（`src/components/app/ConversationHeader.tsx`、`src/components/chat/panel-decoration/subagent-running-indicator.ts`、`src/styles/workspace/background-tasks.css`、未跟踪的 `src/lib/background-tasks-open.ts`），与本轮改动的 `tool-renderers/*` 无交集（两文件均不引用 `tool-renderers` / `renderPreviewButton`）；另有 31 个 `Cannot find package 'jsdom'` 的既有环境错误。
  - `npm run lint` → 0 error / 3 存量 warning（`coverage/` 生成目录）。
  - `npm run build` → 成功（built in 5.47s）。
- Notes：
  - 摘要区逗号分隔符用裸文本 `', '`（未新增 CSS 类），避免引入无对应样式的选择器。
  - `quickforge-tool-actions` 现在只在 `run_command` 运行中出现（终止按钮）；CSS 的 `:has(> .quickforge-tool-actions > button)` 预留区规则保持不变，present_files 摘要因此不再被预留 1.75rem 右侧内边距。
  - 未改动 `summarizeParams` 的 present_files 纯文本分支——它仍供子代理跑马灯（`subagent-run-detail.ts`）与 MCP 渲染器使用。
  - 已知与本轮无关的失败：`background-tasks-tab.test.ts` / `subagent-running-indicator.test.ts` 的 3-4 个用例（源码断言指向工作区里其他未提交改动），记在此备查、未扩大改动范围。

## background-tasks-sidebar（done，2026-10-26）

- Goal：把「后台运行命令」的运行与历史从临时浮层收进右侧边栏，提供可筛选、可搜索、可看日志的统一面板；终态历史不新增服务端接口，直接派生自会话消息。
- 结论（一句话）：Workspace Inspector 新增 `background-tasks` 运行时 Tab（`BackgroundTasksTabContent`），运行中来自 `backgroundCommands` 快照、终态由 `toolResult` 消息 `details` 派生（`src/lib/background-tasks-model.ts`），入口为置顶摘要 + Composer 图标两处，顶栏不设入口（顶栏图标入口已于下方「跟进 2 · 入口重构」删除）。
- 改动文件：
  1. `src/lib/background-tasks-model.ts`（新增）— `buildBackgroundTasks` 统一视图模型：running 取后台命令快照，finished 从 `toolResult` 消息派生 `completed`/`failed`/`timed_out`/`aborted`、`exitCode`/`durationMs`；同 `taskId` 两边都有时以消息终态为准；筛选/搜索/时长格式化纯函数。
  2. `src/components/workspace/BackgroundTasksTabContent.tsx`（新增）— 面板内容：全部/运行中/已结束筛选 + 关键字搜索、任务列表与状态点、详情元信息、命令日志预览（`getCommandLog`）、跟随输出、复制命令/任务、停止任务与查看完整日志入口；选中项失效时回落到第一条 running。
  3. `src/components/workspace/WorkspaceInspector.tsx`、`workspace-panel-tabs.ts`、`workspace-inspector-tabs.ts`、`useInspectorTabs.ts` — 注册 `background-tasks` kind（`Activity` 图标）、单实例复用、`serializePanelTabs` 剔除（不持久化）。
  4. `src/components/app/ConversationHeader.tsx` + `src/App.tsx` — 会话头入口与运行中数量徽标，点击打开/激活后台任务 Tab（经 `requestWorkspaceInspector`）；该入口后来在「跟进 2 · 入口重构」中整体删除。
  5. `src/styles/workspace/background-tasks.css`（新增）+ `src/styles/index.css` — 面板样式，class 前缀 `.quickforge-background-tasks-*`。
  6. `src/lib/i18n.ts` — en/zh 成对新增后台任务面板文案；本次清理未使用的 `backgroundTaskTabLabel`（两段各删除一行）。
  7. `tests/frontend/background-tasks-model.test.ts`、`tests/frontend/background-tasks-tab.test.ts`（新增）、`tests/frontend/server-agent-background-commands-frame.test.ts`（新增，6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 合并逻辑）。
  8. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/README.md`、`docs/wiki/server/tools/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：
  - `npm run test` → **402 files passed / 4722 tests passed（1 skipped）**；退出码 1 仅来自 31 个标注 `@vitest-environment jsdom` 的文件无法启动 fork worker（`Cannot find package 'jsdom'`，既有环境缺失），无真实断言失败，其余断言全部通过。首轮全量曾出现 `tests/server/scheduled-tasks.commands.test.mjs` 2 个用例失败，单独重跑该文件 24 passed，重跑全量后全绿——判定为并发下的既有 flake，与本次改动无关（本次只删了一个 i18n key 并改文档）。
  - `npx vitest run tests/frontend/background-tasks-model.test.ts tests/frontend/background-tasks-tab.test.ts tests/frontend/server-agent-background-commands-frame.test.ts` → 全过（其中 `server-agent-background-commands-frame.test.ts` 6 用例，覆盖 `background_commands` 帧短快照的 `toolCallId` 就地合并）。
  - `npm run lint` → 0 error / 3 warning（均为 `coverage/` 生成目录的 unused eslint-disable，存量）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.78s）。
- Notes：
  - 后台命令输出非流式：日志预览靠 2s 轮询（仅「跟随输出」开启且任务仍在运行时）。
  - `backgroundTasks` 是服务端内存 Map，服务重启后终态丢失，面板会变空。
  - `listBackgroundCommandTasks` 仍只返回 running，未改动——会话 idle 回收语义依赖它。
  - 服务端 `settleBackgroundCommandToolResult` 在找不到对应 `toolResult` 消息时返回 `false`，该任务不会出现在面板终态里（边界场景：会话被驱逐 / compaction 截断）。
  - 本机 `node_modules/jsdom` 缺失，31 个 `tests/frontend/*.test.ts`（jsdom 环境）无法启动，属既有环境问题。
  - Tab 条上的 tab 标签不显示任务数（运行中计数徽标在 Composer 命令图标上；原会话头入口在「跟进 2 · 入口重构」中删除），如需 tab 内计数需给 `panelTabLabel` 传入 count。

- 跟进（2026-10-27，后台任务面板样式对齐 + 入口统一）：
  - Goal：把后台任务面板的横向基准、控件高度、间距与字号刻度对齐 Inspector 其余 tab（`workflow-detail.css` 同轴），消除切 tab 时的横跳与工具栏 1px 高低差；同时把入口收敛到一处。
  - 样式对齐（`src/styles/workspace/background-tasks.css` 重写）：
    1. 水平基准从 0.5rem 改为 **0.875rem**，与 `workflow-detail.css` 同轴，切 Inspector tab 时正文不再横跳 5px。header / toolbar / detail-header / meta / output 外框统一落在基准线；列表用 `list 0.5rem + item 0.375rem` 叠出基准线。
    2. 输出区内部三级（标题条 / 滚动区 / 底部提示）统一横向 0.5rem，去掉原来的 0.4rem。
    3. 控件同高：分段控件 `1.375rem` + 容器 `0.125rem` 内距 = 搜索框 `1.625rem`，消除工具栏内 1px 高低差；输出标题条与底部提示也统一 `1.625rem`。
    4. 空间节奏回到 1/16 网格：`0.375 / 0.5 / 0.75`，清除 `0.3 / 0.35 / 0.4 / 1.05 / 1.15 / 1.6` 等零散值。
    5. 字号 4 档：`0.6875`（计数徽标）/ `0.75`（正文）/ `0.8125`（列表标题）/ `0.875`（面板标题与空态标题）。原面板标题 0.8125 小于 Inspector tab 的 13px，属层级倒挂，已提到 0.875。
    6. 行内操作不再绝对定位覆盖元信息：`.item-meta` 与 `.item-actions` 共用网格第三列（`grid-template-columns: auto minmax(0,1fr) minmax(3.5rem, auto)`），悬停只做透明度交换。修掉原先「操作区比元信息格宽 10px、透明底让命令字从图标间透出」的压字问题。
    7. 选中态（`is-active`）不再显示行内操作、也不淡出元信息——两者同格，常显会互相遮挡；选中行的停止/复制在详情区。
    8. 命令从 `word-break: break-all` 换行改为单行 `ellipsis` 截断 + `title` 展示完整值，避免长命令把复制/停止按钮挤到行中间。
    9. 详情头恢复 `border-bottom`（34% 弱线），meta 加 `padding-bottom: 0.5rem`，命令与元信息不再贴在一起。
    10. 输出区加 `min-height: 4rem`，面板被压矮时不会把日志挤成 0 高；`.detail` 加 `overflow: hidden`。
    11. 筛选/搜索无结果时新增 `.quickforge-background-tasks-no-results` 提示（新 i18n key `backgroundTaskNoResults`），不再复用「选择一个任务」空态文案。
    12. `pointer: coarse` 下图标按钮提到 `2rem`，满足触摸目标。
    13. 所有图标按钮、链接、跟随开关补 `:focus-visible` / `:hover` 过渡与 reduced-motion 关闭。
  - 配套改动：
    1. i18n（`src/lib/i18n.ts`）：`backgroundTaskElapsed`（`'{duration} elapsed'`，英文去参数后是小写 `elapsed`）替换为 `backgroundTaskMetaElapsed`（`'Elapsed'` / `'耗时'`）；新增 `backgroundTaskNoResults`。
    2. `src/components/workspace/BackgroundTasksTabContent.tsx`：详情命令加 `title`；输出 footer 提示文案加 `quickforge-background-tasks-output-footer-hint` 单行截断类。
    3. 入口统一：Composer 左下角命令图标不再弹浮层菜单（`openBackgroundCommandMenu` 已删），改为派发 `quickforge:open-background-tasks` 窗口事件（`src/lib/background-tasks-open.ts`），App 监听并按 `sessionId` 过滤后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`。顶栏 `ConversationHeader` 没有后台任务按钮。停止/查看日志只在面板内。
    4. `tests/frontend/background-tasks-tab.test.ts`：对齐断言改为 0.875rem 基准；新增「分段控件与搜索框同高」「操作区不与元信息压字（共用第三列）」「Composer 图标经窗口事件打开」三条；字号断言从 3 档改为 4 档。
  - 验证 / Evidence：`npx tsc -b` 通过；`npm run lint` 0 error（3 条 warning 在 `coverage/` 生成目录，存量）；`npm run build` 通过；`npx vitest run tests/frontend/` → 228 个文件中 227 通过，唯一失败 `tests/frontend/custom-providers-tab.test.ts` 属另一并行 feature（与本次无关），31 个 jsdom 缺包 worker 启动失败属既有环境问题；后台任务相关 67 个用例全绿。
  - Notes（跟进）：
    1. `docs/design/background-tasks-align-preview.html` 是可视化对齐校验页：直接引用真实 CSS + foundation token 子集，叠加 0.875rem / 0.5rem 基准线，可切亮暗与 340/380px 宽度。
    2. 列表正文比基准线多一个「圆点 + gap」的缩进，这是 bullet 列表固有缩进，圆点本身仍落在基准线上。
    3. 选中行不显示行内操作是刻意取舍（与元信息同格）。
    4. 日志预览仍是 2s 轮询，非流式（原限制未变）。

- 跟进 2（2026-10-27，后台任务入口重构：顶栏入口删除 + 置顶摘要双入口）：
  - Goal：把「打开后台任务面板」的入口从三方并存（顶栏图标、Composer 图标浮层、置顶摘要）收敛为「置顶摘要的后台命令区块」+「Composer 左下角命令图标」两个直开面板的入口，并清掉上一轮遗留的浮层代码与样式。
  - 完成内容：
    1. 会话顶栏：删除 `ConversationHeader` 的「后台任务」图标入口（含运行中数量徽标）。
    2. 置顶摘要：`PinnedSummarySections` 的「后台命令」区块成为主入口——标题右侧「查看全部」按钮（`backgroundTaskOpenPanel` / `backgroundTaskOpenPanelAria`）+ 每条命令的行主体（行本身是 button，aria 走 `backgroundTaskOpenAria`），停止按钮是同级兄弟按钮、点击冒泡不影响；区块内不再单独渲染「查看」入口。
    3. Composer 图标：`.quickforge-background-command-trigger`（终端图标 + 运行中角标）不再弹浮层，点击**直接打开右侧面板**；`openBackgroundCommandMenu` 与 `.quickforge-background-command-menu` 样式一并删除。
    4. 新增事件桥 `src/lib/background-tasks-open.ts`：`OPEN_BACKGROUND_TASKS_EVENT`（`quickforge:open-background-tasks`）+ `dispatchOpenBackgroundTasks()` + `normalizeOpenBackgroundTasksRequest()`；`App.tsx` 监听后调 `requestWorkspaceInspector({ kind: 'background-tasks' })`，且只接受「当前会话或缺省 sessionId」的请求。
    5. 保留：subagent 浮层仍复用 `renderBackgroundCommandItems`，`.quickforge-background-command-item/-copy/-stop/-log` 样式必须保留。
  - 改动文件：
    1. `src/components/app/ConversationHeader.tsx` — 删除后台任务入口按钮与徽标。
    2. `src/components/git/PinnedSummarySections.tsx` + `src/components/git/GitToolsPinnedSummary.tsx` — 「后台命令」区块加「查看全部」按钮、命令行主体改为整行按钮 + 兄弟停止按钮，新增 `onOpenBackgroundTasks` 透传。
    3. `src/components/chat/panel-decoration/subagent-running-indicator.ts` — 图标点击改为 `dispatchOpenBackgroundTasks({ sessionId })`，删除浮层打开逻辑。
    4. `src/styles/chat/composer-controls.css` — 删除 `.quickforge-background-command-menu`，保留 trigger/badge 与 item/copy/stop/log。
    5. `src/lib/background-tasks-open.ts`（新增）、`src/App.tsx`（事件监听 + 会话过滤）、`src/lib/i18n.ts`（`backgroundTaskOpenPanel` / `backgroundTaskOpenPanelAria` / `backgroundTaskOpenAria`）。
    6. `tests/frontend/background-tasks-tab.test.ts`、`tests/frontend/subagent-running-indicator.test.ts` — 对齐新入口断言。
    7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/src/lib/README.md`；`feature_list.json`、`progress.md`、`session-handoff.md`。
  - 验证 / Evidence：`npx tsc -b` 通过；`npx eslint` 相关改动文件 0 error；`npx vitest run` 相关 5 个测试文件 79 passed；`npm run build` 成功（built in 3.39s）。
  - Notes：
    1. 浮层删除后 `renderBackgroundCommandItems` 仍被 subagent 运行浮层复用，`.quickforge-background-command-item/-copy/-stop/-log` 相关 CSS 不能随手一并删除。
    2. 两处入口的打开路径不同：置顶摘要在 App 内直接持有 `requestWorkspaceInspector` 并顺带按既有规则收起摘要；Composer 图标在装饰层，只能经窗口事件回 App。事件 payload 只放 `sessionId`，App 侧做「只认当前会话」过滤，避免跨会话残留事件把面板切走。
    3. 后台命令输出仍是 2s 轮询（原限制未变）。

## models-providers-layered-settings（done，2026-10-26）

- Goal：按 `docs/design/models-providers-settings-redesign.html` 设计稿，把「模型与提供商」设置页从「一个表单管理全部配置」重构为分层设计：提供商列表 / 连接 / 模型三层各自保存。
- 结论（一句话）：`CustomProvidersSettingsTab` 拆为编排器 + `settings/custom-providers/` 三层子组件（列表+预设弹层 / 连接（密钥独立保存、提供商级测试）/ 模型（行内独立保存、可见性即时写回、模型级测试、服务器拉取）），存储结构不变，新增服务端 provider-test / provider-discover 两个接口。
- 改动文件：
  1. `src/components/settings/tabs/CustomProvidersSettingsTab.tsx` — 重写为编排器：providers/draft/选中态、L2 保存（改名迁移密钥 + 重建模型 headers/协议/baseUrl）、密钥独立保存、L3 读-改-写单提供商、provider-test / provider-discover / 模型级 test-connection 调用、active 生命周期与 `customProvider` 深链选中契约保持。
  2. `src/components/settings/custom-providers/`（新增目录）— `shared.ts`（预设、buildModel、草稿转换）、`provider-list-pane.tsx`（L1 + 添加预设弹层）、`provider-detail-pane.tsx`（头部 + 删除菜单）、`connection-section.tsx`（L2，含 `qf-provider-api-key` 密码字段契约）、`model-list-section.tsx`（L3 行内编辑）。
  3. `src/styles/settings/custom-providers.css`（新增）+ `src/styles/index.css` 挂载 — 主从布局、密钥行、脏标记条、模型行、窄屏抽屉（<768px 详情覆盖列表 + backdrop）。
  4. `server/routes/models.mjs`（68→144 行）+ `server/index.mjs` — 新增 `POST /api/models/provider-test`（GET baseUrl/models 探测，不依赖模型，OpenAI/Anthropic 两种鉴权）与 `POST /api/models/provider-discover`（返回模型 ID 列表）。
  5. `src/lib/i18n.ts` — en/zh 成对新增 40 个分层文案 key，删除 7 个弃用 key（editCustomModel / addCustomModel / presets / presetCustom / providerAdvanced / atLeastOneModel / noCustomModels / customHeadersHelp）。
  6. `tests/frontend/custom-providers-tab.test.ts`（新增，13 用例）+ `tests/frontend/settings-workspace-react.test.ts`（密码字段契约路径改指 connection-section.tsx）。
  7. `docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/routes/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：`npx vitest run tests/frontend/custom-providers-tab.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/css-architecture.test.ts tests/frontend/i18n-language-snapshot.test.ts` 全过；`npm run test` 399 files / 4684 tests 全过（31 个 `Cannot find package 'jsdom'` Unhandled Error 为存量环境缺失，jsdom 已声明未安装）；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。

- Notes（同日视觉打磨）：协议分段控件整行铺满、等分两段、`white-space: nowrap` 根除换行，字号 0.9375rem→0.8125rem、总高收到 2.25rem 与输入框对齐；协议独占连接网格整行（名称/Base URL 两列）；密钥行改「标题行/说明行/编辑行」三段纵排，标题与操作按钮同行对齐；模型行能力徽标取消 `.quickforge-settings-meta` 默认 margin-top（原先把 chips 顶歪 8px）并加 min-height 统一行高；模型 ID 0.78125→0.8125rem、规格 0.65625→0.6875rem 统一字号刻度；列表/详情头部协议徽标改短标签（OpenAI / Anthropic，`protocolShortLabel`），列表 meta 合并为单行。tsc / eslint / 18 目标用例 / `npm run build` 全过。

  - 跟进（2026-10-27）：草稿提供商删除补二次确认（`confirmDiscardDraft` 破坏性确认，取消保留草稿）；已保存提供商删除的确认原有。新增 1 个测试用例（14/14 全过）。

  - 跟进 2：主从卡片改固定高度（桌面 34rem / 窄屏 28rem，列表与详情卡内各自滚动，页面高度不随模型数变化）；新增「上次最后访问的提供商」记忆（localStorage `quickforge:custom-providers:last-selected:v1`，id 优先/名称兜底恢复，深链优先，草稿不写入，恢复时不自动展开窄屏抽屉）。测试 15/15 全过。

  - 跟进 3（参考用户截图样式）：连接层改为全宽竖排表单——名称 / Base URL / API 格式（`SettingsSelect` 下拉，选项带端点说明 `Chat Completions (/chat/completions)` / `Anthropic Messages (/v1/messages)`）/ API Key（常驻密码框 + 行内眼睛切换 + 状态徽标 + 「清除密钥」即时生效）；密钥输入计入连接层脏状态、随「保存连接」落库（留空保留现有密钥）；移除密钥卡片与「更换/保存密钥」流程及 protocolType 分段控件。测试 15/15、tsc / eslint / build 全过。

  - 跟进 4：每个模型行新增一键连通性测试图标（闪电 = 待测 / 旋转 = 测试中 / ✓ ✗ 徽标 = 结果，错误详情放 title 提示），用已保存的模型配置直接探测、无需展开编辑；展开编辑区里的「测试此模型」保留用于测试未保存的草稿参数。`ModelRow` 导出并补 1 个行内测试用例（16/16 全过）。

  - 跟进 8（2026-10-27，修复「查看 API Key」看不到内容）：已保存的密钥从不回填输入框（`keyValue` 初值空串），点眼睛只是切换一个空输入框的 type，所以看不到任何内容。改为按需读取：`ConnectionSection` 新增 `onRevealKey`，首次点眼睛时调用（编排器 `revealKey` 读 `provider-keys`，兜底 `provider.apiKey`），明文只进本地 state；新增 `keyFromStore` 标记，回显内容不计入连接层脏状态、保存时按「留空保留现有密钥」提交；占位文案在已配置且未回显时提示 `storedKeyHiddenHint`（中英成对）；读取期间按钮 disabled。新增 1 个用例（reveal-on-demand：明文可见、脏标记不出现、二次点击不重复读取），16/16 全过；tsc / lint / build 全过。

  - 跟进 7（2026-10-27，卡片高度跟视口）：`quickforge-providers-card` 从固定 `height: 34rem` 改为 `height: max(34rem, min(52rem, calc(100vh - 13rem)))`——桌面 34rem 起、最多 52rem、且始终给页面头尾留约 13rem，大屏能看到更多模型行，小屏不出视口；窄屏抽屉同步 `max(28rem, min(52rem, calc(100vh - 11rem)))`。列表与详情仍在卡内各自滚动，页面高度不随模型数变化。定向测试 20 项、`npm run lint`、`npm run build` 全过。

  - 跟进 6（2026-10-27，模型行开关尺寸收敛）：模型行「在选择器中显示」开关原用全局 3.125×1.75rem 轨道，比同行 1.875rem 图标按钮大一圈，且在窄列被 flex 压缩后滑块 `translateX(1.375rem)` 溢出轨道、显示不全。改为行内局部覆盖：轨道 2.25×1.25rem、滑块 0.875rem / 位移 1rem、`flex: 0 0 auto` 禁压缩；行本身 `min-height` 2.5→2.75rem、上下 padding 0.5→0.4375rem（行高由最高控件 1.875rem 撑开）。`tests/frontend/css-architecture.test.ts` 5 + `custom-providers-tab.test.ts` 15 全过；`npm run lint` 0 error；`npm run build` 成功。

  - 跟进 5（2026-10-27，删除连接分区头部行）：连接层顶部的「连接」标题行 + 右侧「测试连接」按钮整行删除（模型行已有逐模型测试，provider 级测试冗余）；表单直接贴在详情卡顶部。连带清理 provider 级测试死链：`CustomProvidersSettingsTab` 去 `testStates` / `IDLE_TEST` / `testProvider` / `rowTestStatus`，`ConnectionSection` 去 `testState` / `onTest` 与结果提示，`ProviderDetailPane` 去 `testBadge` 与 `testState`，`ProviderListPane` 去 `ProviderTestStatus` / `statusBadge` / `testStatus`；服务端删除 `POST /api/models/provider-test`（`provider-discover` 保留，复用同一 `fetchProviderModelIds`）；i18n 删除成对死 key `testConnection` / `testRequiresBaseUrl`（`connectionOk` / `connectionFailed` / `testingConnection` / `connectionSection` 仍被模型行复用，保留）。测试删去 provider 级测试用例，其余 15/15 全过；tsc / eslint / `npm run lint` / `npm run build` 全过。

- Notes：存储仍为 `custom-providers` + `provider-keys`（密钥按提供商名）；连接层保存语义 = 读-改-写整个提供商（协议/请求头下发到全部模型）并迁移改名密钥，密钥独立保存只写两个存储不触碰模型；草稿提供商（预设创建）在本地保存连接时落库。`customProviders` 深链从「打开编辑表单」改为「选中列表项」。工作区有并行会话（ask-user-echo-fix）在同文件 `src/lib/i18n.ts` 作业，本次 i18n 改动均为 provider 区块内成对增删，无交叉。

## ask-user-echo-fix（done，2026-10-26）

- Goal：修复 ask_user 工具「最后补充的问题/内容不回显」——回执行把选项与自定义补充合并成一行裸文本、跳过态丢失补充信息、待答卡无「已填写」指示、中文输入法 Enter 被当作下一问。
- 结论（一句话）：回执改为「选项 chip + 独立补充段」两段语义，跳过/超时（`answers: null`）也渲染回执并保留 `remark`，待答卡补充框显示已填写徽标并预展开，Enter 增加 IME 守卫。
- 改动文件：
  1. `src/components/chat/panel-decoration/ask-user-card.ts`（新增 `splitAskAnswer` / `renderReviewAnswer`、已填写徽标与预展开、`e.isComposing` 守卫）
  2. `src/lib/tool-renderers/ask-user-tool-renderer.tsx`（容忍 `answers: null`、`reviewRemark` 不再排除 skipped、分段渲染）
  3. `src/styles/chat/interaction-cards.css`（answer 分段与跳过态样式）
  4. `src/lib/i18n.ts`（新增 `askUserExtraLabel` / `askUserNoChoiceLabel` / `askUserFilledHint`，en + zh）
  5. `tests/frontend/ask-user-card.test.ts`、`tests/frontend/ask-user-renderer-remark.test.ts`
  6. `docs/design/ask-user-echo-fix.html`（方案设计稿）
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`
- 验证 / Evidence：`npx vitest run tests/frontend/ask-user-card.test.ts tests/frontend/ask-user-renderer-remark.test.ts` → 36 passed（28 + 8）；ask_user 回归面（含 server 侧 4 个测试文件）6 files / 103 tests passed；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。
- Notes：验证期间工作区存在并行的 CustomProviders 重构（`src/components/settings/custom-providers/`、`server/routes/models.mjs` 等），曾导致 build/test 瞬时失败；延时等待确认收敛后重新验证通过。提交时按文件隔离，`src/lib/i18n.ts` 只暂存 ask_user 相关的 2 个 hunk。`buildAskAnswerText` 死代码已随本次清理删除（回执与历史回显统一走 `splitAskAnswer`）。

## skills-settings-redesign（done，2026-10-26）

- Goal：重构设置页「技能」列表，让技能可扫、可筛选、可批量管理；最终交互按用户反馈定为「点击行打开居中详情弹窗」，不再使用右侧常驻详情栏。
- 结论（一句话）：`SkillsManagerPanel` 已重写为全宽筛选/来源分组列表 + 详情弹窗，保留 `/api/skills`、`/api/skills/content` 与全局/项目保存语义；宽窄屏、明暗主题与批量撤销均实机验证通过。
- 改动文件：
  1. `src/components/skills-dialog.tsx` — 重写技能管理面板：关键字/来源/状态筛选，按内置、个人（项目范围显示为项目）、插件分组；单行开关、筛选结果批量启用/停用与撤销 toast；重新扫描、搜索路径浮层与复制；点击行通过 portal 打开居中详情弹窗（概览/指令/元数据），`SKILL.md` 按需加载并以 markdown 渲染；保留串行保存队列、乐观更新、失败回滚和项目级 `SkillsDialog` 外壳。
  2. `src/styles/settings/skills.css`（新增）— 技能页布局、筛选工具条、分组吸顶头、行/开关、详情弹窗、markdown、toast、窄屏回退与 reduced-motion。
  3. `src/styles/index.css` — 在设置样式中登记 `skills.css`。
  4. `src/styles/settings/shell.css` — 新增 `quickforge-settings-stack-wide`（72rem），供列表型设置页使用。
  5. `src/lib/react-settings-tabs.tsx` — `SettingsPanel` 支持 `wide`，仅 Skills tab 启用；引入 `cn`。
  6. `src/lib/i18n.ts` — en/zh 同步新增技能页文案（筛选、批量、详情弹窗、元数据、搜索路径等），移除不再使用的详情占位文案。
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md` — 同步技能面板能力与新增样式模块。
  8. `docs/design/skills-settings-redesign.html` — 标注落地版将右侧详情改为点击行后的居中弹窗。
  9. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature 状态、验证与交接。
- 验证 / Evidence：
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.32s）。
  - `npx eslint src/components/skills-dialog.tsx src/lib/react-settings-tabs.tsx` → 无输出（0 error）。
  - `npm run lint` → 0 errors / 4 既有 warnings（`coverage/` 生成目录 3 个 unused disable + `usePinnedSummaryCapsule.tsx` exhaustive-deps，与本次无关）。
  - `npx vitest run tests/frontend/css-architecture.test.ts tests/frontend/motion-design.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 4 files / 43 tests passed。
  - `npm run test` → 398 个可运行测试文件全部通过（4664 passed / 1 skipped）；进程退出码为 1，原因是 31 个标注 `@vitest-environment jsdom` 的测试文件无法启动 fork worker：`Cannot find package 'jsdom'`。`jsdom` 已在 `package.json` devDependencies 中声明，但当前 `node_modules/jsdom` 未安装，属于环境缺失，与本次改动无关；未新增/升级依赖。
  - 实机视觉验证：使用隔离 `QUICKFORGE_DATA_DIR`/`QUICKFORGE_WORKSPACE_DIR` 启动 dev server，Headless Chrome 在 1440×900 与 900×900 下检查明/暗主题。页面宽度分别为 832px / 587px；详情弹窗 605px 宽、聚焦容器无多余 focus ring；筛选、来源菜单、指令 markdown、元数据、批量启用（1/4 → 4/4）与撤销（回到 1/4）均正常，浏览器控制台无错误。
- Notes：
  - 验证使用的示例技能只写入临时数据目录，没有触碰真实用户技能与配置；未创建 Git commit / tag / push，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`npm run build` 正常生成 `dist/`）。
  - 详情弹窗通过 `createPortal(document.body)` 渲染，避免项目级 `SkillsDialog` 的 `overflow-hidden` 与动画 transform 裁剪；关闭由 ESC、关闭按钮或点击遮罩触发。
  - 打开弹窗后焦点落在对话框容器（`tabIndex=-1`），Tab 可进入开关/标签页/操作按钮；未额外实现焦点陷阱。
  - 全量测试的 jsdom 缺失若需修复，应安装既有 devDependency（如 `npm install`），本次按“不新增/升级依赖”约束未处理。

## default-context-window-1m（done，2026-10-26）

- Goal：把 QuickForge 默认模型配置的上下文窗口从 200000 改为 1000000（1M）。只改默认值，不动 `modelId`，不加设置项，不重构无关代码。
- 结论（一句话）：`DEFAULT_CONNECTION.contextWindow` 由 `200000` 改为 `1000000`，所有回退点（`buildConnectionModel`、`CustomProvidersSettingsTab` 的模型表单默认/回退/保存归一化）自动跟随该常量，`maxTokens` 保持 `32768` 不变。
- 改动文件：
  1. `src/lib/pi-chat.ts` — `DEFAULT_CONNECTION.contextWindow: 200000 → 1000000`（单行 diff）。
  2. `progress.md` — 本条记录。
  3. `session-handoff.md` — 同步本次会话目标/改动/验证。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/settings-workspace-react.test.ts tests/frontend/side-chat-agent.test.ts tests/frontend/context-usage.test.ts` → 3 files / 36 tests passed。
  - `npm run lint` → 0 errors / 4 warnings（3 个 `coverage/` 生成目录 Unused eslint-disable + 1 个既有 `usePinnedSummaryCapsule.tsx` exhaustive-deps，均与本次改动无关）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.66s）。
- Notes：
  - 全仓库 `200000` / `200_000` grep 结论：无任何测试断言“默认值本身”，命中的都是无关常量或测试内联值，未做改动——`src/lib/auto-compact-settings.ts:48`（自动压缩 `minSourceChars` 上限）、`server/auto-compaction.mjs:44,237`（同上限 clamp）、`src/components/workspace/side-chat-agent.ts:9` + `server/routes/side-chat.mjs:12` + `server/routes/workspace-browser-service.mjs:30`（侧聊/搜索字符预算与行数护栏）、`tests/frontend/side-chat-agent.test.ts:16`（测试内联 `contextWindow: 100_000`）、`tests/frontend/settings-workspace-react.test.ts:21`（`DEFAULT_CONNECTION` 为 mock，`contextWindow: 128000`，与真实常量解耦）。`dist/`、`package-dist/`、`package-offline/`、`coverage/` 内的同名命中属生成产物，按约束未触碰。
  - `src/lib/i18n.ts` 只有 `contextWindow: 'Context Window'` 标签文案（en/zh 两处），没有写死 `200000` 或 “200K” 的表述，因此未改。
  - 遗留风险（未修改，仅记录）：`server/conversation-compaction.mjs:203-206` 的压缩 transcript 上限为 `Math.min(160000, Math.max(12000, Math.floor(contextWindow * 1.6)))`，即使 `contextWindow` 提升到 1M 也被 160000 字符硬顶，长会话压缩摘要的输入广度不会随 1M 窗口放大；另外 `maxTokens` 仍为 32768，1M 窗口下单次输出上限不变（本次按最小改动原则不动）。
  - 未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`；`feature_list.json` 当前为空（`{"features":[]}`），无对应 feature 条目，未改动。

## run-command-stop-button-inline（done，2026-10-29）

- Goal：运行中的 `run_command` 工具行，停止 icon 不再被顶到整行最右，而是从左到右紧跟摘要/箭头排列；向下展开日志时按钮也不能回到行尾。
- 结论（一句话）：本地工具卡改为「标题行 + 展开面板」两层——`.quickforge-tool-header` 只包 `<details><summary></details>` 和终止按钮，`.quickforge-tool-panel` 移到 details 外铺满整行，可见性由 `details[open]` 驱动。有按钮时标题行按内容收缩，按钮始终紧跟摘要末尾，展开/收起/超长命令都不会改变按钮位置。
- 改动文件：
  1. `src/lib/tool-renderers/local-workspace-tool-renderer.tsx` — 新增 `.quickforge-tool-header` 包装层，展开面板改为兄弟节点 `.quickforge-tool-panel`。
  2. `src/styles/chat/tool-summary.css` — 移除按钮绝对定位/行宽收紧规则，改为 header 收缩、按钮正常流式、面板 `:has(details[open])` 显隐。
  3. `src/styles/chat/tool-output.css` — 对话列宽约束补充 `.quickforge-tool-panel`。
  4. `tests/frontend/local-tool-running-sweep.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts` — 更新布局契约。
  5. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature 状态与验证。
- 验证 / Evidence：
  - `npx vitest run` 工具渲染器与 CSS 契约 8 个文件 → 187 passed。
  - `npx eslint src/lib/tool-renderers/local-workspace-tool-renderer.tsx tests/frontend/local-tool-running-sweep.test.ts tests/frontend/chat-surface-css-contract.test.ts` → 无输出。
  - `npm run build` → 成功（`tsc -b && vite build`）。
  - 真实渲染实测（复用 5176 dev server + 临时预览页，已删除）：收起态与展开态 header 均 200px（整行 624px），按钮距箭头 5px、位置不随展开变化；展开面板 624px；完成态无按钮、header 占满整行。
- Notes：
  - 面板移出 details 后不再依赖浏览器原生折叠内容槽，改由 `:has(details[open])` 控制显隐；开合记忆、键盘操作、chevron 旋转仍由原生 summary/details 承担。
  - 停止按钮仍在 `<summary>` 外（延续 `0c782f81` 的 nested-interactive 修复）；无按钮的普通工具行 header 仍占满整行，点击热区不变。
  - 未创建 Git commit / tag / push；未手工修改生成产物。

## render-memory-and-attachment-boundary（done，2026-10-29）

- Goal：按 P0–P3 消除浏览器打开 QuickForge 页面时的内存放大与卡顿，不改变交互；禁止打补丁。P0 流式链路、P1 首屏依赖与压缩、P2 有界窗口与快照、P3 附件传输边界一次做完。
- 结论（一句话）：流式帧只传一份消息且只缓存定稿内容；渲染窗口有界并按锚点驱逐；会话快照只存尾部 200 条；历史附件只传 `assetUrl`，字节按需读取并在客户端生成缩略图；首屏移除 `pi-ai`/xterm 并启用 br/gzip。
- 关键改动：
  1. `server/utils/sse-wire.mjs`（新）+ `routes/agent.mjs` / `routes/shared-conversation.mjs`：SSE `message_update` 删除 `assistantMessageEvent.partial`，50ms 合并不变；进程内事件不收敛，ACP/Goal/Hooks 不受影响。
  2. `MarkdownBlock` 增加 `finalized`（本行 `isStreaming` 传入）；`preprocessLatexDelimiters(content, cacheable)`；`highlightCode(..., { cache })`；流式不写 300/400 条中间缓存，`message_end` 写一次。
  3. `windowed-messages.ts` 增加 `WINDOW_MAX_TURNS=12` / `WINDOW_MAX_CHARS=160000`：向上翻页超限丢较新轮次，向下翻页超限丢较旧轮次；`ChatSurface.loadNewerMessages` 用 `readScrollAnchor`/`anchoredScrollTop` 补偿。
  4. `session-message-cache.ts` schema 2：仅尾部 200 条 + `windowOffset` + 服务端总数；IndexedDB 64MB 预算；`ServerAgent` 构建时切片、restore 缓存命中恢复 offset；旧 schema 直接 miss。
  5. `server/client-attachments.mjs` + `message-attachment-lookup.mjs` + `routes/message-attachments.mjs`：出站删除 `content`/`extractedText`、保留 ≤128KB `preview`、追加 `assetUrl`；新增 session/share 附件端点（`?raw=1` 字节 / 默认 JSON）；热会话扫内存、冷会话 `instr(message_json, JSON.stringify(id))`；作用于 state/restore/messages/rollback/SSE/view/shared。
  6. `attachment-client.ts` + `AttachmentTile` + `AttachmentOverlay` + `ChatTypes`：`content` 可选、`assetUrl` 新增；tile 用 160px canvas 生成 blob 缩略图（LRU 40，淘汰 revoke）；overlay 按需解析；`useChatActions` 回滚草稿与 fork 上传前解析附件；分享页回滚同样处理。
  7. `custom-model-selector.ts` 本地 `modelsAreEqual`；删除三个浏览器 agent 类上无消费的 `streamSimple`；`WorkspaceInspector` 内 `TerminalDock` lazy；`scripts/precompress-assets.mjs`（新）+ `server/routes/static.mjs` 协商 br/gzip；`package.json` build 末尾执行预压缩。
  8. 文档：新增 `docs/architecture/render-memory-and-attachment-boundary.zh-CN.md`，同步 `docs/wiki/README.md`、`docs/wiki/server/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`。
- 验证 / Evidence：
  - `npm run test` → 461 files / 5357 passed / 2 skipped（最后一次全量；随后仅改 test fixture 与附件 raw/preview 细节，定向测试全过）。
  - `npm run lint` → 0 problems；`npx tsc -b` → 0 错误；`npm run build` → 成功，`[precompress] 224 files: 12.66MB → 6.48MB`。
  - 首屏：`dist/index.html` preload 无 `pi-ai`/`xterm`；初始 JS/CSS 2.10MB 原始 / 0.53MB gzip（原 3.6MB 未压缩）。
  - 隔离实例浏览器实测（临时数据目录，已删除）：1000 条消息会话打开峰值从 125MB 降至可控（6 行 13k DOM，深滚受 12 轮上限约束）；图片会话 view 响应 2KB 且附件仅 `id/assetUrl`，tile 以 `?raw=1` 生成 blob 缩略图，overlay 正常显示。
- Notes / 已知取舍：
  - 深度上翻超过 12 轮后滚动条长度会变化（正文位置不变）；旧图片首次渲染可能先显示图片占位图标再换缩略图；首次打开终端多一次本地 chunk 加载。
  - 附件端点 `cache-control: immutable`，改了响应形状后旧浏览器缓存仍可能返回旧 JSON（多一个 `preview` 字段）；客户端解析不依赖它。未做 URL 版本化，避免为一个未消费字段引入缓存失效逻辑。
  - 未做 SSE delta 协议、增量 Markdown、虚拟列表库、DB 压缩；939MB 会话库与服务端 idle retention 属独立议题。
  - 未创建 Git commit/tag/push；`dist/` 由 build 产出，未手工修改。

## running-command-stop-button-alignment（done，2026-11-01）

- Goal：用户反馈「运行命令 tools 旁边的暂停按钮没对齐、不像上下居中」，评审确认后修复并推送。
- 结论（一句话）：根因是 `.quickforge-tool-header` 用 `align-items: flex-start` + `.quickforge-tool-actions` 硬编码 `margin-top: 0.0625rem`，而摘要行有 `min-height: 1.625rem`（26px）、按钮 `size-5`（20px）；正确补偿应是 3px，写 1px 导致按钮偏高约 2px，且随「消息字号」漂移。改为父级 `align-items: center` 并删除该 1px，对齐由真实行高推导。
- 关键点：
  - 无按钮的普通工具行视觉零变化：header 只有一个 `details` 子项时 `flex-start` 与 `center` 等价。
  - 摘要行是独立横向滚动容器（`overflow-x: auto`）且滚动条已隐藏，按钮锚在 header 上不再随命令长度漂移。
  - 同行的 chevron/状态图标/工具图标（14px，行内 `items-center`）与按钮现在共用同一条视觉轴（对齐 `DESIGN_LANGUAGE.md` 94–98「统一视觉轴」）。
- 验证 / Evidence：
  - 定向 `npx vitest run local-tool-running-sweep / chat-surface-css-contract / css-architecture` → 3 files / 51 tests 全绿。
  - 浏览器几何实测（vite dev + Playwright，注入同构 DOM）：修复前按钮中心比摘要行中心高 **1.88px**，修复后差 **0.01px**。
  - 全量 `npm run lint` / `npm run build` / `npm run test` 见下方 Evidence 记录。
- Notes / 已知取舍：
  - 顺带发现（本次未改，避免扩大范围）：该终止按钮缺 `rounded`/`focus-visible` 焦点环，与 `DESIGN_LANGUAGE.md` 278–284「图标按钮或状态点用全圆」不一致；点击区 20px 也小于常见 24px 触控目标。若要做，需单独评审按钮形态（全圆无背景时视觉变化需设计确认）。
  - `tests/frontend/local-tool-running-sweep.test.ts` 已补 `align-items: center` 与「actions 不得再有 margin」两条断言，防止硬编码补偿回归。

## nsis-uninstaller-icon-nonfatal（done，2026-11-02）

- Goal：用户升级安装 QuickForge 2.3.7 时停在「不能打开要写入的文件：`…\Programs\QuickForge\uninstallericon.ico`」对话框（中止/重试/忽略），要求消除这类卡死。
- 结论（一句话）：不是权限或文件损坏——安装包是 electron-builder 的 NSIS 安装器，`uninstallerIcon.ico` 是 `DisplayIcon` 用的 19KB 装饰文件，被 Windows 短时占用时原生 `File` 指令会弹 Abort/Retry/Ignore 并停住整个安装；改为 `File /nonfatal` 后写不进去就跳过、安装继续。
- 证据链：
  - 卡住的进程是 `desktop-dist-next\QuickForge Setup 2.3.7.exe`；报错文件仍是 7 月 2 日的旧 ico（本次未覆盖），目录内其余文件是上一轮 16:48 写入的。
  - `attrib` 显示该文件只有 `A`、无只读；`icacls` 当前用户为完全控制；独占写测试 `File.Open(Open,Write,None)` 通过；无 QuickForge/卸载器进程占用 → 排除只读/权限/长期占用，判定为写入瞬间的短时占用。
  - `%TEMP%\QuickForge-installer.log` 结尾：`customCheckAppRunning` 三次均「Main app not running」「All install-dir processes closed」，随后 `old uninstaller exit code = 2` → 走已有的覆盖安装自愈分支，之后无日志（停在图标写入）。
  - 模板位置：`node_modules/app-builder-lib/templates/nsis/installSection.nsh` 的 `!ifdef UNINSTALLER_ICON` 块，在 `SetOutPath $INSTDIR` 之后、`installApplicationFiles` 之前。
- 改动文件：
  1. `desktop/nsis-patch/apply.mjs` — 从单补丁改为补丁表（`patches` 数组）：保留 installUtil.nsh 旧卸载器 6 次失败不弹框，新增 installSection.nsh 的 `File /nonfatal /oname=uninstallerIcon.ico`；仍保持幂等、模板不匹配时报错退出。
  2. `docs/wiki/root-config.md` — 在 package.json 的 Desktop 脚本段落补 `nsis-patch` 的两条补丁与 `File /nonfatal` 行为。
  3. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature。
- 验证 / Evidence：
  - NSIS 3.04 语法验证：临时 `.nsi`（`File /nonfatal` + 后续 `File`）用 electron-builder 缓存里的 `makensis.exe` 编译通过。
  - 运行时验证：PowerShell 以 `FileShare.None` 独占锁住目标 `x.ico` 后静默运行测试安装器 → `INSTALLER-EXIT=0`、后续文件 `y.txt` 已写入、无对话框（证明 nonfatal 真的跳过并继续）。
  - `node desktop/nsis-patch/apply.mjs` 连续运行两次：首次打上 installSection.nsh 补丁，第二次全部 `already patched`（幂等）。
  - `npm run desktop:build:win` → 成功（91s）：`tsc -b && vite build` + `apply.mjs` + electron-builder 打包，产出 `desktop-dist\QuickForge Setup 2.3.7.exe`（116,429,804 字节，2026-11-02 20:45）与 portable 版，说明 patch 后的 NSIS 模板能正常编译。
  - `npm run lint` → 0 problems；`npx eslint desktop/nsis-patch/apply.mjs` → 无输出。
- Notes / 已知取舍：
  - 跳过写入时旧图标继续沿用，`DisplayIcon` 仍指向存在的文件；只有被占用的那一刻不更新图标，属于可接受降级。
  - 上游模板升级若改了 `!ifdef UNINSTALLER_ICON` 块，`apply.mjs` 会明确报错而不是静默跳过。
  - 未创建 Git commit；`desktop-dist` 由构建生成（`.gitignore` 已忽略），未手工修改生成产物。

## compaction-without-approval（done，2026-11-05）

- Goal：用户在评审后判断「压缩直接执行就行，不需要用户同意」，要求把自动上下文压缩的审批整条链删掉；明确不要节流、不要拒绝抑制、不要「整理中取消」，`/compact` 手动命令保留，其他改造（待办队列、暂停续跑）先不做。
- 结论（一句话）：压缩不删除任何历史（完整 transcript 仍在 `messages` 与界面里，缩小的只是发给模型的上下文），所以它不属于「需要授权」的动作——把它当审批处理，等于让用户批准一个他无法评估的决定，还会把一次回答卡住最长 5 分钟。
- 改动要点：
  1. `COMPACTION_NOTICE_PHASES` 只剩 `summarizing`；`maybeAutoCompactSession` 过阈值后直接进摘要阶段，`awaiting_confirmation` 与整段审批等待删除。
  2. 服务端删除：`AUTO_COMPACT_DECISION` / `normalizeDecision` / `confirmAutoCompact` 参数、`pendingAutoCompactApprovals` 队列、`createAutoCompactApprovalPromise()`、`approve-auto-compact` / `reject-auto-compact` 两个路由与对应导出、`getPendingAutoCompactApprovalForSession`、`getSessionState().pendingAutoCompactApproval` 投影、`lastAutoCompactAt` / `lastAutoCompactRejected`（只写不读）。
  3. 设置：`requireConfirmation` 从前端与服务端 normalizer 一起删，设置页那一行开关同步移除——**留一个不起作用的开关比没有更糟**；旧存储里的值读取时丢弃。
  4. 前端删除：`ContextCompactionDecisionRow` 整个组件、`onApproveCompaction` / `onRejectCompaction` / `compactionDecisionReadOnly` / `compactionDecisionDisabledReason` / `compactionApprovePending` / `compactionRejectPending` 整条 props 链、`pendingAutoCompactApproval` 状态与 6 处清理分支、`useAgentApprovalActions` 的两个 handler、SSE 白名单与订阅里的两个 approval 事件、i18n 9 个审批文案（中英各 9）。
  5. 压缩期间只显示「正在整理上下文」；不可单独取消（要停就停整个 run）。
- 验证：
  - 定向：压缩相关 10 个测试文件 78 例全过；`npx tsc -p tsconfig.app.json --noEmit` 通过。
  - `npm run lint` → 0 problems；`npm run build` → 通过。
  - `npm run test` → 502 files / 5536 passed / 3 failed / 1 skipped（3 个失败为既有基线：ACP workspace-mapping 2 + sqlite quick_check 1）。
- Notes / 已知取舍：
  - 不做节流：用户明确否掉。滚动压缩每次只喂「上一版摘要 + 增量」，输入很小、输出 4k 封顶，为「压缩后仍超阈值」的病态配置加状态属于过度设计；真出现时再从日志看出来。
  - 代价：删掉确认等于删掉唯一的人肉刹车，理论上病态配置下可能每步都压一次（多一次小请求）。这是接受的。
  - 设计稿清理（用户要求「和当前不一致的全部可以删除，临时 html 之类，不影响代码就行」）：
    - 删除 `docs/design/` 下**全部 31 份 html**。它们是设计阶段的可交互 mockup / 提案 / 前后对比稿（标题多为「预览」「原型」「提案」「评审」「修复前后」），落地后不再随实现更新，必然过时。其中 `compaction-as-message.html` 已先行核对出 6 处与最终实现冲突（插入点写「当前回合之前」而实现在压缩发生点末尾、`splice(tailStart,0,msg)` 而实现是 append、details 列 6 个字段而实现只写 `{version,kind}`、history「上限 20 条」而实际不设上限、落地计划含未做的幂等迁移与删 history、演示段还留着审批行）。
    - 只保留 `docs/design/per-compaction-records.zh-CN.md`（文字契约，与实现一致：history 不设上限、UI 不动、details 只有 `{version,kind}`）。
    - 同步清理 5 处指向已删文件的引用，避免死链：`docs/wiki/src/components/README.md`（goal 图标评审那句改成「评审结论已并入本节」）、`docs/architecture/conversation-trace.zh-CN.md`（删掉「交互原型」表格行）、`src/components/chat/panel-decoration/icons.ts` 与 `src/components/chat/surface/GoalControlStrip.tsx`（注释去掉文件名，说明本身保留）、`docs/design/per-compaction-records.zh-CN.md`（关联链接改为只指向 wiki）。
    - 历史日志（`progress.md` / `session-handoff.md` / `feature_list.json` 的旧 feature）里仍会出现这些路径——那是「当时改过什么」的时间线，不改写。
  - 未创建 Git commit；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## v2.4.1-只读审查 + 自动压缩 wiki 补全（done，2026-11-07）

- Goal：对 `v2.4.0..v2.4.1` 做只读代码审查（用户明确不改代码）；随后问「现在压缩会自动压缩么」，同意后把触发关卡补进 wiki。
- 结论（一句话）：自动压缩默认开启（`enabled: true` / `thresholdPercent: 80`，clamp 50–95），触发点在**每次模型请求前**（pi-agent-core `streamAssistantResponse` → `transformContext` → `maybeAutoCompactSession`），过 7 道短路关卡才压；与 v2.4.1 的改动无关，本次只改压缩后的用量口径。
- 改动：
  1. `docs/wiki/server/README.md` — `auto-compaction.mjs` 节新增「自动压缩触发关卡（每次模型请求前）」7 行表格（含每关的 `reason`）、「只有主会话 Agent 会自动压缩」（子 Agent / workflow / 后台 agent 无此 hook）、「压缩后不会立刻重压」（`sourceMessageCount` + `compactedAt` 让第 6 关必然拦下）、「已知口径不一致（第 6 关）」；并修正原文「除可压缩消息序列外没有其他保护性门槛」这句已不准确的表述。
  2. `progress.md` / `session-handoff.md` 记录审查结论与待办。
- 验证：定向 9 files / 235 passed；`npx eslint .` → 0 problems。未跑 `npm run build`（审查期不碰 `dist/`）。未改任何源码。
- Notes / 待办（按严重程度）：
  - **P1（较确定，回归）** `src/components/chat/surface/ChatSurface.tsx:120-140`：`prompt()` 改成内部 catch 后 `return false`，不再 reject，因此 HTTP 失败 / 409 写租约冲突 / 超时时 `catch` 不可达 → `restoreEditor` 不执行、`chatSendFailed` 不弹，`clearEditor()` 已清空输入框，用户草稿丢失（改动前两件事都会发生）。`tests/frontend/chat-surface-send.test.ts:192-213` 仍用 `mockRejectedValue` 断言回填，守的是一条生产中不可达的分支，所以绿灯是假安全。修法：判 `=== false` 回填 + 报错，`catch` 保留真异常，测试同步改。
  - **P2（待用户拍板）** `server/agent-manager.mjs:336-342` `memoryNoteTools` 无条件注册（对照 L332 `globalMemoryTool` 有 `isGlobalMemoryEnabled()`）；`server/working-memory.mjs:132-179` 的 list/read/write/move 都不看 `enabled`（默认 `false`）。即工作记忆关着，主 Agent 与子 Agent 仍可写 `~/.quickforge/working-memory`。加门禁需同时改 `agent-profile-schema.mjs` 能力策略与 `approval-store.mjs` 的 `safeReadTools`/`planAllowedTools`。
  - **P3（既有，已在 wiki 标注）** `server/auto-compaction.mjs:289-297` `hasNewMessagesSinceCompaction` 仍只认元数据，对 `/summary` 新建会话与 fork 压缩会话恒返回 `true`；`minimumProviderUsageIndex` 已改成按消息定界。两处应以 `lastCompactionMessageIndex(source)` 统一。
  - 低优先级：`syncCompactionIndex` 的 `summaryMessage ?? compaction.summaryMessage` 兜底（两个调用点都有 `compactionIndex >= 0` 守卫，暂无触发路径）；`src/lib/message-utils.ts:3` 反向 import 组件层（分层倒置）；`src/components/chat/panel-wiring/message-queue.ts:162-164` steer 的 `catch` 只打日志，与 `false` 分支的「暂停 + 持久化」不一致；`server/agent-session-events.mjs:121-132` 四个事件每帧全量 `estimateSessionContextUsage`；`server/session-utils.mjs` 的 `generateTitle`/`generateAiTitle` 未跳过压缩摘要消息（前端 `message-utils.ts` 已过滤，服务端未同步，属既有问题）。
  - 未创建 Git commit；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## v2.4.2 评审修复：unknown_usage / 未知用量归零 / ACP usage_update（done，2026-11-09）

- Goal：用户对 `v2.4.1..HEAD` 做只读评审后，点名处理三条：P2-2（用量未知被记成 `below_threshold`）、P3-1（`unavailable` 与百分比不自洽）、P3-3（ACP `usage_update` 从未推送）。
- 改动：
  1. `server/auto-compaction.mjs` — `maybeAutoCompactSession()` 在阈值判定失败时区分 `inputTokens <= 0`：返回 `unknown_usage`，其余仍是 `below_threshold`。判定口径与 `shouldCompactContextByPercent` 内部一致。
  2. `server/agent-manager.mjs` — `unknown_usage` 不按请求打 info（每次模型请求前都会命中，会刷屏），改为**首次**打一条 warn 并记 `session._unknownUsageWarningLogged`，直接点明「provider 没报 usage，自动压缩停用」。
  3. `src/components/chat/context-usage.ts` — `normalizeServerContextUsage()` 统一按 `isUnknown` 判定，未知时 `inputTokens` 与 `percent` 一起归零，消除「来源标未知、tooltip 里却挂着正数」的组合；同时导出该函数供测试直接调用。
  4. `server/acp/server.mjs` — `usage_update` 改读 `contextUsage.inputTokens` / `contextWindow`（ACP 要求 `used`/`size`，两个必填非负整数），并在无上报值时不推送；修复这条自 ACP 初始提交起就因字段名不存在而从未推送的死代码。
  5. 测试：`tests/server/auto-compaction-notice.test.mjs` 的「below the threshold」用例补上真实 usage（原用例其实构造的是无用量的未知态），新增 `unknown_usage` 用例；`tests/server/acp/server.test.mjs` 新增 `usage_update` 映射（含有值与无值两条）；`tests/frontend/context-usage.test.ts` 新增 unavailable 归零断言。
- 验证：`npx vitest run` 上述 6 个相关文件 → 6 files / 66 passed；`npx eslint` 改动文件 → 0 problems；`npx tsc -p tsconfig.app.json --noEmit` → 通过。
- 文档：`docs/wiki/server/README.md` 关卡表由 7 关改为 8 关（新增 `unknown_usage`，后续编号与正文引用同步调整），并在 ACP 章节补「上下文用量映射」一条。
- 未创建 Git commit；未触碰 `dist/`、`package-dist/`、`package-offline/`。


## surface-comment-archaeology-cleanup（done，2026-11-09）

- 起因：用户问「检查一下有没有大段的无用的代码注释」。只读扫描 `server/` `src/` `desktop/` `scripts/` `tests/` `plugins/` `bin/`（1185 个 `.mjs/.js/.cjs/.ts/.tsx/.jsx/.css`，约 2 万注释行）后，用户选择「压缩 chat/surface 的考古段落」。
- 扫描结论：被注释掉的死代码 **0** 处；`TODO/FIXME/HACK/XXX` **0** 处；注释掉的 CSS 规则 **0** 处（正则命中的 2 处经核验是解释层叠优先级 `@layer` 的有效注释）；≥40 行的超长注释块只有 4 个（`SessionViewPool.tsx` 63 行、`subagent-trace-structure.ts` 45 行、`MessageList.tsx` 40 行、`code-highlight.ts` 40 行），都在解释「为什么必须这么写」并带实测数据，属健康注释。
- 真正的问题只有一类：**迁移考古段落**——把已删除的旧实现（`panel-decoration/*` 的注入器、mini-lit `copy-button`、`<markdown-block>` / `<assistant-message>` 等自定义元素）怎么实现写成正文。严格口径（连续 ≥6 行且 ≥2 处历史表述）37 块 / 603 行；含关键词（`previously` / `legacy` / `removed` / `旧实现` / `已删除` 等）的注释块 218 块 / 2596 行；其中 17 条直接引用了**已不存在的文件**（`panel-decoration/reconnect-notice.ts`、`model-retry-notice.ts`、`unreachable-strip.ts`、`assistant-waiting-bubble.ts`、`composer-plus-menu.ts`、`code-blocks.ts`、`utils/format.ts`、`legacy utils/attachment-utils.ts`、`src/lib/todo-status.tsx`、`SKIP_LOCAL_PATH_SELECTOR`）。
- 改动（32 个文件，注释 166 增 / 244 删，净减 78 行；无一行运行时代码变化）：
  1. `src/components/chat/surface/`：`AssistantWaitingBubble` / `ComposerPlusMenu` / `ComposerAccessControls` / `ConnectionNotices` 文件头由「旧注入器怎么 prepend、怎么重建 innerHTML、怎么 setInterval」压缩成「现在是什么 + 不能改的约束」。
  2. 同类处理：`ChatSurface`（文件头 + send 流程）、`ChatTypes`（handle / props / 各 prop 注释里的 `legacy` 指向）、`MessageList` / `Markdown` / `MessageEditor` / `AssistantMessage` / `ToolMessage` / `ThinkingBlock` / `AttachmentOverlay` / `AttachmentTile` / `UsageBar` / `CodeBlock` / `ApiKeyPromptDialog` / `GoalControlStrip` / `surface-context` / `composer-store` / `attachment-loader` / `rehype-local-file-paths` / `render-key-index` / `index.ts`。
  3. `CodeBlock.tsx` 里引用已删除函数的段落（`closeSvgCodeBlockMenus(...)`、`showCopiedFeedback`、`code-blocks.ts semantics`）改为描述现在的事件互斥路径；`rehype-local-file-paths.ts` 删掉指向已不存在的 `SKIP_LOCAL_PATH_SELECTOR` 的说法。
  4. 5 个测试文件（`assistant-waiting-bubble` / `model-retry-notice` / `reconnect-notice` / `unreachable-strip` / `composer-plus-menu`）头部由旧控制器考古段改为「这些用例守的是什么」。
  5. `todo-write-tool-renderer.tsx` 与 `todo-write-renderer.test.ts` 里写成 `src/lib/todo-status.tsx` 的悬空路径改为真实存在的 `todo-status.ts` / `todo-status-icon.tsx`。
- 刻意保留（不删）：`SessionViewPool.tsx` 63 行、`subagent-trace-structure.ts` 45 行、`MessageList.tsx` 40 行、`ChatSurface.tsx` 的 React/DOM 所有权边界块，以及 bridge 元素属性（`message` / `isStreaming` / `tool` / `toolCall` / `result` / `pending` / `aborted`）、CSS 类名与 data 属性、`<details>` toggle 参与互斥这类**仍然有效的约束**——它们解释的是现在为什么不能那样改。
- Evidence（验证）：`npx eslint src/components/chat/surface src/lib/tool-renderers` + 5 个改动测试文件 → 0 problems；`npx vitest run` 8 个相关文件（assistant-waiting-bubble 18、model-retry-notice 12、reconnect-notice 20、unreachable-strip 14、composer-plus-menu 9、todo-write-renderer 11、chat-code-block 45、chat-surface-css-contract 37）→ **8 files / 166 passed**；`git diff` 逐行核对，除工作区里他人既有的 `tests/frontend/context-usage.test.ts` 改动外，本次全部落在注释行。未跑全量 `npm run test` / `npm run build`（纯注释改动）。
- Notes：
  - 剩余 4 条「注释引用的文件找不到」是**有意保留**的：`katex/dist/katex.min.css` 与 `highlight.js` 是 npm 包（在 `node_modules` 里），`package-dist/dist/assets/index-B1G0LqYR.css` 是 CSS 契约测试的「旧产物基线」，两处注释在解释白名单来源，删了反而看不懂。
  - 未触碰 `src/styles/`、`server/`、`desktop/` 的考古段落（本次范围限定在 `chat/surface` 及其测试）；`server/` 侧同样存在「旧实现」叙述（`src/lib/server-agent.ts` 27 处、`server/storage.mjs` 15 处），如果后续要统一，可照同样的口径再做一轮。
  - 未创建 Git commit；未触碰 `dist/`、`package-dist/`、`package-offline/`。
  - wiki 无需更新：本次只改注释文字，未改模块职责、公共入口或发布流程。

## v2.4.2 评审修复（续）：判定收敛为 evaluateContextCompactionGate（done，2026-11-09）

- 起因：自查上一批改动时发现，「窗口是否可用 / 用量是否可用 / 是否过阈值」三个同属上下文口径的判断被拆在两个文件里——`context-usage.mjs` 内部本来就有 `if (!contextWindow)` 和 `if (inputTokens <= 0)`，`auto-compaction.mjs` 又按 token 数重推了一遍。boolean 返回值把「为什么」丢了，才逼调用方二次推断；而这正是 `below_threshold` 盖住 `unknown_usage` 的根因。
- 结论：按「架构最优」做了小重构，不是打补丁。`shouldCompactContextByPercent()` → `evaluateContextCompactionGate(usage, thresholdPercent)`，返回 `{ shouldCompact, reason }`，reason 取 `missing_context_window` / `unknown_usage` / `below_threshold` / `null`。`maybeAutoCompactSession()` 只透传 reason，第 4–6 关合并为一次调用。
- 刻意没做的事：没有把关卡表驱动化。8 关的 `if` 链可读性很好，抽成数组反而难读——该收敛的是「判定与原因」，不是「流程编排」。
- 波及面（改名前已核实）：生产仅 1 个调用点（`auto-compaction.mjs`），测试仅 1 处直接断言，未在 `server/public-api.mjs` 导出；旧函数已删除，全仓 grep 无残留。
- 测试：`tests/server/context-usage.test.mjs` 改为断言结构化结果，并新增 below_threshold / 跨过阈值 / missing_context_window 三条用例；相关 6 个文件 69 例全过；改动文件 `npx eslint` 0 problems、`npx tsc -p tsconfig.app.json --noEmit` 通过。
- 文档：`docs/wiki/server/README.md` 第 4–6 关的归属、函数名与「不再二次推断」的原因同步更新。
- 已知未覆盖：「只 warn 一次」的防刷屏逻辑没有单测——把它抽成导出函数只为测试会破坏设计，取舍是记录在案、改该分支时手工确认为一次性。
- 未创建 Git commit；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## dead-code-cleanup-2026-11（done，2026-11-09）

- 起因：用户要求「全面查看一下有无僵尸代码和上帝模块」。只读扫描 `server/` `src/` `desktop/` `bin/` `scripts/` `plugins/`（672 个源文件、约 14.4 万行），分文件级引用、符号级引用、上帝模块三条线推进。
- 扫描结论（僵尸代码侧）：**非常干净**。`npx eslint .` 全仓 0 warnings（`noUnusedLocals` / `noUnusedParameters` 已开，局部死变量藏不住）；注释掉的死代码块 0 处；`TODO/FIXME/HACK` 0 处；挂着的依赖全部有实际 import（`@vscode/os-proxy-resolver` 是 `network-proxy.mjs:129` 的动态 `import()`）。所以残留的只有「导出但没人 import」这一层 lint 检查不到的东西。
- 真正删掉的 5 项：
  1. `server/provider-config.mjs` — 整份 78 行全仓零引用，源码/测试/文档/脚本都没提过。是上一轮清理（见 `docs/archive/feature-list-archive.json`）漏网的一个。
  2. `server/experiences.mjs` 的 `archiveExperience` / `getExperiencesRevision` / `snapshotExperiences` — 三个零调用导出。动手前核实过真实路径：归档走 `move_memory_note` → `moveNoteFile`（`archiveExperience` 只是 `moveExperience` 到 `_archive/` 的包装）；快照走 `server/dreaming/snapshot.mjs` 里自己的 `copyNoteDir` 调用，完全绕过 `snapshotExperiences`。
  3. `server/plugins/ui-schema.mjs` 的 `summarizeUiContribution` — 注释写「used by the plugins page and the audit log」，全仓 grep 零调用，注释本身就是过时的。
  4. `server/agent-session-lease.mjs` 的 `sessionLeaseStore` — 注释写「测试/诊断用」，但测试也没用。
  5. 根目录 `!ids.includes(i))` — 0 字节，11月4日就在了，是某次 shell 重定向写错的残留（文件名本身就是一个 JS 表达式碎片）。
- 级联清理：删 `getExperiencesRevision` 让 `createHash` 变成孤儿 import，删 `snapshotExperiences` 让 `copyNoteDir` 变成孤儿 import，两个一并移除；`fs` / `path` 仍在用，保留。
- 文档同步：`docs/wiki/server/README.md` 里「`getExperiencesRevision()` 供将来的热更新比较用」这半句删除——正是「为将来预留」但从未实现的典型。
- 确认保留的「假孤儿」（扫描会误报，下次别再删）：`restart-supervisor.mjs` / `update-supervisor.mjs`（`index.mjs` 用文件路径字符串 spawn）、`agent-workflow-worker.mjs` / `sqlite/session-state-worker.mjs`（`new Worker(new URL(...))`）、`server/maintenance/export-*-v1.mjs` 与 `downgrade-session-state-v1.mjs`（文档写明的应急逃生通道）、`plugins/*/plugin.json`（动态加载）、`public/sw.js`（`main.tsx:58` 注册）、`scripts/*`（package.json 调用）。
- Evidence（验证）：定向 `npx vitest run` 8 files / **93 passed**（`plugins/ui-schema`、`plugins/hello-ui-example`、`session-lease`、`memory-notes`、`dreaming`、`dreaming-snapshot`、`dreaming-runner`、`dreaming-curator-agent`）；`npx eslint . --no-warn-ignored` → **0 problems**；全量 `npx vitest run` → 500 files / 5564 passed、**3 failed**。这 3 个失败用 `git worktree add /tmp/qf-baseline HEAD --detach` 在干净基线（46d1650c）复跑，**同样失败**，证实是既有问题（`acp/server.mjs` 的 `setActiveProjectPath` 返回 undefined 2 例、`sqlite-quick-check-gate` 缓存语义 1 例），且两个失败测试文件都不引用本次改动的模块。worktree 用后已 `remove` + `prune`，主工作区 `node_modules` 完好。
- 上帝模块清单已落为 feature `god-module-decomposition`（pending），不另开文档：真上帝模块 7 处 + 中等 3 处，首要目标是 `server/routes/scheduled-tasks.mjs`（扇入仅 1）。同时明确记录**不要动**的长文件：`i18n.ts` / `code-highlight.ts`（数据表）、`process-folding.ts` / `ChatSidebar.tsx` / `storage.mjs`（职责单一）。
- Notes：
  - `server/agent-goal-runner.mjs`（1599 行）经确认 **不是死代码**：`resolveGoalEngine()` 对没有 `goalEngine === 'v2'` 标记的会话仍回退到 legacy 引擎，属技术债而非僵尸；真要处理应是「退役 legacy 引擎」而不是「删除死代码」。
  - 顺手观察到但不属于本 feature 的问题：`server/acp/server.mjs`、`server/session-state-backup.mjs` 等工作区里他人未提交的改动，正是上面 3 个既有失败的来源，未介入。
  - 未创建 Git commit；未触碰 `dist/`、`package-dist/`、`package-offline/`。

## experience-general-axis-2026-11-10（done，2026-11-10）

- 起因：用户问「经验库是不是只有候选技能一个标签，能不能加通用 / 特殊这类标签，兼容通用性和泛用、防止过拟合」。第一版设计给成了三档 + 两个正文槽位 + 三条防腐检查，被「你不要理解偏了」打回——这是一条二元轴，不是一套工作流。
- 定稿：文件头改 YAML front matter（`title` / `description` / `general` / `candidate_skill`），索引只留文件名，`general: false` 的行尾加 `（特殊）`，`candidate_skill: true` 必须 `general: true`。
- 复用了 `server/frontmatter.mjs`（原本给 agent profile 用的手写子集解析器），没有引依赖。它同时兼容全角冒号与坏头部：解析不到 head 就当没有，不抛错。
- 索引去掉 `—— 何时用` 的依据：文件名本来就是结论句，`description` 再抄一遍是同一句话付两次钱。按最宽一行算，200 行约 1.4 万字符，先撞到的是行数上限而不是字符上限，所以两个上限的先后关系变了（原注释假设「两个上限差不多同时用完」）。
- `candidate_skill` 与 `general` 的与运算写在 `experienceMetaOf()` 里，不靠提示词自觉。副作用：迁移后 5 个 ★ 掉到 3 个——`清理僵尸代码先证死再动手`、`审查本机桌面 Web 应用` 的正文里有点名本项目的路径（`src server`、`routes/*.mjs`、`public/sw.js`），按规则属特殊，★ 取消。想拿回 ★ 就得先把步骤改写成不绑项目的版本。
- 迁移：22 篇一次性处理，先整目录快照到 `~/.quickforge/_backups/experiences-20261110-174028` 并 `diff -rq` 校验；`general` 逐篇人工判定写成清单，脚本对清单外的文件直接 `sys.exit`，不猜。第一次跑被自己写的一致性守卫拦下（两篇的 `# 标题` 与文件名只差措辞，其中一篇是文件名不能带引号导致的），改成「以文件名为准、打印被退休的旧标题」后再跑。
- Evidence（验证）：`npm run test` → 504 files / 5575 passed、4 failed；3 个失败用 `git worktree` 在干净 HEAD 复跑同样失败（既有基线），第 4 个是本次引入的（`dreaming-curator-agent` 沉淀用例还断言着旧的 `—— 动 config 目录前`），已修。`npm run lint` → 0 problems；`npm run build` → 通过。worktree 用后已 remove。
- Notes：
  - 没给经验加「项目 id」。「（特殊）」只是提示，特殊条目仍然会出现在别的项目的索引里；真要按项目过滤得给笔记加字段并让索引按当前项目筛，是另一件事。
  - 迁移只搬格式，没改写任何一条经验的正文办法；三篇原本没有「何时用」bullet 的，`description` 取自它们自己的「症状」段。
  - 未创建 Git commit、未推送。

### 自评审补修（用户要求「自己评审一下」）

- 拿边界输入实测，不是读代码猜，找出三处，都已补修并加测试：
  - **`general: 否` 被静默读成 `true`（最严重）**。`firstOptionalBoolean` 只认 `true` / `false` 字符串，`否` 不匹配 → `undefined` → 回落默认 `true`。整理员是全中文写手，想标「特殊」最自然的写法就是「否」，结果索引里没有 `（特殊）`，下个会话照着绑死本项目的流程硬套——正是这条轴要防的错，被它自己破了。修法：经验层加本地 `flagOf`（认 `否/no/off/0` 与 `是/yes/on/1`），**不动**共用的 `firstOptionalBoolean`（agent profile 还在用，那个契约应保持严格 YAML 布尔）。
  - **`candidate_skill: true` + `general: false` 被静默丢弃**。文件说「我是技能候选」，系统算出 false，磁盘和界面各说一套且无任何提示。改成 `writeExperience` 直接拒绝（和 title 不一致同样处理）；读取时的与运算降级为「手改文件的兜底」，不再是正常路径。
  - **`MAX_EXPERIENCE_INDEX_CHARS` 的注释说谎**。文档改了、代码注释还写着「两个上限差不多同时用完」；实际 200 行 × ~68 字符 ≈ 14k，字符上限不可触发。改成说明「在当前两个上限下不可触发，留着是因为它约束的是一条每轮都注入的字符串」，并补回字符上限分支的测试（用手工构造的超长标题驱动，因为真实文件名上限 60 字符走不到）。
- 顺手补的文案：设置页经验库说明里加一句「带『特殊』标记的经验只对某个项目或场景成立，专有的名字要先换掉」——否则第一次看到 badge 的人不知道那是什么。
- 已知未修（已写进 feature boundaries）：`description` 里的 ` #` 会被 `parseYamlScalar` 当行内注释截断（只影响设置页那一行显示，靠提示词要求加引号，写入层无法回推原值所以不做校验）；`（特殊）` 只是提示不是过滤，特殊条目仍出现在所有项目的索引里；每篇笔记的 front matter 被解析三次（22 篇无感，200 篇也就 600 次正则）。
- 最终验证：`npm run test` → 504 files / 5583 tests，5579 passed、3 failed、1 skipped（3 个失败为既有基线）；`npm run lint` → 0 problems；`npm run build` → 通过；`tests/server/memory-notes.test.mjs` 22 passed。

## quickforge-api-skill（done，2026-11-10）

- 起因：用户要「一个内置 skill 驱动 QuickForge 本地 API，让 Agent 自己操作自己」。我给了三档取舍（只读 / 加身份注入 / 再加受限工具）和三个能力档位，用户没回答就超时了，按推荐项落地：方案 B + 能力档位 3 + 升级默认 marker。这个默认选择已写进 feature 的 boundaries，回退成本很低。
- 调研（explore 只读）结论三条，决定了设计形状：① 本地 API 已闭环，`sessionId` 由调用方生成，所以「创建 → prompt → 读消息 → abort」用 HTTP 就能走通；② 但 Agent **不知道自己是谁**——系统提示词只给项目名/路径/项目 id，拿不到自己的 `sessionId`，也不知道端口，而且内置工具里没有任何一个能发 HTTP（只能 `run_command` + curl，会走审批）；③ 给自己发 prompt 必然 409 `GENERATION_ALREADY_RUNNING`，所以「自己操作自己」不能设计成自我对话循环。
- 改动：新增 `server/runtime-info.mjs`（进程内记 `{host,port,baseUrl}`，**不落盘**，并提供 `buildChildProcessEnv`）；`server/index.mjs` 在 listen 回调 `setRuntimeInfo()`；`toolRunCommand` 的 spawn 传 `env: buildChildProcessEnv(context)`，注入 `QUICKFORGE_API_BASE` / `QUICKFORGE_SESSION_ID` / `QUICKFORGE_PROJECT_ID` / `QUICKFORGE_WORKSPACE_ROOT`。新增内置 skill `skills/quickforge-api/`：`SKILL.md`（命令表 + 红线 + 报错对照 + 配方）、零依赖 `scripts/qf-api.mjs`（15 个子命令）、`references/endpoints.md`。`defaultGlobalSkillNames` 加 `quickforge-api`，marker 从 `.default-skills-v1` 升到 `-v2`（不升的话 v1 marker 已存在，存量安装永远看不到新 skill）。
- 安全取舍：本机回环即认证（`access-policy.mjs` 里 `isLocalRequest === true` 直接放行），所以**没做通用 HTTP 工具**，而是每个子命令映射一个写死端点，明确不给 `DELETE /api/agents/*`、`access-mode`/`yolo-mode`、`lan-access`、`terminal`、`backup`、`plugins`、`mcp`，也不订阅会话级 SSE（单连接，抢了会把用户页面踢掉，改成轮询 `status`）。这三条边界同时写进 SKILL.md 的红线和测试里的正文黑名单断言。
- 踩到的坑（值得记）：`~/.quickforge/quickforge.pid` 是陈旧的（文件里 54436，真实进程 69209，应用内重启不更新它）。我第一版把它当硬校验，结果端口探测明明有服务却报「找不到」。改成「pid 匹配 > 同数据目录 > 唯一可用实例」的优先级排序，pid 不匹配只作为 `whoami` 的 warning。教训：pid 文件只能当提示，不能当门槛。
- 第二个坑：`/api/agents` 的列表项比 `/api/agents/:id/status` 窄（`listSessions` 只有 sessionId/scope/status/title/source），我一开始复用 status 的映射函数，冒烟时看到 `projectId: null`、`messageCount: null` 才发现。现在两个命令各用自己的映射，并在代码里写了注释。
- Evidence（验证）：`npx vitest run tests/server` → 212 files / 2259 tests，2255 passed、3 failed、1 skipped；3 个失败是既有基线（acp workspace-mapping 2 例 + sqlite-quick-check-gate 1 例），单跑 `sqlite-quick-check-gate` 仍 1 failed，且都不引用本次改动模块。定向 `runtime-info.test.mjs` + `skills.test.mjs` → 14 passed（含真的 spawn 子进程读三个环境变量的端到端断言）。`npx eslint` 7 个改动文件 → 0 problems。`npm run build` → 通过。手工冒烟（运行实例 5176）：`whoami` / `agents` / `sessions` / `skills` / `instructions` 全部返回预期结构。
- Notes：
  - **运行中的实例必须重启**才生效：注入逻辑和默认启用都在服务端。本会话里 `env | grep QUICKFORGE` 就没有 `SESSION_ID`（跑的还是旧进程），这也顺带证明了端口探测兜底是必要的。
  - 没写 `references/recipes.md`：配方直接放在 `SKILL.md` 里了，同一个场景写两处就是同一句话付两次钱。
  - 未创建 Git commit、未推送；工作区里仍有其他会话未提交的改动（`agent-profiles`、`ChatSurface`、`auto-compaction` 等），提交时要分组。
  - 调研时顺手发现但没动的两处：`server/system-prompt.mjs` 开启工作记忆时会注入两个 `<working_memory>` 块（重复段，真实缺陷）；`getSessionStatus` 之外的 agent 自省目前只有环境变量这条路，如果以后要「免审批只读自省」，更合适的是加一个只读工具而不是放宽 `run_command` 的审批。
- 自评审（只读、按 P0–P3 分级）：**1 个 P1、3 个 P2、4 个 P3，无 P0**。
  - **P1（已修）**：marker 升到 v2 时重放了整份默认名单，会把用户手动取消过的旧默认（`plugin-creator`）重新打开。本机实锤：v1 marker 在（8 月 26 日），`~/.quickforge/config/projects.json` 的 `globalSkills` 只有 `['skill-creator']`——重启必然被改成三项。修法：新增 `defaultSkillsIntroducedInV2 = ['quickforge-api']`，v1 marker 存在时只补它；`tests/server/skills.test.mjs` 补一条存量回归用例 → 5 passed。
  - P2 三条 + P3 四条 + 一条 Windows 待确认风险已写进 feature 的 boundaries，**未修**（用户只要求先修 P1）。
  - 评审没改任何代码：先读 `ensureDefaultGlobalSkills`、`toolRunCommand` 的 spawn 点、`projectContext` 的字段来源、`message.content` 的实际形态（可能是 block 数组），再用真实配置文件验证 P1 不是理论问题。
- 后续（用户当场提要求）：`spawn` 出的子会话要「默认开全部权限」并且「用当前的思考等级」。
  - 改 `skills/quickforge-api/scripts/qf-api.mjs`：新增 `--access-mode default|full-access`（白名单，默认 `full-access`）；`--thinking` 不传时读自己的 `/state` 继承思考档，返回值多一个 `thinkingSource`（inherited / flag / fallback）；`show` 补返回 `accessMode` 便于复核服务端真实状态。
  - 边界没松：整段放开请求体仍然禁止，白名单之外的值直接报错；**已存在**会话的 `/access-mode` 依然没有子命令。SKILL.md 红线 3/4 与 `references/endpoints.md` 同步了这条唯一的例外。
  - `--model` 仍是死参数（服务端 `normalizeModelReference` 要 `{source,providerId,modelId}` 对象，脚本传字符串 → 400），用户决定不修，子会话沿用默认模型。
  - Evidence：实测三例 —— 不传参数 → `accessMode: full-access` / `thinkingLevel: xhigh` / `thinkingSource: inherited`；`--access-mode default --thinking low` → 两者都被覆盖；`--access-mode yolo` → 直接拒绝且不建会话。`show` 复核服务端确认落盘值一致。真派了一个活（跑 `node -v`/`pwd`），2 秒内 idle、5 条消息，没有被审批卡住。
  - 验证坑：`tests/server/runtime-info.test.mjs` 断言 `process.env.QUICKFORGE_SESSION_ID` 是 undefined，在会话里直接跑必然假失败；要 `env -u QUICKFORGE_SESSION_ID -u QUICKFORGE_PROJECT_ID -u QUICKFORGE_API_BASE -u QUICKFORGE_WORKSPACE_ROOT npx vitest run …` → 10 passed。定向 `npx eslint skills/quickforge-api/scripts/qf-api.mjs` → 0 problems。

## frontmatter-title-follows-rename（done，2026-11-10）

- 起因：审查 `0a0b0905` 时报的 P1，用户只挑了这一条要求修。`writeNoteFile` 新增「front matter `title` 必须与文件名逐字相同」的校验，而 `moveNoteFile` 只做 `fs.rename`，正文里的 `title` 停在旧名字 → 改名之后每次写这篇都 400，错误信息还叫人「用 move_memory_note 改名」。`server/dreaming/prompt.mjs` 正是教整理员这么走的主路径，本机 22 篇存量经验全带 `title:`。
- 复现（临时目录，非仓库数据）：写「旧结论」→ `move` 成「新结论」→ 索引显示 `- 旧结论（特殊）`，再写「新结论」抛 `must equal the note name`。
- 修法：同步放在存储层 `moveNoteFile`，工作记忆与经验库共用一条路，不各改一遍。`server/frontmatter.mjs` 新增 `formatYamlScalar`（按需加引号：` #`、首尾空白、YAML 特殊首字符、`: `）与 `setFrontmatterScalar`（只替换指定 key 的值行，其余字节原样保留，CRLF 文件仍是 CRLF）；`moveNoteFile` 在 rename 前读出内容并算好新内容，rename 成功后原子替换，返回 `titleSynced`（`null` 不用改 / `true` 已改 / `false` 没写上）。
- 取舍：宁可「改名成功但标题没同步上」也不把整次改名报成失败——文件已在正确位置且可读；`titleSynced: false` 是静默降级路径，没有测试（要伪造写盘失败才能覆盖）。
- 验证：`memory-notes` 22 → 26 例全过；`dreaming-curator-agent` + `chat-surface-send` 一起 48 passed；全量 `npx vitest run` → 505 files / 5598 tests，5593 passed、4 failed（与审查时同一批基线：runtime-info 1 例在会话内必然假失败 + sqlite quick_check 1 例 + acp workspace-mapping 2 例）、1 skipped；定向 `npx eslint` → 0 problems。
- 未做：审查报告里其余 P1/P2/P3 一条没碰——`spawn` 默认 full-access、工作记忆开关不重建已存在会话的工具集、`<experiences>` 段未随开关裁剪、`runtime-info` 测试断言外部环境变量、`--api` 不校验回环、`ensureDefaultGlobalSkills` 早退不写 v2 marker。

## red-test-baseline（done，2026-11-10）

- 起因：用户明确不接受「这 4 个失败是既有基线」——「失败用例要对呀，问题要解决的」。于是把长期红的 4 例逐个查根因、修在根上，没有一处靠放宽断言或 skip 换绿灯。
- 三个根因（互不相干）：
  1. `tests/server/runtime-info.test.mjs` 断言 `process.env.QUICKFORGE_SESSION_ID` 为 undefined。在 QuickForge 自己拉起的 `run_command` 子进程里跑测试时它本来就有值 → 必然假失败，而这正是本项目 agent 跑测试的常态。改成对比调用前快照 + 断言传入的 `baseEnv` 没被写入，测的仍是「注入只发生在返回的副本里」。
  2. `sqlite-quick-check-gate` 的 `skipped` 期望 `'process'` 实际 `'marker'`：进程缓存与 `lastOkAt` marker 都拿数据库路径字符串当 key，而 `PRAGMA database_list` 报的是 SQLite 解析后的路径、调用方传的是配置里的路径；macOS 上 `/var` → `/private/var` 符号链接让同一库有两个 key，缓存永远 miss（marker 因为同目录还能读到，才表现为 `'marker'`）。**这是产品缺陷**：每次启动白扫一遍整库。修法：新增 `quickCheckPathOf()`（`realpathSync`，失败回退 `path.resolve`），cache 与 marker 共用一个 key。
  3. `acp/server.workspace-mapping` 2 例 `setActiveProjectPath` 返回 undefined：`assertSafeAcpCwd()` 返回 realpath 后的 cwd，而默认工作区根与已注册项目路径是按配置原样存的，同一个符号链接问题让 `sameProjectPath` 必然不等 → 默认工作区被当成「某个项目」去激活、已注册项目被当成新目录再注册。修法：`isDefaultWorkspaceCwd` 与新增的 `cwdMatchesProjectPath` 都把配置侧 realpath 后再比；解析不到就保持原样。`sameProjectPath` 本身不动（路由/UI 同步调用太多，不适合塞同步 IO）。
- 验证：全量 `npx vitest run` → 505 files / 5598 tests，**5597 passed、1 skipped、0 failed**。1 skipped 是 `terminal-vendor-runtime.test.mjs` 的 `describe.skipIf(!hasVendoredPrebuild)`（环境相关、一直如此）。定向：`sqlite-quick-check-gate` 11、`runtime-info` 10、`acp/*` 17，全过；关键是「会话内直接跑也绿」，不再需要 `env -u QUICKFORGE_*`。`npm run lint` → exit 0、0 problems。
- 文档：`docs/wiki/server/README.md`（ACP 段落补两侧解析符号链接）、`docs/architecture/sqlite-storage-foundation.zh-CN.md`（§6.1 补缓存 key 规范化）。
- 未做：`sameProjectPath` 仍是同步字符串比较；项目注册时写进配置的路径不改写；Windows 短路径（8.3 名）下 `realpathSync` 的归一化没有实测。
- 第二轮（用户要求「必要修的修，非实质不动」后自查修的两条，2026-11-10）：
  - `titleSynced: false` 原本完全静默：工具层 `content` 无条件说 `Renamed to "X".`，设置页只渲染工具参数、不渲染 details，模型不看 details 就无从发现「这篇已经写不进去了」——等于悄悄退回修复前的状态。修法：`toolMoveMemoryNote` 抽出 `describeMovedNote()`，`false` 时回复追加「front matter 标题还是旧名，这篇再写会被拒；读出来把 `title:` 行改成新名再存」。
  - `title: |` 块标量会被改成残片：`setFrontmatterScalar` 只替换键行，块标量真正的值在下面几行，替换后会留下孤立的旧标题。修法：匹配到 `|` / `>` 值就整份文件不动，并把这种「需要改但改不了」从 `null`（不用改）拆成 `false`，让上一条的提示能覆盖它。实测 `title: |` + 缩进旧标题改名后文件字节完全不变、`titleSynced: false`、随后 `writeExperience` 仍然 400（说明提示不是多余的）。
  - 验证：`memory-notes` 26 → 28 例全过（新增块标量用例 + 文案用例）；`tools/definitions` + `dreaming-curator` + `dreaming-curator-agent` → 35 passed；`npx eslint` 四个改动文件 → 0 problems。
  - 明确不动（非实质）：改名后 mtime 刷新导致列表排序前移、tmp+rename 丢掉原权限位、`formatYamlScalar` 只转义双引号不转义反斜杠（文件名正则已禁）、旧行内注释被替换掉、`'标题'` 这个键在 `parseSimpleYamlMap` 里永远命不中。

## scheduled-task-skill-commands（done，2026-11-10）

- 起因：用户问「QF 的技能包含创建定时任务吗」。查完：内置 3 个技能（plugin-creator / quickforge-api / skill-creator）没有一条提到定时任务；定时任务只是应用功能（`/api/scheduled-tasks`），agent 既无工具也无子命令。用户选择「给 quickforge-api 补一节」，而不是新造一个技能。
- 落地：`scripts/qf-api.mjs` 加 7 个写死端点的子命令 `tasks` / `task-add` / `task-pause` / `task-resume` / `task-run` / `task-runs` / `task-parse`；`SKILL.md` 同步命令表、新小节（六种排期写法 + 六个坑）、典型用法、报错行，description 补触发词（否则「帮我建个每天九点的任务」不会激活这个 skill）。
- 两条硬约束（都来自读代码，不是猜）：① 创建必须有 `modelRef`，否则 400 `invalid_model_reference`；不传 `--model` 就继承我自己 `/state` 的模型与思考档，返回里 `modelSource` 标 `self`/`flag`/`catalog`。② `task-run` 服务端同步等这次运行结束，默认 300s；超时只断客户端连接、服务端照跑，必须用 `task-runs` 复核，不能以为失败就重建。
- 刻意不做：删任务（DELETE）、改已有任务（PUT）、`--model` 传引用对象。覆盖用户排好的日程属于破坏性操作，和删会话同级；`--model` 只收模型 id，避免重演「传字符串必 400」的死参数。
- Evidence：本机 5176 实例端到端——daily / cron / weekly 三种排期建成且 `nextRunAt`、`scheduleRule` 正确，`task-resume`/`task-pause` 往返，`task-runs` 返回正确；4 条错误路径（404 透传、缺 `--time`、坏 `--model`、坏 cron 400）符合预期；验证任务全部 DELETE 清理，`remaining=0`，与开始一致。`node --check` 通过；`tests/server/skills.test.mjs` 5 passed；`/api/skills?available=true` 已能读到新 description。
- 未跑全量 `npm run test` / `lint` / `build`：改动全在 `skills/`，`eslint.config.js` 只覆盖 ts/tsx 与 `server|desktop/**/*.mjs`，build 只打 `src/`，跑了也验证不到这次改动。
- Notes：`task-run` 的真实执行（只验了 404 分支）和 `task-parse` 未实测——前者会真造会话烧 token，后者要可用 provider key，都涉及用户数据，没有擅自跑。

## bot-mode-persistent-sessions（done，2026-11-11）

- 需求演化：从「一个会自己醒的 agent」→「一个 bot 是一个容器」。用户逐条拍定：点击左上角图标切换 bot 模式；bot 模式下「+新对话」变「+新 bot」；每个 bot 独立工作空间 `~/.quickforge/bots/<名字>`（新建空目录，不是指向已有项目）；独立可编辑 `MEMORY.md`；`quickforge-api` 技能默认开；**一个 bot 只有一条 session**；**界面和普通对话完全一致，不弄特殊交互**；上下文预算交给 bot 自己读油表/压缩/写记忆；没事的班次不写进对话。
- 关键设计决定：① **把 bot 目录注册成项目**（`kind:'bot'`）而不是给 `createAgent` 加 `workspaceRoot` 通道——`createAgent` 只认 projectId，注册成项目后文件工具、提示词 workspace 块、restore 全部免费复用，也避免「重启后工具落回默认工作区」。② **不给会话加 botId 字段**——bot 记录持有 `sessionId` 单向引用即可，给会话加字段要动 CAS 持久化契约（5 处同步点）。③ **心跳无事不唤醒**：判据只有文件事实（首次 / `.bot/inbox.md` 有内容 / 工作空间出现新文件），不花 token；闲着的班次只记 `idleCount`。
- 两个实现坑：① `normalizeHeartbeat` 里 `null` 会被当成「没传」而回落到旧值，导致「关掉心跳」清不掉 `nextRunAt`——改成显式 `null` 优先，路由测试才发现。② 创建 bot 时 `createAgent` 可能因机器没配模型而失败；改成「失败不阻断创建」，记 warn，由下次心跳/下次打开时 `ensureBotSession` 重试。
- 验证：`npm run test` → 507 files / 5628 passed、1 skipped、0 failed（新增 19 例）。`npm run lint` → 0 problems。`npx tsc -b` 通过。`npm run build` 通过。前端契约测试中途红过两条并已修：`semantic-color-class-parity`（新组件用了未白名单的 `/40 /60 /70` 透明度，改成纯 `text-muted-foreground`）、`focus-ring-invariant`（设置抽屉的 `<select>` 缺 `focus-visible:ring-2 ring-ring`）。
- 未做（明确记录）：心跳信号没有接 git 脏文件与测试红绿（需要跨项目扫描）；记忆工具不支持按 bot 定向（工作记忆与经验库仍全局）；删 bot 不删目录；`qf-api` 脚本侧没有 bots 子命令；未在真实桌面端点过，界面只在原型与契约层面验证。
- 收尾补丁（同日）：bot 目录是注册过的项目，会混进项目切换器。改成在 `project-store.ts` 的 `setProjects` 统一过滤 `kind === 'bot'`——`useProject` 里有 6 处 `setProjects` 调用点，分散过滤必然漏一个；`ProjectInfo` 加 `kind?: 'bot'`；新增 `tests/frontend/project-store-bot-filter.test.ts`（3 例，含函数式更新那条）。复跑：508 files / 5631 passed、1 skipped、0 failed；lint、tsc、build 全过。
- **用户报 bug（同日）：「点击 bot 显示未找到该对话」**。根因两条叠在一起：① `persistSessionUnlocked` 会把 `messages.length === 0` 且无 goal 的会话当空壳删掉，所以建 bot 时那个 sessionId 只存在于内存（重启/清理后连内存都没有），存储里从来没有记录；② 前端 `openSessionFromSettings` 打开前会先查本地会话元数据，空会话必然查不到 → 直接 `sessionNotFound`。
  - 修法（两条必须一起做）：① 新增 `POST /api/bots/:id/session`（`ensureBotSession`），打开前把会话在内存里 ensure 出来；② `openSessionFromSettings` 加 `skipMetadataPrecheck`，`ui-store.requestOpenSession` 支持透传，只给 bot 用；真正的存在性交给随后的 `loadSession`（走 `/api/agents/:id/state`，实测内存里的空会话返回 200 + `messages: 0`）。第一次发言后会话落盘，两条都退化成普通路径。
  - 顺带修掉两个未处理拒绝：`sessionExists` 里 `hasSession` 是 async，同步 `try/catch` 接不住 rejected promise，改成 `await` 并把失败当「不存在」。
  - 验证：`npm run test` → 508 files / 5632 passed、1 skipped、0 failed；lint、tsc、build 全过；另起临时实例实测「建 bot → POST /session 再要一次同 id → GET /api/agents/:id/state 返回 200 且 messages 为空」。
- 迭代（同日）：bot 设置从右侧抽屉改成居中弹窗（`BotSettingsDrawer` → `BotSettingsDialog`）。理由：抽屉适合「边看边操作」，而 bot 设置是一次性看完再关的配置；弹窗还能让记忆编辑区获得更稳定的宽高。全量 test 508 files / 5632 passed、lint、tsc、build 全过。

- 设计资产（同日）：新增 `docs/design/bot-mascot/`——bot 吉祥物动图（`bot.gif` 512px / `bot-128.gif` / `bot-still.png`）、生成脚本 `generate-bot-gif.py` 与说明 `README.md`。做法是逐帧拼 SVG → `rsvg-convert` 渲染透明 PNG → `ffmpeg` palettegen/paletteuse 合成，未新增任何 npm 依赖。动作＝呼吸 ±3% + 整轮只眨一次（循环 62% 处）+ 天线光点脉动（光晕 19→27px）。
  - 因为看不到画面，验收改用可测指标：全片并集包围盒四边留白 ≥79px（不出画）、眨眼在第 31 帧眼睛高度降到 5px、GIF 与 SVG 源帧色彩误差 mean 1.12/255、首尾帧差 2.08 与相邻帧差 2.20 同量级（可无缝循环）。
  - 已知限制：GIF 二值透明会把天线光晕切成硬边，需要柔和光晕得导 APNG；64 色下身体渐变沿中线仍有 13 处轻微色带。未触碰 `public/`、`src/` 与打包产物，未提交 Git。
- 设计资产（同日，第二轮）：按"最简约、黑白、眼睛白色"重做吉祥物 → `bot-bw.gif`（512px, 125KB）/ `bot-bw-128.gif` / `bot-bw-still.png`。造型只留实心纯黑圆球（r=170）+ 两只纯白椭圆眼（46×58，各偏 52px，中心低于圆心 10px），去掉渐变、高光、描边、天线、腮红和嘴；动作留呼吸 ±1.6%（实心黑更"重"，取蓝色版一半）+ 整轮一次眨眼。脚本加 `--style glow|minimal`，两版共用一套时间轴。
  - 验收：四边留白 86/82/85/87px、镜像平均差 0.172/255、外轮廓半径 169.6±0.49（正圆）、眨眼 58→5px 落在第 31 帧、首尾帧差 1.10 < 相邻帧差 1.29（无缝）。体积从 536KB 降到 125KB。
  - 待定：纯黑球放在深色界面上只剩两只白眼，若要常驻深色 UI 需再出一版反色（白球+黑眼）。
- 迭代（同日）：bot 设置去掉「技能」小节。查下来那个开关**从来没生效**——`bot.skills` 没有传给会话，会话能激活哪些技能一直来自全局技能与项目技能配置，所以它是纯装饰。彻底删掉：`bots` 记录不再有 `skills` 字段（`server/bots.mjs` 的 `DEFAULT_BOT_SKILLS` / `normalizeStringArray` 一并移除）、路由不再接受 `skills`、前端类型与弹窗段落删除、i18n 两条 key 删除、测试改成断言记录里**没有** `skills`（防它长回来）。技能配置回归全局设置页。全量 test 508 files / 5632 passed、lint、tsc、build 全过。
- 迭代（同日）：左上角的 bot 开关换成自绘的黑白小机器人头像（`src/components/bots/BotAvatar.tsx` + 组件自持 `bot-avatar.css`）。点击时 `popKey` 加一让 svg 重挂，播一次「眨眼 + 弹一下 + 天线晃」，时长走 `--quickforge-dur-slow` / `--quickforge-ease-out`，带 `prefers-reduced-motion` 降级；不循环、不常驻。原 `Sparkles` 图标退役（`新 bot` 按钮仍用它）。另出 `docs/prototypes/bot-avatar.html` 可点预览。前端 294 files / 3338 tests 全过、lint、tsc、build 全过。
- 真机回执（同日，用户建的 `总bo t` 自己写的 MEMORY.md 里点名两条）：
  1. **模板路径是真 bug**（`server/bots.mjs` 的 `defaultMemoryTemplate`）：写的是 `~/bots/<名字>`，真实目录是 `<dataDir>/bots/<名字>`（默认 `~/.quickforge/bots/<名字>`），而且 dataDir 可配置、硬编码 `~/` 永远不可靠。修法：模板改为接收 `workspacePath`，用 `displayPath()` 在家目录下压成 `~/…`，否则给绝对路径。
  2. **心跳会死锁**：判据是「工作空间出现新文件 / inbox 有内容 / 首次」，但它不醒就不会产出文件、没文件就不醒，`总bo t` 攒到 `idleCount: 5` 就彻底没动静了。修法：加 `MAX_IDLE_WAKE_MINUTES = 180` 兜底——距上次唤醒超过 3 小时强制醒一次（reason `stale`），并补一条测试钉住。
  - 真机同时验证了「一个 bot 一条会话」成立：那次唤醒把消息追加到同一条 `bot-…-5804ea36`，没有新增 `scheduled-*` 会话。
  - 全量 test 508 files / 5633 passed、lint、tsc、build 全过。

## bot-project-scope-isolation（done，2026-11-11）

- 需求（用户原话）：①「新建对话就不应该看到 bot 项目」；②「切换到 bot 模式，对话框也不应该展示项目和分支」。先只做定位分析，确认后按「根因 + 表现层一起改」执行，并拍定「切进 bot 模式但还没打开 bot 时，自动打开第一个 bot」。
- 根因：bot 会话在数据层就是 project 会话（`bot-session.mjs` 用 `scope: 'project'` + bot 的 `projectId`），而前端只在「项目列表」这一处过滤 bot（`project-store.setProjects` 的 `visibleProjects`）。`activeProject`、会话自带 project、git 状态三条通道都绕过它；`botMode` 也只被 `SidebarHeaderNav` / `ChatSidebar` 消费，主区（`ConversationHeader` / `NewChatProjectPicker`）完全不知道自己在 bot 模式。
  - 证据链：`useAgentManager.ts:545-560` 加载 bot 会话时调 `switchActiveProject` → `useProject.ts` 的 POST `/api/project/active` → 服务端 `routes/project.mjs` 当时不校验 `kind`，把 `activeProjectId` 写成 bot 目录 → `App.tsx` 的 `startNewDefaultSession` 与「空态自动进项目会话」effect 都直接用 `activeProject`。
  - bot 模式那一半：顶栏/空态判据只有 `chatScope === 'project'` + `currentToolProject` + `titleGitStatus`；刚切进 bot 模式时 `refreshBots` 还在 effect 里等下一帧，`toggleBotMode` 用空的 `bots` 找不到可打开的 bot，主区继续显示上一条普通会话。
- 落地：
  1. 服务端 `POST /api/project/active`：`kind === 'bot'` 直接返回项目 + 全量列表，**不改写 `activeProjectId`**（调用方仍能拿它的 path 当工具工作空间）。
  2. `getActiveProject`：`activeProjectId` 命中与 `projects[0]` 兜底都跳过 bot，只有「全是 bot」时才退回第一个（保持原兜底语义，不返回 undefined）。
  3. `setActiveProjectPath`：命中 bot 项目时不活化、不按目录名改名（bot 的名字属于那个 bot），其余行为不变。
  4. 前端新增 `src/lib/bot-project.ts` 的 `isBotProject`；`useProject` 的 `applyActiveProject` 成为写「当前项目」的唯一出口并拒绝 bot，四个调用点（列表加载 / 项目切换 / 选目录 / 建项目）统一走它。
  5. `App.tsx` 新增 `headerProject` / `headerGitRepository` / `headerGitBranch` / `headerGitDirtyCount` / `emptyStateProject` / `emptyStateBranch`：bot 模式或 bot 项目下都为空；空态胶囊渲染加 `!botMode`；`startNewDefaultSession` 与空态自动进项目 effect 跳过 bot 的 `activeProject`。
  6. `refreshBots` 返回列表；`toggleBotMode` 改 async，`bots` 为空时先 `await refreshBots()` 再打开第一个 bot。
- 验证：全量 `npm run test` → 510 files / 5645 passed、1 skipped、0 failed。`npm run lint` → 0 problems。`npm run build`（tsc -b + vite build + precompress）通过。新增 `tests/frontend/bot-project-scope.test.ts`（7 例）、`tests/server/project-active-bot.test.mjs`（5 例）；同步更新 `new-chat-project-picker.test.ts`、`new-chat-project-picker-create.test.ts`、`sidebar-new-chat-routing.test.ts` 三处字符串断言。另起隔离实例（临时 `QUICKFORGE_DATA_DIR` + `QUICKFORGE_PORT=5987`，用完停止并删除目录）实测三件事：① 建真实项目 + 建 bot 后 `POST /api/project/active` 传 bot 的 projectId → 响应返回 `kind: 'bot'` 的项目，但 `GET /api/project` 的 active 仍是 `real-project`；② 直接改 `projects.json` 把 `activeProjectId` 写成 bot（模拟旧脏状态）→ `GET /api/project` 自动回落到真实项目；③ `POST /api/project/path` 传 bot 目录 → 返回 bot 项目但不活化、名字也没被改成目录名。
- 文档：`docs/wiki/server/bots.md` §7 前端改写（主区复用普通视图，但项目/分支两处收敛）、`docs/wiki/server/routes/README.md`（active 端点语义）、`docs/wiki/src/components/README.md`（空态胶囊出现条件）、`docs/wiki/src/hooks/README.md`（useProject 的 applyActiveProject）。
- 未做 / 边界：①没有 bot 时切进 bot 模式，主区仍停在普通会话（有侧栏「新 bot」兜底）；②切模式最多两次 `GET /api/bots`（toggle 一次 + effect 一次），本地请求未合并；③已逃逸到 bot 项目桶的历史会话没有迁移，仍要按上一节的一次性脚本处理；④没有真机点过（需要重启服务端才生效）。
- Notes：`tests/server/session-message-benchmark.test.mjs` 在并行全量跑时偶发 `NaN` 断言失败（单独跑通过，前后都与本次改动无关，第二次全量也通过）。

## bot-session-deleted-project-recovery-guard（done，2026-11-11）

- 现象（用户报，在上一节落地后）：点对应的 bot，看不到它的历史对话。
- 先查事实：`/api/bots` 给的 `sessionId` 经 `/api/sessions/:id/view` 仍有 42 条消息、`scope: project`、`projectId` 指向 bot 项目（`c85a0f75-…`）。**数据没丢，是视图被换掉了。**
- 根因：`getDeletedProjectRecoveryDecision` 的判据是「当前工具项目不在 `projects` 列表里 ⇒ 它被删了」。而 bot 项目按设计永远不在这个列表里（`project-store` 过滤 `kind === 'bot'`）。点开 bot → `attachTaskToView` 把 `currentToolProject` 设成 bot 项目 → 恢复 effect 判定「项目已删除」→ 立刻 `startDeferredSession` 新建空会话顶掉视图。
  - 这个缺陷在 bot 功能落地时就存在；当时 `activeProject` 也被写成 bot 项目，恢复出来的新会话落进 bot 目录，正是「会话逃逸到 bot 项目桶」的成因。上一节把 `activeProject` 从 bot 上摘掉后，恢复目标变成用户真实项目，症状更明显。
- 修法：`getDeletedProjectRecoveryDecision` 的入参从 `currentToolProjectId` 改为整个 `currentToolProject`，第一件事 `isBotProject(currentToolProject) → { type: 'none' }`；`App.tsx` 的调用与依赖数组同步（依赖整个对象，避免 exhaustive-deps 警告）。
- 验证：`tests/frontend/deleted-project-recovery.test.ts` 7 例（含 bot 两条：有真实项目可回落、无真实项目时都必须是 none）、`tests/frontend/bot-project-scope.test.ts` 9 例（新增 App 传整个项目、判据先排除 bot）；`npm run lint` 0 problems；`npm run build` 通过；全量 `npm run test` → 512 files / 5665 passed、1 skipped、0 failed。
- 文档：`docs/wiki/server/bots.md` §7 补一条「项目被删除的恢复必须跳过 bot 项目」。
- 生效方式：纯前端，硬刷新即可；服务端两处仍要重启。
- 边界：判据仍用「不在列表」表达「被删除」，bot 是唯一显式豁免；将来若有别的「不在列表但合法」的项目类型，也要在这里加判据。
- bot 吉祥物（`bot-mascot-appearance`，done）：把设计稿里的圆球 + 两只眼睛接进界面——主区顶栏 28px、侧栏 bot 行首 18px（替换原来的 1.5px 状态圆点），bot 设置里新增「形象」分区（8 套预设 + 身体/眼睛取色器 + 动画开关）。
  - 关键取舍：**不用 GIF 当界面素材**。`generate-bot-gif.py --emit-web` 从同一套姿态函数导出 `src/components/bots/mascot/mascot-anim.css`（6 状态 × 身体/左右眼关键帧，51 帧/状态）与 `mascot-geometry.ts`（几何、时长、预设配色），界面渲染内联 SVG，颜色走 `--qf-mascot-body` / `--qf-mascot-eye` 两个 CSS 变量——换色零成本、缩放不模糊、设计稿与界面不会走形。代价是主 CSS 多 73KB（gzip +9.9KB）。
  - 状态映射不新造状态机：`resolveMascotState()` 纯函数从现有信号推导（出错/等审批→alert、工具执行→working、流式→thinking、刚完成→happy（`useMascotState` 保持 1.8s）、心跳关→sleepy、其余 idle）；侧栏只用 bot 自身字段（lastError/busy/heartbeat.enabled）。
  - 服务端：`normalizeBotRecord` 与 `publicBot` 两道白名单都加 `mascot`（只加一处会「保存成功但前端读不到」）；颜色只收 `#RRGGBB`、非法值退回上一次的值、部分 PATCH 深合并。
  - 测试：新增 `tests/server/bot-mascot.test.mjs`（10 例）与 `tests/frontend/bot-mascot.test.ts`（16 例）。
  - 期间被两个既有护栏拦下并修好：① `react-hooks/set-state-in-effect`（两处 effect 内同步 setState）→ 开心保持改为定时器回调里切换，设置弹窗里多余的同步 effect 直接删除（弹窗本来就按 bot id 重挂）；② `semantic-color-class-parity` 拦下新用的 `ring-ring/40` 与 `hover:border-muted-foreground/60` → 改用 `color-mix(in_oklab, var(--ring) 45%, transparent)` 与白名单里的 `/50` 档。
  - 文档：`docs/wiki/server/bots.md` §1/§6/§7.2/§8；`docs/design/bot-mascot/README.md` 补「接进应用」。
- bot 吉祥物（第二轮，按用户反馈改位）：用户说「icon 太小、好像没看见动，希望在输入框右上方自己动，仿佛在输入框上行动」。改动：① 吉祥物从主区顶栏（28px）改挂**输入框卡片右上角 34px**，压在顶边上，`pointer-events-none` 不挡输入；② 设计稿新增 `walk` 状态（24 帧 / 0.96s，两步一停、落地压扁、左右轻摇、眼睛盯着脚下）并 `--emit-web` 重出；③ 手写 `mascot-stroll.css` 做横向路线（9s：走 24px → 停 → 走回 7px → 停 → 走 28px → 回原点），空闲时演 `walk`，忙起来站定演对应状态（路线 `animation-play-state: paused` 冻结在原位，不瞬移回起点）；④ 为把吉祥物排到输入框上，新增 `ChatSurface.composerMascot` 插槽并让 `ChatPanelHost` 透传（React 属性，不用 DOM 注入）。
  - 撤回：`ConversationHeader` 的 `mascot` 插槽已删（不留死代码）。
  - 验收：`walk.gif` 24 帧、留白 88/105、上下行程 19.4px、首尾帧差 9.84 < 普通步进 11.33；前端测试 20 例通过（新增 4 例覆盖 walk 与溜达路线）。
  - 注意：本轮期间仓库有**另一个会话在并发改文件**（`sidebar-classes.ts`、`lib/i18n.ts` 都出现过瞬时半成品语法/类型错），所以某次 `tsc` 报错不在本次改动文件里，属并发编辑，未去改它。

## remove-composer-usage-stats（done，2026-11-11）

- 现象（用户报）：对话框底部出现 `↑21k ↓10.0k R800k`，问这是什么；随后说「本来就不要了 删除这块」。
- 查证：这行是 `UsageBar`（`.qf-usage-bar`），设计上本来就该被 CSS 隐藏——`src/styles/chat/messages.css` 里有 `.quickforge-composer + .qf-usage-bar` 的 `display: none !important`。React 化重构后 `MessageEditor` 外面多包了一层 `<div className="relative">`（bot 吉祥物的定位壳），相邻兄弟关系断了，选择器静默失效，这行才露出来；`chat-surface-css-contract.test.ts` 只断言选择器文本存在、不验证命中，所以一直没被发现。
- 决定（用户明确要求）：不再保留这行统计，整体删除，不做「挪位置/换格式」。
- 改动：
  1. `usage-format.ts`（`git mv` 自 `UsageBar.tsx`）只留 `formatUsage` / `formatTokenCount` / `formatCost` 三个纯函数——消息级 usage 行（`.qf-usage-line`）还在渲染，且同样由 CSS 隐藏。
  2. `ChatSurface.tsx` 删掉 `<UsageBar totals={snapshot.usage} onCostClick={onCostClick} />`、`AgentSurfaceSnapshot.usage`、`usageTotals` + `usageTotalsBySource` WeakMap、快照 bail-out 里那项比较、`Usage` 类型导入，以及三处点名 `UsageBar` 的注释；`composer-store.ts`、`composer-store-isolation.test.ts` 里把「打字卡顿」的归因从「UsageBar 聚合 + todo 扫描」收成「todo 扫描」。
  3. `messages.css` 删掉第三段选择器（原本锚定 composer 紧随的汇总行），保留 `.qf-usage-line`（含 subagent 过程列表的后代分支）的隐藏规则。
  4. 测试：`chat-surface-usage.test.ts` 删掉 `aggregateUsage` 与 `UsageBar` 渲染用例、补 `formatTokenCount`/`formatCost` 边界；`chat-surface-css-contract.test.ts` 删掉 UsageBar 导入与两条用例，改成「`qf-usage-bar` 不得回流」；`chat-surface-render.test.ts` 删掉 `qf-usage-bar` 断言并改用例名。
  5. 文档：`docs/wiki/src/components/README.md` 的组件树条目、`qf-*` hook class 清单、测试清单同步。
- 验证：定向 5 files / 75 passed（过程中暴露两处自造问题：CSS 注释里残留 `qf-usage-bar` 字面量被严格断言命中；`qf-usage-line,` 尾逗号正则因删掉最后一段而失配——都已修）。`npx tsc -b` 通过，改动文件 `npx eslint` 0 problems；`npm run build` 通过（vite build + 225 文件预压缩），`dist/` 已重建，硬刷新即生效。
- 未做 / 边界：① 消息级 usage 行保留；② `onCostClick` 整条 prop 链保留（宿主从未传入，但 AssistantMessage 在用，删它要动 6 个文件 12 处）；③ `context-usage.ts` 的 `renderInline: true` 分支原本锚在这行的 `.ml-auto.items-center`，现在永远找不到锚点（真实宿主用 `renderInline: false`，环挂在模型按钮左侧），属遗留死分支，没顺带清理；④ composer 底部 1.25rem 留白保留，改成 `qf-usage-spacer` 纯占位（用户后来指出「不要动布局」，已修）；⑤ 未实机肉眼确认。
- 修正（用户反馈「样式变了、之前是有空隙的，我只是不要这个显示，不要动布局」）：删掉整行后 composer dock 底部少了 `h-5`（1.25rem），输入框贴底。现在在原位置渲染 `<div className="qf-usage-spacer h-5" aria-hidden="true" />` 纯占位，不显示任何文字，布局回到删之前；`tests/frontend/chat-surface-render.test.ts` 加断言锁住这个占位（防止以后又被当死代码清掉）。重新验证：定向 3 files / 57 passed、`npx tsc -b` 通过、改动文件 eslint 0 problems、`npm run build` 通过（`dist/` 已重建）。
- Notes：本轮工作区有多个会话的并发改动，`npm run build` 会重建 `dist/`（生成产物），按项目约定不手改、留给发布流程。

## retire-dreaming-md（done，2026-11-11）

- 背景：`~/.quickforge/DREAMING.md` 是 2026-11 记忆体系改造后残留的旧稿（旧格式 bullet 列表）。代码已不读它（全仓 grep 只命中 `CHANGELOG.md` / `progress.md` / `feature_list.json` 等历史记录），但它仍躺在数据目录里，容易被误认为「和 `experiences/` 并行的第二套记忆」。
- 决定（用户拍板）：旧稿可删，内容按性质分流入工作记忆与经验库，UI 不动。理由：这是磁盘数据清理，不是产品改动；改界面会把十分钟的事拖成半天，而设置页的「梦境 Beta」里本来就装着经验库，入口线是通的。
- 逐条分流（17 条）：迁移 4 条，其余 13 条因已有更精确的笔记 / 已过期 / 属于 `AGENTS.md` 或全局 `MEMORY.md` 而丢弃。
  - 新增工作记忆 3 篇：全局包是指向仓库的软链（`qf update` 会换回发布版副本）、不要自己执行 `qf restart`（它重启的就是承载当前对话的进程）、NoteFlow 5179 / code-sentinel 5180 是复用前端壳的独立项目。
  - 更新工作记忆 1 篇：「改动生效时机分三层」补一节「验证服务端改动开副实例」（`QUICKFORGE_PORT=5190` + `QUICKFORGE_DATA_DIR=$(mktemp -d)`，不碰真实数据目录）。
  - 丢弃的两类代表：全量测试的基线失败清单（`progress.md:2364` 已记录 0 failed，写进去是毒）、`edit_file` 吞 `$$`（经验库已有更强的「含 `$` 或反斜杠改用脚本精确替换」）。
- 数据变更：`~/.quickforge/DREAMING.md` 已删除，备份在 `~/.quickforge/_backups/DREAMING.md.20261111-144338.bak`。
- 未改代码、未改 UI、未动 `feature_list.json`（不是 feature）。文档无需更新：`docs/architecture/memory-system.zh-CN.md` 第 9 节本来就写着「`DREAMING.md`：删除」，这次才真正兑现。

## memory-surfaces-consolidated（done，2026-11-11）

- 背景：删掉 `~/.quickforge/DREAMING.md` 后做全面定位，发现「梦境」这个旧概念仍留在三处：工具描述把共享的工作记忆说成 `current project's`；设置页文案仍在说「写入 MEMORY.md 的自动维护段落 / 可检索的经验库」；51 个 `dreaming*` 文案 key 与 4 个召回统计函数零调用方。
- 决定（用户拍板）：架构最优、一次改完、不留历史叙述。
- 改动：
  1. 契约：`server/tools/memory-notes.mjs` 的 `SCOPE_DESCRIPTION` 改成两个目录都 `shared across every project`；`server/system-prompt.mjs` 的 `<working_memory>` 增加「跨项目共享，只对某个项目成立的笔记要带项目名」。
  2. 文案：`src/lib/i18n.ts` 删掉 51 个零使用 key（中英各一，共 102 行）；`dreamingTab` 中文改「记忆整理」、英文 `Memory curation`；`dreamingDescription` / `dreamingEnabledInfo` 改为「整理工作记忆 + 沉淀经验」，不再提 MEMORY.md 自动段落与可检索经验库；其余 11 处 `Dreaming` 字样统一为「记忆整理 / memory curation」；`settings-tabs.ts` 搜索关键词补「记忆整理」、去掉「淘汰」。
  3. 死代码：`server/sqlite/dreaming-repository.mjs` 删 `recordNoteRecall` / `listNoteStats` / `syncNoteStats` / `deleteNoteStat` 及其导出；`tests/server/dreaming.test.mjs` 删对应 describe 块与 `NOTE` 辅助函数。
  4. schema：`dreaming_note_stats` 从 baseline 移除，新增 v20 迁移 `drop_dreaming_note_stats`（`BASELINE_VERSION + 1`），旧 v19 库升级后同样落在 20；`database.mjs` 的升级日志与备份文件名改用真实目标版本（`pre-v20-from-vN-`）。测试里「baseline 之后一条」的构造统一改用 `NEXT_SCHEMA_VERSION` / `LATEST_SCHEMA_VERSION`。
  5. 注释：`global-memory.mjs` / `dreaming-repository.mjs` / `runner.mjs` / `curator.mjs` / `collect.mjs` / `dreaming-data.ts` 里的演进史压成现状与约束；`legacy-migrations.mjs` 三条迁移注释各压成一行。
  6. 文档：删除 `docs/architecture/dreaming-memory.zh-CN.md`；`memory-system.zh-CN.md` 删掉「本文取代旧文」与整节退役清单、称呼改「记忆整理」；`sqlite-storage-foundation.zh-CN.md` 与 4 份 wiki 同步表清单 / 索引数 / 称呼。
- 验证：定向 13 files / 111 passed；全量 `npm run test` → **516 files / 5702 passed、1 skipped、0 failed**；`npm run lint` → 0 problems；`npm run build` → 通过。
- Notes：`settings-tabs.ts` 的搜索关键词保留「梦境 dreaming」作为别名，故意不删（老用户还会这么搜）。表用 v20 删除而不是改 baseline，遵循 append-only 约束。

## memory-layout-under-one-root（done，2026-11-11）

- 背景：`storage.mjs` 有 configDir/storageDir/cacheDir/logsDir 等 6 个目录常量，记忆一个都没有；四样记忆平铺在数据根目录，`experiences.mjs` 只能靠注释「lives next to MEMORY.md」表达从属关系。
- 决定（用户拍板）：本质都是记忆，收进一个根；`working-memory/` 换短名 `notes`；快照保留并一起搬。
- 新布局：`~/.quickforge/memory/{MEMORY.md, notes/, experiences/, snapshots/}`。
- 改动：
  1. `server/storage.mjs` 新增 `memoryDir` / `memoryFilePath` / `notesDir` / `experiencesDir` / `snapshotsDir` / `memoryDirOf(baseDir)`，路径只在这一处定义。
  2. 四个模块改为从 `memoryDirOf()` 派生：`global-memory.mjs`、`working-memory.mjs`（`WORKING_MEMORY_DIR_NAME='notes'`）、`experiences.mjs`、`dreaming/snapshot.mjs`（`SNAPSHOT_DIR_NAME='snapshots'`）。
  3. 新增 `migrateMemoryLayout()`：逐项判断（不拿「目录已存在」当整体闸门）、先整份备份到 `_backups/memory-layout-<ts>/`、冲突不覆盖改为挪进 `conflict/`、任一步失败回滚并抛错。由 `server/index.mjs` 启动链显式调用一次，结果经 `getMemoryLayoutMigration()` 记日志。
  4. 同步所有展示路径：`GLOBAL_MEMORY_DISPLAY_PATH`、`WORKING_MEMORY_DISPLAY_PATH`、`EXPERIENCES_DISPLAY_PATH`、工具 `SCOPE_DESCRIPTION`、整理员提示词、设置页 fallback、`memoryExperiencesNote` 中英文。
  5. 文档：`memory-system.zh-CN.md` 目录树与表格、4 份 wiki、`custom-agents-design`。
  6. 测试：新增 `tests/server/memory-layout-migration.test.mjs`（5 例：旧布局迁移、全新安装、幂等、冲突、备份）；`dreaming-snapshot` / `routes/memory` / `routes/dreaming` / `working-memory` / `global-memory` / `dreaming-curator-agent` 的路径断言跟进。
- 事故与根因（已修）：第一版把迁移挂在 `ensureStorage()` 里，而该函数始终解析模块级 `dataDir`、不认注入的临时目录，导致跑全量测试时在真实 `~/.quickforge` 上执行了迁移（15:11 一次完整迁移 + 15:12 一次把测试生成的 `experiences/` 挪进 conflict）。核查数据完好：83 篇笔记 / 39 个 md（38 经验 + index）/ 7 份快照 / MEMORY.md 1246 字节。修法：迁移移出 `ensureStorage()`，只由启动链调用；复跑全量确认不再新增 `memory-layout-*` 备份。
- 验证：全量 `npm run test` → **517 files / 5707 passed、1 skipped、0 failed**；`npm run lint` → 0；`npm run build` → 通过。
- 待办：运行中的实例仍是旧代码，重启前不要写记忆（会按旧路径在根目录重建），重启后迁移已无事可做（旧路径不存在）并补更新工作记忆里写着旧路径的笔记。

## memory-layout-no-legacy-names（done，2026-11-11）

- 用户拍板：不留兼容、不留旧名，全部切到最新设计。
- 改动：
  1. 设置 key `working-memory-settings` → `notes-settings`（`NOTES_SETTINGS_KEY`）。新增 `migrateNotesSettingsKey()`：启动时把旧 key 的值搬到新 key 并删除旧 key，**不做读侧兼容**；函数接受 `readSettings` / `writeSettings` 注入以便测试。
  2. `list_memory_notes` / `read_memory_note` 等的 scope 别名 `working-memory`、`experience(s)`、`工作`、`经验` 全部删除，只认 `working` 与 `experience`。
  3. 模型可见文案统一：工具描述 `working-memory folder` → `notes folder`；工具回复 `saved to the working memory` → `saved to notes`；整理员提示词 "working-memory notes" → "notes"；Explore 子代理提示词补上两个 scope 值。
  4. 系统提示词：`<working_memory>` 与 `<experiences>` 各补一句「两者都在 `~/.quickforge/memory/` 下，紧挨用户记忆文件」。
  5. 快照内部目录 `working-memory/` → `notes/`（`snapshot.mjs` 两处），已有 7 份快照的内部目录同步 rename；不同步的话旧快照回滚会找不到目录。
  6. 注释里的旧目录名：`note-store.mjs`、`global-memory.mjs`、`dreaming-repository.mjs`、`dreaming/runner.mjs`。
  7. 文档：wiki 里的 `settings['working-memory-settings']` → `settings['notes-settings']`。
- 保留（不是遗留）：`/api/working-memory` 与 `isWorkingMemoryEnabled` 等标识符——「工作记忆」仍是设置页里的功能名，API 与函数名指向功能不指向目录。
- 验证：全量 `npm run test` → **517 files / 5708 passed、1 skipped、0 failed**；`npm run lint` → 0；`npm run build` → 通过。
- 待办：重启后 `migrateNotesSettingsKey()` 会把现有开关与自定义提示词搬到新 key（当前进程仍读旧 key，所以重启前不要改工作记忆设置）。

## retire-memory-layout-migrations（待办，下个版本）

- 用户 2026-11-11 决定：`migrateMemoryLayout()` 与 `migrateNotesSettingsKey()` **本轮保留**，下个版本再删——发布版用户升级时靠它搬旧数据，本机已搬完但代码要留给别人。
- 删除范围已写进工作记忆「记忆目录迁移代码留到下个版本删」：`server/storage.mjs` 的常量与函数、`server/index.mjs` 两处调用与日志、`server/working-memory.mjs` 的 `migrateNotesSettingsKey()`、`tests/server/memory-layout-migration.test.mjs`、以及 working-memory 测试里的 key 迁移用例。
- 本机当前状态：`~/.quickforge/memory/` 下 84 篇笔记 / 38 条经验 + index / 7 份快照；`settings.json` 里仍是 `working-memory-settings`（重启时由迁移代码搬到 `notes-settings`，故意不提前手动搬，用来验证迁移本身）。

## bot-mascot-v3-visuality（done，2026-11-11）

- 用户问：「`~/.quickforge/bots/bot-e7e445bf/mascot-v3.html` 是按这个版本实现的么？非常生动，但对话框里好像没这么生动，为什么？」
- 结论一（推翻了假设）：**v3 早就进产品了**。`docs/design/bot-mascot/generate-bot-gif.py` 里 `pose_idle / pose_thinking / pose_working / pose_happy / pose_alert / pose_sleepy / pose_walk` 的关键帧与 v3 手写 CSS 逐值相同（idle 50% `translateY(-30) scale(0.92,1.10)`、happy 14% `18px 1.20/0.80`、alert 10% `-58px 0.80/1.22` + 落地 `dx ±16 rotate ±5`、sleepy 68% `-13deg 30px 1.12/0.85`）。核实方式：把生成脚本 import 进来现跑 `_web_css()` / `_web_ts()`，与仓库里的 `mascot-anim.css` / `mascot-geometry.ts` **逐字节相同**（173633 字节全等）。唯一差别是 25fps 帧数取整带来的时长差（happy 0.88 vs 0.9、alert 1.12 vs 1.1、working 0.72 vs 0.7），肉眼不可辨。
- 结论二（真正的原因）：**尺寸**。512 画布里球只占 300（余量留给跳跃、歪头），球径 = `size × 58.6%`。设计稿 220 画布 → 球径 129px；界面用 `size=64` → 球径 37px，10% 的压扁拉伸只有 3px、眼睛 `rx=20` 只有 2.5px，「变形」全塌成亚像素抖动。`data-size='small'` 的增强版关键帧（位移 ×1.35、形变 ×1.3）只能救眼神，救不了 squash & stretch。次要原因：日常画面上几乎只有 `idle`（working/thinking/alert 要事件触发，happy 还要求 `base === 'idle'`）。
- 改动：`src/App.tsx` 输入框那只 `size` 64 → 104（球径 61px，且 >64 自动用原始关键帧，比例与设计稿一致）；`BotSidebarList.tsx` 侧栏行首 18 → 24（球径 14px，仍只当「在动」的指示）。`-translate-y-[80%]` 不用动：`(cy+r)/512 = 79.7%`，球底边永远正好压在输入框上边缘，与 `size` 无关。
- 测试：`tests/frontend/bot-mascot.test.ts` 新增 2 例，从源码里读 `size` 换算球径，锁住下限（输入框 ≥ 56px、侧栏 10~20px），往小改会先红。
- 文档：`docs/wiki/server/bots.md` §7.2（尺寸改 104/24，补「尺寸不是随便给的」，顺带修掉三处过期数字：34px、隔 45 秒、`-translate-y-[86%]`）、`single-bot-workspace-ui.zh-CN.md` §5、`docs/design/bot-mascot/README.md`（7 个状态 + `-small` 增强版 + 尺寸下限一节）。
- 验证：定向 `npx vitest run tests/frontend/bot-mascot.test.ts` → 24 passed；全量 `npm run test` → **520 files / 5741 passed、1 skipped、0 failed**（比上一轮基线 5739 多出的 2 例就是这次新增的）；`npm run lint` 0 problems；`npm run build` 通过。
- Notes：没重新生成 `mascot-anim.css`（生成脚本输出与仓库文件逐字节相同，说明它没漂）；104 是折中值，球顶会往消息区探约 61px，想更贴近设计稿就往 112~120 调，改动只有 `App.tsx` 一个数字。未创建 commit / tag / push。
