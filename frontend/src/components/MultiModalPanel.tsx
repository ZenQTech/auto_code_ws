/**
 * # ============================================================
 * # Multi-Modal Panel - 多模态处理面板 (v1.0.0 Cycle 36 G36-03)
 * # ============================================================
 * # 核心作用：图像/语音/文件多模态上传与处理
 * # 运行流程：
 * #   1. 选择模态类型（图像/语音/文件）
 * #   2. 上传文件
 * #   3. 引擎处理（压缩/转录/解析）
 * #   4. 多模态融合（可选）
 * #   5. 查看统计与历史
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 36 G36-03 初次创建
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  MultiModalProcessorImpl,
  ProcessedImage,
  ParsedDocument,
  TranscriptionResult,
  ModalityItem,
  formatBytes,
  getDefaultMultiModalProcessor,
} from '../utils/multiModalProcessor';

export interface MultiModalPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'image' | 'audio' | 'file' | 'items' | 'fuse';

const MultiModalPanel: React.FC<MultiModalPanelProps> = ({ isOpen, onClose }) => {
  const [tab, setTab] = useState<TabKey>('image');
  const [refreshKey, setRefreshKey] = useState(0);
  const [processor] = useState(() => getDefaultMultiModalProcessor());

  // 图像状态
  const [processedImage, setProcessedImage] = useState<ProcessedImage | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // 音频状态
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionResult | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const sessionRef = useRef<any>(null);
  const timerRef = useRef<number | null>(null);

  // 文件状态
  const [parsedDoc, setParsedDoc] = useState<ParsedDocument | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  // 存储列表
  const items = useMemo(() => processor.listItems(), [processor, refreshKey]);

  // 清理
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (sessionRef.current && sessionRef.current.isRecording && sessionRef.current.isRecording()) {
        sessionRef.current.cancel();
      }
    };
  }, []);

  // 图像处理
  const handleImageUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setImageError(null);
      setImageLoading(true);
      try {
        const validation = processor.validateImage(file);
        if (!validation.valid) {
          setImageError(validation.error || '验证失败');
          return;
        }
        const result = await processor.processImage(file, {
          maxWidth: 1024,
          maxHeight: 768,
          quality: 0.85,
          format: 'jpeg',
        });
        setProcessedImage(result);
        processor.addItem({
          id: result.id,
          type: 'image',
          content: result,
        });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        setImageError((err as Error).message);
      } finally {
        setImageLoading(false);
      }
    },
    [processor]
  );

  // 录音
  const handleStartRecording = useCallback(async () => {
    try {
      const session = await processor.startRecording({
        maxDurationMs: 30000,
        language: 'zh-CN',
        echoCancellation: true,
        noiseSuppression: true,
      });
      sessionRef.current = session;

      session.onLevel((level: number) => setAudioLevel(level));

      const unsubDuration = setInterval(() => {
        if (session.isRecording() || session.isPaused()) {
          setRecordingDuration(session.getDurationMs());
        }
      }, 100);

      await session.start();
      setIsRecording(true);
      setAudioBlob(null);
      setTranscription(null);
      timerRef.current = unsubDuration as unknown as number;
    } catch (err) {
      setImageError(`录音失败: ${(err as Error).message}`);
    }
  }, [processor]);

  const handleStopRecording = useCallback(async () => {
    if (!sessionRef.current) return;
    const blob = await sessionRef.current.stop();
    setIsRecording(false);
    setAudioBlob(blob);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setAudioLevel(0);

    // 自动转录（Mock）
    try {
      const result = await processor.transcribeAudio(blob, {
        language: 'zh-CN',
        mockText: `[转录] 录音时长 ${(blob.size / 16000).toFixed(1)}s 的模拟文本`,
      });
      setTranscription(result);
      processor.addItem({
        id: `audio-${Date.now()}`,
        type: 'audio',
        content: result,
      });
      setRefreshKey((k) => k + 1);
    } catch (err) {
      setImageError(`转录失败: ${(err as Error).message}`);
    }
  }, [processor]);

  const handleCancelRecording = useCallback(() => {
    if (sessionRef.current) {
      sessionRef.current.cancel();
    }
    setIsRecording(false);
    setAudioLevel(0);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // 文件处理
  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setFileError(null);
      setFileLoading(true);
      try {
        const validation = processor.validateFile(file);
        if (!validation.valid) {
          setFileError(validation.error || '验证失败');
          return;
        }
        const result = await processor.parseDocument(file);
        setParsedDoc(result);
        processor.addItem({
          id: result.id,
          type: 'file',
          content: result,
        });
        setRefreshKey((k) => k + 1);
      } catch (err) {
        setFileError((err as Error).message);
      } finally {
        setFileLoading(false);
      }
    },
    [processor]
  );

  const handleRemoveItem = useCallback(
    (id: string) => {
      processor.removeItem(id);
      if (processedImage?.id === id) setProcessedImage(null);
      if (transcription && `audio-${id}` === id) setTranscription(null);
      if (parsedDoc?.id === id) setParsedDoc(null);
      setRefreshKey((k) => k + 1);
    },
    [processor, processedImage, transcription, parsedDoc]
  );

  const handleClearAll = useCallback(() => {
    processor.clearItems();
    setProcessedImage(null);
    setTranscription(null);
    setParsedDoc(null);
    setRefreshKey((k) => k + 1);
  }, [processor]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      data-testid="multi-modal-panel"
      role="dialog"
      aria-label="Multi-Modal 面板"
    >
      <div className="bg-white rounded-xl shadow-2xl w-[950px] max-w-[95vw] h-[750px] max-h-[95vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gradient-to-r from-purple-50 to-pink-50">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🎨</span>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Multi-Modal 面板</h2>
              <p className="text-xs text-gray-600">v1.0.0 (Cycle 36 G36-03) · 图像/语音/文件多模态处理</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded transition-colors"
            data-testid="multimodal-close"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="px-6 pt-3 border-b border-gray-200 bg-white flex gap-1">
          {(['image', 'audio', 'file', 'items', 'fuse'] as TabKey[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              data-testid={`multimodal-tab-${t}`}
              className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
                tab === t
                  ? 'bg-purple-50 text-purple-700 border-b-2 border-purple-500'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t === 'image' && '🖼️ 图像'}
              {t === 'audio' && '🎤 语音'}
              {t === 'file' && '📄 文件'}
              {t === 'items' && `📦 存储 (${items.length})`}
              {t === 'fuse' && '🔗 融合'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {tab === 'image' && (
            <ImageTab
              processedImage={processedImage}
              loading={imageLoading}
              error={imageError}
              onUpload={handleImageUpload}
              onRemove={() => {
                if (processedImage) {
                  processor.removeItem(processedImage.id);
                  setProcessedImage(null);
                  setRefreshKey((k) => k + 1);
                }
              }}
            />
          )}
          {tab === 'audio' && (
            <AudioTab
              isRecording={isRecording}
              audioLevel={audioLevel}
              recordingDuration={recordingDuration}
              audioBlob={audioBlob}
              transcription={transcription}
              onStart={handleStartRecording}
              onStop={handleStopRecording}
              onCancel={handleCancelRecording}
            />
          )}
          {tab === 'file' && (
            <FileTab
              parsedDoc={parsedDoc}
              loading={fileLoading}
              error={fileError}
              onUpload={handleFileUpload}
              onRemove={() => {
                if (parsedDoc) {
                  processor.removeItem(parsedDoc.id);
                  setParsedDoc(null);
                  setRefreshKey((k) => k + 1);
                }
              }}
            />
          )}
          {tab === 'items' && (
            <ItemsTab
              items={items}
              onRemove={handleRemoveItem}
              onClearAll={handleClearAll}
            />
          )}
          {tab === 'fuse' && <FuseTab items={items} processor={processor} />}
        </div>
      </div>
    </div>
  );
};

const ImageTab: React.FC<{
  processedImage: ProcessedImage | null;
  loading: boolean;
  error: string | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}> = ({ processedImage, loading, error, onUpload, onRemove }) => {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🖼️ 上传图像</h3>
        <div className="space-y-3">
          <input
            type="file"
            accept="image/*"
            onChange={onUpload}
            disabled={loading}
            data-testid="image-upload"
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
          />
          {loading && <p className="text-xs text-blue-600">处理中...</p>}
          {error && <p className="text-xs text-red-600">❌ {error}</p>}
        </div>
      </div>

      {processedImage && (
        <div className="bg-white border border-gray-200 rounded-lg p-4" data-testid="image-result">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">处理结果</h3>
            <button
              onClick={onRemove}
              data-testid="image-remove"
              className="px-3 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
            >
              移除
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-gray-500 mb-1">原图</p>
              <p className="text-xs text-gray-700">
                {processedImage.original.width}×{processedImage.original.height} ·{' '}
                {formatBytes(processedImage.original.size)}
              </p>
              <p className="text-xs text-gray-500 mt-1">{processedImage.original.mimeType}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-1">处理后</p>
              <p className="text-xs text-gray-700">
                {processedImage.processed.width}×{processedImage.processed.height} ·{' '}
                {formatBytes(processedImage.processed.size)}
              </p>
              <p className="text-xs text-gray-500 mt-1">{processedImage.processed.format}</p>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-1">预览</p>
            <img
              src={processedImage.processed.dataUrl}
              alt="Processed"
              className="max-w-full h-auto max-h-64 rounded border border-gray-200"
            />
          </div>
          <div className="mt-3 text-xs text-gray-500">
            压缩率: {((1 - processedImage.processed.size / processedImage.original.size) * 100).toFixed(1)}%
          </div>
        </div>
      )}
    </div>
  );
};

const AudioTab: React.FC<{
  isRecording: boolean;
  audioLevel: number;
  recordingDuration: number;
  audioBlob: Blob | null;
  transcription: TranscriptionResult | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
}> = ({ isRecording, audioLevel, recordingDuration, audioBlob, transcription, onStart, onStop, onCancel }) => {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🎤 语音录制</h3>
        <div className="space-y-3">
          {!isRecording ? (
            <button
              onClick={onStart}
              data-testid="start-recording"
              className="px-4 py-2 text-sm bg-red-500 text-white rounded hover:bg-red-600"
            >
              🔴 开始录音
            </button>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <button
                  onClick={onStop}
                  data-testid="stop-recording"
                  className="px-4 py-2 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                >
                  ⏹ 停止并转录
                </button>
                <button
                  onClick={onCancel}
                  data-testid="cancel-recording"
                  className="px-4 py-2 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                >
                  取消
                </button>
                <span className="text-xs text-gray-600" data-testid="recording-duration">
                  {(recordingDuration / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-400 to-red-500 transition-all"
                    style={{ width: `${Math.min(100, audioLevel * 100)}%` }}
                    data-testid="audio-level"
                  />
                </div>
                <span className="text-xs text-gray-500 w-12">
                  {Math.round(audioLevel * 100)}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {transcription && (
        <div className="bg-white border border-gray-200 rounded-lg p-4" data-testid="transcription-result">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">📝 转录结果</h3>
          <p className="text-sm text-gray-800 bg-gray-50 p-3 rounded">{transcription.text}</p>
          <div className="mt-2 text-xs text-gray-500">
            时长: {(transcription.durationMs / 1000).toFixed(1)}s · 置信度: {(transcription.confidence * 100).toFixed(0)}% · 语言: {transcription.language}
          </div>
        </div>
      )}

      {audioBlob && (
        <div className="text-xs text-gray-500">
          音频 Blob: {formatBytes(audioBlob.size)} ({audioBlob.type})
        </div>
      )}
    </div>
  );
};

const FileTab: React.FC<{
  parsedDoc: ParsedDocument | null;
  loading: boolean;
  error: string | null;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}> = ({ parsedDoc, loading, error, onUpload, onRemove }) => {
  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">📄 上传文件</h3>
        <input
          type="file"
          accept=".pdf,.docx,.txt,.md,.ts,.tsx,.js,.py,.java,.json,.yaml,.yml"
          onChange={onUpload}
          disabled={loading}
          data-testid="file-upload"
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-medium file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100"
        />
        {loading && <p className="text-xs text-blue-600 mt-2">解析中...</p>}
        {error && <p className="text-xs text-red-600 mt-2">❌ {error}</p>}
      </div>

      {parsedDoc && (
        <div className="bg-white border border-gray-200 rounded-lg p-4" data-testid="file-result">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">解析结果</h3>
            <button
              onClick={onRemove}
              data-testid="file-remove"
              className="px-3 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
            >
              移除
            </button>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs mb-3">
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">文件名</div>
              <div className="font-mono truncate">{parsedDoc.filename}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">类型</div>
              <div className="font-mono">{parsedDoc.type}</div>
            </div>
            <div className="bg-gray-50 rounded p-2">
              <div className="text-gray-500">大小</div>
              <div className="font-mono">{formatBytes(parsedDoc.size)}</div>
            </div>
          </div>
          {parsedDoc.language && (
            <div className="text-xs text-gray-500 mb-2">语言: {parsedDoc.language}</div>
          )}
          <pre className="bg-gray-50 rounded p-3 text-xs text-gray-800 max-h-64 overflow-auto whitespace-pre-wrap">
            {parsedDoc.content.slice(0, 2000)}
            {parsedDoc.content.length > 2000 && '\n... (truncated)'}
          </pre>
        </div>
      )}
    </div>
  );
};

const ItemsTab: React.FC<{
  items: ModalityItem[];
  onRemove: (id: string) => void;
  onClearAll: () => void;
}> = ({ items, onRemove, onClearAll }) => {
  if (items.length === 0) {
    return (
      <div className="text-center text-gray-400 text-sm py-12">
        <p>📦 暂无存储项</p>
        <p className="text-xs mt-1">在图像/语音/文件标签页上传文件</p>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-700">存储项 ({items.length})</h3>
        <button
          onClick={onClearAll}
          data-testid="clear-all-items"
          className="px-3 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100"
        >
          清空全部
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const typeIcon: Record<string, string> = {
            text: '📝',
            image: '🖼️',
            audio: '🎤',
            file: '📄',
          };
          return (
            <div
              key={item.id}
              className="bg-white border border-gray-200 rounded-lg p-3 flex items-center justify-between"
              data-testid={`item-${item.id}`}
            >
              <div className="flex items-center gap-2">
                <span>{typeIcon[item.type] || '❓'}</span>
                <div>
                  <div className="text-sm font-medium">
                    {item.type === 'text' && (item.content as string).slice(0, 60)}
                    {item.type === 'image' && `${(item.content as ProcessedImage).processed.width}×${(item.content as ProcessedImage).processed.height}`}
                    {item.type === 'audio' && `${((item.content as TranscriptionResult).durationMs / 1000).toFixed(1)}s audio`}
                    {item.type === 'file' && (item.content as ParsedDocument).filename}
                  </div>
                  <div className="text-xs text-gray-500 font-mono">{item.id}</div>
                </div>
              </div>
              <button
                onClick={() => onRemove(item.id)}
                className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                data-testid={`item-remove-${item.id}`}
              >
                删除
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FuseTab: React.FC<{ items: ModalityItem[]; processor: MultiModalProcessorImpl }> = ({
  items,
  processor,
}) => {
  const [fused, setFused] = useState<any>(null);

  const handleFuse = useCallback(async () => {
    if (items.length === 0) return;
    const result = await processor.fuseModalities(items);
    setFused(result);
  }, [items, processor]);

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">🔗 多模态融合</h3>
        <p className="text-xs text-gray-600 mb-3">
          将所有存储项融合为统一的多模态消息，可发送给 LLM
        </p>
        <button
          onClick={handleFuse}
          disabled={items.length === 0}
          data-testid="fuse-button"
          className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
        >
          🔗 融合 {items.length} 项
        </button>
      </div>

      {fused && (
        <div className="bg-white border border-gray-200 rounded-lg p-4" data-testid="fuse-result">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">融合结果</h3>
          <div className="space-y-2 text-xs">
            <div className="bg-gray-50 rounded p-2">
              <span className="text-gray-500">项目数:</span> {fused.metadata.itemCount}
            </div>
            <div className="bg-gray-50 rounded p-2">
              <span className="text-gray-500">总 Tokens (估算):</span> {fused.metadata.totalTokens}
            </div>
            <div className="bg-gray-50 rounded p-2">
              <span className="text-gray-500">图像:</span> {fused.combined.images.length}
            </div>
            <div className="bg-gray-50 rounded p-2">
              <span className="text-gray-500">文件:</span> {fused.combined.files.length}
            </div>
            {fused.combined.audio && (
              <div className="bg-gray-50 rounded p-2">
                <span className="text-gray-500">音频:</span> ✓
              </div>
            )}
            {fused.combined.text && (
              <div className="bg-gray-50 rounded p-2">
                <span className="text-gray-500">文本:</span>
                <div className="mt-1 text-gray-800 whitespace-pre-wrap">
                  {fused.combined.text}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiModalPanel;
