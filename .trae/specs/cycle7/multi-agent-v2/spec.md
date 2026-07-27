# Cycle 7 P0-10: Multi-Agent v2 Path-Based Addressing + Node Auto-Collapse

> **版本**: v1.0.0
> **创建日期**: 2026-07-27
> **关联调研**: CYCLE7_RESEARCH_REPORT.md §1, §3
> **关联 Codex 规范**: v0.121.0+ Multi-Agent v2 (path-based addressing + spawn_agent + wait_agent)
> **关联 TRAE 规范**: v3.3.66+ Hook 功能 + v3.3.63 Subagent 卡片折叠 + "对话流节点自动折叠"
> **状态**: 🚧 实施中

---

## 1. 背景与目标

### 1.1 现状

当前 SubAgent 系统（Cycle 4 P0-4）已实现基础的 memory inheritance：
- `SubAgentContext` 数据类定义隔离上下文
- `InMemorySubAgentMemoryStore` 单例存储
- 支持 `append_message` / `get_messages` / `inherit_from_parent` 等方法

但仍存在以下关键限制：

1. **使用 opaque subagent_id 字符串**：父子关系管理繁琐，缺少人类可读路径
2. **没有 spawn_agent / wait_agent 工具**：手动创建和管理 SubAgent
3. **缺少 path-based addressing**：不能像 `/root/researcher/summarizer` 那样通过路径寻址
4. **AgentRegistry.total_count 槽位泄漏**（Codex 已修复）：需要类似 slot reservation 机制
5. **没有对话流节点自动折叠**：长对话 UI 体验差
6. **没有 max_depth / max_threads 限制**：递归可能无限

### 1.2 目标

实现 Codex v0.121+ Multi-Agent v2 风格的 path-based 多智能体系统 + TRAE "对话流节点自动折叠" 体验：

**后端核心**：
- **Path-based addressing**：subagent path = `/root/{task_name}[/{child_task_name}]*`
- **AgentRegistry**：slot reservation (max_threads, max_depth) + auto cleanup
- **spawn_agent(task_name, message, model?, sandbox?)** 工具
- **wait_agent(target, timeout)** 工具
- **send_message / followup_task** 消息传递
- **close_agent(target)** 关闭
- **list_agents(path?)** 列出树

**前端 UI**：
- **对话流节点自动折叠**：超过 N 条的 completed 任务自动折叠，可展开查看
- **SubAgent Path Tree**：可视化 `/root/task1/task2` 树状结构
- **SubAgent 卡片展开/折叠**（TRAE 风格）
- **Auto-collapse 设置**：用户可启用/关闭，阈值可调

### 1.3 非目标

- 真实 CLI 子进程 fork（仍使用 ClaudeExecutor 抽象）
- 跨设备 subagent 同步
- 完整 TOML 自定义 agent 配置（仅作 spec 记录，本期不实现）

---

## 2. 技术选型

### 2.1 核心库

| 库 | 用途 | 版本 |
|----|------|------|
| 现有 `asyncio` | 并发 SubAgent 管理 | 3.10+ |
| 现有 SQLAlchemy | SubAgent 持久化（可选） | 2.0+ |
| 现有 React + TypeScript | 前端 UI | 18+ |

### 2.2 架构选型

**Option A：在 `subagent_memory.py` 基础上扩展（推荐）**
- 优点：复用现有基础设施（InMemorySubAgentMemoryStore）
- 缺点：单文件膨胀

**Option B：新建 `multi_agent_registry.py` 独立模块**
- 优点：单一职责，路径寻址解耦
- 缺点：需与 SubAgentMemoryStore 协同

**最终选择**：**B（独立模块）**
- 新建 `multi_agent_registry.py`：Path 寻址 + 槽位管理 + 工具 API
- 复用 `subagent_memory.py`：每个 SubAgent 的隔离 memory

### 2.3 路径寻址规范

```
/                                # 根节点
/root                            # 根 orchestrator
/root/researcher                 # 一级子智能体
/root/researcher/summarizer      # 二级子智能体
/root/builder                    # 平级子智能体
/root/builder/tester             # 嵌套子智能体
```

**解析规则**：
- `/` → 根
- `/root` → 根 orchestrator（不可 spawn 子代）
- `/root/x` → 一级
- `/root/x/y` → 二级
- 路径段 = task_name
- 同一父级下 task_name 唯一

---

## 3. 数据模型

### 3.1 SubAgent Node（节点）

```python
@dataclass
class SubAgentNode:
    path: str                    # 完整路径 /root/researcher
    task_name: str               # 路径最后一段
    parent_path: Optional[str]   # 父路径
    subagent_id: str             # 内部 ID
    model: str = "claude-sonnet"
    sandbox: str = "workspace-write"
    status: str = "pending"      # pending / running / completed / failed / closed
    created_at: float = field(default_factory=time.time)
    closed_at: Optional[float] = None
    result: Optional[str] = None  # spawn_agent 执行的最终结果
    error: Optional[str] = None
    depth: int = 0                # 路径深度
```

### 3.2 SubAgent Slot

