# 交通区域状态消息
# 由 traffic_manager 发布，local_planner 订阅

string zone_id                   # 区域唯一标识符

uint8 FREE=0
uint8 RESERVED=1
uint8 OCCUPIED=2

uint8 state                      # 区域状态
string holder_agv_id             # 占用/预留该区域的 AGV ID
builtin_interfaces/Time timestamp
