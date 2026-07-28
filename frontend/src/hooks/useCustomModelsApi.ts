/**
 * # ============================================================
 * useCustomModelsApi - Custom Models + Bearer Token API Hook
 * # ============================================================
 * 核心作用：封装自定义模型 + Bearer Token 自动刷新的所有 REST API
 * 借鉴：Codex v0.150+ Dynamic Bearer Tokens + TRAE /model 命令
 * 封装 API：
 *   - useAllModels()        列出所有模型（内置 + 自定义）
 *   - useProviders()        列出 providers
 *   - useCreateProvider()   创建 provider
 *   - useUpdateProvider()   更新 provider
 *   - useDeleteProvider()   删除 provider
 *   - useTestProvider()     测试 provider 连接
 *   - useRefreshProvider()  手动刷新 token
 *   - useStatus()           全局刷新状态
 *   - useSummary()          摘要统计
 *   - useAddModel()         添加模型条目
 *   - useDeleteModel()      删除模型条目
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0 - Cycle 8 P0-14
 * ============================================================
 */

import { useState, useCallback, useEffect } from 'react';

// ============================================================
// 常量
// ============================================================

const API_BASE = '/api';
const CUSTOM_MODELS_BASE = `${API_BASE}/custom-models`;

// ============================================================
// 类型定义
// ============================================================

/** 模型提供商类型 */
export type ProviderType = 'openai' | 'anthropic' | 'azure' | 'custom';

/** 模型提供商 */
export interface ModelProvider {
  id: string;
  name: string;
  type: ProviderType;
  base_url: string;
  api_key_masked: string;
  expires_at: number | null;
  enabled: boolean;
  created_at: number;
  updated_at: number;
  metadata: Record<string, unknown>;
}

/** 模型条目（内置 + 自定义） */
export interface ModelInfo {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  tagline?: string;
  description?: string;
  max_tokens: number;
  context_window: number;
  selected: boolean;
  is_custom?: boolean;
  provider_name?: string;
  provider_type?: ProviderType;
}

/** 摘要 */
export interface CustomModelsSummary {
  total_providers: number;
  total_models: number;
  by_type: Record<string, number>;
  builtin_models: number;
  refresh_status: {
    total_providers: number;
    expired: number;
    expiring_soon: number;
    background_running: boolean;
  };
}

/** 测试结果 */
export interface TestProviderResult {
  success: boolean;
  provider_id: string;
  provider_name: string;
  base_url: string;
  type: ProviderType;
  latency_ms: number;
  models_available: number;
  tested_at: number;
}

/** Token 刷新结果 */
export interface RefreshResult {
  success: boolean;
  provider_id: string;
  new_expires_at: number | null;
  error: string | null;
  duration_ms: number;
}

// ============================================================
// 通用 API 调用
// ============================================================

async function apiFetch<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });
  if (!response.ok) {
    let detail: string = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {
      /* ignore parse error */
    }
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }
  return response.json() as Promise<T>;
}

// ============================================================
// useAllModels - 列出所有模型
// ============================================================

