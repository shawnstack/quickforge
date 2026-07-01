import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startQuickForge, stopQuickForge } from '../server/public-api.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const appName = 'QuickForge'
const desktopTitleBarColor = '#f3f4f6'
const desktopTitleBarSymbolColor = '#111827'
const desktopTitleBarHeight = process.platform === 'darwin' ? 28 : 32

let mainWindow = null
let quickForgeInstance = null
let tray = null
let trayLanguage = null
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

function getBrowserFaviconIcon() {
  const iconCandidates = [
    path.join(__dirname, 'assets', 'icon.svg'),
    path.join(projectRoot, 'dist', 'favicon.svg'),
    path.join(projectRoot, 'public', 'favicon.svg'),
    path.join(projectRoot, 'dist', 'pwa-icon-192.png'),
    path.join(projectRoot, 'public', 'pwa-icon-192.png'),
  ]

  for (const iconPath of iconCandidates) {
    const icon = nativeImage.createFromPath(iconPath)
    if (!icon.isEmpty()) return icon
  }

  return nativeImage.createEmpty()
}

function getTrayIcon() {
  const icon = getBrowserFaviconIcon()
  if (icon.isEmpty()) return icon
  return icon.resize({ width: process.platform === 'darwin' ? 18 : 16, height: process.platform === 'darwin' ? 18 : 16 })
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
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: getBrowserFaviconIcon(),
    backgroundColor: desktopTitleBarColor,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: desktopTitleBarColor,
      symbolColor: desktopTitleBarSymbolColor,
      height: desktopTitleBarHeight,
    },
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show()
    updateTrayMenu()
  })

  mainWindow.webContents.on('dom-ready', () => {
    void mainWindow?.webContents.insertCSS(`
      body.quickforge-desktop-app {
        background: ${desktopTitleBarColor};
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
    `)
    void mainWindow?.webContents.executeJavaScript("document.body.classList.add('quickforge-desktop-app')")
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
    mainWindow = null
    updateTrayMenu()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    void shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  void mainWindow.loadURL(url)
}

async function boot() {
  try {
    app.setName(appName)

    quickForgeInstance = await startQuickForge({
      host: process.env.QUICKFORGE_DESKTOP_HOST || '127.0.0.1',
      port: process.env.QUICKFORGE_DESKTOP_PORT || process.env.QUICKFORGE_PORT || 5176,
      dataDir: process.env.QUICKFORGE_DESKTOP_DATA_DIR,
      workspaceDir: process.env.QUICKFORGE_DESKTOP_WORKSPACE_DIR,
      openBrowser: false,
      reuseExisting: true,
      inline: process.env.QUICKFORGE_DESKTOP_INLINE === '1',
      terminal: process.env.QUICKFORGE_DESKTOP_TERMINAL === '1',
      detached: false,
    })

    createWindow(quickForgeInstance.url)
    createTray()
    void refreshTrayLanguage()
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'QuickForge failed to start',
      message: 'QuickForge could not start.',
      detail: error?.stack || error?.message || String(error),
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
