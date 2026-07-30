/**
 * # ============================================================
 * # Scoped Permissions Panel - 作用域权限 UI (v1.0.0 Cycle 28 G28-04)
 * # ============================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getDefaultScopedPermissionsEngine } from '../utils/scopedPermissionsEngine';
import { PermissionScope } from '../utils/scopedPermissionsEngine';

interface ScopedPermissionsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ScopedPermissionsPanel: React.FC<ScopedPermissionsPanelProps> = ({ isOpen, onClose }) => {
  const engine = useMemo(() => getDefaultScopedPermissionsEngine(), []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scopes, setScopes] = useState<PermissionScope[]>([]);
  const [newAgentPath, setNewAgentPath] = useState('/root/');
  const [selected, setSelected] = useState<PermissionScope | null>(null);
  const [checkTool, setCheckTool] = useState('read');
  const [checkResult, setCheckResult] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setScopes(engine.listScopes());
  }, [isOpen, refreshKey, engine]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleCreate = () => {
    if (!newAgentPath) return;
    if (!engine.getScope(newAgentPath)) {
      engine.createScope(newAgentPath, {
        tools: [{ tool: 'read', mode: 'allow' }],
        paths: [],
        networks: [],
      });
    }
    refresh();
  };

  const handleCheck = () => {
    if (!selected) return;
    const r = engine.checkToolPermissionWithInheritance(selected.agentPath, checkTool);
    setCheckResult(JSON.stringify(r, null, 2));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="scoped-permissions-panel">
      <div className="bg-white rounded-lg shadow-xl w-[960px] max-w-[95vw] h-[680px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🔒</span>
            <h2 className="text-lg font-semibold">作用域权限 (Scoped Permissions)</h2>
            <span className="text-xs text-gray-500">工具 / 路径 / 网络 细粒度控制</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" data-testid="scoped-permissions-close">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          <div className="flex gap-2 mb-4">
            <input
              value={newAgentPath}
              onChange={(e) => setNewAgentPath(e.target.value)}
              placeholder="/root/agent-name"
              className="flex-1 border rounded px-3 py-2 text-sm font-mono"
              data-testid="scoped-permissions-input"
            />
            <button onClick={handleCreate} className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm" data-testid="scoped-permissions-create">创建</button>
          </div>

          <div className="space-y-2" data-testid="scoped-permissions-list">
            {scopes.map((s) => (
              <div key={s.agentPath} className="border rounded p-3 flex items-center justify-between hover:bg-gray-50">
                <div>
                  <div className="font-mono text-sm font-semibold">{s.agentPath}</div>
                  <div className="text-xs text-gray-500 mt-1">
                    Tools: {s.tools.length} | Paths: {s.paths.length} | Networks: {s.networks.length}
                    {s.maxTokens ? ` | MaxTokens: ${s.maxTokens}` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSelected(s)} className="text-xs px-2 py-1 border rounded hover:bg-gray-100" data-testid={`scoped-permissions-view-${s.agentPath}`}>
                    查看
                  </button>
                  <button onClick={() => { engine.deleteScope(s.agentPath); refresh(); }} className="text-xs px-2 py-1 bg-red-50 text-red-600 border border-red-200 rounded">
                    删除
                  </button>
                </div>
              </div>
            ))}
            {scopes.length === 0 && (
              <div className="text-center text-sm text-gray-500 py-8">暂无作用域</div>
            )}
          </div>
        </div>

        {selected && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center" data-testid="scoped-permissions-modal">
            <div className="bg-white rounded-lg p-5 w-[640px] max-w-[90vw] max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold font-mono">{selected.agentPath}</h3>
                <button onClick={() => setSelected(null)} className="text-gray-500">✕</button>
              </div>
              <div className="space-y-3 text-sm">
                <div>
                  <strong>Tools:</strong>
                  {selected.tools.length === 0 ? <div className="text-gray-500">无</div> : (
                    <ul className="ml-4 list-disc">
                      {selected.tools.map((t, i) => <li key={i}>{t.tool} → <span className={`font-semibold ${t.mode === 'allow' ? 'text-green-600' : t.mode === 'block' ? 'text-red-600' : 'text-yellow-600'}`}>{t.mode}</span></li>)}
                    </ul>
                  )}
                </div>
                <div>
                  <strong>Paths:</strong>
                  {selected.paths.length === 0 ? <div className="text-gray-500">无</div> : (
                    <ul className="ml-4 list-disc">
                      {selected.paths.map((p, i) => <li key={i}>{p.pattern}{p.recursive ? ' (递归)' : ''} → <span className={`font-semibold ${p.mode === 'allow' ? 'text-green-600' : 'text-red-600'}`}>{p.mode}</span></li>)}
                    </ul>
                  )}
                </div>
                <div>
                  <strong>Networks:</strong>
                  {selected.networks.length === 0 ? <div className="text-gray-500">无</div> : (
                    <ul className="ml-4 list-disc">
                      {selected.networks.map((n, i) => <li key={i}>{n.host}{n.ports ? `:${n.ports.join(',')}` : ''} → <span className={`font-semibold ${n.mode === 'allow' ? 'text-green-600' : 'text-red-600'}`}>{n.mode}</span></li>)}
                    </ul>
                  )}
                </div>
                <div className="border-t pt-3">
                  <strong>权限检查（带继承）:</strong>
                  <div className="flex gap-2 mt-1">
                    <input
                      value={checkTool}
                      onChange={(e) => setCheckTool(e.target.value)}
                      className="flex-1 border rounded px-2 py-1 text-sm"
                      data-testid="scoped-permissions-check-input"
                    />
                    <button onClick={handleCheck} className="px-3 py-1 bg-indigo-500 text-white rounded text-sm" data-testid="scoped-permissions-check-btn">检查</button>
                  </div>
                  {checkResult && <pre className="text-xs bg-gray-50 p-2 rounded mt-2">{checkResult}</pre>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScopedPermissionsPanel;
