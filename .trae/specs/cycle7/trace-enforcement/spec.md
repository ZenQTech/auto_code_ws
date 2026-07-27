# Cycle 7 P0-11 Spec: TRACE Correction-to-Enforcement Pipeline

**版本**: v1.0.0
**日期**: 2026-07-27
**Cycle**: 7
**优先级**: P0

## 一、调研结论

### 1.1 The Access-Compliance Gap

Zhou et al. June 2026 paper "Getting Better at Working With You" 量化了 AI 编程助手的核心问题:
- 当领先的 memory layer (Mem0) 成功检索到存储的用户偏好时, agent 仍然 **57.5%** 的概率违反该偏好
- 检索到纠正 ≠ 强制执行纠正 (Access-Compliance Gap)
- 测试时规则获取与编译执行 (TRACE) 将 OOD 任务违规率从 100% 降低到 2.0%

**核心洞察**: 用户纠正应当**编译为运行时检查** (compile into runtime checks)，而不是仅作为**上下文存储** (persist as context)。

### 1.2 TRACE 三阶段架构

1. **Detection**: 从用户纠正消息中检测规则意图 (使用 LLM 分类)
2. **Compilation**: 将规则编译为三种可执行形式
3. **Enforcement**: 在 tool call 前后强制执行规则

### 1.3 三层执行 (Enforcement Tiers)

| Tier | 类型 | 实现方式 | 适用场景 |
|------|------|----------|----------|
| **Tier 1** | 确定性 (deterministic) | regex on tool calls / file names | 明确规则, 如"禁止编辑 .env" |
| **Tier 2** | 语义 (semantic) | model-based text and file checks | 需要理解的规则, 如"使用 snake_case" |
| **Tier 3** | 意图级 (intent-level) | runtime reminders for subjective preferences | 主观偏好, 如"代码风格简洁" |

### 1.4 与 Codex CLI Hook 集成

```
User Correction → TRACE Detection → Rule Storage → Hook Pipeline → PreToolUse 检查 → Allow/Deny
```

## 二、功能目标

实现 Hermes 平台的 TRACE 纠正-执行管道, 解决以下问题:
1. 用户在对话中说"不要用全局变量", 后续 LLM 调用 57% 的概率仍会使用全局变量
2. AGENTS.md 规则被检索但不被遵守
3. 用户偏好需要每次 session 重新输入

## 三、技术实现方案

### 3.1 后端模块

#### 3.1.1 `backend/app/services/trace_compiler.py` (核心)

**核心类**:
```python
class TraceCompiler:
    """将用户纠正消息编译为可执行规则"""

    async def detect_correction(self, user_message: str) -> Optional[CorrectionIntent]:
        """检测消息是否包含纠正意图"""
        # 1. 正则匹配明确的纠正模式 (e.g., "不要 X", "禁止 Y", "应该 Z")
        # 2. LLM 分类器 fallback (判断语义)
        # 3. 返回 None 表示非纠正消息

    async def compile_to_rule(self, intent: CorrectionIntent) -> CompiledRule:
        """将意图编译为可执行规则"""
        # - tier: 1 (deterministic) / 2 (semantic) / 3 (intent)
        # - check_fn: 可调用检查函数
        # - scope: rule / path / global
        # - priority: 1-10 (冲突解决)
```

**规则类型**:
- `PatternRule`: 工具调用名/参数匹配 (Tier 1)
- `FilePathRule`: 文件路径模式匹配 (Tier 1)
- `CodeStyleRule`: AST 级别代码风格 (Tier 2)
- `IntentRule`: 提示级别提醒 (Tier 3)

#### 3.1.2 `backend/app/services/rule_store.py` (存储)

**存储结构** (SQLite):
```sql
CREATE TABLE compiled_rules (
    rule_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    scope TEXT NOT NULL,  -- 'session' | 'user' | 'global'
    tier INTEGER NOT NULL,  -- 1/2/3
    rule_type TEXT NOT NULL,  -- 'pattern'/'file_path'/'code_style'/'intent'
    rule_data JSON NOT NULL,  -- 规则具体内容
    original_message TEXT NOT NULL,
    source_message_id TEXT,
    created_at REAL NOT NULL,
    hit_count INTEGER DEFAULT 0,
    violation_count INTEGER DEFAULT 0
);
```

