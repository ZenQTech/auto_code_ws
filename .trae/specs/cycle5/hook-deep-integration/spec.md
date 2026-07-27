# P0-6 Hook 事件深度集成 Spec

> **Spec 版本**: v1.0.0
> **创建日期**: 2026-07-27
> **Cycle**: 5
> **关联**: Cycle 4 P0-4 Hooks 基础 + Codex v0.150+ Hooks 规范

---

## 一、目标

将 Hook 事件系统从「配置 + 手动触发」升级为「配置 + 自动触发 + 业务集成」，实现：

1. **Codex 风格 JSON 输出控制**：支持 `hookSpecificOutput.additionalContext` / `permissionDecision` 字段
2. **自动触发点集成**：在关键业务流程点自动触发 Hook（无需 API 调用）
3. **上下文注入**：Hook 可向 LLM 注入额外上下文
4. **权限决策覆盖**：Hook 可覆盖默认权限决策
5. **事件链可视化**：前端展示完整 Hook 触发链路

---

## 二、功能需求

### 2.1 Codex 风格 JSON 输出控制

**Codex v0.150+ 规范**：
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": "用户偏好：使用 pnpm 而不是 npm",
    "permissionDecision": "allow" | "deny" | "ask"
  }
}
```

**实现要求**：
- HookAction 新增 `hook_specific_output` 字段
- 解析 hook 命令输出时识别 `hookSpecificOutput` JSON
- 提供工具函数从 HookAction 提取 `additionalContext` 和 `permissionDecision`

### 2.2 自动触发点集成

**核心触发点**（按事件类型）：

| 事件 | 触发位置 | 触发时机 |
|------|---------|----------|
| `SessionStart` | Session 创建后 | 会话初始化完成时 |
| `UserPromptSubmit` | HermesService 用户消息入口 | 发送到 LLM 之前 |
| `PreToolUse` | ToolExecutor 工具调用前 | MCP 工具执行前 |
| `PostToolUse` | ToolExecutor 工具调用后 | 工具返回结果后 |
| `PermissionRequest` | PermissionSystem 权限申请 | 需要用户决策时 |
| `PreCompact` | Compaction 压缩前 | 双触发压缩启动时 |
| `PostCompact` | Compaction 压缩后 | 压缩完成时 |
| `SubagentStart` | AgentManager 创建 SubAgent | SubAgent 启动时 |
| `SubagentStop` | AgentManager 销毁 SubAgent | SubAgent 停止时 |
| `SessionEnd` | Session 销毁前 | 会话清理时 |

**实现方式**：
- 创建 `hook_bridge.py` 服务，封装 10 个触发方法
- 在现有 services 关键点调用对应触发方法
- 触发方法支持 async/await，不阻塞主流程（用 try/except 包裹）

### 2.3 上下文注入（additionalContext）

**使用场景**：
```python
# 在 PreToolUse 触发后，收集所有返回 additionalContext 的 hook
context_injections = []
for action in actions:
    if action.hook_specific_output:
        ctx = action.hook_specific_output.get("additionalContext")
        if ctx:
            context_injections.append(ctx)

# 注入到 LLM 系统消息
if context_injections:
    augmented_system_msg = original_system + "\n\n[Hook 注入上下文]\n" + "\n".join(context_injections)
```

**集成点**：
- UserPromptSubmit：注入到 system prompt 末尾
- PreToolUse：注入到工具执行前的 system reminder
- PostToolUse：注入到下一轮 LLM 调用的 user context

### 2.4 权限决策覆盖（permissionDecision）

**使用场景**：
```python
# 在 PermissionRequest 触发后，检查 hook 是否覆盖决策
for action in actions:
    if action.hook_specific_output:
        decision = action.hook_specific_output.get("permissionDecision")
        if decision:
            # override 默认决策
            final_decision = decision
            break
```

**集成点**：
- PermissionRequest：覆盖 MCP 权限管理器的默认 allow/deny/ask 决策

### 2.5 前端事件链路可视化

**HookChainViewer 组件**：
- 显示最近 50 条 hook 触发记录
- 每条记录：事件名 / 触发时间 / 耗时 / 退出码 / additionalContext / permissionDecision
- 按 session_id / agent_id 过滤
- 实时更新（每 2s 拉取一次 / 自动刷新）

---

## 三、接口设计

### 3.1 后端新增 API 端点

| 方法 | 路径 | 功能 |
|------|------|------|
| GET | `/api/hooks/chain` | 获取最近 hook 触发链路 |
| GET | `/api/hooks/chain/{session_id}` | 按 session 过滤触发链路 |
| POST | `/api/hooks/inject` | 手动注入 context（用于测试） |

### 3.2 HookAction 新增字段

```python
@dataclass
class HookAction:
    # ... 已有字段
    hook_specific_output: Optional[Dict[str, Any]] = None  # Codex 风格 JSON 输出
    additional_context: Optional[str] = None                  # 提取的 additionalContext
    permission_decision: Optional[str] = None                # 提取的 permissionDecision
