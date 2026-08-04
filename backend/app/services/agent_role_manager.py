"""
# ============================================================
# AgentRoleManager 服务 (v1.0.0)
# Cycle 63 G63-02
# ============================================================
# 核心作用：管理 Agent 角色（registry + instance lifecycle）
# 运行流程：
#   1. 启动时加载 4 个内置角色（default/worker/explorer/monitor）
#   2. 用户可通过 TOML 或 REST API 注册自定义角色
#   3. 任务发起者 spawn 实例，选择角色和任务
#   4. 实例在内部状态机中跟踪（spawning/running/idle/failed/dead）
#   5. 取消实例时强制终止
# 设计要点：
#   - 角色级模型/沙箱/MCP 覆盖
#   - 每角色并发上限 10
#   - 失败隔离（单实例失败不影响其他）
#   - 角色名正则校验
# 输入参数：角色定义、实例 spawn 请求
# 输出结果：角色 / 实例数据
# 对标：Codex CLI v0.105+ sub-agent 系统
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 63 G63-02 初次创建
# ====================================
"""

import json
import logging
import re
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from .agent_role_models import (
    AgentInstance,
    AgentRole,
    ROLE_NAME_PATTERN,
)

logger = logging.getLogger(__name__)


# ============================================================
# 异常类型
# ============================================================


class AgentRoleError(Exception):
    """角色管理基础异常"""
    pass


class RoleNotFoundError(AgentRoleError):
    pass


class RoleAlreadyExistsError(AgentRoleError):
    pass


class RoleValidationError(AgentRoleError):
    pass


class AgentInstanceNotFoundError(AgentRoleError):
    pass


class ConcurrencyLimitError(AgentRoleError):
    pass


# ============================================================
# 内置角色
# ============================================================


BUILTIN_ROLES: List[Dict[str, Any]] = [
    {
        "name": "default",
        "description": "通用默认角色，无特殊覆盖",
        "developer_instructions": "You are a helpful AI assistant.",
        "nickname_candidates": ["Atlas", "Delta", "Echo", "Nova"],
        "model": None,
        "model_reasoning_effort": None,
        "sandbox_mode": "workspace-write",
        "mcp_servers": [],
        "skills": [],
    },
    {
        "name": "worker",
        "description": "编码执行者，专注实施任务",
        "developer_instructions": (
            "You are a focused implementation agent. "
            "Execute tasks efficiently and produce working code."
        ),
        "nickname_candidates": ["Builder", "Forge", "Hammer", "Wrench"],
        "model": None,
        "model_reasoning_effort": "medium",
        "sandbox_mode": "workspace-write",
        "mcp_servers": [],
        "skills": ["code-review"],
    },
    {
        "name": "explorer",
        "description": "只读探索者，分析代码但不修改",
        "developer_instructions": (
            "You are a read-only explorer agent. "
            "Analyze code, search files, and answer questions without making changes."
        ),
        "nickname_candidates": ["Scout", "Ranger", "Seeker", "Compass"],
        "model": None,
        "model_reasoning_effort": "high",
        "sandbox_mode": "read-only",
        "mcp_servers": [],
        "skills": ["code-review"],
    },
    {
        "name": "monitor",
        "description": "长任务监控者，支持 polling 1 小时",
        "developer_instructions": (
            "You are a monitoring agent. "
            "Watch long-running processes and report status periodically."
        ),
        "nickname_candidates": ["Sentry", "Watcher", "Sentinel", "Vigil"],
        "model": None,
        "model_reasoning_effort": "low",
        "sandbox_mode": "read-only",
        "mcp_servers": [],
        "skills": [],
    },
]


# ============================================================
# 管理器
# ============================================================