**API**:
- `add_rule(rule) -> str` 返回 rule_id
- `get_active_rules(session_id, scope) -> List[CompiledRule]`
- `record_violation(rule_id, context) -> None`
- `deactivate_rule(rule_id) -> None`

#### 3.1.3 `backend/app/services/enforcement_engine.py` (执行)

**核心逻辑**:
```python
class EnforcementEngine:
    """在 tool call 前后强制执行规则"""

    async def pre_tool_check(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        session_id: str,
    ) -> EnforcementResult:
        """PreToolUse 阶段: 检查是否允许执行"""
        # 1. 获取所有 active rules
        # 2. 按 tier 顺序检查 (1 → 2 → 3)
        # 3. 返回 allow / deny / warn
        # deny: 阻止执行并返回 reason
        # warn: 允许执行但记录警告

    async def post_tool_check(
        self,
        tool_name: str,
        tool_args: Dict[str, Any],
        tool_result: Any,
        session_id: str,
    ) -> EnforcementResult:
        """PostToolUse 阶段: 检查执行结果是否违反规则"""
        # 用于检查文件修改/创建是否符合规则
```

**EnforcementResult**:
```python
@dataclass
class EnforcementResult:
    allowed: bool
    rule_id: Optional[str] = None
    reason: Optional[str] = None
    suggestion: Optional[str] = None
    tier: Optional[int] = None
```

#### 3.1.4 `backend/app/api/trace.py` (REST API)

**端点**:
- `POST /api/trace/compile` - 编译用户消息为规则
- `GET /api/trace/rules` - 列出 active rules
- `DELETE /api/trace/rules/{rule_id}` - 停用规则
- `GET /api/trace/stats` - 规则命中/违规统计
- `POST /api/trace/check` - 手动执行预检查 (测试)

### 3.2 前端模块

#### 3.2.1 `frontend/src/components/RulePanel.tsx`

**UI 组件**:
- 规则列表 (active/inactive)
- 规则详情 (tier / scope / hit count / violation count)
- 添加规则 (输入自然语言 → 编译 → 预览)
- 规则统计仪表板

#### 3.2.2 `frontend/src/hooks/useRuleStore.ts`

**Hook**:
```typescript
const {
  rules,           // 当前所有规则
  activeRules,     // 仅 active 规则
  stats,           // 命中/违规统计
  compileRule,     // 编译自然语言为规则
  deactivateRule,  // 停用规则
  checkToolCall,   // 手动检查
} = useRuleStore(sessionId);
```

#### 3.2.3 `frontend/src/components/EnforcementIndicator.tsx`

**对话内联组件**:
- 在 LLM 响应中显示规则执行状态
- 显示被阻止的工具调用
- 显示警告提示

### 3.3 与现有 P0-6 Hook 系统集成

```python
# 在 PreToolUse Hook 中调用 enforcement
async def pre_tool_use_hook(tool_name, tool_args, session_id):
    # 现有 Hook 逻辑...

    # 新增: TRACE Enforcement
    enforcement = await enforcement_engine.pre_tool_check(
        tool_name, tool_args, session_id
    )
    if not enforcement.allowed:
        return HookResponse(
            decision="block",
            reason=enforcement.reason,
            suggestion=enforcement.suggestion,
        )
    return HookResponse(decision="allow")
```

## 四、接口设计

### 4.1 编译用户消息 API

**Request**:
```json
POST /api/trace/compile
{
  "session_id": "default",
  "user_message": "不要使用全局变量",
  "message_id": "msg-123"
}
```

**Response**:
```json
{
  "success": true,
  "rule_id": "rule-abc-123",
  "compiled_rule": {
    "tier": 2,
    "rule_type": "code_style",
    "rule_data": {
      "check": "no_global_variables",
      "languages": ["python", "javascript", "typescript"]
    },
    "preview": "禁止使用全局变量"
  }
}
```

### 4.2 预检查 API

