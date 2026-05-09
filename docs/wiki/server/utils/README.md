# `server/utils/` — 后端工具函数

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [logger.mjs](logger.mjs.md) | 日志工具 | 26 行 |
| [network.mjs](network.mjs.md) | 网络工具 | 39 行 |
| [platform.mjs](platform.mjs.md) | 平台工具 (跨平台) | 152 行 |
| [response.mjs](response.mjs.md) | HTTP 响应工具 | 35 行 |
| [text-diff.mjs](text-diff.mjs.md) | 文本差异对比 | 215 行 |
| [workspace.mjs](workspace.mjs.md) | 工作区路径工具 | 158 行 |

---

## 各工具说明

### `logger.mjs` — 日志工具

- 基于 `console.log`/`console.error` 的统一日志接口
- 支持时间戳前缀
- 消息类型: `info`, `warn`, `error`, `debug`

### `network.mjs` — 网络工具

- `isLoopbackAddress(host)` — 判断是否为回环地址
- `getLanUrls(port)` — 获取 LAN 网络地址列表 (用于 LAN 共享)

### `platform.mjs` — 跨平台工具

- `openBrowser(url)` — 自动打开浏览器 (支持 Windows/macOS/Linux)
- `resolveDataDir()` — 解析数据目录路径 (考虑 XDG/Windows 约定)
- `isWindows()` / `isMacOS()` / `isLinux()` — 平台检测

### `response.mjs` — HTTP 响应工具

- `sendJson(res, statusCode, data)` — 发送 JSON 响应
- `sendError(res, statusCode, message, details?)` — 发送错误响应
- `readJsonBody(req)` — 读取并解析 JSON 请求体
- `decodeSegment(encoded)` — URL 解码路径片段

### `text-diff.mjs` — 文本差异

- `createTextDiff(oldText, newText)` — 计算文本差异
- 实现自有 diff 算法 (非 `diff` 命令)
- 返回添加/删除行数和详细差异内容
- 支持大文件差异截断

### `workspace.mjs` — 工作区工具

- `resolveWorkspacePath(relativePath)` — 解析工作区相对路径
- `toWorkspaceRelative(absolutePath)` — 转换为相对路径
- `assertSafeWorkspacePath(path)` — 安全校验 (防止路径穿越)
- `truncateText(text, maxLines, maxChars)` — 文本截断
- `splitLines(text)` — 行拆分
- `walkFiles(dir, predicate?, maxDepth?)` — 递归遍历文件
- `directorySize(dir)` — 计算目录大小
