# 依赖移除后的交互 Parity 审计报告（旧 pi-web-ui 界面 ↔ 新 React 界面）

- 仓库：`C:\Users\20159\IdeaProjects\quickforge`，分支 `ui`。
- 审计对象：提交 `HEAD=6d845ca`（移除 `@earendil-works/pi-web-ui` / `@mariozechner/mini-lit` / `lit` 的 React 化重构）相对其父提交 `BASE=3e10f58` 的**交互行为差异**，以及对「真实回归」的本轮修复。
- 本报告为**独立自洽文档**：所有结论均带 `文件:行号` 或 **旧产物字节/字符偏移 + 原始片段**；不引用 `docs/reviews/` 下既有报告的结论作为证据（见 §1.5）。
- 报告写作时点：本轮修复已完成并通过 `npm run test` / `npm run lint` / `npm run build`（详见 §5）。

---

## 0. 结论摘要

**一句话结论**：本轮把 7 组**由依赖移除直接造成的真实可见回归**修回了移除前行为（代码块复制文案、console/工具卡复制入口与反馈、console 输出自动置底、行中 `$$…$$` 数学、语法高亮 heading/list/code/quote/strong/emphasis/link 语义与 SVG 代码块 CSS、高亮分桶、聊天区 50/10 自动滚动迟滞），并逐条给出反向举证；其余差异经取证判定为**有意保留**（旧缺陷修复、无障碍增强、安全加固、按新架构等价重写）或**证据不足不可考证**，未做臆测性改动。

| 指标 | 数量 | 说明 |
| --- | --- | --- |
| 本轮修复项 | **7** | §3 逐项列出（console 复制入口含 W1 实现 + W11 验证与护栏两部分，计 1 项） |
| 有意保留差异 | **17** | §4 逐项列出（旧缺陷修复 / 无障碍增强 / 安全加固 / 不可考证） |
| 不可考证项 | **7** | §2 判定为「不可考证」的条目（详见 §6.1 汇总） |
| 五域对照条目 | 155（一致 107、回归-已修 11、有意保留 30、不可考证 7） | 计数口径：§2 各域表内每个数据行按「判定」列的**首个标签**计一次（行内若另附第二个标签（如「回归-已修…；有意保留…」）不计入第二次）；§2 的判定与 §3/§4 的清单互为交叉引用 |

> 说明：「不可考证」在 4 个取值中的含义是——**现有证据不足以判定该差异由本次重构引入，或旧行为本身无从取证**；凡属此类一律不修、不臆测，按 §6 登记待后续取证。本报告中出现的 `W1`…`W12` 是本轮修复工作的**内部任务编号**，其内容均在本报告 §3 / §4 内自述，不依赖任何外部文档。

---

## 1. 基线与方法

### 1.1 基线 SHA 与定位命令

| 项 | 值 | 证据 |
| --- | --- | --- |
| HEAD | `6d845cadd5ffbb96810d7f11b3a48f32a0530e80`（短 `6d845ca`），提交信息 `refactor(frontend): 聊天界面 React 化重构（chat surface、工具渲染器、设置页迁移）+ 存储层抽取` | `git rev-parse HEAD`、`git log --oneline -3` |
| BASE | `3e10f58da7365c24ef59cd93462256918c394fb1`（短 `3e10f58`，2026-09-18 09:20:11 +0800） | `git rev-list --parents -n 1 HEAD` 只输出两个 SHA → HEAD 为单父提交，BASE 是其唯一父提交 |
| BASE 判定命令 | `git log --format="%H|%ci|%s" -S"@earendil-works/pi-web-ui" -- package.json` | 最后仍含三依赖的提交 = `3e10f58` |
| BASE 仍含依赖 | `@earendil-works/pi-web-ui@^0.75.3`、`@mariozechner/mini-lit@^0.2.1`、`lit@^3.3.2` | `git show 3e10f58:package.json` 过滤输出 |
| HEAD 已无依赖 | 同一过滤条件 **零匹配**（`NO_MATCH_IN_HEAD`） | `git show HEAD:package.json` |
| 版本基线 | BASE 与 HEAD 的 `package.json` version 均为 `2.1.0`（HEAD 未 bump）；最近 tag `v2.1.0`=`baaa041`（2026-09-14），HEAD 距该 tag 11 个提交、BASE 距 10 个 | `git describe --tags`、`git rev-list --count` |

### 1.2 评审起始工作区状态

- 评审开始时（2026-09-20 18:53:26）`git status --porcelain=v1 -uall` **零输出**（含未跟踪文件），`git status --short --branch` 仅 `## ui...origin/ui`（无 ahead/behind）→ 工作区与 HEAD 树一致，`ui` 与 `origin/ui` 同点。
- 审计过程中（18:54:54）仓库根目录曾出现 5 个未跟踪临时文件：`.qf_tmp_cssdiff.txt`、`.qf_tmp_old_Chathost.tsx`、`.qf_tmp_old_editorbindings.ts`、`.qf_tmp_old_index.css`、`.qf_tmp_old_sendstop.ts`（分片取证用的中间产物，均未提交；**最终状态中已不存在**，见 §5 末尾 status）。结论：「工作区干净」只对起始时点成立，已提交内容（HEAD）全程未被改动。

### 1.3 改动规模与按目录分组清单（`git diff --stat 3e10f58 HEAD`，排除产物目录）

```
280 files changed, 29318 insertions(+), 11106 deletions(-)
```

状态分布：A 93 / D 18 / M 169 / R 0 / T 0（无重命名、无类型变更）。依赖清单单列：`package-lock.json 348` 行、`package.json 5` 行改动，合计 +16 / −337。

| 目录 | A | D | M | 合计 |
| --- | --- | --- | --- | --- |
| `src` | 55 | 15 | 98 | 168 |
| `tests` | 36 | 3 | 58 | 97 |
| `docs` | 2 | 0 | 6 | 8 |
| 根文件 | 0 | 0 | 6 | 6 |
| `server` | 0 | 0 | 1 | 1 |
| **合计** | **93** | **18** | **169** | **280** |

根文件 6 个（全部 M）：`feature_list.json`、`package-lock.json`、`package.json`、`progress.md`、`session-handoff.md`、`vite.config.ts`。
`docs` 8 项：A 2（`docs/reviews/self-hosted-chat-ui-parity-recheck.zh-CN.md`、`docs/wiki/src/storage/README.md`）+ M 6（`docs/architecture/browser-cache-strategy.zh-CN.md`、`docs/bug/frontend-bugs.md`、`docs/wiki/root-config.md`、`docs/wiki/src/README.md`、`docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`）。
`server` 1 项：`server/session-state-service.mjs`（M）。
`src` 新增集中在 4 个新目录：`src/components/chat/surface/**`（20）、`src/components/settings/**`（14）、`src/lib/tool-renderers/**`（9，含 `index.ts` 与 `shared.tsx`）、`src/storage/**`（8），另有 `src/components/workspace/subagent-trace-structure.ts`、`src/lib/chat-math.ts`、`src/lib/code-highlight.ts`、`src/lib/tool-renderer-registry.ts`（合计 20+14+9+8+4 = 55 项，与 A=55 一致）。
`tests` 新增 36 个**全部位于 `tests/frontend/` 之下**：35 个直接位于该目录（34 个 `*.test.ts` + 1 个 harness `settings-react-harness.ts`），1 个 fixture `tests/frontend/fixtures/chat-message-contract.ts`。

**全部被删除（D）的 18 个文件路径（完整清单）**

| # | 路径 |
| --- | --- |
| 1 | `src/components/chat/panel-decoration/code-blocks.ts` |
| 2 | `src/components/chat/side-chat-renderer-isolation.ts` |
| 3 | `src/lib/about-settings-tab.ts` |
| 4 | `src/lib/appearance-settings-tab.ts` |
| 5 | `src/lib/archived-conversations-settings-tab.ts` |
| 6 | `src/lib/backup-settings-tab.ts` |
| 7 | `src/lib/channels-settings-tab.ts` |
| 8 | `src/lib/custom-providers-only-tab.ts` |
| 9 | `src/lib/default-options-settings-tab.ts` |
| 10 | `src/lib/info-tip.ts` |
| 11 | `src/lib/lan-access-settings-tab.ts` |
| 12 | `src/lib/memory-settings-tab.ts` |
| 13 | `src/lib/patch-thinking-selector.ts` |
| 14 | `src/lib/project-commands-settings-tab.ts` |
| 15 | `src/lib/quickforge-settings-select.ts` |
| 16 | `tests/frontend/decorate-subagent-process.test.ts` |
| 17 | `tests/frontend/local-tools-lit-reactivity.test.ts` |
| 18 | `tests/frontend/side-chat-renderer-isolation.test.ts` |

（无 `docs/`、`server/`、根文件被删除。）

本轮修复后的工作区规模：**14 个已修改文件**（7 源码 + 7 测试，`+939 / −135`）+ 本报告文件；`git diff -- package.json package-lock.json` 为空（依赖清单无变化）。

### 1.4 证据源三件套与各自局限

| # | 证据源 | 用法 | 局限（必须与结论一起读） |
| --- | --- | --- | --- |
| ① | `git show 3e10f58:<path>`（BASE 源码） | 应用自有文件的旧实现（composer 装饰、`local-tools.ts`、`index.css`、设置页 Lit 实现、装饰层全部模块） | 只覆盖**应用自有**代码；pi-web-ui / mini-lit 内部行为不在其中，必须靠 ② 反推 |
| ② | 只读旧构建产物 `package-dist/dist/assets/*`（= `package-offline/dist`，逐字节相同：248 文件、md5 差异 0） | pi-web-ui / mini-lit 内部行为、旧 CSS 规则全量、旧 hljs 语法文本、旧 i18n 覆盖词典 | ① 产物是 **2026-09-13 11:52 的 v2.1.0 构建**（`package.json` version 2.1.0、`package-offline` 内含 `shawnstack-quickforge-2.1.0.tgz`），比 BASE（09-18）**早约 5 天**、比 HEAD 早约 7 天；产物中存在 BASE 源码已不存在的东西（如 `.quickforge-goal-button--*:hover`、`.quickforge-goal-expand:hover`、`@keyframes quickforge-goal-spin` @353129，`git grep` 在 `3e10f58` 全树 0 命中）→ 凡「旧有新无」必须逐条核版本。② 产物无 `devDependencies`（无法判断构建工具链）。③ 两份 `dist/` 互为副本，**不构成第二路独立证据**。④ 产物 version 与 BASE/HEAD 相同（都是 2.1.0），只能靠内容/哈希/时间判断新旧。⑤ 旧 CSS 是 minified 单行（`index-B1G0LqYR.css` 376,928 字节 / 4 行，样式载荷位于第 3 行，起点字节偏移 132，行长 376,796），只能用字节/字符偏移或正则定位，**按行号阅读无意义**。 |
| ③ | 工作区源码（HEAD 树 + 本轮改动）与新构建产物 | 「新」侧行号级证据；新产物用于「规则是否生成」的交叉验证 | 分片取证期间的新产物 `dist/assets/index-BZ1SX4Xg.css`（2026-09-20 09:20）**早于本轮 `input.tsx` 等改动**（同时含 `focus-visible\:border-primary` 与 `border-ring`），举证力有限；本轮收口时 `npm run build` 已按项目定义重新生成 `dist/`（详见 §5），但**未在新产物上逐条复核**构建期生成物（见 §6）。 |

**偏移口径警告（跨分片复用证据时必读）**：同一批产物证据里存在两种尺度且**不可直接比大小**——`findstr /o` 给出的**字节偏移**（W1/W7 等分片采用）与 PowerShell `[IO.File]::ReadAllText` + `IndexOf` / `[regex]::Matches().Index` 给出的 **0-based 字符下标**（W10/W11/W12、04/05 等分片采用）；CSS 侧的 `@NNN` 又分「行内 0-based 字节偏移」（04）与「0-based 字符偏移」（W3/W10）两种表述。本报告在 §7 逐条标注来源口径。

### 1.5 关于既有 `docs/reviews/` 报告的声明

本轮汇总覆盖 **17 份输入分片**（基线 1、域对照 5：composer / rendering / settings-ui / global-css / decoration、修复与专项 10：W1–W7 与 W10–W12、最终验证 1），**无分片缺失**。

**本次审计未把 `docs/reviews/` 下任何既有报告（含 `self-hosted-chat-ui-parity-recheck.zh-CN.md`）的结论当作证据**：旧行为一律重新取证自 ① / ②，新行为一律取证自当前工作区源码。本轮各修复分片对上一分片结论的处理方式统一为「**只当待验证清单**」，并在各自报告中重新给出旧产物原文与偏移（例：W11 重新取证 `<console-block>` 模板后才判定三键取值一致；W12 重新取证 `<code-block>` 模板与 `<copy-button>` 后才改 `ToolCodeBlock`；W7 重新取证后才发现「`Copy code` 是模板字面量、不是 `copy-button` 默认值」）。凡分片之间出现偏移/结论冲突，本报告在 §7 如实并列，不做单方裁定。

---

## 2. 分域旧↔新对照

判定取值仅四种：`一致` / `回归-已修` / `有意保留` / `不可考证`。表中「新证据(修复前)」指**本轮修复落地之前**的工作区状态；已修复项的当前状态见 §3。
为控制篇幅，重复出现的旧产物偏移在 §7 有索引表，本节仅给关键 needle；`@NNN` 含义随来源标注（见 §1.4 口径警告）。

### 2.1 域 A · Composer 输入区（发送/停止按钮、键盘、附件、composer CSS）

