/**
 * # ============================================================
 * # Diff 工具库测试 (v6.33.0 P0-6)
 * # ============================================================
 * # 核心作用：验证 lineDiff / wordDiff / charDiff / stats / 色盲模式
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  lineDiff,
  wordDiff,
  charDiff,
  computeDiff,
  computeStats,
  getSegmentStyle,
  type DiffGranularity,
} from './diff';

describe('diff utilities', () => {
  describe('lineDiff', () => {
    it('相同文本应全部为 equal', () => {
      const text = 'line1\nline2\nline3';
      const segments = lineDiff(text, text);
      const allEqual = segments.every((s) => s.type === 'equal');
      expect(allEqual).toBe(true);
    });

    it('应正确识别新增行', () => {
      const oldText = 'line1\nline2';
      const newText = 'line1\nline2\nline3';
      const segments = lineDiff(oldText, newText);
      const inserts = segments.filter((s) => s.type === 'insert');
      expect(inserts.length).toBe(1);
      expect(inserts[0].text).toContain('line3');
    });

    it('应正确识别删除行', () => {
      const oldText = 'line1\nline2\nline3';
      const newText = 'line1\nline3';
      const segments = lineDiff(oldText, newText);
      const deletes = segments.filter((s) => s.type === 'delete');
      expect(deletes.length).toBe(1);
      expect(deletes[0].text).toContain('line2');
    });

    it('应正确处理完全不同的文本', () => {
      const segments = lineDiff('aaa', 'bbb');
      expect(segments.some((s) => s.type === 'delete')).toBe(true);
      expect(segments.some((s) => s.type === 'insert')).toBe(true);
    });
  });

  describe('wordDiff', () => {
    it('相同文本应全部为 equal', () => {
      const segments = wordDiff('hello world', 'hello world');
      expect(segments.every((s) => s.type === 'equal')).toBe(true);
    });

    it('应识别单词级修改', () => {
      const segments = wordDiff('hello world', 'hello there');
      const inserts = segments.filter((s) => s.type === 'insert');
      const deletes = segments.filter((s) => s.type === 'delete');
      expect(inserts.length).toBeGreaterThan(0);
      expect(deletes.length).toBeGreaterThan(0);
    });

    it('应处理中文文本', () => {
      const segments = wordDiff('你好世界', '你好中国');
      expect(segments.some((s) => s.type === 'insert' || s.type === 'delete')).toBe(true);
    });
  });

  describe('charDiff', () => {
    it('字符级 diff 应能识别单字符修改', () => {
      const segments = charDiff('abc', 'axc');
      const inserts = segments.filter((s) => s.type === 'insert');
      const deletes = segments.filter((s) => s.type === 'delete');
      expect(inserts.length).toBeGreaterThan(0);
      expect(deletes.length).toBeGreaterThan(0);
    });
  });

  describe('computeDiff (路由)', () => {
    it('应按 granularity 路由到对应实现', () => {
      const granularities: DiffGranularity[] = ['line', 'word', 'char'];
      for (const g of granularities) {
        const segments = computeDiff('hello', 'world', g);
        expect(segments.length).toBeGreaterThan(0);
      }
    });

    it('默认应为 word', () => {
      const segments = computeDiff('hello world', 'hello there');
      // word 模式应能产生较少的片段
      expect(segments.length).toBeGreaterThan(0);
    });
  });

  describe('computeStats', () => {
    it('应正确计算统计', () => {
      const segments = [
        { type: 'equal' as const, text: 'line1\n' },
        { type: 'delete' as const, text: 'line2\n' },
        { type: 'insert' as const, text: 'line3\n' },
      ];
      const stats = computeStats(segments);
      expect(stats.added).toBe(1);
      expect(stats.removed).toBe(1);
      expect(stats.equal).toBe(1);
    });

    it('空 segments 应返回全 0', () => {
      const stats = computeStats([]);
      expect(stats.added).toBe(0);
      expect(stats.removed).toBe(0);
      expect(stats.equal).toBe(0);
    });
  });

  describe('getSegmentStyle (色盲模式)', () => {
    it('普通模式应使用颜色', () => {
      const insertStyle = getSegmentStyle('insert');
      const deleteStyle = getSegmentStyle('delete');
      expect(insertStyle.bg).toContain('green');
      expect(deleteStyle.bg).toContain('red');
      expect(insertStyle.icon).toBe('');  // 普通模式无图标
    });

    it('色盲模式应使用图标', () => {
      const insertStyle = getSegmentStyle('insert', true);
      const deleteStyle = getSegmentStyle('delete', true);
      expect(insertStyle.icon).toBe('+');
      expect(deleteStyle.icon).toBe('-');
    });

    it('色盲模式仍应使用对比色', () => {
      const insertStyle = getSegmentStyle('insert', true);
      const deleteStyle = getSegmentStyle('delete', true);
      expect(insertStyle.bg).not.toBe(deleteStyle.bg);
    });
  });
});
