# AGV 多车协同调度与安全协同平台 —— 最终顶层架构设计文档

> 版本：v2.0（最终版） | 日期：2026-07-01 | 状态：已整合确认，可直接用于开发

---

## 1. 文档概述

### 1.1 文档目的

本文档基于需求文档 v1.0 整合两份已有架构设计（architecture_design_v1.0.md 与 agv_multi_vehicle_architecture.md），消除冲突与不一致，修正与需求不符的参数，形成一份完整的、无冲突的、可落地的顶层架构设计文档。

### 1.2 整合说明

| 来源文档 | 版本 | 核心特点 |
|----------|------|----------|
| architecture_design_v1.0.md | v1.0 | 简洁清晰，模块划分明确，接口规范完整 |
| agv_multi_vehicle_architecture.md | v1.0 | 分层架构详尽，安全设计完整，仿真方案具体，技术选型分析深入 |

**整合策略**：以需求文档确认参数为基准，消除所有冲突，保留两份文档的精华部分。

### 1.3 关键冲突修正记录

| 冲突项 | v1.0 简洁版 | 详细版 | 最终采用（以需求为准） |
|--------|-------------|--------|----------------------|
| AGV 尺寸 | 未明确 | 1.2m × 0.8m × 0.5m | **800mm × 600mm × 300mm** |
| 最大速度 | 1.5 m/s（隐式） | 2.0 m/s | **1.5 m/s**（需求明确） |
| 仓库面积 | 未明确 | 1000~5000 m² | **500 m²（25m × 20m）** |
| 货架布局 | 未涉及 | 通用仓储布局 | **4 排 × 10 组货架，2 主通道(3m) + 4 副通道(2m)** |
| 传感器配置 | 仅 LiDAR+IMU+Odometry | 16 线 LiDAR | **3D LiDAR + RGB-D + IMU + 超声波阵列 + 双通道安全 PLC + 安全触边** |
| 安全距离 | 0.3m 急停 | 0.3m 急停 | **前方 0.8m / 侧方后方 0.3m / 减速 0.5m** |
| 全局规划算法 | Hybrid-A* | A*（默认） | **Hybrid-A***（考虑差速模型运动学约束） |
| 局部规划算法 | DWA（默认） | TEB（默认） | **TEB**（多约束优化，差速模型天然适配） |
| Topic 命名 | `/agv_{N}/...` | `/fleet/agv_XX/...` | **`/agv_{N}/...`**（简洁明确，命名空间隔离好） |
| 调度算法 | 贪心匹配 | 拍卖算法 | **改进型拍卖算法（优先级感知）** |
| API 网关语言 | Python | C++ | **Python**（非实时层，开发效率优先） |
| 安全节点命名 | safety_guard | safety_controller + safety_monitor | **safety_guard（车载）+ fleet_safety_monitor（中心）** |
| AGV 数量 | 10~20 | 10~20 | **3~5 台（可扩展至 10 台）** |
| 载荷 | 未明确 | 未明确 | **500 kg** |
| 急停按钮 | 未涉及 | 仿真按钮 | **四面各 1 个 + 控制台总急停 + 安全门联锁** |

---

## 2. 术语表与约定

### 2.1 术语表

| 术语 | 含义 |
|------|------|
| AGV | Automated Guided Vehicle，自动导引车 |
| FMS | Fleet Management System，车队管理系统 |
| DDS | Data Distribution Service，数据分发服务 |
| SIL | Safety Integrity Level，安全完整性等级 |
| SLC | Safety Logic Controller，安全逻辑控制器 |
| TEB | Timed Elastic Band，定时弹性带（局部路径规划） |
| EKF | Extended Kalman Filter，扩展卡尔曼滤波 |
| AMCL | Adaptive Monte Carlo Localization，自适应蒙特卡洛定位 |
| ROS2 | Robot Operating System 2 |
| HAL | Hardware Abstraction Layer，硬件抽象层 |
| PLC | Programmable Logic Controller，可编程逻辑控制器 |

### 2.2 命名约定

| 类别 | 约定格式 | 示例 |
|------|----------|------|
| ROS2 包名 | `agv_<功能>` | `agv_scheduler`, `agv_navigation` |
| ROS2 节点名 | `<功能>`（中心）/ `<agv_id>_<功能>`（车载） | `task_manager`, `agv_01_global_planner` |
| Topic 名 | `/agv_{N}/<功能>`（车载）/ `/fleet/<功能>`（中心） | `/agv_01/cmd_vel`, `/fleet/task_broadcast` |
| Service 名 | `/api/<功能>`（外部）/ `/agv_{N}/<功能>`（车载） | `/api/submit_task`, `/agv_01/emergency_stop` |
| Action 名 | `/agv_{N}/<功能>` | `/agv_01/navigate_to` |
| 参数名 | `<模块>.<参数>` | `safety_guard.max_speed` |
| 坐标系 | `map`, `odom`, `base_footprint`, `base_laser` | 遵循 REP 105 |

---

## 3. 系统顶层架构

### 3.1 架构风格：集中调度 + 分布式执行的混合架构

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                   应用层 (Application Layer)                               │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────────────────┐   │
│  │  Foxglove Studio     │  │  REST API Client     │  │  CLI 管理工具                │   │
│  │  (运营监控可视化)     │  │  (WMS 外部系统对接)   │  │  (诊断/调试/日志)            │   │
│  └──────────┬───────────┘  └──────────┬───────────┘  └─────────────┬────────────────┘   │
└─────────────┼─────────────────────────┼───────────────────────────┼──────────────────────┘
              │                         │                           │
┌─────────────┼─────────────────────────┼───────────────────────────┼──────────────────────┐
│             ▼                         ▼                           ▼                       │
│                             业务层 (Business Logic Layer)                                 │
│  ┌────────────────────────────────────────────────────────────────────────────────────┐  │
│  │                               中心服务器 (Central Server)                           │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐  │  │
│  │  │  task_manager   │  │  fleet_monitor  │  │  traffic_       │  │  map_server  │  │  │
│  │  │ (全局任务调度器) │  │ (车队状态监控)   │  │  controller     │  │ (地图服务)   │  │  │
│  │  └────────┬────────┘  └────────┬────────┘  │ (交通管制器)    │  └──────────────┘  │  │
│  │           │                     │            └────────┬────────┘                     │  │
│  │           └─────────────────────┼─────────────────────┘                             │  │
│  │                                 │                                                   │  │
│  │  ┌─────────────────┐  ┌────────┴────────┐  ┌─────────────────┐  ┌──────────────┐  │  │
│  │  │  api_gateway    │  │ fleet_safety_   │  │  web_bridge     │  │ charge_      │  │  │
│  │  │ (API 网关)      │  │ monitor         │  │ (WebSocket 桥接)│  │ scheduler    │  │  │
│  │  └─────────────────┘  │ (全局安全监控)   │  └─────────────────┘  │ (充电调度)   │  │  │
│  │                       └─────────────────┘                       └──────────────┘  │  │
│  └──────────────────────────────────┬─────────────────────────────────────────────────┘  │
│                                      │                                                    │
│                                     ROS2 DDS (Fast-DDS, Domain ID=10, WiFi 5/6)           │
│                                      │                                                    │
│  ┌──────────────────────────────────┼─────────────────────────────────────────────────┐  │
│  │                                  ▼                                                   │  │
│  │                          车载端 (Onboard - 每台 AGV)                                  │  │
│  │  ┌──────────────────────────────────────────────────────────────────────────────┐  │  │
│  │  │  ROS2 Node Namespace: /agv_{01..10}                                          │  │  │
│  │  │                                                                              │  │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │  │
│  │  │  │ global_      │  │ local_       │  │ localization │  │ safety_      │    │  │  │
│  │  │  │ planner      │  │ planner      │  │ (多传感器    │  │ guard        │    │  │  │
│  │  │  │ (全局路径)   │  │ (局部规划+   │  │  融合定位)   │  │ (安全防护)   │    │  │  │
│  │  │  │              │  │  避障)       │  │              │  │              │    │  │  │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │  │  │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │  │  │
│  │  │  │ motion_      │  │ battery_     │  │ lifecycle_   │  │ sensor_      │    │  │  │
│  │  │  │ controller   │  │ manager      │  │ manager      │  │ fusion       │    │  │  │
│  │  │  │ (运动控制)   │  │ (电池管理)    │  │ (生命周期)   │  │ (传感器融合) │    │  │  │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘    │  │  │
│  │  └──────────────────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────────────────────────────────┐
│                                        ▼                                                │
│                              核心算法层 (Core Algorithm Layer)                           │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌──────────────────┐ │
│  │ Hybrid-A*  │  │ TEB        │  │ EKF /      │  │ FCL 碰撞   │  │ 死锁检测         │ │
│  │ / A*       │  │ / DWA      │  │ AMCL       │  │ 检测       │  │ (资源分配图)     │ │
│  │ 全局路径   │  │ 局部轨迹   │  │ 定位融合   │  │            │  │                  │ │
│  └────────────┘  └────────────┘  └────────────┘  └────────────┘  └──────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
                                         │
┌────────────────────────────────────────┼────────────────────────────────────────────────┐
│                                        ▼                                                │
│                        硬件抽象层 / 仿真层 (HAL / Simulation Layer)                      │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │  ROS2 消息 / Service / Action 抽象接口层                                          │  │
│  │  ┌────────────────────────────┐         ┌────────────────────────────────────┐  │  │
│  │  │ 仿真模式 (Sim Mode)        │         │ 硬件模式 (Real Mode) — 预留         │  │  │
│  │  │ - Gazebo Ignition Fortress │         │ - 真实 3D LiDAR 驱动               │  │  │
│  │  │ - 仿真传感器插件           │         │ - 真实底盘驱动                     │  │  │
│  │  │ - 仿真底盘控制插件          │         │ - 真实 IMU / 超声波 / 安全 PLC 驱动 │  │  │
│  │  └────────────────────────────┘         └────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 分层职责说明

