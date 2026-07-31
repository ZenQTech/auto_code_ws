/**
 * # ============================================================
 * # MCP Image Processor - 单元测试 (v1.0.0 Cycle 44 G44-02)
 * # ============================================================
 * # 覆盖：5 大工具 / 错误处理 / 工具定义 / dispatch
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-02 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  McpImageProcessor,
  createMcpImageProcessor,
} from './mcpImageProcessor';

const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('McpImageProcessor', () => {
  let processor: McpImageProcessor;

  beforeEach(() => {
    processor = createMcpImageProcessor({ mode: 'mock' });
  });

  it('工厂函数创建实例', () => {
    expect(processor).toBeInstanceOf(McpImageProcessor);
  });

  describe('image_ocr', () => {
    it('成功识别文字', async () => {
      const r = await processor.ocr({ image: PLACEHOLDER_PNG_BASE64 });
      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      expect(r.data?.text).toContain('OCR');
      expect(r.data?.confidence).toBeGreaterThan(0.9);
    });

    it('支持多语言', async () => {
      const r = await processor.ocr({
        image: PLACEHOLDER_PNG_BASE64,
        languages: ['chi_sim', 'eng'],
      });
      expect(r.success).toBe(true);
    });

    it('指定 mimeType', async () => {
      const r = await processor.ocr({ image: PLACEHOLDER_PNG_BASE64, mimeType: 'image/jpeg' });
      expect(r.success).toBe(true);
    });
  });

  describe('image_describe', () => {
    it('brief 描述', async () => {
      const r = await processor.describe({ image: PLACEHOLDER_PNG_BASE64, detail: 'brief' });
      expect(r.success).toBe(true);
      expect(r.data?.description).toContain('brief');
    });

    it('detailed 描述', async () => {
      const r = await processor.describe({ image: PLACEHOLDER_PNG_BASE64, detail: 'detailed' });
      expect(r.success).toBe(true);
      expect(r.data?.description).toContain('detailed');
    });

    it('包含 tags', async () => {
      const r = await processor.describe({ image: PLACEHOLDER_PNG_BASE64 });
      expect(r.data?.tags).toBeDefined();
      expect(r.data?.tags.length).toBeGreaterThan(0);
    });
  });

  describe('image_resize', () => {
    it('按宽度 resize', async () => {
      const r = await processor.resize({ image: PLACEHOLDER_PNG_BASE64, width: 800 });
      expect(r.success).toBe(true);
      expect(r.data?.width).toBe(800);
    });

    it('按宽高 resize', async () => {
      const r = await processor.resize({ image: PLACEHOLDER_PNG_BASE64, width: 800, height: 600 });
      expect(r.success).toBe(true);
      expect(r.data?.width).toBe(800);
      expect(r.data?.height).toBe(600);
    });

    it('不指定 height 时按比例计算', async () => {
      const r = await processor.resize({ image: PLACEHOLDER_PNG_BASE64, width: 1000 });
      expect(r.data?.height).toBe(750); // 1000 * 0.75
    });

    it('记录原始尺寸', async () => {
      const r = await processor.resize({ image: PLACEHOLDER_PNG_BASE64, width: 100 });
      expect(r.data?.originalWidth).toBe(1024);
      expect(r.data?.originalHeight).toBe(768);
    });
  });

  describe('image_convert', () => {
    it('转换为 webp', async () => {
      const r = await processor.convert({ image: PLACEHOLDER_PNG_BASE64, targetFormat: 'webp' });
      expect(r.success).toBe(true);
      expect(r.data?.format).toBe('webp');
      expect(r.data?.mimeType).toBe('image/webp');
    });

    it('转换为 jpeg 带 quality', async () => {
      const r = await processor.convert({ image: PLACEHOLDER_PNG_BASE64, targetFormat: 'jpeg', quality: 80 });
      expect(r.success).toBe(true);
    });

    it('支持 5 种格式', async () => {
      for (const fmt of ['jpeg', 'png', 'webp', 'gif', 'bmp'] as const) {
        const r = await processor.convert({ image: PLACEHOLDER_PNG_BASE64, targetFormat: fmt });
        expect(r.success).toBe(true);
      }
    });
  });

  describe('image_to_base64', () => {
    it('返回 base64', async () => {
      const r = await processor.toBase64({ image: PLACEHOLDER_PNG_BASE64 });
      expect(r.success).toBe(true);
      expect(r.data?.base64).toBe(PLACEHOLDER_PNG_BASE64);
    });

    it('记录大小', async () => {
      const r = await processor.toBase64({ image: PLACEHOLDER_PNG_BASE64 });
      expect(r.data?.size).toBe(PLACEHOLDER_PNG_BASE64.length);
    });
  });

  describe('getToolDefinitions', () => {
    it('返回 5 个工具定义', () => {
      const tools = processor.getToolDefinitions();
      expect(tools.length).toBe(5);
    });

    it('工具名正确', () => {
      const tools = processor.getToolDefinitions();
      const names = tools.map((t) => t.name);
      expect(names).toContain('image_ocr');
      expect(names).toContain('image_describe');
      expect(names).toContain('image_resize');
      expect(names).toContain('image_convert');
      expect(names).toContain('image_to_base64');
    });

    it('工具都有 inputSchema', () => {
      const tools = processor.getToolDefinitions();
      for (const t of tools) {
        expect(t.inputSchema).toBeDefined();
        expect(t.inputSchema.type).toBe('object');
      }
    });
  });

  describe('dispatch', () => {
    it('分发到 ocr', async () => {
      const r = await processor.dispatch('image_ocr', { image: PLACEHOLDER_PNG_BASE64 });
      expect(r.tool).toBe('image_ocr');
    });

    it('分发到 describe', async () => {
      const r = await processor.dispatch('image_describe', { image: PLACEHOLDER_PNG_BASE64 });
      expect(r.tool).toBe('image_describe');
    });

    it('分发到 resize', async () => {
      const r = await processor.dispatch('image_resize', { image: PLACEHOLDER_PNG_BASE64, width: 100 });
      expect(r.tool).toBe('image_resize');
    });

    it('分发到 convert', async () => {
      const r = await processor.dispatch('image_convert', { image: PLACEHOLDER_PNG_BASE64, targetFormat: 'png' });
      expect(r.tool).toBe('image_convert');
    });

    it('分发到 to_base64', async () => {
      const r = await processor.dispatch('image_to_base64', { image: PLACEHOLDER_PNG_BASE64 });
      expect(r.tool).toBe('image_to_base64');
    });

    it('未知工具返回错误', async () => {
      const r = await processor.dispatch('unknown_tool', {});
      expect(r.success).toBe(false);
      expect(r.error).toContain('Unknown tool');
    });
  });

  describe('统计与重置', () => {
    it('统计正确累计', async () => {
      await processor.ocr({ image: PLACEHOLDER_PNG_BASE64 });
      await processor.describe({ image: PLACEHOLDER_PNG_BASE64 });
      const stats = processor.getStats();
      expect(stats.totalCalls).toBe(2);
      expect(stats.successCalls).toBe(2);
    });

    it('resetStats 清零', () => {
      processor.resetStats();
      const stats = processor.getStats();
      expect(stats.totalCalls).toBe(0);
    });
  });

  describe('模式', () => {
    it('mock 模式不需要 API key', async () => {
      const p = createMcpImageProcessor({ mode: 'mock' });
      const r = await p.ocr({ image: 'x' });
      expect(r.success).toBe(true);
    });

    it('real 模式无 API 时报错', async () => {
      const p = createMcpImageProcessor({ mode: 'real' });
      const r = await p.ocr({ image: 'x' });
      expect(r.success).toBe(false);
    });

    it('auto 模式无 API key 时回退 mock', async () => {
      const p = createMcpImageProcessor({ mode: 'auto' });
      const r = await p.ocr({ image: 'x' });
      expect(r.success).toBe(true);
    });
  });
});
