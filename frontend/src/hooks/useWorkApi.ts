/**
 * # ============================================================
 * # useWorkApi - TRAE Work 多模态协作 API 客户端
 * # ============================================================
 * # 核心作用：封装 TRAE Work 4 大子系统的所有后端 API
 * #   1. Design Mode - 6 模板 + NL 编辑 + 代码导出
 * #   2. Voice Chat - 会话 + 上下文 + Web 搜索 + STT/TTS
 * #   3. Global Memory - 项目级知识库
 * #   4. Video - 元数据 + 关键帧 + 摘要 + Mock 生成
 * # 运行流程：
 * #   1. 组件调用 createDraft / voiceSendMessage / memorySearch / videoSummarize
 * #   2. 后端返回结果，前端保存到状态
 * #   3. 调用 listXxx 刷新列表
 * # 输入参数：通过方法参数传递 API 端点和数据
 * # 输出结果：统一的 Promise<ApiResponse> 返回值
 * # 修改记录：
 * #   - 2026-07-28 | v6.31.0 | Cycle 14 P1-3 初始版本
 * # ============================================================
 */

import { useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type DesignTemplate =
  | 'web'
  | 'mobile'
  | 'landing'
  | 'components'
  | 'poster'
  | 'dashboard';

export type ExportFormat = 'html' | 'react' | 'tailwind' | 'vue';

export interface NLEditChange {
  change_id: string;
  type: string;
  target: string;
  old_value: string | null;
  new_value: string | null;
  instruction: string;
}

export interface DesignDraft {
  draft_id: string;
  name: string;
  template: DesignTemplate | string;
  description: string;
  style: Record<string, any>;
  components: Array<Record<string, any>>;
  html: string;
  created_at: string;
  updated_at: string;
  owner: string;
  version: number;
  tags: string[];
}

export interface DesignSystem {
  system_id: string;
  name: string;
  colors: Record<string, string>;
  typography: Record<string, any>;
  spacing: Record<string, any>;
  components: Record<string, any>;
  owner: string;
  created_at: string;
  updated_at: string;
}

export interface VoiceMessage {
  message_id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  audio_id?: string | null;
  metadata: Record<string, any>;
  created_at: string;
}

export interface VoiceSession {
  session_id: string;
  user_id: string;
  project_id: string;
  status: 'active' | 'paused' | 'closed';
  messages: VoiceMessage[];
  context_refs: string[];
  web_search_results: Array<Record<string, any>>;
  created_at: string;
  updated_at: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
  source: string;
  score: number;
}

export type KnowledgeCategory =
  | 'preference'
  | 'fact'
  | 'context'
  | 'rule'
  | 'todo';

export type KnowledgeSource = 'user' | 'ai' | 'system' | 'imported';

export type KnowledgeStatus = 'active' | 'archived' | 'deleted';

export interface KnowledgeEntry {
  entry_id: string;
  project_id: string;
  category: KnowledgeCategory | string;
  content: string;
  tags: string[];
  source: KnowledgeSource | string;
  confidence: number;
  created_at: string;
  updated_at: string;
  last_used_at: string;
  use_count: number;
  status: KnowledgeStatus | string;
  metadata: Record<string, any>;
}

export interface VideoFrame {
  frame_id: string;
  video_id: string;
  timestamp: number;
  file_path: string;
  is_key_frame: boolean;
  description: string;
}

export interface VideoScene {
  scene_id: string;
  start: number;
  end: number;
  description: string;
  key_frame_id: string | null;
}

export interface VideoMetadata {
  video_id: string;
  title: string;
  description: string;
  file_path: string;
  file_size: number;
  duration: number;
  resolution: string;
  uploaded_by: string;
  uploaded_at: string;
  status: string;
  metadata: Record<string, any>;
}

export interface VideoSummary {
  summary_id: string;
  video_id: string;
  key_frames: string[];
  duration: number;
  transcript: string;
  scenes: Array<Record<string, any>>;
  summary_text: string;
  created_at: string;
}

export interface VideoGeneration {
  gen_id: string;
  prompt: string;
  duration: number;
  resolution: string;
  style: string;
  status: string;
  owner: string;
  output_path: string;
  created_at: string;
  completed_at: string;
}

export interface WorkStats {
  design: Record<string, number>;
  voice: Record<string, number>;
  memory: Record<string, number>;
  video: Record<string, number>;
}

// ============================================================
// API 基础配置
// ============================================================

const API_BASE = '/api/work';

async function apiFetch<T = any>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API ${path} failed: ${response.status} - ${err}`);
  }
  return response.json();
}

// ============================================================
// 全局健康/统计
// ============================================================

export async function getWorkHealth(): Promise<{
  status: string;
  version: string;
  started_at: string;
  modules: Record<string, string>;
}> {
  return apiFetch('/health');
}

export async function getWorkStats(): Promise<{ success: boolean; stats: WorkStats }> {
  return apiFetch('/stats');
}

// ============================================================
// Design Mode
// ============================================================

export async function getDesignHealth(): Promise<{ status: string; module: string; stats: Record<string, number> }> {
  return apiFetch('/design/health');
}

export async function getDesignStats(): Promise<{ success: boolean; stats: Record<string, number> }> {
  return apiFetch('/design/stats');
}

export async function createDraft(params: {
  name: string;
  template: DesignTemplate | string;
  description?: string;
  owner?: string;
  style?: Record<string, any>;
  tags?: string[];
}): Promise<{ success: boolean; draft: DesignDraft }> {
  return apiFetch('/design/drafts', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      template: params.template,
      description: params.description || '',
      owner: params.owner || 'web_user',
      style: params.style,
      tags: params.tags,
    }),
  });
}

export async function listDrafts(params: {
  owner?: string;
  template?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; count: number; drafts: DesignDraft[] }> {
  const search = new URLSearchParams();
  if (params.owner) search.set('owner', params.owner);
  if (params.template) search.set('template', params.template);
  if (params.limit) search.set('limit', String(params.limit));
  return apiFetch(`/design/drafts?${search.toString()}`);
}

export async function getDraft(draftId: string): Promise<{ success: boolean; draft: DesignDraft }> {
  return apiFetch(`/design/drafts/${encodeURIComponent(draftId)}`);
}

export async function updateDraft(
  draftId: string,
  patch: { name?: string; description?: string; style?: Record<string, any>; tags?: string[] },
): Promise<{ success: boolean; draft: DesignDraft }> {
  return apiFetch(`/design/drafts/${encodeURIComponent(draftId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteDraft(draftId: string): Promise<{ success: boolean }> {
  return apiFetch(`/design/drafts/${encodeURIComponent(draftId)}`, {
    method: 'DELETE',
  });
}

export async function applyNLEdit(
  draftId: string,
  instruction: string,
): Promise<{
  success: boolean;
  draft: DesignDraft | null;
  changes: NLEditChange[];
}> {
  return apiFetch(`/design/drafts/${encodeURIComponent(draftId)}/nl-edit`, {
    method: 'POST',
    body: JSON.stringify({ instruction }),
  });
}

export async function exportDesign(
  draftId: string,
  format: ExportFormat = 'html',
): Promise<{ success: boolean; format: string; code: string; language: string }> {
  return apiFetch(`/design/drafts/${encodeURIComponent(draftId)}/export`, {
    method: 'POST',
    body: JSON.stringify({ format }),
  });
}

export async function createSystem(params: {
  name: string;
  owner?: string;
  colors?: Record<string, string>;
  typography?: Record<string, any>;
  spacing?: Record<string, any>;
  components?: Record<string, any>;
}): Promise<{ success: boolean; system: DesignSystem }> {
  return apiFetch('/design/systems', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      owner: params.owner || 'web_user',
      colors: params.colors,
      typography: params.typography,
      spacing: params.spacing,
      components: params.components,
    }),
  });
}

