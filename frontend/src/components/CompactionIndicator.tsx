/**
 * # ============================================================
 * 压缩指示器组件 + 压缩按钮
 * # ============================================================
 * 核心作用：显示当前会话 token 使用情况 + 触发压缩
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getSessionTokens, compactSession, shouldCompactSession, CompactionConfig } from '../hooks/useCycle2Api';

export interface CompactionIndicatorProps {
  sessionId: string | null;
  onCompacted?: () => void;
}

export const CompactionIndicator: React.FC<CompactionIndicatorProps> = ({
  sessionId,
  onCompacted,
}) => {
  const [tokens, setTokens] = useState(0);
  const [messageCount, setMessageCount] = useState(0);
  const [compactedCount, setCompactedCount] = useState(0);
  const [, setLoading] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [shouldCompact, setShouldCompact] = useState(false);
  const [config, setConfig] = useState<CompactionConfig | null>(null);
  const [lastResult, setLastResult] = useState<string>('');

  const refresh = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const data = await getSessionTokens(sessionId);
      setTokens(data.token_count);
      setMessageCount(data.message_count);
      setCompactedCount(data.compacted_count);
      const shouldData = await shouldCompactSession(sessionId);
      setShouldCompact(shouldData.should_compact);
      setConfig(shouldData.config);
    } catch (e) {
      console.error('获取压缩状态失败:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleCompact = async () => {
    if (!sessionId) return;
    setCompacting(true);
    setLastResult('');
    try {
      const result = await compactSession(sessionId, 'hybrid');
      if (result.success) {
        setLastResult(
          `压缩成功: ${result.before?.token_count || 0} → ${result.after?.token_count || 0} tokens, 压缩了 ${result.compacted_count} 条消息`
        );
        onCompacted?.();
        await refresh();
      } else {
        setLastResult(`压缩失败: ${result.error || '未知错误'}`);
      }
    } catch (e: any) {
      setLastResult(`压缩失败: ${e.message || '未知错误'}`);
    } finally {
      setCompacting(false);
    }
  };

  if (!sessionId) {
    return null;
  }

  const tokenPercent = config ? Math.min(100, (tokens / config.max_tokens) * 100) : 0;
  const messagePercent = config ? Math.min(100, (messageCount / config.max_messages) * 100) : 0;
  const maxPercent = Math.max(tokenPercent, messagePercent);

  const getStatusColor = () => {
    if (maxPercent > 80) return 'text-red-600';
    if (maxPercent > 50) return 'text-yellow-600';
    return 'text-green-600';
  };

  return (
    <div className="compaction-indicator bg-white border rounded-lg p-3 text-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">📦</span>
          <span className="font-medium">会话压缩</span>
        </div>
        <button
          onClick={handleCompact}
          disabled={compacting || messageCount === 0}
          className={`text-xs px-2 py-1 rounded ${
            shouldCompact
              ? 'bg-orange-500 text-white hover:bg-orange-600'
              : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
          } disabled:opacity-50`}
        >
          {compacting ? '压缩中...' : shouldCompact ? '⚠️ 立即压缩' : '压缩历史'}
        </button>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">Token 使用</span>
          <span className={`font-mono ${getStatusColor()}`}>
            {tokens.toLocaleString()} / {config?.max_tokens.toLocaleString() || '?'}
          </span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
          <div
            className={`h-full transition-all ${
              tokenPercent > 80 ? 'bg-red-500' : tokenPercent > 50 ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${tokenPercent}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-600">消息数</span>
          <span className="font-mono">
            {messageCount} / {config?.max_messages || '?'}
          </span>
        </div>
        <div className="h-1.5 bg-gray-200 rounded overflow-hidden">
          <div
            className={`h-full transition-all ${
              messagePercent > 80 ? 'bg-red-500' : messagePercent > 50 ? 'bg-yellow-500' : 'bg-blue-500'
            }`}
            style={{ width: `${messagePercent}%` }}
          />
        </div>

        {compactedCount > 0 && (
          <div className="text-xs text-gray-500 mt-1">
            ✅ 已压缩 {compactedCount} 条历史消息
          </div>
        )}
      </div>

      {lastResult && (
        <div className="mt-2 text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded">
          {lastResult}
        </div>
      )}
    </div>
  );
};

export default CompactionIndicator;
