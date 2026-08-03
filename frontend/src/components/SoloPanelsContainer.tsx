/**
 * # ============================================================
 * SoloPanelsContainer - Solo 模式统一面板渲染容器 (v1.2.0)
 * Cycle 60 G60-FIX-3 增强：让 Solo 模式支持所有 panel
 * # ============================================================
 * 核心作用：在 Solo 模式下也支持打开/关闭所有 panel
 * 运行流程：
 *   1. 接收 modals 控制器（useModals 返回）
 *   2. 根据 modal.open 状态渲染对应的 panel 组件
 *   3. panel 内部 onClose 关闭 modal
 *   4. 渲染到 fixed 定位的 overlay 中
 * 设计要点：
 *   - 与 App.tsx 共用相同的 modals 状态 hook
 *   - 每个 panel 独立渲染，互不影响
 *   - 仅渲染 props 兼容的 panel（部分 panel 仅在 main App 中可用）
 * 输入参数：{ modals: UseModalsResult, currentSessionId?, currentPlanId?,
 *              loopState?, loopHistory?, usageStats? }
 * 输出结果：Solo 模式下所有 panel 的渲染入口
 * 当前覆盖：通用 15 + MCP 19 + Solo 特有 3 = 40 个 panel
 *           (vibeCoding 面板由 /solo 路由直接渲染，无需在容器中重复)
 * ====================================
 * 修改记录：
 *   - 2026-08-03 | v1.0.0 | Cycle 60 G60-FIX-3 初次创建
 *   - 2026-08-03 | v1.0.1 | 修复 props 兼容性（McpAdvancedPanel/McpRegistryPanel 不接受 onClose）
 *   - 2026-08-03 | v1.1.0 | G60-FIX-4 新增 planExecutor/loopState/autoFollow 3 个 Solo 特有 panel
 *   - 2026-08-03 | v1.2.0 | G60-FIX-5 补齐 mcpObservability 面板（之前遗漏）
 * ====================================
 */

import React from 'react';

import { type UseModalsResult } from '../hooks/useModals';

// ============================================================
// Panel 组件导入（v1.0.1 修复 props 兼容性）
// ============================================================

// 通用面板
import SettingsPanel from './SettingsPanel';
import { UsagePanel, type UsageStats } from './UsagePanel';
import SkillsPanelContent from './SkillsPanelContent';
import AgentsMdPanelContent from './AgentsMdPanelContent';
import Cycle3Panel from './Cycle3Panel';
import DualCompactionPanel from './DualCompactionPanel';
import HooksPanel from './HooksPanel';
import CacheStatsPanel from './CacheStatsPanel';
import StreamListPanel from './StreamListPanel';
import SessionRolloutPanel from './SessionRolloutPanel';
import MultiAgentTreePanel from './MultiAgentTreePanel';
import RulePanel from './RulePanel';
import CustomModelsPanel from './CustomModelsPanel';
import OAuthConfigModal from './OAuthConfigModal';
import SlashCommandHelp from './SlashCommandHelp';

// MCP 核心
import McpPanel from './McpPanel';
import McpRegistryPanel from './McpRegistryPanel';
import McpAdvancedPanel from './McpAdvancedPanel';
import { McpIntegratedPanel } from './McpIntegratedPanel';
import McpE2EPanel from './McpE2EPanel';
import { McpMultimodalPanel } from './McpMultimodalPanel';
import { McpRagPanel } from './McpRagPanel';
import McpRagRealLLMPanel from './McpRagRealLLMPanel';
import McpRagPerformancePanel from './McpRagPerformancePanel';
import McpMultimodalRagPanel from './McpMultimodalRagPanel';
import McpMultimodalProviderPanel from './McpMultimodalProviderPanel';
import McpE2EProductionPanel from './McpE2EProductionPanel';
import McpDeploymentValidationPanel from './McpDeploymentValidationPanel';
import McpProductionEnhancementPanel from './McpProductionEnhancementPanel';
import McpPlatformIntegrationPanel from './McpPlatformIntegrationPanel';
import McpKubernetesPanel from './McpKubernetesPanel';
import McpServerlessPanel from './McpServerlessPanel';
import McpStreamProcessingPanel from './McpStreamProcessingPanel';
import McpObservabilityPanel from './McpObservabilityPanel';