export async function listSystems(): Promise<{
  success: boolean;
  count: number;
  systems: DesignSystem[];
}> {
  return apiFetch('/design/systems');
}

// ============================================================
// Voice Chat
// ============================================================

export async function getVoiceHealth(): Promise<{ status: string; module: string; stats: Record<string, number> }> {
  return apiFetch('/voice/health');
}

export async function createVoiceSession(params: {
  user_id?: string;
  project_id: string;
  initial_message?: string;
}): Promise<{ success: boolean; session: VoiceSession }> {
  return apiFetch('/voice/sessions', {
    method: 'POST',
    body: JSON.stringify({
      user_id: params.user_id || 'web_user',
      project_id: params.project_id,
      initial_message: params.initial_message,
    }),
  });
}

export async function listVoiceSessions(params: {
  user_id?: string;
  project_id?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; count: number; sessions: VoiceSession[] }> {
  const search = new URLSearchParams();
  if (params.user_id) search.set('user_id', params.user_id);
  if (params.project_id) search.set('project_id', params.project_id);
  if (params.limit) search.set('limit', String(params.limit));
  return apiFetch(`/voice/sessions?${search.toString()}`);
}

export async function getVoiceSession(sessionId: string): Promise<{ success: boolean; session: VoiceSession }> {
  return apiFetch(`/voice/sessions/${encodeURIComponent(sessionId)}`);
}

export async function closeVoiceSession(sessionId: string): Promise<{
  success: boolean;
  closed: boolean;
  session_id: string;
}> {
  return apiFetch(`/voice/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function sendVoiceMessage(
  sessionId: string,
  text: string,
  options: {
    audio_id?: string;
    use_context?: boolean;
    use_web_search?: boolean;
    web_search_query?: string;
  } = {},
): Promise<{
  success: boolean;
  message: VoiceMessage;
  reply: VoiceMessage;
  context_refs: string[];
  web_results: Array<Record<string, any>>;
}> {
  return apiFetch(`/voice/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({
      text,
      audio_id: options.audio_id,
      use_context: options.use_context ?? true,
      use_web_search: options.use_web_search ?? false,
      web_search_query: options.web_search_query,
    }),
  });
}

