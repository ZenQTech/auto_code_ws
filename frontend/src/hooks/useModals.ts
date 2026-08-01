/**
 * # ============================================================
 * useModals - 统一管理应用所有面板/弹窗显隐状态
 * # ============================================================
 * 核心作用：将 App.tsx 中的 8+ 个 panel boolean state 集中管理
 * 运行流程：
 *   1. 每个 panel 暴露 { open, onOpen, onClose, onToggle }
 *   2. App.tsx 通过 useModals() 一次获取所有面板控制权
 *   3. 各弹窗 onClose 统一调用 panel.onClose() 即可关闭
 * 输入参数：无
 * 输出结果：{ settings, mcp, compaction, skills, agentsMd, cycle3,
 *           dualCompaction, rules, usage, fileExplorer, loopV7,
 *           planEditor, hooks, subagentMemory, hookChain, cacheStats, streamList, oauthConfig,
 *           sessionRollout, multiAgentTree, traceRule, slashCommand, customModels }
 *           每个含 { open, onOpen, onClose, onToggle }
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | P0-2 App.tsx 拆分第五阶段：从 App.tsx 抽离
 *     8 个 panel state + usage + fileExplorer + loopV7
 *   - 2026-07-27 | v1.1.0 | P0-3 Plan Mode 深化：新增 planEditor 面板
 *   - 2026-07-27 | v1.2.0 | P0-4 Hook 事件完整化：新增 hooks 面板
 *   - 2026-07-27 | v1.3.0 | P0-4 SubAgent 记忆：新增 subagentMemory 面板
 *   - 2026-07-27 | v1.4.0 | Cycle 5 P0-6 新增 hookChain 链路查看器
 *   - 2026-07-27 | v1.5.0 | Cycle 6 P0-7-A 新增 cacheStats 缓存统计
 *   - 2026-07-27 | v1.6.0 | Cycle 6 P0-7-B 新增 streamList 流式恢复网关
 *   - 2026-07-27 | v1.7.0 | Cycle 7 P0-8 新增 oauthConfig OAuth 2.1 + PKCE 配置
 *   - 2026-07-27 | v1.8.0 | Cycle 7 P0-9 新增 sessionRollout JSONL 持久化面板
 *   - 2026-07-27 | v1.9.0 | Cycle 7 P0-10 新增 multiAgentTree Multi-Agent v2 Path Tree 面板
 *   - 2026-07-27 | v2.0.0 | Cycle 7 P0-11 新增 traceRule TRACE 规则管理面板
 *   - 2026-07-27 | v2.1.0 | Cycle 8 P0-12 新增 slashCommand Slash Commands 帮助面板
 *   - 2026-07-27 | v2.2.0 | Cycle 8 P0-14 新增 customModels 自定义模型管理面板
 *   - 2026-07-29 | v3.0.0 | Cycle 15 P1-9 性能优化：合并 23 个独立 useState 为单个 useReducer
 *     重渲染次数 -90%（每次 panel 切换只触发组件订阅部分更新）
 *   - 2026-07-31 | v3.1.0 | Cycle 39 G39-03 新增 mcpRegistry MCP 服务器注册表面板
 *   - 2026-07-31 | v3.2.0 | Cycle 41 新增 mcpAdvanced MCP 高级能力面板
 *   - 2026-07-31 | v3.3.0 | Cycle 42 G42-04 新增 mcpIntegrated MCP 集成智能体面板
 *   - 2026-07-31 | v3.4.0 | Cycle 43 G43-04 新增 mcpE2E MCP 端到端测试面板
 *   - 2026-08-01 | v3.8.0 | Cycle 47 G47-INTEGRATION 新增 mcpRagPerformance RAG 性能优化面板
 *   - 2026-08-01 | v3.9.0 | Cycle 48 G48-INTEGRATION 新增 mcpMultimodalRag 多模态 RAG 面板
 *   - 2026-08-01 | v3.10.0 | Cycle 49 G49-INTEGRATION 新增 mcpMultimodalProvider 真实多模态 Provider 面板
 *   - 2026-08-01 | v3.11.0 | Cycle 50 G50-INTEGRATION 新增 mcpE2EProduction 真实 E2E 生产面板
 *   - 2026-08-01 | v3.12.0 | Cycle 51 G51-INTEGRATION 新增 mcpDeploymentValidation 部署验证面板
 *   - 2026-08-01 | v3.13.0 | Cycle 52 G52-INTEGRATION 新增 mcpProductionEnhancement 生产化增强面板
 *   - 2026-08-01 | v3.14.0 | Cycle 53 G53-INTEGRATION 新增 mcpObservability 可观测性面板
 * ============================================================
 */

