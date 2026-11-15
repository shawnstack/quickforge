import { describe, expect, it } from 'vitest'

import { t } from '../../src/lib/i18n'

// t() 的插值是 `text.replaceAll(占位符, String(value))`。当 value 是**运行期字符串**
// （git 分支名、文件路径、命令原文、插件名…）时，第二参是字符串就会让
// String.prototype.replaceAll 把 $& / $$ / $` / $' / $1 当成替换语义解释：
// 插进去的值被吃掉、占位符原样留着，界面静默显示错字，没有任何报错。
// 与 925cf0ac（edit_file 的 newText）、b649c481（自定义命令的 $ARGUMENTS）同族。
describe('t() placeholder interpolation', () => {
  it('inserts the value verbatim when it contains dollar sequences', () => {
    const value = 'keep $& and $` and $\' and $$ and $1 exactly'
    const text = t('modelsCount', { count: value })
    expect(text).toContain(value)
  })

  it('does not leave the placeholder behind when the value looks like a replacement pattern', () => {
    const text = t('modelsCount', { count: '$&' })
    expect(text).not.toContain('{count}')
    expect(text).toContain('$&')
  })

  it('does not drop the value when it means "text before the match"', () => {
    const text = t('modelsCount', { count: '$`' })
    expect(text).toContain('$`')
  })
})
