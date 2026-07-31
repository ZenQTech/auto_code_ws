/**
 * # Multi-Modal Processor - 单元测试
 * # Cycle 36 G36-03
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ImageProcessor,
  AudioProcessor,
  FileProcessor,
  FusionEngine,
  MultiModalProcessorImpl,
  generateModalityId,
  formatBytes,
  detectFileType,
  detectDocumentType,
  blobToBase64,
  estimateModalityTokens,
  getDefaultMultiModalProcessor,
  resetDefaultMultiModalProcessor,
} from './multiModalProcessor';

describe('Multi-Modal Processor - 工具函数', () => {
  it('generateModalityId 生成 ID', () => {
    const id = generateModalityId();
    expect(id).toMatch(/^mod-/);
  });

  it('formatBytes 格式化字节', () => {
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('detectFileType 检测图像', () => {
    const file = new File([''], 'test.jpg', { type: 'image/jpeg' });
    expect(detectFileType(file)).toBe('image');
  });

  it('detectFileType 检测音频', () => {
    const file = new File([''], 'test.mp3', { type: 'audio/mpeg' });
    expect(detectFileType(file)).toBe('audio');
  });

  it('detectFileType 检测文本', () => {
    const file = new File([''], 'test.txt', { type: 'text/plain' });
    expect(detectFileType(file)).toBe('file');
  });

  it('detectFileType 检测代码', () => {
    const file = new File([''], 'test.ts', { type: '' });
    expect(detectFileType(file)).toBe('file');
  });

  it('detectDocumentType PDF', () => {
    const file = new File([''], 'test.pdf', { type: '' });
    expect(detectDocumentType(file)).toBe('pdf');
  });

  it('detectDocumentType DOCX', () => {
    const file = new File([''], 'test.docx', { type: '' });
    expect(detectDocumentType(file)).toBe('docx');
  });

  it('detectDocumentType Markdown', () => {
    const file = new File([''], 'test.md', { type: '' });
    expect(detectDocumentType(file)).toBe('md');
  });

  it('detectDocumentType 代码', () => {
    const file = new File([''], 'test.ts', { type: '' });
    expect(detectDocumentType(file)).toBe('code');
  });

  it('detectDocumentType 未知', () => {
    const file = new File([''], 'test.xyz', { type: '' });
    expect(detectDocumentType(file)).toBe('unknown');
  });

  it('blobToBase64 转换', async () => {
    const blob = new Blob(['hello'], { type: 'text/plain' });
    const base64 = await blobToBase64(blob);
    expect(base64).toBeTruthy();
    expect(typeof base64).toBe('string');
  });

  it('estimateModalityTokens 估算', () => {
    const items = [
      { id: '1', type: 'text' as const, content: 'hello world' },
      { id: '2', type: 'image' as const, content: { id: '2', original: { size: 0, mimeType: '', width: 0, height: 0 }, processed: { base64: '', dataUrl: '', size: 0, width: 0, height: 0, format: '' }, metadata: { uploadedAt: 0 } } },
    ];
    const tokens = estimateModalityTokens(items);
    expect(tokens).toBeGreaterThan(0);
  });
});

describe('ImageProcessor', () => {
  let processor: ImageProcessor;

  beforeEach(() => {
    processor = new ImageProcessor();
  });

  it('创建实例', () => {
    expect(processor).toBeInstanceOf(ImageProcessor);
  });

  it('validateImage 验证通过', () => {
    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 1024 });
    const result = processor.validateImage(file);
    expect(result.valid).toBe(true);
  });

  it('validateImage 错误类型', () => {
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    const result = processor.validateImage(file);
    expect(result.valid).toBe(false);
  });

  it('validateImage 过大', () => {
    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    Object.defineProperty(file, 'size', { value: 20 * 1024 * 1024 });
    const result = processor.validateImage(file, 10 * 1024 * 1024);
    expect(result.valid).toBe(false);
  });

  it('encodeImageBase64', async () => {
    const blob = new Blob(['fake-image-data'], { type: 'image/jpeg' });
    const base64 = await processor.encodeImageBase64(blob);
    expect(base64).toBeTruthy();
  });
});

describe('AudioProcessor', () => {
  let processor: AudioProcessor;

  beforeEach(() => {
    processor = new AudioProcessor();
  });

  it('创建实例', () => {
    expect(processor).toBeInstanceOf(AudioProcessor);
  });

  it('validateAudio 验证通过', () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    const result = processor.validateAudio(blob);
    expect(result.valid).toBe(true);
  });

  it('validateAudio 错误类型', () => {
    const blob = new Blob(['x'], { type: 'text/plain' });
    const result = processor.validateAudio(blob);
    expect(result.valid).toBe(false);
  });

  it('validateAudio 过大', () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    Object.defineProperty(blob, 'size', { value: 100 * 1024 * 1024 });
    const result = processor.validateAudio(blob, 50 * 1024 * 1024);
    expect(result.valid).toBe(false);
  });

  it('transcribeAudio Mock', async () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    const result = await processor.transcribeAudio(blob, { mockText: 'hello world' });
    expect(result.text).toBe('hello world');
    expect(result.segments.length).toBe(1);
  });

  it('transcribeAudio 默认', async () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    const result = await processor.transcribeAudio(blob);
    expect(result.text).toContain('[转录]');
  });
});

describe('FileProcessor', () => {
  let processor: FileProcessor;

  beforeEach(() => {
    processor = new FileProcessor();
  });

  it('创建实例', () => {
    expect(processor).toBeInstanceOf(FileProcessor);
  });

  it('parseDocument 文本', async () => {
    const file = new File(['line 1\nline 2\nline 3'], 'test.txt', { type: 'text/plain' });
    const result = await processor.parseDocument(file);
    expect(result.type).toBe('txt');
    expect(result.content).toBe('line 1\nline 2\nline 3');
    expect(result.size).toBe(20);
  });

  it('parseDocument Markdown', async () => {
    const file = new File(['# Hello'], 'test.md', { type: 'text/markdown' });
    const result = await processor.parseDocument(file);
    expect(result.type).toBe('md');
    expect(result.content).toBe('# Hello');
  });

  it('parseDocument 代码', async () => {
    const file = new File(['const x = 1;'], 'test.ts', { type: '' });
    const result = await processor.parseDocument(file);
    expect(result.type).toBe('code');
    expect(result.language).toBe('typescript');
  });

  it('parseDocument PDF', async () => {
    const file = new File(['%PDF-1.4 fake'], 'test.pdf', { type: 'application/pdf' });
    const result = await processor.parseDocument(file);
    expect(result.type).toBe('pdf');
    expect(result.pages).toBeDefined();
  });

  it('parseDocument DOCX', async () => {
    const file = new File(['PK fake'], 'test.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const result = await processor.parseDocument(file);
    expect(result.type).toBe('docx');
  });

  it('validateFile 验证通过', () => {
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    const result = processor.validateFile(file);
    expect(result.valid).toBe(true);
  });

  it('validateFile 过大', () => {
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    Object.defineProperty(file, 'size', { value: 100 * 1024 * 1024 });
    const result = processor.validateFile(file, 50 * 1024 * 1024);
    expect(result.valid).toBe(false);
  });
});

describe('FusionEngine', () => {
  let engine: FusionEngine;

  beforeEach(() => {
    engine = new FusionEngine();
  });

  it('创建实例', () => {
    expect(engine).toBeInstanceOf(FusionEngine);
  });

  it('fuseModalities 纯文本', async () => {
    const result = await engine.fuseModalities([
      { id: '1', type: 'text', content: 'Hello' },
      { id: '2', type: 'text', content: 'World' },
    ]);
    expect(result.combined.text).toBe('Hello\nWorld');
    expect(result.combined.images).toHaveLength(0);
    expect(result.combined.files).toHaveLength(0);
  });

  it('fuseModalities 多种模态', async () => {
    const image = {
      id: 'img-1',
      original: { size: 100, mimeType: 'image/jpeg', width: 100, height: 100 },
      processed: { base64: '', dataUrl: '', size: 50, width: 100, height: 100, format: 'image/jpeg' },
      metadata: { uploadedAt: 0 },
    };
    const file = {
      id: 'doc-1',
      type: 'txt' as const,
      filename: 'a.txt',
      size: 10,
      content: 'file content',
      metadata: {},
    };
    const audio = {
      text: 'transcribed',
      segments: [],
      language: 'zh-CN',
      durationMs: 1000,
      confidence: 0.9,
    };
    const result = await engine.fuseModalities([
      { id: '1', type: 'text', content: 'Question' },
      { id: '2', type: 'image', content: image },
      { id: '3', type: 'audio', content: audio },
      { id: '4', type: 'file', content: file },
    ]);
    expect(result.combined.text).toBe('Question');
    expect(result.combined.images).toHaveLength(1);
    expect(result.combined.audio).toEqual(audio);
    expect(result.combined.files).toHaveLength(1);
  });

  it('fuseModalities 包含元数据', async () => {
    const result = await engine.fuseModalities([
      { id: '1', type: 'text', content: 'hi' },
    ]);
    expect(result.metadata.itemCount).toBe(1);
    expect(result.metadata.fusedAt).toBeGreaterThan(0);
    expect(result.metadata.totalTokens).toBeGreaterThan(0);
  });
});

describe('MultiModalProcessorImpl', () => {
  let processor: MultiModalProcessorImpl;

  beforeEach(() => {
    processor = new MultiModalProcessorImpl();
  });

  it('创建实例', () => {
    expect(processor).toBeInstanceOf(MultiModalProcessorImpl);
  });

  it('parseDocument 解析', async () => {
    const file = new File(['content'], 'test.txt', { type: 'text/plain' });
    const result = await processor.parseDocument(file);
    expect(result.content).toBe('content');
  });

  it('transcribeAudio 转录', async () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    const result = await processor.transcribeAudio(blob, { mockText: 'test' });
    expect(result.text).toBe('test');
  });

  it('storage add/get/list/remove/clear', () => {
    const item = { id: '1', type: 'text' as const, content: 'hello' };
    processor.addItem(item);
    expect(processor.getItem('1')).toEqual(item);
    expect(processor.listItems()).toHaveLength(1);
    expect(processor.removeItem('1')).toBe(true);
    expect(processor.listItems()).toHaveLength(0);

    processor.addItem(item);
    processor.clearItems();
    expect(processor.listItems()).toHaveLength(0);
  });

  it('validateImage 验证', () => {
    const file = new File(['x'], 'test.jpg', { type: 'image/jpeg' });
    const result = processor.validateImage(file);
    expect(result.valid).toBe(true);
  });

  it('validateAudio 验证', () => {
    const blob = new Blob(['x'], { type: 'audio/mpeg' });
    const result = processor.validateAudio(blob);
    expect(result.valid).toBe(true);
  });

  it('validateFile 验证', () => {
    const file = new File(['x'], 'test.txt', { type: 'text/plain' });
    const result = processor.validateFile(file);
    expect(result.valid).toBe(true);
  });
});

describe('全局单例', () => {
  beforeEach(() => {
    resetDefaultMultiModalProcessor();
  });

  it('getDefaultMultiModalProcessor 单例', () => {
    const p1 = getDefaultMultiModalProcessor();
    const p2 = getDefaultMultiModalProcessor();
    expect(p1).toBe(p2);
  });

  it('resetDefaultMultiModalProcessor', () => {
    const p1 = getDefaultMultiModalProcessor();
    resetDefaultMultiModalProcessor();
    const p2 = getDefaultMultiModalProcessor();
    expect(p1).not.toBe(p2);
  });
});
