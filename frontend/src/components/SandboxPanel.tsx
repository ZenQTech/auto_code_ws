/**
 * # ============================================================
 * # SandboxPanel - 容器隔离执行器面板 (v1.0.0)
 * # Cycle 69 G69-01
 * # ====================================
 * # 核心作用：管理容器隔离的沙箱实例（创建/启动/执行/停止/销毁）
 * # 设计要点：
 * #   1. 列出所有 sandbox
 * #   2. 创建 sandbox（work_dir + 资源预设 + 网络策略）
 * #   3. 在 sandbox 中执行命令
 * #   4. 实时显示状态 + 输出
 * #   5. 对标 Codex codex-sandbox + Docker Sandboxes
 * # 输入参数：可选 initialWorkDir
 * # 输出结果：UI 组件
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 69 G69-01 初次创建
 * # ====================================
 */

import React, { useCallback, useEffect, useState } from 'react';

// ============================================================
// 类型
// ============================================================

export type SandboxStatus = 'created' | 'running' | 'stopped' | 'destroyed' | 'error';

export interface SandboxInfo {
  sandbox_id: string;
  work_dir: string;
  status: SandboxStatus;
  resource_preset: string;
  created_at: string;
  started_at?: string | null;
  stopped_at?: string | null;
  ttl_seconds: number;
  backend: string;
}

export interface SandboxPanelProps {
  testId?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// 工具
// ============================================================

async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(path);
  if (!resp.ok) {
    throw new Error(`API ${path} failed: ${resp.status}`);
  }
  return resp.json();
}

async function apiPost<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const resp = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    throw new Error(`API ${path} failed: ${resp.status}`);
  }
  return resp.json();
}

async function apiDelete<T>(path: string): Promise<T> {
  const resp = await fetch(path, { method: 'DELETE' });
  if (!resp.ok) {
    throw new Error(`API ${path} failed: ${resp.status}`);
  }
  return resp.json();
}

// ============================================================
// 主组件
// ============================================================

