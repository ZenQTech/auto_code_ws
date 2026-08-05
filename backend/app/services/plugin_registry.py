"""
# ============================================================
# Plugin Registry - 本地 Plugin 注册表 (v1.0.0)
# Cycle 70 G70-01 - 对标 Codex CLI Plugins 本地安装
# ============================================================
# 核心作用：管理本地 plugin 的安装、依赖追踪、启用/禁用
# 设计要点：
#   1. 本地安装：从 zip / 本地目录安装
#   2. plugin.toml 解析：声明元数据 + 依赖 + 包含的 skills/mcp/agents
#   3. 依赖追踪：记录 dependencies 列表（不做实际解析）
#   4. 启用/禁用：影响加载
#   5. 路径沙箱：仅允许 ~/.hermes/plugins/
#   6. 审计日志
# 运行流程：
#   安装 → 解析 plugin.toml → 注册 → 启用/禁用
# 输入参数：plugin source (zip / path)
# 输出结果：Plugin 实例
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
# ============================================================
"""

import io
import json
import logging
import re
import shutil
import threading
import uuid
import zipfile
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# tomllib is Python 3.11+; for 3.10 compatibility use tomli or fallback
try:
    import tomllib  # type: ignore
except ImportError:
    try:
        import tomli as tomllib  # type: ignore
    except ImportError:
        tomllib = None  # type: ignore  # Will raise in parser if used

logger = logging.getLogger(__name__)


# ============================================================
# 常量
# ============================================================

# Plugin 安装根目录
PLUGINS_ROOT = Path("~/.hermes/plugins").expanduser()

# Plugin 元数据文件名
PLUGIN_TOML = "plugin.toml"

# 单个 plugin zip 大小上限（10 MB）
MAX_ZIP_SIZE = 10 * 1024 * 1024

# Plugin 总数上限
MAX_PLUGINS = 100

# name 验证正则
PLUGIN_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,62}[a-z0-9]$")

# 审计日志路径
AUDIT_LOG_PATH = Path("~/.hermes/plugin_audit.jsonl").expanduser()

# plugin 配置文件
REGISTRY_PATH = Path("~/.hermes/config/plugins.json").expanduser()


# ============================================================
# 工具函数
# ============================================================

def _check_zip_safety(zip_bytes: bytes) -> bool:
    """模块级 zip 安全性检查

    参数：
      - zip_bytes: zip 文件字节
    返回值：True 表示安全
    """
    if len(zip_bytes) > MAX_ZIP_SIZE:
        return False
    try:
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            for name in zf.namelist():
                if ".." in name or name.startswith("/"):
                    return False
                if Path(name).is_absolute():
                    return False
        return True
    except (zipfile.BadZipFile, OSError):
        return False


# 兼容旧 API 名称（_is_safe_zip）
_is_safe_zip = _check_zip_safety


# ============================================================
# 数据模型
# ============================================================

@dataclass
class PluginDependency:
    """Plugin 依赖"""
    name: str
    version_spec: str  # e.g. ">=1.0.0"
    installed: bool = False
    installed_version: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class Plugin:
    """Plugin 完整模型

    字段：
      - id: 唯一标识
      - name: 名称
      - version: 版本
      - description: 描述
      - enabled: 是否启用
      - source: 来源（local/marketplace）
      - install_path: 安装绝对路径
      - dependencies: 依赖列表
      - skills: 包含的 skills 名称列表
      - mcp_servers: 包含的 mcp server 名称列表
      - agents: 包含的 agents 名称列表
      - installed_at: 安装时间
      - plugin_toml_path: plugin.toml 绝对路径
    """
    id: str
    name: str
    version: str
    description: str
    enabled: bool = True
    source: str = "local"
    install_path: str = ""
    dependencies: List[PluginDependency] = field(default_factory=list)
    skills: List[str] = field(default_factory=list)
    mcp_servers: List[str] = field(default_factory=list)
    agents: List[str] = field(default_factory=list)
    installed_at: str = ""
    plugin_toml_path: str = ""

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["dependencies"] = [dep.to_dict() for dep in self.dependencies]
        return d


