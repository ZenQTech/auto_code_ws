# 安全状态消息
# 由 safety_watchdog 发布，monitor_aggregator 订阅

bool estop_active                # 是否处于急停状态
uint8[] active_sources           # 当前激活的触发源列表
float32 min_obstacle_distance    # 最近障碍物距离 (m)
float32 current_speed            # 当前速度 (m/s)
float32 speed_limit              # 当前速度限制 (m/s)

# 安全等级
uint8 NORMAL=0
uint8 WARNING=1
uint8 DECELERATE=2
uint8 EMERGENCY_STOP=3

uint8 safety_level               # 当前安全等级
string trigger_reason            # 触发原因描述
builtin_interfaces/Time timestamp
