# Cycle 14 P1-3: TRAE Work 多模态协作 (Design/Voice/Video/Global Memory) 设计与实现

> **Cycle**: 14
> **优先级**: P1-3
> **类型**: 后端核心模块 + 前端 UI
> **状态**: 🚧 开发中
> **版本**: v6.31.0
> **开始时间**: 2026-07-28

---

## 一、需求描述

### 1.1 业务背景

参考 **TRAE v0.1.18-v0.1.39** 的 "TRAE Work"（原 SOLO 模式）多模态协作能力，本任务为 Hermes 智能体调度平台引入完整的 Work 多模态协作子系统。当前项目已在 Cycle 14 P0-2 实现了 Vision/Audio 基础多模态，但仍缺失 TRAE Work 标志性的 4 大能力：

- **Design Mode**：一站式设计工具集，生成设计草图、自然语言批量编辑、设计系统管理、设计导出代码
- **Voice Chat 优化**：项目级上下文/记忆引用、增强 Web 搜索
- **Global Memory**：项目级个性化知识库，跨会话保留所有历史交互
- **Video Generation**：TRAE Desktop/Web 视频生成、帧提取与摘要

### 1.2 核心目标

#### Design Mode (设计模式)
- ✅ 设计草图生成（基于自然语言描述）
- ✅ 设计系统管理（色彩、字体、组件、间距令牌）
- ✅ 自然语言批量编辑（"把所有按钮改成圆角"）
- ✅ 设计 → 代码导出（HTML/Tailwind/React 组件）
- ✅ 6 类工作流模板（Web/移动端/落地页/组件库/海报/Dashboard）

#### Voice Chat 优化
- ✅ 项目级上下文注入（自动加载当前项目相关记忆）
- ✅ 跨会话记忆引用
- ✅ 增强 Web 搜索（多源聚合 + 相关性排序）
- ✅ 语音对话会话管理
- ✅ 实时语音转写流式输出

#### Global Memory
- ✅ 项目级知识库（独立的 memory 命名空间）
- ✅ 跨会话上下文保留
- ✅ 个性化偏好持久化（用户偏好、对话风格）
- ✅ 知识条目生命周期管理（创建/更新/废弃）
- ✅ 语义检索（关键词 + 标签 + 时间衰减）

#### Video Generation
- ✅ 视频元数据提取（时长、分辨率、帧率、编解码）
- ✅ 关键帧提取（基于场景变化检测）
- ✅ 视频摘要（基于关键帧 + 字幕）
- ✅ Mock 视频生成（基于时间线 + 文字描述）
- ✅ 视频转 GIF 缩略图

### 1.3 用户场景

| 场景 | 描述 | 输入 | 输出 |
| --- | --- | --- | --- |
| 设计协作 | 设计师描述需求生成设计 | 自然语言 + 模板 | 设计草图 + HTML 代码 |
| 设计导出 | 将设计稿转为可运行代码 | 设计 ID | React/Tailwind 组件 |
| 语音对话 | 与 AI 进行语音交互 | 语音 + 项目上下文 | 转写文本 + 智能回复 |
| 项目记忆 | 跨会话记住项目偏好 | 用户偏好描述 | 持久化知识条目 |
| 视频分析 | 上传教学视频 | MP4/WebM | 关键帧 + 摘要 + 字幕 |

---

## 二、技术实现方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  TRAE Work Multimodal Layer                      │
├─────────────────────────────────────────────────────────────────┤
│  Design Mode    │  Voice Chat    │  Global Memory  │  Video      │
│  - Drafts       │  - Sessions    │  - KB Entries   │  - Frames   │
│  - Design Sys   │  - STT/TTS     │  - Preferences  │  - Summary  │
│  - NL Edits     │  - Web Search  │  - Search       │  - Generate │
│  - Code Export  │  - Context Inj │  - Lifecycle    │  - Metadata │
├─────────────────────────────────────────────────────────────────┤
│              Work Manager (Unified State + Storage)              │
│  - RLock Thread Safety │ JSONL Index │ Path Whitelist            │
├─────────────────────────────────────────────────────────────────┤
│              Storage Layer (File System + JSONL Index)            │
│  /tmp/hermes_trae_work/  │  {design,voice,memory,video}_index.jsonl │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 数据模型 (models.py)

