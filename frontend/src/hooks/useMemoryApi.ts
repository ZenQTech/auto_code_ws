/**
 * # ============================================================
 * Memory System 高级 API 客户端（v1.0.0 - Cycle 10 P1-8）
 * # ============================================================
 * 核心作用：封装 /api/memory/* 全部端点（Entity/Relation/Observation CRUD +
 *           Search/Graph + memory-kernel/self-improvement/memory-recall skill）
 * 运行流程：
 *   1. 组件挂载时调用 fetchStats() 拉取全局统计
 *   2. 用户创建/查询/更新/删除 entity 时调用对应 API
 *   3. 用户添加 observation 时调用 addObservation()
 *   4. 用户搜索时调用 searchMemory()
 *   5. memory-kernel / self-improvement / memory-recall skill 通过
 *      callMemoryKernel() / callSelfImprovement() / callMemoryRecall() 访问
 * 输入参数：每个函数接收对应的参数对象
 * 输出结果：Promise<T>，T 为后端 API 响应类型
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import { apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

/** 实体类型 */
export type EntityTypeName =
  | 'project'
  | 'pattern'
  | 'preference'
  | 'profile'
  | 'fact';

/** 关系类型 */
export type RelationTypeName =
  | 'depends_on'
  | 'uses'
  | 'solves'
  | 'conflicts'
  | 'extends'
  | 'related_to';

/** 来源类型 */
export type ObservationSourceName = 'user' | 'agent' | 'system';

/** 实体 */
export interface MemoryEntity {
  name: string;
  entity_type: string;
  project: string;
  metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
  observations?: MemoryObservation[];
  relations?: MemoryRelation[];
}

/** 关系 */
export interface MemoryRelation {
  id: string;
  source: string;
  target: string;
  relation_type: string;
  weight: number;
  created_at: string;
}

/** 观察 */
export interface MemoryObservation {
  id: string;
  entity_name: string;
  content: string;
  source: string;
  confidence: number;
  created_at: string;
}

/** 搜索结果 */
export interface MemorySearchResult {
  entity: MemoryEntity;
  score: number;
  observations: MemoryObservation[];
}

/** 统计 */
export interface MemoryStats {
  total_entities: number;
  total_relations: number;
  total_observations: number;
  by_type: Record<string, number>;
  by_project: Record<string, number>;
  memory_dir: string;
}

/** 图谱 */
export interface MemoryGraph {
  entities: MemoryEntity[];
  relations: MemoryRelation[];
  observations: MemoryObservation[];
}

/** memory-kernel skill 请求 */
export interface MemoryKernelPayload {
  action: 'read' | 'write' | 'update' | 'delete';
  name?: string;
  entity_type?: EntityTypeName;
  project?: string;
  observations?: string[];
  metadata?: Record<string, any>;
  query?: string;
  force?: boolean;
}

/** self-improvement skill 请求 */
export interface SelfImprovementPayload {
  error_type: string;
  summary: string;
  occurrences: number;
  verified: boolean;
}

/** memory-recall skill 请求 */
export interface MemoryRecallPayload {
  query: string;
  limit?: number;
}

// ============================================================
// API 方法
// ============================================================

/** 健康检查 */
export const fetchHealth = () =>
  apiFetch<{
    success: boolean;
    service: string;
    version: string;
    memory_dir: string;
  }>('/memory/health');

/** 获取统计信息 */
export const fetchStats = () =>
  apiFetch<{ success: boolean; data: MemoryStats }>('/memory/stats');

/** 获取图谱 */
export const fetchGraph = () =>
  apiFetch<{ success: boolean; data: MemoryGraph }>('/memory/graph');

/** 列出实体 */
export const listEntities = (params?: {
  entity_type?: EntityTypeName;
  project?: string;
  limit?: number;
}) => {
  const search = new URLSearchParams();
  if (params?.entity_type) search.append('entity_type', params.entity_type);
  if (params?.project) search.append('project', params.project);
  if (params?.limit) search.append('limit', String(params.limit));
  const qs = search.toString();
  return apiFetch<{ success: boolean; data: MemoryEntity[]; total: number }>(
    `/memory/entities${qs ? `?${qs}` : ''}`
  );
};

