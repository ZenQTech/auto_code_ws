import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from './apiShared';
import type { Agent } from '../types';

/**
 * # ============================================================
 * 智能体 API 模块
 * # ============================================================
 * 核心作用：封装智能体列表查询与删除操作
 * 拆分日期：2026-07-27
 * 来源文件：hooks/useApi.ts (v3.0.0, 1872 行单文件)
 * 模块版本：v6.5.0 - P0-3 useApi.ts 拆分第一阶段
 * 修改记录：
 *   - 2026-07-27 | v6.5.0 | 从 useApi.ts 抽离 useAgents + deleteAgent 共 2 个函数
 * ============================================================
 */

/**
 * 共享类型导入
 */
export function useAgents() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Agent[]>('/agents');
      setAgents(data);
    } catch (e) {
      console.error('获取智能体列表失败:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  return { agents, loading, refetch: fetchAgents };
}

/** 删除智能体 */
export async function deleteAgent(agentId: string): Promise<void> {
  await apiFetch(`/agents/${agentId}`, { method: 'DELETE' });
}

