/**
 * useComposer Summary 集成层测试 (v6.38.1 Cycle 18 P0-2)
 * 验证 useComposer Hook 正确暴露和桥接 composerEngine.summary.integration
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { ComposerProvider, useComposer } from './useComposer';
import { createComposerEngine } from '../utils/composerEngine';
import { DEFAULT_SUMMARY_CONFIG } from '../utils/composerEngine.summary';

describe('useComposer - Summary 集成层 (Cycle 18 P0-2)', () => {
  let engine: ReturnType<typeof createComposerEngine>;

  beforeEach(() => {
    engine = createComposerEngine();
  });

  describe('初始状态', () => {
    it('summaryHistory 初始为空', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.summaryHistory).toEqual([]);
    });

    it('summaryConfig 初始为 DEFAULT_SUMMARY_CONFIG', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.summaryConfig).toEqual(DEFAULT_SUMMARY_CONFIG);
    });

    it('appliedSummaryId 初始为 null', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.appliedSummaryId).toBe(null);
    });

    it('tokensUsed 初始为 0', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.tokensUsed).toBe(0);
    });

    it('shouldSummarize 初始为 false', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      expect(result.current.shouldSummarize).toBe(false);
    });
  });

  describe('summarize API', () => {
    it('force=true 生成 summary 并加入 history', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      let summary: any;
      act(() => {
        summary = result.current.summarize({ force: true });
      });
      expect(summary).not.toBeNull();
      expect(summary.id).toBeDefined();
      expect(result.current.summaryHistory.length).toBe(1);
    });

    it('未 force 时 token 不足返回 null', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      let summary: any;
      act(() => {
        summary = result.current.summarize();
      });
      expect(summary).toBeNull();
    });

    it('连续 summarize 累积 history', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.summarize({ force: true });
        result.current.summarize({ force: true });
        result.current.summarize({ force: true });
      });
      expect(result.current.summaryHistory.length).toBe(3);
    });
  });

  describe('applySummary API', () => {
    it('应用 summary 修改 prompt', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.setPrompt('Original prompt');
      });
      let summary: any;
      act(() => {
        summary = result.current.summarize({ force: true });
      });
      let success: boolean = false;
      act(() => {
        success = result.current.applySummary(summary.id);
      });
      expect(success).toBe(true);
      expect(result.current.appliedSummaryId).toBe(summary.id);
      expect(result.current.session.prompt).toContain('Original prompt');
      expect(result.current.session.prompt).toContain('Conversation Context Summary');
    });

    it('应用不存在的 ID 返回 false', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      let success: boolean = false;
      act(() => {
        success = result.current.applySummary('invalid_id');
      });
      expect(success).toBe(false);
    });
  });

  describe('unapplySummary API', () => {
    it('撤销应用恢复原始 prompt', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.setPrompt('Original');
      });
      let summary: any;
      act(() => {
        summary = result.current.summarize({ force: true });
      });
      act(() => {
        result.current.applySummary(summary.id);
      });
      let success: boolean = false;
      act(() => {
        success = result.current.unapplySummary();
      });
      expect(success).toBe(true);
      expect(result.current.appliedSummaryId).toBe(null);
      expect(result.current.session.prompt).toBe('Original');
    });

    it('无应用时返回 false', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      let success: boolean = false;
      act(() => {
        success = result.current.unapplySummary();
      });
      expect(success).toBe(false);
    });
  });

  describe('deleteSummary / clearSummaryHistory API', () => {
    it('deleteSummary 删除指定 summary', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      let s1: any, s2: any;
      act(() => {
        s1 = result.current.summarize({ force: true });
        s2 = result.current.summarize({ force: true });
      });
      act(() => {
        result.current.deleteSummary(s1.id);
      });
      expect(result.current.summaryHistory.length).toBe(1);
      expect(result.current.summaryHistory[0].id).toBe(s2.id);
    });

    it('deleteSummary 删除当前应用的 summary 自动撤销应用', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.setPrompt('Original');
      });
      let summary: any;
      act(() => {
        summary = result.current.summarize({ force: true });
        result.current.applySummary(summary.id);
      });
      expect(result.current.appliedSummaryId).toBe(summary.id);
      act(() => {
        result.current.deleteSummary(summary.id);
      });
      expect(result.current.appliedSummaryId).toBe(null);
      expect(result.current.session.prompt).toBe('Original');
    });

    it('clearSummaryHistory 清空所有', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.summarize({ force: true });
        result.current.summarize({ force: true });
      });
      act(() => {
        result.current.clearSummaryHistory();
      });
      expect(result.current.summaryHistory).toEqual([]);
    });
  });

  describe('updateSummaryConfig API', () => {
    it('更新 triggerThreshold', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.updateSummaryConfig({ triggerThreshold: 5000 });
      });
      expect(result.current.summaryConfig.triggerThreshold).toBe(5000);
    });

    it('更新 strategy', () => {
      const { result } = renderHook(() => useComposer(), {
        wrapper: ({ children }) => (
          <ComposerProvider engine={engine}>{children}</ComposerProvider>
        ),
      });
      act(() => {
        result.current.updateSummaryConfig({ strategy: 'aggressive' });
      });
      expect(result.current.summaryConfig.strategy).toBe('aggressive');
    });
  });

  describe('状态隔离', () => {
    it('两个独立 engine 状态互不影响', () => {
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
        r1.current.summarize({ force: true });
      });
      expect(r1.current.summaryHistory.length).toBe(1);
      expect(r2.current.summaryHistory.length).toBe(0);
    });
  });
});
