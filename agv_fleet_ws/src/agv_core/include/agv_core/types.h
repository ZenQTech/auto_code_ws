/**
 * @file types.h
 * @brief Core data type definitions for the AGV fleet system
 *
 * Contains all non-ROS primitive data types, enums, and configuration
 * structures used across the system.
 */

#ifndef AGV_CORE__TYPES_H_
#define AGV_CORE__TYPES_H_

#include <cstdint>
#include <string>
#include <chrono>
#include <array>

namespace agv_core
{

// ============================================================================
// Enums
// ============================================================================

/// AGV operational states
enum class AgvState : uint8_t
{
  IDLE = 0,
  NAVIGATING = 1,
  CHARGING = 2,
  ESTOP = 3,
  FAILED = 4,
  DOCKING = 5,
  PATROLLING = 6,
};

/// Task states
enum class TaskState : uint8_t
{
  PENDING = 0,
  ASSIGNED = 1,
  EN_ROUTE = 2,
  EXECUTING = 3,
  COMPLETED = 4,
  FAILED = 5,
  CANCELLED = 6,
};

/// Task priority levels
enum class TaskPriority : uint8_t
{
  LOW = 0,
  NORMAL = 1,
  HIGH = 2,
  CRITICAL = 3,
};

/// Emergency stop trigger sources
enum class EstopSource : uint8_t
{
  LASER = 0,
  COMM = 1,
  LOCALIZATION = 2,
  SPEED = 3,
  BATTERY = 4,
  MANUAL = 5,
  BUMPER = 6,
  SAFETY_PLC = 7,
};

/// Safety levels
enum class SafetyLevel : uint8_t
{
  NORMAL = 0,
  WARNING = 1,
  DECELERATE = 2,
  EMERGENCY_STOP = 3,
};

/// Traffic zone states
enum class ZoneState : uint8_t
{
  FREE = 0,
  RESERVED = 1,
  OCCUPIED = 2,
};

/// Deadlock types
enum class DeadlockType : uint8_t
{
  HEAD_ON = 0,
  CROSS = 1,
  CYCLE_WAIT = 2,
};

/// Deadlock resolution strategies
enum class ResolutionStrategy : uint8_t
{
  BACK_OFF = 0,
  RE_ROUTE = 1,
  PRIORITY_PASS = 2,
};

// ============================================================================
// Constants
// ============================================================================

namespace constants
{

/// Safety distances (meters)
constexpr float SAFETY_DISTANCE_FRONT = 0.8f;
constexpr float SAFETY_DISTANCE_SIDE = 0.3f;
constexpr float SAFETY_DISTANCE_REAR = 0.3f;
constexpr float DECELERATION_DISTANCE = 0.5f;  // beyond safety zone

/// Speed limits (m/s)
constexpr float MAX_SPEED_NORMAL = 1.5f;
constexpr float MAX_SPEED_TURN = 0.5f;
constexpr float MAX_SPEED_LOADING = 0.3f;
constexpr float MAX_SPEED_CHARGING = 0.3f;
constexpr float MAX_SPEED_DECELERATE = 0.3f;
constexpr float OVERSPEED_THRESHOLD = 1.8f;  // 120% of max

/// Timing thresholds (milliseconds)
constexpr int64_t CONTROL_LOOP_PERIOD_MS = 10;     // 100Hz
constexpr int64_t ESTOP_RESPONSE_MAX_MS = 10;
constexpr int64_t OBSTACLE_RESPONSE_MAX_MS = 50;
constexpr int64_t COMM_TIMEOUT_MS = 100;
constexpr int64_t HEARTBEAT_PERIOD_MS = 100;        // 10Hz
constexpr int64_t FLEET_STATE_UPDATE_MS = 100;      // 10Hz
constexpr int64_t SCHEDULER_RESPONSE_MAX_MS = 500;

/// Battery thresholds (percentage)
constexpr float BATTERY_ESTOP_THRESHOLD = 5.0f;
constexpr float BATTERY_CHARGE_THRESHOLD = 20.0f;

/// Localization
constexpr float LOCALIZATION_JUMP_THRESHOLD_M = 0.5f;
constexpr float LOCALIZATION_ACCURACY_STATIC_CM = 3.0f;
constexpr float LOCALIZATION_ACCURACY_DYNAMIC_CM = 5.0f;

/// AGV physical parameters
constexpr float AGV_LENGTH_MM = 800.0f;
constexpr float AGV_WIDTH_MM = 600.0f;
constexpr float AGV_HEIGHT_MM = 300.0f;
constexpr float AGV_WHEEL_BASE_MM = 500.0f;
constexpr float AGV_WHEEL_RADIUS_MM = 100.0f;
constexpr float AGV_MAX_PAYLOAD_KG = 500.0f;

/// Fleet
constexpr uint8_t MAX_AGV_COUNT = 20;
constexpr uint8_t DEFAULT_AGV_COUNT = 5;

/// Warehouse
constexpr float WAREHOUSE_LENGTH_M = 25.0f;
constexpr float WAREHOUSE_WIDTH_M = 20.0f;
constexpr float MAIN_CORRIDOR_WIDTH_M = 3.0f;
constexpr float SECONDARY_CORRIDOR_WIDTH_M = 2.0f;

/// System
constexpr float AVAILABILITY_TARGET = 0.999f;  // 99.9%
constexpr float TASK_COMPLETION_RATE_TARGET = 0.98f;

}  // namespace constants

// ============================================================================
// Structures
// ============================================================================

/// 2D pose with timestamp
struct Pose2DStamped
{
  double x = 0.0;
  double y = 0.0;
  double theta = 0.0;
  std::chrono::system_clock::time_point stamp;
};

/// AGV state snapshot (for internal use)
struct AgvStateSnapshot
{
  std::string agv_id;
  AgvState state = AgvState::IDLE;
  Pose2DStamped pose;
  float battery = 100.0f;
  float speed = 0.0f;
  std::string current_task_id;
};

/// Task descriptor
struct TaskDescriptor
{
  std::string task_id;
  std::string task_type;  // transport, charge, park, patrol
  TaskPriority priority = TaskPriority::NORMAL;
  Pose2DStamped start_pose;
  Pose2DStamped target_pose;
  std::string payload_id;
  std::chrono::system_clock::time_point deadline;
  std::chrono::system_clock::time_point request_time;
};

/// Task assignment record
struct TaskAssignment
{
  std::string task_id;
  std::string assigned_agv_id;
  TaskState state = TaskState::PENDING;
  float progress = 0.0f;
  std::chrono::system_clock::time_point assignment_time;
};

/// Safety event record
struct SafetyEvent
{
  EstopSource source;
  std::string reason;
  SafetyLevel level;
  std::chrono::system_clock::time_point timestamp;
  bool estop_active = false;
};

/// Traffic zone reservation
struct ZoneReservation
{
  std::string zone_id;
  std::string holder_agv_id;
  ZoneState state = ZoneState::FREE;
  std::chrono::system_clock::time_point grant_time;
  std::chrono::milliseconds max_hold_duration{5000};
};

/// System performance metrics
struct SystemMetrics
{
  float task_completion_rate = 1.0f;
  float avg_wait_time_s = 0.0f;
  uint32_t collision_count = 0;
  uint32_t active_agvs = 0;
  float avg_scheduler_load = 0.0f;
  float realtime_factor = 1.0f;
};

}  // namespace agv_core

#endif  // AGV_CORE__TYPES_H_
