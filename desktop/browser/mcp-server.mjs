import { createServer } from 'node:http'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const MAX_BODY_BYTES = 1024 * 1024
const MCP_PATH = '/mcp'

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true }
const MUTATING = { readOnlyHint: false, destructiveHint: false, openWorldHint: true }

/**
 * 工具集刻意保持「少而正交」：navigate / snapshot / click / type / press_key /
 * scroll / wait_for / screenshot / evaluate。不做带 action 参数的万能工具 ——
 * 模型填参数最容易错的地方就是这种多态签名。
 */
const TOOL_DEFINITIONS = [
  {
    name: 'navigate',
    title: 'Open a URL',
    description: 'Open an http(s) URL in the built-in desktop browser. Local hosts, private IP ranges and file:// URLs are rejected by policy. Returns the final URL, title and load state.',
    annotations: MUTATING,
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Absolute http(s) URL.' } },
      required: ['url'],
      additionalProperties: false,
    },
  },
  {
    name: 'snapshot',
    title: 'Read the page',
    description: 'Return an accessibility-tree snapshot of the page with stable refs like e12@g3. Always call this before click/type: refs from an older snapshot are rejected. Prefer this over evaluate for reading.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { maxChars: { type: 'number', description: 'Optional character budget for the returned text.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'click',
    title: 'Click an element',
    description: 'Click the element identified by a ref from the latest snapshot.',
    annotations: MUTATING,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref from the latest snapshot, e.g. e7@g3.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        clickCount: { type: 'number', description: '1 for a single click, 2 for a double click.' },
      },
      required: ['ref'],
      additionalProperties: false,
    },
  },
  {
    name: 'type',
    title: 'Type into an element',
    description: 'Focus the element identified by a ref and insert text. Set submit to press Enter afterwards.',
    annotations: MUTATING,
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string', description: 'Ref from the latest snapshot.' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'press_key',
    title: 'Press a key',
    description: 'Press a single key, optionally with modifiers (Alt, Control, Meta, Shift).',
    annotations: MUTATING,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, Home, End, PageUp, PageDown, Space, or a single character.' },
        modifiers: { type: 'array', items: { type: 'string' } },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  {
    name: 'scroll',
    title: 'Scroll the page',
    description: 'Scroll the viewport vertically. Positive deltaY scrolls down.',
    annotations: MUTATING,
    inputSchema: {
      type: 'object',
      properties: { deltaY: { type: 'number' } },
      additionalProperties: false,
    },
  },
  {
    name: 'wait_for',
    title: 'Wait for text',
    description: 'Wait until the given visible text appears on the page. Use after navigation on single-page apps instead of assuming the page is ready.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Text expected to appear in the page body.' },
        timeoutMs: { type: 'number' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'screenshot',
    title: 'Capture a screenshot',
    description: 'Save a PNG screenshot of the current page for the user to review and return its file path. Only intended for human review: image bytes are not sent to the model, so use snapshot to read content.',
    annotations: READ_ONLY,
    inputSchema: {
      type: 'object',
      properties: { fullPage: { type: 'boolean' } },
      additionalProperties: false,
    },
  },
  {
    name: 'evaluate',
    title: 'Run JavaScript',
    description: 'Evaluate a JavaScript expression in the page and return its value. Runs with the page origin only (no Node or Electron APIs). Prefer snapshot for reading.',
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string' },
        awaitPromise: { type: 'boolean' },
      },
      required: ['expression'],
      additionalProperties: false,
    },
  },
]

function formatResult(toolName, result) {
  if (!result) return 'No result.'
  if (toolName === 'snapshot' && result.text) {
    const notes = [`generation=g${result.generation}`, `nodes=${result.nodeCount}`]
    if (result.truncated) notes.push('truncated=true')
    return `${result.text}\n\n[${notes.join(' ')}]`
  }
  if (typeof result.message === 'string') {
    return result.path ? `${result.message}\npath: ${result.path}` : result.message
  }
  return JSON.stringify(result)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function createMcpServerFor(host) {
  const server = new Server(
    { name: 'quickforge-desktop-browser', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFINITIONS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request?.params?.name
    const args = request?.params?.arguments || {}
    if (!TOOL_DEFINITIONS.some((tool) => tool.name === toolName)) {
      return { content: [{ type: 'text', text: `Unknown tool: ${toolName}` }], isError: true }
    }
    try {
      const result = await host.execute(toolName, args)
      return {
        content: [{ type: 'text', text: formatResult(toolName, result) }],
        isError: result?.ok === false,
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Browser tool failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      }
    }
  })

  return server
}

/**
 * 桌面浏览器 MCP server：跑在 Electron 主进程里，只监听回环地址并强制 Bearer token。
 *
 * 采用无状态（每请求一个 transport）模式：服务端子进程重启、MCP 客户端重连时
 * 不需要任何会话协商，也就没有"陈旧 session id"这类故障模式。
 */
export async function createDesktopBrowserMcpServer({ host, token }) {
  if (!token) throw new Error('Desktop browser MCP server requires a token')

  const httpServer = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    if (url.pathname !== MCP_PATH) {
      res.writeHead(404).end('Not found')
      return
    }
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end('Unauthorized')
      return
    }
    if (req.method !== 'POST') {
      // 无状态模式没有可续传的流，也不存在可删除的 session。
      res.writeHead(405).end('Method not allowed')
      return
    }

    let body
    try {
      body = JSON.parse(await readBody(req))
    } catch {
      res.writeHead(400).end('Invalid JSON body')
      return
    }

    const server = createMcpServerFor(host)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, body)
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end(error instanceof Error ? error.message : 'MCP request failed')
    }
  })

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', () => {
      httpServer.off('error', reject)
      resolve()
    })
  })

  const address = httpServer.address()
  const port = typeof address === 'object' && address ? address.port : 0

  return {
    url: `http://127.0.0.1:${port}${MCP_PATH}`,
    close: () => new Promise((resolve) => httpServer.close(() => resolve())),
  }
}
