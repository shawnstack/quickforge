# Dreaming 记忆固化系统

Dreaming 是 QuickForge 的后台记忆固化能力：它周期性回看**已经发生过的会话轨迹**，把其中稳定的事实、可复用的经验、踩过的坑整理成结构化长期记忆，并让后续任务在需要时检索到它们。

它回答的问题不是"这一轮对话要记什么"，而是"**这么多轮对话跑完之后，哪些东西值得留下**"。

```txt
会话 / 工具调用记录（SQLite 权威存储）
        ↓  按时间窗口采集 + 轨迹投影
Dreaming 后台任务（独立 worker，不进 Agent Runtime）
        ↓  单次模型调用 + 结构化操作清单
硬校验（代码）→ 记忆库（SQLite + FTS5）
        ↓
MEMORY.md 自动区重写 + 系统提示注入 + recall_experience 工具
        ↓
下一次任务自动使用
```

## 1. 设计目标与边界

**目标**

- **全自动**：没有人工确认弹窗。四个动作（提取事实 / 总结经验 / 识别错误 / 更新认知）由一份提示词交给模型判断，代码只做合法性校验与落库。
- **不进 Agent Runtime**：Dreaming 是一次普通模型调用，不是一次 Agent 会话。它不创建 session、不出现会话列表、不占用工具审批链路。
- **可观测**：每次运行都留 `dreaming_runs` 记录 + 逐条操作明细，设置页能看到"处理了什么、结果如何、哪些被拒绝"。
- **零新增依赖**：检索用 `node:sqlite` 自带的 FTS5（trigram tokenizer），不引入向量库或全文索引服务。
- **不污染人工记忆**：`MEMORY.md` 分人工区与自动区，自动区由 Dreaming 独占重写，人工内容逐字保留。

**明确不做**

- 不做独立进程 / 独立端口 worker。desktop 与 Android 都复用同一个本地 server，多进程会带来打包、退出与 supervisor 的连带成本。这里要的是**逻辑隔离**：独立模块、独立设置、独立运行记录、独立单飞锁。
- 不做向量检索、不做 embedding。FTS5 的 bm25 + 强度/新鲜度加权已经够用。
- 不做人工确认、不做 per-session 记忆（那只是缓存）、不做跨设备同步。
- 不做"遗忘"之外的自动删除。淘汰是软删（`status='retired'`），可查可追溯。

## 2. 数据模型（migration v13 + v14 + v15）

迁移按 `server/sqlite/migrations.mjs` 的 append-only 协议追加：v13 建记忆域四张表，v14 给 `dreaming_runs` 补运行详情列。

```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,                    -- mem_<uuid>
  scope TEXT NOT NULL CHECK (scope IN ('global', 'project')),
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'experience', 'pitfall', 'decision')),
  content TEXT NOT NULL CHECK (length(trim(content)) > 0),
  fingerprint TEXT NOT NULL,               -- sha256(normalized content)，去重键
  evidence_json TEXT NOT NULL,             -- [{sessionId, seq, note}]
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  strength REAL NOT NULL CHECK (strength >= 0),
  status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'retired')),
  superseded_by TEXT,
  source_run_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_recalled_at INTEGER,
  recall_count INTEGER NOT NULL DEFAULT 0,
  CHECK ((scope = 'global' AND project_id = '') OR (scope = 'project' AND length(trim(project_id)) > 0))
);
CREATE UNIQUE INDEX idx_memories_fingerprint ON memories (scope, project_id, fingerprint);
CREATE INDEX idx_memories_lookup ON memories (scope, project_id, status, strength DESC);

CREATE VIRTUAL TABLE memories_fts USING fts5 (content, tokenize = 'trigram');

CREATE TABLE memory_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'supersede', 'retire', 'reject')),
  before_json TEXT,
  after_json TEXT,
  run_id TEXT,
  ts INTEGER NOT NULL
);
CREATE INDEX idx_memory_events_memory ON memory_events (memory_id, ts DESC);

CREATE TABLE dreaming_runs (
  id TEXT PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  period_from INTEGER NOT NULL,
  period_to INTEGER NOT NULL,
  -- v14: run detail (see §10.2). `sessions_json` stores one bounded preview
  -- per read session; `raw_response` is the verbatim model reply (<= 8000 chars).
  -- v15: `content_language` is the language the worker was told to answer in.
  model_label TEXT,
  input_chars INTEGER NOT NULL DEFAULT 0,
  sessions_json TEXT NOT NULL DEFAULT '[]',
  raw_response TEXT,
  content_language TEXT,
  session_count INTEGER NOT NULL DEFAULT 0,
  created_count INTEGER NOT NULL DEFAULT 0,
  updated_count INTEGER NOT NULL DEFAULT 0,
  retired_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  operations_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  duration_ms INTEGER
);
CREATE INDEX idx_dreaming_runs_started ON dreaming_runs (started_at DESC);
```

