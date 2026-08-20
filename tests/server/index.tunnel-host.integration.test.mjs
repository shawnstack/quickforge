import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const serverScript = path.join(projectRoot, 'server', 'index.mjs')

function findFreePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.unref()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function request(port, pathname, headers = {}, agent = false) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method: 'GET',
      headers,
      agent,
    }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        reusedSocket: req.reusedSocket,
      }))
    })
    req.setTimeout(2_000, () => req.destroy(new Error('Request timed out')))
    req.once('error', reject)
    req.end()
  })
}

async function waitForServer(port, child, getOutput) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited before becoming ready (${child.exitCode}).\n${getOutput()}`)
    }
    try {
      const response = await request(port, '/api/health', { host: `127.0.0.1:${port}` })
      if (response.status === 200) return
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Timed out waiting for server.\n${getOutput()}`)
}

function stopServer(child) {
  if (!child || child.exitCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const forceTimer = setTimeout(() => child.kill('SIGKILL'), 3_000)
    child.once('close', () => {
      clearTimeout(forceTimer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

describe('server tunnel Host exception', () => {
  let child
  let dataDir
  let port
  let output = ''

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'quickforge-tunnel-host-'))
    do {
      port = await findFreePort()
    } while (port === 18080)

    child = spawn(process.execPath, [serverScript], {
      cwd: projectRoot,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        QUICKFORGE_DATA_DIR: dataDir,
        QUICKFORGE_WORKSPACE_DIR: path.join(dataDir, 'workspace'),
        QUICKFORGE_HOST: '127.0.0.1',
        QUICKFORGE_PORT: String(port),
        QUICKFORGE_SHARE_LAN: '0',
        QUICKFORGE_NO_OPEN: '1',
        QUICKFORGE_LOG_LEVEL: 'ERROR',
        QUICKFORGE_TERMINAL: '0',
      },
    })
    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })

    await waitForServer(port, child, () => output)
  }, 30_000)

  afterAll(async () => {
    await stopServer(child)
    if (dataDir) await rm(dataDir, { recursive: true, force: true })
  })

  it('trusts the keep-alive socket after a loopback tunnel request', async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const firstResponse = await request(port, '/api/health', {
        host: '127.0.0.1:18080',
        'x-quickforge-tunnel': '1',
      }, agent)

      expect(firstResponse.status).toBe(200)
      expect(JSON.parse(firstResponse.body)).toMatchObject({
        isLocalRequest: false,
        capabilities: {
          terminal: false,
        },
        sqlite: {
          ok: true,
          schemaVersion: 11,
          migrationCount: 11,
          journalMode: 'wal',
          busyTimeout: 5_000,
        },
      })

      const secondResponse = await request(port, '/api/health', {
        host: '127.0.0.1:18080',
      }, agent)

      expect(secondResponse.reusedSocket).toBe(true)
      expect(secondResponse.status).toBe(200)
    } finally {
      agent.destroy()
    }
  })

  it('still rejects the exceptional Host without the tunnel header', async () => {
    const response = await request(port, '/', { host: '127.0.0.1:18080' })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({ error: 'Forbidden host' })
  })

  it('does not let an invalid Host prime a trusted keep-alive socket', async () => {
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 })
    try {
      const firstResponse = await request(port, '/', {
        host: 'localhost:18080',
        'x-quickforge-tunnel': '1',
      }, agent)
      expect(firstResponse.status).toBe(403)

      const secondResponse = await request(port, '/', {
        host: '127.0.0.1:18080',
      }, agent)
      expect(secondResponse.reusedSocket).toBe(true)
      expect(secondResponse.status).toBe(403)
    } finally {
      agent.destroy()
    }
  })

  it('still rejects localhost:18080 even with the tunnel header', async () => {
    const response = await request(port, '/', {
      host: 'localhost:18080',
      'x-quickforge-tunnel': '1',
    })

    expect(response.status).toBe(403)
    expect(JSON.parse(response.body)).toEqual({ error: 'Forbidden host' })
  })
})
