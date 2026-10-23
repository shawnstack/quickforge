import { t, type AppTextKey } from '@/lib/i18n'

/**
 * Shared vocabulary for the three `todo_write` states.
 *
 * The composer capsule, the pinned-summary task section and the `todo_write`
 * history card all render the same states. Before this module each carried its
 * own label map and (for the pinned summary) its own colour palette, which
 * drifted: `amber-600` for "in progress" appeared nowhere else in the todo
 * surfaces, and the capsule/history card used two different check glyphs. They
 * now share this map plus the glyph in `todo-status-icon.tsx`.
 *
 * Kept in a `.ts` module (no component) so both files stay fast-refresh clean.
 */

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** Shared i18n key per status, so every renderer agrees on the wording. */
export const TODO_STATUS_LABEL_KEY: Record<TodoStatus, AppTextKey> = {
  completed: 'todoWriteStatusCompleted',
  in_progress: 'todoWriteStatusInProgress',
  pending: 'todoWriteStatusPending',
}

/**
 * Wrapper class per status for tailwind-styled surfaces — mirrors the
 * plain-CSS `.quickforge-todo-glyph--*` recipes in `src/styles/chat/todo-summary.css`, so a glyph
 * gets the same colour in every surface without palette classes.
 */
export const TODO_STATUS_GLYPH_CLASS: Record<TodoStatus, string> = {
  pending: 'quickforge-todo-glyph',
  in_progress: 'quickforge-todo-glyph quickforge-todo-glyph--in_progress',
  completed: 'quickforge-todo-glyph quickforge-todo-glyph--completed',
}

export function todoStatusLabel(status: TodoStatus): string {
  return t(TODO_STATUS_LABEL_KEY[status])
}
