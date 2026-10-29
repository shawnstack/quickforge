# 渲染内存与附件传输边界

> 状态：已实施（P0–P3）
> 目标：在不改变交互的前提下，消除长回答、长会话和大附件导致的浏览器堆增长与卡顿。
> 实测基线（2026-10-29）：生产空会话首屏 3.6MB JS、53MB 堆；1000 条消息会话打开峰值 125MB、6 行消息 13k DOM 节点；7.39MB 单条消息是同一张图片的 base64 存了两份。

## 1. 五条不变量

1. **缓存只存定稿内容**：流式中的 Markdown / 数学预处理 / 代码高亮不写模块级内容缓存；`message_end` 之后才写一次。
2. **流式帧只传一份完整消息**：`message_update` 在 SSE 边界收敛为单份 `message`，删掉 `assistantMessageEvent.partial` 副本。
3. **浏览器消息体只含描述**：历史附件只带 `assetUrl`，字节按需从本机服务读取；只有小缩略图 `preview` 允许内联。
4. **渲染窗口有界，滚动锚点优先**：只保留读者附近的行；数据层保持权威全量。
5. **首屏只加载壳**：终端、模型运行时等重依赖不得进入首屏执行图。

## 2. 流式渲染

- 服务端：`message_update` 上游事件同时携带 `message` 与 `assistantMessageEvent.partial`（两份完整累积消息）。`server/utils/sse-wire.mjs#toSseWireEvent` 只在 SSE 写出边界删除后者；进程内消费者（ACP / Goal / Hooks）仍拿到完整事件。50ms trailing 合并不变。
- 客户端：`MarkdownBlock` 新增 `finalized`；`AssistantMessage` 用**本行**的 `isStreaming` 传入（不能用 `AssistantStreamingContext` 的 `surfaceStreaming`，否则 trace 面板会把所有历史行标记为流式）。
  - 定稿：`memoizeContent(markdownElementCache, ...)`，只写一次。
  - 流式：直接 `renderMarkdownTree(content, false)`，不写 Markdown/数学预处理缓存。
  - 代码块：`highlightCode(source, language, { cache: !streaming })`；`streaming` 变化时会重新执行一次并缓存最终版本。
- 结果：内存不再随回答长度保留 300/400 份中间版本；CPU 也少了每帧的哈希与 LRU 淘汰。

## 3. 有界渲染窗口

`src/components/chat/windowed-messages.ts`：

- 首屏仍只挂最近 3 轮；翻页仍按 3 轮。
- 新增 `WINDOW_MAX_TURNS = 12`、`WINDOW_MAX_CHARS = 160_000`。
- `loadMore()` 前移起点；超限时**前移终点**（丢弃视口下方较新的轮次），阅读位置不动。
- `loadNewer()` 后移终点；超限时**前移起点**（丢弃视口上方较旧的轮次），`ChatSurface.loadNewerMessages` 用 `readScrollAnchor` / `anchoredScrollTop` 补偿滚动位置。
- 轮次导航 `showMessageIndex` 仍以目标轮为中心、遵守同一上限。
- `ServerAgent.state.messages` 保持全量；usage/todo/压缩标记/goal 标记等派生逻辑不需要改。

## 4. 会话快照缓存

`src/lib/session-message-cache.ts`：

- schema 升到 2；条目只存**尾部窗口**（200 条，与只读视图一致）+ `windowOffset` + 服务端总条数 `messageCount`。
- `ServerAgent.buildSessionMessageCachePayload` 切片；`restore` 命中缓存时把 `messageWindowOffset` 设回条目值，后台 `/state` 对账仍按服务端索引工作。
- IndexedDB 总预算 64MB（`maxBytes`）；schema 升级必须能覆盖旧条目（高水位守卫只比较同 schema 版本）。
- 旧 schema 条目读取即 miss/删除，不迁移。

## 5. 附件传输边界

### 5.1 出站投影

`server/client-attachments.mjs`：

- 每个附件删除 `content` 与 `extractedText`；`preview` 仅在 ≤128KB（缩略图/PDF 首页）时保留；有 `id` 时追加 `assetUrl`。
- `projectStateForClient` / `projectMessagesForClient` / `projectEventForClient` 统一作用于：
  - `GET/POST /api/agents/:id/state|restore`
  - `GET /api/agents/:id/messages`
  - 两条 agent SSE 流
  - `POST /api/agents/:id/rollback` 的 `session`
  - `GET /api/sessions/:id/view`
  - shared 会话 payload / shared SSE / shared rollback
