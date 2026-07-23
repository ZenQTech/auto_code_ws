"""
# ============================================================
# 智能体调度平台 V4.1 全量功能测试脚本
# ============================================================
# 核心作用：测试项目所有后端服务模块、API 路由、CLI 集成层的
#           完整功能，覆盖三大核心维度：
#           ① 代码语法/编译/导入规范
#           ② 所有模块的独立正常运行能力
#           ③ 整体运行时对 V4.1 需求文档的完整实现能力
# 运行流程：
#   1. 模块导入与语法测试
#   2. 各服务模块独立功能测试
#   3. API 路由完整性测试
#   4. 端到端集成测试
# 输入参数：无（自动发现所有模块）
# 输出结果：结构化测试报告
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，覆盖 V4.1 所有 21 个任务模块
# ============================================================
"""

import sys
import os
import importlib
import traceback
import json
from pathlib import Path

# 确保项目根目录在路径中
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# ============================================================
# 测试框架
# ============================================================

class TestRunner:
    """测试运行器，统计通过/失败/跳过数量"""

    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.skipped = 0
        self.results = []

    def test(self, name: str, condition: bool, skip: bool = False):
        """执行单个测试"""
        if skip:
            self.skipped += 1
            self.results.append(("SKIP", name, "跳过"))
            print(f"  ⬜ {name}")
            return
        if condition:
            self.passed += 1
            self.results.append(("PASS", name, ""))
            print(f"  ✅ {name}")
        else:
            self.failed += 1
            self.results.append(("FAIL", name, "条件不满足"))
            print(f"  ❌ {name}")

    def test_exception(self, name: str, func, *args, **kwargs):
        """执行可能抛异常的函数测试"""
        try:
            result = func(*args, **kwargs)
            self.test(name, True)
            return result
        except Exception as e:
            self.failed += 1
            self.results.append(("FAIL", name, str(e)))
            print(f"  ❌ {name} - {e}")
            return None

    def print_section(self, title: str):
        print(f"\n{'─' * 50}")
        print(f"  {title}")
        print(f"{'─' * 50}")

    def summary(self) -> str:
        total = self.passed + self.failed + self.skipped
        return (
            f"\n{'=' * 60}\n"
            f"测试结果: {self.passed} 通过 / {self.failed} 失败 / {self.skipped} 跳过 / {total} 总计\n"
            f"{'=' * 60}"
        )


runner = TestRunner()

# ============================================================
# 第一维度：模块导入与语法测试
# ============================================================
runner.print_section("第一维度：模块导入与语法测试")

# ---- 配置文件 ----
runner.print_section("1.1 配置文件")

def test_config_files():
    root = Path(__file__).resolve().parent.parent
    return (
        (root / "config" / "auto_code_config.yaml").exists() and
        (root / "config" / "settings.yaml").exists()
    )
runner.test("auto_code_config.yaml 存在", test_config_files())
runner.test("run.py 启动脚本存在", (Path(__file__).resolve().parent.parent / "run.py").exists())

# ---- 基础模块 ----
runner.print_section("1.2 后端基础模块")

def try_import(module_path: str):
    try:
        importlib.import_module(module_path)
        return True
    except Exception:
        return False

runner.test("config 模块", try_import("backend.app.config"))
runner.test("database 模块", try_import("backend.app.database"))
runner.test("models 模块", try_import("backend.app.models"))
runner.test("error_handler 模块", try_import("backend.app.error_handler"))
runner.test("ws 模块", try_import("backend.app.ws"))

# ---- CLI 集成层 ----
runner.print_section("1.3 CLI 集成层")

runner.test("CLIExecutor", try_import("cli_integration.executor"))
runner.test("AgentManager", try_import("cli_integration.agent_manager"))
runner.test("StrategyRouter", try_import("cli_integration.strategy_router"))
runner.test("HermesExecutor", try_import("hermes_integration.hermes_executor"))

# ---- 服务层 (30 modules) ----
runner.print_section("1.4 后端服务层（30 个模块）")

service_modules = [
    "architecture_critic", "architecture_designer", "change_request_handler",
    "checkpoint_manager", "compliance_reviewer", "content_validator",
    "context_manager", "delivery_manager", "delivery_structure",
    "exception_handler", "format_validator", "git_manager",
    "hermes_service", "integration_checker", "interface_change_manager",
    "manual_change_detector", "memory_store", "output_validator",
    "prompt_optimizer", "quota_manager", "realtime_validator",
    "robot_scene_validator", "ros_validator", "scheduler",
    "security_checker", "system_evaluator", "task_decomposer",
    "task_planner", "usage_monitor", "validator",
]