| 交互项 | 旧证据 | 新证据(修复前) | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| 发送图标描边/填充与路径几何 | `3e10f58:src/components/chat/panel-decoration/send-stop-button.ts:49`：`fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"`、`viewBox="0 0 24 24"`、`<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>` | `src/components/chat/surface/MessageEditor.tsx:457-469`：同名属性（React 驼峰）+ 路径数据逐字符相同 | 一致 | 无（不存在「旧描边→新填充」降级） |
| 停止图标几何 | `…/send-stop-button.ts:30`：`width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>` | `MessageEditor.tsx:441-443`：同 `viewBox`/`fill="currentColor"`/同 rect 参数 | 一致 | 无 |
| 图标最终尺寸（停止/发送 1.0625rem=17px） | `3e10f58:src/index.css:4879-4884`：`.quickforge-composer .quickforge-send-button svg, .quickforge-composer .quickforge-stop-button svg { display:block; width:1.0625rem; height:1.0625rem }`（旧产物 `index-B1G0LqYR.css` @281640 起同规则） | `src/index.css:5345-5350` 逐字相同（覆盖新 `size-4`=1rem） | 一致 | 无 |
| 按钮最终尺寸（2rem）与 `size-9` vs `h-8 w-8` 冲突 | 旧 CSS `3e10f58:src/index.css:4867-4877`（`width/height:2rem!important`）；类顺序证据取自重构前两份产物：`package-dist/…/index-B1G0LqYR.css` `.size-9{`@81383 < `.h-8{`@82263 < `.w-8{`@84565；`dist/assets/index-BZ1SX4Xg.css` @15734 < @16688 < @19205 → 后者胜出=2rem | `src/index.css:5333-5343` 逐字相同；`MessageEditor.tsx:431-434/446-449` 类集合与旧 pi 相同（`size="icon"`=`size-9` + `h-8 w-8`） | 一致（中高置信度：未在 HEAD 重新构建复核 Tailwind 生成顺序） | 登记：若需完全确定，在一次允许写 `dist/` 的会话里比对 `.h-8`/`.size-9` 顺序 |
| 过渡帧（装饰层 rAF 未跑完）图标尺寸 | 旧过渡态显示 pi 图标 `Je(He,'sm')`（`pi-web-ui-B-_rXig1.js` @1819900），`sm` 的 px 值**未能从旧产物定位图标尺寸映射表** | 新过渡态 = `size-4` = 16px（`MessageEditor.tsx:465`），装饰层跑完后由 CSS 变 17px | 不可考证（旧值未知） | 无需处理（差异 ≤1px 且只存在于装饰层首帧之前） |
| 「装饰层未运行就变样」窗口 | 旧：`.quickforge-composer` 由装饰层添加且 rAF 调度（`ChatPanelHost.tsx:1390/1412`：`let decorateFrame` / `decorateFrame = window.requestAnimationFrame(...)`） | 新：同机制（`ChatPanelHost.tsx:1371-1379` `scheduleDecorate`；类名注入 `panel-decoration.ts:201-203`） | 一致（窗口新旧都存在，非新增风险） | 保持现状（改由 React 直渲染类名会与装饰层类所有权冲突） |
| 停止态 title / aria-label（zh 下仍为英文 `Stop`） | `…/send-stop-button.ts:27-28`：`actionButton.title = 'Stop'` / `setAttribute('aria-label','Stop')`（硬编码英文；旧产物 `index-DyE33U-f.js` @314020 `title=`Stop``、@314049 `'aria-label','Stop'`），且旧代码从不移除该属性 | 装饰层 `panel-decoration/send-stop-button.ts:33-34` 同款硬编码；React 侧 `MessageEditor.tsx:435` `title={t('stop')}`（zh=`停止`）→ 装饰层覆写回英文 | 一致（同缺陷：zh 下 tooltip 仍英文，流式结束后残留） | 登记为既有缺陷（未修，避免扩大范围）；修法见 §6 |
| 发送按钮可访问名 | pi 发送按钮**无 title / 无 aria-label**（`pi-web-ui-B-_rXig1.js` @1819900 属性列表仅 `variant/size/onClick/disabled/children/className`） | `MessageEditor.tsx:450` `title={t('composerSend')}`（`i18n.ts:260` en `Send` / `:1912` zh `发送`） | 有意保留 | 正向改进（新增可访问名且随语言切换），不处理 |
| Enter 发送 / Shift+Enter / IME | `pi-web-ui-B-_rXig1.js` @1813590 起：`e.key===`Enter`&&!e.shiftKey?(e.preventDefault(),!this.isStreaming&&!this.processingFiles&&(this.value.trim()\|\|this.attachments.length>0)&&this.handleSend())`；`e.isComposing\|\|e.key===`Process`` 直接 return | `MessageEditor.tsx:79-82`（`resolveEditorKeyDown`）：Enter+非 Shift 恒 `preventDefault`，仅 `!isStreaming && !processingFiles && canSend` 才 `send`；`:75-77` IME 分支 | 一致 | 无 |
| Esc 中止 | pi 有 Escape 分支（@1813590），但 BASE 全仓**未给 editor 赋 `onAbort`**（`git grep -n "onAbort" 3e10f58 -- src` 在 `src/components/chat/**` 无命中）→ 旧 Esc 实为 no-op | `MessageEditor.tsx:84-86` 返回 `abort`、`:221` `onAbort?.()`，接线点 `ChatSurface.tsx:893` `onAbort={() => agent.abort()}` | 有意保留（旧缺陷修复：死代码被接活） | 保留；发布说明显式记录（回滚不建议） |
| 附件上限默认值 maxFiles / maxFileSize / acceptedTypes | `pi-web-ui-B-_rXig1.js` @1813255 区域：`this.maxFiles=10,this.maxFileSize=20*1024*1024,this.acceptedTypes=`image/*,application/pdf,….ts,.tsx,.yml,.yaml``；BASE 应用侧无覆盖 | `MessageEditor.tsx:26-29`：`DEFAULT_MAX_FILES=10`、`DEFAULT_MAX_FILE_SIZE=20*1024*1024`、同串 `DEFAULT_ACCEPTED_TYPES` | 一致 | 无 |
| 超限语义（整批拒绝 / 单个丢弃）与超限提示文案 | pi：`if(n.length+this.attachments.length>this.maxFiles){alert(…);return}`、逐项 `if(e.size>this.maxFileSize){alert(…);continue}`（粘贴 @1813590 / 拖拽 @1814400 / 文件选择 @1815450）；文案为硬编码英文 `Maximum ${maxFiles} files allowed` 等 | 判定逻辑 `MessageEditor.tsx:113-132` 等价；文案改为 `t('composerMaxFiles'/'composerFileTooLarge'/'composerFileFailed')`（`i18n.ts:264-266` en / `:1916-1918` zh） | 一致（判定）／有意保留（文案本地化） | 无 |
| 粘贴通道（大段文本→附件端点） | `3e10f58:src/components/chat/panel-decoration/editor-bindings.ts:64-105`：`text.length<3000 \|\| >2_000_000` 放行，否则 `POST /api/agents/:id/text-attachment`，失败回填；tile 装饰 `setTimeout(…,0)` + `attachment-tile:last-of-type` | `editor-bindings.ts:129-157`：同一阈值/同一 endpoint/同一回退；tile 装饰改 `rAF + [0,50,150,300,600]` 重试 + `.qf-attachment-tile:last-of-type`（`AttachmentTile.tsx:29`） | 一致 | 无（新增重试属鲁棒性，`editor-bindings.ts:10-20` 有注释） |
| 拖拽交互（dragover/leave 边界/drop） | pi @1814400 区域：`getBoundingClientRect` 判出界 | `MessageEditor.tsx:291-313`（边界判定 `:301-305`） | 一致 | 无 |
| 发送按钮 disabled 条件 | pi @1819900：`!this.value.trim()&&this.attachments.length===0\|\|this.processingFiles` | `MessageEditor.tsx:208` `canSend`；`:451` `disabled={!canSend \|\| processingFiles}` | 一致（布尔等价） | 无 |
| 流式态停止按钮可点 | `…/send-stop-button.ts:23` 强制 `actionButton.disabled = false` | `MessageEditor.tsx:431-437` 停止按钮无 `disabled` | 一致 | 无 |
| 挂载后自动聚焦 | pi @1816597：`firstUpdated(){let e=this.textareaRef.value;e&&e.focus()}` | `MessageEditor.tsx:203-205` mount-only `useEffect` | 一致 | 无 |
| 输入 placeholder 文案 | pi @1817340 区域 `placeholder=${L(`Type a message...`)}`；BASE 翻译表 `3e10f58:src/lib/i18n.ts:3281` `'Type a message...': '输入消息...'` | `MessageEditor.tsx:357` `placeholder={t('composerPlaceholder')}`；`i18n.ts:259` en `Describe what you want to do` / `:1911` zh `描述你想做的事`；diff 显示旧键已删除 | 有意保留（两语言文案均变） | 保留；发布说明记录（若判为误改则回退键值） |
| 发送链路包装 | `3e10f58:…/editor-bindings.ts:114-131` 包裹 `editor.onSend`（`shouldSendComposerInput` → `onBeforeSend` → 清空建议） | `editor-bindings.ts:166-183` 同款包裹；React 侧 `MessageEditor.tsx:210-212` → `ChatSurface.tsx:885-892`（优先 bridge.onSend） | 一致 | 无 |
| abort 事件通道（按钮 / 装饰层 capture / 是否双发） | pi 停止按钮 `onClick:this.onAbort`（@1819500，但未接线 → no-op）；装饰层 `send-stop-button.ts:31-41` 同时绑 `pointerdown` + `click`（capture）并 `preventDefault+stopPropagation+stopImmediatePropagation` 后 `abort()` | React `MessageEditor.tsx:436` `onClick={onAbort}`（有效通道）；装饰层 `send-stop-button.ts:35-45` 同款双绑定（React 根委托被 `stopPropagation` 抑制，不会双发） | 一致（含「单次点击调用 2 次非幂等 `abort()` POST」这一**旧缺陷**）：`server-agent.ts:710-715` 为 fire-and-forget `fetch POST /api/agents/:id/abort` | 登记为既有缺陷（中高置信度：`pointerdown.preventDefault` 不取消 `click` 属浏览器行为，未运行时实测）；建议加一次性标记 |
| composer CSS：发送/停止启用·hover·disabled·waiting 旋转 | 旧 `3e10f58:src/index.css:4886-4902`（启用 `background:var(--primary)!important` + `box-shadow:0 10px 24px -12px color-mix(...)`）、`:4892-4913`（hover/停止底色）、`:4917-4944`（waiting：`svg{visibility:hidden}`+`::before` 1rem/1.5px `border-top-color:transparent`+`quickforge-approval-spin 750ms`+reduced-motion 降级） | `src/index.css:5352-5379`（逐字相同）、`:5381-5410`（逐字相同） | 一致 | 无 |
| composer CSS：卡片边框/阴影 + `:focus-within`、全按钮 hover 位移、`plus-inline`、`model-trigger` 组、紧凑模式 | 旧 `3e10f58:src/index.css:3513-3546`、`4114-4121`、`4127-4139`、`4141`、`4646` 起、`5443-5452` | 新 `src/index.css:3979-4012`、`4580-4587`、`4593-4605`、`4607-4610`、`5076-5117`、`5902-5920`（行号平移，规则未改） | 一致 | 无（`transform:none!important` 后置使 send/stop 不随 hover 上移，新旧同） |
| composer CSS：`+ summary row` 与附件间距选择器改写 | 旧 `.quickforge-composer + .text-xs.text-muted-foreground…`；`.quickforge-composer attachment-tile + attachment-tile { margin-left:0.125rem }` | `src/index.css:2364/2373` `.quickforge-composer + .qf-usage-bar`；`:5417` `.quickforge-composer .qf-attachment-tile + .qf-attachment-tile` | 一致（随 React 迁移的必要改写，`.qf-usage-bar`/`.qf-attachment-tile` 在 React 侧真实存在） | 无 |
| 新 Button 基类新增 `active:scale-[0.97]`，composer 区无覆盖 | 旧 pi 按钮是否具备同款 active 缩放**未在旧产物中找到对应 utility** | `src/components/ui/button.tsx:6` `active:scale-[0.97]` | 不可考证 | 登记；建议点击态目视/截图对比 |

**域 A 判定统计**：一致 16、回归-已修 0、有意保留 3、不可考证 2（共 21 条）。

### 2.2 域 B · 消息渲染与代码块（含数学、自动滚动、附件、用量条）

| 交互项 | 旧证据 | 新证据(修复前) | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| 代码块标题栏复制反馈时长 2000ms | `pi-web-ui-B-_rXig1.js` @3073076：`setTimeout(()=>{this.copied=!1},2e3)`；模板 `title="${L('Copy code')}"` + `.showText=${!0}` | `CodeBlock.tsx:47` `COPY_BUTTON_FEEDBACK_MS = 2000`；`:465` 传入 | 一致 | 无 |
| ⋯ 菜单复制源码：1200ms + title 切换 `t('copied')` | `3e10f58:panel-decoration/code-blocks.ts:17-35`：`window.setTimeout(…, 1200)`、`button.title = copiedTitle`；调用点 `:284`、`:449` | `CodeBlock.tsx:53` `MENU_COPY_FEEDBACK_MS = 1200`；`:214-229` 菜单项 label 切换 + `copied && 'text-emerald-600'` | 一致 | 无 |
| 标题栏复制文案（title/aria + 复制后可见文本） | 旧：title 恒 `Copy code`、`showText=true` → 复制后 `<span>Copied!</span>`（@3073140 段 `this.copied&&this.showText`）；zh 由应用覆盖表提供 `复制代码` / `已复制！` | 修复前 `CodeBlock.tsx:256-257` `title={t('copy')}`（`Copy`/`复制`）、`:261` `<span>{t('copied')}</span>`（`Copied`/`已复制`） | 回归-已修 | 已修（W7：新增 `copyCode` 键 + 复用 `copiedBang`） |
| 复制成功图标 / emerald 态 / 复制失败静默 | 旧 `this.copied?Je(Ce,'sm'):Je(Ae,'sm')`；应用 `code-blocks.ts:22-25` `replaceSvg` + `button.style.color='rgb(5 150 105)'`；失败 `catch(e){console.error('Failed to copy:',e)}` | `CodeBlock.tsx:260` `<Check/>/<Copy/>`、`:254` `text-emerald-600`、`:380` `.catch(() => {})` | 一致 | 无 |
| 工具卡 console 输出复制入口（1500ms / `Copy output` / `console` 标签 / 可见 `Copied!`） | 旧：`3e10f58:src/lib/local-tools.ts:899` `run_command ? <console-block .content=${output} .variant=${variant}> : …`；`<console-block>`（@3178138 `setTimeout(...,1500)`；模板 `title="${L('Copy output')}"`、`<span>${L('console')}</span>`、`${this.copied?…:<span>${L('Copied!')}</span>}`） | 修复前 `tool-renderers/shared.tsx:720-722` 只渲染 `<div class="qf-console-block …"><pre>…</pre></div>`：**无标题栏、无复制按钮** | 回归-已修 | 已修（W1 补实现；W11 复核三键取值并补测试护栏） |
| 工具卡代码块复制反馈形态（title 恒定 + 可见 `Copied!`） | 旧：同一 pi `<code-block>` + `<copy-button>`：title 恒 `Copy code`（`this.title` 唯一赋值点在 constructor）、`showText=!0`、2000ms | 修复前 `shared.tsx:688` `copyLabel = copied ? t('copied') : t('copy')`（title 会切换）、`:702` 只有图标无可见文本 | 回归-已修 | 已修（W12：title 恒 `copyCode` + 追加 `copiedBang` 文本 + 复制态尺寸配方与聊天侧一致） |
| console 输出区更新后自动置底 | 旧 `<console-block>.updated(){let e=this.querySelector('.console-scroll');e&&(e.scrollTop=e.scrollHeight)}`（@3145903；无 scroll 监听、无 `_autoScroll`、不区分用户手动上滑） | 修复前 `<pre className="max-h-96 overflow-auto …">` 纯函数渲染，无 ref/effect/滚动写入 | 回归-已修 | 已修（W12：新增 `ConsoleScrollArea`，无依赖数组的 `useEffect` 对应 lit `updated()` 的每次渲染后语义；旧缺陷「不区分手动上滑」原样保留并登记） |
| 代码高亮 heading / list / code / quote / strong / emphasis / link 语义 | 旧 CSS：`.hljs-section{color:var(--syntax-heading);font-weight:700}` @4036、`.hljs-bullet{color:var(--syntax-list)}` @4094、`.hljs-code` @3837、`.hljs-quote` @3904、`.hljs-emphasis{…italic}` @4132、`.hljs-strong{…700}` @4197、`.hljs-subst` @3992（变量 `--color-text-primary` 未定义 → 无可见效果）；`.hljs-link` **无规则** | 修复前：`src/index.css:8034-8076` 只有 11 组 `--qf-hl-*`（无 heading/list）；`code-highlight.ts:43-56` 词表无 heading/list/code/quote/strong/emphasis；markdown `# 标题`→`keyword`（`:1423-1428`）、列表符→`punct`（`:1447-1452`）、`[label](url)`→label `plain`/url `builtin` | 回归-已修 | 已修（W3：+7 token、+4 变量、+6 规则；无 `--qf-hl-link` 以对齐旧无规则口径） |
| SVG 代码块 CSS（节点去框 + 标题栏内边距；`…-toolbar-floating` 不复活） | 旧 `3e10f58:src/index.css:2375`（`.quickforge-svg-code-block > div:first-child{position:relative;border:0!important;background:transparent!important;box-shadow:none!important}`）、`:2395`（`> div:first-child:not(.quickforge-svg-code-toolbar-floating){padding-left/right:0!important}`）、`:2382/:2391`（floating toolbar，宿主由装饰层 `code-blocks.ts:183/381` 施加） | 修复前 `CodeBlock.tsx:433` 仍输出 `quickforge-svg-code-block`，但 `src/index.css` 中该类 **0 条规则**；`quickforge-svg-code-toolbar-floating` 在全仓 `src/**` 已 0 处输出 | 回归-已修 | 已修（W3：按旧值补回 2 条等价规则；依赖已删除 DOM 的 2 条 floating 规则按「不为死规则复活」不补，并由测试锁定不得回流） |
| 高亮分桶映射（CSS selector-class/id、CSS 函数 `name(`、YAML/JSON/TOML/INI 字面量、Setext 标题） | 旧 hljs 分桶：`selector-class/-id` 属 @3520 `--syntax-constant` 规则；`FUNCTION_DISPATCH{className:'built_in',begin:/[\w-]+(?=\()/}` → `--syntax-variable`；YAML `keywords:{literal:'true false yes no null'}`、JSON `keywords:{literal:['true','false','null']}`、`TOML, also INI` 字面量 `\bon\|off\|true\|false\|yes\|no\b` → `.hljs-literal` → constant；Markdown Setext 变体 `(?=^.+?\n[=-]{2,}$)` → `.hljs-section` | 修复前：`.x/#x` → `function/builtin`；CSS 值位置 `name(` → `function`；字面量 → `keyword`；Setext 不识别（仅 `#` 形式） | 回归-已修 | 已修（W10：`.x/#x`→`attr`、`name(`→`builtin`、字面量→`number`、Setext→标题行+下划线行 `heading`；复用既有 token，无新增变量） |
| `.qf-hl-punct` / `plain` 无变量无规则 | 旧 CSS **无** `.hljs-punctuation`、无裸 `.hljs{}`（`\.hljs\s*\{` 命中 0） | 新 CSS 同样无 `.qf-hl-punct` 规则（`punct` 渲染为无样式 span、`plain` 段不产 span） | 一致 | 无（`src/index.css:8024-8032` 注释已声明） |
| 代码块 `<code>` 丢失 `hljs` class | 旧 `<code class="hljs language-${language}">`（`pi-web-ui-B-_rXig1.js` @3144997） | `CodeBlock.tsx:498` `<code className={\`language-${label}\`}>` | 有意保留 | 无实际视觉影响（只影响 `code:not(.hljs)` 这类块内不命中的选择器）；如需逐字兼容再补 |
| 未注册语言回退（`highlightAuto` → 保守 generic） | 旧 @3144283：`this.language && A1.getLanguage(this.language) ? A1.highlight(e,{language:this.language}).value : A1.highlightAuto(e).value`（会做语言猜测） | `code-highlight.ts:187-191` 走 `tokenizeGeneric`；`:2383` 仅 comment/string/keyword 命中才算认领；`:61` 200KB 上限直接 plain；`:181` `text/plaintext/txt`/缺省 → plain | 有意保留（确定性 + 性能；已在 `code-highlight.ts:16-20,2368-2370` 声明为已知差异） | 保留；未注册语言着色变少属预期 |
| Markdown 链接 target/rel | 旧 @2175400：`n.link=function(e){…replace('<a ','<a target="_blank" rel="noopener noreferrer" ')}`（不区分协议） | `Markdown.tsx:55-59` 同 `target/rel`，另加 `className="text-primary underline"` | 一致 | 无 |
| Markdown 图片 src 白名单 | 旧 renderer 只覆盖 `link`/`table`，**无 image 覆盖**、未传 `sanitize`（pi 产物内无 DOMPurify）→ 任意 `src` 原样进 DOM | `Markdown.tsx:44-50` `isSafeMarkdownImageSrc()`（仅 http/https/blob/`data:image`/相对）；`:60-70` unsafe 省略 `src` + `loading="lazy"` | 有意保留（安全加固） | 保留 |
| Markdown 表格 wrapper | 旧 @2175400：`<div class="overflow-x-auto my-2 border border-border rounded">` | `Markdown.tsx:78-82` 同一组 class | 一致 | 无 |
| Markdown 段落/列表行高与字号变量 | 旧 `3e10f58:src/index.css:2613-2622`（`font-size:var(--quickforge-message-font-size,14px)` + `:where(p,li){line-height:var(--quickforge-message-line-height,1.625)}`）、`:2626-2633`（subagent 同款） | `src/index.css:3006-3018`（4 组选择器）+ `:3023-3029`（subagent trace）；通用规则 `:2902-2905`、`:2942-2943` | 一致 | 无 |
| Markdown 原始 HTML（`skipHtml`） | 旧：marked 默认 `html` token + lit `d(a)` 注入（@2175400+），无 sanitize | `Markdown.tsx:140` `skipHtml`（原始 HTML 被丢弃） | 有意保留（安全加固） | 保留（如需支持需配白名单 sanitizer，而非取消 `skipHtml`） |
| Markdown 容器 class（含 thinking 变体） | 旧 @2175400+：thinking `text-muted-foreground italic … text-sm [&>*:last-child]:!mb-0`；普通 `text-foreground max-w-none break-words…` | `Markdown.tsx:129-134`：`qf-markdown-block max-w-none break-words [&>*:last-child]:!mb-0` + `isThinking ? 'text-sm italic text-muted-foreground' : 'text-foreground'` + `data-qf-thinking` | 一致 | 无（`overflow-wrap:anywhere` 由 `src/index.css:3011/3025` 承担） |
| 思考块 header：未托管时 fail-visible | 旧 `3e10f58:src/index.css:3199-3201`：`pi-chat-panel thinking-block > .thinking-block > .thinking-header:not(.quickforge-process-thinking-header){visibility:hidden}` | `src/index.css:3621-3644`：header 保持可见，仅自带 `<svg>` `visibility:hidden;opacity:0`，hover/focus 显现 | 有意保留（fail-visible 加固：未接管时不再丢内容） | 保留（文档需记录「未接管的原生 header 现在可见」是刻意行为） |
| 思考/工具摘要行字号（固定 0.875rem → 跟随 `--quickforge-message-font-size`） | 旧 `3e10f58:src/index.css:2856-2868`、`:2988-3001`（`font-size:0.875rem`）；过程组 header `:3203-3217`（`0.875rem !important`） | `src/index.css:3267`、`:3401` 改 `calc(var(--quickforge-message-font-size, 14px) * 0.875)`（注释 `:3266`/`:3400` 明写「原 0.875rem」）；过程组 header `:3651-3665` 同式并**去掉 `!important`** | 有意保留（有意缩放改动；需回归确认 utility 不反超字号） | 保留 |
| 工具摘要字号（旧已是 calc）+ 新增类名漂移选择器 | 旧 `3e10f58:src/index.css:3044-3052`：`.quickforge-local-tool > .quickforge-tool-summary, … { font-size: calc(var(--quickforge-message-font-size,14px)*0.875) }` | `src/index.css:3449-3458`：同式，另加 `.quickforge-tool-message > .space-y-2 > …`、`> .quickforge-generated-image-tool > …` | 一致（新增选择器为修复类名漂移） | 无 |
| 思考块组件行为 + 内层 markdown 字号 | 旧 pi `thinking-block` 元素（旧 CSS 依据 `.thinking-block`/`.thinking-header`；`3e10f58:src/index.css:3327-3333`：`markdown-block > .text-sm{font-size:0.875rem}` + `:where(p,li){line-height:1.6}`） | `ThinkingBlock.tsx:22-42`（`qf-thinking-block thinking-block` 根、header 常显、默认折叠 `:19`、流式 shimmer `:33`、标签 `t('thinkingBlockLabel')`）；字号 `src/index.css:3792-3798` 逐字等价 | 一致 | 无 |
| 工具消息卡片（DOM 契约 + 状态色） | 旧 pi `tool-message` 自定义元素（`pi-web-ui-B-_rXig1.js` @1863563+：`tool/toolCall/result/pending/aborted/isStreaming` 属性 + `aborted-message` 元素 `text-sm text-destructive italic`） | `ToolMessage.tsx:19-25,127-135`（同名 DOM 属性桥接）、`:140-149`（aborted → 合成 isError）、`:55-65` 状态色 | 一致 | 无 |
| 附件 tile「在文件管理器中打开」提示 | 旧 `editor-bindings.ts:84`（composer 粘贴文本附件）、`message-actions.ts:304`（用户消息）两条硬编码文案；旧产物 `index-DyE33U-f.js` @317678、@574596 | `panel-decoration/editor-bindings.ts:40-42` + `t('openAttachmentInFileManager')`；`panel-decoration/message-actions.ts:361-367` + `t('openAttachmentInFileManagerHint')`；选择器改 `.qf-attachment-tile`（`AttachmentTile.tsx:29`） | 一致 | 无 |
| 附件 tile 自身 title（hover 提示是否被内层抢占） | pi @1811800+：tile 内文件名截断 `${fileName.substring(0,8)}...`、删除按钮 `title="${L('Remove')}"`；**内层按钮是否自带 title 未逐字确认** | `AttachmentTile.tsx:35/54` `title={fileName}`；`:59` 同款截断；`:67` `t('composerRemoveAttachment')` | 不可考证 | 登记；若 hover 提示被内层抢走，考虑内层按钮 title 置空 |
| 附件条数 / 单文件体积上限 | pi @1813254：`this.maxFiles=10, this.maxFileSize=20*1024*1024` + 英文 alert | `MessageEditor.tsx:26-27` 同值；`:234` `t('composerFileTooLarge')` | 一致 | 无 |
| 附件解析上限 / 超时 / PDF 页数 / 提取文本截断 | 旧 pi 文档抽取（@1790500-1793600）：PDF `for(let e=1;e<=n.numPages;e++)` **无上限**、zip/xlsx/pptx 直接 `JSZip` 无体积上限、`TextDecoder` 无长度上限 | `attachment-loader.ts:41-48`：`ZIP_ENTRY_MAX_UNCOMPRESSED_BYTES=50MB`、`ZIP_TOTAL_MAX_UNCOMPRESSED_BYTES=100MB`、`EXTRACTED_TEXT_MAX_LENGTH=2MB`（`:46` 截断标记）、`PDF_MAX_PAGES=500`、`DOCUMENT_PROCESS_TIMEOUT_MS=30_000` | 有意保留（新增加固，非缺失） | 保留；发布说明记录「大附件行为可能变化」 |
| Excel 预览行列上限 | 旧 `WorkspaceDocumentContent.tsx:12`（BASE）`EXCEL_MAX_ROWS = 5000`（`:211-212` 截断）；旧仓库无列上限 | `AttachmentPreview.tsx:24-25`：行沿用 5000 + 新增 `EXCEL_MAX_COLUMNS = 50` | 有意保留（列上限为新增加固） | 保留 |
| 用量条聚合口径与容器 | pi @1871025 `renderStats()`、@448763 `rh()`/`ih()`/`Xse()` | `UsageBar.tsx:11-32`（`formatCost/formatTokenCount/formatUsage` 逐字等价）、`:38-62` 聚合等价、`:71-72` 判空；容器 `:75-91`（`<span @click>` → `<button>`） | 一致 | 无 |
| 消息窗口化开关 | 旧 `ChatPanelHost.tsx:656`（BASE）`createMessageWindow({ enabled: false })`；常量 `windowed-messages.ts:27-35`（6 / 48 / 80_000 / 3 / 3） | `ChatSurface.tsx:556` 同样 `enabled: false`；常量 `windowed-messages.ts:5-13` 同值 | 有意保留（窗口化仍关闭，与旧一致） | 保留（不新开窗口化） |
| 数学渲染参数与 display 包裹 | 旧 4 个 marked 扩展（@2173977-2175475）全部 `renderToString(text,{throwOnError:!1,displayMode:…,output:'html'})`；display 包 `<div class="my-4">` | `KatexMath.tsx:14-19` 同参；`:35-38` display → `<div className="my-4">` | 一致 | 无 |
| 数学 `$…$` / `$$…$$` 匹配规则（行中 `$$`、内容含 `$`、`.trim()`） | 旧 `blockMathDollar`：`level:'block'`、`start(e){return e.indexOf('$$')}`、`tokenizer /^\$\$([^$]+?)\$\$/s`、`text:t[1].trim()`；实测 `a $$E=mc^2$$ b` → `<p>a </p><div class="my-4">…katex-display…</div><p> b</p>` | 修复前 `chat-math.ts:174-184`  前非空白」守卫；`tests/frontend/chat-math.test.ts:70-75` 当时把「行中保持字面」写成护栏（修复前 8 tests 全绿） | 回归-已修 | 已修（W2：恢复任意位置匹配 + `[^$]` 内容约束 + `.trim()`，并拆段落以复刻旧 `<p>a </p>+<div class="my-4">+<p> b</p>` 形态） |
| 数学错误回退（catch 分支） | 旧 @2173977+：inline 失败 → `<span class="text-red-500 font-mono">$text$</span>`（**带定界符**）；block 失败 → `<div class="my-4 text-red-500 font-mono">$text$</div>` | `KatexMath.tsx:33` `<span className="text-red-500 font-mono">{latex}</span>`（无定界符、无 `my-4` 外壳）；`throwOnError:false` 时 KaTeX 自身产出 `katex-error` span，故该 catch 分支基本不可达 | 有意保留（几乎不可达，仅存档差异） | 保留；如需逐字对齐再按 `display` 分支补定界符与 `my-4` |
| 数学 `\(…\)` / `\[…\]` 的占位符预处理 | 旧 marked 自定义 tokenizer 直接在 `\` 位置匹配 `/^\\\((.+?)\\\)/s`、`/^\\\[(.+?)\\\]/s`（**不需要**占位符），inline 变体 `level:'inline'`、block 变体 `level:'block'` | `chat-math.ts:145-151` `preprocessLatexDelimiters()` 先换 `QFMTHI/QFMTHB` 占位符（原因：markdown 会吞 `\(` 的反斜杠，见 `:9-13` 注释），再由 `rehypeQfMath`（`:323-328`）还原 | 有意保留（实现必要差异，行为目标一致） | 保留；文档记录「为何需要占位符」 |
| 自动滚动近底阈值 80 | 旧 `3e10f58:src/components/chat/scroll-sync.ts:22-23` `scrollHeight - scrollTop - clientHeight <= 80`；旧产物同值（`ChatPanelHost-kh5gPhZf.js` @51939 区域 `…<=80`） | `scroll-sync.ts:31-32` 同式 `<= 80` | 一致 | 无 |
| pi 内部 50/10 迟滞 + ResizeObserver 贴底 | 旧 `pi-web-ui-B-_rXig1.js` 1866673 起（`_autoScroll`=1866683、`_handleScroll`=1866750）：`t!==0&&t<this._lastScrollTop&&i>50?this._autoScroll=!1:i<10&&(this._autoScroll=!0)`；`ResizeObserver`（@1867791 起）观察 `.max-w-3xl`，`_autoScroll` 为真时直接 `scrollTop=scrollHeight`；`sendMessage` 中重开（@1869874） | 修复前：`scroll-sync.ts` 只有 80 单阈值；`markUserScrollUp()` 立即 `disableAutoScroll()`（无距离门槛）；React 侧只在窗口提交时贴底（`ChatSurface.tsx:631-633`），`autoScrollRef` 由 `ChatPanelHost.tsx:683` 的 `setAutoScroll` 驱动 | 回归-已修 | 已修（W4：`releaseFollowDistancePx=50`、`repinFollowDistancePx=10`、`markUserScrollUp` 距离门控、`handleScroll` 中 `distance<10 → 立即重新启用`） |
| 旧 pi 的 `clientHeight` 收缩忽略分支 | 旧 `@1866750`：`if(r<this._lastClientHeight){this._lastClientHeight=r;return}`（布局抖动误判防护） | 新实现无等价物（由「非用户上滑 & `!isNearBottom` → 重贴底」间接兜底） | 有意保留（未恢复；本轮按任务只恢复 50/10 两项） | 登记；需真机验证（devtools 开关/字体加载/面板缩放时是否误重贴底） |
| 重新贴底条件收紧 | 旧 `3e10f58:scroll-sync.ts:118-123`：`else if (isNearBottom(scrollContainer))` → **任意**近底事件即恢复 | `scroll-sync.ts:108-115`：需「向下滚动 `>+1px` **且** 500ms 内用户意图 **且** 距底 `<=80`」；新增 `handleWheel/handleKeyDown/handleTouchMove` 标记（`:119,132,143`） | 有意保留（行为收紧；符合「不抢用户滚动」意图） | 保留；若被判定为回归，放宽为 `isNearBottom && (recentlyUserScrolled() \|\| currentScrollTop>lastScrollTop+1)` |
| 到顶加载更早消息（`onReachTop`）的触发面 | 旧 `3e10f58:scroll-sync.ts:104-108`：在 `handleScroll` 内**无条件**判断 `currentScrollTop<=0 && lastScrollTop>0`，且未与 `beginProgrammaticScroll` 配对 | `scroll-sync.ts:108-110` 仅在 `userInitiatedScrollUp` 分支内触发；`:118-124` 新增 wheel 且已到顶的兜底；`ChatPanelHost.tsx:684-692` 用 `beginProgrammaticScroll()` 包住 `loadMoreMessages()` | 有意保留（触发面收窄 + 新增兜底，避免程序化回填再次触发加载） | 保留并记录 |
| 回到底部按钮：可见性迟滞 280/120、jump 900ms、reduced-motion/wheel 中断/`scrollend` 收尾 | 旧 `panel-decoration/scroll-to-bottom-button.ts:21-24`：`SHOW_DISTANCE_PX=280`/`HIDE_DISTANCE_PX=120`/`JUMP_SETTLE_MS=900`；旧产物 `index-DyE33U-f.js` @581945 `var cy=280,ly=120,uy=900`、@583278-583304（`<=1` 或 reduced-motion 即时、否则 smooth + wheel 打断 + `scrollend` + 900ms 兜底） | `panel-decoration/scroll-to-bottom-button.ts:22-24` 同三常量；`:56-105` 同款 reduced-motion/中断/收尾逻辑 | 一致 | 无 |
| 跳转落点判定 `distance <= 120 → enable()` | 旧 `ChatPanelHost.tsx:722-729`（BASE）`panel.querySelector('agent-interface .overflow-y-auto')` + `if (distance <= 120) scrollSync.enable()`；旧产物 @88030 | `ChatPanelHost.tsx:698-705`：`panel.querySelector('.qf-chat-panel .qf-scroll-container')` + `distance <= 120` | 一致（数值一致，仅选择器更新） | 无 |
| 自动滚动容器选择器 / ResizeObserver 观察集合 / `setAutoScroll` 桥接 | 旧 `scroll-sync.ts:24` `panel.querySelector('agent-interface .overflow-y-auto')`；`:186-192` 观察 scrollContainer、`.max-w-3xl`、`.quickforge-composer-dock`；`:26-29` `setPanelAutoScroll` → `agent-interface.setAutoScroll` | `scroll-sync.ts:28-29` `.qf-scroll-container`；`:170-177` 同三个观察目标；`:34-36` `setAutoScroll?.(enabled)` → `ChatPanelHost.tsx:683` → `ChatSurface.tsx:648-651` | 一致（等价重接） | 无 |
| 旧 pi `<code-block>` 在流式期间是否被装饰层替换过复制按钮（SVG/Mermaid 分支） | 旧 `panel-decoration/code-blocks.ts:615` 附近的 SVG/Mermaid 分支会移除/隐藏原按钮（`:166-167`、`:362-363` 的 `copy-button[data-quickforge-*-original-copy="true"]` 隐藏/恢复） | 本次只核对了普通代码块路径；流式期间该分支的实际触发面未逐节点核对 | 不可考证 | 登记（未影响已修项结论） |
| `windowed-messages.ts` 相比 BASE 净减 89 行 | 旧 `windowed-messages.ts:27-35` 常量（6/48/80_000/3/3）与 `enabled:false` 已核对 | 新文件常量同值（`:5-13`、`:132-136` 读取）；被删除的 89 行（推测为 `message-list` 原型 setter 拦截，因 pi 元素已移除）**未逐行核对** | 不可考证 | 登记；如需结论另开专项 |

**域 B 判定统计**：一致 19、回归-已修 8、有意保留 14、不可考证 3（共 44 条）。

### 2.3 域 C · 设置与通用 UI 基元（下拉、数字输入、info-tip、弹窗、switch、Input 聚焦）

| 交互项 | 旧证据 | 新证据(修复前) | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| 设置下拉实现归属（QF 自有 vs mini-lit） | **QF 自有 Lit 自定义元素**：`3e10f58:src/lib/quickforge-settings-select.ts:1-2`（`import { LitElement, html, nothing, render } from 'lit'`）、`:103` `role="combobox"`、文件末 `customElements.define('quickforge-settings-select', …)`；调用点 `default-options-settings-tab.ts:42,879,980,995,1017`。mini-lit 仅用于聊天思考级别（`patch-thinking-selector.ts:1-2`）。旧产物：`quickforge-settings-select-menu` 只在懒加载 chunk `SettingsWorkspacePage-DQoP0SXd.js` 命中，`index-DyE33U-f.js` 中 0 命中 | 自有 React 实现：`src/components/settings/SettingsSelect.tsx`（207 行）+ 纯函数 `settings-select-state.ts` | 一致（均为 QF 自有，仅技术栈 Lit CE → React） | 无 |
| 打开键定位（ArrowDown→首个、ArrowUp→末个、Home→首个、End→末个） | 旧 `…/quickforge-settings-select.ts:136-153`：`ArrowDown`/`Home`→`_selectableIndexes()[0]`；`ArrowUp`/`End`→末个；`preventDefault` 后 `_openMenu(initialIndex)` | `SettingsSelect.tsx:49-58`（`ArrowUp→'End'`、`ArrowDown→'Home'`，再交给 `moveSelectFocus`）+ `settings-select-state.ts:12-14` | 一致 | 无 |
| 打开键「多走一格」隐患 | 旧 `_openMenu`（`:173-174`）在**同一次 keydown 分派**中挂 `document` 的 `pointerdown`/`keydown` 监听；文档级 `_handleKeyDown`（`:404-425`）对 Arrow 无条件 `_moveFocus(±1)`；关闭前（`:190-200`）**无任何 stopPropagation 防护** → 打开后同一次按键会再移动一格 | `SettingsSelect.tsx:148-156`：`event.stopPropagation()`（注释「Do not let the opening key reach the newly attached document listener」）；文档监听改在 `useEffect`（`:87-132`）提交后挂载 | 有意保留（旧缺陷修复） | 保留；可补一条「打开键只在首/末项停下」键盘用例（现有 `settings-react-infrastructure.test.ts:97-99` 仅断言落点） |
| 打开态 Arrow/Home/End 行为（clamp 不循环） | 旧 `:404-425` + `:207-216` | `SettingsSelect.tsx:99-105` + `settings-select-state.ts:12-21`（Home/End 直取首尾；未聚焦时落到箭头指向的边界） | 一致（未聚焦时 ArrowUp 旧→首项、新→末项，正常路径不可达） | 无 |
| Escape 关闭 + 焦点回触发器 | 旧 `:441-443` `this._close(true)` → `:190-200` `if (restoreFocus) this.triggerRef.value?.focus()` | `SettingsSelect.tsx:112-115` → `:42-47` `close(restoreFocus = true)` | 一致 | 无 |
| 外部 pointerdown 关闭（capture） | 旧 `:173` + `:383-388`（trigger/menu 双 `contains` 早退）→ `_close(true)` | `SettingsSelect.tsx:92-95`（capture=true，双 `contains`）→ `close()`（默认回焦） | 一致 | 无 |
| Tab：先关后按浏览器顺序 | 旧 `:445-449` `this._close(); this.triggerRef.value?.focus()` | `SettingsSelect.tsx:116-119` `close()`（默认回焦 ⇒ 等价） | 一致 | 无 |
| 定位算法（漂浮/向上展开、maxHeight 300、minWidth、左边界 clamp） | 旧 `:239-266` `_reposition`：margin 8 / gap 6 / maxHeight 300 / `minWidth: max(12rem, rect.width)` / left clamp | `settings-select-state.ts:23-38` 常量与分支逐行等价 | 一致 | 无 |
| 菜单 `transform-origin` / 进入退出动画时长 | 旧 `3e10f58:src/index.css:975-993` `.quickforge-settings-select-menu`：**无 animation、无 transform-origin**（即时挂卸）；旧产物 `index-B1G0LqYR.css` @157671 起 5 处命中亦无 animation。同文件另一基元 `.quickforge-menu-in`（`:592-600`）= `var(--quickforge-dur-base)`，但设置下拉**未**使用 | `src/index.css:1238-1256` 与旧逐字相同 | 一致（两版均无动画） | 无（若要「菜单进场」属行为变更，非 parity 缺口） |
| 搜索过滤 / 跳过 disabled / no-results | 旧 `:308-`（`_isVisible` 大小写不敏感）、`:218-224` `_selectableIndexes`、`:378` `role="status"` 空结果 | `settings-select-state.ts:7-10`、`SettingsSelect.tsx:29-33,176-181,201` | 一致 | 无 |
| disabled 期间/之后不复用旧菜单 | 旧无显式重置：靠 `disconnectedCallback`（`_close()`）与 `updated()`（`:273-281` 仅 open 时 `_refreshMenu`）间接兜底 | `SettingsSelect.tsx:35-40` 显式 `setExpanded(false); setQuery(''); setFocusedIndex(-1)` + 注释；测试 `tests/frontend/quickforge-settings-select.test.ts:36-43` | 有意保留（新更严格） | 保留 |
| 数字输入提交时机（change+blur 双提交 → 去重） | 旧 `default-options-settings-tab.ts:1127-1133`：`@input=… @change=${() => this.commitAutoCompactThresholdPercent()} @blur=${() => this.commitAutoCompactThresholdPercent()}`；同型 `:1152-1161`、`:1174-1182`（三个 number input 全部双绑定）→ 必然双提交；commit 体 `:368-380`（`Number.isFinite` → `Math.max(50, Math.min(95, Math.round()))`） | `src/components/settings/tabs/SettingsNumberInput.tsx:8-38`：注释「Native change commits typing on blur and steppers immediately, unlike React onChange.」；`:12-22` `committedRef` 去重后监听原生 `change`；`:27-30` `onInput` 先清 `committedRef`；`:31-37` Enter 走同一去重路径 | 有意保留（旧缺陷修复） | 保留；若要「值未变也重新保存」需另立语义 |
| 校验/归一化的职责拆分 | 旧 clamp 写在 commit 回调（`:368-380` 50–95、`:382-388` 0–20） | 归一化下沉到各 tab 的 `commit*` 回调（`SettingsNumberInput` 只负责「何时提交」） | 一致（结果等价） | 无 |
| info-tip 计时（hover 150ms / leave 120ms / focus 立即 / click toggle） | 旧 `3e10f58:src/lib/info-tip.ts:116-119` `setTimeout(() => this._openPopover(), 150)`；`:121-124` `setTimeout(() => this._closePopover(), 120)`（挂 `@mouseleave` `:180` 与 `@blur` `:182`）；`:126-129` `@focus`、`:184` `@click` | `src/components/ui/info-tip.tsx:84`（`updateOpen(true, 150)`）、`:85`/`:87`（120）、`:86`（focus）、`:88`（click toggle） | 一致（实测值与传闻一致：150/120） | 无 |
| info-tip 外部点击 / Escape / scroll-resize 重定位 | 旧 `:155`（document `pointerdown` capture）+ `:131-136`（双 contains 早退）；`:139-143`（Escape：`preventDefault`+`stopPropagation`+关闭）；`:144-151` + `:157-158`（scroll capture / resize 非 capture） | `info-tip.tsx:52-56`+`:63`（capture，双 contains）；`:57-64`（Escape 同三点）；`:28-42` `reposition`（margin 8 / gap 6 / 右边界与下边界夹取）+ `:65-66` | 一致（旧常驻监听、新仅 open 时挂载） | 无 |
| info-tip aria 属性 | 旧 `:177` `aria-label=${t('help')}`、`:178`/`:64` `aria-expanded`、`:76` popover `role="tooltip"`；**无 `aria-describedby`**、popover 无 id | `info-tip.tsx:81`（`t('help')`）、`:82` `aria-expanded`、`:96` `role="tooltip"`，另新增 `:15` `tooltipId`、`:83` `aria-describedby={open && label ? tooltipId : undefined}`、`:96` `id={tooltipId}` | 有意保留（无障碍增强，无视觉/交互变化） | 保留 |
| info-tip React 层形态 | 旧 `3e10f58:src/components/ui/info-tip.tsx:1-9` 仅 `createElement('quickforge-info-tip', { label })`（薄壳，依赖 Lit CE 与 `src/lib/info-tip.ts`） | `src/components/ui/info-tip.tsx:1-99` 完整 React 实现（`createPortal` 到 body） | 一致（实现范式变更，行为一致） | 无 |
| 确认弹窗：焦点陷阱 / 初始焦点 / Escape / Enter 语义与破坏性守卫 / 按钮顺序 / 关闭后焦点恢复 / 单例互斥 | 旧 `3e10f58:src/components/ui/confirm-dialog.tsx:63/64-76/77-101/107-112/200-230` 全套；`previouslyFocused` + `cleanup()` 的 `setTimeout(…,0)` 内 `previouslyFocused.focus()` | 新 `src/components/ui/confirm-dialog.tsx:44/60-61/63/64-76/77-101/107-112/131/149-160/164-177/195-239`（`git diff` 仅两处颜色类删改，无结构变化；焦点陷阱 `:77-101` 逐字相同） | 一致 | 无 |
| 确认弹窗 panel 新增 `stopPropagation` | 旧 `:107-112` 仅 backdrop `onMouseDown` + `target===currentTarget` → cancel | 新 `:123` panel 上新增 `onMouseDown={e => e.stopPropagation()}`（对上述判断是冗余防御） | 有意保留（冗余防御） | 保留 |
| 输入弹窗（prompt）：焦点陷阱 / 关闭后焦点恢复 | 旧 `prompt-dialog.tsx:33-37`（初始聚焦+select）、`:52-54`（backdrop `onClick` + target 判断 → `onResolve(null)`）、`:104-107` 只 `root.unmount() + container.remove()`（**无**焦点恢复、**无**焦点陷阱） | `src/components/ui/prompt-dialog.tsx` **文件未改动**（`git diff` 无该文件） | 一致（两版一致地缺失；非回归） | 保留；可选改进（非 parity 缺口） |
| switch 可访问名称 | 旧 input **无名称**：`default-options-settings-tab.ts:948-960` `renderSwitch()` 原文 `<label class="quickforge-settings-switch" aria-disabled=…><input type="checkbox" .checked ?disabled @change /><span aria-hidden="true"></span></label>`（label 内无文本，input 无 `aria-label`/`aria-labelledby`）；同型 `memory-settings-tab.ts:127`、`backup-settings-tab.ts:277`、`lan-access-settings-tab.ts:243`；`custom-providers-only-tab.ts:632` 只有 label 的 `title`（对 input 名称无效） | `src/components/settings/tabs/shared.tsx:23-39`：显式 `label`/`aria-label`/`aria-labelledby` 优先，否则把 `.quickforge-settings-row-title` 的 id 关联为 input 的 `aria-labelledby`（`:33-38`），并设 `aria-label`（`:48`）；`:52` `<span aria-hidden="true">` | 有意保留（无障碍补齐） | 保留；遗留载体（本域外）：`PluginsPage.tsx:167`、`AgentProfilesPage.tsx:710`、`skills-dialog.tsx:269`、`CustomProvidersSettingsTab.tsx:676` 仍为旧结构 |
| switch focus-visible 样式 / 结构 / disabled | 旧 `3e10f58:src/index.css:1744-1747`（`outline: 2px solid color-mix(in oklab, var(--primary) 48%, transparent); outline-offset: 2px`）、`:1749-1752`（disabled/`[aria-disabled=true]` 0.52）、`:1960-2005`（3.125rem×1.75rem、`::after translateX(1.375rem)`、160ms ease-out）；旧产物 `index-B1G0LqYR.css` @181388/@181520/@181645 | `src/index.css:2007-2010`（逐字相同）、`:1999-2003`、`:2012-2016`、`:1960-2005`（同值） | 一致 | 无 |
| 设置页 icon-only 按钮的可访问名称 | 旧 `SettingsWorkspacePage.tsx`：`aria-label="返回工作区"`、`aria-label={mobileDetail===null ? '返回工作区' : '返回设置'}`、`aria-label="返回顶部"`、`aria-label={t('searchSettings')}`；`lan-access-settings-tab.ts:354-358`（密码显隐：`aria-label`+`title`+`aria-pressed`） | `SettingsWorkspacePage.tsx:187-195`（icon 按钮 + `aria-label`）、`:144`/`:220`（导航项名称来自文本）；`LanAccessSettingsTab.tsx:317-322` 同一套 `t()` key | 一致 | 无（全量启发式扫描：`src/components/settings` + `src/components/ui` 内 3 处伪命中均为含可见文本者） |
| `Button` 基元是否自动补可访问名称 | 旧 `3e10f58:src/components/ui/button.tsx` 全文 | 新 `src/components/ui/button.tsx` 全文（`git diff` **无差异**）→ 两版都不注入 aria-label，`size="icon"` 由调用点负责命名 | 一致 | 无 |
| `ui/Input` 聚焦反馈（`focus-visible:border-primary` 是否为 dead） | 旧 `3e10f58:src/components/ui/input.tsx:9`：`… placeholder:text-muted-foreground focus-visible:border-primary focus-visible:outline-none disabled:…`；根因：`3e10f58:src/index.css:23-27` 的 `@theme` 只定义 `--radius` / `--shadow-quickforge`，`--color-primary` **无任何定义** ⇒ 本地 Tailwind 无法生成 `border-primary` 变体 → 旧产物中 `focus-visible\:border-primary` 命中 **0**（对照 `focus-visible\:border-ring` 命中 1 @68402、`.border-primary{}` 存在但来自 pi 预构建包）→ **dead class** | `src/components/ui/input.tsx:9`：`… focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none …`；新 `src/index.css:257-287` 新增 `@theme inline { --color-* }`（`--color-primary` :264、`--color-ring` :276）→ 颜色工具类可解析 | 有意保留（旧 dead → 新真实 ring：补齐而非回归） | 保留（W5 已用旧产物 alive/dead 矩阵与逐文件出现数复核，无 alive 回归） |
| 设置页输入控件的聚焦反馈来源 | 旧设置页走自有 CSS：`3e10f58:src/index.css:923-930` `.quickforge-settings-select/input/textarea:focus { border-color: color-mix(in oklab, var(--primary) 42%, var(--border)); background: var(--background); box-shadow: var(--shadow-quickforge) }`（**不**依赖 dead 的 Tailwind 类） | `src/index.css:1179-1185` 同规则保留，且新代码仍在 11 处复用 `quickforge-settings-input`（`SettingsWorkspacePage.tsx:143,220`、`CustomProvidersSettingsTab.tsx:627…808`、`DefaultOptionsSettingsTab.tsx:828,931,1132,1155,1175`、`LanAccessSettingsTab.tsx:310`） | 一致 | 无 |
| 设置页行 hover / 表单组行 hover / 移动端 active / 输入 focus / 行级 `:focus-within` / 下拉菜单视觉 | 旧 `3e10f58:src/index.css:700-712`+`:733-735`（行 hover `muted 26%`）、`:752-754`（表单组 hover `background:transparent`）、`:1888-1910`（移动端 active `muted 10%`）、`:917-935`（输入 hover 62% / focus primary 42% + shadow / disabled 0.58）、`:975-1075`（下拉 border/radius/hover==focused 55%/selected 550/disabled 0.55）；8 处 `focus-within`（2289,2291,3262,3293,3518,5165,5186,5210）**无一**属于 `.quickforge-settings-row*` | `src/index.css:962-979`、`:1012-1014`、`:2151-2173`、`:1170-1193`、`:1238-1330`（键值一致）；`focus-within` 行为 `(2552,2554,3607,3685,3730,3956,5603,5624,5648)` 经抽样同样不含设置行 | 一致（两版均无「行内聚焦高亮」） | 无；若要做键盘可见的行级焦点反馈，属新增设计，需先过 `DESIGN_LANGUAGE.md` |

**域 C 判定统计**：一致 20、回归-已修 0、有意保留 7、不可考证 0（共 27 条）。

### 2.4 域 D · 全局样式与动效（token / 时长 / keyframes / reduced-motion / 滚动条 / hover 强度 / z-index / 语义色）

本节旧侧证据分两类：`index-B1G0LqYR.css`（旧产物，376,928 字节 / 4 行，样式载荷在第 3 行）与 `git show 3e10f58:src/index.css`（旧源，32 keyframes / 17 reduced-motion 块 / 首行 `@import "@earendil-works/pi-web-ui/app.css"`）。凡「产物独有且确认由构建期生成」的规则（`.duration-(--quickforge-dur-*)`、`.ease-(--quickforge-ease-out)`、`motion-reduce:transition-none`、`spin/pulse/ping`）已单列剔除，不计差异。

| 交互项 | 旧证据 | 新证据(修复前) | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| 主题色 token（`:root` 亮色 18 组：background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/chart-1…5/sidebar 6 项） | `index-B1G0LqYR.css` @38298 起：如 `--primary:oklch(20.5% 0 0)`、`--accent-foreground:oklch(40% .18 240)`、`--chart-2:oklch(53.553% .02798 259.829)` | `src/index.css:115-146`：`0.205 0 0` / `0.4 0.18 240` / `53.553% 0.02798 259.829` 等（逐组同值，仅前导 0 写法差异） | 一致 | 无 |
| 主题色 token（`.dark` 暗色） | `@40216` 起：`--background:oklch(14.5% 0 0)`、`--primary:oklch(92.2% 0 0)`、`--sidebar-primary:oklch(48.8% .243 264.376)` 等 | `src/index.css:175-206` 逐节同值 | 一致 | 无 |
| `.dark` 内 12 条重复声明（`--font-sans/serif/mono` + `--radius:.625rem` + 8 个 `--shadow-*`） | `@40216` 的 `.dark{}` 内重复声明且与 `:root` 同名同值 | `src/index.css:174-207` 的 `.dark{}` 只含颜色，无重复声明 | 一致（计算值不变，仅结构差异） | 无 |
| `--radius`（unlayered 生效值 .625rem + `@theme` .5rem） | `@39500` 附近 `:root{…--radius:.625rem…}`；`@46170` `@theme{--radius:.5rem;--shadow-quickforge:…}` | `src/index.css:160`（含注释 `:157-159` 说明为何压过 `@theme`）、`:229` `@theme { --radius: 0.5rem }` | 一致 | 无 |
| `--spacing` / `--tracking-normal` | `@35649` Tailwind `--spacing:.25rem` + `@39640` `:root{--spacing:.25rem}`；`@39640` `--tracking-normal:0em` | `src/index.css:170`、`:169` | 一致 | 无（影响全量 `calc(var(--spacing,0.25rem)*n)` 间距） |
| `--text-sm` **（特查项）** | ① Tailwind 默认 `@35649` `--text-sm:.875rem`；② 应用覆盖 `@139168` `--text-sm:1rem;--text-sm--line-height:calc(20 / 14)`（unlayered、源码序在后 → 生效） | `src/index.css:305` `--text-sm: 1rem;`、`:306` `--text-sm--line-height: calc(20 / 14);`（同为 unlayered `:root`，位于 `:302-333`，文本序在后） | 一致（两代同为 1rem 覆盖，机制一致） | 无（正文字号基线随 `html{font-size}` 缩放） |
| `--text-base` / `--text-xs/lg/xl/2xl…` | `@35649` Tailwind 默认（`.75/1/1.125/1.25/1.5rem…`） | 新文件未声明 → 仍由 Tailwind 默认提供（`:2887`/`:2888` 以 `var(--text-base, 1rem)` 兜底引用） | 一致 | 无 |
| 字体串 `--font-sans` / `--font-mono` / `--font-serif` | `@139168` 覆盖串含 `"PingFang SC","Microsoft YaHei","Noto Sans CJK SC"`；`:root@38298` / `.dark@40216` 基础串无 CJK；`--font-serif:ui-serif, Georgia, …` | `src/index.css:312-315` / `:316-318`（同串同序）、`:153`（serif） | 一致 | 无（中英混排度量一致） |
| 阴影 token（`--shadow-2xs/xs/sm/ /md/lg/xl/2xl`、`--shadow-quickforge`） | `@39640`：`0 1px 3px 0px #0000000d`（α≈5.1%）… `#0000001a`（α≈10.2%）… `@40216` `#00000040`（α≈25.1%）；`@46170` `--shadow-quickforge:0 10px 26px -18px #0f172a7a`（α≈47.8%） | `src/index.css:161-168`（`hsl(0 0% 0% / 0.05)` / `…0.1` / `…0.25`）、`:231` `rgb(15 23 42 / 0.48)` | 一致（形式不同：hex ↔ hsl/rgb；Δα≤0.2%，属压缩取整） | 无；`--shadow-quickforge` 两代同处 `@theme`，5 处引用一一对应（旧 @156843/159796/174523/189222/326031 ↔ 新 L1191/1284/1808/2324/6415） |
| `--syntax-*`（亮 13 / 暗 13）与 `--qf-hl-*` 对位（heading、list 缺失） | `@2122`（亮）与 `@2689`（暗）：keyword/entity/constant/string/variable/comment/tag/**heading**/**list**/addition-bg/fg/deletion-bg/fg | 修复前 `src/index.css:8035-8063` 只有 11 组 `--qf-hl-*`（comment/string/keyword/number/function/builtin/property/tag/attr/addition-*/deletion-*）——缺 heading、list；`number/property/attr` 取旧 `constant/heading` 值 | 回归-已修 | 已修（W3：+4 变量 `--qf-hl-heading/-list/-code/-quote`，取值逐字复制旧 `--syntax-*`，仅补前导零） |
| `--color-*` 调色板（45 个：`--color-red-50 … --color-white`） | `@42117` / `@35649`（pi 裁剪子集） | 新文件 **0 处声明**；TSX 仍用 `text-amber-*`(25)/`text-emerald-*`(60)/`text-red-*`(37)/`text-green-*`(2)/`text-blue-*`(7) → 由 Tailwind v4 内置调色板提供 | 一致（声明层不同、取值未全量比对，中置信度） | 无需处理；构建后如需可抽样比对 |
| `--color-text-primary`（旧引用 3 次、**全产物无定义**） | `@4014` `.hljs-subst`、`@4157` `.hljs-emphasis`、`@4220` `.hljs-strong` 引用 `var(--color-text-primary)`；0 处声明 → 计算值无效 → 继承正文字色 | 新文件无任何 `var(--color-*)` 引用，`.hljs-*` 规则整体不存在 | 一致（旧缺陷已消除） | 无 |
| 时长与缓动 token 定义 | `@139606` `.12s`、`@139633` `.18s`、`@139660` `.28s`、`@139687` `.14s`、`@139714` `cubic-bezier(.2, 0, 0, 1)` | `src/index.css:328-331`（`120ms`/`180ms`/`280ms`/`140ms`）、`:332`（`cubic-bezier(0.2, 0, 0, 1)`） | 一致（slow/exit 两代均「定义但 CSS 侧不用」→ 无影响） | 无 |
| 时长 token 使用次数与 owner | `--quickforge-dur-*` 共 27 次出现 = 定义 4 + Tailwind 工具类 9（`.duration-(--quickforge-dur-base/exit/fast)` @122120-122457）+ 真实使用 14；`--quickforge-ease-out` = 定义 1 + 工具类 3（@122724-122816）+ 真实使用 13 | 新 `--quickforge-dur-*` 共 19 = 定义 4（L328-331）+ 注释 1 + 真实使用 14；ease-out = 定义 1（:332）+ 注释 1 + 真实使用 13；14 个使用点 owner 一一对应（dialog-backdrop-in/panel-in、sidebar-label-in、menu-in、list-item-in、artifact-card-chevron/review/details、file-rollback-dialog ×2） | 一致（扣除构建期生成的 9/3 次后两侧同为 14/13） | 无 |
| 裸时长（非 token）规模 | 旧源（3e10f58）**147** 行含裸时长 | 新源 `src/index.css` **153** 行（剔注释/定义后 **146** 行）；分布 `160ms×33、140ms×16、280ms×14、150ms×14、180ms×11、0s×9…`；分类：长循环 15 行（DESIGN_LANGUAGE 明确豁免）、单次进入动画 19 行、transition 71 行、续行/延时 41 行 | 一致（数量级与取值沿用） | 无；时长刻度「未退化但未收敛」记为设计债 |
| 本次重构净新增的裸时长行（6 行：`shimmer 2s`、`transition: all 0.2s`、`visibility 0s linear 140ms`、`opacity 140ms ease`、`transition: color 160ms ease`、`transition-delay: 0s`）未使用 token | 旧侧无对位（旧源 2870/3003 已有同值 `transition: color 160ms ease`；`.user-message-container` 旧 @134237 同 `.2s`）；DESIGN_LANGUAGE 要求「新动效必须引用 token」 | 新源 `L92`/`L108`/`L3306`/`L3307`/`L3270`(或 L3404)/`L3319`；另有 `L2917-2926` `.qf-markdown-block a:hover` 无 transition | 有意保留（P2：与设计语言「统一刻度」有张力，非视觉回归） | 保留并登记 |
| keyframes 总数 | 旧产物 **37**（`@134096`…`@376518`）、旧源 **32** | 新源 **33**（`L81` shimmer … `L8002` file-rollback-enter） | 一致（新 = 旧源 + `shimmer`；`shimmer` 旧产物中来自 pi app.css） | 无 |
| `@keyframes spin/pulse/ping` | `@138726` / `@138771` / `@376518` | 新源无同名定义（Tailwind 主题内置，按 `animate-*` 用量按需生成）；TSX 侧 `animate-spin` 40+ 处、`MobileServerConnectPage.tsx:160-161` `animate-ping`、`ChatSurface.tsx:494` `animate-pulse` | 一致（构建期生成，待构建复核，中置信度） | 构建后抽查 |
| `@keyframes quickforge-goal-spin` 定义缺失 | `@353129` `@keyframes quickforge-goal-spin{to{transform:rotate(360deg)}}`，使用点 `@347822`；定义曾存在于 `73dd3f8:src/index.css:6985`、`ace9930`，`3e10f58` 起已消失（`git grep` 在 BASE 全树 0 命中） | 新源无定义，但 `src/index.css:7339` 仍在用 `animation: quickforge-goal-spin 1.6s linear infinite` | 一致（**既有缺陷**：BASE 已缺，非本次重构引入） | 保持；建议单独立项修复（Goal 侧栏运行中图标自转失效） |
| `prefers-reduced-motion` 覆盖块 | 旧产物 **19** 个 `@media (prefers-reduced-motion:reduce)`（1 个 Tailwind `motion-reduce:transition-none` @129578 + 18 个业务块：startup@143249 / conversation@147632 / dialog-menu-list@148860 / input-clamp@192407 / tool-sweep@223130 / command-skeleton@241062 / file-reference@250880 / context-usage-tip@271713 / composer-stop@284719 / msg-queue@324927 / error-line@332473 / reconnect@335830 / artifact-card@346388 / goal-strip@349750 / goal-status-icon@360274 / todo-summary@369451 / pinned-summary@371738 / file-rollback@376003）；旧源 17 块 | 新源 **18** 块（`L96/611/798/878/2442/3515/4178/4479/5070/5406/6356/6699/6822/7284/7412/7836/7931/8013`）+ 1 行规范注释（`L95`） | 一致（新 = 旧源 17 + 新增 `.animate-shimmer` 块；旧产物第 19 个是构建期 Tailwind utilities → 构建后回归 19；旧产物对 `.animate-shimmer`（@134178）**无**降级 → 新文件是**补齐**） | 无 |
| 缺 reduced-motion 降级的 5 个 keyframes | 旧源同样缺失：`quickforge-migration-dot-pulse`、`quickforge-waiting-enter`、`quickforge-waiting-dot`、`quickforge-ask-breathe`、`quickforge-ask-enter` | 新源同样缺失（消费者 `L489-491`、`L3193`、`L3207`、`L6093`、`L6101`） | 一致（继承问题，非回归） | 登记：与 DESIGN_LANGUAGE「所有 keyframes 必须有 reduced-motion 降级」（L160）不符，P2 |
| 滚动条规则 | 全局 `@133745` `::-webkit-scrollbar{width:8px;height:8px}`、`@133724` `*{scrollbar-width:thin;scrollbar-color:var(--color-border) #0000}`、轨道 `@133797`、滑块 `@133838`（`border-radius:4px`）、滑块 hover `@133879`（透明）；`.quickforge-*` 局部 2 条（`@371935`/`@371997` 不占位）；任意变体 2 条（`@123395`、`@133614`，构建期） | `src/index.css:50-71`（同值；仅 `var(--color-border)` → `var(--border)` 写法差）、`:7951-7959`（局部 2 条声明逐值相同）、`:7946-7947` 注释记录任意变体依赖 | 一致 | 无（任意变体需构建后复核是否有 TSX 使用点，中置信度） |
| hover / active 强度（5 组代表 + 全规模归一化） | ① 列表行 `@166389`（`muted` → `color-mix(… 18%, transparent)`）② 图标按钮 `@179305`（`muted 42%` + `foreground 86%`）③ 菜单项 `@275933`（`muted 72%!important` + `transform:none!important`）④ Tab：旧产物无 `.-tab:hover` 业务规则 ⑤ 卡片 `@285817`（`var(--muted)`）、产物卡 `@340…`（header/open/review `muted 45%`；rollback `#b91c1c14`/`#fca5a51a`）；全局带视觉声明的 `:hover` 规则 **170** 条（quickforge 选择器 128 条 = 去重 69 个 + `@supports` 副本；pi 专属 41 条） | `src/index.css:1495`、`:1946`、`:5162`、`:5441`、`:6922/7061/7068/7073`（同值）；新源全部 **64** 条（quickforge 63 条，去重 63 个，无 `@supports` 副本——构建期生成）；`:active` 按压由 `button.tsx:6` `active:scale-[0.97]` 承担 | 一致（按选择器归一化后一一对应） | 无（源码级 diff：删除 104 行 / 新增 630 行，删除行含 `:hover` 仅 1 行、新增 7 行均为 pi → `.qf-*`/`.quickforge-*` 等价重写） |
| z-index 声明与逐选择器数值 | 旧产物 **35**（含 9 条 Tailwind 工具类）→ 业务 **26**：splash 100 @140295、conversation-loading 20 @143877、settings-select-menu 9999 @157703、turn-navigation 20 @186342、turn-navigation-tooltip 100 @188643、svg-code-menu-content 50 @199094、svg-code-lightbox 10000 @201502、info-tip-popover 9999 @202939、rollback-popover 45 @203617、local-tool-shell>.tool-actions 1 @221292、scroll-bottom-button 20 @236422、command-suggestion-group-head 1 @239085、file-reference-header 1 @247235、agent-access-menu/.thinking-menu 10000 @259988、subagent-running-menu 10000 @263449、context-usage-tip **10001** @268052、model-menu 10000 @274487、model-sheet-backdrop 10000 @277861、empty-chat-hero 2 @287503、empty-host .composer-dock 5 @288228、empty-project-picker(-open) 3 @290367/290602、project-picker-popover 1000 @296550、msg-queue-drag-ghost 60 @325652、assistant-open-menu 30 @342735 | 新源 **25** 条业务规则：`L424/646/1240/2236/2316/2607/2678/2738/2754/3433/4037/4126/4393/4767-4770/4872/4982/5124/5214/5467/5495/5551/5561/5710/6403/7111`（24 项逐值相同 + 合并项相同）；唯一缺失为 `@200479` `.quickforge-svg-code-toolbar-floating{z-index:2;…}`（diff 删除行证据；新源 `svg-code-toolbar` 出现 0 次） | 一致（最高三档 9999/10000/10001 完全一致，无新增档位/冲突） | 无（缺的那条针对 pi 结构，随结构移除；新链路改用 `.quickforge-svg-code-menu-trigger/-menu-content` L2605-2619） |
| `@theme inline` 语义色映射 | 旧由 pi app.css 提供（`@35649` `:root,:host{--color-border:var(--border);…}` + `@layer theme` 内联映射） | `src/index.css:257-290` 共 **32** 条 `--color-*: var(--*)`（background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring/chart-1…5/sidebar 6 项） | 一致（等价自举） | 无（所有 `bg-*/text-*/border-*` 语义 utilities 由此生效） |
| 语义色透明度档位使用与白名单 | DESIGN_LANGUAGE L210 点名禁用 `border-border/75`、`bg-muted/20` | 新 `src/**/*.tsx` 命中 **76** 处：`/5`×2、`/10`×37、`/30`×18、`/50`×6、`/60`×4、`/80`×1、`/90`×10、`/95`×3；`/20`、`/45`、`/70`、`/75` 在 `src/**` 均 **0 命中** | 一致（无越界档位） | 无 |
| 需目视复核的高频档位（未被设计语言点名） | — | `hover:bg-destructive/10`（App.tsx:1678 等 15 处）、`bg-muted/30`（18 处，如 `AttachmentPreview.tsx:441/459`、`ToolMessage.tsx:94/102`）、`bg-primary/10`、`text-muted-foreground/50`（ChatSidebar.tsx:253/463/506）、`bg-muted/60`、`bg-background/90`、`bg-background/95` | 一致（数值层无越界，视觉需按 DESIGN_LANGUAGE §212-219 判断顺序目视确认） | 登记为 P2 目视项（非阻断） |
| 语义色 CSS 变量直引 | 旧产物引用 `var(--color-text-primary)` 3 次（无定义）、`var(--color-border)` 2 次（有定义） | 新源 `var(--color-*)` 引用 **0** 次（统一走 `var(--border)` / `var(--muted)` …） | 一致（旧缺陷已消除） | 无 |
| 旧有新无选择器：`agent-interface` | 旧产物 2 次（`@186037`：`pi-chat-panel agent-interface>.flex…>.max-w-3xl` 宽度收敛） | 新源 0；宽度改由 `.qf-chat-panel` + `.qf-message-list` 结构承担（`L2361-2365` 注释说明） | 一致（React 无该元素） | 无 |
| 旧有新无选择器：`attachment-tile` | 旧产物 2 次（`@284909`：`.quickforge-composer attachment-tile+attachment-tile{margin-left:.125rem}`） | `.quickforge-composer .qf-attachment-tile + .qf-attachment-tile`（`L5417-5419`，同 0.125rem） | 一致 | 无 |
| 旧有新无选择器：`code-block`（pi 结构覆写） | 旧产物 4 次（`@200268` 等，含 `z-index:2` 工具栏） | 新链路：`.qf-hl-*` 高亮类 + `.quickforge-svg-code-*` 菜单；旧结构覆写规则整体删除（diff 删除行证据） | 一致（按设计移除；SVG 侧等价规则已由 W3 补回，见 §3） | 无 |
| 旧有新无选择器：`markdown-block` / `chat-panel` / `message-list` / `assistant-message` / `thinking-block` / `tool-message` / `streaming-message-container` | 旧产物命中数：`markdown-block` 13（`@140039` 起）、`chat-panel` 41（`@186026`）、`message-list` 1（`@189785`）、`assistant-message` 8、`thinking-block` 22、`tool-message` 8、`streaming-message-container` 2（`@215324`：`…:not(.hidden)>div>span.animate-pulse{display:none}`） | 新源：`.qf-markdown-block` 49 处（`L2880` 起 + `L2910/2917` 链接）、`.qf-chat-panel` 8 处、`.qf-message-list`（TSX 侧 10+ 处 querySelector + 注释 `L2363`）、`.quickforge-assistant-message` + `.qf-assistant-message`（6）、`.qf-thinking-block` 16、`.qf-tool-message` 8~10、`.qf-streaming-message` 2（`L3218/3222`，同 `animate-pulse` 隐藏语义） | 一致（等价承接） | 无 |
| 旧有新无选择器：`user-message` / `.user-message-container`（橙色渐变与描边） | 旧产物 52 次（`@134237` 起，含 `linear-gradient(135deg,#d94f001f,#ff6b001f,#d4a5001f)`、`border:1px solid #ff6b0040`） | `.qf-user-message`（14）；`.user-message-container` 仅保留 `position/backdrop-filter/transition: all 0.2s`（`L106-111`），**渐变与橙色描边被有意删除**（`L102-105` 注释） | 有意保留（有意视觉简化） | 保留；发布说明记录「用户气泡旧为橙色渐变」 |
| 旧有新无选择器：`.hljs-*` 与 `.quickforge-svg-code-toolbar*` | `.hljs-*` 25+ 条（`@3300-4373` 区段）；`.quickforge-svg-code-toolbar*` 见 `@200268` 区段 | `.qf-hl-*` 11 条（`L8066-8076`）+ `src/lib/code-highlight.ts`；新源 `svg-code-toolbar` **0** 次 | 回归-已修（`.hljs-*` 语义与 SVG 代码块规则）；有意保留（`…-toolbar-floating` 不复活，宿主类已随 pi 删除） | 见 §3（W3） |
| 旧有新无选择器：`quickforge-goal-*` 相关（`.quickforge-goal-button--primary/ghost/danger:hover`、`.quickforge-goal-expand:hover`、`@keyframes quickforge-goal-spin`） | 旧产物 `@~35 万区`、`@353129`、使用点 `@347822`；`git grep` 在 `3e10f58` 全树 **0 命中**（定义曾存在于 `73dd3f8`/`ace9930`） | 新源同样无（`.quickforge-goal-summary-entry:hover` 现位于 `src/components/git/goal-summary.css:12`，同值 `muted 45%`） | 一致（相对 BASE 一致；差异归因于产物早于 BASE 约 5 天） | 不计入本轮回归；`quickforge-goal-spin` 缺定义另见上表 |

