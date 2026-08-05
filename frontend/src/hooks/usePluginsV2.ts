/**
 * # ============================================================
 * # usePluginsV2 Hook (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：封装 Plugin 注册表 API
 * # 功能：
 * #   1. 列出 plugins
 * #   2. 安装（zip / path）
 * #   3. 启用/禁用
 * #   4. 卸载
 * # 输入参数：options
 * # 输出结果：plugins + actions
 * # 对标：Codex CLI Plugin Registry
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

export interface PluginDependencyV2 {
  name: string;
  version_spec: string;
  installed: boolean;
  installed_version?: string | null;
}

export interface PluginV2 {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  source: string;
  install_path: string;
  dependencies: PluginDependencyV2[];
  skills: string[];
  mcp_servers: string[];
  agents: string[];
  installed_at: string;
  plugin_toml_path: string;
}

export interface UsePluginsV2Result {
  plugins: PluginV2[];
  loading: boolean;
  error: string | null;
  installing: boolean;

  refresh: () => Promise<void>;
  installFromZip: (zipBase64: string, force?: boolean) => Promise<PluginV2 | null>;
  installFromPath: (sourcePath: string, force?: boolean) => Promise<PluginV2 | null>;
  setEnabled: (pluginId: string, enabled: boolean) => Promise<PluginV2 | null>;
  uninstall: (pluginId: string) => Promise<boolean>;
  clearError: () => void;
}

// ============================================================
// 常量
// ============================================================

const DEFAULT_BASE_URL = '/api/plugins-v2';

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

export function usePluginsV2(): UsePluginsV2Result {
  const [plugins, setPlugins] = useState<PluginV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isMountedRef = useRef(true);

  // ============================================================
  // refresh
  // ============================================================

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`${DEFAULT_BASE_URL}/list`, { method: 'GET' });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      }
      const data = await resp.json();
      if (isMountedRef.current) {
        setPlugins(data.plugins || []);
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
  }, []);

  // ============================================================
  // installFromZip
  // ============================================================

  const installFromZip = useCallback(
    async (zipBase64: string, force: boolean = false): Promise<PluginV2 | null> => {
      setError(null);
      setInstalling(true);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/install`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ zip_base64: zipBase64, force }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const plugin: PluginV2 = data.plugin;
        setRefreshKey((k) => k + 1);
        return plugin;
      } catch (err) {
        setError(handleError(err, 'installFromZip'));
        return null;
      } finally {
        setInstalling(false);
      }
    },
    []
  );

  // ============================================================
  // installFromPath
  // ============================================================

  const installFromPath = useCallback(
    async (sourcePath: string, force: boolean = false): Promise<PluginV2 | null> => {
      setError(null);
      setInstalling(true);
      try {
        const resp = await fetch(`${DEFAULT_BASE_URL}/install-path`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ source_path: sourcePath, force }),
        });
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        const plugin: PluginV2 = data.plugin;
        setRefreshKey((k) => k + 1);
        return plugin;
      } catch (err) {
        setError(handleError(err, 'installFromPath'));
        return null;
      } finally {
        setInstalling(false);
      }
    },
    []
  );

  // ============================================================
  // setEnabled
  // ============================================================

  const setEnabled = useCallback(
    async (pluginId: string, enabled: boolean): Promise<PluginV2 | null> => {
      setError(null);
      try {
        const resp = await fetch(
          `${DEFAULT_BASE_URL}/${encodeURIComponent(pluginId)}/enable`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled }),
          }
        );
        if (!resp.ok) {
          const errData = await resp.json().catch(() => ({}));
          throw new Error(errData.detail || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setRefreshKey((k) => k + 1);
        return data.plugin as PluginV2;
      } catch (err) {
        setError(handleError(err, 'setEnabled'));
        return null;
      }
    },
    []
  );

  // ============================================================
  // uninstall
  // ============================================================

  const uninstall = useCallback(async (pluginId: string): Promise<boolean> => {
    setError(null);
    try {
      const resp = await fetch(
        `${DEFAULT_BASE_URL}/${encodeURIComponent(pluginId)}`,
        { method: 'DELETE' }
      );
      if (!resp.ok) {
        if (resp.status === 404) return true;
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${resp.status}`);
      }
      setRefreshKey((k) => k + 1);
      return true;
    } catch (err) {
      setError(handleError(err, 'uninstall'));
      return false;
    }
  }, []);

  // ============================================================
  // 初始化 & 自动刷新
  // ============================================================

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // ============================================================
  // 公开接口
  // ============================================================

  const clearError = useCallback(() => setError(null), []);

  return {
    plugins,
    loading,
    error,
    installing,
    refresh,
    installFromZip,
    installFromPath,
    setEnabled,
    uninstall,
    clearError,
  };
}

export default usePluginsV2;
