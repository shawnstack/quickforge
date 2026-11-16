import { describe, expect, it } from 'vitest'

import { t } from '../../src/lib/i18n'

// `t(key: AppTextKey)` 的 AppTextKey 只是编译期的联合类型，而 `src/**` 里还有若干
// `as AppTextKey` 绕过它（goal 状态、artifact 类别、错误码映射）。一旦有漏网的键：
//   - 不带 params → 返回 undefined（界面静默空白，没有任何报错）
//   - 带 params   → `text.replaceAll` 直接 TypeError，把整棵子树打掉
// 所以未知键必须兜到键名本身：缺翻译时看见 camelCase 键名，比看见白屏容易发现。
describe('t() with a key that is not in the table', () => {
  it('returns the key itself instead of undefined', () => {
    const key = 'thisKeyDoesNotExistInAnyTable'
    expect(t(key as never)).toBe(key)
  })

  it('does not throw when params are passed', () => {
    const key = 'thisKeyDoesNotExistInAnyTable'
    expect(() => t(key as never, { count: 1 })).not.toThrow()
    expect(t(key as never, { count: 1 })).toBe(key)
  })

  it('still resolves a known key normally', () => {
    expect(t('modelsCount', { count: 3 })).toContain('3')
  })
})
