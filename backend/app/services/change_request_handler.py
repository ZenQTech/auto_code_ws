"""
# ============================================================
# 需求变更处理服务（V4.1 新增）
# ============================================================
# 核心作用：处理开发过程中的需求变更，按核心/局部分级处理，
#           评估变更影响范围，生成影响评估报告，更新受影响任务状态，
#           保留未受影响模块的已完成产物，避免全量作废重复开发
# 运行流程：
#   1. 接收需求变更请求，暂停所有正在执行的任务并记录暂停检查点
#   2. 评估变更影响范围，判定为核心变更还是局部变更
#   3. 生成「需求变更影响范围评估报告」，明确不受影响/需适配/需重建模块
#   4. 核心变更：保留未受影响模块，对受影响模块重新架构
#   5. 局部变更：标记受影响已完成任务为"待更新"，更新待执行任务需求
#   6. 更新受影响任务状态，恢复执行
# 输入参数：
#   - session_id: str，会话 ID
#   - change_request: Dict，变更请求内容
#   - current_state: Dict，当前项目状态（任务列表、模块依赖等）
# 输出结果：影响评估报告、任务状态更新结果、恢复执行状态
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现变更分级处理、影响评估、
#     报告生成、任务状态更新、恢复执行五大模块
#   - 2026-06-29 | v1.0.1 | 将 ChangeType 枚举替换为统一定义模块中的
#     ChangeLevel，导入 is_core_change 判定函数，确保全流程变更分级标准一致
# ============================================================
"""

import logging
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

from backend.app.config import settings
from backend.app.services.standard_definitions import ChangeLevel, is_core_change

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

# ChangeLevel 枚举已统一迁移至 backend.app.services.standard_definitions
# 从该模块导入使用：from backend.app.services.standard_definitions import ChangeLevel
# 取值：
#   - ChangeLevel.CORE: 核心变更（影响整体架构设计、接口规范、全局约束）
#   - ChangeLevel.LOCAL: 局部变更（仅影响部分模块的功能或实现细节）
# 引用标准：Section 5.11 变更分级处理规则


class TaskUpdateAction(str, Enum):
    """
    任务状态更新动作枚举
    取值：
      - KEEP: 保持不变（未受影响）
      - MARK_PENDING_UPDATE: 标记为"待更新"（已完成但需适配）
      - UPDATE_REQUIREMENTS: 更新需求描述（待执行任务）
      - REBUILD: 需要重建（核心变更导致）
      - SKIP: 跳过（已废弃）
    """
    KEEP = "keep"
    MARK_PENDING_UPDATE = "mark_pending_update"
    UPDATE_REQUIREMENTS = "update_requirements"
    REBUILD = "rebuild"
    SKIP = "skip"


class TaskState(str, Enum):
    """
    任务执行状态枚举（用于变更处理）
    取值：
      - NOT_STARTED: 未开始
      - IN_PROGRESS: 执行中
      - COMPLETED: 已完成
      - PAUSED: 已暂停
      - PENDING_UPDATE: 待更新（已完成但需适配变更）
    """
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    PAUSED = "paused"
    PENDING_UPDATE = "pending_update"


@dataclass
class ChangeAssessment:
    """
    变更影响评估数据类
    字段说明：
      - change_type: 变更类型（核心/局部）
      - unaffected_modules: 不受影响的模块列表
      - adapt_modules: 需适配的模块列表（局部变更）
      - rebuild_modules: 需重建的模块列表（核心变更）
      - estimated_quota: 预估配额消耗（API 调用次数）
      - estimated_timeline: 预估时间线（小时）
      - risks: 风险列表
      - dependency_impact: 依赖关系影响分析
    """
    change_type: ChangeLevel = ChangeLevel.LOCAL
    unaffected_modules: List[str] = field(default_factory=list)
    adapt_modules: List[str] = field(default_factory=list)
    rebuild_modules: List[str] = field(default_factory=list)
    estimated_quota: int = 0
    estimated_timeline: float = 0.0
    risks: List[str] = field(default_factory=list)
    dependency_impact: Dict[str, List[str]] = field(default_factory=dict)


@dataclass
class TaskStateRecord:
    """
    任务状态记录数据类
    字段说明：
      - task_id: 任务 ID
      - task_name: 任务名称
      - original_state: 变更前状态
      - updated_state: 变更后状态
      - action: 执行的动作
      - reason: 变更原因
      - checkpoint_data: 暂停时的检查点数据
    """
    task_id: str = ""
    task_name: str = ""
    original_state: TaskState = TaskState.NOT_STARTED
    updated_state: TaskState = TaskState.NOT_STARTED
    action: TaskUpdateAction = TaskUpdateAction.KEEP
    reason: str = ""
    checkpoint_data: Dict[str, Any] = field(default_factory=dict)


