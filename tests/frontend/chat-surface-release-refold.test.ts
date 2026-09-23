import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The folding layer is the thing under test: assert *when* the re-fold is
 * requested, without a DOM (same pattern as `subagent-trace-flicker.test.ts`).
 */
const folding = vi.hoisted(() => ({
  releaseProcessGroups: vi.fn(() => ({ groups: 0, restored: 0, dropped: 0 })),
}))
vi.mock('@/components/chat/panel-decoration/process-folding', () => folding)

import {
  ProcessGroupReleaseBoundary,
  type ProcessGroupReleaseGate,
} from '../../src/components/chat/surface/ChatSurface'
import type {
  AgentMessage,
  AssistantMessage as AssistantMessageType,
  Usage,
} from '../../src/components/chat/surface/ChatTypes'

type BoundaryProps = ProcessGroupReleaseGate & {
  getReleaseRoot: () => HTMLElement | null
  onReleased?: () => void
}

/** The boundary with its lifecycle callable directly and mutable props. */
type BoundaryInstance = {
  props: BoundaryProps
  getSnapshotBeforeUpdate(prevProps: BoundaryProps): unknown
  componentDidUpdate(prevProps: BoundaryProps, prevState: unknown, released: unknown): void
  componentWillUnmount(): void
}

function usage(): Usage {
  return {
    input: 10,
    output: 20,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 30,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
  }
}

function assistantMessage(timestamp: number): AssistantMessageType {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'answer' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-test',
    usage: usage(),
    stopReason: 'stop',
    timestamp,
  }
}

function releaseStats(groups: number) {
  return { groups, restored: groups, dropped: 0 }
}

function mounted(props: BoundaryProps): BoundaryInstance {
  return new ProcessGroupReleaseBoundary(props) as unknown as BoundaryInstance
}

const RELEASE_ROOT = () => ({}) as HTMLElement

beforeEach(() => {
  folding.releaseProcessGroups.mockReset()
  folding.releaseProcessGroups.mockReturnValue(releaseStats(0))
})

/**
 * The hand-back is a two-half contract: release *before* React mutates the
 * subtree, re-fold in the same task *after* the commit. Deferring the re-fold
 * (animation frame) leaves one painted frame with the released nodes back in
 * their natural position — the flicker right after the thinking段 ends.
 */
describe('chat surface process-group release hand-back', () => {
  const messages: AgentMessage[] = [{ role: 'user', content: 'run it', timestamp: 1 }]

  it('re-folds in the same commit that handed the groups back', () => {
    const onReleased = vi.fn()
    // The commit that ends the thinking段: the streaming container unmounts and
    // the streaming partial clears, so the gate releases.
    const prev: BoundaryProps = {
      messages,
      isStreaming: true,
      streamingAssistant: assistantMessage(9),
      getReleaseRoot: RELEASE_ROOT,
      onReleased,
    }
    const next: BoundaryProps = {
      messages,
      isStreaming: false,
      getReleaseRoot: RELEASE_ROOT,
      onReleased,
    }
    const instance = mounted(prev)
    folding.releaseProcessGroups.mockReturnValue(releaseStats(1))

    instance.props = next
    const snapshot = instance.getSnapshotBeforeUpdate(prev)
    expect(folding.releaseProcessGroups).toHaveBeenCalledTimes(1)
    // The release runs before React mutates the subtree: re-folding here would
    // fold nodes of the outgoing DOM.
    expect(onReleased).not.toHaveBeenCalled()

    // React runs the paired lifecycle right after the mutation phase, still in
    // the same task, so the synchronous re-fold is never painted unfolded.
    instance.componentDidUpdate(prev, undefined, snapshot)
    expect(onReleased).toHaveBeenCalledTimes(1)
  })

  it('does not re-fold when no group was handed back', () => {
    const onReleased = vi.fn()
    const prev: BoundaryProps = { messages, isStreaming: true, getReleaseRoot: RELEASE_ROOT, onReleased }
    const next: BoundaryProps = { messages, isStreaming: false, getReleaseRoot: RELEASE_ROOT, onReleased }
    const instance = mounted(prev)

    instance.props = next
    const snapshot = instance.getSnapshotBeforeUpdate(prev)
    expect(snapshot).toBe(false)
    instance.componentDidUpdate(prev, undefined, snapshot)
    expect(onReleased).not.toHaveBeenCalled()
  })

  it('skips both halves on a structure-preserving streaming frame', () => {
    const onReleased = vi.fn()
    const streaming = assistantMessage(9)
    const prev: BoundaryProps = {
      messages,
      isStreaming: true,
      streamingAssistant: streaming,
      getReleaseRoot: RELEASE_ROOT,
      onReleased,
    }
    // Pure streaming frame: same rows, same flags, fresh partial object.
    const next: BoundaryProps = {
      messages,
      isStreaming: true,
      streamingAssistant: { ...streaming },
      getReleaseRoot: RELEASE_ROOT,
      onReleased,
    }
    const instance = mounted(prev)

    instance.props = next
    expect(instance.getSnapshotBeforeUpdate(prev)).toBe(false)
    expect(folding.releaseProcessGroups).not.toHaveBeenCalled()
    instance.componentDidUpdate(prev, undefined, false)
    expect(onReleased).not.toHaveBeenCalled()
  })

  it('hands the nodes back on unmount without asking for a re-fold', () => {
    const onReleased = vi.fn()
    const instance = mounted({ messages, isStreaming: false, getReleaseRoot: RELEASE_ROOT, onReleased })
    folding.releaseProcessGroups.mockReturnValue(releaseStats(1))

    instance.componentWillUnmount()

    expect(folding.releaseProcessGroups).toHaveBeenCalledTimes(1)
    expect(onReleased).not.toHaveBeenCalled()
  })
})
