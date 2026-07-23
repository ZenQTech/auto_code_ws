# 架构设计文档 (spec.md)

## 1. 模块视图

### 1.1 系统模块划分

```
┌─────────────────────────────────────────────────────────────────┐
│                    Hermes 智能体调度平台                          │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  frontend/   │  │  backend/    │  │  cli_integration/    │  │
│  │  React 19    │◄─┤  FastAPI     │──┤  StrategyRouter      │  │
│  │  TypeScript  │  │  (Web API)   │  │  AgentManager        │  │
│  │  Vite 6      │  │              │  │  CLIExecutor         │  │
│  └──────────────┘  └──────┬───────┘  └──────────┬───────────┘  │
│                           │                      │               │
│                           ▼                      ▼               │
│                    ┌──────────────┐  ┌──────────────────────┐  │
│                    │  hermes_     │  │  agv_fleet_ws/       │  │
│                    │  integration/│  │  (ROS2 C++ 模块)     │  │
│                    │  HermesExec  │  │  ┌─ agv_core/       │  │
│                    │  HermesMem   │  │  │  types, utils,   │  │
│                    └──────────────┘  │  │  lifecycle       │  │
│                                      │  ├─ agv_control/    │  │
│                                      │  │  cmd_mux,        │  │
│                                      │  │  odometry,       │  │
│                                      │  │  motion_ctrl     │  │
│                                      │  └─ agv_safety/     │  │
│                                      │     (待实现)        │  │
│                                      └──────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.2 模块职责

| 模块 | 职责 | 语言 | 关键组件 |
|------|------|------|---------|
| **frontend** | Web UI 交互层 | TypeScript/React | 会话管理、模式切换、用量监控 |
| **backend** | 业务逻辑与 API 网关 | Python/FastAPI | 工作流引擎、架构设计、智能体调度 |
| **cli_integration** | CLI 执行与策略路由 | Python | StrategyRouter, AgentManager, CLIExecutor |
| **hermes_integration** | Hermes AI 内核集成 | Python | HermesExecutor, HermesMemory |
| **agv_fleet_ws** | AGV 车队控制核心 | C++/ROS2 | 运动控制、里程计、安全看门狗 |

### 1.3 模块依赖关系

```
backend ──► cli_integration (执行子进程)
backend ──► hermes_integration (AI 推理)
backend ──► agv_fleet_ws (ROS2 桥接，通过 topic/service)
cli_integration ──► hermes_integration (策略路由)
```

**硬约束：无循环依赖，依赖方向统一为上层→下层。**

---

## 2. 接口契约

### 2.1 C++ 内部接口（agv_fleet_ws）

#### 2.1.1 CmdMux 命令多路复用器接口

```cpp
// 命令源枚举 - 按优先级排序（值越小优先级越高）
enum class CmdSource : uint8_t {
  SAFETY = 0,        // 最高优先级 - 安全看门狗
  LOCAL_PLANNER = 1,  // 局部规划器
  GLOBAL_PLANNER = 2, // 全局规划器
  MANUAL = 3,         // 手动控制
  // 新增：哨兵值，用于边界检查
  _COUNT = 4,         // 有效源数量（非实际源）
  INVALID = 255       // 无效源标记
};

// 接口约束：
// - submit(): 必须校验 source ∈ {SAFETY, LOCAL_PLANNER, GLOBAL_PLANNER, MANUAL}
// - get_effective(): 线程安全，必须返回有效 Twist 或零值
// - 所有数组访问必须使用 at() 或带边界检查的索引
```

#### 2.1.2 LifecycleManager 生命周期管理接口

```cpp
enum class Transition : uint8_t {
  CONFIGURE = 0,
  ACTIVATE = 1,
  DEACTIVATE = 2,
  CLEANUP = 3,
  SHUTDOWN = 4,
  ERROR = 5,
  _COUNT = 6  // 哨兵值
};

// 接口约束：
// - register_callback(): idx 必须 < _COUNT，否则抛出 std::out_of_range
// - trigger_transition(): 必须校验 transition 有效性后访问 callbacks_
// - 所有状态转换必须是原子操作
```

#### 2.1.3 字符串处理工具接口

```cpp
// agv_id_from_index: 生成 AGV ID
// 输入: int index (0-99)
// 输出: std::string "agv_XX"
// 约束: 必须使用 snprintf 限制缓冲区，buf 大小 ≥ 16

