# 系统运行指标消息
# 由 monitor_aggregator 发布，可视化前端订阅

float32 task_completion_rate     # 任务完成率 (0.0-1.0)
float32 avg_wait_time            # 平均等待时间 (s)
uint32 collision_count           # 碰撞次数
uint32 active_agvs               # 活跃 AGV 数量
float32 avg_scheduler_load       # 平均调度负载
float32 realtime_factor          # 仿真实时因子
builtin_interfaces/Time timestamp
