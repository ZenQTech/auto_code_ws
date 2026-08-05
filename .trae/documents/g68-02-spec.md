# G68-02 Spec: 多文件原子编辑（apply_patch V4A）

> **Cycle**: 68
> **Priority**: P0
> **Status**: 待实现
> **对标**: Codex `codex-rs/apply_patch` (V4A grammar) + Trae AST-aware transactional edits

---

## 1. 功能需求

### 1.1 功能目标

提供类似 Codex V4A 的多文件原子编辑接口，支持 LLM/Agent 在一次操作中修改多个文件，保证事务性（要么全部成功，要么全部回滚），并提供预览、校验、原子应用三个独立操作。

### 1.2 V4A Grammar

```
*** Begin Patch
*** Update File: path/to/file.py
@@
 context line (unchanged)
-removed line
+added line
 unchanged context
*** Add File: path/to/new.py
+new line 1
+new line 2
*** Delete File: path/to/old.py
*** End Patch
```

### 1.3 用户场景

- **场景 A**: Claude Code CLI 执行多文件重构
  - 解析 V4A grammar → 拆分为多个 (file, op) 单元
  - 校验所有文件 hash → 全部通过 → 原子应用
- **场景 B**: 用户在 UI 中应用 AI 建议的多文件编辑
  - 显示每个文件的 diff 预览
  - 确认后一次性应用
- **场景 C**: 失败的 patch
  - 任何文件 hash 不匹配 → 拒绝整个 patch
  - 应用过程中任何文件失败 → 回滚所有已应用修改

---

## 2. 技术实现方案

### 2.1 架构设计

```
┌─────────────────────────────────────────────────────────────┐
│  ApplyPatchService                                          │
│  ┌──────────────────┐                                       │
│  │ V4AParser        │  → List[PatchOp]                     │
│  │ - parse(text)    │     - UpdateFile                      │
│  │ - validate()     │     - AddFile                         │
│  └──────────────────┘     - DeleteFile                      │
│           ↓                                                  │
│  ┌──────────────────┐                                       │
│  │ HashValidator    │  → ValidationResult                   │
│  │ - check all      │     - conflict: List[Conflict]         │
│  │   files          │     - safe: bool                       │
│  └──────────────────┘                                       │
│           ↓                                                  │
│  ┌──────────────────┐                                       │
│  │ TransactionalApplier                                        │
│  │ - create_snapshot                                       │
│  │ - apply each op                                          │
│  │ - on failure: rollback                                  │
│  └──────────────────┘                                       │
│           ↓                                                  │
│  [SnapshotStore] ← 备份所有文件                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心算法

#### V4A 解析

```python
def parse(text: str) -> List[PatchOp]:
    ops = []
    current_file = None
    in_hunk = False
    hunk_lines = []

    for line in text.split('\n'):
        if line.startswith('*** Begin Patch'):
            state = 'in_patch'
        elif line.startswith('*** End Patch'):
            state = 'end'
        elif line.startswith('*** Update File:'):
            current_file = line.split(':', 1)[1].strip()
        elif line.startswith('*** Add File:'):
            current_file = line.split(':', 1)[1].strip()
            ops.append(AddFile(path=current_file, content=''))
        elif line.startswith('*** Delete File:'):
            current_file = line.split(':', 1)[1].strip()
            ops.append(DeleteFile(path=current_file))
        elif line.startswith('@@'):
            in_hunk = True
            hunk_lines = []
        elif in_hunk:
            hunk_lines.append(line)
            if line.startswith(' '):
                # context
                pass
            elif line.startswith('-'):
                # removed
                pass
            elif line.startswith('+'):
                # added
                pass
            elif line == '' or line.startswith(' '):
                # end of hunk
                ops.append(UpdateFile(path=current_file, hunks=hunk_lines))
                in_hunk = False

    return ops
```

复杂度：O(n)，n = grammar 字符数

#### 哈希校验

```python
def validate(ops: List[PatchOp], file_storage) -> ValidationResult:
    conflicts = []
    for op in ops:
        if op.type == 'update':
            current_hash = file_storage.get_hash(op.path)
            expected_hash = op.expected_hash
            if current_hash != expected_hash:
                conflicts.append(Conflict(
                    file=op.path,
                    expected=expected_hash,
                    actual=current_hash
                ))
        elif op.type == 'add':
            if file_storage.exists(op.path):
                conflicts.append(Conflict(
                    file=op.path,
                    expected='<not exist>',
                    actual='<exists>'
                ))
    return ValidationResult(
        safe=len(conflicts) == 0,
        conflicts=conflicts
    )
