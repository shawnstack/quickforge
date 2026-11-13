# Bot 模式

> 一个 bot 就是一个长期存在的「人」：一条永不重置的会话、一个自己的目录、一份自己可编辑的 `MEMORY.md`，以及一个可以开关的自主节拍。
> 设计背景见 [一个主体、两只手](../../architecture/cross-project-orchestrator.zh-CN.md) 和 [单 bot 界面设计](../../architecture/single-bot-workspace-ui.zh-CN.md)。

## 1. 数据模型

| 东西 | 位置 |
| --- | --- |
| bot 记录 | `bots` store → `<dataDir>/storage/conversations/global/bots.json` |
| bot 目录 | `<dataDir>/bots/bot-<id 前 8 位>/` |
| 记忆 | `<bot 目录>/MEMORY.md` |
| 心跳操作模板（可自我修改） | `<bot 目录>/.bot/heartbeat.md` |
| 收件箱（可选） | `<bot 目录>/.bot/inbox.md` |
| 会话 | 一条，id 记在 `bot.sessionId`，`idleRetention: 'always'` |

目录名**不用显示名**（`botWorkspacePath(id)`）：名字可以随时改、可以是中文和空格，路径不受影响。早先目录名就是名字，结果一个字符串同时承担「给人看」和「当路径」两件事——中文要切输入法才能 `cd`，改过名的 bot 目录还叫旧名字（新建同名 bot 会算到同一个目录），大小写与 Unicode 归一化差异也能让两个名字映射到同一个目录。现在唯一性交给 id。

老记录里已经存了 `workspacePath`，`normalizeBotRecord` 优先沿用它（`previous?.workspacePath ?? …`），所以换规则只影响新建的 bot，不会搬动存量目录。要把存量也搬过去，跑 `node scripts/migrate-bot-workspaces.mjs --dry-run` 看计划、去掉 `--dry-run` 执行；**跑之前先关掉 bot 心跳**，否则迁移途中它可能往老目录里写东西。脚本会自己备份 `bots.json` 与 `projects.json` 到 `_backups/`，并同步 `projects.json` 里 `kind: 'bot'` 的 `path`。

`bots` 走的是和其它用户数据一样的 bucket store（见 [storage](../../../server/storage.mjs) 的 `stores` 白名单），所以 `GET/PUT /api/storage/bots` 天然可用。

每条记录的形状：

```js
{
  id, name,
  workspacePath,     // <dataDir>/bots/bot-<id 前 8 位>
  memoryFile,        // <workspacePath>/MEMORY.md
  projectId,         // 注册在 projects.json 里的项目 id
  sessionId,         // 这个 bot 唯一的那条会话
  thinkingLevel, model, modelRef, accessMode,
  sortOrder,          // 手动排序位（PUT /api/bots/reorder 维护）；老记录没有它，按 createdAt 兜底
  heartbeat: {
    enabled, intervalMinutes, nextRunAt,
    lastWakeAt, lastSessionId,
    lastIdleReason, lastError,
  },
  mascot: { body, eye, animated, showOnComposer },   // 吉祥物外观；showOnComposer 控制输入框上方那只（默认 true），见 §7.2
  createdAt, updatedAt,
}
```

## 2. 为什么 bot 目录要注册成一个项目

`createAgent` 只认 `projectId`，而项目上下文决定了文件工具能写哪儿（`workspaceRoot`）以及系统提示词里的 `<workspace_context>`。把 bot 目录注册成项目，这两件事都不用另开一条通道。

注册时打 `kind: 'bot'` 标记，前端项目列表据此过滤，bot 目录不会混进项目切换器；也不会改 `activeProjectId`——建一个 bot 不该把用户当前项目切走。

## 3. 记忆：每个 bot 一份

`buildInstructionsPayload()` 在项目 `kind === 'bot'` 时读 `<workspaceRoot>/MEMORY.md` 顶替全局 `~/.quickforge/memory/MEMORY.md` 那一块。于是：

- 甲的 memory 不会出现在乙的提示词里；
- 用户可以在设置抽屉里直接编辑它，改完下一轮生效。

