import { t } from '@/lib/i18n'
import { summarizeParams } from '@/lib/tool-param-summary'
import { extractQuickForgeTiming } from '@/lib/tool-execution-events'
import {
  isRecord,
  ToolDetails,
  renderCodeBlock,
  renderStatus,
  renderToolChevron,
  renderToolIcon,
  stringifyValue,
  toolDisplayDetailed,
  toolOutputText,
  toolStatus,
  type ToolResultLike,
} from './shared'

/**
 * MCP 工具动态渲染器（mcp__server__tool，T4 由 原 html`` 模板迁为 React，
 * class 链保持不变）：summary 行展示 server / 原名 / 参数摘要，detailed 模式
 * 附 input/output/details 原始 JSON。
 */
export function parseMcpToolName(toolName: string) {
  if (!toolName.startsWith('mcp__')) return null
  const rest = toolName.slice('mcp__'.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex <= 0 || separatorIndex >= rest.length - 2) return null
  return {
    serverName: rest.slice(0, separatorIndex),
    toolName: rest.slice(separatorIndex + 2),
  }
}

function mcpToolInfo(toolName: string, details: unknown) {
  const parsed = parseMcpToolName(toolName)
  const detailRecord = isRecord(details) ? details : undefined
  const serverName = typeof detailRecord?.server === 'string' && detailRecord.server
    ? detailRecord.server
    : parsed?.serverName ?? ''
  const originalToolName = typeof detailRecord?.tool === 'string' && detailRecord.tool
    ? detailRecord.tool
    : parsed?.toolName ?? toolName
  return parsed || detailRecord?.mcp === true
    ? { serverName, toolName: originalToolName }
    : null
}

function outputLanguageFromText(text: string) {
  if (!text) return 'text'
  try {
    JSON.parse(text)
    return 'json'
  } catch {
    return 'text'
  }
}

export class McpToolRenderer {
  private toolName: string
  private label?: string

  constructor(toolName: string, label?: string) {
    this.toolName = toolName
    this.label = label
  }

  render(params: Record<string, unknown> | undefined, result: ToolResultLike | undefined, isStreaming?: boolean) {
    const status = toolStatus(result, isStreaming)
    const timing = extractQuickForgeTiming(result?.details)
    const info = mcpToolInfo(this.toolName, result?.details) ?? parseMcpToolName(this.toolName)
    const serverName = info?.serverName ?? ''
    const originalToolName = info?.toolName ?? this.toolName
    const summary = summarizeParams(this.toolName, params, result)
    const detailed = toolDisplayDetailed()
    const input = detailed ? stringifyValue(params) : ''
    const output = toolOutputText(this.toolName, params, result, isStreaming)
    const details = detailed ? stringifyValue(result?.details) : ''
    const title = this.label && this.label !== originalToolName
      ? `${this.label} (${originalToolName})`
      : originalToolName

    // 扁平轻量行契约：旧版由 `tool-message > div:first-child` 卡框重置压平为无边框行；
    // React 迁移后卡框类落在 .qf-tool-message 根上，渲染器改为 isCustom 输出使根本身
    // 无卡框（与 local/ask_user/todo_write/goal_report/generate_image 渲染器一致）。
    return {
      isCustom: true,
      content: (
        <ToolDetails
          className="group/tool quickforge-mcp-tool"
          initiallyOpen={false}
        >
          <summary className="quickforge-tool-summary flex cursor-pointer list-none items-center gap-2 text-sm text-muted-foreground select-none">
            {renderToolIcon(this.toolName)}
            <span className="quickforge-tool-title min-w-0">
              <span className="quickforge-tool-label">MCP{serverName ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · {serverName}</span> : null}<span className="quickforge-tool-summary-detail text-muted-foreground"> · {title}</span>{summary ? <span className="quickforge-tool-summary-detail text-muted-foreground"> · {summary}</span> : null}</span>
              {renderToolChevron()}
              {renderStatus(status, timing)}
            </span>
          </summary>
          <div className="mt-3 space-y-3">
            {input ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('input')}</div>{renderCodeBlock(input, 'json')}</div> : null}
            {output ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('output')}</div>{renderCodeBlock(output, outputLanguageFromText(output))}</div> : null}
            {details ? <div><div className="mb-1 text-xs font-medium text-muted-foreground">{t('details')}</div>{renderCodeBlock(details, 'json')}</div> : null}
          </div>
        </ToolDetails>
      ),
    }
  }
}
