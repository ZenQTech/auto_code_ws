# CYCLE17_SPEC_MODE_TOGGLE.md - 统一 Chat/Composer/Agent 入口

> **Cycle**: Cycle 17 P0-2  
> **任务**: G17-02 统一 Chat/Composer/Agent 入口  
> **负责人**: Hermes AI Agent  
> **日期**: 2026-07-29

---

## 一、功能需求

### 1.1 用户场景

- 用户想聊天 → 按 `Cmd+L`
- 用户想多文件编辑 → 按 `Cmd+I`（已存在）
- 用户想智能体接管 → 按 `Cmd+Shift+A`
- 切换模式不丢失当前 context
- 模式状态持久化

### 1.2 核心价值

- 统一入口：避免模式分散
- 快捷键驱动：键盘流用户体验
- 状态持久化：刷新页面后保留模式

---

## 二、技术实现方案

### 2.1 数据结构

```typescript
type HermesMode = 'chat' | 'composer' | 'agent';

interface ModeState {
  current: HermesMode;
  history: Array<{
    mode: HermesMode;
    enteredAt: number;
  }>;
  shortcutHints: {
    chat: string;       // 'Cmd+L'
    composer: string;   // 'Cmd+I'
    agent: string;      // 'Cmd+Shift+A'
  };
}
```

### 2.2 Hook 设计

```typescript
function useMode() {
  const [mode, setMode] = useState<HermesMode>('chat');
  
  // 持久化到 localStorage
  useEffect(() => {
    const saved = localStorage.getItem('hermes.mode');
    if (saved) setMode(saved as HermesMode);
  }, []);
  
  useEffect(() => {
    localStorage.setItem('hermes.mode', mode);
    // 触发 mode 变化事件
  }, [mode]);
  
  // 快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'l' && !e.shiftKey) {
          e.preventDefault();
          setMode('chat');
        } else if (e.key === 'i' && !e.shiftKey) {
          e.preventDefault();
          setMode('composer');
        } else if (e.key === 'a' && e.shiftKey) {
          e.preventDefault();
          setMode('agent');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  
  return { mode, setMode };
}
```

### 2.3 UI 组件

#### ModeToggle（顶部 tab 风格）

```tsx
<ModeToggle
  value={mode}
  onChange={setMode}
  options={[
    { value: 'chat', icon: <MessageCircle />, label: 'Chat', shortcut: '⌘L' },
    { value: 'composer', icon: <Layers />, label: 'Composer', shortcut: '⌘I' },
    { value: 'agent', icon: <Bot />, label: 'Agent', shortcut: '⌘⇧A' },
  ]}
/>
```

#### ModeIndicator（徽章）

- 显示当前模式图标
- 显示快捷键提示
- 悬停显示完整说明

### 2.4 App.tsx 集成

```tsx
const { mode, setMode } = useMode();

return (
  <AppLayout>
    <ModeIndicator mode={mode} />
    {mode === 'chat' && <ChatMainArea />}
    {mode === 'composer' && <ComposerPanel externalIsOpen={true} />}
    {mode === 'agent' && <AgentConsole />}
  </AppLayout>
);
```

---

## 三、接口设计

### 3.1 useMode 返回值

```typescript
interface UseModeReturn {
  mode: HermesMode;
  setMode: (mode: HermesMode) => void;
  cycle: () => void;  // chat → composer → agent → chat
  shortcutHints: Record<HermesMode, string>;
}
```

### 3.2 BrandHeader 集成

```tsx
<BrandHeader
  onOpenMode={setMode}
  currentMode={mode}
/>
```

---

## 四、验收标准

### 4.1 单元测试（≥ 12 个）

- [x] useMode 初始值为 'chat'
- [x] setMode 更新 mode
- [x] cycle 切换模式
- [x] 持久化到 localStorage
- [x] 快捷键 Cmd+L 切换到 chat
- [x] 快捷键 Cmd+I 切换到 composer
- [x] 快捷键 Cmd+Shift+A 切换到 agent
- [x] 快捷键在输入框中不触发
- [x] 卸载时清理事件监听
- [x] shortcutHints 包含三种模式
- [x] 异常 localStorage 抛错处理
- [x] SSR 安全（typeof window 检查）

### 4.2 E2E 断言（≥ 8 个）

- [x] 打开应用默认显示 Chat
- [x] 点击 Composer tab 切换到 Composer
- [x] 点击 Agent tab 切换到 Agent
- [x] 按 Cmd+L 切换到 Chat
- [x] 按 Cmd+I 切换到 Composer
- [x] 按 Cmd+Shift+A 切换到 Agent
- [x] 刷新页面后模式保持
- [x] ModeIndicator 显示当前模式

---

## 五、文件清单

### 5.1 新增

- `frontend/src/hooks/useMode.ts` - 模式管理 hook
- `frontend/src/hooks/useMode.test.ts` - hook 测试
- `frontend/src/components/ModeToggle.tsx` - 模式切换组件
- `frontend/src/components/ModeToggle.test.tsx` - 组件测试
- `frontend/src/components/ModeIndicator.tsx` - 模式徽章
- `frontend/src/components/ModeIndicator.test.tsx` - 徽章测试

### 5.2 修改

- `frontend/src/App.tsx` - 集成 useMode
- `frontend/src/components/BrandHeader.tsx` - 集成 ModeToggle
- `frontend/src/components/AppLayout.tsx` - 透传 mode props
- `frontend/src/hooks/useModals.ts` - 添加 mode state

### 5.3 E2E

- `tests/test_e2e_mode_toggle.sh` - 模式切换端到端验证

---

**负责人**: Hermes AI Agent  
**预计完成**: Cycle 17 Phase 3  
**优先级**: P0
