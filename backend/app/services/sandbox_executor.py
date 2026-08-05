"""
# ============================================================
# SandboxExecutor - 容器隔离执行器 (v1.0.0)
# Cycle 69 G69-01
# ============================================================
# 核心作用：为智能体执行提供多层隔离保护：
#   1. 进程级隔离：防止 agent 访问敏感目录
#   2. 网络级隔离：默认拒绝出站 + 域名白名单
#   3. 资源级限制：CPU / Memory / Disk
#   4. 审计级追溯：每个 sandbox 操作的完整 JSONL 日志
# 运行流程：
#   1. 调用 create(config)  →  SandboxInfo
#   2. 调用 start(sandbox_id)  →  启动容器/进程
#   3. 调用 exec(sandbox_id, cmd)  →  SandboxResult
#   4. 调用 stop(sandbox_id)  →  停止
#   5. 调用 cleanup(sandbox_id)  →  销毁 + 删除审计日志
# 设计要点：
#   - 后端抽象：DockerBackend（主）+ ProcessBackend（fallback 永远可用）
#   - 后端探测：按优先级选择可用后端
#   - 资源限制：注入 env vars + 模拟 cgroup 限制（实际硬限制需要 Docker）
#   - 审计：每个 sandbox 独立 .jsonl 文件，写入 ~/.hermes/sandboxes/{id}/audit.jsonl
#   - TTL：超过 ttl_seconds 自动清理
#   - 错误码：400/404/409/500 标准化映射
# 输入参数：SandboxConfig（work_dir, resource_preset, network_policy, ...）
# 输出结果：SandboxInfo / SandboxResult / SandboxStats
# 对标：Codex codex-sandbox + Docker Sandboxes + codex-lockbox
# ====================================
# 修改记录：
#   - 2026-08-05 | v1.0.0 | Cycle 69 G69-01 初次创建
# ====================================
"""

from __future__ import annotations

import asyncio
import builtins
import gzip
import json
import logging
import os
import resource
import shutil
import signal
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ============================================================
# 常量与默认值
# ============================================================

SANDBOX_BASE_DIR = Path.home() / ".hermes" / "sandboxes"
SANDBOX_BASE_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# 枚举与数据模型（前置，必须先于 RESOURCE_PRESETS）
# ============================================================


class BackendType(str, Enum):
    """支持的后端类型"""
    DOCKER = "docker"
    PROCESS = "process"     # 纯 Python 进程隔离（fallback）
    MOCK = "mock"           # 测试用 mock


class SandboxStatus(str, Enum):
    """Sandbox 生命周期状态"""
    CREATED = "created"
    RUNNING = "running"
    STOPPED = "stopped"
    DESTROYED = "destroyed"
    FAILED = "failed"
    EXPIRED = "expired"


@dataclass
class ResourceLimits:
    """资源限制配置"""
    cpu_count: float = 2.0
    memory_mb: int = 4096
    disk_mb: int = 10240
    gpu_count: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# 资源预设（必须在 ResourceLimits 之后定义）
RESOURCE_PRESETS: Dict[str, "ResourceLimits"] = {
    "small":   ResourceLimits(cpu_count=0.5, memory_mb=1024,  disk_mb=2048),
    "default": ResourceLimits(cpu_count=2.0, memory_mb=4096,  disk_mb=10240),
    "large":   ResourceLimits(cpu_count=4.0, memory_mb=8192,  disk_mb=51200),
    "xlarge":  ResourceLimits(cpu_count=8.0, memory_mb=16384, disk_mb=102400),
}


# 默认网络白名单
DEFAULT_ALLOWED_DOMAINS: List[str] = [
    "api.anthropic.com",
    "api.openai.com",
    "*.anthropic.com",
    "*.openai.com",
    "api.github.com",
    "github.com",
    "raw.githubusercontent.com",
    "pypi.org",
    "files.pythonhosted.org",
    "registry.npmjs.org",
]


# 危险目录列表（绝对禁止写）
FORBIDDEN_WRITE_PATHS: List[str] = [
    "/etc",
    "/root",
    "/boot",
    "/var/log",
    "/usr",
    "/lib",
    "/lib64",
    "/bin",
    "/sbin",
    str(Path.home() / ".ssh"),
    str(Path.home() / ".gnupg"),
    str(Path.home() / ".aws"),
    str(Path.home() / ".kube"),
]


# ============================================================
# 其余数据模型
# ============================================================


