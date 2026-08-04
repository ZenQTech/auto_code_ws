# G64-02 Spec: 文件系统 Watch + Stage 联动

> **Cycle**: 64
> **优先级**: 🟡 P1
> **目标**: 文件系统变化自动检测，联动阶段检测器提升准确率
> **来源**: cycle64-research-report.md + cycle63 gap analysis

---

## 1. 功能需求描述

### 1.1 目标
为 StageDetector 添加文件系统变化输入信号：
- 实时监控项目目录文件变化
- 文件变化模式识别（创建/修改/删除）
- 与规则匹配协同提升 stage 检测准确率
- 例如：检测到新 .py 文件创建 → 阶段从 prd → coding

### 1.2 用户场景
- **场景 1（文件创建触发）**: AI 创建了 test_foo.py 文件 → stage 自动从 prd → coding
- **场景 2（文件修改触发）**: AI 修改了 main.py → 阶段置信度提升
- **场景 3（构建产物）**: 出现 build/ 目录或 dist/ → stage 转向 deploy
- **场景 4（多源融合）**: 规则匹配 + LLM 分类 + 文件事件，三者综合判断

### 1.3 核心特性
- ✅ watchdog 实时文件监控
- ✅ 文件事件类型：create/modify/delete/move
- ✅ 路径模式匹配（*.py → coding, *.md → prd, build/ → deploy）
- ✅ 防抖：100ms 内多次变化合并
- ✅ 与现有 StageDetector 集成
- ✅ WebSocket 推送文件事件

---

## 2. 技术实现方案

### 2.1 架构

```
┌────────────────────────────────────────────────┐
│  StageDetector (v2.0.0)                       │
│  ┌──────────────┐  ┌──────────────┐           │
│  │ Rule Engine  │  │ LLM          │           │
│  │ (keywords)   │  │ Classifier   │           │
│  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                   │
│  ┌──────▼─────────────────▼──────┐            │
│  │   Stage State Machine         │            │
│  │   (session_id -> stage)       │            │
│  └──────┬────────────────────────┘            │
│         │                                      │
│  ┌──────▼───────────────────────┐  (新)        │
│  │   FS Watcher                  │            │
│  │   (watchdog Observer)         │            │
│  └──────┬────────────────────────┘            │
│         │                                      │
│  ┌──────▼───────────────────────┐            │
│  │   StageEventBus (WebSocket)   │            │
│  └────────────────────────────────────────┘    │
└────────────────────────────────────────────────┘
```

### 2.2 文件 → Stage 映射

| 模式 | 触发阶段 | 置信度 |
|------|----------|--------|
| `*.py`, `*.ts`, `*.tsx`, `*.js` 创建/修改 | coding | 0.6 |
| `*.md`, `*.txt`, PRD 文件创建/修改 | prd | 0.5 |
| `test_*.py`, `*.test.ts`, `*.spec.ts` 创建 | preview | 0.4 |
| `build/`, `dist/`, `*.zip` 创建 | deploy | 0.7 |
| `Dockerfile`, `docker-compose.yml` 修改 | deploy | 0.6 |
| `package.json`, `requirements.txt` 修改 | coding | 0.4 |

### 2.3 防抖策略

- 100ms 窗口内多次事件合并
- 单次事件触发增量更新
- 避免高频文件变化风暴

---

## 3. 接口设计

```python
POST /api/stage/watch/start    # 启动文件监控
POST /api/stage/watch/stop     # 停止
GET  /api/stage/watch/status   # 状态
WS   /api/stage/ws/{session_id}  # 增加 fs_event 类型
```

### 文件事件

```python
class FSStageEvent(BaseModel):
    event_id: str
    session_id: str
    event_type: str  # file_create / file_modify / file_delete / file_move
    path: str
    inferred_stage: str
    confidence: float
    timestamp: float
```

---

## 4. 数据结构

```python
class FSWatcherConfig:
    session_id: str
    watch_path: str
    patterns: List[str]  # glob patterns
    exclude: List[str]   # exclude patterns
    debounce_ms: int = 100
```

---

## 5. 性能与安全

### 5.1 性能
- 监控 10k 文件下 < 50ms 延迟
- 防抖窗口 100ms
- 单次事件 < 5KB

### 5.2 安全
- 路径白名单（仅监控项目内）
- .git/ node_modules/ 排除
- 防止递归 symlink

---

## 6. 验收标准

### 6.1 功能
- [ ] watchdog 正确安装并启动
- [ ] 文件创建/修改/删除事件捕获
- [ ] 模式匹配正确
- [ ] 防抖生效
- [ ] Stage 联动正确

### 6.2 测试
- [ ] `test_fs_watcher.py`: watchdog 测试（≥ 15 个）
- [ ] `test_fs_stage.py`: FS → Stage 映射测试（≥ 10 个）
- [ ] mock watchdog Observer（测试环境无真实文件 IO）
- [ ] 覆盖率 ≥ 90%

### 6.3 浏览器 E2E
1. 打开 Solo Shell
2. 启动 FS watch
3. 创建 test.py 文件
4. 观察 stage 从 idle → coding
5. 删除文件
6. 验证 file_delete 事件
