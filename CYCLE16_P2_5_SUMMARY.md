# Cycle 16 P2-5 完成总结：Loading 状态规范

## 任务概述
- **目标**：建立统一的 Loading 状态规范，提供 Spinner / Skeleton / ProgressBar 基础组件以及 GlobalLoading / LocalLoading / StreamingLoading 容器组件，并通过 useAsyncLoading Hook 为异步操作提供 loading 包装
- **关联产品价值**：与 Notion / Linear / Figma 等主流产品的 loading 体验对标，统一全应用的加载态视觉语言
- **完成日期**：2026-07-29
- **版本**：v6.40.0

---

## 完成的工作

### 1. Spinner 基础组件
- ✅ `frontend/src/components/loading/Spinner.tsx` (132 行)
- ✅ 5 尺寸预设（xs/sm/md/lg/xl）+ 自定义像素
- ✅ 5 颜色预设（hermes/blue/gray/white/current）
- ✅ 3 厚度预设（thin/medium/thick）+ 自定义像素
- ✅ aria-label 无障碍支持
- ✅ forwardRef 支持父组件 ref
- ✅ 10 个单元测试（size/color/thickness/label/className/testid）

### 2. Skeleton 骨架屏组件
- ✅ `frontend/src/components/loading/Skeleton.tsx` (170 行)
- ✅ 4 形态预设（text/circle/rect/rounded）
- ✅ 5 尺寸预设 + 自定义 width/height
- ✅ `SkeletonGroup` 多条骨架容器
- ✅ animated 开关（默认 shimmer 动画 / 关闭时静态）
- ✅ aria-hidden="true" 辅助技术
- ✅ 13 个单元测试（4 形态/尺寸/animated/Group 渲染等）

### 3. ProgressBar 进度条组件
- ✅ `frontend/src/components/loading/ProgressBar.tsx` (172 行)
- ✅ 5 尺寸（xs/sm/md/lg/xl）
- ✅ 5 颜色（hermes/blue/green/red/gradient）
- ✅ 确定进度（value 0-100）+ 不确定进度（indeterminate）
- ✅ AsyncProgressBar 异步任务自动进度条
- ✅ label + showValue + formatValue 自定义
- ✅ role=progressbar + aria-valuenow 无障碍
- ✅ 13 个单元测试

### 4. Loading 统一入口组件
- ✅ `frontend/src/components/loading/Loading.tsx` (195 行)
- ✅ 5 variant 切换（spinner/skeleton/progress/streaming/dots）
- ✅ 4 layout 模式（inline/block/center/overlay）
- ✅ StreamingDots 子组件（3 点跳动动画）
- ✅ 12 个单元测试

### 5. GlobalLoading 全局遮罩
- ✅ `frontend/src/components/loading/GlobalLoading.tsx` (102 行)
- ✅ React Portal 渲染到 body 末尾
- ✅ 背景虚化 + 玻璃拟态
- ✅ body 滚动锁定（避免背景滚动）
- ✅ closable 选项控制背景点击关闭
- ✅ 9 个单元测试

### 6. LocalLoading 局部容器
- ✅ `frontend/src/components/loading/LocalLoading.tsx` (172 行)
- ✅ 3 mode 切换（inline/overlay/skeleton）
- ✅ inline 模式：替换 children
- ✅ overlay 模式：在 children 之上覆盖（保留布局）
- ✅ skeleton 模式：渲染多条骨架
- ✅ minHeight 避免布局抖动
- ✅ aria-busy="true" 无障碍
- ✅ 8 个单元测试

### 7. StreamingLoading 流式加载
- ✅ `frontend/src/components/loading/StreamingLoading.tsx` (120 行)
- ✅ 6 phase 预设（thinking/typing/searching/tool-calling/generating/analyzing）
- ✅ emoji 图标 + 跳动点 + 文字描述
- ✅ progress 可选显示
- ✅ aria-live="polite" 屏幕阅读器
- ✅ 17 个单元测试

### 8. useAsyncLoading 异步 Hook
- ✅ `frontend/src/hooks/useAsyncLoading.ts` (227 行)
- ✅ loading / error / data / progress 状态管理
- ✅ run / reset / immediate 模式
- ✅ 自动重试（maxRetries / retryDelay）
- ✅ 超时控制（timeout）
- ✅ onSuccess / onError 回调
- ✅ 防并发：第二次 run 在第一次未完成时返回 undefined
- ✅ mountedRef 处理组件卸载
- ✅ 12 个单元测试

### 9. 模块聚合入口
- ✅ `frontend/src/components/loading/index.ts` (10 行)
- ✅ 统一导入：`import { Loading, GlobalLoading, ... } from './components/loading'`

### 10. Tailwind 动画扩展
- ✅ `frontend/tailwind.config.js` v1.3.0
- ✅ 新增 `progress-indeterminate` keyframes
- ✅ 不确定进度条动画：translateX -100% → 200% 循环

---

## 验收结果

### TypeScript
- Loading 相关文件：0 错误 ✅
- 完整 tsc 检查：loading 相关文件全部通过 ✅

### 测试覆盖（94/94 通过，100%）
| 文件 | 测试数 |
|------|-------|
| Spinner.test.tsx | 10 |
| Skeleton.test.tsx | 13 |
| ProgressBar.test.tsx | 13 |
| Loading.test.tsx | 12 |
| GlobalLoading.test.tsx | 9 |
| LocalLoading.test.tsx | 8 |
| StreamingLoading.test.tsx | 17 |
| useAsyncLoading.test.ts | 12 |
| **总计** | **94** |