class AgentRoleManager:
    """
    Agent 角色管理器
    - 角色注册表（builtin + custom）
    - 实例生命周期管理
    - TOML 解析
    - 持久化到 JSON
    """

    def __init__(self, storage_dir: Optional[str] = None):
        self._storage_dir = Path(storage_dir) if storage_dir else None
        if self._storage_dir:
            self._storage_dir.mkdir(parents=True, exist_ok=True)

        # 角色注册表
        self._roles: Dict[str, AgentRole] = {}
        # 实例注册表
        self._instances: Dict[str, AgentInstance] = {}
        # 每角色并发计数
        self._role_concurrency: Dict[str, int] = {}

        # 配置
        self._max_concurrency_per_role = 10

        # 加载内置角色
        self._load_builtin_roles()

        # 加载持久化数据
        if self._storage_dir:
            self._load_from_disk()

    # ============================================================
    # 角色管理
    # ============================================================

    def list_roles(self) -> List[AgentRole]:
        """列出所有角色"""
        return sorted(self._roles.values(), key=lambda r: (not r.builtin, r.name))

    def get_role(self, name: str) -> AgentRole:
        """获取角色"""
        if name not in self._roles:
            raise RoleNotFoundError(f"角色不存在: {name}")
        return self._roles[name]

    def register_role(self, role: AgentRole, override: bool = False) -> AgentRole:
        """
        注册角色
        - 内置角色不可覆盖（除非 override=True）
        - 自定义角色同名会覆盖（除非 override=False 显式拒绝）
        """
        if role.name in self._roles and not override:
            existing = self._roles[role.name]
            if existing.builtin:
                raise RoleAlreadyExistsError(
                    f"内置角色不可覆盖: {role.name}（如需覆盖请传 override=True）"
                )
            raise RoleAlreadyExistsError(f"角色已存在: {role.name}（如需覆盖请传 override=True）")
        now = time.time()
        if role.builtin:
            role.created_at = role.created_at or now
        else:
            role.created_at = now
        role.updated_at = now
        self._roles[role.name] = role
        self._role_concurrency.setdefault(role.name, 0)
        self._persist()
        logger.info(f"角色注册成功: name={role.name}, builtin={role.builtin}")
        return role

    def update_role(self, name: str, **updates) -> AgentRole:
        """更新自定义角色（内置角色只允许更新 description / developer_instructions）"""
        if name not in self._roles:
            raise RoleNotFoundError(f"角色不存在: {name}")
        role = self._roles[name]
        # 内置角色只允许更新部分字段
        if role.builtin:
            allowed = {"description", "developer_instructions"}
            for k in updates:
                if k not in allowed:
                    raise RoleValidationError(
                        f"内置角色 {name} 不允许更新字段 {k}（仅允许: {allowed}）"
                    )
        # 应用更新
        for k, v in updates.items():
            if v is not None:
                setattr(role, k, v)
        role.updated_at = time.time()
        self._persist()
        logger.info(f"角色更新成功: name={name}")
        return role

    def delete_role(self, name: str) -> bool:
        """删除自定义角色（内置角色不可删）"""
        if name not in self._roles:
            return False
        role = self._roles[name]
        if role.builtin:
            raise RoleValidationError(f"内置角色不可删除: {name}")
        # 检查是否有运行中实例
        running = [i for i in self._instances.values() if i.role_name == name and i.status in ("spawning", "running", "idle")]
        if running:
            raise ConcurrencyLimitError(
                f"角色 {name} 有 {len(running)} 个运行中实例，无法删除"
            )
        del self._roles[name]
        self._role_concurrency.pop(name, None)
        self._persist()
        logger.info(f"角色删除成功: name={name}")
        return True

    def load_role_from_toml(self, toml_path: str) -> AgentRole:
        """从 TOML 文件加载角色"""
        path = Path(toml_path)
        if not path.exists():
            raise RoleValidationError(f"TOML 文件不存在: {toml_path}")
        try:
            # 轻量级 TOML 解析（避免引入 tomli/tomllib 依赖）
            content = path.read_text(encoding="utf-8")
            data = self._parse_simple_toml(content)
        except Exception as e:  # noqa: BLE001
            raise RoleValidationError(f"TOML 解析失败: {e}") from e

        # 提取 [role] 块
        if "role" not in data:
            raise RoleValidationError("TOML 必须包含 [role] 块")
        role_data = data["role"]
        # 构造 AgentRole
        return AgentRole(**role_data)

    def register_role_from_toml(self, toml_path: str, override: bool = False) -> AgentRole:
        """从 TOML 文件注册角色"""
        role = self.load_role_from_toml(toml_path)
        return self.register_role(role, override=override)

    # ============================================================
    # 实例管理
    # ============================================================

    def spawn_instance(
        self,
        role_name: str,
        task: str,
        nickname: Optional[str] = None,
    ) -> AgentInstance:
        """spawn 一个 Agent 实例"""
        if role_name not in self._roles:
            raise RoleNotFoundError(f"角色不存在: {role_name}")
        role = self._roles[role_name]

        # 并发限制检查
        current = self._role_concurrency.get(role_name, 0)
        if current >= self._max_concurrency_per_role:
            raise ConcurrencyLimitError(
                f"角色 {role_name} 并发数已达上限 {self._max_concurrency_per_role}"
            )

        # 选择 nickname
        if not nickname:
            nickname = self._pick_nickname(role)

        instance = AgentInstance(
            agent_id=f"agent-{uuid.uuid4().hex[:12]}",
            role_name=role_name,
            nickname=nickname,
            status="spawning",
            task=task,
            started_at=time.time(),
        )
        self._instances[instance.agent_id] = instance
        self._role_concurrency[role_name] = current + 1

        # 立即转为 running（mock 同步）
        instance.status = "running"
        self._persist()

        logger.info(
            f"实例 spawn 成功: agent_id={instance.agent_id}, "
            f"role={role_name}, nickname={nickname}"
        )
        return instance

    def list_instances(
        self,
        role_name: Optional[str] = None,
        status: Optional[str] = None,
    ) -> List[AgentInstance]:
        """列出实例（可按 role/status 过滤）"""
        instances = list(self._instances.values())
        if role_name:
            instances = [i for i in instances if i.role_name == role_name]
        if status:
            instances = [i for i in instances if i.status == status]
        return sorted(instances, key=lambda i: i.started_at, reverse=True)

    def get_instance(self, agent_id: str) -> AgentInstance:
        """获取实例详情"""
        if agent_id not in self._instances:
            raise AgentInstanceNotFoundError(f"实例不存在: {agent_id}")
        return self._instances[agent_id]

    def cancel_instance(self, agent_id: str) -> AgentInstance:
        """取消实例"""
        if agent_id not in self._instances:
            raise AgentInstanceNotFoundError(f"实例不存在: {agent_id}")
        instance = self._instances[agent_id]
        if instance.status in ("dead", "failed"):
            return instance
        instance.status = "dead"
        instance.finished_at = time.time()
        instance.error = instance.error or "cancelled by user"
        # 释放并发
        self._role_concurrency[instance.role_name] = max(
            0, self._role_concurrency.get(instance.role_name, 1) - 1
        )
        logger.info(f"实例已取消: agent_id={agent_id}")
        return instance

    def complete_instance(
        self,
        agent_id: str,
        result: str,
        success: bool = True,
    ) -> AgentInstance:
        """标记实例完成（内部方法，由 Agent runner 调用）"""
        if agent_id not in self._instances:
            raise AgentInstanceNotFoundError(f"实例不存在: {agent_id}")
        instance = self._instances[agent_id]
        instance.status = "idle" if success else "failed"
        instance.finished_at = time.time()
        instance.result = result
        if not success:
            instance.error = instance.error or "execution failed"
        self._role_concurrency[instance.role_name] = max(
            0, self._role_concurrency.get(instance.role_name, 1) - 1
        )
        return instance

    # ============================================================
    # 统计
    # ============================================================

    def get_stats(self) -> Dict[str, Any]:
        """统计信息"""
        total_instances = len(self._instances)
        # 只有 spawning/running 算 active（idle 已完成，等待回收）
        running = sum(1 for i in self._instances.values() if i.status in ("spawning", "running"))
        builtin_count = sum(1 for r in self._roles.values() if r.builtin)
        custom_count = len(self._roles) - builtin_count
        return {
            "total_roles": len(self._roles),
            "builtin_roles": builtin_count,
            "custom_roles": custom_count,
            "total_instances": total_instances,
            "running_instances": running,
            "max_concurrency_per_role": self._max_concurrency_per_role,
        }

    # ============================================================
    # 内部方法
    # ============================================================

    def _pick_nickname(self, role: AgentRole) -> str:
        """选择 nickname（确定性，按已使用数轮转）"""
        if not role.nickname_candidates:
            return f"agent-{uuid.uuid4().hex[:6]}"
        used_count = sum(
            1 for i in self._instances.values()
            if i.role_name == role.name and i.nickname in role.nickname_candidates
        )
        idx = used_count % len(role.nickname_candidates)
        return role.nickname_candidates[idx]

    def _load_builtin_roles(self) -> None:
        """加载内置角色"""
        now = time.time()
        for role_data in BUILTIN_ROLES:
            role = AgentRole(
                **role_data,
                builtin=True,
                created_at=now,
                updated_at=now,
            )
            self._roles[role.name] = role
            self._role_concurrency[role.name] = 0

    def _parse_simple_toml(self, content: str) -> Dict[str, Any]:
        """
        轻量级 TOML 解析（仅支持 [section] 和 key = value 形式）
        不支持：嵌套表、复杂数组
        支持：单行/多行字符串（三引号）
        """
        result: Dict[str, Any] = {}
        current_section: Optional[str] = None
        current_dict: Dict[str, Any] = result

        lines = content.splitlines()
        i = 0
        while i < len(lines):
            raw_line = lines[i]
            line_no = i + 1
            line = raw_line.strip()
            i += 1
            # 跳过空行和注释
            if not line or line.startswith("#"):
                continue
            # 节标题
            section_match = re.match(r"^\[([a-zA-Z0-9_]+)\]$", line)
            if section_match:
                current_section = section_match.group(1)
                result.setdefault(current_section, {})
                current_dict = result[current_section]
                continue
            # key = value
            kv_match = re.match(r'^([a-zA-Z0-9_]+)\s*=\s*(.+)$', line)
            if not kv_match:
                raise ValueError(f"无法解析第 {line_no} 行: {raw_line!r}")
            key, value_str = kv_match.group(1), kv_match.group(2).strip()
            # 处理多行字符串开始标记（仅以 """ 开头且独占该位置）
            if value_str == '"""':
                # 多行字符串在下一行开始
                collected = []
                while i < len(lines):
                    next_line = lines[i]
                    i += 1
                    if next_line.rstrip().endswith('"""'):
                        collected.append(next_line.rstrip()[:-3])
                        break
                    collected.append(next_line)
                value_str = "\n".join(collected)
                current_dict[key] = value_str
                continue
            # 处理多行字符串（开闭在同一行，但跨多行）
            if value_str.startswith('"""') and value_str != '"""' and value_str.endswith('"""'):
                current_dict[key] = value_str[3:-3]
                continue
            if value_str.startswith('"""') and not value_str.endswith('"""'):
                # 多行字符串开始（开头在同一行）
                collected = [value_str[3:]]
                while i < len(lines):
                    next_line = lines[i]
                    i += 1
                    if next_line.rstrip().endswith('"""'):
                        collected.append(next_line.rstrip()[:-3])
                        break
                    collected.append(next_line)
                value_str = "\n".join(collected)
                current_dict[key] = value_str
                continue
            current_dict[key] = self._parse_toml_value(value_str, line_no)
        return result

    def _parse_toml_value(self, value_str: str, line_no: int) -> Any:
        """解析 TOML 值"""
        # 字符串
        if (value_str.startswith('"""') and value_str.endswith('"""')) or \
           (value_str.startswith("'''") and value_str.endswith("'''")):
            return value_str[3:-3]
        if value_str.startswith('"') and value_str.endswith('"'):
            return value_str[1:-1]
        if value_str.startswith("'") and value_str.endswith("'"):
            return value_str[1:-1]
        # 布尔
        if value_str == "true":
            return True
        if value_str == "false":
            return False
        # 数字
        try:
            if "." in value_str:
                return float(value_str)
            return int(value_str)
        except ValueError:
            pass
        # 数组（单行）
        if value_str.startswith("[") and value_str.endswith("]"):
            inner = value_str[1:-1].strip()
            if not inner:
                return []
            items = []
            # 简单分割（不含嵌套）
            for item in inner.split(","):
                items.append(self._parse_toml_value(item.strip(), line_no))
            return items
        raise ValueError(f"无法解析第 {line_no} 行的值: {value_str!r}")

    def _persist(self) -> None:
        """持久化到磁盘"""
        if not self._storage_dir:
            return
        data = {
            "roles": {
                name: role.model_dump()
                for name, role in self._roles.items()
                if not role.builtin  # 只持久化自定义角色
            },
            "instances": {
                aid: inst.model_dump()
                for aid, inst in self._instances.items()
            },
        }
        file_path = self._storage_dir / "agent_roles.json"
        with open(file_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load_from_disk(self) -> None:
        """从磁盘加载"""
        if not self._storage_dir or not self._storage_dir.exists():
            return
        file_path = self._storage_dir / "agent_roles.json"
        if not file_path.exists():
            return
        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:  # noqa: BLE001
            logger.warning(f"加载 agent roles 失败: {e}")
            return
        # 加载自定义角色
        for name, role_data in data.get("roles", {}).items():
            try:
                self._roles[name] = AgentRole(**role_data)
                self._role_concurrency.setdefault(name, 0)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"加载角色 {name} 失败: {e}")
        # 加载实例
        for aid, inst_data in data.get("instances", {}).items():
            try:
                self._instances[aid] = AgentInstance(**inst_data)
            except Exception as e:  # noqa: BLE001
                logger.warning(f"加载实例 {aid} 失败: {e}")


# ============================================================
# 全局单例
# ============================================================


_manager: Optional[AgentRoleManager] = None


def get_agent_role_manager(storage_dir: Optional[str] = None) -> AgentRoleManager:
    """获取 AgentRoleManager 单例"""
    global _manager
    if _manager is None:
        _manager = AgentRoleManager(storage_dir=storage_dir)
    return _manager


def reset_agent_role_manager() -> None:
    """重置 AgentRoleManager（用于测试）"""
    global _manager
    _manager = None
