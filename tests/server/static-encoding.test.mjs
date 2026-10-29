import { describe, expect, it } from 'vitest'
import { selectContentEncoding } from '../../server/routes/static.mjs'

describe('selectContentEncoding', () => {
  it('prefers brotli when both variants exist', () => {
    expect(selectContentEncoding('gzip, deflate, br', ['br', 'gz'])).toBe('br')
  })

  it('falls back to gzip when brotli is unavailable', () => {
    expect(selectContentEncoding('gzip, deflate, br', ['gz'])).toBe('gz')
  })

  it('returns null when the client accepts no supported encoding', () => {
    expect(selectContentEncoding('', ['br', 'gz'])).toBeNull()
    expect(selectContentEncoding('deflate', ['br', 'gz'])).toBeNull()
  })

  it('honours q=0 as an explicit rejection', () => {
    expect(selectContentEncoding('br;q=0, gzip', ['br', 'gz'])).toBe('gz')
    expect(selectContentEncoding('br;q=0, gzip;q=0', ['br', 'gz'])).toBeNull()
  })

  it('matches gzip tokens case-insensitively', () => {
    expect(selectContentEncoding('GZIP', ['gz'])).toBe('gz')
  })
})
