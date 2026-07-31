/**
 * # McpRagPerformancePanel 单元测试 (v1.0.0 Cycle 47 G47-INTEGRATION)
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McpRagPerformancePanel } from './McpRagPerformancePanel';

describe('McpRagPerformancePanel - 基础渲染', () => {
  it('应能渲染主面板', () => {
    render(<McpRagPerformancePanel onClose={() => {}} />);
    expect(screen.getByText(/MCP × RAG 性能优化/)).toBeDefined();
  });

  it('应显示 5 个 Tab 标签', () => {
    render(<McpRagPerformancePanel onClose={() => {}} />);
    expect(screen.getByText(/向量检索/)).toBeDefined();
    expect(screen.getByText(/智能缓存/)).toBeDefined();
    expect(screen.getByText(/性能监控/)).toBeDefined();
    expect(screen.getByText(/性能基准/)).toBeDefined();
    expect(screen.getByText(/系统设置/)).toBeDefined();
  });

  it('应显示关闭按钮', () => {
    render(<McpRagPerformancePanel onClose={() => {}} />);
    expect(screen.getByText(/关闭/)).toBeDefined();
  });

  it('应默认显示向量检索 Tab', () => {
    render(<McpRagPerformancePanel onClose={() => {}} />);
    expect(screen.getByText(/维度/)).toBeDefined();
    expect(screen.getByText(/语料大小/)).toBeDefined();
  });

  it('应显示面板副标题', () => {
    render(<McpRagPerformancePanel onClose={() => {}} />);
    expect(screen.getByText(/FAISS-WASM/)).toBeDefined();
  });
});
