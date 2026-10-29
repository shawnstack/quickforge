# Dreaming 记忆固化系统

Dreaming 是 QuickForge 的后台记忆能力：它周期性回看**已经发生过的会话轨迹**，把其中稳定的事实、可复用的经验、踩过的坑整理成**一份笔记**，并让后续任务自动看到它们。

它回答的问题不是"这一轮对话要记什么"，而是"**这么多轮对话跑完之后，哪些东西值得留下**"。

```txt
会话 / 工具调用记录（SQLite 权威存储）
        ↓  按时间窗口采集 + 轨迹投影
Dreaming 后台任务（独立 worker，不进 Agent Runtime）
        ↓  单次模型调用（当前笔记 + 新会话 → 新的完整笔记）
代码只做格式与大小校验
        ↓
DREAMING.md 整份覆盖（与 MEMORY.md 是两个独立文件）
        ↓
两份文件一起注入系统提示 + recall_experience 工具
        ↓
下一次任务自动使用
```

## 1. 设计目标与边界

**目标**

- **两个文件，各管各的**：`~/.quickforge/MEMORY.md` 是人写的，`~/.quickforge/DREAMING.md` 是 dreaming 写的。谁都不需要知道对方的格式，也没有标记、没有保存时重拼、没有"谁覆盖了谁"的问题。
- **一份笔记**：`DREAMING.md` 的整份内容就是记忆，一个 bullet 列表。
- **一次调用**：一轮 dreaming 只调用模型一次，把「当前笔记 + 新会话」一起交给它，拿回「新的完整笔记」。不做逐条操作清单、不做行级 diff 落库。
- **全自动**：没有人工确认弹窗，代码只做格式校验（是不是 bullet、有没有超长、有没有凭据）。
- **不进 Agent Runtime**：Dreaming 是一次普通模型调用，不是一次 Agent 会话。它不创建 session、不出现会话列表、不占用工具审批链路。
- **可观测**：每次运行留 `dreaming_runs` 记录（读了哪些会话、改了什么、模型原始回复）。

**明确不做**

- 不做结构化记忆库：没有 `memories` 表、没有 FTS 索引、没有 fingerprint 去重、没有 confidence/strength、没有衰减淘汰、没有逐条审计。v17 把 v13 建的四张表**直接 drop**（旧数据丢弃，下一次运行从同一批会话重建笔记）。
- 不做向量检索 / embedding。笔记只有几十条，全量注入即可，没有"召回不准"的空间。
- 不做独立进程 / 独立端口 worker。desktop 与 Android 都复用同一个本地 server，这里要的是**逻辑隔离**：独立模块、独立设置、独立运行记录、独立单飞锁。
- 不做人工确认、不做 per-session 记忆（那只是缓存）、不做跨设备同步。

## 2. 数据模型

SQLite 里只有运行日志和一张 6 列的用量表；记忆本身在两个文件里：

| 位置 | 归属 | 内容 |
|---|---|---|
| `~/.quickforge/MEMORY.md` | 用户 + `manage_global_memory` | 自由 Markdown，上限 16KB |
| `~/.quickforge/DREAMING.md` | Dreaming 独占 | bullet 列表，上限 8KB（实际写到 3800 字节以内） |
| `dreaming_note_stats`（SQLite） | Dreaming | 每条笔记的 `recall_count` / `last_recalled_at` / `created_at` |

两个文件互不读写：保存 `MEMORY.md` 不会碰 `DREAMING.md`，dreaming 覆盖 `DREAMING.md` 也不会碰 `MEMORY.md`。统计表不参与注入，只在下一轮 dreaming 时用来找出「从没被召回过的老笔记」。

```sql
CREATE TABLE dreaming_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  session_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,   -- 本次新增的笔记行数
  updated_count INTEGER NOT NULL DEFAULT 0,
  retired_count INTEGER NOT NULL DEFAULT 0,   -- 本次移除的笔记行数
  rejected_count INTEGER NOT NULL DEFAULT 0,  -- 被代码丢弃的行数（敏感内容 / 超限）
  summary TEXT,
  operations_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(operations_json)),
  error TEXT,
  model_label TEXT,
  input_chars INTEGER NOT NULL DEFAULT 0,
  sessions_json TEXT NOT NULL DEFAULT '[]',
  raw_response TEXT,
  content_language TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER
);
```

