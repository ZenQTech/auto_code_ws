/**
 * # ============================================================
 * ClaudeCLIWorkbench - Claude CLI 集成工作台 (v1.0.0)
 * Cycle 61 G61-03-T5
 * # ============================================================
 * 核心作用：集成展示 G61-01 (Claude CLI) + G61-03 (Auto-Follow v2) 的工作台
 * 运行流程：
 *   1. 左栏：Auto-Follow Config + 沙箱状态
 *   2. 中栏（SplitView 60%）：Claude CLI Stage（主舞台）
 *   3. 右栏（SplitView 40%）：工具调用 + 思考 + 日志（Auto-Follow 联动）
 *   4. Auto-Follow 触发时自动聚焦右栏
 *   5. 用户可固定右栏为 sticky 不被切换
 * 设计要点：
 *   - 演示 G61-01 + G61-03 完整闭环
 *   - 主题感知
 *   - 响应式：移动端切换堆叠
 *   - 完整测试覆盖
 * 输入参数：无（独立页面）
 * 输出结果：React JSX
 * ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-03-T5 初次创建
 * ====================================
 */

import React, { useMemo } from 'react';
import { useAutoFollow, type AutoFollowEvent } from '../hooks/useAutoFollow';
import { useClaudeCLI } from '../hooks/useClaudeCLI';
import ClaudeCLIStage from '../components/ClaudeCLIStage';
import SplitView from '../components/SplitView';
import StickyTool from '../components/StickyTool';
import AutoFollowConfig from '../components/AutoFollowConfig';
import { useModals } from '../hooks/useModals';

export interface ClaudeCLIWorkbenchProps {
  testId?: string;
}

export const ClaudeCLIWorkbench: React.FC<ClaudeCLIWorkbenchProps> = ({
  testId = 'claude-cli-workbench',
}) => {
  const modals = useModals();
  const autoFollow = useAutoFollow(modals, { throttleMs: 100 });
  const claude = useClaudeCLI();

  // 处理来自 claude 的事件，触发 Auto-Follow
  React.useEffect(() => {
    if (claude.events.length === 0) return;
    const lastEvent = claude.events[claude.events.length - 1];

    // 映射 claude event 到 auto-follow event
    let afEventType: AutoFollowEvent['type'] | null = null;
    switch (lastEvent.type) {
      case 'cli_started':
        afEventType = 'vibe_step_started';
        break;
      case 'cli_thinking':
        afEventType = 'vibe_code_writing';
        break;
      case 'cli_tool_call':
        afEventType = 'spec_review_requested';
        break;
      case 'cli_exit':
        afEventType = 'vibe_step_completed';
        break;
      case 'cli_error':
        afEventType = 'vibe_step_failed';
        break;
    }
    if (afEventType) {
      autoFollow.follow({
        type: afEventType,
        timestamp: lastEvent.timestamp,
        payload: { claude_event: lastEvent.type, process_id: claude.processId },
      });
    }
  }, [claude.events.length, autoFollow, claude.processId]);

  // 主舞台 + 工具栏的 SplitView 内容
  const primary = useMemo(
    () => <ClaudeCLIStage claude={claude} testId={`${testId}-stage`} />,
    [claude, testId]
  );

  const secondary = useMemo(
    () => (
      <div data-testid={`${testId}-sidebar`} className="h-full flex flex-col p-3 gap-3 overflow-y-auto">
        {/* Auto-Follow Config */}
        <StickyTool panel="loopState" onUnstick={autoFollow.removeSticky}>
          <AutoFollowConfig autoFollow={autoFollow} testId={`${testId}-config`} />
        </StickyTool>

        {/* 沙箱状态卡片 */}
        <div
          data-testid={`${testId}-sandbox-card`}
          className="p-3 rounded-md bg-[var(--bg-panel)] border border-[var(--border-color)]"
        >
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">
            沙箱状态
          </h3>
          <div className="grid grid-cols-2 gap-1 text-xs">
            {Object.entries(claude.sandboxStatus || {}).map(([name, ok]) => (
              <div
                key={name}
                data-testid={`${testId}-sandbox-${name}-status`}
                className={`flex items-center gap-1 px-2 py-1 rounded ${
                  ok ? 'bg-green-900/30 text-green-300' : 'bg-gray-700/30 text-gray-500'
                }`}
              >
                <span>{ok ? '✓' : '✗'}</span>
                <span>{name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 事件历史 */}
        <div
          data-testid={`${testId}-events`}
          className="flex-1 p-3 rounded-md bg-[var(--bg-panel)] border border-[var(--border-color)] min-h-0 flex flex-col"
        >
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2 flex-shrink-0">
            事件历史 ({claude.events.length})
          </h3>
          <div className="flex-1 overflow-y-auto space-y-1 text-xs font-mono">
            {claude.events.length === 0 ? (
              <div className="text-[var(--text-tertiary)] italic">无事件</div>
            ) : (
              claude.events.slice(-30).map((ev, i) => (
                <div
                  key={`${ev.timestamp}-${i}`}
                  data-testid={`${testId}-event-${i}`}
                  className="px-2 py-0.5 rounded bg-[var(--bg-elevated)] text-[var(--text-secondary)] truncate"
                  title={ev.content}
                >
                  [{ev.type}] {ev.content.slice(0, 60)}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    ),
    [autoFollow, claude.sandboxStatus, claude.events, testId]
  );

  return (
    <div
      data-testid={testId}
      className="flex flex-col h-full bg-[var(--bg-app)]"
    >
      {/* 顶部状态栏 */}
      <div
        data-testid={`${testId}-topbar`}
        className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--border-color)] bg-[var(--bg-panel)]"
      >
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-[var(--text-primary)]">
            🌊 Claude CLI Workbench
          </span>
          <span className="text-xs text-[var(--text-secondary)]">
            G61-01 + G61-03 集成演示
          </span>
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
          <span data-testid={`${testId}-autofollow-status`}>
            Auto-Follow: {autoFollow.enabled ? 'ON' : 'OFF'}
          </span>
          <span data-testid={`${testId}-splitview-status`}>
            Split: {autoFollow.splitView ? 'ON' : 'OFF'}
          </span>
          <span data-testid={`${testId}-sticky-count`}>
            Sticky: {autoFollow.stickyTools.length}
          </span>
        </div>
      </div>

      {/* SplitView 主区域 */}
      <div className="flex-1 min-h-0">
        <SplitView
          primary={primary}
          secondary={secondary}
          initialRatio={0.6}
          testId={`${testId}-split`}
        />
      </div>
    </div>
  );
};

export default ClaudeCLIWorkbench;
