# AGV 多车协同调度与导航系统 —— 顶层架构设计文档

> 版本：v1.0 | 日期：2026-07-01 | 基于需求文档 v1.0

---

## 1. 系统顶层架构

### 1.1 架构风格：混合式架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        中心服务器 (Center Server)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │  task_   │  │  fleet_  │  │   api_   │  │   map_   │            │
│  │ manager  │  │ monitor  │  │ gateway  │  │  server  │            │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘            │
│       │              │              │              │                  │
│       └──────────────┼──────────────┼──────────────┘                  │
│                      │              │                                  │
│               ROS2 DDS (Fast-DDS / Cyclone DDS)                       │
│               WiFi 5/6 局域网                                          │
└──────────────────────┼──────────────┼──────────────────────────────────┘
                       │              │
        ┌──────────────┼──────────────┼──────────────┐
        │              │              │              │
┌───────┴───────┐ ┌───┴────────┐ ┌──┴──────────┐ ┌┴──────────────┐
│  /agv_01      │ │  /agv_02   │ │  /agv_03    │ │  ... /agv_N   │
│  ┌──────────┐ │ │ ┌────────┐ │ │ ┌─────────┐ │ │ ┌───────────┐ │
│  │ global_  │ │ │ │global_  │ │ │ │global_   │ │ │ │global_    │ │
│  │ planner  │ │ │ │planner  │ │ │ │planner   │ │ │ │planner    │ │
│  ├──────────┤ │ │ ├────────┤ │ │ ├─────────┤ │ │ ├───────────┤ │
│  │ local_   │ │ │ │local_  │ │ │ │local_    │ │ │ │local_     │ │
│  │ planner  │ │ │ │planner │ │ │ │planner   │ │ │ │planner    │ │
│  ├──────────┤ │ │ ├────────┤ │ │ ├─────────┤ │ │ ├───────────┤ │
│  │ locali-  │ │ │ │locali- │ │ │ │locali-   │ │ │ │locali-    │ │
│  │ zation   │ │ │ │zation  │ │ │ │zation    │ │ │ │zation     │ │
│  ├──────────┤ │ │ ├────────┤ │ │ ├─────────┤ │ │ ├───────────┤ │
│  │ safety_  │ │ │ │safety_ │ │ │ │safety_   │ │ │ │safety_    │ │
│  │ guard    │ │ │ │guard   │ │ │ │guard     │ │ │ │guard      │ │
│  ├──────────┤ │ │ ├────────┤ │ │ ├─────────┤ │ │ ├───────────┤ │
│  │ motion_  │ │ │ │motion_ │ │ │ │motion_   │ │ │ │motion_    │ │
│  │controller│ │ │ │control │ │ │ │controller│ │ │ │controller │ │
│  ├──────────┤ │ │ ├────────┤ │ │ ├─────────┤ │ │ ├───────────┤ │
│  │ battery_ │ │ │ │battery_│ │ │ │battery_  │ │ │ │battery_   │ │
│  │ manager  │ │ │ │manager │ │ │ │manager   │ │ │ │manager    │ │
│  └──────────┘ │ │ └────────┘ │ │ └─────────┘ │ │ └───────────┘ │
│  车载计算平台  │ │ 车载计算平台│ │ 车载计算平台 │ │ 车载计算平台  │
└───────────────┘ └────────────┘ └──────────────┘ └──────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    仿真环境 (Gazebo Ignition)                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐            │
│  │ agv_01   │  │ agv_02   │  │  ...     │  │ agv_N    │            │
│  │ 模型     │  │ 模型     │  │          │  │ 模型     │            │
│  ├──────────┤  ├──────────┤  ├──────────┤  ├──────────┤            │
│  │ LiDAR    │  │ LiDAR    │  │          │  │ LiDAR    │            │
│  │ IMU      │  │ IMU      │  │          │  │ IMU      │            │
│  │ Odometry │  │ Odometry │  │          │  │ Odometry │            │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘            │
│  ┌──────────────────────────────────────────────────────┐           │
│  │ 动态障碍物管理器  │  场景管理器  │  充电站 / 停靠点   │           │
│  └──────────────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 节点拓扑总览

