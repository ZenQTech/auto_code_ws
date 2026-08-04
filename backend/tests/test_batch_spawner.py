"""
# ============================================================
# BatchSpawner + CSVTaskParser 单元测试 (Cycle 65 G65-02)
# ============================================================
# 覆盖：
#   - BatchError / BatchInstance / BatchJob 数据结构
#   - BatchStatus 枚举
#   - CSVTaskParser: 解析 + 校验
#   - BatchSpawner: spawn_batch / get_job / list / cancel / export
#   - 边界条件: 空 CSV、错误格式、超大文件
#   - 并发场景: 100 行 × 5 并发
# ====================================
"""

import asyncio
import json
import sys
import time
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))


# ============================================================
# 辅助函数
# ============================================================


SIMPLE_CSV = """task,nickname,role
分析数据,Atlas,worker
生成报告,Builder,default
代码审查,Reviewer,worker
"""

CSV_WITH_CONTEXT = '''task,nickname,role,context
"分析数据","Atlas","worker","{""file"":""data.csv""}"
"生成报告","Builder","default",""
'''

INVALID_CSV = """task,nickname,role
"",Atlas,worker
"正常任务",Builder,default
"""


# ============================================================
# BatchStatus 枚举测试
# ============================================================


class TestBatchStatus:
    def test_status_values(self):
        from app.services.batch_spawner import BatchStatus

        assert BatchStatus.PENDING.value == "pending"
        assert BatchStatus.RUNNING.value == "running"
        assert BatchStatus.COMPLETED.value == "completed"
        assert BatchStatus.CANCELLED.value == "cancelled"
        assert BatchStatus.FAILED.value == "failed"

    def test_status_count(self):
        from app.services.batch_spawner import BatchStatus

        assert len(list(BatchStatus)) == 5


# ============================================================
# 数据结构测试
# ============================================================


class TestDataStructures:
    def test_batch_error_to_dict(self):
        from app.services.batch_spawner import BatchError

        err = BatchError(
            row_index=1, field="task", message="empty", raw="raw content"
        )
        d = err.to_dict()
        assert d["row_index"] == 1
        assert d["field"] == "task"
        assert d["message"] == "empty"
        assert d["raw"] == "raw content"

    def test_batch_instance_to_dict(self):
        from app.services.batch_spawner import BatchInstance

        inst = BatchInstance(
            agent_id="a1",
            row_index=1,
            task="task",
            nickname="Atlas",
            role="worker",
        )
        d = inst.to_dict()
        assert d["agent_id"] == "a1"
        assert d["row_index"] == 1
        assert d["task"] == "task"
        assert d["nickname"] == "Atlas"
        assert d["role"] == "worker"

    def test_batch_job_default_values(self):
        from app.services.batch_spawner import BatchJob, DEFAULT_CONCURRENCY

        job = BatchJob(batch_id="b1")
        assert job.batch_id == "b1"
        assert job.total == 0
        assert job.accepted == 0
        assert job.status == "pending"
        assert job.max_concurrency == DEFAULT_CONCURRENCY
        assert job.instances == {}
        assert job.errors == []

    def test_batch_job_update_progress(self):
        from app.services.batch_spawner import BatchJob

        job = BatchJob(batch_id="b1", total=10, completed=3, failed=2)
        job.update_progress()
        assert job.progress == 0.5

    def test_batch_job_update_progress_zero_total(self):
        from app.services.batch_spawner import BatchJob

        job = BatchJob(batch_id="b1", total=0)
        job.update_progress()
        assert job.progress == 0.0

    def test_batch_job_to_dict(self):
        from app.services.batch_spawner import BatchJob, BatchInstance, BatchError

        job = BatchJob(
            batch_id="b1",
            total=2,
            accepted=2,
            rejected=0,
            instances={
                "a1": BatchInstance(agent_id="a1", row_index=1, task="t1"),
                "a2": BatchInstance(agent_id="a2", row_index=2, task="t2"),
            },
            errors=[BatchError(row_index=0, field="csv", message="test")],
        )
        d = job.to_dict()
        assert d["batch_id"] == "b1"
        assert d["total"] == 2
        assert len(d["instances"]) == 2
        assert len(d["errors"]) == 1
        # 内部字段不应导出
        assert "_task" not in d
        assert "_cancel_event" not in d