```

复杂度：O(m)，m = 文件数

#### 事务性应用

```python
def apply(ops: List[PatchOp], file_storage, snapshot_store) -> ApplyResult:
    # 1. 创建快照
    snapshot_id = snapshot_store.create(
        files=[op.path for op in ops]
    )

    # 2. 备份原始内容
    backups = {}
    for op in ops:
        if op.type in ('update', 'delete'):
            backups[op.path] = file_storage.read(op.path)

    try:
        # 3. 应用每个 op
        for op in ops:
            if op.type == 'update':
                file_storage.write(op.path, op.new_content)
            elif op.type == 'add':
                file_storage.write(op.path, op.content)
            elif op.type == 'delete':
                file_storage.delete(op.path)

        return ApplyResult(success=True, snapshot_id=snapshot_id)

    except Exception as e:
        # 4. 回滚
        for path, content in backups.items():
            file_storage.write(path, content)
        return ApplyResult(success=False, error=str(e), snapshot_id=snapshot_id)
```

复杂度：O(m × f)，m = 文件数，f = 平均文件大小

### 2.3 与 Snapshot 集成

- 应用前自动创建 snapshot
- 失败时可通过 snapshot_id 回滚
- 提供 `apply_patch` 端点的 `force` 参数跳过 hash 校验

---

## 3. 接口设计

### 3.1 REST API

#### `POST /api/apply-patch/validate`

校验 V4A patch

**Request**:
```json
{
  "patch_text": "*** Begin Patch\n*** Update File: foo.py\n@@\n-old\n+new\n*** End Patch",
  "root": "/path/to/project"
}
```

**Response 200**:
```json
{
  "valid": true,
  "ops": [
    {
      "type": "update",
      "file": "foo.py",
      "hunks": 1
    }
  ],
  "file_hashes": {
    "foo.py": "abc123def456"
  }
}
```

**Response 400** (语法错误):
```json
{
  "valid": false,
  "error": "Parse error at line 5: unexpected token '*** Invalid'"
}
```

#### `POST /api/apply-patch/preview`

预览 patch（不应用）

**Request**: 同 validate

**Response 200**:
```json
{
  "safe": true,
  "conflicts": [],
  "diffs": [
    {
      "file": "foo.py",
      "type": "update",
      "before_hash": "abc123",
      "after_hash": "xyz789",
      "diff": "--- a/foo.py\n+++ b/foo.py\n@@ -1 +1 @@\n-old\n+new"
    }
  ]
}
```

**Response 409** (冲突):
```json
{
  "safe": false,
  "conflicts": [
    {
      "file": "foo.py",
      "expected_hash": "abc123",
      "actual_hash": "def456"
    }
  ]
}
```

#### `POST /api/apply-patch`

应用 patch

**Request**:
```json
{
  "patch_text": "...",
  "root": "/path/to/project",
  "force": false,
  "create_snapshot": true
}
```

**Response 200**:
```json
{
  "success": true,
  "snapshot_id": "snap-abc123",
  "applied_ops": 3,
  "duration_ms": 142
}
```

**Response 409** (冲突未 force):
```json
{
  "success": false,
  "error": "conflicts_detected",
  "conflicts": [...]
}
```

**Response 500** (应用失败，已回滚):
```json
{
  "success": false,
  "error": "apply_failed",
  "rolled_back": true,
  "failed_op": {
    "type": "update",
    "file": "foo.py"
  }
}
```

### 3.2 错误码

| 错误码 | HTTP | 含义 |
|--------|------|------|
| `PARSE_ERROR` | 400 | V4A 语法错误 |
| `CONFLICTS_DETECTED` | 409 | 文件 hash 不匹配 |
| `FILE_TOO_LARGE` | 413 | 单文件 > 10MB |
| `PERMISSION_DENIED` | 403 | 文件不可写 |
| `APPLY_FAILED` | 500 | 应用失败（已回滚） |

---

## 4. 数据结构

### 4.1 Patch 操作

```python
class PatchOp(BaseModel):
    type: str  # "update" | "add" | "delete"
    path: str
    hunks: Optional[List[Hunk]]  # 仅 update
    content: Optional[str]  # 仅 add

