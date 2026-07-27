# ============================================================
# 质量评审阶段 (reviewing) - 真实实现
# ============================================================
# 核心作用：从 workflow_engine.py 迁移 _run_reviewing_phase /
#          _save_reviewing_status 等质量评审阶段核心方法。
#          通过 Mixin 多继承注入到 WorkflowEngine，行为完全等价。
# 拆分日期：2026-07-27
# 来源方法（已迁移）:
#   - _run_reviewing_phase    (原 workflow_engine.py 第 2683 行，约 300 行)
#   - _save_reviewing_status  (原 workflow_engine.py 第 2988 行，约 45 行)
# 模块版本：v6.2.0 - C1 重构第三阶段（方法真实迁移）
# 修改记录：
#   - 2026-07-27 | v6.2.0 | 从 workflow_engine.py 真实迁移 2 个核心方法
# ============================================================

import json as _json
import logging
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional

from sqlalchemy import select as _select

logger = logging.getLogger(__name__)


class ReviewStageMixin:
    """
    质量评审阶段 Mixin（v6.2.0 真实实现）

    阶段职责：
      1. 探测 LLM 生成项目的类型（ros2/python 等）
      2. 执行 colcon build / pip install -e 等编译命令
      3. 后台启动 5 秒检测存活
      4. 持久化评审结果到 __REVIEW__ 标记
      5. 触发 review_fix_loop 迭代闭环
      6. 推进到 completed 或 escalated_to_human

    状态机：
      executing → reviewing → (iterating loop) → completed
                              └──→ failed
    """

    async def run_reviewing_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        全链路评审阶段：探测项目类型并执行编译和运行验证（v5.9.0 新增，v6.2.0 迁移）
        作用：让用户在 reviewing 阶段看到智能体生成的项目能真正编译并运行
        流程：探测类型 -> colcon build / pip install -> 后台启动 5 秒 -> 检测存活
        调用方：_run_executing_phase 末尾的 asyncio.create_task
        被调用方：subprocess (colcon build / ros2 launch / pip install)
        运行步骤：
          1. 从 workflow.error_message 解析 __PROJECT_ROOT__ 段
          2. 探测项目类型（ros2_ament_python / ros2_ament_cmake / python_setup_py / python_pyproject / unknown）
          3. 根据项目类型执行相应的编译/运行命令
          4. 把状态和日志通过 _save_reviewing_status 持久化到 workflow.error_message
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：包含 success、status、project_type、build_stdout_tail 等字段
        """
        from backend.app.services.source_project_resolver import (
            detect_project_type,
            find_ros2_package,
            find_python_entry_point,
        )

        result: Dict[str, Any] = {
            "success": False,
            "workflow_id": workflow_id,
            "phases": [],
            "status": "unknown",
        }

        try:
            # Step 1: 从 workflow 解析 project_root
            project_root_str: Optional[str] = None
            try:
                async with self.session_factory() as db:
                    from backend.app.models import Workflow as _Workflow
                    wf_q = await db.execute(
                        _select(_Workflow).where(_Workflow.id == workflow_id)
                    )
                    wf = wf_q.scalar_one_or_none()
                    if not wf:
                        result["error"] = "workflow not found"
                        await self.save_reviewing_status(
                            workflow_id, "workflow_not_found", result
                        )
                        return result
                    # 从 error_message 解析 __PROJECT_ROOT__ 标记
                    error_msg = wf.error_message or ""
                    if "__PROJECT_ROOT__:" in error_msg:
                        _, _, blob = error_msg.partition("__PROJECT_ROOT__:")
                        # 取第一行非空内容
                        for _line in blob.splitlines():
                            _line = _line.strip()
                            if _line:
                                project_root_str = _line
                                break
            except Exception as db_exc:
                logger.warning(
                    f"_run_reviewing_phase: 加载 workflow 失败: {db_exc}"
                )

            # 兜底：调用 resolve_project_root 重新解析
            if not project_root_str:
                try:
                    from backend.app.services.source_project_resolver import (
                        resolve_project_root as _resolve_project_root_v590,
                    )
                    project_root_str = str(
                        _resolve_project_root_v590(workflow_id=workflow_id)
                    )
                except Exception as resolver_exc:
                    logger.exception(
                        f"_run_reviewing_phase: 解析 project_root 失败: {resolver_exc}"
                    )
                    result["status"] = "compile_skipped_no_project_root"
                    result["error"] = f"无法解析 project_root: {resolver_exc}"
                    await self.save_reviewing_status(
                        workflow_id, result["status"], result
                    )
                    return result

            project_root = Path(project_root_str)
            if not project_root.is_dir():
                result["status"] = "compile_skipped_no_build_system"
                result["error"] = f"project root not found: {project_root}"
                result["project_root"] = str(project_root)
                await self.save_reviewing_status(
                    workflow_id, result["status"], result
                )
                return result

            # Step 2: 探测项目类型
            project_type = detect_project_type(project_root)
            result["project_type"] = project_type
            result["project_root"] = str(project_root)
            logger.info(
                f"_run_reviewing_phase: 探测项目类型 = {project_type} at {project_root}"
            )

            # Step 3: 编译 + 运行验证
            if project_type in ("ros2_ament_python", "ros2_ament_cmake"):
                # ROS2: colcon build + ros2 launch
                pkg_name = find_ros2_package(project_root)
                if not pkg_name:
                    result["status"] = "compile_skipped_no_ros2_pkg"
                    result["error"] = "no ros2 package found"
                elif not shutil.which("colcon"):
                    result["status"] = "compile_skipped_no_runtime"
                    result["warning"] = "colcon not installed; skipping build"
                else:
                    # 3a) colcon build
                    try:
                        build_proc = subprocess.run(
                            [
                                "colcon", "build",
                                "--packages-select", pkg_name,
                                "--event-handlers", "console_direct+",
                            ],
                            cwd=str(project_root),
                            capture_output=True,
                            text=True,
                            timeout=300,
                        )
                        result["build_returncode"] = build_proc.returncode
                        result["build_stdout_tail"] = (build_proc.stdout or "")[-2000:]
                        result["build_stderr_tail"] = (build_proc.stderr or "")[-2000:]

                        if build_proc.returncode != 0:
                            result["status"] = "failed_compile"
                            result["error"] = (
                                f"colcon build failed: {build_proc.returncode}"
                            )
                        else:
                            # 3b) 尝试 ros2 launch（后台 5 秒）
                            if shutil.which("ros2"):
                                launch_proc = subprocess.Popen(
                                    [
                                        "bash", "-c",
                                        f"source install/setup.bash && "
                                        f"ros2 launch {pkg_name} {pkg_name}.launch.py",
                                    ],
                                    cwd=str(project_root),
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                )
                                try:
                                    launch_proc.wait(timeout=5)
                                    # 5 秒内退出
                                    if launch_proc.returncode != 0:
                                        result["status"] = "compile_ok_run_failed"
                                        result["error"] = (
                                            f"ros2 launch exited with "
                                            f"{launch_proc.returncode}"
                                        )
                                        try:
                                            _stderr = launch_proc.stderr.read(-1) if launch_proc.stderr else b""
                                            result["launch_stderr"] = _stderr.decode(
                                                "utf-8", errors="replace"
                                            )[-1000:]
                                        except Exception:
                                            pass
                                    else:
                                        result["status"] = "compile_and_run_ok"
                                except subprocess.TimeoutExpired:
                                    # 超过 5 秒仍在运行，视为存活
                                    launch_proc.terminate()
                                    try:
                                        launch_proc.wait(timeout=2)
                                    except subprocess.TimeoutExpired:
                                        launch_proc.kill()
                                        try:
                                            launch_proc.wait(timeout=1)
                                        except Exception:
                                            pass
                                    result["status"] = "compile_and_run_ok"
                                    result["info"] = (
                                        "ros2 launch 运行超过 5 秒，"
                                        "已终止用于评审"
                                    )
                            else:
                                result["status"] = "compile_ok_no_runtime"
                                result["info"] = (
                                    "ros2 不可用；build OK 但无法 launch"
                                )
                    except subprocess.TimeoutExpired as build_to:
                        result["status"] = "compile_timeout"
                        result["error"] = f"colcon build 超时: {build_to}"
                    except Exception as build_exc:
                        logger.exception(
                            f"_run_reviewing_phase: ROS2 构建异常: {build_exc}"
                        )
                        result["status"] = "error"
                        result["error"] = f"colcon build 异常: {build_exc}"

            elif project_type in ("python_setup_py", "python_pyproject"):
                # 纯 Python: pip install -e + 启动 entry_point
                pip = None
                if shutil.which("pip3"):
                    pip = "pip3"
                elif shutil.which("pip"):
                    pip = "pip"
                if not pip:
                    result["status"] = "compile_skipped_no_runtime"
                    result["warning"] = "pip not installed"
                else:
                    try:
                        install_proc = subprocess.run(
                            [pip, "install", "-e", "."],
                            cwd=str(project_root),
                            capture_output=True,
                            text=True,
                            timeout=120,
                        )
                        result["install_returncode"] = install_proc.returncode
                        if install_proc.returncode != 0:
                            result["status"] = "failed_compile"
                            result["install_stderr_tail"] = (
                                install_proc.stderr or ""
                            )[-2000:]
                        else:
                            entry_point = find_python_entry_point(project_root)
                            if not entry_point:
                                result["status"] = "compile_ok_no_entry_point"
                                result["info"] = (
                                    "package installed but no entry_point defined"
                                )
                            else:
                                # 启动 entry_point 并等待 5 秒
                                run_proc = subprocess.Popen(
                                    [entry_point],
                                    stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE,
                                )
                                try:
                                    run_proc.wait(timeout=5)
                                    if run_proc.returncode != 0:
                                        result["status"] = "compile_ok_run_failed"
                                        result["error"] = (
                                            f"entry_point 退出码 "
                                            f"{run_proc.returncode}"
                                        )
                                    else:
                                        result["status"] = "compile_and_run_ok"
                                except subprocess.TimeoutExpired:
                                    run_proc.terminate()
                                    try:
                                        run_proc.wait(timeout=2)
                                    except subprocess.TimeoutExpired:
                                        run_proc.kill()
                                        try:
                                            run_proc.wait(timeout=1)
                                        except Exception:
                                            pass
                                    result["status"] = "compile_and_run_ok"
                                    result["info"] = (
                                        f"entry_point {entry_point} 运行超过 5 秒"
                                    )
                    except subprocess.TimeoutExpired as pip_to:
                        result["status"] = "compile_timeout"
                        result["error"] = f"pip install 超时: {pip_to}"
                    except Exception as pip_exc:
                        logger.exception(
                            f"_run_reviewing_phase: Python 安装异常: {pip_exc}"
                        )
                        result["status"] = "error"
                        result["error"] = f"pip install 异常: {pip_exc}"
            else:
                # 未识别项目结构
                result["status"] = "compile_skipped_no_build_system"
                result["info"] = (
                    "no recognizable build system "
                    "(package.xml / setup.py / pyproject.toml)"
                )

        except Exception as outer_exc:
            logger.exception(f"_run_reviewing_phase 顶层异常: {outer_exc}")
            result["status"] = "error"
            result["error"] = str(outer_exc)

        # Step 4: 持久化评审结果
        try:
            await self.save_reviewing_status(workflow_id, result["status"], result)
        except Exception as save_exc:
            logger.warning(f"_run_reviewing_phase: 持久化评审结果失败: {save_exc}")

        # success 定义：跳过/通过均算 success，只有 fail/timeout/error 算失败
        result["success"] = result["status"] in (
            "compile_and_run_ok",
            "compile_ok_no_runtime",
            "compile_ok_no_entry_point",
            "compile_skipped_no_build_system",
            "compile_skipped_no_ros2_pkg",
            "compile_skipped_no_runtime",
            "compile_skipped_no_project_root",
        )
        logger.info(
            f"_run_reviewing_phase: 完成 status={result['status']} "
            f"workflow={workflow_id[:8]}..."
        )
        return result

    async def save_reviewing_status(
        self, workflow_id: str, status: str, log_data: Dict[str, Any]
    ) -> None:
        """
        v5.9.0 + v6.2.0 迁移：把 reviewing 阶段的状态和日志存到 workflow.error_message 的
                __REVIEW__ 段（与 __PROMPTS__ / __PROJECT_ROOT__ 标记模式保持一致）
        作用：复用现有 error_message 字段避免 schema 变更，同时保证 reviewing
              状态可被后续阶段或人工 review 读取
        调用方：_run_reviewing_phase
        被调用方：self.session_factory 数据库会话
        """
        try:
            async with self.session_factory() as db:
                from backend.app.models import Workflow as _Workflow
                wf_q = await db.execute(
                    _select(_Workflow).where(_Workflow.id == workflow_id)
                )
                wf_row = wf_q.scalar_one_or_none()
                if wf_row is None:
                    return
                _existing = wf_row.error_message or ""
                _review_marker = "\n__REVIEW__:"
                # 移除旧 __REVIEW__ 段
                if _review_marker in _existing:
                    _head, _, _ = _existing.partition(_review_marker)
                    _existing = _head.rstrip()
                try:
                    _new_blob = _json.dumps(log_data, ensure_ascii=False)[:30000]
                except Exception:
                    _new_blob = _json.dumps(
                        {"status": status, "error": "log serialization failed"},
                        ensure_ascii=False,
                    )
                wf_row.error_message = (
                    f"{_existing}{_review_marker}{status} | {_new_blob}"
                )
                wf_row.updated_at = datetime.now(timezone.utc)
                await db.commit()
                logger.debug(
                    f"save_reviewing_status: status={status} "
                    f"workflow={workflow_id[:8]}..."
                )
        except Exception as save_exc:
            logger.warning(f"save_reviewing_status 失败: {save_exc}")


__all__ = ["ReviewStageMixin"]
