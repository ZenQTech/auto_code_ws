"""
# Orchestrate Pipeline DAG 引擎
# ============================================================
# 核心作用：实现 Pipeline 的有向无环图（DAG）调度
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 功能：
#   - 拓扑排序（Kahn 算法）
#   - 循环依赖检测
#   - 并行分组（同一批次可并行执行）
#   - 关键路径分析
# ============================================================
"""

from __future__ import annotations

from collections import defaultdict, deque
from typing import Any, Dict, List, Set, Tuple

from .models import Pipeline, StageRef


class CycleError(Exception):
    """DAG 循环依赖错误"""
    pass


class DAGValidationError(Exception):
    """DAG 验证错误"""
    pass


def build_execution_plan(pipeline: Pipeline) -> List[List[str]]:
    """构建执行计划（按批次分组可并行阶段）

    返回批次列表，每个批次内阶段可并行执行，批次间按顺序执行。
    例如：[[lint], [security, perf], [style], [summary]]
    """
    graph = _build_graph(pipeline.stages)
    in_degree = _compute_in_degree(pipeline.stages)
    return _topological_batches(graph, in_degree)


def detect_cycles(pipeline: Pipeline) -> List[List[str]]:
    """检测循环依赖

    返回所有循环路径（如果没有则返回空列表）。
    """
    graph = _build_graph(pipeline.stages)
    cycles = []
    visited: Set[str] = set()
    rec_stack: Set[str] = set()
    path: List[str] = []

    def dfs(node: str) -> None:
        visited.add(node)
        rec_stack.add(node)
        path.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                dfs(neighbor)
            elif neighbor in rec_stack:
                # 找到循环
                cycle_start = path.index(neighbor)
                cycles.append(path[cycle_start:] + [neighbor])
        path.pop()
        rec_stack.remove(node)

    for stage in pipeline.stages:
        if stage.stage_id not in visited:
            dfs(stage.stage_id)

    return cycles


def validate_dag(pipeline: Pipeline) -> Tuple[bool, List[str]]:
    """验证 DAG 合法性

    返回 (是否合法, 错误信息列表)。
    """
    errors = []

    # 1. 阶段 ID 唯一性
    stage_ids = [s.stage_id for s in pipeline.stages]
    if len(stage_ids) != len(set(stage_ids)):
        duplicates = [sid for sid in stage_ids if stage_ids.count(sid) > 1]
        errors.append(f"Duplicate stage IDs: {duplicates}")

    # 2. 依赖存在性
    valid_ids = set(stage_ids)
    for s in pipeline.stages:
        missing = [d for d in s.depends_on if d not in valid_ids]
        if missing:
            errors.append(f"Stage '{s.stage_id}' depends on missing stages: {missing}")

    # 3. 循环检测
    cycles = detect_cycles(pipeline)
    if cycles:
        errors.append(f"Circular dependencies detected: {cycles}")

    # 4. 自依赖
    for s in pipeline.stages:
        if s.stage_id in s.depends_on:
            errors.append(f"Stage '{s.stage_id}' depends on itself")

    return (len(errors) == 0, errors)


def get_critical_path(pipeline: Pipeline) -> List[str]:
    """计算关键路径（最长依赖链）

    返回关键路径上的阶段 ID 列表。
    """
    if not pipeline.stages:
        return []

    # 计算每个阶段到终点的最长路径
    dist: Dict[str, int] = {s.stage_id: 1 for s in pipeline.stages}
    next_node: Dict[str, str] = {}

    # 拓扑序
    try:
        batches = build_execution_plan(pipeline)
    except CycleError:
        return []

    topo_order: List[str] = []
    for batch in batches:
        topo_order.extend(batch)

    # 反向计算最长路径
    for node in reversed(topo_order):
        successors = [
            s.stage_id for s in pipeline.stages
            if node in s.depends_on
        ]
        if successors:
            max_succ = max(successors, key=lambda s: dist.get(s, 0))
            if dist[max_succ] + 1 > dist[node]:
                dist[node] = dist[max_succ] + 1
                next_node[node] = max_succ

    # 重构路径
    if not dist:
        return []
    start = max(dist, key=dist.get)
    path = [start]
    while start in next_node:
        start = next_node[start]
        path.append(start)
    return path


def get_parallelism(pipeline: Pipeline) -> Dict[str, Any]:
    """计算 Pipeline 并行度统计

    返回：
        - total_stages: 总阶段数
        - max_parallel: 最大并行度
        - avg_parallel: 平均并行度
        - critical_path_length: 关键路径长度
        - levels: 每批次阶段数
    """
    batches = build_execution_plan(pipeline)
    return {
        "total_stages": len(pipeline.stages),
        "max_parallel": max((len(b) for b in batches), default=0),
        "avg_parallel": sum(len(b) for b in batches) / max(len(batches), 1),
        "critical_path_length": len(get_critical_path(pipeline)),
        "levels": [len(b) for b in batches],
    }


# ============================================================
# 内部辅助函数
# ============================================================

def _build_graph(stages: List[StageRef]) -> Dict[str, List[str]]:
    """构建依赖图（stage_id -> [依赖的 stage_id]）"""
    return {s.stage_id: list(s.depends_on) for s in stages}


def _compute_in_degree(stages: List[StageRef]) -> Dict[str, int]:
    """计算每个节点的入度

    注意：入度 = 依赖该节点的数量（即被多少其他阶段依赖）。
    DAG 调度时，入度为 0 的节点可以首批执行。
    """
    # 这里我们把"依赖"反向理解为"被依赖"，以便使用 Kahn 算法
    in_degree: Dict[str, int] = {s.stage_id: 0 for s in stages}
    for s in stages:
        for dep in s.depends_on:
            if dep in in_degree:
                in_degree[s.stage_id] += 1
    return in_degree


def _topological_batches(
    graph: Dict[str, List[str]],
    in_degree: Dict[str, int],
) -> List[List[str]]:
    """拓扑排序 + 分批（同一批可并行）

    使用 Kahn 算法：每次取出入度为 0 的所有节点作为一批。
    """
    # 复制避免修改原数据
    in_deg = dict(in_degree)
    graph = {k: list(v) for k, v in graph.items()}

    # 反向图（用于快速找入度为 0 的节点）
    dependents: Dict[str, List[str]] = defaultdict(list)
    for node, deps in graph.items():
        for dep in deps:
            dependents[dep].append(node)

    # 初始化：入度为 0 的节点
    batches: List[List[str]] = []
    ready = sorted([n for n, d in in_deg.items() if d == 0])

    while ready:
        batches.append(ready)
        next_ready: List[str] = []
        for node in ready:
            # 遍历所有依赖该节点的节点
            for dependent in dependents.get(node, []):
                in_deg[dependent] -= 1
                if in_deg[dependent] == 0:
                    next_ready.append(dependent)
        ready = sorted(next_ready)

    # 检查是否所有节点都已处理
    total_processed = sum(len(b) for b in batches)
    if total_processed != len(in_degree):
        remaining = [n for n, d in in_degree.items() if d > 0]
        raise CycleError(f"Circular dependency detected, remaining nodes: {remaining}")

    return batches
