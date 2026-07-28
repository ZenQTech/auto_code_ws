"""
# ============================================================
# Import API - /api/import REST 端点 (Cycle 11 P3-1)
# ============================================================
# 核心作用：提供跨平台配置导入的 REST API
# 端点：
#   - GET  /api/import/health - 健康检查
#   - GET  /api/import/formats - 支持的格式列表
#   - POST /api/import/detect - 检测已安装的 IDE
#   - POST /api/import/preview - 预览待迁移项
#   - POST /api/import/run - 异步执行导入
#   - GET  /api/import/status/{id} - 查询状态
#   - GET  /api/import/list - 列出所有任务
#   - DELETE /api/import/{id} - 取消/回滚任务
#   - GET  /api/import/stats - 统计
# 输入参数：ImportSource + DataType + 可选 install_path
# 输出结果：JSON 格式
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P3-1 新建
# ============================================================
"""

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..core.import_converters.base import DataType, ImportSource
from ..services.import_service import (
    ImportService,
    ImportStatus,
    get_import_service,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["import"])


# ============================================================
# 请求/响应模型
# ============================================================


class DetectRequest(BaseModel):
    """检测请求"""
    sources: Optional[List[str]] = Field(default=None, description="要检测的源列表（None=全部）")


class DetectedSourceResponse(BaseModel):
    """检测到的源"""
    source: str
    install_path: str
    available: bool
    version: Optional[str] = None
    data_types: List[str] = []
    size_bytes: int = 0
    last_modified: Optional[str] = None
    error: Optional[str] = None


class PreviewRequest(BaseModel):
    """预览请求"""
    source: str = Field(..., description="数据源")
    data_types: List[str] = Field(..., description="数据类型列表")
    install_path: Optional[str] = Field(default=None, description="自定义安装路径")


class PreviewItemResponse(BaseModel):
    """预览项"""
    source: str
    data_type: str
    source_path: str
    target_path: str
    size_bytes: int
    item_count: int = 1
    conflicts: List[str] = []
    transform_notes: List[str] = []
    error: Optional[str] = None


class RunRequest(BaseModel):
    """执行请求"""
    source: str = Field(..., description="数据源")
    data_types: List[str] = Field(..., description="数据类型列表")
    install_path: Optional[str] = Field(default=None, description="自定义安装路径")


class ImportTaskResponse(BaseModel):
    """导入任务响应"""
    success: bool
    task_id: str
    status: str
    source: str
    data_types: List[str]
    progress: float
    started_at: str
    completed_at: Optional[str] = None
    items_total: int
    items_completed: int
    items_failed: int
    error: Optional[str] = None
    rollback_available: bool
    log: List[str] = []
    results: List[Dict[str, Any]] = []


# ============================================================
# 工具函数
# ============================================================


def _parse_source(source: str) -> ImportSource:
    """解析 source 字符串"""
    try:
        return ImportSource(source)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"invalid source: {source}")


def _parse_data_types(data_types: List[str]) -> List[DataType]:
    """解析 data_types 列表"""
    try:
        return [DataType(dt) for dt in data_types]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"invalid data_type: {e}")


# ============================================================
# 端点
# ============================================================


@router.get("/health")
async def health() -> Dict[str, Any]:
    """健康检查"""
    service = get_import_service()
    return service.health_check()


@router.get("/formats")
async def list_formats() -> Dict[str, Any]:
    """列出支持的格式"""
    return {
        "sources": [
            {"value": s.value, "name": s.name}
            for s in ImportSource
        ],
        "data_types": [
            {"value": dt.value, "name": dt.name}
            for dt in DataType
        ],
        "supported_combinations": [
            {"source": s.value, "data_type": dt.value}
            for s in ImportSource for dt in DataType
        ],
    }


@router.post("/detect")
async def detect(req: DetectRequest) -> Dict[str, Any]:
    """检测已安装的 IDE"""
    service = get_import_service()
    sources = None
    if req.sources:
        try:
            sources = [_parse_source(s) for s in req.sources]
        except HTTPException:
            raise
    results = service.detect_sources(sources)
    return {
        "count": len(results),
        "sources": [
            DetectedSourceResponse(
                source=r.source.value,
                install_path=r.install_path,
                available=r.available,
                version=r.version,
                data_types=[dt.value for dt in r.data_types],
                size_bytes=r.size_bytes,
                last_modified=r.last_modified,
                error=r.error,
            ).dict()
            for r in results
        ],
    }


@router.post("/preview")
async def preview(req: PreviewRequest) -> Dict[str, Any]:
    """预览待迁移项（dry-run）"""
    service = get_import_service()
    source = _parse_source(req.source)
    data_types = _parse_data_types(req.data_types)
    install_path = Path(req.install_path).expanduser() if req.install_path else None

    items = service.preview_import(source, data_types, install_path)
    return {
        "count": len(items),
        "items": [
            PreviewItemResponse(
                source=i.source.value,
                data_type=i.data_type.value,
                source_path=i.source_path,
                target_path=i.target_path,
                size_bytes=i.size_bytes,
                item_count=i.item_count,
                conflicts=i.conflicts,
                transform_notes=i.transform_notes,
                error=i.error,
            ).dict()
            for i in items
        ],
    }


@router.post("/run")
async def run_import(req: RunRequest) -> Dict[str, Any]:
    """异步执行导入"""
    service = get_import_service()
    source = _parse_source(req.source)
    data_types = _parse_data_types(req.data_types)
    install_path = Path(req.install_path).expanduser() if req.install_path else None

    task, err = service.run_import(source, data_types, install_path)
    if not task:
        raise HTTPException(status_code=400, detail=err)

    return {
        "success": True,
        "task_id": task.task_id,
        "status": task.status.value,
        "items_total": task.items_total,
        "message": "import task started",
    }


@router.get("/status/{task_id}")
async def get_status(task_id: str) -> Dict[str, Any]:
    """查询任务状态"""
    service = get_import_service()
    task = service.get_task(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="task not found")
    return task.to_dict()


@router.get("/list")
async def list_all(
    source: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    """列出所有任务"""
    service = get_import_service()
    src = _parse_source(source) if source else None
    st = None
    if status:
        try:
            st = ImportStatus(status)
        except ValueError:
            raise HTTPException(status_code=400, detail=f"invalid status: {status}")
    tasks = service.list_tasks(src, st)
    return {
        "count": len(tasks),
        "tasks": [t.to_dict() for t in tasks],
    }


@router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    rollback: bool = Query(default=False, description="是否回滚已迁移项"),
) -> Dict[str, Any]:
    """取消/回滚任务"""
    service = get_import_service()
    if rollback:
        success, msg = service.rollback_task(task_id)
        if not success:
            raise HTTPException(status_code=400, detail=msg)
        return {"success": True, "task_id": task_id, "action": "rolled_back"}
    else:
        success = service.cancel_task(task_id)
        if not success:
            raise HTTPException(status_code=404, detail="task not found or not cancellable")
        return {"success": True, "task_id": task_id, "action": "cancelled"}


@router.get("/stats")
async def stats() -> Dict[str, Any]:
    """统计"""
    service = get_import_service()
    return service.get_stats()
