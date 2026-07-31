# CYCLE17_SPEC_PREVIEW.md - 渐进式 UI 预览

> **Cycle**: Cycle 17 P0-3  
> **任务**: G17-03 渐进式 UI 预览  
> **负责人**: Hermes AI Agent  
> **日期**: 2026-07-29

---

## 一、功能需求

### 1.1 用户场景

- 用户在 Composer 编辑 React 组件
- 右侧 Preview 面板实时显示渲染结果
- 修改 → 自动热更新预览
- 出错 → 预览区显示错误卡片
- 切换快照 → 预览回到对应版本

### 1.2 核心价值

- **所见即所得**：编辑即看到效果
- **减少切窗口**：不用切到 IDE/浏览器
- **即时反馈**：错误立即可见

---

## 二、技术实现方案

### 2.1 三种渲染模式

#### 模式 A: HTML 直渲染（简单场景）

- 适用：纯 HTML/CSS/JS
- 实现：iframe.srcdoc = 完整 HTML
- 优点：实现简单，隔离性好
- 缺点：无法处理 React

#### 模式 B: 沙箱 + 预置 React（中等场景）

- 适用：React 单文件组件
- 实现：
  1. 准备 base HTML（CDN 加载 React + Babel）
  2. 注入用户代码到 `<script type="text/babel">`
  3. 监听 message 实现双向通信

#### 模式 C: iframe + postMessage（复杂场景）

- 适用：多文件项目
- 实现：
  1. 在主应用内维护 preview 状态
  2. iframe 监听 postMessage
  3. 主应用发文件列表 → iframe 渲染

### 2.2 数据结构

```typescript
interface PreviewState {
  status: 'idle' | 'compiling' | 'ready' | 'error';
  mode: 'html' | 'react' | 'iframe';
  files: Record<string, string>;
  currentFile: string;
  error: PreviewError | null;
  lastUpdated: number;
  snapshotId: string | null;
}

interface PreviewError {
  type: 'syntax' | 'runtime' | 'network';
  message: string;
  line?: number;
  column?: number;
  stack?: string;
}
```

### 2.3 PreviewPanel 组件

```tsx
<PreviewPanel
  state={previewState}
  onRefresh={refresh}
  onReset={reset}
  onSnapshot={takeSnapshot}
  fullscreen={isFullscreen}
  onToggleFullscreen={toggleFullscreen}
/>
```

### 2.4 沙箱安全

- iframe sandbox 属性：
  - `allow-scripts`（运行 JS）
  - `allow-same-origin`（同源访问）
  - 不允许：allow-top-navigation, allow-popups
- CSP：限制外部资源加载
- console 桥接：捕获 iframe 内 console.log

### 2.5 性能优化

- 渲染防抖：500ms 延迟（避免每次输入都重新渲染）
- Web Worker：复杂编译任务移到 worker
- 预加载：基础 HTML 模板预热

---

## 三、接口设计

### 3.1 usePreview Hook

```typescript
function usePreview() {
  return {
    state: PreviewState;
    update: (files: Record<string, string>, currentFile: string) => void;
    refresh: () => void;
    reset: () => void;
    takeSnapshot: () => Promise<string>;
    loadSnapshot: (id: string) => void;
    setMode: (mode: 'html' | 'react' | 'iframe') => void;
  };
}
```

### 3.2 Composer 集成

```typescript
// 监听 applyEdit 事件自动更新预览
useEffect(() => {
  if (state === 'accepted' && edit.filePath.endsWith('.tsx')) {
    preview.update({ [edit.filePath]: edit.afterContent }, edit.filePath);
  }
}, [edits]);
```

---

## 四、验收标准

### 4.1 单元测试（≥ 10 个）

- [x] usePreview 初始状态
- [x] update 触发渲染
- [x] refresh 重新加载
- [x] reset 清空
- [x] takeSnapshot 返回 id
- [x] loadSnapshot 恢复
- [x] setMode 切换模式
- [x] 错误状态捕获
- [x] 防抖生效
- [x] 沙箱异常处理

### 4.2 集成测试（≥ 5 个）

- [x] 端到端：HTML 编辑 → 预览更新
- [x] 端到端：React 组件 → 沙箱渲染
- [x] 端到端：语法错误 → 显示错误
- [x] 端到端：刷新恢复快照
- [x] 端到端：切模式保持

### 4.3 E2E 断言（≥ 8 个）

- [x] PreviewPanel 默认显示
- [x] HTML 文件更新后预览刷新
- [x] 错误捕获显示错误卡片
- [x] 全屏按钮工作
- [x] 重置按钮工作
- [x] 快照创建/恢复
- [x] 模式切换按钮工作
- [x] 控制台消息桥接

---

## 五、文件清单

### 5.1 新增

- `frontend/src/hooks/usePreview.ts` - 预览 hook
- `frontend/src/hooks/usePreview.test.ts` - hook 测试
- `frontend/src/components/PreviewPanel.tsx` - 预览面板
- `frontend/src/components/PreviewPanel.test.tsx` - 组件测试
- `frontend/src/utils/previewSandbox.ts` - 沙箱工具
- `frontend/src/utils/previewSandbox.test.ts` - 沙箱测试
- `frontend/src/__tests__/preview-integration.test.tsx` - 集成测试

### 5.2 修改

- `frontend/src/components/ComposerPanel.tsx` - 集成 PreviewPanel
- `frontend/src/hooks/useComposer.tsx` - 暴露 preview 联动 API

### 5.3 E2E

- `tests/test_e2e_preview.sh` - 预览端到端验证

---

**负责人**: Hermes AI Agent  
**预计完成**: Cycle 17 Phase 3  
**优先级**: P0
