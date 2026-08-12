#!/usr/bin/env node
/* eslint-disable no-console */ // CLI tool: console output is its normal interface.
/**
 * [QuickForge] Patches electron-builder's bundled NSIS template so that a
 * failing old uninstaller never blocks the install with the
 * "app cannot be closed" retry dialog.
 *
 * Background: in installUtil.nsh, UninstallLoop shows
 *   MessageBox ... "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt
 * after 6 failed attempts, and this dialog sits BEFORE our
 * customUnInstallCheck hook can run (so desktop/installer.nsh cannot suppress it).
 * This patch replaces that dialog with a log line and a plain Return, so control
 * flows to handleUninstallResult, where our hook continues with an overwrite
 * install (self-healing upgrade, no dialogs).
 *
 * Idempotent: safe to run on every build. Fails loudly if the template no
 * longer matches (e.g. after an app-builder-lib upgrade) instead of silently
 * building an installer that shows the dialog again.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '..', '..')
const target = path.join(
  workspaceRoot,
  'node_modules/app-builder-lib/templates/nsis/include/installUtil.nsh',
)

const oldBlock = [
  '    ${if} $R5 > 5',
  '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt',
  '      Return',
  '    ${endIf}',
  '',
  '  OneMoreAttempt:',
].join('\n')

const newBlock = [
  '    ${if} $R5 > 5',
  '      # [QuickForge patch] Old uninstaller failed 6 times: do not block the user with',
  '      # the "app cannot be closed" retry dialog. Log it and fall through to',
  '      # handleUninstallResult, which continues with an overwrite install.',
  '      DetailPrint "Old uninstaller did not finish after 6 attempts; continuing with overwrite install."',
  '      Return',
  '    ${endIf}',
].join('\n')

if (!fs.existsSync(target)) {
  console.error(`[nsis-patch] target template not found: ${target}`)
  console.error('[nsis-patch] run "npm install" first (electron-builder is a dependency).')
  process.exit(1)
}

let source = fs.readFileSync(target, 'utf8')

if (source.includes(newBlock)) {
  console.log('[nsis-patch] installUtil.nsh already patched, nothing to do.')
  process.exit(0)
}

const occurrences = source.split(oldBlock).length - 1
if (occurrences !== 1) {
  console.error(`[nsis-patch] expected exactly 1 match of the dialog block, found ${occurrences}.`)
  console.error('[nsis-patch] the bundled template changed (app-builder-lib upgrade?); update this script.')
  process.exit(1)
}

source = source.replace(oldBlock, newBlock)
fs.writeFileSync(target, source, 'utf8')
console.log('[nsis-patch] patched installUtil.nsh: retry dialog replaced with log + continue.')
