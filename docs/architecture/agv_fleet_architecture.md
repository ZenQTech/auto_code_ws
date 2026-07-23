# 多 AGV 智能调度平台 - 系统顶层架构设计

> **文档状态**：正式版  
> **基于需求文档**：docs/requirements/agv_fleet_requirements.md  
> **ROS2 发行版**：Humble Hawksbill  
> **仿真平台**：Gazebo Ignition Fortress  
> **设计日期**：2026-07-01  

---

## 目录

1. [顶层架构设计](#1-顶层架构设计)
2. [模块划分与接口定义](#2-模块划分与接口定义)
3. [通信架构设计](#3-通信架构设计)
4. [数据流设计](#4-数据流设计)
5. [安全架构设计](#5-安全架构设计)
6. [项目目录结构](#6-项目目录结构)

---

## 1. 顶层架构设计

### 1.1 系统分层架构

系统采用**五层分层架构**，自底向上分为：感知层、规划层、控制层、调度层、通信层。每层具有明确的职责边界和标准化接口，层间通过 ROS2 话题/服务/动作解耦。

```
+------------------------------------------------------------------+
|                         WMS (外部系统)                              |
+------------------------------------------------------------------+
        |  HTTPS REST API (任务下发 / 状态上报 / 告警推送)
+------------------------------------------------------------------+
|  5. 通信层 (Communication Layer)                                   |
|  +---------------------------+  +------------------------------+  |
|  |  agv_api_gateway          |  |  agv_fleet_manager           |  |
|  |  - REST API 服务器         |  |  - 集中调度引擎              |  |
|  |  - API Key 认证            |  |  - 死锁检测与化解           |  |
|  |  - 请求路由与限流          |  |  - 交通管制与路径协商       |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  调度指令 (ROS2 Action/Service)
+------------------------------------------------------------------+
|  4. 调度层 (Task Scheduling Layer) [每台 AGV]                      |
|  +-------------------------------------------------------------+ |
|  |  agv_scheduler                                               | |
|  |  - 任务队列管理（优先级队列）                                  | |
|  |  - 任务拆解为动作序列                                          | |
|  |  - 任务状态机管理                                              | |
|  +-------------------------------------------------------------+ |
+------------------------------------------------------------------+
        |  导航目标 (ROS2 Action)
+------------------------------------------------------------------+
|  3. 规划层 (Planning Layer) [每台 AGV]                             |
|  +---------------------------+  +------------------------------+  |
|  |  agv_navigation           |  |  agv_localization            |  |
|  |  - 全局路径规划 (A*)      |  |  - AMCL / SLAM              |  |
|  |  - 局部规划 (DWA/TEB)     |  |  - 传感器融合 (EKF)         |  |
|  |  - 动态避障               |  |  - 重定位                   |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  cmd_vel (Twist) / 里程计 (Odometry)
+------------------------------------------------------------------+
|  2. 控制层 (Control Layer) [每台 AGV]                              |
|  +---------------------------+  +------------------------------+  |
|  |  agv_control              |  |  ros2_control               |  |
|  |  - PID/MPC 控制器         |  |  - 电机驱动器接口           |  |
|  |  - 速度斜坡与限幅          |  |  - 编码器/IMU 数据采集     |  |
|  |  - 手动控制手柄映射        |  |  - CAN/EtherCAT 通信       |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  传感器数据
+------------------------------------------------------------------+
|  1. 感知层 (Perception Layer) [每台 AGV]                          |
|  +---------------------------+  +------------------------------+  |
|  |  感知与避障 (agv_perception)|  |  传感器驱动 (agv_sensors)  |  |
|  |  - LiDAR + 深度相机融合    |  |  - LiDAR 驱动 (UDP)        |  |
|  |  - 多层级安全区域检测       |  |  - RealSense D435 驱动     |  |
|  |  - 障碍物检测与跟踪        |  |  - IMU / 编码器驱动        |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  硬件接口
+------------------------------------------------------------------+
|                    AGV 硬件层 (物理 / 仿真)                        |
|  +---------------------------+  +------------------------------+  |
|  |  Gazebo Ignition Fortress |  |  实体 AGV 硬件              |  |
|  |  - 仓库仿真世界            |  |  - 差分驱动底盘             |  |
|  |  - 多 AGV 模型            |  |  - SICK TiM561 LiDAR        |  |
|  |  - 传感器仿真插件          |  |  - RealSense D435           |  |
|  |  - 物理引擎 (ODE)         |  |  - CAN/EtherCAT 总线        |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
```

### 1.2 单 AGV 架构 vs 中央调度架构的关系与边界

**单 AGV 架构** 是每台 AGV 上独立运行的节点集合，负责从感知到控制的完整闭环：

```
单 AGV 边界 (命名空间 /agv_<id>/)
+-------------------------------------------------------------------+
|  感知层    →   定位层    →   规划层    →   控制层    →   执行器    |
| (agv_<id>)   (agv_<id>)   (agv_<id>)   (agv_<id>)                |
+-------------------------------------------------------------------+
                ↑                        ↑
                | 调度指令 (从中央调度)    | 状态上报 (到中央调度)
                ↓                        ↓
+-------------------------------------------------------------------+
|  中央调度服务 (全局命名空间 /fleet/)                                |
|  - agv_fleet_manager: 死锁检测、交通管制、任务分配                   |
|  - agv_api_gateway: WMS 对接、REST API                              |
+-------------------------------------------------------------------+
```

**职责边界**：

| 层面 | 单 AGV 职责 | 中央调度职责 |
|------|------------|-------------|
| 感知 | 采集传感器数据、安全区域检测 | 不参与 |
| 定位 | SLAM建图、实时定位、EKF融合 | 全局地图维护、多车地图合并 |
| 规划 | 全局路径规划、局部避障 | 交通管制、路径协商、死锁检测 |
| 控制 | PID/MPC闭环控制、电机驱动 | 不参与 |
| 调度 | 任务队列管理、动作序列执行 | 任务分配、优先级管理、负载均衡 |
| 通信 | 单 AGV 内部节点通信 | WMS 对接、多 AGV 协调 |
| 安全 | 急停执行、安全区域响应、心跳上报 | 全车队心跳监控、全局告警 |

**关键原则**：每台 AGV 独立运行完整的感知-定位-规划-控制闭环，不依赖中央调度完成基础移动功能。中央调度仅负责任务分配与多车协调，单 AGV 在失去与中央调度的通信时仍能安全停车。

### 1.3 多 AGV 协同调度架构模式

**推荐方案：混合式架构（Hybrid Architecture）**

#### 架构描述

采用 **集中式调度决策 + 分布式执行与检测** 的混合模式：

```
+---------------------------+
|  中央调度 (agv_fleet_manager)  |
|  - 全局任务分配            |
|  - 死锁检测与化解          |
|  - 交通管制决策            |
|  - 资源占用仲裁            |
+---------------------------+
         |  ↑
   调度指令  | 状态上报
         ↓  |
+---------------------------+      +---------------------------+
|  AGV 1 (分布式执行)        |  ...  |  AGV N (分布式执行)       |
|  - 自身路径规划            |      |  - 自身路径规划           |
|  - 本地死锁预检测          |      |  - 本地死锁预检测         |
|  - 本地紧急避障            |      |  - 本地紧急避障           |
+---------------------------+      +---------------------------+
```

#### 推荐理由

| 维度 | 纯集中式 | 纯分布式 | 混合式（推荐） |
|------|---------|---------|--------------|
| 死锁检测 | 全局视角，检测准确 | 局部视角，协商慢 | 中央全局检测 + 本地预检测 |
| 实时性 | 依赖通信，延迟高 | 本地决策，实时性好 | 关键决策本地化，保证实时性 |
| 可扩展性 | 中央节点瓶颈 | 高，无单点瓶颈 | 中央只做协调，扩展性好 |
| 单点故障 | 中央故障整个系统瘫痪 | 无单点故障 | 中央故障后各车独立安全停车 |
| 实现复杂度 | 简单 | 复杂（共识算法） | 适中 |
| 通信开销 | 全部数据上报，开销大 | 少量协商消息 | 仅上报关键状态（位置/任务） |

**混合式架构的核心设计点**：

1. **中央调度职责**：全局任务分配、全局死锁检测与化解、交叉路口交通管制、资源（充电站/工位）占用仲裁
2. **分布式执行职责**：每台 AGV 自行完成路径规划、局部避障、本地安全检测
3. **本地预检测**：每台 AGV 在规划路径时预检查与其他 AGV 的潜在冲突，提前向中央调度申请通行权
4. **降级模式**：中央调度断联时，每台 AGV 执行"缓行-停车-等待"策略，使用本地缓存的任务继续执行到安全位置后停车

---

## 2. 模块划分与接口定义

### 2.1 包划分概览

根据现有项目结构 `agv_fleet_ws/src/`，系统划分为以下 ROS2 包：

| 包名 | 语言 | 类型 | 说明 |
|------|------|------|------|
| `agv_msgs` | 消息定义 | 接口包 | 所有自定义消息/服务/动作定义 |
| `agv_core` | C++ | 核心包 | 安全守护节点、模式管理、心跳监控 |
| `agv_perception` | C++ | 感知包 | LiDAR + 深度相机融合、安全区域检测 |
| `agv_localization` | C++ | 定位包 | EKF 融合、AMCL、重定位 |
| `agv_navigation` | C++ | 导航包 | 全局/局部路径规划、避障 |
| `agv_control` | C++ | 控制包 | PID/MPC 控制器、速度限幅、手动模式 |
| `agv_scheduler` | Python | 调度包 | 任务队列管理、动作序列执行 |
| `agv_safety` | C++ | 安全包 | 三级安全区域逻辑、心跳生成 |
| `agv_fleet_manager` | Python | 车队管理包 | 集中调度、死锁检测、交通管制 |
| `agv_api_gateway` | Python | API 网关包 | REST API 服务器、WMS 对接 |
| `agv_traffic_control` | Python | 交通控制包 | 路口管理、通行权仲裁 |
| `agv_simulation` | Python | 仿真包 | Gazebo 模型、世界文件 |
| `agv_tools` | Python | 工具包 | 命令行工具、诊断脚本 |
| `agv_visualization` | Python | 可视化包 | RViz 配置、Web 仪表盘对接 |

### 2.2 节点定义与接口

#### 2.2.1 agv_msgs — 消息/服务/动作定义包

> **包类型**：`ament_cmake`（纯接口包，无编译节点）

**自定义消息 (Message)**：

| 消息名 | 字段 | 说明 |
|--------|------|------|
| `SafetyZone.msg` | `uint8 WARNING=1` `uint8 DECELERATION=2` `uint8 EMERGENCY=3` `uint8 zone_level` `float32 distance` `string agv_id` | 安全区域状态 |
| `AGVStatus.msg` | `string agv_id` `geometry_msgs/Pose pose` `float32 linear_velocity` `float32 battery_level` `uint8 task_status` `uint8 fault_code` `builtin_interfaces/Duration uptime` | AGV 综合状态 |
| `Task.msg` | `string task_id` `string task_type` `geometry_msgs/PoseStamped pickup_location` `geometry_msgs/PoseStamped dropoff_location` `uint8 priority` `builtin_interfaces/Time created_at` | 任务描述 |
| `TrafficReservation.msg` | `string reservation_id` `string agv_id` `string zone_id` `builtin_interfaces/Time start_time` `builtin_interfaces/Duration duration` `uint8 PRIORITY_LOW=0` `uint8 PRIORITY_HIGH=1` `uint8 priority` | 交通资源预留 |
| `DeadlockInfo.msg` | `string[] involved_agvs` `string description` `uint8 DETECTED=0` `uint8 RESOLVING=1` `uint8 RESOLVED=2` `uint8 status` | 死锁信息 |
| `Heartbeat.msg` | `string agv_id` `builtin_interfaces/Time timestamp` `uint8 sequence` `float32 cpu_load` `float32 memory_usage` | 心跳报文 |

**自定义服务 (Service)**：

| 服务名 | 请求 | 响应 | 说明 |
|--------|------|------|------|
| `SetMode.srv` | `uint8 AUTO=0` `uint8 MANUAL=1` `uint8 mode` | `bool success` `string message` | 模式切换 |
| `EmergencyStop.srv` | `string reason` | `bool success` `builtin_interfaces/Time timestamp` | 软件急停 |
| `ClearEmergency.srv` | `string agv_id` | `bool success` `string message` | 急停恢复 |
| `QueryStatus.srv` | `string agv_id` | `AGVStatus status` | 状态查询 |
| `ReserveZone.srv` | `string agv_id` `string zone_id` `builtin_interfaces/Duration duration` | `bool granted` `string reservation_id` `string reason` | 区域预留请求 |
| `ReleaseZone.srv` | `string reservation_id` | `bool success` | 释放区域预留 |
| `RegisterAGV.srv` | `string agv_id` `string ip_address` `float32 max_linear_velocity` `float32 max_angular_velocity` | `bool success` `string fleet_id` | AGV 注册到车队 |

**自定义动作 (Action)**：

| 动作名 | 目标 | 结果 | 反馈 | 说明 |
|--------|------|------|------|------|
| `NavigateToPose.action` | `geometry_msgs/PoseStamped target_pose` | `bool success` `float32 total_distance` `builtin_interfaces/Duration duration` | `float32 progress` `float32 remaining_distance` `float32 current_speed` | 导航到目标点 |
| `ExecuteTask.action` | `Task task` | `bool success` `string task_id` `string result_message` | `string current_action` `float32 progress` `string status_description` | 执行 WMS 任务 |
| `DockToCharger.action` | `string charger_id` | `bool success` `float32 final_battery_level` | `float32 docking_progress` | 自动充电对接 |

#### 2.2.2 agv_core — 核心生命周期与安全守护

> **语言**：C++17  
> **包类型**：`ament_cmake`  
> **节点数量**：3 个

**节点 1：`safety_guardian`（安全守护节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 系统级安全监控：急停仲裁、心跳监控、状态机管理、故障分级处理 |
| **输入话题** | `/agv_<id>/heartbeat` (Heartbeat, Reliable) — 各节点心跳 |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyZone, Reliable) — 安全区域状态 |
| **输入话题** | `/agv_<id>/hardware/estop_status` (Bool, Reliable) — 硬件急停状态 |
| **输出话题** | `/agv_<id>/cmd_emergency_stop` (Bool, Reliable) — 急停指令 |
| **输出话题** | `/agv_<id>/safety/state` (String, Reliable) — 安全状态机状态 |
| **服务** | `~emergency_stop` (EmergencyStop) — 软件急停 |
| **服务** | `~clear_emergency` (ClearEmergency) — 急停恢复 |
| **服务** | `~query_safety_status` (QueryStatus) — 安全状态查询 |
| **参数** | `heartbeat_timeout_ms` (int, default 500) — 心跳超时阈值 |
| **参数** | `max_linear_velocity` (double, default 1.5) — 最大线速度限幅 |
| **参数** | `max_angular_velocity` (double, default 1.0) — 最大角速度限幅 |

**节点 2：`mode_manager`（模式管理节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 生命周期节点管理 + 自动/手动模式切换 + 模式联锁检查 |
| **输入话题** | `/agv_<id>/status` (AGVStatus, Reliable) — AGV 当前状态 |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyZone, Reliable) — 安全区域 |
| **输出话题** | `/agv_<id>/mode` (String, Reliable) — 当前运行模式 |
| **服务** | `~set_mode` (SetMode) — 模式切换请求 |
| **动作** | — |
| **参数** | `auto_to_manual_require_stopped` (bool, default true) |
| **参数** | `manual_to_auto_require_self_check` (bool, default true) |

**节点 3：`heartbeat_monitor`（心跳监控节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 接收并监控所有关键节点心跳，超时触发告警 |
| **输入话题** | `/agv_<id>/heartbeat` (Heartbeat, Reliable) |
| **输出话题** | `/agv_<id>/diagnostics` (DiagnosticArray, Reliable) |
| **服务** | `~query_node_health` (自定义) |
| **参数** | `monitored_nodes` (string[], default 所有关键节点名) |

#### 2.2.3 agv_perception — 感知与避障包

> **语言**：C++17  
> **包类型**：`ament_cmake`  
> **节点数量**：2 个

**节点 1：`sensor_fusion`（传感器融合节点）**

| 项目 | 内容 |
|------|------|
| **职责** | LiDAR 点云 + 深度相机数据的时间戳对齐与融合，输出融合后的障碍物信息 |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan, BestEffort) — LiDAR 扫描 |
| **输入话题** | `/agv_<id>/camera/depth/points` (PointCloud2, BestEffort) — 深度点云 |
| **输出话题** | `/agv_<id>/perception/fused_cloud` (PointCloud2, BestEffort) — 融合点云 |
| **输出话题** | `/agv_<id>/perception/obstacles` (PolygonStamped, BestEffort) — 障碍物多边形 |
| **参数** | `fusion_method` (string, default "time_stamp") |
| **参数** | `max_fusion_delay_ms` (int, default 100) |

**节点 2：`safety_zone_detector`（安全区域检测节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 基于融合数据检测三级安全区域（警告区/减速区/急停区），输出安全区域级别 |
| **输入话题** | `/agv_<id>/perception/fused_cloud` (PointCloud2, BestEffort) |
| **输出话题** | `/agv_<id>/safety/zone` (SafetyZone, Reliable) |
| **输出话题** | `/agv_<id>/safety/zone_markers` (MarkerArray, Reliable) — 可视化标记 |
| **参数** | `warning_zone_distance` (double, default 2.5) |
| **参数** | `deceleration_zone_distance` (double, default 1.2) |
| **参数** | `emergency_zone_distance` (double, default 0.5) |
| **参数** | `max_detection_range` (double, default 10.0) |

#### 2.2.4 agv_localization — 定位包

> **语言**：C++17  
> **包类型**：`ament_cmake`  
> **节点数量**：2 个

**节点 1：`ekf_localizer`（EKF 融合定位节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 融合轮式里程计、IMU、LiDAR 定位结果，输出高精度位姿估计 |
| **输入话题** | `/agv_<id>/odom` (Odometry, Reliable) — 轮式里程计 |
| **输入话题** | `/agv_<id>/imu` (Imu, BestEffort) — IMU 数据 |
| **输入话题** | `/agv_<id>/amcl_pose` (PoseWithCovarianceStamped, Reliable) — AMCL 定位 |
| **输出话题** | `/agv_<id>/localization/ekf_odom` (Odometry, Reliable) — EKF 融合里程计 |
| **输出话题** | `/agv_<id>/localization/pose` (PoseWithCovarianceStamped, Reliable) — 最终位姿 |
| **参数** | `publish_tf` (bool, default true) |
| **参数** | `odom_frame_id` (string, default "odom") |
| **参数** | `base_frame_id` (string, default "base_footprint") |

**节点 2：`relocalizer`（重定位节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 定位置信度低于阈值时触发重定位，5s 内恢复定位 |
| **输入话题** | `/agv_<id>/localization/pose` (PoseWithCovarianceStamped) |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan) |
| **输出话题** | `/agv_<id>/localization/relocalization_trigger` (Bool) |
| **服务** | `~force_relocalize` (Trigger) — 强制重定位 |
| **参数** | `covariance_threshold` (float[], default [0.5, 0.5, 0.5]) |
| **参数** | `relocalization_timeout_s` (int, default 5) |

#### 2.2.5 agv_navigation — 导航包

> **语言**：C++17  
> **包类型**：`ament_cmake`  
> **节点数量**：3 个

**节点 1：`global_planner`（全局路径规划节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 基于全局地图计算 A* 路径，响应时间 ≤ 200ms |
| **输入话题** | `/agv_<id>/map` (OccupancyGrid, Reliable) — 全局地图 |
| **输入话题** | `/agv_<id>/localization/pose` (PoseWithCovarianceStamped) — 当前位置 |
| **输入话题** | `/agv_<id>/navigation/goal` (PoseStamped) — 导航目标 |
| **输出话题** | `/agv_<id>/navigation/global_path` (Path, Reliable) — 全局路径 |
| **输出话题** | `/agv_<id>/navigation/global_path_markers` (Marker) — 路径可视化 |
| **参数** | `planner_type` (string, default "AStar") |
| **参数** | `max_planning_time_s` (double, default 0.2) |

**节点 2：`local_planner`（局部规划与避障节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 基于 DWA/TEB 算法，跟踪全局路径并实时避障，输出速度指令 |
| **输入话题** | `/agv_<id>/navigation/global_path` (Path) |
| **输入话题** | `/agv_<id>/localization/ekf_odom` (Odometry) |
| **输入话题** | `/agv_<id>/perception/obstacles` (PolygonStamped) |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyZone) — 安全区域影响速度 |
| **输出话题** | `/agv_<id>/navigation/cmd_vel` (Twist, Reliable) — 速度指令 |
| **输出话题** | `/agv_<id>/navigation/local_costmap` (OccupancyGrid) |
| **动作服务器** | `~navigate_to_pose` (NavigateToPose) |
| **参数** | `max_linear_velocity` (double, default 1.5) |
| **参数** | `max_angular_velocity` (double, default 1.0) |
| **参数** | `control_frequency` (double, default 20.0) |

**节点 3：`costmap_manager`（代价地图管理节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 管理全局和局部代价地图，融合静态地图 + 传感器障碍物 |
| **输入话题** | `/agv_<id>/map` (OccupancyGrid) |
| **输入话题** | `/agv_<id>/perception/fused_cloud` (PointCloud2) |
| **输入话题** | `/fleet/shared_obstacles` (PointCloud2) — 多车共享障碍物 |
| **输出话题** | `/agv_<id>/navigation/global_costmap` (OccupancyGrid) |
| **输出话题** | `/agv_<id>/navigation/local_costmap` (OccupancyGrid) |

#### 2.2.6 agv_control — 运动控制包

> **语言**：C++17  
> **包类型**：`ament_cmake`  
> **节点数量**：3 个

**节点 1：`motion_controller`（运动控制器节点）**

| 项目 | 内容 |
|------|------|
| **职责** | PID/MPC 闭环控制，接收速度指令并输出电机控制信号，控制周期 ≤ 50ms |
| **输入话题** | `/agv_<id>/navigation/cmd_vel` (Twist) — 期望速度 |
| **输入话题** | `/agv_<id>/localization/ekf_odom` (Odometry) — 实际速度反馈 |
| **输入话题** | `/agv_<id>/cmd_emergency_stop` (Bool) — 急停指令 |
| **输出话题** | `/agv_<id>/control/motor_commands` (MotorCommand, 自定义) — 电机指令 |
| **输出话题** | `/agv_<id>/control/actual_vel` (Twist, Reliable) — 实际速度 |
| **参数** | `controller_type` (string, default "PID") |
| **参数** | `pid/kp` (double), `pid/ki` (double), `pid/kd` (double) |
| **参数** | `max_linear_acceleration` (double, default 0.5) |
| **参数** | `max_angular_acceleration` (double, default 1.0) |

**节点 2：`velocity_limiter`（速度限幅节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 三层限幅：硬件层（不可改）→ 固件层 → 软件层，安全速度限制 |
| **输入话题** | `/agv_<id>/control/motor_commands` (MotorCommand) |
| **输出话题** | `/agv_<id>/control/limited_motor_commands` (MotorCommand, Reliable) |
| **参数** | `hardware_max_linear` (double) — 硬件最大线速度 |
| **参数** | `firmware_max_linear` (double) — 固件最大线速度 |
| **参数** | `software_max_linear` (double) — 软件最大线速度 |

**节点 3：`manual_controller`（手动控制节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 手柄/键盘输入映射，仅在手动模式下输出速度指令 |
| **输入话题** | `/agv_<id>/joy` (Joy, BestEffort) — 手柄输入 |
| **输出话题** | `/agv_<id>/control/manual_cmd_vel` (Twist, Reliable) |
| **参数** | `joy_linear_scale` (double, default 0.5) |
| **参数** | `joy_angular_scale` (double, default 0.5) |

#### 2.2.7 agv_scheduler — 任务调度包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：1 个

**节点 1：`task_scheduler`（任务调度节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 接收并管理任务队列，按优先级执行，将任务拆解为动作序列 |
| **输入话题** | `/agv_<id>/scheduler/task` (Task, Reliable) — 新任务 |
| **输入话题** | `/agv_<id>/safety/state` (String, Reliable) — 安全状态 |
| **输出话题** | `/agv_<id>/scheduler/task_status` (String, Reliable) — 任务状态 |
| **输出话题** | `/agv_<id>/scheduler/current_action` (String, Reliable) — 当前动作 |
| **动作客户端** | `~navigate_to_pose` → `agv_navigation/local_planner` |
| **动作客户端** | `~dock_to_charger` → `agv_control/dock_controller` |
| **服务** | `~cancel_task` (Trigger) — 取消当前任务 |
| **服务** | `~query_task_queue` (自定义) — 查询任务队列 |
| **参数** | `max_queue_size` (int, default 20) |
| **参数** | `enable_priority_preemption` (bool, default true) |

#### 2.2.8 agv_safety — 安全逻辑包

> **语言**：C++17  
> **包类型**：`ament_cmake`  
> **节点数量**：2 个

**节点 1：`emergency_handler`（急停处理节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 监听硬件急停信号与软件急停指令，执行急停逻辑（≤ 100ms 硬件，≤ 200ms 软件） |
| **输入话题** | `/agv_<id>/hardware/estop_status` (Bool, Reliable) |
| **输入话题** | `/agv_<id>/cmd_emergency_stop` (Bool, Reliable) |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyZone, Reliable) |
| **输出话题** | `/agv_<id>/safety/estop_triggered` (Bool, Reliable) — 急停状态 |
| **输出话题** | `/agv_<id>/hardware/estop_command` (Bool, Reliable) — 硬件急停指令（CAN） |
| **服务** | `~trigger_estop` (EmergencyStop) |
| **服务** | `~clear_estop` (ClearEmergency) |
| **参数** | `hardware_estop_pin` (int) — 硬件急停 GPIO 引脚 |
| **参数** | `estop_recovery_timeout_s` (double, default 30.0) |

