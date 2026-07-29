/**
 * # ============================================================
 * # useGoalTemplatesApi - Goal 模板库 API 客户端
 * # ============================================================
 * # 核心作用：封装 Cycle 14 P1-5 模板库全部 REST 端点
 * #   1. 模板浏览（按 category/source/tag/keyword 过滤）
 * #   2. 模板 CRUD（创建/更新/删除）
 * #   3. Fork 内置模板
 * #   4. 实例化模板为 Goal
 * #   5. 导入/导出
 * #   6. Meta 端点（类别/来源）
 * # 运行流程：
 * #   1. 组件调用 listTemplates / forkTemplate / instantiate
 * #   2. 后端返回结果，前端保存到状态
 * #   3. 失败时抛出 Error 供组件 catch
 * # 输入参数：通过方法参数传递 API 端点和数据
 * # 输出结果：统一的 Promise<T> 返回值
 * # 修改记录：
 * #   - 2026-07-29 | v6.33.0 | Cycle 14 P1-5 初始版本
 * # ============================================================
 */

import { useState } from 'react';
import { apiFetch } from './apiShared';

// ============================================================
// 类型定义
// ============================================================

export type TemplateCategory =
  | 'development'
  | 'research'
  | 'documentation'
  | 'testing'
  | 'devops'
  | 'other';

export type TemplateSource = 'builtin' | 'custom';

export type TurnStrategy = 'conservative' | 'standard' | 'aggressive';
export type TurnTrigger =
  | 'time_based'
  | 'ac_completed'
  | 'token_budget'
  | 'manual'
  | 'external';

export interface AcceptanceCriterionTemplate {
  ac_id: string;
  title: string;
  description: string;
  priority: number;
  ac_type: string;
  risk_level: string;
  verify_items: any[];
}

export interface GoalTemplate {
  template_id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  source: TemplateSource;
  version: number;
  tags: string[];
  acceptance_criteria: AcceptanceCriterionTemplate[];
  default_strategy: TurnStrategy;
  default_max_turns: number;
  default_triggers: TurnTrigger[];
  recommended_agents: string[];
  estimated_duration_min: number;
  created_at: string;
  updated_at: string;
  instantiations: number;
  last_used_at: string | null;
  created_by: string;
  metadata: Record<string, any>;
}

export interface TemplateInstantiation {
  template_id: string;
  goal_id: string;
  instantiated_at: string;
  ac_count: number;
}

export interface TemplateMeta {
  categories: { value: string; name: string }[];
  sources: { value: string; name: string }[];
}

export interface TemplateStats {
  total_templates: number;
  builtin_templates: number;
  custom_templates: number;
  by_category: Record<string, number>;
  total_instantiations: number;
  most_used: { template_id: string; name: string; instantiations: number }[];
  categories: string[];
  sources: string[];
}

// ============================================================
// API Hook
// ============================================================

