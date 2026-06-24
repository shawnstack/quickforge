import { EventEmitter } from 'node:events'
import { createWechatChannelProvider } from './providers/wechat.mjs'

export const channelEvents = new EventEmitter()

const providers = new Map()
let initialized = false

function attachProvider(provider) {
  providers.set(provider.definition.id, provider)
  provider.on('event', (event) => {
    channelEvents.emit('channel_event', event)
  })
}

export function initializeChannels(options = {}) {
  if (initialized) return
  initialized = true
  attachProvider(createWechatChannelProvider({ projectRoot: options.projectRoot }))
}

function requireProvider(id) {
  const provider = providers.get(id)
  if (!provider) {
    const error = new Error(`Unknown channel: ${id}`)
    error.statusCode = 404
    throw error
  }
  return provider
}

export function listChannels() {
  return Array.from(providers.values()).map((provider) => provider.snapshot())
}

export function getChannelStatus(id) {
  return requireProvider(id).snapshot()
}

export async function startChannel(id, options = {}) {
  return requireProvider(id).start(options)
}

export async function stopChannel(id) {
  return requireProvider(id).stop()
}

export async function restartChannel(id, options = {}) {
  return requireProvider(id).restart(options)
}

export async function runChannelAction(id, action, options = {}) {
  return requireProvider(id).runAction(action, options)
}

export async function shutdownChannels() {
  await Promise.allSettled(Array.from(providers.values()).map((provider) => provider.stop()))
}
