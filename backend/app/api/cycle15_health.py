"""
# ============================================================
# Cycle 15 P1-1 - 健康端点补齐
# ============================================================
# 核心作用：补齐健康监控端点，提供细粒度的服务健康检查
# 端点：
#   - GET  /health/ready    - 就绪探针（包含数据库 + 关键模块初始化）
#   - GET  /health/live     - 存活探针（仅检测进程存活）
#   - GET  /health/startup  - 启动探针
#   - GET  /health/components - 列出所有组件健康状态
#   - GET  /health/cycle15  - Cycle 15 模块健康
#   - GET  /health/metrics  - 运行时指标
# 修改记录：
#   - 2026-07-29 | v1.0.0 | Cycle 15 P1-1 新建
# ============================================================
"""

from __future__ import annotations

import logging
import os
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/health", tags=["health"])


# ============================================================
# 应用启动时间
# ============================================================
_APP_START_TIME = time.time()
_APP_START_TIMESTAMP = datetime.now(timezone.utc).isoformat()


# ============================================================
# 组件健康注册
# ============================================================
class ComponentHealth:
    """单个组件健康状态"""

    def __init__(
        self,
        name: str,
        status: str = "unknown",
        detail: str = "",
        last_check_at: Optional[str] = None,
        check_count: int = 0,
    ) -> None:
        self.name = name
        self.status = status
        self.detail = detail
        self.last_check_at = last_check_at
        self.check_count = check_count

    def to_dict(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "last_check_at": self.last_check_at,
            "check_count": self.check_count,
        }


class HealthRegistry:
    """健康状态注册中心（线程安全）"""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._components: Dict[str, ComponentHealth] = {}

    def register(
        self,
        name: str,
        status: str = "ok",
        detail: str = "",
    ) -> ComponentHealth:
        with self._lock:
            comp = self._components.get(name)
            if comp is None:
                comp = ComponentHealth(name=name)
                self._components[name] = comp
            comp.status = status
            comp.detail = detail
            comp.last_check_at = datetime.now(timezone.utc).isoformat()
            comp.check_count += 1
            return comp

    def get(self, name: str) -> Optional[ComponentHealth]:
        with self._lock:
            return self._components.get(name)

    def all_components(self) -> List[ComponentHealth]:
        with self._lock:
            return list(self._components.values())

    def overall_status(self) -> str:
        with self._lock:
            statuses = [c.status for c in self._components.values()]
            if not statuses:
                return "unknown"
            if all(s == "ok" for s in statuses):
                return "ok"
            if any(s in ("error", "down") for s in statuses):
                return "degraded"
            return "ok"


# 全局单例
_REGISTRY = HealthRegistry()
_REGISTRY_LOCK = threading.Lock()


def get_health_registry() -> HealthRegistry:
    global _REGISTRY
    with _REGISTRY_LOCK:
        return _REGISTRY


# ============================================================
# 自动注册常见组件
# ============================================================
def _auto_register_components() -> None:
    """自动注册所有 Cycle 15 模块状态"""
    registry = get_health_registry()

    # 检测 Goal Sync 模块是否可用
    try:
        from app.core.goal_sync import get_sync
        registry.register("goal_sync", status="ok", detail="module available")
    except Exception as e:
        registry.register("goal_sync", status="error", detail=str(e))

    # 检测 Goal Scheduler 模块
    try:
        from app.core.goal_scheduler import get_scheduler
        registry.register("goal_scheduler", status="ok", detail="module available")
    except Exception as e:
        registry.register("goal_scheduler", status="error", detail=str(e))

    # 检测 LLM Cost Tracker
    try:
        from app.core.llm_cost import get_tracker
        registry.register("llm_cost", status="ok", detail="module available")
    except Exception as e:
        registry.register("llm_cost", status="error", detail=str(e))

    # 检测 LLM Judge
    try:
        from app.core.llm_judge import ConsensusEngine
        registry.register("llm_judge", status="ok", detail="module available")
    except Exception as e:
        registry.register("llm_judge", status="error", detail=str(e))

    # 检测 Goal Manager
    try:
        from app.core.goal import GoalManager
        registry.register("goal_manager", status="ok", detail="module available")
    except Exception as e:
        registry.register("goal_manager", status="error", detail=str(e))

    # 检测 AutoTurn Engine
    try:
        from app.core.goal_automation import AutoTurnEngine
        registry.register("auto_turn", status="ok", detail="module available")
    except Exception as e:
        registry.register("auto_turn", status="error", detail=str(e))

    # 存储层
    storage_dir = os.path.expanduser("~/.hermes")
    if os.path.exists(storage_dir):
        registry.register("storage", status="ok", detail=f"path={storage_dir}")
    else:
        registry.register("storage", status="warning", detail=f"path not exists: {storage_dir}")


_auto_register_components()


