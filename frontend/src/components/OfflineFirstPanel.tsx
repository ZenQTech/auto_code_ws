/**
 * # OfflineFirstPanel - 离线优先工作流面板
 * # Cycle 34 G34-02
 * #
 * # 功能：
 * #   - 网络状态监控
 * #   - 本地操作队列
 * #   - 同步控制
 * #   - CRDT 文档管理
 * #   - 引擎降级链配置
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  OfflineFirstEngine,
  getDefaultOfflineFirstEngine,
  type NetworkState,
  type OperationLogEntry,
  type CRDTDocument,
} from '../utils/offlineFirstEngine';

export interface OfflineFirstPanelProps {
  engine?: OfflineFirstEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'network' | 'queue' | 'crdt' | 'fallback' | 'stats';

export const OfflineFirstPanel: React.FC<OfflineFirstPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(() => engineProp || getDefaultOfflineFirstEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('network');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const events = ['network-status-changed', 'operation-queued', 'operation-synced', 'sync-completed', 'crdt-updated'];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const stats = useMemo(() => engine.getStats(), [engine, refreshKey]);

  return (
    <div className="offline-first-panel" data-testid="offline-first-panel">
      <div className="panel-header">
        <h2>离线优先 (Offline First)</h2>
        {onClose && (
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>

      <div className="panel-stats">
        <span>队列: {stats.queue.total}</span>
        <span>待同步: {stats.queue.pending}</span>
        <span>CRDT: {stats.crdts.total}</span>
        <span>Fallback: {stats.fallbacks.registered}</span>
      </div>

      <div className="panel-tabs">
        <button className={tab === 'network' ? 'active' : ''} onClick={() => setTab('network')}>
          网络
        </button>
        <button className={tab === 'queue' ? 'active' : ''} onClick={() => setTab('queue')}>
          队列
        </button>
        <button className={tab === 'crdt' ? 'active' : ''} onClick={() => setTab('crdt')}>
          CRDT
        </button>
        <button className={tab === 'fallback' ? 'active' : ''} onClick={() => setTab('fallback')}>
          降级
        </button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          统计
        </button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'network' && <NetworkTab engine={engine} />}
        {tab === 'queue' && <QueueTab engine={engine} />}
        {tab === 'crdt' && <CRDTTab engine={engine} />}
        {tab === 'fallback' && <FallbackTab engine={engine} />}
        {tab === 'stats' && <StatsTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ Network Tab ============

const NetworkTab: React.FC<{ engine: OfflineFirstEngine }> = ({ engine }) => {
  const [state, setState] = useState<NetworkState>(engine.getNetworkState());

  useEffect(() => {
    const unsub = engine.onNetworkChange((s) => setState({ ...s }));
    return () => unsub();
  }, [engine]);

  const handlePing = async () => {
    await engine.ping();
    setState(engine.getNetworkState());
  };

  return (
    <div className="network-tab">
      <div className="network-status">
        <div className={`status-indicator status-${state.status}`} data-testid="network-status">
          {state.status === 'online' ? '🟢 在线' : state.status === 'offline' ? '🔴 离线' : '🟡 不稳定'}
        </div>
        <h3>网络状态</h3>
      </div>
      <div className="network-details">
        <p>延迟: {state.latencyMs !== null ? `${state.latencyMs}ms` : 'N/A'}</p>
        <p>连续失败: {state.consecutiveFailures}</p>
        <p>最后在线: {state.lastOnline ? new Date(state.lastOnline).toLocaleString() : '从未'}</p>
        <p>Ping 端点: {state.pingEndpoint}</p>
      </div>
      <div className="network-actions">
        <button onClick={handlePing} data-testid="ping-button">主动 Ping</button>
      </div>
    </div>
  );
};

// ============ Queue Tab ============

const QueueTab: React.FC<{ engine: OfflineFirstEngine }> = ({ engine }) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const operations = useMemo(() => {
    return statusFilter === 'all'
      ? engine.listOperations()
      : engine.listOperations({ status: statusFilter as any });
  }, [engine, statusFilter]);

  const handleSync = async () => {
    await engine.syncNow();
  };

  return (
    <div className="queue-tab">
      <div className="toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="all">所有状态</option>
          <option value="pending">待处理</option>
          <option value="syncing">同步中</option>
          <option value="completed">已完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">已取消</option>
        </select>
        <button onClick={handleSync} data-testid="sync-now">立即同步</button>
        <button onClick={() => engine.pauseSync()}>暂停</button>
        <button onClick={() => engine.resumeSync()}>恢复</button>
      </div>
      <div className="queue-list">
        {operations.length === 0 && <p className="empty">队列为空</p>}
        {operations.map((op) => (
          <OperationRow key={op.id} operation={op} engine={engine} />
        ))}
      </div>
    </div>
  );
};

const OperationRow: React.FC<{ operation: OperationLogEntry; engine: OfflineFirstEngine }> = ({ operation, engine }) => {
  return (
    <div className={`operation-row op-${operation.status}`} data-testid={`op-${operation.id}`}>
      <div>
        <strong>{operation.type}</strong>
        <span className="collection-badge">{operation.collection}</span>
        <span className={`status-badge status-${operation.status}`}>{operation.status}</span>
      </div>
      <div className="op-meta">
        <span>优先级: {operation.priority}</span>
        <span>尝试: {operation.attempts}/{operation.maxAttempts}</span>
        <span>{new Date(operation.createdAt).toLocaleTimeString()}</span>
      </div>
      {operation.status === 'failed' && (
        <button onClick={() => engine.retryOperation(operation.id)}>重试</button>
      )}
      {operation.status === 'pending' && (
        <button onClick={() => engine.cancelOperation(operation.id)}>取消</button>
      )}
    </div>
  );
};

// ============ CRDT Tab ============

const CRDTTab: React.FC<{ engine: OfflineFirstEngine }> = ({ engine }) => {
  const [type, setType] = useState<'counter' | 'register' | 'set' | 'map'>('counter');
  const [docList, setDocList] = useState<CRDTDocument[]>(engine.listCRDTs());

  useEffect(() => {
    const unsub = engine.on('crdt-updated', () => setDocList(engine.listCRDTs()));
    return () => unsub();
  }, [engine]);

  const handleCreate = () => {
    const id = `doc-${Date.now()}`;
    if (type === 'counter') engine.createCRDT(id, 'stats', 'counter', 0);
    else if (type === 'register') engine.createCRDT(id, 'config', 'register', 'initial');
    else if (type === 'set') engine.createCRDT(id, 'tags', 'set', []);
    else if (type === 'map') engine.createCRDT(id, 'kv', 'map', { key: 'value' });
    setDocList(engine.listCRDTs());
  };

  return (
    <div className="crdt-tab">
      <div className="toolbar">
        <select value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="counter">Counter</option>
          <option value="register">Register</option>
          <option value="set">Set</option>
          <option value="map">Map</option>
        </select>
        <button onClick={handleCreate} data-testid="create-crdt">创建 CRDT</button>
      </div>
      <div className="crdt-list">
        {docList.length === 0 && <p className="empty">暂无 CRDT 文档</p>}
        {docList.map((doc) => (
          <CRDTRow key={doc.id} doc={doc} engine={engine} />
        ))}
      </div>
    </div>
  );
};

const CRDTRow: React.FC<{ doc: CRDTDocument; engine: OfflineFirstEngine }> = ({ doc, engine: _engine }) => {
  return (
    <div className="crdt-row" data-testid={`crdt-${doc.id}`}>
      <div>
        <strong>{doc.id}</strong>
        <span className="type-badge">{doc.type}</span>
      </div>
      <p>集合: {doc.collection}</p>
      <p>版本: v{doc.version}</p>
      <p>最后修改: {new Date(doc.lastModified).toLocaleTimeString()}</p>
    </div>
  );
};

// ============ Fallback Tab ============

const FallbackTab: React.FC<{ engine: OfflineFirstEngine }> = ({ engine }) => {
  const [primary, setPrimary] = useState('cloud-llm');
  const [fallbackEngine, setFallbackEngine] = useState('edge-llm');
  const [fallbackMethod, setFallbackMethod] = useState('generate');

  const handleRegister = () => {
    engine.registerFallback({
      primaryEngine: primary,
      fallbacks: [{ engine: fallbackEngine, method: fallbackMethod, condition: 'on-error' }],
      degradedFeatures: ['reduced-quality'],
    });
  };

  return (
    <div className="fallback-tab">
      <h3>注册降级链</h3>
      <div className="form">
        <label>
          主引擎:
          <input value={primary} onChange={(e) => setPrimary(e.target.value)} />
        </label>
        <label>
          Fallback 引擎:
          <input value={fallbackEngine} onChange={(e) => setFallbackEngine(e.target.value)} />
        </label>
        <label>
          Fallback 方法:
          <input value={fallbackMethod} onChange={(e) => setFallbackMethod(e.target.value)} />
        </label>
        <button onClick={handleRegister} data-testid="register-fallback">注册</button>
      </div>
    </div>
  );
};

// ============ Stats Tab ============

const StatsTab: React.FC<{ engine: OfflineFirstEngine }> = ({ engine }) => {
  const stats = engine.getStats();
  const sync = stats.sync;

  return (
    <div className="stats-tab">
      <h3>统计</h3>
      <div className="stats-section">
        <h4>队列</h4>
        <p>总数: {stats.queue.total}</p>
        <p>待处理: {stats.queue.pending}</p>
        <p>同步中: {stats.queue.syncing}</p>
        <p>已完成: {stats.queue.completed}</p>
        <p>失败: {stats.queue.failed}</p>
      </div>
      <div className="stats-section">
        <h4>同步</h4>
        <p>总操作: {sync.totalOperations}</p>
        <p>已完成: {sync.completedOperations}</p>
        <p>失败: {sync.failedOperations}</p>
        <p>平均延迟: {sync.avgSyncLatencyMs}ms</p>
        <p>总耗时: {sync.totalSyncTime}ms</p>
      </div>
      <div className="stats-section">
        <h4>CRDT</h4>
        <p>总数: {stats.crdts.total}</p>
        <p>Counter: {stats.crdts.byType.counter}</p>
        <p>Register: {stats.crdts.byType.register}</p>
        <p>Set: {stats.crdts.byType.set}</p>
        <p>Map: {stats.crdts.byType.map}</p>
      </div>
    </div>
  );
};

export default OfflineFirstPanel;
