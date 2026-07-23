"""
# ============================================================
# 代码记忆库 API 端点（V4.1 新增）
# ============================================================
# 核心作用：提供代码记忆库的 RESTful API 接口，支持代码片段
#           的搜索、添加、查询、删除和统计
# 运行流程：
#   - GET /api/memory/search?q=query - 语义搜索代码片段
#   - POST /api/memory/snippets - 添加代码片段
#   - GET /api/memory/snippets/{id} - 获取片段详情
#   - DELETE /api/memory/snippets/{id} - 删除片段
#   - GET /api/memory/stats - 获取记忆库统计信息
# 输入参数：通过请求体、查询参数和路径参数传递
# 输出结果：JSON 格式的代码片段信息或统计信息
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现记忆库全功能 API
# ============================================================
"""

import logging
from typing import List, Optional
from fastapi import APIRouter, Request, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.memory_store import memory_store

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# 请求/响应模型
# ============================================================

class SnippetAddRequest(BaseModel):
    """
    添加代码片段请求
    字段说明：
      - code: 代码文本（必填）
      - language: 编程语言（可选，如 python、cpp、javascript）
      - tags: 标签列表（可选，用于分类检索）
      - description: 描述（可选，简要说明代码功能）
      - source: 来源（可选，标注代码出处）
      - version: 版本号（可选，默认 1.0.0）
      - file_path: 原始文件路径（可选）
    """
    code: str = Field(..., min_length=1, description="代码文本")
    language: str = Field(default="", description="编程语言")
    tags: List[str] = Field(default_factory=list, description="标签列表")
    description: str = Field(default="", description="描述")
    source: str = Field(default="", description="来源")
    version: str = Field(default="1.0.0", description="版本号")
    file_path: str = Field(default="", description="原始文件路径")


class SnippetResponse(BaseModel):
    """
    代码片段响应
    字段说明：
      - id: 片段唯一 ID
      - language: 编程语言
      - tags: 标签列表
      - description: 描述
      - source: 来源
      - version: 版本号
      - file_path: 原始文件路径
      - code: 泛化后的代码
      - original_code: 原始代码
      - reusability_score: 可复用性评分 (0.0-1.0)
      - usage_count: 使用次数
      - created_at: 创建时间
    """
    id: str
    language: str
    tags: List[str]
    description: str
    source: str
    version: str
    file_path: str
    code: str
    original_code: str
    reusability_score: float
    usage_count: int
    created_at: str


class SearchResultItem(BaseModel):
    """
    搜索结果项
    相比 SnippetResponse 多了 similarity_score 字段
    """
    id: str
    language: str
    tags: List[str]
    description: str
    source: str
    version: str
    file_path: str
    code: str
    original_code: str
    reusability_score: float
    similarity_score: float
    usage_count: int
    created_at: str


class SearchResponse(BaseModel):
    """
    搜索响应
    字段说明：
      - query: 原始查询文本
      - total: 匹配总数
      - results: 匹配结果列表
    """
    query: str
    total: int
    results: List[SearchResultItem]


class StatsResponse(BaseModel):
    """
    统计信息响应
    字段说明：
      - total_snippets: 总片段数
      - languages: 各语言片段数
      - avg_reusability: 平均可复用性评分
      - total_usage: 总使用次数
      - storage_size_bytes: 存储占用字节数
      - model_name: 嵌入模型名称
      - similarity_threshold: 相似度阈值
    """
    total_snippets: int
    languages: dict
    avg_reusability: float
    total_usage: int
    storage_size_bytes: int
    model_name: str
    similarity_threshold: float


class DeleteResponse(BaseModel):
    """删除操作响应"""
    message: str
    snippet_id: str


# ============================================================
# API 端点
# ============================================================

@router.get("/search", response_model=SearchResponse)
async def search_snippets(
    request: Request,
    q: str = Query(..., min_length=1, description="搜索查询文本"),
    language: Optional[str] = Query(None, description="按编程语言过滤"),
    top_k: Optional[int] = Query(None, ge=1, le=100, description="返回结果数量"),
):
    """
    语义搜索代码片段
    调用方：前端搜索框、任务执行引擎（代码复用检索）
    被调用方：MemoryStore.search()
    参数：
      - q: 搜索查询文本（自然语言描述或代码片段）
      - language: 可选，按编程语言过滤
      - top_k: 可选，返回结果数量（默认 10，最大 100）
    返回值：SearchResponse（匹配的代码片段列表 + 相似度评分）
    运行步骤：
      1. 校验查询参数
      2. 调用 MemoryStore.search() 执行语义检索
      3. 返回匹配结果
    """
    logger.info("记忆库搜索 | query=%s | language=%s | top_k=%s", q[:50], language, top_k)
    results = memory_store.search(query=q, language=language, top_k=top_k)
    return SearchResponse(query=q, total=len(results), results=results)


@router.post("/snippets", response_model=SnippetResponse, status_code=201)
async def add_snippet(
    request: Request,
    body: SnippetAddRequest,
):
    """
    添加代码片段到记忆库
    调用方：前端代码入库界面、任务执行引擎（自动入库）
    被调用方：MemoryStore.add_snippet()
    参数：
      - body: SnippetAddRequest（代码文本 + 元数据）
    返回值：SnippetResponse（创建的片段信息）
    运行步骤：
      1. 校验请求参数
      2. 构建元数据字典
      3. 调用 MemoryStore.add_snippet() 入库
      4. 返回创建的片段信息
    """
    logger.info(
        "添加代码片段 | language=%s | tags=%s | code_len=%d",
        body.language,
        body.tags,
        len(body.code),
    )

    metadata = {
        "language": body.language,
        "tags": body.tags,
        "description": body.description,
        "source": body.source,
        "version": body.version,
        "file_path": body.file_path,
    }

    result = memory_store.add_snippet(code=body.code, metadata=metadata)
    return SnippetResponse(**result)


@router.get("/snippets/{snippet_id}", response_model=SnippetResponse)
async def get_snippet(
    request: Request,
    snippet_id: str,
):
    """
    获取指定代码片段详情
    调用方：前端代码详情面板
    被调用方：MemoryStore.get_snippet()
    参数：
      - snippet_id: 片段 ID
    返回值：SnippetResponse（片段完整信息）
    """
    result = memory_store.get_snippet(snippet_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"代码片段不存在: {snippet_id}")
    return SnippetResponse(**result)


@router.delete("/snippets/{snippet_id}", response_model=DeleteResponse)
async def delete_snippet(
    request: Request,
    snippet_id: str,
):
    """
    删除指定代码片段
    调用方：前端代码管理面板
    被调用方：MemoryStore.delete_snippet()
    参数：
      - snippet_id: 片段 ID
    返回值：DeleteResponse（操作结果）
    """
    deleted = memory_store.delete_snippet(snippet_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"代码片段不存在: {snippet_id}")
    logger.info("代码片段已通过 API 删除 | id=%s", snippet_id[:8])
    return DeleteResponse(message="代码片段已删除", snippet_id=snippet_id)


@router.get("/stats", response_model=StatsResponse)
async def get_stats(request: Request):
    """
    获取记忆库统计信息
    调用方：前端统计面板
    被调用方：MemoryStore.get_stats()
    返回值：StatsResponse（总片段数、各语言分布、平均可复用性等）
    """
    stats = memory_store.get_stats()
    return StatsResponse(**stats)