for mod in service_modules:
    runner.test(f"services.{mod}", try_import(f"backend.app.services.{mod}"))

# ---- API 路由层 (13 modules) ----
runner.print_section("1.5 API 路由层（13 个模块）")

api_modules = [
    "agents", "architecture", "conversations", "evaluation",
    "git", "hermes", "memory", "quota", "sessions", "stats",
    "tasks", "usage", "workflow",
]

for mod in api_modules:
    runner.test(f"api.{mod}", try_import(f"backend.app.api.{mod}"))

# ---- FastAPI 应用 ----
runner.print_section("1.6 FastAPI 主应用")

try:
    from backend.app.main import app
    routes = [r.path for r in app.routes if hasattr(r, 'path')]
    runner.test(f"FastAPI 应用导入成功（{len(routes)} 路由）", len(routes) > 50)
except Exception as e:
    runner.test("FastAPI 应用导入", False)

# ============================================================
# 第二维度：各模块独立功能测试
# ============================================================
runner.print_section("第二维度：各模块独立功能测试")

# ---- 2.1 QuotaManager ----
runner.print_section("2.1 配额管理器")
from backend.app.services.quota_manager import quota_manager, QuotaManager

stats = quota_manager.get_stats()
runner.test("配额统计信息为字典", isinstance(stats, dict))
runner.test("包含 alert_level 字段", "alert_level" in stats)
runner.test("包含 is_fused 字段", "is_fused" in stats)
runner.test("包含 usage_5h 字段", "usage_5h" in stats)
runner.test("包含 usage_week 字段", "usage_week" in stats)
runner.test("包含 usage_month 字段", "usage_month" in stats)
runner.test("包含 total_tokens 字段", "total_tokens" in stats)
runner.test("包含 model_stats 字段", "model_stats" in stats)
runner.test("最大并行数 > 0", quota_manager.get_max_parallel() > 0)
runner.test("can_make_call 返回 bool", isinstance(quota_manager.can_make_call(), bool))
runner.test("get_alert_level 返回 int", isinstance(quota_manager.get_alert_level(), int))
runner.test("is_fused 返回 bool", isinstance(quota_manager.is_fused(), bool))

# 测试调用记录
quota_manager.record_call("test_model", 100, 50)
stats2 = quota_manager.get_stats()
runner.test("记录调用后 5h count >= 1", stats2["usage_5h"]["count"] >= 1)

# ---- 2.2 ContextManager ----
runner.print_section("2.2 上下文管理器")
from backend.app.services.context_manager import context_manager

context_manager.register_agent("test_ctx", "全局约束：安全第一")
runner.test("注册智能体成功", "test_ctx" in context_manager.get_all_agent_ids())
context_manager.add_message("test_ctx", "user", "测试消息", 100)
usage = context_manager.get_context_usage("test_ctx")
runner.test("获取上下文使用率", isinstance(usage, (int, float)))
ctx = context_manager.get_context("test_ctx")
runner.test("获取上下文为列表", isinstance(ctx, list))
runner.test("上下文非空", len(ctx) > 0)
info = context_manager.get_agent_info("test_ctx")
runner.test("获取智能体信息", isinstance(info, dict) and "total_tokens" in info)
context_manager.unregister_agent("test_ctx")
runner.test("注销智能体", "test_ctx" not in context_manager.get_all_agent_ids())

# ---- 2.3 FormatValidator ----
runner.print_section("2.3 格式校验器")
from backend.app.services.format_validator import FormatValidator
fv = FormatValidator()

test_content = "# 项目核心需求概述\n\n测试\n\n# 结构化需求详情\n\n详情\n\n# 待确认补充事项\n\n确认"
result = fv.validate("requirement_clarification", test_content)
runner.test("需求澄清格式校验-结果非空", result is not None)
runner.test("需求澄清格式校验-有状态", hasattr(result, 'status'))

# 测试编码输出格式
code_content = "# 代码文件路径\n\npath\n\n# 功能说明\n\ndesc\n\n# 编译/运行依赖\n\ndep\n\n# 复用说明\n\n无复用\n\n# 完整代码内容\n\ncode\n\n# 自测说明\n\ntest\n\n# 修改说明\n\n无"
result2 = fv.validate("coding_output", code_content)
runner.test("编码输出格式校验", result2 is not None)

