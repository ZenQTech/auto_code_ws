# 任务分配消息
# 由 central_scheduler 发布，各 AGV lifecycle 节点订阅

string task_id                   # 任务 ID
string assigned_agv_id           # 分配的 AGV ID
string task_type                 # 任务类型
geometry_msgs/Pose2D target_pose # 目标位姿
string[] waypoints               # 路径关键点（可选）
builtin_interfaces/Time assignment_time
builtin_interfaces/Time estimated_completion
