# G68-01 Spec: 项目代码库索引（Codebase Indexer）

> **Cycle**: 68
> **Priority**: P0
> **Status**: 待实现
> **对标**: Codex `codex-rs/project_index` (ripgrep) + Trae IDE (BM25 + Embedding 混合索引)

---

## 1. 功能需求

### 1.1 功能目标

提供项目级代码库全文 + 符号索引能力，支持 LLM 在 vibe coding 时按需检索相关文件、符号、片段，避免把整个代码库塞入 context window。

### 1.2 用户场景

- **场景 A**: 用户问 "find the function that handles auth retries"
  - 系统返回所有匹配的文件路径 + 行号 + 上下文片段
  - 自动按相关性排序
- **场景 B**: 用户问 "show me the structure of the project"
  - 系统返回文件清单 + 关键符号
- **场景 C**: 用户编辑文件时
  - 索引自动失效并重建（FS Watch）
  - 旧查询结果自动标记为 stale

### 1.3 使用流程

```
1. session 启动 → 索引构建（lazy，<5s）
2. 用户/Agent 调用 codebase_search(query, top_k=20)
3. 服务返回匹配文件 + 行号 + 上下文
4. Agent 读取相关片段
5. 文件变化时 FS Watch 触发增量更新
```

---

## 2. 技术实现方案

### 2.1 架构设计

```
┌──────────────────────────────────────────────────────────┐
│  CodebaseIndexerService (内存索引)                        │
│  ┌────────────────┐  ┌─────────────────┐                │
│  │ FileIndex      │  │ SymbolIndex     │                │
│  │ - path         │  │ - name          │                │
│  │ - size/mtime   │  │ - kind (fn/cls) │                │
│  │ - hash         │  │ - file:line     │                │
│  │ - lang         │  │ - signature     │                │
│  └────────────────┘  └─────────────────┘                │
│  ┌────────────────────────────────────────┐              │
│  │ TextSearch (基于 ripgrep / 正则)       │              │
│  │ - line-based grep                       │              │
│  │ - snippet extraction (3 lines context)  │              │
│  └────────────────────────────────────────┘              │
└──────────────────────────────────────────────────────────┘
                ↑ FS Watch 增量
                ↑ REST API 查询
```

### 2.2 核心算法

#### 索引构建

```python
def build_index(project_root: str) -> None:
    for path in Path(project_root).rglob("*"):
        if is_ignored(path):
            continue
        if path.is_file():
            file_idx = scan_file(path)  # mtime, size, hash
            for sym in extract_symbols(path):
                symbol_idx.add(sym)
            for line in read_lines(path):
                text_idx.index_line(path, line_no, line)
```

复杂度：O(n × log n)，n = 文件数

#### 查询

```python
def search(query: str, top_k: int = 20) -> list[SearchResult]:
    # 1. 关键词提取
    tokens = tokenize(query)

    # 2. 多策略并行
    text_hits = text_idx.search(tokens, limit=top_k * 2)
    symbol_hits = symbol_idx.search(tokens, limit=top_k)

    # 3. 合并 + 排序
    merged = merge_and_rank(text_hits, symbol_hits, top_k=top_k)

    return merged
```

复杂度：O(m × log m)，m = 索引条目数

#### 增量更新

```python
def on_file_changed(path: str) -> None:
    file_idx.invalidate(path)
    symbol_idx.invalidate(path)
    text_idx.invalidate(path)
    schedule_reindex(path)
```

### 2.3 符号提取（避免 tree-sitter 依赖）

轻量正则扫描：
- Python: `def\s+(\w+)`, `class\s+(\w+)`
- TypeScript: `function\s+(\w+)`, `class\s+(\w+)`, `const\s+(\w+)\s*=`
- Rust: `fn\s+(\w+)`, `struct\s+(\w+)`

---

## 3. 接口设计

### 3.1 REST API

#### `POST /api/codebase/index`

构建/重建索引

**Request**:
```json
{
  "project_root": "/path/to/project",
  "force_rebuild": false
}
```