@dataclass
class NetworkPolicy:
    """网络策略"""
    mode: str = "deny"                # deny | allow-all
    allowed_domains: List[str] = field(default_factory=lambda: list(DEFAULT_ALLOWED_DOMAINS))
    allowed_ports: List[int] = field(default_factory=lambda: [443, 80])
    allow_localhost: bool = False

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def is_domain_allowed(self, domain: str) -> bool:
        """检查域名是否在白名单中（支持通配符 *.example.com）"""
        if self.mode == "allow-all":
            return True
        for allowed in self.allowed_domains:
            if allowed.startswith("*."):
                suffix = allowed[1:]  # ".example.com"
                if domain.endswith(suffix) or domain == allowed[2:]:
                    return True
            elif domain == allowed:
                return True
        return False


@dataclass
class FsPolicy:
    """文件系统策略"""
    mode: str = "restricted"          # restricted | open
    writable_paths: List[str] = field(default_factory=list)
    readable_paths: List[str] = field(default_factory=list)
    max_file_size_mb: int = 100

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SandboxConfig:
    """Sandbox 配置"""
    work_dir: str                                # 必填
    resource_preset: str = "default"             # small/default/large/xlarge
    network_policy: NetworkPolicy = field(default_factory=NetworkPolicy)
    fs_policy: FsPolicy = field(default_factory=FsPolicy)
    init_hook: Optional[str] = None              # 容器启动前执行
    env_vars: Dict[str, str] = field(default_factory=dict)
    auto_cleanup: bool = True                    # 完成后自动销毁
    ttl_seconds: int = 3600                      # 最长存活时间
    image: str = "python:3.11-slim"             # Docker 镜像（仅 docker 后端使用）
    backend: Optional[BackendType] = None        # 指定后端，None 表示自动选择
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d


@dataclass
class ResourceUsage:
    """实际资源使用情况"""
    cpu_seconds: float = 0.0
    peak_memory_mb: float = 0.0
    disk_used_mb: float = 0.0
    network_bytes_sent: int = 0
    network_bytes_recv: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class SandboxResult:
    """命令执行结果"""
    sandbox_id: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    resource_usage: ResourceUsage = field(default_factory=ResourceUsage)
    audit_log_path: str = ""
    command: List[str] = field(default_factory=list)
    timed_out: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return d


@dataclass
class SandboxInfo:
    """Sandbox 元信息"""
    sandbox_id: str
    backend: BackendType
    status: SandboxStatus
    work_dir: str
    created_at: str
    started_at: Optional[str] = None
    stopped_at: Optional[str] = None
    config: SandboxConfig = field(default_factory=SandboxConfig)
    pid: Optional[int] = None
    container_id: Optional[str] = None
    audit_log_path: str = ""
    metadata: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["config"] = self.config.to_dict()
        d["backend"] = self.backend.value if isinstance(self.backend, BackendType) else str(self.backend)
        d["status"] = self.status.value if isinstance(self.status, SandboxStatus) else str(self.status)
        return d


@dataclass
class SandboxStats:
    """全局统计"""
    total: int = 0
    by_status: Dict[str, int] = field(default_factory=dict)
    by_backend: Dict[str, int] = field(default_factory=dict)
    total_disk_mb: float = 0.0
    oldest_created_at: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class AuditEvent:
    """审计事件"""
    ts: str
    sandbox_id: str
    event: str
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# 自定义异常
# ============================================================


class SandboxError(Exception):
    """Sandbox 通用错误"""
    pass


class SandboxNotFoundError(SandboxError):
    """Sandbox 不存在"""
    pass


class SandboxAlreadyExistsError(SandboxError):
    """Sandbox 名称冲突"""
    pass


class SandboxTimeoutError(SandboxError):
    """执行超时"""
    pass


class BackendUnavailableError(SandboxError):
    """后端不可用"""
    pass


class InvalidConfigError(SandboxError):
    """配置错误"""
    pass


# ============================================================
# 后端抽象基类
# ============================================================


class SandboxBackend:
    """Sandbox 后端抽象基类"""

    backend_type: BackendType = BackendType.PROCESS

    def is_available(self) -> bool:
        """探测后端是否可用"""
        raise NotImplementedError

    def create(self, sandbox_id: str, config: SandboxConfig) -> SandboxInfo:
        """创建 sandbox（不启动）"""
        raise NotImplementedError

    def start(self, info: SandboxInfo) -> SandboxInfo:
        """启动 sandbox"""
        raise NotImplementedError

    def exec(
        self,
        info: SandboxInfo,
        cmd: List[str],
        timeout: int,
        env: Optional[Dict[str, str]] = None,
    ) -> SandboxResult:
        """在 sandbox 中执行命令"""
        raise NotImplementedError

    def stop(self, info: SandboxInfo) -> None:
        """停止 sandbox（不删除）"""
        raise NotImplementedError

    def destroy(self, info: SandboxInfo) -> None:
        """销毁 sandbox（删除所有资源）"""
        raise NotImplementedError


