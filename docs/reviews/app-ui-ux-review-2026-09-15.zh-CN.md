# QuickForge UI/UX 全面评审（2026-09-15）

> 本评审为 Goal「全面评审并优化 UI 与交互设计」的第一阶段产出。
> 方式：dev server（`npm run dev`，API 32176 + Vite 5176）+ Playwright MCP 浏览器实测，
> 结合源码定位（`src/`）。环境为真实用户数据目录（~/.quickforge，218 个会话、5 个项目、
> 2 个定时任务、36 个已归档对话）。评审只执行可取消/只读操作，未删除或修改任何用户数据。
> 截图证据：`review-01-main-desktop.png`、`review-02-main-loaded.png`、`review-03-sidebar-expanded.png`、
> `review-04-settings-general.png`、`review-05-stacked-dialogs.png`、`review-06-mobile-375.png`（工作区根目录）。

## 一、实测覆盖范围

| 区域 | 验证内容 | 结果概要 |
|---|---|---|
| 启动/加载 | splash → 工作区加载（4s 内完成），console 0 error（评审期新增 error 见 P1-4） | ✓ |
| 主界面（桌面 1280×800） | 侧栏（置顶/项目/任务分区、展开折叠）、空状态问候、composer、模型/思考等级选择、顶栏工具按钮 | ✓ 布局正常 |
| 设置页 17 tab | 实测：常规（全表单）、MCP 服务、定时任务（列表+创建表单）、备份与恢复、已归档对话、分享链接；导航搜索过滤 | ✓ 结构清晰 |
| destructive 确认弹窗 | 焦点初始位置、Tab 循环、Escape、关闭后焦点、快速双击叠加 | 发现 P0/P1 问题（下） |
| 移动视口 375×812 | 横向溢出、fixed 元素越界、侧栏 drawer 开关、Escape | 布局 ✓，drawer 发现 P1 问题 |
| 对比度 | 主文本 21:1、导航 19.1:1（暗色主题，WCAG AAA）；muted 文本按 token 估算 ≥4.5:1（AA） | ✓ |
| 键盘 | Tab 顺序（弹窗内、drawer）、Escape 覆盖 | 弹窗/drawer 有缺口 |

## 二、问题清单（按优先级）

### P0（误操作/高风险，本轮必须修复）

- **B01 确认弹窗可叠加多开**（实测证实：快速双击"删除"叠开 2 个 `[role=dialog]`，截图
  review-05-stacked-dialogs.png）。两个弹窗都自称 aria-modal，视觉重叠、键盘/读屏混乱，
  连续确认会双重执行删除。源码：`src/components/ui/confirm-dialog.tsx` `renderMessageDialog`
  每次调用新建 container，无模块级互斥。
- **B02 备份"替换导入"确认强度不足**（代码级确认）：`src/lib/backup-settings-tab.ts:212-218`
  覆盖性导入用 default variant（Enter 可直接确认），与其他 destructive 操作（MCP 删除、任务删除等
  13 处均为 destructive）不一致。destructive variant 已有"焦点落取消键、Enter 不触发确认"保护。
  （浏览器未实测导入——会真实修改用户配置，风险不可接受。）

### P1（可用性/无障碍明确缺陷，本轮修复）

- **B03 确认弹窗无 focus trap**（实测：Tab 两次焦点逃逸到 BODY 背景；`aria-modal` 但键盘可离开）。
- **B04 确认弹窗关闭后焦点丢失**（实测：Escape 关闭后 activeElement 为 BODY，未恢复到触发按钮）。
  全库仅 FileRollbackDialog、GitToolsPinnedSummary 两处自带焦点恢复。
- **B05 移动端侧栏 drawer：Escape 无法关闭 + 焦点未移入**（实测：375px 视口打开 drawer 后按
  Escape 仍开启；`role=dialog aria-modal` 但 activeElement 不在 drawer 内）。源码 `src/App.tsx`
  移动 drawer（`fixed inset-0 z-50 md:hidden`）无 keydown 处理。
- **B06 设置 tab 每次切换报 React 错误**（实测 console：`Attempted to synchronously unmount a
  root while React was already rendering`，切换 4 次 error +4）。根因：`src/lib/react-settings-tabs.tsx:46-50`
  `disconnectedCallback` 同步 `root.unmount()`，而 lit 元素在 React 父组件 commit 期间被移除。