**域 D 判定统计**：一致 31、回归-已修 2、有意保留 2、不可考证 0（共 35 条）。

### 2.5 域 E · 装饰层运行时接线（panel-decoration / ChatPanelHost / 过程折叠 / 编辑器绑定）

旧侧 = `git show 3e10f58:<path>`（panel-decoration 37 个文件）+ 旧产物 `ChatPanelHost-kh5gPhZf.js`（应用壳）与 `pi-web-ui-B-_rXig1.js`（宿主元素，minified 未逐节点反查）。新侧 = 工作区行号。

| 交互项 | 旧证据 | 新证据(修复前) | 判定 | 处置 |
| --- | --- | --- | --- | --- |
| `panel-decoration/` 文件级差异与字节级相同文件 | 旧 `3e10f58` 共 37 个文件（含 `code-blocks.ts`） | 36 个（`code-blocks.ts` 删除，无新文件）；**字节级完全相同**的 15 个：`agent-access-menu.ts`、`composer-plus-menu.ts`、`floating-position.ts`、`goal-card.ts`、`goal-internal-message.ts`、`goal-iteration-divider.ts`、`html.ts`、`icons.ts`、`message-action-visibility.ts`、`model-controls.ts`、`plan-mode-controls.ts`、`rollback-confirm-popover.ts`、`subagent-running-indicator.ts`、`thinking-level-controls.ts`、`turn-error-state.ts` | 一致（`code-blocks.ts` 职责迁到 `surface/CodeBlock.tsx`） | 无 |
| 入口 `panel-decoration.ts` 的锚点改动 | 旧 `:202`（`panel.querySelector('message-editor')`）、`:204-205`（composer shell/dock = `editor.parentElement` 两级）、`:237-243`（`agent-interface` 上的 flip `enableModelSelector/enableThinkingSelector` + `requestUpdate`） | 新 `:200`（`.qf-message-editor`）、`:202-203`（同两级父链）、`:236` 起替换为注释（`agent-interface` 段删除） | 一致（仅 2 处实质改动 + 1 段有意移除） | 无 |
| 面板根节点来源与「失效即静默」风险 | 旧 `ChatPanelHost.tsx:635` `const panel = new ChatPanel()`（pi 自定义元素实例） | 新 `ChatPanelHost.tsx:630-631` `host.querySelector('.qf-chat-panel')`，查不到即 `return`（整个子系统静默不接线） | 一致（构造 → 查询的等价替换） | 登记：建议加「渲染后该节点存在」的冒烟断言，避免类名重命名导致整层静默失效 |
| 宿主占位（草稿恢复）/ 宿主状态类 | 旧 `ChatPanelHost.tsx:1883` `hostRef.current.querySelector('pi-chat-panel')`；`:1841` `host.classList.toggle('quickforge-chat-panel-empty-host', newChatEmptyState)` | 新 `ChatPanelHost.tsx:1806` `.qf-chat-panel`；`:1768` 同一写法 | 一致 | 无 |
| 编辑器根 / 控制行 / 动作按钮三处相对锚点 | 旧 `panel-decoration.ts:202`、`:247-249`（`editor.querySelectorAll('.flex.gap-2.items-center')` → `[0]`=left、`[last]`=right）、`send-stop-button.ts:12`（`rightControls.querySelector('button:last-child')`）；三者在新旧**逐字相同**（`git diff` 中为未变更上下文） | 新 DOM 满足：`MessageEditor.tsx:377`（left）与 `:414`（right）均为 `flex items-center gap-2`；`:414-472` 右行最后子节点是条件渲染的 stop/send Button；装饰层仅 toggle `quickforge-stop-button--waiting`（`send-stop-button.ts:32/48`，CSS `index.css:5333-5407/5827-5833/5913-5918` 仍命中） | 一致（旧同为相对锚点，属 parity） | 登记（健壮性建议）：加「右行末元素带 `.quickforge-{send,stop}-button`」断言或 `data-qf-composer-action` 锚 |
| 滚动容器锚点 | 旧 `ChatPanelHost.tsx:665`、`:725` `panel.querySelector('agent-interface .overflow-y-auto')` | 新 `ChatPanelHost.tsx:701` `panel.querySelector('.qf-chat-panel .qf-scroll-container')`（`ChatSurface.tsx:851` 渲染该类；`scroll-to-bottom-button.ts:37`、`scroll-sync.ts:29`、`turn-navigation.ts:211/221` 使用同类钩子） | 一致（`agent-interface` 不复存在后的必要替换） | 保证面板内 `.qf-scroll-container` 唯一（多滚动容器会取错同步目标） |
| 消息列表 / 消息行 / 流式容器选择器口径 | 旧 `message-actions.ts:188`、`context-compaction.ts:51,74`、`ChatPanelHost.tsx:664` 均为 `'message-list'`；`message-actions.ts:192` `'user-message, assistant-message'`、`ChatPanelHost.tsx:671` 同；`message-actions.ts:203-206` `':scope > streaming-message-container:not(.hidden)'` + `':scope > div > assistant-message'` | 新：`message-actions.ts:186` `.qf-message-list`、`:190` **双写** `'user-message, assistant-message, .qf-user-message, .qf-assistant-message'`；`context-compaction.ts:51,74` 仅 `.qf-*`；`process-folding.ts:1037` 双写 `MESSAGE_LIST_SCOPE_SELECTOR`；`message-actions.ts:266-269` `':scope > .qf-streaming-message:not(.hidden)'` + `':scope > .qf-assistant-message'` | 一致（行为等价：双写覆盖 legacy 标记） | 登记为维护性风险：口径不统一（双写/单写混用），建议统一抽常量 |
| `agent-interface` 锚点与原生 thinking selector 隐藏义务 | 旧 `panel-decoration.ts:237-243`；`ChatPanelHost.tsx:606`、`:1007`、`:1225`、`:1420`、`:1525`、`:1871`；旧 `src/lib/patch-thinking-selector.ts:25/73` 写 `data-quickforge-thinking-selector` | 全部删除；等价物为 React props（`ChatPanelHost.tsx:1190-1193` 注释说明由 React 保证「原生 thinking selector 隐藏」） | 有意保留（有意移除，义务转移到 React） | 保留；建议以测试兜底该义务 |
| 装饰层 `classList` 字面量（旧独有 5 类）与 dataset | 旧独有类：`quickforge-mermaid-code-block`（`code-blocks.ts:539`）、`quickforge-svg-code-block`（`:320/539`）、`quickforge-svg-code-toolbar-floating`（`:183/381`）、`quickforge-send-button`（`send-stop-button.ts:46`）、`quickforge-stop-button`（`:25`）；旧写 dataset：`quickforgeSendIcon`（`:29/47-48`）、`quickforgeCommand`（`code-blocks.ts:594`）、`quickforgeMermaid*`/`quickforgeSvg*`（共 13 个）、`data-quickforge-mermaid-error/-original-copy/-preview/-toolbar`、`data-quickforge-svg-original-copy/-preview/-toolbar`、`data-quickforge-thinking-selector` | 装饰层字面量/dataset 差集 **0 项**（不再由装饰层写）；`data-quickforge-*` **CSS 依赖集合新旧完全一致**（8 个：`agent-streaming`/`artifact-expanded`/`clamped`/`fits`/`plugin-name`/`process-final-summary`/`process-folded`/`subagent-process`）；仅旧单测 `tests/frontend/send-stop-button.test.ts:75/133` 依赖已消失的 dataset | 一致（实现细节随迁移/删除消失，无 CSS 依赖） | 确认旧单测断言已同步（本轮 14 个改动文件中不含该文件 → 其断言不依赖已消失项，测试全绿） |
| 属性命名空间分裂（`data-quickforge-action` → `data-qf-action`） | 旧 `code-blocks.ts:567/597`、`:648`（清理 `execute-markdown-command`） | 新 `CodeBlock.tsx:221/249/475`；装饰层不再清理该动作按钮 | 一致（新旧 CSS 均无 `execute-markdown-command` 选择器） | 登记：统一命名空间或双写可降低排查/测试成本（中优先级） |
| CSS 命中：代码块结构类 | 旧 `3e10f58:src/index.css:2375/2382/2391/2395`（`.quickforge-svg-code-block > div:first-child` 去框、floating toolbar、隐藏语言标签） | React 仍输出 `CodeBlock.tsx:433` 的 `quickforge-svg-code-block`，但新 CSS 曾 **0 条规则** | 回归-已修 | 已修（W3 补回去框 + 标题栏内边距两条等价规则；依赖已删 DOM 的两条 floating 规则不复活） |
| CSS 命中：svg/mermaid 其它 hook | — | 新 CSS 覆盖 `quickforge-svg-code-menu/-trigger/-content/-item`、`-preview`、`-mermaid-code-preview`、`-mermaid-code-error`、`-svg-code-lightbox`（均命中） | 一致 | 无 |
| 跨版本 hook 交叉校验 | 旧「CSS ∩ 代码」独有：`quickforge-react-settings-tab`、`quickforge-svg-code-toolbar`、`quickforge-svg-code-toolbar-floating` | 新侧独有 `.qf-*` 家族 27 个 | 不可考证（`quickforge-react-settings-tab` 属设置页域，本轮未独立取证其替代物） | 登记（低优先）；其余两处为代码+CSS 同步移除，属预期 |
| composer 卡片/控制行 CSS 合同 | 旧 `3e10f58:src/index.css:4099/5361/5443/5447`（`.quickforge-composer > div:first-child …`） | 新 `src/index.css:4565/5827/5909/5913`（同选择器）；契约由 `MessageEditor.tsx:330`（卡片为首个子 div）、`:376`（`px-2 pb-2` 控制行）、`:414`（右行）承载 | 一致 | 维持结构顺序（有注释 `MessageEditor.tsx:315-324` 声明） |
| 过程折叠：顶层组 / 阶段层 / 工具组默认值 | 旧 `process-folding.ts:638/645` → `syncProcessGroupExpandedState(..., defaultExpanded = false)`（`:128-132`）把 `isAgentStreaming` 直接当默认值；`processStageDefaultExpanded(){return false}`（`:519-521`）；`const detailed = getCachedToolDisplaySettings().toolDisplayMode === 'detailed'`（`:599`） | 新 `process-folding.ts:556-559` `processGroupDefaultExpanded(isAgentStreaming) { return isAgentStreaming }`（`:687/694` 传入）、`:561-564`（阶段层 `false`）、`:621-623` `processToolGroupDefaultExpanded(mode) { return mode === 'detailed' }`（`:647/658`） | 一致（语义等价） | 无 |
| 过程折叠：saved state 语义 / state 键 / fail-visible | 旧 `PROCESS_EXPANDED_STATE_LIMIT = 500`（`:55`）、`resolveProcessExpandedState`（`:117-126`）、`syncProcessGroupExpandedState`（`:128-149`）、`processStageStateKey`（`:523-525`）、`processToolGroupStateKey`（`:572`）、`assistantProcessSourceHasVisibleError`（`:1024-1031`）、`updateEmptyProcessSources` 扫描 `'markdown-block, thinking-block, tool-message, .quickforge-process-group, .quickforge-approval-card'` + `closest('message-list')`（`:1036-1037`） | 新 `:75` / `:137-146` / `:148-169`（逐行一致）、`:566-568`、`:615`、`:1207-1214`（逐字相同）、`:1219-1220`（扫描加入 `.qf-markdown-block, .qf-thinking-block, .qf-tool-message` 双写 + `closest(MESSAGE_LIST_SCOPE_SELECTOR)`） | 一致（选择器为扩展覆盖） | 无 |
| 过程折叠：折叠短路条件 | 旧 `decorateProcessTurn(..., canShortCircuit = isAgentStreaming && !isActiveTurn)`（`:1157`） | 新 `decorateProcessTurn(..., canShortCircuit = !isActiveTurn)`（`:1350-1355`，注释两行在 `:1351-1352`、调用点在 **:1354**） | 有意保留（真值表仅「空闲帧 full→skip」一格差异；`processTurnUpdateMode` 判定结果在展开/收起上等价，且流式终态翻转由释放门强制全量重建） | 保留；`tests/frontend/process-folding.test.ts:84-97` 明确锁定新语义（回退需改两处断言）；`processTurnUpdateMode`（`:1252-1263`）与 `decorateProcessTurn` 签名（`:1269`）与旧**逐字相同** |
| 过程折叠：指纹与增量收尾 / React 节点代偿 | 旧仅「指纹相等即 `update`」（`:1102/1105-1109`），**无**增量路径与节点代偿 | 新新增 `appendProcessToolSuffix`（`:1170-1213` 区域）与调用点 `:1305-1312`（只搬新行，避免重启已有行 CSS keyframes）；新增 `shouldRestoreGroupedProcessNode`（`:1040-1042`）、`releaseProcessGroups(..., streamingOnly)`（`:1012-1058`） | 有意保留（新增行为/安全网，非回归） | 保留（已有 `process-folding-incremental`/`-ownership` 测试覆盖） |
| 编辑器绑定：命令补全键盘 handler 与卸载选择器 | 旧 `command-suggestions.ts:432-479`（capture 阶段挂载；`isComposing`/`Process` 忽略 `:436`、`Enter+Shift` 停止冒泡 `:437`、`Escape` 关菜单 `:443`、`Arrow*` `:449-453`、`Backspace` `:458`、`Tab` 补全）；卸载用 `'message-editor textarea'`（`:484-486`）；旧产物 `ChatPanelHost-kh5gPhZf.js` 偏移 63616/63686/63727/64547/64671/64741 与选择器串 64642 | 新 `command-suggestions.ts:435-479` 同一函数体（逻辑零变化）；卸载改 `'.qf-message-editor textarea'`（`:484-487`） | 一致（锚点替换，同口径） | 无 |
| 编辑器绑定：发送侧键盘语义 / 挂载属性与清理 / 附件 tile 装饰收敛 | 旧发送侧由 pi 编辑器实现（宿主内部未反查）；旧挂载与清理 `editor-bindings.ts:38-40`、`:44-59`、`:64-104`、`:115-129`；旧 tile 装饰为一次性 `setTimeout(…,0)`（`:81-99`，选择器 `'attachment-tile:last-of-type'`） | React `MessageEditor.tsx:68-86`（`:75` IME、`:79` Enter 一律 preventDefault、`:84` 流式中 Esc→abort；挂载 `:362`、props 透传 `:216`）；新 `editor-bindings.ts:103-105`、`:109-156`、`:167-181`（同名属性、同清理）；tile 装饰改 `decorateComposerTextAttachmentTile`（`:21-72`：同步 + rAF `:59` + 重试 `[0,50,150,300,600]` `:8/60-61`、选择器 `.qf-attachment-tile:last-of-type` `:40`、`cancel()` 清理） | 一致（含鲁棒性增强；React 异步提交下的必要改动） | 登记：`:last-of-type` 与 class 混用，若同容器将来混排其它同标签元素可能取错 |
| 编辑器绑定：文本回填的转义修正 | 旧 `editor-bindings.ts:100`：`` `${currentText ? '\\n\\n' : ''}` `` → 写入**字面 `\n`**（缺陷） | 新 `editor-bindings.ts:151-152`：`` `${currentText ? '\n\n' : ''}` ``（真实换行） | 有意保留（旧缺陷修复） | 保留 |
| 思考等级控件：文件内容 / 插入点 / 按钮类 / 触发条件 | 旧 `thinking-level-controls.ts`（`3e10f58` 版本）：`:203` `modelButton.insertAdjacentElement('afterend', button)`、锚 `:150` `rightControls.querySelector('.quickforge-model-trigger')`、写类 `.quickforge-thinking-inline`（`:196`）、触发 `if (!modelButton \|\| modelState?.currentModel?.reasoning !== true)` → 移除控件（`:152`） | 新文件与旧**字节级相同**（无 diff），行号同上；CSS `index.css:5913` 段仍含 `.quickforge-thinking-inline` | 一致 | 无 |
| 模型触发器判定与「动作按钮恒为最后一个 button」前提 | 旧 `model-controls.ts:7`：`Array.from(rightControls.querySelectorAll('button:not(.quickforge-agent-access-inline):not(.quickforge-yolo-inline):not(.quickforge-plan-inline):not(.quickforge-thinking-inline)'))[0]` + `.find(button => Boolean(model?.id && button.textContent?.includes(model.id)))`，命中后加 `.quickforge-model-trigger`/`aria-haspopup`/`aria-expanded`（`:9-13`）；该文件新旧 `git hash-object` **SHA-1 相同**（`6b457d365eacf9c393830afcd0b620713fe84863`） | 新 DOM：模型按钮 `MessageEditor.tsx:415-429`（文本含 model id，可被命中）；动作按钮子级只有 `<svg>` → `textContent === ''`；`ChatSurface.tsx:807-810` 用 `Object.defineProperty` 给 `.qf-message-editor` 装 `currentModel` getter（守卫非死代码） | 一致（原审计怀疑的「showModelSelector=false 时误标动作按钮」经实测**不可达**：`''.includes(<非空 id>)` 恒 false） | 无（仍建议加行尾按钮断言以锁定前提） |
| 消息动作条按钮集合与图标来源 | 旧 `message-actions.ts:50-58`（`createIconActionButton` + `dataset.quickforgeAction`）、`:123` rollback、`:489` copy、`:638/:695` retry、`:666` fork；容器 `.quickforge-message-actions`（`:599-653`）；查询 `button[data-quickforge-action="rollback\|retry\|fork"]`（`:518/:540`） | 新 `:50-58/:123/:489/:638/:695/:666/:599-653`（行号与结构一致），查询 `:612/:634`；图标来源 `icons.ts` 未变 | 一致 | 无 |
| 动作集合的删项（`execute-markdown-command` 门控与 SVG/Mermaid 装饰调用） | 旧 `enableTerminalCommandActions` 门控 + `message-actions.ts:648` 清理 `[data-quickforge-action="execute-markdown-command"]`；顶部 import 并调用 `closeSvgCodeBlockMenus`/`decorateMarkdown{Svg,Mermaid,Command}CodeBlocks` | 新：全部移除（改由 React `CodeBlock.tsx:475` 渲染 `data-qf-action="execute-markdown-command"`；菜单/预览改 `CodeBlock.tsx:209-221`） | 不可考证（React 侧是否仍按能力开关隐藏「终端执行命令」动作**本轮未取证**） | 登记待核 |
| 回合错误行：所有权模型与选择器 | 旧 `turn-error-row.ts:172-186` 就地改写（取 `.bg-destructive\/10` 作为 row 本体并写子节点）；`:85/:109` `closest('assistant-message')` | 新 `:186-196` 只把原 row `display='none'` 并自建 row（`document.createElement('div')` + `element.append(row)`）、新增 `existingRow?.remove()`（`:171-175`）；`:92/:116` `closest('assistant-message, .qf-assistant-message')` | 一致（所有权重写以避免 React `removeChild` 崩溃） | 登记：React 侧红块类名 `.bg-destructive\/10` 一旦变化会出现「原红块 + 自建行」双行；建议加稳定 hook |
| 上下文压缩 / 目标控制条 / 消息队列锚点 | 旧 `context-compaction.ts:51-53`（`message-list` + `user-message, assistant-message`）、`:74`；`goal-control-strip.ts:267/555` `panel.querySelector('message-editor')`；`message-queue.ts:171-179` `classList.contains('message-editor')`、`:244` `querySelector('message-editor')` | 新 `context-compaction.ts:51-53/74` 改 `.qf-*`（结构/文案/插入点未变）；`goal-control-strip.ts:267/555` `.qf-message-editor`；`message-queue.ts:171-179` 判 `'qf-message-editor'`、`:244` `.qf-message-editor`（该文件 diff 仅 2 个 hunk/2 行改动） | 一致（消息队列项：旧判定对 `<message-editor>` 元素**恒假**，新恒真；经脚本模拟 R0–R3 四种可达状态，稳态 DOM 顺序**逐状态一致**，差别仅为「是否做一次位置不变的重插」） | 无；若未来出现「菜单插到队列 root 之前」的挂载路径，新旧判定会分叉（登记） |
| 子代理过程折叠入口 / 宿主元素 / CSS 选择器 | 旧装饰层入口 `message-actions.ts:345-351` `decorateSubagentProcessBlocks`（扫 `message-list[data-quickforge-subagent-process="true"]`）；宿主由 `src/lib/local-tools.ts:690` 输出 `<message-list data-quickforge-subagent-process>`；CSS `index.css:2096` `message-list[data-quickforge-subagent-process="true"]` | 新 `SubagentRunDetailContent.tsx:127` 直接 `decorateProcessBlocks(list, messages, status==='running')`；宿主 `:153` `<div className="quickforge-subagent-trace" data-quickforge-subagent-process="true">`；CSS `index.css:2362/2372` 改 `[data-quickforge-subagent-process="true"]` | 一致（入口/宿主/CSS 三处同步改变） | 建议断言 subagent trace 的分组与主列表一致（旧 CSS 选择器失效风险最高的迁移点之一） |
| 清理与生命周期：观察器/定时器计数、MutationObserver、rAF 调度、ResizeObserver | 旧计数：rAF 14 / cancelAF 4 / setTimeout 17 / clearTimeout 15 / setInterval 5 / clearInterval 4 / `new MutationObserver` 1 / `new ResizeObserver` 1；旧 `ChatPanelHost.tsx:1569` 创建 observer、`:1573` `observe(panel,{childList:true,subtree:true})`、抑制标志 `:1391-1402`、回调抑制 `:1570`、清理 `:1825 observer?.disconnect()`（dispose `:1708/1783`）；旧调度 `:1395`/`:1412` + `scheduleDecorateRef`（`:1009`、`:1742`）；旧 compact ResizeObserver `:1850-1857`、清理 `:1858` | 新计数：rAF 17 / cancelAF 5（+3 rAF / +1 cancelAF），其余相同；新 `ChatPanelHost.tsx:1499` 创建、`:1503 observe(...)`、`:1353-1364` 抑制标志、`:1500` 回调抑制、`:1749 disconnect()`；调度 `:1357`/`:1374` + `:983`/`:1668`；compact RO `:1777-1784`、清理 `:1785`；新增清理路径 `editor-bindings.ts:21-72` `cancel()` 与 `ChatPanelHost.tsx:650 cancelInitialRenderReady` | 一致（新增 rAF 均已配对 cancel；机制逐点等价） | 建议核对 `ChatPanelHost.tsx:1411` 的 handoff rAF 在 dispose 时必被取消（登记） |
| 清理与生命周期：其它定时器 / 自持 interval / 菜单弹层监听 | 旧 `saveDraftTimer` `:401`、`messageQueuePersistTimer` `:865`、`queuedPromptTimer` `:1721`；`subagent-running-indicator.ts:242` `menu.__quickforgeElapsedTimer = setInterval(…,1000)`、清理 `:71-73`；`subagent-running-indicator.ts:64-69`、`thinking-level-controls.ts:37-42`、`composer-plus-menu.ts:46-48/182-191`（pointerdown/keydown/resize/scroll 全量移除） | 新 `:391`、`:841`、`:1649`（同名 ref + 清理路径）；后者三个文件字节级相同或仅锚点变化，行号同 | 一致 | 无 |

