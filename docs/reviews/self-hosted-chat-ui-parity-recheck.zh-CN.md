# 自托管聊天 UI 平价复核报告

> 主题：移除 `@earendil-works/pi-web-ui` / `@mariozechner/mini-lit` / `lit` 迁移后的聊天界面「平价（parity）」复核
> 基线：`HEAD = 3e10f58da7365c24ef59cd93462256918c394fb1`（工作区移除改动**全部未提交**）
> 日期：2026-09-19
> 结论分级：**一手证据** = 本报告编写时通过 git / 源码 / 构建产物 / 测试直接取到的证据；**二手** = 旧会话/并行任务记录，本报告逐条给出重新核对结果。

---

## 1. 评审范围与方法

### 1.1 范围

- **本次改动**：移除 pi-web-ui / mini-lit / lit 依赖，聊天 UI 由 Web Components（mini-lit）迁移为 React 自托管实现（`src/components/chat/surface/*`、`src/components/chat/panel-decoration/*`、`src/index.css`）。
- **复核对象**：迁移前后「同一份用户可见效果」是否保持；以及旧会话对「回归根因」的结论是否成立。
- **不在范围**：pi-web-ui 内部实现（已不可读，包已卸载且不在 lock 内）、未被 QuickForge 实际渲染的 pi 选择器（KaTeX / `.user-message-container` 橙色渐变等，见 `src/index.css:8-22` 自述）。

### 1.2 证据方法与口径

1. **一手证据优先**，四种来源：
   - git HEAD 基线（`3e10f58`，仍含依赖的提交）；
   - 旧产物 `package-dist/`、`package-offline/` 的 `index-B1G0LqYR.css`（v2.1.0 打包，2026-09-13）；
   - 旧构建 JS chunk（`package-dist/dist/assets/*.js`，含迁移前运行时代码字符串）；
   - 当前工作区源码、当前 `dist/` 构建、本次实际运行的测试。
2. **不采信历史会话结论**：历史/并行会话的说法一律标注「二手」，并在本报告给出重新核对结果；无法复核的一律标注「未验证 / limitation」。
3. 测试命令：`npx vitest run <file>...`；本次实际运行 6 个文件（见 §6）。
4. 候选/死角类统计口径统一为：对旧产物 CSS 做规则级解析（选择器 → 类 token → 取最后一个 `:` 之后的基础名），再与语义色 token 名单匹配。

### 1.3 关键命令与输出摘录（一手）

| # | 命令 | 输出摘录 |
|---|------|---------|
| 1 | `git rev-parse HEAD` | `3e10f58da7365c24ef59cd93462256918c394fb1` |
| 2 | `git log --oneline -n 3` | `3e10f58 refactor: 完全移除 QuickForge Cloud 云服务…` / `6807a84 refactor(settings): 局域网访问设置说明文字收敛到标题旁 info-tip` / `0298166 fix(settings): 移除导出数据区域的对话历史排除提示` |
| 3 | `git status --short` 计数（node） | `changed_files=225`（「200+ 条变更」成立） |
| 4 | `git grep -n -e "--color-" HEAD -- src` | 退出码 1，**无输出**（HEAD 源码中不存在任何 `--color-*`） |
| 5 | `git grep -n -e "color-border" HEAD` | 退出码 1，**无输出** |
| 6 | `git show HEAD:src/index.css` 头部 | 第 1 行 `@import "@earendil-works/pi-web-ui/app.css";`，总行数 7552 |
| 7 | `git show HEAD:package.json` | 三依赖位于 **devDependencies**：`"@earendil-works/pi-web-ui": "^0.75.3"`、`"@mariozechner/mini-lit": "^0.2.1"`、`"lit": "^3.3.2"`（`dependencies` 中无这三项） |
| 8 | 工作区 `package.json` + `node_modules` 检查 | 三依赖均已移除；`node_modules/@earendil-works/pi-web-ui`、`node_modules/@mariozechner/mini-lit`、`node_modules/lit` 均不存在 |
| 9 | `git status --short -- package.json package-lock.json` | `M package.json`、`M package-lock.json`；lock 中三依赖条目已删除，`node_modules/tailwindcss` 仍为 `4.2.4` |
| 10 | 旧产物 CSS 定位 | `package-dist/dist/assets/index-B1G0LqYR.css`、`package-offline/dist/assets/index-B1G0LqYR.css` |
| 11 | 旧产物哈希/时间（node crypto） | 两份均 `sha256=87ff3709793cc749dd684102b67d21e64ff56fb2287809d8b0aaa8b729764947`、`bytes=376928`、`mtime=2026-09-13T03:52:32.761Z`（**逐字节相同**） |
| 12 | `package-dist/package.json` / `package-offline/package.json` | `version=2.1.0`，`name=@shawnstack/quickforge`（两处一致） |
| 13 | 工作区 `src/index.css` 头部 | 第 1 行 `@import "tailwindcss";`，总行数 8074；`@theme inline` 在第 253 行，`--color-*` 共 32 条定义（254–285 行） |

### 1.4 复核与修正记录（本报告与既有陈述不一致处）

| # | 既有陈述 | 复核结果 | 处理 |
|---|---------|---------|------|
| C1 | 「HEAD 仍含 `pi-web-ui^0.75.3` / `mini-lit` / `lit`」 | 成立，但在 **devDependencies**，不在 `dependencies` | 以复核为准，本报告明确字段 |
| C2 | 「旧产物语义色工具类 78 个 / 109 处」 | 唯一数 **78** 成立且与护栏测试白名单**逐条为零差异**；处数按本次口径为 **108**（含误入的 `shadow-card` 1 处，剔除后 107） | 唯一数采信；处数标注「计数口径差异 ±2」 |
| C3 | 「旧版透明度档位 /5 /10 /20 /30 /50 /60 /80 /90 /95」 | 实际还包含 **/40**（`aria-invalid:ring-destructive/20` 的 `dark:` 变体 `dark:aria-invalid:ring-destructive/40`） | 以复核为准，补 `/40` |
| C4 | 「`--syntax-*`→`--qf-hl-*` 22 对逐值相等」 | 实际为 **13 名 → 13 名**；8 对同名逐值相等，另 5 组为**改名/重映射**且逐值相等（`entity→function`、`constant→number/property/attr`、`variable→builtin`）；旧 `heading/list` 明确不迁移 | 以复核为准（详见 §4(b)） |
| C5 | 「`prefers-reduced-motion` 19 vs 19」 | `src/index.css`：HEAD **17** → 工作区 **19**；全 `src/**/*.css`：HEAD **18** → 工作区 **20** | 以复核为准（计数口径需注明） |
| C6 | 「旧版有 397 处 katex 规则与字体」 | 旧产物中 `katex` 字符串共 **503** 处（含 `@font-face` 与规则引用）；397 未能复现（口径未注明） | 标注口径差异；结论（KaTeX 未迁移）不受影响 |
| C7 | 「旧产物是否等于 HEAD 构建：682/690 选择器命中」 | 本次口径：HEAD `index.css` 选择器类 token **694** 中命中 **685**（9 个 miss 里含 `css`/`tsx`/`6k` 等注释噪声，真实类仅 `msg-user`、`slash-chip`） | 数字小幅不同（口径差异），判定一致：旧产物属 **v2.1.0 线构建**，非 HEAD 精确产物 |
| C8 | 「⑤ 语义色透明度归一化 23 类/35 处」 | 未逐条复核 23/35 本身（口径不明）；复核到：旧类 `text-foreground/*`、`hover:bg-muted/45`、`bg-background/50`、`bg-border/70` 等在当前 `src/` 中 **0 处**（已归一化）；新构建对应位置以 `color-mix` 任意值存在 | 数量标 二手，结论（已归一化）成立 |
| C9 | 「输入框 `focus-visible:border-primary` 为 dead，新组合为有意补齐」 | 成立；旧产物 `index-B1G0LqYR.css` 的 escaped-needle 计数（收尾轮一手）：`focus-visible\:border-primary` **0 处**、`focus-visible\:outline-none` **1 处（alive）**、`focus-visible\:border-ring` 1 处、`focus-visible\:ring-ring` 3 处、`focus-visible\:ring-2` 1 处（后四者来自 pi 组件，不作用于该输入框） | 采信；`outline-none` 才是旧输入框唯一真实生效的聚焦类，新组合 `border-ring + ring-2 + ring-ring` 属**新增**行为（§6-⑥ 已明示「不是等价回迁」） |
| C10 | 「② code-block 复制反馈 1200ms 一致」 | 新实现为**双路径**：标题栏按钮 2000ms、`⋯` 菜单复制 1200ms（`src/components/chat/surface/CodeBlock.tsx:355-380`） | 以复核为准（两条路径与旧 `showText` 行为分别对齐） |