`operations_json` 现在存 `{ added: string[], removed: string[], dropped: [{reason, content}] }`——就是本次改动前后的行 diff。旧 run 里是操作数组，读取时会被归一成空 diff（`server/sqlite/dreaming-repository.mjs` 的 `toRun`），页面不需要按 run 的年代分支。

**迁移**：append-only。v13 建记忆域四张表，v14 补运行详情列，v15 记输出语言，v16 加过向量表（v17 一并删除），**v17 `drop_structured_memory_store` 删掉 `memories` / `memories_fts` / `memory_events` / `memory_embeddings`**。

## 3. 笔记格式契约

`~/.quickforge/DREAMING.md` 全文就是下面这样，没有标记、没有第二段：

```markdown
## 记忆笔记（Dreaming 维护，请勿手工编辑本文件）

- 用户偏好中文交互，代码注释用英文。
- [pitfall] 回滚 commit 前先用 git log 确认后续没有改动。
- 发布前必须跑完整 npm run test / lint / build。
```

- 一行一条，`- ` 开头。可选的 kind 前缀：`[fact]` / `[preference]` / `[experience]` / `[pitfall]` / `[decision]`。
- 单行 ≤ 300 字符，最多 60 条，整份 ≤ 3800 字节（落盘上限 8KB）。
- 超出上限时**从尾部截断**，被截掉的行计入 `dropped`；不是截断文字。

代码侧的实现是 `server/dreaming/notes.mjs`：`parseNoteLines()` 从任意 markdown 抽 bullet（跳过标题、空行、代码围栏），`normalizeNoteLines()` 去重 + 截断 + 敏感内容过滤，`composeAutoSection()` 渲染成带标题的整份文件。

## 4. 处理流程

### 4.1 采集（collect）

数据源只有一处：SQLite 权威会话存储。

- `sessions` 表筛出 `updated_at_ms` 落在时间窗口内的会话，按时间倒序，最多 40 个。
- 对每个会话取 `session_messages` 的尾部窗口（`ORDER BY seq DESC LIMIT 300` 后反转），不做整会话物化——项目历史上有过整会话读取导致 OOM 的教训。
- **只投影两类消息**：`user` 消息，和 assistant 的**最终回答**（没有 toolCall 且 stopReason 不是 toolUse / error / aborted）。
- 预算：单会话 30 000 字符、单条 user 1 500 字符、单条 assistant 3 000 字符、整体 100 000 字符。超总预算时按**纠正优先、其次按时间从旧到新**丢弃——一次纠正过的会话比一次顺利的会话每字符更值钱，所以不能单纯按时间砍。
  - 信号由 `correctionSignals()` 给出：user 消息里出现「不对 / 错了 / 应该 / 改成 / 实际上 / actually / instead / revert…」或 assistant 的 `stopReason` 是 `error`/`aborted`，各计 1。
- 不用的内容：toolCall 与 toolResult、thinking/reasoning 块、附件与图片、tool 的 `details` 与耗时。

### 4.2 提示词（prompt）

系统提示告诉模型「你在维护一份会被注入到每次会话的笔记列表」，并给出合并规则：仍然成立的保留、被修正的就地改写、被证伪的删掉、重复的合并；输出只有 bullet 列表，没有前言、没有标题、没有代码围栏。

user 消息包含：时间窗口、输出语言硬要求、**当前笔记列表**（`- ...` 逐行）、敏感内容策略、transcript。

### 4.3 写回

1. `normalizeNoteLines(reply)` 抽行、去重、截断、按 `allowSensitive` 丢弃疑似凭据。
2. **掉线保护**：如果回复非空但一条 bullet 都抽不出来（模型跑题说了段散文），本次 run 标记 `failed` 且**不写盘**——一次不合契约的回复不该清空已有笔记。真正空回复（`''`）是合法的「今天没有值得记的」，会把文件清空。
3. `diffNoteLines(before, after)` 算出 added / removed，写进 `operations_json`。
4. `writeDreamingNotes(composeAutoSection(lines))` 整份覆盖 `DREAMING.md`。`MEMORY.md` 完全不参与——它甚至不会被打开。
5. `syncNoteStats()` 让 `dreaming_note_stats` 与文件严格对齐：新笔记载入（记录 `created_at`），消失的笔记删行（同样措辞以后重新加回来时从 0 开始，不继承旧计数）。
6. **漂移告警**：`added + removed` 占「改前/改后较大者」的比例 ≥ 80%，且改前至少 5 条时，run 仍记 `succeeded`，但在 `error` 里写「本次改动了 N/M 条笔记，可能发生了记忆漂移」。不阻断——笔记是模型的判断，代码只负责让它显形。
7. `operations.notesAfter` 保存本次结束后的完整列表，供回滚使用。

