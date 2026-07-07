import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startQuickForge, stopQuickForge } from '../server/public-api.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const appName = 'QuickForge'
const desktopTitleBarThemes = {
  light: {
    color: '#f3f4f6',
    symbolColor: '#111827',
  },
  dark: {
    color: '#18181b',
    symbolColor: '#f4f4f5',
  },
}
const desktopTitleBarHeight = process.platform === 'darwin' ? 28 : 32

let mainWindow = null
let quickForgeInstance = null
let tray = null
let trayLanguage = null
let desktopTheme = 'light'
let desktopThemePollTimer = null
let isQuitting = false
let isStopping = false

const trayTranslations = {
  en: {
    open: 'Open QuickForge',
    hide: 'Hide QuickForge',
    show: 'Show QuickForge',
    quit: 'Quit QuickForge',
  },
  zh: {
    open: '打开 QuickForge',
    hide: '隐藏 QuickForge',
    show: '显示 QuickForge',
    quit: '退出 QuickForge',
  },
}

function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light'
}

function getDesktopTitleBarTheme(theme = desktopTheme) {
  return desktopTitleBarThemes[normalizeTheme(theme)] || desktopTitleBarThemes.light
}

function applyDesktopTitleBarTheme(theme = desktopTheme) {
  desktopTheme = normalizeTheme(theme)
  const titleBarTheme = getDesktopTitleBarTheme(desktopTheme)
  mainWindow?.setBackgroundColor(titleBarTheme.color)
  mainWindow?.setTitleBarOverlay?.({
    color: titleBarTheme.color,
    symbolColor: titleBarTheme.symbolColor,
    height: desktopTitleBarHeight,
  })
  void mainWindow?.webContents.executeJavaScript(
    `document.body?.style.setProperty('--quickforge-desktop-titlebar-bg', ${JSON.stringify(titleBarTheme.color)})`,
    true,
  ).catch(() => undefined)
}

function stopDesktopThemePolling() {
  if (desktopThemePollTimer) {
    clearInterval(desktopThemePollTimer)
    desktopThemePollTimer = null
  }
}

function startDesktopThemePolling() {
  stopDesktopThemePolling()
  desktopThemePollTimer = setInterval(() => {
    if (!mainWindow) {
      stopDesktopThemePolling()
      return
    }
    void mainWindow.webContents.executeJavaScript('window.__quickforgeDesktopTheme', true)
      .then((theme) => {
        if (theme) applyDesktopTitleBarTheme(theme)
      })
      .catch(() => undefined)
  }, 250)
}

function normalizeLanguage(value) {
  return value === 'zh' || value === 'en' ? value : null
}

function getSystemTrayLanguage() {
  const locale = app.getLocale?.() || ''
  return locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

function getTrayLabels() {
  return trayTranslations[trayLanguage || getSystemTrayLanguage()] || trayTranslations.en
}

async function refreshTrayLanguage() {
  if (!quickForgeInstance?.url) return null

  try {
    const response = await fetch(`${quickForgeInstance.url}/api/storage/settings/key/language`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = await response.json()
    const language = normalizeLanguage(payload?.value)
    if (!language || language === trayLanguage) return language
    trayLanguage = language
    updateTrayMenu()
    return language
  } catch {
    return null
  }
}

async function refreshDesktopTheme() {
  if (!quickForgeInstance?.url) return null

  try {
    const response = await fetch(`${quickForgeInstance.url}/api/storage/settings/key/appearance-settings`, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) return null
    const payload = await response.json()
    const theme = normalizeTheme(payload?.value?.theme)
    applyDesktopTitleBarTheme(theme)
    return theme
  } catch {
    return null
  }
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function hideMainWindow() {
  mainWindow?.hide()
}

function toggleMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isVisible() && mainWindow.isFocused()) {
    hideMainWindow()
    return
  }
  showMainWindow()
}

function quitApp() {
  isQuitting = true
  app.quit()
}

function showRendererContextMenu(params) {
  if (!mainWindow) return

  const editFlags = params.editFlags || {}
  const hasSelection = Boolean(params.selectionText?.trim())
  const template = params.isEditable
    ? [
        { role: 'undo', enabled: Boolean(editFlags.canUndo) },
        { role: 'redo', enabled: Boolean(editFlags.canRedo) },
        { type: 'separator' },
        { role: 'cut', enabled: Boolean(editFlags.canCut) },
        { role: 'copy', enabled: Boolean(editFlags.canCopy || hasSelection) },
        { role: 'paste', enabled: Boolean(editFlags.canPaste) },
        { type: 'separator' },
        { role: 'selectAll', enabled: Boolean(editFlags.canSelectAll) },
      ]
    : hasSelection
      ? [
          { role: 'copy' },
          { type: 'separator' },
          { role: 'selectAll' },
        ]
      : []

  if (template.length === 0) return
  Menu.buildFromTemplate(template).popup({ window: mainWindow })
}

function getIconFromCandidates(iconCandidates) {
  for (const iconPath of iconCandidates) {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) return icon
  }

  return nativeImage.createEmpty()
}

