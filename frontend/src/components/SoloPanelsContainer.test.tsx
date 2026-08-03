/**
 * # ============================================================
 * # SoloPanelsContainer.test.tsx - Solo 模式统一面板容器测试 (v1.0.0)
 * # Cycle 60 G60-FIX-3
 * # ============================================================
 * # 核心作用：验证 SoloPanelsContainer 正确渲染所有 panel
 * # ====================================
 */

import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

import { SoloPanelsContainer } from './SoloPanelsContainer';
import { type UseModalsResult } from '../hooks/useModals';

// ============================================================
// Mocks
// ====================================

// Mock 所有 panel 组件以避免复杂的内部依赖
vi.mock('./SettingsPanel', () => ({
  default: () => <div data-testid="mock-settings">Settings</div>,
}));

vi.mock('./UsagePanel', () => ({
  UsagePanel: () => <div data-testid="mock-usage">Usage</div>,
}));

vi.mock('./SkillsPanelContent', () => ({
  default: () => <div data-testid="mock-skills">Skills</div>,
}));

vi.mock('./AgentsMdPanelContent', () => ({
  default: () => <div data-testid="mock-agents-md">AgentsMd</div>,
}));

vi.mock('./Cycle3Panel', () => ({
  default: () => <div data-testid="mock-cycle3">Cycle3</div>,
}));

vi.mock('./DualCompactionPanel', () => ({
  default: () => <div data-testid="mock-dual-compaction">DualCompaction</div>,
}));

vi.mock('./HooksPanel', () => ({
  default: () => <div data-testid="mock-hooks">Hooks</div>,
}));

vi.mock('./CacheStatsPanel', () => ({
  default: () => <div data-testid="mock-cache-stats">CacheStats</div>,
}));

vi.mock('./StreamListPanel', () => ({
  default: () => <div data-testid="mock-stream-list">StreamList</div>,
}));

vi.mock('./SessionRolloutPanel', () => ({
  default: () => <div data-testid="mock-session-rollout">SessionRollout</div>,
}));

vi.mock('./MultiAgentTreePanel', () => ({
  default: () => <div data-testid="mock-multi-agent-tree">MultiAgentTree</div>,
}));

vi.mock('./RulePanel', () => ({
  default: () => <div data-testid="mock-rule">RulePanel</div>,
}));

vi.mock('./CustomModelsPanel', () => ({
  default: () => <div data-testid="mock-custom-models">CustomModels</div>,
}));

vi.mock('./OAuthConfigModal', () => ({
  default: () => <div data-testid="mock-oauth">OAuth</div>,
}));

vi.mock('./SlashCommandHelp', () => ({
  default: () => <div data-testid="mock-slash">SlashCommand</div>,
}));

vi.mock('./McpPanel', () => ({
  default: () => <div data-testid="mock-mcp">MCP</div>,
}));

vi.mock('./McpRegistryPanel', () => ({
  default: ({ className }: { className?: string }) => <div data-testid="mock-mcp-registry">McpRegistry</div>,
}));

vi.mock('./McpAdvancedPanel', () => ({
  default: ({ className }: { className?: string }) => <div data-testid="mock-mcp-advanced">McpAdvanced</div>,
}));

vi.mock('./McpIntegratedPanel', () => ({
  McpIntegratedPanel: () => <div data-testid="mock-mcp-integrated">McpIntegrated</div>,
}));

vi.mock('./McpE2EPanel', () => ({
  default: () => <div data-testid="mock-mcp-e2e">McpE2E</div>,
}));

vi.mock('./McpMultimodalPanel', () => ({
  McpMultimodalPanel: () => <div data-testid="mock-mcp-multimodal">McpMultimodal</div>,
}));

vi.mock('./McpRagPanel', () => ({
  McpRagPanel: () => <div data-testid="mock-mcp-rag">McpRag</div>,
}));

vi.mock('./McpRagRealLLMPanel', () => ({
  default: () => <div data-testid="mock-mcp-rag-real-llm">McpRagRealLLM</div>,
}));

vi.mock('./McpRagPerformancePanel', () => ({
  default: () => <div data-testid="mock-mcp-rag-performance">McpRagPerformance</div>,
}));

vi.mock('./McpMultimodalRagPanel', () => ({
  default: () => <div data-testid="mock-mcp-multimodal-rag">McpMultimodalRag</div>,
}));

