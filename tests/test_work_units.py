"""
# TRAE Work 单元测试
# ============================================================
# 覆盖 4 大子系统：Design Mode / Voice Chat / Global Memory / Video
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
# ============================================================
"""

from __future__ import annotations

import json
import os
import sys
import unittest
from typing import Any, Dict, List

# 添加项目根目录到 Python 路径
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PROJECT_ROOT)
_BACKEND_DIR = os.path.join(_PROJECT_ROOT, "backend")
sys.path.insert(0, _BACKEND_DIR)

from app.core.work.design import (
    COLOR_MAP,
    DesignMode,
    FONT_FAMILY_MAP,
    FONT_SIZE_MAP,
    GLOBAL_DESIGN_MODE,
    RADIUS_MAP,
    TEMPLATES,
    _extract_font_family,
    _extract_font_size,
    _extract_hex_color,
    _extract_named_color,
    _extract_radius,
    _extract_target,
)
from app.core.work.manager import WorkManager, get_work_manager
from app.core.work.memory import (
    GLOBAL_MEMORY,
    GlobalMemoryService,
    _compute_tag_match,
    _compute_text_similarity,
    _days_since,
    _recency_factor,
    _tokenize,
)
from app.core.work.models import (
    DesignDraft,
    DesignExportFormat,
    DesignSystem,
    DesignTemplate,
    KnowledgeCategory,
    KnowledgeEntry,
    KnowledgeSource,
    KnowledgeStatus,
    NLEditChange,
    VideoFrame,
    VideoGeneration,
    VideoMetadata,
    VideoScene,
    VideoStatus,
    VideoStyle,
    VideoSummary,
    VoiceMessage,
    VoiceSession,
    WebSearchResult,
    WorkStats,
    _now_iso,
    path_within,
    safe_filename,
)
from app.core.work.video import (
    GLOBAL_VIDEO,
    VideoService,
    _detect_scenes,
    _extract_extension,
    _extract_keywords,
    _mock_extract_metadata,
)
from app.core.work.voice import (
    GLOBAL_VOICE_CHAT,
    VoiceChatService,
    mock_stt,
    mock_tts,
    mock_web_search,
)


# ============================================================
# 1. Models 测试
# ============================================================