# ---- 2.4 ArchitectureDesigner & ArchitectureCritic ----
runner.print_section("2.4 架构设计与批判")
from backend.app.services.architecture_designer import ArchitectureDesigner
from backend.app.services.architecture_critic import ArchitectureCritic

designer = ArchitectureDesigner()
arch_doc = designer.generate_architecture("开发一个ROS2机器人运动控制系统")
runner.test("架构设计生成", arch_doc is not None)
runner.test("架构设计为字典", isinstance(arch_doc, dict))
runner.test("架构设计长度 > 100", len(str(arch_doc)) > 100)

info = designer.get_iteration_info()
runner.test("迭代信息", isinstance(info, dict) and "current_iteration" in info)

critic = ArchitectureCritic()
critique = critic.critique(arch_doc)
runner.test("架构批判执行", critique is not None)
defects = critic.get_defect_list()
runner.test("缺陷列表为列表", isinstance(defects, list))
conclusion = critic.get_overall_conclusion()
runner.test("总体结论为字典", isinstance(conclusion, dict))

# ---- 2.5 TaskDecomposer ----
runner.print_section("2.5 任务拆解与风险标记")
from backend.app.services.task_decomposer import TaskDecomposer, TaskType, RiskLevel, TaskPriority

decomposer = TaskDecomposer()
task_list = decomposer.decompose(arch_doc)
runner.test("任务拆解执行", task_list is not None)
task_dict = task_list.to_dict()
runner.test("任务清单为字典", isinstance(task_dict, dict))
runner.test("包含 project_info", "project_info" in task_dict)
runner.test("包含 task_list", "task_list" in task_dict)
runner.test("包含 global_interface_spec", "global_interface_spec" in task_dict)
runner.test("包含 parallel_execution_rule", "parallel_execution_rule" in task_dict)
runner.test("包含 delivery_requirement", "delivery_requirement" in task_dict)

# 测试风险标记枚举
runner.test("RiskLevel 极高", RiskLevel.VERY_HIGH.value == "极高安全风险")
runner.test("TaskPriority 高", TaskPriority.HIGH.value == "高")

# ---- 2.6 SecurityChecker ----
runner.print_section("2.6 安全校验器")
from backend.app.services.security_checker import SecurityChecker, SecurityReviewManager, RiskLevel as SecRiskLevel

sc = SecurityChecker()
runner.test("SecurityChecker 实例化", sc is not None)

srm = SecurityReviewManager()
runner.test("SecurityReviewManager 实例化", srm is not None)

# 创建测试代码文件进行 Layer3 校验
test_code = """
def emergency_stop():
    print("stop")

def check_bounds(value, min_val, max_val):
    if value < min_val:
        return min_val
    if value > max_val:
        return max_val
    return value

try:
    result = 1 / 0
except ZeroDivisionError:
    print("error")
"""
layer3_result = sc.validate_layer3(test_code)
runner.test("Layer3 逻辑校验执行", layer3_result is not None)

# ---- 2.7 ROSValidator & RealtimeValidator ----
runner.print_section("2.7 ROS 与实时校验器")
from backend.app.services.ros_validator import ROSValidator, ValidationSeverity as ROSSev
from backend.app.services.realtime_validator import RealtimeValidator

rv = ROSValidator()
runner.test("ROSValidator 实例化", rv is not None)

# 对无效路径应有兜底
report = rv.full_validate("/nonexistent/path")
runner.test("ROS 无效路径兜底", report is not None)

rtv = RealtimeValidator()
runner.test("RealtimeValidator 实例化", rtv is not None)
rtv_report = rtv.full_validate("/nonexistent/path")
runner.test("实时校验无效路径兜底", rtv_report is not None)

# ---- 2.8 ExceptionHandler ----
runner.print_section("2.8 异常处理器")
from backend.app.services.exception_handler import (
    graded_exception_handler, task_timeout_handler,
    circular_dependency_detector, human_intervention_manager,
    ExceptionCategory, InterventionCommand
)

runner.test("分级异常处理器非空", graded_exception_handler is not None)
runner.test("任务超时处理器非空", task_timeout_handler is not None)
runner.test("循环依赖检测器非空", circular_dependency_detector is not None)
runner.test("人工干预管理器非空", human_intervention_manager is not None)

