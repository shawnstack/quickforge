# `server/utils/` — 后端工具函数

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [logger.mjs](../../server/utils/logger.mjs) | 日志工具 | 182 |
| [network.mjs](../../server/utils/network.mjs) | 网络工具 | 38 |
| [platform.mjs](../../server/utils/platform.mjs) | 平台工具 (跨平台) | 161 |
| [response.mjs](../../server/utils/response.mjs) | HTTP 响应工具 | 42 |
| [text-diff.mjs](../../server/utils/text-diff.mjs) | 文本差异对比 | 215 |
| [workspace.mjs](../../server/utils/workspace.mjs) | 工作区路径工具 | 232 |
| [password-auth.mjs](../../server/utils/password-auth.mjs) | 密码哈希和令牌生成 | 44 |

---

## 各工具说明

### logger.mjs — 日志工具 (182 行)

- 输出到 stderr 和文件 (`~/.quickforge/logs/server-YYYY-MM-DD.log`)
- 级别: `info`, `warn`, `error`
- 支持自动日志轮转

### network.mjs — 网络工具 (38 行)

- `isPrivateIpv4()` — 判断是否为私有 IPv4 地址
- `isLoopbackAddress()` — 判断是否为回环地址
- `getLanIpv4Addresses()` — 获取所有 LAN IPv4 地址
- `getLanUrls()` — 生成 LAN 访问 URL

### platform.mjs — 跨平台工具 (161 行)

- `selectDirectoryDialog()` — 打开系统原生目录选择器（跨平台实现）
- `openPathInFileManager()` — 在文件管理器中打开目录
- `openPathInVSCode()` / `openPathInIDEA()` — 在对应编辑器中打开目录或具体文件
- `openBrowser()` — 打开浏览器
- `spawnCollect()` — 子进程执行并收集输出

### response.mjs — HTTP 响应工具 (42 行)

- `sendJson()` — 发送 JSON 响应
- `sendError()` — 发送错误响应
- `readJsonBody()` — 读取并解析 JSON 请求体（带大小限制）
- `decodeSegment()` — URL 解码路径段

### text-diff.mjs — 文本差异 (215 行)

- `createTextDiff()` — 计算两段文本的行级差异
- 基于 LCS（最长公共子序列）的自定义实现
- 大文件保护：超过 200 万 cells 时回退到全删全插
- 上下文行支持（默认 3 行）

### workspace.mjs — 工作区工具 (232 行)

- `resolveWorkspacePath()` — 将相对/绝对路径解析为工作区内绝对路径
- `assertSafeWorkspacePath()` / `assertSafeWorkspacePathWithRoot()` — 路径安全断言：默认（`options.allowSensitive` 未开启）先按 `isSensitiveWorkspacePath()` 拦截，再做 realpath 与 workspace 边界检查，最后对真实目标**复查一次**敏感路径（防止普通路径经内部符号链接伪装指向敏感文件）；越界抛 403 `WORKSPACE_PATH_ESCAPE`，敏感抛 403 `WORKSPACE_SENSITIVE_PATH`（均带稳定 `errorCode`，供上层映射为业务错误码）
- `isSensitiveWorkspacePath()` — 敏感路径判定；路径分段先 `toLocaleLowerCase()` 归一，**大小写不敏感**匹配 `.git`、`.env*`、密钥/证书、token、credentials/secrets 等
- `createWorkspacePathValidator()` — 基于会话 workspace 上下文构造路径校验器（workspace 搜索/mention-search 遍历复用）
- `toWorkspaceRelative()` — 将绝对路径转为工作区相对路径
- `walkFiles()` — 递归遍历文件
- `directorySize()` — 递归计算目录大小（带缓存与 `invalidateDirectorySizeCache()`）

### password-auth.mjs — 密码工具 (44 行)

- `hashPassword()` — scrypt 密码哈希
- `verifyPassword()` — 密码验证（常量时间比较）
- `createRandomToken()` — 生成加密随机令牌
- `sha256Base64Url()` — SHA-256 哈希（Base64URL 编码）
- `safeHashEqual()` — 安全哈希比较
