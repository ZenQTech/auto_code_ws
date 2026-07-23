# 架构设计文档

## 1. 系统总体架构

### 1.1 架构概览

系统采用**分层 + 旁路安全**架构，分为 4 个逻辑层和 1 个跨层安全通道：

```
┌──────────────────────────────────────────────────────────────────────┐
│                         外部系统层                                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐    │
│  │ MES/WMS  │  │ 监控面板  │  │ 远程运维  │  │  MQTT Broker     │    │
│  │          │  │ (Web UI) │  │ (SSH/API)│  │  (Mosquitto)     │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘    │
│       │             │             │                  │               │
├───────┼─────────────┼─────────────┼──────────────────┼───────────────┤
│       │    网关层    │             │                  │               │
│  ┌────┴─────────────┴─────────────┴──────────────────┴──────────┐   │
│  │                    agv_api_gateway                            │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐    │   │
│  │  │ MQTT Bridge  │  │  REST API    │  │  WebSocket Srv   │    │   │
│  │  │ (任务/状态)   │  │  (查询/配置)  │  │  (实时推送)      │    │   │
│  │  └──────┬───────┘  └──────┬───────┘  └────────┬─────────┘    │   │
│  └─────────┼─────────────────┼───────────────────┼──────────────┘   │
│            │                 │                   │                   │
├────────────┼─────────────────┼───────────────────┼───────────────────┤
│            │    调度层        │                   │                   │
│  ┌─────────┴─────────────────┴───────────────────┴──────────────┐   │
│  │  ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐   │   │
│  │  │  agv_scheduler   │  │agv_fleet_mgr │  │agv_traffic   │   │   │
│  │  │  (拍卖调度核心)   │  │(车队状态管理) │  │(交通/死锁)   │   │   │
│  │  └────────┬─────────┘  └──────┬───────┘  └──────┬───────┘   │   │
│  └───────────┼───────────────────┼─────────────────┼────────────┘   │
│              │                   │                 │                 │
├──────────────┼───────────────────┼─────────────────┼─────────────────┤
│              │   AGV 车载层 (×N)  │                 │                 │
│  ┌───────────┴───────────────────┴─────────────────┴────────────┐   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐    │   │
│  │  │agv_nav   │ │agv_local │ │agv_ctrl  │ │agv_scheduler │    │   │
│  │  │(路径规划) │ │(定位融合) │ │(运动控制) │ │(车载竞拍代理) │    │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘    │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ╔══════════════════════════════════════════════════════════════╗    │
│  ║              安全层 (跨层旁路，最高优先级)                     ║    │
│  ║  ┌──────────────────────────────────────────────────────┐   ║    │
│  ║  │  agv_safety (急停监视/碰撞检测/故障分级/心跳监控)      │   ║    │
│  ║  │  独立于业务逻辑，可直接旁路运动控制输出                  │   ║    │
│  ║  └──────────────────────────────────────────────────────┘   ║    │
│  ╚══════════════════════════════════════════════════════════════╝    │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.2 设计原则

| 原则 | 实现方式 |
|------|----------|
| **模块化** | 每个包独立编译，通过 agv_msgs 接口通信，无直接代码依赖 |
| **可扩展** | AGV 数量通过 launch 参数动态配置，传感器类型通过插件模式扩展 |
| **安全性优先** | Safety 节点独立于业务逻辑，通过 CmdMux 优先级机制直接旁路运动指令 |
| **仿真优先** | 仿真与真机使用同一套 ROS 2 节点代码，仅通过 launch 参数和命名空间区分 |
| **ROS 2 最佳实践** | 话题用于数据流，服务用于请求/响应，动作用于长时任务；QoS 按场景定制 |

---

## 2. 模块详细设计

### 2.1 包依赖关系

```
agv_msgs (消息定义层，无内部依赖)
    ↓
agv_core (共享库：类型/常量/工具/生命周期)
    ↓
┌───────────┬───────────┬───────────┬───────────┬───────────┬───────────┬───────────┐
│agv_ctrl   │agv_nav    │agv_local  │agv_safety │agv_sched  │agv_fleet  │agv_traffic│
│(运动控制)  │(路径规划)  │(定位)     │(安全)     │(调度)     │(车队管理)  │(交通控制)  │
└───────────┴───────────┴───────────┴───────────┴───────────┴───────────┴───────────┘
                                    ↓
                          agv_api_gateway (网关)
                          agv_simulation (仿真)
                          agv_visualization (可视化)
                          agv_tools (工具脚本)