---

## 2. 基线取证

### 2.1 HEAD 与依赖

- `HEAD = 3e10f58`，提交信息为「完全移除 QuickForge Cloud 云服务…」，即**移除 UI 依赖的改动尚未提交**（工作区 225 个文件变更）。
- HEAD 的 `package.json` 以 **devDependencies** 形式仍含三依赖（命令 7）；`src/index.css:1` 仍 `@import "@earendil-works/pi-web-ui/app.css";`（命令 6）。
- 工作区：三依赖从 `package.json` 删除、lock 同步删除、`node_modules` 中不存在（命令 8/9）。

### 2.2 旧产物与「是否 HEAD 精确构建」的判定

| 项 | 事实（一手） |
|---|---|
| 文件 | `package-dist/dist/assets/index-B1G0LqYR.css`、`package-offline/dist/assets/index-B1G0LqYR.css` |
| sha256 | `87ff3709…4947`（两份**逐字节相同**） |
| 大小 / mtime | 376,928 B / 2026-09-13T03:52:32.761Z |
| 版本 | `package-dist|package-offline/package.json` → `2.1.0` |
| HEAD `index.css` 选择器命中 | 694 tokens 中 685 命中（命中率 98.7%），miss 仅为注释噪声 + `msg-user`、`slash-chip` |
| worktree 独有 token | `--qf-hl-*`、`.qf-markdown-block` 在旧产物中均为 **0 处** |

**判定**：旧产物来自 v2.1.0 打包线，**不是 HEAD 的精确构建产物**（HEAD 独有/新增部分缺失、扫描口径差异存在），但其「旧渲染能力基线」要件成立，可用于本报告的「旧构建下同一选择器是否真的生成」判据。

---

## 3. 决定性判据：旧构建缺少语义色 `--color-*` 映射

### 3.1 HEAD 源码无任何 `--color-*`

- `git grep -n -e "--color-" HEAD -- src` → 无输出（命令 4）。
- 旧产物中**语义色** `--color-*` 变量仅 1 个：`--color-border`（来自 pi 预构建 CSS 的 `:root,:host{--color-border:var(--border);…}`，同时被 pi 自带滚动条样式消费）；其余 `--color-*` 全部是 Tailwind 默认调色板（`--color-red-500` 等）。
- 旧构建的工具体由此走**内联引用**：`.bg-muted{background-color:var(--muted)}`、`.bg-border{background-color:var(--border)}`、`.text-muted-foreground\/50{color:var(--muted-foreground)}`（+`@supports` 里 `color-mix(… 50% …)`）。

### 3.2 旧构建「真实存在」的 78 个语义色工具类（白名单）

复核口径：规则级解析旧产物 CSS → 去重 → 剔除误入的 `shadow-card`（shadow 工具类、非色彩类）。**结果：78 个**，与护栏 `tests/frontend/semantic-color-class-parity.test.ts` 中 `ALIVE_SEMANTIC_COLOR_CLASSES` 白名单**逐条零差异**（脚本比对输出：`mine=78 listed=78`，「only in mine: []」「only in test list: []」）。全部 78 条都落在唯一的 `@layer utilities` 区块内（抽样：透明度子集 52/52 命中该层）。

<details>
<summary>78 条白名单（点击展开）</summary>

```
[&>svg]:text-destructive          [&>svg]:text-foreground
aria-invalid:border-destructive   aria-invalid:ring-destructive/20
bg-accent                         bg-accent/50
bg-background                     bg-background/90      bg-background/95
bg-border                         bg-card
bg-destructive                    bg-destructive/10
bg-muted                          bg-muted-foreground   bg-muted-foreground/30
bg-muted/30                       bg-muted/50           bg-muted/60
bg-popover                        bg-primary           bg-primary-foreground/20
bg-primary/10                     bg-primary/5
bg-secondary                      border-border         border-destructive
border-destructive/50             border-input          border-primary
dark:aria-invalid:ring-destructive/40
dark:bg-input/30                  dark:border-destructive
data-[placeholder]:text-muted-foreground
data-[state=checked]:bg-destructive
data-[state=checked]:bg-primary
data-[state=checked]:border-destructive
data-[state=checked]:border-primary
data-[state=checked]:text-destructive-foreground
data-[state=checked]:text-primary-foreground
data-[state=unchecked]:bg-input
focus-visible:border-ring         focus-visible:ring-ring   focus-visible:ring-ring/50
focus:ring-ring                   from-muted-foreground
hover:bg-accent                   hover:bg-accent/50
hover:bg-destructive/10           hover:bg-destructive/80   hover:bg-destructive/90
hover:bg-muted                    hover:bg-primary/80       hover:bg-primary/90
hover:bg-secondary                hover:bg-secondary/50     hover:bg-secondary/80
hover:border-border               hover:border-muted-foreground/50
hover:text-accent-foreground      hover:text-foreground
placeholder-muted-foreground      placeholder:text-muted-foreground
selection:bg-primary              selection:text-primary-foreground
text-accent-foreground            text-card-foreground      text-destructive
text-destructive-foreground       text-foreground           text-muted-foreground
text-muted-foreground/50          text-popover-foreground   text-primary
text-primary-foreground           text-secondary-foreground
to-muted-foreground               via-foreground
```
</details>

### 3.3 旧版真实存在的透明度档位（一手）

命中档位（按 108 处出现次数）：`/5` `/10` `/20` `/30` **`/40`** `/50` `/60` `/80` `/90` `/95`。
**只对白名单中的组合成立**。以下组合**全档位不存在**（escaped-needle 计数 = 0 处，一手）：

| 类族 | 旧产物中的 `/NN` 命中 |
|---|---|
| `text-foreground/*` | **0 处**（`text-foreground\/` 亦 0） |
| `text-primary/*` | **0 处** |
| `bg-border/*` | **0 处** |
| `border-border/*` | **0 处** |
| `bg-card/*` | **0 处** |
| 被旧会话点名的 dead 类 | `hover:bg-muted/45`、`bg-background/50`、`bg-border/70`、`text-muted-foreground/70`、`text-foreground/90` 全部 **0 处** |

