/**
 * # ============================================================
 * # MCP Multimodal Tool Bridge - 多模态 MCP 工具桥接 (v1.0.0 Cycle 44 G44-01)
 * # ============================================================
 * # 核心作用：扩展 McpToolBridge 支持多模态工具结果
 * #           - 图像：base64 + MIME 注入 Hermes
 * #           - 音频：转写文本 + 元数据
 * #           - 文件：元数据 + 文本预览
 * #           - 自动多模态上下文压缩（base64 优化）
 * # 协议版本：MCP 2024-11-05
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-01 初次创建
 * # ====================================
 */

import type { ToolCall, ToolCallResult, ToolDefinition } from './toolUseEngine';
import { McpToolBridge } from './mcpToolBridge';
import type { McpClient } from './mcpClient';
import type { ToolContent, ToolCallResult as McpToolCallResult } from './mcpTypes';

// ============ 类型定义 ============

/**
 * 多模态工具结果类型
 */
export type MultimodalToolType = 'text' | 'image' | 'audio' | 'file' | 'mixed';

/**
 * 多模态内容片段
 */
export interface MultimodalContentPart {
  type: 'text' | 'image' | 'audio' | 'file';
  /** 文本内容 */
  text?: string;
  /** base64 数据 */
  data?: string;
  /** MIME 类型 */
  mimeType?: string;
  /** 文件名（仅 file 类型） */
  filename?: string;
  /** 文件大小（仅 file 类型） */
  size?: number;
  /** 时长（仅 audio/video） */
  durationMs?: number;
  /** 原始数据（仅 file 类型） */
  blob?: string;
  /** 元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 多模态工具执行结果
 */
export interface MultimodalToolResult {
  callId: string;
  toolName: string;
  success: boolean;
  /** 内容片段（一个或多个） */
  parts: MultimodalContentPart[];
  /** 原始 MCP 结果 */
  raw?: McpToolCallResult;
  /** 错误 */
  error?: string;
  /** 执行耗时 */
  durationMs: number;
  /** 压缩率（0-1） */
  compressionRatio?: number;
  /** 时间戳 */
  timestamp: number;
}

/**
 * 工具多模态能力声明
 */
export interface ToolMultimodalCapability {
  /** 工具名 */
  toolName: string;
  /** 支持的输出类型 */
  outputTypes: MultimodalToolType[];
  /** 是否需要 base64 编码 */
  requiresBase64?: boolean;
  /** 最大尺寸（字节） */
  maxSize?: number;
}

/**
 * 多模态工具桥接选项
 */
export interface MultimodalToolBridgeOptions {
  /** 最大 base64 长度（超过自动截断） */
  maxBase64Length?: number;
  /** 压缩阈值（字节） */
  compressionThreshold?: number;
  /** 是否启用自动压缩 */
  autoCompress?: boolean;
  /** 图像默认 MIME */
  defaultImageMime?: string;
  /** 音频默认 MIME */
  defaultAudioMime?: string;
}

// ============ 默认实现 ============

/**
 * 默认图像占位符（1x1 透明 PNG）
 */
export const PLACEHOLDER_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * 默认音频占位符（静音 WAV）
 */
export const PLACEHOLDER_WAV_BASE64 =
  'UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/**
 * 文件预览默认内容
 */
export const PLACEHOLDER_TEXT_PREVIEW = '(文件内容为空或为二进制)';

// ============ 多模态工具桥接 ============

/**
 * 多模态 MCP 工具桥接
 * 包装 McpToolBridge 处理多模态工具结果
 */
export class McpMultimodalToolBridge {
  private baseBridge: McpToolBridge;
  private options: Required<MultimodalToolBridgeOptions>;
  private capabilities: Map<string, ToolMultimodalCapability> = new Map();
  private stats = {
    totalMultimodalCalls: 0,
    imageCalls: 0,
    audioCalls: 0,
    fileCalls: 0,
    textCalls: 0,
    compressionSavings: 0,
    totalDurationMs: 0,
  };

  constructor(baseBridge: McpToolBridge, options: MultimodalToolBridgeOptions = {}) {
    this.baseBridge = baseBridge;
    this.options = {
      maxBase64Length: options.maxBase64Length ?? 1024 * 1024, // 1MB
      compressionThreshold: options.compressionThreshold ?? 10 * 1024, // 10KB
      autoCompress: options.autoCompress ?? true,
      defaultImageMime: options.defaultImageMime ?? 'image/png',
      defaultAudioMime: options.defaultAudioMime ?? 'audio/wav',
    };
  }

