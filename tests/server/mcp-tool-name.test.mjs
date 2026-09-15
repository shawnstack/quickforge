import { describe, expect, it } from 'vitest'
import {
  createMcpToolName,
  isCanonicalMcpServerName,
  isCanonicalMcpToolName,
  parseMcpToolName,
  sanitizeMcpToolName,
} from '../../server/mcp/tool-name.mjs'

describe('isCanonicalMcpServerName', () => {
  it('accepts lowercase letters, digits, single hyphens, up to 64 chars', () => {
    expect(isCanonicalMcpServerName('a')).toBe(true)
    expect(isCanonicalMcpServerName('ab')).toBe(true)
    expect(isCanonicalMcpServerName('a-b')).toBe(true)
    expect(isCanonicalMcpServerName('a1-b2')).toBe(true)
    expect(isCanonicalMcpServerName('a'.repeat(64))).toBe(true)
  })

  it('rejects uppercase, underscores, dots, bad hyphen placement, and over-length names', () => {
    expect(isCanonicalMcpServerName('Server')).toBe(false)
    expect(isCanonicalMcpServerName('my_server')).toBe(false)
    expect(isCanonicalMcpServerName('my.server')).toBe(false)
    expect(isCanonicalMcpServerName('-server')).toBe(false)
    expect(isCanonicalMcpServerName('server-')).toBe(false)
    expect(isCanonicalMcpServerName('my--server')).toBe(false)
    expect(isCanonicalMcpServerName('')).toBe(false)
    expect(isCanonicalMcpServerName('a'.repeat(65))).toBe(false)
    expect(isCanonicalMcpServerName(null)).toBe(false)
    expect(isCanonicalMcpServerName(42)).toBe(false)
  })
})

describe('sanitizeMcpToolName', () => {
  it('replaces unsupported characters with underscores and strips leading/trailing ones', () => {
    expect(sanitizeMcpToolName('read file')).toBe('read_file')
    expect(sanitizeMcpToolName('my tool!')).toBe('my_tool')
    expect(sanitizeMcpToolName('  padded  ')).toBe('padded')
    expect(sanitizeMcpToolName('_wrapped_')).toBe('wrapped')
  })

  it('keeps alphanumerics, underscores, and hyphens untouched', () => {
    expect(sanitizeMcpToolName('a__b-c')).toBe('a__b-c')
    // Hyphens are not stripped even at the edges (only underscores are).
    expect(sanitizeMcpToolName('-tool-')).toBe('-tool-')
  })

  it('falls back to "tool" when nothing survives sanitization', () => {
    expect(sanitizeMcpToolName('')).toBe('tool')
    expect(sanitizeMcpToolName(null)).toBe('tool')
    expect(sanitizeMcpToolName(undefined)).toBe('tool')
    expect(sanitizeMcpToolName('!@#$')).toBe('tool')
    expect(sanitizeMcpToolName('保留')).toBe('tool')
  })
})

describe('createMcpToolName', () => {
  it('joins the server and sanitized tool name with the mcp prefix', () => {
    expect(createMcpToolName('docs', 'search')).toBe('mcp__docs__search')
    expect(createMcpToolName('docs', 'my tool!')).toBe('mcp__docs__my_tool')
    expect(createMcpToolName('docs', '')).toBe('mcp__docs__tool')
  })
})

describe('parseMcpToolName', () => {
  it('splits a prefixed name into server and tool parts', () => {
    expect(parseMcpToolName('mcp__docs__search')).toEqual({ serverName: 'docs', toolName: 'search' })
  })

  it('splits at the first separator so tool names may contain double underscores', () => {
    expect(parseMcpToolName('mcp__docs__search__v2')).toEqual({ serverName: 'docs', toolName: 'search__v2' })
  })

  it('returns null for non-prefixed or malformed names', () => {
    expect(parseMcpToolName('docs__search')).toBeNull()
    expect(parseMcpToolName('mcp__docs__')).toBeNull()
    expect(parseMcpToolName('mcp____search')).toBeNull()
    expect(parseMcpToolName('mcp__')).toBeNull()
    expect(parseMcpToolName('')).toBeNull()
    expect(parseMcpToolName(null)).toBeNull()
    expect(parseMcpToolName(undefined)).toBeNull()
  })
})

describe('isCanonicalMcpToolName', () => {
  it('accepts names that round-trip through createMcpToolName', () => {
    expect(isCanonicalMcpToolName(createMcpToolName('docs', 'search'))).toBe(true)
    expect(isCanonicalMcpToolName(createMcpToolName('docs', 'search__v2'))).toBe(true)
  })

  it('rejects names whose parts do not match the canonical rules', () => {
    expect(isCanonicalMcpToolName('mcp__DOCS__search')).toBe(false) // non-canonical server name
    expect(isCanonicalMcpToolName('mcp__docs__my tool')).toBe(false) // needs sanitization
    expect(isCanonicalMcpToolName('mcp__docs-__search')).toBe(false) // trailing hyphen server name
    expect(isCanonicalMcpToolName('docs__search')).toBe(false) // missing prefix
    expect(isCanonicalMcpToolName('')).toBe(false)
    expect(isCanonicalMcpToolName(null)).toBe(false)
    expect(isCanonicalMcpToolName(7)).toBe(false)
  })
})