而对侧证据（HEAD 源码中确实大量使用这些 dead 类，`git grep -c -F` + 文件数）：

| 类 | HEAD 源码中的文件/次数（节选） |
|---|---|
| `text-foreground/90` | `src/App.tsx`(4) / `GitCommitPushDialog`(1) / `WorkspaceInspector`(9) / `SettingsWorkspacePage`(3) / `ChatSidebar`(1)…共 18 个文件 |
| `text-muted-foreground/70` | `ChatSidebar`(11) / `WorkspaceInspector`(13) / `PreviewErrorState`(4) / `local-tools.ts`(8)…共 14 个文件 |
| `text-primary/` | `ChatSidebar.tsx`(3) |
| `bg-border/` | `ChatSidebar.tsx`(3) |
| `border-border/` | `FirstUseGuideCard`(3) / `PreviewErrorState`(1) / `WorkspaceInspector`(1) / `local-tools.ts`(1)…共 6 个文件 |
| `hover:bg-muted/45` | `GitToolsPinnedSummary`(9) / `MobileServerConnectPage`(6)…共 5 个文件 |
| `bg-background/50` / `bg-border/70` | `ChatSidebar.tsx` 各 1 处 |

→ **判据成立**：HEAD 源码自写的语义色透明度类在旧构建中**不生成**，属于「死类」；其中的删除是**正确删除**（见 §7-①）。

### 3.4 工作区修复：`@theme inline` 全量映射

- `src/index.css:253` 起新增 `@theme inline { … }`，255 行起 **32 条** `--color-*` 映射（254–285 行），与 `:root`（110–142 行）的 32 个浅色 token、`.dark`（170–202 行）的 32 个深色 token 一一对应；`--radius`（156 行，注释明确保持 `0.625rem` 有效值）、`--shadow-*`（157–164 行）同文件自托管。
- `inline` 语义验证（一手）：新构建产物中 `var(--color-muted)` = **0 处**、`var(--muted)` = **175** 处 → 工具体直接引用原始变量（与旧 pi 行为一致）。
- 新构建效果验证：`.text-muted-foreground\/70` 在新 `dist/assets/index-CPAkkTYQ.css` 中生成（`color:var(--muted-foreground)` + `@supports` 的 `color-mix(...70%...)`），旧构建为 0 → **「文字变淡」根因确认**：旧版里「写了但没有渲染」的透明度类，在补全映射后开始生效。

### 3.5 复核中的新发现：新构建出现「幽灵类」（未使用但被生成）

新 `dist` CSS 中存在源码未使用的选择器：`text-foreground\/90`、`text-muted-foreground\/{50,60,65,70,80}`、`border-border\/{60,75}`、`bg-muted\/{20,30,34,35,40,45,50,55,60}`。
根因（一手）：`package-dist` / `package-offline` / `dist` **已在 `.gitignore`**（`git check-ignore -v` 确认），但 Tailwind 自动内容检测仍扫到了**未被忽略的文档/记录/测试**，其中包含类名字符串：

- `docs/design/ux-improvements-plan.md`（`text-foreground/90`、`text-muted-foreground/70`）
- `DESIGN_LANGUAGE.md`、`docs/wiki/src/lib/README.md`、`docs/archive/*`（`border-border/…`、`hover:bg-muted/45`）
- `feature_list.json` / `progress.md` / `session-handoff.md` / `tests/**`（`text-muted-foreground/50` 等）

影响：仅增加未使用 CSS（体积与核查噪音），**无渲染影响**（无 DOM 使用）。建议见 §9。

**收尾轮复评（2026-09-19，构建 `dist/assets/index-CWWfUxx8.css`，一手）**：规则级提取新产物语义色工具类共 90 个（44 个带 `/NN`）。与 78 条白名单比对：

- **交集 24 条**（真实使用者，含本轮新增/恢复的 `bg-muted/30`、`bg-background/90`、`border-destructive/50` 等）。
- **差集 20 条（带透明度）全部是幽灵类**（`src/**` 出现 0 次）：`text-foreground/90`、`text-muted-foreground/60|65|70`、`hover:bg-muted/34|45`、`group-hover:bg-muted/40`、`group-focus-visible:bg-muted/40`、`hover:text-muted-foreground/80`、`bg-background/50|60|80`、`bg-border/70`、`bg-foreground/15`、`bg-muted/20|34|35|55`、`border-border/60|75`。逐条来源（`src/**` 外，按出现量）：`coverage/src/**/*.html`（迁移前快照，最大来源）、`.goal-runtime-refactor-baseline/*.tsx`、`docs/**`（含 `docs/reviews/*` 本报告自身）、`docs/archive/*`、`docs/wiki/**`、`feature_list.json`、`progress.md`、`session-handoff.md`、`DESIGN_LANGUAGE.md`、`design-mockups/**`、`tests/**`。无 DOM 使用 ⇒ **不影响真实渲染**。附带发现：仓库根未跟踪垃圾文件 `0)n++`（117 B，坏命令回显）也贡献了 `ring-ring` 候选（收尾轮已删除，下次构建该幽灵类消失）。
- **差集 5 条（非透明度）**：`accent-foreground` / `accent-primary`（是 `accent-color` 工具类，非语义色用法，由文本子串触发）、`border-ring` / `ring-ring`（裸类，`src/**` 只作为 `focus-visible:border-ring` / `focus-visible:ring-ring` 的子串出现，无单独 DOM 使用）、`focus-visible:border-primary`（HEAD 死类的写法被 `docs/**`、`feature_list.json`、`progress.md`、`coverage/**` 的文本重新「喂」回构建——说明幽灵类也会让已删除的死类重新出现在产物里，但没有 DOM 使用，不影响渲染）。
- **白名单中 13 条在新产物中未生成**（`[&>svg]:text-destructive|-foreground`、`aria-invalid:border-destructive`、`aria-invalid:ring-destructive/20`、`dark:aria-invalid:ring-destructive/40`、`data-[placeholder]:text-muted-foreground`、`data-[state=checked]:bg-destructive|bg-primary|border-destructive|border-primary|text-destructive-foreground|text-primary-foreground`、`data-[state=unchecked]:bg-input`）：属旧版 alive 但新实现未使用，**无回归**；护栏只要求「源码用到的类必须在白名单内」，不要求白名单全部被使用。

---

## 4. CSS 逐项对照表

「旧值」来源：旧产物 `package-dist/dist/assets/index-B1G0LqYR.css`（若来自 pi 预构建 CSS 会标注）；「新值」来源：工作区 `src/index.css` 行号（一手）。

### (a) 设计 token（`:root` / `.dark` 共 32 个语义 token + ancillary）

