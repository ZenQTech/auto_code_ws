/**
 * # ============================================================
 * # useAgentsMdV2 Hook (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：封装 AGENTS.md 多层级解析 API
 * # 功能：
 * #   1. 解析多层级 AGENTS.md（global/project/directory）
 * #   2. 配置管理（max_bytes/max_depth/developer_instructions）
 * #   3. 项目根检测
 * #   4. 字节限制/截断
 * # 输入参数：options
 * # 输出结果：layers + merged_content + config
 * # 对标：Codex CLI v0.124.0+ AGENTS.md Multi-Level Discovery
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import { useCallback, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type LayerScope = 'developer' | 'global' | 'project' | 'directory' | 'model_override';

export interface ResolvedLayer {
  scope: LayerScope;
  path: string;
  content: string;
  size: number;
  is_truncated: boolean;
  source: 'AGENTS.md' | 'AGENTS.override.md' | 'fallback' | 'inline' | 'file';
  level: number;
}

export interface ResolvedAgentsMdV2 {
  cwd: string;
  project_root: string | null;
  layers: ResolvedLayer[];
  merged_content: string;
  total_bytes: number;
  max_bytes: number;
  is_truncated: boolean;
  truncated_count: number;
  layer_count: number;
  resolved_at: string;
}

export interface AgentsMdConfigV2 {
  max_bytes: number;
  max_depth: number;
  fallback_filenames: string[];
  project_root_markers: string[];
  developer_instructions: string;
  model_instructions_file?: string | null;
  global_paths: string[];
}

export interface ProjectRootInfo {
  cwd: string;
  project_root: string | null;
  marker_found: string | null;
  depth: number;
  is_within_repo: boolean;
}

export interface UseAgentsMdV2Result {
  resolved: ResolvedAgentsMdV2 | null;
  config: AgentsMdConfigV2 | null;
  loading: boolean;
  error: string | null;

  resolve: (cwd: string, configOverride?: Partial<AgentsMdConfigV2>) => Promise<ResolvedAgentsMdV2 | null>;
  loadConfig: () => Promise<AgentsMdConfigV2 | null>;
  saveConfig: (newConfig: AgentsMdConfigV2) => Promise<boolean>;
  detectRoot: (cwd: string) => Promise<ProjectRootInfo | null>;
  clearError: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api/agents-md-v2';

// ============================================================
// 辅助函数
// ============================================================

function handleError(err: unknown, action: string): string {
  if (err instanceof Error) {
    return `${action}: ${err.message}`;
  }
  return `${action}: 未知错误`;
}

// ============================================================
// Hook 主实现
// ============================================================

export function useAgentsMdV2(): UseAgentsMdV2Result {
  const [resolved, setResolved] = useState<ResolvedAgentsMdV2 | null>(null);
  const [config, setConfig] = useState<AgentsMdConfigV2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ============================================================
  // resolve
  // ============================================================

  const resolve = useCallback(
    async (
      cwd: string,
      configOverride?: Partial<AgentsMdConfigV2>
    ): Promise<ResolvedAgentsMdV2 | null> => {
      if (!cwd || !cwd.trim()) {
        setError('cwd 不能为空');
        return null;
      }
      setError(null);
      setLoading(true);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/load`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cwd,
            config: configOverride || {},
          }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data: ResolvedAgentsMdV2 = await resp.json();
        setResolved(data);
        return data;
      } catch (err) {
        setError(handleError(err, 'resolve'));
        return null;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // ============================================================
  // loadConfig
  // ============================================================

  const loadConfig = useCallback(async (): Promise<AgentsMdConfigV2 | null> => {
    setError(null);
    try {
      const resp = await fetch(`${DEFAULT_BASE_URL}/config`, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      const cfg: AgentsMdConfigV2 = data.config;
      setConfig(cfg);
      return cfg;
    } catch (err) {
      setError(handleError(err, 'loadConfig'));
      return null;
    }
  }, []);

  // ============================================================
  // saveConfig
  // ============================================================

  const saveConfig = useCallback(
    async (newConfig: AgentsMdConfigV2): Promise<boolean> => {
      setError(null);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newConfig),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setConfig(data.config);
        return true;
      } catch (err) {
        setError(handleError(err, 'saveConfig'));
        return false;
      }
    },
    []
  );

  // ============================================================
  // detectRoot
  // ============================================================

  const detectRoot = useCallback(async (cwd: string): Promise<ProjectRootInfo | null> => {
    if (!cwd || !cwd.trim()) return null;
    try {
      const resp = await fetch(`${DEFAULT_BASE_URL}/detect-root`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cwd }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${resp.status}`);
      }
      const data: ProjectRootInfo = await resp.json();
      return data;
    } catch (err) {
      setError(handleError(err, 'detectRoot'));
      return null;
    }
  }, []);

  // ============================================================
  // 公开接口
  // ============================================================

  const clearError = useCallback(() => setError(null), []);

  return {
    resolved,
    config,
    loading,
    error,
    resolve,
    loadConfig,
    saveConfig,
    detectRoot,
    clearError,
  };
}

export default useAgentsMdV2;
