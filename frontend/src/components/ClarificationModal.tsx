/**
 * # ============================================================
 * # 需求澄清模态弹窗组件 - ClarificationModal
 * # ============================================================
 * # 核心作用：将 ClarificationCard 包装在居中覆盖层中，以模态弹窗
 * #           形式呈现需求澄清交互卡片，对齐 Trae IDE solo 模式
 * #           AskUserQuestion 弹窗的视觉形态。
 * # 运行流程：
 * #   1. 接收与 ClarificationCard 完全一致的 Props
 * #   2. 渲染全屏半透明暗色遮罩层（backdrop），不可点击外部关闭
 * #   3. 遮罩层内居中渲染紫色调圆角卡片容器
 * #   4. 容器内嵌入 ClarificationCard，内容溢出时内部滚动
 * #   5. 整体呈现渐入 + 微缩放的入场动画
 * # 输入参数（与 ClarificationCard 完全一致）：
 * #   - summary: AI 对需求的理解总结
 * #   - questions: 澄清问题列表
 * #   - roundNumber / maxRounds: 当前轮次 / 最大轮次
 * #   - isComplete: 澄清是否完成
 * #   - onSubmit: 提交结构化回答回调
 * #   - onConfirm: 确认需求文档回调
 * #   - onContinueAdd: 继续补充信息回调
 * # 输出结果：模态弹窗 DOM（内含 ClarificationCard）
 * # 修改记录：
 * #   - 2026-06-30 | v1.0.0 | 初始版本，创建模态弹窗包装 ClarificationCard
#   - 2026-06-30 | v1.0.1 | 移除 JSX 注释块修复 TypeScript 编译错误
# ============================================================
 */

import ClarificationCard, { ClarificationQuestion } from './ClarificationCard';

/**
 * ClarificationModal 组件 Props
 * 与 ClarificationCard 的 Props 完全一致，透传所有属性
 */
interface ClarificationModalProps {
  summary: string;
  questions: ClarificationQuestion[];
  roundNumber: number;
  maxRounds: number;
  isComplete: boolean;
  workflowId?: string;
  onSubmit?: (answersText: string) => void;
  onConfirm?: (workflowId?: string) => void;
  onContinueAdd?: () => void;
}

/**
 * 需求澄清模态弹窗组件
 *
 * 调用方：由父页面在澄清阶段触发渲染，Props 与 ClarificationCard 完全一致
 * 被调用：内部渲染 ClarificationCard
 *
 * 遮罩层不响应点击关闭事件（模态弹窗，非 dismissible），用户必须通过
 * ClarificationCard 内部的提交 / 确认按钮完成交互流程
 */
export default function ClarificationModal(props: ClarificationModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div
        className={[
          'bg-[#1a1a2e] border border-purple-500/30 rounded-2xl shadow-2xl',
          'max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto',
          // 入场动画：渐入 + 微缩放，持续 300ms
          'animate-in fade-in zoom-in-95 duration-300',
        ].join(' ')}
      >
        <ClarificationCard
          summary={props.summary}
          questions={props.questions}
          roundNumber={props.roundNumber}
          maxRounds={props.maxRounds}
          isComplete={props.isComplete}
          workflowId={props.workflowId}
          onSubmit={props.onSubmit}
          onConfirm={props.onConfirm}
          onContinueAdd={props.onContinueAdd}
        />
      </div>
    </div>
  );
}
