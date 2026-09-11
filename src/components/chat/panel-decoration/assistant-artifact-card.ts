import type { AgentMessage } from '@earendil-works/pi-agent-core'
import { extractTurnArtifacts, turnRollbackKey, type AiTurnArtifact, type AiTurnArtifactKind } from '@/lib/tool-artifacts'
import { t } from '@/lib/i18n'
import { fileIconUrl } from '../../workspace/file-icon-assets'
import type { WorkspaceExternalOpenTarget } from '../../workspace/workspace-api'
import fileManagerIconUrl from '@/assets/icons/file-manager.svg'
import vscodeIconUrl from '@/assets/icons/vscode.svg'
import ideaIconUrl from '@/assets/icons/idea.svg'
import type { MessageWithUsage } from '../chat-utils'
import { positionFixedDropdown } from './floating-position'

export const ASSISTANT_ARTIFACT_CARD_CLASS = 'quickforge-assistant-artifact-card'
export const ASSISTANT_FILE_CARD_CLASS = 'quickforge-assistant-file-card'

const INCLUDED_SOURCES = new Set<AiTurnArtifact['source']>(['write_file', 'edit_file', 'present_files'])

const ARTIFACT_KIND_LABELS: Record<AiTurnArtifactKind, string> = {
  html: 'HTML',
  image: 'IMG',
  markdown: 'MD',
  code: 'CODE',
  pdf: 'PDF',
  docx: 'DOCX',
  excel: 'XLSX',
  unknown: 'FILE',
}

const ARTIFACT_KIND_CATEGORY_KEYS: Record<AiTurnArtifactKind, string> = {
  html: 'assistantArtifactCategoryWeb',
  image: 'assistantArtifactCategoryImage',
  markdown: 'assistantArtifactCategoryDocument',
  code: 'assistantArtifactCategoryCode',
  pdf: 'assistantArtifactCategoryDocument',
  docx: 'assistantArtifactCategoryDocument',
  excel: 'assistantArtifactCategorySpreadsheet',
  unknown: 'assistantArtifactCategoryFile',
}

// 打开菜单互斥：同一时刻只保留一个打开菜单（跨多张卡片）。
let activeOpenMenuCleanup: (() => void) | null = null

function closeActiveOpenMenu() {
  activeOpenMenuCleanup?.()
  activeOpenMenuCleanup = null
}

type ArtifactCardDeps = {
  panel: HTMLElement
  displayEntries: Array<{ message: MessageWithUsage }>
  messageElements: HTMLElement[]
  /** 完整消息列表（含 toolResult——产物提取依赖其 details；displayEntries 不含）。 */
  messages: MessageWithUsage[]
  streaming: boolean
  onOpenFilePreview?: (relativePath: string) => void
  /** 轮级撤销：按该轮全部 turnId（原 run + 重试 run）回滚新增/修改的文件（readOnly 面板不传 → 不渲染撤销按钮）。 */
  onRollbackTurn?: (turnIds: string[]) => void
  /** 已撤销轮（轮键 = turnIds join('|') 集合）：对应轮卡片按钮置灰为「已撤销」。 */
  rolledBackTurns?: ReadonlySet<string>
  /** 审查单文件改动：打开工作区 Review 面板并直达该文件的 diff。 */
  onReviewFileChanges?: (relativePath: string) => void
  /** 用系统应用打开/定位文件：资源管理器定位（explorer，默认）或 VS Code / IDEA 打开。 */
  onRevealFile?: (relativePath: string, target?: WorkspaceExternalOpenTarget) => void
}

/** 单张 changed 聚合卡的轮级撤销上下文；null（无 turnId / 无入口）不渲染按钮。 */
type TurnRollbackControl = {
  turnIds: string[]
  rolledBack: boolean
} | null

/** 轮首口径与 process-folding 一致：user 与 user-with-attachments 都算轮首。 */
function isUserTurnBoundary(message: { role?: string }) {
  return message.role === 'user' || message.role === 'user-with-attachments'
}

function fileName(path: string) {
  return path.replace(/\\/g, '/').split('/').pop() || path
}

