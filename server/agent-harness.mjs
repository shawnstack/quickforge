// agent-manager 模块拆分（agent-manager-module-split）：Harness/访问模式常量与
// 归一化 helper 从 agent-manager.mjs 逐字符搬移至此；agent-manager.mjs 继续
// re-export 公共符号（normalizeAgentHarness/validateAgentHarness），导出面不变。

const AGENT_ACCESS_MODE_DEFAULT = 'default'
const AGENT_ACCESS_MODE_FULL_ACCESS = 'full-access'
const AGENT_HARNESS_QUICKFORGE = 'quickforge'
const AGENT_HARNESS_OPENCODE = 'opencode'

function normalizeAgentHarness(value, fallback = AGENT_HARNESS_QUICKFORGE) {
  if (value === AGENT_HARNESS_QUICKFORGE || value === AGENT_HARNESS_OPENCODE) return value
  if (fallback !== value) return normalizeAgentHarness(fallback, AGENT_HARNESS_QUICKFORGE)
  return AGENT_HARNESS_QUICKFORGE
}

function validateAgentHarness(value) {
  if (value === undefined || value === null || value === '') return AGENT_HARNESS_QUICKFORGE
  if (value === 'claude-code') {
    throw Object.assign(new Error('Claude Code Harness is not available yet.'), { statusCode: 400 })
  }
  if (value !== AGENT_HARNESS_QUICKFORGE && value !== AGENT_HARNESS_OPENCODE) {
    throw Object.assign(new Error(`Unsupported Harness: ${value}`), { statusCode: 400 })
  }
  return value
}

function normalizeAccessMode(value, fallback = AGENT_ACCESS_MODE_DEFAULT) {
  if (value === AGENT_ACCESS_MODE_DEFAULT || value === AGENT_ACCESS_MODE_FULL_ACCESS) return value
  if (value === true || value === 'true') return AGENT_ACCESS_MODE_FULL_ACCESS
  if (value === false || value === 'false') return AGENT_ACCESS_MODE_DEFAULT
  if (fallback !== value) return normalizeAccessMode(fallback, AGENT_ACCESS_MODE_DEFAULT)
  return AGENT_ACCESS_MODE_DEFAULT
}

function yoloModeFromAccessMode(accessMode) {
  return normalizeAccessMode(accessMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

function hasFullAccess(session) {
  return normalizeAccessMode(session?.accessMode, session?.yoloMode) === AGENT_ACCESS_MODE_FULL_ACCESS
}

export {
  AGENT_ACCESS_MODE_DEFAULT,
  AGENT_ACCESS_MODE_FULL_ACCESS,
  AGENT_HARNESS_QUICKFORGE,
  AGENT_HARNESS_OPENCODE,
  normalizeAgentHarness,
  validateAgentHarness,
  normalizeAccessMode,
  yoloModeFromAccessMode,
  hasFullAccess,
}
