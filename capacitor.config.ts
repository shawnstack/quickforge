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
      // 云远程访问（RemoteTunnel）：原生层在 127.0.0.1:18080 提供本地隧道 HTTP 服务；
      // 云账户登录页/云 API 域名（占位，正式域名确定后替换 *.quickforge.app）。
      '*',
      '42.194.187.88',
      '*.quickforge.app',
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