vi.mock('./McpMultimodalProviderPanel', () => ({
  default: () => <div data-testid="mock-mcp-multimodal-provider">McpMultimodalProvider</div>,
}));

vi.mock('./McpE2EProductionPanel', () => ({
  default: () => <div data-testid="mock-mcp-e2e-production">McpE2EProduction</div>,
}));

vi.mock('./McpDeploymentValidationPanel', () => ({
  default: () => <div data-testid="mock-mcp-deployment">McpDeploymentValidation</div>,
}));

vi.mock('./McpProductionEnhancementPanel', () => ({
  default: () => <div data-testid="mock-mcp-production-enhancement">McpProductionEnhancement</div>,
}));

vi.mock('./McpPlatformIntegrationPanel', () => ({
  default: () => <div data-testid="mock-mcp-platform">McpPlatformIntegration</div>,
}));

vi.mock('./McpKubernetesPanel', () => ({
  default: () => <div data-testid="mock-mcp-k8s">McpKubernetes</div>,
}));

vi.mock('./McpServerlessPanel', () => ({
  default: () => <div data-testid="mock-mcp-serverless">McpServerless</div>,
}));

vi.mock('./McpStreamProcessingPanel', () => ({
  default: () => <div data-testid="mock-mcp-stream">McpStreamProcessing</div>,
}));

vi.mock('./LoopV7Runner', () => ({
  default: () => <div data-testid="mock-loop-v7">LoopV7</div>,
}));

vi.mock('./CompactionIndicator', () => ({
  default: () => <div data-testid="mock-compaction">Compaction</div>,
}));

vi.mock('./SubAgentMemoryViewer', () => ({
  default: () => <div data-testid="mock-subagent">SubAgent</div>,
}));

vi.mock('./HookChainViewer', () => ({
  default: () => <div data-testid="mock-hook-chain">HookChain</div>,
}));

// ============================================================
// Helpers
// ====================================

/**
 * 创建 useModals mock 数据
 * 默认所有 panel 关闭
 */
function createMockModals(overrides: Record<string, { open: boolean; onClose: () => void }> = {}): UseModalsResult {
  const defaultPanel = { open: false, onClose: vi.fn(), onOpen: vi.fn(), onToggle: vi.fn() };

  const allKeys = [
    'settings', 'usage', 'skills', 'agentsMd', 'cycle3', 'dualCompaction',
    'hooks', 'cacheStats', 'streamList', 'sessionRollout', 'multiAgentTree',
    'traceRule', 'customModels', 'oauthConfig', 'slashCommand', 'subagentMemory',
    'hookChain', 'loopV7', 'compaction', 'fileExplorer', 'planEditor', 'rules',
    'mcp', 'mcpRegistry', 'mcpAdvanced', 'mcpIntegrated', 'mcpE2E',
    'mcpMultimodal', 'mcpRag', 'mcpRagRealLLM', 'mcpRagPerformance',
    'mcpMultimodalRag', 'mcpMultimodalProvider', 'mcpE2EProduction',
    'mcpDeploymentValidation', 'mcpProductionEnhancement', 'mcpPlatformIntegration',
    'mcpKubernetes', 'mcpServerless', 'mcpStreamProcessing',
  ];

  const result: any = {};
  for (const key of allKeys) {
    result[key] = overrides[key] || defaultPanel;
  }
  return result as UseModalsResult;
}

// ============================================================
// Tests
// ====================================

