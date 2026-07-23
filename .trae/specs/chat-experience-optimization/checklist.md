# Checklist

## 后端模型变更
- [x] `models.py` 新增 `SessionStatus.DELETED` 枚举值
- [x] `Session` 模型新增 `deleted_at` 字段（DateTime, nullable）
- [x] `database.py` 启动时迁移添加 `deleted_at` 列

## 后端 API
- [x] `DELETE /api/sessions/{id}` 改为软删除（标记 deleted + deleted_at）
- [x] `POST /api/sessions/batch-delete` 接收 session_ids 数组，批量软删除
- [x] `GET /api/sessions/trash` 返回所有已删除会话
- [x] `POST /api/sessions/trash/restore` 恢复指定会话为 active
- [x] `DELETE /api/sessions/trash/empty` 硬删除所有已删除会话
- [x] `GET /api/config` 返回当前全局配置
- [x] `PUT /api/config` 写入全局配置到 yaml 文件
- [x] `trash_cleaner.py` 后台定时清理任务（每 60 分钟扫描 deleted_at > 7 天）

## 前端新建对话限制
- [x] 空对话时（messages.length === 0）新建按钮 disabled + 灰色样式
- [x] 有对话时新建按钮恢复正常

## 前端批量删除
- [x] 侧边栏批量删除模式入口按钮正常
- [x] 批量模式下会话项显示复选框
- [x] 复选框点击可选中/取消
- [x] "删除所选(X)"按钮显示选中数量
- [x] "取消"按钮退出批量模式
- [x] 确认后批量删除 API 调用成功，列表刷新

## 前端回收站
- [x] 侧边栏底部回收站入口（含数量徽章）
- [x] 回收站视图显示已删除会话列表
- [x] 每项显示标题、删除时间、剩余天数
- [x] "恢复"按钮可恢复单个会话
- [x] "清空回收站"按钮二次确认后硬删除

## 前端设置页面
- [x] 设置面板组件可正常渲染
- [x] 从 API 加载配置正确
- [x] 配置项按分组展示
- [x] 各类型输入组件正确（text/number/toggle）
- [x] 保存按钮调用 API 并显示成功 Toast
- [x] 设置/对话模式切换正常

## 集成测试
- [x] Session 模型迁移测试通过
- [x] 软删除/批量删除/回收站/恢复 API 功能测试通过
- [x] 配置读写 API 测试通过
- [x] 前端构建无编译错误
- [x] 测试临时文件已清理
- [x] 代码修改日志已更新
