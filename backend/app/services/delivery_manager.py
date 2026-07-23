"""
# ============================================================
# 交付管理服务（V4.1 新增）
# ============================================================
# 核心作用：管理开发全流程的最终交付环节，包括人工仿真验证跟踪、
#           混合问题分级处理、全流程产物归档、CHANGELOG 生成、
#           标准化目录结构组织、交付完整性校验
# 运行流程：
#   1. 接收任务完成通知，跟踪人工仿真验证状态
#   2. 接收混合问题列表，按影响范围分级路由处理
#   3. 会话完成后归档所有流程产物（需求、架构、测试报告、评测报告、安全审查记录）
#   4. 根据变更内容生成语义化版本 CHANGELOG
#   5. 按项目类型组织标准化交付目录结构
#   6. 校验交付物完整性，确保所有必需文件存在
# 输入参数：
#   - task_id: str，任务 ID
#   - session_id: str，会话 ID
#   - project_type: str，项目类型（ros/ros2/web/python 等）
# 输出结果：交付状态、归档路径、CHANGELOG 文本、完整性校验报告
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现交付管理、问题分级处理、
#     归档、CHANGELOG 生成、目录组织、完整性校验六大模块
# ============================================================
"""

import hashlib
import json
import logging
import os
import shutil
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class SimulationStatus(str, Enum):
    """
    人工仿真验证状态枚举
    取值：
      - PENDING: 等待人工验证
      - IN_PROGRESS: 验证进行中
      - PASSED: 验证通过
      - FAILED: 验证未通过，需返工
      - SKIPPED: 已跳过（非必需验证项）
    """
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    PASSED = "passed"
    FAILED = "failed"
    SKIPPED = "skipped"


class IssueScope(str, Enum):
    """
    问题影响范围枚举
    取值：
      - ARCHITECTURE: 架构级问题（影响整体设计）
      - SINGLE_MODULE: 单模块问题（仅影响一个模块）
      - MULTI_MODULE: 多模块问题（影响多个模块但非架构级）
    """
    ARCHITECTURE = "architecture"
    SINGLE_MODULE = "single_module"
    MULTI_MODULE = "multi_module"


class ChangelogCategory(str, Enum):
    """
    CHANGELOG 变更分类枚举（遵循语义化版本规范）
    取值：
      - ADDED: 新增功能
      - CHANGED: 功能变更/优化
      - FIXED: 问题修复
      - DEPRECATED: 即将废弃的功能
      - REMOVED: 已移除的功能
      - SECURITY: 安全相关修复
    """
    ADDED = "Added"
    CHANGED = "Changed"
    FIXED = "Fixed"
    DEPRECATED = "Deprecated"
    REMOVED = "Removed"
    SECURITY = "Security"


class ProjectType(str, Enum):
    """
    项目类型枚举
    取值：
      - ROS: ROS1 项目
      - ROS2: ROS2 项目
      - WEB: Web 前端项目
      - PYTHON: 纯 Python 项目
      - CPP: 纯 C++ 项目
      - MIXED: 混合语言项目
    """
    ROS = "ros"
    ROS2 = "ros2"
    WEB = "web"
    PYTHON = "python"
    CPP = "cpp"
    MIXED = "mixed"


@dataclass
class SimulationRecord:
    """
    人工仿真验证记录数据类
    字段说明：
      - task_id: 关联任务 ID
      - status: 当前验证状态
      - assigned_reviewer: 指派的审核人
      - started_at: 验证开始时间
      - completed_at: 验证完成时间
      - result_notes: 验证结果备注
      - attachment_paths: 附件路径列表（截图、日志等）
    """
    task_id: str = ""
    status: SimulationStatus = SimulationStatus.PENDING
    assigned_reviewer: str = ""
    started_at: Optional[float] = None
    completed_at: Optional[float] = None
    result_notes: str = ""
    attachment_paths: List[str] = field(default_factory=list)


@dataclass
class IssueItem:
    """
    问题项数据类
    字段说明：
      - issue_id: 问题唯一 ID
      - description: 问题描述
      - scope: 影响范围（架构/单模块/多模块）
      - affected_modules: 受影响的模块名称列表
      - severity: 严重程度（critical/high/medium/low）
      - source: 问题来源（安全审查/评测/人工反馈等）
    """
    issue_id: str = ""
    description: str = ""
    scope: IssueScope = IssueScope.SINGLE_MODULE
    affected_modules: List[str] = field(default_factory=list)
    severity: str = "medium"
    source: str = ""


