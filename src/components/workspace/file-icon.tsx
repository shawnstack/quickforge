import audioIconUrl from '@/assets/icons/material-file-theme/audio.svg'
import cIconUrl from '@/assets/icons/material-file-theme/c.svg'
import certificateIconUrl from '@/assets/icons/material-file-theme/certificate.svg'
import consoleIconUrl from '@/assets/icons/material-file-theme/console.svg'
import cppIconUrl from '@/assets/icons/material-file-theme/cpp.svg'
import csharpIconUrl from '@/assets/icons/material-file-theme/csharp.svg'
import cssIconUrl from '@/assets/icons/material-file-theme/css.svg'
import databaseIconUrl from '@/assets/icons/material-file-theme/database.svg'
import dockerIconUrl from '@/assets/icons/material-file-theme/docker.svg'
import documentIconUrl from '@/assets/icons/material-file-theme/document.svg'
import eslintIconUrl from '@/assets/icons/material-file-theme/eslint.svg'
import fontIconUrl from '@/assets/icons/material-file-theme/font.svg'
import gitIconUrl from '@/assets/icons/material-file-theme/git.svg'
import goIconUrl from '@/assets/icons/material-file-theme/go.svg'
import htmlIconUrl from '@/assets/icons/material-file-theme/html.svg'
import imageIconUrl from '@/assets/icons/material-file-theme/image.svg'
import javaIconUrl from '@/assets/icons/material-file-theme/java.svg'
import javascriptIconUrl from '@/assets/icons/material-file-theme/javascript.svg'
import javascriptMapIconUrl from '@/assets/icons/material-file-theme/javascript-map.svg'
import jsonIconUrl from '@/assets/icons/material-file-theme/json.svg'
import keyIconUrl from '@/assets/icons/material-file-theme/key.svg'
import kotlinIconUrl from '@/assets/icons/material-file-theme/kotlin.svg'
import lessIconUrl from '@/assets/icons/material-file-theme/less.svg'
import licenseIconUrl from '@/assets/icons/material-file-theme/license.svg'
import lockIconUrl from '@/assets/icons/material-file-theme/lock.svg'
import logIconUrl from '@/assets/icons/material-file-theme/log.svg'
import makefileIconUrl from '@/assets/icons/material-file-theme/makefile.svg'
import markdownIconUrl from '@/assets/icons/material-file-theme/markdown.svg'
import nodejsIconUrl from '@/assets/icons/material-file-theme/nodejs.svg'
import npmIconUrl from '@/assets/icons/material-file-theme/npm.svg'
import pdfIconUrl from '@/assets/icons/material-file-theme/pdf.svg'
import phpIconUrl from '@/assets/icons/material-file-theme/php.svg'
import powerpointIconUrl from '@/assets/icons/material-file-theme/powerpoint.svg'
import powershellIconUrl from '@/assets/icons/material-file-theme/powershell.svg'
import prettierIconUrl from '@/assets/icons/material-file-theme/prettier.svg'
import pythonIconUrl from '@/assets/icons/material-file-theme/python.svg'
import reactIconUrl from '@/assets/icons/material-file-theme/react.svg'
import reactTsIconUrl from '@/assets/icons/material-file-theme/react_ts.svg'
import readmeIconUrl from '@/assets/icons/material-file-theme/readme.svg'
import rubyIconUrl from '@/assets/icons/material-file-theme/ruby.svg'
import rustIconUrl from '@/assets/icons/material-file-theme/rust.svg'
import sassIconUrl from '@/assets/icons/material-file-theme/sass.svg'
import settingsIconUrl from '@/assets/icons/material-file-theme/settings.svg'
import svgIconUrl from '@/assets/icons/material-file-theme/svg.svg'
import swiftIconUrl from '@/assets/icons/material-file-theme/swift.svg'
import tableIconUrl from '@/assets/icons/material-file-theme/table.svg'
import tailwindcssIconUrl from '@/assets/icons/material-file-theme/tailwindcss.svg'
import testJsIconUrl from '@/assets/icons/material-file-theme/test-js.svg'
import testJsxIconUrl from '@/assets/icons/material-file-theme/test-jsx.svg'
import testTsIconUrl from '@/assets/icons/material-file-theme/test-ts.svg'
import tomlIconUrl from '@/assets/icons/material-file-theme/toml.svg'
import tsconfigIconUrl from '@/assets/icons/material-file-theme/tsconfig.svg'
import typescriptIconUrl from '@/assets/icons/material-file-theme/typescript.svg'
import typescriptDefIconUrl from '@/assets/icons/material-file-theme/typescript-def.svg'
import videoIconUrl from '@/assets/icons/material-file-theme/video.svg'
import viteIconUrl from '@/assets/icons/material-file-theme/vite.svg'
import wordIconUrl from '@/assets/icons/material-file-theme/word.svg'
import xmlIconUrl from '@/assets/icons/material-file-theme/xml.svg'
import yamlIconUrl from '@/assets/icons/material-file-theme/yaml.svg'
import zipIconUrl from '@/assets/icons/material-file-theme/zip.svg'
import folderApiIconUrl from '@/assets/icons/material-file-theme/folder-api.svg'
import folderBaseIconUrl from '@/assets/icons/material-file-theme/folder-base.svg'
import folderComponentsIconUrl from '@/assets/icons/material-file-theme/folder-components.svg'
import folderConfigIconUrl from '@/assets/icons/material-file-theme/folder-config.svg'
import folderCssIconUrl from '@/assets/icons/material-file-theme/folder-css.svg'
import folderDocsIconUrl from '@/assets/icons/material-file-theme/folder-docs.svg'
import folderGitIconUrl from '@/assets/icons/material-file-theme/folder-git.svg'
import folderHookIconUrl from '@/assets/icons/material-file-theme/folder-hook.svg'
import folderImagesIconUrl from '@/assets/icons/material-file-theme/folder-images.svg'
import folderLibIconUrl from '@/assets/icons/material-file-theme/folder-lib.svg'
import folderPublicIconUrl from '@/assets/icons/material-file-theme/folder-public.svg'
import folderResourceIconUrl from '@/assets/icons/material-file-theme/folder-resource.svg'
import folderRoutesIconUrl from '@/assets/icons/material-file-theme/folder-routes.svg'
import folderScriptsIconUrl from '@/assets/icons/material-file-theme/folder-scripts.svg'
import folderServerIconUrl from '@/assets/icons/material-file-theme/folder-server.svg'
import folderSrcIconUrl from '@/assets/icons/material-file-theme/folder-src.svg'
import folderTestIconUrl from '@/assets/icons/material-file-theme/folder-test.svg'
import folderUtilsIconUrl from '@/assets/icons/material-file-theme/folder-utils.svg'
import { getDirectoryIconName, getFileIconName } from './file-icon-utils'
import type { MaterialDirectoryIconName, MaterialFileIconName } from './file-icon-utils'

