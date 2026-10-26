# Progress

按时间倒序追加。每个 feature 一段，完成后在此留档。

## <feature-id>（<status>，<YYYY-MM-DD>）

- Goal：
- 结论（一句话）：
- 改动文件：
  1.
- 验证 / Evidence：
- Notes：

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