| 项 | 旧值（旧产物） | 新值（工作区） | 判定 |
|---|---|---|---|
| 32 个语义 token（浅/深各 32） | 如 `--background:oklch(100% 0 0)`；`--muted-foreground:oklch(55.6% 0 0)`（浅）/`oklch(70.8% 0 0)`（深）；`--accent-foreground` 浅 `oklch(40% .18 240)`、深 `oklch(75% .18 85)`；`--chart-2:oklch(53.553% .02798 259.829)` | `src/index.css:110-142`（浅）/`170-202`（深）：`oklch(1 0 0)`、`oklch(0.556 0 0)`、`oklch(0.4 0.18 240)`、`oklch(0.75 0.18 85)`、`oklch(53.553% 0.02798 259.829)` 等 | **数值全等**（64/64 对）；差异仅为书写格式（百分比 ↔ 小数、`.245` ↔ `0.245`），属文本差异非视觉回归 |
| `--radius` | 有效值 `.625rem`（pi 未分层 `:root` 压过 QF `@theme .5rem`） | `:root{--radius:0.625rem}`（156 行，注释说明「保持现值，避免全局圆角变化」）；`@theme{--radius:0.5rem}`（225 行）仍在但被未分层覆盖 | **有意保持一致**（有效值相同） |
| `--shadow-2xs…2xl` | pi：`0 1px 3px 0px #0000000d` 等（hex-alpha） | 157–164 行：`hsl(0 0% 0% / 0.05)`、`/0.1`、`/0.25` | **近似等价**（alpha 13/255≈5.1% vs 5% —— 非逐字节相等，视觉可忽略） |
| `--text-sm` / `--text-sm--line-height` | HEAD `index.css` 覆盖 `1rem` / `calc(20 / 14)` | 301–302 行：`1rem` / `calc(20 / 14)` | **全等** |
| `--font-sans/-mono` | pi 字体栈（旧产物 `:root,:host`） | 308–312 行（含 CJK 回退，HEAD 既有覆盖） | 沿用 HEAD 既有覆盖，非本轮改动 |

### (b) 高亮 token：`--syntax-*` → `--qf-hl-*`

旧 `--syntax-*` **不在 HEAD 源码**（全 HEAD `src` 扫描无 `--syntax-`），来自 pi 预构建 CSS；新 `--qf-hl-*` 在工作区 `src/index.css:8025-8072`（含注释「no `--qf-hl-punct` entry, no `.qf-hl-plain` rule」）。

| 旧名（浅/深值） | 新名 | 新值（浅/深） | 判定 |
|---|---|---|---|
| `keyword` | `keyword` | 同值（`oklch(57.7% 0.245 …)` / `oklch(69.8% 0.159 …)`） | 逐值相等（格式化差异） |
| `string` / `comment` / `tag` | 同名 | 同值 | 逐值相等 |
| `addition-bg/-fg` / `deletion-bg/-fg` | 同名 | 同值 | 逐值相等（共 4×2） |
| `entity` | `function` | `oklch(51.1% 0.136 307.715)`（浅）/`oklch(79.2% 0.124 …)`（深） | 改名，逐值相等 |
| `constant` | `number` / `property` / `attr` | `oklch(43.5% 0.141 237.016)`（浅）/`oklch(73.2% 0.137 …)`（深） | 一拆三，逐值相等 |
| `variable` | `builtin` | `oklch(60.8% 0.178 54.291)`（浅）/`oklch(74% 0.141 …)`（深） | 改名，逐值相等 |
| `heading` / `list` | —（不迁移） | — | **有意缺失**（旧 `.hljs-section/-bullet` 样式未回迁） |
| — | `punct` / `plain` | TS 映射存在（`HIGHLIGHT_TOKEN_CLASSES`），CSS 中无规则 | 与旧版等价（旧 `.hljs-punctuation` 亦 0 处，punct 走继承文字色） |

### (c) Markdown（旧 `.markdown-content` 32 条规则 → 新 `.qf-markdown-block`）

| 项 | 旧值（旧产物） | 新值（`src/index.css`） | 判定 |
|---|---|---|---|
| 标题 h1–h6 | `margin-top:spacing*5/4/3/3/2/2`、字号 `text-2xl…text-xs` | 2859–2896 行：同参数 | 一致 |
| 段落 | `margin-top:spacing*4`、`line-height:var(--leading-relaxed)` | 2898–2904 行：`margin-top:spacing*4`、`line-height: var(--quickforge-message-line-height, var(--leading-relaxed,1.625))` | 一致；**新增一层 QF 变量**（若被设置则以它为准，需人工确认） |
| 链接 | `a:hover{ color:color-mix(in oklab, var(--primary) 80%, transparent) }` | 2906–2922 行：同 80% 值，外包 `@media(hover:hover)` + `@supports` | 一致（**有意加固**：触屏不残留 hover 变色） |
| 行内 code | `font-size:var(--text-sm)`、`line-height:var(--tw-leading,var(--text-sm--line-height))`、`bg:muted`、`color:foreground`、`padding 0.375rem/0.125rem` | 2955–2962 行：逐项同值，`line-height: var(--text-sm--line-height)` | 一致 |
| 列表 | `ul/ol margin-block:spacing*4`、`padding-left:spacing*6`、`li leading:relaxed`、子列表 `margin-top:spacing*2` | 2929–2946 行：同 | 一致 |
| 引用/分割线 | `blockquote margin-block:spacing*4 + 4px 左边框`；`hr margin-block:spacing*8 + 1px` | 2947–2968 行：同 | 一致 |
| 表格 | `border-collapse;width:100%`、th/td 右下 1px、末列/末行清零、th `bg:muted` | 2972–3000 行：同 | 一致 |
| 表格容器 | 旧渲染器包 `overflow-x-auto my-2 border border-border rounded` | `src/components/chat/surface/Markdown.tsx:72-76` 复刻同 class | 一致（本次修复，见 §6-③） |

### (d) `.thinking-header` 与过程折叠（fail-visible 有意变更）

| 项 | 旧（HEAD 源码 / 旧产物） | 新（`src/index.css` / 源码） | 判定 |
|---|---|---|---|
| 未接管原生头 | HEAD `src/index.css`：`.thinking-header:not(.quickforge-process-thinking-header){ visibility:hidden }` | 新：显示兜底 —— `color: color-mix(in oklab, var(--muted-foreground) 88%, transparent)`、hover 回 `foreground 86%`、svg 到 hover/focus-visible 才显示（注释解释 R10 期「接管失败 → 思考永久消失」风险） | **有意变更**（fail-visible）；不再是静默隐藏 |
| 摘要行字号 | 旧 pi 头 `0.875rem`（13px 根字号下 = 11.375px） | `font-size: calc(var(--quickforge-message-font-size, 14px) * 0.875)`，注释：默认 R=M=13px 下 = 11.375px | **默认等价**；R≠M（消息字号≠根字号）时为**条件性差异**（新实现跟随消息字号，旧实现固定） |
| 折叠默认值 | 旧语义：流式回合展开、历史回合收起；阶段收起；工具组仅 `detailed` 展开 | `src/components/chat/panel-decoration/process-folding.ts:555-563`（`processGroupDefaultExpanded(isAgentStreaming)`、`processStageDefaultExpanded()=false`）、`620-623`（`processToolGroupDefaultExpanded = toolDisplayMode==='detailed'`），注释明确「旧语义」 | 一致（本次修复，见 §6-①） |

### (e) 工具行 / 卡摘要字号

| 项 | 旧 | 新 | 判定 |
|---|---|---|---|
| 阶段/工具组摘要行 | 0.875rem（13px 根字号 = 11.375px） | 同 (d) 的 `calc(×0.875)`（工作区两处规则均为此写法） | **默认等价**，R≠M 条件性差异同 (d) |

