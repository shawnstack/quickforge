# `src/components/share/` — 对话分享组件

## 文件清单

| 文件 | 说明 | 行数 |
|------|------|------|
| [ShareConversationDialog.tsx](ShareConversationDialog.tsx.md) | 分享对话对话框 | 277 |
| [SharedConversationPage.tsx](SharedConversationPage.tsx.md) | 查看分享对话页面 | 268 |

---

### `ShareConversationDialog.tsx`

创建和管理对话分享的对话框组件：

- 生成分享链接 (带 Token)
- 权限控制: read (只读) / operate (可操作)
- 可选密码保护 (scrypt 加密)
- 有效期设置
- 已创建的分享列表管理 (撤销/删除)
- 复制分享链接到剪贴板

### `SharedConversationPage.tsx`

查看他人分享的对话页面：

- 加载分享的对话数据
- 密码验证 (如果设置了密码)
- 只读模式: 可以浏览对话记录
- 操作模式: 可以继续对话 (类似原始会话)
- SSE 流式加载分享对话消息
- 模型/工具/YOLO 模式渲染
