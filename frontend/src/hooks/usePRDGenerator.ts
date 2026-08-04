/**
 * # ============================================================
 * # usePRDGenerator Hook (v1.0.0)
 * # Cycle 63 G63-01
 * # ====================================
 * # 核心作用：封装 PRD 生成器 API 调用
 * # 运行流程：
 * #   1. 生成 PRD（自然语言需求 → 结构化 PRD）
 * #   2. 基于反馈迭代 PRD（生成新版本 + diff）
 * #   3. 查询 PRD 列表 / 详情 / 统计
 * #   4. 计算两个版本之间的 diff
 * #   5. 删除 PRD
 * # 输入参数：baseUrl, autoRefreshMs
 * # 输出结果：UsePRDGeneratorResult
 * # 设计要点：
 * #   - 全异步，loading / error 状态管理
 * #   - 失败时自动抛出，但保留在 state 中便于 UI 提示
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useState } from 'react';

export interface PRDScenario {
  name: string;
  description: string;
  preconditions: string[];
  steps: string[];
}

export interface PRDCriterion {
  id: string;
  description: string;
  metric: string;
  target: string;
}

export interface PRDTask {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  estimated_hours: number;
  risk_level: 'low' | 'medium' | 'high' | 'extreme';
}

export interface PRDDocument {
  prd_id: string;
  title: string;
  goals: string[];
  user_scenarios: PRDScenario[];
  acceptance_criteria: PRDCriterion[];
  tasks: PRDTask[];
  risks: string[];
  version: number;
  created_at: number;
  updated_at: number;
}

export interface PRDVersion {
  version: number;
  content: PRDDocument;
  diff_summary: string | null;
  created_at: number;
}

export interface DiffOp {
  field: string;
  op: 'added' | 'removed' | 'modified';
  path: string;
  before: unknown;
  after: unknown;
  summary: string;
}

export interface PRDListItem {
  prd_id: string;
  title: string;
  current_version: number;
  updated_at: number;
}

export interface PRDStats {
  total_prds: number;
  total_versions: number;
  rate_limit_per_hour: number;
}

export interface GeneratePRDRequest {
  requirement: string;
  context?: Record<string, unknown>;
  template?: string;
  user_id?: string;
}

export interface IteratePRDRequest {
  feedback: string;
  base_version?: number;
  user_id?: string;
}

export interface UsePRDGeneratorOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
}

export interface UsePRDGeneratorResult {
  // 数据
  prds: PRDListItem[];
  currentPRD: PRDDocument | null;
  currentVersions: PRDVersion[];
  currentDiff: DiffOp[];
  stats: PRDStats | null;

  // 状态
  loading: boolean;
  generating: boolean;
  iterating: boolean;
  error: string | null;

  // 操作
  generatePRD: (req: GeneratePRDRequest) => Promise<PRDDocument | null>;
  iteratePRD: (prdId: string, req: IteratePRDRequest) => Promise<PRDDocument | null>;
  loadPRD: (prdId: string, version?: number, includeHistory?: boolean) => Promise<void>;
  listPRDs: () => Promise<void>;
  deletePRD: (prdId: string) => Promise<boolean>;
  computeDiff: (prdId: string, fromVersion: number, toVersion: number) => Promise<DiffOp[]>;
  loadStats: () => Promise<void>;
  clearError: () => void;
  clearCurrent: () => void;
}

const DEFAULT_BASE_URL = '/api/prd';

export function usePRDGenerator(options: UsePRDGeneratorOptions = {}): UsePRDGeneratorResult {
  const { baseUrl = DEFAULT_BASE_URL, autoRefreshMs = 0 } = options;

  const [prds, setPrds] = useState<PRDListItem[]>([]);
  const [currentPRD, setCurrentPRD] = useState<PRDDocument | null>(null);
  const [currentVersions, setCurrentVersions] = useState<PRDVersion[]>([]);
  const [currentDiff, setCurrentDiff] = useState<DiffOp[]>([]);
  const [stats, setStats] = useState<PRDStats | null>(null);

  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [iterating, setIterating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((err: unknown, op: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    setError(`[${op}] ${msg}`);
    // eslint-disable-next-line no-console
    console.error(`[usePRDGenerator] ${op}:`, err);
  }, []);

  const listPRDs = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${baseUrl}/_list`, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setPrds(data.prds || []);
    } catch (err) {
      handleError(err, 'listPRDs');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, handleError]);

  const loadPRD = useCallback(
    async (prdId: string, version?: number, includeHistory = true) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (version !== undefined) params.set('version', String(version));
        if (includeHistory) params.set('include_history', 'true');
        const url = `${baseUrl}/${encodeURIComponent(prdId)}${params.toString() ? `?${params}` : ''}`;
        const resp = await fetch(url, { method: 'GET' });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setCurrentPRD(data.prd);
        if (data.history) {
          setCurrentVersions(data.history);
        } else {
          setCurrentVersions([
            {
              version: data.prd.version,
              content: data.prd,
              diff_summary: null,
              created_at: data.prd.updated_at,
            },
          ]);
        }
        setCurrentDiff([]);
      } catch (err) {
        handleError(err, 'loadPRD');
      } finally {
        setLoading(false);
      }
    },
    [baseUrl, handleError],
  );

  const generatePRD = useCallback(
    async (req: GeneratePRDRequest): Promise<PRDDocument | null> => {
      setGenerating(true);
      try {
        const resp = await fetch(`${baseUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setCurrentPRD(data.prd);
        setCurrentVersions([
          {
            version: data.version,
            content: data.prd,
            diff_summary: '初始版本',
            created_at: data.prd.created_at,
          },
        ]);
        setCurrentDiff([]);
        // 自动刷新列表
        await listPRDs();
        return data.prd;
      } catch (err) {
        handleError(err, 'generatePRD');
        return null;
      } finally {
        setGenerating(false);
      }
    },
    [baseUrl, handleError, listPRDs],
  );

  const iteratePRD = useCallback(
    async (prdId: string, req: IteratePRDRequest): Promise<PRDDocument | null> => {
      setIterating(true);
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(prdId)}/iterate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setCurrentPRD(data.prd);
        setCurrentDiff(data.diff || []);
        // 重新加载历史
        await loadPRD(prdId, undefined, true);
        return data.prd;
      } catch (err) {
        handleError(err, 'iteratePRD');
        return null;
      } finally {
        setIterating(false);
      }
    },
    [baseUrl, handleError, loadPRD],
  );

  const deletePRD = useCallback(
    async (prdId: string): Promise<boolean> => {
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(prdId)}`, {
          method: 'DELETE',
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        if (currentPRD?.prd_id === prdId) {
          setCurrentPRD(null);
          setCurrentVersions([]);
          setCurrentDiff([]);
        }
        await listPRDs();
        return true;
      } catch (err) {
        handleError(err, 'deletePRD');
        return false;
      }
    },
    [baseUrl, currentPRD, handleError, listPRDs],
  );

  const computeDiff = useCallback(
    async (prdId: string, fromVersion: number, toVersion: number): Promise<DiffOp[]> => {
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(prdId)}/diff`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_version: fromVersion, to_version: toVersion }),
        });
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setCurrentDiff(data.diff || []);
        return data.diff || [];
      } catch (err) {
        handleError(err, 'computeDiff');
        return [];
      }
    },
    [baseUrl, handleError],
  );

  const loadStats = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/_stats`, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      setStats(data.stats);
    } catch (err) {
      handleError(err, 'loadStats');
    }
  }, [baseUrl, handleError]);

  const clearError = useCallback(() => setError(null), []);
  const clearCurrent = useCallback(() => {
    setCurrentPRD(null);
    setCurrentVersions([]);
    setCurrentDiff([]);
  }, []);

  // 自动刷新
  useEffect(() => {
    if (autoRefreshMs > 0) {
      const timer = setInterval(() => {
        listPRDs();
      }, autoRefreshMs);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [autoRefreshMs, listPRDs]);

  return {
    prds,
    currentPRD,
    currentVersions,
    currentDiff,
    stats,
    loading,
    generating,
    iterating,
    error,
    generatePRD,
    iteratePRD,
    loadPRD,
    listPRDs,
    deletePRD,
    computeDiff,
    loadStats,
    clearError,
    clearCurrent,
  };
}
