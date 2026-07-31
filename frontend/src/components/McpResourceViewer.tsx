/**
 * # ============================================================
 * # MCP Resource Viewer - 资源内容预览组件 (v1.0.0 Cycle 40 G40-02)
 * # ============================================================
 * # 核心作用：渲染单个 MCP 资源的内容
 * #           支持文本/图片/二进制/JSON 等多种 MIME 类型
 * # 设计原则：纯展示组件，状态由父组件管理
 * # 输入：MCP 资源元数据 + 可选的内容数据
 * # 输出：格式化的预览视图
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-02 初次创建
 * # ============================================================
 */

import React, { useMemo } from 'react';
import type { Resource, ResourceContent } from '../utils/mcpTypes';

// ============ 类型定义 ============

/**
 * 资源内容类型分类
 */
export type ResourceContentKind =
  | 'text'
  | 'code'
  | 'json'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'binary'
  | 'unknown';

/**
 * 内容分类结果
 */
export interface ResourceContentInfo {
  /** 内容类型分类 */
  kind: ResourceContentKind;
  /** MIME 类型（原始） */
  mimeType: string;
  /** 是否可内联预览 */
  previewable: boolean;
  /** 文件扩展名（用于下载） */
  extension: string;
  /** 大小（字节，仅 binary 时有意义） */
  sizeBytes?: number;
}

/**
 * 组件 Props
 */
export interface McpResourceViewerProps {
  /** 资源元数据 */
  resource: Resource;
  /** 资源内容（可选，未提供时显示加载占位） */
  content?: ResourceContent | null;
  /** 是否正在加载 */
  loading?: boolean;
  /** 加载/读取错误 */
  error?: string | null;
  /** 文本显示最大行数（默认 100） */
  maxLines?: number;
  /** 图片最大宽度（默认 100%） */
  maxImageWidth?: string;
  /** 自定义类名 */
  className?: string;
}

// ============ 内容分类工具 ============

/**
 * 根据 MIME 类型推断内容分类
 */
export function classifyContent(mimeType: string | undefined): ResourceContentInfo {
  const mt = (mimeType ?? '').toLowerCase().trim();
  const ext = mimeTypeToExtension(mt);

  if (!mt) {
    return { kind: 'unknown', mimeType: '', previewable: false, extension: 'bin' };
  }

  // 图片
  if (mt.startsWith('image/')) {
    const previewable = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'].includes(mt);
    return { kind: 'image', mimeType: mt, previewable, extension: ext };
  }

  // 文本/代码/JSON/Markdown
  if (mt === 'application/json') {
    return { kind: 'json', mimeType: mt, previewable: true, extension: 'json' };
  }
  if (mt === 'text/markdown' || mt === 'text/x-markdown') {
    return { kind: 'markdown', mimeType: mt, previewable: true, extension: 'md' };
  }
  if (mt === 'text/html' || mt === 'application/xhtml+xml') {
    return { kind: 'code', mimeType: mt, previewable: true, extension: 'html' };
  }
  if (mt === 'application/pdf') {
    return { kind: 'pdf', mimeType: mt, previewable: true, extension: 'pdf' };
  }
  if (mt.startsWith('audio/')) {
    return { kind: 'audio', mimeType: mt, previewable: true, extension: ext };
  }
  if (mt.startsWith('video/')) {
    return { kind: 'video', mimeType: mt, previewable: true, extension: ext };
  }
  if (mt.startsWith('text/')) {
    return { kind: 'text', mimeType: mt, previewable: true, extension: ext };
  }
  // 已知代码类型
  if (
    [
      'application/javascript',
      'application/typescript',
      'application/x-python',
      'application/x-shellscript',
    ].includes(mt)
  ) {
    return { kind: 'code', mimeType: mt, previewable: true, extension: ext };
  }

  return { kind: 'binary', mimeType: mt, previewable: false, extension: ext };
}

/**
 * MIME 类型到文件扩展名映射
 */
function mimeTypeToExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'text/plain': 'txt',
    'text/html': 'html',
    'text/css': 'css',
    'text/csv': 'csv',
    'text/markdown': 'md',
    'text/xml': 'xml',
    'application/json': 'json',
    'application/javascript': 'js',
    'application/typescript': 'ts',
    'application/pdf': 'pdf',
    'application/zip': 'zip',
    'application/gzip': 'gz',
    'application/x-tar': 'tar',
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
  };
  return map[mimeType] ?? 'bin';
}

/**
 * 格式化字节大小
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/**
 * 估算 base64 字符串的字节数
 */