- **B07 switch 可访问名称与状态语义矛盾**（实测快照：MCP 卡片与定时任务卡片均出现
  `switch "暂停" [checked]`——服务/任务"启用中"却读作"暂停，已选中"；停用时读作"启用，未选中"）。
  根因：`role=switch` 元素无 aria-label，可访问名称回退到动态 `title`（启用时 title="暂停"）。
  源码：`src/components/mcp/mcp-server-card.tsx:50-60`、
  `src/components/scheduled-tasks/ScheduledTasksPage.tsx:985-995`。
- **B08 Toast 成功提示用 `role="alert"`**（代码级确认：`src/components/ui/toast.tsx:88` 统一
  alert 语义，成功/进度提示对读屏过强，应 status/polite）。未在浏览器触发成功 toast（需要真实执行
  后台任务），修复后以现有组件测试+代码审查验证。

### P2（一致性/可读性，低成本顺带修复）

- **B09 设置·常规 3 个数字输入无可访问名称**（实测：上下文压缩阈值 80、保留回合数 2、Goal
  最大轮次 20 的 `input[type=number]` 无 label 关联，读屏用户不知道数字含义）。源码：
  `src/lib/default-options-settings-tab.ts`。
- **B10 定时任务表单"执行模式"下拉无可访问名称**；相邻"执行智能体："label 尾部多余冒号与其他
  字段（模型/思考/项目）不一致。源码：`src/components/scheduled-tasks/ScheduledTasksPage.tsx`。
- **B11 折叠项目下残留"正在加载聊天工作区..."占位 ×5**（实测快照：5 个折叠项目的子会话容器
  持续暴露该文本，读屏会重复播报 5 次；展开后正常显示会话）。属侧栏折叠占位实现残留。
- **B12 定时任务卡片整卡 div onClick 打开详情**（键盘不可达；有"更多操作→查看详情"菜单补偿，
  属可接受降级，本轮不改交互结构，仅在文档记录）。

### 评审通过、无需改动的方面

- destructive 确认弹窗的初始焦点落"取消"且 Enter 不触发确认（实测证实）✓
- Escape 关闭确认弹窗 ✓；遮罩点击关闭 drawer ✓
- 设置页信息架构（17 tab + 搜索 + 字段级帮助浮层）结构清晰 ✓
- 定时任务表单：必填未完成时确认按钮禁用、AI 解析无内容时禁用、时区说明与规则即时预览 ✓
- 移动 375px 布局无横向溢出、无 fixed 越界 ✓
- MCP 内置卡片：内置标签中性展示、隐藏删除、保留编辑/启停 ✓
- 主文本对比度 21:1（AAA）✓
- 启动加载态（splash + 会话加载屏均有 role=status/aria-live）✓

## 三、修复计划（按本清单执行）

1. 批次一（P0+共享组件）：B01 弹窗互斥、B03 focus trap、B04 焦点恢复（同在 confirm-dialog 实现）、
   B02 backup destructive、B08 toast role、B06 ReactSettingsTab 延迟卸载。
2. 批次二（P1 局部）：B05 drawer Escape+焦点、B07 switch aria-label ×2 处。
3. 批次三（P2 低成本）：B09 数字输入 label、B10 下拉 label+冒号、B11 折叠占位清理。
4. 每批：定向 vitest + 相关 ESLint + tsc -b + Playwright 复查；最后全量 test/lint/build。

## 四、修复结果（2026-09-15 第二阶段）

