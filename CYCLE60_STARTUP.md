# CYCLE60_STARTUP.md

> **Cycle**: 60
> **日期**: 2026-08-03
> **主题**: 前端 Solo 模式重做 + 3 主题 + 移动端适配 + TRAE-browseruse 验证
> **状态**: 100% 完成

---

## 1. Cycle 概述

### 1.1 目标

修复前端 UI，根据 Codex 与 Trae 的 Solo 模式体验，重做 Vibe Coding 入口，新增：

1. **Solo 模式主壳**（[VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx)）— 三栏布局 + Goal 岛台
2. **3 套主题切换**（[ThemeSwitcher.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.tsx)）— dark/light/high-contrast
3. **会话历史侧边栏**（[SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx)）— Solo 模式必备
4. **工具矩阵面板**（[ToolsMatrixPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ToolsMatrixPanel.tsx)）— 47 panel 集中入口
5. **移动端适配**（[MobileSoloSheet.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.tsx)）— < 768px 切换单列布局
6. **Auto-Follow 联动扩展**（[useAutoFollow.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.ts)）— 9→15 事件类型

### 1.2 完成度

| 阶段 | 任务数 | 完成度 | 状态 |
|------|--------|--------|------|
| 阶段 1：基础设施（CSS 主题 + UI 组件库） | 3 | 100% | ✅ |
| 阶段 2：Solo 主壳 + Goal 岛台 | 3 | 100% | ✅ |
| 阶段 3：会话历史侧边栏 | 1 | 100% | ✅ |
| 阶段 4：Auto-Follow 深度集成 | 1 | 100% | ✅ |
| 阶段 5：移动端响应式 | 1 | 100% | ✅ |
| 阶段 6：E2E 验证 + 文档 | 3 | 100% | ✅ |
| **总计** | **12** | **100%** | **✅** |

### 1.3 与 Codex/Trae Solo 对齐

| 维度 | Codex Solo | Trae Solo | 本项目 Solo |
|------|------------|-----------|-------------|
| 顶部 Goal 岛台 | ✅ | ✅ | ✅ |
| 三栏布局（历史/主舞台/工具） | ✅ | ✅ | ✅ |
| 主题切换 | light/dark | light/dark | dark/light/high-contrast |
| Auto-Follow 联动 | ✅ | ✅ | ✅ (15 事件) |
| 会话历史侧边栏 | ✅ | ✅ | ✅ |
| 移动端适配 | ✅ | ✅ | ✅ (5 Tab Bar) |
| TRAE-browseruse 验证 | — | — | ✅ |

---

## 2. 工作流程

### 2.1 6 阶段开发流程

```
阶段 1 (基础设施):
  ├─ 任务 1.1: index.css 主题 CSS 变量
  ├─ 任务 1.2: Button/Card/IconButton 组件库
  └─ 任务 1.3: ThemeSwitcher 切换器

阶段 2 (Solo 主壳):
  ├─ 任务 2.1: LoopStatusBar 升级为 Goal 岛台
  ├─ 任务 2.2: VibeSoloShell 三栏整合壳
  └─ 任务 2.3: 注册 /solo 路由

阶段 3 (会话历史):
  └─ 任务 3.1: SessionHistorySidebar + GET /sessions API

阶段 4 (Auto-Follow 扩展):
  └─ 任务 4.1: useAutoFollow 扩展 6 个新事件类型

阶段 5 (移动端适配):
  └─ 任务 5.1: MobileSoloSheet + 单元测试

阶段 6 (E2E 验证 + 文档):
  ├─ 任务 6.1: g60-01-solo-mode E2E 测试
  ├─ 任务 6.2: 4 个 Cycle 60 文档
  └─ 任务 6.3: Git 提交与推送
```

### 2.2 不破坏向后兼容

- ✅ 保留原 `/vibe-coding` 路由 + [VibeCodingPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeCodingPage.tsx)
- ✅ 保留原 `/chat/*`、`/coding/*` 路由
- ✅ 47 个 panel 全部继续工作
- ✅ 新增 `/solo` 路由 + Solo 模式主壳

---

## 3. 关键技术决策

### 3.1 主题系统架构

```
[useDesignTokens Hook]
       ↓ setTheme(theme)
       ↓
   document.documentElement[data-theme="..."]
       ↓
   [index.css] [data-theme="X"] 块选择器
       ↓
   CSS 变量（--bg-app / --text-primary / ...）
       ↓
   所有组件 className="bg-[var(--bg-app)]"
```

### 3.2 Solo 主壳布局

```
┌─────────────────────────────────────────────────┐
│ LoopStatusBar (顶部 Goal 岛台)                     │
│ [Logo] [Stage] [Progress] [⏸▶✖🗑] [🎯] [Theme]    │
├──────────┬──────────────────────┬───────────────┤
│ Session  │                      │               │
│ History  │   Vibe Coding        │   Tools       │
│ Sidebar  │   Stage              │   Matrix      │
│ (260px)  │   (主舞台)            │   (320px)     │
│          │                      │               │
│          │                      │               │
└──────────┴──────────────────────┴───────────────┘
```

### 3.3 移动端布局

```
┌─────────────────┐
│ Header [←][🌊]  │  ← 顶部（stage / 进度 / 控制）
├─────────────────┤
│                 │
│   Main Content  │  ← 主体（按 Tab 切换内容）
│   (按 Tab 切换)   │
│                 │
├─────────────────┤
│ [🌊][🧰][🕘][📋][🎯] │  ← 底部 5 Tab Bar
└─────────────────┘
```

---

## 4. 测试与验证

### 4.1 单元测试（vitest）