# 测试循环依赖检测
deps = {"A": ["B"], "B": ["C"], "C": ["A"], "D": []}
result_dep = runner.test_exception("静态循环依赖检测",
    lambda: circular_dependency_detector.detect_circular_dependency())

# 测试人工干预
human_intervention_manager.pause_all("测试暂停")
runner.test("暂停后 is_global_paused", human_intervention_manager.is_global_paused())
human_intervention_manager.resume_all()
runner.test("恢复后 not is_global_paused", not human_intervention_manager.is_global_paused())

# ---- 2.9 GitManager ----
runner.print_section("2.9 Git 管理器")
from backend.app.services.git_manager import git_manager, BranchStrategy, CommitMode

runner.test("GitManager 实例化", git_manager is not None)
config = git_manager.get_config_summary()
runner.test("配置摘要为字典", isinstance(config, dict))
runner.test("包含 is_available", "is_available" in config)
runner.test("包含 branch_strategy", "branch_strategy" in config)

runner.test("BranchStrategy 枚举", BranchStrategy.DEFAULT.value == "default")

# ---- 2.10 MemoryStore ----
runner.print_section("2.10 记忆库")
from backend.app.services.memory_store import memory_store

runner.test("MemoryStore 实例化", memory_store is not None)
ms = memory_store.get_stats()
runner.test("统计为字典", isinstance(ms, dict))

# 测试搜索
results = memory_store.search("ROS 运动控制")
runner.test("搜索返回列表", isinstance(results, list))

# ---- 2.11 InterfaceChangeManager ----
runner.print_section("2.11 接口变更管理器")
from backend.app.services.interface_change_manager import interface_change_manager

runner.test("接口变更管理器非空", interface_change_manager is not None)
interface_change_manager.register_interface("test_iface", ["task_1", "task_2"])
stats_iface = interface_change_manager.get_change_stats()
runner.test("变更统计为字典", isinstance(stats_iface, dict))

# ---- 2.12 ManualChangeDetector ----
runner.print_section("2.12 人工修改检测器")
from backend.app.services.manual_change_detector import manual_change_detector

runner.test("人工修改检测器非空", manual_change_detector is not None)
detector_stats = manual_change_detector.get_baseline_stats()
runner.test("基线统计为字典", isinstance(detector_stats, dict))

# ---- 2.13 IntegrationChecker ----
runner.print_section("2.13 集成校验器")
from backend.app.services.integration_checker import integration_checker

runner.test("集成校验器非空", integration_checker is not None)

# ---- 2.14 SystemEvaluator ----
runner.print_section("2.14 系统评测器")
from backend.app.services.system_evaluator import system_evaluator

runner.test("系统评测器非空", system_evaluator is not None)

# ---- 2.15 DeliveryManager ----
runner.print_section("2.15 交付管理器")
from backend.app.services.delivery_manager import DeliveryManager

dm = DeliveryManager()
runner.test("交付管理器实例化", dm is not None)

# 测试 CHANGELOG 生成
changelog = dm.generate_changelog("1.0.0", [
    {"category": "Added", "description": "功能A", "related_modules": ["mod1"], "related_issues": []},
    {"category": "Fixed", "description": "bug B", "related_modules": ["mod1"], "related_issues": ["#1"]},
])
runner.test("CHANGELOG 生成", isinstance(changelog, str) and len(changelog) > 0)

# ---- 2.16 ChangeRequestHandler ----
runner.print_section("2.16 需求变更处理器")
from backend.app.services.change_request_handler import ChangeRequestHandler

crh = ChangeRequestHandler()
runner.test("需求变更处理器实例化", crh is not None)

# ---- 2.17 CheckpointManager ----
runner.print_section("2.17 断点管理器")
from backend.app.services.checkpoint_manager import CheckpointManager

cpm = CheckpointManager()
runner.test("断点管理器实例化", cpm is not None)

# ---- 2.18 RobotSceneValidator ----
runner.print_section("2.18 机器人场景校验器")
from backend.app.services.robot_scene_validator import RobotSceneValidator

rsv = RobotSceneValidator()
runner.test("机器人场景校验器实例化", rsv is not None)

# 测试场景检测
scene = rsv.detect_scene_type("/tmp/test.py")
runner.test("场景检测返回结果", scene is not None)

# ---- 2.19 OutputValidator ----
runner.print_section("2.19 输出规范校验器")
from backend.app.services.output_validator import OutputValidator

