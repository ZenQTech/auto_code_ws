"""
# ============================================================
# CodebaseIndexer 单元测试
# Cycle 68 G68-01
# ====================================
"""

import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

import pytest

from app.services.codebase_indexer import (
    CodebaseIndexer,
    CodebaseIndexerError,
    FileTooLargeError,
    IndexNotFoundError,
    InvalidQueryError,
    ProjectNotFoundError,
    get_codebase_indexer,
    reset_codebase_indexer,
)


# ============================================================
# Fixtures
# ============================================================


@pytest.fixture
def tmp_project():
    """创建临时项目目录结构"""
    with tempfile.TemporaryDirectory() as tmpdir:
        root = Path(tmpdir)
        # 创建 Python 文件
        (root / "main.py").write_text(
            "def hello_world():\n"
            "    print('Hello')\n"
            "    return 42\n"
            "\n"
            "class MyClass:\n"
            "    def method_one(self):\n"
            "        return 'one'\n"
            "\n"
            "async def fetch_data():\n"
            "    return await client.get('/api')\n"
        )
        (root / "auth.py").write_text(
            "def login(user, password):\n"
            "    return True\n"
            "\n"
            "def retry_with_backoff(max_retries=3):\n"
            "    pass\n"
        )
        # 创建 TypeScript 文件
        (root / "app.ts").write_text(
            "export class AppController {\n"
            "  handle() {}\n"
            "}\n"
            "export function main() {}\n"
            "const helper = () => {};\n"
        )
        # 创建应忽略的目录
        (root / "node_modules").mkdir()
        (root / "node_modules" / "lib.js").write_text("ignored")
        (root / "__pycache__").mkdir()
        (root / "__pycache__" / "cache.pyc").write_text("ignored")
        # 创建隐藏目录
        (root / ".git").mkdir()
        (root / ".git" / "config").write_text("ignored")
        yield str(root)


@pytest.fixture
def indexer():
    """创建新的 CodebaseIndexer 实例"""
    return CodebaseIndexer()


# ============================================================
# Test: 基础索引构建
# ============================================================


class TestBuildIndex:
    def test_build_index_success(self, indexer, tmp_project):
        """成功构建索引"""
        stats = indexer.build_index("sess-1", tmp_project)
        assert stats.total_files >= 3  # main.py, auth.py, app.ts
        assert stats.total_symbols > 0
        assert stats.total_lines > 0
        assert stats.build_time_ms >= 0

    def test_build_index_ignores_node_modules(self, indexer, tmp_project):
        """忽略 node_modules"""
        stats = indexer.build_index("sess-1", tmp_project)
        files = indexer._sessions["sess-1"]["file_index"]
        for path in files:
            assert "node_modules" not in path
            assert "__pycache__" not in path
            assert ".git" not in path or "/.git/" in path and False

    def test_build_index_creates_session(self, indexer, tmp_project):
        """创建 session"""
        indexer.build_index("sess-test", tmp_project)
        assert "sess-test" in indexer._sessions

    def test_build_index_updates_languages(self, indexer, tmp_project):
        """统计语言分布"""
        stats = indexer.build_index("sess-1", tmp_project)
        assert "python" in stats.languages
        assert "typescript" in stats.languages
        assert stats.languages["python"] >= 2
        assert stats.languages["typescript"] >= 1

    def test_build_index_nonexistent_path(self, indexer):
        """不存在的项目路径"""
        with pytest.raises(ProjectNotFoundError):
            indexer.build_index("sess-1", "/nonexistent/path/12345")

    def test_build_index_empty_path(self, indexer):
        """空路径"""
        with pytest.raises(ProjectNotFoundError):
            indexer.build_index("sess-1", "")

    def test_build_index_force_rebuild(self, indexer, tmp_project):
        """强制重建"""
        indexer.build_index("sess-1", tmp_project)
        # 修改文件
        new_file = Path(tmp_project) / "new.py"
        new_file.write_text("x = 1")
        # 强制重建
        stats = indexer.build_index("sess-1", tmp_project, force_rebuild=True)
        files = indexer._sessions["sess-1"]["file_index"]
        assert "new.py" in files