| 位置 | 节点名称 | 实现语言 | 实时性 | 数量 |
|------|----------|----------|--------|------|
| **中心服务器** | `task_manager` | C++17 | 软实时 (100Hz) | 1 |
| | `fleet_monitor` | C++17 | 非实时 (10Hz) | 1 |
| | `api_gateway` | Python 3.10 | 非实时 | 1 |
| | `map_server` | C++17 | 非实时 | 1 |
| **车载端** ×N | `global_planner` | C++17 | 软实时 (≤ 50ms) | 10~20 |
| | `local_planner` | C++17 | 硬实时 (≤ 10ms) | 10~20 |
| | `localization` | C++17 | 硬实时 (≥ 50Hz) | 10~20 |
| | `safety_guard` | C++17 | 硬实时 (≤ 10ms) | 10~20 |
| | `motion_controller` | C++17 | 硬实时 (100Hz) | 10~20 |
| | `battery_manager` | C++17 | 非实时 (1Hz) | 10~20 |
| **仿真环境** | Gazebo Ignition | - | - | 1 进程 |
| | `ros_gz_bridge` | C++ | - | 1~2 |

---

## 2. 模块划分与职责定义

### 2.1 中心服务器模块

#### 2.1.1 task_manager（全局任务调度器）
```
task_manager/
├── include/task_manager/
│   ├── task_dispatcher.hpp      # 任务分发器
│   ├── task_scheduler.hpp       # 调度策略引擎
│   ├── task_queue.hpp           # 优先级任务队列
│   └── fleet_state.hpp          # 车队状态聚合
├── src/
│   ├── task_dispatcher.cpp
│   ├── task_scheduler.cpp
│   ├── task_queue.cpp
│   └── fleet_state.cpp
└── config/
    └── task_manager_params.yaml
```
**职责**：
- 接收 API 网关下发的任务，维护优先级队列
- 根据车队状态（位置、电量、负载）进行任务-AGV 匹配
- 调度策略：最短路径优先 (SPF) / 最少负载优先 (LLF)，支持动态切换
- 任务状态机：待分配 → 已分配 → 执行中 → 已完成/已失败/已取消
- 支持任务抢占（高优先级任务可抢占低优先级任务）

#### 2.1.2 fleet_monitor（车队状态监控）
```
fleet_monitor/
├── include/fleet_monitor/
│   ├── fleet_tracker.hpp        # 车队位置追踪
│   ├── health_monitor.hpp       # 健康状态监控
│   └── alert_manager.hpp        # 告警管理器
├── src/
│   ├── fleet_tracker.cpp
│   ├── health_monitor.cpp
│   └── alert_manager.cpp
└── config/
    └── fleet_monitor_params.yaml
```
**职责**：
- 订阅所有 AGV 的心跳与状态，维护全局车队视图
- 检测异常（离线、超时、频繁故障）并生成告警
- 提供车队级统计指标（任务完成率、平均等待时间、碰撞次数）
- 为可视化提供聚合数据

#### 2.1.3 api_gateway（API 网关）
```
api_gateway/
├── api_gateway/
│   ├── rest_server.py           # RESTful API 服务
│   ├── task_handler.py          # 任务请求处理
│   ├── status_handler.py        # 状态查询处理
│   └── ws_handler.py            # WebSocket 实时推送
├── config/
│   └── api_gateway_params.yaml
└── launch/
    └── api_gateway.launch.py
```
**职责**：
- 提供 RESTful API：任务下发、状态查询、系统配置
- WebSocket 实时推送告警与状态变更
- 请求验证与限流（支持 100 并发）
- 将外部请求转换为 ROS2 Service/Action 调用

#### 2.1.4 map_server（全局地图服务）
```
map_server/
├── include/map_server/
│   ├── map_manager.hpp          # 地图加载与管理
│   └── costmap_generator.hpp    # 全局代价地图生成
├── src/
│   ├── map_manager.cpp
│   └── costmap_generator.cpp
└── config/
    └── map_server_params.yaml
```
**职责**：
- 加载并维护全局静态地图（OccupancyGrid 格式）
- 提供地图查询服务（可通行性、距离计算）
- 生成全局代价地图供路径规划使用
- 支持地图编辑与热更新

### 2.2 车载端模块（每台 AGV 独立命名空间）

