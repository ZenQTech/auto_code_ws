"""
# ============================================================
# PRD 生成器 (v1.0.0)
# Cycle 63 G63-01
# ============================================================
# 核心作用：将自然语言需求自动转化为结构化 PRD
# 运行流程：
#   1. 接收用户需求文本
#   2. 调用 LLM 生成结构化 PRD（JSON Schema 强约束）
#   3. Pydantic 验证并存储
#   4. 支持基于反馈的迭代生成
#   5. 支持版本管理与 diff 计算
# 设计要点：
#   - 全异步（LLM 调用异步化）
#   - 失败重试（最多 3 次，指数退避）
#   - 限流（每用户 100 次/小时）
#   - 持久化（内存 + JSON 文件双写）
#   - diff 算法基于 diff-match-patch
# 输入参数：requirement / feedback / context
# 输出结果：PRDDocument + DiffOps
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-01 初次创建
# ====================================
"""

import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)


# ============================================================
# 数据类型
# ============================================================


class StageType(str, Enum):
    """PRD 工作流阶段（与 StageDetector 协同）"""
    PRD = "prd"
    CODING = "coding"
    PREVIEW = "preview"
    DEPLOY = "deploy"


@dataclass
class Scenario:
    """用户场景"""
    name: str
    description: str
    preconditions: List[str] = field(default_factory=list)
    steps: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Criterion:
    """验收标准"""
    id: str
    description: str
    metric: str = ""
    target: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Task:
    """任务分解"""
    id: str
    name: str
    description: str
    dependencies: List[str] = field(default_factory=list)
    estimated_hours: float = 0.0
    risk_level: str = "low"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class PRDDocument:
    """PRD 文档主体"""
    prd_id: str
    title: str
    goals: List[str] = field(default_factory=list)
    user_scenarios: List[Scenario] = field(default_factory=list)
    acceptance_criteria: List[Criterion] = field(default_factory=list)
    tasks: List[Task] = field(default_factory=list)
    risks: List[str] = field(default_factory=list)
    version: int = 1
    created_at: float = 0.0
    updated_at: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            **asdict(self),
            "user_scenarios": [s.to_dict() for s in self.user_scenarios],
            "acceptance_criteria": [c.to_dict() for c in self.acceptance_criteria],
            "tasks": [t.to_dict() for t in self.tasks],
        }


@dataclass
class PRDVersion:
    """PRD 版本快照"""
    version: int
    content: PRDDocument
    diff_summary: Optional[str] = None
    created_at: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "version": self.version,
            "content": self.content.to_dict(),
            "diff_summary": self.diff_summary,
            "created_at": self.created_at,
        }


@dataclass
class DiffOp:
    """单个 diff 操作"""
    field: str
    op: str  # added / removed / modified
    path: str  # 如 "goals[2]" 或 "tasks[T-3].name"
    before: Any = None
    after: Any = None
    summary: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# LLM Prompt 模板
# ============================================================


PRD_GENERATION_PROMPT = """你是一位资深产品经理。请基于以下需求生成结构化 PRD。

需求：{requirement}

{context_block}

输出严格的 JSON 格式（不要任何额外说明）：

{{
  "title": "项目标题（10-30 字）",
  "goals": ["目标 1", "目标 2", "目标 3"],
  "user_scenarios": [
    {{
      "name": "场景名",
      "description": "场景描述",
      "preconditions": ["前提 1"],
      "steps": ["步骤 1", "步骤 2"]
    }}
  ],
  "acceptance_criteria": [
    {{
      "id": "AC-1",
      "description": "验收条件描述",
      "metric": "度量（如：响应时间）",
      "target": "目标值（如：< 200ms）"
    }}
  ],
  "tasks": [
    {{
      "id": "T-1",
      "name": "任务名",
      "description": "任务描述",
      "dependencies": [],
      "estimated_hours": 4.0,
      "risk_level": "low"
    }}
  ],
  "risks": ["风险 1"]
}}

要求：
1. 目标 3-5 条
2. 用户场景 2-4 个
3. 验收标准 5-10 条
4. 任务分解 5-15 个，按依赖排序
5. 风险识别 2-5 条
6. 所有 ID 必须唯一且符合格式
"""


