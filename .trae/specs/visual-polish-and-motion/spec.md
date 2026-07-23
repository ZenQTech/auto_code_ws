# 页面调性 / 光影质感 / Hover 与过渡动效 深度优化 Spec

## Why
当前前端已完成基础配色统一与组件清理（`frontend-beautification`），但页面整体仍偏"扁平化"：缺少光影层次（无 box-shadow / glow / 玻璃拟态质感），交互反馈以颜色变化为主（缺少 hover 动效的丰富度），状态切换与面板展开的过渡曲线生硬。本次需求聚焦"页面调性、光影质感、hover 动效、过渡动画"四个维度，做一次系统性的视觉品质深化，让界面在"专业感、精致度、交互愉悦感"上有明显提升。

## What Changes
- 引入层次化光影系统：分级 box-shadow、内/外发光、玻璃拟态背景（backdrop-blur）、径向/线性渐变、噪点纹理
- 强化页面调性：背景增加大气感（径向高光、渐变光晕、细腻纹理），主操作区与次要区形成清晰视觉层次
- 系统化 hover 动效：所有可交互元素（按钮、卡片、链接、消息气泡）添加统一的 hover 反馈（光晕扩散、轻微抬升、颜色平滑过渡、scale 微调）
- 平滑过渡动画：统一过渡曲线（cubic-bezier），为面板展开/收起、模态框、Toast、消息入场、按钮按下等所有状态变化添加 spring/缓动动画
- 性能与可访问性：所有动效尊重 `prefers-reduced-motion`，避免触发大型重排，使用 transform/opacity 走 GPU 合成

## Impact
- Affected specs: `frontend-beautification`（基础配色与组件清理已完成，本次在其之上深化）
- Affected code:
  - `frontend/src/index.css`（全局光影变量、动效关键帧、玻璃拟态工具类）
  - `frontend/tailwind.config.js`（扩展 transitionTimingFunction、boxShadow、keyframes/animation）
  - `frontend/src/App.tsx`（页面背景、消息气泡、输入区、按钮 hover/active 样式升级）
  - `frontend/src/components/AgentChatCard.tsx`（卡片 hover 抬升 + 光晕）
  - `frontend/src/components/Toast.tsx`（Toast 进场/退场曲线与阴影）
  - `frontend/src/components/PlanViewer.tsx`（模态框光影与背景模糊）
  - `frontend/src/components/ThinkingBlock.tsx`（思考块折叠/展开过渡）
  - `frontend/index.html`（body 背景层）

---

## ADDED Requirements

### Requirement: 光影质感系统
系统 SHALL 提供分级光影与材质表达，让界面元素具有"立体感"与"质感"，而非纯扁平填充。

#### Scenario: 主操作区卡片
- **WHEN** 用户查看 AgentChatCard / 用量面板 / 计划内容
- **THEN** 卡片具备 `box-shadow`（多层叠加：近距浅阴影 + 远距深阴影），与 surface 背景形成清晰层次；hover 时阴影加深并轻微抬升（translateY -2px）

#### Scenario: 玻璃拟态效果
- **WHEN** 模态框 / Toast / 浮动面板显示
- **THEN** 背景使用 `backdrop-filter: blur(...)` 半透明 + 1px 内描边，呈现玻璃质感而非实心面板

#### Scenario: 主色调光晕
- **WHEN** 主操作按钮 / 品牌 Logo / 关键标识
- **THEN** 周围具备柔和的 Hermes 金橙色光晕（box-shadow 0 0 N px rgba(240,160,48, .x)），强调品牌身份

#### Scenario: 页面背景层次
- **WHEN** 页面加载
- **THEN** body 背景由纯色升级为多层叠加：底层 surface-50 + 顶部径向高光（中心淡橙光晕）+ 细微噪点纹理，避免大色块视觉疲劳

---

### Requirement: Hover 动效统一规范
所有可交互元素 SHALL 在 hover 时有统一规范的视觉反馈，光、色、位移、阴影协同变化。

#### Scenario: 按钮 hover
- **WHEN** 用户悬停主操作按钮
- **THEN** 颜色由 hermes-500 → hermes-400 平滑过渡 200ms，背景光晕扩散 1.2 倍，translateY -1px 抬升，box-shadow 加深

