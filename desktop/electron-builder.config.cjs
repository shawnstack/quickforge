const path = require('path')

function normalizePlatform(value) {
  if (value === 'windows') return 'win32'
  if (value === 'mac') return 'darwin'
  return value
}

function normalizeArch(value) {
  if (value === 'amd64') return 'x64'
  return value
}

const buildPlatform = normalizePlatform(process.env.QUICKFORGE_DESKTOP_BUILD_PLATFORM || process.platform)
const buildArch = normalizeArch(process.env.QUICKFORGE_DESKTOP_BUILD_ARCH || process.arch)
const agentTarget = `${buildPlatform}-${buildArch}`

module.exports = {
  appId: 'com.shawnstack.quickforge',
  productName: 'QuickForge',
  directories: {
    output: 'desktop-dist',
  },
  files: [
    'desktop/**',
    'server/**',
    'skills/**',
    'plugins/**',
    'dist/**',
    'package.json',
    'LICENSE',
    'README.md',
  ],
  extraResources: [
    {
      from: path.join('runtime-assets', 'agent', agentTarget),
      to: path.join('agent', agentTarget),
      filter: ['**/*'],
    },
  ],
  npmRebuild: false,
  asarUnpack: [
    '**/*.node',
    '**/node_modules/@vscode/os-proxy-resolver*/**',
    '**/node_modules/@vscode/windows-ca-certs/**',
  ],
  extraMetadata: {
    main: 'desktop/electron-main.mjs',
    desktopName: 'quickforge',
  },
  win: {
    target: 'nsis',
    icon: 'desktop/assets/icon.ico',
  },
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: 'QuickForge',
    runAfterFinish: true,
    installerIcon: 'desktop/assets/icon.ico',
    uninstallerIcon: 'desktop/assets/icon.ico',
    include: 'desktop/installer.nsh',
  },
  mac: {
    target: 'dmg',
    icon: 'desktop/assets/icon.icns',
  },
  linux: {
    target: 'AppImage',
    icon: 'desktop/assets/icon.png',
    executableName: 'quickforge',
    category: 'Utility',
    syncDesktopName: true,
  },
}
