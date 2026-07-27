/**
 * # ============================================================
 * # ToolPanel 工具面板组件（D4 - Module D TRAE SOLO）
 * # ============================================================
 * # 核心作用：实现 TRAE SOLO "实时跟随模式"工具面板，
 * #           包含编辑器 / 终端 / 浏览器 / DiffView 四个 Tab，
 * #           顶部"实时跟随"开关可基于工作流阶段自动切换 Tab。
 * # 运行流程：
 * #   1. 组件挂载时通过 useWebSocket 监听 WebSocket 消息
 * #   2. 默认选中"编辑器" Tab，"实时跟随"默认开启
 * #   3. 实时跟随开启时：接收到 stage 事件自动切换 Tab
 * #      - analyzing/planning -> 编辑器
 * #      - coding             -> 编辑器
 * #      - testing            -> 终端
 * #      - reviewing          -> DiffView
 * #   4. 用户手动切换 Tab 自动关闭实时跟随（避免覆盖）
 * #   5. 用户可重新点击"实时跟随"按钮恢复
 * # 输入参数（Props）：
 * #   - editorSlot: ReactNode，编辑器 Tab 内容
 * #   - terminalSlot?: ReactNode，终端 Tab 内容（可选）
 * #   - browserSlot?: ReactNode，浏览器 Tab 内容（可选）
 * # 输出结果：纯 UI 组件（无返回值）
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 初始版本（Module D - D4）实现工具面板 + 实时跟随模式
 * # ============================================================
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebSocket } from '../hooks/useApi';
import DiffView from './DiffView';

/** Tab 标识符 */
type TabKey = 'editor' | 'terminal' | 'browser' | 'diff';

/** Tab 元数据 */
interface TabMeta {
  key: TabKey;
  label: string;
  icon: string;
  /** 是否在实时跟随中可被自动激活（无 slot 时不可激活） */
  followEligible: boolean;
}

/** 工作流阶段 -> Tab 映射（实时跟随模式） */
const STAGE_TO_TAB: Record<string, TabKey> = {
  // 分析与规划阶段 -> 编辑器（规划内容通常写在文档/编辑器）
  analyzing: 'editor',
  planning: 'editor',
  clarifying: 'editor',
  // 编码阶段 -> 编辑器
  coding: 'editor',
  implementing: 'editor',
  // 测试阶段 -> 终端
  testing: 'terminal',
  validating: 'terminal',
  // 审查/提交阶段 -> DiffView
  reviewing: 'diff',
  committing: 'diff',
  done: 'diff',
};

interface Props {
  /** 编辑器 Tab 内容（必填，最常用的工作区） */
  editorSlot: React.ReactNode;
  /** 终端 Tab 内容（可选） */
  terminalSlot?: React.ReactNode;
  /** 浏览器 Tab 内容（可选） */
  browserSlot?: React.ReactNode;
}

/**
 * Tab 元数据列表
 * 描述：固定的 Tab 列表，displayOrder 与 visualOrder 一致
 */
const TABS: TabMeta[] = [
  { key: 'editor',   label: '编辑器', icon: '📝', followEligible: true  },
  { key: 'terminal', label: '终端',   icon: '▶',  followEligible: true  },
  { key: 'browser',  label: '浏览器', icon: '🌐', followEligible: true  },
  { key: 'diff',     label: 'DiffView', icon: '📋', followEligible: true },
];

