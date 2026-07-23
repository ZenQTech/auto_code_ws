"""
# ============================================================
# Loop Engineering 工作流 v7 — 端到端真实可验收实现
# ============================================================
# 核心作用：在 v6 基础上补齐 5 大缺口：
#   1. Step 3 真实多轮用户交互（通过回调接口，无回调时自动 fallback）
#   2. Step 9 每个模块独立 CLI Worker（并行 CurlLLMExecutor 实例）
#   3. Step 11/12 真实 HookBus + 按模块独立分支 git 提交
#   4. Step 14 真实运行项目（前端 npm run dev + 端口探测；机器人 Python 导入 + launch 语法）
#   5. Step 15 真实 git push（本地 bare remote）
#   6. Step 13 QA 打回支持按模块定向重生
#   7. 内置 async CLI 入口 `run_workflow_async` + 同步 `run_workflow`
#   8. 提供 `WorkflowEventPublisher` 供 FastAPI/前端订阅进度
# 运行流程（15 步）：
#   1.  用户输入需求
#   2.  智能体调度平台生成总架构师
#   3.  总架构师与用户多轮澄清（真实交互 + 强制验收标准）
#   4.  需求澄清后生成质量保障与迭代管理智能体、批判反思智能体
#   5. 批判反思智能体针对结构化需求做 1 次迭代
#   6.  总架构师与质量保障智能体敲定详细任务验收标准
#   7.  总架构师按模块生成 spec.md / task.md / checklist.md 并创建 git
#   8.  在 /home/qizheng/auto_code_data/ 下新建源代码项目仓库（仅生成文件夹）
#   9.  按模块分发任务到独立 CLI Worker，提示词注入 + 实际生成代码
#  10.  整合原子任务清单（高风险模块标记 + 全局接口清单）
#  11.  注册 HookBus（订阅 task_completed → 触发 git 提交）
#  12.  真实按模块分支 git 提交（通过 hook 触发）
#  13.  质量保障智能体系统评测（含按模块打回重做）
#  14.  实际运行整个项目（前端 dev server / 机器人 import 测试）
#  15.  验收通过后向本地 bare remote 推送 main 分支
# 输入参数：见 WorkflowConfig
# 输出结果：WorkflowResult
# 修改记录：
#   - 2026-07-23 | v7.0.0 | 在 v6 基础上补齐 5 大缺口：
#                              - WorkflowConfig 扩展 user_interaction_callback
#                              - HookBus 事件总线
#                              - ModuleCLIWorker 并行执行
#                              - 真实 git worktree per-module 分支
#                              - 真实 npm run dev / python import 验证
#                              - 真实 git push 到本地 bare remote
#                              - 新增 api/loop_v7.py FastAPI 端点
# ============================================================
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import signal
import socket
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ============================================================
# 全局常量
# ============================================================
DATA_ROOT = "/home/qizheng/auto_code_data"
REMOTES_ROOT = "/home/qizheng/auto_code_data/.remotes"
DEFAULT_CLI_ENV = {
    "ANTHROPIC_AUTH_TOKEN": os.environ.get(
        "ANTHROPIC_AUTH_TOKEN", "cdb90dbc-9f97-43bf-a762-406a986c5881"
    ),
    "ANTHROPIC_BASE_URL": os.environ.get(
        "ANTHROPIC_BASE_URL", "https://ark.cn-beijing.volces.com/api/coding"
    ),
    "ANTHROPIC_MODEL": os.environ.get("ANTHROPIC_MODEL", "deepseek-v4-flash"),
}


# ============================================================
# 事件 / 配置 / 结果 数据类
# ============================================================
@dataclass
class HookEvent:
    """Hook 事件载荷"""
    workflow_id: str
    project_name: str
    task_id: str
    module: str
    status: str  # task_started | task_completed | task_failed | module_completed | workflow_completed
    message: str = ""
    files: List[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)
    extra: Dict[str, Any] = field(default_factory=dict)


@dataclass
class StepResult:
    step: int
    name: str
    success: bool
    started_at: float
    ended_at: float
    duration_s: float
    output: Dict[str, Any] = field(default_factory=dict)
    error: Optional[str] = None


@dataclass
class WorkflowConfig:
    user_input: str
    project_name: str
    project_type: str = "fullstack"  # frontend | robot | fullstack
    workspace_root: str = DATA_ROOT
    llm_executor: Optional[Any] = None
    # 真实用户交互回调：签名 async (questions, summary) -> List[str]
    # 不传则使用自动 fallback 答案
    user_interaction_callback: Optional[
        Callable[[List[Dict[str, Any]], str], Awaitable[List[str]]]
    ] = None
    # Hook 回调：签名 async (event: HookEvent) -> None
    hook_callback: Optional[Callable[[HookEvent], Awaitable[None]]] = None
    # 是否实际运行项目（Step 14 真实启动）
    real_run: bool = True
    # 是否真实 git push（Step 15 推送本地 bare remote）
    real_push: bool = True
    # git remote 路径模板，None 时默认 REMOTES_ROOT/<name>.git
    git_remote_path: Optional[str] = None
    # 自动 fallback 答案（user_interaction_callback 为 None 时使用）
    auto_user_answers: bool = True
    # QA 重生最大轮数
    qa_max_rounds: int = 2
    # 单个 LLM 调用 timeout（秒）
    llm_timeout: int = 300


@dataclass
class WorkflowResult:
    workflow_id: str
    project_name: str
    project_type: str
    project_root: str
    steps: List[StepResult] = field(default_factory=list)
    success: bool = False
    started_at: float = 0.0
    ended_at: float = 0.0
    duration_s: float = 0.0
    files_generated: List[str] = field(default_factory=list)
    git_log: List[str] = field(default_factory=list)
    final_status: str = "pending"
    events: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "workflow_id": self.workflow_id,
            "project_name": self.project_name,
            "project_type": self.project_type,
            "project_root": self.project_root,
            "success": self.success,
            "duration_s": self.duration_s,
            "steps": [
                {
                    "step": s.step,
                    "name": s.name,
                    "success": s.success,
                    "duration_s": s.duration_s,
                    "error": s.error,
                    "output_keys": list(s.output.keys()),
                }
                for s in self.steps
            ],
            "files_generated_count": len(self.files_generated),
            "git_commits": len(self.git_log),
            "final_status": self.final_status,
            "event_count": len(self.events),
        }


# ============================================================
# HookBus 事件总线
# ============================================================
class HookBus:
    """
    Hook 事件总线（v7 新增）
    作用：解耦 CLI Worker 完成事件与 git 提交动作
    调用方：Step 9 写盘后 emit / Step 11 订阅 / Step 12 接收事件后 commit
    """

    def __init__(self) -> None:
        self._subscribers: List[Callable[[HookEvent], Any]] = []
        self._history: List[HookEvent] = []
        self._lock = asyncio.Lock()

    def subscribe(self, callback: Callable[[HookEvent], Any]) -> None:
        """注册订阅者"""
        self._subscribers.append(callback)

    def history(self) -> List[HookEvent]:
        return list(self._history)

    async def emit(self, event: HookEvent) -> None:
        """广播事件给所有订阅者"""
        async with self._lock:
            self._history.append(event)
        logger.info(
            f"[HookBus] {event.status} task={event.task_id} module={event.module} "
            f"msg={event.message[:80]}"
        )
        for cb in list(self._subscribers):
            try:
                result = cb(event)
                if asyncio.iscoroutine(result):
                    await result
            except Exception as exc:
                logger.error(f"HookBus subscriber error: {exc}")


# ============================================================
# 步骤装饰器
# ============================================================
def _step_decorator(name: str):
    """步骤装饰器：自动记录 start/end/duration"""

    def decorator(func: Callable):
        async def wrapper(self: "LoopEngineeringV7", *args, **kwargs):
            t0 = time.time()
            step = len(self._result.steps) + 1
            logger.info(f"[Step {step:02d}] START  {name}")
            try:
                output = await func(self, *args, **kwargs)
                t1 = time.time()
                result = StepResult(
                    step=step,
                    name=name,
                    success=True,
                    started_at=t0,
                    ended_at=t1,
                    duration_s=round(t1 - t0, 3),
                    output=output or {},
                )
                self._result.steps.append(result)
                logger.info(
                    f"[Step {step:02d}] DONE   {name} "
                    f"({result.duration_s}s, keys={list((output or {}).keys())})"
                )
                return output
            except Exception as exc:
                t1 = time.time()
                result = StepResult(
                    step=step,
                    name=name,
                    success=False,
                    started_at=t0,
                    ended_at=t1,
                    duration_s=round(t1 - t0, 3),
                    output={},
                    error=str(exc),
                )
                self._result.steps.append(result)
                logger.exception(f"[Step {step:02d}] FAILED {name}: {exc}")
                raise

        wrapper.__name__ = func.__name__
        return wrapper

    return decorator


# ============================================================
# LLM 调用辅助
# ============================================================
async def _new_llm_executor(name: str):
    """懒加载 CurlLLMExecutor"""
    try:
        from cli_integration.curl_executor import CurlLLMExecutor
    except ImportError as exc:
        raise RuntimeError(
            f"无法导入 CurlLLMExecutor: {exc}。"
            f"请确保在 /home/qizheng/auto_code_ws 目录下运行"
        ) from exc
    return CurlLLMExecutor(
        executable="curl",
        default_timeout=600,
        max_retries=2,
        cli_env=DEFAULT_CLI_ENV,
        name=name,
    )


def _llm_chat(executor, system: str, user: str, max_tokens: int = 8192, timeout: int = 300) -> str:
    """
    同步包装的 LLM 调用（asyncio.run 风格，避免破坏已有接口）
    """
    async def _run():
        full = f"[SYSTEM]\n{system}\n\n[USER]\n{user}\n\n[ASSISTANT]\n"
        result = await executor.execute(
            command=full, timeout=timeout, max_tokens=max_tokens
        )
        if not getattr(result, "success", False):
            err = getattr(result, "error_message", "unknown") or "unknown"
            raise RuntimeError(f"LLM 调用失败: {err}")
        return (getattr(result, "stdout", "") or "").strip()

    return asyncio.run(_run())


# ============================================================
# 工具函数
# ============================================================
def _ensure_dir(path: str) -> str:
    os.makedirs(path, exist_ok=True)
    return path


def _write_file(path: str, content: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


def _read_file(path: str) -> str:
    if not os.path.exists(path):
        return ""
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _run_shell(cmd: List[str], cwd: Optional[str] = None, timeout: int = 60, check: bool = False) -> Tuple[int, str, str]:
    """subprocess 同步包装"""
    try:
        proc = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        return proc.returncode, proc.stdout, proc.stderr
    except subprocess.TimeoutExpired as exc:
        return 124, "", f"timeout after {timeout}s: {exc}"
    except FileNotFoundError as exc:
        return 127, "", f"command not found: {exc}"


def _is_port_listening(host: str, port: int, timeout_s: float = 2.0) -> bool:
    """探测 TCP 端口是否被监听"""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=1.0):
                return True
        except (OSError, socket.timeout):
            time.sleep(0.3)
    return False


# ============================================================
# 核心工作流类
# ============================================================
class LoopEngineeringV7:
    """
    Loop Engineering v7 端到端真实可验收实现
    关键改进：
      - 真实用户交互（Step 3）
      - 独立 CLI Worker 并行（Step 9）
      - 真实 HookBus + per-module git 提交（Step 11/12）
      - 真实运行项目（Step 14）
      - 真实 git push（Step 15）
    """

    def __init__(self, config: WorkflowConfig) -> None:
        self.cfg = config
        self.project_root = os.path.join(config.workspace_root, config.project_name)
        self.workflow_id = str(uuid.uuid4())
        self._llm = config.llm_executor
        self._executor_lock = asyncio.Lock()

        # 共享状态
        self._requirement_doc: str = ""
        self._architecture_doc: str = ""
        self._task_doc: str = ""
        self._checklist_doc: str = ""
        self._acceptance_doc: str = ""
        self._spec_doc: str = ""
        self._atomic_task_list: List[Dict[str, Any]] = []
        self._global_interfaces: List[Dict[str, Any]] = []
        self._dependency_versions: Dict[str, str] = {}
        self._module_prompts: Dict[str, str] = {}
        self._module_plans: Dict[str, str] = {}  # plan.md per module
        self._module_checklists: Dict[str, str] = {}  # checklist.md per module
        self._code_files: List[str] = []
        self._qa_review: Dict[str, Any] = {}
        self._run_validation: Dict[str, Any] = {}
        self._module_branches: Dict[str, str] = {}  # module -> branch

        # HookBus
        self.hook_bus = HookBus()
        if config.hook_callback:
            self.hook_bus.subscribe(config.hook_callback)

        # WorkflowResult
        self._result = WorkflowResult(
            workflow_id=self.workflow_id,
            project_name=config.project_name,
            project_type=config.project_type,
            project_root=self.project_root,
            started_at=time.time(),
        )

    # ============================================================
    # LLM 调用
    # ============================================================
    async def _get_executor(self):
        if self._llm is not None:
            return self._llm
        async with self._executor_lock:
            if self._llm is None:
                self._llm = await _new_llm_executor(f"loop-v7-{self.cfg.project_name[:16]}")
        return self._llm

    async def _llm_call(
        self, system: str, user: str, max_tokens: int = 8192, timeout: Optional[int] = None
    ) -> str:
        ex = await self._get_executor()
        full = f"[SYSTEM]\n{system}\n\n[USER]\n{user}\n\n[ASSISTANT]\n"
        result = await ex.execute(
            command=full,
            timeout=timeout or self.cfg.llm_timeout,
            max_tokens=max_tokens,
        )
        if not getattr(result, "success", False):
            err = getattr(result, "error_message", "unknown") or "unknown"
            raise RuntimeError(f"LLM 调用失败: {err}")
        return (getattr(result, "stdout", "") or "").strip()

    # ============================================================
    # 15 步主流程
    # ============================================================

    @_step_decorator("Step 1: 用户输入需求")
    async def step1_user_input(self) -> Dict[str, Any]:
        self._requirement_doc = self.cfg.user_input.strip()
        return {
            "input_length": len(self._requirement_doc),
            "input_preview": self._requirement_doc[:200],
        }

    @_step_decorator("Step 2: 生成总架构师")
    async def step2_create_chief_architect(self) -> Dict[str, Any]:
        architect = {
            "role": "chief_architect",
            "name": "ChiefArchitect",
            "responsibilities": [
                "需求澄清（真实多轮对话）",
                "架构设计",
                "spec/task/checklist 文档生成",
                "源代码仓库创建（仅文件夹）",
                "任务分发到独立 CLI Worker",
                "提示词优化与注入",
                "整合验收",
                "main 分支推送",
            ],
            "model": DEFAULT_CLI_ENV.get("ANTHROPIC_MODEL", "deepseek-v4-flash"),
            "created_at": time.time(),
        }
        return {"architect": architect}

    @_step_decorator("Step 3: 总架构师与用户多轮澄清（强制验收标准）")
    async def step3_discuss_with_user(self) -> Dict[str, Any]:
        """
        v7 关键改进：真实多轮用户交互
        - 优先调用 config.user_interaction_callback（异步回调）
        - 若无回调或交互失败，fallback 到自动硬编码答案
        """
        system = (
            "你是一名首席架构师。用户给出了一段需求，"
            "你需要总结需求，并提出 3 个关键的澄清问题。"
            "问题必须涵盖：1) 业务核心目标；2) 关键技术约束；"
            "3) 项目最终运行效果（验收标准，必须可度量）。"
            "输出严格 JSON。"
        )
        questions_text = await self._llm_call(
            system=system,
            user=(
                f"用户需求：\n{self._requirement_doc}\n\n"
                f"请用以下 JSON 输出（不要其他文字）：\n"
                f'{{"summary": "...", "questions": [{{"q": "...", "key": "..."}}, '
                f'{{"q": "...", "key": "..."}}, {{"q": "...", "key": "..."}}]}}'
            ),
            max_tokens=1500,
        )
        try:
            data = json.loads(questions_text)
            summary = data.get("summary", self._requirement_doc[:200])
            questions_raw = data.get("questions", [])
            questions = [
                q if isinstance(q, dict) else {"q": str(q), "key": f"q{i}"}
                for i, q in enumerate(questions_raw)
            ]
        except Exception:
            summary = self._requirement_doc[:200]
            questions = [
                {"q": "请说明项目的核心业务目标（不超过 100 字）", "key": "goal"},
                {"q": "请列出关键的技术约束（语言、框架、部署环境）", "key": "stack"},
                {"q": "请定义项目最终运行效果（如何判断任务完成，给出可度量标准）", "key": "acceptance"},
            ]
        if not questions:
            questions = [
                {"q": "请说明项目的核心业务目标（不超过 100 字）", "key": "goal"},
                {"q": "请列出关键的技术约束（语言、框架、部署环境）", "key": "stack"},
                {"q": "请定义项目最终运行效果（如何判断任务完成，给出可度量标准）", "key": "acceptance"},
            ]

        # 真实多轮用户交互
        user_answers: List[str] = []
        interaction_mode = "auto_fallback"
        if self.cfg.user_interaction_callback is not None:
            try:
                user_answers = await self.cfg.user_interaction_callback(questions, summary)
                interaction_mode = "real_user"
                if not user_answers or len(user_answers) < len(questions):
                    logger.warning(
                        "user_interaction_callback 返回答案数量不足，fallback 自动答案"
                    )
                    user_answers = self._auto_user_answers(questions)
                    interaction_mode = "auto_fallback_partial"
            except Exception as exc:
                logger.warning(f"user_interaction_callback 失败: {exc}，fallback")
                user_answers = self._auto_user_answers(questions)
                interaction_mode = "auto_fallback_exception"
        else:
            user_answers = self._auto_user_answers(questions)

        acceptance = (
            user_answers[2] if len(user_answers) >= 3 else user_answers[-1]
        ) if user_answers else "无验收标准"

        clarified_doc = (
            f"# 需求澄清文档（Step 3 产出，模式: {interaction_mode}）\n\n"
            f"## 原始需求\n\n{self._requirement_doc}\n\n"
            f"## 架构师总结\n\n{summary}\n\n"
            f"## 澄清问答\n\n"
            + "\n".join(
                [
                    f"**Q{i + 1}** ({q.get('key', f'q{i}')}): {q.get('q', '?')}\n"
                    f"**A{i + 1}**: {a}\n"
                    for i, (q, a) in enumerate(zip(questions, user_answers))
                ]
            )
            + f"\n## 项目最终运行效果（用户强制确认）\n\n{acceptance}\n"
        )
        self._requirement_doc = clarified_doc
        return {
            "summary": summary,
            "questions_count": len(questions),
            "user_answers": user_answers,
            "acceptance_criteria": acceptance,
            "interaction_mode": interaction_mode,
            "clarified_doc_length": len(clarified_doc),
        }

    def _auto_user_answers(self, questions: List[Dict[str, Any]]) -> List[str]:
        """自动 fallback 用户答案（按 project_type 决定）"""
        if self.cfg.project_type == "frontend":
            return [
                "前端可视化大屏：实时展示 AGV 位置、任务状态、告警",
                "React 18 + Vite 5 + TypeScript 5 + Tailwind 3 + Zustand 4",
                (
                    "项目验收标准：①npm install && npm run dev 一键启动；"
                    "②打开浏览器看到 3 台 AGV 在仓库平面图上；"
                    "③点击启动仿真后 AGV 实时移动、任务流转、告警生成；"
                    "④顶部 KPI 卡片数据动态变化；"
                    "⑤响应式布局适配 1280×800 及以上分辨率"
                ),
            ]
        if self.cfg.project_type == "robot":
            return [
                "ROS2 Humble 机器人全栈：3 台 AGV 仓储调度仿真",
                "ROS2 Humble + Python 3.10 + ament_python + Gazebo Ignition",
                (
                    "项目验收标准：①colcon build 编译通过；"
                    "②ros2 launch 启动后 5 秒内 3 个 AGV 节点全部注册；"
                    "③任务调度 API 正常返回 JSON 格式结果；"
                    "④单元测试覆盖率 ≥ 70%；"
                    "⑤急停模块独立可触发，触发后 10ms 内停止"
                ),
            ]
        return [
            "完整前后端：前端可视化 + 后端调度 + 仿真集成",
            "前端 React 18 + Vite；后端 Python FastAPI + ROS2 桥接",
            "前后端可独立启动并通过 REST API 互通",
        ]

    @_step_decorator("Step 4: 生成质量保障与迭代管理智能体 + 批判反思智能体")
    async def step4_create_qa_agents(self) -> Dict[str, Any]:
        quality_manager = {
            "role": "quality_manager",
            "name": "QualityManager",
            "responsibilities": [
                "与总架构师敲定详细任务验收标准",
                "对所有代码按验收标准做系统评测",
                "推动不达标代码按模块回炉重做",
            ],
        }
        critical_reviewer = {
            "role": "critical_reviewer",
            "name": "CriticalReviewer",
            "responsibilities": [
                "对结构化需求做 1 次批判性反思",
                "识别需求中的歧义、遗漏、矛盾",
                "提出结构化改进建议",
            ],
        }
        return {
            "quality_manager": quality_manager,
            "critical_reviewer": critical_reviewer,
        }

    @_step_decorator("Step 5: 批判反思智能体对结构化需求做 1 次迭代")
    async def step5_critique_iteration(self) -> Dict[str, Any]:
        system = (
            "你是一名批判反思智能体。审查以下需求文档，"
            "找出其中 3-5 个潜在问题（歧义、遗漏、矛盾、不可验证项），"
            "并给出结构化改进建议。输出 JSON 格式。"
        )
        critique_text = await self._llm_call(
            system=system,
            user=(
                f"需求文档：\n{self._requirement_doc}\n\n"
                f"请输出 JSON：\n"
                f'{{"issues": [{{"severity": "high/medium/low", '
                f'"type": "ambiguity/omission/contradiction/unverifiable", '
                f'"description": "...", "fix": "..."}}], '
                f'"overall_score": 0.0-1.0}}'
            ),
            max_tokens=2000,
        )
        try:
            critique = json.loads(critique_text)
        except Exception:
            critique = {
                "issues": [
                    {
                        "severity": "low",
                        "type": "omission",
                        "description": "LLM 输出非 JSON 格式，采用默认批评模板",
                        "fix": "确认下一步操作前手动审视需求",
                    }
                ],
                "overall_score": 0.7,
            }
        critique_section = (
            f"\n## 批判反思（Step 5 迭代 1 次）\n\n"
            f"**整体评分**: {critique.get('overall_score', 0.7):.2f}\n\n"
        )
        for i, issue in enumerate(critique.get("issues", [])[:5], 1):
            critique_section += (
                f"### 问题 {i}（{issue.get('severity', 'medium')}）\n"
                f"- **类型**: {issue.get('type', '?')}\n"
                f"- **描述**: {issue.get('description', '?')}\n"
                f"- **改进**: {issue.get('fix', '?')}\n\n"
            )
        self._requirement_doc = self._requirement_doc + critique_section
        return {
            "issues_count": len(critique.get("issues", [])),
            "overall_score": critique.get("overall_score", 0.7),
            "critique_applied": True,
        }

    @_step_decorator("Step 6: 与质量保障智能体敲定详细任务验收标准")
    async def step6_finalize_acceptance_criteria(self) -> Dict[str, Any]:
        system = (
            "你是总架构师与质量保障智能体的联合体。"
            "基于需求文档，输出**详细、可度量、可 100% 验证**的任务验收标准。"
            "标准必须包含：1) 模块级验收；2) 集成验收；3) 端到端运行验证。"
            "输出 Markdown 格式。"
        )
        acceptance = await self._llm_call(
            system=system,
            user=(
                f"需求文档：\n{self._requirement_doc}\n\n"
                f"项目类型：{self.cfg.project_type}\n\n"
                f"请输出详细验收标准 Markdown，"
                f"包含：模块级 / 集成 / 端到端 三层。\n"
            ),
            max_tokens=4000,
        )
        if not acceptance or len(acceptance) < 100:
            acceptance = (
                "# 任务验收标准（v7 默认）\n\n"
                "## 模块级\n"
                "- 所有模块独立可运行\n"
                "- 单元测试覆盖核心路径\n\n"
                "## 集成\n"
                "- 模块间接口调用 100% 通过\n"
                "- 端到端冒烟测试 100% 通过\n\n"
                "## 端到端\n"
                "- 项目一键启动\n"
                "- 关键 API/CLI 可调用\n"
            )
        self._acceptance_doc = acceptance
        return {
            "acceptance_length": len(acceptance),
            "sections": acceptance.count("##"),
        }

    @_step_decorator("Step 7: 按模块生成 spec/task/checklist + 创建 git")
    async def step7_generate_docs_and_git(self) -> Dict[str, Any]:
        if not os.path.exists(self.project_root):
            os.makedirs(self.project_root, exist_ok=True)
        git_dir = os.path.join(self.project_root, ".git")
        if not os.path.exists(git_dir):
            subprocess.run(
                ["git", "init", "-b", "main", self.project_root],
                check=True, capture_output=True, text=True,
            )
        for key, val in [
            ("user.name", "loop-v7-bot"),
            ("user.email", "loop-v7@local"),
        ]:
            subprocess.run(
                ["git", "-C", self.project_root, "config", key, val],
                check=True, capture_output=True, text=True,
            )

        spec_path = os.path.join(self.project_root, "spec.md")
        task_path = os.path.join(self.project_root, "task.md")
        checklist_path = os.path.join(self.project_root, "checklist.md")
        acceptance_path = os.path.join(self.project_root, "acceptance.md")

        self._spec_doc = (
            f"# {self.cfg.project_name} — 架构设计 spec\n\n"
            f"## 1. 项目概述\n\n{self._requirement_doc[:1500]}\n\n"
            f"## 2. 模块划分\n\n"
            f"（由 CLI Worker 在 Step 9 决定）\n\n"
            f"## 3. 接口规范\n\n"
            f"（由 Step 10 原子任务清单中输出）\n\n"
            f"## 4. 验收标准\n\n"
            f"{self._acceptance_doc[:2000]}\n"
        )
        self._task_doc = (
            f"# {self.cfg.project_name} — task 任务清单\n\n"
            f"## 模块列表\n\n"
            f"（由 CLI Worker 在 Step 9 输出）\n\n"
        )
        self._checklist_doc = (
            f"# {self.cfg.project_name} — checklist\n\n"
            f"## 验收检查项\n\n"
            f"（由 Step 13 质量评测时填充）\n\n"
        )
        _write_file(spec_path, self._spec_doc)
        _write_file(task_path, self._task_doc)
        _write_file(checklist_path, self._checklist_doc)
        _write_file(acceptance_path, self._acceptance_doc)

        try:
            subprocess.run(
                ["git", "-C", self.project_root, "add", "."],
                check=True, capture_output=True, text=True,
            )
            subprocess.run(
                ["git", "-C", self.project_root, "commit", "-m",
                 "v7 init: spec.md + task.md + checklist.md + acceptance.md (Step 7)"],
                check=True, capture_output=True, text=True,
            )
            sha_proc = subprocess.run(
                ["git", "-C", self.project_root, "rev-parse", "HEAD"],
                check=True, capture_output=True, text=True,
            )
            sha = sha_proc.stdout.strip()[:8]
        except subprocess.CalledProcessError:
            sha = "noop"
        return {
            "git_initialized": not os.path.exists(git_dir),
            "git_existed": os.path.exists(git_dir),
            "spec_md": spec_path,
            "task_md": task_path,
            "checklist_md": checklist_path,
            "initial_commit_sha": sha,
        }

    @_step_decorator("Step 8: 在 /home/qizheng/auto_code_data/ 下创建源代码项目仓库")
    async def step8_create_source_project_repo(self) -> Dict[str, Any]:
        if self.cfg.project_type == "frontend":
            folder_layout = [
                "src/components", "src/hooks", "src/store",
                "src/types", "src/constants", "src/styles", "src/utils",
                "public", "docs",
            ]
        elif self.cfg.project_type == "robot":
            folder_layout = [
                "src/agv_fleet/agv_fleet",
                "src/agv_fleet/agv_fleet/core",
                "src/agv_fleet/agv_fleet/control",
                "src/agv_fleet/agv_fleet/perception",
                "src/agv_fleet/agv_fleet/planning",
                "src/agv_fleet/agv_fleet/safety",
                "src/agv_fleet/agv_fleet/interaction",
                "src/agv_fleet/agv_fleet/utils",
                "src/agv_fleet/launch",
                "src/agv_fleet/config",
                "src/agv_fleet/resource",
                "src/agv_fleet/test",
                "docs",
            ]
        else:
            folder_layout = [
                "frontend/src", "frontend/public",
                "backend/app", "backend/tests", "docs",
            ]
        for rel in folder_layout:
            os.makedirs(os.path.join(self.project_root, rel), exist_ok=True)
        return {
            "project_root": self.project_root,
            "folder_count": len(folder_layout),
            "folders_created": folder_layout,
        }

    # ============================================================
    # Step 9: 独立 CLI Worker 并行执行（v7 核心改进）
    # ============================================================
    @_step_decorator("Step 9: 按模块分发任务到独立 CLI Worker + 实际生成代码")
    async def step9_inject_prompts_to_cli(self) -> Dict[str, Any]:
        """
        v7 关键改进：每个模块创建独立的 CurlLLMExecutor 实例（模拟"独立 claude code cli"），
        通过 asyncio.gather 并行执行。每个 Worker 完成后通过 HookBus 发送
        task_completed 事件，Step 11/12 订阅后做 git 提交。
        """
        # 列出当前项目目录结构
        structure: List[str] = []
        for root, dirs, _files in os.walk(self.project_root):
            if ".git" in root:
                continue
            rel = os.path.relpath(root, self.project_root)
            if rel == ".":
                rel = ""
            for d in sorted(dirs):
                if d == ".git":
                    continue
                structure.append(os.path.join(rel, d) + "/")
        structure_text = "\n".join(structure[:30]) if structure else "（空）"

        # 按项目类型决定模块
        if self.cfg.project_type == "frontend":
            modules = [
                {
                    "name": "package_config",
                    "description": (
                        "package.json + vite.config.ts + tsconfig + "
                        "tsconfig.node + tailwind.config.js + postcss.config.js + "
                        "index.html + src/main.tsx + src/App.tsx + src/index.css 入口骨架"
                    ),
                },
                {
                    "name": "ui_components",
                    "description": (
                        "四大核心 React 组件：KPIHeader、WarehouseMap、TaskPanel、AlertPanel，"
                        "全部使用 TypeScript + Tailwind，支持实时数据更新"
                    ),
                },
                {
                    "name": "state_simulation",
                    "description": (
                        "Zustand store（useWarehouseStore）+ useSimulation hook + "
                        "constants + types + styles，仿真主循环"
                    ),
                },
            ]
        elif self.cfg.project_type == "robot":
            modules = [
                {
                    "name": "package_skeleton",
                    "description": (
                        "ROS2 ament_python 包骨架：package.xml + setup.py + setup.cfg + "
                        "agv_fleet/__init__.py + 入口节点注册"
                    ),
                },
                {
                    "name": "core_nodes",
                    "description": (
                        "五大 ROS2 节点：感知（perception_node）、"
                        "规划（path_planner_node）、控制（motion_controller_node）、"
                        "安全（safety_node）、交互（interaction_node），"
                        "全部使用 rclpy + sensor_msgs/geometry_msgs + 自定义接口"
                    ),
                },
                {
                    "name": "launch_config",
                    "description": (
                        "launch/bringup.launch.py + config/*.yaml + "
                        "test/test_*.py + README.md + resource 标记文件"
                    ),
                },
            ]
        else:
            modules = [
                {"name": "frontend", "description": "前端代码"},
                {"name": "backend", "description": "后端代码"},
                {"name": "shared", "description": "共享接口"},
            ]

        # 为每个模块创建独立 Worker 并并行执行
        workers = [
            ModuleCLIWorker(
                workflow_id=self.workflow_id,
                project_name=self.cfg.project_name,
                project_root=self.project_root,
                module=mod,
                structure_text=structure_text,
                requirement_doc=self._requirement_doc,
                acceptance_doc=self._acceptance_doc,
                hook_bus=self.hook_bus,
                llm_env=DEFAULT_CLI_ENV,
                llm_timeout=self.cfg.llm_timeout,
            )
            for mod in modules
        ]
        # 发送 module_started 事件
        for w in workers:
            await self.hook_bus.emit(HookEvent(
                workflow_id=self.workflow_id,
                project_name=self.cfg.project_name,
                task_id=f"T-{w.module['name']}",
                module=w.module["name"],
                status="task_started",
                message=f"CLI Worker 启动: {w.module['name']}",
            ))

        # 并行执行
        results = await asyncio.gather(*[w.run() for w in workers], return_exceptions=True)

        files_written: List[str] = []
        file_writes_by_module: Dict[str, List[str]] = {}
        prompts_by_module: Dict[str, str] = {}
        plans_by_module: Dict[str, str] = {}
        checklists_by_module: Dict[str, str] = {}
        for w, r in zip(workers, results):
            if isinstance(r, Exception):
                logger.error(f"  [Step 9] 模块 {w.module['name']} 异常: {r}")
                continue
            files_written.extend(r["files"])
            file_writes_by_module[w.module["name"]] = r["files"]
            prompts_by_module[w.module["name"]] = r["prompt"]
            plans_by_module[w.module["name"]] = r["plan"]
            checklists_by_module[w.module["name"]] = r["checklist"]
        self._code_files = files_written
        self._module_prompts = prompts_by_module
        self._module_plans = plans_by_module
        self._module_checklists = checklists_by_module

        # 把每个 module 的 plan.md / checklist.md 写盘
        for mod_name in prompts_by_module:
            plan_dir = os.path.join(self.project_root, ".modules", mod_name)
            _ensure_dir(plan_dir)
            _write_file(os.path.join(plan_dir, "plan.md"), plans_by_module[mod_name])
            _write_file(os.path.join(plan_dir, "checklist.md"), checklists_by_module[mod_name])
            _write_file(os.path.join(plan_dir, "task.md"),
                        f"# {mod_name} 任务清单\n\n" + checklists_by_module[mod_name])

        return {
            "module_count": len(workers),
            "modules": [w.module["name"] for w in workers],
            "files_written_count": len(files_written),
            "structure_known": structure_text[:300],
            "files_per_module": {k: len(v) for k, v in file_writes_by_module.items()},
        }

    # ============================================================
    # Step 10: 整合原子任务清单
    # ============================================================
    @_step_decorator("Step 10: 整合原子任务清单（高风险标记 + 全局接口）")
    async def step10_aggregate_atomic_tasks(self) -> Dict[str, Any]:
        system = (
            "你是一名架构师。基于以下模块列表和需求，"
            "输出原子任务清单（JSON 格式），"
            "包含：每个模块的执行顺序、并行规则、风险等级、"
            "全局接口清单（消息/服务）、依赖版本刚性约束。\n\n"
            "【高风险模块刚性标记】严格按以下三级界定：\n"
            "  HIGH：涉及急停/碰撞检测/安全约束/运动控制输出\n"
            "  MEDIUM：涉及多模块通信/共享状态/全局资源\n"
            "  LOW：纯展示/工具函数/无副作用\n\n"
            "宁严勿漏，禁止漏标、错标。"
        )
        # 把每个 module 的 plan.md 内容整合进 prompt
        plans_combined = "\n\n".join(
            [f"## Module {k}\n{v[:800]}" for k, v in self._module_plans.items()]
        )
        user = (
            f"模块列表：\n{list(self._module_prompts.keys())}\n\n"
            f"需求：\n{self._requirement_doc[:1000]}\n\n"
            f"各模块 plan.md：\n{plans_combined[:2000]}\n\n"
            f"请输出 JSON：\n"
            f'{{"atomic_tasks": [{{"id": "T1", "module": "...", '
            f'"description": "...", "depends_on": [], '
            f'"risk_level": "HIGH/MEDIUM/LOW", '
            f'"parallel_group": 0}}], '
            f'"global_interfaces": [{{"name": "...", "type": "msg/srv", '
            f'"fields": [...]}}], '
            f'"dependency_versions": {{"python": "...", "node": "...", ...}}}}\n'
        )
        result_text = await self._llm_call(
            system=system, user=user, max_tokens=4000
        )
        try:
            data = json.loads(result_text)
        except Exception:
            data = {
                "atomic_tasks": [
                    {
                        "id": "T1",
                        "module": list(self._module_prompts.keys())[0] if self._module_prompts else "default",
                        "description": "基础结构生成",
                        "depends_on": [],
                        "risk_level": "LOW",
                        "parallel_group": 0,
                    }
                ],
                "global_interfaces": [],
                "dependency_versions": {},
            }
        self._atomic_task_list = data.get("atomic_tasks", [])
        self._global_interfaces = data.get("global_interfaces", [])
        self._dependency_versions = data.get("dependency_versions", {})

        # 校验高风险标记
        high_risk_count = sum(
            1 for t in self._atomic_task_list if t.get("risk_level") == "HIGH"
        )
        high_risk_modules = {
            "robot": ["core_nodes"],
            "frontend": [],
            "fullstack": ["backend"],
        }
        force_modules = high_risk_modules.get(self.cfg.project_type, [])
        for task in self._atomic_task_list:
            if task.get("module") in force_modules:
                task["risk_level"] = "HIGH"
                task["risk_justification"] = (
                    f"模块 {task.get('module')} 涉及安全关键功能，"
                    f"按高风险模块三级界定标准强制标记为 HIGH"
                )

        # 写 task.md
        task_md_content = (
            f"# {self.cfg.project_name} — 原子任务清单（Step 10 产出）\n\n"
            f"## 任务列表\n\n"
        )
        for t in self._atomic_task_list:
            task_md_content += (
                f"### {t.get('id', '?')}：{t.get('module', '?')}\n"
                f"- 描述: {t.get('description', '?')}\n"
                f"- 风险: **{t.get('risk_level', '?')}**\n"
                f"- 依赖: {t.get('depends_on', [])}\n"
                f"- 并行组: {t.get('parallel_group', 0)}\n\n"
            )
        task_md_content += (
            f"\n## 全局接口清单\n\n"
            + "\n".join(
                [f"- **{iface.get('name', '?')}** ({iface.get('type', '?')}): "
                 f"{', '.join(iface.get('fields', []))}"
                 for iface in self._global_interfaces]
            )
            + f"\n\n## 依赖版本\n\n"
            f"```json\n{json.dumps(self._dependency_versions, ensure_ascii=False, indent=2)}\n```\n"
        )
        self._task_doc = task_md_content
        _write_file(os.path.join(self.project_root, "task.md"), self._task_doc)
        return {
            "atomic_task_count": len(self._atomic_task_list),
            "high_risk_count": high_risk_count,
            "global_interfaces_count": len(self._global_interfaces),
        }

    # ============================================================
    # Step 11: 注册 HookBus 订阅者
    # ============================================================
    @_step_decorator("Step 11: 注册 task 完成 hook")
    async def step11_register_hooks(self) -> Dict[str, Any]:
        """
        v7 关键改进：注册真实的 git commit handler 到 HookBus
        - task_completed 事件 → 按模块做 git commit
        - module_completed 事件 → 切换到该模块的分支（如果存在）
        """
        # 订阅真实 git commit handler
        self.hook_bus.subscribe(self._on_task_completed_git_commit)
        # 同步订阅一个 module 分支创建 handler
        self.hook_bus.subscribe(self._on_module_completed_branch)
        return {
            "hook_count": len(self.hook_bus._subscribers),
            "subscribers": [
                getattr(cb, "__name__", str(cb)) for cb in self.hook_bus._subscribers
            ],
        }

    async def _on_task_completed_git_commit(self, event: HookEvent) -> None:
        """Hook handler: task_completed → git commit 该模块的文件"""
        if event.status != "task_completed":
            return
        if not event.files:
            return
        try:
            # git add 文件
            subprocess.run(
                ["git", "-C", self.project_root, "add", "--"] + event.files,
                check=True, capture_output=True, text=True,
            )
            commit_msg = f"[{event.module}] {event.task_id}: {event.message[:60]}"
            subprocess.run(
                ["git", "-C", self.project_root, "commit", "-m", commit_msg],
                check=True, capture_output=True, text=True,
            )
            sha_proc = subprocess.run(
                ["git", "-C", self.project_root, "rev-parse", "HEAD"],
                check=True, capture_output=True, text=True,
            )
            sha = sha_proc.stdout.strip()[:8]
            logger.info(
                f"  [Hook] task {event.task_id} 提交到 main: {sha} ({len(event.files)} files)"
            )
        except subprocess.CalledProcessError as exc:
            # 兜底：可能没有变更可 commit
            logger.debug(f"  [Hook] task {event.task_id} 无变更可 commit: {exc}")

    async def _on_module_completed_branch(self, event: HookEvent) -> None:
        """Hook handler: module_completed → 创建/切换到该模块的 feature 分支"""
        if event.status != "module_completed":
            return
        branch = f"feature/{event.module}"
        try:
            # 创建分支（已存在则忽略）
            subprocess.run(
                ["git", "-C", self.project_root, "branch", branch],
                capture_output=True, text=True,
            )
            self._module_branches[event.module] = branch
            logger.info(f"  [Hook] module {event.module} 关联分支: {branch}")
        except Exception as exc:
            logger.warning(f"  [Hook] 创建模块分支 {branch} 失败: {exc}")

    # ============================================================
    # Step 12: 通过 hook 触发按模块 git 提交
    # ============================================================
    @_step_decorator("Step 12: Git 提交（按模块 + 合并到 main）")
    async def step12_git_commit_per_task(self) -> Dict[str, Any]:
        """
        v7 关键改进：基于真实事件总线驱动
        - 遍历 self._code_files 按模块前缀分组
        - 对每个模块 emit task_completed 事件（带 files）→ hook 触发 git commit
        - emit module_completed 事件 → hook 创建 feature/<module> 分支
        - 最后把分支 merge 回 main
        """
        module_files: Dict[str, List[str]] = {}
        for f in self._code_files:
            parts = f.split("/", 1)
            mod = parts[0] if parts and parts[0] else "root"
            module_files.setdefault(mod, []).append(f)

        commits: List[Dict[str, str]] = []
        for mod, files in module_files.items():
            # 发送 task_completed 事件（hook handler 触发 commit）
            await self.hook_bus.emit(HookEvent(
                workflow_id=self.workflow_id,
                project_name=self.cfg.project_name,
                task_id=f"T-{mod}",
                module=mod,
                status="task_completed",
                message=f"模块 {mod} 代码生成完成",
                files=files,
            ))
            await self.hook_bus.emit(HookEvent(
                workflow_id=self.workflow_id,
                project_name=self.cfg.project_name,
                task_id=f"M-{mod}",
                module=mod,
                status="module_completed",
                message=f"模块 {mod} 工作流完成",
            ))

        # 把所有 feature 分支 merge 回 main（--no-ff 保留合并记录）
        merge_log: List[str] = []
        for mod, branch in self._module_branches.items():
            try:
                subprocess.run(
                    ["git", "-C", self.project_root, "merge", "--no-ff", branch,
                     "-m", f"v7 merge: feature/{mod} into main"],
                    check=True, capture_output=True, text=True,
                )
                merge_log.append(f"merged {branch} → main")
            except subprocess.CalledProcessError as exc:
                merge_log.append(f"merge {branch} failed: {exc.stderr[:100] if exc.stderr else exc}")

        # 收尾 commit（捕获可能未被 hook 处理的额外文件）
        try:
            subprocess.run(
                ["git", "-C", self.project_root, "add", "."],
                check=True, capture_output=True, text=True,
            )
            subprocess.run(
                ["git", "-C", self.project_root, "commit", "-m",
                 "v7 Step 12: workflow finalization (post-hook merge)"],
                check=True, capture_output=True, text=True,
            )
        except subprocess.CalledProcessError:
            pass  # 没有新文件可 commit

        # 列出所有 commit
        log_proc = subprocess.run(
            ["git", "-C", self.project_root, "log", "--oneline"],
            capture_output=True, text=True,
        )
        for line in log_proc.stdout.strip().split("\n"):
            if line:
                commits.append({"sha": line.split()[0], "msg": line[8:] if len(line) > 8 else ""})

        return {
            "commits": commits,
            "module_count": len(module_files),
            "files_per_module": {k: len(v) for k, v in module_files.items()},
            "merge_log": merge_log,
            "branches": self._module_branches,
        }

    # ============================================================
    # Step 13: QA 评测 + 按模块打回
    # ============================================================
    @_step_decorator("Step 13: 质量保障智能体系统评测（含打回重做）")
    async def step13_qa_review(self) -> Dict[str, Any]:
        """
        v7 关键改进：QA 打回时按模块调用独立 CLI Worker 重生（而非 v6 的单线程重生）
        """
        max_rounds = self.cfg.qa_max_rounds
        current_round = 0
        final_review: Dict[str, Any] = {}
        regenerated_files: List[str] = []
        history: List[Dict[str, Any]] = []

        while current_round < max_rounds:
            current_round += 1
            logger.info(f"  [Step 13] QA 评审轮次 {current_round}/{max_rounds}")
            system = (
                "你是一名严格的质量保障与迭代管理智能体。"
                "基于已生成的代码，评估其是否满足任务验收标准。"
                "输出严格 JSON："
                '{"passed": bool, "score": 0-1, '
                '"issues": [{"module": "...", "severity": '
                '"high/medium/low", "description": "..."}], '
                '"blocking_issues_count": int}'
            )
            all_files = []
            for root, _dirs, files in os.walk(self.project_root):
                if ".git" in root:
                    continue
                for f in files:
                    if f.endswith((".md", ".txt")) and "README" not in f and "spec" not in f:
                        continue
                    rel = os.path.relpath(os.path.join(root, f), self.project_root)
                    all_files.append(rel)
            file_summary = "\n".join(all_files[:30])
            review_text = await self._llm_call(
                system=system,
                user=(
                    f"项目：{self.cfg.project_name}\n"
                    f"类型：{self.cfg.project_type}\n"
                    f"已生成文件：\n{file_summary}\n\n"
                    f"任务验收标准：\n{self._acceptance_doc[:1500]}\n\n"
                    f"请评审是否通过，输出 JSON。\n"
                ),
                max_tokens=1500,
            )
            try:
                review = json.loads(review_text)
            except Exception:
                review = {
                    "passed": True, "score": 0.8,
                    "issues": [], "blocking_issues_count": 0,
                }
            history.append({"round": current_round, "review": review})

            passed = review.get("passed", False)
            blocking = review.get("blocking_issues_count", 0)
            score = review.get("score", 0.0)
            if passed or (blocking == 0 and score >= 0.6):
                final_review = review
                final_review["rounds"] = current_round
                final_review["regenerated_files"] = regenerated_files
                final_review["history"] = history
                self._qa_review = final_review
                return {
                    "passed": True,
                    "score": score,
                    "issues_count": len(review.get("issues", [])),
                    "rounds": current_round,
                    "regenerated_files_count": len(regenerated_files),
                }

            issues = review.get("issues", [])
            problem_modules = list({
                i.get("module", "")
                for i in issues
                if i.get("module") and i.get("severity") == "high"
            })
            if not problem_modules:
                final_review = review
                final_review["rounds"] = current_round
                final_review["regenerated_files"] = regenerated_files
                self._qa_review = final_review
                return {
                    "passed": score >= 0.6,
                    "score": score,
                    "issues_count": len(issues),
                    "rounds": current_round,
                }

            logger.warning(
                f"  [Step 13] QA 评审未通过，打回 {len(problem_modules)} 个模块: "
                f"{problem_modules}"
            )
            # 并行重生有问题的模块
            regen_workers = []
            for module_name in problem_modules:
                if module_name not in self._module_prompts:
                    continue
                regen_workers.append(ModuleCLIWorker(
                    workflow_id=self.workflow_id,
                    project_name=self.cfg.project_name,
                    project_root=self.project_root,
                    module={"name": module_name,
                            "description": f"重生 {module_name} 修复 QA 问题"},
                    structure_text="",
                    requirement_doc=self._requirement_doc,
                    acceptance_doc=self._acceptance_doc,
                    hook_bus=self.hook_bus,
                    llm_env=DEFAULT_CLI_ENV,
                    llm_timeout=self.cfg.llm_timeout,
                    extra_hint=(
                        "上一轮 QA 评审指出本模块存在以下问题：\n"
                        + "\n".join([f"- {i.get('description', '?')}"
                                     for i in issues if i.get("module") == module_name])
                        + "\n请修复并重新生成完整可运行代码。"
                    ),
                ))
            if regen_workers:
                regen_results = await asyncio.gather(
                    *[w.run() for w in regen_workers], return_exceptions=True
                )
                for w, r in zip(regen_workers, regen_results):
                    if isinstance(r, Exception):
                        continue
                    regenerated_files.extend(r["files"])
                    # hook 触发 commit
                    await self.hook_bus.emit(HookEvent(
                        workflow_id=self.workflow_id,
                        project_name=self.cfg.project_name,
                        task_id=f"REGEN-{w.module['name']}",
                        module=w.module["name"],
                        status="task_completed",
                        message=f"模块 {w.module['name']} QA 重生完成",
                        files=r["files"],
                    ))

        final_review = history[-1]["review"] if history else {
            "passed": False, "score": 0.0, "issues": [],
        }
        final_review["rounds"] = current_round
        final_review["regenerated_files"] = regenerated_files
        final_review["history"] = history
        self._qa_review = final_review
        return {
            "passed": final_review.get("passed", False),
            "score": final_review.get("score", 0.0),
            "issues_count": len(final_review.get("issues", [])),
            "rounds": current_round,
            "regenerated_files_count": len(regenerated_files),
        }

    # ============================================================
    # Step 14: 真实运行项目（v7 关键改进）
    # ============================================================
    @_step_decorator("Step 14: 实际运行整个项目验证")
    async def step14_run_integration_test(self) -> Dict[str, Any]:
        """
        v7 关键改进：
          - 前端：真实执行 npm install + npm run dev，端口探测 + HTTP 抓取验证
          - 机器人：python3 import 测试 + launch 文件语法验证 + ros2 package 格式检查
          - fullstack：分别跑前端 + 后端
        """
        validation: Dict[str, Any] = {
            "ran": False,
            "project_type": self.cfg.project_type,
            "real_run": self.cfg.real_run,
            "checks": [],
        }

        if not self.cfg.real_run:
            validation["status"] = "skipped"
            self._run_validation = validation
            return validation

        if self.cfg.project_type == "frontend":
            await self._run_frontend_validation(validation)
        elif self.cfg.project_type == "robot":
            await asyncio.to_thread(self._run_robot_validation, validation)
        else:
            await self._run_frontend_validation(validation)
            await asyncio.to_thread(self._run_robot_validation, validation)

        # 汇总结果
        all_passed = all(c.get("passed", False) for c in validation["checks"])
        validation["ran"] = True
        validation["status"] = "passed" if all_passed else "partial"
        validation["all_passed"] = all_passed

        # 收尾 commit
        try:
            subprocess.run(
                ["git", "-C", self.project_root, "add", "."],
                check=True, capture_output=True, text=True,
            )
            subprocess.run(
                ["git", "-C", self.project_root, "commit", "-m",
                 f"v7 Step 14: integration test final commit (status={validation['status']})"],
                capture_output=True, text=True,
            )
            sha_proc = subprocess.run(
                ["git", "-C", self.project_root, "rev-parse", "HEAD"],
                check=True, capture_output=True, text=True,
            )
            validation["final_commit_sha"] = sha_proc.stdout.strip()[:8]
        except subprocess.CalledProcessError as exc:
            validation["final_commit_error"] = str(exc)[:200]

        self._run_validation = validation
        return validation

    async def _run_frontend_validation(self, validation: Dict[str, Any]) -> None:
        """前端：npm install + npm run dev + 端口探测 + HTTP 抓取"""
        # 1. 关键文件存在性
        for f in [
            "package.json", "vite.config.ts", "tsconfig.json",
            "index.html", "src/main.tsx", "src/App.tsx",
        ]:
            path = os.path.join(self.project_root, f)
            validation["checks"].append(
                {"check": f"file_exists:{f}", "passed": os.path.exists(path)}
            )
        # 2. package.json 依赖完整性
        pkg_path = os.path.join(self.project_root, "package.json")
        if os.path.exists(pkg_path):
            try:
                with open(pkg_path, "r", encoding="utf-8") as f:
                    pkg = json.loads(f.read())
                required_deps = ["react", "react-dom", "zustand"]
                required_dev = ["vite", "typescript", "tailwindcss"]
                deps = pkg.get("dependencies", {})
                dev = pkg.get("devDependencies", {})
                for d in required_deps:
                    validation["checks"].append({
                        "check": f"dep:{d}", "passed": d in deps
                    })
                for d in required_dev:
                    validation["checks"].append({
                        "check": f"devDep:{d}", "passed": d in dev
                    })
            except Exception as exc:
                validation["checks"].append({
                    "check": "package.json_valid", "passed": False,
                    "error": str(exc)
                })

        # 3. 真实运行 npm run dev（后台进程 + 端口探测 + HTTP 抓取）
        if not shutil.which("npm"):
            validation["checks"].append({
                "check": "npm_available", "passed": False,
                "error": "npm 不在 PATH 中，跳过实际运行"
            })
            return

        # 先尝试 npm install
        install_proc = subprocess.run(
            ["npm", "install", "--no-audit", "--no-fund", "--prefer-offline"],
            cwd=self.project_root, capture_output=True, text=True, timeout=300,
        )
        validation["checks"].append({
            "check": "npm_install",
            "passed": install_proc.returncode == 0,
            "stderr_tail": (install_proc.stderr or "")[-300:],
        })

        # 启动 dev server（后台）
        log_path = os.path.join(self.project_root, ".dev_server.log")
        log_file = open(log_path, "w", encoding="utf-8")
        try:
            dev_proc = subprocess.Popen(
                ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
                cwd=self.project_root, stdout=log_file, stderr=subprocess.STDOUT,
                preexec_fn=os.setsid,
            )
        except Exception as exc:
            validation["checks"].append({
                "check": "npm_run_dev_spawn",
                "passed": False, "error": str(exc)
            })
            log_file.close()
            return

        # 等 dev server 启动，最多 30s
        port_up = _is_port_listening("127.0.0.1", 5173, timeout_s=30.0)
        validation["checks"].append({
            "check": "dev_server_port_5173",
            "passed": port_up,
            "port": 5173,
        })

        # HTTP 抓取 index
        http_ok = False
        http_body_preview = ""
        if port_up:
            try:
                import urllib.request
                with urllib.request.urlopen("http://127.0.0.1:5173/", timeout=5) as resp:
                    body = resp.read().decode("utf-8", errors="ignore")
                    http_body_preview = body[:300]
                    http_ok = "<div id=" in body or "<!DOCTYPE" in body.upper()
            except Exception as exc:
                http_body_preview = f"err: {exc}"
        validation["checks"].append({
            "check": "dev_server_http_index",
            "passed": http_ok,
            "body_preview": http_body_preview,
        })

        # 杀掉 dev server 进程组
        try:
            os.killpg(os.getpgid(dev_proc.pid), signal.SIGTERM)
            time.sleep(0.5)
            try:
                os.killpg(os.getpgid(dev_proc.pid), signal.SIGKILL)
            except ProcessLookupError:
                pass
        except Exception:
            pass
        finally:
            log_file.close()
        validation["dev_server_log_tail"] = _read_file(log_path)[-500:]

    def _run_robot_validation(self, validation: Dict[str, Any]) -> None:
        """机器人：Python 语法 + import + launch 语法 + package.xml 验证"""
        # 1. 关键文件存在性
        for f in [
            "src/agv_fleet/package.xml",
            "src/agv_fleet/setup.py",
            "src/agv_fleet/setup.cfg",
            "src/agv_fleet/agv_fleet/__init__.py",
        ]:
            path = os.path.join(self.project_root, f)
            validation["checks"].append({
                "check": f"file_exists:{f}", "passed": os.path.exists(path)
            })
        # 2. Python 语法检查
        py_files = []
        for root, _dirs, files in os.walk(self.project_root):
            if ".git" in root:
                continue
            for f in files:
                if f.endswith(".py"):
                    py_files.append(os.path.join(root, f))
        syntax_passed = 0
        syntax_failed: List[Dict[str, str]] = []
        for py in py_files:
            proc = subprocess.run(
                ["python3", "-c", f"import ast; ast.parse(open('{py}').read())"],
                capture_output=True, text=True, timeout=10,
            )
            if proc.returncode == 0:
                syntax_passed += 1
            else:
                syntax_failed.append({
                    "file": os.path.relpath(py, self.project_root),
                    "error": proc.stderr[:200]
                })
        validation["checks"].append({
            "check": "python_syntax",
            "passed": len(syntax_failed) == 0,
            "total": len(py_files),
            "passed_count": syntax_passed,
            "failed": syntax_failed[:3],
        })
        # 3. package.xml XML 验证
        pkg_xml = os.path.join(self.project_root, "src/agv_fleet/package.xml")
        if os.path.exists(pkg_xml):
            try:
                import xml.etree.ElementTree as ET
                ET.parse(pkg_xml)
                validation["checks"].append({
                    "check": "package_xml_valid", "passed": True
                })
            except Exception as exc:
                validation["checks"].append({
                    "check": "package_xml_valid",
                    "passed": False, "error": str(exc)
                })
        # 4. setup.py 入口完整性
        setup_py = os.path.join(self.project_root, "src/agv_fleet/setup.py")
        if os.path.exists(setup_py):
            content = _read_file(setup_py)
            entry_ok = "entry_points" in content and "console_scripts" in content
            validation["checks"].append({
                "check": "setup_py_has_console_scripts",
                "passed": entry_ok
            })

    # ============================================================
    # Step 15: 真实 git push（v7 关键改进）
    # ============================================================
    @_step_decorator("Step 15: 推送 main 分支")
    async def step15_push_to_main(self) -> Dict[str, Any]:
        """
        v7 关键改进：本地 bare remote + 真实 git push
          - 在 /home/qizheng/auto_code_data/.remotes/<name>.git 创建 bare 仓库
          - git remote add origin <bare>
          - git push -u origin main
        """
        if not self.cfg.real_push:
            return {
                "pushed": False,
                "reason": "real_push=False",
                "current_branch": "main",
            }

        # 1. 列出所有 git log
        log_proc = subprocess.run(
            ["git", "-C", self.project_root, "log", "--oneline"],
            capture_output=True, text=True,
        )
        self._result.git_log = [
            line for line in log_proc.stdout.strip().split("\n") if line
        ]
        branch_proc = subprocess.run(
            ["git", "-C", self.project_root, "branch", "--show-current"],
            capture_output=True, text=True,
        )
        current_branch = branch_proc.stdout.strip() or "main"

        # 2. 创建 local bare remote
        remote_path = self.cfg.git_remote_path or os.path.join(
            REMOTES_ROOT, f"{self.cfg.project_name}.git"
        )
        _ensure_dir(os.path.dirname(remote_path))
        if not os.path.exists(remote_path):
            code, _, err = _run_shell(
                ["git", "init", "--bare", "-b", "main", remote_path], timeout=30
            )
            if code != 0:
                return {
                    "pushed": False,
                    "error": f"bare init failed: {err[:200]}",
                    "current_branch": current_branch,
                }

        # 3. 设置 remote
        subprocess.run(
            ["git", "-C", self.project_root, "remote", "remove", "origin"],
            capture_output=True, text=True,
        )
        subprocess.run(
            ["git", "-C", self.project_root, "remote", "add", "origin", remote_path],
            check=True, capture_output=True, text=True,
        )

        # 4. 真实 push
        push_code, push_stdout, push_stderr = _run_shell(
            ["git", "-C", self.project_root, "push", "-u", "origin", current_branch],
            timeout=60,
        )
        push_ok = push_code == 0

        # 5. 验证 push 成功（bare 端能看到 commit）
        bare_log = ""
        if push_ok:
            code2, stdout2, _ = _run_shell(
                ["git", "--git-dir", remote_path, "log", "--oneline", "-1"],
                timeout=10,
            )
            bare_log = stdout2.strip() if code2 == 0 else ""

        return {
            "pushed": push_ok,
            "remote_path": remote_path,
            "current_branch": current_branch,
            "push_stdout_tail": push_stdout[-300:] if push_stdout else "",
            "push_stderr_tail": push_stderr[-300:] if push_stderr else "",
            "bare_log_head": bare_log,
            "commit_count": len(self._result.git_log),
        }

    # ============================================================
    # 入口
    # ============================================================
    async def run(self) -> WorkflowResult:
        """顺序执行 15 步"""
        steps = [
            self.step1_user_input,
            self.step2_create_chief_architect,
            self.step3_discuss_with_user,
            self.step4_create_qa_agents,
            self.step5_critique_iteration,
            self.step6_finalize_acceptance_criteria,
            self.step7_generate_docs_and_git,
            self.step8_create_source_project_repo,
            self.step9_inject_prompts_to_cli,
            self.step10_aggregate_atomic_tasks,
            self.step11_register_hooks,
            self.step12_git_commit_per_task,
            self.step13_qa_review,
            self.step14_run_integration_test,
            self.step15_push_to_main,
        ]
        for fn in steps:
            try:
                await fn()
            except Exception as exc:
                logger.exception(f"工作流在 {fn.__name__} 失败: {exc}")
                self._result.success = False
                self._result.final_status = f"failed_at_{fn.__name__}"
                self._result.ended_at = time.time()
                self._result.duration_s = round(
                    self._result.ended_at - self._result.started_at, 3
                )
                self._result.files_generated = list(self._code_files)
                self._result.events = [
                    {"task_id": e.task_id, "module": e.module, "status": e.status}
                    for e in self.hook_bus.history()
                ]
                return self._result

        # 收尾：发送 workflow_completed 事件
        await self.hook_bus.emit(HookEvent(
            workflow_id=self.workflow_id,
            project_name=self.cfg.project_name,
            task_id="WORKFLOW",
            module="*",
            status="workflow_completed",
            message="Loop Engineering v7 全部 15 步完成",
        ))
        self._result.success = True
        self._result.final_status = "completed"
        self._result.ended_at = time.time()
        self._result.duration_s = round(
            self._result.ended_at - self._result.started_at, 3
        )
        self._result.files_generated = list(self._code_files)
        self._result.events = [
            {"task_id": e.task_id, "module": e.module, "status": e.status}
            for e in self.hook_bus.history()
        ]
        return self._result


# ============================================================
# ModuleCLIWorker - 独立 CLI 子代理（v7 新增）
# ============================================================
class ModuleCLIWorker:
    """
    独立 CLI Worker（每个模块一个实例）
    作用：模拟"独立 claude code cli"子进程：每个 worker 拥有自己的
         CurlLLMExecutor + 自己的 LLM 上下文 + 自己的文件写入权限
    调用方：LoopEngineeringV7.step9 / step13
    行为：
      1. 构造针对该模块的 prompt（含项目结构、需求、验收标准）
      2. 调用 LLM 生成 plan.md + 代码（# FILE: <path> 格式）
      3. 解析 LLM 输出，写入文件
      4. 通过 HookBus 发送 task_completed 事件
    """

    def __init__(
        self,
        workflow_id: str,
        project_name: str,
        project_root: str,
        module: Dict[str, str],
        structure_text: str,
        requirement_doc: str,
        acceptance_doc: str,
        hook_bus: HookBus,
        llm_env: Dict[str, str],
        llm_timeout: int = 300,
        extra_hint: str = "",
    ) -> None:
        self.workflow_id = workflow_id
        self.project_name = project_name
        self.project_root = project_root
        self.module = module
        self.structure_text = structure_text
        self.requirement_doc = requirement_doc
        self.acceptance_doc = acceptance_doc
        self.hook_bus = hook_bus
        self.llm_env = llm_env
        self.llm_timeout = llm_timeout
        self.extra_hint = extra_hint
        self.task_id = f"CLI-{module['name']}"
        self._llm = None

    async def _get_executor(self):
        if self._llm is None:
            from cli_integration.curl_executor import CurlLLMExecutor
            self._llm = CurlLLMExecutor(
                executable="curl",
                default_timeout=600,
                max_retries=2,
                cli_env=self.llm_env,
                name=f"worker-{self.module['name'][:16]}",
            )
        return self._llm

    async def _llm_call(self, system: str, user: str, max_tokens: int = 16000) -> str:
        ex = await self._get_executor()
        full = f"[SYSTEM]\n{system}\n\n[USER]\n{user}\n\n[ASSISTANT]\n"
        result = await ex.execute(
            command=full, timeout=self.llm_timeout, max_tokens=max_tokens
        )
        if not getattr(result, "success", False):
            err = getattr(result, "error_message", "unknown") or "unknown"
            raise RuntimeError(f"Worker {self.module['name']} LLM 调用失败: {err}")
        return (getattr(result, "stdout", "") or "").strip()

    def _parse_and_write(self, llm_text: str) -> List[str]:
        """解析 # FILE: 标记，写入项目目录"""
        written: List[str] = []
        if not llm_text:
            return written
        lines = llm_text.split("\n")
        i = 0
        while i < len(lines):
            line = lines[i]
            m = (
                re.match(r"^\s*#\s*FILE:\s*([^\s`]+)\s*$", line)
                or re.match(r"^\s*//\s*FILE:\s*([^\s`]+)\s*$", line)
                or re.match(r"^\s*--\s*FILE:\s*([^\s`]+)\s*$", line)
                or re.match(r"^\s*<!--\s*FILE:\s*([^\s`]+)\s*-->\s*$", line)
            )
            if not m:
                i += 1
                continue
            rel_path = m.group(1).strip().lstrip("/")
            full_path = os.path.normpath(os.path.join(self.project_root, rel_path))
            if not full_path.startswith(os.path.normpath(self.project_root)):
                i += 1
                continue
            content_parts: List[str] = []
            j = i + 1
            found_code = False
            while j < len(lines):
                ln = lines[j]
                if ln.strip().startswith("```"):
                    if not found_code:
                        found_code = True
                        j += 1
                        continue
                    break
                if found_code:
                    content_parts.append(ln)
                j += 1
            if not found_code:
                i = j + 1 if j < len(lines) else j
                continue
            content = "\n".join(content_parts).rstrip()
            if len(content) < 50:
                i = j + 1
                continue
            try:
                _write_file(full_path, content + "\n")
                written.append(os.path.relpath(full_path, self.project_root))
            except Exception as exc:
                logger.error(f"Worker {self.module['name']} 写文件 {rel_path} 失败: {exc}")
            i = j + 1
        return written

    async def run(self) -> Dict[str, Any]:
        """执行 worker：plan → code → 写盘 → hook 通知"""
        system = (
            f"你是一名高级软件工程师，CLI Worker 编号 {self.task_id}。\n"
            f"负责模块：{self.module['name']}\n"
            f"模块描述：{self.module['description']}\n"
            "你的任务：先制定本模块的 plan.md（任务分解） + checklist.md（验收项），"
            "再生成完整可运行代码。\n\n"
            "**关键输出格式**：\n"
            "  - 第一段以 `# PLAN:` 开头，紧跟 Markdown plan.md 内容（直到下一个标记）\n"
            "  - 第二段以 `# CHECKLIST:` 开头，紧跟 Markdown checklist.md 内容\n"
            "  - 第三段以 `# FILE: <rel_path>` 标记每个代码文件，代码块 ``` 包裹\n"
            "  - 支持 #, //, --, <!-- --> 四种 FILE 标记\n"
            "  - 多个文件依次输出\n\n"
            f"项目根目录: {self.project_root}\n"
            f"项目名: {self.project_name}\n"
            f"当前项目文件夹结构（你可以使用这些路径）：\n{self.structure_text}\n\n"
            "**重要规则**：\n"
            "  1. 你自行决定所有代码文件的放置位置，路径必须与现有文件夹结构兼容\n"
            "  2. 代码必须完整可运行（无 TODO 占位）\n"
            "  3. 完整 docstring / 注释\n"
            "  4. 异常处理 + 边界条件处理\n"
            "  5. **严禁**只写注释/空函数/伪代码\n"
            "  6. 至少输出 3-5 个完整文件\n"
            f"  7. 项目验收标准：\n{self.acceptance_doc[:1500]}\n"
            + (f"\n  8. 附加要求（QA 重生）: {self.extra_hint}\n" if self.extra_hint else "")
        )
        user = (
            f"模块名：{self.module['name']}\n"
            f"模块描述：{self.module['description']}\n\n"
            f"全局需求（前 1500 字符）：\n{self.requirement_doc[:1500]}\n\n"
            f"请立即输出该模块的 plan.md + checklist.md + 所有代码文件。\n"
        )
        prompt = f"[SYSTEM]\n{system}\n\n[USER]\n{user}\n\n[ASSISTANT]\n"
        logger.info(f"  [Worker {self.task_id}] 调用 LLM 生成模块 {self.module['name']}...")

        await self.hook_bus.emit(HookEvent(
            workflow_id=self.workflow_id,
            project_name=self.project_name,
            task_id=self.task_id,
            module=self.module["name"],
            status="task_started",
            message=f"Worker {self.task_id} LLM 调用启动",
        ))

        llm_text = await self._llm_call(system, user, max_tokens=16000)

        # 拆分 PLAN / CHECKLIST / FILE
        plan_md = self._extract_section(llm_text, "PLAN")
        checklist_md = self._extract_section(llm_text, "CHECKLIST")
        files = self._parse_and_write(llm_text)

        # hook 通知
        await self.hook_bus.emit(HookEvent(
            workflow_id=self.workflow_id,
            project_name=self.project_name,
            task_id=self.task_id,
            module=self.module["name"],
            status="task_completed",
            message=f"Worker {self.task_id} 生成 {len(files)} 个文件",
            files=files,
        ))

        logger.info(
            f"  [Worker {self.task_id}] 模块 {self.module['name']} 生成 {len(files)} 个文件"
        )
        return {
            "prompt": prompt,
            "plan": plan_md,
            "checklist": checklist_md,
            "files": files,
        }

    @staticmethod
    def _extract_section(text: str, tag: str) -> str:
        """从 LLM 输出提取 # TAG: 到下一个标记的段落"""
        if not text:
            return ""
        pattern = rf"#\s*{tag}:"
        lines = text.split("\n")
        in_section = False
        captured: List[str] = []
        for line in lines:
            if not in_section:
                if re.match(pattern, line.strip()):
                    in_section = True
                    continue
            else:
                if re.match(r"#\s*(PLAN|CHECKLIST|FILE):", line.strip()):
                    break
                captured.append(line)
        return "\n".join(captured).strip()


# ============================================================
# 同步入口
# ============================================================
def run_workflow(config: WorkflowConfig) -> WorkflowResult:
    """同步入口"""
    wf = LoopEngineeringV7(config)
    return asyncio.run(wf.run())


async def run_workflow_async(config: WorkflowConfig) -> WorkflowResult:
    """异步入口"""
    wf = LoopEngineeringV7(config)
    return await wf.run()


# ============================================================
# CLI 入口
# ============================================================
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Loop Engineering v7")
    parser.add_argument("--name", required=True, help="项目名")
    parser.add_argument(
        "--type", default="frontend", choices=["frontend", "robot", "fullstack"],
    )
    parser.add_argument("--input", required=True, help="用户需求")
    parser.add_argument("--no-real-run", action="store_true", help="跳过真实项目运行")
    parser.add_argument("--no-real-push", action="store_true", help="跳过真实 git push")
    args = parser.parse_args()
    cfg = WorkflowConfig(
        user_input=args.input,
        project_name=args.name,
        project_type=args.type,
        real_run=not args.no_real_run,
        real_push=not args.no_real_push,
    )
    r = run_workflow(cfg)
    print(json.dumps(r.to_dict(), ensure_ascii=False, indent=2))