export function base64ByteSize(b64: string): number {
  if (!b64) return 0;
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  // 每 4 个 base64 字符 = 3 字节 (不含 padding)
  return Math.floor((cleaned.length * 3) / 4);
}

/**
 * 解码 base64 字符串为 Uint8Array
 */
export function decodeBase64(b64: string): Uint8Array {
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof atob === 'function') {
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  return new Uint8Array(0);
}

/**
 * 尝试解析为 JSON 并美化
 */
export function tryFormatJson(text: string): { ok: boolean; formatted: string } {
  try {
    const obj = JSON.parse(text);
    return { ok: true, formatted: JSON.stringify(obj, null, 2) };
  } catch {
    return { ok: false, formatted: text };
  }
}

// ============ 主组件 ============

/**
 * MCP 资源内容预览组件
 * 根据 MIME 类型自动选择合适的渲染方式
 */
export const McpResourceViewer: React.FC<McpResourceViewerProps> = ({
  resource,
  content = null,
  loading = false,
  error = null,
  maxLines = 100,
  maxImageWidth = '100%',
  className = '',
}) => {
  const info = useMemo(() => classifyContent(content?.mimeType ?? resource.mimeType), [
    content?.mimeType,
    resource.mimeType,
  ]);

  // 加载状态
  if (loading) {
    return (
      <div
        data-testid="mcp-resource-viewer-loading"
        className={`p-4 text-sm text-gray-500 italic ${className}`}
      >
        加载中…
      </div>
    );
  }

  // 错误状态
  if (error) {
    return (
      <div
        data-testid="mcp-resource-viewer-error"
        className={`p-4 text-sm text-red-600 bg-red-50 rounded border border-red-200 ${className}`}
      >
        <div className="font-semibold mb-1">加载失败</div>
        <div className="whitespace-pre-wrap">{error}</div>
      </div>
    );
  }

  // 空内容
  if (!content) {
    return (
      <div
        data-testid="mcp-resource-viewer-empty"
        className={`p-4 text-sm text-gray-400 italic ${className}`}
      >
        资源元数据: {resource.uri}
        {resource.mimeType && ` (${resource.mimeType})`}
      </div>
    );
  }

  // 渲染内容
  return (
    <div
      data-testid="mcp-resource-viewer"
      data-mime={info.mimeType}
      data-kind={info.kind}
      className={`mcp-resource-viewer ${className}`}
    >
      <RenderContent
        content={content}
        info={info}
        maxLines={maxLines}
        maxImageWidth={maxImageWidth}
        resourceName={resource.name}
      />
    </div>
  );
};

// ============ 内容渲染器 ============

interface RenderContentProps {
  content: ResourceContent;
  info: ResourceContentInfo;
  maxLines: number;
  maxImageWidth: string;
  resourceName: string;
}

/**
 * 内容渲染分发器
 */
const RenderContent: React.FC<RenderContentProps> = ({
  content,
  info,
  maxLines,
  maxImageWidth,
  resourceName,
}) => {
  // 智能 fallback：如果 mime 未识别但有 text 字段，默认为文本
  const effectiveKind: ResourceContentKind =
    info.kind === 'unknown' && 'text' in content ? 'text' : info.kind;

  switch (effectiveKind) {
    case 'text':
    case 'code':
    case 'markdown':
      return <TextPreview text={'text' in content ? content.text : ''} info={info} maxLines={maxLines} />;
    case 'json':
      return <JsonPreview text={'text' in content ? content.text : ''} maxLines={maxLines} />;
    case 'image':
      return <ImagePreview content={content} info={info} maxWidth={maxImageWidth} />;
    case 'audio':
      return <AudioPreview content={content} info={info} />;
    case 'video':
      return <VideoPreview content={content} info={info} />;
    case 'pdf':
      return <PdfPreview content={content} resourceName={resourceName} />;
    case 'binary':
    default:
      return <BinaryPreview content={content} info={info} resourceName={resourceName} />;
  }
};

// ============ 各类型渲染器 ============

const TextPreview: React.FC<{ text: string; info: ResourceContentInfo; maxLines: number }> = ({
  text,
  info,
  maxLines,
}) => {
  const lines = text.split('\n');
  const truncated = lines.length > maxLines;
  const visibleText = truncated ? lines.slice(0, maxLines).join('\n') : text;
  return (
    <div data-testid="mcp-text-preview" className="space-y-2">
      <pre className="text-xs font-mono bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-96 whitespace-pre">
        {visibleText}
      </pre>
      {truncated && (
        <div className="text-xs text-gray-500 italic">
          显示前 {maxLines} 行，共 {lines.length} 行
        </div>
      )}
      <div className="text-xs text-gray-400">
        {info.mimeType} · {text.length} 字符
      </div>
    </div>
  );
};