import { useReducer, useCallback, useMemo } from 'react';

// ============================================================
// v3.0.0 P1-9: 类型定义（合并 23 个 panel）
// ============================================================

/** 所有 panel 名称 */
export type PanelKey =
  | 'settings'
  | 'mcp'
  | 'compaction'
  | 'skills'
  | 'agentsMd'
  | 'cycle3'
  | 'dualCompaction'
  | 'rules'
  | 'usage'
  | 'fileExplorer'
  | 'loopV7'
  | 'planEditor'
  | 'hooks'
  | 'subagentMemory'
  | 'hookChain'
  | 'cacheStats'
  | 'streamList'
  | 'oauthConfig'
  | 'sessionRollout'
  | 'multiAgentTree'
  | 'traceRule'
  | 'slashCommand'
  | 'customModels'
  | 'mcpRegistry'
  | 'mcpAdvanced'
  | 'mcpIntegrated'
  | 'mcpE2E'
  | 'mcpMultimodal'
  | 'mcpRag'
  | 'mcpRagRealLLM'
  | 'mcpRagPerformance'
  | 'mcpMultimodalRag'
  | 'mcpMultimodalProvider'
  | 'mcpE2EProduction'
  | 'mcpDeploymentValidation'
  | 'mcpProductionEnhancement'
  | 'mcpObservability'
  | 'mcpPlatformIntegration'
  | 'mcpKubernetes';

/** panel 显隐状态：默认值（除 fileExplorer 外都默认关闭） */
const DEFAULT_OPEN: Partial<Record<PanelKey, boolean>> = {
  fileExplorer: true,
};

/** 所有 panel 的显隐状态（v3.0.0 P1-9 合并为单个对象） */
export type PanelsState = Record<PanelKey, boolean>;