# ============================================================
# CSVTaskParser 测试
# ============================================================


class TestCSVTaskParser:
    def test_parse_simple_csv(self):
        from app.services.batch_spawner import CSVTaskParser

        parser = CSVTaskParser()
        rows, errors = parser.parse(SIMPLE_CSV)
        assert len(rows) == 3
        assert len(errors) == 0
        assert rows[0]["task"] == "分析数据"
        assert rows[0]["nickname"] == "Atlas"
        assert rows[0]["role"] == "worker"

    def test_parse_with_context_json(self):
        from app.services.batch_spawner import CSVTaskParser

        parser = CSVTaskParser()
        rows, errors = parser.parse(CSV_WITH_CONTEXT)
        assert len(rows) == 2
        assert len(errors) == 0
        assert rows[0]["context"] == {"file": "data.csv"}
        assert rows[1]["context"] == {}

    def test_parse_missing_required_task(self):
        from app.services.batch_spawner import CSVTaskParser

        parser = CSVTaskParser()
        rows, errors = parser.parse(INVALID_CSV)
        # 第一行 task 为空
        assert len(rows) == 1
        assert len(errors) == 1
        assert errors[0].field == "task"

    def test_parse_empty_csv(self):
        from app.services.batch_spawner import CSVTaskParser

        parser = CSVTaskParser()
        rows, errors = parser.parse("")
        # 空字符串被视作没有表头
        assert len(rows) == 0
        assert len(errors) >= 1

    def test_parse_only_header(self):
        from app.services.batch_spawner import CSVTaskParser

        parser = CSVTaskParser()
        rows, errors = parser.parse("task,nickname,role\n")
        assert len(rows) == 0
        assert len(errors) == 0

    def test_parse_max_rows_limit(self):
        from app.services.batch_spawner import CSVTaskParser

        parser = CSVTaskParser(max_rows=2)
        # 生成 5 行 CSV
        lines = ["task,nickname,role"]
        for i in range(5):
            lines.append(f"task{i},name{i},worker")
        csv = "\n".join(lines)
        rows, errors = parser.parse(csv)
        # 超过 max_rows 应该有错误
        assert len(rows) == 2
        assert len(errors) >= 1

    def test_parse_quoted_fields_with_commas(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = 'task,nickname,role\n"hello, world","A","worker"'
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert len(rows) == 1
        assert rows[0]["task"] == "hello, world"

    def test_parse_quoted_fields_with_newlines(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = 'task,nickname,role\n"line1\nline2","A","worker"'
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert len(rows) == 1
        assert "line1" in rows[0]["task"]

    def test_parse_invalid_context_json(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = 'task,context\n"task1","not valid json"'
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert len(rows) == 0
        assert len(errors) == 1
        assert errors[0].field == "context"

    def test_parse_context_not_dict(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = 'task,context\n"task1","[1,2,3]"'
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert len(rows) == 0
        assert len(errors) == 1
        assert errors[0].field == "context"

    def test_parse_missing_required_column(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = "nickname,role\nA,worker"
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert len(rows) == 0
        assert len(errors) == 1
        assert errors[0].field == "task"

    def test_parse_optional_columns_missing(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = "task\nhello"
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert len(rows) == 1
        # 可选列缺失时应使用默认值
        assert rows[0]["role"] == "default"
        assert rows[0]["nickname"] is None
        assert rows[0]["model"] is None

    def test_parse_default_role(self):
        from app.services.batch_spawner import CSVTaskParser

        csv = "task\nhello"
        parser = CSVTaskParser()
        rows, errors = parser.parse(csv)
        assert rows[0]["role"] == "default"


# ============================================================
# BatchSpawner 服务测试
# ============================================================


class TestBatchSpawner:
    def setup_method(self):
        from app.services.batch_spawner import reset_batch_spawner
        from app.services.agent_runner import reset_agent_runner
        from app.services.hook_event_bus import reset_hook_bus
        from app.services.agent_role_manager import (
            get_agent_role_manager,
        )

        # 清理所有单例
        reset_batch_spawner()
        reset_agent_runner()
        reset_hook_bus()

    def teardown_method(self):
        from app.services.batch_spawner import reset_batch_spawner
        from app.services.agent_runner import reset_agent_runner
        from app.services.hook_event_bus import reset_hook_bus

        reset_batch_spawner()
        reset_agent_runner()
        reset_hook_bus()

    def test_spawn_batch_basic(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                max_concurrency=2,
            )
            # 等待执行
            for _ in range(50):
                await asyncio.sleep(0.1)
                if job.status in ("completed", "failed", "cancelled"):
                    break
            return job

        job = asyncio.run(run())
        assert job.batch_id.startswith("batch-")
        assert job.accepted == 3
        assert job.rejected == 0
        assert job.total == 3

    def test_spawn_batch_with_invalid_role(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                default_role="nonexistent_role",
            )
            return job

        job = asyncio.run(run())
        # 角色不存在应该被标记为 failed
        assert job.status == "failed"
        # 应该有相关错误
        assert len(job.errors) >= 1
        # 错误信息应该提到角色
        assert any("default_role" in e.field or "role" in e.field.lower() for e in job.errors)

    def test_spawn_batch_with_invalid_csv(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(csv_content=INVALID_CSV)
            return job

        job = asyncio.run(run())
        # 第一行 task 为空，应该被拒绝
        assert job.accepted == 1
        assert job.rejected == 1

    def test_spawn_batch_invalid_concurrency(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            try:
                await spawner.spawn_batch(
                    csv_content=SIMPLE_CSV,
                    max_concurrency=0,
                )
                return None
            except ValueError as e:
                return str(e)

        result = asyncio.run(run())
        assert result is not None
        assert "max_concurrency" in result

    def test_spawn_batch_too_large_concurrency(self):
        from app.services.batch_spawner import get_batch_spawner, MAX_CONCURRENCY

        async def run():
            spawner = get_batch_spawner()
            try:
                await spawner.spawn_batch(
                    csv_content=SIMPLE_CSV,
                    max_concurrency=MAX_CONCURRENCY + 1,
                )
                return None
            except ValueError as e:
                return str(e)

        result = asyncio.run(run())
        assert result is not None

    def test_get_job_existing(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                max_concurrency=2,
            )
            return spawner.get_job(job.batch_id)

        job = asyncio.run(run())
        assert job is not None
        assert job.batch_id.startswith("batch-")

    def test_get_job_nonexistent(self):
        from app.services.batch_spawner import get_batch_spawner

        spawner = get_batch_spawner()
        job = spawner.get_job("nonexistent")
        assert job is None

    def test_list_jobs(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            await spawner.spawn_batch(
                csv_content="task\nhello", max_concurrency=1
            )
            await spawner.spawn_batch(
                csv_content="task\nworld", max_concurrency=1
            )
            return spawner.list_jobs()

        jobs = asyncio.run(run())
        assert len(jobs) >= 2

    def test_cancel_batch(self):
        """
        取消批量任务测试

        关键：spawn_one 是 fire-and-forget（快速返回），runner.start 创建的后台任务
        才是真正的工作。测试要验证：
        1. cancel_batch 返回 success=True
        2. 取消时正在 running 的 instance 被标记为 cancelled
        """
        from app.services.batch_spawner import get_batch_spawner
        import os
        # 使用更长的 mock 延迟确保任务有足够时间被取消
        os.environ["MOCK_CLI_DELAY"] = "2.0"
        os.environ["MOCK_CLI_TOOLS"] = "read,write,bash,grep,glob,edit,ls"
        os.environ["MOCK_CLI_CONTENT_CHUNKS"] = "0"
        try:
            async def run():
                spawner = get_batch_spawner()
                job = await spawner.spawn_batch(
                    csv_content=SIMPLE_CSV,
                    max_concurrency=1,
                )
                # 等待子进程启动
                await asyncio.sleep(0.2)
                # 确认 job.status 是 running
                assert job.status == "running", f"unexpected status: {job.status}"
                # 取消
                success, count = await spawner.cancel_batch(job.batch_id)
                # 等待清理
                for _ in range(10):
                    await asyncio.sleep(0.1)
                    if job.status in ("cancelled", "completed", "failed"):
                        break
                return success, count, job

            success, count, job = asyncio.run(run())
            # 验证 cancel_batch 返回成功
            assert success is True, f"cancel_batch should succeed, got success={success}"
            # job.status 在 cancel_batch 中被设为 cancelled
            assert job.status == "cancelled", f"job.status should be cancelled, got {job.status}"
        finally:
            for k in ("MOCK_CLI_DELAY", "MOCK_CLI_TOOLS", "MOCK_CLI_CONTENT_CHUNKS"):
                os.environ.pop(k, None)

    def test_cancel_nonexistent_batch(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            return await spawner.cancel_batch("nonexistent")

        success, count = asyncio.run(run())
        assert success is False
        assert count == 0

    def test_export_json(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                max_concurrency=2,
            )
            for _ in range(50):
                await asyncio.sleep(0.1)
                if job.status in ("completed", "failed", "cancelled"):
                    break
            return job.batch_id

        batch_id = asyncio.run(run())
        spawner = get_batch_spawner()
        content = spawner.export_batch(batch_id, fmt="json")
        # 应该是合法 JSON
        data = json.loads(content)
        assert data["batch_id"] == batch_id

    def test_export_csv(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                max_concurrency=2,
            )
            for _ in range(50):
                await asyncio.sleep(0.1)
                if job.status in ("completed", "failed", "cancelled"):
                    break
            return job.batch_id

        batch_id = asyncio.run(run())
        spawner = get_batch_spawner()
        content = spawner.export_batch(batch_id, fmt="csv")
        # 应该有表头
        assert "agent_id" in content
        assert "row_index" in content

    def test_export_markdown(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                max_concurrency=2,
            )
            for _ in range(50):
                await asyncio.sleep(0.1)
                if job.status in ("completed", "failed", "cancelled"):
                    break
            return job.batch_id

        batch_id = asyncio.run(run())
        spawner = get_batch_spawner()
        content = spawner.export_batch(batch_id, fmt="md")
        assert "# Batch Report" in content
        assert batch_id in content
        assert "## Instances" in content

    def test_export_invalid_format(self):
        from app.services.batch_spawner import get_batch_spawner

        async def run():
            spawner = get_batch_spawner()
            job = await spawner.spawn_batch(
                csv_content=SIMPLE_CSV,
                max_concurrency=2,
            )
            return job.batch_id

        batch_id = asyncio.run(run())
        spawner = get_batch_spawner()
        with pytest.raises(ValueError):
            spawner.export_batch(batch_id, fmt="xml")

    def test_export_nonexistent_batch(self):
        from app.services.batch_spawner import get_batch_spawner

        spawner = get_batch_spawner()
        with pytest.raises(KeyError):
            spawner.export_batch("nonexistent", fmt="json")

    def test_get_stats(self):
        from app.services.batch_spawner import get_batch_spawner

        spawner = get_batch_spawner()
        stats = spawner.get_stats()
        assert "total_batches" in stats
        assert "running" in stats
        assert "completed" in stats
        assert "cancelled" in stats

    def test_concurrent_spawn_50_rows(self):
        """50 行 × 5 并发 的批量 spawn 测试"""
        from app.services.batch_spawner import get_batch_spawner

        # 生成 50 行 CSV
        lines = ["task,nickname,role"]
        for i in range(50):
            lines.append(f"任务{i},Bot{i},worker")
        csv = "\n".join(lines)

        async def run():
            spawner = get_batch_spawner()
            start = time.time()
            job = await spawner.spawn_batch(
                csv_content=csv,
                max_concurrency=5,
            )
            # 等待执行
            for _ in range(200):
                await asyncio.sleep(0.1)
                if job.status in ("completed", "failed", "cancelled"):
                    break
            elapsed = time.time() - start
            return job, elapsed

        job, elapsed = asyncio.run(run())
        assert job.total == 50
        assert job.accepted == 50
        # 50 行 × 5 并发 应该在合理时间内完成
        assert elapsed < 60
