# 全车队状态聚合消息
# 由 fleet_state_manager 发布，monitor_aggregator 和 traffic_manager 订阅

agv_msgs/VehicleState[] vehicles # 所有 AGV 的状态列表
builtin_interfaces/Time timestamp # 聚合时间戳
