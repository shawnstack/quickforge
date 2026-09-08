import { t } from '@/lib/i18n'
import { positionFixedDropdown } from './floating-position'

/**
 * 共享的回滚确认弹层：挂在 `.quickforge-rollback-action` 包装器内，用于
 * 消息级回滚（message-actions）和会话文件撤销（assistant-artifact-card）。
 * onConfirm 为无参回调，调用方自行闭包所需上下文。弹层用 fixed 视口定位
 * （positionFixedDropdown，下方空间不足向上翻转）：卡片常位于最后一条
 * 消息底部，absolute 会被消息列表滚动容器和明细动画层裁剪。
 */

type RollbackPopoverElement = HTMLElement & {
  quickforgeCleanup?: () => void
}

export function removeRollbackConfirmPopover(panel: HTMLElement) {
  panel.querySelectorAll<RollbackPopoverElement>('.quickforge-rollback-popover').forEach((popover) => {
    popover.quickforgeCleanup?.()
    const wrapper = popover.closest<HTMLElement>('.quickforge-rollback-action')
    const trigger = wrapper?.querySelector<HTMLButtonElement>('button[data-quickforge-action="rollback"]')
    trigger?.setAttribute('aria-expanded', 'false')
    popover.remove()
  })
}

export function showRollbackConfirmPopover(options: {
  panel: HTMLElement
  button: HTMLButtonElement
  title: string
  description: string
  onConfirm: () => Promise<void> | void
}) {
  const { panel, button, title, description, onConfirm } = options
  const wrapper = button.closest<HTMLElement>('.quickforge-rollback-action')
  if (!wrapper || button.disabled) return

  const existing = wrapper.querySelector<RollbackPopoverElement>('.quickforge-rollback-popover')
  if (existing) {
    removeRollbackConfirmPopover(panel)
    return
  }

  removeRollbackConfirmPopover(panel)

  const popover = document.createElement('div') as RollbackPopoverElement
  popover.className = 'quickforge-rollback-popover'
  popover.setAttribute('role', 'dialog')
  popover.setAttribute('aria-label', title)
  popover.tabIndex = -1

  const arrow = document.createElement('div')
  arrow.className = 'quickforge-rollback-popover-arrow'

  const titleElement = document.createElement('div')
  titleElement.className = 'quickforge-rollback-popover-title'
  titleElement.textContent = title

  const descriptionElement = document.createElement('div')
  descriptionElement.className = 'quickforge-rollback-popover-description'
  descriptionElement.textContent = description

  const footer = document.createElement('div')
  footer.className = 'quickforge-rollback-popover-footer'

  const cancelButton = document.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'quickforge-rollback-popover-cancel'
  cancelButton.textContent = t('cancel')

  const confirmButton = document.createElement('button')
  confirmButton.type = 'button'
  confirmButton.className = 'quickforge-rollback-popover-confirm'
  confirmButton.textContent = t('confirmRollback')

  footer.append(cancelButton, confirmButton)
  popover.append(arrow, titleElement, descriptionElement, footer)

  const close = () => removeRollbackConfirmPopover(panel)
  const handleOutsidePointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null
    if (!target || popover.contains(target) || button.contains(target)) return
    close()
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    close()
  }
  // fixed 定位不随滚动容器走：滚动/缩放即关，避免弹层悬在错误位置。
  const handleScrollOrResize = () => close()

  popover.quickforgeCleanup = () => {
    document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
    document.removeEventListener('keydown', handleKeyDown)
    document.removeEventListener('scroll', handleScrollOrResize, true)
    window.removeEventListener('resize', handleScrollOrResize)
  }
  popover.addEventListener('pointerdown', (event) => event.stopPropagation())
  popover.addEventListener('click', (event) => event.stopPropagation())
  cancelButton.addEventListener('click', close)
  confirmButton.addEventListener('click', async () => {
    confirmButton.disabled = true
    cancelButton.disabled = true
    confirmButton.textContent = t('rollingBack')
    try {
      await onConfirm()
    } finally {
      close()
    }
  })

  wrapper.append(popover)
  if (positionFixedDropdown(button, popover, 8)) {
    popover.classList.add('quickforge-rollback-popover-up')
  }
  button.setAttribute('aria-expanded', 'true')
  document.addEventListener('pointerdown', handleOutsidePointerDown, true)
  document.addEventListener('keydown', handleKeyDown)
  document.addEventListener('scroll', handleScrollOrResize, true)
  window.addEventListener('resize', handleScrollOrResize)
  window.requestAnimationFrame(() => confirmButton.focus())
}