#### 2.2.1 global_planner（全局路径规划器）
```
global_planner/
├── include/global_planner/
│   ├── path_planner.hpp         # 全局路径搜索（A*/Dijkstra/Hybrid-A*）
│   ├── path_smoother.hpp        # 路径平滑与优化
│   └── map_client.hpp           # 地图服务客户端
├── src/
│   ├── path_planner.cpp
│   ├── path_smoother.cpp
│   └── map_client.cpp
└── config/
    └── global_planner_params.yaml
```
**职责**：
- 接收导航任务（起点→终点），生成全局最优路径
- 路径平滑与速度曲线生成
- 路径重规划（当全局路径被阻塞时）
- 向 local_planner 下发全局路径

#### 2.2.2 local_planner（局部路径规划与避障）
```
local_planner/
├── include/local_planner/
│   ├── local_planner.hpp        # 局部规划器（DWA/TEB/MPC）
│   ├── obstacle_detector.hpp    # 障碍物检测与跟踪
│   ├── collision_checker.hpp    # 碰撞检测
│   └── deadlock_resolver.hpp    # 死锁检测与解锁
├── src/
│   ├── local_planner.cpp
│   ├── obstacle_detector.cpp
│   ├── collision_checker.cpp
│   └── deadlock_resolver.cpp
└── config/
    └── local_planner_params.yaml
```
**职责**：
- 基于全局路径生成局部速度指令 (v_x, v_y, ω)
- 实时障碍物检测（激光雷达点云处理）
- 动态窗口法 (DWA) / TEB 局部规划
- 多 AGV 死锁检测与解锁策略
- 输出安全速度指令给 motion_controller

#### 2.2.3 localization（多传感器融合定位）
```
localization/
├── include/localization/
│   ├── ekf_fuser.hpp            # 扩展卡尔曼滤波器
│   ├── odom_predictor.hpp       # 里程计预测模型
│   └── sensor_fusion.hpp        # 多传感器融合框架
├── src/
│   ├── ekf_fuser.cpp
│   ├── odom_predictor.cpp
│   └── sensor_fusion.cpp
└── config/
    └── localization_params.yaml
```
**职责**：
- 融合轮式里程计 + IMU + 激光雷达数据
- EKF/UKF 状态估计（位姿 + 速度）
- 定位协方差计算
- 定位丢失检测与降级恢复

#### 2.2.4 safety_guard（安全防护节点）⚠️ 安全关键
```
safety_guard/
├── include/safety_guard/
│   ├── emergency_stop.hpp       # 急停逻辑（双路）
│   ├── speed_limiter.hpp        # 三层速度限幅
│   ├── collision_protection.hpp # 双重碰撞保护
│   └── watchdog.hpp             # 通信看门狗
├── src/
│   ├── emergency_stop.cpp
│   ├── speed_limiter.cpp
│   ├── collision_protection.cpp
│   └── watchdog.cpp
└── config/
    └── safety_guard_params.yaml
```
**职责**：
- 双路独立急停判断（原始传感器数据 + 处理后的控制指令）
- 三层速度限幅：任务层 → 路径层 → 执行层
- 双重碰撞保护：激光雷达安全区 + 虚拟 bumper
- 通信看门狗（100ms 超时）
- 定位跳变检测（> 0.5m 触发急停）
- **安全代码约束**：此节点内所有实时循环禁止动态内存、阻塞调用、文件 IO

#### 2.2.5 motion_controller（运动控制执行器）
```
motion_controller/
├── include/motion_controller/
│   ├── velocity_controller.hpp  # 速度控制器
│   └── cmd_mux.hpp              # 指令复用器（安全优先）
├── src/
│   ├── velocity_controller.cpp
│   └── cmd_mux.cpp
└── config/
    └── motion_controller_params.yaml
```
**职责**：
- 接收 local_planner 的 cmd_vel，经过 safety_guard 校验后执行
- 指令复用器：safety_guard 指令 > local_planner 指令
- 将速度指令转换为仿真电机指令

#### 2.2.6 battery_manager（电池管理）
```
battery_manager/
├── include/battery_manager/
│   ├── battery_model.hpp        # 电池仿真模型
│   └── charge_strategy.hpp      # 充电策略决策
├── src/
│   ├── battery_model.cpp
│   └── charge_strategy.cpp
└── config/
    └── battery_manager_params.yaml
```
**职责**：
- 仿真电池消耗模型（基于速度、负载）
- 低电量自动返航决策（< 20% 触发）
- 充电状态管理

---

## 3. 全局接口规范