**节点 2：`heartbeat_generator`（心跳生成节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 周期性生成并发布本机心跳，供中央调度和本地安全守护监控 |
| **输出话题** | `/agv_<id>/heartbeat` (Heartbeat, Reliable, 10Hz) |
| **参数** | `agv_id` (string) — AGV 标识 |
| **参数** | `heartbeat_interval_ms` (int, default 100) — 100ms 间隔 |

#### 2.2.9 agv_fleet_manager — 车队管理包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：2 个

**节点 1：`fleet_scheduler`（集中调度节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 全局任务分配、AGV 注册管理、负载均衡、任务优先级仲裁 |
| **输入话题** | `/fleet/agv_status` (AGVStatus, Reliable) — 各车状态 |
| **输入话题** | `/fleet/task_requests` (Task, Reliable) — 新任务请求 |
| **输出话题** | `/fleet/assigned_tasks` (Task, Reliable) — 分配给指定 AGV 的任务 |
| **输出话题** | `/fleet/fleet_status` (String, Reliable) — 车队整体状态 |
| **服务** | `~register_agv` (RegisterAGV) |
| **服务** | `~submit_task` (自定义) — WMS 任务提交 |
| **服务** | `~query_fleet_status` (自定义) |
| **参数** | `scheduling_algorithm` (string, default "round_robin") |
| **参数** | `max_agv_count` (int, default 10) |

