import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import {
  MASCOT_ARC,
  MASCOT_BODY_SHAPE,
  MASCOT_EYE_SHAPE,
  MASCOT_QUALITY,
  MASCOT_VIEW_BOX,
  type MascotStateId,
} from './mascot-geometry'
import { MASCOT_INTERACTIVE_STATES, MASCOT_LOOK_STATES } from './mascot-interactions'
import { useMascotInteractions } from './use-mascot-interactions'
import './mascot-anim.css'
import './mascot-stroll.css'

/** 一个 bot 的外观：身体色、眼睛色、要不要动。字段与服务端 `bot.mascot` 对齐。 */
export type BotMascotLook = {
  body: string
  eye: string
  animated: boolean
}

const DEFAULT_LOOK: BotMascotLook = { body: '#0B0B0C', eye: '#FFFFFF', animated: true }

/**
 * 质感层（quality-proposal.html 定稿 2026-11-13；01:53 减法更新）：哑光陶瓷光影（顶光/
 * 压暗/环境反光）+ 呼吸。全部是黑白透明渐变，不引入新色相——任意 --body/--eye 换色自动成立。
 * 接触阴影、眼窝微凹、釉面眼已按用户要求移除；呼吸动画在 mascot-anim.css（生成物）。
 */
const Q = MASCOT_QUALITY

/** 全页唯一一份渐变 defs；多个吉祥物共用（复用 id）。 */
const QUALITY_DEFS = (
  <defs>
    <radialGradient id="qf-mascot-sheen" gradientUnits="userSpaceOnUse" cx={Q.sheen.cx} cy={Q.sheen.cy} r={Q.sheen.r}>
      <stop offset="0" stopColor="#fff" stopOpacity={0.3} />
      <stop offset="1" stopColor="#fff" stopOpacity={0} />
    </radialGradient>
    <radialGradient id="qf-mascot-shade" gradientUnits="userSpaceOnUse" cx={256} cy={Q.shade.cy} r={Q.shade.r}>
      <stop offset="0.55" stopColor="#000" stopOpacity={0} />
      <stop offset="1" stopColor="#000" stopOpacity={0.17} />
    </radialGradient>
    <radialGradient id="qf-mascot-rim" gradientUnits="userSpaceOnUse" cx={256} cy={Q.rim.cy} r={Q.rim.r}>
      <stop offset="0" stopColor="#fff" stopOpacity={0.15} />
      <stop offset="1" stopColor="#fff" stopOpacity={0} />
    </radialGradient>
    <clipPath id="qf-mascot-clip">
      <circle cx={MASCOT_BODY_SHAPE.cx} cy={MASCOT_BODY_SHAPE.cy} r={MASCOT_BODY_SHAPE.r} />
    </clipPath>
  </defs>
)


/**
 * bot 的吉祥物：一个圆球 + 两只眼睛（豆豆眼 18×32）。
 *
 * 动作不是这里写的 —— `mascot-anim.css` 由生成脚本输出，关键帧逐字照搬设计稿
 * `mascot-v3.html`（眼型 / 张望 / 符号按 `expressions-preview.html` 验收稿），
 * 所以任何尺寸下都是设计稿那个动作（只是等比缩放）。
 * `docs/design/bot-mascot/series/*.gif` 仍是旧动作，暂未同步。
 * 换颜色只改两个 CSS 变量，不重新生成任何素材。
 */