**Response 200**:
```json
{
  "session_id": "idx-abc123",
  "total_files": 142,
  "total_symbols": 532,
  "build_time_ms": 3421,
  "status": "completed"
}
```

#### `POST /api/codebase/search`

搜索代码库

**Request**:
```json
{
  "session_id": "idx-abc123",
  "query": "auth retry",
  "top_k": 20,
  "file_pattern": "*.py",
  "include_symbols": true
}
```

**Response 200**:
```json
{
  "query": "auth retry",
  "total": 12,
  "results": [
    {
      "type": "text",
      "file": "src/auth/retry.py",
      "line_start": 45,
      "line_end": 47,
      "snippet": "def retry_with_backoff(max_retries=3):",
      "score": 0.92
    },
    {
      "type": "symbol",
      "file": "src/auth/handler.py",
      "line": 102,
      "name": "AuthHandler.handle_retry",
      "kind": "method",
      "signature": "async def handle_retry(self, req):",
      "score": 0.87
    }
  ]
}
```

#### `GET /api/codebase/file`

获取文件片段

**Request**:
```
GET /api/codebase/file?path=src/auth/handler.py&line_start=95&line_end=120
```

**Response 200**:
```json
{
  "path": "src/auth/handler.py",
  "language": "python",
  "total_lines": 250,
  "lines": [
    {"line_no": 95, "content": "class AuthHandler:"},
    ...
  ]
}
```

#### `GET /api/codebase/stats`

索引统计

**Response 200**:
```json
{
  "session_id": "idx-abc123",
  "total_files": 142,
  "total_symbols": 532,
  "total_lines": 18520,
  "languages": {"python": 45, "typescript": 30, "rust": 12},
  "indexed_at": 1728123456.789,
  "fs_watch_active": true
}
```

### 3.2 错误码

| 错误码 | HTTP | 含义 |
|--------|------|------|
| `INDEX_NOT_FOUND` | 404 | session_id 不存在 |
| `INVALID_QUERY` | 400 | query 为空或过长（>500 chars） |
| `FILE_TOO_LARGE` | 413 | 单文件 > 10MB |
| `PERMISSION_DENIED` | 403 | 文件不可读 |
| `INDEX_BUILD_FAILED` | 500 | 内部错误 |

### 3.3 WebSocket 事件

#### `INDEX_REBUILD_START`

```json
{"session_id": "idx-abc123", "project_root": "/path"}
```

#### `INDEX_REBUILD_PROGRESS`

```json
{"session_id": "idx-abc123", "files_done": 50, "files_total": 142}
```

#### `INDEX_REBUILD_COMPLETE`

```json
{"session_id": "idx-abc123", "total_files": 142, "build_time_ms": 3421}
```

#### `FILE_CHANGED`

```json
{"path": "src/auth/retry.py", "change_type": "modified"}
```

---

## 4. 数据结构

### 4.1 索引条目

```python
class FileEntry(BaseModel):
    path: str
    abs_path: str
    size: int
    mtime: float
    hash: str  # SHA-256
    language: str  # python / typescript / rust / unknown
    line_count: int
    is_binary: bool
    is_ignored: bool

class SymbolEntry(BaseModel):
    name: str
    kind: str  # function / class / method / variable
    file: str
    line: int
    signature: str  # 完整签名（截断到 200 字符）
    doc: Optional[str]  # 文档字符串

class TextHit(BaseModel):
    file: str
    line_start: int
    line_end: int
    snippet: str  # 包含 ±3 行上下文
    matched_terms: List[str]
    score: float

class SearchResult(BaseModel):
    type: str  # "text" | "symbol"
    file: str
    line: Optional[int]
    line_start: Optional[int]
    line_end: Optional[int]
    name: Optional[str]
    kind: Optional[str]
    signature: Optional[str]
    snippet: Optional[str]
    score: float
```

### 4.2 索引存储

- 内存：Python dict + list
- 持久化（可选）：`~/.hermes/codebase_index/{session_id}.json`
- 重启时：可选 reload 持久化索引

