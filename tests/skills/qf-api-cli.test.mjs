// qf-api.mjs 是 6 家 bot 与我每跳都在用的工具，但仓库里对它零测试。
// 这里锁两件事：
// 1) **参数校验必须先于网络请求**——缺参/非法值时给可读报错并退出 1，
//    不许把畸形参数拼进 URL 打出去。
// 2) **project-open 必须如实回报「当前项目有没有真的切过去」**——服务端对
//    kind:'bot' 目录返回 200 但不改 activeProjectId，CLI 不许无条件报 active:true。
//
// 判据怎么区分两种失败（实测）：
//   校验生效   → stderr 是 "qf-api: show needs a sessionId"
//   校验漏了   → stderr 是 "qf-api: fetch failed"（参数已经拼进 URL 打出去了）
// 所以「不含 fetch failed」就是「没发请求」的机械证明。请求一律打到 127.0.0.1:9（死端口），
// 即使哪天校验退化也不会碰到真实服务产生副作用。
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const CLI = 'skills/quickforge-api/scripts/qf-api.mjs'
const DEAD_API = ['--api', 'http://127.0.0.1:9']
const VALIDATION_HINT = /Unknown command|missing --|needs a|needs one of|needs text|needs <|positive integer|comma-separated|must be/

function runCli(argv) {
  const run = spawnSync(process.execPath, [CLI, ...DEAD_API, ...argv], { encoding: 'utf8', timeout: 20_000 })
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' }
}

// 进程内起 stub 时不能用 spawnSync：它会卡住事件循环，stub 永远回不了话。
// 所以这里异步 spawn，把 stdout/stderr 收齐、等退出码。
function runCliAsync(argv, apiBase) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, '--api', apiBase, ...argv], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`qf-api CLI 超时未退出：${JSON.stringify(argv)}`))
    }, 20_000)
    child.on('error', (error) => { clearTimeout(timer); reject(error) })
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }) })
  })
}

// 临时 HTTP stub 当 --api：只回答 POST /api/project/path，返回给定项目。
// 全程不碰真实 QuickForge API，也不切换任何真实项目。
async function startProjectPathStub(project) {
  const requests = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let parsed
      try { parsed = body ? JSON.parse(body) : null } catch { parsed = body }
      requests.push({ method: req.method, url: req.url, body: parsed })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ project, projects: [project] }))
    })
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const { port } = server.address()
  return {
    apiBase: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise((resolve) => {
      // fetch 会留着 keep-alive 连接，不主动断开会把 close 拖到超时。
      server.closeAllConnections()
      server.close(resolve)
    }),
  }
}

// 这些命令在参数不全时必须在本地就停下（一行都不许发出去）。
const rejected = [
  ['未知命令', ['foo']],
  ['show 缺 sessionId', ['show']],
  ['messages 缺 sessionId', ['messages']],
  ['title 缺文本', ['title']],
  ['model 缺值', ['model']],
  ['thinking 缺值', ['thinking']],
  ['thinking 非法值', ['thinking', 'bogus']],
  ['goal 缺 action', ['goal']],
  ['goal 非法 action', ['goal', 'bogus']],
  ['task-add 全缺', ['task-add']],
  ['weekly --days 含非数字', ['task-add', '--title', 't', '--instruction', 'i', '--schedule', 'weekly', '--time', '09:00', '--days', '1,x']],
  ['monthly --day 99', ['task-add', '--title', 't', '--instruction', 'i', '--schedule', 'monthly', '--time', '09:00', '--day', '99']],
  ['interval --every 0', ['task-add', '--title', 't', '--instruction', 'i', '--schedule', 'interval', '--every', '0']],
  ['once 缺 --at', ['task-add', '--title', 't', '--instruction', 'i', '--schedule', 'once']],
  ['--schedule 非法', ['task-add', '--title', 't', '--instruction', 'i', '--schedule', 'hourly']],
  ['cron 缺 --cron', ['task-add', '--title', 't', '--instruction', 'i', '--schedule', 'cron']],
  ['task-delete 缺 taskId', ['task-delete']],
  ['bot 缺参数', ['bot']],
  ['project-create 缺 --name', ['project-create']],
  ['project-open 缺 --path', ['project-open']],
  ['bot-memory 缺参数', ['bot-memory']],
  ['prompt 缺参数', ['prompt']],
  ['abort 缺 sessionId', ['abort']],
  // spawn 不在此列：--title 是可选的（默认 "Sub session"），缺它不算参数错误——它本来就该发请求。
]