工作记忆与经验库仍然是全局的——那两份是「这台机器上的我」的长期记忆，只属于单个 bot 的记忆用 `MEMORY.md`。

## 4. 心跳

`server/bot-runner.mjs` 每 30 秒扫一遍 bot，只有 `heartbeat.enabled` 且 `nextRunAt <= now` 的才处理。

**关键的一条：没有信号就不叫醒模型。**

`inspectBotWork()` 的判断全是文件事实，不花 token：

| 情况 | 结论 |
| --- | --- |
| 从没醒过 | 醒（先认识环境） |
| `.bot/inbox.md` 有内容 | 醒 |
| 工作空间里有 `lastWakeAt` 之后的新文件 | 醒 |
| 其它 | 不醒，只把 `nextRunAt` 推后 |

不醒的那一班**不往对话里写任何东西**——否则一小时一条「我醒了」，一天就把会话淹了。这是把「心跳」和「打卡」分开的地方。

醒来时用的是 `runPrompt(bot.sessionId, ...)`，推进同一条会话；会话忙（用户正在跟它说话）时这一班直接跳过，不排队、不抢上下文。

### 4.1 心跳指令:固定头 + 可自我修改的操作模板 + 固定尾

指令 = 服务端拼的固定头(处境 + botPath + **自进化授权**:模板和记忆都可以自己改 + **项目活派活半径**:发现/拆解/派活/验收自己做,实现一律 spawn 给绑定该项目的子会话) + `.bot/heartbeat.md`(bot 的操作模板,创建时播种、可自我修改、缺失回退种子) + 固定尾(`[报告]` 契约、不 commit、不提问)。分界口诀:每次醒来都一样的放指令模板,每次醒来会变的放记忆;丢了会坏机制([报告]/不 commit/授权入口/派活半径)的钉在服务端。种子保持引导式给判断标准,不写场景化步骤(防过拟合)。文案全文见 [Bot 主动性设计](../../architecture/bot-proactivity.zh-CN.md) §3.2。

存量 bot 也有:`runBotHeartbeat` 每次开头跑一次幂等的 `ensureBotWorkspace`——建于模板化之前的 bot,下一次被 runner 扫到(最多 30 秒,或手动催醒)就会补上模板文件,已有记忆与已演化的模板不会被碰。

### 4.2 `[报告]` 首行契约与通知

心跳轮回复的**首行以 `[报告]` 开头**才算有事要通知用户。`runBotHeartbeat` 发出 prompt 前先挂一个不阻塞 tick 链的 watcher（`watchBotHeartbeatReport`）：等 `agent_end`，解析最后一条 assistant 回复的首行（`parseHeartbeatReport`），带标记才经全局事件通道 emit `bot_heartbeat_notification`（payload 带 `reportKey` 去重）。无标记、idle 跳、心跳自身报错都不发。前端 App 层全局 SSE 收到后走现有 toast + `showTaskSystemNotification`（摘要进通知正文，点击打开 bot 会话）。

### 4.3 投喂与催醒

- **投喂**：`POST /api/bots/:id/inbox`（`appendBotInbox`）把文本带时间戳追加进 `.bot/inbox.md`；心跳开着时把 `nextRunAt` 提前到当前时间——只提前节拍不直接唤醒（保持单飞约束），下一轮扫描（≤30 秒）自然醒。入口在 bot 设置弹窗，投喂内容不进会话消息流。
- **催醒**：侧栏 bot 行 hover 出「催它一下」（`AlarmClock`），调既有 `POST /api/bots/:id/wake` 跳过判活立刻跑一跳；busy 时禁用。

## 5. 上下文预算

系统不做特殊处理：bot 可以由 `quickforge-api` 技能自己读油表（`qf-api context`）、自己触发压缩、自己把结论写回 `MEMORY.md`。会话之所以能一直活着，靠的是这套自我管理，而不是服务端替它裁剪。

