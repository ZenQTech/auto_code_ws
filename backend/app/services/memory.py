"""
# ============================================================
# Hermes Memory System - Dual-Track Persistent Memory (v1.0.0)
# ============================================================
# 核心作用：智能体长期记忆系统，实现 TRAE Global Memory 风格的双轨记忆
#           1) Core Memory: 会话级 Key-value observations
#           2) MCP Memory: 跨会话 Knowledge Graph (entities + relations)
# 运行流程：
#   1. 启动时从 JSONL 文件加载 MCP Memory
#   2. Core Memory 通过 SQLAlchemy 存储在 SQLite
#   3. memory-kernel skill 提供 R/W/U 协议
#   4. self-improvement skill 自动从错误解决中学习
#   5. Memory Router Step 0 优先查询 MCP → 降级 Core
# 输入参数：
#   - memory_dir: JSONL 存储目录，默认 ~/.hermes/memory/
#   - session_factory: SQLAlchemy session 工厂
# 输出结果：完整的 Memory Service 实例
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 10 P1-8 新建 - Dual-Track Persistent Memory
# ============================================================
"""

import json
import logging
import os
import re
import threading
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# ============================================================
# 常量与枚举
# ============================================================

# 命名规范：snake_case，以小写字母开头
NAME_PATTERN = re.compile(r"^[a-z][a-z0-9_]{2,127}$")
# public_ 前缀：受保护实体
PUBLIC_PREFIX = "public_"
# 默认存储路径
DEFAULT_MEMORY_DIR = Path.home() / ".hermes" / "memory"
# 文件名
ENTITIES_FILE = "entities.jsonl"
RELATIONS_FILE = "relations.jsonl"
OBSERVATIONS_FILE = "observations.jsonl"
# 质量门控：禁止的内容模式
SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|password|token|credential)\s*[:=]\s*\S+"),
    re.compile(r"sk-[a-zA-Z0-9]{20,}"),  # OpenAI API key
    re.compile(r"ghp_[a-zA-Z0-9]{30,}"),  # GitHub PAT
    re.compile(r"AKIA[0-9A-Z]{16}"),  # AWS Access Key
]
# Observation 格式
OBSERVATION_DATE_PATTERN = re.compile(r"^\[(\d{4}-\d{2}-\d{2})\]\s+(.+)$")
# self-improvement 阈值
ERROR_OCCURRENCE_THRESHOLD = 3
# Core Memory 默认容量
DEFAULT_CORE_MEMORY_CAPACITY = 20


class EntityType(str, Enum):
    """实体类型"""
    PROJECT = "project"  # 项目（架构、技术栈）
    PATTERN = "pattern"  # 模式（可复用解决方案）
    PREFERENCE = "preference"  # 偏好（用户风格）
    PROFILE = "profile"  # 档案（用户身份）
    FACT = "fact"  # 事实（其他）


class RelationType(str, Enum):
    """关系类型"""
    DEPENDS_ON = "depends_on"
    USES = "uses"
    SOLVES = "solves"
    CONFLICTS = "conflicts"
    EXTENDS = "extends"
    RELATED_TO = "related_to"


class ObservationSource(str, Enum):
    """Observation 来源"""
    USER = "user"
    AGENT = "agent"
    SYSTEM = "system"


# ============================================================
# 数据类
# ============================================================

@dataclass
class MemoryEntity:
    """记忆实体（跨会话）"""
    name: str
    entity_type: str
    project: str = "_global"
    metadata: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()
        if not self.updated_at:
            self.updated_at = self.created_at

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MemoryRelation:
    """实体关系"""
    id: str
    source: str
    target: str
    relation_type: str
    weight: float = 1.0
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()
        if not self.id:
            self.id = f"rel_{uuid.uuid4().hex[:12]}"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class MemoryObservation:
    """观察记录（追加式）"""
    id: str
    entity_name: str
    content: str
    source: str = "agent"
    confidence: float = 1.0
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()
        if not self.id:
            self.id = f"obs_{uuid.uuid4().hex[:12]}"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CoreMemoryEntry:
    """会话级 Core Memory"""
    session_id: str
    key: str
    value: str
    scope: str = "session"  # session / agent / workflow
    expires_at: Optional[str] = None
    created_at: str = ""

    def __post_init__(self):
        if not self.created_at:
            self.created_at = _now_iso()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 工具函数
