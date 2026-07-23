# Checklist

## Session 模型
- [x] `sessions.mode` 列存在，默认值为 `'chat'`
- [x] `models.py` 中 Session 类包含 `mode` 属性
- [x] `database.py` 迁移逻辑自动补全旧数据的 mode 列
- [x] 前端 `Session` 类型含 `mode: 'chat' | 'coding'`

## 后端 API
- [x] `POST /api/sessions` 接受 `mode` 参数写入新会话
- [x] `GET /api/sessions` 支持 `mode` 查询参数过滤

## 模式选择页
- [x] 首次进入（无 localStorage 偏好）展示 ModeSelector
- [x] 点击卡片后设置 appMode 并存入 localStorage
- [x] 已有偏好时直接跳过选择页

## 侧边栏
- [x] 顶部显示模式切换控件（两个小按钮）
- [x] 会话列表仅显示当前模式的会话
- [x] 新建会话时透传 `appMode` 到后端

## 界面适配
- [x] 顶部栏显示当前模式标识
- [x] 闲聊模式隐藏"优化提示词"按钮和 PlanViewer
- [x] 闲聊模式下仅发送 Hermes 对话请求

## 构建验证
- [x] 后端所有路由正常注册
- [x] 前端 npm run build 无编译错误
- [x] 临时文件已清理
- [x] 代码修改日志已更新