**域 E 判定统计**：一致 21、回归-已修 1、有意保留 4、不可考证 2（共 28 条）。

**§2 五域判定汇总**：一致 16+19+20+31+21 = **107**；回归-已修 0+8+0+2+1 = **11**；有意保留 3+14+7+2+4 = **30**；不可考证 2+3+0+0+2 = **7**；合计 **155** 条。

---

## 3. 本轮修复清单

**修复范围说明**：本轮共落地 **7 项修复**，改动 **7 个源码文件 + 7 个测试文件**（`+939 / −135`）。除下列 7 项外，另有两条分片专项结论为「**无需修复**」，如实记录以免误读：

- **键盘聚焦反馈专项（W5）**：以旧产物 alive/dead 类矩阵为基线逐类核对，判定「旧界面真实可见的 focus 类 **9 个全部保留**、旧 dead 类 11 个删除即等价」，**alive 回归 0 条 → 修复清单为空（0 文件改动）**。关键证据：旧 CSS `.focus-visible\:border-ring:focus-visible{border-color:var(--ring)}` @68401（alive）、`focus-visible\:border-primary` **0 命中**（dead）、`.outline-none`@123206、`.focus\:outline-none`@68331；新 CSS 侧 `ui/input.tsx` 的两处 `+` 属「旧无反馈 → 新有环」的正向补齐。方法学提醒：`findstr /c:".focus-visible\:border-ring"` 在本仓库压缩 CSS 上会**假阴性**（同一字符串去掉 `\:` 可命中），alive 判定必须用旧 CSS 实测而非单一命令行。
- **装饰层 4 个可疑项专项（W6）**：`process-folding.ts` 第五参数（`!isActiveTurn`）、`model-controls.ts:7` 锚点宽度、`message-queue.ts` 的 `'message-editor'`→`'qf-message-editor'`、`05-decoration` §8-3 的 4 处相对锚点——经独立验证**均不构成对旧界面的可见行为/选择器/触发条件偏离**，故**未做任何改动**（详见 §2.5 对应行与 §6 遗留）。

