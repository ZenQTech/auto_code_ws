/**
 * # ============================================================
 * # useAgentRoles Hook (v1.0.0)
 * # Cycle 63 G63-02
 * # ====================================
 * # 核心作用：封装 Agent 角色管理 API
 * # 运行流程：
 * #   1. 加载角色列表（内置 + 自定义）
 * #   2. 注册 / 更新 / 删除自定义角色
 * #   3. spawn 实例 / 取消实例
 * #   4. 加载实例列表
 * # 输入参数：baseUrl, autoRefreshMs
 * # 输出结果：UseAgentRolesResult
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-02 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useState } from 'react';

export interface AgentRole {
  name: string;
  description: string;
  developer_instructions: string;
  nickname_candidates: string[];
  model: string | null;
  model_reasoning_effort: string | null;
  sandbox_mode: string | null;
  mcp_servers: string[];
  skills: string[];
  builtin: boolean;
  created_at: number;
  updated_at: number;
}

export interface AgentInstance {
  agent_id: string;
  role_name: string;
  nickname: string;
  status: 'spawning' | 'running' | 'idle' | 'failed' | 'dead';
  task: string;
  started_at: number;
  finished_at: number | null;
  result: string | null;
  error: string | null;
}

export interface AgentRoleStats {
  total_roles: number;
  builtin_roles: number;
  custom_roles: number;
  total_instances: number;
  running_instances: number;
  max_concurrency_per_role: number;
}

export interface CreateRoleRequest {
  name: string;
  description?: string;
  developer_instructions?: string;
  nickname_candidates?: string[];
  model?: string | null;
  model_reasoning_effort?: string | null;
  sandbox_mode?: string | null;
  mcp_servers?: string[];
  skills?: string[];
}

export interface UpdateRoleRequest {
  description?: string;
  developer_instructions?: string;
  nickname_candidates?: string[];
  model?: string | null;
  model_reasoning_effort?: string | null;
  sandbox_mode?: string | null;
  mcp_servers?: string[];
  skills?: string[];
}

export interface SpawnRequest {
  task: string;
  nickname?: string;
}

export interface UseAgentRolesOptions {
  baseUrl?: string;
  autoRefreshMs?: number;
}

export interface UseAgentRolesResult {
  // 数据
  roles: AgentRole[];
  instances: AgentInstance[];
  stats: AgentRoleStats | null;

  // 状态
  loading: boolean;
  spawning: boolean;
  error: string | null;

  // 操作
  loadRoles: () => Promise<void>;
  loadInstances: () => Promise<void>;
  loadStats: () => Promise<void>;
  createRole: (req: CreateRoleRequest) => Promise<AgentRole | null>;
  updateRole: (name: string, req: UpdateRoleRequest) => Promise<AgentRole | null>;
  deleteRole: (name: string) => Promise<boolean>;
  spawnInstance: (roleName: string, req: SpawnRequest) => Promise<AgentInstance | null>;
  cancelInstance: (agentId: string) => Promise<boolean>;
  clearError: () => void;
}

const DEFAULT_BASE_URL = '/api/agent-roles';

export function useAgentRoles(options: UseAgentRolesOptions = {}): UseAgentRolesResult {
  const { baseUrl = DEFAULT_BASE_URL, autoRefreshMs = 0 } = options;

  const [roles, setRoles] = useState<AgentRole[]>([]);
  const [instances, setInstances] = useState<AgentInstance[]>([]);
  const [stats, setStats] = useState<AgentRoleStats | null>(null);

  const [loading, setLoading] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleError = useCallback((err: unknown, op: string) => {
    const msg = err instanceof Error ? err.message : String(err);
    setError(`[${op}] ${msg}`);
    // eslint-disable-next-line no-console
    console.error(`[useAgentRoles] ${op}:`, err);
  }, []);

  const loadRoles = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${baseUrl}`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setRoles(data.roles || []);
    } catch (err) {
      handleError(err, 'loadRoles');
    } finally {
      setLoading(false);
    }
  }, [baseUrl, handleError]);

  const loadInstances = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/instances`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setInstances(data.instances || []);
    } catch (err) {
      handleError(err, 'loadInstances');
    }
  }, [baseUrl, handleError]);

  const loadStats = useCallback(async () => {
    try {
      const resp = await fetch(`${baseUrl}/_stats`, { method: 'GET' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      setStats(data.stats);
    } catch (err) {
      handleError(err, 'loadStats');
    }
  }, [baseUrl, handleError]);

  const createRole = useCallback(
    async (req: CreateRoleRequest): Promise<AgentRole | null> => {
      try {
        const resp = await fetch(`${baseUrl}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        await loadRoles();
        return data.role;
      } catch (err) {
        handleError(err, 'createRole');
        return null;
      }
    },
    [baseUrl, handleError, loadRoles],
  );

  const updateRole = useCallback(
    async (name: string, req: UpdateRoleRequest): Promise<AgentRole | null> => {
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(name)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        await loadRoles();
        return data.role;
      } catch (err) {
        handleError(err, 'updateRole');
        return null;
      }
    },
    [baseUrl, handleError, loadRoles],
  );

  const deleteRole = useCallback(
    async (name: string): Promise<boolean> => {
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        await loadRoles();
        return true;
      } catch (err) {
        handleError(err, 'deleteRole');
        return false;
      }
    },
    [baseUrl, handleError, loadRoles],
  );

  const spawnInstance = useCallback(
    async (roleName: string, req: SpawnRequest): Promise<AgentInstance | null> => {
      setSpawning(true);
      try {
        const resp = await fetch(`${baseUrl}/${encodeURIComponent(roleName)}/spawn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        await loadInstances();
        return data.instance;
      } catch (err) {
        handleError(err, 'spawnInstance');
        return null;
      } finally {
        setSpawning(false);
      }
    },
    [baseUrl, handleError, loadInstances],
  );

  const cancelInstance = useCallback(
    async (agentId: string): Promise<boolean> => {
      try {
        const resp = await fetch(`${baseUrl}/instances/${encodeURIComponent(agentId)}/cancel`, {
          method: 'POST',
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        await loadInstances();
        return true;
      } catch (err) {
        handleError(err, 'cancelInstance');
        return false;
      }
    },
    [baseUrl, handleError, loadInstances],
  );

  const clearError = useCallback(() => setError(null), []);

  // 自动刷新
  useEffect(() => {
    if (autoRefreshMs > 0) {
      const timer = setInterval(() => {
        loadInstances();
      }, autoRefreshMs);
      return () => clearInterval(timer);
    }
    return undefined;
  }, [autoRefreshMs, loadInstances]);

  return {
    roles,
    instances,
    stats,
    loading,
    spawning,
    error,
    loadRoles,
    loadInstances,
    loadStats,
    createRole,
    updateRole,
    deleteRole,
    spawnInstance,
    cancelInstance,
    clearError,
  };
}
