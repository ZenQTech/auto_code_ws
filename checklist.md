# 架构设计文档 (spec.md)

## 1. 模块视图

本系统采用分层架构，模块职责清晰，依赖关系明确，避免循环依赖。

```mermaid
graph TD
    subgraph "表现层 (Presentation)"
        WebUI[Web管理界面 (React)]
        API[RESTful API网关 (FastAPI)]
    end

    subgraph "调度层 (Scheduling)"
        TM[任务管理 (Task Manager)]
        DA[调度算法 (Dispatch Algorithm)]
        TD[任务依赖图 (Task DAG)]
    end

    subgraph "算法层 (Algorithm)"
        PP[路径规划 (Path Planner)]
        TMGR[交通管理 (Traffic Manager)]
        ALG[核心算法库]
    end

    subgraph "通信层 (Communication)"
        ROSC[ROS通信客户端 (ROS 2/Noetic)]
        SYS_MON[系统监控 (System Monitor)]
    end

    subgraph "数据层 (Data)"
        DB[数据库 (SQLite)]
        CFG[配置管理 (Config Manager)]
        LOG[日志系统 (Logging)]
    end

    subgraph "基础设施层 (Infrastructure)"
        SIM[仿真环境 (Gazebo Ignition)]
        AGV[AGV实体 (仿真模型)]
        SEC[安全防护 (Safety Guard)]
    end

    WebUI --> API
    API --> TM
    API --> SYS_MON
    TM --> DA
    TM --> TD
    DA --> PP
    DA --> TMGR
    PP --> ALG
    TMGR --> ALG
    TM --> ROSC
    PP --> ROSC
    TMGR --> ROSC
    ROSC --> AGV
    SYS_MON --> ROSC
    SYS_MON --> SEC
    TM --> DB
    SYS_MON --> DB
    CFG --> TM
    CFG --> PP
    CFG --> TMGR
    CFG --> SEC
    LOG --> TM
    LOG --> PP
    LOG --> TMGR
    LOG --> SYS_MON
    SEC --> AGV
    AGV --> SIM
```

### 模块职责

- **表现层**:
    - **Web管理界面**: 提供用户交互界面，实时展示AGV状态、任务进度、地图等。
    - **RESTful API网关**: 对外暴露任务提交、状态查询、系统配置等RESTful接口，处理认证授权（JWT）。
- **调度层**:
    - **任务管理**: 负责任务的接收、解析、状态跟踪和生命周期管理。
    - **调度算法**: 实现“最少负载调度算法”，负责任务到AGV的动态分配。
    - **任务依赖图**: 管理任务间的依赖关系，执行“拓扑排序循环依赖检测”，生成合法执行序列。
- **算法层**:
    - **路径规划**: 实现“三级执行策略路由算法”，包括全局规划(A*)、局部重规划(Dijkstra)和避障微调。
    - **交通管理**: 负责多AGV协同，包括路口协商、防碰撞、死锁检测与解除。
    - **核心算法库**: 封装A*、Dijkstra、图论检测等基础算法，供路径规划和交通管理模块复用。
- **通信层**:
    - **ROS通信客户端**: 封装与AGV（仿真模型）的ROS 2/Noetic通信，处理Topic/Service。
    - **系统监控**: 监控AGV心跳、系统资源、通信链路状态，触发告警或急停。
- **数据层**:
    - **数据库**: 使用SQLite持久化存储任务、AGV状态、日志等。
    - **配置管理**: 统一管理所有可配置参数（算法阈值、安全参数、网络配置等），支持动态加载。
    - **日志系统**: 提供统一的日志记录接口，支持不同级别和输出目标。
- **基础设施层**:
    - **仿真环境**: 封装Gazebo Ignition Garden仿真器管理。
    - **AGV实体**: 仿真中的AGV模型，实现运动学模型和传感器模拟。
    - **安全防护**: 独立于其他逻辑的安全监控模块，监控急停条件，直接向AGV发送停止指令。

## 2. 接口契约

### 模块间接口（部分关键接口）

| 接口名称 | 源模块 | 目标模块 | 协议/方式 | 数据格式 | 说明 |
| :