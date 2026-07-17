export type MaterialFileIconName =
  | 'audio'
  | 'c'
  | 'certificate'
  | 'console'
  | 'cpp'
  | 'csharp'
  | 'css'
  | 'database'
  | 'docker'
  | 'document'
  | 'eslint'
  | 'font'
  | 'git'
  | 'go'
  | 'html'
  | 'image'
  | 'java'
  | 'javascript'
  | 'javascript-map'
  | 'json'
  | 'key'
  | 'kotlin'
  | 'less'
  | 'license'
  | 'lock'
  | 'log'
  | 'makefile'
  | 'markdown'
  | 'nodejs'
  | 'npm'
  | 'pdf'
  | 'php'
  | 'powerpoint'
  | 'powershell'
  | 'prettier'
  | 'python'
  | 'react'
  | 'react-ts'
  | 'readme'
  | 'ruby'
  | 'rust'
  | 'sass'
  | 'settings'
  | 'svg'
  | 'swift'
  | 'table'
  | 'tailwindcss'
  | 'test-js'
  | 'test-jsx'
  | 'test-ts'
  | 'toml'
  | 'tsconfig'
  | 'typescript'
  | 'typescript-def'
  | 'video'
  | 'vite'
  | 'word'
  | 'xml'
  | 'yaml'
  | 'zip'

export type MaterialDirectoryIconName =
  | 'folder-api'
  | 'folder-base'
  | 'folder-components'
  | 'folder-config'
  | 'folder-css'
  | 'folder-docs'
  | 'folder-git'
  | 'folder-hook'
  | 'folder-images'
  | 'folder-lib'
  | 'folder-public'
  | 'folder-resource'
  | 'folder-routes'
  | 'folder-scripts'
  | 'folder-server'
  | 'folder-src'
  | 'folder-test'
  | 'folder-utils'

