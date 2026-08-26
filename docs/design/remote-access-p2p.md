# 云远程访问 P2P 隧道设计（remote-access-p2p）

> 状态：Android 侧 P0/P1/P2/P3 已落地；P2/P3 需配套 `quickforge-cloud` 中的 qf-agent 与云信令更新
> 范围：Android 原生层（`RemoteTunnel` 插件 + 前台服务）、前端远程客户端（WebView 隧道页）、本机服务端隧道信任
> 引用：`src/lib/remote-tunnel.ts` 头注释引用本文档 **§3.1/§3.2**（插件方法契约与状态事件契约，勿改语义）；`android/app/build.gradle` 引用原生层报告说明
> 平台：qf-agent 二进制当前不随 npm/runtime/offline/桌面包分发（包体裁剪临时下线，可用 `QUICKFORGE_QF_AGENT_PATH` 指定外部二进制）；历史支持矩阵为 `win32-x64`、`darwin-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`，这些主机可注册为远程访问设备，不代表跨主机远程执行 AI 工具（模型推理仍由被访问主机上的 QuickForge 本机执行）

---

## 1. 背景与目标

手机（Android 壳）远程访问本机 QuickForge：手机 WebView 通过本地隧道加载远端 QuickForge 页面，数据经 云信令（WebSocket 建联）+ WebRTC DataChannel（数据传输）穿透 NAT，隧道在本机落地为 `127.0.0.1:18080` 的本地 HTTP 服务。

```text
┌──────────────┐  信令 WS /ws/signal    ┌─────────────┐  与 qf-agent 同机回环   ┌──────────────┐
│ Android WebView│ ◄──────────────────► │ 云信令服务    │ ◄────────────────────► │  QuickForge   │
│ 127.0.0.1:18080│   WebRTC DataChannel  │ (外部，负责   │   X-QuickForge-Tunnel: 1│  本机服务(agent)│
│ ?quickforgeRemote=1 │ ◄──────────────► │ 信令转发/配对)│      Host: 127.0.0.1:18080│              │
└──────────────┘                        └─────────────┘                        └──────────────┘
```

- 手机侧只依赖云 API（`/oauth/token`、`/v1/remote/devices`、`/v1/remote/turn-credentials`）与信令 WS；不直接访问主机局域网地址。
- 隧道建立后，WebView 导航到 `http://127.0.0.1:18080/?quickforgeRemote=1`；页面用 `quickforgeRemote=1` 参数识别“云远程客户端”模式（`isCloudTunnelClient`）。
- 本机服务端只信任满足“回环来源 + `X-QuickForge-Tunnel: 1` + `Host: 127.0.0.1:18080`”的请求为可信隧道客户端；其余远端来源仍需局域网访问认证。

---

## 2. 总体架构与模块

### 2.1 模块划分

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 原生插件 | `android/.../remote/RemoteTunnel.kt` | Capacitor 插件：参数校验、令牌存取、事件转发 |
| 原生服务 | `android/.../remote/RemoteTunnelService.kt` | 前台服务：信令 WS + WebRTC + 本地 TCP 18080 桥接、状态机、重连 |
| 云 API | `android/.../remote/CloudApi.kt` / `CloudAccountStore.kt` | 云 REST 客户端；refreshToken Keystore 加密落盘、accessToken 仅内存 |
| 信令 | `android/.../remote/SignalClient.kt` | okhttp WebSocket 客户端与 `SignalMessage` 编解码 |
| 帧协议 | `android/.../remote/TunnelFrames.kt` | DataChannel 帧编解码（与 Go 端 `internal/remote/protocol/frames.go` 一致） |
| 背压 | `android/.../remote/BackpressureGate.kt` | `bufferedAmount` 高/低水位门（纯逻辑，可 JVM 单测） |
| 信令退避 | `android/.../remote/SignalReconnectBackoff.kt` | 信令重挂 1/2/4/8 秒封顶策略（纯逻辑，可 JVM 单测） |
| 前端契约 | `src/lib/remote-tunnel.ts` | JS 侧插件类型与接口（契约见 §3） |
| 前端覆盖层 | `src/components/mobile/RemoteTunnelOverlay.tsx` | 断线提示/重试/返回设备列表；驱动恢复流程 |
| 前端恢复 | `src/lib/tunnel-recovery.ts` | probe + 对账 + `quickforge:tunnel-recovered` 事件 + reload 兜底 |
| 前端对账 | `src/App.tsx` | 监听恢复事件，对所有 `ServerAgent` `syncState` + `refreshSessions` |
| 服务端信任 | `server/index.mjs` | 隧道请求识别（回环 + 头 + Host 校验）、按远程请求裁剪本地能力 |

