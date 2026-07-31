/**
 * # ============================================================
 * # Multi-Modal Processor - 多模态处理器 (v1.0.0 Cycle 36 G36-03)
 * # ============================================================
 * # 核心作用：处理图像、语音、文件等多种模态的输入
 * #           提供统一的 API 用于上传、解析、融合
 * #           支持现代 LLM 的多模态能力
 * # 对标产品：GPT-4o Vision / Claude Vision
 * # 运行流程：
 * #   1. processImage(file) - 处理图像（缩放/压缩/base64）
 * #   2. startRecording() - 启动录音会话
 * #   3. transcribeAudio(blob) - 语音转录
 * #   4. parseDocument(file) - 文件解析
 * #   5. fuseModalities(items) - 多模态融合
 * # 输入参数：File / Blob / File / ModalityItem[]
 * # 输出结果：ProcessedImage / RecordingSession / TranscriptionResult / ParsedDocument / FusedModality
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 36 G36-03 初次创建
 * # ============================================================
 */

// ============ 类型定义 ============

export type ModalityType = 'text' | 'image' | 'audio' | 'file';

export interface ImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
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
  sampleRate?: number;
  channelCount?: number;
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  maxDurationMs?: number;
  language?: string;
}

export interface AudioChunk {
  timestamp: number;
  durationMs: number;
  level: number;
  isSpeech: boolean;
}

export interface RecordingSession {
  id: string;
  start(): Promise<void>;
  stop(): Promise<Blob>;
  pause(): void;
  resume(): void;
  cancel(): void;
  onData(callback: (chunk: AudioChunk) => void): () => void;
  onLevel(callback: (level: number) => void): () => void;
  getDurationMs(): number;
  getLevel(): number;
  isRecording(): boolean;
  isPaused(): boolean;
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

export interface ParsedPage {
  index: number;
  text: string;
}

export interface ParsedDocument {
  id: string;
  type: 'pdf' | 'docx' | 'md' | 'txt' | 'code' | 'unknown';
  filename: string;
  size: number;
  pages?: ParsedPage[];
  content: string;
  metadata: Record<string, unknown>;
  language?: string;
}

export interface ModalityItem {
  id: string;
  type: ModalityType;
  content: string | ProcessedImage | TranscriptionResult | ParsedDocument;
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

// ============ 工具函数 ============

export function generateModalityId(prefix: string = 'mod'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function detectFileType(file: { name: string; type: string }): ModalityType {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('video/')) return 'audio';
  const textTypes = [
    'text/plain',
    'text/markdown',
    'text/html',
    'text/csv',
    'application/json',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ];
  if (textTypes.includes(file.type)) return 'file';
  const textExtensions = ['.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.sh', '.yaml', '.yml', '.xml', '.html'];
  if (textExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))) return 'file';
  if (file.name.toLowerCase().endsWith('.pdf')) return 'file';
  if (file.name.toLowerCase().endsWith('.docx') || file.name.toLowerCase().endsWith('.doc')) return 'file';
  return 'text';
}

