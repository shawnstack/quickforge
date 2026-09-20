import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * 语义色透明度类 ⇄ 旧产物渲染能力 护栏。
 *
 * 背景：QuickForge 的语义色（`--color-*`）来自设计 token 映射，旧版本由 pi-web-ui 的
 * 预构建 CSS 提供，只有固定数量的半透明档位真的被生成。若源码用了旧产物里不存在的
 * `/NN` 档位，就会出现「同一份源码在旧 / 新构建下浓淡不一致」的静默回归（用户反馈的
 * 「文字变淡」即由此而来）。
 *
 * 白名单来源：旧产物 `package-dist/dist/assets/index-B1G0LqYR.css`（v2.1.0 构建时
 * pi-web-ui 预构建 CSS 自带、且实际参与渲染的 78 个语义色工具类，含变体前缀）。
 * 新增用法必须落在白名单内；需要半透明时改用白名单里已有的档位，或使用
 * `*-[color-mix(in_oklab,var(--x)_NN%,transparent)]` 这类旧产物已支持的任意值写法。
 */
const ALIVE_SEMANTIC_COLOR_CLASSES = [
  '[&>svg]:text-destructive',
  '[&>svg]:text-foreground',
  'aria-invalid:border-destructive',
  'aria-invalid:ring-destructive/20',
  'bg-accent',
  'bg-accent/50',
  'bg-background',
  'bg-background/90',
  'bg-background/95',
  'bg-border',
  'bg-card',
  'bg-destructive',
  'bg-destructive/10',
  'bg-muted',
  'bg-muted-foreground',
  'bg-muted-foreground/30',
  'bg-muted/30',
  'bg-muted/50',
  'bg-muted/60',
  'bg-popover',
  'bg-primary',
  'bg-primary-foreground/20',
  'bg-primary/10',
  'bg-primary/5',
  'bg-secondary',
  'border-border',
  'border-destructive',
  'border-destructive/50',
  'border-input',
  'border-primary',
  'dark:aria-invalid:ring-destructive/40',
  'dark:bg-input/30',
  'dark:border-destructive',
  'data-[placeholder]:text-muted-foreground',
  'data-[state=checked]:bg-destructive',
  'data-[state=checked]:bg-primary',
  'data-[state=checked]:border-destructive',
  'data-[state=checked]:border-primary',
  'data-[state=checked]:text-destructive-foreground',
  'data-[state=checked]:text-primary-foreground',
  'data-[state=unchecked]:bg-input',
  'focus-visible:border-ring',
  'focus-visible:ring-ring',
  'focus-visible:ring-ring/50',
  'focus:ring-ring',
  'from-muted-foreground',
  'hover:bg-accent',
  'hover:bg-accent/50',
  'hover:bg-destructive/10',
  'hover:bg-destructive/80',
  'hover:bg-destructive/90',
  'hover:bg-muted',
  'hover:bg-primary/80',
  'hover:bg-primary/90',
  'hover:bg-secondary',
  'hover:bg-secondary/50',
  'hover:bg-secondary/80',
  'hover:border-border',
  'hover:border-muted-foreground/50',
  'hover:text-accent-foreground',
  'hover:text-foreground',
  'placeholder-muted-foreground',
  'placeholder:text-muted-foreground',
  'selection:bg-primary',
  'selection:text-primary-foreground',
  'text-accent-foreground',
  'text-card-foreground',
  'text-destructive',
  'text-destructive-foreground',
  'text-foreground',
  'text-muted-foreground',
  'text-muted-foreground/50',
  'text-popover-foreground',
  'text-primary',
  'text-primary-foreground',
  'text-secondary-foreground',
  'to-muted-foreground',
  'via-foreground',
] as const

const ALIVE = new Set<string>(ALIVE_SEMANTIC_COLOR_CLASSES)

/** 语义色 token（长 token 在前，避免 `muted-foreground` 被 `muted` 抢先匹配）。 */
const SEMANTIC_COLOR_TOKENS = [
  'sidebar-foreground',
  'sidebar',
  'destructive-foreground',
  'destructive',
  'primary-foreground',
  'primary',
  'secondary-foreground',
  'secondary',
  'muted-foreground',
  'muted',
  'accent-foreground',
  'accent',
  'card-foreground',
  'card',
  'popover-foreground',
  'popover',
  'background',
  'foreground',
  'border',
  'input',
  'ring',
].join('|')

const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'divide',
  'outline',
  'fill',
  'stroke',
  'from',
  'via',
  'to',
  'placeholder',
  'decoration',
  'shadow',
  'caret',
  'accent',
].join('|')

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])

/**
 * 匹配「带 `/NN` 透明度修饰的语义色工具类」，含 Tailwind 变体前缀
 * （`hover:` / `focus-visible:` / `[&>svg]:` / `data-[state=checked]:` …）与 CSS 里的
 * 转义写法（`.dark\:bg-input\/30`）。非语义色（`bg-black/50`）与尺寸分数（`w-1/2`）不匹配。
 */
const SEMANTIC_COLOR_OPACITY_PATTERN = new RegExp(
  "(?:^|[\\s\"'`().,])" +
    "((?:[A-Za-z0-9\\-\\[\\]&>.*=_,'@!\\\\]+:)*" +
    `(?:${COLOR_UTILITIES})-(?:${SEMANTIC_COLOR_TOKENS})` +
    "\\\\?/\\d{1,3}(?![\\dA-Za-z%/.-]))",
  'g',
)

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return SOURCE_EXTENSIONS.has(path.extname(entry.name)) ? [full] : []
  })
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length
}

/** 扫描 `src/**` 里所有带透明度修饰的语义色类，返回去重清单与逐处定位。 */
function scanSemanticColorOpacityClasses(): { classes: Set<string>; locations: string[] } {
  const classes = new Set<string>()
  const locations: string[] = []
  for (const file of sourceFiles(SRC_ROOT)) {
    const text = readFileSync(file, 'utf8')
    for (const match of text.matchAll(SEMANTIC_COLOR_OPACITY_PATTERN)) {
      const className = match[1].replace(/\\/g, '')
      classes.add(className)
      locations.push(`${path.relative(SRC_ROOT, file).replace(/\\/g, '/')}:${lineOf(text, match.index)}  ${className}`)
    }
  }
  return { classes, locations }
}

const scan = scanSemanticColorOpacityClasses()

describe('semantic color opacity class parity with legacy build', () => {
  it('src 中所有带透明度修饰的语义色类都存在于旧产物白名单', () => {
    const violations = new Set([...scan.classes].filter((className) => !ALIVE.has(className)))

    expect(scan.locations.filter((line) => violations.size > 0 && [...violations].some((v) => line.endsWith(v)))).toEqual([])
  })

  it('白名单与旧产物条目一一对应（无重复、条目数一致）', () => {
    expect(ALIVE_SEMANTIC_COLOR_CLASSES.length).toBe(ALIVE.size)
    expect(ALIVE.size).toBe(78)
  })

  it('扫描器覆盖全部语义色工具类用法（防静默失效）', () => {
    // 这些用法在旧产物中真实存在，扫描器必须能识别，否则上面的断言会假通过。
    for (const sentinel of ['bg-destructive/10', 'bg-primary/10', 'bg-background/95', 'text-muted-foreground/50']) {
      expect(scan.classes.has(sentinel)).toBe(true)
    }
  })
})
