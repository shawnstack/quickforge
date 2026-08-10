# Android Tailscale 远程客户端

## 架构

Android 端是 Capacitor 薄壳，不在 APK 内运行 QuickForge 服务。App 启动后先由用户选择云账户或服务器连接方式；服务器选择页以已保存列表为主，可为每个地址设置别名并点击整行连接，`lastUsedUrl` 仅用于显示“上次使用”标记，不会触发自动连接。添加表单仅在首次使用或主动添加时展开，会明确提示 Tailscale 地址范围并预览规范化后的连接地址。服务器管理操作收拢在行内菜单中，删除前需要确认。云账户检测到已有原生会话时也会先等待用户确认，只有点击“继续当前登录”后才加载设备；也可清理本地会话并使用其他账号。进入已连接的服务后，可点击侧边栏底部显示的当前地址返回连接选择页。WebView 直接加载服务端提供的 QuickForge 页面。

```text
Android App → Tailscale → http(s)://<QuickForge 服务>:5176
```

由于页面、REST、SSE 和 LAN 访问 Cookie 都来自同一个服务 origin，无需把现有前端改造成跨域 API 客户端。

## 安全边界

- App 连接页只接受以 `.ts.net` 结尾的 MagicDNS 完整域名，或 Tailscale `100.64.0.0/10` 地址。
- App 保存服务器地址列表和最后使用的地址，不保存局域网访问密码。
- 服务端仍要求在本机设置中显式开启“局域网完整访问”并配置强密码。
- 已通过 LAN 密码认证的远程客户端可以使用宿主机的 QuickForge Cloud 身份、模型与额度，并可访问 Storage、Backup、更新与重启；权限不再依赖客户端 IP 网段。
- 已认证远程请求仍不能使用终端、修改系统代理或终端 Shell、弹出目录选择器或打开服务端电脑上的资源管理器/IDE。
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
- `src/lib/system-notifications.ts`：浏览器通知与 Capacitor Android 本地通知的统一适配层。
- `android/app/build/outputs/apk/debug/app-debug.apk`：Android 构建输出；服务端将其映射为 `/downloads/quickforge-android.apk`，不会复制进 APK 自身。
- `server/routes/system.mjs`、`server/routes/project.mjs`、`server/routes/workspace.mjs`：远程能力限制。

## 系统通知

Android 薄壳通过 `@capacitor/local-notifications` 调用系统通知栏。用户必须在“设置 → 常规 → 系统通知”中主动授权；通知开关保存在当前设备，不会随 QuickForge 服务同步。任务完成事件仍来自现有 SSE，因此只有 App 仍在运行并能收到事件时才能通知；App 被系统结束后不会继续收到通知，也不等同于 FCM 推送。

任务终态（完成 `idle`、失败 `error`、中止 `aborted`）在 App 前台时也会弹出系统通知，只有“运行中”（`running`）的调度任务通知在页面可见且有焦点时被抑制，避免前台打扰。

Android 13 及以上会在启用时请求运行时通知权限。通知正文只显示任务状态和打开详情提示，不直接暴露完整 AI 输出。

## 文字选择与外部链接

- Android 客户端会显式允许对话正文、工具结果、Markdown Reader 和设置说明文字长按选择、跨行复制；按钮、拖拽控件和终端仍保留各自的交互策略。
- 密码认证后的刷新、服务器连接/切换、页面 reload 及其他程序化 HTTP(S) 导航始终留在 App WebView。
- 用户明确点击的文字或图片链接，以及 `target="_blank"` 和用户触发的 `window.open()`，由 Android 原生 `WebViewClient` / `WebChromeClient` 调用 `ACTION_VIEW`，交给系统默认浏览器；`mailto:`、`tel:`、`sms:` 和 `geo:` 链接交给对应系统应用。
- QuickForge 内部通过按钮触发的页面切换、会话打开和设置导航不受影响，仍留在 App 内。
