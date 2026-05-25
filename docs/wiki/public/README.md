# `public/` — 静态资源

## 文件清单

| 文件 | 说明 |
|------|------|
| [favicon.svg](../../public/favicon.svg) | 网站图标 (SVG 格式) |
| [manifest.webmanifest](../../public/manifest.webmanifest) | PWA manifest，定义安装名称、主题色、启动路径和图标 |
| [sw.js](../../public/sw.js) | 轻量 PWA Service Worker，缓存前端壳和静态资源，排除 `/api` 请求 |
| `pwa-icon-192.png` | PWA 192x192 PNG 图标，深色底 + QF 字母 |
| `pwa-icon-512.png` | PWA 512x512 PNG 图标，深色底 + QF 字母 |
| `pwa-maskable-512.png` | PWA maskable 512x512 PNG 图标，保留安全边距用于安装态裁切 |

---

### `favicon.svg`

网站的 SVG 图标文件，由 Vite 构建时直接复制到输出目录。

### `manifest.webmanifest`

PWA manifest 文件，安装名称使用 `QuickForge`，以 `standalone` 模式启动，主题色和背景色为深色工具界面基调。

### `sw.js`

生产环境注册的轻量 Service Worker：

- 预缓存 `/`、favicon、manifest 和 PWA 图标。
- 对页面导航使用 network-first，服务不可用时回退到已缓存的前端壳。
- 对 JS、CSS、图片、字体、manifest 使用 stale-while-revalidate。
- 明确跳过非 GET、跨域和 `/api` 请求，避免缓存业务 API、SSE、agent、文件或 shell 操作。
