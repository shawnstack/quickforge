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
  npmRebuild: false,
  extraMetadata: {
    main: 'desktop/electron-main.mjs',
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
  },
  mac: {
    target: 'dmg',
    icon: 'desktop/assets/icon.icns',
  },
  linux: {
    target: 'AppImage',
    icon: 'desktop/assets/icon.png',
  },
}
