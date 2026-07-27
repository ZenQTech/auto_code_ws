"""
# ============================================================
# External MCP Server - 外部 MCP 服务器管理
# ============================================================
# 核心作用：管理外部 MCP 服务器的生命周期
# 支持传输：
#   - stdio: 子进程 + JSONL over stdin/stdout
#   - streamable_http: HTTPS 远程端点
#   - sse: Server-Sent Events（已废弃但保留兼容）
# 创建日期：2026-07-27
# 模块版本：v1.0.0
# ============================================================
"""

import asyncio
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Awaitable, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)


# ============================================================
# 数据模型
# ============================================================

class MCPTransport(str, Enum):
    """MCP 传输方式"""
    STDIO = "stdio"
    STREAMABLE_HTTP = "streamable_http"
    SSE = "sse"


class MCPServerStatus(str, Enum):
    """外部 server 状态"""
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    CRASHED = "crashed"
    STOPPING = "stopping"


@dataclass
class ExternalMCPServerConfig:
    """外部 MCP server 配置"""
    id: str = ""
    name: str = ""
    transport: MCPTransport = MCPTransport.STDIO
    command: Optional[str] = None
    args: List[str] = field(default_factory=list)
    url: Optional[str] = None
    env: Dict[str, str] = field(default_factory=dict)
    headers: Dict[str, str] = field(default_factory=dict)
    enabled: bool = True
    startup_timeout_sec: int = 20
    tool_timeout_sec: int = 120
    auto_restart: bool = True
    max_restarts: int = 3
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def __post_init__(self):
        """
        后处理：
          - 自动生成 id（如果为空）
          - 校验 transport 类型
          - 校验 name 不为空
        """
        # 自动生成 ID
        if not self.id:
            self.id = f"mcp-{uuid.uuid4().hex[:12]}"
        # 校验 transport
        if isinstance(self.transport, str):
            try:
                self.transport = MCPTransport(self.transport)
            except ValueError as e:
                raise ValueError(
                    f"无效传输类型: {self.transport}（支持: {[t.value for t in MCPTransport]}）"
                ) from e
        # 校验 name
        if not self.name or not self.name.strip():
            raise ValueError("name 不能为空")
        # 校验 stdio 模式必须有 command
        if self.transport == MCPTransport.STDIO and not self.command:
            raise ValueError("stdio 模式必须指定 command")
        # 校验 HTTP 模式必须有 url
        if self.transport in (MCPTransport.STREAMABLE_HTTP, MCPTransport.SSE) and not self.url:
            raise ValueError(f"{self.transport.value} 模式必须指定 url")

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "transport": self.transport.value,
            "command": self.command,
            "args": self.args,
            "url": self.url,
            "env": self.env,
            "headers": self.headers,
            "enabled": self.enabled,
            "startup_timeout_sec": self.startup_timeout_sec,
            "tool_timeout_sec": self.tool_timeout_sec,
            "auto_restart": self.auto_restart,
            "max_restarts": self.max_restarts,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ExternalMCPServerConfig":
        return cls(
            id=data["id"],
            name=data["name"],
            transport=MCPTransport(data["transport"]),
            command=data.get("command"),
            args=data.get("args", []),
            url=data.get("url"),
            env=data.get("env", {}),
            headers=data.get("headers", {}),
            enabled=data.get("enabled", True),
            startup_timeout_sec=data.get("startup_timeout_sec", 20),
            tool_timeout_sec=data.get("tool_timeout_sec", 120),
            auto_restart=data.get("auto_restart", True),
            max_restarts=data.get("max_restarts", 3),
        )


# ============================================================
# Stdio MCP Server（子进程模式）
# ============================================================

