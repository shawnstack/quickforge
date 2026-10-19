// Worker-thread entry for run_workflow scripts.
//
// The workflow script is model-authored JavaScript. It runs in its own worker
// thread (so an accidental synchronous loop can always be terminated by the
// parent) and inside a dedicated vm context. The context exposes only
// documented, guest-realm hooks: agent / parallel / pipeline / phase / log /
// args. No Node.js globals (process, require, fetch, timers, console) are
// injected, and no host object crosses into guest code:
//
// - `args` is parsed from a JSON string inside the guest realm.
// - agent/phases/log are guest functions created by the bridge below.
// - the only host function (`__hostCall`) is null-prototype and removed from
//   the global object before the user script is compiled.
// - host responses are delivered as JSON strings through a guest-side pump
//   reference the script cannot reach.
//
// This removes the common host-function `constructor` escape. It is still NOT
// a security sandbox: the worker runs in the server process, so the approval
// prompt before a workflow starts (and full-access mode) is the trust boundary.
//
// Protocol (worker -> parent):
//   { type: 'agent', requestId, prompt, options }
//   { type: 'phase', title, at }
//   { type: 'log', message, phase, at }
//   { type: 'done', result }
//   { type: 'error', error }
// Protocol (parent -> worker):
//   { type: 'agent-result', requestId, ok, hasValue?, value?, text?, error? }

import { parentPort, workerData } from 'node:worker_threads'
import { createContext, Script } from 'node:vm'

const MAX_SYNC_SCRIPT_MS = 10_000
const MAX_PROMPT_LENGTH = 100_000
const MAX_CONTEXT_LENGTH = 100_000
const MAX_EXPECTED_OUTPUT_LENGTH = 10_000
const MAX_LABEL_LENGTH = 80
const MAX_PHASE_LENGTH = 120
const MAX_LOG_MESSAGE_LENGTH = 2_000
const MAX_SCHEMA_JSON_LENGTH = 20_000
const MAX_RESULT_JSON_LENGTH = 1_000_000
const MAX_PARALLEL_ITEMS = 256
const MAX_PIPELINE_ITEMS = 256

const AGENT_OPTION_KEYS = new Set([
  'label',
  'phase',
  'profile',
  'context',
  'expectedOutput',
  'schema',
  'maxRuntimeMs',
  'maxToolCalls',
  'model',
])

