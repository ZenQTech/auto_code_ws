/**
 * # ============================================================
 * # ClarificationHandler 子组件 - 需求澄清流程
 * # ============================================================
 * # 核心作用：负责渲染需求澄清阶段的交互式弹窗（ClarificationModal），
 * #           包含摘要、问题列表、回答提交、确认需求文档、继续补充
 * #           等按钮的回调处理。
 * #           后续重构目标：将 App.tsx 中 ClarificationModal 渲染段
 * #           （~1733-1784 行）整体下沉至本组件。
 * #
 * # 运行流程（迁移完成后）：
 * #   1. 父组件 App.tsx 传入澄清数据 clarificationData
 * #   2. 父组件 App.tsx 传入 workflowId（从 workflowIdRef / sessionDetail / workflowStatus 中解析）
 * #   3. 父组件 App.tsx 传入 showClarifyModal 控制弹窗显隐
 * #   4. 父组件 App.tsx 传入 skipConfirmInFlightRef 防重入守卫引用
 * #   5. 用户提交时调用 onSubmit 回调（父组件负责发送结构化回答）
 * #   6. 用户确认时调用 onConfirm 回调（父组件负责调用 /clarify/confirm）
 * #   7. 用户继续补充时调用 onContinueAdd 回调
 * #
 * # 输入参数（Props 规划）：
 * #   - visible: 是否显示弹窗
 * #   - clarificationData: 澄清数据（含 summary/questions/roundNumber/maxRounds/isComplete）
 * #   - workflowId: 当前工作流 ID
 * #   - skipConfirmInFlightRef: 跳过确认防重入守卫 ref
 * #   - onSubmit: 提交回答回调（answersText: string）=> void
 * #   - onConfirm: 确认需求文档回调（wfId?: string）=> Promise<void>
 * #   - onContinueAdd: 继续补充回调
 * #
 * # 输出结果：ClarificationModal JSX（条件渲染）
 * #
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 结构桩版本 - 仅定义 Props 接口与占位组件，
 * #                                       JSX 迁移待后续 Module 完成
 * # ============================================================
 */

import type { RefObject } from 'react';
import ClarificationModal from '../ClarificationModal';

/**
 * 澄清数据结构（镜像 App.tsx 中 clarificationData state 形状）
 * 后续可考虑将 ClarificationModal 内部 ClarificationData 类型导出复用。
 */
interface ClarificationData {
  /** AI 需求总结（Markdown 文本） */
  summary: string;
  /** 本轮问题列表（结构化字段） */
  questions: Array<{ dimension: string; question: string; importance: 'high' | 'medium' | 'low' }>;
  /** 当前轮次编号（从 1 开始） */
  roundNumber: number;
  /** 最大轮次数 */
  maxRounds: number;
  /** 是否已完成澄清 */
  isComplete: boolean;
}

/**
 * ClarificationHandler 组件 Props 接口
 * 待迁移完成后由 App.tsx 传入实际数据；当前为占位定义。
 */
export interface ClarificationHandlerProps {
  /** 是否显示澄清弹窗 */
  visible: boolean;
  /** 澄清数据；null 时不渲染任何内容 */
  clarificationData: ClarificationData | null;
  /** 当前工作流 ID（用于 onConfirm 接口） */
  workflowId: string | null;
  /** 跳过确认防重入守卫 ref（防止双击触发 designing→prompting 边界校验失败） */
  skipConfirmInFlightRef: RefObject<boolean>;
  /** 提交结构化回答回调 */
  onSubmit: (answersText: string) => void;
  /** 确认需求文档回调（父组件调用 /clarify/confirm + handleStartDesignPhase） */
  onConfirm: (wfId?: string) => Promise<void>;
  /** 继续补充回调（关闭弹窗 + 聚焦输入框） */
  onContinueAdd: () => void;
}

/**
 * ClarificationHandler 主组件（结构桩版本）
 * 当前实现：占位 div，确保 TypeScript 编译通过。
 * 后续迁移：将 App.tsx 的 ClarificationModal 渲染块原样移入本组件。
 *
 * @param _props - ClarificationHandlerProps（当前桩版本不使用）
 * @returns 占位 JSX
 */
function ClarificationHandler(_props: ClarificationHandlerProps): JSX.Element {
  // 结构桩：保留组件结构，后续替换为真实 JSX
  return (
    <div data-component="ClarificationHandler" data-migration-status="pending">
      {/* TODO(v1.1.0): 迁移 App.tsx ClarificationModal 渲染段 (~1733-1784 行) */}
      <ClarificationModal
        summary=""
        questions={[]}
        roundNumber={1}
        maxRounds={5}
        isComplete={false}
        workflowId={undefined}
        onSubmit={() => {
          /* noop */
        }}
        onConfirm={() => {
          /* noop */
        }}
        onContinueAdd={() => {
          /* noop */
        }}
      />
    </div>
  );
}

export default ClarificationHandler;
