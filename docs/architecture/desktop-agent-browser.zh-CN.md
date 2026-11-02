# 桌面端内嵌 AI 浏览器架构

> 状态：已实施（桌面端）。Web / CLI / Android 不受影响，也不具备该能力。
>
> 目标：让 Agent 在用户看得见的应用内嵌浏览器里操作真实网页，同时不改变现有交互与体验。

## 1. 为什么不是 Playwright MCP

内置的 playwright MCP 预设会自己拉起一个 Chrome：用户看不见、不共享应用上下文，还要额外下载浏览器。
桌面端自带 Chromium，用 WebContentsView 把页面挂在应用自己的右侧面板里，可以同时满足三件事：看得见、零额外下载、与主窗口 cookie 隔离的会话。

## 2. 进程与职责

```
Electron 主进程
├── BrowserHost      唯一 WebContentsView + 唯一 CDP 连接 + 导航/权限策略
│   └── CdpClient    attach/detach、命令超时、事件桥
│       └── PageActions  导航 / 快照 / 点击 / 输入 / 滚动 / 等待 / 截图 / 求值
└── MCP server      127.0.0.1:0 + Bearer token（无状态，每请求一个 transport）
        ▲
        │ MCP over HTTP（复用 server 现有的 StreamableHTTPClientTransport）
        │
QuickForge server 子进程   工具定义 / 审批 / SSE 事件（工具层零改动）
        ▲
        │ SSE
React 渲染进程            只有一块占位区域 + 只读状态栏
```

视图只能在主进程创建，工具只能在 server 子进程执行，所以两者之间必须有一条通道。
这里选择在主进程内跑 MCP server 而不是自建 IPC 协议：工具命名、白名单、审批、事件流、工具集刷新全部复用既有实现，新增代码只落在浏览器能力本身。

## 3. 环境注入顺序

1. 主进程先起 MCP server，拿到随机端口与一次性 token；
2. 把 QUICKFORGE_DESKTOP_BROWSER_URL / QUICKFORGE_DESKTOP_BROWSER_TOKEN 写入 process.env；
3. startQuickForge() 通过 buildEnv() 继承这两个变量，子进程据此把 desktop-browser 注册成内置 MCP server；
4. 窗口创建后 BrowserHost.attachWindow()，视图按首次使用懒创建。

内置项的权威来源是运行环境而不是配置文件：每次 readMcpServers() 都按当前 env 重建（端口与 token 每次启动都不同）；env 不存在时连同历史遗留项一起剔除，UI 不会留僵尸条目；落盘时剥掉 env（token 只存在进程内存里），只保留 enabled 开关；不允许通过设置接口删除或改写（409）。

## 4. 引用（ref）与世代

模型不写 CSS 选择器，只操作快照里的引用：

```
- heading - Sign in [ref=e1@g3]
- textbox - Search [ref=e2@g3]
- button - Submit [ref=e3@g3]
```

- 引用格式 e{编号}@{世代}；只有带 backendDOMNodeId 的节点才占号，编号稠密。
- 任何主 frame 导航或 Runtime.executionContextsCleared 都会让 generation 加一并清空引用表。
- 世代不匹配时直接返回引用已过期、请重新快照，不做尽力而为的解析：旧引用若被解析到新页面的同位置节点，就是静默点错，比报错难查得多。
- 点击链路：DOM.scrollIntoViewIfNeeded → DOM.getContentQuads → 取四边形中心 → mouseMoved / mousePressed / mouseReleased。拿不到布局盒时明确报元素不可见，绝不猜坐标。

## 5. 安全边界

内嵌浏览器能让页面带着自己的 cookie 访问任意地址，也就能被诱导去访问本机服务，因此策略默认拒绝：

| 面 | 策略 |
|---|---|
| 会话隔离 | 独立 persist:quickforge-agent-browser 分区，与主窗口 cookie 完全隔离 |
| 导航 | 仅 http(s)；localhost、*.localhost、回环、私网、链路本地、CGNAT、IPv4-mapped IPv6 一律拒绝并返回可读原因 |
| 页面内跳转 | will-navigate 同样过策略；setWindowOpenHandler 一律 deny |
| 权限 | setPermissionRequestHandler 与 setPermissionCheckHandler 全拒；setDisplayMediaRequestHandler 拒绝 |
| 下载 | will-download 直接 preventDefault() |
| 渲染进程 | sandbox: true、contextIsolation: true、nodeIntegration: false、无 preload、webSecurity 保持开启 |
| 渲染进程桥 | 只暴露 isAvailable / getState / setBounds / setVisible / onStateChange，且校验 senderFrame 必须是主窗口主 frame |
| MCP 通道 | 只听 127.0.0.1:0，强制 Authorization: Bearer 一次性 token，无状态（没有可复用的 session） |

