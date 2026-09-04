import { describe, expect, it } from 'vitest'
import * as agentManager from '../../server/agent-manager.mjs'

// agent-manager 模块拆分（agent-manager-module-split）的导出面契约：
// 拆分全程 agent-manager.mjs 作为 facade re-export 同名符号，消费方零改动。
// 本清单锁定导出符号集合——任何增删都必须是拆分完成后的显式决策，不允许悄悄变化。
const EXPECTED_EXPORTS = [
  'abortRun',
  'abortToolCall',
  'agentEvents',
  'answerAsk',
  'appendAssistantErrorMessageOnce',
  'approveAutoCompact',
  'approveToolCall',
  'canApplyGeneratedTitle',
  'continueSession',
  'createAgent',
  'destroyAgent',
  'followUpAgent',
  'forkSession',
  'getPendingAskForSession',
  'getSessionEventBus',
  'getSessionState',
  'getSessionStatus',
  'isSseConnected',
  'listSessions',
  'markLatestAssistantProcessFinished',
  'normalizeAgentHarness',
  'normalizeAskQuestions',
  'persistSessionState',
  'refreshAllSessionModels',
  'refreshAllSessionTools',
  'rejectAutoCompact',
  'rejectToolCall',
  'releaseSse',
  'resetStaleTaskStatuses',
  'restoreAgent',
  'rollbackSessionMessages',
  'rollbackStartIndexFromMessage',
  'runPrompt',
  'shutdown',
  'steerAgent',
  'stripSplitSessionState',
  'syncSessionFromStorage',
  'touchSession',
  'tryAcquireSse',
  'updateSessionAccessMode',
  'updateSessionHarnessConfigOption',
  'updateSessionHarnessMode',
  'updateSessionModel',
  'updateSessionThinkingLevel',
  'updateSessionTitle',
  'updateSessionYoloMode',
  'validateAgentHarness',
]

describe('agent-manager export contract (module split safety net)', () => {
  it('exports exactly the expected symbol set', () => {
    expect(Object.keys(agentManager).sort()).toEqual(EXPECTED_EXPORTS)
  })

  it('exports functions/event emitter values, not undefined', () => {
    for (const name of EXPECTED_EXPORTS) {
      expect(agentManager[name], `export ${name} must be defined`).toBeDefined()
    }
  })

  it('public API entry points remain callable functions', () => {
    const functionExports = EXPECTED_EXPORTS.filter((name) => name !== 'agentEvents')
    for (const name of functionExports) {
      expect(typeof agentManager[name], `export ${name} must be a function`).toBe('function')
    }
  })
})
