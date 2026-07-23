/**
 * @file utils.h
 * @brief Utility functions for the AGV fleet system
 */

#ifndef AGV_CORE__UTILS_H_
#define AGV_CORE__UTILS_H_

#include <string>
#include <cmath>
#include <chrono>
#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/pose.hpp>
#include <geometry_msgs/msg/pose2_d.hpp>

namespace agv_core
{
namespace utils
{

// ============================================================================
// String utilities
// ============================================================================

/// Build a fully qualified topic name for an AGV
/// Example: build_agv_topic("agv_01", "scan") -> "/agv_01/scan"
inline std::string build_agv_topic(const std::string & agv_id,
                                   const std::string & topic)
{
  return "/" + agv_id + "/" + topic;
}

/// Build a fully qualified fleet topic name
inline std::string build_fleet_topic(const std::string & topic)
{
  return "/fleet/" + topic;
}

/// Build a fully qualified service name for an AGV
inline std::string build_agv_service(const std::string & agv_id,
                                     const std::string & service)
{
  return "/" + agv_id + "/" + service;
}

/// Build a fully qualified fleet service name
inline std::string build_fleet_service(const std::string & service)
{
  return "/fleet/" + service;
}

/// Build a fully qualified action name for an AGV
inline std::string build_agv_action(const std::string & agv_id,
                                    const std::string & action)
{
  return "/" + agv_id + "/" + action;
}

/// Build a fully qualified fleet action name
inline std::string build_fleet_action(const std::string & action)
{
  return "/fleet/" + action;
}

// ============================================================================
// Math utilities
// ============================================================================

/// Calculate Euclidean distance between two 2D points
inline double distance_2d(double x1, double y1, double x2, double y2)
{
  return std::sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
}

/// Calculate distance between two Pose2D
inline double distance_pose2d(const geometry_msgs::msg::Pose2D & a,
                              const geometry_msgs::msg::Pose2D & b)
{
  return distance_2d(a.x, a.y, b.x, b.y);
}

/// Calculate distance between two Pose (using position only)
inline double distance_pose(const geometry_msgs::msg::Pose & a,
                            const geometry_msgs::msg::Pose & b)
{
  return distance_2d(
    a.position.x, a.position.y,
    b.position.x, b.position.y
  );
}

/// Clamp a value between min and max
template<typename T>
inline T clamp(T value, T min_val, T max_val)
{
  if (value < min_val) return min_val;
  if (value > max_val) return max_val;
  return value;
}

/// Linear interpolation
template<typename T>
inline T lerp(T a, T b, double t)
{
  return a + (b - a) * t;
}

/// Convert degrees to radians
inline double deg_to_rad(double deg)
{
  return deg * M_PI / 180.0;
}

/// Convert radians to degrees
inline double rad_to_deg(double rad)
{
  return rad * 180.0 / M_PI;
}

/// Normalize angle to [-PI, PI]
inline double normalize_angle(double angle)
{
  while (angle > M_PI) angle -= 2.0 * M_PI;
  while (angle < -M_PI) angle += 2.0 * M_PI;
  return angle;
}

/// Angular difference between two angles
inline double angle_diff(double a, double b)
{
  return normalize_angle(a - b);
}

// ============================================================================
// Time utilities
// ============================================================================

/// Get current time as milliseconds since epoch
inline int64_t now_ms()
{
  return std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::system_clock::now().time_since_epoch()
  ).count();
}

/// Convert ROS2 Time to milliseconds
inline int64_t ros_time_to_ms(const rclcpp::Time & t)
{
  return static_cast<int64_t>(t.nanoseconds() / 1'000'000);
}

/// Check if a duration has elapsed since a given time
inline bool has_elapsed(int64_t since_ms, int64_t duration_ms)
{
  return (now_ms() - since_ms) >= duration_ms;
}

// ============================================================================
// AGV naming
// ============================================================================

/// Generate AGV ID from index (e.g., 1 -> "agv_01")
inline std::string agv_id_from_index(int index)
{
  char buf[16];
  std::snprintf(buf, sizeof(buf), "agv_%02d", index);
  return std::string(buf);
}

/// Extract index from AGV ID
inline int index_from_agv_id(const std::string & agv_id)
{
  // Format: "agv_XX"
  if (agv_id.length() >= 5 && agv_id.substr(0, 4) == "agv_") {
    return std::stoi(agv_id.substr(4));
  }
  return -1;
}

}  // namespace utils
}  // namespace agv_core

#endif  // AGV_CORE__UTILS_H_
