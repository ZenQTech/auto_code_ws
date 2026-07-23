"""
# ============================================================
# 断点续跑管理服务（V4.1 新增）
# ============================================================
# 核心作用：管理系统重启或中断后的断点续跑能力，包括检查点保存与恢复、
#           重启一致性校验、人工修改检测、断点定位、断点评估报告生成、
#           历史产物复用、长任务会话过期处理
# 运行流程：
#   1. 任务执行过程中定期保存检查点（任务状态、中间产物、依赖关系）
#   2. 系统重启时校验产物完整性、全局变更、依赖链一致性
#   3. 通过文件哈希比对检测中断期间的人工修改
#   4. 定位最后一个 100% 完成且校验通过的节点作为重启点
#   5. 生成「断点评估报告」明确已完成/待执行/检测到变更/建议策略
#   6. 从检查点恢复任务状态，复用历史产物
#   7. 长任务会话过期时自动创建新会话，从数据库恢复状态
# 输入参数：
#   - task_id: str，任务 ID
#   - state: Dict，任务状态数据
#   - session_id: str，会话 ID
# 输出结果：检查点数据、断点评估报告、恢复状态
# 修改记录：
#   - 2026-06-24 | v1.0.0 | 初始版本，实现检查点管理、重启校验、
#     人工修改检测、断点定位、评估报告、恢复、会话过期处理七大模块
# ============================================================
"""

import hashlib
import json
import logging
import os
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

class CheckpointStatus(str, Enum):
    """
    检查点状态枚举
    取值：
      - ACTIVE: 活跃（任务正在执行）
      - SAVED: 已保存（任务正常暂停）
      - VERIFIED: 已校验（重启后校验通过）
      - CORRUPTED: 已损坏（校验不通过）
      - EXPIRED: 已过期（超过保留期限）
    """
    ACTIVE = "active"
    SAVED = "saved"
    VERIFIED = "verified"
    CORRUPTED = "corrupted"
    EXPIRED = "expired"


class VerificationStatus(str, Enum):
    """
    校验状态枚举
    取值：
      - PASSED: 校验通过
      - FAILED_INTEGRITY: 产物完整性校验失败
      - FAILED_GLOBAL_CHANGE: 全局变更冲突
      - FAILED_DEPENDENCY: 依赖链不一致
      - FAILED_HUMAN_MODIFICATION: 检测到人工修改
    """
    PASSED = "passed"
    FAILED_INTEGRITY = "failed_integrity"
    FAILED_GLOBAL_CHANGE = "failed_global_change"
    FAILED_DEPENDENCY = "failed_dependency"
    FAILED_HUMAN_MODIFICATION = "failed_human_modification"


class BreakpointStrategy(str, Enum):
    """
    断点续跑策略枚举
    取值：
      - RESUME_FROM_CHECKPOINT: 从检查点恢复
      - REUSE_ARTIFACTS: 复用历史产物，跳过已完成节点
      - RESTART_AFFECTED: 仅重启受影响节点
      - FULL_RESTART: 全量重启
    """
    RESUME_FROM_CHECKPOINT = "resume_from_checkpoint"
    REUSE_ARTIFACTS = "reuse_artifacts"
    RESTART_AFFECTED = "restart_affected"
    FULL_RESTART = "full_restart"


@dataclass
class CheckpointData:
    """
    检查点数据类
    字段说明：
      - task_id: 任务 ID
      - status: 检查点状态
      - saved_at: 保存时间戳
      - task_state: 任务状态快照（进度、结果摘要等）
      - artifact_hashes: 产物文件哈希映射 {file_path: sha256_hash}
      - dependency_snapshot: 依赖关系快照
      - global_config_hash: 全局配置哈希（用于检测全局变更）
      - completed_nodes: 已完成节点列表
      - current_node: 当前执行节点
      - pending_nodes: 待执行节点列表
    """
    task_id: str = ""
    status: CheckpointStatus = CheckpointStatus.ACTIVE
    saved_at: float = 0.0
    task_state: Dict[str, Any] = field(default_factory=dict)
    artifact_hashes: Dict[str, str] = field(default_factory=dict)
    dependency_snapshot: Dict[str, List[str]] = field(default_factory=dict)
    global_config_hash: str = ""
    completed_nodes: List[str] = field(default_factory=list)
    current_node: str = ""
    pending_nodes: List[str] = field(default_factory=list)


@dataclass
class ModificationRecord:
    """
    人工修改检测记录数据类
    字段说明：
      - file_path: 被修改的文件路径
      - original_hash: 原始哈希值
      - current_hash: 当前哈希值
      - modified_at: 修改时间（文件 mtime）
      - is_expected: 是否为预期内的修改
    """
    file_path: str = ""
    original_hash: str = ""
    current_hash: str = ""
    modified_at: float = 0.0
    is_expected: bool = False


