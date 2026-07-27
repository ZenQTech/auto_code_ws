# Skills 插件系统 - Spec

## 1. 功能需求

### 1.1 目标
实现 Codex 风格的 Skills 插件系统，允许用户自定义工具和工作流，扩展 LLM 的能力。

### 1.2 用户场景
1. **场景 A：使用内置 Skills**
   - 平台提供"代码审查"、"测试生成"等内置 Skills
   - 用户可在 Skills 面板中启用/禁用

2. **场景 B：用户自定义 Skills**
   - 用户编写 Skill YAML 配置（name、description、prompt、tools）
   - 上传后即可在会话中使用

3. **场景 C：团队共享 Skills**
   - 团队维护一个 Skills 仓库
   - 用户从仓库拉取并启用

### 1.3 使用流程
```
用户/系统创建 Skill → 注册到平台 → 注入 LLM 提示词 → LLM 在需要时调用
```

## 2. 技术实现方案

### 2.1 数据模型

**Skill 模型**：
```python
class Skill(Base):
    id: str (UUID)
    name: str (唯一)         # "code-reviewer"
    display_name: str        # "代码审查"
    description: str         # 一句话说明
    system_prompt: str       # 注入到 LLM 的提示词
    tools: JSON              # 关联的工具列表
    enabled: bool            # 是否启用
    source: str              # "builtin" | "user" | "team"
    version: str             # 语义化版本
    created_at: datetime
    updated_at: datetime
```

### 2.2 架构设计

```
┌──────────────────────────────────────────────────┐
│              Skills Service                       │
│  ┌────────────────┐  ┌─────────────────────┐    │
│  │ SkillRegistry  │  │ SkillLoader         │    │
│  │ (in-memory)    │  │ (YAML/JSON)         │    │
│  └────────────────┘  └─────────────────────┘    │
│  ┌──────────────────────────────────────────┐   │
│  │ SkillInjector                              │   │
│  │ - build_system_prompt(enabled_skills)     │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### 2.3 核心算法
- 启用技能：检测是否在 enabled_skills 列表中
- 提示词构建：拼接所有 enabled skill 的 system_prompt
- 工具注入：根据 skill.tools 自动注入 MCP 工具

## 3. 接口设计规范

### 3.1 后端 API

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/skills` | GET | 列出所有 Skills |
| `/api/skills` | POST | 创建 Skill |
| `/api/skills/{id}` | GET | 获取 Skill 详情 |
| `/api/skills/{id}` | PUT | 更新 Skill |
| `/api/skills/{id}` | DELETE | 删除 Skill |
| `/api/skills/{id}/enable` | POST | 启用 Skill |
| `/api/skills/{id}/disable` | POST | 禁用 Skill |
| `/api/skills/{id}/prompt` | GET | 获取拼接的 system prompt |

## 4. 数据结构定义

```python
class Skill(BaseModel):
    name: str
    display_name: str
    description: str
    system_prompt: str
    tools: List[str] = []
    enabled: bool = True
    source: str = "user"  # builtin | user | team
    version: str = "1.0.0"
```

## 5. 性能与安全要求

- 启用/禁用响应：< 100ms
- 提示词拼接：< 50ms
- 安全：内置 Skill 不可删除

## 6. 验收标准

- [ ] 内置 3 个 Skills（代码审查、测试生成、文档生成）
- [ ] 启用/禁用 Skills 工作
- [ ] 提示词正确拼接
- [ ] Skills 列表 API 正确返回
- [ ] Skills 创建/更新/删除 API 工作
