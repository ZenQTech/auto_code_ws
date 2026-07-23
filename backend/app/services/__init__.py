"""
# ============================================================
# 后端核心服务 - 包初始化
# ============================================================
# 核心作用：导出所有服务模块的核心类和数据结构
# 运行流程：包导入时自动加载子模块
# 输入参数：无
# 输出结果：可导入的 PromptOptimizer、TaskPlanner、TaskScheduler、
#           TaskValidator、HermesService、MemoryStore 等
# ============================================================
# 修改记录：
#   版本 1.0.0 | 初始创建
#   版本 1.1.0 | 2026-06-17 | 新增 HermesService 导出
#   版本 1.2.0 | 2026-06-24 | 新增 MemoryStore 导出
#   版本 1.3.0 | 2026-06-24 | 新增异常处理服务导出（GradedExceptionHandler、
#             TaskTimeoutHandler、CircularDependencyDetector、HumanInterventionManager）
#   版本 1.4.0 | 2026-06-24 | 新增 SecurityChecker、SecurityReviewManager 导出
#   版本 1.5.0 | 2026-06-24 | 新增 TaskDecomposer、TaskItem、TaskListResult 导出
#   版本 1.6.0 | 2026-06-24 | 新增 InterfaceChangeManager、ManualChangeDetector 导出
#   版本 1.7.0 | 2026-06-24 | 新增 ArchitectureDesigner、ArchitectureCritic 导出
#   版本 1.8.0 | 2026-06-24 | 新增 DeliveryManager、ChangeRequestHandler、
#             CheckpointManager 导出
#   版本 1.9.0 | 2026-06-24 | 新增 RobotSceneValidator、SceneValidationReport、
#             SceneViolation、SceneType、OutputValidator、OutputValidationReport、
#             OutputIssue 导出
#   版本 1.10.0 | 2026-06-24 | 新增 IntegrationChecker、IntegrationReport、
#             CheckResult、CheckIssue、CheckStatus、CheckSeverity、
#             SystemEvaluator、EvaluationReport、DimensionResult、
#             EvalFinding、EvalGrade、EvalDimension 导出
#   版本 1.11.0 | 2026-06-24 | 新增 TrashCleaner、trash_cleaner 导出
#   版本 1.12.0 | 2026-06-29 | 将 ChangeType 替换为统一定义的 ChangeLevel；
#             将 RiskLevel 从 task_decomposer 迁移至 standard_definitions 统一导入
# ============================================================
"""
from .prompt_optimizer import PromptOptimizer, OptimizedPrompt
from .task_planner import TaskPlanner, TaskPlan
from .scheduler import TaskScheduler
from .validator import TaskValidator, ValidationResult
from .hermes_service import HermesService, HermesChatResult, HermesOptimizeResult, HermesConfirmResult
from .usage_monitor import UsageMonitor, UsageData, usage_monitor
from .security_checker import (
    SecurityChecker,
    SecurityReviewManager,
    SecurityReport,
    SecurityIssue,
    LayerResult,
    ReviewRecord,
    Severity,
    RiskLevel,
    ReviewStatus,
    ValidationLayer,
)
from .memory_store import MemoryStore, memory_store
from .context_manager import ContextManager, ContextMessage, AgentContext, context_manager
from .exception_handler import (
    # 枚举与数据类
    ExceptionCategory,
    ExceptionSeverity,
    RouteTarget,
    TaskBlockStatus,
    InterventionCommand,
    ExceptionEvent,
    ExceptionHandleResult,
    TimeoutRecord,
    DependencyEdge,
    # 分级异常处理器
    GradedExceptionHandler,
    graded_exception_handler,
    # 任务超时处理器
    TaskTimeoutHandler,
    task_timeout_handler,
    # 循环依赖检测器
    CircularDependencyDetector,
    circular_dependency_detector,
    # 人工干预管理器
    HumanInterventionManager,
    human_intervention_manager,
)
from .task_decomposer import (
    TaskDecomposer,
    TaskItem,
    TaskListResult,
    TaskType,
    TaskPriority as DecomposerTaskPriority,
)
from .standard_definitions import (
    ChangeLevel,
    RiskLevel as StandardRiskLevel,
    DefectLevel as StandardDefectLevel,
    HookType,
    StageCheckpoint,
    HookPayload,
    STAGE_CHECKPOINTS,
)
from .delivery_structure import DeliveryStructureManager, DeliveryResult
from .architecture_designer import ArchitectureDesigner, ArchitectureDoc
from .architecture_critic import ArchitectureCritic, ArchitectureDefect, DefectLevel, Priority, ReviewDimension
from .interface_change_manager import (
    InterfaceChangeManager,
    interface_change_manager,
    ChangeType as InterfaceChangeType,
    TaskStatus as InterfaceTaskStatus,
    AdaptationStatus,
    InterfaceRecord,
    ChangeRecord,
)
from .manual_change_detector import (
    ManualChangeDetector,
    manual_change_detector,
    ImpactLevel,
    RevalidationStatus,
    FileHashRecord,
    ChangeDetectionResult,
    ImpactAnalysisResult,
    RevalidationResult,
)
from .delivery_manager import (
    DeliveryManager,
    delivery_manager,
    SimulationStatus,
    IssueScope,
    ChangelogCategory,
    ProjectType,
    SimulationRecord,
    IssueItem,
    ChangelogEntry,
    DeliveryCheckResult,
)
from .change_request_handler import (
    ChangeRequestHandler,
    change_request_handler,
    TaskUpdateAction,
    TaskState,
    ChangeAssessment,
    TaskStateRecord,
    PauseRecord,
)
from .checkpoint_manager import (
    CheckpointManager,
    checkpoint_manager,
    CheckpointStatus,
    VerificationStatus,
    BreakpointStrategy,
    CheckpointData,
    ModificationRecord,
    BreakpointReport,
)
from .robot_scene_validator import (
    RobotSceneValidator,
    SceneValidationReport,
    SceneViolation,
    SceneType,
    ValidationSeverity,
)
from .output_validator import (
    OutputValidator,
    OutputValidationReport,
    OutputIssue,
    OutputValidationStatus,
)
from .integration_checker import (
    IntegrationChecker,
    IntegrationReport,
    CheckResult,
    CheckIssue,
    CheckStatus,
    CheckSeverity,
    integration_checker,
)
from .system_evaluator import (
    SystemEvaluator,
    EvaluationReport,
    DimensionResult,
    EvalFinding,
    EvalGrade,
    EvalDimension,
    system_evaluator,
)
from .trash_cleaner import TrashCleaner, trash_cleaner
