# Cycle 14 P0-2: 多模态支持 (Vision/Audio) 设计与实现

> **Cycle**: 14  
> **优先级**: P0-2  
> **类型**: 后端核心模块 + 前端 UI  
> **状态**: 🚧 开发中  
> **版本**: v6.27.0  
> **开始时间**: 2026-07-28

---

## 一、需求描述

### 1.1 业务背景

参考 **Codex v0.145.0+** 和 **TRAE v0.1.39** 的多模态协作能力，本任务为 Hermes 智能体调度平台引入完整的多模态支持。当前项目仅支持纯文本消息，无法处理以下场景：

- 截图分析（Bug 报告、设计稿、UI 反馈）
- 文档图像 OCR（合同、表格、手写笔记）
- 语音消息转写（会议记录、语音指令）
- 音频文件分析（Podcast、音效识别）
- 多模态混合对话（图片+文本、语音+文本）

### 1.2 核心目标

- ✅ 图像上传、压缩、缩略图生成、Vision 分析
- ✅ 音频上传、转写、波形可视化、元数据提取
- ✅ 多模态会话管理（文本+图像+音频混合）
- ✅ 媒体文件安全存储（路径白名单、格式校验、大小限制）
- ✅ 多模态 API（Vision/Audio/Chat/Vision-with-Audio）
- ✅ 前端上传组件 + 多模态消息展示

### 1.3 用户场景

| 场景 | 描述 | 输入 | 输出 |
| --- | --- | --- | --- |
| 截图分析 | 用户上传 Bug 截图 | PNG/JPG | OCR 文本 + UI 元素描述 |
| 文档识别 | 用户上传合同/表格 | PDF/图片 | 结构化文本 + 字段提取 |
| 语音消息 | 用户发送语音 | WAV/MP3 | 转写文本 + 情感分析 |
| 多模态对话 | 用户发送图文 | 图片+文本 | 综合理解结果 |

---

## 二、技术实现方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Multimodal Layer                          │
├─────────────────────────────────────────────────────────────┤
│  Vision Module  │  Audio Module  │  Chat Module              │
│  - Image Upload │  - Audio Upload│  - Multimodal Messages    │
│  - OCR          │  - Transcribe  │  - Context Fusion         │
│  - UI Analysis  │  - Waveform    │  - Response Generation    │
│  - Embedding    │  - Sentiment   │  - Citation Tracking      │
├─────────────────────────────────────────────────────────────┤
│              Media Manager (Storage + Security)              │
│  - Path Whitelist │ Format Validation │ Size Limits          │
│  - Thumbnail Gen  │  Metadata Extract │ Cleanup              │
├─────────────────────────────────────────────────────────────┤
│              Storage Layer (File System + JSON Index)         │
│  /tmp/hermes_multimodal/  │  media_index.jsonl                │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心模块

#### 2.2.1 数据模型 (models.py)

```python
@dataclass
class MediaItem:
    media_id: str
    type: MediaType  # image | audio | video | document
    mime_type: str
    file_path: str
    file_size: int
    width: Optional[int]
    height: Optional[int]
    duration: Optional[float]  # seconds (audio/video)
    checksum: str
    thumbnail_path: Optional[str]
    metadata: Dict[str, Any]
    uploaded_at: str
    uploaded_by: str

@dataclass
class VisionAnalysis:
    analysis_id: str
    media_id: str
    description: str
    detected_objects: List[Dict[str, Any]]
    ocr_text: Optional[str]
    ui_elements: List[Dict[str, Any]]
    confidence: float
    model: str
    created_at: str

@dataclass
class AudioAnalysis:
    analysis_id: str
    media_id: str
    transcript: str
    language: str
    sentiment: str
    duration: float
    key_segments: List[Dict[str, Any]]
    confidence: float
    model: str
    created_at: str

@dataclass
class MultimodalMessage:
    message_id: str
    session_id: str
    role: str  # user | assistant
    text_content: Optional[str]
    media_items: List[str]  # media_ids
    metadata: Dict[str, Any]
    created_at: str
```

#### 2.2.2 Vision 模块 (vision.py)

- **图像处理**: 压缩、缩放、格式转换、缩略图生成
- **OCR 引擎**: Mock（基于 PIL + tesseract fallback），支持中英文
- **UI 元素检测**: 按钮/输入框/列表/图标识别
- **图像描述**: 整体描述、场景识别、对象检测
- **Embedding**: 简化版（特征哈希 + 颜色直方图）

**核心算法**：
- 图像哈希：dHash（difference hash）
- OCR：可调用外部 mock（不依赖实际模型）
- 颜色直方图：RGB 三通道 8x8 直方图

#### 2.2.3 Audio 模块 (audio.py)

