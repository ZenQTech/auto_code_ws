"""
# ============================================================
# 代码记忆库（Code Reuse Knowledge Base）服务模块（V4.1 新增）
# ============================================================
# 核心作用：实现代码复用知识库系统，提供语义检索、代码泛化、
#           可复用性评估、存储管理、入库管理等功能
# 运行流程：
#   1. 初始化时加载配置，建立 SQLite 元数据库和文件存储
#   2. 尝试加载 sentence-transformers 嵌入模型，失败则降级为 TF-IDF 关键词匹配
#   3. 检索时对查询文本生成嵌入向量，与库中代码片段计算余弦相似度
#   4. 入库时对代码进行泛化处理、可复用性评估，然后存储
#   5. 支持 CRUD 操作和统计信息查询
# 输入参数：
#   - db_path: SQLite 数据库路径（可选，默认从配置读取）
#   - model_path: 嵌入模型路径（可选，默认从配置读取）
# 输出结果：MemoryStore 单例对象，提供完整的代码记忆库服务
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现语义检索、代码泛化、
#     可复用性评估、存储管理、入库管理全功能
# ============================================================
"""

import os
import re
import json
import uuid
import sqlite3
import logging
import threading
import math
from pathlib import Path
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from collections import Counter

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 嵌入模型加载（尝试加载 sentence-transformers，失败则降级）
# ============================================================

def _try_load_embedding_model(model_name: str = None):
    """
    尝试加载 sentence-transformers 嵌入模型
    参数：
      model_name: 模型名称，默认从配置读取
    返回值：(model_instance, model_name_str) 或 (None, None)
    运行步骤：
      1. 从配置获取模型名称
      2. 尝试导入 sentence_transformers
      3. 尝试加载模型
      4. 失败则返回 None
    """
    if model_name is None:
        mem_config = settings.memory_store
        model_name = mem_config.get("embedding_model", "bge-small-zh-v1.5")

    try:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(model_name)
        # 获取嵌入向量维度
        dim = model.get_sentence_embedding_dimension()
        logger.info("成功加载嵌入模型: %s | 向量维度=%d", model_name, dim)
        return model, model_name
    except ImportError:
        logger.warning(
            "sentence-transformers 未安装，将使用 TF-IDF 关键词匹配作为降级方案"
        )
        return None, None
    except Exception as e:
        logger.warning(
            "加载嵌入模型失败: %s | 将使用 TF-IDF 关键词匹配作为降级方案", e
        )
        return None, None


# ============================================================
# TF-IDF 关键词匹配器（嵌入模型不可用时的降级方案）
# ============================================================

