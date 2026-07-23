# AGV 多机调度系统 — 顶层架构设计

> 版本: v1.0  
> 文档状态: 初稿  
> 总架构师: AI Architect  
> 日期: 2026-07-02

---

## 目录

1. [系统总体架构图（ASCII）](#1-系统总体架构图ascii)
2. [模块划分与职责定义](#2-模块划分与职责定义)
3. [ROS 2 话题/服务/动作接口定义](#3-ros-2-话题服务动作接口定义)
4. [技术选型建议](#4-技术选型建议)
5. [关键设计决策](#5-关键设计决策)

---

## 1. 系统总体架构图（ASCII）

### 1.1 分层架构总览

```
 +=============================================================================+
 |                         WMS (外部仓储管理系统)                                 |
 |                  WebSocket + JSON (port 8765)                                |
 +=============================================================================+
                              |
                              v
 +=============================================================================+
 |                      +----------------------------+                          |
 |  == 集中调度层 ==     |     Fleet Manager Node     |  (独立进程, ROS 2 Node)  |
 |  (Fleet Manager)      |   - 任务池管理              |                         |
 |  仿真/真机通用        |   - 优先级排序 & 分配        |                         |
 |                       |   - AGV 状态追踪            |                         |
 |                       |   - 冲突检测 & 死锁预防     |                         |
 |                       +-----------+----------------+                         |
 |                                   |                                          |
 |                       +-----------v----------------+                         |
 |                       |     Global Planner Node     |  (独立进程, ROS 2 Node)  |
 |                       |   - 静态地图加载 & 拓扑     |                         |
 |                       |   - A* 全局路径规划          |                         |
 |                       |   - 路径冲突协调             |                         |
 |                       +-----------+----------------+                         |
 |                                   |                                          |
 |                       +-----------v----------------+                         |
 |                       |    Visualizer Node          |  (独立进程, ROS 2 Node)  |
 |                       |   - WebSocket Bridge        |                         |
 |                       |   - AGV 状态聚合转发         |                         |
 |                       +-----------+----------------+                         |
 +=============================================================================+
                              |
            +-----------------+-----------------+
            | DDS (ROS 2 Middleware)            |
            | Fast DDS / Cyclone DDS           |
            | 仿真: localhost-only              |
            | 真机: 分布式局域网 discovery      |
            +-----------------+-----------------+
                              |
         +--------------------+--------------------+
         |                                         |
 +-------v--------+                       +--------v-------+
 |  AGV Instance 1 |    . . .              |  AGV Instance N|
 | (ROS 2 Node)    |                       | (ROS 2 Node)   |
 +==================+                       +================+
 |  == 单车层 ==   |                       |  == 单车层 ==  |
 |                  |                       |                |
 | +--------------+ |                       | +------------+ |
 | | Local        | |                       | | Local      | |
 | | Planner Node | |                       | | Planner    | |
 | | (DWA/TEB)    | |                       | | Node       | |
 | +------+-------+ |                       | +-----+------+ |
 |        |         |                       |       |        |
 | +------v-------+ |                       | +-----v------+ |
 | | Sensor Fusion| |                       | | Sensor     | |
 | | Node (AMCL)  | |                       | | Fusion Node| |
 | +------+-------+ |                       | +-----+------+ |
 |        |         |                       |       |        |
 | +------v-------+ |                       | +-----v------+ |
 | | Safety Node   | | (独立最高优先级)      | | Safety Node| |
 | | - LiDAR 碰撞  | |                      | | - LiDAR 碰撞|
 | | - 虚拟安全区  | |                      | | - 虚拟安全区|
 | | - 限幅器      | |                      | | - 限幅器    |
 | +------+-------+ |                       | +-----+------+ |
 |        |         |                       |       |        |
 | +------v-------+ |                       | +-----v------+ |
 | | HAL Node      | |                      | | HAL Node   | |
 | | (硬件抽象层)  | |                      | | (硬件抽象层)|
 | +------+-------+ |                       | +-----+------+ |
 |        |         |                       |       |        |
 | +------v-------+ |                       | +-----v------+ |
 | | Motor Driver  | |                      | | Motor      | |
 | | (差速轮底盘)  | |                      | | Driver     | |
 | +--------------+ |                       | +------------+ |
 | +--------------+ |                       | +------------+ |
 | | LiDAR Driver  | |                      | | LiDAR      | |
 | | (SICK TiM)   | |                      | | Driver     | |
 | +--------------+ |                       | +------------+ |
 | +--------------+ |                       | +------------+ |
 | | HW E-Stop    | | (硬件急停按钮直连)    | | HW E-Stop  | |
 | +--------------+ |                      | +------------+ |
 +==================+                       +==================+
```

### 1.2 仿真层 vs 真机层

```
 仿真环境 (Gazebo Classic + ROS 2)
 +=========================================================+
 |  gazebo_node  (1个进程)                                 |
 |  /agv_1/robot_model  /agv_2/robot_model  ...          |
 |  /agv_1/odom         /agv_2/odom         ...          |
 |  差分驱动插件 + LiDAR 插件 + 里程计插件                 |
 +=========================================================+
        |                      DDS 同一主机 localhost
        v
 +=========================================================+
 |  AGV 单车节点（同上架构，HAL 连接 Gazebo 接口而非真机）   |
 +=========================================================+

 真机环境 (物理机器人 + 局域网)
 +=========================================================+
 |  物理 AGV                                             |
 |  - 差速轮底盘电机驱动器 (CAN/RS232)                     |
 |  - SICK TiM 系列 2D LiDAR (Ethernet)                  |
 |  - 硬件急停按钮 (GPIO 直连)                             |
 |  - 工控机运行 ROS 2 单车节点                            |
 +=========================================================+
        |                      DDS 分布式局域网
        v
 +=========================================================+
 |  Fleet Manager Server (工控机/服务器)                   |
 +=========================================================+
```

### 1.3 数据流与控制流

```
 ---> 数据流 (Data Flow)
 - - -> 控制流 (Control Flow)
 ===> 急停流 (Safety Flow, 最高优先级)

 WMS  --->  Fleet Manager  --->  Global Planner  --->  AGV Local Planner  --->  HAL  ---> 底盘
   (任务)       (分配)          (全局路径)             (局部轨迹)               (cmd_vel)

 LiDAR ---> Sensor Fusion ---> AMCL ---> Local Planner
           (scan)    (odom)         (pose)

 LiDAR ---> Safety Node ---> HAL (cmd_vel 限幅)
           ===> 双重碰撞检测
           ===> 硬件急停直连

 AGV State ---> Fleet Manager ---> Visualizer ---> Web Frontend
 (pose, task, battery)           (WebSocket)
```

---

## 2. 模块划分与职责定义

### 2.1 模块总表

| 编号 | 模块名称 | 进程类型 | 运行位置 | 关键依赖 |
|------|---------|---------|---------|---------|
| M1 | Fleet Manager Node | ROS 2 Node (独立进程) | 调度服务器 | 无(顶层) |
| M2 | Global Planner Node | ROS 2 Node (独立进程) | 调度服务器 | M1 |
| M3 | Visualizer Node | ROS 2 Node (独立进程) | 调度服务器 | M1, M4-N |
| M4 | AGV Local Planner Node | ROS 2 Node (单车) | AGV 工控机 | M2, M5 |
| M5 | Sensor Fusion Node (AMCL) | ROS 2 Node (单车) | AGV 工控机 | M7, M8 |
| M6 | Safety Node | ROS 2 Node (单车) | AGV 工控机 | M7, M10 |
| M7 | HAL Node (硬件抽象层) | ROS 2 Node (单车) | AGV 工控机 | M6 |
| M8 | LiDAR Driver Node | ROS 2 Node (单车) | AGV 工控机 | 硬件 |
| M9 | Motor Driver Node | ROS 2 Node (单车) | AGV 工控机 | M7 |
| M10 | HW E-Stop | 硬件直连 GPIO | AGV 底盘 | 硬件 |
| M11 | WMS API Handler | 内嵌于 M1 | 调度服务器 | M1 |
| M12 | Web Frontend | 独立 Web 进程 | 调度服务器 | M3 |

### 2.2 各模块详细定义

#### M1 — Fleet Manager Node

```
职责:
  - 接收 WMS 任务 (WebSocket + JSON)
  - 维护任务池，按优先级排序
  - 选择最优 AGV 分配任务
  - 追踪每个 AGV 的任务执行状态
  - 处理任务取消、暂停、重分配
  - 通信断连检测 (>2s 自动停车指令)

输入接口:
  1. WMS WebSocket: /ws/fleet/commands (JSON)
     - 任务创建: {cmd: "create_task", task_id, type, start, goal, priority, timeout}
     - 任务取消: {cmd: "cancel_task", task_id}
     - 任务查询: {cmd: "query_task", task_id}
  2. AGV 状态话题: /agv/{id}/status (agv_fleet_msgs/msg/AGVStatus, 10Hz)
  3. AGV 位姿话题: /agv/{id}/amcl_pose (geometry_msgs/PoseWithCovarianceStamped, 10Hz)

输出接口:
  1. WMS WebSocket: /ws/fleet/responses (JSON)
     - 任务确认: {status: "accepted", task_id, agv_id, est_time}
     - 任务完成: {status: "completed", task_id, agv_id, actual_time}
     - 任务失败: {status: "failed", task_id, reason}
  2. 全局路径请求 Action: /fleet/request_path (自定义 Action)
  3. AGV 任务指令 Action: /agv/{id}/execute_task (自定义 Action)
  4. AGV 急停指令 Topic: /agv/{id}/emergency_stop (std_msgs/Bool, 高 QoS)

内部逻辑:
  - 任务优先级队列: 高(紧急) > 中(正常) > 低(非紧急)
  - AGV 选择算法: 基于距离最近 + 任务队列最短 + 电量充足的加权评分
  - 死锁预防: 检测两两 AGV 路径交叉，触发重规划
  - 心跳检测: 如果 AGV status 超过 2s 未收到，发送急停
```

#### M2 — Global Planner Node

```
职责:
  - 加载仓库静态地图 (YAML + PNG/PGM)
  - 构建拓扑地图 (路点图)
  - 为每个任务计算 A* 全局路径
  - 多 AGV 路径冲突检测与协调
  - 路径平滑 (梯度下降或样条)

输入接口:
  1. 路径请求 Action: /fleet/request_path (agv_fleet_msgs/action/RequestPath)
     - 请求: {agv_id, start_pose, goal_pose, avoid_agv_ids[]}
     - 结果: {path[], estimated_time, waypoints[]}
  2. 地图加载: 启动时从文件加载 (YAML + PNG)

输出接口:
  1. 全局路径 Topic: /agv/{id}/global_plan (nav_msgs/Path, 事件驱动)
  2. 占用栅格 Topic: /map (nav_msgs/OccupancyGrid, 5Hz 刷新)

算法:
  - 主算法: A* (A-Star)
    - 启发函数: 欧几里得距离
    - 网格分辨率: 0.05m (5cm)
    - 最大搜索节点数: 50000
    - 目标: 延迟 < 200ms
  - 路径平滑: 梯度下降法，消除锯齿
  - 冲突检测: 时间窗法 (Time Window), 检测路径重叠段
```

#### M3 — Visualizer Node

```
职责:
  - 聚合所有 AGV 的状态信息
  - 通过 WebSocket 推送给 Web 前端
  - 提供 REST API 用于历史数据查询

输入接口:
  1. 所有 AGV 状态: /agv/{id}/status (10Hz)
  2. 所有 AGV 位姿: /agv/{id}/amcl_pose (10Hz)
  3. 所有 AGV 全局路径: /agv/{id}/global_plan (事件)
  4. 地图: /map (5Hz)

输出接口:
  1. WebSocket: /ws/monitor (JSON, 20Hz)
     - {agvs: [{id, x, y, theta, status, task_id, battery, path[]}], map_info}
  2. REST API: /api/v1/agvs, /api/v1/tasks, /api/v1/history
```

#### M4 — AGV Local Planner Node (每台 AGV 一个实例)

```
职责:
  - 接收全局路径并跟踪
  - DWA/TEB 局部避障
  - 发布速度指令到 HAL
  - 向 Fleet Manager 汇报状态

输入接口:
  1. 全局路径: /agv/{id}/global_plan (nav_msgs/Path)
  2. 任务指令 Action: /agv/{id}/execute_task
  3. 里程计: /agv/{id}/odom (nav_msgs/Odometry, 20Hz)
  4. AMCL 位姿: /agv/{id}/amcl_pose
  5. 激光扫描: /agv/{id}/scan (sensor_msgs/LaserScan, 15Hz)
  6. 代价地图: /agv/{id}/costmap (nav_msgs/OccupancyGrid)

输出接口:
  1. 速度指令: /agv/{id}/cmd_vel_raw (geometry_msgs/Twist, 20Hz)
  2. AGV 状态: /agv/{id}/status (agv_fleet_msgs/msg/AGVStatus, 10Hz)
  3. 局部规划轨迹: /agv/{id}/local_plan (nav_msgs/Path, 事件)

配置:
  - 规划频率: 20Hz (需求 >= 20Hz)
  - 前视距离: 1.5m (最大速度 x 反应时间)
  - DWA 参数:
    - 速度采样: 线速度 [0, 1.5], 角速度 [-1.0, 1.0]
    - 加速度采样: 线 [0, 0.5], 角 [0, 0.5]
    - 预测时间: 2.0s
    - 轨迹评分: 航向偏差(0.4) + 速度(0.2) + 障碍物距离(0.4)
```

#### M5 — Sensor Fusion Node (AMCL, 每台 AGV 一个实例)

```
职责:
  - 2D LiDAR 扫描 + 里程计数据融合
  - AMCL 自适应蒙特卡洛定位
  - 发布全局位姿估计

输入接口:
  1. 激光扫描: /agv/{id}/scan (15Hz)
  2. 里程计: /agv/{id}/odom (20Hz)
  3. 初始位姿: /agv/{id}/initialpose (事件, 启动时设置)

输出接口:
  1. AMCL 位姿: /agv/{id}/amcl_pose (geometry_msgs/PoseWithCovarianceStamped, 10Hz)
  2. 粒子分布: /agv/{id}/particlecloud (geometry_msgs/PoseArray, 5Hz)
  3. 变换: /tf (tf2_msgs/TFMessage, 20Hz)

AMCL 参数建议:
  - min_particles: 500
  - max_particles: 2000
  - update_min_d: 0.2 (米)
  - update_min_a: 0.2 (弧度)
  - resample_interval: 1
  - laser_likelihood_max_dist: 2.0m
  - laser_model_type: "likelihood_field"
  - laser_z_hit: 0.95
  - laser_z_rand: 0.05
  - odom_alpha1: 0.2
  - odom_alpha2: 0.2
  - odom_alpha3: 0.2
  - odom_alpha4: 0.2
```

#### M6 — Safety Node (每台 AGV 一个实例, 最高优先级)

```
职责:
  - 双层碰撞检测: LiDAR <0.5m 减速, <0.2m 急停
  - 虚拟安全区域检查 (货架区域、禁行区域)
  - 三层限幅约束
  - 硬件急停信号转发
  - 独立于其他节点运行，故障时保持安全状态

输入接口:
  1. 速度指令(原始): /agv/{id}/cmd_vel_raw (geometry_msgs/Twist, 20Hz)
  2. 激光扫描: /agv/{id}/scan (sensor_msgs/LaserScan, 15Hz)
  3. 硬件急停: GPIO 中断 (硬件直连)
  4. 远程急停: /agv/{id}/emergency_stop (std_msgs/Bool, 高 QoS)

输出接口:
  1. 安全速度指令: /agv/{id}/cmd_vel_safe (geometry_msgs/Twist, 20Hz)
  2. 急停状态: /agv/{id}/safety_status (agv_fleet_msgs/msg/SafetyStatus, 20Hz)
  3. 急停触发信号: 硬件继电器 (GPIO)

安全逻辑 (伪代码):
  if HW_EStop_Triggered:
      cmd_vel_safe = zero;  # 硬线切断
      return
  
  if remote_estop_received:
      cmd_vel_safe = zero;  # 软件急停
      return
  
  # 双层碰撞检测
  min_dist = min(laser_scan.ranges[valid])
  if min_dist < 0.2:
      cmd_vel_safe = zero;  # 急停
  elif min_dist < 0.5:
      cmd_vel_safe.linear.x *= (min_dist / 0.5);  # 线性减速
      cmd_vel_safe.angular.z *= (min_dist / 0.5);
  
  # 三层限幅
  cmd_vel_safe.linear.x = clamp(cmd_vel_safe.linear.x, -1.5, 1.5)
  cmd_vel_safe.angular.z = clamp(cmd_vel_safe.angular.z, -1.0, 1.0)
  # 加速度限幅
  accel = (cmd_vel_safe.linear.x - last_linear_x) / dt
  if abs(accel) > 0.5:
      cmd_vel_safe.linear.x = last_linear_x + sign(accel) * 0.5 * dt
  # 角加速度同理

优先级: Safety Node 的 cmd_vel_safe 是最终发给 HAL 的唯一速度指令源。
```

#### M7 — HAL Node (硬件抽象层, 每台 AGV 一个实例)

```
职责:
  - 抽象底层硬件接口 (电机、编码器、IO)
  - 仿真模式: 转发到 Gazebo 接口
  - 真机模式: 转发到 Motor Driver (CAN/RS232)
  - 提供统一的 ROS 2 接口

输入接口:
  1. 安全速度指令: /agv/{id}/cmd_vel_safe (geometry_msgs/Twist, 20Hz)

输出接口:
  1. 里程计: /agv/{id}/odom (nav_msgs/Odometry, 20Hz)
  2. 电机状态: /agv/{id}/motor_status (agv_fleet_msgs/msg/MotorStatus, 20Hz)

模式切换:
  - 环境变量: AGV_SIMULATION=true/false
  - 仿真: 内部启动 Gazebo 接口插件
  - 真机: 通过 Serial/CAN 通信物理电机驱动板

差速轮运动学:
  v = (v_right + v_left) / 2
  omega = (v_right - v_left) / wheel_base
  wheel_base = 0.5m (典型值)
```

#### M8 — LiDAR Driver Node

```
职责:
  - 驱动 SICK TiM 系列 2D LiDAR
  - 发布 LaserScan 消息
  - 参数配置 (扫描频率、范围、分辨率)

输入接口:
  1. 硬件: SICK TiM 系列 (Ethernet, SOPAS 协议)
  2. 配置参数: ROS 2 Parameter Server

输出接口:
  1. 激光扫描: /agv/{id}/scan (sensor_msgs/LaserScan, 15Hz)

配置参数:
  - 扫描频率: 15Hz
  - 角度范围: -135° ~ +135° (270°)
  - 角度分辨率: 0.33° (~810 点/帧)
  - 最大检测距离: 10m (室内)
  - 最小检测距离: 0.05m
```

#### M9 — Motor Driver Node

```
职责:
  - 接收 HAL 的电机指令
  - 驱动差速轮电机 (PID 控制)
  - 发布编码器数据 (里程计反馈)

输入接口:
  1. HAL 电机指令: 内部接口 (通过 HAL Node 封装)

输出接口:
  1. 编码器数据: 内部接口 -> HAL Node

硬件接口:
  - 仿真: Gazebo DiffDrivePlugin
  - 真机: CAN bus / RS232 -> 电机驱动器 (如 RoboMaster C620 / 自定义)
```

#### M10 — HW E-Stop (硬件)

```
职责:
  - 物理急停按钮 -> GPIO 中断 -> Safety Node
  - 硬件级直接切断电机电源 (继电器)
  - 独立于任何软件运行

设计:
  - 按钮类型: 双通道冗余, 常闭触点
  - 信号路径: 按钮 -> 硬件继电器 (直接切断电机电源)
  - 信号路径: 按钮 -> GPIO (通知 Safety Node 软件急停)
  - 恢复: 手动旋转复位 + 软件确认
```

#### M11 — WMS API Handler

```
职责:
  - 维护 WebSocket 连接 (作为 Server)
  - 解析 WMS 的 JSON 命令
  - 调用 Fleet Manager 的内部 API
  - 格式化响应并发送

技术:
  - 库: websocketpp (C++17) 或 fastapi-websocket (Python)
  - 端口: 8765
  - 协议: JSON over WebSocket
  - 心跳: 每 5s ping/pong
  - 断连检测: 10s 无消息视为断连
```

#### M12 — Web Frontend

```
职责:
  - 实时显示 AGV 位置 (2D 地图)
  - 显示任务执行状态
  - 显示路径规划
  - 手动控制 (可选)

技术:
  - 框架: React + TypeScript
  - 地图: Leaflet 或 Canvas 自定义渲染
  - 通信: WebSocket (连接 Visualizer Node)
  - 部署: Nginx 反向代理
```

---

## 3. ROS 2 话题/服务/动作接口定义

### 3.1 自定义消息定义

所有自定义消息放置在 `agv_fleet_msgs` 包中。

```cmake
# agv_fleet_msgs/msg/AGVStatus.msg
string agv_id
string task_id           # 当前任务 ID, 空表示空闲
uint8 status             # 0=空闲, 1=导航中, 2=装载, 3=卸载, 4=充电, 5=急停, 6=故障
float32 battery          # 电量百分比 0.0-100.0
float32 linear_velocity  # 当前线速度 m/s
float32 angular_velocity # 当前角速度 rad/s
builtin_interfaces/Time  timestamp
---
# agv_fleet_msgs/msg/SafetyStatus.msg
string agv_id
bool hw_estop_active     # 硬件急停触发
bool sw_estop_active     # 软件急停触发
bool collision_warning   # 碰撞预警 (0.5m 内)
float32 min_obstacle_dist # 最小障碍物距离 m
float32 cmd_linear_x     # 实际输出线速度
float32 cmd_angular_z    # 实际输出角速度
builtin_interfaces/Time  timestamp
---
# agv_fleet_msgs/msg/MotorStatus.msg
string agv_id
float32 left_wheel_rpm
float32 right_wheel_rpm
float32 left_wheel_current
float32 right_wheel_current
float32 battery_voltage
builtin_interfaces/Time  timestamp
---
# agv_fleet_msgs/action/RequestPath.action
# Goal
string agv_id
geometry_msgs/Pose2D start_pose
geometry_msgs/Pose2D goal_pose
string[] avoid_agv_ids
---
# Result
nav_msgs/Path path
float32 estimated_time    # 预估行驶时间 (秒)
float32 path_length       # 路径总长 (米)
---
# Feedback
float32 progress          # 0.0 - 1.0
---
# agv_fleet_msgs/action/ExecuteTask.action
# Goal
string task_id
string task_type          # "transport", "park", "charge"
geometry_msgs/Pose2D start_pose
geometry_msgs/Pose2D goal_pose
builtin_interfaces/Duration timeout
---
# Result
bool success
string message            # 成功/失败原因
builtin_interfaces/Duration actual_duration
---
# Feedback
string state              # "navigating", "loading", "unloading", "done"
float32 progress          # 0.0 - 1.0
```

### 3.2 核心话题 (Topic) 列表

| 话题名称 | 消息类型 | 发布者 | 订阅者 | 频率 | QoS |
|---------|---------|-------|-------|------|-----|
| `/agv/{id}/scan` | `sensor_msgs/LaserScan` | M8 LiDAR Driver | M4, M5, M6 | 15Hz | Sensor |
| `/agv/{id}/odom` | `nav_msgs/Odometry` | M7 HAL Node | M4, M5 | 20Hz | Reliable |
| `/agv/{id}/amcl_pose` | `geometry_msgs/PoseWithCovarianceStamped` | M5 AMCL | M1, M3, M4 | 10Hz | Reliable |
| `/agv/{id}/particlecloud` | `geometry_msgs/PoseArray` | M5 AMCL | M3 (调试) | 5Hz | BestEffort |
| `/agv/{id}/global_plan` | `nav_msgs/Path` | M2 Global Planner | M4 | 事件 | Reliable |
| `/agv/{id}/local_plan` | `nav_msgs/Path` | M4 Local Planner | M3 | 事件 | BestEffort |
| `/agv/{id}/cmd_vel_raw` | `geometry_msgs/Twist` | M4 Local Planner | M6 | 20Hz | Reliable |
| `/agv/{id}/cmd_vel_safe` | `geometry_msgs/Twist` | M6 Safety Node | M7 HAL | 20Hz | Reliable |
| `/agv/{id}/status` | `agv_fleet_msgs/AGVStatus` | M4 Local Planner | M1, M3 | 10Hz | Reliable |
| `/agv/{id}/safety_status` | `agv_fleet_msgs/SafetyStatus` | M6 Safety Node | M3 | 20Hz | Reliable |
| `/agv/{id}/motor_status` | `agv_fleet_msgs/MotorStatus` | M7 HAL | M3 | 20Hz | BestEffort |
| `/agv/{id}/emergency_stop` | `std_msgs/Bool` | M1 Fleet Manager | M6 | 事件 | SystemDefault |
| `/map` | `nav_msgs/OccupancyGrid` | M2 Global Planner | M5 | 5Hz | Reliable TransientLocal |
| `/agv/{id}/costmap` | `nav_msgs/OccupancyGrid` | M4 Local Planner | M4(内部) | 20Hz | Reliable |
| `/tf` | `tf2_msgs/TFMessage` | M5, M7 | 全局 | 20Hz | SystemDefault |
| `/tf_static` | `tf2_msgs/TFMessage` | M5 | 全局 | 静态 | TransientLocal |

### 3.3 核心服务 (Service) 列表

| 服务名称 | 服务类型 | 提供者 | 调用者 | 功能 |
|---------|---------|-------|-------|------|
| `/agv/{id}/set_initial_pose` | `Empty.srv` | M5 AMCL | 手动/自动 | 设置初始位姿 |
| `/fleet/get_available_agvs` | `agv_fleet_msgs/srv/GetAvailableAGVs` | M1 Fleet Manager | WMS API | 获取可用 AGV 列表 |
| `/fleet/get_task_status` | `agv_fleet_msgs/srv/GetTaskStatus` | M1 Fleet Manager | WMS API | 查询任务状态 |
| `/agv/{id}/pause_task` | `Empty.srv` | M4 Local Planner | M1 | 暂停当前任务 |
| `/agv/{id}/resume_task` | `Empty.srv` | M4 Local Planner | M1 | 恢复暂停任务 |
| `/fleet/get_map_info` | `agv_fleet_msgs/srv/GetMapInfo` | M2 Global Planner | M3 | 获取地图元信息 |

### 3.4 核心动作 (Action) 列表

| 动作名称 | 动作类型 | 提供者 | 调用者 | 功能 |
|---------|---------|-------|-------|------|
| `/fleet/request_path` | `agv_fleet_msgs/action/RequestPath` | M2 Global Planner | M1 | 请求全局路径规划 |
| `/agv/{id}/execute_task` | `agv_fleet_msgs/action/ExecuteTask` | M4 Local Planner | M1 | 下发并执行任务 |

---

## 4. 技术选型建议

### 4.1 全局路径规划算法

**推荐: A\* (A-Star) + 梯度下降平滑**

| 算法 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| **A\*** | 启发式搜索, 速度快, 最优性保证 (一致启发) | 网格粒度影响精度 | **主选: 标准矩形仓库** |
| Dijkstra | 保证最优, 不需要启发函数 | 搜索空间大, 速度慢 | 不推荐 (A* 是 Dijkstra 的超集) |
| Hybrid A* | 考虑车辆运动学, 平滑路径 | 计算复杂度高, >200ms | 不推荐 (差速轮可原地旋转) |
| RRT* | 概率完备, 高维空间有效 | 路径不平滑, 不稳定 | 不推荐 (仓库环境结构化) |

**A\* 配置建议:**
- 网格分辨率: 0.05m (匹配定位精度 ±5cm)
- 启发函数: 欧几里得距离 (对角距离更优, 可选八方向 Chebyshev)
- 开放节点数上限: 50000
- 8-方向邻域 (允许对角线移动)
- 路径后处理: 梯度下降平滑 (消除锯齿, 3-5 次迭代)

### 4.2 局部避障算法

**推荐: DWA (Dynamic Window Approach)**

| 算法 | 优点 | 缺点 | 适用场景 |
|-----|------|------|---------|
| **DWA** | 计算快 (<50ms), 直接输出速度, 考虑运动学约束 | 局部极小, 高速不稳定 | **主选: 差速轮, 低速室内** |
| TEB | 考虑时间最优, 平滑轨迹 | 计算量大, 参数多, 不稳定 | 备选 (更高精度需求时) |
| MPC | 精确轨迹跟踪, 考虑约束 | 计算量大, 调参复杂 | 不推荐 (<50ms 难以满足) |

**DWA 优于 TEB 的原因:**
1. 差速轮底盘运动学简单, DWA 完全够用
2. DWA 计算量小, 容易满足 <50ms 延迟
3. DWA 参数少, 调试成本低
4. AGV 速度低 (1.5m/s), TEB 的时间最优优势不显著

### 4.3 定位方案

**推荐: AMCL (Adaptive Monte Carlo Localization)**

参数建议见 M5 模块定义。

**备选方案:**
- Cartographer: 需要额外的回环检测, 计算量大, 对于已知地图仓库场景过剩
- ICP-based: 计算量大, 对初值敏感
- EKF: 只能局部定位, 无法全局重定位

**定位架构:**
```
Odometry (轮式里程计) ----+
                          +--> EKF (扩展卡尔曼滤波, 可选) --> AMCL --> 全局位姿
LiDAR Scan ---------------+
                             ↑
                          静态地图 (已知)
```

**关键配置:**
- 里程计更新频率: 20Hz (高频修正)
- LiDAR 更新频率: 15Hz (低频全局校正)
- AMCL 粒子数: 500-2000 (自适应)

### 4.4 DDS 供应商推荐

| 特性 | Fast DDS | Cyclone DDS |
|------|---------|-------------|
| ROS 2 默认 (Humble) | Yes (默认) | No |
| 性能 | 高吞吐, 低延迟 | 略低, 但稳定 |
| 分布式发现 | 默认 (需配置排除) | 默认 |
| 配置复杂度 | 中等 | 简单 |
| 安全性 (DDS-Security) | 支持 | 支持 |

**推荐: Fast DDS (ROS 2 Humble 默认)**

原因:
1. ROS 2 Humble 的默认 DDS, 开箱即用
2. 仿真阶段单机, 无需额外配置
3. 真机阶段通过 `FASTRPS_DEFAULT_PROFILES.xml` 配置 discovery

**仿真/真机 DDS 切换方案:**

```xml
<!-- fastdds_simulation.xml — 仿真单机配置 -->
<profiles>
  <transport_descriptors>
    <transport_descriptor>
      <transport_id>sim_transport</transport_id>
      <type>UDPv4</type>
      <interfaceWhiteList>
        <address>127.0.0.1</address>  <!-- 仅 localhost -->
      </interfaceWhiteList>
    </transport_descriptor>
  </transport_descriptors>
  <participant profile_name="sim_participant" is_default_profile="true">
    <rtps>
      <userTransports>
        <transport_id>sim_transport</transport_id>
      </userTransports>
      <useBuiltinTransports>false</useBuiltinTransports>
    </rtps>
  </participant>
</profiles>
```

```xml
<!-- fastdds_production.xml — 真机分布式配置 -->
<profiles>
  <participant profile_name="prod_participant" is_default_profile="true">
    <rtps>
      <!-- 默认 UDPv4 发现, 局域网广播 -->
      <builtin>
        <discovery_config>
          <discoveryProtocol>SIMPLE</discoveryProtocol>
        </discovery_config>
      </builtin>
    </rtps>
  </participant>
</profiles>
```

**环境变量切换:**
```bash
# 仿真
export FASTRPS_DEFAULT_PROFILES_FILE=config/fastdds_simulation.xml
export ROS_LOCALHOST_ONLY=1

# 真机
export FASTRPS_DEFAULT_PROFILES_FILE=config/fastdds_production.xml
export ROS_LOCALHOST_ONLY=0
```

---

## 5. 关键设计决策

### 5.1 硬件抽象层 (HAL) 设计方案

**设计模式: 策略模式 (Strategy Pattern)**

```
+------------------+
|   HAL Node       |  (ROS 2 Node)
|                  |
| +--------------+ |
| | cmd_vel_safe | |  <- /agv/{id}/cmd_vel_safe (输入)
| +------+-------+ |
|        |         |
| +------v-------+ |
| | HAL Interface| |  (纯虚接口类)
| +------+-------+ |
|        |         |
|  +-----+------+ |
|  | Simulation | |  (Gazebo 实现)
|  | Strategy   | |
|  +-----+------+ |
|        |         |
|  +-----+------+ |
|  | Real Robot | |  (真机实现)
|  | Strategy   | |
|  +-----+------+ |
|        |         |
| +------v-------+ |
| | odom, motor  | |  -> /agv/{id}/odom (输出)
| +--------------+ |
+------------------+
```

**C++ 接口定义:**

```cpp
// hal_interface.hpp
class HALInterface {
public:
    virtual ~HALInterface() = default;
    virtual void initialize() = 0;
    virtual void sendVelocity(float linear_x, float angular_z) = 0;
    virtual bool readOdometry(float& x, float& y, float& theta) = 0;
    virtual bool readMotorStatus(MotorStatus& status) = 0;
    virtual void emergencyStop() = 0;
    virtual void releaseEmergencyStop() = 0;
    virtual void shutdown() = 0;
};

// simulation_hal.hpp
class SimulationHAL : public HALInterface {
    // 通过 Gazebo 的 DiffDrivePlugin 接口
    // 通过 libgazebo_ros_diffdrive.so 通信
};

// real_robot_hal.hpp
class RealRobotHAL : public HALInterface {
    // 通过 CAN/RS232 接口通信电机驱动器
    // 通过 Ethernet 通信 LiDAR
};
```

**模式切换: 运行时选择**
```cpp
std::unique_ptr<HALInterface> createHAL() {
    bool simulation;
    rclcpp::Parameter sim_param;
    node->get_parameter("simulation", sim_param);
    simulation = sim_param.as_bool();
    
    if (simulation) {
        return std::make_unique<SimulationHAL>();
    } else {
        return std::make_unique<RealRobotHAL>();
    }
}
```

### 5.2 多 AGV 通信架构设计

**架构选择: 集中式调度 (Centralized Fleet Manager)**

```
                    +------------------+
                    |   Fleet Manager  |
                    |  (集中式调度器)   |
                    +--------+---------+
                             |
           +-----------------+-----------------+
           |                 |                 |
    +------v------+   +-----v------+   +------v------+
    |  AGV 1      |   |  AGV 2     |   |  AGV 3      |
    | (独立 Node)  |   | (独立 Node) |   | (独立 Node)  |
    +-------------+   +------------+   +-------------+
```

**理由:**
1. 全局信息完备: 集中式调度器知道所有 AGV 的位置和任务
2. 冲突解决简单: 路径冲突、资源冲突 (充电桩) 集中协调
3. 死锁预防: 全局视野下的时间窗分配
4. 一致性: 任务分配、状态追踪单一源头

**通信模式:**
- Fleet Manager -> AGV: Action (ExecuteTask)
- AGV -> Fleet Manager: Topic (status)
- Fleet Manager -> Global Planner: Action (RequestPath)

**冲突解决策略:**
1. **路径冲突检测**: 在 Global Planner 中, 对每对 AGV 路径进行时间窗分析
2. **优先级仲裁**: 紧急任务 AGV 优先级高, 另一 AGV 等待或重规划
3. **资源锁定**: 充电桩、装载站等资源通过 Fleet Manager 互斥分配

### 5.3 仿真到真机的迁移策略

**三阶段迁移策略:**

#### 阶段 1: Gazebo 纯仿真 (当前阶段)
```
- 所有节点运行在同一台机器
- DDS localhost-only
- HAL 使用 SimulationHAL -> Gazebo DiffDrivePlugin
- 验证: 路径规划, 多 AGV 调度, 避障, 安全机制
```

#### 阶段 2: 混合仿真 (半实物)
```
- Fleet Manager + Global Planner 运行在调度服务器
- 1-2 台 AGV 工控机运行单车节点
- DDS 局域网发现
- HAL 仍使用 SimulationHAL (但通过真实网络)
- 验证: 网络延迟、通信可靠性、DDS 发现
```

#### 阶段 3: 真机部署
```
- 所有节点切换到真机模式
- HAL 使用 RealRobotHAL
- 硬件急停接入
- LiDAR 驱动切换为 SICK TiM 驱动
- 现场标定: 里程计校准、AMCL 参数微调
```

**迁移检查清单:**
```
[ ] DDS 切换配置 (仿真: localhost / 真机: 分布式)
[ ] HAL 切换 (仿真: Gazebo / 真机: 物理电机)
[ ] LiDAR 驱动 (仿真: Gazebo 插件 / 真机: SICK TiM SDK)
[ ] 急停机制 (仿真: 模拟按钮 / 真机: 物理按钮 + 继电器)
[ ] 里程计校准 (仿真: 理想 / 真机: 需要标定)
[ ] 地图构建 (仿真: 从 Gazebo 导出 / 真机: SLAM 建图)
[ ] AMCL 参数调优 (粒子数、噪声参数)
[ ] 网络测试 (延迟、丢包、断连恢复)
```

### 5.4 安全机制在架构中的嵌入方式

**安全架构分层:**

```
+===================================================================+
|  层 1: 硬件安全层 (HW Safety Layer)                                |
|  - 双通道硬件急停按钮 (常闭触点)                                    |
|  - 硬件继电器直接切断电机电源                                       |
|  - 独立于任何软件运行                                              |
|  - 响应时间: <1ms (硬件级)                                        |
+===================================================================+
                              |
                              v (通知上层)
+===================================================================+
|  层 2: 软件安全层 (SW Safety Layer) — Safety Node                  |
|  - 双层碰撞检测: 0.5m 减速 / 0.2m 急停                             |
|  - 虚拟安全区域: 预定义禁行区, 进入即急停                           |
|  - 三层硬限幅: 线速度 1.5m/s, 角速度 1.0rad/s, 加速度 0.5m/s²    |
|  - 远程急停接收: Fleet Manager 指令                                |
|  - 独立于 Local Planner, 故障不影响安全                           |
|  - 响应时间: <50ms                                                |
+===================================================================+
                              |
                              v (cmd_vel_safe)
+===================================================================+
|  层 3: 通信安全层 (Communication Safety) — Fleet Manager           |
|  - AGV 心跳检测: 2s 无状态上报 -> 发送远程急停                     |
|  - WMS 心跳检测: 10s 无消息 -> 标记 WMS 断连                       |
|  - DDS 可靠性: RELIABLE QoS 关键话题                               |
+===================================================================+
                              |
                              v
+===================================================================+
|  层 4: 规划安全层 (Planning Safety) — Local Planner + Global       |
|  - 路径规划避障: DWA 内置障碍物规避                                |
|  - 全局路径碰撞避免: 时间窗冲突检测                                |
|  - 速度平滑: 加速度约束在 Local Planner 层                         |
|  - 响应时间: <200ms                                               |
+===================================================================+
```

**安全状态机:**

```
        +---------+
        | 正常行驶 | <------ 恢复 (手动确认)
        +----+----+
             |
    +--------+--------+
    |                 |
    v                 v
+-------+         +---------+
| 减速中 |         | 急停状态 |
|(0.5m)  |         |(<0.2m) |
+-------+         +----+----+
    |                 |
    v                 v
+-------+         +---------+
| 恢复加速|         | 故障锁定 | -- 需手动复位
+-------+         +---------+

状态转换:
  正常 -> 减速:   LiDAR min_dist < 0.5m
  减速 -> 正常:   LiDAR min_dist > 0.6m (滞回)
  正常 -> 急停:   LiDAR min_dist < 0.2m / HW EStop / 远程急停
  急停 -> 故障锁定: 自动 (不可自动恢复)
  故障锁定 -> 正常: 手动复位 (旋转急停按钮 + 软件确认)
```

**安全冗余设计:**
```
1. 硬件急停: 双通道, 常闭触点, 直接切断电机电源 (独立于软件)
2. 软件急停: Safety Node 检测 LiDAR 数据, 独立于 Local Planner
3. 通信断连: Fleet Manager 检测, 发送远程急停 (独立于单车)
4. 限幅器: Safety Node 执行, 即使 Local Planner 发非法指令也安全
```

**故障模式与恢复:**
```
| 故障场景 | 检测方式 | 安全响应 | 恢复方式 |
|---------|---------|---------|---------|
| LiDAR 故障 | 无 scan 数据 | Safety Node 触发急停 | 更换/重启 LiDAR |
| Local Planner 崩溃 | 无 cmd_vel_raw | Safety Node 输出零速度 | 重启 Local Planner |
| 通信断连 (>2s) | Fleet Manager 心跳 | 远程急停 | 网络恢复 + 手动确认 |
| 电机过流 | MotorStatus 检测 | 急停 | 检查电机/负载 |
| 定位丢失 | AMCL 协方差大 | 减速, 请求重定位 | 重定位成功 |
```

---

## 附录 A: ROS 2 包结构

```
agv_fleet_ws/src/
├── agv_fleet_msgs/           # 自定义消息/服务/动作
│   ├── msg/
│   │   ├── AGVStatus.msg
│   │   ├── SafetyStatus.msg
│   │   └── MotorStatus.msg
│   ├── srv/
│   │   ├── GetAvailableAGVs.srv
│   │   ├── GetTaskStatus.srv
│   │   └── GetMapInfo.srv
│   └── action/
│       ├── RequestPath.action
│       └── ExecuteTask.action
│
├── fleet_manager/            # M1 Fleet Manager (C++/Python)
│   ├── src/
│   │   ├── fleet_manager_node.cpp
│   │   ├── task_scheduler.cpp
│   │   ├── agv_selector.cpp
│   │   └── wms_api_handler.cpp
│   └── config/
│       └── fleet_params.yaml
│
├── global_planner/           # M2 Global Planner (C++)
│   ├── src/
│   │   ├── global_planner_node.cpp
│   │   ├── astar_planner.cpp
│   │   ├── path_smoother.cpp
│   │   └── collision_detector.cpp
│   └── maps/
│       └── warehouse.yaml
│
├── visualizer/               # M3 Visualizer Node (Python)
│   ├── src/
│   │   ├── visualizer_node.py
│   │   ├── websocket_server.py
│   │   └── rest_api.py
│   └── config/
│       └── visualizer_params.yaml
│
├── agv_local_planner/        # M4 Local Planner (C++)
│   ├── src/
│   │   ├── local_planner_node.cpp
│   │   ├── dwa_planner.cpp
│   │   └── costmap_generator.cpp
│   └── config/
│       └── dwa_params.yaml
│
├── agv_sensor_fusion/        # M5 Sensor Fusion (C++)
│   ├── src/
│   │   ├── sensor_fusion_node.cpp
│   │   └── amcl_wrapper.cpp
│   └── config/
│       └── amcl_params.yaml
│
├── agv_safety/               # M6 Safety Node (C++)
│   ├── src/
│   │   ├── safety_node.cpp
│   │   ├── collision_detector.cpp
│   │   ├── velocity_limiter.cpp
│   │   └── virtual_safety_zone.cpp
│   └── config/
│       └── safety_params.yaml
│
├── agv_hal/                  # M7 HAL Node (C++)
│   ├── src/
│   │   ├── hal_node.cpp
│   │   ├── hal_interface.hpp
│   │   ├── simulation_hal.cpp
│   │   └── real_robot_hal.cpp
│   └── config/
│       └── hal_params.yaml
│
├── agv_lidar_driver/         # M8 LiDAR Driver (C++)
│   ├── src/
│   │   └── sick_tim_driver.cpp
│   └── config/
│       └── lidar_params.yaml
│
├── agv_motor_driver/         # M9 Motor Driver (C++)
│   ├── src/
│   │   ├── motor_driver_node.cpp
│   │   └── pid_controller.cpp
│   └── config/
│       └── motor_params.yaml
│
├── agv_bringup/              # 启动文件
│   ├── launch/
│   │   ├── fleet_system.launch.py     # 集中调度层
│   │   ├── agv_single.launch.py       # 单车启动
│   │   ├── agv_simulation.launch.py   # 仿真启动
│   │   └── agv_real.launch.py         # 真机启动
│   └── config/
│       └── fastdds_simulation.xml
│
└── agv_gazebo/               # Gazebo 仿真环境
    ├── worlds/
    │   └── warehouse.world
    ├── models/
    │   ├── agv_diff_drive/
    │   └── shelves/
    └── launch/
        └── gazebo_simulation.launch.py
```

## 附录 B: 验收标准映射

| 验收指标 | 目标值 | 对应模块 | 测试方法 |
|---------|-------|---------|---------|
| 路径规划延迟 | <200ms | M2 Global Planner | 单次 A* 平均耗时 |
| 局部避障延迟 | <50ms | M4 Local Planner | DWA 单次迭代耗时 |
| 定位精度 | ±5cm | M5 Sensor Fusion | AMCL 输出 vs Ground Truth |
| 停靠精度 | ±3cm | M4 + M5 | 末端精度 |
| 急停响应 | <100ms | M6 Safety Node | LiDAR 障碍物出现到 cmd_vel=0 |
| 24h 可靠性 | 99.9% | 全系统 | 24h 连续运行无故障 |
| WMS 通信延迟 | <100ms | M11 WMS API | WebSocket 往返时间 |
