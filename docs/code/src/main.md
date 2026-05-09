# `src/main.tsx` — 应用入口

**行数**: 15 | **用途**: React 应用入口点

## 功能
- 从 `react-dom/client` 创建根节点
- 应用全局 CSS（`index.css`）
- 调用 `patchThinkingSelector()` 修补 pi-web-ui 的模型选择器，以支持显示自定义供应商的模型
- 在 `<StrictMode>` 中渲染 `<App />` 组件

## 代码要点
```tsx
patchThinkingSelector()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```
