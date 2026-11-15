import { describe, expect, it } from 'vitest'

import { appTranslations } from '../../src/lib/i18n'

// 占位符形如 {count}，由 t(key, params) 用 replaceAll 填。
// 注意 {{message}} / {{event}} 是 hooks 模板里的**字面**双花括号（示例命令与 body），
// 不是占位符，所以两侧各加一个「不是花括号」的边界判断把它们排除掉。
function placeholders(text: string): string[] {
  const found: string[] = []
  const re = /(?<!\{)\{([A-Za-z_][A-Za-z0-9_]*)\}(?!\})/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) found.push(match[1])
  return [...new Set(found)].sort()
}

const keys = Object.keys(appTranslations.en) as Array<keyof typeof appTranslations.en>

/**
 * t() 的实现是「params 里有哪个名就替换哪个，缺的原样留下 {name}」。
 * 所以只要两种语言的占位符集合不一致，切到另一种语言时就会有人看到裸花括号
 * （或者该显示的数字整个不见）——这类错编译期查不出、运行时不报错，
 * 只会在某个语言下静静显示成 {count}。
 */
describe('i18n 表的跨语言结构约束', () => {
  it('两种语言的键集合完全一致', () => {
    expect(Object.keys(appTranslations.zh).sort()).toEqual([...keys].sort())
  })

  it('每个键在两种语言里都有非空文案', () => {
    const empties = keys.filter((key) => appTranslations.en[key].trim() === '' || appTranslations.zh[key].trim() === '')
    expect(empties).toEqual([])
  })

  it('同一个键在两种语言里的占位符集合一致', () => {
    const mismatched = keys
      .map((key) => ({ key, en: placeholders(appTranslations.en[key]), zh: placeholders(appTranslations.zh[key]) }))
      .filter((entry) => entry.en.join(',') !== entry.zh.join(','))
      .map((entry) => `${entry.key}: en={${entry.en.join(',')}} zh={${entry.zh.join(',')}}`)
    expect(mismatched).toEqual([])
  })
})