export default function ToolPanel({ editorSlot, terminalSlot, browserSlot }: Props) {
  /** 当前激活的 Tab */
  const [activeTab, setActiveTab] = useState<TabKey>('editor');
  /** 实时跟随开关 */
  const [followMode, setFollowMode] = useState(true);
  /** 最近一次由实时跟随触发的 Tab（用于 UI 标注） */
  const [followedTab, setFollowedTab] = useState<TabKey | null>(null);
  /** 防重入：阶段事件去抖 */
  const lastStageRef = useRef<{ stage: string; ts: number } | null>(null);

  // WebSocket 订阅（始终保持连接，跟随模式下用于切换 Tab）
  const { lastMessage, connected } = useWebSocket();

  /**
   * 切换到指定 Tab
   * 输入：tab 目标 Tab
   * 行为：设置 activeTab；用户手动切换时关闭实时跟随
   */
  const switchTo = useCallback((tab: TabKey, fromFollow: boolean = false) => {
    setActiveTab(tab);
    if (fromFollow) {
      setFollowedTab(tab);
    } else {
      // 用户手动切换：关闭实时跟随
      setFollowMode(false);
      setFollowedTab(null);
    }
  }, []);

  /**
   * 切换实时跟随开关
   * 行为：开启时立即将 activeTab 同步到当前阶段对应 Tab
   */
  const toggleFollow = useCallback(() => {
    setFollowMode((prev) => {
      const next = !prev;
      if (next) {
        // 开启时重置 followedTab，由下一次 stage 事件决定
        setFollowedTab(null);
      }
      return next;
    });
  }, []);

  /**
   * 监听 WebSocket 消息，解析工作流阶段并自动切换 Tab
   * 协议：服务端可发送 { type: "stage", stage: "coding" } 等事件
   *       或 { type: "workflow_stage", stage: "..." }
   *       或 { type: "code_stream", stage: "..." } 兼容 code_stream 携带 stage
   */
  useEffect(() => {
    if (!followMode || !lastMessage) return;

    const msg = lastMessage as { type?: string; stage?: string; [k: string]: unknown };
    const msgType = msg.type;

    // 仅处理阶段类事件
    if (
      msgType !== 'stage' &&
      msgType !== 'workflow_stage' &&
      msgType !== 'code_stream' &&
      msgType !== 'reasoning_stage'
    ) {
      return;
    }

    const stage = (msg.stage as string) || '';
    if (!stage) return;

    // 防抖：500ms 内同一阶段不重复处理
    const now = Date.now();
    if (
      lastStageRef.current &&
      lastStageRef.current.stage === stage &&
      now - lastStageRef.current.ts < 500
    ) {
      return;
    }
    lastStageRef.current = { stage, ts: now };

    // 映射阶段到 Tab
    const targetTab = STAGE_TO_TAB[stage];
    if (targetTab) {
      switchTo(targetTab, true);
    }
  }, [lastMessage, followMode, switchTo]);

  /**
   * 根据 activeTab 渲染内容
   * 返回对应 Tab 的内容节点；缺位 slot 时显示占位提示
   */
  const renderContent = () => {
    switch (activeTab) {
      case 'editor':
        return editorSlot;
      case 'terminal':
        return terminalSlot || <EmptyTabPlaceholder tabName="终端" hint="暂无终端输出，可在父组件传入 terminalSlot" />;
      case 'browser':
        return browserSlot || <EmptyTabPlaceholder tabName="浏览器" hint="暂无浏览器内容，可在父组件传入 browserSlot" />;
      case 'diff':
        return <DiffView />;
      default:
        return editorSlot;
    }
  };

  return (
    <div className="glass rounded-xl flex flex-col h-full overflow-hidden">
      {/* ============================================================
       * 顶部栏：实时跟随开关 + Tab 切换
       * ============================================================ */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-surface-300 bg-surface-100/30">
        {/* 实时跟随开关（v1.0.0 新增） */}
        <button
          onClick={toggleFollow}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
            followMode
              ? 'bg-hermes-500/20 text-hermes-300 border border-hermes-500/40 shadow-glow-hermes-sm'
              : 'bg-surface-200 text-surface-500 border border-surface-300'
          }`}
          title={followMode ? '关闭实时跟随' : '开启实时跟随'}
        >
          {/* 跟随图标：开启时脉动 */}
          <svg
            className={`w-3.5 h-3.5 ${followMode ? 'animate-pulse-glow' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span>实时跟随</span>
          {/* 连接状态点 */}
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              connected ? 'bg-emerald-400' : 'bg-surface-400'
            }`}
            title={connected ? 'WebSocket 已连接' : 'WebSocket 未连接'}
          />
        </button>

        {/* Tab 切换栏 */}
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const isActive = activeTab === tab.key;
            const isFollowed = followMode && followedTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => switchTo(tab.key, false)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-hermes-500/20 text-hermes-300 border border-hermes-500/30'
                    : 'text-surface-500 hover:text-surface-300 hover:bg-surface-200'
                }`}
                title={tab.label}
              >
                <span className="mr-1">{tab.icon}</span>
                {tab.label}
                {/* 实时跟随激活指示器 */}
                {isFollowed && (
                  <span className="ml-1.5 inline-block w-1 h-1 rounded-full bg-hermes-400 animate-pulse" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ============================================================
       * 内容区
       * ============================================================ */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}

/**
 * 空 Tab 占位组件
 * 输入：tabName, hint
 * 输出：统一风格的占位提示
 */
function EmptyTabPlaceholder({ tabName, hint }: { tabName: string; hint: string }) {
  return (
    <div className="flex items-center justify-center h-full p-6">
      <div className="text-center max-w-sm">
        <div className="text-4xl mb-3 opacity-50">📭</div>
        <p className="text-sm text-surface-500 mb-1">{tabName}暂未挂载</p>
        <p className="text-xs text-surface-400">{hint}</p>
      </div>
    </div>
  );
}
