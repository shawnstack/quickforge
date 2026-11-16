// body-only 计划必须真的「只写 body」。
//
// 这个计划能成立，是因为存储的消息行已经和要写的一模一样（行数 + 尾部行 digest +
// 中部采样行 digest 三重校验都过）；既然如此，再把整份 messages 交给 repository
// 就是双倍浪费：主线程要把每条消息重新 canonical 编码一遍，repository 又按
// replace 把全部行重写一遍。实测（临时库、15000 条消息的会话）：body-only 每次
// 260ms，而 append 1 行只要 15ms——差值全是这两件事（decisions §40）。
//
// 观测手法：先破坏一条**既不参与尾部也不参与中部校验**的存储行（seq 0，3 条消息时
// 尾部是 2、中部是 1），再跑一次 body-only 保存。行没被重写 ⇒ 那条仍是坏的；
// 行被重写 ⇒ 它会被内存里的真消息盖回来。
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeSqliteStorage, initializeSqliteStorage } from '../../server/sqlite/database.mjs'
import { createSessionStateRepository } from '../../server/sqlite/session-state-repository.mjs'
import {
  configureSessionStateService,
  saveSessionStatePair,
} from '../../server/session-state-service.mjs'

const CORRUPTED = 'CORRUPTED-ROW-MUST-SURVIVE'

function makeMessages(count) {
  const result = []
  for (let index = 0; index < count; index += 1) {
    result.push({ role: index % 2 === 0 ? 'user' : 'assistant', content: `m${index}`, timestamp: `2026-01-01T00:00:0${index}.000Z` })
  }
  return result
}

const MESSAGES = makeMessages(3)

function stateOf(title, version = 1) {
  return { id: 's-body-only', scope: 'global', stateVersion: version, title, messages: MESSAGES, bodyOpaque: { keep: true } }
}

function metadataOf(title, version = 1) {
  return { id: 's-body-only', scope: 'global', stateVersion: version, title, messageCount: MESSAGES.length }
}

function corruptRow(storage, seq) {
  storage
    .prepare("UPDATE session_messages SET message_json = ?, message_digest = ? WHERE scope = 'global' AND project_id = '' AND session_id = ? AND seq = ?")
    .run(JSON.stringify({ role: 'system', content: CORRUPTED }), 'f'.repeat(64), 's-body-only', seq)
}

function rowJson(storage, seq) {
  return storage
    .prepare("SELECT message_json FROM session_messages WHERE scope = 'global' AND project_id = '' AND session_id = ? AND seq = ?")
    .get('s-body-only', seq)?.message_json
}

describe('body-only 计划不重写消息行（存储 v2）', () => {
  let directory
  let storage
  let repository

  beforeEach(async () => {
    await closeSqliteStorage()
    directory = await mkdtemp(path.join(os.tmpdir(), 'qf-body-only-'))
    storage = await initializeSqliteStorage({ databasePath: path.join(directory, 'state.sqlite3') })
    repository = createSessionStateRepository(storage)
    configureSessionStateService({ repository })
    await saveSessionStatePair({ state: stateOf('Original'), metadata: metadataOf('Original'), expectedRevision: 0 })
  })

  afterEach(async () => {
    await closeSqliteStorage()
    await rm(directory, { recursive: true, force: true })
  })

  it('消息未变、只改标题时：存 body 不动消息行', async () => {
    corruptRow(storage, 0)
    const revision = repository.findBySessionId('s-body-only').revision

    const saved = await saveSessionStatePair({
      state: stateOf('Renamed', 2),
      metadata: metadataOf('Renamed', 2),
      expectedRevision: revision,
    })

    expect(saved.messageStoragePlan).toBe('body-only')
    // 行没被重写：那条被我破坏的行必须原样还在。
    expect(rowJson(storage, 0)).toContain(CORRUPTED)
    // 但 body 真的写进去了（不然这个计划就成了「什么都不做」）。
    const record = repository.findBySessionId('s-body-only')
    expect(record.state.title).toBe('Renamed')
    expect(record.state.messageStorage).toBe('split')
  })

  it('对照：append 只插新尾行，同样不该碰旧行', async () => {
    corruptRow(storage, 0)
    const revision = repository.findBySessionId('s-body-only').revision
    const grown = [...MESSAGES, { role: 'user', content: 'm3', timestamp: '2026-01-01T00:00:03.000Z' }]

    const saved = await saveSessionStatePair({
      state: { ...stateOf('Grown', 2), messages: grown },
      metadata: { ...metadataOf('Grown', 2), messageCount: grown.length },
      expectedRevision: revision,
    })

    expect(saved.messageStoragePlan).toBe('append')
    expect(rowJson(storage, 0)).toContain(CORRUPTED)
    expect(rowJson(storage, 3)).toContain('m3')
  })
})