```

### 2.2 各模块详细设计

#### 2.2.1 agv_msgs（消息定义包）✅ 已实现

**职责**：定义所有 ROS 2 自定义消息、服务、动作

| 类别 | 已定义 | 说明 |
|------|--------|------|
| 消息 (msg) | 12 个 | TaskSpec, TaskAssignment, TaskStatusUpdate, AGVStatus, VehicleState, FleetState, SafetyStatus, EmergencyStop, BumperEvent, TrafficZone, TrafficZoneArray, SystemMetrics |
| 服务 (srv) | 18 个 | DispatchTask, CancelTask, QueryTask, QueryAGV, QueryFleet, PlanPath, GetMap, UpdateMap, ReserveZone, ReleaseZone, DetectDeadlock, ResolveDeadlock, SetGoal, PauseResume, ManualEstop, ClearEstop, RecoverLocalization, SchedulerConfig, SafetyParams, SetSpeedLimit |
| 动作 (action) | 5 个 | ExecuteTask, Navigate, Charge, Dock, Patrol |

**需新增的消息**：
- `AuctionBid.msg` — 拍卖出价消息（agv_id, task_id, bid_score, distance_cost, battery_cost, load_cost）
- `AuctionResult.msg` — 拍卖结果消息（task_id, winner_agv_id, winning_bid, all_bids）
- `MQTTTask.msg` — MQTT 任务格式（task_id, task_type, priority, start_pose, target_pose, deadline, raw_json）

#### 2.2.2 agv_core（共享核心库）✅ 部分实现

**职责**：提供所有模块共享的类型定义、常量、工具函数、生命周期管理

**已有组件**：
- `types.h` — 核心枚举（AgvState, TaskState, TaskPriority, EstopSource, SafetyLevel 等）和结构体
- `constants.h` — 系统常量（话题名、服务名、QoS、坐标帧、调度策略）
- `utils.h/cpp` — 字符串/数学/时间/命名工具函数
- `lifecycle/lifecycle_manager.h/cpp` — 节点生命周期管理

**需调整的内容**：
- `types.h` 中 AGV 物理参数需对齐需求文档（max_speed: 1.5→1.0 m/s, payload: 500→200 kg）
- 新增 AuctionBid、AuctionConfig 结构体
- 新增 MQTT 配置结构体

#### 2.2.3 agv_control（运动控制）✅ 已实现

**职责**：差速轮运动控制，包含指令多路复用和里程计计算

**已有组件**：
- `MotionControllerNode` — 主控制节点（100Hz 控制循环）
- `CmdMux` — 优先级指令多路复用器（SAFETY > LOCAL_PLANNER > GLOBAL_PLANNER > MANUAL）
- `OdometryPublisher` — 里程计计算与发布（含 TF 广播）

**接口**：
| 方向 | 名称 | 类型 | 说明 |
|------|------|------|------|
| 订阅 | `cmd_vel` | Twist | 来自局部规划器 |
| 订阅 | `cmd_vel_limited` | Twist | 来自安全看门狗（旁路） |
| 订阅 | `joint_states` | JointState | 来自 Gazebo/编码器 |
| 发布 | `cmd_vel_safe` | Twist | 经安全过滤后的最终指令 |
| 发布 | `odom` | Odometry | 里程计数据 + TF |

**设计要点**：
- CmdMux 安全通道永不超时（timeout=0），确保安全指令永不过期
- 控制循环中对输出指令做硬件限幅（软件层最后一道防线）

#### 2.2.4 agv_navigation（路径规划）🆕 待实现

**职责**：全局路径规划（A*/Theta*）+ 局部路径规划（DWA）+ 代价地图维护

**内部组件**：

```
agv_navigation/
├── include/agv_navigation/
│   ├── global_planner/
│   │   ├── astar_planner.h        # A* 全局规划器
│   │   └── thetastar_planner.h    # Theta* 全局规划器（可选）
│   ├── local_planner/
│   │   └── dwa_planner.h          # DWA 局部规划器
│   └── costmap/
│       ├── costmap_2d.h           # 2D 代价地图
│       └── inflation_layer.h      # 障碍物膨胀层
├── src/
│   ├── global_planner_node.cpp    # 全局规划节点
│   ├── local_planner_node.cpp     # 局部规划节点
│   ├── costmap/
│   │   ├── costmap_2d.cpp
│   │   └── inflation_layer.cpp
│   └── astar_planner.cpp
```

**接口**：

| 节点 | 方向 | 名称 | 类型 | QoS |
|------|------|------|------|-----|
| global_planner | 服务 | `plan_path` | PlanPath.srv | reliable |
| global_planner | 发布 | `global_path` | Path | reliable, depth=1 |
| global_planner | 订阅 | `global_map` | OccupancyGrid | transient_local |
| local_planner | 订阅 | `global_path` | Path | reliable, depth=1 |
| local_planner | 订阅 | `scan` | LaserScan | sensor, depth=10 |
| local_planner | 订阅 | `odom` | Odometry | reliable, depth=10 |
| local_planner | 订阅 | `traffic_zones` | TrafficZoneArray | reliable, depth=5 |
| local_planner | 发布 | `cmd_vel` | Twist | reliable, depth=1 |
| local_planner | 发布 | `local_path` | Path | reliable, depth=1 |
| local_planner | 发布 | `obstacle_map` | OccupancyGrid | reliable, depth=1 |

**关键设计**：
- 全局规划使用 YAML 地图生成拓扑图 → A* 搜索，计算时间 < 100ms
- 局部规划使用 DWA，计算时间 < 30ms，控制周期 50ms（20Hz）
- 代价地图融合静态地图 + 动态障碍物 + 交通区域预留信息
- 交通区域预留信息从 agv_traffic_control 订阅，作为虚拟障碍物注入代价地图

#### 2.2.5 agv_localization（定位融合）🆕 待实现

**职责**：多传感器融合定位（IMU + 编码器 + LiDAR），输出滤波后的位姿估计

**内部组件**：

```
agv_localization/
├── include/agv_localization/
│   ├── ekf_localization.h      # EKF 融合定位器
│   └── localization_monitor.h  # 定位健康监控（跳变检测/不确定度）
├── src/
│   ├── localization_node.cpp   # 定位主节点
│   └── ekf_localization.cpp
```

**接口**：

| 方向 | 名称 | 类型 | QoS |
|------|------|------|-----|
| 订阅 | `imu` | Imu | sensor, depth=10 |
| 订阅 | `odom` | Odometry | reliable, depth=10 |
| 订阅 | `scan` | LaserScan | sensor, depth=10 |
| 发布 | `localization/pose` | PoseWithCovarianceStamped | reliable, depth=5 |
| 发布 | `odom_filtered` | Odometry | reliable, depth=10 |
| 服务 | `recover_localization` | RecoverLocalization.srv | reliable |

**关键设计**：
- 使用 EKF 融合 IMU（高频 100Hz）+ 编码器（100Hz）+ LiDAR 扫描匹配（30Hz）
- 定位跳变检测：相邻帧位姿变化 > 0.5m 触发告警
- 不确定度超限（协方差椭圆主轴 > 10cm）触发定位丢失告警
- 定位丢失时通知 safety 模块，AGV 自动停车

#### 2.2.6 agv_safety（安全模块）🆕 待实现

**职责**：独立安全看门狗，监控所有安全条件，具备最高优先级旁路能力

**内部组件**：

```
agv_safety/
├── include/agv_safety/
│   ├── safety_watchdog.h         # 安全看门狗核心
│   ├── collision_detector.h      # 碰撞检测器
│   ├── heartbeat_monitor.h       # 心跳监控器
│   └── fault_classifier.h        # 故障分级器
├── src/
│   ├── safety_watchdog_node.cpp  # 安全看门狗节点
│   ├── collision_detector.cpp
│   ├── heartbeat_monitor.cpp
│   └── fault_classifier.cpp
```

**接口**：

| 方向 | 名称 | 类型 | QoS | 说明 |
|------|------|------|-----|------|
| 订阅 | `scan` | LaserScan | sensor, depth=5 | 碰撞检测源 |
| 订阅 | `safety/bumper` | BumperEvent | reliable, depth=5 | 安全触边 |
| 订阅 | `safety/scan_filtered` | LaserScan | sensor, depth=5 | 过滤后扫描 |
| 订阅 | `vehicle_state` | VehicleState | reliable, depth=5 | AGV 状态 |
| 订阅 | `localization/pose` | PoseWithCovarianceStamped | reliable, depth=5 | 定位状态 |
| 订阅 | `battery` | BatteryState | sensor, depth=5 | 电量状态 |
| 发布 | `safety/estop` | EmergencyStop | reliable, depth=1 | 急停指令 |
| 发布 | `safety/status` | SafetyStatus | reliable, depth=5 | 安全状态 |
| 发布 | `cmd_vel_limited` | Twist | reliable, depth=1 | 安全限速指令 |
| 服务 | `manual_estop` | ManualEstop.srv | reliable | 手动急停 |
| 服务 | `clear_estop` | ClearEstop.srv | reliable | 清除急停 |

**安全逻辑**：

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│ 碰撞检测器   │     │ 心跳监控器   │     │ 定位监控器   │
│ (< 0.3m→制动)│     │ (15s超时)   │     │ (跳变/协方差) │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           ▼
                  ┌─────────────────┐
                  │  故障分级器      │
                  │ L1→告警 L2→重试  │
                  │ L3→急停         │
                  └────────┬────────┘
                           ▼
                  ┌─────────────────┐
                  │ 安全看门狗       │
                  │ → 发布estop     │
                  │ → 发布限速指令   │
                  │ → 发布安全状态   │
                  └─────────────────┘
```

