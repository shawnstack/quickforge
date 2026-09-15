import ts from 'typescript'
import { hookRuntime } from './hook-lifecycle'

/** Local before-move characterization: execute original statements, not a mirror implementation. */
export function originalInspectorDomain(source: string, ranges: number[][], topRanges: number[][], dependencies: Record<string, unknown> = {}) {
  const ast = ts.createSourceFile('WorkspaceInspector.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const main = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'WorkspaceInspector')
  if (!main?.body) throw new Error('Missing WorkspaceInspector')
  const select = (nodes: ts.NodeArray<ts.Statement>, selection: number[][]) => nodes.filter((node) => {
    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
    return selection.some(([start, end]) => line >= start && line <= end)
  })
  const statements = select(main.body.statements, ranges)
  const bindings = statements.flatMap((node) => {
    if (ts.isFunctionDeclaration(node)) return node.name ? [node.name.text] : []
    if (!ts.isVariableStatement(node)) return []
    return node.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name)
      ? [declaration.name.text]
      : declaration.name.elements.filter(ts.isBindingElement).map((element) => element.name.getText(ast)))
  })
  const code = `${select(ast.statements, topRanges).map((node) => node.getText(ast)).join('\n')}\nreturn function renderDomain(props) { const { open, onFullscreenChange, leftSidebarWidth, conversationMinWidth, activePanelTab, activeReaderTabId, project, sessionId, canUseTerminal, onOpenChange, onClearSideChat, projectGuardRef, lastRunPaths } = props;\n${statements.map((node) => node.getText(ast)).join('\n')}\nreturn { ${bindings.join(', ')} }; }`
  const values = { ...hookRuntime, ...dependencies }
  return new Function(...Object.keys(values), ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }))(...Object.values(values)) as unknown
}