### 4.4 失败与边界

- 全局记忆关闭 → run 记 `skipped`，不动文件。
- 窗口内没有会话 → `skipped`，推进 `lastRunAt`。
- 没配任何模型 → `failed`，错误文案写进 run。
- 写盘失败 → run 仍是 `succeeded`，失败原因写进 `error`（笔记没更新，下次再来）。
- 进程内单飞：重入返回 `{ skipped: true, reason: 'already_running' }`，不排队。

## 5. 使用侧

### 5.1 系统提示注入（两个独立段）

- `readGlobalMemoryPrompt()` → `<global_user_memory source="~/.quickforge/MEMORY.md">`：用户自己写的那份。
- `readDreamingNotesPrompt()` → `<dreaming_memory source="~/.quickforge/DREAMING.md">`：dreaming 写的那份。

两个段分开而不是拼成一坨，是为了让模型（和人读 prompt 时）能区分"用户告诉我的"和"过去会话总结出来的"。记忆总开关关闭时两段都不注入。

`recall_experience` 工具读的也是 `DREAMING.md`。

### 5.2 `recall_experience` 工具

```ts
recall_experience({ query?: string, kind?: Kind, limit?: number })
```

读 `DREAMING.md`，按行做子串过滤（有空格的多词查询要求每个词都命中），返回最多 `limit` 条。没有索引、没有打分、没有召回计数——它存在的意义只是让模型能**显式地**说"关于 X 我知道什么"，而不是翻整份文件。

### 5.3 来源与回滚

- **来源**：`GET /api/dreaming/notes` 会扫最近 50 个 run 的 `notesAfter`，给出每条笔记**首次出现**的 run 与时间（`firstSeen`）。没有独立的来源表，也不需要模型写 `evidence`——run 快照本身就是证据。
- **回滚**：`POST /api/dreaming/runs/:id/restore` 把那次 run 的 `notesAfter` 写回 `DREAMING.md`。旧 run 没有快照时返回 409，而不是用半个 diff 猜一个列表。
- **删除**：`DELETE /api/dreaming/notes/:id`（id = 笔记文本的哈希）。它直接改文件，所以下一轮 dreaming 看到的已经是删过的列表，不可能把这条写回来。

### 5.4 反馈闭环（召回计数）

笔记是文件，文件本身不可能知道「这条有没有被用过」。所以反馈存在一张只有 6 列的表里：

```sql
CREATE TABLE dreaming_note_stats (
  note_id TEXT PRIMARY KEY,      -- noteIdOf(text)，不是数据库 id
  note_text TEXT NOT NULL,
  recall_count INTEGER NOT NULL DEFAULT 0,
  last_recalled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

- **写入**：`recall_experience` 每次真正返回某条笔记，`recordNoteRecall()` 给那几条 `recall_count + 1` 并更新 `last_recalled_at`。用不上存储时（工具在 server 外被调用）静默跳过。
- **读取**：`listNoteStats()` 在下一轮 dreaming 里算出冷笔记。判定条件是「距 `created_at` ≥ `pruneUnusedDays` 天，且 `recall_count` ≤ `pruneMaxRecalls`」；两个阈值都在设置的「高级配置」里可改（默认 60 天 / 0 次，即只算从未被召回的）。
- **两种用法，由 `pruneStaleNotes` 决定**：
  - **关闭（默认）**——这批冷笔记**不直接删**，而是作为 `## Never recalled (deletion candidates)` 段交给模型，并明确「进入这个列表是因为没人搜过它，不是因为它错了」。这是「强度衰减」在这里的形态——**信息，而不是规则**：删不删仍由模型结合本轮会话判断，避免代码把一条少用但关键的安全红线淘汰掉。此时还有 `pruneMinNotes`（默认 40 条）门槛：短列表上「从没被召回」是普遍现象而不是信号，提删除只是噪声。
  - **开启**——冷笔记在**模型运行之前**就按规则从 `DREAMING.md` 删除（模型没有否决权），随后模型只面对剩下的列表重写。被删的条目写进本次 run 的 `operations.pruned`，`retiredCount` 与 summary 一并计入，运行详情里单列一组「到期自动删除」。此时不再生成候选段（已经删过了）。
