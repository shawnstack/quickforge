## 项目指令

- 修改代码后，使用相关测试、构建、lint 或针对性命令进行验证。
- 默认验证命令是 `npm run test`、`npm run lint` 和 `npm run build`；小改动可优先使用针对性检查。
- 除非用户明确要求，不要创建 Git commit、tag、push 到远端或发布 npm 包。
- 当用户说“发布一个小版本” / “发一个小版本” / “小版本发布”时，遵循 `docs/architecture/patch-release-runbook.zh-CN.md`：提升 patch 版本，更新发布文档，运行 test/lint/build，生成 runtime/offline 包，创建 Git commit/tag/push，最后提供 npm publish 命令；默认不要直接发布 npm。

## Subagent 协作

- 实现非平凡需求时，优先使用 `explore` subagent 做只读仓库调研，包括定位入口、调用链、相关测试、文档/wiki 和影响面。
- 对复杂多步骤任务，可将边界清晰的子任务委托给合适的 subagent 分工推进；父 Agent 仍负责最终方案、最小化修改、结果整合和验证。
- subagent 不应绕过项目约束、审批边界或安全边界；涉及文件修改、命令执行、发布、Git 操作时仍遵循本文件现有规则。
- 简单、局部且已知文件的小改动可直接处理，无需为了形式化而调用 subagent。

## 项目约束

- 将 `dist/`、`package-dist/`、`package-offline/` 视为生成产物；除非任务明确要求更新打包产物，否则不要手工修改这些目录。
- 不要新增或升级依赖，除非确有必要并说明理由；依赖变更时必须保持 `package-lock.json` 一致。
- 优先使用 npm scripts 和跨平台命令；除非任务明确指定平台，否则不要假设只能使用 Unix shell。
- 涉及 UI、样式或交互改动时，先遵循 `DESIGN_LANGUAGE.md`，不要随意引入新的视觉模式。
- 如果变更影响架构、模块职责、公共入口或发布流程，应同步更新相关 `docs/wiki` 文档；如果无需更新文档，需要说明原因。

## 代码 Wiki

- 项目代码 Wiki 位于 `docs/wiki/README.md`。
- 在理解模块、定位入口、进行较大变更或新人接手类任务时，优先读取 `docs/wiki/README.md`，再按需读取对应子目录文档。
- Wiki 仅作为导航和背景资料，最终判断以源码、配置和测试结果为准。

## Startup Workflow

- 新会话开始先读取 `docs/wiki/README.md`、`feature_list.json`、`progress.md`、`session-handoff.md`，恢复上下文；三个状态文件由归档规则保持精简，只含当前状态。
- `docs/archive/` 里的历史归档默认不读；需要某个已完成 feature 的方案/边界/验证细节时，再按月查对应文件。
- 从 `feature_list.json` 选择当前 feature（非 done 且依赖已满足的优先）；本次会话只推进该 feature。
- 开始或恢复关键工作前，可用 `bash init.sh` 执行基线验证（`npm run test`、`npm run lint`、`npm run build`，不安装依赖）。

## 归档（Archive）

- 状态文件只放当前状态，旧内容进归档：
  - `feature_list.json` 只保留未完成 feature（done / superseded 由脚本移走）；
  - `progress.md` 只保留日期最新的一段与 Notes 段；
  - `session-handoff.md` 只保留最近一轮。
- 归档命令：`node scripts/archive-harness.mjs`（`--dry-run` 预览）。归档进 `docs/archive/{features,progress,handoffs}/`，按月分文件，脚本幂等（重复执行不会重复归档）。
- 三个触发时机必须归档：① feature 标记 done 的当轮；② 用户要求提交代码时（先归档再 commit）；③ 会话结束前。发现活文件明显超出上述范围（如 progress 多段历史、handoff 多轮并存）也随时可跑。

## Verification Commands

- 修改代码后先做针对性检查（相关测试、lint、类型检查等）；小改动无需跑全套。
- 发布（release）前必须完整运行 `npm run test`、`npm run lint`、`npm run build`，全部通过才算完成；任何一项失败先修复，禁止在失败状态下继续发布流程。

## One Feature at a Time / Stay in Scope

- 一次只处理当前 feature，不要顺带重构无关代码或修复无关问题。
- 发现与当前 feature 无关的问题，记入 `progress.md` 的 Notes，不扩大改动范围。
- 每个改动保持最小、聚焦，改动后同步更新 `feature_list.json` / `progress.md`。

## Definition of Done

- 相关测试及与改动匹配的 lint/build/针对性检查通过；发布相关改动必须完整运行 `npm run test`、`npm run lint`、`npm run build`。
- **「中间态不丢」要写成断言，不能只测「能存进去」**：凡是有容量上限（`slice(0, N)` 截断）、批量/整表覆盖写、或同一份状态在跨标签/跨视图各存一份的地方，测试至少要覆盖一条「中间态还没成形 / 两方并发到达时，谁都没被吞掉」。判据一句话：把实现换回「先读整表再写整表」「用结构化值重建受控输入」「按上限静默截断」这三种旧写法时，必须有测试变红——没红过的测试挡不住这类缺陷。
- **晚到的旧响应不得覆盖新状态**：两方并发到达时，谁都没被吞、但赢的是错的那个——后发的先回、先发的后回，旧响应把新数据整块盖回去（`setState(await 旧请求)` 这类）。写测试要**主动构造「先发后到」的时序**（后发的先 resolve），只测正常路径的用例对这类缺陷一律无效；判据同样可验：把实现换回「请求一回来就 setState」，对应测试必须变红。历史同类修复：`2f046c48`（迟到的运行状态）、`556725d6`（目录列表盖回来）、`9b7ff33c`（旧快照盖新配置）、`651922b9`（晚到响应改回当前项目）。
- **延迟写的动作在卸载 / 抢占路径上必须补写或补发**：把「用户输入 → 持久层」或「用户点击 → 请求」放进定时器（防抖、动画延时、队列）的地方，定时器与卸载之间就多出一个窗口——窗口里切 tab、切项目、关面板、连点第二次，动作就**静默消失**（不报错、无提示，界面还显示已保存）。判据三条同时成立才算做对：①清理定时器的那条路径必须先把待写值 flush 出去，不能只 `clearTimeout`；②那个 flush 不能被同一组件的另一个 effect 抢先清掉 timer——React 卸载时按 effect **声明顺序正向**跑 cleanup，旧的先 `clearTimeout`，新的 flush 就会以为没有待写值而提前返回；③测卸载要自己从 harness 收集 effect 的 cleanup（`tests/frontend/settings-react-harness.ts` 只把 effect push 进数组，不执行、也不替你调 cleanup，不收集的「卸载 flush」用例永远绿）。判据可验：删掉 flush 后必须变红，把同步请求改回定时器后必须变红。正确范例：`WorkbenchScreensaverSettings`（卸载 flush）、`ChatPanelHost`（草稿卸载 + 视图切走双 flush）、`message-queue`（`cleanup()` 两分支）；历史同类修复：`562d434e`。
- 文档/wiki 已按需同步；未触碰生成产物（`dist/`、`package-dist/`、`package-offline/`）。
- `feature_list.json`、`progress.md`、`session-handoff.md` 已更新。

## End of Session

- 更新 `session-handoff.md`：当前目标、改动文件、blocker、下一步。
- 同步更新 `progress.md` 与 `feature_list.json` 的状态；完成的 feature 标记为 done。
- 跑一次 `node scripts/archive-harness.mjs` 归档，保证活文件只留当前状态。
- 未提交/未完成事项明确记录，方便下个会话恢复。
