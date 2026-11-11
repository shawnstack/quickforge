import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 侧栏一行里只该出现一次名字。
 *
 * 早先这里右边还有一截「目录尾段」标签，取的是 `workspacePath` 的最后一段。当时目录名
 * 就等于 bot 名（`bots/<名字>`），所以每行看起来是把名字写了两遍。
 *
 * 后来目录名改成 `bot-<id 前 8 位>`（`server/bots.mjs` 的 `botWorkspacePath`），跟名字
 * 彻底解耦，那截标签就更没意义了 —— 显示出来只是一串无语义的 id。所以整块删掉，
 * 这条测试守住「别再把它加回来」。
 */
const source = readFileSync(
  new URL('../../src/components/bots/BotSidebarList.tsx', import.meta.url),
  'utf8',
)

describe('bot 侧栏的行', () => {
  it('行内渲染 bot.name', () => {
    expect(source).toContain('{bot.name}')
  })

  it('不再引用 workspacePath', () => {
    expect(source).not.toContain('workspacePath')
  })

  it('不再有目录标签相关的辅助函数', () => {
    expect(source).not.toContain('botWorkspaceLabel')
    expect(source).not.toContain('shouldShowWorkspaceLabel')
  })
})
