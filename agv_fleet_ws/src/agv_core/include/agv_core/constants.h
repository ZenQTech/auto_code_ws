/**
 * @file constants.h
 * @brief System-wide constants and configuration defaults
 */

#ifndef AGV_CORE__CONSTANTS_H_
#define AGV_CORE__CONSTANTS_H_

#include <string>

namespace agv_core
{
namespace constants
{

// ============================================================================
// ROS2 Naming
// ============================================================================

/// Namespace prefixes
constexpr char FLEET_NS[] = "/fleet";
constexpr char AGV_NS_PREFIX[] = "/agv_";

/// Topic names
constexpr char TOPIC_SCAN[] = "scan";
constexpr char TOPIC_IMU[] = "imu";
constexpr char TOPIC_ODOM[] = "odom";
constexpr char TOPIC_ODOM_FILTERED[] = "odom_filtered";
constexpr char TOPIC_CMD_VEL[] = "cmd_vel";
constexpr char TOPIC_CMD_VEL_LIMITED[] = "cmd_vel_limited";
constexpr char TOPIC_GLOBAL_PATH[] = "global_path";
constexpr char TOPIC_LOCAL_PATH[] = "local_path";
constexpr char TOPIC_LOCALIZATION_POSE[] = "localization/pose";
constexpr char TOPIC_VEHICLE_STATE[] = "vehicle_state";
constexpr char TOPIC_BATTERY[] = "battery";
constexpr char TOPIC_OBSTACLE_MAP[] = "obstacle_map";
constexpr char TOPIC_SAFETY_ESTOP[] = "safety/estop";
constexpr char TOPIC_SAFETY_STATUS[] = "safety/status";
constexpr char TOPIC_SAFETY_BUMPER[] = "safety/bumper";
constexpr char TOPIC_SAFETY_SCAN_FILTERED[] = "safety/scan_filtered";
constexpr char TOPIC_FLEET_AGV_STATES[] = "agv_states";
constexpr char TOPIC_FLEET_TRAFFIC_ZONES[] = "traffic_zones";
constexpr char TOPIC_FLEET_GLOBAL_MAP[] = "global_map";
constexpr char TOPIC_FLEET_TASK_UPDATES[] = "task_updates";
constexpr char TOPIC_FLEET_METRICS[] = "monitor/metrics";
constexpr char TOPIC_JOINT_STATES[] = "joint_states";

/// Service names
constexpr char SRV_DISPATCH_TASK[] = "dispatch_task";
constexpr char SRV_CANCEL_TASK[] = "cancel_task";
constexpr char SRV_QUERY_TASK[] = "query_task";
constexpr char SRV_QUERY_AGV[] = "query_agv";
constexpr char SRV_QUERY_FLEET[] = "query_fleet";
constexpr char SRV_PLAN_PATH[] = "plan_path";
constexpr char SRV_GET_MAP[] = "get_map";
constexpr char SRV_UPDATE_MAP[] = "update_map";
constexpr char SRV_RESERVE_ZONE[] = "reserve_zone";
constexpr char SRV_RELEASE_ZONE[] = "release_zone";
constexpr char SRV_DETECT_DEADLOCK[] = "detect_deadlock";
constexpr char SRV_RESOLVE_DEADLOCK[] = "resolve_deadlock";
constexpr char SRV_SET_GOAL[] = "set_goal";
constexpr char SRV_PAUSE_RESUME[] = "pause_resume";
constexpr char SRV_MANUAL_ESTOP[] = "manual_estop";
constexpr char SRV_CLEAR_ESTOP[] = "clear_estop";
constexpr char SRV_RECOVER_LOCALIZATION[] = "recover_localization";
constexpr char SRV_SCHEDULER_CONFIG[] = "set_scheduler_config";
constexpr char SRV_SAFETY_PARAMS[] = "set_safety_params";
constexpr char SRV_SET_SPEED_LIMIT[] = "set_speed_limit";

/// Action names
constexpr char ACT_EXECUTE_TASK[] = "execute_task";
constexpr char ACT_NAVIGATE[] = "navigate";
constexpr char ACT_CHARGE[] = "charge";
constexpr char ACT_DOCK[] = "dock";
constexpr char ACT_PATROL[] = "patrol";

/// Node names
constexpr char NODE_TASK_DISPATCHER[] = "task_dispatcher";
constexpr char NODE_FLEET_STATE_MANAGER[] = "fleet_state_manager";
constexpr char NODE_GLOBAL_PLANNER[] = "global_planner";
constexpr char NODE_MAP_SERVICE[] = "map_service";
constexpr char NODE_TRAFFIC_MANAGER[] = "traffic_manager";
constexpr char NODE_API_GATEWAY[] = "api_gateway";
constexpr char NODE_MONITOR_AGGREGATOR[] = "monitor_aggregator";
constexpr char NODE_SAFETY_MONITOR[] = "safety_monitor";
constexpr char NODE_VEHICLE_FSM[] = "vehicle_fsm";
constexpr char NODE_LOCAL_PLANNER[] = "local_planner";
constexpr char NODE_OBSTACLE_AVOIDANCE[] = "obstacle_avoidance";
constexpr char NODE_LOCALIZATION[] = "localization";
constexpr char NODE_MOTION_CONTROLLER[] = "motion_controller";
constexpr char NODE_SAFETY_WATCHDOG[] = "safety_watchdog";
constexpr char NODE_GAZEBO_BRIDGE[] = "gazebo_bridge";

/// Coordinate frames (REP 105)
constexpr char FRAME_MAP[] = "map";
constexpr char FRAME_ODOM[] = "odom";
constexpr char FRAME_BASE_FOOTPRINT[] = "base_footprint";
constexpr char FRAME_BASE_LINK[] = "base_link";
constexpr char FRAME_LASER[] = "base_laser";

// ============================================================================
// QoS Configuration
// ============================================================================

/// QoS history depths
constexpr int QOS_SENSOR_DEPTH = 10;
constexpr int QOS_CONTROL_DEPTH = 1;
constexpr int QOS_STATE_DEPTH = 10;
constexpr int QOS_SAFETY_DEPTH = 5;

// ============================================================================
// Scheduling
// ============================================================================

/// Default scheduling strategy
constexpr char DEFAULT_SCHEDULING_STRATEGY[] = "auction";

/// Task assignment deviation limit
constexpr float SCHEDULING_FAIRNESS_MAX_DEVIATION = 0.2f;

}  // namespace constants
}  // namespace agv_core

#endif  // AGV_CORE__CONSTANTS_H_