**为什么用 trigram**：中文没有空格分词，默认 `unicode61` 对中文只能整段匹配。trigram 让任意 3 字符以上的中文子串都能命中（已在 Node 24 / 内置 SQLite 上验证），因此不需要引入分词器。代价是索引更大，但记忆条目规模在千级以内，可接受。

**为什么 `fingerprint` 唯一索引**：这是全自动写入不去重的唯一硬保障。相同 scope + 相同归一化内容只能存在一条，重复提取自动变成 `update`。

## 3. 记忆分层

| 层 | 载体 | 写入者 | 注入方式 |
|---|---|---|---|
| L1 人工层 | `MEMORY.md` 人工区 | 用户（含 `manage_global_memory`） | 全文注入 system prompt |
| L2 自动摘要 | `MEMORY.md` 自动区（`<!-- dreaming:auto:begin/end -->` 之间） | Dreaming | 全文注入，≤ 4KB |
| L3 经验库 | SQLite `memories` | Dreaming | 项目相关 top-N 注入 + `recall_experience` 深查 |

- 自动区每次运行**整体重写**（幂等），内容由当前 active 记忆中最强的一批生成。
- 自动区写入用现有 `saveGlobalMemoryDocument` 的原子替换 + 串行锁，但**先读人工区再拼回**：自动区之外的字节从磁盘原样保留，绝不覆盖。
- 自动区限 4KB（`MEMORY.md` 全局上限仍是 16KB）。超出时按 `strength` 截断条目，而不是截断文字。

## 4. 处理流程

### 4.1 采集（collect）

数据源只有一处：SQLite 权威会话存储。

- `sessions` 表筛出 `updated_at_ms` 落在时间窗口内的会话（`scope/project_id/session_id/message_count/title`），按时间倒序，最多 40 个。
- 对每个会话取 `session_messages` 的尾部窗口（`ORDER BY seq DESC LIMIT 300` 后反转），不做整会话物化——项目历史上有过整会话读取导致 OOM 的教训。
- **只投影两类消息**：`user` 消息，和 assistant 的**最终回答**。

```txt
[session:abc | 项目 quickforge | 2026-10-26 | 实现 dreaming 功能]
user: 想实现一个 dreaming 功能…
assistant: 测试全部通过，接下来改 schema。
history(compacted): 之前已经做完存储层，结论是走 SQLite。
user: 继续
assistant: 已按方案改完。
```

“最终回答”的判定是**没有 toolCall 且 stopReason 不是 toolUse / error / aborted** 的 assistant 消息。这条规则一次解决三个问题：

1. 工具调用与其输出**完全不进 prompt**——不需要任何截断启发式，也不会有工具 payload 泄漏；
2. 中间步骤（“我先看一下文件”）不进 prompt，它们是过程而不是结论；
3. 被中断或失败的回复不算答案，不会被当成结论沉淀。

`history(compacted)` 是上下文压缩摘要：它以 `user` 角色存储，但携带 `quickforgeCompaction.kind = 'summary'`，被单独识别后解包 `<compact_summary>` 标签输出。它代表已压缩掉的历史，是那段工作唯一可见的形式，因此必须保留；提示词里明确标注它比直接消息的证据强度弱。

**预算**：单会话 30 000 字符、单条 user 1 500 字符、单条 assistant 3 000 字符、整体 100 000 字符。超总预算时按会话时间从旧到新丢弃——降级为“少处理几个会话”，而不是发出超限请求。因为不含工具输出，100k 字符能覆盖的会话数远多于旧方案。

**不用的内容**：toolCall 与 toolResult、thinking/reasoning 块、附件与图片、tool 的 `details` 与耗时、`body_json`/`meta_json`。

