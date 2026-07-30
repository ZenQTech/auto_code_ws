/**
 * Cycle 31 E2E 集成测试 (v6.86.0+)
 * 验证 G31-01/G31-02/G31-03 三个核心引擎 + UI 组件 + 主应用集成的端到端连通性
 *
 * 覆盖目标：
 * 1. CostAttributionEngine 五维注册 + 归因记录 + 多维聚合 + 异常告警 + 多格式导出
 * 2. RemoteWorktreeAdapter 后端注册 + 智能选择 + 创建/删除/迁移 + 健康检查
 * 3. WorktreeSyncEngine 快照 + 状态广播 + 冲突检测/解决 + 跨设备同步
 * 4. 三个 UI 组件可成功导入
 * 5. 三个引擎的事件系统独立工作
 * 6. 三引擎协同工作（团队归因 → Worktree 创建 → 跨设备同步）
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

describe('Cycle 31 E2E 集成测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('G31-01: CostAttribution 端到端', () => {
    it('五维注册 + 归因记录 + 多维聚合 完整流程', async () => {
      const { getDefaultCostAttributionEngine } = await import('../utils/costAttributionEngine');
      const engine = getDefaultCostAttributionEngine();

      // 1. 注册 5 个维度
      engine.registerOrg({ orgId: 'org-1', name: 'Acme Corp' });
      engine.registerTeam({ orgId: 'org-1', teamId: 'team-1', name: 'Engineering' });
      engine.registerProject({ orgId: 'org-1', teamId: 'team-1', projectId: 'proj-1', name: 'Hermes' });
      engine.registerRepo({ orgId: 'org-1', teamId: 'team-1', projectId: 'proj-1', repoId: 'repo-1', name: 'frontend' });
      engine.registerUser({ orgId: 'org-1', userId: 'user-1', name: 'Alice' });

      expect(engine.listOrgs()).toHaveLength(1);
      expect(engine.listTeams()).toHaveLength(1);
      expect(engine.listProjects()).toHaveLength(1);
      expect(engine.listRepos()).toHaveLength(1);
      expect(engine.listUsers()).toHaveLength(1);

      // 2. 归因单次 LLM 调用
      const record = engine.attribute({
        user: { orgId: 'org-1', userId: 'user-1', name: 'Alice' },
        repo: { orgId: 'org-1', teamId: 'team-1', projectId: 'proj-1', repoId: 'repo-1', name: 'frontend' },
        project: { orgId: 'org-1', teamId: 'team-1', projectId: 'proj-1', name: 'Hermes' },
        team: { orgId: 'org-1', teamId: 'team-1', name: 'Engineering' },
        org: { orgId: 'org-1', name: 'Acme Corp' },
        source: 'llm-call',
        model: 'claude-sonnet',
        inputTokens: 1000,
        outputTokens: 500,
        totalCost: 0.05,
        currency: 'USD',
      });
      expect(record.id).toBeDefined();
      expect(record.totalCost).toBe(0.05);

      // 3. 多维聚合查询
      const period = { from: Date.now() - 86400000, to: Date.now() };
      const orgReport = engine.getByOrg('org-1', period);
      expect(orgReport.totalCost).toBe(0.05);
      expect(orgReport.callCount).toBe(1);

      const teamReport = engine.getByTeam('team-1', period);
      expect(teamReport.totalCost).toBe(0.05);

      const projReport = engine.getByProject('proj-1', period);
      expect(projReport.totalCost).toBe(0.05);

      const repoReport = engine.getByRepo('repo-1', period);
      expect(repoReport.totalCost).toBe(0.05);

      const userReport = engine.getByUser('user-1', period);
      expect(userReport.totalCost).toBe(0.05);
    });

    it('异常检测 + 预算告警', async () => {
      const { getDefaultCostAttributionEngine } = await import('../utils/costAttributionEngine');
      const engine = getDefaultCostAttributionEngine();

      // 设置预算阈值（key 格式：<dimension>:<scopeId>）
      engine.setAlertThreshold('user:user-1', 100);

      // 录入正常消费
      engine.attribute({
        user: { orgId: 'org', userId: 'user-1', name: 'Alice' },
        repo: { orgId: 'org', teamId: 't', projectId: 'p', repoId: 'r', name: 'r' },
        project: { orgId: 'org', teamId: 't', projectId: 'p', name: 'p' },
        team: { orgId: 'org', teamId: 't', name: 't' },
        org: { orgId: 'org', name: 'org' },
        source: 'llm-call',
        model: 'm1',
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 50,
        currency: 'USD',
      });

      // 录入超预算消费
      engine.attribute({
        user: { orgId: 'org', userId: 'user-1', name: 'Alice' },
        repo: { orgId: 'org', teamId: 't', projectId: 'p', repoId: 'r', name: 'r' },
        project: { orgId: 'org', teamId: 't', projectId: 'p', name: 'p' },
        team: { orgId: 'org', teamId: 't', name: 't' },
        org: { orgId: 'org', name: 'org' },
        source: 'llm-call',
        model: 'm1',
        inputTokens: 200,
        outputTokens: 100,
        totalCost: 80,
        currency: 'USD',
      });

      // 检测异常
      const anomalies = engine.getAnomalies({ from: Date.now() - 86400000, to: Date.now() });
      expect(anomalies.length).toBeGreaterThan(0);
      expect(anomalies.some((a) => a.type === 'budget-overrun')).toBe(true);
    });

    it('多格式导出 (CSV/JSON/Chargeback)', async () => {
      const { getDefaultCostAttributionEngine } = await import('../utils/costAttributionEngine');
      const engine = getDefaultCostAttributionEngine();

      engine.registerOrg({ orgId: 'org', name: 'Org' });
      engine.registerUser({ orgId: 'org', userId: 'u1', name: 'User1', ssoId: 'sso1' });
      engine.attribute({
        user: { orgId: 'org', userId: 'u1', name: 'User1' },
        repo: { orgId: 'org', teamId: 't', projectId: 'p', repoId: 'r', name: 'r' },
        project: { orgId: 'org', teamId: 't', projectId: 'p', name: 'p' },
        team: { orgId: 'org', teamId: 't', name: 't' },
        org: { orgId: 'org', name: 'Org' },
        source: 'llm-call',
        model: 'm1',
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 1.5,
        currency: 'USD',
      });

      const period = { from: Date.now() - 86400000, to: Date.now() };
      const csv = engine.exportCSV({ period });
      expect(csv).toContain('user,');
      expect(csv.split('\n').length).toBeGreaterThan(1);

      const json = engine.exportJSON({ period });
      const parsed = JSON.parse(json);
      expect(parsed.records).toBeDefined();
      expect(Array.isArray(parsed.records)).toBe(true);

      const chargeback = engine.exportChargeback({ period });
      expect(chargeback.lineItems.length).toBeGreaterThan(0);
      expect(chargeback.totalAmount).toBeGreaterThanOrEqual(1.5);
    });

    it('事件系统完整', async () => {
      const { getDefaultCostAttributionEngine } = await import('../utils/costAttributionEngine');
      const engine = getDefaultCostAttributionEngine();

      let recordCount = 0;
      let orgCount = 0;
      engine.on('attribution-recorded', () => recordCount++);
      engine.on('org-registered', () => orgCount++);

      engine.registerOrg({ orgId: 'o1', name: 'O1' });
      engine.attribute({
        user: { orgId: 'o1', userId: 'u1', name: 'U1' },
        repo: { orgId: 'o1', teamId: 't', projectId: 'p', repoId: 'r', name: 'r' },
        project: { orgId: 'o1', teamId: 't', projectId: 'p', name: 'p' },
        team: { orgId: 'o1', teamId: 't', name: 't' },
        org: { orgId: 'o1', name: 'O1' },
        source: 'llm-call',
        model: 'm1',
        inputTokens: 1,
        outputTokens: 1,
        totalCost: 0.01,
        currency: 'USD',
      });

      expect(recordCount).toBe(1);
      expect(orgCount).toBe(1);
    });

    it('单例 + 重置', async () => {
      const { getDefaultCostAttributionEngine, resetDefaultCostAttributionEngine } = await import('../utils/costAttributionEngine');
      resetDefaultCostAttributionEngine();
      const a = getDefaultCostAttributionEngine();
      const b = getDefaultCostAttributionEngine();
      expect(a).toBe(b);
    });
  });

  describe('G31-02: RemoteWorktree 端到端', () => {
    it('后端注册 + 智能选择 + 创建 Worktree 完整流程', async () => {
      const { RemoteWorktreeAdapter } = await import('../utils/remoteWorktreeAdapter');
      const adapter = new RemoteWorktreeAdapter();

      // 1. 注册后端
      const localId = adapter.registerBackend({
        id: 'local-1',
        name: 'Local Backend',
        enabled: true,
        priority: 1,
        type: 'local',
        basePath: '/tmp/worktrees',
      });

      const remoteId = adapter.registerBackend({
        id: 'remote-1',
        name: 'Cloud Backend',
        enabled: true,
        priority: 2,
        type: 'remote',
        endpoint: 'https://worktree.example.com',
        region: 'us-west',
      });

      expect(localId).toBeDefined();
      expect(remoteId).toBeDefined();
      expect(adapter.listBackends().length).toBe(2);

      // 2. 智能选择（成本最低）
      const selected = adapter.selectBackend({ optimizeFor: 'cost' });
      expect(selected).toBeDefined();

      // 3. 创建 Worktree
      const wt = await adapter.create({
        branch: 'feature/cycle31',
        baseBranch: 'main',
        backendId: localId.id,
      });
      expect(wt.id).toBeDefined();
      expect(wt.branch).toBe('feature/cycle31');
      expect(wt.status).toBe('ready');

      // 4. 查询
      const all = await adapter.list();
      expect(all.length).toBe(1);

      const found = await adapter.get(wt.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(wt.id);
    });

    it('迁移流程 (local -> remote)', async () => {
      const { RemoteWorktreeAdapter } = await import('../utils/remoteWorktreeAdapter');
      const adapter = new RemoteWorktreeAdapter();

      adapter.registerBackend({
        id: 'local',
        name: 'Local',
        enabled: true,
        priority: 1,
        type: 'local',
        basePath: '/tmp',
      });
      adapter.registerBackend({
        id: 'remote',
        name: 'Remote',
        enabled: true,
        priority: 2,
        type: 'remote',
        endpoint: 'https://example.com',
      });

      const wt = await adapter.create({ branch: 'mig-1', baseBranch: 'main', backendId: 'local' });
      const receipt = await adapter.migrateToRemote(wt.id, 'remote');
      expect(receipt.worktreeId).toBe(wt.id);
      expect(receipt.toBackend).toBe('remote');
    });

    it('健康检查', async () => {
      const { RemoteWorktreeAdapter } = await import('../utils/remoteWorktreeAdapter');
      const adapter = new RemoteWorktreeAdapter();

      adapter.registerBackend({
        id: 'local-h',
        name: 'Local Health',
        enabled: true,
        priority: 1,
        type: 'local',
        basePath: '/tmp',
      });

      const status = await adapter.healthCheck('local-h');
      expect(['healthy', 'degraded', 'unhealthy', 'offline']).toContain(status);
    });

    it('事件系统完整', async () => {
      const { RemoteWorktreeAdapter } = await import('../utils/remoteWorktreeAdapter');
      const adapter = new RemoteWorktreeAdapter();

      let backendCount = 0;
      let worktreeCount = 0;
      adapter.on('backend-registered', () => backendCount++);
      adapter.on('worktree-created', () => worktreeCount++);

      adapter.registerBackend({
        id: 'evt-local',
        name: 'Event Local',
        enabled: true,
        priority: 1,
        type: 'local',
        basePath: '/tmp',
      });

      await adapter.create({ branch: 'evt-1', baseBranch: 'main', backendId: 'evt-local' });

      expect(backendCount).toBe(1);
      expect(worktreeCount).toBe(1);
    });

    it('单例 + 重置', async () => {
      const { getDefaultRemoteWorktreeAdapter, resetDefaultRemoteWorktreeAdapter } = await import('../utils/remoteWorktreeAdapter');
      resetDefaultRemoteWorktreeAdapter();
      const a = getDefaultRemoteWorktreeAdapter();
      const b = getDefaultRemoteWorktreeAdapter();
      expect(a).toBe(b);
    });
  });

  describe('G31-03: WorktreeSync 端到端', () => {
    it('快照 + 状态广播 + 订阅 完整流程', async () => {
      const { WorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');
      const engine = new WorktreeSyncEngine();

      // 1. 创建快照
      const snap1 = engine.snapshot('wt-1', {
        branch: 'main',
        commitHash: 'abc123',
      });
      expect(snap1.worktreeId).toBe('wt-1');
      expect(snap1.state.branch).toBe('main');

      // 2. 状态广播 + 订阅
      let received = 0;
      engine.subscribe('wt-1', () => received++);

      engine.publishChange('wt-1', { type: 'file-change', path: 'src/app.ts', payload: { content: 'updated' } });

      expect(received).toBe(1);
    });

    it('冲突检测 + 解决', async () => {
      const { WorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');
      const engine = new WorktreeSyncEngine();

      // 创建设备 A 和 B
      engine.registerDevice({
        deviceId: 'dev-a',
        name: 'Device A',
        type: 'desktop',
        lastSeenAt: Date.now(),
        online: true,
      });
      engine.registerDevice({
        deviceId: 'dev-b',
        name: 'Device B',
        type: 'laptop',
        lastSeenAt: Date.now(),
        online: true,
      });

      // 创建两个并发快照
      engine.setCurrentDevice('dev-a');
      engine.snapshot('wt-c', { branch: 'main', commitHash: 'a' });

      engine.setCurrentDevice('dev-b');
      const snapB = engine.snapshot('wt-c', { branch: 'main', commitHash: 'b' });

      // 检测冲突
      const conflicts = engine.detectConflict('wt-c', snapB);
      expect(conflicts.length).toBeGreaterThan(0);

      // 解决冲突
      const conflict = conflicts[0];
      const resolved = engine.resolveConflict(conflict.id, {
        strategy: 'local',
        resolvedBy: 'dev-a',
      });
      expect(resolved.resolution?.strategy).toBe('local');
    });

    it('跨设备同步会话', async () => {
      const { WorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');
      const engine = new WorktreeSyncEngine();

      // 启动同步会话
      const session = engine.startSync('wt-sync', {
        id: 'ep-1',
        type: 'websocket',
        url: 'wss://sync.example.com/wt-1',
        deviceId: 'dev-test',
        connected: true,
      });
      expect(session.worktreeId).toBe('wt-sync');
      expect(session.status).toBe('active');

      // 列出活跃会话
      const sessions = engine.listSessions('wt-sync');
      expect(sessions.length).toBe(1);

      // 停止会话
      engine.stopSync(session.id);
      expect(session.status).toBe('stopped');
    });

    it('设备管理', async () => {
      const { WorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');
      const engine = new WorktreeSyncEngine();

      const devices = engine.listDevices();
      expect(devices.length).toBeGreaterThan(0);

      // 切换当前设备
      const newId = 'dev-test-1';
      engine.registerDevice({
        deviceId: newId,
        name: 'Test Device',
        type: 'phone',
        lastSeenAt: Date.now(),
        online: true,
      });
      engine.setCurrentDevice(newId);
      expect(engine.getCurrentDeviceId()).toBe(newId);

      // 离线设备
      engine.setDeviceOnline(newId, false);
      const updated = engine.listDevices().find((d) => d.deviceId === newId);
      expect(updated!.online).toBe(false);
    });

    it('事件系统完整', async () => {
      const { WorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');
      const engine = new WorktreeSyncEngine();

      let snapCount = 0;
      let changeCount = 0;
      engine.on('snapshot-created', () => snapCount++);
      engine.on('change-published', () => changeCount++);

      engine.snapshot('wt-evt', { branch: 'main', commitHash: 'a' });
      engine.publishChange('wt-evt', { type: 'commit', payload: { hash: 'b' } });

      expect(snapCount).toBe(1);
      expect(changeCount).toBe(1);
    });

    it('单例 + 重置', async () => {
      const { getDefaultWorktreeSyncEngine, resetDefaultWorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');
      resetDefaultWorktreeSyncEngine();
      const a = getDefaultWorktreeSyncEngine();
      const b = getDefaultWorktreeSyncEngine();
      expect(a).toBe(b);
    });
  });

  describe('UI 组件导入连通性', () => {
    it('CostAttributionPanel 可成功导入', async () => {
      const { CostAttributionPanel } = await import('../components/CostAttributionPanel');
      expect(CostAttributionPanel).toBeDefined();
    });

    it('RemoteWorktreePanel 可成功导入', async () => {
      const { RemoteWorktreePanel } = await import('../components/RemoteWorktreePanel');
      expect(RemoteWorktreePanel).toBeDefined();
    });

    it('WorktreeSyncPanel 可成功导入', async () => {
      const { WorktreeSyncPanel } = await import('../components/WorktreeSyncPanel');
      expect(WorktreeSyncPanel).toBeDefined();
    });
  });

  describe('Cycle 31 三引擎协同', () => {
    it('CostAttribution + RemoteWorktree + WorktreeSync 同时工作', async () => {
      const { getDefaultCostAttributionEngine } = await import('../utils/costAttributionEngine');
      const { RemoteWorktreeAdapter } = await import('../utils/remoteWorktreeAdapter');
      const { WorktreeSyncEngine } = await import('../utils/worktreeSyncEngine');

      // 三引擎独立工作
      const costEngine = getDefaultCostAttributionEngine();
      const wtAdapter = new RemoteWorktreeAdapter();
      const syncEngine = new WorktreeSyncEngine();

      // 1. CostAttribution: 归因一次调用
      costEngine.registerOrg({ orgId: 'cycle31', name: 'Cycle31' });
      costEngine.registerUser({ orgId: 'cycle31', userId: 'dev', name: 'Dev' });
      costEngine.attribute({
        user: { orgId: 'cycle31', userId: 'dev', name: 'Dev' },
        repo: { orgId: 'cycle31', teamId: 't', projectId: 'p', repoId: 'r', name: 'r' },
        project: { orgId: 'cycle31', teamId: 't', projectId: 'p', name: 'p' },
        team: { orgId: 'cycle31', teamId: 't', name: 't' },
        org: { orgId: 'cycle31', name: 'Cycle31' },
        source: 'llm-call',
        model: 'm1',
        inputTokens: 100,
        outputTokens: 50,
        totalCost: 0.5,
        currency: 'USD',
      });

      // 2. RemoteWorktree: 创建 worktree
      wtAdapter.registerBackend({
        id: 'cycle31-local',
        name: 'Cycle31 Local',
        enabled: true,
        priority: 1,
        type: 'local',
        basePath: '/tmp',
      });
      const wt = await wtAdapter.create({
        branch: 'cycle31-feature',
        baseBranch: 'main',
        backendId: 'cycle31-local',
      });

      // 3. WorktreeSync: 为该 worktree 同步
      const snap = syncEngine.snapshot(wt.id, { branch: 'cycle31-feature', commitHash: 'init' });
      expect(snap.id).toBeDefined();

      // 三者独立工作
      expect(costEngine).toBeDefined();
      expect(wtAdapter).toBeDefined();
      expect(syncEngine).toBeDefined();
    });

    it('主应用集成: BrandHeader 可成功导入', async () => {
      const BrandHeaderModule = await import('../components/BrandHeader');
      expect(BrandHeaderModule.default).toBeDefined();
    });
  });
});