### 2.2 线程模型（Android 服务）

- `qf-tunnel-control`：控制面串行化（connect/disconnect/信令回调/重连），状态机唯一执行点。
- `qf-tunnel-dc-writer`：DataChannel 发送串行化，多流复用单通道，帧必须整帧原子发送。
- `qf-tunnel-socket`：cached 线程池，每条 TCP 连接一个读循环。
- `qf-tunnel-ping`：心跳与退避重连/ICE 恢复定时器。
- 状态快照（`currentState`/`currentError`）为 `@Volatile` 静态量，`setState` 是状态迁移唯一入口，经主线程 Handler 通知插件。

---

## 3. 原生插件与状态事件契约

> `src/lib/remote-tunnel.ts` 头注释引用本节；**修改插件契约需同步更新本文件与 `RemoteTunnel.kt` 类头注释**。

### 3.1 原生插件方法契约（JS ↔ Capacitor ↔ Kotlin）

插件名 `RemoteTunnel`，所有方法返回 Promise；插件层只做参数校验、令牌存取与事件转发，实际逻辑在前台服务。

| 方法 | 参数 | 返回 | 语义 |
| --- | --- | --- | --- |
| `setToken` | `{accessToken, refreshToken, cloudUrl, email?}` | `void` | 保存云账户令牌并唤醒前台服务。三者必填，`email` 可空（账号邮箱，明文持久化，供登录界面展示）。accessToken 仅进程内存；refreshToken 经 Android Keystore（AES/GCM，随机 IV）加密落盘；cloudUrl/email 明文 |
| `hasSession` | — | `{signedIn, email?, cloudUrl?}` | 是否持有可用会话（Keystore 有 refreshToken 或内存有 accessToken）。`email`/`cloudUrl` 为 null 时不返回该字段，避免序列化出 `"null"` 字符串 |
| `signOut` | — | `void` | 清除会话（Keystore + 内存 + 明文字段），置 `idle`，发 `ACTION_STOP` 停止服务 |
| `listDevices` | — | `{items:[{installationId, name, online, services}]}` | 拉取本账号在线 agent 设备（`GET /v1/remote/devices`）。`auth_expired` / `network_error` 错误码 |
| `connect` | `{installationId}` | `void` | 指定目标设备建立隧道（`ACTION_CONNECT`） |
| `disconnect` | — | `void` | 拆除隧道，服务保持常驻（`ACTION_DISCONNECT`，不再自动重连） |
| `retry` | — | `void` | 立即触发一次重连，沿用原生层保存的目标设备（`ACTION_RETRY`） |
| `getState` | — | `{state, error?}` | 读取静态状态快照 |

错误码（`call.reject`）：参数错误直接 reject；`listDevices` 区分 `auth_expired`（需重新登录）与 `network_error`（网络/服务端异常）。

### 3.2 状态事件契约（`remoteStateChanged`）

事件 `remoteStateChanged`，负载 `{state, error?}`。`state` 取值固定为：

| 值 | 语义 |
| --- | --- |
| `idle` | 未连接 / 用户主动断开（`disconnect`、`signOut`），**不再自动重连** |
| `connecting` | 正在建立连接（信令 → ICE → DataChannel） |
| `connected` | 连接成功，本地 TCP 18080 已监听 |
| `reconnecting` | 断线后原生层自动指数退避重连中，`error` 携带断线原因 |
| `error` | 不可恢复错误（如登录已过期、WebRTC 初始化失败），需用户操作（重新登录/重试） |