export interface UseAllModelsResult {
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** 列出所有模型（内置 + 自定义） */
export function useAllModels(): UseAllModelsResult {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; models: ModelInfo[] }>(
        `${CUSTOM_MODELS_BASE}/models`
      );
      if (data.success) {
        setModels(data.models);
      }
    } catch (e) {
      setError((e as Error).message || '加载模型失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { models, loading, error, refetch };
}

// ============================================================
// useProviders - 列出 providers
// ============================================================

export interface UseProvidersResult {
  providers: ModelProvider[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** 列出所有模型提供商 */
export function useProviders(enabledOnly: boolean = false): UseProvidersResult {
  const [providers, setProviders] = useState<ModelProvider[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = enabledOnly
        ? `${CUSTOM_MODELS_BASE}/providers?enabled_only=true`
        : `${CUSTOM_MODELS_BASE}/providers`;
      const data = await apiFetch<{ success: boolean; providers: ModelProvider[] }>(url);
      if (data.success) {
        setProviders(data.providers);
      }
    } catch (e) {
      setError((e as Error).message || '加载 providers 失败');
    } finally {
      setLoading(false);
    }
  }, [enabledOnly]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { providers, loading, error, refetch };
}

// ============================================================
// useCreateProvider
// ============================================================

export interface CreateProviderInput {
  name: string;
  type: ProviderType;
  base_url: string;
  api_key?: string;
  refresh_token?: string;
  expires_at?: number;
  metadata?: Record<string, unknown>;
}

export interface UseCreateProviderResult {
  createProvider: (input: CreateProviderInput) => Promise<ModelProvider | null>;
  loading: boolean;
  error: string | null;
}

/** 创建 provider */
export function useCreateProvider(): UseCreateProviderResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const createProvider = useCallback(async (input: CreateProviderInput) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; provider: ModelProvider }>(
        `${CUSTOM_MODELS_BASE}/providers`,
        { method: 'POST', body: JSON.stringify(input) }
      );
      return data.provider;
    } catch (e) {
      setError((e as Error).message || '创建失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { createProvider, loading, error };
}

// ============================================================
// useUpdateProvider
// ============================================================

export interface UpdateProviderInput {
  name?: string;
  type?: ProviderType;
  base_url?: string;
  api_key?: string;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UseUpdateProviderResult {
  updateProvider: (id: string, input: UpdateProviderInput) => Promise<ModelProvider | null>;
  loading: boolean;
  error: string | null;
}

/** 更新 provider */
export function useUpdateProvider(): UseUpdateProviderResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const updateProvider = useCallback(async (id: string, input: UpdateProviderInput) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; provider: ModelProvider }>(
        `${CUSTOM_MODELS_BASE}/providers/${id}`,
        { method: 'PATCH', body: JSON.stringify(input) }
      );
      return data.provider;
    } catch (e) {
      setError((e as Error).message || '更新失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { updateProvider, loading, error };
}

// ============================================================
// useDeleteProvider
// ============================================================

export interface UseDeleteProviderResult {
  deleteProvider: (id: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** 删除 provider */
export function useDeleteProvider(): UseDeleteProviderResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const deleteProvider = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean }>(
        `${CUSTOM_MODELS_BASE}/providers/${id}`,
        { method: 'DELETE' }
      );
      return data.success;
    } catch (e) {
      setError((e as Error).message || '删除失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { deleteProvider, loading, error };
}

// ============================================================
// useTestProvider
// ============================================================

export interface UseTestProviderResult {
  testProvider: (id: string) => Promise<TestProviderResult | null>;
  loading: boolean;
  error: string | null;
  lastResult: TestProviderResult | null;
}

/** 测试 provider 连接 */
export function useTestProvider(): UseTestProviderResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<TestProviderResult | null>(null);

  const testProvider = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; test: TestProviderResult }>(
        `${CUSTOM_MODELS_BASE}/providers/${id}/test`,
        { method: 'POST' }
      );
      if (data.success) {
        setLastResult(data.test);
        return data.test;
      }
      return null;
    } catch (e) {
      setError((e as Error).message || '测试失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { testProvider, loading, error, lastResult };
}

// ============================================================
// useRefreshProvider
// ============================================================

export interface UseRefreshProviderResult {
  refreshProvider: (id: string) => Promise<RefreshResult | null>;
  loading: boolean;
  error: string | null;
}

/** 手动刷新 provider 的 token */
export function useRefreshProvider(): UseRefreshProviderResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshProvider = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; refresh: RefreshResult }>(
        `${CUSTOM_MODELS_BASE}/providers/${id}/refresh`,
        { method: 'POST' }
      );
      return data.refresh;
    } catch (e) {
      setError((e as Error).message || '刷新失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { refreshProvider, loading, error };
}

// ============================================================
// useStatus
// ============================================================

export interface UseStatusResult {
  status: CustomModelsSummary['refresh_status'] | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** 全局刷新状态 */
export function useStatus(): UseStatusResult {
  const [status, setStatus] = useState<CustomModelsSummary['refresh_status'] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; status: CustomModelsSummary['refresh_status'] }>(
        `${CUSTOM_MODELS_BASE}/status`
      );
      if (data.success) {
        setStatus(data.status);
      }
    } catch (e) {
      setError((e as Error).message || '加载状态失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { status, loading, error, refetch };
}

// ============================================================
// useSummary
// ============================================================

export interface UseSummaryResult {
  summary: CustomModelsSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

/** 获取摘要统计 */
export function useSummary(): UseSummaryResult {
  const [summary, setSummary] = useState<CustomModelsSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; summary: CustomModelsSummary }>(
        `${CUSTOM_MODELS_BASE}/summary`
      );
      if (data.success) {
        setSummary(data.summary);
      }
    } catch (e) {
      setError((e as Error).message || '加载摘要失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { summary, loading, error, refetch };
}

// ============================================================
// useAddModel
// ============================================================

export interface AddModelInput {
  provider_id: string;
  model_id: string;
  display_name: string;
  max_tokens?: number;
  context_window?: number;
  temperature_default?: number;
  metadata?: Record<string, unknown>;
}

export interface UseAddModelResult {
  addModel: (input: AddModelInput) => Promise<Record<string, unknown> | null>;
  loading: boolean;
  error: string | null;
}

/** 添加模型条目 */
export function useAddModel(): UseAddModelResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const addModel = useCallback(async (input: AddModelInput) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; model: Record<string, unknown> }>(
        `${CUSTOM_MODELS_BASE}/models`,
        { method: 'POST', body: JSON.stringify(input) }
      );
      return data.model;
    } catch (e) {
      setError((e as Error).message || '添加模型失败');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { addModel, loading, error };
}

// ============================================================
// useDeleteModel
// ============================================================

export interface UseDeleteModelResult {
  deleteModel: (id: string) => Promise<boolean>;
  loading: boolean;
  error: string | null;
}

/** 删除模型条目 */
export function useDeleteModel(): UseDeleteModelResult {
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const deleteModel = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean }>(
        `${CUSTOM_MODELS_BASE}/models/${id}`,
        { method: 'DELETE' }
      );
      return data.success;
    } catch (e) {
      setError((e as Error).message || '删除模型失败');
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { deleteModel, loading, error };
}

// 默认导出
export default {
  useAllModels,
  useProviders,
  useCreateProvider,
  useUpdateProvider,
  useDeleteProvider,
  useTestProvider,
  useRefreshProvider,
  useStatus,
  useSummary,
  useAddModel,
  useDeleteModel,
};
