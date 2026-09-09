/** Explicit new-chat intent, independent of empty persisted sessions and bootstrap. */
export function createTaskLauncherVisibility<T>() {
  let generation = 0
  let eligible: T | undefined
  return {
    begin: () => ++generation,
    complete: (version: number, agent: T, accepted: boolean) => {
      if (version !== generation || !accepted) return false
      eligible = agent
      return true
    },
    visible: (agent: T, blank: boolean) => eligible === agent && blank,
    invalidate: () => { generation++; eligible = undefined },
  }
}
