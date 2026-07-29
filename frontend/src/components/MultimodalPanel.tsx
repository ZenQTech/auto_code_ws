/**
 * # ============================================================
 * # MultimodalPanel - 多模态支持主面板
 * # ============================================================
 * # 核心作用：提供多模态（图像/音频）的上传、分析、对话 UI
 * # 包含：媒体上传区、媒体库、Vision 分析面板、Audio 分析面板、对话区
 * # 运行流程：
 * #   1. 用户选择文件（图像/音频）上传
 * #   2. 上传成功后显示缩略图/波形
 * #   3. 点击"分析"按钮调用 Vision/Audio 分析
 * #   4. 分析结果可视化展示
 * #   5. 用户输入文字 + 选择媒体发送多模态消息
 * #   6. 显示助手回复
 * # 输入参数：useMultimodalApi 提供 API 调用，props.onClose 关闭回调
 * # 输出结果：完整的多模态交互界面
 * # 修改记录：
 * #   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
 * # ============================================================
 */

import React, { useEffect, useRef, useState } from 'react';
import {
  useMultimodalApi,
  type MediaItem,
  type VisionAnalysis,
  type AudioAnalysis,
  type MultimodalMessage,
  type MultimodalStats,
  formatFileSize,
  formatDuration,
  getSentimentColor,
  getMediaTypeIcon,
  getStats,
  listMedia,
  visionAnalyze,
  audioAnalyze,
  listMessages,
  chatSend,
  deleteMedia,
} from '../hooks/useMultimodalApi';

interface MultimodalPanelProps {
  onClose?: () => void;
  defaultUser?: string;
  defaultSession?: string;
}

type ViewMode = 'upload' | 'library' | 'chat';

