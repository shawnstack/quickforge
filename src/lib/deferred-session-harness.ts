import type { AgentHarness, ChatScope } from '@/lib/types'

type BlankDeferredSessionHarnessInput = {
  isDeferredSession: boolean
  isStreaming: boolean
  messageCount: number
  currentScope: ChatScope
  targetScope: ChatScope
  currentHarness: AgentHarness
  defaultHarness: AgentHarness
}

function isReusableBlankDeferredSession(input: BlankDeferredSessionHarnessInput) {
  return input.isDeferredSession
    && !input.isStreaming
    && input.messageCount === 0
    && input.currentScope === input.targetScope
}

export function shouldReplaceBlankDeferredSessionHarness(input: BlankDeferredSessionHarnessInput) {
  return isReusableBlankDeferredSession(input) && input.currentHarness !== input.defaultHarness
}

export async function resolveBlankDeferredSessionForNewChat(
  input: Omit<BlankDeferredSessionHarnessInput, 'defaultHarness'>,
  loadDefaultHarness: () => Promise<AgentHarness>,
): Promise<{ action: 'not-reusable' | 'reuse' | 'replace'; defaultHarness?: AgentHarness }> {
  if (!isReusableBlankDeferredSession({ ...input, defaultHarness: input.currentHarness })) {
    return { action: 'not-reusable' }
  }
  const defaultHarness = await loadDefaultHarness()
  return shouldReplaceBlankDeferredSessionHarness({ ...input, defaultHarness })
    ? { action: 'replace', defaultHarness }
    : { action: 'reuse', defaultHarness }
}
