# Tasks

- [x] Task 1: 扩展 Tailwind theme（boxShadow / transitionTimingFunction / keyframes / 圆角阶梯）
  - 1.1 在 `tailwind.config.js` 中扩展 `boxShadow`，定义 4 级阴影（含 Hermes 金橙光晕专用色）
  - 1.2 扩展 `transitionTimingFunction`，加入 `material`、`expressive`、`spring` 三种 cubic-bezier
  - 1.3 扩展 `keyframes` 与 `animation`：新增 `glow-pulse`、`shimmer`、`lift`（hover 抬升）、`press`（按下）、`collapse-height`（高度过渡）
  - 1.4 在 theme 中暴露 `borderRadius` 阶梯（`sm`/`md`/`lg`/`xl`）
  - 1.5 在 `index.css` 顶部声明 CSS 变量：`--shadow-level-1..4`、`--ease-material` 等，便于组件复用

- [x] Task 2: 页面调性 - 全局背景与光影层
  - 2.1 在 `index.css` 重写 body 背景：surface-50 底色 + 顶部径向金橙高光（pseudo-element）
  - 2.2 添加 `.bg-noise` 工具类（细密 SVG 噪点纹理）应用到 body，并控制 opacity ≤ 0.04
  - 2.3 在 `index.html` 的 body class 上加 `bg-noise`，并在 `index.css` 暴露 `pointer-events: none` 确保不拦截点击

- [x] Task 3: Hover 动效统一 - 按钮 / 卡片 / 链接 / 输入框
  - 3.1 在 `index.css` 定义 `.btn-primary` / `.btn-ghost` / `.icon-btn` 三个公共类，统一样式与 hover 反馈（光晕 + 抬升 + 颜色过渡）
  - 3.2 在 `index.css` 定义 `.card-hoverable` 公共类，hover 时边框高光 + 抬升 + 阴影升级
  - 3.3 在 `index.css` 定义 `.input-glow` focus 光晕
  - 3.4 在 `App.tsx` / `AgentChatCard.tsx` / `PlanViewer.tsx` / `ThinkingBlock.tsx` 中替换零散的 hover 写法，统一调用上述公共类
  - 3.5 输入框 focus 切换为新的 `.input-glow` 效果

- [x] Task 4: 过渡动画统一 - 模态框 / 面板 / Toast / 消息入场
  - 4.1 在 `index.css` 新增 `@keyframes lift-in`（translateY + scale + opacity 组合）并定义 `.animate-lift-in`
  - 4.2 在 `index.css` 重写 `modal-in` / `modal-out` 为 scale(0.92) → 1 + opacity，曲线 `cubic-bezier(0.16, 1, 0.3, 1)`，时长 280ms
  - 4.3 在 `index.css` 新增 `@keyframes collapse-y`（用于面板展开 / 收起），应用到 `.panel-collapse`
  - 4.4 在 `index.css` 升级 toast-in 为 220ms material 曲线
  - 4.5 在 `index.css` 新增 `@keyframes breathing-highlight`（消息气泡首次出现时边框短暂一闪），应用到 `.msg-breath`
  - 4.6 在 `App.tsx` 消息列表渲染处，为每条新消息挂载 `.msg-breath` 类（仅新消息，列表中历史消息不带）

- [x] Task 5: 玻璃拟态与主色调光晕
  - 5.1 在 `index.css` 新增 `.glass` 工具类：`background: rgba(18,18,26,0.65); backdrop-filter: blur(12px); border: 1px solid rgba(255,255,255,0.08);`
  - 5.2 在 `index.css` 新增 `.glow-hermes` 工具类：`box-shadow: 0 0 24px rgba(240,160,48,0.35);`
  - 5.3 在 `PlanViewer.tsx` 模态背景使用 `.glass`，主面板保留实心 surface
  - 5.4 在 `Toast.tsx` 容器使用 `.glass`
  - 5.5 在 `App.tsx` 头部品牌 Logo / 主操作按钮上添加 `.glow-hermes`

- [x] Task 6: 性能与可访问性
  - 6.1 在 `index.css` 顶部声明 `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; } }`
  - 6.2 审查所有新动效是否仅使用 `transform` / `opacity`，避免触发 layout / paint
  - 6.3 backdrop-blur 仅用于模态框 / Toast / 浮动面板，不应用于整页 body

- [x] Task 7: 圆角 / 字体 / 间距统一
  - 7.1 在 `index.css` 暴露 CSS 变量：`--radius-sm: 6px`、`--radius-md: 10px`、`--radius-lg: 16px`、`--radius-xl: 24px`
  - 7.2 在 `index.css` 暴露字号阶梯变量与字重阶梯变量
  - 7.3 替换 `App.tsx` / 组件中所有 `rounded-lg` / `rounded-xl` 散落数值，统一改用 CSS 变量（或 Tailwind 对应阶梯）
  - 7.4 新增空状态 / 加载态统一插画或骨架屏（使用金橙渐变 + 脉冲）

- [x] Task 8: 构建验证与回归
  - 8.1 运行 `npm run build` 确保无编译错误
  - 8.2 在 Chromium 浏览器中目视检查：背景层次、卡片光影、按钮 hover 抬升、模态框入场曲线、Toast 玻璃质感、消息入场呼吸
  - 8.3 切换系统"减少动效"偏好，确认动效正确降级
  - 8.4 性能检查：DevTools Performance 面板录制滚动 / hover 交互，FPS ≥ 50，无明显掉帧

# Task Dependencies
- Task 1（theme 扩展）是所有后续任务的前置
- Task 2 / Task 5 / Task 6 可与 Task 1 同步开始
- Task 3 依赖 Task 1（依赖新的 transitionTimingFunction 与 boxShadow）
- Task 4 依赖 Task 1
- Task 7 依赖 Task 1
- Task 8 依赖 Task 1-7 全部完成
