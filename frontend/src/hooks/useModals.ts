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
 *           planEditor, hooks, subagentMemory, hookChain, cacheStats, streamList }
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
 * ============================================================
 */

import { useState, useCallback } from 'react';

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

/** 自定义 hook：单个 panel controller */
function usePanelController(initial: boolean = false): PanelController {
  const [open, setOpen] = useState<boolean>(initial);
  const onOpen = useCallback(() => setOpen(true), []);
  const onClose = useCallback(() => setOpen(false), []);
  const onToggle = useCallback(() => setOpen(prev => !prev), []);
  return { open, onOpen, onClose, onToggle };
}

export interface UseModalsResult {
  /** 全局设置面板 */
  settings: PanelController;
  /** MCP 工具面板 */
  mcp: PanelController;
  /** 会话压缩面板 */
  compaction: PanelController;
  /** 技能管理面板 */
  skills: PanelController;
  /** AGENTS.md 记忆面板 */
  agentsMd: PanelController;
  /** Cycle 3 MCP 高级功能面板 */
  cycle3: PanelController;
  /** 双触发压缩面板 */
  dualCompaction: PanelController;
  /** 多类型规则扫描面板 */
  rules: PanelController;
  /** 用量监控面板 */
  usage: PanelController;
  /** 文件浏览器面板 */
  fileExplorer: PanelController;
  /** Loop V7 Runner 弹窗 */
  loopV7: PanelController;
  /** v1.1.0 P0-3 新增：Plan 编辑器弹窗 */
  planEditor: PanelController;
  /** v1.2.0 P0-4 新增：Hooks 事件管理面板 */
  hooks: PanelController;
  /** v1.3.0 P0-4 新增：SubAgent 记忆查看器 */
  subagentMemory: PanelController;
  /** v1.4.0 (Cycle 5 P0-6) 新增：Hook 触发链路查看器 */
  hookChain: PanelController;
  /** v1.5.0 (Cycle 6 P0-7-A) 新增：LLM 缓存统计面板 */
  cacheStats: PanelController;
  /** v1.6.0 (Cycle 6 P0-7-B) 新增：流式恢复网关面板 */
  streamList: PanelController;
}

/**
 * useModals - 集中管理 16 个面板/弹窗的显隐状态
 * 返回值：包含每个面板 controller 的对象
 */
export function useModals(): UseModalsResult {
  const settings = usePanelController(false);
  const mcp = usePanelController(false);
  const compaction = usePanelController(false);
  const skills = usePanelController(false);
  const agentsMd = usePanelController(false);
  const cycle3 = usePanelController(false);
  const dualCompaction = usePanelController(false);
  const rules = usePanelController(false);
  const usage = usePanelController(false);
  const fileExplorer = usePanelController(true);  // 默认展开
  const loopV7 = usePanelController(false);
  const planEditor = usePanelController(false);  // v1.1.0 P0-3 新增
  const hooks = usePanelController(false);  // v1.2.0 P0-4 新增
  const subagentMemory = usePanelController(false);  // v1.3.0 P0-4 新增
  const hookChain = usePanelController(false);  // v1.4.0 (Cycle 5 P0-6) 新增
  const cacheStats = usePanelController(false);  // v1.5.0 (Cycle 6 P0-7-A) 新增
  const streamList = usePanelController(false);  // v1.6.0 (Cycle 6 P0-7-B) 新增

  return {
    settings,
    mcp,
    compaction,
    skills,
    agentsMd,
    cycle3,
    dualCompaction,
    rules,
    usage,
    fileExplorer,
    loopV7,
    planEditor,
    hooks,
    subagentMemory,
    hookChain,  // v1.4.0 (Cycle 5 P0-6) 新增
    cacheStats,  // v1.5.0 (Cycle 6 P0-7-A) 新增
    streamList,  // v1.6.0 (Cycle 6 P0-7-B) 新增
  };
}

export default useModals;
