# Session Handoff

- Feature: qf-agent 首次设备授权自动批准（qf-agent-first-auth-auto-approval）
- Status: **done**（针对性测试与 lint 全部通过；未创建 commit/tag/push）

## 当前目标（已达成）

电脑端存在有效云登录会话时，qf-agent 首次设备授权自动批准，无需用户手动“关闭再开启”远程访问开关；同时保持安全边界：认证远程客户端触发的云服务开关/配置变更所启动的 agent 生命周期不自动批准。

## 改动文件

- `server/cloud/auto-approval.mjs`：新增 `beginAgentAutoApprovalWithDesktopSession`（none/expired + 非 manual + 有效 desktop 会话 → 自动 arm+begin；会话检查走 runtime identity 公开状态，只读）；文件头安全边界注释更新。
- `server/cloud/qf-agent-process.mjs`：`startQfAgent` 接受并归一化 `autoApprovalPolicy`（'manual'/'auto'，默认 'auto'）记入 launchOptions；authorizing userCode 日志改经新函数处理。
- `server/routes/cloud.mjs`：远程（非本机）请求触发的 `PUT /api/cloud/config` 在 notify 传 `autoApprovalPolicy: 'manual'`；本机仍传 `{ urlChanged }`；本机 disabled→enabled 立即 arm 的旧路径不变。
- `server/index.mjs`：`applyCloudServiceConfig` 透传 `autoApprovalPolicy` 至 `startQfAgent`（server 启动恢复不传 → 默认 auto）。
- `server/cloud/service-config.mjs` + `src/lib/i18n.ts`：默认云地址/占位符改为 `https://qf.shawnstack.com/`。
- `docs/architecture/quickforge-cloud-client.zh-CN.md`：自动批准安全声明段落重写 + 默认 URL 两处。
- 测试：`tests/server/cloud/auto-approval.test.mjs`（+7）、`tests/server/cloud/qf-agent-process.test.mjs`（+3，新增 runtime mock 与意图重置）、`tests/server/routes/cloud.test.mjs`（+2）。
- 状态文件：feature_list.json（新条目 done）、progress.md、session-handoff.md。

## 新安全边界（摘要）

- 自动批准场景：本机生命周期启动的 agent（server 启动恢复、本机 URL 切换、agent 普通重启、身份失效隔离重启）在首次 authorizing 且无有效意图（none/expired）时，若本机 desktop 云会话有效（hasSession 且无 sessionServiceMismatch）→ 自动创建 10 分钟一次性意图并立即代批；本机 disabled→enabled 切换仍立即 arm。
- 不自动批准：`autoApprovalPolicy: 'manual'`（认证远程客户端触发的配置变更，含其自动重启）；本机无有效 desktop 会话；已有 armed/pending/consumed/failed 意图不重复 arm（failed 可走既有本机 retry 端点）。

## 验证结果

- vitest：auto-approval 18、qf-agent-process 28、routes/cloud 34、cloud-account-settings-page 15（目标 4 文件 95 项）；tests/server/cloud 目录 10 文件 93 项；index.tunnel-host.integration + 前端 cloud-client/cloud-i18n 16 项——全部通过。
- ESLint（9 个改动文件）：0 error / 0 warning。

## Blockers

- 无。

## Next step

- 无必须事项。可选后续（未做）：设置页 needsLocalEnable 文案可进一步区分“本机未登录云账户”与“远程触发生命周期”两种提示；发布前需按 runbook 跑全量 test/lint/build。
