/**
 * # ============================================================
 * # Vitest 全局测试 setup
 * # ============================================================
 * # 核心作用：在每个测试文件运行前注册全局扩展和清理逻辑
 * # 运行流程：
 * #   1. 导入 @testing-library/jest-dom 扩展 expect 断言（toBeInTheDocument 等）
 * #   2. 每个测试后自动清理（避免状态污染）
 * # 输入参数：无
 * # 输出结果：扩展的全局测试 API
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-3 初始化
 * # ============================================================
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// ============================================================
// 每个测试后自动清理 DOM，避免状态污染
// ============================================================
afterEach(() => {
  cleanup();
});

// ============================================================
// Mock: window.matchMedia（部分组件会调用）
// ============================================================
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// ============================================================
// Mock: IntersectionObserver（虚拟列表 / 懒加载使用）
// ============================================================
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn();
  root = null;
  rootMargin = '';
  thresholds = [];
}
(globalThis as any).IntersectionObserver = MockIntersectionObserver;

// ============================================================
// Mock: ResizeObserver
// ============================================================
class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
(globalThis as any).ResizeObserver = MockResizeObserver;
