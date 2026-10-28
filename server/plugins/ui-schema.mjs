// Plugin UI contribution schema (plugin apiVersion 2 / "L1 declarative").
//
// Plugins may only *insert* into a fixed set of slots; they can never rewrite
// host UI. Everything in this module is a pure validator (no I/O, no React, no
// storage imports) so the exact same rules run from manifest normalisation,
// action dispatch and tests.
//
// Failure model:
//   - structural problems (not an array, too many nodes, too deep, oversized)
//     throw and the whole slot contribution is dropped;
//   - an unknown node type or a forbidden attribute is dropped/scrubbed with a
//     warning instead, so a plugin that ships a newer primitive degrades to a
//     partial render instead of taking the slot down.

export const PLUGIN_UI_API_VERSION = 2

export const UI_LIMITS = Object.freeze({
  maxSlotsPerPlugin: 8,
  maxTopLevelNodes: 20,
  maxTotalNodes: 200,
  maxDepth: 6,
  maxSerializedBytes: 64 * 1024,
  maxPayloadBytes: 8 * 1024,
  maxLabelLength: 64,
  maxTextLength: 2000,
  maxStringLength: 256,
  maxOptions: 32,
  maxActions: 32,
  maxPanels: 4,
  maxKvBytes: 64 * 1024,
  maxKvValueBytes: 8 * 1024,
})

// Only slots the host actually renders are declared. Adding a slot here without
// a mount point in the UI would let plugins declare contributions that silently
// never appear, so the list grows in step with the frontend.
export const UI_SLOTS = Object.freeze({
  'composer.actions': Object.freeze({
    permission: 'ui:composer',
    props: Object.freeze(['sessionId', 'projectId', 'draftLength', 'isStreaming']),
  }),
  'session.header': Object.freeze({
    permission: 'ui:session',
    props: Object.freeze(['sessionId', 'projectId', 'title', 'agentName']),
  }),
  'sidebar.footer': Object.freeze({
    permission: 'ui:sidebar',
    props: Object.freeze(['projectId', 'sessionCount']),
  }),
})

export const UI_SLOT_NAMES = Object.freeze(Object.keys(UI_SLOTS))
export const UI_PERMISSIONS = Object.freeze(UI_SLOT_NAMES.map((slot) => UI_SLOTS[slot].permission))

const NODE_TYPES = Object.freeze({
  button: Object.freeze(['label', 'icon', 'variant', 'disabled', 'onClick', 'key']),
  'icon-button': Object.freeze(['label', 'icon', 'variant', 'disabled', 'onClick', 'key']),
  text: Object.freeze(['text', 'key']),
  badge: Object.freeze(['label', 'tone', 'key']),
  icon: Object.freeze(['icon', 'key']),
  divider: Object.freeze(['key']),
  hstack: Object.freeze(['children', 'key']),
  vstack: Object.freeze(['children', 'key']),
  list: Object.freeze(['children', 'key']),
  input: Object.freeze(['value', 'placeholder', 'disabled', 'onChange', 'key']),
  select: Object.freeze(['value', 'options', 'disabled', 'onChange', 'key']),
  toggle: Object.freeze(['label', 'checked', 'disabled', 'onChange', 'key']),
  link: Object.freeze(['label', 'open', 'key']),
})

export const UI_NODE_TYPES = Object.freeze(Object.keys(NODE_TYPES))

const FORBIDDEN_ATTRIBUTES = new Set([
  'style',
  'css',
  'className',
  'class',
  'html',
  'innerHTML',
  'dangerouslySetInnerHTML',
  'ref',
  'onMount',
  'props',
])

const ACTION_NAME_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const NODE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const PAYLOAD_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const REFERENCE_PATTERN = /^\$(slot|state)\.[A-Za-z0-9_-]{1,64}(\.[A-Za-z0-9_-]{1,64}){0,3}$/

const VARIANT_VALUES = new Set(['default', 'ghost', 'danger'])
const TONE_VALUES = new Set(['neutral', 'accent', 'success', 'warning', 'danger'])

export function pluginUiError(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.errorCode = 'PLUGIN_UI_INVALID'
  return error
}

export function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function isUiSlotName(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UI_SLOTS, value)
}

