# Bot 吉祥物

一个实心圆球 + 两只眼睛的极简吉祥物：**6 个状态的动作**、**可换配色**、无损循环、透明背景。

```
docs/design/bot-mascot/
├── series/               # 动作系列（当前主推，512px）
│   ├── idle.gif          # 待机        2.40s
│   ├── thinking.gif      # 思考        2.40s
│   ├── working.gif       # 干活中      0.96s
│   ├── happy.gif         # 开心        1.20s
│   ├── sleepy.gif        # 犯困        3.60s
│   ├── alert.gif         # 提醒        1.60s
│   ├── palette.html      # 调色板网页：改色、看动作、拿命令
│   ├── *-128.gif         # 同一批动作的 128px 版本
│   └── *-still.png       # 各状态透明静帧
├── generate-bot-gif.py   # 生成脚本（动作 + 配色 + 调色板网页都由它产出）
└── bot.gif / bot-128.gif # 旧版造型：蓝色渐变 + 天线（保留，可对照）
```

## 动作语言：关键帧 + 缓动

每个状态写成一条条关键帧轨道，每段单独给缓动：`in` 蓄力 / `out` 窜起 / `snap` 两帧急停 / `back` 过冲回弹 / `inout` 呼吸。配合动画本身的几条原则：预备动作（跳前先蹲）、挤压拉伸（宽高比 0.83–1.50）、余震收住。

早先版本所有通道都走 `sin(2πt)`，看起来"太文静"，这条是根因：正弦是匀速的，没有起伏也没有停顿。

## 眼睛：四件事让它活起来

1. **眼睑从上往下盖。** `eye_sy` 小于 1 时，眼睛不是整体缩小，而是沿底边往上收——所以半闭的眼睛停在眼窝下缘，像眼皮垂下来，而不是"眼睛变小"。睁到大于 1 才从中心往外长。
2. **视线是急转，不是滑行。** 真实眼球看东西是"啪"地转过去停住。所有看的方向都用 1.5–2 帧（`snap`）完成，单帧最大位移实测 14–17px。
3. **两只眼可以不同步。** `eye_spread` 控制眼距（负数并拢=对焦，正数分开=惊讶）；`eye_rot2` 让两眼反向倾斜（对眼、犯嘀咕）。生成器为左右眼各出一套关键帧。
4. **眼睛有自己的小动作。** 干活时 3 周期高频微抖（在使劲）、被震到时一缩、吓到后四处瞟两眼、睡前眼球往上翻。

| 状态 | 眼睛在做什么 | 实测 |
|------|--------------|------|
| idle | 往左瞟一眼、往右瞟一眼（都是急转），中间连眨两下 | 视线摆幅 28px，单帧急转 14.3px |
| thinking | 眼球像扫读：右上 → 中间 → 右上，两眼里并成对眼、反向倾斜 7°，想到时睁大到 1.3 倍 | 摆幅 23px，单帧急转 16.6px，眼距收 17px |
| working | 盯着手里的活（并拢 3px、向下看 4–9px），落地被震得一缩，全程微抖 | 眼高 28–60px |
| happy | 弯月眼随跳跃张开 1.25 倍、落地压扁到 0.72，并轻微转向 | 眼高 12–28px |
| sleepy | 眼睑从四成慢慢盖到几乎全闭，一激灵睁大 1.3 倍再眯回去 | 眼高 0–70px |
| alert | 先眯到 0.66 蓄力，再 1.58 倍并分开 7px，落地后左右各瞟一眼 | 摆幅 18px，眼距变化 22px |
| walk | 边走边盯着脚下那条边（向下看 5–7px），落地瞬间眼睛一缩到 0.88 | 上下行程 19.4px，24 帧 / 0.96s |

## 造型

圆球半径 150、圆心 (256, 258)，锚点在球底 (256, 408)——所有缩放和跳跃都从这里发力，所以压扁时底部贴地、拉伸时往上长。眼睛是 36×64 的**豆豆眼**（`rx 18 / ry 32`），左右各偏 46px、中心在 y=262（比圆心低 4px，婴儿比例；`expressions-preview.html` 验收定稿，原先是 40×52 的圆眼在 267）。开心的弯月眼是一条 11px 描边的弧。

