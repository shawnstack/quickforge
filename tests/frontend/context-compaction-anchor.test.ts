// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/i18n", () => ({ t: (key: string) => key }))

import { resolveCompactionMarkers } from "../../src/components/chat/surface/ContextCompactionNotice"
import { isRenderableMessage } from "../../src/components/chat/surface/content-parts"
import type { AgentMessage } from "../../src/components/chat/surface/ChatTypes"

/**
 * The divider must never be pinned to the window bottom while the run keeps
 * appending rows above it (the reported regression), and it must never slide
 * below a row whose tool calls the compaction just produced.
 *
 * Two signals are combined and the earlier one wins: the recorded message count
 * (shifted into window coordinates by the caller) and the first row whose
 * timestamp is at/after the round. The recorded count alone goes stale when the
 * window scrolls; the timestamp alone misses a message that started streaming
 * before the compaction and kept its older timestamp.
 */
const t0 = Date.parse(`2026-01-01T00:00:00.000Z`)

function stamped(role: `user` | `assistant`, offsetMs: number, text: string): AgentMessage {
  return role === `user`
    ? ({ role: `user`, content: text, timestamp: t0 + offsetMs } as AgentMessage)
    : ({ role: `assistant`, content: [{ type: `text`, text }], timestamp: t0 + offsetMs } as AgentMessage)
}

const compaction = {
  history: [{ compactedAt: new Date(t0).toISOString(), occurredAtIndex: 2, boundaryIndex: 2 }],
}

describe(`compaction divider anchor`, () => {
  it(`sits before the first row produced after the round`, () => {
    const messages = [
      stamped(`user`, -3000, `q1`),
      stamped(`assistant`, -2000, `a1`),
      stamped(`user`, 0, `summary`),
      stamped(`assistant`, 1000, `tool call`),
      stamped(`assistant`, 2000, `answer`),
    ]

    const markers = resolveCompactionMarkers({ compaction, messages, messageIndexOffset: 0, isRenderable: isRenderableMessage })

    expect(markers).toHaveLength(1)
    expect(markers[0]).toMatchObject({ rowIndex: 2, boundaryIndex: 2, anchorIndex: 2 })
  })

  it(`slides above rows appended after compaction instead of staying at the bottom`, () => {
    const before = [stamped(`user`, -3000, `q1`), stamped(`assistant`, -2000, `a1`)]

    const empty = resolveCompactionMarkers({ compaction, messages: before, messageIndexOffset: 0, isRenderable: isRenderableMessage })
    expect(empty[0]).toMatchObject({ rowIndex: 2, boundaryIndex: 2 })

    const running = [...before, stamped(`assistant`, 500, `first row after`), stamped(`assistant`, 900, `second row after`)]
    const withRows = resolveCompactionMarkers({ compaction, messages: running, messageIndexOffset: 0, isRenderable: isRenderableMessage })

    // Both new rows are below the line: the anchor follows content, not the tail.
    expect(withRows[0]).toMatchObject({ rowIndex: 2, boundaryIndex: 2, anchorIndex: 2 })
  })

  it(`clamps a round that happened before the window to its first row`, () => {
    const messages = [
      stamped(`assistant`, -3000, `before`),
      stamped(`assistant`, 500, `after`),
      stamped(`assistant`, 900, `later`),
    ]

    const markers = resolveCompactionMarkers({ compaction, messages, messageIndexOffset: 10, isRenderable: isRenderableMessage })

    // The recorded position (2) is outside the scrolled window [10, 13), so the
    // line belongs to the window edge - not to the first row that merely happens
    // to be timestamped after the round.
    expect(markers[0]).toMatchObject({ rowIndex: 0, boundaryIndex: 0, anchorIndex: 10 })
  })

  it(`stays above a message that was streaming when the compaction ran`, () => {
    // `occurredAtIndex: 2` is the length at the instant compaction ran: the row
    // at index 2 had started streaming before `compactedAt` and therefore keeps
    // an older timestamp, so the timestamp scan alone would skip it and drop the
    // line below that row - leaving its tool calls above the line.
    const messages = [
      stamped(`user`, -3000, `q1`),
      stamped(`assistant`, -2000, `a1`),
      stamped(`assistant`, -1500, `tool call started before the compaction`),
      stamped(`assistant`, 2000, `next answer`),
    ]

    const markers = resolveCompactionMarkers({ compaction, messages, messageIndexOffset: 0, isRenderable: isRenderableMessage })

    expect(markers[0]).toMatchObject({ rowIndex: 2, boundaryIndex: 2, anchorIndex: 2 })
  })

  it(`does not pin the line to the end when the recorded index is stale`, () => {
    const messages = [
      stamped(`user`, -3000, `q1`),
      stamped(`assistant`, 500, `after`),
      stamped(`assistant`, 900, `later`),
    ]

    const markers = resolveCompactionMarkers({
      compaction: { history: [{ compactedAt: new Date(t0).toISOString(), occurredAtIndex: 5, boundaryIndex: 5 }] },
      messages,
      messageIndexOffset: 0,
      isRenderable: isRenderableMessage,
    })

    // A recorded count past the rendered array is corrected by the timestamp
    // signal instead of clamping the line to the bottom of the list.
    expect(markers[0]).toMatchObject({ rowIndex: 1, boundaryIndex: 1, anchorIndex: 1 })
  })

  it(`falls back to the recorded index when the payload has no timestamp`, () => {
    const messages = [stamped(`user`, -3000, `q1`), stamped(`assistant`, -2000, `a1`)]

    const markers = resolveCompactionMarkers({
      compaction: { history: [{ occurredAtIndex: 1, boundaryIndex: 1 }] },
      messages,
      messageIndexOffset: 0,
      isRenderable: isRenderableMessage,
    })

    expect(markers[0]).toMatchObject({ rowIndex: 1, boundaryIndex: 1, anchorIndex: 1 })
  })
})
