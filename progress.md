# Progress

## Current State

- Feature: 无（feature_list.json 已清理归零，42 个历史 feature 全部 done，详细记录见 git 历史）
- Status: 空闲，等待新需求登记
- Blockers: 无
- Next step: 新需求先登记进 feature_list.json 再推进；发布 patch 版本前完整运行 `npm run test`、`npm run lint`、`npm run build`

## Notes

- 既有 lint warning（待择机修复）：`server/cloud/identity.mjs:92` no-useless-assignment（'record' 赋值后未使用），多会话前已存在，与近期改动无关。
- 测试教训：任何会触发 session state cutover/默认 mirror 的测试必须在隔离 dataDir（显式 `readBuckets` + 不落真实路径的 mirror）下进行，避免 storage.mjs 默认 `~/.quickforge` 被测试污染。
- 基准教训：`server/utils/logger.mjs` 静态引入 `server/storage.mjs`，后者的 `dataDir` 在模块求值时固化；要在隔离目录下使用 storage 路径的脚本/测试必须在加载任何项目模块前设置 `QUICKFORGE_DATA_DIR`（全动态导入实现）。
- 服务器 SQLite 是唯一权威，前端 IndexedDB 仅浏览器只读缓存层（F12-F15 已按此边界落地，新缓存需求沿用）。

## 历史

- 已完成 feature 的登记与验证详情见 git 历史中 `feature_list.json` / `progress.md` 的历次提交；架构决策与设计文档见 `docs/architecture/`，模块导航见 `docs/wiki/`。