export async function getVoiceContext(
  sessionId: string,
  query?: string,
  maxRefs: number = 5,
): Promise<{ success: boolean; context_refs: string[]; entries: KnowledgeEntry[] }> {
  const search = new URLSearchParams();
  if (query) search.set('query', query);
  search.set('max_refs', String(maxRefs));
  return apiFetch(`/voice/sessions/${encodeURIComponent(sessionId)}/context?${search.toString()}`);
}

export async function webSearch(
  query: string,
  maxResults: number = 5,
): Promise<{ success: boolean; count: number; results: WebSearchResult[] }> {
  return apiFetch('/voice/web-search', {
    method: 'POST',
    body: JSON.stringify({ query, max_results: maxResults }),
  });
}

export async function transcribe(
  audioId: string,
  textHint?: string,
): Promise<{ success: boolean; audio_id: string; text: string; confidence: number }> {
  return apiFetch('/voice/transcribe', {
    method: 'POST',
    body: JSON.stringify({ audio_id: audioId, text_hint: textHint }),
  });
}

export async function synthesize(
  text: string,
): Promise<{ success: boolean; audio_id: string; text: string; duration_ms: number; format: string }> {
  return apiFetch('/voice/synthesize', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
}

// ============================================================
// Global Memory
// ============================================================

export async function getMemoryHealth(): Promise<{ status: string; module: string; stats: Record<string, number> }> {
  return apiFetch('/memory/health');
}

export async function createMemoryEntry(params: {
  project_id: string;
  category: KnowledgeCategory | string;
  content: string;
  tags?: string[];
  source?: KnowledgeSource | string;
  confidence?: number;
  metadata?: Record<string, any>;
}): Promise<{ success: boolean; entry: KnowledgeEntry }> {
  return apiFetch('/memory/entries', {
    method: 'POST',
    body: JSON.stringify({
      project_id: params.project_id,
      category: params.category,
      content: params.content,
      tags: params.tags,
      source: params.source || 'user',
      confidence: params.confidence ?? 1.0,
      metadata: params.metadata,
    }),
  });
}

export async function listMemoryEntries(params: {
  project_id?: string;
  category?: string;
  tags?: string;
  status?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; count: number; entries: KnowledgeEntry[] }> {
  const search = new URLSearchParams();
  if (params.project_id) search.set('project_id', params.project_id);
  if (params.category) search.set('category', params.category);
  if (params.tags) search.set('tags', params.tags);
  if (params.status) search.set('status', params.status);
  if (params.limit) search.set('limit', String(params.limit));
  return apiFetch(`/memory/entries?${search.toString()}`);
}

export async function getMemoryEntry(entryId: string): Promise<{ success: boolean; entry: KnowledgeEntry }> {
  return apiFetch(`/memory/entries/${encodeURIComponent(entryId)}`);
}

export async function updateMemoryEntry(
  entryId: string,
  patch: {
    content?: string;
    tags?: string[];
    category?: string;
    confidence?: number;
    status?: string;
  },
): Promise<{ success: boolean; entry: KnowledgeEntry }> {
  return apiFetch(`/memory/entries/${encodeURIComponent(entryId)}`, {
    method: 'PUT',
    body: JSON.stringify(patch),
  });
}

export async function deleteMemoryEntry(entryId: string): Promise<{ success: boolean; removed: boolean }> {
  return apiFetch(`/memory/entries/${encodeURIComponent(entryId)}`, {
    method: 'DELETE',
  });
}

export async function searchMemory(params: {
  project_id: string;
  query: string;
  top_k?: number;
  categories?: string[];
  tags?: string[];
  min_relevance?: number;
}): Promise<{ success: boolean; count: number; results: KnowledgeEntry[] }> {
  return apiFetch('/memory/search', {
    method: 'POST',
    body: JSON.stringify({
      project_id: params.project_id,
      query: params.query,
      top_k: params.top_k ?? 5,
      categories: params.categories,
      tags: params.tags,
      min_relevance: params.min_relevance ?? 0.0,
    }),
  });
}

export async function listMemoryProjects(): Promise<{ success: boolean; count: number; projects: string[] }> {
  return apiFetch('/memory/projects');
}

export async function getMemoryStats(): Promise<{ success: boolean; stats: Record<string, number> }> {
  return apiFetch('/memory/stats');
}

// ============================================================
// Video
// ============================================================

export async function getVideoHealth(): Promise<{ status: string; module: string; stats: Record<string, number> }> {
  return apiFetch('/video/health');
}

export async function uploadVideo(params: {
  file_path: string;
  file_size: number;
  uploaded_by?: string;
  title?: string;
  description?: string;
}): Promise<{ success: boolean; video: VideoMetadata }> {
  return apiFetch('/video/upload', {
    method: 'POST',
    body: JSON.stringify({
      file_path: params.file_path,
      file_size: params.file_size,
      uploaded_by: params.uploaded_by || 'web_user',
      title: params.title || '',
      description: params.description || '',
    }),
  });
}

export async function listVideos(params: {
  uploaded_by?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; count: number; videos: VideoMetadata[] }> {
  const search = new URLSearchParams();
  if (params.uploaded_by) search.set('uploaded_by', params.uploaded_by);
  if (params.limit) search.set('limit', String(params.limit));
  return apiFetch(`/video/videos?${search.toString()}`);
}

export async function getVideo(videoId: string): Promise<{ success: boolean; video: VideoMetadata }> {
  return apiFetch(`/video/videos/${encodeURIComponent(videoId)}`);
}

export async function deleteVideo(videoId: string): Promise<{
  success: boolean;
  removed: boolean;
  video_id: string;
}> {
  return apiFetch(`/video/videos/${encodeURIComponent(videoId)}`, {
    method: 'DELETE',
  });
}

export async function extractFrames(
  videoId: string,
  frameCount: number = 5,
): Promise<{ success: boolean; count: number; frames: VideoFrame[] }> {
  return apiFetch(`/video/videos/${encodeURIComponent(videoId)}/extract-frames`, {
    method: 'POST',
    body: JSON.stringify({ frame_count: frameCount }),
  });
}

export async function summarizeVideo(
  videoId: string,
  frameCount: number = 5,
  includeTranscript: boolean = true,
): Promise<{ success: boolean; summary: VideoSummary }> {
  return apiFetch(`/video/videos/${encodeURIComponent(videoId)}/summarize`, {
    method: 'POST',
    body: JSON.stringify({
      frame_count: frameCount,
      include_transcript: includeTranscript,
    }),
  });
}

export async function generateVideo(params: {
  prompt: string;
  duration?: number;
  resolution?: string;
  style?: string;
  owner?: string;
}): Promise<{ success: boolean; generation: VideoGeneration }> {
  return apiFetch('/video/generate', {
    method: 'POST',
    body: JSON.stringify({
      prompt: params.prompt,
      duration: params.duration ?? 5.0,
      resolution: params.resolution ?? '1280x720',
      style: params.style ?? 'realistic',
      owner: params.owner || 'web_user',
    }),
  });
}

export async function listGenerations(params: {
  owner?: string;
  limit?: number;
} = {}): Promise<{ success: boolean; count: number; generations: VideoGeneration[] }> {
  const search = new URLSearchParams();
  if (params.owner) search.set('owner', params.owner);
  if (params.limit) search.set('limit', String(params.limit));
  return apiFetch(`/video/generations?${search.toString()}`);
}

export async function getVideoStats(): Promise<{ success: boolean; stats: Record<string, number> }> {
  return apiFetch('/video/stats');
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

/** 格式化时长（秒 → mm:ss） */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 模板展示信息 */
export const TEMPLATE_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: 'web', label: '🌐 通用 Web 页面', description: '导航 + 英雄区 + 特性 + 页脚' },
  { value: 'mobile', label: '📱 移动端 App', description: '状态栏 + 头部 + 内容 + 标签栏' },
  { value: 'landing', label: '🚀 落地页', description: 'Hero + CTA + 评价 + 页脚' },
  { value: 'components', label: '🧩 组件库', description: '按钮/输入/徽章/提示 等组件展示' },
  { value: 'poster', label: '🎨 海报', description: '标题 + 副标题 + CTA' },
  { value: 'dashboard', label: '📊 仪表盘', description: '侧边栏 + 统计卡片 + 图表' },
];

/** 知识分类信息 */
export const CATEGORY_OPTIONS: Array<{ value: string; label: string; color: string }> = [
  { value: 'preference', label: '⚙️ 用户偏好', color: 'text-violet-600' },
  { value: 'fact', label: '📌 事实信息', color: 'text-blue-600' },
  { value: 'context', label: '🧠 上下文', color: 'text-green-600' },
  { value: 'rule', label: '📏 规则约束', color: 'text-orange-600' },
  { value: 'todo', label: '✅ 待办事项', color: 'text-pink-600' },
];

/** 视频风格信息 */
export const VIDEO_STYLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'realistic', label: '写实风格' },
  { value: 'anime', label: '动漫风格' },
  { value: 'cinematic', label: '电影质感' },
  { value: 'cartoon', label: '卡通风格' },
  { value: 'sketch', label: '素描手绘' },
];

