# 急停指令消息
# 由 safety_watchdog 发布，vehicle_fsm 和 motion_controller 订阅

# 触发源枚举
uint8 LASER=0                   # LiDAR 检测到障碍物
uint8 COMM=1                    # 通信中断
uint8 LOCALIZATION=2            # 定位丢失
uint8 SPEED=3                   # 超速
uint8 BATTERY=4                 # 低电量
uint8 MANUAL=5                  # 人工触发
uint8 BUMPER=6                  # 安全触边触发
uint8 SAFETY_PLC=7              # 安全 PLC 触发

uint8 source                     # 急停触发源
string reason                    # 急停原因描述
builtin_interfaces/Time timestamp # 触发时间戳