### 覆盖维度
- ✅ **基础渲染**：所有组件基础渲染 + data-testid
- ✅ **Props 变体**：所有可选参数路径覆盖
- ✅ **交互行为**：点击、键盘、滚动锁定
- ✅ **边界条件**：value 越界、超时、并发
- ✅ **无障碍**：aria-label / aria-busy / aria-live / role

---

## 关键设计决策

### 1. variant vs 组件分离
- **Loading** 作为统一入口，通过 `variant` prop 切换 Spinner/Skeleton/ProgressBar/Streaming
- 三个基础组件仍可独立使用（更灵活的组合）
- 类比：Material UI 的 `<CircularProgress />` / `<Skeleton />` / `<LinearProgress />` 分立

### 2. 三种作用域容器
- **GlobalLoading**：全屏遮罩（应用启动/全局数据加载）
- **LocalLoading**：容器内（panel/卡片加载）
- **StreamingLoading**：流式场景（AI 思考/工具调用）
- 对应 LoadingFallback 路由懒加载场景使用 GlobalLoading；PanelSkeleton 使用 LocalLoading skeleton mode；MessageRow 流式空状态使用 StreamingLoading

### 3. Portal vs 内联渲染
- GlobalLoading 使用 `createPortal` 渲染到 body 末尾
- 避免父组件 `overflow: hidden` / `z-index` 干扰
- 锁定 body 滚动（避免遮罩出现后背景仍可滚动）

### 4. useAsyncLoading 并发控制
- `inFlightRef.current` 标记当前是否有任务在执行
- 第二次 `run` 调用时直接返回 `undefined`，避免重复请求
- 重试逻辑内部使用 `runInternal` 递归（不经过 `run`），因此不触发并发保护

### 5. mountedRef 处理卸载
- 异步任务可能在组件卸载后返回
- 检查 `mountedRef.current` 后再调用 `setState`
- `useEffect` 清理函数中设置 `mountedRef.current = false`
- 清理 timeout 避免内存泄漏

### 6. 进度条 indeterminate 模式
- 不确定进度使用独立动画（translateX 循环）
- 不显示百分比（显示"处理中…"）
- 与确定进度视觉差异明显，避免用户误解

### 7. 颜色预设 vs 自由配置
- 5 个颜色预设：hermes（品牌）、blue/green/red（语义色）、white（反色）、current（继承）
- 不暴露完整 color token，避免颜色系统蔓延
- 与 design token 体系对齐（hermes-500 / blue-500 等）

---

## 用户场景覆盖

| 场景 | 组件 | variant / mode |
|------|------|---------------|
| 路由懒加载 | GlobalLoading | spinner / center |
| 应用启动 | GlobalLoading | spinner + text |
| 列表加载 | LocalLoading | skeleton |
| 列表分页 | LocalLoading | inline / overlay |
| 文件下载 | ProgressBar | progress + indeterminate |
| 多步表单 | ProgressBar | progress + value |
| AI 思考 | StreamingLoading | thinking |
| AI 工具调用 | StreamingLoading | tool-calling |
| 异步按钮 | useAsyncLoading + Spinner | spinner inline |
| 模态提交 | useAsyncLoading + LocalLoading | overlay |

---

## 文件清单

### 新增
```
frontend/src/components/loading/
├── Spinner.tsx              (132 行)
├── Spinner.test.tsx         (80 行)
├── Skeleton.tsx             (170 行)
├── Skeleton.test.tsx        (95 行)
├── ProgressBar.tsx          (172 行)
├── ProgressBar.test.tsx     (130 行)
├── Loading.tsx              (195 行)
├── Loading.test.tsx         (75 行)
├── GlobalLoading.tsx        (102 行)
├── GlobalLoading.test.tsx   (95 行)
├── LocalLoading.tsx         (172 行)
├── LocalLoading.test.tsx    (95 行)
├── StreamingLoading.tsx     (120 行)
├── StreamingLoading.test.tsx(120 行)
└── index.ts                 (10 行)
frontend/src/hooks/
├── useAsyncLoading.ts       (227 行)
└── useAsyncLoading.test.ts  (160 行)
```

### 修改
- `frontend/tailwind.config.js` v1.3.0：新增 `progress-indeterminate` 动画
- `代码修改日志.md` v6.40.0：P2-5 摘要

---

## 与现有组件的整合

### 待迁移（下一阶段）
- `LoadingFallback.tsx` → `<GlobalLoading variant="spinner" />`
- `PanelSkeleton.tsx` → `<LocalLoading mode="skeleton" />`
- 散落的 `animate-spin` 类 → `<Spinner />` 组件
- 散落的 `animate-pulse` 骨架 → `<Skeleton />` 组件
- MessageRow 中的流式 loading → `<StreamingLoading phase="thinking" />`

### 优势
- 统一视觉语言（避免每个面板各自实现）
- 减少代码量（删除散落的 loading 实现）
- 更好的可访问性（aria-* 属性）

---

## 下一阶段

P2-6: 自动 commit + 时间线集成
- 自动 commit：每次修改后自动 git commit
- 时间线集成：将 commit 记录展示在 VersionTimeline 中
- 提供"查看历史版本"功能