function fileDirectory(path: string) {
  const normalized = path.replace(/\\/g, '/')
  const separator = normalized.lastIndexOf('/')
  return separator > 0 ? normalized.slice(0, separator) : '.'
}

function artifactCategory(kind: AiTurnArtifactKind | undefined) {
  return t(ARTIFACT_KIND_CATEGORY_KEYS[kind ?? 'unknown'] as Parameters<typeof t>[0])
}

function diffTotal(artifacts: AiTurnArtifact[]) {
  return artifacts.reduce((total, artifact) => ({
    added: total.added + (typeof artifact.addedLines === 'number' ? artifact.addedLines : 0),
    removed: total.removed + (typeof artifact.removedLines === 'number' ? artifact.removedLines : 0),
  }), { added: 0, removed: 0 })
}

function artifactPathKey(path: string | undefined) {
  return (path ?? '').replace(/\\/g, '/')
}

/**
 * 同一文件一轮内多次 write/edit（不同 toolCallId）按路径合并为一行：
 * 行序取首次写入位置，kind/preview 取最新一次。多次写入的 ± 显示净变化
 * （Σ加 − Σ减，只落在加或减一侧）——与 git diff / 新增文件的观感一致，
 * 累计 churn 会让「先建后改」的纯新增文件凭空多出 -N；单次调用不进合并
 * 分支，保留真实 hunk 计数（+a −r，与 diff 视图逐段一致）。
 * 提取器按工具调用产出产物（产物面板语义），合并只发生在卡片层。
 */
function mergeChangedArtifactsByPath(artifacts: AiTurnArtifact[]): AiTurnArtifact[] {
  const merged = new Map<string, AiTurnArtifact>()
  for (const artifact of artifacts) {
    const key = artifactPathKey(artifact.path)
    const existing = merged.get(key)
    if (!existing) {
      merged.set(key, artifact)
      continue
    }
    const hasStats = [existing.addedLines, existing.removedLines, artifact.addedLines, artifact.removedLines]
      .some((value) => typeof value === 'number')
    const net = (existing.addedLines ?? 0) + (artifact.addedLines ?? 0)
      - (existing.removedLines ?? 0) - (artifact.removedLines ?? 0)
    merged.set(key, {
      ...artifact,
      addedLines: hasStats ? Math.max(net, 0) : undefined,
      removedLines: hasStats ? Math.max(-net, 0) : undefined,
    })
  }
  return [...merged.values()]
}

/** present_files 重复呈现同一文件：保留首现顺序、字段取最新一次。 */
function dedupePresentedArtifacts(artifacts: AiTurnArtifact[]): AiTurnArtifact[] {
  const merged = new Map<string, AiTurnArtifact>()
  for (const artifact of artifacts) {
    merged.set(artifactPathKey(artifact.path), artifact)
  }
  return [...merged.values()]
}

function createDiffStat(className: string, text: string) {
  const element = document.createElement('span')
  element.className = className
  element.textContent = text
  return element
}

/** GitHub 风格 ± 比例条：段宽按 +N/−N 占比 flex 分配，纯新增只有绿段、纯删除只有红段。 */
function createDiffBar(added: number, removed: number) {
  const bar = document.createElement('span')
  bar.className = 'quickforge-assistant-artifact-card-diffbar'
  bar.setAttribute('aria-hidden', 'true')
  const segments = [
    { className: 'quickforge-assistant-artifact-card-diffbar-add', value: added },
    { className: 'quickforge-assistant-artifact-card-diffbar-del', value: removed },
  ]
  segments.forEach((segment) => {
    if (segment.value <= 0) return
    const element = document.createElement('i')
    element.className = segment.className
    element.style.flex = `${segment.value} 0 0px`
    bar.append(element)
  })
  return bar
}

/** 与工作区文件管理同源的 Material 文件图标：按路径解析（扩展名/特例名），彩色原样呈现。 */
function createFileIcon(className: string, path: string, kind: AiTurnArtifactKind | undefined) {
  const icon = document.createElement('img')
  icon.className = className
  icon.src = fileIconUrl(path)
  icon.alt = ''
  icon.draggable = false
  icon.setAttribute('aria-hidden', 'true')
  icon.title = kind ?? 'unknown'
  return icon
}