function getBrowserFaviconIcon() {
  return getIconFromCandidates([
    path.join(__dirname, 'assets', 'icon.svg'),
    path.join(projectRoot, 'dist', 'favicon.svg'),
    path.join(projectRoot, 'public', 'favicon.svg'),
    path.join(projectRoot, 'dist', 'pwa-icon-192.png'),
    path.join(projectRoot, 'public', 'pwa-icon-192.png'),
  ])
}

function getTrayIcon() {
  if (process.platform === 'win32') {
    const icon = getIconFromCandidates([
      path.join(__dirname, 'assets', 'icon.ico'),
      path.join(__dirname, 'assets', 'icon.png'),
    ])
    if (!icon.isEmpty()) return icon
  }

  const icon = getBrowserFaviconIcon()
  if (icon.isEmpty()) return icon
  return icon.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 })
}

async function getDesktopRuntimeVersion() {
  try {
    const text = await fs.readFile(path.join(projectRoot, 'package.json'), 'utf8')
    const pkg = JSON.parse(text)
    return pkg.version || app.getVersion()
  } catch {
    return app.getVersion()
  }
}

function getStartupErrorMessage(error) {
  if (error?.code === 'QUICKFORGE_VERSION_MISMATCH') {
    return {
      message: 'QuickForge Desktop detected a mismatched local service.',
      detail: [
        `Desktop runtime version: ${error.expectedVersion || 'unknown'}`,
        `Running service version: ${error.actualVersion || 'unknown'}`,
        error.pid ? `Running service PID: ${error.pid}` : null,
        error.port ? `Port: ${error.port}` : null,
        '',
        'To avoid loading incompatible frontend assets and styles, Desktop will not reuse this service.',
        'Please close the existing QuickForge/qf service and start QuickForge Desktop again, or set QUICKFORGE_DESKTOP_PORT to an unused port.',
      ].filter(Boolean).join('\n'),
    }
  }

  return {
    message: 'QuickForge could not start.',
    detail: error?.stack || error?.message || String(error),
  }
}

function updateTrayMenu() {
  if (!tray) return

  const windowVisible = Boolean(mainWindow?.isVisible())
  const labels = getTrayLabels()
  const contextMenu = Menu.buildFromTemplate([
    {
      label: labels.open,
      click: showMainWindow,
    },
    {
      label: windowVisible ? labels.hide : labels.show,
      click: windowVisible ? hideMainWindow : showMainWindow,
    },
    { type: 'separator' },
    {
      label: labels.quit,
      click: quitApp,
    },
  ])

  tray.setContextMenu(contextMenu)
}

function createTray() {
  if (tray) return

  tray = new Tray(getTrayIcon())
  tray.setToolTip(appName)
  updateTrayMenu()

  tray.on('click', () => {
    if (process.platform === 'darwin') {
      showMainWindow()
      return
    }
    toggleMainWindow()
  })

  tray.on('right-click', () => {
    void refreshTrayLanguage().finally(updateTrayMenu)
  })
}