- **年龄的语义**：`created_at` 是 Dreaming 第一次记录这条措辞的时间，不是笔记「诞生」时间。手工写进 `DREAMING.md` 的行没有 stat 行，年龄未知，**永不参与自动删除**——按猜测删掉无法定年的内容是更坏的错误。
- **清理**：每轮写回后 `syncNoteStats()` 对齐文件，消失的笔记连同统计一起删除。

注：没有「按 strength 排序召回」这一步，因为召回是全量注入 + 子串过滤，本来就没有排序空间。

## 6. API

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dreaming` | 设置 + 生效模型 + 最近一次 run + 笔记条数 |
| PUT | `/api/dreaming/settings` | 更新开关 / 定时 / 模型 / 敏感信息策略 / 冷笔记阈值（`prune*`） |
| POST | `/api/dreaming/run` | 立即处理；运行中 409 |
| GET | `/api/dreaming/runs?page&pageSize` | 运行历史（分页） |
| GET | `/api/dreaming/runs/:id` | 运行详情（含行 diff、完整快照与模型原始回复） |
| POST | `/api/dreaming/runs/:id/restore` | 把该次运行的笔记快照写回 `DREAMING.md`（无快照 409） |
| GET | `/api/dreaming/notes?query&kind&page&pageSize` | 笔记浏览（只读，含 `firstSeen` / `recallCount`） |
| DELETE | `/api/dreaming/notes/:id` | 删除单条笔记（直接改文件，下一轮不会复活） |

已删除：`/api/dreaming/memories`（含 `:id/retire`）、`/api/dreaming/embeddings/backfill`。

## 7. 设置项

`settings` store，key `dreaming-settings`：

```json
{
  "enabled": false,
  "executeTime": "03:00",
  "modelRef": null,
  "allowSensitive": true,
  "contentLanguage": "auto",
  "pruneStaleNotes": false,
  "pruneMinNotes": 40,
  "pruneUnusedDays": 60,
  "pruneMaxRecalls": 0,
  "nextRunAt": null,
  "lastRunAt": null
}
```

默认 `enabled: false`——后台任务默认关闭，由用户在设置页显式打开。**开启即定时**：没有独立的“定时处理”开关，每天 `executeTime` 自动跑一次；「立即处理」只是手动提前触发。

四个 `prune*` 字段是「冷笔记淘汰」的全部开关，`normalizeDreamingSettings()` 对数字做 clamp（`pruneMinNotes` 1–500、`pruneUnusedDays` 1–3650、`pruneMaxRecalls` 0–1000），非法值回默认而不是回边界值——打错字不能变成「删掉所有超过 1 天的笔记」。`pruneStaleNotes` 默认 `false`：写入 `DREAMING.md` 的删除是不可逆的（只有更早一次的 run 快照里还留着这些行），所以由用户显式开启。

`modelRef` 的解析优先级：指定的模型 → 最近对话模型 → 目录第一条。指定的模型失效时降级到下一优先级而不中断 run。

`contentLanguage` 默认 `auto`：`detectContentLanguage()`（`collect.mjs`）只采样 **user 消息**文本（assistant 正文与代码注释天然偏英文，会把判断拉偏），比较加权字符数（1 个 CJK 字 ≈ 4 个拉丁字母），样本字母数 < 12 时返回 `null`。结果写进 `dreaming_runs.content_language`，详情页可见。

## 8. 前端

设置 → 自动化 → Dreaming：

- 状态点 + 「立即处理」+ 开关；
- 统计：下次运行 / 上次运行 / 笔记条数 / 运行次数；
- 设置：模型（可搜索下拉）、执行时间、输出语言、敏感内容；
- 「高级配置」（默认折叠）：到期自动删除开关 + 三个数字（冷笔记天数、召回次数上限、候选列表启用条数），数字输入在失焦 / Enter / 步进时才提交，越界值按服务端同样的范围 clamp；
- 「笔记」页签：`DREAMING.md` 的只读列表（kind 徽标 + 正文 + 召回次数 + 首次记录时间）、关键词搜索、kind 筛选、分页、单条删除；明确标注「这个文件由 dreaming 整份重写，要自己加内容请写在 MEMORY.md」；
- 「运行历史」页签：每次运行的会话数 / 新增 / 移除 / 丢弃 / 耗时；点开进入运行详情（shadcn 卡片结构：页头「返回历史」+ 标题与状态/触发/模型/语言徽标，统计瓦片条（新增/移除/丢弃按语义色着色，丢弃为 0 时不占格），失败原因为浅色 destructive 告警条，结论段，变更明细为 `+ / − / ✕` 行 diff（丢弃行附原因小字，`operations.pruned` 另起一组「到期自动删除」并注明不是模型的判断），模型原始响应折叠且带说明与等宽代码块，页脚「恢复到此版本」）。

设置 → 记忆：只编辑 `MEMORY.md`；当 `DREAMING.md` 有内容时多一行说明（它的笔记在另一个文件里，不在此处编辑）。

## 9. 与旧方案的区别

| 维度 | v13–v16（结构化经验库） | v17（一份笔记） |
|---|---|---|
| 记忆载体 | `memories` 表 + `MEMORY.md` 自动区 | 独立的 `DREAMING.md` |
| 写入 | 模型输出 JSON 操作清单 → 逐条硬校验 → 单事务落库 | 模型输出新列表 → 格式校验 → 整份覆盖 |
| 与用户文件的关系 | 同一文件里靠标记划界，保存时要重拼 | 两个文件，互不读写 |
| 去重 | `fingerprint` 唯一索引 | 模型自己合并（提示词里要求） |
| 质量信号 | `confidence` / `strength` / 衰减 / 召回计数 | 只保留召回计数（一张 6 列表），默认作为删除候选提示，可选用作到期自动删除规则 |
| 召回 | FTS5 bm25（曾加向量 + RRF） | 全量注入 + 子串过滤 |
| 审计 | `memory_events` 逐条 | 每次运行的 added / removed / notesAfter |
| 来源 | `evidence_json` 每条 | 每条笔记首次出现的 run（扫 run 快照得出） |
| 回滚 | 手改数据库 | `POST /runs/:id/restore` 写回快照 |
| 漂移防护 | 无 | 改动率 ≥ 80% 且笔记 ≥ 5 条时告警 |
| 代码量 | 4 张表 + 3 个模块 + 5 个 repository 方法族 | 1 张表 + `notes.mjs` + 1 次调用 |

**为什么删**：结构化那套的价值来自"条目多到需要检索"。实际笔记只有几十条，全量注入已经够用；为此维护去重、评分、衰减、审计、向量索引，换来的是三者不一致的风险（笔记与库不同步、向量与模型不匹配、衰减把有用条目淘汰掉）。最终选择让模型成为唯一决策者，代码只保证文件不被写坏。

## 10. 已知取舍

- **没有语义召回**：笔记几十条全量注入，不需要。真需要时再加"查询改写 + LLM 挑选候选"，而不是引入向量库。
- **反馈闭环默认是"提示式"的，自动删除是可选规则**：召回计数默认只用来生成冷笔记候选，删不删由模型决定；打开「到期自动删除」后，代码才按天数 / 召回次数直接删除，模型没有否决权。用一张 6 列表存计数，不是恢复旧的 `strength` 评分体系。
- **来源只到 run 粒度**：能看到「这条笔记首次出现在哪次运行」，看不到「它由哪几句对话支撑」。要更细就得让模型写 `evidence`，那会把 300 字符预算吃掉。
- **模型可以一次重写全部笔记**：提示词要求保守修改 + 排序，代码只在改动率 ≥ 80% 时告警，不阻断。掉线保护（非空但无 bullet → failed）是硬兜底。
- **旧记忆不迁移**：v17 直接 drop 表，下一次运行从会话历史重建。
- **全局单份笔记**：项目 A 的坑会注入到项目 B。要按项目分，只需再加一个文件路径，不要回到带 scope 字段的表。
