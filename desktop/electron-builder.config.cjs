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
    icon: 'desktop/assets/icon.svg',
  },
  mac: {
    target: 'dmg',
  },
  linux: {
    target: 'AppImage',
  },
}