const JsonPreview: React.FC<{ text: string; maxLines: number }> = ({ text, maxLines }) => {
  const formatted = useMemo(() => tryFormatJson(text), [text]);
  const lines = formatted.formatted.split('\n');
  const truncated = lines.length > maxLines;
  const visible = truncated ? lines.slice(0, maxLines).join('\n') : formatted.formatted;
  return (
    <div data-testid="mcp-json-preview" className="space-y-2">
      {!formatted.ok && (
        <div className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded">
          警告：JSON 解析失败，显示原始文本
        </div>
      )}
      <pre className="text-xs font-mono bg-gray-50 p-3 rounded border border-gray-200 overflow-auto max-h-96 whitespace-pre">
        {visible}
      </pre>
      {truncated && (
        <div className="text-xs text-gray-500 italic">
          显示前 {maxLines} 行，共 {lines.length} 行
        </div>
      )}
    </div>
  );
};

const ImagePreview: React.FC<{
  content: ResourceContent;
  info: ResourceContentInfo;
  maxWidth: string;
}> = ({ content, info, maxWidth }) => {
  // text 或 blob 资源都可能是图片（base64 编码）
  let dataUrl = '';
  if ('blob' in content) {
    dataUrl = `data:${info.mimeType};base64,${content.blob}`;
  } else if ('text' in content) {
    // 部分 MCP 服务器把 base64 图片放在 text 字段
    dataUrl = `data:${info.mimeType};base64,${content.text}`;
  }

  return (
    <div data-testid="mcp-image-preview" className="space-y-2">
      <div className="bg-gray-50 p-2 rounded border border-gray-200 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={dataUrl}
          alt={content.uri}
          className="rounded shadow-sm"
          style={{ maxWidth, maxHeight: '500px', objectFit: 'contain' }}
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = 'none';
          }}
        />
      </div>
      <div className="text-xs text-gray-400">
        {info.mimeType} · {content.uri}
      </div>
    </div>
  );
};

const AudioPreview: React.FC<{ content: ResourceContent; info: ResourceContentInfo }> = ({
  content,
  info,
}) => {
  const dataUrl =
    'blob' in content
      ? `data:${info.mimeType};base64,${content.blob}`
      : `data:${info.mimeType};base64,${content.text ?? ''}`;
  return (
    <div data-testid="mcp-audio-preview" className="space-y-2">
      <audio controls src={dataUrl} className="w-full" />
      <div className="text-xs text-gray-400">
        {info.mimeType} · {content.uri}
      </div>
    </div>
  );
};

const VideoPreview: React.FC<{ content: ResourceContent; info: ResourceContentInfo }> = ({
  content,
  info,
}) => {
  const dataUrl =
    'blob' in content
      ? `data:${info.mimeType};base64,${content.blob}`
      : `data:${info.mimeType};base64,${content.text ?? ''}`;
  return (
    <div data-testid="mcp-video-preview" className="space-y-2">
      <video controls src={dataUrl} className="w-full max-h-96 rounded" />
      <div className="text-xs text-gray-400">
        {info.mimeType} · {content.uri}
      </div>
    </div>
  );
};

const PdfPreview: React.FC<{ content: ResourceContent; resourceName: string }> = ({
  content,
  resourceName,
}) => {
  const dataUrl =
    'blob' in content ? `data:application/pdf;base64,${content.blob}` : `data:application/pdf;base64,${content.text ?? ''}`;
  return (
    <div data-testid="mcp-pdf-preview" className="space-y-2">
      <iframe
        src={dataUrl}
        title={resourceName}
        className="w-full h-96 rounded border border-gray-200"
      />
      <div className="text-xs text-gray-400">application/pdf · {content.uri}</div>
    </div>
  );
};

const BinaryPreview: React.FC<{
  content: ResourceContent;
  info: ResourceContentInfo;
  resourceName: string;
}> = ({ content, info, resourceName }) => {
  const b64 = 'blob' in content ? content.blob : content.text ?? '';
  const size = base64ByteSize(b64);
  return (
    <div
      data-testid="mcp-binary-preview"
      className="p-4 bg-gray-50 rounded border border-gray-200 space-y-2"
    >
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <span className="text-2xl">📦</span>
        <div>
          <div className="font-semibold">{resourceName}</div>
          <div className="text-xs text-gray-500">
            {info.mimeType || '未知类型'} · {formatBytes(size)}
          </div>
        </div>
      </div>
      <div className="text-xs text-gray-500 italic">二进制文件，不可内联预览</div>
    </div>
  );
};

export default McpResourceViewer;
