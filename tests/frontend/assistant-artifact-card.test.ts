import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../src/components/chat/panel-decoration/assistant-artifact-card.ts', import.meta.url), 'utf8')
const css = readFileSync(new URL('../../src/index.css', import.meta.url), 'utf8')
const actions = readFileSync(new URL('../../src/components/chat/panel-decoration/message-actions.ts', import.meta.url), 'utf8')
const host = readFileSync(new URL('../../src/components/chat/ChatPanelHost.tsx', import.meta.url), 'utf8')
const app = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const i18n = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')
const serverAgent = readFileSync(new URL('../../src/lib/server-agent.ts', import.meta.url), 'utf8')
const inspector = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const workspaceTypes = readFileSync(new URL('../../src/components/workspace/workspace-types.ts', import.meta.url), 'utf8')
const panelDecoration = readFileSync(new URL('../../src/components/chat/panel-decoration.ts', import.meta.url), 'utf8')
const popoverSource = readFileSync(new URL('../../src/components/chat/panel-decoration/rollback-confirm-popover.ts', import.meta.url), 'utf8')
const floatingPosition = readFileSync(new URL('../../src/components/chat/panel-decoration/floating-position.ts', import.meta.url), 'utf8')

describe('assistant artifact card contract', () => {
  it('exports an idempotent final-assistant sync entry point and filters supported sources', () => {
    expect(source).toContain('export function syncAssistantArtifactCard')
    expect(source).toContain('extractArtifactsFromMessages(')
    expect(source).toContain("['write_file', 'edit_file', 'present_files']")
    expect(source).toContain("card.dataset.quickforgeArtifactCard = 'file'")
    expect(source).toContain("card.dataset.quickforgeArtifactCard = 'changed'")
  })

  it('keeps the previous turn cards while a newer artifact-less turn streams', () => {
    // 流式中只 return 不清卡：上一轮产物卡片保留到新轮流式结束。
    expect(source).toMatch(/if \(streaming\) return/)
    // 换卡时机 = 最近一个有文件产物的轮（findLastArtifactTurn 由新向旧按 user 边界扫描）。
    expect(source).toContain('function findLastArtifactTurn(messages')
    expect(source).toContain('const turn = findLastArtifactTurn(messages)')
    // 扫描必须跑在完整 messages 上（产物来自 toolResult.details，displayEntries
    // 只含 user/assistant，用它做提取源会永远为空——刷新/新轮都不出卡）。
    expect(source).toMatch(/extractArtifactsFromMessages\(messages\.slice\(turnStart, end\)/)
    // messages → display 元素经对象身份映射（displayEntries 与 messages 同源同引用）。
    expect(source).toContain('entry.message === turn.lastAssistantMessage')
    expect(source).toContain('if (!turn || !lastAssistantElement) {')
    expect(source).not.toContain('extractCurrentTurnArtifacts')
    // deps 必须带完整 messages。
    expect(source).toMatch(/messages: MessageWithUsage\[\]/)
    expect(actions).toMatch(/messages: getMessages\(\),/)
  })

  it('splits presented files into single-file cards and keeps a changed-files aggregate card', () => {
    expect(source).toContain("export const ASSISTANT_FILE_CARD_CLASS = 'quickforge-assistant-file-card'")
    expect(source).toContain("artifact.source === 'present_files'")
    expect(source).toContain('createPresentedFileCard(artifact, deps)')
    expect(source).toContain('createChangedFilesCard(changed, deps')
    expect(source).toContain("t('assistantArtifactsChangedTitle', { count: artifacts.length })")
    // 单文件卡：类型图标 + 文件名 + 「类别 · KIND」+ 打开菜单；无 diff 统计。
    expect(source).toContain('quickforge-assistant-file-card-icon')
    expect(source).toContain('quickforge-assistant-file-card-name')
    expect(source).toContain('quickforge-assistant-file-card-sub')
    expect(source).toContain('ARTIFACT_KIND_LABELS[artifact.kind')
    // 同一文件一轮内多次写入（不同 toolCallId）/多次 present 不重复显示：
    // 卡片层按路径合并——多次写入 ± 取净变化（Σ加−Σ减，纯新增文件不凭空出 -N，
    // 与 git diff 方向一致），单次调用保留真实 hunk 计数；present 取最新字段。
    expect(source).toContain('function mergeChangedArtifactsByPath')
    expect(source).toContain('function dedupePresentedArtifacts')
    expect(source).toMatch(/presented = dedupePresentedArtifacts\(/)
    expect(source).toMatch(/changed = mergeChangedArtifactsByPath\(/)
    expect(source).toMatch(/Math\.max\(net, 0\)/)
    expect(source).toMatch(/Math\.max\(-net, 0\)/)
  })

  it('collapses the changed-files card by default and preserves expansion across decorations', () => {
    expect(source).toContain('createChangedFilesCard(changed, deps, { expandedByDefault: changedExpanded, onExpandedChange })')
    expect(source).toContain("lastAssistantElement.dataset[EXPANDED_FLAG] === 'true'")
    expect(source).toContain("lastAssistantElement.dataset[EXPANDED_FLAG] = String(expanded)")
    expect(source).toContain("header.setAttribute('aria-expanded', String(expanded))")
    expect(source).toContain("header.addEventListener('click', toggleExpanded)")
    expect(source).toContain('key !== \'Enter\'')
  })

  it('skips rebuilding when signatures match so transient interactions survive decorate cycles', () => {
    expect(source).toContain('plan.element.dataset.quickforgeArtifactSignature = plan.signature')
    expect(source).toContain('card.dataset.quickforgeArtifactSignature === plans[index].signature')
    expect(source).toContain('lastAssistantElement.insertBefore(card, anchor)')
    expect(source).toContain('closeActiveOpenMenu()')
  })

  it('renders per-row review (diff) and open menu actions on changed files', () => {
    expect(source).toContain('quickforge-assistant-artifact-card-review')
    expect(source).toContain("t('assistantArtifactReview')")
    expect(source).toContain('createOpenMenuControl(artifact, deps, true)')
    expect(source).toContain('quickforge-assistant-open-menu')
    expect(source).toContain("t('assistantArtifactPreview')")
    expect(source).toContain("t('assistantArtifactReveal')")
    expect(source).toContain('onReviewFileChanges?.(artifact.path ?? \'\')')
    expect(source).toContain('onRevealFile(artifact.path ?? \'\')')
    expect(source).toContain('onOpenFilePreview(artifact.path ?? \'\')')
    // 行布局：名字 + 路径同行。
    expect(source).toContain('quickforge-assistant-artifact-card-file-path')
  })

  it('keeps the cards before message actions and wires session-file rollback through the shared confirm popover', () => {
    expect(source).toContain("find((candidate) => candidate.parentElement === lastAssistantElement)")
    expect(source).toContain('lastAssistantElement.insertBefore(plan.element, anchor)')
    expect(source).toContain("import { showRollbackConfirmPopover } from './rollback-confirm-popover'")
    expect(source).toContain("'quickforge-rollback-action'")
    expect(source).toContain("t('assistantArtifactRollbackConfirmTitle')")
    expect(source).toContain('rollback.disabled = Boolean(deps.fileChangesRolledBack)')
    expect(source).not.toContain('onRollbackFromMessage')

    expect(actions).toContain("from './rollback-confirm-popover'")
    expect(actions).toContain('onRollbackFiles?: () => Promise<void> | void')
    expect(actions).toContain('onReviewFileChanges?: (relativePath: string) => void')
    expect(actions).toContain('onRevealFile?: (relativePath: string) => void')

    expect(panelDecoration).toContain("export { decorateAssistantArtifactCard, syncAssistantArtifactCard } from './panel-decoration/assistant-artifact-card'")
  })

  it('wires review/reveal/rollback through ChatPanelHost, App, and the server client', () => {
    expect(host).toContain('onRollbackFiles: props.readOnly ? undefined : props.onRollbackFiles')
    expect(host).toContain('onRevealFile: props.readOnly ? undefined : props.onRevealFile')
    expect(host).toContain('onReviewFileChanges: props.onReviewFileChanges')

    expect(app).toContain('reviewFileChangesFromArtifactCard')
    expect(app).toContain("kind: 'review', view: 'changes', path: relativePath")
    expect(app).toContain('revealFileFromArtifactCard')
    expect(app).toContain("openWorkspaceExternal(projectId, relativePath, 'explorer')")
    expect(app).toContain('serverAgent.rollbackFiles()')
    expect(app).toContain('setRolledBackFilesSessionId(null)')

    expect(serverAgent).toContain('/rollback-files')
    expect(serverAgent).toContain('async rollbackFiles(): Promise<ServerFileRollbackResult>')

    // Review 请求支持指定文件直达 diff tab。
    expect(workspaceTypes).toMatch(/kind: 'review'; view: 'review' \| 'changes';[^}]*path\?: string/)
    expect(inspector).toContain('openDiffTabRef')
    expect(inspector).toContain('if (request.path) openDiffTabRef.current?.(request.path, false)')
  })

  it('keeps card surfaces explicit and motion tokenized', () => {
    const shared = css.match(/\.quickforge-assistant-artifact-card,\s*\.quickforge-assistant-file-card\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(shared).toMatch(/border:\s*1px\s+solid/)
    expect(shared).toMatch(/background:\s*var\(--card\)/)
    expect(shared).toMatch(/box-shadow:/)
    expect(shared).toMatch(/border-radius:/)
    // 宽度填满消息容器，与对话正文同宽（无固定像素上限）。
    expect(shared).toMatch(/width:\s*100%/)
    expect(css).not.toContain('620px')
    expect(css).toContain('var(--quickforge-dur-fast) var(--quickforge-ease-out)')
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-open:hover,\s*\.quickforge-assistant-artifact-card-review:hover\s*\{[^}]*background:/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-rollback:hover:not\(:disabled\)\s*\{[^}]*rgb\(185 28 28\)/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-rollback:disabled\s*\{[^}]*opacity:/)
    expect(css).toContain('.quickforge-assistant-open-menu {')
    expect(css).toContain('.quickforge-assistant-artifact-card[data-quickforge-artifact-expanded="true"] .quickforge-assistant-artifact-card-chevron')
    expect(css).toContain('.quickforge-assistant-artifact-card[data-quickforge-artifact-expanded="true"] .quickforge-assistant-artifact-card-details')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })

  it('colors ± stats with the app diff tokens and renders GitHub-style diff bars', () => {
    // ± 红绿与应用 diff 视图同源（亮 green-700/red-700，暗 green-300/red-300）。
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-added\s*\{[^}]*rgb\(21 128 61\)/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-removed\s*\{[^}]*rgb\(185 28 28\)/)
    expect(css).toMatch(/html\.dark \.quickforge-assistant-artifact-card-added\s*\{[^}]*rgb\(134 239 172\)/)
    expect(css).toMatch(/html\.dark \.quickforge-assistant-artifact-card-removed\s*\{[^}]*rgb\(252 165 165\)/)
    expect(css).toContain('.quickforge-assistant-artifact-card-diffbar {')
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-diffbar-add\s*\{[^}]*background:/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-diffbar-del\s*\{[^}]*background:/)
    expect(source).toContain('function createDiffBar')
    // 段宽按 +N/−N 占比 flex 分配；纯新增只有绿段。
    expect(source).toMatch(/element\.style\.flex = `\$\{segment\.value\} 0 0px`/)
    expect(source).toMatch(/if \(segment\.value <= 0\) return/)
  })

  it('pushes header stats to the right and animates expansion with grid rows', () => {
    // 统计组 margin-left:auto：流式 +N 增长只推右侧，不挤压标题。
    expect(source).toContain('quickforge-assistant-artifact-card-header-stats')
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-header-stats\s*\{[^}]*margin-left:\s*auto/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-heading\s*\{[^}]*flex:\s*0 1 auto/)
    // 展开动画：grid-template-rows 0fr→1fr；visibility 延迟切换防折叠区聚焦。
    expect(source).toContain('quickforge-assistant-artifact-card-details-body')
    expect(source).toContain('quickforge-assistant-artifact-card-details-list')
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-details\s*\{[^}]*grid-template-rows:\s*0fr/)
    expect(css).toMatch(/\[data-quickforge-artifact-expanded="true"\] \.quickforge-assistant-artifact-card-details\s*\{[^}]*grid-template-rows:\s*1fr/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-details\s*\{[^}]*visibility:\s*hidden/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-details-body\s*\{[^}]*overflow:\s*hidden/)
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-details-list\s*\{[^}]*padding:/)
  })

  it('escapes clipping with fixed-positioned menus and popovers', () => {
    // 打开菜单与撤销弹层用 fixed 视口定位：逃逸明细动画层 overflow:hidden
    // 与消息列表 overflow-y-auto 的裁剪；滚动/缩放即关闭。
    expect(floatingPosition).toContain('export function positionFixedDropdown')
    expect(source).toContain("import { positionFixedDropdown } from './floating-position'")
    expect(source).toContain('positionFixedDropdown(trigger, menu)')
    expect(source).toMatch(/document\.addEventListener\('scroll', handleScrollOrResize, true\)/)
    expect(popoverSource).toContain("import { positionFixedDropdown } from './floating-position'")
    expect(popoverSource).toContain('positionFixedDropdown(button, popover, 8)')
    expect(popoverSource).toContain("popover.classList.add('quickforge-rollback-popover-up')")
    expect(popoverSource).toMatch(/document\.addEventListener\('scroll', handleScrollOrResize, true\)/)

    const menuBlock = css.match(/\.quickforge-assistant-open-menu\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(menuBlock).toMatch(/position:\s*fixed/)
    expect(menuBlock).not.toMatch(/top:|right:/)
    const popoverBlock = css.match(/\.quickforge-rollback-popover\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(popoverBlock).toMatch(/position:\s*fixed/)
    expect(css).toContain('.quickforge-rollback-popover-up .quickforge-rollback-popover-arrow')
  })

  it('unifies stat and button font sizes with the card type scale', () => {
    // 行内 ± 统计与按钮不再继承消息正文字号（~14px），统一到卡片 12px 档。
    expect(css).toMatch(/\.quickforge-assistant-artifact-card-file-stats\s*\{[^}]*font-size:\s*0\.75rem/)
    const buttonBlock = css.match(/\.quickforge-assistant-artifact-card-open,\s*\.quickforge-assistant-artifact-card-rollback,\s*\.quickforge-assistant-artifact-card-review\s*\{([^}]*)\}/)?.[1] ?? ''
    expect(buttonBlock).toMatch(/font-size:\s*0\.75rem/)
    expect(buttonBlock).not.toMatch(/font:\s*inherit/)
  })

  it('uses the current i18n keys and removes the retired surfaces', () => {
    for (const key of [
      'assistantArtifactsChangedTitle',
      'assistantArtifactPreview',
      'assistantArtifactReveal',
      'assistantArtifactReview',
      'assistantArtifactRollbackConfirmDescription',
    ]) expect(i18n).toContain(`${key}:`)
    // 旧摘要/详情表面及其 key 一并移除。
    for (const legacy of [
      'assistantArtifactsTitle',
      'assistantArtifactsCount',
      'assistantArtifactsDescription',
      'assistantArtifactScope',
      'assistantArtifactDetailsExpand',
      'assistantArtifactDetailsCollapse',
      'quickforge-assistant-artifact-card-footer',
      'quickforge-assistant-artifact-card-detail-body',
      'quickforge-assistant-artifact-card-meta',
      'quickforge-assistant-artifact-card-toggle',
    ]) {
      expect(source).not.toContain(legacy)
      expect(css).not.toContain(legacy)
    }
  })
})
