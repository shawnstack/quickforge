import type { Element, ElementContent, Parent, Root, RootContent, Text } from 'hast'
import { splitLocalFilePaths } from '../panel-decoration/local-file-path-links'

/**
 * Rehype plugin: split local file paths out of plain text into
 * `<qf-file-path data-path="…">` elements.
 *
 * This runs during Markdown parsing, so the paths become React nodes with the
 * rest of the content. The decoration layer used to do the same thing after
 * render, with a TreeWalker that replaced text nodes with buttons and a
 * per-message signature to avoid re-walking.
 *
 * Subtrees whose text must stay literal are skipped: code (fenced and inline),
 * links, and anything that already renders its own affordance. Those are the
 * same exclusions the TreeWalker used (`SKIP_LOCAL_PATH_SELECTOR`), expressed in
 * hast terms instead of CSS selectors.
 */
const SKIP_TAGS = new Set(['code', 'pre', 'a', 'button', 'textarea', 'input', 'select'])

/**
 * The element this plugin emits.
 *
 * It must be in the skip set: the node's child text is the path itself, so
 * re-entering it would split it again, produce another `qf-file-path` inside,
 * and recurse until the stack overflows. (Caught by
 * `tests/frontend/local-file-path-markdown.test.ts`.)
 */
const FILE_PATH_TAG = 'qf-file-path'

function shouldSkip(parent: Element | Root): boolean {
  if (parent.type === 'root') return false
  return parent.tagName === FILE_PATH_TAG || SKIP_TAGS.has(parent.tagName)
}

function splitTextNode(node: Text): RootContent[] | null {
  const segments = splitLocalFilePaths(node.value)
  if (segments.length === 1 && segments[0].kind === 'text') return null
  return segments.map((segment): RootContent => (
    segment.kind === 'path'
      ? ({
          type: 'element',
          tagName: FILE_PATH_TAG,
          properties: { 'data-path': segment.path },
          children: [{ type: 'text', value: segment.path }],
        } as Element)
      : { type: 'text', value: segment.value }
  ))
}

/**
 * Walk the tree once, depth-first. Children produced by this pass are never
 * revisited (the loop below recurses into the *original* children only), so the
 * transform is idempotent by construction rather than by luck.
 */
function transformChildren(parent: Parent): void {
  if (shouldSkip(parent as Element)) return
  const original = parent.children as RootContent[]
  let next: RootContent[] | null = null
  const produced = new Set<RootContent>()
  for (let index = 0; index < original.length; index++) {
    const child = original[index]
    if (child.type === 'text') {
      const replaced = splitTextNode(child)
      if (replaced) {
        if (!next) next = original.slice(0, index)
        next.push(...replaced)
        for (const node of replaced) produced.add(node)
        continue
      }
    }
    if (next) next.push(child)
  }
  if (next) parent.children = next as ElementContent[]

  for (const child of parent.children) {
    if (child.type !== 'element' || child.children.length === 0) continue
    if (produced.has(child)) continue
    transformChildren(child as Parent)
  }
}

/** Rehype plugin entry point: mutate the hast tree in place. */
export function rehypeQfLocalFilePaths() {
  return (tree: Root) => {
    transformChildren(tree)
  }
}