**节点 2：`deadlock_detector`（死锁检测节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 全局死锁检测（≤ 500ms）、自动化解锁、路径协商 |
| **输入话题** | `/fleet/agv_positions` (PoseArray, Reliable) — 各车位置 |
| **输入话题** | `/fleet/path_reservations` (TrafficReservation, Reliable) |
| **输出话题** | `/fleet/deadlock_info` (DeadlockInfo, Reliable) — 死锁信息 |
| **输出话题** | `/fleet/deadlock_resolution` (String, Reliable) — 化解方案 |
| **参数** | `detection_interval_ms` (int, default 500) |
| **参数** | `conflict_distance_threshold` (double, default 1.5) |

#### 2.2.10 agv_api_gateway — API 网关包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：1 个

**节点 1：`api_gateway`（API 网关节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 对外提供 REST API（HTTPS + JSON），API Key 认证，请求路由 |
| **输入话题** | `/fleet/fleet_status` (String) |
| **输入话题** | `/fleet/agv_status` (AGVStatus) |
| **输入话题** | `/fleet/deadlock_info` (DeadlockInfo) |
| **输出话题** | `/fleet/task_requests` (Task) |
| **服务客户端** | `fleet_scheduler` 服务 |
| **参数** | `api_port` (int, default 8080) |
| **参数** | `api_key` (string) |
| **参数** | `enable_ssl` (bool, default true) |
| **参数** | `ssl_cert_path` (string) |
| **参数** | `rate_limit_per_second` (int, default 100) |

#### 2.2.11 agv_traffic_control — 交通控制包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：1 个

**节点 1：`traffic_controller`（交通管制节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 交叉路口/窄道等关键区域的通行权仲裁、资源预留管理、死锁预防 |
| **输入话题** | `/fleet/agv_positions` (PoseArray, Reliable) |
| **输入话题** | `/fleet/path_reservations` (TrafficReservation, Reliable) |
| **输出话题** | `/fleet/traffic_zones` (String, Reliable) — 区域占用状态 |
| **服务** | `~reserve_zone` (ReserveZone) |
| **服务** | `~release_zone` (ReleaseZone) |
| **服务** | `~query_zone_status` (自定义) |
| **参数** | `zones_config_file` (string, default "config/traffic_zones.yaml") |
| **参数** | `max_reservation_duration_s` (double, default 30.0) |
| **参数** | `conflict_resolution_strategy` (string, default "priority_based") |

#### 2.2.12 agv_simulation — 仿真包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：0 个（仅模型和配置）

| 项目 | 内容 |
|------|------|
| **包含** | `urdf/` — AGV URDF/Xacro 模型、`worlds/` — 仓库仿真世界、`models/` — 货架/障碍物模型、`plugins/` — 传感器仿真插件配置 |

#### 2.2.13 agv_tools — 工具包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：0 个（仅命令行工具）

| 项目 | 内容 |
|------|------|
| **包含** | `scripts/agv_control_cli.py` — 命令行控制工具、`scripts/fleet_monitor.py` — 车队监控工具、`scripts/diagnostics.py` — 诊断工具 |

#### 2.2.14 agv_visualization — 可视化包

> **语言**：Python 3.10  
> **包类型**：`ament_python`  
> **节点数量**：0 个（仅配置）

| 项目 | 内容 |
|------|------|
| **包含** | `rviz/` — RViz 配置文件、`launch/viz.launch.py` — 可视化启动文件、`web/` — Web 仪表盘配置 |

### 2.3 节点间依赖关系图

```
                              +-------------------+
                              |   agv_api_gateway  |  ←→  WMS (外部)
                              +--------+----------+
                                       |
                              /fleet/task_requests
                                       ↓
                              +-------------------+
                              |  agv_fleet_manager |
                              |  (fleet_scheduler) |
                              +--------+----------+
                                       |
                      ┌────────────────+────────────────┐
                      |  /fleet/       |  /fleet/        |
                      |  agv_status    |  assigned_tasks |
                      ↓                ↓                 ↓
              +----------------+  +----------------+  +-------------------+
              | agv_safety     |  | agv_scheduler  |  | agv_traffic_control|
              | (heartbeat_gen)|  | (task_scheduler)|  | (traffic_ctrl)    |
              +----------------+  +--------+-------+  +-------------------+
                      |                    |
              /agv_<id>/heartbeat    /agv_<id>/scheduler/current_action
                      ↓                    ↓
              +----------------+  +-------------------+
              | agv_core       |  | agv_navigation    |
              | (safety_guard) |  | (global_planner)  |
              +----------------+  | (local_planner)   |
                      |           | (costmap_manager) |
              /agv_<id>/          +--------+----------+
              cmd_emergency_stop           |
                      |           /agv_<id>/navigation/cmd_vel
                      ↓                    ↓
              +----------------+  +-------------------+
              | agv_safety     |  | agv_control       |
              | (emergency_hdl)|  | (motion_ctrl)     |
              +----------------+  | (velocity_limiter)|
                      |           | (manual_ctrl)     |
              /agv_<id>/          +--------+----------+
              hardware/estop_cmd           |
                      ↓                    ↓
              +----------------+  +-------------------+
              | agv_perception |  | agv_localization  |
              | (sensor_fusion)|  | (ekf_localizer)   |
              | (safety_zone)  |  | (relocalizer)     |
              +----------------+  +-------------------+
                      ↑                    ↑
              LiDAR / Camera           Odom / IMU
                      |                    |
              +----------------+  +-------------------+
              |  传感器硬件 / 仿真    |  底盘硬件 / 仿真      |
              +----------------+  +-------------------+
```

### 2.4 命名空间设计

**单 AGV 命名空间**：`/agv_<id>/`

```
/agv_<id>/
├── lidar/
│   └── scan                      # LaserScan  — LiDAR 扫描数据
├── camera/
│   └── depth/
│       └── points                # PointCloud2 — 深度点云
├── imu                           # Imu — IMU 数据
├── odom                          # Odometry — 轮式里程计
├── perception/
│   ├── fused_cloud               # PointCloud2 — 融合点云
│   └── obstacles                 # PolygonStamped — 障碍物
├── safety/
│   ├── zone                      # SafetyZone — 安全区域
│   ├── state                     # String — 安全状态机
│   ├── estop_triggered           # Bool — 急停触发标志
│   └── zone_markers              # MarkerArray — 区域可视化
├── localization/
│   ├── ekf_odom                  # Odometry — EKF 融合里程计
│   ├── pose                      # PoseWithCovarianceStamped — 位姿
│   └── relocalization_trigger    # Bool — 重定位触发
├── navigation/
│   ├── goal                      # PoseStamped — 导航目标
│   ├── global_path               # Path — 全局路径
│   ├── cmd_vel                   # Twist — 速度指令
│   ├── global_costmap            # OccupancyGrid
│   └── local_costmap             # OccupancyGrid
├── control/
│   ├── motor_commands            # MotorCommand — 电机指令
│   ├── limited_motor_commands    # MotorCommand — 限幅后指令
│   ├── manual_cmd_vel            # Twist — 手动速度指令
│   └── actual_vel                # Twist — 实际速度
├── scheduler/
│   ├── task                      # Task — 新任务
│   ├── task_status               # String — 任务状态
│   └── current_action            # String — 当前动作
├── hardware/
│   ├── estop_status              # Bool — 硬件急停状态
│   └── estop_command             # Bool — 硬件急停指令
├── heartbeat                     # Heartbeat — 心跳
├── mode                          # String — 运行模式
├── diagnostics                   # DiagnosticArray — 诊断
├── status                        # AGVStatus — AGV 综合状态
└── joy                           # Joy — 手柄输入
```

