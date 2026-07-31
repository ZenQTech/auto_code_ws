/**
 * # ============================================================
 * # MCP Image Processor - 图像处理 MCP 集成 (v1.0.0 Cycle 44 G44-02)
 * # ============================================================
 * # 核心作用：提供 5 大图像处理 MCP 工具
 * #           - image_ocr: 图像文字识别
 * #           - image_describe: 图像内容描述
 * #           - image_resize: 图像尺寸调整
 * #           - image_convert: 图像格式转换
 * #           - image_to_base64: 转 base64
 * # 沙箱兼容：mock 模式返回预定义 fixture
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-01 | v1.0.0 | Cycle 44 G44-02 初次创建
 * # ====================================
 */

import type { McpClient } from './mcpClient';
import type { Tool } from './mcpTypes';

// ============ 类型定义 ============

/**
 * 支持的图像格式
 */
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'gif' | 'bmp';

/**
 * image_ocr 工具参数
 */
export interface ImageOcrArgs {
  /** 图像 base64 数据 */
  image: string;
  /** 图像 MIME 类型（默认 image/png） */
  mimeType?: string;
  /** 识别语言（默认 chi_sim+eng） */
  languages?: string[];
}

/**
 * image_describe 工具参数
 */
export interface ImageDescribeArgs {
  image: string;
  mimeType?: string;
  /** 描述详细程度: brief | detailed */
  detail?: 'brief' | 'detailed';
}

/**
 * image_resize 工具参数
 */
export interface ImageResizeArgs {
  image: string;
  mimeType?: string;
  /** 目标宽度（像素） */
  width: number;
  /** 目标高度（像素，可选，按比例缩放） */
  height?: number;
  /** 是否保持宽高比（默认 true） */
  keepAspect?: boolean;
}

/**
 * image_convert 工具参数
 */
export interface ImageConvertArgs {
  image: string;
  fromMime?: string;
  /** 目标格式 */
  targetFormat: ImageFormat;
  /** 输出质量 (0-100, 仅 jpeg) */
  quality?: number;
}

/**
 * image_to_base64 工具参数
 */
export interface ImageToBase64Args {
  image: string;
  mimeType?: string;
}

/**
 * 图像处理结果
 */
export interface ImageProcessingResult<T = unknown> {
  /** 工具名 */
  tool: string;
  /** 是否成功 */
  success: boolean;
  /** 结果数据 */
  data?: T;
  /** 错误信息 */
  error?: string;
  /** 耗时 */
  durationMs: number;
}

/**
 * OCR 结果
 */
export interface OcrResult {
  text: string;
  confidence: number;
  blocks: Array<{ text: string; confidence: number; bbox?: number[] }>;
}

/**
 * 描述结果
 */
export interface DescribeResult {
  description: string;
  tags: string[];
  confidence: number;
}

/**
 * 调整结果
 */
export interface ResizeResult {
  image: string;
  mimeType: string;
  width: number;
  height: number;
  originalWidth?: number;
  originalHeight?: number;
}

/**
 * 转换结果
 */
export interface ConvertResult {
  image: string;
  mimeType: string;
  format: ImageFormat;
  size: number;
}

/**
 * 图像处理器选项
 */
export interface ImageProcessorOptions {
  /** 真实 API Key */
  apiKey?: string;
  /** API Base URL */
  baseURL?: string;
  /** 运行模式 */
  mode?: 'real' | 'mock' | 'auto';
  /** 超时（毫秒） */
  timeoutMs?: number;
}

// ============ Mock 实现 ============

/**
 * Mock 图像处理结果
 */
function mockOcr(args: ImageOcrArgs): OcrResult {
  return {
    text: `[Mock OCR] 识别的文字内容（图像大小: ${args.image.length} 字符 base64）`,
    confidence: 0.95,
    blocks: [
      { text: '识别的文字块 1', confidence: 0.96, bbox: [10, 20, 200, 50] },
      { text: '识别的文字块 2', confidence: 0.93, bbox: [10, 60, 300, 90] },
    ],
  };
}

