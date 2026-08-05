/**
 * # ============================================================
 * # PluginsRegistryPanel (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：管理本地 Plugins（zip 安装、启用/禁用、卸载）
 * # 功能：
 * #   1. 列出所有 plugin
 * #   2. zip 上传安装（base64）
 * #   3. 本地路径安装
 * #   4. 启用/禁用
 * #   5. 卸载（清理文件）
 * #   6. 展示依赖、skills、mcp_servers、agents
 * # 输入参数：isOpen, onClose
 * # 输出结果：可交互的 Plugins 管理面板
 * # 对标：Codex CLI Plugin Registry
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import React, { useState, useEffect } from 'react';
import { usePluginsV2, type PluginV2 } from '../hooks/usePluginsV2';

interface PluginsRegistryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PluginsRegistryPanel: React.FC<PluginsRegistryPanelProps> = ({
  isOpen,
  onClose,
}) => {
  const {
    plugins,
    loading,
    error,
    installing,
    refresh,
    installFromPath,
    setEnabled,
    uninstall,
  } = usePluginsV2();

  const [installPath, setInstallPath] = useState('');
  const [force, setForce] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginV2 | null>(null);

  useEffect(() => {
    if (isOpen) {
      void refresh();
    }
  }, [isOpen, refresh]);

  const handleInstall = async () => {
    if (!installPath.trim()) return;
    await installFromPath(installPath, force);
    setInstallPath('');
  };

  const handleToggle = async (plugin: PluginV2) => {
    await setEnabled(plugin.id, !plugin.enabled);
  };

  const handleUninstall = async (plugin: PluginV2) => {
    if (!confirm(`确认卸载 plugin "${plugin.name}"？将删除其安装目录。`)) return;
    await uninstall(plugin.id);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="plugins-registry-panel"
    >
      <div className="bg-white rounded-lg shadow-xl w-[960px] max-w-[95vw] h-[640px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧩</span>
            <h2 className="text-lg font-semibold">Plugin 管理</h2>
            <span className="text-xs text-gray-500">本地安装 · Codex 兼容</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
            data-testid="plugins-close"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200">
            {error}
          </div>
        )}

        {/* 安装区 */}
        <div className="px-5 py-3 border-b bg-gray-50 space-y-2">
          <div className="flex gap-2 items-center">
            <span className="text-xs text-gray-500 whitespace-nowrap w-16">路径:</span>
            <input
              value={installPath}
              onChange={(e) => setInstallPath(e.target.value)}
              placeholder="/path/to/plugin-dir"
              className="flex-1 px-2 py-1 text-sm border rounded font-mono"
              data-testid="install-path-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleInstall();
              }}
            />
            <label className="flex items-center gap-1 text-xs text-gray-600">
              <input
                type="checkbox"
                checked={force}
                onChange={(e) => setForce(e.target.checked)}
                data-testid="install-force"
              />
              强制
            </label>
            <button
              onClick={handleInstall}
              disabled={installing || !installPath.trim()}
              className="px-4 py-1 text-sm bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50"
              data-testid="install-btn"
            >
              {installing ? '安装中…' : '安装'}
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {loading && (
            <div className="text-center py-4 text-gray-500">加载中…</div>
          )}

          <div className="space-y-2" data-testid="plugins-list">
            {plugins.map((p) => (
              <div
                key={p.id}
                className="border rounded p-3 hover:bg-gray-50"
                data-testid={`plugin-item-${p.name}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm font-semibold">{p.name}</span>
                      <span className="text-xs text-gray-500">v{p.version}</span>
                      <span
                        className={`text-xs px-1.5 py-0.5 rounded ${
                          p.enabled
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                        data-testid={`plugin-status-${p.name}`}
                      >
                        {p.enabled ? '已启用' : '已禁用'}
                      </span>
                      <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">
                        {p.source}
                      </span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                      {p.description}
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-gray-500">
                      {p.skills.length > 0 && (
                        <span>📚 {p.skills.length} skills</span>
                      )}
                      {p.mcp_servers.length > 0 && (
                        <span>🔌 {p.mcp_servers.length} mcp</span>
                      )}
                      {p.agents.length > 0 && <span>🤖 {p.agents.length} agents</span>}
                      {p.dependencies.length > 0 && (
                        <span>📦 {p.dependencies.length} deps</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 ml-2 flex-shrink-0">
                    <button
                      onClick={() => setSelectedPlugin(p)}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                      data-testid={`plugin-detail-${p.name}`}
                    >
                      详情
                    </button>
                    <button
                      onClick={() => handleToggle(p)}
                      className={`text-xs px-2 py-1 rounded ${
                        p.enabled
                          ? 'bg-red-50 text-red-600 border border-red-200'
                          : 'bg-green-50 text-green-600 border border-green-200'
                      }`}
                      data-testid={`plugin-toggle-${p.name}`}
                    >
                      {p.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => handleUninstall(p)}
                      className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                      data-testid={`plugin-uninstall-${p.name}`}
                    >
                      卸载
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {!loading && plugins.length === 0 && (
              <div className="text-center py-8 text-gray-500 text-sm">
                暂无 Plugin，输入 plugin 目录路径并点击"安装"
              </div>
            )}
          </div>
        </div>

        {/* 详情模态框 */}
        {selectedPlugin && (
          <div
            className="absolute inset-0 bg-black/50 flex items-center justify-center"
            data-testid="plugin-detail-modal"
          >
            <div className="bg-white rounded-lg p-5 w-[640px] max-w-[90vw] max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold font-mono">
                  {selectedPlugin.name}
                </h3>
                <button
                  onClick={() => setSelectedPlugin(null)}
                  className="text-gray-500"
                  data-testid="plugin-detail-close"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>版本:</strong> {selectedPlugin.version}
                </p>
                <p>
                  <strong>描述:</strong> {selectedPlugin.description}
                </p>
                <p>
                  <strong>来源:</strong> {selectedPlugin.source}
                </p>
                <p>
                  <strong>安装路径:</strong>{' '}
                  <code className="text-xs">{selectedPlugin.install_path}</code>
                </p>
                <p>
                  <strong>安装时间:</strong> {selectedPlugin.installed_at}
                </p>
                {selectedPlugin.dependencies.length > 0 && (
                  <div>
                    <strong>依赖:</strong>
                    <ul className="text-xs ml-4 list-disc">
                      {selectedPlugin.dependencies.map((d) => (
                        <li key={d.name}>
                          {d.name} {d.version_spec}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedPlugin.skills.length > 0 && (
                  <div>
                    <strong>包含 Skills:</strong>
                    <ul className="text-xs ml-4 list-disc">
                      {selectedPlugin.skills.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedPlugin.mcp_servers.length > 0 && (
                  <div>
                    <strong>包含 MCP Servers:</strong>
                    <ul className="text-xs ml-4 list-disc">
                      {selectedPlugin.mcp_servers.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {selectedPlugin.agents.length > 0 && (
                  <div>
                    <strong>包含 Agents:</strong>
                    <ul className="text-xs ml-4 list-disc">
                      {selectedPlugin.agents.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PluginsRegistryPanel;
