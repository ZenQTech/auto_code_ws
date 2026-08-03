/**
 * RemoteWorktreePanel - 远程 Worktree 管理面板
 * Cycle 31 G31-02
 *
 * 3 Tab 页：
 *   1. 后端管理
 *   2. Worktree 列表
 *   3. 迁移历史
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  RemoteWorktreeAdapter,
  getDefaultRemoteWorktreeAdapter,
  type Worktree,
  type WorktreeBackendConfig,
  type BackendType,
  type MigrationReceipt,
} from '../utils/remoteWorktreeAdapter';

export interface RemoteWorktreePanelProps {
  adapter?: RemoteWorktreeAdapter;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'backends' | 'worktrees' | 'migrations';

export const RemoteWorktreePanel: React.FC<RemoteWorktreePanelProps> = ({ adapter: adapterProp, isOpen, onClose }) => {

  // G60-FIX-13: 面板关闭时早返回，避免在 DOM 中堆积所有面板
  if (isOpen === false) return null;
  const adapter = useMemo(() => adapterProp || getDefaultRemoteWorktreeAdapter(), [adapterProp]);
  const [tab, setTab] = useState<TabKey>('backends');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const unsub1 = adapter.on('backend-registered', () => setRefreshKey((k) => k + 1));
    const unsub2 = adapter.on('worktree-created', () => setRefreshKey((k) => k + 1));
    const unsub3 = adapter.on('worktree-migrated', () => setRefreshKey((k) => k + 1));
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [adapter]);

  return (
    <div className="remote-worktree-panel" data-testid="remote-worktree-panel">
      <div className="panel-header">
        <h2>远程 Worktree 管理</h2>
        {onClose && <button onClick={onClose} aria-label="关闭">×</button>}
      </div>

      <div className="panel-tabs">
        <button className={tab === 'backends' ? 'active' : ''} onClick={() => setTab('backends')}>后端</button>
        <button className={tab === 'worktrees' ? 'active' : ''} onClick={() => setTab('worktrees')}>Worktree</button>
        <button className={tab === 'migrations' ? 'active' : ''} onClick={() => setTab('migrations')}>迁移历史</button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'backends' && <BackendsTab adapter={adapter} />}
        {tab === 'worktrees' && <WorktreesTab adapter={adapter} />}
        {tab === 'migrations' && <MigrationsTab adapter={adapter} />}
      </div>
    </div>
  );
};

// ============ 后端 Tab ============

const BackendsTab: React.FC<{ adapter: RemoteWorktreeAdapter }> = ({ adapter }) => {
  const [type, setType] = useState<BackendType>('local');
  const [name, setName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [priority, setPriority] = useState('50');
  const backends = adapter.listBackends();

  const handleRegister = () => {
    if (!name) return;
    const config: WorktreeBackendConfig = type === 'local'
      ? { id: `be-${Date.now()}`, name, type, enabled: true, priority: Number(priority), basePath: '/tmp' }
      : type === 'remote'
        ? { id: `be-${Date.now()}`, name, type, enabled: true, priority: Number(priority), endpoint: endpoint || 'https://api.example.com' }
        : { id: `be-${Date.now()}`, name, type, enabled: true, priority: Number(priority), localPath: '/tmp/h', remoteEndpoint: endpoint || 'https://h.example.com', syncMode: 'on-save' };
    adapter.registerBackend(config);
    setName('');
    setEndpoint('');
  };

  return (
    <div className="tab-backends" data-testid="backends-tab">
      <div className="form-row">
        <label>类型：</label>
        <select value={type} onChange={(e) => setType(e.target.value as BackendType)}>
          <option value="local">Local</option>
          <option value="remote">Remote</option>
          <option value="hybrid">Hybrid</option>
        </select>
        <label>名称：</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <label>Endpoint：</label>
        <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        <label>Priority：</label>
        <input type="number" value={priority} onChange={(e) => setPriority(e.target.value)} />
        <button onClick={handleRegister}>注册</button>
      </div>

      <h3>已注册后端</h3>
      <table className="backends-table">
        <thead>
          <tr><th>ID</th><th>名称</th><th>类型</th><th>优先级</th><th>状态</th><th>操作</th></tr>
        </thead>
        <tbody>
          {backends.map((b) => (
            <tr key={b.id}>
              <td>{b.id}</td>
              <td>{b.name}</td>
              <td>{b.type}</td>
              <td>{b.priority}</td>
              <td>{b.enabled ? '启用' : '禁用'}</td>
              <td><button onClick={() => adapter.unregisterBackend(b.id)}>移除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ Worktree Tab ============

const WorktreesTab: React.FC<{ adapter: RemoteWorktreeAdapter }> = ({ adapter }) => {
  const [branch, setBranch] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);

  const refresh = () => { adapter.list().then(setWorktrees); };
  useEffect(() => { refresh(); }, [adapter]);

  const handleCreate = async () => {
    if (!branch) return;
    await adapter.create({ branch, baseBranch });
    setBranch('');
    refresh();
  };

  const handleMigrate = async (id: string, target: string) => {
    await adapter.migrateToRemote(id, target);
    refresh();
  };

  return (
    <div className="tab-worktrees" data-testid="worktrees-tab">
      <div className="form-row">
        <label>Branch：</label>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} />
        <label>Base：</label>
        <input value={baseBranch} onChange={(e) => setBaseBranch(e.target.value)} />
        <button onClick={handleCreate}>创建</button>
      </div>

      <table className="worktrees-table">
        <thead>
          <tr><th>ID</th><th>Branch</th><th>后端</th><th>状态</th><th>路径</th><th>操作</th></tr>
        </thead>
        <tbody>
          {worktrees.map((w) => (
            <tr key={w.id}>
              <td>{w.id.slice(0, 12)}</td>
              <td>{w.branch}</td>
              <td>{w.backendId}</td>
              <td>{w.status}</td>
              <td>{w.path}</td>
              <td>
                <button onClick={() => handleMigrate(w.id, 'remote-1')}>迁移到远程</button>
                <button onClick={() => adapter.delete(w.id).then(refresh)}>删除</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ 迁移历史 Tab ============

const MigrationsTab: React.FC<{ adapter: RemoteWorktreeAdapter }> = ({ adapter }) => {
  const [receipts, setReceipts] = useState<MigrationReceipt[]>([]);

  useEffect(() => {
    // 简化：直接从 worktree 列表推断
    adapter.list().then((wts) => {
      const rs: MigrationReceipt[] = wts
        .filter((w) => w.lastSyncAt)
        .map((w) => ({
          migrationId: w.id,
          worktreeId: w.id,
          fromBackend: 'local-1',
          toBackend: w.backendId,
          startedAt: w.createdAt,
          completedAt: w.lastSyncAt!,
          filesTransferred: w.fileCount || 0,
          bytesTransferred: w.size || 0,
          status: w.status === 'error' ? 'failed' : 'success',
        }));
      setReceipts(rs);
    });
  }, [adapter]);

  return (
    <div className="tab-migrations" data-testid="migrations-tab">
      {receipts.length === 0 ? (
        <p>无迁移记录</p>
      ) : (
        <table>
          <thead>
            <tr><th>Worktree</th><th>From</th><th>To</th><th>状态</th><th>耗时</th></tr>
          </thead>
          <tbody>
            {receipts.map((r) => (
              <tr key={r.migrationId}>
                <td>{r.worktreeId.slice(0, 12)}</td>
                <td>{r.fromBackend}</td>
                <td>{r.toBackend}</td>
                <td>{r.status}</td>
                <td>{r.completedAt - r.startedAt}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default RemoteWorktreePanel;
