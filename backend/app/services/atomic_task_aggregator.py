"""
# ============================================================
# 原子任务清单聚合器模块（v2.2.0）
# ============================================================
# 核心作用：整合所有 Claude Code CLI 实例生成的 plan/checklist/task
#           文档，建立模块-任务-状态三级映射，作为全流程唯一的
#           任务状态追踪源
# 运行流程：
#   1. 接收 workflow_id 和各模块文档内容
#   2. 解析各模块的 task.md 提取任务列表、依赖关系、验收标准
#   3. 构建依赖图用于阻塞检测
#   4. 合并为统一的 AtomicTaskList 并持久化到数据库
#   5. 支持 Hook 驱动的状态同步与进度重算
# 输入参数：
#   - session_factory: async_sessionmaker 实例，提供数据库会话
#   - task_hook_handler: 可选的任务 Hook 处理器实例
# 输出结果：AggregationResult 对象
# 修改记录：
#   - 2026-06-29 | v2.2.0 | 初始版本，实现原子任务清单聚合、状态同步、
#     阻塞检测、进度计算等核心功能
# ============================================================
"""

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from ..models import AtomicTaskList, Workflow

logger = logging.getLogger(__name__)


@dataclass
class ModuleTaskInfo:
    """
    模块任务信息
    字段说明：
      - module_name: 模块名称（如"需求澄清"、"架构设计"）
      - status: 模块状态（pending/running/completed/failed）
      - tasks: 该模块下的所有任务列表，每项含 id/name/description/status/priority/dependencies
      - plan_doc: 模块的 plan.md 文档内容
      - checklist_doc: 模块的 checklist.md 文档内容
      - task_doc: 模块的 task.md 文档内容
    """
    module_name: str
    status: str  # pending/running/completed/failed
    tasks: List[Dict[str, Any]]  # 该模块下的所有任务
    plan_doc: str = ""
    checklist_doc: str = ""
    task_doc: str = ""


@dataclass
class AggregationResult:
    """
    聚合结果
    字段说明：
      - success: 聚合是否成功
      - atomic_list_id: 原子任务清单 ID
      - total_modules: 总模块数
      - total_tasks: 总任务数
      - progress: 整体进度百分比（0.0 - 100.0）
      - blocked_tasks: 被阻塞的任务 ID 列表
      - message: 结果消息
    """
    success: bool
    atomic_list_id: str = ""
    total_modules: int = 0
    total_tasks: int = 0
    progress: float = 0.0
    blocked_tasks: List[str] = field(default_factory=list)
    message: str = ""


