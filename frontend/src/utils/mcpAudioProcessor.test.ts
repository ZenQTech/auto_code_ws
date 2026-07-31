/**
 * # ============================================================
 * # MCP Audio Processor - 单元测试 (v1.0.0 Cycle 44 G44-03)
 * # ============================================================
 * # 覆盖：5 大音频工具 / 错误处理 / dispatch / 工具定义
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-03 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  McpAudioProcessor,
  createMcpAudioProcessor,
} from './mcpAudioProcessor';

const PLACEHOLDER_WAV_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

describe('McpAudioProcessor', () => {
  let processor: McpAudioProcessor;

  beforeEach(() => {
    processor = createMcpAudioProcessor({ mode: 'mock' });
  });

  it('工厂函数创建实例', () => {
    expect(processor).toBeInstanceOf(McpAudioProcessor);
  });

  describe('audio_transcribe', () => {
    it('成功转写', async () => {
      const r = await processor.transcribe({ audio: PLACEHOLDER_WAV_BASE64 });
      expect(r.success).toBe(true);
      expect(r.data?.text).toContain('ASR');
      expect(r.data?.confidence).toBeGreaterThan(0.9);
    });

    it('带时间戳', async () => {
      const r = await processor.transcribe({
        audio: PLACEHOLDER_WAV_BASE64,
        timestamps: true,
      });
      expect(r.data?.segments).toBeDefined();
      expect(r.data?.segments!.length).toBeGreaterThan(0);
    });

    it('自定义语言', async () => {
      const r = await processor.transcribe({
        audio: PLACEHOLDER_WAV_BASE64,
        language: 'en-US',
      });
      expect(r.data?.language).toBe('en-US');
    });
  });

  describe('audio_synthesize', () => {
    it('合成语音', async () => {
      const r = await processor.synthesize({ text: '你好' });
      expect(r.success).toBe(true);
      expect(r.data?.audio).toBeDefined();
      expect(r.data?.durationMs).toBeGreaterThan(0);
    });

    it('长文本产生更长音频', async () => {
      const short = await processor.synthesize({ text: '短' });
      const long = await processor.synthesize({ text: '这是一段很长的测试文字。' });
      expect(long.data!.durationMs).toBeGreaterThan(short.data!.durationMs);
    });

    it('不同输出格式', async () => {
      for (const fmt of ['wav', 'mp3', 'ogg'] as const) {
        const r = await processor.synthesize({ text: '测试', outputFormat: fmt });
        expect(r.data?.format).toBe(fmt);
      }
    });

    it('自定义语速和音调', async () => {
      const r = await processor.synthesize({ text: '测试', rate: 1.5, pitch: 1.2 });
      expect(r.success).toBe(true);
    });
  });

  describe('audio_convert', () => {
    it('转换为 mp3', async () => {
      const r = await processor.convert({ audio: PLACEHOLDER_WAV_BASE64, targetFormat: 'mp3' });
      expect(r.success).toBe(true);
      expect(r.data?.format).toBe('mp3');
    });

    it('支持 6 种格式', async () => {
      for (const fmt of ['wav', 'mp3', 'ogg', 'flac', 'm4a', 'opus'] as const) {
        const r = await processor.convert({ audio: PLACEHOLDER_WAV_BASE64, targetFormat: fmt });
        expect(r.success).toBe(true);
      }
    });
  });

  describe('audio_metadata', () => {
    it('提取元数据', async () => {
      const r = await processor.getMetadata({ audio: PLACEHOLDER_WAV_BASE64 });
      expect(r.success).toBe(true);
      expect(r.data?.format).toBeTruthy();
      expect(r.data?.durationMs).toBeGreaterThan(0);
      expect(r.data?.sampleRate).toBeGreaterThan(0);
      expect(r.data?.channels).toBeGreaterThan(0);
    });
  });

  describe('audio_clip', () => {
    it('提取片段', async () => {
      const r = await processor.clip({
        audio: PLACEHOLDER_WAV_BASE64,
        startMs: 1000,
        endMs: 3000,
      });
      expect(r.success).toBe(true);
      expect(r.data?.startMs).toBe(1000);
      expect(r.data?.endMs).toBe(3000);
      expect(r.data?.durationMs).toBe(2000);
    });

    it('计算片段大小', async () => {
      const r = await processor.clip({
        audio: PLACEHOLDER_WAV_BASE64,
        startMs: 0,
        endMs: 2500,
      });
      expect(r.data?.size).toBeGreaterThan(0);
    });
  });

  describe('getToolDefinitions', () => {
    it('返回 5 个工具定义', () => {
      const tools = processor.getToolDefinitions();
      expect(tools.length).toBe(5);
    });

    it('工具名正确', () => {
      const names = processor.getToolDefinitions().map((t) => t.name);
      expect(names).toContain('audio_transcribe');
      expect(names).toContain('audio_synthesize');
      expect(names).toContain('audio_convert');
      expect(names).toContain('audio_metadata');
      expect(names).toContain('audio_clip');
    });
  });

  describe('dispatch', () => {
    it('分发到 transcribe', async () => {
      const r = await processor.dispatch('audio_transcribe', { audio: PLACEHOLDER_WAV_BASE64 });
      expect(r.tool).toBe('audio_transcribe');
    });

    it('分发到 synthesize', async () => {
      const r = await processor.dispatch('audio_synthesize', { text: '测试' });
      expect(r.tool).toBe('audio_synthesize');
    });

    it('分发到 convert', async () => {
      const r = await processor.dispatch('audio_convert', { audio: 'x', targetFormat: 'mp3' });
      expect(r.tool).toBe('audio_convert');
    });

    it('分发到 metadata', async () => {
      const r = await processor.dispatch('audio_metadata', { audio: 'x' });
      expect(r.tool).toBe('audio_metadata');
    });

    it('分发到 clip', async () => {
      const r = await processor.dispatch('audio_clip', { audio: 'x', startMs: 0, endMs: 1000 });
      expect(r.tool).toBe('audio_clip');
    });

    it('未知工具返回错误', async () => {
      const r = await processor.dispatch('unknown', {});
      expect(r.success).toBe(false);
    });
  });

  describe('统计', () => {
    it('统计正确', async () => {
      await processor.transcribe({ audio: PLACEHOLDER_WAV_BASE64 });
      await processor.synthesize({ text: 'x' });
      const stats = processor.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.successCalls).toBe(2);
    });

    it('resetStats', () => {
      processor.resetStats();
      expect(processor.getStats().totalCalls).toBe(0);
    });
  });
});