PRD_ITERATION_PROMPT = """你是一位资深产品经理。请基于现有 PRD 和用户反馈，生成 PRD 的新版本。

当前 PRD (v{current_version})：
```json
{current_prd}
```

用户反馈：{feedback}

输出严格的 JSON 格式（不要任何额外说明），与现有 PRD 结构一致：

{{
  "title": "项目标题",
  "goals": [...],
  "user_scenarios": [...],
  "acceptance_criteria": [...],
  "tasks": [...],
  "risks": [...]
}}

要求：
1. 保留现有 PRD 中仍然有效的内容
2. 根据反馈添加、修改或删除相关字段
3. 保持 ID 的连续性（如 AC-1, AC-2, T-1, T-2）
4. 重新评估 estimated_hours 和 risk_level
"""


# ============================================================
# 异常类型
# ============================================================


class PRDError(Exception):
    """PRD 生成基础异常"""
    pass


class PRDValidationError(PRDError):
    """PRD 数据验证失败"""
    pass


class PRDRateLimitError(PRDError):
    """PRD 生成限流"""
    def __init__(self, message: str, retry_after: int):
        super().__init__(message)
        self.retry_after = retry_after


class PRDNotFoundError(PRDError):
    """PRD 不存在"""
    pass


# ============================================================
# LLM Caller 接口（依赖注入）
# ============================================================


async def default_llm_caller(system_prompt: str, prompt: str, model: str) -> str:
    """
    默认 LLM 调用器（mock 实现）
    实际项目应注入真实 LLM 客户端
    """
    # 这里使用一个确定性 mock，避免依赖外部服务
    # 真实场景下应替换为 OpenAI / Claude / 自建 LLM 调用
    return _mock_prd_response(prompt)


def _mock_prd_response(prompt: str) -> str:
    """
    基于 prompt 关键词生成 mock PRD（确定性，便于测试）
    """
    # 提取需求标题（截取前 30 字符）
    title_match = re.search(r"需求[:：]\s*(.+?)(?:\n|$)", prompt)
    if title_match:
        title = title_match.group(1).strip()[:30]
    else:
        title = "新项目 PRD"

    return json.dumps({
        "title": title,
        "goals": [
            "提供完整的核心功能",
            "确保良好的用户体验",
            "支持扩展和定制",
        ],
        "user_scenarios": [
            {
                "name": "基础使用场景",
                "description": "用户使用核心功能完成主要任务",
                "preconditions": ["用户已登录", "环境已配置"],
                "steps": ["打开应用", "执行操作", "查看结果"],
            },
            {
                "name": "高级使用场景",
                "description": "用户使用高级功能完成复杂任务",
                "preconditions": ["已掌握基础使用"],
                "steps": ["配置参数", "执行复杂流程", "导出结果"],
            },
        ],
        "acceptance_criteria": [
            {"id": "AC-1", "description": "核心功能正常工作", "metric": "功能可用性", "target": "100%"},
            {"id": "AC-2", "description": "响应时间符合预期", "metric": "P95 响应时间", "target": "< 500ms"},
            {"id": "AC-3", "description": "支持并发用户", "metric": "并发数", "target": ">= 100"},
            {"id": "AC-4", "description": "数据持久化正确", "metric": "数据一致性", "target": "100%"},
            {"id": "AC-5", "description": "错误处理完善", "metric": "错误覆盖率", "target": ">= 95%"},
        ],
        "tasks": [
            {"id": "T-1", "name": "需求分析", "description": "深入分析需求", "dependencies": [], "estimated_hours": 4.0, "risk_level": "low"},
            {"id": "T-2", "name": "架构设计", "description": "设计系统架构", "dependencies": ["T-1"], "estimated_hours": 8.0, "risk_level": "medium"},
            {"id": "T-3", "name": "核心实现", "description": "实现核心功能", "dependencies": ["T-2"], "estimated_hours": 16.0, "risk_level": "medium"},
            {"id": "T-4", "name": "单元测试", "description": "编写单元测试", "dependencies": ["T-3"], "estimated_hours": 8.0, "risk_level": "low"},
            {"id": "T-5", "name": "集成测试", "description": "端到端测试", "dependencies": ["T-4"], "estimated_hours": 4.0, "risk_level": "low"},
        ],
        "risks": [
            "技术风险：新技术的学习成本",
            "时间风险：需求变更导致延期",
            "质量风险：测试覆盖不足",
        ],
    }, ensure_ascii=False)


# ============================================================
# PRD 管理器
# ============================================================