## 6. HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bots` | 列表（附 `busy` / `status`），按 `sortOrder` → `createdAt` 排序 |
| POST | `/api/bots` | 建 bot：`{ name }`。会建目录、`MEMORY.md`、注册项目、建会话；新 bot 排在列表末尾 |
| PUT | `/api/bots/reorder` | 整组重排：`{ orderedIds }` 重编 `sortOrder`（0,1,2…），漏掉的按原相对顺序追在后面，返回新顺序的完整列表。与 `PUT /api/project/reorder` 同构 |
| GET | `/api/bots/:id` | 单条 |
| PATCH | `/api/bots/:id` | 改名字 / 技能 / 思考档 / 心跳（改间隔会重算 `nextRunAt`，关掉会清空它）/ 吉祥物外观（`mascot`，可只传部分字段）。**改名不动目录**——目录由 id 决定；改名会尽力同步两处外部引用：`projects.json` 里 `kind:'bot'` 项目的显示名、该 bot 会话的标题（失败只记日志，不回滚改名） |
| DELETE | `/api/bots/:id` | 删记录和项目注册，**销毁会话**（`destroyAgent`：abort 在途生成、停 watcher、最终 persist 后从内存移除；历史消息保留在存储里），**目录保留** |
| GET | `/api/bots/:id/memory` | 读 `MEMORY.md` |
| PUT | `/api/bots/:id/memory` | 写 `MEMORY.md` |
| POST | `/api/bots/:id/wake` | 立刻催醒一次（跳过「有没有活」的判断） |
| POST | `/api/bots/:id/inbox` | 投喂：`{ text }` 追加进 `.bot/inbox.md`；心跳开着时把 `nextRunAt` 提前到当前时间 |
| POST | `/api/bots/:id/open-in-explorer` | 在系统文件管理器里打开这个 bot 的目录（`workspacePath`）；**只放行本机调用**，远端 / 局域网请求 403（与 `POST /api/project/:id/open-in-explorer` 同一条边界） |

内置 `quickforge-api` skill 为上表提供命令行入口：`bots`（列表）、`bot`（详情）、`bot-create`（创建，心跳默认开，`--no-heartbeat` 建完即睡）、`bot-messages`（读会话尾部，只读不唤醒）、`bot-memory`（读记忆）、`bot-wake`（催醒）。删/改/写记忆没有子命令，界面专属（白名单裁决见 `docs/architecture/quickforge-api-skill.zh-CN.md` §4.1）。

## 7. 前端