```python
# Design Mode
@dataclass
class DesignDraft:
    draft_id: str
    name: str
    template: str  # web | mobile | landing | components | poster | dashboard
    description: str
    style: Dict[str, Any]  # colors, fonts, spacing
    components: List[Dict[str, Any]]
    html: str
    created_at: str
    updated_at: str
    owner: str

@dataclass
class DesignSystem:
    system_id: str
    name: str
    colors: Dict[str, str]  # primary, secondary, accent, neutral
    typography: Dict[str, Any]  # fontFamily, sizes, weights
    spacing: Dict[str, int]  # xs, sm, md, lg, xl
    components: Dict[str, Any]  # button, input, card
    created_at: str

# Voice Chat
@dataclass
class VoiceSession:
    session_id: str
    user_id: str
    project_id: str
    messages: List[Dict[str, Any]]  # role, text, audio_id, timestamp
    context_refs: List[str]  # global memory IDs
    web_search_results: List[Dict[str, Any]]
    started_at: str
    last_active_at: str

# Global Memory
@dataclass
class KnowledgeEntry:
    entry_id: str
    project_id: str
    category: str  # preference | fact | context | rule | todo
    content: str
    tags: List[str]
    source: str  # user | conversation | agent | import
    confidence: float
    created_at: str
    last_used_at: str
    use_count: int
    status: str  # active | archived | deprecated

# Video
@dataclass
class VideoMetadata:
    video_id: str
    file_path: str
    duration: float
    width: int
    height: int
    fps: float
    codec: str
    file_size: int
    uploaded_by: str
    uploaded_at: str

@dataclass
class VideoSummary:
    summary_id: str
    video_id: str
    key_frames: List[str]  # 帧 ID 列表
    duration: float
    transcript: str
    scenes: List[Dict[str, Any]]
    summary_text: str
    created_at: str

@dataclass
class VideoGeneration:
    gen_id: str
    prompt: str
    duration: float
    resolution: str
    style: str
    output_path: str
    status: str  # queued | running | completed | failed
    created_at: str
```

#### 2.2.2 Design Mode 模块 (design.py)

- **草图生成**：基于模板 + 自然语言描述，生成 HTML + CSS
- **设计系统管理**：CRUD 设计令牌
- **自然语言编辑**：解析编辑指令并应用到草图
- **代码导出**：生成 React/Tailwind 组件

**核心算法**：
- 模板匹配：关键词 + 模板名
- HTML 生成：基于模板骨架填充组件
- 样式应用：CSS 变量 + 类名匹配

#### 2.2.3 Voice Chat 模块 (voice.py)

- **会话管理**：创建/查询/删除语音会话
- **项目上下文注入**：从 Global Memory 拉取相关条目
- **Web 搜索增强**：多关键词聚合 + 相关性排序
- **STT/TTS Mock**：本地规则引擎模拟

**核心算法**：
- 上下文检索：关键词匹配 + 时间衰减
- Web 搜索：模拟多结果返回

#### 2.2.4 Global Memory 模块 (memory.py)

- **知识条目 CRUD**：创建/读取/更新/删除
- **类别管理**：preference/fact/context/rule/todo
- **标签系统**：多标签检索
- **生命周期**：active → archived → deprecated
- **使用统计**：use_count + last_used_at
- **语义检索**：关键词 + 标签 + 衰减因子

**核心算法**：
- 相关性评分：`score = (tag_match * 0.4) + (keyword * 0.4) + (recency * 0.2)`
- 衰减因子：`recency = exp(-days_since_last_use / 30)`

#### 2.2.5 Video 模块 (video.py)

- **元数据提取**：模拟视频时长/分辨率/帧率
- **关键帧提取**：基于场景变化检测（Mock）
- **视频摘要**：基于关键帧 + 字幕拼接
- **Mock 视频生成**：生成 SVG/GIF 占位文件

**核心算法**：
- 帧采样：均匀采样 N 帧 + 场景检测
- 摘要生成：场景描述拼接 + 关键词提取

#### 2.2.6 统一管理器 (manager.py)

- **线程安全**：全局 RLock 保护共享状态
- **单例模式**：全局唯一实例
- **索引管理**：JSONL 持久化
- **统计信息**：各模块独立计数

#### 2.2.7 API 端点 (api.py)

总计 **28 个 REST 端点**：

