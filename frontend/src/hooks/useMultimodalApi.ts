/**
 * # ============================================================
 * # useMultimodalApi - 多模态支持 API 客户端
 * # ============================================================
 * # 核心作用：封装多模态模块（Vision/Audio）的所有后端 API
 * #           支持图像上传、音频上传、Vision 分析、Audio 分析、多模态消息
 * # 运行流程：
 * #   1. 组件调用 uploadImage / uploadAudio 上传媒体
 * #   2. 后端返回 media_id，前端保存到状态
 * #   3. 调用 visionAnalyze / audioAnalyze 执行 AI 分析
 * #   4. 调用 chatSend 发送多模态消息
 * #   5. 调用 listMessages 获取对话历史
 * # 输入参数：通过 hooks 参数传递 API 端点和数据
 * # 输出结果：统一的 Promise<ApiResponse> 返回值
 * # 修改记录：
 * #   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
 * # ============================================================
 */

import { useCallback, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type MediaType = 'image' | 'audio' | 'video' | 'document';

export interface MediaItem {
  media_id: string;
  type: MediaType;
  mime_type: string;
  file_path: string;
  file_size: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  checksum: string;
  thumbnail_path?: string | null;
  metadata: Record<string, any>;
  uploaded_at: string;
  uploaded_by: string;
  session_id?: string | null;
}

export interface VisionAnalysis {
  analysis_id: string;
  media_id: string;
  description: string;
  detected_objects: Array<{ label: string; confidence: number; bbox: number[] }>;
  ocr_text?: string | null;
  ui_elements: Array<{ type: string; label: string; value?: string; bbox?: number[]; confidence?: number }>;
  confidence: number;
  model: string;
  created_at: string;
  analysis_type: string;
}

export interface AudioAnalysis {
  analysis_id: string;
  media_id: string;
  transcript: string;
  language: string;
  sentiment: string;
  duration: number;
  key_segments: Array<{ start: number; end: number; text: string; energy: number }>;
  confidence: number;
  model: string;
  created_at: string;
}

export interface MultimodalMessage {
  message_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  text_content?: string | null;
  media_items: string[];
  metadata: Record<string, any>;
  created_at: string;
  response?: string | null;
}

export interface MultimodalStats {
  total_media: number;
  image_count: number;
  audio_count: number;
  total_size_bytes: number;
  vision_analyses: number;
  audio_analyses: number;
  messages: number;
  storage_dir: string;
}

// ============================================================
// API 基础配置
// ============================================================

const API_BASE = '/api/multimodal';

async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${path} failed: ${response.status} - ${err}`);
  }
  return response.json();
}

async function uploadFile<T = any>(
  path: string,
  file: File,
  fields: Record<string, string> = {},
): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  for (const [k, v] of Object.entries(fields)) {
    formData.append(k, v);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Upload ${path} failed: ${response.status} - ${err}`);
  }
  return response.json();
}

// ============================================================
// API 函数
// ============================================================

/** 健康检查 */
export async function checkHealth(): Promise<{
  service: string;
  status: string;
  storage_dir: string;
  media_count: number;
  vision_analyses_count: number;
  audio_analyses_count: number;
  messages_count: number;
}> {
  return apiFetch('/health');
}

/** 获取统计 */
export async function getStats(): Promise<{ success: boolean; stats: MultimodalStats }> {
  return apiFetch('/stats');
}

/** 上传图像 */
export async function uploadImage(
  file: File,
  uploadedBy: string,
  sessionId?: string,
): Promise<{ success: boolean; media: MediaItem }> {
  return uploadFile('/upload/image', file, {
    uploaded_by: uploadedBy,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
}

/** 上传音频 */
export async function uploadAudio(
  file: File,
  uploadedBy: string,
  sessionId?: string,
): Promise<{ success: boolean; media: MediaItem }> {
  return uploadFile('/upload/audio', file, {
    uploaded_by: uploadedBy,
    ...(sessionId ? { session_id: sessionId } : {}),
  });
}

/** 获取媒体详情 */
export async function getMedia(mediaId: string): Promise<{ success: boolean; media: MediaItem }> {
  return apiFetch(`/media/${encodeURIComponent(mediaId)}`);
}

/** 列出媒体 */
export async function listMedia(params: {
  type?: MediaType;
  uploaded_by?: string;
  session_id?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; count: number; media: MediaItem[] }> {
  const search = new URLSearchParams();
  if (params.type) search.set('type', params.type);
  if (params.uploaded_by) search.set('uploaded_by', params.uploaded_by);
  if (params.session_id) search.set('session_id', params.session_id);
  if (params.limit) search.set('limit', String(params.limit));
  return apiFetch(`/media?${search.toString()}`);
}

/** 删除媒体 */
export async function deleteMedia(
  mediaId: string,
  uploadedBy?: string,
): Promise<{ success: boolean; removed: boolean; media_id: string }> {
  const search = new URLSearchParams();
  if (uploadedBy) search.set('uploaded_by', uploadedBy);
  const qs = search.toString();
  return apiFetch(`/media/${encodeURIComponent(mediaId)}${qs ? '?' + qs : ''}`, {
    method: 'DELETE',
  });
}

/** Vision 分析 */
export async function visionAnalyze(
  mediaId: string,
  analysisType: 'full' | 'ocr' | 'objects' | 'ui' | 'description' = 'full',
): Promise<{ success: boolean; analysis: VisionAnalysis }> {
  return apiFetch('/vision/analyze', {
    method: 'POST',
    body: JSON.stringify({ media_id: mediaId, analysis_type: analysisType }),
  });
}

/** 列出 Vision 分析结果 */
export async function listVisionAnalyses(
  mediaId?: string,
  limit: number = 50,
): Promise<{ success: boolean; count: number; analyses: VisionAnalysis[] }> {
  const search = new URLSearchParams();
  if (mediaId) search.set('media_id', mediaId);
  search.set('limit', String(limit));
  return apiFetch(`/vision/analyses?${search.toString()}`);
}

/** Audio 分析 */
export async function audioAnalyze(
  mediaId: string,
  languageHint?: string,
): Promise<{ success: boolean; analysis: AudioAnalysis }> {
  return apiFetch('/audio/analyze', {
    method: 'POST',
    body: JSON.stringify({
      media_id: mediaId,
      ...(languageHint ? { language_hint: languageHint } : {}),
    }),
  });
}

/** 列出 Audio 分析结果 */
export async function listAudioAnalyses(
  mediaId?: string,
  limit: number = 50,
): Promise<{ success: boolean; count: number; analyses: AudioAnalysis[] }> {
  const search = new URLSearchParams();
  if (mediaId) search.set('media_id', mediaId);
  search.set('limit', String(limit));
  return apiFetch(`/audio/analyses?${search.toString()}`);
}

/** 发送多模态消息 */
export async function chatSend(
  sessionId: string,
  text: string | null,
  mediaIds: string[],
  uploadedBy: string = 'default_user',
): Promise<{
  success: boolean;
  message: MultimodalMessage;
  reply: MultimodalMessage | null;
}> {
  return apiFetch('/chat/send', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      text,
      media_ids: mediaIds,
      uploaded_by: uploadedBy,
    }),
  });
}