class TestModels(unittest.TestCase):
    """数据模型测试"""

    def test_now_iso(self):
        """ISO 时间戳格式"""
        ts = _now_iso()
        self.assertRegex(ts, r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")

    def test_safe_filename(self):
        """文件名清洗"""
        self.assertEqual(safe_filename("test.png"), "test.png")
        self.assertEqual(safe_filename("a/b/c"), "a_b_c")
        # "../../../etc/passwd" 会被 split + strip "." 后变成 "etc_passwd"
        result = safe_filename("../../../etc/passwd")
        self.assertNotIn("/", result)
        self.assertNotIn("\\", result)
        self.assertIn("passwd", result)
        self.assertEqual(safe_filename(""), "unnamed")

    def test_path_within(self):
        """路径白名单校验"""
        self.assertTrue(path_within("/tmp/hermes_trae_work/x.svg", "/tmp/hermes_trae_work"))
        self.assertTrue(path_within("/tmp/hermes_trae_work/sub/x.svg", "/tmp/hermes_trae_work"))
        self.assertFalse(path_within("/etc/passwd", "/tmp/hermes_trae_work"))
        self.assertFalse(path_within("/tmp/other/x.svg", "/tmp/hermes_trae_work"))

    def test_design_draft_to_dict(self):
        """DesignDraft 序列化"""
        draft = DesignDraft(
            draft_id="draft_1",
            name="Test",
            template="web",
            description="desc",
        )
        d = draft.to_dict()
        self.assertEqual(d["draft_id"], "draft_1")
        self.assertEqual(d["name"], "Test")
        self.assertEqual(d["template"], "web")
        self.assertIn("created_at", d)
        self.assertEqual(d["version"], 1)

    def test_design_system_to_dict(self):
        """DesignSystem 序列化"""
        sys_obj = DesignSystem(system_id="sys_1", name="Default")
        sys_obj.colors["primary"] = "#000000"
        d = sys_obj.to_dict()
        self.assertEqual(d["system_id"], "sys_1")
        self.assertEqual(d["colors"]["primary"], "#000000")

    def test_knowledge_entry_touch(self):
        """KnowledgeEntry 使用追踪"""
        entry = KnowledgeEntry(
            entry_id="kb_1",
            project_id="p1",
            category="preference",
            content="test",
        )
        initial_count = entry.use_count
        entry.touch()
        self.assertEqual(entry.use_count, initial_count + 1)

    def test_voice_session_touch(self):
        """VoiceSession 活跃时间更新"""
        sess = VoiceSession(session_id="v1", user_id="u1", project_id="p1")
        sess.touch()
        self.assertEqual(sess.status, "active")

    def test_video_frame(self):
        """VideoFrame 序列化"""
        frame = VideoFrame(
            frame_id="f1",
            video_id="v1",
            timestamp=12.5,
            file_path="/tmp/x.svg",
        )
        d = frame.to_dict()
        self.assertEqual(d["timestamp"], 12.5)
        self.assertTrue(d["is_key_frame"])

    def test_video_generation_default(self):
        """VideoGeneration 默认值"""
        gen = VideoGeneration(gen_id="g1", prompt="test")
        self.assertEqual(gen.status, "queued")
        self.assertEqual(gen.duration, 5.0)
        self.assertEqual(gen.style, "realistic")

    def test_work_stats_to_dict(self):
        """WorkStats 序列化"""
        stats = WorkStats(design_drafts=5, knowledge_entries=10)
        d = stats.to_dict()
        self.assertEqual(d["design_drafts"], 5)
        self.assertEqual(d["knowledge_entries"], 10)


# ============================================================
# 2. Design Mode 测试
# ============================================================


class TestDesignMode(unittest.TestCase):
    """设计模式测试"""

    def setUp(self):
        self.dm = DesignMode()

    def test_create_draft_web(self):
        """创建 Web 草图"""
        draft = self.dm.create_draft(
            name="MyPage", template="web", description="test", owner="u1"
        )
        self.assertEqual(draft.name, "MyPage")
        self.assertEqual(draft.template, "web")
        self.assertEqual(draft.owner, "u1")
        self.assertIn("<html", draft.html)
        self.assertGreater(len(draft.html), 100)

    def test_create_draft_mobile(self):
        """创建 Mobile 草图"""
        draft = self.dm.create_draft(
            name="MyApp", template="mobile", description="app"
        )
        self.assertEqual(draft.template, "mobile")
        self.assertIn("tabbar", draft.html)

    def test_create_draft_landing(self):
        """创建 Landing 草图"""
        draft = self.dm.create_draft(
            name="Landing", template="landing", description="hero"
        )
        self.assertIn("hero", draft.html.lower())

    def test_create_draft_components(self):
        """创建 Components 草图"""
        draft = self.dm.create_draft(
            name="UI", template="components", description="lib"
        )
        self.assertIn("button", draft.html.lower())

    def test_create_draft_poster(self):
        """创建 Poster 草图"""
        draft = self.dm.create_draft(
            name="Ad", template="poster", description="sale"
        )
        self.assertIn("poster", draft.html.lower())

    def test_create_draft_dashboard(self):
        """创建 Dashboard 草图"""
        draft = self.dm.create_draft(
            name="Stats", template="dashboard", description="analytics"
        )
        self.assertIn("sidebar", draft.html.lower())

    def test_create_draft_invalid_template(self):
        """无效模板异常"""
        with self.assertRaises(ValueError):
            self.dm.create_draft(name="X", template="invalid_tpl", description="x")

    def test_get_draft(self):
        """获取草图"""
        draft = self.dm.create_draft(
            name="X", template="web", description="d"
        )
        fetched = self.dm.get_draft(draft.draft_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.draft_id, draft.draft_id)

    def test_get_draft_not_found(self):
        """不存在的草图"""
        self.assertIsNone(self.dm.get_draft("not_exist"))

    def test_list_drafts(self):
        """列出草图"""
        self.dm.create_draft(name="A", template="web", description="")
        self.dm.create_draft(name="B", template="mobile", description="")
        drafts = self.dm.list_drafts()
        self.assertEqual(len(drafts), 2)

    def test_list_drafts_filter_owner(self):
        """按 owner 过滤"""
        self.dm.create_draft(name="A", template="web", description="", owner="u1")
        self.dm.create_draft(name="B", template="web", description="", owner="u2")
        drafts = self.dm.list_drafts(owner="u1")
        self.assertEqual(len(drafts), 1)
        self.assertEqual(drafts[0].owner, "u1")

    def test_list_drafts_filter_template(self):
        """按 template 过滤"""
        self.dm.create_draft(name="A", template="web", description="")
        self.dm.create_draft(name="B", template="mobile", description="")
        drafts = self.dm.list_drafts(template="mobile")
        self.assertEqual(len(drafts), 1)

    def test_update_draft(self):
        """更新草图"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        initial_version = draft.version
        updated = self.dm.update_draft(
            draft.draft_id, name="Y", description="new"
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated.name, "Y")
        self.assertEqual(updated.description, "new")
        self.assertGreater(updated.version, initial_version)

    def test_update_draft_not_found(self):
        """更新不存在的草图"""
        self.assertIsNone(self.dm.update_draft("not_exist", name="X"))

    def test_update_draft_style(self):
        """更新样式"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        updated = self.dm.update_draft(
            draft.draft_id, style={"primary_color": "#FF0000"}
        )
        self.assertEqual(updated.style["primary_color"], "#FF0000")

    def test_delete_draft(self):
        """删除草图"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        self.assertTrue(self.dm.delete_draft(draft.draft_id))
        self.assertIsNone(self.dm.get_draft(draft.draft_id))

    def test_delete_draft_not_found(self):
        """删除不存在的草图"""
        self.assertFalse(self.dm.delete_draft("not_exist"))

    def test_nl_edit_color_hex(self):
        """NL 编辑：hex 颜色"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        updated, changes = self.dm.apply_nl_edit(
            draft.draft_id, "把主色改为 #FF0000"
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated.style["primary_color"], "#FF0000")
        self.assertEqual(len(changes), 1)
        self.assertEqual(changes[0].type, "color")

    def test_nl_edit_color_named(self):
        """NL 编辑：命名颜色"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        updated, changes = self.dm.apply_nl_edit(
            draft.draft_id, "改成红色"
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated.style["primary_color"], "#EF4444")

    def test_nl_edit_radius(self):
        """NL 编辑：圆角"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        updated, changes = self.dm.apply_nl_edit(
            draft.draft_id, "按钮改成圆角"
        )
        self.assertIsNotNone(updated)
        self.assertEqual(updated.style["btn_radius"], "8px")

    def test_nl_edit_radius_pill(self):
        """NL 编辑：圆形"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        updated, _ = self.dm.apply_nl_edit(
            draft.draft_id, "所有按钮改成圆形"
        )
        self.assertEqual(updated.style["btn_radius"], "50%")

    def test_nl_edit_font(self):
        """NL 编辑：字体"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        updated, changes = self.dm.apply_nl_edit(
            draft.draft_id, "字体改为思源黑体"
        )
        self.assertIsNotNone(updated)
        self.assertIn("Source Han Sans", updated.style["font_family"])

    def test_nl_edit_not_found(self):
        """NL 编辑：草图不存在"""
        updated, changes = self.dm.apply_nl_edit("not_exist", "change")
        self.assertIsNone(updated)
        self.assertEqual(len(changes), 0)

    def test_export_html(self):
        """导出 HTML"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        result = self.dm.export_code(draft.draft_id, "html")
        self.assertIsNotNone(result)
        self.assertEqual(result["format"], "html")
        self.assertIn("<html", result["code"])

    def test_export_react(self):
        """导出 React"""
        draft = self.dm.create_draft(name="MyPage", template="web", description="d")
        result = self.dm.export_code(draft.draft_id, "react")
        self.assertIsNotNone(result)
        self.assertIn("import React", result["code"])
        self.assertIn("MyPage", result["code"])

    def test_export_tailwind(self):
        """导出 Tailwind"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        result = self.dm.export_code(draft.draft_id, "tailwind")
        self.assertEqual(result["format"], "tailwind")
        self.assertIn("Tailwind", result["code"])

    def test_export_vue(self):
        """导出 Vue"""
        draft = self.dm.create_draft(name="MyVue", template="web", description="d")
        result = self.dm.export_code(draft.draft_id, "vue")
        self.assertIn("<template>", result["code"])
        self.assertIn("MyVue", result["code"])

    def test_export_invalid_format(self):
        """无效导出格式"""
        draft = self.dm.create_draft(name="X", template="web", description="d")
        with self.assertRaises(ValueError):
            self.dm.export_code(draft.draft_id, "invalid_format")

    def test_create_system(self):
        """创建设计系统"""
        system = self.dm.create_system(
            name="MySystem",
            colors={"primary": "#FF0000"},
        )
        self.assertEqual(system.name, "MySystem")
        self.assertEqual(system.colors["primary"], "#FF0000")

    def test_get_system(self):
        """获取设计系统"""
        system = self.dm.create_system(name="X")
        fetched = self.dm.get_system(system.system_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.system_id, system.system_id)

    def test_list_systems(self):
        """列出设计系统"""
        self.dm.create_system(name="A")
        self.dm.create_system(name="B", owner="u2")
        systems = self.dm.list_systems()
        self.assertEqual(len(systems), 2)

    def test_update_system(self):
        """更新设计系统"""
        system = self.dm.create_system(name="X")
        updated = self.dm.update_system(
            system.system_id, colors={"primary": "#00FF00"}
        )
        self.assertEqual(updated.colors["primary"], "#00FF00")

    def test_delete_system(self):
        """删除设计系统"""
        system = self.dm.create_system(name="X")
        self.assertTrue(self.dm.delete_system(system.system_id))
        self.assertIsNone(self.dm.get_system(system.system_id))

    def test_get_stats(self):
        """获取统计"""
        self.dm.create_draft(name="A", template="web", description="")
        self.dm.create_system(name="B")
        stats = self.dm.get_stats()
        self.assertEqual(stats["drafts"], 1)
        self.assertEqual(stats["systems"], 1)