class StdioMCPServer:
    """
    stdio 模式的 MCP server
    - 通过 asyncio 子进程与 MCP server 通信
    - JSON-RPC 消息以换行符分隔
    - 自动重启机制
    """

    def __init__(self, config: ExternalMCPServerConfig):
        self.config = config
        self.process: Optional[asyncio.subprocess.Process] = None
        self.initialized = False
        self.status = MCPServerStatus.STOPPED
        self.start_time: Optional[float] = None
        self.restart_count = 0
        self.request_id = 0
        self.logs: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()
        self._reader_task: Optional[asyncio.Task] = None
        self._response_futures: Dict[str, asyncio.Future] = {}

    def _next_id(self) -> str:
        self.request_id += 1
        return str(self.request_id)

    def _log(self, level: str, message: str):
        entry = {
            "ts": time.time(),
            "level": level,
            "message": message,
        }
        self.logs.append(entry)
        if len(self.logs) > 1000:
            self.logs = self.logs[-500:]

    async def start(self) -> bool:
        """启动子进程"""
        if self.status == MCPServerStatus.RUNNING:
            return True

        if not self.config.command:
            self._log("error", "stdio server 必须指定 command")
            return False

        self.status = MCPServerStatus.STARTING
        self._log("info", f"启动 stdio server: {self.config.command} {' '.join(self.config.args)}")

        try:
            # 合并环境变量
            env = os.environ.copy()
            env.update(self.config.env)

            self.process = await asyncio.create_subprocess_exec(
                self.config.command,
                *self.config.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )

            # 启动读取协程
            self._reader_task = asyncio.create_task(self._read_loop())

            # 等待 initialize 成功
            try:
                await asyncio.wait_for(
                    self._initialize(),
                    timeout=self.config.startup_timeout_sec,
                )
            except asyncio.TimeoutError:
                self._log("error", f"initialize 超时（{self.config.startup_timeout_sec}s）")
                await self.stop()
                return False

            self.status = MCPServerStatus.RUNNING
            self.start_time = time.time()
            self._log("info", f"stdio server 启动成功（pid={self.process.pid}）")
            return True

        except Exception as e:
            self._log("error", f"启动失败: {e}")
            self.status = MCPServerStatus.CRASHED
            return False

    async def stop(self):
        """停止子进程"""
        if self.status == MCPServerStatus.STOPPED:
            return

        self.status = MCPServerStatus.STOPPING
        self._log("info", "停止 stdio server")

        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass

        if self.process:
            try:
                self.process.terminate()
                await asyncio.wait_for(self.process.wait(), timeout=5)
            except asyncio.TimeoutError:
                self.process.kill()
                await self.process.wait()
            except Exception as e:
                self._log("error", f"停止失败: {e}")
            self.process = None

        self.initialized = False
        self.status = MCPServerStatus.STOPPED
        self._log("info", "stdio server 已停止")

    async def restart(self) -> bool:
        """重启"""
        await self.stop()
        await asyncio.sleep(0.5)
        self.restart_count += 1
        return await self.start()

    async def _initialize(self):
        """发送 initialize 请求"""
        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "hermes-mcp-client", "version": "1.0.0"},
            },
        }
        await self._send(request)
        # 等待响应（_read_loop 会处理）

    async def list_tools(self) -> List[Dict[str, Any]]:
        """列出工具"""
        if not self.initialized:
            await self._initialize()

        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/list",
            "params": {},
        }
        response = await self._send(request)
        return response.get("result", {}).get("tools", [])

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        """调用工具"""
        if not self.initialized:
            await self._initialize()

        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        response = await self._send(request)
        return response.get("result", {})

    async def _send(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """发送 JSON-RPC 请求并等待响应"""
        if not self.process or not self.process.stdin:
            return {"error": {"code": -1, "message": "Process not running"}}

        req_id = request.get("id")
        future = asyncio.get_event_loop().create_future()
        self._response_futures[req_id] = future

        try:
            line = json.dumps(request) + "\n"
            self.process.stdin.write(line.encode())
            await self.process.stdin.drain()
        except Exception as e:
            self._log("error", f"发送失败: {e}")
            return {"error": {"code": -1, "message": str(e)}}

        try:
            response = await asyncio.wait_for(
                future,
                timeout=self.config.tool_timeout_sec,
            )
            return response
        except asyncio.TimeoutError:
            self._log("error", f"请求 {req_id} 超时")
            return {"error": {"code": -1, "message": "Request timeout"}}
        finally:
            self._response_futures.pop(req_id, None)

    async def _read_loop(self):
        """持续读取子进程输出"""
        try:
            while self.process and self.process.stdout:
                line = await self.process.stdout.readline()
                if not line:
                    break

                try:
                    msg = json.loads(line.decode().strip())
                except json.JSONDecodeError:
                    self._log("warn", f"无法解析消息: {line[:200]}")
                    continue

                # 处理响应
                if "id" in msg and msg["id"] in self._response_futures:
                    future = self._response_futures[msg["id"]]
                    if not future.done():
                        future.set_result(msg)

                # 处理 initialized 通知
                if msg.get("method") == "initialized" or (
                    "result" in msg and not self.initialized
                ):
                    self.initialized = True

        except asyncio.CancelledError:
            pass
        except Exception as e:
            self._log("error", f"读取循环错误: {e}")
        finally:
            if self.status == MCPServerStatus.RUNNING:
                self.status = MCPServerStatus.CRASHED
                self._log("error", "stdio server 异常退出")
                if self.config.auto_restart and self.restart_count < self.config.max_restarts:
                    asyncio.create_task(self._auto_restart())

    async def _auto_restart(self):
        """自动重启"""
        await asyncio.sleep(3)
        if self.config.auto_restart and self.restart_count < self.config.max_restarts:
            self._log("info", f"自动重启（第 {self.restart_count + 1} 次）")
            await self.restart()

    def get_status(self) -> Dict[str, Any]:
        """获取状态"""
        uptime = int(time.time() - self.start_time) if self.start_time else 0
        return {
            "id": self.config.id,
            "name": self.config.name,
            "status": self.status.value,
            "uptime_sec": uptime,
            "restart_count": self.restart_count,
            "pid": self.process.pid if self.process else None,
            "initialized": self.initialized,
        }

    def get_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        return self.logs[-limit:]


# ============================================================
# Streamable HTTP MCP Server
# ============================================================

class StreamableHTTPMCPServer:
    """
    Streamable HTTP 模式的 MCP server
    - 通过 HTTPS POST 发送 JSON-RPC 请求
    - 响应为 JSON
    - 暂不实现 SSE 流式（可扩展）
    """

    def __init__(self, config: ExternalMCPServerConfig):
        self.config = config
        self.initialized = False
        self.status = MCPServerStatus.STOPPED
        self.start_time: Optional[float] = None
        self.restart_count = 0
        self.request_id = 0
        self.logs: List[Dict[str, Any]] = []
        self.tools: List[Dict[str, Any]] = []

    def _next_id(self) -> str:
        self.request_id += 1
        return str(self.request_id)

    def _log(self, level: str, message: str):
        entry = {"ts": time.time(), "level": level, "message": message}
        self.logs.append(entry)
        if len(self.logs) > 1000:
            self.logs = self.logs[-500:]

    async def start(self) -> bool:
        """HTTP server 标记为运行状态（无子进程）"""
        if not self.config.url:
            self._log("error", "HTTP server 必须指定 url")
            return False

        self.status = MCPServerStatus.STARTING
        self._log("info", f"连接 HTTP server: {self.config.url}")

        try:
            # 简单的健康检查：尝试 initialize
            await self._initialize()
            self.status = MCPServerStatus.RUNNING
            self.start_time = time.time()
            self._log("info", "HTTP server 连接成功")
            return True
        except Exception as e:
            self._log("error", f"连接失败: {e}")
            self.status = MCPServerStatus.CRASHED
            return False

    async def stop(self):
        """停止 HTTP server"""
        self.status = MCPServerStatus.STOPPED
        self.initialized = False
        self._log("info", "HTTP server 已停止")

    async def restart(self) -> bool:
        await self.stop()
        await asyncio.sleep(0.5)
        self.restart_count += 1
        return await self.start()

    async def _send_http(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """发送 HTTP 请求"""
        import urllib.request
        import urllib.error

        data = json.dumps(request).encode()
        headers = {"Content-Type": "application/json", **self.config.headers}

        req = urllib.request.Request(
            self.config.url,
            data=data,
            headers=headers,
            method="POST",
        )

        loop = asyncio.get_event_loop()
        try:
            response = await asyncio.wait_for(
                loop.run_in_executor(
                    None,
                    lambda: urllib.request.urlopen(req, timeout=self.config.tool_timeout_sec),
                ),
                timeout=self.config.tool_timeout_sec,
            )
            return json.loads(response.read().decode())
        except Exception as e:
            self._log("error", f"HTTP 请求失败: {e}")
            return {"error": {"code": -1, "message": str(e)}}

    async def _initialize(self):
        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "hermes-mcp-client", "version": "1.0.0"},
            },
        }
        response = await self._send_http(request)
        if "error" in response:
            raise Exception(f"Initialize failed: {response['error']}")
        self.initialized = True

    async def list_tools(self) -> List[Dict[str, Any]]:
        if not self.initialized:
            await self._initialize()

        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/list",
            "params": {},
        }
        response = await self._send_http(request)
        self.tools = response.get("result", {}).get("tools", [])
        return self.tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
        if not self.initialized:
            await self._initialize()

        request = {
            "jsonrpc": "2.0",
            "id": self._next_id(),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        response = await self._send_http(request)
        return response.get("result", {})

    def get_status(self) -> Dict[str, Any]:
        uptime = int(time.time() - self.start_time) if self.start_time else 0
        return {
            "id": self.config.id,
            "name": self.config.name,
            "status": self.status.value,
            "uptime_sec": uptime,
            "restart_count": self.restart_count,
            "initialized": self.initialized,
        }

    def get_logs(self, limit: int = 100) -> List[Dict[str, Any]]:
        return self.logs[-limit:]


# ============================================================
# External MCP Server Manager（统一管理）
# ============================================================

class ExternalMCPManager:
    """
    外部 MCP server 管理器
    - 单例模式
    - 配置持久化到 ~/.hermes/mcp_servers.json
    - 提供 CRUD + 生命周期管理
    """

    _instance: Optional["ExternalMCPManager"] = None

    def __init__(self, config_path: Optional[str] = None):
        if config_path is None:
            config_path = os.path.expanduser("~/.hermes/mcp_servers.json")

        self.config_path = Path(config_path)
        self.servers: Dict[str, Any] = {}  # id -> StdioMCPServer | StreamableHTTPMCPServer
        self.configs: Dict[str, ExternalMCPServerConfig] = {}
        self._load_configs()
        logger.info(f"ExternalMCPManager 初始化完成（path={self.config_path}）")

    @classmethod
    def get_instance(cls) -> "ExternalMCPManager":
        if cls._instance is None:
            cls._instance = ExternalMCPManager()
        return cls._instance

    def _load_configs(self):
        """从文件加载配置"""
        if not self.config_path.exists():
            return

        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                for cfg_data in data.get("servers", []):
                    config = ExternalMCPServerConfig.from_dict(cfg_data)
                    self.configs[config.id] = config
        except Exception as e:
            logger.error(f"加载配置失败: {e}")

    def _save_configs(self):
        """保存配置到文件"""
        self.config_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            data = {"servers": [cfg.to_dict() for cfg in self.configs.values()]}
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"保存配置失败: {e}")

    def register(self, config: ExternalMCPServerConfig) -> ExternalMCPServerConfig:
        """注册新 server"""
        # 检查 name 唯一性
        for existing in self.configs.values():
            if existing.name == config.name and existing.id != config.id:
                raise ValueError(f"Server name '{config.name}' 已存在")

        if not config.id:
            config.id = str(uuid.uuid4())
        config.updated_at = time.time()

        self.configs[config.id] = config
        self._save_configs()
        logger.info(f"注册外部 MCP server: {config.name} ({config.transport.value})")
        return config

    def unregister(self, server_id: str) -> bool:
        """注销 server"""
        if server_id not in self.configs:
            return False

        # 停止运行中的 server
        if server_id in self.servers:
            asyncio.create_task(self.servers[server_id].stop())
            del self.servers[server_id]

        del self.configs[server_id]
        self._save_configs()
        logger.info(f"注销外部 MCP server: {server_id}")
        return True

    async def start(self, server_id: str) -> bool:
        """启动 server"""
        if server_id not in self.configs:
            return False

        config = self.configs[server_id]
        if not config.enabled:
            logger.info(f"Server {config.name} 已禁用，跳过启动")
            return False

        # 创建实例
        if config.transport == MCPTransport.STDIO:
            server = StdioMCPServer(config)
        elif config.transport in (MCPTransport.STREAMABLE_HTTP, MCPTransport.SSE):
            server = StreamableHTTPMCPServer(config)
        else:
            logger.error(f"不支持的传输: {config.transport}")
            return False

        success = await server.start()
        if success:
            self.servers[server_id] = server
        return success

    async def stop(self, server_id: str) -> bool:
        """停止 server"""
        if server_id not in self.servers:
            return False
        await self.servers[server_id].stop()
        del self.servers[server_id]
        return True

    async def restart(self, server_id: str) -> bool:
        """重启 server"""
        if server_id not in self.configs:
            return False
        if server_id in self.servers:
            await self.stop(server_id)
        return await self.start(server_id)

    def get_status(self, server_id: str) -> Optional[Dict[str, Any]]:
        """获取状态"""
        if server_id in self.servers:
            return self.servers[server_id].get_status()
        if server_id in self.configs:
            cfg = self.configs[server_id]
            return {
                "id": cfg.id,
                "name": cfg.name,
                "status": MCPServerStatus.STOPPED.value,
                "uptime_sec": 0,
                "restart_count": 0,
                "initialized": False,
            }
        return None

    def get_logs(self, server_id: str, limit: int = 100) -> List[Dict[str, Any]]:
        if server_id in self.servers:
            return self.servers[server_id].get_logs(limit)
        return []

    def list_servers(self) -> List[Dict[str, Any]]:
        """列出所有 server（配置 + 状态）"""
        result = []
        for cfg in self.configs.values():
            status = self.get_status(cfg.id)
            result.append({
                **cfg.to_dict(),
                **status,
            })
        return result

    async def call_tool(
        self,
        server_id: str,
        tool_name: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        """调用工具"""
        if server_id not in self.servers:
            return {
                "success": False,
                "error": "Server not running",
            }
        try:
            result = await self.servers[server_id].call_tool(tool_name, arguments)
            return {"success": True, "result": result}
        except Exception as e:
            return {"success": False, "error": str(e)}


# 全局单例
_manager_instance: Optional[ExternalMCPManager] = None


def get_external_mcp_manager() -> ExternalMCPManager:
    """获取全局外部 MCP 管理器（单例）"""
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = ExternalMCPManager()
    return _manager_instance
