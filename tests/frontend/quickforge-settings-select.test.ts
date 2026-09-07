import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import type { TemplateResult } from 'lit'
import type { QuickForgeSettingsSelectOption } from '../../src/lib/quickforge-settings-select'

const source = readFileSync(new URL('../../src/lib/quickforge-settings-select.ts', import.meta.url), 'utf8')

const reactivePropertyNames = [
  'value',
  'placeholder',
  'options',
  'disabled',
  'label',
  'searchable',
  'searchPlaceholder',
  'noResultsLabel',
] as const

function propertyNameText(name: ts.PropertyName | undefined) {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function transpiledSettingsSelectClass() {
  const output = ts.transpileModule(source, {
    fileName: 'quickforge-settings-select.ts',
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      useDefineForClassFields: true,
    },
  }).outputText
  const sourceFile = ts.createSourceFile('quickforge-settings-select.js', output, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS)
  const selectClass = sourceFile.statements.find(
    (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
      && statement.name?.text === 'QuickForgeSettingsSelect',
  )
  if (!selectClass) throw new Error('Transpiled QuickForgeSettingsSelect not found')
  return selectClass
}

describe('QuickForgeSettingsSelect reactive property declarations', () => {
  it('keeps the Lit reactive accessors unshadowed in ES2023 define-field output', () => {
    const selectClass = transpiledSettingsSelectClass()

    // 真实类字段（含初始化器）经 es2023 useDefineForClassFields 编译后
    // 会在实例上定义 own property，永久遮蔽 static properties 在 prototype
    // 上生成的响应式 accessor——修复后 reactive 属性名不得再出现非静态
    // 字段声明。
    const instanceFieldNames = selectClass.members
      .filter(
        (member) => ts.isPropertyDeclaration(member)
          && !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
      )
      .map((member) => propertyNameText(member.name))
    for (const name of reactivePropertyNames) {
      expect(instanceFieldNames, `reactive property "${name}" must stay declared-only`).not.toContain(name)
    }

    const staticProperties = selectClass.members.find(
      (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
        && propertyNameText(member.name) === 'properties'
        && Boolean(member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)),
    )
    const reactiveKeys = staticProperties?.initializer && ts.isObjectLiteralExpression(staticProperties.initializer)
      ? staticProperties.initializer.properties.map((property) =>
        ts.isPropertyAssignment(property) ? propertyNameText(property.name) : undefined)
      : []
    for (const name of reactivePropertyNames) {
      expect(reactiveKeys).toContain(name)
    }
  })

  it('keeps constructor defaults so render never sees undefined options', () => {
    // render 直接 this.options.find/map，options 必须有数组默认值；
    // 其余字符串/布尔属性保持历史默认语义不变。
    expect(source).toContain('declare options: QuickForgeSettingsSelectOption[]')
    expect(source).toMatch(/constructor\(\)\s*\{\s*super\(\)/)
    expect(source).toContain('this.options = []')
    expect(source).toContain("this.value = ''")
  })
})

// vitest 运行在纯 Node 环境（无 DOM）：为 Lit 提供加载与实例化所需的最小全局。
// 组件不经 customElements 定义，直接 new 后走真实 prototype accessor 验证
// 更新调度；performUpdate 在实例上被替换为空实现，避免 Node 下真实渲染。
vi.stubGlobal('HTMLElement', class FakeHTMLElement extends EventTarget {})
vi.stubGlobal('customElements', {
  get: () => undefined,
  define: () => undefined,
})
vi.stubGlobal('document', {
  // lit-html 模块顶层会调用 document.createTreeWalker（NODE_MODE 检测）
  createElement: () => ({ style: {}, remove: () => undefined }),
  createTreeWalker: () => ({}),
  createComment: () => ({ }),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  body: { appendChild: () => undefined },
})
vi.stubGlobal('window', {
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  innerHeight: 800,
  innerWidth: 1280,
})

const { QuickForgeSettingsSelect: SettingsSelect } = await import('../../src/lib/quickforge-settings-select')

// 浏览器里 customElements.define() 会读取 observedAttributes，进而触发
// finalize() 在 prototype 上安装 reactive accessor；Node stub 的 define 是
// no-op，这里手动等价触发（Lit 支持直接调用 finalize，见其源码注释）。
;(SettingsSelect as unknown as { finalize: () => void }).finalize()

type TestSelect = {
  value: string
  options: QuickForgeSettingsSelectOption[]
  /** 当前更新轮的 promise（即 updateComplete 背后的 __updatePromise）。 */
  __updatePromise: Promise<boolean>
  updateComplete: Promise<boolean>
  isUpdatePending: boolean
  /** Lit 首轮更新需等 connectedCallback 调 enableUpdating 放行，此处手动模拟已连接。 */
  enableUpdating: (requestedUpdate?: boolean) => void
  performUpdate: () => void | Promise<unknown>
  render: () => TemplateResult
  _open: boolean
  _close: () => void
  _select: (value: string) => void
  addEventListener: (type: string, listener: (event: unknown) => void) => void
}

const sampleOptions: QuickForgeSettingsSelectOption[] = [
  { value: 'a', label: 'Option A' },
  { value: 'b', label: 'Option B' },
]

function currentCycle(select: TestSelect): Promise<boolean> {
  return select.__updatePromise
}

function createSelect(): TestSelect {
  const select = new SettingsSelect() as unknown as TestSelect
  // Node 无 DOM：阻断真实渲染路径，但保留 Lit 调度簿记（__markUpdated
  // 会把 isUpdatePending 复位 false，等价最小实现），使更新周期能走完。
  select.performUpdate = () => {
    select.isUpdatePending = false
  }
  // 模拟 connectedCallback 放行 constructor 排队的第一轮更新。
  select.enableUpdating(true)
  return select
}

/** 等待当前（及排队中的）更新轮完成。 */
async function flushUpdates(select: TestSelect) {
  await currentCycle(select)
}

/** render() 只构建 TemplateResult（纯 JS），其 values 数组包含触发按钮当前显示的选中项 label。 */
function triggerText(select: TestSelect): string {
  return select.render().values.join(' | ')
}

describe('QuickForgeSettingsSelect property reactivity', () => {
  it('applies constructor defaults through the reactive accessors', async () => {
    const select = createSelect()
    await flushUpdates(select)
    expect(select.value).toBe('')
    expect(select.options).toEqual([])
    expect(select.disabled).toBe(false)
    // 默认值经 prototype accessor 存储：实例上不再有 own property 遮蔽。
    expect(Object.prototype.hasOwnProperty.call(select, 'value')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(select, 'options')).toBe(false)
  })

  it('schedules a Lit update when the parent assigns value (accessor shadowing regression)', async () => {
    const select = createSelect()
    const performUpdate = vi.fn(select.performUpdate)
    select.performUpdate = performUpdate
    await flushUpdates(select)
    expect(select.isUpdatePending).toBe(false)

    select.options = [...sampleOptions]
    select.value = 'b'

    // 修复前：真实类字段在实例上遮蔽 prototype accessor，属性赋值不触发
    // requestUpdate（isUpdatePending 保持 false），父组件属性绑定后子组件
    // 不重渲染——即"设置页选择后触发按钮不回显、再点一次才显示"。
    expect(select.isUpdatePending).toBe(true)
    expect(Object.prototype.hasOwnProperty.call(select, 'value')).toBe(false)

    await flushUpdates(select)
    expect(performUpdate).toHaveBeenCalled()

    const rendered = triggerText(select)
    expect(rendered).toContain('Option B')
    expect(rendered).not.toContain('Option A')
  })

  it('dispatches change events carrying the picked value', () => {
    const select = createSelect()
    select.options = [...sampleOptions]
    const picked: string[] = []
    select.addEventListener('change', (event) => {
      picked.push((event as CustomEvent<string>).detail)
    })
    select._select('b')
    expect(picked).toEqual(['b'])
    // value 回写由父组件 @change 决定，组件自身不直接写 value。
    expect(select.value).toBe('')
  })

  it('keeps the newly selected label after an open/close cycle', async () => {
    const select = createSelect()
    await flushUpdates(select)
    select.options = [...sampleOptions]
    select.value = 'b'
    await flushUpdates(select)

    // _openMenu 需要真实触发按钮 DOM（ref），Node 下直接模拟菜单已打开，
    // 走第二次点击/外部点击的关闭路径（其内部手动 requestUpdate 正是 bug
    // 期间 UI 靠它"救回"回显的来源）。
    select._open = true
    select._close()
    expect(select._open).toBe(false)
    expect(select.value).toBe('b')
    await flushUpdates(select)

    const rendered = triggerText(select)
    expect(rendered).toContain('Option B')
    expect(rendered).not.toContain('Option A')
  })
})