// 其他面板
import LoopV7Runner from './LoopV7Runner';
import CompactionIndicator from './CompactionIndicator';
import SubAgentMemoryViewer from './SubAgentMemoryViewer';
import HookChainViewer from './HookChainViewer';

// Solo 模式特有 panel（v1.1.0 G60-FIX-3 增强：让所有 panel 都能在 Solo 模式下打开）
// 注意：AutoFollowController 是无 UI 纯逻辑组件，由 VibeSoloShell 直接挂载，
//       不在此处重复渲染。
import PlanExecutorPanel from './PlanExecutorPanel';
import LoopStateMachineView from './LoopStateMachineView';

// ============================================================
// 类型
// ============================================================

import { type LoopState, type LoopTransition } from '../hooks/useLoopState';

export interface SoloPanelsContainerProps {
  modals: UseModalsResult;
  /** 当前 session id（用于 compaction 等需要 session 的 panel） */
  currentSessionId?: string | null;
  /** 当前 plan id（用于 planExecutor panel） */
  currentPlanId?: string | null;
  /** Loop 状态机当前 state（用于 loopState panel） */
  loopState?: LoopState | null;
  /** Loop 状态机历史（用于 loopState panel） */
  loopHistory?: LoopTransition[];
  /** Usage 统计（用于 usage panel） */
  usageStats?: UsageStats | null;
}

// ============================================================
// 通用 Modal 包装器
// ============================================================

const SoloModal: React.FC<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}> = ({ open, onClose, children, maxWidth = 'max-w-4xl' }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-lift-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`w-full ${maxWidth} max-h-[90vh] overflow-auto bg-white dark:bg-surface-900 rounded-2xl shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

// 不带 onClose 的 panel 包装器
const SoloSimpleModal: React.FC<{
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}> = ({ open, onClose, children, maxWidth = 'max-w-4xl' }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`relative w-full ${maxWidth} max-h-[90vh] overflow-auto bg-white dark:bg-surface-900 rounded-2xl shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-white/90 hover:bg-white shadow-lg flex items-center justify-center"
          aria-label="关闭"
        >
          ✕
        </button>
        {children}
      </div>
    </div>
  );
};

// ============================================================
// 组件
// ============================================================

