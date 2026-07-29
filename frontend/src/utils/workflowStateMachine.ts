/**
 * # ============================================================
 * # 工作流执行状态机 (v6.33.0 P0-4)
 * # ============================================================
 * # 核心作用：定义工作流执行的 7 种状态 + 合法转换规则
 * # 解决问题：当前项目只有 3 态（pending/in_progress/completed/failed），
 * #         无法表达 paused/tool-calling/cancelled 等复杂工作流场景
 * # 运行流程：
 * #   1. 定义 7 态状态机
 * #   2. 提供合法转换矩阵
 * #   3. 提供 transition() 函数统一处理状态变更
 * #   4. 提供 canTransition() 校验函数
 * #   5. 提供 getStatusConfig() UI 配置
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 15 P0-4 初始化 7 态状态机
 * # ============================================================
 */

/**
 * 工作流执行状态
 * - idle: 空闲（初始态）
 * - running: 运行中
 * - paused: 已暂停（用户主动暂停）
 * - tool-calling: 工具调用中（AI 调用外部工具）
 * - failed: 失败（异常终止）
 * - cancelled: 已取消（用户主动取消）
 * - completed: 已完成（成功结束）
 */
export type WorkflowExecutionStatus =
  | 'idle'
  | 'running'
  | 'paused'
  | 'tool-calling'
  | 'failed'
  | 'cancelled'
  | 'completed';

/**
 * 状态机转换矩阵：定义每个状态可转换到哪些状态
 * - idle → running（启动）
 * - running → paused（暂停）
 * - running → tool-calling（工具调用）
 * - running → completed（完成）
 * - running → failed（失败）
 * - running → cancelled（取消）
 * - paused → running（恢复）
 * - paused → cancelled（取消）
 * - tool-calling → running（工具调用结束）
 * - tool-calling → failed（工具调用失败）
 * - failed → idle（重置）
 * - cancelled → idle（重置）
 * - completed → idle（重置）
 */
const VALID_TRANSITIONS: Record<WorkflowExecutionStatus, WorkflowExecutionStatus[]> = {
  idle: ['running'],
  running: ['paused', 'tool-calling', 'completed', 'failed', 'cancelled'],
  paused: ['running', 'cancelled'],
  'tool-calling': ['running', 'failed'],
  failed: ['idle'],
  cancelled: ['idle'],
  completed: ['idle'],
};

/**
 * 校验状态转换是否合法
 * @param from 源状态
 * @param to 目标状态
 * @returns 是否合法
 */
export function canTransition(
  from: WorkflowExecutionStatus,
  to: WorkflowExecutionStatus
): boolean {
  if (from === to) return true;  // 同状态视为合法
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * 状态机转换
 * @param from 源状态
 * @param to 目标状态
 * @throws {Error} 非法转换抛出错误
 * @returns 目标状态
 */
export function transition(
  from: WorkflowExecutionStatus,
  to: WorkflowExecutionStatus
): WorkflowExecutionStatus {
  if (!canTransition(from, to)) {
    throw new Error(
      `[WorkflowStateMachine] 非法的状态转换: ${from} → ${to}. ` +
      `合法目标: [${VALID_TRANSITIONS[from]?.join(', ') || '无'}]`
    );
  }
  return to;
}

/**
 * 状态 UI 配置
 */
export interface StatusUIConfig {
  /** 中文标签 */
  label: string;
  /** 颜色 token（用于 Tailwind） */
  color: 'gray' | 'blue' | 'orange' | 'purple' | 'red' | 'green';
  /** 背景色 token（用于 Tailwind） */
  bg: string;
  /** 边线色 token（用于 Tailwind） */
  border: string;
  /** 图标（用于色盲模式） */
  icon: '○' | '●' | '⏸' | '🔧' | '✕' | '⊘' | '✓';
  /** 是否处于"工作"状态（用于动效） */
  isActive: boolean;
}

/**
 * 获取状态 UI 配置
 * @param status 工作流执行状态
 * @returns UI 配置
 */
export function getStatusConfig(status: WorkflowExecutionStatus): StatusUIConfig {
  const configs: Record<WorkflowExecutionStatus, StatusUIConfig> = {
    idle: {
      label: '空闲',
      color: 'gray',
      bg: 'bg-gray-100',
      border: 'border-gray-300',
      icon: '○',
      isActive: false,
    },
    running: {
      label: '运行中',
      color: 'blue',
      bg: 'bg-blue-100',
      border: 'border-blue-400',
      icon: '●',
      isActive: true,
    },
    paused: {
      label: '已暂停',
      color: 'orange',
      bg: 'bg-orange-100',
      border: 'border-orange-400',
      icon: '⏸',
      isActive: false,
    },
    'tool-calling': {
      label: '工具调用',
      color: 'purple',
      bg: 'bg-purple-100',
      border: 'border-purple-400',
      icon: '🔧',
      isActive: true,
    },
    failed: {
      label: '失败',
      color: 'red',
      bg: 'bg-red-100',
      border: 'border-red-400',
      icon: '✕',
      isActive: false,
    },
    cancelled: {
      label: '已取消',
      color: 'gray',
      bg: 'bg-gray-100',
      border: 'border-gray-400',
      icon: '⊘',
      isActive: false,
    },
    completed: {
      label: '已完成',
      color: 'green',
      bg: 'bg-green-100',
      border: 'border-green-400',
      icon: '✓',
      isActive: false,
    },
  };
  return configs[status];
}

/**
 * 获取所有状态（用于遍历/UI 展示）
 */
export function getAllStatuses(): WorkflowExecutionStatus[] {
  return ['idle', 'running', 'paused', 'tool-calling', 'failed', 'cancelled', 'completed'];
}

/**
 * 判断状态是否为"终态"（不可继续操作）
 * - failed / cancelled / completed 为终态
 */
export function isTerminalState(status: WorkflowExecutionStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'completed';
}
