# AGV 状态消息（简化版，用于调度器）
# 由 fleet_state_manager 维护

string agv_id

string IDLE=idle
string BUSY=busy
string CHARGING=charging
string PARKED=parked
string EMERGENCY=emergency
string FAULT=fault

string status                    # 当前状态
geometry_msgs/Pose2D pose        # 当前位置
float32 battery_level            # 电量百分比 (0-100)
float32 linear_speed             # 当前线速度 (m/s)
float32 angular_speed            # 当前角速度 (rad/s)
string current_task_id           # 当前执行的任务 ID
builtin_interfaces/Time status_time