class TestDesignExtractors(unittest.TestCase):
    """NL 编辑辅助函数测试"""

    def test_extract_hex_color(self):
        """提取 hex 颜色"""
        self.assertEqual(_extract_hex_color("改成 #FF0000"), "#FF0000")
        self.assertEqual(_extract_hex_color("no color"), None)
        self.assertEqual(_extract_hex_color("#abcdef main"), "#ABCDEF")

    def test_extract_named_color(self):
        """提取命名颜色"""
        self.assertEqual(_extract_named_color("改成红色"), "#EF4444")
        self.assertEqual(_extract_named_color("blue theme"), "#3B82F6")
        self.assertEqual(_extract_named_color("紫色背景"), "#8B5CF6")

    def test_extract_radius(self):
        """提取圆角"""
        self.assertEqual(_extract_radius("圆角"), "8px")
        self.assertEqual(_extract_radius("圆形按钮"), "50%")
        self.assertEqual(_extract_radius("rounded"), "8px")
        self.assertEqual(_extract_radius("16px"), "16px")

    def test_extract_font_size(self):
        """提取字号"""
        self.assertEqual(_extract_font_size("小号字"), "0.875rem")
        self.assertEqual(_extract_font_size("字号大"), "1.25rem")
        self.assertEqual(_extract_font_size("18px"), "1.125rem")

    def test_extract_font_family(self):
        """提取字体"""
        self.assertIn("Source Han", _extract_font_family("思源黑体"))
        self.assertIn("Microsoft YaHei", _extract_font_family("黑体"))
        self.assertIn("Inter", _extract_font_family("inter字体"))

    def test_extract_target(self):
        """提取编辑目标"""
        self.assertEqual(_extract_target("按钮变红色"), "button")
        self.assertEqual(_extract_target("背景蓝"), "bg")
        self.assertEqual(_extract_target("主色调整"), "primary")
        self.assertEqual(_extract_target("全部改变"), "all")