- **音频处理**: 格式验证、元数据提取、波形生成
- **转写引擎**: Mock（基于规则 + 简单启发式）
- **情感分析**: Mock（基于文本特征）
- **关键片段识别**: 静音检测 + 能量分析
- **多语言检测**: 启发式 + Mock 语种识别

**核心算法**：
- 波形生成：下采样到 100 个采样点
- 静音检测：RMS 能量阈值
- 语速估算：基于 mock 转写长度

#### 2.2.4 媒体管理器 (manager.py)

- **存储管理**: 路径白名单、文件名校验、清理策略
- **索引管理**: JSONL 索引文件 + 内存缓存
- **会话关联**: 多模态消息与 Session 绑定
- **统计信息**: 总数、按类型分布、最近上传
- **单例模式**: 全局访问

#### 2.2.5 API 端点 (api.py)

- `GET /api/multimodal/health` - 健康检查
- `GET /api/multimodal/stats` - 统计信息
- `POST /api/multimodal/upload/image` - 上传图像（multipart）
- `POST /api/multimodal/upload/audio` - 上传音频（multipart）
- `GET /api/multimodal/media/{media_id}` - 获取媒体详情
- `GET /api/multimodal/media/{media_id}/thumbnail` - 获取缩略图
- `GET /api/multimodal/media` - 列出媒体（按类型/会话过滤）
- `DELETE /api/multimodal/media/{media_id}` - 删除媒体
- `POST /api/multimodal/vision/analyze` - Vision 分析
- `GET /api/multimodal/vision/analyses` - 列出分析结果
- `GET /api/multimodal/audio/analyze` - Audio 分析
- `GET /api/multimodal/audio/analyses` - 列出音频分析
- `POST /api/multimodal/chat/send` - 发送多模态消息
- `GET /api/multimodal/chat/messages/{session_id}` - 列出会话消息
- `POST /api/multimodal/chat/messages/{message_id}/respond` - 生成回复

### 2.3 安全设计

#### 路径白名单
- 仅允许在 `HERMES_MULTIMODAL_DIR` 环境变量指定目录下存储
- 默认：`/tmp/hermes_multimodal/`
- 禁止 `..`、符号链接、相对路径穿越

#### 格式校验
- 图像：`image/png`, `image/jpeg`, `image/gif`, `image/webp`
- 音频：`audio/mpeg`, `audio/wav`, `audio/ogg`, `audio/webm`
- 大小限制：图像 10MB，音频 50MB
- 校验和：SHA-256

#### 访问控制
- 上传时 `uploaded_by` 必填
- 删除时校验所有权
- 列出时按 `uploaded_by` 过滤

---

## 三、接口设计规范

### 3.1 上传图像

**请求**：
```http
POST /api/multimodal/upload/image
Content-Type: multipart/form-data

file=@screenshot.png
uploaded_by=user_123
session_id=optional_session_id
```

**响应**：
```json
{
  "success": true,
  "media": {
    "media_id": "med_abc123",
    "type": "image",
    "mime_type": "image/png",
    "file_size": 245678,
    "width": 1920,
    "height": 1080,
    "thumbnail_path": "/tmp/hermes_multimodal/thumbnails/med_abc123.png",
    "checksum": "sha256:...",
    "uploaded_at": "2026-07-28T18:30:00Z"
  }
}
```

### 3.2 Vision 分析

**请求**：
```json
POST /api/multimodal/vision/analyze
{
  "media_id": "med_abc123",
  "analysis_type": "full"  // full | ocr | objects | ui
}
```

**响应**：
```json
{
  "success": true,
  "analysis": {
    "analysis_id": "vis_xyz789",
    "media_id": "med_abc123",
    "description": "A screenshot showing a login form with email and password fields",
    "detected_objects": [
      {"label": "button", "confidence": 0.95, "bbox": [100, 200, 150, 230]},
      {"label": "input", "confidence": 0.92, "bbox": [100, 150, 300, 180]}
    ],
    "ocr_text": "Login\nEmail\nPassword\nSign In",
    "ui_elements": [
      {"type": "input", "label": "Email", "value": ""},
      {"type": "input", "label": "Password", "value": ""},
      {"type": "button", "label": "Sign In"}
    ],
    "confidence": 0.88,
    "model": "mock-vision-v1"
  }
}
```

### 3.3 音频转写

**请求**：
```json
POST /api/multimodal/audio/analyze
{
  "media_id": "med_audio_456",
  "language_hint": "zh-CN"  // optional
}
```

**响应**：
```json
{
  "success": true,
  "analysis": {
    "analysis_id": "aud_def789",
    "media_id": "med_audio_456",
    "transcript": "今天我们来讨论一下项目的进度",
    "language": "zh-CN",
    "sentiment": "neutral",
    "duration": 12.5,
    "key_segments": [
      {"start": 0.0, "end": 3.2, "text": "今天我们来", "energy": 0.6},
      {"start": 3.2, "end": 7.8, "text": "讨论一下", "energy": 0.5},
      {"start": 7.8, "end": 12.5, "text": "项目的进度", "energy": 0.7}
    ],
    "confidence": 0.85,
    "model": "mock-audio-v1"
  }
}
```