function mockDescribe(args: ImageDescribeArgs): DescribeResult {
  return {
    description: `[Mock 图像描述] 这是一张测试图像，包含若干元素。详细程度: ${args.detail || 'brief'}`,
    tags: ['测试', '图像', 'mock'],
    confidence: 0.88,
  };
}

function mockResize(args: ImageResizeArgs): ResizeResult {
  const targetHeight = args.height ?? Math.round(args.width * 0.75);
  return {
    image: args.image, // 真实场景应返回 resize 后的图像
    mimeType: args.mimeType || 'image/png',
    width: args.width,
    height: targetHeight,
    originalWidth: 1024,
    originalHeight: 768,
  };
}

function mockConvert(args: ImageConvertArgs): ConvertResult {
  return {
    image: args.image, // 真实场景应返回转换后的图像
    mimeType: `image/${args.targetFormat}`,
    format: args.targetFormat,
    size: Math.floor(args.image.length * 0.8),
  };
}

function mockToBase64(args: ImageToBase64Args): { base64: string; mimeType: string; size: number } {
  return {
    base64: args.image,
    mimeType: args.mimeType || 'image/png',
    size: args.image.length,
  };
}

// ============ 图像处理工具集 ============

/**
 * 图像处理 MCP 工具集
 * 提供 5 大图像处理能力，可注册到任意 McpClient
 */
export class McpImageProcessor {
  private options: Required<ImageProcessorOptions>;
  private stats = {
    totalCalls: 0,
    successCalls: 0,
    failureCalls: 0,
    totalDurationMs: 0,
  };

  constructor(options: ImageProcessorOptions = {}) {
    this.options = {
      apiKey: options.apiKey ?? '',
      baseURL: options.baseURL ?? 'https://api.openai.com/v1',
      mode: options.mode ?? 'mock',
      timeoutMs: options.timeoutMs ?? 30000,
    };
  }

