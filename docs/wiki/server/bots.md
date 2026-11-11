# Bot 模式

> 一个 bot 就是一个长期存在的「人」：一条永不重置的会话、一个自己的目录、一份自己可编辑的 `MEMORY.md`，以及一个可以开关的自主节拍。
> 设计背景见 [一个主体、两只手](../../architecture/cross-project-orchestrator.zh-CN.md) 和 [单 bot 界面设计](../../architecture/single-bot-workspace-ui.zh-CN.md)。

## 1. 数据模型

| 东西 | 位置 |
| --- | --- |
| bot 记录 | `bots` store → `<dataDir>/storage/conversations/global/bots.json` |
| bot 目录 | `<dataDir>/bots/bot-<id 前 8 位>/` |
| 记忆 | `<bot 目录>/MEMORY.md` |
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
  heartbeat: {
    enabled, intervalMinutes, nextRunAt,
    lastWakeAt, lastSessionId, wakeCount, idleCount,
    lastIdleReason, lastError,
  },
  mascot: { body, eye, animated },   // 吉祥物外观，见 §7.2
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
| 其它 | 不醒，只把 `idleCount` 加一并把 `nextRunAt` 推后 |

不醒的那一班**不往对话里写任何东西**——否则一小时一条「我醒了」，一天就把会话淹了。这是把「心跳」和「打卡」分开的地方。

醒来时用的是 `runPrompt(bot.sessionId, ...)`，推进同一条会话；会话忙（用户正在跟它说话）时这一班直接跳过，不排队、不抢上下文。

## 5. 上下文预算

系统不做特殊处理：bot 可以由 `quickforge-api` 技能自己读油表（`qf-api context`）、自己触发压缩、自己把结论写回 `MEMORY.md`。会话之所以能一直活着，靠的是这套自我管理，而不是服务端替它裁剪。

## 6. HTTP 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/bots` | 列表（附 `busy` / `status`） |
| POST | `/api/bots` | 建 bot：`{ name }`。会建目录、`MEMORY.md`、注册项目、建会话 |
| GET | `/api/bots/:id` | 单条 |
| PATCH | `/api/bots/:id` | 改名字 / 技能 / 思考档 / 心跳（改间隔会重算 `nextRunAt`，关掉会清空它）/ 吉祥物外观（`mascot`，可只传部分字段）。**改名不动目录**——目录由 id 决定 |
| DELETE | `/api/bots/:id` | 删记录和项目注册，**目录保留** |
| GET | `/api/bots/:id/memory` | 读 `MEMORY.md` |
| PUT | `/api/bots/:id/memory` | 写 `MEMORY.md` |
| POST | `/api/bots/:id/wake` | 立刻催醒一次（跳过「有没有活」的判断） |

## 7. 前端

- 侧栏左上角「对话 / BOT」分段切换 bot 模式（`ui-store.botMode`）：logo 行下方独占一行、两个等宽选项，选中项浮起（`SidebarHeaderNav.tsx` + `sidebar-classes.ts` 的 `modeSwitcher*`）。这段分段控件**只在侧栏展开时渲染**；侧栏折叠后左上角只留「展开侧栏」一枚按钮（平时显示 favicon，hover / 聚焦换成 `PanelLeftOpen`），折叠态不再单独放模式切换图标，切模式要先摊开侧栏。点当前已选中的那一项不会再触发一次切换。
- 两个方向的补偿不对称，都值得知道：**进 bot 模式**时若当前会话不属于任何 bot，会自动打开第一个 bot（否则主区会停在普通会话上自相矛盾）；**退出 bot 模式**时若当前会话属于某个 bot，则落回新对话空态。后半条不是洁癖——不改的话主区会继续显示那个 bot 的历史对话，而 `chatCapabilities` 仍按 bot 项目判定，顶栏、吉祥物、消息落点全都还挂在 bot 上。实现在 `App.tsx` 的 `previousBotModeRef` effect 里（不能塞进 `toggleBotMode`：那里读 `agentManager.currentSessionId` 会被 `react-hooks/refs` 判成 render 期间读 ref）。
- bot 模式下侧栏换成 bot 列表（`BotSidebarList`），一行一个，与会话行同一套样式。
- 「新对话」按钮在 bot 模式下变成「创建 bot」。
- **主区复用普通对话视图**：bot 就是一条会话，点开走 `requestOpenSession(sessionId)`。但「项目 + 分支」是普通对话语境的控件，这里有两处收敛：
  - bot 模式下顶栏不显示项目胶囊与分支菜单，空态也不渲染项目胶囊（`App.tsx` 的 `headerProject` / `emptyStateProject`）。
  - bot 的专属目录虽然也注册成项目（`kind: 'bot'`，工具需要它的 path 当 workspaceRoot），但它不是「用户的当前项目」：`POST /api/project/active` 遇到 bot 项目只把项目返回给调用方、不改写 `activeProjectId`，`getActiveProject` 的命中与兜底都跳过 bot；前端 `useProject` 的 `applyActiveProject` 是写「当前项目」的唯一出口，同样拒绝 bot。否则打开一次 bot，之后每次「新对话」都会落进 bot 目录。
