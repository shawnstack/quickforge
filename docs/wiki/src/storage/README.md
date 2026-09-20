# `src/storage/` — 自研存储层

QuickForge 自研的多 store 键值存储层（self-hosted-chat-ui T1），契约与符号名沿用卸载前 UI 包的存储导出形状（`AppStorage` + 4 个 Store），行为与既有实装一致，实现独立维护。

## 结构

```
src/storage/
├── types.ts                 # StorageTransaction / StorageBackend 契约接口，SessionData / SessionMetadata / StoreConfig 等类型
├── store.ts                 # 抽象 Store 基类（getConfig / setBackend / getBackend）
├── app-storage.ts           # AppStorage 门面 + 模块级单例 getAppStorage()/setAppStorage()
├── index.ts                 # 公共导出桶（符号名保持稳定）
└── stores/
    ├── settings-store.ts        # "settings"（out-of-line key）：get/set/delete/list/clear
    ├── provider-keys-store.ts   # "provider-keys"：get/set/delete/has/list
    ├── sessions-store.ts        # "sessions"(keyPath id + lastModified 索引) + 姊妹 store "sessions-metadata"（SessionsStore.getMetadataConfig）
    └── custom-providers-store.ts # "custom-providers"：get/set/delete/getAll/has + CustomProvider/CustomProviderType
```

## 关键设计

- **实现后端无关**：`StorageBackend` 是纯契约接口；QuickForge 当前唯一实现是 `src/lib/http-storage-backend.ts`（本地服务 HTTP 持久化，含 provider-keys 内存缓存与 sessions/sessions-metadata 批量事务）。
- **SessionsStore 双 store 事务**：`save()`/`delete()` 经 `backend.transaction(['sessions','sessions-metadata'], ...)` 提交，由 HttpStorageBackend 聚合为单次 `/api/storage/batch` 请求。
- **模块级单例**：QuickForge 侧代码一律使用本地 `getAppStorage()/setAppStorage()`；`pi-chat.ts`（主应用）与分享页 `SharedConversationPage` 各自构造 `AppStorage` 后调用 `setAppStorage(storage)` 注册同一实例，全应用共享一份存储。UI 包已卸载，不再存在向包内单例桥接的过渡层。
- **测试**：`tests/frontend/storage-layer.test.ts` 用内存 backend 覆盖 4 个 Store 的 get/set/delete/list、双 store 事务与单例语义。

## 后续

- self-hosted-chat-ui 收尾已完成（T8）：React 聊天面板、工具渲染 registry、settings tabs 与 i18n 均已自研，`legacy-bridge.ts` 已删除，三个 UI 运行时依赖已从 `package.json` 卸载。