@dataclass
class BreakpointReport:
    """
    断点评估报告数据类
    字段说明：
      - generated_at: 报告生成时间
      - completed_tasks: 已完成任务列表
      - pending_tasks: 待执行任务列表
      - detected_changes: 检测到的变更列表（人工修改、全局变更等）
      - suggested_strategy: 建议的续跑策略
      - can_resume: 是否可以从断点恢复
      - issues: 发现的问题列表
      - reusable_artifacts: 可复用的历史产物列表
    """
    generated_at: str = ""
    completed_tasks: List[str] = field(default_factory=list)
    pending_tasks: List[str] = field(default_factory=list)
    detected_changes: List[str] = field(default_factory=list)
    suggested_strategy: BreakpointStrategy = BreakpointStrategy.RESUME_FROM_CHECKPOINT
    can_resume: bool = True
    issues: List[str] = field(default_factory=list)
    reusable_artifacts: List[str] = field(default_factory=list)


# ============================================================
# 断点续跑管理器 - CheckpointManager
# ============================================================

class CheckpointManager:
    """
    断点续跑管理器
    作用：管理系统重启或中断后的断点续跑能力，确保任务状态不丢失、
          已完成产物可复用、中断期间变更可检测
    调用方：任务执行引擎、调度器、系统启动模块
    被调用方：文件系统、数据库、配置管理模块
    """

    def __init__(self):
        """
        初始化断点续跑管理器
        运行步骤：
          1. 从全局配置读取存储路径参数
          2. 初始化检查点存储目录
          3. 初始化检查点数据表
          4. 初始化文件哈希缓存
          5. 初始化人工修改检测记录
          6. 计算当前全局配置哈希
        """
        # 从配置读取存储路径
        storage_config = settings.storage
        # 数据存储根目录
        self._data_dir: str = storage_config.get("data_dir", "data")
        # 工作空间根目录
        self._workspace_dir: str = storage_config.get("workspace_dir", "workspace")

        # 项目根目录
        self._project_root: Path = settings.get_project_root()

        # 检查点存储目录（data/checkpoints）
        self._checkpoint_dir: Path = self._project_root / self._data_dir / "checkpoints"
        self._checkpoint_dir.mkdir(parents=True, exist_ok=True)

        # 检查点数据：task_id -> CheckpointData
        self._checkpoints: Dict[str, CheckpointData] = {}

        # 文件哈希缓存：file_path -> sha256_hash
        self._hash_cache: Dict[str, str] = {}

        # 人工修改检测记录
        self._modification_records: List[ModificationRecord] = []

        # 断点评估报告缓存：task_id -> BreakpointReport
        self._breakpoint_reports: Dict[str, BreakpointReport] = {}

        # 会话过期处理记录
        self._session_expiry_records: Dict[str, Dict[str, Any]] = {}

        # 告警回调列表
        self._alert_callbacks: List[Callable] = []

        # 线程安全锁
        self._lock = threading.Lock()

        # 计算当前全局配置哈希
        self._current_global_hash: str = self._compute_global_config_hash()

        # 从磁盘加载已有检查点
        self._load_checkpoints_from_disk()

        logger.info(
            "断点续跑管理器初始化完成 | 检查点目录=%s 已加载检查点数=%d",
            str(self._checkpoint_dir), len(self._checkpoints),
        )

    # ============================================================
    # 1. 保存检查点
    # ============================================================

    def save_checkpoint(
        self, task_id: str, state: Dict[str, Any],
    ) -> CheckpointData:
        """
        保存任务检查点
        运行步骤：
          1. 收集任务当前状态（进度、结果、依赖等）
          2. 扫描任务相关产物文件并计算哈希
          3. 记录依赖关系快照
          4. 计算全局配置哈希
          5. 序列化检查点数据并写入磁盘
          6. 更新内存中的检查点记录
        参数：
          - task_id: 任务 ID
          - state: 任务状态字典
            {
              "progress": float,              # 进度 0.0-1.0
              "result_summary": str,          # 结果摘要
              "completed_nodes": List[str],   # 已完成节点
              "current_node": str,            # 当前节点
              "pending_nodes": List[str],     # 待执行节点
              "artifact_paths": List[str],    # 产物文件路径列表
              "dependencies": Dict,           # 依赖关系
            }
        返回值：CheckpointData，保存的检查点数据
        """
        now = time.time()

        # 提取状态信息
        progress = state.get("progress", 0.0)
        result_summary = state.get("result_summary", "")
        completed_nodes = state.get("completed_nodes", [])
        current_node = state.get("current_node", "")
        pending_nodes = state.get("pending_nodes", [])
        artifact_paths = state.get("artifact_paths", [])
        dependencies = state.get("dependencies", {})

        # 计算产物文件哈希
        artifact_hashes: Dict[str, str] = {}
        for file_path_str in artifact_paths:
            file_path = Path(file_path_str)
            if file_path.exists() and file_path.is_file():
                file_hash = self._compute_file_hash(str(file_path))
                artifact_hashes[file_path_str] = file_hash
                # 更新哈希缓存
                self._hash_cache[file_path_str] = file_hash
            else:
                logger.warning(
                    "检查点保存: 产物文件不存在 %s（task=%s）",
                    file_path_str, task_id[:8] if task_id else "N/A",
                )

        # 构建检查点数据
        checkpoint = CheckpointData(
            task_id=task_id,
            status=CheckpointStatus.SAVED,
            saved_at=now,
            task_state={
                "progress": progress,
                "result_summary": result_summary,
                "extra": state.get("extra", {}),
            },
            artifact_hashes=artifact_hashes,
            dependency_snapshot=dependencies,
            global_config_hash=self._current_global_hash,
            completed_nodes=completed_nodes,
            current_node=current_node,
            pending_nodes=pending_nodes,
        )

        # 更新内存记录
        with self._lock:
            self._checkpoints[task_id] = checkpoint

        # 写入磁盘
        self._write_checkpoint_to_disk(task_id, checkpoint)

        logger.info(
            "检查点已保存 | task=%s 进度=%.0f%% 产物=%d 已完成节点=%d",
            task_id[:8] if task_id else "N/A",
            progress * 100, len(artifact_hashes), len(completed_nodes),
        )

        return checkpoint

    def _write_checkpoint_to_disk(self, task_id: str, checkpoint: CheckpointData):
        """
        将检查点数据序列化写入磁盘
        参数：
          - task_id: 任务 ID
          - checkpoint: 检查点数据
        """
        # 构建序列化数据
        serialized = {
            "task_id": checkpoint.task_id,
            "status": checkpoint.status.value,
            "saved_at": checkpoint.saved_at,
            "task_state": checkpoint.task_state,
            "artifact_hashes": checkpoint.artifact_hashes,
            "dependency_snapshot": checkpoint.dependency_snapshot,
            "global_config_hash": checkpoint.global_config_hash,
            "completed_nodes": checkpoint.completed_nodes,
            "current_node": checkpoint.current_node,
            "pending_nodes": checkpoint.pending_nodes,
        }

        # 写入 JSON 文件
        checkpoint_file = self._checkpoint_dir / f"{task_id}.json"
        try:
            with open(str(checkpoint_file), "w", encoding="utf-8") as f:
                json.dump(serialized, f, ensure_ascii=False, indent=2)
            logger.debug("检查点写入磁盘: %s", str(checkpoint_file))
        except Exception as e:
            logger.error("检查点写入磁盘失败: %s | task=%s", e, task_id[:8])

    def _load_checkpoints_from_disk(self):
        """
        从磁盘加载已有检查点数据到内存
        运行步骤：
          1. 扫描检查点目录中的所有 JSON 文件
          2. 逐个反序列化
          3. 校验数据完整性
          4. 加载到内存检查点表
        """
        if not self._checkpoint_dir.exists():
            return

        loaded_count = 0
        for checkpoint_file in self._checkpoint_dir.glob("*.json"):
            try:
                with open(str(checkpoint_file), "r", encoding="utf-8") as f:
                    data = json.load(f)

                task_id = data.get("task_id", "")
                if not task_id:
                    continue

                # 解析状态枚举
                status_str = data.get("status", "saved")
                try:
                    status = CheckpointStatus(status_str)
                except ValueError:
                    status = CheckpointStatus.SAVED

                checkpoint = CheckpointData(
                    task_id=task_id,
                    status=status,
                    saved_at=data.get("saved_at", 0.0),
                    task_state=data.get("task_state", {}),
                    artifact_hashes=data.get("artifact_hashes", {}),
                    dependency_snapshot=data.get("dependency_snapshot", {}),
                    global_config_hash=data.get("global_config_hash", ""),
                    completed_nodes=data.get("completed_nodes", []),
                    current_node=data.get("current_node", ""),
                    pending_nodes=data.get("pending_nodes", []),
                )

                self._checkpoints[task_id] = checkpoint
                loaded_count += 1

            except Exception as e:
                logger.warning(
                    "加载检查点文件失败: %s | %s",
                    checkpoint_file.name, e,
                )

        if loaded_count > 0:
            logger.info("从磁盘加载了 %d 个检查点", loaded_count)

    # ============================================================
    # 2. 重启一致性校验
    # ============================================================

    def verify_restart_consistency(self) -> Dict[str, Any]:
        """
        系统重启时校验产物完整性、全局变更、依赖链一致性
        运行步骤：
          1. 遍历所有已保存的检查点
          2. 校验产物文件完整性（文件是否存在、哈希是否匹配）
          3. 校验全局配置是否变更（哈希比对）
          4. 校验依赖链一致性（依赖图是否完整）
          5. 汇总校验结果
        返回值：校验结果字典
          {
            "success": bool,
            "total_checkpoints": int,          # 总检查点数
            "passed_count": int,               # 校验通过数
            "failed_count": int,               # 校验失败数
            "details": List[Dict],             # 各检查点校验详情
            "verified_at": str,                # 校验时间
          }
        """
        total = len(self._checkpoints)
        passed = 0
        failed = 0
        details: List[Dict[str, Any]] = []

        for task_id, checkpoint in self._checkpoints.items():
            verification_issues: List[str] = []
            verification_status = VerificationStatus.PASSED

            # 1. 校验产物完整性
            missing_artifacts = []
            hash_mismatches = []
            for file_path_str, expected_hash in checkpoint.artifact_hashes.items():
                file_path = Path(file_path_str)
                if not file_path.exists():
                    missing_artifacts.append(file_path_str)
                else:
                    current_hash = self._compute_file_hash(file_path_str)
                    if current_hash != expected_hash:
                        hash_mismatches.append({
                            "file": file_path_str,
                            "expected": expected_hash[:16],
                            "current": current_hash[:16],
                        })

            if missing_artifacts:
                verification_issues.append(
                    f"产物缺失: {len(missing_artifacts)} 个文件"
                )
                verification_status = VerificationStatus.FAILED_INTEGRITY
                logger.warning(
                    "检查点 %s 产物缺失: %s",
                    task_id[:8] if task_id else "N/A",
                    missing_artifacts,
                )

            if hash_mismatches:
                verification_issues.append(
                    f"产物哈希不匹配: {len(hash_mismatches)} 个文件"
                )
                verification_status = VerificationStatus.FAILED_INTEGRITY

            # 2. 校验全局配置变更
            if checkpoint.global_config_hash != self._current_global_hash:
                verification_issues.append("全局配置已变更")
                if verification_status == VerificationStatus.PASSED:
                    verification_status = VerificationStatus.FAILED_GLOBAL_CHANGE
                logger.warning(
                    "检查点 %s 全局配置哈希不匹配",
                    task_id[:8] if task_id else "N/A",
                )

            # 3. 校验依赖链一致性
            if checkpoint.dependency_snapshot:
                dep_issues = self._verify_dependency_consistency(
                    checkpoint.dependency_snapshot,
                )
                if dep_issues:
                    verification_issues.extend(dep_issues)
                    if verification_status == VerificationStatus.PASSED:
                        verification_status = VerificationStatus.FAILED_DEPENDENCY

            # 更新检查点状态
            if verification_status == VerificationStatus.PASSED:
                checkpoint.status = CheckpointStatus.VERIFIED
                passed += 1
            else:
                checkpoint.status = CheckpointStatus.CORRUPTED
                failed += 1

            details.append({
                "task_id": task_id,
                "status": verification_status.value,
                "issues": verification_issues,
                "completed_nodes": len(checkpoint.completed_nodes),
                "pending_nodes": len(checkpoint.pending_nodes),
            })

        result = {
            "success": failed == 0,
            "total_checkpoints": total,
            "passed_count": passed,
            "failed_count": failed,
            "details": details,
            "verified_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "重启一致性校验完成 | 总计=%d 通过=%d 失败=%d",
            total, passed, failed,
        )

        return result

    def _verify_dependency_consistency(
        self, dependency_snapshot: Dict[str, List[str]],
    ) -> List[str]:
        """
        校验依赖链一致性
        运行步骤：
          1. 检查所有被依赖节点是否存在
          2. 检查是否存在循环依赖
          3. 检查依赖链中是否有断链
        参数：
          - dependency_snapshot: 依赖关系快照 {node: [dependencies]}
        返回值：问题描述列表
        """
        issues: List[str] = []
        all_nodes = set(dependency_snapshot.keys())

        # 收集所有被依赖的节点
        all_deps = set()
        for deps in dependency_snapshot.values():
            all_deps.update(deps)

        # 检查被依赖节点是否都在节点列表中
        missing_deps = all_deps - all_nodes
        if missing_deps:
            issues.append(
                f"依赖链中存在未定义的节点: {list(missing_deps)[:5]}"
            )

        # 简单循环依赖检测（DFS）
        visited: Set[str] = set()
        rec_stack: Set[str] = set()

        def has_cycle(node: str) -> bool:
            """DFS 检测循环依赖"""
            visited.add(node)
            rec_stack.add(node)
            for dep in dependency_snapshot.get(node, []):
                if dep not in visited:
                    if has_cycle(dep):
                        return True
                elif dep in rec_stack:
                    return True
            rec_stack.discard(node)
            return False

        for node in all_nodes:
            if node not in visited:
                if has_cycle(node):
                    issues.append(f"依赖链中存在循环依赖")
                    break

        return issues

    # ============================================================
    # 3. 人工修改检测
    # ============================================================

    def detect_human_modifications(self) -> List[ModificationRecord]:
        """
        通过文件哈希比对检测中断期间的人工修改
        运行步骤：
          1. 遍历所有检查点中的产物文件哈希记录
          2. 重新计算当前文件哈希
          3. 比对原始哈希与当前哈希
          4. 记录不匹配的文件为人工修改
          5. 检查文件修改时间是否在中断期间
        返回值：ModificationRecord 列表
        """
        modifications: List[ModificationRecord] = []

        for task_id, checkpoint in self._checkpoints.items():
            for file_path_str, original_hash in checkpoint.artifact_hashes.items():
                file_path = Path(file_path_str)
                if not file_path.exists():
                    # 文件已删除，记录为修改
                    mod_record = ModificationRecord(
                        file_path=file_path_str,
                        original_hash=original_hash,
                        current_hash="FILE_DELETED",
                        modified_at=0.0,
                        is_expected=False,
                    )
                    modifications.append(mod_record)
                    logger.warning(
                        "检测到文件删除（可能人工操作）: %s（task=%s）",
                        file_path_str, task_id[:8] if task_id else "N/A",
                    )
                    continue

                # 计算当前哈希
                current_hash = self._compute_file_hash(file_path_str)
                if current_hash != original_hash:
                    # 文件已修改
                    file_mtime = file_path.stat().st_mtime
                    # 判断是否为预期内修改（修改时间在检查点保存之前）
                    is_expected = file_mtime <= checkpoint.saved_at

                    mod_record = ModificationRecord(
                        file_path=file_path_str,
                        original_hash=original_hash,
                        current_hash=current_hash,
                        modified_at=file_mtime,
                        is_expected=is_expected,
                    )
                    modifications.append(mod_record)

                    if not is_expected:
                        logger.warning(
                            "检测到人工修改: %s（task=%s mtime=%s）",
                            file_path_str,
                            task_id[:8] if task_id else "N/A",
                            datetime.fromtimestamp(file_mtime).isoformat(),
                        )

        self._modification_records = modifications

        logger.info(
            "人工修改检测完成 | 检测到 %d 处修改（其中 %d 处非预期）",
            len(modifications),
            sum(1 for m in modifications if not m.is_expected),
        )

        return modifications

    def get_unexpected_modifications(self) -> List[ModificationRecord]:
        """
        获取非预期的人工修改记录
        返回值：ModificationRecord 列表
        """
        return [m for m in self._modification_records if not m.is_expected]

    # ============================================================
    # 4. 断点定位
    # ============================================================

    def locate_breakpoint(self) -> Dict[str, Any]:
        """
        定位最后一个 100% 完成且校验通过的节点作为重启点
        运行步骤：
          1. 遍历所有检查点
          2. 筛选状态为 VERIFIED 的检查点
          3. 按保存时间排序
          4. 找到进度为 100% 的最后一个完成节点
          5. 确定重启点（最后一个完成节点的下一个节点）
        返回值：断点定位结果字典
          {
            "found": bool,
            "restart_point": str,              # 重启点节点名称
            "last_completed_node": str,        # 最后一个完成节点
            "completed_nodes": List[str],      # 所有已完成节点
            "pending_nodes": List[str],        # 所有待执行节点
            "checkpoint_task_id": str,         # 对应检查点的任务 ID
            "located_at": str,                 # 定位时间
          }
        """
        # 筛选校验通过的检查点
        verified_checkpoints = [
            (task_id, cp) for task_id, cp in self._checkpoints.items()
            if cp.status == CheckpointStatus.VERIFIED
        ]

        if not verified_checkpoints:
            logger.warning("断点定位: 未找到校验通过的检查点")
            return {
                "found": False,
                "restart_point": "",
                "last_completed_node": "",
                "completed_nodes": [],
                "pending_nodes": [],
                "checkpoint_task_id": "",
                "located_at": datetime.now(timezone.utc).isoformat(),
            }

        # 按保存时间排序（最新的在前）
        verified_checkpoints.sort(key=lambda x: x[1].saved_at, reverse=True)

        # 找到进度最高的检查点
        best_task_id, best_checkpoint = verified_checkpoints[0]

        # 确定最后一个完成节点
        completed_nodes = best_checkpoint.completed_nodes
        pending_nodes = best_checkpoint.pending_nodes

        last_completed = completed_nodes[-1] if completed_nodes else ""

        # 确定重启点：当前节点（如果有）或第一个待执行节点
        restart_point = best_checkpoint.current_node
        if not restart_point and pending_nodes:
            restart_point = pending_nodes[0]

        result = {
            "found": True,
            "restart_point": restart_point,
            "last_completed_node": last_completed,
            "completed_nodes": completed_nodes,
            "pending_nodes": pending_nodes,
            "checkpoint_task_id": best_task_id,
            "located_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "断点定位完成 | 重启点=%s 已完成=%d 待执行=%d",
            restart_point, len(completed_nodes), len(pending_nodes),
        )

        return result

    # ============================================================
    # 5. 生成断点评估报告
    # ============================================================

    def generate_breakpoint_report(self) -> BreakpointReport:
        """
        生成「断点评估报告」
        运行步骤：
          1. 定位断点
          2. 收集已完成任务和待执行任务
          3. 汇总检测到的变更（人工修改、全局变更、依赖变更）
          4. 评估是否可以从断点恢复
          5. 建议续跑策略
          6. 列出可复用的历史产物
        返回值：BreakpointReport，断点评估报告
        """
        # 定位断点
        breakpoint_info = self.locate_breakpoint()

        # 收集已完成任务
        completed_tasks: List[str] = []
        pending_tasks: List[str] = []
        reusable_artifacts: List[str] = []

        for task_id, checkpoint in self._checkpoints.items():
            if checkpoint.status == CheckpointStatus.VERIFIED:
                # 已完成节点
                completed_tasks.extend(checkpoint.completed_nodes)
                # 收集可复用的产物
                for file_path_str in checkpoint.artifact_hashes.keys():
                    if Path(file_path_str).exists():
                        reusable_artifacts.append(file_path_str)
            elif checkpoint.status == CheckpointStatus.SAVED:
                # 待校验节点，暂列为待执行
                pending_tasks.extend(checkpoint.pending_nodes)

        # 汇总检测到的变更
        detected_changes: List[str] = []

        # 人工修改
        unexpected_mods = self.get_unexpected_modifications()
        if unexpected_mods:
            detected_changes.append(
                f"检测到 {len(unexpected_mods)} 处非预期人工修改"
            )
            for mod in unexpected_mods[:5]:  # 最多列出 5 个
                detected_changes.append(f"  - {mod.file_path}")

        # 全局配置变更
        for task_id, checkpoint in self._checkpoints.items():
            if checkpoint.global_config_hash != self._current_global_hash:
                detected_changes.append(
                    f"全局配置已变更（task={task_id[:8]}...）"
                )
                break

        # 依赖变更
        dep_issues_found = False
        for task_id, checkpoint in self._checkpoints.items():
            if checkpoint.dependency_snapshot:
                issues = self._verify_dependency_consistency(
                    checkpoint.dependency_snapshot,
                )
                if issues:
                    detected_changes.extend(issues)
                    dep_issues_found = True
                    break

        # 评估是否可以从断点恢复
        can_resume = breakpoint_info["found"] and len(unexpected_mods) == 0

        # 建议续跑策略
        if not breakpoint_info["found"]:
            strategy = BreakpointStrategy.FULL_RESTART
        elif unexpected_mods:
            strategy = BreakpointStrategy.RESTART_AFFECTED
        elif dep_issues_found:
            strategy = BreakpointStrategy.RESTART_AFFECTED
        else:
            strategy = BreakpointStrategy.RESUME_FROM_CHECKPOINT

        # 收集问题
        issues: List[str] = []
        if not breakpoint_info["found"]:
            issues.append("未找到有效的检查点，需要全量重启")
        if unexpected_mods:
            issues.append(f"存在 {len(unexpected_mods)} 处非预期人工修改，建议人工确认后继续")
        if dep_issues_found:
            issues.append("依赖链存在不一致，建议重新验证依赖关系")

        report = BreakpointReport(
            generated_at=datetime.now(timezone.utc).isoformat(),
            completed_tasks=completed_tasks,
            pending_tasks=pending_tasks,
            detected_changes=detected_changes,
            suggested_strategy=strategy,
            can_resume=can_resume,
            issues=issues,
            reusable_artifacts=list(set(reusable_artifacts)),
        )

        # 缓存报告
        self._breakpoint_reports["latest"] = report

        logger.info(
            "断点评估报告生成完成 | 可恢复=%s 策略=%s 已完成=%d 待执行=%d",
            can_resume, strategy.value,
            len(completed_tasks), len(pending_tasks),
        )

        return report

    def format_breakpoint_report(self, report: BreakpointReport) -> str:
        """
        将断点评估报告格式化为 Markdown 文本
        参数：
          - report: 断点评估报告
        返回值：Markdown 格式的报告文本
        """
        lines: List[str] = []

        lines.append("# 断点评估报告")
        lines.append("")
        lines.append(f"**生成时间**: {report.generated_at}")
        lines.append(f"**可恢复**: {'✅ 是' if report.can_resume else '❌ 否'}")
        lines.append(f"**建议策略**: {report.suggested_strategy.value}")
        lines.append("")
        lines.append("---")
        lines.append("")

        # 已完成任务
        lines.append("## 已完成任务")
        lines.append("")
        if report.completed_tasks:
            for task in report.completed_tasks:
                lines.append(f"- ✅ {task}")
        else:
            lines.append("- （无）")
        lines.append("")

        # 待执行任务
        lines.append("## 待执行任务")
        lines.append("")
        if report.pending_tasks:
            for task in report.pending_tasks:
                lines.append(f"- ⏳ {task}")
        else:
            lines.append("- （无）")
        lines.append("")

        # 检测到的变更
        lines.append("## 检测到的变更")
        lines.append("")
        if report.detected_changes:
            for change in report.detected_changes:
                lines.append(f"- {change}")
        else:
            lines.append("- 未检测到变更")
        lines.append("")

        # 可复用产物
        lines.append("## 可复用的历史产物")
        lines.append("")
        if report.reusable_artifacts:
            for artifact in report.reusable_artifacts[:20]:  # 最多显示 20 个
                lines.append(f"- 📄 {artifact}")
            if len(report.reusable_artifacts) > 20:
                lines.append(f"- ... 及其他 {len(report.reusable_artifacts) - 20} 个文件")
        else:
            lines.append("- （无可复用产物）")
        lines.append("")

        # 问题与建议
        if report.issues:
            lines.append("## 问题与建议")
            lines.append("")
            for issue in report.issues:
                lines.append(f"- ⚠️ {issue}")
            lines.append("")

        return "\n".join(lines)

    # ============================================================
    # 6. 从检查点恢复
    # ============================================================

    def recover_from_checkpoint(self, task_id: str) -> Dict[str, Any]:
        """
        从检查点恢复任务状态，复用历史产物
        运行步骤：
          1. 查找指定任务的检查点
          2. 验证检查点状态
          3. 恢复任务状态（进度、结果摘要等）
          4. 验证产物文件完整性
          5. 复用历史产物（跳过已完成的文件生成）
          6. 返回恢复后的任务状态
        参数：
          - task_id: 任务 ID
        返回值：恢复结果字典
          {
            "success": bool,
            "task_id": str,
            "recovered_state": Dict,         # 恢复后的任务状态
            "reusable_artifacts": List[str], # 可复用的产物列表
            "missing_artifacts": List[str],  # 缺失的产物列表
            "recovered_at": str,             # 恢复时间
          }
        """
        checkpoint = self._checkpoints.get(task_id)
        if checkpoint is None:
            logger.warning("恢复失败: 未找到检查点 task=%s", task_id[:8] if task_id else "N/A")
            return {
                "success": False,
                "task_id": task_id,
                "recovered_state": {},
                "reusable_artifacts": [],
                "missing_artifacts": [],
                "recovered_at": datetime.now(timezone.utc).isoformat(),
            }

        # 验证检查点状态
        if checkpoint.status == CheckpointStatus.CORRUPTED:
            logger.warning(
                "恢复警告: 检查点已损坏 task=%s，尝试部分恢复",
                task_id[:8] if task_id else "N/A",
            )

        # 验证产物文件
        reusable: List[str] = []
        missing: List[str] = []
        for file_path_str, expected_hash in checkpoint.artifact_hashes.items():
            file_path = Path(file_path_str)
            if file_path.exists():
                current_hash = self._compute_file_hash(file_path_str)
                if current_hash == expected_hash:
                    reusable.append(file_path_str)
                else:
                    logger.warning(
                        "产物文件哈希不匹配，不可复用: %s", file_path_str,
                    )
                    missing.append(file_path_str)
            else:
                missing.append(file_path_str)

        # 构建恢复后的任务状态
        recovered_state = {
            "progress": checkpoint.task_state.get("progress", 0.0),
            "result_summary": checkpoint.task_state.get("result_summary", ""),
            "completed_nodes": checkpoint.completed_nodes,
            "current_node": checkpoint.current_node,
            "pending_nodes": checkpoint.pending_nodes,
            "extra": checkpoint.task_state.get("extra", {}),
            "recovered_from_checkpoint": True,
            "checkpoint_saved_at": checkpoint.saved_at,
        }

        result = {
            "success": True,
            "task_id": task_id,
            "recovered_state": recovered_state,
            "reusable_artifacts": reusable,
            "missing_artifacts": missing,
            "recovered_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.info(
            "从检查点恢复 | task=%s 可复用产物=%d 缺失=%d",
            task_id[:8] if task_id else "N/A",
            len(reusable), len(missing),
        )

        return result

    # ============================================================
    # 7. 会话过期处理
    # ============================================================

    def handle_session_expiry(
        self, old_session_id: str, db_state: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        处理长任务会话过期：自动创建新会话，从数据库恢复状态
        运行步骤：
          1. 记录旧会话的过期信息
          2. 生成新会话 ID
          3. 从数据库状态恢复任务信息
          4. 迁移检查点数据到新会话
          5. 返回新会话信息和恢复状态
        参数：
          - old_session_id: 已过期的旧会话 ID
          - db_state: 从数据库恢复的状态数据（可选）
        返回值：处理结果字典
          {
            "success": bool,
            "old_session_id": str,
            "new_session_id": str,           # 新创建的会话 ID
            "recovered_tasks": int,          # 恢复的任务数
            "migrated_checkpoints": int,     # 迁移的检查点数
            "handled_at": str,               # 处理时间
          }
        """
        import uuid

        # 生成新会话 ID
        new_session_id = str(uuid.uuid4())

        # 记录过期信息
        expiry_record = {
            "old_session_id": old_session_id,
            "new_session_id": new_session_id,
            "expired_at": datetime.now(timezone.utc).isoformat(),
            "db_state_available": db_state is not None,
        }
        self._session_expiry_records[old_session_id] = expiry_record

        # 从数据库状态恢复任务信息
        recovered_tasks = 0
        if db_state:
            tasks = db_state.get("tasks", [])
            for task in tasks:
                task_id = task.get("id", "")
                if task_id and task_id in self._checkpoints:
                    # 更新检查点中的任务状态
                    checkpoint = self._checkpoints[task_id]
                    checkpoint.task_state["db_restored"] = True
                    checkpoint.task_state["old_session_id"] = old_session_id
                    checkpoint.task_state["new_session_id"] = new_session_id
                    recovered_tasks += 1

        # 迁移检查点数据
        migrated_checkpoints = 0
        for task_id, checkpoint in self._checkpoints.items():
            if checkpoint.task_state.get("old_session_id") == old_session_id:
                # 更新检查点关联到新会话
                checkpoint.task_state["new_session_id"] = new_session_id
                # 重新写入磁盘
                self._write_checkpoint_to_disk(task_id, checkpoint)
                migrated_checkpoints += 1

        result = {
            "success": True,
            "old_session_id": old_session_id,
            "new_session_id": new_session_id,
            "recovered_tasks": recovered_tasks,
            "migrated_checkpoints": migrated_checkpoints,
            "handled_at": datetime.now(timezone.utc).isoformat(),
        }

        logger.warning(
            "【会话过期处理】旧会话=%s → 新会话=%s | 恢复任务=%d 迁移检查点=%d",
            old_session_id[:8] if old_session_id else "N/A",
            new_session_id[:8],
            recovered_tasks, migrated_checkpoints,
        )

        return result

    def get_session_expiry_record(
        self, old_session_id: str,
    ) -> Optional[Dict[str, Any]]:
        """
        获取会话过期处理记录
        参数：
          - old_session_id: 旧会话 ID
        返回值：过期处理记录或 None
        """
        return self._session_expiry_records.get(old_session_id)

    # ============================================================
    # 工具方法
    # ============================================================

    def _compute_file_hash(self, file_path: str) -> str:
        """
        计算文件的 SHA-256 哈希值
        运行步骤：
          1. 检查哈希缓存
          2. 读取文件内容
          3. 计算 SHA-256 哈希
          4. 更新缓存
        参数：
          - file_path: 文件路径
        返回值：十六进制哈希字符串
        """
        # 检查缓存
        if file_path in self._hash_cache:
            return self._hash_cache[file_path]

        try:
            sha256 = hashlib.sha256()
            with open(file_path, "rb") as f:
                # 分块读取，避免大文件内存溢出
                for chunk in iter(lambda: f.read(8192), b""):
                    sha256.update(chunk)
            file_hash = sha256.hexdigest()
            # 更新缓存
            self._hash_cache[file_path] = file_hash
            return file_hash
        except Exception as e:
            logger.error("计算文件哈希失败: %s | %s", file_path, e)
            return ""

    def _compute_global_config_hash(self) -> str:
        """
        计算全局配置的哈希值（用于检测全局变更）
        运行步骤：
          1. 读取全局配置文件
          2. 计算内容哈希
        返回值：十六进制哈希字符串
        """
        config_path = self._project_root / "config" / "auto_code_config.yaml"
        if not config_path.exists():
            config_path = self._project_root / "config" / "settings.yaml"

        if config_path.exists():
            return self._compute_file_hash(str(config_path))

        # 配置文件不存在，使用默认值
        return hashlib.sha256(b"default_config").hexdigest()

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

    def get_checkpoint(self, task_id: str) -> Optional[CheckpointData]:
        """
        获取指定任务的检查点
        参数：
          - task_id: 任务 ID
        返回值：CheckpointData 或 None
        """
        return self._checkpoints.get(task_id)

    def delete_checkpoint(self, task_id: str):
        """
        删除指定任务的检查点（任务完成后调用）
        参数：
          - task_id: 任务 ID
        """
        with self._lock:
            self._checkpoints.pop(task_id, None)

        # 删除磁盘文件
        checkpoint_file = self._checkpoint_dir / f"{task_id}.json"
        if checkpoint_file.exists():
            try:
                checkpoint_file.unlink()
                logger.debug("已删除检查点文件: %s", str(checkpoint_file))
            except Exception as e:
                logger.error("删除检查点文件失败: %s", e)

    def get_all_checkpoints(self) -> Dict[str, CheckpointData]:
        """
        获取所有检查点
        返回值：task_id -> CheckpointData 的字典
        """
        return dict(self._checkpoints)

    def get_checkpoint_stats(self) -> Dict[str, Any]:
        """
        获取检查点统计信息
        返回值：统计字典
        """
        status_counts = {
            status.value: 0 for status in CheckpointStatus
        }
        for checkpoint in self._checkpoints.values():
            status_counts[checkpoint.status.value] += 1

        return {
            "total_checkpoints": len(self._checkpoints),
            "status_distribution": status_counts,
            "modifications_detected": len(self._modification_records),
            "unexpected_modifications": len(self.get_unexpected_modifications()),
        }

    def refresh_global_config_hash(self):
        """
        刷新全局配置哈希（配置变更后调用）
        """
        self._current_global_hash = self._compute_global_config_hash()
        logger.info("全局配置哈希已刷新: %s", self._current_global_hash[:16])


# ============================================================
# 全局单例实例
# ============================================================

# 断点续跑管理器全局单例
checkpoint_manager = CheckpointManager()
