import { loader } from '@monaco-editor/react'
import type { Environment } from 'monaco-editor'

let localMonacoPromise: Promise<void> | undefined

/**
 * 按需加载本地打包的 monaco-editor（editor 核心 + Monarch 基础语言 + editor worker），
 * 并通过 @monaco-editor/react 的 `loader.config` 注册本地实例，
 * 替代默认的 CDN 运行时加载，保证离线环境可用。
 *
 * 只读查看器不需要 json / css / html / ts 语言服务 worker，因此不引入
 * `monaco-editor/esm/vs/language/*` 贡献；Monarch 着色覆盖其余语言，JSON 以纯文本呈现。
 *
 * 模块级单例：重复调用复用同一个初始化 promise；
 * 顶层只 import `loader`（纯 JS，无 DOM / 重型依赖），
 * monaco-editor 与 worker 全部留在函数内动态 import，避免拖入首屏。
 */
export function ensureLocalMonaco(): Promise<void> {
  localMonacoPromise ??= initializeLocalMonaco()
  return localMonacoPromise
}

async function initializeLocalMonaco(): Promise<void> {
  const [monacoModule, editorFeatures, basicLanguages, EditorWorker] = await Promise.all([
    import('monaco-editor/esm/vs/editor/editor.api'),
    import('monaco-editor/esm/vs/editor/editor.all'),
    import('./monaco-basic-languages'),
    import('monaco-editor/esm/vs/editor/editor.worker?worker'),
  ])
  void editorFeatures
  void basicLanguages

  const monacoScope = self as unknown as { MonacoEnvironment?: Environment }
  monacoScope.MonacoEnvironment = {
    getWorker() {
      return new EditorWorker.default()
    },
  }

  loader.config({ monaco: monacoModule })
}
