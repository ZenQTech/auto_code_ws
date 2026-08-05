"""
# ============================================================
# Codebase Indexer API (v1.0.0)
# Cycle 68 G68-01
# ============================================================
# 核心作用：暴露 CodebaseIndexer 为 REST API
#   POST /api/codebase/index      构建/重建索引
#   POST /api/codebase/search     搜索代码库
#   GET  /api/codebase/file       读取文件片段
#   GET  /api/codebase/stats      索引统计
#   DELETE /api/codebase/{id}     删除索引
# 输入参数：JSON body / query params
# 输出结果：JSON response
# 对标：Codex `codex-rs/project_index` 内部 API
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 68 G68-01 初次创建
# ====================================
"""

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.codebase_indexer import (
    CodebaseIndexer,
    CodebaseIndexerError,
    FileTooLargeError,
    IndexNotFoundError,
    InvalidQueryError,
    ProjectNotFoundError,
    SearchResult,
    get_codebase_indexer,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/codebase", tags=["codebase"])


# ============================================================
# Request / Response Models
# ============================================================


class IndexRequest(BaseModel):
    project_root: str = Field(..., description="项目根目录绝对路径")
    force_rebuild: bool = Field(default=False, description="是否强制重建")


class IndexResponse(BaseModel):
    session_id: str
    project_root: str
    total_files: int
    total_symbols: int
    total_lines: int
    languages: Dict[str, int]
    build_time_ms: int
    status: str = "completed"


class SearchRequest(BaseModel):
    session_id: str = Field(..., description="索引会话 ID")
    query: str = Field(..., min_length=1, max_length=500, description="搜索关键词")
    top_k: int = Field(default=20, ge=1, le=100, description="返回结果数")
    file_pattern: Optional[str] = Field(default=None, description="文件名 glob 模式")
    include_symbols: bool = Field(default=True, description="是否包含符号搜索")


class SearchResultItem(BaseModel):
    type: str
    file: str
    line: Optional[int] = None
    line_start: Optional[int] = None
    line_end: Optional[int] = None
    name: Optional[str] = None
    kind: Optional[str] = None
    signature: Optional[str] = None
    snippet: Optional[str] = None
    score: float


class SearchResponse(BaseModel):
    session_id: str
    query: str
    total: int
    results: List[SearchResultItem]


class FileRangeResponse(BaseModel):
    path: str
    language: str
    total_lines: int
    lines: List[Dict[str, Any]]


class StatsResponse(BaseModel):
    session_id: str
    project_root: str
    total_files: int
    total_symbols: int
    total_lines: int
    languages: Dict[str, int]
    indexed_at: float
    build_time_ms: int
    fs_watch_active: bool


class DeleteResponse(BaseModel):
    success: bool
    session_id: str


# ============================================================
# Session ID Generation
# ============================================================

_session_counter = 0


def _generate_session_id(project_root: str) -> str:
    """生成确定性 session_id（基于路径 hash + 时间）"""
    global _session_counter
    _session_counter += 1
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", os.path.basename(project_root))[:24]
    return f"idx-{safe}-{int(time.time())}-{_session_counter}"


# ============================================================
# Endpoints
# ============================================================


@router.post("/index", response_model=IndexResponse)
async def build_index(request: IndexRequest) -> IndexResponse:
    """
    构建项目代码库索引

    - 扫描项目根目录下所有支持的文件
    - 提取文件元数据、符号、文本索引
    - 返回 session_id 用于后续查询
    """
    indexer = get_codebase_indexer()
    try:
        session_id = _generate_session_id(request.project_root)
        stats = indexer.build_index(
            session_id=session_id,
            project_root=request.project_root,
            force_rebuild=request.force_rebuild,
        )
        return IndexResponse(
            session_id=session_id,
            project_root=stats.project_root,
            total_files=stats.total_files,
            total_symbols=stats.total_symbols,
            total_lines=stats.total_lines,
            languages=stats.languages,
            build_time_ms=stats.build_time_ms,
            status="completed",
        )
    except ProjectNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"PROJECT_NOT_FOUND: {e}")
    except CodebaseIndexerError as e:
        raise HTTPException(status_code=500, detail=f"INDEX_BUILD_FAILED: {e}")


@router.post("/search", response_model=SearchResponse)
async def search_codebase(request: SearchRequest) -> SearchResponse:
    """
    搜索代码库

    - 多策略并行：text + symbol
    - 按相关性排序
    - top_k 截断
    """
    indexer = get_codebase_indexer()
    try:
        results = indexer.search(
            session_id=request.session_id,
            query=request.query,
            top_k=request.top_k,
            file_pattern=request.file_pattern,
            include_symbols=request.include_symbols,
        )
        items = [
            SearchResultItem(**r.to_dict()) for r in results
        ]
        return SearchResponse(
            session_id=request.session_id,
            query=request.query,
            total=len(items),
            results=items,
        )
    except InvalidQueryError as e:
        raise HTTPException(status_code=400, detail=f"INVALID_QUERY: {e}")
    except IndexNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"INDEX_NOT_FOUND: {e}")
    except CodebaseIndexerError as e:
        raise HTTPException(status_code=500, detail=f"SEARCH_FAILED: {e}")


@router.get("/file", response_model=FileRangeResponse)
async def get_file(
    session_id: str = Query(..., description="索引会话 ID"),
    path: str = Query(..., description="相对路径"),
    line_start: int = Query(default=0, ge=0, description="起始行（0-indexed）"),
    line_end: Optional[int] = Query(default=None, ge=0, description="结束行"),
) -> FileRangeResponse:
    """
    读取文件片段

    - 通过 session_id 限定项目根
    - 通过 line_start/line_end 控制行范围
    """
    indexer = get_codebase_indexer()
    try:
        data = indexer.get_file(
            session_id=session_id,
            path=path,
            line_start=line_start,
            line_end=line_end,
        )
        return FileRangeResponse(**data)
    except IndexNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"INDEX_NOT_FOUND: {e}")
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"FILE_NOT_FOUND: {e}")
    except FileTooLargeError as e:
        raise HTTPException(status_code=413, detail=f"FILE_TOO_LARGE: {e}")
    except CodebaseIndexerError as e:
        raise HTTPException(status_code=500, detail=f"GET_FILE_FAILED: {e}")


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    session_id: str = Query(..., description="索引会话 ID"),
) -> StatsResponse:
    """获取索引统计"""
    indexer = get_codebase_indexer()
    try:
        stats = indexer.get_stats(session_id)
        return StatsResponse(**stats.to_dict())
    except IndexNotFoundError as e:
        raise HTTPException(status_code=404, detail=f"INDEX_NOT_FOUND: {e}")


@router.delete("/{session_id}", response_model=DeleteResponse)
async def delete_index(session_id: str) -> DeleteResponse:
    """删除索引会话"""
    indexer = get_codebase_indexer()
    success = indexer.remove_session(session_id)
    return DeleteResponse(success=success, session_id=session_id)


@router.get("/sessions")
async def list_sessions() -> Dict[str, Any]:
    """列出所有索引会话"""
    indexer = get_codebase_indexer()
    sessions = indexer.list_sessions()
    return {"total": len(sessions), "sessions": sessions}
