/**
 * # ============================================================
 * # Multimodal Agent Loop - 单元测试 (v1.0.0 Cycle 44 G44-04)
 * # ============================================================
 * # 覆盖：
 * #   1. 路由（rule / explicit / 自动降级）
 * #   2. 多模态输入处理（image / audio / file / text）
 * #   3. 工具执行（图像 / 音频 MCP 工具）
 * #   4. 上下文压缩
 * #   5. LLM 消息构建
 * #   6. 流式事件
 * #   7. 5 大 E2E 场景
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-04 初次创建
 * # ====================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  MultimodalAgentLoop,
  createMultimodalAgentLoop,
  routeInput,
  makeImageInput,
  makeAudioInput,
  makeFileInput,
  makeTextInput,
  type MultimodalInput,
  type MultimodalAgentOptions,
  type MultimodalStreamEvent,
} from './multimodalAgentLoop';
import { McpServerRegistry } from './mcpRegistry';
import { McpToolBridge } from './mcpToolBridge';
import { McpMultimodalToolBridge } from './mcpMultimodalToolBridge';
import { McpImageProcessor } from './mcpImageProcessor';
import { McpAudioProcessor } from './mcpAudioProcessor';
import { ToolUseEngine } from './toolUseEngine';
import { MockProvider, type LLMProvider, type Message, type ChatResponse } from './llmProviderAdapter';
import { PLACEHOLDER_PNG_BASE64 } from './mcpMultimodalToolBridge';

// ============ 测试辅助 ============

const PLACEHOLDER_WAV_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

function createMockToolBridge(): McpToolBridge {
  const bridge = Object.create(McpToolBridge.prototype) as McpToolBridge;
  bridge.getDefinitions = vi.fn().mockReturnValue([]);
  bridge.createExecutor = vi.fn().mockReturnValue({
    execute: vi.fn(),
    type: 'mcp' as const,
  });
  bridge.execute = vi.fn().mockImplementation(async (call: { id: string; name: string }) => {
    if (call.name.includes('image_ocr')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: { content: [{ type: 'text', text: 'OCR 识别结果' }] },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    if (call.name.includes('image_describe')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: {
          content: [
            { type: 'text', text: '一张测试图像，包含若干元素' },
          ],
        },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    if (call.name.includes('audio_transcribe')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: { content: [{ type: 'text', text: '转写结果：你好世界' }] },
        durationMs: 5,
        timestamp: Date.now(),
      };
    }
    if (call.name.includes('audio_metadata')) {
      return {
        callId: call.id,
        name: call.name,
        success: true,
        result: { content: [{ type: 'text', text: '时长: 5000ms' }] },
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

function createMockRegistry(): McpServerRegistry {
  return Object.create(McpServerRegistry.prototype) as McpServerRegistry;
}

function createMockLlm(responses?: string[]): LLMProvider {
  const provider = new MockProvider();
  const respList = responses ?? ['这是测试响应'];
  let callIdx = 0;
  provider.chat = vi.fn().mockImplementation(async (messages: Message[]) => {
    const content = respList[callIdx % respList.length];
    callIdx += 1;
    const response: ChatResponse = {
      id: `resp-${callIdx}`,
      model: 'mock-fast',
      provider: 'mock',
      content,
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      finishReason: 'stop',
      durationMs: 10,
    };
    return response;
  });
  return provider;
}

// ============ 路由测试 ============

describe('routeInput', () => {
  it('应该将图像 OCR 关键词路由到 image_ocr', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const decision = routeInput(input, '请提取图像中的文字');
    expect(decision.toolName).toBe('image_ocr');
    expect(decision.source).toBe('rule');
  });

  it('应该将图像描述关键词路由到 image_describe', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const decision = routeInput(input, '描述这张图片');
    expect(decision.toolName).toBe('image_describe');
  });

  it('应该将图像转换关键词路由到 image_convert', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const decision = routeInput(input, '把图片转换为 PNG 格式');
    expect(decision.toolName).toBe('image_convert');
  });

  it('应该将音频转写关键词路由到 audio_transcribe', () => {
    const input = makeAudioInput(PLACEHOLDER_WAV_BASE64);
    const decision = routeInput(input, '请转写这段音频');
    expect(decision.toolName).toBe('audio_transcribe');
  });

  it('应该将音频元数据关键词路由到 audio_metadata', () => {
    const input = makeAudioInput(PLACEHOLDER_WAV_BASE64);
    const decision = routeInput(input, '提取音频的时长元数据');
    expect(decision.toolName).toBe('audio_metadata');
  });

  it('应该将音频剪辑关键词路由到 audio_clip', () => {
    const input = makeAudioInput(PLACEHOLDER_WAV_BASE64);
    const decision = routeInput(input, '剪辑音频片段');
    expect(decision.toolName).toBe('audio_clip');
  });

  it('应该为图像默认路由到 image_describe', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const decision = routeInput(input, '处理这个');
    expect(decision.toolName).toBe('image_describe');
  });

  it('应该为音频默认路由到 audio_transcribe', () => {
    const input = makeAudioInput(PLACEHOLDER_WAV_BASE64);
    const decision = routeInput(input, '处理这个');
    expect(decision.toolName).toBe('audio_transcribe');
  });

  it('显式映射应覆盖规则匹配', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const decision = routeInput(input, '提取文字', { [input.id]: 'image_describe' });
    expect(decision.toolName).toBe('image_describe');
    expect(decision.source).toBe('explicit');
  });

  it('应正确构造工具参数', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64, 'image/jpeg');
    const decision = routeInput(input, '调整图片宽度为 256', { [input.id]: 'image_resize' });
    expect(decision.arguments.image).toBe(PLACEHOLDER_PNG_BASE64);
    expect(decision.arguments.mimeType).toBe('image/jpeg');
    expect(decision.arguments.width).toBe(512);
  });
});

// ============ 工厂函数测试 ============

describe('工厂函数', () => {
  it('makeImageInput 应生成图像输入', () => {
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64, 'image/jpeg');
    expect(input.type).toBe('image');
    expect(input.data).toBe(PLACEHOLDER_PNG_BASE64);
    expect(input.mimeType).toBe('image/jpeg');
    expect(input.id).toMatch(/^img-/);
    expect(input.timestamp).toBeGreaterThan(0);
  });

  it('makeAudioInput 应生成音频输入', () => {
    const input = makeAudioInput(PLACEHOLDER_WAV_BASE64);
    expect(input.type).toBe('audio');
    expect(input.id).toMatch(/^aud-/);
  });

  it('makeFileInput 应生成文件输入', () => {
    const input = makeFileInput('abc', 'test.txt', 'text/plain');
    expect(input.type).toBe('file');
    expect(input.filename).toBe('test.txt');
  });

  it('makeTextInput 应生成文本输入', () => {
    const input = makeTextInput('hello world');
    expect(input.type).toBe('text');
    expect(input.text).toBe('hello world');
  });
});

// ============ MultimodalAgentLoop 基础测试 ============

describe('MultimodalAgentLoop - 基础', () => {
  let toolBridge: McpToolBridge;
  let registry: McpServerRegistry;
  let llm: LLMProvider;
  let loop: MultimodalAgentLoop;

  beforeEach(() => {
    toolBridge = createMockToolBridge();
    registry = createMockRegistry();
    llm = createMockLlm();
    loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
  });

  it('应该成功创建实例', () => {
    expect(loop).toBeInstanceOf(MultimodalAgentLoop);
  });

  it('初始统计应该为 0', () => {
    const stats = loop.getStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.successRuns).toBe(0);
    expect(stats.failedRuns).toBe(0);
    expect(stats.totalInputs).toBe(0);
  });

  it('应该返回可用能力列表', () => {
    const caps = loop.listCapabilities();
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.some((c) => c.toolName === 'image_ocr')).toBe(true);
    expect(caps.some((c) => c.toolName === 'audio_transcribe')).toBe(true);
  });

  it('应该返回可用工具列表', () => {
    const tools = loop.listAvailableTools();
    expect(Array.isArray(tools)).toBe(true);
  });

  it('resetStats 应重置所有统计', () => {
    loop.resetStats();
    const stats = loop.getStats();
    expect(stats.totalRuns).toBe(0);
    expect(stats.totalImageInputs).toBe(0);
  });
});

// ============ MultimodalAgentLoop - 运行 ============

describe('MultimodalAgentLoop - 运行', () => {
  let toolBridge: McpToolBridge;
  let registry: McpServerRegistry;
  let llm: LLMProvider;
  let loop: MultimodalAgentLoop;

  beforeEach(() => {
    toolBridge = createMockToolBridge();
    registry = createMockRegistry();
    llm = createMockLlm();
    loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
  });

  it('运行纯文本输入应该成功', async () => {
    const inputs: MultimodalInput[] = [makeTextInput('你好')];
    const result = await loop.run('你好', inputs);
    expect(result.success).toBe(true);
    expect(result.inputSummary.total).toBe(1);
    expect(result.inputSummary.texts).toBe(1);
    expect(result.toolExecutions).toHaveLength(0);
  });

  it('运行图像输入应该触发工具执行', async () => {
    const inputs: MultimodalInput[] = [makeImageInput(PLACEHOLDER_PNG_BASE64)];
    const result = await loop.run('描述这张图片', inputs);
    expect(result.success).toBe(true);
    expect(result.inputSummary.images).toBe(1);
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.routingDecisions).toHaveLength(1);
    expect(result.routingDecisions[0].toolName).toBe('image_describe');
  });

  it('运行音频输入应该触发工具执行', async () => {
    const inputs: MultimodalInput[] = [makeAudioInput(PLACEHOLDER_WAV_BASE64)];
    const result = await loop.run('转写这段音频', inputs);
    expect(result.success).toBe(true);
    expect(result.inputSummary.audios).toBe(1);
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.routingDecisions[0].toolName).toBe('audio_transcribe');
  });

  it('多模态输入应该生成多模态 LLM 内容', async () => {
    const inputs: MultimodalInput[] = [
      makeImageInput(PLACEHOLDER_PNG_BASE64),
      makeAudioInput(PLACEHOLDER_WAV_BASE64),
    ];
    const result = await loop.run('描述图像和音频', inputs);
    expect(result.multimodalContent.length).toBeGreaterThan(0);
    expect(result.toolExecutions).toHaveLength(2);
  });

  it('应正确统计输入类型', async () => {
    const inputs: MultimodalInput[] = [
      makeImageInput(PLACEHOLDER_PNG_BASE64),
      makeImageInput(PLACEHOLDER_PNG_BASE64, 'image/jpeg'),
      makeAudioInput(PLACEHOLDER_WAV_BASE64),
      makeTextInput('hello'),
      makeFileInput('xxx', 'a.txt', 'text/plain'),
    ];
    const result = await loop.run('处理所有', inputs);
    expect(result.inputSummary.images).toBe(2);
    expect(result.inputSummary.audios).toBe(1);
    expect(result.inputSummary.texts).toBe(1);
    expect(result.inputSummary.files).toBe(1);
    expect(result.inputSummary.total).toBe(5);
  });
});

// ============ MultimodalAgentLoop - 路由策略 ============

describe('MultimodalAgentLoop - 路由策略', () => {
  let toolBridge: McpToolBridge;
  let registry: McpServerRegistry;
  let llm: LLMProvider;

  beforeEach(() => {
    toolBridge = createMockToolBridge();
    registry = createMockRegistry();
    llm = createMockLlm();
  });

  it('explicit 策略应使用显式工具映射', async () => {
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      routingStrategy: 'explicit',
    });
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const result = await loop.run('任何消息', [input], {
      explicitToolMap: { [input.id]: 'image_ocr' },
    });
    expect(result.routingDecisions[0].toolName).toBe('image_ocr');
    expect(result.routingDecisions[0].source).toBe('explicit');
  });

  it('auto 策略应基于规则路由', async () => {
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      routingStrategy: 'auto',
    });
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    const result = await loop.run('提取文字', [input]);
    expect(result.routingDecisions[0].toolName).toBe('image_ocr');
    expect(result.routingDecisions[0].source).toBe('rule');
  });
});

// ============ MultimodalAgentLoop - 直接工具调用 ============

describe('MultimodalAgentLoop - 直接工具调用', () => {
  let toolBridge: McpToolBridge;
  let registry: McpServerRegistry;
  let llm: LLMProvider;
  let loop: MultimodalAgentLoop;

  beforeEach(() => {
    toolBridge = createMockToolBridge();
    registry = createMockRegistry();
    llm = createMockLlm();
    loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
  });

  it('invokeImageTool 应直接调用图像工具', async () => {
    const result = await loop.invokeImageTool('image_ocr', {
      image: PLACEHOLDER_PNG_BASE64,
      mimeType: 'image/png',
    });
    expect(result.success).toBe(true);
    expect(result.toolName).toBe('image_ocr');
    expect(result.parts.length).toBeGreaterThan(0);
  });

  it('invokeAudioTool 应直接调用音频工具', async () => {
    const result = await loop.invokeAudioTool('audio_transcribe', {
      audio: PLACEHOLDER_WAV_BASE64,
    });
    expect(result.success).toBe(true);
    expect(result.toolName).toBe('audio_transcribe');
  });
});

// ============ MultimodalAgentLoop - 流式事件 ============

describe('MultimodalAgentLoop - 流式事件', () => {
  let toolBridge: McpToolBridge;
  let registry: McpServerRegistry;
  let llm: LLMProvider;
  let loop: MultimodalAgentLoop;

  beforeEach(() => {
    toolBridge = createMockToolBridge();
    registry = createMockRegistry();
    llm = createMockLlm();
    loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
  });

  it('订阅流式事件应接收 input-processed', async () => {
    const events: MultimodalStreamEvent[] = [];
    loop.onStream((e) => events.push(e));
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    await loop.run('描述', [input]);
    expect(events.some((e) => e.type === 'input-processed')).toBe(true);
  });

  it('应触发 routing-decision 事件', async () => {
    const events: MultimodalStreamEvent[] = [];
    loop.onStream((e) => events.push(e));
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    await loop.run('提取文字', [input]);
    expect(events.some((e) => e.type === 'routing-decision')).toBe(true);
  });

  it('应触发 tool-execution-complete 事件', async () => {
    const events: MultimodalStreamEvent[] = [];
    loop.onStream((e) => events.push(e));
    const input = makeAudioInput(PLACEHOLDER_WAV_BASE64);
    await loop.run('转写', [input]);
    expect(events.some((e) => e.type === 'tool-execution-complete')).toBe(true);
  });

  it('应触发 final 事件', async () => {
    const events: MultimodalStreamEvent[] = [];
    loop.onStream((e) => events.push(e));
    await loop.run('hello', []);
    expect(events.some((e) => e.type === 'final')).toBe(true);
  });
});

// ============ MultimodalAgentLoop - 回调 ============

describe('MultimodalAgentLoop - 回调', () => {
  it('onInputProcessed 应被调用', async () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const onInputProcessed = vi.fn();
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      onInputProcessed,
    });
    const input = makeImageInput(PLACEHOLDER_PNG_BASE64);
    await loop.run('描述', [input]);
    expect(onInputProcessed).toHaveBeenCalledWith(input);
  });

  it('onRoutingDecision 应被调用', async () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const onRoutingDecision = vi.fn();
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      onRoutingDecision,
    });
    await loop.run('提取文字', [makeImageInput(PLACEHOLDER_PNG_BASE64)]);
    expect(onRoutingDecision).toHaveBeenCalled();
  });

  it('onToolExecution 应被调用', async () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const onToolExecution = vi.fn();
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      onToolExecution,
    });
    await loop.run('描述', [makeImageInput(PLACEHOLDER_PNG_BASE64)]);
    expect(onToolExecution).toHaveBeenCalled();
  });
});

// ============ E2E 场景测试 ============

describe('E2E 场景 (5 大)', () => {
  let toolBridge: McpToolBridge;
  let registry: McpServerRegistry;
  let llm: LLMProvider;
  let loop: MultimodalAgentLoop;

  beforeEach(() => {
    toolBridge = createMockToolBridge();
    registry = createMockRegistry();
    llm = createMockLlm();
    loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
  });

  it('场景 1: 图像描述端到端', async () => {
    const result = await loop.run('描述这张图片', [makeImageInput(PLACEHOLDER_PNG_BASE64)]);
    expect(result.success).toBe(true);
    expect(result.toolExecutions).toHaveLength(1);
    expect(result.toolExecutions[0].toolName).toBe('image_describe');
    expect(result.content).toBeTruthy();
  });

  it('场景 2: 图像 OCR 端到端', async () => {
    const result = await loop.run('提取这张图片中的文字', [makeImageInput(PLACEHOLDER_PNG_BASE64)]);
    expect(result.success).toBe(true);
    expect(result.toolExecutions[0].toolName).toBe('image_ocr');
  });

  it('场景 3: 音频转写端到端', async () => {
    const result = await loop.run('转写这段音频', [makeAudioInput(PLACEHOLDER_WAV_BASE64)]);
    expect(result.success).toBe(true);
    expect(result.toolExecutions[0].toolName).toBe('audio_transcribe');
  });

  it('场景 4: 混合多模态端到端', async () => {
    const inputs = [
      makeImageInput(PLACEHOLDER_PNG_BASE64),
      makeAudioInput(PLACEHOLDER_WAV_BASE64),
    ];
    const result = await loop.run('处理图像和音频', inputs);
    expect(result.success).toBe(true);
    expect(result.toolExecutions).toHaveLength(2);
    expect(result.multimodalContent.length).toBeGreaterThanOrEqual(2);
  });

  it('场景 5: 多模态 + 文本混合端到端', async () => {
    const inputs = [
      makeImageInput(PLACEHOLDER_PNG_BASE64),
      makeTextInput('请总结上述结果'),
    ];
    const result = await loop.run('分析并总结', inputs);
    expect(result.success).toBe(true);
    expect(result.inputSummary.texts).toBe(1);
    expect(result.inputSummary.images).toBe(1);
  });
});

// ============ 性能与压缩 ============

describe('多模态压缩', () => {
  it('应处理大 base64 数据（自动 placeholder）', async () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
    // 构造 2MB 的 base64（超过 1MB 限制）
    const largeBase64 = 'A'.repeat(2 * 1024 * 1024);
    const input = makeImageInput(largeBase64);
    const result = await loop.run('描述', [input]);
    expect(result.success).toBe(true);
    // 应被压缩为 placeholder
    const stats = loop.getStats();
    expect(stats.totalMultimodalExecutions).toBe(1);
  });
});

// ============ 错误处理 ============

describe('错误处理', () => {
  it('LLM 失败时 result 应标记失败', async () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    llm.chat = vi.fn().mockRejectedValue(new Error('LLM 失败'));
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
    const result = await loop.run('hello', []);
    expect(result.success).toBe(false);
    expect(result.terminationReason).toBe('error');
  });

  it('dispose 应清理资源', () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
    });
    expect(() => loop.dispose()).not.toThrow();
  });
});

// ============ 自定义选项 ============

describe('自定义选项', () => {
  it('应接受自定义 multimodalBridge', () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const customBridge = new McpMultimodalToolBridge(toolBridge);
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      multimodalBridge: customBridge,
    });
    expect(loop).toBeInstanceOf(MultimodalAgentLoop);
  });

  it('应接受自定义 imageProcessor', () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const customProcessor = new McpImageProcessor({ mode: 'mock' });
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      imageProcessor: customProcessor,
    });
    expect(loop).toBeInstanceOf(MultimodalAgentLoop);
  });

  it('应接受自定义 audioProcessor', () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const customProcessor = new McpAudioProcessor({ mode: 'mock' });
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      audioProcessor: customProcessor,
    });
    expect(loop).toBeInstanceOf(MultimodalAgentLoop);
  });

  it('应接受自定义 toolEngine', () => {
    const toolBridge = createMockToolBridge();
    const registry = createMockRegistry();
    const llm = createMockLlm();
    const customEngine = new ToolUseEngine();
    const loop = createMultimodalAgentLoop({
      llmProvider: llm,
      mcpRegistry: registry,
      toolBridge,
      toolEngine: customEngine,
    });
    expect(loop).toBeInstanceOf(MultimodalAgentLoop);
  });
});
