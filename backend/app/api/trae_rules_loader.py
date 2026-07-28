"""
# ============================================================
# .trae/rules/ Multi-Level Loader API (Cycle 9 P1-6)
# ============================================================
# 核心作用：实现 .trae/rules/ 多级嵌套规则加载的 REST API
#           - 扫描并注册项目
#           - 列出规则（按项目 / 跨项目）
#           - 按 name 加载完整规则
#           - 按 category 列出规则
#           - 分类列表 + 统计
# 端点：
#   - POST   /api/trae-rules/scan              扫描并注册
#   - GET    /api/trae-rules/list              列出规则
#   - GET    /api/trae-rules/categories        列出分类
#   - GET    /api/trae-rules/by-name/{name}    按 name 加载
#   - GET    /api/trae-rules/by-category/{cat} 按 category 加载
#   - DELETE /api/trae-rules/project           注销项目
#   - GET    /api/trae-rules/stats             统计
#   - GET    /api/trae-rules/health            健康检查
# 输入参数：通过查询参数或请求体传递
# 输出结果：JSON 格式响应
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 9 P1-6 新建
# ============================================================
"""

import logging
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.trae_rules_loader import (
    MAX_CATEGORY_DEPTH,
    TraeRulesLoader,
    TraeRulesRegistry,
    get_global_rules_registry,
    reset_global_rules_registry,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["Trae Rules Loader"])


# ============================================================
# 路径白名单
# ============================================================
ALLOWED_PROJECT_PATHS = [
    "/home/qizheng/auto_code_ws",
    "/home/qizheng/auto_code_data",
    "/tmp/test-projects",
    "/tmp",
]


def _validate_project_path(project_path: str) -> str:
    """校验并规范化项目路径"""
    import os

    abs_path = os.path.abspath(project_path)
    for allowed in ALLOWED_PROJECT_PATHS:
        if abs_path == allowed or abs_path.startswith(allowed + "/"):
            if not os.path.isdir(abs_path):
                raise HTTPException(
                    status_code=404, detail=f"Project path not found: {abs_path}"
                )
            return abs_path
    raise HTTPException(
        status_code=403, detail=f"Project path not in whitelist: {abs_path}"
    )


def _validate_rule_name(name: str) -> str:
    """校验规则名称"""
    if not re.match(r"^[A-Za-z0-9_\-\.]{1,64}$", name):
        raise HTTPException(
            status_code=400, detail=f"Invalid rule name: {name}"
        )
    return name


def _validate_category(category: str) -> str:
    """校验 category 路径（防止路径遍历）"""
    if not category or len(category) > 256:
        raise HTTPException(
            status_code=400, detail=f"Invalid category: {category}"
        )
    # 禁止 ../ 路径遍历
    if ".." in category or category.startswith("/"):
        raise HTTPException(
            status_code=400, detail=f"Invalid category path: {category}"
        )
    # 类别仅允许字母数字、下划线、连字符、斜杠
    if not re.match(r"^[A-Za-z0-9_\-/]+$", category):
        raise HTTPException(
            status_code=400, detail=f"Invalid category characters: {category}"
        )
    return category


# ============================================================
# 请求/响应模型
# ============================================================
class ScanRequest(BaseModel):
    """扫描请求"""

    project_path: str = Field(..., description="项目根目录绝对路径")
    max_depth: int = Field(
        default=MAX_CATEGORY_DEPTH,
        description=f"最大嵌套目录深度（默认 {MAX_CATEGORY_DEPTH}）",
    )


class ApiResponse(BaseModel):
    """统一响应"""

    success: bool
    action: str
    data: Dict[str, Any]


# ============================================================
# 端点实现
# ============================================================