# ============================================================

def _now_iso() -> str:
    """当前时间 ISO 格式（微秒精度）"""
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def _validate_name(name: str) -> Tuple[bool, str]:
    """校验命名规范"""
    if not name or not isinstance(name, str):
        return False, "name must be a non-empty string"
    if len(name) < 3 or len(name) > 128:
        return False, "name length must be 3-128"
    if not NAME_PATTERN.match(name):
        return False, "name must match ^[a-z][a-z0-9_]{2,127}$"
    return True, ""


def _validate_observation(content: str) -> Tuple[bool, str]:
    """校验 observation 格式：[YYYY-MM-DD] xxx"""
    if not content or not isinstance(content, str):
        return False, "content must be a non-empty string"
    if len(content) > 500:
        return False, "content too long (max 500 chars)"
    if not OBSERVATION_DATE_PATTERN.match(content):
        return False, "content must start with [YYYY-MM-DD]"
    return True, ""


def _check_secrets(content: str) -> Tuple[bool, str]:
    """检查内容是否包含 secrets"""
    for pattern in SECRET_PATTERNS:
        if pattern.search(content):
            return False, f"content contains potential secret matching {pattern.pattern}"
    return True, ""


# ============================================================
# MCP Memory Store（JSONL 持久化 + 内存索引）
# ============================================================