| 层级 | 部署位置 | 职责 | 关键模块 |
|------|----------|------|----------|
| **应用层** | 中心服务器 / 独立前端 | 人机交互、外部系统对接、运营监控 | Foxglove Studio、REST API 客户端、CLI 工具 |
| **业务层（中心）** | 中心服务器 | 任务调度、车队管理、交通管制、全局安全监控、地图服务、充电调度 | task_manager, fleet_monitor, traffic_controller, fleet_safety_monitor, map_server, charge_scheduler |
| **业务层（车载）** | 车载计算平台 | 路径规划、局部避障、传感器融合定位、安全防护、运动控制、电池管理 | global_planner, local_planner, localization, safety_guard, motion_controller, battery_manager |
| **核心算法层** | 车载端 | 算法实现、计算密集型任务 | Hybrid-A* / A*, TEB / DWA, EKF / AMCL, FCL 碰撞检测, 死锁检测 |
| **硬件抽象层/仿真层** | 车载端 / 仿真端 | 硬件抽象、仿真桥接、传感器驱动抽象 | ros_ign_bridge, 传感器驱动, 底盘控制抽象 |

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

| 接口方向 | 协议 | 数据内容 | 频率/响应时间 |
|----------|------|----------|---------------|
| 应用层 → 业务层(中心) | REST/WS | 任务请求、地图编辑、状态查询 | 按需 |
| 业务层(中心) → 业务层(车载) | ROS2 DDS | 任务分配、交通管制指令、全局地图 | 100Hz |
| 业务层(车载) → 核心算法层 | ROS2 DDS | 目标位姿、规划请求 | ≤ 50ms |
| 核心算法层 → 硬件抽象层 | ROS2 DDS | 速度指令 cmd_vel | 100Hz |
| 硬件抽象层 → 核心算法层 | ROS2 DDS | 传感器数据 (LiDAR/IMU/里程计) | ≥ 50Hz |

---

## 4. ROS2 节点拓扑设计

### 4.1 节点清单

#### 4.1.1 中心服务器节点（运行于中央工控机）

| 节点名 | ROS2 包 | 功能描述 | 语言 | 实时性 |
|--------|---------|----------|------|--------|
| `task_manager` | `agv_scheduler` | 全局任务调度：任务分配、优先级管理、负载均衡 | C++17 | 软实时 (100Hz) |
| `fleet_monitor` | `agv_fleet_manager` | 车队状态监控：AGV 状态聚合、健康监控、告警管理 | C++17 | 非实时 (10Hz) |
| `traffic_controller` | `agv_traffic_control` | 交通管制：交叉口管理、路径段锁、死锁检测与解锁 | C++17 | 软实时 (50Hz) |
| `charge_scheduler` | `agv_scheduler` | 充电调度：低电量触发、充电站分配 | C++17 | 非实时 (1Hz) |
| `api_gateway` | `agv_api_gateway` | REST API 网关：WMS 对接、任务/状态查询 | Python 3.10 | 非实时 |
| `web_bridge` | `agv_visualization` | WebSocket 桥接：转发 ROS2 话题到 Web 前端 | Python 3.10 | 非实时 |
| `fleet_safety_monitor` | `agv_safety` | 全局安全监控：全车队急停、全局看门狗 | C++17 | 硬实时 (100Hz) |
| `map_server` | `agv_map_server` | 全局地图服务：地图加载、代价地图生成 | C++17 | 非实时 |

#### 4.1.2 车载端节点（每台 AGV 各运行一份，共 3~5 台，可扩展至 10 台）

| 节点名 | ROS2 包 | 功能描述 | 语言 | 实时性 |
|--------|---------|----------|------|--------|
| `agv_{N}_global_planner` | `agv_navigation` | 全局路径规划：地图 → 最优路径（Hybrid-A*） | C++17 | 软实时 (≤ 50ms) |
| `agv_{N}_local_planner` | `agv_navigation` | 局部路径规划：轨迹跟踪 + 动态避障（TEB） | C++17 | 硬实时 (≤ 10ms, 100Hz) |
| `agv_{N}_localization` | `agv_localization` | 传感器融合定位：EKF + AMCL | C++17 | 硬实时 (≥ 50Hz) |
| `agv_{N}_safety_guard` | `agv_safety` | 安全防护：双路急停、三层速度限幅、碰撞保护 | C++17 | 硬实时 (≤ 10ms) |
| `agv_{N}_motion_controller` | `agv_control` | 运动控制：速度控制器、指令复用器 | C++17 | 硬实时 (100Hz) |
| `agv_{N}_battery_manager` | `agv_control` | 电池管理：电池仿真模型、充电策略决策 | C++17 | 非实时 (1Hz) |
| `agv_{N}_lifecycle_manager` | `agv_core` | 生命周期管理：启动/停止/降级/恢复 | C++17 | 非实时 |
| `agv_{N}_sensor_fusion` | `agv_localization` | 传感器数据预处理与时间戳同步 | C++17 | 软实时 (100Hz) |

#### 4.1.3 仿真专用节点（仅仿真模式运行）

| 节点名 | ROS2 包 | 功能描述 | 语言 |
|--------|---------|----------|------|
| `ros_gz_bridge` | `ros_gz_bridge` | Gazebo ↔ ROS2 桥接 | C++ |
| `spawn_agv_manager` | `agv_simulation` | 多 AGV 生成管理：批量生成/删除 AGV 模型 | Python |
| `scenario_manager` | `agv_simulation` | 仿真场景管理：动态障碍物、任务预设场景 | Python |
| `performance_monitor` | `agv_simulation` | 仿真性能监控：实时因子、资源占用 | Python |

### 4.2 节点拓扑总览

| 位置 | 节点名称 | 实现语言 | 实时性 | 数量 |
|------|----------|----------|--------|------|
| **中心服务器** | `task_manager` | C++17 | 软实时 (100Hz) | 1 |
| | `fleet_monitor` | C++17 | 非实时 (10Hz) | 1 |
| | `traffic_controller` | C++17 | 软实时 (50Hz) | 1 |
| | `charge_scheduler` | C++17 | 非实时 (1Hz) | 1 |
| | `api_gateway` | Python 3.10 | 非实时 | 1 |
| | `web_bridge` | Python 3.10 | 非实时 | 1 |
| | `fleet_safety_monitor` | C++17 | 硬实时 (100Hz) | 1 |
| | `map_server` | C++17 | 非实时 | 1 |
| **车载端** ×N | `agv_{N}_global_planner` | C++17 | 软实时 (≤ 50ms) | 3~10 |
| | `agv_{N}_local_planner` | C++17 | 硬实时 (≤ 10ms) | 3~10 |
| | `agv_{N}_localization` | C++17 | 硬实时 (≥ 50Hz) | 3~10 |
| | `agv_{N}_safety_guard` | C++17 | 硬实时 (≤ 10ms) | 3~10 |
| | `agv_{N}_motion_controller` | C++17 | 硬实时 (100Hz) | 3~10 |
| | `agv_{N}_battery_manager` | C++17 | 非实时 (1Hz) | 3~10 |
| | `agv_{N}_lifecycle_manager` | C++17 | 非实时 | 3~10 |
| | `agv_{N}_sensor_fusion` | C++17 | 软实时 (100Hz) | 3~10 |
| **仿真环境** | Gazebo Ignition Fortress | - | - | 1 进程 |
| | `ros_gz_bridge` | C++ | - | 1~2 |

### 4.3 混合部署通信拓扑

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         中心服务器 (Central Server)                           │
│                                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ task_        │  │ fleet_       │  │ traffic_     │  │ charge_      │   │
│  │ manager      │  │ monitor      │  │ controller   │  │ scheduler    │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
│         │                 │                  │                 │            │
│         └─────────────────┼──────────────────┼─────────────────┘            │
│                           │                  │                              │
│  ┌──────────────┐  ┌──────┴──────────────────┴──────────┐  ┌────────────┐ │
│  │ api_gateway  │  │         DDS Domain (Domain ID: 10)  │  │ web_bridge │ │
│  │ map_server   │  └──────────────────┬──────────────────┘  │ fleet_     │ │
│  └──────────────┘                     │                     │ safety_    │ │
│                                       │                     │ monitor    │ │
└───────────────────────────────────────┼─────────────────────┴────────────┘ │
                                        │
                           ┌────────────┼────────────┐
                           │            │            │
                  ┌────────┴───┐  ┌─────┴────┐  ┌───┴────────┐
                  │ AGV 01     │  │ AGV 02   │  │ AGV 03..10 │
                  │ (Jetson    │  │ (...)    │  │ (...)      │
                  │  Orin)     │  │          │  │            │
                  └────────────┘  └──────────┘  └────────────┘
```

**通信说明：**
- 所有节点共享同一个 ROS2 DDS Domain（Domain ID = 10）
- 中心服务器与车载端通过 WiFi 5/6 在同一网段通信
- 使用 DDS 分区（Partition）机制隔离不同域的数据：
  - 分区 `fleet_control`：调度指令、交通管制
  - 分区 `agv_{N}_data`：各 AGV 传感器数据、状态
  - 分区 `fleet_monitor`：全局监控数据
- **[DEFAULT]** 使用 Fast DDS 作为默认 DDS 实现
- **[EXTENSION]** 预留 Cyclone DDS 切换支持（通过 ROS2 环境变量 `RMW_IMPLEMENTATION`）

---

## 5. 模块划分与职责定义

### 5.1 中心服务器模块

#### 5.1.1 task_manager（全局任务调度器）

```
agv_scheduler/
├── include/agv_scheduler/
│   ├── task_dispatcher.hpp        # 任务分发器
│   ├── task_scheduler.hpp         # 调度策略引擎（拍卖算法）
│   ├── task_queue.hpp             # 优先级任务队列
│   ├── fleet_state.hpp            # 车队状态聚合
│   └── charge_scheduler.hpp       # 充电调度
├── src/
│   ├── task_manager_node.cpp
│   ├── task_dispatcher.cpp
│   ├── task_scheduler.cpp
│   ├── task_queue.cpp
│   ├── fleet_state.cpp
│   └── charge_scheduler.cpp
├── config/
│   └── task_manager_params.yaml
└── launch/
    └── task_manager.launch.py
