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
      // 服务器直连：Tailscale MagicDNS / 100.64.0.0/10，以及用户点击的外部链接。
      '*',
      '*.ts.net',
      '*.*.ts.net',
      ...tailscaleIpv4Navigation,
    ],
    errorPath: 'mobile-error.html',
  },
  android: {
    allowMixedContent: false,
    // The app loads remote server pages over plain http:// on the LAN/Tailscale.
    // Capacitor's WebMessageListener bridge is origin-scoped and only exposes
    // window.androidBridge for https:// allowNavigation rules, so remote pages
    // would run without native capabilities. The legacy bridge injects
    // androidBridge into every page, which is what a remote-client shell needs.
    useLegacyBridge: true,
  },
}

export default config