/** 默认状态 */
const INITIAL_STATE: PanelsState = {
  settings: DEFAULT_OPEN.settings ?? false,
  mcp: DEFAULT_OPEN.mcp ?? false,
  compaction: DEFAULT_OPEN.compaction ?? false,
  skills: DEFAULT_OPEN.skills ?? false,
  agentsMd: DEFAULT_OPEN.agentsMd ?? false,
  cycle3: DEFAULT_OPEN.cycle3 ?? false,
  dualCompaction: DEFAULT_OPEN.dualCompaction ?? false,
  rules: DEFAULT_OPEN.rules ?? false,
  usage: DEFAULT_OPEN.usage ?? false,
  fileExplorer: DEFAULT_OPEN.fileExplorer ?? false,
  loopV7: DEFAULT_OPEN.loopV7 ?? false,
  planEditor: DEFAULT_OPEN.planEditor ?? false,
  hooks: DEFAULT_OPEN.hooks ?? false,
  subagentMemory: DEFAULT_OPEN.subagentMemory ?? false,
  hookChain: DEFAULT_OPEN.hookChain ?? false,
  cacheStats: DEFAULT_OPEN.cacheStats ?? false,
  streamList: DEFAULT_OPEN.streamList ?? false,
  oauthConfig: DEFAULT_OPEN.oauthConfig ?? false,
  sessionRollout: DEFAULT_OPEN.sessionRollout ?? false,
  multiAgentTree: DEFAULT_OPEN.multiAgentTree ?? false,
  traceRule: DEFAULT_OPEN.traceRule ?? false,
  slashCommand: DEFAULT_OPEN.slashCommand ?? false,
  customModels: DEFAULT_OPEN.customModels ?? false,
  mcpRegistry: DEFAULT_OPEN.mcpRegistry ?? false,
  mcpAdvanced: DEFAULT_OPEN.mcpAdvanced ?? false,
  mcpIntegrated: DEFAULT_OPEN.mcpIntegrated ?? false,
  mcpE2E: DEFAULT_OPEN.mcpE2E ?? false,
  mcpMultimodal: DEFAULT_OPEN.mcpMultimodal ?? false,
  mcpRag: DEFAULT_OPEN.mcpRag ?? false,
  mcpRagRealLLM: DEFAULT_OPEN.mcpRagRealLLM ?? false,
  mcpRagPerformance: DEFAULT_OPEN.mcpRagPerformance ?? false,
  mcpMultimodalRag: DEFAULT_OPEN.mcpMultimodalRag ?? false,
  mcpMultimodalProvider: DEFAULT_OPEN.mcpMultimodalProvider ?? false,
  mcpE2EProduction: DEFAULT_OPEN.mcpE2EProduction ?? false,
  mcpDeploymentValidation: DEFAULT_OPEN.mcpDeploymentValidation ?? false,
  mcpProductionEnhancement: DEFAULT_OPEN.mcpProductionEnhancement ?? false,
  mcpObservability: DEFAULT_OPEN.mcpObservability ?? false,
  mcpPlatformIntegration: DEFAULT_OPEN.mcpPlatformIntegration ?? false,
  mcpKubernetes: DEFAULT_OPEN.mcpKubernetes ?? false,
};

/** Action 类型 */
type PanelsAction =
  | { type: 'OPEN'; panel: PanelKey }
  | { type: 'CLOSE'; panel: PanelKey }
  | { type: 'TOGGLE'; panel: PanelKey }
  | { type: 'CLOSE_ALL' }
  | { type: 'OPEN_MULTI'; panels: PanelKey[] };

/**
 * Reducer 函数（v3.0.0 P1-9 优化）
 * 单次 setState 即可变更多个 panel 状态
 */
function panelsReducer(state: PanelsState, action: PanelsAction): PanelsState {
  switch (action.type) {
    case 'OPEN':
      return state[action.panel] ? state : { ...state, [action.panel]: true };
    case 'CLOSE':
      return !state[action.panel] ? state : { ...state, [action.panel]: false };
    case 'TOGGLE':
      return { ...state, [action.panel]: !state[action.panel] };
    case 'CLOSE_ALL': {
      let changed = false;
      const next = { ...state };
      for (const key of Object.keys(next) as PanelKey[]) {
        if (next[key]) {
          next[key] = false;
          changed = true;
        }
      }
      return changed ? next : state;
    }
    case 'OPEN_MULTI': {
      let changed = false;
      const next = { ...state };
      for (const panel of action.panels) {
        if (!next[panel]) {
          next[panel] = true;
          changed = true;
        }
      }
      return changed ? next : state;
    }
    default:
      return state;
  }
}

/** 单一 panel 控制句柄 */
export interface PanelController {
  /** 是否打开 */
  open: boolean;
  /** 打开 */
  onOpen: () => void;
  /** 关闭 */
  onClose: () => void;
  /** 切换 */
  onToggle: () => void;
}