- [MobileSoloSheet.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.test.tsx)：19/19 通过
- [useAutoFollow.test.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.test.ts)：覆盖 15 事件类型
- [SessionHistorySidebar.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.test.tsx)（已存在）：覆盖 5/5 通过
- [ToolsMatrixPanel.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ToolsMatrixPanel.test.tsx)（已存在）：覆盖 7/7 通过

### 4.2 E2E 测试（vitest + TRAE-browseruse）

- [g60-01-solo-mode.e2e.test.ts](file:///home/qizheng/auto_code_ws/frontend/tests/e2e/g60-01-solo-mode.e2e.test.ts)：20+ 测试用例
- 覆盖：Vibe Coding 完整流程 / 会话历史 / Auto-Follow 联动 / SSE / 错误处理

### 4.3 真实浏览器验证

通过 TRAE-browseruse 在真实 Chrome 浏览器中验证：
- 主题切换生效（dark/light/high-contrast）
- 三栏布局可拖拽 + localStorage 持久化
- 移动端模拟（< 768px 自动切换到 MobileSoloSheet）
- Auto-Follow 联动触发正确 panel
- 会话历史拉取 + 切换

---

## 5. 交付物清单

### 5.1 新增文件

| 路径 | 行数 | 作用 |
|------|------|------|
| [frontend/src/components/MobileSoloSheet.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.tsx) | 580 | 移动端 Solo 适配 |
| [frontend/src/components/MobileSoloSheet.test.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/MobileSoloSheet.test.tsx) | 620 | 移动端单测 |
| [frontend/src/components/SessionHistorySidebar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/SessionHistorySidebar.tsx) | 270 | 会话历史侧边栏 |
| [frontend/src/components/ToolsMatrixPanel.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ToolsMatrixPanel.tsx) | 280 | 工具矩阵面板 |
| [frontend/src/components/ThemeSwitcher.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ThemeSwitcher.tsx) | 150 | 3 主题切换器 |
| [frontend/src/pages/VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx) | 213 | Solo 模式主壳 |
| [frontend/src/components/ui/Button.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Button.tsx) | 95 | 统一按钮 |
| [frontend/src/components/ui/Card.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/Card.tsx) | 78 | 统一卡片 |
| [frontend/src/components/ui/IconButton.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/ui/IconButton.tsx) | 95 | 圆形图标按钮 |
| [frontend/tests/e2e/g60-01-solo-mode.e2e.test.ts](file:///home/qizheng/auto_code_ws/frontend/tests/e2e/g60-01-solo-mode.e2e.test.ts) | 270 | Solo 模式 E2E |
| [CYCLE60_STARTUP.md](file:///home/qizheng/auto_code_ws/CYCLE60_STARTUP.md) | — | 本文档 |
| [CYCLE60_SPEC.md](file:///home/qizheng/auto_code_ws/CYCLE60_SPEC.md) | — | 规范文档 |
| [CYCLE60_CODE_MODIFICATION_LOG.md](file:///home/qizheng/auto_code_ws/CYCLE60_CODE_MODIFICATION_LOG.md) | — | 代码修改日志 |
| [CYCLE60_ACCEPTANCE_REPORT.md](file:///home/qizheng/auto_code_ws/CYCLE60_ACCEPTANCE_REPORT.md) | — | 验收报告 |

### 5.2 修改文件

| 路径 | 修改内容 |
|------|----------|
| [backend/app/api/vibe_coding.py](file:///home/qizheng/auto_code_ws/backend/app/api/vibe_coding.py) | 新增 `GET /sessions` 端点 |
| [frontend/src/router/router.tsx](file:///home/qizheng/auto_code_ws/frontend/src/router/router.tsx) | 注册 `/solo` 路由 + VibeSoloShell import |
| [frontend/src/hooks/useAutoFollow.ts](file:///home/qizheng/auto_code_ws/frontend/src/hooks/useAutoFollow.ts) | 事件类型 9→15 + 映射表扩展 |
| [frontend/src/components/LoopStatusBar.tsx](file:///home/qizheng/auto_code_ws/frontend/src/components/LoopStatusBar.tsx) | 升级为 Goal 岛台 |
| [frontend/src/index.css](file:///home/qizheng/auto_code_ws/frontend/src/index.css) | 3 主题 CSS 变量定义 |
| [frontend/src/pages/VibeSoloShell.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/VibeSoloShell.tsx) | useResponsive → useIsMobile 修复 |
| [frontend/src/pages/ModeSelectorPage.tsx](file:///home/qizheng/auto_code_ws/frontend/src/pages/ModeSelectorPage.tsx) | 新增 Solo 模式卡片 |

---

## 6. 风险与缓解

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| 移动端布局错乱 | P1 | ThreePanelLayout 响应式断点 + MobileSoloSheet fallback |
| 主题切换不生效 | P1 | index.css 完整定义 3 主题 + useDesignTokens 同步 |
| 47 panel 视觉不一致 | P2 | 渐进式 UI 组件库统一（Button/Card/IconButton） |
| Auto-Follow 状态泄漏 | P2 | React Context 共享 autoFollow 实例 |
| SSE 事件类型扩展破坏 | P2 | 新增 6 个事件使用新 PanelKey（loopV7），不修改既有 9 个 |

---

## 7. 后续 Cycle 候选（CYCLE61 调研方向）

A. **LLM Fine-tuning 集成**（推荐）
B. **WebAssembly 函数运行时**
C. **多模态输入增强**（图片 / 音频 / 视频）
D. **多用户协作 + 实时同步**
E. **AI Agent Marketplace 升级**

---

**文档版本**: v1.0
**完成时间**: 2026-08-03 12:35
**总投入**: 12 任务 / 6 阶段 / ~6 工时
