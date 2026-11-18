# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 经验库列表补分页，参照工作记忆的翻页交互（2026-11-18 17:20）

- 用户口径：「经验记忆没有翻页 参考工作记忆」——设置·记忆整理页的经验库列表全量渲染无分页，而工作记忆笔记列表有翻页。
- 定位：经验列表在 `src/components/dreaming/DreamingSettingsTab.tsx`（`view === 'experiences'` 分支），`filteredExperiences.map` 全量渲染，只有搜索框的客户端过滤；同文件 runs 列表与 `WorkingMemorySettingsTab` 均有 pager。
- 改动：`src/components/dreaming/DreamingSettingsTab.tsx` 加**前端分页**（`experiencePage` state + `pagedExperiences` slice，一页 20 条，与 runs/工作记忆一致；复用 `dreamingPrev`/`dreamingPage`/`dreamingNext` i18n key）。选前端分页不选服务端分页的理由：`GET /api/dreaming/experiences` 本来就要读每个文件的 front matter 建行（工作记忆的 `listNotePage` 只 stat 就够，两者成本结构不同），服务端分页省不了 IO，反而多一次往返；搜索框也是客户端过滤，搜索结果同样要分页。搜索词变化时 `setExperiencePage(1)`（新结果从头看，不是 clamp 到尾页）；`runNow` 重载后同样回到第 1 页；`experiencePageSafe = min(experiencePage, totalPages)` 兜底列表变短时不显示空白页。
- 测试（实测会红）：新增 `tests/frontend/dreaming-experiences-pager.test.ts`（3 例：45 条三页翻页含 5 条尾页不丢/单条结果不显示 pager/搜索后从第 1 页开始）。变异检查：删掉 slice 换回全量渲染 → 3 例全红；删掉搜索重置页码 → 「新搜索从第 1 页开始」红（页码停在 clamp 出来的第 2 页）。还原后全绿。
- 验证：相关 vitest 4 文件（pager/open/working-memory/form-labels）20 例通过；`npx eslint` 改动文件净；`npx tsc -b` 通过；`npm run check:wiki` matched=401 resolved=401 bad=0。
- wiki：`docs/wiki/src/components/README.md`（`DreamingSettingsTab.tsx` 759→804 行，描述补分页）、`docs/wiki/README.md`（经验库段补「按 20 条/页分页列出，与工作记忆笔记列表同一交互」）、`docs/architecture/memory-system.zh-CN.md` §6「人怎么看到这些文件」补两端分页方式差异。
- 边界：未 commit / tag / push；未新增依赖；未改 `dist/`；未动服务端（无 API 变更）。

## Notes

- 记忆体系评审（2026-11-18，只读评审，未改代码）发现三个待修缺陷：① `<experiences>` 提示词块无条件注入并指名 `list_memory_notes`/`read_memory_note`，但四个记忆工具挂载被 `isWorkingMemoryEnabled()` 绑死（agent-tool-assembly.mjs），工作记忆默认关时多数会话拿到指路不存在工具的提示词；② 两层 200 上限静默悬崖：notes 活跃已 173 篇、experiences 105 条，`MAX_NOTES_PER_SCOPE=200` 列表截断与索引 200 行截断都按 mtime 静默丢旧条目，写入不受限，按当前增速约一个月撞线；③ 文档漂移：memory-system.md §4/§5「index.md 全文注入」与 system-prompt.mjs:148-160（只注入路径）不符，experiences.mjs:143 注释同病，wiki README 记忆条目同。
- 全量测试并发模式下 server 侧 goal/scheduled 域存在负载敏感的 hookTimeout 抖动：UI 刀 A 期间两轮并发全量分别有 6/5 个文件 7 例超时失败（agent-goal-runtime、agent-goal-manager、goal-v2-manager、scheduled-tasks.commands、agent-manager.persist-session-state、session-index-query），同批文件单独跑 103/103 全过、干净基线亦全过、串行全量 0 失败。与纯前端改动无关，建议后续给这些 server 测试加 hookTimeout 或隔离标记。