```

**职责**：
- 接收 API 网关下发的任务，维护优先级队列
- 根据车队状态（位置、电量、负载）进行任务-AGV 匹配
- 调度算法：改进型拍卖算法（优先级感知），支持动态切换
- 任务状态机：待分配 → 已分配 → 执行中 → 已完成/已失败/已取消
- 支持任务抢占（高优先级任务可抢占低优先级任务）
- 低电量 AGV（< 20%）自动触发充电任务，分配充电站

**任务优先级定义**：
| 优先级 | 说明 | 典型场景 |
|--------|------|----------|
| CRITICAL | 紧急任务，可抢占任何低优先级任务 | 安全事件、紧急运输 |
| HIGH | 高优先级，不可被 NORMAL/LOW 抢占 | 生产急单 |
| NORMAL | 普通优先级，默认级别 | 常规运输任务 |
| LOW | 低优先级，空闲时才执行 | 巡检、维护任务 |

#### 5.1.2 fleet_monitor（车队状态监控）

```
agv_fleet_manager/
├── include/agv_fleet_manager/
│   ├── fleet_tracker.hpp          # 车队位置追踪
│   ├── health_monitor.hpp         # 健康状态监控
│   └── alert_manager.hpp          # 告警管理器
├── src/
│   ├── fleet_monitor_node.cpp
│   ├── fleet_tracker.cpp
│   ├── health_monitor.cpp
│   └── alert_manager.cpp
├── config/
│   └── fleet_monitor_params.yaml
└── launch/
    └── fleet_monitor.launch.py
```

**职责**：
- 订阅所有 AGV 的心跳与状态，维护全局车队视图
- 检测异常（离线、超时、频繁故障）并生成告警
- 提供车队级统计指标（任务完成率、平均等待时间、碰撞次数）
- 为可视化提供聚合数据

#### 5.1.3 traffic_controller（交通管制器）

```
agv_traffic_control/
├── include/agv_traffic_control/
│   ├── traffic_controller.hpp     # 交通管制主控制器
│   ├── intersection_manager.hpp   # 交叉口管理
│   ├── path_segment_locker.hpp    # 路径段锁管理
│   ├── deadlock_detector.hpp      # 死锁检测
│   └── deadlock_resolver.hpp      # 死锁解锁
├── src/
│   ├── traffic_controller_node.cpp
│   ├── intersection_manager.cpp
│   ├── path_segment_locker.cpp
│   ├── deadlock_detector.cpp
│   └── deadlock_resolver.cpp
├── config/
│   └── traffic_controller_params.yaml
└── launch/
    └── traffic_controller.launch.py
```

**职责**：
- 仓库交叉口资源管理（4 个交叉口），分配通行权
- 路径段锁机制：AGV 申请路径段，避免多车同时进入同一区域
- 死锁检测：资源分配图（RAG）环检测算法
- 死锁解锁：优先级回退策略（低优先级 AGV 让行）
- 动态区域限速：根据拥堵情况动态调整速度限制

#### 5.1.4 api_gateway（API 网关）

```
agv_api_gateway/
├── api_gateway/
│   ├── rest_server.py             # RESTful API 服务 (FastAPI)
│   ├── task_handler.py            # 任务请求处理
│   ├── status_handler.py          # 状态查询处理
│   └── ws_handler.py              # WebSocket 实时推送
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

#### 5.1.5 map_server（全局地图服务）

```
agv_map_server/
├── include/agv_map_server/
│   ├── map_manager.hpp            # 地图加载与管理
│   └── costmap_generator.hpp      # 全局代价地图生成
├── src/
│   ├── map_server_node.cpp
│   ├── map_manager.cpp
│   └── costmap_generator.cpp
├── config/
│   └── map_server_params.yaml
└── launch/
    └── map_server.launch.py
```

**职责**：
- 加载并维护全局静态地图（OccupancyGrid 格式）
- 提供地图查询服务（可通行性、距离计算）
- 生成全局代价地图供路径规划使用
- 支持地图编辑与热更新

#### 5.1.6 fleet_safety_monitor（全局安全监控）

```
agv_safety/
├── include/agv_safety/
│   ├── fleet_safety_monitor.hpp   # 全局安全监控
│   ├── global_emergency.hpp       # 全局急停管理
│   └── watchdog_central.hpp       # 中心看门狗
├── src/
│   ├── fleet_safety_monitor_node.cpp
│   ├── global_emergency.cpp
│   └── watchdog_central.cpp
├── config/
│   └── fleet_safety_params.yaml
└── launch/
    └── fleet_safety_monitor.launch.py
```

**职责**：
- 接收所有 AGV 的安全状态，维护全局安全视图
- 控制台总急停处理：一键急停所有 AGV
- 安全门联锁监控：安全门打开时禁止所有 AGV 运动
- 全局看门狗：检测中心与车载端通信状态

### 5.2 车载端模块（每台 AGV 独立命名空间 `/agv_{N}/`）

#### 5.2.1 global_planner（全局路径规划器）

```
agv_navigation/
├── include/agv_navigation/
│   ├── global_planner/
│   │   ├── path_planner.hpp       # 全局路径搜索（Hybrid-A* [DEFAULT] / A* [EXTENSION]）
│   │   ├── path_smoother.hpp      # 路径平滑与优化（梯度下降后处理）
│   │   └── map_client.hpp         # 地图服务客户端
├── src/
│   ├── global_planner_node.cpp
│   ├── path_planner.cpp
│   ├── path_smoother.cpp
│   └── map_client.cpp
├── config/
│   └── global_planner_params.yaml
```

**职责**：
- 接收导航任务（起点→终点），生成全局最优路径
- **[DEFAULT] 算法：Hybrid-A\*** — 考虑差速模型运动学约束，生成可执行路径
- **[EXTENSION]** 预留 A\* 算法切换（通过 `global_planner.plugin` 参数）
- 路径平滑与速度曲线生成
- 路径重规划（当全局路径被阻塞时）
- 向 local_planner 下发全局路径

#### 5.2.2 local_planner（局部路径规划与避障）

```
agv_navigation/
├── include/agv_navigation/
│   ├── local_planner/
│   │   ├── local_planner.hpp      # 局部规划器（TEB [DEFAULT] / DWA [EXTENSION]）
│   │   ├── obstacle_detector.hpp  # 障碍物检测与跟踪
│   │   ├── collision_checker.hpp  # 碰撞检测（FCL）
│   │   ├── deadlock_resolver.hpp  # 死锁检测与解锁（本地级）
│   │   └── planner_plugin.hpp     # 规划器插件接口
├── src/
│   ├── local_planner_node.cpp
│   ├── teb_planner.cpp            # [DEFAULT]
│   ├── dwa_planner.cpp            # [EXTENSION]
│   ├── obstacle_detector.cpp
│   ├── collision_checker.cpp
│   └── deadlock_resolver.cpp
├── config/
│   └── local_planner_params.yaml
```

**职责**：
- 基于全局路径生成局部速度指令 (v_x, v_y, omega)
- **[DEFAULT] 算法：TEB（Timed Elastic Band）** — 多约束轨迹优化，支持速度/加速度约束，动态避障
- **[EXTENSION]** 预留 DWA 切换支持（通过 `local_planner.plugin` 参数）
- 实时障碍物检测（3D LiDAR 点云处理 + 超声波阵列）
- 多 AGV 死锁检测与本地解锁策略
- 输出安全速度指令给 safety_guard 校验

#### 5.2.3 localization（多传感器融合定位）

```
agv_localization/
├── include/agv_localization/
│   ├── ekf_fuser.hpp              # 扩展卡尔曼滤波器（主定位）
│   ├── amcl_wrapper.hpp           # AMCL 全局定位（重定位备用）
│   ├── sensor_sync.hpp            # 传感器时间同步
│   └── localization_monitor.hpp   # 定位质量监测
├── src/
│   ├── localization_node.cpp
│   ├── ekf_fuser.cpp
│   ├── amcl_wrapper.cpp
│   ├── sensor_sync.cpp
│   └── localization_monitor.cpp
├── config/
│   └── localization_params.yaml
```

**职责**：
- 融合 3D LiDAR scan matching + IMU + 轮式里程计 + RGB-D 视觉里程计
- **[DEFAULT] EKF（robot_localization）主定位**：50Hz 输出
- **AMCL 全局定位**：定位丢失时触发重定位（EKF 协方差 > 阈值时启动）
- 定位降级策略：
  - 正常 (50Hz, ±5cm) → LiDAR/视觉异常 → 降级到 IMU+里程计航迹推算 → AMCL 重定位 → 成功恢复 / 失败触发安全急停
- 定位丢失检测：EKF 协方差跟踪 + scan matching 得分监测

#### 5.2.4 safety_guard（安全防护节点）— 安全关键 ⚠️

```
agv_safety/
├── include/agv_safety/
│   ├── safety_guard.hpp           # 主安全控制器
│   ├── emergency_stop.hpp         # 急停逻辑（双路独立）
│   ├── speed_limiter.hpp          # 三层速度限幅
│   ├── collision_protection.hpp   # 双重碰撞保护（LiDAR 安全区 + 虚拟 bumper）
│   └── watchdog.hpp               # 通信看门狗（100ms 超时）
├── src/
│   ├── safety_guard_node.cpp
│   ├── emergency_stop.cpp
│   ├── speed_limiter.cpp
│   ├── collision_protection.cpp
│   └── watchdog.cpp
├── config/
│   └── safety_guard_params.yaml
```

**职责**：
- **双路独立急停判断**（路径 A：原始传感器数据 / 路径 B：控制指令校验）
- **三层速度限幅**：任务层（1.5 m/s）→ 路径层（区域限速）→ 执行层（安全校验）
- **双重碰撞保护**：LiDAR 前方安全区 0.8m + 侧方/后方 0.3m + 虚拟 bumper
- 减速触发距离：0.5m（减速至 0.5 m/s）
- 通信看门狗（100ms 超时 → 急停）
- 定位跳变检测（> 0.5m 触发急停）
- 急停触发源：前方 0.8m / 侧后方 0.3m / 减速 0.5m / 超速 / 定位丢失 / 通信中断 / 远程急停 / 低电量 < 5%
- 安全触边信号直连处理
- 双通道安全 PLC 接口对接