**全局命名空间**：`/fleet/`

```
/fleet/
├── agv_status                    # AGVStatus — 各车状态汇总
├── agv_positions                 # PoseArray — 各车位置
├── task_requests                 # Task — 任务请求
├── assigned_tasks                # Task — 已分配任务
├── path_reservations             # TrafficReservation — 路径预留
├── traffic_zones                 # String — 交通区域状态
├── deadlock_info                 # DeadlockInfo — 死锁信息
├── deadlock_resolution           # String — 死锁化解方案
├── fleet_status                  # String — 车队状态
└── shared_obstacles              # PointCloud2 — 共享障碍物
```

---

## 3. 通信架构设计

### 3.1 ROS2 话题完整清单

#### 3.1.1 单 AGV 话题

| 话题名 | 消息类型 | QoS 策略 | 发布者 | 订阅者 | 频率 | 说明 |
|--------|---------|----------|--------|--------|------|------|
| `/agv_<id>/lidar/scan` | `sensor_msgs/LaserScan` | BestEffort + KeepLast(10) | 传感器驱动 / 仿真 | perception | 10-15Hz | LiDAR 扫描数据 |
| `/agv_<id>/camera/depth/points` | `sensor_msgs/PointCloud2` | BestEffort + KeepLast(5) | 传感器驱动 / 仿真 | perception | 15Hz | 深度点云 |
| `/agv_<id>/imu` | `sensor_msgs/Imu` | BestEffort + KeepLast(10) | 传感器驱动 / 仿真 | localization | 50Hz | IMU 数据 |
| `/agv_<id>/odom` | `nav_msgs/Odometry` | Reliable + KeepLast(10) | ros2_control | localization | 50Hz | 轮式里程计 |
| `/agv_<id>/joy` | `sensor_msgs/Joy` | BestEffort + KeepLast(1) | 手柄驱动 | control | 可变 | 手柄输入 |
| `/agv_<id>/perception/fused_cloud` | `sensor_msgs/PointCloud2` | BestEffort + KeepLast(5) | sensor_fusion | safety_zone_detector, costmap_manager | 10Hz | 融合点云 |
| `/agv_<id>/perception/obstacles` | `geometry_msgs/PolygonStamped` | BestEffort + KeepLast(5) | sensor_fusion | local_planner | 10Hz | 障碍物多边形 |
| `/agv_<id>/safety/zone` | `agv_msgs/SafetyZone` | **Reliable + KeepLast(5)** | safety_zone_detector | safety_guardian, local_planner, mode_manager | 20Hz | 安全区域状态 |
| `/agv_<id>/safety/state` | `std_msgs/String` | Reliable + KeepLast(1) | safety_guardian | task_scheduler, fleet_scheduler | 10Hz | 安全状态机状态 |
| `/agv_<id>/safety/zone_markers` | `visualization_msgs/MarkerArray` | Reliable + KeepLast(1) | safety_zone_detector | visualization | 5Hz | 安全区域可视化 |
| `/agv_<id>/safety/estop_triggered` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | emergency_handler | 所有节点 | 事件 | 急停触发标志 |
| `/agv_<id>/localization/ekf_odom` | `nav_msgs/Odometry` | Reliable + KeepLast(10) | ekf_localizer | local_planner, motion_controller | 50Hz | EKF 融合里程计 |
| `/agv_<id>/localization/pose` | `geometry_msgs/PoseWithCovarianceStamped` | Reliable + KeepLast(10) | ekf_localizer | global_planner, relocalizer | 50Hz | 最终位姿估计 |
| `/agv_<id>/localization/relocalization_trigger` | `std_msgs/Bool` | Reliable + KeepLast(1) | relocalizer | safety_guardian | 事件 | 重定位触发 |
| `/agv_<id>/navigation/goal` | `geometry_msgs/PoseStamped` | Reliable + KeepLast(1) | task_scheduler | global_planner | 事件 | 导航目标点 |
| `/agv_<id>/navigation/global_path` | `nav_msgs/Path` | Reliable + KeepLast(1) | global_planner | local_planner | 重规划时 | 全局规划路径 |
| `/agv_<id>/navigation/cmd_vel` | `geometry_msgs/Twist` | **Reliable + KeepLast(1)** | local_planner | motion_controller | 20Hz | 速度指令 |
| `/agv_<id>/navigation/global_costmap` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | costmap_manager | global_planner | 1Hz | 全局代价地图 |
| `/agv_<id>/navigation/local_costmap` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | costmap_manager | local_planner | 5Hz | 局部代价地图 |
| `/agv_<id>/control/motor_commands` | `agv_msgs/MotorCommand` | **Reliable + KeepLast(1)** | motion_controller | velocity_limiter | 20Hz | 电机控制指令 |
| `/agv_<id>/control/limited_motor_commands` | `agv_msgs/MotorCommand` | **Reliable + KeepLast(1)** | velocity_limiter | ros2_control | 20Hz | 限幅后电机指令 |
| `/agv_<id>/control/manual_cmd_vel` | `geometry_msgs/Twist` | Reliable + KeepLast(1) | manual_controller | motion_controller | 50Hz | 手动速度指令 |
| `/agv_<id>/control/actual_vel` | `geometry_msgs/Twist` | Reliable + KeepLast(10) | motion_controller | diagnostics | 20Hz | 实际速度 |
| `/agv_<id>/scheduler/task` | `agv_msgs/Task` | Reliable + KeepLast(10) | fleet_scheduler | task_scheduler | 事件 | 新任务 |
| `/agv_<id>/scheduler/task_status` | `std_msgs/String` | Reliable + KeepLast(1) | task_scheduler | status_monitor | 变化时 | 任务状态 |
| `/agv_<id>/scheduler/current_action` | `std_msgs/String` | Reliable + KeepLast(1) | task_scheduler | status_monitor | 变化时 | 当前动作 |
| `/agv_<id>/hardware/estop_status` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | 硬件接口 | emergency_handler | 事件 | 硬件急停状态 |
| `/agv_<id>/hardware/estop_command` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | emergency_handler | 硬件接口 | 事件 | 硬件急停指令 |
| `/agv_<id>/heartbeat` | `agv_msgs/Heartbeat` | **Reliable + KeepLast(5)** | heartbeat_generator | safety_guardian, heartbeat_monitor | 10Hz | 心跳 |
| `/agv_<id>/mode` | `std_msgs/String` | Reliable + KeepLast(1) | mode_manager | 所有节点 | 变化时 | 运行模式 |
| `/agv_<id>/diagnostics` | `diagnostic_msgs/DiagnosticArray` | Reliable + KeepLast(10) | heartbeat_monitor | diagnostics | 1Hz | 诊断信息 |
| `/agv_<id>/status` | `agv_msgs/AGVStatus` | Reliable + KeepLast(1) | status_aggregator | fleet_scheduler | 10Hz | AGV 综合状态 |
| `/agv_<id>/cmd_emergency_stop` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | safety_guardian | emergency_handler, motion_controller | 事件 | 急停指令 |

#### 3.1.2 全局/车队话题

| 话题名 | 消息类型 | QoS 策略 | 发布者 | 订阅者 | 频率 | 说明 |
|--------|---------|----------|--------|--------|------|------|
| `/fleet/agv_status` | `agv_msgs/AGVStatus` | Reliable + KeepLast(10) | 各车 status | fleet_scheduler | 10Hz | 各车状态 |
| `/fleet/agv_positions` | `geometry_msgs/PoseArray` | Reliable + KeepLast(1) | fleet_scheduler | deadlock_detector, traffic_controller | 10Hz | 各车位置 |
| `/fleet/task_requests` | `agv_msgs/Task` | Reliable + KeepLast(100) | api_gateway | fleet_scheduler | 事件 | 任务请求 |
| `/fleet/assigned_tasks` | `agv_msgs/Task` | Reliable + KeepLast(100) | fleet_scheduler | 各车 task_scheduler | 事件 | 已分配任务 |
| `/fleet/path_reservations` | `agv_msgs/TrafficReservation` | Reliable + KeepLast(50) | 各车 local_planner | traffic_controller | 变化时 | 路径预留 |
| `/fleet/traffic_zones` | `std_msgs/String` | Reliable + KeepLast(1) | traffic_controller | visualization | 5Hz | 交通区域状态 |
| `/fleet/deadlock_info` | `agv_msgs/DeadlockInfo` | Reliable + KeepLast(10) | deadlock_detector | api_gateway, visualization | 事件 | 死锁信息 |
| `/fleet/deadlock_resolution` | `std_msgs/String` | Reliable + KeepLast(1) | deadlock_detector | 各车 local_planner | 事件 | 死锁化解方案 |
| `/fleet/fleet_status` | `std_msgs/String` | Reliable + KeepLast(1) | fleet_scheduler | api_gateway | 5Hz | 车队状态 |
| `/fleet/shared_obstacles` | `sensor_msgs/PointCloud2` | BestEffort + KeepLast(5) | 各车 sensor_fusion | costmap_manager | 5Hz | 共享障碍物 |
| `/fleet/map` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | 中央地图服务器 | global_planner | 更新时 | 全局地图 |

#### 3.1.3 服务清单

| 服务名 | 服务类型 | 提供者 | 调用者 | 说明 |
|--------|---------|--------|--------|------|
| `/agv_<id>/safety_guardian/emergency_stop` | `agv_msgs/EmergencyStop` | safety_guardian | api_gateway, external | 软件急停 |
| `/agv_<id>/safety_guardian/clear_emergency` | `agv_msgs/ClearEmergency` | safety_guardian | api_gateway, manual | 急停恢复 |
| `/agv_<id>/safety_guardian/query_safety_status` | `agv_msgs/QueryStatus` | safety_guardian | diagnostics | 安全状态查询 |
| `/agv_<id>/mode_manager/set_mode` | `agv_msgs/SetMode` | mode_manager | api_gateway, task_scheduler | 模式切换 |
| `/agv_<id>/emergency_handler/trigger_estop` | `agv_msgs/EmergencyStop` | emergency_handler | safety_guardian | 触发急停 |
| `/agv_<id>/emergency_handler/clear_estop` | `agv_msgs/ClearEmergency` | emergency_handler | safety_guardian | 清除急停 |
| `/agv_<id>/localization/relocalizer/force_relocalize` | `std_srvs/Trigger` | relocalizer | diagnostics, api | 强制重定位 |
| `/agv_<id>/scheduler/cancel_task` | `std_srvs/Trigger` | task_scheduler | api_gateway | 取消当前任务 |
| `/agv_<id>/heartbeat_monitor/query_node_health` | 自定义 | heartbeat_monitor | diagnostics | 节点健康查询 |
| `/fleet/fleet_scheduler/register_agv` | `agv_msgs/RegisterAGV` | fleet_scheduler | 各 AGV 启动脚本 | AGV 注册 |
| `/fleet/fleet_scheduler/submit_task` | 自定义 | fleet_scheduler | api_gateway | 任务提交 |
| `/fleet/fleet_scheduler/query_fleet_status` | 自定义 | fleet_scheduler | api_gateway | 车队状态查询 |
| `/fleet/traffic_controller/reserve_zone` | `agv_msgs/ReserveZone` | traffic_controller | local_planner | 区域预留 |
| `/fleet/traffic_controller/release_zone` | `agv_msgs/ReleaseZone` | traffic_controller | local_planner | 释放区域 |
| `/fleet/traffic_controller/query_zone_status` | 自定义 | traffic_controller | diagnostics | 区域状态查询 |

#### 3.1.4 动作清单

