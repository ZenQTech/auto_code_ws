# 任务状态更新消息
# 由 task_dispatcher 发布，monitor_aggregator 订阅

string task_id                   # 任务 ID

uint8 PENDING=0
uint8 ASSIGNED=1
uint8 EN_ROUTE=2
uint8 EXECUTING=3
uint8 COMPLETED=4
uint8 FAILED=5
uint8 CANCELLED=6

uint8 status                     # 任务状态
string assigned_agv_id           # 分配的 AGV ID
float32 progress                 # 进度 0.0-1.0
string error_msg                 # 错误信息（仅在 FAILED 时有效）
builtin_interfaces/Time timestamp
