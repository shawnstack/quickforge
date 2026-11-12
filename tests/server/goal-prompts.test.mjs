import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  GOAL_CHAT_OUTPUT_RULES,
  continuationVisibleText,
  goalContinuationPrompt,
  goalPlanningPrompt,
  planningVisibleText,
} from '../../server/goal-prompts.mjs'

const attachmentTmpDirs = []
afterAll(() => {
  for (const dir of attachmentTmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* best-effort cleanup */ }
  }
})

function createAttachmentFile(fileName, content) {
  const dir = mkdtempSync(join(tmpdir(), 'goal-prompts-attachment-'))
  attachmentTmpDirs.push(dir)
  const filePath = join(dir, fileName)
  writeFileSync(filePath, content, 'utf8')
  return filePath
}

function goalFixture(overrides = {}) {
  return {
    objective: 'Ship goal mode',
    criteria: [],
    evidence: [],
    scope: [],
    summary: '',
    status: 'running',
    ...overrides,
  }
}

describe('goalPlanningPrompt', () => {
  it('wraps the objective in a planning tag and marks the turn read-only', () => {
    const prompt = goalPlanningPrompt(goalFixture())
    expect(prompt).toContain('<goal_planning objective="Ship goal mode">')
    expect(prompt).toContain('This planning turn is READ-ONLY')
    expect(prompt).toContain('action="plan"')
    expect(prompt).toContain('</goal_planning>')
  })

  it('escapes XML-special characters in the objective attribute', () => {
    const prompt = goalPlanningPrompt(goalFixture({ objective: 'a"b & <c>' }))
    expect(prompt).toContain('objective="a&quot;b &amp; &lt;c&gt;"')
    expect(prompt).not.toContain('<goal_planning objective="a"')
  })

  it('converts a missing objective to an empty attribute instead of "undefined"', () => {
    const goal = goalFixture()
    delete goal.objective
    const prompt = goalPlanningPrompt(goal)
    expect(prompt).toContain('<goal_planning objective="">')
    expect(prompt).not.toContain('undefined')
  })

  it('omits the attachment section entirely when there are no attachments', () => {
    const prompt = goalPlanningPrompt(goalFixture())
    expect(prompt).not.toContain('Attached reference files')
  })

  it('lists attachments that exist and flags missing ones', () => {
    const present = createAttachmentFile('notes.txt', 'attachment body')
    const dir = mkdtempSync(join(tmpdir(), 'goal-prompts-attachment-'))
    attachmentTmpDirs.push(dir)
    const missing = join(dir, 'missing.txt')
    const prompt = goalPlanningPrompt(goalFixture({
      attachments: [
        { fileName: 'notes.txt', path: present },
        { fileName: 'gone.txt', path: missing },
        { fileName: 'unnamed.txt', path: '' },
      ],
    }))
    expect(prompt).toContain(`- notes.txt: ${present}`)
    expect(prompt).toContain(`- gone.txt: (attachment file no longer available: ${missing})`)
    expect(prompt).toContain('- unnamed.txt: (no readable path recorded)')
    expect(prompt).toContain('Attached reference files')
  })
})

describe('goalContinuationPrompt', () => {
  it('renders round/max/status attributes and fallbacks for empty plan data', () => {
    const prompt = goalContinuationPrompt(goalFixture(), 3, 8)
    expect(prompt).toContain('<goal_continuation round="3" max_rounds="8" status="running">')
    expect(prompt).toContain('Objective: Ship goal mode')
    expect(prompt).toContain('Scope: (not recorded)')
    expect(prompt).toContain('Summary so far: (none)')
    expect(prompt).toContain('(no criteria recorded yet)')
    expect(prompt).toContain('Evidence:')
    expect(prompt).toContain('- (none)')
  })

  it('renders each criterion with required marker, status, description and evidence ids', () => {
    const prompt = goalContinuationPrompt(goalFixture({
      criteria: [
        { id: 'c1', description: 'Tests pass', required: true, status: 'passed', evidenceIds: ['e1'] },
        { id: 'c2', description: 'Docs look right', required: false, status: 'pending', evidenceIds: [] },
      ],
      evidence: [{ id: 'e1', description: 'tests passed', toolCallId: 'tool-1' }],
      scope: ['server/', 'tests/'],
      summary: 'Halfway done',
    }), 2, 8)
    expect(prompt).toContain('Scope: server/, tests/')
    expect(prompt).toContain('Summary so far: Halfway done')
    expect(prompt).toContain('- [c1] (required) passed: Tests pass (evidence: e1)')
    expect(prompt).toContain('- [c2] pending: Docs look right (evidence: -)')
    expect(prompt).toContain('- [e1] tests passed (toolCallId: tool-1)')
  })

  it('marks evidence without a toolCallId as none', () => {
    const prompt = goalContinuationPrompt(goalFixture({
      evidence: [{ id: 'h_1', description: 'human accepted', toolCallId: '' }],
    }), 1, 8)
    expect(prompt).toContain('- [h_1] human accepted (toolCallId: none)')
  })

  it('joins multiple evidence ids per criterion with a comma', () => {
    const prompt = goalContinuationPrompt(goalFixture({
      criteria: [{ id: 'c1', description: 'Tests pass', required: true, status: 'passed', evidenceIds: ['e1', 'e2'] }],
    }), 1, 8)
    expect(prompt).toContain('(evidence: e1, e2)')
  })

  it('passes round/max_rounds/status through unchanged even for zeroed values', () => {
    const prompt = goalContinuationPrompt(goalFixture({ status: 'verifying' }), 0, 0)
    expect(prompt).toContain('round="0" max_rounds="0" status="verifying"')
  })

  it('embeds the shared chat output rules verbatim', () => {
    const prompt = goalContinuationPrompt(goalFixture(), 1, 8)
    expect(prompt).toContain(GOAL_CHAT_OUTPUT_RULES)
    expect(prompt).toContain('goal_report(action="progress")')
    expect(prompt).toContain('goal_report(action="blocked")')
    for (const line of GOAL_CHAT_OUTPUT_RULES.split('\n')) {
      expect(prompt).toContain(line)
    }
  })

  it('appends the attachment section when attachments exist', () => {
    const present = createAttachmentFile('ref.md', 'reference')
    const prompt = goalContinuationPrompt(goalFixture({
      attachments: [{ fileName: 'ref.md', path: present }],
    }), 2, 8)
    expect(prompt).toContain(`- ref.md: ${present}`)
  })
})

describe('continuationVisibleText / planningVisibleText', () => {
  it('labels the continuation round in Chinese with current/max rounds', () => {
    expect(continuationVisibleText(2, 8)).toBe('继续执行目标（第 2/8 轮）')
    expect(continuationVisibleText(1, 20)).toBe('继续执行目标（第 1/20 轮）')
  })

  it('labels replanning attempts in Chinese', () => {
    expect(planningVisibleText(3)).toBe('重新规划目标（第 3 次）')
    expect(planningVisibleText(1)).toBe('重新规划目标（第 1 次）')
  })
})
