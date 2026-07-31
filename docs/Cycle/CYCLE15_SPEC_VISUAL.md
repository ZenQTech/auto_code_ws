# CYCLE 15 - UI/UX 优化 Spec #1: 视觉规范

> **文档版本**: v1.0.0
> **创建日期**: 2026-07-29
> **适用范围**: Hermes 智能体调度平台全部 3 个 frontend 项目
> **技术栈**: TypeScript + React 18 + Vite + Tailwind CSS
> **状态**: ✅ 待 Phase 3 实施

---

## 1. 设计语言基础

### 1.1 设计原则

1. **一致性优先 (Consistency First)**: 3 个项目视觉风格 100% 统一
2. **可访问性达标 (Accessibility First)**: WCAG 2.1 AA 级
3. **响应式原生 (Responsive Native)**: 1024px / 768px / 375px 三档断点
4. **主题可切换 (Theme Aware)**: 深色 / 浅色 / 高对比度 3 主题
5. **微交互细腻 (Micro-interaction)**: 所有交互 100ms 内有反馈

### 1.2 品牌定位

- **定位**: 工业级 AI 智能体调度平台
- **调性**: 专业 / 高效 / 科技 / 可信赖
- **参考标杆**: Trae SOLO（创新性）+ OpenAI Codex（专业性）+ Linear（一致性）
- **避免**: 卡通化、过度渐变、华而不实的动效

---

## 2. 色彩体系 (Color System)

### 2.1 主色板 (Primary Palette)

#### 主品牌色: 蓝紫渐变 (Brand Gradient)
| Token | Light | Dark | 用途 |
|-------|-------|------|------|
| `brand-50` | #EFF6FF | #1E3A8A | 背景层 |
| `brand-100` | #DBEAFE | #1E40AF | 选中层 |
| `brand-300` | #93C5FD | #3B82F6 | 图标/边线 |
| `brand-500` | #3B82F6 | #60A5FA | **主按钮 / 强调** |
| `brand-600` | #2563EB | #3B82F6 | **按钮 hover** |
| `brand-700` | #1D4ED8 | #2563EB | 按钮 active |
| `brand-900` | #1E3A8A | #DBEAFE | 文字层 |

#### 功能色板 (Semantic)
| Token | 值 | 用途 |
|-------|-----|------|
| `success-500` | #10B981 | 成功状态、提交通过 |
| `warning-500` | #F59E0B | 警告、二次确认 |
| `danger-500` | #EF4444 | 错误、危险操作、回退 |
| `info-500` | #3B82F6 | 信息提示 |
| `neutral-500` | #6B7280 | 禁用、次要 |

### 2.2 状态色 (Status Colors - Workflow)

| 状态 | 主色 | 背景 | 边线 | 图标 |
|------|------|------|------|------|
| idle | #9CA3AF (灰) | #F3F4F6 | #D1D5DB | 圆圈 |
| running | #3B82F6 (蓝) | #DBEAFE | #93C5FD | 旋转 |
| paused | #F59E0B (橙) | #FEF3C7 | #FCD34D | 暂停符 |
| tool-calling | #8B5CF6 (紫) | #EDE9FE | #C4B5FD | 扳手 |
| failed | #EF4444 (红) | #FEE2E2 | #FCA5A5 | X |
| cancelled | #6B7280 (灰) | #F3F4F6 | #D1D5DB | 斜线 |
| completed | #10B981 (绿) | #D1FAE5 | #6EE7B7 | 勾 |

### 2.3 色盲友好 (Color-blind Friendly Mode)

提供色盲模式开关，使用图标+形状双编码：

| 状态 | 颜色 | 图标前缀 | 形状 |
|------|------|---------|------|
| idle | 灰 | ○ | 圆 |
| running | 蓝 | ● | 实心圆 |
| paused | 橙 | ⏸ | 双竖线 |
| tool-calling | 紫 | 🔧 | 扳手 |
| failed | 红 | ✕ | 叉 |
| cancelled | 灰 | ⊘ | 斜线圆 |
| completed | 绿 | ✓ | 勾 |