半径从第一版的 170 收到 150，是给跳跃让画布空间：最高点（`alert` 窜起来那帧）离画布顶还有 32px。

## 换配色

预设（`--palette`）：`ink`（墨黑，默认）、`inverse`、`indigo`、`tangerine`、`mint`、`grape`、`butter`、`slate`。任意 hex 用 `--body` / `--eye` 覆盖：

```bash
# 导出界面要用的 CSS 关键帧与几何数据（改完造型必须跑一次）
python3 docs/design/bot-mascot/generate-bot-gif.py --emit-web

python3 docs/design/bot-mascot/generate-bot-gif.py --all --emit-palette
python3 docs/design/bot-mascot/generate-bot-gif.py --all --body "#EF8A3C" --eye "#FFFFFF"
python3 docs/design/bot-mascot/generate-bot-gif.py --all --size 128 --body "#EF8A3C" --eye "#FFFFFF"
python3 docs/design/bot-mascot/generate-bot-gif.py --state happy --palette grape
```

## 调色板网页

打开 `series/palette.html`：两个取色器 + 8 套预设 + 背景切换（棋盘格 / 白 / 深色），6 个动作同时播放，底部给出该配色的导出命令。

网页动画不是手写 CSS，而是用同一套姿态函数采样出的 `matrix()` / `translate+rotate+scale` 关键帧，左右眼各一套。同一时刻网页 transform 与 SVG transform 数值一致（实测 `sleepy` t=0.5 两侧都是 30.019px 下移、`thinking` t=0.5 左右眼分别是 +21px 和 +11px，与 SVG 完全相同）。

## 接进应用

`--emit-web` 会写出两个前端文件（生成产物，勿手改）：

- `src/components/bots/mascot/mascot-anim.css`：7 个状态（含 `walk`）的关键帧，**逐字照搬设计稿 `mascot-v3.html`**（脚本里的 `V3_WEB`）：变换原点在球心 `(256,258)`，缓动用设计稿原样的 `ease-in-out` / `cubic-bezier`，左右眼共用一套；任何尺寸都是同一个动作，只按 `size/220` 等比缩放，不再有 `-small` 增强版。另含默认墨黑配色在深色主题下换成白身黑眼（`data-look='default'`）、`prefers-reduced-motion` 与「关掉动画」的静态降级。
- `src/components/bots/mascot/mascot-geometry.ts`：几何、每个状态的循环时长（与设计稿一致）、8 套预设配色。

> GIF 与 `series/palette.html` 仍由 `pose_*` 采样，是旧动作，和界面不完全一致；本机缺 `rsvg-convert` / `ffmpeg` 时，只重新生成前端文件可直接调用脚本里的 `emit_web()`。

界面里渲染的是内联 SVG（`BotMascot.tsx`），颜色走 `--qf-mascot-body` / `--qf-mascot-eye` 两个 CSS 变量，所以换色不需要重新生成任何素材，任意尺寸也不会模糊。动作选哪个由 `resolveMascotState()` 从会话状态推导，映射见 `docs/wiki/server/bots.md` §7.2。

## 互动动作（hover / poke / dizzy）

设计稿是 `interactions-preview.html`（可直接用鼠标试），已验收并落地。三个动作挂在 `data-interact` 属性上，CSS 由生成脚本的 `V3_INTERACT_RULES` / `_dizzy_eye_keyframes()` 输出（和状态关键帧同一个文件）：

- **hover**：抬身 10、眼睛上看，悬停期间定住（呼吸暂停）；移开用 `hover-exit` 0.3s 落回，不会跳变。
- **poke**：被戳瘪 → 眯眼弹起 → 落地压扁 → 小回弹，0.6s 一次性；播放中的点击只计数不重开。
- **dizzy**：1.6s 内点满 5 下的彩蛋，1.5s：身体左右晃、双眼反向绕圈（关键帧由脚本按半径 8 / 每圈 8 个采样点生成）。

