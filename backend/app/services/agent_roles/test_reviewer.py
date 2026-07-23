"""
# ============================================================
# 测试审查智能体
# ============================================================
# 核心定位：代码测试审查官
# 核心作用：在所有模块代码编写完成后，对项目进行全面的测试审查，
#           覆盖代码完整性、编译检查、依赖检查、接口检查、验收标准
#           检查五个维度
# 运行流程：
#   1. 接收 workflow_id，从工作流中收集所有模块代码变更
#   2. 依次执行 5 个维度的审查：
#      a. 代码完整性检查：所有 checklist 项是否都有对应代码文件
#      b. 编译检查：项目是否能成功编译
#      c. 依赖检查：模块间依赖关系是否正确
#      d. 接口检查：模块间接口是否匹配
#      e. 验收标准检查：是否满足任务需求文档中的验收标准
#   3. 汇总各维度结果，生成 TestReviewReport
# 输入参数：
#   - workflow_id: str，工作流 ID
# 输出结果：TestReviewReport 对象
# 修改记录：
#   - 2026-06-26 | v1.0.0 | 初始创建
# ============================================================
"""

import logging
import os
from typing import List, Dict, Any, Optional
from dataclasses import dataclass, field

from sqlalchemy import select

logger = logging.getLogger(__name__)


# ============================================================
# System Prompt 定义
# ============================================================

TEST_REVIEWER_SYSTEM_PROMPT = """你是一个专业的代码测试审查智能体。你的职责是在所有模块代码编写完成后，对项目进行全面的测试审查。

## 审查维度
1. 代码完整性：所有 checklist 项是否都有对应的代码实现
2. 编译检查：项目是否能成功编译
3. 依赖检查：模块间的依赖关系是否正确
4. 接口检查：模块间的接口是否匹配
5. 验收标准检查：是否满足任务需求文档中的验收标准

## 输出格式
对每个维度输出：通过/失败 + 详细说明
"""


# ============================================================
# 数据类定义
# ============================================================

@dataclass
class TestReviewReport:
    """
    测试审查报告
    字段说明：
      - all_passed: 所有检查是否全部通过
      - check_results: 各项检查结果列表，每项包含 {name, passed, details}
      - failed_items: 未通过的检查项列表
      - summary: 审查总结
    """
    all_passed: bool = False
    check_results: List[Dict[str, Any]] = field(default_factory=list)
    failed_items: List[Dict[str, Any]] = field(default_factory=list)
    summary: str = ""


# ============================================================
# TestReviewer 类
# ============================================================