describe('qf-api CLI：参数校验先于请求', () => {
  it.each(rejected)('%s → 本地拒绝，不打 API', (_label, argv) => {
    const { status, stderr } = runCli(argv)
    expect(status).toBe(1)
    // 统一错误前缀：main().catch 的契约，别退回裸栈追踪。
    expect(stderr.startsWith('qf-api: ')).toBe(true)
    // 校验生效就不会走网络；出现 fetch failed 说明参数已被拼进 URL。
    expect(stderr).not.toContain('fetch failed')
    expect(stderr).toMatch(VALIDATION_HINT)
  })

  it('永远不把 JS 内部错误漏到 stderr', () => {
    for (const [, argv] of rejected) {
      const { stderr } = runCli(argv)
      expect(stderr).not.toMatch(/^\s+at\s/m)
      expect(stderr).not.toMatch(/TypeError|Cannot read propert|is not a function/)
    }
  }, 30_000)
})

describe('qf-api CLI：帮助与网络失败', () => {
  it('无参数与 --help 都打印帮助并退出 0', () => {
    for (const argv of [[], ['--help'], ['help']]) {
      const { status, stdout } = runCli(argv)
      expect(status).toBe(0)
      expect(stdout).toContain('QuickForge local API client')
    }
  })

  it('API 打不通时给一行可读错误并退出 1', () => {
    for (const argv of [['whoami'], ['agents'], ['sessions']]) {
      const { status, stderr } = runCli(argv)
      expect(status).toBe(1)
      expect(stderr.startsWith('qf-api: ')).toBe(true)
      expect(stderr.trim().split('\n')).toHaveLength(1)
    }
  }, 30_000)
})

// 服务端契约：POST /api/project/path 对已注册的 kind:'bot' 目录返回 200，
// 但不动 activeProjectId（bot 目录不是「用户的当前项目」）。CLI 以前无条件报
// active:true / activeProjectChanged:true，等于把「没切」说成「切了」。
describe('qf-api CLI：project-open 如实回报项目是否真的被激活', () => {
  it('kind=bot 的目录 → project.active=false、activeProjectChanged=false', async () => {
    const botProject = {
      id: 'bot-project-1',
      name: 'bot-alpha',
      path: path.join(os.tmpdir(), 'qf-api-stub-bot-alpha'),
      kind: 'bot',
    }
    const stub = await startProjectPathStub(botProject)
    try {
      const { status, stdout, stderr } = await runCliAsync(['project-open', '--path', botProject.path], stub.apiBase)
      expect(stderr).toBe('')
      expect(status).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.project).toEqual({
        id: botProject.id,
        name: botProject.name,
        path: botProject.path,
        active: false,
      })
      expect(payload.activeProjectChanged).toBe(false)
      // 证明打的就是 /api/project/path，且只打了一次（没有额外探测或重复请求）。
      expect(stub.requests).toEqual([{ method: 'POST', url: '/api/project/path', body: { path: botProject.path } }])
    } finally {
      await stub.close()
    }
  }, 30_000)

  it('普通项目 → project.active=true、activeProjectChanged=true', async () => {
    const project = {
      id: 'project-1',
      name: 'real-project',
      path: path.join(os.tmpdir(), 'qf-api-stub-real-project'),
    }
    const stub = await startProjectPathStub(project)
    try {
      const { status, stdout, stderr } = await runCliAsync(['project-open', '--path', project.path], stub.apiBase)
      expect(stderr).toBe('')
      expect(status).toBe(0)
      const payload = JSON.parse(stdout)
      expect(payload.project).toEqual({
        id: project.id,
        name: project.name,
        path: project.path,
        active: true,
      })
      expect(payload.activeProjectChanged).toBe(true)
      expect(stub.requests).toEqual([{ method: 'POST', url: '/api/project/path', body: { path: project.path } }])
    } finally {
      await stub.close()
    }
  }, 30_000)
})
