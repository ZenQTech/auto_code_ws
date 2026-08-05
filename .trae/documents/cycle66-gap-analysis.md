# CYCLE 66 功能差距分析报告

> **生成日期**: 2026-08-04
> **基础**: cycle65-gap-analysis.md + Cycle 65 增量分析
> **范围**: Codex CLI v0.121+ reasoning effort + /undo 操作级回退 + /rewind 检查点恢复

---

## 一、互联网调研总结（Codex CLI Solo 模式）

### 1.1 Reasoning Effort 切换

**Codex CLI 实现方式**（[Codex CLI Speed Stack](https://codex.danielvaughan.com/2026/04/24/codex-cli-speed-stack-fast-mode-reasoning-effort-spark-performance-tuning/)）：

| 等级 | 用途 | 相对速度 |
|------|------|----------|
| `low` | 样板代码、简单重命名、格式化 | 最快 |
| `medium` | 交互式编码默认（OpenAI 推荐） | 中等 |
| `high` | 扩展推理，复杂任务 | 较慢 |
| `xhigh` | 架构、深度分析（部分模型支持） | 最慢 |

**配置方式**：
```toml
# ~/.codex/config.toml
model_reasoning_effort = "xhigh"
```

**API 调用**：
- `codex --enable-feature <feature>` 会话级别切换
- `config.toml` 全局默认
- 部分模型（Mistral Large）不支持 reasoning 参数

### 1.2 /undo 命令（Operation-Level Rollback）

**Codex CLI 实现方式**（[Codex Feature Flags](https://codex.danielvaughan.com/2026/03/28/codex-cli-feature-flags-tui-tuning/)）：

```toml
[features]
undo = true
```

**关键设计要点**（参考 [GitHub Issue #11626](https://github.com/openai/codex/issues/11626)）：

1. **检查点（Checkpoint）机制**
   - 会话期间持续快照
   - 每个 turn 创建一个 checkpoint
   - 包含：时间戳、prompt 摘要、变更文件列表

2. **安全应用路径（Safe Apply Path）**
   ```
   收集 Codex 制作的 workspace 变更
   → 按时间倒序计算反向变更
   → 验证当前内容仍匹配 Codex 的预期 after-state
   → 通过验证：自动应用回滚
   → 验证失败：标记为冲突，要求显式用户确认
   ```

3. **/undo vs /rewind 区别**
   - `/undo`: 撤销最后一次文件修改（最简单）
   - `/rewind`: 回退到指定检查点（同时回退 chat context + 文件变更）

4. **冲突检测**
   - 只回退 Codex 制作的变更
   - 不触碰检查点前的本地变更
   - 文件无法干净恢复时显示冲突

### 1.3 第三方增强：agent-rollback

[agent-rollback](https://github.com/Nainish-Rai/agent-rollback) 提供了更完整的实现：

- **内容寻址快照**（content-addressed snapshots）
- 支持 Git 仓库 / 无 Git 仓库两种模式
- MCP server + Codex hook 集成
- 单一命令恢复单个文件或整个项目
- 人类可读的 checkpoint id

---

## 二、Cycle 65 增量完成

| 编号 | 功能 | 状态 | 关键产物 |
|------|------|------|----------|
| G65-01 | 真实 CLI 集成 | ✅ | [real_agent_runner.py](file:///home/qizheng/auto_code_ws/backend/app/services/real_agent_runner.py) (607 行) + 93 测试 |
| G65-02 | CSV 批处理 spawn_agents | ✅ | [batch_spawner.py](file:///home/qizheng/auto_code_ws/backend/app/services/batch_spawner.py) (876 行) + 38 测试 + 6 API + 4 前端组件 |

**测试统计**: 208 个新测试 100% 通过

---

## 三、Cycle 66 差距矩阵

### 3.1 仍需实现的功能

| # | 功能 | 优先级 | 当前状态 | 期望标准 | 实施复杂度 | 风险等级 |
|---|------|--------|----------|----------|------------|----------|
| 1 | **Reasoning Effort 切换** | 🔴 P0 | ❌ 缺失 | 运行时切换 low/medium/high + 持久化 + 快捷键 | 中 | 低 |
| 2 | **Operation-level undo 完善** | 🔴 P0 | 🟡 部分 | 文件快照 + 安全应用 + 冲突检测 + UI 集成 | 高 | 中 |
| 3 | **/rewind 检查点恢复** | 🟡 P1 | ❌ 缺失 | chat context + 文件变更双重回退 | 高 | 中 |
| 4 | **PRD diff 视图** | 🟡 P1 | ❌ 缺失 | diff 算法 + 树形展示 + 时间轴 | 中 | 低 |
| 5 | **Stage 历史导出** | 🟢 P2 | ❌ 缺失 | JSON / CSV 格式 + 时间过滤 | 低 | 低 |
| 6 | **多 session stage 对比** | 🟢 P2 | ❌ 缺失 | 时间线可视化 + 差异高亮 | 中 | 低 |
| 7 | **PTT 语音输入** | 🟢 P2 | ❌ 缺失 | Web Speech API + 按住说话 | 中 | 低 |

---

## 四、本轮 (Cycle 66) P0 实施计划

### 4.1 G66-01: Reasoning Effort 切换

**目标**: 允许用户在会话期间调整 reasoning effort，等级 low/medium/high（对标 Codex CLI 0.121+）

**功能需求**:
- 等级: `low` / `medium` / `high`（默认 `medium`）
- 运行时切换：发送 update_request 到 AgentRunner
- 快捷键: `Alt+,` 降低 / `Alt+.` 提高
- UI: ReasoningEffortBadge 组件（颜色编码）
- 持久化: sessionStorage + 后端 instance 状态
- API: `PUT /api/agent-roles/instances/{id}/reasoning`
- 影响范围: 通过 hook 通知正在执行的 agent

**核心组件**:
- 后端: `ReasoningEffortController` 服务
- 后端: `agent_roles.py` 新增 PUT 端点
- 前端: `ReasoningEffortToggle` 组件（紧凑 + 详细两种模式）
- 前端: `useReasoningEffort` Hook
- 前端: 集成到 AgentExecutionPanel + VibeSoloShell

**接口设计**:
```python
# 枚举
class ReasoningEffort(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"

# API
PUT /api/agent-roles/instances/{agent_id}/reasoning
  body: { effort: "low" | "medium" | "high" }
  resp: { success: bool, instance: AgentInstance }

GET /api/agent-roles/instances/{agent_id}/reasoning
  resp: { effort: str, history: List[{effort, timestamp, source}] }
```

**验收标准**:
- ✅ 后端切换 < 100ms
- ✅ 前端切换 < 200ms（含 UI 更新）
- ✅ 快捷键 Alt+, / Alt+. 触发
- ✅ 状态持久化（刷新页面后保留）
- ✅ 单元测试覆盖率 ≥ 90%

### 4.2 G66-02: Operation-Level Undo 完善

**目标**: 实现文件级快照 + 安全回退 + 冲突检测（对标 agent-rollback）

**功能需求**:
- 自动快照: 每次 file 工具调用前自动创建快照
- 手动快照: 显式 `/snapshot` 命令
- 快照管理: 列表、查看详情、删除
- 安全回退: 验证当前状态 → 反向应用 → 报告冲突
- 冲突检测: 当前内容不匹配预期 → 标记冲突
- 粒度: 支持文件级和会话级回退
- 持久化: 存储到本地 + 后端 session 关联

**核心组件**:
- 后端: `SnapshotStore` 服务（content-addressed 存储）
- 后端: `UndoController` 服务（安全回退引擎）
- 后端: `agent_snapshots.py` API（5 个端点）
- 前端: `SnapshotPanel` 组件
- 前端: `UndoConfirmationDialog` 组件
- 前端: `useSnapshots` Hook
- 前端: 集成到 Editor + Diff + EmbeddedTools

**接口设计**:
```python
# 数据模型
@dataclass
class Snapshot:
    snapshot_id: str       # content-addressed hash
    session_id: str
    agent_id: str
    timestamp: float
    files: Dict[str, str]  # path -> content hash
    trigger: str           # "auto" | "manual" | "pre_edit"
    description: str

# API
POST   /api/snapshots                    # 创建快照
GET    /api/snapshots/{session_id}        # 列出 session 快照
GET    /api/snapshots/{snapshot_id}       # 查看快照详情
POST   /api/snapshots/{snapshot_id}/restore  # 恢复到快照
DELETE /api/snapshots/{snapshot_id}       # 删除快照
```

**验收标准**:
- ✅ 快照创建 < 50ms
- ✅ 文件级回退 < 200ms
- ✅ 冲突检测准确率 100%
- ✅ 持久化到磁盘（重启后仍存在）
- ✅ 单元测试覆盖率 ≥ 85%

---

## 五、风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Reasoning 切换不生效 | 中 | hook 通知 + 状态回滚 |
| 快照存储膨胀 | 中 | LRU 缓存 + 大小限制（默认 100 个） |
| 冲突回退误操作 | 高 | 强制预览 + 显式确认 |
| 大量文件快照性能 | 中 | 增量快照（只保存差异） |
| 持久化路径权限 | 低 | 配置化 + 默认 ~/.hermes/snapshots |

---

## 六、实施顺序

1. **G66-01 Reasoning Effort 切换**（最低风险，最大体验提升）
2. **G66-02 Operation-Level Undo**（高价值但复杂）

---

## 七、下一阶段 (Cycle 67) 规划

按以下顺序实施：
1. PRD diff 视图
2. Stage 历史导出
3. 多 session stage 对比
4. PTT 语音输入

---

## 八、参考资料

1. [Codex CLI Speed Stack: Fast Mode, Reasoning Effort, Spark](https://codex.danielvaughan.com/2026/04/24/codex-cli-speed-stack-fast-mode-reasoning-effort-spark-performance-tuning/)
2. [Codex CLI Feature Flags and TUI Tuning](https://codex.danielvaughan.com/2026/03/28/codex-cli-feature-flags-tui-tuning/)
3. [GPT-5 Codex CLI Guide](https://devbriefs.com/gpt-5-codex-cli-guide/)
4. [GitHub Issue #11626: /rewind checkpoint restore](https://github.com/openai/codex/issues/11626)
5. [agent-rollback: codex undo tool](https://github.com/Nainish-Rai/agent-rollback)
6. [Codex CLI「/斜杠命令」完全操作指南](https://gitcode.csdn.net/69b0d99254b52172bc607889.html)