class Hunk(BaseModel):
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    lines: List[HunkLine]

class HunkLine(BaseModel):
    type: str  # "context" | "add" | "remove"
    content: str

class Conflict(BaseModel):
    file: str
    expected_hash: str
    actual_hash: str
    op_type: str

class ValidationResult(BaseModel):
    safe: bool
    conflicts: List[Conflict]
    diffs: List[FileDiff]
    ops_count: int

class ApplyResult(BaseModel):
    success: bool
    snapshot_id: Optional[str]
    applied_ops: int
    duration_ms: int
    error: Optional[str]
    failed_op: Optional[PatchOp]
    rolled_back: bool
```

### 4.2 文件 diff 格式

采用 unified diff 格式：
```
--- a/path/to/file.py
+++ b/path/to/file.py
@@ -1,3 +1,3 @@
 context
-removed
+added
```

---

## 5. 性能与安全

### 5.1 性能指标

| 指标 | 目标 | 测量 |
|------|------|------|
| 解析时间 | <50ms（10KB patch） | 实测 |
| 校验时间 | <100ms（10 文件） | 实测 |
| 应用时间 | <500ms（10 文件，每个 <1MB） | 实测 |
| 回滚时间 | <500ms | 实测 |

### 5.2 安全要求

- **路径校验**：禁止 `..`、绝对路径、符号链接 escape
- **白名单**：可配置允许编辑的目录
- **大小限制**：单文件 max 10MB，单 patch max 100MB
- **文件数限制**：单 patch max 50 个文件
- **hash 校验**：默认强制，force=true 跳过

### 5.3 错误处理

- 解析失败：返回 400 + 错误位置
- hash 不匹配：返回 409（除非 force）
- 应用失败：自动回滚 + 返回 500 + 失败 op 信息
- 权限拒绝：返回 403

---

## 6. 验收标准

### 6.1 功能验收

- [ ] 解析 V4A grammar（Update/Add/Delete）
- [ ] 校验文件 hash
- [ ] 预览 patch（生成 unified diff）
- [ ] 原子应用多文件 patch
- [ ] 失败自动回滚
- [ ] 与 SnapshotStore 集成
- [ ] 路径安全校验
- [ ] 文件大小限制

### 6.2 测试项目

#### 单元测试（≥40 用例）
- V4A parser (各种 grammar 场景)
- Update/Add/Delete op 解析
- Hash 校验
- Hunk 合并与冲突检测
- 事务性应用
- 失败回滚
- 路径 escape 防护
- 边界条件（空 patch、超大文件）

#### 集成测试（≥15 用例）
- 完整流程：parse → validate → preview → apply
- 多文件事务
- 部分失败回滚
- 与 SnapshotStore 集成
- API 端点 happy path
- 错误码返回

#### 前端测试（≥10 用例）
- ApplyPatchModal 显示 diff
- 确认/取消操作
- 错误提示
- force 模式切换

### 6.3 通过标准

- 所有测试 100% 通过
- 性能指标达标
- 失败回滚验证（手动测试 5 个失败场景）
- 无安全漏洞

---

## 7. 风险与回退

| 风险 | 缓解 | 回退方案 |
|------|------|---------|
| V4A 解析 bug 导致全文件损坏 | 严格测试 + snapshot | snapshot 回滚 |
| 哈希冲突误判 | 清晰错误信息 + force 模式 | 用户手动确认 |
| 并发冲突 | 文件锁 | 队列化处理 |

---

## 8. 交付清单

- `backend/app/services/apply_patch.py` (≈600 行)
- `backend/app/api/apply_patch.py` (≈250 行)
- `backend/tests/test_apply_patch.py` (≈500 行)
- `backend/tests/test_apply_patch_api.py` (≈350 行)
- `frontend/src/components/ApplyPatchModal.tsx` (≈400 行)
- `frontend/src/components/ApplyPatchModal.test.tsx` (≈300 行)
- 集成到 `claude_cli.py` 替换单文件写入

**总计**：~2400 行
