# 跨 Session Memory（Hermes 内核管理）Spec

> **来源**: [project-optimization-roadmap Task 7](file:///home/qizheng/auto_code_ws/.trae/specs/project-optimization-roadmap/spec.md)
> **优先级**: P2（智能化增强，独立开发）
> **依赖**: 无

## Why

借鉴 Hermes Agent（memory-first 架构）和 OMC（状态与记忆）的设计，由 Hermes 内核自动管理跨会话记忆。在用户对话及项目完成后进行总结与记忆，自动提取用户偏好，并编写可复用的 Skills。让平台越用越智能，减少重复沟通成本。

## What Changes

- **新增 HermesMemoryManager**：对话总结、用户偏好提取、Skills 自动生成
- **文件持久化**：`~/.hermes/memory/` 目录管理
- **数据类**：SessionSummary、UserPreferences、Skill

## Impact

- Affected specs: 无
- Affected code:
  - `hermes_integration/hermes_memory.py` — 新建

---

## ADDED Requirements

### Requirement: HermesMemoryManager 服务

系统 SHALL 在 `hermes_integration/hermes_memory.py` 中实现 HermesMemoryManager 类，由 Hermes 内核自动管理跨会话记忆。

#### Scenario: 对话总结
- **WHEN** 用户完成一次对话会话
- **THEN** `summarize_session(session_id, conversations)` 方法 SHALL：
  1. 提取用户消息中的关键点（关键词匹配：开发、实现、创建、设计、修复、优化、ROS、机器人、仿真等）
  2. 识别涉及的技术栈（Python、C++、ROS2、FastAPI、React、TypeScript、Docker、Gazebo 等）
  3. 生成会话摘要
  4. 存储到 `~/.hermes/memory/sessions/{session_id}.json`
  5. 返回 SessionSummary 对象
- **AND** SessionSummary SHALL 包含：
  - session_id: 会话 ID
  - title: 首条用户消息前 50 字
  - key_points: 关键点列表
  - decisions: 决策列表
  - technologies: 技术栈列表
  - summary: 摘要文本
  - created_at: 创建时间

#### Scenario: 用户偏好提取
- **WHEN** 用户完成一次对话会话
- **THEN** `extract_preferences(session_id, conversations)` 方法 SHALL：
  1. 加载已有偏好（从 `~/.hermes/memory/user_preferences.json`）
  2. 从对话中提取新偏好：
     - 编码风格（面向对象/函数式/简洁/健壮）
     - 语言偏好（Python/C++/TypeScript/JavaScript）
     - 框架偏好（ROS2/FastAPI/React）
  3. 合并并存储
  4. 返回 UserPreferences 对象
- **AND** UserPreferences SHALL 包含：
  - coding_style: 编码风格
  - preferred_languages: 语言偏好列表
  - preferred_frameworks: 框架偏好列表
  - project_background: 项目背景
  - common_patterns: 常用模式列表

#### Scenario: 自动编写 Skills
- **WHEN** 一个项目的工作流全部完成
- **THEN** `generate_skills(project_context)` 方法 SHALL：
  1. 分析项目类型和技术栈
  2. 识别可复用模式：
     - ROS2 项目 → 生成"ROS2 节点模板生成" Skill
     - FastAPI 项目 → 生成"FastAPI 路由模板生成" Skill
     - React 项目 → 生成"React 组件模板生成" Skill
  3. 每个 Skill 包含：name、description、category、content（代码模板）、tags
  4. 存储到 `~/.hermes/memory/skills/{skill_name}.json`
  5. 返回 Skill 列表

#### Scenario: 加载会话记忆
- **WHEN** 用户重新打开历史会话
- **THEN** `load_session_memory(session_id)` 方法 SHALL：
  1. 读取 `~/.hermes/memory/sessions/{session_id}.json`
  2. 返回 SessionSummary 对象
  3. 文件不存在时返回 None

#### Scenario: 加载用户偏好
- **WHEN** 系统需要了解用户偏好
- **THEN** `load_user_preferences()` 方法 SHALL：
  1. 读取 `~/.hermes/memory/user_preferences.json`
  2. 返回 UserPreferences 对象
  3. 文件不存在时返回默认空偏好

#### Scenario: 列出所有 Skills
- **WHEN** 用户需要查看可复用 Skills
- **THEN** `list_skills()` 方法 SHALL：
  1. 扫描 `~/.hermes/memory/skills/` 目录
  2. 解析所有 JSON 文件
  3. 返回 Skill 列表

---

### Requirement: 文件持久化

系统 SHALL 使用 `~/.hermes/memory/` 目录管理所有记忆数据。

#### Scenario: 目录结构
- **WHEN** HermesMemoryManager 初始化
- **THEN** SHALL 创建以下目录结构：
  ```
  ~/.hermes/memory/
  ├── sessions/          # 会话总结（{session_id}.json）
  ├── skills/            # 可复用 Skills（{skill_name}.json）
  └── user_preferences.json  # 用户偏好
  ```

#### Scenario: 数据格式
- **WHEN** 存储记忆数据
- **THEN** SHALL 使用 JSON 格式（ensure_ascii=False, indent=2）
- **AND** 写入失败时记录错误日志，不抛出异常

---

## 风险

| 风险 | 影响范围 | 概率 | 缓解措施 |
|------|----------|------|----------|
| 关键词匹配不准确 | 总结质量 | 中 | 使用关键词集合 + 技术栈字典 |
| Skills 模板不适用 | 复用价值 | 中 | 提供基础模板，用户可手动修改 |
| 文件存储冲突 | 数据一致性 | 低 | 每个 session 独立文件，无并发写入 |

## 成功标准

- 对话总结覆盖率 100%（每个会话完成后自动执行）
- Skills 自动生成准确率 > 70%（识别项目类型正确）
- 记忆加载时间 < 500ms
- 文件持久化零异常（写入失败不阻塞主流程）
