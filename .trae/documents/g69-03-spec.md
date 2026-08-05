# G69-03 VoiceInput + MultimodalInput 语音与多模态输入 - Spec 文档

**Cycle**: 69
**优先级**: P0
**对标**: Trae SOLO Multimodal Interaction + Web Speech API
**作者**: 总架构师
**生成时间**: 2026-08-05

---

## 1. 功能需求描述

### 1.1 目标
为 Solo 模式提供现代化多模态输入能力：
- **语音输入（ASR）**: 浏览器端 Web Speech API 实时转文字
- **图片上传**: 文件选择 + base64 编码
- **截图工具**: 页面/区域截图 + 标注
- **多模态 LLM**: 文本 + 图片组合调用 GPT-4o / Claude 3.5

### 1.2 用户场景
- **场景 1**: 移动端用户语音描述需求
- **场景 2**: 设计师上传 mockup → 生成代码
- **场景 3**: 用户截取错误页面 → AI 调试
- **场景 4**: 用户上传产品截图 → AI 解释功能

### 1.3 使用流程
```
1. 用户点击麦克风按钮
2. 浏览器请求麦克风权限
3. Web Speech API 开始识别
4. 实时显示识别结果（interim + final）
5. 用户点击发送
6. 文本作为 user message 发送
```

图片流程：
```
1. 用户拖拽/选择/截图图片
2. 前端压缩（< 1MB）+ base64 编码
3. 发送到后端（multimodal chat API）
4. 后端调用多模态 LLM
5. 返回文本响应
```

---

## 2. 技术实现方案

### 2.1 架构设计
```
┌──────────────────────────────────────────────┐
│          ChatInput 组件增强                    │
│  - VoiceInput: 麦克风按钮 + ASR               │
│  - ImageUpload: 拖拽 + 选择                    │
│  - ScreenshotTool: html2canvas 截屏           │
└──────────────────┬───────────────────────────┘
                   │ send(messages)
                   ▼
┌──────────────────────────────────────────────┐
│       MultimodalChatService (后端)            │
│  - 接收 text + image_url[]                    │
│  - 构建多模态 messages                        │
│  - 调用 LLM（GPT-4o / Claude 3.5）            │
│  - 流式返回响应                                │
└──────────────────────────────────────────────┘
```

### 2.2 核心数据结构
```python
@dataclass
class MultimodalMessage:
    role: str  # user | assistant | system
    content: List[ContentPart]

@dataclass
class TextContent:
    type: str = "text"
    text: str

@dataclass
class ImageContent:
    type: str = "image_url"
    image_url: ImageUrl

@dataclass
class ImageUrl:
    url: str          # data:image/png;base64,...
    detail: str = "auto"  # low | high | auto

@dataclass
class VoiceTranscript:
    text: str
    is_final: bool
    confidence: float
    language: str  # zh-CN, en-US
    timestamp: str
```

### 2.3 核心算法

#### 2.3.1 Web Speech API 集成（前端）
```typescript
class VoiceInputService {
  private recognition: SpeechRecognition;
  
  start(language: string = 'zh-CN'): void {
    this.recognition = new webkitSpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = language;
    
    this.recognition.onresult = (event) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }
      this.callback({ final, interim });
    };
    
    this.recognition.start();
  }
  
  stop(): void {
    this.recognition?.stop();
  }
}
```

#### 2.3.2 图片压缩
```typescript
async function compressImage(file: File, maxSizeMB: number = 1): Promise<string> {
  const img = await loadImage(file);
  const canvas = document.createElement('canvas');
  const maxDim = 2048;
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const ratio = Math.min(maxDim / width, maxDim / height);
    width *= ratio;
    height *= ratio;
  }
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0, width, height);
  
  let quality = 0.9;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);
  while (estimateSizeMB(dataUrl) > maxSizeMB && quality > 0.5) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }
  return dataUrl;
}
```

#### 2.3.3 多模态 LLM 调用（后端）
```python
async def call_multimodal_llm(
    messages: List[MultimodalMessage],
    model: str = "gpt-4o"
) -> AsyncIterator[str]:
    # 转换为本项目格式
    openai_messages = []
    for msg in messages:
        openai_messages.append({
            "role": msg.role,
            "content": [
                {"type": part.type, part.type.split("_")[0]: getattr(part, part.type.split("_")[0])}
                for part in msg.content
            ]
        })
    
    # 流式调用
    stream = await openai_client.chat.completions.create(
        model=model,
        messages=openai_messages,
        stream=True,
    )
    async for chunk in stream:
        if chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
```

---

## 3. 接口设计规范

### 3.1 前端 Hooks
```typescript
// useVoiceInput.ts
function useVoiceInput(options: VoiceInputOptions): {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  start: () => void;
  stop: () => void;
  reset: () => void;
  error: string | null;
}

// useImageUpload.ts
function useImageUpload(options: ImageUploadOptions): {
  upload: (file: File) => Promise<string>;  // 返回 base64 dataURL
  validate: (file: File) => ValidationResult;
  isUploading: boolean;
}

// useScreenshot.ts
function useScreenshot(options: ScreenshotOptions): {
  capture: () => Promise<string>;
  captureRegion: (x: number, y: number, w: number, h: number) => Promise<string>;
  isCapturing: boolean;
}
```

