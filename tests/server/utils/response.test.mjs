import { describe, it, expect } from 'vitest'
import { sendJson, sendError, readJsonBody, decodeSegment } from '../../../server/utils/response.mjs'

function mockRes() {
  const res = {
    headersSent: false,
    _status: null,
    _headers: {},
    _body: '',
    writeHead(status, headers) {
      res._status = status
      Object.assign(res._headers, headers)
    },
    end(body) {
      res._body = body ?? ''
    },
  }
  return res
}

function mockReq(chunks, opts = {}) {
  const req = {
    [Symbol.asyncIterator]() {
      let index = 0
      return {
        async next() {
          if (index < chunks.length) return { value: Buffer.from(chunks[index++]), done: false }
          return { done: true }
        },
      }
    },
  }
  return req
}

describe('response', () => {
  describe('sendJson', () => {
    it('sends JSON with correct status and headers', () => {
      const res = mockRes()
      sendJson(res, 200, { hello: 'world' })

      expect(res._status).toBe(200)
      expect(res._headers['content-type']).toBe('application/json; charset=utf-8')
      expect(res._headers['cache-control']).toBe('no-store')
      expect(JSON.parse(res._body)).toEqual({ hello: 'world' })
    })

    it('sends 201 status', () => {
      const res = mockRes()
      sendJson(res, 201, { created: true })
      expect(res._status).toBe(201)
    })

    it('sends error status', () => {
      const res = mockRes()
      sendJson(res, 500, { error: 'fail' })
      expect(res._status).toBe(500)
    })
  })

  describe('sendError', () => {
    it('sends a JSON error with default 500 status', () => {
      const res = mockRes()
      sendError(res, new Error('something broke'))

      expect(res._status).toBe(500)
      const body = JSON.parse(res._body)
      expect(body.error).toBe('something broke')
    })

    it('uses the error statusCode when available', () => {
      const res = mockRes()
      const error = new Error('not found')
      error.statusCode = 404
      sendError(res, error)

      expect(res._status).toBe(404)
    })

    it('uses default message when error has none', () => {
      const res = mockRes()
      sendError(res, {})

      const body = JSON.parse(res._body)
      expect(body.error).toBe('Internal server error')
    })

    it('calls res.end() without sendJson if headers already sent', () => {
      const res = mockRes()
      res.headersSent = true
      sendError(res, new Error('late error'))

      expect(res._status).toBeNull()
      expect(res._body).toBe('')
    })
  })

  describe('readJsonBody', () => {
    it('parses valid JSON body', async () => {
      const req = mockReq([JSON.stringify({ key: 'value' })])
      const result = await readJsonBody(req)
      expect(result).toEqual({ key: 'value' })
    })

    it('returns null for empty body', async () => {
      const req = mockReq([])
      const result = await readJsonBody(req)
      expect(result).toBeNull()
    })

    it('throws on whitespace-only (non-empty) body', async () => {
      // readJsonBody trims then tries JSON.parse — whitespace is not valid JSON
      const req = mockReq(['   '])
      await expect(readJsonBody(req)).rejects.toThrow('Invalid JSON request body')
    })

    it('parses JSON with leading whitespace', async () => {
      const req = mockReq(['  {"a":1}'])
      const result = await readJsonBody(req)
      expect(result).toEqual({ a: 1 })
    })

    it('throws on invalid JSON', async () => {
      const req = mockReq(['not-json'])
      await expect(readJsonBody(req)).rejects.toThrow('Invalid JSON request body')
      await expect(readJsonBody(req).catch((e) => { throw e })).rejects.toHaveProperty('statusCode', 400)
    })

    it('throws when body exceeds maxBodyBytes', async () => {
      const req = mockReq([Buffer.alloc(200).toString()])
      await expect(readJsonBody(req, 100)).rejects.toThrow('Request body is too large')
      try {
        await readJsonBody(req, 100)
      } catch (error) {
        expect(error.statusCode).toBe(413)
      }
    })

    it('handles chunked input across multiple chunks', async () => {
      const req = mockReq(['{"hel', 'lo": ', '"world"}'])
      const result = await readJsonBody(req)
      expect(result).toEqual({ hello: 'world' })
    })
  })

  describe('decodeSegment', () => {
    it('decodes a URI-encoded segment', () => {
      expect(decodeSegment('hello%20world')).toBe('hello world')
    })

    it('returns empty string for empty input', () => {
      expect(decodeSegment('')).toBe('')
    })

    it('handles null/undefined gracefully', () => {
      expect(decodeSegment(null)).toBe('')
      expect(decodeSegment(undefined)).toBe('')
    })

    it('passes through non-encoded text unchanged', () => {
      expect(decodeSegment('simple-path')).toBe('simple-path')
    })
  })
})