function createWindow(url) {
  const initialTitleBarTheme = getDesktopTitleBarTheme()
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: getBrowserFaviconIcon(),
    backgroundColor: initialTitleBarTheme.color,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: initialTitleBarTheme.color,
      symbolColor: initialTitleBarTheme.symbolColor,
      height: desktopTitleBarHeight,
    },
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.webContents.on('context-menu', (_event, params) => {
    showRendererContextMenu(params)
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    updateTrayMenu()
  })

  mainWindow.webContents.on('dom-ready', () => {
    void mainWindow?.webContents.insertCSS(`
      body.quickforge-desktop-app {
        --quickforge-desktop-titlebar-height: ${desktopTitleBarHeight}px;
        background: var(--quickforge-desktop-titlebar-bg, ${initialTitleBarTheme.color});
        transition: background-color 160ms ease;
      }

      body.quickforge-desktop-app #root {
        padding-top: ${desktopTitleBarHeight}px;
      }

      body.quickforge-desktop-app #root > .h-screen {
        height: calc(100vh - ${desktopTitleBarHeight}px);
      }

      body.quickforge-desktop-app .quickforge-window-toolbar {
        top: calc(${desktopTitleBarHeight}px + 0.5rem);
      }

      body.quickforge-desktop-app .quickforge-desktop-titlebar {
        display: flex;
        background: var(--quickforge-desktop-titlebar-bg, ${initialTitleBarTheme.color});
        -webkit-app-region: drag;
        user-select: none;
      }

      body.quickforge-desktop-app .quickforge-desktop-titlebar-trigger,
      body.quickforge-desktop-app .quickforge-desktop-titlebar-menu,
      body.quickforge-desktop-app .quickforge-desktop-titlebar-menu * {
        -webkit-app-region: no-drag;
      }
    `)
    void mainWindow?.webContents.executeJavaScript(`
      document.body.classList.add('quickforge-desktop-app');
      window.__quickforgeDesktopApp = true;
      (() => {
        const syncDesktopTheme = () => {
          const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
          window.__quickforgeDesktopTheme = theme;
          return theme;
        };
        syncDesktopTheme();
        if (!window.__quickforgeDesktopThemeObserver) {
          window.__quickforgeDesktopThemeObserver = new MutationObserver(syncDesktopTheme);
          window.__quickforgeDesktopThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        return window.__quickforgeDesktopTheme;
      })();
    `).then((theme) => {
      applyDesktopTitleBarTheme(theme)
    }).catch(() => undefined)
    void refreshDesktopTheme()
    startDesktopThemePolling()
  })

  mainWindow.on('show', updateTrayMenu)
  mainWindow.on('hide', updateTrayMenu)
  mainWindow.on('focus', updateTrayMenu)
  mainWindow.on('blur', updateTrayMenu)

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideMainWindow()
  })

  mainWindow.on('closed', () => {
    stopDesktopThemePolling()
    mainWindow = null
    updateTrayMenu()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl === 'quickforge://exit') {
      quitApp()
      return { action: 'deny' }
    }

    void shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  void mainWindow.loadURL(url)
}

async function boot() {
  try {
    app.setName(appName)

    const desktopRuntimeVersion = await getDesktopRuntimeVersion()
    quickForgeInstance = await startQuickForge({
      host: process.env.QUICKFORGE_DESKTOP_HOST || '127.0.0.1',
      port: process.env.QUICKFORGE_DESKTOP_PORT || process.env.QUICKFORGE_PORT || 5177,
      dataDir: process.env.QUICKFORGE_DESKTOP_DATA_DIR,
      workspaceDir: process.env.QUICKFORGE_DESKTOP_WORKSPACE_DIR,
      openBrowser: false,
      reuseExisting: 'same-version',
      expectedVersion: desktopRuntimeVersion,
      inline: process.env.QUICKFORGE_DESKTOP_INLINE !== '0',
      terminal: process.env.QUICKFORGE_DESKTOP_TERMINAL === '1',
      detached: false,
    })

    await refreshDesktopTheme()
    createWindow(quickForgeInstance.url)
    createTray()
    void refreshTrayLanguage()
  } catch (error) {
    const startupError = getStartupErrorMessage(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'QuickForge failed to start',
      message: startupError.message,
      detail: startupError.detail,
    })
    app.exit(1)
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)

  app.whenReady().then(boot)

  app.on('activate', () => {
    if (mainWindow) {
      showMainWindow()
      return
    }

    if (quickForgeInstance?.url) createWindow(quickForgeInstance.url)
  })

  app.on('before-quit', async (event) => {
    isQuitting = true
    if (isStopping || !quickForgeInstance || quickForgeInstance.reused) return

    event.preventDefault()
    isStopping = true
    const instance = quickForgeInstance
    quickForgeInstance = null
    await stopQuickForge(instance)
    app.exit(0)
  })
}
