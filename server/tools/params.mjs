/**
 * Shared numeric param normalization for workspace tools.
 *
 * clampNumber is the only helper needed by more than one tool module
 * (grep_files limit/context params and run_command timeoutMs), so it lives
 * here instead of being duplicated or coupling those modules to each other.
 */
export function clampNumber(value, defaultValue, min, max) {
  const number = Number(value)
  if (!Number.isFinite(number)) return defaultValue
  return Math.min(max, Math.max(min, Math.trunc(number)))
}