**Request**:
```json
POST /api/trace/check
{
  "session_id": "default",
  "tool_name": "edit_file",
  "tool_args": {
    "file_path": "/src/main.py",
    "new_content": "GLOBAL_VAR = 42"
  }
}
```

**Response**:
```json
{
  "allowed": false,
  "rule_id": "rule-abc-123",
  "reason": "检测到全局变量 GLOBAL_VAR, 违反规则 'no_global_variables'",
  "suggestion": "请使用函数参数或类成员变量替代",
  "tier": 2
}
```

## 五、数据结构定义

### 5.1 CompiledRule

```python
@dataclass
class CompiledRule:
    rule_id: str
    session_id: str
    scope: str  # 'session' | 'user' | 'global'
    tier: int  # 1=deterministic, 2=semantic, 3=intent
    rule_type: str  # 'pattern' | 'file_path' | 'code_style' | 'intent'
    rule_data: Dict[str, Any]
    original_message: str
    source_message_id: Optional[str]
    created_at: float
    is_active: bool = True
    hit_count: int = 0
    violation_count: int = 0
```

### 5.2 CorrectionIntent

```python
@dataclass
class CorrectionIntent:
    is_correction: bool
    category: str  # 'prohibition' | 'requirement' | 'preference' | 'style'
    target: str  # 'code' | 'tool' | 'file' | 'general'
    subject: str  # 被纠正的具体对象
    desired_behavior: str  # 用户期望的行为
    confidence: float  # 0-1
```

### 5.3 EnforcementResult

```python
@dataclass
class EnforcementResult:
    allowed: bool
    rule_id: Optional[str] = None
    reason: Optional[str] = None
    suggestion: Optional[str] = None
    tier: Optional[int] = None
    check_time_ms: float = 0.0
```

## 六、性能与安全要求

### 6.1 性能

- 编译延迟: < 500ms (含 LLM 调用)
- 预检查延迟: < 50ms (Tier 1/2 不调 LLM)
- 规则查询: < 10ms (SQLite 索引)
- 内存占用: 每规则 < 1KB

### 6.2 安全

- 规则内容需做 XSS 过滤 (前端展示)
- LLM 编译结果需有 confidence 阈值 (默认 0.6)
- 规则数量上限: 每 session 100 条
- 违规自动 disable: 同一规则连续 5 次误报则自动停用

## 七、验收标准

### 7.1 功能验收

- [x] 用户输入"不要 X"消息后, 系统能自动编译为规则
- [x] 后续 LLM 调用若执行 X, 工具调用被阻止
- [x] 用户可查看/编辑/停用规则
- [x] 规则统计正确 (hit_count / violation_count)
- [x] 三层 enforcement 全部工作 (Tier 1/2/3)

### 7.2 测试覆盖

- 单元测试: 30+ 用例 (编译/存储/执行/集成)
- E2E 测试: 20+ 场景 (完整流程)
- TypeScript: 0 errors
- Vite 构建: 成功

### 7.3 性能验收

- 编译延迟 P95 < 500ms
- 预检查延迟 P95 < 50ms
- 内存占用: 100 条规则 < 100KB

## 八、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| LLM 误判用户意图 | 中 | confidence 阈值 + 二次确认 |
| 规则冲突 | 中 | priority 字段 + tier 优先级 |
| 过度阻断正常工具调用 | 高 | hit/violation 比值监控 + 自动 disable |
| SQLite 并发问题 | 低 | WAL 模式 + 锁机制 |
| 前端 XSS | 中 | React 自动转义 + CSP 头 |

## 九、参考资源

- Zhou et al. June 2026 "Getting Better at Working With You" - TRACE 论文
- [Codex CLI Hooks 文档](https://docs.codex.com/hooks)
- [TRAE Rules 配置](https://docs.trae.ai/ide/rules)
- 现有 P0-6 Hook 系统 (HookBridgeService + HookChainStore)

## 十、版本演进

- v1.0.0: 基础 TRACE 编译 + 执行
- v1.1.0: 规则自动 disable (误报率监控)
- v1.2.0: 规则导入/导出 (跨 session)
- v1.3.0: 规则模板库 (常用规则)
- v2.0.0: 跨平台规则同步 (云端)