export const MultimodalPanel: React.FC<MultimodalPanelProps> = ({
  onClose,
  defaultUser = 'web_user',
  defaultSession = 'web_session_1',
}) => {
  const api = useMultimodalApi();
  const [view, setView] = useState<ViewMode>('upload');
  const [stats, setStats] = useState<MultimodalStats | null>(null);
  const [mediaList, setMediaList] = useState<MediaItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [visionResult, setVisionResult] = useState<VisionAnalysis | null>(null);
  const [audioResult, setAudioResult] = useState<AudioAnalysis | null>(null);
  const [chatText, setChatText] = useState('');
  const [chatMediaIds, setChatMediaIds] = useState<string[]>([]);
  const [chatMessages, setChatMessages] = useState<MultimodalMessage[]>([]);
  const [uploadingType, setUploadingType] = useState<'' | 'image' | 'audio'>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 加载统计
  const refreshStats = async () => {
    try {
      const r = await getStats();
      if (r.success) setStats(r.stats);
    } catch (e) {
      console.error('Failed to load stats:', e);
    }
  };

  // 加载媒体列表
  const refreshMedia = async () => {
    try {
      const r = await listMedia({ limit: 50 });
      if (r.success) setMediaList(r.media);
    } catch (e) {
      console.error('Failed to load media:', e);
    }
  };

  // 加载会话消息
  const refreshChat = async () => {
    try {
      const r = await listMessages(defaultSession, 50);
      if (r.success) setChatMessages(r.messages);
    } catch (e) {
      console.error('Failed to load messages:', e);
    }
  };

  useEffect(() => {
    refreshStats();
    refreshMedia();
    refreshChat();
  }, []);

  // 上传文件
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isAudio = file.type.startsWith('audio/');
    if (!isImage && !isAudio) {
      alert('请上传图像或音频文件');
      return;
    }

    setUploadingType(isImage ? 'image' : 'audio');
    try {
      const result = isImage
        ? await api.uploadImage(file, defaultUser, defaultSession)
        : await api.uploadAudio(file, defaultUser, defaultSession);
      if (result) {
        await refreshStats();
        await refreshMedia();
        setSelectedMedia(result);
      } else {
        alert(api.error || '上传失败');
      }
    } finally {
      setUploadingType('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Vision 分析
  const handleVisionAnalyze = async (type: 'full' | 'ocr' | 'objects' | 'ui' = 'full') => {
    if (!selectedMedia) return;
    try {
      const r = await visionAnalyze(selectedMedia.media_id, type);
      if (r.success) {
        setVisionResult(r.analysis);
        setAudioResult(null);
        await refreshStats();
      } else {
        alert('分析失败');
      }
    } catch (e: any) {
      alert(`分析失败: ${e.message}`);
    }
  };

  // Audio 分析
  const handleAudioAnalyze = async () => {
    if (!selectedMedia) return;
    try {
      const r = await audioAnalyze(selectedMedia.media_id);
      if (r.success) {
        setAudioResult(r.analysis);
        setVisionResult(null);
        await refreshStats();
      } else {
        alert('分析失败');
      }
    } catch (e: any) {
      alert(`分析失败: ${e.message}`);
    }
  };

  // 发送消息
  const handleSendChat = async () => {
    if (!chatText.trim() && chatMediaIds.length === 0) return;
    try {
      const r = await chatSend(
        defaultSession,
        chatText.trim() || null,
        chatMediaIds,
        defaultUser,
      );
      if (r.success) {
        setChatText('');
        setChatMediaIds([]);
        await refreshChat();
        await refreshStats();
      } else {
        alert('发送失败');
      }
    } catch (e: any) {
      alert(`发送失败: ${e.message}`);
    }
  };

  // 删除媒体
  const handleDeleteMedia = async (media: MediaItem) => {
    if (!confirm(`确定删除 ${media.media_id}?`)) return;
    try {
      await deleteMedia(media.media_id, defaultUser);
      if (selectedMedia?.media_id === media.media_id) {
        setSelectedMedia(null);
        setVisionResult(null);
        setAudioResult(null);
      }
      await refreshMedia();
      await refreshStats();
    } catch (e: any) {
      alert(`删除失败: ${e.message}`);
    }
  };

  // 切换媒体选择（用于多模态消息）
  const toggleMediaForChat = (mediaId: string) => {
    setChatMediaIds((prev) =>
      prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId],
    );
  };

  return (
    <div className="flex flex-col h-full bg-surface-100 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-surface-300/50 bg-gradient-to-r from-violet-500/10 to-fuchsia-500/10">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎨</span>
          <div>
            <h2 className="text-lg font-semibold text-surface-800">多模态支持</h2>
            <p className="text-xs text-surface-500">Vision + Audio 智能分析</p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-surface-300/50 flex items-center justify-center text-surface-600"
            aria-label="关闭"
          >
            ✕
          </button>
        )}
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="px-5 py-2 bg-surface-200/30 border-b border-surface-300/30 flex items-center gap-4 text-xs">
          <span className="text-surface-600">📊 媒体: <b>{stats.total_media}</b></span>
          <span className="text-surface-600">🖼️ 图像: <b>{stats.image_count}</b></span>
          <span className="text-surface-600">🎵 音频: <b>{stats.audio_count}</b></span>
          <span className="text-surface-600">💬 消息: <b>{stats.messages}</b></span>
          <span className="text-surface-600 ml-auto">💾 {formatFileSize(stats.total_size_bytes)}</span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-surface-300/30 bg-surface-100">
        {(['upload', 'library', 'chat'] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
              view === v
                ? 'text-violet-600 border-b-2 border-violet-500 bg-violet-50/50'
                : 'text-surface-600 hover:text-surface-800 hover:bg-surface-200/30'
            }`}
          >
            {v === 'upload' && '📤 上传分析'}
            {v === 'library' && '📁 媒体库'}
            {v === 'chat' && '💬 多模态对话'}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {view === 'upload' && (
          <div className="space-y-4">
            {/* Upload Area */}
            <div className="border-2 border-dashed border-surface-300/70 rounded-xl p-8 text-center bg-surface-200/20">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,audio/*"
                onChange={handleFileUpload}
                className="hidden"
                id="mm-file-upload"
              />
              <label
                htmlFor="mm-file-upload"
                className="cursor-pointer flex flex-col items-center gap-2"
              >
                <div className="text-5xl">📎</div>
                <div className="text-sm font-medium text-surface-700">
                  点击或拖拽上传
                </div>
                <div className="text-xs text-surface-500">
                  支持 PNG / JPG / WebP / GIF · WAV / MP3 / OGG
                </div>
                <div className="text-xs text-surface-400">
                  图像 ≤ 10MB · 音频 ≤ 50MB
                </div>
              </label>
              {uploadingType && (
                <div className="mt-3 text-sm text-violet-600">
                  上传中... ({uploadingType})
                </div>
              )}
            </div>

            {/* Selected Media */}
            {selectedMedia && (
              <div className="bg-white rounded-xl border border-surface-300/50 p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-surface-800">
                      {getMediaTypeIcon(selectedMedia.type)} 已选择: {selectedMedia.media_id}
                    </h3>
                    <p className="text-xs text-surface-500 mt-1">
                      {selectedMedia.mime_type} · {formatFileSize(selectedMedia.file_size)}
                      {selectedMedia.width && ` · ${selectedMedia.width}×${selectedMedia.height}`}
                      {selectedMedia.duration && ` · ${formatDuration(selectedMedia.duration)}`}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      setSelectedMedia(null);
                      setVisionResult(null);
                      setAudioResult(null);
                    }}
                    className="text-xs text-surface-500 hover:text-surface-700"
                  >
                    清除
                  </button>
                </div>

                {selectedMedia.type === 'image' && selectedMedia.thumbnail_path && (
                  <div className="bg-surface-200/30 rounded-lg p-4 mb-3 text-center">
                    <div className="text-6xl">🖼️</div>
                    <div className="text-xs text-surface-500 mt-2">
                      缩略图: {selectedMedia.thumbnail_path}
                    </div>
                  </div>
                )}

                {selectedMedia.type === 'audio' && (
                  <div className="bg-surface-200/30 rounded-lg p-4 mb-3">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">🎵</span>
                      <div className="flex-1">
                        <div className="text-sm text-surface-700">音频文件</div>
                        <div className="flex items-end gap-0.5 mt-2 h-8">
                          {Array.from({ length: 30 }).map((_, i) => (
                            <div
                              key={i}
                              className="flex-1 bg-violet-400 rounded"
                              style={{ height: `${20 + Math.sin(i * 0.5) * 15}px` }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Analysis Buttons */}
                <div className="flex flex-wrap gap-2">
                  {selectedMedia.type === 'image' ? (
                    <>
                      <button
                        onClick={() => handleVisionAnalyze('full')}
                        className="px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-medium"
                      >
                        🔍 完整分析
                      </button>
                      <button
                        onClick={() => handleVisionAnalyze('ocr')}
                        className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm font-medium"
                      >
                        📝 OCR
                      </button>
                      <button
                        onClick={() => handleVisionAnalyze('objects')}
                        className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium"
                      >
                        🎯 对象检测
                      </button>
                      <button
                        onClick={() => handleVisionAnalyze('ui')}
                        className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium"
                      >
                        🧩 UI 元素
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleAudioAnalyze}
                      className="px-3 py-1.5 bg-violet-500 hover:bg-violet-600 text-white rounded-lg text-sm font-medium"
                    >
                      🎤 转写分析
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Vision Result */}
            {visionResult && (
              <div className="bg-white rounded-xl border border-violet-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-violet-700">🔍 Vision 分析结果</h3>
                  <span className="text-xs text-surface-500">
                    置信度: {(visionResult.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-sm text-surface-700 mb-3">
                  {visionResult.description}
                </div>
                {visionResult.ocr_text && (
                  <div className="mb-3">
                    <div className="text-xs font-medium text-surface-600 mb-1">OCR 文本:</div>
                    <div className="bg-surface-200/30 rounded-lg p-2 text-sm font-mono text-surface-800">
                      {visionResult.ocr_text}
                    </div>
                  </div>
                )}
                {visionResult.detected_objects.length > 0 && (
                  <div className="mb-3">
                    <div className="text-xs font-medium text-surface-600 mb-1">检测对象:</div>
                    <div className="flex flex-wrap gap-1">
                      {visionResult.detected_objects.map((obj, i) => (
                        <span
                          key={i}
                          className="px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs"
                        >
                          {obj.label} ({(obj.confidence * 100).toFixed(0)}%)
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {visionResult.ui_elements.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-surface-600 mb-1">UI 元素:</div>
                    <div className="space-y-1">
                      {visionResult.ui_elements.map((elem, i) => (
                        <div
                          key={i}
                          className="text-xs bg-amber-50 border border-amber-200 rounded px-2 py-1"
                        >
                          <b>{elem.type}</b>: {elem.label}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Audio Result */}
            {audioResult && (
              <div className="bg-white rounded-xl border border-fuchsia-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-fuchsia-700">🎤 Audio 分析结果</h3>
                  <span className="text-xs text-surface-500">
                    {audioResult.language} · 置信度 {(audioResult.confidence * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="mb-3">
                  <div className="text-xs font-medium text-surface-600 mb-1">转写:</div>
                  <div className="bg-surface-200/30 rounded-lg p-3 text-sm text-surface-800">
                    {audioResult.transcript || '(无内容)'}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-surface-600 mb-3">
                  <span>情感: <b className={getSentimentColor(audioResult.sentiment)}>{audioResult.sentiment}</b></span>
                  <span>时长: {formatDuration(audioResult.duration)}</span>
                </div>
                {audioResult.key_segments.length > 0 && (
                  <div>
                    <div className="text-xs font-medium text-surface-600 mb-1">关键片段:</div>
                    <div className="space-y-1">
                      {audioResult.key_segments.map((seg, i) => (
                        <div
                          key={i}
                          className="text-xs bg-fuchsia-50 border border-fuchsia-200 rounded px-2 py-1 flex items-center gap-2"
                        >
                          <span className="font-mono text-fuchsia-600">
                            {formatDuration(seg.start)}-{formatDuration(seg.end)}
                          </span>
                          <span className="text-surface-800">{seg.text}</span>
                          <div className="ml-auto w-12 h-1.5 bg-surface-200 rounded overflow-hidden">
                            <div
                              className="h-full bg-fuchsia-400"
                              style={{ width: `${seg.energy * 100}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {view === 'library' && (
          <div className="space-y-2">
            <div className="text-sm text-surface-600 mb-2">
              共 {mediaList.length} 个媒体
            </div>
            {mediaList.length === 0 ? (
              <div className="text-center text-surface-500 py-12">
                <div className="text-5xl mb-2">📂</div>
                <div>暂无媒体</div>
                <div className="text-xs mt-1">请先上传文件</div>
              </div>
            ) : (
              mediaList.map((m) => (
                <div
                  key={m.media_id}
                  className={`bg-white rounded-lg border p-3 flex items-center gap-3 ${
                    selectedMedia?.media_id === m.media_id
                      ? 'border-violet-400 ring-2 ring-violet-200'
                      : 'border-surface-300/50'
                  }`}
                >
                  <div className="text-3xl">{getMediaTypeIcon(m.type)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-surface-800 truncate">
                      {m.media_id}
                    </div>
                    <div className="text-xs text-surface-500">
                      {m.mime_type} · {formatFileSize(m.file_size)}
                      {m.width && ` · ${m.width}×${m.height}`}
                      {m.duration && ` · ${formatDuration(m.duration)}`}
                    </div>
                    <div className="text-xs text-surface-400">{m.uploaded_at}</div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setSelectedMedia(m)}
                      className="px-2 py-1 bg-violet-100 hover:bg-violet-200 text-violet-700 rounded text-xs"
                    >
                      选择
                    </button>
                    <button
                      onClick={() => toggleMediaForChat(m.media_id)}
                      className={`px-2 py-1 rounded text-xs ${
                        chatMediaIds.includes(m.media_id)
                          ? 'bg-emerald-500 text-white'
                          : 'bg-surface-200 hover:bg-surface-300 text-surface-700'
                      }`}
                    >
                      {chatMediaIds.includes(m.media_id) ? '✓ 已选' : '+ 对话'}
                    </button>
                    <button
                      onClick={() => handleDeleteMedia(m)}
                      className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {view === 'chat' && (
          <div className="flex flex-col h-full">
            {/* Messages */}
            <div className="flex-1 space-y-2 overflow-y-auto mb-3">
              {chatMessages.length === 0 ? (
                <div className="text-center text-surface-500 py-12">
                  <div className="text-5xl mb-2">💬</div>
                  <div>暂无消息</div>
                </div>
              ) : (
                chatMessages.map((msg) => (
                  <div
                    key={msg.message_id}
                    className={`flex ${
                      msg.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                  >
                    <div
                      className={`max-w-[80%] rounded-2xl px-3 py-2 ${
                        msg.role === 'user'
                          ? 'bg-violet-500 text-white'
                          : 'bg-white border border-surface-300/50 text-surface-800'
                      }`}
                    >
                      <div className="text-xs opacity-70 mb-1">
                        {msg.role === 'user' ? '👤 用户' : '🤖 助手'} · {msg.created_at.split('T')[1]?.slice(0, 8)}
                      </div>
                      {msg.text_content && (
                        <div className="text-sm whitespace-pre-wrap">
                          {msg.text_content}
                        </div>
                      )}
                      {msg.media_items.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {msg.media_items.map((mid) => (
                            <span
                              key={mid}
                              className="px-1.5 py-0.5 bg-black/20 rounded text-xs"
                            >
                              📎 {mid.slice(-6)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Input */}
            <div className="border-t border-surface-300/30 pt-3">
              {chatMediaIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {chatMediaIds.map((id) => (
                    <span
                      key={id}
                      className="px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-xs flex items-center gap-1"
                    >
                      📎 {id.slice(-6)}
                      <button
                        onClick={() => toggleMediaForChat(id)}
                        className="ml-1 hover:text-violet-900"
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendChat()}
                  placeholder="输入消息，可附加媒体（从媒体库选择）"
                  className="flex-1 px-3 py-2 bg-white border border-surface-300/50 rounded-xl text-sm focus:outline-none focus:border-violet-500"
                />
                <button
                  onClick={handleSendChat}
                  disabled={!chatText.trim() && chatMediaIds.length === 0}
                  className="px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:bg-surface-300 text-white rounded-xl text-sm font-medium"
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MultimodalPanel;