#### Scenario: 卡片 hover
- **WHEN** 用户悬停 AgentChatCard / 消息气泡 / 计划项
- **THEN** 边缘出现 1px Hermes 金橙高光描边（透明度 0 → 0.5），translateY -2px 抬升，阴影从 level-1 升级到 level-2，200ms cubic-bezier(0.4, 0, 0.2, 1)

#### Scenario: 链接 / 图标 hover
- **WHEN** 用户悬停链接或图标按钮
- **THEN** 颜色由 surface-700 → hermes-400，附带 1px 光晕，180ms 过渡

#### Scenario: 输入框 focus
- **WHEN** 用户聚焦到消息输入框
- **THEN** 边框由 surface-500 → hermes-500，外围 0 0 0 3px hermes-500/20 光晕扩散

---

### Requirement: 过渡动画曲线与时长统一
所有状态切换 SHALL 使用统一过渡曲线（cubic-bezier(0.4, 0, 0.2, 1) 或 spring 类曲线），并按交互类型分级时长（瞬时 100ms / 默认 200ms / 大型 300ms / 弹性 400ms）。

#### Scenario: 面板展开 / 收起
- **WHEN** 用户切换用量监控面板 / 计划详情
- **THEN** 面板以 scale-Y + opacity + translateX 组合动画 280ms 缓动展开/收起，使用 `cubic-bezier(0.16, 1, 0.3, 1)` 缓出曲线（material expressive）

#### Scenario: 模态框打开 / 关闭
- **WHEN** PlanViewer 模态框打开
- **THEN** 背景遮罩以 opacity 200ms 淡入，主面板以 scale(0.92) → scale(1) + opacity 280ms 缓入；关闭时反向播放

#### Scenario: Toast 出现 / 消失
- **WHEN** Toast 触发
- **THEN** 从顶部 translateY(-16px) + opacity 0 滑入 220ms，自动消失时反向 180ms 滑出

#### Scenario: 消息入场
- **WHEN** 用户发送消息或收到 Hermes 回复
- **THEN** 消息气泡以 translateY(8px) + opacity 0 → 0,1，240ms 缓出，并带 0.3s 内的"轻微呼吸"高光（首次出现时边框短暂一闪）

#### Scenario: 按钮按下反馈
- **WHEN** 用户点击任意按钮
- **THEN** 按下时 scale(0.97) + 阴影变浅，松开回弹 100ms 缓出（spring-like）

#### Scenario: 思考块折叠 / 展开
- **WHEN** 用户点击 ThinkingBlock 折叠
- **THEN** 高度以 240ms 缓动收起，内容区域 opacity 同步淡出

---

### Requirement: 动效性能与可访问性
所有动效 SHALL 走 GPU 合成（transform / opacity 优先），并尊重 `prefers-reduced-motion: reduce` 媒体查询。

#### Scenario: 动画硬件加速
- **WHEN** 任意元素有动效
- **THEN** 优先使用 transform（translate / scale / rotate）与 opacity，避免触发 layout / paint

#### Scenario: 减少动效偏好
- **WHEN** 用户系统设置启用 `prefers-reduced-motion: reduce`
- **THEN** 所有非必要动效降级为瞬时切换（duration: 0.01ms），但保留必要状态指示（如 focus 光晕）

#### Scenario: 阴影 / 模糊性能
- **WHEN** 渲染大尺寸 backdrop-blur
- **THEN** 仅在顶层模态框 / Toast 使用，避免整页背景使用 backdrop-blur 造成滚动卡顿

---

### Requirement: 页面调性细节统一
页面 SHALL 在字体、间距、圆角、阴影等微观层面保持一致调性，避免视觉碎片化。

#### Scenario: 圆角分级
- **WHEN** 渲染任意容器
- **THEN** 圆角按层级使用：sm 6px（标签 / 徽章） / md 10px（输入框 / 按钮） / lg 16px（卡片 / 面板） / xl 24px（模态框），统一通过 Tailwind theme 暴露

#### Scenario: 字体层次
- **WHEN** 渲染文本
- **THEN** 标题 / 正文 / 辅助文字使用统一字号阶梯（12 / 14 / 16 / 18 / 24 / 32），字重阶梯（400 / 500 / 600 / 700），并在 `index.css` 暴露 CSS 变量便于复用

#### Scenario: 加载与空状态
- **WHEN** 数据加载中 / 列表为空
- **THEN** 使用统一的金橙色骨架屏（脉冲渐变）或空状态插画，与主调性一致
