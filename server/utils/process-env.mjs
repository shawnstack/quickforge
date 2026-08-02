export function createNodeProcessEnv(source = process.env, overrides = {}, versions = process.versions) {
  const env = { ...source, ...overrides }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ATOM_SHELL_INTERNAL_RUN_AS_NODE
  if (versions.electron) env.ELECTRON_RUN_AS_NODE = '1'
  return env
}
