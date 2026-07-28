"""
# ============================================================
# Memory System REST API (v1.0.0)
# ============================================================
# 核心作用：智能体长期记忆 REST API
#           17 个端点：Entities / Relations / Observations / Search / Graph / Skills / Health
# 运行流程：
#   1. 启动时从 main.py 注册路由（prefix=/api/memory）
#   2. 所有请求路由到 MCPMemoryStore 单例
#   3. 错误处理：400/404/409/422/500
# 输入参数：通过 JSON body 或 path/query 参数
# 输出结果：JSON 响应
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 10 P1-8 新建 - 完整 17 个端点
# ============================================================
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from ..services.memory import (
    MCPMemoryStore,
    MemoryEntity,
    MemoryRelation,
    MemoryObservation,
    EntityType,
    RelationType,
    ObservationSource,
    get_mcp_memory_store,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# Pydantic Models
# ============================================================

class CreateEntityRequest(BaseModel):
    """创建实体请求"""
    name: str = Field(..., min_length=3, max_length=128, description="实体名（snake_case）")
    entity_type: str = Field(..., description="实体类型: project/pattern/preference/profile/fact")
    project: str = Field(default="_global", max_length=128, description="所属项目")
    metadata: Dict[str, Any] = Field(default_factory=dict, description="额外属性")


class UpdateEntityRequest(BaseModel):
    """更新实体请求"""
    entity_type: Optional[str] = None
    project: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class CreateRelationRequest(BaseModel):
    """创建关系请求"""
    source: str = Field(..., min_length=3, max_length=128)
    target: str = Field(..., min_length=3, max_length=128)
    relation_type: str = Field(..., description="关系类型: depends_on/uses/solves/conflicts/extends/related_to")
    weight: float = Field(default=1.0, ge=0.0, le=1.0)


class AddObservationRequest(BaseModel):
    """添加观察请求"""
    entity_name: str = Field(..., min_length=3, max_length=128)
    content: str = Field(..., min_length=10, max_length=500, description="格式: [YYYY-MM-DD] xxx")
    source: str = Field(default="agent", description="user/agent/system")
    confidence: float = Field(default=1.0, ge=0.0, le=1.0)


class MemoryKernelRequest(BaseModel):
    """memory-kernel skill 请求"""
    action: str = Field(..., description="read/write/update/delete")
    name: Optional[str] = None
    entity_type: Optional[str] = None
    project: Optional[str] = None
    observations: Optional[List[str]] = None
    metadata: Optional[Dict[str, Any]] = None
    query: Optional[str] = None
    force: bool = False


class SelfImprovementRequest(BaseModel):
    """self-improvement skill 请求"""
    error_type: str = Field(..., min_length=3, max_length=128)
    summary: str = Field(..., min_length=10, max_length=500)
    occurrences: int = Field(default=1, ge=1)
    verified: bool = Field(default=False, description="解决方案是否已验证")


class MemoryRecallRequest(BaseModel):
    """memory-recall skill 请求"""
    query: str = Field(..., min_length=1, max_length=500)
    limit: int = Field(default=5, ge=1, le=50)


# ============================================================
# 辅助函数
# ============================================================

def _get_store() -> MCPMemoryStore:
    """获取 MCP Memory Store 单例"""
    return get_mcp_memory_store()


def _entity_to_response(entity: MemoryEntity, store: MCPMemoryStore) -> Dict[str, Any]:
    """实体转响应格式"""
    observations = store.get_observations(entity.name)
    relations = store.list_relations(source=entity.name)
    relations += store.list_relations(target=entity.name)
    return {
        **entity.to_dict(),
        "observations": [o.to_dict() for o in observations],
        "relations": [r.to_dict() for r in relations],
    }


# ============================================================
# Entity 端点
# ============================================================

@router.post("/entities")
async def create_entity(req: CreateEntityRequest):
    """创建记忆实体"""
    store = _get_store()
    # 校验 entity_type
    if req.entity_type not in [e.value for e in EntityType]:
        raise HTTPException(
            status_code=400,
            detail=f"invalid entity_type: {req.entity_type}. "
                   f"Must be one of {[e.value for e in EntityType]}",
        )
    entity = MemoryEntity(
        name=req.name,
        entity_type=req.entity_type,
        project=req.project,
        metadata=req.metadata,
    )
    success, err = store.create_entity(entity)
    if not success:
        # 区分已存在 vs 校验失败
        if "already exists" in err:
            raise HTTPException(status_code=409, detail=err)
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "action": "create_entity",
        "data": _entity_to_response(entity, store),
    }


@router.get("/entities")
async def list_entities(
    entity_type: Optional[str] = Query(None),
    project: Optional[str] = Query(None),
    limit: Optional[int] = Query(None, ge=1, le=1000),
):
    """列出实体"""
    store = _get_store()
    entities = store.list_entities(entity_type=entity_type, project=project, limit=limit)
    return {
        "success": True,
        "action": "list_entities",
        "data": [_entity_to_response(e, store) for e in entities],
        "total": len(entities),
    }


@router.get("/entities/{name}")
async def get_entity(name: str):
    """查询实体"""
    store = _get_store()
    entity = store.get_entity(name)
    if not entity:
        raise HTTPException(status_code=404, detail=f"entity '{name}' not found")
    return {
        "success": True,
        "action": "get_entity",
        "data": _entity_to_response(entity, store),
    }


@router.put("/entities/{name}")
async def update_entity(name: str, req: UpdateEntityRequest):
    """更新实体"""
    store = _get_store()
    success, err = store.update_entity(
        name,
        entity_type=req.entity_type,
        project=req.project,
        metadata=req.metadata,
    )
    if not success:
        if "not found" in err:
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)
    entity = store.get_entity(name)
    return {
        "success": True,
        "action": "update_entity",
        "data": _entity_to_response(entity, store),
    }


@router.delete("/entities/{name}")
async def delete_entity(name: str, force: bool = Query(False)):
    """删除实体"""
    store = _get_store()
    success, err = store.delete_entity(name, force=force)
    if not success:
        if "not found" in err:
            raise HTTPException(status_code=404, detail=err)
        if "public-protected" in err:
            raise HTTPException(status_code=403, detail=err)
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "action": "delete_entity",
        "name": name,
    }


# ============================================================
# Relation 端点
# ============================================================

@router.post("/relations")
async def create_relation(req: CreateRelationRequest):
    """创建实体关系"""
    store = _get_store()
    success, err, relation = store.create_relation(
        source=req.source,
        target=req.target,
        relation_type=req.relation_type,
        weight=req.weight,
    )
    if not success:
        if "not found" in err:
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "action": "create_relation",
        "data": relation.to_dict(),
    }


@router.get("/relations")
async def list_relations(
    source: Optional[str] = Query(None),
    target: Optional[str] = Query(None),
):
    """列出关系"""
    store = _get_store()
    relations = store.list_relations(source=source, target=target)
    return {
        "success": True,
        "action": "list_relations",
        "data": [r.to_dict() for r in relations],
        "total": len(relations),
    }


@router.delete("/relations/{relation_id}")
async def delete_relation(relation_id: str):
    """删除关系"""
    store = _get_store()
    success, err = store.delete_relation(relation_id)
    if not success:
        if "not found" in err:
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "action": "delete_relation",
        "relation_id": relation_id,
    }


# ============================================================
# Observation 端点
# ============================================================

@router.post("/observations")
async def add_observation(req: AddObservationRequest):
    """添加观察"""
    store = _get_store()
    # 校验 source
    if req.source not in [s.value for s in ObservationSource]:
        raise HTTPException(
            status_code=400,
            detail=f"invalid source: {req.source}",
        )
    success, err, obs = store.add_observation(
        entity_name=req.entity_name,
        content=req.content,
        source=req.source,
        confidence=req.confidence,
    )
    if not success:
        if "not found" in err:
            raise HTTPException(status_code=404, detail=err)
        # 质量门控失败
        if "must start with" in err or "secret" in err or "too long" in err:
            raise HTTPException(status_code=422, detail=err)
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "action": "add_observation",
        "data": obs.to_dict(),
    }


@router.delete("/observations/{observation_id}")
async def delete_observation(observation_id: str):
    """删除观察"""
    store = _get_store()
    success, err = store.delete_observation(observation_id)
    if not success:
        if "not found" in err:
            raise HTTPException(status_code=404, detail=err)
        raise HTTPException(status_code=400, detail=err)
    return {
        "success": True,
        "action": "delete_observation",
        "observation_id": observation_id,
    }


# ============================================================
# Search & Graph 端点
# ============================================================

@router.get("/search")
async def search_memory(
    q: str = Query(..., min_length=1, max_length=500),
    limit: int = Query(10, ge=1, le=50),
):
    """关键词搜索"""
    store = _get_store()
    results = store.search(q, limit=limit)
    return {
        "success": True,
        "action": "search",
        "data": results,
        "total": len(results),
        "query": q,
        "source": "mcp",
    }


@router.get("/graph")
async def get_graph():
    """获取整个图谱"""
    store = _get_store()
    return {
        "success": True,
        "action": "get_graph",
        "data": store.get_graph(),
    }


# ============================================================
# Skill 端点
# ============================================================

@router.post("/skill/memory-kernel")
async def memory_kernel_skill(req: MemoryKernelRequest):
    """
    memory-kernel skill 统一接口
    支持 action: read / write / update / delete
    """
    store = _get_store()
    action = req.action.lower()

    if action == "read":
        if not req.query:
            raise HTTPException(status_code=400, detail="query is required for read")
        results = store.search(req.query, limit=10)
        return {
            "success": True,
            "action": "memory_kernel_read",
            "data": results,
        }

    elif action == "write":
        if not req.name or not req.entity_type:
            raise HTTPException(
                status_code=400,
                detail="name and entity_type are required for write",
            )
        if req.observations is None:
            req.observations = []
        # 写入实体
        entity = MemoryEntity(
            name=req.name,
            entity_type=req.entity_type,
            project=req.project or "_global",
            metadata=req.metadata or {},
        )
        success, err = store.create_entity(entity)
        if not success:
            if "already exists" in err:
                raise HTTPException(status_code=409, detail=err)
            raise HTTPException(status_code=400, detail=err)
        # 添加 observations
        added = []
        for obs_content in req.observations:
            ok, e, obs = store.add_observation(req.name, obs_content)
            if ok:
                added.append(obs.to_dict())
        return {
            "success": True,
            "action": "memory_kernel_write",
            "data": _entity_to_response(entity, store),
            "observations_added": len(added),
        }

    elif action == "update":
        if not req.name or req.observations is None:
            raise HTTPException(
                status_code=400,
                detail="name and observations are required for update",
            )
        added = []
        for obs_content in req.observations:
            ok, e, obs = store.add_observation(req.name, obs_content)
            if ok:
                added.append(obs.to_dict())
        return {
            "success": True,
            "action": "memory_kernel_update",
            "name": req.name,
            "observations_added": len(added),
        }

    elif action == "delete":
        if not req.name:
            raise HTTPException(status_code=400, detail="name is required for delete")
        success, err = store.delete_entity(req.name, force=req.force)
        if not success:
            if "not found" in err:
                raise HTTPException(status_code=404, detail=err)
            if "public-protected" in err:
                raise HTTPException(status_code=403, detail=err)
            raise HTTPException(status_code=400, detail=err)
        return {
            "success": True,
            "action": "memory_kernel_delete",
            "name": req.name,
        }

    else:
        raise HTTPException(
            status_code=400,
            detail=f"invalid action: {req.action}. Must be read/write/update/delete",
        )


@router.post("/skill/self-improvement")
async def self_improvement_skill(req: SelfImprovementRequest):
    """
    self-improvement skill - 自动学习晋升
    当错误出现 ≥ 3 次且解决方案已验证时，晋升为 pattern 实体
    """
    store = _get_store()
    from datetime import datetime, timezone

    # 检查发生频率
    if req.occurrences < 3:
        return {
            "success": True,
            "action": "self_improvement",
            "promoted": False,
            "reason": f"occurrences ({req.occurrences}) < threshold (3)",
        }

    if not req.verified:
        return {
            "success": True,
            "action": "self_improvement",
            "promoted": False,
            "reason": "solution not verified yet",
        }

    # 创建或更新 pattern 实体
    pattern_name = f"pattern_{req.error_type.replace(' ', '_').lower()}"
    entity = store.get_entity(pattern_name)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    obs_content = f"[{today}] {req.summary}"

    if entity:
        # 追加 observation
        success, err, obs = store.add_observation(pattern_name, obs_content)
        return {
            "success": success,
            "action": "self_improvement_update",
            "pattern_name": pattern_name,
            "observation_id": obs.id if obs else None,
            "error": err if not success else None,
            "promoted": success,
        }
    else:
        # 创建新实体
        new_entity = MemoryEntity(
            name=pattern_name,
            entity_type="pattern",
            project="_global",
        )
        success, err = store.create_entity(new_entity)
        if not success:
            return {
                "success": False,
                "action": "self_improvement_create",
                "error": err,
                "promoted": False,
            }
        # 添加 observation
        store.add_observation(pattern_name, obs_content)
        return {
            "success": True,
            "action": "self_improvement_create",
            "pattern_name": pattern_name,
            "promoted": True,
        }


@router.post("/skill/memory-recall")
async def memory_recall_skill(req: MemoryRecallRequest):
    """
    memory-recall skill - 跨会话记忆检索
    用于在任务开始时自动回忆相关上下文
    """
    store = _get_store()
    results = store.search(req.query, limit=req.limit)
    return {
        "success": True,
        "action": "memory_recall",
        "query": req.query,
        "results": results,
        "total": len(results),
        "source": "mcp",
    }


# ============================================================
# Health & Stats
# ============================================================

@router.get("/health")
async def memory_health():
    """健康检查"""
    store = _get_store()
    return {
        "success": True,
        "action": "health",
        "service": "memory",
        "version": "1.0.0",
        "memory_dir": str(store.memory_dir),
    }


@router.get("/stats")
async def memory_stats():
    """统计信息"""
    store = _get_store()
    return {
        "success": True,
        "action": "stats",
        "data": store.get_stats(),
    }
