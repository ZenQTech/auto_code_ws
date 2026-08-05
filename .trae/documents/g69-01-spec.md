# G69-01 SandboxExecutor 容器隔离执行器 - Spec 文档

**Cycle**: 69
**优先级**: P0
**对标**: Codex codex-sandbox + Docker Sandboxes + codex-lockbox
**作者**: 总架构师
**生成时间**: 2026-08-05

---

## 1. 功能需求描述

### 1.1 目标
为智能体执行提供多层隔离保护，实现：
- **进程级隔离**: 防止 agent 访问敏感目录（~/.ssh、/etc/、其他项目）
- **网络级隔离**: 默认拒绝所有出站，仅允许白名单域名（LLM API、GitHub）
- **资源级限制**: 防止 agent 耗尽 CPU/Memory/Disk
- **审计级追溯**: 每个 sandbox 操作的完整记录

### 1.2 用户场景
- **场景 1**: 用户希望 agent 自主运行但不影响主机（最高安全要求）
- **场景 2**: CI/CD 集成，无头环境运行 `codex exec`
- **场景 3**: 多项目并发，agent A 不能访问 agent B 的工作区
- **场景 4**: 调试 agent 行为，需要完整审计日志

### 1.3 使用流程
```
1. 用户/agent_manager 创建 sandbox（指定 work_dir + resource preset）
2. SandboxExecutor 启动 Docker 容器（或 bubblewrap fallback）
3. 应用网络白名单 + 资源限制
4. 在容器内执行 CLI 命令（注入必要 env）
5. 收集 stdout/stderr + 审计日志
6. 销毁 sandbox（默认）或保留（可配置）
```

---

## 2. 技术实现方案

### 2.1 架构设计
```
┌─────────────────────────────────────────┐
│     AgentManager / HermesService        │
└─────────────────┬───────────────────────┘
                  │ create_sandbox()
                  ▼
┌─────────────────────────────────────────┐
│          SandboxExecutor                │
│  - lifecycle: create/start/stop/cleanup │
│  - policy: network/resource/fs          │
│  - audit: per-sandbox log               │
└─────────────────┬───────────────────────┘
                  │
        ┌─────────┴─────────┐
        ▼                   ▼
┌──────────────┐   ┌──────────────────┐
│ DockerBackend│   │ BubblewrapBackend│
│  (主)        │   │  (Linux fallback)│
└──────────────┘   └──────────────────┘
```

### 2.2 核心数据结构
```python
@dataclass
class SandboxConfig:
    work_dir: str                    # 必填
    resource_preset: str = "default" # small/medium/large/xlarge
    network_policy: NetworkPolicy    # 默认 deny + allowlist
    fs_policy: FsPolicy              # 默认仅 work_dir
    init_hook: Optional[str]         # 容器启动前执行
    env_vars: Dict[str, str] = field(default_factory=dict)
    auto_cleanup: bool = True        # 完成后自动销毁
    ttl_seconds: int = 3600          # 最长存活时间

@dataclass
class NetworkPolicy:
    mode: str = "deny"               # deny | allow-all
    allowed_domains: List[str]       # 白名单
    allowed_ports: List[int] = [443, 80]

@dataclass
class ResourceLimits:
    cpu_count: float = 2.0
    memory_mb: int = 4096
    disk_mb: int = 10240
    gpu_count: int = 0

@dataclass
class SandboxResult:
    sandbox_id: str
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    resource_usage: ResourceUsage   # 实际使用
    audit_log_path: str             # 审计日志路径
```

### 2.3 核心算法

#### 2.3.1 Docker Backend
```python
def _create_docker_sandbox(config: SandboxConfig) -> Sandbox:
    cmd = [
        "docker", "run", "-d",
        "--name", sandbox_id,
        "-v", f"{config.work_dir}:/workspace:rw",
        "-v", f"{auth_path}:/root/.codex/auth.json:ro",
        "-w", "/workspace",
        "-e", f"ANTHROPIC_API_KEY={api_key}",
        "--memory", f"{config.resource_limits.memory_mb}m",
        "--cpus", str(config.resource_limits.cpu_count),
        "--network", "codex-sandbox-net",  # 自定义网络
        "codex-sandbox:latest",
        "sleep", "infinity"  # 保持运行
    ]
    container_id = subprocess.check_output(cmd).decode().strip()
    return Sandbox(container_id=container_id, backend="docker")
```