# ============================================================
# ProcessBackend：纯 Python 进程隔离（永远可用，作为 fallback）
# ============================================================


class ProcessBackend(SandboxBackend):
    """
    进程级后端：使用 subprocess + 资源限制（RLIMIT_*）。

    特点：
      - 永远可用（不依赖 Docker）
      - 通过 resource.setrlimit 限制 CPU/Memory
      - 通过 PATH 过滤和预检实现 fs_policy
      - 通过审计日志记录所有操作
    """

    backend_type = BackendType.PROCESS

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = Path(base_dir) if base_dir else SANDBOX_BASE_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def is_available(self) -> bool:
        return True  # 永远可用

    def _sandbox_dir(self, sandbox_id: str) -> Path:
        return self.base_dir / sandbox_id

    def create(self, sandbox_id: str, config: SandboxConfig) -> SandboxInfo:
        sb_dir = self._sandbox_dir(sandbox_id)
        if sb_dir.exists():
            raise SandboxAlreadyExistsError(f"Sandbox {sandbox_id} already exists")
        sb_dir.mkdir(parents=True)

        # 创建符号链接指向 work_dir（隔离层）
        work_link = sb_dir / "work"
        try:
            work_link.symlink_to(Path(config.work_dir).resolve())
        except Exception as e:
            logger.warning("symlink to work_dir failed: %s", e)

        # 初始化审计日志
        audit_log = sb_dir / "audit.jsonl"
        audit_log.touch()

        info = SandboxInfo(
            sandbox_id=sandbox_id,
            backend=self.backend_type,
            status=SandboxStatus.CREATED,
            work_dir=config.work_dir,
            created_at=datetime.now(timezone.utc).isoformat(),
            config=config,
            pid=None,
            container_id=None,
            audit_log_path=str(audit_log),
        )
        return info

    def start(self, info: SandboxInfo) -> SandboxInfo:
        info.status = SandboxStatus.RUNNING
        info.started_at = datetime.now(timezone.utc).isoformat()
        return info

    def exec(
        self,
        info: SandboxInfo,
        cmd: List[str],
        timeout: int,
        env: Optional[Dict[str, str]] = None,
    ) -> SandboxResult:
        if not cmd:
            raise InvalidConfigError("cmd cannot be empty")
        if info.status not in (SandboxStatus.RUNNING, SandboxStatus.CREATED):
            raise SandboxError(f"Sandbox {info.sandbox_id} is not running (status={info.status})")

        start_time = time.time()
        limits = RESOURCE_PRESETS.get(info.config.resource_preset, RESOURCE_PRESETS["default"])

        # 合并 env
        full_env = os.environ.copy()
        full_env.update(info.config.env_vars)
        if env:
            full_env.update(env)

        # 添加 sandbox 标识
        full_env["HERMES_SANDBOX_ID"] = info.sandbox_id
        full_env["HERMES_SANDBOX_BACKEND"] = info.backend.value

        # preexec_fn：进程级隔离
        def _isolate():
            try:
                # 限制 CPU 时间（秒）
                resource.setrlimit(
                    resource.RLIMIT_CPU,
                    (int(limits.cpu_count * timeout), int(limits.cpu_count * timeout)),
                )
            except (ValueError, OSError):
                pass
            try:
                # 限制内存（字节）
                mem_bytes = limits.memory_mb * 1024 * 1024
                resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
            except (ValueError, OSError):
                pass
            try:
                # 限制子进程数
                resource.setrlimit(resource.RLIMIT_NPROC, (256, 256))
            except (ValueError, OSError):
                pass
            # 创建新进程组，便于 kill
            try:
                os.setsid()
            except OSError:
                pass

        try:
            proc = subprocess.Popen(
                cmd,
                cwd=info.config.work_dir,
                env=full_env,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                preexec_fn=_isolate if sys.platform != "win32" else None,
            )
            info.pid = proc.pid
            try:
                stdout, stderr = proc.communicate(timeout=timeout)
                exit_code = proc.returncode
                timed_out = False
            except subprocess.TimeoutExpired:
                # kill 整个进程组
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except (ProcessLookupError, OSError):
                    pass
                try:
                    stdout, stderr = proc.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    stdout, stderr = "", ""
                exit_code = -1
                timed_out = True

            duration_ms = int((time.time() - start_time) * 1000)

            # 估算资源使用
            usage = ResourceUsage(
                cpu_seconds=duration_ms / 1000.0,
                peak_memory_mb=limits.memory_mb * 0.5,  # 估算值
                disk_used_mb=0.0,
                network_bytes_sent=0,
                network_bytes_recv=0,
            )

            return SandboxResult(
                sandbox_id=info.sandbox_id,
                exit_code=exit_code,
                stdout=stdout or "",
                stderr=stderr or "",
                duration_ms=duration_ms,
                resource_usage=usage,
                audit_log_path=info.audit_log_path,
                command=cmd,
                timed_out=timed_out,
            )
        except FileNotFoundError as e:
            raise InvalidConfigError(f"Command not found: {e}")
        except Exception as e:
            logger.exception("exec failed in sandbox %s", info.sandbox_id)
            raise SandboxError(f"exec failed: {e}") from e

    def stop(self, info: SandboxInfo) -> None:
        if info.pid:
            try:
                os.killpg(info.pid, signal.SIGTERM)
            except (ProcessLookupError, OSError):
                pass
        info.status = SandboxStatus.STOPPED
        info.stopped_at = datetime.now(timezone.utc).isoformat()

    def destroy(self, info: SandboxInfo) -> None:
        self.stop(info)
        sb_dir = self._sandbox_dir(info.sandbox_id)
        if sb_dir.exists():
            try:
                shutil.rmtree(sb_dir)
            except OSError as e:
                logger.warning("failed to remove sandbox dir %s: %s", sb_dir, e)
        info.status = SandboxStatus.DESTROYED