@dataclass
class ChangelogEntry:
    """
    CHANGELOG 条目数据类
    字段说明：
      - category: 变更分类
      - description: 变更描述
      - related_modules: 关联模块列表
      - related_issues: 关联问题 ID 列表
    """
    category: ChangelogCategory = ChangelogCategory.CHANGED
    description: str = ""
    related_modules: List[str] = field(default_factory=list)
    related_issues: List[str] = field(default_factory=list)


@dataclass
class DeliveryCheckResult:
    """
    交付完整性校验结果数据类
    字段说明：
      - is_complete: 是否完整
      - missing_files: 缺失文件列表
      - extra_files: 多余文件列表（非标准目录结构中的文件）
      - warnings: 警告信息列表
      - total_required: 必需文件总数
      - total_present: 实际存在文件数
    """
    is_complete: bool = False
    missing_files: List[str] = field(default_factory=list)
    extra_files: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    total_required: int = 0
    total_present: int = 0


# ============================================================
# 交付管理器 - DeliveryManager
# ============================================================

class DeliveryManager:
    """
    交付管理器
    作用：管理开发全流程的最终交付环节，确保交付物完整、合规、可追溯
    调用方：任务执行引擎、API 层（交付接口）、会话管理模块
    被调用方：文件系统、Git 管理器、安全审查模块
    """

    def __init__(self):
        """
        初始化交付管理器
        运行步骤：
          1. 从全局配置读取存储路径参数
          2. 初始化仿真验证记录表
          3. 初始化问题处理记录表
          4. 初始化归档路径映射
          5. 初始化项目类型目录结构模板
        """
        # 从配置读取存储路径
        storage_config = settings.storage
        # 数据存储根目录
        self._data_dir: str = storage_config.get("data_dir", "data")
        # 工作空间根目录
        self._workspace_dir: str = storage_config.get("workspace_dir", "workspace")

        # 项目根目录
        self._project_root: Path = settings.get_project_root()

        # 归档根目录（data/archives）
        self._archive_dir: Path = self._project_root / self._data_dir / "archives"

        # 仿真验证记录：task_id -> SimulationRecord
        self._simulation_records: Dict[str, SimulationRecord] = {}

        # 问题处理记录：issue_id -> 处理结果
        self._issue_handling_records: Dict[str, Dict[str, Any]] = {}

        # 归档路径映射：session_id -> 归档目录路径
        self._archive_paths: Dict[str, Path] = {}

        # 状态变更回调列表
        self._status_callbacks: List[Callable] = []

        # 线程安全锁
        self._lock = threading.Lock()

        # 初始化项目类型目录结构模板
        self._init_directory_templates()

        # 确保归档根目录存在
        self._archive_dir.mkdir(parents=True, exist_ok=True)

        logger.info(
            "交付管理器初始化完成 | 归档目录=%s",
            str(self._archive_dir),
        )

    def _init_directory_templates(self):
        """
        初始化各项目类型的标准化目录结构模板
        运行步骤：
          1. 定义 ROS/ROS2 项目标准目录结构
          2. 定义 Web 前端项目标准目录结构
          3. 定义 Python 项目标准目录结构
          4. 定义 C++ 项目标准目录结构
          5. 定义混合项目标准目录结构
        """
        # ROS/ROS2 项目标准目录结构
        self._ros_template: List[str] = [
            "src/",                         # 源代码目录
            "launch/",                      # 启动文件目录
            "config/",                      # 配置文件目录（yaml 参数文件）
            "msg/",                         # 自定义消息定义
            "srv/",                         # 自定义服务定义
            "action/",                      # 自定义动作定义
            "urdf/",                        # 机器人模型描述文件
            "worlds/",                      # 仿真世界文件
            "docs/",                        # 文档目录
            "docs/需求文档.md",
            "docs/架构设计文档.md",
            "docs/接口规范文档.md",
            "docs/测试报告.md",
            "docs/评测报告.md",
            "docs/安全审查报告.md",
            "docs/部署运行说明.md",
            "docs/CHANGELOG.md",
            "package.xml",                  # ROS 包清单
            "CMakeLists.txt",               # CMake 构建文件
            "README.md",                    # 项目说明
        ]

        # Web 前端项目标准目录结构
        self._web_template: List[str] = [
            "src/",
            "src/components/",
            "src/hooks/",
            "src/types/",
            "src/assets/",
            "public/",
            "docs/",
            "docs/需求文档.md",
            "docs/架构设计文档.md",
            "docs/接口规范文档.md",
            "docs/测试报告.md",
            "docs/评测报告.md",
            "docs/安全审查报告.md",
            "docs/部署运行说明.md",
            "docs/CHANGELOG.md",
            "package.json",
            "tsconfig.json",
            "vite.config.ts",
            "README.md",
        ]

        # Python 项目标准目录结构
        self._python_template: List[str] = [
            "src/",
            "tests/",
            "config/",
            "docs/",
            "docs/需求文档.md",
            "docs/架构设计文档.md",
            "docs/接口规范文档.md",
            "docs/测试报告.md",
            "docs/评测报告.md",
            "docs/安全审查报告.md",
            "docs/部署运行说明.md",
            "docs/CHANGELOG.md",
            "requirements.txt",
            "setup.py",
            "README.md",
        ]

        # C++ 项目标准目录结构
        self._cpp_template: List[str] = [
            "src/",
            "include/",
            "tests/",
            "config/",
            "docs/",
            "docs/需求文档.md",
            "docs/架构设计文档.md",
            "docs/接口规范文档.md",
            "docs/测试报告.md",
            "docs/评测报告.md",
            "docs/安全审查报告.md",
            "docs/部署运行说明.md",
            "docs/CHANGELOG.md",
            "CMakeLists.txt",
            "README.md",
        ]

        # 混合项目标准目录结构（所有类型目录的并集）
        self._mixed_template: List[str] = [
            "src/",
            "include/",
            "tests/",
            "config/",
            "launch/",
            "msg/",
            "srv/",
            "action/",
            "urdf/",
            "worlds/",
            "public/",
            "docs/",
            "docs/需求文档.md",
            "docs/架构设计文档.md",
            "docs/接口规范文档.md",
            "docs/测试报告.md",
            "docs/评测报告.md",
            "docs/安全审查报告.md",
            "docs/部署运行说明.md",
            "docs/CHANGELOG.md",
            "CMakeLists.txt",
            "package.xml",
            "package.json",
            "requirements.txt",
            "README.md",
        ]

        # 项目类型到模板的映射
        self._template_map: Dict[ProjectType, List[str]] = {
            ProjectType.ROS: self._ros_template,
            ProjectType.ROS2: self._ros_template,
            ProjectType.WEB: self._web_template,
            ProjectType.PYTHON: self._python_template,
            ProjectType.CPP: self._cpp_template,
            ProjectType.MIXED: self._mixed_template,
        }

    # ============================================================
    # 1. 人工仿真验证跟踪
    # ============================================================

    def track_simulation_verification(
        self, task_id: str, status: str
    ) -> SimulationRecord:
        """
        跟踪人工仿真验证状态
        运行步骤：
          1. 查找或创建仿真验证记录
          2. 更新验证状态
          3. 记录状态变更时间戳
          4. 触发状态变更回调通知
        参数：
          - task_id: 任务 ID
          - status: 验证状态字符串（pending/in_progress/passed/failed/skipped）
        返回值：SimulationRecord，更新后的验证记录
        """
        # 将字符串状态转换为枚举
        try:
            sim_status = SimulationStatus(status)
        except ValueError:
            logger.warning(
                "无效的仿真验证状态: %s，默认设为 pending", status,
            )
            sim_status = SimulationStatus.PENDING

        with self._lock:
            # 查找或创建记录
            if task_id not in self._simulation_records:
                self._simulation_records[task_id] = SimulationRecord(
                    task_id=task_id,
                    status=sim_status,
                )
                logger.info(
                    "创建仿真验证记录 | task=%s status=%s",
                    task_id[:8] if task_id else "N/A",
                    sim_status.value,
                )
            else:
                old_status = self._simulation_records[task_id].status
                self._simulation_records[task_id].status = sim_status
                logger.info(
                    "更新仿真验证状态 | task=%s %s → %s",
                    task_id[:8] if task_id else "N/A",
                    old_status.value, sim_status.value,
                )

            record = self._simulation_records[task_id]

            # 记录状态变更时间戳
            now = time.time()
            if sim_status == SimulationStatus.IN_PROGRESS and record.started_at is None:
                record.started_at = now
            elif sim_status in (
                SimulationStatus.PASSED,
                SimulationStatus.FAILED,
                SimulationStatus.SKIPPED,
            ):
                record.completed_at = now

        # 触发状态变更回调
        self._notify_status_change(task_id, sim_status)

        return record

    def get_simulation_status(self, task_id: str) -> Optional[SimulationRecord]:
        """
        获取任务的仿真验证状态
        参数：
          - task_id: 任务 ID
        返回值：SimulationRecord 或 None（未找到记录）
        """
        return self._simulation_records.get(task_id)

    def get_pending_simulations(self) -> List[SimulationRecord]:
        """
        获取所有待验证的仿真记录
        返回值：SimulationRecord 列表
        """
        return [
            r for r in self._simulation_records.values()
            if r.status == SimulationStatus.PENDING
        ]

    def assign_reviewer(self, task_id: str, reviewer: str):
        """
        为仿真验证指派审核人
        参数：
          - task_id: 任务 ID
          - reviewer: 审核人标识
        """
        with self._lock:
            if task_id in self._simulation_records:
                self._simulation_records[task_id].assigned_reviewer = reviewer
                logger.info(
                    "指派仿真审核人 | task=%s reviewer=%s",
                    task_id[:8] if task_id else "N/A", reviewer,
                )

    # ============================================================
    # 2. 混合问题分级处理
    # ============================================================

    def handle_mixed_issues(self, issues: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        分级处理混合问题列表
        运行步骤：
          1. 遍历问题列表，按影响范围分级
          2. 架构级问题 → 路由到架构迭代流程
          3. 单模块问题 → 路由到编码智能体修复
          4. 多模块问题 → 确认修复计划后拆分执行
          5. 汇总处理结果
        参数：
          - issues: 问题字典列表，每个问题包含 issue_id、description、scope、affected_modules、severity、source
        返回值：处理结果字典
          {
            "total_issues": int,           # 总问题数
            "architecture_issues": int,    # 架构级问题数
            "single_module_issues": int,   # 单模块问题数
            "multi_module_issues": int,    # 多模块问题数
            "routing": {                   # 路由结果
              "architecture_iteration": [...],  # 需架构迭代的问题 ID 列表
              "agent_fix": [...],               # 需智能体修复的问题 ID 列表
              "confirm_and_split": [...],       # 需确认后拆分的问题 ID 列表
            },
            "handled_at": str,             # 处理时间 ISO 格式
          }
        """
        # 解析问题列表为 IssueItem 对象
        parsed_issues: List[IssueItem] = []
        for issue_dict in issues:
            try:
                scope_str = issue_dict.get("scope", "single_module")
                scope = IssueScope(scope_str) if scope_str in [
                    e.value for e in IssueScope
                ] else IssueScope.SINGLE_MODULE

                parsed_issues.append(IssueItem(
                    issue_id=issue_dict.get("issue_id", ""),
                    description=issue_dict.get("description", ""),
                    scope=scope,
                    affected_modules=issue_dict.get("affected_modules", []),
                    severity=issue_dict.get("severity", "medium"),
                    source=issue_dict.get("source", ""),
                ))
            except Exception as e:
                logger.warning("解析问题项失败: %s | 原始数据=%s", e, issue_dict)

        # 按影响范围分级
        arch_issues: List[IssueItem] = []
        single_issues: List[IssueItem] = []
        multi_issues: List[IssueItem] = []

        for issue in parsed_issues:
            if issue.scope == IssueScope.ARCHITECTURE:
                arch_issues.append(issue)
            elif issue.scope == IssueScope.SINGLE_MODULE:
                single_issues.append(issue)
            else:
                multi_issues.append(issue)

        # 构建路由结果
        routing = {
            "architecture_iteration": [
                {
                    "issue_id": i.issue_id,
                    "description": i.description,
                    "severity": i.severity,
                }
                for i in arch_issues
            ],
            "agent_fix": [
                {
                    "issue_id": i.issue_id,
                    "description": i.description,
                    "affected_modules": i.affected_modules,
                    "severity": i.severity,
                }
                for i in single_issues
            ],
            "confirm_and_split": [
                {
                    "issue_id": i.issue_id,
                    "description": i.description,
                    "affected_modules": i.affected_modules,
                    "severity": i.severity,
                }
                for i in multi_issues
            ],
        }

        # 记录处理结果
        for issue in parsed_issues:
            self._issue_handling_records[issue.issue_id] = {
                "scope": issue.scope.value,
                "handled_at": datetime.now(timezone.utc).isoformat(),
                "route": (
                    "architecture_iteration" if issue.scope == IssueScope.ARCHITECTURE
                    else "agent_fix" if issue.scope == IssueScope.SINGLE_MODULE
                    else "confirm_and_split"
                ),
            }

        result = {
            "total_issues": len(parsed_issues),
            "architecture_issues": len(arch_issues),
            "single_module_issues": len(single_issues),
            "multi_module_issues": len(multi_issues),
            "routing": routing,
            "handled_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "混合问题分级处理完成 | 总计=%d 架构=%d 单模块=%d 多模块=%d",
            result["total_issues"],
            result["architecture_issues"],
            result["single_module_issues"],
            result["multi_module_issues"],
        )

        return result

    def get_issue_handling_record(self, issue_id: str) -> Optional[Dict[str, Any]]:
        """
        获取问题处理记录
        参数：
          - issue_id: 问题 ID
        返回值：处理记录字典或 None
        """
        return self._issue_handling_records.get(issue_id)

    # ============================================================
    # 3. 全流程产物归档
    # ============================================================

    def archive_full_process(self, session_id: str) -> Dict[str, Any]:
        """
        归档会话全流程产物
        运行步骤：
          1. 创建会话专属归档目录
          2. 收集需求文档（从工作空间或数据库）
          3. 收集架构设计文档
          4. 收集测试报告
          5. 收集评测报告
          6. 收集安全审查记录
          7. 生成归档清单索引文件
        参数：
          - session_id: 会话 ID
        返回值：归档结果字典
          {
            "success": bool,
            "archive_path": str,         # 归档目录路径
            "archived_items": List[str], # 已归档的产物列表
            "missing_items": List[str],  # 缺失的产物列表
            "archive_size_bytes": int,   # 归档总大小
            "archived_at": str,          # 归档时间 ISO 格式
          }
        """
        # 创建会话专属归档目录
        archive_path = self._archive_dir / session_id
        archive_path.mkdir(parents=True, exist_ok=True)

        # 记录归档路径
        self._archive_paths[session_id] = archive_path

        archived_items: List[str] = []
        missing_items: List[str] = []
        total_size: int = 0

        # 需要归档的产物类型列表
        artifact_types = [
            ("需求文档", "requirements", ["需求文档.md", "requirements.md"]),
            ("架构设计文档", "architecture", ["架构设计文档.md", "architecture.md"]),
            ("接口规范文档", "interface_spec", ["接口规范文档.md", "interface_spec.md"]),
            ("测试报告", "test_report", ["测试报告.md", "test_report.md"]),
            ("评测报告", "evaluation_report", ["评测报告.md", "evaluation_report.md"]),
            ("安全审查报告", "security_review", ["安全审查报告.md", "security_review.md"]),
            ("部署运行说明", "deployment_guide", ["部署运行说明.md", "deployment_guide.md"]),
            ("CHANGELOG", "changelog", ["CHANGELOG.md"]),
        ]

        # 搜索工作空间中的产物文件
        workspace_path = self._project_root / self._workspace_dir
        docs_dir = self._project_root / "docs"

        for artifact_name, artifact_key, file_names in artifact_types:
            found = False
            # 先在 docs 目录查找
            for fname in file_names:
                candidate = docs_dir / fname
                if candidate.exists():
                    # 复制到归档目录
                    dest = archive_path / fname
                    shutil.copy2(str(candidate), str(dest))
                    archived_items.append(artifact_name)
                    total_size += candidate.stat().st_size
                    found = True
                    logger.info("归档产物: %s → %s", fname, str(dest))
                    break

            if not found:
                # 在工作空间目录查找
                for fname in file_names:
                    for root, dirs, files in os.walk(str(workspace_path)):
                        if fname in files:
                            src = Path(root) / fname
                            dest = archive_path / fname
                            shutil.copy2(str(src), str(dest))
                            archived_items.append(artifact_name)
                            total_size += src.stat().st_size
                            found = True
                            logger.info("归档产物: %s → %s", str(src), str(dest))
                            break
                    if found:
                        break

            if not found:
                missing_items.append(artifact_name)
                logger.warning("归档缺失产物: %s（会话=%s）", artifact_name, session_id[:8])

        # 生成归档清单索引文件
        index_content = self._generate_archive_index(
            session_id, archived_items, missing_items,
        )
        index_path = archive_path / "归档清单.json"
        with open(str(index_path), "w", encoding="utf-8") as f:
            json.dump(index_content, f, ensure_ascii=False, indent=2)
        total_size += index_path.stat().st_size

        result = {
            "success": True,
            "archive_path": str(archive_path),
            "archived_items": archived_items,
            "missing_items": missing_items,
            "archive_size_bytes": total_size,
            "archived_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "全流程产物归档完成 | session=%s 已归档=%d 缺失=%d 大小=%d bytes",
            session_id[:8] if session_id else "N/A",
            len(archived_items), len(missing_items), total_size,
        )

        return result

    def _generate_archive_index(
        self, session_id: str, archived: List[str], missing: List[str],
    ) -> Dict[str, Any]:
        """
        生成归档清单索引文件内容
        参数：
          - session_id: 会话 ID
          - archived: 已归档产物列表
          - missing: 缺失产物列表
        返回值：索引字典
        """
        return {
            "session_id": session_id,
            "archived_at": datetime.now(timezone.utc).isoformat(),
            "total_archived": len(archived),
            "total_missing": len(missing),
            "archived_items": archived,
            "missing_items": missing,
            "completeness": (
                "完整" if len(missing) == 0
                else f"部分缺失（{len(missing)} 项）"
            ),
        }

    def get_archive_path(self, session_id: str) -> Optional[Path]:
        """
        获取会话归档目录路径
        参数：
          - session_id: 会话 ID
        返回值：Path 或 None
        """
        return self._archive_paths.get(session_id)

    # ============================================================
    # 4. CHANGELOG 生成
    # ============================================================

    def generate_changelog(
        self, version: str, changes: List[Dict[str, Any]],
    ) -> str:
        """
        生成语义化版本 CHANGELOG
        运行步骤：
          1. 解析版本号（MAJOR.MINOR.PATCH）
          2. 按分类（Added/Changed/Fixed/Deprecated/Removed/Security）分组变更
          3. 生成 Markdown 格式的 CHANGELOG 文本
          4. 包含版本号、发布日期、分类变更列表
        参数：
          - version: 版本号字符串（如 "1.2.3"）
          - changes: 变更条目列表，每项包含 category、description、related_modules、related_issues
        返回值：Markdown 格式的 CHANGELOG 文本
        """
        # 解析版本号
        version_parts = version.split(".")
        if len(version_parts) != 3:
            logger.warning("版本号格式不正确: %s，期望 MAJOR.MINOR.PATCH", version)
            major, minor, patch = "0", "0", "0"
        else:
            major, minor, patch = version_parts

        # 按分类分组变更
        categorized: Dict[ChangelogCategory, List[Dict[str, Any]]] = {
            cat: [] for cat in ChangelogCategory
        }

        for change in changes:
            cat_str = change.get("category", "Changed")
            # 尝试匹配分类
            matched_cat = None
            for cat_enum in ChangelogCategory:
                if cat_enum.value.lower() == cat_str.lower():
                    matched_cat = cat_enum
                    break
            if matched_cat is None:
                matched_cat = ChangelogCategory.CHANGED

            categorized[matched_cat].append(change)

        # 生成 CHANGELOG 文本
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        lines: List[str] = []

        # 标题
        lines.append(f"# CHANGELOG")
        lines.append("")
        lines.append(f"## [{version}] - {today}")
        lines.append("")

        # 按分类输出
        category_order = [
            ChangelogCategory.ADDED,
            ChangelogCategory.CHANGED,
            ChangelogCategory.FIXED,
            ChangelogCategory.DEPRECATED,
            ChangelogCategory.REMOVED,
            ChangelogCategory.SECURITY,
        ]

        for cat in category_order:
            items = categorized[cat]
            if not items:
                continue
            lines.append(f"### {cat.value}")
            for item in items:
                desc = item.get("description", "")
                modules = item.get("related_modules", [])
                issues = item.get("related_issues", [])

                # 构建变更条目行
                entry = f"- {desc}"
                # 添加关联模块信息
                if modules:
                    entry += f"（模块: {', '.join(modules)}）"
                # 添加关联问题 ID
                if issues:
                    entry += f"（关联: {', '.join(issues)}）"
                lines.append(entry)
            lines.append("")

        # 版本链接（语义化版本规范格式）
        lines.append(
            f"[{version}]: https://github.com/project/releases/tag/v{version}"
        )

        changelog_text = "\n".join(lines)

        logger.info(
            "CHANGELOG 生成完成 | 版本=%s 分类数=%d 条目数=%d",
            version,
            sum(1 for cat in category_order if categorized[cat]),
            len(changes),
        )

        return changelog_text

    def save_changelog(self, version: str, changes: List[Dict[str, Any]],
                        output_path: Optional[str] = None) -> str:
        """
        生成并保存 CHANGELOG 到文件
        参数：
          - version: 版本号字符串
          - changes: 变更条目列表
          - output_path: 输出文件路径（可选，默认保存到 docs/CHANGELOG.md）
        返回值：CHANGELOG 文本内容
        """
        changelog_text = self.generate_changelog(version, changes)

        # 确定输出路径
        if output_path is None:
            docs_dir = self._project_root / "docs"
            docs_dir.mkdir(parents=True, exist_ok=True)
            output_path = str(docs_dir / "CHANGELOG.md")

        # 写入文件
        with open(output_path, "w", encoding="utf-8") as f:
            f.write(changelog_text)

        logger.info("CHANGELOG 已保存到: %s", output_path)
        return changelog_text

    # ============================================================
    # 5. 标准化目录结构组织
    # ============================================================

    def organize_delivery_structure(self, project_type: str) -> Dict[str, Any]:
        """
        按项目类型组织标准化交付目录结构
        运行步骤：
          1. 解析项目类型
          2. 获取对应的目录结构模板
          3. 在工作空间下创建标准化目录
          4. 生成缺失目录的占位 .gitkeep 文件
          5. 返回创建结果
        参数：
          - project_type: 项目类型字符串（ros/ros2/web/python/cpp/mixed）
        返回值：组织结果字典
          {
            "success": bool,
            "project_type": str,
            "base_path": str,              # 标准化目录根路径
            "created_dirs": List[str],     # 新创建的目录列表
            "existing_dirs": List[str],    # 已存在的目录列表
            "total_dirs": int,             # 总目录数
          }
        """
        # 解析项目类型
        try:
            ptype = ProjectType(project_type)
        except ValueError:
            logger.warning("未知项目类型: %s，默认使用 mixed", project_type)
            ptype = ProjectType.MIXED

        # 获取目录模板
        template = self._template_map.get(ptype, self._mixed_template)

        # 确定标准化目录根路径
        base_path = self._project_root / self._workspace_dir / f"delivery_{ptype.value}"
        base_path.mkdir(parents=True, exist_ok=True)

        created_dirs: List[str] = []
        existing_dirs: List[str] = []

        for item in template:
            item_path = base_path / item
            if item.endswith("/"):
                # 目录项
                if not item_path.exists():
                    item_path.mkdir(parents=True, exist_ok=True)
                    # 创建 .gitkeep 占位文件
                    gitkeep = item_path / ".gitkeep"
                    gitkeep.touch()
                    created_dirs.append(item)
                    logger.debug("创建目录: %s", str(item_path))
                else:
                    existing_dirs.append(item)
            else:
                # 文件项（仅创建父目录，不创建空文件）
                parent = item_path.parent
                if not parent.exists():
                    parent.mkdir(parents=True, exist_ok=True)

        result = {
            "success": True,
            "project_type": ptype.value,
            "base_path": str(base_path),
            "created_dirs": created_dirs,
            "existing_dirs": existing_dirs,
            "total_dirs": len(template),
        }

        logger.info(
            "标准化目录结构组织完成 | 类型=%s 新建=%d 已存在=%d",
            ptype.value, len(created_dirs), len(existing_dirs),
        )

        return result

    # ============================================================
    # 6. 交付完整性校验
    # ============================================================

    def verify_delivery_completeness(
        self, delivery_path: str,
    ) -> DeliveryCheckResult:
        """
        校验交付物完整性，确保所有必需文件存在
        运行步骤：
          1. 验证交付路径存在
          2. 自动检测项目类型
          3. 获取对应的必需文件清单
          4. 逐一检查必需文件是否存在
          5. 检测多余的非标准文件
          6. 生成完整性校验报告
        参数：
          - delivery_path: 交付目录路径
        返回值：DeliveryCheckResult，完整性校验结果
        """
        path = Path(delivery_path)
        result = DeliveryCheckResult()

        # 验证路径存在
        if not path.exists():
            result.warnings.append(f"交付路径不存在: {delivery_path}")
            logger.error("交付完整性校验失败: 路径不存在 %s", delivery_path)
            return result

        # 自动检测项目类型
        detected_type = self._detect_project_type(path)
        logger.info("检测到项目类型: %s（路径=%s）", detected_type.value, delivery_path)

        # 获取对应的目录模板
        template = self._template_map.get(detected_type, self._mixed_template)

        # 收集模板中所有文件项（非目录项）
        required_files: List[str] = [
            item for item in template if not item.endswith("/")
        ]
        result.total_required = len(required_files)

        # 检查必需文件
        for rel_path in required_files:
            full_path = path / rel_path
            if full_path.exists():
                result.total_present += 1
            else:
                result.missing_files.append(rel_path)
                logger.warning("缺失必需文件: %s", rel_path)

        # 检测多余的非标准文件（仅检测 docs 目录）
        docs_path = path / "docs"
        if docs_path.exists():
            standard_docs_files = set(
                item.replace("docs/", "") for item in required_files
                if item.startswith("docs/")
            )
            for f in docs_path.iterdir():
                if f.is_file() and f.name not in standard_docs_files:
                    # 排除 .gitkeep 等占位文件
                    if not f.name.startswith("."):
                        result.extra_files.append(str(f.relative_to(path)))

        # 判断完整性
        result.is_complete = (
            len(result.missing_files) == 0
            and len(result.warnings) == 0
        )

        if result.is_complete:
            logger.info(
                "交付完整性校验通过 | 必需文件=%d/%d",
                result.total_present, result.total_required,
            )
        else:
            logger.warning(
                "交付完整性校验未通过 | 缺失=%d 警告=%d",
                len(result.missing_files), len(result.warnings),
            )

        return result

    def _detect_project_type(self, path: Path) -> ProjectType:
        """
        自动检测项目类型
        运行步骤：
          1. 检查是否存在 package.xml（ROS/ROS2 项目）
          2. 检查是否存在 package.json（Web 前端项目）
          3. 检查是否存在 CMakeLists.txt（C++ 项目）
          4. 检查是否存在 requirements.txt / setup.py（Python 项目）
          5. 综合判断项目类型
        参数：
          - path: 项目根目录路径
        返回值：ProjectType 枚举值
        """
        has_package_xml = (path / "package.xml").exists()
        has_cmake = (path / "CMakeLists.txt").exists()
        has_package_json = (path / "package.json").exists()
        has_requirements = (path / "requirements.txt").exists()
        has_setup_py = (path / "setup.py").exists()
        has_tsconfig = (path / "tsconfig.json").exists()

        # ROS/ROS2 项目：有 package.xml
        if has_package_xml:
            # 进一步判断 ROS1 还是 ROS2
            if has_cmake:
                # 检查 CMakeLists.txt 中是否有 ament_cmake（ROS2 特征）
                try:
                    cmake_content = (path / "CMakeLists.txt").read_text()
                    if "ament_cmake" in cmake_content or "ament_package" in cmake_content:
                        return ProjectType.ROS2
                except Exception:
                    pass
                return ProjectType.ROS
            return ProjectType.ROS

        # Web 前端项目：有 package.json + tsconfig.json
        if has_package_json and has_tsconfig:
            return ProjectType.WEB

        # C++ 项目：有 CMakeLists.txt 但无 package.xml
        if has_cmake:
            return ProjectType.CPP

        # Python 项目：有 requirements.txt 或 setup.py
        if has_requirements or has_setup_py:
            return ProjectType.PYTHON

        # 默认：混合项目
        return ProjectType.MIXED

    # ============================================================
    # 工具方法
    # ============================================================

    def register_status_callback(self, callback: Callable):
        """
        注册状态变更回调函数
        参数：
          callback: 回调函数，签名为 (task_id: str, status: SimulationStatus) -> None
        """
        self._status_callbacks.append(callback)

    def _notify_status_change(self, task_id: str, status: SimulationStatus):
        """
        通知所有注册的回调函数状态变更
        参数：
          - task_id: 任务 ID
          - status: 新状态
        """
        for callback in self._status_callbacks:
            try:
                callback(task_id, status)
            except Exception as e:
                logger.error("状态变更回调执行失败: %s", e)

    def get_delivery_summary(self, session_id: str) -> Dict[str, Any]:
        """
        获取会话交付摘要
        参数：
          - session_id: 会话 ID
        返回值：交付摘要字典
        """
        archive_path = self._archive_paths.get(session_id)
        return {
            "session_id": session_id,
            "has_archive": archive_path is not None,
            "archive_path": str(archive_path) if archive_path else None,
            "pending_simulations": len(self.get_pending_simulations()),
            "total_issue_records": len(self._issue_handling_records),
        }


# ============================================================
# 全局单例实例
# ============================================================

# 交付管理器全局单例
delivery_manager = DeliveryManager()