### 4.2 提示词（prompt）

四个动作写进系统提示词，输出是一份 JSON 操作清单：

```json
{
  "summary": "本次处理的一句话结论",
  "operations": [
    { "action": "create", "kind": "pitfall", "scope": "project", "projectId": "…",
      "content": "…", "evidence": [{ "sessionId": "…", "note": "哪句支持它" }], "confidence": 0.8 },
    { "action": "update", "targetId": "mem_x", "content": "…", "confidence": 0.9 },
    { "action": "supersede", "targetId": "mem_old", "replacementId": "mem_new" },
    { "action": "retire", "targetId": "mem_x", "reason": "已被多次纠正" }
  ]
}
```

提示词里同时给出**当前记忆库快照**（active 条目：id / kind / scope / content 一行摘要），这样模型能做"更新认知"而不是重复创建。快照最多 120 条，每条 content 裁到 200 字符。

evidence 只按 `sessionId + note` 引用：transcript 里没有 `seq`，因为只有 user 文本与最终回答被投影，行号对模型没有意义。

### 4.2.1 输出语言（必须显式指定）

「让模型用用户的语言输出」这类软提示在英文系统提示词里会被淹没：实测中文会话沉淀出的记忆全是英文。因此语言改由代码判定，并在 user message 里以硬要求的形式给出：

1. `detectContentLanguage()`（`collect.mjs`）只采样 **user 消息**的文本（assistant 正文与代码注释在本仓库天然偏英文，会把判断拉偏），比较加权字符数：1 个 CJK 字 ≈ 4 个拉丁字母；样本字母数 < 12 时返回 `null`（“ok”、“1+1” 这种不足以代表用户）。
2. 结果为 `zh` / `en` / `null`；`buildDreamingUserPrompt()` 据此生成 `## Output language` 段，写明具体语言、`summary` 同样适用、且不得因为 transcript 里是英文代码就切成英文。
3. 设置项 `contentLanguage`（`auto|zh|en`，默认 `auto`）显式指定的优先级高于自动判定，用于历史混合语言被判错时兜底。
4. 判定结果写入 `dreaming_runs.content_language`，详情页“语言”一栏直接可见——不然用户只能猜为什么输出是英文。

### 4.3 硬校验（apply）

模型输出后，代码逐条校验，不合格的进 `rejected`（写入 run 明细，前端可见），不会静默丢弃：

- `action` / `kind` / `scope` 必须在枚举内；`project` 必须带合法 `projectId`。
- `content` 非空且 ≤ 500 字符（经验条目要能一行读完）。
- `create` 的 `evidence` 非空。
- `update` / `supersede` / `retire` 的 `targetId` / `replacementId` 必须存在且为 `active`。
- `confidence` 裁剪到 `[0, 1]`，默认 0.5。
- `create` 命中已有 `fingerprint` → 降级为 `update`（提高 strength）。
- 敏感内容：`allowSensitive = false` 时复用 `containsSensitiveMemory()` 丢弃条目。

全部操作在**单个 SQLite 事务**里应用，任一非法操作只影响自己，不影响其余条目。

### 4.4 质量评估与淘汰

不用"模型决定忘掉"。用可观测量：

- **strength 累积**：同一条全新提取 `+1`，被 `recall_experience` 召回 `+0.2`，被 `update` 覆盖 `+0.5`。
- **confidence 修正**：模型给的分与 evidence 条数取较小值，避免单条证据的高置信条目。
- **淘汰规则**：`status='active'` 且 `strength < 1` 且 `confidence < 0.5` 且 `last_recalled_at` 早于 30 天 → `retired`。只有三条同时满足才淘汰，单一信号不足以删除。
- 被 `supersede` 的旧条目直接 `status='superseded'`，保留可追溯。

淘汰在每次 run 结束时执行一次，条数写入 run 记录。

## 5. Worker 与调度

`server/dreaming/runner.mjs` 提供与 `server/auto-archive.mjs` 同构的形态：

