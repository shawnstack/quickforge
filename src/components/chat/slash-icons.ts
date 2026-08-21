import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { BookOpen, Bot, SquareTerminal, type LucideIcon } from 'lucide-react'

export type SlashIconKind = 'command' | 'skill' | 'agent'

const SLASH_ICON_COMPONENTS = {
  command: SquareTerminal,
  skill: BookOpen,
  agent: Bot,
} satisfies Record<SlashIconKind, LucideIcon>

/** Existing Lucide category icons reused by every Slash surface. */
export const slashIcons: Record<SlashIconKind, string> = Object.fromEntries(
  Object.entries(SLASH_ICON_COMPONENTS).map(([kind, Icon]) => [
    kind,
    renderToStaticMarkup(createElement(Icon, {
      size: 16,
      strokeWidth: 1.8,
      'aria-hidden': true,
    })),
  ]),
) as Record<SlashIconKind, string>