| 动作名 | 动作类型 | 服务器 | 客户端 | 说明 |
|--------|---------|--------|--------|------|
| `/agv_<id>/navigation/navigate_to_pose` | `agv_msgs/NavigateToPose` | local_planner | task_scheduler | 导航到目标点 |
| `/agv_<id>/scheduler/execute_task` | `agv_msgs/ExecuteTask` | task_scheduler | (内部) | 执行任务 |

### 3.2 QoS 策略详细说明

| QoS 类别 | 适用场景 | 可靠性 | 持久性 | 历史记录 | 深度 |
|----------|---------|--------|--------|---------|------|
| **安全关键 (Critical)** | 急停、心跳、安全区域、电机指令、模式切换 | RELIABLE | VOLATILE | KEEP_LAST | 1 |
| **控制关键 (Control)** | 速度指令、电机指令、限幅指令 | RELIABLE | VOLATILE | KEEP_LAST | 1 |
| **导航数据 (Navigation)** | 路径、位姿、代价地图 | RELIABLE | VOLATILE | KEEP_LAST | 10 |
| **传感器数据 (Sensor)** | LiDAR、相机、IMU、里程计 | BEST_EFFORT | VOLATILE | KEEP_LAST | 10 |
| **状态监控 (Status)** | 状态上报、任务状态 | RELIABLE | VOLATILE | KEEP_LAST | 10 |
| **可视化 (Visualization)** | Marker、调试信息 | RELIABLE | VOLATILE | KEEP_LAST | 5 |

### 3.3 AGV ↔ 中央调度服务器通信协议

#### 3.3.1 ROS2 内网通信（基于 DDS）

```
AGV 侧 (DDS Participant 1)          中央调度侧 (DDS Participant 2)
┌──────────────────────┐            ┌──────────────────────┐
│  /agv_<id>/status    │───────────→│  /fleet/agv_status   │
│  /agv_<id>/heartbeat │───────────→│  (心跳监控)          │
│  (path_reservations) │───────────→│  /fleet/path_...     │
│                      │            │                      │
│  /fleet/assigned_... │←───────────│  任务分配            │
│  /fleet/deadlock_... │←───────────│  死锁化解方案        │
│  /fleet/shared_obs   │←──→        │  共享障碍物          │
└──────────────────────┘            └──────────────────────┘
```

**通信要求**：
- 底层 DDS 使用 **Fast DDS**（ROS2 Humble 默认）
- 发现协议：`Discovery Server` 模式（集中式发现，减少 WiFi 下的多播开销）
- 传输方式：TCP（跨主机场景）+ UDP（本机回环）
- 网络分区：AGV 与中央调度处于同一 VLAN，WiFi 延迟 ≤ 30ms

#### 3.3.2 断连处理策略

| 断连场景 | 检测方式 | AGV 行为 | 恢复行为 |
|---------|---------|---------|---------|
| DDS 断连 | 心跳丢失 > 3s | 降速至 0.3m/s，继续执行当前任务到安全位置，然后停车 | 心跳恢复后恢复自动模式 |
| WiFi 断连 > 10s | 心跳丢失 + 网络检测 | 安全停车，锁定任务 | 网络恢复后请求任务恢复 |
| 中央调度故障 | AGV 侧心跳无响应 | 同上，执行"缓行-停车-等待"策略 | 中央恢复后 AGV 重新注册 |

### 3.4 WMS REST API 接口规范

#### 3.4.1 通用规范

| 项目 | 规范 |
|------|------|
| 协议 | HTTPS |
| 数据格式 | JSON (Content-Type: application/json) |
| 认证 | API Key (Header: `X-API-Key: <api_key>`) |
| 基础 URL | `https://<fleet_server>:8080/api/v1` |
| 编码 | UTF-8 |
| 时区 | UTC+8 (ISO 8601 时间格式) |

**通用响应格式**：

```json
{
  "code": 0,
  "message": "success",
  "data": { ... },
  "timestamp": "2026-07-01T10:00:00+08:00",
  "request_id": "req-xxxxx"
}
```

**错误响应格式**：

```json
{
  "code": 40001,
  "message": "Invalid task format: missing pickup_location",
  "data": null,
  "timestamp": "2026-07-01T10:00:00+08:00",
  "request_id": "req-xxxxx"
}
```

#### 3.4.2 接口端点

##### 接口 1：任务下发

```
POST /api/v1/tasks
```

**请求体**：
```json
{
  "task_id": "TASK-20260701-001",
  "task_type": "transport",
  "priority": 1,
  "pickup_location": {
    "x": 12.5,
    "y": 8.3,
    "theta": 0.0,
    "frame_id": "map"
  },
  "dropoff_location": {
    "x": 25.0,
    "y": 15.7,
    "theta": 1.57,
    "frame_id": "map"
  },
  "payload": {
    "type": "box",
    "weight_kg": 10.5,
    "description": "货物A从A1区到B2区"
  },
  "deadline": "2026-07-01T12:00:00+08:00",
  "timeout_seconds": 300
}
```

**响应体**：
```json
{
  "code": 0,
  "message": "Task accepted",
  "data": {
    "task_id": "TASK-20260701-001",
    "assigned_agv": "agv_001",
    "estimated_duration_s": 120,
    "estimated_start_time": "2026-07-01T10:05:00+08:00",
    "status": "queued"
  }
}
```

**状态码**：
| HTTP 状态码 | code | 说明 |
|-------------|------|------|
| 200 | 0 | 任务已接受 |
| 400 | 40001 | 请求格式错误 |
| 401 | 40002 | API Key 认证失败 |
| 429 | 40003 | 请求频率超限 |
| 503 | 50001 | 系统繁忙，无可用 AGV |

---

##### 接口 2：任务状态查询

```
GET /api/v1/tasks/{task_id}
```

**响应体**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "task_id": "TASK-20260701-001",
    "status": "executing",
    "assigned_agv": "agv_001",
    "current_action": "navigating_to_pickup",
    "progress": 0.65,
    "estimated_remaining_s": 45,
    "created_at": "2026-07-01T10:00:00+08:00",
    "started_at": "2026-07-01T10:05:00+08:00",
    "completed_at": null,
    "fault_info": null
  }
}
```

**任务状态枚举**：
| status | 说明 |
|--------|------|
| `queued` | 排队中 |
| `assigned` | 已分配 |
| `executing` | 执行中 |
| `completed` | 已完成 |
| `failed` | 失败 |
| `cancelled` | 已取消 |
| `locked` | 锁定（故障后） |

---

##### 接口 3：批量任务状态查询

```
GET /api/v1/tasks?status=executing&agv_id=agv_001&limit=50&offset=0
```

**响应体**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "tasks": [ ... ],
    "total": 150,
    "limit": 50,
    "offset": 0
  }
}
```

---

##### 接口 4：取消任务

```
DELETE /api/v1/tasks/{task_id}
```

**请求体（可选）**：
```json
{
  "reason": "order cancelled by WMS"
}
```

**响应体**：
```json
{
  "code": 0,
  "message": "Task cancelled",
  "data": {
    "task_id": "TASK-20260701-001",
    "previous_status": "executing",
    "current_status": "cancelled"
  }
}
```

---

##### 接口 5：AGV 状态查询

```
GET /api/v1/agvs/{agv_id}/status
```

**响应体**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "agv_id": "agv_001",
    "online": true,
    "mode": "auto",
    "battery_level": 0.85,
    "position": {
      "x": 12.5,
      "y": 8.3,
      "theta": 0.0,
      "frame_id": "map"
    },
    "linear_velocity": 0.8,
    "angular_velocity": 0.0,
    "task_status": "executing",
    "current_task_id": "TASK-20260701-001",
    "fault_code": 0,
    "fault_message": null,
    "safety_status": {
      "zone_level": 0,
      "estop_triggered": false
    },
    "uptime_seconds": 3600
  }
}
```

---

##### 接口 6：车队状态总览

```
GET /api/v1/fleet/status
```

**响应体**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total_agvs": 5,
    "online_agvs": 5,
    "idle_agvs": 2,
    "busy_agvs": 3,
    "faulted_agvs": 0,
    "charging_agvs": 0,
    "total_tasks_today": 150,
    "completed_tasks_today": 145,
    "failed_tasks_today": 2,
    "average_task_completion_time_s": 95,
    "deadlocks_detected_today": 1,
    "deadlocks_resolved": 1
  }
}
```

---

##### 接口 7：地图数据查询

```
GET /api/v1/maps/current
```

