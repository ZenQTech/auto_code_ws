/**
 * # ============================================================
 * Cycle 2 API Hooks - 新功能
 * # ============================================================
 * 核心作用：封装 Cycle 2 新增的 API hooks
 * 包含：MCP、Compaction、Fork/Resume、Skills、AGENTS.md
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiShared';

// ============================================================
// MCP (Model Context Protocol) Hooks
// ============================================================

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: any;
  server_id: string;
  server_name: string;
}

export interface MCPServer {
  id: string;
  name: string;
  transport: string;
  enabled: boolean;
  tool_count: number;
}

export function useMCPServers() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ servers: MCPServer[] }>('/mcp/servers');
      setServers(data.servers || []);
    } catch (e) {
      console.error('获取 MCP servers 失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return { servers, loading, refetch: fetchServers };
}

export function useMCPTools() {
  const [tools, setTools] = useState<MCPTool[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTools = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ tools: MCPTool[] }>('/mcp/tools');
      setTools(data.tools || []);
    } catch (e) {
      console.error('获取 MCP tools 失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTools();
  }, [fetchTools]);

  return { tools, loading, refetch: fetchTools };
}

export async function callMCPTool(toolName: string, arguments_: Record<string, any>, serverId?: string) {
  return apiFetch<{ success: boolean; result: any }>('/mcp/tools/call', {
    method: 'POST',
    body: JSON.stringify({ tool_name: toolName, arguments: arguments_, server_id: serverId }),
  });
}

// ============================================================
// Compaction Hooks
// ============================================================

export interface CompactionConfig {
  enabled: boolean;
  auto_trigger: boolean;
  max_tokens: number;
  max_messages: number;
  keep_recent: number;
  strategy: string;
}

export interface CompactionResult {
  success: boolean;
  before: any;
  after: any;
  summary: string;
  compacted_count?: number;
  kept_count?: number;
  error?: string;
}

export function useCompactionConfig() {
  const [config, setConfig] = useState<CompactionConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<{ config: CompactionConfig }>('/compaction/config');
      setConfig(data.config);
    } catch (e) {
      console.error('获取压缩配置失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateConfig = useCallback(async (updates: Partial<CompactionConfig>) => {
    try {
      const data = await apiFetch<{ config: CompactionConfig }>('/compaction/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      setConfig(data.config);
      return data.config;
    } catch (e) {
      console.error('更新压缩配置失败:', e);
      throw e;
    }
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  return { config, loading, refetch: fetchConfig, updateConfig };
}

export async function compactSession(
  sessionId: string,
  strategy?: string,
  keepRecent?: number
): Promise<CompactionResult> {
  return apiFetch<CompactionResult>(`/sessions/${sessionId}/compact`, {
    method: 'POST',
    body: JSON.stringify({ strategy, keep_recent: keepRecent }),
  });
}

export async function getSessionTokens(sessionId: string) {
  return apiFetch<{
    token_count: number;
    message_count: number;
    active_count: number;
    compacted_count: number;
  }>(`/sessions/${sessionId}/tokens`);
}

export async function shouldCompactSession(sessionId: string) {
  return apiFetch<{ should_compact: boolean; stats: any; config: CompactionConfig }>(
    `/sessions/${sessionId}/should-compact`
  );
}

// ============================================================
// Session Fork/Resume Hooks
// ============================================================

export interface SessionDetail {
  id: string;
  title: string;
  created_at: string;
  last_active_at: string;
  user_first_message: string;
  message_count: number;
  status: string;
  mode: string;
  workflow_id: string | null;
  workflow_stage: string | null;
  parent_session_id: string | null;
  forked_at: string | null;
  fork_point_message_id: string | null;
  is_archived: boolean;
  device_id: string | null;
}

export interface Lineage {
  success: boolean;
  session_id: string;
  root_id: string;
  ancestors: SessionDetail[];
  descendants: SessionDetail[];
  ancestor_count: number;
  descendant_count: number;
}

export async function forkSession(
  sourceId: string,
  title?: string,
  forkPointMessageId?: string
) {
  return apiFetch<{
    success: boolean;
    session: { id: string; title: string; parent_session_id: string };
    messages_copied: number;
  }>(`/sessions/${sourceId}/fork`, {
    method: 'POST',
    body: JSON.stringify({ title, fork_point_message_id: forkPointMessageId }),
  });
}

export async function resumeSession(sessionId: string, deviceId?: string) {
  return apiFetch<{ success: boolean; session: SessionDetail; messages: any[] }>(
    `/sessions/${sessionId}/resume`,
    {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId }),
    }
  );
}

export async function getSessionLineage(sessionId: string) {
  return apiFetch<Lineage>(`/sessions/${sessionId}/lineage`);
}

export async function archiveSession(sessionId: string) {
  return apiFetch<{ success: boolean }>(`/sessions/${sessionId}/archive`, {
    method: 'POST',
  });
}

export async function unarchiveSession(sessionId: string) {
  return apiFetch<{ success: boolean }>(`/sessions/${sessionId}/unarchive`, {
    method: 'POST',
  });
}

// ============================================================
// Skills Hooks
// ============================================================

export interface Skill {
  id: string;
  name: string;
  display_name: string;
  description: string;
  system_prompt: string;
  tools: string[];
  enabled: boolean;
  source: string;
  version: string;
  created_at: string;
  updated_at: string;
}

export function useSkills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSkills = useCallback(async (enabledOnly = false) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ skills: Skill[]; count: number }>(
        `/skills${enabledOnly ? '?enabled_only=true' : ''}`
      );
      setSkills(data.skills || []);
    } catch (e) {
      console.error('获取 Skills 失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const setSkillEnabled = useCallback(async (skillId: string, enabled: boolean) => {
    const endpoint = enabled ? 'enable' : 'disable';
    const data = await apiFetch<{ skill: Skill }>(`/skills/${skillId}/${endpoint}`, {
      method: 'POST',
    });
    setSkills(prev => prev.map(s => (s.id === skillId ? data.skill : s)));
    return data.skill;
  }, []);

  const createSkill = useCallback(
    async (skill: { name: string; display_name: string; description: string; system_prompt: string; tools?: string[] }) => {
      const data = await apiFetch<{ skill: Skill }>('/skills', {
        method: 'POST',
        body: JSON.stringify(skill),
      });
      setSkills(prev => [...prev, data.skill]);
      return data.skill;
    },
    []
  );

  const deleteSkill = useCallback(async (skillId: string) => {
    await apiFetch(`/skills/${skillId}`, { method: 'DELETE' });
    setSkills(prev => prev.filter(s => s.id !== skillId));
  }, []);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  return { skills, loading, refetch: fetchSkills, setSkillEnabled, createSkill, deleteSkill };
}

// ============================================================
// AGENTS.md Memory Hooks
// ============================================================

export interface AgentsMemory {
  id: string;
  file_path: string;
  relative_path: string;
  project_path: string;
  size: number;
  enabled: boolean;
  last_loaded_at: string;
}

export function useAgentsMd() {
  const [memories, setMemories] = useState<AgentsMemory[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchMemories = useCallback(async (enabledOnly = false) => {
    setLoading(true);
    try {
      const data = await apiFetch<{ memories: AgentsMemory[]; count: number }>(
        `/agents-md/list${enabledOnly ? '?enabled_only=true' : ''}`
      );
      setMemories(data.memories || []);
    } catch (e) {
      console.error('获取 AGENTS.md 失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  const scan = useCallback(async (projectPath: string, maxDepth = 3) => {
    const data = await apiFetch<{ found_count: number; memories: AgentsMemory[] }>(
      '/agents-md/scan',
      {
        method: 'POST',
        body: JSON.stringify({ project_path: projectPath, max_depth: maxDepth }),
      }
    );
    await fetchMemories();
    return data;
  }, [fetchMemories]);

  const setEnabled = useCallback(async (memoryId: string, enabled: boolean) => {
    const endpoint = enabled ? 'enable' : 'disable';
    await apiFetch(`/agents-md/${memoryId}/${endpoint}`, { method: 'POST' });
    setMemories(prev => prev.map(m => (m.id === memoryId ? { ...m, enabled } : m)));
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  return { memories, loading, refetch: fetchMemories, scan, setEnabled };
}