/** 列出会话消息 */
export async function listMessages(
  sessionId: string,
  limit: number = 100,
): Promise<{
  success: boolean;
  count: number;
  session_id: string;
  messages: MultimodalMessage[];
}> {
  return apiFetch(`/chat/messages/${encodeURIComponent(sessionId)}?limit=${limit}`);
}

/** 获取单条消息 */
export async function getMessage(
  sessionId: string,
  messageId: string,
): Promise<{ success: boolean; message: MultimodalMessage }> {
  return apiFetch(`/chat/messages/${encodeURIComponent(sessionId)}/${encodeURIComponent(messageId)}`);
}

// ============================================================
// 辅助函数
// ============================================================

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** 格式化时长 */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 获取情感颜色 */
export function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case 'positive':
      return 'text-green-500';
    case 'negative':
      return 'text-red-500';
    default:
      return 'text-gray-500';
  }
}

/** 获取媒体类型图标 */
export function getMediaTypeIcon(type: MediaType): string {
  switch (type) {
    case 'image':
      return '🖼️';
    case 'audio':
      return '🎵';
    case 'video':
      return '🎬';
    case 'document':
      return '📄';
    default:
      return '📎';
  }
}

// ============================================================
// React Hook
// ============================================================

export interface UseMultimodalApiReturn {
  loading: boolean;
  error: string | null;
  uploadImage: (file: File, uploadedBy: string, sessionId?: string) => Promise<MediaItem | null>;
  uploadAudio: (file: File, uploadedBy: string, sessionId?: string) => Promise<MediaItem | null>;
  analyzeVision: (mediaId: string, type?: string) => Promise<VisionAnalysis | null>;
  analyzeAudio: (mediaId: string, lang?: string) => Promise<AudioAnalysis | null>;
  sendChat: (
    sessionId: string,
    text: string | null,
    mediaIds: string[],
  ) => Promise<{ message: MultimodalMessage; reply: MultimodalMessage | null } | null>;
  removeMedia: (mediaId: string, uploadedBy?: string) => Promise<boolean>;
}

/**
 * useMultimodalApi - 统一的多模态 API Hook
 * 提供 loading 状态 + 错误处理 + 简化的调用接口
 */
export function useMultimodalApi(): UseMultimodalApiReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCall = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    setLoading(true);
    setError(null);
    try {
      return await fn();
    } catch (e: any) {
      setError(e?.message || 'Unknown error');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const uploadImageFn = useCallback(
    async (file: File, uploadedBy: string, sessionId?: string) => {
      const result = await handleCall(() => uploadImage(file, uploadedBy, sessionId));
      return result?.success ? result.media : null;
    },
    [handleCall],
  );

  const uploadAudioFn = useCallback(
    async (file: File, uploadedBy: string, sessionId?: string) => {
      const result = await handleCall(() => uploadAudio(file, uploadedBy, sessionId));
      return result?.success ? result.media : null;
    },
    [handleCall],
  );

  const analyzeVisionFn = useCallback(
    async (mediaId: string, type: string = 'full') => {
      const result = await handleCall(() => visionAnalyze(mediaId, type as any));
      return result?.success ? result.analysis : null;
    },
    [handleCall],
  );

  const analyzeAudioFn = useCallback(
    async (mediaId: string, lang?: string) => {
      const result = await handleCall(() => audioAnalyze(mediaId, lang));
      return result?.success ? result.analysis : null;
    },
    [handleCall],
  );

  const sendChatFn = useCallback(
    async (sessionId: string, text: string | null, mediaIds: string[]) => {
      return handleCall(() => chatSend(sessionId, text, mediaIds));
    },
    [handleCall],
  );

  const removeMediaFn = useCallback(
    async (mediaId: string, uploadedBy?: string) => {
      const result = await handleCall(() => deleteMedia(mediaId, uploadedBy));
      return result?.success ? result.removed : false;
    },
    [handleCall],
  );

  return {
    loading,
    error,
    uploadImage: uploadImageFn,
    uploadAudio: uploadAudioFn,
    analyzeVision: analyzeVisionFn,
    analyzeAudio: analyzeAudioFn,
    sendChat: sendChatFn,
    removeMedia: removeMediaFn,
  };
}
