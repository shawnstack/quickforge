import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { resolveManagedCloudProvider } from './cloud/runtime.mjs'
import { ensureCloudChatIdempotencyKey } from './cloud/chat-idempotency-store.mjs'
import {
  DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS,
  DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_AI_STREAM_TOTAL_TIMEOUT_MS,
  withDefaultAiProviderOptions,
} from './ai-provider-options.mjs'
import { logsDir } from './storage.mjs'
import { logger } from './utils/logger.mjs'

const PATCH_MARKER = Symbol.for('quickforge.aiHttpLogger.fetchPatched')
const ORIGINAL_FETCH = Symbol.for('quickforge.aiHttpLogger.originalFetch')
const enabledValues = new Set(['1', 'true', 'yes', 'on', 'full', 'raw'])
const aiHttpLogEnabled = enabledValues.has(String(process.env.QUICKFORGE_AI_HTTP_LOG || '').toLowerCase())
const aiHttpContext = new AsyncLocalStorage()

function currentLogFile() {
  const date = new Date().toISOString().slice(0, 10)
  return path.join(logsDir, `ai-http-${date}.jsonl`)
}

let logsDirEnsured = false

async function ensureLogsDir() {
  if (logsDirEnsured) return
  try {
    const { promises: fsp } = await import('node:fs')
    await fsp.mkdir(logsDir, { recursive: true })
    logsDirEnsured = true
  } catch {
    // Keep AI calls working even when diagnostic logging fails.
  }
}

function writeAiHttpRecord(record) {
  if (!aiHttpLogEnabled) return
  // Schedule async write — never blocks the event loop
  void ensureLogsDir().then(() => {
    try {
      fs.appendFile(currentLogFile(), `${JSON.stringify({ ts: new Date().toISOString(), ...record })}\n`, () => {})
    } catch {
      // Keep AI calls working even when diagnostic logging fails.
    }
  })
}

const SENSITIVE_HEADER_NAMES = new Set([
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'api-key',
  'idempotency-key',
  'cookie',
  'set-cookie',
])

export function sanitizeHttpHeaders(headers) {
  const result = {}
  if (!headers) return result

  try {
    const iterable = typeof headers.entries === 'function' ? headers.entries() : Object.entries(headers)
    for (const [key, value] of iterable) {
      const name = String(key)
      result[name] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase())
        ? '[REDACTED]'
        : Array.isArray(value) ? value.join(', ') : String(value)
    }
  } catch {
    // ignore malformed headers
  }

  return result
}

function headersToRecord(headers) {
  return sanitizeHttpHeaders(headers)
}

function isRequest(value) {
  return typeof Request !== 'undefined' && value instanceof Request
}

function requestUrl(input) {
  if (isRequest(input)) return input.url
  if (input instanceof URL) return input.href
  return String(input)
}

function requestMethod(input, init) {
  return String(init?.method || (isRequest(input) ? input.method : 'GET')).toUpperCase()
}

function requestHeaders(input, init) {
  return {
    ...(isRequest(input) ? headersToRecord(input.headers) : {}),
    ...headersToRecord(init?.headers),
  }
}

async function bodyToText(body) {
  if (body === undefined || body === null) return null
  if (typeof body === 'string') return body
  if (body instanceof URLSearchParams) return body.toString()
  if (typeof Blob !== 'undefined' && body instanceof Blob) return body.text()
  if (body instanceof ArrayBuffer) return Buffer.from(body).toString('utf8')
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString('utf8')
  if (typeof FormData !== 'undefined' && body instanceof FormData) {
    const entries = []
    for (const [key, value] of body.entries()) {
      entries.push([
        key,
        typeof value === 'string'
          ? value
          : { name: value.name, type: value.type, size: value.size },
      ])
    }
    return JSON.stringify(entries)
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return '[ReadableStream body not captured to avoid consuming the request stream]'
  }
  if (typeof body === 'object') {
    try {
      return JSON.stringify(body)
    } catch {
      return String(body)
    }
  }
  return String(body)
}