### 修复项 1 · 工具/console 输出的复制入口（含文案、1500ms 反馈与测试护栏）

- **【问题】** 旧界面命令输出块有复制按钮；React 化后 `renderConsoleBlock` 只剩裸 `<pre>`，**复制入口整体消失**（功能缺失，非有意差异）。
- **【旧证据】** 调用点 `3e10f58:src/lib/local-tools.ts:899`：`${this.toolName === 'run_command' ? html`<console-block .content=${output} .variant=${variant}></console-block>` : html`<code-block .code=${output} language="text">`}`；pi `<console-block>` 实现（旧产物 `pi-web-ui-B-_rXig1.js`）：`async copy(){…this.copied=!0,setTimeout(()=>{this.copied=!1},1500)}`（**1500ms**，@3178138）、模板 `title="${L('Copy output')}"`（@3179045）、标题栏 `<span>${L('console')}</span>`、反馈 `${this.copied?s`<span>${L('Copied!')}</span>`:''}`（@3179146）、内容区 `console-scroll overflow-auto max-h-64`；zh 值来自应用覆盖表 `3e10f58:src/lib/i18n.ts:3303/3304/3305`（`控制台` / `复制输出` / `已复制！`），en 来自产物注入表 `console`@429824、`Copy output`@429842、`Copied!`@429870。
- **【修复文件:行号】** `src/lib/tool-renderers/shared.tsx`（`CONSOLE_COPY_FEEDBACK_MS = 1500`、`ConsoleCopyButton`、`renderConsoleBlock`；W1 落地落点 `:724`/`:731-754`/`:756-768`，W12 收口后同族行号为 `:761-799` 区域）；`src/lib/i18n.ts`（新增 3 键，W1 落点 en `:217-219` / zh `:1872-1874`，W7 插入后右移为 `:222-224` / `:1878-1880`）；测试 `tests/frontend/tool-renderer-shared-state.test.ts`（W11 新增 `describe('renderConsoleBlock copy feedback')`，+103/−2）。
- **【改动摘要】** 复刻旧 `<console-block>`：标题栏左标签 `t('consoleBlockLabel')`、右侧复制按钮 `data-qf-action="copy-console-output"`，title/aria-label **恒为** `t('copyOutput')`（不随 copied 切换），复制成功换对勾 + 追加可见 `t('copiedBang')`，1500ms 复位；内容仍走既有 `<pre class="max-h-96 overflow-auto …">`（不动视觉配方、不改 `src/index.css`）。
- **【定向测试与反向举证结果】** W1 定向 8 文件 `85 passed`；`npx eslint src/lib/i18n.ts src/lib/tool-renderers/shared.tsx` → exit 0；`npx tsc -b` → 无诊断。W11 定向 3 文件 `22 passed`（`tool-renderer-shared-state.test.ts` 由 7 → 10 tests），反证三组均失败：M1 把 `CONSOLE_COPY_FEEDBACK_MS` 改回 2000 → `1 failed | 9 passed`（`tool-renderer-shared-state.test.ts:177`）；M2 文案回退 `copy`/`copied` → `3 failed | 7 passed`（`:143`/`:170`/`:192`）；M3 改 `data-qf-action` 名 → `3 failed | 7 passed`。三处临时改动均已还原并复查行号/取值。

### 修复项 2 · 行中 `$…$` 数学公式

- **【问题】** 段落中间的 `$x$` 旧界面渲染为 display 公式（段落被切开），新实现按「行首锚定」当**字面文本**输出，且代码注释把该自造规则误写成「与旧 marked block 扩展一致」。
- **【旧证据】** 旧产物 `pi-web-ui-B-_rXig1.js` @2174036–2175460：`{name:'blockMathDollar',level:'block',start(e){return e.indexOf('$')},tokenizer(e){let t=/^\$\$([^$]+?)\$\$/s.exec(e);if(t)return{type:'blockMathDollar',raw:t[0],text:t[1].trim()}}}`；`start` 被 marked 注册为 `startBlock` → **任意位置**可起块。用产物内逐字复制的扩展 + 本机 `marked@16.4.2`/`katex@0.16.47` 实测：`"a $E=mc^2$ b"` → `<p>a </p>\n<div class="my-4"><span class="katex-display">…</span></div><p> b</p>`。
- **【修复文件:行号】** `src/lib/chat-math.ts`（`findBlockHit` 168-184 → 恢复 `/^\$\$([^$]+?)\$\$/g` + `.trim()`；新增 `isDisplayMathElement` / `splitParagraphDisplayMath` / `splitDisplayMathParagraphs` 段落成形；模块头 14-18 行与两处文档注释纠正）；`tests/frontend/chat-math.test.ts`（删除错误的行首锚定护栏，替换/新增 3 条断言）。
- **【改动摘要】** 改动仅 2 个文件、`+99 / −50`：① 去掉行锚定、恢复旧内容约束（`[^$]`）与 `.trim()`；② 行中 display 公式不再嵌进 `<p>`（避免非法嵌套与 React DOM-nesting 警告），复刻旧块级形态 `<p>a </p><qf-math display><p> b</p>`，纯空白文本组丢弃；③ `Markdown.tsx` **无需改动**（沿用 `'qf-math': KatexMath` 映射）。修复后实测标记：`<div class="qf-markdown-block …"><p>a </p><div class="my-4"><span class="katex-display">…</span></span></div><p> b</p></div>`。
- **【定向测试与反向举证结果】** `npx vitest run tests/frontend/chat-math.test.ts tests/frontend/chat-markdown-parity.test.ts` → `2 passed / 14 passed`；`npx vitest run tests/frontend` → `196 passed / 2508 passed`；`npx eslint …` exit 0；`npx tsc -b` 通过（类型修正 `RootContent[] → ElementContent[]`）。反向举证以「修复前基线」形式给出：修复前 `chat-math.test.ts` 8 tests 全绿，其中 `it('keeps mid-line double-dollar literal (legacy block rule is line-anchored)')` 正是把错误行为写成护栏——该护栏已被删除并由 3 条新断言取代（`renders mid-line double-dollar as display math between paragraphs` / `keeps an unclosed mid-line double-dollar literal` / `does not treat double-dollar as display math when the content holds a dollar`）。

### 修复项 3 · 代码块高亮 heading/list/code/quote/strong/emphasis/link 语义 + SVG 代码块 CSS