class MCPMemoryStore:
    """
    MCP Memory Store - 跨会话持久化知识图谱
    存储：3 个 JSONL 文件
      - entities.jsonl: 实体定义
      - relations.jsonl: 实体关系
      - observations.jsonl: 观察记录
    索引：内存中的 4 个字典
      - _entities: name -> MemoryEntity
      - _by_type: entity_type -> set of names
      - _by_project: project -> set of names
      - _relations: list of MemoryRelation
      - _observations: entity_name -> list of MemoryObservation
    线程安全：所有 mutation 通过 RLock 保护
    """

    def __init__(self, memory_dir: Optional[Path] = None):
        """
        初始化 MCP Memory Store
        参数：
          - memory_dir: JSONL 存储目录，默认 ~/.hermes/memory/
        """
        self.memory_dir = Path(memory_dir) if memory_dir else DEFAULT_MEMORY_DIR
        self.memory_dir.mkdir(parents=True, exist_ok=True)

        # 内存索引
        self._entities: Dict[str, MemoryEntity] = {}
        self._by_type: Dict[str, Set[str]] = {}
        self._by_project: Dict[str, Set[str]] = {}
        self._relations: List[MemoryRelation] = []
        self._observations: Dict[str, List[MemoryObservation]] = {}

        # 线程安全
        self._lock = threading.RLock()

        # 启动时加载
        self._load_all()
        logger.info(f"MCPMemoryStore initialized at {self.memory_dir} "
                    f"({len(self._entities)} entities, {len(self._relations)} relations)")

    # ---------- 加载与保存 ----------

    def _load_all(self) -> None:
        """从 JSONL 加载所有数据"""
        self._load_entities()
        self._load_relations()
        self._load_observations()

    def _load_entities(self) -> None:
        """加载 entities.jsonl"""
        path = self.memory_dir / ENTITIES_FILE
        if not path.exists():
            return
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    entity = MemoryEntity(
                        name=data["name"],
                        entity_type=data["entity_type"],
                        project=data.get("project", "_global"),
                        metadata=data.get("metadata", {}),
                        created_at=data.get("created_at", ""),
                        updated_at=data.get("updated_at", ""),
                    )
                    self._entities[entity.name] = entity
                    self._by_type.setdefault(entity.entity_type, set()).add(entity.name)
                    self._by_project.setdefault(entity.project, set()).add(entity.name)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"Skipping malformed entity line: {e}")

    def _load_relations(self) -> None:
        """加载 relations.jsonl"""
        path = self.memory_dir / RELATIONS_FILE
        if not path.exists():
            return
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    rel = MemoryRelation(
                        id=data["id"],
                        source=data["source"],
                        target=data["target"],
                        relation_type=data["relation_type"],
                        weight=data.get("weight", 1.0),
                        created_at=data.get("created_at", ""),
                    )
                    self._relations.append(rel)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"Skipping malformed relation line: {e}")

    def _load_observations(self) -> None:
        """加载 observations.jsonl"""
        path = self.memory_dir / OBSERVATIONS_FILE
        if not path.exists():
            return
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    obs = MemoryObservation(
                        id=data["id"],
                        entity_name=data["entity_name"],
                        content=data["content"],
                        source=data.get("source", "agent"),
                        confidence=data.get("confidence", 1.0),
                        created_at=data.get("created_at", ""),
                    )
                    self._observations.setdefault(obs.entity_name, []).append(obs)
                except (json.JSONDecodeError, KeyError) as e:
                    logger.warning(f"Skipping malformed observation line: {e}")

    def _save_entity(self, entity: MemoryEntity) -> None:
        """原子写入实体（追加模式）"""
        path = self.memory_dir / ENTITIES_FILE
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(entity.to_dict(), ensure_ascii=False) + "\n")

    def _save_relation(self, relation: MemoryRelation) -> None:
        """原子写入关系"""
        path = self.memory_dir / RELATIONS_FILE
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(relation.to_dict(), ensure_ascii=False) + "\n")

    def _save_observation(self, observation: MemoryObservation) -> None:
        """原子写入观察"""
        path = self.memory_dir / OBSERVATIONS_FILE
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(observation.to_dict(), ensure_ascii=False) + "\n")

    def _rewrite_entity(self, entity: MemoryEntity) -> None:
        """重写实体（更新时使用）"""
        # 简化实现：删除原行 + 追加新行
        # 实际生产环境应使用更复杂的合并策略
        path = self.memory_dir / ENTITIES_FILE
        if not path.exists():
            return
        lines = []
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    try:
                        data = json.loads(line)
                        if data.get("name") != entity.name:
                            lines.append(line.rstrip("\n"))
                    except json.JSONDecodeError:
                        continue
        lines.append(json.dumps(entity.to_dict(), ensure_ascii=False))
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")

    # ---------- Entity CRUD ----------

    def create_entity(self, entity: MemoryEntity) -> Tuple[bool, str]:
        """
        创建实体
        返回：(success, error_message)
        """
        with self._lock:
            # 校验
            valid, err = _validate_name(entity.name)
            if not valid:
                return False, err

            # 检查重复
            if entity.name in self._entities:
                return False, f"entity '{entity.name}' already exists"

            # 校验 entity_type
            if entity.entity_type not in [e.value for e in EntityType]:
                return False, f"invalid entity_type: {entity.entity_type}"

            # 保存
            self._entities[entity.name] = entity
            self._by_type.setdefault(entity.entity_type, set()).add(entity.name)
            self._by_project.setdefault(entity.project, set()).add(entity.name)
            self._save_entity(entity)
            logger.info(f"Created entity: {entity.name} (type={entity.entity_type}, project={entity.project})")
            return True, ""

    def get_entity(self, name: str) -> Optional[MemoryEntity]:
        """查询实体"""
        with self._lock:
            return self._entities.get(name)

    def list_entities(
        self,
        entity_type: Optional[str] = None,
        project: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[MemoryEntity]:
        """
        列出实体
        参数：
          - entity_type: 按类型过滤
          - project: 按项目过滤
          - limit: 最大数量
        """
        with self._lock:
            if entity_type and project:
                names = (self._by_type.get(entity_type, set()) &
                         self._by_project.get(project, set()))
            elif entity_type:
                names = self._by_type.get(entity_type, set())
            elif project:
                names = self._by_project.get(project, set())
            else:
                names = set(self._entities.keys())

            result = [self._entities[n] for n in names if n in self._entities]
            result.sort(key=lambda e: e.updated_at, reverse=True)
            if limit:
                result = result[:limit]
            return result

    def update_entity(
        self,
        name: str,
        entity_type: Optional[str] = None,
        project: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Tuple[bool, str]:
        """更新实体元数据（不修改 observations）"""
        with self._lock:
            entity = self._entities.get(name)
            if not entity:
                return False, f"entity '{name}' not found"

            old_type = entity.entity_type
            old_project = entity.project

            if entity_type is not None:
                entity.entity_type = entity_type
            if project is not None:
                entity.project = project
            if metadata is not None:
                entity.metadata = metadata
            entity.updated_at = _now_iso()

            # 更新索引
            if entity_type is not None and entity_type != old_type:
                self._by_type.get(old_type, set()).discard(name)
                self._by_type.setdefault(entity_type, set()).add(name)
            if project is not None and project != old_project:
                self._by_project.get(old_project, set()).discard(name)
                self._by_project.setdefault(project, set()).add(name)

            self._rewrite_entity(entity)
            return True, ""

    def delete_entity(self, name: str, force: bool = False) -> Tuple[bool, str]:
        """
        删除实体
        参数：
          - name: 实体名
          - force: 是否强制（跳过 public_ 保护）
        返回：(success, error_message)
        """
        with self._lock:
            if name not in self._entities:
                return False, f"entity '{name}' not found"

            # public_ 保护
            if name.startswith(PUBLIC_PREFIX) and not force:
                return False, f"entity '{name}' is public-protected (starts with '{PUBLIC_PREFIX}')"

            entity = self._entities.pop(name)
            self._by_type.get(entity.entity_type, set()).discard(name)
            self._by_project.get(entity.project, set()).discard(name)

            # 删除关联的 observations
            if name in self._observations:
                del self._observations[name]

            # 删除关联的 relations
            self._relations = [
                r for r in self._relations
                if r.source != name and r.target != name
            ]

            # 物理删除（重写文件）
            self._delete_entity_from_disk(name)
            self._delete_relations_for_entity(name)
            self._delete_observations_for_entity(name)

            logger.info(f"Deleted entity: {name}")
            return True, ""

    def _delete_entity_from_disk(self, name: str) -> None:
        """从磁盘删除实体行"""
        path = self.memory_dir / ENTITIES_FILE
        if not path.exists():
            return
        self._filter_file(path, lambda d: d.get("name") != name)

    def _delete_relations_for_entity(self, name: str) -> None:
        """从磁盘删除涉及该实体的关系"""
        path = self.memory_dir / RELATIONS_FILE
        if not path.exists():
            return
        self._filter_file(path, lambda d: d.get("source") != name and d.get("target") != name)

    def _delete_observations_for_entity(self, name: str) -> None:
        """从磁盘删除涉及该实体的观察"""
        path = self.memory_dir / OBSERVATIONS_FILE
        if not path.exists():
            return
        self._filter_file(path, lambda d: d.get("entity_name") != name)

    def _filter_file(self, path: Path, predicate) -> None:
        """过滤 JSONL 文件（重写）"""
        lines = []
        if path.exists():
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        try:
                            data = json.loads(line)
                            if predicate(data):
                                lines.append(line.rstrip("\n"))
                        except json.JSONDecodeError:
                            continue
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + ("\n" if lines else ""))

    # ---------- Relations ----------

    def create_relation(
        self,
        source: str,
        target: str,
        relation_type: str,
        weight: float = 1.0,
    ) -> Tuple[bool, str, Optional[MemoryRelation]]:
        """创建关系"""
        with self._lock:
            if source not in self._entities:
                return False, f"source entity '{source}' not found", None
            if target not in self._entities:
                return False, f"target entity '{target}' not found", None
            if relation_type not in [r.value for r in RelationType]:
                return False, f"invalid relation_type: {relation_type}", None

            relation = MemoryRelation(
                id="",
                source=source,
                target=target,
                relation_type=relation_type,
                weight=weight,
            )
            self._relations.append(relation)
            self._save_relation(relation)
            return True, "", relation

    def list_relations(
        self, source: Optional[str] = None, target: Optional[str] = None
    ) -> List[MemoryRelation]:
        """列出关系"""
        with self._lock:
            result = self._relations
            if source:
                result = [r for r in result if r.source == source]
            if target:
                result = [r for r in result if r.target == target]
            return result

    def delete_relation(self, relation_id: str) -> Tuple[bool, str]:
        """删除关系"""
        with self._lock:
            initial_count = len(self._relations)
            self._relations = [r for r in self._relations if r.id != relation_id]
            if len(self._relations) == initial_count:
                return False, f"relation '{relation_id}' not found"

            # 物理删除
            path = self.memory_dir / RELATIONS_FILE
            self._filter_file(path, lambda d: d.get("id") != relation_id)
            return True, ""

    # ---------- Observations ----------

    def add_observation(
        self,
        entity_name: str,
        content: str,
        source: str = "agent",
        confidence: float = 1.0,
    ) -> Tuple[bool, str, Optional[MemoryObservation]]:
        """添加观察"""
        with self._lock:
            # 校验实体存在
            if entity_name not in self._entities:
                return False, f"entity '{entity_name}' not found", None

            # 校验内容
            valid, err = _validate_observation(content)
            if not valid:
                return False, err, None

            # 检查 secrets
            secret_free, err = _check_secrets(content)
            if not secret_free:
                return False, err, None

            obs = MemoryObservation(
                id="",
                entity_name=entity_name,
                content=content,
                source=source,
                confidence=confidence,
            )
            self._observations.setdefault(entity_name, []).append(obs)
            self._save_observation(obs)

            # 更新实体 updated_at
            entity = self._entities[entity_name]
            entity.updated_at = _now_iso()
            self._rewrite_entity(entity)

            return True, "", obs

    def get_observations(self, entity_name: str) -> List[MemoryObservation]:
        """获取实体的所有观察"""
        with self._lock:
            return list(self._observations.get(entity_name, []))

    def delete_observation(self, observation_id: str) -> Tuple[bool, str]:
        """删除观察"""
        with self._lock:
            for entity_name, obs_list in self._observations.items():
                for i, obs in enumerate(obs_list):
                    if obs.id == observation_id:
                        obs_list.pop(i)
                        # 物理删除
                        path = self.memory_dir / OBSERVATIONS_FILE
                        self._filter_file(path, lambda d: d.get("id") != observation_id)
                        return True, ""
            return False, f"observation '{observation_id}' not found"

    # ---------- Search ----------

    def search(self, query: str, limit: int = 10) -> List[Dict[str, Any]]:
        """
        关键词搜索
        返回：匹配实体列表（按相关性排序）
        """
        with self._lock:
            if not query or not query.strip():
                return []

            keywords = query.lower().split()
            results = []

            for entity in self._entities.values():
                score = 0.0

                # 名称匹配（高权重）
                for kw in keywords:
                    if kw in entity.name.lower():
                        score += 3.0
                    if kw in entity.entity_type.lower():
                        score += 1.0
                    if kw in entity.project.lower():
                        score += 0.5

                # observation 匹配
                for obs in self._observations.get(entity.name, []):
                    for kw in keywords:
                        if kw in obs.content.lower():
                            score += 1.5 * obs.confidence

                if score > 0:
                    results.append({
                        "entity": entity.to_dict(),
                        "score": score,
                        "observations": [o.to_dict() for o in self._observations.get(entity.name, [])[:5]],
                    })

            # 按相关性排序
            results.sort(key=lambda r: r["score"], reverse=True)
            return results[:limit]

    def get_graph(self) -> Dict[str, Any]:
        """获取整个图谱"""
        with self._lock:
            return {
                "entities": [e.to_dict() for e in self._entities.values()],
                "relations": [r.to_dict() for r in self._relations],
                "observations": [
                    o.to_dict()
                    for obs_list in self._observations.values()
                    for o in obs_list
                ],
            }

    def get_stats(self) -> Dict[str, Any]:
        """获取统计信息"""
        with self._lock:
            return {
                "total_entities": len(self._entities),
                "total_relations": len(self._relations),
                "total_observations": sum(
                    len(obs) for obs in self._observations.values()
                ),
                "by_type": {
                    t: len(names) for t, names in self._by_type.items()
                },
                "by_project": {
                    p: len(names) for p, names in self._by_project.items()
                },
                "memory_dir": str(self.memory_dir),
            }


# ============================================================
# 内存中的单例（避免重复加载）
# ============================================================

_mcp_store_instance: Optional[MCPMemoryStore] = None
_mcp_lock = threading.Lock()


def get_mcp_memory_store(memory_dir: Optional[Path] = None) -> MCPMemoryStore:
    """获取全局 MCP Memory Store 单例"""
    global _mcp_store_instance
    with _mcp_lock:
        if _mcp_store_instance is None:
            _mcp_store_instance = MCPMemoryStore(memory_dir)
        return _mcp_store_instance


def reset_mcp_memory_store() -> None:
    """重置全局单例（用于测试）"""
    global _mcp_store_instance
    with _mcp_lock:
        _mcp_store_instance = None