**安全代码约束**（实时循环 100Hz 内）：
```
❌ 禁止：动态内存分配、阻塞操作、文件 I/O、高频日志、异常、虚函数调用、容器动态扩容
✅ 允许：栈上分配、预分配内存池、原子操作、无锁队列、固定大小 ring buffer
```

#### 5.2.5 motion_controller（运动控制执行器）

```
agv_control/
├── include/agv_control/
│   ├── velocity_controller.hpp    # 速度控制器
│   ├── cmd_mux.hpp                # 指令复用器（安全优先）
│   └── odometry_publisher.hpp     # 里程计发布
├── src/
│   ├── motion_controller_node.cpp
│   ├── velocity_controller.cpp
│   ├── cmd_mux.cpp
│   └── odometry_publisher.cpp
├── config/
│   └── motion_controller_params.yaml
```

**职责**：
- 接收 safety_guard 校验后的 cmd_vel，转换为电机控制指令
- 指令复用器：safety_guard 急停指令 > local_planner 速度指令
- 将速度指令转换为差速模型轮速（左右轮独立速度）
- 发布轮式里程计（基于轮速编码器模型）

#### 5.2.6 battery_manager（电池管理）

```
agv_control/
├── include/agv_control/
│   ├── battery_model.hpp          # 电池仿真模型
│   └── charge_strategy.hpp        # 充电策略决策
├── src/
│   ├── battery_manager_node.cpp
│   ├── battery_model.cpp
│   └── charge_strategy.cpp
├── config/
│   └── battery_manager_params.yaml
```

**职责**：
- 仿真电池消耗模型（基于速度、负载）
- 低电量（< 20%）自动向 charge_scheduler 申请充电任务
- 极低电量（< 5%）触发安全急停
- 充电状态管理

#### 5.2.7 lifecycle_manager（生命周期管理）

```
agv_core/
├── include/agv_core/
│   ├── lifecycle_manager.hpp      # 生命周期管理器
│   └── state_machine.hpp          # 状态机定义
├── src/
│   ├── lifecycle_manager_node.cpp
│   └── state_machine.cpp
├── config/
│   └── lifecycle_params.yaml
```

**职责**：
- AGV 状态机管理：INIT → IDLE → ACTIVE → EMERGENCY → RECOVERY → IDLE
- 健康状态上报（heartbeat）
- 接收 task_manager 的任务分配并转发给 global_planner
- 异常降级与恢复管理

#### 5.2.8 sensor_fusion（传感器数据预处理）

```
agv_localization/
├── include/agv_localization/
│   └── sensor_sync.hpp            # 传感器时间同步
├── src/
│   └── sensor_fusion_node.cpp
```

**职责**：
- 3D LiDAR 点云预处理与滤波
- RGB-D 图像处理与视觉特征提取
- 超声波阵列数据处理
- 多传感器时间戳同步（TSDF 时间同步）
- 传感器故障检测与隔离

---

## 6. 全局接口规范

### 6.1 ROS2 Topic 列表

| 编号 | Topic 名称 | 消息类型 | 发布者 → 订阅者 | 频率 | QoS |
|------|-----------|----------|----------------|------|-----|
| T-01 | `/agv_{N}/scan` | `sensor_msgs/LaserScan` | Gazebo → localization, safety_guard, local_planner | 30Hz | Sensor Data |
| T-02 | `/agv_{N}/imu` | `sensor_msgs/Imu` | Gazebo → localization | 100Hz | Sensor Data |
| T-03 | `/agv_{N}/odom_raw` | `nav_msgs/Odometry` | motion_controller → localization | 100Hz | Sensor Data |
| T-04 | `/agv_{N}/odom_fused` | `nav_msgs/Odometry` | localization → global_planner, local_planner, fleet_monitor | 50Hz | Best Effort |
| T-05 | `/agv_{N}/global_path` | `nav_msgs/Path` | global_planner → local_planner | 按需 | Reliable |
| T-06 | `/agv_{N}/local_path` | `nav_msgs/Path` | local_planner → fleet_monitor (可视化) | 10Hz | Best Effort |
| T-07 | `/agv_{N}/cmd_vel` | `geometry_msgs/Twist` | local_planner → safety_guard | 100Hz | Best Effort |
| T-08 | `/agv_{N}/cmd_vel_safe` | `geometry_msgs/Twist` | safety_guard → motion_controller → Gazebo | 100Hz | Best Effort |
| T-09 | `/agv_{N}/safety_status` | `agv_msgs/SafetyStatus` | safety_guard → local_planner, fleet_safety_monitor | 50Hz | Reliable |
| T-10 | `/agv_{N}/heartbeat` | `agv_msgs/Heartbeat` | lifecycle_manager → fleet_monitor | 10Hz | Best Effort |
| T-11 | `/agv_{N}/battery_state` | `sensor_msgs/BatteryState` | battery_manager → task_manager, charge_scheduler | 1Hz | Best Effort |
| T-12 | `/agv_{N}/task_status` | `agv_msgs/TaskStatus` | lifecycle_manager → task_manager | 事件驱动 | Reliable |
| T-13 | `/agv_{N}/emergency` | `agv_msgs/EmergencyStatus` | safety_guard → fleet_safety_monitor, 所有节点 | 事件驱动 | Best Effort |
| T-14 | `/agv_{N}/safety_state` | `agv_msgs/SafetyState` | safety_guard → fleet_safety_monitor | 100Hz | Reliable |
| T-15 | `/agv_{N}/rgbd` | `sensor_msgs/Image` | Gazebo → localization, sensor_fusion | 30Hz | Sensor Data |
| T-16 | `/agv_{N}/ultrasonic` | `sensor_msgs/Range` | Gazebo → safety_guard | 20Hz | Sensor Data |
| T-17 | `/fleet/task_broadcast` | `agv_msgs/TaskBroadcast` | task_manager → 所有 lifecycle_manager | 事件驱动 | Reliable |
| T-18 | `/fleet/fleet_state` | `agv_msgs/FleetState` | fleet_monitor → api_gateway, web_bridge | 10Hz | Best Effort |
| T-19 | `/fleet/alerts` | `agv_msgs/AlertArray` | fleet_monitor → api_gateway, web_bridge | 事件驱动 | Reliable |
| T-20 | `/fleet/traffic/lock` | `agv_msgs/PathSegmentLock` | traffic_controller → 各 lifecycle_manager | 按需 | Reliable |
| T-21 | `/fleet/traffic/deadlock` | `agv_msgs/DeadlockEvent` | traffic_controller → task_manager | 按需 | Reliable |
| T-22 | `/fleet/charge/request` | `agv_msgs/ChargeRequest` | battery_manager → charge_scheduler | 按需 | Reliable |
| T-23 | `/fleet/global_emergency` | `std_msgs/Bool` | fleet_safety_monitor → 所有 safety_guard | 事件驱动 | Reliable |
| T-24 | `/map/global_map` | `nav_msgs/OccupancyGrid` | map_server → 所有 global_planner | 按需 | Reliable Transient Local |

### 6.2 ROS2 Service 列表

| 编号 | Service 名称 | 服务类型 | 服务端 → 客户端调用 | 说明 |
|------|-------------|----------|---------------------|------|
| S-01 | `/api/submit_task` | `agv_msgs/SubmitTask` | api_gateway (Server) ← 外部 | 提交新任务 |
| S-02 | `/api/query_fleet` | `agv_msgs/QueryFleet` | api_gateway (Server) ← 外部 | 查询车队状态 |
| S-03 | `/api/cancel_task` | `agv_msgs/CancelTask` | api_gateway (Server) ← 外部 | 取消任务 |
| S-04 | `/api/query_task` | `agv_msgs/QueryTask` | api_gateway (Server) ← 外部 | 查询任务详情 |
| S-05 | `/api/pause_fleet` | `agv_msgs/PauseResume` | api_gateway (Server) ← 外部 | 暂停/恢复全车队 |
| S-06 | `/fleet/scheduler/submit_task` | `agv_msgs/SubmitTask` | task_manager ← api_gateway | 内部提交任务 |
| S-07 | `/fleet/scheduler/cancel_task` | `agv_msgs/CancelTask` | task_manager ← api_gateway | 取消任务 |
| S-08 | `/fleet/scheduler/pause` | `agv_msgs/PauseResume` | task_manager ← api_gateway | 暂停/恢复调度 |
| S-09 | `/fleet/scheduler/query_agv` | `agv_msgs/QueryAGV` | fleet_monitor ← api_gateway | 查询 AGV 状态 |
| S-10 | `/fleet/map/get_map` | `nav_msgs/GetMap` | map_server ← global_planner | 获取全局地图 |
| S-11 | `/fleet/map/set_map` | `agv_msgs/SetMap` | map_server ← api_gateway | 更新/设置地图 |
| S-12 | `/agv_{N}/emergency_stop` | `agv_msgs/EmergencyStop` | safety_guard ← fleet_safety_monitor / api_gateway | 远程急停触发 |
| S-13 | `/agv_{N}/emergency_release` | `agv_msgs/EmergencyRelease` | safety_guard ← fleet_safety_monitor / api_gateway | 急停解除 |
| S-14 | `/agv_{N}/set_speed_limit` | `agv_msgs/SetSpeedLimit` | safety_guard ← traffic_controller | 动态速度限制 |
| S-15 | `/agv_{N}/set_params` | `agv_msgs/SetParams` | 各节点 ← api_gateway | 动态参数配置 |

### 6.3 ROS2 Action 列表