# ============================================================
# plugin.toml 解析
# ============================================================

def _parse_plugin_toml(content: str) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """解析 plugin.toml 内容

    期望的格式：
      [plugin]
      name = "my-plugin"
      version = "1.0.0"
      description = "..."

      [dependencies]
      mcp-github = ">=1.0.0"

      [contents]
      skills = ["skill-a", "skill-b"]
      mcp_servers = ["github"]
      agents = ["reviewer"]

    参数：
      - content: TOML 内容
    返回值：(parsed_dict, errors)
      - parsed_dict: 解析后的字典（即使有错误也返回，调用方可检查）
      - errors: 错误信息列表
    """
    errors: List[str] = []
    if tomllib is None:
        return None, ["TOML 解析器不可用（需要 Python 3.11+ 或安装 tomli）"]
    try:
        data = tomllib.loads(content)
    except (ValueError, TypeError) as e:
        return None, [f"TOML 解析失败: {e}"]

    if not isinstance(data, dict):
        return None, ["TOML 内容必须是字典类型"]

    if "plugin" not in data:
        errors.append("缺少 [plugin] 段")
        return data, errors

    plugin = data["plugin"]
    if not isinstance(plugin, dict):
        errors.append("[plugin] 段必须是字典")
        return data, errors

    # 验证必需字段
    for required in ("name", "version", "description"):
        if required not in plugin:
            errors.append(f"[plugin] 缺少必需字段 '{required}'")

    if "name" in plugin:
        if not isinstance(plugin["name"], str):
            errors.append("plugin.name 必须是字符串")
        elif not PLUGIN_NAME_PATTERN.match(plugin["name"]):
            errors.append(f"plugin.name 必须匹配 {PLUGIN_NAME_PATTERN.pattern}")

    return data, errors


# ============================================================
# 主服务类
# ============================================================

