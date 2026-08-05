/**
 * # ============================================================
 * # MultimodalInputPanel - 多模态输入面板 (v1.0.0)
 * # Cycle 69 G69-03
 * # ====================================
 * # 核心作用：整合语音输入 + 图片上传 + 截图工具的多模态输入 UI
 * # 设计要点：
 * #   1. 语音输入：麦克风按钮 + 实时显示识别结果
 * #   2. 图片上传：拖拽 + 选择 + 剪贴板粘贴
 * #   3. 截图工具：整页/区域/元素截图
 * #   4. 多模态消息构造：文本 + 图片组合
 * #   5. 发送到后端 /api/multimodal-chat/chat
 * # 输入参数：可选 onSend 回调
 * # 输出结果：UI 组件
 * # 对标：Trae SOLO Multimodal Input
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 69 G69-03 初次创建
 * # ====================================
 */

import React, { useCallback, useState } from 'react';
import { useVoiceInput, SUPPORTED_LANGUAGES, type VoiceLanguage } from '../hooks/useVoiceInput';
import { useImageUpload } from '../hooks/useImageUpload';
import { useScreenshot } from '../hooks/useScreenshot';

// ============================================================
// 类型
// ============================================================

export interface MultimodalInputPanelProps {
  testId?: string;
  onSend?: (payload: { text: string; images: string[] }) => void;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: string };
}

// ============================================================
// 主组件
// ============================================================

export const MultimodalInputPanel: React.FC<MultimodalInputPanelProps> = ({
  testId = 'multimodal-input-panel',
  onSend,
}) => {
  const [text, setText] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [language, setLanguage] = useState<VoiceLanguage>('zh-CN');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<string>('');

  // Voice
  const voice = useVoiceInput({
    language,
    onFinal: (t) => {
      setText((prev) => (prev ? `${prev} ${t}` : t));
    },
  });

  // Image
  const imageUpload = useImageUpload({
    onUpload: (result) => {
      setImages((prev) => [...prev, result.dataUrl]);
    },
  });

  // Screenshot
  const screenshot = useScreenshot({
    onCapture: (dataUrl) => {
      setImages((prev) => [...prev, dataUrl]);
    },
  });

  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = useCallback(async () => {
    if (!text.trim() && images.length === 0) return;
    setSending(true);
    setResponse('');

    const content: ContentPart[] = [];
    if (text.trim()) {
      content.push({ type: 'text', text: text.trim() });
    }
    images.forEach((img) => {
      content.push({ type: 'image_url', image_url: { url: img, detail: 'auto' } });
    });

    try {
      const resp = await fetch('/api/multimodal-chat/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ role: 'user', content }],
          model: 'mock-multimodal',
        }),
      });
      const data: ApiResponse<{ content: string }> = await resp.json();
      if (data.success && data.data) {
        setResponse(data.data.content);
        onSend?.({ text, images });
        setText('');
        setImages([]);
      } else {
        setResponse(`Error: ${data.error || 'unknown'}`);
      }
    } catch (e) {
      setResponse(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSending(false);
    }
  }, [text, images, onSend]);

  return (
    <div
      className="p-3 h-full overflow-auto"
      data-testid={testId}
      onPaste={(e) => {
        const handler = imageUpload.handlePaste(e.nativeEvent as unknown as ClipboardEvent);
        handler.then((result) => {
          if (result) {
            // hook already added
          }
        });
      }}
    >
      <h3 className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
        🎙️ 多模态输入
      </h3>

      {/* 语音控制 */}
      <div className="mb-3 p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="flex items-center gap-2 mb-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as VoiceLanguage)}
            className="px-2 py-1 text-xs rounded bg-[var(--bg-app)] border border-[var(--border-color)]"
            data-testid={`${testId}-language-select`}
          >
            {Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
          {!voice.isListening ? (
            <button
              onClick={voice.start}
              disabled={!voice.supported}
              className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid={`${testId}-voice-start`}
              title={voice.supported ? '开始语音输入' : '浏览器不支持 Web Speech API'}
            >
              🎤 开始
            </button>
          ) : (
            <button
              onClick={voice.stop}
              className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 animate-pulse"
              data-testid={`${testId}-voice-stop`}
            >
              ⏹ 停止
            </button>
          )}
          <button
            onClick={voice.reset}
            className="px-2 py-1 text-xs bg-gray-500 text-white rounded hover:bg-gray-600"
            data-testid={`${testId}-voice-reset`}
          >
            🗑
          </button>
        </div>
        {(voice.transcript || voice.interimTranscript) && (
          <div
            className="p-2 text-xs rounded bg-[var(--bg-app)] border border-[var(--border-color)]"
            data-testid={`${testId}-voice-display`}
          >
            <span>{voice.transcript}</span>
            <span className="text-[var(--text-tertiary)] italic">{voice.interimTranscript}</span>
          </div>
        )}
        {voice.error && (
          <div className="mt-1 text-[10px] text-red-400" data-testid={`${testId}-voice-error`}>
            {voice.error}
          </div>
        )}
      </div>

      {/* 文本输入 */}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="输入文本消息..."
        rows={3}
        className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-[var(--text-primary)] resize-none mb-2"
        data-testid={`${testId}-text-input`}
      />

      {/* 图片 + 截图 */}
      <div className="mb-2 flex items-center gap-2">
        <label className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 cursor-pointer">
          📷 上传图片
          <input
            type="file"
            accept="image/*"
            className="hidden"
            data-testid={`${testId}-image-input`}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) {
                await imageUpload.upload(file);
                e.target.value = '';
              }
            }}
          />
        </label>
        <button
          onClick={async () => {
            await screenshot.capture();
          }}
          disabled={screenshot.isCapturing}
          className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
          data-testid={`${testId}-screenshot-btn`}
        >
          📸 {screenshot.isCapturing ? '截图中...' : '截图'}
        </button>
        {imageUpload.isUploading && (
          <span className="text-[10px] text-[var(--text-tertiary)]">上传中...</span>
        )}
      </div>

      {/* 图片预览 */}
      {images.length > 0 && (
        <div
          className="mb-2 grid grid-cols-3 gap-1 p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]"
          data-testid={`${testId}-image-preview`}
        >
          {images.map((img, idx) => (
            <div key={idx} className="relative group">
              <img
                src={img}
                alt={`upload-${idx}`}
                className="w-full h-16 object-cover rounded"
              />
              <button
                onClick={() => removeImage(idx)}
                className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] rounded-full opacity-0 group-hover:opacity-100"
                data-testid={`${testId}-remove-image-${idx}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 发送按钮 */}
      <button
        onClick={handleSend}
        disabled={sending || (!text.trim() && images.length === 0)}
        className="w-full px-3 py-2 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50 disabled:cursor-not-allowed mb-3"
        data-testid={`${testId}-send-btn`}
      >
        {sending ? '发送中...' : '🚀 发送多模态消息'}
      </button>

      {/* 响应 */}
      {response && (
        <div
          className="p-2 rounded bg-[var(--bg-elevated)] border border-[var(--border-color)] text-xs whitespace-pre-wrap"
          data-testid={`${testId}-response`}
        >
          {response}
        </div>
      )}
    </div>
  );
};

export default MultimodalInputPanel;
