import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * bot 列表拖动排序 + bot 改名 的接线守护（源码断言，与 bot-sidebar-no-workspace-label 同风格）。
 *
 * 排序走的是项目列表的同一条路：行内 dnd-kit（PointerSensor 6px 激活，和点击共存）
 * → onReorderBots(orderedIds) → 宿主乐观重排 → PUT /api/bots/reorder 落盘 sortOrder。
 * 顺序必须由服务端持有：refreshBots 会整组覆盖 setBots，纯前端顺序活不过下一次刷新。
 *
 * 改名走的是 PATCH /api/bots/:id 的 name 字段（服务端早已支持），弹窗头部就地编辑；
 * 服务端负责同步 projects.json 的项目名和会话标题（那边有自己的路由测试）。
 */

function src(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}

describe('bot 列表拖动排序', () => {
  const list = src('../../src/components/bots/BotSidebarList.tsx')
  const data = src('../../src/components/bots/bots-data.ts')
  const sidebar = src('../../src/components/sidebar/ChatSidebar.tsx')

  it('列表行由 dnd-kit 包裹，且只有多于一个 bot 时才可拖', () => {
    expect(list).toContain('DndContext')
    expect(list).toContain('SortableContext')
    expect(list).toContain('verticalListSortingStrategy')
    expect(list).toContain('bots.length > 1')
  })

  it('拖拽与点击共存：6px 激活约束（和项目列表同一颗 PointerSensor）', () => {
    expect(list).toContain('PointerSensor')
    expect(list).toContain("activationConstraint: { distance: 6 }")
  })

  it('拖完把新顺序的 id 列表交给宿主，而不是自己发请求', () => {
    expect(list).toContain('arrayMove')
    expect(list).toContain('onReorderBots(arrayMove(bots, from, to).map((bot) => bot.id))')
  })

  it('数据层存在 reorderBots，打 PUT /api/bots/reorder', () => {
    expect(data).toContain("export async function reorderBots(orderedIds: string[])")
    expect(data).toContain("'/api/bots/reorder'")
    expect(data).toContain("method: 'PUT'")
  })

  it('宿主乐观重排，失败用 refreshBots 回滚（服务端持有顺序）', () => {
    // 拖动排序的宿主逻辑已迁入 useBotWorkspace（App 装配层挂载 hook）。
    const botWorkspace = src('../../src/hooks/useBotWorkspace.ts')
    expect(botWorkspace).toContain('handleReorderBots')
    expect(botWorkspace).toContain('await reorderBots(orderedIds)')
    expect(botWorkspace).toContain('void refreshBots()')
  })

  it('ChatSidebar 把 onReorder 传进列表', () => {
    expect(sidebar).toContain('onReorderBots={botShell.onReorder}')
  })
})

describe('bot 改名', () => {
  const dialogs = src('../../src/components/bots/BotDialogs.tsx')

  it('设置弹窗头部有就地改名入口，走 PATCH 的 name 字段', () => {
    expect(dialogs).toContain('submitRename')
    expect(dialogs).toContain("patchBot(bot.id, { name: trimmed })")
  })

  it('Enter 提交、Escape 只取消改名（不把整个弹窗关掉）', () => {
    expect(dialogs).toContain("event.key === 'Enter'")
    expect(dialogs).toContain("event.key === 'Escape'")
    expect(dialogs).toContain('event.stopPropagation()')
  })

  it('重名报错保留草稿，不默默回退', () => {
    expect(dialogs).toContain('renameError')
  })
})
