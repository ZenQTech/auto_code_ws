/**
 * ImportPanel - 跨平台配置导入面板
 * Cycle 11 P3-1
 *
 * 4 步向导：检测 → 预览 → 确认 → 执行 → 完成
 */
import React, { useEffect, useState } from 'react';
import {
  detectSources,
  previewImport,
  runImport,
  getStatus,
  cancelTask,
  rollbackTask,
  fetchHealth,
  ImportSource,
  DataType,
  DetectedSource,
  PreviewItem,
  ImportTask,
  getStatusColor,
  getSourceIcon,
  getSourceName,
  getDataTypeName,
  formatSize,
} from '../hooks/useImportApi';

type Step = 'detect' | 'preview' | 'confirm' | 'execute' | 'done';

interface ImportPanelProps {
  onClose?: () => void;
  standalone?: boolean;
}

export const ImportPanel: React.FC<ImportPanelProps> = ({ onClose, standalone = false }) => {
  const [step, setStep] = useState<Step>('detect');
  const [health, setHealth] = useState<{ status: string; version: string } | null>(null);
  const [sources, setSources] = useState<DetectedSource[]>([]);
  const [selectedSource, setSelectedSource] = useState<ImportSource | null>(null);
  const [selectedTypes, setSelectedTypes] = useState<DataType[]>([]);
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([]);
  const [currentTask, setCurrentTask] = useState<ImportTask | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);

  // 初始化
  useEffect(() => {
    (async () => {
      try {
        const h = await fetchHealth();
        setHealth(h);
      } catch (e) {
        // ignore
      }
      await doDetect();
    })();
  }, []);

  // 轮询任务状态
  useEffect(() => {
    if (!polling || !currentTask) return;
    const interval = setInterval(async () => {
      try {
        const t = await getStatus(currentTask.task_id);
        setCurrentTask(t);
        if (['completed', 'failed', 'cancelled', 'rolled_back'].includes(t.status)) {
          setPolling(false);
          setStep('done');
        }
      } catch (e) {
        setPolling(false);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [polling, currentTask]);

  const doDetect = async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await detectSources();
      setSources(r.sources);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doPreview = async () => {
    if (!selectedSource || selectedTypes.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const r = await previewImport(selectedSource, selectedTypes);
      setPreviewItems(r.items);
      setStep('preview');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const doRun = async () => {
    if (!selectedSource) return;
    setLoading(true);
    setError(null);
    try {
      const r = await runImport(selectedSource, selectedTypes);
      const t: ImportTask = {
        task_id: r.task_id,
        source: selectedSource,
        data_types: selectedTypes,
        status: r.status as any,
        progress: 0,
        started_at: new Date().toISOString(),
        completed_at: null,
        items_total: r.items_total,
        items_completed: 0,
        items_failed: 0,
        error: null,
        rollback_available: false,
        log: [],
        results: [],
      };
      setCurrentTask(t);
      setPolling(true);
      setStep('execute');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = async () => {
    if (!currentTask) return;
    try {
      await cancelTask(currentTask.task_id);
      setPolling(false);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRollback = async () => {
    if (!currentTask) return;
    try {
      await rollbackTask(currentTask.task_id);
      await doDetect();
    } catch (e: any) {
      setError(e.message);
    }
  };

  const reset = () => {
    setStep('detect');
    setSelectedSource(null);
    setSelectedTypes([]);
    setPreviewItems([]);
    setCurrentTask(null);
    setError(null);
  };

  // 选中的可用源
  const availableSources = sources.filter(s => s.available);

  return (
    <div className={`flex flex-col h-full bg-gray-50 ${standalone ? '' : 'rounded-lg shadow border border-gray-200'}`}>
      {/* 头部 */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-gray-800">
            📥 跨平台配置导入
            {health && <span className="ml-2 text-xs text-gray-500 font-normal">v{health.version}</span>}
          </h2>
          {health && <span className="text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded">● healthy</span>}
        </div>
        <div className="flex items-center gap-2">
          {step !== 'detect' && (
            <button onClick={reset} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
              ↺ 重新开始
            </button>
          )}
          {onClose && (
            <button onClick={onClose} className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
              ✕
            </button>
          )}
        </div>
      </div>

      {/* 步骤指示器 */}
      <div className="px-4 py-2 bg-white border-b border-gray-200 flex items-center gap-2 text-xs">
        {['detect', 'preview', 'confirm', 'execute', 'done'].map((s, i) => (
          <div key={s} className="flex items-center">
            <span
              className={`px-2 py-0.5 rounded ${
                step === s ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600'
              }`}
            >
              {i + 1}. {s}
            </span>
            {i < 4 && <span className="mx-1 text-gray-400">→</span>}
          </div>
        ))}
      </div>

      {error && (
        <div className="mx-4 mt-2 p-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded">
          ❌ {error}
        </div>
      )}

      <div className="flex-1 overflow-auto p-4">
        {/* 步骤 1: 检测 */}
        {step === 'detect' && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">第 1 步: 选择数据源</h3>
            {loading && <div className="text-sm text-gray-500">检测中...</div>}
            <div className="space-y-2">
              {sources.map(s => (
                <label
                  key={s.source}
                  className={`block p-3 border rounded cursor-pointer hover:bg-blue-50 ${
                    s.available ? 'bg-white' : 'bg-gray-50 opacity-60'
                  } ${selectedSource === s.source ? 'border-blue-500 bg-blue-50' : 'border-gray-200'}`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="source"
                      disabled={!s.available}
                      checked={selectedSource === s.source}
                      onChange={() => {
                        setSelectedSource(s.source);
                        setSelectedTypes(s.data_types);
                      }}
                    />
                    <span className="text-2xl">{getSourceIcon(s.source)}</span>
                    <div className="flex-1">
                      <div className="font-medium text-gray-800">
                        {getSourceName(s.source)}
                        {s.version && <span className="ml-2 text-xs text-gray-500">v{s.version}</span>}
                        {s.available ? (
                          <span className="ml-2 text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                            已安装
                          </span>
                        ) : (
                          <span className="ml-2 text-xs px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded">
                            未安装
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {s.install_path} · {formatSize(s.size_bytes)}
                      </div>
                      {s.available && (
                        <div className="text-xs text-gray-600 mt-1">
                          可迁移: {s.data_types.map(getDataTypeName).join(', ')}
                        </div>
                      )}
                      {s.error && <div className="text-xs text-red-500 mt-1">{s.error}</div>}
                    </div>
                  </div>
                </label>
              ))}
            </div>
            {availableSources.length === 0 && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded">
                ⚠️ 未检测到任何已安装的 AI 编程工具。请先安装 Claude Code / Cursor / Codex / TRAE 中的任意一个。
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <button
                onClick={doPreview}
                disabled={!selectedSource || selectedTypes.length === 0 || loading}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                下一步: 预览 →
              </button>
            </div>
          </div>
        )}

        {/* 步骤 2: 预览 */}
        {step === 'preview' && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              第 2 步: 预览（dry-run）- {getSourceName(selectedSource!)}
            </h3>
            <div className="bg-white border border-gray-200 rounded">
              <div className="px-3 py-2 bg-gray-50 border-b border-gray-200 text-xs text-gray-600">
                共 {previewItems.length} 个待迁移项
              </div>
              {previewItems.length === 0 ? (
                <div className="p-4 text-sm text-gray-500">无可迁移项</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left">类型</th>
                      <th className="px-3 py-2 text-left">源路径</th>
                      <th className="px-3 py-2 text-left">目标路径</th>
                      <th className="px-3 py-2 text-right">大小</th>
                      <th className="px-3 py-2 text-left">转换说明</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewItems.map((item, i) => (
                      <tr key={i} className="border-t border-gray-100">
                        <td className="px-3 py-2">{getDataTypeName(item.data_type)}</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{item.source_path.split('/').pop()}</td>
                        <td className="px-3 py-2 font-mono text-gray-600">{item.target_path}</td>
                        <td className="px-3 py-2 text-right">{formatSize(item.size_bytes)}</td>
                        <td className="px-3 py-2 text-gray-500">
                          {item.transform_notes.map((n, j) => (
                            <div key={j}>• {n}</div>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="mt-4 flex justify-between">
              <button onClick={() => setStep('detect')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                ← 返回
              </button>
              <button
                onClick={() => setStep('confirm')}
                disabled={previewItems.length === 0}
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              >
                下一步: 确认 →
              </button>
            </div>
          </div>
        )}

        {/* 步骤 3: 确认 */}
        {step === 'confirm' && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">第 3 步: 确认执行</h3>
            <div className="bg-white border border-gray-200 rounded p-4 text-sm text-gray-700 space-y-2">
              <p>即将从 <strong>{getSourceName(selectedSource!)}</strong> 导入 {previewItems.length} 个项目到 Hermes。</p>
              <p>源数据<strong>只读</strong>，不会修改。导入过程会创建备份，失败时可回滚。</p>
              <p>敏感信息（API key / token）将<strong>自动脱敏</strong>。</p>
            </div>
            <div className="mt-4 flex justify-between">
              <button onClick={() => setStep('preview')} className="px-4 py-2 bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
                ← 返回
              </button>
              <button
                onClick={doRun}
                disabled={loading}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              >
                ✓ 确认导入
              </button>
            </div>
          </div>
        )}

        {/* 步骤 4: 执行 */}
        {step === 'execute' && currentTask && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">第 4 步: 执行中...</h3>
            <div className="bg-white border border-gray-200 rounded p-4 space-y-3">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(currentTask.status)}`}>
                  {currentTask.status}
                </span>
                <span className="text-sm text-gray-600">
                  {currentTask.items_completed} / {currentTask.items_total} 完成
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-blue-500 h-2 rounded-full transition-all"
                  style={{ width: `${(currentTask.progress || 0) * 100}%` }}
                />
              </div>
              <div className="text-xs text-gray-600 max-h-40 overflow-auto bg-gray-50 p-2 rounded font-mono">
                {currentTask.log.map((l, i) => (
                  <div key={i}>{l}</div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={handleCancel}
                disabled={!['pending', 'running'].includes(currentTask.status)}
                className="px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-50"
              >
                取消
              </button>
            </div>
          </div>
        )}

        {/* 步骤 5: 完成 */}
        {step === 'done' && currentTask && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              {currentTask.status === 'completed' ? '✅ 导入完成' : currentTask.status === 'failed' ? '❌ 导入失败' : '导入结束'}
            </h3>
            <div className="bg-white border border-gray-200 rounded p-4 space-y-2 text-sm">
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs border ${getStatusColor(currentTask.status)}`}>
                  {currentTask.status}
                </span>
                <span>成功 {currentTask.items_completed} / 失败 {currentTask.items_failed} / 总 {currentTask.items_total}</span>
              </div>
              {currentTask.error && <div className="text-red-600">错误: {currentTask.error}</div>}
              {currentTask.results.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs font-semibold text-gray-600 mb-1">迁移结果:</div>
                  <div className="space-y-1">
                    {currentTask.results.map((r, i) => (
                      <div key={i} className="text-xs flex items-center gap-2">
                        <span>{r.success ? '✓' : '✗'}</span>
                        <span className="font-mono text-gray-600">{r.data_type}</span>
                        {r.error && <span className="text-red-500">({r.error})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="mt-4 flex justify-between">
              {currentTask.rollback_available && (
                <button onClick={handleRollback} className="px-4 py-2 bg-orange-100 text-orange-700 rounded hover:bg-orange-200">
                  ↶ 回滚
                </button>
              )}
              <button onClick={reset} className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 ml-auto">
                导入更多
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportPanel;