**关键设计**：
- 安全模块独立于所有业务模块，不依赖调度器/规划器正常运行
- 碰撞检测距离 < 0.3m 时，通过 `cmd_vel_limited` 话题向 CmdMux 发送零速指令
- CmdMux 中 SAFETY 优先级最高，安全指令直接旁路所有业务指令
- 安全看门狗以 100Hz 独立运行，不与任何业务逻辑共享线程

#### 2.2.7 agv_scheduler（任务调度）🆕 待实现

**职责**：实现分布式拍卖调度策略，管理任务生命周期

**调度架构（混合式）**：

```
                   MES/WMS
                      │
                 MQTT Broker
                      │
              ┌───────┴───────┐
              │  agv_api_gateway │  ← MQTT→ROS2 桥接
              └───────┬───────┘
                      │ DispatchTask.srv
              ┌───────┴───────┐
              │ task_dispatcher │  ← 中心任务池（仅管理任务队列，不分配）
              │  (agv_scheduler) │
              └───────┬───────┘
                      │ AuctionBid.msg (广播)
         ┌────────────┼────────────┐
         ▼            ▼            ▼
    ┌─────────┐ ┌─────────┐ ┌─────────┐
    │ AGV_01  │ │ AGV_02  │ │ AGV_03  │  ← 车载竞拍代理
    │ 计算出价 │ │ 计算出价 │ │ 计算出价 │
    └────┬────┘ └────┬────┘ └────┬────┘
         │           │           │
         └───────────┼───────────┘
                     │ AuctionBid.msg (各AGV广播出价)
              ┌──────┴──────┐
              │ 拍卖仲裁器    │  ← 分布式共识（各AGV独立判定）
              │ (各AGV本地)  │
              └──────┬──────┘
                     │ AuctionResult.msg
                     ▼
              ┌──────────────┐
              │ task_dispatcher│  ← 确认分配
              └──────────────┘
```

**内部组件**：

```
agv_scheduler/
├── include/agv_scheduler/
│   ├── task_dispatcher.h        # 中心任务调度器节点
│   ├── auction_bidder.h         # 车载竞拍代理（运行在每个AGV上）
│   ├── auction_arbitrator.h     # 拍卖仲裁器
│   ├── task_pool.h              # 任务池管理
│   └── deadlock_preventer.h     # 分布式死锁预防
├── src/
│   ├── task_dispatcher_node.cpp
│   ├── auction_bidder_node.cpp
│   ├── auction_arbitrator.cpp
│   ├── task_pool.cpp
│   └── deadlock_preventer.cpp
```

**接口**：

| 节点 | 方向 | 名称 | 类型 | 说明 |
|------|------|------|------|------|
| task_dispatcher | 服务 | `dispatch_task` | DispatchTask.srv | 接收新任务 |
| task_dispatcher | 服务 | `cancel_task` | CancelTask.srv | 取消任务 |
| task_dispatcher | 服务 | `query_task` | QueryTask.srv | 查询任务状态 |
| task_dispatcher | 发布 | `task_updates` | TaskStatusUpdate | 任务状态变更 |
| task_dispatcher | 发布 | `auction_announce` | TaskSpec | 拍卖轮次公告 |
| auction_bidder (每AGV) | 订阅 | `auction_announce` | TaskSpec | 接收拍卖公告 |
| auction_bidder (每AGV) | 发布 | `auction_bid` | AuctionBid | 提交出价 |
| auction_arbitrator | 订阅 | `auction_bid` | AuctionBid | 收集所有出价 |
| auction_arbitrator | 发布 | `auction_result` | AuctionResult | 公布拍卖结果 |

**拍卖出价公式**：
```
bid_score = w1 * (1 - distance_cost) + w2 * battery_factor + w3 * (1 - load_factor)
distance_cost = min(1.0, distance_to_start / max_warehouse_diagonal)
battery_factor = battery_level / 100.0
load_factor = current_load / max_payload
```
默认权重：w1=0.5, w2=0.3, w3=0.2（可通过参数动态配置）

**分布式死锁预防**：
- 基于资源预约图（Resource Reservation Graph）
- 各 AGV 通过 agv_traffic_control 预留路径区域
- 检测到循环等待 → 低优先级 AGV 执行超时回退 + 重新规划
- 回退策略：释放已预留区域 → 退避至安全点 → 重新竞拍路径

#### 2.2.8 agv_fleet_manager（车队管理）🆕 待实现

**职责**：聚合所有 AGV 状态，维护全局车队视图

**内部组件**：

```
agv_fleet_manager/
├── include/agv_fleet_manager/
│   └── fleet_state_manager.h
├── src/
│   └── fleet_state_manager_node.cpp
```

**接口**：

| 方向 | 名称 | 类型 | QoS | 说明 |
|------|------|------|-----|------|
| 订阅 | `vehicle_state` (×N) | VehicleState | reliable, depth=10 | 各 AGV 状态上报 |
| 发布 | `agv_states` | FleetState | reliable, depth=1 | 聚合后车队状态 |
| 发布 | `monitor/metrics` | SystemMetrics | reliable, depth=1 | 系统指标 |
| 服务 | `query_agv` | QueryAGV.srv | reliable | 查询单 AGV |
| 服务 | `query_fleet` | QueryFleet.srv | reliable | 查询全车队 |

**关键设计**：
- 10Hz 聚合周期，聚合所有 AGV 的 VehicleState → FleetState
- 心跳超时检测：AGV 状态超过 1s 未更新标记为离线
- 计算系统指标：任务完成率、平均等待时间、活跃 AGV 数

#### 2.2.9 agv_traffic_control（交通控制）🆕 待实现

**职责**：路径区域预留管理、死锁检测与解决

**内部组件**：

