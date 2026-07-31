/**
 * # ============================================================
 * # MCP Multimodal Tool Bridge - 单元测试 (v1.0.0 Cycle 44 G44-01)
 * # ============================================================
 * # 覆盖：能力声明 / 内容转换 / 压缩 / LLM 内容生成 / 错误处理
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-01 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  McpMultimodalToolBridge,
  createMcpMultimodalToolBridge,
  PLACEHOLDER_PNG_BASE64,
  PLACEHOLDER_WAV_BASE64,
  type MultimodalContentPart,
} from './mcpMultimodalToolBridge';
import { McpToolBridge } from './mcpToolBridge';
import type { ToolCall } from './toolUseEngine';

// Mock McpToolBridge
function createMockBaseBridge(): McpToolBridge {
  const bridge = Object.create(McpToolBridge.prototype) as McpToolBridge;
  bridge.execute = vi.fn().mockImplementation(async (call: { id: string; name: string; arguments: Record<string, unknown> }) => {
    // 根据工具名返回不同的 mock 结果
    if (call.name.includes('throw')) {
      throw new Error('bridge throw');
    }
    if (call.name.includes('error')) {
      return {
        callId: call.id,
        name: call.name,
        success: false,
        result: { content: [] },
        error: { code: 'EXECUTION_ERROR', message: 'mock error' },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    if (call.name.includes('image_ocr') || call.name.includes('image_describe')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: {
          content: [
            { type: 'text', text: '识别结果: hello world' },
          ],
        },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    if (call.name.includes('image_')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: {
          content: [
            { type: 'image', data: PLACEHOLDER_PNG_BASE64, mimeType: 'image/png' },
          ],
        },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    if (call.name.includes('audio_')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: {
          content: [
            { type: 'text', text: '转写结果: 你好世界' },
          ],
        },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    return {
      callId: call.id,
      name: call.name,
      success: true,
      result: { content: [{ type: 'text', text: 'default' }] },
      durationMs: 5,
      timestamp: Date.now(),
    };
  });
  return bridge;
}

describe('McpMultimodalToolBridge', () => {
  let baseBridge: McpToolBridge;
  let bridge: McpMultimodalToolBridge;

  beforeEach(() => {
    baseBridge = createMockBaseBridge();
    bridge = createMcpMultimodalToolBridge(baseBridge);
  });

  it('工厂函数创建实例', () => {
    expect(bridge).toBeInstanceOf(McpMultimodalToolBridge);
  });

  it('声明工具能力', () => {
    bridge.declareCapability({
      toolName: 'image_ocr',
      outputTypes: ['image', 'text'],
      maxSize: 5_000_000,
    });
    expect(bridge.getCapability('image_ocr')).toBeDefined();
  });

  it('批量声明能力', () => {
    bridge.declareCapabilities([
      { toolName: 'image_ocr', outputTypes: ['image'] },
      { toolName: 'audio_transcribe', outputTypes: ['text'] },
    ]);
    expect(bridge.listCapabilities().length).toBe(2);
  });

  it('工具结果为文本时转换为 text part', async () => {
    const call: ToolCall = { id: 'c1', name: 'mcp__image__image_ocr', arguments: { path: '/x.png' } };
    const result = await bridge.invokeMultimodal(call);
    expect(result.success).toBe(true);
    expect(result.parts.length).toBe(1);
    expect(result.parts[0].type).toBe('text');
    expect(result.parts[0].text).toContain('hello world');
  });

  it('工具结果为图像时转换为 image part', async () => {
    const call: ToolCall = { id: 'c2', name: 'mcp__image__image_resize', arguments: { width: 100 } };
    const result = await bridge.invokeMultimodal(call);
    expect(result.success).toBe(true);
    expect(result.parts[0].type).toBe('image');
    expect(result.parts[0].data).toBe(PLACEHOLDER_PNG_BASE64);
  });

  it('工具结果为音频时转写为文本', async () => {
    const call: ToolCall = { id: 'c3', name: 'mcp__audio__audio_transcribe', arguments: {} };
    const result = await bridge.invokeMultimodal(call);
    expect(result.success).toBe(true);
    expect(result.parts[0].type).toBe('text');
    expect(result.parts[0].text).toContain('转写');
  });

  it('工具调用失败时返回错误', async () => {
    const call: ToolCall = { id: 'c4', name: 'mcp__image__image_error', arguments: {} };
    const result = await bridge.invokeMultimodal(call);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('桥接抛出异常时返回错误结果', async () => {
    const call: ToolCall = { id: 'c5', name: 'mcp__x__throw_tool', arguments: {} };
    const result = await bridge.invokeMultimodal(call);
    expect(result.success).toBe(false);
    expect(result.error).toContain('bridge throw');
  });

  it('toLLMContent 将多模态结果转换为 LLM 内容', async () => {
    const call: ToolCall = { id: 'c6', name: 'mcp__image__image_resize', arguments: {} };
    const result = await bridge.invokeMultimodal(call);
    const llmContent = bridge.toLLMContent(result);
    expect(llmContent.length).toBe(1);
    expect(llmContent[0].type).toBe('image_url');
    expect(llmContent[0].image_url?.url).toContain('data:image/png;base64,');
  });

  it('toLLMContent 文本转 text', async () => {
    const call: ToolCall = { id: 'c7', name: 'mcp__image__image_ocr', arguments: {} };
    const result = await bridge.invokeMultimodal(call);
    const llmContent = bridge.toLLMContent(result);
    expect(llmContent[0].type).toBe('text');
    expect(llmContent[0].text).toContain('hello world');
  });

  it('toLLMContent 错误时返回错误文本', async () => {
    const result = {
      callId: 'c8',
      toolName: 'error',
      success: false,
      parts: [],
      error: 'test error',
      durationMs: 0,
      timestamp: 0,
    };
    const llmContent = bridge.toLLMContent(result);
    expect(llmContent[0].type).toBe('text');
    expect(llmContent[0].text).toContain('test error');
  });

  it('压缩统计正确', async () => {
    const call: ToolCall = { id: 'c9', name: 'mcp__image__image_resize', arguments: {} };
    const result = await bridge.invokeMultimodal(call);
    expect(result.compressionRatio).toBeDefined();
    expect(result.compressionRatio).toBeGreaterThanOrEqual(0);
  });

  it('统计信息正确累计', async () => {
    await bridge.invokeMultimodal({ id: 'a', name: 'mcp__x__image_x', arguments: {} });
    await bridge.invokeMultimodal({ id: 'b', name: 'mcp__x__image_ocr', arguments: {} });
    const stats = bridge.getStats();
    expect(stats.totalMultimodalCalls).toBe(2);
    expect(stats.imageCalls).toBeGreaterThanOrEqual(1);
  });

  it('resetStats 重置所有统计', () => {
    bridge.resetStats();
    const stats = bridge.getStats();
    expect(stats.totalMultimodalCalls).toBe(0);
  });

  it('dispose 清理能力声明', () => {
    bridge.declareCapability({ toolName: 'foo', outputTypes: ['text'] });
    bridge.dispose();
    expect(bridge.listCapabilities().length).toBe(0);
  });

  it('自动压缩开启时超长文本被截断', async () => {
    const longText = 'x'.repeat(20000);
    baseBridge.execute = vi.fn().mockResolvedValue({
      callId: 'c10',
      name: 'mcp__x__long',
      success: true,
      result: { content: [{ type: 'text', text: longText }] },
      durationMs: 5,
      timestamp: Date.now(),
    });
    const result = await bridge.invokeMultimodal({ id: 'c10', name: 'mcp__x__long', arguments: {} });
    expect(result.parts[0].text?.length).toBeLessThan(longText.length);
    expect(result.parts[0].text).toContain('已截断');
  });

  it('超大 base64 替换为 placeholder', async () => {
    const hugeBase64 = 'A'.repeat(2 * 1024 * 1024); // 2MB
    baseBridge.execute = vi.fn().mockResolvedValue({
      callId: 'c11',
      name: 'mcp__x__huge',
      success: true,
      result: { content: [{ type: 'image', data: hugeBase64, mimeType: 'image/png' }] },
      durationMs: 5,
      timestamp: Date.now(),
    });
    const result = await bridge.invokeMultimodal({ id: 'c11', name: 'mcp__x__huge', arguments: {} });
    expect(result.parts[0].data).toBe(PLACEHOLDER_PNG_BASE64);
  });

  it('关闭 autoCompress 时不压缩', async () => {
    const customBridge = createMcpMultimodalToolBridge(baseBridge, { autoCompress: false });
    const longText = 'y'.repeat(20000);
    baseBridge.execute = vi.fn().mockResolvedValue({
      callId: 'c12',
      name: 'mcp__x__long',
      success: true,
      result: { content: [{ type: 'text', text: longText }] },
      durationMs: 5,
      timestamp: Date.now(),
    });
    const result = await customBridge.invokeMultimodal({ id: 'c12', name: 'mcp__x__long', arguments: {} });
    expect(result.parts[0].text).toBe(longText);
  });

  it('resource 类型工具结果转换', async () => {
    baseBridge.execute = vi.fn().mockResolvedValue({
      callId: 'c13',
      name: 'mcp__x__file',
      success: true,
      result: {
        content: [
          { type: 'resource', resource: { uri: 'file:///x.txt', text: 'file content', mimeType: 'text/plain' } },
        ],
      },
      durationMs: 5,
      timestamp: Date.now(),
    });
    const result = await bridge.invokeMultimodal({ id: 'c13', name: 'mcp__x__file', arguments: {} });
    expect(result.parts[0].type).toBe('text');
    expect(result.parts[0].text).toBe('file content');
  });

  it('resource blob 类型工具结果转换', async () => {
    baseBridge.execute = vi.fn().mockResolvedValue({
      callId: 'c14',
      name: 'mcp__x__fileblob',
      success: true,
      result: {
        content: [
          { type: 'resource', resource: { uri: 'file:///x.bin', blob: 'AAAA', mimeType: 'application/octet-stream' } },
        ],
      },
      durationMs: 5,
      timestamp: Date.now(),
    });
    const result = await bridge.invokeMultimodal({ id: 'c14', name: 'mcp__x__fileblob', arguments: {} });
    expect(result.parts[0].type).toBe('file');
    expect(result.parts[0].data).toBe('AAAA');
  });

  it('序列化对象结果', async () => {
    baseBridge.execute = vi.fn().mockResolvedValue({
      callId: 'c15',
      name: 'mcp__x__obj',
      success: true,
      result: { key: 'value', num: 42 },
      durationMs: 5,
      timestamp: Date.now(),
    });
    const result = await bridge.invokeMultimodal({ id: 'c15', name: 'mcp__x__obj', arguments: {} });
    expect(result.parts[0].type).toBe('text');
    expect(result.parts[0].text).toContain('"key"');
    expect(result.parts[0].text).toContain('"value"');
  });
});
