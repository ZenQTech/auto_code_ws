/**
 * # ============================================================
 * Cycle 3 API Hooks - 新功能 API 封装
 * # ============================================================
 * 核心作用：封装 Cycle 3 新增的 API hooks
 * 包含：
 *   - MCP 外部服务器管理
 *   - MCP 权限控制 + 审批
 *   - 双触发压缩 (pre-turn / mid-turn)
 *   - SKILL.md 导入导出
 *   - AGENTS.md 多文件类型 + 4 层加载
 *   - Rules 多类型扫描
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiShared';

// ============================================================
// MCP 外部服务器
// ============================================================

export interface ExternalMCPServer {
  id: string;
  name: string;
  transport: 'stdio' | 'streamable_http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  enabled: boolean;
  status?: string;
  tool_count?: number;
  auto_restart?: boolean;
  max_restarts?: number;
}

export function useExternalMCPServers() {
  const [servers, setServers] = useState<ExternalMCPServer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ servers: ExternalMCPServer[] }>('/mcp/servers');
      // 过滤掉 builtin
      const external = (data.servers || []).filter(s => s.id !== 'builtin');
      setServers(external);
    } catch (e) {
      console.error('获取外部 MCP servers 失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const registerServer = useCallback(async (config: {
    name: string;
    transport: string;
    command?: string;
    args?: string[];
    url?: string;
    env?: Record<string, string>;
  }) => {
    const data = await apiFetch<{ success: boolean; server_id: string }>('/mcp/servers', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    await fetchServers();
    return data;
  }, [fetchServers]);

  const unregisterServer = useCallback(async (serverId: string) => {
    await apiFetch(`/mcp/servers/${serverId}`, { method: 'DELETE' });
    await fetchServers();
  }, [fetchServers]);

  const restartServer = useCallback(async (serverId: string) => {
    return apiFetch<{ success: boolean; status: any }>(`/mcp/servers/${serverId}/restart`, {
      method: 'POST',
    });
  }, []);

  const getServerLogs = useCallback(async (serverId: string, limit = 100) => {
    return apiFetch<{ logs: any[]; count: number }>(`/mcp/servers/${serverId}/logs?limit=${limit}`);
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return { servers, loading, refetch: fetchServers, registerServer, unregisterServer, restartServer, getServerLogs };
}

// ============================================================
// MCP 权限控制
// ============================================================

export type PermissionMode = 'auto' | 'manual' | 'blocked';

export interface ToolPermission {
  tool_name: string;
  server_id: string;
  mode: PermissionMode;
  updated_at: string;
  updated_by: string;
  reason: string;
}

export interface ApprovalRequest {
  id: string;
  tool_name: string;
  server_id: string;
  arguments: Record<string, any>;
  session_id: string;
  requested_at: string;
  expires_at: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'cancelled';
  decided_at: string;
  decided_by: string;
  decision_reason: string;
}

export interface AuditLogEntry {
  id: string;
  tool_name: string;
  server_id: string;
  arguments: Record<string, any>;
  result: Record<string, any>;
  success: boolean;
  duration_ms: number;
  session_id: string;
  user_id: string;
  timestamp: string;
  error_message: string;
  permission_mode: string;
}

export function useMCPPermissions() {
  const [permissions, setPermissions] = useState<ToolPermission[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ permissions: ToolPermission[] }>('/mcp/permissions');
      setPermissions(data.permissions || []);
    } catch (e) {
      console.error('获取权限列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const setPermission = useCallback(async (
    toolName: string,
    mode: PermissionMode,
    serverId = 'builtin',
    reason = '',
  ) => {
    const data = await apiFetch<{ permission: ToolPermission }>('/mcp/permissions', {
      method: 'PUT',
      body: JSON.stringify({ tool_name: toolName, mode, server_id: serverId, reason }),
    });
    await fetchPermissions();
    return data.permission;
  }, [fetchPermissions]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  return { permissions, loading, refetch: fetchPermissions, setPermission };
}

export function usePendingApprovals(sessionId?: string) {
  const [pending, setPending] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const url = sessionId
        ? `/mcp/approvals/pending?session_id=${encodeURIComponent(sessionId)}`
        : '/mcp/approvals/pending';
      const data = await apiFetch<{ pending: ApprovalRequest[] }>(url);
      setPending(data.pending || []);
    } catch (e) {
      console.error('获取待审批请求失败:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  const respondToApproval = useCallback(async (
    requestId: string,
    decision: 'approved' | 'rejected',
    reason = '',
  ) => {
    const data = await apiFetch<{ request: ApprovalRequest }>(`/mcp/approvals/${requestId}/respond`, {
      method: 'POST',
      body: JSON.stringify({ decision, reason }),
    });
    await fetchPending();
    return data.request;
  }, [fetchPending]);

  useEffect(() => {
    fetchPending();
    // 5s 轮询
    const interval = setInterval(fetchPending, 5000);
    return () => clearInterval(interval);
  }, [fetchPending]);

  return { pending, loading, refetch: fetchPending, respondToApproval };
}

export function useAuditLog(filters?: {
  tool_name?: string;
  server_id?: string;
  session_id?: string;
  limit?: number;
  offset?: number;
  success_only?: boolean;
}) {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters?.tool_name) params.set('tool_name', filters.tool_name);
      if (filters?.server_id) params.set('server_id', filters.server_id);
      if (filters?.session_id) params.set('session_id', filters.session_id);
      if (filters?.limit) params.set('limit', String(filters.limit));
      if (filters?.offset) params.set('offset', String(filters.offset));
      if (filters?.success_only !== undefined) params.set('success_only', String(filters.success_only));
      const url = `/mcp/audit-log${params.toString() ? '?' + params.toString() : ''}`;
      const data = await apiFetch<{ logs: AuditLogEntry[]; total: number }>(url);
      setLogs(data.logs || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error('获取审计日志失败:', e);
    } finally {
      setLoading(false);
    }
  }, [filters?.tool_name, filters?.server_id, filters?.session_id, filters?.limit, filters?.offset, filters?.success_only]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  return { logs, total, loading, refetch: fetchLogs };
}

// ============================================================
// 双触发压缩 (Dual-Trigger Compaction)
// ============================================================

export interface DualTriggerConfig {
  pre_turn_enabled: boolean;
  mid_turn_enabled: boolean;
  mid_turn_threshold_ratio: number;
  remote_endpoint: string;
  remote_timeout_sec: number;
  remote_target_tokens: number;
  local_target_tokens: number;
  history_max_size: number;
}

export interface CompactionHistoryItem {
  id: string;
  session_id: string;
  trigger: 'manual' | 'pre_turn' | 'mid_turn';
  path: 'local' | 'remote';
  strategy: string;
  before_tokens: number;
  after_tokens: number;
  compacted_count: number;
  kept_count: number;
  summary: string;
  pending_request: any;
  duration_ms: number;
  created_at: string;
}

export function useDualCompactionConfig() {
  const [config, setConfig] = useState<DualTriggerConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ config: DualTriggerConfig }>('/compaction/dual/config');
      setConfig(data.config);
    } catch (e) {
      console.error('获取双触发配置失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (updates: Partial<DualTriggerConfig>) => {
    const data = await apiFetch<{ config: DualTriggerConfig }>('/compaction/dual/config', {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
    setConfig(data.config);
    return data.config;
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, loading, refetch: fetchConfig, updateConfig };
}

export async function preTurnCompact(
  sessionId: string,
  messages: any[],
  path: 'local' | 'remote' = 'local',
  strategy: string = 'hybrid',
) {
  return apiFetch<any>('/compaction/dual/pre-turn', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, messages, path, strategy }),
  });
}

export async function midTurnCompact(
  sessionId: string,
  messages: any[],
  pendingRequest?: any,
  path: 'local' | 'remote' = 'local',
  strategy: string = 'hybrid',
) {
  return apiFetch<any>('/compaction/dual/mid-turn', {
    method: 'POST',
    body: JSON.stringify({
      session_id: sessionId,
      messages,
      pending_request: pendingRequest,
      path,
      strategy,
    }),
  });
}

export function useCompactionHistory(sessionId?: string, limit = 50) {
  const [history, setHistory] = useState<CompactionHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchHistory = useCallback(async () => {
    if (!sessionId) {
      setHistory([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ history: CompactionHistoryItem[]; count: number }>(
        `/compaction/dual/history?session_id=${encodeURIComponent(sessionId)}&limit=${limit}`
      );
      setHistory(data.history || []);
    } catch (e) {
      console.error('获取压缩历史失败:', e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, limit]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { history, loading, refetch: fetchHistory };
}

// ============================================================
// SKILL.md 导入导出
// ============================================================

export async function importSkillMd(file: File, overwrite = false) {
  const formData = new FormData();
  formData.append('file', file);
  const url = `/skills/import?overwrite=${overwrite}`;
  // 改用 fetch 直接调用（multipart/form-data）
  const response = await fetch(`/api${url}`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw new Error(`Import failed: ${response.statusText}`);
  }
  return response.json();
}

export async function previewSkillMd(content: string) {
  return apiFetch<{ valid: boolean; errors: string[]; frontmatter: any }>('/skills/preview', {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function exportSkillUrl(skillId: string): string {
  return `/api/skills/${skillId}/export`;
}

// ============================================================
// Rules 多类型扫描 (T8)
// ============================================================

export type RuleFileType = 'AGENTS.md' | 'CLAUDE.md' | 'GEMINI.md' | '.cursorrules' | 'README.md';
export type RuleLayer = 'user' | 'project' | 'sub_directory' | 'override';

export interface RuleFile {
  id: string;
  file_type: RuleFileType;
  file_path: string;
  relative_path: string;
  project_path: string;
  layer: RuleLayer;
  priority: number;
  content: string;
  content_hash: string;
  size: number;
  enabled: boolean;
  last_loaded_at: string;
}

export interface RuleConflict {
  type: string;
  file_type: string;
  files: { path: string; layer: string; priority: number }[];
  winning_layer: string;
}

export function useRules() {
  const [rules, setRules] = useState<RuleFile[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchRules = useCallback(async (projectPath?: string) => {
    if (!projectPath) {
      setRules([]);
      return;
    }
    setLoading(true);
    try {
      const data = await apiFetch<{ rules: RuleFile[] }>(
        `/rules/list?project_path=${encodeURIComponent(projectPath)}`
      );
      setRules(data.rules || []);
    } catch (e) {
      console.error('获取规则列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const scanRules = useCallback(async (
    projectPath: string,
    fileTypes?: RuleFileType[],
    maxDepth = 3,
  ) => {
    const data = await apiFetch<{ rules: RuleFile[]; count: number }>('/rules/scan', {
      method: 'POST',
      body: JSON.stringify({
        project_path: projectPath,
        file_types: fileTypes,
        max_depth: maxDepth,
      }),
    });
    await fetchRules(projectPath);
    return data;
  }, [fetchRules]);

  const previewMerged = useCallback(async (projectPath: string, maxTotalSize = 16000) => {
    return apiFetch<{
      merged_content: string;
      layers: { layer: string; count: number }[];
      total_size: number;
      truncated: boolean;
      rules_count: number;
    }>(`/rules/preview?project_path=${encodeURIComponent(projectPath)}&max_total_size=${maxTotalSize}`);
  }, []);

  const getConflicts = useCallback(async (projectPath: string) => {
    return apiFetch<{ conflicts: RuleConflict[]; count: number }>(
      `/rules/conflicts?project_path=${encodeURIComponent(projectPath)}`
    );
  }, []);

  return { rules, loading, fetchRules, scanRules, previewMerged, getConflicts };
}
