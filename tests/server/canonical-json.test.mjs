import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '../../server/sqlite/canonical-json.mjs'

// Reference pipeline: the exact composition the single-pass serializer
// replaced in session-state-repository.mjs (round-trip -> sort keys -> drop
// undefined -> stringify). The differential test below pins byte equality
// between this reference and canonicalJsonStringify, so digests stored by
// older builds keep matching.
function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isPlainObject(value)) return value
  return Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonicalize(value[key])]))
}

function referenceCanonicalJson(value) {
  return JSON.stringify(canonicalize(JSON.parse(JSON.stringify(value))))
}

const corpus = [
  null,
  true,
  false,
  0,
  -0,
  1,
  -1.5,
  1e21,
  1e-7,
  5e-324,
  Number.MAX_SAFE_INTEGER,
  NaN,
  Infinity,
  -Infinity,
  '',
  'plain',
  'quote " and \\ backslash',
  'control \u0000\u001f\u007f chars',
  'line separator \u2028 paragraph \u2029',
  'emoji 😀 and 中文 and combining é',
  'lone surrogate \ud83d',
  {},
  [],
  { a: 1 },
  { b: 2, a: 1 },
  { a: undefined, b: 1 },
  { fn: () => 1, keep: 'yes' },
  { sym: Symbol('x'), n: 2 },
  [1, 2, 3],
  [undefined, () => 2, Symbol('y'), null],
  [, , 1],
  new Array(4),
  { nested: { z: { y: { x: 'deep' } }, a: [1, [2, [3, null]]] } },
  { messages: [{ id: 'm1', role: 'user', content: 'hello', usage: { input: 1, output: 2 } }, { id: 'm2', role: 'assistant', content: [{ type: 'text', text: 'hi' }] }] },
  { unicodeKeys: { 中: 1, 'é': 2, Z: 3, a: 4, '🚀': 5 } },
  { emptyValues: { s: '', n: 0, b: false, nn: null, arr: [], obj: {} } },
  new Date('2026-08-26T12:00:00.000Z'),
  { at: new Date('2026-01-01T00:00:00.000Z') },
  { 'toJSON returns object': (() => { const o = { toJSON: () => ({ b: 1, a: 2 }) }; return o })() },
  { 'toJSON returns array': (() => { const o = { toJSON: () => [3, 1] }; return o })() },
  { 'toJSON returns undefined': (() => { const o = { toJSON: () => undefined, other: 1 }; return o })() },
  Object.assign(Object.create(null), { b: 1, a: 2 }),
  (() => { class Box { constructor() { this.b = 'beta'; this.a = 'alpha' } } return new Box() })(),
  new Map([['a', 1]]),
  new Set([1]),
  (() => { const deep = { v: 1 }; let cursor = deep; for (let i = 0; i < 200; i += 1) { cursor.child = { v: i }; cursor = cursor.child } return deep })(),
  (() => { const arr = []; for (let i = 0; i < 500; i += 1) arr.push({ seq: i, text: `message ${i}`, tags: ['a', 'b'] }); return { messages: arr } })(),
]

describe('canonicalJsonStringify differential equivalence', () => {
  it.each(corpus.map((value, index) => [index, value]))('matches reference pipeline for corpus entry #%i', (index, value) => {
    expect(canonicalJsonStringify(value)).toBe(referenceCanonicalJson(value))
  })

  it('drops undefined/function/symbol object values and nulls them in arrays', () => {
    const value = { a: undefined, b: () => 1, c: Symbol('s'), keep: [undefined, () => 2, Symbol('t'), 0] }
    expect(canonicalJsonStringify(value)).toBe('{"keep":[null,null,null,0]}')
  })

  it('sorts keys in UTF-16 code unit order like Array#sort', () => {
    // 中 is a single code unit (U+4E2D = 20013) and sorts before 🚀 whose
    // first surrogate unit is U+D83D (55357); valid pairs are not escaped.
    expect(canonicalJsonStringify({ b: 1, A: 2, a: 3, '🚀': 4, '中': 5 })).toBe('{"A":2,"a":3,"b":1,"中":5,"🚀":4}')
  })

  it('formats numbers and strings exactly like JSON.stringify', () => {
    for (const primitive of [-0, 1e21, 1e-7, NaN, Infinity, -Infinity, 0.1, '"a\\b/c\u0000']) {
      expect(canonicalJsonStringify(primitive)).toBe(JSON.stringify(primitive))
    }
  })

  it('returns undefined for a top-level undefined/function/symbol like JSON.stringify', () => {
    expect(canonicalJsonStringify(undefined)).toBeUndefined()
    expect(canonicalJsonStringify(() => 1)).toBeUndefined()
    expect(canonicalJsonStringify(Symbol('x'))).toBeUndefined()
  })

  it('throws on bigint anywhere it would be serialized', () => {
    expect(() => canonicalJsonStringify({ ok: 1n })).toThrow(TypeError)
    expect(() => canonicalJsonStringify([1n])).toThrow(TypeError)
  })

  it('throws on circular structures instead of recursing forever', () => {
    const a = { self: null }
    a.self = a
    expect(() => canonicalJsonStringify(a)).toThrow()
  })

  it('applies toJSON at most once per value (JSON.stringify semantics)', () => {
    const inner = { toJSON: () => 'inner', real: 1 }
    const outer = { toJSON: () => inner }
    expect(canonicalJsonStringify(outer)).toBe(referenceCanonicalJson(outer))
  })
})
