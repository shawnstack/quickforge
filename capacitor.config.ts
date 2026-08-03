import type { CapacitorConfig } from '@capacitor/cli'

const tailscaleIpv4Navigation = Array.from({ length: 64 }, (_, index) => `100.${64 + index}.*.*`)

const config: CapacitorConfig = {
  appId: 'com.quickforge.mobile',
  appName: 'QuickForge',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    cleartext: true,
    allowNavigation: [
      '*.ts.net',
      '*.*.ts.net',
      ...tailscaleIpv4Navigation,
    ],
    errorPath: 'mobile-error.html',
  },
  android: {
    allowMixedContent: false,
  },
}

export default config