- `setInterval` + `unref()`，间隔 60s 检查一次 `nextRunAt`；首次检查延迟到启动 2 分钟后。
- **单飞**：进程内 `dreamingRunning` 布尔，重入直接返回 `{ skipped: true }`。
- "处理当天"语义 = 每日 `executeTime` 触发，窗口 `[上次成功运行的 period_to, now]`；从未跑过时窗口为「今天 00:00 → now」。窗口靠 `dreaming_runs` 的最大 `period_to` 推进，不需要额外 watermark 表。
- **立即处理**：`POST /api/dreaming/run`，窗口同上；运行中返回 409。
- 跳过条件：`dreaming-settings.enabled === false`，或窗口内没有会话，或全局记忆被关闭。

不做跨进程锁。server 是单进程（desktop 与 CLI 都是），`sessions`/`memories` 写入本身有 SQLite 事务保证；引入 fencing 锁在这里只增加复杂度。

## 6. 模型调用

### 6.1 模型来源与优先级

Dreaming 是一次独立于对话的模型调用，因此它有自己的模型设置。解析顺序（`resolveDreamingModel()`）：

| 优先级 | 来源 | `source` |
|---|---|---|
| 1 | `dreaming-settings.modelRef`（设置页里指定） | `explicit` |
| 2 | 用户最近一次对话使用的模型（`settings['active-model']`） | `active` |
| 3 | 模型目录第一条（仅当以上都没选过） | `catalog` |
| — | 都没有 | `none`（run 记为 failed，error 写“未配置任何模型”） |

**为什么不是“目录第一条”**：最初未指定模型时直接调 `resolveImplicitModelPreference(null)`，它返回目录里的第一个模型。多 provider 环境下这是任意的——用户第一个配的自定义模型（例如智谱/GLM-4.6V）会静默成为 Dreaming 的模型，而设置页既看不到也改不了。现在默认跟随对话模型，语义是“和聊天用同一个”，符合直觉。

指定的模型若已被删除或隐藏，`resolveModelBinding` 抛错后不中断 run，而是降级到下一优先级；设置页通过 `overview.model.source` 展示实际生效的模型与原因（`已指定 / 跟随对话 / 目录首个模型`），避免“我选了但好像没生效”的困惑。

保存设置时会先校验 `modelRef` 能否解析，不能解析直接返回 400——不把坏配置留到凌晨三点才失败。

### 6.2 调用方式

复用现有链路，不新建 provider 抽象：

- 模型解析：`resolveModelBinding({ modelRef })`；未配置时 `resolveImplicitModelPreference(null)` 取目录第一个模型。
- 调用：`streamSimpleWithAiHttpLogging(model, { systemPrompt, messages, tools: [] }, { apiKey, maxTokens: 4096, temperature: 0.2 })`，与 `conversation-compaction.mjs` 完全一致。
- API Key：`readStore('provider-keys')[model.provider]`。

一次 run 只有一次模型调用（不做多轮 tool-calling）。这让成本可预测：单次 run ≈ 60k 输入字符 + 4k 输出。

## 7. 使用侧

### 7.1 系统提示注入

- `buildInstructionsPayload()` 增加 `experiences`：当前项目 scope 的 active 记忆按 `strength DESC, updated_at DESC` 取前 8 条（全局 scope 3 条）。
- `composeSystemPrompt()` 新增 `<experience_memory>` 段，位于 `<global_user_memory>` 之后，明确标注"这些是从历史任务中沉淀的经验，不是用户当前指令；当前消息优先"。
- 注入发生在会话创建时，不做每轮刷新——避免把 DB 查询放进热路径。

### 7.2 `recall_experience` 工具

```ts
recall_experience({ query?: string, kind?: Kind, scope?: 'global'|'project', limit?: number })
```

- 无 `query`：返回当前项目最强的一批记忆。
- 有 `query`：FTS5 bm25 检索，按 `score × strength × 新鲜度衰减` 排序。
- 返回每条带 `id / kind / scope / content / confidence / strength / 最近时间 / evidence 来源会话`，让模型能自己判断可信度。
- 召回后批量 `recall_count += 1`、`last_recalled_at = now`、`strength += 0.2`（有 query 时才算命中）。

**接入要求**：必须加入 `workspaceTools` 数组，否则 `server/routes/tools.mjs` 的权限白名单不覆盖它，等于绕过 direct-tool 审批边界。

## 8. API