要点：

- `setState` 为状态迁移唯一入口；事件经主线程回调插件再 `notifyListeners` 转发 JS。
- 断线判定来源：信令 WS 关闭/失败、信令心跳超时（10s ping，2× 间隔未收 pong）、ICE `FAILED`、ICE `DISCONNECTED` 15s 未恢复、DataChannel `CLOSED`、对端 `close` 信令。
- 自动重连仅在 `reconnectEnabled` 且目标设备未清时生效；成功连接后重置退避计数。
- 服务被系统重建（`START_STICKY`）且此前处于自动重连状态时，从 SharedPreferences 恢复目标设备继续重连。

---

## 4. 隧道数据面协议

### 4.1 WebRTC 与信令

- 信令地址：`https://` → `wss://`，`http://` → `ws://`，路径 `/ws/signal`；握手 `Authorization: Bearer <accessToken>`。
- 连接时序：WS 打开 → 发 `hello` → 云侧下发/交换 ICE → 创建 `PeerConnection`（ICE server 来自 `POST /v1/remote/turn-credentials`，支持 `turn:`/`stun:` URL）→ 手机端主动 `createDataChannel("qf-tunnel")` → 创建并发送 `offer`（带 `sessionId`、`installationId`）。
- 信令消息（JSON，字段与 Go `protocol.Message` 一致，未用字段省略）：
  - 上行：`hello`、`offer{sessionId, installationId, sdp}`、`candidate{sessionId, candidate{sdp, sdpMid, sdpMLineIndex}}`、`ping`、`pong`。
  - 下行：`answer{sessionId, sdp}`、`candidate{...}`、`ping`、`pong`、`close{reason}`。
  - 校验：非当前代际或 `sessionId` 不匹配的消息直接忽略；未知类型仅告警日志。
- 手机端主动创建 DataChannel，对端不下发通道（`onDataChannel` 无远程通道）。

### 4.2 DataChannel 帧格式（与 Go `frames.go` 一致）

```text
byte 0        : type    1=OPEN  2=DATA  3=CLOSE  4=ERROR
byte 1-2      : streamID（BE uint16，1..0xFFFF）
byte 3-4      : length  （BE uint16，仅 DATA 携带 payload）
payload(OPEN) : serviceID（1B；qf-web=1）
payload(DATA) : 原始字节（≤ 65535；发送侧按 16KB 分片，CHUNK_SIZE=16*1024）
```

- 流生命周期：本地 TCP accept 后分配 streamID 并发送 `OPEN(qf-web)`；读循环将数据分片为 `DATA` 帧投递；EOF/异常发 `CLOSE` 并关闭本地 socket。
- 帧解码为增量解析器（单条 DataChannel 消息可能含多帧或半帧，与 Go `DecodeFrame` 语义一致）。
- 多流复用单通道：`dcWriter` 单线程 + `sendLock` 保证整帧原子发送，streamID 用于帧→socket 路由。

---

## 5. 可靠性设计（P0，已落地）

### 5.1 锁外 socket write

`handleChannelBytes` 在 `engineLock` 内仅解析帧并取出 socket 引用（`Pending` 列表），**socket write/flush 移到锁外执行**。原因：本地 TCP 对端不读数据时 write 可能长时间阻塞，若持 `engineLock` 会阻断 `teardownTunnel` 等全部需要该锁的路径；锁外写失败后安全 `closeStream`。

### 5.2 信令 await 中断

`connectSession` 中 `opened.await(WS_CONNECT_TIMEOUT_S)`（15s）捕获 `InterruptedException`：恢复中断标志、仅在代际仍有效时 `fail("信令连接被中断")` 干净收尾，防止控制线程意外死亡导致连接泄漏或误伤新一代连接。未打开即超时走 `fail("信令连接超时")`。