- 侧栏左上角「对话 / BOT」分段切换 bot 模式（`ui-store.botMode`）：logo 行下方独占一行、两个等宽选项，选中项浮起（`SidebarHeaderNav.tsx` + `sidebar-classes.ts` 的 `modeSwitcher*`）。这段分段控件**只在侧栏展开时渲染**；侧栏折叠后左上角只留「展开侧栏」一枚按钮（平时显示 favicon，hover / 聚焦换成 `PanelLeftOpen`），折叠态不再单独放模式切换图标，切模式要先摊开侧栏。点当前已选中的那一项不会再触发一次切换。
- 两个方向的补偿不对称，都值得知道：**进 bot 模式**时若当前会话不属于任何 bot，会自动打开第一个 bot（否则主区会停在普通会话上自相矛盾）；**退出 bot 模式**时若当前会话属于某个 bot，则落回新对话空态。后半条不是洁癖——不改的话主区会继续显示那个 bot 的历史对话，而 `chatCapabilities` 仍按 bot 项目判定，顶栏、吉祥物、消息落点全都还挂在 bot 上。实现在 `useBotWorkspace` 的 `previousBotModeRef` effect 里（不能塞进 `toggleBotMode`：那里读 `agentManager.currentSessionId` 会被 `react-hooks/refs` 判成 render 期间读 ref）。**删除 bot 同理**：服务端 DELETE 已销毁会话，前端若还停在那条会话上，SSE 订阅会继续渲染残留事件——`handleDeleteBot` 在删除成功且主区正停在该 bot 会话时同样落到新对话空态（2026-11-13 修复）。
- **`botMode` 不持久化，刷新即归零**：会话内容却能经 URL `?session=` 恢复回来（点开 bot 时 `attachTaskToView` 会把它写进地址栏）。所以启动链里要做第三次对齐——`useAppBootstrap` 在恢复成功后若会话项目是 bot（`isBotProject`），把 `botMode` 拨回 true，侧栏才不会错亮「对话」。只挂在启动恢复成功的分支上，不与退出补偿冲突。bot 会话还没落过盘（从没发过消息）时恢复必然失败，落到新对话空态是数据本身不存在，不属于此列。
- bot 模式下侧栏换成 bot 列表（`BotSidebarList`），一行一个，与会话行同一套样式。多于一个 bot 时整行可拖动排序（dnd-kit，`PointerSensor` 6px 激活与点击共存，复用 `SortableProjectItem` 包装）：拖完把新顺序交给 `App.tsx` 乐观重排并 `PUT /api/bots/reorder` 落盘，失败整表刷新回滚——顺序必须由服务端持有，`refreshBots` 会整组覆盖 `setBots`，纯前端顺序活不过下一次刷新。
- 「新对话」按钮在 bot 模式下变成「创建 bot」。
- **主区复用普通对话视图**：bot 就是一条会话，点开走 `requestOpenSession(sessionId)`。但「项目 + 分支」是普通对话语境的控件，这里有两处收敛：
  - bot 模式下顶栏不显示项目胶囊与分支菜单，空态也不渲染项目胶囊（`App.tsx` 的 `headerProject` / `emptyStateProject`）。
  - bot 的专属目录虽然也注册成项目（`kind: 'bot'`，工具需要它的 path 当 workspaceRoot），但它不是「用户的当前项目」：`POST /api/project/active` 遇到 bot 项目只把项目返回给调用方、不改写 `activeProjectId`，`getActiveProject` 的命中与兜底都跳过 bot；前端 `useProject` 的 `applyActiveProject` 是写「当前项目」的唯一出口，同样拒绝 bot。否则打开一次 bot，之后每次「新对话」都会落进 bot 目录。
- 切进 bot 模式时若当前会话不属于任何 bot，会先刷新一次列表、再自动打开第一个 bot（`toggleBotMode`）。没有 bot 时主区保持原样，用侧栏「创建 bot」创建。
- **「项目被删除」的恢复逻辑必须跳过 bot 项目**：`getDeletedProjectRecoveryDecision` 的判据是「当前项目不在 `projects` 列表里」，而 bot 项目按设计永远不在（`project-store` 过滤 `kind: 'bot'`）。不跳过的话，每次点开 bot 都会被判成「项目已删除」，随即新建一条空会话顶掉 bot 的对话——表现就是「bot 的历史对话不见了」。所以判据收整个 `currentToolProject`、先看 `kind`，而不是只收 id。
- **它的会话不能 fork、也不能回滚对话**：能力矩阵 `src/lib/chat-capabilities.ts` 的 `BOT_CHAT_CAPABILITIES` 关掉 `forkFromMessage` / `rollback` / `retry`（`compaction` 保留，它自己要压上下文），`App.tsx` 在 bot 语境把它注入 `ChatPanelHost`，消息行因此**不渲染**这些图标；服务端 `rollbackSessionMessages` 另有一道无条件闸门——会话落在 `kind: 'bot'` 的项目里就 403 `BOT_SESSION_IMMUTABLE`，绕过 UI 直接打 API 同样拒。理由：会话就是它的记忆，压缩后的摘要本身是数组里的一条消息，剪短会让 `contextCompaction.summaryMessage` 悬空，之后每轮喂给模型的都是幻象。**文件回滚（`/rollback-turn`）不碰 messages，照常可用。**
- 设置弹窗（`BotSettingsDialog`）：header 是「44px 吉祥物预览 + bot 名」的身份行（预览跟形象草稿联动）；正文顺序 形象（调色盘、身体/眼睛色、显示动作、在输入框上方显示）→ 心跳 → `MEMORY.md` 编辑 → 工作空间路径（只读信息放最后）；三处开关共用 `SwitchRow`；footer 左下删除、右上关闭。名字就地改名：点名字（或旁边的铅笔）进入编辑，Enter 提交、Esc/失焦取消，走 PATCH 的 `name`；重名 409 时保留草稿就地报错，服务端同步项目名与会话标题（见 §6）。