```
agv_traffic_control/
├── include/agv_traffic_control/
│   ├── traffic_manager.h       # 交通管理器
│   ├── zone_reservation.h      # 区域预留管理
│   └── deadlock_detector.h     # 死锁检测器
├── src/
│   ├── traffic_manager_node.cpp
│   ├── zone_reservation.cpp
│   └── deadlock_detector.cpp
```

**接口**：

| 方向 | 名称 | 类型 | QoS |
|------|------|------|-----|
| 订阅 | `agv_states` | FleetState | reliable, depth=1 |
| 订阅 | `global_path` (×N) | Path | reliable, depth=1 |
| 发布 | `traffic_zones` | TrafficZoneArray | reliable, depth=1 |
| 服务 | `reserve_zone` | ReserveZone.srv | reliable |
| 服务 | `release_zone` | ReleaseZone.srv | reliable |
| 服务 | `detect_deadlock` | DetectDeadlock.srv | reliable |
| 服务 | `resolve_deadlock` | ResolveDeadlock.srv | reliable |

**区域划分策略**：
- 将仓库地图划分为网格区域（每个区域 1m×1m）
- AGV 规划路径后，沿路径预留前方 2m 区域（当前速度 × 2s 前瞻）
- 区域状态：FREE → RESERVED（预约）→ OCCUPIED（进入）→ FREE（离开）

#### 2.2.10 agv_api_gateway（网关）🆕 待实现

**职责**：MQTT 桥接、REST API、WebSocket 实时推送

**内部组件**：

```
agv_api_gateway/
├── agv_api_gateway/
│   ├── mqtt_bridge.py           # MQTT ↔ ROS2 桥接
│   ├── rest_api.py              # REST API 服务
│   └── websocket_server.py      # WebSocket 实时推送
```

**MQTT 桥接设计**：

| 方向 | MQTT Topic | ROS2 接口 | 说明 |
|------|-----------|-----------|------|
| MES→ROS2 | `agv/task/new` | DispatchTask.srv | 新任务下发 |
| MES→ROS2 | `agv/task/cancel` | CancelTask.srv | 任务取消 |
| ROS2→MES | `agv/task/status` | task_updates 话题 | 任务状态上报 |
| ROS2→MES | `agv/fleet/state` | agv_states 话题 | 车队状态上报 |
| 双向 | `agv/heartbeat` | — | 心跳维持（5s间隔） |

