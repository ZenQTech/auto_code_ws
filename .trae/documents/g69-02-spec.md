# G69-02 Session Replay System 会话回放系统 - Spec 文档

**Cycle**: 69
**优先级**: P0
**对标**: codex-replay + Codex session picker + Codex JSONL 格式
**作者**: 总架构师
**生成时间**: 2026-08-05

---

## 1. 功能需求描述

### 1.1 目标
提供会话完整回放与审计能力：
- **HTML 自包含回放**: 单文件 HTML，包含 turn-by-turn 播放器
- **过滤能力**: 按 reasoning/tool/system 分类过滤
- **会话选择器**: 本地会话选择 UI
- **Retention Policy**: 自动压缩 + 90 天清理
- **书签系统**: 标记重要 turn 便于回溯

### 1.2 用户场景
- **场景 1**: 用户复盘 3 天前某次 bug 修复过程
- **场景 2**: 团队 leader 审计 agent 决策
- **场景 3**: 调试 agent 异常行为
- **场景 4**: 培训新成员理解历史项目决策

### 1.3 使用流程
```
1. 用户打开 "Session Replay" 面板
2. 系统扫描 ~/.hermes/sessions/ + ~/.hermes/rollouts/
3. 显示会话列表（按时间倒序）
4. 用户选择某次会话
5. 系统生成自包含 HTML 并展示
6. 用户可播放/暂停/拖拽/过滤
7. 用户可标记书签或导出
```

---

## 2. 技术实现方案

### 2.1 架构设计
```
┌──────────────────────────────────────────────┐
│           SessionReplayService                │
│  - list_sessions: 扫描本地会话                │
│  - render_html: 生成自包含 HTML                │
│  - apply_retention: 清理 + 压缩                │
│  - export_bookmark: 用户标记                   │
└──────────────┬───────────────────────────────┘
               │
       ┌───────┴────────┐
       ▼                ▼
┌─────────────┐  ┌──────────────────┐
│ RolloutReader│  │ HTMLRenderer     │
│ (已存在)    │  │ (jinja2 模板)    │
└─────────────┘  └──────────────────┘
```

### 2.2 核心数据结构
```python
@dataclass
class SessionMetadata:
    session_id: str
    title: str                    # 第一条 user message
    created_at: str
    updated_at: str
    total_turns: int
    total_tokens: int
    cwd: str
    git_branch: Optional[str]
    duration_ms: int
    rollout_path: str             # JSONL 文件路径
    size_bytes: int

@dataclass
class ReplayTurn:
    turn_index: int
    timestamp: str
    role: str                     # user | assistant | tool | system
    content: str
    reasoning: Optional[str]      # 解密后或摘要
    tool_calls: List[ToolCall]
    tool_outputs: List[ToolOutput]
    tokens: int
    duration_ms: int

@dataclass
class ReplayConfig:
    show_reasoning: bool = True
    show_tool_calls: bool = True
    show_system: bool = False
    theme: str = "default"        # default | dark | light | oxide-blue
    from_timestamp: Optional[str] = None
    to_timestamp: Optional[str] = None
    speed: float = 1.0            # 播放速度
```

### 2.3 核心算法

#### 2.3.1 会话列表
```python
def list_sessions(base_dir: str, limit: int = 100) -> List[SessionMetadata]:
    sessions = []
    for jsonl_path in glob(f"{base_dir}/**/rollout-*.jsonl"):
        metadata = parse_session_metadata(jsonl_path)
        sessions.append(metadata)
    return sorted(sessions, key=lambda s: s.updated_at, reverse=True)[:limit]
```

#### 2.3.2 HTML 渲染
```python
def render_replay_html(
    turns: List[ReplayTurn],
    config: ReplayConfig
) -> str:
    # 1. 加载模板
    template = jinja2_env.get_template("replay.html")
    # 2. 注入 turns（JSON 化）
    turns_json = json.dumps([t.to_dict() for t in turns])
    # 3. 注入配置
    return template.render(
        turns_json=turns_json,
        config=config.to_dict(),
        css=load_css(config.theme),
        js=load_js()
    )
```

#### 2.3.3 Retention Policy
```python
def apply_retention(base_dir: str, policy: RetentionPolicy):
    now = time.time()
    for jsonl_path in glob(f"{base_dir}/**/rollout-*.jsonl"):
        mtime = os.path.getmtime(jsonl_path)
        age_days = (now - mtime) / 86400
        if age_days > policy.max_age_days:
            # 压缩 + 归档
            gz_path = jsonl_path + ".gz"
            with open(jsonl_path, 'rb') as f_in:
                with gzip.open(gz_path, 'wb') as f_out:
                    f_out.writelines(f_in)
            os.remove(jsonl_path)
        elif os.path.getsize(jsonl_path) > policy.max_size_bytes:
            # truncate 早期 records
            truncate_old_records(jsonl_path, keep_last_n=1000)
```

---

## 3. 接口设计规范

### 3.1 Python API
```python
class SessionReplayService:
    def list_sessions(self, limit: int = 100) -> List[SessionMetadata]: ...
    def load_session(self, session_id: str) -> List[ReplayTurn]: ...
    def render_html(self, session_id: str, config: ReplayConfig = None) -> str: ...
    def save_bookmark(self, session_id: str, turn_index: int, label: str) -> Bookmark: ...
    def apply_retention(self, policy: RetentionPolicy = None) -> RetentionResult: ...
    def export_session(self, session_id: str, format: str) -> bytes: ...
```

