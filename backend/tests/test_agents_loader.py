"""
# ============================================================
# AGENTS.md 指令加载器单元测试 (v1.0.0)
# Cycle 62 G62-04
# ====================================
# 测试覆盖：
#   - InstructionFile / InstructionSet 数据模型
#   - frontmatter 解析（YAML）
#   - 文件搜索（4 种来源 + 优先级）
#   - 加载 / 重新加载 / 缓存
#   - 系统 prompt 合并
#   - 全局单例
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 62 G62-04 初次创建
# ====================================
"""

import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

import pytest

from app.services.agents_loader import (
    AgentsInstructionLoader,
    InstructionFile,
    InstructionSet,
    InstructionSource,
    get_loader,
    reset_loader,
)


# ============================================================
# 工具函数
# ============================================================


def write_agents_md(path: str, content: str) -> None:
    """写入 AGENTS.md 文件"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


# ============================================================
# 数据模型测试
# ============================================================


class TestInstructionFile:
    """InstructionFile 数据模型测试"""

    def test_default_values(self):
        f = InstructionFile(
            source=InstructionSource.PROJECT_ROOT,
            path="/test/AGENTS.md",
            content="body",
            raw_content="body",
            frontmatter={},
            file_hash="abc",
            file_size=4,
            modified_at=0.0,
        )
        assert f.source == InstructionSource.PROJECT_ROOT
        assert f.path == "/test/AGENTS.md"
        assert f.content == "body"
        assert f.loaded_at > 0

    def test_to_dict(self):
        f = InstructionFile(
            source=InstructionSource.PROJECT_TRAE,
            path="/p/.trae/AGENTS.md",
            content="c",
            raw_content="c",
            frontmatter={"key": "value"},
            file_hash="h",
            file_size=1,
            modified_at=1.0,
        )
        d = f.to_dict()
        assert d["source"] == "project_trae"
        assert d["frontmatter"] == {"key": "value"}


class TestInstructionSet:
    """InstructionSet 数据模型测试"""

    def test_default_values(self):
        s = InstructionSet(project_path="/p")
        assert s.project_path == "/p"
        assert s.files == []
        assert s.combined_content == ""
        assert s.loaded_at > 0

    def test_to_dict(self):
        s = InstructionSet(project_path="/p")
        d = s.to_dict()
        assert d["project_path"] == "/p"
        assert d["file_count"] == 0


# ============================================================
# frontmatter 解析测试
# ============================================================


class TestFrontmatterParsing:
    """frontmatter 解析测试"""

    def test_no_frontmatter(self):
        loader = AgentsInstructionLoader()
        fm, body = loader._parse_frontmatter("plain content")
        assert fm == {}
        assert body == "plain content"

    def test_valid_frontmatter(self):
        loader = AgentsInstructionLoader()
        content = (
            "---\n"
            "name: test\n"
            "version: 1.0\n"
            "tags:\n"
            "  - a\n"
            "  - b\n"
            "---\n"
            "body content"
        )
        fm, body = loader._parse_frontmatter(content)
        assert fm["name"] == "test"
        assert fm["version"] == 1.0
        assert fm["tags"] == ["a", "b"]
        assert body == "body content"

    def test_invalid_frontmatter_fallback(self):
        loader = AgentsInstructionLoader()
        content = (
            "---\n"
            "invalid: yaml: :\n"
            "---\n"
            "body"
        )
        # 解析失败时回退到原始内容
        fm, body = loader._parse_frontmatter(content)
        # 失败时返回 ({}，原始 content)
        assert fm == {}
        assert "body" in body

    def test_empty_frontmatter(self):
        loader = AgentsInstructionLoader()
        # 空 frontmatter 不会被正则匹配（需要至少一个换行后的字段）
        content = "---\nkey: val\n---\nbody"
        fm, body = loader._parse_frontmatter(content)
        assert fm == {"key": "val"}
        assert body == "body"


# ============================================================
# 文件搜索测试
# ============================================================


class TestFindInstructionFiles:
    """文件搜索测试"""

    def test_no_project_dir(self):
        loader = AgentsInstructionLoader()
        files = loader.find_instruction_files("/nonexistent/path/xyz")
        assert files == []

    def test_empty_project(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            loader = AgentsInstructionLoader()
            files = loader.find_instruction_files(tmpdir)
            assert files == []

    def test_finds_project_root_agents_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(
                os.path.join(tmpdir, "AGENTS.md"),
                "# Project rules",
            )
            loader = AgentsInstructionLoader()
            files = loader.find_instruction_files(tmpdir)
            assert len(files) == 1
            assert files[0].source == InstructionSource.PROJECT_ROOT
            assert files[0].content == "# Project rules"

    def test_finds_trae_agents_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(
                os.path.join(tmpdir, ".trae", "AGENTS.md"),
                "# Trae rules",
            )
            loader = AgentsInstructionLoader()
            files = loader.find_instruction_files(tmpdir)
            assert len(files) == 1
            assert files[0].source == InstructionSource.PROJECT_TRAE

    def test_finds_claude_md(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(
                os.path.join(tmpdir, "CLAUDE.md"),
                "# Claude rules",
            )
            loader = AgentsInstructionLoader()
            files = loader.find_instruction_files(tmpdir)
            assert len(files) == 1
            assert files[0].source == InstructionSource.PROJECT_CLAUDE

    def test_finds_multiple_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(
                os.path.join(tmpdir, ".trae", "AGENTS.md"),
                "# Trae",
            )
            write_agents_md(
                os.path.join(tmpdir, "AGENTS.md"),
                "# Root",
            )
            loader = AgentsInstructionLoader()
            files = loader.find_instruction_files(tmpdir)
            assert len(files) == 2
            # 优先级：.trae/AGENTS.md > AGENTS.md
            assert files[0].source == InstructionSource.PROJECT_TRAE
            assert files[1].source == InstructionSource.PROJECT_ROOT

    def test_priority_order(self):
        """优先级：project_trae > project_root > project_claude"""
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "CLAUDE.md"), "C")
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "R")
            write_agents_md(os.path.join(tmpdir, ".trae", "AGENTS.md"), "T")

            loader = AgentsInstructionLoader()
            files = loader.find_instruction_files(tmpdir)
            sources = [f.source for f in files]
            assert sources == [
                InstructionSource.PROJECT_TRAE,
                InstructionSource.PROJECT_ROOT,
                InstructionSource.PROJECT_CLAUDE,
            ]


# ============================================================
# 加载与缓存测试
# ============================================================


class TestLoadAndCache:
    """加载与缓存测试"""

    def test_load_empty_project(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            loader = AgentsInstructionLoader()
            inst_set = loader.load(tmpdir)
            assert inst_set.project_path == tmpdir
            assert inst_set.files == []
            assert inst_set.combined_content == ""
            assert inst_set.combined_hash != ""

    def test_load_with_files(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "rule1")
            loader = AgentsInstructionLoader()
            inst_set = loader.load(tmpdir)
            assert len(inst_set.files) == 1
            assert "rule1" in inst_set.combined_content
            assert "AGENTS.md" in inst_set.combined_content  # 含源信息

    def test_load_uses_cache(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "rule1")
            loader = AgentsInstructionLoader()
            inst_set1 = loader.load(tmpdir)
            inst_set2 = loader.load(tmpdir)
            assert inst_set1 is inst_set2  # 同一对象

    def test_force_reload(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "v1")
            loader = AgentsInstructionLoader()
            inst_set1 = loader.load(tmpdir)
            # 修改文件
            with open(os.path.join(tmpdir, "AGENTS.md"), "w") as f:
                f.write("v2")
            inst_set2 = loader.reload(tmpdir)
            assert "v2" in inst_set2.combined_content
            assert inst_set2.combined_hash != inst_set1.combined_hash

    def test_auto_detect_file_change(self):
        """文件修改后自动重新加载"""
        import time as time_module
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "v1")
            loader = AgentsInstructionLoader()
            inst_set1 = loader.load(tmpdir)
            # 修改文件（确保 mtime 改变）
            time_module.sleep(0.1)
            with open(os.path.join(tmpdir, "AGENTS.md"), "w") as f:
                f.write("v2")
            inst_set2 = loader.load(tmpdir)
            assert "v2" in inst_set2.combined_content

    def test_invalidate(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "x")
            loader = AgentsInstructionLoader()
            loader.load(tmpdir)
            assert loader.get_cached(tmpdir) is not None
            removed = loader.invalidate(tmpdir)
            assert removed is True
            assert loader.get_cached(tmpdir) is None
            # 重复 invalidate
            assert loader.invalidate(tmpdir) is False


# ============================================================
# System Prompt 构建测试
# ============================================================


class TestSystemPrompt:
    """System Prompt 构建测试"""

    def test_empty_project_returns_base(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            loader = AgentsInstructionLoader()
            prompt = loader.build_system_prompt(
                tmpdir, base_prompt="You are an assistant.",
            )
            assert prompt == "You are an assistant."

    def test_no_base_prompt(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "rule1")
            loader = AgentsInstructionLoader()
            prompt = loader.build_system_prompt(tmpdir)
            assert "rule1" in prompt
            assert "项目级指令" in prompt  # 含中文标题

    def test_combined_prompt(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "rule1")
            loader = AgentsInstructionLoader()
            prompt = loader.build_system_prompt(
                tmpdir, base_prompt="Base.",
            )
            assert "Base." in prompt
            assert "rule1" in prompt
            # base 在前，指令在后
            assert prompt.index("Base.") < prompt.index("rule1")


# ============================================================
# 全局单例测试
# ============================================================


class TestGlobalSingleton:
    """全局单例测试"""

    def test_singleton(self):
        reset_loader()
        l1 = get_loader()
        l2 = get_loader()
        assert l1 is l2
        reset_loader()
        l3 = get_loader()
        assert l3 is not l1

    def test_stats(self):
        reset_loader()
        loader = get_loader()
        stats = loader.get_stats()
        assert "cached_projects" in stats
        assert "total_files" in stats


# ============================================================
# 边界条件测试
# ============================================================


class TestEdgeCases:
    """边界条件测试"""

    def test_unicode_content(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(
                os.path.join(tmpdir, "AGENTS.md"),
                "中文规则说明\n🎯 emoji 测试",
            )
            loader = AgentsInstructionLoader()
            inst_set = loader.load(tmpdir)
            assert "中文" in inst_set.combined_content
            assert "🎯" in inst_set.combined_content

    def test_large_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            large_content = "\n".join([f"line {i}" for i in range(1000)])
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), large_content)
            loader = AgentsInstructionLoader()
            inst_set = loader.load(tmpdir)
            assert "line 999" in inst_set.combined_content

    def test_empty_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            write_agents_md(os.path.join(tmpdir, "AGENTS.md"), "")
            loader = AgentsInstructionLoader()
            inst_set = loader.load(tmpdir)
            assert len(inst_set.files) == 1
            assert inst_set.files[0].file_size == 0

    def test_hash_uniqueness(self):
        loader = AgentsInstructionLoader()
        h1 = loader._compute_hash("content1")
        h2 = loader._compute_hash("content2")
        h3 = loader._compute_hash("content1")
        assert h1 != h2
        assert h1 == h3