这些不变量无法在 CI 里跑真实 Electron，已用源码契约测试锁住：tests/server/desktop-browser-wiring-contract.test.mjs。其中「唯一 CDP 控制层」是按目录扫描整个 desktop/ 断言的（只有 browser/cdp-client.mjs 允许出现 .debugger.），新增第二个调试器入口会直接让测试变红。

## 6. 审批粒度

MCP 工具栏原本一律弹审批。浏览器任务是快照→点击→快照→输入的连续调用，逐次打断只会逼用户切到完全访问模式，反而更不安全。现在读取 MCP 规范的 annotations.readOnlyHint：写操作（navigate / click / type / press_key / scroll）照常逐次审批；只读工具（snapshot / screenshot / wait_for）在默认权限下自动放行；注解缺失或服务未连接时按非只读处理，宁可多问一次。不引入按域名批量授权的 UI：那会改变现有交互，收益不足以抵消复杂度。

## 7. 前端契约

- 新增 agent-browser 标签，只能由程序打开（加号菜单不变），与 subagent / workflow / goal 同类，不参与持久化。
- Agent 一旦调用 mcp__desktop-browser__*，App.tsx 把右侧面板切到该标签。
- 面板 DOM 里只有一块占位区域：真正的网页是原生层，永远盖在 DOM 之上。组件负责用 ResizeObserver 加 requestAnimationFrame 合帧上报 getBoundingClientRect()，并在卸载、切标签、窗口隐藏、设置弹窗打开时 setVisible(false)。
- 主进程对 rect 做 clamp（最小 120px，且不得超出窗口内容区），错误的矩形不会让网页盖满整个应用。

## 8. 工具集

| 工具 | 注解 | 说明 |
|---|---|---|
| navigate | 写 | 打开 URL，返回最终地址、标题、加载状态 |
| snapshot | 只读 | 无障碍树快照 + ref |
| click | 写 | 按 ref 点击 |
| type | 写 | 聚焦后插入文本，可选回车提交 |
| press_key | 写 | 单键加修饰键 |
| scroll | 写 | 视口滚动 |
| wait_for | 只读 | 等待页面出现指定文本（SPA 必用，别假设 load 即就绪） |
| screenshot | 只读 | 落盘 PNG 并返回路径（给人看，不进模型上下文） |
| evaluate | 写（destructive） | 页面内求值，永远审批 |

## 9. 明确不做

多标签页、按域名批量授权、截图 base64 回传模型、下载与上传、元素高亮浮层、跨 iframe 元素操作（快照只取主 frame，不猜）。

## 10. 手工验收（CI 覆盖不到的部分）

1. npm run desktop:dev 启动，打开设置 → MCP：应看到只读的 desktop-browser 项且状态为已连接。
2. 让 Agent 打开一个公网页面：右侧应自动切到 AI 浏览器标签，网页出现在面板区域内；缩放窗口、拖拽面板宽度时网页跟随。
3. 打开设置弹窗：网页应立即消失，关闭后恢复。
4. 让 Agent 访问 http://127.0.0.1:5177：应被策略拒绝并给出可读原因。
5. 关闭面板后再次触发浏览器工具：面板应自动重新打开。

## 11. 相关文件

- 主进程：desktop/browser/*.mjs（layout 与 ipc-contract 是可单测的纯逻辑，其余为宿主与协议层）、desktop/electron-main.mjs、desktop/electron-preload.cjs
- 服务端：server/mcp/config.mjs（内置项）、server/mcp/registry.mjs（annotations 与 isReadOnlyMcpTool）、server/agent-manager.mjs（审批）
- 前端：src/components/browser/AgentBrowserPanel.tsx、src/lib/desktop-browser-bridge.ts、src/lib/desktop-app.ts、src/App.tsx、src/components/workspace/*
- 测试：tests/server/desktop-browser-*.test.mjs（含 layout 几何，以及用替身跑的 host 单测：视图懒创建、rect 夹取、显隐与 hide/show、dispose；cdp-client 单测：attach 幂等、事件转发、命令超时与 waitForEvent 超时；ipc-contract 单测：窄桥请求形状白名单）、tests/server/mcp-desktop-browser-config.test.mjs、tests/server/mcp-desktop-browser-registry.test.mjs、tests/frontend/agent-browser-panel-contract.test.ts、tests/frontend/desktop-browser-bridge.test.ts