  /**
   * 声明工具的多模态能力
   */
  declareCapability(capability: ToolMultimodalCapability): void {
    this.capabilities.set(capability.toolName, capability);
  }

  /**
   * 批量声明能力
   */
  declareCapabilities(capabilities: ToolMultimodalCapability[]): void {
    for (const cap of capabilities) {
      this.declareCapability(cap);
    }
  }

  /**
   * 获取工具的多模态能力
   */
  getCapability(toolName: string): ToolMultimodalCapability | undefined {
    return this.capabilities.get(toolName);
  }

  /**
   * 列出所有已声明能力
   */
  listCapabilities(): ToolMultimodalCapability[] {
    return Array.from(this.capabilities.values());
  }

  /**
   * 调用多模态工具
   * 包装 McpToolBridge.execute 并转换结果为多模态格式
   */
  async invokeMultimodal(call: ToolCall): Promise<MultimodalToolResult> {
    const start = Date.now();
    this.stats.totalMultimodalCalls += 1;

    try {
      // 解析 MCP 工具限定名
      // 格式: mcp__<serverId>__<toolName>
      const parts = call.name.split('__');
      let toolName = call.name;
      if (parts.length === 3 && parts[0] === 'mcp') {
        toolName = parts[2];
      }

      // 调用底层 MCP 工具
      const hermesResult = await this.baseBridge.execute({
        id: call.id,
        name: call.name,
        arguments: call.arguments,
      });

      // 转换为多模态格式
      const result = this.convertToMultimodal(
        call,
        toolName,
        hermesResult,
        Date.now() - start,
      );

      // 统计
      this.updateStats(result);
      this.stats.totalDurationMs += result.durationMs;

      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const result: MultimodalToolResult = {
        callId: call.id,
        toolName: call.name,
        success: false,
        parts: [],
        error: errorMsg,
        durationMs: Date.now() - start,
        timestamp: Date.now(),
      };
      this.stats.totalDurationMs += result.durationMs;
      return result;
    }
  }

  /**
   * 转换 MCP 工具结果为多模态格式
   */
  private convertToMultimodal(
    call: ToolCall,
    toolName: string,
    hermesResult: { success: boolean; result?: unknown; error?: { code: string; message: string } },
    durationMs: number,
  ): MultimodalToolResult {
    const parts: MultimodalContentPart[] = [];

    // 解析 result 字段
    const raw = hermesResult.result as McpToolCallResult | undefined;

    if (raw && Array.isArray(raw.content)) {
      for (const content of raw.content) {
        const part = this.convertContent(content);
        if (part) parts.push(part);
      }
    } else if (typeof hermesResult.result === 'string') {
      parts.push({
        type: 'text',
        text: hermesResult.result,
        metadata: { source: 'hermes-result' },
      });
    } else if (hermesResult.result !== undefined && hermesResult.result !== null) {
      // 尝试将对象序列化为文本
      try {
        parts.push({
          type: 'text',
          text: JSON.stringify(hermesResult.result, null, 2),
          metadata: { source: 'hermes-result', serialized: true },
        });
      } catch {
        // 不可序列化
      }
    }

    // 压缩
    let compressionRatio: number | undefined;
    if (this.options.autoCompress) {
      const { compressed, ratio } = this.compressParts(parts);
      parts.length = 0;
      parts.push(...compressed);
      compressionRatio = ratio;
    }

    return {
      callId: call.id,
      toolName,
      success: hermesResult.success,
      parts,
      raw,
      error: hermesResult.error?.message,
      durationMs,
      compressionRatio,
      timestamp: Date.now(),
    };
  }

  /**
   * 转换单个 MCP content 项
   */
  private convertContent(content: ToolContent): MultimodalContentPart | null {
    // 文本
    if (content.type === 'text' && content.text) {
      return {
        type: 'text',
        text: content.text,
        metadata: { source: 'mcp-tool' },
      };
    }

    // 图像
    if (content.type === 'image') {
      this.stats.imageCalls += 1;
      return {
        type: 'image',
        data: content.data || PLACEHOLDER_PNG_BASE64,
        mimeType: content.mimeType || this.options.defaultImageMime,
        metadata: { source: 'mcp-tool' },
      };
    }

    // 资源（文本或二进制）
    if (content.type === 'resource') {
      const resource = content.resource;
      if ('text' in resource && resource.text) {
        return {
          type: 'text',
          text: resource.text,
          metadata: { source: 'mcp-resource', uri: resource.uri },
        };
      }
      if ('blob' in resource && resource.blob) {
        return {
          type: 'file',
          data: resource.blob,
          mimeType: resource.mimeType,
          metadata: { source: 'mcp-resource', uri: resource.uri },
        };
      }
    }

    return null;
  }

