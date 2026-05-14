## 项目指令

- 修改代码后，使用相关测试、构建、lint 或针对性命令进行验证。
- 默认验证命令是 `npm run lint` 和 `npm run build`；小改动可优先使用针对性检查。
- 除非用户明确要求，不要创建 Git commit、tag、push 到远端或发布 npm 包。
- 当用户说“发布一个小版本” / “发一个小版本” / “小版本发布”时，遵循 `docs/architecture/patch-release-runbook.zh-CN.md`：提升 patch 版本，更新发布文档，运行 build/lint，生成 runtime/offline 包，创建 Git commit/tag/push，最后提供 npm publish 命令；默认不要直接发布 npm。

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
