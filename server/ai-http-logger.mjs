import fs from 'node:fs'
import path from 'node:path'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { streamSimple } from '@earendil-works/pi-ai/compat'
import { resolveManagedCloudProvider } from './cloud/runtime.mjs'
import { ensureCloudChatIdempotencyKey } from './cloud/chat-idempotency-store.mjs'
import {
  DEFAULT_AI_STREAM_DEADLINE_MS,
  withDefaultAiProviderOptions,
} from './ai-provider-options.mjs'
import { logsDir } from './storage.mjs'

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

function combineAbortSignals(parentSignal, deadlineSignal) {
  if (!parentSignal) return deadlineSignal
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([parentSignal, deadlineSignal])

  const controller = new AbortController()
  const abort = () => controller.abort()
  if (parentSignal.aborted || deadlineSignal.aborted) {
    controller.abort()
  } else {
    parentSignal.addEventListener('abort', abort, { once: true })
    deadlineSignal.addEventListener('abort', abort, { once: true })
  }
  return controller.signal
}

function wrapStreamWithDeadline(stream, deadlineController, deadlineMs) {
  let timer
  const deadlinePromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      deadlineController.abort()
      reject(new Error(`AI stream timed out after ${deadlineMs}ms`))
    }, deadlineMs)
    timer.unref?.()
  })
  const resultPromise = Promise.race([stream.result(), deadlinePromise])
    .finally(() => clearTimeout(timer))
  resultPromise.catch(() => {})

  return {
    result: () => resultPromise,
    [Symbol.asyncIterator]() {
      const iterator = stream[Symbol.asyncIterator]()
      return {
        next: () => Promise.race([iterator.next(), deadlinePromise]),
        return: async () => {
          clearTimeout(timer)
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
  const deadlineMs = Number.isFinite(providerOptions.deadlineMs)
    ? Math.max(1, providerOptions.deadlineMs)
    : DEFAULT_AI_STREAM_DEADLINE_MS
  const deadlineController = new AbortController()
  const effectiveOptions = {
    ...providerOptions,
    signal: combineAbortSignals(providerOptions.signal, deadlineController.signal),
  }
  delete effectiveOptions.deadlineMs

  const managedCloud = model?.provider === 'quickforge-cloud' && model?.quickforgeModelSource === 'cloud'
  const stream = managedCloud
    ? lazyStream(Promise.all([
        resolveManagedCloudProvider(model, effectiveOptions.signal),
        managedCloudIdempotencyKey(context, effectiveOptions),
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
    : createProviderStream(model, context, effectiveOptions)

  return wrapStreamWithDeadline(stream, deadlineController, deadlineMs)
}
