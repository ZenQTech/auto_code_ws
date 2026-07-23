# Checklist: 跨 Session Memory（Hermes 内核管理）

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/cross-session-memory/spec.md)

---

## HermesMemoryManager 实现

- [x] hermes_memory.py 已创建
- [x] SessionSummary 数据类已实现
- [x] UserPreferences 数据类已实现
- [x] Skill 数据类已实现
- [x] HermesMemoryManager.__init__ 已实现（创建目录结构）
- [x] summarize_session 方法已实现（提取关键点 + 技术栈 + 存储）
- [x] extract_preferences 方法已实现（加载已有偏好 + 提取新偏好 + 合并存储）
- [x] generate_skills 方法已实现（分析项目类型 + 生成模板 + 存储）
- [x] load_session_memory 方法已实现
- [x] load_user_preferences 方法已实现
- [x] list_skills 方法已实现

## 文件持久化

- [x] ~/.hermes/memory/sessions/ 目录管理已实现
- [x] ~/.hermes/memory/skills/ 目录管理已实现
- [x] ~/.hermes/memory/user_preferences.json 读写已实现
- [x] 写入失败时优雅降级已实现（记录日志，不抛异常）

## 验证

- [x] Python 导入测试通过
- [x] 对话总结测试通过（正确提取关键点和技术栈）
- [x] 用户偏好测试通过（正确提取和合并编码风格、语言偏好）
- [x] Skills 生成测试通过（根据项目类型生成正确模板）
- [x] 文件持久化测试通过（数据正确写入和读取）
- [x] 记忆加载时间 < 500ms
