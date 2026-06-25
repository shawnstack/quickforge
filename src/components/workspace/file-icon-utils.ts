import type { ComponentType, SVGProps } from 'react'
import {
  BookOpen,
  Container,
  Database,
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileJson,
  FileLock2,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderGit2,
  FolderOpen,
  Globe2,
  Hash,
  Scroll,
  Terminal,
} from 'lucide-react'
import { languageFromPath } from './workspace-language'

type LucideIcon = ComponentType<SVGProps<SVGSVGElement>>

export type FileIconInfo = {
  Icon: LucideIcon
  /** Tailwind color classes, including a `dark:` variant for dark mode. */
  className: string
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

/*
 * Code files share the FileCode2 shape (lucide has no per-language logos) and
 * are told apart by a soft, low-saturation semantic color per language.
 */
const iconByLanguage: Record<string, FileIconInfo> = {
  typescript: { Icon: FileCode2, className: 'text-sky-500 dark:text-sky-400' },
  javascript: { Icon: FileCode2, className: 'text-amber-500 dark:text-amber-400' },
  python: { Icon: FileCode2, className: 'text-blue-600 dark:text-blue-400' },
  go: { Icon: FileCode2, className: 'text-cyan-600 dark:text-cyan-400' },
  rust: { Icon: FileCode2, className: 'text-orange-600 dark:text-orange-400' },
  java: { Icon: FileCode2, className: 'text-red-500 dark:text-red-400' },
  c: { Icon: FileCode2, className: 'text-blue-500 dark:text-blue-400' },
  cpp: { Icon: FileCode2, className: 'text-indigo-500 dark:text-indigo-400' },
  csharp: { Icon: FileCode2, className: 'text-violet-500 dark:text-violet-400' },
  php: { Icon: FileCode2, className: 'text-indigo-500 dark:text-indigo-400' },
  ruby: { Icon: FileCode2, className: 'text-rose-500 dark:text-rose-400' },
  swift: { Icon: FileCode2, className: 'text-orange-500 dark:text-orange-400' },
  kotlin: { Icon: FileCode2, className: 'text-violet-500 dark:text-violet-400' },
  shell: { Icon: FileCode2, className: 'text-green-600 dark:text-green-400' },
  powershell: { Icon: FileCode2, className: 'text-blue-600 dark:text-blue-400' },
  // Non-code languages: a dedicated icon + semantic color.
  json: { Icon: FileJson, className: 'text-amber-600 dark:text-amber-400' },
  css: { Icon: Hash, className: 'text-sky-500 dark:text-sky-400' },
  scss: { Icon: Hash, className: 'text-pink-500 dark:text-pink-400' },
  less: { Icon: Hash, className: 'text-sky-500 dark:text-sky-400' },
  html: { Icon: Globe2, className: 'text-orange-500 dark:text-orange-400' },
  markdown: { Icon: FileText, className: 'text-slate-500 dark:text-slate-400' },
  yaml: { Icon: FileCog, className: 'text-slate-500 dark:text-slate-400' },
  toml: { Icon: FileCog, className: 'text-slate-500 dark:text-slate-400' },
  ini: { Icon: FileCog, className: 'text-slate-500 dark:text-slate-400' },
  xml: { Icon: FileCode2, className: 'text-slate-500 dark:text-slate-400' },
  sql: { Icon: Database, className: 'text-indigo-500 dark:text-indigo-400' },
  dockerfile: { Icon: Container, className: 'text-sky-600 dark:text-sky-400' },
  plaintext: { Icon: FileText, className: 'text-slate-500 dark:text-slate-400' },
}

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'avif'])
const archiveExtensions = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'])
const spreadsheetExtensions = new Set(['csv', 'tsv', 'xls', 'xlsx'])

function specialNameIcon(name: string): FileIconInfo | undefined {
  if (name === 'readme' || name.startsWith('readme.')) {
    return { Icon: BookOpen, className: 'text-sky-500 dark:text-sky-400' }
  }
  if (
    name === 'license' ||
    name.startsWith('license.') ||
    name === 'licence' ||
    name.startsWith('licence.') ||
    name === 'copying' ||
    name.startsWith('copying.')
  ) {
    return { Icon: Scroll, className: 'text-slate-500 dark:text-slate-400' }
  }
  if (name === 'makefile' || name.startsWith('makefile.')) {
    return { Icon: Terminal, className: 'text-slate-500 dark:text-slate-400' }
  }
  if (name.startsWith('docker-compose')) {
    return { Icon: Container, className: 'text-sky-600 dark:text-sky-400' }
  }
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') {
    return { Icon: Scroll, className: 'text-orange-500 dark:text-orange-400' }
  }
  if (name === '.env' || name.startsWith('.env.')) {
    return { Icon: FileCog, className: 'text-slate-500 dark:text-slate-400' }
  }
  if (name.endsWith('.lock') || name.endsWith('-lock.json') || name.endsWith('-lock.yaml')) {
    return { Icon: FileLock2, className: 'text-slate-500 dark:text-slate-400' }
  }
  return undefined
}

/** Resolve icon + color for a file based on its path, extension and special names. */
export function getFileIcon(path: string): FileIconInfo {
  const name = basename(path).toLowerCase()

  const special = specialNameIcon(name)
  if (special) return special

  const ext = extension(name)
  if (imageExtensions.has(ext)) return { Icon: FileImage, className: 'text-purple-500 dark:text-purple-400' }
  if (archiveExtensions.has(ext)) return { Icon: FileArchive, className: 'text-slate-500 dark:text-slate-400' }
  if (spreadsheetExtensions.has(ext)) return { Icon: FileSpreadsheet, className: 'text-green-600 dark:text-green-400' }

  const byLanguage = iconByLanguage[languageFromPath(path)]
  if (byLanguage) return byLanguage

  return { Icon: File, className: 'text-slate-500 dark:text-slate-400' }
}

/** Resolve icon + color for a directory, accounting for open state and VCS folders. */
export function getDirectoryIcon(name: string, open: boolean): FileIconInfo {
  const lower = name.toLowerCase()
  if (lower === '.git' || lower === '.svn' || lower === '.hg') {
    return { Icon: FolderGit2, className: 'text-orange-500 dark:text-orange-400' }
  }
  return { Icon: open ? FolderOpen : Folder, className: 'text-slate-500 dark:text-slate-400' }
}