@router.post("/scan", response_model=ApiResponse)
async def scan_rules(req: ScanRequest) -> ApiResponse:
    """扫描并注册项目的 .trae/rules/ 规则

    多级嵌套策略：
      - 递归扫描 .trae/rules/ 下的所有 .md 文件
      - 自动从子目录路径生成 category（如 python/testing）
      - 跳过 _ 前缀的模板文件
      - 限制最大嵌套深度（默认 3 级）
    """
    project_path = _validate_project_path(req.project_path)
    try:
        registry = get_global_rules_registry()
        count = registry.register_project(project_path)
        rules = registry.list_rules(project_path)
        categories = registry.list_categories(project_path)
        return ApiResponse(
            success=True,
            action="scan",
            data={
                "project_path": project_path,
                "registered": count,
                "rules": [r.to_summary_dict() for r in rules],
                "categories": categories,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"scan rules failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/list", response_model=ApiResponse)
async def list_rules(
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
    summary_only: bool = Query(default=True, description="仅返回摘要"),
) -> ApiResponse:
    """列出已注册规则

    Args:
        project_path: 项目路径（None = 跨项目）
        summary_only: 是否仅返回摘要（不含 content）
    """
    try:
        registry = get_global_rules_registry()
        pp = _validate_project_path(project_path) if project_path else None
        rules = registry.list_rules(pp)
        if summary_only:
            data = [r.to_summary_dict() for r in rules]
        else:
            data = [r.to_dict() for r in rules]
        return ApiResponse(
            success=True,
            action="list",
            data={
                "project_path": pp,
                "count": len(rules),
                "rules": data,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"list rules failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/categories", response_model=ApiResponse)
async def list_categories(
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """列出所有分类

    返回每个分类下的规则数 + 规则名列表
    """
    try:
        registry = get_global_rules_registry()
        pp = _validate_project_path(project_path) if project_path else None
        categories = registry.list_categories(pp)
        return ApiResponse(
            success=True,
            action="categories",
            data={
                "project_path": pp,
                "count": len(categories),
                "categories": categories,
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"categories failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/by-name/{name}", response_model=ApiResponse)
async def get_rule_by_name(
    name: str,
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """按 name 加载完整规则"""
    name = _validate_rule_name(name)
    try:
        registry = get_global_rules_registry()
        pp = _validate_project_path(project_path) if project_path else None
        rule = registry.load_by_name(name, pp)
        if rule is None:
            raise HTTPException(
                status_code=404, detail=f"Rule not found: {name}"
            )
        return ApiResponse(
            success=True,
            action="get_full",
            data={"rule": rule.to_dict()},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_rule_by_name failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/by-category/{category:path}", response_model=ApiResponse)
async def get_rules_by_category(
    category: str,
    project_path: Optional[str] = Query(default=None, description="项目根目录"),
) -> ApiResponse:
    """按 category 加载该分类下所有规则"""
    category = _validate_category(category)
    try:
        registry = get_global_rules_registry()
        pp = _validate_project_path(project_path) if project_path else None
        # 先列出所有规则，再按 category 过滤
        all_rules = registry.list_rules(pp)
        rules = [r for r in all_rules if r.category == category]
        return ApiResponse(
            success=True,
            action="by_category",
            data={
                "project_path": pp,
                "category": category,
                "count": len(rules),
                "rules": [r.to_summary_dict() for r in rules],
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_rules_by_category failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/project", response_model=ApiResponse)
async def unregister_project(
    project_path: str = Query(..., description="项目根目录"),
) -> ApiResponse:
    """注销项目的规则"""
    pp = _validate_project_path(project_path)
    try:
        registry = get_global_rules_registry()
        ok = registry.unregister_project(pp)
        if not ok:
            raise HTTPException(
                status_code=404, detail=f"Project not registered: {pp}"
            )
        return ApiResponse(
            success=True,
            action="unregister",
            data={"project_path": pp, "unregistered": True},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"unregister failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats", response_model=ApiResponse)
async def get_stats() -> ApiResponse:
    """获取注册表统计"""
    try:
        registry = get_global_rules_registry()
        stats = registry.get_stats()
        return ApiResponse(
            success=True,
            action="stats",
            data={"stats": stats},
        )
    except Exception as e:
        logger.error(f"stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/health")
async def health_check() -> Dict[str, Any]:
    """健康检查"""
    return {
        "status": "ok",
        "service": "trae-rules-loader",
        "version": "1.0.0",
        "cycle": "9",
        "max_category_depth": MAX_CATEGORY_DEPTH,
    }