async function readRequestBody(input, init) {
  if (init && Object.hasOwn(init, 'body')) return bodyToText(init.body)
  if (!isRequest(input)) return null

  try {
    return await input.clone().text()
  } catch (error) {
    return `[request body capture failed: ${error instanceof Error ? error.message : String(error)}]`
  }
}

async function logResponseBody(response, baseRecord) {
  try {
    const body = await response.clone().text()
    writeAiHttpRecord({
      ...baseRecord,
      type: 'ai_http_response',
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: headersToRecord(response.headers),
        body,
      },
    })
  } catch (error) {
    writeAiHttpRecord({
      ...baseRecord,
      type: 'ai_http_response_capture_error',
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: headersToRecord(response.headers),
      },
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function loggedFetch(originalFetch, input, init) {
  const context = aiHttpContext.getStore()
  if (!context) return originalFetch(input, init)

  const httpRequestId = randomUUID()
  const startedAt = Date.now()
  const method = requestMethod(input, init)
  const url = requestUrl(input)
  const baseRecord = {
    traceId: context.traceId,
    httpRequestId,
    sessionId: context.sessionId,
    purpose: context.purpose,
    provider: context.provider,
    api: context.api,
    model: context.model,
    method,
    url,
  }

  writeAiHttpRecord({
    ...baseRecord,
    type: 'ai_http_request',
    request: {
      method,
      url,
      headers: requestHeaders(input, init),
      body: await readRequestBody(input, init),
    },
  })

  try {
    const response = await originalFetch(input, init)
    const durationMs = Date.now() - startedAt
    void logResponseBody(response, { ...baseRecord, durationMs })
    return response
  } catch (error) {
    writeAiHttpRecord({
      ...baseRecord,
      type: 'ai_http_error',
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.stack || error.message : String(error),
    })
    throw error
  }
}

export function installAiHttpLogger() {
  if (!aiHttpLogEnabled || typeof globalThis.fetch !== 'function') return
  if (globalThis[PATCH_MARKER]) return

  const originalFetch = globalThis.fetch.bind(globalThis)
  globalThis[ORIGINAL_FETCH] = originalFetch
  globalThis.fetch = (input, init) => loggedFetch(originalFetch, input, init)
  globalThis[PATCH_MARKER] = true
}

function combineAbortSignals(...signals) {
  const active = signals.filter(Boolean)
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(active)

  const controller = new AbortController()
  const abort = () => controller.abort()
  for (const signal of active) {
    if (signal.aborted) {
      controller.abort()
      break
    }
    signal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

// 流级透明重试上限：idle 超时（上游挂死）时内部重建底层流，吞掉重复 start、
// 有已产出内容时新流从零重放（消息被新 partial 原位替换）。上限对齐前端
// SSE 重连的 10 次语义；每次尝试的 idle 预算天然构成重试间隔。
export const MAX_STREAM_RETRIES = 10

function wrapStreamWithTimeouts(createStream, timeoutController, {
  idleTimeoutMs,
  firstEventTimeoutMs,
  totalTimeoutMs,
  maxStreamRetries = MAX_STREAM_RETRIES,
  onStreamRetry = null,
  parentSignal = null,
  provider,
  model,
  purpose,
}) {
  const startedAt = Date.now()
  const queue = []
  const waiting = []
  let lastEventAt = null
  let eventCount = 0
  let idleTimer
  let totalTimer
  let settled = false
  let iterationClosed = false
  let iterationStopRequested = false
  let iterationError
  let rejectTimeout
  let hasSubstantiveEvent = false
  let startPublished = false
  let streamRetries = 0
  let recoveryReported = false
  let pumpGeneration = 0

  const timeoutPromise = new Promise((_, reject) => {
    rejectTimeout = reject
  })
  // The timeout may win async iteration before result() is observed.
  timeoutPromise.catch(() => {})

  let currentStream = createStream()
  let iterator = currentStream[Symbol.asyncIterator]()

  const clearTimers = () => {
    clearTimeout(idleTimer)
    clearTimeout(totalTimer)
    idleTimer = undefined
    totalTimer = undefined
  }

  const closeIteration = (error) => {
    if (iterationClosed) return
    iterationClosed = true
    iterationError = error
    while (waiting.length > 0) {
      const waiter = waiting.shift()
      if (error) waiter.reject(error)
      else waiter.resolve({ value: undefined, done: true })
    }
  }

  const finish = (iterationFailure) => {
    if (settled) return false
    settled = true
    clearTimers()
    closeIteration(iterationFailure)
    return true
  }

  const markSettledFromResult = () => {
    settled = true
    clearTimers()
  }

  const failTimeout = (timeoutType, timeoutMs) => {
    if (settled) return
    const now = Date.now()
    const elapsedMs = now - startedAt
    const lastEventAgoMs = lastEventAt === null ? null : now - lastEventAt
    const phase = eventCount === 0 ? 'waiting_for_first_event' : 'waiting_for_next_event'
    const error = new Error(`AI stream ${timeoutType} timeout after ${timeoutMs}ms`)
    if (!finish(error)) return
    logger.warn(error.message, {
      provider,
      model,
      purpose,
      timeoutType,
      timeoutMs,
      elapsedMs,
      eventCount,
      lastEventAgoMs,
      lastEventAt: lastEventAt === null ? undefined : new Date(lastEventAt).toISOString(),
      phase,
    })
    timeoutController.abort()
    iterationStopRequested = true
    if (typeof iterator.return === 'function') {
      Promise.resolve(iterator.return()).catch(() => {})
    }
    rejectTimeout(error)
  }

  // 首个实质事件（text/thinking/toolcall）之前用宽松的首事件档（容忍 prefill），
  // 产出过实质内容后切换到紧凑的中断档（快速检出断流）。
  const currentIdleDelay = () => (hasSubstantiveEvent ? idleTimeoutMs : firstEventTimeoutMs)

  const resetIdleTimer = () => {
    if (settled) return
    clearTimeout(idleTimer)
    const delay = currentIdleDelay()
    idleTimer = setTimeout(() => onIdleDeadline(delay), delay)
    idleTimer.unref?.()
  }

  const onIdleDeadline = (delayMs) => {
    if (settled) return
    if (streamRetries < maxStreamRetries && !parentSignal?.aborted) {
      swapStreamForRetry(delayMs)
      return
    }
    failTimeout('idle', delayMs)
  }

  const swapStreamForRetry = (delayMs) => {
    streamRetries += 1
    logger.warn(`AI stream idle timeout after ${delayMs}ms; retrying stream (attempt ${streamRetries}/${maxStreamRetries})`, {
      provider,
      model,
      purpose,
      timeoutMs: delayMs,
      retryAttempt: streamRetries,
      hadContent: hasSubstantiveEvent,
    })
    // 旧 pump 靠 generation 守卫静默退出；挂起的 iterator.return() 唤醒它后不再
    // 触发 closeIteration，外部 next() 的等待者跨重试存活，由新流继续喂。
    pumpGeneration += 1
    if (typeof iterator.return === 'function') {
      Promise.resolve(iterator.return()).catch(() => {})
    }
    currentStream = createStream()
    iterator = currentStream[Symbol.asyncIterator]()
    lastEventAt = Date.now()
    // 新流从零重放：重置实质内容标记（重试后的首事件等待回到首事件档）。
    hasSubstantiveEvent = false
    try {
      onStreamRetry?.({ attempt: streamRetries, maxAttempts: maxStreamRetries, timeoutMs: delayMs })
    } catch { /* 上报失败不影响重试本身 */ }
    startPump()
    resetIdleTimer()
    followCurrentStreamResult()
  }

  const publish = (value) => {
    if (value?.type === 'start') {
      // 重试产生的第二个 start 不外发（agent-loop 已为首个 start 发布过消息）。
      if (startPublished) return
      startPublished = true
    } else {
      if (streamRetries > 0 && !recoveryReported) {
        recoveryReported = true
        try {
          onStreamRetry?.({ attempt: streamRetries, maxAttempts: maxStreamRetries, recovered: true })
        } catch { /* ignore */ }
      }
      hasSubstantiveEvent = true
    }
    eventCount += 1
    lastEventAt = Date.now()
    resetIdleTimer()
    const waiter = waiting.shift()
    if (waiter) waiter.resolve({ value, done: false })
    else queue.push(value)
  }

  // result() 的等待者跟随「当前」流：零内容重试换流后，旧流（会因 abort 以
  // aborted 结果 settle）不再决定 result() 的归宿，等待者迁移到新流。
  const resultWaiters = new Set()
  const followCurrentStreamResult = () => {
    if (resultWaiters.size === 0) return
    const stream = currentStream
    stream.result().then(
      (value) => {
        if (currentStream !== stream) return
        markSettledFromResult()
        for (const waiter of resultWaiters) waiter.resolve(value)
        resultWaiters.clear()
      },
      (error) => {
        if (currentStream !== stream) return
        finish(error)
        for (const waiter of resultWaiters) waiter.reject(error)
        resultWaiters.clear()
      },
    )
  }

  resetIdleTimer()
  totalTimer = setTimeout(() => failTimeout('total', totalTimeoutMs), totalTimeoutMs)
  totalTimer.unref?.()

  const startPump = () => {
    const generation = ++pumpGeneration
    const myIterator = iterator
    const myStream = currentStream
    ;(async () => {
      try {
        while (true) {
          const iteration = await myIterator.next()
          if (generation !== pumpGeneration || iterationStopRequested) return
          if (iteration.done) {
            closeIteration()
            // 流正常结束但 result() 未被消费时也结算超时状态，避免残留计时器误触发。
            void Promise.resolve(myStream.result()).then(markSettledFromResult, () => {})
            return
          }
          publish(iteration.value)
        }
      } catch (error) {
        if (generation === pumpGeneration) closeIteration(error)
      }
    })().catch(() => {})
  }

  startPump()

  return {
    result: () => Promise.race([
      new Promise((resolve, reject) => {
        resultWaiters.add({ resolve, reject })
        followCurrentStreamResult()
      }),
      timeoutPromise,
    ]),
    [Symbol.asyncIterator]() {
      return {
        next: () => {
          if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false })
          if (iterationClosed) {
            return iterationError
              ? Promise.reject(iterationError)
              : Promise.resolve({ value: undefined, done: true })
          }
          return new Promise((resolve, reject) => waiting.push({ resolve, reject }))
        },
        return: async () => {
          iterationStopRequested = true
          pumpGeneration += 1
          closeIteration()
          if (typeof iterator.return === 'function') return iterator.return()
          return { value: undefined, done: true }
        },
      }
    },
  }
}

function lazyStream(streamPromise) {
  return {
    result: () => streamPromise.then((stream) => stream.result()),
    [Symbol.asyncIterator]() {
      let iteratorPromise
      const iterator = () => {
        iteratorPromise ||= streamPromise.then((stream) => stream[Symbol.asyncIterator]())
        return iteratorPromise
      }
      return {
        next: async () => (await iterator()).next(),
        return: async () => {
          const resolved = await iterator()
          if (typeof resolved.return === 'function') return resolved.return()
          return { value: undefined, done: true }
        },
      }
    },
  }
}

function createProviderStream(model, context, options) {
  return aiHttpLogEnabled
    ? aiHttpContext.run({
        traceId: randomUUID(),
        sessionId: options.sessionId,
        purpose: options.metadata?.quickforgePurpose || 'chat',
        provider: model?.provider,
        api: model?.api,
        model: model?.id,
      }, () => streamSimple(model, context, options))
    : streamSimple(model, context, options)
}

const CLIENT_MESSAGE_ID_FIELD = 'quickforgeClientMessageId'

function logicalMessageIdFromContext(context) {
  const messages = Array.isArray(context?.messages) ? context.messages : []
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message?.role !== 'user' && message?.role !== 'user-with-attachments') continue
    const metadata = message.metadata
    const messageId = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? metadata[CLIENT_MESSAGE_ID_FIELD]
      : undefined
    return typeof messageId === 'string' && messageId ? messageId : undefined
  }
  return undefined
}