- 切进 bot 模式时若当前会话不属于任何 bot，会先刷新一次列表、再自动打开第一个 bot（`toggleBotMode`）。没有 bot 时主区保持原样，用侧栏「创建 bot」创建。
- **「项目被删除」的恢复逻辑必须跳过 bot 项目**：`getDeletedProjectRecoveryDecision` 的判据是「当前项目不在 `projects` 列表里」，而 bot 项目按设计永远不在（`project-store` 过滤 `kind: 'bot'`）。不跳过的话，每次点开 bot 都会被判成「项目已删除」，随即新建一条空会话顶掉 bot 的对话——表现就是「bot 的历史对话不见了」。所以判据收整个 `currentToolProject`、先看 `kind`，而不是只收 id。
- **它的会话不能 fork、也不能回滚对话**：能力矩阵 `src/lib/chat-capabilities.ts` 的 `BOT_CHAT_CAPABILITIES` 关掉 `forkFromMessage` / `rollback` / `retry`（`compaction` 保留，它自己要压上下文），`App.tsx` 在 bot 语境把它注入 `ChatPanelHost`，消息行因此**不渲染**这些图标；服务端 `rollbackSessionMessages` 另有一道无条件闸门——会话落在 `kind: 'bot'` 的项目里就 403 `BOT_SESSION_IMMUTABLE`，绕过 UI 直接打 API 同样拒。理由：会话就是它的记忆，压缩后的摘要本身是数组里的一条消息，剪短会让 `contextCompaction.summaryMessage` 悬空，之后每轮喂给模型的都是幻象。**文件回滚（`/rollback-turn`）不碰 messages，照常可用。**
- 设置弹窗（`BotSettingsDialog`）放吉祥物外观、工作空间路径、`MEMORY.md` 编辑、心跳开关与间隔。

**技能不归 bot 管。** 会话能激活哪些技能由全局技能与项目技能决定（和普通会话一致），bot 记录里没有 `skills` 字段——早先有过一个 per-bot 开关，但它从来没传给会话，等于装饰品，已删除。

### 7.1 空会话：为什么打开 bot 要先 ensure、还不能走 metadata 预检

空会话**不落盘**：`persistSessionUnlocked` 会把 `messages.length === 0`（且没有 goal）的会话当空壳删掉。所以 `bot.sessionId` 只保证「永远是同一个 id」，不保证此刻存储里有它。

由此两条必须一起做，缺一条就会「未找到该对话」：

1. 打开前先 `POST /api/bots/:id/session`（`ensureBotSession`）把会话在内存里建起来。
2. 打开时带 `skipMetadataPrecheck`——前端 `openSessionFromSettings` 默认会先查本地会话元数据，而内存态的空会话根本没有那条记录。跳过预检后，真正的存在性由随后的 `loadSession` 判定（它会走 `/api/agents/:id/state`，内存里在就能返回）。

第一次发言之后会话落盘，之后两条都退化成普通路径。

### 7.2 吉祥物：界面里的形象与设计稿同一套数据

两处：**输入框右上角**（bot 模式下有当前 bot 时，`size={104}`，约 61px 球径，贴在输入框上边缘，闲着时偶尔走一小段）和**侧栏 bot 行首**（24px，替换原来的状态圆点），都在 `src/components/bots/mascot/`。

