# Progress

只保留日期最新的一段与 Notes；更早的条目由 `node scripts/archive-harness.mjs` 归档到 `docs/archive/progress/`（按月分文件）。
新的段落加在最上面（时间倒序）。

## 工作台主色改高级 jade + 铂金字面（2026-11-13 14:05）

- 用户反馈青色也不高级。主色改深 jade --qf-wb-accent:#3aa981（主按钮/开关/筛选选中/跑道灯/焦点环/toast 标签）；字面（翻页钟/倒计时/时间/NEXT）改暖铂金 --qf-wb-numeral:#e7e2d4；石墨底 + 语义红/绿/警告保留，整体计时仪器质感。
- 验证：tsc/eslint/vitest 17/build 全绿；隔离实测字面 rgb(231,226,212)、主按钮 rgb(58,169,129)、无黄无青、单击居中弹窗/焦点/Esc/窄屏全绿、零 console error；截图目视确认。未 commit；服务已清理。

