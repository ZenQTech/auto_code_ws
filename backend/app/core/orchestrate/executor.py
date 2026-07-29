"""
# Orchestrate Pipeline 执行器
# ============================================================
# 核心作用：执行 Pipeline，按 DAG 调度，支持并行和重试
# 关联：Cycle 14 P1-1
# 版本：v6.29.0
#
# 流程：
#   1. 验证 DAG + 解析执行计划
#   2. 按批次执行（每批内并行）
#   3. 每阶段：输入校验 → 执行 → 输出校验 → SLA 记录
#   4. 失败时按重试策略重试
#   5. 全部完成 / 失败后更新 Pipeline 状态
# ============================================================
"""

from __future__ import annotations

import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from .contracts import ContractBuilder, build_text_field, build_int_field, build_bool_field, build_list_field, build_dict_field
from .dag import build_execution_plan, detect_cycles, validate_dag
from .models import (
    ExecutionStatus,
    Pipeline,
    PipelineStatus,
    StageContract,
    StageExecution,
    StageRef,
)
from .registry import GLOBAL_REGISTRY, StageRegistry
from .retry import CircuitBreaker, RetryOrchestrator
from .sla import SLAMonitor
from .validator import ContractValidator, ValidationError


# ============================================================
# 执行器
# ============================================================

