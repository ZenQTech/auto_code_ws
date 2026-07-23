# Checklist

## 全链路调试
- [x] 调试脚本已创建并运行
- [x] 所有连接点状态已打印

## 前端修复
- [x] App.tsx chatWithHermesStreaming 参数顺序正确
- [x] appMode 作为 sessionMode 传递
- [x] AbortController signal 传递
- [x] workflow_started SSE 事件处理
- [x] 工作流状态轮询

## 后端修复
- [x] hermes_service.py coding 模式检测正确
- [x] workflow_engine.start_workflow() 被调用
- [x] workflow_engine.start_workflow() 调用 ClarificationService
- [x] main.py 依赖注入完整

## 前端工作流展示
- [x] ClarificationCard 在 clarifying 阶段显示
- [x] ClarificationProgress 进度条显示
- [x] 工作流阶段状态可见

## 集成测试
- [x] 语法编译全部通过
- [x] 全链路连接验证通过
- [x] 功能完整性验证通过
- [x] 测试脚本已清理
