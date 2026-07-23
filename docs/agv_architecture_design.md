# AGV 多车协同调度与导航系统 — 顶层架构设计文档

> 版本：v1.0  
> 日期：2026-07-01  
> 设计者：总架构师智能体  
> 状态：待评审  

---

## 目录

1. [A. 系统顶层架构图](#a-系统顶层架构图)
2. [B. ROS2 节点拓扑设计](#b-ros2-节点拓扑设计)
3. [C. 全局接口规范](#c-全局接口规范)
4. [D. 数据流设计](#d-数据流设计)
5. [E. 关键设计决策](#e-关键设计决策)

---

## A. 系统顶层架构图

### A.1 逻辑分层架构

系统采用**四层逻辑架构**，自顶向下依次为：

```
+---------------------------------------------------------------+
|                    外部系统集成层 (Layer 4)                     |
|  +------------------+  +-------------------+  +-------------+  |
|  | REST API Gateway |  | WebSocket 监控推送 |  | 外部 MES/   |  |
|  | (FastAPI/Flask)  |  | (实时状态/告警)    |  | WMS 对接   |  |
|  +--------+---------+  +---------+---------+  +------+------+  |
+---------------------------------------------------------------+
           | HTTP/WS                          | ROS2 Action
           v                                   v
+---------------------------------------------------------------+
|                  中心调度决策层 (Layer 3 — 中心服务器)          |
|  +---------------------+  +------------------+                |
|  |  全局任务调度器      |  |  全局路径规划器   |                |
|  |  (TaskDispatcher)   |  | (GlobalPlanner)  |                |
|  +----------+----------+  +--------+---------+                |
|             |                       |                         |
|  +----------v----------+  +--------v---------+                |
|  | 车队状态管理器       |  | 地图服务节点      |                |
|  | (FleetStateManager) |  | (MapService)     |                |
|  +----------+----------+  +--------+---------+                |
|             |                       |                         |
|  +----------v----------+                                     |
|  | 交通管制/死锁解决器   |                                     |
|  | (TrafficManager)    |                                     |
|  +---------------------+                                     |
+---------------------------------------------------------------+
           | ROS2 DDS over WiFi
           v
+---------------------------------------------------------------+
|                  车载自治层 (Layer 2 — 每台 AGV)               |
|  +---------------------+  +------------------+                |
|  |  局部路径规划器      |  |  定位融合节点     |                |
|  |  (LocalPlanner)     |  | (Localization)   |                |
|  +----------+----------+  +--------+---------+                |
|             |                       |                         |
|  +----------v----------+  +--------v---------+                |
|  |  避障模块           |  |  运动控制器       |                |
|  |  (ObstacleAvoidance)|  | (MotionController)|               |
|  +----------+----------+  +--------+---------+                |
|             |                       |                         |
|  +----------v----------+  +--------v---------+                |
|  |  车载状态机          |  |  安全看门狗       |                |
|  |  (VehicleFSM)       |  | (SafetyWatchdog) |               |
|  +---------------------+  +------------------+                |
+---------------------------------------------------------------+
           | ROS2 DDS (同一进程内 / localhost only)
           v
+---------------------------------------------------------------+
|                  仿真/传感器层 (Layer 1 — Gazebo)              |
|  +---------------------+  +------------------+                |
|  |  Gazebo 仿真世界    |  |  传感器插件       |                |
|  |  (多AGV模型+场景)   |  | (LiDAR/IMU/Odom) |               |
|  +----------+----------+  +--------+---------+                |
|             |                       |                         |
|  +----------v----------+                                     |
|  |  Gazebo Bridge      |                                     |
|  | (ros2_ign_bridge)   |                                     |
|  +---------------------+                                     |
+---------------------------------------------------------------+
```

### A.2 模块划分与职责定义

| 层级 | 模块名称 | 部署位置 | 核心职责 |
|------|----------|----------|----------|
| Layer 4 | REST API Gateway | 中心服务器 | 对外提供 RESTful API，认证鉴权，请求限流 |
| Layer 4 | WebSocket Server | 中心服务器 | 实时推送 AGV 状态、告警、运行指标到前端 |
| Layer 3 | TaskDispatcher | 中心服务器 | 全局任务分配、优先级管理、任务生命周期追踪 |
| Layer 3 | GlobalPlanner | 中心服务器 | 全局最优路径搜索（A* / Hybrid A*）、路径分段 |
| Layer 3 | FleetStateManager | 中心服务器 | 聚合维护所有 AGV 实时状态、位置、电量、任务 |
| Layer 3 | MapService | 中心服务器 | 全局地图管理、拓扑图维护、区域划分 |
| Layer 3 | TrafficManager | 中心服务器 | 多 AGV 交通管制、路口资源分配、死锁检测与解锁 |
| Layer 2 | VehicleFSM | 车载端 | AGV 状态机（IDLE/NAVIGATING/CHARGING/ESTOP/FAILED） |
| Layer 2 | LocalPlanner | 车载端 | TEB / DWA 局部路径规划、速度指令生成 |
| Layer 2 | ObstacleAvoidance | 车载端 | 动态障碍物检测、多 AGV 相互避让、安全距离保持 |
| Layer 2 | Localization | 车载端 | AMCL / Cartographer 多传感器融合定位 |
| Layer 2 | MotionController | 车载端 | 底层运动控制（PID / MPC）、速度限幅执行 |
| Layer 2 | SafetyWatchdog | 车载端 | 安全逻辑独立循环：急停检测、速度监控、通信超时 |
| Layer 1 | Gazebo Simulation | 仿真主机 | 多 AGV 物理仿真、传感器数据生成 |
| Layer 1 | Gazebo Bridge | 仿真主机 | ROS2 ↔ Ignition Transport 双向桥接 |
| Layer 4 | Visualization Dashboard | 浏览器/桌面 | Web-based 实时可视化、地图编辑、告警管理 |

### A.3 模块间依赖关系

```
API Gateway ──HTTP──> TaskDispatcher
TaskDispatcher ──ROS2 Action──> VehicleFSM (each AGV)
TaskDispatcher ──ROS2 Srv──> GlobalPlanner
TaskDispatcher ──ROS2 Srv──> FleetStateManager
GlobalPlanner ──ROS2 Srv──> MapService
GlobalPlanner ──ROS2 Topic──> LocalPlanner (global path reference)
TrafficManager ──ROS2 Topic──> LocalPlanner (reservation zones)
TrafficManager ──ROS2 Srv──> FleetStateManager

VehicleFSM ──内部调用──> LocalPlanner
LocalPlanner ──内部调用──> ObstacleAvoidance
LocalPlanner ──ROS2 Topic──> MotionController (cmd_vel)
ObstacleAvoidance ──ROS2 Topic──> Localization (obstacle map)
Localization ──ROS2 Topic──> MotionController (odom)
SafetyWatchdog ──读取──> Localization, MotionController, VehicleFSM
SafetyWatchdog ──ROS2 Topic──> VehicleFSM (estop command)

Gazebo ──ign topic──> Gazebo Bridge ──ROS2 Topic──> Localization
Gazebo ──ign topic──> Gazebo Bridge ──ROS2 Topic──> SafetyWatchdog
```

---

## B. ROS2 节点拓扑设计

### B.1 中心服务器节点

| 节点名称 | 可执行文件 | 命名空间 | 职责 |
|----------|-----------|----------|------|
| `task_dispatcher` | `task_dispatcher_node` | `/fleet` | 全局任务调度与分配 |
| `global_planner` | `global_planner_node` | `/fleet` | 全局路径搜索 |
| `fleet_state_manager` | `fleet_state_node` | `/fleet` | 车队状态聚合与维护 |
| `map_service` | `map_service_node` | `/fleet` | 全局地图服务 |
| `traffic_manager` | `traffic_manager_node` | `/fleet` | 交通管制与死锁解决 |
| `api_gateway` | `api_gateway_node` | `/fleet` | REST API 网关（ROS2 包装节点） |
| `monitor_aggregator` | `monitor_node` | `/fleet` | 监控数据聚合与 WebSocket 推送 |

### B.2 车载端节点（每台 AGV 一组，命名空间 `/agv_{id}`）

| 节点名称 | 可执行文件 | 命名空间 | 职责 |
|----------|-----------|----------|------|
| `vehicle_fsm` | `vehicle_fsm_node` | `/agv_{id}` | 车辆状态机 |
| `local_planner` | `local_planner_node` | `/agv_{id}` | 局部路径规划 |
| `obstacle_avoidance` | `obstacle_avoidance_node` | `/agv_{id}` | 避障模块 |
| `localization` | `localization_node` | `/agv_{id}` | 多传感器融合定位 |
| `motion_controller` | `motion_controller_node` | `/agv_{id}` | 运动控制执行 |
| `safety_watchdog` | `safety_watchdog_node` | `/agv_{id}` | 安全看门狗（独立进程） |

> **重要**：`safety_watchdog` 必须作为独立进程运行（与主控制循环进程分离），以提供进程级隔离。

### B.3 仿真端节点

| 节点名称 | 可执行文件 | 命名空间 | 职责 |
|----------|-----------|----------|------|
| `gazebo_bridge` | `ros_ign_bridge` | `/agv_{id}` | ROS2 ↔ Ignition 桥接 |
| `spawn_agv` | `spawn_agv_node` | `/fleet` | 多 AGV 生成管理器 |

### B.4 节点间通信拓扑图

```
                         ┌──────────────────┐
                         │   API Gateway    │
                         │  /fleet/api      │
                         └────────┬─────────┘
                                  │ HTTP
                                  v
                         ┌──────────────────┐
                         │ TaskDispatcher   │
                         │  /fleet/task     │
                         └──┬────┬────┬─────┘
                            │    │    │
                Action Srv  │    │    │ Action Srv
                   /agv_1  │    │    │ /agv_{N}
                            v    │    v
  ┌───────────────────────────────────────────────────────┐
  │                    ROS2 DDS Domain                    │
  │  ┌──────────────┐  ┌──────────────┐  ┌────────────┐ │
  │  │ GlobalPlanner│  │ TrafficMgr   │  │ MapService │ │
  │  │ /fleet/global│  │ /fleet/traff │  │ /fleet/map │ │
  │  └──────┬───────┘  └──────┬───────┘  └─────┬──────┘ │
  │         │                 │                │         │
  │         └─────────────────┼────────────────┘         │
  │                          │                           │
  └──────────────────────────┼───────────────────────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              v              v              v
     ┌─────────────────────────────────────────────┐
     │              AGV 1 (车载端)                   │
     │  ┌──────────┐  ┌──────────┐  ┌───────────┐  │
     │  │VehicleFSM│  │LocalPlan│  │ObstacleAvd│  │
     │  │ /agv_1/fsm│  │ /agv_1/lo│  │ /agv_1/obs│ │
     │  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
     │       │              │              │        │
     │  ┌────v─────┐  ┌────v─────┐  ┌─────v─────┐  │
     │  │Localiztn │  │MotionCtrl│  │SafetyWatch│  │
     │  │/agv_1/loc│  │/agv_1/mot│  │/agv_1/safe│  │
     │  └────┬─────┘  └────┬─────┘  └─────┬─────┘  │
     │       │              │              │        │
     └───────┼──────────────┼──────────────┼────────┘
             │              │              │
             v              v              v
     ┌─────────────────────────────────────────────┐
     │            Gazebo 仿真 (AGV 1)               │
     │   LiDAR  /  IMU  /  Odometry  /  JointState  │
     └─────────────────────────────────────────────┘
```

---

## C. 全局接口规范

### C.1 ROS2 Topic 接口定义

#### C.1.1 传感器数据 Topic（车载端内部）

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | QoS 策略 |
|------------|----------|--------|--------|----------|
| `/agv_{id}/scan` | `sensor_msgs/LaserScan` | Gazebo Bridge | localization, obstacle_avoidance | SensorData (BestEffort, depth=10) |
| `/agv_{id}/imu` | `sensor_msgs/Imu` | Gazebo Bridge | localization | SensorData (BestEffort, depth=10) |
| `/agv_{id}/odom` | `nav_msgs/Odometry` | Gazebo Bridge | localization, motion_controller | SensorData (BestEffort, depth=10) |
| `/agv_{id}/joint_states` | `sensor_msgs/JointState` | Gazebo Bridge | motion_controller | SystemDefault |

#### C.1.2 定位与状态 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | QoS 策略 |
|------------|----------|--------|--------|----------|
| `/agv_{id}/localization/pose` | `geometry_msgs/PoseWithCovarianceStamped` | localization | local_planner, motion_controller, fleet_state_manager | TransientLocal + Reliable |
| `/agv_{id}/localization/map` | `nav_msgs/OccupancyGrid` | localization | obstacle_avoidance | TransientLocal + Reliable |
| `/agv_{id}/odom_filtered` | `nav_msgs/Odometry` | localization | safety_watchdog | SystemDefault |
| `/agv_{id}/vehicle_state` | `agv_msgs/VehicleState` | vehicle_fsm | fleet_state_manager, monitor_aggregator | TransientLocal + Reliable |
| `/agv_{id}/battery` | `sensor_msgs/BatteryState` | vehicle_fsm | fleet_state_manager, safety_watchdog | SystemDefault |

#### C.1.3 规划与控制 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | QoS 策略 |
|------------|----------|--------|--------|----------|
| `/agv_{id}/global_path` | `nav_msgs/Path` | global_planner | local_planner | TransientLocal + Reliable |
| `/agv_{id}/local_plan` | `nav_msgs/Path` | local_planner | motion_controller | SystemDefault |
| `/agv_{id}/cmd_vel` | `geometry_msgs/Twist` | motion_controller | Gazebo Bridge (仿真车轮控制) | SystemDefault |
| `/agv_{id}/cmd_vel_limited` | `geometry_msgs/Twist` | safety_watchdog | motion_controller (速度限幅后) | SystemDefault |
| `/agv_{id}/obstacle_map` | `nav_msgs/OccupancyGrid` | obstacle_avoidance | local_planner | SystemDefault |

#### C.1.4 安全关键 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | QoS 策略 |
|------------|----------|--------|--------|----------|
| `/agv_{id}/safety/estop` | `agv_msgs/EmergencyStop` | safety_watchdog | vehicle_fsm, motion_controller | **Reliable + Volatile (高优先级)** |
| `/agv_{id}/safety/status` | `agv_msgs/SafetyStatus` | safety_watchdog | monitor_aggregator | TransientLocal + Reliable |
| `/agv_{id}/safety/scan_filtered` | `sensor_msgs/LaserScan` | safety_watchdog | obstacle_avoidance (安全距离检测后) | SensorData (BestEffort) |
| `/agv_{id}/safety/bumper` | `agv_msgs/BumperEvent` | safety_watchdog | vehicle_fsm | Reliable + Volatile |

#### C.1.5 车队级 Topic（中心服务器通信）

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | QoS 策略 |
|------------|----------|--------|--------|----------|
| `/fleet/agv_states` | `agv_msgs/FleetState` | fleet_state_manager | monitor_aggregator, traffic_manager | TransientLocal + Reliable |
| `/fleet/traffic_zones` | `agv_msgs/TrafficZoneArray` | traffic_manager | local_planner (each AGV) | SystemDefault |
| `/fleet/global_map` | `nav_msgs/OccupancyGrid` | map_service | global_planner, localization | TransientLocal + Reliable |
| `/fleet/task_updates` | `agv_msgs/TaskStatusUpdate` | task_dispatcher | monitor_aggregator | SystemDefault |
| `/fleet/monitor/metrics` | `agv_msgs/SystemMetrics` | monitor_aggregator | (可视化前端 via WebSocket) | SystemDefault |

### C.2 ROS2 Service 接口定义

| Service 名称 | 服务类型 | 服务端 | 客户端 | 描述 |
|-------------|----------|--------|--------|------|
| `/fleet/dispatch_task` | `agv_msgs/DispatchTask` | task_dispatcher | api_gateway | 外部系统下发新任务 |
| `/fleet/cancel_task` | `agv_msgs/CancelTask` | task_dispatcher | api_gateway | 取消指定任务 |
| `/fleet/query_task` | `agv_msgs/QueryTask` | task_dispatcher | api_gateway | 查询任务状态 |
| `/fleet/query_agv` | `agv_msgs/QueryAGV` | fleet_state_manager | api_gateway | 查询指定 AGV 状态 |
| `/fleet/query_fleet` | `agv_msgs/QueryFleet` | fleet_state_manager | api_gateway | 查询全车队状态 |
| `/fleet/plan_path` | `agv_msgs/PlanPath` | global_planner | task_dispatcher | 请求全局路径规划 |
| `/fleet/get_map` | `agv_msgs/GetMap` | map_service | global_planner, api_gateway | 获取全局地图数据 |
| `/fleet/update_map` | `agv_msgs/UpdateMap` | map_service | api_gateway | 更新地图（编辑后） |
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

### C.3 ROS2 Action 接口定义

| Action 名称 | 动作类型 | 服务端 | 客户端 | 描述 |
|-------------|----------|--------|--------|------|
| `/fleet/execute_task` | `agv_msgs/ExecuteTask` | task_dispatcher | api_gateway | 外部系统下发异步任务（含跟踪反馈） |
| `/agv_{id}/navigate` | `agv_msgs/Navigate` | vehicle_fsm | task_dispatcher | 导航到目标点（含进度反馈） |
| `/agv_{id}/charge` | `agv_msgs/Charge` | vehicle_fsm | task_dispatcher | 执行充电任务 |
| `/agv_{id}/dock` | `agv_msgs/Dock` | vehicle_fsm | task_dispatcher | 执行停靠任务 |
| `/agv_{id}/patrol` | `agv_msgs/Patrol` | vehicle_fsm | task_dispatcher | 执行巡检任务 |

> **设计理由**：Action 适用于耗时操作（导航、充电、停靠），客户端可获取进度反馈（feedback）和最终结果（result），支持中途取消。

### C.4 自定义消息类型总览（agv_msgs 包）

| 消息名称 | 定义字段 | 用途 |
|----------|----------|------|
| `VehicleState` | `string agv_id`, `uint8 state`(IDLE/NAVIGATING/CHARGING/ESTOP/FAILED), `Pose pose`, `float32 battery`, `float32 speed`, `string current_task_id`, `builtin_interfaces/Time timestamp` | AGV 状态上报 |
| `FleetState` | `VehicleState[] vehicles`, `builtin_interfaces/Time timestamp` | 全车队状态聚合 |
| `EmergencyStop` | `uint8 source`(LASER/COMM/LOCALIZATION/SPEED/BATTERY/MANUAL), `string reason`, `builtin_interfaces/Time timestamp` | 急停指令 |
| `SafetyStatus` | `bool estop_active`, `uint8[] active_sources`, `float32 min_obstacle_distance`, `float32 current_speed`, `float32 speed_limit` | 安全状态 |
| `BumperEvent` | `bool pressed`, `builtin_interfaces/Time timestamp` | 虚拟 Bumper 事件 |
| `TrafficZone` | `string zone_id`, `uint8 state`(FREE/RESERVED/OCCUPIED), `string holder_agv_id`, `Polygon region` | 交通区域状态 |
| `TrafficZoneArray` | `TrafficZone[] zones` | 批量交通区域 |
| `TaskStatusUpdate` | `string task_id`, `uint8 status`, `string assigned_agv_id`, `float32 progress` | 任务状态更新 |
| `SystemMetrics` | `float32 task_completion_rate`, `float32 avg_wait_time`, `uint32 collision_count`, `uint32 active_agvs`, `float32 avg_scheduler_load` | 系统运行指标 |

**Service 类型定义**：

| Service 名称 | Request 字段 | Response 字段 |
|-------------|-------------|---------------|
| `DispatchTask` | `TaskSpec task` | `bool success`, `string task_id`, `string message` |
| `CancelTask` | `string task_id` | `bool success`, `string message` |
| `QueryTask` | `string task_id` | `TaskStatus status` |
| `QueryAGV` | `string agv_id` | `VehicleState state` |
| `QueryFleet` | `--` | `FleetState fleet_state` |
| `PlanPath` | `PoseStamped start`, `PoseStamped goal`, `string map_frame` | `bool success`, `Path path` |
| `GetMap` | `string map_name` | `OccupancyGrid map`, `MapMetadata metadata` |
| `UpdateMap` | `OccupancyGrid map` | `bool success` |
| `ReserveZone` | `string zone_id`, `string agv_id`, `duration estimated_occupancy` | `bool granted`, `string message` |
| `ReleaseZone` | `string zone_id`, `string agv_id` | `bool success` |
| `DetectDeadlock` | `--` | `bool has_deadlock`, `string[] involved_agvs` |
| `ResolveDeadlock` | `string[] agv_ids` | `bool success`, `ResolvedAction[] actions` |
| `ManualEstop` | `string agv_id` | `bool success` |
| `ClearEstop` | `string agv_id` | `bool success` |

**Action 类型定义**：

| Action 名称 | Goal 字段 | Feedback 字段 | Result 字段 |
|-------------|----------|--------------|-------------|
| `ExecuteTask` | `TaskSpec task` | `float32 progress`, `string status_detail` | `bool success`, `string task_id`, `string error_msg` |
| `Navigate` | `PoseStamped target_pose`, `float32 speed_override` | `float32 distance_remaining`, `float32 eta`, `Pose current_pose` | `bool reached`, `string message` |
| `Charge` | `string station_id` | `float32 battery_before`, `float32 battery_after` | `bool success`, `float32 final_battery` |
| `Dock` | `string dock_point_id` | `float32 distance_to_dock` | `bool success` |
| `Patrol` | `PoseStamped[] waypoints`, `uint32 loops` | `uint32 current_waypoint`, `uint32 loops_completed` | `bool completed` |

### C.5 REST API 端点设计

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
| GET | `/api/v1/map/zones` | 获取区域划分 | -- | `{"zones":[...]}` |
| PUT | `/api/v1/config/scheduler` | 更新调度策略 | `{"strategy":"shortest_path"|"least_load"}` | `{"success":true}` |
| PUT | `/api/v1/config/safety` | 更新安全参数 | `{"safety_distance":0.5,"speed_limits":{...}}` | `{"success":true}` |
| GET | `/api/v1/metrics` | 系统运行指标 | -- | `{"task_completion_rate":0.95,...}` |
| GET | `/api/v1/alerts` | 告警历史 | `?since=2026-07-01T00:00:00Z` | `{"alerts":[...]}` |
| WS | `/ws/v1/events` | WebSocket 实时推送 | -- | 实时推送状态/告警/指标事件 |

---

## D. 数据流设计

### D.1 任务下发流程（从 API 到 AGV 执行）

```
外部系统 / 前端
     │
     │ POST /api/v1/tasks
     ▼
┌──────────────────┐
│  API Gateway     │  ← 认证、限流、请求校验
│  (FastAPI)       │
└────────┬─────────┘
         │ call /fleet/dispatch_task (Service)
         ▼
┌──────────────────┐
│  TaskDispatcher  │  ← 任务优先级排队、调度策略选择
│  (中心服务器)     │
└────────┬─────────┘
         │
         ├── 1. call /fleet/plan_path (Service) → GlobalPlanner
         │      │
         │      ├── 2. call /fleet/get_map (Service) → MapService
         │      └── 3. 返回全局路径
         │
         ├── 4. call /fleet/query_fleet (Service) → FleetStateManager
         │      获取各 AGV 负载、位置、电量
         │
         ├── 5. 调度决策：选择最优 AGV
         │     （最短路径优先 / 最少负载优先）
         │
         ├── 6. send_goal → /agv_{id}/navigate (Action)
         │     │
         │     ▼
         │  ┌──────────────────┐
         │  │  VehicleFSM      │  ← 状态: IDLE → NAVIGATING
         │  │  (车载端)         │
         │  └────────┬─────────┘
         │           │
         │           ├── 7. 接收 global_path (Topic)
         │           ├── 8. LocalPlanner 生成局部轨迹
         │           ├── 9. MotionController 执行 cmd_vel
         │           └── 10. 定期反馈 Action feedback
         │
         └── 11. Action result → 任务状态更新
                   (已完成 / 已失败 / 已取消)
```

**时序关键点**：
- 步骤 1~5：≤ 50ms（含路径规划）
- 步骤 6~9：≤ 10ms（控制周期）
- 步骤 10：≥ 50Hz（反馈更新）

### D.2 实时控制数据流（传感器 → 定位 → 规划 → 控制）

```
控制周期：50Hz (20ms)，要求端到端延迟 ≤ 20ms

Gazebo 仿真世界
     │
     ├── /agv_{id}/scan (LiDAR, 20Hz) ──────────────────┐
     ├── /agv_{id}/imu (IMU, 100Hz) ─────┐              │
     ├── /agv_{id}/odom (Odometry, 50Hz) ─┤              │
     │                                     ▼              ▼
     │                              ┌────────────┐  ┌──────────────┐
     │                              │Localization│  │ObstacleAvoid │
     │                              │(EKF/AMCL)  │  │(Costmap/Cost│
     │                              │ 50Hz       │  │ 50Hz        │
     │                              └─────┬──────┘  └──────┬───────┘
     │                                    │                │
     │         ┌──────────────────────────┘                │
     │         │  /agv_{id}/localization/pose              │
     │         │  /agv_{id}/odom_filtered                  │
     │         ▼                                           ▼
     │  ┌────────────────┐                     ┌────────────────┐
     │  │  LocalPlanner  │◄────────────────────│ obstacle_map   │
     │  │  (TEB/DWA)     │                     │                │
     │  │  50Hz          │                     └────────────────┘
     │  └───────┬────────┘
     │          │  /agv_{id}/local_plan
     │          ▼
     │  ┌────────────────┐
     │  │MotionController│  ← 双层速度限幅（内部 + SafetyWatchdog）
     │  │(PID/MPC)       │
     │  │  50Hz          │
     │  └───────┬────────┘
     │          │  /agv_{id}/cmd_vel
     ▼          ▼
  Gazebo 车轮控制插件（仿真执行）
```

### D.3 安全数据流（安全传感器 → 安全逻辑 → 急停执行）

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
║  │                                         │             ║
║  │  2. 通信超时检测                         │             ║
║  │     阈值: 100ms (无 odom/pose 更新)      │             ║
║  │                                         │             ║
║  │  3. 速度越限检测                         │             ║
║  │     阈值: 最大线速度120% = 2.4 m/s       │             ║
║  │                                         │             ║
║  │  4. 定位跳变检测                         │             ║
║  │     阈值: 相邻帧跳变 > 0.5m              │             ║
║  │                                         │             ║
║  │  5. 低电量检测                           │             ║
║  │     阈值: 电池 < 5%                      │             ║
║  │                                         │             ║
║  │  6. 人工急停监听 (Service)               │             ║
║  └──────────────────┬──────────────────────┘             ║
║                     │                                    ║
║          触发条件任一满足                                 ║
║                     ▼                                    ║
║  ┌─────────────────────────────────────────┐             ║
║  │          急停执行逻辑                     │             ║
║  │                                         │             ║
║  │  publish /agv_{id}/safety/estop         │             ║
║  │     → vehicle_fsm: 状态切换到 ESTOP      │             ║
║  │     → motion_controller: 强制停止输出    │             ║
║  │     → 覆盖 cmd_vel 为 0                 │             ║
║  │                                         │             ║
║  │  同时发布 /agv_{id}/safety/status       │             ║
║  └─────────────────────────────────────────┘             ║
║                                                          ║
║  约束：SafetyWatchdog 进程内                              ║
║    · 禁止动态内存分配                                      ║
║    · 禁止阻塞调用（sleep, mutex lock）                     ║
║    · 禁止文件 IO                                           ║
║    · 控制循环周期 ≤ 10ms                                   ║
╚══════════════════════════════════════════════════════════╝
```

### D.4 监控数据流（AGV 状态 → 可视化）

```
AGV 1 (车载端)                    AGV 2 (车载端)               ... AGV N
     │                                │
     │ /agv_1/vehicle_state           │ /agv_2/vehicle_state
     │ /agv_1/safety/status           │ /agv_2/safety/status
     │ /agv_1/localization/pose       │ /agv_2/localization/pose
     │ /agv_1/battery                 │ /agv_2/battery
     │                                │
     ▼                                ▼
┌──────────────────────────────────────────────────────────┐
│                 FleetStateManager                         │
│  (中心服务器)                                              │
│                                                          │
│  聚合所有 AGV 状态 → 以 20Hz 发布 /fleet/agv_states       │
│  同时提供 /fleet/query_fleet Service 供按需查询             │
└──────────────────────┬───────────────────────────────────┘
                       │ /fleet/agv_states (Topic)
                       ▼
┌──────────────────────────────────────────────────────────┐
│                 MonitorAggregator                         │
│  (中心服务器)                                              │
│                                                          │
│  接收:                                                     │
│    · /fleet/agv_states                                   │
│    · /fleet/task_updates (来自 TaskDispatcher)            │
│    · /agv_{id}/safety/status (直接订阅)                   │
│                                                          │
│  计算系统指标:                                              │
│    · 任务完成率                                           │
│    · 平均等待时间                                         │
│    · 碰撞计数                                             │
│    · 调度负载均衡度                                       │
│                                                          │
│  输出:                                                     │
│    · /fleet/monitor/metrics (Topic, 5Hz)                  │
│    · WebSocket 推送 (JSON, 实时)                           │
└──────────────────────┬───────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
     ┌────────┐  ┌──────────┐  ┌────────┐
     │前端仪表盘│  │告警管理面板│  │地图可视化│
     │(React) │  │(React)   │  │(RViz/Web)│
     └────────┘  └──────────┘  └────────┘
```

---

## E. 关键设计决策

### E.1 模块划分依据

**决策：将系统划分为 7 大模块，中心服务器部署 5 个核心节点，每台 AGV 部署 6 个节点。**

**理由**：

1. **职责分离与关注点隔离**：每个模块只负责一个明确的职责领域。例如，全局路径规划（GlobalPlanner）关注静态地图上的最优路径搜索，而局部路径规划（LocalPlanner）关注动态环境中的轨迹跟踪与调整。二者分离使得全局规划可以 50ms 响应（非实时约束），局部规划保持 50Hz 硬实时。

2. **安全关键路径的进程级隔离**：SafetyWatchdog 作为独立进程运行，与主控制循环进程分离。即使主进程崩溃（内存泄漏、死锁等），安全看门狗仍然能独立检测危险条件并触发急停。这是满足 SIL2 安全等级的关键设计。

3. **中心 vs. 车载的部署边界**：
   - **中心服务器**：处理全局最优决策（任务分配、全局路径、交通管制），这些决策需要全局信息但不要求硬实时。
   - **车载端**：处理实时控制（局部规划、避障、控制执行、安全检测），这些模块要求 10~20ms 的确定性响应，不适合依赖网络通信。

4. **可扩展性**：车队规模从 10 台扩展到 20 台时，车载端节点数线性增长（每台新增 6 个节点），中心服务器节点数保持不变。瓶颈只可能出现在 FleetStateManager（状态聚合）和 TrafficManager（交通管制），这两个模块设计了增量更新机制来支撑扩展。

### E.2 接口类型选择策略

**决策原则**：

| 接口类型 | 适用场景 | 在本系统中的典型使用 |
|----------|----------|---------------------|
| **Topic** | 周期性数据发布，一对多通信 | 传感器数据、AGV 状态、控制指令 |
| **Service** | 同步请求-响应，一次性查询/操作 | 路径规划请求、状态查询、参数设置 |
| **Action** | 异步耗时操作，需进度反馈 | 导航任务、充电任务、巡检任务 |

**详细理由**：

1. **Topic 选择理由**：
   - 传感器数据（scan, imu, odom）是周期性数据流，适合发布-订阅模式。
   - AGV 状态（vehicle_state）使用 TransientLocal QoS，确保新订阅者（如监控端迟连）能收到最新状态。
   - 安全急停（estop）使用 Reliable + Volatile 高优先级，确保最差网络条件下仍能送达，且不保留历史（避免误用过期急停信号）。

2. **Service 选择理由**：
   - 任务下发（dispatch_task）是同步请求-响应模式，客户端需要立即知道任务是否接受（配额、参数校验等）。
   - 路径规划（plan_path）是计算密集型操作，客户端需要等待计算结果。
   - 状态查询（query_agv, query_fleet）是按需查询，不需要持续订阅。
   - 区域预留（reserve_zone, release_zone）需要原子性操作和即时结果反馈。

3. **Action 选择理由**：
   - 导航（navigate）是耗时操作（几秒到几分钟），Action 允许中心服务器随时获取进度反馈（距离剩余、ETA）并在中途取消。
   - 充电（charge）和巡检（patrol）同样需要异步执行和进度反馈。
   - 外部系统的任务下发（execute_task）包装为 Action，使外部系统能跟踪任务全生命周期。

### E.3 安全关键路径的隔离策略

**策略：四层安全防御 + 进程级隔离 + 独立冗余校验**

```
Layer 1: 软件限幅（MotionController 内部）
  - 最大线速度 ≤ 2.0 m/s 硬编码限幅
  - 靠近障碍物自动减速（< 2m 时 ≤ 0.5 m/s）
  - 充电区 ≤ 0.3 m/s

Layer 2: 安全看门狗（SafetyWatchdog 独立进程）
  - 独立于主控制循环
  - 监听原始传感器数据（独立于 local_planner 的感知路径）
  - 6 种急停条件独立检测
  - 输出 /safety/estop 覆盖 cmd_vel

Layer 3: 通信超时降级（车载端内部）
  - SafetyWatchdog 监测 /agv_{id}/odom 和 /agv_{id}/localization/pose 的到达间隔
  - 100ms 无更新 → 自动急停
  - 与中心服务器的通信中断不直接影响车载安全（车载安全逻辑完全本地化）

Layer 4: 中心级监控（MonitorAggregator）
  - 监测所有 AGV 的 safety/status
  - 发现异常通过 /manual_estop Service 下发远程急停
```

**安全代码约束落地措施**：
- SafetyWatchdog 节点编译时启用 `-Werror -Wall -Wextra` 全警告
- CI 流水线中配置 Cppcheck + Clang-Tidy 静态分析
- 实时循环内通过 `new` 检测（`-Wno-unsafe-buffer-usage` 禁用 + 代码审查）
- 预分配所有内存（环形缓冲区、固定大小队列）

### E.4 混合部署架构中通信故障的降级策略

**通信故障分类与应对**：

| 故障类型 | 检测方式 | 降级动作 | 恢复方式 |
|----------|----------|----------|----------|
| 中心 → 车载 Topic 中断 | SafetyWatchdog 100ms 超时 | 车载本地急停（保持位置） | 通信恢复后自动清除急停（前提：无其他急停条件） |
| 车载 → 中心 Topic 中断 | FleetStateManager 500ms 超时 | 标记该 AGV 为 LOST，停止分配新任务 | 状态恢复后自动重新注册 |
| 中心服务器宕机 | 车载端检测 /fleet 命名空间 Topic 消失 | 各 AGV 完成当前任务后进入 IDLE | 中心恢复后重新同步状态 |
| 网络分区（部分 AGV 断连） | 同上 | 断连 AGV 本地继续执行 + 完成后 IDLE | 网络恢复后状态合并 |
| DDS 发现服务中断 | DDS 内建机制（参与列表变化） | 不影响已有连接，新 AGV 无法注册 | 发现服务恢复后自动重连 |

**核心设计原则**：**车载端在通信中断时具备独立生存能力**。
- 全局路径在任务下达时已传输到车载端（TransientLocal QoS），通信中断后车载端仍能执行剩余路径。
- 局部规划、避障、安全检测完全在车载端本地完成，不依赖中心服务器。
- 通信中断时 AGV 不会失控，而是在完成当前导航段后安全停止。

**关键 QoS 配置策略**：

```
/safety/estop:
  Reliability: RELIABLE      # 保证送达
  Durability: VOLATILE       # 不保留历史，避免使用过期信号
  Deadline: 100ms            # DDS 层超时检测
  Priority: HIGH             # 网络层优先级标记

/agv_{id}/vehicle_state:
  Reliability: RELIABLE
  Durability: TRANSIENT_LOCAL  # 保留最新状态供迟连订阅者

/agv_{id}/scan:
  Reliability: BEST_EFFORT   # 传感器数据允许丢帧
  Durability: VOLATILE
  Depth: 10                  # 队列深度限制
```

---

## 附录 A：验收标准覆盖矩阵

| 验收项 | 涉及模块 | 关键接口 | 架构保障措施 |
|--------|----------|----------|-------------|
| AC-1 无碰撞运行 | 全部 | `/agv_{id}/safety/estop`, `/fleet/traffic_zones` | 双重避障（避障模块 + 安全看门狗）+ 交通管制 |
| AC-2 急停响应 ≤ 10ms | SafetyWatchdog, MotionController | `/agv_{id}/safety/estop` | SafetyWatchdog 独立进程 + 禁止动态内存分配 |
| AC-3 定位精度 ≤ 5cm | Localization | `/agv_{id}/localization/pose` | 多传感器 EKF 融合 + 定位丢失降级策略 |
| AC-4 任务完成率 ≥ 95% | TaskDispatcher, VehicleFSM | `/fleet/dispatch_task`, `/agv_{id}/navigate` | 优先级调度 + 抢占式调度 + 充电自动管理 |
| AC-5 避障成功率 ≥ 99% | ObstacleAvoidance, SafetyWatchdog | `/agv_{id}/obstacle_map` | 动态障碍物区分 + 安全距离缓冲 |
| AC-6 通信中断恢复 | SafetyWatchdog, FleetStateManager | Deadline QoS, `/fleet/agv_states` | 100ms 超时检测 + 本地自主 + 自动恢复 |
| AC-7 调度公平性 ≤ 20% | TaskDispatcher | `/fleet/query_fleet` | 最少负载优先策略 + 负载统计反馈 |
| AC-8 仿真实时性 ≥ 0.95 | Gazebo, 全部节点 | 全部 | 控制循环周期保障 + 非阻塞设计 |

## 附录 B：ROS2 包结构建议

```
src/
├── agv_msgs/                      # 自定义消息包
│   ├── msg/                       # 消息定义
│   │   ├── VehicleState.msg
│   │   ├── FleetState.msg
│   │   ├── EmergencyStop.msg
│   │   ├── SafetyStatus.msg
│   │   ├── BumperEvent.msg
│   │   ├── TrafficZone.msg
│   │   ├── TrafficZoneArray.msg
│   │   ├── TaskStatusUpdate.msg
│   │   └── SystemMetrics.msg
│   ├── srv/                       # 服务定义
│   │   ├── DispatchTask.srv
│   │   ├── CancelTask.srv
│   │   ├── QueryTask.srv
│   │   ├── QueryAGV.srv
│   │   ├── QueryFleet.srv
│   │   ├── PlanPath.srv
│   │   ├── GetMap.srv
│   │   ├── UpdateMap.srv
│   │   ├── ReserveZone.srv
│   │   ├── ReleaseZone.srv
│   │   ├── DetectDeadlock.srv
│   │   ├── ResolveDeadlock.srv
│   │   ├── SetGoal.srv
│   │   ├── PauseResume.srv
│   │   ├── ManualEstop.srv
│   │   ├── ClearEstop.srv
│   │   └── RecoverLocalization.srv
│   └── action/                    # 动作定义
│       ├── ExecuteTask.action
│       ├── Navigate.action
│       ├── Charge.action
│       ├── Dock.action
│       └── Patrol.action
│
├── agv_fleet_center/              # 中心服务器包
│   ├── src/
│   │   ├── task_dispatcher_node.cpp
│   │   ├── global_planner_node.cpp
│   │   ├── fleet_state_manager_node.cpp
│   │   ├── map_service_node.cpp
│   │   ├── traffic_manager_node.cpp
│   │   ├── api_gateway_node.cpp
│   │   └── monitor_aggregator_node.cpp
│   ├── launch/
│   │   └── fleet_center.launch.py
│   └── config/
│       └── fleet_params.yaml
│
├── agv_vehicle/                   # 车载端包
│   ├── src/
│   │   ├── vehicle_fsm_node.cpp
│   │   ├── local_planner_node.cpp
│   │   ├── obstacle_avoidance_node.cpp
│   │   ├── localization_node.cpp
│   │   ├── motion_controller_node.cpp
│   │   └── safety_watchdog_node.cpp    # 独立可执行文件
│   ├── launch/
│   │   └── vehicle.launch.py
│   └── config/
│       └── vehicle_params.yaml
│
├── agv_simulation/                # 仿真包
│   ├── src/
│   │   └── spawn_agv_node.cpp
│   ├── urdf/
│   │   └── agv.urdf.xacro
│   ├── worlds/
│   │   └── warehouse.world
│   ├── launch/
│   │   ├── simulation.launch.py
│   │   └── spawn_fleet.launch.py
│   └── config/
│       └── simulation_params.yaml
│
├── agv_visualization/             # 可视化包
│   ├── src/
│   │   └── (Rviz2 配置 + Web 前端代码)
│   ├── rviz/
│   │   └── agv_monitor.rviz
│   └── web/
│       └── (React 前端源码)
│
└── agv_bringup/                   # 系统启动包
    ├── launch/
    │   ├── system.launch.py       # 一键启动所有组件
    │   └── system_no_sim.launch.py # 仅启动中心+车载（无仿真）
    └── config/
        └── system_params.yaml
```