export function detectDocumentType(file: { name: string; type: string }): 'pdf' | 'docx' | 'md' | 'txt' | 'code' | 'unknown' {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx') || name.endsWith('.doc')) return 'docx';
  if (name.endsWith('.md') || name.endsWith('.markdown')) return 'md';
  if (name.endsWith('.txt')) return 'txt';
  const codeExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.java', '.cpp', '.c', '.h', '.go', '.rs', '.sh', '.yaml', '.yml', '.json', '.xml', '.html', '.css'];
  for (const ext of codeExts) {
    if (name.endsWith(ext)) return 'code';
  }
  return 'unknown';
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去掉 data:*/*;base64, 前缀
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read blob'));
    reader.readAsDataURL(blob);
  });
}

export function estimateModalityTokens(items: ModalityItem[]): number {
  let total = 0;
  for (const item of items) {
    if (item.type === 'text' && typeof item.content === 'string') {
      total += Math.ceil(item.content.length / 4);
    } else if (item.type === 'image') {
      total += 1000; // 图像约 1000 tokens（简化）
    } else if (item.type === 'audio') {
      const result = item.content as TranscriptionResult;
      total += Math.ceil(result.text.length / 4);
    } else if (item.type === 'file') {
      const doc = item.content as ParsedDocument;
      total += Math.ceil(doc.content.length / 4);
    }
  }
  return total;
}

// ============ 图像处理 ============

export class ImageProcessor {
  async processImage(file: File | Blob, options: ImageOptions = {}): Promise<ProcessedImage> {
    const { maxWidth = 1280, maxHeight = 720, quality = 0.85, format = 'jpeg' } = options;

    const bitmap = await this.fileToBitmap(file);
    let { width, height } = bitmap;

    // 计算缩放后尺寸
    if (width > maxWidth || height > maxHeight) {
      const ratio = Math.min(maxWidth / width, maxHeight / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    // 绘制到 canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context not available');
    ctx.drawImage(bitmap, 0, 0, width, height);

    // 转 blob
    const mimeType = `image/${format}`;
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Failed to create blob'))),
        mimeType,
        quality
      );
    });

    const base64 = await blobToBase64(blob);
    const dataUrl = `data:${mimeType};base64,${base64}`;

    const originalSize = file.size;

    const processed: ProcessedImage = {
      id: generateModalityId('img'),
      original: {
        size: originalSize,
        mimeType: file.type || 'image/unknown',
        width: bitmap.width,
        height: bitmap.height,
      },
      processed: {
        base64,
        dataUrl,
        size: blob.size,
        width,
        height,
        format: mimeType,
      },
      metadata: {
        uploadedAt: Date.now(),
        filename: (file as File).name,
      },
    };

    return processed;
  }

  private async fileToBitmap(file: File | Blob): Promise<ImageBitmap> {
    if (typeof createImageBitmap === 'function') {
      return createImageBitmap(file);
    }
    // Fallback: HTMLImageElement
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img as unknown as ImageBitmap);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = URL.createObjectURL(file);
    });
  }

  async encodeImageBase64(file: File | Blob): Promise<string> {
    return blobToBase64(file);
  }

  validateImage(file: File, maxSizeBytes: number = 10 * 1024 * 1024): { valid: boolean; error?: string } {
    if (!file.type.startsWith('image/')) {
      return { valid: false, error: '文件类型不是图像' };
    }
    if (file.size > maxSizeBytes) {
      return { valid: false, error: `文件超过 ${formatBytes(maxSizeBytes)}` };
    }
    return { valid: true };
  }
}

// ============ 语音处理 ============

export class AudioProcessor {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTime: number = 0;
  private pausedDuration: number = 0;
  private pauseStartTime: number = 0;
  private recordingState: 'idle' | 'recording' | 'paused' = 'idle';
  private dataListeners: Array<(chunk: AudioChunk) => void> = [];
  private levelListeners: Array<(level: number) => void> = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private animationFrame: number | null = null;
  private level: number = 0;
  private currentSessionId: string = '';

  async startRecording(options: RecordingOptions = {}): Promise<RecordingSession> {
    const {
      maxDurationMs = 60000,
      language = 'zh-CN',
    } = options;

    if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
      throw new Error('MediaDevices API not available');
    }

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: options.echoCancellation ?? true,
        noiseSuppression: options.noiseSuppression ?? true,
        sampleRate: options.sampleRate ?? 16000,
        channelCount: options.channelCount ?? 1,
      },
    });

    this.mediaRecorder = new MediaRecorder(this.stream);
    this.chunks = [];
    this.startTime = Date.now();
    this.pausedDuration = 0;
    this.recordingState = 'recording';
    this.currentSessionId = generateModalityId('rec');

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this.chunks.push(e.data);
        const audioChunk: AudioChunk = {
          timestamp: Date.now(),
          durationMs: Date.now() - this.startTime - this.pausedDuration,
          level: this.level,
          isSpeech: this.level > 0.1,
        };
        for (const cb of this.dataListeners) {
          try {
            cb(audioChunk);
          } catch (e) {
            // ignore
          }
        }
      }
    };

    this.mediaRecorder.start(100);

    // 设置音量监测
    this.setupAnalyser();

    // 设置最大时长超时
    setTimeout(() => {
      if (this.recordingState === 'recording') {
        this.stop();
      }
    }, maxDurationMs);

    const self = this;
    return {
      id: this.currentSessionId,
      language,
      async start() {
        if (self.recordingState === 'idle') {
          // 重新启动
        }
      },
      async stop() {
        return self.stop();
      },
      pause() {
        self.pause();
      },
      resume() {
        self.resume();
      },
      cancel() {
        self.cancel();
      },
      onData(callback) {
        self.dataListeners.push(callback);
        return () => {
          const idx = self.dataListeners.indexOf(callback);
          if (idx >= 0) self.dataListeners.splice(idx, 1);
        };
      },
      onLevel(callback) {
        self.levelListeners.push(callback);
        return () => {
          const idx = self.levelListeners.indexOf(callback);
          if (idx >= 0) self.levelListeners.splice(idx, 1);
        };
      },
      getDurationMs() {
        if (self.recordingState === 'idle') return 0;
        if (self.recordingState === 'paused') {
          return self.pauseStartTime - self.startTime - self.pausedDuration;
        }
        return Date.now() - self.startTime - self.pausedDuration;
      },
      getLevel() {
        return self.level;
      },
      isRecording() {
        return self.recordingState === 'recording';
      },
      isPaused() {
        return self.recordingState === 'paused';
      },
    } as RecordingSession & { language: string; onLevel: (cb: (level: number) => void) => () => void };
  }

  private setupAnalyser(): void {
    if (!this.stream) return;
    try {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = this.audioContext.createMediaStreamSource(this.stream);
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;
      source.connect(this.analyser);

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      const updateLevel = () => {
        if (!this.analyser) return;
        this.analyser.getByteFrequencyData(dataArray);
        let sum = 0;
        for (const v of dataArray) sum += v;
        const average = sum / dataArray.length;
        this.level = average / 255;
        for (const cb of this.levelListeners) {
          try {
            cb(this.level);
          } catch (e) {
            // ignore
          }
        }
        this.animationFrame = requestAnimationFrame(updateLevel);
      };
      updateLevel();
    } catch (e) {
      // 忽略音量监测错误
    }
  }

  pause(): void {
    if (this.recordingState !== 'recording' || !this.mediaRecorder) return;
    this.mediaRecorder.pause();
    this.recordingState = 'paused';
    this.pauseStartTime = Date.now();
  }

  resume(): void {
    if (this.recordingState !== 'paused' || !this.mediaRecorder) return;
    this.mediaRecorder.resume();
    this.pausedDuration += Date.now() - this.pauseStartTime;
    this.recordingState = 'recording';
  }

  async stop(): Promise<Blob> {
    if (!this.mediaRecorder) {
      return new Blob([], { type: 'audio/webm' });
    }
    return new Promise((resolve) => {
      const recorder = this.mediaRecorder!;
      recorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: recorder.mimeType || 'audio/webm' });
        this.cleanup();
        resolve(blob);
      };
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    });
  }

  cancel(): void {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
    this.cleanup();
  }

  private cleanup(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.analyser = null;
    this.recordingState = 'idle';
  }

  async transcribeAudio(blob: Blob, options: TranscriptionOptions = {}): Promise<TranscriptionResult> {
    // Mock 实现：实际需调用 Whisper 或其他 STT 服务
    return {
      text: options.mockText || `[转录] 音频时长 ${(blob.size / 16000).toFixed(1)}s，内容待识别`,
      segments: [
        {
          text: options.mockText || '[转录] 音频内容',
          startMs: 0,
          endMs: blob.size / 16,
          confidence: 0.9,
        },
      ],
      language: options.language || 'zh-CN',
      durationMs: blob.size / 16,
      confidence: 0.9,
    };
  }

  validateAudio(blob: Blob, maxSizeBytes: number = 50 * 1024 * 1024): { valid: boolean; error?: string } {
    if (!blob.type.startsWith('audio/') && !blob.type.startsWith('video/')) {
      return { valid: false, error: '文件类型不是音频' };
    }
    if (blob.size > maxSizeBytes) {
      return { valid: false, error: `文件超过 ${formatBytes(maxSizeBytes)}` };
    }
    return { valid: true };
  }
}

export interface TranscriptionOptions {
  language?: string;
  mockText?: string;
}

// ============ 文件处理 ============

export class FileProcessor {
  async parseDocument(file: File, options: ParseOptions = {}): Promise<ParsedDocument> {
    const type = detectDocumentType(file);

    if (type === 'pdf') {
      return this.parsePdf(file, options);
    }
    if (type === 'docx') {
      return this.parseDocx(file, options);
    }
    if (type === 'md' || type === 'txt' || type === 'code' || type === 'unknown') {
      return this.parseText(file);
    }
    throw new Error(`Unsupported file type: ${type}`);
  }

  private async parseText(file: File): Promise<ParsedDocument> {
    const content = await file.text();
    const type = detectDocumentType(file);
    return {
      id: generateModalityId('doc'),
      type: type as any,
      filename: file.name,
      size: file.size,
      content,
      metadata: {
        parsedAt: Date.now(),
        lineCount: content.split('\n').length,
      },
      language: this.detectLanguage(file.name),
    };
  }

  private async parsePdf(file: File, _options: ParseOptions): Promise<ParsedDocument> {
    // Mock 实现：实际需引入 pdfjs-dist
    const content = `[PDF Mock] 文档 "${file.name}" 内容提取中...`;
    return {
      id: generateModalityId('doc'),
      type: 'pdf',
      filename: file.name,
      size: file.size,
      content,
      pages: [{ index: 0, text: content }],
      metadata: {
        parsedAt: Date.now(),
        pageCount: 1,
      },
    };
  }

  private async parseDocx(file: File, _options: ParseOptions): Promise<ParsedDocument> {
    // Mock 实现：实际需引入 mammoth
    const content = `[DOCX Mock] 文档 "${file.name}" 内容提取中...`;
    return {
      id: generateModalityId('doc'),
      type: 'docx',
      filename: file.name,
      size: file.size,
      content,
      metadata: {
        parsedAt: Date.now(),
      },
    };
  }

  private detectLanguage(filename: string): string | undefined {
    const ext = filename.split('.').pop()?.toLowerCase();
    const map: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      go: 'go',
      rs: 'rust',
      sh: 'shell',
      yaml: 'yaml',
      yml: 'yaml',
      json: 'json',
      xml: 'xml',
      html: 'html',
      css: 'css',
      md: 'markdown',
    };
    return ext ? map[ext] : undefined;
  }

  validateFile(file: File, maxSizeBytes: number = 50 * 1024 * 1024): { valid: boolean; error?: string } {
    if (file.size > maxSizeBytes) {
      return { valid: false, error: `文件超过 ${formatBytes(maxSizeBytes)}` };
    }
    return { valid: true };
  }
}

// ============ 融合引擎 ============

export class FusionEngine {
  async fuseModalities(items: ModalityItem[]): Promise<FusedModality> {
    const text = items
      .filter((i) => i.type === 'text' && typeof i.content === 'string')
      .map((i) => i.content as string)
      .join('\n');

    const images = items
      .filter((i) => i.type === 'image')
      .map((i) => i.content as ProcessedImage);

    const audioItems = items.filter((i) => i.type === 'audio');
    const audio = audioItems.length > 0 ? (audioItems[0].content as TranscriptionResult) : undefined;

    const files = items
      .filter((i) => i.type === 'file')
      .map((i) => i.content as ParsedDocument);

    return {
      id: generateModalityId('fuse'),
      type: 'multimodal',
      items,
      combined: {
        text,
        images,
        audio,
        files,
      },
      metadata: {
        fusedAt: Date.now(),
        itemCount: items.length,
        totalTokens: estimateModalityTokens(items),
      },
    };
  }
}

// ============ 多模态处理器 ============

export class MultiModalProcessorImpl {
  private imageProcessor: ImageProcessor;
  private audioProcessor: AudioProcessor;
  private fileProcessor: FileProcessor;
  private fusionEngine: FusionEngine;
  private storage: Map<string, ModalityItem> = new Map();

  constructor() {
    this.imageProcessor = new ImageProcessor();
    this.audioProcessor = new AudioProcessor();
    this.fileProcessor = new FileProcessor();
    this.fusionEngine = new FusionEngine();
  }

  // 图像
  async processImage(file: File | Blob, options?: ImageOptions): Promise<ProcessedImage> {
    return this.imageProcessor.processImage(file, options);
  }

  async encodeImageBase64(file: File | Blob): Promise<string> {
    return this.imageProcessor.encodeImageBase64(file);
  }

  // 语音
  async startRecording(options?: RecordingOptions): Promise<RecordingSession> {
    return this.audioProcessor.startRecording(options);
  }

  async transcribeAudio(blob: Blob, options?: TranscriptionOptions): Promise<TranscriptionResult> {
    return this.audioProcessor.transcribeAudio(blob, options);
  }

  // 文件
  async parseDocument(file: File, options?: ParseOptions): Promise<ParsedDocument> {
    return this.fileProcessor.parseDocument(file, options);
  }

  // 融合
  async fuseModalities(items: ModalityItem[]): Promise<FusedModality> {
    return this.fusionEngine.fuseModalities(items);
  }

  // 存储
  addItem(item: ModalityItem): void {
    this.storage.set(item.id, item);
  }

  getItem(id: string): ModalityItem | undefined {
    return this.storage.get(id);
  }

  listItems(): ModalityItem[] {
    return Array.from(this.storage.values());
  }

  removeItem(id: string): boolean {
    return this.storage.delete(id);
  }

  clearItems(): void {
    this.storage.clear();
  }

  // 验证
  validateImage(file: File, maxSizeBytes?: number) {
    return this.imageProcessor.validateImage(file, maxSizeBytes);
  }

  validateAudio(blob: Blob, maxSizeBytes?: number) {
    return this.audioProcessor.validateAudio(blob, maxSizeBytes);
  }

  validateFile(file: File, maxSizeBytes?: number) {
    return this.fileProcessor.validateFile(file, maxSizeBytes);
  }
}

// ============ 单例 ============

let defaultProcessor: MultiModalProcessorImpl | null = null;

export function getDefaultMultiModalProcessor(): MultiModalProcessorImpl {
  if (!defaultProcessor) {
    defaultProcessor = new MultiModalProcessorImpl();
  }
  return defaultProcessor;
}

export function resetDefaultMultiModalProcessor(): void {
  defaultProcessor = null;
}