class AtomicTaskAggregator:
    """
    原子任务清单聚合器
    作用：整合所有 Claude Code CLI 实例生成的 plan/checklist/task 文档，
          建立模块-任务-状态三级映射，作为全流程唯一状态追踪源
    调用方：API 路由层、WorkflowEngine
    被调用方：数据库（AtomicTaskList CRUD）
    """

    def __init__(self, session_factory: async_sessionmaker, task_hook_handler=None):
        """
        初始化原子任务清单聚合器
        运行步骤：
          1. 保存异步数据库会话工厂引用
          2. 保存可选的任务 Hook 处理器引用（用于状态同步回调）
        参数：
          - session_factory: async_sessionmaker 实例，提供异步数据库会话
          - task_hook_handler: 可选的任务 Hook 处理器实例
        """
        self.session_factory = session_factory
        self.task_hook_handler = task_hook_handler

    async def aggregate(
        self,
        workflow_id: str,
        module_docs: List[Dict[str, Any]],
    ) -> AggregationResult:
        """
        聚合各模块文档为统一原子任务清单
        运行步骤：
          1. 校验 workflow_id 对应的 Workflow 是否存在
          2. 遍历 module_docs，解析每个模块的 task.md 文档
          3. 提取任务列表、依赖关系、验收标准
          4. 构建依赖图用于阻塞检测
          5. 计算初始进度
          6. 合并为统一的 AtomicTaskList 对象
          7. 持久化到数据库
        参数：
          - workflow_id: 工作流 ID
          - module_docs: 模块文档列表，每项含 module_name、plan_doc、checklist_doc、task_doc
        返回值：AggregationResult，包含聚合结果和统计信息
        """
        async with self.session_factory() as session:
            # 步骤 1：校验 Workflow 是否存在
            result = await session.execute(
                select(Workflow).where(Workflow.id == workflow_id)
            )
            workflow = result.scalar_one_or_none()
            if workflow is None:
                return AggregationResult(
                    success=False,
                    message=f"工作流 {workflow_id} 不存在",
                )

            # 步骤 2-3：解析各模块任务
            all_modules = []
            all_tasks = []
            for module_doc in module_docs:
                module_name = module_doc.get("module_name", "unknown")
                plan_doc = module_doc.get("plan_doc", "")
                checklist_doc = module_doc.get("checklist_doc", "")
                task_doc = module_doc.get("task_doc", "")

                # 从 task.md 文档中解析任务列表
                parsed_tasks = self._parse_module_tasks(
                    module_name, plan_doc, checklist_doc, task_doc
                )

                # 为每个任务生成唯一 ID（模块名 + 序号）
                for i, task in enumerate(parsed_tasks):
                    task["id"] = f"{module_name}-t{i+1}"
                    task["module_name"] = module_name

                all_tasks.extend(parsed_tasks)

                module_info = {
                    "module_name": module_name,
                    "status": "pending",  # 初始状态为 pending
                    "tasks": parsed_tasks,
                }
                all_modules.append(module_info)

            # 步骤 4：构建依赖图
            dependency_graph = self._build_dependency_graph(all_tasks)

            # 步骤 5：计算初始进度
            progress = self._calculate_progress(all_modules)

            # 步骤 6：检测阻塞性依赖
            blocked_tasks = self._detect_blocked_tasks(all_tasks, dependency_graph)

            # 步骤 7：持久化到数据库
            # 先检查是否已存在（一个 workflow 只允许一个原子清单）
            existing_result = await session.execute(
                select(AtomicTaskList).where(
                    AtomicTaskList.workflow_id == workflow_id
                )
            )
            existing = existing_result.scalar_one_or_none()

            if existing:
                # 更新已有记录
                existing.modules = all_modules
                existing.tasks_json = {
                    "tasks": all_tasks,
                    "dependency_graph": dependency_graph,
                    "total_tasks": len(all_tasks),
                    "total_modules": len(all_modules),
                }
                existing.progress = progress
                existing.status = "active"
                existing.updated_at = datetime.now(timezone.utc)
                atomic_list_id = existing.id
            else:
                # 创建新记录
                atomic_list = AtomicTaskList(
                    workflow_id=workflow_id,
                    modules=all_modules,
                    tasks_json={
                        "tasks": all_tasks,
                        "dependency_graph": dependency_graph,
                        "total_tasks": len(all_tasks),
                        "total_modules": len(all_modules),
                    },
                    progress=progress,
                    status="active",
                )
                session.add(atomic_list)
                await session.flush()
                atomic_list_id = atomic_list.id

            await session.commit()

            logger.info(
                f"原子任务清单聚合完成: workflow_id={workflow_id}, "
                f"modules={len(all_modules)}, tasks={len(all_tasks)}, "
                f"progress={progress:.1f}%, blocked={len(blocked_tasks)}"
            )

            return AggregationResult(
                success=True,
                atomic_list_id=atomic_list_id,
                total_modules=len(all_modules),
                total_tasks=len(all_tasks),
                progress=progress,
                blocked_tasks=blocked_tasks,
                message=f"聚合完成，共 {len(all_modules)} 个模块，{len(all_tasks)} 个任务",
            )

    async def update_task_status(
        self,
        workflow_id: str,
        task_id: str,
        new_status: str,
    ) -> bool:
        """
        Hook 驱动状态同步：任务完成 → 原子清单对应条目更新
        运行步骤：
          1. 查询 workflow 对应的原子任务清单
          2. 在 modules 和 tasks_json 中找到对应任务
          3. 更新任务状态
          4. 自动重新计算进度
          5. 重新检测阻塞性依赖
          6. 持久化更新
        参数：
          - workflow_id: 工作流 ID
          - task_id: 任务 ID（格式：模块名-t序号）
          - new_status: 新状态（pending/running/completed/failed）
        返回值：bool，更新是否成功
        """
        async with self.session_factory() as session:
            # 步骤 1：查询原子任务清单
            result = await session.execute(
                select(AtomicTaskList).where(
                    AtomicTaskList.workflow_id == workflow_id
                )
            )
            atomic_list = result.scalar_one_or_none()
            if atomic_list is None:
                logger.warning(f"未找到原子任务清单: workflow_id={workflow_id}")
                return False

            # 步骤 2-3：更新任务状态
            modules = atomic_list.modules or []
            tasks_json = atomic_list.tasks_json or {}
            all_tasks = tasks_json.get("tasks", [])
            found = False

            # 在 modules 中更新
            for module in modules:
                for task in module.get("tasks", []):
                    if task.get("id") == task_id:
                        task["status"] = new_status
                        found = True
                        break
                if found:
                    break

            # 在 tasks_json 中同步更新
            for task in all_tasks:
                if task.get("id") == task_id:
                    task["status"] = new_status
                    break

            if not found:
                logger.warning(f"未找到任务: task_id={task_id}")
                return False

            # 步骤 4：重新计算进度
            atomic_list.progress = self._calculate_progress(modules)

            # 步骤 5：重新检测阻塞性依赖
            dep_graph = tasks_json.get("dependency_graph", {})
            blocked = self._detect_blocked_tasks(all_tasks, dep_graph)

            # 更新 tasks_json
            atomic_list.tasks_json = {
                **tasks_json,
                "tasks": all_tasks,
                "blocked_tasks": blocked,
            }
            atomic_list.modules = modules
            atomic_list.updated_at = datetime.now(timezone.utc)

            # 步骤 6：持久化
            await session.commit()

            logger.info(
                f"任务状态已更新: task_id={task_id}, new_status={new_status}, "
                f"progress={atomic_list.progress:.1f}%, blocked={len(blocked)}"
            )
            return True

    async def get_atomic_list(self, workflow_id: str) -> Optional[Dict[str, Any]]:
        """
        查询原子任务清单完整数据
        运行步骤：
          1. 根据 workflow_id 查询原子任务清单
          2. 组装返回包含 modules、tasks_json、progress、status 的字典
        参数：
          - workflow_id: 工作流 ID
        返回值：可选字典，包含原子任务清单完整数据，不存在时返回 None
        """
        async with self.session_factory() as session:
            result = await session.execute(
                select(AtomicTaskList).where(
                    AtomicTaskList.workflow_id == workflow_id
                )
            )
            atomic_list = result.scalar_one_or_none()
            if atomic_list is None:
                return None

            tasks_json = atomic_list.tasks_json or {}
            dep_graph = tasks_json.get("dependency_graph", {})
            all_tasks = tasks_json.get("tasks", [])
            # 动态计算阻塞任务（确保实时性）
            blocked = self._detect_blocked_tasks(all_tasks, dep_graph)

            return {
                "id": atomic_list.id,
                "workflow_id": atomic_list.workflow_id,
                "modules": atomic_list.modules or [],
                "tasks_json": {
                    **tasks_json,
                    "blocked_tasks": blocked,
                },
                "progress": atomic_list.progress,
                "status": atomic_list.status,
                "created_at": atomic_list.created_at.isoformat() if atomic_list.created_at else None,
                "updated_at": atomic_list.updated_at.isoformat() if atomic_list.updated_at else None,
            }

    async def get_progress(self, workflow_id: str) -> float:
        """
        获取当前整体完成进度百分比
        运行步骤：
          1. 查询原子任务清单
          2. 返回 progress 字段值
        参数：
          - workflow_id: 工作流 ID
        返回值：float，进度百分比（0.0 - 100.0），不存在时返回 0.0
        """
        async with self.session_factory() as session:
            result = await session.execute(
                select(AtomicTaskList.progress).where(
                    AtomicTaskList.workflow_id == workflow_id
                )
            )
            progress = result.scalar()
            return float(progress) if progress is not None else 0.0

    async def detect_blocked_tasks(self, workflow_id: str) -> List[str]:
        """
        检测存在未完成强依赖的任务
        运行步骤：
          1. 查询原子任务清单
          2. 提取所有任务和依赖图
          3. 遍历任务，检测每个任务的依赖是否全部完成
          4. 返回被阻塞的任务 ID 列表
        参数：
          - workflow_id: 工作流 ID
        返回值：List[str]，被阻塞的任务 ID 列表
        """
        async with self.session_factory() as session:
            result = await session.execute(
                select(AtomicTaskList).where(
                    AtomicTaskList.workflow_id == workflow_id
                )
            )
            atomic_list = result.scalar_one_or_none()
            if atomic_list is None:
                return []

            tasks_json = atomic_list.tasks_json or {}
            all_tasks = tasks_json.get("tasks", [])
            dep_graph = tasks_json.get("dependency_graph", {})

            return self._detect_blocked_tasks(all_tasks, dep_graph)

    def _parse_module_tasks(
        self,
        module_name: str,
        plan_doc: str,
        checklist_doc: str,
        task_doc: str,
    ) -> List[Dict[str, Any]]:
        """
        从 task.md 文档中解析任务列表
        运行步骤：
          1. 按行解析 task.md 文档内容
          2. 查找以 "- [ ]" 或 "- [x]" 开头的 checklist 格式行
          3. 提取任务名称、描述、优先级标记
          4. 查找 "依赖" 或 "dependencies" 关键字提取依赖关系
          5. 查找 "验收标准" 或 "acceptance" 关键字提取验收标准
          6. 组装为结构化任务字典列表
        参数：
          - module_name: 模块名称
          - plan_doc: plan.md 文档内容
          - checklist_doc: checklist.md 文档内容
          - task_doc: task.md 文档内容
        返回值：List[Dict]，任务字典列表，每项含 name/description/status/priority/dependencies/acceptance_criteria
        """
        tasks = []
        if not task_doc or not task_doc.strip():
            # 如果 task.md 为空，尝试从 checklist.md 中提取
            source_doc = checklist_doc if checklist_doc else ""
            if not source_doc:
                return tasks
        else:
            source_doc = task_doc

        # 按行解析
        lines = source_doc.split("\n")
        current_task = None
        in_deps_section = False
        in_acceptance_section = False
        current_section_tasks = []

        for line in lines:
            stripped = line.strip()

            # 检测依赖关系章节
            if "依赖" in stripped or "dependency" in stripped.lower():
                in_deps_section = True
                in_acceptance_section = False
                continue

            # 检测验收标准章节
            if "验收" in stripped or "acceptance" in stripped.lower():
                in_deps_section = False
                in_acceptance_section = True
                continue

            # 检测任务列表项（checklist 格式或编号格式）
            task_match = False
            task_name = ""
            task_checked = False

            # 格式 1: "- [ ] 任务名称" 或 "- [x] 任务名称"
            if stripped.startswith("- [ ] ") or stripped.startswith("- [x] "):
                task_match = True
                task_checked = stripped.startswith("- [x] ")
                task_name = stripped[6:].strip() if stripped.startswith("- [x] ") else stripped[6:].strip()

            # 格式 2: "- 任务名称" 或 "1. 任务名称"
            elif (stripped.startswith("- ") and not stripped.startswith("- [")) or (
                len(stripped) > 2 and stripped[0].isdigit() and stripped[1:3] in (". ", "、")
            ):
                task_match = True
                task_name = stripped[2:].strip() if stripped.startswith("- ") else stripped[stripped.index(" ") + 1:].strip()

            # 格式 3: "## 任务名称"（Markdown 二级标题）
            elif stripped.startswith("## "):
                task_match = True
                task_name = stripped[3:].strip()

            if task_match and task_name:
                # 保存上一个任务
                if current_task is not None:
                    tasks.append(current_task)

                # 提取优先级标记
                priority = "medium"  # 默认中等优先级
                task_name_lower = task_name.lower()
                if "【高】" in task_name or "[高]" in task_name or "high" in task_name_lower or "紧急" in task_name:
                    priority = "high"
                    # 清理优先级标记
                    for marker in ["【高】", "[高]", "[high]", "(high)"]:
                        task_name = task_name.replace(marker, "").strip()
                elif "【低】" in task_name or "[低]" in task_name or "low" in task_name_lower:
                    priority = "low"
                    for marker in ["【低】", "[低]", "[low]", "(low)"]:
                        task_name = task_name.replace(marker, "").strip()

                current_task = {
                    "name": task_name,
                    "description": task_name,
                    "status": "completed" if task_checked else "pending",
                    "priority": priority,
                    "dependencies": [],
                    "acceptance_criteria": "",
                }
                in_deps_section = False
                in_acceptance_section = False

            elif current_task is not None and stripped:
                # 在依赖关系章节中，提取依赖任务名称
                if in_deps_section and stripped.startswith("- "):
                    dep_name = stripped[2:].strip()
                    if dep_name and dep_name not in current_task["dependencies"]:
                        current_task["dependencies"].append(dep_name)

                # 在验收标准章节中，追加验收标准内容
                elif in_acceptance_section:
                    if current_task["acceptance_criteria"]:
                        current_task["acceptance_criteria"] += "\n" + stripped
                    else:
                        current_task["acceptance_criteria"] = stripped

        # 保存最后一个任务
        if current_task is not None:
            tasks.append(current_task)

        # 如果未能从 task.md 解析到任务，尝试从 plan_doc 中提取模块级任务
        if not tasks and plan_doc:
            tasks.append({
                "name": f"{module_name} - 完整实施",
                "description": plan_doc[:200] if plan_doc else f"{module_name} 模块实施",
                "status": "pending",
                "priority": "medium",
                "dependencies": [],
                "acceptance_criteria": "",
            })

        return tasks

    def _build_dependency_graph(
        self,
        tasks: List[Dict[str, Any]],
    ) -> Dict[str, List[str]]:
        """
        构建任务依赖图
        作用：根据各任务的 dependencies 字段构建邻接表形式的依赖图，
              用于阻塞检测和拓扑排序
        运行步骤：
          1. 初始化空的依赖图字典
          2. 为每个任务建立依赖映射（通过任务名称匹配）
          3. 返回 {task_id: [依赖任务id列表]} 格式的依赖图
        参数：
          - tasks: 任务列表，每项含 id、name、dependencies
        返回值：Dict[str, List[str]]，依赖图邻接表
        """
        dep_graph: Dict[str, List[str]] = {}

        # 建立任务名称到 ID 的映射
        name_to_id: Dict[str, str] = {}
        for task in tasks:
            task_id = task.get("id", "")
            task_name = task.get("name", "")
            if task_id:
                name_to_id[task_name] = task_id
                # 也支持模块前缀匹配
                if "/" in task_name:
                    short_name = task_name.split("/")[-1].strip()
                    name_to_id[short_name] = task_id

        # 构建依赖图
        for task in tasks:
            task_id = task.get("id", "")
            if not task_id:
                continue
            dep_ids = []
            for dep_name in task.get("dependencies", []):
                # 通过名称匹配找到依赖任务的 ID
                if dep_name in name_to_id:
                    dep_ids.append(name_to_id[dep_name])
                else:
                    # 模糊匹配：检查是否包含关键词
                    for name, tid in name_to_id.items():
                        if dep_name in name or name in dep_name:
                            dep_ids.append(tid)
                            break
            dep_graph[task_id] = dep_ids

        return dep_graph

    def _calculate_progress(self, modules: List[Dict[str, Any]]) -> float:
        """
        计算整体进度百分比
        运行步骤：
          1. 遍历所有模块中的所有任务
          2. 统计总任务数和已完成任务数
          3. 已完成任务数 / 总任务数 * 100
        参数：
          - modules: 模块列表，每项含 tasks 子列表
        返回值：float，进度百分比（0.0 - 100.0），无任务时返回 0.0
        """
        total_tasks = 0
        completed_tasks = 0

        for module in modules:
            module_tasks = module.get("tasks", [])
            for task in module_tasks:
                total_tasks += 1
                if task.get("status") in ("completed", "done"):
                    completed_tasks += 1

        if total_tasks == 0:
            return 0.0
        return (completed_tasks / total_tasks) * 100.0

    def _detect_blocked_tasks(
        self,
        tasks: List[Dict[str, Any]],
        dep_graph: Dict[str, List[str]],
    ) -> List[str]:
        """
        检测存在未完成强依赖的阻塞任务
        运行步骤：
          1. 遍历所有任务
          2. 对每个任务的依赖任务 ID 列表进行状态检查
          3. 如果任一强依赖未完成，该任务标记为 blocked
          4. 返回被阻塞的任务 ID 列表
        参数：
          - tasks: 任务列表
          - dep_graph: 依赖图邻接表
        返回值：List[str]，被阻塞的任务 ID 列表
        """
        # 建立任务 ID 到状态的映射
        id_to_status: Dict[str, str] = {}
        for task in tasks:
            task_id = task.get("id", "")
            if task_id:
                id_to_status[task_id] = task.get("status", "pending")

        blocked = []
        for task in tasks:
            task_id = task.get("id", "")
            if not task_id:
                continue

            # 已完成或已失败的任务不会被阻塞
            task_status = task.get("status", "pending")
            if task_status in ("completed", "done", "failed"):
                continue

            # 检查所有依赖是否已完成
            dep_ids = dep_graph.get(task_id, [])
            if not dep_ids:
                continue  # 无依赖的任务不会被阻塞

            all_deps_completed = True
            for dep_id in dep_ids:
                dep_status = id_to_status.get(dep_id, "pending")
                if dep_status not in ("completed", "done"):
                    all_deps_completed = False
                    break

            if not all_deps_completed:
                blocked.append(task_id)

        return blocked