```python
@dataclass
class SubAgentSlot:
    path: str
    subagent_id: str
    reserved_at: float
    state: str = "active"  # active / released
```

### 3.3 SubAgent Message

```python
@dataclass
class SubAgentMessage:
    msg_id: str
    from_path: str
    to_path: str
    body: str
    msg_type: str  # "send" / "followup"
    sent_at: float = field(default_factory=time.time)
    read: bool = False
```

---

## 4. 核心 API

### 4.1 MultiAgentRegistry（核心调度器）

```python
class MultiAgentRegistry:
    def __init__(self, max_threads: int = 6, max_depth: int = 3):
        self.max_threads = max_threads
        self.max_depth = max_depth
        self._nodes: Dict[str, SubAgentNode] = {}
        self._slots: Dict[str, SubAgentSlot] = {}
        self._messages: List[SubAgentMessage] = []
        self._lock = asyncio.Lock()

    async def spawn_agent(
        self,
        parent_path: str,
        task_name: str,
        message: str,
        model: Optional[str] = None,
        sandbox: Optional[str] = None,
    ) -> Dict[str, Any]:
        """spawn_agent 工具：创建子 SubAgent
        返回：{"success": True, "subagent_id": "...", "path": "/root/x", "depth": N}
        """

    async def wait_agent(
        self,
        target: str,  # path
        timeout: Optional[float] = None,
    ) -> Dict[str, Any]:
        """wait_agent 工具：等待子 SubAgent 完成
        返回：{"success": True, "status": "completed", "result": "..."}
        """

    async def close_agent(self, target: str) -> Dict[str, Any]:
        """close_agent 工具：显式关闭 SubAgent，释放 slot"""

    async def send_message(
        self,
        from_path: str,
        to_path: str,
        body: str,
    ) -> Dict[str, Any]:
        """send_message 工具：向指定路径的 SubAgent 发消息"""

    async def followup_task(
        self,
        from_path: str,
        to_path: str,
        task: str,
    ) -> Dict[str, Any]:
        """followup_task 工具：向已关闭 SubAgent 发起后续任务"""

    def list_agents(self, parent_path: Optional[str] = None) -> List[Dict]:
        """list_agents(path?)：列出指定路径下的所有 SubAgent"""

    def get_tree(self) -> Dict:
        """get_tree()：返回整个 SubAgent 树状结构"""

    def get_stats(self) -> Dict:
        """get_stats()：返回 slot 使用 / depth / status 统计"""

    async def _release_slot(self, path: str):
        """内部：释放 slot（Codex bug fix：turn 结束自动清理）"""

    async def _auto_cleanup_on_turn(self, parent_path: str):
        """内部：turn 结束自动清理已完成的子节点（避免 slot 泄漏）"""
```

### 4.2 REST API 端点（10 个）

| 方法 | 路径 | 作用 |
|------|------|------|
| POST | `/api/multi-agents/spawn` | spawn_agent |
| POST | `/api/multi-agents/wait` | wait_agent |
| POST | `/api/multi-agents/close` | close_agent |
| POST | `/api/multi-agents/send-message` | send_message |
| POST | `/api/multi-agents/followup` | followup_task |
| GET | `/api/multi-agents/list` | list_agents (?parent=) |
| GET | `/api/multi-agents/tree` | get_tree |
| GET | `/api/multi-agents/stats` | get_stats |
| GET | `/api/multi-agents/messages` | 列出消息（已收/已发） |
| DELETE | `/api/multi-agents/node/{path}` | 强制清理（带 ?recursive=true） |

---

## 5. 前端组件

### 5.1 MultiAgentTreePanel.tsx（450 行）

**布局结构**：
```
┌──────────────────────────────────────────────────────────┐
│  🌳 Multi-Agent v2 Path Tree                             │
│  Codex v0.121+ path-based · spawn/wait/close tools       │
├──────────────────────────────────────────────────────────┤
│  Slot 使用: 3/6  Depth: 2/3  Total: 5  Active: 3       │
│  [🆕 Spawn] [⏳ Wait] [🛑 Close] [📋 List] [🗑️ Clean]    │
├──────────────────────────────────────────────────────────┤
│  📁 /root                                  [pending]    │
│  ├── 📂 researcher                         [running]    │
│  │   ├── 📄 analyzer      [completed]  12s              │
│  │   └── 📄 summarizer    [pending]                     │
│  └── 📂 builder                            [failed]     │
│      └── 📄 tester       [closed]    8s                 │
├──────────────────────────────────────────────────────────┤
│  最近消息:                                                │
│  [root → researcher]  帮我分析 API 表面    12:34:56     │
│  [researcher → root]  分析完成，结果是...   12:35:23     │
└──────────────────────────────────────────────────────────┘
```

### 5.2 NodeAutoCollapse Hook（useNodeAutoCollapse.ts）

**逻辑**：
- 已完成节点（status == "completed"）且 index >= threshold → 自动折叠
- 用户手动展开后记住状态（localStorage）
- 设置中可启用/关闭、调节阈值（默认 5）

