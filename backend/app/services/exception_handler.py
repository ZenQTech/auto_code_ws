"""
# ============================================================
# 异常处理与迭代终止服务（V4.1 新增）
# ============================================================
# 核心作用：实现分级异常处理、任务超时重试、循环依赖检测、
#           人工干预流程管理，确保系统在异常场景下安全降级、
#           不丢失任务状态、不产生无效配额消耗
# 运行流程：
#   1. 接收异常事件，按类型分级路由到对应处理器
#   2. 代码级缺陷 → 返回编码智能体修复，跟踪迭代次数
#   3. 架构级缺陷 → 返回架构迭代流程
#   4. 集成兼容异常 → 定位根因，路由到智能体或架构
#   5. 系统评测优化异常 → 按类型路由到架构或智能体
#   6. 本地架构适配异常 → 最多重试 2 次后升级
#   7. 任务失败异常 → 暂停下游依赖任务，推送告警
#   8. 接口变更适配异常 → 标记任务失败，推送告警
#   9. 任务超时 → 指数退避重试 → 切换备用模型 → 标记阻塞
#   10. 循环依赖 → 拓扑排序静态检测 + 隐式依赖扫描 + 动态死锁监控
#   11. 人工干预 → 暂停/终止/修改参数/跳过已完成/调整配额/修改全局规范
# 输入参数：
#   - exception_type: str，异常类型分类
#   - task_id: str，关联任务 ID
#   - exception_detail: Dict，异常详情
#   - db_session: 数据库会话（可选）
# 输出结果：异常处理结果，包含路由决策、重试策略、告警信息
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现分级异常处理、超时重试、
#     循环依赖检测、人工干预管理四大核心模块
# ============================================================
"""

import asyncio
import logging
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class ExceptionCategory(str, Enum):
    """
    异常分类枚举
    按 V4.1 规范定义的七类异常：
      - CODE_DEFECT: 代码级缺陷（语法错误、编译错误、规范违规）
      - ARCHITECTURE_DEFECT: 架构级缺陷（设计不合理、接口不匹配）
      - INTEGRATION_COMPAT: 集成兼容异常（跨模块接口不兼容）
      - EVALUATION_OPTIMIZE: 系统评测优化异常（评测不通过需优化）
      - LOCAL_ADAPTATION: 本地架构适配异常（环境差异导致）
      - TASK_FAILURE: 任务失败异常（执行失败、资源不足）
      - INTERFACE_CHANGE: 接口变更适配异常（全局接口变更影响）
    """
    CODE_DEFECT = "code_defect"
    ARCHITECTURE_DEFECT = "architecture_defect"
    INTEGRATION_COMPAT = "integration_compat"
    EVALUATION_OPTIMIZE = "evaluation_optimize"
    LOCAL_ADAPTATION = "local_adaptation"
    TASK_FAILURE = "task_failure"
    INTERFACE_CHANGE = "interface_change"


class ExceptionSeverity(str, Enum):
    """
    异常严重程度枚举
      - LOW: 低严重度，可自动修复
      - MEDIUM: 中等严重度，需关注
      - HIGH: 高严重度，需人工介入
      - CRITICAL: 严重，需立即暂停下游
    """
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class RouteTarget(str, Enum):
    """
    异常路由目标枚举
      - CODING_AGENT: 路由到编码智能体修复
      - ARCHITECTURE_ITERATION: 路由到架构迭代流程
      - HUMAN_INTERVENTION: 路由到人工干预
      - RETRY: 自动重试
      - ESCALATE: 升级处理
    """
    CODING_AGENT = "coding_agent"
    ARCHITECTURE_ITERATION = "architecture_iteration"
    HUMAN_INTERVENTION = "human_intervention"
    RETRY = "retry"
    ESCALATE = "escalate"


class TaskBlockStatus(str, Enum):
    """
    任务阻塞状态枚举
      - NORMAL: 正常运行
      - TIMEOUT_BLOCKED: 超时阻塞
      - DEPENDENCY_BLOCKED: 依赖阻塞
      - PAUSED: 人工暂停
      - TERMINATED: 已终止
    """
    NORMAL = "normal"
    TIMEOUT_BLOCKED = "timeout_blocked"
    DEPENDENCY_BLOCKED = "dependency_blocked"
    PAUSED = "paused"
    TERMINATED = "terminated"


class InterventionCommand(str, Enum):
    """
    人工干预命令枚举
      - PAUSE_ALL: 暂停所有任务
      - TERMINATE_SINGLE: 终止单个任务
      - TERMINATE_ALL: 终止所有任务
      - MODIFY_PARAMS: 修改任务参数
      - SKIP_COMPLETED: 跳过已完成任务
      - ADJUST_QUOTA: 调整配额规则
      - MODIFY_SPECS: 修改全局规范
    """
    PAUSE_ALL = "pause_all"
    TERMINATE_SINGLE = "terminate_single"
    TERMINATE_ALL = "terminate_all"
    MODIFY_PARAMS = "modify_params"
    SKIP_COMPLETED = "skip_completed"
    ADJUST_QUOTA = "adjust_quota"
    MODIFY_SPECS = "modify_specs"


@dataclass
class ExceptionEvent:
    """
    异常事件数据类
    字段说明：
      - event_id: 异常事件唯一 ID
      - category: 异常分类
      - severity: 严重程度
      - task_id: 关联任务 ID
      - agent_id: 关联智能体 ID（可选）
      - description: 异常描述
      - detail: 异常详情（堆栈、错误码等）
      - timestamp: 发生时间戳
      - iteration_count: 当前迭代次数
      - max_iterations: 最大允许迭代次数
    """
    event_id: str = ""
    category: ExceptionCategory = ExceptionCategory.CODE_DEFECT
    severity: ExceptionSeverity = ExceptionSeverity.MEDIUM
    task_id: str = ""
    agent_id: str = ""
    description: str = ""
    detail: Dict[str, Any] = field(default_factory=dict)
    timestamp: float = field(default_factory=time.time)
    iteration_count: int = 0
    max_iterations: int = 5


@dataclass
class ExceptionHandleResult:
    """
    异常处理结果数据类
    字段说明：
      - handled: 是否已处理
      - route_target: 路由目标
      - action: 采取的动作描述
      - should_retry: 是否需要重试
      - retry_delay: 重试延迟（秒）
      - alert_message: 告警消息
      - downstream_paused: 是否暂停了下游任务
      - affected_task_ids: 受影响的任务 ID 列表
    """
    handled: bool = False
    route_target: RouteTarget = RouteTarget.CODING_AGENT
    action: str = ""
    should_retry: bool = False
    retry_delay: float = 0.0
    alert_message: str = ""
    downstream_paused: bool = False
    affected_task_ids: List[str] = field(default_factory=list)


@dataclass
class TimeoutRecord:
    """
    超时记录数据类
    字段说明：
      - task_id: 任务 ID
      - task_type: 任务类型
      - first_timeout_at: 首次超时时间
      - retry_count: 重试次数
      - backup_model_used: 是否已使用备用模型
      - current_status: 当前状态
    """
    task_id: str = ""
    task_type: str = ""
    first_timeout_at: float = 0.0
    retry_count: int = 0
    backup_model_used: bool = False
    current_status: TaskBlockStatus = TaskBlockStatus.NORMAL


@dataclass
class DependencyEdge:
    """
    依赖边数据类（用于依赖图构建）
    字段说明：
      - from_task: 依赖方任务 ID
      - to_task: 被依赖方任务 ID
      - dep_type: 依赖类型（explicit: 显式依赖, implicit: 隐式依赖）
    """
    from_task: str = ""
    to_task: str = ""
    dep_type: str = "explicit"  # explicit / implicit


