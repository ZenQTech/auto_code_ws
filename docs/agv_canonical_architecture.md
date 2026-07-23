# AGV 多车协同调度与导航系统 — 规范架构设计文档

> 版本：v2.0（合并版） | 日期：2026-07-01 | 基于需求文档 v1.0
>
> **合并来源**：
> - `architecture_design_v1.0.md` — 接口规范 + 节点拓扑骨架
> - `agv_architecture_design.md` — 4 层逻辑架构 + REST API 端点 + 数据流设计
> - `agv_multi_vehicle_architecture.md` — 仿真架构 + 安全架构 + 目录结构 + 不确定项处理

---

## 目录

1. [系统顶层架构](#1-系统顶层架构)
2. [ROS2 节点拓扑设计](#2-ros2-节点拓扑设计)
3. [全局接口规范](#3-全局接口规范)
4. [数据流与控制流设计](#4-数据流与控制流设计)
5. [安全架构设计](#5-安全架构设计)
6. [仿真架构](#6-仿真架构)
7. [技术决策说明](#7-技术决策说明)
8. [部署拓扑](#8-部署拓扑)
9. [项目目录结构](#9-项目目录结构)
10. [实现阶段规划](#10-实现阶段规划)
11. [不确定项与扩展接口](#11-不确定项与扩展接口)
12. [附录](#12-附录)

---

## 1. 系统顶层架构

### 1.1 架构风格：混合式（集中调度 + 分布式执行）

系统采用 **四层逻辑架构**，自顶向下依次为：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    外部系统集成层 (Layer 4)                           │
│  ┌──────────────────┐  ┌───────────────────┐  ┌─────────────────┐  │
│  │ REST API Gateway │  │ WebSocket 监控推送 │  │ 外部 MES/WMS    │  │
│  │ (FastAPI/Flask)  │  │ (实时状态/告警)    │  │ 对接            │  │
│  └────────┬─────────┘  └─────────┬─────────┘  └────────┬────────┘  │
└───────────┼──────────────────────┼──────────────────────┼───────────┘
            │ HTTP/WS              │                      │
            ▼                      ▼                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  中心调度决策层 (Layer 3 — 中心服务器)                 │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ 全局任务调度器   │  │ 车队状态管理器    │  │ 交通管制/死锁     │   │
│  │ (TaskDispatcher)│  │(FleetStateManager)│  │(TrafficManager)  │   │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘   │
│           │                    │                      │              │
│  ┌────────┴────────┐  ┌────────┴─────────┐                       │   │
│  │ 地图服务节点    │  │ 全局路径规划器    │                       │   │
│  │ (MapService)    │  │ (GlobalPlanner)  │                       │   │
│  └─────────────────┘  └──────────────────┘                       │   │
└─────────────────────────────────────────────────────────────────────┘
            │ ROS2 DDS over WiFi 5/6 局域网
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  车载自治层 (Layer 2 — 每台 AGV)                     │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ 车辆状态机      │  │ 局部路径规划器    │  │ 避障模块          │   │
│  │ (VehicleFSM)    │  │ (LocalPlanner)   │  │(ObstacleAvoidance)│   │
│  └────────┬────────┘  └────────┬─────────┘  └────────┬─────────┘   │
│           │                    │                      │              │
│  ┌────────┴────────┐  ┌────────┴─────────┐  ┌────────┴─────────┐   │
│  │ 定位融合节点    │  │ 运动控制器        │  │ 安全看门狗        │   │
│  │ (Localization)  │  │(MotionController)│  │(SafetyWatchdog)  │   │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
            │ ROS2 DDS (localhost only)
            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                  仿真/传感器层 (Layer 1 — Gazebo Ignition)           │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐   │
│  │ Gazebo 仿真世界 │  │ 传感器插件        │  │ Gazebo Bridge    │   │
│  │ (多AGV模型+场景)│  │(LiDAR/IMU/Odom)  │  │(ros_ign_bridge)  │   │
│  └─────────────────┘  └──────────────────┘  └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 分层职责说明

| 层级 | 部署位置 | 职责 | 关键模块 |
|------|----------|------|----------|
| **Layer 4** | 中心服务器 | 人机交互、外部系统对接 | REST API Gateway、WebSocket Server |
| **Layer 3** | 中心服务器 | 全局调度决策、车队管理、交通管制 | TaskDispatcher、FleetStateManager、TrafficManager、MapService、GlobalPlanner |
| **Layer 2** | 车载端 (×N) | 实时控制、局部规划、安全防护 | VehicleFSM、LocalPlanner、ObstacleAvoidance、Localization、MotionController、SafetyWatchdog |
| **Layer 1** | 仿真主机 | 物理仿真、传感器数据生成 | Gazebo Simulation、Gazebo Bridge |

### 1.3 模块间依赖关系

```
API Gateway ──HTTP──▶ TaskDispatcher
TaskDispatcher ──ROS2 Action──▶ VehicleFSM (each AGV)
TaskDispatcher ──ROS2 Srv──▶ GlobalPlanner
TaskDispatcher ──ROS2 Srv──▶ FleetStateManager
GlobalPlanner ──ROS2 Srv──▶ MapService
GlobalPlanner ──ROS2 Topic──▶ LocalPlanner (global path reference)
TrafficManager ──ROS2 Topic──▶ LocalPlanner (reservation zones)
TrafficManager ──ROS2 Srv──▶ FleetStateManager

VehicleFSM ──内部调用──▶ LocalPlanner
LocalPlanner ──内部调用──▶ ObstacleAvoidance
LocalPlanner ──ROS2 Topic──▶ MotionController (cmd_vel)
ObstacleAvoidance ──ROS2 Topic──▶ Localization (obstacle map)
Localization ──ROS2 Topic──▶ MotionController (odom)
SafetyWatchdog ──读取──▶ Localization, MotionController, VehicleFSM
SafetyWatchdog ──ROS2 Topic──▶ VehicleFSM (estop command)

Gazebo ──ign topic──▶ Gazebo Bridge ──ROS2 Topic──▶ Localization, ObstacleAvoidance, SafetyWatchdog
```

---

## 2. ROS2 节点拓扑设计

### 2.1 中心服务器节点

| 节点名称 | 可执行文件 | 命名空间 | 实现语言 | 实时性 | 职责 |
|----------|-----------|----------|----------|--------|------|
| `task_dispatcher` | `task_dispatcher_node` | `/fleet` | C++17 | 软实时 (100Hz) | 全局任务调度与分配 |
| `fleet_state_manager` | `fleet_state_node` | `/fleet` | C++17 | 非实时 (10Hz) | 车队状态聚合与维护 |
| `global_planner` | `global_planner_node` | `/fleet` | C++17 | 软实时 (≤50ms) | 全局路径搜索 |
| `map_service` | `map_service_node` | `/fleet` | C++17 | 非实时 | 全局地图服务 |
| `traffic_manager` | `traffic_manager_node` | `/fleet` | C++17 | 软实时 | 交通管制与死锁解决 |
| `api_gateway` | `api_gateway_node` | `/fleet` | Python 3.10 | 非实时 | REST API 网关 |
| `monitor_aggregator` | `monitor_node` | `/fleet` | Python 3.10 | 非实时 | 监控数据聚合与 WebSocket 推送 |
| `safety_monitor` | `safety_monitor_node` | `/fleet` | C++17 | 软实时 | 全局安全监控 |

### 2.2 车载端节点（每台 AGV 一组，命名空间 `/agv_{id}`）

| 节点名称 | 可执行文件 | 实现语言 | 实时性 | 职责 |
|----------|-----------|----------|--------|------|
| `vehicle_fsm` | `vehicle_fsm_node` | C++17 | 软实时 | 车辆状态机 |
| `local_planner` | `local_planner_node` | C++17 | 硬实时 (≤10ms, 100Hz) | 局部路径规划 |
| `obstacle_avoidance` | `obstacle_avoidance_node` | C++17 | 硬实时 (≤10ms) | 避障模块 |
| `localization` | `localization_node` | C++17 | 硬实时 (≥50Hz) | 多传感器融合定位 |
| `motion_controller` | `motion_controller_node` | C++17 | 硬实时 (100Hz) | 运动控制执行 |
| `safety_watchdog` | `safety_watchdog_node` | C++17 | 硬实时 (≤10ms) | 安全看门狗（独立进程） |

> **重要**：`safety_watchdog` 必须作为独立进程运行（与主控制循环进程分离），以提供进程级隔离。

### 2.3 仿真端节点

| 节点名称 | 可执行文件 | 实现语言 | 职责 |
|----------|-----------|----------|------|
| `gazebo_bridge` | `ros_ign_bridge` | C++ | ROS2 ↔ Ignition 桥接 |
| `spawn_agv` | `spawn_agv_node` | Python | 多 AGV 生成管理器 |
| `scenario_manager` | `scenario_manager_node` | Python | 仿真场景管理 |
| `performance_monitor` | `performance_monitor_node` | Python | 仿真性能监控 |

---

## 3. 全局接口规范

### 3.1 ROS2 Topic 列表

#### 3.1.1 传感器数据 Topic（车载端内部）

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `/agv_{id}/scan` | `sensor_msgs/LaserScan` | Gazebo Bridge | localization, obstacle_avoidance, safety_watchdog | 30Hz | SensorData (BestEffort, depth=10) |
| `/agv_{id}/imu` | `sensor_msgs/Imu` | Gazebo Bridge | localization | 100Hz | SensorData (BestEffort, depth=10) |
| `/agv_{id}/odom` | `nav_msgs/Odometry` | Gazebo Bridge | localization, motion_controller | 100Hz | SensorData (BestEffort, depth=10) |
| `/agv_{id}/joint_states` | `sensor_msgs/JointState` | Gazebo Bridge | motion_controller | 50Hz | SystemDefault |

#### 3.1.2 定位与状态 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `/agv_{id}/localization/pose` | `geometry_msgs/PoseWithCovarianceStamped` | localization | local_planner, motion_controller, fleet_state_manager | 50Hz | TransientLocal + Reliable |
| `/agv_{id}/odom_filtered` | `nav_msgs/Odometry` | localization | safety_watchdog | 50Hz | SystemDefault |
| `/agv_{id}/vehicle_state` | `agv_msgs/VehicleState` | vehicle_fsm | fleet_state_manager, monitor_aggregator | 10Hz | TransientLocal + Reliable |
| `/agv_{id}/battery` | `sensor_msgs/BatteryState` | vehicle_fsm | fleet_state_manager, safety_watchdog | 1Hz | SystemDefault |

#### 3.1.3 规划与控制 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `/agv_{id}/global_path` | `nav_msgs/Path` | global_planner | local_planner | 按需 | TransientLocal + Reliable |
| `/agv_{id}/local_plan` | `nav_msgs/Path` | local_planner | motion_controller | 100Hz | SystemDefault |
| `/agv_{id}/cmd_vel` | `geometry_msgs/Twist` | motion_controller | Gazebo Bridge | 100Hz | BestEffort (KeepLast(1)) |
| `/agv_{id}/cmd_vel_limited` | `geometry_msgs/Twist` | safety_watchdog | motion_controller | 100Hz | SystemDefault |
| `/agv_{id}/obstacle_map` | `nav_msgs/OccupancyGrid` | obstacle_avoidance | local_planner | 10Hz | SystemDefault |

#### 3.1.4 安全关键 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | QoS |
|------------|----------|--------|--------|-----|
| `/agv_{id}/safety/estop` | `agv_msgs/EmergencyStop` | safety_watchdog | vehicle_fsm, motion_controller | **Reliable + Volatile (高优先级)** |
| `/agv_{id}/safety/status` | `agv_msgs/SafetyStatus` | safety_watchdog | monitor_aggregator | TransientLocal + Reliable |
| `/agv_{id}/safety/scan_filtered` | `sensor_msgs/LaserScan` | safety_watchdog | obstacle_avoidance | SensorData (BestEffort) |
| `/agv_{id}/safety/bumper` | `agv_msgs/BumperEvent` | safety_watchdog | vehicle_fsm | Reliable + Volatile |

#### 3.1.5 车队级 Topic（中心服务器通信）

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `/fleet/agv_states` | `agv_msgs/FleetState` | fleet_state_manager | monitor_aggregator, traffic_manager | 10Hz | TransientLocal + Reliable |
| `/fleet/traffic_zones` | `agv_msgs/TrafficZoneArray` | traffic_manager | local_planner (each AGV) | 按需 | SystemDefault |
| `/fleet/global_map` | `nav_msgs/OccupancyGrid` | map_service | global_planner, localization | 按需 | TransientLocal + Reliable |
| `/fleet/task_updates` | `agv_msgs/TaskStatusUpdate` | task_dispatcher | monitor_aggregator | 事件驱动 | SystemDefault |
| `/fleet/monitor/metrics` | `agv_msgs/SystemMetrics` | monitor_aggregator | (可视化前端 via WebSocket) | 5Hz | SystemDefault |

### 3.2 ROS2 Service 列表

| Service 名称 | 服务类型 | 服务端 | 客户端 | 描述 |
|-------------|----------|--------|--------|------|
| `/fleet/dispatch_task` | `agv_msgs/DispatchTask` | task_dispatcher | api_gateway | 外部系统下发新任务 |
| `/fleet/cancel_task` | `agv_msgs/CancelTask` | task_dispatcher | api_gateway | 取消指定任务 |
| `/fleet/query_task` | `agv_msgs/QueryTask` | task_dispatcher | api_gateway | 查询任务状态 |
| `/fleet/query_agv` | `agv_msgs/QueryAGV` | fleet_state_manager | api_gateway | 查询指定 AGV 状态 |
| `/fleet/query_fleet` | `agv_msgs/QueryFleet` | fleet_state_manager | api_gateway | 查询全车队状态 |
| `/fleet/plan_path` | `agv_msgs/PlanPath` | global_planner | task_dispatcher | 请求全局路径规划 |
| `/fleet/get_map` | `agv_msgs/GetMap` | map_service | global_planner, api_gateway | 获取全局地图数据 |
| `/fleet/update_map` | `agv_msgs/UpdateMap` | map_service | api_gateway | 更新地图 |
| `/fleet/reserve_zone` | `agv_msgs/ReserveZone` | traffic_manager | local_planner | 申请路径区域预留 |
| `/fleet/release_zone` | `agv_msgs/ReleaseZone` | traffic_manager | local_planner | 释放路径区域预留 |
| `/fleet/detect_deadlock` | `agv_msgs/DetectDeadlock` | traffic_manager | task_dispatcher | 触发死锁检测 |
| `/fleet/resolve_deadlock` | `agv_msgs/ResolveDeadlock` | traffic_manager | task_dispatcher | 执行死锁解锁 |
| `/fleet/set_scheduler_config` | `agv_msgs/SchedulerConfig` | task_dispatcher | api_gateway | 动态切换调度策略 |
| `/fleet/set_safety_params` | `agv_msgs/SafetyParams` | (广播至所有 AGV) | api_gateway | 更新安全参数 |
| `/agv_{id}/set_goal` | `agv_msgs/SetGoal` | vehicle_fsm | task_dispatcher | 设定 AGV 目标点 |
| `/agv_{id}/pause_resume` | `agv_msgs/PauseResume` | vehicle_fsm | task_dispatcher | 暂停/恢复 AGV |
| `/agv_{id}/manual_estop` | `agv_msgs/ManualEstop` | safety_watchdog | api_gateway | 人工触发急停 |
| `/agv_{id}/clear_estop` | `agv_msgs/ClearEstop` | safety_watchdog | api_gateway | 急停解除 |
| `/agv_{id}/recover_localization` | `agv_msgs/RecoverLocalization` | localization | vehicle_fsm | 定位恢复请求 |

### 3.3 ROS2 Action 列表

| Action 名称 | 动作类型 | 服务端 | 客户端 | 描述 |
|-------------|----------|--------|--------|------|
| `/fleet/execute_task` | `agv_msgs/ExecuteTask` | task_dispatcher | api_gateway | 外部系统下发异步任务（含跟踪反馈） |
| `/agv_{id}/navigate` | `agv_msgs/Navigate` | vehicle_fsm | task_dispatcher | 导航到目标点（含进度反馈） |
| `/agv_{id}/charge` | `agv_msgs/Charge` | vehicle_fsm | task_dispatcher | 执行充电任务 |
| `/agv_{id}/dock` | `agv_msgs/Dock` | vehicle_fsm | task_dispatcher | 执行停靠任务 |
| `/agv_{id}/patrol` | `agv_msgs/Patrol` | vehicle_fsm | task_dispatcher | 执行巡检任务 |

### 3.4 自定义消息类型 (agv_msgs)

#### 3.4.1 消息定义

| 消息名称 | 关键字段 | 用途 |
|----------|----------|------|
| `VehicleState` | `string agv_id`, `uint8 state`(IDLE/NAVIGATING/CHARGING/ESTOP/FAILED), `Pose pose`, `float32 battery`, `float32 speed`, `string current_task_id` | AGV 状态上报 |
| `FleetState` | `VehicleState[] vehicles`, `builtin_interfaces/Time timestamp` | 全车队状态聚合 |
| `EmergencyStop` | `uint8 source`(LASER/COMM/LOCALIZATION/SPEED/BATTERY/MANUAL), `string reason` | 急停指令 |
| `SafetyStatus` | `bool estop_active`, `uint8[] active_sources`, `float32 min_obstacle_distance`, `float32 current_speed`, `float32 speed_limit` | 安全状态 |
| `BumperEvent` | `bool pressed`, `builtin_interfaces/Time timestamp` | 虚拟 Bumper 事件 |
| `TrafficZone` | `string zone_id`, `uint8 state`(FREE/RESERVED/OCCUPIED), `string holder_agv_id` | 交通区域状态 |
| `TrafficZoneArray` | `TrafficZone[] zones` | 批量交通区域 |
| `TaskStatusUpdate` | `string task_id`, `uint8 status`, `string assigned_agv_id`, `float32 progress` | 任务状态更新 |
| `SystemMetrics` | `float32 task_completion_rate`, `float32 avg_wait_time`, `uint32 collision_count`, `uint32 active_agvs` | 系统运行指标 |

#### 3.4.2 关键 Service 定义

| Service 名称 | Request 字段 | Response 字段 |
|-------------|-------------|---------------|
| `DispatchTask` | `TaskSpec task` | `bool success`, `string task_id`, `string message` |
| `CancelTask` | `string task_id` | `bool success`, `string message` |
| `QueryTask` | `string task_id` | `TaskStatus status` |
| `QueryAGV` | `string agv_id` | `VehicleState state` |
| `QueryFleet` | `--` | `FleetState fleet_state` |
| `PlanPath` | `PoseStamped start`, `PoseStamped goal` | `bool success`, `Path path` |
| `ReserveZone` | `string zone_id`, `string agv_id` | `bool granted`, `string message` |
| `ReleaseZone` | `string zone_id`, `string agv_id` | `bool success` |
| `DetectDeadlock` | `--` | `bool has_deadlock`, `string[] involved_agvs` |
| `ResolveDeadlock` | `string[] agv_ids` | `bool success`, `ResolvedAction[] actions` |
| `ManualEstop` | `string agv_id` | `bool success` |
| `ClearEstop` | `string agv_id` | `bool success` |

#### 3.4.3 关键 Action 定义

| Action 名称 | Goal 字段 | Feedback 字段 | Result 字段 |
|-------------|----------|--------------|-------------|
| `ExecuteTask` | `TaskSpec task` | `float32 progress`, `string status_detail` | `bool success`, `string task_id`, `string error_msg` |
| `Navigate` | `PoseStamped target_pose`, `float32 speed_override` | `float32 distance_remaining`, `float32 eta`, `Pose current_pose` | `bool reached`, `string message` |
| `Charge` | `string station_id` | `float32 battery_before`, `float32 battery_after` | `bool success`, `float32 final_battery` |
| `Dock` | `string dock_point_id` | `float32 distance_to_dock` | `bool success` |
| `Patrol` | `PoseStamped[] waypoints`, `uint32 loops` | `uint32 current_waypoint`, `uint32 loops_completed` | `bool completed` |

### 3.5 REST API 端点设计

| 方法 | 端点 | 描述 | 请求体 / 参数 | 响应 |
|------|------|------|--------------|------|
| POST | `/api/v1/tasks` | 下发新任务 | `{"type":"transport","priority":"high","pickup":"A1","dropoff":"B2","payload":"..."}` | `{"task_id":"uuid","status":"accepted"}` |
| GET | `/api/v1/tasks/{task_id}` | 查询任务状态 | -- | `{"task_id":"...","status":"...","progress":0.5,"assigned_agv":"agv_01"}` |
| DELETE | `/api/v1/tasks/{task_id}` | 取消任务 | -- | `{"success":true}` |
| GET | `/api/v1/tasks` | 任务列表 | `?status=running&page=1&size=20` | `{"tasks":[...],"total":50}` |
| POST | `/api/v1/tasks/batch` | 批量下发任务 | `{"tasks":[...]}` | `{"task_ids":[...]}` |
| GET | `/api/v1/agvs` | 查询所有 AGV 状态 | -- | `{"agvs":[{"id":"agv_01","state":"navigating",...}]}` |
| GET | `/api/v1/agvs/{agv_id}` | 查询指定 AGV | -- | `{"id":"agv_01","state":"...","battery":85.0,...}` |
| POST | `/api/v1/agvs/{agv_id}/estop` | 远程急停 | -- | `{"success":true}` |
| POST | `/api/v1/agvs/{agv_id}/estop/clear` | 解除急停 | -- | `{"success":true}` |
| POST | `/api/v1/agvs/{agv_id}/pause` | 暂停 AGV | -- | `{"success":true}` |
| POST | `/api/v1/agvs/{agv_id}/resume` | 恢复 AGV | -- | `{"success":true}` |
| GET | `/api/v1/map` | 获取当前地图 | -- | `{"map":"...","metadata":{...}}` |
| PUT | `/api/v1/map` | 更新地图 | `{"map":...,"metadata":{...}}` | `{"success":true}` |
| PUT | `/api/v1/config/scheduler` | 更新调度策略 | `{"strategy":"shortest_path"\|"least_load"}` | `{"success":true}` |
| PUT | `/api/v1/config/safety` | 更新安全参数 | `{"safety_distance":0.5,"speed_limits":{...}}` | `{"success":true}` |
| GET | `/api/v1/metrics` | 系统运行指标 | -- | `{"task_completion_rate":0.95,...}` |
| GET | `/api/v1/alerts` | 告警历史 | `?since=2026-07-01T00:00:00Z` | `{"alerts":[...]}` |
| WS | `/ws/v1/events` | WebSocket 实时推送 | -- | 实时推送状态/告警/指标事件 |

---

## 4. 数据流与控制流设计

### 4.1 任务下发流程（从 API 到 AGV 执行）

```
外部系统 / 前端
     │ POST /api/v1/tasks
     ▼
┌──────────────────┐
│  API Gateway     │  ← 认证、限流、请求校验
└────────┬─────────┘
         │ call /fleet/dispatch_task (Service)
         ▼
┌──────────────────┐
│  TaskDispatcher  │  ← 任务优先级排队、调度策略选择
└────────┬─────────┘
         │
         ├── 1. call /fleet/plan_path (Service) → GlobalPlanner
         │      ├── 2. call /fleet/get_map (Service) → MapService
         │      └── 3. 返回全局路径
         │
         ├── 4. call /fleet/query_fleet (Service) → FleetStateManager
         │
         ├── 5. 调度决策：选择最优 AGV
         │
         ├── 6. send_goal → /agv_{id}/navigate (Action)
         │      │
         │      ▼
         │  ┌──────────────────┐
         │  │  VehicleFSM      │  ← 状态: IDLE → NAVIGATING
         │  └────────┬─────────┘
         │           ├── 7. 接收 global_path (Topic)
         │           ├── 8. LocalPlanner 生成局部轨迹
         │           ├── 9. MotionController 执行 cmd_vel
         │           └── 10. 定期反馈 Action feedback
         │
         └── 11. Action result → 任务状态更新
```

**时序关键点**：
- 步骤 1~5：≤ 500ms（含路径规划 + 调度决策）
- 步骤 6~9：≤ 10ms（控制周期）
- 步骤 10：≥ 50Hz（反馈更新）

### 4.2 实时控制数据流（传感器 → 定位 → 规划 → 控制）

```
控制周期：100Hz (10ms)，端到端延迟 ≤ 20ms

Gazebo 仿真世界
     │
     ├── /agv_{id}/scan (LiDAR, 30Hz) ──────────────────┐
     ├── /agv_{id}/imu (IMU, 100Hz) ─────┐              │
     ├── /agv_{id}/odom (Odometry, 100Hz) ┤              │
     │                                     ▼              ▼
     │                              ┌────────────┐  ┌──────────────┐
     │                              │Localization│  │ObstacleAvoid │
     │                              │(EKF/AMCL)  │  │(Costmap)     │
     │                              │ 50Hz       │  │ 50Hz         │
     │                              └─────┬──────┘  └──────┬───────┘
     │                                    │                │
     │         ┌──────────────────────────┘                │
     │         │  /agv_{id}/localization/pose              │
     │         ▼                                           ▼
     │  ┌────────────────┐                     ┌────────────────┐
     │  │  LocalPlanner  │◄────────────────────│ obstacle_map   │
     │  │  (TEB/DWA)     │                     │                │
     │  │  100Hz         │                     └────────────────┘
     │  └───────┬────────┘
     │          │  /agv_{id}/local_plan
     │          ▼
     │  ┌────────────────┐
     │  │MotionController│  ← 双层速度限幅（内部 + SafetyWatchdog）
     │  │(PID/MPC)       │
     │  │  100Hz         │
     │  └───────┬────────┘
     │          │  /agv_{id}/cmd_vel
     ▼          ▼
  Gazebo 车轮控制插件（仿真执行）
```

### 4.3 安全数据流（独立冗余路径）

```
┌══════════════════════════════════════════════════════════┐
║              安全关键路径（独立冗余，进程级隔离）              ║
║                                                          ║
║  ┌────────────────┐  ┌──────────────┐                    ║
║  │ LiDAR 原始数据  │  │ 仿真 Bumper  │                    ║
║  │ /agv_{id}/scan │  │ /bumper      │                    ║
║  └────────┬───────┘  └──────┬───────┘                    ║
║           │                 │                            ║
║           ▼                 ▼                            ║
║  ┌─────────────────────────────────────────┐             ║
║  │        SafetyWatchdog (独立进程)          │             ║
║  │                                         │             ║
║  │  1. LiDAR 最小距离检测                   │             ║
║  │     阈值: 0.3m (急停) / 0.5m (减速)      │             ║
║  │  2. 通信超时检测                         │             ║
║  │     阈值: 100ms (无 odom/pose 更新)      │             ║
║  │  3. 速度越限检测                         │             ║
║  │     阈值: 最大线速度120% = 1.8 m/s       │             ║
║  │  4. 定位跳变检测                         │             ║
║  │     阈值: 相邻帧跳变 > 0.5m              │             ║
║  │  5. 低电量检测                           │             ║
║  │     阈值: 电池 < 5%                      │             ║
║  │  6. 人工急停监听 (Service)               │             ║
║  └──────────────────┬──────────────────────┘             ║
║                     │                                    ║
║          触发条件任一满足                                 ║
║                     ▼                                    ║
║  ┌─────────────────────────────────────────┐             ║
║  │          急停执行逻辑                     │             ║
║  │  publish /agv_{id}/safety/estop         │             ║
║  │     → vehicle_fsm: 状态切换到 ESTOP      │             ║
║  │     → motion_controller: 强制停止输出    │             ║
║  │     → 覆盖 cmd_vel 为 0                 │             ║
║  └─────────────────────────────────────────┘             ║
╚══════════════════════════════════════════════════════════╝
```

---

## 5. 安全架构设计

### 5.1 安全关键路径识别

**安全关键模块（SIL2 级别）**：
1. `safety_watchdog` — 主安全看门狗（碰撞检测、速度限幅、急停触发）
2. 急停信号处理路径（双路独立）
3. 速度限幅逻辑（三层限幅）
4. 通信中断检测

**非安全关键模块**：任务调度、路径规划、定位、可视化、API 网关

### 5.2 双路急停架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                        双路独立急停架构                                │
│                                                                      │
│  路径 A: 软件急停 (SafetyWatchdog 节点)                               │
│    碰撞预测 (FCL) ──▶ 急停判断 ──▶ /agv_{id}/safety/estop (Topic)   │
│    定位丢失检测        逻辑      ──▶ cmd_vel = 0                     │
│    通信中断检测                                                       │
│    远程急停 (Service)                                                 │
│    超速检测                                                           │
│                                                                      │
│  路径 B: 硬件级急停 (仿真中 = 独立 Safety Monitor 节点)                │
│    Gazebo 仿真急停传感器 ──▶ 独立 Safety Monitor                     │
│    仿真 GPIO 模拟按钮    ──▶ 直接写入仿真底盘 /cmd_vel=0              │
│                                                                      │
│  安全论证：两路各自独立触发急停，任何一路触发即产生 STOP               │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.3 三层速度限幅机制

```
层级 1: 工作速度
  默认最大 1.5 m/s
  由调度器/交通管制动态设置
  受区域限制（充电区 ≤0.3m/s, 装卸区 ≤0.3m/s）
         │
层级 2: 减速区
  触发条件: 障碍物 < 2.0m / 接近交叉口 / 通信质量下降
  限速: 0.5 m/s
         │
层级 3: 急停
  触发条件:
    - 障碍物 < 0.3m（前方）/ 0.3m（侧后）
    - 通信中断 > 100ms
    - 定位丢失 > 0.5m
    - 超速 120% (1.8 m/s)
    - 电量 < 5%
    - 人工急停
  动作: cmd_vel = 0
```

### 5.4 安全触发条件矩阵

| 触发条件 | 检测方式 | 检测延迟 | 动作 | SIL2 |
|----------|---------|---------|------|------|
| 障碍物 < 0.3m | LiDAR 最近点检测 | <10ms | 急停 | 是 |
| 障碍物 < 2.0m | LiDAR 安全区域检测 | <10ms | 减速至 0.5m/s | 是 |
| 通信中断 > 100ms | 心跳超时检测 | ≤100ms | 急停 | 是 |
| 定位丢失 > 0.5m | EKF 协方差监测 | ≤10ms | 急停 | 是 |
| 超速 > 120% (1.8m/s) | 速度反馈监测 | ≤10ms | 急停 | 是 |
| 电量 < 5% | 电池监测 | ≤100ms | 急停 | 是 |
| 人工急停 | 远程 Service / 仿真按钮 | ≤10ms | 急停 | 是 |
| 低电量 < 20% | 电池监测 | 按需 | 触发充电任务 | 否 |

### 5.5 安全代码约束

**实时循环（100Hz, 10ms 周期）内禁止**：
- ❌ 动态内存分配（new/delete/malloc/free）
- ❌ 阻塞操作（sleep/mutex_lock/条件变量等待）
- ❌ 文件 I/O（读写文件、日志写入）
- ❌ 高频日志
- ❌ 异常抛出和捕获
- ❌ 虚函数调用
- ❌ 容器动态扩容

**实时循环内允许**：
- ✅ 栈上分配（固定大小数组）
- ✅ 预分配内存池
- ✅ 原子操作（std::atomic）
- ✅ 无锁队列（boost::lockfree::spsc_queue）
- ✅ 固定大小 ring buffer

### 5.6 通信故障降级策略

| 故障类型 | 检测方式 | 降级动作 | 恢复方式 |
|----------|----------|----------|----------|
| 中心 → 车载 Topic 中断 | SafetyWatchdog 100ms 超时 | 车载本地急停 | 通信恢复后自动清除急停 |
| 车载 → 中心 Topic 中断 | FleetStateManager 500ms 超时 | 标记 AGV 为 LOST，停止分配新任务 | 状态恢复后自动重新注册 |
| 中心服务器宕机 | 车载端检测 /fleet 命名空间 Topic 消失 | 各 AGV 完成当前任务后进入 IDLE | 中心恢复后重新同步状态 |
| 网络分区（部分 AGV 断连） | 同上 | 断连 AGV 本地继续执行 + 完成后 IDLE | 网络恢复后状态合并 |

---

## 6. 仿真架构

### 6.1 Gazebo 仿真世界规格

| 参数 | 规格 |
|------|------|
| 仿真平台 | Gazebo Ignition Fortress (Gazebo Garden 备选) |
| 场景面积 | 500m²（约 25m × 20m） |
| 货架布局 | 4 排货架，每排 10 组，组间距 2m |
| 通道 | 2 条主通道（宽 3m）+ 4 条副通道（宽 2m） |
| 固定区域 | 充电区（4 个充电位）、装卸区（2 个工位） |
| 物理引擎 | DART（Gazebo Fortress 默认） |
| 仿真步长 | 0.001s（1ms），与 100Hz 控制循环匹配 |
| 实时因子目标 | ≥ 0.95 |

### 6.2 传感器插件选型

| 传感器 | Gazebo 插件 | 参数配置 | 说明 |
|--------|------------|---------|------|
| **3D LiDAR** | `ignition::gazebo::systems::Lidar` | 16 线, 30m 范围, 30Hz | 模拟 Velodyne VLP-16 |
| **IMU** | `ignition::gazebo::systems::Imu` | 100Hz, 噪声参数可配置 | 模拟 BNO055 |
| **轮式里程计** | 自定义 `OdometryPublisher` | 100Hz | 基于轮速编码器仿真 |
| **RGB-D 相机** | `ignition::gazebo::systems::RgbdCamera` | 640x480, 30Hz | 前+后各一个 |
| **超声波** | 自定义距离传感器插件 | 4 方向, 1m 范围 | 近距离避障 |
| **接触传感器** | `ignition::gazebo::systems::TouchPlugin` | 碰撞检测 | 安全触边仿真 |
| **急停按钮** | 自定义仿真插件 | GUI 交互按钮 | 安全测试 |

### 6.3 AGV URDF 模型设计

```
AGV URDF 模型结构：
┌───────────────────────────────────────────────┐
│                  AGV Body (800×600×300mm)       │
│  ┌────────────┐          ┌────────────┐       │
│  │ 3D LiDAR   │          │ RGB-D Cam  │       │
│  │ (顶置)     │          │ (前置+后置) │       │
│  └────────────┘          └────────────┘       │
│                                                │
│  ┌────────────┐    ┌────────────┐              │
│  │ IMU        │    │ 超声波×4   │              │
│  │ (中心)     │    │ (四面)     │              │
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

差速驱动模型（两轮独立驱动 + 万向轮支撑）
尺寸：800×600×300mm（长×宽×高）
轮距：500mm
最大速度：1.5 m/s
额定载荷：500kg
```

### 6.4 仿真与真实代码复用策略

```
核心算法层（100% 复用）
  - 全局路径规划 (A* / Hybrid A*)
  - 局部路径规划 (TEB / DWA)
  - 定位融合 (EKF)
  - 碰撞检测 (FCL)
  - 死锁检测与解锁
         │
业务层（>90% 复用）
  - 任务调度器
  - 交通管制器
  - 安全控制器（传感器源切换）
  - API 网关
         │
    ┌────┴────┐
    ▼         ▼
仿真 HAL    真实 HAL（预留）
 - ros_ign_   - LiDAR 驱动
   bridge     - 底盘驱动
 - 仿真传感器  - IMU 驱动
 - 仿真底盘    - 硬件急停

切换方式：launch 文件参数 simulation:=true/false
```

---

## 7. 技术决策说明

### 7.1 关键算法选型

| 模块 | 推荐算法 | 备选方案 | 选型理由 |
|------|----------|----------|----------|
| **全局路径规划** | A* (8 方向 + 路径平滑) | Hybrid A* / Dijkstra | 栅格地图成熟度最高，500m² 场景 ≤50ms |
| **局部路径规划** | TEB (Timed Elastic Band) | DWA / MPC | 支持多约束优化，ROS2 生态成熟 |
| **定位融合** | EKF (robot_localization) + AMCL 备用 | UKF / 粒子滤波 | ROS2 标准包，多传感器融合 |
| **任务调度** | 优先级拍卖算法 | 匈牙利算法 / 贪心 | 3-5 台规模下拍卖算法兼顾公平与效率 |
| **避障** | TEB 内置避障 + FCL 安全碰撞检测 | VFF / VO | 与局部规划器一体化，安全层独立 |
| **死锁解锁** | 优先级回退策略 | 交通规则 / 预约机制 | 实现简单，配合调度层避免死锁 |

### 7.2 架构权衡

| 决策 | 选择 | 权衡分析 |
|------|------|----------|
| **集中调度 vs 分布式** | 集中调度（混合部署） | ✅ 全局最优、易于监控 / ❌ 单点故障 → 热备解决 |
| **C++ vs Python** | 实时模块 C++17，非实时 Python | ✅ 实时保证 / ❌ 开发效率略低 |
| **独立安全节点 vs 内嵌安全** | 独立安全节点（独立进程） | ✅ 物理隔离、独立验证 |
| **Gazebo Ignition vs Classic** | Ignition (Fortress/Garden) | ✅ ROS2 原生支持更好 |
| **Fast-DDS vs Cyclone DDS** | Fast-DDS（默认） | ✅ ROS2 Humble 默认，兼容性最好 |

### 7.3 设计原则

1. **关注点分离**：调度、规划、控制、安全各自独立节点
2. **安全优先**：安全节点与业务节点物理隔离，安全路径独立于业务路径
3. **命名空间隔离**：每台 AGV 独立命名空间 `/agv_{id}`
4. **参数外部化**：所有算法参数通过 YAML 配置，支持运行时动态调整
5. **渐进式仿真**：单 AGV → 多 AGV → 全场景逐步验证
6. **可观测性**：所有关键路径都有心跳、状态上报、性能指标

---

## 8. 部署拓扑

### 8.1 中心服务器节点

```
中心服务器 (Ubuntu 22.04 + ROS2 Humble)
├── task_dispatcher      (C++17, 100Hz 主循环)
├── fleet_state_manager  (C++17, 10Hz 主循环)
├── global_planner       (C++17, ≤50ms 响应)
├── map_service          (C++17, 事件驱动)
├── traffic_manager      (C++17, 事件驱动)
├── api_gateway          (Python 3.10, FastAPI + rosbridge)
├── monitor_aggregator   (Python 3.10, WebSocket)
├── safety_monitor       (C++17, 软实时)
└── rviz2 / Foxglove     (可视化, 可选)
```

### 8.2 车载端节点（每台 AGV 命名空间 `/agv_{id}`）

```
/agv_{id}/
├── vehicle_fsm          (C++17, 状态机)
├── local_planner        (C++17, ≤10ms 响应, 100Hz 循环)
├── obstacle_avoidance   (C++17, ≤10ms 响应)
├── localization         (C++17, ≥50Hz 输出)
├── motion_controller    (C++17, 100Hz 控制循环)
├── safety_watchdog      (C++17, ≤10ms 响应, 独立进程)
└── gazebo_bridge        (ros_ign_bridge)
```

### 8.3 网络分区与 QoS 策略

| 分区 | 通信类型 | QoS Profile | 说明 |
|------|----------|-------------|------|
| **传感器数据** | Topic | `SENSOR_DATA` (BestEffort, KeepLast(5)) | LiDAR/IMU/Odom，低延迟 |
| **控制指令** | Topic | `SYSTEM_DEFAULT` (BestEffort, KeepLast(1)) | cmd_vel，最新优先 |
| **状态数据** | Topic | `BEST_EFFORT` (KeepLast(10)) | 心跳、电池、状态 |
| **安全数据** | Topic | `RELIABLE` (KeepLast(5), TransientLocal) | 安全状态、急停指令 |
| **任务指令** | Action/Service | `RELIABLE` (KeepLast(1)) | 任务下发，不丢包 |
| **地图数据** | Topic/Service | `RELIABLE` (TransientLocal) | 地图，晚加入节点可获取 |

---

## 9. 项目目录结构

```
agv_fleet_ws/                              # ROS2 Workspace 根目录
├── src/                                   # 源码目录
│   ├── agv_core/                          # 核心库包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_core/
│   │   │   ├── types.h                    # 核心数据结构
│   │   │   ├── constants.h                # 系统常量
│   │   │   ├── utils.h                    # 工具函数
│   │   │   └── lifecycle/                 # 生命周期管理
│   │   └── src/
│   │
│   ├── agv_msgs/                          # 自定义消息包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── msg/                           # 消息定义
│   │   │   ├── VehicleState.msg
│   │   │   ├── FleetState.msg
│   │   │   ├── EmergencyStop.msg
│   │   │   ├── SafetyStatus.msg
│   │   │   ├── BumperEvent.msg
│   │   │   ├── TrafficZone.msg
│   │   │   ├── TrafficZoneArray.msg
│   │   │   ├── TaskStatusUpdate.msg
│   │   │   └── SystemMetrics.msg
│   │   ├── srv/                           # 服务定义
│   │   │   ├── DispatchTask.srv
│   │   │   ├── CancelTask.srv
│   │   │   ├── QueryTask.srv
│   │   │   ├── QueryAGV.srv
│   │   │   ├── QueryFleet.srv
│   │   │   ├── PlanPath.srv
│   │   │   ├── GetMap.srv
│   │   │   ├── UpdateMap.srv
│   │   │   ├── ReserveZone.srv
│   │   │   ├── ReleaseZone.srv
│   │   │   ├── DetectDeadlock.srv
│   │   │   ├── ResolveDeadlock.srv
│   │   │   ├── SetGoal.srv
│   │   │   ├── PauseResume.srv
│   │   │   ├── ManualEstop.srv
│   │   │   ├── ClearEstop.srv
│   │   │   └── RecoverLocalization.srv
│   │   └── action/                        # 动作定义
│   │       ├── ExecuteTask.action
│   │       ├── Navigate.action
│   │       ├── Charge.action
│   │       ├── Dock.action
│   │       └── Patrol.action
│   │
│   ├── agv_scheduler/                     # 调度器包（中心服务器）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_scheduler/
│   │   │   ├── central_scheduler.h
│   │   │   ├── charge_scheduler.h
│   │   │   └── auction_algorithm.h
│   │   └── src/
│   │       ├── central_scheduler_node.cpp
│   │       ├── charge_scheduler_node.cpp
│   │       └── auction_algorithm.cpp
│   │
│   ├── agv_fleet_manager/                 # 车队管理包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_fleet_manager/
│   │   │   ├── fleet_state_manager.h
│   │   │   └── health_monitor.h
│   │   └── src/
│   │       ├── fleet_state_manager_node.cpp
│   │       └── health_monitor.cpp
│   │
│   ├── agv_traffic_control/               # 交通管制包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_traffic_control/
│   │   │   ├── traffic_manager.h
│   │   │   ├── intersection_manager.h
│   │   │   ├── path_segment_locker.h
│   │   │   ├── deadlock_detector.h
│   │   │   └── deadlock_resolver.h
│   │   └── src/
│   │       ├── traffic_manager_node.cpp
│   │       ├── intersection_manager.cpp
│   │       ├── path_segment_locker.cpp
│   │       ├── deadlock_detector.cpp
│   │       └── deadlock_resolver.cpp
│   │
│   ├── agv_navigation/                    # 导航包（车载端）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_navigation/
│   │   │   ├── global_planner/
│   │   │   │   ├── astar_planner.h
│   │   │   │   └── hybrid_astar_planner.h
│   │   │   ├── local_planner/
│   │   │   │   ├── teb_planner.h
│   │   │   │   ├── dwa_planner.h
│   │   │   │   └── planner_plugin.h
│   │   │   └── costmap/
│   │   │       ├── costmap_layer.h
│   │   │       └── obstacle_layer.h
│   │   └── src/
│   │       ├── global_planner_node.cpp
│   │       ├── local_planner_node.cpp
│   │       ├── astar_planner.cpp
│   │       ├── teb_planner.cpp
│   │       └── costmap/
│   │
│   ├── agv_localization/                  # 定位包（车载端）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_localization/
│   │   │   ├── ekf_localizer.h
│   │   │   ├── amcl_wrapper.h
│   │   │   ├── sensor_sync.h
│   │   │   └── localization_monitor.h
│   │   └── src/
│   │       ├── localization_node.cpp
│   │       ├── ekf_localizer.cpp
│   │       └── localization_monitor.cpp
│   │
│   ├── agv_control/                       # 底盘控制包（车载端）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_control/
│   │   │   ├── differential_controller.h
│   │   │   ├── motion_model_plugin.h
│   │   │   ├── odometry_publisher.h
│   │   │   ├── cmd_mux.h
│   │   │   └── charge_controller.h
│   │   └── src/
│   │       ├── controller_node.cpp
│   │       ├── differential_controller.cpp
│   │       ├── odometry_publisher.cpp
│   │       └── cmd_mux.cpp
│   │
│   ├── agv_safety/                        # 安全包（车载端 + 中心）
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── include/agv_safety/
│   │   │   ├── safety_watchdog.h          # 主安全看门狗
│   │   │   ├── safety_monitor.h           # 全局安全监控
│   │   │   ├── collision_detector.h       # 碰撞检测（FCL）
│   │   │   ├── speed_limiter.h            # 三层速度限幅
│   │   │   ├── heartbeat_monitor.h        # 通信心跳监测
│   │   │   └── emergency_handler.h        # 急停处理
│   │   └── src/
│   │       ├── safety_watchdog_node.cpp
│   │       ├── safety_monitor_node.cpp
│   │       ├── collision_detector.cpp
│   │       ├── speed_limiter.cpp
│   │       ├── heartbeat_monitor.cpp
│   │       └── emergency_handler.cpp
│   │
│   ├── agv_simulation/                    # 仿真包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── worlds/
│   │   │   └── warehouse.world            # 默认仓储场景
│   │   ├── models/
│   │   │   ├── agv/
│   │   │   │   ├── model.sdf
│   │   │   │   └── agv.urdf.xacro
│   │   │   ├── shelf/
│   │   │   │   └── model.sdf
│   │   │   ├── charging_station/
│   │   │   │   └── model.sdf
│   │   │   └── loading_dock/
│   │   │       └── model.sdf
│   │   ├── include/agv_simulation/
│   │   │   ├── gazebo_bridge.h
│   │   │   ├── agv_spawner.h
│   │   │   ├── scenario_manager.h
│   │   │   └── performance_monitor.h
│   │   └── src/
│   │       ├── agv_spawner_node.cpp
│   │       ├── scenario_manager_node.cpp
│   │       └── performance_monitor_node.cpp
│   │
│   ├── agv_api_gateway/                   # API 网关包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   └── agv_api_gateway/
│   │       ├── __init__.py
│   │       ├── rest_server.py
│   │       ├── task_handler.py
│   │       └── ws_handler.py
│   │
│   ├── agv_visualization/                 # 可视化包
│   │   ├── CMakeLists.txt
│   │   ├── package.xml
│   │   ├── rviz/
│   │   │   └── agv_monitor.rviz
│   │   └── agv_visualization/
│   │       ├── __init__.py
│   │       └── web_bridge.py
│   │
│   └── agv_tools/                         # 工具脚本包
│       ├── CMakeLists.txt
│       ├── package.xml
│       └── scripts/
│           ├── task_generator.py
│           ├── scenario_runner.py
│           ├── performance_report.py
│           └── batch_test.py
│
├── launch/                                # 启动文件
│   ├── central_server.launch.py
│   ├── agv_single.launch.py
│   ├── simulation.launch.py
│   ├── full_system.launch.py
│   └── test_scenario.launch.py
│
├── config/                                # 全局配置
│   ├── nav2_params.yaml
│   ├── safety_params.yaml
│   ├── costmap_params.yaml
│   └── fleet_params.yaml
│
├── maps/                                  # 地图文件
│   └── warehouse_default.pgm
│
├── docker/                                # Docker 配置
│   ├── Dockerfile.central
│   ├── Dockerfile.onboard
│   └── docker-compose.yml
│
├── tests/                                 # 测试目录
│   ├── unit/
│   │   ├── test_astar_planner.cpp
│   │   ├── test_safety_watchdog.cpp
│   │   ├── test_auction_algorithm.cpp
│   │   └── test_deadlock_detector.cpp
│   ├── integration/
│   │   ├── test_single_agv_navigation.py
│   │   ├── test_multi_agv_avoidance.py
│   │   └── test_emergency_stop.py
│   └── performance/
│       ├── test_scheduling_latency.py
│       └── test_control_loop_timing.py
│
├── docs/                                  # AGV 专属文档
│   ├── architecture.md                    # 本文档
│   ├── api_reference.md
│   └── simulation_guide.md
│
├── .clang-format
├── .clang-tidy
├── .cppcheck-suppressions
├── colcon.meta
└── README.md
```

---

## 10. 实现阶段规划

### Phase 0: 环境搭建与基础包 (Week 1-2)
- 创建 ROS2 Workspace、安装依赖
- 创建 `agv_msgs` 和 `agv_core` 包
- 配置 colcon build、clang-tidy、cppcheck

### Phase 1: 单 AGV 仿真核心 (Week 3-5)
- 创建 AGV URDF/Xacro 模型
- 创建 Gazebo 仓库世界文件
- 配置 ros_ign_bridge
- 实现差速驱动控制器
- 验证：单 AGV 可被 cmd_vel 驱动

### Phase 2: 单 AGV 导航栈 (Week 5-8)
- EKF 定位融合
- A* 全局路径规划
- TEB 局部路径规划
- 基础安全控制器
- 验证：单 AGV 自主导航到目标点

### Phase 3: 多 AGV 协同与中心服务器 (Week 8-12)
- 任务调度器（拍卖算法）
- 车队状态管理
- 交通管制与死锁检测
- 多 AGV 生成管理
- 验证：3-5 台 AGV 同时运行

### Phase 4: 安全系统加固 (Week 12-14)
- 双路急停架构
- 三层速度限幅
- 通信看门狗
- 安全代码约束实施
- 验证：急停响应 ≤10ms

### Phase 5: API 网关与可视化 (Week 14-16)
- REST API 网关
- WebSocket 实时推送
- Foxglove/RViz2 可视化
- 工具脚本
- 验证：API 功能测试通过

### Phase 6: 仿真验收与优化 (Week 16-18)
- 50 组场景测试
- 性能优化
- 文档完善
- 验证：通过率 ≥90%

---

## 11. 不确定项与扩展接口

| 编号 | 不确定项 | 默认选择 [DEFAULT] | 扩展接口 [EXTENSION] |
|------|---------|-------------------|---------------------|
| U-01 | 3D LiDAR 具体型号 | Velodyne VLP-16 仿真（16线, 30m, 30Hz） | Gazebo Lidar 插件参数可配置 |
| U-02 | RGB-D 相机具体型号 | 640x480, 30Hz 仿真 | Gazebo RgbdCamera 插件参数可配置 |
| U-03 | 安全 PLC 具体型号 | 仿真中双通道逻辑替代 | 硬件接口通过 HAL 层隔离 |
| U-04 | AGV 电机型号与驱动参数 | 差速模型（轮径 200mm, 轮距 500mm） | `motion_model_plugin` 插件接口 |
| U-05 | 电池容量与充电策略 | 低电量 <20% 触发充电 | `charge_scheduler` 支持可配置策略 |
| U-06 | 仓库 Wi-Fi AP 布点 | 仿真中 localhost 通信 | 部署阶段配置 |
| U-07 | Cartographer vs slam_toolbox | EKF (robot_localization) + AMCL | 插件接口可切换 |
| U-08 | DDS 实现 | Fast-DDS | `RMW_IMPLEMENTATION` 环境变量切换 |
| U-09 | 地图格式 | 静态 OccupancyGrid + 预设 PGM | `map_server` 支持热替换 |

---

## 12. 附录

### 附录 A：节点启动依赖顺序

```
Phase 1: 仿真环境
  └── Gazebo Ignition (world + AGV models)

Phase 2: 基础服务
  ├── map_service
  └── gazebo_bridge (per AGV)

Phase 3: 车载端感知与控制
  ├── localization
  ├── safety_watchdog
  └── motion_controller

Phase 4: 车载端规划
  ├── global_planner (中心)
  └── local_planner

Phase 5: 中心服务
  ├── task_dispatcher
  ├── fleet_state_manager
  └── traffic_manager

Phase 6: 辅助
  ├── vehicle_fsm
  ├── api_gateway
  └── monitor_aggregator
```

### 附录 B：验收标准覆盖矩阵

| 验收项 | 涉及模块 | 关键接口 | 架构保障 |
|--------|----------|----------|----------|
| 无碰撞运行 | 全部 | `/agv_{id}/safety/estop`, `/fleet/traffic_zones` | 双重避障 + 交通管制 |
| 急停响应 ≤10ms | SafetyWatchdog, MotionController | `/agv_{id}/safety/estop` | 独立进程 + 禁止动态内存 |
| 定位精度 ≤5cm | Localization | `/agv_{id}/localization/pose` | 多传感器 EKF 融合 |
| 任务完成率 ≥98% | TaskDispatcher, VehicleFSM | `/fleet/dispatch_task`, `/agv_{id}/navigate` | 优先级调度 + 抢占 |
| 避障成功率 ≥95% | ObstacleAvoidance, SafetyWatchdog | `/agv_{id}/obstacle_map` | 传感器融合避障 |
| 通信中断恢复 | SafetyWatchdog, FleetStateManager | Deadline QoS | 100ms 超时 + 本地自主 |
| 仿真实时性 ≥0.95 | Gazebo, 全部节点 | 全部 | 控制循环周期保障 |

### 附录 C：ROS2 包依赖关系

```
agv_msgs (无依赖)
    ↑
agv_core (依赖: agv_msgs)
    ↑
┌───┼────────────────────────────────────┐
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

---

> 📌 **文档状态**：v2.0 规范版（合并完成） | **下一步**：Phase 0b — 创建 ROS2 Workspace 和基础包