| 编号 | Action 名称 | 动作类型 | 服务端 | 说明 |
|------|------------|----------|--------|------|
| A-01 | `/agv_{N}/navigate_to` | `agv_msgs/NavigateTo` | global_planner | 导航任务：起点→终点，包含路径反馈 |
| A-02 | `/agv_{N}/charge` | `agv_msgs/Charge` | battery_manager | 充电任务：导航到充电站并充电 |
| A-03 | `/agv_{N}/dock` | `agv_msgs/Dock` | global_planner | 停靠任务：精确停靠到指定点 |
| A-04 | `/agv_{N}/patrol` | `agv_msgs/Patrol` | global_planner | 巡检任务：按预设路径点巡检 |
| A-05 | `/fleet/dispatch_task` | `agv_msgs/DispatchTask` | task_manager | 调度任务：中心调度器分配任务到指定 AGV |

### 6.4 自定义消息类型 (agv_msgs)

```
agv_msgs/
├── msg/
│   ├── SafetyStatus.msg           # uint8 level, bool estop_active, float64 min_distance, string reason
│   ├── Heartbeat.msg              # string agv_id, builtin_interfaces/Time stamp, uint8 state, float32 battery
│   ├── TaskRequest.msg            # string task_id, string task_type, string priority, Pose2D start/target, string payload_id
│   ├── TaskAssignment.msg         # string task_id, string assigned_agv_id, string task_type, Pose2D target, string[] waypoints
│   ├── TaskStatus.msg             # string task_id, string agv_id, uint8 status, float32 progress, string error_msg
│   ├── TaskBroadcast.msg          # string task_id, uint8 task_type, string payload, int8 priority
│   ├── FleetState.msg             # AgvState[] agvs
│   ├── AgvState.msg               # string agv_id, PoseWithCovariance pose, Twist velocity, float64 battery, string status
│   ├── Alert.msg                  # uint8 level, string source, string message, builtin_interfaces/Time stamp
│   ├── AlertArray.msg             # Alert[] alerts
│   ├── EmergencyStatus.msg        # string agv_id, bool emergency_active, string source, string description
│   ├── SafetyState.msg            # string agv_id, string safety_level, float32 speed_limit_linear, float32 speed_limit_angular
│   ├── PathSegmentLock.msg        # string segment_id, string agv_id, string status, time grant_time, duration max_hold
│   ├── DeadlockEvent.msg          # string event_id, string[] involved_agvs, string deadlock_type, string resolution_strategy
│   ├── ChargeRequest.msg          # string agv_id, float32 battery_level, Pose2D current_pose
│   ├── LocalizationStatus.msg     # string agv_id, string status, float64 covariance, bool is_valid
│   ├── FleetTelemetry.msg         # AgvState[] agvs, float64 avg_completion_rate, uint32 total_tasks
│   ├── MotorCommand.msg           # float64 left_wheel_speed, float64 right_wheel_speed
│   └── MotorFeedback.msg          # float64 left_wheel_speed, float64 right_wheel_speed, float64 left_current, float64 right_current
├── srv/
│   ├── SubmitTask.srv             # TaskRequest request → TaskResponse response
│   ├── QueryFleet.srv             # QueryRequest request → FleetState response
│   ├── CancelTask.srv             # string task_id → bool success, string message
│   ├── QueryTask.srv              # string task_id → TaskStatus status
│   ├── QueryAGV.srv               # string agv_id → AgvState state
│   ├── SetMap.srv                 # OccupancyGrid map → bool success
│   ├── SetParams.srv              # Parameter[] params → bool success
│   ├── EmergencyStop.srv          # string source → bool success
│   ├── EmergencyRelease.srv       # string source → bool success
│   ├── SetSpeedLimit.srv          # float64 linear_limit, float64 angular_limit → bool success
│   └── PauseResume.srv            # bool pause → bool success, string message
└── action/
    ├── NavigateTo.action          # PoseStamped target → Path feedback → NavigateResult result
    ├── Charge.action              # string charger_id → float64 battery feedback → bool success
    ├── Dock.action                # PoseStamped dock_pose → float64 distance feedback → bool success
    ├── Patrol.action              # PoseStamped[] waypoints → int32 current_wp feedback → bool success
    └── DispatchTask.action        # TaskRequest task → TaskStatus feedback → DispatchResult result
```

---

## 7. 数据流与控制流设计

### 7.1 实时控制循环数据流（车载端）

```
传感器层              感知层               规划层               控制层              执行层
───────              ──────              ──────              ──────              ──────

Gazebo               localization        global_planner      local_planner       motion_ctrl
┌────────────┐       ┌──────────┐        ┌──────────┐        ┌──────────┐        ┌──────────┐
│ 3D LiDAR   ├scan──→│          │        │          │        │          │        │          │
│            │ 30Hz  │          │        │          │        │          │        │          │
│ IMU        ├imu───→│ EKF      │ odom   │ Hybrid-  │ global │ TEB      │ cmd_vel│ cmd_mux  │ cmd_vel
│            │ 100Hz │ Fusion   ├──────→│ A*       ├──────→│ (DWA     ├───────→│          ├──safe──→ Gazebo
│ RGB-D Cam  ├rgbd──→│          │ 50Hz   │          │ path   │ ext.)    │ 100Hz  │          │ 100Hz
│            │ 30Hz  │          │        │          │        │          │        │          │
│ 超声波阵列  ├ultra─→│          │        │          │        │          │        │          │
│            │ 20Hz  │          │        │          │        │          │        │          │
│ 轮式里程计  ├odom──→│          │        │          │        │          │        │          │
│            │ 100Hz │          │        │          │        │          │        │          │
└────────────┘       └──────────┘        └──────────┘        └────┬─────┘        └────┬─────┘
                                                                  │                   │
                                                            ┌─────┴─────┐       ┌─────┴─────┐
                                                            │ safety_   │       │ safety_   │
                                                            │ guard     │       │ guard     │
                                                            │ (原始传感器│       │ (cmd_vel  │
                                                            │  路径 A)  │       │  路径 B)  │
                                                            └───────────┘       └───────────┘
```

**实时性保证**：
- 传感器 → 定位：100Hz 更新，50Hz 输出（EKF 预测+更新）
- 定位 → 规划 → 控制：50ms 路径规划 + 10ms 避障 + 10ms 控制
- 安全路径独立：safety_guard 直连原始传感器，不经过定位/规划
- 控制频率：100Hz (10ms 周期)
- 避障响应：≤ 50ms（含 TEB 规划 + 碰撞检测）
- 急停响应：≤ 10ms（硬件级安全路径）

### 7.2 非实时任务流（中心 ↔ 车载）

```
外部系统             API层               调度层             交通管制层         执行层             反馈层
───────             ─────               ─────              ────────          ─────             ─────

REST Client         api_gateway          task_manager       traffic_ctrl      lifecycle_mgr     fleet_monitor
┌────────┐          ┌──────────┐         ┌──────────┐       ┌──────────┐      ┌──────────┐       ┌──────────┐
│POST    ├─────────→│ validate │         │          │       │          │      │          │       │          │
│/task   │          │ request  ├────────→│ dispatch ├──────→│ lock     ├─────→│ execute  │       │          │
│        │          │          │         │          │Action │ path     │Action │          │       │          │
│        │←─────────┤ response │←────────┤ feedback │←──────┤ segment  │←──────┤ feedback │       │          │
│        │          │          │         │          │       │          │      │          │       │          │
│GET     ├─────────→│ query    │         │          │       │          │      │          │       │          │
│/fleet  │          │ fleet    ├────────→│          │       │          │      │          │←──────┤ heartbeat│
│        │←─────────┤ state    │←────────┤          │       │          │      │          │       │ aggregate│
└────────┘          └──────────┘         └──────────┘       └──────────┘      └──────────┘       └──────────┘
```

