/**
 * # ============================================================
 * AGENTS.md 记忆管理面板内容组件 - Cycle 2 辅助组件
 * # ============================================================
 * 核心作用：在弹窗中显示项目 AGENTS.md 列表，支持扫描/启用/禁用
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useState } from 'react';
import { useAgentsMd, type AgentsMemory } from '../hooks/useCycle2Api';

interface AgentsMdPanelContentProps {
  onClose?: () => void;
}

export const AgentsMdPanelContent: React.FC<AgentsMdPanelContentProps> = () => {
  const { memories, loading, scan, setEnabled } = useAgentsMd();
  const [scanning, setScanning] = useState(false);
  const [scanPath, setScanPath] = useState('/home/qizheng/auto_code_data');
  const [error, setError] = useState<string | null>(null);

  const handleScan = async () => {
    if (!scanPath) {
      setError('请输入项目路径');
      return;
    }
    setScanning(true);
    setError(null);
    try {
      await scan(scanPath);
    } catch (e: any) {
      setError(e.message || '扫描失败');
    } finally {
      setScanning(false);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-surface-500">加载中...</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>
      )}

      <div className="mb-4 p-3 bg-surface-50 rounded-lg">
        <label className="text-sm font-medium text-surface-700 mb-1.5 block">
          扫描项目路径
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={scanPath}
            onChange={(e) => setScanPath(e.target.value)}
            placeholder="/path/to/project"
            className="flex-1 px-3 py-1.5 text-sm border border-surface-200 rounded-lg font-mono"
          />
          <button
            onClick={handleScan}
            disabled={scanning}
            className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded-lg hover:bg-hermes-600 disabled:opacity-50"
          >
            {scanning ? '扫描中...' : '扫描'}
          </button>
        </div>
      </div>

      <div className="mb-2 text-sm text-surface-600">
        共 {memories.length} 个 AGENTS.md（{memories.filter((m) => m.enabled).length} 已启用）
      </div>

      <div className="space-y-2">
        {memories.length === 0 ? (
          <div className="text-center py-8 text-surface-500">
            尚未扫描项目。请输入项目路径并点击"扫描"。
          </div>
        ) : (
          memories.map((mem: AgentsMemory) => (
            <div
              key={mem.id}
              className="p-3 border border-surface-200 rounded-lg hover:border-hermes-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-surface-900 truncate">
                      {mem.relative_path}
                    </span>
                    {mem.enabled && (
                      <span className="text-xs px-1.5 py-0.5 bg-green-50 text-green-600 rounded">
                        已注入
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-surface-500 mt-0.5 truncate">
                    {mem.size} bytes
                  </p>
                </div>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={mem.enabled}
                    onChange={(e) => setEnabled(mem.id, e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm text-surface-600">
                    {mem.enabled ? '启用' : '禁用'}
                  </span>
                </label>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AgentsMdPanelContent;
