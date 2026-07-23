# AGV 多车协同调度与安全协同平台 — 最终架构设计 v3.0

> **文档状态**: 最终版（Final）
> **基于**: 需求文档 v1.0 + 已有架构 v2.0 文档整合 + 代码现状审查
> **评审周期**: 2026-07-01
> **版本**: 3.0

---

## 目录

1. [修订记录与版本对比](#1-修订记录与版本对比)
2. [系统顶层架构](#2-系统顶层架构)
3. [ROS2 节点拓扑](#3-ros2-节点拓扑)
4. [全局接口规范](#4-全局接口规范)
5. [数据流设计](#5-数据流设计)
6. [安全架构](#6-安全架构)
7. [仿真架构](#7-仿真架构)
8. [项目目录结构](#8-项目目录结构)
9. [实现阶段规划](#9-实现阶段规划)
10. [技术决策记录](#10-技术决策记录)
11. [验收标准](#11-验收标准)

---

## 1. 修订记录与版本对比

### 1.1 已有文档冲突分析

| 冲突项 | v2.0 规范架构 (canonical) | v2.0 最终架构设计 (final) | v3.0 决策 |
|--------|---------------------------|---------------------------|------------|
| 控制周期 | 50ms (20Hz) | 100ms (10Hz) | **50ms (20Hz)** — 以需求文档为准 |
| 传感器延迟 | < 20ms | 未明确 | **< 20ms** — 以需求文档为准 |
| 路径规划时限 | < 100ms | < 200ms | **< 100ms** — 以需求文档为准 |
| 拍卖收敛时限 | < 500ms | < 1s | **< 500ms** — 以需求文档为准 |
| AGV 最大速度 | 1.2 m/s | 1.0 m/s | **1.0 m/s** — 以需求文档约束为准 |
| 碰撞制动阈值 | 0.3m | 0.5m | **0.3m** — 以需求文档安全红线为准 |
| 心跳周期 | 5s | 1s | **5s** — 以需求文档为准，实际可配置 |
| 通信超时停车 | 15s | 10s | **15s** — 以需求文档安全红线为准 |
| 安全等级 | SIL-2 参照 | 未明确 | **SIL-2 参照** — 以需求文档为准 |
| 定位精度 | ±5cm | ±10cm | **±5cm** — 以需求文档为准 |
| DWA 局部规划 | 使用 | 未提及 | **使用 DWA** — 以需求文档为准 |
| 消息命名空间 | `agv_` 前缀 | `agv_` 前缀 | 保留现有 `agv_` 前缀，统一风格 |
| 仿真优先策略 | 提及 | 未提及 | **仿真优先** — 以需求文档为准 |

### 1.2 版本变更摘要

- **v1.0** (2026-06 初稿): 初始架构设计
- **v2.0** (2026-06 迭代): 两版并行文档，存在参数冲突
- **v3.0** (本版): 统一参数、整合所有已有代码结构、补充缺失模块

---

## 2. 系统顶层架构

### 2.1 四层架构图

```
+============================================================================+
|  外部集成层 (External Integration Layer)                                    |
|  +----------------------------------+  +-------------------------------+  |
|  |  MES / WMS                       |  |  第三方系统 / Web Dashboard   |  |
|  |  (ERP / 生产执行系统)             |  |  (外部 REST 客户端)           |  |
|  +------------+---------------------+  +--------------+----------------+  |
|               |  MQTT (TLS)                        |  HTTPS (REST)       |
|               v                                     v                     |
|  +----------------------------------------------------------------------+  |
|  |    API 网关 / MQTT Broker (mosquitto)                                 |  |
|  |    - REST API: FastAPI (port 8000)                                    |  |
|  |    - MQTT: mosquitto (port 8883 TLS / 1883 明文)                      |  |
|  |    - WebSocket: 前端实时监控 (port 8000/ws)                            |  |
|  +----------------------------------------------------------------------+  |
+============================================================================+
       |                          |                          |
       | REST API                 | MQTT                     | ROS2 桥接
       v                          v                          v
+============================================================================+
|  中心调度层 (Central Dispatch Layer) — 调度服务器                           |
|                                                                           |
|  +------------------------+  +------------------------+  +---------------+ |
|  | 调度管理器             |  | 交通管制 (Traffic Ctrl)  |  | 状态监控     | |
|  | - 拍卖调度             |  | - 路口锁管理             |  | - AGV 心跳   | |
|  | - 任务队列管理         |  | - 冲突检测               |  | - 实时状态   | |
|  | - 负载均衡             |  | - 路径预留               |  | - 日志聚合   | |
|  +------------------------+  +------------------------+  +---------------+ |
|  +------------------------+  +------------------------+  +---------------+ |
|  | 地图服务               |  | 调度 DB (SQLite)        |  | 告警管理     | |
|  | - YAML 仓库地图加载    |  | - 任务持久化             |  | - 三级故障   | |
|  | - 拓扑图维护           |  | - AGV 注册表            |  | - 通知推送   | |
|  | - 路径代价计算         |  | - 运行日志               |  |              | |
|  +------------------------+  +------------------------+  +---------------+ |
+============================================================================+
       |                          |                          |
       | ROS2 Topic/Service       | ROS2 Action              | ROS2 命名空间
       | /agv_fleet/*             | /agv_fleet/agv_XX/*      | agv_XX
       v                          v                          v
+============================================================================+
|  车载自治层 (Onboard Autonomy Layer) — 每台 AGV 一组节点                    |
|                                                                           |
|  +------------------+  +------------------+  +---------------------------+ |
|  | 导航规划          |  | 运动控制          |  | 安全监控                  | |
|  | - 全局规划 A*/Theta*|  | - PID 控制器     |  | - 双路急停监控            | |
|  | - 局部规划 DWA    |  | - 指令复用器      |  | - 三级故障判定            | |
|  | - 路径跟踪        |  | - 50ms 控制周期   |  | - 速度限幅器              | |
|  +------------------+  +------------------+  +---------------------------+ |
|  +------------------+  +------------------+  +---------------------------+ |
|  | 定位融合          |  | 感知              |  | 车端状态发布              | |
|  | - IMU + 编码器    |  | - 障碍物检测      |  | - 心跳                    | |
|  | - 激光雷达匹配    |  | - 碰撞检测 < 0.3m |  | - 任务执行状态            | |
|  | - EKF 融合        |  | - 点云处理        |  | - 电池/错误上报           | |
|  | (±5cm 精度)       |  |                  |  |                           | |
|  +------------------+  +------------------+  +---------------------------+ |
+============================================================================+
       |                          |                          |
       | ROS2 硬件接口            | Gazebo 插件              | 传感器驱动
       v                          v                          v
+============================================================================+
|  仿真/传感器层 (Simulation & Sensor Layer)                                 |
|                                                                           |
|  +----------------------------------+  +-------------------------------+  |
|  |  Gazebo Fortress 仿真环境        |  |  真实硬件接口层               |  |
|  |  - AGV 模型 (URDF/Xacro)         |  |  - VLP-16 激光雷达驱动        |  |
|  |  - 仓库场景 (货架/充电站/装卸区)  |  |  - BNO055 IMU 驱动            |  |
|  |  - 传感器插件 (激光雷达/IMU/编码器)|  |  - 光电编码器驱动             |  |
|  |  - 可参数化场景生成              |  |  - 电机驱动 (PID 速度环)       |  |
|  |  - 碰撞/物理仿真                |  |  - 急停按钮 (GPIO)             |  |
|  +----------------------------------+  +-------------------------------+  |
+============================================================================+
```

### 2.2 分层职责表

| 层级 | 职责 | 关键技术 | 部署位置 | 语言 |
|------|------|----------|----------|------|
| **外部集成层** | 与 MES/WMS 交互、Web 监控面板、第三方 API | FastAPI, MQTT, WebSocket, React | 中心服务器 | Python, TypeScript |
| **中心调度层** | 任务拍卖调度、交通管制、AGV 状态监控、地图服务、日志 | ROS2 Humble, SQLite, YAML | 中心服务器 | C++, Python |
| **车载自治层** | 路径规划、运动控制、定位融合、感知、安全监控 | ROS2 Humble, EKF, PID, DWA | 每台 AGV 车载计算机 | C++ (核心), Python (辅助) |
| **仿真/传感器层** | Gazebo 仿真、传感器驱动、硬件抽象 | Gazebo Fortress, ROS2 驱动 | 仿真工作站 / AGV 硬件 | C++, Python |

### 2.3 模块间依赖关系

```
+------------------+     依赖       +------------------+
|  地图服务        | ------------> |  调度管理器       |
|  (提供拓扑/代价)  |               |  (依赖地图信息)   |
+------------------+               +--------+---------+
     |                                        |
     | 提供地图数据                            | 下发任务
     v                                        v
+------------------+               +------------------+
|  全局规划器      | <-----------  |  AGV 导航规划     |
|  (A*/Theta*)     |   请求路径     |  (车载端)         |
+------------------+               +--------+---------+
                                            |
                                            | 路径输出
                                            v
+------------------+               +------------------+
|  局部规划器(DWA) | <-----------  |  路径跟踪        |
|  (规避动态障碍)   |   局部目标点   |                  |
+------------------+               +--------+---------+
                                            |
                                            | 速度指令 (Twist)
                                            v
+------------------+               +------------------+
|  安全监控        | <-----------  |  指令复用器      |
|  (速度限幅)      |   安全覆盖     |  (Command Mux)   |
+------------------+               +--------+---------+
                                            |
                                            | 最终速度指令
                                            v
+------------------+               +------------------+
|  感知 (障碍物)   |              |  PID 运动控制器   |
|  (碰撞检测)      |              |  (50ms 周期)      |
+------------------+              +--------+---------+
     |                                      |
     | 障碍物信息                            | 控制输出
     v                                      v
+------------------+               +------------------+
|  定位融合 (EKF)  |              |  电机驱动/仿真   |
|  (IMU+编码器+雷达)|              |                  |
+------------------+               +------------------+
     |
     | 位姿信息 (提供给规划/控制/安全)
     v
  多个消费者

+------------------+               +------------------+
|  交通管制        | <-----------  |  调度管理器      |
|  (路口锁/冲突)   |   路径请求     |                  |
+------------------+               +------------------+
     |
     | 路径段许可/拒绝
     v
  各 AGV 导航规划
```

---

## 3. ROS2 节点拓扑

### 3.1 中心服务器节点清单

| 节点名称 | 包名 | 语言 | 实时性 | 启动顺序 | 职责 |
|----------|------|------|--------|----------|------|
| `dispatch_server` | `agv_fleet` | C++ | 软实时 | 1 | 任务调度、拍卖管理、AGV 注册 |
| `traffic_control` | `agv_fleet` | C++ | 软实时 | 2 (依赖 dispatch) | 路口锁管理、冲突检测、路径预留 |
| `map_server` | `agv_fleet` | C++ | 非实时 | 1 | YAML 地图加载、拓扑维护、代价查询 |
| `fleet_monitor` | `agv_fleet` | Python | 非实时 | 3 (依赖 dispatch) | 心跳监控、状态聚合、告警 |
| `fleet_db` | `agv_fleet` | Python | 非实时 | 2 | SQLite 持久化、日志记录 |
| `bridge_rest_api` | `agv_bridge` | Python | 非实时 | 3 | REST API 端点 → ROS2 桥接 |
| `bridge_mqtt` | `agv_bridge` | Python | 非实时 | 3 | MQTT ↔ ROS2 桥接 |

### 3.2 车载端节点清单 (每 AGV 一组)

每台 AGV 使用命名空间 `/agv_fleet/agv_<id>/` 隔离。

| 节点名称 | 包名 | 语言 | 实时性 | 启动顺序 | 职责 |
|----------|------|------|--------|----------|------|
| `global_planner` | `agv_navigation` | C++ | 软实时 | 2 | A*/Theta* 全局路径规划 |
| `local_planner` | `agv_navigation` | C++ | 软实时 | 2 | DWA 局部避障规划 |
| `path_tracker` | `agv_navigation` | C++ | 硬实时 | 2 | 路径跟踪、目标点生成 |
| `motion_controller` | `agv_control` | C++ | 硬实时 | 3 | PID 控制、50ms 周期、编码器反馈 |
| `command_multiplexer` | `agv_control` | C++ | 硬实时 | 3 | 速度指令仲裁、安全覆盖 |
| `odometry_publisher` | `agv_control` | C++ | 软实时 | 1 | 编码器 → odom |
| `safety_monitor` | `agv_safety` | C++ | 硬实时 | 1 (最高优先级) | 双路急停、故障分级、速度限幅 |
| `collision_detector` | `agv_perception` | C++ | 软实时 | 1 | 激光雷达碰撞检测 < 0.3m |
| `obstacle_detector` | `agv_perception` | C++ | 软实时 | 1 | 点云处理、障碍物发布 |
| `ekf_localizer` | `agv_localization` | C++ | 软实时 | 2 | IMU+编码器+雷达 EKF 融合 |
| `task_executor` | `agv_core` | C++ | 非实时 | 4 (最后) | 任务状态机、Action 服务端 |
| `agv_status` | `agv_core` | C++ | 非实时 | 2 | 心跳发布、状态上报 |
| `battery_monitor` | `agv_core` | C++ | 非实时 | 1 | 电池/电源监控 |

### 3.3 仿真端节点清单

| 节点名称 | 包名 | 语言 | 职责 |
|----------|------|------|------|
| `gazebo_server` | `agv_simulation` | C++ | Gazebo 服务端、世界加载 |
| `spawn_agv` | `agv_simulation` | Python | 参数化 AGV 生成 |
| `scenario_manager` | `agv_simulation` | Python | 场景配置、任务注入 |
| `sensor_plugins` | `agv_simulation` | C++ | Gazebo 传感器插件 (激光雷达/IMU/编码器) |
| `sim_clock` | `agv_simulation` | C++ | 仿真时钟同步 (/clock) |

### 3.4 节点启动依赖顺序

```
        中心服务器                                   车载端
   ==================                          ==============
   Phase 1: 基础设施                           Phase 1: 安全与感知
   +-> map_server                             +-> safety_monitor
   +-> dispatch_server                        +-> collision_detector
       |                                      +-> obstacle_detector
   Phase 2: 服务层                             +-> battery_monitor
   +-> traffic_control  (需 dispatch)         +-> odometry_publisher
   +-> fleet_db                               |
       |                                      Phase 2: 定位与规划
   Phase 3: 桥接层                             +-> ekf_localizer (需 odom)
   +-> bridge_rest_api (需 dispatch)          +-> global_planner (需 map)
   +-> bridge_mqtt     (需 dispatch)          +-> local_planner
   +-> fleet_monitor   (需 dispatch)          +-> path_tracker
       |                                      |
   Phase 4: 就绪                               Phase 3: 控制
   +-> 等待 AGV 注册                           +-> motion_controller (需路径)
       |                                      +-> command_multiplexer
   Phase 5: 可接受任务                          |
                                               Phase 4: 任务执行
                                               +-> task_executor (需全部就绪)
                                               +-> agv_status
```

---

## 4. 全局接口规范

### 4.1 ROS2 Topic 完整清单

所有频率值以需求文档参数为准。

#### 4.1.1 传感器数据 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `*/sensor/scan` | `sensor_msgs/LaserScan` | VLP-16 驱动 | 碰撞检测、障碍物检测、定位 | 10Hz | SensorData |
| `*/sensor/imu` | `sensor_msgs/Imu` | BNO055 驱动 | EKF 定位 | 100Hz | SensorData |
| `*/sensor/encoder` | `agv_msgs/EncoderData` | 编码器驱动 | 里程计发布、EKF 定位 | 50Hz | SensorData |
| `*/sensor/pointcloud` | `sensor_msgs/PointCloud2` | VLP-16 驱动 | 障碍物检测 (高级) | 10Hz | SensorData |
| `*/sensor/battery` | `agv_msgs/BatteryStatus` | 电池监控 | 状态发布、调度 | 1Hz | TransientLocal |

#### 4.1.2 定位 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `*/odom` | `nav_msgs/Odometry` | odometry_publisher | EKF 定位、控制 | 50Hz | SystemDefault |
| `*/ekf/odom` | `nav_msgs/Odometry` | ekf_localizer | 规划器、路径跟踪 | 50Hz | SystemDefault |
| `*/ekf/pose` | `geometry_msgs/PoseWithCovarianceStamped` | ekf_localizer | 监控 | 20Hz | SystemDefault |
| `*/tf` | `tf2_msgs/TFMessage` | 多发布者 | 所有节点 | 50Hz | SystemDefault |
| `*/tf_static` | `tf2_msgs/TFMessage` | robot_state_publisher | 所有节点 | 1Hz | TransientLocal |

#### 4.1.3 规划 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `*/planning/global_path` | `nav_msgs/Path` | global_planner | path_tracker | 1Hz (重规划) | SystemDefault |
| `*/planning/local_path` | `nav_msgs/Path` | local_planner | path_tracker | 20Hz | SystemDefault |
| `*/planning/obstacles` | `agv_msgs/ObstacleArray` | obstacle_detector | local_planner | 20Hz | SensorData |
| `*/planning/collision_warning` | `agv_msgs/CollisionWarning` | collision_detector | command_mux, safety | 20Hz | SystemDefault |

#### 4.1.4 控制 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `*/control/cmd_vel_nav` | `geometry_msgs/Twist` | path_tracker | command_multiplexer | 50ms (20Hz) | SystemDefault |
| `*/control/cmd_vel_safety` | `geometry_msgs/Twist` | safety_monitor | command_multiplexer | 50ms (20Hz) | SystemDefault |
| `*/control/cmd_vel_out` | `geometry_msgs/Twist` | command_multiplexer | motion_controller | 50ms (20Hz) | SystemDefault |
| `*/control/motor_cmd` | `agv_msgs/MotorCommand` | motion_controller | 电机驱动 / Gazebo | 50ms (20Hz) | SystemDefault |
| `*/control/motor_state` | `agv_msgs/MotorState` | 电机驱动 | motion_controller | 50Hz | SystemDefault |

#### 4.1.5 安全 Topic

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `*/safety/emergency_stop` | `agv_msgs/EmergencyStop` | 急停按钮、safety_monitor | command_mux, 调度 | 事件触发 | SystemDefault (高优先级) |
| `*/safety/fault_status` | `agv_msgs/FaultStatus` | safety_monitor | fleet_monitor, 调度 | 事件触发 | TransientLocal |
| `*/safety/speed_limit` | `agv_msgs/SpeedLimit` | safety_monitor | command_multiplexer | 50ms (20Hz) | SystemDefault |
| `*/safety/heartbeat` | `agv_msgs/Heartbeat` | agv_status | fleet_monitor | 5s | SystemDefault |

#### 4.1.6 车队级 Topic (中心调度层)

| Topic 名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|------------|----------|--------|--------|------|-----|
| `/agv_fleet/dispatch/auction_bid` | `agv_msgs/AuctionBid` | 各 AGV task_executor | dispatch_server | 事件触发 | Volatile |
| `/agv_fleet/dispatch/auction_result` | `agv_msgs/AuctionResult` | dispatch_server | 各 AGV task_executor | 事件触发 | Volatile |
| `/agv_fleet/traffic/lock_request` | `agv_msgs/TrafficLockRequest` | AGV 规划器 | traffic_control | 事件触发 | SystemDefault |
| `/agv_fleet/traffic/lock_grant` | `agv_msgs/TrafficLockGrant` | traffic_control | AGV 规划器 | 事件触发 | SystemDefault |
| `/agv_fleet/fleet/status` | `agv_msgs/FleetStatus` | fleet_monitor | bridge_rest_api | 1Hz | TransientLocal |
| `/agv_fleet/fleet/log` | `agv_msgs/FleetLog` | 多发布者 | fleet_db | 事件触发 | Volatile |

### 4.2 ROS2 Service 完整清单

| Service 名称 | 类型 | 服务端 | 客户端 | 说明 |
|-------------|------|--------|--------|------|
| `*/safety/reset_emergency` | `agv_msgs/ResetEmergency` | safety_monitor | 调度/手动 | 复位急停 |
| `*/safety/query_fault` | `agv_msgs/QueryFault` | safety_monitor | fleet_monitor | 查询故障详情 |
| `*/task/query_status` | `agv_msgs/QueryTaskStatus` | task_executor | 调度 | 查询任务状态 |
| `*/task/cancel` | `agv_msgs/CancelTask` | task_executor | 调度 | 取消任务 |
| `/agv_fleet/dispatch/register_agv` | `agv_msgs/RegisterAGV` | dispatch_server | AGV 启动 | AGV 注册 |
| `/agv_fleet/dispatch/unregister_agv` | `agv_msgs/UnregisterAGV` | dispatch_server | AGV 关闭 | AGV 注销 |
| `/agv_fleet/dispatch/query_agv` | `agv_msgs/QueryAGV` | dispatch_server | fleet_monitor | 查询 AGV 信息 |
| `/agv_fleet/map/get_costmap` | `agv_msgs/GetCostmap` | map_server | global_planner | 获取代价地图 |
| `/agv_fleet/map/get_topology` | `agv_msgs/GetTopology` | map_server | dispatch_server | 获取拓扑图 |
| `/agv_fleet/map/shortest_path` | `agv_msgs/ShortestPath` | map_server | global_planner | 最短路径查询 |
| `/agv_fleet/traffic/query_locks` | `agv_msgs/QueryTrafficLocks` | traffic_control | fleet_monitor | 查询路口锁状态 |
| `/agv_fleet/traffic/release_lock` | `agv_msgs/ReleaseLock` | traffic_control | AGV 规划器 | 释放路口锁 |
| `/agv_fleet/fleet/emergency_stop_all` | `agv_msgs/EmergencyStopAll` | dispatch_server | fleet_monitor | 全局急停 |
| `/agv_fleet/fleet/resume_all` | `agv_msgs/ResumeAll` | dispatch_server | fleet_monitor | 全局恢复 |

### 4.3 ROS2 Action 完整清单

#### 4.3.1 `NavigateAction` — 导航到目标点

```
# Goal
string agv_id
geometry_msgs/Pose2D target_pose
uint8 priority           # 0=low, 1=normal, 2=high
bool emergency           # 紧急任务(突破交通管制)
---
# Result
bool success
string message
float32 path_length
float32 execution_time
---
# Feedback
float32 progress         # 0.0 ~ 1.0
float32 remaining_distance
geometry_msgs/Pose2D current_pose
uint8 status             # 0=running, 1=waiting_for_lock, 2=avoiding, 3=paused
```

#### 4.3.2 `ChargeAction` — 自动充电

```
# Goal
string agv_id
---
# Result
bool success
float32 battery_level
---
# Feedback
float32 progress
uint8 phase             # 0=navigating, 1=docking, 2=charging, 3=undocking
```

#### 4.3.3 `DockAction` — 货架/装卸区对接

```
# Goal
string agv_id
string dock_type        # "shelf", "loading", "charging"
string dock_id
---
# Result
bool success
---
# Feedback
float32 progress
float32 distance_to_dock
```

#### 4.3.4 `PatrolAction` — 巡逻/多点任务

```
# Goal
string agv_id
geometry_msgs/Pose2D[] waypoints
uint8 loop_count        # 0 = infinite
---
# Result
bool success
uint32 completed_loops
---
# Feedback
uint32 current_waypoint
float32 progress
```

#### 4.3.5 `ExecuteTaskAction` — 执行复合任务

```
# Goal
string task_id
string task_type         # "transport", "patrol", "charge"
string source
string destination
string payload_id        # 货架/货物 ID
---
# Result
bool success
string fail_reason
---
# Feedback
uint8 phase             # 0=pending, 1=navigating, 2=docking, 3=loading,
                        # 4=navigating_back, 5=undocking, 6=completed
float32 phase_progress
```

### 4.4 REST API 端点

#### 4.4.1 任务管理

| 方法 | 路径 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| POST | `/api/v1/tasks` | 创建任务 | `{task_type, source, destination, payload_id, priority}` | `{task_id, status}` |
| GET | `/api/v1/tasks/{task_id}` | 查询任务 | — | `{task_id, status, agv_id, progress}` |
| DELETE | `/api/v1/tasks/{task_id}` | 取消任务 | — | `{success, message}` |
| GET | `/api/v1/tasks` | 任务列表 | `?status=running&limit=20` | `{tasks: [...], total}` |

#### 4.4.2 AGV 管理

| 方法 | 路径 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/api/v1/agvs` | 所有 AGV 状态 | — | `{agvs: [{id, status, pose, battery, fault}]}` |
| GET | `/api/v1/agvs/{agv_id}` | 单台 AGV 详情 | — | `{id, status, pose, battery, fault, task}` |
| POST | `/api/v1/agvs/{agv_id}/pause` | 暂停 AGV | — | `{success}` |
| POST | `/api/v1/agvs/{agv_id}/resume` | 恢复 AGV | — | `{success}` |
| POST | `/api/v1/agvs/{agv_id}/emergency_stop` | 单台急停 | — | `{success}` |

#### 4.4.3 系统管理

| 方法 | 路径 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/api/v1/system/status` | 系统概览 | — | `{fleet_status, active_tasks, alerts}` |
| GET | `/api/v1/system/alerts` | 告警列表 | `?level=L2&limit=50` | `{alerts: [...]}` |
| POST | `/api/v1/system/emergency_stop_all` | 全局急停 | — | `{success}` |
| POST | `/api/v1/system/resume_all` | 全局恢复 | — | `{success}` |
| GET | `/api/v1/system/metrics` | 性能指标 | — | `{control_latency, ...}` |

#### 4.4.4 地图管理

| 方法 | 路径 | 描述 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/api/v1/map` | 获取地图信息 | — | `{map_name, dimensions, obstacles}` |
| GET | `/api/v1/map/topology` | 拓扑图 | — | `{nodes: [...], edges: [...]}` |
| POST | `/api/v1/map/reload` | 重载地图 | — | `{success}` |

### 4.5 MQTT Topic 设计 (与 MES/WMS 集成)

所有 Topic 使用 MQTT QoS 1，TLS 加密 (port 8883)。

| Topic | 方向 | 负载格式 | 说明 |
|-------|------|----------|------|
| `mes/task/create` | MES → 系统 | `{task_id, type, src, dst, payload, priority}` | MES 下发任务 |
| `mes/task/cancel` | MES → 系统 | `{task_id}` | MES 取消任务 |
| `mes/task/status` | 系统 → MES | `{task_id, status, agv_id, timestamp}` | 任务状态反馈 |
| `mes/agv/status` | 系统 → MES | `{agv_id, status, battery, location}` | AGV 状态上报 |
| `mes/system/alert` | 系统 → MES | `{level, code, message, timestamp}` | 系统告警通知 |
| `mes/system/heartbeat` | 系统 → MES | `{timestamp, status}` | 系统心跳 |
| `wms/inventory/request` | 系统 → WMS | `{shelf_id, location}` | 货架搬运请求 |
| `wms/inventory/response` | WMS → 系统 | `{shelf_id, status, location}` | 货架状态回复 |

---

## 5. 数据流设计

### 5.1 任务下发流程 (API → 调度 → AGV 执行)

```
时序:
1. MES/WMS 通过 MQTT 或 REST API 下发任务
   ├── MQTT: mes/task/create → bridge_mqtt
   └── REST: POST /api/v1/tasks → bridge_rest_api

2. bridge_mqtt/bridge_rest_api 将任务转换为 ROS2 Service 调用
   └── dispatch_server: /agv_fleet/dispatch/task_create (内部 Service)

3. dispatch_server 执行拍卖调度:
   a. 查询 map_server 获取任务路径代价
   b. 查询 traffic_control 获取交通状态
   c. 发布拍卖请求到所有 AGV (AuctionBid Topic)
   d. 收集出价 (各 AGV 根据位置/状态/任务队列出价)
   e. 收敛判断 (时限 < 500ms):
      - 最优 AGV 分配
      - 或等待/重试
   f. 发布拍卖结果 (AuctionResult Topic)

4. 中标 AGV 的 task_executor 接收拍卖结果:
   a. 创建 ExecuteTaskAction 目标
   b. 进入任务状态机: PENDING → NAVIGATING → DOCKING → LOADING → ...

5. task_executor 调用 NavigateAction:
   a. global_planner 请求 map_server 计算全局路径 (A*/Theta*)
   b. global_planner 请求 traffic_control 预留路径段
   c. global_planner 发布 global_path
   d. local_planner 根据 global_path + 实时障碍物生成 local_path (DWA)
   e. path_tracker 跟踪 local_path 输出 cmd_vel_nav

6. motion_controller 通过 command_multiplexer 获取最终速度指令:
   a. cmd_vel_nav (导航指令)
   b. cmd_vel_safety (安全覆盖, 可能限幅或置零)
   c. command_multiplexer 仲裁 → cmd_vel_out
   d. PID 控制器 → motor_cmd → 电机

7. 任务完成后:
   a. task_executor 通过 AuctionBid Topic 回报任务完成
   b. dispatch_server 更新任务状态
   c. bridge 层转发给 MES/WMS

延迟约束:
  - 拍卖收敛: < 500ms
  - 路径规划: < 100ms (全局), < 50ms (局部)
  - 控制周期: 50ms
```

### 5.2 实时控制数据流 (传感器 → 定位 → 规划 → 控制)

```
传感器输入层 (延迟 < 20ms)
  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
  │ VLP-16 雷达 │  │ BNO055 IMU │  │ 光电编码器    │
  │ 10Hz /scan  │  │ 100Hz /imu │  │ 50Hz /encoder│
  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘
         │                │                │
         v                v                v
  ┌──────────────┐       │                │
  │ 障碍物检测     │       │                │
  │ (10Hz)        │       │                │
  │ 碰撞检测 <0.3m│       │                │
  └──────┬───────┘       │                │
         │               v                v
         │        ┌──────────────────────────┐
         │        │  EKF 定位融合              │
         │        │  (IMU + 编码器 + 雷达)     │
         │        │  ±5cm 精度, 50Hz 输出     │
         │        └───────────┬──────────────┘
         │                    │ /ekf/odom
         v                    v
  ┌──────────────┐   ┌────────────────┐
  │ DWA 局部规划  │   │ 路径跟踪        │
  │ (20Hz)       │   │ (20Hz)         │
  │ 规避动态障碍  │   │ 生成 cmd_vel   │
  └──────┬───────┘   └───────┬────────┘
         │                   │
         v                   v
  ┌──────────────────────────────┐
  │  指令复用器 (Command Mux)     │
  │  输入: cmd_vel_nav (导航)     │
  │        cmd_vel_safety (安全)  │
  │  仲裁规则: 安全指令 > 导航    │
  │  输出: cmd_vel_out (20Hz)    │
  └──────────────┬───────────────┘
                 │
                 v
  ┌──────────────────────────────┐
  │  PID 运动控制器 (50ms 周期)   │
  │  左/右轮 PID 独立计算         │
  │  输出: motor_cmd             │
  └──────────────┬───────────────┘
                 │
                 v
  ┌──────────────────────────────┐
  │  电机驱动 / Gazebo 仿真       │
  └──────────────────────────────┘

延迟标注:
  sensor → EKF:      < 20ms (需求约束)
  EKF → planner:     < 5ms   (进程内 Topic)
  planner → mux:     < 5ms
  mux → controller:  < 2ms
  controller → motor: < 1ms
  总闭环延迟:         < 50ms (控制周期需求)
```

### 5.3 安全数据流 (独立冗余路径)

```
安全触发源:
  ┌────────────┐  ┌────────────┐  ┌──────────────┐
  │ 硬件急停按钮 │  │ 碰撞检测    │  │ 通信超时检测  │
  │ (GPIO 中断) │  │ (< 0.3m)  │  │ (15s 无心跳) │
  └──────┬─────┘  └──────┬─────┘  └──────┬───────┘
         │               │               │
         v               v               v
  ┌───────────────────────────────────────────┐
  │          safety_monitor                    │
  │  冗余双通道设计:                            │
  │  通道 A: GPIO 直接急停 → 硬件断电            │
  │  通道 B: 软件急停 → 速度限幅 → cmd_vel_safety│
  ├───────────────────────────────────────────┤
  │  三级故障分类:                              │
  │  L1 (警告): 轻微偏离、短暂通信延迟            │
  │  L2 (可恢复): 定位丢失、局部障碍、电池低       │
  │  L3 (致命): 碰撞、硬件故障、通信超时 15s      │
  └──────┬────────────────────────────────────┘
         │
         ├─────────────────────► command_multiplexer
         │  通道 B: cmd_vel_safety (限幅/置零)
         │
         ├─────────────────────► dispatch_server
         │  L3: 通知调度 -> 任务重分配
         │
         ├─────────────────────► fleet_monitor
         │  告警推送 -> REST/MQTT -> UI/MES
         │
         └─────────────────────► 硬件急停继电器
           通道 A: GPIO 直连 (硬件限幅不可逾越)

速度限幅链路:
  1. 硬件限幅 (电机驱动器): 绝对不可逾越的物理限制
  2. 安全监控限幅 (safety_monitor → cmd_vel_safety):
     - 正常: 1.0 m/s max
     - 接近障碍物 (>0.3m, <0.5m): 0.3 m/s 限幅
     - 碰撞预警 (<0.3m): 0 m/s (紧急制动)
     - 定位丢失: 0 m/s
     - 通信超时: 0 m/s
  3. 导航限幅 (path_tracker → cmd_vel_nav):
     - 基于路径曲率自适应限幅
```

---

## 6. 安全架构

### 6.1 双路急停架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      双通道急停架构                               │
│                                                                 │
│  通道 A (硬件直连):                                              │
│  ┌──────────┐    ┌──────────┐    ┌────────────────────────┐    │
│  │ 急停按钮  │───►│ GPIO 中断 │───►│ 电机驱动器硬件使能引脚   │    │
│  │ (物理)   │    │ 优先级 IRQ │    │ (硬件切断电机电源)      │    │
│  └──────────┘    └──────────┘    └────────────────────────┘    │
│  响应时间: < 10ms (硬件级)                                      │
│                                                                 │
│  通道 B (软件冗余):                                              │
│  ┌──────────┐    ┌────────────────┐    ┌──────────────────┐    │
│  │ 急停按钮  │───►│ safety_monitor │───►│ command_mux      │    │
│  │ (GPIO)   │    │ (检测+判定)     │    │ (速度置零)        │    │
│  └──────────┘    └────────────────┘    └──────────────────┘    │
│  ┌──────────┐         │                                         │
│  │ 碰撞检测  │─────────┘                                         │
│  │ (<0.3m)  │                                                    │
│  └──────────┘                                                    │
│  ┌──────────┐                                                    │
│  │ 通信超时  │───► safety_monitor ──► 判定 L3 → 停车              │
│  │ (15s)    │                                                    │
│  └──────────┘                                                    │
│  响应时间: < 50ms (一个控制周期)                                   │
│                                                                 │
│  恢复流程:                                                        │
│  1. 物理急停恢复: 旋转按钮复位                                    │
│  2. 软件复位: /safety/reset_emergency Service                     │
│  3. 确认安全后: 调度下发 resume 指令                               │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 三层速度限幅机制

| 层级 | 实现位置 | 限幅值 | 不可逾越性 | 说明 |
|------|----------|--------|-----------|------|
| L1: 硬件限幅 | 电机驱动器 (固件) | 1.2 m/s (略高于需求) | **绝对不可逾越** | 驱动器参数锁定，防止固件异常 |
| L2: 安全监控限幅 | safety_monitor → cmd_vel_safety | 见下方状态表 | 软件层最高优先级 | 根据安全状态动态调整 |
| L3: 导航限幅 | path_tracker → cmd_vel_nav | 0.8 m/s (正常) | 可被 L2 覆盖 | 基于曲率和任务优先级 |

**L2 安全监控限幅状态表:**

| 状态 | 触发条件 | 最大速度 | 加速度 | 动作 |
|------|---------|---------|--------|------|
| 正常 | 无异常 | 1.0 m/s | 1.0 m/s² | 正常执行 |
| 接近障碍 | 0.3m < 距离 < 0.5m | 0.3 m/s | 0.3 m/s² | 减速接近 |
| 碰撞预警 | 距离 < 0.3m | 0.0 m/s | 紧急制动 | 立即停车，L3 故障 |
| 定位丢失 | 定位协方差 > 阈值 | 0.0 m/s | 紧急制动 | 停车等待恢复，L2 故障 |
| 通信超时 | 15s 无心跳 | 0.0 m/s | 紧急制动 | 停车，L3 故障 |
| 电池低 | 电量 < 15% | 0.5 m/s | 0.5 m/s² | 返回充电站 |
| 急停按下 | GPIO 中断 | 0.0 m/s | 立即 | 硬件+软件双通道停车 |

### 6.3 安全触发条件矩阵

| 触发事件 | 检测方式 | 故障等级 | 响应动作 | 恢复方式 |
|---------|---------|---------|---------|---------|
| 碰撞距离 < 0.3m | 激光雷达 | L3 (致命) | 紧急制动、停车、通知调度 | 人工检查后复位 |
| 碰撞距离 0.3-0.5m | 激光雷达 | L2 (可恢复) | 减速、规避 | 障碍移除后自动恢复 |
| 通信超时 15s | 心跳缺失 | L3 (致命) | 停车、标记离线 | 网络恢复后重连 |
| 定位协方差超限 | EKF | L2 (可恢复) | 停车、尝试重定位 | 重定位成功恢复 |
| 电机过流 | 驱动器反馈 | L3 (致命) | 切断电源、停车 | 硬件检查后复位 |
| 电池 < 15% | BMS | L2 (可恢复) | 强制返回充电站 | 充电后恢复 |
| 电池 < 5% | BMS | L3 (致命) | 立即停车、告警 | 人工干预 |
| IMU 数据异常 | 自检 | L2 (可恢复) | 降级使用编码器+雷达 | 传感器恢复后重启 |
| 编码器数据异常 | 自检 | L2 (可恢复) | 降级使用 IMU+雷达 | 传感器恢复后重启 |
| 激光雷达数据异常 | 自检 | L1 (警告) | 减速、纯里程计导航 | 传感器恢复后自动恢复 |
| 路径规划超时 > 100ms | 规划器自检 | L1 (警告) | 使用上一有效路径 | 下次规划成功恢复 |
| 控制周期偏差 > 10ms | 控制器自检 | L1 (警告) | 记录日志、尝试恢复 | 周期恢复后清除 |
| MQTT 断连 | 桥接检测 | L2 (可恢复) | 缓存任务、重试连接 | 重连成功后恢复 |

### 6.4 通信故障降级策略

| 故障场景 | 降级策略 | 恢复策略 |
|---------|---------|---------|
| 中心调度 MQTT 断连 | AGV 继续执行当前任务，完成后原地等待；不接受新任务 | 自动重连 (3 次)，成功后同步状态 |
| 中心调度 ROS2 断连 | AGV 继续执行当前任务，心跳超时 15s 后停车 | 自动重连，成功后同步状态 |
| AGV 端 ROS2 节点崩溃 | safety_monitor 检测到心跳缺失，触发 L3 停车 | 节点重启后重新注册 |
| MES/WMS MQTT 断连 | 系统缓存任务，队列最多 100 个 | 自动重连 (3 次)，成功后同步 |
| 数据库写入失败 | 内存缓存，异步重试 3 次 | 写入成功或告警通知 |

### 6.5 实时代码约束

**禁止操作 (硬实时节点: motion_controller, command_multiplexer, safety_monitor):**
- 禁止在控制循环内使用 `new`/`delete` (堆内存分配)
- 禁止使用 `std::cout`/`printf` 等同步 I/O
- 禁止使用 `std::thread::sleep` (使用定时器回调)
- 禁止使用 `std::mutex` 阻塞等待 (使用 lock-free 结构)
- 禁止在回调内调用 ROS2 Service 同步等待
- 禁止动态加载/卸载插件

**允许操作 (硬实时节点):**
- 预分配内存 (构造函数中完成)
- 固定大小数组/vector (reserve 后不扩容)
- 整数运算、位操作
- `rclcpp::spin_some()` (非阻塞)
- 读取 `rclcpp::Time::now()` (用于计时)
- 使用预分配的 `sensor_msgs::msg::LaserScan` 等消息对象 (复用内存)

---

## 7. 仿真架构

### 7.1 Gazebo 世界规格

| 参数 | 值 | 说明 |
|------|-----|------|
| 仿真引擎 | Gazebo Fortress (Gazebo Ignition) | 与 ROS2 Humble 兼容 |
| 世界尺寸 | 50m x 30m | 标准仓库场景 |
| 地面 | 平坦混凝土地面 | friction=0.8, restitution=0.1 |
| 光照 | 仓库顶灯阵列 | 4 排 LED 灯 |
| 货架区 | 3 排 x 10 列，双面货架 | 间距 2.5m |
| 充电站 | 4 个 | 靠墙分布 |
| 装卸区 | 2 个 | 仓库两端 |
| 障碍物 | 随机放置的托盘/箱子 | 可配置 |
| 最大 AGV 数 | 10 台 | 可配置 |

### 7.2 传感器插件配置

| 传感器 | Gazebo 插件 | 更新率 | 噪声模型 | 参数 |
|--------|------------|--------|---------|------|
| VLP-16 激光雷达 | `ignition::gazebo::systems::GpuLidarSensor` | 10Hz | Gaussian | range=100m, samples=360, angle=-180~180, resolution=16 线 |
| IMU (BNO055) | `ignition::gazebo::systems::Imu` | 100Hz | Gaussian + 偏置 | noise_stddev=0.01, bias_stddev=0.001 |
| 编码器 | 自定义插件 `EncoderPlugin` | 50Hz | Gaussian | ticks_per_m=1000, noise_stddev=0.005 |
| 碰撞 | `ignition::gazebo::systems::ContactSensor` | 事件触发 | — | contact_threshold=0.1N |

### 7.3 AGV URDF 模型结构

```
agv_<type>.xacro
├── 基础参数: 尺寸、轮距、重量、颜色 (从 YAML 加载)
├── base_footprint → base_link
├── base_link
│   ├── 底盘 (box)
│   ├── 左轮 (cylinder) + 连续碰撞
│   │   ├── left_wheel_link
│   │   └── left_wheel_joint (continuous)
│   ├── 右轮 (cylinder) + 连续碰撞
│   │   ├── right_wheel_link
│   │   └── right_wheel_joint (continuous)
│   ├── 万向轮 x2 (sphere)
│   │   ├── caster_xx_link
│   │   └── caster_xx_joint (fixed)
│   ├── VLP-16 激光雷达
│   │   ├── laser_link
│   │   └── laser_joint (fixed)
│   ├── IMU
│   │   ├── imu_link
│   │   └── imu_joint (fixed)
│   └── 货架/负载 (可选)
│       ├── payload_link
│       └── payload_joint (fixed)
└── 碰撞检测配置
    ├── base_footprint 碰撞区域 (安全缓冲区)
    └── 传感器视野遮挡检查

可参数化参数 (来自 YAML):
  chassis_length, chassis_width, chassis_height
  wheel_radius, wheel_separation
  max_velocity, max_acceleration
  payload_mass, total_mass
  laser_height, laser_range
```

### 7.4 仿真与真实代码复用策略

```
代码复用层次:
┌──────────────────────────────────────────────────────────┐
│  仿真/真实共用代码 (无修改直接运行)                         │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ agv_msgs (消息)  │  │ agv_core     │  │ agv_control │  │
│  │                 │  │ (类型/常量)   │  │ (PID/复用器)│  │
│  └─────────────────┘  └──────────────┘  └────────────┘  │
│  ┌─────────────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ agv_navigation   │  │ agv_safety   │  │ agv_fleet   │  │
│  │ (规划)          │  │ (安全监控)    │  │ (调度)      │  │
│  └─────────────────┘  └──────────────┘  └────────────┘  │
│  ┌─────────────────┐  ┌──────────────┐                   │
│  │ agv_perception   │  │ agv_localization│                │
│  │ (感知算法)       │  │ (EKF 融合)   │                   │
│  └─────────────────┘  └──────────────┘                   │
├──────────────────────────────────────────────────────────┤
│  仿真特有代码                                             │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │ agv_simulation        │  │ Gazebo 插件             │  │
│  │ (URDF/World/场景)     │  │ (传感器/编码器)          │  │
│  └──────────────────────┘  └──────────────────────────┘  │
├──────────────────────────────────────────────────────────┤
│  真实硬件特有代码                                         │
│  ┌──────────────────────┐  ┌──────────────────────────┐  │
│  │ 硬件驱动包            │  │ 电机驱动节点              │  │
│  │ (激光雷达/IMU/编码器)  │  │ (PID 速度环, 急停 GPIO)  │  │
│  └──────────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────┘

仿真优先策略:
  Phase 0-3: 纯仿真开发与验证
  Phase 4: 仿真 + 单台真实 AGV 混合测试
  Phase 5: 多台真实 AGV 测试 (仿真并行)
  Phase 6: 生产部署 (仿真用于回归)

  - 所有核心算法先在仿真中验证通过
  - 仿真环境 CI 自动运行 (每 PR)
  - 真实硬件回归测试前必先过仿真
```

---

## 8. 项目目录结构

### 8.1 完整 ROS2 Workspace 目录树

```
agv_fleet_ws/
├── src/
│   ├── agv_msgs/                          # 消息/服务/动作定义 (已实现)
│   │   ├── msg/
│   │   │   ├── AuctionBid.msg
│   │   │   ├── AuctionResult.msg
│   │   │   ├── BatteryStatus.msg
│   │   │   ├── CollisionWarning.msg
│   │   │   ├── EncoderData.msg
│   │   │   ├── EmergencyStop.msg
│   │   │   ├── FaultStatus.msg
│   │   │   ├── FleetLog.msg
│   │   │   ├── FleetStatus.msg
│   │   │   ├── Heartbeat.msg
│   │   │   ├── MotorCommand.msg
│   │   │   ├── MotorState.msg
│   │   │   ├── ObstacleArray.msg
│   │   │   ├── SpeedLimit.msg
│   │   │   └── TrafficLock*.msg
│   │   ├── srv/
│   │   │   ├── CancelTask.srv
│   │   │   ├── EmergencyStopAll.srv
│   │   │   ├── GetCostmap.srv
│   │   │   ├── GetTopology.srv
│   │   │   ├── QueryAGV.srv
│   │   │   ├── QueryFault.srv
│   │   │   ├── QueryTaskStatus.srv
│   │   │   ├── QueryTrafficLocks.srv
│   │   │   ├── RegisterAGV.srv
│   │   │   ├── ReleaseLock.srv
│   │   │   ├── ResetEmergency.srv
│   │   │   ├── ResumeAll.srv
│   │   │   ├── ShortestPath.srv
│   │   │   └── UnregisterAGV.srv
│   │   ├── action/
│   │   │   ├── Navigate.action
│   │   │   ├── Charge.action
│   │   │   ├── Dock.action
│   │   │   ├── Patrol.action
│   │   │   └── ExecuteTask.action
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_core/                          # 核心库 (已实现)
│   │   ├── include/agv_core/
│   │   │   ├── constants.hpp              # 系统常量
│   │   │   ├── types.hpp                  # 核心类型定义
│   │   │   └── utils.hpp                  # 工具函数
│   │   ├── src/
│   │   │   ├── agv_status_node.cpp        # 状态发布节点 (部分实现)
│   │   │   ├── battery_monitor_node.cpp   # 电池监控节点 (部分实现)
│   │   │   └── task_executor_node.cpp     # 任务执行节点 (待实现)
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_control/                       # 运动控制 (已实现)
│   │   ├── include/agv_control/
│   │   │   ├── motion_controller.hpp      # PID 控制器
│   │   │   ├── command_multiplexer.hpp    # 指令复用器
│   │   │   └── odometry_publisher.hpp     # 里程计发布
│   │   ├── src/
│   │   │   ├── motion_controller.cpp      # PID 控制实现
│   │   │   ├── command_multiplexer.cpp    # 指令仲裁实现
│   │   │   └── odometry_publisher.cpp     # 里程计发布实现
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_navigation/                    # 路径规划 (待实现)
│   │   ├── include/agv_navigation/
│   │   │   ├── global_planner.hpp         # A*/Theta* 全局规划
│   │   │   ├── local_planner.hpp          # DWA 局部规划
│   │   │   └── path_tracker.hpp           # 路径跟踪
│   │   ├── src/
│   │   │   ├── global_planner_node.cpp
│   │   │   ├── local_planner_node.cpp
│   │   │   └── path_tracker_node.cpp
│   │   ├── config/
│   │   │   ├── global_planner_params.yaml
│   │   │   └── local_planner_params.yaml
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_perception/                    # 感知 (待实现)
│   │   ├── include/agv_perception/
│   │   │   ├── collision_detector.hpp     # 碰撞检测 < 0.3m
│   │   │   └── obstacle_detector.hpp      # 障碍物检测
│   │   ├── src/
│   │   │   ├── collision_detector_node.cpp
│   │   │   └── obstacle_detector_node.cpp
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_localization/                  # 定位融合 (待实现)
│   │   ├── include/agv_localization/
│   │   │   └── ekf_localizer.hpp          # EKF 融合
│   │   ├── src/
│   │   │   └── ekf_localizer_node.cpp
│   │   ├── config/
│   │   │   └── ekf_params.yaml
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_safety/                        # 安全监控 (待实现)
│   │   ├── include/agv_safety/
│   │   │   └── safety_monitor.hpp         # 安全监控
│   │   ├── src/
│   │   │   └── safety_monitor_node.cpp
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_fleet/                         # 中心调度 (待实现)
│   │   ├── include/agv_fleet/
│   │   │   ├── dispatch_server.hpp        # 拍卖调度
│   │   │   ├── traffic_control.hpp        # 交通管制
│   │   │   ├── map_server.hpp             # 地图服务
│   │   │   ├── fleet_monitor.hpp          # 状态监控
│   │   │   └── fleet_db.hpp               # 数据库
│   │   ├── src/
│   │   │   ├── dispatch_server_node.cpp
│   │   │   ├── traffic_control_node.cpp
│   │   │   ├── map_server_node.cpp
│   │   │   ├── fleet_monitor_node.py      # Python 辅助
│   │   │   └── fleet_db_node.py           # Python 辅助
│   │   ├── config/
│   │   │   └── dispatch_params.yaml
│   │   ├── launch/
│   │   │   ├── fleet_center.launch.py     # 中心服务器启动
│   │   │   └── fleet_center_params.yaml
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   ├── agv_bridge/                        # 桥接层 (待实现)
│   │   ├── src/
│   │   │   ├── bridge_rest_api.py         # REST → ROS2
│   │   │   └── bridge_mqtt.py             # MQTT → ROS2
│   │   ├── CMakeLists.txt (或 setup.py)
│   │   └── package.xml
│   │
│   ├── agv_simulation/                    # 仿真 (已有部分实现)
│   │   ├── urdf/
│   │   │   ├── agv.urdf.xacro             # AGV URDF 模板
│   │   │   └── agv_config.xacro           # 参数化宏
│   │   ├── worlds/
│   │   │   ├── warehouse.world            # 仓库世界
│   │   │   └── empty.world                # 空世界 (测试用)
│   │   ├── models/
│   │   │   ├── shelf/                     # 货架模型
│   │   │   ├── charging_station/          # 充电站模型
│   │   │   └── loading_dock/              # 装卸区模型
│   │   ├── config/
│   │   │   └── scenario_params.yaml       # 场景参数
│   │   ├── launch/
│   │   │   ├── sim_bringup.launch.py      # 仿真启动
│   │   │   └── spawn_agv.launch.py        # AGV 生成
│   │   ├── src/
│   │   │   ├── scenario_manager.py        # 场景管理
│   │   │   └── spawn_agv.py               # AGV 生成脚本
│   │   ├── CMakeLists.txt
│   │   └── package.xml
│   │
│   └── agv_drivers/                       # 硬件驱动 (待实现, 后期)
│       ├── include/agv_drivers/
│       │   ├── vlp16_driver.hpp
│       │   ├── bno055_driver.hpp
│       │   └── encoder_driver.hpp
│       ├── src/
│       │   ├── vlp16_driver_node.cpp
│       │   ├── bno055_driver_node.cpp
│       │   └── encoder_driver_node.cpp
│       ├── CMakeLists.txt
│       └── package.xml
│
├── maps/                                  # 仓库地图
│   ├── warehouse.yaml                     # YAML 地图定义
│   └── warehouse.pgm                      # 占用栅格图 (可选)
│
└── config/                                # 全局配置 (已存在，复制到各包)
    └── ... → 参见 8.2 配置清单
```

### 8.2 配置清单 (`config/` 目录)

| 配置文件 | 用途 | 关键参数 |
|---------|------|---------|
| `fleet_config.yaml` | 车队级配置 | max_agv=10, auction_timeout=500ms, heartbeat=5s |
| `agv_config.yaml` | AGV 物理参数 | max_speed=1.0, max_accel=1.0, wheel_sep, wheel_radius |
| `control_config.yaml` | PID 参数 | kp=0.8, ki=0.1, kd=0.05, period_ms=50 |
| `planning_config.yaml` | 规划参数 | astar_heuristic, dwa_params, time_horizon |
| `perception_config.yaml` | 感知参数 | collision_threshold=0.3, obstacle_radius |
| `localization_config.yaml` | 定位参数 | ekf_freq=50, imu_noise, encoder_noise |
| `safety_config.yaml` | 安全参数 | speed_limits, fault_levels, timeouts |
| `simulation_config.yaml` | 仿真参数 | world_size, num_agvs, sensor_noise |
| `network_config.yaml` | 网络配置 | ros_domain_id, mqtt_host, mqtt_port |
| `mqtt_config.yaml` | MQTT 配置 | broker=localhost, port=8883, tls=true |
| `task_config.yaml` | 任务参数 | max_retry=3, timeout_ms |

---

## 9. 实现阶段规划

### Phase 0: 基础设施搭建 (Week 1)

**任务:**
- 安装 ROS2 Humble + Gazebo Fortress
- 创建工作空间 `agv_fleet_ws`，编译现有 `agv_msgs`、`agv_core`、`agv_control`
- 配置 colcon 构建系统
- 搭建 FastAPI 后端骨架 (已有)
- 搭建 React 前端骨架 (已有)
- 验证 YAML 配置文件加载机制

**验收标准:**
- `colcon build` 成功，`agv_msgs` 所有消息/服务/动作可编译
- `agv_core` 常量/类型/工具可链接
- `agv_control` PID 控制器可编译，单元测试通过
- FastAPI 服务可启动，返回 200
- React 前端可渲染基本页面

### Phase 1: 仿真环境与 AGV 模型 (Week 2)

**任务:**
- 完成 `agv_simulation` 包
  - 创建仓库世界 (world 文件)
  - 完成 AGV URDF/Xacro 模型 (差速轮式)
  - 货架、充电站、装卸区模型
- 完成 Gazebo 传感器插件配置 (激光雷达/IMU/编码器)
- 实现 `spawn_agv` 脚本 (参数化生成)
- 实现 `scenario_manager` 基础功能

**验收标准:**
- Gazebo 可加载仓库世界，显示货架/充电站/装卸区
- 可生成 1 台 AGV，在 Gazebo 中显示完整模型
- 激光雷达/IMU/编码器 Topic 有数据输出
- 可通过参数配置 AGV 数量 (1-10)

### Phase 2: 感知与定位 (Week 3)

**任务:**
- 实现 `agv_perception` 包
  - `collision_detector`: 激光雷达碰撞检测 < 0.3m
  - `obstacle_detector`: 点云处理、障碍物发布
- 实现 `agv_localization` 包
  - `ekf_localizer`: IMU + 编码器 + 激光雷达 EKF 融合
- 实现 `agv_core/battery_monitor` 节点
- 单元测试与仿真验证

**验收标准:**
- 碰撞检测在 < 0.3m 时触发警告 (仿真验证)
- 障碍物检测可识别仿真中的静态/动态障碍
- EKF 定位精度在仿真中达到 ±5cm
- 所有传感器数据符合延迟约束 (< 20ms)

### Phase 3: 导航与控制 (Week 4)

**任务:**
- 实现 `agv_navigation` 包
  - `global_planner`: A*/Theta* 全局路径规划
  - `local_planner`: DWA 局部规划
  - `path_tracker`: 路径跟踪
- 完善 `agv_control` 包
  - PID 控制器调参 (50ms 周期验证)
  - `command_multiplexer` 指令仲裁逻辑
  - `odometry_publisher` 完善
- 集成测试: 单台 AGV 从 A 到 B 导航

**验收标准:**
- 全局路径规划 < 100ms (仿真中 50x30m 地图)
- DWA 局部规划可规避静态障碍
- PID 控制器 50ms 周期稳定运行
- 单台 AGV 可在仿真中完成点到点导航
- 路径跟踪误差 < 10cm

### Phase 4: 安全系统与多车调度 (Week 5)

**任务:**
- 实现 `agv_safety` 包
  - `safety_monitor`: 双路急停、三级故障、速度限幅
- 实现 `agv_fleet` 包
  - `dispatch_server`: 拍卖调度
  - `traffic_control`: 路口锁/冲突检测
  - `map_server`: YAML 地图服务
  - `fleet_monitor`: 心跳/状态监控
  - `fleet_db`: SQLite 持久化
- 实现 `agv_core/task_executor` 任务状态机
- 集成测试: 多台 AGV (3-5 台) 协同导航

**验收标准:**
- 拍卖调度收敛 < 500ms
- 交通管制避免路径冲突 (多 AGV 交叉)
- 安全监控在碰撞/超时/定位丢失时正确响应
- 三级故障分类正确触发
- 多台 AGV 无碰撞协同运行

### Phase 5: 桥接层与外部集成 (Week 6)

**任务:**
- 实现 `agv_bridge` 包
  - `bridge_rest_api`: 完整 REST API 端点
  - `bridge_mqtt`: MQTT ↔ ROS2 桥接
- 完善 FastAPI 后端
  - 完整 REST 端点 (任务/AGV/系统/地图)
  - WebSocket 实时推送
  - SQLite 集成
- 完善 React 前端
  - 实时监控面板
  - 任务管理界面
  - AGV 状态可视化
  - 告警列表
- 集成 MQTT Broker (mosquitto) 配置

**验收标准:**
- REST API 所有端点可用，返回正确数据
- MQTT 桥接可接收/发送 MES/WMS 格式消息
- Web 前端实时显示 AGV 状态和位置
- 可通过前端创建/取消/查看任务
- MQTT TLS 加密配置正确

### Phase 6: 测试、调优与部署 (Week 7)

**任务:**
- 系统集成测试 (仿真 + 后端 + 前端)
- 性能调优
  - 控制周期 50ms 验证
  - 传感器延迟 < 20ms 验证
  - 路径规划 < 100ms 验证
  - 拍卖收敛 < 500ms 验证
- 安全测试
  - 碰撞紧急制动测试
  - 通信超时测试
  - 三级故障测试
  - 双路急停测试
- 负载测试 (10 台 AGV 满负载)
- 文档完善
- CI/CD 流水线配置

**验收标准:**
- 所有性能指标满足需求文档
- 安全红线全部验证通过
- 10 台 AGV 仿真稳定运行 1 小时以上
- CI 流水线自动化测试通过
- 部署文档完整

---

## 10. 技术决策记录

### ADR-001: 消息框架 — ROS2 Humble

| 项目 | 内容 |
|------|------|
| **决策** | 使用 ROS2 Humble 作为机器人通信框架 |
| **备选方案** | ROS1 Noetic, 自定义 ZeroMQ 通信, ROS2 Iron |
| **理由** | ROS2 Humble 是 Ubuntu 22.04 原生支持的最新 LTS 版本；DDS 内置支持实时性 QoS；与 Gazebo Fortress 兼容；生态成熟 |
| **代价** | 学习成本高于 ROS1；DDS 调试工具较少 |

### ADR-002: 全局路径规划 — A* 与 Theta*

| 项目 | 内容 |
|------|------|
| **决策** | 主算法 A*，Theta* 作为可选升级 |
| **备选方案** | Dijkstra, RRT*, Hybrid A* |
| **理由** | A* 在有向拓扑图上 < 100ms 性能保证；Theta* 可在不增加网格密度的情况下实现更平滑路径；RRT* 在高维空间有优势但不适合结构化仓库 |
| **代价** | Theta* 实现复杂度略高于 A* |

### ADR-003: 局部规划 — DWA

| 项目 | 内容 |
|------|------|
| **决策** | 使用 DWA (Dynamic Window Approach) 作为局部避障规划器 |
| **备选方案** | TEB (Timed Elastic Band), MPC |
| **理由** | DWA 计算量低 (< 50ms)，适合差速轮式机器人；TEB 在高动态环境更好但计算量更大；MPC 需要精确动力学模型且计算昂贵 |
| **代价** | DWA 在复杂动态场景中不如 TEB 平滑 |

### ADR-004: 定位融合 — EKF

| 项目 | 内容 |
|------|------|
| **决策** | 使用 EKF (robot_localization 或自定义) 融合 IMU + 编码器 + 激光雷达 |
| **备选方案** | UKF, 粒子滤波, ICP 匹配 |
| **理由** | EKF 在 ±5cm 精度需求下计算量合适；robot_localization 是 ROS2 成熟包；UKF 精度更高但计算量更大；粒子滤波适合全局定位但计算昂贵 |
| **代价** | EKF 在非线性强场景中不如 UKF 精确 |

### ADR-005: 调度算法 — 分布式拍卖

| 项目 | 内容 |
|------|------|
| **决策** | 基于合同网协议 (CNP) 的分布式拍卖调度 |
| **备选方案** | 集中式匈牙利算法, 遗传算法, 强化学习 |
| **理由** | 拍卖收敛 < 500ms 需求；分布式架构无单点瓶颈；合同网协议成熟且实现简单；匈牙利算法 O(n³) 在大数量时可能超时 |
| **代价** | 拍卖通信开销；需要心跳保活机制 |

### ADR-006: 后端框架 — FastAPI

| 项目 | 内容 |
|------|------|
| **决策** | 使用 FastAPI (Python) 作为 REST API 后端 |
| **备选方案** | Flask, Django, Node.js Express |
| **理由** | FastAPI 异步支持好，与 ROS2 Python 生态集成方便；自动 OpenAPI 文档生成；性能优于 Flask |
| **代价** | 无原生 WebSocket 支持 (需 uvicorn + websocket) |

### ADR-007: 数据库 — SQLite

| 项目 | 内容 |
|------|------|
| **决策** | 使用 SQLite 作为调度持久化存储 |
| **备选方案** | PostgreSQL, MySQL, InfluxDB (时序) |
| **理由** | SQLite 零配置，嵌入式中型车队足够 (10 台 AGV)；PostgreSQL 功能过剩；InfluxDB 适用于大量时序数据但本系统规模不大 |
| **代价** | SQLite 不支持并发写，需加锁机制 |

### ADR-008: 仿真引擎 — Gazebo Fortress

| 项目 | 内容 |
|------|------|
| **决策** | 使用 Gazebo Fortress (Ignition) |
| **备选方案** | Gazebo Classic, Webots, Coppeliasim |
| **理由** | ROS2 Humble 原生支持；Gazebo Classic 已停止维护；Webots 物理精度更高但 ROS2 集成不如 Gazebo |
| **代价** | Fortress 社区资源少于 Classic |

### ADR-009: 通信协议 — DDS (ROS2 默认) + MQTT

| 项目 | 内容 |
|------|------|
| **决策** | ROS2 内部 DDS (FastDDS)，外部集成 MQTT |
| **备选方案** | 纯 DDS 对外通信, REST 轮询 |
| **理由** | DDS 提供车内实时通信保障；MQTT 是工业标准 (MES/WMS 集成)；分离内外通信降低耦合 |
| **代价** | 需要 bridge 节点进行协议转换 |

### ADR-010: 命名空间策略 — AGV 隔离

| 项目 | 内容 |
|------|------|
| **决策** | 每台 AGV 使用独立 ROS2 命名空间 `/agv_fleet/agv_<id>/` |
| **备选方案** | 同一命名空间使用 ID 前缀区分, 完全独立的 ros_domain_id |
| **理由** | 命名空间天然隔离 Topic，避免命名冲突；同一 Domain 内通信无需桥接；不同 Domain 需要额外的桥接节点 |
| **代价** | 启动脚本需要参数化 namespace |

### ADR-011: 控制算法 — PID

| 项目 | 内容 |
|------|------|
| **决策** | 使用 PID 控制器 (比例-积分-微分) 进行差速轮速度控制 |
| **备选方案** | LQR, 纯跟踪, MPC |
| **理由** | PID 实现简单，50ms 周期内计算量极低；LQR 需要精确模型；MPC 计算量过大 |
| **代价** | PID 调参需要经验，高速场景性能不如 LQR |

### ADR-012: YAML 地图格式

| 项目 | 内容 |
|------|------|
| **决策** | 使用 YAML 描述仓库拓扑图 (节点/边/区域) + 可选 PGM 栅格图 |
| **备选方案** | 纯 PGM 占用栅格, GeoJSON, GraphML |
| **理由** | YAML 可读性好，支持节点属性 (充电站/货架/装卸区)；拓扑图路径规划效率高；PGM 保留视觉信息 |
| **代价** | 需要维护两种地图表示的同步 |

### ADR-013: 前端框架 — React + WebSocket

| 项目 | 内容 |
|------|------|
| **决策** | React + TypeScript 前端，WebSocket 实时推送 |
| **备选方案** | Vue.js, Svelte, pure HTML+JS |
| **理由** | React 生态成熟，TypeScript 类型安全；WebSocket 比轮询更适合实时监控 |
| **代价** | 构建配置复杂，需要 Node.js 构建工具链 |

---

## 11. 验收标准

### 11.1 性能指标验收

| 指标 | 目标值 | 测量方法 |
|------|--------|---------|
| 控制周期 | 50ms ± 2ms | `motion_controller` 内部计时日志 |
| 传感器延迟 | < 20ms | 从传感器驱动发布到 EKF 接收的时间戳差 |
| 全局路径规划 | < 100ms (50x30m 地图) | `global_planner` 内部计时 |
| DWA 局部规划 | < 50ms | `local_planner` 内部计时 |
| 拍卖收敛 | < 500ms (10 台 AGV) | `dispatch_server` 内部计时 |
| 心跳间隔 | ≤ 5s | `fleet_monitor` 心跳超时检测 |
| 通信超时停车 | 15s | 心跳丢失后停车时间测量 |
| 碰撞紧急制动 | < 0.3m | 仿真中碰撞距离测量 |

### 11.2 安全验收

| 测试场景 | 预期行为 | 验证方式 |
|---------|---------|---------|
| AGV 接近障碍至 0.3m | 紧急制动、L3 故障、通知调度 | 仿真测试 |
| AGV 接近障碍 0.3-0.5m | 减速至 0.3m/s、L2 故障 | 仿真测试 |
| 通信中断 > 15s | 停车、标记离线、L3 故障 | 模拟断网 |
| 定位丢失 | 停车、L2 故障、重定位 | 手动注入高协方差 |
| 急停按钮按下 | 立即停车、硬件+软件双通道 | GPIO 模拟 |
| 全局急停命令 | 所有 AGV 停车 | REST API 调用 |

### 11.3 集成验收

| 场景 | 预期行为 | 验证方式 |
|------|---------|---------|
| MES 下发运输任务 | AGV 自动执行、状态回传 | MQTT 模拟 |
| 多 AGV 交叉路径 | 交通管制避免冲突 | 仿真 3+ AGV |
| Web 监控查看状态 | 实时位置/速度/任务/告警 | 前端手动验证 |
| REST API 创建/取消任务 | 任务状态正确流转 | API 自动化测试 |
| 仿真 10 台 AGV 满负载 | 稳定运行 1 小时 | 压力测试 |

---

## 附录 A: 已有代码状态与缺失对照

| 包名 | 已有代码状态 | 缺失部分 | 优先级 |
|------|------------|---------|--------|
| `agv_msgs` | 已完成 (20+ msg/srv/action) | 无 | — |
| `agv_core` | 核心类型/常量/工具完成 | task_executor 节点未实现 | P1 |
| `agv_control` | PID/mux/odom 完成 | 无 (后续调参) | — |
| `agv_navigation` | 未开始 | 全局/局部/跟踪全部待实现 | P0 |
| `agv_perception` | 未开始 | 碰撞/障碍物检测全部待实现 | P0 |
| `agv_localization` | 未开始 | EKF 融合待实现 | P0 |
| `agv_safety` | 未开始 | 安全监控全部待实现 | P1 |
| `agv_fleet` | 未开始 | 调度/交通/地图/监控全部待实现 | P1 |
| `agv_bridge` | 未开始 | REST/MQTT 桥接全部待实现 | P2 |
| `agv_simulation` | 世界/URDF/模型已有 | 部分插件配置、scenario_manager | P0 |
| `agv_drivers` | 未开始 | 硬件驱动全部待实现 | P3 |
| `backend` | 骨架已有 | 完整 API 端点待实现 | P2 |
| `frontend` | 骨架已有 | 完整监控面板待实现 | P2 |
| `config/` | 全部 YAML 配置已有 | 无 | — |
| `tests/` | 少量 | 全面测试待补充 | P2 |

---

*本文档由总架构师智能体基于需求文档 v1.0 和已有架构 v2.0 文档生成，参数以需求文档为准，所有设计决策可追溯至具体需求条款。*
