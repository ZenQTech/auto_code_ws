/**
 * # ============================================================
 * # workflowStateMachine 单元测试 (v6.33.0 P0-4)
 * # ============================================================
 * # 核心作用：验证 7 态状态机的转换合法性、UI 配置、终态判定
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  canTransition,
  transition,
  getStatusConfig,
  getAllStatuses,
  isTerminalState,
} from './workflowStateMachine';

describe('workflowStateMachine', () => {
  describe('canTransition', () => {
    it('idle 只能转到 running', () => {
      expect(canTransition('idle', 'running')).toBe(true);
      expect(canTransition('idle', 'paused')).toBe(false);
      expect(canTransition('idle', 'completed')).toBe(false);
      expect(canTransition('idle', 'failed')).toBe(false);
    });

    it('running 可转 5 个状态', () => {
      expect(canTransition('running', 'paused')).toBe(true);
      expect(canTransition('running', 'tool-calling')).toBe(true);
      expect(canTransition('running', 'completed')).toBe(true);
      expect(canTransition('running', 'failed')).toBe(true);
      expect(canTransition('running', 'cancelled')).toBe(true);
      expect(canTransition('running', 'idle')).toBe(false);  // running 不能直接回 idle
    });

    it('paused 可恢复或取消', () => {
      expect(canTransition('paused', 'running')).toBe(true);
      expect(canTransition('paused', 'cancelled')).toBe(true);
      expect(canTransition('paused', 'completed')).toBe(false);
      expect(canTransition('paused', 'failed')).toBe(false);
    });

    it('tool-calling 可完成或失败', () => {
      expect(canTransition('tool-calling', 'running')).toBe(true);
      expect(canTransition('tool-calling', 'failed')).toBe(true);
      expect(canTransition('tool-calling', 'completed')).toBe(false);  // 工具调用后必须回 running 再 completed
      expect(canTransition('tool-calling', 'paused')).toBe(false);
    });

    it('failed/cancelled/completed 只能重置到 idle', () => {
      expect(canTransition('failed', 'idle')).toBe(true);
      expect(canTransition('cancelled', 'idle')).toBe(true);
      expect(canTransition('completed', 'idle')).toBe(true);

      expect(canTransition('failed', 'running')).toBe(false);
      expect(canTransition('cancelled', 'running')).toBe(false);
      expect(canTransition('completed', 'running')).toBe(false);
    });

    it('同状态视为合法（幂等）', () => {
      expect(canTransition('running', 'running')).toBe(true);
      expect(canTransition('paused', 'paused')).toBe(true);
    });
  });

  describe('transition', () => {
    it('合法转换应返回目标状态', () => {
      expect(transition('idle', 'running')).toBe('running');
      expect(transition('running', 'paused')).toBe('paused');
      expect(transition('paused', 'running')).toBe('running');
    });

    it('非法转换应抛错', () => {
      expect(() => transition('idle', 'completed')).toThrowError(/非法/);
      expect(() => transition('running', 'idle')).toThrowError(/非法/);
      expect(() => transition('completed', 'running')).toThrowError(/非法/);
    });
  });

  describe('getStatusConfig', () => {
    it('7 个状态都应有配置', () => {
      const allStatuses = getAllStatuses();
      expect(allStatuses).toHaveLength(7);
      for (const status of allStatuses) {
        const config = getStatusConfig(status);
        expect(config.label).toBeTruthy();
        expect(config.color).toBeTruthy();
        expect(config.icon).toBeTruthy();
      }
    });

    it('idle 应为灰色、非活跃', () => {
      const config = getStatusConfig('idle');
      expect(config.color).toBe('gray');
      expect(config.isActive).toBe(false);
    });

    it('running 应为蓝色、活跃', () => {
      const config = getStatusConfig('running');
      expect(config.color).toBe('blue');
      expect(config.isActive).toBe(true);
    });

    it('failed 应为红色', () => {
      const config = getStatusConfig('failed');
      expect(config.color).toBe('red');
    });

    it('completed 应为绿色', () => {
      const config = getStatusConfig('completed');
      expect(config.color).toBe('green');
    });

    it('色盲友好：每个状态都有图标', () => {
      const icons = getAllStatuses().map((s) => getStatusConfig(s).icon);
      const uniqueIcons = new Set(icons);
      expect(uniqueIcons.size).toBe(7);  // 7 个不同图标
    });
  });

  describe('isTerminalState', () => {
    it('failed/cancelled/completed 为终态', () => {
      expect(isTerminalState('failed')).toBe(true);
      expect(isTerminalState('cancelled')).toBe(true);
      expect(isTerminalState('completed')).toBe(true);
    });

    it('idle/running/paused/tool-calling 非终态', () => {
      expect(isTerminalState('idle')).toBe(false);
      expect(isTerminalState('running')).toBe(false);
      expect(isTerminalState('paused')).toBe(false);
      expect(isTerminalState('tool-calling')).toBe(false);
    });
  });

  describe('getAllStatuses', () => {
    it('应返回 7 个状态，按生命周期顺序', () => {
      const statuses = getAllStatuses();
      expect(statuses).toEqual([
        'idle',
        'running',
        'paused',
        'tool-calling',
        'failed',
        'cancelled',
        'completed',
      ]);
    });
  });
});
