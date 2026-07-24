# 架构设计文档 (spec.md)

## 1. 模块视图
系统采用分层架构，分为表现层、调度层、算法层、通信层、数据层，职责清晰，单向依赖。

```mermaid
graph TD
    subgraph "表现层 (Presentation Layer)"
        WebUI[Web 管理界面 (React)]
        API[RESTful API (FastAPI)]
    end

    subgraph "调度层 (Scheduling Layer)"
        TMS[任务管理与调度模块]
        TM[交通管理模块]
        SM[状态监控模块]
    end

    subgraph "算法层 (Algorithm Layer)"
        RP[路径规划模块]
        TA[任务分配与负载均衡模块]
        TD[任务依赖检测模块 (拓扑排序)]
        DC[死锁检测与解除模块]
    end

    subgraph "通信层 (Communication Layer)"
        ROS_Bridge[ROS 2 通信桥接]
        Agent_Comm[AGV 通信代理]
    end

    subgraph "数据层 (Data Layer)"
        DB[SQLite 数据库]
        File_Store[配置文件 / 任务文件]
        Log_Store[日志存储]
    end

    subgraph "外部系统"
        AGV[AGV 仿真体 (Gazebo Ignition)]
        User[用户 / 第三方系统]
    end

    WebUI --> API
    API --> TMS
    API --> SM
    TMS --> TA
    TMS --> TD
    TMS --> TM
    TM --> RP
    TM --> DC
    SM --> ROS_Bridge
    TA --> SM
    RP --> ROS_Bridge
    TM --> ROS_Bridge
    TMS --> DB
    SM --> DB
    Log_Store --> DB
    File_Store --> TMS
    ROS_Bridge --> Agent_Comm
    Agent_Comm --> AGV
    User --> API
```

## 2. 接口契约
| 调用方 | 提供方 | 接口描述 | 数据格式 / 协议 | 通信方式 | 备注 |
| :