**技能不归 bot 管。** 会话能激活哪些技能由全局技能与项目技能决定（和普通会话一致），bot 记录里没有 `skills` 字段——早先有过一个 per-bot 开关，但它从来没传给会话，等于装饰品，已删除。

### 7.1 空会话：为什么打开 bot 要先 ensure、还不能走 metadata 预检

空会话**不落盘**：`persistSessionUnlocked` 会把 `messages.length === 0`（且没有 goal）的会话当空壳删掉。所以 `bot.sessionId` 只保证「永远是同一个 id」，不保证此刻存储里有它。

由此两条必须一起做，缺一条就会「未找到该对话」：

1. 打开前先 `POST /api/bots/:id/session`（`ensureBotSession`）把会话在内存里建起来。
2. 打开时带 `skipMetadataPrecheck`——前端 `openSessionFromSettings` 默认会先查本地会话元数据，而内存态的空会话根本没有那条记录。跳过预检后，真正的存在性由随后的 `loadSession` 判定（它会走 `/api/agents/:id/state`，内存里在就能返回）。

第一次发言之后会话落盘，之后两条都退化成普通路径。

### 7.2 吉祥物：界面里的动作与设计稿 mascot-v3 逐字一致

两处：**输入框右上角**（bot 模式下有当前 bot 时，`size={79}`，约 46px 球径，贴在输入框上边缘，闲着时偶尔走一小段）和**侧栏 bot 行首**（24px，替换原来的状态圆点），都在 `src/components/bots/mascot/`。设置弹窗的 header 里另有 44px 的预览（跟形象草稿联动，拖色盘时它跟着变色）。

- 输入框那只可以整体关掉：bot 设置 → 形象 → 「在输入框上方显示」（`mascot.showOnComposer`，默认 `true`）。**只管输入框上那只**，侧栏行首的小吉祥物不受影响。前端判据是 `activeBot.mascot.showOnComposer !== false`——拿不到 `activeBot`（列表没加载完）时保持显示，和「拿不到就用默认外观」同一语义；存量记录没有这个字段（老服务端进程写出来的）也照样显示，字段只在 PATCH 归一化时补上。

> **尺寸不是随便给的**：画布 512 里球只占 300（余量留给跳跃），所以只要 `size` 的 58.6% 才是球径。设计稿 `mascot-v3.html` 用 `width=220` → 球径 129px；产品里给过 64（球径 37px）嫌「没在动」，104（球径 61px）又被否「太大了」，因为球会往上压住消息区，84（球径 49px）之后用户又两次要求再小，最终落在 **79（球径 46.3px，即测试锁的 46px 球径下限之上能取到的最小整数）**。三处尺寸都不变，动作统一照搬设计稿、按 `size/220` 等比缩放；已去掉原先 `size <= 64` 时的 `-small` 增强关键帧。