### 5.3 native bufferedAmount 高低水位

`BackpressureGate` 基于 `DataChannel.bufferedAmount()` 做迟滞控制：

- 高水位默认 **4MB**：超过则暂停 socket 读取（`paused=true`）。
- 低水位默认 **1MB**：降至该值以下才恢复投递。
- 双水位提供迟滞区间，避免缓冲量在单一阈值附近反复抖动导致读端频繁启停。
- 等待期间由 `onBufferedAmountChange` 或 `teardown`（置空 `dataChannel` + `notifyAll`）唤醒，另设 50ms 轮询兜底，防止丢失唤醒导致 socket 读线程长时间空等；线程中断/通道未 OPEN 立即退出读循环。

### 5.4 4MB Java executor 待发字节预算

`sendQueueBudget = Semaphore(4 * 1024 * 1024)`，按字节计 permit：`sendToChannel` 提交 `dcWriter` 前以 50ms 轮询循环获取 permit（每轮核对通道仍是捕获实例且 OPEN、线程未中断），使 **Java executor 队列的待发字节真正有界**；任务执行后（无论成败）或执行阶段异常均归还 permit，避免泄漏。注意：native `bufferedAmount` 仅用于 5.3 的水位判断，队列有界性由本预算保证（两者职责分离）。

### 5.5 心跳与重连

- WS 应用层 ping 每 10s；超过 2× 间隔未收 pong 判为断线，走自动重连。
- 指数退避 `2^(n-1)` 秒封顶 30s，附加 0~500ms 随机抖动。
- 网络恢复（`ConnectivityManager` 默认网络回调）时若处于退避状态立即重连（跳过等待）。
- ICE `DISCONNECTED` 后 15s 恢复窗口（`ICE_RECOVERY_TIMEOUT_MS`），恢复（`CONNECTED`）即取消定时器。
- 断线统一走 `teardownTunnel`（幂等）：关闭信令/PeerConnection/DataChannel、清理本地 socket 与帧解码器、唤醒背压等待线程；保留目标设备则调度退避并以 `reconnecting` 上报原因。

---

## 6. 断线免刷新恢复（P1，已落地）

目标：断线重连成功后优先“免刷新”恢复远程界面，仅在对账失败时整页刷新兜底。流程在 `RemoteTunnelOverlay`（probe 注入）+ `tunnel-recovery`（协调器）+ `App.tsx`（应用层对账）三层协作。

### 6.1 触发与 probe

- 覆盖层仅在云远程客户端模式（`http://127.0.0.1:18080/?quickforgeRemote=1`）渲染。
- 本次会话内出现过非 `connected` 状态后收到 `connected` 事件，或回前台时 `getState()==connected`，触发恢复。
- probe：`fetch('http://127.0.0.1:18080/', { mode: 'no-cors' })`，3s 超时，最多 3 次、间隔 700ms；probe 未就绪返回 `deferred(probe-failed)`，保持覆盖层等待下一次状态事件，不刷新。

### 6.2 对账（`/api/health` + `/api/agents`）

`recoverTunnelConnection` 协调器（module 级防重入锁，同一时刻只允许一路恢复）：

1. `GET /api/health` 返回 200（服务可用）。
2. `GET /api/agents` 返回 200 且 `body.sessions` 为数组（运行任务状态可读）。
3. 对账失败最多重试一次（间隔 700ms）；单请求超时 3s。

### 6.3 恢复事件与 waitUntil

对账通过后按序派发标准 `online` 事件与自定义 `quickforge:tunnel-recovered` 事件：

```ts
type TunnelRecoveredEventDetail = {
  at: number
  waitUntil: (task: Promise<unknown>) => void  // 监听者必须在事件回调内同步调用
}
```

- 协调器等待全部 `waitUntil` 任务完成才判定免刷新恢复成功（`recovered`）。
- 无监听者注册任务 / 任一任务 reject / 超过 5s（`recoveryWaitTimeoutMs`）视为通知未完成。

### 6.4 应用层对账（App.tsx）

