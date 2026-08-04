# G63-03 Spec: 阶段检测器 + Auto-Follow

> **Cycle**: 63
> **优先级**: 🔴 P0
> **目标**: 对标 Trae SOLO Auto-Follow 能力，自动识别 AI 工作阶段并联动工具面板
> **来源**: cycle63-research-report.md § 2.3 + cycle63-gap-analysis.md § 2.3

---

## 1. 功能需求描述

### 1.1 目标
为 Hermes Solo 模式添加阶段自动识别能力，实时检测 AI 工作阶段（PRD/编码/预览/部署），并通过 Auto-Follow 自动切换工具面板。

### 1.2 用户场景
- **场景 1（自动跟随）**: AI 正在生成 PRD 时，右栏自动展示 DocView；进入编码阶段自动切换到编辑器
- **场景 2（手动控制）**: 用户可以强制设置阶段，禁用 Auto-Follow
- **场景 3（阶段历史）**: 查看会话中阶段流转历史，用于复盘
- **场景 4（WebSocket 实时）**: 多个客户端订阅同一 session，阶段变更实时推送

### 1.3 阶段定义

| 阶段 | 标签 | 触发关键词 | 默认工具面板 |
|------|------|------------|--------------|
| `prd` | 📋 需求分析 | "PRD", "user story", "acceptance" | DocView |
| `coding` | 💻 编码 | "function", "class", "```", "import" | Editor + Terminal |
| `preview` | 👀 预览 | "preview", "localhost", "screenshot" | Browser |
| `deploy` | 🚀 部署 | "deploy", "vercel", "build" | Terminal + Deploy |

### 1.4 核心特性
- ✅ 4 阶段自动识别（基于 LLM 输出 + 任务状态机 + 文件系统）
- ✅ WebSocket 实时推送
- ✅ Auto-Follow 联动工具面板
- ✅ 手动 override
- ✅ 阶段历史查询
- ✅ 置信度显示

---

## 2. 技术实现方案

### 2.1 架构

```
┌─────────────────────────────────────────────┐
│  StageDetector                              │
│  ┌──────────────┐  ┌──────────────┐         │
│  │  Rule Engine │  │  LLM         │         │
│  │  (keywords)  │  │  Classifier  │         │
│  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │
│  ┌──────▼─────────────────▼──────┐          │
│  │   Stage State Machine         │          │
│  │   (session_id -> stage)       │          │
│  └──────┬────────────────────────┘          │
│         │                                   │
│  ┌──────▼───────────────────────┐          │
│  │   StageEventBus (WebSocket)   │          │
│  └───────────────────────────────┘          │
└─────────────────────────────────────────────┘
```

### 2.2 检测算法

**Rule-based 关键词匹配** (快速、粗粒度):
```python
STAGE_TRIGGERS = {
    "prd": ["PRD", "user story", "acceptance criteria", "需求文档"],
    "coding": ["```", "function ", "class ", "import ", "def ", "const "],
    "preview": ["preview", "http://localhost", "screenshot", "127.0.0.1"],
    "deploy": ["deploy", "vercel", "netlify", "npm run build", "git push"],
}
```

**LLM-based 分类器** (精确、慢):
- 输入: 最近 1000 字符的 AI 输出
- Prompt: 分类到 4 个阶段之一
- 输出: 阶段 + 置信度

**混合策略**:
- 优先使用规则匹配（< 10ms）
- 置信度 < 0.7 时触发 LLM 二次分类
- 状态机防止阶段跳跃

### 2.3 状态机

```
   ┌──────┐
   │ idle │ ← 初始
   └──┬───┘
      ↓
   ┌──────┐
   │ prd  │ → ┌─────────┐
   └──┬───┘   │ coding  │ → ┌─────────┐
      ↓       └────┬────┘   │ preview │ → ┌────────┐
      ↑────────────┴─────────┴─────────┘   │ deploy │
                                            └────┬───┘
                                                 ↓
                                              ┌─────┐
                                              │ done│
                                              └─────┘
```

---

## 3. 接口设计

```python
GET  /api/stage/current?session_id={id}     # 获取当前阶段
POST /api/stage/force                        # 强制设置阶段
WS   /api/stage/ws/{session_id}             # WebSocket 实时推送
GET  /api/stage/history?session_id={id}     # 阶段历史
POST /api/stage/auto-follow                  # 启用/禁用 Auto-Follow
```

### WebSocket 事件

```json
{
  "type": "stage_change",
  "session_id": "sess-123",
  "from_stage": "prd",
  "to_stage": "coding",
  "confidence": 0.92,
  "reason": "Detected coding keywords in AI output",
  "timestamp": 1691234567.89
}
```

---

## 4. 数据结构

```python
class StageState(BaseModel):
    session_id: str
    stage: str  # prd/coding/preview/deploy/idle/done
    substage: Optional[str] = None
    confidence: float = 0.0
    auto_follow: bool = True
    entered_at: float
    source: str  # rule/llm/manual

class StageEvent(BaseModel):
    event_id: str
    session_id: str
    type: str  # stage_change/substage_change/follow_action
    from_stage: Optional[str] = None
    to_stage: Optional[str] = None
    confidence: Optional[float] = None
    reason: Optional[str] = None
    timestamp: float
```

---

## 5. 性能与安全

### 5.1 性能
- 规则检测延迟: < 50ms
- LLM 检测延迟: < 2s
- WebSocket 推送: < 100ms
- 阶段历史查询: < 50ms

### 5.2 安全
- session_id 校验
- WebSocket 鉴权（基于现有 token）
- 防止阶段操纵（仅 session owner 可强制设置）

---

## 6. 验收标准

### 6.1 功能
- [ ] 4 阶段正确识别（准确率 ≥ 85%）
- [ ] WebSocket 推送稳定
- [ ] Auto-Follow 联动工具面板
- [ ] 手动 override 工作
- [ ] 阶段历史完整记录

### 6.2 测试
- [ ] `test_stage_detector.py`: 规则引擎测试（≥ 20 个）
- [ ] `test_stage_api.py`: API 测试（≥ 15 个）
- [ ] `StageIndicator.test.tsx`: 组件测试（≥ 8 个）
- [ ] `useStage.test.ts`: Hook 测试（≥ 8 个）
- [ ] 测试覆盖 ≥ 90%

### 6.3 浏览器 E2E
1. 打开 Solo Shell
2. 启动一个 vibe coding session
3. 提交需求，AI 响应
4. 观察 StageIndicator 从 idle → prd
5. AI 编写代码
6. 观察 prd → coding，工具面板自动切换
7. AI 完成编码
8. 手动切换到 deploy 阶段
9. 验证工具面板跟随切换
10. 禁用 Auto-Follow
11. 验证后续阶段变化不再切换面板

### 6.4 文档
- [ ] `g63-03-usage.md` 使用指南
- [ ] 阶段检测算法说明