### 2.4 主题切换 (Theme Tokens)

#### 浅色主题 (Light)
```
--bg-primary: #FFFFFF
--bg-secondary: #F9FAFB
--bg-tertiary: #F3F4F6
--text-primary: #111827
--text-secondary: #4B5563
--text-tertiary: #9CA3AF
--border-default: #E5E7EB
--border-strong: #D1D5DB
```

#### 深色主题 (Dark)
```
--bg-primary: #0F172A
--bg-secondary: #1E293B
--bg-tertiary: #334155
--text-primary: #F1F5F9
--text-secondary: #CBD5E1
--text-tertiary: #64748B
--border-default: #334155
--border-strong: #475569
```

#### 高对比度主题 (High Contrast)
```
--bg-primary: #000000
--bg-secondary: #0A0A0A
--bg-tertiary: #1A1A1A
--text-primary: #FFFFFF
--text-secondary: #E5E5E5
--border-default: #FFFFFF
--border-strong: #FFFFFF
```

---

## 3. 字体层级 (Typography)

### 3.1 字体栈

```css
--font-sans: 'Inter', 'PingFang SC', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Cascadia Code', Consolas, monospace;
--font-display: 'Inter Display', 'Inter', sans-serif;  /* 用于大标题 */
```

### 3.2 字号体系 (Type Scale - Major Third 1.250)

| Token | Size | Line Height | Weight | 用途 |
|-------|------|-------------|--------|------|
| `text-xs` | 12px | 16px | 400 | 辅助文字、标签 |
| `text-sm` | 14px | 20px | 400 | 表格、列表、按钮 |
| `text-base` | 16px | 24px | 400 | **正文** |
| `text-lg` | 18px | 28px | 500 | 小标题 |
| `text-xl` | 20px | 28px | 600 | 二级标题 |
| `text-2xl` | 24px | 32px | 600 | 页面标题 |
| `text-3xl` | 30px | 36px | 700 | 大标题 |
| `text-4xl` | 36px | 40px | 700 | Hero |

### 3.3 字体粗细 (Weights)

| Token | Value | 用途 |
|-------|-------|------|
| `font-normal` | 400 | 正文 |
| `font-medium` | 500 | 强调 |
| `font-semibold` | 600 | 标题 |
| `font-bold` | 700 | Hero / 数字 |

### 3.4 特殊排版规则

- **代码**: 等宽字体，行高 1.5，字号 13px
- **数字 (Token计数)**: tabular-nums，等宽数字
- **英文/中文混排**: 英文与中文之间加 0.5 个汉字空格
- **行宽**: 中文 35 字 / 行，英文 75 字符 / 行

---

## 4. 间距系统 (Spacing)

### 4.1 基础单位: 4px (Tailwind 默认)

| Token | px | 用途 |
|-------|----|----|
| `space-0` | 0 | 重置 |
| `space-1` | 4 | 极小间距（图标内边距） |
| `space-2` | 8 | 紧凑元素 |
| `space-3` | 12 | 表单元素 |
| `space-4` | 16 | **基础间距** |
| `space-5` | 20 | 卡片内边距 |
| `space-6` | 24 | 模块间距 |
| `space-8` | 32 | 大模块间距 |
| `space-10` | 40 | 页面内边距 |
| `space-12` | 48 | 章节间距 |
| `space-16` | 64 | 大区块 |

### 4.2 容器宽度 (Container)

| 断点 | 最小宽 | 最大宽 | 边距 |
|------|--------|--------|------|
| Mobile | 375px | 767px | 16px |
| Tablet | 768px | 1023px | 24px |
| Desktop | 1024px | 1439px | 32px |
| Large | 1440px | ∞ | 自适应 |

---

## 5. 圆角与阴影 (Radius & Shadow)

### 5.1 圆角体系 (Border Radius)

