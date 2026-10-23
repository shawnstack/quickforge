import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export const stylesRoot = resolve(process.cwd(), 'src/styles')

const IMPORT_RE = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;/g

export const styleFiles: string[] = []
const seen = new Set<string>()

function inline(file: string): string {
  if (seen.has(file)) {
    throw new Error(`CSS module imported more than once: ${file}`)
  }
  seen.add(file)
  styleFiles.push(file)

  return readFileSync(file, 'utf8').replace(IMPORT_RE, (statement, _quote: string, specifier: string) => {
    if (!specifier.startsWith('.')) return statement
    return inline(resolve(dirname(file), specifier))
  })
}

/** Global CSS in cascade order, with the manifest's @import graph inlined. */
export const appCss = inline(resolve(stylesRoot, 'index.css'))