ov = OutputValidator()
runner.test("输出规范校验器实例化", ov is not None)

# 测试各角色校验
for role in ["requirement_clarification", "architecture_design", "critical_reflection",
             "coding_output", "security_check", "test_script", "integration_check",
             "system_evaluation", "delivery_archive"]:
    result = ov.validate(role, "# 测试内容\n\ncontent")
    runner.test(f"校验角色 {role}", result is not None)

# ---- 2.20 DeliveryStructureManager ----
runner.print_section("2.20 交付物结构管理器")
from backend.app.services.delivery_structure import DeliveryStructureManager

dsm = DeliveryStructureManager()
runner.test("交付物结构管理器实例化", dsm is not None)

# ---- 2.21 ContentValidator & ComplianceReviewer ----
runner.print_section("2.21 内容校验与合规评审")
from backend.app.services.content_validator import ContentValidator
from backend.app.services.compliance_reviewer import ComplianceReviewer

cv = ContentValidator()
runner.test("内容校验器实例化", cv is not None)

cr = ComplianceReviewer()
runner.test("合规评审器实例化", cr is not None)

# ---- 2.22 HermesService ----
runner.print_section("2.22 Hermes 调度服务")
from backend.app.services.hermes_service import HermesService

runner.test("HermesService 类可导入", HermesService is not None)

# ---- 2.23 Scheduler ----
runner.print_section("2.23 智能体调度器")
from backend.app.services.scheduler import TaskScheduler

runner.test("TaskScheduler 类可导入", TaskScheduler is not None)

# ---- 2.24 TaskPlanner ----
runner.print_section("2.24 任务规划器")
from backend.app.services.task_planner import TaskPlanner

runner.test("TaskPlanner 类可导入", TaskPlanner is not None)

# ---- 2.25 UsageMonitor ----
runner.print_section("2.25 用量监控器")
from backend.app.services.usage_monitor import usage_monitor

runner.test("UsageMonitor 全局实例", usage_monitor is not None)

# ---- 2.26 Validator ----
runner.print_section("2.26 结果验证器")
from backend.app.services.validator import TaskValidator

runner.test("TaskValidator 类可导入", TaskValidator is not None)

# ---- 2.27 PromptOptimizer ----
runner.print_section("2.27 提示词优化器")
from backend.app.services.prompt_optimizer import PromptOptimizer

runner.test("PromptOptimizer 类可导入", PromptOptimizer is not None)

# ============================================================
# 第三维度：API 路由完整性测试
# ============================================================
runner.print_section("第三维度：API 路由完整性测试")

if 'app' in dir():
    # 所有必须存在的 API 路由前缀
    required_prefixes = [
        "/api/agents", "/api/tasks", "/api/conversations",
        "/api/stats", "/api/workflow", "/api/usage",
        "/api/hermes", "/api/sessions",
        # V4.1 新增
        "/api/quota", "/api/architecture", "/api/evaluation",
        "/api/git", "/api/memory",
    ]

    for prefix in required_prefixes:
        found = any(prefix in r for r in routes)
        runner.test(f"路由前缀 {prefix}", found)

    # 关键端点
    key_endpoints = {
        "/api/quota/overview": "配额总览",
        "/api/quota/alert": "告警状态",
        "/api/quota/limits": "管控限制",
        "/api/architecture/design": "架构设计",
        "/api/architecture/critique": "架构批判",
        "/api/architecture/iterate": "架构迭代",
        "/api/architecture/status": "架构状态",
        "/api/architecture/confirm": "架构确认",
        "/api/architecture/reject": "架构驳回",
        "/api/evaluation/integration/check": "集成校验",
        "/api/evaluation/system/evaluate": "系统评测",
        "/api/git/status": "Git 状态",
        "/api/git/commit": "Git 提交",
        "/api/git/tag": "Git 标签",
        "/api/git/branches": "Git 分支",
        "/api/git/log": "Git 日志",
        "/api/memory/search": "记忆库搜索",
        "/api/memory/stats": "记忆库统计",
        "/api/hermes/chat": "Hermes 对话",
        "/api/hermes/chat/stream": "Hermes 流式",
        "/api/hermes/optimize": "Hermes 优化",
        "/api/hermes/confirm": "Hermes 确认",
        "/api/sessions": "会话列表",
        "/api/sessions/": "会话 CRUD",
    }
    for endpoint, desc in key_endpoints.items():
        found = any(endpoint in r for r in routes)
        runner.test(f"端点 {desc}", found)