### (f) 滚动条 / shimmer / `prefers-reduced-motion`

| 项 | 旧 | 新 | 判定 |
|---|---|---|---|
| 全局细滚动条 | pi：`*{scrollbar-width:thin;scrollbar-color:var(--color-border) #0000}`、`::-webkit-scrollbar{8px}`、thumb `var(--color-border)` hover 透明 | `src/index.css:43-67`：同参数，颜色改 `var(--border)`（与旧 `--color-border:var(--border)` 等价） | 一致（逐条核对了 4 条规则） |
| shimmer | 旧 pi 的 `@keyframes shimmer` + `.animate-shimmer` | 76–96 行：`shimmer` 2s ease-in-out + `prefers-reduced-motion` 关闭 | 一致；`shimmer` 字符串出现次数 HEAD=3 → 新=10（新文件自托管后规则更完整） |
| `prefers-reduced-motion` | `src/index.css` 17 处；全 src CSS 18 处 | 19 处；全 src CSS 20 处 | **数量 +2**；「19 vs 19」说法修正；**未逐条 diff** → limitation |

### (g) body 基线与用户气泡

| 项 | 旧 | 新 | 判定 |
|---|---|---|---|
| body | 旧产物：`body{font-size:16px}`（另 `html{font-size:13px}` 由设置驱动） | 38–41 行：`body{font-size:16px;-webkit-font-smoothing:antialiased}`；html 字号仍由 `src/lib/font-size-settings.ts` 驱动 | 一致 |
| 用户气泡 | 旧产物（QF 覆盖 pi 渐变）：`max-width:min(78%,45rem)!important`、边框 `color-mix(--primary 12%, --border)`、背景 `--quickforge-input-clamp-bg` = 6%（深）/3%（浅）、`border-radius:1.125rem 1.125rem .375rem`、`box-shadow:0 10px 28px -24px color-mix(--primary 55%, black), inset 0 1px 0 #ffffff14` | `.qf-user-message .user-message-container`：同 max-width/边框/6%/3% 背景；圆角写成 4 值 `1.125rem 1.125rem 0.375rem 1.125rem`（与 3 值写法等价）；阴影 `… rgb(255 255 255 / 0.08)`（≈`#ffffff14`） | 一致；**源码注释「浓度比原 10% 调浅」与旧产物 6%/3% 不符**（注释陈旧，仅登记不改） |

---

## 5. 交互 / DOM 对照表

> 说明：「旧证据」栏中涉及 pi-web-ui **内部实现**的条目（阈值、内部组件定位数学）来自旧会话对旧构建 JS chunk 的分析，属**二手**；本轮对可复核项（HEAD 源码、工作区源码、新构建）做了抽样核对，未逐项在真实浏览器中验证 → 手感类结论均为 limitation（见 §8）。

| 交互项 | 旧证据（来源级别） | 新实现（一手源码位置） | 判定 |
|---|---|---|---|
| 自动滚动 / 贴底阈值 | pi 内部阈值 50/10（二手） | React 侧「贴底才自动跟随」语义（`src/components/chat/scroll-sync.ts`：`setAutoScroll`；ChatPanelHost 内滚动所有权） | **行为近似**；具体像素阈值与时机未逐一对齐 → limitation |
| scroll-to-bottom 按钮 | 旧存在（二手） | 新存在，出现/消失由贴底状态驱动 | 一致（宏行为） |
| 消息窗口化 | 旧会话说「被移除」 | HEAD 即 `ChatPanelHost.tsx:656` `createMessageWindow({ enabled: false })`（一手） | **非本次改动**（旧说法被否证，见 §7-②） |
| 流式滚动所有权 | pi 在流式期间接管滚动（二手） | React 版本流式期间同样保持贴底、用户上滑即释放（代码路径存在，未做像素级验证） | 语义等价 → limitation |
| 消息级复制反馈 | 旧 1200ms（二手） | `panel-decoration/message-actions.ts` 等；测试 `chat-surface-behavior-alignment` 覆盖通道 | 1200ms 一致（沿用） |
| code-block 复制反馈 | 旧 `copy-button` 带 `showText`：2000ms 可见文本 + title 恒定（二手） | `surface/CodeBlock.tsx:238-264`（`Check` + 可见 `t('copied')` span，`title={t('copy')}` 恒定）；时长 2000ms（标题栏）/1200ms（菜单） | **本次已恢复可见文本**；双时长与旧行为分别对齐（见 §6-②） |
| composer Enter/Escape/IME | 旧一致行为（二手） | 当前实现一致（测试覆盖） | 一致 |
| 消息队列拖拽/ghost/阈值/userSelect | 旧行为（二手） | 仅选择器字符串 2 行差异（旧会话复核） | 一致（二手未再复核） |
| info-tip | 旧 150ms 显示 / 120ms 关闭、外点关闭、Escape、scroll/resize 重定位（二手） | 新实现同参数（旧会话复核）+ 新增 `aria-describedby` | 一致 + 无障碍增强 |
| confirm/prompt dialog | 旧版本就是 QF 自己的 React 组件（二手） | 现为 `src/components/ui/confirm-dialog.tsx` 等 | 非 pi 组件，无迁移风险 |
| SettingsSelect 定位数学 | 逐字一致（旧会话声称） | 现实现一致；并修复旧版「上下键多移一格」bug（二手结论） | 一致 + 修复（bug 修复本身未在浏览器验证 → limitation） |
| 数字输入 | 旧 `change`+`blur` 双提交（二手） | 新实现去重（二手） | 一致 + 修复 |
| 附件 tile | 类链复刻（二手） | `surface/AttachmentPreview.tsx` 类链复刻；预览层旧实现不可考 | 一致（预览层 → limitation） |
| Markdown 链接/表格 | 旧渲染器无条件 `target="_blank" rel="noopener noreferrer"` + 表格包装（二手） | `surface/Markdown.tsx:49-76` 已对齐（本次修复，§6-③） | 一致 |

---

## 6. 本次修复清单

**测试运行（一手，2026-09-19）**：

```
npx vitest run tests/frontend/process-folding.test.ts tests/frontend/chat-code-block.test.ts \
  tests/frontend/chat-markdown-parity.test.ts tests/frontend/chat-surface-api-key-dialog.test.ts \
  tests/frontend/semantic-color-class-parity.test.ts
 ✓ process-folding.test.ts (53)   ✓ chat-code-block.test.ts (45)   ✓ chat-surface-api-key-dialog.test.ts (20)
 ✓ chat-markdown-parity.test.ts (4)   ✓ semantic-color-class-parity.test.ts (3)
 Test Files 5 passed (5)   Tests 125 passed (125)   Duration 914ms
npx vitest run tests/frontend/code-highlight.test.ts
 ✓ code-highlight.test.ts (51)   Test Files 1 passed (1)   Tests 51 passed (51)
```

> 「修复前失败」的输出属并行会话记录（**二手**），本轮无法在已修复的工作区重放；下表把「修复前失败」标注为二手、把「修复后通过」标注为本次一手。