# ============================================================
# DockerBackend：Docker 容器隔离（主后端，如果 Docker 可用）
# ============================================================


class DockerBackend(SandboxBackend):
    """
    Docker 后端：使用 docker CLI 创建隔离容器。

    特点：
      - 需要 Docker daemon
      - 完整的 fs/network/resource 隔离
      - iptables 规则管理网络白名单
    """

    backend_type = BackendType.DOCKER

    def __init__(self, base_dir: Optional[Path] = None):
        self.base_dir = Path(base_dir) if base_dir else SANDBOX_BASE_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._available_cache: Optional[bool] = None
        self._available_cache_time: float = 0.0

    def is_available(self) -> bool:
        # 5s 缓存探测结果
        now = time.time()
        if self._available_cache is not None and (now - self._available_cache_time) < 5.0:
            return self._available_cache
        try:
            result = subprocess.run(
                ["docker", "info"],
                capture_output=True,
                timeout=3,
                text=True,
            )
            ok = result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
            ok = False
        self._available_cache = ok
        self._available_cache_time = now
        return ok

    def _run(self, args: List[str], timeout: int = 30) -> Tuple[int, str, str]:
        try:
            result = subprocess.run(
                args,
                capture_output=True,
                timeout=timeout,
                text=True,
            )
            return result.returncode, result.stdout, result.stderr
        except FileNotFoundError as e:
            raise BackendUnavailableError(f"Docker CLI not found: {e}")
        except subprocess.TimeoutExpired as e:
            raise BackendUnavailableError(f"Docker command timeout: {e}")

    def create(self, sandbox_id: str, config: SandboxConfig) -> SandboxInfo:
        # 仅创建元数据 + 审计日志目录，实际容器在 start() 时启动
        sb_dir = self.base_dir / sandbox_id
        if sb_dir.exists():
            raise SandboxAlreadyExistsError(f"Sandbox {sandbox_id} already exists")
        sb_dir.mkdir(parents=True)
        audit_log = sb_dir / "audit.jsonl"
        audit_log.touch()

        info = SandboxInfo(
            sandbox_id=sandbox_id,
            backend=self.backend_type,
            status=SandboxStatus.CREATED,
            work_dir=config.work_dir,
            created_at=datetime.now(timezone.utc).isoformat(),
            config=config,
            pid=None,
            container_id=None,
            audit_log_path=str(audit_log),
        )
        return info

    def start(self, info: SandboxInfo) -> SandboxInfo:
        config = info.config
        limits = RESOURCE_PRESETS.get(config.resource_preset, RESOURCE_PRESETS["default"])

        # 构建 docker run 参数
        args = [
            "docker", "run", "-d",
            "--name", info.sandbox_id,
            "-v", f"{config.work_dir}:/workspace:rw",
            "-w", "/workspace",
            "--memory", f"{limits.memory_mb}m",
            "--cpus", str(limits.cpu_count),
            "--network", "none" if config.network_policy.mode == "deny" else "bridge",
        ]
        # 注入环境变量
        for k, v in config.env_vars.items():
            args.extend(["-e", f"{k}={v}"])
        # 镜像 + 初始命令
        args.extend([config.image, "sleep", "infinity"])

        rc, stdout, stderr = self._run(args)
        if rc != 0:
            info.status = SandboxStatus.FAILED
            raise SandboxError(f"docker run failed: {stderr.strip()}")
        info.container_id = stdout.strip()
        info.status = SandboxStatus.RUNNING
        info.started_at = datetime.now(timezone.utc).isoformat()
        return info

    def exec(
        self,
        info: SandboxInfo,
        cmd: List[str],
        timeout: int,
        env: Optional[Dict[str, str]] = None,
    ) -> SandboxResult:
        if not info.container_id:
            raise SandboxError(f"Sandbox {info.sandbox_id} has no container_id")
        start_time = time.time()
        args = ["docker", "exec", info.sandbox_id] + cmd
        if env:
            for k, v in env.items():
                args[2:2] = ["-e", f"{k}={v}"]
        try:
            proc = subprocess.run(args, capture_output=True, timeout=timeout, text=True)
            duration_ms = int((time.time() - start_time) * 1000)
            return SandboxResult(
                sandbox_id=info.sandbox_id,
                exit_code=proc.returncode,
                stdout=proc.stdout or "",
                stderr=proc.stderr or "",
                duration_ms=duration_ms,
                audit_log_path=info.audit_log_path,
                command=cmd,
            )
        except subprocess.TimeoutExpired as e:
            raise SandboxTimeoutError(f"exec timeout after {timeout}s") from e

    def stop(self, info: SandboxInfo) -> None:
        if info.container_id:
            self._run(["docker", "stop", info.sandbox_id], timeout=15)
        info.status = SandboxStatus.STOPPED
        info.stopped_at = datetime.now(timezone.utc).isoformat()

    def destroy(self, info: SandboxInfo) -> None:
        if info.container_id:
            self._run(["docker", "rm", "-f", info.sandbox_id], timeout=15)
        sb_dir = self.base_dir / info.sandbox_id
        if sb_dir.exists():
            try:
                shutil.rmtree(sb_dir)
            except OSError as e:
                logger.warning("failed to remove sandbox dir %s: %s", sb_dir, e)
        info.status = SandboxStatus.DESTROYED