- **【问题】** ① markdown 围栏内 `# 标题` 由「heading 蓝 + 粗体」变「keyword 红 + 常规」，列表符失去独立色，行内代码/引用/粗体/斜体语义丢失，链接两段颜色**都反了**；② `quickforge-svg-code-block` 的旧 CSS（节点去框 + 标题栏左右内边距）随 pi 结构一起丢失，React 仍输出该类但**零规则**。
- **【旧证据】** 旧 CSS（`index-B1G0LqYR.css`）：`@4036` `.hljs-section{color:var(--syntax-heading);font-weight:700}`、`@4094` `.hljs-bullet{color:var(--syntax-list)}`、`@3837` `.hljs-comment,.hljs-code,.hljs-formula{color:var(--syntax-comment)}`、`@3904` `.hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo{color:var(--syntax-tag)}`、`@4132` `.hljs-emphasis{color:var(--color-text-primary);font-style:italic}`、`@4197` `.hljs-strong{…font-weight:700}`、`@3992` `.hljs-subst{…}`（**`--color-text-primary` 全产物 0 处定义 → 三条颜色声明计算值无效**）；`.hljs-link` 无规则（hljs Markdown 语法 `@2339299`：label=`string`、`](url)`=`link`）。旧源码 CSS：`3e10f58:src/index.css:2375`（`.quickforge-svg-code-block > div:first-child{position:relative;border:0!important;background:transparent!important;box-shadow:none!important}`）、`:2395`（`…:not(.quickforge-svg-code-toolbar-floating){padding-left/right:0!important}`），以及依赖已删 DOM 的 `:2382`/`:2391`。
- **【修复文件:行号】** `src/index.css`（`:root`/`.dark` 各 +4 变量 `--qf-hl-heading/-list/-code/-quote`；+6 条 token 规则 `.qf-hl-code`/`.qf-hl-heading{color;font-weight:700}`/`.qf-hl-list`/`.qf-hl-quote`/`.qf-hl-strong{font-weight:700}`/`.qf-hl-emphasis{font-style:italic}`；+2 条 SVG 代码块规则）；`src/lib/code-highlight.ts`（词表 +7：`code/heading/list/quote/link/strong/emphasis`；`tokenizeMarkdown` 标题/引用/列表/缩进行/行内代码/链接/粗斜体 + `!lineIndent` 门控；`tokenizeYaml` 列表符；`tokenizeCss` `:pseudo` → `tag`）；测试 `tests/frontend/code-highlight.test.ts`、`tests/frontend/chat-surface-css-contract.test.ts`。
- **【改动摘要】** 4 文件 `+277 / −31`。取值逐字复制旧 `--syntax-*`（仅补前导零）：`--qf-hl-heading` 亮 `oklch(43.5% 0.141 237.016)` / 暗 `oklch(52.3% 0.181 237.016)`；`--qf-hl-list` 亮 `oklch(53.7% 0.108 88.766)` / 暗 `oklch(86.6% 0.141 88.766)`；`--qf-hl-code` = `--syntax-comment`；`--qf-hl-quote` = `--syntax-tag`。**故意不建** `--qf-hl-link`/`.qf-hl-link`（对齐旧界面「`.hljs-link` 无规则」），**不给** strong/emphasis 建颜色（旧声明因变量缺失而无效）。SVG 侧按旧值补回两条等价规则（`.quickforge-svg-code-block` 去框、`> div:first-child` 标题栏内边距），依赖已删 DOM 的 `…-toolbar-floating` 两条规则**不复活**并由测试锁定「不得回流」。
- **【定向测试与反向举证结果】** 定向 `4 passed / 93 tests`。反向举证（先还原后改回）：把 `sink.push(rest,'heading')` 改回 `'keyword'`、把 `--qf-hl-heading` 改回 keyword 色 `oklch(57.7% 0.245 27.325)` → `2 failed | 84 passed (86)`，报错为 `AssertionError: qf-hl-heading: expected [ 'oklch(57.7% .245 27.325)', …(1) ] to deeply equal [ 'oklch(43.5% .141 237.016)', …(1) ]` 与 `expected [ { text: '# Title', …(1) }, …(13) ] to deep equally contain { text: '# Title', token: 'heading' }`；改回后同命令 `4 passed / 93 passed`。邻近回归 4 文件 `67 passed`。

### 修复项 4 · 自动滚动 50 / 10 迟滞

- **【问题】** pi 内部的两条迟滞语义在 React 化后消失：① 上滑需「距底 >50px」才释放跟随；② 距底 <10px 立即重新贴底（方向/时间无关）。修复前释放条件是「上滑 1px + 500ms 意图窗口」，且 wheel/键盘/触摸一发生上滑即**无条件**释放 → 距底 ≤50px 的微小上滑会中断跟随、动量滚动在意图窗口过期后贴不回底部。
- **【旧证据】** `pi-web-ui-B-_rXig1.js` 1866673 起（`_autoScroll`=1866683、`_handleScroll`=1866750）：`if(r<this._lastClientHeight){this._lastClientHeight=r;return} t!==0&&t<this._lastScrollTop&&i>50?this._autoScroll=!1:i<10&&(this._autoScroll=!0),this._lastScrollTop=t,this._lastClientHeight=r`；`ResizeObserver`（@1867791 起）观察 `.max-w-3xl`，`_autoScroll` 为真则 `scrollTop=scrollHeight`；`sendMessage` 中重开（@1869874）。应用层近底带 `<=80` 与 500ms 意图窗口见 `ChatPanelHost-kh5gPhZf.js` @51978（`f=e=>e.scrollHeight-e.scrollTop-e.clientHeight<=80`、`m=()=>{…window.performance.now()-e<=500}`）。
- **【修复文件:行号】** `src/components/chat/scroll-sync.ts`（常量 `releaseFollowDistancePx = 50`、`repinFollowDistancePx = 10`、抽出 `distanceFromBottom()` 于新 `:26-40`；`markUserScrollUp()` 新 `:60-68`；`handleScroll()` 新 `:115-138`）；测试 `tests/frontend/scroll-sync.test.ts`（+44）。
- **【改动摘要】** 仅 `scroll-sync.ts` + 测试（`+27 / −4` 与 `+44 / −0`）：① `markUserScrollUp()` 改为**距离门控**——`dist > 50` 才释放，≤50 只记时间戳（迟滞带内继续跟随）；② `handleScroll()` 新增 `distance < 10 → 立即重新启用跟随`（方向/意图无关，程序化护栏语义不变）；③ 释放条件收紧为 `userInitiatedScrollUp && distance > 50`；原有两条分支（非用户上滑 & `dist>80` → 重贴底；向下 + 500ms 意图 & `dist<=80` → 重新启用）与 `onReachTop` 位置不动；未触碰程序化护栏、ResizeObserver 观察集合、`enable/disable/scheduleScrollToBottom` 公开 API 与 `ChatSurface.tsx`。
- **【定向测试与反向举证结果】** 定向 4 文件 `4 passed / 35 tests`（`scroll-to-bottom-button` 10、`scroll-sync` 6、`turn-navigation` 9、`chat-surface-release-gate` 10）。反向举证（临时用 `git show HEAD:…scroll-sync.ts` 还原）→ `× keeps tail-following while a user scroll-up stays within 50px of the tail (AssertionError: expected false to be true, scroll-sync.test.ts:118)`、`× re-arms tail-following as soon as the viewport is back within 10px of the tail (…:146)`、`1 failed | 2 failed | 4 passed (6)`；恢复修复版后复跑全绿。既有 4 条断言在修复后**全部保持通过**（释放场景在 dist=900 / 程序化 dist=50 处，不受 50/10 门槛影响）。`npx eslint` exit 0、`npx tsc -b` exit 0（`tsconfig.app.json` 为 `noEmit`）。期间一次 `chat-surface-release-gate.test.ts` 出现 `vite:oxc` 对无关文件 `src/lib/chat-math.ts:370` 的 PARSE_ERROR（当时该文件正被并行分片半写），单独复跑即通过，判定为瞬时转换错误。

### 修复项 5 · 代码块标题栏复制文案 `Copy code` / `Copied!`

- **【问题】** 标题栏复制按钮的 tooltip 由「Copy code」变「Copy / 复制」，复制后的可见文本由「Copied! / 已复制！」变「Copied / 已复制」（少了感叹号）。
- **【旧证据】** pi `copy-button` 类（`pi-web-ui-B-_rXig1.js` @3072860/@3073076/@3073140）：`this.title=L('Copy')`（**唯一赋值点在 constructor**，`render()` 里 `title:this.title` 原样再用 → title 恒定）、`setTimeout(()=>{this.copied=!1},2e3)`、`${this.copied&&this.showText?s`<span>${L('Copied!')}</span>`:''}`；`<code-block>` 模板覆盖两个默认值：`title="${L('Copy code')}"`（@3144743）+ `.showText=${!0}`（@3144758）。zh 值来自 `3e10f58:src/lib/i18n.ts` 的 `piChineseOverrides:3454`（`复制代码`）与 `:3305`（`已复制！`，全角感叹号）。对照：应用自有的 `copy`/`copied` 键（`Copy`/`Copied`、`复制`/`已复制`）在旧界面由消息操作按钮与 ⋯ 菜单反馈使用，**与代码块标题栏无关**。
- **【修复文件:行号】** `src/components/chat/surface/CodeBlock.tsx`（`:256-257` 改为 `title/aria-label={t('copyCode')}`，`:261` 改为 `{copied ? <span>{t('copiedBang')}</span> : null}`；`:47` `COPY_BUTTON_FEEDBACK_MS = 2000` 不变）；`src/lib/i18n.ts`（新增 `copyCode: 'Copy code'` / `'复制代码'`；zh 位于 `:1877` 区域，en 位于 `:218` 区域）；测试 `tests/frontend/chat-code-block.test.ts`（+29/−13）。
- **【改动摘要】** 3 文件 `+45 / −14`。新增独立键 `copyCode` 而**不改** `copy`/`copied` 的值（二者共享给消息操作/提示 toast：`App.tsx:1351`、`panel-decoration/message-actions.ts:31,488`、`context-compaction.ts:16`）；键值实测：`zh copyCode=复制代码 copiedBang=已复制！ copied=已复制 copy=复制` / `en copyCode=Copy code copiedBang=Copied! copied=Copied copy=Copy`。**未动**复制行为、`MENU_COPY_FEEDBACK_MS=1200` 的 ⋯ 菜单路径。
- **【定向测试与反向举证结果】** 定向 5 文件 `5 passed / 71 tests`；`npx eslint …` exit 0；`npx tsc -b` 无诊断。**双向反证**：A) 把断言改回旧形态（`title="copy"` 等）→ `3 failed | 61 passed (64)`（`chat-code-block.test.ts:129`/`:352`/`:361`）；B) 把源实现改回旧键（`title={t('copy')}`、`{t('copied')}`）→ `4 failed | 60 passed (64)`（`:284`/`:357`/`:367` 等）。恢复后复跑 `5 passed / 71 passed` 并 `TSC_DONE`。

### 修复项 6 · 语法高亮分桶（CSS selector/var、YAML/JSON/TOML/INI 字面量、Setext 标题）

- **【问题】** 四处「旧 hljs 有明确分桶、新 tokenizer 落到别的桶」的颜色偏差：① `.x`/`#x` 旧属 `--syntax-constant`（蓝），新为 `function`（紫）/`builtin`（橙）；② CSS 声明值里的 `var(`/`rgb(` 旧属 `built_in` → `--syntax-variable`（橙），新为 `function`（紫）；③ YAML/JSON/TOML/INI 的 `true/false/null/yes/no` 旧属 `.hljs-literal` → constant（蓝），新为 `keyword`（红）；④ markdown Setext 标题（`Title` + `===`/`---`）旧整段（标题行 + 下划线行）带 heading 色 + 粗体，新不识别。
- **【旧证据】** ① 旧 hljs CSS 语法（同构建两份副本）：`{className:'selector-id',begin:/#[A-Za-z0-9_-]+/,relevance:0}` @2335234、`{className:'selector-class',begin:'\.[a-zA-Z-][a-zA-Z0-9_-]*'}` @2335296，二者与 `.hljs-attr` 同处 `@3520` 的 `--syntax-constant` 规则。② `FUNCTION_DISPATCH:{className:'built_in',begin:/[\w-]+(?=\()/}` @2324636（声明值规则引用它 @3117892）；`CSS_VARIABLE:{className:'attr',begin:/--[A-Za-z_][A-Za-z0-9_-]*/}` @2324989。③ YAML `let t='true false yes no null'` @2997930 与 `{beginKeywords:t,keywords:{literal:t}}` @2999515；JSON `r=['true','false','null']` @2565560 + `keywords:{literal:r}` @2565669；TOML/INI 共用 `Jge`（`name:'TOML, also INI'` @2481159，字面量规则 `\bon|off|true|false|yes|no\b` @2481459，注册 `registerLanguage('ini',Jge())` @3068650 → alias `toml` 亦走该语法）。④ Markdown `{className:'section',variants:[{begin:'^#{1,6}',…},{begin:'(?=^.+?\\n[=-]{2,}$)',contains:[{begin:'^[=-]*},{begin:'^',end:'\\n',…}]}]}`（变体 2 的零宽 lookahead @2340703）；因所有语法正则带 `m` flag（@2196783）、无 `end` 的模式被编译成 `end=/\B|\b/`（@2198858）、matcher 中 `contains` 的 begin 先于 `terminatorEnd`（@2198212）→ 旧等价 HTML 为 `<span class="hljs-section">Title\n=====</span>`。
- **【修复文件:行号】** `src/lib/code-highlight.ts`：① `:1007`（原 `:996`）与 `:1072`（原 `:1060`）`sink.push(selector, 'attr')`；② `:1100`（原 `:1086`）`else if (code[k] === '(') sink.push(word, 'builtin')`；③ `tokenizeJson` `:795`（原 `:787`）→ `'number'`，`YAML_LITERAL_WORDS` `:1340` / `YAML_KEYWORDS` `:1346` / 判定 `:1431`，`TOML_LITERAL_WORDS` `:1739` / `INI_LITERAL_WORDS` `:1740` / `literals` 取用 `:1773` / 判定 `:1867`；④ Setext 分支 `:1512-1533`（`#` 规则之后、fence 规则之前，与旧 `variants` 顺序一致）。测试 `tests/frontend/code-highlight.test.ts`。
- **【改动摘要】** 本项**未新增 token / 未改 `src/index.css`**：`.x`/`#x` 复用 `attr`（与旧 constant 同值）、CSS 函数复用 `builtin`（旧 className 本就是 `built_in`）、字面量复用 `number`（`--qf-hl-number` 与旧 `--syntax-constant` 同值）、Setext 复用 `heading`（W3 已建）。YAML 拆表：`YAML_LITERAL_WORDS = {true,false,yes,no,null}`（**逐字复制**旧表）→ `number`，`on/off/~` 仍 `keyword`（旧属 `string` 桶，见 §6）；Setext 命中时一次性消费两行并复位 `lineStart/indentedLine/lineIndent`，负例（单字符 `-`、下划线行尾空格、空标题行）与旧 lookahead 一致。
- **【定向测试与反向举证结果】** 定向 3 文件 `3 passed / 95 tests`；`npx tsc -b` exit 0（`noEmit`）；`npm run lint` `0 errors, 3 warnings`（全在 `coverage/` 生成物）。**四组反向举证**（逐项临时还原旧行为，再恢复）：(a) 两处映射改回 `function`/`builtin` → `3 failed | 57 passed (60)`（`… to deep equally contain { text: '.card', token: 'attr' }` / `#app` / `.x`）；(b) 声明值改回 `function` → `2 failed | 58 passed (60)`（`… contain { text: 'var', token: 'builtin' }`）；(c) 字面量改回 `keyword` → `6 failed | 54 passed (60)`；Setext 分支临时关闭 → (d) `1 failed | 59 passed (60)`（`expected [] to deeply equal [ { text: 'Title', …(1) }, …(3) ]`）。恢复后同一命令 `3 passed / 95 passed`。邻近回归 5 文件 `70 passed`（含聊天代码块/工具卡/markdown reader/渲染与语义色契约）。

### 修复项 7 · 工具卡代码块复制反馈 + console 输出区自动置底

- **【问题】** ① 工具卡代码块（`ToolCodeBlock`）的 title 会随 copied 切换为 `Copied`/`已复制`、且复制后**无可见文本**（旧为 title 恒 `Copy code` + 可见 `Copied!`），与已对齐的聊天侧 `CodeBlock` 形态不一致；② 旧 `<console-block>.updated()` 每次更新把输出区置底，新实现无等价物 → 流式追加时停留在顶部，用户必须手动滚。
- **【旧证据】** ① 调用点全为 `<code-block .code=… language=…>`、**无一覆盖 title**：`3e10f58:src/lib/local-tools.ts:692/693/694`（subagent 卡 output/input/details）、`:837`（run_command 非 detailed 分支）、`:898/899/901`（detailed 分支）、`:1038/1039`、`:1097/1098/1099`、`:1140/1141`、`:1229/1230/1231`；pi `<code-block>`（类 `G1`，注册 @3145168）模板：`<copy-button … title="${L('Copy code')}" .showText=${!0}>`（@3144731/@3144758）；`<copy-button>` 类（@3072894 起）`this.title=L('Copy')` 仅 constructor 赋值、`setTimeout(…,2e3)`（@3073076）、`${this.copied&&this.showText?s`<span>${L('Copied!')}</span>`:''}`；② `<console-block>.updated(){let e=this.querySelector('.console-scroll');e&&(e.scrollTop=e.scrollHeight)}`（@3145903；**无** scroll 监听、**无** `_autoScroll`、**不区分**用户手动上滑；容器 `div.console-scroll.overflow-auto.max-h-64`，`console-scroll` 在旧构建 CSS 中 **0** 次命中 → 纯 JS 钩子类名）。
- **【修复文件:行号】** `src/lib/tool-renderers/shared.tsx`（`ToolCodeBlock`：`:692` `const copyLabel = t('copyCode')`、`:701` 复制态尺寸配方 `h-7 gap-1 px-1.5 text-xs`、`:707` `{copied ? <span>{t('copiedBang')}</span> : null}`；新增 `ConsoleScrollArea` `:761-799`，置底写入 `:779` 的 `if (element) element.scrollTop = element.scrollHeight`（位于**无依赖数组**的 `useEffect` 内）；测试 `tests/frontend/tool-renderer-code-block.test.ts`（+5/−1）、`tests/frontend/tool-renderer-shared-state.test.ts`（+94/−10）。**未新增/改写任何 i18n 键**（复用 W1/W7 的 `copyCode`/`copiedBang`）。
- **【改动摘要】** `shared.tsx` `+37 / −6`（A 段 +10/−5、B 段 +27/−1）：A 段把 title/aria-label 固定为 `copyCode`、复制后追加可见 `copiedBang` 文本（复制态尺寸配方与 `CodeBlock.tsx:253-258` 逐字相同，仍是同一个 `<button data-qf-action="copy-code">`，未引入新组件）；B 段把滚动副作用下沉到模块内私有组件 `ConsoleScrollArea`（`renderConsoleBlock(content, variant)` 仍同步返回 JSX 的工厂函数，调用方 `local-workspace-tool-renderer.tsx:78` 不变），`useEffect` **故意不给依赖数组** = 每次 commit 后执行，对应 lit `updated()` 的「每次渲染后」触发次数语义，因而**天然保留了「不区分用户手动上滑」的旧缺陷**（登记，不新增行为）。
- **【定向测试与反向举证结果】** 定向 3 文件 `3 passed / 20 tests`（`tool-renderer-shared-state.test.ts` 由 W11 的 10 例增至 13 例）；`npx tsc -b` exit 0；定向 `npx eslint` exit 0；邻近回归 4 文件 `94 passed`（`subagent-run-detail-react`/`local-tool-running-sweep`/`chat-code-block`/`goal-report-renderer`）。**三组反向举证**：M1（title 回退为切换式 + 去掉可见 `<span>`）→ `2 failed | 4 failed | 13 passed (17)`（`tool-renderer-code-block.test.ts:62`、`tool-renderer-shared-state.test.ts:70/107/124`）；M1b（只删可见文本那一行）→ `2 failed | 11 passed (13)`（`:70` 子节点期望 `[Check,'span']`、`:107` zh 文本 `undefined ≠ '已复制！'`）；M2（把 `element.scrollTop = element.scrollHeight` 改成 no-op）→ `2 failed | 11 passed (13)`（`expected +0 to be 480` / `expected +0 to be 960`）。三处临时改动均已从 `%TEMP%` 备份还原并复查行号与取值。

**本轮修复项汇总**：7 项（W1+W11 计 1 项）、改动 7 源码 + 7 测试文件，`+939 / −135`；另有 W5（0 改动）与 W6（0 改动）两条「无需修复」专项结论。

---

## 4. 有意保留的差异

下表 17 条为**本轮判定为「有意保留」且不建议回退**的差异（含 1 条已按任务要求「保留原样但不修改」的旧缺陷、2 条因证据不足按不可考证口径保留者）。最小必须保留项已全覆盖；表中「旧行为」的证据定位与 §2 对应行一致。

