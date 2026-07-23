# 任务规格消息
# 用于任务请求和任务分配

string task_id                   # 任务唯一 ID

string TRANSPORT=transport
string CHARGE=charge
string PARK=park
string PATROL=patrol

string task_type                 # 任务类型
string priority                  # 优先级: LOW / NORMAL / HIGH / CRITICAL
geometry_msgs/Pose2D start_pose  # 起始位姿
geometry_msgs/Pose2D target_pose # 目标位姿
string payload_id                # 货物 ID（运输任务）
builtin_interfaces/Time deadline # 截止时间
builtin_interfaces/Time request_time # 请求时间