/** 打开菜单项图标：品牌图标用图片资源（img），预览用行内描边 SVG。 */
function createImageMenuIcon(url: string) {
  const icon = document.createElement('img')
  icon.className = 'quickforge-assistant-open-menu-icon'
  icon.src = url
  icon.alt = ''
  icon.draggable = false
  icon.setAttribute('aria-hidden', 'true')
  return icon
}

function createStrokeMenuIcon(pathMarkup: string) {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.setAttribute('class', 'quickforge-assistant-open-menu-icon')
  icon.setAttribute('viewBox', '0 0 24 24')
  icon.setAttribute('aria-hidden', 'true')
  icon.innerHTML = pathMarkup
  return icon
}

/**
 * 「打开｜▾」分裂按钮：主区点击直接预览（onOpenFilePreview），箭头区弹出
 * 菜单——文件预览 / 在文件管理器中显示，选择即执行。无预览能力（全局会话
 * 无项目上下文）时主区不渲染，整颗退化为纯菜单形态（wrapper 标记
 * -single，保留「打开 ▾」文字）。无任何可用动作时不渲染。菜单挂 wrapper
 * 内但用 fixed 视口定位（positionFixedDropdown），逃逸明细动画层
 * overflow:hidden 与消息列表滚动裁剪；pointerdown 在外、Escape、滚动/缩放
 * 即关闭；module 级互斥保证同时只有一个菜单。
 */
