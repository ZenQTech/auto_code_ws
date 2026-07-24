# 架构设计文档 (spec.md)

## 1. 模块视图

系统采用分层架构，共分为五个核心模块，各模块职责清晰，接口明确。

```mermaid
graph TD
    subgraph 表现层 [表现层]
        WebUI[Web管理界面 (React)]
    end

    subgraph 调度层 [调度层]
        TaskMgr[任务管理器]
        Scheduler[调度器 (最少负载算法)]
        TrafficMgr[交通管理器]
    end

    subgraph 算法层 [算法层]
        PathPlanner[路径规划器 (三级路由算法)]
        DepChecker[依赖检测器 (拓扑排序)]
    end

    subgraph 通信层 [通信层]
        CommsMgr[通信管理器 (ROS 2 Topic/Service)]
    end

    subgraph 数据层 [数据层]
        DB[SQLite 持久化存储]
        ConfigMgr[配置管理器]
    end

    subgraph 安全与监控 [安全与监控]
        SafetyMgr[安全监控器]
        Monitor[系统监控器]
        HealthCheck[环境健康检查器]
    end

    WebUI -->|REST API| Scheduler;
    WebUI -->|REST API| TaskMgr;
    WebUI -->|REST API| Monitor;

    TaskMgr -->|任务分配请求| Scheduler;
    Scheduler -->|路径规划请求| PathPlanner;
    Scheduler -->|依赖检测请求| DepChecker;
    Scheduler -->|交通控制指令| TrafficMgr;
    Scheduler -->|状态更新| Monitor;

    PathPlanner -->|规划结果| Scheduler;
    DepChecker -->|检测结果| TaskMgr;

    TrafficMgr -->|AGV 指令| CommsMgr;
    SafetyMgr -->|急停/减速指令| CommsMgr;
    CommsMgr -->|AGV 状态/传感器数据| SafetyMgr;

    CommsMgr -->|AGV 状态| Monitor;
    SafetyMgr -->|告警/事件| Monitor;

    TaskMgr -->|读写| DB;
    Scheduler -->|读写| DB;
    Monitor -->|读写| DB;
    PathPlanner -->|读取地图| DB;
    ConfigMgr -->|提供配置| SafetyMgr, PathPlanner, Scheduler, TaskMgr;

    HealthCheck -->|环境依赖检查结果| Monitor;
```

### 模块职责
- **表现层**: 提供Web管理界面，用于任务管理、系统监控和配置。
- **调度层**: 核心调度逻辑，包括任务管理、任务分配（最少负载算法）、交通管理（死锁/冲突检测与解除）。
- **算法层**: 封装核心算法，包括路径规划（三级执行策略路由算法）和任务依赖检测（拓扑排序）。
- **通信层**: 负责与AGV仿真模型进行ROS 2通信，接收状态、下发指令。
- **数据层**: 负责数据持久化（SQLite）和系统配置管理。
- **安全与监控**: 负责安全红线（急停、防碰撞、边界保护）、系统状态监控、日志记录和外部依赖健康检查。

## 2. 接口契约

### 2.1 表现层 <-> 调度层 (RESTful API)
- **协议**: HTTP/HTTPS
- **认证**: JWT Token
- **数据格式**: JSON
- **端点示例**:
  - `POST /api/v1/tasks`: 提交新任务 (JSON: `{task_id, start, end, priority, dependencies, ...}`)
  - `GET /api/v1/tasks/{task_id}`: 查询任务状态
  - `GET /api/v1/agvs/`: 获取所有AGV状态
  - `POST /api/v1/agvs/scale`: 动态扩展AGV数量

### 2.2 调度层 <-> 算法层 (内部函数调用)
- **路径规划接口**:
  - `plan_path(agv_id, start, end, static_map, dynamic_obstacles) -> {path: List[Point], cost: float}`
- **依赖检测接口**:
  - `check_dag(dependency_graph) -> {is_cyclic: bool, execution_order: List[str]}`

### 2.3 调度层 <-> 通信层 (内部函数调用)
- **发送指令**:
  - `send_command(agv_id, command_type, params) -> bool`
    - `command_type`: `MOVE_TO(x, y, theta)`, `STOP`, `EMERGENCY_STOP`, `RESUME`
- **接收状态**:
  - `get_agv_state(agv_id) -> {position, velocity, battery, task_queue, status, ...}`

### 2.4 安全监控器 <-> 通信层 (内部函数调用)
- **安全指令**:
  - `send_emergency_stop(agv_id) -> bool`
  - `send_slow_down(agv_id, target_speed) -> bool`

### 2.5 通信层 <-> AGV (ROS 2 Topic/Service)
- **协议**: ROS 2 (基于 DDS)
- **Topic**:
  - `/agv_{id}/state` (发布者: AGV, 消息类型: `custom_msgs/AGVState`)
  - `/agv_{id}/cmd_vel` (订阅者: AGV, 消息类型: `geometry_msgs/Twist`)
- **Service**:
  - `/agv_{id}/emergency_stop` (客户端: 调度中心, 服务类型: `std_srvs/Trigger`)
- **心跳**: 通过 `/agv_{id}/heartbeat` Topic 维持，频率 >= 10Hz。

## 3. 安全与性能基线

### 3.1 安全红线
- **防碰撞**: AGV间距离 < 0.3m 减速，< 0.1m 急停。
- **通信故障**: 连续500ms未收到心跳，触发急停。
- **边界保护**: AGV位置超出多边形工作区域，触发急停并记录日志。
- **速度限制**: 线速度 ≤ 1.0 m/s，角速度 ≤ 0.5 rad/s。
- **API安全**: 所有对外API需JWT认证，进行输入校验，防止注入。
- **降级运行**: 核心算法失败时，回退至轮询调度并告警。

### 3.2 性能基线
- **调度响应时间**: ≤ 1.0秒 (3台AGV, 10个任务并发)。
- **全局路径规划**: ≤ 0.5秒。
- **局部重规划**: ≤ 0.2秒。
- **系统吞吐量**: 支持≥50个待分配任务，调度延迟≤2秒。
- **并发扩展**: 5台AGV同时运行，调度响应时间≤2.0秒。
- **状态更新频率**: ≥ 10Hz。

## 4. 技术选型

| 类别 | 技术 | 版本 | 说明 |
|