// index_from_agv_id: 从 ID 提取索引
// 输入: const std::string& agv_id
// 输出: int (索引值，失败返回 -1)
// 约束: 必须捕获 std::invalid_argument 和 std::out_of_range 异常
```

### 2.2 ROS2 通信接口

| 接口类型 | 名称 | 方向 | 数据类型 | QoS |
|---------|------|------|---------|-----|
| Topic | `/cmd_vel` | sub | geometry_msgs/Twist | QOS_CONTROL_DEPTH=1 |
| Topic | `/cmd_vel_limited` | sub | geometry_msgs/Twist | QOS_SAFETY_DEPTH=5 |
| Topic | `/cmd_vel_safe` | pub | geometry_msgs/Twist | QOS_CONTROL_DEPTH=1 |
| Topic | `/odom` | pub | nav_msgs/Odometry | QOS_SENSOR_DEPTH=10 |
| Topic | `/joint_states` | sub | sensor_msgs/JointState | QOS_SENSOR_DEPTH=10 |

### 2.3 Python 后端接口

| 端点 | 方法 | 路径 | 说明 |
|------|------|------|------|
| 健康检查 | GET | `/health` | 服务状态 |
| API 路由 | * | `/api/*` | 业务 API |
| WebSocket | WS | `/ws/*` | 实时通信 |

---

## 3. 安全与性能基线

### 3.1 安全基线

| 类别 | 要求 | 度量标准 |
|------|------|---------|
| **栈溢出防护** | 所有 C++ 数组访问必须带边界检查 | 0 个无检查访问点 |
| **缓冲区安全** | 禁止使用 `sprintf`/`strcpy`/`gets` 等不安全函数 | 0 个不安全函数调用 |
| **整数溢出** | 所有 `static_cast<size_t>` 前必须校验范围 | 0 个未校验转型 |
| **异常安全** | 所有 `std::stoi`/`std::stof` 必须 try-catch | 0 个未捕获异常点 |
| **线程安全** | 共享数据访问必须有 mutex 保护 | 0 个 data race |
| **编译安全** | 必须启用 `-fstack-protector-strong` | 编译参数强制包含 |
| **运行时安全** | 启用 AddressSanitizer (ASan) 测试 | CI 流水线必须通过 |

### 3.2 性能基线

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 控制循环频率 | 100Hz | ROS2 Wall Timer 统计 |
| 急停响应延迟 | ≤ 10ms | 从传感器到 cmd_vel 归零 |
| 障碍物响应延迟 | ≤ 50ms | 从检测到减速指令 |
| 命令超时 | 200ms (局部) / 500ms (全局) | CmdMux 超时检查 |
| 里程计更新频率 | 100Hz | 与 joint_states 同步 |
| 后端 API 响应 | ≤ 200ms (P99) | FastAPI 中间件统计 |
| 可用性目标 | 99.9% | 正常运行时间 / 总时间 |

### 3.3 可靠性约束

| 约束 | 描述 |
|------|------|
| 安全优先 | 任何异常必须触发安全停止（cmd_vel 归零），不能导致失控 |
| 故障隔离 | 单个 AGV 节点故障不影响其他 AGV 运行 |
| 优雅降级 | 传感器数据丢失时维持最后已知安全状态 |
| 看门狗 | Safety Watchdog 节点独立于控制节点，硬件级定时器 |

---

## 4. 技术选型

### 4.1 C++ 层（agv_fleet_ws）

| 组件 | 选型 | 版本 | 说明 |
|------|------|------|------|
| 编译标准 | C++17 | - | 结构化绑定、if constexpr |
| 构建系统 | CMake | ≥ 3.22 | ROS2 Humble 要求 |
| ROS2 | Humble Hawksbill | LTS | 2027 年 5 月 EOL |
| 编译器 | GCC | ≥ 11 | 默认栈保护已启用 |
| 静态分析 | clang-tidy | ≥ 14 | 强制 CI 检查 |
| 动态分析 | AddressSanitizer | - | 测试阶段启用 |
| 未定义行为 | UBSan | - | 测试阶段启用 |

### 4.2 Python 层（backend + cli_integration）

| 组件 | 选型 | 版本 |
|------|------|------|
| Web 框架 | FastAPI | ≥ 0.110 |
| ORM | SQLAlchemy (Async) | ≥ 2.0 |
| 数据校验 | Pydantic | v2 |
| 数据库 | SQLite | 3 |
| HTTP 客户端 | httpx | ≥ 0.28 |
| 服务器 | Uvicorn | ≥ 0.27 |

### 4.3 前端（frontend）

| 组件 | 选型 | 版本 |
|------|------|------|
| 框架 | React | 19 |
| 语言 | TypeScript | 5.6 |
| 构建 | Vite | 6 |
| 样式 | Tailwind CSS | 3.4 |

### 4.4 编译安全配置

```cmake
# CMakeLists.txt 强制安全编译选项
add_compile_options(
  -fstack-protector-strong   # 栈溢出保护
  -fstack-clash-protection   # 栈冲突保护
  -D_FORTIFY_SOURCE=2        # 编译期缓冲区检查
  -Wformat=2                 # 格式化字符串检查
  -Wconversion               # 隐式类型转换警告
  -Wall -Wextra -Werror      # 所有警告视为错误
)

# Debug 构建额外启用
set(CMAKE_CXX_FLAGS_DEBUG "${CMAKE_CXX_FLAGS_DEBUG} -fsanitize=address -fsanitize=undefined")
```

---

## 5. 部署架构

### 5.1 部署拓扑

```
┌──────────────────────────────────────────────────────────┐
│                    Edge Computing Node                     │
│  ┌─────────────────────┐  ┌───────────────────────────┐  │
│  │  agv_fleet_ws        │  │  backend (FastAPI)        │  │
│  │  - motion_controller │  │  - workflow_engine         │  │
│  │  - safety_watchdog   │  │  - hermes_service          │  │
│  │  - cmd_mux           │  │  - agent_manager           │  │
│  │                      │  │                            │  │
│  │  ROS2 DDS ──────────►│  │  HTTP/WS ◄── frontend     │  │
│  └─────────────────────┘  └───────────────────────────┘  │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  Gazebo Simulator (仿真模式)                          │ │
│  │  - 物理引擎    - 传感器模型    - 世界模型              │ │
│  └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 5.2 资源需求

| 组件 | CPU | 内存 | 磁盘 | 网络 |
|------|-----|------|------|------|
| agv_fleet_ws (单 AGV) | 1 核 | 256MB | 50MB | DDS 本地 |
| backend | 2 核 | 512MB | 200MB | HTTP/WS |
| frontend | - | - | 5MB (静态) | HTTP |
| Gazebo | 4 核 | 2GB | 1GB | - |

### 5.3 运行模式

| 模式 | 描述 | 前置条件 |
|------|------|---------|
| 仿真模式 | 使用 Gazebo 模拟 AGV | Gazebo + ROS2 已安装 |
| 实机模式 | 连接真实 AGV 硬件 | 硬件驱动 + 安全 PLC 就绪 |
| 开发模式 | 仅后端 + 前端 | 无 ROS2 依赖 |