async function managedCloudIdempotencyKey(context, options) {
  const messageId = logicalMessageIdFromContext(context)
  return options.sessionId && messageId
    ? ensureCloudChatIdempotencyKey(options.sessionId, messageId)
    : randomUUID()
}

export function streamSimpleWithAiHttpLogging(model, context, options = {}) {
  const providerOptions = withDefaultAiProviderOptions(options)
  const legacyDeadlineMs = Number.isFinite(providerOptions.deadlineMs)
    ? Math.max(1, providerOptions.deadlineMs)
    : undefined
  const idleTimeoutMs = Number.isFinite(providerOptions.idleTimeoutMs)
    ? Math.max(1, providerOptions.idleTimeoutMs)
    : legacyDeadlineMs ?? DEFAULT_AI_STREAM_IDLE_TIMEOUT_MS
  const explicitIdleConfigured = Number.isFinite(providerOptions.idleTimeoutMs) || legacyDeadlineMs !== undefined
  // 显式配置 idle/deadline 时它就是唯一的静默预算（两档同值，保持既有调用方语义）；
  // 默认路径下首事件档更宽松以容忍大上下文 prefill。
  const firstEventTimeoutMs = Number.isFinite(providerOptions.firstEventTimeoutMs)
    ? Math.max(1, providerOptions.firstEventTimeoutMs)
    : explicitIdleConfigured ? idleTimeoutMs : Math.max(idleTimeoutMs, DEFAULT_AI_STREAM_FIRST_EVENT_TIMEOUT_MS)
  const totalTimeoutMs = Number.isFinite(providerOptions.totalTimeoutMs)
    ? Math.max(1, providerOptions.totalTimeoutMs)
    : DEFAULT_AI_STREAM_TOTAL_TIMEOUT_MS
  const timeoutController = new AbortController()
  const parentSignal = providerOptions.signal ?? null
  const onStreamRetry = typeof providerOptions.onStreamRetry === 'function' ? providerOptions.onStreamRetry : null

  const baseOptions = { ...providerOptions }
  delete baseOptions.deadlineMs
  delete baseOptions.idleTimeoutMs
  delete baseOptions.firstEventTimeoutMs
  delete baseOptions.totalTimeoutMs
  delete baseOptions.onStreamRetry

  // 每次尝试独立的 abort controller：零内容重试换流时打断上一次的挂起连接，
  // 而 total timeout 的 timeoutController 跨尝试共享（总时长不因重试重置）。
  let attemptController = null
  let attemptCount = 0
  const createStream = () => {
    attemptController?.abort()
    attemptController = new AbortController()
    attemptCount += 1
    const effectiveOptions = {
      ...baseOptions,
      signal: combineAbortSignals(parentSignal, timeoutController.signal, attemptController.signal),
    }
    const managedCloud = model?.provider === 'quickforge-cloud' && model?.quickforgeModelSource === 'cloud'
    if (!managedCloud) return createProviderStream(model, context, effectiveOptions)
    // 重试尝试换新的幂等键：同一 key 重放已中断的流，供应商语义不可控。
    const keyPromise = attemptCount === 1
      ? managedCloudIdempotencyKey(context, effectiveOptions)
      : Promise.resolve(randomUUID())
    return lazyStream(Promise.all([
      resolveManagedCloudProvider(model, effectiveOptions.signal),
      keyPromise,
    ]).then(([resolved, idempotencyKey]) => createProviderStream(
      {
        ...resolved.model,
        headers: {
          ...(resolved.model.headers || {}),
          'Idempotency-Key': idempotencyKey,
        },
      },
      context,
      {
        ...effectiveOptions,
        apiKey: resolved.apiKey,
      },
    )))
  }
  return wrapStreamWithTimeouts(createStream, timeoutController, {
    idleTimeoutMs,
    firstEventTimeoutMs,
    totalTimeoutMs,
    onStreamRetry,
    parentSignal,
    provider: model?.provider,
    model: model?.id,
    purpose: providerOptions.metadata?.quickforgePurpose || 'chat',
  })
}
