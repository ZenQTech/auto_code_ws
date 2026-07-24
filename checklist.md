# 架构设计文档 (spec.md)

## 1. 模块视图

系统采用三层架构，由前端可视化层、后端调度服务层、仿真环境层组成，通过RESTful API、WebSocket和ROS2 DDS进行通信。

- **前端可视化层 (Frontend)**
  - **职责**: 提供用户交互界面，包括地图渲染、AGV监控、任务管理、KPI展示、告警与紧急停止控制。
  - **模块**:
    - `AuthModule`：处理用户登录、Token管理（存储、刷新、携带）。
    - `MapModule`：基于Canvas/SVG渲染2D栅格地图，显示AGV、路径、目标点。
    - `MonitorModule`：AGV状态列表、任务状态面板、KPI看板。
    - `ControlModule`：任务下发、紧急停止、人工干预（暂停/取消/回滚）操作入口。
    - `AlertModule`：实时告警推送与展示，支持筛选。
    - `WebSocketClient`：与后端建立长连接，接收增量更新。
  - **接口**: 通过REST API获取初始数据，通过WebSocket接收实时增量更新。

- **后端调度服务层 (Backend)**
  - **职责**: 核心业务逻辑处理，包括AGV管理、任务调度、路径规划、状态维护、认证授权。
  - **模块**:
    - `GatewayModule` (API网关)：统一入口，进行JWT验证、请求路由、限流、参数校验。
    - `AuthModule`：用户认证（登录/登出）、Token签发与验证、角色权限管理（管理员、操作员、观察者）。
    - `AGVManager`：AGV注册/注销、状态维护（数据库）、健康监测。
    - `TaskManager`：任务接收、队列管理、优先级排序、生命周期管理（待执行->执行中->完成/失败）。
    - `SchedulerEngine`：核心调度算法引擎。
      - `LoadBalancer`：最少负载调度算法(含能力标签匹配)。
      - `ThreeStageRouter`：三级执行策略路由算法(规划、执行、校验)。
      - `DependencyResolver`：拓扑排序循环依赖检测。
    - `PathPlanner`：封装Navigation2全局路径规划器，计算最优路径。
    - `EmergencyStopManager`：处理紧急停止请求，下发指令，确认AGV状态，记录日志。
    - `InterventionManager`：提供人工干预API（暂停/取消/回滚），管理子进程与数据库事务。
    - `StateService`：聚合AGV、任务、告警状态，通过WebSocket进行增量推送。
    - `AlertEngine`：基于规则（如碰撞风险、通信超时）生成告警。
    - `DatabaseLayer`：基于SQLAlchemy + aiosqlite，封装数据访问，处理并发（WAL模式+异步队列+重试）。
  - **接口**: 对外提供RESTful API和WebSocket端点。对内通过ROS2 Topic/Service与仿真层交互。

- **仿真环境层 (Simulation)**
  - **职责**: 提供物理与传感器仿真环境，运行AGV模型。
  - **模块**:
    - `GazeboEnv`：包含工厂/仓库场景、障碍物、AGV模型（差速轮、激光雷达、IMU、里程计）。
    - `ROS2Bridge`: 包含ROS2 Nodes，负责接收后端指令（`/cmd_vel`），发布AGV状态（`/odom`， `/scan`），与Navigation2交互。
    - `Navigation2Stack`：包含`map_server`， `amcl`, `planner_server`, `controller_server`，实现全局与局部路径规划。
    - `NoiseSimulator`：模拟传感器噪声，测试系统鲁棒性。
  - **接口**: 通过ROS2 DDS与后端通信，接收`/emergency_stop`， `/nav_goal`等指令，发布`/agv_status`， `/tf`等主题。

### 2. 接口契约

| 接口类型 | 接口名称 | 方向 | 协议 | 数据格式 | 说明 |
| :