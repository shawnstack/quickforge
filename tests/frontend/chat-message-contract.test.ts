import path from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

describe('local chat message type contract', () => {
  it('preserves historical declarations and augments AgentMessage without UI package types', () => {
    const program = ts.createProgram([path.resolve('tests/frontend/fixtures/chat-message-contract.ts')], {
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      types: [],
    })
    const errors = ts.getPreEmitDiagnostics(program).map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    )
    expect(errors).toEqual([])
    // The removed UI packages are gone from the dependency tree, so a stale
    // type-only re-export would now be a compile error above instead. The graph
    // must come from the real message-model packages only.
    const nodeModulesFiles = program.getSourceFiles().map((file) => file.fileName).filter((file) => /node_modules/.test(file))
    expect(nodeModulesFiles.some((file) => /node_modules[/\\]@earendil-works[/\\]pi-(?:ai|agent-core)[/\\]/.test(file))).toBe(true)
    expect(nodeModulesFiles.filter((file) => /node_modules[/\\]react(-dom)?[/\\]/.test(file))).toEqual([])
  })
})
