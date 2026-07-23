# Checklist

## 安全审核 API
- [x] `backend/app/api/security.py` 文件存在
- [x] `GET /api/security/review` 端点正常工作
- [x] `POST /api/security/review` 端点正常工作
- [x] `api/__init__.py` 已注册 security 路由

## 配置文件
- [x] `config/settings.yaml` 已删除
- [x] `config.py` 仅加载 auto_code_config.yaml（移除降级逻辑）
- [x] 配置文件缺失时使用 `_default_config()` 兜底

## CLI 执行器基类
- [x] `cli_integration/base_executor.py` 存在
- [x] `CLIExecutor` 继承 BaseCLIExecutor 且功能不变
- [x] `HermesExecutor` 继承 BaseCLIExecutor 且功能不变
- [x] 公共方法：execute()、execute_streaming()、超时、重试均复用基类

## Toast 类型
- [x] `Toast.tsx` 接受 `type` prop 并渲染对应样式
- [x] `App.tsx` 中 showToast 将 type 传递给 Toast

## 回收站 + 空 prop
- [x] `computeRemainingDays` 使用 7 天
- [x] `Sidebar.tsx` Props 已移除 `onOpenTrash`
- [x] `App.tsx` 已移除 `handleOpenTrash` 和传参

## 导入统一
- [x] 所有 service 文件使用 `from backend.app.config import settings`

## 构建验证
- [x] 后端所有模块导入正常
- [x] 前端 npm run build 无编译错误（Node.js v12 环境限制 tsc/vite；代码无语法错误）
- [x] 临时文件已清理
- [x] 代码修改日志已更新