// ============================================================
// React Hook - 统一管理 loading / error 状态
// ============================================================

export interface UseWorkApiReturn {
  loading: boolean;
  error: string | null;
  // Design
  createDesign: typeof createDraft;
  listDesigns: typeof listDrafts;
  updateDesign: typeof updateDraft;
  removeDesign: typeof deleteDraft;
  editDesignNL: typeof applyNLEdit;
  exportDesignCode: typeof exportDesign;
  // Voice
  startVoice: typeof createVoiceSession;
  listVoices: typeof listVoiceSessions;
  sendVoice: typeof sendVoiceMessage;
  endVoice: typeof closeVoiceSession;
  // Memory
  addMemory: typeof createMemoryEntry;
  listMemories: typeof listMemoryEntries;
  searchMemories: typeof searchMemory;
  removeMemory: typeof deleteMemoryEntry;
  // Video
  uploadVid: typeof uploadVideo;
  listVids: typeof listVideos;
  extractKeyFrames: typeof extractFrames;
  summarizeVid: typeof summarizeVideo;
  generateVid: typeof generateVideo;
  removeVid: typeof deleteVideo;
}

/**
 * useWorkApi - 统一的 TRAE Work API Hook
 * 提供 loading 状态 + 错误处理 + 简化的调用接口
 */
export function useWorkApi(): UseWorkApiReturn {
  const [loading] = useState(false);
  const [error] = useState<string | null>(null);

  return {
    loading,
    error,
    createDesign: createDraft,
    listDesigns: listDrafts,
    updateDesign: updateDraft,
    removeDesign: deleteDraft,
    editDesignNL: applyNLEdit,
    exportDesignCode: exportDesign,
    startVoice: createVoiceSession,
    listVoices: listVoiceSessions,
    sendVoice: sendVoiceMessage,
    endVoice: closeVoiceSession,
    addMemory: createMemoryEntry,
    listMemories: listMemoryEntries,
    searchMemories: searchMemory,
    removeMemory: deleteMemoryEntry,
    uploadVid: uploadVideo,
    listVids: listVideos,
    extractKeyFrames: extractFrames,
    summarizeVid: summarizeVideo,
    generateVid: generateVideo,
    removeVid: deleteVideo,
  };
}
