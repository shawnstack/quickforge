import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import {
  MASCOT_ARC,
  MASCOT_BODY_SHAPE,
  MASCOT_EYE_SHAPE,
  MASCOT_VIEW_BOX,
  type MascotStateId,
} from './mascot-geometry'
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
 * bot 的吉祥物：一个圆球 + 两只眼睛。
 *
 * 动作不是这里写的 —— `mascot-anim.css` 由生成脚本输出，关键帧逐字照搬设计稿
 * `mascot-v3.html`，所以任何尺寸下都是设计稿那个动作（只是等比缩放）。
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

  const svg = (
    <svg
      className={cn('qf-mascot', !animated && 'qf-mascot--static', className)}
      data-state={state}
      // 动作与设计稿 mascot-v3.html 逐字一致，任何尺寸都只是等比缩放，不再分大小版本。
      data-look={isDefaultLook ? 'default' : undefined}
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
      <g className="qf-mascot__body">
        <circle
          cx={MASCOT_BODY_SHAPE.cx}
          cy={MASCOT_BODY_SHAPE.cy}
          r={MASCOT_BODY_SHAPE.r}
          fill="var(--qf-mascot-body)"
        />
        {[
          { side: 'l', x: leftX },
          { side: 'r', x: rightX },
        ].map(({ side, x }) => (
          // 外层只负责摆位置，动画作用在里层元素上（与设计稿的 SVG 结构一致）。
          <g key={side} transform={`translate(${x} ${MASCOT_EYE_SHAPE.cy})`}>
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
