import './bot-avatar.css'

/**
 * 黑白色的小机器人头像。
 *
 * 只做线描 + 实心圆点，不填色块 —— 它要能贴着侧栏的图标一起呼吸，
 * 而不是跳出来当一张贴纸。
 *
 * 「点一下会动」的做法：调用方把 `popKey` 加一，svg 因 key 变化重挂，
 * 动画自然重播一次。不常驻、不循环 —— 设计语言里动效是反馈，不是装饰。
 */
export function BotAvatar({
  size = 16,
  popKey = 0,
  className,
}: {
  size?: number
  /** 每次 +1 播一次「眨个眼 + 弹一下」；0 表示还没点过。 */
  popKey?: number
  className?: string
}) {
  return (
    <span
      className={className ? `qf-bot-avatar ${className}` : 'qf-bot-avatar'}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        key={popKey}
        className={popKey > 0 ? 'qf-bot-avatar__svg qf-bot-avatar__svg--pop' : 'qf-bot-avatar__svg'}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* 天线 */}
        <path className="qf-bot-avatar__antenna" d="M12 6.6V3.8" />
        <circle className="qf-bot-avatar__antenna" cx="12" cy="2.7" r="1.05" fill="currentColor" stroke="none" />
        {/* 圆头 */}
        <rect className="qf-bot-avatar__head" x="3.6" y="6.6" width="16.8" height="14" rx="6.6" />
        {/* 眼睛 */}
        <circle className="qf-bot-avatar__eye" cx="9.1" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
        <circle className="qf-bot-avatar__eye" cx="14.9" cy="12.5" r="1.3" fill="currentColor" stroke="none" />
        {/* 嘴 */}
        <path className="qf-bot-avatar__head" d="M10.5 16.1c.85.85 2.15.85 3 0" />
      </svg>
    </span>
  )
}