export function uiPermissionForSlot(slot) {
  return isUiSlotName(slot) ? UI_SLOTS[slot].permission : null
}

export function isValidUiActionName(value) {
  return typeof value === 'string' && ACTION_NAME_PATTERN.test(value)
}

function limitString(value, max, label, pluginName) {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text.length <= max) return text
  throw pluginUiError('Plugin ' + pluginName + ' ' + label + ' exceeds ' + max + ' characters.')
}

function pickEnum(value, allowed) {
  return typeof value === 'string' && allowed.has(value) ? value : undefined
}

// $slot.x / $state.y are the only dynamic values a node may carry: the host
// substitutes them on the client. No expression evaluation, ever.
function normalizeReference(value) {
  if (typeof value !== 'string' || !value.startsWith('$')) return undefined
  return REFERENCE_PATTERN.test(value) ? value : undefined
}

function normalizeEvent(value, pluginName, label) {
  if (!isPlainObject(value)) return undefined
  const action = value.action
  if (!isValidUiActionName(action)) {
    throw pluginUiError('Plugin ' + pluginName + ' ' + label + ' must declare a valid action name.')
  }
  const ref = {}
  if (isPlainObject(value.payload)) {
    for (const [key, item] of Object.entries(value.payload)) {
      if (!PAYLOAD_KEY_PATTERN.test(key)) continue
      if (typeof item === 'string') {
        if (item.startsWith('$')) {
          // A value that looks like a reference but is malformed is dropped:
          // rendering a raw placeholder to the user is worse than nothing.
          const reference = normalizeReference(item)
          if (reference) ref[key] = reference
          continue
        }
        ref[key] = limitString(item, UI_LIMITS.maxStringLength, label + ' payload.' + key, pluginName)
      } else if (typeof item === 'number' || typeof item === 'boolean' || item === null) {
        ref[key] = item
      }
    }
  }
  const normalized = { action }
  if (Object.keys(ref).length > 0) normalized.payload = ref
  return normalized
}

function normalizeOptions(value, pluginName) {
  if (!Array.isArray(value)) return []
  if (value.length > UI_LIMITS.maxOptions) {
    throw pluginUiError('Plugin ' + pluginName + ' select options exceed ' + UI_LIMITS.maxOptions + ' entries.')
  }
  const options = []
  for (const item of value) {
    if (!isPlainObject(item)) continue
    const optionValue = limitString(String(item.value === undefined ? '' : item.value), UI_LIMITS.maxStringLength, 'select option value', pluginName)
    if (!optionValue) continue
    const optionLabel = limitString(String(item.label === undefined ? optionValue : item.label), UI_LIMITS.maxLabelLength, 'select option label', pluginName)
    options.push({ value: optionValue, label: optionLabel })
  }
  return options
}