> **尺寸不是随便给的**：画布 512 里球只占 300（余量留给跳跃），所以只要 `size` 的 58.6% 才是球径。设计稿 `mascot-v3.html` 用 220 画布 → 球径 129px，压扁拉伸看得一清二楚；产品里给过 64（球径 37px），10% 的形变只有 3px，用户的观感就是「不如设计稿生动」。给到 104 才追平观感。小尺寸（`size <= 64`）会自动分派 `-small` 增强关键帧（位移 ×1.35、形变 ×1.3），但那只救得了眼神，救不了 squash & stretch。


- `mascot-anim.css` 与 `mascot-geometry.ts` 是**生成文件**，来自 `docs/design/bot-mascot/generate-bot-gif.py --emit-web`。设计稿的 GIF 和界面里的动画共用同一套姿态函数（关键帧采样成 CSS `matrix()` / `translate+rotate+scale`），所以不会出现「素材好看、界面走形」。
- 换色只改两个 CSS 变量（`--qf-mascot-body` / `--qf-mascot-eye`），不重新生成任何素材；这就是没用 GIF 当界面素材的原因。
- 动作由 `resolveMascotState()`（纯函数，`mascot-state.ts`）从现有信号推导，优先级：出错 / 等审批 → `alert`，工具执行 → `working`，流式 → `thinking`，刚完成 → `happy`（`useMascotState` 只对这一种保持 1.8s），心跳关掉 → `sleepy`，其余 `idle`。
- 侧栏行没有当前会话的细粒度状态，只用 bot 自身字段拼：`heartbeat.lastError` → `alert`、`busy` → `working`、心跳关 → `sleepy`。原来那个 1.5px 状态圆点已被吉祥物取代。
- 侧栏 24px 的尺寸（球径 14px）只够看出「在动」，眼睛动作演不出来，所以**状态靠文字讲**：行右侧那截小字由 `botStatusSummary()`（`bots-data.ts`）算，优先级 出错 > 在忙 > 睡了 > 上次醒来多久前 > 还没醒过，隔一分钟重算一次；`hover` 时让位给设置按钮。设计规范里「运行状态应保留文字」说的就是这件事。
- 关掉动画（设置里的开关）或系统 `prefers-reduced-motion: reduce` 时，动画整体停住、停在初始姿态。
- 输入框那只**默认安静**：只有 `mascotState === 'idle'` 时才可能散步，由 `useMascotStroll` 控制节奏（隔 20 秒走一轮 9 秒，其余时间站定），横向路线在 `mascot-stroll.css`（手写，播 1 次不是无限循环，末帧回到原点所以不会跳）。有状态（思考/干活/提醒/完成）时**不走路**，站定演那个状态。
- 挂载点走 React 属性而不是 DOM 注入：`App.tsx` → `ChatPanelHost` 的 `composerMascot` → `ChatSurface` 把它排在输入框卡片的右上角（`-translate-y-[80%]`；`(cy+r)/512 = 79.7%`，所以不管 `size` 多大，球底边都正好落在输入框上边缘，看起来像站在框上）。

## 8. 测试

- `tests/server/bots.test.mjs`：记录规范化、名字校验、心跳时间推进、`inspectBotWork` 的信号判定。
- `tests/server/bot-mascot.test.mjs`：吉祥物外观的归一化（默认值、大小写、部分合并、非法颜色退回、`animated` 只认显式 `true`）与接口往返（POST/GET/列表都带 `mascot`，PATCH 只改一色不影响另一色）。
- `tests/frontend/bot-mascot.test.ts`：状态映射优先级（纯函数）＋ 生成 CSS 的契约（6 状态 × 身体/左右眼关键帧、时长与几何数据一致、`prefers-reduced-motion` 与静态开关、弯月眼只在 `happy` 出现）＋ 组件用 CSS 变量换色 ＋ 溜达是单次动画而不是无限循环。
- `tests/frontend/bot-status-summary.test.ts`：侧栏状态小字的优先级（出错 > 在忙 > 睡了 > 时间）与相对时间分段，两种语言的文案键都齐。
- `tests/server/routes/bots.test.mjs`：建/列/改/删、记忆读写、项目注册与反注册、心跳的 `nextRunAt` 重算。
