# CYCLE 36 G36-03 SPEC: Multi-Modal Processor

## 文档信息
- **版本**: v1.0.0
- **创建时间**: 2026-07-31
- **优先级**: P1
- **对标产品**: GPT-4o Vision / Claude Vision / Google Gemini Multimodal

---

## 一、目标

### 1.1 核心目标
为项目提供多模态处理能力，支持图像、语音、文件等多种输入类型的处理与融合。

### 1.2 支持模态
1. **图像**: 上传、预览、压缩、Base64 转换、OCR
2. **语音**: 录音、转录（Web Speech API）、波形可视化
3. **文件**: PDF/DOCX/Markdown/代码 解析
4. **融合**: 多模态联合理解

### 1.3 业务价值
- 支持现代 LLM 的多模态能力
- 提升用户体验（图像+文本联合输入）
- 扩展应用场景（OCR、语音助手、文档分析）

---

## 二、架构设计

### 2.1 核心抽象

```typescript
/**
 * 多模态处理器统一接口
 */
export interface MultiModalProcessor {
  // 图像
  processImage(file: File | Blob, options?: ImageOptions): Promise<ProcessedImage>;
  encodeImageBase64(file: File | Blob): Promise<string>;
  
  // 语音
  startRecording(options?: RecordingOptions): Promise<RecordingSession>;
  transcribeAudio(blob: Blob, options?: TranscriptionOptions): Promise<TranscriptionResult>;
  
  // 文件
  parseDocument(file: File, options?: ParseOptions): Promise<ParsedDocument>;
  
  // 融合
  fuseModalities(items: ModalityItem[]): Promise<FusedModality>;
}

export type ModalityType = 'text' | 'image' | 'audio' | 'file';
```

### 2.2 类型定义

```typescript
export interface ImageOptions {
  maxWidth?: number;        // 默认 1280
  maxHeight?: number;       // 默认 720
  quality?: number;         // 0-1, 默认 0.85
  format?: 'jpeg' | 'png' | 'webp';
  resize?: 'cover' | 'contain' | 'scale-down';
}

export interface ProcessedImage {
  id: string;
  original: {
    size: number;
    mimeType: string;
    width: number;
    height: number;
  };
  processed: {
    base64: string;
    dataUrl: string;
    size: number;
    width: number;
    height: number;
    format: string;
  };
  metadata: {
    uploadedAt: number;
    filename?: string;
    ocrText?: string;
    analysis?: string;
  };
}

export interface RecordingOptions {
  sampleRate?: number;      // 默认 16000
  channelCount?: number;    // 默认 1
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  maxDurationMs?: number;   // 默认 60000
  language?: string;        // 默认 'zh-CN'
}

export interface RecordingSession {
  id: string;
  start(): Promise<void>;
  stop(): Promise<Blob>;
  pause(): void;
  resume(): void;
  cancel(): void;
  onData(callback: (chunk: AudioChunk) => void): Unsubscribe;
  getDurationMs(): number;
  getLevel(): number;  // 0-1
}

export interface AudioChunk {
  timestamp: number;
  durationMs: number;
  level: number;     // 0-1
  isSpeech: boolean;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  durationMs: number;
  confidence: number;
}

export interface TranscriptionSegment {
  text: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

export interface ParseOptions {
  extractImages?: boolean;
  ocrEnabled?: boolean;
  maxPages?: number;
  preserveFormatting?: boolean;
}

export interface ParsedDocument {
  id: string;
  type: 'pdf' | 'docx' | 'md' | 'txt' | 'code';
  filename: string;
  size: number;
  pages?: ParsedPage[];
  content: string;
  metadata: Record<string, unknown>;
  images?: ProcessedImage[];
  language?: string;
}

export interface ParsedPage {
  index: number;
  text: string;
  images?: ProcessedImage[];
}

export interface ModalityItem {
  type: ModalityType;
  content: string | ProcessedImage | Blob | ParsedDocument;
  metadata?: Record<string, unknown>;
}

export interface FusedModality {
  id: string;
  type: 'multimodal';
  items: ModalityItem[];
  combined: {
    text: string;
    images: ProcessedImage[];
    audio?: TranscriptionResult;
    files: ParsedDocument[];
  };
  metadata: Record<string, unknown>;
}
```

---

## 三、模块设计