### 4.3 FS Watch 集成

- 复用 `filesystem_watcher.py` 的 WatchEvent
- 新增 `on_change(path)` 回调：失效 + 标记 stale + 异步重建

---

## 5. 性能与安全

### 5.1 性能指标

| 指标 | 目标 | 测量方法 |
|------|------|---------|
| 单 session 索引构建 | <5s（10K 文件） | 实测 |
| 搜索响应时间 | <200ms | p95 latency |
| 增量更新延迟 | <500ms | FS event → invalidate |
| 内存占用 | <500MB（10K 文件） | psutil |
| 索引持久化 | <1s | save/load |

### 5.2 安全要求

- **路径校验**：禁止 `..`、绝对路径 escape
- **白名单**：可配置 ignore patterns（`node_modules/`、`.git/`、`__pycache__/`）
- **二进制跳过**：检测 `null bytes` 自动跳过
- **资源限制**：单文件 max 10MB，全索引 max 100MB
- **并发安全**：threading.Lock 保护索引 dict

### 5.3 错误处理

- 文件读取失败：log warning + 跳过
- 符号提取失败：返回空 symbol 列表
- 索引构建失败：保留旧索引 + 标记 dirty

---

## 6. 验收标准

### 6.1 功能验收

- [ ] POST /api/codebase/index 能构建项目索引
- [ ] POST /api/codebase/search 能搜索文本（≥80% 准确率）
- [ ] POST /api/codebase/search 能搜索符号
- [ ] GET /api/codebase/file 能返回文件片段
- [ ] GET /api/codebase/stats 返回统计
- [ ] FS Watch 自动失效 + 增量重建
- [ ] 忽略 node_modules、.git 等
- [ ] 支持 4+ 语言符号提取

### 6.2 测试项目

#### 单元测试（≥30 用例）
- FileIndex 添加/更新/查询
- SymbolIndex 多语言提取
- TextSearch 关键词匹配
- 路径校验（escape 防护）
- 大文件跳过
- 并发安全性
- 持久化 save/load

#### 集成测试（≥10 用例）
- 构建索引（小型项目 fixture）
- 搜索准确率（known query → expected results）
- FS Watch 触发失效
- API 端点 happy path
- 错误码返回

#### 前端测试（≥10 用例）
- useCodebaseSearch Hook
- CodebaseSearchPanel 组件
- 输入查询触发 API
- 显示搜索结果
- 点击结果跳到文件

### 6.3 通过标准

- 所有单元测试 100% 通过
- 所有集成测试 100% 通过
- 性能指标达标（索引 <5s，搜索 <200ms）
- 准确率 ≥80%（使用 10 个 known query 验证）
- 无安全漏洞（路径 escape 测试通过）

---

## 7. 风险与回退

| 风险 | 缓解 | 回退方案 |
|------|------|---------|
| 大项目索引慢 | lazy build + 增量 | fallback 到 `multi_context` 文本搜索 |
| 符号提取不准 | 仅做 hint，不替代 grep | 用户可手动 grep |
| FS Watch 抖动 | debounce 1s | 定时全量重建（5min） |
| 内存爆炸 | 限制单文件 10MB | 仅索引元数据 |

---

## 8. 交付清单

- `backend/app/services/codebase_indexer.py` (≈500 行)
- `backend/app/api/codebase.py` (≈200 行)
- `backend/tests/test_codebase_indexer.py` (≈400 行)
- `backend/tests/test_codebase_api.py` (≈300 行)
- `frontend/src/hooks/useCodebaseSearch.ts` (≈300 行)
- `frontend/src/hooks/useCodebaseSearch.test.ts` (≈250 行)
- `frontend/src/components/CodebaseSearchPanel.tsx` (≈400 行)
- `frontend/src/components/CodebaseSearchPanel.test.tsx` (≈300 行)
- `frontend/src/components/EmbeddedTools.tsx` 修改（新增 codebase tab）
- `frontend/src/__tests__/EmbeddedTools.test.tsx` 修改

**总计**：~2650 行