function createOpenMenuControl(artifact: AiTurnArtifact, deps: ArtifactCardDeps, compact: boolean) {
  const { onOpenFilePreview, onRevealFile } = deps
  if (!artifact.path || (!onOpenFilePreview && !onRevealFile)) return null

  const wrapper = document.createElement('span')
  wrapper.className = 'quickforge-assistant-open-action'

  const canPreview = Boolean(onOpenFilePreview && artifact.path)

  if (canPreview) {
    const main = document.createElement('button')
    main.type = 'button'
    main.className = `quickforge-assistant-artifact-card-open quickforge-assistant-open-main${compact ? ' quickforge-assistant-open-compact' : ''}`
    main.title = t('assistantArtifactPreview')
    const label = document.createElement('span')
    label.textContent = t('assistantArtifactOpen')
    main.append(label)
    main.addEventListener('click', (event) => {
      event.stopPropagation()
      onOpenFilePreview?.(artifact.path ?? '')
    })
    wrapper.append(main)
  } else {
    wrapper.classList.add('quickforge-assistant-open-single')
  }

  const trigger = document.createElement('button')
  trigger.type = 'button'
  trigger.className = `quickforge-assistant-artifact-card-open quickforge-assistant-open-menu-zone${compact ? ' quickforge-assistant-open-compact' : ''}`
  trigger.setAttribute('aria-haspopup', 'menu')
  trigger.setAttribute('aria-expanded', 'false')
  trigger.setAttribute('aria-label', t('assistantArtifactOpenMenu'))
  const caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  caret.setAttribute('class', 'quickforge-assistant-open-caret')
  caret.setAttribute('viewBox', '0 0 24 24')
  caret.setAttribute('aria-hidden', 'true')
  caret.innerHTML = '<path d="m6 9 6 6 6-6"/>'
  if (!canPreview) {
    const label = document.createElement('span')
    label.textContent = t('assistantArtifactOpen')
    trigger.append(label)
  }
  trigger.append(caret)

  let cleanup: (() => void) | null = null

  const closeMenu = () => {
    cleanup?.()
    cleanup = null
    trigger.setAttribute('aria-expanded', 'false')
    if (activeOpenMenuCleanup === close) activeOpenMenuCleanup = null
  }
  activeOpenMenuCleanup = null

  const openMenu = () => {
    closeActiveOpenMenu()
    const menu = document.createElement('div')
    menu.className = 'quickforge-assistant-open-menu'
    menu.setAttribute('role', 'menu')

    // 菜单项与工作区 ProjectOpenMenu 同款图标资源（file-manager/vscode/idea）。
    const items: Array<{ label: string; icon: HTMLElement | SVGElement; action: () => void }> = []
    if (onOpenFilePreview && artifact.path) {
      items.push({
        label: t('assistantArtifactPreview'),
        icon: createStrokeMenuIcon('<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>'),
        action: () => onOpenFilePreview(artifact.path ?? ''),
      })
    }
    if (onRevealFile && artifact.path) {
      const targets: Array<{ target: WorkspaceExternalOpenTarget; label: string; iconUrl: string }> = [
        { target: 'explorer', label: t('assistantArtifactReveal'), iconUrl: fileManagerIconUrl },
        { target: 'vscode', label: t('openInVSCode'), iconUrl: vscodeIconUrl },
        { target: 'idea', label: t('openInIDEA'), iconUrl: ideaIconUrl },
      ]
      for (const { target, label, iconUrl } of targets) {
        items.push({
          label,
          icon: createImageMenuIcon(iconUrl),
          action: () => onRevealFile?.(artifact.path ?? '', target),
        })
      }
    }
    items.forEach((item) => {
      const menuItem = document.createElement('button')
      menuItem.type = 'button'
      menuItem.className = 'quickforge-assistant-open-menu-item'
      menuItem.setAttribute('role', 'menuitem')
      const label = document.createElement('span')
      label.textContent = item.label
      menuItem.append(item.icon, label)
      menuItem.addEventListener('click', (event) => {
        event.stopPropagation()
        closeMenu()
        item.action()
      })
      menu.append(menuItem)
    })

    const handleOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target || wrapper.contains(target)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      closeMenu()
    }
    // fixed 定位不随滚动容器走：滚动/缩放即关，避免菜单悬在错误位置。
    const handleScrollOrResize = () => closeMenu()
    cleanup = () => {
      menu.remove()
      document.removeEventListener('pointerdown', handleOutsidePointerDown, true)
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('scroll', handleScrollOrResize, true)
      window.removeEventListener('resize', handleScrollOrResize)
    }
    activeOpenMenuCleanup = closeMenu

    wrapper.append(menu)
    positionFixedDropdown(trigger, menu)
    trigger.setAttribute('aria-expanded', 'true')
    document.addEventListener('pointerdown', handleOutsidePointerDown, true)
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('scroll', handleScrollOrResize, true)
    window.addEventListener('resize', handleScrollOrResize)
  }

  trigger.addEventListener('click', (event) => {
    event.stopPropagation()
    if (cleanup) closeMenu()
    else openMenu()
  })

  wrapper.append(trigger)
  return wrapper
}

function createReviewButton(artifact: AiTurnArtifact, deps: ArtifactCardDeps) {
  if (!deps.onReviewFileChanges || !artifact.path) return null
  const review = document.createElement('button')
  review.type = 'button'
  review.className = 'quickforge-assistant-artifact-card-review'
  review.textContent = t('assistantArtifactReview')
  review.title = t('assistantArtifactReview')
  review.setAttribute('aria-label', t('assistantArtifactReview'))
  review.addEventListener('click', (event) => {
    event.stopPropagation()
    deps.onReviewFileChanges?.(artifact.path ?? '')
  })
  return review
}

/** present_files 单文件卡：类型图标 + 文件名 + 「类别 · KIND」 + 「打开 ▾」。 */
function createPresentedFileCard(artifact: AiTurnArtifact, deps: ArtifactCardDeps) {
  const card = document.createElement('section')
  card.className = ASSISTANT_FILE_CARD_CLASS
  card.dataset.quickforgeArtifactCard = 'file'
  card.setAttribute('aria-label', artifact.path ?? '')

  card.append(createFileIcon('quickforge-assistant-file-card-icon', artifact.path ?? '', artifact.kind))

  const heading = document.createElement('div')
  heading.className = 'quickforge-assistant-file-card-heading'
  const name = document.createElement('div')
  name.className = 'quickforge-assistant-file-card-name'
  name.textContent = fileName(artifact.path ?? '')
  name.title = artifact.path ?? ''
  const sub = document.createElement('div')
  sub.className = 'quickforge-assistant-file-card-sub'
  sub.textContent = `${artifactCategory(artifact.kind)} · ${ARTIFACT_KIND_LABELS[artifact.kind ?? 'unknown']}`
  heading.append(name, sub)
  card.append(heading)

  const actions = document.createElement('div')
  actions.className = 'quickforge-assistant-file-card-actions'
  const open = createOpenMenuControl(artifact, deps, false)
  if (open) actions.append(open)
  card.append(actions)
  return card
}