export const SoloPanelsContainer: React.FC<SoloPanelsContainerProps> = ({
  modals,
  currentSessionId,
  currentPlanId,
  loopState,
  loopHistory,
  usageStats,
}) => {
  return (
    <>
      {/* ============================================================ */}
      {/* 通用面板 */}
      {/* ============================================================ */}

      <SoloModal open={modals.settings.open} onClose={modals.settings.onClose} maxWidth="max-w-5xl">
        <SettingsPanel onClose={modals.settings.onClose} showToast={() => {}} />
      </SoloModal>

      <SoloModal open={modals.usage.open} onClose={modals.usage.onClose} maxWidth="max-w-3xl">
        <UsagePanel stats={usageStats ?? null} onClose={modals.usage.onClose} />
      </SoloModal>

      <SoloModal open={modals.skills.open} onClose={modals.skills.onClose} maxWidth="max-w-4xl">
        <SkillsPanelContent onClose={modals.skills.onClose} />
      </SoloModal>

      <SoloModal open={modals.agentsMd.open} onClose={modals.agentsMd.onClose} maxWidth="max-w-5xl">
        <AgentsMdPanelContent />
      </SoloModal>

      <SoloModal open={modals.cycle3.open} onClose={modals.cycle3.onClose} maxWidth="max-w-5xl">
        <Cycle3Panel onClose={modals.cycle3.onClose} />
      </SoloModal>

      <SoloModal open={modals.dualCompaction.open} onClose={modals.dualCompaction.onClose} maxWidth="max-w-4xl">
        <DualCompactionPanel onClose={modals.dualCompaction.onClose} />
      </SoloModal>

      <SoloModal open={modals.hooks.open} onClose={modals.hooks.onClose} maxWidth="max-w-5xl">
        <HooksPanel onClose={modals.hooks.onClose} />
      </SoloModal>

      <SoloModal open={modals.cacheStats.open} onClose={modals.cacheStats.onClose} maxWidth="max-w-4xl">
        <CacheStatsPanel onClose={modals.cacheStats.onClose} />
      </SoloModal>

      <SoloModal open={modals.streamList.open} onClose={modals.streamList.onClose} maxWidth="max-w-6xl">
        <StreamListPanel onClose={modals.streamList.onClose} />
      </SoloModal>

      <SoloModal open={modals.sessionRollout.open} onClose={modals.sessionRollout.onClose} maxWidth="max-w-5xl">
        <SessionRolloutPanel onClose={modals.sessionRollout.onClose} />
      </SoloModal>

      <SoloModal open={modals.multiAgentTree.open} onClose={modals.multiAgentTree.onClose} maxWidth="max-w-5xl">
        <MultiAgentTreePanel onClose={modals.multiAgentTree.onClose} />
      </SoloModal>

      <SoloModal open={modals.traceRule.open} onClose={modals.traceRule.onClose} maxWidth="max-w-5xl">
        <RulePanel onClose={modals.traceRule.onClose} />
      </SoloModal>

      <SoloModal open={modals.customModels.open} onClose={modals.customModels.onClose} maxWidth="max-w-4xl">
        <CustomModelsPanel onClose={modals.customModels.onClose} />
      </SoloModal>

      <SoloModal open={modals.oauthConfig.open} onClose={modals.oauthConfig.onClose} maxWidth="max-w-3xl">
        <OAuthConfigModal onClose={modals.oauthConfig.onClose} />
      </SoloModal>

      <SoloModal open={modals.slashCommand.open} onClose={modals.slashCommand.onClose} maxWidth="max-w-4xl">
        <SlashCommandHelp onClose={modals.slashCommand.onClose} />
      </SoloModal>

      <SoloModal open={modals.subagentMemory.open} onClose={modals.subagentMemory.onClose} maxWidth="max-w-5xl">
        <SubAgentMemoryViewer onClose={modals.subagentMemory.onClose} />
      </SoloModal>

      <SoloModal open={modals.hookChain.open} onClose={modals.hookChain.onClose} maxWidth="max-w-5xl">
        <HookChainViewer onClose={modals.hookChain.onClose} />
      </SoloModal>

      <SoloModal open={modals.loopV7.open} onClose={modals.loopV7.onClose} maxWidth="max-w-6xl">
        <LoopV7Runner onClose={modals.loopV7.onClose} />
      </SoloModal>

      <SoloModal open={modals.compaction.open} onClose={modals.compaction.onClose} maxWidth="max-w-md">
        {currentSessionId ? (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span>🗜️</span>
                <span>会话压缩</span>
              </h2>
              <button
                onClick={modals.compaction.onClose}
                className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <CompactionIndicator sessionId={currentSessionId} onCompacted={() => {}} />
          </div>
        ) : (
          <div className="p-6 text-sm text-surface-500 text-center">
            请先选择一个会话以查看压缩状态
          </div>
        )}
      </SoloModal>

      <SoloModal open={modals.fileExplorer.open} onClose={modals.fileExplorer.onClose} maxWidth="max-w-5xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>📁</span>
              <span>文件浏览器</span>
            </h2>
            <button
              onClick={modals.fileExplorer.onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <div className="text-sm text-surface-500">
            文件浏览器需要在 Coding 模式下使用，请在 /coding/new 路径打开。
          </div>
        </div>
      </SoloModal>

      <SoloModal open={modals.planEditor.open} onClose={modals.planEditor.onClose} maxWidth="max-w-4xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>✏️</span>
              <span>Plan Editor</span>
            </h2>
            <button onClick={modals.planEditor.onClose} className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center" aria-label="关闭">
              ✕
            </button>
          </div>
          <div className="text-sm text-surface-500">Plan Editor 需要在 Coding 模式下使用。</div>
        </div>
      </SoloModal>

      <SoloModal open={modals.rules.open} onClose={modals.rules.onClose} maxWidth="max-w-4xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>📐</span>
              <span>规则</span>
            </h2>
            <button onClick={modals.rules.onClose} className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center" aria-label="关闭">
              ✕
            </button>
          </div>
          <div className="text-sm text-surface-500">
            规则管理需要在 Coding 模式下使用。访问 <a href="/settings" className="text-blue-500 underline">/settings</a> 查看项目规则。
          </div>
        </div>
      </SoloModal>

      {/* ============================================================ */}
      {/* MCP 核心面板 */}
      {/* ============================================================ */}

      <SoloSimpleModal open={modals.mcp.open} onClose={modals.mcp.onClose} maxWidth="max-w-5xl">
        <McpPanel />
      </SoloSimpleModal>

      <SoloSimpleModal open={modals.mcpRegistry.open} onClose={modals.mcpRegistry.onClose} maxWidth="max-w-6xl">
        <McpRegistryPanel className="min-h-[600px]" />
      </SoloSimpleModal>

      <SoloSimpleModal open={modals.mcpAdvanced.open} onClose={modals.mcpAdvanced.onClose} maxWidth="max-w-5xl">
        <McpAdvancedPanel className="min-h-[600px]" />
      </SoloSimpleModal>

      <SoloModal open={modals.mcpIntegrated.open} onClose={modals.mcpIntegrated.onClose} maxWidth="max-w-5xl">
        <McpIntegratedPanel onClose={modals.mcpIntegrated.onClose} llmProviderName="mock" />
      </SoloModal>

      <SoloModal open={modals.mcpE2E.open} onClose={modals.mcpE2E.onClose} maxWidth="max-w-5xl">
        <McpE2EPanel onClose={modals.mcpE2E.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpMultimodal.open} onClose={modals.mcpMultimodal.onClose} maxWidth="max-w-5xl">
        <McpMultimodalPanel onClose={modals.mcpMultimodal.onClose} llmProviderName="mock" />
      </SoloModal>

      <SoloModal open={modals.mcpRag.open} onClose={modals.mcpRag.onClose} maxWidth="max-w-5xl">
        <McpRagPanel onClose={modals.mcpRag.onClose} llmProviderName="mock" />
      </SoloModal>

      <SoloModal open={modals.mcpRagRealLLM.open} onClose={modals.mcpRagRealLLM.onClose} maxWidth="max-w-5xl">
        <McpRagRealLLMPanel onClose={modals.mcpRagRealLLM.onClose} llmProviderName="mock" />
      </SoloModal>

      <SoloModal open={modals.mcpRagPerformance.open} onClose={modals.mcpRagPerformance.onClose} maxWidth="max-w-5xl">
        <McpRagPerformancePanel onClose={modals.mcpRagPerformance.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpMultimodalRag.open} onClose={modals.mcpMultimodalRag.onClose} maxWidth="max-w-5xl">
        <McpMultimodalRagPanel onClose={modals.mcpMultimodalRag.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpMultimodalProvider.open} onClose={modals.mcpMultimodalProvider.onClose} maxWidth="max-w-5xl">
        <McpMultimodalProviderPanel onClose={modals.mcpMultimodalProvider.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpE2EProduction.open} onClose={modals.mcpE2EProduction.onClose} maxWidth="max-w-5xl">
        <McpE2EProductionPanel onClose={modals.mcpE2EProduction.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpDeploymentValidation.open} onClose={modals.mcpDeploymentValidation.onClose} maxWidth="max-w-5xl">
        <McpDeploymentValidationPanel onClose={modals.mcpDeploymentValidation.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpProductionEnhancement.open} onClose={modals.mcpProductionEnhancement.onClose} maxWidth="max-w-5xl">
        <McpProductionEnhancementPanel onClose={modals.mcpProductionEnhancement.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpPlatformIntegration.open} onClose={modals.mcpPlatformIntegration.onClose} maxWidth="max-w-5xl">
        <McpPlatformIntegrationPanel onClose={modals.mcpPlatformIntegration.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpKubernetes.open} onClose={modals.mcpKubernetes.onClose} maxWidth="max-w-5xl">
        <McpKubernetesPanel onClose={modals.mcpKubernetes.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpServerless.open} onClose={modals.mcpServerless.onClose} maxWidth="max-w-5xl">
        <McpServerlessPanel onClose={modals.mcpServerless.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpStreamProcessing.open} onClose={modals.mcpStreamProcessing.onClose} maxWidth="max-w-5xl">
        <McpStreamProcessingPanel onClose={modals.mcpStreamProcessing.onClose} />
      </SoloModal>

      <SoloModal open={modals.mcpObservability.open} onClose={modals.mcpObservability.onClose} maxWidth="max-w-5xl">
        <McpObservabilityPanel onClose={modals.mcpObservability.onClose} />
      </SoloModal>

      {/* ============================================================ */}
      {/* Solo 模式特有 panel（v1.1.0 G60-FIX-3 新增） */}
      {/* ============================================================ */}

      {/* Plan Executor Panel（当 planId 存在时显示，否则提示信息） */}
      <SoloModal open={modals.planExecutor.open} onClose={modals.planExecutor.onClose} maxWidth="max-w-5xl">
        {currentPlanId ? (
          <PlanExecutorPanel
            planId={currentPlanId}
            sessionId={currentSessionId ?? undefined}
            onClose={modals.planExecutor.onClose}
          />
        ) : (
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <span>📋</span>
                <span>Plan 执行</span>
              </h2>
              <button
                onClick={modals.planExecutor.onClose}
                className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center"
                aria-label="关闭"
              >
                ✕
              </button>
            </div>
            <div className="text-sm text-surface-500">
              暂无 Plan 数据。请先在 Vibe Coding 中启动一个会话来生成 Plan。
            </div>
          </div>
        )}
      </SoloModal>

      {/* Loop State Machine Panel（始终可显示，提供 state 和 history） */}
      <SoloModal open={modals.loopState.open} onClose={modals.loopState.onClose} maxWidth="max-w-4xl">
        <LoopStateMachineView
          state={loopState ?? null}
          history={loopHistory ?? []}
          onClose={modals.loopState.onClose}
        />
      </SoloModal>

      {/* Auto-Follow Controller Panel（v1.1.0 G60-FIX-3 新增）
          提供 Auto-Follow 联动面板的设置与控制界面 */}
      <SoloModal open={modals.autoFollow.open} onClose={modals.autoFollow.onClose} maxWidth="max-w-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <span>🎯</span>
              <span>Auto-Follow 联动</span>
            </h2>
            <button
              onClick={modals.autoFollow.onClose}
              className="w-8 h-8 rounded-full hover:bg-surface-100 flex items-center justify-center"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
          <div className="text-sm text-surface-600 space-y-3">
            <p>
              Auto-Follow 是一个无 UI 的智能联动控制器，会自动响应 Vibe Coding 阶段变化。
            </p>
            <p className="text-xs text-surface-400">
              通过顶部 "Auto-Follow: ON/OFF" 按钮控制启用状态。当前阶段变化时会自动打开对应的工具面板。
            </p>
          </div>
        </div>
      </SoloModal>
    </>
  );
};

export default SoloPanelsContainer;