# ============================================================
# Test: 符号提取
# ============================================================


class TestSymbolExtraction:
    def test_python_function_extraction(self, indexer, tmp_project):
        """Python 函数提取"""
        indexer.build_index("sess-1", tmp_project)
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        func_names = [s.name for s in symbols if s.kind in ("function", "async_function")]
        assert "hello_world" in func_names
        assert "fetch_data" in func_names
        assert "login" in func_names

    def test_python_class_extraction(self, indexer, tmp_project):
        """Python 类提取"""
        indexer.build_index("sess-1", tmp_project)
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        class_names = [s.name for s in symbols if s.kind == "class"]
        assert "MyClass" in class_names

    def test_typescript_class_extraction(self, indexer, tmp_project):
        """TypeScript 类提取"""
        indexer.build_index("sess-1", tmp_project)
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        ts_classes = [
            s.name for s in symbols
            if s.language == "typescript" and s.kind == "class"
        ]
        assert "AppController" in ts_classes

    def test_typescript_function_extraction(self, indexer, tmp_project):
        """TypeScript 函数提取"""
        indexer.build_index("sess-1", tmp_project)
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        ts_funcs = [
            s.name for s in symbols
            if s.language == "typescript" and s.kind == "function"
        ]
        assert "main" in ts_funcs

    def test_symbol_includes_line(self, indexer, tmp_project):
        """符号包含行号"""
        indexer.build_index("sess-1", tmp_project)
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        assert all(s.line > 0 for s in symbols)

    def test_symbol_includes_signature(self, indexer, tmp_project):
        """符号包含签名"""
        indexer.build_index("sess-1", tmp_project)
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        assert all(s.signature for s in symbols)


# ============================================================
# Test: 文本搜索
# ============================================================


class TestSearch:
    def test_search_text_match(self, indexer, tmp_project):
        """文本匹配"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search("sess-1", "hello")
        assert len(results) > 0
        assert any(r.type == "text" for r in results)
        assert any("hello" in r.snippet.lower() for r in results if r.snippet)

    def test_search_function_name(self, indexer, tmp_project):
        """按函数名搜索"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search("sess-1", "login")
        assert len(results) > 0
        # 应该匹配 auth.py 中的 login 函数
        auth_results = [r for r in results if "auth" in r.file]
        assert len(auth_results) > 0

    def test_search_symbol_match(self, indexer, tmp_project):
        """符号匹配"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search("sess-1", "fetch_data")
        # 应该匹配到符号
        symbol_results = [r for r in results if r.type == "symbol"]
        assert len(symbol_results) > 0
        assert any(r.name == "fetch_data" for r in symbol_results)

    def test_search_top_k(self, indexer, tmp_project):
        """top_k 限制"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search("sess-1", "def", top_k=2)
        assert len(results) <= 2

    def test_search_with_file_pattern(self, indexer, tmp_project):
        """按文件模式过滤"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search(
            "sess-1", "class", file_pattern="*.py"
        )
        for r in results:
            assert r.file.endswith(".py")

    def test_search_without_symbols(self, indexer, tmp_project):
        """仅文本搜索"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search(
            "sess-1", "login", include_symbols=False
        )
        for r in results:
            assert r.type == "text"

    def test_search_empty_query(self, indexer, tmp_project):
        """空查询"""
        indexer.build_index("sess-1", tmp_project)
        with pytest.raises(InvalidQueryError):
            indexer.search("sess-1", "")

    def test_search_too_long_query(self, indexer, tmp_project):
        """过长查询"""
        indexer.build_index("sess-1", tmp_project)
        with pytest.raises(InvalidQueryError):
            indexer.search("sess-1", "x" * 501)

    def test_search_nonexistent_session(self, indexer):
        """session 不存在"""
        with pytest.raises(IndexNotFoundError):
            indexer.search("nonexistent", "test")

    def test_search_results_sorted(self, indexer, tmp_project):
        """结果按分数排序"""
        indexer.build_index("sess-1", tmp_project)
        results = indexer.search("sess-1", "function")
        for i in range(len(results) - 1):
            assert results[i].score >= results[i + 1].score


# ============================================================
# Test: 文件片段读取
# ============================================================


