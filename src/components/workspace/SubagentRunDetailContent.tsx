import { useEffect, useRef } from 'react'
import type { ComponentType, Ref } from 'react'
import type { SubagentRunPayload } from '@/lib/subagent-run-detail'
import { SubagentRunDetailBodyElement } from '@/lib/local-tools'

export type SubagentRunDetailContentProps = {
  payload?: SubagentRunPayload
}

const SubagentRunBodyHost = 'subagent-run-detail-body' as unknown as ComponentType<{
  payload?: SubagentRunPayload
  ref?: Ref<SubagentRunDetailBodyElement>
}>

/** Workspace Inspector 中的 subagent 单次运行详情内容。 */
export function SubagentRunDetailContent({ payload }: SubagentRunDetailContentProps) {
  const bodyRef = useRef<SubagentRunDetailBodyElement>(null)

  useEffect(() => {
    if (bodyRef.current) bodyRef.current.payload = payload
  }, [payload])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <SubagentRunBodyHost ref={bodyRef} payload={payload} />
    </div>
  )
}
