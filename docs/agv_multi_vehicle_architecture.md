# AGV 多车协同调度与导航系统（纯仿真验证） — 顶层架构设计文档

> 版本：v1.0  
> 编制：总架构师智能体  
> 日期：2026-07-01  
> 状态：初版（待批判评审）

---

## 目录

1. [修订记录](#1-修订记录)
2. [术语表与约定](#2-术语表与约定)
3. [顶层架构图](#3-顶层架构图)
4. [ROS2 节点拓扑设计](#4-ros2-节点拓扑设计)
5. [模块接口规范](#5-模块接口规范)
6. [技术选型建议](#6-技术选型建议)
7. [安全架构设计](#7-安全架构设计)
8. [仿真架构](#8-仿真架构)
9. [项目目录结构建议](#9-项目目录结构建议)
10. [不确定项处理清单](#10-不确定项处理清单)

---

## 1. 修订记录

| 版本 | 日期 | 修改内容 | 修改人 |
|------|------|----------|--------|
| v1.0 | 2026-07-01 | 初版创建 | 总架构师智能体 |

---

## 2. 术语表与约定

### 2.1 术语表

| 术语 | 含义 |
|------|------|
| AGV | Automated Guided Vehicle，自动导引车 |
| TOS | Transport Order Scheduler，运输任务调度器 |
| FMS | Fleet Management System，车队管理系统（本系统核心） |
| RCL | ROS2 Client Library，ROS2 客户端库 |
| DDS | Data Distribution Service，数据分发服务（ROS2 底层通信） |
| NAV | Navigation，导航（路径规划 + 定位 + 避障） |
| SIL | Safety Integrity Level，安全完整性等级 |
| SLC | Safety Logic Controller，安全逻辑控制器 |
| VFF | Virtual Force Field，虚拟力场法（避障） |
| TEB | Timed Elastic Band，定时弹性带（局部路径规划） |
| AMCL | Adaptive Monte Carlo Localization，自适应蒙特卡洛定位 |
| EKF | Extended Kalman Filter，扩展卡尔曼滤波 |

### 2.2 命名约定

| 类别 | 约定格式 | 示例 |
|------|----------|------|
| ROS2 包名 | `agv_<功能>` | `agv_scheduler`, `agv_navigation` |
| ROS2 节点名 | `<agv_id>_<功能>` | `agv_01_local_planner`, `central_scheduler` |
| Topic 名 | `/<domain>/<agv_id>/<功能>` | `/fleet/agv_01/cmd_vel`, `/fleet/task/assign` |
| Service 名 | `/<agv_id>/<功能>` | `/agv_01/emergency_stop`, `/fleet/scheduler/pause` |
| Action 名 | `/<agv_id>/<功能>` | `/agv_01/navigate_to_pose` |
| 参数名 | `<模块>.<参数>` | `safety.max_linear_speed` |
| 坐标系 | `map`, `odom`, `base_footprint`, `base_laser` | 遵循 REP 105 |

### 2.3 不确定项处理标注

本文档对所有不确定项统一采用「默认选择 + 扩展接口」策略，并标注以下标签：

- **[UNC-x]** — 引用需求文档中的不确定项编号
- **[DEFAULT]** — 当前采用的默认方案
- **[EXTENSION]** — 预留的扩展接口/扩展点

---

## 3. 顶层架构图

### 3.1 系统分层架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          应用层 (Application Layer)                          │
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────────────┐ │
│  │   Web 可视化    │  │   WMS REST API  │  │    CLI 管理工具            │ │
│  │   (Foxglove/    │  │   网关           │  │    (诊断/调试/日志)        │ │
│  │    自定义前端)   │  │                 │  │                            │ │
│  └────────┬────────┘  └────────┬────────┘  └───────────┬────────────────┘ │
└───────────┼────────────────────┼────────────────────────┼──────────────────┘
            │                    │                        │
┌───────────┼────────────────────┼────────────────────────┼──────────────────┐
│           ▼                    ▼                        ▼                   │
│                           业务层 (Business Logic Layer)                     │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │                    中心服务器 (Central Server)                        │ │
│  │  ┌──────────────┐ ┌────────────────┐ ┌───────────────────────────┐  │ │
│  │  │ 全局任务调度器 │ │ 车队管理       │ │ 交通管制 (Traffic Control) │  │ │
│  │  │ (Fleet        │ │ (Fleet Manager)│ │ - 交叉口管理               │  │ │
│  │  │  Scheduler)   │ │ - AGV 注册/    │ │ - 路径段锁                 │  │ │
│  │  │ - 任务分配    │ │   状态管理      │ │ - 死锁检测与解锁           │  │ │
│  │  │ - 优先级管理  │ │ - 电量管理     │ │                            │  │ │
│  │  │ - 负载均衡    │ │ - 充电调度     │ │                            │  │ │
│  │  └──────┬───────┘ └──────┬─────────┘ └───────────┬────────────────┘  │ │
│  └──────────────────────────┼────────────────────────┼───────────────────┘ │
│                             │                        │                      │
│  ┌──────────────────────────┼────────────────────────┼───────────────────┐ │
│  │                          ▼                        ▼                     │ │
│  │                      车载端 (Onboard - 每台 AGV)                        │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐  │ │
│  │  │ 全局路径规划  │ │ 局部路径规划  │ │ 传感器融合   │ │ 安全防护     │  │ │
│  │  │ (Global       │ │ (Local       │ │ 定位         │ │ (Safety)     │  │ │
│  │  │  Planner)     │ │  Planner)    │ │ (Localization)│ │              │  │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────────────────────┐
│                                        ▼                                    │
│                         核心算法层 (Core Algorithm Layer)                    │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │
│  │ A* /      │ │ TEB /    │ │ EKF /    │ │ 碰撞检测 │ │ 死锁检测        │ │
│  │ Hybrid A* │ │ DWA /    │ │ AMCL     │ │ (FCL /   │ │ (图着色/         │ │
│  │ 全局路径  │ │ VFF      │ │ 定位融合  │ │  GJK)   │ │  资源分配图)     │ │
│  │           │ │ 局部轨迹 │ │           │ │          │ │                  │ │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────────────────────┐
│                                        ▼                                    │
│                      硬件抽象层 / 仿真层 (HAL / Simulation Layer)            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │  ROS2 消息 / Service / Action 抽象接口层                              │  │
│  │  ┌────────────────────┐         ┌────────────────────────────────┐  │  │
│  │  │ 仿真模式 (Sim Mode)│         │ 硬件模式 (Real Mode) — 预留    │  │  │
│  │  │ - Gazebo Ignition  │         │ - 真实 LiDAR 驱动             │  │  │
│  │  │ - 仿真传感器插件   │         │ - 真实底盘驱动                │  │  │
│  │  │ - 仿真底盘控制插件  │         │ - 真实 IMU 驱动               │  │  │
│  │  └────────────────────┘         └────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 分层职责说明

| 层级 | 部署位置 | 职责 | 关键模块 |
|------|----------|------|----------|
| **应用层** | 中心服务器 / 独立前端 | 人机交互、外部系统对接 | Web 可视化、REST API 网关、CLI 工具 |
| **业务层** | 中心服务器 + 车载端 | 核心业务逻辑、调度决策、交通管制 | 任务调度器、车队管理器、交通管制、路径规划、安全防护 |
| **核心算法层** | 车载端 | 算法实现、计算密集型任务 | A*/Hybrid A*、TEB/DWA、EKF/AMCL、碰撞检测、死锁检测 |
| **硬件抽象层/仿真层** | 车载端 | 硬件抽象、仿真桥接 | Gazebo 接口、传感器驱动抽象、底盘控制抽象 |

### 3.3 层间接口关系

```
应用层 ──(REST/WebSocket)──▶ 业务层 (中心服务器)
                                │
                    ┌───────────┼───────────┐
                    │ (ROS2 DDS)│           │ (ROS2 DDS)
                    ▼           ▼           ▼
              业务层(车载端) ──(ROS2 DDS)──▶ 核心算法层
                                                │
                                                │ (ROS2 DDS)
                                                ▼
                                          硬件抽象层/仿真层
```

| 接口方向 | 协议 | 数据内容 | 频率 |
|----------|------|----------|------|
| 应用层 → 业务层(中心) | REST/WS | 任务请求、地图编辑、状态查询 | 按需 |
| 业务层(中心) → 业务层(车载) | ROS2 DDS | 任务分配、路径段、调度指令 | 100Hz |
| 业务层(车载) → 核心算法层 | ROS2 DDS | 目标位姿、规划请求 | ≤50ms |
| 核心算法层 → 硬件抽象层 | ROS2 DDS | 速度指令/cmd_vel | 100Hz |
| 硬件抽象层 → 核心算法层 | ROS2 DDS | 传感器数据(激光/IMU/里程计) | ≥50Hz |

---

## 4. ROS2 节点拓扑设计

### 4.1 节点清单与命名规范

#### 4.1.1 中心服务器节点（运行于中央工控机）

| 节点名 | ROS2 包 | 功能描述 | 语言 |
|--------|---------|----------|------|
| `central_scheduler` | `agv_scheduler` | 全局任务调度：任务分配、优先级管理、负载均衡 | C++ |
| `fleet_manager` | `agv_fleet_manager` | 车队管理：AGV 注册/注销、状态聚合、健康监控 | C++ |
| `traffic_controller` | `agv_traffic_control` | 交通管制：交叉口管理、路径段锁、死锁检测与解锁 | C++ |
| `charge_scheduler` | `agv_scheduler` | 充电调度：低电量触发、充电站分配 | C++ |
| `api_gateway` | `agv_api_gateway` | REST API 网关：WMS 对接、任务/状态查询 | Python |
| `web_bridge` | `agv_visualization` | WebSocket 桥接：转发 ROS2 话题到 Web 前端 | Python |
| `safety_monitor` | `agv_safety` | 全局安全监控：全车队急停、全局状态看门狗 | C++ |

#### 4.1.2 车载端节点（每台 AGV 各运行一份，共 10~20 份）

| 节点名 | ROS2 包 | 功能描述 | 语言 |
|--------|---------|----------|------|
| `agv_XX_global_planner` | `agv_navigation` | 全局路径规划：地图→最优路径（A*/Hybrid A*） | C++ |
| `agv_XX_local_planner` | `agv_navigation` | 局部路径规划：轨迹跟踪 + 动态避障（TEB/DWA） | C++ |
| `agv_XX_localization` | `agv_localization` | 传感器融合定位：EKF + AMCL | C++ |
| `agv_XX_controller` | `agv_control` | 底盘控制器：速度指令→底盘执行（仿真/真实） | C++ |
| `agv_XX_safety_controller` | `agv_safety` | 安全控制器：急停检测、速度限幅、碰撞保护 | C++ |
| `agv_XX_lifecycle` | `agv_core` | 生命周期管理：启动/停止/降级/恢复 | C++ |
| `agv_XX_sensor_fusion` | `agv_localization` | 传感器数据预处理与时间戳同步 | C++ |

#### 4.1.3 仿真专用节点（仅仿真模式运行）

| 节点名 | ROS2 包 | 功能描述 | 语言 |
|--------|---------|----------|------|
| `gazebo_bridge` | `agv_simulation` | Gazebo ↔ ROS2 桥接（ros_ign_bridge 封装） | C++ |
| `spawn_agv` | `agv_simulation` | 多 AGV 生成管理：批量生成/删除 AGV 模型 | Python |
| `scenario_manager` | `agv_simulation` | 仿真场景管理：动态障碍物、任务预设场景 | Python |
| `performance_monitor` | `agv_simulation` | 仿真性能监控：实时因子、资源占用 | Python |

### 4.2 节点间 Topic / Service / Action 接口定义

#### 4.2.1 核心 Topic 定义

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `/fleet/task/assign` | `agv_msgs/msg/TaskAssignment` | `central_scheduler` | 各 AGV `lifecycle` 节点 | 100Hz | RELIABLE |
| `/fleet/task/status` | `agv_msgs/msg/TaskStatus` | 各 AGV `lifecycle` | `central_scheduler` | 100Hz | RELIABLE |
| `/fleet/agv_XX/cmd_vel` | `geometry_msgs/msg/Twist` | `agv_XX_safety_controller` | `agv_XX_controller` | 100Hz | BEST_EFFORT |
| `/fleet/agv_XX/pose` | `nav_msgs/msg/Odometry` | `agv_XX_localization` | 各订阅者 | 50Hz | BEST_EFFORT |
| `/fleet/agv_XX/scan` | `sensor_msgs/msg/LaserScan` | Gazebo / 仿真传感器 | `agv_XX_local_planner`, `agv_XX_safety_controller` | 40Hz | BEST_EFFORT |
| `/fleet/agv_XX/imu` | `sensor_msgs/msg/Imu` | Gazebo / 仿真传感器 | `agv_XX_localization` | 100Hz | BEST_EFFORT |
| `/fleet/agv_XX/odom` | `nav_msgs/msg/Odometry` | `agv_XX_controller` | `agv_XX_localization` | 50Hz | BEST_EFFORT |
| `/fleet/agv_XX/global_path` | `nav_msgs/msg/Path` | `agv_XX_global_planner` | `agv_XX_local_planner` | 按需 | RELIABLE |
| `/fleet/agv_XX/local_path` | `nav_msgs/msg/Path` | `agv_XX_local_planner` | `agv_XX_controller` | 100Hz | BEST_EFFORT |
| `/fleet/agv_XX/emergency` | `agv_msgs/msg/EmergencyStatus` | `agv_XX_safety_controller` | 所有节点 | 100Hz | BEST_EFFORT |
| `/fleet/agv_XX/safety_state` | `agv_msgs/msg/SafetyState` | `agv_XX_safety_controller` | `safety_monitor` | 100Hz | RELIABLE |
| `/fleet/traffic/lock` | `agv_msgs/msg/PathSegmentLock` | `traffic_controller` | 各 AGV `lifecycle` | 按需 | RELIABLE |
| `/fleet/traffic/deadlock` | `agv_msgs/msg/DeadlockEvent` | `traffic_controller` | `central_scheduler` | 按需 | RELIABLE |
| `/fleet/monitor/telemetry` | `agv_msgs/msg/FleetTelemetry` | `fleet_manager` | `web_bridge`, `api_gateway` | 50Hz | BEST_EFFORT |
| `/fleet/charge/request` | `agv_msgs/msg/ChargeRequest` | 各 AGV `lifecycle` | `charge_scheduler` | 按需 | RELIABLE |

#### 4.2.2 核心 Service 定义

| Service 名称 | 服务类型 | 提供者 | 调用者 | 说明 |
|-------------|----------|--------|--------|------|
| `/fleet/scheduler/submit_task` | `agv_msgs/srv/SubmitTask` | `central_scheduler` | `api_gateway` | WMS 提交任务 |
| `/fleet/scheduler/cancel_task` | `agv_msgs/srv/CancelTask` | `central_scheduler` | `api_gateway` | 取消任务 |
| `/fleet/scheduler/pause` | `agv_msgs/srv/PauseResume` | `central_scheduler` | `api_gateway` | 暂停/恢复调度 |
| `/fleet/scheduler/query_task` | `agv_msgs/srv/QueryTask` | `central_scheduler` | `api_gateway` | 查询任务状态 |
| `/fleet/scheduler/query_agv` | `agv_msgs/srv/QueryAGV` | `fleet_manager` | `api_gateway` | 查询 AGV 状态 |
| `/agv_XX/emergency_stop` | `agv_msgs/srv/EmergencyStop` | `agv_XX_safety_controller` | 全局/外部 | 远程急停触发 |
| `/agv_XX/emergency_release` | `agv_msgs/srv/EmergencyRelease` | `agv_XX_safety_controller` | 全局/外部 | 急停解除 |
| `/agv_XX/set_speed_limit` | `agv_msgs/srv/SetSpeedLimit` | `agv_XX_safety_controller` | `traffic_controller` | 动态速度限制 |
| `/fleet/map/get_costmap` | `nav_msgs/srv/GetMap` | `map_server` | 各规划器 | 获取代价地图 |

#### 4.2.3 核心 Action 定义

| Action 名称 | 动作类型 | 提供者 | 调用者 | 说明 |
|-------------|----------|--------|--------|------|
| `/agv_XX/navigate_to_pose` | `nav2_msgs/action/NavigateToPose` | `agv_XX_local_planner` | `central_scheduler` | 导航到目标点 |
| `/agv_XX/follow_path` | `nav2_msgs/action/FollowPath` | `agv_XX_local_planner` | 内部 | 沿路径行驶 |
| `/agv_XX/charge` | `agv_msgs/action/Charge` | `agv_XX_controller` | `lifecycle` | 充电对接 |

### 4.3 混合部署通信拓扑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         中心服务器 (Central Server)                           │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ central_     │  │ fleet_       │  │ traffic_     │  │ charge_      │   │
│  │ scheduler    │  │ manager      │  │ controller   │  │ scheduler    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │                 │            │
│         └─────────────────┼──────────────────┼─────────────────┘            │
│                           │                  │                              │
│  ┌──────────────┐  ┌──────┴──────────────────┴──────────┐  ┌────────────┐ │
│  │ api_gateway  │  │         DDS Domain (Domain ID: 10)  │  │ web_bridge │ │
│  └──────────────┘  └──────────────────┬──────────────────┘  └────────────┘ │
└───────────────────────────────────────┼─────────────────────────────────────┘
                                        │
                           ┌────────────┼────────────┐
                           │            │            │
                  ┌────────┴───┐  ┌─────┴────┐  ┌───┴────────┐
                  │ AGV 01     │  │ AGV 02   │  │ AGV 03..20 │
                  │ (Jetson    │  │ (...)    │  │ (...)      │
                  │  Orin)     │  │          │  │            │
                  └────────────┘  └──────────┘  └────────────┘
```

**通信说明：**
- 所有节点共享同一个 ROS2 DDS Domain（Domain ID = 10）
- 中心服务器与车载端通过 WiFi 5/6 在同一网段通信
- 使用 DDS 分区（Partition）机制隔离不同域的数据：
  - 分区 `fleet_control`：调度指令、交通管制
  - 分区 `agv_XX_data`：各 AGV 传感器数据、状态
  - 分区 `fleet_monitor`：全局监控数据
- **[DEFAULT]** 使用 Fast DDS 作为默认 DDS 实现
- **[EXTENSION]** 预留 Cyclone DDS 切换支持（通过 ROS2 环境变量 `RMW_IMPLEMENTATION`）

---

## 5. 模块接口规范

### 5.1 核心模块输入/输出接口

#### 5.1.1 全局任务调度器（central_scheduler）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | Task Request | `agv_msgs/msg/TaskRequest` | 来自 WMS / API 的任务请求 |
| **输入** | AGV Status | `agv_msgs/msg/AGVStatus` | 各 AGV 实时状态（位置/电量/任务状态） |
| **输入** | Deadlock Event | `agv_msgs/msg/DeadlockEvent` | 交通管制上报的死锁事件 |
| **输出** | Task Assignment | `agv_msgs/msg/TaskAssignment` | 分配给指定 AGV 的任务 |
| **输出** | Pause/Resume | `agv_msgs/msg/PauseResume` | 暂停/恢复指令 |

**关键数据结构定义（ROS2 消息）：**

```idl
# agv_msgs/msg/TaskRequest.msg
string task_id                 # 任务唯一ID
string task_type               # TRANSPORT | CHARGE | PARK | INSPECT
string priority                # LOW | NORMAL | HIGH | CRITICAL
geometry_msgs/Pose2D start_pose    # 起始位姿
geometry_msgs/Pose2D target_pose   # 目标位姿
string payload_id              # 货物ID（运输任务）
time deadline                  # 截止时间
time request_time              # 请求时间

# agv_msgs/msg/TaskAssignment.msg
string task_id                 # 任务ID
string assigned_agv_id         # 分配的AGV ID
string task_type               # 任务类型
geometry_msgs/Pose2D target_pose   # 目标位姿
string[] waypoints             # 路径关键点（可选）
time assignment_time           # 分配时间
time estimated_completion      # 预计完成时间

# agv_msgs/msg/AGVStatus.msg
string agv_id                  # AGV ID
string status                  # IDLE | BUSY | CHARGING | PARKED | EMERGENCY | FAULT
geometry_msgs/Pose2D pose      # 当前位置
float32 battery_level          # 电量百分比 (0-100)
float32 linear_speed           # 当前线速度
float32 angular_speed          # 当前角速度
string current_task_id         # 当前执行的任务ID
time status_time               # 状态时间戳

# agv_msgs/msg/TaskStatus.msg
string task_id
string agv_id
string status                  # PENDING | ASSIGNED | EN_ROUTE | EXECUTING | COMPLETED | FAILED | CANCELLED
float32 progress               # 0.0 - 1.0
string error_msg               # 错误信息（仅在 FAILED 时有效）
time status_time
```

#### 5.1.2 交通管制器（traffic_controller）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | AGV Pose | `nav_msgs/msg/Odometry` | 各 AGV 位置 |
| **输入** | Path Request | `agv_msgs/msg/PathRequest` | AGV 申请路径段 |
| **输出** | Path Segment Lock | `agv_msgs/msg/PathSegmentLock` | 路径段锁分配/释放 |
| **输出** | Deadlock Event | `agv_msgs/msg/DeadlockEvent` | 死锁检测与解锁指令 |
| **输出** | Speed Limit Cmd | `agv_msgs/msg/SpeedLimitCmd` | 动态区域限速 |

**关键数据结构：**

```idl
# agv_msgs/msg/PathSegmentLock.msg
string segment_id              # 路径段ID
string agv_id                  # 占用AGV
string status                  # REQUESTED | GRANTED | RELEASED | DENIED
time grant_time                # 授权时间
duration max_hold_duration     # 最大持有时间（超时自动释放）

# agv_msgs/msg/DeadlockEvent.msg
string event_id
string[] involved_agvs         # 涉事AGV列表
string deadlock_type           # HEAD_ON | CROSS | CYCLE_WAIT
string resolution_strategy     # BACK_OFF | RE_ROUTE | PRIORITY_PASS
geometry_msgs/Pose2D resolution_pose  # 解锁目标位姿
```

#### 5.1.3 全局路径规划器（agv_XX_global_planner）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | Costmap | `nav_msgs/msg/OccupancyGrid` | 全局代价地图 |
| **输入** | Goal Pose | `geometry_msgs/msg/PoseStamped` | 目标位姿 |
| **输入** | Map | `nav_msgs/msg/OccupancyGrid` | 静态地图 |
| **输出** | Global Path | `nav_msgs/msg/Path` | 全局最优路径 |

#### 5.1.4 局部路径规划器（agv_XX_local_planner）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | Global Path | `nav_msgs/msg/Path` | 来自全局路径规划器 |
| **输入** | LaserScan | `sensor_msgs/msg/LaserScan` | 激光雷达数据 |
| **输入** | Odometry | `nav_msgs/msg/Odometry` | 里程计数据 |
| **输入** | Costmap | `nav_msgs/msg/OccupancyGrid` | 局部代价地图 |
| **输出** | Cmd Vel | `geometry_msgs/msg/Twist` | 速度指令（→ safety_controller） |
| **输出** | Local Path | `nav_msgs/msg/Path` | 局部规划轨迹 |

#### 5.1.5 传感器融合定位（agv_XX_localization）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | LaserScan | `sensor_msgs/msg/LaserScan` | 激光雷达数据 |
| **输入** | IMU | `sensor_msgs/msg/Imu` | IMU 数据 |
| **输入** | Odometry | `nav_msgs/msg/Odometry` | 轮式里程计数据 |
| **输出** | Pose (EKF) | `nav_msgs/msg/Odometry` | EKF 融合位姿（50Hz） |
| **输出** | AMCL Pose | `geometry_msgs/msg/PoseWithCovarianceStamped` | AMCL 定位结果（按需） |
| **输出** | Localization Status | `agv_msgs/msg/LocalizationStatus` | 定位状态（正常/降级/丢失） |

#### 5.1.6 安全控制器（agv_XX_safety_controller）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | Cmd Vel (from planner) | `geometry_msgs/msg/Twist` | 来自局部规划器的速度指令 |
| **输入** | LaserScan | `sensor_msgs/msg/LaserScan` | 激光雷达数据 |
| **输入** | Odometry | `nav_msgs/msg/Odometry` | 当前位姿 |
| **输入** | Localization Status | `agv_msgs/msg/LocalizationStatus` | 定位状态 |
| **输入** | Emergency Stop | `agv_msgs/srv/EmergencyStop` | 远程急停 |
| **输出** | Cmd Vel (safety filtered) | `geometry_msgs/msg/Twist` | 安全过滤后的速度指令 |
| **输出** | Emergency Status | `agv_msgs/msg/EmergencyStatus` | 急停状态广播 |
| **输出** | Safety State | `agv_msgs/msg/SafetyState` | 安全状态（三层速度等级） |

**关键数据结构：**

```idl
# agv_msgs/msg/SafetyState.msg
string agv_id
string safety_level             # NORMAL | WARNING | DECELERATE | EMERGENCY_STOP
float32 current_linear_speed_limit   # 当前线速度上限 (m/s)
float32 current_angular_speed_limit  # 当前角速度上限 (rad/s)
string trigger_reason           # 触发原因
bool is_emergency               # 是否急停状态
time state_time

# agv_msgs/msg/EmergencyStatus.msg
string agv_id
bool emergency_active
string source                   # HARDWARE_BUTTON | SOFTWARE | COMMUNICATION_LOSS | LOCALIZATION_LOSS | OBSTACLE | OVERSPEED | LOW_BATTERY | MANUAL
string description
time trigger_time
```

#### 5.1.7 底盘控制器（agv_XX_controller）

| 方向 | 接口 | 数据类型 | 说明 |
|------|------|----------|------|
| **输入** | Cmd Vel (safety) | `geometry_msgs/msg/Twist` | 安全过滤后的速度指令 |
| **输入** | Motor Feedback | `agv_msgs/msg/MotorFeedback` | 电机反馈 |
| **输出** | Odometry | `nav_msgs/msg/Odometry` | 里程计数据 |
| **输出** | Motor Command | `agv_msgs/msg/MotorCommand` | 电机控制指令（→ Gazebo/硬件） |

### 5.2 消息类型选型建议

| 场景 | 推荐消息类型 | 原因 |
|------|-------------|------|
| 速度指令 | `geometry_msgs/msg/Twist` | ROS2 标准，广泛兼容 |
| 位姿 | `nav_msgs/msg/Odometry` | 含协方差，适合 EKF 融合 |
| 激光雷达 | `sensor_msgs/msg/LaserScan` | Gazebo 原生支持，兼容性好 |
| 点云 | `sensor_msgs/msg/PointCloud2` | 如需 3D 避障可扩展使用 |
| 路径 | `nav_msgs/msg/Path` | ROS2 Navigation2 标准 |
| 地图 | `nav_msgs/msg/OccupancyGrid` | ROS2 标准代价地图格式 |
| 里程计 | `nav_msgs/msg/Odometry` | 含 twist 和 covariance |
| IMU | `sensor_msgs/msg/Imu` | Gazebo 原生支持 |
| TF | `tf2_msgs/msg/TFMessage` | 坐标变换标准 |
| 图像 | `sensor_msgs/msg/Image` | RGB-D 相机扩展预留 |

### 5.3 模块间依赖关系图

```
                        ┌──────────────────┐
                        │  central_        │
                        │  scheduler       │
                        └────────┬─────────┘
                                 │ 依赖 tasks
                                 ▼
                   ┌─────────────────────────┐
                   │  traffic_controller     │
                   │  (路径段锁/死锁检测)     │
                   └────────┬───────┬────────┘
                            │       │
                  ┌─────────┘       └─────────┐
                  ▼                            ▼
   ┌─────────────────────────┐   ┌─────────────────────────┐
   │ agv_XX_global_planner   │   │ agv_XX_safety_          │
   │ (依赖: map, costmap)    │   │ controller               │
   └────────┬────────────────┘   │ (依赖: scan, odom,      │
            │                    │  localization_status)    │
            ▼                    └────────┬────────────────┘
   ┌─────────────────────────┐            │
   │ agv_XX_local_planner    │◄───────────┘
   │ (依赖: global_path,     │  输出速度指令 → safety_controller 过滤
   │  scan, odom, costmap)   │
   └────────┬────────────────┘
            │ 输出: cmd_vel
            ▼
   ┌─────────────────────────┐
   │ agv_XX_localization     │
   │ (依赖: scan, imu, odom) │
   │ 输出: pose (50Hz)       │
   └────────┬────────────────┘
            │
            ▼
   ┌─────────────────────────┐
   │ agv_XX_controller       │
   │ (依赖: cmd_vel, 电机反馈)│
   └────────┬────────────────┘
            │
            ▼
   ┌─────────────────────────┐
   │ Gazebo / Hardware       │
   └─────────────────────────┘
```

**依赖关系说明：**
- 实线箭头表示**数据流方向**，即上游模块输出给下游模块
- 依赖关系是**单向的**，无循环依赖
- `safety_controller` 是**唯一**允许修改速度指令的节点（安全隔离）
- `central_scheduler` 依赖 `traffic_controller` 的路径段锁和死锁检测结果
- `traffic_controller` 依赖各 AGV 的定位结果（通过 `/fleet/agv_XX/pose` 订阅）

---

## 6. 技术选型建议

### 6.1 路径规划算法

#### 6.1.1 全局路径规划

| 算法 | 适用场景 | 复杂度 | 推荐度 | 说明 |
|------|---------|--------|--------|------|
| **A\*** | 栅格地图 | O(N) | ⭐⭐⭐⭐ **[DEFAULT]** | 成熟稳定，ROS2 生态支持好 |
| **Hybrid A\*** | 非完整约束 AGV | O(N log N) | ⭐⭐⭐⭐ | 差速模型下推荐，生成平滑路径 |
| **Theta\*** | 任意角度路径 | O(N) | ⭐⭐⭐ | 路径更短但实现复杂 |
| **RRT\*** | 大范围/非结构化 | O(N log N) | ⭐⭐ | 概率完备，实时性差，不推荐 |

**[DEFAULT] 选择：A\* 作为默认全局路径规划算法**
- 理由：栅格地图成熟度最高，1000~5000m² 场景计算量可接受（≤50ms），ROS2 Navigation2 原生支持
- 8 方向扩展 + 路径平滑（梯度下降后处理）

**[EXTENSION] 算法扩展接口：**
- 通过插件机制（`pluginlib`）支持替换全局规划器
- 接口：输入 `nav_msgs/msg/OccupancyGrid` + `geometry_msgs/msg/PoseStamped` → 输出 `nav_msgs/msg/Path`
- 预留 Hybrid A\* 插件，后续可通过参数 `global_planner.plugin` 切换

#### 6.1.2 局部路径规划

| 算法 | 适用场景 | 实时性 | 推荐度 | 说明 |
|------|---------|--------|--------|------|
| **TEB** | 多约束轨迹优化 | 50~100Hz | ⭐⭐⭐⭐ **[DEFAULT]** | 支持速度/加速度约束，动态避障 |
| **DWA** | 速度空间采样 | 100Hz | ⭐⭐⭐⭐ | 计算量小，适合纯反应式避障 |
| **MPC** | 模型预测控制 | 20~50Hz | ⭐⭐⭐ | 预测能力强，计算量大（Jetson Orin 可接受） |

**[DEFAULT] 选择：TEB（Timed Elastic Band）作为默认局部路径规划器**
- 理由：支持多约束优化（速度、加速度、障碍物距离），天然适配差速模型，ROS2 生态成熟
- 100Hz 控制频率在 Jetson Orin 上可满足

**[EXTENSION]** 预留 DWA 切换支持（通过 `local_planner.plugin` 参数）

### 6.2 避障算法

| 方案 | 检测方式 | 推荐度 | 说明 |
|------|---------|--------|------|
| **TEB 内置避障** | 基于 costmap 代价 | ⭐⭐⭐⭐ **[DEFAULT]** | 与局部规划器一体化 |
| **VFF (虚拟力场法)** | LiDAR 点云直接计算 | ⭐⭐⭐ | 计算量极小，适合纯避障不参与规划 |
| **VO (速度障碍物法)** | 速度空间障碍物检测 | ⭐⭐⭐ | 多 AGV 协同避障场景 |
| **FCL (柔性碰撞库)** | 几何碰撞检测 | ⭐⭐⭐⭐ | 用于安全层碰撞预测 |

**[DEFAULT] 选择：TEB 内置避障 + FCL 安全碰撞检测**
- 避障逻辑由 TEB 局部规划器在 100Hz 控制循环中完成
- FCL 用于安全控制器中的碰撞预测（安全距离检查）

**[EXTENSION]** 多 AGV 协同避障场景可扩展 VO 算法，通过参数 `obstacle_avoider.plugin` 切换

### 6.3 定位融合方案

| 方案 | 精度 | 实时性 | 推荐度 | 说明 |
|------|------|--------|--------|------|
| **EKF (robot_localization)** | 动态 ±5cm | 50~100Hz | ⭐⭐⭐⭐⭐ **[DEFAULT]** | ROS2 标准包，多传感器融合 |
| **AMCL** | 静态 ±2cm | 10~30Hz | ⭐⭐⭐⭐ | 全局定位恢复、重定位 |
| **EKF + AMCL 级联** | 综合最优 | 50Hz | ⭐⭐⭐⭐⭐ | **推荐组合** |

**[DEFAULT] 选择：EKF（robot_localization）主定位 + AMCL 重定位备用**
- **主定位**：robot_localization 的 EKF 节点，融合 LiDAR scan matching + IMU + 轮式里程计，输出 50Hz 位姿
- **重定位**：AMCL 作为全局定位器，在定位丢失时触发重定位（EKF 协方差 > 阈值时启动 AMCL）
- 定位丢失检测：EKF 输出协方差跟踪 + scan matching 得分监测

**定位降级策略：**
```
正常 (50Hz, ±5cm)
  └── LiDAR scan matching 异常
       └── 降级到 IMU + 里程计航迹推算 (50Hz, 精度逐步下降)
            └── 触发 AMCL 全局重定位
                 ├── 成功 → 恢复 EKF
                 └── 失败 (定位丢失 > 0.5m, 500ms)
                      └── 触发安全急停
```

### 6.4 调度算法

| 算法 | 适用场景 | 复杂度 | 推荐度 | 说明 |
|------|---------|--------|--------|------|
| **拍卖算法 (Auction)** | 任务分配 | O(N^2) | ⭐⭐⭐⭐ **[DEFAULT]** | 分布式思想，负载均衡好 |
| **匈牙利算法** | 最优分配 | O(N^3) | ⭐⭐⭐⭐ | 全局最优，适合 10~20 台 |
| **贪心** | 快速分配 | O(N log N) | ⭐⭐⭐ | 简单但不均衡 |
| **遗传算法** | 多目标优化 | O(N^2) | ⭐⭐ | 计算量大，实时性差 |

**[DEFAULT] 选择：改进型拍卖算法（优先级感知）**
- 支持优先级抢占：CRITICAL > HIGH > NORMAL > LOW
- 负载均衡：考虑各 AGV 的累积任务时间、当前电量、位置
- 任务分配偏差 ≤ 20%（需求要求）
- 100Hz 调度频率：拍卖算法的 O(N^2) 复杂度对 10~20 台 AGV 完全可行

**[EXTENSION]** 预留匈牙利算法切换接口，通过参数 `scheduler.algorithm` 切换

### 6.5 可视化工具

| 工具 | 适用场景 | 推荐度 | 说明 |
|------|---------|--------|------|
| **RViz2** | 开发调试 | ⭐⭐⭐⭐⭐ | ROS2 原生，3D 可视化，调试必备 |
| **Foxglove Studio** | Web 可视化 | ⭐⭐⭐⭐⭐ | 现代 Web 界面，支持 ROS2 桥接 |
| **Nav2 内置 GUI** | 导航监控 | ⭐⭐⭐ | 功能有限 |
| **自定义 Web 前端** | 运营监控 | ⭐⭐⭐⭐ | 适合运营展示（需开发工作量） |

**[DEFAULT] 选择：RViz2（开发调试） + Foxglove（运营监控）**
- 开发阶段：RViz2 实时查看路径、代价地图、TF 树
- 运营监控：Foxglove Studio 通过 WebSocket 桥接，展示 AGV 位置、任务状态、运行指标
- **[EXTENSION]** 自定义 Web 前端预留接口，通过 WebSocket 桥接（`web_bridge` 节点）转发 ROS2 话题

---

## 7. 安全架构设计

### 7.1 安全关键路径识别

```
┌─────────────────────────────────────────────────────────────────────┐
│                        安全关键路径                                    │
│                                                                      │
│  传感器 → 安全检测 → 速度限幅 → 指令输出 → 执行器                       │
│  ┌────┐    ┌──────────┐    ┌──────┐    ┌──────┐    ┌──────────┐     │
│  │LiDAR│──▶│碰撞检测   │───▶│速度  │───▶│cmd_vel│───▶│底盘      │     │
│  │IMU  │   │定位丢失检测│    │限幅器│    │输出   │    │(仿真/硬件)│     │
│  │里程计│   │通信中断检测│    │三层  │    │      │    │          │     │
│  │      │   │超速检测   │    │限幅  │    │      │    │          │     │
│  │      │   │低电量检测 │    │      │    │      │    │          │     │
│  └──────┘   └──────────┘    └──────┘    └──────┘    └──────────┘     │
│                                                                      │
│  安全关键路径延迟要求：从传感器输入到执行器输出 ≤ 10ms                   │
└─────────────────────────────────────────────────────────────────────┘
```

**安全关键模块（SIL2 级别）：**
1. `agv_XX_safety_controller` — 主安全控制器（碰撞检测、速度限幅、急停触发）
2. 急停信号处理路径（双路独立）
3. 速度限幅逻辑（三层限幅）
4. 通信中断检测

**非安全关键模块（非 SIL2）：**
- 任务调度、路径规划、定位、可视化、API 网关

### 7.2 双路急停在 ROS2 中的实现方案

```
┌──────────────────────────────────────────────────────────────────────┐
│                        双路独立急停架构                                │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  路径 A: 软件急停 (ROS2 DDS)                                 │   │
│  │                                                              │   │
│  │  碰撞预测 (FCL) ──▶ 急停判断 ──▶ /agv_XX/emergency (Topic)  │   │
│  │  定位丢失检测        逻辑      ──▶ SafetyState 更新           │   │
│  │  通信中断检测                  ──▶ cmd_vel = 0               │   │
│  │  远程急停 (Service)                                          │   │
│  │  超速检测                                                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                          │                                           │
│                          │ 独立（不共享状态）                          │
│                          │                                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  路径 B: 硬件级急停 (仿真中 = 第二 ROS2 节点)                 │   │
│  │                                                              │   │
│  │  Gazebo 仿真急停传感器 ──▶ 独立 Safety Monitor 节点          │   │
│  │  仿真 GPIO 模拟按钮    ──▶ 直接写入仿真底盘 /cmd_vel=0       │   │
│  │                          ──▶ 独立日志通道                    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  安全论证：两路各自独立触发急停，任何一路触发即产生 STOP               │
│  任意一路故障不影响另一路正常工作                                     │
└──────────────────────────────────────────────────────────────────────┘
```

**仿真中双路急停实现方案：**

| 路径 | 实现方式 | 触发源 | 响应时间 |
|------|---------|--------|----------|
| **A 路（软件）** | `agv_XX_safety_controller` 节点 | 碰撞预测、定位丢失、通信中断、超速、低电量、远程急停 | ≤10ms |
| **B 路（仿真硬件）** | 独立的 `agv_XX_safety_monitor` 节点 | 仿真急停信号、手动急停按钮（GUI） | ≤10ms |

**急停触发后恢复流程：**
```
急停触发 ──▶ 所有 cmd_vel 清零 ──▶ 写入安全日志 ──▶ 等待急停解除指令
                                                      │
                                ┌───────────────────────┘
                                ▼
                  急停解除指令 (Service: /agv_XX/emergency_release)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              手动确认恢复           自动条件恢复
           (需人工确认安全)       (排除触发源后自动恢复)
```

### 7.3 安全节点与非安全节点的隔离策略

#### 7.3.1 进程级隔离

| 方面 | 安全节点 (Safety) | 非安全节点 (Non-Safety) |
|------|-------------------|------------------------|
| 执行上下文 | 独立进程，实时线程（SCHED_FIFO） | 普通进程（SCHED_OTHER） |
| 内存 | 独立地址空间，禁止动态内存分配 | 允许动态内存 |
| 阻塞操作 | 禁止（无 sleep、文件 I/O、锁等待） | 允许 |
| 日志 | 仅紧急事件日志，低频 | 正常日志级别 |
| CPU 亲和性 | 绑定独立 CPU 核心 | 其他核心 |

#### 7.3.2 通信隔离

```
┌──────────────────────────────────────────────────────────────┐
│                    DDS Domain (ID: 10)                        │
│                                                              │
│  ┌────────────────────┐  ┌──────────────────────────────┐   │
│  │ 安全 Domain         │  │ 非安全 Domain                 │   │
│  │ (Partition: safety) │  │ (Partition: control, monitor)│   │
│  │                     │  │                              │   │
│  │ /fleet/agv_XX/     │  │ /fleet/agv_XX/cmd_vel       │   │
│  │   emergency        │  │ /fleet/agv_XX/pose          │   │
│  │ /fleet/agv_XX/     │  │ /fleet/agv_XX/scan          │   │
│  │   safety_state     │  │ /fleet/task/assign          │   │
│  │ /fleet/global/     │  │ /fleet/monitor/telemetry    │   │
│  │   emergency        │  │                              │   │
│  └────────────────────┘  └──────────────────────────────┘   │
│                                                              │
│  安全节点 ↔ 安全 Topic（只读/只写权限控制）                    │
│  非安全节点 ↔ 非安全 Topic                                   │
│  安全节点可以读取非安全 Topic（输入检测），但非安全节点         │
│  不能写入安全 Topic                                          │
└──────────────────────────────────────────────────────────────┘
```

#### 7.3.3 代码隔离

| 要求 | 安全代码 | 非安全代码 |
|------|---------|-----------|
| 语言 | C++17（MISRA C++ 子集） | C++17 / Python 3.10 |
| 动态内存 | 禁止（实时循环内） | 允许 |
| 异常 | 禁止 | 允许 |
| 模板 | 受限使用 | 自由使用 |
| 静态分析 | 必须通过（clang-tidy + cppcheck） | 推荐 |
| 单元测试覆盖率 | 100%（安全关键路径） | ≥80% |
| 代码审查 | 双人审查 | 单人审查 |

### 7.4 三层速度限幅机制

```
速度限幅层级：
                    ┌──────────────────────────┐
                    │ 层级 1: 工作速度           │
                    │ 默认最大 2.0 m/s           │
                    │ 由调度器/交通管制动态设置   │
                    │ 受区域限制（充电区 ≤0.3m/s) │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 层级 2: 减速区             │
                    │ 触发条件:                  │
                    │  - 障碍物 < 2.0m         │
                    │  - 接近交叉口            │
                    │  - 通信质量下降           │
                    │ 限速: 0.5 m/s            │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 层级 3: 急停               │
                    │ 触发条件:                  │
                    │  - 障碍物 < 0.3m          │
                    │  - 通信中断 > 100ms       │
                    │  - 定位丢失 > 0.5m        │
                    │  - 超速 120%              │
                    │  - 电量 < 5%              │
                    │  - 人工急停               │
                    │ 动作: cmd_vel = 0         │
                    └──────────────────────────┘
```

### 7.5 安全触发条件矩阵

| 触发条件 | 检测方式 | 检测延迟 | 动作 | SIL2 |
|----------|---------|---------|------|------|
| 障碍物 < 0.3m | LiDAR 最近点检测 | <10ms | 急停 | 是 |
| 障碍物 < 2.0m | LiDAR 安全区域检测 | <10ms | 减速至 0.5m/s | 是 |
| 通信中断 > 100ms | 心跳超时检测 | ≤100ms | 急停 | 是 |
| 定位丢失 > 0.5m | EKF 协方差监测 | ≤10ms | 急停 | 是 |
| 超速 > 120% (2.4m/s) | 速度反馈监测 | ≤10ms | 急停 | 是 |
| 电量 < 5% | 电池监测 | ≤100ms | 急停 | 是 |
| 人工急停 | 远程 Service / 仿真按钮 | ≤10ms | 急停 | 是 |
| 低电量 < 20% | 电池监测 | 按需 | 触发充电任务 | 否 |

### 7.6 安全代码约束（实时循环内）

```
实时循环（100Hz, 10ms 周期）内禁止：
  ❌ 动态内存分配（new/delete/malloc/free）
  ❌ 阻塞操作（sleep/mutex_lock/条件变量等待）
  ❌ 文件 I/O（读写文件、日志写入）
  ❌ 高频日志（printf/spdlog 在实时循环内）
  ❌ 异常抛出和捕获
  ❌ 虚函数调用（避免 vtable 查找不确定延迟）
  ❌ 容器动态扩容（std::vector push_back 可能触发 realloc）

实时循环内允许：
  ✅ 栈上分配（固定大小数组）
  ✅ 预分配内存池（启动时一次分配）
  ✅ 原子操作（std::atomic）
  ✅ 无锁队列（boost::lockfree::spsc_queue）
  ✅ 固定大小 ring buffer
```

---

## 8. 仿真架构

### 8.1 Gazebo 仿真世界搭建方案

#### 8.1.1 仿真场景规格

| 参数 | 规格 |
|------|------|
| 仿真平台 | Gazebo Ignition Fortress |
| 场景面积 | 1000~5000m²（可配置） |
| 默认场景 | 标准仓储模板（参见 8.1.2）|
| 坐标系 | 遵循 REP 105 |
| 物理引擎 | DART（Gazebo Fortress 默认）|
| 仿真步长 | 0.001s（1ms），与 100Hz 控制循环匹配 |
| 实时因子目标 | ≥ 0.95 |

#### 8.1.2 默认标准仓储场景模板 **[DEFAULT]**

```
┌────────────────────────────────────────────────────────────────┐
│                        仓储场景俯视图                             │
│                                                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────────┐ │
│  │ 存储区 A  │    │ 存储区 B  │    │ 存储区 C  │    │ 装卸区1 │ │
│  │ (货架阵列)│    │ (货架阵列)│    │ (货架阵列)│    │         │ │
│  └──────────┘    └──────────┘    └──────────┘    └─────────┘ │
│                                                                │
│  ────────────── 主干道 2.5m ─────────────────────              │
│                                                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌─────────┐ │
│  │ 存储区 D  │    │ 充电站   │    │ 存储区 E  │    │ 装卸区2 │ │
│  │ (货架阵列)│    │ (4工位)  │    │ (货架阵列)│    │         │ │
│  └──────────┘    └──────────┘    └──────────┘    └─────────┘ │
│                                                                │
│  通道宽度: 1.8m（单向）/ 2.5m（双向）                           │
│  货架尺寸: 1.2m x 1.0m x 1.8m                                 │
│  充电站: 4 工位，充电区速度 ≤ 0.3m/s                           │
│  交叉口: 4 个（交通管制重点）                                   │
│  动态障碍物: 预设路径上的人/叉车                                 │
└────────────────────────────────────────────────────────────────┘
```

**[EXTENSION]** 地图热替换：通过 `map_server` 支持运行时加载新地图（`nav_msgs/srv/GetMap`），仿真场景 `.sdf` 文件通过参数 `world_file` 指定。

#### 8.1.3 多区域场景配置

| 区域类型 | 默认数量 | 速度限制 | 说明 |
|---------|---------|---------|------|
| 存储区 | 5 个 | 1.0 m/s | 货架阵列，窄通道 |
| 主干道 | 2 条 | 2.0 m/s | 双向通行 |
| 装卸区 | 2 个 | 0.3 m/s | 人工交互区域 |
| 充电站 | 1 个 (4 工位) | 0.3 m/s | 自动充电 |
| 交叉口 | 4 个 | 动态限速 | 交通管制 |

### 8.2 传感器插件选型

| 传感器 | Gazebo 插件 | 参数配置 | 说明 |
|--------|------------|---------|------|
| **LiDAR** | `ignition::gazebo::systems::Lidar` | 16 线, 30m 范围, 40Hz | 模拟 Velodyne VLP-16 |
| **IMU** | `ignition::gazebo::systems::Imu` | 100Hz, 噪声参数可配置 | 模拟 BNO055 |
| **轮式里程计** | 自定义 `OdometryPublisher` | 50Hz, 基于轮速编码器仿真 | 底盘内置 |
| **RGB-D 相机** | `ignition::gazebo::systems::RgbdCamera` | 640x480, 30Hz | 扩展预留 |
| **接触传感器** | `ignition::gazebo::systems::TouchPlugin` | 碰撞检测 | 安全测试 |
| **急停按钮** | 自定义仿真插件 | GUI 交互按钮 | 安全测试 |

### 8.3 AGV URDF 模型设计

```
AGV URDF 模型结构：
┌───────────────────────────────────────────────┐
│                  AGV Body                       │
│  ┌────────────┐          ┌────────────┐       │
│  │ LiDAR      │          │ RGB-D Cam  │       │
│  │ (顶置)     │          │ (前置)     │       │
│  └────────────┘          └────────────┘       │
│                                                │
│  ┌────────────────────────────────────────┐    │
│  │        控制箱 (Jetson Orin)             │    │
│  └────────────────────────────────────────┘    │
│                                                │
│  ┌────────────┐    ┌────────────┐              │
│  │ IMU        │    │ 电池       │              │
│  │ (中心)     │    │ (底部)     │              │
│  └────────────┘    └────────────┘              │
│                                                │
│  ┌──────┐              ┌──────┐               │
│  │左轮  │              │右轮  │               │
│  │(驱动)│              │(驱动)│               │
│  └──────┘              └──────┘               │
│                                                │
│  ┌──────┐    ┌──────┐    ┌──────┐             │
│  │万向轮│    │万向轮│    │万向轮│             │
│  │(前)  │    │(后左)│    │(后右)│             │
│  └──────┘    └──────┘    └──────┘             │
└───────────────────────────────────────────────┘

**[DEFAULT]** 差速驱动模型（两轮独立驱动 + 万向轮支撑）
车身尺寸：1.2m x 0.8m x 0.5m（长 x 宽 x 高）
轮距：0.6m
最大速度：2.0 m/s / 1.5 rad/s
```

### 8.4 仿真与真实代码的复用策略

```
┌────────────────────────────────────────────────────┐
│                   代码复用架构                       │
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │        核心算法层（完全复用）              │     │
│  │  - 全局路径规划 (A*)                      │     │
│  │  - 局部路径规划 (TEB)                     │     │
│  │  - 定位融合 (EKF)                         │     │
│  │  - 碰撞检测 (FCL)                         │     │
│  │  - 死锁检测与解锁                         │     │
│  └──────────────────────────────────────────┘     │
│                     ▲                              │
│                     │ 复用                          │
│                     ▼                              │
│  ┌──────────────────────────────────────────┐     │
│  │        业务层（部分复用）                  │     │
│  │  - 任务调度器（复用）                     │     │
│  │  - 交通管制器（复用）                     │     │
│  │  - 安全控制器（复用，传感器源切换）        │     │
│  │  - API 网关（复用）                       │     │
│  └──────────────────────────────────────────┘     │
│                     ▲                              │
│         ┌───────────┴───────────┐                  │
│         ▼                       ▼                  │
│  ┌──────────────┐     ┌──────────────────┐        │
│  │ 仿真 HAL     │     │ 真实 HAL（预留）  │        │
│  │ - ros_ign_   │     │ - LiDAR 驱动     │        │
│  │   bridge     │     │ - 底盘驱动       │        │
│  │ - 仿真传感器  │     │ - IMU 驱动       │        │
│  │ - 仿真底盘    │     │ - 硬件急停       │        │
│  └──────────────┘     └──────────────────┘        │
│                                                    │
│  切换方式：launch 文件参数 simulation:=true/false   │
│  HAL 接口层统一（相同的 Topic/Service 接口）         │
└────────────────────────────────────────────────────┘
```

**复用策略要点：**
1. **核心算法层**：100% 复用，不依赖仿真或真实硬件
2. **业务层**：>90% 复用，通过 HAL 抽象层隔离硬件差异
3. **HAL 层**：仿真与真实各一套实现，接口完全一致
4. **切换机制**：launch 文件参数 `simulation:=true`，加载对应 HAL 实现
5. **Gazebo 桥接**：使用 `ros_ign_bridge`（ROS2 ↔ Ignition Gazebo）实现消息转换

---

## 9. 项目目录结构建议

### 9.1 ROS2 Workspace 目录布局

```
agv_ws/                              # ROS2 Workspace 根目录
├── src/                             # 源码目录
│   ├── agv_core/                    # 核心库包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_core/
│   │   │   ├── types.h              # 核心数据结构
│   │   │   ├── constants.h          # 系统常量
│   │   │   ├── utils.h              # 工具函数
│   │   │   └── lifecycle/           # 生命周期管理
│   │   └── src/
│   │       ├── lifecycle_manager.cpp
│   │       └── utils.cpp
│   │
│   ├── agv_msgs/                    # 自定义消息包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── msg/                     # 自定义消息
│   │   │   ├── TaskRequest.msg
│   │   │   ├── TaskAssignment.msg
│   │   │   ├── TaskStatus.msg
│   │   │   ├── AGVStatus.msg
│   │   │   ├── EmergencyStatus.msg
│   │   │   ├── SafetyState.msg
│   │   │   ├── PathSegmentLock.msg
│   │   │   ├── DeadlockEvent.msg
│   │   │   ├── SpeedLimitCmd.msg
│   │   │   ├── ChargeRequest.msg
│   │   │   ├── LocalizationStatus.msg
│   │   │   ├── FleetTelemetry.msg
│   │   │   └── MotorCommand.msg
│   │   ├── srv/                     # 自定义服务
│   │   │   ├── SubmitTask.srv
│   │   │   ├── CancelTask.srv
│   │   │   ├── QueryTask.srv
│   │   │   ├── QueryAGV.srv
│   │   │   ├── EmergencyStop.srv
│   │   │   ├── EmergencyRelease.srv
│   │   │   ├── SetSpeedLimit.srv
│   │   │   └── PauseResume.srv
│   │   └── action/                  # 自定义 Action
│   │       └── Charge.action
│   │
│   ├── agv_scheduler/               # 调度器包（中心服务器）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_scheduler/
│   │   │   ├── central_scheduler.h
│   │   │   ├── charge_scheduler.h
│   │   │   ├── auction_algorithm.h  # 拍卖算法
│   │   │   └── hungarian_algorithm.h  # [EXTENSION]
│   │   └── src/
│   │       ├── central_scheduler_node.cpp
│   │       ├── charge_scheduler_node.cpp
│   │       ├── auction_algorithm.cpp
│   │       └── hungarian_algorithm.cpp  # [EXTENSION]
│   │
│   ├── agv_fleet_manager/           # 车队管理包（中心服务器）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_fleet_manager/
│   │   │   └── fleet_manager.h
│   │   └── src/
│   │       └── fleet_manager_node.cpp
│   │
│   ├── agv_traffic_control/         # 交通管制包（中心服务器）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_traffic_control/
│   │   │   ├── traffic_controller.h
│   │   │   ├── intersection_manager.h
│   │   │   ├── path_segment_locker.h
│   │   │   ├── deadlock_detector.h
│   │   │   └── deadlock_resolver.h
│   │   └── src/
│   │       ├── traffic_controller_node.cpp
│   │       ├── intersection_manager.cpp
│   │       ├── path_segment_locker.cpp
│   │       ├── deadlock_detector.cpp
│   │       └── deadlock_resolver.cpp
│   │
│   ├── agv_navigation/              # 导航包（车载端）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_navigation/
│   │   │   ├── global_planner/
│   │   │   │   ├── astar_planner.h       # [DEFAULT]
│   │   │   │   └── hybrid_astar_planner.h # [EXTENSION]
│   │   │   ├── local_planner/
│   │   │   │   ├── teb_planner.h         # [DEFAULT]
│   │   │   │   ├── dwa_planner.h         # [EXTENSION]
│   │   │   │   └── planner_plugin.h      # 规划器插件接口
│   │   │   └── costmap/
│   │   │       ├── costmap_layer.h
│   │   │       └── obstacle_layer.h
│   │   └── src/
│   │       ├── global_planner_node.cpp
│   │       ├── local_planner_node.cpp
│   │       ├── astar_planner.cpp
│   │       ├── hybrid_astar_planner.cpp   # [EXTENSION]
│   │       ├── teb_planner.cpp
│   │       ├── dwa_planner.cpp            # [EXTENSION]
│   │       └── costmap/
│   │           ├── costmap_layer.cpp
│   │           └── obstacle_layer.cpp
│   │
│   ├── agv_localization/            # 定位包（车载端）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_localization/
│   │   │   ├── ekf_localizer.h
│   │   │   ├── amcl_wrapper.h
│   │   │   ├── sensor_sync.h            # 传感器时间同步
│   │   │   └── localization_monitor.h   # 定位质量监测
│   │   └── src/
│   │       ├── localization_node.cpp
│   │       ├── ekf_localizer.cpp
│   │       ├── amcl_wrapper.cpp
│   │       ├── sensor_sync.cpp
│   │       └── localization_monitor.cpp
│   │
│   ├── agv_control/                 # 底盘控制包（车载端）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_control/
│   │   │   ├── differential_controller.h   # [DEFAULT] 差速模型
│   │   │   ├── motion_model_plugin.h       # [EXTENSION] 运动学模型插件接口
│   │   │   ├── odometry_publisher.h
│   │   │   └── charge_controller.h
│   │   └── src/
│   │       ├── controller_node.cpp
│   │       ├── differential_controller.cpp
│   │       ├── odometry_publisher.cpp
│   │       └── charge_controller.cpp
│   │
│   ├── agv_safety/                  # 安全包（车载端 + 中心）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_safety/
│   │   │   ├── safety_controller.h       # 主安全控制器
│   │   │   ├── safety_monitor.h          # 全局安全监控
│   │   │   ├── collision_detector.h      # 碰撞检测（FCL）
│   │   │   ├── speed_limiter.h           # 三层速度限幅
│   │   │   ├── heartbeat_monitor.h       # 通信心跳监测
│   │   │   └── emergency_handler.h       # 急停处理
│   │   └── src/
│   │       ├── safety_controller_node.cpp
│   │       ├── safety_monitor_node.cpp
│   │       ├── collision_detector.cpp
│   │       ├── speed_limiter.cpp
│   │       ├── heartbeat_monitor.cpp
│   │       └── emergency_handler.cpp
│   │
│   ├── agv_simulation/              # 仿真包（仿真专用）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── worlds/                      # Gazebo 世界文件
│   │   │   ├── warehouse_default.sdf    # [DEFAULT] 默认仓储场景
│   │   │   ├── warehouse_large.sdf      # 大场景 (5000m²)
│   │   │   └── warehouse_small.sdf      # 小场景 (1000m²)
│   │   ├── models/                      # 自定义模型
│   │   │   ├── agv_model/
│   │   │   │   ├── model.sdf
│   │   │   │   └── meshes/
│   │   │   ├── shelf/
│   │   │   │   ├── model.sdf
│   │   │   │   └── meshes/
│   │   │   ├── charging_station/
│   │   │   │   ├── model.sdf
│   │   │   │   └── meshes/
│   │   │   └── dynamic_obstacle/
│   │   │       ├── model.sdf
│   │   │       └── meshes/
│   │   ├── include/agv_simulation/
│   │   │   ├── gazebo_bridge.h
│   │   │   ├── agv_spawner.h
│   │   │   ├── scenario_manager.h
│   │   │   └── performance_monitor.h
│   │   └── src/
│   │       ├── gazebo_bridge_node.cpp
│   │       ├── agv_spawner_node.cpp
│   │       ├── scenario_manager_node.cpp
│   │       └── performance_monitor_node.cpp
│   │
│   ├── agv_api_gateway/             # API 网关包（中心服务器）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_api_gateway/
│   │   │   ├── api_server.h
│   │   │   ├── task_handler.h
│   │   │   └── agv_query_handler.h
│   │   └── src/
│   │       ├── api_gateway_node.cpp
│   │       ├── api_server.cpp
│   │       ├── task_handler.cpp
│   │       └── agv_query_handler.cpp
│   │
│   ├── agv_visualization/           # 可视化包（中心服务器）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_visualization/
│   │   │   └── web_bridge.h
│   │   └── src/
│   │       └── web_bridge_node.cpp
│   │
│   └── agv_tools/                   # 工具脚本包
│       ├── CMakeLists.txt
│       ├── package.xml
│       ├── scripts/
│       │   ├── task_generator.py         # 任务生成（随机/预设/API）
│       │   ├── scenario_runner.py        # 场景运行脚本
│       │   ├── performance_report.py     # 性能报告生成
│       │   ├── replay_log.py             # 日志回放
│       │   └── batch_test.py             # 批量测试
│       └── config/
│           ├── default_params.yaml       # 默认参数配置
│           ├── safety_params.yaml        # 安全参数配置
│           ├── agv_config.yaml           # AGV 参数配置
│           └── test_scenarios.yaml       # 测试场景配置
│
├── launch/                          # 启动文件
│   ├── central_server.launch.py     # 中心服务器启动
│   ├── agv_single.launch.py         # 单台 AGV 启动（参数 agv_id:=XX）
│   ├── simulation.launch.py         # 仿真环境启动
│   ├── full_system.launch.py        # 全系统启动
│   └── test_scenario.launch.py      # 测试场景启动
│
├── config/                          # 全局配置
│   ├── nav2_params.yaml             # Navigation2 参数
│   ├── safety_params.yaml           # 安全参数
│   ├── costmap_params.yaml          # 代价地图参数
│   └── fleet_params.yaml            # 车队参数
│
├── maps/                            # 地图文件
│   ├── warehouse_default.yaml       # 默认仓储地图元数据
│   ├── warehouse_default.pgm        # 默认仓储栅格地图
│   ├── warehouse_large.yaml
│   └── warehouse_large.pgm
│
├── docker/                          # Docker 配置
│   ├── Dockerfile.central           # 中心服务器 Dockerfile
│   ├── Dockerfile.onboard           # 车载端 Dockerfile
│   └── docker-compose.yml           # Docker Compose 编排
│
├── tests/                           # 测试目录
│   ├── unit/                        # 单元测试
│   │   ├── test_astar_planner.cpp
│   │   ├── test_teb_planner.cpp
│   │   ├── test_safety_controller.cpp
│   │   ├── test_auction_algorithm.cpp
│   │   ├── test_deadlock_detector.cpp
│   │   └── test_collision_detector.cpp
│   ├── integration/                 # 集成测试
│   │   ├── test_scheduler_navigation.py
│   │   ├── test_multi_agv_avoidance.py
│   │   ├── test_emergency_stop.py
│   │   ├── test_communication_loss.py
│   │   └── test_charge_scheduling.py
│   └── performance/                 # 性能测试
│       ├── test_scheduling_latency.py
│       ├── test_path_planning_latency.py
│       └── test_obstacle_avoidance_rate.py
│
├── docs/                            # 文档
│   ├── architecture.md              # 本架构文档
│   ├── api_reference.md             # API 接口文档
│   ├── safety_case.md               # SIL2 安全论证文档
│   ├── user_manual.md               # 用户手册
│   └── simulation_guide.md          # 仿真指南
│
├── .clang-format                    # C++ 代码格式配置
├── .clang-tidy                      # 静态分析配置
├── .cppcheck-suppressions           # cppcheck 抑制文件
├── colcon.meta                      # colcon 编译配置
└── README.md                        # 项目 README
```

### 9.2 包划分原则

| 包名 | 类型 | 语言 | 部署位置 | 依赖 |
|------|------|------|---------|------|
| `agv_core` | 库 | C++ | 全平台 | 无外部依赖 |
| `agv_msgs` | 消息定义 | IDL | 全平台 | `std_msgs`, `geometry_msgs`, `nav_msgs`, `sensor_msgs` |
| `agv_scheduler` | 节点 | C++ | 中心服务器 | `agv_core`, `agv_msgs`, `rclcpp` |
| `agv_fleet_manager` | 节点 | C++ | 中心服务器 | `agv_msgs`, `rclcpp` |
| `agv_traffic_control` | 节点 | C++ | 中心服务器 | `agv_core`, `agv_msgs`, `rclcpp` |
| `agv_navigation` | 节点 | C++ | 车载端 | `agv_core`, `agv_msgs`, `nav2_msgs`, `rclcpp`, `pluginlib` |
| `agv_localization` | 节点 | C++ | 车载端 | `agv_msgs`, `robot_localization`, `nav2_amcl`, `rclcpp` |
| `agv_control` | 节点 | C++ | 车载端 | `agv_core`, `agv_msgs`, `rclcpp`, `pluginlib` |
| `agv_safety` | 节点 | C++ | 车载端 + 中心 | `agv_core`, `agv_msgs`, `rclcpp`, `fcl` |
| `agv_simulation` | 节点+模型 | C++ + Python | 仿真端 | `ros_ign_bridge`, `ignition-gazebo6` |
| `agv_api_gateway` | 节点 | C++ | 中心服务器 | `agv_msgs`, `rclcpp`, `libmicrohttpd` |
| `agv_visualization` | 节点 | C++ + Python | 中心服务器 | `agv_msgs`, `rclcpp`, `rclpy`, `websocketpp` |
| `agv_tools` | 脚本 | Python | 工具端 | `rclpy`, `numpy`, `matplotlib` |

---

## 10. 不确定项处理清单

| 编号 | 不确定项 | 默认选择 [DEFAULT] | 扩展接口 [EXTENSION] |
|------|---------|-------------------|---------------------|
| UNC-1 | AGV 运动学模型 | 差速模型（两轮独立驱动） | `agv_control` 包中 `motion_model_plugin` 插件接口，支持替换为阿克曼/全向模型 |
| UNC-2 | 场景地图 | 标准仓储场景模板（`warehouse_default.sdf`，含货架阵列、充电站、装卸区） | 地图热替换：通过 `map_server` + `world_file` 参数支持运行时切换不同场景 |
| UNC-3 | 任务生成模式 | 三种模式均支持：随机（测试用）、预设（场景驱动）、API 下发（主模式） | 无额外扩展需要，`task_generator.py` 支持所有三种模式 |
| UNC-4 | 多楼层支持 | 一期仅单层平面，所有坐标使用 `geometry_msgs/Pose2D`（无 Z 轴） | 消息定义预留 `z` 和 `floor` 字段；`agv_core::types.h` 中预留楼层扩展类型 |
| UNC-5 | 充电策略 | 低电量阈值触发（< 20% 申请充电）+ 任务间隙自动充电 | `charge_scheduler` 支持可配置策略：定时充电/电价优化充电/任务空闲充电 |
| UNC-6 | WMS 接口文档 | 默认 REST API + JSON，包含任务提交/取消/查询、AGV 状态查询 | `api_gateway` 支持路由扩展，可适配不同版本的 WMS 接口 |
| UNC-7 | 真实 AGV 底盘型号 | 仿真优先，不依赖具体型号 | HAL 层通过统一 Topic 接口隔离，替换 HAL 实现即可适配不同底盘 |
| UNC-8 | DDS 实现 | Fast DDS | 通过 `RMW_IMPLEMENTATION` 环境变量切换 Cyclone DDS |
| UNC-9 | 避障算法 | TEB 内置避障 + FCL 安全碰撞检测 | `local_planner.plugin` 参数支持切换 DWA/VO |

---

## 附录 A：关键性能指标映射

| 需求指标 | 架构实现方案 | 验证方式 |
|---------|-------------|---------|
| 调度频率 100Hz (10ms) | `central_scheduler` 使用 ROS2 Timer 定时器，100Hz 回调 | 性能测试脚本 |
| 路径规划 ≤ 50ms | A* 在 1000~5000m² 栅格地图上 O(N) 复杂度，预期 < 10ms | 单元测试 + 性能测试 |
| 避障响应 ≤ 10ms | TEB 100Hz 控制循环 + 安全控制器独立 100Hz 检测 | 集成测试 + 仿真验证 |
| 急停延迟 ≤ 10ms | 安全控制器实时线程（SCHED_FIFO），直接写 cmd_vel | 专用急停测试用例 |
| 定位频率 ≥ 50Hz | EKF 50Hz + AMCL 10~30Hz（备用） | 单元测试 |
| 安全等级 SIL2 | 双路独立急停 + 安全代码约束 + 静态分析 | 安全论证文档 |
| 可用性 ≥ 99.9% | 单点故障自动切换（心跳监测 + 看门狗） | 长期运行测试 |
| 故障切换 ≤ 100ms | 通信中断 100ms 内急停，恢复后 1s 恢复正常 | 通信中断测试场景 |

## 附录 B：ROS2 包依赖关系

```
agv_msgs (无依赖)
    ↑
agv_core (依赖: agv_msgs)
    ↑
┌───┼────────────────────────────────────┐
│   │                                    │
│   ├── agv_scheduler (依赖: agv_core)   │
│   ├── agv_fleet_manager (依赖: agv_msgs)│
│   ├── agv_traffic_control (依赖: agv_core)│
│   ├── agv_navigation (依赖: agv_core)  │
│   ├── agv_localization (依赖: agv_msgs)│
│   ├── agv_control (依赖: agv_core)     │
│   ├── agv_safety (依赖: agv_core)      │
│   ├── agv_simulation (依赖: agv_msgs)  │
│   ├── agv_api_gateway (依赖: agv_msgs) │
│   └── agv_visualization (依赖: agv_msgs)│
└─────────────────────────────────────────┘
```

## 附录 C：通信中断处理流程

```
正常通信 (100Hz 心跳)
    │
    ├── 心跳丢失 > 10ms
    │   └── 触发减速至 0.5m/s（层级 2）
    │
    ├── 心跳丢失 > 50ms
    │   └── 降低速度至 0.2m/s
    │   └── 尝试重连（DDS 自动发现）
    │
    ├── 心跳丢失 > 100ms
    │   └── 触发急停（层级 3）
    │   └── 本地保存当前任务状态
    │
    └── 通信恢复
        └── 恢复心跳检测
        └── 上报急停期间状态
        └── 接收调度器恢复指令
        └── 1s 内恢复正常运行
```

---

*文档结束*
