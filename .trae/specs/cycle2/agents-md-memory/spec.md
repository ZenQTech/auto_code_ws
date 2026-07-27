# AGENTS.md Memory System - Spec

## 1. 功能需求

### 1.1 目标
实现 Codex 风格的 AGENTS.md Memory System：自动读取项目根目录的 AGENTS.md 文件并注入到 system prompt，让 LLM 了解项目特定规则。

### 1.2 用户场景
1. **场景 A：项目级规则**
   - 在项目根目录创建 AGENTS.md
   - 文件内容自动注入到所有 LLM 提示词

2. **场景 B：子目录规则**
   - 在子目录创建 AGENTS.md（如 frontend/AGENTS.md）
   - 工作在该目录时自动加载

3. **场景 C：自动发现**
   - 平台启动时自动扫描项目结构
   - 显示已加载的 AGENTS.md 列表

### 1.3 使用流程
```
项目根有 AGENTS.md → 启动时读取 → 缓存到内存 → 注入 LLM 提示词
```

## 2. 技术实现方案

### 2.1 数据模型

**AgentMemory 模型**：
```python
class AgentMemory(Base):
    id: str (UUID)
    project_path: str        # 项目根路径
    file_path: str           # AGENTS.md 完整路径
    relative_path: str       # 相对项目根的路径
    content: str             # 文件内容
    size: int                # 文件大小
    enabled: bool            # 是否启用注入
    last_loaded_at: datetime
    created_at: datetime
```

### 2.2 架构设计

```
┌──────────────────────────────────────────────────┐
│              AGENTS.md Memory Service              │
│  ┌────────────────┐  ┌─────────────────────┐    │
│  │ FileScanner    │  │ ContentCache        │    │
│  │ (walk project) │  │ (in-memory)         │    │
│  └────────────────┘  └─────────────────────┘    │
│  ┌──────────────────────────────────────────┐   │
│  │ PromptInjector                              │   │
│  │ - inject_into_prompt(memory, prompt)       │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## 3. 接口设计规范

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agents-md/scan` | POST | 扫描项目 AGENTS.md |
| `/api/agents-md/list` | GET | 列出已加载的 AGENTS.md |
| `/api/agents-md/{id}` | GET | 获取单个 AGENTS.md 内容 |
| `/api/agents-md/{id}/enable` | POST | 启用 |
| `/api/agents-md/{id}/disable` | POST | 禁用 |
| `/api/agents-md/inject-preview` | POST | 预览注入效果 |

## 4. 验收标准

- [ ] 自动扫描项目根目录
- [ ] 读取 AGENTS.md 内容
- [ ] 注入到 system prompt
- [ ] 启用/禁用工作
- [ ] API 端点全部工作