### 3.1 图像处理模块
- **缩放**: Canvas API
- **压缩**: Canvas quality
- **Base64 编码**: FileReader API
- **OCR**: Tesseract.js（可选，未来扩展）
- **预览**: ObjectURL

### 3.2 语音处理模块
- **录音**: MediaRecorder API
- **实时转录**: Web Speech API（SpeechRecognition）
- **波形可视化**: Web Audio API + Canvas
- **音频播放**: Audio API
- **格式转换**: WAV / MP3 / OGG

### 3.3 文件处理模块
- **PDF**: pdf.js
- **DOCX**: mammoth.js
- **Markdown**: marked
- **代码**: Monaco Editor tokenizer
- **纯文本**: 原生 FileReader

### 3.4 融合模块
- **联合编码**: 转 LLM multimodal format
- **Token 估算**: 多模态总 Token
- **优先级**: 不同模态权重

---

## 四、核心 API

### 4.1 图像处理

```typescript
const processor = getDefaultMultiModalProcessor();

// 上传并处理图像
const file = event.target.files[0];
const processed = await processor.processImage(file, {
  maxWidth: 1024,
  quality: 0.85,
  format: 'jpeg',
});
console.log(processed.processed.dataUrl);
console.log('Original:', processed.original.size);
console.log('Processed:', processed.processed.size);
```

### 4.2 语音录制

```typescript
const session = await processor.startRecording({
  language: 'zh-CN',
  maxDurationMs: 60000,
});

session.onData((chunk) => {
  console.log(`Level: ${chunk.level}, IsSpeech: ${chunk.isSpeech}`);
});

// 停止并获取转录
const blob = await session.stop();
const result = await processor.transcribeAudio(blob);
console.log(result.text);
```

### 4.3 文件解析

```typescript
// PDF
const pdf = await processor.parseDocument(pdfFile, {
  extractImages: true,
  ocrEnabled: false,
  maxPages: 10,
});

// Markdown
const md = await processor.parseDocument(mdFile);

// 代码
const code = await processor.parseDocument(codeFile);
```

### 4.4 多模态融合

```typescript
const fused = await processor.fuseModalities([
  { type: 'text', content: 'What is in this image?' },
  { type: 'image', content: processedImage },
  { type: 'audio', content: transcriptionResult },
  { type: 'file', content: parsedDoc },
]);

// 转 LLM 多模态消息
const messages: Message[] = [
  { role: 'user', content: fused.combined as MultimodalContent[] },
];
```

---

## 五、UI 组件

### 5.1 图像上传组件
```typescript
<ImageUploader
  onUpload={(processed) => setImage(processed)}
  onRemove={() => setImage(null)}
  maxSize={10 * 1024 * 1024}  // 10MB
  accept={['image/jpeg', 'image/png', 'image/webp']}
  enableCompression
  maxWidth={1024}
/>
```

### 5.2 语音录制组件
```typescript
<VoiceRecorder
  onTranscribe={(result) => setText(result.text)}
  language="zh-CN"
  maxDurationMs={60000}
  showWaveform
  enableRealtime
/>
```

### 5.3 文件上传组件
```typescript
<FileUploader
  onParse={(doc) => setDoc(doc)}
  accept={['.pdf', '.docx', '.md', '.txt', '.ts', '.tsx', '.py']}
  maxSize={50 * 1024 * 1024}  // 50MB
  enablePreview
  showMetadata
/>
```

### 5.4 多模态融合组件
```typescript
<MultiModalComposer
  modalities={['text', 'image', 'audio', 'file']}
  onFuse={(fused) => sendToLLM(fused)}
  maxItems={10}
/>
```

---

## 六、存储管理

### 6.1 多模态项目存储
```typescript
class ModalityStorage {
  addImage(item: ProcessedImage): string;  // 返回 ID
  addAudio(item: TranscriptionResult): string;
  addFile(item: ParsedDocument): string;
  getItem(id: string): ModalityItem | undefined;
  listItems(): ModalityItem[];
  removeItem(id: string): boolean;
  clear(): void;
  
  // 持久化
  save(): void;
  load(): void;
}
```

### 6.2 存储策略
- **localStorage**: 元数据（轻量）
- **IndexedDB**: 二进制数据（图像/音频/文件）

---

## 七、错误处理

### 7.1 错误类型