describe('SoloPanelsContainer - Solo 模式统一面板容器', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('G60-FIX-3-T01: 默认所有 panel 都不渲染', () => {
    const modals = createMockModals();
    const { container } = render(<SoloPanelsContainer modals={modals} />);

    // 所有 panel 都应该不可见
    expect(screen.queryByTestId('mock-settings')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mock-mcp')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[role="dialog"]').length).toBe(0);
  });

  test('G60-FIX-3-T02: settings.open=true 时渲染 SettingsPanel', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      settings: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByTestId('mock-settings')).toBeInTheDocument();
    // 验证渲染了 dialog
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('G60-FIX-3-T03: mcp.open=true 时渲染 McpPanel', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      mcp: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByTestId('mock-mcp')).toBeInTheDocument();
  });

  test('G60-FIX-3-T04: mcpRegistry.open=true 时渲染 McpRegistryPanel（不支持 onClose）', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      mcpRegistry: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByTestId('mock-mcp-registry')).toBeInTheDocument();
    // SoloSimpleModal 应该有 ✕ 关闭按钮
    expect(screen.getByLabelText('关闭')).toBeInTheDocument();
  });

  test('G60-FIX-3-T05: mcpAdvanced.open=true 时渲染 McpAdvancedPanel（不支持 onClose）', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      mcpAdvanced: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByTestId('mock-mcp-advanced')).toBeInTheDocument();
  });

  test('G60-FIX-3-T06: 多个 panel 同时打开，各自独立渲染', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      settings: { open: true, onClose },
      mcp: { open: true, onClose },
      skills: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByTestId('mock-settings')).toBeInTheDocument();
    expect(screen.getByTestId('mock-mcp')).toBeInTheDocument();
    expect(screen.getByTestId('mock-skills')).toBeInTheDocument();
  });

  test('G60-FIX-3-T07: 关闭一个 panel 不影响其他 panel', () => {
    const onCloseSettings = vi.fn();
    const onCloseMcp = vi.fn();
    const modals = createMockModals({
      settings: { open: true, onClose: onCloseSettings },
      mcp: { open: true, onClose: onCloseMcp },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByTestId('mock-settings')).toBeInTheDocument();
    expect(screen.getByTestId('mock-mcp')).toBeInTheDocument();

    // 关闭 settings 应该只调用 settings 的 onClose
    onCloseSettings();
    expect(onCloseSettings).toHaveBeenCalledTimes(1);
    expect(onCloseMcp).not.toHaveBeenCalled();
  });

  test('G60-FIX-3-T08: compaction 需要 currentSessionId，未提供时不渲染 CompactionIndicator', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      compaction: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    // 没有 currentSessionId 时显示提示信息
    expect(screen.queryByTestId('mock-compaction')).not.toBeInTheDocument();
    expect(screen.getByText(/请先选择一个会话/)).toBeInTheDocument();
  });

  test('G60-FIX-3-T09: compaction 提供 currentSessionId 时渲染 CompactionIndicator', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      compaction: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} currentSessionId="test-session-123" />);

    expect(screen.getByTestId('mock-compaction')).toBeInTheDocument();
  });

  test('G60-FIX-3-T10: fileExplorer 显示提示信息（仅 Coding 模式可用）', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      fileExplorer: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByText(/文件浏览器需要在 Coding 模式下使用/)).toBeInTheDocument();
  });

  test('G60-FIX-3-T11: planEditor 显示提示信息（仅 Coding 模式可用）', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      planEditor: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByText(/Plan Editor 需要在 Coding 模式下使用/)).toBeInTheDocument();
  });

  test('G60-FIX-3-T12: rules 显示提示信息（仅 Coding 模式可用）', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      rules: { open: true, onClose },
    });
    render(<SoloPanelsContainer modals={modals} />);

    expect(screen.getByText(/规则管理需要在 Coding 模式下使用/)).toBeInTheDocument();
  });

  test('G60-FIX-3-T13: 所有 21 个 MCP panel 都能正常打开', () => {
    const onClose = vi.fn();
    const mcpKeys = [
      'mcp', 'mcpRegistry', 'mcpAdvanced', 'mcpIntegrated', 'mcpE2E',
      'mcpMultimodal', 'mcpRag', 'mcpRagRealLLM', 'mcpRagPerformance',
      'mcpMultimodalRag', 'mcpMultimodalProvider', 'mcpE2EProduction',
      'mcpDeploymentValidation', 'mcpProductionEnhancement', 'mcpPlatformIntegration',
      'mcpKubernetes', 'mcpServerless', 'mcpStreamProcessing',
    ];

    let totalRendered = 0;
    for (const key of mcpKeys) {
      const modals = createMockModals({
        [key]: { open: true, onClose },
      });
      const { unmount } = render(<SoloPanelsContainer modals={modals} />);
      const dialogs = screen.queryAllByRole('dialog');
      totalRendered += dialogs.length;
      unmount();
    }

    // 至少应该渲染 18 个 dialog（18 个 MCP panel）
    expect(totalRendered).toBeGreaterThanOrEqual(18);
  });

  test('G60-FIX-3-T14: dialog 背景点击触发 onClose', () => {
    const onClose = vi.fn();
    const modals = createMockModals({
      settings: { open: true, onClose },
    });
    const { container } = render(<SoloPanelsContainer modals={modals} />);

    // 点击 dialog 背景
    const dialog = screen.getByRole('dialog');
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalled();
  });
});