**Design Mode (8)**
- `GET /api/work/design/health` - 健康检查
- `GET /api/work/design/stats` - 统计
- `POST /api/work/design/drafts` - 创建草图
- `GET /api/work/design/drafts` - 列出草图
- `GET /api/work/design/drafts/{draft_id}` - 获取草图
- `PUT /api/work/design/drafts/{draft_id}` - 更新草图
- `DELETE /api/work/design/drafts/{draft_id}` - 删除草图
- `POST /api/work/design/drafts/{draft_id}/nl-edit` - NL 编辑
- `POST /api/work/design/drafts/{draft_id}/export` - 导出代码
- `GET/POST/PUT/DELETE /api/work/design/systems/{id}` - 设计系统 CRUD

**Voice Chat (6)**
- `GET /api/work/voice/health` - 健康检查
- `POST /api/work/voice/sessions` - 创建语音会话
- `GET /api/work/voice/sessions/{id}` - 获取会话
- `POST /api/work/voice/sessions/{id}/messages` - 发送消息
- `GET /api/work/voice/sessions/{id}/context` - 获取上下文
- `POST /api/work/voice/web-search` - Web 搜索

**Global Memory (8)**
- `GET /api/work/memory/health` - 健康检查
- `POST /api/work/memory/entries` - 创建条目
- `GET /api/work/memory/entries` - 列出条目
- `GET /api/work/memory/entries/{id}` - 获取条目
- `PUT /api/work/memory/entries/{id}` - 更新条目
- `DELETE /api/work/memory/entries/{id}` - 删除条目
- `POST /api/work/memory/search` - 检索
- `GET /api/work/memory/stats` - 统计

**Video (6)**
- `GET /api/work/video/health` - 健康检查
- `POST /api/work/video/upload` - 上传视频
- `GET /api/work/video/videos/{id}` - 获取视频元数据
- `POST /api/work/video/videos/{id}/extract-frames` - 提取关键帧
- `POST /api/work/video/videos/{id}/summarize` - 生成摘要
- `POST /api/work/video/generate` - Mock 视频生成
- `GET /api/work/video/stats` - 统计

### 2.3 安全设计

#### 路径白名单
- 存储根目录：`/tmp/hermes_trae_work/`（可通过 `HERMES_WORK_DIR` 覆盖）
- 禁止 `..`、符号链接、相对路径穿越

#### 大小限制
- 视频文件：100MB
- 设计草图：单文件 1MB
- 知识条目：单条 16KB

#### 访问控制
- 草图按 `owner` 过滤
- 知识条目按 `project_id` 隔离
- 视频按 `uploaded_by` 隔离

---

## 三、接口设计规范

### 3.1 Design Mode - 创建草图

**请求**：
```json
POST /api/work/design/drafts
{
  "name": "Landing Page Hero",
  "template": "landing",
  "description": "A modern SaaS landing page with hero section and CTA",
  "owner": "user_123",
  "style": {
    "primary_color": "#4F46E5",
    "font_family": "Inter"
  }
}
```

**响应**：
```json
{
  "success": true,
  "draft": {
    "draft_id": "draft_abc123",
    "name": "Landing Page Hero",
    "template": "landing",
    "html": "<html>...</html>",
    "style": {...},
    "components": [...],
    "created_at": "2026-07-28T20:00:00Z"
  }
}
```

### 3.2 Design Mode - NL 编辑

**请求**：
```json
POST /api/work/design/drafts/{draft_id}/nl-edit
{
  "instruction": "把所有按钮改成圆角，主色改为 #10B981"
}
```

**响应**：
```json
{
  "success": true,
  "draft": {...},
  "applied_changes": [
    {"type": "border-radius", "target": "button", "value": "8px"},
    {"type": "color", "target": "primary", "value": "#10B981"}
  ]
}
```

### 3.3 Voice Chat - 发送消息

**请求**：
```json
POST /api/work/voice/sessions/{session_id}/messages
{
  "text": "请帮我设计登录页",
  "audio_id": null,
  "use_context": true,
  "use_web_search": false
}
```

**响应**：
```json
{
  "success": true,
  "message": {
    "message_id": "vmsg_001",
    "role": "user",
    "text": "请帮我设计登录页"
  },
  "context_refs": ["kb_001", "kb_005"],
  "reply": {
    "message_id": "vmsg_002",
    "role": "assistant",
    "text": "基于您之前的项目偏好..."
  }
}
```

### 3.4 Global Memory - 检索

**请求**：
```json
POST /api/work/memory/search
{
  "project_id": "proj_123",
  "query": "用户偏好登录页",
  "top_k": 5
}
```

**响应**：
```json
{
  "success": true,
  "results": [
    {
      "entry_id": "kb_001",
      "category": "preference",
      "content": "用户喜欢蓝色主题",
      "tags": ["ui", "color"],
      "relevance_score": 0.87
    }
  ]
}
```