**REST API 端点**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/v1/fleet/state` | 获取全车队状态 |
| GET | `/api/v1/agv/{id}/state` | 获取指定 AGV 状态 |
| POST | `/api/v1/task` | 创建新任务 |
| DELETE | `/api/v1/task/{id}` | 取消任务 |
| GET | `/api/v1/task/{id}` | 查询任务状态 |
| POST | `/api/v1/safety/estop` | 触发紧急停止 |
| POST | `/api/v1/safety/clear` | 清除紧急停止 |
| GET | `/api/v1/metrics` | 获取系统指标 |
| GET | `/api/v1/config` | 获取当前配置 |
| PUT | `/api/v1/config` | 更新配置 |

**WebSocket 推送频道**：

| 频道 | 推送内容 | 频率 |
|------|----------|------|
| `fleet_state` | FleetState | 10Hz |
| `task_updates` | TaskStatusUpdate | 事件驱动 |
| `safety_alerts` | SafetyStatus | 事件驱动 |
| `metrics` | SystemMetrics | 1Hz |

#### 2.2.11 agv_simulation（仿真）✅ 部分实现

**已有组件**：
- `agv.urdf.xacro` — AGV 差速轮模型（含 LiDAR/IMU/Camera/安全触边）
- `shelf/model.sdf` — 货架模型
- `charging_station/model.sdf` — 充电站模型
- `loading_dock/model.sdf` — 装卸码头模型
- `warehouse.world` — 25m×20m 仓库世界（4行×10列货架）

**待实现**：
- 参数化场景生成脚本（从 YAML 配置生成 .world 文件）
- 多 AGV 批量生成 launch 文件
- 仿真传感器插件配置（VLP-16 噪声模型）

#### 2.2.12 agv_visualization（可视化）🆕 待实现

**职责**：Rviz2 配置文件和 Foxglope WebSocket 桥接

**组件**：
- `rviz/warehouse.rviz` — 仓库场景 Rviz2 配置
- `foxglove_bridge.launch.py` — Foxglove WebSocket 桥接启动

#### 2.2.13 agv_tools（工具脚本）🆕 待实现

**职责**：测试脚本、数据分析、场景评估工具

**脚本**：
- `scripts/scenario_runner.py` — 批量测试场景运行器
- `scripts/metrics_analyzer.py` — 指标分析工具
- `scripts/map_generator.py` — YAML→world 地图生成器

---

## 3. ROS 2 接口定义

### 3.1 话题完整列表

| 话题 | 消息类型 | 发布者 | 订阅者 | QoS | 频率 |
|------|----------|--------|--------|-----|------|
| `/agv_{id}/scan` | LaserScan | Gazebo/传感器驱动 | local_planner, safety_watchdog, localization | sensor(10) | 30Hz |
| `/agv_{id}/imu` | Imu | Gazebo/IMU驱动 | localization | sensor(10) | 100Hz |
| `/agv_{id}/odom` | Odometry | motion_controller | local_planner, localization, fleet_manager | reliable(10) | 100Hz |
| `/agv_{id}/odom_filtered` | Odometry | localization | local_planner | reliable(10) | 100Hz |
| `/agv_{id}/cmd_vel` | Twist | local_planner | motion_controller | reliable(1) | 20Hz |
| `/agv_{id}/cmd_vel_limited` | Twist | safety_watchdog | motion_controller | reliable(1) | 事件驱动 |
| `/agv_{id}/cmd_vel_safe` | Twist | motion_controller | Gazebo/电机驱动 | reliable(1) | 100Hz |
| `/agv_{id}/global_path` | Path | global_planner | local_planner, traffic_manager | reliable(1) | 事件驱动 |
| `/agv_{id}/local_path` | Path | local_planner | — (debug/vis) | reliable(1) | 20Hz |
| `/agv_{id}/localization/pose` | PoseWithCovarianceStamped | localization | safety_watchdog, local_planner | reliable(5) | 100Hz |
| `/agv_{id}/vehicle_state` | VehicleState | vehicle_fsm | fleet_manager, safety_watchdog | reliable(5) | 10Hz |
| `/agv_{id}/battery` | BatteryState | Gazebo/电池驱动 | safety_watchdog, auction_bidder | sensor(5) | 1Hz |
| `/agv_{id}/obstacle_map` | OccupancyGrid | local_planner | — (debug) | reliable(1) | 5Hz |
| `/agv_{id}/safety/estop` | EmergencyStop | safety_watchdog | vehicle_fsm, fleet_manager | reliable(1) | 事件驱动 |
| `/agv_{id}/safety/status` | SafetyStatus | safety_watchdog | fleet_manager, api_gateway | reliable(5) | 10Hz |
| `/agv_{id}/safety/bumper` | BumperEvent | Gazebo/安全触边 | safety_watchdog | reliable(5) | 事件驱动 |
| `/agv_{id}/safety/scan_filtered` | LaserScan | safety_watchdog | — (debug) | sensor(5) | 30Hz |
| `/agv_{id}/auction_bid` | AuctionBid | auction_bidder | auction_arbitrator | reliable(5) | 事件驱动 |
| `/agv_{id}/joint_states` | JointState | Gazebo/编码器 | motion_controller | sensor(10) | 100Hz |
| `/fleet/agv_states` | FleetState | fleet_manager | traffic_manager, api_gateway | reliable(1) | 10Hz |
| `/fleet/traffic_zones` | TrafficZoneArray | traffic_manager | local_planner (×N) | reliable(1) | 10Hz |
| `/fleet/global_map` | OccupancyGrid | map_service | global_planner (×N) | transient_local | 事件驱动 |
| `/fleet/task_updates` | TaskStatusUpdate | task_dispatcher | fleet_manager, api_gateway | reliable(5) | 事件驱动 |
| `/fleet/monitor/metrics` | SystemMetrics | fleet_manager | api_gateway, visualization | reliable(1) | 1Hz |
| `/fleet/auction_announce` | TaskSpec | task_dispatcher | auction_bidder (×N) | reliable(5) | 事件驱动 |
| `/fleet/auction_result` | AuctionResult | auction_arbitrator | task_dispatcher, auction_bidder (×N) | reliable(5) | 事件驱动 |

### 3.2 服务完整列表

| 服务 | 类型 | 服务端 | 客户端 | QoS |
|------|------|--------|--------|-----|
| `/fleet/dispatch_task` | DispatchTask.srv | task_dispatcher | api_gateway | reliable |
| `/fleet/cancel_task` | CancelTask.srv | task_dispatcher | api_gateway | reliable |
| `/fleet/query_task` | QueryTask.srv | task_dispatcher | api_gateway | reliable |
| `/fleet/query_agv` | QueryAGV.srv | fleet_manager | api_gateway | reliable |
| `/fleet/query_fleet` | QueryFleet.srv | fleet_manager | api_gateway | reliable |
| `/fleet/get_map` | GetMap.srv | map_service | global_planner | reliable |
| `/fleet/update_map` | UpdateMap.srv | map_service | api_gateway | reliable |
| `/fleet/reserve_zone` | ReserveZone.srv | traffic_manager | local_planner | reliable |
| `/fleet/release_zone` | ReleaseZone.srv | traffic_manager | local_planner | reliable |
| `/fleet/detect_deadlock` | DetectDeadlock.srv | traffic_manager | task_dispatcher | reliable |
| `/fleet/resolve_deadlock` | ResolveDeadlock.srv | traffic_manager | task_dispatcher | reliable |
| `/fleet/set_scheduler_config` | SchedulerConfig.srv | task_dispatcher | api_gateway | reliable |
| `/agv_{id}/plan_path` | PlanPath.srv | global_planner | task_dispatcher | reliable |
| `/agv_{id}/set_goal` | SetGoal.srv | local_planner | task_dispatcher | reliable |
| `/agv_{id}/pause_resume` | PauseResume.srv | vehicle_fsm | safety_watchdog | reliable |
| `/agv_{id}/manual_estop` | ManualEstop.srv | safety_watchdog | api_gateway | reliable |
| `/agv_{id}/clear_estop` | ClearEstop.srv | safety_watchdog | api_gateway | reliable |
| `/agv_{id}/recover_localization` | RecoverLocalization.srv | localization | safety_watchdog | reliable |
| `/agv_{id}/set_safety_params` | SafetyParams.srv | safety_watchdog | api_gateway | reliable |
| `/agv_{id}/set_speed_limit` | SetSpeedLimit.srv | safety_watchdog | api_gateway | reliable |

### 3.3 动作完整列表

| 动作 | 类型 | 服务端 | 客户端 | 说明 |
|------|------|--------|--------|------|
| `/agv_{id}/navigate` | Navigate.action | local_planner | vehicle_fsm | 导航到目标点 |
| `/agv_{id}/execute_task` | ExecuteTask.action | vehicle_fsm | task_dispatcher | 执行完整任务 |
| `/agv_{id}/charge` | Charge.action | vehicle_fsm | task_dispatcher | 充电任务 |
| `/agv_{id}/dock` | Dock.action | vehicle_fsm | task_dispatcher | 对接任务 |
| `/agv_{id}/patrol` | Patrol.action | vehicle_fsm | task_dispatcher | 巡逻任务 |

### 3.4 需新增的消息定义

**AuctionBid.msg**（需新增）：
```
string agv_id
string task_id
float32 bid_score
float32 distance_cost
float32 battery_cost
float32 load_cost
builtin_interfaces/Time timestamp
```

**AuctionResult.msg**（需新增）：
```
string task_id
string winner_agv_id
float32 winning_bid
AuctionBid[] all_bids
builtin_interfaces/Time timestamp
```

---

## 4. 数据流设计

### 4.1 任务执行主数据流

```
MES/WMS
  │ MQTT: agv/task/new
  ▼
agv_api_gateway (MQTT Bridge)
  │ DispatchTask.srv
  ▼
task_dispatcher (任务池)
  │ 发布 auction_announce (TaskSpec)
  ▼
┌─────────────────────────────────────────┐
│  分布式拍卖轮 (超时窗口: 500ms)           │
│                                          │
│  AGV_01.auction_bidder ──→ AuctionBid   │
│  AGV_02.auction_bidder ──→ AuctionBid   │
│  AGV_03.auction_bidder ──→ AuctionBid   │
│                     │                    │
│              auction_arbitrator          │
│                (各AGV本地独立判定)        │
│                     │                    │
│              发布 AuctionResult          │
└─────────────────────────────────────────┘
  │ 赢家 AGV 收到分配
  ▼
AGV_{id}.vehicle_fsm
  │ ExecuteTask.action
  ▼
  ├─→ global_planner: PlanPath.srv (计算全局路径)
  │      │
  │      ▼
  │   local_planner: DWA (局部规划 + 避障)
  │      │ cmd_vel (Twist, 20Hz)
  │      ▼
  │   motion_controller: CmdMux → cmd_vel_safe
  │      │
  │      ▼
  │   Gazebo/电机驱动
  │
  └─→ 状态反馈: vehicle_state → fleet_manager → agv_states
      任务状态: task_updates → api_gateway → MQTT → MES/WMS
