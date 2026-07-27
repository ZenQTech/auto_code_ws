/**
 * # ============================================================
 * Cycle 3 综合面板 - 权限控制 + 外部服务器 + 审批中心
 * # ============================================================
 * 核心作用：综合展示 Cycle 3 新增的 MCP 功能
 * 包含：
 *   - 工具权限配置（auto/manual/blocked）
 *   - 外部 MCP 服务器管理
 *   - 实时审批中心
 *   - 审计日志查看
 * 创建日期：2026-07-27
 * 模块版本：
 *   - v1.0.0 | 初始版本
 *   - v1.1.0 | UI/UX 升级：渐变标题 + 玻璃拟态 + 加载骨架 + 角标徽章 + toast 提示
 *   - v1.1.1 | 完善空状态文案 + 审批倒计时 + 审计日志筛选 + 工具描述
 * ============================================================
 */

import React, { useMemo, useState } from 'react';
import {
  useMCPPermissions,
  usePendingApprovals,
  useAuditLog,
  useExternalMCPServers,
  type PermissionMode,
  type ToolPermission,
} from '../hooks/useCycle3Api';

type TabType = 'permissions' | 'servers' | 'approvals' | 'audit';

const TAB_DEFS: { id: TabType; label: string; icon: string; description: string }[] = [
  { id: 'permissions', label: '权限配置', icon: '🔐', description: 'auto / manual / blocked' },
  { id: 'servers', label: '外部服务器', icon: '🔌', description: 'stdio / http / sse' },
  { id: 'approvals', label: '审批中心', icon: '✅', description: '实时审批流' },
  { id: 'audit', label: '审计日志', icon: '📋', description: '工具调用全记录' },
];

export const Cycle3Panel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [tab, setTab] = useState<TabType>('permissions');

  return (
    <div className="cycle3-panel relative w-full h-full overflow-hidden bg-white rounded-2xl shadow-level-3 border border-surface-200 flex flex-col">
      {/* 渐变标题栏 */}
      <div className="flex-shrink-0 relative px-6 py-4 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="text-2xl">🆕</span>
              <span>Cycle 3 · MCP 高级功能</span>
            </h2>
            <p className="text-sm text-white/80 mt-1">
              外部服务器、细粒度权限、实时审批与全链路审计
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-1 rounded-full text-xs font-mono bg-white/20 backdrop-blur-sm">
              v1.1.1
            </span>
            {onClose && (
              <button
                onClick={onClose}
                title="关闭 (Esc)"
                aria-label="关闭"
                className="w-8 h-8 rounded-full bg-white/20 backdrop-blur-sm hover:bg-white/30 flex items-center justify-center text-white transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        </div>
        {/* 装饰 */}
        <div className="absolute -bottom-4 left-0 right-0 h-4 bg-gradient-to-b from-black/5 to-transparent" />
      </div>

      {/* 标签栏 */}
      <div className="flex-shrink-0 flex border-b border-surface-200 px-4 bg-surface-50 overflow-x-auto">
        {TAB_DEFS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`group relative flex flex-col items-center px-4 py-3 transition-all duration-200 ease-out whitespace-nowrap
              ${tab === t.id
                ? 'text-indigo-600'
                : 'text-surface-500 hover:text-surface-700'
              }`}
          >
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <span className="text-base">{t.icon}</span>
              {t.label}
            </div>
            <div className="text-[10px] mt-0.5 text-surface-400 group-hover:text-surface-500">
              {t.description}
            </div>
            {tab === t.id && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-500 rounded-full animate-lift-in" />
            )}
          </button>
        ))}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'permissions' && <PermissionsTab />}
        {tab === 'servers' && <ServersTab />}
        {tab === 'approvals' && <ApprovalsTab />}
        {tab === 'audit' && <AuditTab />}
      </div>
    </div>
  );
};

// ============================================================
// 通用工具
// ============================================================