时机规则（`mascot-interactions.ts` 的 `MASCOT_INTERACTIVE_STATES`）：只在**待机 / 犯困**时响应——思考、干活、提醒、开心是要让用户看清的状态，走路时目标在横向移动，都不理人。逻辑是纯控制器（可注入假时钟，`tests/frontend/mascot-interactions.test.ts`），React 侧由 `use-mascot-interactions.ts` 接线。事件只挂在球本体（`.qf-mascot__ball`，`pointer-events: auto`），84px 方图的空白处照常穿透；刻意不进 Tab 序列（纯装饰彩蛋，键盘用户不损失任何功能）。目前只给输入框上方那只开（`BotMascot` 的 `interactive`），侧栏行和设置预览不加。

## 动作组（peek / wave / stretch / yawn / pleased / surprise）

设计稿是 `actions-preview.html`（六选全要，已验收落地）。六个都是「事件触发的小动作」，与业务状态（V3_WEB）的区别：触发都要求 idle，播完自动回真实状态，永远不盖思考/干活/提醒这些信息。生成上与 V3_WEB 走同一管道（`V3_ACTIONS`，多一个 arc 标记=弯月笑眼），时长/中文名自动进 `mascot-geometry.ts`。

| 动作 | 时长 | 触发 | 实现 |
|------|------|------|------|
| 偷看打字 peek | 2.4s 循环 | 输入框有输入（document 级 input 监听 + 2.5s 保活） | use-mascot-actions |
| 打招呼 wave | 3.4s 一次 | 切换 bot（含进入 bot 模式；挂载首次不算，免得刷新就挥手） | 同上，activeBotId 边沿 |
| 伸懒腰 stretch | 3.0s 一次 | idle 持续 35s 后，之后每 35~55s 随机 | 同上，idle 调度 |
| 打哈欠 yawn | 3.4s 一次 | idle 持续 180s（每个 idle 周期最多一次） | 同上，同调度器 |
| 被夸 pleased | 1.8s 一次 | 消息带夸奖词（`containsPraise` 词表）→ 回答完成的 happy 窗口替换成 pleased；时长与 happy 保持窗口（1800ms）对齐 | ChatPanelHost `onComposerSend` → useBotWorkspace 计数 |
| 惊讶 surprise | 1.2s 一次 | **连点 3 下**彩蛋（梯度：1 击被戳 / 3 击惊讶 / 5 击转晕；surprise 不清点击计数，可继续攒满 5 下升级 dizzy） | mascot-interactions，`data-interact='surprise'` 复用状态关键帧一次性播放 |

两层保险保证不抢业务状态：触发要求 idle（`businessState === 'idle' && !strolling`），渲染层再 gate 一次；散步优先级最高（walk > action > mascotState）。

## 表情增强（豆豆眼 / 东张西望 / 状态小符号）

设计稿是 `expressions-preview.html`（可直接看、可切深色背景），已验收并落地。三个部分：


- **豆豆眼**：眼型从 20×26 改为 **18×32**、中心从 267 上移到 **262**（`BW_EYE_*` 常量，随 `--emit-web` 全局生效——三个尺寸、所有状态动画共用一份几何）。动作关键帧仍与 `mascot-v3.html` 逐字一致，眼型是唯一按验收稿偏离的一处。
- **东张西望**（`data-ambient='look'`）：待机时每隔 **5~9s 随机**来一段 3.3s 的小剧场——眼睛拉长往左上斜看、停一下，甩到右上停一下（冒个「?」），眨眼收尾；头反向微歪，呼吸照常。实现在两个附加图层上：`__tilt`（歪头）与 `__gaze`（双眼整体斜移），不碰身体动画。时机由同一个互动控制器排（`MASCOT_LOOK_STATES = ['idle']`，犯困不张望；悬停 / 点击立即打断）。
- **状态小符号**（`qf-mascot__sym-*`）：八个——思考「…」（三点错开冒）、犯困「zZ」（飘走；笔画 12，79px 下约 1.8px 起步）、提醒「!!」（弹出微抖）、开心「♡」（跳一下）、干活汗滴（球上往下滑）、被戳「!」（随 poke）、转晕星星（绕头顶；1.6 倍，79px 下约 5.9px）、张望「?」（随 look；**几何形弯钩+圆点**，不依赖系统字体，与 zZ 同一套圆头线条语言）。配色规则：**球外符号用球身色、球上符号（汗滴）用眼色**，深浅主题都与底色拉开。跟着球跳的符号（!! ♡ 汗滴 !）画在 `__tilt` 里随球动——球外的同色符号会被蹦上来的球吞掉；飘在空中的（… zZ 星星 ?）画在球外。

