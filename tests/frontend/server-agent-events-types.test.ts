import path from 'node:path'
import ts from 'typescript'
import { expect, it } from 'vitest'

it('compiles event boundary contracts with actual TypeScript diagnostics', () => {
  const configPath = path.resolve('tsconfig.app.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  expect(config.error).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  expect(parsed.errors).toEqual([])
  // Explicitly include the compile-only fixture: the application's include is
  // src/, and Vitest's normal transform does not check TypeScript diagnostics.
  const program = ts.createProgram({
    rootNames: [path.resolve('tests/frontend/server-agent-events.typecheck.ts')],
    options: parsed.options,
  })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  expect(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: ts.sys.getCurrentDirectory,
    getNewLine: () => '\n',
  })).toBe('')
})