const imageExtensions = new Set(['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'bmp', 'avif'])
const archiveExtensions = new Set(['zip', 'tar', 'gz', 'tgz', 'rar', '7z', 'bz2', 'xz'])
const spreadsheetExtensions = new Set(['csv', 'tsv', 'psv', 'xls', 'xlsx', 'xlsm', 'ods'])
const audioExtensions = new Set(['aac', 'aiff', 'flac', 'm4a', 'mp3', 'ogg', 'opus', 'wav', 'wma'])
const videoExtensions = new Set(['avi', 'flv', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm', 'wmv'])
const fontExtensions = new Set(['eot', 'otf', 'ttf', 'woff', 'woff2'])
const certificateExtensions = new Set(['cer', 'cert', 'crt', 'der', 'p12', 'pfx'])
const keyExtensions = new Set(['asc', 'key', 'pem', 'pub'])
const wordExtensions = new Set(['doc', 'docx', 'odt', 'rtf'])
const powerpointExtensions = new Set(['odp', 'pot', 'potx', 'pps', 'ppsx', 'ppt', 'pptx'])
const configExtensions = new Set(['cfg', 'cnf', 'conf', 'config', 'ini', 'option', 'prefs', 'properties', 'props', 'settings'])

function normalizePath(path: string) {
  return path.replace(/\\/g, '/')
}

function basename(path: string): string {
  const normalized = normalizePath(path)
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

function extension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1) : ''
}

function isTestFile(name: string) {
  return /(?:^|[.\-_])(spec|test)\.[^.]+$/i.test(name) || /(?:^|[.\-_])tests?\.[^.]+$/i.test(name)
}

function specialNameIcon(name: string): MaterialFileIconName | undefined {
  if (name === 'readme' || name.startsWith('readme.')) return 'readme'
  if (
    name === 'license' ||
    name.startsWith('license.') ||
    name === 'licence' ||
    name.startsWith('licence.') ||
    name === 'copying' ||
    name.startsWith('copying.')
  ) return 'license'
  if (name === 'makefile' || name.startsWith('makefile.')) return 'makefile'
  if (name === 'dockerfile' || name.endsWith('.dockerfile') || name.startsWith('docker-compose') || name === 'compose.yml' || name === 'compose.yaml') return 'docker'
  if (/^vite\.config\.(?:[cm]?[jt]s)$/.test(name)) return 'vite'
  if (name === 'package.json' || name === 'package-lock.json' || name === '.nvmrc' || name === '.node-version') return 'nodejs'
  if (name === '.npmignore' || name === '.npmrc') return 'npm'
  if (name === 'tsconfig.json' || name.startsWith('tsconfig.')) return 'tsconfig'
  if (name === 'eslint.config.js' || name === 'eslint.config.mjs' || name === 'eslint.config.cjs' || name === 'eslint.config.ts' || name === '.eslintrc' || name.startsWith('.eslintrc.')) return 'eslint'
  if (name === '.prettierrc' || name.startsWith('.prettierrc.') || name.startsWith('prettier.config.')) return 'prettier'
  if (name.startsWith('tailwind.config.')) return 'tailwindcss'
  if (name === '.gitignore' || name === '.gitattributes' || name === '.gitmodules') return 'git'
  if (name === '.env' || name.startsWith('.env.')) return 'settings'
  if (name.endsWith('.lock') || name.endsWith('-lock.json') || name.endsWith('-lock.yaml') || name.endsWith('-lock.yml')) return 'lock'
  return undefined
}

/** Resolve a Material Icon Theme file asset name from a file path. */
export function getFileIconName(path: string): MaterialFileIconName {
  const name = basename(path).toLowerCase()
  const special = specialNameIcon(name)
  if (special) return special

  const ext = extension(name)
  if (ext === 'tsx') return isTestFile(name) ? 'test-ts' : 'react-ts'
  if (ext === 'jsx') return isTestFile(name) ? 'test-jsx' : 'react'
  if (ext === 'ts') {
    if (name.endsWith('.d.ts')) return 'typescript-def'
    return isTestFile(name) ? 'test-ts' : 'typescript'
  }
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') return isTestFile(name) ? 'test-js' : 'javascript'
  if (name.endsWith('.js.map') || name.endsWith('.mjs.map') || name.endsWith('.cjs.map')) return 'javascript-map'
  if (imageExtensions.has(ext)) return 'image'
  if (ext === 'svg') return 'svg'
  if (archiveExtensions.has(ext)) return 'zip'
  if (spreadsheetExtensions.has(ext)) return 'table'
  if (audioExtensions.has(ext)) return 'audio'
  if (videoExtensions.has(ext)) return 'video'
  if (fontExtensions.has(ext)) return 'font'
  if (certificateExtensions.has(ext)) return 'certificate'
  if (keyExtensions.has(ext)) return 'key'
  if (wordExtensions.has(ext)) return 'word'
  if (powerpointExtensions.has(ext)) return 'powerpoint'
  if (configExtensions.has(ext)) return 'settings'

  if (ext === 'json' || ext === 'jsonc') return 'json'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'css') return 'css'
  if (ext === 'scss') return 'sass'
  if (ext === 'less') return 'less'
  if (ext === 'md' || ext === 'mdx' || ext === 'markdown') return 'markdown'
  if (ext === 'yml' || ext === 'yaml') return 'yaml'
  if (ext === 'toml') return 'toml'
  if (ext === 'xml') return 'xml'
  if (ext === 'sql') return 'database'
  if (ext === 'py') return 'python'
  if (ext === 'go') return 'go'
  if (ext === 'rs') return 'rust'
  if (ext === 'java') return 'java'
  if (ext === 'c' || ext === 'h') return 'c'
  if (ext === 'cpp' || ext === 'cc' || ext === 'cxx' || ext === 'hpp') return 'cpp'
  if (ext === 'cs') return 'csharp'
  if (ext === 'php') return 'php'
  if (ext === 'rb') return 'ruby'
  if (ext === 'swift') return 'swift'
  if (ext === 'kt' || ext === 'kts') return 'kotlin'
  if (ext === 'ps1') return 'powershell'
  if (ext === 'sh' || ext === 'bash' || ext === 'zsh') return 'console'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'log') return 'log'

  return 'document'
}

/** Resolve a Material Icon Theme folder asset name from a directory name. */
export function getDirectoryIconName(name: string, open = false): MaterialDirectoryIconName {
  void open
  const lower = basename(name).toLowerCase()
  if (lower === '.git' || lower === '.svn' || lower === '.hg' || lower === 'git') return 'folder-git'
  if (lower === 'src' || lower === 'source' || lower === 'sources') return 'folder-src'
  if (lower === 'components' || lower === 'widgets' || lower === 'fragments') return 'folder-components'
  if (lower === 'test' || lower === 'tests' || lower === '__test__' || lower === '__tests__' || lower === 'spec' || lower === 'specs') return 'folder-test'
  if (lower === 'doc' || lower === 'docs' || lower === 'documentation') return 'folder-docs'
  if (lower === 'server' || lower === 'servers' || lower === 'backend' || lower === 'backends') return 'folder-server'
  if (lower === 'api' || lower === 'apis' || lower === 'restapi') return 'folder-api'
  if (lower === 'asset' || lower === 'assets' || lower === 'resource' || lower === 'resources' || lower === 'static') return 'folder-resource'
  if (lower === 'image' || lower === 'images' || lower === 'img' || lower === 'imgs' || lower === 'icons') return 'folder-images'
  if (lower === 'public' || lower === 'www' || lower === 'wwwroot') return 'folder-public'
  if (lower === 'config' || lower === 'configs' || lower === 'configuration' || lower === '.config') return 'folder-config'
  if (lower === 'lib' || lower === 'libs' || lower === 'library' || lower === 'vendor') return 'folder-lib'
  if (lower === 'hook' || lower === 'hooks') return 'folder-hook'
  if (lower === 'util' || lower === 'utils' || lower === 'utility' || lower === 'utilities') return 'folder-utils'
  if (lower === 'route' || lower === 'routes' || lower === 'router' || lower === 'routers') return 'folder-routes'
  if (lower === 'script' || lower === 'scripts' || lower === 'scripting') return 'folder-scripts'
  if (lower === 'style' || lower === 'styles' || lower === 'stylesheet' || lower === 'stylesheets' || lower === 'css') return 'folder-css'
  return 'folder-base'
}