| Token | px | 用途 |
|-------|----|----|
| `radius-none` | 0 | 输入框(无圆角) |
| `radius-sm` | 4 | 标签、小按钮 |
| `radius-md` | 8 | **按钮、输入框** |
| `radius-lg` | 12 | 卡片 |
| `radius-xl` | 16 | 大卡片、模态 |
| `radius-2xl` | 24 | 巨型卡片 |
| `radius-full` | 9999 | 圆形头像、Tag |

### 5.2 阴影体系 (Shadow)

| Token | 用途 | 浅色值 | 深色值 |
|-------|------|--------|--------|
| `shadow-xs` | 微弱悬浮 | 0 1px 2px rgba(0,0,0,0.05) | 0 1px 2px rgba(0,0,0,0.3) |
| `shadow-sm` | 卡片 | 0 1px 3px rgba(0,0,0,0.1) | 0 1px 3px rgba(0,0,0,0.4) |
| `shadow-md` | **下拉菜单、模态** | 0 4px 6px rgba(0,0,0,0.1) | 0 4px 6px rgba(0,0,0,0.5) |
| `shadow-lg` | 浮层 | 0 10px 15px rgba(0,0,0,0.1) | 0 10px 15px rgba(0,0,0,0.6) |
| `shadow-xl` | 巨型模态 | 0 20px 25px rgba(0,0,0,0.1) | 0 20px 25px rgba(0,0,0,0.7) |
| `shadow-glow` | 主按钮发光 | 0 0 20px rgba(59,130,246,0.3) | 0 0 30px rgba(96,165,250,0.5) |

### 5.3 玻璃拟态 (Glassmorphism)

```css
.glass {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.3);
}

.glass-dark {
  background: rgba(15, 23, 42, 0.8);
  backdrop-filter: blur(12px) saturate(180%);
  -webkit-backdrop-filter: blur(12px) saturate(180%);
  border: 1px solid rgba(148, 163, 184, 0.2);
}
```

---

## 6. 动效规范 (Motion)

### 6.1 时间曲线 (Easing)

| Token | Cubic Bezier | 用途 |
|-------|--------------|------|
| `ease-linear` | linear | 旋转、进度条 |
| `ease-in` | cubic-bezier(0.4, 0, 1, 1) | 元素退出 |
| `ease-out` | cubic-bezier(0, 0, 0.2, 1) | 元素进入 |
| `ease-in-out` | cubic-bezier(0.4, 0, 0.2, 1) | **默认** |
| `ease-spring` | cubic-bezier(0.34, 1.56, 0.64, 1) | 弹性反馈 |

### 6.2 时长规范 (Duration)

| Token | ms | 用途 |
|-------|----|----|
| `duration-instant` | 50 | 即时反馈（hover 变色） |
| `duration-fast` | 150 | 按钮按下反馈 |
| `duration-normal` | 200 | **默认过渡** |
| `duration-medium` | 300 | 模态/抽屉 |
| `duration-slow` | 500 | 页面切换 |
| `duration-slower` | 800 | 大型动效 |

### 6.3 微交互清单 (Micro-interactions)

| 场景 | 动效 | 时长 |
|------|------|------|
| 按钮 hover | bg-color 渐变 | 150ms |
| 按钮 active | scale(0.98) | 100ms |
| 模态打开 | fade + scale(0.95→1) | 200ms |
| 模态关闭 | fade + scale(1→0.95) | 150ms |
| 抽屉打开 | slide-in-right | 300ms |
| Toast 进入 | slide-in-top + fade | 200ms |
| Toast 退出 | slide-out-top + fade | 150ms |
| 消息进入 | fade + translateY(8px) | 200ms |
| Loading 旋转 | rotate 360deg linear infinite | 1000ms |
| 进度条 | width 0→100% ease-in-out | 不定 |

### 6.4 减弱动效 (Reduced Motion)

