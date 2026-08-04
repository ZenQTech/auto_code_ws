# G64-03 Spec: StageDetectorBadge UI 优化 + 折叠/展开动画

> **Cycle**: 64
> **优先级**: 🟢 P2 (Polish)
> **目标**: 优化 StageDetectorBadge 视觉细节，对标 Codex/Trae Solo 紧凑设计

---

## 1. 功能需求描述

### 1.1 目标
- 紧凑模式：徽章可点击切换，添加 hover 效果
- 详情面板：展开/折叠动画（scale + opacity）
- 阶段变更时的脉冲动画
- 主题完全适配
- 暗色模式优化
- 移动端响应式

### 1.2 用户场景
- **场景 1（悬停效果）**: 鼠标悬停徽章时显示 tooltip + 边框高亮
- **场景 2（展开动画）**: 点击徽章展开详情面板，使用缩放+淡入动画
- **场景 3（阶段变化脉冲）**: 阶段变化时徽章脉冲一次（颜色闪动）
- **场景 4（移动端适配）**: 在窄屏自动改为只显示 emoji，文字可隐藏

### 1.3 核心特性
- ✅ hover 边框高亮
- ✅ 展开/折叠动画（200ms scale + opacity）
- ✅ 阶段变化脉冲（500ms 颜色闪动）
- ✅ 移动端响应式（自动收起文字）
- ✅ 暗色模式优化（增强对比度）
- ✅ 触摸目标 ≥ 32px

---

## 2. 技术实现方案

### 2.1 CSS 动画

```css
/* 展开动画 */
@keyframes expandIn {
  from { transform: scale(0.95); opacity: 0; }
  to   { transform: scale(1);    opacity: 1; }
}

/* 阶段变化脉冲 */
@keyframes stageChange {
  0%   { background-color: var(--bg-elevated); }
  50%  { background-color: var(--accent-primary); }
  100% { background-color: var(--bg-elevated); }
}
```

### 2.2 移动端断点

- `< 640px`: 隐藏文字，仅显示 emoji + dot
- `≥ 640px`: 完整徽章
- 触摸目标 ≥ 32px

---

## 3. 验收标准

### 3.1 功能
- [x] hover 效果生效
- [x] 展开/折叠动画流畅
- [x] 阶段变化时脉冲
- [x] 移动端正确适配
- [x] 暗色模式对比度足够

### 3.2 测试
- [x] 视觉测试（Playwright snapshot）
- [x] 动画时长测试
- [x] 移动端响应式测试

### 3.3 浏览器 E2E
1. 打开 Solo Shell
2. 观察 StageDetectorBadge 静态样式
3. 悬停徽章，验证 hover 效果
4. 点击徽章，验证展开动画
5. 触发阶段变化，验证脉冲
6. 切换到暗色模式，验证对比度