### 7.3 安全监控独立数据流

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          双路独立安全监控 (SIL2)                                │
│                                                                               │
│  路径 A（原始传感器数据）               路径 B（控制指令校验）                   │
│  ┌─────────────────────────┐         ┌─────────────────────────┐              │
│  │ scan_raw ───────────────┤         │ cmd_vel ────────────────┤              │
│  │ ultrasonic_raw ─────────┤         │  ↓                       │              │
│  │  ↓                       │         │ 速度限幅检查             │              │
│  │ LiDAR 安全区检测          │         │ (> 1.5 m/s 或区域超速)  │              │
│  │ (前方 < 0.8m 急停)       │         │  ↓                       │              │
│  │ (侧/后 < 0.3m 急停)      │         │ 急停判断 B               │              │
│  │ (减速区 < 0.5m)          │         └────────┬────────┘        │              │
│  │  ↓                       │                  │                  │              │
│  │ 安全触边信号 ────────────┤                  │                  │              │
│  │  ↓                       │                  │                  │              │
│  │ 急停判断 A               │                  │                  │              │
│  └────────┬────────────────┘                  │                  │              │
│           │                                   │                  │              │
│           └───────────────────┬───────────────┘                  │              │
│                               ↓                                  │              │
│                       ┌───────────────┐                          │              │
│                       │ 急停仲裁器     │ ← 任一触发即急停         │              │
│                       │ (OR 逻辑)     │                          │              │
│                       └───────┬───────┘                          │              │
│                               ↓                                  │              │
│                       ┌───────────────┐                          │              │
│                       │ cmd_vel = 0   │ ← 绕过 ROS2 通信层       │              │
│                       │ Gazebo 接口   │                          │              │
│                       └───────────────┘                          │              │
│                                                                               │
│  急停触发源矩阵：                                                              │
│  ┌─────────────────────┬──────────┬──────────┬────────────────────────┐       │
│  │ 触发条件             │ 检测延迟 │ 动作     │ SIL2                   │       │
│  ├─────────────────────┼──────────┼──────────┼────────────────────────┤       │
│  │ 障碍物 < 0.8m(前)   │ <10ms    │ 急停     │ 是                     │       │
│  │ 障碍物 < 0.3m(侧后) │ <10ms    │ 急停     │ 是                     │       │
│  │ 障碍物 < 0.5m       │ <10ms    │ 减速 0.5 │ 是                     │       │
│  │ 通信中断 > 100ms    │ ≤100ms   │ 急停     │ 是                     │       │
│  │ 定位丢失 > 0.5m     │ ≤10ms    │ 急停     │ 是                     │       │
│  │ 超速 > 1.5 m/s      │ ≤10ms    │ 急停     │ 是                     │       │
│  │ 电量 < 5%           │ ≤100ms   │ 急停     │ 是                     │       │
│  │ 人工急停(按钮/远程)  │ ≤10ms    │ 急停     │ 是                     │       │
│  │ 安全触边触发         │ <1ms     │ 急停     │ 是                     │       │
│  │ 低电量 < 20%        │ 按需     │ 充电任务 │ 否                     │       │
│  └─────────────────────┴──────────┴──────────┴────────────────────────┘       │
└───────────────────────────────────────────────────────────────────────────────┘
```

---

## 8. 技术选型

### 8.1 基础平台选型

| 组件 | 选型 | 版本 | 说明 |
|------|------|------|------|
| **操作系统** | Ubuntu | 22.04 LTS | 需求指定 |
| **ROS2 发行版** | ROS2 Humble | Hawksbill | 需求指定 |
| **仿真平台** | Gazebo Ignition | Fortress | 需求指定 |
| **DDS 实现** | Fast-DDS | (默认) | ROS2 Humble 默认，兼容性最好 |
| **编程语言** | C++17 / Python 3.10 | - | 实时模块 C++，非实时模块 Python |

### 8.2 关键算法选型

| 模块 | 默认算法 [DEFAULT] | 扩展算法 [EXTENSION] | 选型理由 |
|------|-------------------|---------------------|----------|
| **全局路径规划** | Hybrid-A* | A* | 考虑差速模型运动学约束，生成可执行路径 |
| **局部路径规划** | TEB (Timed Elastic Band) | DWA | 多约束优化，支持速度/加速度约束，差速模型天然适配 |
| **定位融合** | EKF (robot_localization) | UKF | 计算效率高，ROS2 生态成熟 |
| **避障** | TEB 内置避障 + FCL 碰撞检测 | VFF / VO | TEB 内置 + FCL 安全层双重保障 |
| **任务调度** | 改进型拍卖算法（优先级感知） | 匈牙利算法 | O(N²) 复杂度对 10 台 AGV 完全可行，负载均衡好 |
| **死锁检测** | 资源分配图 (RAG) 环检测 | 图着色 | 实现简单可靠 |
| **死锁解锁** | 优先级回退策略 | 重路由 | 低优先级 AGV 让行高优先级 |

### 8.3 可视化工具

| 工具 | 用途 | 说明 |
|------|------|------|
| **RViz2** | 开发调试 | ROS2 原生 3D 可视化，路径/代价地图/TF 树调试 |
| **Foxglove Studio** | 运营监控 | Web 界面，通过 WebSocket 桥接展示 AGV 位置、任务状态 |

### 8.4 安全组件选型

| 组件 | 选型 | 说明 |
|------|------|------|
| 碰撞检测库 | FCL (Flexible Collision Library) | 几何碰撞检测，用于安全层碰撞预测 |
| 安全等级 | SIL2 | 需求指定 |
| 急停实现 | 双路独立（软件 A + 仿真硬件 B） | 任何一路触发即产生 STOP |
| 速度限幅 | 三层限幅（任务层→路径层→执行层） | 从调度到执行逐层校验 |

### 8.5 架构权衡决策

| 决策 | 选择 | 权衡分析 |
|------|------|----------|
| **集中调度 vs 分布式调度** | 集中调度（混合部署） | 全局最优、易于监控 / 单点故障→热备解决 |
| **C++ vs Python** | 实时模块 C++17，非实时 Python | 实时保证 / 开发效率略低 |
| **独立安全节点 vs 内嵌安全** | 独立安全节点 | 物理隔离、独立验证 / 节点数增加 |
| **Gazebo Ignition vs Classic** | Ignition (Fortress) | ROS2 原生支持更好 / 插件生态略少 |
| **Fast-DDS vs Cyclone DDS** | Fast-DDS（默认） | ROS2 Humble 默认，兼容性最好 |
| **车载计算平台** | Jetson Orin 级 | 满足 100Hz 控制 + 3D LiDAR 处理 + TEB 规划算力需求 |

---

## 9. 安全架构设计（SIL2）

### 9.1 安全关键路径识别

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        安全关键路径                                           │
│                                                                              │
│  传感器 → 安全检测 → 速度限幅 → 指令输出 → 执行器                            │
│  ┌──────┐   ┌──────────────┐   ┌──────┐   ┌──────┐   ┌──────────┐          │
│  │3D    │──▶│ 碰撞检测      │──▶│速度  │──▶│cmd_vel│──▶│底盘      │          │
│  │LiDAR │   │ (前方0.8m)   │   │限幅器│   │输出   │   │(仿真/硬件)│          │
│  │IMU   │   │ 定位丢失检测   │   │三层  │   │      │   │          │          │
│  │超声波│   │ 通信中断检测   │   │限幅  │   │      │   │          │          │
│  │触边  │   │ 超速检测       │   │      │   │      │   │          │          │
│  │      │   │ 低电量检测     │   │      │   │      │   │          │          │
│  │      │   │ 安全PLC信号    │   │      │   │      │   │          │          │
│  └──────┘   └──────────────┘   └──────┘   └──────┘   └──────────┘          │
│                                                                              │
│  安全关键路径延迟要求：从传感器输入到执行器输出 ≤ 10ms                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 9.2 安全关键模块

**安全关键模块（SIL2 级别）：**
1. `agv_{N}_safety_guard` — 主安全控制器（碰撞检测、速度限幅、急停触发）
2. 急停信号处理路径（双路独立）
3. 速度限幅逻辑（三层限幅）
4. 通信中断检测（看门狗）
5. 安全触边信号处理
6. 双通道安全 PLC 接口

**非安全关键模块（非 SIL2）：**
- 任务调度、路径规划、定位、可视化、API 网关、电池管理

### 9.3 双路急停实现方案

| 路径 | 实现方式 | 触发源 | 响应时间 |
|------|---------|--------|----------|
| **A 路（软件）** | `agv_{N}_safety_guard` 节点 | 碰撞预测、定位丢失、通信中断、超速、低电量、远程急停、安全 PLC | ≤ 10ms |
| **B 路（仿真硬件）** | 独立 `agv_{N}_safety_monitor` 节点 | 仿真急停信号、手动急停按钮、安全触边、安全门联锁 | ≤ 10ms |

**急停触发后恢复流程：**
```
急停触发 ──▶ 所有 cmd_vel 清零 ──▶ 写入安全日志 ──▶ 等待急停解除指令
                                                      │
                                ┌───────────────────────┘
                                ▼
                  急停解除指令 (Service: /agv_{N}/emergency_release)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              手动确认恢复           自动条件恢复
           (需人工确认安全)       (排除触发源后自动恢复)
```

### 9.4 安全节点与非安全节点的隔离策略

#### 9.4.1 进程级隔离

| 方面 | 安全节点 (safety_guard) | 非安全节点 |
|------|------------------------|-----------|
| 执行上下文 | 独立进程，实时线程（SCHED_FIFO） | 普通进程（SCHED_OTHER） |
| 内存 | 独立地址空间，禁止动态内存分配 | 允许动态内存 |
| 阻塞操作 | 禁止（无 sleep、文件 I/O、锁等待） | 允许 |
| 日志 | 仅紧急事件日志，低频 | 正常日志级别 |
| CPU 亲和性 | 绑定独立 CPU 核心 | 其他核心 |

#### 9.4.2 通信隔离

```
┌──────────────────────────────────────────────────────────────┐
│                    DDS Domain (ID: 10)                        │
│                                                              │
│  ┌────────────────────┐  ┌──────────────────────────────┐   │
│  │ 安全 Partition      │  │ 非安全 Partition              │   │
│  │ (Partition: safety) │  │ (Partition: control, monitor)│   │
│  │                     │  │                              │   │
│  │ /agv_{N}/          │  │ /agv_{N}/cmd_vel             │   │
│  │   emergency        │  │ /agv_{N}/odom_fused          │   │
│  │ /agv_{N}/          │  │ /agv_{N}/scan                │   │
│  │   safety_state     │  │ /fleet/task_broadcast        │   │
│  │ /fleet/global_     │  │ /fleet/fleet_state           │   │
│  │   emergency        │  │                              │   │
│  └────────────────────┘  └──────────────────────────────┘   │
│                                                              │
│  安全节点 ↔ 安全 Topic（只读/只写权限控制）                    │
│  非安全节点 ↔ 非安全 Topic                                   │
│  安全节点可以读取非安全 Topic（输入检测），但非安全节点         │
│  不能写入安全 Topic                                          │
└──────────────────────────────────────────────────────────────┘
```

### 9.5 三层速度限幅机制

```
速度限幅层级：
                    ┌──────────────────────────┐
                    │ 层级 1: 任务速度           │
                    │ 最大 1.5 m/s (需求指定)    │
                    │ 由调度器/交通管制动态设置   │
                    │ 受区域限制（装卸区 ≤0.3m/s)│
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 层级 2: 减速区             │
                    │ 触发条件:                  │
                    │  - 障碍物 < 0.5m          │
                    │  - 接近交叉口             │
                    │  - 通信质量下降            │
                    │ 限速: 0.5 m/s             │
                    └────────────┬─────────────┘
                                 │
                    ┌────────────▼─────────────┐
                    │ 层级 3: 急停               │
                    │ 触发条件:                  │
                    │  - 前方障碍物 < 0.8m      │
                    │  - 侧后方障碍物 < 0.3m    │
                    │  - 通信中断 > 100ms       │
                    │  - 定位丢失 > 0.5m        │
                    │  - 超速 (≥1.5 m/s)        │
                    │  - 电量 < 5%              │
                    │  - 人工急停 / 安全触边    │
                    │  - 安全 PLC 信号          │
                    │ 动作: cmd_vel = 0         │
                    └──────────────────────────┘