监听 `quickforge:tunnel-recovered`，回调内同步注册 `waitUntil` 任务：

1. 收集当前会话 Agent 与 `taskMapRef` 中全部后台任务里属于 `ServerAgent` 的实例（去重集合）。
2. 对每个 Agent 先显式验证 `GET /api/agents/:id/state`（非 200 即 throw，令 waitUntil reject 触发 reload），再调 `agent.syncState()`（内部 `refreshStateFromServer` 拉取权威状态）。
3. 全部成功后 `await refreshSessions({ broadcast: true })` 刷新侧边栏会话列表。

### 6.5 失败/超时兜底

对账始终失败、事件派发抛错、无监听者、任一对账任务失败或超时 → 协调器调用 `window.location.reload()` 整页刷新，保证全站一致；覆盖层在 `deferred` 状态保持等待。

---

## 7. P2/P3 连接保持（已落地）

P2/P3 复用现有信令消息格式，不增加旧客户端无法识别的必填字段：同一 `sessionId` 的第二次 `offer` 表示 WebRTC 重协商/ICE restart；同一账号、同一 installation 的信令连接在宽限期内重新 `hello` 时，云端自动重绑现有 session。

### 7.1 P2：ICE restart

- Android 在 ICE `DISCONNECTED` 后等待 2 秒，或在 ICE `FAILED`、默认网络切换后发起 `PeerConnection.restartIce()`。
- restart 复用现有 PeerConnection、DataChannel、本地 18080 server 与 TCP streams，并使用同一个 `sessionId` 发送新 `offer`。
- qf-agent 对同 session 的第二次 offer 在原 PeerConnection 上执行 `SetRemoteDescription → CreateAnswer → SetLocalDescription`，保留已有 DataChannel/Forwarder。
- 云信令识别同一客户端到同一 agent 的重复 offer，仅刷新会话活动时间并转发，不重复占用并发额度、不覆盖会话、不重复插入审计记录；其他连接冒用同 session 会收到 `session_conflict`。
- Android 等待 ICE 恢复最多 10 秒；失败、对端拒绝或旧 Agent 返回 `close` 时，自动回退原有 teardown + 指数退避全量重连。
- qf-agent 对 `DISCONNECTED` 提供 30 秒宽限，`CONNECTED/COMPLETED` 后取消定时器；`FAILED` 仍立即关闭。

### 7.2 P3：信令连接重挂

- Android 信令 WebSocket 关闭、失败或心跳超时时，如果 DataChannel 仍为 OPEN，不立即拆除数据面，而是在 12 秒窗口内重连信令。
- 重连成功后重新发送 `hello`，云端按账号、installation 与会话角色自动把 session 重绑到新 socket；随后 Android 发起一次同 session ICE restart，校正切网后的 ICE 路径。若断线前的 restart offer 仍处于待应答状态，则直接重发该本地 offer，避免在 `HAVE_LOCAL_OFFER` 状态重复创建 offer。
- 云端信令断开后保留 session 30 秒；在宽限期内 Android 或 qf-agent 以同 installation 重连即可恢复路由，超时才关闭会话并通知仍在线的另一端。
- qf-agent 每次信令重连成功后调用 `PeerManager.UpdateSend`，将全部活跃 PeerSession 的 candidate/answer/close 发送回调切换到新 socket。
- Android 对旧 socket 的迟到 `onClosed/onFailure` 使用连接实例校验，避免误伤已经恢复的新信令连接。

### 7.3 兼容与后续预留

| 项目 | 当前状态 |
| --- | --- |
| 旧 Android + 新云端/Agent | 保持原有全量重连流程；无需新消息字段 |
| 新 Android + 旧 Agent | ICE restart 的重复 offer 可能被拒绝；Android 收到 close 或超时后自动全量重连 |
| `negotiationId` | 尚未引入；当前使用 generation + sessionId + control 单线程避免本端竞态 |
| DataChannel ping/pong | 尚未实现；当前仍使用信令心跳与 WebRTC ICE/DataChannel 状态判断半开连接 |
| 显式 capabilities 协商 | 尚未实现；本轮依靠失败回退保持兼容，后续可增加可选能力字段优化灰度控制 |

