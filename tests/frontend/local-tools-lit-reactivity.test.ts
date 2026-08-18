import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const localToolsSource = readFileSync(new URL('../../src/lib/local-tools.ts', import.meta.url), 'utf8')

function propertyNameText(name: ts.PropertyName | undefined) {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text
  return undefined
}

function transpiledSubagentDetailClass() {
  const output = ts.transpileModule(localToolsSource, {
    fileName: 'local-tools.ts',
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2023,
      useDefineForClassFields: true,
    },
  }).outputText
  const sourceFile = ts.createSourceFile('local-tools.js', output, ts.ScriptTarget.ES2023, true, ts.ScriptKind.JS)
  const detailClass = sourceFile.statements.find(
    (statement): statement is ts.ClassDeclaration => ts.isClassDeclaration(statement)
      && statement.name?.text === 'SubagentRunDetailBodyElement',
  )
  if (!detailClass) throw new Error('Transpiled SubagentRunDetailBodyElement not found')
  return detailClass
}

describe('SubagentRunDetailBodyElement reactive payload declaration', () => {
  it('preserves the Lit reactive payload setter in ES2023 output', () => {
    const detailClass = transpiledSubagentDetailClass()
    const payloadFields = detailClass.members.filter(
      (member) => ts.isPropertyDeclaration(member)
        && propertyNameText(member.name) === 'payload'
        && !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
    )
    const staticProperties = detailClass.members.find(
      (member): member is ts.PropertyDeclaration => ts.isPropertyDeclaration(member)
        && propertyNameText(member.name) === 'properties'
        && Boolean(member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword)),
    )

    expect(payloadFields).toHaveLength(0)
    expect(staticProperties?.initializer && ts.isObjectLiteralExpression(staticProperties.initializer)).toBe(true)

    const reactiveProperties = staticProperties?.initializer && ts.isObjectLiteralExpression(staticProperties.initializer)
      ? staticProperties.initializer.properties
      : []
    expect(reactiveProperties.some(
      (property) => ts.isPropertyAssignment(property) && propertyNameText(property.name) === 'payload',
    )).toBe(true)
  })
})