export function BotMascot({
  state = 'idle',
  size = 24,
  look,
  className,
  title,
  stroll,
  interactive,
}: {
  state?: MascotStateId
  size?: number
  look?: Partial<BotMascotLook>
  className?: string
  /** 给了就作为可读标签暴露给读屏；不给则整体 aria-hidden（纯装饰）。 */
  title?: string
  /**
   * 开启「在顶上溜达」：外面再包一层，负责横向位移。
   * 传 `true` 才开始走（由 `useMascotStroll` 决定时机），不是常驻动画。
   * **传了（哪怕是 false）就始终保留包裹层**：条件渲染会让 SVG 在「走完」那一刻
   * 重新挂载，CSS 动画全部从头开始，眼睛会莫名其妙重眨一次。
   * 只在输入框那种能站人的地方传；侧栏行里不要传。
   */
  stroll?: boolean
  /**
   * 开启互动：悬停抬眼看人、点击被戳瘪、连点 5 下转晕（见 use-mascot-interactions）。
   * 只在待机 / 犯困且开启动画时真正响应；思考、干活、提醒、开心、走路时不理人。
   * 事件只挂在球本体上（`.qf-mascot__ball`），空白处穿透。
   * 这只还会在待机时随机「东张西望」一段（data-ambient），并显示状态小符号
   * （思考 … / 犯困 zZ / 提醒 !! / 开心 ♡ / 干活汗滴 / 被戳 ! / 转晕星星 / 张望 ?）——
   * 都跟着 interactive 走，侧栏 24px 和设置预览 44px 上符号认不出来，不加。
   * 这是纯装饰彩蛋，刻意不进 Tab 序列；只在输入框上方那只传。
   */
  interactive?: boolean
}) {
  const body = look?.body ?? DEFAULT_LOOK.body
  const eye = look?.eye ?? DEFAULT_LOOK.eye
  const animated = look?.animated ?? DEFAULT_LOOK.animated
  // 用的是默认墨黑配色时不写内联颜色，交给 CSS 按主题取色：
  // 深色主题下黑球和背景几乎同色，`mascot-anim.css` 会换成白身黑眼。
  const isDefaultLook =
    body.toUpperCase() === DEFAULT_LOOK.body && eye.toUpperCase() === DEFAULT_LOOK.eye

  const centerX = MASCOT_BODY_SHAPE.cx
  const leftX = centerX - MASCOT_EYE_SHAPE.dx
  const rightX = centerX + MASCOT_EYE_SHAPE.dx

  // 符号层只画在开互动且开动画的那只上（见 interactive 的注释）。
  const showSymbols = Boolean(interactive) && animated

  const { interact, ambient, handlers } = useMascotInteractions(
    Boolean(interactive) && animated && MASCOT_INTERACTIVE_STATES.includes(state),
    showSymbols && MASCOT_LOOK_STATES.includes(state),
  )

  const svg = (
    <svg
      className={cn(
        'qf-mascot',
        !animated && 'qf-mascot--static',
        interactive && 'qf-mascot--interactive',
        className,
      )}
      data-state={state}
      // 动作与设计稿 mascot-v3.html 逐字一致，任何尺寸都只是等比缩放，不再分大小版本。
      data-look={isDefaultLook ? 'default' : undefined}
      // 互动（hover/poke/dizzy）与待机张望（look）由 useMascotInteractions 驱动，详见 mascot-interactions.ts
      data-interact={interact ?? undefined}
      data-ambient={ambient ?? undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${MASCOT_VIEW_BOX} ${MASCOT_VIEW_BOX}`}
      style={
        isDefaultLook
          ? undefined
          : ({ '--qf-mascot-body': body, '--qf-mascot-eye': eye } as CSSProperties)
      }
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {QUALITY_DEFS}
      <g className="qf-mascot__body">
        {/* tilt：张望时的反向微歪头；gaze：双眼整体斜移。平时没有 data-ambient 就是两个普通图层。 */}
        <g className="qf-mascot__tilt">
          <circle
            className="qf-mascot__ball"
            cx={MASCOT_BODY_SHAPE.cx}
            cy={MASCOT_BODY_SHAPE.cy}
            r={MASCOT_BODY_SHAPE.r}
            fill="var(--qf-mascot-body)"
            {...(interactive ? handlers : {})}
          />
          {/* 质感·光影叠加：全部黑白透明渐变（哑光陶瓷），随球变形 */}
          <g className="qf-mascot__ovs" clipPath="url(#qf-mascot-clip)">
            <ellipse className="qf-mascot__ov qf-mascot__shade" cx={MASCOT_BODY_SHAPE.cx} cy={MASCOT_BODY_SHAPE.cy} rx={MASCOT_BODY_SHAPE.r} ry={MASCOT_BODY_SHAPE.r} fill="url(#qf-mascot-shade)" />
            <ellipse className="qf-mascot__ov qf-mascot__sheen" cx={MASCOT_BODY_SHAPE.cx} cy={MASCOT_BODY_SHAPE.cy} rx={MASCOT_BODY_SHAPE.r} ry={MASCOT_BODY_SHAPE.r} fill="url(#qf-mascot-sheen)" />
            <ellipse className="qf-mascot__ov qf-mascot__rim" cx={MASCOT_BODY_SHAPE.cx} cy={MASCOT_BODY_SHAPE.cy} rx={MASCOT_BODY_SHAPE.r} ry={MASCOT_BODY_SHAPE.r} fill="url(#qf-mascot-rim)" />
          </g>
          <g className="qf-mascot__gaze">
            {[
              { side: 'l', x: leftX },
              { side: 'r', x: rightX },
            ].map(({ side, x }) => (
              // 外层只负责摆位置，动画作用在里层元素上（与设计稿的 SVG 结构一致）。
              <g key={side} transform={`translate(${x} ${MASCOT_EYE_SHAPE.cy})`}>
                {/* 01:53 减法定稿：眼窝/釉面眼已移除，纯色豆豆眼（动画类挂回 ellipse，与既有动作一致） */}
                <ellipse
                  className={`qf-mascot__part qf-mascot__eye qf-mascot__eye-${side}`}
                  rx={MASCOT_EYE_SHAPE.rx}
                  ry={MASCOT_EYE_SHAPE.ry}
                  fill="var(--qf-mascot-eye)"
                />
                <path
                  className={`qf-mascot__part qf-mascot__arc qf-mascot__arc-${side}`}
                  d={MASCOT_ARC.d}
                  fill="none"
                  stroke="var(--qf-mascot-eye)"
                  strokeWidth={MASCOT_ARC.width}
                  strokeLinecap="round"
                />
              </g>
            ))}
          </g>
          {showSymbols && (
            <>
              {/* 跟着球跳的符号画在 tilt 里（球一蹦上来，球外的同色符号会被吞掉）。 */}
              {/* 提醒 !!（球身色；瘦长条，轻浮出不抢戏） */}
              <g transform="translate(350 102)" fill="var(--qf-mascot-body)">
                <g className="qf-mascot__sym qf-mascot__sym-bang">
                  <rect x="-15" y="-30" width="10" height="32" rx="5" />
                  <rect x="5" y="-30" width="10" height="32" rx="5" />
                </g>
              </g>
              {/* 开心 ♡（球身色） */}
              <g transform="translate(256 42) scale(2.6)" fill="var(--qf-mascot-body)">
                <g className="qf-mascot__sym qf-mascot__sym-heart">
                  <path d="M 0 6 C -1 3 -5 0 -8 0 C -13 0 -15 4 -15 7 C -15 13 -8 17 0 24 C 8 17 15 13 15 7 C 15 4 13 0 8 0 C 5 0 1 3 0 6 Z" />
                </g>
              </g>
              {/* 干活汗滴（眼色：唯一画在球上的符号） */}
              <g transform="translate(372 196) scale(1.6)">
                <g className="qf-mascot__sym qf-mascot__sym-sweat">
                  <path
                    d="M 0 -16 C 6 -6 10 0 10 6 A 10 10 0 1 1 -10 6 C -10 0 -6 -6 0 -16 Z"
                    fill="var(--qf-mascot-eye)"
                  />
                </g>
              </g>
              {/* 被戳 !（球身色，随 poke；瘦长条，轻浮出停住轻飘走） */}
              <g transform="translate(256 70)" fill="var(--qf-mascot-body)">
                <g className="qf-mascot__sym qf-mascot__sym-poke">
                  <rect x="-5" y="-32" width="10" height="36" rx="5" />
                  <circle cx="0" cy="14" r="6" />
                </g>
              </g>
            </>
          )}
        </g>
        {showSymbols && (
          <>
            {/* 飘在空中的符号画在球外（球身色，深浅主题都与底色拉开）。 */}
            {/* 思考 …：三个点从小到大、由近到远（离球边留足空隙，别像插在头上） */}
            <g className="qf-mascot__sym qf-mascot__sym-dots" fill="var(--qf-mascot-body)">
              <circle cx="398" cy="136" r="9" />
              <circle cx="424" cy="110" r="11.5" />
              <circle cx="452" cy="82" r="15" />
            </g>
            {/* 犯困 zZ：小 z 先起、大 Z 随后（笔画 12，79px 下可辨） */}
            <g
              className="qf-mascot__sym qf-mascot__sym-zz"
              fill="none"
              stroke="var(--qf-mascot-body)"
              strokeWidth="12"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <g transform="translate(404 150) scale(1.05)">
                <path className="qf-mascot__sym-z" d="M -13 -13 H 13 L -13 13 H 13" />
              </g>
              <g transform="translate(432 106) scale(1.6)">
                <path className="qf-mascot__sym-z" d="M -13 -13 H 13 L -13 13 H 13" />
              </g>
            </g>
            {/* 转晕星星：绕头顶一圈（随 dizzy；星形 1.6，79px 下约 5.9px） */}
            <g className="qf-mascot__sym qf-mascot__sym-dizzy">
              <g className="qf-mascot__sym-dizzy-orbit" fill="var(--qf-mascot-body)">
                <path
                  transform="translate(290 84) scale(1.6)"
                  d="M 0 -12 L 3 -3 L 12 0 L 3 3 L 0 12 L -3 3 L -12 0 L -3 -3 Z"
                />
                <path
                  transform="translate(222 84) scale(1.6)"
                  d="M 0 -12 L 3 -3 L 12 0 L 3 3 L 0 12 L -3 3 L -12 0 L -3 -3 Z"
                />
              </g>
            </g>
            {/* 张望 ?（随 data-ambient='look'；几何形：弯钩 + 点，与其他符号同一套线条语言） */}
            <g transform="translate(402 126) scale(1.15)">
              <g className="qf-mascot__sym qf-mascot__sym-quest">
                <path
                  d="M -11 -4 C -11 -14 11 -16 11 -5 C 11 1 0 2 0 9"
                  fill="none"
                  stroke="var(--qf-mascot-body)"
                  strokeWidth="10"
                  strokeLinecap="round"
                />
                <circle cx="0" cy="18" r="5.5" fill="var(--qf-mascot-body)" />
              </g>
            </g>
          </>
        )}
      </g>
    </svg>
  )

  // 没传 stroll 的调用点（侧栏行）保持原来的单层结构。
  if (stroll === undefined) return svg

  // 传了就不卸载包裹层，只切 data 属性 —— 否则「走完」那一刻 SVG 会重新挂载，
  // 所有 CSS 动画从 0% 重来，看起来像突然又眨了一次眼。
  return (
    <span className="qf-mascot-stroll" data-strolling={stroll && animated ? 'true' : 'false'}>
      {svg}
    </span>
  )
}