---

## 8. 安全 / 兼容 / 测试矩阵

### 8.1 安全

| 项 | 机制 |
| --- | --- |
| 服务端隧道信任 | 仅“回环来源 + `X-QuickForge-Tunnel: 1` + `Host: 127.0.0.1:18080`”视为可信隧道客户端；`localhost:18080` 即使带头也拒绝（集成测试覆盖） |
| 远程能力裁剪 | 隧道请求视为“已认证远程客户端”，`/api/health` 按请求返回 `isLocalRequest` 与 `capabilities`，终端/重启/打开本机应用等本地能力关闭 |
| 凭据 | accessToken 仅进程内存，不落盘；refreshToken 用 Android Keystore AES/GCM（随机 IV）加密；cloudUrl/email 明文（非敏感） |
| 本地端口 | TCP server 仅绑定 `127.0.0.1:18080`（`InetAddress.getByName("127.0.0.1")`） |
| 云侧认证 | 云 API 401 自动换 token 重试一次；refreshToken 失效即清会话并提示重新登录；`refreshAccessToken` 加锁防并发刷新触发云侧重用检测 |

### 8.2 兼容

| 项 | 说明 |
| --- | --- |
| WebRTC 依赖 | `io.github.webrtc-sdk:android`（Maven Central，`org.webrtc` 官方 API）；`org.webrtc:google-webrtc` 已从中央仓库下线，勿回退 |
| 旧会话 | `hasSession` 的 `email` 可为 null（旧客户端未存邮箱），前端需容忍缺失 |
| 远程客户端识别 | 隧道模式 hostname 为 `127.0.0.1`，必须用 `quickforgeRemote=1` 显式标记，否则误判为本机 |
| 开发模式 | 服务端 CORS 处理保留 Vite 代理直连；隧道 Host 校验不影响本机/局域网正常访问 |
| 前端降级 | 原生插件不可用（Web 预览等）时覆盖层静默不渲染 |

### 8.3 测试矩阵

| 层 | 位置 | 覆盖 |
| --- | --- | --- |
| JVM 单测 | `BackpressureGate` / `SignalReconnectBackoff`（纯逻辑，无 Android 依赖） | 高低水位迟滞、非法水位参数；信令重挂立即重试与 1/2/4/8 秒封顶退避 |
| 前端单测 | `tests/frontend/tunnel-recovery.test.ts` | probe 未就绪 deferred；对账失败重试一次；waitUntil 全部成功/任一 reject/超时；无监听者 reload；事件派发抛错；防重入 |
| 服务端集成 | `tests/server/index.tunnel-host.integration.test.mjs` | 127.0.0.1:18080 + 隧道头可信；`localhost:18080` 拒绝；`/api/health` 隧道可达 |
| 原生链路 | 手动/真机（Android 壳 + 云信令 + qf-agent） | 登录→设备列表→connect→18080 加载→断网重连→免刷新恢复 |

---

## 9. 相关文件索引

- 原生：`android/app/src/main/java/com/quickforge/mobile/remote/`（RemoteTunnel.kt / RemoteTunnelService.kt / SignalClient.kt / CloudApi.kt / CloudAccountStore.kt / TunnelFrames.kt / BackpressureGate.kt / SignalReconnectBackoff.kt）
- 前端：`src/lib/remote-tunnel.ts`、`src/components/mobile/RemoteTunnelOverlay.tsx`、`src/lib/tunnel-recovery.ts`、`src/App.tsx`、`src/lib/mobile-server.ts`
- 服务端：`server/index.mjs`（隧道信任 + `/api/health`）、`server/routes/agent.mjs`（`/api/agents`）
- 配置：`capacitor.config.ts`（allowNavigation / cleartext）、`android/app/build.gradle`（WebRTC/okhttp 依赖）