### 3.1 ROS2 Topic 列表

| 编号 | Topic 名称 | 消息类型 | 发布者 → 订阅者 | 频率 | QoS |
|------|-----------|----------|----------------|------|-----|
| T-01 | `/agv_{N}/scan` | `sensor_msgs/LaserScan` | Gazebo → localization, safety_guard, local_planner | 30Hz | Sensor Data |
| T-02 | `/agv_{N}/imu` | `sensor_msgs/Imu` | Gazebo → localization | 100Hz | Sensor Data |
| T-03 | `/agv_{N}/odom_raw` | `nav_msgs/Odometry` | Gazebo → localization | 100Hz | Sensor Data |
| T-04 | `/agv_{N}/odom_fused` | `nav_msgs/Odometry` | localization → global_planner, local_planner, fleet_monitor | 50Hz | Best Effort |
| T-05 | `/agv_{N}/global_path` | `nav_msgs/Path` | global_planner → local_planner | 按需 | Reliable |
| T-06 | `/agv_{N}/local_path` | `nav_msgs/Path` | local_planner → fleet_monitor (可视化) | 10Hz | Best Effort |
| T-07 | `/agv_{N}/cmd_vel` | `geometry_msgs/Twist` | local_planner → motion_controller | 100Hz | Best Effort |
| T-08 | `/agv_{N}/cmd_vel_safe` | `geometry_msgs/Twist` | motion_controller → Gazebo | 100Hz | Best Effort |
| T-09 | `/agv_{N}/safety_status` | `agv_msgs/SafetyStatus` | safety_guard → local_planner, fleet_monitor | 50Hz | Reliable |
| T-10 | `/agv_{N}/heartbeat` | `agv_msgs/Heartbeat` | battery_manager → fleet_monitor | 10Hz | Best Effort |
| T-11 | `/agv_{N}/battery_state` | `sensor_msgs/BatteryState` | battery_manager → task_manager | 1Hz | Best Effort |
| T-12 | `/agv_{N}/task_status` | `agv_msgs/TaskStatus` | global_planner → task_manager | 事件驱动 | Reliable |
| T-13 | `/fleet/task_broadcast` | `agv_msgs/TaskBroadcast` | task_manager → 所有 global_planner | 事件驱动 | Reliable |
| T-14 | `/fleet/fleet_state` | `agv_msgs/FleetState` | fleet_monitor → api_gateway | 10Hz | Best Effort |
| T-15 | `/map/global_map` | `nav_msgs/OccupancyGrid` | map_server → 所有 global_planner | 按需 | Reliable Transient Local |
| T-16 | `/fleet/alerts` | `agv_msgs/AlertArray` | fleet_monitor → api_gateway | 事件驱动 | Reliable |

### 3.2 ROS2 Service 列表

| 编号 | Service 名称 | 服务类型 | 服务端 → 客户端调用 | 说明 |
|------|-------------|----------|---------------------|------|
| S-01 | `/api/submit_task` | `agv_msgs/SubmitTask` | api_gateway (Server) ← 外部 | 提交新任务 |
| S-02 | `/api/query_fleet` | `agv_msgs/QueryFleet` | api_gateway (Server) ← 外部 | 查询车队状态 |
| S-03 | `/api/cancel_task` | `agv_msgs/CancelTask` | api_gateway (Server) ← 外部 | 取消任务 |
| S-04 | `/map/get_map` | `nav_msgs/GetMap` | map_server (Server) ← global_planner | 获取全局地图 |
| S-05 | `/map/set_map` | `agv_msgs/SetMap` | map_server (Server) ← api_gateway | 更新/设置地图 |
| S-06 | `/agv_{N}/set_params` | `agv_msgs/SetParams` | 各节点 (Server) ← api_gateway | 动态参数配置 |
| S-07 | `/agv_{N}/emergency_stop` | `std_srvs/Trigger` | safety_guard (Server) ← 任意 | 人工触发急停 |
| S-08 | `/agv_{N}/resume` | `std_srvs/Trigger` | safety_guard (Server) ← 任意 | 解除急停恢复运行 |

### 3.3 ROS2 Action 列表

