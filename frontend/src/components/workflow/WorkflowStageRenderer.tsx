/**
 * # ============================================================
 * # WorkflowStageRenderer 子组件 - 工作流阶段渲染器
 * # ============================================================
 * # 核心作用：负责渲染工作流各阶段的可视化展示组件，包括：
 * #           ① ClarificationProgress（需求澄清进度条，仅在 clarifying 阶段）
 * #           ② ReviewReport（v1.9.0 Loop Engineering 评审报告）
 * #           ③ PipelineProgress（v1.9.0 流水线进度）
 * #           ④ GoalProgress（v1.9.0 目标进度）
 * #           后续重构目标：将 App.tsx 中工作流展示段（~1586-1596 行）
 * #           整体下沉至本组件。
 * #
 * # 运行流程（迁移完成后）：
 * #   1. 父组件 App.tsx 传入 workflowStatus（LoopWorkflowStatus）
 * #   2. 父组件 App.tsx 传入 clarificationData / reviewData / pipelineData / goalData
 * #   3. 本组件根据 workflowStatus.current_stage 条件渲染 ClarificationProgress
 * #   4. reviewData / pipelineData / goalData 任一非空时渲染对应组件
 * #
 * # 输入参数（Props 规划）：
 * #   - workflowStatus: 工作流状态（用于判断是否处于 clarifying 阶段）
 * #   - clarificationData: 澄清数据（透传给 ClarificationProgress）
 * #   - reviewData: 评审数据（null 时不渲染）
 * #   - pipelineData: 流水线数据（null 时不渲染）
 * #   - goalData: 目标数据（null 时不渲染）
 * #
 * # 输出结果：工作流阶段可视化 JSX（条件渲染）
 * #
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 结构桩版本 - 仅定义 Props 接口与占位组件，
 * #                                       JSX 迁移待后续 Module 完成
 * # ============================================================
 */

import ClarificationProgress from '../ClarificationProgress';
import ReviewReport from '../ReviewReport';
import PipelineProgress from '../PipelineProgress';
import GoalProgress from '../GoalProgress';
import type { LoopWorkflowStatus, ReviewData, PipelineData, GoalData } from '../../types';

/**
 * 澄清数据结构（镜像 App.tsx 中 clarificationData state 形状）
 */
interface ClarificationData {
  /** 当前轮次编号 */
  roundNumber: number;
  /** 最大轮次数 */
  maxRounds: number;
  /** 是否已完成澄清 */
  isComplete: boolean;
}

/**
 * WorkflowStageRenderer 组件 Props 接口
 * 待迁移完成后由 App.tsx 传入实际数据；当前为占位定义。
 */
export interface WorkflowStageRendererProps {
  /** 工作流状态（用于判断是否处于 clarifying 阶段） */
  workflowStatus: LoopWorkflowStatus | null;
  /** 澄清数据（透传给 ClarificationProgress） */
  clarificationData: ClarificationData | null;
  /** 评审数据（null 时不渲染 ReviewReport） */
  reviewData: ReviewData | null;
  /** 流水线数据（null 时不渲染 PipelineProgress） */
  pipelineData: PipelineData | null;
  /** 目标数据（null 时不渲染 GoalProgress） */
  goalData: GoalData | null;
}

/**
 * WorkflowStageRenderer 主组件（结构桩版本）
 * 当前实现：占位 div + 子组件引用，确保 TypeScript 编译通过。
 * 后续迁移：将 App.tsx 的工作流展示段原样移入本组件。
 *
 * @param _props - WorkflowStageRendererProps（当前桩版本不使用）
 * @returns 占位 JSX
 */
function WorkflowStageRenderer(_props: WorkflowStageRendererProps): JSX.Element {
  // 结构桩：保留组件结构，后续替换为真实 JSX
  return (
    <div data-component="WorkflowStageRenderer" data-migration-status="pending">
      {/* TODO(v1.1.0): 迁移 App.tsx 工作流展示段 (~1586-1596 行) */}
      <ClarificationProgress roundNumber={1} maxRounds={5} isComplete={false} />
      <ReviewReport reviewData={null as unknown as ReviewData} />
      <PipelineProgress pipelineData={null as unknown as PipelineData} />
      <GoalProgress goalData={null as unknown as GoalData} />
    </div>
  );
}

export default WorkflowStageRenderer;