```

### 4.2 安全数据流（旁路通道）

```
传感器层
  │ LaserScan, BumperEvent, BatteryState, PoseWithCovarianceStamped
  ▼
agv_safety (safety_watchdog, 100Hz)
  │
  ├── 碰撞检测: min_distance < 0.3m?
  ├── 心跳监控: comm_timeout > 15s?
  ├── 定位监控: jump > 0.5m or covariance > threshold?
  ├── 速度监控: speed > max_limit?
  └── 电量监控: battery < 5%?
  │
  ├─→ safety/estop (EmergencyStop) ──→ vehicle_fsm (状态切换)
  └─→ cmd_vel_limited (Twist, 零速) ──→ motion_controller/CmdMux
                                           │
                                    SAFETY 优先级最高
                                    旁路所有业务指令
```

### 4.3 交通控制数据流

```
各 AGV global_planner
  │ global_path (Path)
  ▼
traffic_manager
  │ 分析所有 AGV 的规划路径
  │ 检测路径交叉和资源冲突
  │
  ├─→ traffic_zones (TrafficZoneArray, 10Hz) → local_planner (×N)
  │    │ 各 local_planner 将预留区域注入代价地图
  │    │
  ├─→ detect_deadlock → 循环等待检测
  │    │
  └─→ resolve_deadlock → 回退/重新规划指令
```

---

## 5. 生命周期管理

### 5.1 节点启动顺序

```
阶段 1: 基础设施层
  ├─ agv_api_gateway (MQTT Bridge + REST API)
  ├─ map_service (加载 YAML 地图)
  └─ fleet_state_manager (车队状态管理)

阶段 2: 调度层
  ├─ task_dispatcher (任务调度器)
  ├─ traffic_manager (交通管理器)
  └─ auction_arbitrator (拍卖仲裁器)

阶段 3: AGV 车载层 (并行启动，×N)
  ├─ safety_watchdog (安全看门狗，最先启动)
  ├─ localization (定位融合)
  ├─ motion_controller (运动控制)
  ├─ global_planner (全局规划器)
  ├─ local_planner (局部规划器)
  ├─ vehicle_fsm (车辆状态机)
  └─ auction_bidder (竞拍代理，最后启动)
```

### 5.2 AGV 车载节点生命周期状态机

```
                    ┌─────────────┐
        configure   │UNCONFIGURED │
    ┌──────────────→│             │
    │               └──────┬──────┘
    │                      │ configure
    │               ┌──────▼──────┐   activate
    │     cleanup   │  INACTIVE   │──────────────┐
    │   ┌───────────│             │              │
    │   │           └──────▲──────┘              │
    │   │                  │ deactivate          │
    │   │           ┌──────┴──────┐              │
    │   │           │   ACTIVE    │←─────────────┘
    │   │           │  (正常运行)  │
    │   │           └──────┬──────┘
    │   │                  │ error (致命故障)
    │   │           ┌──────▼──────┐
    │   │           │    ERROR    │
    │   └──────────→│  (安全停机)  │
    │               └──────┬──────┘
    │                      │ shutdown
    │               ┌──────▼──────┐
    └───────────────│  SHUTDOWN   │
                    └─────────────┘
```

### 5.3 全局状态机

```
┌──────────┐   启动完成   ┌──────────┐   任务到达   ┌──────────┐
│  INIT    │────────────→│  IDLE    │────────────→│SCHEDULING│
│(系统初始化)│             │(等待任务) │             │(拍卖进行中)│
└──────────┘             └──────────┘             └────┬─────┘
                             ▲                        │
                             │              分配完成  │
                             │         ┌──────────────┘
                             │         ▼
                        任务完成 ┌──────────┐
                        ┌───────│EXECUTING │
                        │       │(任务执行中)│
                        │       └─────┬────┘
                        │             │
                   ┌────┴────┐   ┌────┴────┐
                   │ 故障恢复 │   │ 急停触发 │
                   │ (L2重试) │   │ (L3故障) │
                   └────┬────┘   └────┬────┘
                        │             │
                        ▼             ▼
                   ┌──────────┐ ┌──────────┐
                   │DEGRADED  │ │EMERGENCY │
                   │(降级运行) │ │(紧急停止) │
                   └──────────┘ └──────────┘
```

### 5.4 Vehicle FSM 状态转换

| 当前状态 | 事件 | 新状态 | 动作 |
|----------|------|--------|------|
| IDLE | 收到任务分配 | NAVIGATING | 启动 ExecuteTask 动作 |
| NAVIGATING | 到达目标 | DOCKING/IDLE | 执行对接或标记完成 |
| NAVIGATING | 碰撞检测触发 | ESTOP | 紧急制动 |
| NAVIGATING | L2 故障 | NAVIGATING | 自动重试（最多3次） |
| NAVIGATING | L3 故障 | FAILED | 停车锁电机，上报告警 |
| ESTOP | 人工清除急停 | IDLE | 重新初始化 |
| FAILED | 人工恢复 | IDLE | 诊断后重新上线 |
| 任意 | 低电量 < 20% | CHARGING | 导航至充电站 |

---

## 6. 配置管理方案

### 6.1 配置文件组织

```
agv_fleet_ws/
├── config/
│   ├── agv/
│   │   ├── agv_01.yaml          # AGV_01 专属参数
│   │   ├── agv_02.yaml
│   │   └── agv_default.yaml     # AGV 默认参数模板
│   ├── fleet/
│   │   ├── scheduler.yaml       # 调度器参数（拍卖权重/超时）
│   │   ├── traffic.yaml         # 交通控制参数（区域大小/前瞻距离）
│   │   └── safety.yaml          # 安全参数（距离阈值/速度限幅）
│   ├── maps/
│   │   ├── warehouse_a.yaml     # 仓库 A 地图配置
│   │   └── warehouse_b.yaml
│   ├── comm/
│   │   ├── mqtt.yaml            # MQTT Broker 配置
│   │   └── rest_api.yaml        # REST API 配置
│   └── simulation.yaml          # 仿真参数
├── launch/
│   ├── simulation.launch.py     # Gazebo 仿真启动
│   ├── agv_single.launch.py     # 单 AGV 启动（参数: agv_id, namespace）
│   ├── central_server.launch.py # 中心服务启动
│   ├── full_system.launch.py    # 全系统启动
│   └── test_scenario.launch.py  # 测试场景启动
└── maps/
    ├── warehouse_a.pgm          # 占据栅格地图
    └── warehouse_a.yaml         # 地图元数据