| 编号 | Action 名称 | 动作类型 | 服务端 | 说明 |
|------|------------|----------|--------|------|
| A-01 | `/agv_{N}/navigate_to` | `agv_msgs/NavigateTo` | global_planner | 导航任务：起点→终点，包含路径反馈 |
| A-02 | `/agv_{N}/charge` | `agv_msgs/Charge` | battery_manager | 充电任务：导航到充电站并充电 |
| A-03 | `/agv_{N}/dock` | `agv_msgs/Dock` | global_planner | 停靠任务：精确停靠到指定点 |
| A-04 | `/agv_{N}/patrol` | `agv_msgs/Patrol` | global_planner | 巡检任务：按预设路径点巡检 |
| A-05 | `/fleet/dispatch_task` | `agv_msgs/DispatchTask` | task_manager | 调度任务：中心调度器分配任务到指定 AGV |

### 3.4 自定义消息类型 (agv_msgs)

```
agv_msgs/
├── msg/
│   ├── SafetyStatus.msg       # uint8 level, bool estop_active, float64 min_distance, string reason
│   ├── Heartbeat.msg          # string agv_id, builtin_interfaces/Time stamp, uint8 state
│   ├── TaskStatus.msg         # string task_id, uint8 status, float64 progress, string agv_id
│   ├── TaskBroadcast.msg      # string task_id, uint8 task_type, string payload, int8 priority
│   ├── FleetState.msg         # AgvState[] agvs
│   ├── AgvState.msg           # string agv_id, PoseWithCovariance pose, Twist velocity, float64 battery
│   ├── Alert.msg              # uint8 level, string source, string message, builtin_interfaces/Time stamp
│   └── AlertArray.msg         # Alert[] alerts
├── srv/
│   ├── SubmitTask.srv         # TaskRequest request → TaskResponse response
│   ├── QueryFleet.srv         # QueryRequest request → FleetState response
│   ├── CancelTask.srv         # string task_id → bool success, string message
│   ├── SetMap.srv             # OccupancyGrid map → bool success
│   └── SetParams.srv          # Parameter[] params → bool success
└── action/
    ├── NavigateTo.action      # PoseStamped target → Path feedback → NavigateResult result
    ├── Charge.action          # string charger_id → float64 battery feedback → bool success
    ├── Dock.action            # PoseStamped dock_pose → float64 distance feedback → bool success
    ├── Patrol.action          # PoseStamped[] waypoints → int32 current_wp feedback → bool success
    └── DispatchTask.action    # TaskRequest task → TaskStatus feedback → DispatchResult result
```

---

## 4. 数据流与控制流设计

### 4.1 实时控制循环数据流（车载端）
```
传感器层              感知层               规划层               控制层              执行层
───────              ──────              ──────              ──────              ──────

Gazebo               localization        global_planner      local_planner       motion_ctrl
┌──────┐             ┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│LiDAR ├──scan──────→│          │        │          │        │          │        │          │
│      │  30Hz       │          │        │          │        │          │        │          │
│ IMU  ├──imu───────→│ EKF      │ odom   │ A*/      │ global │ DWA/     │ cmd_vel│ cmd_mux  │ cmd_vel
│      │  100Hz      │ Fusion   ├───────→│ Hybrid-A*├───────→│ TEB      ├───────→│          ├──safe──→ Gazebo
│Odom  ├──odom──────→│          │ 50Hz   │          │ path   │          │ 100Hz  │          │ 100Hz
└──────┘             └──────────┘        └──────────┘        └────┬─────┘        └────┬─────┘
                                                                  │                   │
                                                            ┌─────┴─────┐       ┌─────┴─────┐
                                                            │ safety_   │       │ safety_   │
                                                            │ guard     │       │ guard     │
                                                            │ (原始传感器│       │ (cmd_vel  │
                                                            │  数据路径) │       │  校验路径) │
                                                            └───────────┘       └───────────┘
```

**实时性保证**：
- 传感器 → 定位：100Hz 更新，50Hz 输出（EKF 预测+更新）
- 定位 → 规划 → 控制：50ms 路径规划 + 10ms 避障 + 10ms 控制
- 安全路径独立：safety_guard 直连原始传感器，不经过定位/规划