- 存储层与 `serverConvertToLlm` 不变：模型请求仍从已存储的 base64 组多模态内容。

### 5.2 读取端点

- `GET /api/sessions/:sessionId/attachments/:attachmentId`
- `GET /api/shared/:shareId/attachments/:attachmentId`（沿用 share token/cookie 鉴权）
- `?raw=1` 返回解码后的字节（缩略图/图片预览/下载）；默认 JSON 返回 `content` / `extractedText` / 元数据（文档预览组件）。
- 查找：热会话先扫内存 state；冷会话走 `session_messages` 的 `instr(message_json, JSON.stringify(attachmentId))`，命中后再校验精确 id（`server/message-attachment-lookup.mjs`、`findSessionAttachmentRecord`）。
- 响应 `cache-control: private, max-age=31536000, immutable`：附件 id 与字节都不变。

### 5.3 客户端

`src/components/chat/surface/attachment-client.ts`：

- `getAttachmentThumbnail(assetUrl)`：`?raw=1` 拉字节 → `createImageBitmap` → 160px canvas → WebP blob URL；模块级 LRU（40）并在淘汰时 revoke。用于没有内联缩略图的历史图片。
- `resolveAttachmentPayload` / `resolveAttachmentsForDraft`：按需拉 JSON 并合并 `content` / `extractedText`。
- `resolveMessagesForUpload`：fork 前把引用消息还原为可存储的完整消息。
- `AttachmentTile`：内联 preview 优先；否则图片走缩略图缓存，加载期间显示图片占位图标（仍可点击打开）。
- `AttachmentOverlay`：打开时解析完整 payload；图片用 data URL，文档走现有 PDF/DOCX/Excel 预览；失败显示不可用而不是崩溃。
- 回滚重发（主聊天与分享页）在回填草稿前解析附件；fork 在创建新会话前解析消息。

## 6. 首屏与传输

- `custom-model-selector.ts` 不再运行时 import `pi-ai`（本地 `modelsAreEqual`），1.6MB `pi-ai` chunk 从首屏执行图移除。
- `WorkspaceInspector` 内的 `TerminalDock` 改为 `lazy`；右侧栏默认展开不再加载 xterm。
- `scripts/precompress-assets.mjs` 在构建期生成 `.br` / `.gz`（文本类、≥512B）；`server/routes/static.mjs` 按 `Accept-Encoding` 协商并带 `Vary`。
- 实测首屏 JS/CSS：3.6MB → 2.1MB 原始 / 0.53MB gzip；`dist/index.html` preload 不再包含 `pi-ai` / `xterm`。

## 7. 契约与验证

- `tests/server/sse-wire.test.mjs`：`message_update` 只保留一份完整消息。
- `tests/frontend/streaming-render-cache.test.ts`：流式不写缓存、定稿写一次。
- `tests/frontend/windowed-messages.test.ts`：轮次/字符上限、双向驱逐。
- `tests/frontend/session-message-cache.test.ts`：schema 2、窗口 offset、高水位。
- `tests/server/client-attachments.test.mjs`、`message-attachment-lookup.test.mjs`、`session-state-repository` / `routes/session-view` / `routes/agent`：投影、查找、端点、SSE 出站。
- `tests/frontend/attachment-client.test.ts`：客户端解析、草稿、fork 上传。
- 浏览器实测（隔离数据目录）：图片附件会话的 view 响应不含 base64；tile 走 `?raw=1` 生成 blob 缩略图；overlay 正常显示。

## 8. 非目标与取舍

- 不做 SSE delta 协议：当前客户端契约是完整消息；去重 + 定稿缓存已解决内存问题，delta 需要序号/重放/块寻址，收益主要是带宽。
- 不做增量 Markdown 解析 / Worker 化 / 虚拟列表库：现有轮次窗口 + 锚点已够用。
- 不做数据库压缩/服务端常驻内存治理：939MB 库与 agent idle retention 是独立议题。
- 已知可感知变化：深度上翻超过上限后滚动条长度会变化（正文位置不变）；旧图片首次显示可能先出现图片占位图标，缩略图生成后替换；首次打开终端多一次本地 chunk 加载。
