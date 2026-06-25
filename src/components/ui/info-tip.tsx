import { createElement } from 'react'
import '@/lib/info-tip'

type InfoTipProps = {
  label: string
}

export function InfoTip({ label }: InfoTipProps) {
  return createElement('quickforge-info-tip', { label })
}
