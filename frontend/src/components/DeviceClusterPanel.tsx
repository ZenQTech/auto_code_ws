/**
 * # DeviceClusterPanel - 设备集群管理面板
 * # Cycle 34 G34-03
 * #
 * # 功能：
 * #   - 设备列表（按状态/类型/标签过滤）
 * #   - 任务列表与路由
 * #   - 故障转移历史
 * #   - 远程命令与任务迁移
 * #   - 设备统计
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  DeviceClusterEngine,
  getDefaultDeviceClusterEngine,
  type Device,
  type ClusterTask,
  type FailoverEvent,
  type RemoteCommand,
  type DeviceStatus,
  type DeviceType,
} from '../utils/deviceClusterEngine';

export interface DeviceClusterPanelProps {
  engine?: DeviceClusterEngine;
  isOpen?: boolean;
  onClose?: () => void;
}

type TabKey = 'devices' | 'tasks' | 'failover' | 'commands' | 'stats';

export const DeviceClusterPanel: React.FC<DeviceClusterPanelProps> = ({
  engine: engineProp,
  isOpen: _isOpen,
  onClose,
}) => {
  const engine = useMemo(() => engineProp || getDefaultDeviceClusterEngine(), [engineProp]);
  const [tab, setTab] = useState<TabKey>('devices');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const events = ['device-registered', 'task-submitted', 'task-assigned', 'failover-triggered', 'command-sent'];
    const unsubs = events.map((evt) =>
      engine.on(evt as any, () => setRefreshKey((k) => k + 1)),
    );
    return () => {
      unsubs.forEach((u) => u());
    };
  }, [engine]);

  const stats = useMemo(() => engine.getStats(), [engine, refreshKey]);

  return (
    <div className="device-cluster-panel" data-testid="device-cluster-panel">
      <div className="panel-header">
        <h2>设备集群 (Device Cluster)</h2>
        {onClose && (
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        )}
      </div>

      <div className="panel-stats">
        <span>设备: {stats.devices.total}</span>
        <span>在线: {stats.devices.online}</span>
        <span>任务: {stats.tasks.total}</span>
        <span>故障转移: {stats.failover.total}</span>
        <span>命令: {stats.commands.total}</span>
      </div>

      <div className="panel-tabs">
        <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>
          设备
        </button>
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
          任务
        </button>
        <button className={tab === 'failover' ? 'active' : ''} onClick={() => setTab('failover')}>
          故障转移
        </button>
        <button className={tab === 'commands' ? 'active' : ''} onClick={() => setTab('commands')}>
          命令
        </button>
        <button className={tab === 'stats' ? 'active' : ''} onClick={() => setTab('stats')}>
          统计
        </button>
      </div>

      <div className="panel-body" data-refresh={refreshKey}>
        {tab === 'devices' && <DevicesTab engine={engine} />}
        {tab === 'tasks' && <TasksTab engine={engine} />}
        {tab === 'failover' && <FailoverTab engine={engine} />}
        {tab === 'commands' && <CommandsTab engine={engine} />}
        {tab === 'stats' && <StatsTab engine={engine} />}
      </div>
    </div>
  );
};

// ============ Devices Tab ============

const DevicesTab: React.FC<{ engine: DeviceClusterEngine }> = ({ engine }) => {
  const [status, setStatus] = useState<DeviceStatus | 'all'>('all');
  const [type, setType] = useState<DeviceType | 'all'>('all');

  const devices = useMemo(() => {
    return engine.listDevices({
      status: status === 'all' ? undefined : status,
      type: type === 'all' ? undefined : type,
    });
  }, [engine, status, type, engine.listDevices().length]);

  return (
    <div className="devices-tab">
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="all">所有状态</option>
          <option value="online">在线</option>
          <option value="offline">离线</option>
          <option value="degraded">降级</option>
          <option value="busy">繁忙</option>
        </select>
        <select value={type} onChange={(e) => setType(e.target.value as any)}>
          <option value="all">所有类型</option>
          <option value="desktop">桌面</option>
          <option value="mobile">移动</option>
          <option value="server">服务器</option>
          <option value="edge">边缘</option>
          <option value="browser">浏览器</option>
        </select>
        <span>共 {devices.length} 个设备</span>
      </div>

      <div className="devices-grid">
        {devices.map((d) => (
          <DeviceCard key={d.id} device={d} engine={engine} />
        ))}
      </div>
    </div>
  );
};

const DeviceCard: React.FC<{ device: Device; engine: DeviceClusterEngine }> = ({ device, engine }) => {
  const handleHeartbeat = () => {
    engine.recordHeartbeat(device.id);
  };

  return (
    <div className={`device-card device-${device.type} device-status-${device.status}`} data-testid={`device-${device.id}`}>
      <div className="device-header">
        <h3>{device.name}</h3>
        <span className={`status-badge status-${device.status}`}>{device.status}</span>
      </div>
      <p className="device-type">{device.type} · {device.region}</p>
      <div className="device-caps">
        <span>CPU: {device.capabilities.cpu.cores}核 ({device.capabilities.cpu.usagePercent}%)</span>
        <span>内存: {device.capabilities.memory.availableMb}/{device.capabilities.memory.totalMb}MB</span>
        {device.capabilities.gpu && <span>GPU: {device.capabilities.gpu.model} ({device.capabilities.gpu.vramMb}MB)</span>}
        {device.capabilities.battery && (
          <span>电量: {device.capabilities.battery.level}%{device.capabilities.battery.charging ? ' ⚡' : ''}</span>
        )}
      </div>
      <div className="device-labels">
        {device.labels.map((l) => (
          <span key={l} className="label-badge">{l}</span>
        ))}
      </div>
      <p className="device-endpoint">{device.endpoint}</p>
      <button onClick={handleHeartbeat} data-testid={`heartbeat-${device.id}`}>
        发送心跳
      </button>
    </div>
  );
};

// ============ Tasks Tab ============

const TasksTab: React.FC<{ engine: DeviceClusterEngine }> = ({ engine }) => {
  const [status, setStatus] = useState<string>('all');
  const tasks = useMemo(() => {
    return status === 'all'
      ? engine.listTasks()
      : engine.listTasks({ status: status as any });
  }, [engine, status, engine.listTasks().length]);

  return (
    <div className="tasks-tab">
      <div className="toolbar">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">所有状态</option>
          <option value="pending">待处理</option>
          <option value="assigned">已分配</option>
          <option value="completed">完成</option>
          <option value="failed">失败</option>
          <option value="cancelled">取消</option>
        </select>
        <span>共 {tasks.length} 个任务</span>
      </div>

      <div className="tasks-list">
        {tasks.length === 0 && <p className="empty">暂无任务</p>}
        {tasks.map((t) => (
          <TaskRow key={t.id} task={t} engine={engine} />
        ))}
      </div>
    </div>
  );
};

const TaskRow: React.FC<{ task: ClusterTask; engine: DeviceClusterEngine }> = ({ task, engine }) => {
  return (
    <div className={`task-row task-${task.status}`} data-testid={`task-${task.id}`}>
      <div>
        <strong>{task.name}</strong>
        <span className="type-badge">{task.type}</span>
        <span className={`status-badge status-${task.status}`}>{task.status}</span>
      </div>
      <p>设备: {task.assignedDevice || '未分配'}</p>
      <p>尝试: {task.attempts.length} 次</p>
      {task.status === 'failed' && (
        <button onClick={() => engine.retryTask(task.id)}>重试</button>
      )}
      {(task.status === 'assigned' || task.status === 'running') && (
        <button onClick={() => engine.cancelTask(task.id)}>取消</button>
      )}
    </div>
  );
};

// ============ Failover Tab ============

const FailoverTab: React.FC<{ engine: DeviceClusterEngine }> = ({ engine }) => {
  const history = engine.getFailoverHistory();
  return (
    <div className="failover-tab">
      <h3>故障转移历史 ({history.length})</h3>
      <div className="failover-list">
        {history.length === 0 && <p className="empty">暂无故障转移</p>}
        {history.map((f) => (
          <FailoverRow key={f.id} event={f} />
        ))}
      </div>
    </div>
  );
};

const FailoverRow: React.FC<{ event: FailoverEvent }> = ({ event }) => {
  return (
    <div className="failover-row" data-testid={`failover-${event.id}`}>
      <div>
        <strong>{event.taskId}</strong>
        <span className="reason-badge">{event.reason}</span>
        <span className="strategy-badge">{event.strategy}</span>
      </div>
      <p>从 {event.fromDeviceId} → {event.newDeviceId || 'N/A'}</p>
      <p>{new Date(event.timestamp).toLocaleString()}</p>
    </div>
  );
};

// ============ Commands Tab ============

const CommandsTab: React.FC<{ engine: DeviceClusterEngine }> = ({ engine }) => {
  const commands = engine.listCommands();
  return (
    <div className="commands-tab">
      <h3>远程命令 ({commands.length})</h3>
      <div className="commands-list">
        {commands.length === 0 && <p className="empty">暂无命令</p>}
        {commands.map((c) => (
          <CommandRow key={c.id} command={c} />
        ))}
      </div>
    </div>
  );
};

const CommandRow: React.FC<{ command: RemoteCommand }> = ({ command }) => {
  return (
    <div className="command-row" data-testid={`command-${command.id}`}>
      <div>
        <strong>{command.type}</strong>
        <span className={`status-badge status-${command.status}`}>{command.status}</span>
      </div>
      <p>从 {command.fromDeviceId} → {command.toDeviceId}</p>
      <p>{new Date(command.createdAt).toLocaleString()}</p>
    </div>
  );
};

// ============ Stats Tab ============

const StatsTab: React.FC<{ engine: DeviceClusterEngine }> = ({ engine }) => {
  const stats = engine.getStats();
  return (
    <div className="stats-tab">
      <h3>统计</h3>
      <div className="stats-section">
        <h4>设备</h4>
        <p>总数: {stats.devices.total}</p>
        <p>在线: {stats.devices.online}</p>
        <p>离线: {stats.devices.offline}</p>
        <p>降级: {stats.devices.degraded}</p>
        <p>桌面: {stats.devices.byType.desktop} | 移动: {stats.devices.byType.mobile} | 边缘: {stats.devices.byType.edge}</p>
      </div>
      <div className="stats-section">
        <h4>任务</h4>
        <p>总数: {stats.tasks.total}</p>
        <p>已分配: {stats.tasks.assigned}</p>
        <p>完成: {stats.tasks.completed}</p>
        <p>失败: {stats.tasks.failed}</p>
      </div>
      <div className="stats-section">
        <h4>故障转移</h4>
        <p>总数: {stats.failover.total}</p>
        <p>心跳超时: {stats.failover.byReason['heartbeat-timeout']}</p>
        <p>设备失败: {stats.failover.byReason['device-failed']}</p>
      </div>
      <div className="stats-section">
        <h4>命令</h4>
        <p>总数: {stats.commands.total}</p>
        <p>已完成: {stats.commands.byStatus.completed}</p>
        <p>失败: {stats.commands.byStatus.failed}</p>
      </div>
    </div>
  );
};

export default DeviceClusterPanel;