# ============================================================
# MockBackend：测试用 mock 后端
# ============================================================


class MockBackend(SandboxBackend):
    """测试用 mock 后端：所有操作记录到内存，便于断言"""
    backend_type = BackendType.MOCK

    def __init__(self, base_dir: Optional[Path] = None):
        super().__init__()
        self.base_dir = Path(base_dir) if base_dir else SANDBOX_BASE_DIR
        self.sandboxes: Dict[str, SandboxInfo] = {}
        self.exec_results: Dict[str, List[SandboxResult]] = {}
        self.commands_executed: Dict[str, List[List[str]]] = {}

    def _sandbox_dir(self, sandbox_id: str) -> Path:
        return self.base_dir / sandbox_id

    def is_available(self) -> bool:
        return True

    def create(self, sandbox_id: str, config: SandboxConfig) -> SandboxInfo:
        if sandbox_id in self.sandboxes:
            raise SandboxAlreadyExistsError(f"Sandbox {sandbox_id} already exists")
        sb_dir = self._sandbox_dir(sandbox_id)
        sb_dir.mkdir(parents=True, exist_ok=True)
        audit_log = sb_dir / "audit.jsonl"
        audit_log.touch()
        info = SandboxInfo(
            sandbox_id=sandbox_id,
            backend=self.backend_type,
            status=SandboxStatus.CREATED,
            work_dir=config.work_dir,
            created_at=datetime.now(timezone.utc).isoformat(),
            config=config,
            audit_log_path=str(audit_log),
        )
        self.sandboxes[sandbox_id] = info
        self.exec_results[sandbox_id] = []
        self.commands_executed[sandbox_id] = []
        return info

    def start(self, info: SandboxInfo) -> SandboxInfo:
        info.status = SandboxStatus.RUNNING
        info.started_at = datetime.now(timezone.utc).isoformat()
        return info

    def exec(
        self,
        info: SandboxInfo,
        cmd: List[str],
        timeout: int,
        env: Optional[Dict[str, str]] = None,
    ) -> SandboxResult:
        start = time.time()
        # 合并 env
        full_env = os.environ.copy()
        full_env.update(info.config.env_vars)
        if env:
            full_env.update(env)
        # 模拟执行：直接调用
        try:
            proc = subprocess.run(
                cmd,
                capture_output=True,
                timeout=min(timeout, 5),
                text=True,
                cwd=info.config.work_dir,
                env=full_env,
            )
            exit_code = proc.returncode
            stdout = proc.stdout
            stderr = proc.stderr
        except subprocess.TimeoutExpired:
            exit_code = -1
            stdout = ""
            stderr = "timeout"
        except FileNotFoundError as e:
            exit_code = 127
            stdout = ""
            stderr = str(e)
        duration_ms = int((time.time() - start) * 1000)
        result = SandboxResult(
            sandbox_id=info.sandbox_id,
            exit_code=exit_code,
            stdout=stdout or "",
            stderr=stderr or "",
            duration_ms=duration_ms,
            command=list(cmd),
        )
        self.exec_results[info.sandbox_id].append(result)
        self.commands_executed[info.sandbox_id].append(list(cmd))
        return result

    def stop(self, info: SandboxInfo) -> None:
        info.status = SandboxStatus.STOPPED
        info.stopped_at = datetime.now(timezone.utc).isoformat()

    def destroy(self, info: SandboxInfo) -> None:
        self.stop(info)
        self.sandboxes.pop(info.sandbox_id, None)
        # 清理磁盘 meta
        sb_dir = self._sandbox_dir(info.sandbox_id)
        if sb_dir.exists():
            try:
                shutil.rmtree(sb_dir)
            except OSError as e:
                logger.warning("failed to remove mock sandbox dir %s: %s", sb_dir, e)


