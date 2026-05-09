# `server/utils/` — 后端工具模块

**路径**: `server/utils/`

---

## workspace.mjs (183 行)

**用途**: 工作区路径管理和安全检查。

**核心功能**:
- `resolveWorkspacePath()` — 将相对/绝对路径解析为工作区内绝对路径，防止目录遍历攻击
- `assertSafeWorkspacePath()` — 阻止访问敏感路径（.git、.env、证书、密钥等）
- `toWorkspaceRelative()` — 将绝对路径转为工作区相对路径
- `isSensitiveWorkspacePath()` — 判断路径是否敏感
- `isInside()` — 检查路径是否在指定父目录内
- `walkFiles()` — 递归遍历文件（支持过滤）
- `pathExists()` / `assertDirectory()` — 文件和目录存在性检查
- `directorySize()` — 递归计算目录大小
- `truncateText()` / `splitLines()` — 文本工具

## text-diff.mjs (216 行)

**用途**: 纯文本差异计算算法（无需外部依赖）。

**算法**: 基于 LCS（最长公共子序列）的自定义实现，使用动态规划。

**功能**:
- `createTextDiff()` — 计算两段文本的行级差异
- 输出格式：`{ type: 'equal'|'insert'|'delete', line: string }[]`
- 大文件保护：超过 `MAX_LCS_CELLS`（200万）时回退到全删全插
- 上下文行支持（默认 3 行）
- 输出字符/行数截断

## platform.mjs (162 行)

**用途**: 平台特定的系统操作。

**功能**:
- `selectDirectoryDialog()` — 打开系统原生目录选择器（Windows 使用 PowerShell + WinForms，macOS/Linux 使用 AppleScript/Zenity）
- `openPathInFileManager()` — 在文件管理器中打开路径
- `openBrowser()` — 打开浏览器
- `spawnCollect()` — 子进程执行并收集输出

## logger.mjs (35 行)

**用途**: 简易日志系统。输出到 stderr 和文件。

**日志位置**: `~/.quickforge/logs/server-YYYY-MM-DD.log`

**级别**: `info`, `warn`, `error`

## network.mjs (39 行)

**用途**: 网络工具函数。

**功能**:
- `isPrivateIpv4()` — 判断是否为私有 IPv4 地址
- `isLoopbackAddress()` — 判断是否为回环地址
- `getLanIpv4Addresses()` — 获取所有 LAN IPv4 地址
- `getLanUrls()` — 生成 LAN 访问 URL

## response.mjs (43 行)

**用途**: HTTP 响应工具函数。

**功能**:
- `sendJson()` — 发送 JSON 响应
- `sendError()` — 发送错误响应
- `readJsonBody()` — 读取并解析 JSON 请求体（带大小限制）
- `decodeSegment()` — URL 解码路径段