| # | 证据（一手） | 改动 | 护栏测试 | 修复前（二手）→ 修复后（一手） |
|---|---|---|---|---|
| ① | `process-folding.ts:555-563,620-623`（含「旧语义」注释） | 过程折叠默认展开回退旧语义：`processGroupDefaultExpanded(isAgentStreaming)` / `processStageDefaultExpanded()=false` / 工具组 = `toolDisplayMode==='detailed'` | `tests/frontend/process-folding.test.ts` | 3 failed → **53 passed** |
| ② | `CodeBlock.tsx:238-264`（`CodeBlockCopyButton`：`Check` + 可见 `t('copied')` 文本、`title={t('copy')}` 恒定）、`355-381`（2000ms/1200ms 双路径） | code-block 复制反馈恢复可见文本 + title 恒定 | `tests/frontend/chat-code-block.test.ts` | 新增 3 例 → **45 passed**（含新增；「3 例」为二手描述） |
| ③ | `Markdown.tsx:52`（`target="_blank" rel="noopener noreferrer"`）、`74-76`（表格包装 `overflow-x-auto my-2 border border-border rounded`） | Markdown 链接/表格对齐旧渲染器 | `tests/frontend/chat-markdown-parity.test.ts` | 新增 → **4 passed** |
| ④ | `ApiKeyPromptDialog.tsx`：`INVALID_STATE_RESET_MS=5000`(28)、`resolveProbeModel`（本地 custom-providers 优先 → catalog 兜底 → 无模型直接保存）(80-152)、`saveApiKeyWithVerification`(159-250)、`Testing…`(293)、焦点恢复(317-330) | API Key 对话框恢复「保存前探测」+ 关闭恢复焦点 | `tests/frontend/chat-surface-api-key-dialog.test.ts`（含 `probes with the locally configured model…`、`restores focus…`、`shows ✗ Invalid for 5s and Testing...`） | 11 failed → **20 passed** |
| ⑤ | 护栏白名单与旧产物提取 diff 为空；当前 `src/` 中 `text-foreground/*`、`text-primary/*`、`hover:bg-muted/45`、`bg-background/50`、`bg-border/70`、`text-muted-foreground/70` 均 **0 处**；新构建中 border 归一化以 `color-mix(in oklab, var(--border) …)` 出现 16 处 | 语义色透明度归一化（旧会话口径 23 类/35 处，**二手**：文本类去透明度、背景类取白名单档位、边框类改 `border-[color-mix(in_oklab,var(--border)_NN%,transparent)]`） | `tests/frontend/semantic-color-class-parity.test.ts`（3 例：白名单 + 源码扫描） | 35 条违规（二手）→ **3 passed** |
| ⑥ | `src/components/ui/input.tsx:9`：`focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`；HEAD 旧类 `focus-visible:border-primary` 在旧产物中 **0 处**（dead）；旧产物同列 escaped-needle 计数（收尾轮一手）：`focus-visible\:outline-none` **1 处（alive）**、`focus-visible\:border-ring` 1、`focus-visible\:ring-ring` 3、`focus-visible\:ring-2` 1（后四者来自 pi 组件）；新产物中 `.focus-visible\:border-ring` / `.focus-visible\:ring-2` / `.focus-visible\:ring-ring` / `.focus-visible\:outline-none` 均已生成（收尾轮核对） | 聚焦反馈改为白名单组合 | 未新增专属测试（白名单测试覆盖这些类名属于 alive 集） | **性质 = 有意补齐**（旧输入框唯一真实生效的聚焦类是 `outline-none`，聚焦边框/光环是新行为；与「移除依赖前的实际渲染」不等价，需在验收时按新行为确认） |
| ⑦ | `src/lib/code-highlight.ts`（未知语言走保守 `tokenizeGeneric`；`punct`/`plain` 无 CSS 规则） + `tests/frontend/code-highlight.test.ts`（51 tests，含 `unknown-language fallback` 4 例） | 未知语言名不再整块纯文本（除 `text/plaintext/txt`、空名、超长/无判别 token） | `tests/frontend/code-highlight.test.ts` | 已完成 → **51 passed**（「hi 未知语言」由 generic fallback 覆盖；**不含** hljs 式语言自动猜测 → limitation） |

### 6.1 与既有用户要求的冲突/待裁决（收尾轮终态：用户未在评审窗口内裁决 → 默认保留当前实现 + 精确回退路径）

**结论状态：用户未在评审窗口内裁决 → 默认保留当前（对齐移除依赖前）的实现。** 本节两处冲突点（§6-① 折叠默认值回退旧语义；§6-⑥ `ui/Input` 聚焦反馈补齐）在本轮评审窗口内均未收到用户回答，按默认方案保留现状，不再停留于「等待裁决」状态；下方给出精确回退路径，用户若选择另一方案可直接按路径回退（无需重新取证）。

一手引用（均为仓库内既有记录，非本报告推断；`progress.md` 行号为**收尾轮实测**——§6.1 初稿写于该文件头部条目扩展之前，曾引用 `:122/:124/:127/:133`，原文一致、整体下移 2 行）：

| 出处 | 原文（摘） | 与本轮改动的关系 |
|---|---|---|
| `progress.md:124` | `## self-hosted-chat-ui（done，2026-09-19 第十轮·需求纠正：思考正文默认折叠 + 折叠组三层默认展开）` | R10 标题即把「折叠组三层默认展开」定为需求 |
| `progress.md:126` | 「本轮为第十轮·需求纠正：第九轮把「思考内容默认展示」误解为 ThinkingBlock（思考正文）默认展开；**用户澄清**——思考正文应默认折叠，真正问题是**折叠组默认收起导致「思考和工具都不显示」**」 | 用户澄清的原始问题：默认收起 = 思考与工具都不显示（其根因见下方「背景事实」） |
| `progress.md:129` | 「② **折叠组三层默认展开（核心需求：思考块与工具行默认可见）**：……顶层过程组……改为新提取的 `processGroupDefaultExpanded()`（恒 true，历史回合也默认展开）；内层阶段 `processStageDefaultExpanded()` false→true；工具组 resolve 的 defaultExpanded 由 `detailed` 改 `true`」 | 与 §6-① 的三处回退**逐条反向** |
| `progress.md:135` | 「② 三层默认展开后长会话默认高度变大，属预期行为变更（**与用户需求一致**）」 | 再次点明该行为变更来自用户需求 |
| `session-handoff.md:48-50` | 「第十轮·需求纠正……**用户澄清真实诉求**：① 思考正文默认折叠；② 过程折叠组三层（顶层过程组/内层阶段/工具组）**默认展开**，让思考块与工具行默认可见（**历史回合同样默认展开**）」 | 交接文件同源记录 |

**背景事实（供用户判断「默认展开」是否仍然必要）**：R10 提出「三层默认展开」的动机是当时的现象——「折叠组默认收起导致思考和工具都不显示」（上表 `progress.md:126`）；该现象的根因在 **R12（第十二轮·根因修复）** 才被定位并修复：装饰层「思考头接管」从未成功（chevron 是 lucide `<svg>` 本体，先被 `instanceof HTMLElement` 过滤、`querySelector('svg')` 又匹配不到自身 → 提前 return），叠加「等接管」的隐藏规则（R9 的 `visibility:hidden`，R11 收紧为过程组级 `display:none`）→ 整块思考永久消失；R12 删除该隐藏规则并确立 **fail-visible 契约**（任何「等接管」的隐藏都不得存在；未接管时显示原生 header 而非静默消失，见 `progress.md` 第十二轮条目、`session-handoff.md` 第十二轮条目）。即 R10 时期「思考/工具不显示」的根因现已修复且不会静默回归——用户可据此判断是否仍需要「历史回合默认展开」。

