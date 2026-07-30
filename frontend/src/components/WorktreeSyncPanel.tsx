/**
 * WorktreeSyncPanel - Worktree 状态同步面板
 * Cycle 31 G31-03
 *
 * 3 Tab 页：
 *   1. 同步状态
 *   2. 设备管理
 *   3. 冲突解决
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  WorktreeSyncEngine,
  getDefaultWorktreeSyncEngine,
  type WorktreeSnapshot,
  type Conflict,
  type DeviceInfo,
  type SyncSession,
  type SyncEndpoint,
} from '../utils/worktreeSyncEngine';

export interface WorktreeSyncPanelProps {
  engine?: WorktreeSyncEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'sync' | 'devices' | 'conflicts';

export const WorktreeSyncPanel: React.FC<WorktreeSyncPanelProps> = ({ engine: engineProp, isOpen: _isOpen, onClose }) => {
  const engine = useMemo(() => engineProp || getDefaultWorktreeSyncEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('sync');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const unsub1 = engine.on('change-published', () => setRefreshKey((k) => k + 1));
    const unsub2 = engine.on('conflict-detected', () => setRefreshKey((k) => k + 1));
    const unsub3 = engine.on('snapshot-created', () => setRefreshKey((k) => k + 1));
    return () => { unsub1(); unsub2(); unsub3(); };
  }, [engine]);

  return (
    <div className="worktree-sync-panel" data-testid="worktree-sync-panel">
      <div className="panel-header">
        <h2>Worktree 状态同步</h2>
        {onClose && <button onClick={onClose} aria-label="关闭">×</button>}
      </div>

      <div className="panel-tabs">
        <button className={tab === 'sync' ? 'active' : ''} onClick={() => setTab('sync')}>同步</button>
        <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>设备</button>
        <button className={tab === 'conflicts' ? 'active' : ''} onClick={() => setTab('conflicts')}>冲突</button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'sync' && <SyncTab engine={engine} />}
        {tab === 'devices' && <DevicesTab engine={engine} />}
        {tab === 'conflicts' && <ConflictsTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ 同步 Tab ============

const SyncTab: React.FC<{ engine: WorktreeSyncEngine }> = ({ engine }) => {
  const [worktreeId, setWorktreeId] = useState('');
  const [branch, setBranch] = useState('main');
  const [commitHash, setCommitHash] = useState('abc123');
  const [snapshots, setSnapshots] = useState<WorktreeSnapshot[]>([]);
  const [sessions, setSessions] = useState<SyncSession[]>([]);

  const refresh = () => {
    setSnapshots(worktreeId ? engine.listSnapshots(worktreeId) : []);
    setSessions(worktreeId ? engine.listSessions(worktreeId) : []);
  };

  useEffect(() => { refresh(); }, [worktreeId, engine]);

  const handleSnapshot = () => {
    engine.snapshot(worktreeId, { branch, commitHash });
    refresh();
  };

  const handleStartSync = () => {
    const endpoint: SyncEndpoint = {
      id: `ep-${Date.now()}`,
      type: 'broadcast-channel',
      deviceId: 'other-device',
      connected: true,
    };
    engine.startSync(worktreeId, endpoint);
    refresh();
  };

  return (
    <div className="tab-sync" data-testid="sync-tab">
      <div className="form-row">
        <label>Worktree ID：</label>
        <input value={worktreeId} onChange={(e) => setWorktreeId(e.target.value)} />
      </div>

      <div className="form-row">
        <label>Branch：</label>
        <input value={branch} onChange={(e) => setBranch(e.target.value)} />
        <label>Commit：</label>
        <input value={commitHash} onChange={(e) => setCommitHash(e.target.value)} />
        <button onClick={handleSnapshot}>创建快照</button>
        <button onClick={handleStartSync}>启动同步</button>
      </div>

      <h3>快照</h3>
      {snapshots.length === 0 ? <p>无快照</p> : (
        <ul>
          {snapshots.map((s) => (
            <li key={s.id}>
              {new Date(s.timestamp).toLocaleString()} - {s.state.branch} @ {s.state.commitHash}
            </li>
          ))}
        </ul>
      )}

      <h3>同步会话</h3>
      {sessions.length === 0 ? <p>无会话</p> : (
        <ul>
          {sessions.map((s) => (
            <li key={s.id}>
              {s.endpoint.type} - {s.status}
              <button onClick={() => { engine.stopSync(s.id); refresh(); }}>停止</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

// ============ 设备 Tab ============

const DevicesTab: React.FC<{ engine: WorktreeSyncEngine }> = ({ engine }) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<DeviceInfo['type']>('desktop');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);

  const refresh = () => setDevices(engine.listDevices());
  useEffect(() => { refresh(); }, [engine]);

  const handleAdd = () => {
    if (!name) return;
    engine.registerDevice({
      deviceId: `dev-${Date.now()}`,
      name,
      type,
      lastSeenAt: Date.now(),
      online: true,
    });
    setName('');
    refresh();
  };

  return (
    <div className="tab-devices" data-testid="devices-tab">
      <div className="form-row">
        <label>名称：</label>
        <input value={name} onChange={(e) => setName(e.target.value)} />
        <label>类型：</label>
        <select value={type} onChange={(e) => setType(e.target.value as DeviceInfo['type'])}>
          <option value="desktop">Desktop</option>
          <option value="laptop">Laptop</option>
          <option value="tablet">Tablet</option>
          <option value="phone">Phone</option>
          <option value="server">Server</option>
        </select>
        <button onClick={handleAdd}>添加</button>
      </div>

      <table>
        <thead>
          <tr><th>ID</th><th>名称</th><th>类型</th><th>在线</th><th>操作</th></tr>
        </thead>
        <tbody>
          {devices.map((d) => (
            <tr key={d.deviceId}>
              <td>{d.deviceId.slice(0, 12)}</td>
              <td>{d.name}</td>
              <td>{d.type}</td>
              <td>{d.online ? '是' : '否'}</td>
              <td>
                <button onClick={() => { engine.setDeviceOnline(d.deviceId, !d.online); refresh(); }}>
                  切换在线
                </button>
                <button onClick={() => { engine.setCurrentDevice(d.deviceId); }}>设为当前</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ============ 冲突 Tab ============

const ConflictsTab: React.FC<{ engine: WorktreeSyncEngine }> = ({ engine }) => {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);

  const refresh = () => setConflicts(engine.listConflicts());
  useEffect(() => { refresh(); }, [engine]);

  return (
    <div className="tab-conflicts" data-testid="conflicts-tab">
      {conflicts.length === 0 ? (
        <p>无冲突</p>
      ) : (
        <ul>
          {conflicts.map((c) => (
            <li key={c.id} className={`conflict-${c.status}`}>
              <strong>{c.type}</strong> - {c.status}
              <p>Local: {c.localSnapshot.id}</p>
              <p>Remote: {c.remoteSnapshot.id}</p>
              {c.status === 'pending' && (
                <div>
                  <button onClick={() => { engine.resolveConflict(c.id, { strategy: 'local' }); refresh(); }}>使用本地</button>
                  <button onClick={() => { engine.resolveConflict(c.id, { strategy: 'remote' }); refresh(); }}>使用远程</button>
                  <button onClick={() => { engine.abandonConflict(c.id); refresh(); }}>放弃</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default WorktreeSyncPanel;
