import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function read(relative: string) {
  // 与 tests/helpers/app-css.ts 同款：jsdom 环境下 import.meta.url 不是 file scheme，用 process.cwd() 兜底
  return readFileSync(join(process.cwd(), relative), 'utf8')
}

/**
 * ChatSidebar 模块拆分后的统一源码入口：公共入口 ChatSidebar.tsx 保持装配层，
 * 叶子组件 / 类名 / hooks 位于 src/components/sidebar/chat-sidebar/。
 * 源码契约测试统一从这里读取，避免每个测试散落各自的 readFileSync 路径。
 */
export const sidebarModule = {
  chatSidebar: read('src/components/sidebar/ChatSidebar.tsx'),
  classes: read('src/components/sidebar/chat-sidebar/sidebar-classes.ts'),
  utils: read('src/components/sidebar/chat-sidebar/sidebar-utils.ts'),
  sessionRow: read('src/components/sidebar/chat-sidebar/SidebarSessionRow.tsx'),
  sessionDisplayControls: read('src/components/sidebar/chat-sidebar/SessionDisplayControls.tsx'),
  sessionTitleMarquee: read('src/components/sidebar/chat-sidebar/SessionTitleMarquee.tsx'),
  sessionHoverTip: read('src/components/sidebar/chat-sidebar/SessionHoverTip.tsx'),
  viewSortMenu: read('src/components/sidebar/chat-sidebar/ViewSortMenu.tsx'),
  projectMenu: read('src/components/sidebar/chat-sidebar/ProjectMenu.tsx'),
  searchDialog: read('src/components/sidebar/chat-sidebar/SidebarSearchDialog.tsx'),
  headerNav: read('src/components/sidebar/chat-sidebar/SidebarHeaderNav.tsx'),
  footer: read('src/components/sidebar/chat-sidebar/SidebarFooter.tsx'),
  useSidebarResize: read('src/components/sidebar/chat-sidebar/useSidebarResize.ts'),
  useSidebarSessionDisplay: read('src/components/sidebar/chat-sidebar/useSidebarSessionDisplay.ts'),
  sortableItems: read('src/components/sidebar/chat-sidebar/SortableSidebarItems.tsx'),
}

/** ChatSidebar 模块全部源码拼接（入口 + chat-sidebar/ 目录），用于跨文件的模块级契约。 */
export const sidebarModuleSource = Object.values(sidebarModule).join('\n')