- `mascot-anim.css` 与 `mascot-geometry.ts` 是**生成文件**，来自 `docs/design/bot-mascot/generate-bot-gif.py` 的 `emit_web()`（`--emit-web`）。关键帧和缓动**逐字照搬设计稿 `mascot-v3.html`**（脚本里的 `V3_WEB`）：变换原点在球心 `(256,258)`，用设计稿原样的 `ease-in-out` / `cubic-bezier`，左右眼共用一套。眼型是唯一按验收稿（`expressions-preview.html`）偏离的一处：豆豆眼 `18×32`、中心上移到 `y=262`。同文件还输出互动（`V3_INTERACT_*`）、张望（`V3_LOOK_*`）与状态小符号（`V3_SYMBOL_*`）三段。GIF 仍由 `pose_*` 采样，是旧动作，两者暂不一致。
- 换色只改两个 CSS 变量（`--qf-mascot-body` / `--qf-mascot-eye`），不重新生成任何素材；这就是没用 GIF 当界面素材的原因。用的是默认墨黑配色（`#0B0B0C` / `#FFFFFF`）时组件不写内联颜色、只标 `data-look='default'`，由 CSS 按主题取色：深色主题下换成白身黑眼，否则黑球和背景几乎同色。代价是深色主题下特意选了墨黑也会显示成白色。
- 动作由 `resolveMascotState()`（纯函数，`mascot-state.ts`）从现有信号推导，优先级：出错 / 等审批 → `alert`，工具执行 → `working`，流式 → `thinking`，刚完成 → `happy`（`useMascotState` 只对这一种保持 1.8s），心跳关掉 → `sleepy`，其余 `idle`。
- 侧栏行没有当前会话的细粒度状态，只用 bot 自身字段拼：`heartbeat.lastError` → `alert`、`busy` → `working`、心跳关 → `sleepy`。原来那个 1.5px 状态圆点已被吉祥物取代。
- 侧栏 24px 的尺寸（球径 14px）只够看出「在动」，眼睛动作演不出来，所以**状态靠文字讲**：行右侧那截小字由 `botStatusSummary()`（`bots-data.ts`）算，优先级 出错 > 在忙 > 睡了 > 上次醒来多久前 > 还没醒过，隔一分钟重算一次；`hover` 时让位给设置按钮。设计规范里「运行状态应保留文字」说的就是这件事。
- 关掉动画（设置里的开关）或系统 `prefers-reduced-motion: reduce` 时，动画整体停住、停在初始姿态。
- 输入框那只**默认安静**：只有 `mascotState === 'idle'` 时才可能散步，由 `useMascotStroll` 控制节奏（隔 20 秒走一轮 9 秒，其余时间站定），横向路线在 `mascot-stroll.css`（手写，播 1 次不是无限循环，末帧回到原点所以不会跳）。有状态（思考/干活/提醒/完成）时**不走路**，站定演那个状态。
- 输入框那只还有**互动彩蛋**（`BotMascot` 的 `interactive`，其余调用点不传）：悬停抬眼看人、点一下被戳瘪再弹起、1.6s 内点满 5 下转晕。设计稿是 `docs/design/bot-mascot/interactions-preview.html`，CSS 同样由生成脚本输出（`V3_INTERACT_RULES`），时机逻辑在 `mascot-interactions.ts`（纯控制器，可注入假时钟）+ `use-mascot-interactions.ts`。规则：只在待机 / 犯困时响应，走路和忙状态不理人；事件只挂在球本体（`pointer-events: auto`），空白处穿透到输入框；纯装饰彩蛋，不进 Tab 序列。
- 同一只还有**表情增强**（设计稿 `docs/design/bot-mascot/expressions-preview.html`，已验收）：① 眼型改为豆豆眼 `18×32`、中心上移到 `y=262`，三个尺寸全局生效；② 待机时每隔 5~9s 随机来一段 3.3s 的**东张西望**（`data-ambient='look'`）：眼睛拉长左上斜看 → 甩到右上（冒个「?」）→ 眨眼收尾，头反向微歪、呼吸照常，由 `__tilt` / `__gaze` 两个附加图层演，不碰身体动画；只在待机来（犯困在打瞌睡不张望），悬停 / 点击立即打断；③ **状态小符号**八个：思考「…」（逐颗累积，像「正在输入…」）、犯困「zZ」、提醒「!!」、开心「♡」、干活汗滴、被戳「!」、转晕星星、张望「?」，跟随 `data-state` / `data-interact` / `data-ambient` 由 CSS 显隐。配色规则：球外符号用球身色、球上符号（汗滴）用眼色，深浅主题都与底色拉开；跟着球跳的符号画在球体图层里随球动（球外的同色符号会被蹦上来的球吞掉）。符号与张望只给输入框那只——侧栏 24px / 设置预览 44px 上符号认不出来。
- 同一只还有**动作组**（设计稿 `docs/design/bot-mascot/actions-preview.html`，已验收全要）：偷看打字（输入框有输入就探头看，2.5s 无输入收回）、打招呼（切换 bot 时播一次，挂载首次不算）、伸懒腰（idle 35s 后每 35~55s 随机）、打哈欠（idle 满 180s 来一次）、被夸（消息带夸奖词 → 回答完成的 happy 窗口替换成得意 pleased，也冒 ♡）、惊讶（**连点 3 下**彩蛋；点击梯度 1 击被戳 / 3 击惊讶 / 5 击转晕）。实现：`V3_ACTIONS` 与状态走同一生成管道（`use-mascot-actions.ts` 触发，两层保险只在 idle 演且渲染层再 gate；散步优先级最高 walk > action > mascotState）；被夸的发送文本经 `ChatPanelHost.onComposerSend` 回调穿透到 `useBotWorkspace` 的夸奖计数。
- 挂载点走 React 属性而不是 DOM 注入：`App.tsx` → `ChatPanelHost` 的 `composerMascot` → `ChatSurface` 把它排在输入框卡片的右上角（`-translate-y-[80%]`；`(cy+r)/512 = 79.7%`，所以不管 `size` 多大，球底边都正好落在输入框上边缘，看起来像站在框上）。球站的其实是「composer 栈最顶上那行」：Goal 控制条占着编辑器正上方一行时（非终态 goal；占行判据与 `GoalControlStrip` 同用 `buildGoalControlStripView`），wrapper 的 `top` 上移 2.375rem（条高 2rem + 条下边距 0.375rem，`goal-workflow.css`），球改站在条顶，不压条上的主操作/「⋯」按钮（2026-11-12 反馈「助手形象会遮挡 goal 命令的执行」的修复）；球顶对消息区的探出量与无条时一致。