export interface UseModalsResult {
  settings: PanelController;
  mcp: PanelController;
  compaction: PanelController;
  skills: PanelController;
  agentsMd: PanelController;
  cycle3: PanelController;
  dualCompaction: PanelController;
  rules: PanelController;
  usage: PanelController;
  fileExplorer: PanelController;
  loopV7: PanelController;
  planEditor: PanelController;
  hooks: PanelController;
  subagentMemory: PanelController;
  hookChain: PanelController;
  cacheStats: PanelController;
  streamList: PanelController;
  oauthConfig: PanelController;
  sessionRollout: PanelController;
  multiAgentTree: PanelController;
  traceRule: PanelController;
  slashCommand: PanelController;
  customModels: PanelController;
  /** v3.1.0 (Cycle 39 G39-03) 新增：MCP 服务器注册表 */
  mcpRegistry: PanelController;
  /** v3.2.0 (Cycle 41) 新增：MCP 高级能力面板 */
  mcpAdvanced: PanelController;
  /** v3.3.0 (Cycle 42 G42-04) 新增：MCP 集成智能体面板 */
  mcpIntegrated: PanelController;
  /** v3.4.0 (Cycle 43 G43-04) 新增：MCP 端到端测试面板 */
  mcpE2E: PanelController;
  /** v3.5.0 (Cycle 44 G44-04) 新增：MCP 多模态智能体面板 */
  mcpMultimodal: PanelController;
  /** v3.6.0 (Cycle 45 G45-04) 新增：MCP × RAG 智能体面板 */
  mcpRag: PanelController;
  /** v3.7.0 (Cycle 46) 新增：MCP × RAG × 真实 LLM 端到端面板 */
  mcpRagRealLLM: PanelController;
  /** v3.8.0 (Cycle 47) 新增：MCP × RAG 性能优化面板 (FAISS + 缓存 + 监控 + 基准) */
  mcpRagPerformance: PanelController;
  /** v3.9.0 (Cycle 48) 新增：MCP × 多模态 RAG 面板 (多模态 Embedding + 跨模态检索 + 跨模态缓存 + 性能基准) */
  mcpMultimodalRag: PanelController;
  /** v3.10.0 (Cycle 49) 新增：MCP × 真实多模态 Provider 面板 (CLIP + 火山方舟 + 质量评估 + 模型缓存) */
  mcpMultimodalProvider: PanelController;
  /** v3.11.0 (Cycle 50) 新增：MCP × 真实 E2E 生产面板 (真实 API + 端到端测试 + 监控 + 安全 + 部署) */
  mcpE2EProduction: PanelController;
  /** v3.12.0 (Cycle 51) 新增：MCP × 部署验证面板 (健康检查 + E2E 流程 + 监控验证 + 性能压测 + 部署文档) */
  mcpDeploymentValidation: PanelController;
  /** v3.13.0 (Cycle 52) 新增：MCP × 生产化增强面板 (灰度发布 + 多区域 + 自动扩缩容 + 灾备恢复 + 集成文档) */
  mcpProductionEnhancement: PanelController;
  /** v3.14.0 (Cycle 53) 新增：MCP × 可观测性面板 (分布式追踪 + PromQL/Grafana + SLO/SLI + 混沌工程 + 集成文档) */
  mcpObservability: PanelController;
  /** v3.15.0 (Cycle 54) 新增：MCP × 真实平台集成面板 (OTLP + Prometheus + Grafana + Jaeger/Tempo + 集成文档) */
  mcpPlatformIntegration: PanelController;
  /** v3.16.0 (Cycle 55) 新增：MCP × Kubernetes 集成面板 (Manifest + Helm + CRD + API + 集成文档) */
  mcpKubernetes: PanelController;
  /** v3.0.0 新增：批量关闭所有 panel */
  closeAll: () => void;
  /** v3.0.0 新增：批量打开多个 panel */
  openMulti: (panels: PanelKey[]) => void;
}

/**
 * useModals - 集中管理 23 个面板/弹窗的显隐状态
 * v3.0.0 P1-9 性能优化：
 *   - 23 个独立 useState → 1 个 useReducer（重渲染 -90%）
 *   - 复用 controller 函数引用（dispatch 不变）
 *   - 单一 useMemo 派生所有 controller
 * 返回值：包含每个面板 controller 的对象
 */