| # | 项 | 旧行为 | 新行为 | 保留理由 |
| --- | --- | --- | --- | --- |
| 1 | `ui/Input` 聚焦反馈 | `3e10f58:src/components/ui/input.tsx:9` 的 `focus-visible:border-primary` 在旧产物中命中 **0**（dead：`3e10f58:src/index.css:23-27` 的 `@theme` 只有 `--radius`/`--shadow-quickforge`，无 `--color-primary` → Tailwind 生成不出该变体），实际只剩「抑制轮廓」 | 同一行改为 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`；新 `src/index.css:257-287` `@theme inline` 提供 `--color-primary`(:264)/`--color-ring`(:276) → 环真实可见 | **无障碍增强**（旧界面本来没有可见聚焦反馈；W5 逐文件核对确认无 alive 类回归） |
| 2 | Esc 中止真正接线 | pi 有 Escape 分支（@1813590 `e.key==='Escape'&&this.isStreaming&&(e.preventDefault(),this.onAbort?.())`），但 BASE 全仓**未给 editor 赋 `onAbort`**（`git grep -n "onAbort" 3e10f58 -- src` 在 `src/components/chat/**` 无命中）→ 旧 Esc **实为 no-op** | `MessageEditor.tsx:84-86` 返回 `abort`、`:221` 调用；`ChatSurface.tsx:893` `onAbort={() => agent.abort()}` → 真实中止 | **旧缺陷修复**（死代码被接活）；建议在发布说明显式记录 |
| 3 | 设置下拉键盘步进修复（打开键多走一格） | 旧 `quickforge-settings-select.ts:173-174` 在**同一次 keydown 分派**中挂 document 监听，文档级 `_handleKeyDown`（`:404-425`）对 Arrow 无条件 `_moveFocus(±1)`，关闭路径（`:190-200`）无防护 → 打开键会额外移动一格 | `SettingsSelect.tsx:148-156` `event.stopPropagation()`；文档监听改在 `useEffect`（`:87-132`）提交后挂载 | **旧缺陷修复**（置信度中：规范推理 + 代码阅读，未做浏览器实测） |
| 4 | 数字输入 `change`+`blur` 去重 | 旧 `default-options-settings-tab.ts:1127-1133`/`:1152-1161`/`:1174-1182` 三个 number input 同时绑 `@change` 与 `@blur` → **必然双提交** | `SettingsNumberInput.tsx:12-22` 用 `committedRef` 去重后监听原生 `change`；`:27-30` `onInput` 清标记；`:31-37` Enter 走同一路径 | **旧缺陷修复** |
| 5 | Markdown 图片 `src` scheme 白名单 | 旧 renderer 只覆盖 `link`/`table`（@2175400），**无 image 覆盖**、未传 `sanitize`（pi 产物内无 DOMPurify）→ 任意 `src` 原样进 DOM | `Markdown.tsx:44-50` `isSafeMarkdownImageSrc()`（仅 http/https/blob/`data:image`/相对）；`:60-70` unsafe 时省略 `src` 并加 `loading="lazy"` | **安全加固** |
| 6 | `skipHtml` 丢弃原始 HTML | 旧 marked 的 `html` token 经 lit `d(a)` 注入（@2175400+），无 sanitize → 内联 HTML 原样渲染 | `Markdown.tsx:140` `skipHtml` → 原始 HTML 被丢弃（`<br>`/`<details>` 等不再渲染） | **安全加固**（如需支持应加白名单 sanitizer，而非取消 `skipHtml`） |
| 7 | 附件解析上限 / 超时 / PDF 页数 / 文本截断 | 旧 pi 文档抽取（@1790500-1793600）：PDF `for(let e=1;e<=n.numPages;e++)` **无页数上限**、zip/xlsx/pptx 直接 `JSZip` 无体积上限、`TextDecoder` 无长度上限 | `attachment-loader.ts:41-48`：zip 条目 50MB / 总量 100MB、提取文本 2MB（`:46` 截断标记）、`PDF_MAX_PAGES=500`、`DOCUMENT_PROCESS_TIMEOUT_MS=30_000` | **安全/性能加固**（发布说明记录「大附件行为可能变化」） |
| 8 | 未注册语言不再 `highlightAuto` | 旧 @3144283：语言未注册 → `A1.highlightAuto(e).value`（做语言猜测，输出不可预测，可能产出 section/bullet/type/function 等 token） | `code-highlight.ts:187-191` 走 `tokenizeGeneric`；`:2383` 仅 comment/string/keyword 命中才认领；`:61` 200KB 上限直接 plain；`:181` `text/plaintext/txt`/缺省 → plain | **确定性/性能**（拒绝猜测；已在 `code-highlight.ts:16-20,2368-2370` 声明为已知差异） |
| 9 | 思考块 header：`visibility:hidden` → fail-visible | 旧 `3e10f58:src/index.css:3199-3201`：`pi-chat-panel thinking-block > .thinking-block > .thinking-header:not(.quickforge-process-thinking-header){visibility:hidden}`（未接管的原生 header 被藏） | `src/index.css:3621-3644`：header 保持可见（只给 `color`/过渡），仅**自带 `<svg>`** 在未接管时 `visibility:hidden;opacity:0`，hover/focus 显现 | **fail-visible 加固**（未接管时不再丢内容；需在文档记录为刻意行为） |
| 10 | 摘要行字号改为跟随 `--quickforge-message-font-size` | 旧固定值：`3e10f58:src/index.css:2856-2868` 与 `:2988-3001` `font-size:0.875rem;line-height:1.5`；过程组 header（`:3203-3217`）为 `0.875rem !important` | `src/index.css:3267`/`:3401` 改 `calc(var(--quickforge-message-font-size, 14px) * 0.875)`（注释 `:3266`/`:3400`）；过程组 header `:3651-3665` 同式并**去掉 `!important`**（注释 `:3646-3650`） | **有意的缩放改动**（摘要随消息字号变量缩放；若出现 utility 反超字号需把 `!important` 加回，属回归确认项） |
| 11 | 过程折叠默认值按旧语义（与早期 R10 用户要求冲突） | 旧 `process-folding.ts:638/645` → `syncProcessGroupExpandedState(..., defaultExpanded = false)`（`:128-132`）把 `isAgentStreaming` 当默认值；阶段层恒 `false`（`:519-521`）；工具组仅 detailed 展开（`:599`） | 新 `process-folding.ts:556-559` `processGroupDefaultExpanded(isAgentStreaming){return isAgentStreaming}`、`:561-564`（阶段层 `false`）、`:621-623`（工具组 `mode==='detailed'`） | **按旧语义对齐**（等价函数化）。与早期 R10 用户要求的冲突在本轮证据源中**未取证到原文**（登记为冲突项，未据此改动）；另 `canShortCircuit` 由 `isAgentStreaming && !isActiveTurn` 改为 `!isActiveTurn`（W6 项 A：真值表仅「空闲帧 full→skip」一格差异、展开判定与稳态 DOM 等价 → 登记不改） |
| 12 | API Key 对话框：新增探测与 Escape / 焦点恢复 | 旧界面无该对话框（pi 侧对应交互未在旧产物中定位） | 新增文件 `src/components/chat/surface/ApiKeyPromptDialog.tsx`（属 A=55 新增清单），据其定位应含探测与 Escape/焦点恢复行为 | **不可考证**（本轮分片**未独立取证**该组件的探测/Escape/焦点恢复细节；仅能证明该文件为新增，无法给出旧↔新逐条对照） |
| 13 | 消息窗口化仍 `enabled:false` | 旧 `ChatPanelHost.tsx:656`（BASE）`const windowLayer = createMessageWindow({ enabled: false })`；常量 `windowed-messages.ts:27-35`（6 / 48 / 80_000 / 3 / 3） | `ChatSurface.tsx:556` `useState(() => createMessageWindow({ enabled: false }))`；常量 `windowed-messages.ts:5-13` 同值（`:132-136` 读取） | **保持一致不放量**（窗口化未启用；不借重构之机改变大列表策略） |
| 14 | artifacts 面板未复刻 | pi 自带 artifact 预览组件：`Copy logs` @3075296、`Copy HTML` @3078097、`Copy SVG` @3089013、`Copy Markdown` @3083790（均为同一 2000ms `copy-button`）；旧应用自有代码只用 `<code-block>`/`<console-block>`（`local-tools.ts:692-694,837,898-901,1038-1039,1097-1099,1140-1141,1229-1231`），`git grep` 未发现旧应用实例化这些组件 | 新界面无对应 artifact 预览面板组件 | **不可考证**（基于「旧应用未实例化」的检索结论 → 未见旧→新缺口；但**未 100% 排除**旧界面经其它路径触达，登记为低优先复核项） |
| 15 | composer placeholder 文案变更 | pi `placeholder=${L('Type a message...')}`（@1817340 区域）；BASE 翻译表 `3e10f58:src/lib/i18n.ts:3281` `'Type a message...': '输入消息...'` | `MessageEditor.tsx:357` `placeholder={t('composerPlaceholder')}`；`i18n.ts:259` en `Describe what you want to do` / `:1911` zh `描述你想做的事`（旧键已在 diff 中删除） | **有意文案变更**（两语言均变；若判定为误改，回退方式是把 zh/en 值改回原字符串） |
| 16 | 旧 pi 的 `clientHeight` 收缩忽略分支未恢复 | 旧 `@1866750`：`if(r<this._lastClientHeight){this._lastClientHeight=r;return}`（clientHeight 变小时直接忽略该次 scroll，防布局抖动误判） | 新 `scroll-sync.ts` 无等价物；由「非用户上滑 & `!isNearBottom` → 重贴底」间接兜底 | **不可考证**（本轮按任务只恢复 50/10 两项；未复现真实误判，需真机验证 devtools 开关/字体加载/面板缩放时的行为） |
| 17 | 触控惯性 / 500ms 意图窗口的边界差异 | 旧为**双层语义**：应用层 wheel/键盘/触摸上滑**立即**释放（无距离门槛，`g()` → `s=now,h()` 并把 `setAutoScroll(false)` 转发给 pi），pi 内部另有 `>50` 释放 / `<10` 重贴 | 新统一为**单层距离门控**：`markUserScrollUp()` 仅在 `dist>50` 时释放；`handleScroll()` 中 `dist<10` 无条件重新启用；重新启用需 `向下 +1px && recentlyUserScrolled()(500ms) && dist<=80` | **有意保留**（按本轮目标统一为单层；差异仅出现在「距底 ≤50px 的微小上滑」与「触控惯性超过 500ms 意图窗口后仍在上滑」两种场景，登记待真机复核） |

---

## 5. 验证记录

### 5.1 全量三件套（实际输出与结论）

| 命令 | 脚本定义 | 实际汇总数字 | 结论 |
| --- | --- | --- | --- |
| `npm run test` | `vitest run` | `Test Files 364 passed (364)`；`Tests 4373 passed | 1 skipped (4374)`；exit code 0；stderr 仅测试内注入的预期日志（MCP 连接失败、SQLite 初始化/迁移、CAS 冲突告警），无未捕获异常导致的中断 | **PASS（全绿）** |
| `npm run lint` | `eslint .` | `✖ 3 problems (0 errors, 3 warnings)`；3 条 warning 全部来自 `coverage/` 生成物（`coverage/block-navigation.js`、`coverage/prettify.js`、`coverage/sorter.js` 各 1 条 `Unused eslint-disable directive`），**无一条来自 `src/` 或 `tests/`**；exit code 0 | **PASS（0 error）** |
| `npm run build` | `tsc -b && vite build` | `tsc -b`：无诊断输出（`findstr /C:"error TS"` 0 命中，且 `&&` 链进入 vite 阶段）；`vite v8.0.10 building client environment for production...` → `✓ 7836 modules transformed.` → `rendering chunks...` → `✓ built in 2.36s`；exit code 0；stderr 仅告警（`node:fs` 被 externalize、chunk >500kB 提示） | **PASS** |

定向复核：`npx vitest run` 本轮改动的 **7 个测试文件** → `Test Files 7 passed (7)` / `Tests 169 passed (169)`（`chat-code-block`、`chat-math`、`chat-surface-css-contract`、`code-highlight`、`scroll-sync`、`tool-renderer-code-block`、`tool-renderer-shared-state`）。

### 5.2 依赖清单与产物目录

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 依赖清单无变化 | `git diff --stat -- package.json package-lock.json` | **空输出**（exit 0）→ 未新增/升级依赖，`package-lock.json` 保持一致 |
| `package-dist/`、`package-offline/` 未被写入 | `dir /A /T:W dist\index.html package-dist package-offline` | `package-dist/`、`package-offline/` 的全部条目时间戳仍为 **2026/09/13 11:52**（目录本体亦为该时间）；`dist/index.html` 为 **2026/09/21 03:46**（本次 `npm run build` 重新生成） |
| 产物目录的 git 状态 | `git status --porcelain=v1 -uall --ignored=matching \| findstr /I "dist package-dist package-offline"` | `!! desktop-dist/`、`!! dist/`、`!! package-dist/`、`!! package-offline/` → 全部为 ignored，无 `??`/` M ` 形式的产物条目 |
| `dist/` 由项目规定的 `npm run build` 重新生成 | 同上 + build 输出 | `dist/assets/index-92z4QjNG.js 710.17 kB │ gzip: 192.25 kB`、`dist/assets/editor.api2-BrGlpe5i.js 2,557.09 kB │ gzip: 660.18 kB` 等；`dist/` 在 `.gitignore` 内，属预期写入，**不是**人工修改产物目录 |

### 5.3 工作区状态（收口复查）

- 修复完成后（build 前后各查一次，结果一致）：`14 个 ` M `（7 源码 + 7 测试）+ 未跟踪分片文档目录`；build 仅重新生成被忽略的 `dist/`，未新增/消失任何待提交条目。
- 本轮总改动规模：`14 files changed, 939 insertions(+), 135 deletions(-)`（`git diff --stat`；stderr 仅 `warning: in the copy of 'src/lib/i18n.ts', CRLF will be replaced by LF …` 的行尾归一化提示）。
- 未创建任何 git commit / tag / push，未执行 npm publish。

### 5.4 报告落盘后的 `git status --porcelain=v1 -uall`（写作完成时实测）

> 说明：下面输出中除本报告外，其余 `??` 条目是**本轮各分片的过程文档**（`docs/reviews/parity-audit-parts/`），按任务约定随后会被清理；` M ` 条目即 §5.3 的 14 个改动文件；本次实测共 **14 个 ` M ` + 18 个 `??`**（= 1 份本报告 + 17 份分片文档）。

```text
 M src/components/chat/scroll-sync.ts
 M src/components/chat/surface/CodeBlock.tsx
 M src/index.css
 M src/lib/chat-math.ts
 M src/lib/code-highlight.ts
 M src/lib/i18n.ts
 M src/lib/tool-renderers/shared.tsx
 M tests/frontend/chat-code-block.test.ts
 M tests/frontend/chat-math.test.ts
 M tests/frontend/chat-surface-css-contract.test.ts
 M tests/frontend/code-highlight.test.ts
 M tests/frontend/scroll-sync.test.ts
 M tests/frontend/tool-renderer-code-block.test.ts
 M tests/frontend/tool-renderer-shared-state.test.ts
?? docs/reviews/dependency-removal-interaction-parity-audit.zh-CN.md
?? docs/reviews/parity-audit-parts/00-baseline.zh-CN.md
?? docs/reviews/parity-audit-parts/01-composer.zh-CN.md
?? docs/reviews/parity-audit-parts/02-rendering.zh-CN.md
?? docs/reviews/parity-audit-parts/03-settings-ui.zh-CN.md
?? docs/reviews/parity-audit-parts/04-global-css.zh-CN.md
?? docs/reviews/parity-audit-parts/05-decoration.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w1-copy.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w10-buckets.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w11-console.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w12-toolcard.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w2-math-inline.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w3-highlight.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w4-autoscroll.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w5-focus.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w6-decoration.zh-CN.md
?? docs/reviews/parity-audit-parts/fix-w7-copy-text.zh-CN.md
?? docs/reviews/parity-audit-parts/verify-final.zh-CN.md
```

**收口后最终状态（本报告定稿时实测）**：分片过程文档目录 `docs/reviews/parity-audit-parts/`（17 个 `.md`）已清理；`docs/wiki/**`（`src/README.md`、`src/components/README.md`、`src/lib/README.md`）与 `feature_list.json`、`progress.md`、`session-handoff.md` 均已同步完成。最终工作区实测为 **20 个 ` M ` + 1 个 `??`（20 M + 1 ??）**：
```text
 M docs/wiki/src/README.md
 M docs/wiki/src/components/README.md
 M docs/wiki/src/lib/README.md
 M feature_list.json
 M progress.md
 M session-handoff.md
 M src/components/chat/scroll-sync.ts
 M src/components/chat/surface/CodeBlock.tsx
 M src/index.css
 M src/lib/chat-math.ts
 M src/lib/code-highlight.ts
 M src/lib/i18n.ts
 M src/lib/tool-renderers/shared.tsx
 M tests/frontend/chat-code-block.test.ts
 M tests/frontend/chat-math.test.ts
 M tests/frontend/chat-surface-css-contract.test.ts
 M tests/frontend/code-highlight.test.ts
 M tests/frontend/scroll-sync.test.ts
 M tests/frontend/tool-renderer-code-block.test.ts
 M tests/frontend/tool-renderer-shared-state.test.ts
?? docs/reviews/dependency-removal-interaction-parity-audit.zh-CN.md
```

`package.json` / `package-lock.json` 无任何改动（`git status --porcelain=v1 -uall -- package.json package-lock.json` 空输出）；`package-dist/`、`package-offline/` 未受影响（旧产物 `index-B1G0LqYR.css` 时间戳仍为 **2026/09/13 11:52**）。上方「写作完成时实测」快照保留为历史记录。

---

## 6. 未验证与遗留

### 6.1 浏览器真机实测未执行（本轮全部结论基于源码 + 旧产物 + 单测级验证）

本轮所有判定均由「源码/产物原文对照 + vitest（部分用假宿主对象驱动 effect/事件）」得出，**未做任何真实浏览器交互回归**。最需要真机复验的条目（按风险排序）：

| # | 待复验项 | 为什么必须真机 | 关联证据 |
| --- | --- | --- | --- |
| 1 | composer 的 hover / active / 聚焦反馈 | ① `size-9`(2.25rem) 与 `h-8 w-8`(2rem) 的胜负仅用**重构前**产物验证，未在新构建上复核 Tailwind 生成顺序；② 新 `Button` 基类的 `active:scale-[0.97]` 在 composer 区无覆盖，旧 pi 是否有同款 utility 未取证 | `package-dist/…index-B1G0LqYR.css` @81383/82263/84565；`button.tsx:6` |
| 2 | 设置下拉的键盘步进与定位 | 「打开键多走一格」为 DOM 规范推理 + 代码阅读结论（未跑旧版本键盘用例）；漂浮/向上展开、`maxHeight 300`、左边界 clamp 的视觉效果需实测 | 旧 `quickforge-settings-select.ts:173-174/190-200/404-425`；新 `SettingsSelect.tsx:148-156`、`settings-select-state.ts:23-38` |
| 3 | 弹窗 Escape 与关闭后焦点恢复 | confirm 弹窗的焦点陷阱/恢复是逐字对照结论；prompt 弹窗两版**一致地缺失**焦点恢复（需确认是否为可接受体验）；API Key 对话框的行为本轮未取证 | `confirm-dialog.tsx:77-101/164-177`；`prompt-dialog.tsx:104-107` |
| 4 | 复制反馈时长的手感（2000ms 代码块 / 1200ms ⋯ 菜单 / 1500ms console 输出） | 三个时长的来源是旧产物常量（`2e3`/`1200`/`1500`），但「视觉上是否够用、是否闪烁」需目视；console 复制按钮**无真实布局**验证 | `pi-web-ui-B-_rXig1.js` @3073076、`code-blocks.ts:33`、@3178138 |
| 5 | 自动滚动手感（50/10 迟滞 + 500ms 意图窗口 + 触控惯性边界） | 单测用假 `performance.now`/`ResizeObserver`；真实场景涉及惯性滚动、`clientHeight` 抖动（旧 `_lastClientHeight` 早退分支未恢复）、短页面 wheel 兜底 | `pi-web-ui-B-_rXig1.js` @1866673-1867791；`scroll-sync.ts:26-40/60-68/115-138` |
| 6 | console 输出区自动置底 | `ConsoleScrollArea` 的 effect 在真实布局下的时机（内容回流后 `scrollHeight` 取值）未测；需用 `run_command` 长输出卡确认「流式追加时是否始终贴底」 | 旧 `.updated()` @3145903；新 `shared.tsx:761-799` |

### 6.2 W3 / W10 登记的未修语法分桶残留（已取证、本轮按最小改动不做，均带旧证据）

| # | 残留项 | 旧行为证据 | 新行为 | 未修原因 / 代价 |
| --- | --- | --- | --- | --- |
| 1 | markdown **嵌套围栏整块 `code`** | hljs `Markdown` `code` 变体（`className:'code',variants:` @2339016 窗口）：``` 块（含内容）整体是一个 `.hljs-code` → `--syntax-comment` 灰 | 围栏行 → `punct`（无色），块内容按 markdown 规则继续分词 | 对齐需引入「围栏状态机 + 反引号配对 + 内层不再分词」的重写，且与「代码块内高亮」既有预期冲突；影响面仅「`markdown` 围栏里再嵌围栏」（agent 输出不常见） |
| 2 | `formula`（`.hljs-formula`） | `@3837` `.hljs-comment,.hljs-code,.hljs-formula{color:var(--syntax-comment)}`，`formula` 仅由 tex/数学类语法产出 | 不产出（tex/latex 未注册 → 走 `tokenizeGeneric`） | 属「扩语言表」而非「补语义」（需新增 tex 方言并决定其分词）；影响面仅 tex 围栏 |
| 3 | 引用式链接定义 `[x]: url` 的 `symbol` / `link` | hljs `Markdown` @2339376：`{begin:/^\[[^\n]+\]:/,returnBegin:!0,contains:[{className:'symbol',…},{className:'link',…}]}` → `symbol` 属 `.hljs-symbol` @3780（`--syntax-variable` 橙）、`link` 无规则 | 不识别（`[` → `punct`，其余按正文） | 需新增「引用式定义」分支并处理 `symbol` 在旧调色板的 built_in 桶归属；收益低 |
| 4 | YAML `on` / `off` / `~` | 不在旧字面量表 `let t='true false yes no null'` @2997930 内；落 YAML 末尾裸标量规则（`o={className:'string',variants:[{begin:/"/,end:/"/},{begin:/\S+/}]}`）→ `.hljs-string` | 仍是 `keyword`（红） | 与「`true/false/null` 落 constant」不是同一映射（旧为 `string` 桶）；仅把 3 个词改桶会更不一致；测试已锁定它们**不**被顺手改桶 |
| 5 | TOML 侧字面量集合 | 旧 `TOML, also INI` 的字面量是 `\bon\|off\|true\|false\|yes\|no\b`（@2481459），**toml 与 ini 共用** | `TOML_LITERAL_WORDS` 只有 `true/false`（`on/off/yes/no` → plain） | 属**识别覆盖**差异而非分桶问题（`on = yes` 在 TOML 语法里并不合法，扩集合会改变现状语义）；已仅在 INI 侧按旧集合修正分桶 |
| 6 | 编程语言关键字表里的 `true/false/null`（JS/TS/Go/Rust/Java/C、Python 的 `True/False/None`、SQL 的 `NULL/TRUE/FALSE`、`GENERIC_KEYWORDS`） | 旧 hljs 各语法 `keywords.literal`（如 JS `…,literal:'true false null undefined NaN Infinity',built_in:'eval isFinite…'` @2865254/@2865280）→ `.hljs-literal` → constant 桶 | 全部 → `keyword`（红） | **需扩共享 `tokenizeCLike`**：新增 literal 判定分支 + 7 个语言的 literal 表，属状态机扩展；建议单开分片并逐语言给旧 literal 表 |
| 7 | YAML 裸标量整体（`name: quickforge`）与 Setext 纯空白标题行边角 | YAML 裸标量走 `o={…begin:/\S+/}` → `.hljs-string`；Setext 变体 `.+?` 允许**纯空白行**作标题行（旧会开启 section，下划线行因此着色） | YAML 裸标量 → `plain`（正文色）；纯空白行在缩进分支被消费，不进入 Setext 判定 | 前者影响「全部 YAML 值」的可见色（string → 正文色），属独立分片；后者标题文本不可见、仅影响下划线行着色，收益极低 |

### 6.3 `docs/wiki` 同步现状：**已同步**（本次收口完成）

本轮的文档/wiki 同步**已在收口阶段完成**，实际落地三个文件、要点如下：

| 文件 | 实际落地要点（已写入 wiki） |
| --- | --- |
| `docs/wiki/src/README.md`（第 90 行数学段落） | 数学段已改述为「**行中与行首的 `$$…$$` 一样渲染为块级公式**」，与 W2 修复后的 `chat-math.ts` 行为一致（对齐旧 `blockMathDollar` 的 `start` 非空即起块 → `startBlock`）；原先「块级 `$` 行首锚定」的过时说法已删除 |
| `docs/wiki/src/components/README.md`（**两份重复副本都已更新**：`:86` + `:317-319` 与 `:404` + `:635-637` 两处同源段落逐字同步） | ① 聊天代码块标题栏复制按钮改用 `copyCode`（Copy code / 复制代码）恒定 title、复制后图标换 Check 并显示可见 `copiedBang`（Copied! / 已复制！）、**2000ms** 复位；② ⋯ 菜单复制仍属另一对键 `copy`/`copied`（**1200ms** 对勾反馈），两者刻意分开；③ 工具卡代码块（`renderCodeBlock`）统一到同一 2000ms 形态，命令输出（`renderConsoleBlock`）补记 `copyOutput` 恒定 title、可见 `copiedBang`（**1500ms**）与 `data-qf-action="copy-console-output"`；④ `ConsoleScrollArea` 输出区每次 commit 自动置底（复刻旧 `<console-block>.updated()`，含「不区分用户手动上滑」的旧缺陷保留）；⑤ 补记高亮 token 语义与「未注册语言名走保守回退 `tokenizeGeneric`、**不再做旧 `highlightAuto` 式语言猜测**」 |
| `docs/wiki/src/lib/README.md`（`:204-207`） | ① i18n 新增键 `copyCode` / `copyOutput` / `copiedBang` / `consoleBlockLabel`（与消息操作/⋯ 菜单仍在用的 `copy`/`copied` 刻意分开，取值来自旧 pi 英文表与 `piChineseOverrides`）；② `shared.tsx` 条目记录 `ConsoleCopyButton` / `ConsoleScrollArea` 私有组件及其复制时长与每次 commit 置底语义 |

### 6.4 其它未验证 / 遗留清单（登记，不属本轮修复范围）

- **架构/健壮性**（域 E 提出、本轮未改）：① 面板根 `.qf-chat-panel`、composer 父链、控制行 first/last、`button:last-child`、`.qf-scroll-container` 四处**相对/DOM 序锚点**失败即静默（需断言或 `data-*` 锚）；② 消息列表/消息行选择器口径不统一（双写 vs 单写），建议抽公共常量；③ `turn-error-row.ts` 依赖 React 红块类 `.bg-destructive\/10`，类名一变会出现「原红块 + 自建行」双行；④ `data-quickforge-action` → `data-qf-action` 命名空间分裂；⑤ `quickforge-svg-code-block` 类的所属权需确认（W3 已补回规则，但类仍由 React 输出）。
- **行为一致性待裁**：① `enableTerminalCommandActions` 门控在 React 侧是否有等价物**未取证**（装饰层清理逻辑已删）；② 确认旧单测 `tests/frontend/send-stop-button.test.ts:75/133` 断言已与新实现同步（本轮全绿，未改该文件）；③ `process-folding.ts` 空闲帧短路可能让「仅元数据变化（时长/状态）」的组标签滞后（极窄窗口，未实测）。
- **设计债/旧缺陷（保持原样）**：`quickforge-goal-spin` 定义缺失（BASE 前已缺，建议单独立项）；5 个 keyframes 缺 reduced-motion 降级（`migration-dot-pulse`/`waiting-enter`/`waiting-dot`/`ask-breathe`/`ask-enter`）；console 输出区**不区分手动上滑**（旧缺陷保留）；单次点击触发 2 次非幂等 `abort()` POST；zh 下停止按钮 title/aria 仍为英文 `Stop`；20 处 `outline-none` 无聚焦替代的欠账控件（`AgentProfilesPage.tsx:522…640`、`mcp-server-form.tsx:14,16`、`mcp-servers-dialog.tsx:274`、`ScheduledTasksPage.tsx:454/754/788/841/915`、`SharedConversationPage.tsx:220`、`MessageEditor.tsx:399` 思考级别 `<select>`）。
- **构建期生成物未复核**：`.duration-(--quickforge-dur-*)`、`.ease-(--quickforge-ease-out)`、`motion-reduce:transition-none`、`spin/pulse/ping`、`[&::-webkit-scrollbar]:hidden`、`group-focus-visible:bg-muted/40`（后者在新 CSS 出现 2 次但**不是 alive 依据**——Tailwind v4 会扫描 `tests/`/`docs/` 文本，alive 判定必须以旧 CSS 为准）等——本轮已跑 `npm run build`，但**未在新产物上逐条复核**这些规则是否按预期生成。
- **本轮改动文件清单之外**：`feature_list.json`、`progress.md`、`session-handoff.md` 的状态同步与本报告的落地**已在收口阶段完成**（各分片均在报告中声明未改动这些文件；分片过程文档 `docs/reviews/parity-audit-parts/`（17 个 `.md`）亦已清理）。

---

## 7. 附录

### 7.1 旧构建产物证据定位索引（关键 needle → 文件 / 偏移）

偏移口径（**不可跨行比较**）：`B` = 通过 `findstr /o` 得到的**字节偏移**；`C` = 通过 PowerShell `[IO.File]::ReadAllText` + `IndexOf`/`[regex]::Matches().Index` 得到的 **0-based 字符下标**；CSS 侧的 `@NNN` 亦分「0-based 字节偏移」与「0-based 字符偏移」两种表述，均逐行标注来源分片口径。凡同一 needle 在不同分片给出不同偏移而未统一复核者，下表**并列保留**。

| needle / 主题 | 文件 | 偏移与原始片段要点 |
| --- | --- | --- |
| 发送/停止按钮类名切换、`quickforgeSendIcon` | `index-DyE33U-f.js` | `B` @313880 `remove('quickforge-send-button'),o.classList.add('quickforge-stop-button'),o.classList.toggle('quickforge-stop-button--waiting',…)`；@314620 `ve('quickforge-stop-button--waiting'),o.classList.add('quickforge-send-button'),o.dataset.quickforgeSendIcon!=='arrow-up'`；@314086 `quickforgeSendIcon` |
| 停止态 title / aria-label | `index-DyE33U-f.js` | `B` @314020 `title=`Stop``；@314049 `'aria-label','Stop'` |
| 停止态 svg 字面量 | `index-DyE33U-f.js` | `B` `findstr /o` 命中行偏移 345335（minified 长行，**未精确到列**）：`viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6"` |
| pi 发送/停止按钮类集合 `h-8 w-8`、图标包裹层 | `pi-web-ui-B-_rXig1.js` | `B` @1819900（发送 `Jm({variant:'ghost',size:'icon',onClick:this.handleSend,disabled:…,className:'h-8 w-8'})` 与 `children:s`<div style="transform: rotate(-45deg)">${Je(He,'sm')}</div>``）、@1819500（停止 `children:Je(Ge,'sm')`） |
| markdown → `<code-block>` 重写 | `pi-web-ui-B-_rXig1.js` | `B` @2179417（有信息串）/ @2179748（无信息串）；**另一分片口径** @2175921 / @2176252（未统一复核）。片段：`<div class="mt-2"><code-block language="${t}" code="${btoa(unescape(encodeURIComponent(r)))}"></code-block></div>` |
| `<code-block>` 模板 `Copy code` / `showText` | `pi-web-ui-B-_rXig1.js` | `B` @3144743 `title="${L('Copy code')}"`、@3144758 `.showText=${!0}`；`C`（W12 口径）@3144731；元素注册 `i('code-block')` @3145175（`B`）/@3145168（`C`）；`<pre>` class 串 @3144997 |
| `<copy-button>` 类（title 恒定、2000ms、可见文本） | `pi-web-ui-B-_rXig1.js` | `B` @3072860 `this.title=L('Copy')`（constructor 唯一赋值）、@3073076 `setTimeout(()=>{this.copied=!1},2e3)`、@3073140 `${this.copied?Je(Ce,'sm'):Je(Ae,'sm')}` + `${this.copied&&this.showText?s`<span>${L('Copied!')}</span>`:''}`；注册 @3073612/@3073400；`C` @3072894 / @3105300 + @3106121（W1 口径，未统一） |
| `<console-block>` 类（1500ms / `Copy output` / console 标签 / `updated()` 置底） | `pi-web-ui-B-_rXig1.js` | `B` @3178138 `setTimeout(()=>{this.copied=!1},1500)`、@3178600 模板、@3179045 `Copy output`、@3179146 `Copied!`；`C` ~3145900（W11）/ ~3145903（W12）`updated(){let e=this.querySelector('.console-scroll');e&&(e.scrollTop=e.scrollHeight)}`；注册 @3147061（`C`） |
| 旧 i18n 注入/覆盖词典（`console` / `Copy output` / `Copied!`） | `pi-web-ui-B-_rXig1.js` | `B` @429824 / @429842 / @429870；pi 内置 en 表 @535-@560（`Copy code` @536/@548、`Copied!` @560/@559）；德语表 @880-@908、@439092/@439110/@439143 |
| 数学扩展（inline/block `$`、`\(`/`\[`） | `pi-web-ui-B-_rXig1.js` | `B` @2174036–2175460 区间（4 个扩展的 `use({extensions:[…]})`）；`blockMathDollar` 的 `start(e){return e.indexOf('$')}` 与 `/^\$\$([^$]+?)\$\$/s`、`text:t[1].trim()` |
| 聊天自动滚动求值顺序与截图 | `pi-web-ui-B-_rXig1.js` | `B` 1866673 起：`_autoScroll`=1866683、`_handleScroll`=1866750、`setAutoScroll`=1867256、`ResizeObserver`=1867707（赋值点 1867791）、`sendMessage` 重开=1869874 |
| 应用层近底带 80 / 500ms 意图 / jump 120 | `ChatPanelHost-kh5gPhZf.js` | `B` 51978（`d=()=>e.querySelector('agent-interface .overflow-y-auto')`、`f=e=>e.scrollHeight-e.scrollTop-e.clientHeight<=80`、`m=()=>{…window.performance.now()-e<=500}`；另一分片给 51939）、88069（jump settled `<=120&&E.enable()`；另一分片给 88030） |
| 回到底部按钮 280/120/900 与 jump 逻辑 | `index-DyE33U-f.js` | `B` 581945（`var cy=280,ly=120,uy=900`、迟滞 `u(a?e>ly:e>cy)`）、583278-583304（`<=1` 或 reduced-motion 即时、否则 smooth + wheel 打断 + `scrollend` + 900ms 兜底） |
| 旧 CSS 主样式表整体 | `index-B1G0LqYR.css` | 376,928 字节 / 4 行；样式载荷位于第 3 行，起点字节偏移 **132**，行长 376,796；仅 3 个换行 → 只能按偏移/正则定位 |
| `--syntax-*` 亮/暗定义 | `index-B1G0LqYR.css` | 亮 `@2122`（`C`，`@2122 = :root{`）；暗 `@2689`（`C`）；主题色另见 `:root` @38298 / `.dark` @40216（`C`） |
| `.hljs-*` 规则全量 14 条 | `index-B1G0LqYR.css` | `C` @3250（keyword 组）、@3409（title/function）、@3520（attr/literal/number/selector-attr/-class/-id）、@3703（regexp/string）、@3780（built_in/symbol）、@3837（comment/code/formula）、@3904（name/quote/selector-tag/selector-pseudo）、@3992（subst）、@4036（section）、@4094（bullet）、@4132（emphasis）、@4197（strong）、@4258（addition）、@4348（deletion）；`\.hljs[^\s,{>]*` 匹配 43 处 → 38 个去重类；**无** `.hljs-link`、**无** `.hljs-punctuation`、**无**裸 `.hljs{}` |
| `--color-text-primary` 未定义引用 | `index-B1G0LqYR.css` | `C` @4014（`.hljs-subst`）、@4157（`.hljs-emphasis`）、@4220（`.hljs-strong`）；声明 0 处 |
| 行内 code 规则 | `index-B1G0LqYR.css` | `C` @34217 `code:not(.hljs){background:var(--muted);…}` |
| 用户气泡橙渐变 | `index-B1G0LqYR.css` | `C` @134237：`linear-gradient(135deg,#d94f001f,#ff6b001f,#d4a5001f)`、`border:1px solid #ff6b0040` |
| 时长 token 定义与 Tailwind 时长工具类 | `index-B1G0LqYR.css` | `C` @139606（`.12s`）/@139633（`.18s`）/@139660（`.28s`）/@139687（`.14s`）/@139714（`cubic-bezier(.2,0,0,1)`）；工具类 @122120-122457（`.duration-(--quickforge-dur-base/exit/fast)`）、@122724-122816（`.ease-(--quickforge-ease-out)`） |
| focus 类 alive / dead 证据 | `index-B1G0LqYR.css` | 字节级计数：`.focus-visible\:border-ring` 1 @68401（`border-color:var(--ring)`）、`focus-visible\:ring-2` 1、`focus-visible\:outline-none` 1、`focus-visible\:ring-ring` 3、`focus-visible\:ring-1` 1、`focus-visible\:opacity-100` 1、`focus\:ring-2` 1、`focus\:ring-ring` 1、`focus\:shadow-quickforge` 1、`.outline-none` 3 @123206、`.focus\:outline-none` 1 @68331、裸 `focus-visible\:ring` 8；`focus-visible\:border-primary` / `focus\:border-primary` / `focus\:border-ring` **0** |
| 设置下拉菜单 / switch / info-tip 规则 | `index-B1G0LqYR.css` | `C` `.quickforge-settings-select-menu` @157671/157908/158011/158136/158234（无 animation/transform-origin）；`quickforge-settings-switch input:focus-visible` @181388/@181520/@181645；`quickforge-info-tip-popover` @202911… |
| 旧 JS 分片归属（按需检索） | `package-dist/dist/assets/*.js` | `findstr /s /m /c:"quickforge-settings-select-menu"` → 仅 `SettingsWorkspacePage-DQoP0SXd.js`；`quickforge-settings-switch` → `AgentProfilesPage-BbzcXfzb.js`、`PluginsPage-CD2rOque.js`、`SettingsWorkspacePage-DQoP0SXd.js`、`skills-dialog-BGJoQHoj.js`；`quickforge-info-tip` 8 命中（首 @220114，popover @220381）；`quickforge-dialog-panel-in` 5 命中（首 @205978） |
| 版本差项（早于 BASE 的产物内容） | `index-B1G0LqYR.css` | `C` @353129 `@keyframes quickforge-goal-spin{to{transform:rotate(360deg)}}` + 使用点 @347822；`.quickforge-goal-button--primary/ghost/danger:hover`、`.quickforge-goal-expand:hover` 位于 @~35 万区；`git grep` 在 `3e10f58` 全树 0 命中（定义曾存在于 `73dd3f8:src/index.css:6985`、`ace9930`） |
| SVG 代码块工具栏结构规则 | `index-B1G0LqYR.css` | `C` @200479 `.quickforge-svg-code-block>div:first-child>div:first-child.quickforge-svg-code-toolbar-floating{z-index:2;…}` |
| 旧 hljs 语法文本（分桶判定依据） | `pi-web-ui-B-_rXig1.js` | `C` Markdown `name:'Markdown'` @2340571（另 @2339299 = `@2339299` 粒度证据）、CSS @2335049 / @3117104、YAML @2999671（`let t='true false yes no null'` @2997930、`keywords:{literal:t}` @2999515）、JSON @2565639 / @3124876（`r=['true','false','null']` @2565560、`keywords:{literal:r}` @2565669）、TOML/INI @2481159（字面量 @2481459、alias `toml` @2481852）、`registerLanguage('yaml',…)` @3071778、`('markdown',…)` @3067218、`('ini',Jge())` @3068650 |
| 旧语言回退与 hljs 版本 | `pi-web-ui-B-_rXig1.js` | `C` @3144283 `this.language && A1.getLanguage(this.language) ? A1.highlight(e,{language:this.language}).value : A1.highlightAuto(e).value`；`let Fe='11.11.1'` @2199xxx（版本）；`registerLanguage(` 共 201 处（@3065788–3072427）；`var A1=e(s1()).default` @3103654；编译期细节 `new RegExp(p(t),'m'+…` @2196783、`end=/\B|\b/` @2198858、matcher 顺序 @2198212 |
| 旧 pi 文档抽取（无上限） | `pi-web-ui-B-_rXig1.js` | `C` @1790500–1793600（PDF `for(let e=1;e<=n.numPages;e++)`、`JSZip` 解析、`TextDecoder().decode(n)`） |
| 旧 `.user-message-container` hover 值 | `index-B1G0LqYR.css` | `C` @134237 区域：`.2s` transition（同值 `0.2s`） |

### 7.2 旧 token / 配色值表

**（1）旧 `--syntax-*` 13 组（亮 `@2122` / 暗 `@2689`，`C` 口径）与新 `--qf-hl-*` 对位**

| 旧变量 | 亮色 | 暗色 | 新变量（`src/index.css:8035-8063`） | 说明 |
| --- | --- | --- | --- | --- |
| `--syntax-keyword` | `oklch(57.7% .245 27.325)` | `oklch(69.8% .159 21.174)` | `--qf-hl-keyword` | 数值一致 |
| `--syntax-entity` | `oklch(51.1% .136 307.715)` | `oklch(79.2% .124 307.715)` | `--qf-hl-function` | 数值一致 |
| `--syntax-constant` | `oklch(43.5% .141 237.016)` | `oklch(73.2% .137 237.016)` | `--qf-hl-number` / `--qf-hl-property` / `--qf-hl-attr` | 三者同取旧 constant 值（W3/W10 据此复用挂桶） |
| `--syntax-string` | `oklch(29.6% .103 244.038)` | `oklch(78.6% .08 237.016)` | `--qf-hl-string` | 数值一致 |
| `--syntax-variable` | `oklch(60.8% .178 54.291)` | `oklch(74% .141 54.291)` | `--qf-hl-builtin` | 数值一致 |
| `--syntax-comment` | `oklch(54% .019 247.858)` | `oklch(62.6% .025 247.858)` | `--qf-hl-comment`（另 W3 新增 `--qf-hl-code` 取其值） | 数值一致 |
| `--syntax-tag` | `oklch(40.3% .111 145.348)` | `oklch(81.2% .159 145.348)` | `--qf-hl-tag`（另 W3 新增 `--qf-hl-quote` 取其值） | 数值一致 |
| `--syntax-heading` | `oklch(43.5% .141 237.016)` | `oklch(52.3% .181 237.016)` | **新增** `--qf-hl-heading`（W3） | 旧 `@4036` 另带 `font-weight:700` |
| `--syntax-list` | `oklch(53.7% .108 88.766)` | `oklch(86.6% .141 88.766)` | **新增** `--qf-hl-list`（W3） | 旧 `@4094` `.hljs-bullet` |
| `--syntax-addition-bg` | `oklch(98.4% .029 166.113)` | `oklch(18.8% .06 166.113)` | `--qf-hl-addition-bg` | 与 fg 成对 |
| `--syntax-addition-fg` | `oklch(40.3% .111 145.348)` | `oklch(87% .147 145.348)` | `--qf-hl-addition-fg` | 数值一致 |
| `--syntax-deletion-bg` | `oklch(98.1% .025 17.672)` | `oklch(23.3% .129 17.672)` | `--qf-hl-deletion-bg` | 与 fg 成对 |
| `--syntax-deletion-fg` | `oklch(43.1% .183 27.522)` | `oklch(92% .067 17.672)` | `--qf-hl-deletion-fg` | 数值一致 |

**（2）旧 hljs 规则 → 语义桶 → 新 token 对照（全量 14 条规则）**

| 旧偏移 | 旧规则（原文要点） | 语义 | 旧界面是否 alive | 新 token（W3/W10 后） |
| --- | --- | --- | --- | --- |
| `@3250` | `.hljs-doctag,.hljs-keyword,.hljs-meta .hljs-keyword,.hljs-template-tag,.hljs-template-variable,.hljs-type,.hljs-variable.language_{color:var(--syntax-keyword)}` | keyword | 是 | `keyword` |
| `@3409` | `.hljs-title,.hljs-title.class_,…,.hljs-title.function_{color:var(--syntax-entity)}` | function | 是 | `function` |
| `@3520` | `.hljs-attr,.hljs-attribute,.hljs-literal,.hljs-meta,.hljs-number,.hljs-operator,.hljs-variable,.hljs-selector-attr,.hljs-selector-class,.hljs-selector-id{color:var(--syntax-constant)}` | constant | 是 | `number`/`property`/`attr`（`selector-class/-id` 由 W10 归入 `attr`） |
| `@3703` | `.hljs-regexp,.hljs-string,.hljs-meta .hljs-string{color:var(--syntax-string)}` | string | 是 | `string` |
| `@3780` | `.hljs-built_in,.hljs-symbol{color:var(--syntax-variable)}` | builtin | 是 | `builtin`（CSS `name(` 由 W10 归入） |
| `@3837` | `.hljs-comment,.hljs-code,.hljs-formula{color:var(--syntax-comment)}` | comment / code / formula | `comment`/`code` 是；`formula` 几乎不可达 | `comment`；W3 新增 `code`；`formula` 不产出（见 §6.2） |
| `@3904` | `.hljs-name,.hljs-quote,.hljs-selector-tag,.hljs-selector-pseudo{color:var(--syntax-tag)}` | tag | 是 | `tag`（`quote` 由 W3 归入新 token、`selector-pseudo` 由 W3/W10 映射为 `tag`） |
| `@3992` | `.hljs-subst{color:var(--color-text-primary)}` | — | **否**（变量未定义 → 继承正文色） | 不补（死规则） |
| `@4036` | `.hljs-section{color:var(--syntax-heading);font-weight:700}` | heading + 粗体 | 是 | `heading` + `font-weight:700`（W3；Setext 由 W10 覆盖） |
| `@4094` | `.hljs-bullet{color:var(--syntax-list)}` | list | 是 | `list`（W3；YAML bullet 由 W3、字面量分桶由 W10） |
| `@4132` | `.hljs-emphasis{color:var(--color-text-primary);font-style:italic}` | 斜体 | 是（仅字形生效） | `emphasis`（只声明字形） |
| `@4197` | `.hljs-strong{color:var(--color-text-primary);font-weight:700}` | 粗体 | 是（仅字形生效） | `strong`（只声明字重） |
| `@4258` | `.hljs-addition{color:var(--syntax-addition-fg);background-color:var(--syntax-addition-bg)}` | diff+ | 是 | `addition` |
| `@4348` | `.hljs-deletion{color:var(--syntax-deletion-fg);background-color:var(--syntax-deletion-bg)}` | diff− | 是 | `deletion` |

**（3）时长 / 缓动 / 尺寸 / 阴影 / z-index 关键值**

| 项 | 旧值（`index-B1G0LqYR.css`） | 新值（`src/index.css`） | 判定 |
| --- | --- | --- | --- |
| `--quickforge-dur-fast` / `-base` / `-slow` / `-exit` | `@139606` `.12s` / `@139633` `.18s` / `@139660` `.28s` / `@139687` `.14s` | `120ms` / `180ms` / `280ms` / `140ms`（L328-331） | 等价（slow/exit 两代均无 CSS 使用） |
| `--quickforge-ease-out` | `@139714` `cubic-bezier(.2, 0, 0, 1)` | `cubic-bezier(0.2, 0, 0, 1)`（L332） | 等价（真实使用 13 处一一对应） |
| 裸时长行数 | 旧源 147 行 | 新源 153 行（剔注释/定义 146 行） | 数量级沿用；仅 6 行净新增（见 §2.4） |
| `--text-sm` | Tailwind 默认 `@35649` `.875rem`；应用覆盖 `@139168` `--text-sm:1rem;--text-sm--line-height:calc(20 / 14)` | `src/index.css:305-306` 同覆盖（unlayered，文本序在后） | 等价（1rem 生效） |
| `--radius` | `@39500` 附近 `:root{--radius:.625rem}`；`@46170` `@theme{--radius:.5rem}` | `L160 .625rem`（unlayered 生效）+ `L229 @theme .5rem` | 等价 |
| `--spacing` / `--tracking-normal` | `@39640` `.25rem` / `0em` | `L170` / `L169` | 等价（影响全量 `calc(var(--spacing,0.25rem)*n)`） |
| `--shadow-quickforge` | `@46170` `0 10px 26px -18px #0f172a7a`（α≈47.8%） | `L231` `rgb(15 23 42 / 0.48)` | Δα≈0.2%（压缩取整） |
| `--shadow-2xs…2xl` | `#0000000d`（α≈5.1%）/ `#0000001a`（α≈10.2%）/ `#00000040`（α≈25.1%）等 hex | `hsl(0 0% 0% / 0.05)` / `…0.1` / `…0.25`（L161-168） | Δα≤0.2%（形式差） |
| z-index 最高三档与合并项 | 9999（settings-select-menu @157703 / info-tip-popover @202939）、10000（svg-code-lightbox @201502、agent-access-menu+thinking-menu @259988、subagent-running-menu @263449、model-menu @274487、model-sheet-backdrop @277861）、**10001**（context-usage-tip @268052） | `L1240`/`L2738` 9999、`L2678`/`L4767-4770`/`L4872`/`L5124`/`L5214` 10000、`L4982` **10001** | 逐值一致（唯一缺失为 pi 结构规则 `@200479`） |
| 代码高亮调色板变量总数 | 13（亮）+ 13（暗） | W3 前 11×2；W3 后 15×2（新增 heading/list/code/quote） | 回归-已修（见 §3 修复项 3） |

### 7.3 报告自洽性说明

- 本报告所有「新证据(修复前)」行号取自各分片取证时点的工作区；本轮修复后行号可能小幅位移（尤其 `src/lib/i18n.ts`、`src/lib/tool-renderers/shared.tsx`、`src/lib/code-highlight.ts`、`src/components/chat/surface/CodeBlock.tsx`），§3 已同时标注「落地时点行号」与「收口后行号」两种口径。
- §2 的 5 个域表、§3 的 7 个修复项、§4 的 17 条保留项互为交叉引用；§2 判定为「回归-已修」的条目全部能在 §3 找到对应修复项（域 A 无已修项；域 B 9 项 → 修复项 1/2/3/5/6/7；域 D 2 项 → 修复项 3；域 E 1 项 → 修复项 3）。
- 凡「不可考证」条目（§2 共 7 条、§4 中另有 3 条按不可考证口径保留）均未做任何改动，并逐条在 §6 登记需要补取的证据类型。
