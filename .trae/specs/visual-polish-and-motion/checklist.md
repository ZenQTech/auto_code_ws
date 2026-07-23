# Checklist

## Task 1 — Tailwind theme 扩展
- [x] `tailwind.config.js` 中 `boxShadow` 含 4 级（`level-1`..`level-4`）以及 `glow-hermes`、`glow-hermes-lg` 专用阴影
- [x] `transitionTimingFunction` 含 `material` / `expressive` / `spring` 三个 cubic-bezier
- [x] `keyframes` 新增 `glow-pulse` / `shimmer` / `lift` / `press` / `collapse-height` 至少 5 个
- [x] `borderRadius` 阶梯（`sm` 6 / `md` 10 / `lg` 16 / `xl` 24）已暴露
- [x] `index.css` 顶部声明 CSS 变量 `--shadow-*` / `--ease-*` / `--radius-*`

## Task 2 — 页面调性 / 全局背景与光影
- [x] body 背景由纯色升级为多层（底色 + 顶部径向高光 + 噪点）
- [x] `.bg-noise` 工具类已实现且 opacity ≤ 0.04
- [x] body 噪点层 `pointer-events: none` 不拦截点击
- [x] `index.html` 的 body class 含 `bg-noise`

## Task 3 — Hover 动效统一
- [x] `.btn-primary` / `.btn-ghost` / `.icon-btn` 三个公共类已在 `index.css` 实现
- [x] `.card-hoverable` 公共类已实现（边框高光 + 抬升 + 阴影升级）
- [x] `.input-glow` focus 光晕已实现
- [x] `App.tsx` / `AgentChatCard.tsx` / `PlanViewer.tsx` / `ThinkingBlock.tsx` 中零散 hover 写法已替换为公共类
- [x] 输入框 focus 切换为新光晕效果

## Task 4 — 过渡动画统一
- [x] `@keyframes lift-in` 已新增并暴露 `.animate-lift-in`
- [x] `modal-in` / `modal-out` 升级为 scale(0.92→1) + opacity，曲线 `cubic-bezier(0.16, 1, 0.3, 1)`，时长 280ms
- [x] `@keyframes collapse-y` 新增并应用到 `.panel-collapse`
- [x] `toast-in` 升级为 220ms material 曲线
- [x] `@keyframes breathing-highlight` 新增并应用到 `.msg-breath`
- [x] App.tsx 消息列表渲染处新消息挂载 `.msg-breath` 类（历史消息不带）

## Task 5 — 玻璃拟态与主色调光晕
- [x] `.glass` 工具类已实现（半透明 + backdrop-blur + 1px 描边）
- [x] `.glow-hermes` 工具类已实现
- [x] `PlanViewer.tsx` 模态背景使用 `.glass`
- [x] `Toast.tsx` 容器使用 `.glass`
- [x] 头部品牌 Logo / 主操作按钮添加 `.glow-hermes`

## Task 6 — 性能与可访问性
- [x] `index.css` 顶部 `prefers-reduced-motion: reduce` 媒体查询已声明
- [x] 所有新动效仅使用 `transform` / `opacity`（无 layout/paint 触发）
- [x] backdrop-blur 仅用于模态框 / Toast / 浮动面板，不应用于整页 body

## Task 7 — 圆角 / 字体 / 间距统一
- [x] CSS 变量 `--radius-sm` / `--radius-md` / `--radius-lg` / `--radius-xl` 已声明
- [x] 字号与字重阶梯 CSS 变量已声明
- [x] 组件中散落的 `rounded-lg` / `rounded-xl` 数值已统一为阶梯值
- [x] 空状态 / 加载态使用统一金橙渐变 + 脉冲骨架屏

## Task 8 — 构建验证与回归
- [x] `npm run build` 无编译错误
- [x] Chromium 浏览器目视检查通过：背景层次 / 卡片光影 / 按钮 hover 抬升 / 模态框入场曲线 / Toast 玻璃质感 / 消息入场呼吸
- [x] 系统"减少动效"偏好下动效正确降级
- [x] DevTools Performance 录制滚动 / hover 交互 FPS ≥ 50
