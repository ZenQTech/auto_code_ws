/**
 * @file odometry_publisher.h
 * @brief Odometry computation and publishing for differential drive AGV
 *
 * Computes odometry from wheel velocities and publishes
 * nav_msgs/Odometry messages with covariance.
 */

#ifndef AGV_CONTROL__ODOMETRY_PUBLISHER_H_
#define AGV_CONTROL__ODOMETRY_PUBLISHER_H_

#include <rclcpp/rclcpp.hpp>
#include <nav_msgs/msg/odometry.hpp>
#include <geometry_msgs/msg/twist.hpp>
#include <tf2_ros/transform_broadcaster.h>

namespace agv_control
{

class OdometryPublisher
{
public:
  OdometryPublisher() = default;

  /// Initialize with ROS2 node
  void init(rclcpp::Node * node,
            const std::string & odom_frame,
            const std::string & base_frame,
            double wheel_separation,
            double wheel_radius);

  /// Update odometry from wheel velocities
  void update(double left_vel, double right_vel,
              const rclcpp::Time & stamp);

  /// Publish the current odometry message
  void publish(const rclcpp::Time & stamp);

  /// Get current odometry
  const nav_msgs::msg::Odometry & get_odometry() const { return odom_; }

private:
  rclcpp::Publisher<nav_msgs::msg::Odometry>::SharedPtr pub_;
  std::unique_ptr<tf2_ros::TransformBroadcaster> tf_broadcaster_;

  nav_msgs::msg::Odometry odom_;
  std::string odom_frame_;
  std::string base_frame_;
  double wheel_separation_{0.5};
  double wheel_radius_{0.1};

  // Pose state
  double x_{0.0}, y_{0.0}, theta_{0.0};
  rclcpp::Time last_time_;
};

}  // namespace agv_control

#endif  // AGV_CONTROL__ODOMETRY_PUBLISHER_H_