```

### 9.6 安全代码约束（实时循环 100Hz 内）

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

### 9.7 急停硬件布局

| 急停设备 | 位置 | 数量 | 触发方式 | 复位方式 |
|----------|------|------|----------|----------|
| AGV 前方急停按钮 | AGV 前方面板 | 每台 1 个 | 按压触发 | 钥匙复位 |
| AGV 后方急停按钮 | AGV 后方面板 | 每台 1 个 | 按压触发 | 钥匙复位 |
| AGV 左侧急停按钮 | AGV 左侧面板 | 每台 1 个 | 按压触发 | 钥匙复位 |
| AGV 右侧急停按钮 | AGV 右侧面板 | 每台 1 个 | 按压触发 | 钥匙复位 |
| 控制台总急停按钮 | 中心控制台 | 1 个 | 按压触发 | 钥匙复位 |
| 安全门联锁 | 仓库安全门 | 按门数 | 门打开触发 | 门关闭复位 |

---

## 10. 仿真架构

### 10.1 AGV 参数（以需求为准）

| 参数 | 规格 |
|------|------|
| AGV 数量 | 3~5 台（可扩展至 10 台） |
| 驱动方式 | 差速驱动（两驱动轮 + 万向轮） |
| 车身尺寸 | 800mm × 600mm × 300mm（长 × 宽 × 高） |
| 最大速度 | 1.5 m/s |
| 最大载荷 | 500 kg |
| 轮距 | 0.5 m |
| 离地间隙 | 50 mm |

### 10.2 传感器配置（方案C 高配型）

| 传感器 | 型号/规格 | 数量 | 用途 |
|--------|----------|------|------|
| **3D LiDAR** | 16 线, 30m 范围, 40Hz | 1 | 主传感器：定位 + 避障 + 环境感知 |
| **RGB-D 相机** | 640×480, 30Hz | 1 | 视觉定位 + 障碍物识别 + 货物检测 |
| **IMU** | 6 轴, 100Hz | 1 | 姿态估计 + 加速度积分辅助定位 |
| **超声波阵列** | 4 个方向, 20Hz, 3m 范围 | 4 | 近距离障碍物检测（补 LiDAR 盲区） |
| **双通道安全 PLC** | SIL2 认证 | 1 | 安全逻辑控制 + 急停信号处理 |
| **安全触边** | 接触式传感器 | 4 边 | 直接接触碰撞检测 |

### 10.3 仓库场景参数（以需求为准）

| 参数 | 规格 |
|------|------|
| 仓库面积 | 500 m² |
| 布局尺寸 | 25m × 20m（矩形） |
| 货架布局 | 4 排 × 10 组 |
| 主通道 | 2 条，宽度 3m |
| 副通道 | 4 条，宽度 2m |
| 充电站 | 2 工位 |
| 装卸区 | 2 个 |

```
┌─────────────────────────────────────────────────────────────┐
│                        仓库俯视图 (25m × 20m)                │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ 货架 A1 │  │ 货架 A2 │  │   ...   │  │ 货架 A10│      │
│  │ (1-10)  │  │ (11-20) │  │         │  │ (91-100)│      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│                                                             │
│  ═══════════════════ 主通道 1 (3m) ═══════════════════      │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ 货架 B1 │  │ 货架 B2 │  │   ...   │  │ 货架 B10│      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│  ─── 副1 ───  ─── 副2 ───  ─── 副3 ───  ─── 副4 ───      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ 货架 C1 │  │ 货架 C2 │  │   ...   │  │ 货架 C10│      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│                                                             │
│  ═══════════════════ 主通道 2 (3m) ═══════════════════      │
│                                                             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐      │
│  │ 货架 D1 │  │ 货架 D2 │  │   ...   │  │ 货架 D10│      │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘      │
│                                                             │
│                ┌──────────┐    ┌──────────┐                │
│                │ 充电站 1  │    │ 充电站 2  │                │
│                └──────────┘    └──────────┘                │
│                                                             │
│  通道宽度: 主通道 3m / 副通道 2m                            │
│  货架尺寸: 1.2m × 1.0m × 1.8m                              │
│  交叉口: 8 个（主通道 × 副通道交叉点，交通管制重点）          │
└─────────────────────────────────────────────────────────────┘
```

### 10.4 传感器插件选型（Gazebo Ignition Fortress）

| 传感器 | Gazebo 插件 | 参数配置 | 说明 |
|--------|------------|---------|------|
| **3D LiDAR** | `ignition::gazebo::systems::Lidar` | 16 线, 30m 范围, 40Hz | 模拟 3D LiDAR |
| **IMU** | `ignition::gazebo::systems::Imu` | 100Hz, 噪声参数可配置 | 模拟 6 轴 IMU |
| **轮式里程计** | 自定义 `OdometryPublisher` | 50Hz, 基于轮速编码器仿真 | 底盘内置 |
| **RGB-D 相机** | `ignition::gazebo::systems::RgbdCamera` | 640×480, 30Hz | RGB-D 视觉感知 |
| **超声波传感器** | `ignition::gazebo::systems::Sonar` | 20Hz, 3m 范围, 30° 波束角 | 4 方向各 1 个 |
| **接触传感器** | `ignition::gazebo::systems::TouchPlugin` | 碰撞检测 | 安全触边仿真 |
| **急停按钮** | 自定义仿真插件 | GUI 交互按钮 | 四面按钮 + 控制台总急停 |

### 10.5 AGV URDF 模型设计

```
AGV URDF 模型结构：
┌───────────────────────────────────────────────┐
│               AGV Body (800×600×300mm)          │
│  ┌──────────────────────────────┐              │
│  │ 3D LiDAR (顶置)              │              │
│  └──────────────────────────────┘              │
│  ┌──────────────┐  ┌──────────────┐            │
│  │ RGB-D Cam    │  │ IMU          │            │
│  │ (前置)       │  │ (中心)       │            │
│  └──────────────┘  └──────────────┘            │
│                                                │
│  超声波(左)◄───  ┌──────────────┐  ───►超声波(右)│
│                  │ 控制箱       │               │
│                  │ (Jetson Orin)│               │
│  超声波(后)◄───  └──────────────┘  ───►安全触边  │
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
│                                                │
│  急停按钮: 四面各 1 个 (前/后/左/右)           │
│  安全触边: 四边环绕                            │
│  双通道安全 PLC: 控制箱内                      │
└────────────────────────────────────────────────┘
```

### 10.6 仿真与真实代码的复用策略

```
┌────────────────────────────────────────────────────┐
│                   代码复用架构                       │
│                                                    │
│  ┌──────────────────────────────────────────┐     │
│  │        核心算法层（完全复用）              │     │
│  │  - 全局路径规划 (Hybrid-A*)              │     │
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
│  │ - 仿真底盘    │     │ - 超声波驱动     │        │
│  │              │     │ - 安全 PLC 接口  │        │
│  │              │     │ - 安全触边接口   │        │
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

---

## 11. 部署拓扑

### 11.1 中心服务器部署

```
中心服务器 (Ubuntu 22.04 + ROS2 Humble)
├── task_manager           (C++17, 100Hz 主循环)
├── fleet_monitor          (C++17, 10Hz 主循环)
├── traffic_controller     (C++17, 50Hz 主循环)
├── charge_scheduler       (C++17, 1Hz 更新)
├── fleet_safety_monitor   (C++17, 100Hz 主循环)
├── map_server             (C++17, 事件驱动)
├── api_gateway            (Python 3.10, FastAPI)
├── web_bridge             (Python 3.10, WebSocket)
└── rviz2 / Foxglove       (可视化, 可选)
```

### 11.2 车载端部署（每台 AGV 独立命名空间）

```
/agv_{01..10}/
├── agv_{N}_global_planner       (C++17, ≤ 50ms 响应)
├── agv_{N}_local_planner        (C++17, ≤ 10ms 响应, 100Hz 循环)
├── agv_{N}_localization         (C++17, ≥ 50Hz 输出)
├── agv_{N}_safety_guard         (C++17, ≤ 10ms 响应, 独立线程, SCHED_FIFO)
├── agv_{N}_motion_controller    (C++17, 100Hz 控制循环)
├── agv_{N}_battery_manager      (C++17, 1Hz 更新)
├── agv_{N}_lifecycle_manager    (C++17, 事件驱动)
├── agv_{N}_sensor_fusion        (C++17, 100Hz)
└── ros_gz_bridge                (ros_gz_bridge, 桥接 Gazebo ↔ ROS2)
```

### 11.3 仿真环境部署

```
Gazebo Ignition (Fortress)
├── world.sdf                    # 仓库场景 (25m × 20m)
│   ├── 4排×10组货架
│   ├── 2条主通道(3m) + 4条副通道(2m)
│   ├── 2个充电站
│   └── 2个装卸区
├── agv_{01..10}.sdf             # AGV 模型 (800×600×300mm, 差速模型)
│   ├── 3D LiDAR 插件            # 16线, 30m, 40Hz
│   ├── RGB-D 相机插件            # 640×480, 30Hz
│   ├── IMU 插件                  # 100Hz
│   ├── 超声波传感器插件           # 4方向, 20Hz
│   ├── 接触传感器插件             # 安全触边仿真
│   ├── Odometry 插件            # 50Hz
│   └── DiffDrive 插件           # 差速驱动仿真
├── dynamic_obstacles            # 动态障碍物管理器
├── scenario_manager             # 预设场景管理
└── performance_monitor          # 性能监控
```

### 11.4 网络分区与 QoS 策略

| 分区 | 通信类型 | QoS Profile | 说明 |
|------|----------|-------------|------|
| **传感器数据** | Topic | `SENSOR_DATA` (Reliable, KeepLast(5)) | LiDAR/IMU/Odom，低延迟 |
| **控制指令** | Topic | `SYSTEM_DEFAULT` (Best Effort, KeepLast(1)) | cmd_vel，最新优先 |
| **状态数据** | Topic | `BEST_EFFORT` (KeepLast(10)) | 心跳、电池、状态 |
| **安全数据** | Topic | `RELIABLE` (KeepLast(5), Transient Local) | 安全状态、急停指令 |
| **任务指令** | Action/Service | `RELIABLE` (KeepLast(1)) | 任务下发，不丢包 |
| **地图数据** | Topic/Service | `RELIABLE` (Transient Local) | 地图，晚加入节点可获取 |

---

## 12. 验收标准与验证策略

### 12.1 三阶段验收