**响应体**：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "map_id": "warehouse_floor1_v3",
    "resolution": 0.05,
    "width": 2000,
    "height": 1500,
    "origin": { "x": -50.0, "y": -37.5, "theta": 0.0 },
    "format": "png",
    "data_url": "https://<fleet_server>:8080/api/v1/maps/warehouse_floor1_v3/data",
    "last_updated": "2026-06-30T18:00:00+08:00"
  }
}
```

---

##### 接口 8：异常告警推送

```
POST /api/v1/alerts/callback
```

> 此接口由 WMS 提供回调 URL，系统在发生异常时主动推送。

**请求体（系统 → WMS 推送）**：
```json
{
  "alert_id": "ALERT-20260701-003",
  "alert_type": "emergency_stop",
  "severity": "critical",
  "agv_id": "agv_002",
  "message": "AGV agv_002 triggered emergency stop: obstacle within 0.3m",
  "timestamp": "2026-07-01T10:05:30+08:00",
  "details": {
    "fault_code": 301,
    "position": { "x": 30.0, "y": 20.0, "frame_id": "map" },
    "zone_level": 3
  }
}
```

**告警类型枚举**：
| alert_type | 严重级别 | 说明 |
|-----------|---------|------|
| `emergency_stop` | critical | 急停触发 |
| `fault_minor` | warning | 轻微故障（传感器短暂异常） |
| `fault_moderate` | error | 中等故障（定位置信度下降） |
| `fault_severe` | critical | 严重故障（定位丢失/碰撞） |
| `deadlock_detected` | warning | 死锁检测 |
| `battery_low` | warning | 电量低 |
| `mode_switch` | info | 模式切换 |
| `system_health` | info | 系统健康状态变更 |

---

##### 接口 9：系统控制

```
POST /api/v1/system/emergency_stop
```

**请求体**：
```json
{
  "agv_id": "agv_001",
  "reason": "WMS operator manual stop"
}
```

**响应体**：
```json
{
  "code": 0,
  "message": "Emergency stop command sent",
  "data": {
    "agv_id": "agv_001",
    "estop_triggered": true,
    "timestamp": "2026-07-01T10:06:00+08:00"
  }
}
```

```
POST /api/v1/system/clear_emergency
```

**请求体**：
```json
{
  "agv_id": "agv_001"
}
```

**响应体**：
```json
{
  "code": 0,
  "message": "Emergency cleared",
  "data": {
    "agv_id": "agv_001",
    "estop_cleared": true,
    "timestamp": "2026-07-01T10:10:00+08:00"
  }
}
```

```
POST /api/v1/system/set_mode
```

**请求体**：
```json
{
  "agv_id": "agv_001",
  "mode": "manual",
  "reason": "maintenance"
}
```

---

**错误码汇总**：

| code | HTTP 状态码 | 说明 |
|------|-------------|------|
| 0 | 200 | 成功 |
| 40001 | 400 | 请求参数错误 |
| 40002 | 401 | API Key 认证失败 |
| 40003 | 429 | 请求频率超限 |
| 40004 | 404 | 资源不存在 |
| 40005 | 409 | 操作冲突（如急停状态无法切换模式） |
| 50001 | 503 | 系统繁忙 |
| 50002 | 500 | 内部错误 |
| 50003 | 503 | 服务维护中 |

---

## 4. 数据流设计

### 4.1 传感器数据 → 感知 → 定位 → 规划 → 控制 完整数据流

```
时间轴方向 →
┌─────────────────────────────────────────────────────────────────────┐
│  [传感器层]                                                          │
│  LiDAR (10-15Hz)  ──→ /agv_<id>/lidar/scan (LaserScan)              │
│  RealSense D435    ──→ /agv_<id>/camera/depth/points (PointCloud2)  │
│  轮式编码器 (50Hz) ──→ /agv_<id>/odom (Odometry)                    │
│  IMU (50Hz)        ──→ /agv_<id>/imu (Imu)                          │
└─────────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [感知层 - 处理延迟 ≤ 100ms]                                        │
│  ┌──────────────────────────────────────┐                           │
│  │ sensor_fusion                        │                           │
│  │ 1. 时间戳对齐 LiDAR + 深度点云       │                           │
│  │ 2. 坐标系变换至 base_footprint       │                           │
│  │ 3. 下采样与滤波                      │                           │
│  │ 4. 障碍物多边形提取                  │                           │
│  └──────────┬───────────────────────────┘                           │
│             │                                                       │
│             ├──→ /agv_<id>/perception/fused_cloud (PointCloud2)     │
│             └──→ /agv_<id>/perception/obstacles (PolygonStamped)   │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ safety_zone_detector                  │                           │
│  │ 1. 计算障碍物距离                     │                           │
│  │ 2. 三级区域判断:                      │                           │
│  │    - 急停区 (0~0.5m) → zone=3        │                           │
│  │    - 减速区 (0.5~2m) → zone=2        │                           │
│  │    - 警告区 (2~3m) → zone=1          │                           │
│  │    - 安全 (>3m) → zone=0             │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/safety/zone (SafetyZone, 20Hz)          │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [定位层 - 静态 ±3cm, 动态 ±5cm]                                    │
│  ┌──────────────────────────────────────┐                           │
│  │ ekf_localizer (robot_localization)   │                           │
│  │ 输入: odom + imu + amcl_pose        │                           │
│  │ 输出: EKF 融合后的平滑里程计/位姿    │                           │
│  └──────────┬───────────────────────────┘                           │
│             ├──→ /agv_<id>/localization/ekf_odom (Odometry, 50Hz)  │
│             └──→ /agv_<id>/localization/pose (PoseWithCov, 50Hz)   │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ relocalizer                          │                           │
│  │ 监控协方差，触发重定位 (≤5s 恢复)    │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/localization/relocalization_trigger     │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [规划层 - 全局重规划 ≤ 200ms]                                      │
│  ┌──────────────────────────────────────┐                           │
│  │ global_planner (A*)                  │                           │
│  │ 输入: map + pose + goal              │                           │
│  │ 输出: 全局路径 (Path)                │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/navigation/global_path                  │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ local_planner (DWA/TEB)              │                           │
│  │ 输入: global_path + ekf_odom +       │                           │
│  │       obstacles + safety_zone        │                           │
│  │ 输出: cmd_vel (20Hz)                 │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/navigation/cmd_vel (Twist, 20Hz)        │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ costmap_manager                       │                           │
│  │ 维护全局/局部代价地图                 │                           │
│  └──────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [控制层 - 控制周期 ≤ 50ms]                                         │
│  ┌──────────────────────────────────────┐                           │
│  │ motion_controller (PID/MPC)          │                           │
│  │ 1. 接收 cmd_vel (期望速度)           │                           │
│  │ 2. 接收 ekf_odom (实际速度反馈)     │                           │
│  │ 3. 计算控制误差 → PID 输出          │                           │
│  │ 4. 急停指令直接覆盖 → 速度归零      │                           │
│  │ 5. 输出电机指令 (PWM/CAN)           │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/control/motor_commands                  │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ velocity_limiter (三层限幅)          │                           │
│  │ 1. 硬件限幅 (不可修改)              │                           │
│  │ 2. 固件限幅 (嵌入式)                │                           │
│  │ 3. 软件限幅 (ROS节点)               │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/control/limited_motor_commands          │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [执行层]                                                            │
│  ros2_control → 电机驱动器 (CAN/EtherCAT) → 差分驱动底盘            │
│  Gazebo Ignition Fortress (仿真模式)                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 任务下发流程

```
WMS                          中央调度                         AGV
 │                              │                              │
 │  1. POST /api/v1/tasks       │                              │
 │  ──────────────────────────→│                              │
 │                              │  2. 任务验证与优先级计算      │
 │                              │  3. AGV 选择（负载均衡）     │
 │  4. HTTP 200 (accepted)      │                              │
 │  ←──────────────────────────│                              │
 │                              │  5. 发布 /fleet/assigned_tasks│
 │                              │  ──────────────────────────→│
 │                              │                              │  6. 接收任务
 │                              │                              │  7. 加入任务队列
 │                              │                              │  8. 拆解为动作序列
 │                              │                              │     (navigate_to_pickup
 │                              │                              │      → wait_for_loading
 │                              │                              │      → navigate_to_dropoff
 │                              │                              │      → wait_for_unloading)
 │                              │                              │
 │                              │                              │  9. 发起 NavigateToPose Action
 │                              │                              │  (local_planner 执行导航)
 │                              │                              │
 │                              │  10. 状态更新 (status)       │
 │                              │  ←──────────────────────────│
 │                              │                              │
 │  11. 任务完成通知            │                              │
 │  ←──────────────────────────│                              │
 │                              │                              │
```

### 4.3 多 AGV 协同数据流

```
 [AGV 1]                     [中央调度]                     [AGV 2]
    │                           │                           │
    │  1. 规划路径               │                           │
    │  2. 检测到路径交叉         │                           │
    │  3. 调用 ReserveZone       │                           │
    │  ────────────────────────→│                           │
    │                           │  4. 检查区域占用状态       │
    │                           │  5. 区域空闲 → 授予       │
    │  6. granted=true           │                           │
    │  ←────────────────────────│                           │
    │  7. 通过交叉区域           │                           │
    │  8. 离开后调用 ReleaseZone │                           │
    │  ────────────────────────→│                           │
    │                           │  9. 释放区域              │
    │                           │                           │  10. 规划路径
    │                           │                           │  11. 检测到路径交叉
    │                           │                           │  12. 调用 ReserveZone
    │                           │  ←────────────────────────│
    │                           │  13. 区域空闲 → 授予      │
    │                           │  ────────────────────────→│
    │                           │                           │  14. 通过交叉区域
    │                           │                           │
    │  [死锁检测 - 500ms 周期]   │                           │
    │                           │  ┌─────────────────────┐  │
    │                           │  │ deadlock_detector   │  │
    │                           │  │ 收集所有 AGV 位置    │  │
    │                           │  │ 构建资源分配图       │  │
    │                           │  │ 检测环路依赖         │  │
    │                           │  └─────────────────────┘  │
    │                           │                           │
    │  15. 死锁检测通知         │                           │
    │  ←────────────────────────│                           │
    │  16. 死锁化解方案:        │                           │
    │  AGV 1 前进, AGV 2 倒车  │                           │
    │  ←────────────────────────│──────────────────────────│
    │                           │                           │
    │  17. 执行化解动作         │                           │
    │                           │  18. 执行化解动作        │
    │                           │                           │
```

---

## 5. 安全架构设计

### 5.1 安全架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        安全架构总览                                  │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  安全层 1: 硬件安全 (独立通道)                                │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐              │    │
│  │  │ 物理急停  │  │ 安全继电器 │  │ 电机驱动器    │              │    │
│  │  │ 按钮     │──│          │──│ 硬件限幅      │              │    │
│  │  └──────────┘  └──────────┘  └──────────────┘              │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              ↑ 独立通道，不经过软件                   │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  安全层 2: 软件安全 (C++ 实现, 无动态内存分配)                │    │
│  │  ┌──────────────────────────────────────────────────┐       │    │
│  │  │  safety_guardian (安全守护节点)                   │       │    │
│  │  │  ├─ 心跳监控（所有关键节点）                      │       │    │
│  │  │  ├─ 故障分级处理（轻微/中等/严重）                │       │    │
│  │  │  ├─ 速度限幅仲裁                                │       │    │
│  │  │  └─ 安全状态机管理                              │       │    │
│  │  └──────────────────────────────────────────────────┘       │    │
│  │  ┌──────────────────────────────────────────────────┐       │    │
│  │  │  emergency_handler (急停处理节点)                 │       │    │
│  │  │  ├─ 硬件急停信号监听 → 直接电机断电               │       │    │
│  │  │  ├─ 软件急停指令执行 → CAN 停机指令               │       │    │
│  │  │  └─ 安全区域触发急停 (zone=3)                    │       │    │
│  │  └──────────────────────────────────────────────────┘       │    │
│  │  ┌──────────────────────────────────────────────────┐       │    │
│  │  │  safety_zone_detector (安全区域检测节点)          │       │    │
│  │  │  ├─ 三级区域检测 (警告/减速/急停)                │       │    │
│  │  │  └─ 20Hz 检测频率                               │       │    │
│  │  └──────────────────────────────────────────────────┘       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  安全层 3: 通信安全                                            │    │
│  │  - DDS 安全配置 (身份认证 + 加密)                              │    │
│  │  - HTTPS + API Key 认证                                       │    │
│  │  - 心跳 + 超时检测                                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 安全守护节点设计

`safety_guardian` 节点是整个安全架构的核心，使用 C++17 实现，禁止动态内存分配。

**节点位置**：
- 位于 `agv_core` 包中
- 在每台 AGV 上独立运行
- 作为独立生命周期节点，启动优先级最高
- 在 `LifecycleNode::PRIMARY_STATE_ACTIVE` 状态下执行安全监控

**功能模块**：

```
safety_guardian
├── Heartbeat Monitor
│   ├── 接收所有关键节点心跳 (10Hz)
│   ├── 超时阈值: 500ms (可配置)
│   └── 超时处理: 节点级告警 → 降级 → 停车
│
├── Fault Classification Engine
│   ├── 轻微故障: 降速至 0.5m/s, 自动恢复
│   ├── 中等故障: 降速至 0.2m/s, 重定位尝试, 30s 超时停车
│   └── 严重故障: 立即急停, 锁定任务
│
├── Speed Arbitration
│   ├── 接收 safety_zone 输入 → 动态调整速度上限
│   ├── 警告区 (zone=1): 限速 50% 额定速度
│   ├── 减速区 (zone=2): 限速 0.3m/s
│   └── 急停区 (zone=3): 触发急停
│
└── Safety State Machine
    ├── 管理安全状态转换
    └── 输出当前安全状态供其他节点使用
```

### 5.3 硬件急停与软件急停接口设计

#### 5.3.1 硬件急停（独立硬件通道）

```
物理急停按钮 (硬件)
    │
    ├──→ 安全继电器 (独立电源回路)
    │       └──→ 电机驱动器使能引脚 → 直接断电
    │
    └──→ GPIO 输入 (NUC)
            └──→ /agv_<id>/hardware/estop_status (Bool, True)
                    └──→ emergency_handler → 确认急停状态
                          └──→ /agv_<id>/safety/estop_triggered
```

**响应要求**：
- 物理按钮 → 电机断电：≤ 100ms
- 响应路径不经过任何软件处理
- 硬件急停触发后，软件层面确认急停状态

#### 5.3.2 软件急停

```
触发源:
├── safety_guardian (心跳丢失/严重故障)
├── safety_zone_detector (zone=3)
├── api_gateway (WMS 远程急停)
└── emergency_stop 服务 (本地/远程调用)
        │
        ▼
/agv_<id>/cmd_emergency_stop (Bool, True)
        │
        ├──→ motion_controller: 立即停止速度输出
        ├──→ emergency_handler: 通过 CAN/EtherCAT 发送停机指令
        └──→ velocity_limiter: 强制输出零速度
                │
                ▼
        /agv_<id>/safety/estop_triggered (Bool, True)
```

