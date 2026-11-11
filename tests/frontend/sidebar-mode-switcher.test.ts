import { describe, expect, it } from 'vitest'
import { appTranslations } from '../../src/lib/i18n'
import { sidebarModule } from './helpers/sidebar-module'

const headerNav = sidebarModule.headerNav
const classes = sidebarModule.classes

describe('sidebar mode switcher', () => {
  it('renders a two-option segmented control under the brand row', () => {
    expect(headerNav).toContain('modeSwitcherTrackClass')
    expect(headerNav).toContain(`role="group" aria-label={t('modeSwitcherLabel')}`)
    expect(headerNav).toContain("onClick={() => selectMode('chat')}")
    expect(headerNav).toContain("onClick={() => selectMode('bot')}")
  })

  it('only shows the segmented control while the sidebar is expanded', () => {
    // 折叠态宽度塞不下两个选项，也不再单独放一枚模式切换图标：
    // 折叠态左上角只留「展开侧栏」入口，切模式必须先把侧栏摊开。
    expect(headerNav).toMatch(/\{sidebarOpen \? \(\s*<div className=\{modeSwitcherTrackClass\}/)
    expect(headerNav).not.toContain('BotAvatar')
    expect(headerNav).not.toContain("t('openBotMode')")
    expect(headerNav).not.toContain("t('backToChats')")
  })

  it('marks the active mode with aria-pressed', () => {
    expect(headerNav).toContain('aria-pressed={!botMode}')
    expect(headerNav).toContain('aria-pressed={botMode}')
  })

  it('does not re-toggle when the already active option is clicked', () => {
    expect(headerNav).toContain("const alreadyActive = next === 'bot' ? botMode : !botMode")
    expect(headerNav).toContain('if (alreadyActive) return')
  })

  it('defines a segmented track with the selected option floating on the page background', () => {
    expect(classes).toContain('export const modeSwitcherTrackClass')
    expect(classes).toContain('bg-muted/50')
    expect(classes).toContain('export const modeSwitcherOptionActiveClass')
    expect(classes).toContain('bg-background')
  })

  it('translates both mode labels in every language', () => {
    expect(appTranslations.en.chatModeLabel).toBeTruthy()
    expect(appTranslations.en.botModeLabel).toBe('BOT')
    expect(appTranslations.en.modeSwitcherLabel).toBeTruthy()
    expect(appTranslations.zh.chatModeLabel).toBeTruthy()
    expect(appTranslations.zh.botModeLabel).toBe('BOT')
    expect(appTranslations.zh.modeSwitcherLabel).toBeTruthy()
  })
})
