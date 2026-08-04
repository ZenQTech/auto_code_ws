"""
# ============================================================
# SandboxManager - 沙箱抽象与资源限制 (v1.0.0)
# Cycle 61 G61-01-T3
# ============================================================
# 核心作用：提供统一的沙箱选择 / 创建 / 销毁 / 资源限制能力，
#   抽象 Docker / gVisor / firejail / none 多种实现。
# 运行流程：
#   1. 调用 acquire() 或 acquire_auto() 获取沙箱
#   2. SandboxManager 按优先级探测可用沙箱（Docker > gVisor > firejail > none）
#   3. 返回 SandboxResult 包含 sandbox_type 与额外参数
#   4. 进程结束后调用 release() 释放资源
# 设计要点：
#   - 异步优先：所有探测为非阻塞
#   - 失败降级：探测失败时自动降级到 none
#   - 资源限制：cpu_quota / mem_limit_mb 注入到 subprocess 环境
#   - 健康检查：可选定期检查 Docker daemon
# 输入参数：sandbox_type (Optional[SandboxType]), cpu_quota (float), mem_limit_mb (int)
# 输出结果：SandboxResult / bool (release)
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 61 G61-01-T3 初次创建
# ====================================
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import subprocess
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据模型
# ============================================================

class SandboxType(str, Enum):
    """支持的沙箱类型（按优先级降序）"""
    DOCKER = "docker"
    GVISOR = "gvisor"
    FIREJAIL = "firejail"
    NONE = "none"


# 沙箱优先级
SANDBOX_PRIORITY: List[SandboxType] = [
    SandboxType.DOCKER,
    SandboxType.GVISOR,
    SandboxType.FIREJAIL,
    SandboxType.NONE,
]


@dataclass
class SandboxResult:
    """沙箱分配结果"""
    sandbox_type: SandboxType
    acquired_at: float
    cpu_quota: float
    mem_limit_mb: int
    extra_env: Dict[str, str] = field(default_factory=dict)
    extra_args: List[str] = field(default_factory=list)
    is_fallback: bool = False  # 是否为降级结果


@dataclass
class _SandboxInfo:
    """内部追踪：每个沙箱的健康状态"""
    sandbox_type: SandboxType
    available: bool
    last_check: float
    binary_path: Optional[str] = None


# ============================================================
# SandboxManager
# ============================================================

class SandboxManager:
    """
    沙箱管理器：探测 / 选择 / 分配 / 释放

    探测策略：
      - 启动时一次性探测所有沙箱可用性
      - 健康检查间隔：60 秒
      - 失败时自动降级到 NONE
    """

    HEALTH_CHECK_INTERVAL = 60.0  # 秒

    def __init__(self) -> None:
        self._info: Dict[SandboxType, _SandboxInfo] = {}
        self._lock = asyncio.Lock()
        self._initialized = False

    # --------------------------------------------------------
    # 探测
    # --------------------------------------------------------

    async def initialize(self) -> None:
        """
        初始化：探测所有沙箱可用性。
        必须在使用前调用一次（也可隐式调用）。
        """
        async with self._lock:
            if self._initialized:
                return
            for s in SANDBOX_PRIORITY:
                available, binary = await self._probe(s)
                self._info[s] = _SandboxInfo(
                    sandbox_type=s,
                    available=available,
                    last_check=time.time(),
                    binary_path=binary,
                )
                logger.info(
                    f"SandboxManager: probed sandbox={s.value} available={available} "
                    f"binary={binary}"
                )
            self._initialized = True

    async def health_check(self, force: bool = False) -> Dict[SandboxType, bool]:
        """
        健康检查：返回所有沙箱的当前可用性。
        60 秒缓存；force=True 强制刷新。
        """
        async with self._lock:
            now = time.time()
            for s in SANDBOX_PRIORITY:
                info = self._info.get(s)
                if (
                    info is None
                    or force
                    or (now - info.last_check) > self.HEALTH_CHECK_INTERVAL
                ):
                    available, binary = await self._probe(s)
                    self._info[s] = _SandboxInfo(
                        sandbox_type=s,
                        available=available,
                        last_check=now,
                        binary_path=binary,
                    )
            return {
                s: self._info[s].available
                for s in SANDBOX_PRIORITY
                if s in self._info
            }

    # --------------------------------------------------------
    # 分配
    # --------------------------------------------------------

    async def acquire_auto(
        self, cpu_quota: float = 0.8, mem_limit_mb: int = 512
    ) -> SandboxResult:
        """
        按优先级自动选择第一个可用沙箱。
        若所有高级沙箱不可用 → 降级到 NONE（标记 is_fallback=True）。
        """
        if not self._initialized:
            await self.initialize()

        await self.health_check()
        async with self._lock:
            for s in SANDBOX_PRIORITY:
                info = self._info.get(s)
                if info and info.available:
                    return self._build_result(
                        s, cpu_quota, mem_limit_mb, is_fallback=(s == SandboxType.NONE)
                    )
            # 极端情况：NONE 也不可用（不应发生），仍然返回 NONE
            return self._build_result(
                SandboxType.NONE, cpu_quota, mem_limit_mb, is_fallback=True
            )

    async def acquire(
        self,
        sandbox_type: SandboxType,
        cpu_quota: float = 0.8,
        mem_limit_mb: int = 512,
    ) -> SandboxResult:
        """
        显式指定沙箱类型。若不可用 → 自动降级到 NONE。
        """
        if not self._initialized:
            await self.initialize()

        await self.health_check()
        async with self._lock:
            info = self._info.get(sandbox_type)
            if info and info.available:
                return self._build_result(
                    sandbox_type, cpu_quota, mem_limit_mb, is_fallback=False
                )
            # 降级
            logger.warning(
                f"SandboxManager: requested={sandbox_type.value} unavailable, "
                f"fallback to none"
            )
            return self._build_result(
                SandboxType.NONE, cpu_quota, mem_limit_mb, is_fallback=True
            )

    async def release(self, result: SandboxResult) -> bool:
        """
        释放沙箱资源（占位实现，子进程退出后系统自动回收）。
        """
        logger.debug(
            f"SandboxManager: release sandbox={result.sandbox_type.value}"
        )
        return True

    # --------------------------------------------------------
    # 内部辅助
    # --------------------------------------------------------

    async def _probe(self, sandbox_type: SandboxType) -> tuple[bool, Optional[str]]:
        """
        探测沙箱是否可用（通过检查二进制是否存在 / 服务可访问）。
        """
        if sandbox_type == SandboxType.NONE:
            return True, None  # NONE 永远可用

        binary_map = {
            SandboxType.DOCKER: "docker",
            SandboxType.GVISOR: "runsc",
            SandboxType.FIREJAIL: "firejail",
        }
        binary = binary_map.get(sandbox_type)
        if not binary:
            return False, None

        # 在线程池中执行，避免阻塞事件循环
        loop = asyncio.get_event_loop()
        try:
            exists = await loop.run_in_executor(None, shutil.which, binary)
            if not exists:
                return False, None

            # 对 Docker 额外检查 daemon 是否运行
            if sandbox_type == SandboxType.DOCKER:
                try:
                    proc = await asyncio.create_subprocess_exec(
                        binary,
                        "info",
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    )
                    await asyncio.wait_for(proc.wait(), timeout=2.0)
                    return proc.returncode == 0, exists
                except (asyncio.TimeoutError, OSError):
                    return False, exists
            return True, exists
        except Exception as e:
            logger.debug(f"SandboxManager: probe {sandbox_type.value} error: {e}")
            return False, None

    def _build_result(
        self,
        sandbox_type: SandboxType,
        cpu_quota: float,
        mem_limit_mb: int,
        is_fallback: bool,
    ) -> SandboxResult:
        """构造 SandboxResult + 注入资源参数"""
        extra_env: Dict[str, str] = {}
        extra_args: List[str] = []
        if sandbox_type == SandboxType.DOCKER:
            extra_args = [
                "--cpus", str(cpu_quota),
                "--memory", f"{mem_limit_mb}m",
            ]
        elif sandbox_type == SandboxType.GVISOR:
            extra_env["GVISOR_CPU_QUOTA"] = str(cpu_quota)
            extra_env["GVISOR_MEM_LIMIT_MB"] = str(mem_limit_mb)
        elif sandbox_type == SandboxType.FIREJAIL:
            extra_args = [
                f"--rlimit-cpu={int(cpu_quota * 100)}",
            ]

        return SandboxResult(
            sandbox_type=sandbox_type,
            acquired_at=time.time(),
            cpu_quota=cpu_quota,
            mem_limit_mb=mem_limit_mb,
            extra_env=extra_env,
            extra_args=extra_args,
            is_fallback=is_fallback,
        )


# ============================================================
# 全局单例
# ============================================================

_DEFAULT_MANAGER: Optional[SandboxManager] = None
_MANAGER_LOCK = asyncio.Lock()


async def get_sandbox_manager() -> SandboxManager:
    """获取全局默认 SandboxManager（单例，懒加载初始化）"""
    global _DEFAULT_MANAGER
    if _DEFAULT_MANAGER is None:
        async with _MANAGER_LOCK:
            if _DEFAULT_MANAGER is None:
                _DEFAULT_MANAGER = SandboxManager()
                await _DEFAULT_MANAGER.initialize()
    return _DEFAULT_MANAGER


def get_sandbox_manager_sync() -> SandboxManager:
    """获取全局默认 SandboxManager（同步版本，未初始化版本）"""
    global _DEFAULT_MANAGER
    if _DEFAULT_MANAGER is None:
        _DEFAULT_MANAGER = SandboxManager()
    return _DEFAULT_MANAGER
