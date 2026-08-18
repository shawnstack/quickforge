# Session Handoff

## 当前状态

- feature_list.json 已清理：42 个历史 feature 全部 done（最后一批遗留改动已按 feature 分别提交），列表归零，等待新需求登记。
- progress.md 已同步精简：移除全部已完成 feature 的历史章节，仅保留 Current State 与 Notes（通用教训），历史详情走 git 提交记录与 docs/architecture。
- 工作区 clean，无未提交改动、无 Blocker。

## 最近提交

- `2f0e01e` chore(status): record completed leftover features and update handoff
- `65c95d8` fix(ui): follow message font size in subagent run detail tabs
- `50a88e0` fix(sidebar): clip conversations section and keep footer divider visible
- `dbc0ca9` feat(agent): refresh session model bindings when custom providers change
- `73be13d` fix(context-usage): report pure input usage and drop reserved output row

## Next step

- 无待办 feature。新需求先登记进 feature_list.json 再推进（One Feature at a Time）。
- `server/cloud/identity.mjs:92` 有一条既有 no-useless-assignment lint warning，可择机修复。
- 发布 patch 版本：说「发布一个小版本」，按 `docs/architecture/patch-release-runbook.zh-CN.md` 执行（发布前完整跑 test/lint/build）。