```

### 6.2 关键配置参数

**scheduler.yaml**：
```yaml
scheduler:
  strategy: "auction"           # 调度策略: auction / fcfs / priority
  auction:
    bid_timeout_ms: 500         # 拍卖出价超时 (ms)
    bid_weights:                # 出价权重
      distance: 0.5
      battery: 0.3
      load: 0.2
    fairness_max_deviation: 0.2 # 最大分配偏差
  retry:
    max_retries: 3              # L2 故障最大重试次数
    retry_delay_s: 2.0          # 重试间隔 (s)
```

**safety.yaml**：
```yaml
safety:
  collision:
    min_distance_m: 0.3         # 碰撞检测最小距离
    deceleration_distance_m: 0.5
  speed_limits:
    max_linear: 1.0             # 最大线速度 (m/s)
    max_angular: 1.0            # 最大角速度 (rad/s)
    max_acceleration: 1.0       # 最大加速度 (m/s²)
    turn_speed: 0.5             # 转弯限速
    loading_speed: 0.3          # 装卸限速
  heartbeat:
    period_s: 5.0               # 心跳间隔
    timeout_s: 15.0             # 心跳超时
  battery:
    charge_trigger: 20.0        # 充电提醒阈值 (%)
    force_charge: 10.0          # 强制充电阈值 (%)
    estop_threshold: 5.0        # 低电量急停阈值 (%)
  localization:
    jump_threshold_m: 0.5       # 跳变检测阈值
    accuracy_static_cm: 3.0     # 静态定位精度
    accuracy_dynamic_cm: 5.0    # 动态定位精度
```

### 6.3 动态配置（运行时修改）

支持通过 ROS 2 参数服务和专用服务动态修改的配置：
- 速度限幅（SetSpeedLimit.srv）
- 安全参数（SafetyParams.srv）
- 调度器配置（SchedulerConfig.srv）
- 地图更新（UpdateMap.srv）

---

## 7. 仿真与真机桥接方案

### 7.1 统一代码策略

```
                    同一套 ROS 2 节点代码
                    ════════════════════
                            │
            ┌───────────────┴───────────────┐
            ▼                               ▼
    ┌───────────────┐               ┌───────────────┐
    │  仿真模式      │               │  真机模式      │
    │               │               │               │
    │ 传感器:        │               │ 传感器:        │
    │  Gazebo 插件   │               │  真实驱动      │
    │               │               │               │
    │ 执行器:        │               │ 执行器:        │
    │  Gazebo 差速   │               │  电机驱动      │
    │  驱动插件      │               │               │
    └───────────────┘               └───────────────┘
```

### 7.2 启动参数区分

```python
# simulation.launch.py - 仿真模式
simulation_mode = LaunchConfiguration('simulation', default='true')

# 仿真模式下加载 Gazebo 桥接节点
if simulation_mode == 'true':
    gazebo_bridge = Node(package='agv_simulation', ...)
    
# 真机模式下加载硬件驱动节点
else:
    hardware_driver = Node(package='agv_hardware', ...)
```

### 7.3 命名空间隔离

```python
# 仿真中 AGV 使用独立命名空间
agv_namespace = f'agv_{agv_id:02d}'  # 如 /agv_01/scan

# 真机 AGV 使用相同命名空间约定
# 保证话题名称一致，代码无需修改
```

### 7.4 仿真到真机迁移流程

```
阶段 1: 纯仿真验证
  └─ Gazebo 中运行全系统，验证所有功能路径 > 90%

阶段 2: 硬件在环 (HIL)
  └─ 真实传感器数据注入仿真系统
  └─ 真实电机接收仿真控制指令

阶段 3: 单 AGV 真机测试
  └─ 1 台真机 + 其余仿真 AGV 混合运行

阶段 4: 全真机部署
  └─ 所有 AGV 替换为真机
```

---

## 8. 安全架构设计

### 8.1 安全设计原则

```
┌─────────────────────────────────────────────────────────┐
│                    安全设计原则                           │
│                                                         │
│  1. 独立通道: 安全模块有独立的传感器数据通道              │
│  2. 最高优先级: CmdMux 中 SAFETY 优先级不可覆盖          │
│  3. 故障安全: 任何安全模块自身故障 → 触发安全停机         │
│  4. 双重冗余: 软件急停 + 硬件急停按钮                    │
│  5. 不可逾越: 硬件限幅在固件层实现，软件层再次限幅        │
└─────────────────────────────────────────────────────────┘
```

### 8.2 多层安全防护

```
第 1 层: 固件层 (硬件)
  ├─ 电机驱动限幅 (v_max=1.0, a_max=1.0)
  ├─ 急停按钮 → 直接切断电机电源
  └─ 安全触边 → 硬件中断

第 2 层: 安全看门狗 (100Hz)
  ├─ 碰撞检测 (< 0.3m → cmd_vel_limited=0)
  ├─ 速度监控 (> max → estop)
  ├─ 定位监控 (跳变/丢失 → estop)
  ├─ 心跳监控 (> 15s → estop)
  └─ 电量监控 (< 5% → estop)

第 3 层: 运动控制 (100Hz)
  ├─ CmdMux 优先级过滤 (SAFETY 最高)
  └─ 软件限幅 (二次限幅)

第 4 层: 业务层
  ├─ 交通控制 (区域预留 → 避免碰撞)
  ├─ 死锁预防 (回退 → 避免卡死)
  └─ 任务超时 (任务级安全)