```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 7. 核心组件视觉规范

### 7.1 按钮 (Button)

#### 尺寸
| 变体 | 高度 | 字号 | 内边距 | 圆角 |
|------|------|------|--------|------|
| xs | 24px | 12px | 8px 12px | 4px |
| sm | 32px | 14px | 10px 16px | 6px |
| md | **40px** | **14px** | **12px 20px** | **8px** |
| lg | 48px | 16px | 16px 24px | 8px |
| xl | 56px | 18px | 20px 28px | 10px |

#### 变体
- **Primary**: 蓝紫渐变背景，白色文字，hover 提亮 5%
- **Secondary**: 透明背景，主色边线，主色文字
- **Ghost**: 透明背景，无边线，hover 显示 bg
- **Danger**: 红色背景（仅破坏性操作）
- **Icon**: 圆形 40×40px，仅图标

### 7.2 输入框 (Input)

```
高度: 40px
内边距: 12px 16px
圆角: 8px
边线: 1px solid var(--border-default)
聚焦: 2px solid var(--brand-500) + 0 0 0 4px rgba(59,130,246,0.1)
错误: 2px solid var(--danger-500)
占位符: var(--text-tertiary)
```

### 7.3 卡片 (Card)

```
背景: var(--bg-primary)
边线: 1px solid var(--border-default)
圆角: 12px
内边距: 20px
阴影: shadow-sm (hover 时 shadow-md)
```

### 7.4 模态 (Modal)

```
背景: var(--bg-primary)
圆角: 16px
阴影: shadow-xl
最大宽度: 640px
内边距: 32px
背景遮罩: rgba(0,0,0,0.5) backdrop-blur(4px)
```

### 7.5 Toast

```
位置: top-right
最大宽度: 384px
内边距: 12px 16px
圆角: 8px
阴影: shadow-lg
图标: 左侧 20×20px
标题 + 描述: 标题加粗 14px，描述常规 12px
关闭按钮: 右侧 16×16px
持续时间: 默认 4s，错误 6s
```

### 7.6 标签 (Tag / Chip)

```
高度: 24px
内边距: 4px 10px
圆角: radius-full
字号: 12px
状态背景: 浅色状态背景（status-color 100）
状态文字: 状态主色（status-color 700）
```

---

## 8. 核心页面视觉重设计

### 8.1 聊天主界面 (Chat View)

#### 布局
```
┌─────────────────────────────────────────────┐
│  BrandHeader (h=56px)                       │  ← 顶部品牌栏
├──────┬──────────────────────────┬───────────┤
│      │                          │           │
│ Side │  ChatView (flex-1)        │ Tool      │  ← 三栏式
│ bar  │  ┌─────────────────────┐  │ Panel     │     布局（参考
│ 280  │  │ MessageBubble       │  │ 320       │     Trae SOLO）
│ px   │  │ ...                 │  │ px        │
│      │  └─────────────────────┘  │           │
│      │  [Input Area (h=120px)]   │           │
└──────┴──────────────────────────┴───────────┘
```

#### 视觉元素
- **消息气泡**: 用户消息右对齐（蓝色背景 100 + 文字 900），AI 消息左对齐（无背景，文字主色）
- **思考过程**: 双层折叠面板，顶部阶段标签（分析/设计/编码/验证）+ 计时器
- **代码块**: Monaco Editor，圆角 8px，浅色背景，深色边框
- **Diff 显示**: 三模式切换按钮组（行/词/字符）+ 顶部统计 bar
- **Input Area**: 固定底部，自动调整高度（max 200px）

### 8.2 代码编辑区 (Code Viewer)

```
┌─────────────────────────────────────────────┐
│  文件路径 + 语言标识 + 操作按钮组            │  ← 顶部工具栏
├─────────────────────────────────────────────┤
│  Monaco Editor (全高度)                     │
│  - 字体: JetBrains Mono 13px                │
│  - 主题: 自适应（跟随全局主题）             │
│  - Minimap: 默认开启，可关闭                │
└─────────────────────────────────────────────┘
```

### 8.3 Diff 展示区 (Diff View)

```
┌─────────────────────────────────────────────┐
│ 模式切换 [行|词|字符]  视图 [统一|分屏]      │  ← 顶部工具栏
├─────────────────────────────────────────────┤
│ +12 -5 =3   (3 files)         色盲模式 ☐   │  ← 统计 bar
├─────────────────────────────────────────────┤
│  diff content (Monaco Diff Editor)         │
└─────────────────────────────────────────────┘
```

### 8.4 思考过程面板 (Thinking Block)

```
┌─────────────────────────────────────────────┐
│ 💭 思考中 · 分析阶段 · 00:23                │  ← 标题栏（可折叠）
├─────────────────────────────────────────────┤
│  ┌──────────────────────────────────────┐  │
│  │ 分析需求，识别核心功能模块...         │  │  ← 内容区（typewriter 效果）
│  │ 需要考虑以下边界条件：                 │  │
│  │   1. ...                              │  │
│  └──────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