function normalizeNode(raw, state) {
  if (!isPlainObject(raw)) {
    state.warnings.push('Dropped a non-object UI node.')
    return null
  }
  const type = typeof raw.type === 'string' ? raw.type : ''
  const allowedAttributes = NODE_TYPES[type]
  if (!allowedAttributes) {
    state.warnings.push('Dropped UI node with unknown type "' + (type || '(empty)') + '".')
    return null
  }
  if (state.depth > UI_LIMITS.maxDepth) {
    throw pluginUiError('Plugin ' + state.pluginName + ' UI node tree exceeds depth ' + UI_LIMITS.maxDepth + '.')
  }

  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_ATTRIBUTES.has(key)) {
      state.warnings.push('Ignored forbidden UI node attribute "' + key + '" on <' + type + '>.')
    }
  }

  const has = (attribute) => allowedAttributes.includes(attribute)
  const node = { type }

  if (has('key') && typeof raw.key === 'string' && NODE_KEY_PATTERN.test(raw.key)) node.key = raw.key
  if (has('label')) node.label = limitString(raw.label, UI_LIMITS.maxLabelLength, 'UI label', state.pluginName)
  if (has('text')) node.text = limitString(raw.text, UI_LIMITS.maxTextLength, 'UI text', state.pluginName)
  if (has('icon') && typeof raw.icon === 'string') node.icon = limitString(raw.icon, 64, 'UI icon', state.pluginName)
  if (has('variant')) {
    const variant = pickEnum(raw.variant, VARIANT_VALUES)
    if (variant) node.variant = variant
  }
  if (has('tone')) {
    const tone = pickEnum(raw.tone, TONE_VALUES)
    if (tone) node.tone = tone
  }
  if (has('disabled')) node.disabled = raw.disabled === true
  if (has('checked')) node.checked = raw.checked === true
  if (has('value')) node.value = limitString(String(raw.value === undefined ? '' : raw.value), UI_LIMITS.maxStringLength, 'UI value', state.pluginName)
  if (has('placeholder')) node.placeholder = limitString(raw.placeholder, UI_LIMITS.maxStringLength, 'UI placeholder', state.pluginName)
  if (has('options')) node.options = normalizeOptions(raw.options, state.pluginName)
  if (has('open')) {
    const open = limitString(String(raw.open === undefined ? '' : raw.open), 2048, 'UI link', state.pluginName)
    if (open.startsWith('https://')) node.open = open
    else state.warnings.push('Ignored non-https link.')
  }
  if (has('onClick')) {
    const event = normalizeEvent(raw.onClick, state.pluginName, 'onClick')
    if (event) node.onClick = event
  }
  if (has('onChange')) {
    const event = normalizeEvent(raw.onChange, state.pluginName, 'onChange')
    if (event) node.onChange = event
  }
  if (has('children')) {
    const children = Array.isArray(raw.children) ? raw.children : []
    state.depth += 1
    const normalizedChildren = []
    for (const child of children) {
      const normalizedChild = normalizeNode(child, state)
      if (normalizedChild) normalizedChildren.push(normalizedChild)
    }
    state.depth -= 1
    node.children = normalizedChildren
  }

  return node
}

export function countNodes(node) {
  if (!isPlainObject(node)) return 0
  let total = 1
  if (Array.isArray(node.children)) {
    for (const child of node.children) total += countNodes(child)
  }
  return total
}

/**
 * Normalise one slot's node array.
 * Returns { nodes, warnings }; throws a 400-status error when the whole
 * contribution is structurally unusable.
 */
export function normalizeUiNodes(rawNodes, options = {}) {
  const pluginName = options.pluginName || 'unknown'
  const slot = options.slot || ''
  if (rawNodes === undefined || rawNodes === null) return { nodes: [], warnings: [] }
  if (!Array.isArray(rawNodes)) {
    throw pluginUiError('Plugin ' + pluginName + ' UI slot ' + (slot || '(unknown)') + ' must be an array of nodes.')
  }
  if (rawNodes.length > UI_LIMITS.maxTopLevelNodes) {
    throw pluginUiError('Plugin ' + pluginName + ' UI slot ' + (slot || '(unknown)') + ' exceeds ' + UI_LIMITS.maxTopLevelNodes + ' top-level nodes.')
  }

  const state = { pluginName, depth: 1, warnings: [] }
  const nodes = []
  let total = 0
  for (const rawNode of rawNodes) {
    const node = normalizeNode(rawNode, state)
    if (!node) continue
    total += countNodes(node)
    if (total > UI_LIMITS.maxTotalNodes) {
      throw pluginUiError('Plugin ' + pluginName + ' UI slot ' + (slot || '(unknown)') + ' exceeds ' + UI_LIMITS.maxTotalNodes + ' total nodes.')
    }
    nodes.push(node)
  }

  const bytes = Buffer.byteLength(JSON.stringify(nodes), 'utf8')
  if (bytes > UI_LIMITS.maxSerializedBytes) {
    throw pluginUiError('Plugin ' + pluginName + ' UI slot ' + (slot || '(unknown)') + ' exceeds ' + UI_LIMITS.maxSerializedBytes + ' bytes.')
  }

  return { nodes, warnings: state.warnings }
}