# ============================================================
# 3. Voice Chat 测试
# ============================================================


class TestVoiceChat(unittest.TestCase):
    """语音聊天测试"""

    def setUp(self):
        self.vc = VoiceChatService()

    def test_create_session(self):
        """创建会话"""
        sess = self.vc.create_session(
            user_id="u1", project_id="p1", initial_message="hello"
        )
        self.assertEqual(sess.user_id, "u1")
        self.assertEqual(sess.project_id, "p1")
        self.assertEqual(len(sess.messages), 1)
        self.assertEqual(sess.messages[0]["text"], "hello")

    def test_create_session_no_initial(self):
        """创建无初始消息的会话"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        self.assertEqual(len(sess.messages), 0)

    def test_get_session(self):
        """获取会话"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        fetched = self.vc.get_session(sess.session_id)
        self.assertIsNotNone(fetched)

    def test_get_session_not_found(self):
        """获取不存在的会话"""
        self.assertIsNone(self.vc.get_session("not_exist"))

    def test_list_sessions(self):
        """列出会话"""
        self.vc.create_session(user_id="u1", project_id="p1")
        self.vc.create_session(user_id="u2", project_id="p2")
        sessions = self.vc.list_sessions()
        self.assertEqual(len(sessions), 2)

    def test_list_sessions_filter(self):
        """过滤会话"""
        self.vc.create_session(user_id="u1", project_id="p1")
        self.vc.create_session(user_id="u1", project_id="p2")
        sessions = self.vc.list_sessions(project_id="p1")
        self.assertEqual(len(sessions), 1)

    def test_close_session(self):
        """关闭会话"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        self.assertTrue(self.vc.close_session(sess.session_id))
        self.assertEqual(sess.status, "closed")

    def test_delete_session(self):
        """删除会话"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        self.assertTrue(self.vc.delete_session(sess.session_id))
        self.assertIsNone(self.vc.get_session(sess.session_id))

    def test_send_message(self):
        """发送消息"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        result = self.vc.send_message(
            session_id=sess.session_id,
            text="hello",
        )
        self.assertIn("message", result)
        self.assertIn("reply", result)
        self.assertEqual(result["message"]["text"], "hello")

    def test_send_message_with_context(self):
        """发送消息并注入上下文"""
        # 设置 memory provider
        from app.core.work.memory import GLOBAL_MEMORY
        GLOBAL_MEMORY.create_entry(
            project_id="p1",
            category="preference",
            content="用户喜欢蓝色主题",
            tags=["color", "ui"],
        )
        self.vc.set_memory_provider(GLOBAL_MEMORY)

        sess = self.vc.create_session(user_id="u1", project_id="p1")
        result = self.vc.send_message(
            session_id=sess.session_id,
            text="蓝色主题",
            use_context=True,
        )
        self.assertGreater(len(result["context_refs"]), 0)

    def test_send_message_with_web_search(self):
        """发送消息并执行 Web 搜索"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        result = self.vc.send_message(
            session_id=sess.session_id,
            text="Codex 文档",
            use_context=False,
            use_web_search=True,
        )
        self.assertGreater(len(result["web_results"]), 0)

    def test_send_message_session_not_found(self):
        """不存在的会话"""
        with self.assertRaises(ValueError):
            self.vc.send_message(session_id="not_exist", text="x")

    def test_send_message_closed_session(self):
        """已关闭的会话"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        self.vc.close_session(sess.session_id)
        with self.assertRaises(ValueError):
            self.vc.send_message(session_id=sess.session_id, text="x")

    def test_get_context(self):
        """获取上下文"""
        sess = self.vc.create_session(user_id="u1", project_id="p1")
        result = self.vc.get_context(sess.session_id)
        self.assertIn("context_refs", result)
        self.assertIn("details", result)

    def test_web_search(self):
        """Web 搜索"""
        results = self.vc.web_search("Codex", max_results=3)
        self.assertGreater(len(results), 0)
        for r in results:
            self.assertIn("title", r)
            self.assertIn("url", r)
            self.assertIn("relevance", r)

    def test_web_search_empty_query(self):
        """空查询"""
        results = self.vc.web_search("")
        self.assertEqual(len(results), 0)

    def test_web_search_with_sources(self):
        """指定源的 Web 搜索"""
        results = self.vc.web_search(
            "Codex", max_results=5, sources=["github", "openai-docs"]
        )
        self.assertGreater(len(results), 0)
        for r in results:
            self.assertIn(r["source"], ["github", "openai-docs"])

    def test_transcribe(self):
        """语音转写"""
        result = self.vc.transcribe(audio_id="a1", text_hint="hello world")
        self.assertEqual(result["audio_id"], "a1")
        self.assertEqual(result["text"], "hello world。")
        self.assertGreater(result["confidence"], 0)

    def test_synthesize(self):
        """语音合成"""
        result = self.vc.synthesize("hello world 测试")
        self.assertIn("audio_id", result)
        self.assertGreater(result["duration_estimate"], 0)
        self.assertEqual(result["format"], "wav")

    def test_get_stats(self):
        """获取统计"""
        stats = self.vc.get_stats()
        self.assertIn("sessions", stats)
        self.assertIn("messages", stats)


class TestVoiceMock(unittest.TestCase):
    """Voice Mock 函数测试"""

    def test_mock_stt(self):
        """STT Mock"""
        self.assertEqual(mock_stt(""), "")
        self.assertTrue(mock_stt("hello").endswith("。"))

    def test_mock_tts(self):
        """TTS Mock"""
        result = mock_tts("hello")
        self.assertIn("duration_estimate", result)
        self.assertIn("audio_id", result)

    def test_mock_web_search(self):
        """Web 搜索 Mock"""
        results = mock_web_search("Codex 文档", max_results=3)
        self.assertGreater(len(results), 0)
        # 检查按相关性排序
        relevances = [r.relevance for r in results]
        self.assertEqual(relevances, sorted(relevances, reverse=True))


# ============================================================
# 4. Global Memory 测试
# ============================================================


class TestGlobalMemory(unittest.TestCase):
    """Global Memory 测试"""

    def setUp(self):
        self.gm = GlobalMemoryService()

    def test_create_entry(self):
        """创建条目"""
        entry = self.gm.create_entry(
            project_id="p1",
            category="preference",
            content="test content",
            tags=["tag1", "tag2"],
        )
        self.assertEqual(entry.project_id, "p1")
        self.assertEqual(entry.category, "preference")
        self.assertEqual(entry.tags, ["tag1", "tag2"])
        self.assertEqual(entry.status, "active")
        self.assertEqual(entry.confidence, 1.0)

    def test_create_entry_invalid_category(self):
        """无效类别"""
        with self.assertRaises(ValueError):
            self.gm.create_entry(
                project_id="p1",
                category="invalid",
                content="x",
            )

    def test_create_entry_too_long(self):
        """内容过长"""
        with self.assertRaises(ValueError):
            self.gm.create_entry(
                project_id="p1",
                category="fact",
                content="x" * (16 * 1024 + 1),
            )

    def test_get_entry(self):
        """获取条目"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        fetched = self.gm.get_entry(entry.entry_id)
        self.assertIsNotNone(fetched)
        # get_entry 会更新 use_count
        self.assertGreaterEqual(fetched.use_count, 1)

    def test_list_entries(self):
        """列条目"""
        self.gm.create_entry(project_id="p1", category="preference", content="a")
        self.gm.create_entry(project_id="p1", category="fact", content="b")
        self.gm.create_entry(project_id="p2", category="preference", content="c")
        entries = self.gm.list_entries(project_id="p1")
        self.assertEqual(len(entries), 2)

    def test_list_entries_by_category(self):
        """按类别过滤"""
        self.gm.create_entry(project_id="p1", category="preference", content="a")
        self.gm.create_entry(project_id="p1", category="fact", content="b")
        entries = self.gm.list_entries(project_id="p1", category="fact")
        self.assertEqual(len(entries), 1)

    def test_list_entries_by_tags(self):
        """按标签过滤"""
        self.gm.create_entry(
            project_id="p1", category="preference", content="a", tags=["ui"]
        )
        self.gm.create_entry(
            project_id="p1", category="preference", content="b", tags=["backend"]
        )
        entries = self.gm.list_entries(project_id="p1", tags=["ui"])
        self.assertEqual(len(entries), 1)

    def test_list_entries_by_status(self):
        """按状态过滤"""
        e1 = self.gm.create_entry(project_id="p1", category="preference", content="a")
        e2 = self.gm.create_entry(project_id="p1", category="preference", content="b")
        self.gm.archive_entry(e2.entry_id)
        active = self.gm.list_entries(project_id="p1", status="active")
        archived = self.gm.list_entries(project_id="p1", status="archived")
        self.assertEqual(len(active), 1)
        self.assertEqual(len(archived), 1)

    def test_update_entry(self):
        """更新条目"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        updated = self.gm.update_entry(
            entry.entry_id, content="y", tags=["new_tag"]
        )
        self.assertEqual(updated.content, "y")
        self.assertEqual(updated.tags, ["new_tag"])

    def test_update_entry_invalid_status(self):
        """无效状态"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        with self.assertRaises(ValueError):
            self.gm.update_entry(entry.entry_id, status="invalid_status")

    def test_update_entry_not_found(self):
        """更新不存在的条目"""
        self.assertIsNone(self.gm.update_entry("not_exist", content="x"))

    def test_delete_entry(self):
        """删除条目"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        self.assertTrue(self.gm.delete_entry(entry.entry_id))
        self.assertIsNone(self.gm.get_entry(entry.entry_id))

    def test_archive_entry(self):
        """归档条目"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        self.assertTrue(self.gm.archive_entry(entry.entry_id))
        fetched = self.gm.list_entries(project_id="p1", status="archived")
        self.assertEqual(len(fetched), 1)

    def test_deprecate_entry(self):
        """废弃条目"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        self.assertTrue(self.gm.deprecate_entry(entry.entry_id))
        fetched = self.gm.list_entries(project_id="p1", status="deprecated")
        self.assertEqual(len(fetched), 1)

    def test_search(self):
        """检索"""
        self.gm.create_entry(
            project_id="p1",
            category="preference",
            content="用户喜欢蓝色主题",
            tags=["ui", "color"],
        )
        self.gm.create_entry(
            project_id="p1",
            category="fact",
            content="数据库是 PostgreSQL",
            tags=["backend", "database"],
        )
        results = self.gm.search(project_id="p1", query="蓝色", top_k=5)
        self.assertGreater(len(results), 0)
        self.assertIn("蓝色", results[0].content)

    def test_search_with_tags(self):
        """按标签检索"""
        self.gm.create_entry(
            project_id="p1",
            category="preference",
            content="A ui color test content",
            tags=["ui", "color"],
        )
        self.gm.create_entry(
            project_id="p1",
            category="fact",
            content="B backend test content",
            tags=["backend"],
        )
        results = self.gm.search(
            project_id="p1", query="ui test", tags=["ui"]
        )
        self.assertEqual(len(results), 1)

    def test_search_with_categories(self):
        """按类别检索"""
        self.gm.create_entry(project_id="p1", category="preference", content="A test content preference")
        self.gm.create_entry(project_id="p1", category="fact", content="B test content fact")
        results = self.gm.search(
            project_id="p1", query="B test fact", categories=["fact"]
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].category, "fact")

    def test_search_updates_usage(self):
        """检索更新使用统计"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="hello"
        )
        self.gm.search(project_id="p1", query="hello", top_k=1)
        updated = self.gm.get_entry(entry.entry_id)
        self.assertGreater(updated.use_count, 0)

    def test_search_min_relevance(self):
        """最小相关性阈值"""
        self.gm.create_entry(
            project_id="p1", category="preference", content="完全无关内容 xyz"
        )
        results = self.gm.search(
            project_id="p1", query="完全不相关 query", min_relevance=0.9
        )
        self.assertEqual(len(results), 0)

    def test_search_other_project(self):
        """其他项目的检索隔离"""
        self.gm.create_entry(project_id="p1", category="preference", content="x")
        results = self.gm.search(project_id="p2", query="x")
        self.assertEqual(len(results), 0)

    def test_search_archived_excluded(self):
        """归档条目不参与搜索"""
        entry = self.gm.create_entry(
            project_id="p1", category="preference", content="x"
        )
        self.gm.archive_entry(entry.entry_id)
        results = self.gm.search(project_id="p1", query="x")
        self.assertEqual(len(results), 0)

    def test_get_context_for_query(self):
        """为查询构建上下文"""
        self.gm.create_entry(
            project_id="p1", category="preference", content="user likes blue", tags=["ui"]
        )
        context = self.gm.get_context_for_query(
            project_id="p1", query="blue", top_k=3
        )
        self.assertGreater(len(context), 0)
        self.assertIn("content", context[0])

    def test_list_projects(self):
        """列出项目"""
        self.gm.create_entry(project_id="p1", category="preference", content="a")
        self.gm.create_entry(project_id="p2", category="fact", content="b")
        projects = self.gm.list_projects()
        self.assertIn("p1", projects)
        self.assertIn("p2", projects)

    def test_get_stats(self):
        """获取统计"""
        self.gm.create_entry(project_id="p1", category="preference", content="a")
        stats = self.gm.get_stats(project_id="p1")
        self.assertEqual(stats["total"], 1)
        self.assertEqual(stats["active"], 1)
        self.assertIn("by_category", stats)

    def test_get_stats_global(self):
        """获取全局统计"""
        stats = self.gm.get_stats()
        self.assertIn("created", stats)
        self.assertIn("active", stats)


