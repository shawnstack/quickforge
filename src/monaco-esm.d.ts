// monaco-editor 的深路径 ESM 导入没有各自的类型声明（包内仅 editor.main.d.ts 一份）。
// editor.api 的运行时 API 面与主入口一致，这里复用包类型；editor.all 是纯副作用模块。
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

declare module 'monaco-editor/esm/vs/editor/editor.all'
