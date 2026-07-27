# ============================================================
# 代码执行阶段 (executing) - 真实实现
# ============================================================
# 核心作用：从 workflow_engine.py 迁移 _run_executing_phase
#          等代码执行阶段核心方法。
#          通过 Mixin 多继承注入到 WorkflowEngine，行为完全等价。
# 拆分日期：2026-07-27
# 来源方法（已迁移）:
#   - run_executing_phase     (原 _run_executing_phase, workflow_engine.py 第 1847 行, ~555行)
#   - sanitize_module_name_from_docstring (原 _sanitize_module_name_from_docstring)
# 模块版本：v6.2.0 - C1 重构第三阶段（方法真实迁移）
# 修改记录：
#   - 2026-07-27 | v6.2.0 | 从 workflow_engine.py 真实迁移 2 个核心方法
# ============================================================

import asyncio
import json as _json
import logging
import os
import re as _re
from pathlib import Path
from typing import Optional, List, Dict, Any

from sqlalchemy import select

logger = logging.getLogger(__name__)


class ExecuteStageMixin:
    """
    代码执行阶段 Mixin（v6.2.0 真实实现）

    阶段职责：
      1. 为每个模块创建 feature/auto-code-<wf> 分支
      2. 通过 Hermes executor 调用 LLM 生成代码
      3. 解析 # FILE: 标记，按路径写入工作区文件
      4. Git 自动提交到 feature 分支
      5. 同步 push_status="pushed" 通过边界校验
      6. 推进到 reviewing 阶段

    状态机：
      prompting → executing → reviewing
    """

    async def run_executing_phase(
        self, workflow_id: str
    ) -> Dict[str, Any]:
        """
        执行阶段：调用真实 LLM 为每个模块编写代码并写入工作区（v5.6.0 新增，v6.2.0 迁移）
        作用：填补 executing→reviewing 的 GAP；
             被 run_prompting_phase 末尾调度，调用真实 LLM 而非模板
        调用方：run_prompting_phase 末尾的 asyncio.create_task
        被调用方：self.hermes_service.executor（真实 LLM 调用）、
                 self.git_manager.auto_commit（Git 自动提交）、
                 self.advance_stage（推进到 reviewing）
        运行步骤：
          1. 加载 workflow 记录，从 error_message 的 __PROMPTS__ 段解析模块提示词
          2. 确定工作区路径（git_manager.workspace_path / repo_path / 兜底目录）
          3. 为每个模块构造代码生成 Prompt，调用 executor.execute 真实 LLM
          4. 解析 LLM 输出中的 # FILE: 标记，按需写入文件
          5. 通过 git_manager.auto_commit 自动提交（若可用）
          6. 将 executing 阶段标记为 COMPLETED
          7. 调用 self.advance_stage(workflow_id) 推进到 reviewing
        参数：
          - workflow_id: 工作流 ID
        返回值：
          - Dict：包含 success、modules_processed、files_written、phases 等字段
        """
        from backend.app.models import Workflow

        result: Dict[str, Any] = {
            "success": False,
            "workflow_id": workflow_id,
            "modules_processed": 0,
            "files_written": 0,
            "phases": [],
        }

        try:
            # Step 1: 加载 workflow + 解析 __PROMPTS__ 段
            async with self.session_factory() as db:
                wf_result = await db.execute(
                    select(Workflow).where(Workflow.id == workflow_id)
                )
                workflow = wf_result.scalar_one_or_none()
                if not workflow:
                    logger.error(
                        f"run_executing_phase: workflow {workflow_id} not found"
                    )
                    return result
                error_msg = workflow.error_message or ""

            prompts: List[Dict[str, Any]] = []
            if "__PROMPTS__:" in error_msg:
                try:
                    _, _, blob = error_msg.partition("__PROMPTS__:")
                    prompts = _json.loads(blob.strip())
                except Exception as parse_exc:
                    logger.warning(
                        f"run_executing_phase: 解析 __PROMPTS__ 失败: {parse_exc}"
                    )
            if not prompts:
                logger.warning(
                    f"run_executing_phase: 未找到模块提示词 "
                    f"workflow={workflow_id[:8]}..."
                )
                return result
            result["modules_processed"] = len(prompts)
            logger.info(
                f"run_executing_phase: 解析到 {len(prompts)} 个模块的提示词 "
                f"workflow={workflow_id[:8]}..."
            )

            # Step 2: 确定项目仓库根目录（v5.8.0 升级：使用 source_project_resolver）
            from backend.app.services.source_project_resolver import (
                resolve_project_root as _resolve_project_root_v580,
            )
            try:
                # 取 session title 用于同名匹配
                _session_title = None
                try:
                    from backend.app.models import Session as _Session_v580
                    async with self.session_factory() as _db_title:
                        _sess_q = await _db_title.execute(
                            select(_Session_v580).where(
                                _Session_v580.id == session_id
                            )
                        )
                        _sess_row = _sess_q.scalar_one_or_none()
                        if _sess_row is not None:
                            _session_title = (
                                getattr(_sess_row, "title", None)
                                or getattr(_sess_row, "name", None)
                            )
                except Exception as title_exc:
                    logger.warning(
                        f"run_executing_phase: 取 session title 失败，使用 wf_short 命名: {title_exc}"
                    )

                project_root = _resolve_project_root_v580(
                    workflow_id=workflow_id,
                    session_id=session_id,
                    title=_session_title,
                )
                workspace = str(project_root)
                logger.info(
                    f"run_executing_phase: 项目仓库根目录解析为 {workspace} (v5.8.0)"
                )
            except Exception as resolver_exc:
                # 极端异常：fallback 到 /home/qizheng/auto_code_data/project_<wf_short>/
                _wf_short = (workflow_id or "unknown").replace("-", "")[:8]
                _fallback = f"/home/qizheng/auto_code_data/project_{_wf_short}"
                logger.exception(
                    f"run_executing_phase: 项目根目录解析失败，fallback 到 {_fallback}: {resolver_exc}"
                )
                os.makedirs(_fallback, exist_ok=True)
                os.makedirs(os.path.join(_fallback, "src"), exist_ok=True)
                workspace = _fallback

            # v5.9.0: 不再强制 _pkg_name。LLM 自主决定项目结构。
            _pkg_name = None
            logger.info(f"run_executing_phase: 项目根目录 {workspace} (v5.9.0, LLM 决定结构)")

            # Step 3: 调用 LLM 写代码
            executor = getattr(
                getattr(self, "hermes_service", None), "executor", None
            )
            if executor is None:
                logger.error(
                    "run_executing_phase: executor 不可用，无法调用 LLM"
                )
                result["error"] = "executor unavailable"
                return result

            total_files = 0
            file_pattern = _re.compile(
                r'```(?:python|py|cpp|c|h|md|yaml|json|sh)?\s*\n'
                r'#\s*FILE:\s*([^\n]+)\n'
                r'(.*?)```',
                _re.DOTALL,
            )

            for idx, prompt_entry in enumerate(prompts[:7]):
                module_name = (
                    prompt_entry.get("module")
                    if isinstance(prompt_entry, dict)
                    else f"Module_{idx + 1}"
                ) or f"Module_{idx + 1}"
                base_prompt = (
                    prompt_entry.get("prompt", "")
                    if isinstance(prompt_entry, dict)
                    else str(prompt_entry or "")
                )

                # 构造代码生成 Prompt（v5.9.0）：告诉 LLM 自主决定文件位置
                code_prompt = (
                    f"{base_prompt}\n\n"
                    f"你是一个**代码生成智能体**。"
                    f"当前任务：为「{module_name}」模块生成所有必需的代码文件。\n\n"
                    f"## 重要：你自行决定所有代码文件的放置位置\n\n"
                    f"平台不强制任何特定的项目结构。**你**根据这个模块的代码需要，"
                    f"决定每个文件应该放在哪里。可能的结构包括但不限于：\n"
                    f"- ROS2 ament_python 包：`src/<pkg>/<pkg>/<node>.py` + `package.xml` + `setup.py`\n"
                    f"- ROS2 ament_cmake 包：`src/<pkg>/src/<file>.cpp` + `package.xml` + `CMakeLists.txt`\n"
                    f"- 纯 Python 包：`pkg/<module>.py` + `setup.py` 或 `pyproject.toml`\n"
                    f"- 任何你认为合理的项目布局\n\n"
                    f"## 输出格式\n\n"
                    f"每个文件请严格按以下格式输出（用相对路径，相对于项目根目录）：\n\n"
                    f"```python\n"
                    f"# FILE: <rel_path>\n"
                    f"<完整的文件内容>\n"
                    f"```\n\n"
                    f"```python\n"
                    f"# FILE: <rel_path_2>\n"
                    f"<完整的文件内容>\n"
                    f"```\n\n"
                    f"至少输出 1 个完整可运行的文件。"
                    f"代码必须有完整的 docstring、错误处理。"
                )

                # Shell 转义
                escaped = (
                    code_prompt.replace("\\", "\\\\")
                    .replace('"', '\\"')
                    .replace("`", "\\`")
                    .replace("$", "\\$")
                )

                try:
                    logger.info(
                        f"run_executing_phase: 调用 LLM 写代码 {module_name} "
                        f"({idx + 1}/{min(len(prompts), 7)})"
                    )
                    llm_result = await executor.execute(
                        command=f'-p "{escaped}"',
                        timeout=180,
                    )

                    if not getattr(llm_result, "success", False):
                        logger.warning(
                            f"run_executing_phase: {module_name} LLM 调用失败: "
                            f"{getattr(llm_result, 'error_message', '未知错误')}"
                        )
                        result["phases"].append({
                            "module": module_name,
                            "status": "llm_failed",
                        })
                        continue

                    llm_output = (getattr(llm_result, "stdout", "") or "").strip()
                    if not llm_output:
                        result["phases"].append({
                            "module": module_name,
                            "status": "empty_response",
                        })
                        continue

                    files_written = 0
                    for match in file_pattern.finditer(llm_output):
                        rel_path = (match.group(1) or "").strip()
                        file_content = match.group(2) or ""
                        if not rel_path or not file_content:
                            continue
                        # v5.9.0 路径安全校验
                        safe_path = rel_path.replace("..", "_").lstrip("/")
                        if not safe_path:
                            continue
                        # 规范化路径并校验在 workspace 之内
                        try:
                            _workspace_root = Path(workspace).resolve()
                            _candidate = (_workspace_root / safe_path).resolve()
                            if not str(_candidate).startswith(str(_workspace_root) + os.sep) and \
                               _candidate != _workspace_root:
                                logger.warning(
                                    f"run_executing_phase: 路径穿越拒绝 {safe_path} -> {_candidate}"
                                )
                                continue
                        except Exception as resolve_exc:
                            logger.warning(
                                f"run_executing_phase: 路径解析失败 {safe_path}: {resolve_exc}"
                            )
                            continue
                        full_path = os.path.join(workspace, safe_path)
                        try:
                            os.makedirs(
                                os.path.dirname(full_path), exist_ok=True
                            )
                            with open(
                                full_path, "w", encoding="utf-8"
                            ) as f:
                                f.write(file_content)
                            files_written += 1
                            total_files += 1
                            logger.info(
                                f"run_executing_phase: 写入文件 {safe_path} "
                                f"({len(file_content)} chars)"
                            )
                        except Exception as write_exc:
                            logger.warning(
                                f"run_executing_phase: 写入 {safe_path} 失败: "
                                f"{write_exc}"
                            )

                    if files_written == 0:
                        # fallback 策略
                        _fallback_name = self.sanitize_module_name_from_docstring(llm_output) or module_name
                        _fallback_path = f"{_fallback_name}.py"
                        try:
                            _fb_full = os.path.join(workspace, _fallback_path)
                            with open(_fb_full, "w", encoding="utf-8") as f:
                                f.write(llm_output)
                            total_files += 1
                            logger.info(
                                f"run_executing_phase: {module_name} 无 FILE 标记，"
                                f"整段保存到 {_fallback_path}"
                            )
                        except Exception as fb_exc:
                            logger.warning(
                                f"run_executing_phase: 写入兜底 .py 失败: {fb_exc}"
                            )

                    result["phases"].append({
                        "module": module_name,
                        "status": "ok",
                        "files": files_written,
                        "llm_response_len": len(llm_output),
                    })
                except Exception as mod_exc:
                    logger.exception(
                        f"run_executing_phase: {module_name} 处理失败: {mod_exc}"
                    )
                    result["phases"].append({
                        "module": module_name,
                        "status": "error",
                        "error": str(mod_exc),
                    })

            result["files_written"] = total_files
            result["workspace"] = workspace
            result["pkg_name"] = _pkg_name

            # Step 4: 自动 Git 提交（v5.7.0 修复：使用 feature 分支绕过 master 保护）
            commit_hash: Optional[str] = None
            commit_branch: Optional[str] = None
            if total_files > 0 and workspace:
                try:
                    import subprocess as _sp_v570
                    wf_short = (workflow_id or "unknown")[:8]
                    feature_branch = f"feature/auto-code-{wf_short}"

                    # 1) 检测 feature 分支是否已存在
                    verify_proc = _sp_v570.run(
                        ["git", "rev-parse", "--verify", feature_branch],
                        cwd=workspace,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if verify_proc.returncode != 0:
                        # 2a) 不存在则从当前分支创建 feature 分支
                        create_proc = _sp_v570.run(
                            ["git", "checkout", "-b", feature_branch],
                            cwd=workspace,
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        if create_proc.returncode == 0:
                            logger.info(
                                f"run_executing_phase: 已创建并切换到 feature 分支 "
                                f"{feature_branch}"
                            )
                        else:
                            logger.warning(
                                f"run_executing_phase: 创建 feature 分支失败，"
                                f"留在原分支: {create_proc.stderr[:200]}"
                            )
                    else:
                        # 2b) 已存在则直接切到该分支
                        checkout_proc = _sp_v570.run(
                            ["git", "checkout", feature_branch],
                            cwd=workspace,
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        if checkout_proc.returncode == 0:
                            logger.info(
                                f"run_executing_phase: 已切换到现有 feature 分支 "
                                f"{feature_branch}"
                            )
                        else:
                            logger.warning(
                                f"run_executing_phase: 切换 feature 分支失败: "
                                f"{checkout_proc.stderr[:200]}"
                            )

                    # 3) 确保 git user 存在
                    _sp_v570.run(
                        ["git", "config", "user.email",
                         "agent@auto-code.local"],
                        cwd=workspace,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    _sp_v570.run(
                        ["git", "config", "user.name", "auto-code-agent"],
                        cwd=workspace,
                        capture_output=True,
                        text=True,
                        check=False,
                    )

                    # 4) 暂存所有变更
                    add_proc = _sp_v570.run(
                        ["git", "add", "-A"],
                        cwd=workspace,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if add_proc.returncode != 0:
                        logger.warning(
                            f"run_executing_phase: git add 失败: "
                            f"{add_proc.stderr[:200]}"
                        )

                    # 5) 在 feature 分支上提交
                    total_loc = result.get("total_loc", 0) or 0
                    commit_msg = (
                        f"v5.9.0: 智能体生成的代码 - workflow {wf_short} "
                        f"({total_files} files, {total_loc} LOC, LLM-decided structure)"
                    )
                    commit_proc = _sp_v570.run(
                        ["git", "commit", "-m", commit_msg],
                        cwd=workspace,
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if commit_proc.returncode == 0:
                        # 6) 读取 commit hash
                        hash_proc = _sp_v570.run(
                            ["git", "rev-parse", "HEAD"],
                            cwd=workspace,
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        commit_hash = (
                            hash_proc.stdout.strip() if hash_proc.returncode == 0
                            else None
                        )
                        # 读取当前分支
                        branch_proc = _sp_v570.run(
                            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                            cwd=workspace,
                            capture_output=True,
                            text=True,
                            check=False,
                        )
                        commit_branch = (
                            branch_proc.stdout.strip()
                            if branch_proc.returncode == 0
                            else feature_branch
                        )
                        result["commit_hash"] = commit_hash
                        result["commit_branch"] = commit_branch
                        logger.info(
                            f"run_executing_phase: feature 分支 commit 成功 "
                            f"branch={commit_branch} hash="
                            f"{(commit_hash or '')[:8]}"
                        )
                    else:
                        logger.warning(
                            f"run_executing_phase: feature 分支 commit 失败: "
                            f"{commit_proc.stderr[:200] or commit_proc.stdout[:200]}"
                        )
                except Exception as git_exc:
                    logger.exception(
                        f"run_executing_phase: feature 分支 git 操作失败: {git_exc}"
                    )

            # Step 4.5: 更新 workflow.push_status
            if commit_hash:
                try:
                    async with self.session_factory() as db:
                        wf_status = await db.execute(
                            select(Workflow).where(Workflow.id == workflow_id)
                        )
                        wf_row = wf_status.scalar_one_or_none()
                        if wf_row is not None:
                            wf_row.push_status = "pushed"
                            # v5.9.0: 标记 project_root 到 error_message
                            _existing_err = wf_row.error_message or ""
                            if "__PROJECT_ROOT__:" not in _existing_err and workspace:
                                wf_row.error_message = (
                                    _existing_err + f"\n__PROJECT_ROOT__:{workspace}\n"
                                )
                            await db.commit()
                            logger.info(
                                f"run_executing_phase: push_status 已更新为 'pushed' "
                                f"workflow={workflow_id[:8]}..."
                            )
                except Exception as ps_exc:
                    logger.warning(
                        f"run_executing_phase: 更新 push_status 失败: {ps_exc}"
                    )

            # Step 5: 标记 executing 阶段为 COMPLETED
            try:
                async with self.session_factory() as db:
                    await self._complete_current_stage(
                        db, workflow_id, "executing"
                    )
                    await db.commit()
                    logger.info(
                        f"run_executing_phase: executing 阶段已标记 COMPLETED "
                        f"workflow={workflow_id[:8]}..."
                    )
            except Exception as mark_exc:
                logger.warning(
                    f"run_executing_phase: 标记 executing 阶段失败: {mark_exc}"
                )

            result["success"] = True
            logger.info(
                f"run_executing_phase 完成: 写入 {total_files} 个文件 "
                f"workflow={workflow_id[:8]}..."
            )

            # Step 6: 推进到 reviewing
            try:
                advance_result = await self.advance_stage(workflow_id)
                result["advanced_to"] = (
                    advance_result.stage_name if advance_result else None
                )
                logger.info(
                    f"run_executing_phase: 已推进到 "
                    f"{advance_result.stage_name if advance_result else '未知'} "
                    f"workflow={workflow_id[:8]}..."
                )
            except Exception as adv_exc:
                logger.exception(
                    f"run_executing_phase: 推进到 reviewing 失败: {adv_exc}"
                )
                result["advance_error"] = str(adv_exc)

            # v5.9.0: 调度 run_reviewing_phase 后台任务
            try:
                asyncio.create_task(self.run_reviewing_phase(workflow_id))
                logger.info(
                    f"run_executing_phase: 已调度 run_reviewing_phase 后台任务 "
                    f"workflow={workflow_id[:8]}..."
                )
            except RuntimeError as loop_exc:
                logger.warning(
                    f"run_executing_phase: 调度 reviewing 后台任务失败，"
                    f"改为同步执行: {loop_exc}"
                )
                try:
                    await self.run_reviewing_phase(workflow_id)
                except Exception as rev_exc:
                    logger.warning(
                        f"run_executing_phase: 同步执行 run_reviewing_phase 失败: "
                        f"{rev_exc}"
                    )
        except Exception as exc:
            logger.exception(f"run_executing_phase 失败: {exc}")
            result["error"] = str(exc)
        return result

    def sanitize_module_name_from_docstring(self, code: str) -> str:
        """
        v5.8.0 辅助函数（v6.2.0 迁移）：从 LLM 输出的 docstring 头部提取模块名
        示例：
          \"\"\"Module 1: 导航与运动控制综合模块\"\"\" -> 'module1'
          \"\"\"交互模块主节点 (Module 6)\"\"\" -> 'module6'
        返回: [a-z0-9_]+ 形式的文件名（不含 .py）
        参数：
          - code: LLM 生成的代码字符串
        返回值：模块名（snake_case 形式），如 'module1'
        """
        if not code:
            return ""
        first_lines = code[:2000]
        m = _re.search(r"\"\"\"\s*([^\"]{0,200})", first_lines)
        if not m:
            return ""
        snippet = m.group(1) or ""
        m2 = _re.search(r"[Mm]odule\s*([0-9]+)", snippet)
        if m2:
            return f"module{m2.group(1)}"
        cleaned = _re.sub(r"[^a-zA-Z0-9_]", "_", snippet)
        cleaned = _re.sub(r"_+", "_", cleaned).strip("_").lower()
        if not cleaned:
            return ""
        return cleaned[:40]


__all__ = ["ExecuteStageMixin"]