**响应要求**：
- 软件急停触发 → 速度归零：≤ 200ms
- 使用 Reliable QoS，确保指令送达

#### 5.3.3 双重保护互锁

```
硬件急停触发 ──→ 电机断电
      ↑                ↑
      │  互为冗余      │
      │                │
软件急停触发 ──→ CAN 停机指令

任一触发 → AGV 停车 → 锁定任务 → 人工确认后恢复
```

### 5.4 心跳监控与故障检测机制

#### 5.4.1 心跳拓扑

```
心跳生成 (每台 AGV)
┌────────────────────┐
│ heartbeat_generator│ 10Hz
│ (agv_safety)       │──→ /agv_<id>/heartbeat
└────────────────────┘
        │
        ├──→ safety_guardian (本地安全守护)
        │     ├── 监控: local_planner, motion_controller,
        │     │          emergency_handler, sensor_fusion, ekf_localizer
        │     └── 超时: 500ms
        │
        └──→ heartbeat_monitor (本地监控)
              └──→ /agv_<id>/diagnostics

中央调度侧
┌────────────────────┐
│ fleet_scheduler    │ 接收 /fleet/agv_status
│ 监控各车心跳状态    │ 超时: 3s (含网络延迟)
└────────────────────┘
```

#### 5.4.2 心跳报文格式

```
Heartbeat.msg:
  string agv_id              # AGV 标识
  builtin_interfaces/Time timestamp  # 时间戳
  uint8 sequence             # 序列号（检测丢包）
  float32 cpu_load           # CPU 负载 0.0~1.0
  float32 memory_usage       # 内存使用率 0.0~1.0
```

#### 5.4.3 故障分级处理详细策略

| 故障级别 | 检测条件 | 处理动作 | 恢复条件 |
|---------|---------|---------|---------|
| **轻微** | 传感器短暂异常 < 2s | 降速至 0.5m/s | 传感器恢复后自动恢复全速 |
| **轻微** | WiFi 信号 < -75dBm | 降速至 0.5m/s | 信号恢复后自动恢复 |
| **中等** | LiDAR 遮挡 > 2s | 降速至 0.2m/s | 遮挡消除后自动恢复 |
| **中等** | 定位置信度 < 阈值 | 降速 + 重定位 | 重定位成功 (< 5s) |
| **中等** | 以上 30s 未恢复 | 停车 | 人工介入 |
| **严重** | 定位丢失 | 立即急停 | 人工恢复 |
| **严重** | WiFi 断连 > 10s | 安全停车，锁定任务 | 人工恢复 |
| **严重** | 碰撞检测触发 | 立即急停 | 人工恢复 |
| **严重** | 电机故障 | 立即急停 | 人工恢复 |

### 5.5 安全状态机设计

#### 5.5.1 状态定义

```
┌────────────────────────────────────────────────────────────────┐
│                      安全状态机                                  │
│                                                                 │
│                    ┌────────────────┐                          │
│                    │   SAFE (正常)   │                          │
│                    │ 速度: 全速      │                          │
│                    └───────┬────────┘                          │
│                            │                                    │
│          ┌─────────────────┼─────────────────┐                │
│          ▼                 ▼                  ▼                │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │  WARNING     │ │ DECELERATION │ │ EMERGENCY    │           │
│  │  警告区      │ │  减速区      │ │  急停区      │           │
│  │  速度≤50%    │ │  速度≤0.3m/s│ │  速度=0      │           │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘           │
│         │                │                │                    │
│         └────────────────┴────────────────┘                    │
│                           │ 障碍物消失                          │
│                           ▼                                    │
│                    ┌────────────────┐                          │
│                    │   SAFE (恢复)   │                          │
│                    └────────────────┘                          │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ MINOR_FAULT  │  │ MODERATE_FAULT│  │ SEVERE_FAULT│         │
│  │ 降速至0.5m/s │  │ 降速/重定位  │  │ 急停+锁定    │         │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘         │
│         │                 │                 │                   │
│         ▼                 ▼                 ▼                   │
│   自动恢复 30s超时→停车  人工介入恢复                             │
└────────────────────────────────────────────────────────────────┘
```

#### 5.5.2 状态转换矩阵

| 当前状态 | 事件 | 下一状态 | 动作 |
|---------|------|---------|------|
| SAFE | zone=1 (警告区) | WARNING | 限速 50%，发警告信号 |
| SAFE | zone=2 (减速区) | DECELERATION | 限速 0.3m/s |
| SAFE | zone=3 (急停区) | EMERGENCY | 急停 |
| SAFE | 轻微故障 | MINOR_FAULT | 降速 0.5m/s |
| SAFE | 中等故障 | MODERATE_FAULT | 降速 + 重定位 |
| SAFE | 严重故障 | SEVERE_FAULT | 急停 + 锁定 |
| WARNING | 障碍物远离 (zone=0) | SAFE | 恢复全速 |
| WARNING | 距离缩短 (zone=2) | DECELERATION | 进一步减速 |
| WARNING | 距离缩短 (zone=3) | EMERGENCY | 急停 |
| DECELERATION | 障碍物远离 (zone=0/1) | WARNING/SAFE | 逐步恢复 |
| DECELERATION | 距离缩短 (zone=3) | EMERGENCY | 急停 |
| EMERGENCY | 人工清除急停 | SAFE | 恢复（需人工确认） |
| MINOR_FAULT | 故障恢复 | SAFE | 自动恢复全速 |
| MODERATE_FAULT | 重定位成功 | SAFE | 自动恢复 |
| MODERATE_FAULT | 30s 未恢复 | SEVERE_FAULT | 停车锁定 |
| SEVERE_FAULT | 人工修复完成 | SAFE | 人工恢复 |

### 5.6 安全关键路径代码约束

```
┌─────────────────────────────────────────────────────────────┐
│  安全关键路径代码约束 (Safety-Critical Code Constraints)     │
│                                                             │
│  1. 语言约束                                                │
│     ├── 安全相关节点必须使用 C++17 实现                      │
│     └── 禁止使用 Python (GC 不确定性)                       │
│                                                             │
│  2. 内存约束                                                │
│     ├── 安全关键路径禁止动态内存分配 (new/malloc)           │
│     ├── 使用栈分配或预分配内存池                             │
│     ├── 使用 std::array 替代 std::vector                     │
│     └── 固定大小缓冲区 (最大传感器数量/N 预定义)            │
│                                                             │
│  3. 实时性约束                                               │
│     ├── 安全监控线程优先级最高 (SCHED_FIFO, priority=90)    │
│     ├── 禁止安全路径上的阻塞调用 (sleep/mutex wait)         │
│     └── 心跳间隔 ≤ 100ms，检测超时 ≤ 500ms                  │
│                                                             │
│  4. 通信约束                                                │
│     ├── 安全相关话题使用 Reliable QoS                       │
│     ├── 安全相关话题禁止使用 BestEffort                     │
│     └── 急停指令使用独立话题，不与其他控制指令复用          │
│                                                             │
│  5. 需使用 C++ 实现的安全节点                                │
│     ├── agv_core::safety_guardian                           │
│     ├── agv_core::mode_manager                              │
│     ├── agv_core::heartbeat_monitor                         │
│     ├── agv_safety::emergency_handler                       │
│     ├── agv_safety::heartbeat_generator                     │
│     ├── agv_perception::safety_zone_detector                │
│     ├── agv_perception::sensor_fusion                       │
│     ├── agv_localization::ekf_localizer                     │
│     ├── agv_localization::relocalizer                       │
│     ├── agv_navigation::global_planner                      │
│     ├── agv_navigation::local_planner                       │
│     ├── agv_navigation::costmap_manager                     │
│     ├── agv_control::motion_controller                      │
│     ├── agv_control::velocity_limiter                       │
│     └── agv_control::manual_controller                      │
│                                                             │
│  6. 允许使用 Python 实现的非安全节点                          │
│     ├── agv_scheduler::task_scheduler                       │
│     ├── agv_fleet_manager::fleet_scheduler                  │
│     ├── agv_fleet_manager::deadlock_detector                │
│     ├── agv_api_gateway::api_gateway                        │
│     └── agv_traffic_control::traffic_controller             │
└─────────────────────────────────────────────────────────────┘
```

### 5.7 急停恢复流程

```
急停触发
    │
    ▼
AGV 停车 + 任务锁定
    │
    ▼
人工检查现场安全
    │
    ▼
硬件急停按钮复位 (物理旋转/拉出)
    │
    ▼
软件急停清除 (调用 ClearEmergency 服务)
    │
    ├── 本地: ros2 service call /agv_<id>/safety_guardian/clear_emergency
    ├── 远程: POST /api/v1/system/clear_emergency
    └── 手动: 通过 Web 控制台
            │
            ▼
安全自检:
├── 所有节点心跳正常
├── 安全区域无障碍物
├── 定位状态正常
└── 自检通过
        │
        ▼
恢复自动模式 → 任务恢复或重新分配
```

---

## 6. 项目目录结构

### 6.1 推荐工作空间布局