/** 模式徽章样式（权限/触发/路径等） */
function getModeStyle(mode: PermissionMode): { label: string; bg: string; text: string; dot: string } {
  switch (mode) {
    case 'auto':
      return {
        label: 'auto',
        bg: 'bg-emerald-50',
        text: 'text-emerald-700',
        dot: 'bg-emerald-500',
      };
    case 'manual':
      return {
        label: 'manual',
        bg: 'bg-amber-50',
        text: 'text-amber-700',
        dot: 'bg-amber-500',
      };
    case 'blocked':
      return {
        label: 'blocked',
        bg: 'bg-rose-50',
        text: 'text-rose-700',
        dot: 'bg-rose-500',
      };
  }
}

/** 空状态组件 */
const EmptyState: React.FC<{ icon: string; title: string; hint?: string }> = ({ icon, title, hint }) => (
  <div className="flex flex-col items-center justify-center py-12 text-center">
    <div className="text-5xl mb-3 opacity-50">{icon}</div>
    <div className="text-sm font-medium text-surface-600">{title}</div>
    {hint && <div className="text-xs text-surface-400 mt-1">{hint}</div>}
  </div>
);

/** 加载骨架 */
const SkeletonRows: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="space-y-2">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="h-14 bg-gradient-to-r from-surface-100 via-surface-200 to-surface-100 rounded-lg animate-pulse" />
    ))}
  </div>
);