class TestMemoryHelpers(unittest.TestCase):
    """Memory 辅助函数测试"""

    def test_tokenize(self):
        """分词"""
        tokens = _tokenize("hello world 你好世界")
        self.assertIn("hello", tokens)
        self.assertIn("world", tokens)
        # 至少包含你好 或 你好世界（看分词器实现）
        self.assertTrue(
            any(t in ["你好", "你好世界"] for t in tokens),
            f"Expected '你好' or '你好世界' in {tokens}",
        )

    def test_tokenize_empty(self):
        """空文本分词"""
        self.assertEqual(_tokenize(""), [])
        self.assertEqual(_tokenize(None), [])

    def test_compute_text_similarity(self):
        """文本相似度"""
        score = _compute_text_similarity(["hello", "world"], "hello world")
        self.assertGreater(score, 0)
        score2 = _compute_text_similarity(["xyz"], "hello world")
        self.assertEqual(score2, 0.0)

    def test_compute_tag_match(self):
        """标签匹配"""
        score = _compute_tag_match(["ui"], ["ui", "color"])
        self.assertEqual(score, 0.5)
        score2 = _compute_tag_match(["ui", "color"], ["ui", "color"])
        self.assertEqual(score2, 1.0)
        score3 = _compute_tag_match(["xyz"], ["ui"])
        self.assertEqual(score3, 0.0)

    def test_days_since(self):
        """天数计算"""
        days = _days_since(_now_iso())
        self.assertLess(days, 1.0)

    def test_recency_factor(self):
        """衰减因子"""
        factor = _recency_factor(_now_iso())
        # 0 衰减
        self.assertGreater(factor, 0.95)
        factor2 = _recency_factor("2020-01-01T00:00:00Z")
        self.assertLess(factor2, 0.5)