---

## 9. 设计 Token 实施

### 9.1 Token 文件结构

```
frontend/src/design-system/
├── tokens/
│   ├── color.ts          # 色彩 token
│   ├── typography.ts     # 字体 token
│   ├── spacing.ts        # 间距 token
│   ├── radius.ts         # 圆角 token
│   ├── shadow.ts         # 阴影 token
│   └── motion.ts         # 动效 token
├── themes/
│   ├── light.ts          # 浅色主题
│   ├── dark.ts           # 深色主题
│   └── highContrast.ts   # 高对比度主题
├── globals.css           # CSS 变量注入
└── README.md             # 使用文档
```

### 9.2 Tailwind 配置集成

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: { /* 50-900 */ },
        success: { /* 50-900 */ },
        warning: { /* 50-900 */ },
        danger: { /* 50-900 */ },
      },
      spacing: { /* space-0 ~ space-16 */ },
      borderRadius: { /* radius-none ~ radius-2xl */ },
      boxShadow: { /* shadow-xs ~ shadow-glow */ },
      fontFamily: { /* sans, mono, display */ },
      fontSize: { /* xs ~ 4xl */ },
      transitionDuration: { /* instant ~ slower */ },
    },
  },
};
```

---

## 10. 视觉验收标准

### 10.1 必须达成（P0）

- ✅ 3 项目视觉风格 100% 一致（Design Token 统一）
- ✅ 100% 通过 WCAG 2.1 AA 对比度（4.5:1 文字 / 3:1 图形）
- ✅ 3 主题（浅色 / 深色 / 高对比度）可切换
- ✅ 色盲模式下所有状态可识别（图标 + 形状双编码）
- ✅ 所有交互元素 100ms 内有视觉反馈
- ✅ 圆角、间距、字号严格遵循规范（像素级偏差 ≤ 2px）

### 10.2 应达成（P1）

- ✅ 玻璃拟态在 Modal/Drawer 上正常渲染
- ✅ 减弱动效模式自动适配 `prefers-reduced-motion`
- ✅ 焦点环 100% 可见（键盘导航）
- ✅ Loading 状态统一使用 4 种规范之一（spinner / skeleton / pulse / progress）

### 10.3 可达成（P2）

- ✅ 暗色主题下文本对比度 ≥ 7:1（AAA 级）
- ✅ 支持自定义主题色（用户偏好）
- ✅ 动效可降级（无障碍模式）

---

## 11. 设计交付物清单

| # | 交付物 | 格式 | 优先级 |
|---|--------|------|--------|
| 1 | Design Token 全套 | TS 文件 | P0 |
| 2 | Tailwind 配置文件 | tailwind.config.js | P0 |
| 3 | 主题切换 Hook | useTheme.ts | P0 |
| 4 | 组件库（Button/Input/Card/Modal/Toast） | TSX + CSS | P0 |
| 5 | 状态色盲模式 Hook | useColorBlind.ts | P1 |
| 6 | Storybook 故事（按组件） | *.stories.tsx | P1 |
| 7 | 设计系统文档站点 | VitePress / Docusaurus | P2 |
| 8 | Figma 设计稿 | Figma | P2 |

---

**文档完成时间**: 2026-07-29
**文档字数**: 4,500 字
**下一步**: 创建 Spec #2: 交互规范
