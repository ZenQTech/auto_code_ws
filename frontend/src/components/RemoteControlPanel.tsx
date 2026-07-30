/**
 * # ============================================================
 * # RemoteControlPanel - 远程控制面板 (v1.0.0 Cycle 27 G27-06)
 * # ============================================================
 * # 核心作用：提供远程控制的可视化管理界面
 * # 功能：QR 配对、设备管理、Thread 迁移、远程命令、连接管理
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-06 初次创建
 * # ============================================================
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  DEVICE_STATUS_METADATA,
  DEVICE_TYPE_METADATA,
  PERMISSION_METADATA,
  PLATFORM_METADATA,
  RemoteDevice,
  RemoteDevicePermission,
  RemotePairingSession,
  RemoteThreadHandoff,
} from '../utils/remoteControlTypes';
import {
  RemoteControlEngine,
  getDefaultRemoteControlEngine,
} from '../utils/remoteControlEngine';

type ViewMode = 'devices' | 'pairing' | 'handoff' | 'commands';

export interface RemoteControlPanelProps {
  isOpen: boolean;
  onClose: () => void;
  engine?: RemoteControlEngine;
}

export function RemoteControlPanel({
  isOpen,
  onClose,
  engine: propEngine,
}: RemoteControlPanelProps): React.ReactElement | null {
  const fallbackEngine = useMemo(() => getDefaultRemoteControlEngine(), []);
  const engine = propEngine ?? fallbackEngine;
  const [viewMode, setViewMode] = useState<ViewMode>('devices');
  const [activePairingId, setActivePairingId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_refreshKey, setRefreshKey] = useState(0);

  // 订阅事件
  useEffect(() => {
    const refresh = () => setRefreshKey((k) => k + 1);
    const unsubStarted = engine.on('pairing-started', refresh);
    const unsubCompleted = engine.on('pairing-completed', refresh);
    const unsubScanned = engine.on('pairing-scanned', refresh);
    const unsubExpired = engine.on('pairing-expired', refresh);
    const unsubPaired = engine.on('device-paired', refresh);
    const unsubConnected = engine.on('device-connected', refresh);
    const unsubDisconnected = engine.on('device-disconnected', refresh);
    const unsubRevoked = engine.on('device-revoked', refresh);
    const unsubCmdReceived = engine.on('command-received', refresh);
    const unsubCmdCompleted = engine.on('command-completed', refresh);
    const unsubHandoffStarted = engine.on('handoff-started', refresh);
    const unsubHandoffCompleted = engine.on('handoff-completed', refresh);
    return () => {
      unsubStarted();
      unsubCompleted();
      unsubScanned();
      unsubExpired();
      unsubPaired();
      unsubConnected();
      unsubDisconnected();
      unsubRevoked();
      unsubCmdReceived();
      unsubCmdCompleted();
      unsubHandoffStarted();
      unsubHandoffCompleted();
    };
  }, [engine]);

  // 自动刷新（轮询，处理过期等不需要事件触发的状态）
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setRefreshKey((k) => k + 1), 1000);
    return () => clearInterval(id);
  }, [isOpen]);

  if (!isOpen) return null;

  const stats = engine.getStats();
  const devices = engine.listDevices();
  const pairings = engine.listPairings();
  const handoffs = engine.listHandoffs();
  const commands = engine.listCommands();
  const activePairing = activePairingId ? engine.getPairing(activePairingId) : null;

  return (
    <div
      data-testid="remote-control-panel"
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white dark:bg-slate-900 rounded-lg shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col">
        <Header stats={stats} onClose={onClose} />

        <Toolbar viewMode={viewMode} onViewModeChange={(m) => {
          setViewMode(m);
          setActivePairingId(null);
        }} />

        <div className="flex-1 overflow-y-auto p-6">
          {viewMode === 'pairing' && (
            <PairingView
              engine={engine}
              activePairing={activePairing}
              onSelectPairing={setActivePairingId}
              onUpdate={() => setRefreshKey((k) => k + 1)}
              pairings={pairings}
            />
          )}
          {viewMode === 'devices' && (
            <DevicesView engine={engine} devices={devices} onUpdate={() => setRefreshKey((k) => k + 1)} />
          )}
          {viewMode === 'handoff' && (
            <HandoffView
              engine={engine}
              handoffs={handoffs}
              devices={devices}
              onUpdate={() => setRefreshKey((k) => k + 1)}
            />
          )}
          {viewMode === 'commands' && (
            <CommandsView engine={engine} commands={commands} devices={devices} onUpdate={() => setRefreshKey((k) => k + 1)} />
          )}
        </div>

        <Footer />
      </div>
    </div>
  );
}

// ============ Header ============

function Header({ stats, onClose }: { stats: ReturnType<RemoteControlEngine['getStats']>; onClose: () => void }): React.ReactElement {
  return (
    <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="text-2xl">📡</span>
        <div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">远程控制</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            设备 {stats.totalDevices} · 活跃 {stats.activeDevices} · 待配对 {stats.pendingPairings} · 待迁移 {stats.activeHandoffs} · 待处理命令 {stats.pendingCommands}
          </p>
        </div>
      </div>
      <button onClick={onClose} className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-2xl leading-none" aria-label="关闭">×</button>
    </div>
  );
}

// ============ Toolbar ============

function Toolbar({ viewMode, onViewModeChange }: { viewMode: ViewMode; onViewModeChange: (m: ViewMode) => void }): React.ReactElement {
  return (
    <div className="px-6 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
      <TabButton active={viewMode === 'devices'} onClick={() => onViewModeChange('devices')} testId="tab-devices">📱 设备</TabButton>
      <TabButton active={viewMode === 'pairing'} onClick={() => onViewModeChange('pairing')} testId="tab-pairing">🔗 QR 配对</TabButton>
      <TabButton active={viewMode === 'handoff'} onClick={() => onViewModeChange('handoff')} testId="tab-handoff">🚚 Thread 迁移</TabButton>
      <TabButton active={viewMode === 'commands'} onClick={() => onViewModeChange('commands')} testId="tab-commands">⌨️ 远程命令</TabButton>
    </div>
  );
}

function TabButton({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }): React.ReactElement {
  return (
    <button
      onClick={onClick}
      data-testid={testId}
      className={`px-3 py-1.5 text-sm font-medium rounded transition ${
        active
          ? 'bg-blue-500 text-white'
          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
      }`}
    >
      {children}
    </button>
  );
}

// ============ Pairing View ============

function PairingView({
  engine,
  activePairing,
  onSelectPairing,
  onUpdate,
  pairings,
}: {
  engine: RemoteControlEngine;
  activePairing: RemotePairingSession | null | undefined;
  onSelectPairing: (id: string | null) => void;
  onUpdate: () => void;
  pairings: RemotePairingSession[];
}): React.ReactElement {
  const handleStart = () => {
    const session = engine.startPairing();
    onSelectPairing(session.id);
    onUpdate();
  };

  const handleSimulateScan = () => {
    if (!activePairing) return;
    engine.markScanned(activePairing.id);
    onUpdate();
  };

  const handleSimulateComplete = async () => {
    if (!activePairing) return;
    try {
      await engine.completePairing(activePairing.id, {
        name: 'iPhone ' + Math.floor(Math.random() * 20),
        type: 'mobile',
        platform: Math.random() > 0.5 ? 'ios' : 'android',
      });
      onSelectPairing(null);
      onUpdate();
    } catch (e) {
      window.alert(`配对失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleCancel = () => {
    if (!activePairing) return;
    engine.cancelPairing(activePairing.id);
    onSelectPairing(null);
    onUpdate();
  };

  // 倒计时
  const remaining = activePairing ? Math.max(0, activePairing.expiresAt - Date.now()) : 0;
  const remainingSec = Math.floor(remaining / 1000);

  return (
    <div className="space-y-4" data-testid="pairing-view">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">QR 配对</h3>
        {!activePairing && (
          <button
            onClick={handleStart}
            data-testid="start-pairing-button"
            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium"
          >
            ➕ 启动新配对
          </button>
        )}
      </div>

      {activePairing && (
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-6 flex flex-col items-center" data-testid="qr-display">
            <QRCodeMock payload={activePairing.qrPayload} />
            <div className="mt-3 text-center">
              <div className="text-2xl font-mono font-bold text-blue-600 dark:text-blue-400 tracking-widest" data-testid="short-code">
                {activePairing.shortCode}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                状态: <span className="font-medium">{activePairing.status}</span> · 剩余 {remainingSec}s
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded">
              <div className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">配对 URL</div>
              <code className="text-xs text-slate-600 dark:text-slate-400 break-all">{activePairing.pairingUrl}</code>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSimulateScan}
                data-testid="simulate-scan-button"
                disabled={activePairing.status !== 'pending'}
                className="px-3 py-2 bg-yellow-500 hover:bg-yellow-600 text-white text-sm rounded disabled:opacity-50"
              >
                📱 模拟扫描
              </button>
              <button
                onClick={handleSimulateComplete}
                data-testid="simulate-complete-button"
                disabled={activePairing.status === 'paired' || activePairing.status === 'expired' || activePairing.status === 'cancelled'}
                className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded disabled:opacity-50"
              >
                ✅ 模拟完成配对
              </button>
              <button
                onClick={handleCancel}
                data-testid="cancel-pairing-button"
                disabled={activePairing.status === 'paired' || activePairing.status === 'expired' || activePairing.status === 'cancelled'}
                className="px-3 py-2 bg-red-500 hover:bg-red-600 text-white text-sm rounded disabled:opacity-50"
              >
                ❌ 取消
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">历史配对会话</h4>
        {pairings.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-6 bg-slate-50 dark:bg-slate-800 rounded">暂无配对记录</div>
        ) : (
          <div className="space-y-1.5">
            {pairings.slice(0, 10).map((p) => (
              <div key={p.id} className="p-2 bg-slate-50 dark:bg-slate-800 rounded text-sm flex items-center gap-2" data-testid={`pairing-item-${p.id}`}>
                <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{p.shortCode}</span>
                <span className="text-slate-500 dark:text-slate-400">·</span>
                <span className="text-slate-700 dark:text-slate-300">{p.status}</span>
                <span className="text-slate-500 dark:text-slate-400">·</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">{new Date(p.createdAt).toLocaleString('zh-CN')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function QRCodeMock({ payload }: { payload: string }): React.ReactElement {
  // 用 canvas 模拟 QR 码外观（不实际可扫描）
  const size = 13;
  const cells = useMemo(() => {
    // 简单的确定性 pattern
    const out: boolean[] = [];
    let seed = 0;
    for (let i = 0; i < payload.length; i++) seed = (seed * 31 + payload.charCodeAt(i)) >>> 0;
    for (let i = 0; i < size * size; i++) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      out.push((seed & 0x8000) !== 0);
    }
    return out;
  }, [payload]);

  return (
    <div
      className="grid bg-white p-2 rounded"
      style={{ gridTemplateColumns: `repeat(${size}, 1fr)`, width: '192px', height: '192px', gap: 1 }}
      data-testid="qr-mock"
    >
      {cells.map((on, i) => (
        <div
          key={i}
          className={on ? 'bg-slate-900' : 'bg-white'}
          style={{ width: '100%', height: '100%' }}
        />
      ))}
    </div>
  );
}

// ============ Devices View ============

function DevicesView({ engine, devices, onUpdate }: { engine: RemoteControlEngine; devices: RemoteDevice[]; onUpdate: () => void }): React.ReactElement {
  const handleConnect = async (id: string) => {
    try {
      await engine.simulateConnect(id);
      onUpdate();
    } catch (e) {
      window.alert(`连接失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleDisconnect = async (id: string) => {
    await engine.simulateDisconnect(id);
    onUpdate();
  };

  const handleRevoke = (id: string) => {
    if (window.confirm('确定撤销该设备？撤销后无法恢复。')) {
      engine.revokeDevice(id);
      onUpdate();
    }
  };

  const togglePermission = (device: RemoteDevice, perm: RemoteDevicePermission) => {
    const has = device.permissions.includes(perm);
    const next = has
      ? device.permissions.filter((p) => p !== perm)
      : [...device.permissions, perm];
    engine.updateDevicePermissions(device.id, next);
    onUpdate();
  };

  return (
    <div data-testid="devices-view">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">📱 已配对设备</h3>
      {devices.length === 0 ? (
        <div className="text-center py-12 text-slate-500 dark:text-slate-400">
          <div className="text-5xl mb-2">📱</div>
          <p>暂无已配对设备</p>
          <p className="text-xs mt-1">在 QR 配对中完成配对后，设备会出现在这里</p>
        </div>
      ) : (
        <div className="space-y-3">
          {devices.map((d) => {
            const statusMeta = DEVICE_STATUS_METADATA[d.status];
            const typeMeta = DEVICE_TYPE_METADATA[d.type];
            const platformMeta = PLATFORM_METADATA[d.platform];
            return (
              <div key={d.id} className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg" data-testid={`device-${d.id}`}>
                <div className="flex items-start gap-3 mb-3">
                  <span className="text-3xl">{typeMeta.icon}</span>
                  <div className="flex-1">
                    <div className="font-bold text-slate-900 dark:text-slate-100">{d.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      {platformMeta.icon} {platformMeta.label} · {typeMeta.label} · <span className={statusMeta.color}>{statusMeta.label}</span>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      🔑 {d.fingerprint} · 配对 {new Date(d.pairedAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {d.status === 'paired' || d.status === 'disconnected' ? (
                      <button onClick={() => handleConnect(d.id)} data-testid={`connect-${d.id}`} className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded">📶 连接</button>
                    ) : d.status === 'connected' ? (
                      <button onClick={() => handleDisconnect(d.id)} data-testid={`disconnect-${d.id}`} className="px-2 py-1 bg-yellow-500 hover:bg-yellow-600 text-white text-xs rounded">⏸ 断开</button>
                    ) : null}
                    {d.status !== 'revoked' && (
                      <button onClick={() => handleRevoke(d.id)} data-testid={`revoke-${d.id}`} className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded">🚫 撤销</button>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1.5">权限</div>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(PERMISSION_METADATA).map(([key, meta]) => {
                      const perm = key as RemoteDevicePermission;
                      const enabled = d.permissions.includes(perm);
                      return (
                        <button
                          key={key}
                          onClick={() => togglePermission(d, perm)}
                          disabled={d.status === 'revoked'}
                          data-testid={`perm-${d.id}-${key}`}
                          className={`px-2 py-1 text-xs rounded transition ${
                            enabled
                              ? 'bg-blue-500 text-white'
                              : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-300 dark:hover:bg-slate-600'
                          } ${meta.risk === 'high' ? 'ring-1 ring-red-300' : ''}`}
                        >
                          {meta.icon} {meta.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ Handoff View ============

function HandoffView({
  engine,
  handoffs,
  devices,
  onUpdate,
}: {
  engine: RemoteControlEngine;
  handoffs: RemoteThreadHandoff[];
  devices: RemoteDevice[];
  onUpdate: () => void;
}): React.ReactElement {
  const [threadId, setThreadId] = useState('thread-demo');
  const [threadName, setThreadName] = useState('Code Review Thread');
  const [fromId, setFromId] = useState(devices[0]?.id || '');
  const [toId, setToId] = useState(devices[1]?.id || '');
  const [messageCount, setMessageCount] = useState(42);
  const [sizeBytes, setSizeBytes] = useState(102400);

  useEffect(() => {
    if (!fromId && devices[0]) setFromId(devices[0].id);
    if (!toId && devices[1]) setToId(devices[1].id);
  }, [devices, fromId, toId]);

  const handleStart = () => {
    if (!fromId) {
      window.alert('请选择源设备');
      return;
    }
    try {
      const h = engine.startHandoff({
        fromDeviceId: fromId,
        toDeviceId: toId || undefined,
        threadId,
        threadName,
        messageCount,
        sizeBytes,
      });
      engine.executeHandoff(h.id).then(() => onUpdate());
      onUpdate();
    } catch (e) {
      window.alert(`启动失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div data-testid="handoff-view">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">🚚 Thread 迁移</h3>

      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">启动新迁移</h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Thread ID</label>
            <input type="text" value={threadId} onChange={(e) => setThreadId(e.target.value)} data-testid="thread-id-input" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800" />
          </div>
          <div>
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Thread 名称</label>
            <input type="text" value={threadName} onChange={(e) => setThreadName(e.target.value)} data-testid="thread-name-input" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800" />
          </div>
          <div>
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">源设备</label>
            <select value={fromId} onChange={(e) => setFromId(e.target.value)} data-testid="from-device-select" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
              <option value="">-- 选择 --</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">目标设备（可选）</label>
            <select value={toId} onChange={(e) => setToId(e.target.value)} data-testid="to-device-select" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
              <option value="">-- 不指定 --</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">消息数</label>
            <input type="number" value={messageCount} onChange={(e) => setMessageCount(parseInt(e.target.value, 10) || 0)} data-testid="message-count-input" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800" />
          </div>
          <div>
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">大小（bytes）</label>
            <input type="number" value={sizeBytes} onChange={(e) => setSizeBytes(parseInt(e.target.value, 10) || 0)} data-testid="size-bytes-input" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800" />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button onClick={handleStart} data-testid="start-handoff-button" className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded font-medium">
            🚀 启动迁移
          </button>
        </div>
      </div>

      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">迁移历史</h4>
      {handoffs.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-6 bg-slate-50 dark:bg-slate-800 rounded">暂无迁移记录</div>
      ) : (
        <div className="space-y-1.5">
          {handoffs.map((h) => {
            const fromDev = devices.find((d) => d.id === h.fromDeviceId);
            const toDev = h.toDeviceId ? devices.find((d) => d.id === h.toDeviceId) : null;
            return (
              <div key={h.id} className="p-2 bg-slate-50 dark:bg-slate-800 rounded text-sm" data-testid={`handoff-${h.id}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-slate-900 dark:text-slate-100">{h.threadName}</span>
                  <span className="text-slate-500 dark:text-slate-400">·</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    h.status === 'completed' ? 'bg-green-100 text-green-700' :
                    h.status === 'failed' ? 'bg-red-100 text-red-700' :
                    h.status === 'in-progress' ? 'bg-blue-100 text-blue-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>{h.status}</span>
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {fromDev?.name || h.fromDeviceId} → {toDev?.name || '广播'} · {h.messageCount} 条消息 · {(h.sizeBytes / 1024).toFixed(1)} KB
                </div>
                {h.error && <div className="text-xs text-red-500 mt-1">❌ {h.error}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============ Commands View ============

function CommandsView({ engine, commands, devices, onUpdate }: { engine: RemoteControlEngine; commands: ReturnType<RemoteControlEngine['listCommands']>; devices: RemoteDevice[]; onUpdate: () => void }): React.ReactElement {
  const [selectedDevice, setSelectedDevice] = useState(devices[0]?.id || '');
  const [cmdType, setCmdType] = useState<RemoteCommandType>('request-status');

  useEffect(() => {
    if (!selectedDevice && devices[0]) setSelectedDevice(devices[0].id);
  }, [devices, selectedDevice]);

  const handleSend = () => {
    if (!selectedDevice) {
      window.alert('请选择设备');
      return;
    }
    try {
      engine.receiveCommand({
        deviceId: selectedDevice,
        type: cmdType,
        payload: { threadId: 't-1', ts: Date.now() },
      });
      onUpdate();
    } catch (e) {
      window.alert(`发送失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleAcknowledge = (id: string) => {
    engine.acknowledgeCommand(id);
    onUpdate();
  };

  const handleComplete = (id: string) => {
    engine.completeCommand(id, true);
    onUpdate();
  };

  return (
    <div data-testid="commands-view">
      <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100 mb-3">⌨️ 远程命令</h3>

      <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg mb-4">
        <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">模拟接收命令</h4>
        <div className="flex flex-wrap gap-2 items-end">
          <div className="flex-1 min-w-[150px]">
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">设备</label>
            <select value={selectedDevice} onChange={(e) => setSelectedDevice(e.target.value)} data-testid="cmd-device-select" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
              <option value="">-- 选择 --</option>
              {devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[150px]">
            <label className="text-xs text-slate-600 dark:text-slate-400 block mb-1">类型</label>
            <select value={cmdType} onChange={(e) => setCmdType(e.target.value as RemoteCommandType)} data-testid="cmd-type-select" className="w-full px-2 py-1 text-sm border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800">
              <option value="request-status">request-status</option>
              <option value="pause-thread">pause-thread</option>
              <option value="resume-thread">resume-thread</option>
              <option value="cancel-thread">cancel-thread</option>
              <option value="view-checkpoint">view-checkpoint</option>
              <option value="approve-action">approve-action</option>
              <option value="reject-action">reject-action</option>
            </select>
          </div>
          <button onClick={handleSend} data-testid="send-cmd-button" className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded">📤 接收命令</button>
        </div>
      </div>

      <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">命令历史</h4>
      {commands.length === 0 ? (
        <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-6 bg-slate-50 dark:bg-slate-800 rounded">暂无命令</div>
      ) : (
        <div className="space-y-1.5">
          {commands.slice(0, 30).map((c) => {
            const dev = devices.find((d) => d.id === c.deviceId);
            return (
              <div key={c.id} className="p-2 bg-slate-50 dark:bg-slate-800 rounded text-sm flex items-center gap-2" data-testid={`cmd-${c.id}`}>
                <span className="text-slate-900 dark:text-slate-100 font-medium">{c.type}</span>
                <span className="text-slate-500 dark:text-slate-400">·</span>
                <span className="text-slate-700 dark:text-slate-300">{dev?.name || c.deviceId}</span>
                <span className="text-slate-500 dark:text-slate-400">·</span>
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  c.status === 'completed' ? 'bg-green-100 text-green-700' :
                  c.status === 'failed' ? 'bg-red-100 text-red-700' :
                  c.status === 'acknowledged' ? 'bg-blue-100 text-blue-700' :
                  'bg-yellow-100 text-yellow-700'
                }`}>{c.status}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
                  {new Date(c.createdAt).toLocaleTimeString('zh-CN')}
                </span>
                {c.status === 'pending' && (
                  <button onClick={() => handleAcknowledge(c.id)} className="px-2 py-0.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded" data-testid={`ack-${c.id}`}>确认</button>
                )}
                {c.status === 'acknowledged' && (
                  <button onClick={() => handleComplete(c.id)} className="px-2 py-0.5 bg-green-500 hover:bg-green-600 text-white text-xs rounded" data-testid={`complete-${c.id}`}>完成</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RemoteCommandType =
  | 'pause-thread'
  | 'resume-thread'
  | 'cancel-thread'
  | 'approve-action'
  | 'reject-action'
  | 'view-checkpoint'
  | 'request-status';

// ============ Footer ============

function Footer(): React.ReactElement {
  return (
    <div className="px-6 py-2 border-t border-slate-200 dark:border-slate-700 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
      <span>💡 提示：所有设备/命令/迁移仅本地 mock，不发起真实网络请求</span>
      <span>🔐 使用 QR + 短码双因子配对</span>
    </div>
  );
}

export default RemoteControlPanel;
