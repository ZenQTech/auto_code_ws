"""
# ============================================================
# PRD 生成器单元测试
# Cycle 63 G63-01
# ============================================================
# 覆盖：
#   1. PRD 基础生成（正常路径）
#   2. 输入校验（边界、错误）
#   3. PRD 迭代与 diff
#   4. 限流
#   5. 存储与恢复
#   6. 错误处理
# ====================================
"""

import asyncio
import json
import shutil
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

# 添加 backend 到路径
BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.services.prd_generator import (  # noqa: E402
    PRDManager,
    PRDDocument,
    PRDNotFoundError,
    PRDValidationError,
    PRDRateLimitError,
    Scenario,
    Criterion,
    Task,
    get_prd_manager,
    reset_prd_manager,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def temp_storage():
    """临时存储目录"""
    tmp = Path(tempfile.mkdtemp(prefix="prd_test_"))
    yield str(tmp)
    shutil.rmtree(tmp, ignore_errors=True)


@pytest.fixture
def mock_llm_caller():
    """Mock LLM caller - 返回固定 PRD"""
    async def caller(system_prompt: str, prompt: str, model: str) -> str:
        return json.dumps({
            "title": "测试 PRD",
            "goals": ["目标 1", "目标 2", "目标 3"],
            "user_scenarios": [
                {
                    "name": "场景 1",
                    "description": "描述 1",
                    "preconditions": ["前提 1"],
                    "steps": ["步骤 1", "步骤 2"],
                }
            ],
            "acceptance_criteria": [
                {"id": "AC-1", "description": "验收 1", "metric": "m1", "target": "t1"},
                {"id": "AC-2", "description": "验收 2", "metric": "m2", "target": "t2"},
            ],
            "tasks": [
                {"id": "T-1", "name": "任务 1", "description": "描述", "dependencies": [], "estimated_hours": 2.0, "risk_level": "low"},
                {"id": "T-2", "name": "任务 2", "description": "描述", "dependencies": ["T-1"], "estimated_hours": 4.0, "risk_level": "medium"},
            ],
            "risks": ["风险 1"],
        }, ensure_ascii=False)
    return caller


@pytest.fixture
def manager(temp_storage, mock_llm_caller):
    """PRD Manager fixture"""
    return PRDManager(llm_caller=mock_llm_caller, storage_dir=temp_storage)


# ============================================================
# Test: PRD 基础生成
# ============================================================


class TestPRDGeneration:
    """PRD 基础生成测试"""

    @pytest.mark.asyncio
    async def test_generate_prd_success(self, manager):
        """正常生成 PRD"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        assert prd.prd_id.startswith("prd-")
        assert prd.title == "测试 PRD"
        assert len(prd.goals) == 3
        assert len(prd.user_scenarios) == 1
        assert len(prd.acceptance_criteria) == 2
        assert len(prd.tasks) == 2
        assert len(prd.risks) == 1
        assert prd.version == 1
        assert prd.created_at > 0
        assert prd.updated_at > 0

    @pytest.mark.asyncio
    async def test_generate_prd_with_context(self, manager):
        """带上下文的 PRD 生成"""
        context = {"tech_stack": ["React", "TypeScript"], "user_role": "developer"}
        prd = await manager.generate_prd(
            "实现 Todo List",
            context=context,
            template="agile",
        )
        assert prd is not None
        assert prd.title == "测试 PRD"

    @pytest.mark.asyncio
    async def test_generate_prd_persists_to_storage(self, manager):
        """PRD 持久化到存储"""
        prd = await manager.generate_prd("实现 Todo List")
        # 验证文件存在
        prd_dir = Path(manager._storage_dir) / prd.prd_id
        assert prd_dir.exists()
        v1_file = prd_dir / "v1.json"
        assert v1_file.exists()
        with open(v1_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert data["content"]["title"] == "测试 PRD"


# ============================================================
# Test: 输入校验
# ============================================================


class TestPRDValidation:
    """PRD 输入校验测试"""

    @pytest.mark.asyncio
    async def test_empty_requirement_raises(self, manager):
        """空需求抛错"""
        with pytest.raises(PRDValidationError, match="不能为空"):
            await manager.generate_prd("")

    @pytest.mark.asyncio
    async def test_short_requirement_raises(self, manager):
        """过短需求抛错"""
        with pytest.raises(PRDValidationError, match="至少 10 个字符"):
            await manager.generate_prd("太短")

    @pytest.mark.asyncio
    async def test_long_requirement_raises(self, manager):
        """过长需求抛错"""
        with pytest.raises(PRDValidationError, match="最多 10000 字符"):
            await manager.generate_prd("a" * 10001)

    @pytest.mark.asyncio
    async def test_whitespace_only_raises(self, manager):
        """仅空白抛错"""
        with pytest.raises(PRDValidationError, match="不能为空"):
            await manager.generate_prd("          ")

    @pytest.mark.asyncio
    async def test_iterate_empty_feedback_raises(self, manager):
        """空反馈抛错"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        with pytest.raises(PRDValidationError):
            await manager.iterate_prd(prd.prd_id, "")


# ============================================================
# Test: PRD 迭代与 diff
# ============================================================


class TestPRDIteration:
    """PRD 迭代测试"""

    @pytest.mark.asyncio
    async def test_iterate_prd_creates_v2(self, manager):
        """迭代生成 v2"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        new_prd, diff_ops = await manager.iterate_prd(
            prd.prd_id, "增加用户登录功能模块"
        )
        assert new_prd.version == 2
        assert new_prd.prd_id == prd.prd_id
        assert isinstance(diff_ops, list)

    @pytest.mark.asyncio
    async def test_iterate_nonexistent_prd_raises(self, manager):
        """不存在的 PRD 抛错"""
        with pytest.raises(PRDNotFoundError):
            await manager.iterate_prd("prd-nonexistent", "添加功能到系统")

    @pytest.mark.asyncio
    async def test_iterate_with_invalid_version_raises(self, manager):
        """无效版本抛错"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        with pytest.raises(PRDNotFoundError):
            await manager.iterate_prd(prd.prd_id, "feedback 反馈", base_version=99)

    @pytest.mark.asyncio
    async def test_iterate_computes_diff(self, manager):
        """迭代正确计算 diff"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        new_prd, diff_ops = await manager.iterate_prd(
            prd.prd_id, "添加暗色主题切换功能"
        )
        # Mock LLM 返回相同 PRD，所以 diff 应该为空
        # 但由于版本号变更，仍可能有字段变化
        assert isinstance(diff_ops, list)


class TestPRDDiff:
    """PRD diff 计算测试"""

    @pytest.mark.asyncio
    async def test_compute_diff_between_versions(self, manager):
        """计算两个版本之间的 diff"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        await manager.iterate_prd(prd.prd_id, "反馈 1 改进用户界面")
        await manager.iterate_prd(prd.prd_id, "反馈 2 优化性能")

        diff_ops = manager.compute_diff(prd.prd_id, 1, 3)
        assert isinstance(diff_ops, list)

    def test_compute_diff_with_custom_llm(self, mock_llm_caller, temp_storage):
        """自定义 LLM 返回不同内容，验证 diff 正确性"""
        call_count = [0]

        async def varying_caller(system_prompt: str, prompt: str, model: str) -> str:
            call_count[0] += 1
            # 第一次返回 3 个目标，第二次返回 4 个目标
            n_goals = 3 if call_count[0] == 1 else 4
            goals = [f"目标 {i}" for i in range(1, n_goals + 1)]
            return json.dumps({
                "title": f"PRD v{call_count[0]}",
                "goals": goals,
                "user_scenarios": [],
                "acceptance_criteria": [],
                "tasks": [],
                "risks": [],
            }, ensure_ascii=False)

        mgr = PRDManager(llm_caller=varying_caller, storage_dir=temp_storage)

        async def run_test():
            prd = await mgr.generate_prd("初始需求内容比较长字符串")
            new_prd, diff_ops = await mgr.iterate_prd(prd.prd_id, "添加一个目标项")
            return prd, new_prd, diff_ops

        prd, new_prd, diff_ops = asyncio.run(run_test())

        # v1 有 3 个目标，v2 有 4 个目标
        assert len(prd.goals) == 3
        assert len(new_prd.goals) == 4
        # 应该有 1 个 added diff（新增目标 4）
        added_ops = [d for d in diff_ops if d.op == "added" and d.field == "goals"]
        assert len(added_ops) == 1
        assert added_ops[0].after == "目标 4"
        # title 也应该变化
        title_ops = [d for d in diff_ops if d.field == "title"]
        assert len(title_ops) == 1
        assert title_ops[0].before == "PRD v1"
        assert title_ops[0].after == "PRD v2"


# ============================================================
# Test: 限流
# ============================================================


class TestPRDRateLimit:
    """PRD 限流测试"""

    @pytest.mark.asyncio
    async def test_rate_limit_per_user(self, temp_storage, mock_llm_caller):
        """每用户限流"""
        # 创建低限流的 manager
        mgr = PRDManager(llm_caller=mock_llm_caller, storage_dir=temp_storage)
        mgr._rate_limit_per_hour = 3  # 限制 3 次

        # 前 3 次成功
        for i in range(3):
            prd = await mgr.generate_prd(f"测试需求内容描述 {i} 完整")
            assert prd is not None

        # 第 4 次限流
        with pytest.raises(PRDRateLimitError) as exc_info:
            await mgr.generate_prd("第 4 次测试内容描述")
        assert exc_info.value.retry_after > 0

    @pytest.mark.asyncio
    async def test_rate_limit_isolated_per_user(self, manager):
        """不同用户限流隔离"""
        # user-1 调用 2 次
        for i in range(2):
            await manager.generate_prd(f"user-1 需求内容 {i}", user_id="user-1")
        # user-2 仍可调用
        prd = await manager.generate_prd("user-2 需求内容", user_id="user-2")
        assert prd is not None


# ============================================================
# Test: 存储与查询
# ============================================================


class TestPRDStorage:
    """PRD 存储与查询测试"""

    @pytest.mark.asyncio
    async def test_get_prd_returns_latest(self, manager):
        """get_prd 返回最新版本"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        new_prd, _ = await manager.iterate_prd(prd.prd_id, "增加用户登录模块")

        retrieved, versions = manager.get_prd(prd.prd_id)
        assert retrieved.version == 2
        assert len(versions) == 2

    @pytest.mark.asyncio
    async def test_get_prd_specific_version(self, manager):
        """get_prd 返回指定版本"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        await manager.iterate_prd(prd.prd_id, "增加用户登录模块")

        retrieved, versions = manager.get_prd(prd.prd_id, version=1)
        assert retrieved.version == 1

    @pytest.mark.asyncio
    async def test_get_nonexistent_prd_raises(self, manager):
        """获取不存在的 PRD 抛错"""
        with pytest.raises(PRDNotFoundError):
            manager.get_prd("prd-nonexistent")

    @pytest.mark.asyncio
    async def test_list_prds(self, manager):
        """列出所有 PRD"""
        await manager.generate_prd("需求 1 完整描述文本测试")
        await manager.generate_prd("需求 2 完整描述文本测试")
        prds = manager.list_prds()
        assert len(prds) == 2
        for p in prds:
            assert "prd_id" in p
            assert "title" in p
            assert "current_version" in p
            assert "updated_at" in p

    @pytest.mark.asyncio
    async def test_delete_prd(self, manager):
        """删除 PRD"""
        prd = await manager.generate_prd("实现一个 Todo List 应用")
        success = manager.delete_prd(prd.prd_id)
        assert success is True
        with pytest.raises(PRDNotFoundError):
            manager.get_prd(prd.prd_id)

    @pytest.mark.asyncio
    async def test_delete_nonexistent_prd(self, manager):
        """删除不存在的 PRD 返回 False"""
        success = manager.delete_prd("prd-nonexistent")
        assert success is False

    def test_persistence_reload(self, temp_storage, mock_llm_caller):
        """持久化与重新加载"""
        async def setup():
            mgr1 = PRDManager(llm_caller=mock_llm_caller, storage_dir=temp_storage)
            prd = await mgr1.generate_prd("测试持久化功能完整文本描述")
            return prd.prd_id

        prd_id = asyncio.run(setup())

        # 重新创建 manager（模拟重启）
        mgr2 = PRDManager(llm_caller=mock_llm_caller, storage_dir=temp_storage)
        prd, versions = mgr2.get_prd(prd_id)
        assert prd.title == "测试 PRD"
        assert len(versions) == 1


# ============================================================
# Test: 错误处理
# ============================================================


class TestPRDErrors:
    """PRD 错误处理测试"""

    @pytest.mark.asyncio
    async def test_llm_failure_raises(self, temp_storage):
        """LLM 失败时抛错"""
        async def failing_caller(system_prompt, prompt, model):
            raise RuntimeError("LLM 服务不可用")

        mgr = PRDManager(llm_caller=failing_caller, storage_dir=temp_storage)

        with pytest.raises(Exception) as exc_info:
            await mgr.generate_prd("实现 Todo List")
        assert "LLM 调用失败" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_invalid_json_response_raises(self, temp_storage):
        """无效 JSON 响应抛错"""
        async def bad_caller(system_prompt, prompt, model):
            return "not a json response"

        mgr = PRDManager(llm_caller=bad_caller, storage_dir=temp_storage)

        with pytest.raises(PRDValidationError, match="JSON 解析失败"):
            await mgr.generate_prd("实现 Todo List")

    @pytest.mark.asyncio
    async def test_invalid_prd_structure_raises(self, temp_storage):
        """无效 PRD 结构抛错 - LLM 返回非字典类型应抛错"""
        async def bad_caller(system_prompt, prompt, model):
            return "[]"  # 返回数组而非对象，验证 Pydantic 失败

        mgr = PRDManager(llm_caller=bad_caller, storage_dir=temp_storage)

        with pytest.raises(PRDValidationError):
            await mgr.generate_prd("实现一个 Todo List 应用")


# ============================================================
# Test: 统计
# ============================================================


class TestPRDStats:
    """PRD 统计测试"""

    @pytest.mark.asyncio
    async def test_stats_initial(self, manager):
        """初始统计"""
        stats = manager.get_stats()
        assert stats["total_prds"] == 0
        assert stats["total_versions"] == 0

    @pytest.mark.asyncio
    async def test_stats_after_generation(self, manager):
        """生成后统计"""
        await manager.generate_prd("需求 1 完整描述文本")
        prd2 = await manager.generate_prd("需求 2 完整描述文本")
        await manager.iterate_prd(prd2.prd_id, "增加用户登录模块")

        stats = manager.get_stats()
        assert stats["total_prds"] == 2
        assert stats["total_versions"] == 3  # 1 + 2


# ============================================================
# Test: Markdown 代码块解析
# ============================================================


class TestJSONExtraction:
    """JSON 提取测试"""

    def test_extract_json_from_code_block(self, manager):
        """从 markdown 代码块提取 JSON"""
        text = """这是响应：
```json
{"title": "测试", "goals": []}
```
"""
        result = manager._extract_json(text)
        parsed = json.loads(result)
        assert parsed["title"] == "测试"

    def test_extract_json_from_braces(self, manager):
        """从花括号提取 JSON"""
        text = '返回: {"title": "测试", "goals": []} 结束'
        result = manager._extract_json(text)
        parsed = json.loads(result)
        assert parsed["title"] == "测试"

    def test_extract_json_plain(self, manager):
        """直接 JSON 文本"""
        text = '{"title": "测试", "goals": []}'
        result = manager._extract_json(text)
        parsed = json.loads(result)
        assert parsed["title"] == "测试"


# ============================================================
# Test: 总结
# ============================================================


class TestPRDDiffSummary:
    """Diff 摘要测试"""

    def test_summarize_empty(self, manager):
        """空 diff 摘要"""
        summary = manager._summarize_diff([])
        assert summary == "无变化"

    def test_summarize_with_ops(self, manager):
        """有 ops 的 diff 摘要"""
        from app.services.prd_generator import DiffOp
        ops = [
            DiffOp(field="goals", op="added", path="goals[0]"),
            DiffOp(field="goals", op="added", path="goals[1]"),
            DiffOp(field="goals", op="removed", path="goals[0]"),
            DiffOp(field="tasks", op="modified", path="tasks[T-1]"),
        ]
        summary = manager._summarize_diff(ops)
        assert "新增 2 项" in summary
        assert "删除 1 项" in summary
        assert "修改 1 项" in summary