```

### 3.3 HookBridgeService 接口

```python
class HookBridgeService:
    async def fire_session_start(self, session_id: str, user_id: str) -> List[HookAction]: ...
    async def fire_user_prompt_submit(self, user_input: str, session_id: str) -> Tuple[List[HookAction], str]: ...
    async def fire_pre_tool_use(self, tool_name: str, arguments: Dict) -> Tuple[List[HookAction], str]: ...
    async def fire_post_tool_use(self, tool_name: str, result: Any, duration_ms: float) -> List[HookAction]: ...
    async def fire_permission_request(self, tool_name: str, arguments: Dict) -> Tuple[List[HookAction], Optional[str]]: ...
    async def fire_pre_compact(self, trigger: str, context_size: int) -> List[HookAction]: ...
    async def fire_post_compact(self, original_size: int, new_size: int) -> List[HookAction]: ...
    async def fire_subagent_start(self, subagent_id: str, task: str) -> List[HookAction]: ...
    async def fire_subagent_stop(self, subagent_id: str, result: str) -> List[HookAction]: ...
    async def fire_session_end(self, session_id: str, duration_ms: float) -> List[HookAction]: ...
```

---

## 四、数据结构

### 4.1 HookChainEntry（前端展示用）

```python
@dataclass
class HookChainEntry:
    id: str
    event: str
    session_id: Optional[str]
    agent_id: Optional[str]
    hook_name: str
    exit_code: int
    duration_ms: float
    additional_context: Optional[str]
    permission_decision: Optional[str]
    timestamp: float
    is_blocking: bool
```

### 4.2 HookBridge 错误处理

- Hook 失败不应阻塞主流程：用 try/except 包裹
- Hook 超时：使用较短 timeout（默认 10s）避免影响响应
- 记录失败：写入 history 但不抛出异常

---

## 五、性能与安全要求

### 5.1 性能指标
- Hook 触发延迟：< 50ms（无外部命令调用时）
- 单 hook 命令执行：< 5s（默认 timeout）
- 整链 hook 调用：< 10s
- 历史记录：最近 200 条（FIFO）

### 5.2 安全要求
- Hook 命令不允许访问环境变量中的敏感信息（API key 等）
- Hook 命令超时硬上限：60s
- Hook 错误日志脱敏：API key/token 替换为 ***
- Hook 不允许修改 LLM 关键系统提示（只能追加）

---

## 六、验收标准

### 6.1 功能验证
- [ ] 10 种事件全部支持自动触发
- [ ] JSON 输出 `hookSpecificOutput.additionalContext` 正确解析
- [ ] JSON 输出 `hookSpecificOutput.permissionDecision` 正确解析
- [ ] UserPromptSubmit 触发后 additionalContext 注入到 system prompt
- [ ] PreToolUse 触发后 permissionDecision 覆盖默认决策
- [ ] 前端 HookChainViewer 显示完整链路

### 6.2 测试用例
- [ ] 单元测试：HookAction 字段解析（10 个）
- [ ] 单元测试：HookBridge 10 个触发方法（20 个）
- [ ] 单元测试：JSON 输出解析（5 个）
- [ ] E2E 测试：完整 hook 链路（10 个）
- [ ] E2E 测试：权限覆盖链路（5 个）
- [ ] 浏览器测试：HookChainViewer 显示（3 个）
- 预计 53 个测试用例 100% 通过

### 6.3 质量指标
- TypeScript 严格模式编译：0 错误
- Vite 构建：< 15s
- 后端单元 + E2E 测试：53+ 全部通过
- 功能覆盖率提升：5%+

---

## 七、风险与回滚

### 7.1 风险
- 集成到现有 service 可能引入回归 bug
- Hook 超时可能影响正常业务流
- additionalContext 注入可能干扰 LLM 输出

### 7.2 回滚方案
- HookBridge 是可选服务（try/except 包裹）
- 关闭全局 hooks 即可停用（不修改 service 调用点）
- 保留 v1.0.0 行为作为 fallback

---

**Spec 结束**
