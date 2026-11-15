import { readFileSync } from 'node:fs'

function read(relative: string) {
  return readFileSync(new URL(`../../../${relative}`, import.meta.url), 'utf8')
}

/**
 * App 装配层拆分后的统一源码入口：装配与状态仍由 src/App.tsx 持有
 * （hooks 装配、侧栏、详情面板、对话框层），主区 `<main>`（会话顶栏 + 对话区 + 全局终端坞）
 * 在 src/components/app/AppMain.tsx。源码契约测试统一从这里读取，不必每个测试各自拼路径。
 */
export const appAssembly = {
  app: read('src/App.tsx'),
  appMain: read('src/components/app/AppMain.tsx'),
}

/**
 * App 装配层全部源码拼接（App.tsx + components/app/AppMain.tsx），用于跨文件的装配级契约。
 *
 * 注意拼接缝：断言不要跨两份文件匹配（例如带 `[\s\S]` 的宽松正则），
 * 否则可能在「App.tsx 末尾 + AppMain 开头」处命中一段不存在于任一文件的文本。
 */
export function readAppSource(): string {
  return Object.values(appAssembly).join('\n')
}
