# Progress

按时间倒序追加。每个 feature 一段，完成后在此留档。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Goal：
- 结论（一句话）：
- 改动文件：
  1.
- 验证 / Evidence：
- Notes：

## models-providers-layered-settings（done，2026-10-26）

- Goal：按 `docs/design/models-providers-settings-redesign.html` 设计稿，把「模型与提供商」设置页从「一个表单管理全部配置」重构为分层设计：提供商列表 / 连接 / 模型三层各自保存。
- 结论（一句话）：`CustomProvidersSettingsTab` 拆为编排器 + `settings/custom-providers/` 三层子组件（列表+预设弹层 / 连接（密钥独立保存、提供商级测试）/ 模型（行内独立保存、可见性即时写回、模型级测试、服务器拉取）），存储结构不变，新增服务端 provider-test / provider-discover 两个接口。
- 改动文件：
  1. `src/components/settings/tabs/CustomProvidersSettingsTab.tsx` — 重写为编排器：providers/draft/选中态、L2 保存（改名迁移密钥 + 重建模型 headers/协议/baseUrl）、密钥独立保存、L3 读-改-写单提供商、provider-test / provider-discover / 模型级 test-connection 调用、active 生命周期与 `customProvider` 深链选中契约保持。
  2. `src/components/settings/custom-providers/`（新增目录）— `shared.ts`（预设、buildModel、草稿转换）、`provider-list-pane.tsx`（L1 + 添加预设弹层）、`provider-detail-pane.tsx`（头部 + 删除菜单）、`connection-section.tsx`（L2，含 `qf-provider-api-key` 密码字段契约）、`model-list-section.tsx`（L3 行内编辑）。
  3. `src/styles/settings/custom-providers.css`（新增）+ `src/styles/index.css` 挂载 — 主从布局、密钥行、脏标记条、模型行、窄屏抽屉（<768px 详情覆盖列表 + backdrop）。
  4. `server/routes/models.mjs`（68→144 行）+ `server/index.mjs` — 新增 `POST /api/models/provider-test`（GET baseUrl/models 探测，不依赖模型，OpenAI/Anthropic 两种鉴权）与 `POST /api/models/provider-discover`（返回模型 ID 列表）。
  5. `src/lib/i18n.ts` — en/zh 成对新增 40 个分层文案 key，删除 7 个弃用 key（editCustomModel / addCustomModel / presets / presetCustom / providerAdvanced / atLeastOneModel / noCustomModels / customHeadersHelp）。
  6. `tests/frontend/custom-providers-tab.test.ts`（新增，13 用例）+ `tests/frontend/settings-workspace-react.test.ts`（密码字段契约路径改指 connection-section.tsx）。
  7. `docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`、`docs/wiki/server/routes/README.md` 同步；`feature_list.json`、`session-handoff.md` 记录。
- 验证 / Evidence：`npx vitest run tests/frontend/custom-providers-tab.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/css-architecture.test.ts tests/frontend/i18n-language-snapshot.test.ts` 全过；`npm run test` 399 files / 4684 tests 全过（31 个 `Cannot find package 'jsdom'` Unhandled Error 为存量环境缺失，jsdom 已声明未安装）；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。

- Notes（同日视觉打磨）：协议分段控件整行铺满、等分两段、`white-space: nowrap` 根除换行，字号 0.9375rem→0.8125rem、总高收到 2.25rem 与输入框对齐；协议独占连接网格整行（名称/Base URL 两列）；密钥行改「标题行/说明行/编辑行」三段纵排，标题与操作按钮同行对齐；模型行能力徽标取消 `.quickforge-settings-meta` 默认 margin-top（原先把 chips 顶歪 8px）并加 min-height 统一行高；模型 ID 0.78125→0.8125rem、规格 0.65625→0.6875rem 统一字号刻度；列表/详情头部协议徽标改短标签（OpenAI / Anthropic，`protocolShortLabel`），列表 meta 合并为单行。tsc / eslint / 18 目标用例 / `npm run build` 全过。
- Notes：存储仍为 `custom-providers` + `provider-keys`（密钥按提供商名）；连接层保存语义 = 读-改-写整个提供商（协议/请求头下发到全部模型）并迁移改名密钥，密钥独立保存只写两个存储不触碰模型；草稿提供商（预设创建）在本地保存连接时落库。`customProviders` 深链从「打开编辑表单」改为「选中列表项」。工作区有并行会话（ask-user-echo-fix）在同文件 `src/lib/i18n.ts` 作业，本次 i18n 改动均为 provider 区块内成对增删，无交叉。

## ask-user-echo-fix（done，2026-10-26）

