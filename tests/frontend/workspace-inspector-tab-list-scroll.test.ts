import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

const sourceText = readFileSync(new URL('../../src/components/workspace/WorkspaceInspector.tsx', import.meta.url), 'utf8')
const sourceFile = ts.createSourceFile('WorkspaceInspector.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

function enclosingJsxElement(node: ts.Node | undefined) {
  let current = node
  while (current && !ts.isJsxElement(current)) current = current.parent
  return current
}

function classNameOf(element: ts.JsxElement) {
  const attribute = element.openingElement.attributes.properties.find(
    (property): property is ts.JsxAttribute => ts.isJsxAttribute(property) && property.name.getText(sourceFile) === 'className',
  )
  return attribute?.initializer && ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : undefined
}

function findPanelTabsMap(node: ts.Node): ts.CallExpression | undefined {
  if (
    ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && node.expression.expression.getText(sourceFile) === 'panelTabs'
    && node.expression.name.text === 'map'
  ) {
    const element = enclosingJsxElement(node)
    if (element && classNameOf(element) === 'max-h-[min(25rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain') return node
  }

  return ts.forEachChild(node, findPanelTabsMap)
}

describe('Workspace Inspector tab list menu', () => {
  it('scrolls only the ten-row tab area and keeps footer actions outside it', () => {
    const mapCall = findPanelTabsMap(sourceFile)
    expect(mapCall).toBeDefined()

    const scrollArea = enclosingJsxElement(mapCall)
    expect(scrollArea).toBeDefined()
    expect(classNameOf(scrollArea!)).toBe('max-h-[min(25rem,calc(100dvh-10rem))] overflow-y-auto overscroll-contain')

    const mapCallback = mapCall!.arguments[0]
    expect(mapCallback && ts.isArrowFunction(mapCallback)).toBe(true)
    const tabItem = mapCallback && ts.isArrowFunction(mapCallback) ? enclosingJsxElement(mapCallback.body) : undefined
    expect(classNameOf(tabItem!)).toContain('h-10')

    const menu = enclosingJsxElement(scrollArea!.parent)
    expect(menu).toBeDefined()
    expect(classNameOf(menu!)).toContain('overflow-hidden')

    const directElements = menu!.children.filter(ts.isJsxElement)
    const scrollIndex = directElements.indexOf(scrollArea!)
    const footerIndex = directElements.findIndex((element) => classNameOf(element)?.includes('border-t'))
    expect(scrollIndex).toBeGreaterThanOrEqual(0)
    expect(footerIndex).toBeGreaterThan(scrollIndex)
  })
})