/** write/edit 聚合卡：单行折叠头（chevron + N 个文件已更改 + 总 ±行数 + 撤销），展开后是文件行。 */
function createChangedFilesCard(
  artifacts: AiTurnArtifact[],
  deps: ArtifactCardDeps,
  options: { expandedByDefault: boolean; onExpandedChange?: (expanded: boolean) => void; rollback: TurnRollbackControl },
) {
  const { expandedByDefault, onExpandedChange, rollback } = options
  const card = document.createElement('section')
  card.className = ASSISTANT_ARTIFACT_CARD_CLASS
  card.dataset.quickforgeArtifactCard = 'changed'
  card.setAttribute('aria-label', t('assistantArtifactsChangedTitle', { count: artifacts.length }))

  const header = document.createElement('div')
  header.className = 'quickforge-assistant-artifact-card-header'
  header.setAttribute('role', 'button')
  header.tabIndex = 0
  header.setAttribute('aria-expanded', String(expandedByDefault))

  const chevron = document.createElement('span')
  chevron.className = 'quickforge-assistant-artifact-card-chevron'
  chevron.setAttribute('aria-hidden', 'true')
  chevron.innerHTML = '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>'

  const heading = document.createElement('div')
  heading.className = 'quickforge-assistant-artifact-card-heading'
  const title = document.createElement('h3')
  title.className = 'quickforge-assistant-artifact-card-title'
  title.textContent = t('assistantArtifactsChangedTitle', { count: artifacts.length })
  heading.append(title)

  const total = diffTotal(artifacts)
  const hasDiff = artifacts.some((artifact) => artifact.source !== 'present_files' && (
    typeof artifact.addedLines === 'number' || typeof artifact.removedLines === 'number'
  ))
  // 统计组 margin-left:auto 推到右侧：流式 +N 增长只推动右侧，不挤压标题。
  const headerStats = document.createElement('div')
  headerStats.className = 'quickforge-assistant-artifact-card-header-stats'
  // 净变化为 0（文件已 commit/revert，会话累计加减相抵）时不再渲染 +0 -0 统计与 diffbar。
  if (hasDiff && (total.added > 0 || total.removed > 0)) {
    headerStats.append(
      createDiffBar(total.added, total.removed),
      createDiffStat('quickforge-assistant-artifact-card-added', `+${total.added}`),
      createDiffStat('quickforge-assistant-artifact-card-removed', `-${total.removed}`),
    )
  }

  header.append(chevron, heading, headerStats)
  // 轮级撤销按钮：该轮有 turnId（服务端轮回滚支持，含同轮重试 run 的全部
  // turnId）且面板提供入口才渲染；无 turnId（如旧会话产物）不渲染；
  // 已撤销置灰为「已撤销」。
  if (rollback && deps.onRollbackTurn) {
    const { turnIds, rolledBack } = rollback
    const action = document.createElement('span')
    action.className = 'quickforge-rollback-action'
    const rollbackButton = document.createElement('button')
    rollbackButton.type = 'button'
    rollbackButton.className = 'quickforge-assistant-artifact-card-rollback'
    rollbackButton.dataset.quickforgeAction = 'rollback'
    rollbackButton.textContent = rolledBack ? t('assistantArtifactRollbackDone') : t('assistantArtifactRollbackTurn')
    rollbackButton.title = rollbackButton.textContent
    rollbackButton.setAttribute('aria-label', rollbackButton.textContent)
    rollbackButton.setAttribute('aria-haspopup', 'dialog')
    rollbackButton.disabled = rolledBack
    // Keep the parent card's Enter/Space expansion handler from consuming button activation.
    rollbackButton.addEventListener('keydown', (event) => event.stopPropagation())
    rollbackButton.addEventListener('click', (event) => {
      event.stopPropagation()
      deps.onRollbackTurn?.(turnIds)
    })
    action.append(rollbackButton)
    header.append(action)
  }

  const applyExpanded = (expanded: boolean) => {
    card.dataset.quickforgeArtifactExpanded = String(expanded)
    header.setAttribute('aria-expanded', String(expanded))
  }
  const toggleExpanded = () => {
    const expanded = card.dataset.quickforgeArtifactExpanded !== 'true'
    applyExpanded(expanded)
    onExpandedChange?.(expanded)
  }
  header.addEventListener('click', toggleExpanded)
  header.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggleExpanded()
  })

  const details = document.createElement('div')
  details.className = 'quickforge-assistant-artifact-card-details'
  // 三层结构支撑 grid-template-rows 0fr→1fr 展开动画：外层 grid 动画行高、
  // 中层 overflow:hidden 收缩、内层承载 padding（padding 不能放在被钳高的层上）。
  const detailsBody = document.createElement('div')
  detailsBody.className = 'quickforge-assistant-artifact-card-details-body'
  const detailsList = document.createElement('div')
  detailsList.className = 'quickforge-assistant-artifact-card-details-list'
  artifacts.forEach((artifact) => {
    const path = artifact.path ?? ''
    const row = document.createElement('div')
    row.className = 'quickforge-assistant-artifact-card-file'

    row.append(createFileIcon('quickforge-assistant-artifact-card-type', path, artifact.kind))

    const info = document.createElement('div')
    info.className = 'quickforge-assistant-artifact-card-file-info'
    const name = document.createElement('span')
    name.className = 'quickforge-assistant-artifact-card-file-name'
    name.textContent = fileName(path)
    const directory = document.createElement('span')
    directory.className = 'quickforge-assistant-artifact-card-file-path'
    directory.textContent = fileDirectory(path)
    info.append(name, directory)
    info.title = path
    row.append(info)

    const stats = document.createElement('div')
    stats.className = 'quickforge-assistant-artifact-card-file-stats'
    const added = typeof artifact.addedLines === 'number' ? artifact.addedLines : 0
    const removed = typeof artifact.removedLines === 'number' ? artifact.removedLines : 0
    if (added > 0 || removed > 0) {
      stats.append(createDiffBar(added, removed))
    }
    if (added > 0) {
      stats.append(createDiffStat('quickforge-assistant-artifact-card-added', `+${added}`))
    }
    if (removed > 0) {
      stats.append(createDiffStat('quickforge-assistant-artifact-card-removed', `-${removed}`))
    }
    const review = createReviewButton(artifact, deps)
    if (review) stats.append(review)
    const open = createOpenMenuControl(artifact, deps, true)
    if (open) stats.append(open)
    row.append(stats)

    detailsList.append(row)
  })
  detailsBody.append(detailsList)
  details.append(detailsBody)

  applyExpanded(expandedByDefault)
  card.append(header, details)
  return card
}