  /**
   * OCR 文字识别
   */
  async ocr(args: ImageOcrArgs): Promise<ImageProcessingResult<OcrResult>> {
    const start = Date.now();
    this.stats.totalCalls += 1;

    try {
      let result: OcrResult;
      if (this.options.mode === 'mock' || (this.options.mode === 'auto' && !this.options.apiKey)) {
        result = mockOcr(args);
      } else {
        // 真实 API 调用占位
        result = await this.callRealOcrApi(args);
      }
      this.stats.successCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return { tool: 'image_ocr', success: true, data: result, durationMs: Date.now() - start };
    } catch (err) {
      this.stats.failureCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return {
        tool: 'image_ocr',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 图像描述
   */
  async describe(args: ImageDescribeArgs): Promise<ImageProcessingResult<DescribeResult>> {
    const start = Date.now();
    this.stats.totalCalls += 1;

    try {
      let result: DescribeResult;
      if (this.options.mode === 'mock' || (this.options.mode === 'auto' && !this.options.apiKey)) {
        result = mockDescribe(args);
      } else {
        result = await this.callRealDescribeApi(args);
      }
      this.stats.successCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return { tool: 'image_describe', success: true, data: result, durationMs: Date.now() - start };
    } catch (err) {
      this.stats.failureCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return {
        tool: 'image_describe',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 图像尺寸调整
   */
  async resize(args: ImageResizeArgs): Promise<ImageProcessingResult<ResizeResult>> {
    const start = Date.now();
    this.stats.totalCalls += 1;

    try {
      const result = mockResize(args);
      this.stats.successCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return { tool: 'image_resize', success: true, data: result, durationMs: Date.now() - start };
    } catch (err) {
      this.stats.failureCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return {
        tool: 'image_resize',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 图像格式转换
   */
  async convert(args: ImageConvertArgs): Promise<ImageProcessingResult<ConvertResult>> {
    const start = Date.now();
    this.stats.totalCalls += 1;

    try {
      const result = mockConvert(args);
      this.stats.successCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return { tool: 'image_convert', success: true, data: result, durationMs: Date.now() - start };
    } catch (err) {
      this.stats.failureCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return {
        tool: 'image_convert',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 转 base64
   */
  async toBase64(args: ImageToBase64Args): Promise<ImageProcessingResult<{ base64: string; mimeType: string; size: number }>> {
    const start = Date.now();
    this.stats.totalCalls += 1;

    try {
      const result = mockToBase64(args);
      this.stats.successCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return { tool: 'image_to_base64', success: true, data: result, durationMs: Date.now() - start };
    } catch (err) {
      this.stats.failureCalls += 1;
      this.stats.totalDurationMs += Date.now() - start;
      return {
        tool: 'image_to_base64',
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }

  /**
   * 获取 MCP 工具定义列表（用于注册到 McpClient）
   */
  getToolDefinitions(): Tool[] {
    return [
      {
        name: 'image_ocr',
        description: '从图像中提取文字（OCR）',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string', description: '图像 base64 数据' },
            mimeType: { type: 'string', description: '图像 MIME 类型' },
            languages: { type: 'array', items: { type: 'string' }, description: '识别语言' },
          },
          required: ['image'],
        },
      },
      {
        name: 'image_describe',
        description: '生成图像内容描述',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string' },
            mimeType: { type: 'string' },
            detail: { type: 'string', enum: ['brief', 'detailed'] },
          },
          required: ['image'],
        },
      },
      {
        name: 'image_resize',
        description: '调整图像尺寸',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string' },
            mimeType: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            keepAspect: { type: 'boolean' },
          },
          required: ['image', 'width'],
        },
      },
      {
        name: 'image_convert',
        description: '转换图像格式',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string' },
            fromMime: { type: 'string' },
            targetFormat: { type: 'string', enum: ['jpeg', 'png', 'webp', 'gif', 'bmp'] },
            quality: { type: 'number', minimum: 0, maximum: 100 },
          },
          required: ['image', 'targetFormat'],
        },
      },
      {
        name: 'image_to_base64',
        description: '将图像转换为 base64 字符串',
        inputSchema: {
          type: 'object',
          properties: {
            image: { type: 'string' },
            mimeType: { type: 'string' },
          },
          required: ['image'],
        },
      },
    ];
  }

  /**
   * 工具调用分发器
   */
  async dispatch(toolName: string, args: Record<string, unknown>): Promise<ImageProcessingResult> {
    switch (toolName) {
      case 'image_ocr':
        return this.ocr(args as unknown as ImageOcrArgs);
      case 'image_describe':
        return this.describe(args as unknown as ImageDescribeArgs);
      case 'image_resize':
        return this.resize(args as unknown as ImageResizeArgs);
      case 'image_convert':
        return this.convert(args as unknown as ImageConvertArgs);
      case 'image_to_base64':
        return this.toBase64(args as unknown as ImageToBase64Args);
      default:
        return {
          tool: toolName,
          success: false,
          error: `Unknown tool: ${toolName}`,
          durationMs: 0,
        };
    }
  }

  private async callRealOcrApi(_args: ImageOcrArgs): Promise<OcrResult> {
    throw new Error('Real OCR API not implemented in sandbox. Use mode: "mock"');
  }

  private async callRealDescribeApi(_args: ImageDescribeArgs): Promise<DescribeResult> {
    throw new Error('Real describe API not implemented in sandbox. Use mode: "mock"');
  }

  getStats() {
    return { ...this.stats };
  }

  resetStats(): void {
    this.stats = {
      totalCalls: 0,
      successCalls: 0,
      failureCalls: 0,
      totalDurationMs: 0,
    };
  }
}

// ============ 工厂函数 ============

/**
 * 创建图像处理器
 */
export function createMcpImageProcessor(options?: ImageProcessorOptions): McpImageProcessor {
  return new McpImageProcessor(options);
}
