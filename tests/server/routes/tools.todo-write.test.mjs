import { describe, expect, it } from 'vitest'
import { handleToolApi } from '../../../server/routes/tools.mjs'

describe('tools route contracts', () => {
  it('keeps todo_write disabled for direct REST calls', async () => {
    await expect(handleToolApi(
      { method: 'POST' },
      {},
      new URL('http://quickforge.local/api/tools/todo_write'),
    )).rejects.toMatchObject({ message: 'Unknown tool: todo_write', statusCode: 404 })
  })
})