type CardPlan = {
  signature: string
  element: HTMLElement
}

function buildCardPlans(
  artifacts: AiTurnArtifact[],
  deps: ArtifactCardDeps,
  options: { changedExpanded: boolean; onExpandedChange?: (expanded: boolean) => void; rollback: TurnRollbackControl },
): CardPlan[] {
  const plans: CardPlan[] = []
  const presented = dedupePresentedArtifacts(artifacts.filter((artifact) => artifact.source === 'present_files'))
  const changed = mergeChangedArtifactsByPath(artifacts.filter((artifact) => artifact.source !== 'present_files'))
  presented.forEach((artifact) => {
    plans.push({
      signature: `file:${artifact.source}:${artifact.path}:${artifact.kind}:${artifact.preview ? 1 : 0}:${artifact.command ?? ''}`,
      element: createPresentedFileCard(artifact, deps),
    })
  })
  if (changed.length > 0) {
    const total = diffTotal(changed)
    // 撤销态进签名：rolledBackTurns 变化 → 签名变化 → 该轮卡重建为「已撤销」
    // 禁用态；turnIds 一并进签名——重试在同轮追加新 turnId 时重建卡片，按钮
    // 闭包才能拿到完整的 turnId 集合。
    const rollback = options.rollback && deps.onRollbackTurn ? options.rollback : null
    plans.push({
      signature: `changed:${changed.map((artifact) => `${artifact.source}:${artifact.path}:${artifact.kind}:${artifact.addedLines ?? ''}:${artifact.removedLines ?? ''}:${artifact.preview ? 1 : 0}`).join('|')}:${total.added}:${total.removed}:${rollback ? `${rollback.rolledBack ? 2 : 1}:${rollback.turnIds.join(',')}` : 0}:${deps.onReviewFileChanges ? 1 : 0}:${deps.onRevealFile ? 1 : 0}`,
      element: createChangedFilesCard(changed, deps, {
        expandedByDefault: options.changedExpanded,
        onExpandedChange: options.onExpandedChange,
        rollback,
      }),
    })
  }
  return plans
}

