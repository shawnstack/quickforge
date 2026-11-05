#!/usr/bin/env node
/* eslint-disable no-console */ // CLI tool: console output is its normal interface.
/**
 * [QuickForge] Patches electron-builder's bundled NSIS templates so that an
 * upgrade never stops on something cosmetic.
 *
 * Patch 1 — include/installUtil.nsh (dialog suppression)
 *   In UninstallLoop, UninstallLoop shows
 *     MessageBox ... "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt
 *   after 6 failed attempts, and this dialog sits BEFORE our
 *   customUnInstallCheck hook can run (so desktop/installer.nsh cannot suppress it).
 *   The patch replaces that dialog with a log line and a plain Return, so control
 *   flows to handleUninstallResult, where our hook continues with an overwrite
 *   install (self-healing upgrade, no dialogs).
 *
 * Patch 2 — installSection.nsh (non-fatal uninstaller icon)
 *   The installer writes `$INSTDIR\uninstallerIcon.ico` (a ~19 KB cosmetic file
 *   referenced by the uninstall entry's DisplayIcon) right before the app payload.
 *   A plain `File` aborts the whole upgrade with the Abort/Retry/Ignore
 *   "cannot open file for writing" dialog when that file happens to be held open
 *   for a moment by Windows (icon cache, Explorer, antivirus scan). Verified with
 *   NSIS 3.04: `File /nonfatal` silently skips the failed write and the installer
 *   continues (exit code 0, later files still written). The previous icon stays in
 *   place, which is exactly what DisplayIcon already points at.
 *
 * Idempotent: safe to run on every build. Fails loudly if a template no longer
 * matches (e.g. after an app-builder-lib upgrade) instead of silently building an
 * installer that still blocks on a dialog.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const workspaceRoot = path.resolve(scriptDir, '..', '..')
const templatesRoot = path.join(workspaceRoot, 'node_modules/app-builder-lib/templates/nsis')

const patches = [
  {
    name: 'installUtil.nsh: "app cannot be closed" retry dialog removed',
    file: path.join(templatesRoot, 'include/installUtil.nsh'),
    oldText: [
      '    ${if} $R5 > 5',
      '      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)" /SD IDCANCEL IDRETRY OneMoreAttempt',
      '      Return',
      '    ${endIf}',
      '',
      '  OneMoreAttempt:',
    ].join('\n'),
    newText: [
      '    ${if} $R5 > 5',
      '      # [QuickForge patch] Old uninstaller failed 6 times: do not block the user with',
      '      # the "app cannot be closed" retry dialog. Log it and fall through to',
      '      # handleUninstallResult, which continues with an overwrite install.',
      '      DetailPrint "Old uninstaller did not finish after 6 attempts; continuing with overwrite install."',
      '      Return',
      '    ${endIf}',
    ].join('\n'),
  },
  {
    name: 'installSection.nsh: uninstallerIcon.ico write is non-fatal',
    file: path.join(templatesRoot, 'installSection.nsh'),
    oldText: [
      '!ifdef UNINSTALLER_ICON',
      '  File /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"',
      '!endif',
    ].join('\n'),
    newText: [
      '!ifdef UNINSTALLER_ICON',
      '  # [QuickForge patch] Cosmetic file: if Windows holds it open for a moment',
      '  # (icon cache / Explorer / antivirus), skip the write instead of aborting the',
      '  # whole upgrade with the Abort/Retry/Ignore "cannot open file for writing"',
      '  # dialog. The previously installed icon stays in place.',
      '  File /nonfatal /oname=uninstallerIcon.ico "${UNINSTALLER_ICON}"',
      '!endif',
    ].join('\n'),
  },
]

let failed = false

for (const patch of patches) {
  if (!fs.existsSync(patch.file)) {
    console.error(`[nsis-patch] target template not found: ${patch.file}`)
    console.error('[nsis-patch] run "npm install" first (electron-builder is a dependency).')
    failed = true
    continue
  }

  const source = fs.readFileSync(patch.file, 'utf8')

  if (source.includes(patch.newText)) {
    console.log(`[nsis-patch] already patched: ${patch.name}`)
    continue
  }

  const occurrences = source.split(patch.oldText).length - 1
  if (occurrences !== 1) {
    console.error(`[nsis-patch] expected exactly 1 match for ${patch.name}, found ${occurrences}.`)
    console.error('[nsis-patch] the bundled template changed (app-builder-lib upgrade?); update this script.')
    failed = true
    continue
  }

  fs.writeFileSync(patch.file, source.replace(patch.oldText, patch.newText), 'utf8')
  console.log(`[nsis-patch] patched: ${patch.name}`)
}

if (failed) process.exit(1)

console.log('[nsis-patch] all template patches applied.')