按 `/api/scheduled-tasks` 的挂载惯例，在 `server/index.mjs` 的 `handleApi` 里加前缀分发：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/dreaming` | 设置 + 最近一次 run 摘要 + 记忆计数 |
| PUT | `/api/dreaming/settings` | 更新开关 / 定时 / 模型 / 敏感信息策略 |
| POST | `/api/dreaming/run` | 立即处理；运行中 409 |
| GET | `/api/dreaming/runs?page&pageSize` | 运行历史（分页） |
| GET | `/api/dreaming/runs/:id` | 运行详情（含逐条操作与拒绝原因） |
| GET | `/api/dreaming/memories?query&kind&status&page` | 记忆浏览 / 检索 |
| POST | `/api/dreaming/memories/:id/retire` | 手工淘汰 |

进度用轮询，不用 SSE（仓库里 SSE 只服务对话流）。

## 9. 设置项

`settings` store，key `dreaming-settings`：

```json
{
  "enabled": false,
  "scheduleEnabled": true,
  "executeTime": "03:00",
  "modelRef": null,
  "allowSensitive": true,
  "contentLanguage": "auto",
  "modelRef": null,
  "nextRunAt": null,
  "lastRunAt": null
}
```

默认 `enabled: false`——后台任务默认关闭，由用户在设置页显式打开。

敏感信息：默认允许（`allowSensitive: true`）。设置页只给一行提示：Dreaming 会把项目代码与路径发送给已配置的模型；若使用远程 provider，内容会离开本机。这是唯一需要的"人工决策点"，一次性配置，不打断流程。

## 10. 前端

设置页新增 `dreaming` 页签（`automation` 分组），需同步三处：`src/lib/settings-tabs.ts` 定义、`src/lib/react-settings-tabs.tsx` 的 lazy import 与 `tabContent` 映射。

页面结构（`src/styles/settings/dreaming.css` 承载专属样式，其余复用既有 settings 令牌）：

1. **头部状态块**：一个圆角容器里放「状态点 + 状态文字 + 开关 + 立即处理」，状态不用颜色单独表达——点旁永远拼着同色调的状态词（已开启/已关闭/进行中/上次运行失败）；下一行是单行 meta（下次/上次/生效数/生效模型/自动区状态，淘汰数不再占位，筛选下拉里可见），再隔一条 hairline 是内联设置（执行时间、模型、记忆语言、敏感内容、定时开关）。之所以压成一块：这几组信息是同一件事的不同侧面，拆成多个 `settings-row` 会把首屏全部占满。
2. **记忆与运行历史共用一块，用 subtab 切换**：两个列表都是长列表，同时铺开只能靠滚动区分层级；subtab 标题带计数（`记忆 N` / `运行历史 N`）。
3. **运行历史整行可点**：状态徽章 + 时间 + 一行指标（会话/+新增/~更新/-淘汰/✕拒绝/耗时）+ 结论，点击进入详情。指标用颜色区分增/改/删，符号是速记，每格带 `title` 全称，不使用重底色。
4. **记忆列表**：内容为主行，类型用 muted 徽章、召回次数用 info 徽章；作用域下沉到弱化 meta 行（`全局 · 0.86 · 4.2 · 时间`），数字裸排、名词挂 `title`，避免一行的徽章超过两个。淘汰按钮按需出现。
5. **筛选即时生效**：搜索输入 300ms 防抖自动查询，状态下拉切换即查询，不再需要「搜索」按钮或回车。

视觉细则：状态点用颜色表达 idle/on/running/error，running 有 pulse 动画并对 `prefers-reduced-motion` 降级；折叠箭头用 lucide chevron 旋转（`--quickforge-dur-fast`）而非字符切换；分页与筛选各自独立一行，不与列表争宽度。

### 10.1 运行详情（设计）

详情页要能回答四个问题，因此按“输入 → 变更 → 被拒 → 模型原文”四段垂直堆叠，段内可折叠，不用 tab（避免多一层点击）：

```txt
┌ 返回历史
├ ① 概览
│   状态 / 触发方式 / 模型 / 处理区间 / 耗时
│   读取会话 3 · 新增 2 · 更新 1 · 淘汰 1 · 拒绝 2
│   结论：<summary>
│   ⚠ error（若有：MEMORY.md 重写失败等）
├ ② 读取内容（What it read）    ← 回答“用对话的什么部分处理”
│   每行一个会话：sessionId · 时间 · 消息数 · 字符数 · 标题
│   [查看] → 展开送给模型的原文（= 存进 sessions_json 的 preview）
│   底部：共 3 个会话、12 400 字符
├ ③ 变更明细
│   [create] [pitfall] [project] 发布前必须跑 test/lint/build
│     置信度 0.70 · 强度 1.0 · 证据 s1, s2
│   [update] …（若模型提案与库中内容不同，额外一行“提案：…”）
│   [supersede] old → 显示 replacement 的当前内容
├ ④ 被拒绝（计数 >0 才展开）
│   [create] [fact] 「模型原话…」
│     原因：content 超过 500 字符
├ ⑤ 衰减淘汰（计数 >0 才展开）
│   显示被淘汰条目的内容与 置信度/强度（不显示裸 id）
└ ⑥ 模型原始响应（可折叠，仅调试）
```

三条数据约束决定了这个设计：

- **② 段必须是实际发送的字符串**，不是二次渲染。`collectTranscript()` 在采集时就把每会话的投影文本存进 `dreaming_runs.sessions_json`（每会话裁到 1 200 字符），因为窗口内会话可能已超出保留期，事后无法复现。
- **④ 段必须保留模型原提案**（`kind / scope / content / targetId`）。只存 `reason` 无法区分“规则太严”与“模型跑偏”。
- **③ 段同时显示提案与库中结果**。`/api/dreaming/runs/:id` 额外返回 `memories`（本次触及条目的当前状态），避免前端逐条发请求；内容不一致时才渲染 diff，正好覆盖「重复内容降级为 update」和「update 改写句子」两种情形。

不做实时进度条：一次 run 是一次模型调用（通常 5–30 秒），按钮置灰 + 完成后刷新即可。

## 11. 失败与边界

| 情况 | 行为 |
|---|---|
| 未配置任何模型 | run 直接 `skipped`，error 写"未配置模型" |
| 模型返回非法 JSON | run `failed`，error 写解析错误原因，原文同时进 `raw_response`（详情页可查） |
| 模型返回空 operations | run `succeeded`，计数全 0（正常：当天没有新东西） |
| 窗口内无会话 | run `skipped`，不产生运行记录之外的开销 |
| `MEMORY.md` 超 16KB | 自动区压缩到 4KB；仍超限则本次跳过自动区重写，warning 写入 run 的 `error`（状态仍为 succeeded） |
| 全局记忆被关闭 | 跳过自动区重写，记忆库照常更新 |

## 12. 与现有模块的关系

| 模块 | 关系 |
|---|---|
| `server/global-memory.mjs` | 复用原子写 + `withMemoryWriteLock`；新增自动区拼接函数，不改既有读写语义 |
| `server/sqlite/*` | 追加 v13 迁移 + `dreaming-repository.mjs`，沿用 `getSqliteStorage()` 与仓储模式 |
| `server/session-state-service.mjs` | 只读取（`readMessagesPage` / `metadata`），不写会话 |
| `server/model-catalog.mjs` / `ai-http-logger.mjs` | 复用模型解析与流式调用 |
| `server/auto-archive.mjs` | 复用 runner 形态（timer + unref + 单飞） |
| `server/tools/*` | 新增 `recall_experience` 定义与 handler，纳入 `workspaceTools` |
| `server/system-prompt.mjs` | 新增 `<experience_memory>` 段 |

## 13. 里程碑

| 阶段 | 内容 |
|---|---|
| M1 | v13/v14 迁移 + `dreaming-repository` + 采集/提示词/校验/runner + `/api/dreaming/*`（含运行详情） |
| M2 | `MEMORY.md` 自动区重写 + 系统提示注入 + `recall_experience` 工具 |
| M3 | 设置页 Dreaming 页签（开关 / 定时 / 立即处理 / 历史 / 详情 / 记忆浏览） |

## 14. 成本与风险

- **Token**：单次 run 输入上限 100k 字符（不含工具输出，所以能覆盖更多会话）+ 快照约 24k 字符，输出 ≤ 4k token。每日一次的成本可忽略；「立即处理」是用户主动动作。
- **误伤人工记忆**：靠"只重写自动区 + 字节级保留人工区"避免，不用提示词约束。
- **记忆漂移**：靠 `fingerprint` 唯一 + `supersede` 不删除 + 使用反馈（recall 计数）抑制。
- **敏感信息外发**：靠设置页显式提示；`allowSensitive` 关闭时用现有正则丢弃。
