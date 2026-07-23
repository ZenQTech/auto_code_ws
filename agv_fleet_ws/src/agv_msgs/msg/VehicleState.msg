# AGV 状态上报消息
# 由 vehicle_fsm 发布，fleet_state_manager 和 monitor_aggregator 订阅

string agv_id                    # AGV 唯一标识符

# 状态枚举
uint8 IDLE=0
uint8 NAVIGATING=1
uint8 CHARGING=2
uint8 ESTOP=3
uint8 FAILED=4
uint8 DOCKING=5
uint8 PATROLLING=6

uint8 state                      # 当前状态

geometry_msgs/Pose pose          # 当前位姿
float32 battery                  # 电量百分比 (0-100)
float32 speed                    # 当前速度 (m/s)
string current_task_id           # 当前执行的任务 ID（空表示空闲）
builtin_interfaces/Time timestamp # 状态时间戳