class TFIDFMatcher:
    """
    TF-IDF 关键词匹配器
    作用：在嵌入模型不可用时，提供基于 TF-IDF 的代码相似度匹配
    调用方：MemoryStore.search()
    被调用方：无
    """

    def __init__(self):
        """初始化 TF-IDF 匹配器"""
        # 文档频率缓存：term -> 出现该词的文档数
        self._df: Dict[str, int] = Counter()
        # 总文档数
        self._doc_count: int = 0

    def _tokenize(self, text: str) -> List[str]:
        """
        对文本进行分词
        参数：
          text: 输入文本
        返回值：分词后的 token 列表
        运行步骤：
          1. 转小写
          2. 按非字母数字字符分割
          3. 过滤长度 < 2 的 token
          4. 过滤常见停用词
        """
        # 中文和英文混合分词：按非字母数字 + 中文字符边界分割
        tokens = re.findall(r'[a-zA-Z_]\w*|[\u4e00-\u9fff]+', text.lower())
        # 过滤停用词和短 token
        stop_words = {
            'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
            'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will',
            'would', 'could', 'should', 'may', 'might', 'can', 'shall',
            'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
            'as', 'into', 'through', 'during', 'before', 'after', 'and',
            'but', 'or', 'not', 'no', 'if', 'then', 'else', 'when',
            'this', 'that', 'these', 'those', 'it', 'its', 'we', 'you',
            'he', 'she', 'they', 'them', 'their', 'our', 'my', 'your',
            'his', 'her', 'all', 'each', 'every', 'both', 'few', 'more',
            'most', 'other', 'some', 'such', 'only', 'own', 'same', 'so',
            'than', 'too', 'very', 'just', 'about', 'up', 'out', 'also',
            'def', 'class', 'return', 'import', 'self', 'pass', 'none',
            'true', 'false', 'print', 'len', 'range', 'str', 'int',
        }
        return [t for t in tokens if len(t) >= 2 and t not in stop_words]

    def _compute_tf(self, tokens: List[str]) -> Dict[str, float]:
        """
        计算词频（TF）
        参数：
          tokens: 分词后的 token 列表
        返回值：{token: tf_score} 字典
        """
        total = len(tokens)
        if total == 0:
            return {}
        counter = Counter(tokens)
        return {term: count / total for term, count in counter.items()}

    def add_document(self, text: str):
        """
        向语料库添加文档（用于更新 IDF）
        参数：
          text: 文档文本
        """
        tokens = set(self._tokenize(text))
        for term in tokens:
            self._df[term] += 1
        self._doc_count += 1

    def compute_similarity(self, query: str, doc: str) -> float:
        """
        计算查询与文档的 TF-IDF 余弦相似度
        参数：
          query: 查询文本
          doc: 文档文本
        返回值：相似度分数 (0.0-1.0)
        运行步骤：
          1. 对查询和文档分别分词
          2. 计算 TF-IDF 向量
          3. 计算余弦相似度
        """
        query_tokens = self._tokenize(query)
        doc_tokens = self._tokenize(doc)

        if not query_tokens or not doc_tokens:
            return 0.0

        # 计算 TF
        query_tf = self._compute_tf(query_tokens)
        doc_tf = self._compute_tf(doc_tokens)

        # 计算 IDF（使用平滑 IDF 公式，避免小语料库时 IDF 为 0）
        def _idf(term: str) -> float:
            df = self._df.get(term, 0)
            # 平滑 IDF：idf = log((N + 1) / (df + 1)) + 1
            # 加 1 确保即使 df == N 时 IDF 也不为 0
            return math.log((self._doc_count + 1) / (df + 1)) + 1.0

        # 构建 TF-IDF 向量并计算余弦相似度
        all_terms = set(query_tf.keys()) | set(doc_tf.keys())

        dot_product = 0.0
        query_norm = 0.0
        doc_norm = 0.0

        for term in all_terms:
            q_tfidf = query_tf.get(term, 0.0) * _idf(term)
            d_tfidf = doc_tf.get(term, 0.0) * _idf(term)
            dot_product += q_tfidf * d_tfidf
            query_norm += q_tfidf ** 2
            doc_norm += d_tfidf ** 2

        query_norm = math.sqrt(query_norm)
        doc_norm = math.sqrt(doc_norm)

        if query_norm == 0.0 or doc_norm == 0.0:
            return 0.0

        return dot_product / (query_norm * doc_norm)


# ============================================================
# MemoryStore 主类
# ============================================================