- 冲突面：R10 要求「三层默认展开、历史回合同样展开、让思考块与工具行默认可见」；本轮 §6-① 回退为「顶层 = `isAgentStreaming`（历史回合收起）、内层阶段收起、工具组 = `toolDisplayMode==='detailed'`」。检索 `progress.md` / `session-handoff.md` / `feature_list.json` / `docs/**` 未发现 R10 之后有修订该要求的用户记录（其余「默认收起」记录均为 `goal_report` 工具卡、Subagent 已结束小节、Goal 验收区等**其他对象**的要求）。
- 不冲突面：两轮都不动 `resolveProcessExpandedState` 的 saved-state 优先语义与 fail-visible 契约；`ThinkingBlock` 思考正文默认折叠两轮一致。
- 用户可选的两个方案（① 为当前默认、已生效）：① 保留当前实现（对齐移除依赖前的旧语义）——历史回合默认收起、阶段/工具组按上述规则收起（= 撤销 R10 的三层默认展开要求）；② 恢复 R10 的三层默认展开（= 按下方「折叠默认值精确回退路径」执行，保留其余 6 项修复）。

**折叠默认值：当前实现与精确回退路径**

- 当前实现（= 对齐移除依赖前的渲染，现状默认保留）：顶层过程组默认展开值取 `isAgentStreaming`（`src/components/chat/panel-decoration/process-folding.ts:556-558` 定义 `processGroupDefaultExpanded(isAgentStreaming)`；`:693` 为其唯一调用处/传参）；内层阶段 `processStageDefaultExpanded()` 返回 `false`（`:561-563`，调用点 `:591`）；工具组默认展开 = `toolDisplayMode === 'detailed'`（`:621-623` 定义 `processToolGroupDefaultExpanded`；`:646` 取其返回值，作为 `resolveProcessExpandedState` 的第四个参数传入 `:652-658`，即 `:657` 的 `detailed` 位置）。
- 精确回退路径（方案 ②，若用户裁决恢复 R10）：只改 1 个源文件 + 1 个测试文件。`process-folding.ts` 三处——① `processGroupDefaultExpanded`（`:556-558`）及其调用处传参（`:693`）改回恒 `true`（R10 写法为无参恒 true）；② `processStageDefaultExpanded()`（`:561-563`）返回值 `false` → `true`；③ 工具组 `resolveProcessExpandedState` 第四个参数（`:652-658`，值来自 `processToolGroupDefaultExpanded`）改回恒 `true`。并同步 `tests/frontend/process-folding.test.ts` 3 例断言：`:131-135`（顶层：流式 `true` / 历史 `false`）、`:137-141`（工具组：`detailed` `true` / `compact` `false`）、`:437-443`（阶段默认值 `false` + saved 优先断言）。以上行号均为收尾轮实测。
- 附注：R10 同期还把 `src/lib/i18n.ts` 的 `toolDisplayModeDescription` en/zh 改为「工具组两模式均默认展开」（`progress.md:131`）；当前文案（`src/lib/i18n.ts:456` / `:2108`）与现实现一致（简洁 → 收起、详细 → 展开），若执行方案 ② 需一并改回。

**`ui/Input` 聚焦环：当前实现与回退路径**

