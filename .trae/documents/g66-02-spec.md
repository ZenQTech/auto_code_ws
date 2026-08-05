# G66-02 Spec: Operation-Level Undo 完善

> **Cycle**: 66
> **生成日期**: 2026-08-04
> **目标**: 实现文件级快照 + 安全回退 + 冲突检测
> **对标**: [agent-rollback](https://github.com/Nainish-Rai/agent-rollback) + [Codex Issue #11626](https://github.com/openai/codex/issues/11626)

---

## 一、功能需求描述

### 1.1 用户场景

**场景 1：AI 错误修改文件**
- 用户要求 agent 重构 auth 模块
- agent 误删了关键函数
- 用户点击 "撤销上次修改" → 文件恢复到修改前
- 显示快照信息（时间、触发器、文件列表）

**场景 2：批量操作后回退**
- agent 一次性修改 5 个文件
- 用户希望只回退其中 2 个
- 选择性恢复（文件粒度）

**场景 3：检查点回退**
- 用户在重构前手动创建快照
- 重构后效果不佳
- 一键回退到快照状态
- 显示 diff 预览 + 冲突检测

**场景 4：用户同时编辑**
- agent 修改 file.py
- 用户在外部编辑器也修改了 file.py
- 回退时检测冲突
- 提供合并选项

### 1.2 功能目标

| 目标 | 描述 |
|------|------|
| 自动快照 | file 工具调用前自动创建 |
| 手动快照 | `/snapshot` 命令触发 |
| 文件级回退 | 单文件 / 多文件 / 整个快照 |
| 冲突检测 | 当前状态 vs 快照 after-state 比对 |
| 预览机制 | 回退前显示 diff 预览 |
| 持久化 | 存储到本地磁盘 + 后端 session 关联 |
| 限额管理 | LRU 缓存，默认 100 个快照/session |
| UI 集成 | 嵌入式面板 + 命令面板入口 |

---

## 二、技术实现方案

### 2.1 架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                     Frontend Layer                            │
│                                                               │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────┐│
│  │  SnapshotPanel  │  │ UndoConfirmDialog│  │  DiffPreview ││
│  │  (列表/详情)    │  │  (确认对话框)    │  │  (回退预览)  ││
│  └────────┬────────┘  └──────────┬───────┘  └──────┬───────┘│
│           └──────────┬──────────┘                  │         │
│                      ▼                              │         │
│           ┌────────────────────────┐                │         │
│           │   useSnapshots         │◄───────────────┘         │
│           │   (Hook)               │                          │
│           └──────────┬─────────────┘                          │
└──────────────────────┼───────────────────────────────────────┘
                       │ HTTP /api/snapshots
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                     Backend Layer                             │
│                                                               │
│  ┌──────────────────────────────────────────────┐            │
│  │     SnapshotStore                              │            │
│  │   - create(snapshot) -> hash_id               │            │
│  │   - get(hash_id) -> Snapshot                  │            │
│  │   - list(session_id) -> List[Snapshot]        │            │
│  │   - delete(hash_id) -> bool                   │            │
│  │   - LRU 缓存（100 条）                        │            │
│  └──────────────────┬───────────────────────────┘            │
│                     │                                         │
│                     ▼                                         │
│  ┌──────────────────────────────────────────────┐            │
│  │     UndoController                             │            │
│  │   - restore(snapshot_id) -> RestoreResult     │            │
│  │   - safe_apply(changes) -> ApplyResult        │            │
│  │   - detect_conflicts() -> List[Conflict]      │            │
│  │   - preview(snapshot_id) -> DiffPreview       │            │
│  └──────────────────┬───────────────────────────┘            │
│                     │                                         │
│                     ▼                                         │
│  ┌──────────────────────────────────────────────┐            │
│  │     FileStorage                                │            │
│  │   - read(path) -> bytes                       │            │
│  │   - write(path, bytes)                        │            │
│  │   - hash(content) -> sha256                   │            │
│  └──────────────────────────────────────────────┘            │
└──────────────────────────────────────────────────────────────┘
                       │ storage
                       ▼
              ~/.hermes/snapshots/
                ├── agent-abc/
                │   ├── snap-001/
                │   │   ├── metadata.json
                │   │   ├── file1.py
                │   │   └── file2.py
                │   └── ...
                └── ...
```

### 2.2 核心算法

#### 2.2.1 Content-Addressed Hash

```python
import hashlib

def compute_hash(content: bytes) -> str:
    """计算内容寻址哈希"""
    return hashlib.sha256(content).hexdigest()[:16]

# 整个快照的 hash 由所有文件 hash + 时间戳 + agent_id 派生
def compute_snapshot_id(agent_id: str, files: Dict[str, str], timestamp: float) -> str:
    """内容寻址快照 ID"""
    file_hashes = sorted([f"{path}:{h}" for path, h in files.items()])
    payload = f"{agent_id}|{timestamp}|" + "|".join(file_hashes)
    return hashlib.sha256(payload.encode()).hexdigest()[:16]
```

#### 2.2.2 冲突检测

```python
def detect_conflicts(
    snapshot: Snapshot,
    current_state: Dict[str, bytes],
) -> List[Conflict]:
    """
    检测当前状态与快照状态之间的冲突
    返回值: 冲突列表（每个冲突包含文件路径和冲突类型）
    """
    conflicts = []
    for path, expected_hash in snapshot.files.items():
        current_content = current_state.get(path)
        if current_content is None:
            conflicts.append(Conflict(
                path=path,
                type="file_deleted",
                expected_hash=expected_hash,
                actual_hash=None,
            ))
            continue
        actual_hash = compute_hash(current_content)
        if actual_hash == expected_hash:
            continue  # 一致
        # 检查是否只有用户的本地变更（agent 没动过）
        # 此时快照记录的 after-state 与当前不同 → 冲突
        conflicts.append(Conflict(
            path=path,
            type="file_modified",
            expected_hash=expected_hash,
            actual_hash=actual_hash,
        ))
    return conflicts
```

#### 2.2.3 安全回退

```python
async def safe_restore(
    snapshot: Snapshot,
    current_state: Dict[str, bytes],
    force: bool = False,
) -> RestoreResult:
    """
    安全回退到快照
    1. 检测冲突
    2. 如果有冲突且未 force，返回 PENDING_CONFIRM
    3. 否则应用反向变更
    4. 报告结果
    """
    # 1. 冲突检测
    conflicts = detect_conflicts(snapshot, current_state)
    
    # 2. 决策
    if conflicts and not force:
        return RestoreResult(
            success=False,
            status="pending_confirm",
            conflicts=conflicts,
            message=f"Detected {len(conflicts)} conflicts. Use force=true to override.",
        )
    
    # 3. 应用变更（按路径倒序，避免目录依赖问题）
    applied = []
    failed = []
    for path in sorted(snapshot.files.keys(), reverse=True):
        try:
            content = read_snapshot_file(snapshot, path)
            write_file(path, content)
            applied.append(path)
        except Exception as e:
            failed.append((path, str(e)))
    
    # 4. 报告
    return RestoreResult(
        success=len(failed) == 0,
        status="completed" if not failed else "partial",
        applied=applied,
        failed=failed,
        conflicts=conflicts,
    )
```

### 2.3 关键模块

| 模块 | 文件 | 职责 |
|------|------|------|
| SnapshotStore | backend/app/services/snapshot_store.py | 内容寻址存储 + LRU |
| UndoController | backend/app/services/undo_controller.py | 回退引擎 + 冲突检测 |
| Snapshot API | backend/app/api/snapshots.py | 6 个 REST 端点 |
| FileStorage | backend/app/services/file_storage.py | 文件读写 + hash |
| useSnapshots | frontend/src/hooks/useSnapshots.ts | 状态管理 |
| SnapshotPanel | frontend/src/components/SnapshotPanel.tsx | 列表 + 详情 |
| UndoConfirmDialog | frontend/src/components/UndoConfirmDialog.tsx | 冲突确认 |
| DiffPreview | frontend/src/components/DiffPreview.tsx | 差异预览 |

---

## 三、接口设计规范

### 3.1 后端 API

#### 3.1.1 创建快照

```http
POST /api/snapshots
Content-Type: application/json

Request Body:
{
  "session_id": "sess-123",
  "agent_id": "agent-abc",
  "files": {
    "/path/to/file1.py": "hash-of-content",
    "/path/to/file2.py": "hash-of-content"
  },
  "trigger": "manual" | "auto" | "pre_edit",
  "description": "Before refactoring auth module"
}

Response 200:
{
  "success": true,
  "snapshot_id": "snap-abc123def",
  "session_id": "sess-123",
  "agent_id": "agent-abc",
  "file_count": 2,
  "total_size": 1024,
  "created_at": 1785836700.123,
  "trigger": "manual"
}
```

#### 3.1.2 列出会话快照

```http
GET /api/snapshots?session_id=sess-123&limit=20&offset=0

Response 200:
{
  "success": true,
  "session_id": "sess-123",
  "total": 42,
  "snapshots": [
    {
      "snapshot_id": "snap-abc123def",
      "agent_id": "agent-abc",
      "trigger": "manual",
      "description": "Before refactoring auth module",
      "file_count": 2,
      "total_size": 1024,
      "created_at": 1785836700.123
    }
  ]
}
```

#### 3.1.3 获取快照详情

```http
GET /api/snapshots/{snapshot_id}

Response 200:
{
  "success": true,
  "snapshot": {
    "snapshot_id": "snap-abc123def",
    "session_id": "sess-123",
    "agent_id": "agent-abc",
    "trigger": "manual",
    "description": "...",
    "files": [
      {
        "path": "/path/to/file1.py",
        "hash": "hash-of-content",
        "size": 512,
        "existed": true
      }
    ],
    "created_at": 1785836700.123
  }
}
```

#### 3.1.4 恢复到快照

```http
POST /api/snapshots/{snapshot_id}/restore
Content-Type: application/json

Request Body:
{
  "paths": ["/path/to/file1.py"],   // 可选，默认恢复全部
  "force": false                    // 冲突时是否强制
}

Response 200 (无冲突):
{
  "success": true,
  "status": "completed",
  "applied": ["/path/to/file1.py", "/path/to/file2.py"],
  "failed": [],
  "conflicts": []
}

Response 409 (有冲突，需确认):
{
  "success": false,
  "status": "pending_confirm",
  "conflicts": [
    {
      "path": "/path/to/file1.py",
      "type": "file_modified",
      "expected_hash": "hash-1",
      "actual_hash": "hash-2"
    }
  ],
  "message": "Detected 1 conflict. Set force=true to override."
}
```

#### 3.1.5 预览恢复

```http
GET /api/snapshots/{snapshot_id}/preview

Response 200:
{
  "success": true,
  "snapshot_id": "snap-abc123def",
  "files": [
    {
      "path": "/path/to/file1.py",
      "change_type": "modify" | "create" | "delete" | "unchanged",
      "diff": "@@ ... @@\n-old\n+new",
      "additions": 5,
      "deletions": 3
    }
  ]
}
```

#### 3.1.6 删除快照

```http
DELETE /api/snapshots/{snapshot_id}

Response 200:
{
  "success": true,
  "snapshot_id": "snap-abc123def",
  "deleted_at": 1785836700.123
}
```

### 3.2 前端 Hook API

```typescript
interface UseSnapshotsOptions {
  sessionId: string;
  agentId?: string;
  autoRefresh?: boolean;
}

interface UseSnapshotsResult {
  snapshots: Snapshot[];
  loading: boolean;
  error: string | null;
  
  create: (params: CreateSnapshotParams) => Promise<Snapshot | null>;
  remove: (snapshotId: string) => Promise<boolean>;
  restore: (snapshotId: string, opts?: RestoreOptions) => Promise<RestoreResult>;
  preview: (snapshotId: string) => Promise<DiffPreview | null>;
  refresh: () => Promise<void>;
}

interface Snapshot {
  snapshotId: string;
  sessionId: string;
  agentId: string;
  trigger: 'manual' | 'auto' | 'pre_edit';
  description: string;
  fileCount: number;
  totalSize: number;
  createdAt: number;
}

interface RestoreOptions {
  paths?: string[];      // 默认全部
  force?: boolean;       // 冲突时强制
  onConflict?: (conflicts: Conflict[]) => void;  // 冲突回调
}

interface Conflict {
  path: string;
  type: 'file_modified' | 'file_deleted' | 'file_added';
  expectedHash: string;
  actualHash: string;
}
```

### 3.3 错误码

| 错误码 | HTTP | 含义 |
|--------|------|------|
| SNAPSHOT_NOT_FOUND | 404 | 快照不存在 |
| SESSION_NOT_FOUND | 404 | session 不存在 |
| PATH_NOT_ALLOWED | 403 | 路径越权 |
| STORAGE_FULL | 507 | 存储已满 |
| CONFLICT | 409 | 有冲突需确认 |
| RESTORE_FAILED | 500 | 恢复失败 |

---

## 四、数据结构定义

### 4.1 Snapshot 数据模型

```python
from dataclasses import dataclass, field
from typing import Dict, List, Optional
import time

@dataclass
class SnapshotFile:
    """快照中单个文件信息"""
    path: str
    hash: str                # sha256 前 16 字符
    size: int
    existed: bool            # 快照时文件是否存在

@dataclass
class Snapshot:
    """文件快照"""
    snapshot_id: str         # content-addressed
    session_id: str
    agent_id: str
    trigger: str             # "manual" | "auto" | "pre_edit"
    description: str
    files: List[SnapshotFile] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    storage_path: str = ""   # 磁盘路径

    @property
    def file_count(self) -> int:
        return len(self.files)

    @property
    def total_size(self) -> int:
        return sum(f.size for f in self.files)

    def to_dict(self) -> dict:
        return {
            "snapshot_id": self.snapshot_id,
            "session_id": self.session_id,
            "agent_id": self.agent_id,
            "trigger": self.trigger,
            "description": self.description,
            "files": [
                {
                    "path": f.path,
                    "hash": f.hash,
                    "size": f.size,
                    "existed": f.existed,
                }
                for f in self.files
            ],
            "file_count": self.file_count,
            "total_size": self.total_size,
            "created_at": self.created_at,
        }
```

### 4.2 Conflict 数据模型

```python
@dataclass
class Conflict:
    """恢复冲突"""
    path: str
    type: str                # "file_modified" | "file_deleted" | "file_added"
    expected_hash: str       # 快照记录的 hash
    actual_hash: str         # 实际当前 hash
    expected_content: Optional[str] = None  # 用于预览
    actual_content: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "type": self.type,
            "expected_hash": self.expected_hash,
            "actual_hash": self.actual_hash,
        }