export const useGoalTemplatesApi = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = async <T,>(path: string, options?: RequestInit): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      return await apiFetch<T>(`/goal-templates${path}`, options);
    } catch (e: any) {
      const msg = e?.message || 'Request failed';
      setError(msg);
      throw e;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    setError,

    // 健康检查 / 统计
    health: () => request<{ status: string; version: string; module: string }>(`/health`),
    getStats: () => request<{ success: boolean; stats: TemplateStats }>(`/stats`),

    // 模板 CRUD
    listTemplates: (params?: {
      category?: TemplateCategory;
      source?: TemplateSource;
      tag?: string;
      keyword?: string;
      limit?: number;
    }) => {
      const qs = new URLSearchParams();
      if (params?.category) qs.set('category', params.category);
      if (params?.source) qs.set('source', params.source);
      if (params?.tag) qs.set('tag', params.tag);
      if (params?.keyword) qs.set('keyword', params.keyword);
      if (params?.limit) qs.set('limit', String(params.limit));
      const q = qs.toString();
      return request<{ success: boolean; count: number; templates: GoalTemplate[] }>(
        `/templates${q ? '?' + q : ''}`,
      );
    },
    getTemplate: (templateId: string) =>
      request<{ success: boolean; template: GoalTemplate }>(`/templates/${templateId}`),
    createTemplate: (data: {
      name: string;
      description?: string;
      category: TemplateCategory;
      tags: string[];
      acceptance_criteria: AcceptanceCriterionTemplate[];
      default_strategy?: TurnStrategy;
      default_max_turns?: number;
      default_triggers?: TurnTrigger[];
      recommended_agents?: string[];
      estimated_duration_min?: number;
      metadata?: Record<string, any>;
    }) =>
      request<{ success: boolean; template: GoalTemplate }>(`/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    updateTemplate: (
      templateId: string,
      data: Partial<{
        name: string;
        description: string;
        category: TemplateCategory;
        tags: string[];
        acceptance_criteria: AcceptanceCriterionTemplate[];
        default_strategy: TurnStrategy;
        default_max_turns: number;
        default_triggers: TurnTrigger[];
        recommended_agents: string[];
        estimated_duration_min: number;
        metadata: Record<string, any>;
      }>,
    ) =>
      request<{ success: boolean; template: GoalTemplate }>(`/templates/${templateId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    deleteTemplate: (templateId: string) =>
      request<{ success: boolean; template_id: string; unregistered: boolean }>(
        `/templates/${templateId}`,
        { method: 'DELETE' },
      ),

    // Fork / 实例化
    forkTemplate: (templateId: string, newName?: string, newTags?: string[]) =>
      request<{ success: boolean; template: GoalTemplate }>(
        `/templates/${templateId}/fork`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ new_name: newName, new_tags: newTags }),
        },
      ),
    instantiateTemplate: (templateId: string, goalId?: string) =>
      request<{
        success: boolean;
        template_id: string;
        instantiation: TemplateInstantiation;
        goal_config: Record<string, any>;
      }>(`/templates/${templateId}/instantiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal_id: goalId }),
      }),

    // 导入 / 导出
    exportTemplate: (templateId: string) =>
      request<{ success: boolean; template: GoalTemplate }>(`/templates/${templateId}/export`),
    importTemplate: (data: any, newTemplateId?: string) =>
      request<{ success: boolean; template: GoalTemplate }>(`/templates/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, new_template_id: newTemplateId }),
      }),

    // 实例化历史
    getInstantiations: (templateId?: string, limit?: number) => {
      const qs = new URLSearchParams();
      if (templateId) qs.set('template_id', templateId);
      if (limit) qs.set('limit', String(limit));
      const q = qs.toString();
      return request<{ success: boolean; count: number; history: TemplateInstantiation[] }>(
        `/instantiations${q ? '?' + q : ''}`,
      );
    },

    // Meta
    getCategories: () =>
      request<{ success: boolean; categories: { value: string; name: string }[] }>(
        `/meta/categories`,
      ),
    getSources: () =>
      request<{ success: boolean; sources: { value: string; name: string }[] }>(
        `/meta/sources`,
      ),
  };
};

export const CATEGORY_LABELS: Record<TemplateCategory, { label: string; icon: string; color: string }> = {
  development: { label: '软件开发', icon: '💻', color: 'blue' },
  research: { label: '研究探索', icon: '🔬', color: 'violet' },
  documentation: { label: '文档', icon: '📝', color: 'amber' },
  testing: { label: '测试', icon: '🧪', color: 'emerald' },
  devops: { label: '部署运维', icon: '🚀', color: 'rose' },
  other: { label: '其他', icon: '📦', color: 'gray' },
};

export const SOURCE_LABELS: Record<TemplateSource, { label: string; color: string }> = {
  builtin: { label: '内置', color: 'blue' },
  custom: { label: '自定义', color: 'emerald' },
};

export const STRATEGY_LABELS: Record<TurnStrategy, { label: string; color: string }> = {
  conservative: { label: '保守', color: 'amber' },
  standard: { label: '标准', color: 'blue' },
  aggressive: { label: '激进', color: 'rose' },
};
