import { ContextCompactionNotice, readCompactionSummaryText } from './ContextCompactionNotice'
import { compactionDetailsOf } from './compaction-message'
import type { AgentMessage } from './ChatTypes'

/**
 * 压缩摘要那一行。
 *
 * 方案 B：压缩点本身就是 messages 里的一条消息，所以位置由渲染顺序给出，
 * 不需要任何坐标换算。视觉沿用既有分割线（线 + pill + 折叠摘要卡），
 * 外层补一个 .qf-user-message 宿主维持行序号与装饰层配对契约。
 */
export function CompactionMessage({ message, mergedIntoLater = false }: {
  message: AgentMessage
  /** 之后还有一次压缩，这条的摘要已并入后续版本。 */
  mergedIntoLater?: boolean
}) {
  const details = compactionDetailsOf(message)
  const summaryText = readCompactionSummaryText(message)
  return (
    <div
      className={'qf-user-message quickforge-compaction-message'}
      data-quickforge-compaction={'true'}
    >
      <ContextCompactionNotice
        summaryText={summaryText}
        boundaryIndex={0}
        compactedAt={details?.compactedAt}
        mergedIntoLater={mergedIntoLater}
      />
    </div>
  )
}