#### 2.3.2 Network Firewall
```python
def _setup_network_policy(network_name: str, policy: NetworkPolicy):
    # 创建 iptables 规则
    subprocess.run([
        "iptables", "-I", "FORWARD", "-i", network_name,
        "-j", "DROP"  # 默认拒绝
    ])
    # 添加白名单
    for domain in policy.allowed_domains:
        ip = resolve_domain(domain)
        for port in policy.allowed_ports:
            subprocess.run([
                "iptables", "-I", "FORWARD", "-i", network_name,
                "-d", ip, "-p", "tcp", "--dport", str(port),
                "-j", "ACCEPT"
            ])
```

#### 2.3.3 Bubblewrap Fallback（Linux）
```python
def _create_bubblewrap_sandbox(config: SandboxConfig) -> Sandbox:
    cmd = [
        "bwrap",
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64",
        "--ro-bind", "/etc/resolv.conf", "/etc/resolv.conf",
        "--bind", config.work_dir, "/workspace",
        "--tmpfs", "/tmp",
        "--unshare-net",  # 默认无网络
        "--die-with-parent",
        "--", "sleep", "infinity"
    ]
    pid = subprocess.Popen(cmd)
    return Sandbox(pid=pid.pid, backend="bubblewrap")
```

---

## 3. 接口设计规范

### 3.1 Python API
```python
class SandboxExecutor:
    def create(self, config: SandboxConfig) -> Sandbox: ...
    def start(self, sandbox_id: str) -> None: ...
    def exec(self, sandbox_id: str, cmd: List[str], timeout: int = 600) -> SandboxResult: ...
    def stop(self, sandbox_id: str) -> None: ...
    def cleanup(self, sandbox_id: str) -> None: ...
    def list_sandboxes(self) -> List[SandboxInfo]: ...
    def get_stats(self) -> SandboxStats: ...
```

### 3.2 REST API（6 个端点）
```
POST   /api/sandbox/create       创建 sandbox
POST   /api/sandbox/{id}/start   启动 sandbox
POST   /api/sandbox/{id}/exec    在 sandbox 中执行命令
POST   /api/sandbox/{id}/stop    停止 sandbox
DELETE /api/sandbox/{id}         销毁 sandbox
GET    /api/sandbox/list         列出所有 sandbox
GET    /api/sandbox/{id}/audit   获取审计日志
GET    /api/sandbox/stats        获取全局统计
```

### 3.3 请求/响应模型
```python
class CreateSandboxRequest(BaseModel):
    work_dir: str
    resource_preset: str = "default"
    network_policy: Optional[NetworkPolicy] = None
    init_hook: Optional[str] = None
    env_vars: Dict[str, str] = {}
    ttl_seconds: int = 3600

class CreateSandboxResponse(BaseModel):
    sandbox_id: str
    backend: str  # docker | bubblewrap
    status: str   # created | running | stopped
    created_at: str

class ExecRequest(BaseModel):
    command: List[str]
    timeout: int = 600
    env: Dict[str, str] = {}

class ExecResponse(BaseModel):
    exit_code: int
    stdout: str
    stderr: str
    duration_ms: int
    resource_usage: Dict[str, Any]
```

### 3.4 错误码
| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 参数错误（work_dir 不存在、preset 无效） |
| 404 | sandbox_id 不存在 |
| 408 | 执行超时 |
| 409 | 资源冲突（端口、名称） |
| 500 | 后端失败（Docker 不可用、容器崩溃） |
| 503 | 资源耗尽（CPU/Memory/Disk） |

---

## 4. 数据结构定义