### 3.2 后端 REST API
```
POST /api/multimodal/chat           多模态对话（流式）
POST /api/multimodal/upload         上传图片（返回 URL）
POST /api/multimodal/screenshot     上传截图（带 base64）
GET  /api/multimodal/models         列出支持多模态的模型
POST /api/multimodal/vision/analyze 图片分析（OCR/描述）
```

### 3.3 请求/响应模型
```python
class MultimodalChatRequest(BaseModel):
    messages: List[Dict[str, Any]]  # OpenAI 格式
    model: str = "gpt-4o"
    stream: bool = True
    max_tokens: int = 4096
    temperature: float = 0.7

class MultimodalUploadResponse(BaseModel):
    url: str             # 服务器 URL
    size_bytes: int
    width: int
    height: int
    format: str          # png | jpeg | webp

class VisionAnalyzeRequest(BaseModel):
    image_url: str       # base64 dataURL 或 HTTP URL
    prompt: str = "请详细描述这张图片"
    model: str = "gpt-4o"

class VisionAnalyzeResponse(BaseModel):
    description: str
    confidence: float
    model_used: str
    tokens_used: int
```

### 3.4 错误码
| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误（图片格式不支持、超过大小限制） |
| 413 | 图片超过 10MB |
| 415 | MIME 类型不支持 |
| 429 | API 限流 |
| 500 | LLM 调用失败 |

---

## 4. 数据结构定义

### 4.1 支持的图片格式
```python
SUPPORTED_IMAGE_FORMATS = {
    "image/png": {"max_size_mb": 10, "compress_target_mb": 1},
    "image/jpeg": {"max_size_mb": 10, "compress_target_mb": 1},
    "image/webp": {"max_size_mb": 10, "compress_target_mb": 1},
    "image/gif": {"max_size_mb": 5, "compress_target_mb": 0.5},
}
```

### 4.2 支持的语音语言
```typescript
const SUPPORTED_LANGUAGES = {
  'zh-CN': '中文（普通话）',
  'zh-HK': '中文（粤语）',
  'en-US': 'English (US)',
  'en-GB': 'English (UK)',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
  'es-ES': 'Español',
  'fr-FR': 'Français',
  'de-DE': 'Deutsch',
};
```

### 4.3 多模态消息示例
```json
{
  "messages": [
    {
      "role": "user",
      "content": [
        {"type": "text", "text": "请根据这个设计稿生成 HTML 代码"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,...", "detail": "high"}}
      ]
    }
  ],
  "model": "gpt-4o",
  "stream": true
}
```

---

## 5. 性能与安全要求

### 5.1 性能
- 语音识别延迟: < 500ms
- 图片压缩（5MB → 1MB）: < 1s
- 多模态 LLM 首次响应: < 3s
- 流式响应：token-by-token，50ms 间隔

### 5.2 安全
- 麦克风权限：用户显式授权
- 图片大小：限制 10MB（压缩到 1MB）
- MIME 校验：只接受白名单格式
- 隐私：图片不上传到第三方 CDN
- 审计：所有多模态消息记录到 rollout JSONL

### 5.3 用户体验
- ASR 实时显示（interim + final）
- 图片拖拽支持（drag-drop）
- 截图支持区域选择
- 多模态消息显示图片缩略图
- 失败时降级到纯文本

---

## 6. 验收标准

### 6.1 功能验证（脚本自动测试）
| 测试项 | 标准 |
|--------|------|
| 语音识别启动 | ✅ 浏览器支持时正常 |
| 语音识别停止 | ✅ 立即停止 |
| 图片上传 | ✅ base64 编码正确 |
| 图片压缩 | ✅ 5MB → < 1MB |
| 截图捕获 | ✅ 页面渲染正确 |
| 多模态 API | ✅ 返回流式响应 |
| 降级处理 | ✅ 不支持时回退 |

### 6.2 测试项目（自动化）
1. `test_voice_input_hook.ts` - useVoiceInput Hook 测试（8 个）
2. `test_image_upload_hook.ts` - useImageUpload Hook 测试（6 个）
3. `test_screenshot_hook.ts` - useScreenshot Hook 测试（4 个）
4. `test_multimodal_chat_api.py` - 后端 API 测试（10 个）
5. `test_chat_input_enhanced.tsx` - 增强 ChatInput 组件测试（5 个）
6. **合计**: 33 个新测试，全部通过

### 6.3 测试项目（前端 Web 测试）
- [ ] 麦克风按钮交互
- [ ] 语音识别实时显示
- [ ] 图片拖拽上传
- [ ] 截图捕获按钮
- [ ] 多模态消息发送
- [ ] 图片缩略图预览
- [ ] 失败降级提示

### 6.4 通过条件
- 所有自动化测试 100% 通过
- 浏览器兼容性（Chrome 90+, Edge 90+, Safari 14+）
- 文档完整
- 在真实浏览器中手动验证语音/截图功能
