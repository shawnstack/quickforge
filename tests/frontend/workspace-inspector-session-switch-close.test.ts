import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('../../src/App.tsx', import.meta.url), 'utf8')

/**
 * 切换 session 必须把右侧 workspace 面板恢复成「收起」。
 *
 * `WorkspaceInspector` 的 key 是 `projectId:runtimeScopeId`，会话切换只会让子组件
 * 重挂载，不会重置 App 级开合状态。因此开合状态不能是布尔量，否则用户在一个会话
 * 里手动展开过的面板会跨会话残留，表现为「切过去自己就打开了」。现在记的是
 * 「在哪个 runtimeScope 打开的」，派生布尔量，scope 一变即为 false。
 */
describe('workspace inspector closes when the session changes', () => {
  it('derives the open flag from the scope that opened it', () => {
    expect(source).toMatch(/const \[workspaceInspectorOpenScopeId, setWorkspaceInspectorOpenScopeId\] = useState<string \| null>\(null\)/)
    expect(source).toMatch(/const workspaceInspectorOpen = workspaceInspectorOpenScopeId === workspaceInspectorRuntimeScopeId/)
  })

  it('never opens the panel without binding it to the current scope', () => {
    // 打开面板只有三条路径：请求、Inspector 自身 onOpenChange、右上角手动 toggle。
    // 全部必须绑定 runtimeScopeId，不能写裸 true。
    expect(source).not.toMatch(/setWorkspaceInspectorOpen\(true\)/)
    expect(source).toMatch(/setWorkspaceInspectorOpenScopeId\(scope\.runtimeScopeId\)/)
    expect(source).toMatch(/setWorkspaceInspectorOpenScopeId\(open \? workspaceInspectorRuntimeScopeId : null\)/)
  })

  it('does not reset the panel through a setState-in-effect side channel', () => {
    // 派生状态就够了；effect 里同步 setState 会被 react-hooks/set-state-in-effect 拒绝。
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*setWorkspaceInspectorOpenScopeId/)
  })
})