- Goal：修复 ask_user 工具「最后补充的问题/内容不回显」——回执行把选项与自定义补充合并成一行裸文本、跳过态丢失补充信息、待答卡无「已填写」指示、中文输入法 Enter 被当作下一问。
- 结论（一句话）：回执改为「选项 chip + 独立补充段」两段语义，跳过/超时（`answers: null`）也渲染回执并保留 `remark`，待答卡补充框显示已填写徽标并预展开，Enter 增加 IME 守卫。
- 改动文件：
  1. `src/components/chat/panel-decoration/ask-user-card.ts`（新增 `splitAskAnswer` / `renderReviewAnswer`、已填写徽标与预展开、`e.isComposing` 守卫）
  2. `src/lib/tool-renderers/ask-user-tool-renderer.tsx`（容忍 `answers: null`、`reviewRemark` 不再排除 skipped、分段渲染）
  3. `src/styles/chat/interaction-cards.css`（answer 分段与跳过态样式）
  4. `src/lib/i18n.ts`（新增 `askUserExtraLabel` / `askUserNoChoiceLabel` / `askUserFilledHint`，en + zh）
  5. `tests/frontend/ask-user-card.test.ts`、`tests/frontend/ask-user-renderer-remark.test.ts`
  6. `docs/design/ask-user-echo-fix.html`（方案设计稿）
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/lib/README.md`、`docs/wiki/src/styles/README.md`
- 验证 / Evidence：`npx vitest run tests/frontend/ask-user-card.test.ts tests/frontend/ask-user-renderer-remark.test.ts` → 36 passed（28 + 8）；ask_user 回归面（含 server 侧 4 个测试文件）6 files / 103 tests passed；`npm run lint` 0 error / 4 既有 warning；`npm run build` 成功。
- Notes：验证期间工作区存在并行的 CustomProviders 重构（`src/components/settings/custom-providers/`、`server/routes/models.mjs` 等），曾导致 build/test 瞬时失败；延时等待确认收敛后重新验证通过。提交时按文件隔离，`src/lib/i18n.ts` 只暂存 ask_user 相关的 2 个 hunk。`buildAskAnswerText` 死代码已随本次清理删除（回执与历史回显统一走 `splitAskAnswer`）。

## skills-settings-redesign（done，2026-10-26）

- Goal：重构设置页「技能」列表，让技能可扫、可筛选、可批量管理；最终交互按用户反馈定为「点击行打开居中详情弹窗」，不再使用右侧常驻详情栏。
- 结论（一句话）：`SkillsManagerPanel` 已重写为全宽筛选/来源分组列表 + 详情弹窗，保留 `/api/skills`、`/api/skills/content` 与全局/项目保存语义；宽窄屏、明暗主题与批量撤销均实机验证通过。
- 改动文件：
  1. `src/components/skills-dialog.tsx` — 重写技能管理面板：关键字/来源/状态筛选，按内置、个人（项目范围显示为项目）、插件分组；单行开关、筛选结果批量启用/停用与撤销 toast；重新扫描、搜索路径浮层与复制；点击行通过 portal 打开居中详情弹窗（概览/指令/元数据），`SKILL.md` 按需加载并以 markdown 渲染；保留串行保存队列、乐观更新、失败回滚和项目级 `SkillsDialog` 外壳。
  2. `src/styles/settings/skills.css`（新增）— 技能页布局、筛选工具条、分组吸顶头、行/开关、详情弹窗、markdown、toast、窄屏回退与 reduced-motion。
  3. `src/styles/index.css` — 在设置样式中登记 `skills.css`。
  4. `src/styles/settings/shell.css` — 新增 `quickforge-settings-stack-wide`（72rem），供列表型设置页使用。
  5. `src/lib/react-settings-tabs.tsx` — `SettingsPanel` 支持 `wide`，仅 Skills tab 启用；引入 `cn`。
  6. `src/lib/i18n.ts` — en/zh 同步新增技能页文案（筛选、批量、详情弹窗、元数据、搜索路径等），移除不再使用的详情占位文案。
  7. `docs/wiki/src/components/README.md`、`docs/wiki/src/styles/README.md` — 同步技能面板能力与新增样式模块。
  8. `docs/design/skills-settings-redesign.html` — 标注落地版将右侧详情改为点击行后的居中弹窗。
  9. `feature_list.json`、`progress.md`、`session-handoff.md` — 记录本 feature 状态、验证与交接。
- 验证 / Evidence：
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.32s）。
  - `npx eslint src/components/skills-dialog.tsx src/lib/react-settings-tabs.tsx` → 无输出（0 error）。
  - `npm run lint` → 0 errors / 4 既有 warnings（`coverage/` 生成目录 3 个 unused disable + `usePinnedSummaryCapsule.tsx` exhaustive-deps，与本次无关）。
  - `npx vitest run tests/frontend/css-architecture.test.ts tests/frontend/motion-design.test.ts tests/frontend/settings-workspace-react.test.ts tests/frontend/decorator-copy-i18n.test.ts` → 4 files / 43 tests passed。
  - `npm run test` → 398 个可运行测试文件全部通过（4664 passed / 1 skipped）；进程退出码为 1，原因是 31 个标注 `@vitest-environment jsdom` 的测试文件无法启动 fork worker：`Cannot find package 'jsdom'`。`jsdom` 已在 `package.json` devDependencies 中声明，但当前 `node_modules/jsdom` 未安装，属于环境缺失，与本次改动无关；未新增/升级依赖。
  - 实机视觉验证：使用隔离 `QUICKFORGE_DATA_DIR`/`QUICKFORGE_WORKSPACE_DIR` 启动 dev server，Headless Chrome 在 1440×900 与 900×900 下检查明/暗主题。页面宽度分别为 832px / 587px；详情弹窗 605px 宽、聚焦容器无多余 focus ring；筛选、来源菜单、指令 markdown、元数据、批量启用（1/4 → 4/4）与撤销（回到 1/4）均正常，浏览器控制台无错误。
- Notes：
  - 验证使用的示例技能只写入临时数据目录，没有触碰真实用户技能与配置；未创建 Git commit / tag / push，未手工修改 `dist/`、`package-dist/`、`package-offline/`（`npm run build` 正常生成 `dist/`）。
  - 详情弹窗通过 `createPortal(document.body)` 渲染，避免项目级 `SkillsDialog` 的 `overflow-hidden` 与动画 transform 裁剪；关闭由 ESC、关闭按钮或点击遮罩触发。
  - 打开弹窗后焦点落在对话框容器（`tabIndex=-1`），Tab 可进入开关/标签页/操作按钮；未额外实现焦点陷阱。
  - 全量测试的 jsdom 缺失若需修复，应安装既有 devDependency（如 `npm install`），本次按“不新增/升级依赖”约束未处理。

## default-context-window-1m（done，2026-10-26）

- Goal：把 QuickForge 默认模型配置的上下文窗口从 200000 改为 1000000（1M）。只改默认值，不动 `modelId`，不加设置项，不重构无关代码。
- 结论（一句话）：`DEFAULT_CONNECTION.contextWindow` 由 `200000` 改为 `1000000`，所有回退点（`buildConnectionModel`、`CustomProvidersSettingsTab` 的模型表单默认/回退/保存归一化）自动跟随该常量，`maxTokens` 保持 `32768` 不变。
- 改动文件：
  1. `src/lib/pi-chat.ts` — `DEFAULT_CONNECTION.contextWindow: 200000 → 1000000`（单行 diff）。
  2. `progress.md` — 本条记录。
  3. `session-handoff.md` — 同步本次会话目标/改动/验证。
- 验证 / Evidence：
  - `npx vitest run tests/frontend/settings-workspace-react.test.ts tests/frontend/side-chat-agent.test.ts tests/frontend/context-usage.test.ts` → 3 files / 36 tests passed。
  - `npm run lint` → 0 errors / 4 warnings（3 个 `coverage/` 生成目录 Unused eslint-disable + 1 个既有 `usePinnedSummaryCapsule.tsx` exhaustive-deps，均与本次改动无关）。
  - `npm run build` → 成功（`tsc -b && vite build`，built in 3.66s）。
- Notes：
  - 全仓库 `200000` / `200_000` grep 结论：无任何测试断言“默认值本身”，命中的都是无关常量或测试内联值，未做改动——`src/lib/auto-compact-settings.ts:48`（自动压缩 `minSourceChars` 上限）、`server/auto-compaction.mjs:44,237`（同上限 clamp）、`src/components/workspace/side-chat-agent.ts:9` + `server/routes/side-chat.mjs:12` + `server/routes/workspace-browser-service.mjs:30`（侧聊/搜索字符预算与行数护栏）、`tests/frontend/side-chat-agent.test.ts:16`（测试内联 `contextWindow: 100_000`）、`tests/frontend/settings-workspace-react.test.ts:21`（`DEFAULT_CONNECTION` 为 mock，`contextWindow: 128000`，与真实常量解耦）。`dist/`、`package-dist/`、`package-offline/`、`coverage/` 内的同名命中属生成产物，按约束未触碰。
  - `src/lib/i18n.ts` 只有 `contextWindow: 'Context Window'` 标签文案（en/zh 两处），没有写死 `200000` 或 “200K” 的表述，因此未改。
  - 遗留风险（未修改，仅记录）：`server/conversation-compaction.mjs:203-206` 的压缩 transcript 上限为 `Math.min(160000, Math.max(12000, Math.floor(contextWindow * 1.6)))`，即使 `contextWindow` 提升到 1M 也被 160000 字符硬顶，长会话压缩摘要的输入广度不会随 1M 窗口放大；另外 `maxTokens` 仍为 32768，1M 窗口下单次输出上限不变（本次按最小改动原则不动）。
  - 未创建 Git commit，未触碰 `dist/`、`package-dist/`、`package-offline/`；`feature_list.json` 当前为空（`{"features":[]}`），无对应 feature 条目，未改动。