# ============================================================
# 5. Video 测试
# ============================================================


class TestVideo(unittest.TestCase):
    """视频服务测试"""

    def setUp(self):
        self.vs = VideoService()

    def test_upload_video(self):
        """上传视频"""
        meta = self.vs.upload_video(
            file_path="/tmp/test.mp4",
            file_size=10 * 1024 * 1024,
            uploaded_by="u1",
            title="Test Video",
        )
        self.assertEqual(meta.title, "Test Video")
        self.assertEqual(meta.uploaded_by, "u1")
        self.assertGreater(meta.duration, 0)
        self.assertEqual(meta.width, 1920)
        self.assertEqual(meta.height, 1080)
        self.assertEqual(meta.codec, "h264")
        self.assertIsNotNone(meta.thumbnail_path)

    def test_upload_video_invalid_size(self):
        """无效大小"""
        with self.assertRaises(ValueError):
            self.vs.upload_video(
                file_path="/tmp/test.mp4",
                file_size=0,
            )

    def test_upload_video_too_large(self):
        """过大文件"""
        with self.assertRaises(ValueError):
            self.vs.upload_video(
                file_path="/tmp/test.mp4",
                file_size=200 * 1024 * 1024,
            )

    def test_get_video(self):
        """获取视频"""
        meta = self.vs.upload_video(
            file_path="/tmp/test.mp4", file_size=10 * 1024 * 1024
        )
        fetched = self.vs.get_video(meta.video_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched.video_id, meta.video_id)

    def test_list_videos(self):
        """列出视频"""
        self.vs.upload_video("/tmp/a.mp4", 10 * 1024 * 1024, uploaded_by="u1")
        self.vs.upload_video("/tmp/b.mp4", 10 * 1024 * 1024, uploaded_by="u2")
        videos = self.vs.list_videos()
        self.assertEqual(len(videos), 2)

    def test_list_videos_filter(self):
        """按上传者过滤"""
        self.vs.upload_video("/tmp/a.mp4", 10 * 1024 * 1024, uploaded_by="u1")
        self.vs.upload_video("/tmp/b.mp4", 10 * 1024 * 1024, uploaded_by="u2")
        videos = self.vs.list_videos(uploaded_by="u1")
        self.assertEqual(len(videos), 1)

    def test_delete_video(self):
        """删除视频"""
        meta = self.vs.upload_video("/tmp/a.mp4", 10 * 1024 * 1024)
        self.assertTrue(self.vs.delete_video(meta.video_id))
        self.assertIsNone(self.vs.get_video(meta.video_id))

    def test_delete_video_not_found(self):
        """删除不存在的视频"""
        self.assertFalse(self.vs.delete_video("not_exist"))

    def test_extract_keyframes(self):
        """提取关键帧"""
        meta = self.vs.upload_video(
            "/tmp/test.mp4", 10 * 1024 * 1024
        )
        frames = self.vs.extract_keyframes(meta.video_id, frame_count=5)
        self.assertEqual(len(frames), 5)
        # 验证时间戳递增
        for i in range(1, len(frames)):
            self.assertGreaterEqual(frames[i].timestamp, frames[i - 1].timestamp)

    def test_extract_keyframes_clamps(self):
        """关键帧数量限制"""
        meta = self.vs.upload_video("/tmp/test.mp4", 10 * 1024 * 1024)
        frames = self.vs.extract_keyframes(meta.video_id, frame_count=100)
        self.assertEqual(len(frames), 20)  # max 20

        frames = self.vs.extract_keyframes(meta.video_id, frame_count=0)
        self.assertEqual(len(frames), 1)  # min 1

    def test_extract_keyframes_video_not_found(self):
        """视频不存在"""
        with self.assertRaises(ValueError):
            self.vs.extract_keyframes("not_exist", frame_count=5)

    def test_summarize(self):
        """生成摘要"""
        meta = self.vs.upload_video(
            "/tmp/test.mp4", 10 * 1024 * 1024, title="Test"
        )
        summary = self.vs.summarize(meta.video_id, frame_count=3)
        self.assertEqual(len(summary.key_frames), 3)
        self.assertEqual(summary.video_id, meta.video_id)
        self.assertGreater(len(summary.transcript), 0)
        self.assertGreater(len(summary.scenes), 0)
        self.assertIn("Test", summary.summary_text)

    def test_summarize_no_transcript(self):
        """生成无字幕摘要"""
        meta = self.vs.upload_video("/tmp/test.mp4", 10 * 1024 * 1024)
        summary = self.vs.summarize(
            meta.video_id, include_transcript=False
        )
        self.assertEqual(summary.transcript, "")

    def test_summarize_not_found(self):
        """视频不存在"""
        with self.assertRaises(ValueError):
            self.vs.summarize("not_exist")

    def test_generate_video(self):
        """Mock 生成视频"""
        gen = self.vs.generate_video(
            prompt="A beautiful sunset",
            duration=5.0,
            resolution="1280x720",
            style="realistic",
        )
        self.assertEqual(gen.status, "completed")
        self.assertGreater(len(gen.output_path), 0)
        self.assertEqual(gen.progress, 1.0)
        self.assertIn(gen.gen_id, gen.output_path)

    def test_generate_video_invalid_style(self):
        """无效风格"""
        with self.assertRaises(ValueError):
            self.vs.generate_video(
                prompt="test", style="invalid_style"
            )

    def test_generate_video_invalid_duration(self):
        """无效时长"""
        with self.assertRaises(ValueError):
            self.vs.generate_video(prompt="x", duration=0)
        with self.assertRaises(ValueError):
            self.vs.generate_video(prompt="x", duration=120)

    def test_generate_video_empty_prompt(self):
        """空提示词"""
        with self.assertRaises(ValueError):
            self.vs.generate_video(prompt="")

    def test_list_generations(self):
        """列出生成任务"""
        self.vs.generate_video("test 1", duration=3.0)
        self.vs.generate_video("test 2", duration=4.0)
        gens = self.vs.list_generations()
        self.assertEqual(len(gens), 2)

    def test_get_stats(self):
        """获取统计"""
        self.vs.upload_video("/tmp/a.mp4", 10 * 1024 * 1024)
        stats = self.vs.get_stats()
        self.assertEqual(stats["uploaded"], 1)