### 3.2 REST API（6 个端点）
```
GET    /api/replay/sessions              列出所有会话
GET    /api/replay/sessions/{id}         获取会话详情
GET    /api/replay/sessions/{id}/html    渲染自包含 HTML
GET    /api/replay/sessions/{id}/turns   获取所有 turn（JSON）
POST   /api/replay/sessions/{id}/bookmark  添加书签
GET    /api/replay/sessions/{id}/bookmarks 列出书签
POST   /api/replay/retention/apply       手动触发 retention
GET    /api/replay/stats                 获取存储统计
```

### 3.3 请求/响应模型
```python
class SessionsListResponse(BaseModel):
    sessions: List[SessionMetadata]
    total: int
    total_size_bytes: int

class RenderHtmlRequest(BaseModel):
    config: Optional[ReplayConfig] = None

class RenderHtmlResponse(BaseModel):
    html: str
    size_bytes: int
    embedded_data: bool = True

class BookmarkCreateRequest(BaseModel):
    turn_index: int
    label: str

class RetentionPolicy(BaseModel):
    max_age_days: int = 90
    max_size_bytes: int = 100 * 1024 * 1024  # 100MB
    compress_after_days: int = 7
```

### 3.4 错误码
| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误（session_id 格式） |
| 404 | session 不存在 |
| 413 | HTML 渲染超过 10MB |
| 500 | JSONL 解析失败 |

---

## 4. 数据结构定义

### 4.1 ReplayTurn JSON 格式
```json
{
  "index": 0,
  "timestamp": "2026-08-05T12:34:56Z",
  "role": "assistant",
  "content": "我先分析一下问题...",
  "reasoning": {
    "summary": "用户询问登录失败",
    "encrypted": false,
    "content": "用户上次提到过..."
  },
  "tool_calls": [
    {
      "name": "shell",
      "args": {"cmd": "ls -la /tmp"},
      "output": "drwxr-xr-x 2 user user 4096 Aug 5 ..."
    }
  ],
  "tokens": 1234,
  "duration_ms": 2340
}
```

### 4.2 Bookmark JSON 格式
```json
{
  "bookmark_id": "bm-xxx",
  "session_id": "s-abc123",
  "turn_index": 5,
  "label": "发现根本原因",
  "created_at": "2026-08-05T12:40:00Z"
}
```

### 4.3 主题样式（CSS Variables）
```css
:root {
  --bg-app: #ffffff;
  --bg-panel: #f8f9fa;
  --text-primary: #1a1a1a;
  --text-secondary: #6c757d;
  --accent-color: #0d6efd;
  --border-color: #dee2e6;
}
[data-theme="dark"] {
  --bg-app: #1a1a1a;
  --bg-panel: #2d2d2d;
  --text-primary: #e0e0e0;
  --text-secondary: #999;
}
```

---

## 5. 性能与安全要求

### 5.1 性能
- 列出 1000 个会话: < 1s
- 加载单个会话（10k turns）: < 2s
- 渲染 HTML（5MB JSONL）: < 5s
- Retention 检查: < 10s（1000 个文件）

### 5.2 安全
- HTML 转义：所有用户内容必须 escape
- XSS 防护：使用 DOMPurify 或类似库
- 文件大小限制：单 HTML < 10MB
- 路径遍历：session_id 严格校验

### 5.3 存储
- 原始 JSONL: 保留 7 天
- 压缩 .gz: 7-90 天
- 删除: 90 天后
- 单 session 最大: 100MB

---

## 6. 验收标准

### 6.1 功能验证（脚本自动测试）
| 测试项 | 标准 |
|--------|------|
| 列出本地会话 | ✅ 返回正确元数据 |
| 加载会话 turns | ✅ 解析所有 turn |
| 渲染 HTML | ✅ 自包含、可离线打开 |
| 过滤器 | ✅ reasoning/tool 独立控制 |
| 书签创建/查询 | ✅ 持久化 |
| Retention 压缩 | ✅ 7 天后自动 .gz |
| Retention 清理 | ✅ 90 天后删除 |
| 主题切换 | ✅ 4 种主题 |

### 6.2 测试项目（自动化）
1. `test_session_replay_service.py` - 服务单元测试（15 个）
2. `test_html_renderer.py` - 渲染器测试（10 个）
3. `test_retention_policy.py` - 保留策略测试（8 个）
4. `test_replay_api.py` - REST API 测试（10 个）
5. `test_replay_panel.pyx` - 前端组件测试（5 个）
6. **合计**: 48 个新测试，全部通过

### 6.3 测试项目（前端 Web 测试）
- [ ] SessionReplayPanel 集成到 EmbeddedTools
- [ ] 会话列表展示
- [ ] HTML 渲染预览
- [ ] 过滤器交互
- [ ] 书签管理

### 6.4 通过条件
- 所有自动化测试 100% 通过
- HTML 渲染可离线打开（< 5s 加载）
- Retention 策略在真实数据上验证
- 文档完整