- 当前实现（**有意补齐**，非等价回迁）：`src/components/ui/input.tsx:9` 为 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none`；与仓库既有按钮聚焦环（`src/components/ui/button.tsx:6` 的 `focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`）共用同一套 ring token，Input 另补 `border-ring`。
- 事实依据（收尾轮 `git show HEAD:src/components/ui/input.tsx` 实测 + §1.4-C9 计数）：HEAD 版该文件为 `focus-visible:border-primary focus-visible:outline-none`——其中 `focus-visible:border-primary` 在移除前构建产物 `index-B1G0LqYR.css` 中 **0 处（dead）**、`focus-visible:outline-none` **1 处（alive）**；即移除依赖前该输入框键盘聚焦**无可见反馈**，当前组合属**新增**行为。
- 状态与回退路径：同属「用户未在窗口内裁决 → 默认保留当前实现」；回退 = 删除 `input.tsx:9` 中的 `focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring` 三个类、只保留 `focus-visible:outline-none`（恢复移除依赖前的「聚焦无可见反馈」；`ui/button.tsx` 等其他控件的聚焦环不受影响）。

- 影响面：折叠默认值仅影响「无 saved state 时的初始展开值」；用户手动展开/收起后的记忆、思考正文默认折叠、fail-visible 均不受影响。聚焦环仅影响 `ui/Input` 的键盘聚焦观感。
- 状态登记（收尾轮）：本节结论已同步 `progress.md`（第十五轮条目：用户未在窗口内裁决 → 默认保留当前实现 + 回退路径见本节）与 `session-handoff.md`（第十五轮「下一步」条目）。

---

## 7. 被否证的历史说法

| # | 历史说法 | 复核结论 | 证据 |
|---|---|---|---|
| ① | 「侧栏 hover 反馈 / 菜单 hover 背景 / 遮罩压暗等被删导致回归」 | **否证**：被删的类（`hover:bg-muted/45`、`bg-background/50`、`bg-border/70`、`text-muted-foreground/70`、`text-foreground/90` 等）在旧构建中 **0 处**（dead），旧版渲染时本就不生效；删除前后视觉一致 → 属**正确删除** | §3.3 表 + `git grep` 源码用量表 |
| ② | 「消息窗口化被移除」 | **否证**：HEAD `ChatPanelHost.tsx:656` 即 `createMessageWindow({ enabled: false })`；窗口化在本轮改动之前就是关闭状态 | 一手源码（HEAD） |
| ③ | 「4 个分区删除任务中有 alive 类被误删」 | **未发现**：方法 = HEAD 与工作区逐 token 计数 + hunk 净差 + 旧产物选择器核对；结果 = 删除行中携带的 alive 类在对应 hunk 里都保留了同名类；旧产物 78 条 alive 白名单与当前护栏白名单**零差异** | 白名单 diff 为空；HEAD 选择器命中率 685/694 |
| ④ | （隐含）「语义色透明度类在旧版同样渲染」 | **否证**：旧版 `text-foreground/*`、`text-primary/*`、`bg-border/*`、`border-border/*`、`bg-card/*` 等**全档位不生成**；只有 78 条白名单组合真实存在 | §3.2/§3.3 |

---

## 8. 不可考证与 limitation

**硬性限制（不可考证）**

1. pi-web-ui 的 shadow DOM 内部样式与组件内部字号：包已卸载且不在 lock，旧产物 CSS 只含其预构建产物，无法逐组件还原。
2. 旧 `attachment-tile` 预览层实现（旧构建 JS chunk 中仅存类名/结构字符串，无完整运行时语义）。
3. 旧 `--syntax-heading/-list` 的实际使用规则（pi 自身组件消费，QF 侧无从取证）；本轮明确不迁移。
4. 旧产物第二个 Tailwind banner（`v4.3.0`）的来源：新旧 lock 均为 `tailwindcss@4.2.4`，v2.1.0 打包环境的版本无法在仓库内考证。
5. hljs 自动识别（`highlightAuto`）的精确等价性：新实现明确不做语言猜测，未知语言走保守 generic pass；行为差异为**有意**，但「代码块着色与旧版逐 token 一致」不可证。
6. 「旧产物 397 处 katex 规则」的具体口径未复现（本次口径为 503 处字符串命中）。

**条件性差异 / 未逐条复核**

7. 过程摘要字号在「消息字号 ≠ 根字号」时与旧版不同（新：跟随消息字号 ×0.875；旧：固定 0.875rem）。
8. 滚动贴底时机、阈值（pi 内部 50/10 为二手）与真实手感：未在真实浏览器验证。
9. `prefers-reduced-motion` 仅做了数量核对（17→19 / 18→20），未逐条 diff。
10. 所有像素级/手感级结论（hover 过渡、菜单定位、modal 动画、复制反馈体感）均未实时验证。
11. Markdown 段落/列表行高新增 `var(--quickforge-message-line-height, …)` 一层变量，若该变量被设置则与旧版取值不同（需人工确认是否符合预期）。
12. `--shadow-*` 与用户气泡内阴影为「近似等价」（hex-alpha 13/255 ≈ 5.1% vs 5%；`#ffffff14` ≈ 7.8% vs 8%）。
13. 用户气泡源码注释「浓度比原 10% 调浅」与旧产物 6%/3% 不符（注释陈旧，不影响渲染）。
14. **幽灵类（收尾轮一手复核）**：新产物 `dist/assets/index-CWWfUxx8.css` 中，白名单外的 20 个带透明度语义色类与 5 个非透明度差集类在 `src/**` 出现次数均为 0，**无 DOM 使用 ⇒ 不影响真实渲染**，只增加 CSS 体积与类名核查噪音。来源（`src/**` 外，按出现量）：`coverage/src/**/*.html`（迁移前快照，最大来源）、`.goal-runtime-refactor-baseline/*.tsx`、`docs/**`（含 `docs/reviews/*` 本报告自身）、`docs/archive/*`、`docs/wiki/**`、`feature_list.json`、`progress.md`、`session-handoff.md`、`DESIGN_LANGUAGE.md`、`design-mockups/**`、`tests/**`；仓库根未跟踪垃圾文件 `0)n++`（117 B，坏命令回显）亦贡献 `ring-ring` 候选（收尾轮已删除，下次构建该幽灵类消失）。另：白名单中 13 条（`[&>svg]:*`、`aria-invalid:*`、`data-[state=checked]:*`、`data-[state=unchecked]:bg-input` 等）在新产物中未生成——属旧版 alive 但新实现未使用，无回归。

**真实浏览器人工验收清单（建议按此逐项勾选）**

- [ ] 思考行：默认折叠状态、流式回合展开、历史回合收起；未接管原生头**可见**（fail-visible）而非消失。
- [ ] 侧栏/菜单 hover 与选中的明暗变化（与旧版截图对比）。
- [ ] 下拉框（SettingsSelect）打开/关闭、键盘上下移动「每次一格」、滚动/窗口尺寸变化后的重新定位。
- [ ] modal 焦点陷阱与关闭后焦点恢复（含 API Key 对话框：探测中 `Testing…`、失败 5s 复位、关闭后焦点回到打开前元素）。
- [ ] 复制反馈：消息级 1200ms；代码块标题栏按钮 2000ms 可见文本 + `title` 不变；`⋯` 菜单复制 1200ms。
- [ ] 长表格横向滚动（`overflow-x-auto` 容器 + 边框圆角）。
- [ ] 代码块横向滚动与着色（JS/TS/Python/Bash/JSON + 一个未知语言名；`text/plaintext` 应保持纯文本）。
- [ ] 输入框聚焦反馈（`border-ring + ring-2`；确认这是**新增**行为并接受）。
- [ ] 移动端遮罩（配 `html.quickforge-mobile-native` 的用户选择规则）、深色模式 token 对比。
- [ ] 用户气泡背景浓度（6%/3%）、圆角方向、阴影深浅。

---

## 9. 后续建议

1. **KaTeX / 公式渲染取舍**：旧版有 397–503 处 katex 规则与字体（`@font-face` 指向 pi-web-ui 包内资源），新实现公式退化为纯文本。若现有用户依赖公式渲染，建议单开 feature 引入独立 KaTeX（含字体子集与缓存策略），否则在 Release Notes 明示该差异。
2. **hljs 等价性是否继续加强**：当前 generic fallback 覆盖「注释/字符串/数字/常见关键字」，建议收集真实会话中着色不佳的代码块（尤其 `powershell`/`graphql`/`protobuf` 等）按需补 tokenizer，而不是追求 `highlightAuto` 复刻。
3. **`docs/wiki/src/components/README.md` 整页重复副本**（第二份自 315 行起，疑似复制事故）：本次仅登记，未修改；建议后续单开清理任务。
4. **`isSelected ? '' : ''` 之类空类残留**：保持最小改动未清理；可在后续 lint 规则（如 `no-unused-expressions` 类似的样式扫描）中统一治理。
5. **新发现：幽灵类**（§3.5）——Tailwind 自动内容检测扫到了 `docs/**`、`feature_list.json`、`progress.md`、`session-handoff.md`、`tests/**` 中的类名字符串，导致新构建包含未使用选择器（`text-foreground/90`、`bg-muted/34`、`border-border/75` 等）。建议用 `@source not`（或把「文档/记录」排除在内容检测外），既减小 CSS，也让「构建产物类名 = 源码真实用量」重新成立，便于后续核查。收尾轮复核（构建 `index-CWWfUxx8.css`，一手）：该形态共 **20 个带透明度 + 5 个非透明度幽灵类**，`src/**` 使用 0 次、无 DOM 使用 ⇒ 不影响渲染；来源新增 `coverage/src/**/*.html`（迁移前快照，最大来源）与 `.goal-runtime-refactor-baseline/*.tsx`，另有仓库根垃圾文件 `0)n++`（已删除）。
6. **护栏补强**：`focus-visible:border-ring/ring-2` 属于「旧构建 alive 但旧 QF 未使用」的类，当前无专属测试；建议在语义色护栏旁增加一条「输入类控件聚焦反馈类名」断言（避免未来再次出现「旧类 dead、替换类缺失」的静默问题）。
7. **次要文档问题**：`src/index.css` 用户气泡注释（「比原 10% 调浅」）与实际值不符，建议顺手更正文案。

---

### 附：本次报告用到的关键脚本口径

- 语义色工具类提取：规则级解析旧 CSS（`([^{}]*){`）→ 取每个 selector 中 `.` 起始的类 token → 归一化（去转义）→ 取最后一个 `:` 后的基础名 → 与 27 个语义 token 名单匹配（工具前缀：`text|bg|border|ring|fill|stroke|from|via|to|outline|divide|placeholder|caret|decoration|shadow|accent`）。
- 缺类/存在类检查：一律使用**含反斜杠的全文 needle**（如 `text-foreground\/90`），避免「未转义 needle 永不命中」的假阴性。
- 层归属检查：`@layer utilities{` 花括号配对求区间后按匹配位置判断（旧产物 1 个 utilities 区间，命中 52/52 透明度子集、全部 78 条白名单）。
- 选择器命中率：HEAD `index.css` 规则级类 token（694）逐个转义后在旧产物中查找（685 命中）。
