/**
 * 无障碍树 → 供模型阅读的文本快照，并维护 `ref → backendNodeId` 引用表。
 *
 * 为什么不让模型自己写 CSS 选择器：选择器一旦写错，点击会落到别的元素上，
 * 表现为"页面动了但没点对"，模型无法自纠。这里给每个可交互/有名字的节点
 * 分配一个短引用（`e7@g3`），模型只说 `ref`，由本模块翻译成真实 DOM 节点，
 * 失败时能明确报"引用已过期，请重新快照"。
 *
 * 引用里带世代号 `g3`：任何导航、执行上下文重建都会让上一版引用失效。
 * 世代不做校验的话，旧引用会解析成新页面同位置的另一个元素 —— 静默点错，
 * 比报错难查得多。
 */

const DEFAULT_MAX_NODES = 1_200
const DEFAULT_MAX_CHARS = 24_000
const MAX_NAME_LENGTH = 140

const SKIP_ROLES = new Set([
  'none',
  'presentation',
  'generic',
  'InlineTextBox',
  'LineBreak',
  'paragraph',
  // 根节点只是文档外壳，标题由 navigate 的返回值单独提供，进快照只会让整页多缩进一级。
  'RootWebArea',
])

const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'disclosure triangle',
  'link',
  'listbox',
  'menu',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'radio',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'textbox',
  'treeitem',
])

// 这些角色自身已经带了可读文本，内部的 StaticText 是重复噪音。
const TEXT_IN_NAME_ROLES = new Set([
  'button',
  'cell',
  'checkbox',
  'columnheader',
  'heading',
  'link',
  'listitem',
  'menuitem',
  'option',
  'radio',
  'rowheader',
  'switch',
  'tab',
  'treeitem',
])

function normalizeText(value) {
  if (typeof value !== 'string') return ''
  return value.replace(/[\s\u00a0]+/g, ' ').trim()
}

function clipText(value, max = MAX_NAME_LENGTH) {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}

function roleOf(node) {
  return normalizeText(node?.role?.value)
}

function nameOf(node) {
  return normalizeText(node?.name?.value)
}

/**
 * @param {Array<Record<string, unknown>>} nodes Accessibility.getFullAXTree 的 nodes
 * @param {{ generation?: number, maxNodes?: number, maxChars?: number }} [options]
 */
export function buildSnapshot(nodes, options = {}) {
  const generation = Number.isInteger(options.generation) ? options.generation : 0
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS

  const byId = new Map()
  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!node || typeof node !== 'object') continue
    byId.set(node.nodeId, node)
  }

  const root = (Array.isArray(nodes) ? nodes : []).find((node) => node && !node.parentId) ?? null
  const lines = []
  const refs = new Map()
  let nextRefId = 1
  let truncated = false

  const visit = (nodeId, depth) => {
    if (truncated) return
    const node = byId.get(nodeId)
    if (!node || node.ignored === true) return
    const role = roleOf(node)
    const name = clipText(nameOf(node))
    const kept = (INTERACTIVE_ROLES.has(role) || Boolean(name)) && !SKIP_ROLES.has(role)
      && !(role === 'StaticText' && TEXT_IN_NAME_ROLES.has(roleOf(byId.get(node.parentId))))
    if (kept) {
      if (lines.length >= maxNodes) {
        truncated = true
        return
      }
      // 引用按实际产出密集编号：没有 backendNodeId 的节点（纯容器）不占号。
      let ref = ''
      if (Number.isFinite(node.backendDOMNodeId)) {
        const refId = `e${nextRefId++}@g${generation}`
        refs.set(refId, node.backendDOMNodeId)
        ref = ` [ref=${refId}]`
      }
      const label = name ? ` - ${name}` : ''
      lines.push(`${'  '.repeat(depth)}- ${role || 'node'}${label}${ref}`)
    }
    for (const childId of Array.isArray(node.childIds) ? node.childIds : []) {
      visit(childId, kept ? depth + 1 : depth)
    }
  }

  if (root) visit(root.nodeId, 0)

  let text = lines.join('\n')
  if (!text) text = '(no accessible content)'
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars)}\n… [snapshot truncated at ${maxChars} characters]`
    truncated = true
  } else if (truncated) {
    text = `${text}\n… [snapshot truncated at ${maxNodes} nodes]`
  }

  return { text, refs, generation, nodeCount: lines.length, truncated }
}

/** 解析 `e7@g3` → `{ id: 'e7', generation: 3 }`；格式不合法返回 null。 */
export function parseRef(ref) {
  if (typeof ref !== 'string') return null
  const match = /^(e\d+)@g(\d+)$/.exec(ref.trim())
  if (!match) return null
  return { id: match[1], generation: Number(match[2]) }
}

/**
 * 把模型给的引用解析成 CDP 可用的 backendNodeId。
 * 世代不匹配时明确要求重新快照，绝不"尽力而为"地回退。
 */
export function resolveRef(ref, snapshot) {
  const parsed = parseRef(ref)
  if (!parsed) {
    return { ok: false, message: `Invalid ref "${ref}". Use a ref from the latest snapshot (format e12@g3).` }
  }
  if (!snapshot || parsed.generation !== snapshot.generation) {
    return { ok: false, message: `Ref ${ref} is stale: the page changed since it was captured. Take a new snapshot.` }
  }
  const backendNodeId = snapshot.refs.get(ref.trim())
  if (!Number.isFinite(backendNodeId)) {
    return { ok: false, message: `Unknown ref ${ref}. Take a new snapshot and pick a ref from it.` }
  }
  return { ok: true, backendNodeId }
}
