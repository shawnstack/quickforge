import { useEffect, useRef, useState } from 'react'

import { t } from '@/lib/i18n'
import type { McpTransport } from '@/lib/types/mcp'
import {
  argsToText,
  envToText,
  textToArgs,
  textToEnv,
  type McpServerFormData,
} from '@/lib/mcp-helpers'

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index])
}

function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every((key) => a[key] === b[key])
}

type ParsedTextDraftOptions<T> = {
  parsed: T
  raw: string
  equals: (a: T, b: T) => boolean
  parse: (text: string) => T
  commit: (next: T) => void
}

/**
 * 文本编辑器的草稿轨：显示用户原文，提交解析后的值。
 *
 * 受控 textarea 直接回写解析结果会把中间态当场规范化——空行被过滤掉、env 里还没敲 `=` 的
 * 那一行整行消失，用户看到的是「按键被吞了」。这里把「显示」和「数据」分开：显示原文，
 * 数据照旧即时提交（否则不 blur 就点保存会丢），只有外部值不是我们刚派发的那一份时
 * （比如切到另一台服务器编辑）才用外部值重置草稿。
 */
function useParsedTextDraft<T>({ parsed, raw, equals, parse, commit }: ParsedTextDraftOptions<T>) {
  const [draft, setDraft] = useState(raw)
  const dispatchedRef = useRef(parsed)

  useEffect(() => {
    if (equals(dispatchedRef.current, parsed)) return
    dispatchedRef.current = parsed
    setDraft(raw)
  }, [parsed, raw, equals])

  const onInput = (text: string) => {
    const next = parse(text)
    dispatchedRef.current = next
    setDraft(text)
    commit(next)
  }

  return { value: draft, onInput }
}

type McpServerFormProps = {
  value: McpServerFormData
  onChange: (data: McpServerFormData) => void
  isEdit: boolean
  disabled?: boolean
}

export function McpServerForm({ value, onChange, isEdit, disabled }: McpServerFormProps) {
  const showStdio = value.transport === 'stdio'
  const patch = (partial: Partial<McpServerFormData>) => onChange({ ...value, ...partial })
  const argsDraft = useParsedTextDraft({
    parsed: value.args,
    raw: argsToText(value.args),
    equals: sameList,
    parse: textToArgs,
    commit: (next) => patch({ args: next }),
  })
  const envDraft = useParsedTextDraft({
    parsed: value.env,
    raw: envToText(value.env),
    equals: sameRecord,
    parse: textToEnv,
    commit: (next) => patch({ env: next }),
  })

  return (
    <div className="quickforge-settings-form-grid">
      <label className="quickforge-settings-form-row">
        <span className="quickforge-settings-form-label">{t('mcpServerName')}</span>
        <input
          className="quickforge-settings-input"
          value={value.name}
          onChange={(event) => patch({ name: event.target.value })}
          placeholder={t('mcpNamePlaceholder')}
          disabled={isEdit || disabled}
        />
      </label>
      <label className="quickforge-settings-form-row">
        <span className="quickforge-settings-form-label">{t('mcpTransport')}</span>
        <select
          className="quickforge-settings-select"
          value={value.transport}
          onChange={(event) => patch({ transport: event.target.value as McpTransport })}
          disabled={disabled}
        >
          <option value="stdio">stdio</option>
          <option value="http">http</option>
          <option value="sse">sse</option>
        </select>
      </label>
      {showStdio ? (
        <>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpCommand')}</span>
            <input
              className="quickforge-settings-input quickforge-settings-mono"
              value={value.command}
              onChange={(event) => patch({ command: event.target.value })}
              placeholder={t('mcpCommandPlaceholder')}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpArgs')}</span>
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={argsDraft.value}
              onChange={(event) => argsDraft.onInput(event.target.value)}
              spellCheck={false}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpCwd')}</span>
            <input
              className="quickforge-settings-input quickforge-settings-mono"
              value={value.cwd}
              onChange={(event) => patch({ cwd: event.target.value })}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpEnv')}</span>
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={envDraft.value}
              onChange={(event) => envDraft.onInput(event.target.value)}
              spellCheck={false}
              disabled={disabled}
            />
          </label>
        </>
      ) : (
        <>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpUrl')}</span>
            <input
              className="quickforge-settings-input quickforge-settings-mono"
              value={value.url}
              onChange={(event) => patch({ url: event.target.value })}
              placeholder={t('mcpUrlPlaceholder')}
              disabled={disabled}
            />
          </label>
          <label className="quickforge-settings-form-row">
            <span className="quickforge-settings-form-label">{t('mcpHeaders')}</span>
            <textarea
              className="quickforge-settings-textarea quickforge-settings-mono"
              value={envDraft.value}
              onChange={(event) => envDraft.onInput(event.target.value)}
              spellCheck={false}
              disabled={disabled}
            />
          </label>
        </>
      )}
    </div>
  )
}