// ============================================================
// Tab 1: 权限配置
// ============================================================
const PermissionsTab: React.FC = () => {
  const { permissions, loading, setPermission } = useMCPPermissions();
  const [editing, setEditing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const handleModeChange = async (perm: ToolPermission, mode: PermissionMode) => {
    try {
      await setPermission(perm.tool_name, mode, perm.server_id);
      setEditing(null);
      setToast({ kind: 'success', text: `${perm.tool_name} → ${mode}` });
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '设置失败' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const grouped = useMemo(() => {
    const map = new Map<string, ToolPermission[]>();
    for (const p of permissions) {
      const key = p.server_id || 'builtin';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return map;
  }, [permissions]);

  if (loading) {
    return (
      <div>
        <div className="h-4 w-40 bg-surface-100 rounded mb-4 animate-pulse" />
        <SkeletonRows count={5} />
      </div>
    );
  }

  if (permissions.length === 0) {
    return <EmptyState icon="🔐" title="暂无权限配置" hint="后端会为内置工具填充默认权限（危险操作默认 manual）" />;
  }

  return (
    <div className="space-y-6">
      {/* 说明 */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="px-2 py-1 rounded bg-emerald-50 text-emerald-700">● auto 自动放行</span>
        <span className="px-2 py-1 rounded bg-amber-50 text-amber-700">● manual 每次审批</span>
        <span className="px-2 py-1 rounded bg-rose-50 text-rose-700">● blocked 永久阻止</span>
      </div>

      {/* toast */}
      {toast && (
        <div className={`px-3 py-2 rounded text-sm animate-lift-in ${
          toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}>
          {toast.kind === 'success' ? '✓ ' : '✗ '}{toast.text}
        </div>
      )}

      {/* 按 server_id 分组 */}
      {Array.from(grouped.entries()).map(([serverId, perms]) => (
        <div key={serverId}>
          <div className="flex items-center gap-2 mb-2 text-xs font-medium text-surface-600 uppercase tracking-wide">
            <span>{serverId === 'builtin' ? '🏠' : '🔌'}</span>
            <span>{serverId}</span>
            <span className="text-surface-400">({perms.length})</span>
          </div>
          <div className="space-y-2">
            {perms.map(perm => {
              const isEditing = editing === `${perm.tool_name}-${perm.server_id}`;
              const style = getModeStyle(perm.mode);
              return (
                <div
                  key={`${perm.tool_name}-${perm.server_id}`}
                  className="group flex items-center justify-between p-3 bg-white border border-surface-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition-all duration-200"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-surface-800 truncate">
                        {perm.tool_name}
                      </span>
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${style.bg} ${style.text}`}>
                        <span className={`w-1 h-1 rounded-full ${style.dot}`} />
                        {style.label}
                      </span>
                    </div>
                    {perm.reason && (
                      <div className="text-xs text-surface-500 mt-0.5">{perm.reason}</div>
                    )}
                  </div>
                  <button
                    onClick={() => setEditing(isEditing ? null : `${perm.tool_name}-${perm.server_id}`)}
                    className="ml-2 px-2.5 py-1 text-xs text-surface-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                  >
                    {isEditing ? '取消' : '修改'}
                  </button>
                  {isEditing && (
                    <div className="absolute mt-32 right-4 bg-white border border-surface-200 rounded-lg shadow-level-2 p-1 z-10 flex gap-1 animate-lift-in">
                      {(['auto', 'manual', 'blocked'] as PermissionMode[]).map(m => {
                        const s = getModeStyle(m);
                        const isCurrent = m === perm.mode;
                        return (
                          <button
                            key={m}
                            onClick={() => handleModeChange(perm, m)}
                            className={`px-2.5 py-1 text-xs rounded ${s.bg} ${s.text} hover:opacity-80 ${isCurrent ? 'ring-2 ring-offset-1 ring-current' : ''}`}
                          >
                            {s.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// Tab 2: 外部服务器
// ============================================================
const ServersTab: React.FC = () => {
  const { servers, loading, registerServer, unregisterServer, restartServer, refetch } = useExternalMCPServers();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'streamable_http' | 'sse'>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const handleRegister = async () => {
    if (!name.trim()) {
      setToast({ kind: 'error', text: '请填写服务器名称' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    if (transport === 'stdio' && !command.trim()) {
      setToast({ kind: 'error', text: 'stdio 类型需要填写 command' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    if (transport !== 'stdio' && !url.trim()) {
      setToast({ kind: 'error', text: 'http/sse 类型需要填写 URL' });
      setTimeout(() => setToast(null), 2000);
      return;
    }
    setSubmitting(true);
    try {
      await registerServer({
        name: name.trim(),
        transport,
        command: transport === 'stdio' ? command.trim() : undefined,
        url: transport !== 'stdio' ? url.trim() : undefined,
      });
      setToast({ kind: 'success', text: `✓ ${name} 注册成功` });
      setName('');
      setCommand('');
      setUrl('');
      setShowForm(false);
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '注册失败' });
      setTimeout(() => setToast(null), 3000);
    } finally {
      setSubmitting(false);
    }
  };

  const handleUnregister = async (id: string, serverName: string) => {
    if (!confirm(`确认注销服务器 "${serverName}"？`)) return;
    try {
      await unregisterServer(id);
      setToast({ kind: 'success', text: `✓ ${serverName} 已注销` });
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '注销失败' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  const handleRestart = async (id: string, serverName: string) => {
    try {
      await restartServer(id);
      setToast({ kind: 'success', text: `✓ ${serverName} 重启完成` });
      setTimeout(() => setToast(null), 2000);
      refetch();
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '重启失败' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  if (loading) {
    return <SkeletonRows count={3} />;
  }

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-surface-600">
          共 <span className="font-semibold text-indigo-600">{servers.length}</span> 个外部服务器
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refetch}
            className="px-3 py-1.5 text-xs text-surface-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          >
            🔄 刷新
          </button>
          <button
            onClick={() => setShowForm(s => !s)}
            className="px-3 py-1.5 text-sm bg-gradient-to-r from-indigo-500 to-purple-500 text-white rounded-lg hover:from-indigo-600 hover:to-purple-600 transition-all shadow-sm"
          >
            {showForm ? '✕ 取消' : '+ 注册新服务器'}
          </button>
        </div>
      </div>

      {/* toast */}
      {toast && (
        <div className={`px-3 py-2 rounded text-sm animate-lift-in ${
          toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}>
          {toast.text}
        </div>
      )}

      {/* 注册表单 */}
      {showForm && (
        <div className="p-4 bg-surface-50 border border-surface-200 rounded-lg space-y-3 animate-lift-in">
          <div>
            <label className="text-xs text-surface-600 mb-1 block">服务器名称</label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="例如：context7"
              className="w-full px-3 py-1.5 text-sm border border-surface-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <div>
            <label className="text-xs text-surface-600 mb-1 block">传输类型</label>
            <div className="flex gap-2">
              {(['stdio', 'streamable_http', 'sse'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTransport(t)}
                  className={`px-3 py-1.5 text-xs rounded transition-colors ${
                    transport === t
                      ? 'bg-indigo-500 text-white'
                      : 'bg-white text-surface-600 border border-surface-200 hover:border-indigo-300'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          {transport === 'stdio' ? (
            <div>
              <label className="text-xs text-surface-600 mb-1 block">命令</label>
              <input
                value={command}
                onChange={e => setCommand(e.target.value)}
                placeholder="例如：npx -y @upstash/context7-mcp"
                className="w-full px-3 py-1.5 text-sm font-mono border border-surface-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs text-surface-600 mb-1 block">URL</label>
              <input
                value={url}
                onChange={e => setUrl(e.target.value)}
                placeholder="例如：https://mcp.example.com/sse"
                className="w-full px-3 py-1.5 text-sm font-mono border border-surface-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}
          <button
            onClick={handleRegister}
            disabled={submitting}
            className="w-full px-3 py-2 text-sm bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50 transition-colors"
          >
            {submitting ? '注册中...' : '确认注册'}
          </button>
        </div>
      )}

      {/* 服务器列表 */}
      {servers.length === 0 ? (
        <EmptyState icon="🔌" title="尚未注册外部服务器" hint="点击右上角“注册新服务器”接入 context7/Linear 等" />
      ) : (
        <div className="space-y-2">
          {servers.map(srv => (
            <div
              key={srv.id}
              className="p-3 bg-white border border-surface-200 rounded-lg hover:border-indigo-300 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-surface-800">{srv.name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-50 text-blue-700">
                      {srv.transport}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      srv.status === 'running' ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'
                    }`} />
                    <span className="text-xs text-surface-500">{srv.status || 'unknown'}</span>
                    {srv.tool_count !== undefined && (
                      <span className="text-xs text-surface-500">
                        · {srv.tool_count} 工具
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-surface-500 mt-0.5 font-mono truncate">
                    {srv.command || srv.url}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleRestart(srv.id, srv.name)}
                    className="px-2 py-1 text-xs text-surface-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
                  >
                    🔄 重启
                  </button>
                  <button
                    onClick={() => handleUnregister(srv.id, srv.name)}
                    className="px-2 py-1 text-xs text-surface-600 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                  >
                    🗑
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Tab 3: 审批中心
// ============================================================
const ApprovalsTab: React.FC = () => {
  const { pending, loading, respondToApproval } = usePendingApprovals();
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

  const handleRespond = async (id: string, decision: 'approved' | 'rejected', toolName: string) => {
    try {
      await respondToApproval(id, decision);
      setToast({
        kind: 'success',
        text: `✓ ${toolName} ${decision === 'approved' ? '已批准' : '已拒绝'}`,
      });
      setTimeout(() => setToast(null), 2000);
    } catch (e: any) {
      setToast({ kind: 'error', text: e.message || '响应失败' });
      setTimeout(() => setToast(null), 3000);
    }
  };

  if (loading && pending.length === 0) {
    return <SkeletonRows count={2} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <div className="text-surface-600">
          <span className="inline-flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${pending.length > 0 ? 'bg-amber-500 animate-pulse' : 'bg-surface-300'}`} />
            {pending.length} 个待审批
          </span>
        </div>
        <div className="text-xs text-surface-400">5s 自动刷新</div>
      </div>

      {toast && (
        <div className={`px-3 py-2 rounded text-sm animate-lift-in ${
          toast.kind === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}>
          {toast.text}
        </div>
      )}

      {pending.length === 0 ? (
        <EmptyState icon="✅" title="没有待审批请求" hint="工具调用被设置为 manual 时会出现在这里" />
      ) : (
        <div className="space-y-3">
          {pending.map(req => {
            const expiresIn = Math.max(0, Math.floor((new Date(req.expires_at).getTime() - Date.now()) / 1000));
            return (
              <div
                key={req.id}
                className="p-4 bg-amber-50/50 border border-amber-200 rounded-lg"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-base">⚠️</span>
                    <span className="text-sm font-semibold text-surface-800">{req.tool_name}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-amber-100 text-amber-700">
                      {req.server_id}
                    </span>
                  </div>
                  <div className="text-xs text-amber-600 font-mono">
                    ⏱ {expiresIn}s
                  </div>
                </div>
                <details className="text-xs text-surface-600 mb-3">
                  <summary className="cursor-pointer hover:text-surface-800">查看参数</summary>
                  <pre className="mt-2 p-2 bg-white rounded font-mono text-[10px] overflow-x-auto">
                    {JSON.stringify(req.arguments, null, 2)}
                  </pre>
                </details>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleRespond(req.id, 'approved', req.tool_name)}
                    className="flex-1 px-3 py-1.5 text-sm bg-emerald-500 text-white rounded hover:bg-emerald-600 transition-colors"
                  >
                    ✓ 批准
                  </button>
                  <button
                    onClick={() => handleRespond(req.id, 'rejected', req.tool_name)}
                    className="flex-1 px-3 py-1.5 text-sm bg-rose-500 text-white rounded hover:bg-rose-600 transition-colors"
                  >
                    ✗ 拒绝
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

// ============================================================
// Tab 4: 审计日志
// ============================================================
const AuditTab: React.FC = () => {
  const [toolFilter, setToolFilter] = useState('');
  const [successOnly, setSuccessOnly] = useState<boolean | undefined>(undefined);
  const filters = useMemo(() => ({
    tool_name: toolFilter || undefined,
    success_only: successOnly,
    limit: 100,
  }), [toolFilter, successOnly]);

  const { logs, total, loading } = useAuditLog(filters);

  return (
    <div className="space-y-4">
      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={toolFilter}
          onChange={e => setToolFilter(e.target.value)}
          placeholder="工具名筛选..."
          className="px-3 py-1.5 text-sm border border-surface-300 rounded focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <div className="flex rounded overflow-hidden border border-surface-300">
          <button
            onClick={() => setSuccessOnly(undefined)}
            className={`px-3 py-1.5 text-xs ${successOnly === undefined ? 'bg-indigo-500 text-white' : 'bg-white text-surface-600 hover:bg-surface-50'}`}
          >
            全部
          </button>
          <button
            onClick={() => setSuccessOnly(true)}
            className={`px-3 py-1.5 text-xs ${successOnly === true ? 'bg-emerald-500 text-white' : 'bg-white text-surface-600 hover:bg-surface-50'}`}
          >
            ✓ 成功
          </button>
          <button
            onClick={() => setSuccessOnly(false)}
            className={`px-3 py-1.5 text-xs ${successOnly === false ? 'bg-rose-500 text-white' : 'bg-white text-surface-600 hover:bg-surface-50'}`}
          >
            ✗ 失败
          </button>
        </div>
        <div className="text-xs text-surface-500">
          共 {total} 条
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <SkeletonRows count={4} />
      ) : logs.length === 0 ? (
        <EmptyState icon="📋" title="暂无审计日志" hint="工具调用后会自动记录" />
      ) : (
        <div className="space-y-1 max-h-[60vh] overflow-y-auto">
          {logs.map(log => (
            <div
              key={log.id}
              className="p-2.5 bg-white border border-surface-200 rounded hover:border-indigo-200 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${log.success ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                  <span className="text-sm font-medium text-surface-800 truncate">{log.tool_name}</span>
                  <span className="text-[10px] text-surface-400 font-mono">{log.server_id}</span>
                  <span className="text-[10px] text-surface-400">{log.permission_mode}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-surface-500 whitespace-nowrap">
                  <span>{log.duration_ms}ms</span>
                  <span>{new Date(log.timestamp).toLocaleTimeString()}</span>
                </div>
              </div>
              {log.error_message && (
                <div className="text-xs text-rose-600 mt-1 font-mono truncate">
                  {log.error_message}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Cycle3Panel;