### 3.5 Video - 摘要

**请求**：
```json
POST /api/work/video/videos/{video_id}/summarize
{
  "frame_count": 5,
  "include_transcript": true
}
```

**响应**：
```json
{
  "success": true,
  "summary": {
    "summary_id": "vsum_001",
    "video_id": "vid_abc",
    "key_frames": ["frame_001", "frame_002", "frame_003"],
    "transcript": "今天我们讨论...",
    "scenes": [
      {"start": 0.0, "end": 12.5, "description": "讲师介绍主题"}
    ],
    "summary_text": "本视频介绍..."
  }
}
```

---

## 四、性能与安全要求

### 4.1 性能要求
- 设计草图生成 < 1s
- NL 编辑应用 < 500ms
- 知识库检索 < 200ms（1000 条记录）
- 视频元数据提取 < 1s
- 视频摘要生成 < 3s

### 4.2 安全要求
- 路径白名单：仅允许指定目录
- 文件大小限制：视频 100MB、设计 1MB、知识 16KB
- 访问控制：按 owner/project_id 隔离
- 路径穿越防护
- 输入清洗（HTML/JS 注入防护）

### 4.3 可靠性要求
- 存储失败：事务回滚
- 索引持久化：JSONL + 内存缓存
- 孤儿文件清理
- 错误兜底：Mock 结果

---

## 五、验收标准

### 5.1 功能验收

**Design Mode**：
- ✅ 6 类模板（web/mobile/landing/components/poster/dashboard）
- ✅ 设计系统 CRUD
- ✅ NL 编辑（5+ 指令类型）
- ✅ 代码导出（HTML/React/Tailwind）

**Voice Chat**：
- ✅ 会话管理（创建/查询/删除）
- ✅ 项目上下文自动注入
- ✅ Web 搜索聚合
- ✅ 消息收发

**Global Memory**：
- ✅ 条目 CRUD
- ✅ 5 类类别管理
- ✅ 多标签检索
- ✅ 使用统计 + 衰减
- ✅ 状态生命周期

**Video**：
- ✅ 视频元数据
- ✅ 关键帧提取
- ✅ 视频摘要
- ✅ Mock 生成

### 5.2 测试覆盖
- 单元测试 ≥ 90 个用例
- E2E 测试 ≥ 60 个断言
- 测试通过率 100%

---

## 六、任务清单

### 后端实现
1. ✅ 创建 spec 文档
2. ⏳ 数据模型 models.py
3. ⏳ Design Mode 模块 design.py
4. ⏳ Voice Chat 模块 voice.py
5. ⏳ Global Memory 模块 memory.py
6. ⏳ Video 模块 video.py
7. ⏳ 统一管理器 manager.py
8. ⏳ REST API api.py
9. ⏳ 注册路由到 main.py

### 测试
10. ⏳ 单元测试 test_work_units.py（≥ 90 用例）
11. ⏳ E2E 测试 test_e2e_work.sh（≥ 60 断言）
12. ⏳ 运行测试，确保 100% 通过

### 前端实现
13. ⏳ API 客户端 useWorkApi.ts
14. ⏳ WorkPanel 组件（4 标签页）
15. ⏳ 独立页面 WorkPage.tsx
16. ⏳ 路由注册 + 菜单集成
17. ⏳ TypeScript 编译零错误

### 文档
18. ⏳ 更新代码修改日志
19. ⏳ 编写 CYCLE14_P1_3_SUMMARY.md

---

## 七、风险与限制

### 7.1 已知限制
- **Mock 实现**：STT/TTS/Web 搜索/视频生成均为 Mock
- **无真实模型**：使用规则引擎 + 启发式模拟
- **存储限制**：仅本地文件系统
- **NL 编辑**：仅支持预定义指令模式

### 7.2 风险评估
- **低风险**：所有处理本地化，无外部依赖
- **存储风险**：视频文件占用磁盘空间
- **性能风险**：大文件上传可能阻塞

---

## 八、参考

- **TRAE v0.1.18-v0.1.39**: TRAE Work 多模态协作
- **项目前序**: Cycle 14 P0-2 多模态基础 (Vision/Audio)
- **Cycle 13 P1-3**: Hermes Memory System (基础记忆)

---

**文档版本**: v1.0.0
**最后更新**: 2026-07-28
**负责人**: 全栈开发
