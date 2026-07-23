# 多 AGV 智能调度平台 - 系统顶层架构设计 v2.0

> **文档状态**：正式版
> **基于需求文档**：最新需求文档（2026-07-02）
> **ROS 2 发行版**：Humble Hawksbill
> **仿真平台**：Gazebo Classic（通过 gazebo_ros_pkgs 桥接）
> **设计日期**：2026-07-02
> **废弃旧版**：docs/architecture/agv_fleet_architecture.md（v1.0，基于 Gazebo Ignition + HTTPS REST）

---

## 目录

1. [变更摘要](#1-变更摘要)
2. [顶层分层架构](#2-顶层分层架构)
3. [模块划分与接口定义](#3-模块划分与接口定义)
4. [通信架构设计](#4-通信架构设计)
5. [数据流设计](#5-数据流设计)
6. [安全架构设计](#6-安全架构设计)
7. [项目目录结构](#7-项目目录结构)
8. [与现有代码的对照](#8-与现有代码的对照)

---

## 1. 变更摘要

### 1.1 从 v1.0 到 v2.0 的核心变更

| 变更项 | v1.0 | v2.0 | 影响范围 |
|--------|------|------|---------|
| WMS 接口协议 | HTTPS REST (轮询) | **WebSocket + JSON (双向推送)** | agv_api_gateway 重写 |
| 仿真平台 | Gazebo Ignition Fortress | **Gazebo Classic** | agv_simulation 重建 |
| 传感器配置 | LiDAR + 深度相机 + IMU | **2D LiDAR + 里程计**（无深度相机、无 IMU） | agv_perception 移除、agv_localization 简化 |
| 感知包 | agv_perception (存在) | **取消 agv_perception**，功能并入 agv_safety 和 agv_navigation | agv_perception 删除 |
| 定位方案 | EKF 融合 (odom+imu+amcl) | **AMCL 仅融合里程计** | agv_localization 重构 |
| 避障依赖 | 深度相机辅助避障 | **仅 2D LiDAR 避障** | agv_navigation 局部规划调整 |
| 系统频率 | 未明确 | **>= 20Hz** | 所有控制节点 |
| 通信断连策略 | 心跳丢失 > 3s 降速 | **WMS 断连 > 2s 自动停止** | agv_api_gateway + agv_safety |
| 边界限速 | 未定义 | 货架区 < 0.5m/s, 充电区 < 0.3m/s | agv_navigation + agv_control |

### 1.2 v2.0 架构设计原则

1. **单传感器简化原则**：仅依赖 2D LiDAR + 里程计完成定位、建图、避障，无冗余传感器
2. **AMCL 核心定位原则**：定位仅使用 AMCL + 里程计，无需 EKF 融合多传感器
3. **WebSocket 双向通信原则**：WMS 接口使用 WebSocket 而非 REST，支持服务端主动推送
4. **Gazebo Classic 兼容原则**：仿真基于 Gazebo Classic + gazebo_ros_pkgs
5. **仿真到真机无缝迁移原则**：通过 DDS 配置文件切换实现单机集中式与分布式局域网的无缝切换
6. **安全独立通道原则**：急停链路不依赖任何 ROS 中间件，硬件按钮直接断电

---

## 2. 顶层分层架构

### 2.1 系统分层架构

系统采用**四层分层架构**，自底向上分为：感知与定位层、规划与控制层、调度与安全层、通信与交互层。层间通过 ROS 2 话题/服务/动作解耦。

```
+------------------------------------------------------------------+
|                         WMS (外部系统)                              |
+------------------------------------------------------------------+
        |  WebSocket + JSON (双向推送)
+------------------------------------------------------------------+
|  4. 通信与交互层 (Communication & Interaction Layer)              |
|  +---------------------------+  +------------------------------+  |
|  |  agv_api_gateway          |  |  agv_visualization           |  |
|  |  - WebSocket 服务器       |  |  - rosbridge Web 桥接       |  |
|  |  - REST API (兼容层)     |  |  - Rviz2 配置               |  |
|  |  - 认证与限流             |  |  - Foxglove 桥接            |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  ROS 2 Action/Service/Topic
+------------------------------------------------------------------+
|  3. 调度与安全层 (Scheduling & Safety Layer)                       |
|  +---------------------------+  +------------------------------+  |
|  |  agv_fleet_manager        |  |  agv_safety                 |  |
|  |  - 集中任务分配           |  |  - 安全看门狗              |  |
|  |  - 死锁检测与化解         |  |  - 心跳生成与监控          |  |
|  |  - 交通管制               |  |  - 安全区域检测             |  |
|  +---------------------------+  +------------------------------+  |
|  |  agv_scheduler            |  |  agv_traffic_control         |  |
|  |  - 任务队列管理           |  |  - 交叉路口管理             |  |
|  |  - 动作序列执行           |  |  - 通行权仲裁               |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  cmd_vel (Twist) / 导航路径
+------------------------------------------------------------------+
|  2. 规划与控制层 (Planning & Control Layer) [每台 AGV]             |
|  +---------------------------+  +------------------------------+  |
|  |  agv_navigation           |  |  agv_control                |  |
|  |  - 全局路径规划 (A*)     |  |  - 运动控制器 (PID)         |  |
|  |  - 局部规划 (DWA/TEB)    |  |  - 速度限幅                 |  |
|  |  - 代价地图管理           |  |  - 命令复用器               |  |
|  |  - 路径协调与死锁预防     |  |  - 里程计发布               |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  传感器数据 / 定位位姿
+------------------------------------------------------------------+
|  1. 感知与定位层 (Perception & Localization Layer) [每台 AGV]      |
|  +---------------------------+  +------------------------------+  |
|  |  agv_localization         |  |  agv_safety (部分)           |  |
|  |  - AMCL 定位 (仅 LiDAR)  |  |  - LiDAR 安全区域检测        |  |
|  |  - 里程计融合            |  |  - 虚拟安全多边形            |  |
|  |  - 重定位                 |  |  - 碰撞检测                  |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
        |  硬件接口
+------------------------------------------------------------------+
|                    AGV 硬件层 (物理 / 仿真)                        |
|  +---------------------------+  +------------------------------+  |
|  |  Gazebo Classic           |  |  实体 AGV 硬件              |  |
|  |  - 仓库仿真世界           |  |  - 差分驱动底盘             |  |
|  |  - 多 AGV 模型           |  |  - SICK TiM 系列 2D LiDAR   |  |
|  |  - 传感器仿真插件         |  |  - 轮式编码器               |  |
|  |  - 物理引擎 (ODE)        |  |  - 硬件急停按钮             |  |
|  +---------------------------+  +------------------------------+  |
+------------------------------------------------------------------+
```

### 2.2 单 AGV 架构 vs 中央调度架构的关系

**单 AGV 架构**是每台 AGV 上独立运行的节点集合，负责从感知到控制的完整闭环：

```
单 AGV 边界 (命名空间 /agv_<id>/)
+-------------------------------------------------------------------+
|  感知与定位  -->  规划  -->  控制  -->  执行器                       |
|  (agv_local)     (nav)     (ctrl)                                |
+-------------------------------------------------------------------+
       |                     |
       | 调度指令              | 状态上报
       v                     v
+-------------------------------------------------------------------+
|  中央调度服务 (全局命名空间 /fleet/)                                |
|  - agv_fleet_manager: 任务分配、死锁检测、交通管制                   |
|  - agv_api_gateway: WMS 对接 (WebSocket + REST)                    |
+-------------------------------------------------------------------+
```

**职责边界**：

| 层面 | 单 AGV 职责 | 中央调度职责 |
|------|------------|-------------|
| 感知 | 采集 LiDAR 数据 | 不参与 |
| 定位 | AMCL 定位、重定位 | 全局地图维护 |
| 规划 | 全局路径规划、局部避障 | 交通管制、路径协商、死锁检测 |
| 控制 | PID 闭环控制、速度限幅 | 不参与 |
| 调度 | 任务队列管理、动作序列执行 | 任务分配、优先级管理、负载均衡 |
| 通信 | 单 AGV 内部节点通信 | WMS 对接 (WebSocket + REST) |
| 安全 | 急停执行、安全区域响应、心跳 | 全车队心跳监控、全局告警 |

**关键原则**：每台 AGV 独立运行完整的感知-定位-规划-控制闭环，不依赖中央调度完成基础移动功能。中央调度仅负责任务分配与多车协调，单 AGV 在失去与中央调度的通信时仍能安全停车。

### 2.3 混合式多 AGV 协同调度架构

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

### 2.4 仿真到真机迁移策略

通过 DDS 配置文件切换实现无缝迁移：

| 阶段 | 部署模式 | DDS 发现协议 | 传输方式 | 配置切换方式 |
|------|---------|-------------|---------|-------------|
| 仿真阶段 | 单机集中式 | Simple Discovery (默认) | UDP 回环 | fastdds_default.xml |
| 真机阶段 | 分布式局域网 | Discovery Server 模式 | TCP 跨主机 | fastdds_lan.xml |

```
# 仿真模式 (单机)
fastdds_default.xml:
  - 使用 Simple Discovery 协议
  - 传输: UDPv4 回环
  - 所有节点在同一进程组

# 真机模式 (分布式)
fastdds_lan.xml:
  - 使用 Discovery Server 模式
  - 中央服务器运行 Discovery Server
  - 每台 AGV 作为 Discovery Client 连接
  - 传输: TCPv4 (跨主机)
  - AGV 独立计算节点 + 中央调度服务器
```

---

## 3. 模块划分与接口定义

### 3.1 包划分概览

| 包名 | 语言 | 类型 | 状态 | 说明 |
|------|------|------|------|------|
| `agv_msgs` | 消息定义 | 接口包 | 已实现 | 14 msg, 20 srv, 5 action |
| `agv_core` | C++17 | 核心包 | 已实现 | 常量、类型、工具、生命周期管理器 |
| `agv_control` | C++17 | 控制包 | 已实现 | 运动控制器、命令复用器、里程计发布 |
| `agv_simulation` | Python | 仿真包 | 部分实现 | 需重建 Gazebo Classic 适配 |
| `agv_navigation` | C++17 | 导航包 | 骨架 | 全局/局部规划、代价地图 |
| `agv_scheduler` | Python | 调度包 | 骨架 | 任务队列、动作序列 |
| `agv_fleet_manager` | Python | 车队管理 | 骨架 | 集中调度、死锁检测 |
| `agv_traffic_control` | Python | 交通控制 | 骨架 | 路口管理、通行权仲裁 |
| `agv_localization` | C++17 | 定位包 | 骨架 | AMCL 定位、重定位 |
| `agv_safety` | C++17 | 安全包 | 骨架 | 安全看门狗、安全区域检测 |
| `agv_api_gateway` | Python | API 网关 | 骨架 | WebSocket + REST 服务器 |
| `agv_visualization` | Python | 可视化 | 骨架 | Rviz2/Foxglove 桥接 |
| `agv_tools` | Python | 工具包 | 骨架 | CLI 工具、诊断脚本 |

### 3.2 节点定义与接口

#### 3.2.1 agv_msgs — 消息/服务/动作定义包

> **包类型**：`ament_cmake`（纯接口包，无编译节点）
> **状态**：已完整实现，无需新增。以下列出与 v2.0 架构相关的主要接口。

**现有消息 (14 msg)** — 全部可复用：

| 消息名 | 说明 | 复用方式 |
|--------|------|---------|
| `AGVStatus.msg` | AGV 状态（字符串状态码） | 直接复用 |
| `VehicleState.msg` | AGV 综合状态（uint8 枚举） | 推荐使用 |
| `FleetState.msg` | 车队状态集合 | 直接复用 |
| `EmergencyStop.msg` | 急停事件（含来源枚举） | 直接复用 |
| `SafetyStatus.msg` | 安全级别/距离/限速 | 直接复用 |
| `BumperEvent.msg` | 虚拟保险杠事件 | 直接复用 |
| `TrafficZone.msg` | 交通区域状态 | 直接复用 |
| `TrafficZoneArray.msg` | 交通区域数组 | 直接复用 |
| `TaskStatusUpdate.msg` | 任务状态更新 | 直接复用 |
| `SystemMetrics.msg` | 系统指标 | 直接复用 |
| `TaskSpec.msg` | 任务规格 | 直接复用 |
| `TaskAssignment.msg` | 任务分配 | 直接复用 |

**现有服务 (20 srv)** — 全部可复用：

| 服务名 | 说明 | 复用方式 |
|--------|------|---------|
| `DispatchTask.srv` | 下发新任务 | 直接复用 |
| `CancelTask.srv` | 取消任务 | 直接复用 |
| `QueryTask.srv` | 查询任务状态 | 直接复用 |
| `QueryAGV.srv` | 查询 AGV 状态 | 直接复用 |
| `QueryFleet.srv` | 查询车队状态 | 直接复用 |
| `PlanPath.srv` | 请求路径规划 | 直接复用 |
| `GetMap.srv` | 获取地图 | 直接复用 |
| `UpdateMap.srv` | 更新地图 | 直接复用 |
| `ReserveZone.srv` | 预留区域 | 直接复用 |
| `ReleaseZone.srv` | 释放区域 | 直接复用 |
| `DetectDeadlock.srv` | 死锁检测 | 直接复用 |
| `ResolveDeadlock.srv` | 死锁化解 | 直接复用 |
| `SetGoal.srv` | 设定目标 | 直接复用 |
| `PauseResume.srv` | 暂停/恢复 | 直接复用 |
| `ManualEstop.srv` | 手动急停 | 直接复用 |
| `ClearEstop.srv` | 清除急停 | 直接复用 |
| `RecoverLocalization.srv` | 定位恢复 | 直接复用 |
| `SchedulerConfig.srv` | 调度策略配置 | 直接复用 |
| `SafetyParams.srv` | 安全参数更新 | 直接复用 |
| `SetSpeedLimit.srv` | 速度限制设置 | 直接复用 |

**现有动作 (5 action)** — 全部可复用：

| 动作名 | 说明 | 复用方式 |
|--------|------|---------|
| `ExecuteTask.action` | 执行任务 | 直接复用 |
| `Navigate.action` | 导航到目标 | 直接复用 |
| `Charge.action` | 自动充电 | 直接复用 |
| `Dock.action` | 自动停靠 | 直接复用 |
| `Patrol.action` | 巡逻 | 直接复用 |

#### 3.2.2 agv_core — 核心生命周期与安全守护

> **语言**：C++17 | **包类型**：`ament_cmake` | **状态**：已完整实现
> **节点数量**：3 个

**节点 1：`safety_guardian`（安全守护节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 系统级安全监控：急停仲裁、心跳监控、状态机管理、故障分级处理 |
| **输入话题** | `/agv_<id>/heartbeat` (Heartbeat, Reliable) |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyStatus, Reliable) |
| **输入话题** | `/agv_<id>/hardware/estop_status` (Bool, Reliable) |
| **输出话题** | `/agv_<id>/cmd_emergency_stop` (Bool, Reliable) |
| **输出话题** | `/agv_<id>/safety/state` (String, Reliable) |
| **服务** | `~emergency_stop` (ManualEstop) |
| **服务** | `~clear_emergency` (ClearEstop) |
| **参数** | `heartbeat_timeout_ms` (int, default 500) |
| **参数** | `max_linear_velocity` (double, default 1.5) |
| **参数** | `max_angular_velocity` (double, default 1.0) |

**节点 2：`mode_manager`（模式管理节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 生命周期节点管理 + 自动/手动模式切换 + 模式联锁检查 |
| **输入话题** | `/agv_<id>/status` (VehicleState, Reliable) |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyStatus, Reliable) |
| **输出话题** | `/agv_<id>/mode` (String, Reliable) |
| **服务** | `~set_mode` (SetMode — 需新增) |

> **新增服务**：`agv_msgs/srv/SetMode.srv` 需添加到 agv_msgs，内容：`uint8 AUTO=0; uint8 MANUAL=1; uint8 mode` → `bool success; string message`

**节点 3：`heartbeat_monitor`（心跳监控节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 接收并监控所有关键节点心跳，超时触发告警 |
| **输入话题** | `/agv_<id>/heartbeat` (Heartbeat, Reliable) |
| **输出话题** | `/agv_<id>/diagnostics` (DiagnosticArray, Reliable) |
| **服务** | `~query_node_health` (自定义) |

#### 3.2.3 agv_localization — 定位包（重写：v1.0 agv_perception 移除，定位简化）

> **语言**：C++17 | **包类型**：`ament_cmake` | **状态**：骨架需实现
> **节点数量**：2 个
> **v2.0 变更**：移除 EKF 融合节点（无 IMU），仅使用 AMCL + 里程计

**节点 1：`amcl_localizer`（AMCL 定位节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 基于 2D LiDAR + 轮式里程计，使用 AMCL 算法实现定位，精度 ±5cm，停靠精度 ±2cm |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan, BestEffort) — 2D LiDAR 扫描 |
| **输入话题** | `/agv_<id>/odom` (Odometry, Reliable) — 轮式里程计 |
| **输入话题** | `/agv_<id>/map` (OccupancyGrid, Reliable) — 全局地图 |
| **输出话题** | `/agv_<id>/localization/amcl_pose` (PoseWithCovarianceStamped, Reliable) — AMCL 位姿 |
| **输出话题** | `/agv_<id>/localization/particlecloud` (PoseArray, BestEffort) — 粒子云 |
| **输出话题** | `tf` (TFMessage) — odom→map 变换 |
| **服务** | `~global_localization` (std_srvs/Empty) — 全局重定位 |
| **服务** | `~request_nomotion_update` (std_srvs/Empty) — 无运动更新 |
| **服务** | `~set_map` (GetMap) — 设置地图 |
| **参数** | `min_particles` (int, default 500) |
| **参数** | `max_particles` (int, default 2000) |
| **参数** | `update_min_d` (double, default 0.2) — 最小移动距离触发更新 |
| **参数** | `update_min_a` (double, default 0.5) — 最小旋转角度触发更新 |
| **参数** | `resample_interval` (int, default 1) |
| **参数** | `transform_tolerance` (double, default 0.1) |
| **参数** | `recovery_alpha_slow` (double, default 0.0) |
| **参数** | `recovery_alpha_fast` (double, default 0.0) |
| **参数** | `base_frame_id` (string, default "base_footprint") |
| **参数** | `odom_frame_id` (string, default "odom") |
| **参数** | `map_frame_id` (string, default "map") |
| **参数** | `scan_topic` (string, default "/agv_<id>/lidar/scan") |

**实现说明**：使用 ROS 2 内置的 `nav2_amcl` 或 `robot_localization` 中的 AMCL 节点包装。无需额外实现 AMCL 算法，仅需创建参数配置和启动文件。

**节点 2：`relocalizer`（重定位节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 定位置信度低于阈值时触发重定位，5s 内恢复定位 |
| **输入话题** | `/agv_<id>/localization/amcl_pose` (PoseWithCovarianceStamped) |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan) |
| **输出话题** | `/agv_<id>/localization/relocalization_trigger` (Bool) |
| **服务** | `~force_relocalize` (std_srvs/Trigger) — 强制重定位 |
| **参数** | `covariance_threshold` (float[], default [0.5, 0.5, 0.5]) |
| **参数** | `relocalization_timeout_s` (int, default 5) |

#### 3.2.4 agv_navigation — 导航包（重写：避障仅依赖 2D LiDAR）

> **语言**：C++17 | **包类型**：`ament_cmake` | **状态**：骨架需实现
> **节点数量**：3 个
> **v2.0 变更**：局部避障仅依赖 2D LiDAR（无深度相机辅助）

**节点 1：`global_planner`（全局路径规划节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 基于全局代价地图计算 A* 路径，响应时间 <= 200ms (95 分位) |
| **输入话题** | `/agv_<id>/map` (OccupancyGrid, Reliable) |
| **输入话题** | `/agv_<id>/localization/amcl_pose` (PoseWithCovarianceStamped) |
| **输入话题** | `/agv_<id>/navigation/goal` (PoseStamped) |
| **输出话题** | `/agv_<id>/navigation/global_path` (Path, Reliable) |
| **参数** | `planner_type` (string, default "AStar") |
| **参数** | `max_planning_time_s` (double, default 0.2) |

**实现说明**：使用 `nav2_navfn_planner` 或 `nav2_smac_planner` 作为 A* 实现，通过参数配置适配。

**节点 2：`local_planner`（局部规划与避障节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 基于 DWA/TEB 算法跟踪全局路径并实时避障（仅 2D LiDAR），输出速度指令 |
| **输入话题** | `/agv_<id>/navigation/global_path` (Path) |
| **输入话题** | `/agv_<id>/localization/amcl_pose` (PoseWithCovarianceStamped) |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan, BestEffort) — 2D LiDAR 用于避障 |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyStatus) |
| **输出话题** | `/agv_<id>/navigation/cmd_vel` (Twist, Reliable) — 20Hz |
| **动作服务器** | `~navigate_to_pose` (Navigate) |
| **参数** | `max_linear_velocity` (double, default 1.5) |
| **参数** | `max_angular_velocity` (double, default 1.0) |
| **参数** | `control_frequency` (double, default 20.0) |
| **参数** | `obstacle_proximity_ratio` (double, default 0.3) — LiDAR 避障敏感度 |
| **参数** | `shelf_area_speed_limit` (double, default 0.5) — 货架区限速 |
| **参数** | `charging_area_speed_limit` (double, default 0.3) — 充电区限速 |

**节点 3：`costmap_manager`（代价地图管理节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 管理全局和局部代价地图，融合静态地图 + LiDAR 障碍物 |
| **输入话题** | `/agv_<id>/map` (OccupancyGrid) |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan) — 2D LiDAR 数据 |
| **输入话题** | `/fleet/shared_obstacles` (PointCloud2) — 多车共享障碍物 |
| **输出话题** | `/agv_<id>/navigation/global_costmap` (OccupancyGrid) |
| **输出话题** | `/agv_<id>/navigation/local_costmap` (OccupancyGrid) |
| **参数** | `global_frame` (string, default "map") |
| **参数** | `robot_base_frame` (string, default "base_footprint") |
| **参数** | `obstacle_range` (double, default 2.5) |
| **参数** | `raytrace_range` (double, default 3.0) |
| **参数** | `inflation_radius` (double, default 0.55) |

**实现说明**：使用 `nav2_costmap_2d` 库，通过参数配置实现仅 2D LiDAR 的代价地图。

#### 3.2.5 agv_control — 运动控制包（已实现，需新增边界限速）

> **语言**：C++17 | **包类型**：`ament_cmake` | **状态**：已实现，需适配
> **节点数量**：3 个

**节点 1：`motion_controller`（运动控制器节点）** — 已实现

| 项目 | 内容 |
|------|------|
| **职责** | PID 闭环控制，接收速度指令并输出电机控制信号，控制频率 >= 20Hz |
| **输入话题** | `/agv_<id>/navigation/cmd_vel` (Twist) |
| **输入话题** | `/agv_<id>/localization/amcl_pose` (PoseWithCovarianceStamped) |
| **输入话题** | `/agv_<id>/cmd_emergency_stop` (Bool) |
| **输出话题** | `/agv_<id>/control/motor_commands` (MotorCommand) |
| **参数** | `max_linear_acceleration` (double, default 0.5) |
| **参数** | `max_angular_acceleration` (double, default 1.0) |

**v2.0 新增参数**：
| 参数 | 说明 |
|------|------|
| `shelf_area_speed_limit` (double, default 0.5) | 货架区速度上限 |
| `charging_area_speed_limit` (double, default 0.3) | 充电区速度上限 |
| `drivable_area_violation_action` (string, default "emergency_stop") | 驶出可行驶区域动作 |

**节点 2：`velocity_limiter`（速度限幅节点）** — 已实现

| 项目 | 内容 |
|------|------|
| **职责** | 三层限幅：硬件层 -> 固件层 -> 软件层 |
| **输入话题** | `/agv_<id>/control/motor_commands` (MotorCommand) |
| **输出话题** | `/agv_<id>/control/limited_motor_commands` (MotorCommand, Reliable) |
| **参数** | `hardware_max_linear` (double, default 1.5) — 硬件最大线速度 |
| **参数** | `firmware_max_linear` (double, default 1.5) — 固件最大线速度 |
| **参数** | `software_max_linear` (double, default 1.5) — 软件最大线速度 |

**v2.0 新增**：在 `cmd_mux` 中增加安全指令源优先级（Safety > LocalPlanner > GlobalPlanner > Manual），确保急停指令最高优先级。

#### 3.2.6 agv_scheduler — 任务调度包

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：骨架需实现
> **节点数量**：1 个

**节点 1：`task_scheduler`（任务调度节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 接收并管理任务队列，按优先级执行，将任务拆解为动作序列 |
| **输入话题** | `/agv_<id>/scheduler/task` (TaskAssignment, Reliable) |
| **输入话题** | `/agv_<id>/safety/state` (String, Reliable) |
| **输出话题** | `/agv_<id>/scheduler/task_status` (TaskStatusUpdate, Reliable) |
| **输出话题** | `/agv_<id>/scheduler/current_action` (String, Reliable) |
| **动作客户端** | `~navigate_to_pose` -> `agv_navigation/local_planner` |
| **动作客户端** | `~dock_to_charger` -> `agv_control/dock_controller` |
| **服务** | `~cancel_task` (CancelTask) |
| **服务** | `~query_task_queue` (QueryTask) |
| **参数** | `max_queue_size` (int, default 20) |
| **参数** | `enable_priority_preemption` (bool, default true) |

#### 3.2.7 agv_fleet_manager — 车队管理包

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：骨架需实现
> **节点数量**：2 个

**节点 1：`fleet_scheduler`（集中调度节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 全局任务分配、AGV 注册管理、负载均衡、任务优先级仲裁 |
| **输入话题** | `/fleet/agv_status` (VehicleState, Reliable) |
| **输入话题** | `/fleet/task_requests` (TaskSpec, Reliable) |
| **输出话题** | `/fleet/assigned_tasks` (TaskAssignment, Reliable) |
| **输出话题** | `/fleet/fleet_status` (FleetState, Reliable) |
| **服务** | `~register_agv` (RegisterAGV — 需新增) |
| **服务** | `~submit_task` (DispatchTask) |
| **服务** | `~query_fleet_status` (QueryFleet) |
| **参数** | `scheduling_algorithm` (string, default "round_robin") |
| **参数** | `max_agv_count` (int, default 10) |

> **新增服务**：`agv_msgs/srv/RegisterAGV.srv` 需添加到 agv_msgs，内容：`string agv_id; string ip_address; float32 max_linear_velocity; float32 max_angular_velocity` -> `bool success; string fleet_id`

**节点 2：`deadlock_detector`（死锁检测节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 全局死锁检测（<= 500ms）、自动化解锁、路径协商 |
| **输入话题** | `/fleet/agv_positions` (PoseArray, Reliable) |
| **输入话题** | `/fleet/path_reservations` (TrafficZoneArray, Reliable) |
| **输出话题** | `/fleet/deadlock_info` (DeadlockInfo — 需新增 msg, Reliable) |
| **服务** | `~detect_deadlock` (DetectDeadlock) |
| **服务** | `~resolve_deadlock` (ResolveDeadlock) |
| **参数** | `detection_interval_ms` (int, default 500) |
| **参数** | `conflict_distance_threshold` (double, default 1.5) |

> **新增消息**：`agv_msgs/msg/DeadlockInfo.msg` 需添加到 agv_msgs，内容：`string[] involved_agvs; string description; uint8 DETECTED=0; uint8 RESOLVING=1; uint8 RESOLVED=2; uint8 status`

#### 3.2.8 agv_traffic_control — 交通控制包

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：骨架需实现
> **节点数量**：1 个

**节点 1：`traffic_controller`（交通管制节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 交叉路口/窄道等关键区域的通行权仲裁、资源预留管理 |
| **输入话题** | `/fleet/agv_positions` (PoseArray, Reliable) |
| **输入话题** | `/fleet/path_reservations` (TrafficZoneArray, Reliable) |
| **输出话题** | `/fleet/traffic_zones` (TrafficZoneArray, Reliable) |
| **服务** | `~reserve_zone` (ReserveZone) |
| **服务** | `~release_zone` (ReleaseZone) |
| **服务** | `~query_zone_status` (自定义) |
| **参数** | `zones_config_file` (string, default "config/traffic_zones.yaml") |
| **参数** | `max_reservation_duration_s` (double, default 30.0) |
| **参数** | `conflict_resolution_strategy` (string, default "priority_based") |

#### 3.2.9 agv_safety — 安全逻辑包（重写：合并安全区域检测）

> **语言**：C++17 | **包类型**：`ament_cmake` | **状态**：骨架需实现
> **节点数量**：3 个
> **v2.0 变更**：从原 agv_perception 合并 `safety_zone_detector` 功能

**节点 1：`emergency_handler`（急停处理节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 监听硬件急停信号与软件急停指令，执行急停逻辑（<= 100ms） |
| **输入话题** | `/agv_<id>/hardware/estop_status` (Bool, Reliable) |
| **输入话题** | `/agv_<id>/cmd_emergency_stop` (Bool, Reliable) |
| **输入话题** | `/agv_<id>/safety/zone` (SafetyStatus, Reliable) |
| **输出话题** | `/agv_<id>/safety/estop_triggered` (EmergencyStop, Reliable) |
| **输出话题** | `/agv_<id>/hardware/estop_command` (Bool, Reliable) |
| **服务** | `~trigger_estop` (ManualEstop) |
| **服务** | `~clear_estop` (ClearEstop) |
| **参数** | `hardware_estop_pin` (int) |
| **参数** | `estop_recovery_timeout_s` (double, default 30.0) |

**节点 2：`safety_zone_detector`（安全区域检测节点）** — 从原 agv_perception 移入

| 项目 | 内容 |
|------|------|
| **职责** | 基于 2D LiDAR 检测双层安全区域：物理检测 + 虚拟多边形 |
| **输入话题** | `/agv_<id>/lidar/scan` (LaserScan, BestEffort) — 2D LiDAR 数据 |
| **输出话题** | `/agv_<id>/safety/zone` (SafetyStatus, Reliable) — 安全状态 |
| **输出话题** | `/agv_<id>/safety/zone_markers` (MarkerArray, Reliable) |
| **参数** | `physical_deceleration_distance` (double, default 0.5) — LiDAR <0.5m 减速 |
| **参数** | `physical_emergency_distance` (double, default 0.2) — LiDAR <0.2m 急停 |
| **参数** | `virtual_safety_polygon` (string) — 虚拟安全多边形定义 |
| **参数** | `detection_frequency` (double, default 20.0) — >= 20Hz |

**双层碰撞检测实现**：
```
物理层 (LiDAR 直接检测):
  - LiDAR 扫描距离 < 0.5m -> 减速停车 (zone=DECELERATION)
  - LiDAR 扫描距离 < 0.2m -> 紧急急停 (zone=EMERGENCY)
  - 响应要求: < 100ms

虚拟层 (多边形安全区域):
  - 定义 AGV 周围的不可侵犯多边形 (前后左右扩展 0.3m)
  - 任何障碍物进入虚拟多边形 -> 急停
  - 虚拟多边形随 AGV 位姿更新
```

**节点 3：`heartbeat_generator`（心跳生成节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 周期性生成并发布本机心跳，供中央调度和本地安全守护监控 |
| **输出话题** | `/agv_<id>/heartbeat` (Heartbeat, Reliable, 10Hz) |
| **参数** | `agv_id` (string) |
| **参数** | `heartbeat_interval_ms` (int, default 100) |

#### 3.2.10 agv_api_gateway — API 网关包（重写：WebSocket 为核心）

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：骨架需实现
> **节点数量**：1 个
> **v2.0 变更**：从 REST 为主改为 WebSocket + JSON 双向推送

**节点 1：`api_gateway`（API 网关节点）**

| 项目 | 内容 |
|------|------|
| **职责** | 对外提供 WebSocket + JSON 协议（主）和 REST API（兼容），支持 WMS 主动推送 |
| **输入话题** | `/fleet/fleet_status` (FleetState) |
| **输入话题** | `/fleet/agv_status` (VehicleState) |
| **输入话题** | `/fleet/deadlock_info` (DeadlockInfo) |
| **输出话题** | `/fleet/task_requests` (TaskSpec) |
| **服务客户端** | `fleet_scheduler` 服务 |
| **WebSocket 端点** | `ws://<host>:8080/ws/v1` |
| **REST 端点** | `http://<host>:8080/api/v1` (兼容层) |
| **参数** | `ws_port` (int, default 8080) |
| **参数** | `rest_port` (int, default 8081) |
| **参数** | `enable_ssl` (bool, default false) |
| **参数** | `wms_heartbeat_interval_s` (int, default 2) — WMS 心跳间隔 |
| **参数** | `connection_timeout_s` (int, default 2) — WMS 断连超时 |

**WebSocket 消息格式**：

```json
{
  "type": "task_dispatch | task_update | status_report | alert | heartbeat | command",
  "timestamp": "2026-07-02T10:00:00+08:00",
  "sequence": 12345,
  "data": { ... }
}
```

**WMS -> 系统（请求）**：
| type | data 内容 | 说明 |
|------|----------|------|
| `task_dispatch` | `{task_id, task_type, priority, pickup_location, dropoff_location, payload, deadline}` | 任务下发 |
| `task_cancel` | `{task_id, reason}` | 取消任务 |
| `command` | `{command_type: "emergency_stop" / "clear_emergency" / "set_mode", agv_id, params}` | 紧急指令 |

**系统 -> WMS（推送）**：
| type | data 内容 | 说明 |
|------|----------|------|
| `status_report` | `{agv_id, position, velocity, battery, task_status, mode}` | AGV 状态上报 |
| `task_update` | `{task_id, status, progress, current_action, estimated_remaining}` | 任务进度 |
| `alert` | `{alert_id, alert_type, severity, agv_id, message, details}` | 异常告警推送 |
| `heartbeat` | `{server_time, connected_agvs}` | 连接心跳 (1Hz) |

**REST 兼容接口**（供后端/前端非 WebSocket 客户端使用）：

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | `/api/v1/tasks` | 任务下发 |
| GET | `/api/v1/tasks/{task_id}` | 任务状态查询 |
| DELETE | `/api/v1/tasks/{task_id}` | 取消任务 |
| GET | `/api/v1/agvs/{agv_id}/status` | AGV 状态查询 |
| GET | `/api/v1/fleet/status` | 车队状态总览 |
| POST | `/api/v1/system/emergency_stop` | 远程急停 |
| POST | `/api/v1/system/clear_emergency` | 清除急停 |

#### 3.2.11 agv_simulation — 仿真包（重建：Gazebo Classic 适配）

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：部分实现需重建
> **节点数量**：0 个（仅模型和启动文件）
> **v2.0 变更**：从 Gazebo Ignition 改为 Gazebo Classic

**需变更的文件**：

| 文件 | v1.0 | v2.0 |
|------|------|------|
| 世界文件 | warehouse.sdf (Ignition SDF) | warehouse.world (Gazebo Classic SDF) |
| AGV URDF | 含 3D LiDAR + RGB-D + IMU | 仅 2D LiDAR + 里程计 |
| 传感器插件 | gazebo_ros_ray_sensor (3D) | gazebo_ros_ray_sensor (2D) |
| 驱动插件 | ignition-gazebo-diff-drive | gazebo_ros_diff_drive |
| 桥接方式 | ignition-transport | gazebo_ros_pkgs (ros_gz) |

**重建内容**：
1. 重建 `warehouse.world`：将已有 SDF 世界转换为 Gazebo Classic 兼容格式
2. 修改 AGV URDF：移除 3D LiDAR 改为 2D LiDAR（SICK TiM 系列仿真），移除 RGB-D 摄像头，移除 IMU
3. 传感器插件：使用 `libgazebo_ros_ray_sensor.so` 仿真 2D LiDAR
4. 驱动插件：使用 `libgazebo_ros_diff_drive.so` 仿真差速驱动
5. 创建 `package.xml` 和 `CMakeLists.txt`
6. 创建 `launch/simulation.launch.py` 和 `launch/spawn_agv.launch.py`
7. 模型命名空间参数化：支持多 AGV 部署

#### 3.2.12 agv_visualization — 可视化包

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：骨架需实现
> **节点数量**：0 个（仅配置）

| 项目 | 内容 |
|------|------|
| **包含** | `rviz/` — Rviz2 配置文件、`launch/viz.launch.py` — 可视化启动文件 |
| **rosbridge** | Web 端通过 rosbridge 显示 AGV 位置/路径/任务状态/LiDAR 点云 |

#### 3.2.13 agv_tools — 工具包

> **语言**：Python 3.10 | **包类型**：`ament_python` | **状态**：骨架需实现
> **节点数量**：0 个（仅命令行工具）

| 项目 | 内容 |
|------|------|
| **包含** | `scripts/agv_control_cli.py` — 命令行控制工具 |
| **包含** | `scripts/fleet_monitor.py` — 车队监控工具 |
| **包含** | `scripts/diagnostics.py` — 诊断工具 |

### 3.3 命名空间设计

**单 AGV 命名空间**：`/agv_<id>/`

```
/agv_<id>/
├── lidar/
│   └── scan                      # LaserScan — 2D LiDAR 扫描数据
├── odom                          # Odometry — 轮式里程计
├── map                           # OccupancyGrid — 全局地图
├── safety/
│   ├── zone                      # SafetyStatus — 安全区域状态
│   ├── state                     # String — 安全状态机
│   ├── estop_triggered           # EmergencyStop — 急停触发
│   └── zone_markers              # MarkerArray — 区域可视化
├── localization/
│   ├── amcl_pose                 # PoseWithCovarianceStamped — AMCL 位姿
│   ├── particlecloud             # PoseArray — 粒子云
│   └── relocalization_trigger    # Bool — 重定位触发
├── navigation/
│   ├── goal                      # PoseStamped — 导航目标
│   ├── global_path               # Path — 全局路径
│   ├── cmd_vel                   # Twist — 速度指令 (20Hz)
│   ├── global_costmap            # OccupancyGrid
│   └── local_costmap             # OccupancyGrid
├── control/
│   ├── motor_commands            # MotorCommand — 电机指令
│   ├── limited_motor_commands    # MotorCommand — 限幅后指令
│   ├── manual_cmd_vel            # Twist — 手动速度指令
│   └── actual_vel                # Twist — 实际速度
├── scheduler/
│   ├── task                      # TaskAssignment — 新任务
│   ├── task_status               # TaskStatusUpdate — 任务状态
│   └── current_action            # String — 当前动作
├── hardware/
│   ├── estop_status              # Bool — 硬件急停状态
│   └── estop_command             # Bool — 硬件急停指令
├── heartbeat                     # Heartbeat — 心跳
├── mode                          # String — 运行模式
├── diagnostics                   # DiagnosticArray — 诊断
├── status                        # VehicleState — AGV 综合状态
└── cmd_emergency_stop            # Bool — 急停指令
```

**全局命名空间**：`/fleet/`

```
/fleet/
├── agv_status                    # VehicleState — 各车状态汇总
├── agv_positions                 # PoseArray — 各车位置
├── task_requests                 # TaskSpec — 任务请求
├── assigned_tasks                # TaskAssignment — 已分配任务
├── path_reservations             # TrafficZoneArray — 路径预留
├── traffic_zones                 # TrafficZoneArray — 交通区域状态
├── deadlock_info                 # DeadlockInfo — 死锁信息
├── deadlock_resolution           # String — 死锁化解方案
├── fleet_status                  # FleetState — 车队状态
├── shared_obstacles              # PointCloud2 — 共享障碍物
└── map                           # OccupancyGrid — 全局地图
```

---

## 4. 通信架构设计

### 4.1 ROS 2 话题完整清单

#### 4.1.1 单 AGV 话题

| 话题名 | 消息类型 | QoS 策略 | 发布者 | 订阅者 | 频率 | 说明 |
|--------|---------|----------|--------|--------|------|------|
| `/agv_<id>/lidar/scan` | `sensor_msgs/LaserScan` | BestEffort + KeepLast(10) | 传感器驱动/仿真 | amcl_localizer, local_planner, safety_zone_detector, costmap_manager | 15Hz | 2D LiDAR 扫描 |
| `/agv_<id>/odom` | `nav_msgs/Odometry` | Reliable + KeepLast(10) | ros2_control | amcl_localizer | 50Hz | 轮式里程计 |
| `/agv_<id>/map` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | map_server | amcl_localizer, global_planner | 更新时 | 全局地图 |
| `/agv_<id>/safety/zone` | `agv_msgs/SafetyStatus` | **Reliable + KeepLast(5)** | safety_zone_detector | safety_guardian, local_planner, mode_manager | 20Hz | 安全区域状态 |
| `/agv_<id>/safety/state` | `std_msgs/String` | Reliable + KeepLast(1) | safety_guardian | task_scheduler, fleet_scheduler | 10Hz | 安全状态机 |
| `/agv_<id>/safety/zone_markers` | `visualization_msgs/MarkerArray` | Reliable + KeepLast(1) | safety_zone_detector | visualization | 5Hz | 安全区域可视化 |
| `/agv_<id>/safety/estop_triggered` | `agv_msgs/EmergencyStop` | **Reliable + KeepLast(1)** | emergency_handler | 所有节点 | 事件 | 急停触发 |
| `/agv_<id>/localization/amcl_pose` | `geometry_msgs/PoseWithCovarianceStamped` | Reliable + KeepLast(10) | amcl_localizer | global_planner, relocalizer | 50Hz | AMCL 位姿 |
| `/agv_<id>/localization/particlecloud` | `geometry_msgs/PoseArray` | BestEffort + KeepLast(1) | amcl_localizer | visualization | 50Hz | AMCL 粒子云 |
| `/agv_<id>/localization/relocalization_trigger` | `std_msgs/Bool` | Reliable + KeepLast(1) | relocalizer | safety_guardian | 事件 | 重定位触发 |
| `/agv_<id>/navigation/goal` | `geometry_msgs/PoseStamped` | Reliable + KeepLast(1) | task_scheduler | global_planner | 事件 | 导航目标 |
| `/agv_<id>/navigation/global_path` | `nav_msgs/Path` | Reliable + KeepLast(1) | global_planner | local_planner | 重规划时 | 全局路径 |
| `/agv_<id>/navigation/cmd_vel` | `geometry_msgs/Twist` | **Reliable + KeepLast(1)** | local_planner | motion_controller | 20Hz | 速度指令 |
| `/agv_<id>/navigation/global_costmap` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | costmap_manager | global_planner | 1Hz | 全局代价地图 |
| `/agv_<id>/navigation/local_costmap` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | costmap_manager | local_planner | 5Hz | 局部代价地图 |
| `/agv_<id>/control/motor_commands` | `agv_msgs/MotorCommand` | **Reliable + KeepLast(1)** | motion_controller | velocity_limiter | 20Hz | 电机指令 |
| `/agv_<id>/control/limited_motor_commands` | `agv_msgs/MotorCommand` | **Reliable + KeepLast(1)** | velocity_limiter | ros2_control | 20Hz | 限幅后指令 |
| `/agv_<id>/control/manual_cmd_vel` | `geometry_msgs/Twist` | Reliable + KeepLast(1) | manual_controller | motion_controller | 50Hz | 手动速度 |
| `/agv_<id>/control/actual_vel` | `geometry_msgs/Twist` | Reliable + KeepLast(10) | motion_controller | diagnostics | 20Hz | 实际速度 |
| `/agv_<id>/scheduler/task` | `agv_msgs/TaskAssignment` | Reliable + KeepLast(10) | fleet_scheduler | task_scheduler | 事件 | 新任务 |
| `/agv_<id>/scheduler/task_status` | `agv_msgs/TaskStatusUpdate` | Reliable + KeepLast(1) | task_scheduler | status_monitor | 变化时 | 任务状态 |
| `/agv_<id>/scheduler/current_action` | `std_msgs/String` | Reliable + KeepLast(1) | task_scheduler | status_monitor | 变化时 | 当前动作 |
| `/agv_<id>/hardware/estop_status` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | 硬件接口 | emergency_handler | 事件 | 硬件急停状态 |
| `/agv_<id>/hardware/estop_command` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | emergency_handler | 硬件接口 | 事件 | 硬件急停指令 |
| `/agv_<id>/heartbeat` | `agv_msgs/Heartbeat` | **Reliable + KeepLast(5)** | heartbeat_generator | safety_guardian, heartbeat_monitor | 10Hz | 心跳 |
| `/agv_<id>/mode` | `std_msgs/String` | Reliable + KeepLast(1) | mode_manager | 所有节点 | 变化时 | 运行模式 |
| `/agv_<id>/diagnostics` | `diagnostic_msgs/DiagnosticArray` | Reliable + KeepLast(10) | heartbeat_monitor | diagnostics | 1Hz | 诊断信息 |
| `/agv_<id>/status` | `agv_msgs/VehicleState` | Reliable + KeepLast(1) | status_aggregator | fleet_scheduler | 10Hz | AGV 综合状态 |
| `/agv_<id>/cmd_emergency_stop` | `std_msgs/Bool` | **Reliable + KeepLast(1)** | safety_guardian | emergency_handler, motion_controller | 事件 | 急停指令 |

#### 4.1.2 全局/车队话题

| 话题名 | 消息类型 | QoS 策略 | 发布者 | 订阅者 | 频率 | 说明 |
|--------|---------|----------|--------|--------|------|------|
| `/fleet/agv_status` | `agv_msgs/VehicleState` | Reliable + KeepLast(10) | 各车 status | fleet_scheduler | 10Hz | 各车状态 |
| `/fleet/agv_positions` | `geometry_msgs/PoseArray` | Reliable + KeepLast(1) | fleet_scheduler | deadlock_detector, traffic_controller | 10Hz | 各车位置 |
| `/fleet/task_requests` | `agv_msgs/TaskSpec` | Reliable + KeepLast(100) | api_gateway | fleet_scheduler | 事件 | 任务请求 |
| `/fleet/assigned_tasks` | `agv_msgs/TaskAssignment` | Reliable + KeepLast(100) | fleet_scheduler | 各车 task_scheduler | 事件 | 已分配任务 |
| `/fleet/path_reservations` | `agv_msgs/TrafficZoneArray` | Reliable + KeepLast(50) | 各车 local_planner | traffic_controller | 变化时 | 路径预留 |
| `/fleet/traffic_zones` | `agv_msgs/TrafficZoneArray` | Reliable + KeepLast(1) | traffic_controller | visualization | 5Hz | 交通区域状态 |
| `/fleet/deadlock_info` | `agv_msgs/DeadlockInfo` | Reliable + KeepLast(10) | deadlock_detector | api_gateway, visualization | 事件 | 死锁信息 |
| `/fleet/deadlock_resolution` | `std_msgs/String` | Reliable + KeepLast(1) | deadlock_detector | 各车 local_planner | 事件 | 死锁化解方案 |
| `/fleet/fleet_status` | `agv_msgs/FleetState` | Reliable + KeepLast(1) | fleet_scheduler | api_gateway | 5Hz | 车队状态 |
| `/fleet/shared_obstacles` | `sensor_msgs/PointCloud2` | BestEffort + KeepLast(5) | 各车 costmap_manager | costmap_manager | 5Hz | 共享障碍物 |
| `/fleet/map` | `nav_msgs/OccupancyGrid` | Reliable + KeepLast(1) | map_server | global_planner | 更新时 | 全局地图 |

#### 4.1.3 服务清单

| 服务名 | 服务类型 | 提供者 | 调用者 | 说明 |
|--------|---------|--------|--------|------|
| `/agv_<id>/safety_guardian/emergency_stop` | `agv_msgs/ManualEstop` | safety_guardian | api_gateway, external | 软件急停 |
| `/agv_<id>/safety_guardian/clear_emergency` | `agv_msgs/ClearEstop` | safety_guardian | api_gateway, manual | 急停恢复 |
| `/agv_<id>/mode_manager/set_mode` | `agv_msgs/SetMode` | mode_manager | api_gateway, task_scheduler | 模式切换 |
| `/agv_<id>/emergency_handler/trigger_estop` | `agv_msgs/ManualEstop` | emergency_handler | safety_guardian | 触发急停 |
| `/agv_<id>/emergency_handler/clear_estop` | `agv_msgs/ClearEstop` | emergency_handler | safety_guardian | 清除急停 |
| `/agv_<id>/localization/amcl/global_localization` | `std_srvs/Empty` | amcl_localizer | relocalizer | 全局重定位 |
| `/agv_<id>/localization/relocalizer/force_relocalize` | `std_srvs/Trigger` | relocalizer | diagnostics, api | 强制重定位 |
| `/agv_<id>/scheduler/cancel_task` | `agv_msgs/CancelTask` | task_scheduler | api_gateway | 取消当前任务 |
| `/agv_<id>/scheduler/query_task` | `agv_msgs/QueryTask` | task_scheduler | diagnostics | 查询任务状态 |
| `/agv_<id>/safety/update_params` | `agv_msgs/SafetyParams` | safety_zone_detector | api_gateway | 更新安全参数 |
| `/fleet/fleet_scheduler/register_agv` | `agv_msgs/RegisterAGV` | fleet_scheduler | 各 AGV 启动脚本 | AGV 注册 |
| `/fleet/fleet_scheduler/submit_task` | `agv_msgs/DispatchTask` | fleet_scheduler | api_gateway | 任务提交 |
| `/fleet/fleet_scheduler/query_fleet_status` | `agv_msgs/QueryFleet` | fleet_scheduler | api_gateway | 车队状态查询 |
| `/fleet/fleet_scheduler/cancel_task` | `agv_msgs/CancelTask` | fleet_scheduler | api_gateway | 取消任务 |
| `/fleet/traffic_controller/reserve_zone` | `agv_msgs/ReserveZone` | traffic_controller | local_planner | 区域预留 |
| `/fleet/traffic_controller/release_zone` | `agv_msgs/ReleaseZone` | traffic_controller | local_planner | 释放区域 |
| `/fleet/deadlock_detector/detect` | `agv_msgs/DetectDeadlock` | deadlock_detector | diagnostics | 死锁检测 |
| `/fleet/deadlock_detector/resolve` | `agv_msgs/ResolveDeadlock` | deadlock_detector | diagnostics | 死锁化解 |

#### 4.1.4 动作清单

| 动作名 | 动作类型 | 服务器 | 客户端 | 说明 |
|--------|---------|--------|--------|------|
| `/agv_<id>/navigation/navigate_to_pose` | `agv_msgs/Navigate` | local_planner | task_scheduler | 导航到目标点 |
| `/agv_<id>/scheduler/execute_task` | `agv_msgs/ExecuteTask` | task_scheduler | (内部) | 执行任务 |

### 4.2 QoS 策略

| QoS 类别 | 适用场景 | 可靠性 | 持久性 | 历史记录 | 深度 |
|----------|---------|--------|--------|---------|------|
| **安全关键 (Critical)** | 急停、心跳、安全区域、电机指令 | RELIABLE | VOLATILE | KEEP_LAST | 1 |
| **控制关键 (Control)** | 速度指令、电机指令、限幅指令 | RELIABLE | VOLATILE | KEEP_LAST | 1 |
| **导航数据 (Navigation)** | 路径、位姿、代价地图 | RELIABLE | VOLATILE | KEEP_LAST | 10 |
| **传感器数据 (Sensor)** | LiDAR、里程计 | BEST_EFFORT | VOLATILE | KEEP_LAST | 10 |
| **状态监控 (Status)** | 状态上报、任务状态 | RELIABLE | VOLATILE | KEEP_LAST | 10 |
| **可视化 (Visualization)** | Marker、调试信息 | RELIABLE | VOLATILE | KEEP_LAST | 5 |

### 4.3 AGV <-> 中央调度服务器通信协议

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
- 底层 DDS 使用 **Fast DDS** 或 **Cyclone DDS**
- 发现协议：仿真阶段 Simple Discovery -> 真机阶段 Discovery Server 模式
- 传输方式：仿真阶段 UDP 回环 -> 真机阶段 TCP 跨主机
- 网络分区：AGV 与中央调度处于同一 VLAN

**断连处理策略**：

| 断连场景 | 检测方式 | AGV 行为 | 恢复行为 |
|---------|---------|---------|---------|
| WMS 断连 > 2s | WebSocket 心跳丢失 | 自动停止 | 连接恢复后继续 |
| 调度器断连 | 心跳丢失 | 完成当前任务后回待命区 | 中央恢复后重新注册 |
| 传感器超时 > 100ms | 话题超时检测 | 降速安全模式 | 传感器恢复后恢复 |
| 所有通信丢失 | 心跳+网络检测 | 安全停车，锁定任务 | 人工介入 |

### 4.4 WMS WebSocket 接口规范

#### 4.4.1 连接规范

| 项目 | 规范 |
|------|------|
| 协议 | WebSocket + JSON |
| 端点 | `ws://<fleet_server>:8080/ws/v1` |
| 数据格式 | JSON (Content-Type: application/json) |
| 心跳 | 服务端 1Hz，WMS 需在 2s 内响应 |
| 重连 | 自动重连，指数退避 (1s, 2s, 4s, 8s, max 30s) |

#### 4.4.2 消息通用格式

```json
{
  "type": "message_type",
  "timestamp": "2026-07-02T10:00:00+08:00",
  "sequence": 12345,
  "data": { ... }
}
```

#### 4.4.3 消息类型定义

**WMS -> 系统**：

```json
{
  "type": "task_dispatch",
  "timestamp": "2026-07-02T10:00:00+08:00",
  "sequence": 10001,
  "data": {
    "task_id": "TASK-20260702-001",
    "task_type": "transport",
    "priority": 1,
    "pickup_location": { "x": 12.5, "y": 8.3, "theta": 0.0, "frame_id": "map" },
    "dropoff_location": { "x": 25.0, "y": 15.7, "theta": 1.57, "frame_id": "map" },
    "payload": { "type": "box", "weight_kg": 10.5, "description": "货物A" },
    "deadline": "2026-07-02T12:00:00+08:00",
    "timeout_seconds": 300
  }
}
```

```json
{
  "type": "command",
  "timestamp": "2026-07-02T10:00:00+08:00",
  "sequence": 10002,
  "data": {
    "command_type": "emergency_stop",
    "agv_id": "agv_001",
    "reason": "WMS operator manual stop"
  }
}
```

**系统 -> WMS**：

```json
{
  "type": "status_report",
  "timestamp": "2026-07-02T10:00:00+08:00",
  "sequence": 50001,
  "data": {
    "agv_id": "agv_001",
    "online": true,
    "mode": "auto",
    "battery_level": 0.85,
    "position": { "x": 12.5, "y": 8.3, "theta": 0.0, "frame_id": "map" },
    "linear_velocity": 0.8,
    "angular_velocity": 0.0,
    "task_status": "executing",
    "current_task_id": "TASK-20260702-001",
    "fault_code": 0,
    "safety_status": { "zone_level": 0, "estop_triggered": false }
  }
}
```

```json
{
  "type": "alert",
  "timestamp": "2026-07-02T10:00:00+08:00",
  "sequence": 50002,
  "data": {
    "alert_id": "ALERT-20260702-001",
    "alert_type": "emergency_stop",
    "severity": "critical",
    "agv_id": "agv_002",
    "message": "AGV agv_002 triggered emergency stop: obstacle within 0.2m",
    "details": {
      "fault_code": 301,
      "position": { "x": 30.0, "y": 20.0, "frame_id": "map" },
      "zone_level": 3
    }
  }
}
```

**告警类型枚举**：

| alert_type | severity | 说明 |
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

## 5. 数据流设计

### 5.1 传感器数据 -> 定位 -> 规划 -> 控制 完整数据流

```
时间轴方向 ->
┌─────────────────────────────────────────────────────────────────────┐
│  [传感器层]                                                          │
│  2D LiDAR (15Hz)   ──→ /agv_<id>/lidar/scan (LaserScan)             │
│  轮式编码器 (50Hz) ──→ /agv_<id>/odom (Odometry)                    │
└─────────────────────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [定位层 - 精度 ±5cm]                                                │
│  ┌──────────────────────────────────────┐                           │
│  │ amcl_localizer (nav2_amcl)           │                           │
│  │ 输入: /lidar/scan + /odom + /map    │                           │
│  │ 输出: AMCL 位姿 (50Hz)               │                           │
│  │ 停靠精度: ±2cm                       │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/localization/amcl_pose                   │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ relocalizer                           │                           │
│  │ 监控协方差，触发重定位 (<=5s 恢复)    │                           │
│  └──────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [规划层 - 全局路径 < 200ms (95分位)]                                │
│  ┌──────────────────────────────────────┐                           │
│  │ global_planner (A*)                  │                           │
│  │ 输入: map + amcl_pose + goal         │                           │
│  │ 输出: 全局路径 (Path)                │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/navigation/global_path                   │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ local_planner (DWA/TEB)              │                           │
│  │ 输入: global_path + amcl_pose +      │                           │
│  │       /lidar/scan + safety/zone      │                           │
│  │ 输出: cmd_vel (20Hz)                 │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/navigation/cmd_vel (Twist, 20Hz)        │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ costmap_manager                       │                           │
│  │ 输入: map + lidar/scan               │                           │
│  │ 输出: global_costmap + local_costmap  │                           │
│  └──────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [安全层 - 响应 < 100ms]                                             │
│  ┌──────────────────────────────────────┐                           │
│  │ safety_zone_detector                  │                           │
│  │ 输入: /lidar/scan                    │                           │
│  │ 1. 物理层检测:                        │                           │
│  │    - LiDAR < 0.5m -> 减速            │                           │
│  │    - LiDAR < 0.2m -> 急停            │                           │
│  │ 2. 虚拟层检测:                        │                           │
│  │    - 虚拟多边形入侵 -> 急停           │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/safety/zone (SafetyStatus, 20Hz)        │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ emergency_handler                     │                           │
│  │ 双路触发:                             │                           │
│  │ - 硬件急停按钮直接断电 (独立通道)     │                           │
│  │ - 软件 /emergency_stop 话题          │                           │
│  └──────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [控制层 - 控制频率 >= 20Hz]                                         │
│  ┌──────────────────────────────────────┐                           │
│  │ motion_controller (PID)              │                           │
│  │ 1. 接收 cmd_vel (期望速度)           │                           │
│  │ 2. 急停指令直接覆盖 -> 速度归零      │                           │
│  │ 3. 输出电机指令                      │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/control/motor_commands                   │
│                                                                     │
│  ┌──────────────────────────────────────┐                           │
│  │ velocity_limiter (三层限幅)          │                           │
│  │ 1. 硬件限幅: max 1.5m/s             │                           │
│  │ 2. 固件限幅: (嵌入式)               │                           │
│  │ 3. 软件限幅: 货架区 <0.5m/s         │                           │
│  │              充电区 <0.3m/s         │                           │
│  └──────────┬───────────────────────────┘                           │
│             └──→ /agv_<id>/control/limited_motor_commands           │
└─────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  [执行层]                                                            │
│  ros2_control -> 电机驱动器 -> 差分驱动底盘                          │
│  Gazebo Classic (仿真模式)                                          │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 任务下发流程 (WebSocket)

```
WMS (WebSocket Client)           中央调度                         AGV
 │                              │                              │
 │  1. WebSocket 连接           │                              │
 │  ──────────────────────────→│                              │
 │  2. 连接确认 + 认证          │                              │
 │  ←──────────────────────────│                              │
 │                              │                              │
 │  3. type: task_dispatch      │                              │
 │  ──────────────────────────→│                              │
 │                              │  4. 任务验证与优先级计算      │
 │                              │  5. AGV 选择（负载均衡）     │
 │  6. type: task_ack           │                              │
 │  ←──────────────────────────│                              │
 │  (accepted / rejected)      │                              │
 │                              │  7. /fleet/assigned_tasks    │
 │                              │  ──────────────────────────→│
 │                              │                              │  8. 接收任务
 │                              │                              │  9. 加入任务队列
 │                              │                              │  10. 拆解为动作序列
 │                              │                              │
 │                              │  11. type: task_update       │
 │                              │  ←──────────────────────────│
 │                              │  (task_id, status, progress)│
 │                              │                              │
 │  12. type: task_update       │                              │
 │  ←──────────────────────────│                              │
 │                              │                              │
 │                              │  13. 任务完成                │
 │                              │  ←──────────────────────────│
 │  14. type: task_update       │                              │
 │  ←──────────────────────────│                              │
 │  (status: completed)        │                              │
```

### 5.3 多 AGV 协同数据流

```
 [AGV 1]                     [中央调度]                     [AGV 2]
    │                           │                           │
    │  1. 规划路径               │                           │
    │  2. 检测到路径交叉         │                           │
    │  3. ReserveZone 服务       │                           │
    │  ────────────────────────→│                           │
    │                           │  4. 检查区域占用状态       │
    │                           │  5. 区域空闲 -> 授予      │
    │  6. granted=true           │                           │
    │  ←────────────────────────│                           │
    │  7. 通过交叉区域           │                           │
    │  8. ReleaseZone 服务       │                           │
    │  ────────────────────────→│                           │
    │                           │  9. 释放区域              │
    │                           │                           │  10. 规划路径
    │                           │                           │  11. 检测到路径交叉
    │                           │                           │  12. ReserveZone 服务
    │                           │  ←────────────────────────│
    │                           │  13. 区域空闲 -> 授予     │
    │                           │  ────────────────────────→│
    │                           │                           │  14. 通过交叉区域
    │                           │                           │
    │  [死锁检测 - 500ms 周期]   │                           │
    │                           │  ┌─────────────────────┐  │
    │                           │  │ deadlock_detector   │  │
    │                           │  │ 收集所有 AGV 位置   │  │
    │                           │  │ 构建资源分配图      │  │
    │                           │  │ 检测环路依赖        │  │
    │                           │  └─────────────────────┘  │
    │                           │                           │
    │  15. 死锁检测通知         │                           │
    │  ←────────────────────────│                           │
    │  16. 死锁化解方案:        │                           │
    │  AGV 1 前进, AGV 2 倒车  │                           │
    │  ←────────────────────────│──────────────────────────│
    │                           │                           │
    │  17. 执行化解动作         │  18. 执行化解动作        │
    │                           │                           │
```

### 5.4 通信断连处理流程

```
WMS 断连 > 2s:
  api_gateway 检测到 WebSocket 心跳丢失
    -> 发布 /fleet/task_requests: 暂停新任务
    -> AGV 执行中任务完成当前动作后停止
    -> 等待 WMS 重连
  WMS 重连后:
    -> 恢复待执行任务队列
    -> AGV 继续未完成任务

调度器断连:
  AGV 检测到 /fleet/ 话题超时
    -> 完成当前任务（不接收新任务）
    -> 回到待命区
    -> 安全停车
 调度器恢复后:
    -> AGV 重新注册
    -> 获取未完成任务

传感器超时 > 100ms:
  safety_guardian 检测到 LiDAR 话题超时
    -> 降速安全模式 (0.3m/s)
    -> 30s 内恢复则回到正常模式
    -> 30s 未恢复则安全停车
```

---

## 6. 安全架构设计

### 6.1 安全架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│                        安全架构总览                                   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  安全层 1: 硬件安全 (独立通道)                                │    │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐              │    │
│  │  │ 物理急停  │  │ 安全继电器 │  │ 电机驱动器    │              │    │
│  │  │ 按钮     │──│          │──│ 硬件限幅      │              │    │
│  │  │          │  │          │  │ (1.5m/s)     │              │    │
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
│  │  │  ├─ 硬件急停信号监听 -> 直接电机断电              │       │    │
│  │  │  ├─ 软件急停指令执行 -> CAN 停机指令              │       │    │
│  │  │  └─ 安全区域触发急停 (zone=EMERGENCY)            │       │    │
│  │  └──────────────────────────────────────────────────┘       │    │
│  │  ┌──────────────────────────────────────────────────┐       │    │
│  │  │  safety_zone_detector (安全区域检测节点)          │       │    │
│  │  │  ├─ 物理层检测 (LiDAR <0.5m 减速/<0.2m 急停)    │       │    │
│  │  │  ├─ 虚拟层检测 (多边形安全区域)                  │       │    │
│  │  │  └─ 20Hz 检测频率                               │       │    │
│  │  └──────────────────────────────────────────────────┘       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  安全层 3: 通信安全                                            │    │
│  │  - WMS 断连 > 2s 自动停止                                     │    │
│  │  - 调度器断连完成当前任务后回待命区                             │    │
│  │  - 传感器超时 > 100ms 降速安全模式                            │    │
│  │  - 心跳 + 超时检测                                            │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  安全层 4: 限幅硬约束                                          │    │
│  │  - 线速度 <= 1.5m/s                                          │    │
│  │  - 角速度 <= 1.0rad/s                                        │    │
│  │  - 加速度 <= 0.5m/s²                                         │    │
│  │  - 货架区 < 0.5m/s                                           │    │
│  │  - 充电区 < 0.3m/s                                           │    │
│  │  - 禁止驶出可行驶区域                                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 急停链路设计

#### 6.2.1 双路急停架构

```
触发源 1: 硬件急停按钮 (物理按钮)
  -> 独立电源回路 -> 安全继电器 -> 电机驱动器使能引脚 -> 直接断电
  -> GPIO 输入 -> /hardware/estop_status -> emergency_handler 确认
  响应时间: < 100ms (物理通道不经过软件)

触发源 2: 软件急停 (/emergency_stop 话题)
  -> safety_guardian 仲裁
  -> /cmd_emergency_stop -> motion_controller 速度归零
                          -> emergency_handler CAN 停机指令
  响应时间: < 100ms

软件急停触发源:
  ├── safety_zone_detector (zone=EMERGENCY, LiDAR < 0.2m)
  ├── safety_guardian (心跳丢失/严重故障)
  ├── api_gateway (WMS 远程急停 via WebSocket)
  └── manual_estop 服务 (本地调用)
```

#### 6.2.2 双重保护互锁

```
硬件急停触发 ──→ 电机断电 (独立通道, < 100ms)
      ↑                ↑
      │  互为冗余      │
      │                │
软件急停触发 ──→ CAN 停机指令 (DDS 通道, < 100ms)

任一触发 -> AGV 停车 -> 任务锁定 -> 人工确认后恢复
```

### 6.3 碰撞检测设计

#### 6.3.1 双层碰撞检测

```
物理层 (基于 2D LiDAR 直接检测):
  ┌────────────────────────────────────────────┐
  │ safety_zone_detector                       │
  │                                            │
  │ LiDAR 扫描数据 -> 距离计算:                │
  │   - 最近障碍物距离 < 0.5m -> 减速停车     │
  │     (zone=DECELERATION, 降速至 0.3m/s)    │
  │   - 最近障碍物距离 < 0.2m -> 紧急急停     │
  │     (zone=EMERGENCY, 速度归零)            │
  │                                            │
  │ 响应要求: < 100ms                          │
  │ 检测频率: 20Hz                             │
  └────────────────────────────────────────────┘

虚拟层 (多边形安全区域):
  ┌────────────────────────────────────────────┐
  │ safety_zone_detector                       │
  │                                            │
  │ 定义 AGV 周围不可侵犯多边形:               │
  │   - 前向: AGV 前方 0.3m 扩展              │
  │   - 后向: AGV 后方 0.3m 扩展              │
  │   - 侧向: AGV 两侧 0.2m 扩展              │
  │                                            │
  │ 任何障碍物/其他AGV进入多边形 -> 急停       │
  │ 虚拟多边形随 AGV 位姿更新 (20Hz)          │
  └────────────────────────────────────────────┘
```

### 6.4 三层限幅硬约束

```
层 1: 硬件限幅 (不可修改)
  -> 电机驱动器硬件限幅: 线速度 <= 1.5m/s
  -> 角速度 <= 1.0rad/s
  -> 加速度 <= 0.5m/s²

层 2: 固件限幅 (嵌入式)
  -> MCU 固件限幅: 与硬件层一致或更严格
  -> 独立于 ROS 软件栈运行

层 3: 软件限幅 (ROS 节点 - velocity_limiter)
  -> 货架区: < 0.5m/s
  -> 充电区: < 0.3m/s
  -> 正常区域: <= 1.5m/s
  -> 禁止驶出可行驶区域 (基于代价地图)
  -> 安全区域触发动态限速:
       - 警告区 (zone=WARNING): 限速 50% 额定速度
       - 减速区 (zone=DECELERATION): 限速 0.3m/s
       - 急停区 (zone=EMERGENCY): 速度归零
```

### 6.5 安全状态机

#### 6.5.1 状态定义

```
                    ┌────────────────┐
                    │   SAFE (正常)   │
                    │ 速度: 全速      │
                    └───────┬────────┘
                            │
          ┌─────────────────┼─────────────────┐
          ▼                 ▼                  ▼
  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
  │  WARNING     │ │ DECELERATION │ │ EMERGENCY    │
  │  警告区      │ │  减速区      │ │  急停区      │
  │  速度<=50%   │ │  速度<=0.3m/s│ │  速度=0      │
  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘
         │                │                │
         └────────────────┴────────────────┘
                           │ 障碍物消失
                           ▼
                    ┌────────────────┐
                    │   SAFE (恢复)   │
                    └────────────────┘

  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
  │ MINOR_FAULT  │  │ MODERATE_FAULT│  │ SEVERE_FAULT│
  │ 降速至0.5m/s │  │ 降速/重定位  │  │ 急停+锁定    │
  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘
         │                 │                 │
         ▼                 ▼                 ▼
   自动恢复           30s超时->停车      人工介入恢复
```

#### 6.5.2 状态转换矩阵

| 当前状态 | 事件 | 下一状态 | 动作 |
|---------|------|---------|------|
| SAFE | LiDAR 检测 < 0.5m | DECELERATION | 限速 0.3m/s |
| SAFE | LiDAR 检测 < 0.2m | EMERGENCY | 急停 |
| SAFE | 轻微故障 | MINOR_FAULT | 降速 0.5m/s |
| SAFE | 中等故障 | MODERATE_FAULT | 降速 + 重定位 |
| SAFE | 严重故障 | SEVERE_FAULT | 急停 + 锁定 |
| DECELERATION | 障碍物远离 (> 0.5m) | SAFE | 逐步恢复 |
| DECELERATION | 距离缩短 (< 0.2m) | EMERGENCY | 急停 |
| EMERGENCY | 人工清除急停 | SAFE | 需人工确认 |
| MINOR_FAULT | 故障恢复 | SAFE | 自动恢复全速 |
| MODERATE_FAULT | 重定位成功 | SAFE | 自动恢复 |
| MODERATE_FAULT | 30s 未恢复 | SEVERE_FAULT | 停车锁定 |
| SEVERE_FAULT | 人工修复完成 | SAFE | 人工恢复 |

### 6.6 安全关键路径代码约束

```
安全关键路径代码约束 (Safety-Critical Code Constraints):

1. 语言约束
   ├── 安全相关节点必须使用 C++17 实现
   └── 禁止使用 Python (GC 不确定性)

2. 内存约束
   ├── 安全关键路径禁止动态内存分配 (new/malloc)
   ├── 使用栈分配或预分配内存池
   └── 固定大小缓冲区

3. 实时性约束
   ├── 安全监控线程优先级最高 (SCHED_FIFO, priority=90)
   ├── 禁止安全路径上的阻塞调用 (sleep/mutex wait)
   └── 心跳间隔 <= 100ms，检测超时 <= 500ms

4. 通信约束
   ├── 安全相关话题使用 Reliable QoS
   ├── 安全相关话题禁止使用 BestEffort
   └── 急停指令使用独立话题，不与其他控制指令复用

5. 需使用 C++ 实现的安全节点
   ├── agv_core::safety_guardian
   ├── agv_core::mode_manager
   ├── agv_core::heartbeat_monitor
   ├── agv_safety::emergency_handler
   ├── agv_safety::safety_zone_detector
   ├── agv_safety::heartbeat_generator
   ├── agv_localization::amcl_localizer
   ├── agv_localization::relocalizer
   ├── agv_navigation::global_planner
   ├── agv_navigation::local_planner
   ├── agv_navigation::costmap_manager
   ├── agv_control::motion_controller
   ├── agv_control::velocity_limiter
   └── agv_control::manual_controller

6. 允许使用 Python 实现的非安全节点
   ├── agv_scheduler::task_scheduler
   ├── agv_fleet_manager::fleet_scheduler
   ├── agv_fleet_manager::deadlock_detector
   ├── agv_api_gateway::api_gateway
   └── agv_traffic_control::traffic_controller
```

### 6.7 急停恢复流程

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
软件急停清除 (调用 ClearEstop 服务)
    │
    ├── 本地: ros2 service call /agv_<id>/safety_guardian/clear_emergency
    ├── 远程: WebSocket type: command (clear_emergency)
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
恢复自动模式 -> 任务恢复或重新分配
```

---

## 7. 项目目录结构

### 7.1 推荐工作空间布局

```
agv_fleet_ws/                              # ROS2 工作空间根目录
├── src/                                   # 源代码目录
│   ├── agv_msgs/                          # [接口包] 自定义消息/服务/动作 (已实现)
│   │   ├── msg/                           #   14 消息定义 (完整)
│   │   ├── srv/                           #   20 服务定义 (完整)
│   │   ├── action/                        #   5 动作定义 (完整)
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_core/                          # [C++] 核心生命周期与安全守护 (已实现)
│   │   ├── include/agv_core/
│   │   │   ├── constants.h
│   │   │   ├── types.h
│   │   │   ├── utils.h
│   │   │   └── lifecycle/lifecycle_manager.h
│   │   ├── src/
│   │   │   ├── types.cpp
│   │   │   ├── utils.cpp
│   │   │   ├── lifecycle/lifecycle_manager.cpp
│   │   │   ├── safety_guardian_node.cpp      # [需新增]
│   │   │   ├── safety_guardian.hpp           # [需新增]
│   │   │   ├── mode_manager_node.cpp         # [需新增]
│   │   │   ├── mode_manager.hpp              # [需新增]
│   │   │   ├── heartbeat_monitor_node.cpp    # [需新增]
│   │   │   └── heartbeat_monitor.hpp         # [需新增]
│   │   ├── launch/
│   │   │   └── core.launch.py                # [需新增]
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_localization/                   # [C++] 定位 (需实现)
│   │   ├── config/
│   │   │   └── amcl_params.yaml             # AMCL 参数配置
│   │   ├── src/
│   │   │   ├── amcl_localizer_node.cpp      # AMCL 包装节点
│   │   │   ├── amcl_localizer.hpp
│   │   │   ├── relocalizer_node.cpp
│   │   │   └── relocalizer.hpp
│   │   ├── launch/
│   │   │   └── localization.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_navigation/                     # [C++] 导航 (需实现)
│   │   ├── config/
│   │   │   ├── global_planner_params.yaml
│   │   │   ├── local_planner_params.yaml
│   │   │   └── costmap_params.yaml
│   │   ├── src/
│   │   │   ├── global_planner_node.cpp
│   │   │   ├── global_planner.hpp
│   │   │   ├── local_planner_node.cpp
│   │   │   ├── local_planner.hpp
│   │   │   ├── costmap_manager_node.cpp
│   │   │   └── costmap_manager.hpp
│   │   ├── launch/
│   │   │   └── navigation.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_control/                        # [C++] 运动控制 (已实现, 需适配)
│   │   ├── include/agv_control/
│   │   │   ├── cmd_mux.h
│   │   │   └── odometry_publisher.h
│   │   ├── src/
│   │   │   ├── cmd_mux.cpp
│   │   │   ├── odometry_publisher.cpp
│   │   │   ├── motion_controller_node.cpp
│   │   │   ├── velocity_limiter_node.cpp    # [需新增]
│   │   │   ├── velocity_limiter.hpp         # [需新增]
│   │   │   ├── manual_controller_node.cpp   # [需新增]
│   │   │   └── manual_controller.hpp        # [需新增]
│   │   ├── config/
│   │   │   └── controller_params.yaml       # [需新增: 含边界限速参数]
│   │   ├── launch/
│   │   │   └── control.launch.py            # [需新增]
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_safety/                         # [C++] 安全逻辑 (需实现)
│   │   ├── src/
│   │   │   ├── emergency_handler_node.cpp
│   │   │   ├── emergency_handler.hpp
│   │   │   ├── safety_zone_detector_node.cpp
│   │   │   ├── safety_zone_detector.hpp
│   │   │   ├── heartbeat_generator_node.cpp
│   │   │   └── heartbeat_generator.hpp
│   │   ├── config/
│   │   │   └── safety_params.yaml
│   │   ├── launch/
│   │   │   └── safety.launch.py
│   │   ├── test/
│   │   ├── package.xml
│   │   └── CMakeLists.txt
│   │
│   ├── agv_scheduler/                      # [Python] 任务调度 (需实现)
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
│   ├── agv_fleet_manager/                  # [Python] 车队管理 (需实现)
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
│   ├── agv_traffic_control/                # [Python] 交通控制 (需实现)
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
│   ├── agv_api_gateway/                    # [Python] API 网关 (需重写)
│   │   ├── agv_api_gateway/
│   │   │   ├── __init__.py
│   │   │   ├── api_gateway_node.py
│   │   │   ├── ws_server.py               # WebSocket 服务器
│   │   │   ├── rest_server.py             # REST 兼容层
│   │   │   ├── auth.py
│   │   │   └── routes/
│   │   │       ├── __init__.py
│   │   │       ├── tasks.py
│   │   │       ├── agvs.py
│   │   │       ├── fleet.py
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
│   ├── agv_simulation/                     # [Python] 仿真 (需重建)
│   │   ├── urdf/
│   │   │   ├── agv.urdf.xacro              # [需修改: 仅 2D LiDAR + 里程计]
│   │   │   ├── agv.gazebo.xacro
│   │   │   ├── sensors/
│   │   │   │   └── lidar_2d.xacro          # [需新增: 2D LiDAR 仿真]
│   │   │   └── materials.xacro
│   │   ├── meshes/
│   │   │   ├── chassis.stl
│   │   │   ├── wheel.stl
│   │   │   └── sensor_mount.stl
│   │   ├── worlds/
│   │   │   └── warehouse.world             # [需重建: Gazebo Classic 格式]
│   │   ├── models/
│   │   │   ├── shelf/
│   │   │   ├── charging_station/
│   │   │   └── loading_dock/
│   │   ├── config/
│   │   │   └── simulation_params.yaml
│   │   ├── launch/
│   │   │   ├── simulation.launch.py        # [需新增]
│   │   │   └── spawn_agv.launch.py         # [需新增: 参数化命名空间]
│   │   ├── test/
│   │   ├── package.xml                     # [需新增]
│   │   ├── CMakeLists.txt                  # [需新增]
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   ├── agv_visualization/                  # [Python] 可视化 (需实现)
│   │   ├── rviz/
│   │   │   ├── agv_single.rviz
│   │   │   └── agv_fleet.rviz
│   │   ├── launch/
│   │   │   └── viz.launch.py
│   │   ├── package.xml
│   │   ├── setup.py
│   │   └── setup.cfg
│   │
│   └── agv_tools/                          # [Python] 工具包 (需实现)
│       ├── agv_tools/
│       │   └── __init__.py
│       ├── scripts/
│       │   ├── agv_control_cli.py
│       │   ├── fleet_monitor.py
│       │   └── diagnostics.py
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
│   ├── network_params.yaml                #   网络参数 (含 DDS 配置路径)
│   └── agv_specific/                      #   单 AGV 特定参数
│       ├── agv_001_params.yaml
│       └── agv_002_params.yaml
│
├── dds_config/                            # DDS 配置文件
│   ├── fastdds_default.xml                #   仿真模式 (Simple Discovery)
│   └── fastdds_lan.xml                    #   真机模式 (Discovery Server)
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
│   ├── integration/                       #   集成测试
│   ├── performance/                       #   性能测试
│   └── simulation/                        #   仿真测试
│
├── colcon.meta                            # Colcon 编译元配置
├── .gitignore
└── README.md
```

### 7.2 包依赖关系

```
agv_msgs (接口包, 无运行时依赖)
    ↑
    ├── agv_core (C++)
    │    依赖: rclcpp, rclcpp_lifecycle, agv_msgs, diagnostic_msgs
    │
    ├── agv_localization (C++)
    │    依赖: rclcpp, agv_msgs, nav_msgs, sensor_msgs, nav2_amcl, tf2
    │
    ├── agv_navigation (C++)
    │    依赖: rclcpp, agv_msgs, nav2_msgs, nav2_core, nav2_costmap_2d,
    │           nav2_navfn_planner, nav2_smac_planner, tf2_geometry_msgs
    │
    ├── agv_control (C++)
    │    依赖: rclcpp, agv_msgs, agv_core, geometry_msgs, nav_msgs, tf2
    │
    ├── agv_safety (C++)
    │    依赖: rclcpp, agv_msgs, std_msgs, sensor_msgs, visualization_msgs
    │
    ├── agv_scheduler (Python)
    │    依赖: rclpy, agv_msgs, geometry_msgs
    │
    ├── agv_fleet_manager (Python)
    │    依赖: rclpy, agv_msgs, geometry_msgs, networkx (死锁检测)
    │
    ├── agv_api_gateway (Python)
    │    依赖: rclpy, agv_msgs, fastapi (REST), uvicorn, websockets (WS),
    │           httpx, pyyaml
    │
    ├── agv_traffic_control (Python)
    │    依赖: rclpy, agv_msgs, geometry_msgs, pyyaml
    │
    ├── agv_simulation (Python)
    │    依赖: xacro, gazebo_ros_pkgs, gazebo_ros2_control
    │
    ├── agv_tools (Python)
    │    依赖: rclpy, agv_msgs
    │
    └── agv_visualization (Python)
         依赖: rclpy
```

### 7.3 删除的包

以下 v1.0 中的包在 v2.0 中不再存在：

| 包名 | 原因 |
|------|------|
| `agv_perception` | 传感器简化为仅 2D LiDAR + 里程计，功能并入 agv_safety (safety_zone_detector) 和 agv_navigation (local_planner 直接订阅 lidar/scan) |

---

## 8. 与现有代码的对照

### 8.1 现有代码复用对照表

| 包 | 现有文件 | 复用方式 | 需修改 | 说明 |
|---|---------|---------|-------|------|
| **agv_msgs** | 14 msg, 20 srv, 5 action | **全部复用** | 新增 3 个 | 见下方 |
| **agv_core** | constants.h, types.h, utils.h, lifecycle_manager | **全部复用** | 无 | 常量命名主题需验证与 v2.0 一致 |
| **agv_control** | cmd_mux.h, odometry_publisher.h, motion_controller_node.cpp | **全部复用** | 增加节点 | 需新增 velocity_limiter, manual_controller |
| **agv_simulation** | warehouse.world, agv.urdf.xacro, shelf/model.sdf 等 | **需重建** | 大幅修改 | 见下方 |

### 8.2 agv_msgs 需新增的接口

根据 v2.0 架构设计，agv_msgs 需新增以下 3 个接口：

**新增消息 (1)**：

| 消息名 | 字段 | 说明 |
|--------|------|------|
| `DeadlockInfo.msg` | `string[] involved_agvs; string description; uint8 DETECTED=0; uint8 RESOLVING=1; uint8 RESOLVED=2; uint8 status` | 死锁信息 |

**新增服务 (2)**：

| 服务名 | 请求 | 响应 | 说明 |
|--------|------|------|------|
| `SetMode.srv` | `uint8 AUTO=0; uint8 MANUAL=1; uint8 mode` | `bool success; string message` | 模式切换 |
| `RegisterAGV.srv` | `string agv_id; string ip_address; float32 max_linear_velocity; float32 max_angular_velocity` | `bool success; string fleet_id` | AGV 注册 |

### 8.3 agv_control 需新增的节点

| 节点 | 文件 | 说明 |
|------|------|------|
| `velocity_limiter` | `src/velocity_limiter_node.cpp`, `include/agv_control/velocity_limiter.h` | 三层限幅实现 |
| `manual_controller` | `src/manual_controller_node.cpp`, `include/agv_control/manual_controller.h` | 手柄/键盘控制 |

**cmd_mux 需修改**：增加优先级源枚举，确保安全指令源具有最高优先级：
```
enum class CmdSource : uint8_t {
  SAFETY = 0,       // 最高优先级 (急停/安全)
  LOCAL_PLANNER = 1, // 局部规划器
  GLOBAL_PLANNER = 2, // 全局规划器
  MANUAL = 3        // 最低优先级 (手动控制)
};
```

### 8.4 agv_simulation 需重建的内容

| 文件 | 变更类型 | v1.0 (Ignition) | v2.0 (Gazebo Classic) |
|------|---------|-----------------|----------------------|
| `worlds/warehouse.world` | 重建 | Ignition SDF 格式 | Gazebo Classic SDF 格式 |
| `urdf/agv.urdf.xacro` | 修改 | 含 3D LiDAR + RGB-D + IMU | 仅 2D LiDAR + 里程计 |
| `urdf/sensors/lidar.xacro` | 删除 | 3D LiDAR (16线) | 删除，改为 2D LiDAR |
| `urdf/sensors/lidar_2d.xacro` | 新增 | 无 | 2D LiDAR SICK TiM 仿真 |
| `urdf/sensors/camera.xacro` | 删除 | RGB-D 摄像头 | 删除 |
| `urdf/sensors/imu.xacro` | 删除 | IMU | 删除 |
| `launch/simulation.launch.py` | 新增 | 无 | Gazebo Classic 启动 |
| `launch/spawn_agv.launch.py` | 新增 | 无 | 参数化多 AGV 生成 |
| `package.xml` | 新增 | 无 | 依赖: gazebo_ros_pkgs |
| `CMakeLists.txt` | 新增 | 无 | Xacro 构建配置 |

**AGV URDF 传感器配置变更**：
```
v1.0: 3D LiDAR (16线, 30m) + 前置 RGB-D 摄像头 + 后置 RGB-D 摄像头 + IMU
v2.0: 2D LiDAR (SICK TiM 系列, >=15Hz, >=10m) + 轮式编码器 (来自 diff_drive 插件)
```

**多 AGV 命名空间参数化**：URDF 中的传感器话题需从硬编码 `/agv_01` 改为通过 Xacro 参数传入：
```xml
<xacro:arg name="namespace" default="agv_01"/>
<!-- LiDAR 话题使用 ${namespace}/lidar/scan -->
<plugin name="lidar_controller" filename="libgazebo_ros_ray_sensor.so">
  <topic_name>${namespace}/lidar/scan</topic_name>
  ...
</plugin>
```

### 8.5 已删除的包：agv_perception

v1.0 中的 `agv_perception` 包包含 `sensor_fusion` 和 `safety_zone_detector` 两个节点。
v2.0 中：

- `sensor_fusion` — **删除**。不再需要融合多传感器（仅 2D LiDAR）
- `safety_zone_detector` — **移入 agv_safety 包**。功能保留，但输入从融合点云改为直接订阅 `/agv_<id>/lidar/scan`

### 8.6 验收标准对照

| 编号 | 验收项 | 量化指标 | 架构设计目标 | 关键模块 |
|------|--------|---------|------------|---------|
| AC-1 | 全局路径规划延迟 | <200ms (95 分位) | A* 重规划 <= 150ms | agv_navigation::global_planner |
| AC-2 | 局部避障延迟 | <50ms (95 分位) | DWA/TEB 避障 <= 40ms | agv_navigation::local_planner |
| AC-3 | 定位精度 | ±5cm (均值) | AMCL ±3cm (95%) | agv_localization::amcl_localizer |
| AC-4 | 停靠精度 | ±2cm (均值) | AMCL + 精确停靠 ±1.5cm | agv_localization + agv_control |
| AC-5 | 急停响应时间 | <100ms | 硬件 <50ms, 软件 <80ms | agv_safety::emergency_handler |
| AC-6 | 系统可靠性 | 连续运行 24h 无崩溃 | 心跳监控 + 故障分级 | agv_core::safety_guardian |
| AC-7 | WMS 通信 | 往返 <500ms, 丢包率=0 | WebSocket Reliable QoS | agv_api_gateway |

---

## 附录

### A. 关键性能指标对照

| 指标 | 需求值 | 架构设计目标 | 验证方法 |
|------|--------|------------|---------|
| 控制回路频率 | >= 20Hz | 20Hz (50ms) | ros2 topic hz |
| 全局路径规划 | <200ms (95分位) | A* <= 150ms | 计时日志 |
| 局部避障延迟 | <50ms (95分位) | DWA/TEB <= 40ms | 时间戳记录 |
| 急停响应 | <100ms | 硬件 <50ms, 软件 <80ms | 示波器/仿真注入 |
| 定位精度 | ±5cm | ±3cm (95%) | 仿真真值对比 |
| 停靠精度 | ±2cm | ±1.5cm (95%) | 仿真真值对比 |
| 重定位恢复 | <= 5s | <= 3s | 仿真注入定位丢失 |
| 系统频率 | >= 20Hz | 20Hz 控制循环 | ros2 topic hz |
| WMS 消息往返 | <500ms | <200ms (P99) | 压力测试 |
| WMS 丢包率 | 0% | 0% (Reliable QoS) | 序列号检测 |

### B. 不确定项依赖

| # | 不确定项 | 影响的设计决策 | 默认假设值 | 变更影响 |
|---|---------|--------------|-----------|---------|
| 1 | AGV 数量 | 调度算法复杂度 | TBD (仿真 3 台起) | 调整 fleet_params.yaml |
| 2 | AGV 计算平台 | 编译目标、性能基线 | TBD (x86_64) | 调整 CMakeLists.txt |
| 3 | 最大并发 AGV | 中央调度负载 | 10 台 | 调整 fleet_params.yaml |
| 4 | 充电策略 | 任务调度逻辑 | 手动换电 | 增加 Charge action 调用 |
| 5 | 网络拓扑 | DDS 发现模式 | Fast DDS Discovery Server | 切换 fastdds_lan.xml |

### C. v1.0 -> v2.0 关键文件变更清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `agv_fleet_architecture.md` | 废弃 | 由 v2.0 取代 |
| `agv_fleet_architecture_v2.0.md` | **新增** | 本文件 |
| `agv_msgs/msg/DeadlockInfo.msg` | **新增** | 死锁信息消息 |
| `agv_msgs/srv/SetMode.srv` | **新增** | 模式切换服务 |
| `agv_msgs/srv/RegisterAGV.srv` | **新增** | AGV 注册服务 |
| `agv_control/src/velocity_limiter_node.cpp` | **新增** | 速度限幅节点 |
| `agv_control/src/manual_controller_node.cpp` | **新增** | 手动控制节点 |
| `agv_perception/` (整个包) | **删除** | 功能并入 agv_safety |
| `agv_safety/src/safety_zone_detector_node.cpp` | **新增** | 从 agv_perception 移入 |
| `agv_simulation/urdf/sensors/lidar_2d.xacro` | **新增** | 2D LiDAR 仿真 |
| `agv_simulation/urdf/sensors/camera.xacro` | **删除** | 不再需要 |
| `agv_simulation/urdf/sensors/imu.xacro` | **删除** | 不再需要 |
| `agv_api_gateway/agv_api_gateway/ws_server.py` | **新增** | WebSocket 服务器 |
| `agv_fleet_ws/dds_config/fastdds_default.xml` | **新增** | 仿真 DDS 配置 |
| `agv_fleet_ws/dds_config/fastdds_lan.xml` | **新增** | 真机 DDS 配置 |

---

**文档结束**