两条实现纪律（踩过的坑，改的时候别破坏）：

1. **定位靠外层 `transform` 属性、动画作用在里层元素**——CSS transform 动画会整个顶掉同一元素上的 `transform` 属性，并存时符号会飞到画布角落。
2. 带定位属性的星星等元素在 `prefers-reduced-motion` 下**只停动画不清 transform**，清了同样会飞走。

符号层和张望只渲染在开 `interactive` 且开动画的那只上（侧栏 24px / 设置预览 44px 上符号认不出来，不加）。

**尺寸是有下限的**：画布 512 里球只占 300（余量留给跳跃和歪头），所以球径只有 `size` 的 58.6%。设计稿 `mascot-v3.html` 是 `width=220` → 球径 129px；界面里输入框那只是 79（球径 46.3px —— 64 嫌没动、104 嫌太大，84 之后用户两次要求再小，79 是 46px 球径下限之上能取到的最小整数，再小就得有意识下调下限），侧栏行首 24px（球径 14px）只当「在动」的指示用。动作在所有尺寸下都与设计稿相同，只是等比缩小。改尺寸前先算球径，别只改 `size` 的数字。

## 验收指标（看不到画面，用数字代替眼睛）

| 状态 | 上/下留白 | 首尾帧差 vs 普通步进 | 眼睛高度 | 体积 |
|------|-----------|----------------------|----------|------|
| idle | 90 / 105 | 0.13 vs 0.25 ✅ | 4–56px | 131KB |
| thinking | 76 / 101 | 3.27 vs 7.08 ✅ | 10–78px | 125KB |
| working | 44 / 105 | 18.09 vs 26.48 ✅ | 28–60px | 52KB |
| happy | 44 / 97 | 5.22 vs 25.03 ✅ | 12–28px | 59KB |
| sleepy | 94 / 89 | 0.00 vs 0.04 ✅ | 0–70px | 172KB |
| alert | 32 / 95 | 0.24 vs 4.96 ✅ | 26–56px | 86KB |

- **循环闭合**：6 个状态的姿态函数在 t=0 与 t=1 的 11 个通道差值 ≤1e-15（`working` 的微抖是 `sin(6πt)`，数值上是 1e-15 级），接缝差 ≤ 普通相邻帧差。
- **不出画**：t 扫描 400 点算身体与眼睛外沿，再用成品 GIF 实测四边留白，最紧 32px。
- **网页与 GIF 同源**：18 个关键帧块（6 状态 × 身体 + 左右眼）首尾数值完全一致，每块 51 帧。

## 已知限制

- GIF 只有二值透明，极简版只有纯色不受影响。
- 纯黑球在深色界面上只剩两只白眼睛；要两边都稳用 `slate` 或 `inverse` 配色。
- 体积：512px 单状态 52–172KB（`sleepy` 90 帧最长所以最大），128px 一套更小。
- 采样取每帧**中间时刻**：按帧首采样会漏掉极值帧（`alert` 起跳最高点曾整帧不存在）。
- 想调动作改 `pose_xxx()` 里的关键帧列表：`(时间, 值, 缓动)` 三元组，首末值保持一致即可无缝循环。