export const SandboxPanel: React.FC<SandboxPanelProps> = ({ testId = 'sandbox-panel' }) => {
  const [sandboxes, setSandboxes] = useState<SandboxInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workDir, setWorkDir] = useState('/tmp');
  const [preset, setPreset] = useState('default');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [execCmd, setExecCmd] = useState('ls -la');
  const [execOutput, setExecOutput] = useState<string>('');

  const loadList = useCallback(async () => {
    try {
      setLoading(true);
      const resp = await apiGet<ApiResponse<SandboxInfo[]>>('/api/sandbox/list');
      if (resp.success && resp.data) {
        setSandboxes(resp.data);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const handleCreate = async () => {
    try {
      setLoading(true);
      setError(null);
      const resp = await apiPost<ApiResponse<SandboxInfo>>('/api/sandbox/create', {
        work_dir: workDir,
        resource_preset: preset,
      });
      if (resp.success && resp.data) {
        setSandboxes((prev) => [...prev, resp.data!]);
        setSelectedId(resp.data.sandbox_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleStart = async (id: string) => {
    try {
      await apiPost<ApiResponse<SandboxInfo>>(`/api/sandbox/${id}/start`);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStop = async (id: string) => {
    try {
      await apiPost<ApiResponse<SandboxInfo>>(`/api/sandbox/${id}/stop`);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDestroy = async (id: string) => {
    try {
      await apiDelete<ApiResponse<{ removed: boolean }>>(`/api/sandbox/${id}`);
      await loadList();
      if (selectedId === id) setSelectedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleExec = async () => {
    if (!selectedId) return;
    try {
      setError(null);
      const resp = await apiPost<ApiResponse<{ stdout: string; stderr: string; exit_code: number }>>(
        `/api/sandbox/${selectedId}/exec`,
        { cmd: execCmd.split(' ').filter(Boolean) },
      );
      if (resp.success && resp.data) {
        setExecOutput(
          `exit_code: ${resp.data.exit_code}\nstdout:\n${resp.data.stdout}\nstderr:\n${resp.data.stderr}`,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="p-3 h-full overflow-auto" data-testid={testId}>
      <h3 className="text-sm font-semibold mb-3 text-[var(--text-primary)]">
        🛡️ 容器隔离执行器
      </h3>

      {error && (
        <div
          className="p-2 mb-3 rounded bg-red-500/10 border border-red-500/30 text-xs text-red-400"
          data-testid={`${testId}-error`}
        >
          {error}
        </div>
      )}

      {/* 创建表单 */}
      <div className="p-3 mb-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)]">
        <div className="text-xs font-semibold mb-2 text-[var(--text-primary)]">创建新沙箱</div>
        <div className="space-y-2">
          <input
            type="text"
            value={workDir}
            onChange={(e) => setWorkDir(e.target.value)}
            placeholder="工作目录"
            className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-primary)]"
            data-testid={`${testId}-workdir-input`}
          />
          <select
            value={preset}
            onChange={(e) => setPreset(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-primary)]"
            data-testid={`${testId}-preset-select`}
          >
            <option value="small">small (1 CPU, 512MB)</option>
            <option value="default">default (2 CPU, 2GB)</option>
            <option value="medium">medium (4 CPU, 4GB)</option>
            <option value="large">large (8 CPU, 8GB)</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={loading}
            className="w-full px-3 py-1.5 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600 disabled:opacity-50"
            data-testid={`${testId}-create-btn`}
          >
            ➕ 创建沙箱
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="space-y-2 mb-3">
        <div className="text-xs font-semibold text-[var(--text-primary)]">
          沙箱列表（{sandboxes.length}）
        </div>
        {sandboxes.length === 0 && !loading && (
          <div
            className="p-3 text-xs text-[var(--text-tertiary)] text-center rounded bg-[var(--bg-elevated)] border border-[var(--border-color)]"
            data-testid={`${testId}-empty`}
          >
            暂无沙箱
          </div>
        )}
        {sandboxes.map((sb) => (
          <div
            key={sb.sandbox_id}
            className={`p-2 rounded border ${
              selectedId === sb.sandbox_id
                ? 'border-hermes-500 bg-hermes-500/10'
                : 'border-[var(--border-color)] bg-[var(--bg-elevated)]'
            }`}
            data-testid={`${testId}-item-${sb.sandbox_id}`}
            onClick={() => setSelectedId(sb.sandbox_id)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono">{sb.sandbox_id.slice(0, 12)}</span>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded ${
                  sb.status === 'running'
                    ? 'bg-green-500/20 text-green-400'
                    : sb.status === 'error'
                    ? 'bg-red-500/20 text-red-400'
                    : 'bg-gray-500/20 text-gray-400'
                }`}
              >
                {sb.status}
              </span>
            </div>
            <div className="text-[10px] text-[var(--text-tertiary)] mb-1">
              {sb.work_dir} · {sb.resource_preset} · {sb.backend}
            </div>
            <div className="flex gap-1">
              {sb.status === 'created' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStart(sb.sandbox_id);
                  }}
                  className="px-2 py-0.5 text-[10px] bg-green-500 text-white rounded"
                >
                  ▶ 启动
                </button>
              )}
              {sb.status === 'running' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStop(sb.sandbox_id);
                  }}
                  className="px-2 py-0.5 text-[10px] bg-yellow-500 text-white rounded"
                >
                  ⏸ 停止
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDestroy(sb.sandbox_id);
                }}
                className="px-2 py-0.5 text-[10px] bg-red-500 text-white rounded"
              >
                🗑 销毁
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* 执行命令 */}
      {selectedId && (
        <div className="p-3 rounded-lg bg-[var(--bg-elevated)] border border-[var(--border-color)]">
          <div className="text-xs font-semibold mb-2 text-[var(--text-primary)]">
            ⚡ 执行命令
          </div>
          <input
            type="text"
            value={execCmd}
            onChange={(e) => setExecCmd(e.target.value)}
            className="w-full px-2 py-1 text-xs rounded bg-[var(--bg-app)] border border-[var(--border-color)] text-[var(--text-primary)] font-mono mb-2"
            data-testid={`${testId}-cmd-input`}
          />
          <button
            onClick={handleExec}
            className="w-full px-3 py-1.5 text-xs bg-hermes-500 text-white rounded hover:bg-hermes-600 mb-2"
            data-testid={`${testId}-exec-btn`}
          >
            ▶ 执行
          </button>
          {execOutput && (
            <pre
              className="p-2 text-[10px] font-mono bg-black/50 text-green-400 rounded overflow-auto max-h-48"
              data-testid={`${testId}-output`}
            >
              {execOutput}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default SandboxPanel;
