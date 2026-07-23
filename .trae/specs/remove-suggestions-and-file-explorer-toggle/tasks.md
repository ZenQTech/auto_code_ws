# Tasks

- [x] Task 1: WelcomeState 删除 4 建议框
  - [x] 1.1 在 `frontend/src/components/WelcomeState.tsx` v1.1.0 → v1.2.0 删除 `items` 数组
  - [x] 1.2 删除 2x2 grid 容器
  - [x] 1.3 删除 Icon 组件中 code / translate / summarize / chat 4 个 inline SVG（保留 zap）
  - [x] 1.4 删除 QuickItem 接口
  - [x] 1.5 引导提问 `mb-12` 改为 `mb-0`
  - [x] 1.6 保留 props `onSelectPrompt` 签名（即使暂不触发）
  - [x] 1.7 文件头 v1.2.0 修改记录：`# - 2026-06-24 | v1.2.0 | 删除 4 个快速入口卡片（编程模式下为信息噪音）`

- [x] Task 2: FileExplorer 关闭按钮
  - [x] 2.1 在 `frontend/src/components/FileExplorer.tsx` v2.10.1 → v2.10.2 的 Props 接口新增 `onClose?: () => void`
  - [x] 2.2 在标题栏"刷新"按钮**右侧**增加"关闭"按钮（X SVG icon）
  - [x] 2.3 关闭按钮 onClick → `props.onClose()`
  - [x] 2.4 关闭按钮 hover `text-red-400`（关闭危险提示）
  - [x] 2.5 文件头 v2.10.2 修改记录：`# - 2026-06-24 | v2.10.2 | 标题栏新增关闭按钮（onClose 回调）`

- [x] Task 3: BrandHeader 文件浏览器切换项
  - [x] 3.1 在 `frontend/src/components/BrandHeader.tsx` v1.0.0 → v1.1.0 的 Props 接口新增 `fileExplorerOpen?: boolean; onOpenFileExplorer?: () => void;`（可选）
  - [x] 3.2 下拉菜单首位新增"文件浏览器"项（图标 FolderTree inline SVG）
  - [x] 3.3 菜单项顺序：文件浏览器 → 用量监控 → 设置 → 回收站
  - [x] 3.4 点击调 `onOpenFileExplorer()` + 关闭菜单
  - [x] 3.5 当 `fileExplorerOpen === true` 时菜单项右侧显示 ●（实心圆）；`false` 时显示 ○（空心圆）
  - [x] 3.6 文件头 v1.1.0 修改记录：`# - 2026-06-24 | v1.1.0 | 下拉菜单新增"文件浏览器"切换项（控制 fileExplorerOpen state）`

- [x] Task 4: App.tsx 集成 fileExplorerOpen state
  - [x] 4.1 在 `frontend/src/App.tsx` v2.10.0 → v2.10.1 新增 `const [fileExplorerOpen, setFileExplorerOpen] = useState(true);`
  - [x] 4.2 FileExplorer 容器宽度根据 state 动态切换：`fileExplorerOpen ? 'w-[280px]' : 'w-0 overflow-hidden'` + `transition-all duration-300 ease-expressive`
  - [x] 4.3 给 FileExplorer 传 `onClose={() => setFileExplorerOpen(false)}`
  - [x] 4.4 给 BrandHeader 传 `fileExplorerOpen={fileExplorerOpen}` + `onOpenFileExplorer={() => setFileExplorerOpen(prev => !prev)}`
  - [x] 4.5 文件头 v2.10.1 修改记录：`# - 2026-06-24 | v2.10.1 | fileExplorerOpen state + FileExplorer 渐变隐藏 + BrandHeader 切换入口`

- [x] Task 5: 构建与回归验证
  - [x] 5.1 后端 `python3 -c "from backend.app.main import app; print('OK')"` 启动无报错（exit 0，输出 OK）
  - [x] 5.2 前端 `vite build` 无编译错误（exit 0，0 错 0 警，42 modules transformed）
  - [x] 5.3 grep 验证 WelcomeState 已无 `items` 数组 / `grid-cols-2` / `iconKey:` / `QuickItem` 等关键词
  - [x] 5.4 grep 验证 FileExplorer 已有 `onClose` prop + X SVG 按钮（path `M6 18L18 6M6 6l12 12`）
  - [x] 5.5 grep 验证 BrandHeader 已有"文件浏览器"菜单项 + FolderTree icon + fileExplorerOpen 透传
  - [x] 5.6 grep 验证 App.tsx 已有 `fileExplorerOpen` state + `w-[280px]` / `w-0 overflow-hidden` 切换 + 透传
  - [x] 5.7 GUI 端到端：SKIPPED（无可用浏览器自动化环境）

# Task Dependencies
- Task 1（WelcomeState）独立 ✅
- Task 2（FileExplorer 关闭）独立 ✅
- Task 3（BrandHeader 菜单）独立 ✅
- Task 4（App.tsx 集成）依赖 Task 2 + 3 ✅
- Task 5（验证）依赖 Task 1-4 完成 ✅