### 4.2 非实时任务流（中心 ↔ 车载）
```
外部系统             API层               调度层              执行层             反馈层
───────             ─────               ─────              ─────             ─────

REST Client         api_gateway          task_manager       global_planner     fleet_monitor
┌────────┐          ┌──────────┐         ┌──────────┐       ┌──────────┐       ┌──────────┐
│POST    ├─────────→│ validate │         │          │       │          │       │          │
│/task   │          │ request  ├────────→│ dispatch ├──────→│ navigate │       │          │
│        │          │          │         │          │Action │          │       │          │
│        │←─────────┤ response │←────────┤ feedback │←──────┤ feedback │       │          │
│        │          │          │         │          │       │          │       │          │
│GET     ├─────────→│ query    │         │          │       │          │       │          │
│/fleet  │          │ fleet    ├────────→│          │       │          │←──────┤ heartbeat│
│        │←─────────┤ state    │←────────┤          │       │          │       │ aggregate│
└────────┘          └──────────┘         └──────────┘       └──────────┘       └──────────┘
```

### 4.3 安全监控独立数据流
```
┌────────────────────────────────────────────────────────────┐
│                      双路独立安全监控                        │
│                                                            │
│  路径 A（原始传感器）          路径 B（控制指令）             │
│  ┌─────────────────┐         ┌─────────────────┐           │
│  │ scan_raw ───────┤         │ cmd_vel ────────┤           │
│  │  ↓               │         │  ↓               │           │
│  │ 激光安全区检测    │         │ 速度限幅检查     │           │
│  │ (距离 < 0.3m)    │         │ (> 2.0 m/s)     │           │
│  │  ↓               │         │  ↓               │           │
│  │ 急停判断 A       │         │ 急停判断 B       │           │
│  └────────┬────────┘         └────────┬────────┘           │
│           │                           │                     │
│           └───────────┬───────────────┘                     │
│                       ↓                                     │
│               ┌───────────────┐                             │
│               │ 急停仲裁器     │ ← 任一触发即急停             │
│               │ (OR 逻辑)     │                             │
│               └───────┬───────┘                             │
│                       ↓                                     │
│               ┌───────────────┐                             │
│               │ 直连仿真急停   │ ← 绕过 ROS2 通信层          │
│               │ Gazebo 接口   │                             │
│               └───────────────┘                             │
└────────────────────────────────────────────────────────────┘
```

---

## 5. 部署拓扑

### 5.1 中心服务器节点
```
中心服务器 (Ubuntu 22.04 + ROS2 Humble)
├── task_manager         (C++17, 100Hz 主循环)
├── fleet_monitor        (C++17, 10Hz 主循环)
├── api_gateway          (Python 3.10, Flask/FastAPI + rosbridge)
├── map_server           (C++17, 事件驱动)
└── rviz2 / Foxglove     (可视化, 可选)
```

### 5.2 车载端节点（每台 AGV 命名空间）
```
/agv_{01..20}/
├── global_planner       (C++17, ≤ 50ms 响应)
├── local_planner        (C++17, ≤ 10ms 响应, 100Hz 循环)
├── localization         (C++17, ≥ 50Hz 输出)
├── safety_guard         (C++17, ≤ 10ms 响应, 独立线程)
├── motion_controller    (C++17, 100Hz 控制循环)
├── battery_manager      (C++17, 1Hz 更新)
└── ros_gz_bridge        (ros_gz_bridge, 桥接 Gazebo ↔ ROS2)
```

### 5.3 仿真环境节点
```
Gazebo Ignition (Fortress)
├── world.sdf            # 场景描述（1000~5000m²）
├── agv_{01..20}.sdf     # AGV 模型（差速模型）
│   ├── LiDAR 插件       # 激光雷达仿真（30Hz, 270° FOV）
│   ├── IMU 插件         # IMU 仿真（100Hz）
│   ├── Odometry 插件    # 里程计仿真（100Hz）
│   └── DiffDrive 插件   # 差速驱动仿真
├── dynamic_obstacles    # 动态障碍物管理器
└── charging_stations    # 充电站 / 停靠点
```

### 5.4 网络分区与 QoS 策略

| 分区 | 通信类型 | QoS Profile | 说明 |
|------|----------|-------------|------|
| **传感器数据** | Topic | `SENSOR_DATA` (Reliable, KeepLast(5)) | LiDAR/IMU/Odom，低延迟 |
| **控制指令** | Topic | `SYSTEM_DEFAULT` (Best Effort, KeepLast(1)) | cmd_vel，最新优先 |
| **状态数据** | Topic | `BEST_EFFORT` (KeepLast(10)) | 心跳、电池、状态 |
| **安全数据** | Topic | `RELIABLE` (KeepLast(5), Transient Local) | 安全状态、急停指令 |
| **任务指令** | Action/Service | `RELIABLE` (KeepLast(1)) | 任务下发，不丢包 |
| **地图数据** | Topic/Service | `RELIABLE` (Transient Local) | 地图，晚加入节点可获取 |

