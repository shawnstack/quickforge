# UX 改进方案：三个高优先级问题

> 本文档为 QuickForge 三个高优先级 UX 问题的详细设计方案。
> 涉及模块：终端 WebSocket 错误反馈、启动错误重试、国际化补全。

---

## 一、WebSocket 连接失败 — UI 反馈方案

### 1.1 现状分析

**涉及文件：**
- `src/components/terminal/TerminalPane.tsx`（WebSocket 连接逻辑）
- `src/components/terminal/TerminalDock.tsx`（终端容器，管理 session 列表）

**当前问题：**
- `TerminalPane` 创建 WebSocket 时没有注册 `error` 事件监听
- `close` 事件只清理了 disposable，没有区分「正常关闭」和「异常断开」
- 连接失败时用户只看到空白终端，无法区分是「正在连接」还是「连接失败」

### 1.2 方案设计

#### 思路

在 `TerminalPane` 组件中增加连接状态管理，通过新增的 `onConnectionError` 回调将错误传递给 `TerminalDock`，由 `TerminalDock` 在终端面板内展示错误提示和重试按钮。

#### 改动 1：TerminalPane 新增连接状态和错误回调

```
props 新增：
  onConnectionError?: (sessionId: string, message: string) => void
```

**关键逻辑变更：**

