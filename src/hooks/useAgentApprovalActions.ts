import { useCallback } from 'react'
import { t } from '@/lib/i18n'
import { logger } from '@/lib/logger'

type AskAnswerPayload = {
  answers?: Array<{ choices?: string[]; custom?: string }>
  skipped?: boolean
  remark?: string
}

type ApprovalCapableAgent = {
  approveToolCall: (toolCallId: string) => Promise<void>
  rejectToolCall: (toolCallId: string) => Promise<void>
  answerAsk?: (askId: string, payload: AskAnswerPayload) => Promise<void>
  approveAutoCompact?: (approvalId: string) => Promise<void>
  rejectAutoCompact?: (approvalId: string) => Promise<void>
}

/** 工具审批 / ask_user 应答 / auto-compact 审批的统一出口：
 *  全部走当前 agent 实例，失败统一抛错（由调用方的 catch 展示）。 */
export function useAgentApprovalActions(agentRef: React.RefObject<ApprovalCapableAgent | null>) {
  const handleApproveToolCall = useCallback(async (toolCallId: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent) throw new Error(t('toolApprovalFailed'))
    try {
      await currentAgent.approveToolCall(toolCallId)
    } catch (err) {
      logger.error('Failed to approve tool call:', err)
      throw err instanceof Error ? err : new Error(t('toolApprovalFailed'))
    }
  }, [agentRef])

  const handleRejectToolCall = useCallback(async (toolCallId: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent) throw new Error(t('toolApprovalFailed'))
    try {
      await currentAgent.rejectToolCall(toolCallId)
    } catch (err) {
      logger.error('Failed to reject tool call:', err)
      throw err instanceof Error ? err : new Error(t('toolApprovalFailed'))
    }
  }, [agentRef])

  const handleAnswerAsk = useCallback(async (askId: string, answers: Array<{ choices?: string[]; custom?: string }>, skipped: boolean, remark?: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent?.answerAsk) throw new Error(t('askUserFailed'))
    try {
      await currentAgent.answerAsk(askId, { answers, skipped, remark })
    } catch (err) {
      logger.error('Failed to answer ask:', err)
      throw err instanceof Error ? err : new Error(t('askUserFailed'))
    }
  }, [agentRef])

  const handleApproveAutoCompact = useCallback(async (approvalId: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent?.approveAutoCompact) throw new Error(t('toolApprovalFailed'))
    await currentAgent.approveAutoCompact(approvalId)
  }, [agentRef])

  const handleRejectAutoCompact = useCallback(async (approvalId: string) => {
    const currentAgent = agentRef.current
    if (!currentAgent?.rejectAutoCompact) throw new Error(t('toolApprovalFailed'))
    await currentAgent.rejectAutoCompact(approvalId)
  }, [agentRef])

  return {
    handleApproveToolCall,
    handleRejectToolCall,
    handleAnswerAsk,
    handleApproveAutoCompact,
    handleRejectAutoCompact,
  }
}