# ============================================================
# 响应模型
# ============================================================
class HealthResponse(BaseModel):
    status: str
    service: str
    version: str
    uptime_seconds: float
    start_time: str
    components: List[Dict[str, Any]] = []
    details: Dict[str, Any] = {}


# ============================================================
# 端点
# ============================================================
SERVICE_NAME = "hermes-claude-code-platform"
SERVICE_VERSION = "v6.35.0"


@router.get("/ready", response_model=HealthResponse)
async def readiness_probe() -> HealthResponse:
    """
    就绪探针

    检查所有组件是否初始化完成，准备接受请求
    """
    registry = get_health_registry()
    components = [c.to_dict() for c in registry.all_components()]
    overall = registry.overall_status()

    # 关键模块必须 ok
    critical_ok = all(
        c["status"] == "ok"
        for c in components
        if c["name"] in ("goal_sync", "goal_scheduler", "llm_cost", "llm_judge")
    )
    status = "ready" if (overall == "ok" and critical_ok) else "not_ready"

    return HealthResponse(
        status=status,
        service=SERVICE_NAME,
        version=SERVICE_VERSION,
        uptime_seconds=time.time() - _APP_START_TIME,
        start_time=_APP_START_TIMESTAMP,
        components=components,
        details={"critical_ok": critical_ok},
    )


@router.get("/live")
async def liveness_probe() -> Dict[str, Any]:
    """
    存活探针

    仅检测进程是否存活，不做依赖检查
    """
    return {
        "status": "alive",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "uptime_seconds": time.time() - _APP_START_TIME,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/startup")
async def startup_probe() -> Dict[str, Any]:
    """
    启动探针

    检查应用是否已成功启动
    """
    registry = get_health_registry()
    return {
        "status": "started",
        "service": SERVICE_NAME,
        "version": SERVICE_VERSION,
        "start_time": _APP_START_TIMESTAMP,
        "uptime_seconds": time.time() - _APP_START_TIME,
        "components_count": len(registry.all_components()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/components")
async def list_components() -> Dict[str, Any]:
    """列出所有组件健康状态"""
    registry = get_health_registry()
    components = [c.to_dict() for c in registry.all_components()]
    return {
        "success": True,
        "overall_status": registry.overall_status(),
        "components": components,
        "total": len(components),
    }


@router.get("/cycle15")
async def cycle15_health() -> Dict[str, Any]:
    """
    Cycle 15 模块健康

    详细检查 P0-1, P0-2, P1-1, P1-2, P1-3 模块状态
    """
    registry = get_health_registry()
    cycle15_components = [
        c for c in registry.all_components()
        if c.name in (
            "goal_sync",
            "goal_scheduler",
            "llm_cost",
            "llm_judge",
            "auto_turn",
            "goal_manager",
        )
    ]
    cycle15_status = "ok" if all(
        c.status == "ok" for c in cycle15_components
    ) else "degraded"
    return {
        "success": True,
        "cycle": "15",
        "status": cycle15_status,
        "modules": {c.name: c.to_dict() for c in cycle15_components},
        "module_count": len(cycle15_components),
    }


@router.get("/metrics")
async def health_metrics() -> Dict[str, Any]:
    """
    运行时指标

    返回进程级 + 模块级指标
    """
    registry = get_health_registry()
    import platform
    import sys
    return {
        "success": True,
        "process": {
            "uptime_seconds": time.time() - _APP_START_TIME,
            "start_time": _APP_START_TIMESTAMP,
            "python_version": sys.version.split()[0],
            "platform": platform.platform(),
        },
        "service": {
            "name": SERVICE_NAME,
            "version": SERVICE_VERSION,
        },
        "components": {
            "total": len(registry.all_components()),
            "ok": sum(1 for c in registry.all_components() if c.status == "ok"),
            "warning": sum(1 for c in registry.all_components() if c.status == "warning"),
            "error": sum(1 for c in registry.all_components() if c.status in ("error", "down")),
        },
    }


@router.post("/refresh")
async def refresh_components() -> Dict[str, Any]:
    """刷新所有组件健康状态"""
    _auto_register_components()
    registry = get_health_registry()
    return {
        "success": True,
        "message": "组件健康状态已刷新",
        "total": len(registry.all_components()),
        "overall_status": registry.overall_status(),
    }


@router.post("/component/{name}")
async def set_component_health(name: str, status: str = "ok", detail: str = "") -> Dict[str, Any]:
    """设置单个组件健康状态"""
    if status not in ("ok", "warning", "error", "down", "unknown"):
        return {
            "success": False,
            "error": f"invalid status: {status}; must be ok/warning/error/down/unknown",
        }
    registry = get_health_registry()
    comp = registry.register(name, status=status, detail=detail)
    return {
        "success": True,
        "component": comp.to_dict(),
    }