class TestReviewer:
    """
    测试审查智能体
    作用：在所有模块代码编写完成后，对项目进行全面的测试审查
    调用方：工作流引擎（reviewing 阶段）
    被调用方：HermesService（AI 审查执行）、GitManager（代码变更获取）
    """

    # 常见构建文件列表，用于编译检查
    BUILD_FILE_PATTERNS = [
        "CMakeLists.txt", "setup.py", "setup.cfg", "pyproject.toml",
        "package.json", "Makefile", "Cargo.toml", "go.mod",
        "build.gradle", "pom.xml", "meson.build", "BUILD",
    ]

    def __init__(self, hermes_service, git_manager):
        """
        初始化测试审查智能体
        参数：
          - hermes_service: HermesService 实例，用于执行 AI 审查
          - git_manager: GitManager 实例，用于获取代码变更信息
        """
        self.hermes_service = hermes_service
        self.git_manager = git_manager

    def get_system_prompt(self) -> str:
        """获取 system prompt"""
        return TEST_REVIEWER_SYSTEM_PROMPT

    async def review_all_modules(self, workflow_id: str) -> TestReviewReport:
        """
        对工作流中所有模块进行全维度测试审查
        运行步骤：
          1. 从数据库加载工作流数据（checklist、task、acceptance 文档、阶段输出）
          2. 通过 GitManager 获取当前工作区的代码变更
          3. 依次执行 5 个维度的审查
          4. 汇总结果生成 TestReviewReport
        参数：
          - workflow_id: 工作流 ID
        返回值：TestReviewReport 对象
        """
        report = TestReviewReport()
        check_results: List[Dict[str, Any]] = []

        # ---- 步骤 1：加载工作流数据 ----
        workflow_data = await self._load_workflow_data(workflow_id)
        if workflow_data is None:
            report.summary = f"无法加载工作流数据: {workflow_id}"
            report.check_results = [{
                "name": "数据加载",
                "passed": False,
                "details": f"工作流 {workflow_id} 不存在或无法访问"
            }]
            report.failed_items = report.check_results
            return report

        # ---- 步骤 2：收集代码变更 ----
        code_changes = self._collect_code_changes()

        # ---- 步骤 3：执行 5 个维度审查 ----
        # a. 代码完整性检查
        completeness_result = await self._check_code_completeness(
            workflow_data, code_changes
        )
        check_results.append(completeness_result)

        # b. 编译检查
        build_result = await self._check_compilation(
            workflow_data, code_changes
        )
        check_results.append(build_result)

        # c. 依赖检查
        dependency_result = await self._check_dependencies(
            workflow_data, code_changes
        )
        check_results.append(dependency_result)

        # d. 接口检查
        interface_result = await self._check_interfaces(
            workflow_data, code_changes
        )
        check_results.append(interface_result)

        # e. 验收标准检查
        acceptance_result = await self._check_acceptance_criteria(
            workflow_data, code_changes
        )
        check_results.append(acceptance_result)

        # ---- 步骤 4：汇总结果 ----
        report.check_results = check_results
        report.failed_items = [r for r in check_results if not r.get("passed", False)]
        report.all_passed = len(report.failed_items) == 0

        if report.all_passed:
            report.summary = "所有 5 个维度的测试审查全部通过，项目代码质量合格。"
        else:
            failed_names = [r["name"] for r in report.failed_items]
            report.summary = f"测试审查未通过，共 {len(report.failed_items)} 个维度未通过：{', '.join(failed_names)}"

        logger.info(
            f"测试审查完成: workflow={workflow_id[:8]}..., "
            f"all_passed={report.all_passed}, "
            f"failed_count={len(report.failed_items)}"
        )
        return report

    # ============================================================
    # 数据加载与收集
    # ============================================================

    async def _load_workflow_data(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """
        从数据库加载工作流数据
        运行步骤：
          1. 通过 hermes_service 的 session_factory 获取数据库会话
          2. 查询 Workflow 记录
          3. 查询关联的 WorkflowStage 记录
          4. 组装返回数据字典
        参数：
          - workflow_id: 工作流 ID
        返回值：工作流数据字典，若不存在则返回 None
        """
        session_factory = getattr(self.hermes_service, "session_factory", None)
        if session_factory is None:
            logger.warning("hermes_service 未配置 session_factory，无法加载工作流数据")
            return {
                "workflow_id": workflow_id,
                "checklist_doc": "",
                "task_doc": "",
                "acceptance_doc": "",
                "spec_doc": "",
                "requirement_doc": "",
                "stages": [],
            }

        try:
            from ..models import Workflow, WorkflowStage

            async with session_factory() as db:
                # 查询工作流
                result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = result.scalar_one_or_none()

                if workflow is None:
                    logger.error(f"工作流不存在: {workflow_id}")
                    return None

                # 查询阶段记录
                stages_result = await db.execute(
                    select(WorkflowStage)
                    .where(WorkflowStage.workflow_id == workflow_id)
                    .order_by(WorkflowStage.stage_name)
                )
                stages = stages_result.scalars().all()

                stages_data = []
                for s in stages:
                    stages_data.append({
                        "stage_name": s.stage_name,
                        "status": s.status.value if hasattr(s.status, "value") else str(s.status),
                        "output_doc": s.output_doc or "",
                        "agent_role": s.agent_role or "",
                    })

                return {
                    "workflow_id": workflow.id,
                    "checklist_doc": workflow.checklist_doc or "",
                    "task_doc": workflow.task_doc or "",
                    "acceptance_doc": workflow.acceptance_doc or "",
                    "spec_doc": workflow.spec_doc or "",
                    "requirement_doc": workflow.requirement_doc or "",
                    "stages": stages_data,
                }
        except Exception as e:
            logger.error(f"加载工作流数据异常: {e}")
            return {
                "workflow_id": workflow_id,
                "checklist_doc": "",
                "task_doc": "",
                "acceptance_doc": "",
                "spec_doc": "",
                "requirement_doc": "",
                "stages": [],
            }

    def _collect_code_changes(self) -> Dict[str, Any]:
        """
        通过 GitManager 收集当前工作区的代码变更信息
        运行步骤：
          1. 获取 Git 仓库状态
          2. 收集已修改、已暂存、未跟踪的文件列表
          3. 获取最近提交信息
        返回值：代码变更信息字典
        """
        changes: Dict[str, Any] = {
            "modified_files": [],
            "staged_files": [],
            "untracked_files": [],
            "all_files": [],
            "last_commit": "",
            "is_clean": True,
        }

        try:
            if self.git_manager is None or not self.git_manager.is_available:
                logger.warning("GitManager 不可用，跳过代码变更收集")
                return changes

            status = self.git_manager.get_status()
            changes["modified_files"] = status.modified_files
            changes["staged_files"] = status.staged_files
            changes["untracked_files"] = status.untracked_files
            changes["all_files"] = (
                status.modified_files + status.staged_files + status.untracked_files
            )
            changes["last_commit"] = status.last_commit
            changes["is_clean"] = status.is_clean

            logger.info(
                f"代码变更收集完成: modified={len(status.modified_files)}, "
                f"staged={len(status.staged_files)}, "
                f"untracked={len(status.untracked_files)}"
            )
        except Exception as e:
            logger.error(f"收集代码变更异常: {e}")

        return changes

    # ============================================================
    # 五个维度审查方法
    # ============================================================

    async def _check_code_completeness(
        self, workflow_data: Dict[str, Any], code_changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        代码完整性检查
        检查所有 checklist 项是否都有对应的代码实现
        运行步骤：
          1. 解析 checklist 文档，提取所有待实现项
          2. 对比代码变更文件列表
          3. 通过 AI 分析缺失项
        参数：
          - workflow_data: 工作流数据
          - code_changes: 代码变更信息
        返回值：{name, passed, details}
        """
        checklist = workflow_data.get("checklist_doc", "")
        task_doc = workflow_data.get("task_doc", "")
        all_files = code_changes.get("all_files", [])

        # 如果没有 checklist 且没有代码变更，直接通过
        if not checklist and not all_files:
            return {
                "name": "代码完整性检查",
                "passed": True,
                "details": "无 checklist 且无代码变更，跳过检查"
            }

        # 构建 AI 审查提示词
        files_str = "\n".join(all_files[:100]) if all_files else "（无代码变更文件）"
        prompt = (
            f"{TEST_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 代码完整性检查\n\n"
            f"### Checklist 文档\n{checklist[:4000]}\n\n"
            f"### 任务文档\n{task_doc[:2000]}\n\n"
            f"### 当前代码变更文件列表\n{files_str}\n\n"
            f"请逐一对比 checklist 中的每一项，判断是否都有对应的代码文件实现。\n"
            f"输出格式：\n"
            f"检查结论: 通过/不通过\n"
            f"缺失项: [列表，无则标注'无']\n"
            f"详细说明: [描述]"
        )

        return await self._execute_ai_check("代码完整性检查", prompt)

    async def _check_compilation(
        self, workflow_data: Dict[str, Any], code_changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        编译检查
        检查项目是否能成功编译
        运行步骤：
          1. 扫描项目根目录是否存在常见构建文件
          2. 通过 AI 分析编译可行性
        参数：
          - workflow_data: 工作流数据
          - code_changes: 代码变更信息
        返回值：{name, passed, details}
        """
        # 扫描构建文件
        repo_path = getattr(self.git_manager, "repo_path", os.getcwd())
        found_build_files = []
        for pattern in self.BUILD_FILE_PATTERNS:
            build_path = os.path.join(repo_path, pattern)
            if os.path.exists(build_path):
                found_build_files.append(pattern)

        all_files = code_changes.get("all_files", [])
        spec_doc = workflow_data.get("spec_doc", "")

        # 构建 AI 审查提示词
        build_files_str = ", ".join(found_build_files) if found_build_files else "（未检测到构建文件）"
        files_str = "\n".join(all_files[:100]) if all_files else "（无代码变更文件）"

        prompt = (
            f"{TEST_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 编译检查\n\n"
            f"### 检测到的构建文件\n{build_files_str}\n\n"
            f"### 架构 spec 文档\n{spec_doc[:2000]}\n\n"
            f"### 代码变更文件列表\n{files_str}\n\n"
            f"请分析项目是否能成功编译，检查以下方面：\n"
            f"1. 构建文件是否完整且配置正确\n"
            f"2. 源文件是否都存在且路径正确\n"
            f"3. 是否有明显的语法错误或缺失依赖\n"
            f"输出格式：\n"
            f"检查结论: 通过/不通过\n"
            f"构建文件: [列表]\n"
            f"潜在问题: [列表，无则标注'无']\n"
            f"详细说明: [描述]"
        )

        return await self._execute_ai_check("编译检查", prompt)

    async def _check_dependencies(
        self, workflow_data: Dict[str, Any], code_changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        依赖检查
        检查模块间的依赖关系是否正确
        运行步骤：
          1. 解析 task 文档中的模块划分
          2. 通过 AI 分析模块间依赖关系
        参数：
          - workflow_data: 工作流数据
          - code_changes: 代码变更信息
        返回值：{name, passed, details}
        """
        task_doc = workflow_data.get("task_doc", "")
        spec_doc = workflow_data.get("spec_doc", "")
        all_files = code_changes.get("all_files", [])

        files_str = "\n".join(all_files[:100]) if all_files else "（无代码变更文件）"

        prompt = (
            f"{TEST_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 依赖检查\n\n"
            f"### 任务文档（模块划分）\n{task_doc[:3000]}\n\n"
            f"### 架构 spec 文档\n{spec_doc[:2000]}\n\n"
            f"### 代码变更文件列表\n{files_str}\n\n"
            f"请检查模块间的依赖关系是否正确：\n"
            f"1. 是否存在循环依赖\n"
            f"2. 是否存在缺失依赖\n"
            f"3. 是否存在冗余依赖\n"
            f"4. 依赖版本是否兼容\n"
            f"输出格式：\n"
            f"检查结论: 通过/不通过\n"
            f"循环依赖: [列表，无则标注'无']\n"
            f"缺失依赖: [列表，无则标注'无']\n"
            f"冗余依赖: [列表，无则标注'无']\n"
            f"详细说明: [描述]"
        )

        return await self._execute_ai_check("依赖检查", prompt)

    async def _check_interfaces(
        self, workflow_data: Dict[str, Any], code_changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        接口检查
        检查模块间的接口是否匹配
        运行步骤：
          1. 解析 spec 文档中的接口定义
          2. 通过 AI 分析接口匹配度
        参数：
          - workflow_data: 工作流数据
          - code_changes: 代码变更信息
        返回值：{name, passed, details}
        """
        spec_doc = workflow_data.get("spec_doc", "")
        task_doc = workflow_data.get("task_doc", "")
        all_files = code_changes.get("all_files", [])

        files_str = "\n".join(all_files[:100]) if all_files else "（无代码变更文件）"

        prompt = (
            f"{TEST_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 接口检查\n\n"
            f"### 架构 spec 文档（接口定义）\n{spec_doc[:3000]}\n\n"
            f"### 任务文档\n{task_doc[:2000]}\n\n"
            f"### 代码变更文件列表\n{files_str}\n\n"
            f"请检查模块间的接口是否匹配：\n"
            f"1. 函数签名是否与 spec 定义一致\n"
            f"2. 数据类型是否匹配\n"
            f"3. ROS 话题/服务/动作接口是否一致\n"
            f"4. 调用时序是否正确\n"
            f"输出格式：\n"
            f"检查结论: 通过/不通过\n"
            f"接口不匹配: [列表，无则标注'无']\n"
            f"类型不一致: [列表，无则标注'无']\n"
            f"详细说明: [描述]"
        )

        return await self._execute_ai_check("接口检查", prompt)

    async def _check_acceptance_criteria(
        self, workflow_data: Dict[str, Any], code_changes: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        验收标准检查
        检查是否满足任务需求文档中的验收标准
        运行步骤：
          1. 解析 acceptance 文档中的验收标准
          2. 通过 AI 逐条对比实现情况
        参数：
          - workflow_data: 工作流数据
          - code_changes: 代码变更信息
        返回值：{name, passed, details}
        """
        acceptance_doc = workflow_data.get("acceptance_doc", "")
        requirement_doc = workflow_data.get("requirement_doc", "")
        all_files = code_changes.get("all_files", [])

        files_str = "\n".join(all_files[:100]) if all_files else "（无代码变更文件）"

        prompt = (
            f"{TEST_REVIEWER_SYSTEM_PROMPT}\n\n"
            f"## 验收标准检查\n\n"
            f"### 验收标准文档\n{acceptance_doc[:3000]}\n\n"
            f"### 需求文档\n{requirement_doc[:2000]}\n\n"
            f"### 代码变更文件列表\n{files_str}\n\n"
            f"请逐条检查验收标准是否满足：\n"
            f"1. 功能需求是否全部实现\n"
            f"2. 非功能需求（性能、安全、可靠性）是否达标\n"
            f"3. 安全红线是否覆盖\n"
            f"4. 可量化的验收标准是否通过\n"
            f"输出格式：\n"
            f"检查结论: 通过/不通过\n"
            f"未满足项: [列表，无则标注'无']\n"
            f"详细说明: [描述]"
        )

        return await self._execute_ai_check("验收标准检查", prompt)

    # ============================================================
    # AI 审查执行辅助方法
    # ============================================================

    async def _execute_ai_check(
        self, check_name: str, prompt: str
    ) -> Dict[str, Any]:
        """
        执行 AI 审查并解析结果
        运行步骤：
          1. 调用 hermes_service.executor 执行 AI 审查
          2. 解析输出结果
          3. 返回结构化检查结果
        参数：
          - check_name: 检查项名称
          - prompt: AI 审查提示词
        返回值：{name, passed, details}
        """
        result = {"name": check_name, "passed": False, "details": ""}

        try:
            ai_result = await self.hermes_service.executor.execute(
                command=f'-p "{prompt.replace(chr(34), chr(92)+chr(34)).replace(chr(96), chr(92)+chr(96)).replace(chr(36), chr(92)+chr(36))}"',
                timeout=180,
            )

            if ai_result.success:
                output = ai_result.stdout
                result["details"] = output[:2000]

                # 解析检查结论
                for line in output.split("\n"):
                    line = line.strip()
                    if "检查结论" in line:
                        result["passed"] = "通过" in line
                        break

                logger.info(f"{check_name}: {'通过' if result['passed'] else '不通过'}")
            else:
                result["details"] = f"AI 审查执行失败：{ai_result.error_message}"
                logger.error(f"{check_name} 执行失败: {ai_result.error_message}")

        except Exception as e:
            result["details"] = f"审查异常：{str(e)}"
            logger.error(f"{check_name} 异常: {e}")

        return result
