# `server/utils/` — 后端工具函数

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [logger.mjs](logger.mjs) | 日志工具 | 34 |
| [network.mjs](network.mjs) | 网络工具 | 38 |
| [platform.mjs](platform.mjs) | 平台工具 (跨平台) | 161 |
| [response.mjs](response.mjs) | HTTP 响应工具 | 42 |
| [text-diff.mjs](text-diff.mjs) | 文本差异对比 | 215 |
| [workspace.mjs](workspace.mjs) | 工作区路径工具 | 182 |

---

## 各工具说明

### logger.mjs — 日志工具

- 输出到 stderr 和文件 (`~/.quickforge/logs/server-YYYY-MM-DD.log`)
- 级别: `info`, `warn`, `error`

### network.mjs — 网络工具

- `isPrivateIpv4()` — 判断是否为私有 IPv4 地址
- `isLoopbackAddress()` — 判断是否为回环地址
- `getLanIpv4Addresses()` — 获取所有 LAN IPv4 地址
- `getLanUrls()` — 生成 LAN 访问 URL

### platform.mjs — 跨平台工具

- `selectDirectoryDialog()` — 打开系统原生目录选择器（跨平台实现）
- `openPathInFileManager()` — 在文件管理器中打开路径
- `openBrowser()` — 打开浏览器
- `spawnCollect()` — 子进程执行并收集输出

### response.mjs — HTTP 响应工具

- `sendJson()` — 发送 JSON 响应
- `sendError()` — 发送错误响应
- `readJsonBody()` — 读取并解析 JSON 请求体（带大小限制）
- `decodeSegment()` — URL 解码路径段

### text-diff.mjs — 文本差异

- `createTextDiff()` — 计算两段文本的行级差异
- 基于 LCS（最长公共子序列）的自定义实现
- 大文件保护：超过 200 万 cells 时回退到全删全插
- 上下文行支持（默认 3 行）

### workspace.mjs — 工作区工具

- `resolveWorkspacePath()` — 将相对/绝对路径解析为工作区内绝对路径
- `assertSafeWorkspacePath()` — 阻止访问敏感路径
- `toWorkspaceRelative()` — 将绝对路径转为工作区相对路径
- `walkFiles()` — 递归遍历文件
- `directorySize()` — 递归计算目录大小
