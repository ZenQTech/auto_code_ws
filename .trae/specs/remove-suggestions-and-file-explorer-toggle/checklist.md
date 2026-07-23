# Checklist

## Task 1 — WelcomeState 删除 4 建议框
- [x] `WelcomeState.tsx` v1.1.0 → v1.2.0
- [x] `items` 数组已删除
- [x] 2x2 grid 容器已删除
- [x] Icon 组件中 code / translate / summarize / chat 4 个 SVG 已删除
- [x] `QuickItem` 接口已删除
- [x] 引导提问 `mb-12` 改为 `mb-0`
- [x] props `onSelectPrompt` 签名保留
- [x] 文件头 v1.2.0 修改记录已写入

## Task 2 — FileExplorer 关闭按钮
- [x] `FileExplorer.tsx` v2.10.1 → v2.10.2
- [x] Props 接口新增 `onClose?: () => void`
- [x] 标题栏"刷新"按钮右侧增加"关闭"按钮（X SVG）
- [x] 关闭按钮 onClick 触发 `props.onClose()`
- [x] 关闭按钮 hover `text-red-400`
- [x] 文件头 v2.10.2 修改记录已写入

## Task 3 — BrandHeader 文件浏览器切换项
- [x] `BrandHeader.tsx` v1.0.0 → v1.1.0
- [x] Props 新增 `fileExplorerOpen?: boolean; onOpenFileExplorer?: () => void;`（可选）
- [x] 下拉菜单首位新增"文件浏览器"项（FolderTree SVG）
- [x] 菜单顺序：文件浏览器 → 用量监控 → 设置 → 回收站
- [x] 点击触发 `onOpenFileExplorer()` + 关闭菜单
- [x] 菜单项右侧根据 `fileExplorerOpen` 显示 ● / ○
- [x] 文件头 v1.1.0 修改记录已写入

## Task 4 — App.tsx 集成 fileExplorerOpen state
- [x] `App.tsx` v2.10.0 → v2.10.1
- [x] `const [fileExplorerOpen, setFileExplorerOpen] = useState(true);` 已新增
- [x] FileExplorer 容器宽度动态切换：`w-[280px]` / `w-0 overflow-hidden`
- [x] 容器加 `transition-all duration-300 ease-expressive`
- [x] FileExplorer 接收 `onClose={() => setFileExplorerOpen(false)}`
- [x] BrandHeader 接收 `fileExplorerOpen` + `onOpenFileExplorer`
- [x] 文件头 v2.10.1 修改记录已写入

## Task 5 — 构建与回归
- [x] 后端启动无报错（exit 0，输出 OK）
- [x] 前端构建无编译错误（vite build 42 modules，0 错 0 警）
- [x] grep 验证 WelcomeState 已删除 4 建议框相关代码
- [x] grep 验证 FileExplorer 已增加 onClose + X SVG
- [x] grep 验证 BrandHeader 已增加"文件浏览器"菜单项
- [x] grep 验证 App.tsx 已增加 fileExplorerOpen state + 宽度切换
- [x] GUI 端到端：SKIPPED（无可用浏览器自动化环境）