```

### 4.3 RestoreResult 数据模型

```python
@dataclass
class RestoreResult:
    """恢复结果"""
    success: bool
    status: str              # "completed" | "partial" | "pending_confirm" | "failed"
    applied: List[str] = field(default_factory=list)
    failed: List[tuple] = field(default_factory=list)  # (path, error)
    conflicts: List[Conflict] = field(default_factory=list)
    message: str = ""

    def to_dict(self) -> dict:
        return {
            "success": self.success,
            "status": self.status,
            "applied": self.applied,
            "failed": [
                {"path": p, "error": e} for p, e in self.failed
            ],
            "conflicts": [c.to_dict() for c in self.conflicts],
            "message": self.message,
        }
```

---

## 五、性能与安全要求

### 5.1 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|----------|
| 快照创建（10 个文件） | < 200ms | 单元测试 |
| 列表查询 | < 50ms | 单元测试 |
| 冲突检测（10 个文件） | < 100ms | 单元测试 |
| 文件级恢复 | < 100ms | 单元测试 |
| 快照预览 | < 200ms | 单元测试 |
| LRU 淘汰 | < 10ms | 单元测试 |

### 5.2 资源限制

| 资源 | 限制 |
|------|------|
| 单个快照文件数 | 1000 |
| 单 session 快照数 | 100（LRU） |
| 单快照总大小 | 100MB |
| 磁盘总占用 | 1GB/session |
| 并发恢复请求 | 1/session（防误操作） |

### 5.3 安全要求

| 项目 | 措施 |
|------|------|
| 路径白名单 | 只能快照项目目录内文件 |
| 大小限制 | 单文件 ≤ 10MB |
| 路径遍历防护 | 拒绝 ../ 等 |
| 并发互斥 | 同时只允许一个恢复操作 |
| 操作审计 | 记录所有 restore 操作的 actor + reason |
| 数据加密 | 敏感文件可选加密存储 |

---

## 六、验收标准

### 6.1 单元测试（自动）

| 测试文件 | 测试数 | 目标 |
|----------|--------|------|
| `test_snapshot_store.py` | 35+ | 存储 + LRU + 持久化 |
| `test_undo_controller.py` | 30+ | 回退 + 冲突 + 安全应用 |
| `test_snapshots_api.py` | 20+ | REST 端点 + 错误处理 |
| `useSnapshots.test.ts` | 12+ | Hook 逻辑 |
| `SnapshotPanel.test.tsx` | 15+ | 列表 + 详情 UI |
| `UndoConfirmDialog.test.tsx` | 10+ | 冲突确认对话框 |
| **总计** | **≥ 122** | **100% 通过** |

### 6.2 E2E 浏览器测试（TRAE-browseruse）

| 场景 | 操作 | 期望 |
|------|------|------|
| 1. 创建快照 | 编辑文件 → 手动创建 | 列表新增 1 条 |
| 2. 查看详情 | 点击快照条目 | 显示文件列表 + 元信息 |
| 3. 恢复文件 | 选择快照 → 恢复 | 文件内容回退 + 成功提示 |
| 4. 冲突检测 | 手动修改文件 → 恢复 | 显示冲突对话框 |
| 5. 强制恢复 | 冲突时选 force=true | 强制覆盖 + 警告 |
| 6. 部分恢复 | 多文件快照 → 只选 1 个 | 只恢复选中文件 |
| 7. 预览 diff | 点击预览 | 显示 unified diff |
| 8. 自动快照 | agent 编辑文件 | 列表自动新增 |
| 9. LRU 淘汰 | 创建 101 个快照 | 最旧的被淘汰 |
| 10. 删除快照 | 选中后点击删除 | 列表移除 |
| 11. 持久化 | 重启后端 | 快照仍存在 |

### 6.3 通过标准

- ✅ 所有单元测试通过（≥ 122 个）
- ✅ 所有 E2E 场景通过（11/11）
- ✅ 快照创建 < 200ms
- ✅ 恢复操作 < 200ms
- ✅ 测试覆盖率 ≥ 85%
- ✅ 0 critical bug，< 5 minor bug
- ✅ 并发安全（同时只允许一个恢复）
- ✅ 持久化到磁盘（重启后存在）

---

## 七、向后兼容

| 模块 | 兼容性 | 说明 |
|------|--------|------|
| AgentRunner | ✅ 增强 | 新增 PRE_TOOL_USE hook 触发快照 |
| 现有文件 | ✅ 不影响 | 已有文件操作无需修改 |
| API | ✅ 新增 | 不修改现有端点 |
| 现有测试 | ✅ 无回归 | 现有 208 个测试 100% 通过 |

---

## 八、文件清单

### 8.1 新建

| 文件 | 行数（预估） | 用途 |
|------|--------------|------|
| `backend/app/services/snapshot_store.py` | 350 | 内容寻址存储 |
| `backend/app/services/undo_controller.py` | 300 | 回退引擎 |
| `backend/app/services/file_storage.py` | 150 | 文件读写 |
| `backend/app/api/snapshots.py` | 200 | REST 端点 |
| `backend/tests/test_snapshot_store.py` | 400 | 存储测试 |
| `backend/tests/test_undo_controller.py` | 350 | 回退测试 |
| `backend/tests/test_snapshots_api.py` | 250 | API 测试 |
| `frontend/src/hooks/useSnapshots.ts` | 250 | Hook |
| `frontend/src/hooks/useSnapshots.test.ts` | 200 | Hook 测试 |
| `frontend/src/components/SnapshotPanel.tsx` | 350 | 面板 UI |
| `frontend/src/components/SnapshotPanel.test.tsx` | 250 | 面板测试 |
| `frontend/src/components/UndoConfirmDialog.tsx` | 200 | 确认对话框 |
| `frontend/src/components/UndoConfirmDialog.test.tsx` | 150 | 对话框测试 |
| `frontend/src/components/DiffPreview.tsx` | 250 | 差异预览 |
| `frontend/src/components/DiffPreview.test.tsx` | 180 | 预览测试 |

### 8.2 修改

| 文件 | 修改行数（预估） | 修改内容 |
|------|------------------|----------|
| `backend/app/services/agent_runner.py` | +30 | PRE_TOOL_USE 触发快照 |
| `backend/app/main.py` | +10 | 注册 snapshots router |
| `frontend/src/components/AgentExecutionPanel.tsx` | +50 | 集成快照按钮 |
| `frontend/src/components/EmbeddedTools.tsx` | +30 | 集成 SnapshotPanel |

---

## 九、实施时间表

| 阶段 | 时长 | 任务 |
|------|------|------|
| 1. 后端核心 | 45min | FileStorage + SnapshotStore |
| 2. 后端 Undo | 30min | UndoController + 冲突检测 |
| 3. 后端 API | 30min | 6 个 REST 端点 |
| 4. 后端集成 | 20min | AgentRunner 集成 hook |
| 5. 后端测试 | 60min | ≥ 85 个测试用例 |
| 6. 前端 Hook | 30min | useSnapshots |
| 7. 前端组件 | 60min | SnapshotPanel + Dialog + Diff |
| 8. 前端集成 | 30min | 嵌入 AgentExecutionPanel + EmbeddedTools |
| 9. 前端测试 | 60min | ≥ 73 个测试用例 |
| 10. E2E 验证 | 20min | 11 个浏览器场景 |
| **总计** | **~6h** | **完整实施 + 测试** |