/**
 * 孤儿卡清理：只删不在任何有效轮宿主内的卡（宿主被 Lit 重渲染摘除、轮产物随
 * 压缩/回滚消失、或没有任何轮再有产物）；宿主内的卡由各宿主的签名幂等更新负责。
 */
function removeOrphanArtifactCards(panel: HTMLElement, validHosts: ReadonlySet<HTMLElement>) {
  const orphans = Array.from(panel.querySelectorAll<HTMLElement>('[data-quickforge-artifact-card]'))
    .filter((card) => !card.parentElement || !validHosts.has(card.parentElement))
  if (orphans.length === 0) return
  // 卡片移除时同步关闭 fixed 打开菜单：菜单虽随 wrapper 从 DOM 摘除，
  // 但 document 级关闭监听要靠 closeMenu 清理，不能等下次交互。
  closeActiveOpenMenu()
  orphans.forEach((card) => card.remove())
}

/** 展开态跨装饰保留：挂在宿主消息元素 dataset 上（Lit 复用元素，比卡片本身活得久）。 */
const EXPANDED_FLAG = 'quickforgeArtifactCardExpanded'

function syncAnchor(hostElement: HTMLElement) {
  const actions = Array.from(hostElement.querySelectorAll<HTMLElement>('.quickforge-message-actions'))
    .find((candidate) => candidate.parentElement === hostElement)
  return actions ?? hostElement.querySelector<HTMLElement>(':scope > .quickforge-goal-iteration-divider') ?? null
}

/** 一个轮的挂卡目标：该轮产物（已按卡片口径过滤）+ 轮标识（该轮全部 turnId，轮级撤销用）。 */
type TurnCardTarget = {
  artifacts: AiTurnArtifact[]
  turnIds: string[]
}

/**
 * Sync the per-turn artifact cards: one card group below each turn's last
 * assistant message (streaming keeps the previous cards mounted).
 */