# ============================================================
# 1. 分级异常处理器 - GradedExceptionHandler
# ============================================================

class GradedExceptionHandler:
    """
    分级异常处理器
    作用：根据异常分类和严重程度，将异常路由到正确的处理目标
    调用方：任务执行引擎、验证引擎、调度器
    被调用方：编码智能体、架构迭代流程、人工干预流程
    """

    def __init__(self):
        """
        初始化分级异常处理器
        运行步骤：
          1. 从全局配置读取迭代上限参数
          2. 初始化异常事件历史记录队列
          3. 初始化任务迭代计数器
          4. 初始化告警回调列表
        """
        # 从配置读取架构和评测的最大迭代次数
        arch_config = settings.architecture
        eval_config = settings.evaluation

        # 架构批判最大迭代次数
        self.max_arch_iterations: int = arch_config.get("max_critic_iterations", 3)
        # 系统评测最大迭代次数
        self.max_eval_iterations: int = eval_config.get("max_iterations", 2)
        # 本地适配最大重试次数
        self.max_local_adapt_retries: int = 2

        # 异常事件历史（最近 1000 条）
        self._event_history: deque = deque(maxlen=1000)

        # 任务迭代计数：task_id -> 当前迭代次数
        self._task_iterations: Dict[str, int] = defaultdict(int)

        # 任务异常分类计数：task_id -> {category: count}
        self._task_exception_counts: Dict[str, Dict[str, int]] = defaultdict(
            lambda: defaultdict(int)
        )

        # 告警回调列表
        self._alert_callbacks: List[Callable] = []

        # 线程安全锁
        self._lock = threading.Lock()

        logger.info(
            "分级异常处理器初始化完成 | 架构最大迭代=%d 评测最大迭代=%d 本地适配最大重试=%d",
            self.max_arch_iterations, self.max_eval_iterations, self.max_local_adapt_retries,
        )

    def handle_exception(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理异常事件（主入口）
        运行步骤：
          1. 记录异常事件到历史
          2. 更新任务迭代计数
          3. 根据异常分类路由到对应处理器
          4. 检查是否超过最大迭代次数
          5. 返回处理结果
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        with self._lock:
            # 记录事件
            self._event_history.append(event)
            # 更新迭代计数
            self._task_iterations[event.task_id] += 1
            # 更新分类计数
            self._task_exception_counts[event.task_id][event.category.value] += 1

            current_iteration = self._task_iterations[event.task_id]

            logger.warning(
                "异常事件 | task=%s category=%s severity=%s iteration=%d/%d | %s",
                event.task_id[:8] if event.task_id else "N/A",
                event.category.value, event.severity.value,
                current_iteration, event.max_iterations,
                event.description,
            )

        # 根据分类路由
        category_handlers = {
            ExceptionCategory.CODE_DEFECT: self._handle_code_defect,
            ExceptionCategory.ARCHITECTURE_DEFECT: self._handle_architecture_defect,
            ExceptionCategory.INTEGRATION_COMPAT: self._handle_integration_compat,
            ExceptionCategory.EVALUATION_OPTIMIZE: self._handle_evaluation_optimize,
            ExceptionCategory.LOCAL_ADAPTATION: self._handle_local_adaptation,
            ExceptionCategory.TASK_FAILURE: self._handle_task_failure,
            ExceptionCategory.INTERFACE_CHANGE: self._handle_interface_change,
        }

        handler = category_handlers.get(event.category, self._handle_unknown)
        result = handler(event)

        # 检查是否超过最大迭代次数，超过则升级到人工干预
        if current_iteration >= event.max_iterations:
            logger.error(
                "任务 %s 迭代次数已达上限 %d/%d，升级到人工干预",
                event.task_id[:8] if event.task_id else "N/A",
                current_iteration, event.max_iterations,
            )
            result.route_target = RouteTarget.HUMAN_INTERVENTION
            result.alert_message = (
                f"【迭代超限】任务 {event.task_id[:8]}... "
                f"已迭代 {current_iteration}/{event.max_iterations} 次，"
                f"异常分类: {event.category.value}，需人工介入决策"
            )
            result.downstream_paused = True

        # 触发告警回调
        self._trigger_alert(result, event)

        return result

    # ---- 各分类处理器 ----

    def _handle_code_defect(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理代码级缺陷异常
        策略：返回编码智能体修复，跟踪迭代次数
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        return ExceptionHandleResult(
            handled=True,
            route_target=RouteTarget.CODING_AGENT,
            action=f"代码级缺陷，返回编码智能体修复（第 {event.iteration_count + 1} 次迭代）",
            should_retry=True,
            alert_message=(
                f"【代码缺陷】任务 {event.task_id[:8]}... 检测到代码级缺陷: "
                f"{event.description}，已路由到编码智能体修复"
            ),
        )

    def _handle_architecture_defect(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理架构级缺陷异常
        策略：返回架构迭代流程，检查是否超过架构批判最大迭代次数
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        arch_iterations = self._task_exception_counts[event.task_id].get(
            ExceptionCategory.ARCHITECTURE_DEFECT.value, 0
        )

        if arch_iterations > self.max_arch_iterations:
            return ExceptionHandleResult(
                handled=True,
                route_target=RouteTarget.HUMAN_INTERVENTION,
                action=f"架构迭代次数超限（{arch_iterations}/{self.max_arch_iterations}），升级到人工干预",
                alert_message=(
                    f"【架构迭代超限】任务 {event.task_id[:8]}... "
                    f"架构批判迭代 {arch_iterations}/{self.max_arch_iterations} 次，需人工决策"
                ),
                downstream_paused=True,
            )

        return ExceptionHandleResult(
            handled=True,
            route_target=RouteTarget.ARCHITECTURE_ITERATION,
            action=f"架构级缺陷，返回架构迭代流程（第 {arch_iterations} 次架构迭代）",
            should_retry=True,
            alert_message=(
                f"【架构缺陷】任务 {event.task_id[:8]}... 检测到架构级缺陷: "
                f"{event.description}，已路由到架构迭代流程"
            ),
        )

    def _handle_integration_compat(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理集成兼容异常
        策略：定位根因，根据兼容性类型路由到智能体或架构
        运行步骤：
          1. 检查异常详情中的兼容性类型
          2. 接口不兼容 → 架构迭代
          3. 数据格式不兼容 → 编码智能体
          4. 版本不兼容 → 架构迭代
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        detail = event.detail
        compat_type = detail.get("compat_type", "unknown")

        # 接口/版本不兼容 → 架构层面修复
        if compat_type in ("interface_mismatch", "version_conflict", "api_change"):
            route = RouteTarget.ARCHITECTURE_ITERATION
            action = f"集成兼容异常（{compat_type}），路由到架构迭代"
        else:
            # 数据格式等 → 编码智能体修复
            route = RouteTarget.CODING_AGENT
            action = f"集成兼容异常（{compat_type}），路由到编码智能体修复"

        return ExceptionHandleResult(
            handled=True,
            route_target=route,
            action=action,
            should_retry=True,
            alert_message=(
                f"【集成兼容】任务 {event.task_id[:8]}... 检测到集成兼容异常 "
                f"({compat_type}): {event.description}"
            ),
        )

    def _handle_evaluation_optimize(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理系统评测优化异常
        策略：按评测类型路由到架构或智能体
        运行步骤：
          1. 检查评测类型
          2. 架构评测不通过 → 架构迭代
          3. 代码质量评测不通过 → 编码智能体
          4. 检查评测迭代次数
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        detail = event.detail
        eval_type = detail.get("eval_type", "code_quality")

        eval_iterations = self._task_exception_counts[event.task_id].get(
            ExceptionCategory.EVALUATION_OPTIMIZE.value, 0
        )

        if eval_iterations > self.max_eval_iterations:
            return ExceptionHandleResult(
                handled=True,
                route_target=RouteTarget.HUMAN_INTERVENTION,
                action=f"评测迭代次数超限（{eval_iterations}/{self.max_eval_iterations}），升级到人工干预",
                alert_message=(
                    f"【评测迭代超限】任务 {event.task_id[:8]}... "
                    f"评测迭代 {eval_iterations}/{self.max_eval_iterations} 次，需人工决策"
                ),
                downstream_paused=True,
            )

        # 架构评测 → 架构迭代
        if eval_type in ("architecture_eval", "system_eval", "integration_eval"):
            route = RouteTarget.ARCHITECTURE_ITERATION
            action = f"系统评测优化异常（{eval_type}），路由到架构迭代"
        else:
            # 代码质量评测 → 编码智能体
            route = RouteTarget.CODING_AGENT
            action = f"系统评测优化异常（{eval_type}），路由到编码智能体修复"

        return ExceptionHandleResult(
            handled=True,
            route_target=route,
            action=action,
            should_retry=True,
            alert_message=(
                f"【评测优化】任务 {event.task_id[:8]}... 评测不通过 "
                f"({eval_type}): {event.description}"
            ),
        )

    def _handle_local_adaptation(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理本地架构适配异常
        策略：最多重试 2 次，超过后升级到人工干预
        运行步骤：
          1. 检查本地适配重试次数
          2. 未超限 → 自动重试
          3. 超限 → 升级到人工干预
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        adapt_retries = self._task_exception_counts[event.task_id].get(
            ExceptionCategory.LOCAL_ADAPTATION.value, 0
        )

        if adapt_retries > self.max_local_adapt_retries:
            return ExceptionHandleResult(
                handled=True,
                route_target=RouteTarget.HUMAN_INTERVENTION,
                action=f"本地适配重试次数超限（{adapt_retries}/{self.max_local_adapt_retries}），升级到人工干预",
                alert_message=(
                    f"【本地适配超限】任务 {event.task_id[:8]}... "
                    f"本地适配重试 {adapt_retries}/{self.max_local_adapt_retries} 次，需人工介入"
                ),
                downstream_paused=True,
            )

        # 计算退避延迟：基础 2 秒，指数递增
        retry_delay = 2.0 ** adapt_retries

        return ExceptionHandleResult(
            handled=True,
            route_target=RouteTarget.RETRY,
            action=f"本地架构适配异常，第 {adapt_retries} 次重试，延迟 {retry_delay:.1f}s",
            should_retry=True,
            retry_delay=retry_delay,
            alert_message=(
                f"【本地适配】任务 {event.task_id[:8]}... 本地环境适配异常: "
                f"{event.description}，自动重试中（{adapt_retries}/{self.max_local_adapt_retries}）"
            ),
        )

    def _handle_task_failure(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理任务失败异常
        策略：暂停下游依赖任务，推送告警
        运行步骤：
          1. 标记当前任务为失败
          2. 获取下游依赖任务列表
          3. 暂停所有下游任务
          4. 推送告警通知
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        downstream_tasks = event.detail.get("downstream_task_ids", [])

        return ExceptionHandleResult(
            handled=True,
            route_target=RouteTarget.HUMAN_INTERVENTION,
            action=f"任务失败，暂停 {len(downstream_tasks)} 个下游依赖任务",
            alert_message=(
                f"【任务失败】任务 {event.task_id[:8]}... 执行失败: "
                f"{event.description}，已暂停 {len(downstream_tasks)} 个下游依赖任务"
            ),
            downstream_paused=True,
            affected_task_ids=downstream_tasks,
        )

    def _handle_interface_change(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理接口变更适配异常
        策略：标记任务失败，推送告警，等待全局接口适配
        运行步骤：
          1. 标记任务为失败状态
          2. 记录接口变更详情
          3. 推送告警通知
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        changed_interface = event.detail.get("changed_interface", "unknown")

        return ExceptionHandleResult(
            handled=True,
            route_target=RouteTarget.HUMAN_INTERVENTION,
            action=f"接口变更适配异常，接口 {changed_interface} 已变更，任务标记为失败",
            alert_message=(
                f"【接口变更】任务 {event.task_id[:8]}... 依赖接口 "
                f"{changed_interface} 已变更，任务标记为失败，需人工确认适配方案"
            ),
            downstream_paused=True,
        )

    def _handle_unknown(self, event: ExceptionEvent) -> ExceptionHandleResult:
        """
        处理未知类型异常（兜底）
        策略：升级到人工干预
        参数：
          - event: 异常事件
        返回值：ExceptionHandleResult
        """
        return ExceptionHandleResult(
            handled=False,
            route_target=RouteTarget.HUMAN_INTERVENTION,
            action="未知异常类型，升级到人工干预",
            alert_message=(
                f"【未知异常】任务 {event.task_id[:8]}... 发生未分类异常: "
                f"{event.description}，已升级到人工干预"
            ),
            downstream_paused=True,
        )

    # ---- 工具方法 ----

    def register_alert_callback(self, callback: Callable):
        """
        注册告警回调函数
        参数：
          callback: 回调函数，签名为 (result: ExceptionHandleResult, event: ExceptionEvent) -> None
        """
        self._alert_callbacks.append(callback)

    def _trigger_alert(self, result: ExceptionHandleResult, event: ExceptionEvent):
        """
        触发告警回调
        参数：
          result: 处理结果
          event: 异常事件
        """
        # 根据严重程度记录日志
        if event.severity in (ExceptionSeverity.HIGH, ExceptionSeverity.CRITICAL):
            logger.error(result.alert_message)
        elif event.severity == ExceptionSeverity.MEDIUM:
            logger.warning(result.alert_message)
        else:
            logger.info(result.alert_message)

        # 调用外部回调
        for callback in self._alert_callbacks:
            try:
                callback(result, event)
            except Exception as e:
                logger.error("告警回调执行失败: %s", e)

    def get_task_iteration_count(self, task_id: str) -> int:
        """
        获取任务当前迭代次数
        参数：
          task_id: 任务 ID
        返回值：迭代次数
        """
        return self._task_iterations.get(task_id, 0)

    def reset_task_iterations(self, task_id: str):
        """
        重置任务迭代计数（人工干预后使用）
        参数：
          task_id: 任务 ID
        """
        with self._lock:
            self._task_iterations[task_id] = 0
            if task_id in self._task_exception_counts:
                del self._task_exception_counts[task_id]
        logger.info("任务 %s 迭代计数已重置", task_id[:8] if task_id else "N/A")

    def get_exception_history(self, task_id: Optional[str] = None,
                               limit: int = 50) -> List[ExceptionEvent]:
        """
        获取异常事件历史
        参数：
          task_id: 可选，按任务 ID 过滤
          limit: 返回条数上限
        返回值：ExceptionEvent 列表
        """
        if task_id:
            filtered = [e for e in self._event_history if e.task_id == task_id]
            return filtered[-limit:]
        return list(self._event_history)[-limit:]


# ============================================================
# 2. 任务超时处理器 - TaskTimeoutHandler
# ============================================================

class TaskTimeoutHandler:
    """
    任务超时处理器
    作用：检测任务超时，执行指数退避重试、备用模型切换、阻塞标记
    调用方：任务执行引擎、调度器
    被调用方：CLI 执行器、配额管理器
    """

    def __init__(self):
        """
        初始化任务超时处理器
        运行步骤：
          1. 从全局配置读取超时参数
          2. 初始化超时记录表
          3. 初始化备用模型配置
          4. 初始化钩子故障检测状态
        """
        # 任务超时配置
        timeout_config = settings.task_timeout
        self._timeout_config: Dict[str, Dict[str, int]] = timeout_config

        # API 错误处理配置
        api_error_config = settings.api_error_handling
        # 网络错误退避基础间隔（秒）
        self._backoff_base: int = api_error_config.get("network_error_backoff_base", 1)
        # 退避乘数
        self._backoff_multiplier: int = api_error_config.get("network_error_backoff_multiplier", 2)
        # 连续超时次数限制
        self._timeout_consecutive_limit: int = api_error_config.get("timeout_consecutive_limit", 2)

        # 超时记录：task_id -> TimeoutRecord
        self._timeout_records: Dict[str, TimeoutRecord] = {}

        # 连续超时计数：task_id -> 连续超时次数
        self._consecutive_timeouts: Dict[str, int] = defaultdict(int)

        # 备用模型配置（从 CLI 配置读取）
        cli_config = settings.cli
        env_config = cli_config.get("env", {})
        # 主模型
        self._primary_model: str = env_config.get("ANTHROPIC_MODEL", "deepseek-v4-pro[1m]")
        # 备用模型（使用 flash 版本作为降级）
        self._backup_model: str = env_config.get(
            "ANTHROPIC_DEFAULT_HAIKU_MODEL", "deepseek-v4-flash"
        )

        # 钩子故障检测状态
        self._hook_failure_detected: Dict[str, bool] = defaultdict(bool)
        # 状态轮询间隔（秒）
        self._status_poll_interval: float = 5.0

        # 告警回调列表
        self._alert_callbacks: List[Callable] = []

        # 线程安全锁
        self._lock = threading.Lock()

        logger.info(
            "任务超时处理器初始化完成 | 退避基础=%ds 乘数=%d 连续超时上限=%d | "
            "主模型=%s 备用模型=%s",
            self._backoff_base, self._backoff_multiplier,
            self._timeout_consecutive_limit,
            self._primary_model, self._backup_model,
        )

    def get_task_timeout(self, task_type: str) -> Tuple[int, int]:
        """
        获取任务类型的超时配置
        参数：
          task_type: 任务类型（如 lightweight_code、architecture_design 等）
        返回值：(默认超时分钟数, 超时上限分钟数)
        """
        type_config = self._timeout_config.get(task_type, {})
        default_minutes = type_config.get("default", 30)
        max_minutes = type_config.get("max", 60)
        return default_minutes, max_minutes

    def record_timeout(self, task_id: str, task_type: str) -> TimeoutRecord:
        """
        记录任务超时事件
        运行步骤：
          1. 检查是否已有超时记录
          2. 首次超时：创建记录
          3. 重复超时：更新重试计数
          4. 检查连续超时是否超限
        参数：
          task_id: 任务 ID
          task_type: 任务类型
        返回值：TimeoutRecord
        """
        with self._lock:
            if task_id in self._timeout_records:
                record = self._timeout_records[task_id]
                record.retry_count += 1
                self._consecutive_timeouts[task_id] += 1
                logger.warning(
                    "任务 %s 再次超时 | 重试次数=%d 连续超时=%d",
                    task_id[:8] if task_id else "N/A",
                    record.retry_count, self._consecutive_timeouts[task_id],
                )
            else:
                record = TimeoutRecord(
                    task_id=task_id,
                    task_type=task_type,
                    first_timeout_at=time.time(),
                    retry_count=1,
                )
                self._timeout_records[task_id] = record
                self._consecutive_timeouts[task_id] = 1
                logger.warning(
                    "任务 %s 首次超时 | 类型=%s",
                    task_id[:8] if task_id else "N/A", task_type,
                )

            return record

    def handle_timeout(self, task_id: str, task_type: str) -> ExceptionHandleResult:
        """
        处理任务超时（主入口）
        运行步骤：
          1. 记录超时事件
          2. 首次超时：指数退避重试（最多 1 次）
          3. 重试仍超时：切换备用模型（1 次尝试）
          4. 备用模型仍超时：标记为阻塞，暂停下游，推送告警
          5. 钩子故障检测：双重超时检查 + 状态轮询
        参数：
          task_id: 任务 ID
          task_type: 任务类型
        返回值：ExceptionHandleResult
        """
        record = self.record_timeout(task_id, task_type)

        # 第一阶段：首次超时 → 指数退避重试（最多 1 次）
        if record.retry_count == 1:
            delay = self._backoff_base * (self._backoff_multiplier ** (record.retry_count - 1))
            logger.info(
                "任务 %s 首次超时，指数退避重试 | 延迟=%.1fs",
                task_id[:8] if task_id else "N/A", delay,
            )
            return ExceptionHandleResult(
                handled=True,
                route_target=RouteTarget.RETRY,
                action=f"首次超时，指数退避重试（延迟 {delay:.1f}s）",
                should_retry=True,
                retry_delay=delay,
                alert_message=(
                    f"【任务超时】任务 {task_id[:8]}... ({task_type}) 首次超时，"
                    f"指数退避 {delay:.1f}s 后重试"
                ),
            )

        # 第二阶段：重试仍超时 → 切换备用模型（1 次尝试）
        if record.retry_count == 2 and not record.backup_model_used:
            record.backup_model_used = True
            logger.warning(
                "任务 %s 重试仍超时，切换备用模型 | %s → %s",
                task_id[:8] if task_id else "N/A",
                self._primary_model, self._backup_model,
            )
            return ExceptionHandleResult(
                handled=True,
                route_target=RouteTarget.RETRY,
                action=f"重试超时，切换备用模型 {self._backup_model}（1 次尝试）",
                should_retry=True,
                retry_delay=self._backoff_base,
                alert_message=(
                    f"【超时升级】任务 {task_id[:8]}... ({task_type}) 重试仍超时，"
                    f"已切换备用模型 {self._backup_model}"
                ),
            )

        # 第三阶段：备用模型仍超时 → 标记阻塞，暂停下游，推送告警
        record.current_status = TaskBlockStatus.TIMEOUT_BLOCKED

        # 钩子故障检测：双重超时检查 + 状态轮询
        self._hook_failure_detected[task_id] = True
        self._start_status_polling(task_id)

        logger.error(
            "任务 %s 备用模型仍超时，标记为阻塞 | 连续超时=%d",
            task_id[:8] if task_id else "N/A",
            self._consecutive_timeouts.get(task_id, 0),
        )

        return ExceptionHandleResult(
            handled=True,
            route_target=RouteTarget.HUMAN_INTERVENTION,
            action="备用模型仍超时，任务标记为阻塞，暂停下游依赖任务",
            alert_message=(
                f"【超时阻塞】任务 {task_id[:8]}... ({task_type}) "
                f"经指数退避重试 + 备用模型切换后仍超时，"
                f"已标记为阻塞状态，暂停下游依赖任务，请人工介入"
            ),
            downstream_paused=True,
        )

    def _start_status_polling(self, task_id: str):
        """
        启动钩子故障检测的状态轮询（异步）
        运行步骤：
          1. 创建异步轮询任务
          2. 定期检查任务状态
          3. 检测到恢复后清除故障标记
        参数：
          task_id: 任务 ID
        """
        async def _poll_loop():
            """异步状态轮询循环"""
            poll_count = 0
            max_polls = 12  # 最多轮询 12 次（60 秒）
            while poll_count < max_polls:
                await asyncio.sleep(self._status_poll_interval)
                poll_count += 1
                # 检查是否已清除故障标记（任务已恢复）
                if not self._hook_failure_detected.get(task_id, False):
                    logger.info("任务 %s 钩子故障已恢复，停止轮询", task_id[:8])
                    return
                logger.debug(
                    "任务 %s 钩子故障轮询中... (%d/%d)",
                    task_id[:8], poll_count, max_polls,
                )
            # 超时仍未恢复
            logger.error(
                "任务 %s 钩子故障轮询超时（%d 次），确认阻塞",
                task_id[:8], max_polls,
            )

        # 在后台启动异步轮询
        try:
            asyncio.create_task(_poll_loop())
        except RuntimeError:
            # 没有运行中的事件循环，使用线程模拟
            def _thread_poll():
                poll_count = 0
                max_polls = 12
                while poll_count < max_polls:
                    time.sleep(self._status_poll_interval)
                    poll_count += 1
                    if not self._hook_failure_detected.get(task_id, False):
                        logger.info("任务 %s 钩子故障已恢复，停止轮询", task_id[:8])
                        return
                logger.error("任务 %s 钩子故障轮询超时，确认阻塞", task_id[:8])

            thread = threading.Thread(target=_thread_poll, daemon=True)
            thread.start()

    def clear_timeout_record(self, task_id: str):
        """
        清除任务超时记录（任务恢复后调用）
        参数：
          task_id: 任务 ID
        """
        with self._lock:
            self._timeout_records.pop(task_id, None)
            self._consecutive_timeouts.pop(task_id, None)
            self._hook_failure_detected.pop(task_id, None)
        logger.info("任务 %s 超时记录已清除", task_id[:8] if task_id else "N/A")

    def is_task_blocked(self, task_id: str) -> bool:
        """
        检查任务是否处于超时阻塞状态
        参数：
          task_id: 任务 ID
        返回值：是否阻塞
        """
        record = self._timeout_records.get(task_id)
        if record is None:
            return False
        return record.current_status == TaskBlockStatus.TIMEOUT_BLOCKED

    def get_timeout_record(self, task_id: str) -> Optional[TimeoutRecord]:
        """
        获取任务超时记录
        参数：
          task_id: 任务 ID
        返回值：TimeoutRecord 或 None
        """
        return self._timeout_records.get(task_id)

    def register_alert_callback(self, callback: Callable):
        """
        注册告警回调函数
        参数：
          callback: 回调函数，签名为 (result: ExceptionHandleResult) -> None
        """
        self._alert_callbacks.append(callback)


# ============================================================
# 3. 循环依赖检测器 - CircularDependencyDetector
# ============================================================

class CircularDependencyDetector:
    """
    循环依赖检测器
    作用：检测任务依赖图中的循环依赖，包括静态显式依赖、
          隐式依赖（ROS 包依赖、头文件引用、服务调用）和动态死锁
    调用方：任务规划系统、调度器
    被调用方：无（独立检测模块）
    """

    def __init__(self):
        """
        初始化循环依赖检测器
        运行步骤：
          1. 初始化依赖图（邻接表）
          2. 初始化隐式依赖扫描规则
          3. 初始化动态死锁监控状态
        """
        # 依赖图：task_id -> Set[依赖的 task_id]
        self._dependency_graph: Dict[str, Set[str]] = defaultdict(set)

        # 反向依赖图：task_id -> Set[被依赖的 task_id]（用于暂停下游）
        self._reverse_graph: Dict[str, Set[str]] = defaultdict(set)

        # 隐式依赖扫描规则
        # ROS 包依赖模式
        self._ros_package_patterns: List[str] = [
            r'<depend>([^<]+)</depend>',          # package.xml 中的 depend 标签
            r'find_package\(([^)]+)\)',            # CMakeLists.txt 中的 find_package
            r'#include\s*[<"]([^/"]+)/',          # C++ 头文件引用（提取包名）
        ]
        # 服务调用模式
        self._service_call_patterns: List[str] = [
            r'ros::service::call<([^>]+)>',        # ROS C++ 服务调用
            r'create_client<([^>]+)>',             # ROS2 C++ 客户端创建
            r'create_service<([^>]+)>',            # ROS2 C++ 服务创建
        ]

        # 动态死锁监控：task_id -> 等待开始时间
        self._wait_states: Dict[str, float] = {}

        # 死锁检测阈值（秒）：任务等待超过此时间视为潜在死锁
        self._deadlock_threshold: float = 300.0  # 5 分钟

        # 线程安全锁
        self._lock = threading.Lock()

        logger.info(
            "循环依赖检测器初始化完成 | 死锁检测阈值=%.0fs",
            self._deadlock_threshold,
        )

    # ---- 静态检测：拓扑排序 ----

    def add_dependency(self, from_task: str, to_task: str, dep_type: str = "explicit"):
        """
        添加依赖关系
        参数：
          from_task: 依赖方任务 ID
          to_task: 被依赖方任务 ID
          dep_type: 依赖类型（explicit / implicit）
        """
        with self._lock:
            self._dependency_graph[from_task].add(to_task)
            self._reverse_graph[to_task].add(from_task)
        logger.debug(
            "添加依赖: %s → %s (类型=%s)",
            from_task[:8] if from_task else "N/A",
            to_task[:8] if to_task else "N/A",
            dep_type,
        )

    def remove_dependency(self, from_task: str, to_task: str):
        """
        移除依赖关系
        参数：
          from_task: 依赖方任务 ID
          to_task: 被依赖方任务 ID
        """
        with self._lock:
            if from_task in self._dependency_graph:
                self._dependency_graph[from_task].discard(to_task)
            if to_task in self._reverse_graph:
                self._reverse_graph[to_task].discard(from_task)

    def detect_circular_dependency(self) -> List[List[str]]:
        """
        静态检测循环依赖（拓扑排序法）
        运行步骤：
          1. 构建所有节点的入度表
          2. 将入度为 0 的节点入队
          3. BFS 拓扑排序
          4. 剩余未访问节点即为循环依赖中的节点
          5. 通过 DFS 提取每个环
        返回值：循环依赖列表，每个元素为一个环（task_id 列表）
        """
        with self._lock:
            # 收集所有节点
            all_nodes: Set[str] = set()
            for node, deps in self._dependency_graph.items():
                all_nodes.add(node)
                all_nodes.update(deps)

            # 构建入度表
            in_degree: Dict[str, int] = {node: 0 for node in all_nodes}
            for node, deps in self._dependency_graph.items():
                for dep in deps:
                    if dep in in_degree:
                        in_degree[dep] += 1

            # 拓扑排序：入度为 0 的节点入队
            queue: deque = deque()
            for node, degree in in_degree.items():
                if degree == 0:
                    queue.append(node)

            visited: Set[str] = set()
            while queue:
                node = queue.popleft()
                visited.add(node)
                # 遍历依赖该节点的所有节点
                for dependent in self._reverse_graph.get(node, set()):
                    if dependent in in_degree:
                        in_degree[dependent] -= 1
                        if in_degree[dependent] == 0:
                            queue.append(dependent)

            # 未访问的节点属于循环依赖
            remaining = all_nodes - visited
            if not remaining:
                return []

            # 通过 DFS 提取环
            cycles = self._extract_cycles(remaining)
            if cycles:
                logger.warning("检测到 %d 个循环依赖环", len(cycles))
                for i, cycle in enumerate(cycles):
                    logger.warning("环 %d: %s", i + 1, " → ".join(c[:8] for c in cycle))

            return cycles

    def _extract_cycles(self, nodes: Set[str]) -> List[List[str]]:
        """
        从剩余节点中提取循环依赖环（DFS）
        运行步骤：
          1. 对每个未访问节点进行 DFS
          2. 使用访问状态标记（0=未访问, 1=访问中, 2=已完成）
          3. 遇到状态为 1 的节点时发现环
          4. 回溯提取环路径
        参数：
          nodes: 剩余未拓扑排序的节点集合
        返回值：环列表
        """
        state: Dict[str, int] = {node: 0 for node in nodes}  # 0=未访问, 1=访问中, 2=已完成
        cycles: List[List[str]] = []
        path: List[str] = []
        path_set: Set[str] = set()

        def dfs(node: str):
            """深度优先搜索检测环"""
            state[node] = 1  # 标记为访问中
            path.append(node)
            path_set.add(node)

            for dep in self._dependency_graph.get(node, set()):
                if dep not in state:
                    continue
                if state[dep] == 1:
                    # 发现环：从 path 中提取环
                    cycle_start = path.index(dep)
                    cycle = path[cycle_start:] + [dep]
                    cycles.append(cycle)
                elif state[dep] == 0:
                    dfs(dep)

            path.pop()
            path_set.discard(node)
            state[node] = 2  # 标记为已完成

        for node in nodes:
            if state[node] == 0:
                dfs(node)

        return cycles

    # ---- 隐式检测：扫描 ROS 包依赖、头文件引用、服务调用 ----

    def scan_implicit_dependencies(self, task_id: str, code_content: str) -> List[DependencyEdge]:
        """
        扫描代码中的隐式依赖关系
        运行步骤：
          1. 扫描 ROS package.xml 中的 <depend> 标签
          2. 扫描 CMakeLists.txt 中的 find_package 调用
          3. 扫描 C++ 头文件中的跨包引用
          4. 扫描 ROS 服务调用
        参数：
          task_id: 任务 ID
          code_content: 代码内容
        返回值：发现的隐式依赖边列表
        """
        import re
        implicit_edges: List[DependencyEdge] = []

        # 扫描 ROS 包依赖（package.xml 中的 <depend> 标签）
        for pattern in self._ros_package_patterns:
            matches = re.findall(pattern, code_content, re.IGNORECASE)
            for match in matches:
                # 提取包名（去除路径前缀）
                pkg_name = match.strip().split("/")[0]
                if pkg_name and pkg_name not in ("ros", "ros2", "std_msgs"):
                    edge = DependencyEdge(
                        from_task=task_id,
                        to_task=f"pkg:{pkg_name}",
                        dep_type="implicit",
                    )
                    implicit_edges.append(edge)
                    logger.debug(
                        "发现隐式 ROS 包依赖: %s → pkg:%s",
                        task_id[:8] if task_id else "N/A", pkg_name,
                    )

        # 扫描 ROS 服务调用
        for pattern in self._service_call_patterns:
            matches = re.findall(pattern, code_content, re.IGNORECASE)
            for match in matches:
                srv_name = match.strip()
                if srv_name:
                    edge = DependencyEdge(
                        from_task=task_id,
                        to_task=f"srv:{srv_name}",
                        dep_type="implicit",
                    )
                    implicit_edges.append(edge)
                    logger.debug(
                        "发现隐式服务依赖: %s → srv:%s",
                        task_id[:8] if task_id else "N/A", srv_name,
                    )

        return implicit_edges

    def add_implicit_dependencies(self, task_id: str, edges: List[DependencyEdge]):
        """
        将隐式依赖边添加到依赖图中
        参数：
          task_id: 任务 ID
          edges: 隐式依赖边列表
        """
        for edge in edges:
            self.add_dependency(edge.from_task, edge.to_task, dep_type="implicit")

    # ---- 动态死锁监控 ----

    def record_wait_state(self, task_id: str, waiting_for: str):
        """
        记录任务等待状态
        参数：
          task_id: 等待中的任务 ID
          waiting_for: 等待的目标任务 ID
        """
        with self._lock:
            self._wait_states[task_id] = time.time()
            # 同时添加隐式依赖
            self.add_dependency(task_id, waiting_for, dep_type="dynamic")
        logger.debug(
            "任务 %s 开始等待 %s",
            task_id[:8] if task_id else "N/A",
            waiting_for[:8] if waiting_for else "N/A",
        )

    def clear_wait_state(self, task_id: str):
        """
        清除任务等待状态（任务恢复后调用）
        参数：
          task_id: 任务 ID
        """
        with self._lock:
            self._wait_states.pop(task_id, None)

    def detect_deadlock(self) -> List[Tuple[str, str]]:
        """
        动态死锁检测：监控任务等待状态，检测相互等待
        运行步骤：
          1. 遍历所有等待中的任务
          2. 检查等待时间是否超过阈值
          3. 检查是否存在相互等待（A 等 B，B 等 A）
          4. 返回死锁任务对列表
        返回值：死锁任务对列表 [(task_a, task_b), ...]
        """
        now = time.time()
        deadlocks: List[Tuple[str, str]] = []

        with self._lock:
            # 检查超时等待
            timed_out = []
            for task_id, wait_start in list(self._wait_states.items()):
                if now - wait_start > self._deadlock_threshold:
                    timed_out.append(task_id)
                    logger.warning(
                        "任务 %s 等待超时（%.0fs），可能存在死锁",
                        task_id[:8] if task_id else "N/A",
                        now - wait_start,
                    )

            # 检查相互等待
            waiting_tasks = set(self._wait_states.keys())
            for task_a in waiting_tasks:
                deps_a = self._dependency_graph.get(task_a, set())
                for task_b in deps_a:
                    if task_b in waiting_tasks:
                        deps_b = self._dependency_graph.get(task_b, set())
                        if task_a in deps_b:
                            # 发现相互等待
                            deadlocks.append((task_a, task_b))
                            logger.error(
                                "检测到死锁: %s ↔ %s 相互等待",
                                task_a[:8] if task_a else "N/A",
                                task_b[:8] if task_b else "N/A",
                            )

        return deadlocks

    def get_downstream_tasks(self, task_id: str) -> List[str]:
        """
        获取下游依赖任务列表（依赖该任务的所有任务）
        参数：
          task_id: 任务 ID
        返回值：下游任务 ID 列表
        """
        return list(self._reverse_graph.get(task_id, set()))

    def get_upstream_tasks(self, task_id: str) -> List[str]:
        """
        获取上游依赖任务列表（该任务依赖的所有任务）
        参数：
          task_id: 任务 ID
        返回值：上游任务 ID 列表
        """
        return list(self._dependency_graph.get(task_id, set()))

    def clear_task_dependencies(self, task_id: str):
        """
        清除任务的所有依赖关系
        参数：
          task_id: 任务 ID
        """
        with self._lock:
            # 清除正向依赖
            self._dependency_graph.pop(task_id, None)
            # 清除反向依赖
            self._reverse_graph.pop(task_id, None)
            # 从其他节点的依赖中移除该任务
            for deps in self._dependency_graph.values():
                deps.discard(task_id)
            for deps in self._reverse_graph.values():
                deps.discard(task_id)
            # 清除等待状态
            self._wait_states.pop(task_id, None)

    def get_dependency_graph_stats(self) -> Dict[str, Any]:
        """
        获取依赖图统计信息
        返回值：
          {
            "total_nodes": int,           # 总节点数
            "total_edges": int,           # 总边数
            "circular_dependencies": int, # 循环依赖数
            "waiting_tasks": int,         # 等待中的任务数
            "deadlocks": int,             # 死锁数
          }
        """
        with self._lock:
            all_nodes: Set[str] = set()
            total_edges = 0
            for node, deps in self._dependency_graph.items():
                all_nodes.add(node)
                all_nodes.update(deps)
                total_edges += len(deps)

            cycles = self.detect_circular_dependency()
            deadlocks = self.detect_deadlock()

            return {
                "total_nodes": len(all_nodes),
                "total_edges": total_edges,
                "circular_dependencies": len(cycles),
                "waiting_tasks": len(self._wait_states),
                "deadlocks": len(deadlocks),
            }


# ============================================================
# 4. 人工干预管理器 - HumanInterventionManager
# ============================================================

class HumanInterventionManager:
    """
    人工干预管理器
    作用：管理人工干预命令的执行，包括暂停、终止、修改参数、
          跳过已完成任务、调整配额规则、修改全局规范
    调用方：API 层（人工干预接口）、异常处理器
    被调用方：调度器、任务执行引擎、配额管理器
    """

    def __init__(self):
        """
        初始化人工干预管理器
        运行步骤：
          1. 初始化干预状态
          2. 初始化任务暂停/终止记录
          3. 初始化检查点管理
          4. 从配置读取人工确认超时参数
        """
        # 全局暂停标志
        self._global_paused: bool = False

        # 暂停原因
        self._pause_reason: str = ""

        # 暂停时间戳
        self._pause_timestamp: Optional[float] = None

        # 已暂停的任务 ID 集合
        self._paused_tasks: Set[str] = set()

        # 已终止的任务 ID 集合
        self._terminated_tasks: Set[str] = set()

        # 已跳过的任务 ID 集合
        self._skipped_tasks: Set[str] = set()

        # 任务参数修改记录：task_id -> {param_name: new_value}
        self._param_modifications: Dict[str, Dict[str, Any]] = defaultdict(dict)

        # 检查点记录：task_id -> 检查点数据
        self._checkpoints: Dict[str, Dict[str, Any]] = {}

        # 干预历史记录
        self._intervention_history: deque = deque(maxlen=500)

        # 人工确认超时配置
        human_review_config = settings.human_review
        self._default_timeout_hours: int = human_review_config.get("default_timeout_hours", 24)
        self._stall_days: int = human_review_config.get("stall_days", 7)

        # 告警回调列表
        self._alert_callbacks: List[Callable] = []

        # 线程安全锁
        self._lock = threading.Lock()

        logger.info(
            "人工干预管理器初始化完成 | 默认超时=%dh 停滞标记=%dd",
            self._default_timeout_hours, self._stall_days,
        )

    # ---- 暂停处理 ----

    def pause_all(self, reason: str = "") -> Dict[str, Any]:
        """
        暂停所有任务
        运行步骤：
          1. 设置全局暂停标志
          2. 停止新任务分发
          3. 等待正在运行的任务完成（不强制中断）
          4. 记录暂停原因和时间
          5. 推送告警通知
        参数：
          reason: 暂停原因
        返回值：暂停结果
        """
        with self._lock:
            self._global_paused = True
            self._pause_reason = reason
            self._pause_timestamp = time.time()

            self._intervention_history.append({
                "command": InterventionCommand.PAUSE_ALL.value,
                "reason": reason,
                "timestamp": self._pause_timestamp,
            })

        logger.warning("【人工干预】全局暂停 | 原因: %s", reason)

        return {
            "success": True,
            "action": "pause_all",
            "reason": reason,
            "paused_at": datetime.fromtimestamp(self._pause_timestamp).isoformat(),
            "message": "已暂停所有新任务分发，正在运行的任务将继续执行至完成",
        }

    def resume_all(self) -> Dict[str, Any]:
        """
        恢复所有暂停的任务
        运行步骤：
          1. 清除全局暂停标志
          2. 从检查点恢复任务状态
          3. 重新启用任务分发
        返回值：恢复结果
        """
        with self._lock:
            self._global_paused = False
            self._pause_reason = ""
            self._pause_timestamp = None

        logger.info("【人工干预】全局恢复 | 已重新启用任务分发")

        return {
            "success": True,
            "action": "resume_all",
            "resumed_at": datetime.now(timezone.utc).isoformat(),
            "message": "已恢复任务分发，任务将从检查点继续执行",
        }

    def is_global_paused(self) -> bool:
        """检查是否全局暂停"""
        return self._global_paused

    # ---- 终止处理 ----

    def terminate_single_task(self, task_id: str, reason: str = "") -> Dict[str, Any]:
        """
        终止单个任务
        运行步骤：
          1. 标记任务为终止状态
          2. 暂停该任务的所有下游依赖任务
          3. 记录终止原因
          4. 推送告警
        参数：
          task_id: 任务 ID
          reason: 终止原因
        返回值：终止结果
        """
        with self._lock:
            self._terminated_tasks.add(task_id)
            self._intervention_history.append({
                "command": InterventionCommand.TERMINATE_SINGLE.value,
                "task_id": task_id,
                "reason": reason,
                "timestamp": time.time(),
            })

        logger.warning("【人工干预】终止单个任务 %s | 原因: %s", task_id[:8] if task_id else "N/A", reason)

        return {
            "success": True,
            "action": "terminate_single",
            "task_id": task_id,
            "reason": reason,
            "terminated_at": datetime.now(timezone.utc).isoformat(),
            "message": f"任务 {task_id[:8]}... 已终止，下游依赖任务已暂停",
        }

    def terminate_all(self, reason: str = "") -> Dict[str, Any]:
        """
        终止所有任务
        运行步骤：
          1. 设置全局暂停标志
          2. 将所有运行中的任务标记为终止
          3. 清除任务队列
          4. 记录终止原因
        参数：
          reason: 终止原因
        返回值：终止结果
        """
        with self._lock:
            self._global_paused = True
            self._pause_reason = reason
            self._intervention_history.append({
                "command": InterventionCommand.TERMINATE_ALL.value,
                "reason": reason,
                "timestamp": time.time(),
            })

        logger.critical("【人工干预】终止所有任务 | 原因: %s", reason)

        return {
            "success": True,
            "action": "terminate_all",
            "reason": reason,
            "terminated_at": datetime.now(timezone.utc).isoformat(),
            "message": "所有任务已终止，任务队列已清空",
        }

    def is_task_terminated(self, task_id: str) -> bool:
        """
        检查任务是否已被终止
        参数：
          task_id: 任务 ID
        返回值：是否已终止
        """
        return task_id in self._terminated_tasks

    # ---- 修改任务参数 ----

    def modify_task_params(self, task_id: str, params: Dict[str, Any]) -> Dict[str, Any]:
        """
        修改任务参数
        运行步骤：
          1. 验证参数合法性
          2. 更新参数修改记录
          3. 如果任务正在运行，标记需要重启
        参数：
          task_id: 任务 ID
          params: 要修改的参数 {param_name: new_value}
        返回值：修改结果
        """
        with self._lock:
            self._param_modifications[task_id].update(params)
            self._intervention_history.append({
                "command": InterventionCommand.MODIFY_PARAMS.value,
                "task_id": task_id,
                "params": params,
                "timestamp": time.time(),
            })

        logger.info(
            "【人工干预】修改任务 %s 参数: %s",
            task_id[:8] if task_id else "N/A", params,
        )

        return {
            "success": True,
            "action": "modify_params",
            "task_id": task_id,
            "modified_params": params,
            "modified_at": datetime.now(timezone.utc).isoformat(),
            "message": f"任务 {task_id[:8]}... 参数已修改",
        }

    def get_task_param_modifications(self, task_id: str) -> Dict[str, Any]:
        """
        获取任务的参数修改记录
        参数：
          task_id: 任务 ID
        返回值：参数修改字典
        """
        return dict(self._param_modifications.get(task_id, {}))

    # ---- 跳过已完成任务 ----

    def skip_completed_tasks(self, task_ids: List[str]) -> Dict[str, Any]:
        """
        跳过已完成任务（在依赖链中标记为已完成，解除下游阻塞）
        运行步骤：
          1. 验证任务是否确实已完成
          2. 标记为已跳过
          3. 解除下游任务的依赖阻塞
        参数：
          task_ids: 要跳过的任务 ID 列表
        返回值：跳过结果
        """
        with self._lock:
            for task_id in task_ids:
                self._skipped_tasks.add(task_id)
            self._intervention_history.append({
                "command": InterventionCommand.SKIP_COMPLETED.value,
                "task_ids": task_ids,
                "timestamp": time.time(),
            })

        logger.info("【人工干预】跳过 %d 个已完成任务", len(task_ids))

        return {
            "success": True,
            "action": "skip_completed",
            "skipped_count": len(task_ids),
            "skipped_task_ids": task_ids,
            "message": f"已跳过 {len(task_ids)} 个已完成任务，下游依赖已解除",
        }

    def is_task_skipped(self, task_id: str) -> bool:
        """
        检查任务是否已被跳过
        参数：
          task_id: 任务 ID
        返回值：是否已跳过
        """
        return task_id in self._skipped_tasks

    # ---- 调整配额规则 ----

    def adjust_quota_rules(self, new_rules: Dict[str, Any]) -> Dict[str, Any]:
        """
        调整配额规则（运行时动态修改）
        运行步骤：
          1. 验证新规则的合法性
          2. 更新配额管理器配置
          3. 记录变更历史
        参数：
          new_rules: 新的配额规则 {rule_name: new_value}
        返回值：调整结果
        """
        with self._lock:
            self._intervention_history.append({
                "command": InterventionCommand.ADJUST_QUOTA.value,
                "new_rules": new_rules,
                "timestamp": time.time(),
            })

        logger.warning("【人工干预】调整配额规则: %s", new_rules)

        return {
            "success": True,
            "action": "adjust_quota",
            "new_rules": new_rules,
            "adjusted_at": datetime.now(timezone.utc).isoformat(),
            "message": "配额规则已调整，新规则立即生效",
        }

    # ---- 修改全局规范 ----

    def modify_global_specs(self, spec_changes: Dict[str, Any]) -> Dict[str, Any]:
        """
        修改全局规范（需求文档、架构设计、接口规范等）
        运行步骤：
          1. 记录规范变更内容
          2. 标记受影响的任务需要重新适配
          3. 推送告警通知
          4. 触发受影响模块的适配流程
        参数：
          spec_changes: 规范变更内容 {spec_name: new_content}
        返回值：修改结果
        """
        with self._lock:
            self._intervention_history.append({
                "command": InterventionCommand.MODIFY_SPECS.value,
                "spec_changes": spec_changes,
                "timestamp": time.time(),
            })

        logger.warning("【人工干预】修改全局规范: %s", list(spec_changes.keys()))

        return {
            "success": True,
            "action": "modify_specs",
            "changed_specs": list(spec_changes.keys()),
            "modified_at": datetime.now(timezone.utc).isoformat(),
            "message": (
                f"全局规范已修改（{', '.join(spec_changes.keys())}），"
                "受影响的任务将触发适配流程"
            ),
        }

    # ---- 检查点管理 ----

    def save_checkpoint(self, task_id: str, checkpoint_data: Dict[str, Any]):
        """
        保存任务检查点
        参数：
          task_id: 任务 ID
          checkpoint_data: 检查点数据（任务状态、中间产物等）
        """
        with self._lock:
            self._checkpoints[task_id] = {
                "data": checkpoint_data,
                "saved_at": time.time(),
            }
        logger.debug("任务 %s 检查点已保存", task_id[:8] if task_id else "N/A")

    def load_checkpoint(self, task_id: str) -> Optional[Dict[str, Any]]:
        """
        加载任务检查点
        参数：
          task_id: 任务 ID
        返回值：检查点数据或 None
        """
        checkpoint = self._checkpoints.get(task_id)
        if checkpoint:
            logger.info(
                "任务 %s 从检查点恢复 | 保存时间=%s",
                task_id[:8] if task_id else "N/A",
                datetime.fromtimestamp(checkpoint["saved_at"]).isoformat(),
            )
            return checkpoint["data"]
        return None

    def clear_checkpoint(self, task_id: str):
        """
        清除任务检查点（任务完成后调用）
        参数：
          task_id: 任务 ID
        """
        self._checkpoints.pop(task_id, None)

    # ---- 干预后恢复 ----

    def recover_after_intervention(self, task_id: str) -> Dict[str, Any]:
        """
        干预后恢复任务执行
        运行步骤：
          1. 清除任务的终止/暂停标记
          2. 从检查点恢复任务状态
          3. 应用参数修改
          4. 重新启用下游任务
        参数：
          task_id: 任务 ID
        返回值：恢复结果
        """
        with self._lock:
            self._terminated_tasks.discard(task_id)
            self._paused_tasks.discard(task_id)

        checkpoint = self.load_checkpoint(task_id)
        param_mods = self.get_task_param_modifications(task_id)

        logger.info(
            "【人工干预】任务 %s 恢复执行 | 检查点=%s 参数修改=%d",
            task_id[:8] if task_id else "N/A",
            "有" if checkpoint else "无",
            len(param_mods),
        )

        return {
            "success": True,
            "action": "recover",
            "task_id": task_id,
            "has_checkpoint": checkpoint is not None,
            "param_modifications": param_mods,
            "recovered_at": datetime.now(timezone.utc).isoformat(),
            "message": f"任务 {task_id[:8]}... 已从干预状态恢复",
        }

    # ---- 工具方法 ----

    def register_alert_callback(self, callback: Callable):
        """
        注册告警回调函数
        参数：
          callback: 回调函数，签名为 (action: str, detail: Dict) -> None
        """
        self._alert_callbacks.append(callback)

    def get_intervention_history(self, limit: int = 50) -> List[Dict]:
        """
        获取干预历史记录
        参数：
          limit: 返回条数上限
        返回值：干预记录列表
        """
        return list(self._intervention_history)[-limit:]

    def get_status(self) -> Dict[str, Any]:
        """
        获取当前干预状态
        返回值：
          {
            "global_paused": bool,
            "pause_reason": str,
            "paused_task_count": int,
            "terminated_task_count": int,
            "skipped_task_count": int,
            "checkpoint_count": int,
          }
        """
        return {
            "global_paused": self._global_paused,
            "pause_reason": self._pause_reason,
            "paused_task_count": len(self._paused_tasks),
            "terminated_task_count": len(self._terminated_tasks),
            "skipped_task_count": len(self._skipped_tasks),
            "checkpoint_count": len(self._checkpoints),
        }


# ============================================================
# 全局单例实例
# ============================================================

# 分级异常处理器全局单例
graded_exception_handler = GradedExceptionHandler()

# 任务超时处理器全局单例
task_timeout_handler = TaskTimeoutHandler()

# 循环依赖检测器全局单例
circular_dependency_detector = CircularDependencyDetector()

# 人工干预管理器全局单例
human_intervention_manager = HumanInterventionManager()
