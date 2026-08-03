# Android Tailscale 远程客户端

## 架构

Android 端是 Capacitor 薄壳，不在 APK 内运行 QuickForge 服务。首次启动显示服务器连接页，用户输入 Tailscale MagicDNS 完整域名或 `100.64.0.0/10` 地址后，WebView 直接加载服务端提供的 QuickForge 页面。

```text
Android App → Tailscale → http(s)://<QuickForge 服务>:5176
```

由于页面、REST、SSE 和 LAN 访问 Cookie 都来自同一个服务 origin，无需把现有前端改造成跨域 API 客户端。

## 安全边界

- App 连接页只接受以 `.ts.net` 结尾的 MagicDNS 完整域名，或 Tailscale `100.64.0.0/10` 地址。
- App 只保存服务器地址，不保存局域网访问密码。
- 服务端仍要求在本机设置中显式开启“局域网完整访问”并配置强密码。
- 已认证的远程请求仍不能使用终端、重启服务、弹出目录选择器或打开服务端电脑上的资源管理器/IDE。
- 不要将 QuickForge `5176` 端口直接映射到公网；优先使用 Tailscale ACL 进一步限制可访问设备。

## 构建

```bash
npm install
npm run android:sync
npm run android:open
```

Windows 调试 APK：

```bash
npm run android:build
```

输出位置：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Android 9 及以上默认禁止明文 HTTP。当前 Capacitor 配置为 Tailscale 内部 HTTP 开启 cleartext；如服务端通过 HTTPS 提供访问，应优先使用 HTTPS 地址。

## 运行步骤

1. 手机与服务端电脑登录同一个 Tailnet。
2. 服务端启动 QuickForge，并在本机设置中开启局域网完整访问。
3. 确认主机防火墙允许 Tailscale 网络访问 QuickForge 端口。
4. App 中输入类似地址：

```text
http://devbox.example.ts.net:5176
```

5. 在 QuickForge 解锁页输入局域网访问密码。

## 相关文件

- `capacitor.config.ts`：Capacitor 和导航白名单配置。
- `android/`：Android Studio 原生工程。
- `src/components/mobile/MobileServerConnectPage.tsx`：连接页。
- `src/lib/mobile-server.ts`：地址校验、持久化和移动壳标记。
- `server/routes/system.mjs`、`server/routes/project.mjs`、`server/routes/workspace.mjs`：远程能力限制。