/** 查询实体 */
export const getEntity = (name: string) =>
  apiFetch<{ success: boolean; data: MemoryEntity }>(
    `/memory/entities/${encodeURIComponent(name)}`
  );

/** 创建实体 */
export const createEntity = (payload: {
  name: string;
  entity_type: EntityTypeName;
  project?: string;
  metadata?: Record<string, any>;
}) =>
  apiFetch<{ success: boolean; action: string; data: MemoryEntity }>(
    '/memory/entities',
    {
      method: 'POST',
      body: JSON.stringify({
        project: '_global',
        metadata: {},
        ...payload,
      }),
    }
  );

/** 更新实体 */
export const updateEntity = (
  name: string,
  payload: {
    entity_type?: EntityTypeName;
    project?: string;
    metadata?: Record<string, any>;
  }
) =>
  apiFetch<{ success: boolean; data: MemoryEntity }>(
    `/memory/entities/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      body: JSON.stringify(payload),
    }
  );

/** 删除实体 */
export const deleteEntity = (name: string, force = false) =>
  apiFetch<{ success: boolean; name: string }>(
    `/memory/entities/${encodeURIComponent(name)}${force ? '?force=true' : ''}`,
    { method: 'DELETE' }
  );

/** 创建关系 */
export const createRelation = (payload: {
  source: string;
  target: string;
  relation_type: RelationTypeName;
  weight?: number;
}) =>
  apiFetch<{ success: boolean; data: MemoryRelation }>(
    '/memory/relations',
    {
      method: 'POST',
      body: JSON.stringify({
        weight: 1.0,
        ...payload,
      }),
    }
  );

/** 列出关系 */
export const listRelations = (params?: { source?: string; target?: string }) => {
  const search = new URLSearchParams();
  if (params?.source) search.append('source', params.source);
  if (params?.target) search.append('target', params.target);
  const qs = search.toString();
  return apiFetch<{ success: boolean; data: MemoryRelation[]; total: number }>(
    `/memory/relations${qs ? `?${qs}` : ''}`
  );
};

/** 删除关系 */
export const deleteRelation = (relationId: string) =>
  apiFetch<{ success: boolean; relation_id: string }>(
    `/memory/relations/${encodeURIComponent(relationId)}`,
    { method: 'DELETE' }
  );

/** 添加观察 */
export const addObservation = (payload: {
  entity_name: string;
  content: string;
  source?: ObservationSourceName;
  confidence?: number;
}) =>
  apiFetch<{ success: boolean; data: MemoryObservation }>(
    '/memory/observations',
    {
      method: 'POST',
      body: JSON.stringify({
        source: 'agent',
        confidence: 1.0,
        ...payload,
      }),
    }
  );

/** 删除观察 */
export const deleteObservation = (observationId: string) =>
  apiFetch<{ success: boolean; observation_id: string }>(
    `/memory/observations/${encodeURIComponent(observationId)}`,
    { method: 'DELETE' }
  );

/** 搜索 */
export const searchMemory = (q: string, limit = 10) =>
  apiFetch<{
    success: boolean;
    data: MemorySearchResult[];
    total: number;
    query: string;
    source: string;
  }>(`/memory/search?q=${encodeURIComponent(q)}&limit=${limit}`);

/** 调用 memory-kernel skill */
export const callMemoryKernel = (payload: MemoryKernelPayload) =>
  apiFetch<{ success: boolean; action: string; data?: any }>(
    '/memory/skill/memory-kernel',
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

/** 调用 self-improvement skill */
export const callSelfImprovement = (payload: SelfImprovementPayload) =>
  apiFetch<{
    success: boolean;
    action: string;
    promoted: boolean;
    reason?: string;
    pattern_name?: string;
  }>('/memory/skill/self-improvement', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** 调用 memory-recall skill */
export const callMemoryRecall = (payload: MemoryRecallPayload) =>
  apiFetch<{
    success: boolean;
    action: string;
    query: string;
    results: MemorySearchResult[];
    total: number;
    source: string;
  }>('/memory/skill/memory-recall', {
    method: 'POST',
    body: JSON.stringify({ limit: 5, ...payload }),
  });