const fileIconUrls: Record<MaterialFileIconName, string> = {
  audio: audioIconUrl,
  c: cIconUrl,
  certificate: certificateIconUrl,
  console: consoleIconUrl,
  cpp: cppIconUrl,
  csharp: csharpIconUrl,
  css: cssIconUrl,
  database: databaseIconUrl,
  docker: dockerIconUrl,
  document: documentIconUrl,
  eslint: eslintIconUrl,
  font: fontIconUrl,
  git: gitIconUrl,
  go: goIconUrl,
  html: htmlIconUrl,
  image: imageIconUrl,
  java: javaIconUrl,
  javascript: javascriptIconUrl,
  'javascript-map': javascriptMapIconUrl,
  json: jsonIconUrl,
  key: keyIconUrl,
  kotlin: kotlinIconUrl,
  less: lessIconUrl,
  license: licenseIconUrl,
  lock: lockIconUrl,
  log: logIconUrl,
  makefile: makefileIconUrl,
  markdown: markdownIconUrl,
  nodejs: nodejsIconUrl,
  npm: npmIconUrl,
  pdf: pdfIconUrl,
  php: phpIconUrl,
  powerpoint: powerpointIconUrl,
  powershell: powershellIconUrl,
  prettier: prettierIconUrl,
  python: pythonIconUrl,
  react: reactIconUrl,
  'react-ts': reactTsIconUrl,
  readme: readmeIconUrl,
  ruby: rubyIconUrl,
  rust: rustIconUrl,
  sass: sassIconUrl,
  settings: settingsIconUrl,
  svg: svgIconUrl,
  swift: swiftIconUrl,
  table: tableIconUrl,
  tailwindcss: tailwindcssIconUrl,
  'test-js': testJsIconUrl,
  'test-jsx': testJsxIconUrl,
  'test-ts': testTsIconUrl,
  toml: tomlIconUrl,
  tsconfig: tsconfigIconUrl,
  typescript: typescriptIconUrl,
  'typescript-def': typescriptDefIconUrl,
  video: videoIconUrl,
  vite: viteIconUrl,
  word: wordIconUrl,
  xml: xmlIconUrl,
  yaml: yamlIconUrl,
  zip: zipIconUrl,
}

const directoryIconUrls: Record<MaterialDirectoryIconName, string> = {
  'folder-api': folderApiIconUrl,
  'folder-base': folderBaseIconUrl,
  'folder-components': folderComponentsIconUrl,
  'folder-config': folderConfigIconUrl,
  'folder-css': folderCssIconUrl,
  'folder-docs': folderDocsIconUrl,
  'folder-git': folderGitIconUrl,
  'folder-hook': folderHookIconUrl,
  'folder-images': folderImagesIconUrl,
  'folder-lib': folderLibIconUrl,
  'folder-public': folderPublicIconUrl,
  'folder-resource': folderResourceIconUrl,
  'folder-routes': folderRoutesIconUrl,
  'folder-scripts': folderScriptsIconUrl,
  'folder-server': folderServerIconUrl,
  'folder-src': folderSrcIconUrl,
  'folder-test': folderTestIconUrl,
  'folder-utils': folderUtilsIconUrl,
}

type IconImageProps = {
  className?: string
}

function IconImage({ src, className = 'size-3.5' }: IconImageProps & { src: string }) {
  return <img src={src} alt="" aria-hidden="true" draggable={false} className={className} />
}

export function FileIcon({ path, className }: { path: string; className?: string }) {
  return <IconImage src={fileIconUrls[getFileIconName(path)]} className={className} />
}

export function DirectoryIcon({ name, open, className }: { name: string; open: boolean; className?: string }) {
  return <IconImage src={directoryIconUrls[getDirectoryIconName(name, open)]} className={className} />
}
