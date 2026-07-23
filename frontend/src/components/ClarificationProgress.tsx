/**
 * # ============================================================
 * # 需求澄清进度指示器组件 - ClarificationProgress
 * # ============================================================
 * # 核心作用：在需求澄清阶段的消息列表顶部展示进度条，
 * #           显示当前轮次 / 总轮次、完成状态，提供可视化进度反馈
 * # 运行流程：
 * #   1. 接收 roundNumber / maxRounds / isComplete 三个状态值
 * #   2. 渲染左侧状态指示器：进行中=紫色脉冲圆点，完成=绿色对勾
 * #   3. 渲染中间文本：进行中="需求澄清 · 第 N/M 轮"，完成="需求澄清完成"
 * #   4. 渲染右侧进度条：紫色填充 + 平滑过渡动画
 * # 输入参数：
 * #   - roundNumber: 当前轮次（从 1 开始）
 * #   - maxRounds: 最大轮次上限
 * #   - isComplete: 是否已完成全部澄清
 * # 输出结果：固定在消息区顶部的进度条 DOM
 * # 修改记录：
 * #   - 2026-06-29 | v1.0.0 | 初始版本，创建进度指示器组件
 * # ============================================================
 */

import React from 'react';

/**
 * ClarificationProgress 组件 Props
 * - roundNumber: 当前轮次编号
 * - maxRounds: 最大澄清轮次
 * - isComplete: 澄清是否已完成
 */
interface ClarificationProgressProps {
  roundNumber: number;
  maxRounds: number;
  isComplete: boolean;
}

/**
 * 需求澄清进度指示器组件
 * 核心逻辑：
 *   - 根据 isComplete 切换图标（脉冲圆点 / 绿色对勾）
 *   - 根据 isComplete 切换文本（"第 N/M 轮" / "需求澄清完成"）
 *   - 进度条宽度 = (roundNumber / maxRounds) * 100%，上限 100%
 *   - 进度条使用 transition-all duration-500 实现平滑动画
 */
export default function ClarificationProgress({ roundNumber, maxRounds, isComplete }: ClarificationProgressProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-[#0d0d1a] border-b border-gray-800">
      {/* ============================================================ */}
      {/* 左侧：状态图标 + 文本 */}
      {/* ============================================================ */}
      <div className="flex items-center gap-2">
        {isComplete ? (
          /* 完成状态：绿色对勾 SVG */
          <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          /* 进行中状态：紫色脉冲圆点 */
          <span className="h-2 w-2 rounded-full bg-purple-400 animate-pulse" />
        )}
        <span className="text-sm text-gray-300">
          {isComplete ? '需求澄清完成' : `需求澄清 · 第 ${roundNumber}/${maxRounds} 轮`}
        </span>
      </div>

      {/* ============================================================ */}
      {/* 中间：进度条（flex-1 占满剩余空间） */}
      {/* ============================================================ */}
      <div className="flex-1 mx-4 h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-purple-500 rounded-full transition-all duration-500"
          style={{ width: `${Math.min((roundNumber / maxRounds) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}
