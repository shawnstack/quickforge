import ts from 'typescript'
import { hookRuntime } from './hook-lifecycle'

// Before-move characterization/reproduction only: pass the original MainApp snapshot explicitly.
// These ranges refer to the original App, not the extracted facade. Never mirror its implementation.
export function originalDomain(source: string, domain: 'terminal' | 'git' | 'loading', dependencies: Record<string, unknown>) {
  const ast = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const main = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === 'MainApp')
  if (!main?.body) throw new Error('Missing MainApp')
  const ranges = {
    terminal: [[305, 306], [353, 353], [1598, 1642]],
    git: [[339, 341], [347, 348], [350, 351], [780, 880], [1587, 1596]],
    loading: [[356, 357], [360, 364], [472, 475], [600, 625], [652, 711], [1259, 1265]],
  }[domain]
  const statements = main.body.statements.filter((node) => {
    const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1
    return ranges.some(([start, end]) => line >= start && line <= end)
  })
  const bindings = statements.filter(ts.isVariableStatement).flatMap((node) => node.declarationList.declarations.flatMap((declaration) => ts.isIdentifier(declaration.name)
    ? [declaration.name.text]
    : declaration.name.elements.filter(ts.isBindingElement).map((element) => element.name.getText(ast))))
  const constants = ast.statements.filter((node) => ts.isVariableStatement(node) && /const (STARTUP_SPLASH_|CONVERSATION_TRANSITION_)/.test(node.getText(ast)))
  const code = `${constants.map((node) => node.getText(ast)).join('\n')}\nreturn function renderDomain(props) { const { remoteClient, setArtifactPreviewOpen, agentManager, currentSessionIdRef, currentToolProjectIdRef, addToast, ready, needsModelSetup } = props;\n${statements.map((node) => node.getText(ast)).join('\n')}\nreturn { ${bindings.join(', ')} }; }`
  const values = { ...hookRuntime, ...dependencies }
  const javascript = ts.transpile(code, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None })
  return new Function(...Object.keys(values), javascript)(...Object.values(values))
}