  /**
   * 压缩 base64 数据
   */
  private compressParts(parts: MultimodalContentPart[]): {
    compressed: MultimodalContentPart[];
    ratio: number;
  } {
    let originalSize = 0;
    let compressedSize = 0;

    const compressed = parts.map((part) => {
      if (part.type === 'image' || part.type === 'audio') {
        if (!part.data) return part;
        originalSize += part.data.length;

        // 超过 maxBase64Length → 截断为 placeholder
        if (part.data.length > this.options.maxBase64Length) {
          const placeholder =
            part.type === 'image' ? PLACEHOLDER_PNG_BASE64 : PLACEHOLDER_WAV_BASE64;
          compressedSize += placeholder.length;
          return {
            ...part,
            data: placeholder,
            metadata: {
              ...(part.metadata || {}),
              compressed: true,
              originalSize: part.data.length,
              reason: 'exceeds_max_base64',
            },
          };
        }

        compressedSize += part.data.length;
        return part;
      }

      if (part.type === 'text' && part.text) {
        originalSize += part.text.length;
        // 截断超长文本
        if (part.text.length > 10_000) {
          const truncated = `${part.text.slice(0, 9_500)}\n\n... (已截断，原文 ${part.text.length} 字符)`;
          compressedSize += truncated.length;
          return {
            ...part,
            text: truncated,
            metadata: { ...(part.metadata || {}), compressed: true },
          };
        }
        compressedSize += part.text.length;
      }

      return part;
    });

    const ratio = originalSize === 0 ? 0 : 1 - compressedSize / originalSize;
    this.stats.compressionSavings += Math.max(0, originalSize - compressedSize);

    return { compressed, ratio };
  }

  private updateStats(result: MultimodalToolResult): void {
    for (const part of result.parts) {
      if (part.type === 'image') this.stats.imageCalls += 1;
      else if (part.type === 'audio') this.stats.audioCalls += 1;
      else if (part.type === 'file') this.stats.fileCalls += 1;
      else if (part.type === 'text') this.stats.textCalls += 1;
    }
  }

  /**
   * 将多模态结果转换为 LLM 可消费的 Content 数组
   */
  toLLMContent(result: MultimodalToolResult): Array<{
    type: 'text' | 'image_url' | 'audio';
    text?: string;
    image_url?: { url: string };
    input_audio?: { data: string; format: string };
  }> {
    const out: Array<{
      type: 'text' | 'image_url' | 'audio';
      text?: string;
      image_url?: { url: string };
      input_audio?: { data: string; format: string };
    }> = [];

    for (const part of result.parts) {
      if (part.type === 'text' && part.text) {
        out.push({ type: 'text', text: part.text });
      } else if (part.type === 'image' && part.data) {
        const mime = part.mimeType || this.options.defaultImageMime;
        out.push({
          type: 'image_url',
          image_url: { url: `data:${mime};base64,${part.data}` },
        });
      } else if (part.type === 'audio' && part.data) {
        const mime = part.mimeType || this.options.defaultAudioMime;
        const format = mime.split('/')[1] || 'wav';
        out.push({
          type: 'audio',
          input_audio: { data: part.data, format },
        });
      }
    }

    if (result.parts.length === 0 && result.error) {
      out.push({ type: 'text', text: `(工具错误: ${result.error})` });
    }

    return out;
  }

  /**
   * 统计信息
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * 重置统计
   */
  resetStats(): void {
    this.stats = {
      totalMultimodalCalls: 0,
      imageCalls: 0,
      audioCalls: 0,
      fileCalls: 0,
      textCalls: 0,
      compressionSavings: 0,
      totalDurationMs: 0,
    };
  }

  /**
   * 释放资源
   */
  dispose(): void {
    this.capabilities.clear();
  }
}

// ============ 工厂函数 ============

/**
 * 创建多模态工具桥接
 */
export function createMcpMultimodalToolBridge(
  baseBridge: McpToolBridge,
  options?: MultimodalToolBridgeOptions,
): McpMultimodalToolBridge {
  return new McpMultimodalToolBridge(baseBridge, options);
}