```

### 8.3 故障分级处理矩阵

| 级别 | 故障类型 | 检测方式 | 响应动作 | 恢复方式 |
|------|----------|----------|----------|----------|
| **L1 警告** | 电量 < 30% | 电池监控 | 日志记录 + 状态上报 | 自动：完成当前任务后充电 |
| **L1 警告** | 传感器数据短暂丢失 (< 1s) | 数据超时 | 日志记录 | 自动：数据恢复后继续 |
| **L1 警告** | 定位不确定度升高 | 协方差监控 | 降速至 0.5m/s | 自动：不确定度恢复后提速 |
| **L2 可恢复** | 路径被临时阻挡 > 3s | 局部规划器 | 自动重试 3 次 | 自动：重试成功继续 / 失败→L3 |
| **L2 可恢复** | 任务竞拍冲突 | 拍卖仲裁器 | 重新竞拍 | 自动：下一轮竞拍 |
| **L2 可恢复** | 死锁检测 | 死锁检测器 | 回退 + 重新规划 | 自动：回退后重规划 |
| **L3 致命** | 碰撞检测 < 0.3m | 安全看门狗 | 紧急制动 + 锁电机 | 人工：清除急停 + 检查 |
| **L3 致命** | 通信心跳超时 15s | 心跳监控 | 自动停车 | 人工：检查通信链路 |
| **L3 致命** | 定位丢失 | 定位监控 | 立即停车 | 人工：重定位或回收 |
| **L3 致命** | 超速 > 1.2m/s | 速度监控 | 紧急制动 | 人工：检查电机驱动 |
| **L3 致命** | 电量 < 5% | 电池监控 | 紧急停车 | 人工：手动回收充电 |
| **L3 致命** | 电机故障 | 状态监控 | 锁电机 + 告警 | 人工：维修 |

### 8.4 安全通信

```
┌──────────────────────────────────────────────┐
│            安全通信架构                        │
│                                               │
│  MES/WMS ←→ MQTT Broker ←→ agv_api_gateway   │
│            │                                   │
│        TLS 1.2+ 加密                           │
│        QoS 1 (至少一次)                         │
│        Retained Message (最后遗嘱)              │
│                                               │
│  ROS 2 内部通信:                               │
│  - 安全话题使用 RELIABLE + TRANSIENT_LOCAL    │
│  - 安全服务使用 RELIABLE                      │
│  - 安全话题 depth=1 (只关心最新值)             │
└──────────────────────────────────────────────┘
```

### 8.5 操作日志

| 日志类别 | 记录内容 | 保留期 | 存储位置 |
|----------|----------|--------|----------|
| 安全事件 | 急停触发/清除、碰撞检测、故障分级 | 90 天 | 本地 + 远程 |
| 任务日志 | 任务创建/分配/完成/失败 | 90 天 | 本地 + 远程 |
| 操作日志 | 人工操作（启动/停止/配置修改） | 90 天 | 本地 + 远程 |
| 系统指标 | 性能指标（每分钟采样） | 30 天 | 本地 |
| 调试日志 | ROS 2 日志（按级别） | 7 天 | 本地（滚动） |

---

## 9. 与需求文档的对齐说明

### 9.1 参数差异说明

| 参数 | 需求文档值 | 现有代码值 | 架构决策 |
|------|-----------|-----------|----------|
| 最大线速度 | 1.0 m/s | 1.5 m/s | **以需求文档为准**，修改 constants.h 和 URDF |
| 最大加速度 | 1.0 m/s² | 未显式定义 | **以需求文档为准**，在 safety.yaml 中配置 |
| 额定负载 | 200 kg | 500 kg | **以需求文档为准**，修改 URDF payload |
| 传感器 | VLP-16 + BNO055 + 光电编码器 | 16线LiDAR + IMU + 编码器 | 现有模型已兼容，需调整噪声模型匹配 VLP-16 |
| 控制周期 | 50ms | 10ms (100Hz) | 保留 100Hz（更高性能），50ms 作为最低要求 |
| 调度策略 | 分布式拍卖 | 中心调度（README） | **以需求文档为准**，实现混合式拍卖架构 |

### 9.2 验收标准可追溯性

| 验收标准 | 对应模块 | 验证方式 |
|----------|----------|----------|
| AC-1 点到点运输 | agv_navigation + agv_control + agv_localization | 仿真 100 次 |
| AC-2 动态避障 | agv_navigation (DWA) + agv_safety | 仿真 + 真机 |
| AC-3 多AGV协同 | agv_scheduler + agv_traffic_control | 仿真 50 次 |
| AC-4 拍卖调度 | agv_scheduler (auction) | 仿真 100 次 |
| AC-5 故障恢复 | agv_safety (fault_classifier) | 故障注入测试 |
| AC-6 仿真覆盖率 | agv_simulation (scenario_runner) | 覆盖率报告 |
| AC-7 MQTT通信 | agv_api_gateway (mqtt_bridge) | 压力测试 |

---

## 附录 A: 新增消息定义

**agv_msgs/msg/AuctionBid.msg**:
```
# 拍卖出价消息
string agv_id
string task_id
float32 bid_score          # 综合出价分数 (0.0-1.0, 越高越优)
float32 distance_cost      # 距离成本因子
float32 battery_cost       # 电量成本因子
float32 load_cost          # 负载成本因子
builtin_interfaces/Time timestamp
```

**agv_msgs/msg/AuctionResult.msg**:
```
# 拍卖结果消息
string task_id
string winner_agv_id
float32 winning_bid
AuctionBid[] all_bids
builtin_interfaces/Time timestamp
```

**agv_msgs/msg/MQTTTask.msg**:
```
# MQTT 任务格式
string task_id
string task_type
string priority
geometry_msgs/Pose2D start_pose
geometry_msgs/Pose2D target_pose
string payload_id
builtin_interfaces/Time deadline
string raw_json            # 原始 MQTT 消息 (用于透传/审计)
```

## 附录 B: 包依赖矩阵

| 包名 | 类型 | 依赖 | 实现状态 |
|------|------|------|----------|
| agv_msgs | 消息定义 | builtin_interfaces, geometry_msgs, nav_msgs, sensor_msgs, std_msgs | ✅ 完成 |
| agv_core | 共享库 | rclcpp, agv_msgs, geometry_msgs, nav_msgs | ✅ 部分（需新增拍卖/MQTT类型） |
| agv_control | C++ 节点 | rclcpp, agv_core, agv_msgs, geometry_msgs, nav_msgs | ✅ 完成 |
| agv_navigation | C++ 节点 | rclcpp, agv_core, agv_msgs, nav_msgs, tf2 | 🆕 待实现 |
| agv_localization | C++ 节点 | rclcpp, agv_core, agv_msgs, sensor_msgs, tf2 | 🆕 待实现 |
| agv_safety | C++ 节点 | rclcpp, agv_core, agv_msgs, sensor_msgs | 🆕 待实现 |
| agv_scheduler | C++ 节点 | rclcpp, agv_core, agv_msgs | 🆕 待实现 |
| agv_fleet_manager | C++ 节点 | rclcpp, agv_core, agv_msgs | 🆕 待实现 |
| agv_traffic_control | C++ 节点 | rclcpp, agv_core, agv_msgs, nav_msgs | 🆕 待实现 |
| agv_api_gateway | Python 包 | rclpy, agv_msgs, paho-mqtt, fastapi | 🆕 待实现 |
| agv_simulation | 模型/配置 | gazebo_ros, agv_msgs | ✅ 部分（模型+世界已有） |
| agv_visualization | 配置 | rviz2, foxglove_bridge | 🆕 待实现 |
| agv_tools | Python 脚本 | rclpy, agv_msgs, matplotlib | 🆕 待实现 |