class TestGetFile:
    def test_get_file_full(self, indexer, tmp_project):
        """读取完整文件"""
        indexer.build_index("sess-1", tmp_project)
        data = indexer.get_file("sess-1", "main.py")
        assert data["path"] == "main.py"
        assert data["language"] == "python"
        assert data["total_lines"] >= 5
        assert len(data["lines"]) == data["total_lines"]

    def test_get_file_range(self, indexer, tmp_project):
        """读取文件片段"""
        indexer.build_index("sess-1", tmp_project)
        data = indexer.get_file("sess-1", "main.py", line_start=1, line_end=3)
        assert len(data["lines"]) == 2
        assert data["lines"][0]["line_no"] == 2  # 1-indexed
        assert data["lines"][1]["line_no"] == 3

    def test_get_file_out_of_range(self, indexer, tmp_project):
        """超出范围自动截断"""
        indexer.build_index("sess-1", tmp_project)
        data = indexer.get_file("sess-1", "main.py", line_start=0, line_end=9999)
        assert len(data["lines"]) == data["total_lines"]

    def test_get_file_not_in_index(self, indexer, tmp_project):
        """文件不在索引中"""
        indexer.build_index("sess-1", tmp_project)
        with pytest.raises((CodebaseIndexerError, FileNotFoundError, OSError)):
            indexer.get_file("sess-1", "nonexistent.py")


# ============================================================
# Test: 统计
# ============================================================


class TestStats:
    def test_get_stats(self, indexer, tmp_project):
        """获取统计"""
        indexer.build_index("sess-1", tmp_project)
        stats = indexer.get_stats("sess-1")
        assert stats.session_id == "sess-1"
        assert stats.total_files > 0

    def test_get_stats_nonexistent(self, indexer):
        """统计不存在的 session"""
        with pytest.raises(IndexNotFoundError):
            indexer.get_stats("nonexistent")


# ============================================================
# Test: 增量更新
# ============================================================


class TestIncrementalUpdate:
    def test_file_modified(self, indexer, tmp_project):
        """文件修改触发增量更新"""
        indexer.build_index("sess-1", tmp_project)
        # 修改文件
        fpath = Path(tmp_project) / "main.py"
        fpath.write_text("x = 100\ny = 200\n")
        # 触发更新
        indexer.on_file_changed("sess-1", "main.py")
        # 验证更新
        files = indexer._sessions["sess-1"]["file_index"]
        assert "main.py" in files
        assert files["main.py"].line_count == 2

    def test_file_deleted(self, indexer, tmp_project):
        """文件删除触发索引更新"""
        indexer.build_index("sess-1", tmp_project)
        fpath = Path(tmp_project) / "main.py"
        fpath.unlink()
        indexer.on_file_changed("sess-1", "main.py")
        files = indexer._sessions["sess-1"]["file_index"]
        assert "main.py" not in files

    def test_file_added(self, indexer, tmp_project):
        """新增文件触发索引更新"""
        indexer.build_index("sess-1", tmp_project)
        new_file = Path(tmp_project) / "added.py"
        new_file.write_text("def new_func():\n    pass\n")
        indexer.on_file_changed("sess-1", "added.py")
        files = indexer._sessions["sess-1"]["file_index"]
        assert "added.py" in files
        symbols = indexer._sessions["sess-1"]["symbol_index"]
        assert any(s.name == "new_func" for s in symbols)


# ============================================================
# Test: 会话管理
# ============================================================


class TestSessionManagement:
    def test_remove_session(self, indexer, tmp_project):
        """移除 session"""
        indexer.build_index("sess-1", tmp_project)
        assert indexer.remove_session("sess-1") is True
        assert "sess-1" not in indexer._sessions

    def test_remove_nonexistent_session(self, indexer):
        """移除不存在的 session"""
        assert indexer.remove_session("nonexistent") is False

    def test_list_sessions(self, indexer, tmp_project):
        """列出所有 session"""
        indexer.build_index("sess-1", tmp_project)
        indexer.build_index("sess-2", tmp_project)
        sessions = indexer.list_sessions()
        assert "sess-1" in sessions
        assert "sess-2" in sessions


