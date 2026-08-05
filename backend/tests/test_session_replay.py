"""
# ============================================================
# SessionReplayService 单元测试 (v1.0.0)
# Cycle 69 G69-02
# ====================================
# 测试覆盖：
#   1. session_id 校验
#   2. 列出本地 JSONL 会话
#   3. 加载会话 turns
#   4. 渲染 HTML（4 种主题）
#   5. 书签创建/查询/删除
#   6. Retention 策略（压缩 + 清理）
#   7. 导出（JSON / JSONL / Markdown）
#   8. 统计信息
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-02 初次创建
# ====================================
"""

import gzip
import json
import time
from pathlib import Path
from typing import Generator

import pytest

from app.services.session_replay import (
    Bookmark,
    InvalidSessionIdError,
    ReplayConfig,
    ReplayTheme,
    ReplayTurn,
    RenderTooLargeError,
    RetentionPolicy,
    RetentionResult,
    SessionMetadata,
    SessionNotFoundError,
    SessionReplayError,
    SessionReplayService,
    StorageStats,
    ToolCall,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def tmp_base_dir() -> Generator[Path, None, None]:
    with __import__("tempfile").TemporaryDirectory() as tmp:
        yield Path(tmp)


@pytest.fixture
def service(tmp_base_dir) -> SessionReplayService:
    return SessionReplayService(base_dir=tmp_base_dir)


def write_jsonl(path: Path, items: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


def write_jsonl_gz(path: Path, items: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(path, "wt", encoding="utf-8") as f:
        for item in items:
            f.write(json.dumps(item, ensure_ascii=False) + "\n")


SAMPLE_SESSION_ITEMS = [
    {
        "type": "session_meta",
        "timestamp": "2026-08-05T10:00:00Z",
        "payload": {
            "session_id": "test-session-001",
            "cwd": "/home/user/project",
            "git_branch": "main",
            "model": "claude-sonnet-4-5",
            "created_at": "2026-08-05T10:00:00Z",
        },
    },
    {
        "type": "event_msg",
        "timestamp": "2026-08-05T10:00:01Z",
        "payload": {
            "type": "user_message",
            "message": "请帮我重构这个函数",
        },
    },
    {
        "type": "response_item",
        "timestamp": "2026-08-05T10:00:05Z",
        "payload": {
            "type": "reasoning",
            "text": "分析问题：需要重构的函数逻辑",
        },
    },
    {
        "type": "response_item",
        "timestamp": "2026-08-05T10:00:10Z",
        "payload": {
            "type": "text",
            "role": "assistant",
            "text": "好的，我来帮你重构。",
        },
    },
    {
        "type": "response_item",
        "timestamp": "2026-08-05T10:00:15Z",
        "payload": {
            "type": "function_call",
            "name": "shell",
            "call_id": "call-1",
            "arguments": {"cmd": "ls -la"},
        },
    },
    {
        "type": "response_item",
        "timestamp": "2026-08-05T10:00:16Z",
        "payload": {
            "type": "function_call_output",
            "output": "file1.py file2.py",
            "call_id": "call-1",
        },
    },
]


# ============================================================
# 1. session_id 校验
# ============================================================


class TestSessionIdValidation:
    def test_valid_id(self, service):
        service.validate_session_id("abc-123_XYZ")
        # 不应抛异常

    def test_empty_id(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.validate_session_id("")

    def test_invalid_chars(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.validate_session_id("abc/../../etc/passwd")

    def test_too_long_id(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.validate_session_id("a" * 200)

    def test_path_traversal(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.validate_session_id("../../../etc")


# ============================================================
# 2. 列出本地 JSONL 会话
# ============================================================


class TestListSessions:
    def test_list_empty(self, service):
        sessions = service.list_sessions()
        assert sessions == []

    def test_list_single_session(self, service, tmp_base_dir):
        session_id = "test-session-001"
        write_jsonl(
            tmp_base_dir / "sessions" / session_id / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        sessions = service.list_sessions()
        assert len(sessions) == 1
        assert sessions[0].session_id == session_id
        assert sessions[0].cwd == "/home/user/project"
        assert sessions[0].git_branch == "main"
        assert sessions[0].model == "claude-sonnet-4-5"

    def test_list_multiple_sessions(self, service, tmp_base_dir):
        for i in range(3):
            write_jsonl(
                tmp_base_dir / "sessions" / f"session-{i:03d}" / "rollout.jsonl",
                [
                    {
                        "type": "session_meta",
                        "payload": {"session_id": f"session-{i:03d}", "cwd": f"/tmp/{i}"},
                    },
                ],
            )
        sessions = service.list_sessions()
        assert len(sessions) == 3

    def test_list_with_gz(self, service, tmp_base_dir):
        write_jsonl_gz(
            tmp_base_dir / "rollouts" / "rollout-gz-session.jsonl.gz",
            SAMPLE_SESSION_ITEMS,
        )
        sessions = service.list_sessions()
        # 至少有一个 session
        assert len(sessions) >= 1

    def test_list_limit(self, service, tmp_base_dir):
        for i in range(10):
            write_jsonl(
                tmp_base_dir / "sessions" / f"s-{i:03d}" / "rollout.jsonl",
                [{"type": "session_meta", "payload": {"session_id": f"s-{i:03d}"}}],
            )
        sessions = service.list_sessions(limit=3)
        assert len(sessions) == 3

    def test_session_id_from_path(self, service):
        p = Path("/tmp/sessions/abc-123/rollout.jsonl")
        assert service._session_id_from_path(p) == "abc-123"
        p2 = Path("/tmp/rollouts/rollout-xyz.jsonl")
        assert service._session_id_from_path(p2) == "xyz"
        # 通用目录名应该跳过
        p3 = Path("/tmp/sessions/rollout.jsonl")
        assert service._session_id_from_path(p3) == "rollout"


# ============================================================
# 3. 加载会话 turns
# ============================================================


class TestLoadSession:
    def test_load_existing(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "test-001" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        turns = service.load_session("test-001")
        assert len(turns) >= 4  # user + reasoning + assistant + tool_call
        # 第一条应该是 user
        user_turns = [t for t in turns if t.role == "user"]
        assert len(user_turns) >= 1
        assert "重构" in user_turns[0].content

    def test_load_nonexistent_raises(self, service):
        with pytest.raises(SessionNotFoundError):
            service.load_session("nonexistent-session-xyz")

    def test_load_invalid_id_raises(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.load_session("../etc/passwd")

    def test_turns_have_index_and_timestamp(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "test-002" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        turns = service.load_session("test-002")
        for i, t in enumerate(turns):
            assert t.turn_index == i
            assert t.timestamp != ""


# ============================================================
# 4. 渲染 HTML
# ============================================================


class TestRenderHtml:
    def test_render_html(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "html-test" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        html = service.render_html("html-test")
        assert "<!DOCTYPE html>" in html
        assert "html-test" in html
        assert "Play All" in html

    def test_render_with_themes(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "theme-test" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        for theme in ["default", "dark", "light", "oxide-blue"]:
            config = ReplayConfig(theme=ReplayTheme(theme))
            html = service.render_html("theme-test", config)
            assert "<!DOCTYPE html>" in html

    def test_render_invalid_theme_falls_back(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "fallback-test" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        # 即使传错主题也应能用
        config = ReplayConfig(theme=ReplayTheme.DEFAULT)
        html = service.render_html("fallback-test", config)
        assert html

    def test_html_escapes_user_content(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "xss-test" / "rollout.jsonl",
            [
                {
                    "type": "event_msg",
                    "payload": {
                        "type": "user_message",
                        "message": "<script>alert('xss')</script>",
                    },
                },
            ],
        )
        html = service.render_html("xss-test")
        # 危险内容必须被 escape 为 &lt;script&gt;
        # 模板自身有 1 个 <script> 标签（用于 JS），用户内容应被转义
        assert "&lt;script&gt;" in html
        # 计算未转义的 <script 出现次数
        # 移除所有 &lt;script&gt; 后，模板自身仍剩 1 个 <script>（用于 JS）
        sanitized = html.replace("&lt;script&gt;", "")
        # 模板内 <script> 标签只应该有 1 个
        assert sanitized.count("<script") == 1
        # 转义后的 </script> 也不应该出现
        sanitized2 = sanitized.replace("&lt;/script&gt;", "")
        assert sanitized2.count("</script>") == 1

    def test_render_nonexistent_raises(self, service):
        with pytest.raises(SessionNotFoundError):
            service.render_html("nonexistent")


# ============================================================
# 5. 书签
# ============================================================


class TestBookmarks:
    def test_create_bookmark(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "bm-test" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        bm = service.save_bookmark("bm-test", 2, "发现根因", "重要发现")
        assert isinstance(bm, Bookmark)
        assert bm.turn_index == 2
        assert bm.label == "发现根因"
        assert bm.note == "重要发现"
        assert bm.bookmark_id.startswith("bm-")

    def test_list_bookmarks(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "bm-list" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        service.save_bookmark("bm-list", 1, "Bookmark 1")
        service.save_bookmark("bm-list", 3, "Bookmark 2")
        bms = service.list_bookmarks("bm-list")
        assert len(bms) == 2
        assert bms[0].turn_index == 1
        assert bms[1].turn_index == 3

    def test_list_bookmarks_empty(self, service):
        bms = service.list_bookmarks("nonexistent-session")
        assert bms == []

    def test_delete_bookmark(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "bm-del" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        bm = service.save_bookmark("bm-del", 0, "ToDelete")
        removed = service.delete_bookmark("bm-del", bm.bookmark_id)
        assert removed is True
        # 再次删除应返回 False
        removed2 = service.delete_bookmark("bm-del", bm.bookmark_id)
        assert removed2 is False

    def test_create_bookmark_invalid_id(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.save_bookmark("../etc", 0, "label")

    def test_create_bookmark_negative_index(self, service):
        with pytest.raises(SessionReplayError):
            service.save_bookmark("valid-id", -1, "label")

    def test_create_bookmark_empty_label_uses_default(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "default-label" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        bm = service.save_bookmark("default-label", 0, "")
        assert "Bookmark at turn 0" in bm.label


# ============================================================
# 6. Retention 策略
# ============================================================


class TestRetention:
    def test_retention_no_expired(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "fresh" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        result = service.apply_retention()
        # 7 天内不压缩
        assert result.compressed == 0
        assert result.cleaned == 0

    def test_retention_compresses_old(self, service, tmp_base_dir):
        # 创建一个 8 天前的文件
        old_path = tmp_base_dir / "sessions" / "old-session" / "rollout.jsonl"
        write_jsonl(old_path, SAMPLE_SESSION_ITEMS)
        # 修改 mtime 为 8 天前
        eight_days_ago = time.time() - 8 * 86400
        import os
        os.utime(old_path, (eight_days_ago, eight_days_ago))
        result = service.apply_retention()
        assert result.compressed >= 1
        # 验证 .gz 文件存在
        gz_path = old_path.with_suffix(".jsonl.gz")
        assert gz_path.exists()

    def test_retention_cleans_very_old(self, service, tmp_base_dir):
        old_path = tmp_base_dir / "sessions" / "very-old" / "rollout.jsonl"
        write_jsonl(old_path, SAMPLE_SESSION_ITEMS)
        hundred_days_ago = time.time() - 100 * 86400
        import os
        os.utime(old_path, (hundred_days_ago, hundred_days_ago))
        result = service.apply_retention(RetentionPolicy(max_age_days=90))
        assert result.cleaned >= 1
        assert not old_path.exists()

    def test_retention_with_custom_policy(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "custom" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        policy = RetentionPolicy(max_age_days=30, compress_after_days=3)
        result = service.apply_retention(policy)
        assert result.total_size_before >= 0
        assert result.total_size_after >= 0


# ============================================================
# 7. 导出
# ============================================================


class TestExport:
    def test_export_json(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "export-test" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        data = service.export_session("export-test", format="json")
        assert isinstance(data, bytes)
        parsed = json.loads(data.decode("utf-8"))
        assert isinstance(parsed, list)
        assert len(parsed) >= 1

    def test_export_jsonl(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "export-jsonl" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        data = service.export_session("export-jsonl", format="jsonl")
        lines = data.decode("utf-8").strip().split("\n")
        assert len(lines) >= 1
        # 验证每行是 JSON
        for line in lines:
            json.loads(line)

    def test_export_md(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "export-md" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        data = service.export_session("export-md", format="md")
        text = data.decode("utf-8")
        assert "# Session" in text
        assert "Turn 0" in text

    def test_export_invalid_format(self, service, tmp_base_dir):
        write_jsonl(
            tmp_base_dir / "sessions" / "export-invalid" / "rollout.jsonl",
            SAMPLE_SESSION_ITEMS,
        )
        with pytest.raises(SessionReplayError):
            service.export_session("export-invalid", format="xml")

    def test_export_nonexistent(self, service):
        with pytest.raises(SessionNotFoundError):
            service.export_session("nonexistent", format="json")


# ============================================================
# 8. 统计信息
# ============================================================


class TestStats:
    def test_stats_empty(self, service):
        stats = service.get_stats()
        assert stats.total_sessions == 0
        assert stats.total_bookmarks == 0
        assert stats.total_size_bytes == 0

    def test_stats_with_sessions(self, service, tmp_base_dir):
        # 创建 3 个不同 session_id 的会话（每个有独立的 session_meta + created_at）
        for i in range(3):
            items = [
                {
                    "type": "session_meta",
                    "payload": {
                        "session_id": f"stat-{i}",
                        "cwd": f"/tmp/{i}",
                        "created_at": f"2026-08-0{i+1}T10:00:00Z",
                    },
                },
                {
                    "type": "event_msg",
                    "payload": {"type": "user_message", "message": f"hi {i}"},
                },
            ]
            write_jsonl(
                tmp_base_dir / "sessions" / f"stat-{i}" / "rollout.jsonl",
                items,
            )
        # 加书签
        service.save_bookmark("stat-0", 0, "Test BM")
        stats = service.get_stats()
        assert stats.total_sessions == 3
        assert stats.total_bookmarks == 1
        assert stats.total_size_bytes > 0
        assert stats.oldest_session_at is not None
        assert stats.oldest_session_at == "2026-08-01T10:00:00Z"


# ============================================================
# 9. 工具方法
# ============================================================


class TestToolCall:
    def test_to_dict(self):
        tc = ToolCall(name="shell", args={"cmd": "ls"}, call_id="c1")
        d = tc.to_dict()
        assert d["name"] == "shell"
        assert d["args"] == {"cmd": "ls"}

    def test_defaults(self):
        tc = ToolCall(name="x")
        d = tc.to_dict()
        assert d["output"] == ""
        assert d["duration_ms"] == 0
        assert d["exit_code"] == 0


class TestReplayTurn:
    def test_to_dict(self):
        turn = ReplayTurn(
            turn_index=0,
            timestamp="2026-08-05T12:00:00Z",
            role="user",
            content="hello",
        )
        d = turn.to_dict()
        assert d["turn_index"] == 0
        assert d["role"] == "user"
        assert d["content"] == "hello"
        assert d["tool_calls"] == []


class TestSessionMetadata:
    def test_to_dict(self):
        meta = SessionMetadata(session_id="abc", title="Test")
        d = meta.to_dict()
        assert d["session_id"] == "abc"
        assert d["title"] == "Test"
        assert d["total_turns"] == 0


class TestReplayConfig:
    def test_to_dict(self):
        config = ReplayConfig(theme=ReplayTheme.DARK)
        d = config.to_dict()
        assert d["theme"] == "dark"
        assert d["show_reasoning"] is True


class TestRetentionPolicy:
    def test_defaults(self):
        p = RetentionPolicy()
        assert p.max_age_days == 90
        assert p.compress_after_days == 7

    def test_to_dict(self):
        p = RetentionPolicy(max_age_days=30)
        d = p.to_dict()
        assert d["max_age_days"] == 30


# ============================================================
# 10. 路径遍历防护
# ============================================================


class TestSecurity:
    def test_path_traversal_blocked(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.load_session("../../../etc/passwd")

    def test_null_byte_blocked(self, service):
        with pytest.raises(InvalidSessionIdError):
            service.load_session("abc\x00def")

    def test_special_chars_blocked(self, service):
        for s in ["a b", "a@b", "a.b", "a/b", "a\\b", "a:b", "a;b"]:
            with pytest.raises(InvalidSessionIdError):
                service.load_session(s)
