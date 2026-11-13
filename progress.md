# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 工作台黑-白-黑夹层和谐修正（2026-11-14 00:55）

- 用户反馈：浅色下「TODAY 黑带 → 白色主区缝隙 → 黑色出港屏」两段黑夹一段白特别不和谐。
- 修法：TODAY 统计带从通告与主区之间移入 `.qf-wb__board` 内部作仪器总结头（board-head 之前）；CSS background 改透明与看板同一暗面、去掉独立 rise 动画、padding 对齐看板内容（桌面 10px 16px / 窄屏 8px 10px）。浅色下仅存一块暗色仪器岛，铂金字面与发丝分隔保留。
- 验证：workbench 契约 19/19 + today-stats 10/10；tsc -b 净 + 定向 eslint 净 + build 绿 + 全量 550 文件 6169 例绿 + check:wiki 292/292；Electron offscreen 实测 insideBoard=true / gapToHead=0 / bandTransparent=true / 窄屏带在板内单行（35px）无溢出、浅深窄屏零 console/page error，截图目视确认单岛。跨午夜统计正确归零重累（startOfToday 跨天实测）。服务与孤儿进程已清理。
- Notes：未 commit（用户本轮未要求）；改动 Workbench.tsx / workbench.css / workbench.test.ts / workbench-today-stats.test.ts + 设计 README。

