/**
 * # ============================================================
 * # useSkillsV2 Hook (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：封装 5 位置 Skills 注册表 API
 * # 功能：
 * #   1. 列出所有位置（defaults/system/admin/user/repo）
 * #   2. 列出 skills（按 location / enabled_only 过滤）
 * #   3. 按名称/ID 获取
 * #   4. 启用/禁用
 * #   5. 重新扫描
 * #   6. 冲突列表
 * # 输入参数：options
 * # 输出结果：skills + locations + actions
 * # 对标：Codex CLI v0.124.0+ Skills Registry
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export type SkillLocationV2 = 'defaults' | 'system' | 'admin' | 'user' | 'repo';

export interface SkillV2 {
  id: string;
  name: string;
  display_name: string;
  description: string;
  location: SkillLocationV2;
  path: string;
  enabled: boolean;
  source: string;
  version: string;
  tags: string[];
  argument_hint?: string | null;
  allowed_tools: string[];
  user_invocable: boolean;
  disable_model_invocation: boolean;
  agent?: string | null;
  system_prompt: string;
  scripts: string[];
  references: string[];
  last_scanned_at: string;
  content_hash: string;
}

export interface SkillLocationStatusV2 {
  name: SkillLocationV2;
  paths: string[];
  exists: boolean;
  skill_count: number;
  scanned_at: string;
}

export interface SkillConflictV2 {
  skill_name: string;
  kept: SkillV2;
  overridden: SkillV2;
  override_location: SkillLocationV2;
}

export interface RescanResultV2 {
  skills_found: number;
  skills_added: number;
  skills_removed: number;
  conflicts: SkillConflictV2[];
  duration_ms: number;
  scanned_at: string;
}

export interface UseSkillsV2Options {
  autoRefresh?: boolean;
  refreshIntervalMs?: number;
  location?: SkillLocationV2;
  enabledOnly?: boolean;
}

export interface UseSkillsV2Result {
  skills: SkillV2[];
  locations: SkillLocationStatusV2[];
  conflicts: SkillConflictV2[];
  loading: boolean;
  error: string | null;
  repoRoot: string | null;

  refresh: () => Promise<void>;
  rescan: (repoRoot?: string) => Promise<RescanResultV2 | null>;
  setEnabled: (skillId: string, enabled: boolean) => Promise<SkillV2 | null>;
  getByName: (name: string) => SkillV2 | undefined;
  getLocationCounts: () => Record<string, number>;
  clearError: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_REFRESH_INTERVAL = 10000;
const DEFAULT_BASE_URL = '/api/skills-v2';

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

export function useSkillsV2(options: UseSkillsV2Options = {}): UseSkillsV2Result {
  const {
    autoRefresh = false,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL,
    location,
    enabledOnly = false,
  } = options;

  const [skills, setSkills] = useState<SkillV2[]>([]);
  const [locations, setLocations] = useState<SkillLocationStatusV2[]>([]);
  const [conflicts, setConflicts] = useState<SkillConflictV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const isMountedRef = useRef(true);

  // ============================================================
  // refresh
  // ============================================================

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (location) params.set('location', location);
      if (enabledOnly) params.set('enabled_only', 'true');
      if (repoRoot) params.set('repo_root', repoRoot);
      const url = `${DEFAULT_BASE_URL}/list?${params.toString()}`;
      const resp = await fetch(url, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (isMountedRef.current) {
        setSkills(data.skills || []);
        if (data.repo_root) setRepoRoot(data.repo_root);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(handleError(err, 'refresh'));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [location, enabledOnly, repoRoot]);

  // ============================================================
  // loadLocations
  // ============================================================

  const loadLocations = useCallback(async () => {
    try {
      const resp = await fetch(`${DEFAULT_BASE_URL}/locations`, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (isMountedRef.current) {
        setLocations(data.locations || []);
      }
    } catch (err) {
      if (isMountedRef.current) {
        setError(handleError(err, 'loadLocations'));
      }
    }
  }, []);

  // ============================================================
  // loadConflicts
  // ============================================================

  const loadConflicts = useCallback(async () => {
    try {
      const resp = await fetch(`${DEFAULT_BASE_URL}/conflicts`, { method: 'GET' });
      if (!resp.ok) {
        // 404 means no conflicts endpoint or no conflicts
        if (resp.status === 404) {
          if (isMountedRef.current) setConflicts([]);
          return;
        }
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (isMountedRef.current) {
        setConflicts(data.conflicts || []);
      }
    } catch (err) {
      // 静默失败：conflicts 是辅助信息
      if (isMountedRef.current) {
        setConflicts([]);
      }
    }
  }, []);

  // ============================================================
  // rescan
  // ============================================================

  const rescan = useCallback(
    async (newRepoRoot?: string): Promise<RescanResultV2 | null> => {
      setError(null);
      try {
        const root = newRepoRoot || repoRoot;
        const resp = await fetch(`${DEFAULT_BASE_URL}/rescan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ repo_root: root }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data: RescanResultV2 = await resp.json();
        if (root) setRepoRoot(root);
        // 触发刷新
        setRefreshKey((k) => k + 1);
        return data;
      } catch (err) {
        setError(handleError(err, 'rescan'));
        return null;
      }
    },
    [repoRoot]
  );

  // ============================================================
  // setEnabled
  // ============================================================

  const setEnabled = useCallback(
    async (skillId: string, enabled: boolean): Promise<SkillV2 | null> => {
      setError(null);
      try {
        const resp = await fetch(
          `${DEFAULT_BASE_URL}/${encodeURIComponent(skillId)}/enabled`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          }
        );
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        // 触发刷新
        setRefreshKey((k) => k + 1);
        return data.skill as SkillV2;
      } catch (err) {
        setError(handleError(err, 'setEnabled'));
        return null;
      }
    },
    []
  );

  // ============================================================
  // 辅助：getByName
  // ============================================================

  const getByName = useCallback(
    (name: string): SkillV2 | undefined => {
      return skills.find((s) => s.name === name);
    },
    [skills]
  );

  // ============================================================
  // 辅助：getLocationCounts
  // ============================================================

  const getLocationCounts = useCallback((): Record<string, number> => {
    const counts: Record<string, number> = {
      defaults: 0,
      system: 0,
      admin: 0,
      user: 0,
      repo: 0,
    };
    for (const s of skills) {
      counts[s.location] = (counts[s.location] || 0) + 1;
    }
    return counts;
  }, [skills]);

  // ============================================================
  // 自动刷新 + 初始化
  // ============================================================

  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      void refresh();
    }, refreshIntervalMs);
    return () => clearInterval(id);
  }, [autoRefresh, refreshIntervalMs, refresh]);

  useEffect(() => {
    void refresh();
    void loadLocations();
    void loadConflicts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, location, enabledOnly]);

  // ============================================================
  // unmount
  // ============================================================

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // ============================================================
  // 公开接口
  // ============================================================

  const clearError = useCallback(() => setError(null), []);

  return {
    skills,
    locations,
    conflicts,
    loading,
    error,
    repoRoot,
    refresh,
    rescan,
    setEnabled,
    getByName,
    getLocationCounts,
    clearError,
  };
}

export default useSkillsV2;