class PipelineExecutor:
    """Pipeline 执行器

    用法：
        executor = PipelineExecutor(registry, sla_monitor, retry_orchestrator)
        result = executor.execute(pipeline, stage_runners)
    """

    def __init__(
        self,
        registry: Optional[StageRegistry] = None,
        sla_monitor: Optional[SLAMonitor] = None,
        retry_orchestrator: Optional[RetryOrchestrator] = None,
        max_workers: int = 10,
    ) -> None:
        self.registry = registry or GLOBAL_REGISTRY
        self.sla = sla_monitor or SLAMonitor()
        self.retry = retry_orchestrator or RetryOrchestrator()
        self.max_workers = max_workers

    # ============================================================
    # Pipeline 执行
    # ============================================================

    def execute(
        self,
        pipeline: Pipeline,
        stage_runners: Optional[Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]]] = None,
    ) -> Pipeline:
        """执行 Pipeline（同步）

        stage_runners: stage_id -> 执行函数（接受 inputs dict，返回 outputs dict）
        """
        stage_runners = stage_runners or {}
        # 1. 验证 DAG
        valid, errors = validate_dag(pipeline)
        if not valid:
            pipeline.status = PipelineStatus.FAILED
            pipeline.error = f"DAG validation failed: {'; '.join(errors)}"
            return pipeline

        # 2. 解析执行计划
        try:
            pipeline.execution_plan = build_execution_plan(pipeline)
        except Exception as e:
            pipeline.status = PipelineStatus.FAILED
            pipeline.error = f"Failed to build execution plan: {e}"
            return pipeline

        # 3. 初始化执行记录
        pipeline.status = PipelineStatus.RUNNING
        pipeline.started_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        for stage_ref in pipeline.stages:
            pipeline.stage_executions[stage_ref.stage_id] = StageExecution(
                stage_id=stage_ref.stage_id,
                status=ExecutionStatus.PENDING,
            )

        # 4. 按批次执行
        shared_outputs: Dict[str, Dict[str, Any]] = {}
        for batch_idx, batch in enumerate(pipeline.execution_plan):
            # 收集本批次可执行的阶段（不依赖失败的 optional 阶段）
            active_stages = [
                stage_ref for stage_ref in pipeline.stages
                if stage_ref.stage_id in batch
            ]
            # 并行执行
            batch_results = self._execute_batch(
                pipeline, active_stages, shared_outputs, stage_runners
            )
            # 收集本批次结果
            for stage_id, outputs in batch_results.items():
                if outputs is not None:
                    shared_outputs[stage_id] = outputs

            # 检查批次是否有失败（非 optional）
            for stage_ref in active_stages:
                execution = pipeline.stage_executions[stage_ref.stage_id]
                if (
                    execution.status == ExecutionStatus.FAILED
                    and not stage_ref.optional
                ):
                    pipeline.status = PipelineStatus.FAILED
                    pipeline.error = f"Required stage '{stage_ref.stage_id}' failed"
                    pipeline.completed_at = time.strftime(
                        "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
                    )
                    return pipeline

        # 5. 完成
        pipeline.status = PipelineStatus.COMPLETED
        pipeline.completed_at = time.strftime(
            "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
        )
        # 聚合总指标
        if pipeline.started_at and pipeline.completed_at:
            try:
                start_t = time.mktime(time.strptime(pipeline.started_at, "%Y-%m-%dT%H:%M:%SZ"))
                end_t = time.mktime(time.strptime(pipeline.completed_at, "%Y-%m-%dT%H:%M:%SZ"))
                pipeline.total_latency_ms = int((end_t - start_t) * 1000)
            except Exception:
                pass
        return pipeline

    def _execute_batch(
        self,
        pipeline: Pipeline,
        batch: List[StageRef],
        shared_outputs: Dict[str, Dict[str, Any]],
        stage_runners: Dict[str, Callable],
    ) -> Dict[str, Optional[Dict[str, Any]]]:
        """执行一个批次（并行）"""
        results: Dict[str, Optional[Dict[str, Any]]] = {}

        # 如果批次只有 1 个阶段，直接执行（避免线程开销）
        if len(batch) == 1:
            stage_ref = batch[0]
            outputs = self._execute_stage(
                pipeline, stage_ref, shared_outputs, stage_runners
            )
            results[stage_ref.stage_id] = outputs
            return results

        # 并行执行多个阶段
        with ThreadPoolExecutor(max_workers=self.max_workers) as pool:
            futures = {
                pool.submit(
                    self._execute_stage,
                    pipeline,
                    stage_ref,
                    shared_outputs,
                    stage_runners,
                ): stage_ref
                for stage_ref in batch
            }
            for future in as_completed(futures):
                stage_ref = futures[future]
                try:
                    outputs = future.result()
                    results[stage_ref.stage_id] = outputs
                except Exception as e:
                    results[stage_ref.stage_id] = None
                    execution = pipeline.stage_executions[stage_ref.stage_id]
                    execution.status = ExecutionStatus.FAILED
                    execution.error = f"Batch execution error: {e}"

        return results

    def _execute_stage(
        self,
        pipeline: Pipeline,
        stage_ref: StageRef,
        shared_outputs: Dict[str, Dict[str, Any]],
        stage_runners: Dict[str, Callable],
    ) -> Optional[Dict[str, Any]]:
        """执行单个阶段（含重试）"""
        # 获取阶段合约
        contract = self.registry.get(stage_ref.stage_id)
        if not contract:
            execution = pipeline.stage_executions[stage_ref.stage_id]
            execution.status = ExecutionStatus.FAILED
            execution.error = f"Stage contract not found: {stage_ref.stage_id}"
            return None

        # 注册 SLA
        self.sla.register_sla(stage_ref.stage_id, contract.sla)

        # 合并 inputs：pipeline.inputs + 依赖阶段的 outputs
        merged_inputs = dict(pipeline.inputs)
        for dep_id in stage_ref.depends_on:
            if dep_id in shared_outputs:
                merged_inputs[f"dep_{dep_id}"] = shared_outputs[dep_id]
                # 合并到顶层
                for k, v in shared_outputs[dep_id].items():
                    if k not in merged_inputs:
                        merged_inputs[k] = v

        # 重试循环
        max_attempts = contract.retry_policy.max_attempts
        for attempt in range(1, max_attempts + 1):
            execution = pipeline.stage_executions[stage_ref.stage_id]
            execution.attempt = attempt
            execution.status = ExecutionStatus.RUNNING
            execution.started_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            )

            # 1. 熔断器检查
            if not self.retry.allow_execution(stage_ref.stage_id, contract.retry_policy):
                execution.status = ExecutionStatus.FAILED
                execution.error = "Circuit breaker is open"
                execution.error_code = "circuit_open"
                return None

            # 2. 输入校验
            validator = ContractValidator(contract)
            valid, errors = validator.validate_inputs_with_errors(merged_inputs)
            if not valid:
                execution.inputs_validated = False
                execution.status = ExecutionStatus.FAILED
                execution.error = f"Input validation failed: {errors}"
                execution.error_code = "input_validation"
                return None
            execution.inputs_validated = True

            # 3. 前置不变量
            pre_errors = validator.get_precondition_errors(merged_inputs)
            if pre_errors:
                execution.status = ExecutionStatus.FAILED
                execution.error = f"Precondition failed: {pre_errors}"
                execution.error_code = "precondition"
                return None

            # 4. 执行
            start_time = time.time()
            try:
                runner = stage_runners.get(stage_ref.stage_id)
                if runner is None:
                    # 默认执行器：返回空字典 + 一个状态标识
                    outputs = {"_status": "no_runner", "stage_id": stage_ref.stage_id}
                else:
                    outputs = runner(merged_inputs) or {}
            except Exception as e:
                # 执行异常 → 记录 + 重试
                latency_ms = int((time.time() - start_time) * 1000)
                execution.latency_ms = latency_ms
                self.retry.record_failure(
                    stage_ref.stage_id, contract.retry_policy, str(e)
                )
                self.sla.record_execution(
                    stage_ref.stage_id, latency_ms, success=False, error=str(e)
                )
                if attempt < max_attempts:
                    backoff_ms = self.retry.compute_backoff_ms(attempt, contract.retry_policy)
                    execution.status = ExecutionStatus.RETRYING
                    execution.error = f"Attempt {attempt} failed: {e}, retrying in {backoff_ms}ms"
                    time.sleep(backoff_ms / 1000.0)
                    continue
                else:
                    execution.status = ExecutionStatus.FAILED
                    execution.error = f"All {max_attempts} attempts failed. Last error: {e}"
                    execution.error_code = "max_attempts"
                    return None

            # 5. 输出校验
            latency_ms = int((time.time() - start_time) * 1000)
            execution.latency_ms = latency_ms
            valid, errors = validator.validate_outputs_with_errors(outputs)
            if not valid:
                # 输出校验失败 → 记录 + 重试
                self.retry.record_failure(
                    stage_ref.stage_id, contract.retry_policy, str(errors)
                )
                self.sla.record_execution(
                    stage_ref.stage_id, latency_ms, success=False, error=str(errors)
                )
                if attempt < max_attempts:
                    backoff_ms = self.retry.compute_backoff_ms(attempt, contract.retry_policy)
                    execution.status = ExecutionStatus.RETRYING
                    execution.error = f"Output validation failed: {errors}, retrying"
                    time.sleep(backoff_ms / 1000.0)
                    continue
                else:
                    execution.status = ExecutionStatus.FAILED
                    execution.error = f"Output validation failed: {errors}"
                    execution.error_code = "output_validation"
                    return None
            execution.outputs_validated = True

            # 6. 后置不变量
            post_errors = validator.get_postcondition_errors(outputs)
            if post_errors:
                execution.status = ExecutionStatus.FAILED
                execution.error = f"Postcondition failed: {post_errors}"
                execution.error_code = "postcondition"
                self.retry.record_failure(
                    stage_ref.stage_id, contract.retry_policy, str(post_errors)
                )
                self.sla.record_execution(
                    stage_ref.stage_id, latency_ms, success=False, error=str(post_errors)
                )
                return None

            # 7. 成功
            execution.status = ExecutionStatus.SUCCEEDED
            execution.completed_at = time.strftime(
                "%Y-%m-%dT%H:%M:%SZ", time.gmtime()
            )
            execution.outputs = outputs
            self.retry.record_success(stage_ref.stage_id, contract.retry_policy)
            self.sla.record_execution(
                stage_ref.stage_id, latency_ms, success=True
            )
            return outputs

        # 不应到达
        return None