### 3.4 多模态消息

**请求**：
```json
POST /api/multimodal/chat/send
{
  "session_id": "sess_123",
  "text": "请分析这张截图",
  "media_ids": ["med_abc123"],
  "uploaded_by": "user_123"
}
```

**响应**：
```json
{
  "success": true,
  "message": {
    "message_id": "msg_aaa",
    "session_id": "sess_123",
    "role": "user",
    "text_content": "请分析这张截图",
    "media_items": ["med_abc123"],
    "created_at": "2026-07-28T18:30:00Z"
  }
}
```

---

## 四、性能与安全要求

### 4.1 性能要求
- 图像上传 + 缩略图生成 < 2s（10MB 图像）
- Vision 分析（OCR + UI 检测）< 5s
- 音频转写 < 10s（60s 音频）
- 列表查询 < 100ms（1000 条记录）

### 4.2 安全要求
- 路径白名单：仅允许指定目录
- 文件名清洗：禁止 `..`、特殊字符
- 格式校验：MIME 类型 + magic bytes 双重校验
- 大小限制：图像 10MB，音频 50MB
- 校验和：SHA-256 去重
- 访问控制：按 `uploaded_by` 过滤

### 4.3 可靠性要求
- 上传失败：事务回滚
- 分析失败：返回 Mock 结果（不阻塞）
- 存储清理：自动清理孤儿文件
- 索引持久化：JSONL + 内存缓存

---

## 五、验收标准

### 5.1 功能验收
- ✅ 图像上传、压缩、缩略图生成
- ✅ 图像 Vision 分析（OCR + UI 检测 + 对象识别）
- ✅ 音频上传、元数据提取、波形生成
- ✅ 音频转写、情感分析、片段识别
- ✅ 多模态消息发送与历史查询
- ✅ 媒体删除（级联清理）
- ✅ 统计信息（按类型分布、最近上传）
- ✅ 健康检查

### 5.2 性能验收
- ✅ 图像上传 < 2s
- ✅ Vision 分析 < 5s
- ✅ 列表查询 < 100ms

### 5.3 安全验收
- ✅ 路径穿越测试通过
- ✅ 文件大小超限测试通过
- ✅ 文件格式错误测试通过
- ✅ 跨用户访问测试通过

### 5.4 测试覆盖
- 单元测试 ≥ 60 个，覆盖所有数据模型与核心逻辑
- E2E 测试 ≥ 30 个断言，覆盖所有 API 端点
- 测试通过率 100%

---

## 六、任务清单

### 后端实现
1. ✅ 创建 spec 文档
2. ⏳ 数据模型 models.py
3. ⏳ Vision 模块 vision.py
4. ⏳ Audio 模块 audio.py
5. ⏳ 媒体管理器 manager.py
6. ⏳ REST API api.py
7. ⏳ 注册路由到 main.py

### 测试
8. ⏳ 单元测试 test_multimodal_units.py（≥ 60 用例）
9. ⏳ E2E 测试 test_e2e_multimodal.sh（≥ 30 断言）
10. ⏳ 运行测试，确保 100% 通过

### 前端实现
11. ⏳ API 客户端 useMultimodalApi.ts
12. ⏳ 多模态面板 MultimodalPanel.tsx
13. ⏳ 独立页面 MultimodalPage.tsx
14. ⏳ 路由注册 + 菜单集成
15. ⏳ TypeScript 编译零错误

### 文档
16. ⏳ 更新代码修改日志
17. ⏳ 编写 CYCLE14_P0_2_SUMMARY.md

---

## 七、风险与限制

### 7.1 已知限制
- **Mock 实现**：OCR、转写、Vision 模型均为 Mock，不依赖外部 API
- **无真实模型**：使用规则引擎 + 启发式模拟 AI 行为
- **存储限制**：仅本地文件系统，不支持云存储
- **格式限制**：不支持视频、PDF（仅图像 + 音频）

### 7.2 风险评估
- **低风险**：所有处理本地化，无外部依赖
- **存储风险**：媒体文件占用磁盘空间，需定期清理
- **性能风险**：大文件上传可能阻塞，需异步处理

---

## 八、参考

- **Codex v0.145.0+**: Vision 工具调用、图像理解
- **TRAE v0.1.39**: 多模态协作、语音消息
- **项目前序**: Cycle 14 P0-1 Agent v2（自进化智能体）

---

**文档版本**: v1.0.0  
**最后更新**: 2026-07-28  
**负责人**: 全栈开发