class TestVideoHelpers(unittest.TestCase):
    """视频辅助函数测试"""

    def test_extract_extension(self):
        """提取扩展名"""
        self.assertEqual(_extract_extension("test.mp4"), "mp4")
        self.assertEqual(_extract_extension("/tmp/test.WEBM"), "webm")
        self.assertEqual(_extract_extension("noext"), "mp4")
        self.assertEqual(_extract_extension(""), "mp4")

    def test_mock_extract_metadata(self):
        """Mock 元数据提取"""
        meta = _mock_extract_metadata("test.mp4", 10 * 1024 * 1024)
        self.assertEqual(meta.codec, "h264")
        self.assertEqual(meta.fps, 30)
        self.assertGreater(meta.duration, 0)

    def test_detect_scenes(self):
        """场景检测"""
        scenes = _detect_scenes(60.0, scene_count=3)
        self.assertEqual(len(scenes), 3)
        # 验证场景连续
        for i in range(1, len(scenes)):
            self.assertEqual(scenes[i][0], scenes[i - 1][1])

    def test_detect_scenes_auto(self):
        """自动场景数"""
        scenes = _detect_scenes(30.0)
        self.assertGreater(len(scenes), 1)
        self.assertLessEqual(len(scenes), 8)

    def test_detect_scenes_zero_duration(self):
        """零时长"""
        self.assertEqual(_detect_scenes(0), [])

    def test_extract_keywords(self):
        """关键词提取"""
        keywords = _extract_keywords("hello world hello 测试 测试", top_k=3)
        self.assertGreater(len(keywords), 0)
        self.assertLessEqual(len(keywords), 3)


