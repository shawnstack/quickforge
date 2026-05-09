# `src/components/` — UI 组件

**路径**: `src/components/`

## 目录结构

```
components/
├── chat/
│   ├── ChatPanelHost.tsx          # 聊天面板宿主（937行）
│   └── ModelSetupEmptyState.tsx   # 模型未配置时的空状态（43行）
├── scheduled-tasks/
│   └── ScheduledTasksPage.tsx     # 定时任务管理页面（608行）
├── share/
│   ├── ShareConversationDialog.tsx # 分享对话对话框（200行）
│   └── SharedConversationPage.tsx  # 查看已分享对话页面（231行）
├── sidebar/
│   └── ChatSidebar.tsx            # 聊天侧边栏（540行）
├── ui/
│   ├── button.tsx                 # 按钮组件（40行）
│   ├── confirm-dialog.tsx         # 确认对话框（90行）
│   ├── input.tsx                  # 输入框组件（19行）
│   ├── prompt-dialog.tsx          # 提示输入对话框（116行）
│   └── toast.tsx                  # Toast 通知组件（113行）
├── ErrorBoundary.tsx              # 错误边界组件（52行）
├── project-directory-picker.tsx   # 项目目录选择器（248行）
└── skills-dialog.tsx              # Skills 管理对话框（255行）
```

---

## chat/

### ChatPanelHost.tsx (937 行)

**用途**: 聊天面板的宿主组件，包装 `@mariozechner/pi-web-ui` 的 `ChatPanel`。

**主要功能**:
- 集成本地 workspace 工具（`@/lib/local-tools` 注册的自定义渲染器）
- 处理 YOLO 模式切换
- 管理自定义命令（custom commands）的注册和自动补全
- 处理斜杠命令 (`/compact`, `/clear`, `/yolo`, `/forget` 等)
- 支持对话回滚、分叉、复制
- 处理草稿恢复（Draft Restore）

**状态管理**: 通过 `agent`、`revision` 等 props 与上层通信。

### ModelSetupEmptyState.tsx (43 行)

**用途**: 当没有配置任何模型时显示的空状态引导页面。

**特点**: 提供"添加模型"和"使用 LiteLLM 示例"两个操作入口。

---

## scheduled-tasks/

### ScheduledTasksPage.tsx (608 行)

**用途**: 定时任务管理和配置页面。

**主要功能**:
- 任务类型支持：一次性(`once`)、每日(`daily`)、每周(`weekly`)、每月(`monthly`)、间隔(`interval`)、Cron
- 任务状态：启用、暂停、运行中、失败、过期
- 创建/编辑/删除定时任务
- 任务运行历史查看
- 支持关联项目和模型选择
- 支持思考模式配置

---

## share/

### ShareConversationDialog.tsx (200 行)

**用途**: 分享对话的对话框，允许生成分享链接。

**主要功能**:
- 设置权限（只读/可操作）
- 设置密码保护
- 设置过期时间（1小时/24小时/7天/永不过期）
- 列出和撤销已有分享
- 复制分享链接到剪贴板

### SharedConversationPage.tsx (231 行)

**用途**: 查看和交互已分享的对话页面。

**主要功能**:
- 通过分享 ID 加载对话
- 支持密码验证
- 配置共享模型（从分享元数据或服务器获取）
- 以只读模式运行 `SharedServerAgent`
- 支持复制回复文本

---

## sidebar/

### ChatSidebar.tsx (540 行)

**用途**: 聊天侧边栏组件，管理对话列表和项目导航。

**主要功能**:
- 项目列表（可展开折叠）
- 全局对话列表和按项目过滤的对话列表
- 分页加载（load more）
- 对话搜索/过滤
- 对话重命名、删除
- 新建对话/项目对话
- 显示后台任务状态
- 定时任务入口

---

## ui/

### button.tsx (40 行)

通用按钮组件，使用 `class-variance-authority` 支持多种变体（default/destructive/outline/secondary/ghost）和大小。

### confirm-dialog.tsx (90 行)

**用途**: 确认对话框，使用 Portal 渲染。支持键盘快捷键（Enter 确认、Escape 取消）。

### input.tsx (19 行)

通用输入框组件，forwardRef 支持。

### prompt-dialog.tsx (116 行)

**用途**: 输入提示对话框，用于重命名等场景。支持默认值、placeholder 和键盘快捷键。

### toast.tsx (113 行)

**用途**: 后台任务通知 Toast 组件。自动 5 秒消失，支持进入/离开动画。点击可跳转到对应会话。

---

## 其他组件

### ErrorBoundary.tsx (52 行)

React 类组件实现的错误边界，捕获子组件渲染错误并显示降级 UI。

### project-directory-picker.tsx (248 行)

**用途**: 项目目录选择器对话框。

**主要功能**:
- 加载文件系统根目录（Home/Desktop/Documents/QuickForge/驱动器）
- 浏览目录结构
- 手动输入路径
- 跨平台兼容（Windows 驱动器、macOS Volumes）

### skills-dialog.tsx (255 行)

**用途**: 管理全局和项目级别的 Agent Skills。

**主要功能**:
- 按 scope（global/project）加载技能列表
- 搜索过滤技能
- 选择和取消选择技能
- 保存选择到服务器
- 支持项目作用域