### 4.1 资源预设
```python
RESOURCE_PRESETS = {
    "small":   ResourceLimits(cpu_count=0.5, memory_mb=1024,  disk_mb=2048),
    "default": ResourceLimits(cpu_count=2.0, memory_mb=4096,  disk_mb=10240),
    "large":   ResourceLimits(cpu_count=4.0, memory_mb=8192,  disk_mb=51200),
    "xlarge":  ResourceLimits(cpu_count=8.0, memory_mb=16384, disk_mb=102400),
}
```

### 4.2 默认网络白名单
```python
DEFAULT_ALLOWED_DOMAINS = [
    "api.anthropic.com",     # Claude
    "api.openai.com",        # GPT
    "*.anthropic.com",
    "*.openai.com",
    "api.github.com",        # Git 操作
    "github.com",
    "raw.githubusercontent.com",
    "pypi.org",              # pip install
    "files.pythonhosted.org",
    "registry.npmjs.org",    # npm install
]
```

### 4.3 审计日志格式
```jsonl
{"ts": "2026-08-05T12:34:56Z", "sandbox_id": "sb-xxx", "event": "create", "config": {...}}
{"ts": "2026-08-05T12:35:01Z", "sandbox_id": "sb-xxx", "event": "exec", "cmd": ["npm", "test"], "exit_code": 0}
{"ts": "2026-08-05T12:35:30Z", "sandbox_id": "sb-xxx", "event": "resource_peak", "cpu": 1.8, "mem_mb": 2048}
{"ts": "2026-08-05T12:40:00Z", "sandbox_id": "sb-xxx", "event": "destroy", "reason": "ttl_expired"}
```

---

## 5. 性能与安全要求

### 5.1 性能
- 创建 sandbox: < 5s（Docker）/ < 100ms（bubblewrap）
- 命令执行启动延迟: < 50ms
- 资源监控采样: 1s 一次
- 单 sandbox 最大并发 exec: 1（串行）

### 5.2 安全
- **网络**: 默认 deny + 域名白名单（不允许 IP 直连）
- **文件系统**: 默认仅 work_dir 可写，其他系统目录只读
- **凭据**: API key 通过 env 注入，auth.json bind-mount ro
- **用户**: 容器内运行 non-root（uid 1000）
- **审计**: 所有 exec 操作记录，保留 30 天

### 5.3 资源限制
- 单 sandbox CPU 不超过 8 核
- 单 sandbox Memory 不超过 16GB
- 磁盘使用超过 80% 触发告警
- TTL 到期自动销毁（默认 1 小时）

---

## 6. 验收标准

### 6.1 功能验证（脚本自动测试）
| 测试项 | 标准 |
|--------|------|
| Docker 沙箱创建 | ✅ 5s 内成功启动 |
| 网络白名单生效 | ✅ api.anthropic.com 通，google.com 拒 |
| 资源限制生效 | ✅ CPU 限制触发 throttling |
| FileSystem 隔离 | ✅ /etc/passwd 不可写 |
| TTL 自动清理 | ✅ 过期后容器自动停止 |
| Bubblewrap fallback | ✅ Docker 不可用时切换 |
| Init hook 执行 | ✅ 容器启动前执行 sandbox-setup.sh |
| 审计日志完整 | ✅ 每个 event 有 JSONL 记录 |

### 6.2 测试项目（自动化）
1. `test_sandbox_executor.py` - SandboxExecutor 单元测试（25 个）
2. `test_docker_backend.py` - Docker backend 集成测试（10 个）
3. `test_bubblewrap_backend.py` - Bubblewrap fallback 测试（5 个）
4. `test_sandbox_api.py` - REST API 测试（10 个）
5. `test_network_policy.py` - 网络策略测试（8 个）
6. `test_resource_limits.py` - 资源限制测试（5 个）
7. **合计**: 63 个新测试，全部通过

### 6.3 测试项目（前端 Web 测试）
- [ ] EmbeddedTools 集成 Sandbox 面板
- [ ] 沙箱列表 UI 展示
- [ ] 创建/停止/清理按钮交互
- [ ] 审计日志查看器

### 6.4 通过条件
- 所有自动化测试 100% 通过
- 网络白名单在真实环境中验证
- 资源限制通过 stress-ng 验证
- 文档完整（spec + 实施报告）