/** Validates an inbound payload from the client before it reaches a plugin. */
export function normalizeUiPayload(raw, pluginName = 'unknown') {
  if (raw === undefined || raw === null) return {}
  if (!isPlainObject(raw)) {
    throw pluginUiError('Plugin ' + pluginName + ' UI payload must be an object.')
  }
  const bytes = Buffer.byteLength(JSON.stringify(raw), 'utf8')
  if (bytes > UI_LIMITS.maxPayloadBytes) {
    throw pluginUiError('Plugin ' + pluginName + ' UI payload exceeds ' + UI_LIMITS.maxPayloadBytes + ' bytes.')
  }
  return raw
}

/**
 * Normalises the contributes.ui block of a manifest.
 * options.normalizeRelativePath is injected by manifest.mjs so panel entries go
 * through the exact same path-traversal check skills and commands already use.
 */
export function normalizeUiContribution(raw, options = {}) {
  const pluginName = options.pluginName || 'unknown'
  const normalizeRelativePath = options.normalizeRelativePath
  if (!isPlainObject(raw)) return null

  const slots = {}
  const warnings = []
  const rawSlots = isPlainObject(raw.slots) ? raw.slots : {}
  const slotNames = Object.keys(rawSlots)
  if (slotNames.length > UI_LIMITS.maxSlotsPerPlugin) {
    throw pluginUiError('Plugin ' + pluginName + ' declares ' + slotNames.length + ' UI slots, limit is ' + UI_LIMITS.maxSlotsPerPlugin + '.')
  }
  for (const slotName of slotNames) {
    if (!isUiSlotName(slotName)) {
      throw pluginUiError('Plugin ' + pluginName + ' declares unknown UI slot "' + slotName + '". Allowed: ' + UI_SLOT_NAMES.join(', ') + '.')
    }
    const result = normalizeUiNodes(rawSlots[slotName], { pluginName, slot: slotName })
    warnings.push.apply(warnings, result.warnings)
    if (result.nodes.length > 0) slots[slotName] = result.nodes
  }

  const actions = []
  if (Array.isArray(raw.actions)) {
    for (const item of raw.actions) {
      if (typeof item !== 'string' || !isValidUiActionName(item)) {
        throw pluginUiError('Plugin ' + pluginName + ' declares an invalid UI action name.')
      }
      if (!actions.includes(item)) actions.push(item)
    }
  }
  if (actions.length > UI_LIMITS.maxActions) {
    throw pluginUiError('Plugin ' + pluginName + ' declares more than ' + UI_LIMITS.maxActions + ' UI actions.')
  }

  const panels = []
  const rawPanels = Array.isArray(raw.panels) ? raw.panels : []
  if (rawPanels.length > UI_LIMITS.maxPanels) {
    throw pluginUiError('Plugin ' + pluginName + ' declares more than ' + UI_LIMITS.maxPanels + ' UI panels.')
  }
  for (const entry of rawPanels) {
    if (!isPlainObject(entry)) throw pluginUiError('Plugin ' + pluginName + ' UI panel entry must be an object.')
    const id = typeof entry.id === 'string' ? entry.id.trim() : ''
    if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(id)) {
      throw pluginUiError('Plugin ' + pluginName + ' has invalid UI panel id: ' + (id || '(empty)') + '.')
    }
    if (typeof normalizeRelativePath !== 'function') {
      throw pluginUiError('Plugin ' + pluginName + ' UI panel "' + id + '" cannot be resolved.')
    }
    const resolved = normalizeRelativePath(entry.entry || entry.path, 'ui.panels[' + id + '] entry', pluginName, options.pluginDir)
    const width = Number(entry.width)
    panels.push({
      id,
      title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim().slice(0, UI_LIMITS.maxLabelLength) : id,
      entry: resolved.path,
      resolvedPath: resolved.resolvedPath,
      width: Number.isFinite(width) ? Math.min(Math.max(Math.round(width), 280), 900) : 420,
    })
  }

  if (slotNames.length === 0 && actions.length === 0 && panels.length === 0) return null
  return { slots, actions, panels, warnings }
}

/** Short human-readable summary used by the plugins page and the audit log. */
export function summarizeUiContribution(ui) {
  if (!ui) return { slots: [], actions: [], panels: 0 }
  return {
    slots: Object.keys(ui.slots || {}),
    actions: Array.isArray(ui.actions) ? ui.actions.slice() : [],
    panels: Array.isArray(ui.panels) ? ui.panels.length : 0,
  }
}
