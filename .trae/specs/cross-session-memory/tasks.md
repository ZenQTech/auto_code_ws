# Tasks: 跨 Session Memory（Hermes 内核管理）

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/cross-session-memory/spec.md)

---

## Task 1: HermesMemoryManager 实现

- [x] 1.1 创建 `hermes_integration/hermes_memory.py`
- [x] 1.2 实现 `SessionSummary`、`UserPreferences`、`Skill` 数据类
- [x] 1.3 实现 `HermesMemoryManager.__init__(memory_dir)` 构造函数（创建目录结构）
- [x] 1.4 实现 `summarize_session(session_id, conversations) -> SessionSummary`
- [x] 1.5 实现 `extract_preferences(session_id, conversations) -> UserPreferences`
- [x] 1.6 实现 `generate_skills(project_context) -> List[Skill]`
- [x] 1.7 实现 `load_session_memory(session_id) -> Optional[SessionSummary]`
- [x] 1.8 实现 `load_user_preferences() -> UserPreferences`
- [x] 1.9 实现 `list_skills() -> List[Skill]`

## Task 2: 文件持久化

- [x] 2.1 实现 `~/.hermes/memory/sessions/` 目录管理
- [x] 2.2 实现 `~/.hermes/memory/skills/` 目录管理
- [x] 2.3 实现 `~/.hermes/memory/user_preferences.json` 读写
- [x] 2.4 实现写入失败时的优雅降级（记录日志，不抛异常）

## Task 3: 验证

- [x] 3.1 Python 导入测试：HermesMemoryManager 正确导入
- [x] 3.2 对话总结测试：从对话中正确提取关键点和技术栈
- [x] 3.3 用户偏好测试：正确提取和合并编码风格、语言偏好
- [x] 3.4 Skills 生成测试：根据项目类型生成正确模板
- [x] 3.5 文件持久化测试：数据正确写入和读取
- [x] 3.6 记忆加载时间 < 500ms

---

## 任务依赖关系

```
Task 1 (实现) → Task 2 (持久化) → Task 3 (验证)
```