```tsx
// 新增 state
const [connected, setConnected] = useState(false)

// ws open 时
ws.addEventListener('open', () => {
  setConnected(true)
  // ... 现有 onData 逻辑不变
})

// 新增 ws error 处理
ws.addEventListener('error', () => {
  setConnected(false)
  const msg = t('terminalWsConnectFailed')  // 新增 i18n key
  terminal.writeln(`\x1b[31m${msg}\x1b[0m`)
  onConnectionError?.(session.id, msg)
})

// ws close 时区分是否异常
ws.addEventListener('close', (event) => {
  dataDisposableRef.current?.dispose()
  dataDisposableRef.current = null
  setConnected(false)
  // 非正常关闭（code 1000 是正常关闭）
  if (event.code !== 1000 && !session.exited) {
    const msg = t('terminalWsConnectionLost')  // 新增 i18n key
    terminal.writeln(`\x1b[31m${msg}\x1b[0m`)
    onConnectionError?.(session.id, msg)
  }
})
```

#### 改动 2：TerminalDock 接收并展示连接错误

```
state 新增：
  wsErrors: Record<string, string>   // sessionId -> 错误消息
```

**回调处理：**
```tsx
const handleConnectionError = useCallback((sessionId: string, message: string) => {
  setWsErrors((prev) => ({ ...prev, [sessionId]: message }))
}, [])
```

**UI 展示**：在 session tab 中已有错误条（第 383 行 `error` div），复用同一位置展示 WebSocket 错误。同时在终端面板内叠加一个半透明的错误提示层：

```tsx
// TerminalPane 渲染部分改为：
return (
  <div className={cn(active ? 'h-full min-h-0 w-full relative' : 'hidden')} aria-hidden={!active}>
    <div ref={hostRef} className="h-full w-full" />
    {/* WebSocket 连接错误覆盖层 */}
    {wsError && (
      <div className="absolute inset-0 flex items-center justify-center bg-background/80">
        <div className="text-center text-xs text-muted-foreground">
          <p className="text-destructive">{wsError}</p>
        </div>
      </div>
    )}
  </div>
)
```

**新增 props 传递链：**
```
TerminalDock (管理 wsErrors state)
  → TerminalPane (onConnectionError 回调)
```

#### 改动 3：暗色模式终端主题适配（顺便解决）

根据当前颜色方案动态设置终端主题：

```tsx
const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches

const terminal = new Terminal({
  // ...其他配置不变
  theme: isDark
    ? {
        background: '#0f172a',    // slate-900
        foreground: '#e2e8f0',    // slate-200
        cursor: '#e2e8f0',
        selectionBackground: '#334155',  // slate-700
      }
    : {
        background: '#ffffff',
        foreground: '#1f2937',
        cursor: '#1f2937',
        selectionBackground: '#dbeafe',
      },
})
```

### 1.3 新增 i18n key

| key | en | zh |
|-----|----|----|
| `terminalWsConnectFailed` | Terminal connection failed. The local service may not be running. | 终端连接失败，本地服务可能未运行。 |
| `terminalWsConnectionLost` | Terminal connection lost. | 终端连接已断开。 |

### 1.4 影响范围

| 文件 | 变更类型 |
|------|---------|
| `src/components/terminal/TerminalPane.tsx` | 修改 — 新增 error/close 处理、连接状态、props |
| `src/components/terminal/TerminalDock.tsx` | 修改 — 新增 wsErrors state，传递回调 |
| `src/lib/i18n.ts` | 修改 — 新增 2 个翻译 key |

---

## 二、启动错误 — 重试按钮方案

### 2.1 现状分析

**涉及文件：**
- `src/hooks/useAppBootstrap.ts`（启动逻辑）
- `src/App.tsx`（启动错误展示，第 645-654 行）

**当前问题：**
- `useAppBootstrap` 的 `boot()` 函数在 `useEffect` 中只执行一次，没有暴露 retry 方法
- 启动错误页面只有一个标题和描述文字，没有操作按钮
- 用户遇到启动错误后只能刷新浏览器页面

### 2.2 方案设计

#### 思路

在 `useAppBootstrap` 中暴露 `retry` 函数，由 `App.tsx` 在错误页面渲染"重试"按钮。重试时重置状态并重新执行 `boot()`。

#### 改动 1：useAppBootstrap 暴露 retry 函数

```tsx
// 新增 ref 标记是否已启动过
const bootedRef = useRef(false)

// 将 boot() 提取为可复用的异步函数
const boot = useCallback(async () => {
  // ... 现有 boot 逻辑不变
  // 但移除 cancelled 逻辑中的限制，改为在 retry 时重置 ready 状态
}, [depsRef, storageRef, backendRef, ...])  // 依赖不变

useEffect(() => {
  if (bootedRef.current) return  // retry 时不再自动执行
  bootedRef.current = true
  boot()
  // cleanup 不变
}, [boot])

// 新增 retry
const retry = useCallback(() => {
  setStartupError(undefined)
  setReady(false)
  bootedRef.current = true  // 防止 useEffect 重复执行
  void boot()
}, [boot])

return { ready, startupError, retry }
```

**更精确的做法**：将 `boot` 的核心逻辑提取为独立函数，不依赖 `useCallback` 的闭包稳定性：

```tsx
export function useAppBootstrap({ ... }: UseAppBootstrapOptions) {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()
  const retryRef = useRef<() => void>(() => {})

  useEffect(() => {
    let cancelled = false

    async function boot() {
      // ... 现有 boot 逻辑完全不变
    }

    boot()

    // 新增：将 retry 注册到 ref
    retryRef.current = () => {
      if (!cancelled) {
        cancelled = true  // 取消上一次
        // 需要新建一个新的 cancelled scope
        let retryCancelled = false
        
        setStartupError(undefined)
        setReady(false)

        async function rebo ot() {
          // 与 boot() 相同的逻辑
          // ... 但使用 retryCancelled 而非 cancelled
        }

        reboot()
      }
    }

    return () => {
      cancelled = true
      // ... 现有 cleanup
    }
  }, [/* 现有 deps 不变 */])

  const retry = useCallback(() => retryRef.current(), [])

  return { ready, startupError, retry }
}
```

**最终推荐方案**：保持最简洁的改动，将 `boot` 的主体逻辑提取为可直接重新调用的函数：

```tsx
export function useAppBootstrap({ ... }: UseAppBootstrapOptions) {
  const [ready, setReady] = useState(false)
  const [startupError, setStartupError] = useState<string>()
  const cancelRef = useRef<(() => void) | null>(null)
  const depsRef = useRef({ ... })
  // depsRef 更新逻辑不变 ...

  function createBootTask() {
    let cancelled = false

    async function boot() {
      // ... 现有 boot() 逻辑完全不变
      // 唯一改动：所有 cancelled 判断照旧
    }

    boot()

    return () => { cancelled = true }
  }

  useEffect(() => {
    cancelRef.current = createBootTask()
    return () => { cancelRef.current?.() }
  }, [/* 现有 deps 不变 */])

  const retry = useCallback(() => {
    cancelRef.current?.()       // 取消上一次
    setStartupError(undefined)  // 清除错误
    setReady(false)             // 重置 ready
    cancelRef.current = createBootTask()  // 重新启动
  }, [])

  return { ready, startupError, retry }
}
```

#### 改动 2：App.tsx 错误页面增加重试按钮

```tsx
// 现有（第 645-654 行）
if (startupError) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-lg border border-border bg-card p-5 shadow-sm">
        <h1 className="text-base font-semibold">{t('localServiceUnavailableTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{startupError}</p>
      </div>
    </div>
  )
}

// 改为
if (startupError) {
  return (
    <div className="flex h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm text-center">
        <div className="mx-auto mb-3 inline-flex size-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ServerOff className="size-5" />
        </div>
        <h1 className="text-base font-semibold">{t('localServiceUnavailableTitle')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{startupError}</p>
        <div className="mt-4 flex justify-center gap-2">
          <Button variant="outline" size="sm" onClick={retry}>
            <RefreshCw className="mr-1.5 size-3.5" />
            {t('retry')}
          </Button>
        </div>
      </div>
    </div>
  )
}
```

需要新增 import：
```tsx
import { RefreshCw, ServerOff } from 'lucide-react'
```

`retry` 已存在于 i18n 翻译中（en: "Retry", zh: "重试"），无需新增 key。

### 2.3 影响范围

| 文件 | 变更类型 |
|------|---------|
| `src/hooks/useAppBootstrap.ts` | 修改 — 提取 boot 为可复用函数，新增 retry 导出 |
| `src/App.tsx` | 修改 — 错误页面增加图标、重试按钮、圆角统一 |

---

## 三、国际化补全方案

### 3.1 现状分析

**国际化架构：**
- `src/lib/i18n.ts`：自定义 i18n 方案，`appTranslations` 对象，`en` + `zh` 两种语言
- `t(key, params?)` 函数进行翻译，支持 `{name}` 参数替换
- `AppTextKey` 类型从 `appTranslations.en` 自动推断

**需要补全的文件及硬编码字符串：**

| 文件 | 硬编码语言 | 数量 |
|------|-----------|------|
| `ErrorBoundary.tsx` | 英文 | 3 处 |
| `WorkspaceInspector.tsx` | 英文 | ~20 处 |
| `WorkspaceFileTree.tsx` | 英文 | 1 处 |
| `WorkspaceChangesList.tsx` | 英文 | 7 处 |
| `ShareConversationDialog.tsx` | 中文 | ~30 处 |
| `App.tsx` | 中英混合 | 5 处 |

### 3.2 方案设计

#### 原则

1. **批量新增 i18n key**：在 `appTranslations` 的 `en` 和 `zh` 中一次性添加所有新 key
2. **保持 key 命名一致性**：按 `模块.用途` 模式命名
3. **逐文件替换**：将硬编码字符串替换为 `t()` 调用
4. **参数化动态内容**：如 `{count}`, `{name}` 等

#### 改动 1：新增 i18n key（全部在 `src/lib/i18n.ts` 中）

##### ErrorBoundary 相关

| key | en | zh |
|-----|----|----|
| `errorBoundaryTitle` | Something went wrong | 出了点问题 |
| `errorBoundaryDescription` | An unexpected error occurred. | 发生了意外错误。 |
| `errorBoundaryRetry` | Try again | 重试 |

##### Workspace 相关

| key | en | zh |
|-----|----|----|
| `workspaceTitle` | Workspace | 工作区 |
| `workspaceNoProject` | No project selected | 未选择项目 |
| `workspaceRefresh` | Refresh workspace | 刷新工作区 |
| `workspaceClose` | Close workspace | 关闭工作区 |
| `workspaceTabFiles` | Files | 文件 |
| `workspaceTabGit` | Git | Git |
| `workspaceNoProjectHint` | Select a project to inspect its workspace. | 选择一个项目以查看其工作区。 |
| `workspaceLoading` | Loading workspace... | 正在加载工作区... |
| `workspaceFilterPlaceholder` | Filter files by name or path | 按名称或路径筛选文件 |
| `workspaceFileHint` | Click a file to open the Monaco reader. | 点击文件以在 Monaco 阅读器中打开。 |
| `workspaceGitStaged` | Staged | 已暂存 |
| `workspaceGitChanges` | Changes | 更改 |
| `workspaceGitUntracked` | Untracked | 未跟踪 |
| `workspaceGitConflicts` | Conflicts | 冲突 |
| `workspaceGitReview` | Review | 审查 |
| `workspaceGitCommitMsg` | Commit msg | 提交信息 |
| `workspaceNoGitChanges` | No Git changes. | 没有 Git 更改。 |
| `workspaceNoGitRepo` | This project is not a Git repository. | 此项目不是 Git 仓库。 |
| `workspaceLoadFailed` | Failed to load workspace. | 加载工作区失败。 |
| `workspaceOpenFileFailed` | Failed to open file. | 打开文件失败。 |
| `workspaceOpenDiffFailed` | Failed to open diff. | 打开差异失败。 |
| `workspaceCurrentBranch` | Current branch: {branch} | 当前分支：{branch} |
| `workspaceUnknownBranch` | Unknown branch | 未知分支 |
| `workspaceChangeCount` | {count} change(s) | {count} 处更改 |
| `workspaceStagedChanges` | Staged Changes | 已暂存更改 |
| `workspaceNoFiles` | No files to display. | 没有可显示的文件。 |
| `workspaceNoWorkingTreeChanges` | No working tree changes. | 没有工作树更改。 |

##### WorkspaceChangesList Git 状态

| key | en | zh |
|-----|----|----|
| `gitStatusAdded` | Added | 新增 |
| `gitStatusDeleted` | Deleted | 删除 |
| `gitStatusRenamed` | Renamed | 重命名 |
| `gitStatusUntracked` | Untracked | 未跟踪 |
| `gitStatusConflict` | Conflict | 冲突 |
| `gitStatusModified` | Modified | 已修改 |

##### Share 相关

| key | en | zh |
|-----|----|----|
| `shareDialogTitle` | Share to LAN | 分享到局域网 |
| `shareDialogDescription` | Current conversation: {title}. Each conversation has one fixed share link. Read-only shares can optionally set a password; interactive shares must have a password. | 当前对话：{title}。同一个对话只会有一个固定分享链接；只读分享密码可选，可操作分享必须设置密码。 |
| `sharePermission` | Permission | 权限 |
| `sharePermissionRead` | Read-only | 仅阅读 |
| `sharePermissionReadDesc` | Can only view this conversation. | 只能查看这一个对话。 |
| `sharePermissionOperate` | Interactive (high risk) | 可操作（高危） |
| `sharePermissionOperateDesc` | Allows operating on the original conversation. Fork is disabled. | 允许对方操作这个原对话，禁止 Fork。 |
| `shareHighRiskTitle` | High-risk interactive permission | 高危可操作权限 |
| `shareHighRiskWarning` | Anyone with the link and password can only operate on this one original conversation, but their messages, stop generation, rollback, model/thinking level selection, and YOLO-enabled tools will directly affect your local original conversation with normal conversation permissions. Interactive shares must have a password. | 拥有链接和密码的人只能操作这一个原对话，但对方的消息、停止生成、回滚、模型/思考等级选择、YOLO 状态下可用工具等操作会按正常对话权限直接影响你的本机原对话。可操作分享必须设置密码。 |
| `shareRiskAcceptLabel` | I understand the risks and still allow interactive permission. | 我已了解风险，仍然允许可操作权限。 |
| `sharePasswordRequiredLabel` | Password (required for interactive) | 密码（可操作必填） |
| `sharePasswordOptionalLabel` | Password (optional) | 密码（可选） |
| `sharePasswordRequiredPlaceholder` | Interactive shares must have a password | 可操作分享必须设置密码 |
| `sharePasswordOptionalPlaceholder` | Leave empty for no password protection | 留空则打开链接无需密码 |
| `shareGeneratePassword` | Generate password | 生成密码 |
| `sharePasswordRequiredHint` | Interactive shares require a non-empty password. After changing the password, the old password and unlocked state will become invalid. | 可操作分享必须设置非空密码；修改密码后旧密码和已解锁状态会失效。 |
| `sharePasswordOptionalHint` | Leaving empty removes password protection. Setting a new password invalidates the old one and unlocked state. | 留空保存会取消密码保护；填写新密码保存后旧密码和已解锁状态会失效。 |
| `shareExpiryLabel` | Expiry | 有效期 |
| `shareExpiry1h` | 1 hour | 1 小时 |
| `shareExpiry24h` | 24 hours | 24 小时 |
| `shareExpiry7d` | 7 days | 7 天 |
| `shareExpiryNever` | Permanent, manual revocation required | 永久，需手动撤销 |
| `shareCopiedToClipboard` | Copied to clipboard. | 已复制到剪切板。 |
| `shareExistingShares` | Existing shares | 已有分享 |
| `shareOperateLabel` | Interactive | 可操作 |
| `shareReadonlyLabel` | Read-only | 只读 |
| `shareHasPassword` | Has password | 有密码 |
| `shareNoPassword` | No password | 无密码 |
| `shareRevoked` | Revoked | 已撤销 |
| `shareExpiredAt` | Expires {time} | 到期 {time} |
| `sharePermanent` | Permanent | 永久 |
| `shareCopyLink` | Copy share link | 复制分享链接 |
| `shareRevoke` | Revoke share | 撤销分享 |
| `sharePasswordRequiredError` | Interactive shares must have a password. | 可操作分享必须设置密码。 |
| `shareSaveAndCopyOperate` | Save and copy interactive link | 保存配置并复制高危可操作链接 |
| `shareSaveAndCopy` | Save and copy link | 保存配置并复制链接 |
| `shareFailedToLoad` | Failed to load shares | 加载分享列表失败 |
| `shareFailedToCreate` | Failed to create share | 创建分享失败 |
| `shareFailedToRevoke` | Failed to revoke share | 撤销分享失败 |

##### App.tsx 残余硬编码

| key | en | zh |
|-----|----|----|
| `aiWorkspace` | AI Workspace | AI 工作区 |
| `workspaceButtonLabel` | Workspace | 工作区 |
| `terminalButtonLabel` | Terminal | 终端 |
| `openFileFailedNoProject` | Cannot open file: no project attached to the current conversation. | 无法打开文件：当前对话没有关联项目。 |
| `openFileFailed` | Failed to open file. | 打开文件失败。 |

#### 改动 2：逐文件替换硬编码字符串

##### `src/components/ErrorBoundary.tsx`

```diff
- <h1 className="text-base font-semibold">Something went wrong</h1>
- <p className="mt-2 text-sm text-muted-foreground break-all">
-   {this.state.error.message || 'An unexpected error occurred.'}
- </p>
- <Button variant="outline" size="sm" className="mt-4" onClick={this.handleRetry}>
-   Try again
- </Button>
+ <h1 className="text-base font-semibold">{t('errorBoundaryTitle')}</h1>
+ <p className="mt-2 text-sm text-muted-foreground break-words">
+   {this.state.error.message || t('errorBoundaryDescription')}
+ </p>
+ <Button variant="outline" size="sm" className="mt-4" onClick={this.handleRetry}>
+   {t('errorBoundaryRetry')}
+ </Button>
```

注意：ErrorBoundary 是 class 组件，需要直接 import `t` 函数（顶层 import 即可）。

##### `src/components/workspace/WorkspaceInspector.tsx`

将所有硬编码字符串替换为 `t()` 调用。示例：

```diff
- <div className="truncate text-sm font-semibold text-foreground/90">Workspace</div>
+ <div className="truncate text-sm font-semibold text-foreground/90">{t('workspaceTitle')}</div>

- <div className="truncate text-xs text-muted-foreground/65">{project?.name ?? 'No project selected'}</div>
+ <div className="truncate text-xs text-muted-foreground/65">{project?.name ?? t('workspaceNoProject')}</div>

- {item === 'files' ? 'Files' : `Git${changes.length ? ` ${changes.length}` : ''}`}
+ {item === 'files' ? t('workspaceTabFiles') : `${t('workspaceTabGit')}${changes.length ? ` ${changes.length}` : ''}`}
```

`gitSummary` 函数改造：

```tsx
function gitSummary(branch?: string, counts?: GitStatusResponse['counts']) {
  const parts = [t('workspaceCurrentBranch', { branch: branch || t('workspaceUnknownBranch') })]
  if (counts?.total) parts.push(t('workspaceChangeCount', { count: counts.total }))
  return parts.join(' · ')
}
```

GitGroup 的 title 传入 i18n key 结果：

```tsx
<GitGroup title={t('workspaceGitConflicts')} ... />
<GitGroup title={t('workspaceStagedChanges')} ... />
<GitGroup title={t('workspaceGitChanges')} ... />
<GitGroup title={t('workspaceGitUntracked')} ... />
```

##### `src/components/workspace/WorkspaceFileTree.tsx`

```diff
- return <div className="px-2 py-3 text-xs text-muted-foreground/70">No files to display.</div>
+ return <div className="px-2 py-3 text-xs text-muted-foreground/70">{t('workspaceNoFiles')}</div>
```

##### `src/components/workspace/WorkspaceChangesList.tsx`

```tsx
// statusMeta 改造
function statusMeta(status: GitFileStatus) {
  if (status === 'added') return { label: 'A', text: t('gitStatusAdded'), className: '...' }
  if (status === 'deleted') return { label: 'D', text: t('gitStatusDeleted'), className: '...' }
  // ...同理
}

// 默认 emptyMessage
export function WorkspaceChangesList({
  files, selectedPath, onSelectFile,
  emptyMessage = t('workspaceNoWorkingTreeChanges'),
}: ...) {
```

##### `src/components/share/ShareConversationDialog.tsx`

逐条替换所有中文硬编码为 `t()` 调用。该文件已经 import 了 `t`（第 4 行），改动量最大但模式统一。

关键改动：
- 所有中文 UI 文字 → `t('shareXxx')`
- 错误消息中的英文 → `t('shareFailedToXxx')`
- 暗色模式样式修复（顺便）：

```diff
- className={`... ${permission === 'operate' ? 'border-red-400 bg-red-50 text-red-950' : 'border-border'}`}
+ className={`... ${permission === 'operate' ? 'border-red-400 bg-red-50 text-red-950 dark:border-red-600 dark:bg-red-900/20 dark:text-red-200' : 'border-border'}`}
```

##### `src/App.tsx`

```diff
- '无法打开文件'
- '当前对话没有关联项目。'
+ t('openFileFailedNoProject')

- '打开文件失败'
+ t('openFileFailed')

- "AI Workspace"  (出现 3 次)
+ t('aiWorkspace')

- "Workspace" (aria-label/title)
+ t('workspaceButtonLabel')

- "终端" (aria-label/title)
+ t('terminalButtonLabel')
```

### 3.3 实施顺序

建议按以下顺序逐个文件完成，每完成一个文件就运行 `npm run lint` + `npm run build` 验证：

1. **`src/lib/i18n.ts`** — 先添加所有新 key（一次性）
2. **`ErrorBoundary.tsx`** — 最简单，3 处替换
3. **`WorkspaceFileTree.tsx`** — 1 处替换
4. **`WorkspaceChangesList.tsx`** — 7 处替换
5. **`WorkspaceInspector.tsx`** — ~20 处替换
6. **`ShareConversationDialog.tsx`** — ~30 处替换（最大改动）
7. **`App.tsx`** — 5 处替换

### 3.4 影响范围

| 文件 | 变更类型 | 新增 key 数 |
|------|---------|------------|
| `src/lib/i18n.ts` | 修改 — 新增 ~55 个翻译 key（en + zh） | ~55 |
| `src/components/ErrorBoundary.tsx` | 修改 — 3 处替换 | 0 |
| `src/components/workspace/WorkspaceInspector.tsx` | 修改 — ~20 处替换 | 0 |
| `src/components/workspace/WorkspaceFileTree.tsx` | 修改 — 1 处替换 | 0 |
| `src/components/workspace/WorkspaceChangesList.tsx` | 修改 — 7 处替换 | 0 |
| `src/components/share/ShareConversationDialog.tsx` | 修改 — ~30 处替换 | 0 |
| `src/App.tsx` | 修改 — 5 处替换 | 0 |

---

## 四、实施优先级和依赖关系

```
方案二（启动重试）     ← 最独立，改动最小，可以最先实施
    ↓
方案一（WebSocket 反馈） ← 需要 i18n key，可与方案三并行
    ↓
方案三（国际化补全）    ← 改动量最大，建议分步实施
```

**建议的执行批次：**

| 批次 | 内容 | 预计改动文件数 |
|------|------|--------------|
| 批次 1 | 方案二（启动重试）+ 方案一中新增的 2 个 i18n key | 3 个文件 |
| 批次 2 | 方案三 — ErrorBoundary + Workspace 系列文件 i18n | 5 个文件 |
| 批次 3 | 方案一（TerminalPane WebSocket 错误反馈 + 暗色主题） | 2 个文件 |
| 批次 4 | 方案三 — ShareConversationDialog i18n + App.tsx 残余 | 2 个文件 |

每个批次完成后运行 `npm run lint && npm run build` 验证。