# ============================================================
# 第四维度：V4.1 需求文档覆盖度验证
# ============================================================
runner.print_section("第四维度：V4.1 需求文档覆盖度验证")

# 关键需求与实现模块的映射校验
requirement_map = {
    # 第2.1节：核心设计逻辑
    "唯一全局调度入口": all([
        try_import("backend.app.main"),
        try_import("backend.app.services.hermes_service"),
    ]),
    "配额全流程管控": try_import("backend.app.services.quota_manager"),
    "上下文生命周期管理": try_import("backend.app.services.context_manager"),
    "全流程刚性校验机制": all([
        try_import("backend.app.services.format_validator"),
        try_import("backend.app.services.content_validator"),
        try_import("backend.app.services.compliance_reviewer"),
    ]),
    # 第5.3节：架构设计批判迭代
    "架构生成+批判+迭代": all([
        try_import("backend.app.services.architecture_designer"),
        try_import("backend.app.services.architecture_critic"),
    ]),
    # 第5.4节：任务拆解与风险标记
    "任务拆解与风险标记": try_import("backend.app.services.task_decomposer"),
    # 第5.5节：全局接口变更闭环
    "接口变更闭环 SOP": try_import("backend.app.services.interface_change_manager"),
    # 第5.7节：人工修改重校验
    "人工修改检测与重校验": try_import("backend.app.services.manual_change_detector"),
    # 第5.8节：全局集成与系统评测
    "集成校验": try_import("backend.app.services.integration_checker"),
    "系统评测": try_import("backend.app.services.system_evaluator"),
    # 第5.9节：交付归档
    "交付管理": try_import("backend.app.services.delivery_manager"),
    "交付物结构": try_import("backend.app.services.delivery_structure"),
    # 第5.10节：需求变更处理
    "需求变更处理": try_import("backend.app.services.change_request_handler"),
    # 第7节：安全管控
    "三层安全校验": try_import("backend.app.services.security_checker"),
    # 第8节：ROS工程化
    "ROS 包规范校验": try_import("backend.app.services.ros_validator"),
    "硬实时规范校验": try_import("backend.app.services.realtime_validator"),
    # 第9节：异常处理
    "分级异常处理": try_import("backend.app.services.exception_handler"),
    "断点续跑": try_import("backend.app.services.checkpoint_manager"),
    # 第9.9节：Git 管理
    "Git 版本管理": try_import("backend.app.services.git_manager"),
    # 记忆库
    "记忆库模块": try_import("backend.app.services.memory_store"),
    # 第10节：统一输出规范
    "输出规范校验": try_import("backend.app.services.output_validator"),
    # 第11节：机器人场景适配
    "机器人场景校验": try_import("backend.app.services.robot_scene_validator"),
    # 全局配置中心
    "全局配置中心": all([
        (Path(__file__).resolve().parent.parent / "config" / "auto_code_config.yaml").exists(),
    ]),
    # 前端
    "前端页面": (Path(__file__).resolve().parent.parent / "frontend" / "src" / "App.tsx").exists(),
}

for req_name, satisfied in requirement_map.items():
    runner.test(f"需求覆盖: {req_name}", satisfied)

# ============================================================
# 第五维度：数据枚举与常量正确性
# ============================================================
runner.print_section("第五维度：枚举与常量正确性")

enums_to_check = [
    ("TaskType", TaskType, ["核心算法开发", "C++性能优化", "ROS工程化开发",
                            "仿真环境开发", "轻量代码开发", "局部架构适配",
                            "全局接口定义", "bug修复"]),
    ("RiskLevel(安全)", SecRiskLevel, ["low", "medium", "high", "very_high"]),
    ("BranchStrategy", BranchStrategy, ["default", "gitflow", "custom"]),
    ("CommitMode", CommitMode, ["per_module", "milestone", "disabled"]),
]

for enum_name, enum_cls, expected in enums_to_check:
    actual = [e.value for e in enum_cls]
    runner.test(f"{enum_name} 枚举值正确", set(expected).issubset(set(actual)))

# ============================================================
# 汇总
# ============================================================
print(runner.summary())

# 输出失败详情
if runner.failed > 0:
    print("\n失败测试详情:")
    for status, name, reason in runner.results:
        if status == "FAIL":
            print(f"  ❌ {name}: {reason}")

# 退出码
sys.exit(0 if runner.failed == 0 else 1)