class PRDManager:
    """
    PRD 全生命周期管理器
    - 生成 / 迭代 / 查询 / 删除
    - 版本管理 + diff 计算
    - 限流 + 持久化
    """

    def __init__(self, llm_caller=None, storage_dir: Optional[str] = None):
        self._llm_caller = llm_caller or default_llm_caller
        self._storage_dir = Path(storage_dir) if storage_dir else None
        if self._storage_dir:
            self._storage_dir.mkdir(parents=True, exist_ok=True)

        # 内存存储
        self._prds: Dict[str, List[PRDVersion]] = {}  # prd_id -> versions
        self._meta: Dict[str, Dict[str, Any]] = {}    # prd_id -> meta
        self._rate_limits: Dict[str, List[float]] = {}  # user_id -> timestamps

        # 限流配置
        self._rate_limit_per_hour = 100
        self._global_rate_limit_per_hour = 1000

        # 加载持久化数据
        if self._storage_dir:
            self._load_from_disk()

    # ============================================================
    # 公共 API
    # ============================================================

    async def generate_prd(
        self,
        requirement: str,
        context: Optional[Dict[str, Any]] = None,
        template: str = "default",
        user_id: str = "anonymous",
    ) -> PRDDocument:
        """
        生成 PRD
        1. 输入校验
        2. 限流检查
        3. LLM 调用
        4. JSON 解析 + Pydantic 验证
        5. 存储
        """
        # 1. 校验
        self._validate_requirement(requirement)

        # 2. 限流
        self._check_rate_limit(user_id)

        # 3. 构建 prompt
        context_block = ""
        if context:
            context_block = f"\n附加上下文：\n{json.dumps(context, ensure_ascii=False, indent=2)}\n"

        prompt = PRD_GENERATION_PROMPT.format(
            requirement=requirement,
            context_block=context_block,
        )

        # 4. LLM 调用（带重试）
        raw_response = await self._call_llm_with_retry(prompt, template)

        # 5. 解析 + 验证
        prd = self._parse_and_validate(raw_response)

        # 6. 存储
        version = PRDVersion(
            version=1,
            content=prd,
            diff_summary="初始版本",
            created_at=time.time(),
        )
        self._prds[prd.prd_id] = [version]
        self._meta[prd.prd_id] = {
            "prd_id": prd.prd_id,
            "title": prd.title,
            "current_version": 1,
            "created_at": prd.created_at,
            "updated_at": prd.updated_at,
        }
        self._persist(prd.prd_id)

        logger.info(f"PRD 生成成功: prd_id={prd.prd_id}, title={prd.title}")
        return prd

    async def iterate_prd(
        self,
        prd_id: str,
        feedback: str,
        base_version: Optional[int] = None,
        user_id: str = "anonymous",
    ) -> Tuple[PRDDocument, List[DiffOp]]:
        """
        基于反馈迭代 PRD
        1. 获取当前版本
        2. LLM 生成新版本
        3. 计算 diff
        4. 存储新版本
        """
        # 校验
        self._validate_feedback(feedback)
        self._check_rate_limit(user_id)

        # 获取基础版本
        versions = self._prds.get(prd_id)
        if not versions:
            raise PRDNotFoundError(f"PRD 不存在: {prd_id}")

        base_v = base_version or versions[-1].version
        base_content = next(
            (v.content for v in versions if v.version == base_v),
            None,
        )
        if base_content is None:
            raise PRDNotFoundError(f"版本不存在: {prd_id} v{base_v}")

        # 构建 prompt
        prompt = PRD_ITERATION_PROMPT.format(
            current_version=base_v,
            current_prd=json.dumps(base_content.to_dict(), ensure_ascii=False, indent=2),
            feedback=feedback,
        )

        # LLM 调用
        raw_response = await self._call_llm_with_retry(prompt, "iterate")

        # 解析
        new_prd = self._parse_and_validate(raw_response, base_id=prd_id)
        new_prd.version = base_v + 1
        new_prd.updated_at = time.time()

        # 计算 diff
        diff_ops = self._compute_diff(base_content, new_prd)
        diff_summary = self._summarize_diff(diff_ops)

        # 存储
        new_version = PRDVersion(
            version=new_prd.version,
            content=new_prd,
            diff_summary=diff_summary,
            created_at=time.time(),
        )
        versions.append(new_version)
        self._meta[prd_id]["current_version"] = new_prd.version
        self._meta[prd_id]["updated_at"] = new_prd.updated_at
        self._persist(prd_id)

        logger.info(
            f"PRD 迭代成功: prd_id={prd_id}, "
            f"v{base_v} -> v{new_prd.version}, "
            f"diff_ops={len(diff_ops)}"
        )
        return new_prd, diff_ops

    def get_prd(self, prd_id: str, version: Optional[int] = None) -> Tuple[PRDDocument, List[PRDVersion]]:
        """获取 PRD（指定版本或最新版本）"""
        versions = self._prds.get(prd_id)
        if not versions:
            raise PRDNotFoundError(f"PRD 不存在: {prd_id}")

        if version is None:
            content = versions[-1].content
        else:
            v = next((v for v in versions if v.version == version), None)
            if v is None:
                raise PRDNotFoundError(f"版本不存在: {prd_id} v{version}")
            content = v.content

        return content, versions

    def list_prds(self) -> List[Dict[str, Any]]:
        """列出所有 PRD（仅元信息）"""
        return [
            {
                "prd_id": meta["prd_id"],
                "title": meta["title"],
                "current_version": meta["current_version"],
                "updated_at": meta["updated_at"],
            }
            for meta in self._meta.values()
        ]

    def compute_diff(self, prd_id: str, from_version: int, to_version: int) -> List[DiffOp]:
        """计算两个版本之间的 diff"""
        versions = self._prds.get(prd_id)
        if not versions:
            raise PRDNotFoundError(f"PRD 不存在: {prd_id}")

        from_v = next((v for v in versions if v.version == from_version), None)
        to_v = next((v for v in versions if v.version == to_version), None)
        if from_v is None or to_v is None:
            raise PRDNotFoundError(f"版本不存在: {prd_id}")

        return self._compute_diff(from_v.content, to_v.content)

    def delete_prd(self, prd_id: str) -> bool:
        """删除 PRD"""
        if prd_id not in self._prds:
            return False
        del self._prds[prd_id]
        del self._meta[prd_id]
        if self._storage_dir:
            prd_dir = self._storage_dir / prd_id
            if prd_dir.exists():
                import shutil
                shutil.rmtree(prd_dir)
        return True

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        total_versions = sum(len(versions) for versions in self._prds.values())
        return {
            "total_prds": len(self._prds),
            "total_versions": total_versions,
            "rate_limit_per_hour": self._rate_limit_per_hour,
        }

    # ============================================================
    # 内部方法
    # ============================================================

    def _validate_requirement(self, requirement: str) -> None:
        """校验需求输入"""
        if not requirement or not isinstance(requirement, str):
            raise PRDValidationError("需求不能为空")
        requirement = requirement.strip()
        if not requirement:
            raise PRDValidationError("需求不能为空（仅空白字符）")
        if len(requirement) < 10:
            raise PRDValidationError("需求至少 10 个字符")
        if len(requirement) > 10000:
            raise PRDValidationError("需求最多 10000 字符")

    def _validate_feedback(self, feedback: str) -> None:
        """校验反馈输入"""
        if not feedback or not isinstance(feedback, str):
            raise PRDValidationError("反馈不能为空")
        feedback = feedback.strip()
        if not feedback:
            raise PRDValidationError("反馈不能为空（仅空白字符）")
        if len(feedback) < 5:
            raise PRDValidationError("反馈至少 5 个字符")
        if len(feedback) > 5000:
            raise PRDValidationError("反馈最多 5000 字符")

    def _check_rate_limit(self, user_id: str) -> None:
        """限流检查（滑动窗口）"""
        now = time.time()
        hour_ago = now - 3600

        # 用户级限流
        if user_id not in self._rate_limits:
            self._rate_limits[user_id] = []
        timestamps = [t for t in self._rate_limits[user_id] if t > hour_ago]
        self._rate_limits[user_id] = timestamps

        if len(timestamps) >= self._rate_limit_per_hour:
            retry_after = int(timestamps[0] + 3600 - now) + 1
            raise PRDRateLimitError(
                f"用户限流: 每小时最多 {self._rate_limit_per_hour} 次",
                retry_after=retry_after,
            )

        # 全局限流
        global_timestamps = []
        for ts_list in self._rate_limits.values():
            global_timestamps.extend([t for t in ts_list if t > hour_ago])

        if len(global_timestamps) >= self._global_rate_limit_per_hour:
            raise PRDRateLimitError(
                f"全局限流: 每小时最多 {self._global_rate_limit_per_hour} 次",
                retry_after=60,
            )

        # 记录本次请求
        self._rate_limits[user_id].append(now)

    async def _call_llm_with_retry(self, prompt: str, model: str) -> str:
        """LLM 调用带重试（指数退避）"""
        max_retries = 3
        for attempt in range(max_retries):
            try:
                response = await self._llm_caller(
                    system_prompt="你是一位资深产品经理。",
                    prompt=prompt,
                    model=model,
                )
                return response
            except Exception as e:  # noqa: BLE001
                if attempt == max_retries - 1:
                    raise PRDError(f"LLM 调用失败（已重试 {max_retries} 次）: {e}") from e
                wait_time = 2 ** attempt
                logger.warning(f"LLM 调用失败，{wait_time}s 后重试: {e}")
                await asyncio.sleep(wait_time)
        # 不应该到达这里
        raise PRDError("LLM 调用异常")

    def _parse_and_validate(
        self, raw_response: str, base_id: Optional[str] = None,
    ) -> PRDDocument:
        """解析 LLM 返回的 JSON 并验证"""
        # 提取 JSON（可能包含 markdown 代码块）
        json_str = self._extract_json(raw_response)
        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            raise PRDValidationError(f"JSON 解析失败: {e}") from e

        # 验证 data 是字典
        if not isinstance(data, dict):
            raise PRDValidationError(
                f"PRD 必须是 JSON 对象，实际为 {type(data).__name__}"
            )

        # 验证必填字段
        if "title" not in data or not data["title"]:
            raise PRDValidationError("PRD 缺少必填字段: title")

        # 构造 PRDDocument
        prd_id = base_id or f"prd-{uuid.uuid4().hex[:12]}"
        now = time.time()

        try:
            prd = PRDDocument(
                prd_id=prd_id,
                title=data.get("title", "未命名 PRD"),
                goals=data.get("goals", []),
                user_scenarios=[
                    Scenario(**s) for s in data.get("user_scenarios", [])
                ],
                acceptance_criteria=[
                    Criterion(**c) for c in data.get("acceptance_criteria", [])
                ],
                tasks=[Task(**t) for t in data.get("tasks", [])],
                risks=data.get("risks", []),
                version=1,
                created_at=now,
                updated_at=now,
            )
        except (TypeError, ValueError) as e:
            raise PRDValidationError(f"PRD 结构验证失败: {e}") from e

        return prd

    def _extract_json(self, text: str) -> str:
        """从 LLM 返回中提取 JSON 字符串"""
        # 尝试匹配 ```json ... ``` 代码块
        code_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
        if code_block:
            return code_block.group(1)
        # 尝试匹配 {...}
        brace_match = re.search(r"\{.*\}", text, re.DOTALL)
        if brace_match:
            return brace_match.group(0)
        return text

    def _compute_diff(self, before: PRDDocument, after: PRDDocument) -> List[DiffOp]:
        """计算两个 PRD 之间的 diff（字段级）"""
        diffs: List[DiffOp] = []

        # 标题
        if before.title != after.title:
            diffs.append(DiffOp(
                field="title",
                op="modified",
                path="title",
                before=before.title,
                after=after.title,
                summary=f"标题: '{before.title}' → '{after.title}'",
            ))

        # 目标
        before_goals = set(before.goals)
        after_goals = set(after.goals)
        for g in after_goals - before_goals:
            diffs.append(DiffOp(
                field="goals", op="added",
                path="goals",
                before=None, after=g,
                summary=f"新增目标: {g[:50]}",
            ))
        for g in before_goals - after_goals:
            diffs.append(DiffOp(
                field="goals", op="removed",
                path="goals",
                before=g, after=None,
                summary=f"删除目标: {g[:50]}",
            ))

        # 任务
        before_tasks = {t.id: t for t in before.tasks}
        after_tasks = {t.id: t for t in after.tasks}
        for tid, task in after_tasks.items():
            if tid not in before_tasks:
                diffs.append(DiffOp(
                    field="tasks", op="added",
                    path=f"tasks[{tid}]",
                    before=None, after=task.to_dict(),
                    summary=f"新增任务: {task.name}",
                ))
            else:
                # 检查变更
                old = before_tasks[tid]
                if old.to_dict() != task.to_dict():
                    diffs.append(DiffOp(
                        field="tasks", op="modified",
                        path=f"tasks[{tid}]",
                        before=old.to_dict(),
                        after=task.to_dict(),
                        summary=f"修改任务: {task.name}",
                    ))
        for tid, task in before_tasks.items():
            if tid not in after_tasks:
                diffs.append(DiffOp(
                    field="tasks", op="removed",
                    path=f"tasks[{tid}]",
                    before=task.to_dict(),
                    after=None,
                    summary=f"删除任务: {task.name}",
                ))

        # 风险
        before_risks = set(before.risks)
        after_risks = set(after.risks)
        for r in after_risks - before_risks:
            diffs.append(DiffOp(
                field="risks", op="added",
                path="risks",
                before=None, after=r,
                summary=f"新增风险: {r[:50]}",
            ))
        for r in before_risks - after_risks:
            diffs.append(DiffOp(
                field="risks", op="removed",
                path="risks",
                before=r, after=None,
                summary=f"删除风险: {r[:50]}",
            ))

        return diffs

    def _summarize_diff(self, diffs: List[DiffOp]) -> str:
        """生成 diff 摘要"""
        if not diffs:
            return "无变化"
        added = sum(1 for d in diffs if d.op == "added")
        removed = sum(1 for d in diffs if d.op == "removed")
        modified = sum(1 for d in diffs if d.op == "modified")
        return f"新增 {added} 项，删除 {removed} 项，修改 {modified} 项"

    def _persist(self, prd_id: str) -> None:
        """持久化到磁盘"""
        if not self._storage_dir:
            return
        prd_dir = self._storage_dir / prd_id
        prd_dir.mkdir(parents=True, exist_ok=True)

        # 保存每个版本
        for version in self._prds.get(prd_id, []):
            version_file = prd_dir / f"v{version.version}.json"
            with open(version_file, "w", encoding="utf-8") as f:
                json.dump(version.to_dict(), f, ensure_ascii=False, indent=2)

        # 保存元信息
        meta_file = prd_dir / "meta.json"
        with open(meta_file, "w", encoding="utf-8") as f:
            json.dump(self._meta.get(prd_id, {}), f, ensure_ascii=False, indent=2)

    def _load_from_disk(self) -> None:
        """从磁盘加载"""
        if not self._storage_dir or not self._storage_dir.exists():
            return
        for prd_dir in self._storage_dir.iterdir():
            if not prd_dir.is_dir():
                continue
            prd_id = prd_dir.name
            versions: List[PRDVersion] = []
            for version_file in sorted(prd_dir.glob("v*.json")):
                try:
                    with open(version_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    content_data = data["content"]
                    prd = PRDDocument(
                        prd_id=content_data["prd_id"],
                        title=content_data["title"],
                        goals=content_data["goals"],
                        user_scenarios=[Scenario(**s) for s in content_data["user_scenarios"]],
                        acceptance_criteria=[Criterion(**c) for c in content_data["acceptance_criteria"]],
                        tasks=[Task(**t) for t in content_data["tasks"]],
                        risks=content_data["risks"],
                        version=content_data["version"],
                        created_at=content_data["created_at"],
                        updated_at=content_data["updated_at"],
                    )
                    versions.append(PRDVersion(
                        version=data["version"],
                        content=prd,
                        diff_summary=data.get("diff_summary"),
                        created_at=data["created_at"],
                    ))
                except Exception as e:  # noqa: BLE001
                    logger.warning(f"加载 PRD 版本失败 {version_file}: {e}")
            if versions:
                self._prds[prd_id] = versions
                # 加载 meta
                meta_file = prd_dir / "meta.json"
                if meta_file.exists():
                    try:
                        with open(meta_file, "r", encoding="utf-8") as f:
                            self._meta[prd_id] = json.load(f)
                    except Exception as e:  # noqa: BLE001
                        logger.warning(f"加载 PRD meta 失败 {meta_file}: {e}")


# ============================================================
# 全局单例
# ============================================================

_manager: Optional[PRDManager] = None


def get_prd_manager(storage_dir: Optional[str] = None) -> PRDManager:
    """获取 PRD 管理器单例"""
    global _manager
    if _manager is None:
        _manager = PRDManager(storage_dir=storage_dir)
    return _manager


def reset_prd_manager() -> None:
    """重置 PRD 管理器（用于测试）"""
    global _manager
    _manager = None