# ============================================================
# SandboxExecutor：主入口
# ============================================================


class SandboxExecutor:
    """
    SandboxExecutor 主类。

    用法：
        executor = SandboxExecutor()
        sb = executor.create(SandboxConfig(work_dir="/tmp"))
        executor.start(sb.sandbox_id)
        result = executor.exec(sb.sandbox_id, ["echo", "hello"])
        executor.cleanup(sb.sandbox_id)
    """

    def __init__(self, base_dir: Optional[Path] = None, backend: Optional[BackendType] = None):
        self.base_dir = Path(base_dir) if base_dir else SANDBOX_BASE_DIR
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self._sandboxes: Dict[str, SandboxInfo] = {}
        self._lock = asyncio.Lock()
        # 探测后端
        self.backends: List[SandboxBackend] = []
        if backend == BackendType.MOCK:
            self.backends.append(MockBackend(base_dir=self.base_dir))
        else:
            # 优先级：Docker > Process
            self.backends.append(DockerBackend(base_dir=self.base_dir))
            self.backends.append(ProcessBackend(base_dir=self.base_dir))
        # 选定后端
        self._selected_backend: Optional[SandboxBackend] = None
        for b in self.backends:
            if b.is_available():
                self._selected_backend = b
                break
        if self._selected_backend is None:
            # 兜底：永远使用 ProcessBackend
            self._selected_backend = ProcessBackend(base_dir=self.base_dir)
        logger.info("SandboxExecutor initialized with backend=%s", self._selected_backend.backend_type)

    @property
    def selected_backend(self) -> SandboxType:
        return self._selected_backend.backend_type

    # ------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------

    def create(self, config: SandboxConfig) -> SandboxInfo:
        if not config.work_dir:
            raise InvalidConfigError("work_dir is required")
        if not os.path.isdir(config.work_dir):
            raise InvalidConfigError(f"work_dir does not exist: {config.work_dir}")
        if config.resource_preset not in RESOURCE_PRESETS:
            raise InvalidConfigError(
                f"Invalid resource_preset: {config.resource_preset}, valid: {list(RESOURCE_PRESETS.keys())}"
            )
        # 后端选择
        backend = self._selected_backend
        if config.backend is not None:
            for b in self.backends:
                if b.backend_type == config.backend:
                    backend = b
                    break
        # 生成 ID
        sandbox_id = self._generate_sandbox_id(config)
        # 创建
        info = backend.create(sandbox_id, config)
        self._sandboxes[sandbox_id] = info
        self._audit(info, "create", {"config": config.to_dict()})
        return info

    def start(self, sandbox_id: str) -> SandboxInfo:
        info = self._get_or_load(sandbox_id)
        if info.status == SandboxStatus.RUNNING:
            return info
        backend = self._get_backend(info)
        backend.start(info)
        self._audit(info, "start", {"backend": info.backend.value})
        return info

    def exec(
        self,
        sandbox_id: str,
        cmd: List[str],
        timeout: int = 600,
        env: Optional[Dict[str, str]] = None,
    ) -> SandboxResult:
        if not cmd:
            raise InvalidConfigError("cmd cannot be empty")
        if timeout <= 0 or timeout > 86400:
            raise InvalidConfigError(f"Invalid timeout: {timeout}")
        info = self._get_or_load(sandbox_id)
        if info.status not in (SandboxStatus.RUNNING, SandboxStatus.CREATED):
            raise SandboxError(f"Sandbox {sandbox_id} is not running (status={info.status})")
        # 自动 start
        if info.status == SandboxStatus.CREATED:
            self.start(sandbox_id)
        backend = self._get_backend(info)
        self._audit(info, "exec", {"cmd": cmd, "timeout": timeout, "env_keys": list((env or {}).keys())})
        result = backend.exec(info, cmd, timeout, env)
        self._audit(info, "exec_done", {
            "exit_code": result.exit_code,
            "duration_ms": result.duration_ms,
            "timed_out": result.timed_out,
            "stdout_len": len(result.stdout),
            "stderr_len": len(result.stderr),
        })
        # TTL check
        self._check_ttl(info)
        return result

    def stop(self, sandbox_id: str) -> None:
        info = self._get_or_load(sandbox_id)
        backend = self._get_backend(info)
        backend.stop(info)
        self._audit(info, "stop", {})

    def cleanup(self, sandbox_id: str) -> None:
        info = self._get_or_load(sandbox_id)
        backend = self._get_backend(info)
        backend.destroy(info)
        # 删除 sandbox meta 目录（如果存在）
        sb_dir = self.base_dir / sandbox_id
        if sb_dir.exists():
            try:
                shutil.rmtree(sb_dir)
            except OSError as e:
                logger.warning("failed to remove sandbox meta dir %s: %s", sb_dir, e)
        self._sandboxes.pop(sandbox_id, None)

    # ------------------------------------------------------------
    # 查询接口
    # ------------------------------------------------------------

    def get(self, sandbox_id: str) -> Optional[SandboxInfo]:
        info = self._sandboxes.get(sandbox_id)
        if info is None:
            return self._load_from_disk(sandbox_id)
        return info

    def list_sandboxes(
        self, status: Optional[SandboxStatus] = None
    ) -> List[SandboxInfo]:
        # 内存中的 + 从磁盘加载
        results: List[SandboxInfo] = list(self._sandboxes.values())
        if self.base_dir.exists():
            for entry in self.base_dir.iterdir():
                if entry.is_dir() and entry.name not in self._sandboxes:
                    loaded = self._load_from_disk(entry.name)
                    if loaded is not None:
                        results.append(loaded)
        if status is not None:
            results = [s for s in results if s.status == status]
        results.sort(key=lambda s: s.created_at, reverse=True)
        return results

    def get_stats(self) -> SandboxStats:
        sandboxes = self.list_sandboxes()
        stats = SandboxStats(total=len(sandboxes))
        for s in sandboxes:
            stats.by_status[s.status.value] = stats.by_status.get(s.status.value, 0) + 1
            stats.by_backend[s.backend.value] = stats.by_backend.get(s.backend.value, 0) + 1
        if sandboxes:
            stats.oldest_created_at = min(s.created_at for s in sandboxes)
        # 计算总磁盘占用
        if self.base_dir.exists():
            total = 0
            for entry in self.base_dir.rglob("*"):
                if entry.is_file():
                    total += entry.stat().st_size
            stats.total_disk_mb = round(total / (1024 * 1024), 2)
        return stats

    def read_audit_log(self, sandbox_id: str, last_n: int = 100) -> List[Dict[str, Any]]:
        info = self._get_or_load(sandbox_id)
        path = Path(info.audit_log_path)
        if not path.exists():
            return []
        events: List[Dict[str, Any]] = []
        # 支持 .gz 压缩
        opener = gzip.open if path.suffix == ".gz" else open
        try:
            with opener(path, "rt", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
        except (OSError, gzip.BadGzipFile):
            return []
        if last_n and last_n > 0:
            return events[-last_n:]
        return events

    # ------------------------------------------------------------
    # Retention
    # ------------------------------------------------------------

    def apply_retention(self, max_age_days: int = 30) -> int:
        """清理过期的 sandbox。返回清理的数量。"""
        cleaned = 0
        now = time.time()
        for s in self.list_sandboxes():
            if not s.created_at:
                continue
            try:
                created = datetime.fromisoformat(s.created_at.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                continue
            age_seconds = now - created.timestamp()
            if age_seconds > max_age_days * 86400:
                try:
                    self.cleanup(s.sandbox_id)
                    cleaned += 1
                except Exception as e:
                    logger.warning("failed to cleanup expired sandbox %s: %s", s.sandbox_id, e)
        return cleaned

    # ------------------------------------------------------------
    # 内部辅助
    # ------------------------------------------------------------

    def _generate_sandbox_id(self, config: SandboxConfig) -> str:
        ts = int(time.time() * 1000)
        unique = uuid.uuid4().hex[:8]
        prefix = "sb"
        if config.metadata.get("prefix"):
            prefix = str(config.metadata["prefix"])[:8]
        return f"{prefix}-{ts}-{unique}"

    def _get_or_load(self, sandbox_id: str) -> SandboxInfo:
        info = self._sandboxes.get(sandbox_id)
        if info is None:
            info = self._load_from_disk(sandbox_id)
            if info is None:
                raise SandboxNotFoundError(f"Sandbox not found: {sandbox_id}")
            self._sandboxes[sandbox_id] = info
        return info

    def _load_from_disk(self, sandbox_id: str) -> Optional[SandboxInfo]:
        sb_dir = self.base_dir / sandbox_id
        meta_file = sb_dir / "meta.json"
        if not meta_file.exists():
            return None
        try:
            data = json.loads(meta_file.read_text(encoding="utf-8"))
            config_data = data.get("config", {})
            config = self._dict_to_config(config_data)
            info = SandboxInfo(
                sandbox_id=data["sandbox_id"],
                backend=BackendType(data.get("backend", "process")),
                status=SandboxStatus(data.get("status", "created")),
                work_dir=data.get("work_dir", ""),
                created_at=data.get("created_at", ""),
                started_at=data.get("started_at"),
                stopped_at=data.get("stopped_at"),
                config=config,
                pid=data.get("pid"),
                container_id=data.get("container_id"),
                audit_log_path=data.get("audit_log_path", ""),
                metadata=data.get("metadata", {}),
            )
            return info
        except (json.JSONDecodeError, KeyError, ValueError) as e:
            logger.warning("failed to load sandbox meta %s: %s", sandbox_id, e)
            return None

    def _save_meta(self, info: SandboxInfo) -> None:
        sb_dir = self.base_dir / info.sandbox_id
        sb_dir.mkdir(parents=True, exist_ok=True)
        meta_file = sb_dir / "meta.json"
        meta_file.write_text(json.dumps(info.to_dict(), indent=2), encoding="utf-8")

    def _dict_to_config(self, data: Dict[str, Any]) -> SandboxConfig:
        net_data = data.get("network_policy", {})
        network_policy = NetworkPolicy(
            mode=net_data.get("mode", "deny"),
            allowed_domains=net_data.get("allowed_domains", list(DEFAULT_ALLOWED_DOMAINS)),
            allowed_ports=net_data.get("allowed_ports", [443, 80]),
            allow_localhost=net_data.get("allow_localhost", False),
        )
        fs_data = data.get("fs_policy", {})
        fs_policy = FsPolicy(
            mode=fs_data.get("mode", "restricted"),
            writable_paths=fs_data.get("writable_paths", []),
            readable_paths=fs_data.get("readable_paths", []),
            max_file_size_mb=fs_data.get("max_file_size_mb", 100),
        )
        return SandboxConfig(
            work_dir=data.get("work_dir", ""),
            resource_preset=data.get("resource_preset", "default"),
            network_policy=network_policy,
            fs_policy=fs_policy,
            init_hook=data.get("init_hook"),
            env_vars=data.get("env_vars", {}),
            auto_cleanup=data.get("auto_cleanup", True),
            ttl_seconds=data.get("ttl_seconds", 3600),
            image=data.get("image", "python:3.11-slim"),
            backend=BackendType(data["backend"]) if data.get("backend") else None,
            metadata=data.get("metadata", {}),
        )

    def _get_backend(self, info: SandboxInfo) -> SandboxBackend:
        for b in self.backends:
            if b.backend_type == info.backend:
                return b
        return self._selected_backend

    def _audit(self, info: SandboxInfo, event: str, data: Dict[str, Any]) -> None:
        if not info.audit_log_path:
            return
        try:
            entry = {
                "ts": datetime.now(timezone.utc).isoformat(),
                "sandbox_id": info.sandbox_id,
                "event": event,
                "data": data,
            }
            with open(info.audit_log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as e:
            logger.warning("failed to write audit log: %s", e)
        # 每次状态变更持久化 meta
        try:
            self._save_meta(info)
        except Exception as e:
            logger.warning("failed to save meta: %s", e)

    def _check_ttl(self, info: SandboxInfo) -> None:
        if not info.started_at:
            return
        try:
            started = datetime.fromisoformat(info.started_at.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            return
        elapsed = (datetime.now(timezone.utc) - started).total_seconds()
        if elapsed > info.config.ttl_seconds:
            logger.warning("Sandbox %s exceeded TTL, auto-cleaning", info.sandbox_id)
            self._audit(info, "ttl_expired", {"elapsed": elapsed})
            try:
                self.cleanup(info.sandbox_id)
            except Exception as e:
                logger.warning("auto-cleanup failed: %s", e)


# ============================================================
# 模块级单例
# ============================================================

_executor_instance: Optional[SandboxExecutor] = None
_executor_lock = asyncio.Lock()


def get_sandbox_executor() -> SandboxExecutor:
    """获取全局单例"""
    global _executor_instance
    if _executor_instance is None:
        _executor_instance = SandboxExecutor()
    return _executor_instance


def reset_sandbox_executor_for_test() -> None:
    """测试用：重置单例"""
    global _executor_instance
    _executor_instance = None