```
agv_fleet_ws/                              # ROS2 工作空间根目录
├── src/                                   # 源代码目录
│   ├── agv_msgs/                          # [接口包] 自定义消息/服务/动作
│   │   ├── msg/                           #   消息定义
│   │   │   ├── SafetyZone.msg
│   │   │   ├── AGVStatus.msg
│   │   │   ├── Task.msg
│   │   │   ├── Heartbeat.msg
│   │   │   ├── TrafficReservation.msg
│   │   │   ├── DeadlockInfo.msg
│   │   │   └── MotorCommand.msg
│   │   ├── srv/                           #   服务定义
│   │   │   ├── SetMode.srv
│   │   │   ├── EmergencyStop.srv
│   │   │   ├── ClearEmergency.srv
│   │   │   ├── QueryStatus.srv
│   │   │   ├── ReserveZone.srv
│   │   │   ├── ReleaseZone.srv
│   │   │   └── RegisterAGV.srv
│   │   ├── action/                        #   动作定义
│   │   │   ├── NavigateToPose.action
│   │   │   ├── ExecuteTask.action
│   │   │   └── DockToCharger.action
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_core/                          # [C++] 核心生命周期与安全守护
│   │   ├── src/
│   │   │   ├── safety_guardian_node.cpp
│   │   │   ├── safety_guardian.hpp
│   │   │   ├── mode_manager_node.cpp
│   │   │   ├── mode_manager.hpp
│   │   │   ├── heartbeat_monitor_node.cpp
│   │   │   └── heartbeat_monitor.hpp
│   │   ├── include/agv_core/
│   │   ├── launch/
│   │   │   └── core.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_perception/                    # [C++] 感知与安全区域
│   │   ├── src/
│   │   │   ├── sensor_fusion_node.cpp
│   │   │   ├── sensor_fusion.hpp
│   │   │   ├── safety_zone_detector_node.cpp
│   │   │   └── safety_zone_detector.hpp
│   │   ├── include/agv_perception/
│   │   ├── launch/
│   │   │   └── perception.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_localization/                  # [C++] 定位
│   │   ├── src/
│   │   │   ├── ekf_localizer_node.cpp
│   │   │   ├── ekf_localizer.hpp
│   │   │   ├── relocalizer_node.cpp
│   │   │   └── relocalizer.hpp
│   │   ├── config/
│   │   │   └── ekf_params.yaml
│   │   ├── launch/
│   │   │   └── localization.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_navigation/                    # [C++] 导航
│   │   ├── src/
│   │   │   ├── global_planner_node.cpp
│   │   │   ├── global_planner.hpp
│   │   │   ├── local_planner_node.cpp
│   │   │   ├── local_planner.hpp
│   │   │   ├── costmap_manager_node.cpp
│   │   │   └── costmap_manager.hpp
│   │   ├── config/
│   │   │   ├── global_planner_params.yaml
│   │   │   ├── local_planner_params.yaml
│   │   │   └── costmap_params.yaml
│   │   ├── launch/
│   │   │   └── navigation.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_control/                       # [C++] 运动控制
│   │   ├── src/
│   │   │   ├── motion_controller_node.cpp
│   │   │   ├── motion_controller.hpp
│   │   │   ├── velocity_limiter_node.cpp
│   │   │   ├── velocity_limiter.hpp
│   │   │   ├── manual_controller_node.cpp
│   │   │   └── manual_controller.hpp
│   │   ├── config/
│   │   │   └── controller_params.yaml
│   │   ├── launch/
│   │   │   └── control.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_scheduler/                     # [Python] 任务调度
│   │   ├── agv_scheduler/
│   │   │   ├── __init__.py
│   │   │   ├── task_scheduler_node.py
│   │   │   ├── task_queue.py
│   │   │   └── task_state_machine.py
│   │   ├── launch/
│   │   │   └── scheduler.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   ├── agv_safety/                        # [C++] 安全逻辑
│   │   ├── src/
│   │   │   ├── emergency_handler_node.cpp
│   │   │   ├── emergency_handler.hpp
│   │   │   ├── heartbeat_generator_node.cpp
│   │   │   └── heartbeat_generator.hpp
│   │   ├── include/agv_safety/
│   │   ├── launch/
│   │   │   └── safety.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_fleet_manager/                 # [Python] 车队管理
│   │   ├── agv_fleet_manager/
│   │   │   ├── __init__.py
│   │   │   ├── fleet_scheduler_node.py
│   │   │   ├── fleet_scheduler.py
│   │   │   ├── deadlock_detector_node.py
│   │   │   ├── deadlock_detector.py
│   │   │   └── agv_registry.py
│   │   ├── launch/
│   │   │   ├── fleet_manager.launch.py
│   │   │   └── fleet_manager_sim.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   ├── agv_api_gateway/                   # [Python] API 网关
│   │   ├── agv_api_gateway/
│   │   │   ├── __init__.py
│   │   │   ├── api_gateway_node.py
│   │   │   ├── api_server.py
│   │   │   ├── auth.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── tasks.py
│   │   │       ├── agvs.py
│   │   │       ├── fleet.py
│   │   │       ├── maps.py
│   │   │       ├── alerts.py
│   │   │       └── system.py
│   │   ├── config/
│   │   │   └── api_config.yaml
│   │   ├── launch/
│   │   │   └── api_gateway.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   ├── agv_traffic_control/               # [Python] 交通控制
│   │   ├── agv_traffic_control/
│   │   │   ├── __init__.py
│   │   │   ├── traffic_controller_node.py
│   │   │   ├── zone_manager.py
│   │   │   └── conflict_resolver.py
│   │   ├── config/
│   │   │   └── traffic_zones.yaml
│   │   ├── launch/
│   │   │   └── traffic_control.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   ├── agv_simulation/                    # [Python] 仿真
│   │   ├── urdf/
│   │   │   ├── agv.urdf.xacro
│   │   │   ├── agv.gazebo.xacro
│   │   │   ├── sensors/
│   │   │   │   ├── lidar.xacro
│   │   │   │   ├── camera.xacro
│   │   │   │   └── imu.xacro
│   │   │   └── materials.xacro
│   │   ├── meshes/
│   │   │   ├── chassis.stl
│   │   │   ├── wheel.stl
│   │   │   └── sensor_mount.stl
│   │   ├── worlds/
│   │   │   ├── warehouse.sdf
│   │   │   └── warehouse.config
│   │   ├── models/
│   │   │   ├── shelf/
│   │   │   ├── charging_station/
│   │   │   └── obstacle/
│   │   ├── config/
│   │   │   └── simulation_params.yaml
│   │   ├── launch/
│   │   │   ├── simulation.launch.py
│   │   │   └── spawn_agv.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   ├── agv_tools/                         # [Python] 工具包
│   │   ├── agv_tools/
│   │   │   ├── __init__.py
│   │   │   └── scripts/
│   │   │       ├── agv_control_cli.py
│   │   │       ├── fleet_monitor.py
│   │   │       └── diagnostics.py
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   └── agv_visualization/                 # [Python] 可视化
│       ├── rviz/
│       │   ├── agv_single.rviz
│       │   └── agv_fleet.rviz
│       ├── launch/
│       │   └── viz.launch.py
│       ├── package.xml
│       ├── setup.py
│       └── setup.cfg
│
├── launch/                                # 顶级启动文件
│   ├── agv_single.launch.py               #   单 AGV 启动
│   ├── agv_fleet.launch.py                #   多 AGV 车队启动
│   ├── central_scheduler.launch.py        #   中央调度启动
│   └── simulation_fleet.launch.py         #   仿真车队启动
│
├── config/                                # 全局配置文件
│   ├── agv_params.yaml                    #   AGV 通用参数
│   ├── fleet_params.yaml                  #   车队参数
│   ├── safety_params.yaml                 #   安全参数
│   ├── network_params.yaml                #   网络参数
│   └── agv_specific/                      #   单 AGV 特定参数
│       ├── agv_001_params.yaml
│       └── agv_002_params.yaml
│
├── maps/                                  # 地图文件
│   ├── warehouse.yaml
│   └── warehouse.pgm
│
├── docker/                                # Docker 部署
│   ├── Dockerfile
│   ├── docker-compose.yaml
│   └── entrypoint.sh
│
├── docs/                                  # 文档
│   ├── architecture/                      #   架构设计文档
│   ├── api/                               #   API 文档
│   ├── user_guide/                        #   用户指南
│   └── developer_guide/                   #   开发者指南
│
├── tests/                                 # 测试
│   ├── unit/                              #   单元测试
│   │   ├── test_agv_core/
│   │   ├── test_agv_perception/
│   │   ├── test_agv_localization/
│   │   ├── test_agv_navigation/
│   │   ├── test_agv_control/
│   │   ├── test_agv_safety/
│   │   ├── test_agv_scheduler/
│   │   ├── test_agv_fleet_manager/
│   │   ├── test_agv_api_gateway/
│   │   └── test_agv_traffic_control/
│   ├── integration/                       #   集成测试
│   │   ├── test_single_agv_full_cycle/
│   │   └── test_multi_agv_coordination/
│   ├── performance/                       #   性能测试
│   │   ├── test_control_latency/
│   │   ├── test_perception_latency/
│   │   └── test_deadlock_detection/
│   └── simulation/                        #   仿真测试
│       ├── test_obstacle_avoidance/
│       └── test_multi_agv_deadlock/
│
├── colcon.meta                            # Colcon 编译元配置
├── .gitignore
└── README.md
```

### 6.2 包依赖关系

```
agv_msgs (接口包, 无运行时依赖)
    ↑
    ├── agv_core (C++)
    │    依赖: rclcpp, rclcpp_lifecycle, agv_msgs, diagnostic_msgs
    │
    ├── agv_perception (C++)
    │    依赖: rclcpp, agv_msgs, sensor_msgs, PCL, OpenCV
    │
    ├── agv_localization (C++)
    │    依赖: rclcpp, agv_msgs, nav_msgs, robot_localization, tf2
    │
    ├── agv_navigation (C++)
    │    依赖: rclcpp, agv_msgs, nav2_msgs, nav2_core, nav2_costmap_2d, tf2_geometry_msgs
    │
    ├── agv_control (C++)
    │    依赖: rclcpp, agv_msgs, geometry_msgs, tf2, ros2_control
    │
    ├── agv_safety (C++)
    │    依赖: rclcpp, agv_msgs, std_msgs
    │
    ├── agv_scheduler (Python)
    │    依赖: rclpy, agv_msgs, geometry_msgs
    │
    ├── agv_fleet_manager (Python)
    │    依赖: rclpy, agv_msgs, geometry_msgs, networkx (死锁检测)
    │
    ├── agv_api_gateway (Python)
    │    依赖: rclpy, agv_msgs, fastapi (REST), uvicorn, httpx, pyyaml
    │
    ├── agv_traffic_control (Python)
    │    依赖: rclpy, agv_msgs, geometry_msgs, pyyaml
    │
    ├── agv_simulation (Python)
    │    依赖: xacro, gazebo_ros2_control, ignition-gazebo6
    │
    ├── agv_tools (Python)
    │    依赖: rclpy, agv_msgs
    │
    └── agv_visualization (Python)
         依赖: rclpy
```

### 6.3 与现有项目结构的兼容性说明

当前项目结构 (`/home/qizheng/auto_code_ws/`) 已包含：

- `agv_fleet_ws/` — ROS2 工作空间（已有 12 个包目录）
- `frontend/` — Web 前端（Vue/React）
- `backend/` — 非 ROS 后端（FastAPI）
- `cli_integration/` — CLI 集成工具
- `data/` — 数据存储
- `config/` — 平台配置
- `tests/` — 平台级测试
- `docs/` — 文档
- `hermes_integration/` — 智能体集成

**兼容性策略**：
1. ROS2 相关代码全部位于 `agv_fleet_ws/` 内，不对外部目录产生侵入
2. `agv_api_gateway` 作为 ROS2 ↔ 非 ROS 的桥梁，对接 `backend/` 和 `frontend/`
3. 非 ROS 后端 (`backend/`) 通过 REST API 与 `agv_api_gateway` 通信，不直接操作 ROS2 话题
4. 系统配置集中管理：`agv_fleet_ws/config/` 管理 ROS2 参数，`config/` 管理平台级配置
5. 仿真测试与平台级测试分离：`agv_fleet_ws/tests/` 管理 ROS2 测试，`tests/` 管理平台集成测试

---

## 附录

### A. 关键性能指标对照

| 指标 | 需求值 | 架构设计目标 | 验证方法 |
|------|--------|------------|---------|
| 控制回路周期 | ≤ 50ms | 20Hz (50ms) | ros2 topic hz |
| 感知处理延迟 | ≤ 100ms | 传感器融合 ≤ 80ms | 时间戳记录 |
| 路径规划响应 | ≤ 200ms | A* 重规划 ≤ 150ms | 计时日志 |
| 死锁检测周期 | ≤ 500ms | 400ms | 检测日志 |
| 硬件急停响应 | ≤ 100ms | 硬件通道 ≤ 50ms | 示波器/仿真 |
| 软件急停响应 | ≤ 200ms | 软件路径 ≤ 150ms | 仿真注入 |
| 静态定位精度 | ±3cm | ±2cm (95%) | 仿真真值对比 |
| 动态定位精度 | ±5cm | ±3cm (95%) | 仿真真值对比 |
| 重定位恢复 | ≤ 5s | ≤ 3s | 仿真注入定位丢失 |
| REST API 响应 | P99 ≤ 200ms | P99 ≤ 100ms | 压力测试 |

### B. 不确定项依赖

| # | 不确定项 | 影响的设计决策 | 默认假设值 | 变更影响 |
|---|---------|--------------|-----------|---------|
| 1 | 最大线速度 | 安全区域距离参数 | 1.5 m/s | 调整 safety_params.yaml |
| 2 | 最大角速度 | DWA 参数 | 1.0 rad/s | 调整 local_planner_params.yaml |
| 5 | 通信架构 | DDS 发现模式 | Fast DDS Discovery Server | 切换为 Simple Discovery |
| 6 | 充电策略 | 任务调度逻辑 | 手动换电 | 增加 DockToCharger action |
| 9 | 最大并发 N | 调度算法复杂度 | 10 台 | 调整 fleet_params.yaml |

---

**文档结束**