```typescript
export function useNodeAutoCollapse(
  nodes: SubAgentNode[],
  options: { threshold: number; enabled: boolean }
): {
  collapsedMap: Record<string, boolean>;
  toggleCollapse: (path: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
};
```

### 5.3 ChatViewNodeAutoCollapse（集成到 ChatView.tsx）

- 检测 message 流中 completed 的 task 节点
- 超过 threshold 自动折叠
- "▶ N 个已完成任务"摘要头部 + 展开按钮

---

## 6. 测试策略

### 6.1 单元测试（35+ 用例）

| 模块 | 测试数 | 覆盖内容 |
|------|--------|----------|
| `multi_agent_registry.py` 路径解析 | 6 | /root, /root/x, /root/x/y, 无效路径 |
| spawn_agent | 5 | 正常 / 超 max_depth / 超 max_threads / 同名冲突 |
| wait_agent | 4 | 正常完成 / 超时 / 不存在 |
| close_agent | 3 | 正常 / 不存在 / 递归关闭 |
| send_message | 3 | 正常 / 路径不存在 / 跨层级 |
| followup_task | 2 | 正常 / 重新激活 closed |
| list_agents / get_tree | 4 | 根 / 子 / 递归 / 状态过滤 |
| _auto_cleanup_on_turn | 4 | 全部完成 → 释放 / 部分完成 / 无清理 |
| get_stats | 4 | 计数 / 槽位 / 深度 / 状态 |
| **总计** | **35** | **100% 覆盖** |

### 6.2 E2E 测试（20+ 场景）

```bash
1. POST /api/multi-agents/spawn 创建 /root/researcher
2. POST /api/multi-agents/spawn 创建 /root/builder
3. GET /api/multi-agents/tree 验证树结构
4. POST /api/multi-agents/send-message 跨层级发消息
5. POST /api/multi-agents/wait 等待完成
6. POST /api/multi-agents/spawn 超 max_depth → 失败
7. POST /api/multi-agents/spawn 超 max_threads → 失败
8. POST /api/multi-agents/close 关闭节点 + 释放 slot
9. GET /api/multi-agents/stats 验证 slot 计数
10. POST /api/multi-agents/followup 重新激活 closed
11. GET /api/multi-agents/list?parent=/root 列出子节点
12. POST /api/multi-agents/spawn 同 task_name 冲突
13. DELETE /api/multi-agents/node/root/researcher?recursive=true
14. 模拟 turn 结束 → 自动清理（slot 释放）
15. 模拟子进程崩溃 → status=failed
16. 多线程并发 spawn → 槽位正确
17. wait_agent 超时返回
18. send_message to 不存在 path → 失败
19. 完整 e2e: 6 个 SubAgent 树形编排
20. 完整 e2e: 递归清理
```

### 6.3 浏览器实测

- 打开 MultiAgentTreePanel
- 自动检测 API 状态
- 测试 spawn / wait / close 操作
- 验证树状结构可视化
- 切换 Auto-Collapse 设置
- 验证节点折叠/展开

---

## 7. 验收标准

### 7.1 后端验收

- [ ] 路径解析正确（所有测试路径）
- [ ] spawn_agent 遵守 max_depth / max_threads 限制
- [ ] slot 槽位 reservation 正确
- [ ] turn 结束自动清理（无 slot 泄漏）
- [ ] wait_agent 支持超时
- [ ] close_agent 释放 slot
- [ ] followup_task 重新激活 closed 节点
- [ ] get_tree 返回完整树状结构
- [ ] 100% 单元测试通过
- [ ] 100% E2E 测试通过

### 7.2 前端验收

- [ ] MultiAgentTreePanel 正确显示树状结构
- [ ] spawn / wait / close / list 按钮可用
- [ ] 消息列表正确显示
- [ ] NodeAutoCollapse 默认阈值正确
- [ ] localStorage 记住用户偏好
- [ ] 与现有 SubAgentMemoryViewer 集成无冲突
- [ ] TypeScript 0 错误
- [ ] Vite 构建成功
- [ ] 浏览器实测通过

### 7.3 集成验收

- [ ] 与现有 SubAgent Memory 系统不冲突
- [ ] 与 Hook 系统协同（spawn 触发 SessionStart hook）
- [ ] 与 Plan Editor 兼容（path-based 任务组织）
- [ ] 与 Session Rollout 集成（spawn 事件可记录到 rollout）

---

## 8. 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| Slot 槽位泄漏 | 中 | turn 结束自动清理（Codex fix 模式）|
| 递归深度过深 | 中 | max_depth 限制 + 启动时检查 |
| 并发 spawn 竞态 | 低 | asyncio.Lock 保护 |
| Memory 隔离破坏 | 低 | 复用现有 InMemorySubAgentMemoryStore |
| UI 性能（>50 节点） | 低 | 虚拟滚动 + 折叠 |

---

## 9. 后续候选

- TOML 自定义 agent 配置（Codex agents/ 目录）
- CSV Batch Processing（Codex 实验性特性）
- 加密 subagent 委托（合规性）
- 跨 subagent 上下文共享优化
- SubAgent 性能监控（token 使用 / 延迟）