let pump = null
let finished = false

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function errorMessage(error) {
  // Script errors originate in the guest realm, so `instanceof Error` is false
  // for them; read the message structurally instead.
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message || 'Unknown error'
  if (error instanceof Error) return error.message || error.name || 'Unknown error'
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function finish(message) {
  if (finished) return
  finished = true
  parentPort.postMessage(message)
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(minimum, Math.min(maximum, Math.round(number)))
}

function normalizeOptionalString(value, name, maximumLength) {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new TypeError(`agent option "${name}" must be a string`)
  const text = value.trim()
  if (!text) return undefined
  if (text.length > maximumLength) throw new TypeError(`agent option "${name}" is too long (max ${maximumLength} characters)`)
  return text
}

function normalizeAgentOptions(value) {
  if (value === undefined || value === null) return {}
  if (!isPlainObject(value)) throw new TypeError('agent(prompt, options) requires options to be a plain object')
  for (const key of Object.keys(value)) {
    if (!AGENT_OPTION_KEYS.has(key)) throw new TypeError(`Unknown agent option: ${key}`)
  }
  const schema = value.schema
  if (schema !== undefined && schema !== null) {
    if (!isPlainObject(schema) && typeof schema !== 'boolean') throw new TypeError('agent option "schema" must be a JSON Schema object')
    let schemaJson
    try {
      schemaJson = JSON.stringify(schema)
    } catch (error) {
      throw new TypeError(`agent option "schema" must be JSON-serializable: ${errorMessage(error)}`, { cause: error })
    }
    if (schemaJson.length > MAX_SCHEMA_JSON_LENGTH) throw new TypeError('agent option "schema" is too large')
  }
  return {
    label: normalizeOptionalString(value.label, 'label', MAX_LABEL_LENGTH),
    phase: normalizeOptionalString(value.phase, 'phase', MAX_PHASE_LENGTH),
    profile: normalizeOptionalString(value.profile, 'profile', 40),
    context: normalizeOptionalString(value.context, 'context', MAX_CONTEXT_LENGTH),
    expectedOutput: normalizeOptionalString(value.expectedOutput, 'expectedOutput', MAX_EXPECTED_OUTPUT_LENGTH),
    schema: schema === null ? undefined : schema,
    maxRuntimeMs: value.maxRuntimeMs === undefined ? undefined : clampInteger(value.maxRuntimeMs, 1000, 2 * 60 * 60 * 1000, undefined),
    maxToolCalls: value.maxToolCalls === undefined ? undefined : clampInteger(value.maxToolCalls, 1, 300, undefined),
    model: value.model,
  }
}

function normalizeToolOptions(value) {
  if (value === undefined || value === null) return {}
  if (!isPlainObject(value)) throw new TypeError('tool(name, args, options) requires options to be a plain object')
  for (const key of Object.keys(value)) {
    if (key !== 'label' && key !== 'phase') throw new TypeError(`Unknown tool option: ${key}`)
  }
  return {
    label: normalizeOptionalString(value.label, 'label', MAX_LABEL_LENGTH),
    phase: normalizeOptionalString(value.phase, 'phase', MAX_PHASE_LENGTH),
  }
}

function normalizePhaseTitle(title) {
  if (typeof title !== 'string' || !title.trim()) throw new TypeError('phase(title) requires a non-empty string')
  const text = title.trim()
  if (text.length > MAX_PHASE_LENGTH) throw new TypeError(`phase title is too long (max ${MAX_PHASE_LENGTH} characters)`)
  return text
}

function normalizeLogMessage(message) {
  const text = typeof message === 'string' ? message : errorMessage(message)
  if (!text) return ''
  return text.length > MAX_LOG_MESSAGE_LENGTH ? `${text.slice(0, MAX_LOG_MESSAGE_LENGTH)}…` : text
}

/**
 * The only host function visible to the guest bridge. It validates the request,
 * forwards it to the parent and never throws a host object into guest code:
 * validation/runtime errors are delivered as JSON through the guest pump.
 */
function hostCall(type, payloadJson, requestId) {
  let id = requestId === undefined ? undefined : String(requestId)
  try {
    if (type === 'agent') {
      const payload = JSON.parse(String(payloadJson))
      const prompt = typeof payload?.prompt === 'string' ? payload.prompt : ''
      if (!prompt.trim()) throw new TypeError('agent(prompt) requires a non-empty string prompt')
      if (prompt.length > MAX_PROMPT_LENGTH) throw new TypeError(`agent prompt is too long (max ${MAX_PROMPT_LENGTH} characters)`)
      const options = normalizeAgentOptions(payload?.options)
      parentPort.postMessage({ type: 'agent', requestId: id, prompt, options })
      return
    }
    if (type === 'tool') {
      const payload = JSON.parse(String(payloadJson))
      const name = typeof payload?.name === 'string' ? payload.name.trim() : ''
      if (!name) throw new TypeError('tool(name, args) requires a non-empty tool name')
      const args = payload?.args === undefined || payload?.args === null ? {} : payload.args
      if (!isPlainObject(args)) throw new TypeError(`Tool ${name} arguments must be a plain object`)
      const options = normalizeToolOptions(payload?.options)
      parentPort.postMessage({ type: 'tool', requestId: id, name, args, options })
      return
    }
    if (type === 'phase') {
      const payload = JSON.parse(String(payloadJson))
      parentPort.postMessage({ type: 'phase', title: normalizePhaseTitle(payload?.title), at: Date.now() })
      return
    }
    if (type === 'log') {
      const payload = JSON.parse(String(payloadJson))
      const message = normalizeLogMessage(payload?.message)
      if (message) parentPort.postMessage({ type: 'log', message, phase: typeof payload?.phase === 'string' ? payload.phase : '', at: Date.now() })
    }
  } catch (error) {
    if (!id) return
    try {
      pump?.(id, JSON.stringify({ ok: false, error: errorMessage(error) }))
    } catch {
      // the pump reference is owned by the host; a failure here is fatal only
      // for that one request and must not throw across the boundary.
    }
  }
}
Object.setPrototypeOf(hostCall, null)
Object.freeze(hostCall)

// The bridge runs before the user script. It captures the host bridge in a
// closure, parses args inside the guest realm, deletes both bootstrap globals
// and returns the guest pump function to the host. The user script cannot
// reach `hostCall` or `pump` afterward.
const BRIDGE_SOURCE = `
(() => {
  'use strict'
  const hostCall = globalThis.__hostCall
  const argsJson = globalThis.__argsJson
  delete globalThis.__hostCall
  delete globalThis.__argsJson

  const parseJson = JSON.parse
  const stringifyJson = JSON.stringify
  const GuestPromise = Promise
  const GuestMap = Map
  const pending = new GuestMap()
  let nextId = 0

  function deepFreeze(value) {
    if (!value || typeof value !== 'object') return value
    if (Object.isFrozen(value)) return value
    for (const key of Object.keys(value)) deepFreeze(value[key])
    return Object.freeze(value)
  }

  function notify(type, payload) {
    try {
      hostCall(type, stringifyJson(payload))
    } catch {
      // progress notifications are best effort
    }
  }

  function call(type, payload, requestId) {
    return new GuestPromise((resolve, reject) => {
      if (requestId !== undefined) pending.set(requestId, { resolve, reject })
      try {
        hostCall(type, stringifyJson(payload), requestId)
      } catch (error) {
        if (requestId !== undefined) pending.delete(requestId)
        reject(new Error(String(error && error.message ? error.message : error)))
      }
    })
  }

  async function agent(prompt, options) {
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new TypeError('agent(prompt) requires a non-empty string prompt')
    }
    const requestId = String(++nextId)
    const response = await call('agent', { prompt, options }, requestId)
    if (!response || response.ok !== true) return null
    return response.hasValue === true ? response.value : response.text
  }

  async function tool(name, args, options) {
    if (typeof name !== 'string' || !name.trim()) {
      throw new TypeError('tool(name, args) requires a non-empty tool name')
    }
    if (args !== undefined && args !== null && (typeof args !== 'object' || Array.isArray(args))) {
      throw new TypeError('tool(name, args) requires args to be a plain object')
    }
    const requestId = String(++nextId)
    const response = await call('tool', { name, args: args === undefined || args === null ? {} : args, options }, requestId)
    if (!response || response.ok !== true) return null
    return typeof response.content === 'string' ? response.content : ''
  }

  async function parallel(thunks) {
    if (!Array.isArray(thunks)) throw new TypeError('parallel(thunks) requires an array')
    if (thunks.length > ${MAX_PARALLEL_ITEMS}) throw new TypeError('parallel(thunks) supports at most ${MAX_PARALLEL_ITEMS} thunks')
    return GuestPromise.all(thunks.map(async (thunk) => {
      if (typeof thunk !== 'function') return null
      try {
        return await thunk()
      } catch {
        return null
      }
    }))
  }

  async function pipeline(items, ...stages) {
    if (!Array.isArray(items)) throw new TypeError('pipeline(items, ...stages) requires an array of items')
    if (items.length > ${MAX_PIPELINE_ITEMS}) throw new TypeError('pipeline supports at most ${MAX_PIPELINE_ITEMS} items')
    for (const stage of stages) {
      if (typeof stage !== 'function') throw new TypeError('pipeline stages must be functions')
    }
    if (stages.length === 0) return items.slice()
    return GuestPromise.all(items.map(async (item, index) => {
      let previous = item
      for (const stage of stages) {
        try {
          previous = await stage(previous, item, index)
        } catch {
          return null
        }
      }
      return previous
    }))
  }

  let currentPhase = ''

  function phase(title) {
    const text = String(title === undefined || title === null ? '' : title).trim()
    if (!text) throw new TypeError('phase(title) requires a non-empty string')
    currentPhase = text
    notify('phase', { title: text })
    return text
  }

  function log(message) {
    let text
    if (typeof message === 'string') text = message
    else {
      try { text = stringifyJson(message) } catch { text = String(message) }
    }
    if (!text) return
    notify('log', { message: text, phase: currentPhase })
  }

  globalThis.agent = agent
  globalThis.tool = tool
  globalThis.parallel = parallel
  globalThis.pipeline = pipeline
  globalThis.phase = phase
  globalThis.log = log
  globalThis.args = deepFreeze(argsJson === null || argsJson === undefined ? null : parseJson(argsJson))

  return function pump(id, json) {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    let message
    try {
      message = parseJson(json)
    } catch {
      entry.reject(new Error('Invalid workflow response'))
      return
    }
    // Parent responses describe agent-level outcomes. Resolve for both ok and
    // failure so agent() can return null (the documented DSH-like contract);
    // only malformed transport data rejects the script.
    if (!message || typeof message !== 'object') {
      entry.reject(new Error('Invalid workflow response'))
      return
    }
    entry.resolve(message)
  }
})()
`

const sandbox = Object.create(null)
sandbox.__hostCall = hostCall
sandbox.__argsJson = JSON.stringify(workerData?.args ?? null)
// The vm context otherwise exposes a host console; scripts must use log() so
// progress reaches the workflow card instead of the server's stdout.
sandbox.console = undefined

const context = createContext(sandbox, {
  name: 'quickforge-workflow',
  codeGeneration: { strings: false, wasm: false },
})

parentPort.on('message', (message) => {
  if (!message || message.type !== 'agent-result') return
  const id = message.requestId === undefined ? '' : String(message.requestId)
  if (!id || !pump) return
  try {
    pump(id, JSON.stringify(message))
  } catch {
    // ignore a pump failure for one settled request
  }
})

function assertSerializable(value) {
  try {
    structuredClone(value)
  } catch (error) {
    throw new Error(`Workflow script result must be JSON-serializable: ${errorMessage(error)}`, { cause: error })
  }
  let json
  try {
    json = JSON.stringify(value)
  } catch (error) {
    throw new Error(`Workflow script result must be JSON-serializable: ${errorMessage(error)}`, { cause: error })
  }
  if (json === undefined) throw new Error('Workflow script result must be JSON-serializable')
  if (json.length > MAX_RESULT_JSON_LENGTH) throw new Error('Workflow script result is too large (max 1 MB of JSON)')
}

async function main() {
  try {
    pump = new Script(BRIDGE_SOURCE, { filename: 'quickforge-workflow-bridge.js' }).runInContext(context, { timeout: 5000 })
  } catch (error) {
    finish({ type: 'error', error: `Workflow sandbox bridge failed to initialize: ${errorMessage(error)}` })
    return
  }

  const scriptText = String(workerData?.script || '')
  let compiled
  try {
    // The script body is async so it may await agent()/parallel()/pipeline().
    // `return <value>` is the documented result contract.
    compiled = new Script(`(async () => {\n${scriptText}\n})()`, { filename: 'quickforge-workflow.js' })
  } catch (error) {
    finish({ type: 'error', error: `Workflow script syntax error: ${errorMessage(error)}` })
    return
  }
  try {
    const outcome = compiled.runInContext(context, { timeout: MAX_SYNC_SCRIPT_MS, displayErrors: true })
    const value = await outcome
    assertSerializable(value)
    finish({ type: 'done', result: value })
  } catch (error) {
    finish({ type: 'error', error: errorMessage(error) })
  }
}

void main()