export function syncAssistantArtifactCard(deps: ArtifactCardDeps) {
  const { panel, displayEntries, messageElements, messages, streaming } = deps
  // 新一轮流式中不清卡：各轮已挂卡片保留到该轮流式结束，由下一个 idle sync
  // 按轮增量更新（无新产物的轮签名一致原地不动）。
  if (streaming) return

  // 每轮一张卡，显示「该轮新增」产物：按 user 边界切片提取（提取跑在完整
  // messages 上——产物来自 toolResult.details，displayEntries 过滤掉了它们）。
  // 轮与展示分段按边界消息对象对齐（Lit 复用/窗口裁剪下引用不变）。
  const turnByBoundary = new Map<MessageWithUsage, TurnCardTarget>()
  let leadingTurn: TurnCardTarget | undefined
  for (const turn of extractTurnArtifacts(messages as unknown as AgentMessage[])) {
    const artifacts = turn.artifacts.filter((artifact) => Boolean(artifact.path) && INCLUDED_SOURCES.has(artifact.source))
    if (artifacts.length === 0) continue
    const target: TurnCardTarget = { artifacts, turnIds: turn.turnIds }
    if (turn.userIndex < 0) leadingTurn = target
    else turnByBoundary.set(messages[turn.userIndex] as MessageWithUsage, target)
  }

  // displayEntries 按同样用户消息边界切段，每段最后一个 assistant 挂该轮卡；
  // 无 assistant（如轮首后紧跟错误/空响应）或无产物的轮不挂卡；首条 user 之前
  // 的前置段对应 userIndex = -1 的前置组。
  const validHosts = new Set<HTMLElement>()
  const hosts: Array<{ element: HTMLElement; turn: TurnCardTarget }> = []
  let segmentStart = 0
  while (segmentStart < displayEntries.length) {
    const leading = segmentStart === 0 && !isUserTurnBoundary(displayEntries[0].message)
    let segmentEnd = segmentStart + (leading ? 0 : 1)
    while (segmentEnd < displayEntries.length && !isUserTurnBoundary(displayEntries[segmentEnd].message)) segmentEnd += 1
    const turn = leading ? leadingTurn : turnByBoundary.get(displayEntries[segmentStart].message)
    if (turn) {
      let lastAssistantIndex = -1
      for (let index = segmentEnd - 1; index >= segmentStart; index -= 1) {
        if (displayEntries[index].message.role === 'assistant') {
          lastAssistantIndex = index
          break
        }
      }
      const hostElement = lastAssistantIndex >= 0 ? messageElements[lastAssistantIndex] : undefined
      if (hostElement) {
        validHosts.add(hostElement)
        hosts.push({ element: hostElement, turn })
      }
    }
    segmentStart = segmentEnd
  }

  removeOrphanArtifactCards(panel, validHosts)

  for (const { element: hostElement, turn } of hosts) {
    // 展开态读宿主级标记（dataset 挂宿主元素，多卡天然互不串扰）。
    const changedExpanded = hostElement.dataset[EXPANDED_FLAG] === 'true'
    const anchor = syncAnchor(hostElement)
    const existingCards = Array.from(
      hostElement.querySelectorAll<HTMLElement>('[data-quickforge-artifact-card]'),
    ).filter((card) => card.parentElement === hostElement)

    // turnIds 为空（如旧会话产物）→ 不渲染撤销按钮；已撤销轮（轮键 =
    // turnIds join('|')）置灰为「已撤销」。
    const rollback: TurnRollbackControl = turn.turnIds.length > 0 && deps.onRollbackTurn
      ? { turnIds: turn.turnIds, rolledBack: deps.rolledBackTurns?.has(turnRollbackKey(turn.turnIds)) === true }
      : null
    const plans = buildCardPlans(turn.artifacts, deps, {
      changedExpanded,
      onExpandedChange: (expanded) => {
        hostElement.dataset[EXPANDED_FLAG] = String(expanded)
      },
      rollback,
    })

    // 签名一致时只校正位置，不重建：保留展开态、打开菜单与确认弹层（decorate
    // 在面板任意 DOM 变化时都会重跑，重建会把瞬态交互状态全部冲掉）。
    const unchanged = existingCards.length === plans.length
      && existingCards.every((card, index) => card.dataset.quickforgeArtifactSignature === plans[index].signature)
    if (unchanged) {
      existingCards.forEach((card) => {
        if (card !== (anchor?.previousElementSibling ?? hostElement.lastElementChild)) {
          hostElement.insertBefore(card, anchor)
        }
      })
      continue
    }

    // 只重建本宿主的卡（其余轮的卡不动）；摘卡前关闭 fixed 打开菜单。
    if (existingCards.length > 0) closeActiveOpenMenu()
    existingCards.forEach((card) => card.remove())
    plans.forEach((plan) => {
      plan.element.dataset.quickforgeArtifactSignature = plan.signature
      hostElement.insertBefore(plan.element, anchor)
    })
  }
}

export function decorateAssistantArtifactCard(deps: ArtifactCardDeps) {
  syncAssistantArtifactCard(deps)
}