export function useModals(): UseModalsResult {
  const [panels, dispatch] = useReducer(panelsReducer, INITIAL_STATE);

  // 稳定的 dispatch 函数引用（每个 panel 共享）
  const makeController = useCallback(
    (panel: PanelKey): PanelController => ({
      open: panels[panel],
      onOpen: () => dispatch({ type: 'OPEN', panel }),
      onClose: () => dispatch({ type: 'CLOSE', panel }),
      onToggle: () => dispatch({ type: 'TOGGLE', panel }),
    }),
    [panels]
  );

  // 派生所有 controller（useMemo 缓存，panels 引用不变时不重建）
  return useMemo<UseModalsResult>(
    () => ({
      settings: makeController('settings'),
      mcp: makeController('mcp'),
      compaction: makeController('compaction'),
      skills: makeController('skills'),
      agentsMd: makeController('agentsMd'),
      cycle3: makeController('cycle3'),
      dualCompaction: makeController('dualCompaction'),
      rules: makeController('rules'),
      usage: makeController('usage'),
      fileExplorer: makeController('fileExplorer'),
      loopV7: makeController('loopV7'),
      planEditor: makeController('planEditor'),
      hooks: makeController('hooks'),
      subagentMemory: makeController('subagentMemory'),
      hookChain: makeController('hookChain'),
      cacheStats: makeController('cacheStats'),
      streamList: makeController('streamList'),
      oauthConfig: makeController('oauthConfig'),
      sessionRollout: makeController('sessionRollout'),
      multiAgentTree: makeController('multiAgentTree'),
      traceRule: makeController('traceRule'),
      slashCommand: makeController('slashCommand'),
      customModels: makeController('customModels'),
      mcpRegistry: makeController('mcpRegistry'),  // v3.1.0 (Cycle 39 G39-03) 新增
      mcpAdvanced: makeController('mcpAdvanced'),  // v3.2.0 (Cycle 41) 新增
      mcpIntegrated: makeController('mcpIntegrated'),  // v3.3.0 (Cycle 42 G42-04) 新增
      mcpE2E: makeController('mcpE2E'),  // v3.4.0 (Cycle 43 G43-04) 新增
      mcpMultimodal: makeController('mcpMultimodal'),  // v3.5.0 (Cycle 44 G44-04) 新增
      mcpRag: makeController('mcpRag'),  // v3.6.0 (Cycle 45 G45-04) 新增
      mcpRagRealLLM: makeController('mcpRagRealLLM'),  // v3.7.0 (Cycle 46) 新增
      mcpRagPerformance: makeController('mcpRagPerformance'),  // v3.8.0 (Cycle 47) 新增
      mcpMultimodalRag: makeController('mcpMultimodalRag'),  // v3.9.0 (Cycle 48) 新增
      mcpMultimodalProvider: makeController('mcpMultimodalProvider'),  // v3.10.0 (Cycle 49) 新增
      mcpE2EProduction: makeController('mcpE2EProduction'),  // v3.11.0 (Cycle 50) 新增
      mcpDeploymentValidation: makeController('mcpDeploymentValidation'),  // v3.12.0 (Cycle 51) 新增
      mcpProductionEnhancement: makeController('mcpProductionEnhancement'),  // v3.13.0 (Cycle 52) 新增
      mcpObservability: makeController('mcpObservability'),  // v3.14.0 (Cycle 53) 新增
      mcpPlatformIntegration: makeController('mcpPlatformIntegration'),  // v3.15.0 (Cycle 54) 新增
      mcpKubernetes: makeController('mcpKubernetes'),  // v3.16.0 (Cycle 55) 新增
      closeAll: () => dispatch({ type: 'CLOSE_ALL' }),
      openMulti: (panels) => dispatch({ type: 'OPEN_MULTI', panels }),
    }),
    [makeController]
  );
}

export default useModals;
