/**
 * # ============================================================
 * # useModals Hook 测试
 * # ============================================================
 * # 核心作用：验证 23 个 panel controller 的 open/close/toggle 行为
 * # 运行流程：
 * #   1. 渲染 useModals() 钩子获取所有 panel 控制器
 * #   2. 验证默认状态下 fileExplorer 打开，其他 panel 关闭
 * #   3. 测试 open/close/toggle 方法
 * #   4. 测试多个 panel 独立操作互不影响
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-3 初次创建
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModals } from './useModals';

describe('useModals', () => {
  describe('初始状态', () => {
    it('应该返回 28 个 panel controller + 2 个工具方法', () => {
      const { result } = renderHook(() => useModals());
      const controllers = Object.keys(result.current);
      // 28 panel + closeAll + openMulti = 30
      // (v3.1.0 G39-03 新增 mcpRegistry,
      //  v3.2.0 Cycle 41 新增 mcpAdvanced,
      //  v3.3.0 Cycle 42 G42-04 新增 mcpIntegrated,
      //  v3.4.0 Cycle 43 G43-04 新增 mcpE2E,
      //  v3.5.0 Cycle 44 G44-04 新增 mcpMultimodal)
      expect(controllers).toHaveLength(30);
    });

    it('fileExplorer 默认应打开', () => {
      const { result } = renderHook(() => useModals());
      expect(result.current.fileExplorer.open).toBe(true);
    });

    it('其他 panel 默认应关闭', () => {
      const { result } = renderHook(() => useModals());
      expect(result.current.settings.open).toBe(false);
      expect(result.current.mcp.open).toBe(false);
      expect(result.current.compaction.open).toBe(false);
      expect(result.current.planEditor.open).toBe(false);
    });
  });

  describe('open 方法', () => {
    it('应该打开指定 panel', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onOpen());
      expect(result.current.settings.open).toBe(true);
    });

    it('应该幂等 (重复 open 不报错)', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onOpen());
      act(() => result.current.settings.onOpen());
      expect(result.current.settings.open).toBe(true);
    });
  });

  describe('close 方法', () => {
    it('应该关闭指定 panel', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onOpen());
      act(() => result.current.settings.onClose());
      expect(result.current.settings.open).toBe(false);
    });

    it('应该幂等 (重复 close 不报错)', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onClose());
      act(() => result.current.settings.onClose());
      expect(result.current.settings.open).toBe(false);
    });
  });

  describe('toggle 方法', () => {
    it('应该切换 panel 状态', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onToggle());
      expect(result.current.settings.open).toBe(true);
      act(() => result.current.settings.onToggle());
      expect(result.current.settings.open).toBe(false);
    });
  });

  describe('panel 独立性', () => {
    it('打开 A 不应影响 B', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onOpen());
      expect(result.current.settings.open).toBe(true);
      expect(result.current.mcp.open).toBe(false);
      expect(result.current.planEditor.open).toBe(false);
    });

    it('关闭 A 不应影响 B', () => {
      const { result } = renderHook(() => useModals());
      act(() => result.current.settings.onOpen());
      act(() => result.current.mcp.onOpen());
      act(() => result.current.settings.onClose());
      expect(result.current.settings.open).toBe(false);
      expect(result.current.mcp.open).toBe(true);
    });
  });
});
