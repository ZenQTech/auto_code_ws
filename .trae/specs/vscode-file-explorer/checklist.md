# Checklist

## 后端 API
- [x] `GET /api/workspace/projects` 返回项目列表
- [x] `POST /api/workspace/projects` 可创建项目目录
- [x] `GET /api/workspace/tree` 返回目录树 JSON
- [x] `GET /api/workspace/file` 返回文件内容
- [x] `api/__init__.py` 已注册 workspace 路由

## 项目选择器
- [x] 进入编程模式无项目时展示 ProjectSelector
- [x] "新建项目"可输入名称并创建
- [x] "打开已有项目"可列出并选择

## 文件资源管理器
- [x] 右侧面板显示完整目录树
- [x] 文件夹可展开/折叠（带箭头动画）
- [x] 文件有对应类型图标
- [x] 空目录显示提示文字
- [x] 单击文件触发选择

## 代码查看器
- [x] 单击文件在中间区域显示代码
- [x] 行号列正确显示
- [x] 多语言语法高亮（py/ts/tsx/js/json/yaml/md/html/css/cpp/h）
- [x] 不支持的类型显示提示

## 布局适配
- [x] 打开文件时聊天框移至左侧 Sidebar 区域
- [x] 右侧资源管理器保持可见
- [x] 关闭文件恢复默认布局

## 构建验证
- [x] 后端所有路由正常注册
- [x] 前端 npm run build 无编译错误
