/**
 * # ============================================================
 * # Remote Control Engine 单元测试 (v1.0.0 Cycle 27 G27-06)
 * # ============================================================
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  RemoteControlEngine,
  getDefaultRemoteControlEngine,
  resetDefaultRemoteControlEngine,
} from './remoteControlEngine';
import {
  generateDeviceId,
  generateFingerprint,
  generatePairingId,
  generateShortCode,
  generateToken,
} from './remoteControlTypes';

describe('RemoteControlEngine', () => {
  let engine: RemoteControlEngine;

  beforeEach(() => {
    engine = new RemoteControlEngine({ persist: false, latencyMinMs: 1, latencyMaxMs: 5 });
  });

  describe('工具函数', () => {
    it('generateShortCode 长度正确', () => {
      const code = generateShortCode(6);
      expect(code.length).toBe(6);
    });

    it('generateShortCode 仅含合法字符', () => {
      for (let i = 0; i < 50; i++) {
        const code = generateShortCode(6);
        expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
      }
    });

    it('generateShortCode 自定义长度', () => {
      expect(generateShortCode(8).length).toBe(8);
      expect(generateShortCode(4).length).toBe(4);
    });

    it('generateToken 唯一', () => {
      const a = generateToken();
      const b = generateToken();
      expect(a).not.toBe(b);
      expect(a.startsWith('tok-')).toBe(true);
    });

    it('generateFingerprint 格式正确', () => {
      const fp = generateFingerprint();
      // 形如 XX:XX:XX:XX 长度 4*3 = 12
      expect(fp.length).toBeGreaterThan(0);
      expect(fp).toMatch(/^[0-9A-F:]+$/);
    });

    it('generatePairingId 唯一', () => {
      const a = generatePairingId();
      const b = generatePairingId();
      expect(a).not.toBe(b);
      expect(a.startsWith('pair-')).toBe(true);
    });

    it('generateDeviceId 唯一', () => {
      const a = generateDeviceId();
      const b = generateDeviceId();
      expect(a).not.toBe(b);
      expect(a.startsWith('dev-')).toBe(true);
    });
  });

  describe('配对流程', () => {
    it('启动配对', () => {
      const session = engine.startPairing();
      expect(session.id).toBeTruthy();
      expect(session.shortCode.length).toBe(6);
      expect(session.status).toBe('pending');
      expect(session.expiresAt).toBeGreaterThan(session.createdAt);
    });

    it('配对生成 QR payload', () => {
      const session = engine.startPairing();
      expect(session.qrPayload).toContain(session.shortCode);
      expect(session.pairingUrl).toContain(session.shortCode);
    });

    it('关联 threadId', () => {
      const session = engine.startPairing({ threadId: 't-123' });
      expect(session.threadId).toBe('t-123');
    });

    it('完成配对', async () => {
      const session = engine.startPairing();
      const device = await engine.completePairing(session.id, {
        name: 'iPhone 15',
        type: 'mobile',
        platform: 'ios',
      });
      expect(device.name).toBe('iPhone 15');
      expect(device.platform).toBe('ios');
      expect(device.status).toBe('paired');
      expect(device.token).toBeTruthy();
    });

    it('完成不存在的配对抛错', async () => {
      await expect(
        engine.completePairing('not-exist', { name: 'X', type: 'mobile', platform: 'ios' })
      ).rejects.toThrow();
    });

    it('重复完成配对抛错', async () => {
      const session = engine.startPairing();
      await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      await expect(
        engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' })
      ).rejects.toThrow();
    });

    it('取消配对', () => {
      const session = engine.startPairing();
      engine.cancelPairing(session.id);
      expect(engine.getPairing(session.id)?.status).toBe('cancelled');
    });

    it('不能取消已配对的会话', async () => {
      const session = engine.startPairing();
      await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      engine.cancelPairing(session.id);
      // status 仍是 paired
      expect(engine.getPairing(session.id)?.status).toBe('paired');
    });

    it('标记扫描', () => {
      const session = engine.startPairing();
      engine.markScanned(session.id);
      expect(engine.getPairing(session.id)?.status).toBe('scanned');
    });

    it('过期配对不能完成', async () => {
      const session = engine.startPairing();
      // 手动设置过期
      const s = engine.getPairing(session.id);
      if (s) s.expiresAt = Date.now() - 1000;
      await expect(
        engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' })
      ).rejects.toThrow();
    });

    it('超出 maxDevices 抛错', async () => {
      const e = new RemoteControlEngine({ persist: false, maxDevices: 1, latencyMinMs: 1, latencyMaxMs: 2 });
      const s1 = e.startPairing();
      await e.completePairing(s1.id, { name: 'A', type: 'mobile', platform: 'ios' });
      const s2 = e.startPairing();
      await expect(
        e.completePairing(s2.id, { name: 'B', type: 'mobile', platform: 'ios' })
      ).rejects.toThrow();
    });

    it('列出配对会话', () => {
      engine.startPairing();
      engine.startPairing();
      const all = engine.listPairings();
      expect(all.length).toBe(2);
      const pending = engine.listPairings({ status: 'pending' });
      expect(pending.length).toBe(2);
    });
  });

  describe('设备管理', () => {
    let deviceId: string;

    beforeEach(async () => {
      const session = engine.startPairing();
      const d = await engine.completePairing(session.id, { name: 'Test', type: 'mobile', platform: 'ios' });
      deviceId = d.id;
    });

    it('列出设备', () => {
      const list = engine.listDevices();
      expect(list.length).toBe(1);
    });

    it('按状态过滤', () => {
      const list = engine.listDevices({ status: 'paired' });
      expect(list.length).toBe(1);
    });

    it('获取设备', () => {
      const d = engine.getDevice(deviceId);
      expect(d?.name).toBe('Test');
    });

    it('更新设备权限', () => {
      const d = engine.updateDevicePermissions(deviceId, ['view-thread', 'approve-command']);
      expect(d.permissions).toContain('approve-command');
    });

    it('撤销设备', () => {
      const ok = engine.revokeDevice(deviceId);
      expect(ok).toBe(true);
      expect(engine.getDevice(deviceId)?.status).toBe('revoked');
    });

    it('撤销不存在的设备返回 false', () => {
      expect(engine.revokeDevice('not-exist')).toBe(false);
    });
  });

  describe('设备连接', () => {
    let deviceId: string;

    beforeEach(async () => {
      const session = engine.startPairing();
      const d = await engine.completePairing(session.id, { name: 'Test', type: 'mobile', platform: 'ios' });
      deviceId = d.id;
    });

    it('模拟连接', async () => {
      const conn = await engine.simulateConnect(deviceId);
      expect(conn.status).toBe('open');
      expect(conn.deviceId).toBe(deviceId);
      expect(engine.getDevice(deviceId)?.status).toBe('connected');
    });

    it('模拟断开', async () => {
      await engine.simulateConnect(deviceId);
      await engine.simulateDisconnect(deviceId);
      expect(engine.getDevice(deviceId)?.status).toBe('disconnected');
    });

    it('撤销后不能连接', async () => {
      engine.revokeDevice(deviceId);
      await expect(engine.simulateConnect(deviceId)).rejects.toThrow();
    });

    it('连接不存在的设备抛错', async () => {
      await expect(engine.simulateConnect('not-exist')).rejects.toThrow();
    });
  });

  describe('Thread 迁移', () => {
    let fromId: string;
    let toId: string;

    beforeEach(async () => {
      const s1 = engine.startPairing();
      const d1 = await engine.completePairing(s1.id, { name: 'Laptop', type: 'desktop', platform: 'macos' });
      const s2 = engine.startPairing();
      const d2 = await engine.completePairing(s2.id, { name: 'Phone', type: 'mobile', platform: 'ios' });
      fromId = d1.id;
      toId = d2.id;
    });

    it('启动迁移', () => {
      const h = engine.startHandoff({
        fromDeviceId: fromId,
        toDeviceId: toId,
        threadId: 't-1',
        threadName: 'Code Review',
        messageCount: 42,
        sizeBytes: 102400,
      });
      expect(h.status).toBe('pending');
    });

    it('执行迁移', async () => {
      const h = engine.startHandoff({
        fromDeviceId: fromId,
        threadId: 't-1',
        threadName: 'X',
        messageCount: 10,
        sizeBytes: 1024,
      });
      const ok = await engine.executeHandoff(h.id);
      expect(ok).toBe(true);
      const after = engine.listHandoffs().find((x) => x.id === h.id);
      expect(after?.status).toBe('completed');
    });

    it('迁移不存在的 thread 抛错', () => {
      expect(() =>
        engine.startHandoff({
          fromDeviceId: 'not-exist',
          threadId: 't',
          threadName: 'X',
          messageCount: 0,
          sizeBytes: 0,
        })
      ).toThrow();
    });

    it('目标设备不存在抛错', () => {
      expect(() =>
        engine.startHandoff({
          fromDeviceId: fromId,
          toDeviceId: 'not-exist',
          threadId: 't',
          threadName: 'X',
          messageCount: 0,
          sizeBytes: 0,
        })
      ).toThrow();
    });

    it('重复执行返回 false', async () => {
      const h = engine.startHandoff({
        fromDeviceId: fromId,
        threadId: 't',
        threadName: 'X',
        messageCount: 0,
        sizeBytes: 0,
      });
      await engine.executeHandoff(h.id);
      const ok = await engine.executeHandoff(h.id);
      expect(ok).toBe(false);
    });

    it('模拟失败', async () => {
      const e = new RemoteControlEngine({ persist: false, mockFailureRate: 1, latencyMinMs: 1, latencyMaxMs: 1 });
      const s = e.startPairing();
      const d = await e.completePairing(s.id, { name: 'X', type: 'mobile', platform: 'ios' });
      const h = e.startHandoff({
        fromDeviceId: d.id,
        threadId: 't',
        threadName: 'X',
        messageCount: 0,
        sizeBytes: 0,
      });
      const ok = await e.executeHandoff(h.id);
      expect(ok).toBe(false);
    });

    it('列出迁移', async () => {
      engine.startHandoff({ fromDeviceId: fromId, threadId: 't-1', threadName: 'X', messageCount: 0, sizeBytes: 0 });
      engine.startHandoff({ fromDeviceId: fromId, threadId: 't-2', threadName: 'Y', messageCount: 0, sizeBytes: 0 });
      const list = engine.listHandoffs();
      expect(list.length).toBe(2);
    });
  });

  describe('远程命令', () => {
    let deviceId: string;
    let deviceWithApproveId: string;

    beforeEach(async () => {
      const s1 = engine.startPairing();
      const d1 = await engine.completePairing(s1.id, { name: 'Phone', type: 'mobile', platform: 'ios' });
      deviceId = d1.id;
      // 第二个设备，赋予 approve 权限
      const s2 = engine.startPairing();
      const d2 = await engine.completePairing(s2.id, { name: 'Tablet', type: 'tablet', platform: 'android' });
      deviceWithApproveId = engine.updateDevicePermissions(d2.id, ['view-thread', 'send-message', 'approve-command']).id;
    });

    it('接收命令', () => {
      const cmd = engine.receiveCommand({
        deviceId,
        type: 'pause-thread',
        payload: { threadId: 't-1' },
      });
      expect(cmd.status).toBe('pending');
    });

    it('无权限设备发送审批命令抛错', () => {
      expect(() =>
        engine.receiveCommand({
          deviceId,
          type: 'approve-action',
          payload: {},
        })
      ).toThrow();
    });

    it('有权限设备发送审批命令成功', () => {
      const cmd = engine.receiveCommand({
        deviceId: deviceWithApproveId,
        type: 'approve-action',
        payload: { actionId: 'a-1' },
      });
      expect(cmd.status).toBe('pending');
    });

    it('确认命令', () => {
      const cmd = engine.receiveCommand({
        deviceId,
        type: 'request-status',
        payload: {},
      });
      const ok = engine.acknowledgeCommand(cmd.id);
      expect(ok).toBe(true);
    });

    it('完成命令', () => {
      const cmd = engine.receiveCommand({
        deviceId,
        type: 'request-status',
        payload: {},
      });
      const ok = engine.completeCommand(cmd.id, true);
      expect(ok).toBe(true);
    });

    it('标记命令失败', () => {
      const cmd = engine.receiveCommand({
        deviceId,
        type: 'request-status',
        payload: {},
      });
      engine.completeCommand(cmd.id, false);
      const after = engine.listCommands().find((c) => c.id === cmd.id);
      expect(after?.status).toBe('failed');
    });

    it('确认不存在的命令返回 false', () => {
      expect(engine.acknowledgeCommand('not-exist')).toBe(false);
    });

    it('列出命令', () => {
      engine.receiveCommand({ deviceId, type: 'pause-thread', payload: {} });
      engine.receiveCommand({ deviceId, type: 'resume-thread', payload: {} });
      expect(engine.listCommands().length).toBe(2);
      expect(engine.listCommands({ deviceId }).length).toBe(2);
    });
  });

  describe('事件系统', () => {
    it('订阅 pairing-started', () => {
      let called = false;
      engine.on('pairing-started', () => {
        called = true;
      });
      engine.startPairing();
      expect(called).toBe(true);
    });

    it('订阅 pairing-completed', async () => {
      let called = false;
      engine.on('pairing-completed', () => {
        called = true;
      });
      const session = engine.startPairing();
      await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      expect(called).toBe(true);
    });

    it('订阅 device-paired', async () => {
      let called = false;
      engine.on('device-paired', () => {
        called = true;
      });
      const session = engine.startPairing();
      await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      expect(called).toBe(true);
    });

    it('订阅 device-revoked', async () => {
      let called = false;
      engine.on('device-revoked', () => {
        called = true;
      });
      const session = engine.startPairing();
      const device = await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      engine.revokeDevice(device.id);
      expect(called).toBe(true);
    });

    it('订阅 connection-opened', async () => {
      let called = false;
      engine.on('connection-opened', () => {
        called = true;
      });
      const session = engine.startPairing();
      const d = await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      await engine.simulateConnect(d.id);
      expect(called).toBe(true);
    });

    it('订阅 handoff-completed', async () => {
      let called = false;
      engine.on('handoff-completed', () => {
        called = true;
      });
      const session = engine.startPairing();
      const d = await engine.completePairing(session.id, { name: 'X', type: 'mobile', platform: 'ios' });
      const h = engine.startHandoff({
        fromDeviceId: d.id,
        threadId: 't',
        threadName: 'X',
        messageCount: 0,
        sizeBytes: 0,
      });
      await engine.executeHandoff(h.id);
      expect(called).toBe(true);
    });

    it('订阅 command-received', async () => {
      let called = false;
      engine.on('command-received', () => {
        called = true;
      });
      const s = engine.startPairing();
      const d = await engine.completePairing(s.id, { name: 'X', type: 'mobile', platform: 'ios' });
      engine.receiveCommand({ deviceId: d.id, type: 'request-status', payload: {} });
      expect(called).toBe(true);
    });

    it('订阅 command-acknowledged', async () => {
      let called = false;
      engine.on('command-acknowledged', () => {
        called = true;
      });
      const s = engine.startPairing();
      const d = await engine.completePairing(s.id, { name: 'X', type: 'mobile', platform: 'ios' });
      const cmd = engine.receiveCommand({ deviceId: d.id, type: 'request-status', payload: {} });
      engine.acknowledgeCommand(cmd.id);
      expect(called).toBe(true);
    });

    it('off 取消订阅', () => {
      const handler = () => {
        throw new Error('should not be called');
      };
      engine.on('pairing-started', handler);
      engine.off('pairing-started', handler);
      engine.startPairing();
    });
  });

  describe('统计与清空', () => {
    it('统计正确', async () => {
      engine.startPairing();
      const s = engine.startPairing();
      await engine.completePairing(s.id, { name: 'X', type: 'mobile', platform: 'ios' });
      const stats = engine.getStats();
      expect(stats.pendingPairings).toBe(1);
      expect(stats.totalDevices).toBe(1);
      expect(stats.activeDevices).toBe(1);
    });

    it('清空保留设备', () => {
      engine.clear();
      expect(engine.listPairings().length).toBe(0);
      expect(engine.listHandoffs().length).toBe(0);
    });
  });

  describe('mock 模式', () => {
    it('setMockMode', () => {
      engine.setMockMode(false);
      // 后续的 connect 不会 mock
    });
  });

  describe('单例', () => {
    it('getDefaultRemoteControlEngine 返回同一实例', () => {
      resetDefaultRemoteControlEngine();
      const e1 = getDefaultRemoteControlEngine();
      const e2 = getDefaultRemoteControlEngine();
      expect(e1).toBe(e2);
    });
  });
});