class MemoryStore:
    """
    代码记忆库（Code Reuse Knowledge Base）
    作用：管理代码片段的存储、检索、泛化、可复用性评估
    调用方：API 路由层、任务执行引擎
    被调用方：SQLite 数据库、嵌入模型/TF-IDF 匹配器
    """

    _instance = None

    def __new__(cls, db_path: str = None, model_path: str = None):
        """单例模式：确保全局只有一个记忆库实例"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, db_path: str = None, model_path: str = None):
        """
        初始化记忆库
        参数：
          db_path: SQLite 数据库路径（可选，默认从配置读取）
          model_path: 嵌入模型路径（可选，默认从配置读取）
        运行步骤：
          1. 加载配置
          2. 初始化 SQLite 元数据库
          3. 初始化文件存储目录
          4. 加载嵌入模型或降级为 TF-IDF
          5. 构建 TF-IDF 语料库索引
        """
        if self._initialized:
            return

        mem_config = settings.memory_store

        # 数据库路径
        if db_path is None:
            project_root = settings.get_project_root()
            data_dir = project_root / settings.storage.get("data_dir", "data")
            data_dir.mkdir(parents=True, exist_ok=True)
            db_path = str(data_dir / "memory_store.db")
        self._db_path = db_path

        # 文件存储目录
        project_root = settings.get_project_root()
        self._store_dir = project_root / settings.storage.get("data_dir", "data") / "memory_snippets"
        self._store_dir.mkdir(parents=True, exist_ok=True)

        # 相似度阈值（嵌入模式用配置值，TF-IDF 降级模式用更低的阈值）
        self._similarity_threshold: float = mem_config.get("similarity_threshold", 0.75)

        # 最大检索结果数
        self._max_search_results: int = mem_config.get("max_search_results", 10)

        # 初始化 SQLite 元数据库
        self._init_db()

        # 加载嵌入模型
        model_name = mem_config.get("embedding_model", "bge-small-zh-v1.5")
        self._embedding_model, self._model_name = _try_load_embedding_model(model_name)
        self._use_embedding = self._embedding_model is not None

        # TF-IDF 降级匹配器
        self._tfidf_matcher = TFIDFMatcher()

        # 如果使用 TF-IDF 降级模式，降低相似度阈值（TF-IDF 分数天然低于嵌入向量）
        if not self._use_embedding:
            self._similarity_threshold = min(self._similarity_threshold, 0.1)
            self._build_tfidf_index()

        # 线程安全锁
        self._lock = threading.Lock()

        self._initialized = True
        logger.info(
            "记忆库初始化完成 | 数据库=%s | 嵌入模型=%s | 相似度阈值=%.2f",
            self._db_path,
            self._model_name if self._use_embedding else "TF-IDF(降级)",
            self._similarity_threshold,
        )

    # ============================================================
    # 数据库初始化
    # ============================================================

    def _init_db(self):
        """
        初始化 SQLite 元数据库
        运行步骤：
          1. 创建数据库连接
          2. 创建 code_snippets 表（如果不存在）
          3. 创建必要的索引
        """
        conn = sqlite3.connect(self._db_path)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS code_snippets (
                id TEXT PRIMARY KEY,
                language TEXT NOT NULL DEFAULT '',
                tags TEXT NOT NULL DEFAULT '[]',
                description TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT '',
                version TEXT NOT NULL DEFAULT '1.0.0',
                file_path TEXT NOT NULL DEFAULT '',
                original_code TEXT NOT NULL DEFAULT '',
                generalized_code TEXT NOT NULL DEFAULT '',
                reusability_score REAL NOT NULL DEFAULT 0.0,
                usage_count INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            )
        """)
        # 创建索引：按语言、标签、可复用性分数、使用次数
        conn.execute("CREATE INDEX IF NOT EXISTS idx_language ON code_snippets(language)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_reusability ON code_snippets(reusability_score)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_usage ON code_snippets(usage_count)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_created ON code_snippets(created_at)")
        conn.commit()
        conn.close()

    def _build_tfidf_index(self):
        """
        构建 TF-IDF 语料库索引
        运行步骤：
          1. 读取所有已存储的代码片段
          2. 将每个片段的泛化代码添加到 TF-IDF 匹配器
        """
        conn = sqlite3.connect(self._db_path)
        rows = conn.execute(
            "SELECT id, generalized_code, original_code FROM code_snippets"
        ).fetchall()
        conn.close()

        for row in rows:
            code = row[1] if row[1] else row[2]
            if code:
                self._tfidf_matcher.add_document(code)

        logger.info("TF-IDF 语料库索引已构建 | 文档数=%d", len(rows))

    # ============================================================
    # 嵌入向量计算
    # ============================================================

    def _encode(self, text: str) -> Optional[List[float]]:
        """
        使用嵌入模型将文本编码为向量
        参数：
          text: 输入文本
        返回值：嵌入向量列表，或 None（降级模式）
        """
        if not self._use_embedding or self._embedding_model is None:
            return None
        try:
            # sentence-transformers 的 encode 方法
            embedding = self._embedding_model.encode(text, normalize_embeddings=True)
            return embedding.tolist()
        except Exception as e:
            logger.error("文本编码失败: %s", e)
            return None

    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """
        计算两个向量的余弦相似度
        参数：
          vec1: 向量 1
          vec2: 向量 2
        返回值：余弦相似度 (0.0-1.0)
        """
        if len(vec1) != len(vec2):
            return 0.0
        dot = sum(a * b for a, b in zip(vec1, vec2))
        norm1 = math.sqrt(sum(a * a for a in vec1))
        norm2 = math.sqrt(sum(b * b for b in vec2))
        if norm1 == 0.0 or norm2 == 0.0:
            return 0.0
        return dot / (norm1 * norm2)

    # ============================================================
    # 语义检索
    # ============================================================

    def search(
        self,
        query: str,
        language: str = None,
        top_k: int = None,
    ) -> List[Dict[str, Any]]:
        """
        语义搜索代码片段
        参数：
          query: 搜索查询文本（自然语言描述或代码片段）
          language: 可选，按编程语言过滤
          top_k: 返回结果数量（默认从配置读取）
        返回值：匹配的代码片段列表，每项包含：
          {
            "id": str,              # 片段 ID
            "language": str,        # 编程语言
            "tags": List[str],      # 标签列表
            "description": str,     # 描述
            "source": str,          # 来源
            "version": str,         # 版本
            "code": str,            # 泛化后的代码
            "original_code": str,   # 原始代码
            "reusability_score": float,  # 可复用性评分
            "similarity_score": float,   # 相似度评分
            "usage_count": int,     # 使用次数
            "created_at": str,      # 创建时间
          }
        运行步骤：
          1. 从数据库读取所有符合条件的代码片段
          2. 对查询文本生成嵌入向量
          3. 计算每个片段的相似度
          4. 按相似度排序，返回 top_k 结果
        """
        if top_k is None:
            top_k = self._max_search_results

        # 从数据库读取代码片段
        conn = sqlite3.connect(self._db_path)
        if language:
            rows = conn.execute(
                "SELECT id, language, tags, description, source, version, "
                "file_path, original_code, generalized_code, reusability_score, "
                "usage_count, created_at, updated_at "
                "FROM code_snippets WHERE language = ? ORDER BY created_at DESC",
                (language,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, language, tags, description, source, version, "
                "file_path, original_code, generalized_code, reusability_score, "
                "usage_count, created_at, updated_at "
                "FROM code_snippets ORDER BY created_at DESC"
            ).fetchall()
        conn.close()

        if not rows:
            return []

        # 计算相似度
        results = []
        query_embedding = self._encode(query)

        for row in rows:
            snippet_id = row[0]
            lang = row[1]
            tags_str = row[2]
            description = row[3]
            source = row[4]
            version = row[5]
            file_path = row[6]
            original_code = row[7]
            generalized_code = row[8]
            reusability_score = row[9]
            usage_count = row[10]
            created_at = row[11]

            # 用于相似度计算的代码文本
            code_for_match = generalized_code if generalized_code else original_code

            if query_embedding is not None:
                # 使用嵌入向量计算相似度
                code_embedding = self._encode(code_for_match)
                if code_embedding is not None:
                    similarity = self._cosine_similarity(query_embedding, code_embedding)
                else:
                    similarity = 0.0
            else:
                # 降级为 TF-IDF 相似度
                similarity = self._tfidf_matcher.compute_similarity(query, code_for_match)

            # 低于阈值的过滤掉
            if similarity < self._similarity_threshold:
                continue

            # 解析标签
            try:
                tags = json.loads(tags_str) if tags_str else []
            except json.JSONDecodeError:
                tags = []

            results.append({
                "id": snippet_id,
                "language": lang,
                "tags": tags,
                "description": description,
                "source": source,
                "version": version,
                "file_path": file_path,
                "code": generalized_code if generalized_code else original_code,
                "original_code": original_code,
                "reusability_score": reusability_score,
                "similarity_score": round(similarity, 4),
                "usage_count": usage_count,
                "created_at": created_at,
            })

        # 按相似度降序排序
        results.sort(key=lambda x: x["similarity_score"], reverse=True)

        # 返回 top_k 结果
        return results[:top_k]

    # ============================================================
    # 代码泛化处理
    # ============================================================

    def generalize(self, code: str, language: str = "") -> str:
        """
        对代码进行泛化处理，移除项目专属内容
        参数：
          code: 原始代码
          language: 编程语言
        返回值：泛化后的代码
        运行步骤：
          1. 移除项目专属硬编码值（路径、URL、密钥等）
          2. 移除定制化参数和业务逻辑
          3. 提取可配置参数并用占位符替换
          4. 保留可复用的通用代码结构
        """
        if not code:
            return ""

        generalized = code

        # 步骤 1：移除硬编码的文件路径（保留相对路径模式）
        # 匹配绝对路径如 /home/user/project/src/file.py
        generalized = re.sub(
            r'(?<=["\'\s])/[a-zA-Z0-9_/.-]+/[a-zA-Z0-9_/.-]+\.\w+',
            '<PROJECT_PATH>/<MODULE_PATH>',
            generalized,
        )

        # 步骤 2：移除硬编码的 API 密钥、Token、密码
        generalized = re.sub(
            r'(api_key|API_KEY|token|TOKEN|password|PASSWORD|secret|SECRET)\s*=\s*["\'][^"\']+["\']',
            r'\1 = "<CONFIGURABLE>"',
            generalized,
        )

        # 步骤 3：移除硬编码的 IP 地址和端口
        generalized = re.sub(
            r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+\b',
            '<HOST:PORT>',
            generalized,
        )
        generalized = re.sub(
            r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',
            '<HOST>',
            generalized,
        )

        # 步骤 4：移除硬编码的 URL
        generalized = re.sub(
            r'https?://[^\s"\')\]]+',
            '<URL>',
            generalized,
        )

        # 步骤 5：移除硬编码的数字常量（保留 0, 1, -1 等常见值）
        # 仅替换看起来像配置值的数字（如 timeout=600, max_retries=3）
        generalized = re.sub(
            r'(timeout|max_retries|max_concurrent|interval|threshold|limit)\s*=\s*\d+',
            r'\1 = <CONFIG_VALUE>',
            generalized,
        )

        # 步骤 6：Python 特定：移除项目专属的 import 路径
        if language.lower() in ("python", "py", ""):
            # 替换项目专属的 import 路径为通用占位符
            generalized = re.sub(
                r'(from|import)\s+backend\.app\.\S+',
                r'\1 <PROJECT_MODULE>',
                generalized,
            )

        # 步骤 7：移除 ROS 包特定的命名空间
        generalized = re.sub(
            r'ros::\w+::',
            'ros::<PACKAGE>::',
            generalized,
        )

        return generalized

    # ============================================================
    # 可复用性评估
    # ============================================================

    def evaluate_reusability(self, code: str, language: str = "") -> float:
        """
        评估代码的可复用性
        参数：
          code: 代码文本
          language: 编程语言
        返回值：可复用性评分 (0.0-1.0)
        运行步骤：
          1. 检查代码长度（太短或太长扣分）
          2. 检查是否包含硬编码值（扣分）
          3. 检查是否有清晰的函数/类结构（加分）
          4. 检查是否有注释（加分）
          5. 检查是否有异常处理（加分）
          6. 检查是否有明确的输入输出（加分）
          7. 综合计算评分
        """
        if not code or len(code.strip()) < 10:
            return 0.0

        score = 0.5  # 基础分

        # 维度 1：代码长度适中（10-5000 字符）
        code_len = len(code)
        if 50 <= code_len <= 5000:
            score += 0.1
        elif code_len > 10000:
            score -= 0.1

        # 维度 2：硬编码值检测（越少越好）
        hardcoded_patterns = [
            r'\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b',  # IP 地址
            r'https?://[^\s"\')\]]+',                      # URL
            r'(api_key|token|password|secret)\s*=\s*["\'][^"\']+["\']',  # 密钥
            r'/home/\w+/',                                   # 绝对路径
        ]
        hardcoded_count = 0
        for pattern in hardcoded_patterns:
            hardcoded_count += len(re.findall(pattern, code, re.IGNORECASE))
        if hardcoded_count == 0:
            score += 0.1
        elif hardcoded_count <= 2:
            score += 0.05
        else:
            score -= 0.1 * min(hardcoded_count, 5)

        # 维度 3：函数/类结构检测
        if language.lower() in ("python", "py", ""):
            has_class = bool(re.search(r'^\s*class\s+\w+', code, re.MULTILINE))
            has_function = bool(re.search(r'^\s*def\s+\w+', code, re.MULTILINE))
            if has_class:
                score += 0.1
            if has_function:
                score += 0.05
        elif language.lower() in ("cpp", "c++", "c", "h", "hpp"):
            has_class = bool(re.search(r'class\s+\w+', code))
            has_function = bool(re.search(r'\w+\s+\w+\s*\([^)]*\)\s*\{', code))
            if has_class:
                score += 0.1
            if has_function:
                score += 0.05

        # 维度 4：注释检测
        comment_patterns = {
            "python": r'#.*$|""".*?"""',
            "py": r'#.*$|""".*?"""',
            "cpp": r'//.*$|/\*.*?\*/',
            "c++": r'//.*$|/\*.*?\*/',
            "c": r'//.*$|/\*.*?\*/',
            "javascript": r'//.*$|/\*.*?\*/',
            "js": r'//.*$|/\*.*?\*/',
            "typescript": r'//.*$|/\*.*?\*/',
            "ts": r'//.*$|/\*.*?\*/',
        }
        comment_pattern = comment_patterns.get(language.lower(), r'#.*$|//.*$|/\*.*?\*/')
        has_comments = bool(re.search(comment_pattern, code, re.DOTALL))
        if has_comments:
            score += 0.05

        # 维度 5：异常处理检测
        error_handling_patterns = {
            "python": r'try\s*:|except\s+|raise\s+|with\s+',
            "py": r'try\s*:|except\s+|raise\s+|with\s+',
            "cpp": r'try\s*\{|catch\s*\(|throw\s+',
            "c++": r'try\s*\{|catch\s*\(|throw\s+',
        }
        error_pattern = error_handling_patterns.get(language.lower(), r'try|except|catch|throw')
        has_error_handling = bool(re.search(error_pattern, code))
        if has_error_handling:
            score += 0.05

        # 维度 6：输入输出明确性
        if language.lower() in ("python", "py", ""):
            has_return = bool(re.search(r'return\s+\S', code))
            has_params = bool(re.search(r'def\s+\w+\s*\([^)]*\)', code))
            if has_return:
                score += 0.025
            if has_params:
                score += 0.025

        # 限制在 0.0-1.0 范围内
        return max(0.0, min(1.0, score))

    # ============================================================
    # 代码片段 CRUD
    # ============================================================

    def add_snippet(
        self,
        code: str,
        metadata: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """
        添加代码片段到记忆库
        参数：
          code: 代码文本
          metadata: 元数据字典，可包含：
            - language: 编程语言
            - tags: 标签列表
            - description: 描述
            - source: 来源
            - version: 版本号
            - file_path: 原始文件路径
        返回值：创建的片段信息字典
        运行步骤：
          1. 生成唯一 ID
          2. 对代码进行泛化处理
          3. 评估可复用性
          4. 将泛化代码写入文件存储
          5. 将元数据写入 SQLite
          6. 更新 TF-IDF 索引
        """
        if metadata is None:
            metadata = {}

        snippet_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()

        language = metadata.get("language", "")
        tags = metadata.get("tags", [])
        description = metadata.get("description", "")
        source = metadata.get("source", "")
        version = metadata.get("version", "1.0.0")
        file_path = metadata.get("file_path", "")

        # 泛化处理
        generalized_code = self.generalize(code, language)

        # 可复用性评估
        reusability_score = self.evaluate_reusability(code, language)

        with self._lock:
            # 将代码内容写入文件存储
            code_file = self._store_dir / f"{snippet_id}.txt"
            code_file.write_text(generalized_code, encoding="utf-8")

            # 将原始代码也存储一份
            original_file = self._store_dir / f"{snippet_id}_original.txt"
            original_file.write_text(code, encoding="utf-8")

            # 写入 SQLite 元数据
            conn = sqlite3.connect(self._db_path)
            conn.execute(
                """INSERT INTO code_snippets
                   (id, language, tags, description, source, version, file_path,
                    original_code, generalized_code, reusability_score,
                    usage_count, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)""",
                (
                    snippet_id,
                    language,
                    json.dumps(tags, ensure_ascii=False),
                    description,
                    source,
                    version,
                    file_path,
                    code,
                    generalized_code,
                    round(reusability_score, 4),
                    now,
                    now,
                ),
            )
            conn.commit()
            conn.close()

            # 更新 TF-IDF 索引
            if not self._use_embedding:
                self._tfidf_matcher.add_document(generalized_code)

        logger.info(
            "代码片段已入库 | id=%s | language=%s | reusability=%.2f",
            snippet_id[:8],
            language,
            reusability_score,
        )

        return {
            "id": snippet_id,
            "language": language,
            "tags": tags,
            "description": description,
            "source": source,
            "version": version,
            "file_path": file_path,
            "code": generalized_code,
            "original_code": code,
            "reusability_score": round(reusability_score, 4),
            "usage_count": 0,
            "created_at": now,
        }

    def get_snippet(self, snippet_id: str) -> Optional[Dict[str, Any]]:
        """
        获取指定代码片段
        参数：
          snippet_id: 片段 ID
        返回值：片段信息字典，不存在则返回 None
        """
        conn = sqlite3.connect(self._db_path)
        row = conn.execute(
            "SELECT id, language, tags, description, source, version, "
            "file_path, original_code, generalized_code, reusability_score, "
            "usage_count, created_at, updated_at "
            "FROM code_snippets WHERE id = ?",
            (snippet_id,),
        ).fetchone()
        conn.close()

        if row is None:
            return None

        try:
            tags = json.loads(row[2]) if row[2] else []
        except json.JSONDecodeError:
            tags = []

        return {
            "id": row[0],
            "language": row[1],
            "tags": tags,
            "description": row[3],
            "source": row[4],
            "version": row[5],
            "file_path": row[6],
            "code": row[8] if row[8] else row[7],
            "original_code": row[7],
            "reusability_score": row[9],
            "usage_count": row[10],
            "created_at": row[11],
            "updated_at": row[12],
        }

    def delete_snippet(self, snippet_id: str) -> bool:
        """
        删除指定代码片段
        参数：
          snippet_id: 片段 ID
        返回值：是否删除成功
        运行步骤：
          1. 从 SQLite 删除元数据
          2. 从文件存储删除代码文件
        """
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            cursor = conn.execute(
                "DELETE FROM code_snippets WHERE id = ?", (snippet_id,)
            )
            deleted = cursor.rowcount > 0
            conn.commit()
            conn.close()

            if deleted:
                # 删除文件存储
                code_file = self._store_dir / f"{snippet_id}.txt"
                original_file = self._store_dir / f"{snippet_id}_original.txt"
                if code_file.exists():
                    code_file.unlink()
                if original_file.exists():
                    original_file.unlink()
                logger.info("代码片段已删除 | id=%s", snippet_id[:8])

            return deleted

    def increment_usage(self, snippet_id: str):
        """
        增加代码片段的使用计数
        参数：
          snippet_id: 片段 ID
        """
        with self._lock:
            conn = sqlite3.connect(self._db_path)
            conn.execute(
                "UPDATE code_snippets SET usage_count = usage_count + 1, "
                "updated_at = ? WHERE id = ?",
                (datetime.now(timezone.utc).isoformat(), snippet_id),
            )
            conn.commit()
            conn.close()

    # ============================================================
    # 统计信息
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """
        获取记忆库统计信息
        返回值：
          {
            "total_snippets": int,          # 总片段数
            "languages": {lang: count},     # 各语言片段数
            "avg_reusability": float,       # 平均可复用性评分
            "total_usage": int,             # 总使用次数
            "storage_size_bytes": int,      # 存储占用字节数
            "model_name": str,              # 嵌入模型名称
            "similarity_threshold": float,  # 相似度阈值
          }
        """
        conn = sqlite3.connect(self._db_path)

        # 总片段数
        total = conn.execute("SELECT COUNT(*) FROM code_snippets").fetchone()[0]

        # 各语言片段数
        lang_rows = conn.execute(
            "SELECT language, COUNT(*) FROM code_snippets "
            "GROUP BY language ORDER BY COUNT(*) DESC"
        ).fetchall()
        languages = {row[0] if row[0] else "unknown": row[1] for row in lang_rows}

        # 平均可复用性评分
        avg_row = conn.execute(
            "SELECT AVG(reusability_score) FROM code_snippets"
        ).fetchone()
        avg_reusability = round(avg_row[0], 4) if avg_row[0] is not None else 0.0

        # 总使用次数
        total_usage = conn.execute(
            "SELECT SUM(usage_count) FROM code_snippets"
        ).fetchone()[0] or 0

        conn.close()

        # 存储占用字节数
        storage_size = 0
        if self._store_dir.exists():
            for f in self._store_dir.iterdir():
                if f.is_file():
                    storage_size += f.stat().st_size

        return {
            "total_snippets": total,
            "languages": languages,
            "avg_reusability": avg_reusability,
            "total_usage": total_usage,
            "storage_size_bytes": storage_size,
            "model_name": self._model_name if self._use_embedding else "TF-IDF (降级)",
            "similarity_threshold": self._similarity_threshold,
        }

    # ============================================================
    # 入库管理：任务完成后评估代码可复用性
    # ============================================================

    def ingest_from_task_result(
        self,
        code: str,
        language: str = "",
        source: str = "",
        task_id: str = "",
    ) -> Optional[Dict[str, Any]]:
        """
        从任务结果中评估并入库代码片段
        参数：
          code: 代码文本
          language: 编程语言
          source: 来源（任务 ID 或描述）
          task_id: 关联任务 ID
        返回值：入库的片段信息，不可复用则返回 None
        运行步骤：
          1. 评估代码可复用性
          2. 如果评分 >= 阈值，进行泛化处理
          3. 入库存储
          4. 返回入库结果
        """
        reusability = self.evaluate_reusability(code, language)

        if reusability < self._similarity_threshold:
            logger.debug(
                "代码可复用性不足，跳过入库 | score=%.2f | threshold=%.2f",
                reusability,
                self._similarity_threshold,
            )
            return None

        # 提取描述：取代码的前 200 个字符作为简要描述
        description = code.strip()[:200]

        # 自动检测标签
        tags = self._detect_tags(code, language)

        metadata = {
            "language": language,
            "tags": tags,
            "description": description,
            "source": source or f"task:{task_id}" if task_id else "manual",
            "version": "1.0.0",
        }

        result = self.add_snippet(code, metadata)
        logger.info(
            "任务结果已评估入库 | task=%s | reusability=%.2f | snippet=%s",
            task_id,
            reusability,
            result["id"][:8],
        )
        return result

    def _detect_tags(self, code: str, language: str = "") -> List[str]:
        """
        自动检测代码标签
        参数：
          code: 代码文本
          language: 编程语言
        返回值：标签列表
        运行步骤：
          1. 检测常见设计模式关键词
          2. 检测 ROS 相关关键词
          3. 检测算法类型关键词
        """
        tags = []

        # 设计模式检测
        pattern_keywords = {
            "singleton": ["__new__", "singleton", "_instance"],
            "factory": ["factory", "create_", "build_"],
            "observer": ["observer", "notify", "subscribe"],
            "strategy": ["strategy", "Strategy"],
            "decorator": ["@", "decorator", "wrapper"],
        }
        for pattern, keywords in pattern_keywords.items():
            if any(kw.lower() in code.lower() for kw in keywords):
                tags.append(pattern)

        # ROS 相关检测
        ros_keywords = ["rospy", "roscpp", "ros::", "NodeHandle", "Publisher", "Subscriber"]
        if any(kw in code for kw in ros_keywords):
            tags.append("ros")

        # 算法类型检测
        algo_keywords = {
            "sorting": ["sort", "quick_sort", "merge_sort", "bubble_sort"],
            "search": ["binary_search", "bfs", "dfs", "a_star"],
            "path_planning": ["path_planning", "trajectory", "a_star", "dijkstra"],
            "control": ["pid", "controller", "feedback", "setpoint"],
            "filter": ["kalman", "filter", "low_pass", "high_pass"],
        }
        for algo, keywords in algo_keywords.items():
            if any(kw.lower() in code.lower() for kw in keywords):
                tags.append(algo)

        return tags


# 全局记忆库单例
memory_store = MemoryStore()