## 8. 测试

- `tests/server/bots.test.mjs`：记录规范化、名字校验、心跳时间推进、`inspectBotWork` 的信号判定、心跳指令契约（固定头自进化授权 / 模板三分支：存在用模板、缺失回退种子、bot 重写后 `[报告]` 与不 commit 仍在场）、种子模板引导式（无场景化步骤）与播种不覆盖、`parseHeartbeatReport` 的首行契约。
- `tests/server/bot-mascot.test.mjs`：吉祥物外观的归一化（默认值、大小写、部分合并、非法颜色退回、`animated` / `showOnComposer` 只认显式 `true`）与接口往返（POST/GET/列表都带 `mascot`，PATCH 只改一色不影响另一色、只改显示开关不重置动画）。
- `tests/frontend/bot-mascot.test.ts`：状态映射优先级（纯函数）＋ 生成 CSS 的契约（6 状态 × 身体/左右眼关键帧、时长与几何数据一致、`prefers-reduced-motion` 与静态开关、弯月眼只在 `happy` 出现）＋ 组件用 CSS 变量换色 ＋ 溜达是单次动画而不是无限循环 ＋ 表情增强（豆豆眼几何、张望挂 `data-ambient`、八个符号的关键帧与绑定、关动画/减弱动效的降级）。
- `tests/frontend/mascot-interactions.test.ts`：悬停 / 戳 / 连点转晕与东张西望的时机逻辑（纯控制器 + 假时钟：随机间隔 5~9s、一段 3.3s、悬停/点击立即打断、忙状态不张望）。
- `tests/frontend/bot-mascot-composer-toggle.test.ts`：「在输入框上方显示」开关的接线契约（服务端默认值、前端类型、App 判据 `!== false`、弹窗里的开关与草稿默认值、三处开关共用 SwitchRow、双语文案）。
- `tests/frontend/bot-mascot-goal-strip.test.ts`：goal 条占行时吉祥物上移让位的接线契约（占行判据与条同源、`top` 随占行切换、上移量 2.375rem 与条的 `height: 2rem` + 下边距 0.375rem 几何同步）。
- `tests/frontend/bot-status-summary.test.ts`：侧栏状态小字的优先级（出错 > 在忙 > 睡了 > 时间）与相对时间分段，两种语言的文案键都齐。
- `tests/server/routes/bots.test.mjs`：建/列/改/删、记忆读写、项目注册与反注册、心跳的 `nextRunAt` 重算、投喂端点（追加落盘 + 只在心跳开着时提前节拍）。
