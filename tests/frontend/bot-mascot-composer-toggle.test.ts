import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 「在输入框上方显示」开关：bot 设置弹窗里能关，关了输入框上方那只大吉祥物
 * 就不再渲染（侧栏行首的小吉祥物不受影响）。
 *
 * 判据要点（App.tsx）：拿不到 activeBot 时保持显示 —— 和「拿不到就用默认外观」
 * 同一语义；bot 记录明确写了 showOnComposer: false 才隐藏。存量记录没有这个
 * 字段（老服务端进程写出来的），所以前端判据必须是 `!== false` 而不是直接取反。
 */
const appSource = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')
const dialogsSource = readFileSync(
  new URL('../../src/components/bots/BotDialogs.tsx', import.meta.url),
  'utf8',
)
const dataSource = readFileSync(
  new URL('../../src/components/bots/bots-data.ts', import.meta.url),
  'utf8',
)
const serverSource = readFileSync(new URL('../../server/bots.mjs', import.meta.url), 'utf8')
const i18nSource = readFileSync(new URL('../../src/lib/i18n.ts', import.meta.url), 'utf8')

describe('bot 吉祥物「在输入框上方显示」开关', () => {
  it('服务端默认值带 showOnComposer: true，归一化读这个字段', () => {
    expect(serverSource).toContain('showOnComposer: true')
    expect(serverSource).toContain("flag('animated')")
    expect(serverSource).toContain("flag('showOnComposer')")
  })

  it('前端类型与服务端 mascot 一一对应', () => {
    expect(dataSource).toContain('showOnComposer: boolean')
  })

  it('App 的 composerMascot 受开关控制，且拿不到 activeBot 时默认显示', () => {
    expect(appSource).toContain('composerMascot={botMode && composerMascotVisible')
    expect(appSource).toContain(
      'const composerMascotVisible = activeBot ? activeBot.mascot.showOnComposer !== false : true',
    )
  })

  it('设置弹窗里渲染这个开关，切换会写回 showOnComposer', () => {
    expect(dialogsSource).toContain("label={t('botMascotComposer')}")
    expect(dialogsSource).toContain('showOnComposer: mascotDraft.showOnComposer === false')
    // 弹窗草稿的兜底默认值也带上这个字段。
    expect(dialogsSource).toContain('animated: true, showOnComposer: true')
  })

  it('弹窗 header 是「吉祥物 + 名字」的身份行，预览跟草稿联动', () => {
    // 预览从形象区挪到 header：改色实时反馈在弹窗最上方，形象区不再放第二只。
    const headerIdx = dialogsSource.indexOf('border-b border-border px-5 py-3')
    expect(headerIdx).toBeGreaterThan(-1)
    const headerChunk = dialogsSource.slice(headerIdx, headerIdx + 900)
    expect(headerChunk).toContain('BotMascot state="idle" size={44} look={mascotDraft}')
    expect(headerChunk).toContain('{bot.name}')
  })

  it('三处开关走同一个 SwitchRow，不再各写一份', () => {
    const uses = dialogsSource.match(/<SwitchRow/g)?.length ?? 0
    expect(uses).toBe(3)
  })

  it('两种语言都有文案', () => {
    expect(i18nSource).toContain("botMascotComposer: 'Show above the chat input'")
    expect(i18nSource).toContain("botMascotComposer: '在输入框上方显示'")
    expect(i18nSource).toContain('botMascotComposerHint')
  })
})