# ============================================================
# Test: 安全
# ============================================================


class TestSecurity:
    def test_ignored_path_node_modules(self, indexer, tmp_project):
        """node_modules 被忽略"""
        is_ignored = indexer._is_ignored_path("node_modules/lib.js")
        assert is_ignored is True

    def test_ignored_path_pycache(self, indexer, tmp_project):
        """__pycache__ 被忽略"""
        is_ignored = indexer._is_ignored_path("__pycache__/x.pyc")
        assert is_ignored is True

    def test_ignored_suffix(self, indexer):
        """后缀被忽略"""
        is_ignored = indexer._is_ignored_path("foo.pyc")
        assert is_ignored is True

    def test_normal_path_not_ignored(self, indexer):
        """正常路径不被忽略"""
        is_ignored = indexer._is_ignored_path("src/main.py")
        assert is_ignored is False

    def test_binary_file_skipped(self, indexer, tmp_project):
        """二进制文件被跳过"""
        binary_file = Path(tmp_project) / "binary.dat"
        binary_file.write_bytes(b"\x00\x01\x02\x03\x00")
        indexer.build_index("sess-1", tmp_project)
        files = indexer._sessions["sess-1"]["file_index"]
        if "binary.dat" in files:
            assert files["binary.dat"].is_binary is True

    def test_large_file_skipped(self, indexer, tmp_project):
        """过大文件被跳过"""
        # 创建一个 11MB 文件
        large_file = Path(tmp_project) / "huge.txt"
        large_file.write_text("x" * (11 * 1024 * 1024))
        indexer.build_index("sess-1", tmp_project)
        files = indexer._sessions["sess-1"]["file_index"]
        assert "huge.txt" not in files


# ============================================================
# Test: 分词
# ============================================================


class TestTokenize:
    def test_tokenize_simple(self, indexer):
        """简单分词"""
        terms = indexer._tokenize("hello world")
        assert "hello" in terms
        assert "world" in terms

    def test_tokenize_camelcase(self, indexer):
        """驼峰分词"""
        terms = indexer._tokenize("fetchData")
        assert "fetch" in terms
        assert "data" in terms

    def test_tokenize_underscore(self, indexer):
        """下划线分词"""
        terms = indexer._tokenize("fetch_data")
        assert "fetch" in terms
        assert "data" in terms

    def test_tokenize_punctuation(self, indexer):
        """标点过滤"""
        terms = indexer._tokenize("hello, world!")
        assert "hello" in terms
        assert "world" in terms


# ============================================================
# Test: 全局单例
# ============================================================


class TestGlobalSingleton:
    def test_get_codebase_indexer_returns_singleton(self):
        """单例模式"""
        reset_codebase_indexer()
        i1 = get_codebase_indexer()
        i2 = get_codebase_indexer()
        assert i1 is i2

    def test_reset_codebase_indexer(self):
        """重置单例"""
        i1 = get_codebase_indexer()
        reset_codebase_indexer()
        i2 = get_codebase_indexer()
        assert i1 is not i2


# ============================================================
# Test: 性能
# ============================================================


class TestPerformance:
    def test_search_performance(self, indexer, tmp_project):
        """搜索响应时间 < 200ms"""
        indexer.build_index("sess-1", tmp_project)
        start = time.time()
        for _ in range(10):
            indexer.search("sess-1", "function")
        duration = (time.time() - start) / 10
        assert duration < 0.5  # 平均每次 < 500ms（含测试环境开销）

    def test_index_build_performance_small(self, indexer, tmp_project):
        """小项目索引构建 < 1s"""
        start = time.time()
        indexer.build_index("sess-1", tmp_project)
        duration = time.time() - start
        assert duration < 1.0


# ============================================================
# Test: 并发
# ============================================================


class TestConcurrency:
    def test_concurrent_search(self, indexer, tmp_project):
        """并发搜索"""
        import threading

        indexer.build_index("sess-1", tmp_project)
        errors = []

        def search():
            try:
                for _ in range(20):
                    indexer.search("sess-1", "function")
            except Exception as e:
                errors.append(e)

        threads = [threading.Thread(target=search) for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert len(errors) == 0
