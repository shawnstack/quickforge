import { spawn } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

export function spawnCollect(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: options.windowsHide ?? true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true
          child.kill('SIGTERM')
        }, options.timeoutMs)
      : undefined
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      if (timer) clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      resolve({ code, stdout, stderr, timedOut })
    })
  })
}

export async function selectDirectoryDialog() {
  if (process.platform === 'win32') {
    const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = 'QuickForge'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(1, 1)
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.Opacity = 0.01

$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Select QuickForge project folder'
$dialog.ShowNewFolderButton = $true

try {
  [void]$form.Show()
  [void]$form.Activate()
  $result = $dialog.ShowDialog($form)
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Out.Write($dialog.SelectedPath)
  }
  exit 0
} finally {
  if ($dialog) { $dialog.Dispose() }
  if ($form) { $form.Dispose() }
}
`
    let result = await spawnCollect(
      'powershell.exe',
      ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { windowsHide: false, timeoutMs: 10 * 60 * 1000 },
    ).catch(() => null)
    if (!result) {
      result = await spawnCollect(
        'pwsh.exe',
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-Command', script],
        { windowsHide: false, timeoutMs: 10 * 60 * 1000 },
      ).catch(() => null)
    }
    if (!result) {
      const error = new Error('PowerShell was not found. Please install PowerShell or enable Windows PowerShell.')
      error.statusCode = 500
      throw error
    }
    if (result.timedOut) {
      const error = new Error('Folder picker timed out. It may have been blocked by Windows or opened on another desktop.')
      error.statusCode = 504
      throw error
    }
    if (result.code === 0) return result.stdout.trim()
    const error = new Error(result.stderr.trim() || 'Failed to open folder picker')
    error.statusCode = 500
    throw error
  }

  if (process.platform === 'darwin') {
    const result = await spawnCollect('osascript', ['-e', 'POSIX path of (choose folder with prompt "Select QuickForge project folder")'])
    if (result.code === 0) return result.stdout.trim()
    if (/User canceled/i.test(result.stderr)) return ''
    const error = new Error(result.stderr.trim() || 'Failed to open folder picker')
    error.statusCode = 500
    throw error
  }

  const zenity = await spawnCollect('zenity', ['--file-selection', '--directory', '--title=Select QuickForge project folder']).catch(() => null)
  if (zenity) {
    if (zenity.code === 0) return zenity.stdout.trim()
    if (zenity.code === 1) return ''
  }

  const kdialog = await spawnCollect('kdialog', ['--getexistingdirectory', os.homedir(), 'Select QuickForge project folder']).catch(() => null)
  if (kdialog) {
    if (kdialog.code === 0) return kdialog.stdout.trim()
    if (kdialog.code === 1) return ''
  }

  const error = new Error('No supported folder picker found. Install zenity or kdialog on Linux.')
  error.statusCode = 501
  throw error
}

export function openBrowser(url) {
  if (process.env.QUICKFORGE_NO_OPEN === '1' || process.env.FASTCODE_NO_OPEN === '1') return

  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  const child = spawn(command, args, { detached: true, stdio: 'ignore', shell: false })
  child.unref()
}
