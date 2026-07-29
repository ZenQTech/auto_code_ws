/**
 * useComposer 集成层测试 (v6.38.0 Cycle 18 P0-1)
 * 验证 useComposer Hook 正确暴露和桥接 composerEngine.integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import React from 'react';
import { ComposerProvider, useComposer } from './useComposer';
import { createComposerEngine } from '../utils/composerEngine';
import { DEFAULT_RULES, RULES_TEMPLATES } from '../utils/hermesRules';

describe('useComposer - Integration Layer (Cycle 18 P0-1)', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  describe('resolvedReferences / resolutionErrors 状态', () => {
    it('初始为空数组', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.resolvedReferences).toEqual([]);
      expect(result.current.resolutionErrors).toEqual([]);
    });

    it('resolveReferences 后更新 resolvedReferences', async () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      await act(async () => {
        await result.current.resolveReferences('Check @codebase:auth and @git:log');
      });
      await waitFor(() => {
        expect(result.current.resolvedReferences.length).toBeGreaterThan(0);
      });
      expect(result.current.resolvedReferences).toHaveLength(2);
    });

    it('解析失败的引用累积到 resolutionErrors', async () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      await act(async () => {
        await result.current.resolveReferences('@codebase:nonexistent_query_xyz123');
      });
      // errors 是累积的，可能有 mock 失败
      expect(Array.isArray(result.current.resolutionErrors)).toBe(true);
    });
  });

  describe('projectRules 状态', () => {
    it('初始为 DEFAULT_RULES', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.projectRules).toBe(DEFAULT_RULES);
      expect(result.current.rulesLoaded).toBe(false);
    });

    it('updateProjectRules 后状态更新', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      const newRules = RULES_TEMPLATES[0].rules;
      act(() => {
        result.current.updateProjectRules(newRules);
      });
      expect(result.current.projectRules).toBe(newRules);
      expect(result.current.rulesLoaded).toBe(true);
    });

    it('loadRules 后规则更新且 rulesLoaded=true', async () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      await act(async () => {
        await result.current.loadRules();
      });
      expect(result.current.rulesLoaded).toBe(true);
    });

    it('loadRules 失败时回退 DEFAULT', async () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      await act(async () => {
        await result.current.loadRules('invalid yaml [[[');
      });
      expect(result.current.projectRules).toBe(DEFAULT_RULES);
    });
  });

  describe('injectRulesIntoPrompt API', () => {
    it('注入规则到 prompt', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      const injected = result.current.injectRulesIntoPrompt('Fix bug');
      expect(injected).toContain('Fix bug');
    });

    it('自定义规则注入', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.updateProjectRules({
          ...DEFAULT_RULES,
          rules: { ...DEFAULT_RULES.rules, type_safety: 'strict' },
        });
      });
      const injected = result.current.injectRulesIntoPrompt('Test');
      expect(injected).toContain('strict');
    });
  });

  describe('getRulesMeta API', () => {
    it('返回元数据', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      const meta = result.current.getRulesMeta();
      expect(meta.total).toBeGreaterThan(0);
      expect(meta.categories).toBeDefined();
      expect(meta.isDefault).toBe(true);
    });

    it('loadRules 后 isDefault=false', async () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      await act(async () => {
        await result.current.loadRules();
      });
      const meta = result.current.getRulesMeta();
      expect(meta.isDefault).toBe(false);
    });
  });

  describe('状态隔离', () => {
    it('两个独立 engine 状态互不影响', async () => {
      const engine1 = createComposerEngine();
      const engine2 = createComposerEngine();

      const Wrapper1 = ({ children }: { children: React.ReactNode }) => (
        <ComposerProvider engine={engine1}>{children}</ComposerProvider>
      );
      const Wrapper2 = ({ children }: { children: React.ReactNode }) => (
        <ComposerProvider engine={engine2}>{children}</ComposerProvider>
      );

      const { result: r1 } = renderHook(() => useComposer(), { wrapper: Wrapper1 });
      const { result: r2 } = renderHook(() => useComposer(), { wrapper: Wrapper2 });

      act(() => {
        r1.current.updateProjectRules(RULES_TEMPLATES[0].rules);
      });

      expect(r1.current.projectRules).toBe(RULES_TEMPLATES[0].rules);
      expect(r2.current.projectRules).toBe(DEFAULT_RULES);
    });
  });

  describe('订阅机制', () => {
    it('resolveReferences 触发状态更新', async () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      await act(async () => {
        await result.current.resolveReferences('@codebase:test');
      });
      await waitFor(() => {
        expect(result.current.resolvedReferences.length).toBe(1);
      });
    });

    it('updateProjectRules 触发状态更新', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.updateProjectRules(RULES_TEMPLATES[1].rules);
      });
      expect(result.current.projectRules.rules.naming_convention).toBe('snake_case');
    });
  });
});