class PluginRegistry:
    """Plugin 注册表

    功能：
      1. 本地 zip 安装
      2. plugin.toml 解析
      3. 依赖追踪
      4. 启用/禁用
      5. 审计日志
    """

    def __init__(self):
        self._plugins: Dict[str, Plugin] = {}  # id -> Plugin
        self._by_name: Dict[str, Plugin] = {}  # name -> Plugin
        self._lock = threading.RLock()
        # 初始化根目录
        PLUGINS_ROOT.mkdir(parents=True, exist_ok=True)
        # 加载已有 plugins
        self._load_from_disk()
        logger.info(f"PluginRegistry 初始化完成（{len(self._plugins)} plugins）")

    def _is_safe_install_path(self, path: Path) -> bool:
        """检查路径是否在 plugin 沙箱内"""
        try:
            resolved = path.resolve()
            plugins_root = PLUGINS_ROOT.resolve()
            resolved.relative_to(plugins_root)
            return True
        except (ValueError, OSError):
            return False

    # ============================================================
    # 安装
    # ============================================================

    def install_from_zip(
        self,
        zip_bytes: bytes,
        force: bool = False,
    ) -> Plugin:
        """从 zip 安装 plugin

        算法：
          1. zip 安全性检查
          2. 解压到临时目录
          3. 解析 plugin.toml
          4. 验证字段
          5. 移动到 ~/.hermes/plugins/<name>/
          6. 注册到 registry

        参数：
          - zip_bytes: zip 文件字节
          - force: 是否覆盖同名 plugin
        返回值：Plugin 实例
        抛出：ValueError 当参数非法
        """
        if not _check_zip_safety(zip_bytes):
            raise ValueError("zip 文件不安全或过大")

        if len(self._plugins) >= MAX_PLUGINS:
            raise ValueError(f"Plugin 总数已达上限 {MAX_PLUGINS}")

        # 解压
        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            toml_names = [n for n in zf.namelist() if n.endswith(PLUGIN_TOML)]
            if not toml_names:
                raise ValueError(f"zip 中未找到 {PLUGIN_TOML}")
            if len(toml_names) > 1:
                raise ValueError(f"zip 中存在多个 {PLUGIN_TOML}")

            toml_name = toml_names[0]
            try:
                toml_content = zf.read(toml_name).decode("utf-8")
            except (OSError, UnicodeDecodeError) as e:
                raise ValueError(f"读取 {PLUGIN_TOML} 失败: {e}")

            parsed, errors = _parse_plugin_toml(toml_content)
            if errors:
                raise ValueError(f"plugin.toml 解析失败: {'; '.join(errors)}")

            plugin_meta = parsed["plugin"]
            name = plugin_meta["name"]
            version = plugin_meta["version"]
            description = plugin_meta["description"]

            if name in self._by_name and not force:
                raise ValueError(
                    f"Plugin '{name}' 已存在。使用 force=true 强制覆盖。"
                )

            install_path = PLUGINS_ROOT / name
            if install_path.exists():
                if not force:
                    raise ValueError(f"安装目录已存在: {install_path}")
                shutil.rmtree(install_path)
            install_path.mkdir(parents=True, exist_ok=True)

            for member in zf.namelist():
                target = install_path / member
                if not self._is_safe_install_path(target):
                    raise ValueError(f"不安全的解压路径: {member}")
                if member.endswith("/"):
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with zf.open(member) as src, open(target, "wb") as dst:
                        shutil.copyfileobj(src, dst)

        plugin_id = f"plugin-{uuid.uuid4().hex[:8]}"

        deps_data = parsed.get("dependencies", {})
        dependencies = []
        for dep_name, version_spec in deps_data.items():
            if not isinstance(version_spec, str):
                continue
            dependencies.append(PluginDependency(
                name=dep_name,
                version_spec=version_spec,
            ))

        contents = parsed.get("contents", {})
        skills = contents.get("skills", []) if isinstance(contents, dict) else []
        mcp_servers = contents.get("mcp_servers", []) if isinstance(contents, dict) else []
        agents = contents.get("agents", []) if isinstance(contents, dict) else []

        plugin = Plugin(
            id=plugin_id,
            name=name,
            version=version,
            description=description,
            enabled=True,
            source="local",
            install_path=str(install_path),
            dependencies=dependencies,
            skills=skills if isinstance(skills, list) else [],
            mcp_servers=mcp_servers if isinstance(mcp_servers, list) else [],
            agents=agents if isinstance(agents, list) else [],
            installed_at=datetime.now(timezone.utc).isoformat(),
            plugin_toml_path=str(install_path / PLUGIN_TOML),
        )

        with self._lock:
            if name in self._by_name:
                old_plugin = self._by_name[name]
                del self._plugins[old_plugin.id]
            self._plugins[plugin_id] = plugin
            self._by_name[name] = plugin

        self._save_to_disk()
        self._write_audit("install", plugin_id, name)

        logger.info(f"Plugin 安装: {name} v{version} (id={plugin_id})")
        return plugin

    def install_from_path(
        self,
        source_path: str,
        force: bool = False,
    ) -> Plugin:
        """从本地目录安装 plugin

        参数：
          - source_path: 包含 plugin.toml 的目录路径
          - force: 是否覆盖
        返回值：Plugin 实例
        """
        source = Path(source_path).expanduser().resolve()
        if not source.exists() or not source.is_dir():
            raise ValueError(f"源目录不存在: {source_path}")

        toml_path = source / PLUGIN_TOML
        if not toml_path.exists() or not toml_path.is_file():
            raise ValueError(f"目录中未找到 {PLUGIN_TOML}")

        # 打包为 zip
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            for entry in source.rglob("*"):
                if entry.is_file():
                    arcname = str(entry.relative_to(source))
                    zf.write(entry, arcname)
        return self.install_from_zip(buf.getvalue(), force=force)

    # ============================================================
    # CRUD
    # ============================================================

    def list_plugins(
        self,
        enabled_only: bool = False,
    ) -> List[Plugin]:
        """列出 plugins"""
        with self._lock:
            plugins = list(self._plugins.values())
        if enabled_only:
            plugins = [p for p in plugins if p.enabled]
        return plugins

    def get_plugin(self, plugin_id: str) -> Optional[Plugin]:
        """按 ID 获取"""
        with self._lock:
            return self._plugins.get(plugin_id)

    def get_plugin_by_name(self, name: str) -> Optional[Plugin]:
        """按 name 获取"""
        with self._lock:
            return self._by_name.get(name)

    def set_enabled(self, plugin_id: str, enabled: bool) -> Optional[Plugin]:
        """启用/禁用 plugin"""
        with self._lock:
            if plugin_id not in self._plugins:
                return None
            self._plugins[plugin_id].enabled = enabled
            plugin = self._plugins[plugin_id]
        self._save_to_disk()
        self._write_audit("enable" if enabled else "disable", plugin_id, plugin.name)
        return plugin

    def uninstall(self, plugin_id: str) -> bool:
        """卸载 plugin

        参数：
          - plugin_id: plugin ID
        返回值：是否成功
        """
        with self._lock:
            if plugin_id not in self._plugins:
                return False
            plugin = self._plugins[plugin_id]
            install_path = Path(plugin.install_path)
            if install_path.exists() and install_path.is_dir():
                if self._is_safe_install_path(install_path):
                    try:
                        shutil.rmtree(install_path)
                    except OSError as e:
                        logger.warning(f"清理 plugin 目录失败: {e}")
            del self._plugins[plugin_id]
            if plugin.name in self._by_name:
                del self._by_name[plugin.name]

        self._save_to_disk()
        self._write_audit("uninstall", plugin_id, plugin.name)
        logger.info(f"Plugin 卸载: {plugin.name} (id={plugin_id})")
        return True

    # ============================================================
    # 持久化
    # ============================================================

    def _save_to_disk(self):
        """保存元数据到磁盘"""
        try:
            REGISTRY_PATH.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "plugins": {pid: p.to_dict() for pid, p in self._plugins.items()},
                "last_updated": datetime.now(timezone.utc).isoformat(),
            }
            REGISTRY_PATH.write_text(
                json.dumps(data, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )
        except OSError as e:
            logger.warning(f"保存 Plugin Registry 失败: {e}")

    def _load_from_disk(self):
        """从磁盘加载元数据"""
        try:
            if not REGISTRY_PATH.exists():
                return
            data = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
            with self._lock:
                for pid, pdata in data.get("plugins", {}).items():
                    deps_data = pdata.get("dependencies", [])
                    deps = []
                    for d in deps_data:
                        if isinstance(d, dict):
                            deps.append(PluginDependency(**d))
                    pdata["dependencies"] = deps
                    plugin = Plugin(**pdata)
                    self._plugins[pid] = plugin
                    self._by_name[plugin.name] = plugin
        except (OSError, json.JSONDecodeError, TypeError) as e:
            logger.warning(f"加载 Plugin Registry 失败: {e}")

    def _write_audit(self, action: str, plugin_id: str, plugin_name: str):
        """写入审计日志"""
        try:
            AUDIT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
            entry = {
                "action": action,
                "plugin_id": plugin_id,
                "plugin_name": plugin_name,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            with open(AUDIT_LOG_PATH, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning(f"写入 plugin 审计失败: {e}")


# ============================================================
# 单例
# ============================================================

_plugin_instance: Optional[PluginRegistry] = None
_plugin_lock = threading.Lock()


def get_plugin_registry() -> PluginRegistry:
    """获取全局单例"""
    global _plugin_instance
    if _plugin_instance is None:
        with _plugin_lock:
            if _plugin_instance is None:
                _plugin_instance = PluginRegistry()
    return _plugin_instance
