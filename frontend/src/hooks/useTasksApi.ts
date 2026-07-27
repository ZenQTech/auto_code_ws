import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiShared';
import type { Conversation, LoopWorkflowStatus, StatsOverview, Task, UsageOverview } from '../types';

/**
 * # ============================================================
 * 任务 API 模块
 * # ============================================================
 * 核心作用：封装任务/对话/统计/工作流状态 API
 * 拆分日期：2026-07-27
 * 来源文件：hooks/useApi.ts (v3.0.0, 1872 行单文件)
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 useTasks + useConversations + useStats + useUsage + executeTask + validateTask + fetchWorkflowStatus 共 7 个函数
 * ============================================================
 */

/**
 * 共享类型导入
 */
export function useTasks(agentId?: string) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const params = agentId ? `?agent_id=${agentId}` : '';
      const data = await apiFetch<Task[]>(`/tasks${params}`);
      setTasks(data);
    } catch (e) {
      console.error('获取任务列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  return { tasks, loading, refetch: fetchTasks };
}

/** 获取对话记录 */
export function useConversations(taskId?: string, agentId?: string) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConversations = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (taskId) params.set('task_id', taskId);
      if (agentId) params.set('agent_id', agentId);
      const data = await apiFetch<Conversation[]>(`/conversations?${params}`);
      setConversations(data);
    } catch (e) {
      console.error('获取对话记录失败:', e);
    } finally {
      setLoading(false);
    }
  }, [taskId, agentId]);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  return { conversations, loading, refetch: fetchConversations };
}

/** 获取统计概览 */
export function useStats() {
  const [stats, setStats] = useState<StatsOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<StatsOverview>('/stats/overview');
      setStats(data);
    } catch (e) {
      console.error('获取统计数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  return { stats, loading, refetch: fetchStats };
}

/** 获取用量监控数据 */
export function useUsage() {
  const [usage, setUsage] = useState<UsageOverview | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<UsageOverview>('/usage/overview');
      setUsage(data);
    } catch (e) {
      console.error('获取用量数据失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage();
    // 每 30 秒自动刷新
    const interval = setInterval(fetchUsage, 30000);
    return () => clearInterval(interval);
  }, [fetchUsage]);

  return { usage, loading, refetch: fetchUsage };
}

/** 执行任务 */
export async function executeTask(taskId: string): Promise<Record<string, unknown>> {
  return apiFetch('/workflow/execute', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  });
}

/** 验证任务 */
export async function validateTask(taskId: string): Promise<Record<string, unknown>> {
  return apiFetch('/workflow/validate', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  });
}

/**
 * 获取 Loop Engineering 工作流状态
 * 作用：根据 workflow_id 拉取工作流完整状态（含 current_stage / iteration_count / stages 等），
 *       供 App.tsx 检测 clarifying 等阶段以分流消息发送
 * 调用方：App.tsx workflowStatus 拉取 useEffect / handleSendMessage onDone 刷新逻辑
 * 被调用方：GET /api/workflow/{id}/status
 * 参数：
 *   - workflowId: string，工作流唯一标识
 * 返回值：Promise<LoopWorkflowStatus>，工作流整体状态对象
 */
export async function fetchWorkflowStatus(workflowId: string): Promise<LoopWorkflowStatus> {
  return apiFetch<LoopWorkflowStatus>(`/workflow/${workflowId}/status`);
}

// ============================================================
// 架构设计阶段 API（v2.0.0 新增）