| 阶段 | 内容 | 验证方式 | 验收标准 |
|------|------|----------|----------|
| **Phase 1: 纯仿真** | 单 AGV → 3~5 AGV → 全场景 | Gazebo Ignition Fortress | 7 大功能模块全部在仿真中通过 |
| **Phase 2: 半实物仿真** | 真实控制器 + 仿真环境 | 硬件在环 (HIL) | 控制/安全模块在真实硬件上运行通过 |
| **Phase 3: 全场景验收** | 完整功能验收 | 全场景仿真测试 | 多 AGV 协同、安全、性能全部达标 |

### 12.2 关键性能指标

| 需求指标 | 指标值 | 验证方式 |
|---------|--------|---------|
| 控制频率 | 100Hz (10ms 周期) | 性能测试脚本 + ROS2 回调时间监测 |
| 避障响应时间 | ≤ 50ms | 集成测试 + 仿真验证 |
| 急停响应时间 | ≤ 10ms | 专用急停测试用例 |
| 定位频率 | ≥ 50Hz | 单元测试 |
| 安全等级 | SIL2 | 安全论证文档 + 双路独立验证 |
| 路径规划时间 | ≤ 50ms | 单元测试 + 性能测试 |
| 多车扩展性 | 3~5 台（可扩展至 10 台） | 多 AGV 仿真测试 |
| 通信中断恢复 | ≤ 100ms 急停，≤ 1s 恢复 | 通信中断测试场景 |

### 12.3 测试场景矩阵

| 测试场景 | 覆盖模块 | 验证内容 |
|----------|---------|----------|
| 单 AGV 导航 | global_planner, local_planner, localization, motion_controller | 路径规划、轨迹跟踪、定位精度 |
| 多 AGV 协同避障 | local_planner, safety_guard | 动态避障、安全距离保持 |
| 交叉口通行 | traffic_controller, local_planner | 交叉口资源管理、通行权分配 |
| 死锁检测与解锁 | traffic_controller, deadlock_detector | 死锁发现、优先级回退 |
| 急停测试 | safety_guard, fleet_safety_monitor | 双路急停、响应时间 ≤ 10ms |
| 通信中断 | safety_guard, watchdog | 100ms 内急停触发 |
| 定位丢失 | localization, safety_guard | 定位降级、0.5m 跳变急停 |
| 低电量充电 | battery_manager, charge_scheduler | 20% 自动充电、5% 急停 |
| 任务调度 | task_manager, api_gateway | 任务分配、优先级、抢占 |
| 安全门联锁 | fleet_safety_monitor, safety_guard | 安全门打开禁止运动 |
| 满载测试 | 全系统 | 500kg 载荷下的导航性能 |
| 极限多车 | 全系统 | 10 台 AGV 同时运行 |

---

## 13. 项目目录结构

```
agv_ws/                              # ROS2 Workspace 根目录
├── src/                             # 源码目录
│   ├── agv_core/                    # 核心库包
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
│   │   ├── msg/                     # 自定义消息
│   │   ├── srv/                     # 自定义服务
│   │   └── action/                  # 自定义 Action
│   │
│   ├── agv_scheduler/               # 调度器包（中心服务器）
│   │   ├── include/agv_scheduler/
│   │   └── src/
│   │       ├── task_manager_node.cpp
│   │       ├── charge_scheduler_node.cpp
│   │       ├── auction_algorithm.cpp
│   │       └── hungarian_algorithm.cpp  # [EXTENSION]
│   │
│   ├── agv_fleet_manager/           # 车队管理包（中心服务器）
│   │
│   ├── agv_traffic_control/         # 交通管制包（中心服务器）
│   │   ├── include/agv_traffic_control/
│   │   │   ├── traffic_controller.h
│   │   │   ├── intersection_manager.h
│   │   │   ├── path_segment_locker.h
│   │   │   ├── deadlock_detector.h
│   │   │   └── deadlock_resolver.h
│   │   └── src/
│   │
│   ├── agv_map_server/              # 地图服务包（中心服务器）
│   │
│   ├── agv_navigation/              # 导航包（车载端）
│   │   ├── include/agv_navigation/
│   │   │   ├── global_planner/
│   │   │   │   ├── hybrid_astar_planner.h  # [DEFAULT]
│   │   │   │   └── astar_planner.h         # [EXTENSION]
│   │   │   ├── local_planner/
│   │   │   │   ├── teb_planner.h           # [DEFAULT]
│   │   │   │   ├── dwa_planner.h           # [EXTENSION]
│   │   │   │   └── planner_plugin.h
│   │   │   └── costmap/
│   │   └── src/
│   │
│   ├── agv_localization/            # 定位包（车载端）
│   │   ├── include/agv_localization/
│   │   │   ├── ekf_localizer.h
│   │   │   ├── amcl_wrapper.h
│   │   │   ├── sensor_sync.h
│   │   │   └── localization_monitor.h
│   │   └── src/
│   │
│   ├── agv_control/                 # 底盘控制包（车载端）
│   │   ├── include/agv_control/
│   │   │   ├── differential_controller.h
│   │   │   ├── cmd_mux.h
│   │   │   ├── odometry_publisher.h
│   │   │   ├── battery_model.h
│   │   │   └── charge_strategy.h
│   │   └── src/
│   │
│   ├── agv_safety/                  # 安全包（车载端 + 中心）
│   │   ├── include/agv_safety/
│   │   │   ├── safety_guard.h            # 车载安全
│   │   │   ├── fleet_safety_monitor.h    # 中心全局安全
│   │   │   ├── collision_detector.h
│   │   │   ├── speed_limiter.h
│   │   │   ├── watchdog.h
│   │   │   └── emergency_handler.h
│   │   └── src/
│   │
│   ├── agv_simulation/              # 仿真包（仿真专用）
│   │   ├── worlds/
│   │   │   └── warehouse_25x20.sdf  # 500 m² 仓库场景
│   │   ├── models/
│   │   │   ├── agv_model/           # AGV 模型 (800×600×300mm)
│   │   │   ├── shelf/               # 货架模型
│   │   │   ├── charging_station/    # 充电站模型
│   │   │   └── dynamic_obstacle/    # 动态障碍物模型
│   │   └── src/
│   │
│   ├── agv_api_gateway/             # API 网关包（中心服务器，Python）
│   │   ├── api_gateway/
│   │   │   ├── rest_server.py
│   │   │   ├── task_handler.py
│   │   │   ├── status_handler.py
│   │   │   └── ws_handler.py
│   │   └── launch/
│   │
│   ├── agv_visualization/           # 可视化包（中心服务器）
│   │
│   └── agv_tools/                   # 工具脚本包
│       ├── scripts/
│       │   ├── task_generator.py
│       │   ├── scenario_runner.py
│       │   ├── performance_report.py
│       │   └── batch_test.py
│       └── config/
│           ├── default_params.yaml
│           ├── safety_params.yaml
│           ├── agv_config.yaml
│           └── test_scenarios.yaml
│
├── launch/                          # 启动文件
│   ├── central_server.launch.py
│   ├── agv_single.launch.py
│   ├── simulation.launch.py
│   ├── full_system.launch.py
│   └── test_scenario.launch.py
│
├── config/                          # 全局配置
│   ├── nav2_params.yaml
│   ├── safety_params.yaml
│   ├── costmap_params.yaml
│   └── fleet_params.yaml
│
├── maps/                            # 地图文件
│   ├── warehouse_25x20.yaml
│   └── warehouse_25x20.pgm
│
├── docker/                          # Docker 配置
│   ├── Dockerfile.central
│   ├── Dockerfile.onboard
│   └── docker-compose.yml
│
├── tests/                           # 测试目录
│   ├── unit/                        # 单元测试
│   ├── integration/                 # 集成测试
│   └── performance/                 # 性能测试
│
├── docs/                            # 文档
│   ├── final_architecture_design.md  # 本文件
│   ├── api_reference.md
│   ├── safety_case.md
│   ├── user_manual.md
│   └── simulation_guide.md
│
├── .clang-format
├── .clang-tidy
├── .cppcheck-suppressions
├── colcon.meta
└── README.md
```

---

## 14. 节点启动依赖顺序

```
Phase 1: 仿真环境
  └── Gazebo Ignition Fortress (world + AGV models)

Phase 2: 基础服务
  ├── map_server
  ├── ros_gz_bridge (per AGV)
  └── agv_{N}_sensor_fusion

Phase 3: 车载端感知与控制
  ├── agv_{N}_localization
  ├── agv_{N}_safety_guard
  └── agv_{N}_motion_controller

Phase 4: 车载端规划
  ├── agv_{N}_global_planner
  └── agv_{N}_local_planner

Phase 5: 中心服务
  ├── traffic_controller
  ├── task_manager
  ├── fleet_monitor
  ├── fleet_safety_monitor
  ├── charge_scheduler
  ├── api_gateway
  └── web_bridge

Phase 6: 辅助
  ├── agv_{N}_battery_manager
  ├── agv_{N}_lifecycle_manager
  └── rviz2 / Foxglove
```

---

## 15. 包依赖关系

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
│   ├── agv_map_server (依赖: agv_msgs)  │
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

## 16. 设计原则

1. **关注点分离**：调度、规划、控制、安全各自独立节点，降低耦合
2. **安全优先**：安全节点与业务节点物理隔离，安全路径独立于业务路径
3. **命名空间隔离**：每台 AGV 独立命名空间 `/agv_{N}/`，仿真多车时无冲突
4. **参数外部化**：所有算法参数通过 YAML 配置，支持运行时动态调整
5. **渐进式仿真**：从单 AGV → 3~5 AGV → 10 AGV 全场景逐步验证
6. **可观测性**：所有关键路径都有心跳、状态上报、性能指标
7. **扩展性**：预留算法切换接口（pluginlib 插件机制），支持算法迭代
8. **仿真-真实复用**：核心算法层 100% 复用，HAL 层隔离硬件差异

---

> **文档状态**：最终整合版，已消除冲突，可直接用于下游评审与任务拆解。
> **下一步**：启动批判反思智能体进行架构评审，评审通过后启动架构拆解与任务规划。