| 错误 | 场景 | 处理 |
|------|------|------|
| `file_too_large` | 文件超过限制 | 提示并拒绝 |
| `unsupported_format` | 格式不支持 | 提示并列出支持格式 |
| `parse_failed` | 解析失败 | 降级为纯文本 |
| `recording_failed` | 录音失败 | 检查麦克风权限 |
| `transcription_failed` | 转录失败 | 降级或重试 |
| `quota_exceeded` | 存储空间不足 | 清理或提示 |

### 7.2 降级策略
- 浏览器不支持 Web Speech → 仅录音，不转录
- 浏览器不支持 MediaRecorder → 提示上传音频
- PDF 解析失败 → 显示纯文本
- 图像处理失败 → 显示原始

---

## 八、性能优化

### 8.1 性能指标
- 图像压缩: < 500ms (10MB JPEG)
- 语音转录实时: < 1s 延迟
- 文件解析: < 2s (10MB PDF)

### 8.2 优化策略
- **Worker 线程**: 大文件解析在 Worker 中
- **流式解析**: 大 PDF 逐页解析
- **缓存**: 相同文件复用结果
- **预加载**: 常用解析库预加载

---

## 九、测试策略

### 9.1 单元测试
- 图像缩放/压缩
- Base64 编码
- 文件类型检测
- Markdown 解析
- 错误处理

### 9.2 集成测试
- 真实文件上传与解析
- 真实录音与转录（happy-dom 限制）
- 多模态融合

### 9.3 E2E 测试
- UI 上传流程
- 录音 → 转录 → 发送 LLM

---

## 十、API 接口清单

### 10.1 导出类
```typescript
export class MultiModalProcessorImpl implements MultiModalProcessor { ... }
export class ModalityStorage { ... }
export class ImageProcessor { ... }
export class AudioProcessor { ... }
export class FileProcessor { ... }
export class FusionEngine { ... }
```

### 10.2 工具函数
```typescript
export function detectFileType(file: File): ModalityType;
export function resizeImage(canvas: HTMLCanvasElement, options: ImageOptions): Promise<Blob>;
export function blobToBase64(blob: Blob): Promise<string>;
export function formatBytes(bytes: number): string;
export function estimateTokens(items: ModalityItem[]): number;
```

---

## 十一、交付清单

### 11.1 代码文件
- `frontend/src/utils/multiModalProcessor.ts` (~600 行)
- `frontend/src/utils/multiModalProcessor.test.ts` (~400 行)
- `frontend/src/utils/imageProcessor.ts` (~300 行)
- `frontend/src/utils/imageProcessor.test.ts` (~200 行)
- `frontend/src/utils/audioProcessor.ts` (~400 行)
- `frontend/src/utils/audioProcessor.test.ts` (~300 行)
- `frontend/src/utils/fileProcessor.ts` (~400 行)
- `frontend/src/utils/fileProcessor.test.ts` (~300 行)
- `frontend/src/utils/fusionEngine.ts` (~300 行)
- `frontend/src/utils/fusionEngine.test.ts` (~200 行)
- `frontend/src/utils/modalityStorage.ts` (~200 行)
- `frontend/src/utils/modalityStorage.test.ts` (~200 行)

### 11.2 UI 文件
- `frontend/src/components/MultiModalPanel.tsx` (~500 行)
- `frontend/src/components/MultiModalPanel.test.tsx` (~300 行)
- `frontend/src/components/ImageUploader.tsx` (~300 行)
- `frontend/src/components/VoiceRecorder.tsx` (~400 行)
- `frontend/src/components/FileUploader.tsx` (~300 行)
- `frontend/src/components/MultiModalComposer.tsx` (~400 行)

### 11.3 集成文件
- `frontend/src/App.tsx` (修改)
- `frontend/src/components/AppLayout.tsx` (修改)
- `frontend/src/components/BrandHeader.tsx` (修改)

---

## 十二、依赖

### 12.1 新增依赖
```json
{
  "pdfjs-dist": "^4.0.0",
  "mammoth": "^1.8.0"
}
```

### 12.2 浏览器内置 API
- Canvas API（图像处理）
- MediaRecorder API（录音）
- Web Speech API（语音转录）
- FileReader API（文件读取）
- Web Audio API（音频分析）

---

## 十三、版本与变更

- **v1.0.0**: 初始版本（Cycle 36 G36-03）

### 变更记录
- 2026-07-31 | v1.0.0 | Cycle 36 G36-03 初始创建