---

## 6. 技术决策说明

### 6.1 关键算法选型

| 模块 | 推荐算法 | 备选方案 | 选型理由 |
|------|----------|----------|----------|
| **全局路径规划** | Hybrid-A* | A* / Dijkstra / RRT* | 考虑运动学约束，生成可执行路径 |
| **局部路径规划** | DWA (Dynamic Window Approach) | TEB / MPC | 计算效率高，≤ 10ms 内完成，ROS2 生态成熟 |
| **定位融合** | EKF (Extended Kalman Filter) | UKF / 粒子滤波 | 计算效率高，`robot_localization` 包成熟可用 |
| **任务调度** | 优先级队列 + 贪心匹配 | 匈牙利算法 / 遗传算法 | 10~20 台规模下贪心即可满足实时性 |
| **死锁解锁** | 优先级回退策略 | 交通规则 / 预约机制 | 实现简单，配合调度层避免死锁 |

### 6.2 架构权衡

| 决策 | 选择 | 权衡分析 |
|------|------|----------|
| **集中调度 vs 分布式调度** | 集中调度（混合部署） | ✅ 全局最优、易于监控 / ❌ 单点故障 → 热备解决 |
| **C++ vs Python** | 实时模块 C++17，非实时 Python | ✅ 实时保证 / ❌ 开发效率略低 |
| **独立安全节点 vs 内嵌安全** | 独立安全节点 | ✅ 物理隔离、独立验证 / ❌ 节点数增加 |
| **Gazebo Ignition vs Classic** | Ignition (Fortress) | ✅ ROS2 原生支持更好 / ❌ 插件生态略少 |
| **Fast-DDS vs Cyclone DDS** | Fast-DDS（默认） | ✅ ROS2 Humble 默认，兼容性最好 |

### 6.3 设计原则

1. **关注点分离**：调度、规划、控制、安全各自独立节点，降低耦合
2. **安全优先**：安全节点与业务节点物理隔离，安全路径独立于业务路径
3. **命名空间隔离**：每台 AGV 独立命名空间，仿真多车时无冲突
4. **参数外部化**：所有算法参数通过 YAML 配置，支持运行时动态调整
5. **渐进式仿真**：从单 AGV → 多 AGV → 全场景逐步验证
6. **可观测性**：所有关键路径都有心跳、状态上报、性能指标

---

## 附录 A：节点启动依赖顺序

```
Phase 1: 仿真环境
  └── Gazebo Ignition (world + AGV models)

Phase 2: 基础服务
  ├── map_server
  └── ros_gz_bridge (per AGV)

Phase 3: 车载端感知与控制
  ├── localization
  ├── safety_guard
  └── motion_controller

Phase 4: 车载端规划
  ├── global_planner
  └── local_planner

Phase 5: 中心服务
  ├── task_manager
  ├── fleet_monitor
  └── api_gateway

Phase 6: 辅助
  ├── battery_manager
  └── rviz2 / Foxglove
```

## 附录 B：目录结构建议

```
agv_fleet_ws/
├── src/
│   ├── agv_msgs/                  # 自定义消息接口包
│   ├── agv_center/                # 中心服务器
│   │   ├── task_manager/
│   │   ├── fleet_monitor/
│   │   ├── api_gateway/
│   │   └── map_server/
│   ├── agv_vehicle/               # 车载端
│   │   ├── global_planner/
│   │   ├── local_planner/
│   │   ├── localization/
│   │   ├── safety_guard/
│   │   ├── motion_controller/
│   │   └── battery_manager/
│   └── agv_sim/                   # 仿真
│       ├── agv_description/       # URDF/Xacro 模型
│       ├── agv_gazebo/            # Gazebo 世界与插件
│       └── agv_bringup/           # Launch 文件
├── config/                        # 全局配置文件
├── docs/                          # 文档
└── README.md
```

---

> 📌 **文档状态**：待评审 | **下一步**：启动批判反思智能体进行架构评审
