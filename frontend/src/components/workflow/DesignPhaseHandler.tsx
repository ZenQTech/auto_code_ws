/**
 * # ============================================================
 * # DesignPhaseHandler 子组件 - 架构设计阶段处理器
 * # ============================================================
 * # 核心作用：负责渲染架构设计批判迭代模态弹窗（ArchitectureDesignModal），
 * #           包含需求 V2、批判结果、当前迭代次数、加载态与确认/驳回回调。
 * #           后续重构目标：将 App.tsx 中 ArchitectureDesignModal 渲染段
 * #           （~1786-1796 行）整体下沉至本组件。
 * #
 * # 运行流程（迁移完成后）：
 * #   1. 父组件 App.tsx 传入 showDesignModal 控制弹窗显隐
 * #   2. 父组件 App.tsx 传入 designModalData（V2 需求 + 批判结果 + 迭代计数）
 * #   3. 父组件 App.tsx 传入 isDesignLoading 加载态
 * #   4. 用户确认时调用 onConfirm 回调（父组件负责调用 /design/confirm）
 * #   5. 用户驳回时调用 onReject 回调（父组件负责调用 /design/reject）
 * #
 * # 输入参数（Props 规划）：
 * #   - visible: 是否显示弹窗
 * #   - designModalData: 设计弹窗数据（V2 需求 + 批判结果 + 迭代次数）
 * #   - isDesignLoading: 是否正在处理设计阶段
 * #   - onConfirm: 确认设计回调
 * #   - onReject: 驳回设计回调
 * #
 * # 输出结果：ArchitectureDesignModal JSX（条件渲染）
 * #
 * # 修改记录：
 * #   - 2026-07-24 | v1.0.0 | 结构桩版本 - 仅定义 Props 接口与占位组件，
 * #                                       JSX 迁移待后续 Module 完成
 * # ============================================================
 */

import ArchitectureDesignModal from '../ArchitectureDesignModal';

/**
 * 架构批判结果（镜像 ArchitectureCritique 形状，简化版）
 * 后续可考虑将 ArchitectureCritique 类型从 types 导出复用。
 */
interface ArchitectureCritique {
  /** 总体评分（0-100） */
  overall_score: number;
  /** 改进建议列表 */
  improvements: string[];
  /** 是否通过设计评审 */
  approved: boolean;
}

/**
 * 设计弹窗数据
 */
interface DesignModalData {
  /** V2 需求文档 */
  requirementV2: string;
  /** 批判结果（null 时表示无历史批判） */
  critiqueResult: ArchitectureCritique | null;
  /** 当前迭代次数（从 1 开始） */
  iterationCount: number;
  /** 最大迭代次数 */
  maxIterations: number;
}

/**
 * DesignPhaseHandler 组件 Props 接口
 * 待迁移完成后由 App.tsx 传入实际数据；当前为占位定义。
 */
export interface DesignPhaseHandlerProps {
  /** 是否显示设计弹窗 */
  visible: boolean;
  /** 设计弹窗数据；null 时不渲染 */
  designModalData: DesignModalData | null;
  /** 是否正在处理设计阶段（确认/驳回加载态） */
  isDesignLoading: boolean;
  /** 确认设计回调（父组件调用 confirmDesignPhase） */
  onConfirm: () => Promise<void> | void;
  /** 驳回设计回调（父组件调用 rejectDesignPhase） */
  onReject: () => Promise<void> | void;
}

/**
 * DesignPhaseHandler 主组件（结构桩版本）
 * 当前实现：占位 div + 子组件引用，确保 TypeScript 编译通过。
 * 后续迁移：将 App.tsx 的 ArchitectureDesignModal 渲染块原样移入本组件。
 *
 * @param _props - DesignPhaseHandlerProps（当前桩版本不使用）
 * @returns 占位 JSX
 */
function DesignPhaseHandler(_props: DesignPhaseHandlerProps): JSX.Element {
  // 结构桩：保留组件结构，后续替换为真实 JSX
  return (
    <div data-component="DesignPhaseHandler" data-migration-status="pending">
      {/* TODO(v1.1.0): 迁移 App.tsx ArchitectureDesignModal 渲染段 (~1786-1796 行) */}
      <ArchitectureDesignModal
        requirementV2=""
        critiqueResult={null}
        isLoading={false}
        iterationCount={1}
        maxIterations={3}
        onConfirm={() => {
          /* noop */
        }}
        onReject={() => {
          /* noop */
        }}
      />
    </div>
  );
}

export default DesignPhaseHandler;
