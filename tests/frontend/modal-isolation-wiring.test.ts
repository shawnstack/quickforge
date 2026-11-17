import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 页面级弹层的接线契约（源码契约法，与 form-labels.test.ts 同一套路）。
// 这三个宿主太大——挂载要 mock 一整页请求——行为面由
// `tests/frontend/modal-isolation.test.ts` 的 jsdom 真渲染覆盖，这里只锁
// 「有没有接上」和「enabled 有没有跟着开关走」：删掉接线、去掉 enabled 都会红。

const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')

function isolationCalls(source: string): string[] {
  return source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('useModalIsolation(') && !line.includes('import'))
}

describe('useModalIsolation 接线面', () => {
  it('页面级弹层：分享操作面板 / 移动端删除确认 / hooks 编辑面板', () => {
    const share = src('components/share/ShareLinksSettingsPage.tsx')
    expect(share).toContain("import { useModalIsolation } from '@/hooks/useModalIsolation'")
    expect(isolationCalls(share)).toContain('useModalIsolation(sheetRef)')

    const mobile = src('components/mobile/MobileServerConnectPage.tsx')
    expect(isolationCalls(mobile)).toContain(
      'useModalIsolation(deleteConfirmRef, { enabled: Boolean(deletingUrl) })',
    )

    const hooks = src('components/settings/tabs/HooksSettingsTab.tsx')
    expect(isolationCalls(hooks)).toContain(
      'useModalIsolation(editorPanelRef, { enabled: editorOpen })',
    )
  })

  it('常挂 + 条件显隐的弹层必须带 enabled：DOM 拔掉不会重跑 effect', () => {
    // 判据本身：去掉 enabled，关闭弹层后 inert 会留在背景上——
    // 组件没卸载、ref 变 null 也不触发 effect，计数永远不归零。
    for (const file of [
      'components/mobile/MobileServerConnectPage.tsx',
      'components/settings/tabs/HooksSettingsTab.tsx',
      'components/bots/BotDialogs.tsx',
    ]) {
      const calls = isolationCalls(src(file))
      expect(calls.length, file).toBeGreaterThan(0)
      for (const call of calls) expect(call, `${file}: ${call}`).toContain('enabled')
    }
  })

  it('非模态弹层不接：页头路径 popover 与代码块语言菜单', () => {
    // SkillsPageHead 的 popover 刻意不声明 aria-modal（页头其余按钮仍可用），
    // 接上隔离会把「重新扫描」之类一起 inert 掉；CodeBlock 的语言菜单同理。
    expect(isolationCalls(src('components/skills/SkillsPageHead.tsx'))).toEqual([])
    expect(isolationCalls(src('components/chat/surface/CodeBlock.tsx'))).toEqual([])
  })
})
