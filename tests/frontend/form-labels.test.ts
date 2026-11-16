import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// 表单控件与弹层可访问名（源码契约法，与 workbench.test.ts 同一套路：读源码断言关键结构）

const src = (p: string) => readFileSync(new URL(`../../src/${p}`, import.meta.url), 'utf8')
const i18nSource = src('lib/i18n.ts')

describe('表单控件与弹层可访问名（#1 + #2 打包一刀）', () => {
  it('P0：只靠 placeholder 的 14 处控件补上同语义 aria-label', () => {
    const cases: Array<[string, string]> = [
      ['components/agent-profiles/AgentProfilesPage.tsx', "aria-label={t('aiFillAgent')}"],
      ['components/settings/tabs/DefaultOptionsSettingsTab.tsx', "aria-label={t('terminalShellCommand')}"],
      ['components/settings/tabs/ProjectCommandsSettingsTab.tsx', "aria-label={t('commandDirectories')}"],
      ['components/settings/tabs/ArchivedConversationsSettingsTab.tsx', "aria-label={t('searchArchivedConversations')}"],
      ['components/share/ShareLinksSettingsPage.tsx', "aria-label={t('sharePasswordTitle')}"],
      ['components/sidebar/chat-sidebar/SidebarSearchDialog.tsx', "aria-label={t('searchDialog')}"],
      ['components/git/GitCommitPushDialog.tsx', "aria-label={t('gitCommitMessagePlaceholder')}"],
      ['components/settings/custom-providers/connection-section.tsx', "aria-label={t('apiKeyPlaceholder')}"],
      ['components/settings/custom-providers/connection-section.tsx', "aria-label={t('headerName')}"],
      ['components/settings/custom-providers/connection-section.tsx', "aria-label={t('headerValue')}"],
      ['components/project-directory-picker.tsx', "aria-label={t('newDirectoryNamePlaceholder')}"],
      ['components/settings/tabs/LanAccessSettingsTab.tsx', "aria-label={t('lanAccessPassword')}"],
      ['components/dreaming/DreamingSettingsTab.tsx', "aria-label={t('dreamingExperienceSearchPlaceholder')}"],
      ['components/share/SharedConversationPage.tsx', "aria-label={t('sharePasswordTitle')}"],
    ]
    for (const [file, needle] of cases) {
      expect(src(file), file).toContain(needle)
    }
    // 附带：ShareLinksSettingsPage 那个没 htmlFor 的假 label 改 span，不再抢 input 的可访问名
    const shareLinks = src('components/share/ShareLinksSettingsPage.tsx')
    expect(shareLinks).not.toContain("<label className=\"block text-sm font-medium\">{t('sharePasswordTitle')}</label>")
    expect(shareLinks).toContain("<span className=\"block text-sm font-medium\">{t('sharePasswordTitle')}</span>")
  })

  it('P1：settings 行式表单 7 处控件补 aria-label（D1 选 A，不动 DOM 结构）', () => {
    const cases: Array<[string, string]> = [
      ['components/settings/tabs/MemorySettingsTab.tsx', "aria-label={t('memoryContent')}"],
      ['components/mcp-servers-dialog.tsx', "aria-label={t('mcpTabJson')}"],
      ['components/settings/tabs/LanAccessSettingsTab.tsx', "aria-label={t('lanAccessSessionTtl')}"],
      ['components/settings/tabs/ProjectCommandsSettingsTab.tsx', "aria-label={t('project')}"],
      ['components/scheduled-tasks/ScheduledTasksPageSections.tsx', "aria-label={t('rowsPerPage')}"],
      ['components/settings/tabs/ArchivedConversationsSettingsTab.tsx', "aria-label={t('archivedProjectFilter')}"],
      ['components/dreaming/DreamingSettingsTab.tsx', "aria-label={t('dreamingExecuteTime')}"],
    ]
    for (const [file, needle] of cases) {
      expect(src(file), file).toContain(needle)
    }
  })

  it('#2：AttachmentPreviewErrorFallback 的 alertdialog 由标题提供可访问名', () => {
    const file = 'components/chat/surface/AttachmentOverlay.tsx'
    const page = src(file)
    expect(page, file).toContain('role="alertdialog" aria-modal="true" aria-labelledby="attachment-preview-error-title"')
    expect(page, file).toContain('id="attachment-preview-error-title"')
  })

  it('#2：SidebarSearchDialog 弹层与输入框双名，仍共用 searchDialog 键', () => {
    const file = 'components/sidebar/chat-sidebar/SidebarSearchDialog.tsx'
    const page = src(file)
    expect(page, file).toContain("role=\"dialog\" aria-modal=\"true\" aria-label={t('searchDialog')} onMouseDown")
    expect(page, file).toContain("placeholder={t('searchDialog')}")
  })

  it('#2：GitCommitPushDialog 无可见标题，弹层用 gitToolsCommitOrPush 命名', () => {
    const file = 'components/git/GitCommitPushDialog.tsx'
    const page = src(file)
    expect(page, file).toContain("role=\"dialog\" aria-modal=\"true\" aria-label={t('gitToolsCommitOrPush')} onMouseDown")
    expect(page, file).toContain("aria-label={t('gitCommitMessagePlaceholder')}")
  })

  it('#2：App 手机端抽屉补 mobileSidebarName，role/tabIndex/md:hidden 豁免结构原样保留', () => {
    const file = 'App.tsx'
    const page = src(file)
    expect(page, file).toContain("aria-label={t('mobileSidebarName')}")
    expect(page, file).toContain('tabIndex={-1}')
    expect(page, file).toContain('className="fixed inset-0 z-50 outline-none md:hidden"')
    expect(page, file).toContain('role="dialog"')
  })

  it('i18n：3 个新键中英成对、逐字落定（en/zh 各三条）', () => {
    const en = [
      "rowsPerPage: 'Rows per page',",
      "archivedProjectFilter: 'Project filter',",
      "mobileSidebarName: 'Navigation sidebar',",
    ]
    const zh = [
      "rowsPerPage: '每页行数',",
      "archivedProjectFilter: '项目筛选',",
      "mobileSidebarName: '导航侧栏',",
    ]
    for (const line of [...en, ...zh]) {
      expect(i18nSource).toContain(line)
    }
  })

  it('红线回归：name/autoComplete/type 与硬编码 placeholder 一律未动', () => {
    const lan = src('components/settings/tabs/LanAccessSettingsTab.tsx')
    expect(lan).toContain('name="qf-lan-access-password"')
    expect(lan).toContain('autoComplete="new-password"')
    const shareLinks = src('components/share/ShareLinksSettingsPage.tsx')
    expect(shareLinks).toContain('autoComplete="new-password"')
    const sharedPage = src('components/share/SharedConversationPage.tsx')
    expect(sharedPage).toContain('placeholder="密码"')
    // 归档页与全局搜索仍不得共用 searchSettings 键
    const archived = src('components/settings/tabs/ArchivedConversationsSettingsTab.tsx')
    expect(archived).not.toContain("searchSettings")
  })
})