# ============================================================
# 6. Manager 测试
# ============================================================


class TestWorkManager(unittest.TestCase):
    """统一管理器测试"""

    def setUp(self):
        self.mgr = WorkManager()

    def test_health(self):
        """健康检查"""
        health = self.mgr.health()
        self.assertEqual(health["status"], "ok")
        self.assertIn("modules", health)
        self.assertEqual(health["modules"]["design"], "ok")
        self.assertEqual(health["modules"]["voice"], "ok")
        self.assertEqual(health["modules"]["memory"], "ok")
        self.assertEqual(health["modules"]["video"], "ok")

    def test_get_stats(self):
        """全局统计"""
        stats = self.mgr.get_stats()
        self.assertIn("design", stats)
        self.assertIn("voice", stats)
        self.assertIn("memory", stats)
        self.assertIn("video", stats)

    def test_sub_services(self):
        """子服务访问"""
        self.assertIsNotNone(self.mgr.design)
        self.assertIsNotNone(self.mgr.voice)
        self.assertIsNotNone(self.mgr.memory)
        self.assertIsNotNone(self.mgr.video)

    def test_save_and_read_index(self):
        """保存与读取索引"""
        self.mgr.save_index("test.event", {"key": "value"})
        results = self.mgr.read_index(limit=10)
        self.assertGreater(len(results), 0)
        self.assertEqual(results[-1]["event"], "test.event")
        self.assertEqual(results[-1]["data"]["key"], "value")

    def test_clear_index(self):
        """清空索引"""
        self.mgr.save_index("test.event", {"key": "value"})
        cleared = self.mgr.clear_index()
        self.assertGreaterEqual(cleared, 1)

    def test_get_work_manager_singleton(self):
        """全局单例"""
        m1 = get_work_manager()
        m2 = get_work_manager()
        self.assertIs(m1, m2)

    def test_voice_memory_injection(self):
        """Voice → Memory 注入"""
        mgr = WorkManager()
        # 创建 memory 条目
        mgr.memory.create_entry(
            project_id="test_proj",
            category="preference",
            content="user likes blue",
            tags=["ui", "color"],
        )
        # voice 应该能自动使用 memory
        self.assertIs(mgr.voice._memory_provider, mgr.memory)


if __name__ == "__main__":
    unittest.main(verbosity=2)