@dataclass
class PauseRecord:
    """
    暂停记录数据类
    字段说明：
      - session_id: 会话 ID
      - paused_at: 暂停时间戳
      - paused_task_count: 暂停的任务数量
      - reason: 暂停原因
      - checkpoint_snapshot: 暂停时的状态快照
    """
    session_id: str = ""
    paused_at: float = 0.0
    paused_task_count: int = 0
    reason: str = ""
    checkpoint_snapshot: Dict[str, Any] = field(default_factory=dict)


# ============================================================
# 需求变更处理器 - ChangeRequestHandler
# ============================================================

class ChangeRequestHandler:
    """
    需求变更处理器
    作用：处理开发过程中的需求变更，按核心/局部分级处理，
          评估影响范围，保留已完成产物，避免全量作废
    调用方：API 层（变更请求接口）、会话管理模块、人工干预管理器
    被调用方：任务执行引擎、调度器、架构迭代流程
    """

    def __init__(self):
        """
        初始化需求变更处理器
        运行步骤：
          1. 从全局配置读取架构和评测参数
          2. 初始化暂停记录表
          3. 初始化任务状态记录表
          4. 初始化影响评估缓存
          5. 初始化告警回调列表
        """
        # 从配置读取架构参数
        arch_config = settings.architecture
        # 架构批判最大迭代次数
        self._max_arch_iterations: int = arch_config.get("max_critic_iterations", 3)

        # 从配置读取评测参数
        eval_config = settings.evaluation
        # 评测最大迭代次数
        self._max_eval_iterations: int = eval_config.get("max_iterations", 2)

        # 暂停记录：session_id -> PauseRecord
        self._pause_records: Dict[str, PauseRecord] = {}

        # 任务状态记录：task_id -> TaskStateRecord
        self._task_state_records: Dict[str, TaskStateRecord] = {}

        # 影响评估缓存：change_request_hash -> ChangeAssessment
        self._assessment_cache: Dict[str, ChangeAssessment] = {}

        # 变更历史记录
        self._change_history: List[Dict[str, Any]] = []

        # 告警回调列表
        self._alert_callbacks: List[Callable] = []

        # 线程安全锁
        self._lock = threading.Lock()

        logger.info(
            "需求变更处理器初始化完成 | 架构最大迭代=%d 评测最大迭代=%d",
            self._max_arch_iterations, self._max_eval_iterations,
        )

    # ============================================================
    # 1. 暂停所有任务
    # ============================================================

    def pause_all_tasks(self, session_id: str) -> Dict[str, Any]:
        """
        暂停所有正在执行的任务，记录暂停检查点
        运行步骤：
          1. 收集当前会话下所有正在执行的任务
          2. 逐个暂停任务并保存检查点数据
          3. 记录暂停时间戳和原因
          4. 返回暂停结果
        参数：
          - session_id: 会话 ID
        返回值：暂停结果字典
          {
            "success": bool,
            "session_id": str,
            "paused_task_count": int,
            "paused_task_ids": List[str],
            "paused_at": str,              # ISO 格式暂停时间
            "checkpoint_saved": bool,      # 检查点是否已保存
          }
        """
        with self._lock:
            # 收集该会话下所有任务的当前状态
            paused_task_ids: List[str] = []
            task_snapshots: Dict[str, Any] = {}

            # 遍历任务状态记录，找出所有 IN_PROGRESS 状态的任务
            for task_id, record in self._task_state_records.items():
                if record.original_state == TaskState.IN_PROGRESS:
                    # 保存检查点数据
                    record.checkpoint_data = {
                        "original_state": record.original_state.value,
                        "task_name": record.task_name,
                        "paused_at": time.time(),
                    }
                    record.updated_state = TaskState.PAUSED
                    record.action = TaskUpdateAction.KEEP
                    record.reason = "需求变更暂停"
                    paused_task_ids.append(task_id)
                    task_snapshots[task_id] = record.checkpoint_data

            # 创建暂停记录
            pause_record = PauseRecord(
                session_id=session_id,
                paused_at=time.time(),
                paused_task_count=len(paused_task_ids),
                reason="需求变更处理",
                checkpoint_snapshot=task_snapshots,
            )
            self._pause_records[session_id] = pause_record

        result = {
            "success": True,
            "session_id": session_id,
            "paused_task_count": len(paused_task_ids),
            "paused_task_ids": paused_task_ids,
            "paused_at": datetime.fromtimestamp(pause_record.paused_at).isoformat(),
            "checkpoint_saved": len(task_snapshots) > 0,
        }

        logger.warning(
            "【需求变更】暂停会话 %s 的所有任务 | 暂停数=%d",
            session_id[:8] if session_id else "N/A",
            len(paused_task_ids),
        )

        return result

    def get_pause_record(self, session_id: str) -> Optional[PauseRecord]:
        """
        获取会话的暂停记录
        参数：
          - session_id: 会话 ID
        返回值：PauseRecord 或 None
        """
        return self._pause_records.get(session_id)

    # ============================================================
    # 2. 变更影响评估
    # ============================================================

    def assess_change_impact(
        self, change_request: Dict[str, Any], current_state: Dict[str, Any],
    ) -> ChangeAssessment:
        """
        评估需求变更的影响范围，判定为核心变更还是局部变更
        运行步骤：
          1. 解析变更请求内容，提取变更涉及的模块和接口
          2. 解析当前项目状态，获取已完成/执行中/待执行任务列表
          3. 分析变更是否涉及架构设计、全局接口、核心约束
          4. 涉及架构/全局 → 核心变更
          5. 仅涉及局部模块 → 局部变更
          6. 计算预估配额消耗和时间线
          7. 识别风险点
        参数：
          - change_request: 变更请求字典
            {
              "description": str,              # 变更描述
              "changed_modules": List[str],    # 变更涉及的模块
              "changed_interfaces": List[str], # 变更涉及的接口
              "reason": str,                   # 变更原因
              "priority": str,                 # 变更优先级
            }
          - current_state: 当前项目状态字典
            {
              "modules": List[Dict],           # 模块列表（含状态）
              "tasks": List[Dict],             # 任务列表（含状态）
              "architecture_version": str,     # 架构版本
              "completed_modules": List[str],  # 已完成模块
            }
        返回值：ChangeAssessment，影响评估结果
        """
        # 提取变更信息
        changed_modules = set(change_request.get("changed_modules", []))
        changed_interfaces = set(change_request.get("changed_interfaces", []))
        change_description = change_request.get("description", "")

        # 提取当前状态信息
        all_modules = current_state.get("modules", [])
        all_tasks = current_state.get("tasks", [])
        completed_modules = set(current_state.get("completed_modules", []))
        arch_version = current_state.get("architecture_version", "unknown")

        # 收集所有模块名称
        all_module_names = set()
        for m in all_modules:
            if isinstance(m, dict):
                all_module_names.add(m.get("name", ""))
            elif isinstance(m, str):
                all_module_names.add(m)

        # 判定变更类型
        # 核心变更判定条件：
        #   1. 变更涉及全局接口定义
        #   2. 变更涉及架构设计文档
        #   3. 变更涉及超过 50% 的模块
        #   4. 变更涉及核心约束或安全规范
        is_core_change = False
        core_reasons: List[str] = []

        # 条件 1：涉及全局接口变更
        if changed_interfaces:
            # 检查是否有全局性接口（如 ROS 消息定义、API 协议等）
            global_interface_keywords = ["msg/", "srv/", "action/", "api/", "interface", "protocol"]
            for iface in changed_interfaces:
                for keyword in global_interface_keywords:
                    if keyword in iface.lower():
                        is_core_change = True
                        core_reasons.append(f"涉及全局接口变更: {iface}")
                        break
                if is_core_change:
                    break

        # 条件 2：变更涉及架构设计
        arch_keywords = ["架构", "architecture", "设计模式", "design pattern", "分层", "layer"]
        for keyword in arch_keywords:
            if keyword in change_description.lower():
                is_core_change = True
                core_reasons.append(f"涉及架构设计变更: 包含关键词 '{keyword}'")
                break

        # 条件 3：变更涉及超过 50% 的模块
        if all_module_names:
            affected_ratio = len(changed_modules & all_module_names) / max(len(all_module_names), 1)
            if affected_ratio > 0.5:
                is_core_change = True
                core_reasons.append(
                    f"影响范围超过 50% 模块（{affected_ratio:.0%}）"
                )

        # 条件 4：变更涉及核心约束或安全规范
        constraint_keywords = ["安全", "security", "约束", "constraint", "规范", "standard"]
        for keyword in constraint_keywords:
            if keyword in change_description.lower():
                is_core_change = True
                core_reasons.append(f"涉及核心约束/安全规范变更: 包含关键词 '{keyword}'")
                break

        change_type = ChangeLevel.CORE if is_core_change else ChangeLevel.LOCAL

        # 计算受影响模块
        affected_modules = changed_modules & all_module_names

        # 不受影响的模块 = 所有模块 - 受影响模块
        unaffected_modules = list(all_module_names - affected_modules)

        # 需适配的模块（局部变更时，已完成但受影响的模块）
        adapt_modules = list(affected_modules & completed_modules)

        # 需重建的模块（核心变更时，所有受影响的模块）
        rebuild_modules = list(affected_modules) if is_core_change else []

        # 估算配额消耗
        # 核心变更：每个受影响模块约 200 次 API 调用
        # 局部变更：每个受影响模块约 50 次 API 调用
        per_module_quota = 200 if is_core_change else 50
        estimated_quota = len(affected_modules) * per_module_quota

        # 估算时间线（小时）
        # 核心变更：每个受影响模块约 2 小时
        # 局部变更：每个受影响模块约 0.5 小时
        per_module_hours = 2.0 if is_core_change else 0.5
        estimated_timeline = len(affected_modules) * per_module_hours

        # 识别风险
        risks: List[str] = []
        if is_core_change:
            risks.append("核心架构变更可能导致已完成模块的接口不兼容")
            risks.append(f"需重新进行架构批判迭代（最多 {self._max_arch_iterations} 次）")
            risks.append("可能影响下游依赖模块的集成测试")
        if adapt_modules:
            risks.append(f"{len(adapt_modules)} 个已完成模块需要适配，存在回归风险")
        if changed_interfaces:
            risks.append("接口变更需要同步更新所有调用方")
        if estimated_quota > 1000:
            risks.append(f"预估配额消耗较大（{estimated_quota} 次调用），需关注配额余量")

        # 依赖关系影响分析
        dependency_impact: Dict[str, List[str]] = {}
        for module_name in affected_modules:
            # 查找依赖该模块的其他模块
            dependents = []
            for m in all_modules:
                if isinstance(m, dict):
                    deps = m.get("dependencies", [])
                    if module_name in deps:
                        dependents.append(m.get("name", ""))
            if dependents:
                dependency_impact[module_name] = dependents

        assessment = ChangeAssessment(
            change_type=change_type,
            unaffected_modules=unaffected_modules,
            adapt_modules=adapt_modules,
            rebuild_modules=rebuild_modules,
            estimated_quota=estimated_quota,
            estimated_timeline=estimated_timeline,
            risks=risks,
            dependency_impact=dependency_impact,
        )

        # 缓存评估结果
        cache_key = self._hash_change_request(change_request)
        self._assessment_cache[cache_key] = assessment

        logger.info(
            "变更影响评估完成 | 类型=%s 受影响模块=%d 不受影响=%d 预估配额=%d 预估时间=%.1fh",
            change_type.value,
            len(affected_modules), len(unaffected_modules),
            estimated_quota, estimated_timeline,
        )

        return assessment

    def _hash_change_request(self, change_request: Dict[str, Any]) -> str:
        """
        对变更请求生成哈希值（用于缓存）
        参数：
          - change_request: 变更请求字典
        返回值：哈希字符串
        """
        import hashlib
        import json
        content = json.dumps(change_request, sort_keys=True, default=str)
        return hashlib.md5(content.encode()).hexdigest()

    # ============================================================
    # 3. 生成影响评估报告
    # ============================================================

    def generate_impact_report(
        self, change_request: Dict[str, Any], assessment: ChangeAssessment,
    ) -> str:
        """
        生成「需求变更影响范围评估报告」
        运行步骤：
          1. 生成报告头部（变更描述、评估时间、变更类型）
          2. 列出不受影响的模块（保留）
          3. 列出需适配的模块（局部变更）
          4. 列出需重建的模块（核心变更）
          5. 列出预估配额消耗和时间线
          6. 列出风险点和依赖影响
          7. 给出建议处理策略
        参数：
          - change_request: 变更请求字典
          - assessment: 影响评估结果
        返回值：Markdown 格式的评估报告文本
        """
        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        change_description = change_request.get("description", "未提供变更描述")
        change_reason = change_request.get("reason", "未提供变更原因")
        change_priority = change_request.get("priority", "medium")

        lines: List[str] = []

        # 报告头部
        lines.append("# 需求变更影响范围评估报告")
        lines.append("")
        lines.append(f"**评估时间**: {now}")
        lines.append(f"**变更类型**: {'🔴 核心变更' if assessment.change_type == ChangeLevel.CORE else '🟡 局部变更'}")
        lines.append(f"**变更优先级**: {change_priority}")
        lines.append("")
        lines.append("---")
        lines.append("")

        # 变更描述
        lines.append("## 1. 变更描述")
        lines.append("")
        lines.append(f"**变更内容**: {change_description}")
        lines.append(f"**变更原因**: {change_reason}")
        lines.append("")

        # 影响范围总览
        lines.append("## 2. 影响范围总览")
        lines.append("")
        lines.append(f"| 类别 | 数量 |")
        lines.append(f"|------|------|")
        lines.append(f"| 不受影响模块 | {len(assessment.unaffected_modules)} |")
        lines.append(f"| 需适配模块 | {len(assessment.adapt_modules)} |")
        lines.append(f"| 需重建模块 | {len(assessment.rebuild_modules)} |")
        lines.append("")

        # 不受影响的模块
        if assessment.unaffected_modules:
            lines.append("## 3. 不受影响的模块（保留）")
            lines.append("")
            lines.append("以下模块不受本次变更影响，已完成产物可直接复用：")
            lines.append("")
            for mod in assessment.unaffected_modules:
                lines.append(f"- ✅ {mod}")
            lines.append("")

        # 需适配的模块
        if assessment.adapt_modules:
            lines.append("## 4. 需适配的模块（局部变更）")
            lines.append("")
            lines.append("以下模块已完成但需要根据变更进行适配：")
            lines.append("")
            for mod in assessment.adapt_modules:
                lines.append(f"- 🔄 {mod}")
            lines.append("")

        # 需重建的模块
        if assessment.rebuild_modules:
            lines.append("## 5. 需重建的模块（核心变更）")
            lines.append("")
            lines.append("以下模块因核心架构变更需要重新设计和实现：")
            lines.append("")
            for mod in assessment.rebuild_modules:
                lines.append(f"- 🔨 {mod}")
            lines.append("")

        # 依赖影响
        if assessment.dependency_impact:
            lines.append("## 6. 依赖关系影响")
            lines.append("")
            for mod, dependents in assessment.dependency_impact.items():
                lines.append(f"- **{mod}** 的变更将影响: {', '.join(dependents)}")
            lines.append("")

        # 资源预估
        lines.append("## 7. 资源预估")
        lines.append("")
        lines.append(f"| 资源类型 | 预估值 |")
        lines.append(f"|----------|--------|")
        lines.append(f"| API 调用配额 | {assessment.estimated_quota} 次 |")
        lines.append(f"| 预估时间线 | {assessment.estimated_timeline:.1f} 小时 |")
        lines.append("")

        # 风险提示
        if assessment.risks:
            lines.append("## 8. 风险提示")
            lines.append("")
            for i, risk in enumerate(assessment.risks, 1):
                lines.append(f"{i}. ⚠️ {risk}")
            lines.append("")

        # 建议处理策略
        lines.append("## 9. 建议处理策略")
        lines.append("")
        if assessment.change_type == ChangeLevel.CORE:
            lines.append("1. **暂停所有任务**，保存当前检查点")
            lines.append("2. **保留未受影响模块**的已完成产物（共 {} 个模块）".format(
                len(assessment.unaffected_modules),
            ))
            lines.append("3. **对受影响模块重新进行架构设计**")
            lines.append("4. 架构设计完成后，按依赖顺序重建受影响模块")
            lines.append("5. 重建完成后进行全量集成测试")
        else:
            lines.append("1. **暂停受影响模块的执行**")
            lines.append('2. **标记受影响已完成任务为"待更新"**（共 {} 个模块）'.format(
                len(assessment.adapt_modules),
            ))
            lines.append("3. **更新待执行任务的需求描述**")
            lines.append("4. 按适配优先级逐个更新受影响模块")
            lines.append("5. 适配完成后进行回归测试")
        lines.append("")

        # 审批区域
        lines.append("---")
        lines.append("")
        lines.append("## 审批确认")
        lines.append("")
        lines.append("| 角色 | 签名 | 日期 |")
        lines.append("|------|------|------|")
        lines.append("| 变更提出人 | | |")
        lines.append("| 技术负责人 | | |")
        lines.append("| 项目经理 | | |")

        report_text = "\n".join(lines)

        logger.info(
            "影响评估报告生成完成 | 类型=%s 长度=%d 字符",
            assessment.change_type.value, len(report_text),
        )

        return report_text

    # ============================================================
    # 4. 核心变更处理
    # ============================================================

    def handle_core_change(
        self, change_request: Dict[str, Any], assessment: ChangeAssessment,
    ) -> Dict[str, Any]:
        """
        处理核心变更：保留未受影响模块，对受影响模块重新架构
        运行步骤：
          1. 验证评估结果为核心变更类型
          2. 标记未受影响模块的任务为 KEEP
          3. 标记受影响模块的已完成任务为 REBUILD
          4. 标记受影响模块的待执行任务为 REBUILD
          5. 生成重建计划
        参数：
          - change_request: 变更请求字典
          - assessment: 影响评估结果
        返回值：处理结果字典
          {
            "success": bool,
            "change_type": str,
            "preserved_modules": List[str],    # 保留的模块
            "rebuild_modules": List[str],      # 需重建的模块
            "rebuild_plan": Dict,              # 重建计划
            "handled_at": str,                 # 处理时间
          }
        """
        if assessment.change_type != ChangeLevel.CORE:
            logger.warning(
                "handle_core_change 被调用但评估结果为局部变更，将按核心变更处理",
            )

        # 保留未受影响的模块
        preserved_modules = list(assessment.unaffected_modules)

        # 需重建的模块
        rebuild_modules = list(assessment.rebuild_modules)

        # 更新受影响任务状态
        for task_id, record in self._task_state_records.items():
            # 检查任务是否属于受影响模块
            task_module = record.checkpoint_data.get("module_name", "")
            if task_module in rebuild_modules:
                if record.original_state == TaskState.COMPLETED:
                    # 已完成但需重建
                    record.action = TaskUpdateAction.REBUILD
                    record.updated_state = TaskState.PENDING_UPDATE
                    record.reason = "核心架构变更，需重建"
                elif record.original_state in (TaskState.IN_PROGRESS, TaskState.NOT_STARTED):
                    record.action = TaskUpdateAction.REBUILD
                    record.updated_state = TaskState.NOT_STARTED
                    record.reason = "核心架构变更，需重建"
            elif task_module in preserved_modules:
                # 未受影响，保持不变
                record.action = TaskUpdateAction.KEEP
                record.reason = "未受核心变更影响"

        # 生成重建计划
        rebuild_plan = {
            "phase_1": {
                "name": "架构重新设计",
                "modules": rebuild_modules,
                "estimated_iterations": self._max_arch_iterations,
            },
            "phase_2": {
                "name": "受影响模块重建",
                "modules": rebuild_modules,
                "order": "按依赖关系排序",
            },
            "phase_3": {
                "name": "集成测试",
                "modules": preserved_modules + rebuild_modules,
            },
        }

        # 记录变更历史
        self._change_history.append({
            "type": "core_change",
            "change_request": change_request,
            "assessment": {
                "change_type": assessment.change_type.value,
                "preserved": preserved_modules,
                "rebuild": rebuild_modules,
            },
            "handled_at": datetime.now(timezone.utc).isoformat(),
        })

        result = {
            "success": True,
            "change_type": "core",
            "preserved_modules": preserved_modules,
            "rebuild_modules": rebuild_modules,
            "rebuild_plan": rebuild_plan,
            "handled_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.warning(
            "【核心变更处理】保留=%d 模块 重建=%d 模块",
            len(preserved_modules), len(rebuild_modules),
        )

        return result

    # ============================================================
    # 5. 局部变更处理
    # ============================================================

    def handle_local_change(
        self, change_request: Dict[str, Any], assessment: ChangeAssessment,
    ) -> Dict[str, Any]:
        """
        处理局部变更：标记受影响已完成任务为"待更新"，更新待执行任务需求
        运行步骤：
          1. 验证评估结果为局部变更类型
          2. 标记受影响模块的已完成任务为 PENDING_UPDATE
          3. 更新受影响模块的待执行任务需求描述
          4. 保持未受影响模块不变
        参数：
          - change_request: 变更请求字典
          - assessment: 影响评估结果
        返回值：处理结果字典
          {
            "success": bool,
            "change_type": str,
            "pending_update_tasks": List[str],   # 标记为"待更新"的任务 ID
            "requirements_updated_tasks": List[str], # 需求已更新的任务 ID
            "unchanged_tasks": List[str],        # 未变更的任务 ID
            "handled_at": str,                   # 处理时间
          }
        """
        if assessment.change_type != ChangeLevel.LOCAL:
            logger.warning(
                "handle_local_change 被调用但评估结果为核心变更，将按局部变更处理",
            )

        adapt_modules = set(assessment.adapt_modules)
        unaffected_modules = set(assessment.unaffected_modules)
        change_description = change_request.get("description", "")

        pending_update_tasks: List[str] = []
        requirements_updated_tasks: List[str] = []
        unchanged_tasks: List[str] = []

        # 更新受影响任务状态
        for task_id, record in self._task_state_records.items():
            task_module = record.checkpoint_data.get("module_name", "")

            if task_module in adapt_modules:
                if record.original_state == TaskState.COMPLETED:
                    # 已完成但需适配 → 标记为"待更新"
                    record.action = TaskUpdateAction.MARK_PENDING_UPDATE
                    record.updated_state = TaskState.PENDING_UPDATE
                    record.reason = f"局部变更需适配: {change_description[:100]}"
                    pending_update_tasks.append(task_id)
                elif record.original_state in (TaskState.IN_PROGRESS, TaskState.NOT_STARTED):
                    # 待执行任务 → 更新需求描述
                    record.action = TaskUpdateAction.UPDATE_REQUIREMENTS
                    record.updated_state = TaskState.NOT_STARTED
                    record.reason = f"局部变更更新需求: {change_description[:100]}"
                    requirements_updated_tasks.append(task_id)
            elif task_module in unaffected_modules:
                # 未受影响
                record.action = TaskUpdateAction.KEEP
                record.reason = "未受局部变更影响"
                unchanged_tasks.append(task_id)
            else:
                # 不在变更范围内
                record.action = TaskUpdateAction.KEEP
                unchanged_tasks.append(task_id)

        # 记录变更历史
        self._change_history.append({
            "type": "local_change",
            "change_request": change_request,
            "assessment": {
                "change_type": assessment.change_type.value,
                "adapt": list(adapt_modules),
                "unaffected": list(unaffected_modules),
            },
            "pending_update_count": len(pending_update_tasks),
            "requirements_updated_count": len(requirements_updated_tasks),
            "handled_at": datetime.now(timezone.utc).isoformat(),
        })

        result = {
            "success": True,
            "change_type": "local",
            "pending_update_tasks": pending_update_tasks,
            "requirements_updated_tasks": requirements_updated_tasks,
            "unchanged_tasks": unchanged_tasks,
            "handled_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "【局部变更处理】待更新=%d 需求更新=%d 未变更=%d",
            len(pending_update_tasks),
            len(requirements_updated_tasks),
            len(unchanged_tasks),
        )

        return result

    # ============================================================
    # 6. 更新任务状态
    # ============================================================

    def update_task_states(
        self, assessment: ChangeAssessment,
    ) -> Dict[str, Any]:
        """
        根据影响评估结果更新受影响任务的状态
        运行步骤：
          1. 遍历所有任务状态记录
          2. 根据评估结果中的受影响模块列表更新状态
          3. 核心变更：受影响模块任务标记为 REBUILD
          4. 局部变更：受影响已完成任务标记为 PENDING_UPDATE
          5. 汇总更新结果
        参数：
          - assessment: 影响评估结果
        返回值：更新结果字典
          {
            "success": bool,
            "total_tasks": int,              # 总任务数
            "updated_tasks": int,            # 已更新任务数
            "update_details": List[Dict],    # 更新详情列表
            "updated_at": str,               # 更新时间
          }
        """
        affected_modules = set()
        if assessment.change_type == ChangeLevel.CORE:
            affected_modules = set(assessment.rebuild_modules)
        else:
            affected_modules = set(assessment.adapt_modules)

        unaffected_modules = set(assessment.unaffected_modules)

        total_tasks = len(self._task_state_records)
        updated_tasks = 0
        update_details: List[Dict[str, Any]] = []

        for task_id, record in self._task_state_records.items():
            task_module = record.checkpoint_data.get("module_name", "")

            detail = {
                "task_id": task_id,
                "task_name": record.task_name,
                "module": task_module,
                "previous_state": record.original_state.value,
            }

            if task_module in affected_modules:
                if assessment.change_type == ChangeLevel.CORE:
                    record.action = TaskUpdateAction.REBUILD
                    record.updated_state = TaskState.NOT_STARTED
                    record.reason = "核心架构变更"
                else:
                    if record.original_state == TaskState.COMPLETED:
                        record.action = TaskUpdateAction.MARK_PENDING_UPDATE
                        record.updated_state = TaskState.PENDING_UPDATE
                        record.reason = "局部变更需适配"
                    else:
                        record.action = TaskUpdateAction.UPDATE_REQUIREMENTS
                        record.updated_state = TaskState.NOT_STARTED
                        record.reason = "局部变更更新需求"

                updated_tasks += 1
                detail["new_state"] = record.updated_state.value
                detail["action"] = record.action.value
            elif task_module in unaffected_modules:
                record.action = TaskUpdateAction.KEEP
                record.reason = "未受影响"
                detail["new_state"] = record.original_state.value
                detail["action"] = "keep"
            else:
                record.action = TaskUpdateAction.KEEP
                detail["new_state"] = record.original_state.value
                detail["action"] = "keep"

            update_details.append(detail)

        result = {
            "success": True,
            "total_tasks": total_tasks,
            "updated_tasks": updated_tasks,
            "update_details": update_details,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "任务状态更新完成 | 总计=%d 已更新=%d",
            total_tasks, updated_tasks,
        )

        return result

    # ============================================================
    # 7. 恢复执行
    # ============================================================

    def resume_execution(self, session_id: str) -> Dict[str, Any]:
        """
        变更处理完成后恢复任务执行
        运行步骤：
          1. 清除会话的暂停记录
          2. 将所有 PAUSED 状态的任务恢复为原始状态
          3. 跳过标记为 SKIP 的任务
          4. 按依赖顺序恢复任务执行
        参数：
          - session_id: 会话 ID
        返回值：恢复结果字典
          {
            "success": bool,
            "session_id": str,
            "resumed_task_count": int,       # 恢复的任务数
            "skipped_task_count": int,       # 跳过的任务数
            "pending_update_count": int,     # 待更新任务数
            "resumed_at": str,               # 恢复时间
          }
        """
        resumed_count = 0
        skipped_count = 0
        pending_update_count = 0

        # 恢复所有暂停的任务
        for task_id, record in self._task_state_records.items():
            if record.action == TaskUpdateAction.KEEP:
                if record.updated_state == TaskState.PAUSED:
                    # 恢复为原始状态
                    record.updated_state = record.original_state
                    resumed_count += 1
            elif record.action == TaskUpdateAction.SKIP:
                skipped_count += 1
            elif record.action == TaskUpdateAction.MARK_PENDING_UPDATE:
                pending_update_count += 1
            elif record.action == TaskUpdateAction.UPDATE_REQUIREMENTS:
                # 需求已更新，任务可恢复执行
                resumed_count += 1
            elif record.action == TaskUpdateAction.REBUILD:
                # 核心变更重建，任务重置为未开始
                resumed_count += 1

        # 清除暂停记录
        self._pause_records.pop(session_id, None)

        result = {
            "success": True,
            "session_id": session_id,
            "resumed_task_count": resumed_count,
            "skipped_task_count": skipped_count,
            "pending_update_count": pending_update_count,
            "resumed_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "【需求变更】恢复执行 | session=%s 恢复=%d 跳过=%d 待更新=%d",
            session_id[:8] if session_id else "N/A",
            resumed_count, skipped_count, pending_update_count,
        )

        return result

    # ============================================================
    # 工具方法
    # ============================================================

    def register_alert_callback(self, callback: Callable):
        """
        注册告警回调函数
        参数：
          callback: 回调函数，签名为 (action: str, detail: Dict) -> None
        """
        self._alert_callbacks.append(callback)

    def _trigger_alert(self, action: str, detail: Dict[str, Any]):
        """
        触发告警回调
        参数：
          - action: 动作描述
          - detail: 详情字典
        """
        for callback in self._alert_callbacks:
            try:
                callback(action, detail)
            except Exception as e:
                logger.error("告警回调执行失败: %s", e)

    def get_task_state_record(self, task_id: str) -> Optional[TaskStateRecord]:
        """
        获取任务状态记录
        参数：
          - task_id: 任务 ID
        返回值：TaskStateRecord 或 None
        """
        return self._task_state_records.get(task_id)

    def set_task_state_record(self, task_id: str, record: TaskStateRecord):
        """
        设置任务状态记录（供外部模块注册任务状态）
        参数：
          - task_id: 任务 ID
          - record: 任务状态记录
        """
        self._task_state_records[task_id] = record

    def get_change_history(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        获取变更历史记录
        参数：
          - limit: 返回条数上限
        返回值：变更历史列表
        """
        return self._change_history[-limit:]

    def clear_session_records(self, session_id: str):
        """
        清除会话相关的所有记录
        参数：
          - session_id: 会话 ID
        """
        self._pause_records.pop(session_id, None)
        # 清除该会话的任务状态记录（通过 checkpoint_data 中的 session_id 匹配）
        to_remove = []
        for task_id, record in self._task_state_records.items():
            if record.checkpoint_data.get("session_id") == session_id:
                to_remove.append(task_id)
        for task_id in to_remove:
            self._task_state_records.pop(task_id, None)
        logger.info("已清除会话 %s 的变更处理记录", session_id[:8] if session_id else "N/A")


# ============================================================
# 全局单例实例
# ============================================================

# 需求变更处理器全局单例
change_request_handler = ChangeRequestHandler()
