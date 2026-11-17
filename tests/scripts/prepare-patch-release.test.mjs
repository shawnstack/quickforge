import { describe, expect, it } from 'vitest'
import { rewriteReadmeVersion } from '../../scripts/prepare-patch-release.cjs'

// 对应 prepare-patch-release.cjs 里 README 版本号改写的四种形态：
// 老 README 的静态 badge / 安装命令 / 离线包名，加上动态徽章化后仅存的
// 明文「当前版本 **X.Y.Z**」（v2.5.0 发版时三正则全部失配、这一行只能人工手改）。
// 每条用例都断言 changed=true 且只把 2.4.9 换成 2.5.0——把任一正则删掉，对应用例必须变红。
const FORMS = [
  ['静态 badge', '[![version](https://img.shields.io/badge/version-2.4.9-blue)]'],
  ['安装命令', 'npm install -g @shawnstack/quickforge@2.4.9'],
  ['离线包名', 'npm install -g ./package-offline/shawnstack-quickforge-2.4.9.tgz'],
  ['当前版本', '[npm 安装](#快速开始) · 当前版本 **2.4.9**'],
]

describe('rewriteReadmeVersion', () => {
  for (const [name, line] of FORMS) {
    it(`改写「${name}」形态并只动版本号`, () => {
      const { content, changed } = rewriteReadmeVersion(line, '2.5.0')
      expect(changed).toBe(true)
      expect(content).toBe(line.replace('2.4.9', '2.5.0'))
    })
  }

  it('没有版本号时 changed=false 且原样返回（挡住「永远 changed=true」的写法）', () => {
    const text = '# 速构 QuickForge\n\n本地优先 · 没有任何版本号的正文。\n'
    const { content, changed } = rewriteReadmeVersion(text, '2.5.0')
    expect(changed).toBe(false)
    expect(content).toBe(text)
  })
})
