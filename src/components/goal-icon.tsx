import type { SVGProps } from 'react'
import { cn } from '@/lib/utils'

/** Goal identity: an arrow landing at the center of a circular target. */
export function GoalIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('quickforge-goal-icon', className)}
      {...props}
    >
      <circle cx="10" cy="14" r="8" />
      <circle cx="10" cy="14" r="4" />
      <path d="M21 3 10 14" />
      <path d="M10 10v4h4" />
    </svg>
  )
}