| 编号 | 修复 | 文件 | 验证方式 |
|---|---|---|---|
| B01 | confirm-dialog 模块级互斥（并发请求按取消 resolve） | `src/components/ui/confirm-dialog.tsx` | 单测 6 例 + 浏览器双击实测（1 个弹窗） |
| B02 | 备份替换导入改 destructive variant | `src/lib/backup-settings-tab.ts` | 代码修改 + tsc/lint（不做真实导入） |
| B03 | 弹窗 Tab 焦点循环（focus trap） | `src/components/ui/confirm-dialog.tsx` | 浏览器实测 Tab×2 循环回取消键 |
| B04 | 弹窗关闭后焦点恢复到触发元素 | `src/components/ui/confirm-dialog.tsx` | 单测（focus 调用断言）+ 浏览器真实点击实测（isDeleteTrigger） |
| B05 | 移动 drawer Escape 关闭 + 焦点移入/恢复 | `src/App.tsx` | 浏览器 375px 实测（Escape 关闭、focusInDrawer） |
| B06 | ReactSettingsTab 延迟卸载（消除 React sync-unmount 错误） | `src/lib/react-settings-tabs.tsx` | 浏览器实测切 4 个 tab 0 console error |
| B07 | switch 固定可访问名称（MCP：启用 MCP 服务 {name}；任务：复用 taskEnabledSwitch） | `mcp-server-card.tsx`、`ScheduledTasksPage.tsx`、`i18n.ts` | 浏览器实测 aria-label 与 checked 语义一致 |
| B08 | toast role 分级（error=alert，其他=status+polite） | `src/components/ui/toast.tsx` | 代码修改 + lint/tsc（未触发真实成功 toast） |
| B09 | 3 个数字输入补 aria-label | `src/lib/default-options-settings-tab.ts` | 浏览器实测 3 个 label 存在 |
| B10 | 执行模式 select 补 aria-label；执行智能体 title 去冒号 | `ScheduledTasksPage.tsx`、`i18n.ts`（新 key executionAgentLabel） | 浏览器实测 |
| B11 | 折叠项目不再渲染"正在加载聊天工作区..."占位 | `src/components/sidebar/ChatSidebar.tsx` | 浏览器实测 DOM 中 0 处 |

全量验证：npm run test 354 files / 4043 passed + 1 skipped（首次 1 error 为既有 Worker fork 瞬断 flake，复跑 exit 0）；npm run lint 0 errors（仅既有 coverage 3 warnings）；npm run build 成功（仅既有 chunk warning）。新增回归测试 `tests/frontend/confirm-dialog.test.ts`（6 例）。

B12（任务卡片 div onClick 键盘不可达）保留现状：有"更多操作→查看详情"菜单补偿，改交互结构超出本轮最小改动边界。

## 五、验证限制与说明

- 备份导入（B02）、真实删除等破坏性流程未在真实数据环境执行确认操作（只打开弹窗后取消），
  修复后以组件测试与弹窗行为复查代替。
- Toast（B08）未触发真实成功任务通知，以代码修改+单元测试验证。
- pi-web-ui 外部包的 ChatPanel 内部 UI 不在本仓库可控范围，未纳入修复。
- 对比度基于抽样计算（oklch 主题 token），未做全量自动扫描。
- dev server（vite 5176）后期出现静态资源 404 与偶发 CONNECTION_RESET（vite dev 进程环境异常）；svg 在生产构建 dist 中正常打包（vscode svg 4492 字节一致），判定与代码无关。

## 六、父 Agent 复审与回归复查（2026-09-16）

- 亲读全部修复 diff 复审通过；新增 `tests/frontend/confirm-dialog.test.ts` 6 例与全部修复实现一致。
- 定向验证：vitest 4 文件 32/32（confirm-dialog / i18n 快照 / mcp-server-card / scheduled-tasks-page）、`tsc -b`、11 个修改文件 ESLint 均 exit 0。
- 全量验证：npm run test 355 files / 4053 passed + 1 skipped；npm run lint 0 errors（仅既有 coverage 3 warnings）；npm run build 成功（仅既有 chunk warning）。
- Playwright 回归复查（真实实例，结果存档 `app-ui-ux-browser-recheck-2026-09-16.json`）：destructive 弹窗初始焦点=取消、Tab×2 循环回取消、Escape 关闭；Enter 在取消键上走取消（安全方向）；4 次设置 tab 切换 0 console error；任务/MCP switch 标签语义一致；常规页 3 数字输入 label 存在；375px 无横向溢出、drawer 焦点移入且 Escape 关闭。
- 说明：弹窗 Escape 后焦点落回页面容器属预期降级——该场景触发器（删除菜单项）随弹窗打开即被移除（isConnected=false），不恢复到断开节点；直接按钮触发的弹窗（如 Git 还原）会恢复到触发按钮。B11 的「1 处 loading 占位」出现在展开项目会话加载期（expanded 时显示 loading 为设计行为），页面完全加载后为 0。

