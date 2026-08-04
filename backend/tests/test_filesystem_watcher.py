"""
# ============================================================
# FileSystemWatcher 单元测试 (Cycle 64 G64-02)
# ====================================
# 覆盖：
#   - 路径管理（add/remove/list）
#   - Stage 推断（按文件扩展名）
#   - 事件去重（防抖）
#   - 排除规则
#   - 回调派发
# ====================================
"""

import asyncio
import os
import sys
import time
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(PROJECT_ROOT))


@pytest.fixture(autouse=True)
def reset_watcher():
    from app.services.filesystem_watcher import reset_filesystem_watcher
    reset_filesystem_watcher()
    yield
    reset_filesystem_watcher()


# ============================================================
# 路径管理
# ====================================


class TestPathManagement:
    def test_add_watch_path(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        with tempfile.TemporaryDirectory() as tmpdir:
            watcher = FileSystemWatcher()
            watcher.add_watch_path(tmpdir)
            paths = watcher.list_watch_paths()
            assert len(paths) == 1
            assert Path(paths[0]).resolve() == Path(tmpdir).resolve()

    def test_add_nonexistent_path_raises(self):
        from app.services.filesystem_watcher import FileSystemWatcher, InvalidPathError

        watcher = FileSystemWatcher()
        with pytest.raises(InvalidPathError):
            watcher.add_watch_path("/nonexistent/path/12345")

    def test_add_file_path_raises(self):
        from app.services.filesystem_watcher import FileSystemWatcher, InvalidPathError

        with tempfile.NamedTemporaryFile() as f:
            watcher = FileSystemWatcher()
            with pytest.raises(InvalidPathError):
                watcher.add_watch_path(f.name)

    def test_remove_watch_path(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        with tempfile.TemporaryDirectory() as tmpdir:
            watcher = FileSystemWatcher()
            watcher.add_watch_path(tmpdir)
            assert len(watcher.list_watch_paths()) == 1
            assert watcher.remove_watch_path(tmpdir) is True
            assert len(watcher.list_watch_paths()) == 0

    def test_remove_nonexistent_path(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher.remove_watch_path("/nonexistent") is False

    def test_get_path_state(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        with tempfile.TemporaryDirectory() as tmpdir:
            watcher = FileSystemWatcher()
            watcher.add_watch_path(tmpdir)
            assert watcher.get_path_state(tmpdir) == "running"

    def test_constructor_with_paths(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        with tempfile.TemporaryDirectory() as tmp1, tempfile.TemporaryDirectory() as tmp2:
            watcher = FileSystemWatcher(watch_paths=[tmp1, tmp2])
            assert len(watcher.list_watch_paths()) == 2


# ============================================================
# Stage 推断
# ====================================


class TestStageInference:
    def test_infer_coding_from_py(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        event = FileSystemEvent("created", "/workspace/src/app.py")
        assert watcher.infer_stage(event) == "coding"

    def test_infer_coding_from_tsx(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        event = FileSystemEvent("modified", "/workspace/src/Component.tsx")
        assert watcher.infer_stage(event) == "coding"

    def test_infer_preview_from_json(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        event = FileSystemEvent("modified", "/workspace/config.json")
        assert watcher.infer_stage(event) == "preview"

    def test_infer_deploy_from_dockerfile(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        event = FileSystemEvent("created", "/workspace/Dockerfile")
        assert watcher.infer_stage(event) == "deploy"

    def test_infer_deploy_from_pyproject(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        event = FileSystemEvent("modified", "/workspace/pyproject.toml")
        assert watcher.infer_stage(event) == "deploy"

    def test_infer_prd_from_md(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        event = FileSystemEvent("created", "/workspace/README.md")
        assert watcher.infer_stage(event) == "prd"

    def test_infer_unknown_returns_current(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        watcher._current_stage = "coding"
        event = FileSystemEvent("created", "/workspace/file.xyz")
        assert watcher.infer_stage(event) == "coding"

    def test_delete_event_keeps_current(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        watcher = FileSystemWatcher()
        watcher._current_stage = "preview"
        event = FileSystemEvent("deleted", "/workspace/src/app.py")
        assert watcher.infer_stage(event) == "preview"


# ============================================================
# 排除规则
# ====================================


class TestExcludeRules:
    def test_exclude_node_modules(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher._should_exclude_path("/workspace/node_modules/foo/bar.js") is True

    def test_exclude_git(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher._should_exclude_path("/workspace/.git/HEAD") is True

    def test_exclude_pycache(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher._should_exclude_path("/workspace/src/__pycache__/foo.pyc") is True

    def test_exclude_venv(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher._should_exclude_path("/workspace/.venv/lib/python3.10/site.py") is True

    def test_include_normal_path(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher._should_exclude_path("/workspace/src/app.py") is False

    def test_exclude_dir_name(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher._should_exclude("node_modules") is True
        assert watcher._should_exclude("src") is False


# ============================================================
# 事件去重（防抖）
# ====================================


class TestEventDebounce:
    def test_debounce_filters_rapid_events(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher(debounce_ms=100)
        # 快速触发同一文件 5 次
        for _ in range(5):
            watcher._handle_event("modified", "/workspace/test.py", False)
        events = watcher.get_recent_events()
        # 防抖应只保留 1 条
        assert len(events) == 1

    def test_no_debounce_for_different_files(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher(debounce_ms=100)
        watcher._handle_event("modified", "/workspace/a.py", False)
        watcher._handle_event("modified", "/workspace/b.py", False)
        watcher._handle_event("modified", "/workspace/c.py", False)
        events = watcher.get_recent_events()
        assert len(events) == 3


# ============================================================
# 回调
# ====================================


class TestCallbacks:
    def test_global_callback_receives_events(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        received = []
        watcher.on_any(lambda e: received.append(e))
        watcher._handle_event("created", "/workspace/test.py", False)
        assert len(received) == 1
        assert received[0].event_type == "created"
        assert received[0].path == "/workspace/test.py"

    def test_typed_callback_filters_by_event_type(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        created_events = []
        deleted_events = []
        watcher.on("created", lambda e: created_events.append(e))
        watcher.on("deleted", lambda e: deleted_events.append(e))
        watcher._handle_event("created", "/workspace/a.py", False)
        watcher._handle_event("created", "/workspace/b.py", False)
        watcher._handle_event("deleted", "/workspace/c.py", False)
        assert len(created_events) == 2
        assert len(deleted_events) == 1

    def test_callback_exception_doesnt_break_dispatch(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        good_received = []
        def bad_cb(e):
            raise RuntimeError("intentional")
        def good_cb(e):
            good_received.append(e)
        watcher.on_any(bad_cb)
        watcher.on_any(good_cb)
        # bad_cb 会失败但 good_cb 应仍然执行
        watcher._handle_event("created", "/workspace/test.py", False)
        assert len(good_received) == 1


# ============================================================
# 事件历史
# ====================================


class TestEventHistory:
    def test_history_capped_at_max(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher(max_event_history=10, debounce_ms=0)
        for i in range(20):
            watcher._handle_event("created", f"/workspace/file_{i}.py", False)
        events = watcher.get_recent_events(limit=100)
        assert len(events) == 10
        # 应只保留最后 10 条
        assert events[-1].path == "/workspace/file_19.py"
        assert events[0].path == "/workspace/file_10.py"

    def test_clear_events(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher(debounce_ms=0)
        for i in range(5):
            watcher._handle_event("created", f"/workspace/f_{i}.py", False)
        assert len(watcher.get_recent_events()) == 5
        watcher.clear_events()
        assert len(watcher.get_recent_events()) == 0


# ============================================================
# Stage 切换
# ============================================================


class TestStageTransition:
    def test_update_stage_returns_true_on_change(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        assert watcher.update_current_stage("coding") is True
        assert watcher.get_current_stage() == "coding"

    def test_update_stage_returns_false_on_no_change(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        watcher = FileSystemWatcher()
        watcher._current_stage = "coding"
        assert watcher.update_current_stage("coding") is False


# ============================================================
# 统计
# ====================================


class TestStats:
    def test_get_stats(self):
        from app.services.filesystem_watcher import FileSystemWatcher

        with tempfile.TemporaryDirectory() as tmp:
            watcher = FileSystemWatcher(watch_paths=[tmp])
            watcher._handle_event("created", "/workspace/test.py", False)
            stats = watcher.get_stats()
            assert stats["watch_paths"] == 1
            assert stats["event_count"] == 1
            # current_stage 仅在 infer + update 时改变
            assert stats["current_stage"] == "idle"
            assert "callbacks" in stats
            assert "global_callbacks" in stats

    def test_get_stats_after_stage_infer(self):
        from app.services.filesystem_watcher import FileSystemWatcher, FileSystemEvent

        with tempfile.TemporaryDirectory() as tmp:
            watcher = FileSystemWatcher(watch_paths=[tmp])
            event = FileSystemEvent("created", "/workspace/test.py")
            new_stage = watcher.infer_stage(event)
            watcher.update_current_stage(new_stage)
            stats = watcher.get_stats()
            assert stats["current_stage"] == "coding"


# ============================================================
# API 集成测试
# ============================================================


class TestFSWatcherAPI:
    def test_add_and_list_paths(self):
        from app.services.filesystem_watcher import reset_filesystem_watcher, FileSystemWatcher
        from app.services.filesystem_watcher import reset_filesystem_watcher as rfw
        from app.main import app
        from fastapi.testclient import TestClient

        rfw()
        watcher = FileSystemWatcher()
        with patch("app.api.fs_watcher.get_filesystem_watcher", return_value=watcher):
            with TestClient(app) as client:
                with tempfile.TemporaryDirectory() as tmp:
                    resp = client.post("/api/fs-watcher/paths", json={"path": tmp})
                    assert resp.status_code == 200
                    list_resp = client.get("/api/fs-watcher/paths")
                    assert list_resp.status_code == 200
                    assert list_resp.json()["total"] >= 1

    def test_stage_infer_endpoint(self):
        from app.services.filesystem_watcher import FileSystemWatcher, reset_filesystem_watcher
        from app.main import app
        from fastapi.testclient import TestClient

        reset_filesystem_watcher()
        watcher = FileSystemWatcher()
        with patch("app.api.fs_watcher.get_filesystem_watcher", return_value=watcher):
            with TestClient(app) as client:
                resp = client.post(
                    "/api/fs-watcher/stage/infer",
                    json={"path": "/workspace/src/app.py"},
                )
                assert resp.status_code == 200
                data = resp.json()
                assert data["stage"] == "coding"
                assert data["changed"] is True

    def test_events_endpoint(self):
        from app.services.filesystem_watcher import FileSystemWatcher, reset_filesystem_watcher
        from app.main import app
        from fastapi.testclient import TestClient

        reset_filesystem_watcher()
        watcher = FileSystemWatcher(debounce_ms=0)
        watcher._handle_event("created", "/workspace/test.py", False)
        with patch("app.api.fs_watcher.get_filesystem_watcher", return_value=watcher):
            with TestClient(app) as client:
                resp = client.get("/api/fs-watcher/events")
                assert resp.status_code == 200
                data = resp.json()
                assert data["total"] >= 1
                assert data["events"][0]["event_type"] == "created"

    def test_clear_events_endpoint(self):
        from app.services.filesystem_watcher import FileSystemWatcher, reset_filesystem_watcher
        from app.main import app
        from fastapi.testclient import TestClient

        reset_filesystem_watcher()
        watcher = FileSystemWatcher(debounce_ms=0)
        watcher._handle_event("created", "/workspace/test.py", False)
        with patch("app.api.fs_watcher.get_filesystem_watcher", return_value=watcher):
            with TestClient(app) as client:
                resp = client.delete("/api/fs-watcher/events")
                assert resp.status_code == 200
                events_resp = client.get("/api/fs-watcher/events")
                assert events_resp.json()["total"] == 0

    def test_get_stats_endpoint(self):
        from app.services.filesystem_watcher import FileSystemWatcher, reset_filesystem_watcher
        from app.main import app
        from fastapi.testclient import TestClient

        reset_filesystem_watcher()
        watcher = FileSystemWatcher()
        with patch("app.api.fs_watcher.get_filesystem_watcher", return_value=watcher):
            with TestClient(app) as client:
                resp = client.get("/api/fs-watcher/stats")
                assert resp.status_code == 200
                data = resp.json()
                assert "stats" in data
                assert data["stats"]["watch_paths"] == 0

    def test_get_stage_endpoint(self):
        from app.services.filesystem_watcher import FileSystemWatcher, reset_filesystem_watcher
        from app.main import app
        from fastapi.testclient import TestClient

        reset_filesystem_watcher()
        watcher = FileSystemWatcher()
        with patch("app.api.fs_watcher.get_filesystem_watcher", return_value=watcher):
            with TestClient(app) as client:
                resp = client.get("/api/fs-watcher/stage")
                assert resp.status_code == 200
                assert resp.json()["stage"] == "idle"
