/**
 * # ============================================================
 * AutoFollowController - Auto-Follow 联动控制器 (v1.0.0)
 * Cycle 58 G58-04
 * # ============================================================
 * 核心作用：监听 VibeCoding 事件，自动调用 autoFollow.follow
 * 运行流程：
 *   1. 接收 vibeCoding 实例
 *   2. 监听 session 状态变化
 *   3. 触发对应 AutoFollow 事件
 *   4. 无 UI（纯逻辑组件）
 * 设计要点：
 *   - 纯逻辑组件
 *   - 监听 useEffect 副作用
 *   - 自动调用 autoFollow.follow
 * 输入参数：{ autoFollow, vibeCoding }
 * 输出结果：副作用（无 UI）
 * ============================================================
 * # 修改记录：
 * #   - 2026-08-03 | v1.0.0 | Cycle 58 G58-04 初次创建
 * ============================================================
 */

import React, { useEffect, useRef } from 'react';

import type { useVibeCoding } from '../hooks/useVibeCoding';
import type { useAutoFollow, AutoFollowEvent } from '../hooks/useAutoFollow';

// ============================================================
// 类型
// ====================================

export interface AutoFollowControllerProps {
  autoFollow: ReturnType<typeof useAutoFollow>;
  vibeCoding: ReturnType<typeof useVibeCoding>;
}

// ============================================================
// 组件
// ====================================

const AutoFollowController: React.FC<AutoFollowControllerProps> = ({
  autoFollow,
  vibeCoding,
}) => {
  const prevStateRef = useRef<string>('idle');
  const prevStepsRef = useRef<string>('');

  // 监听 vibeCoding.state 变化
  useEffect(() => {
    const prev = prevStateRef.current;
    const curr = vibeCoding.state;
    if (prev !== curr) {
      // 状态变更 → 触发 AutoFollow
      if (curr === 'planning') {
        autoFollow.follow({
          type: 'vibe_plan_generated',
          timestamp: Date.now(),
        });
      } else if (curr === 'executing') {
        autoFollow.follow({
          type: 'vibe_step_started',
          timestamp: Date.now(),
        });
      } else if (curr === 'reviewing') {
        autoFollow.follow({
          type: 'vibe_test_running',
          timestamp: Date.now(),
        });
      } else if (curr === 'done') {
        autoFollow.follow({
          type: 'vibe_plan_completed',
          timestamp: Date.now(),
        });
      } else if (curr === 'error') {
        autoFollow.follow({
          type: 'vibe_step_failed',
          timestamp: Date.now(),
        });
      }
      prevStateRef.current = curr;
    }
  }, [vibeCoding.state, autoFollow]);

  // 监听 steps 变化
  useEffect(() => {
    if (!vibeCoding.session) return;
    const signature = vibeCoding.session.steps
      .map((s) => `${s.id}:${s.status}`)
      .join(',');
    if (signature !== prevStepsRef.current && signature.length > 0) {
      // 检查是否有新完成的 step
      const completedCount = vibeCoding.session.steps.filter(
        (s) => s.status === 'completed'
      ).length;
      if (completedCount > 0) {
        const lastCompleted = vibeCoding.session.steps
          .filter((s) => s.status === 'completed')
          .pop();
        if (lastCompleted) {
          autoFollow.follow({
            type: 'vibe_step_completed',
            timestamp: Date.now(),
            payload: { stepId: lastCompleted.id, stepName: lastCompleted.name },
          });
        }
      }
      prevStepsRef.current = signature;
    }
  }, [vibeCoding.session, autoFollow]);

  // 渲染空（无 UI 纯逻辑组件）
  return null;
};

export default AutoFollowController;
