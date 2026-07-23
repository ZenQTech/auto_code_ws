/**
 * @file odometry_publisher.cpp
 * @brief Implementation of odometry publisher for differential drive
 */

#include "agv_control/odometry_publisher.h"
#include <tf2/LinearMath/Quaternion.h>
#include <cmath>

namespace agv_control
{

void OdometryPublisher::init(rclcpp::Node * node,
                              const std::string & odom_frame,
                              const std::string & base_frame,
                              double wheel_separation,
                              double wheel_radius)
{
  odom_frame_ = odom_frame;
  base_frame_ = base_frame;
  wheel_separation_ = wheel_separation;
  wheel_radius_ = wheel_radius;

  pub_ = node->create_publisher<nav_msgs::msg::Odometry>("odom", 50);
  tf_broadcaster_ = std::make_unique<tf2_ros::TransformBroadcaster>(node);

  // Initialize odometry message
  odom_.header.frame_id = odom_frame_;
  odom_.child_frame_id = base_frame_;
  odom_.pose.pose.position.x = 0.0;
  odom_.pose.pose.position.y = 0.0;
  odom_.pose.pose.position.z = 0.0;
  odom_.pose.pose.orientation.w = 1.0;

  // Set covariance (typical values for differential drive)
  const double xy_cov = 0.001;
  const double yaw_cov = 0.001;
  const double vxy_cov = 0.001;
  const double vyaw_cov = 0.001;

  odom_.pose.covariance[0] = xy_cov;
  odom_.pose.covariance[7] = xy_cov;
  odom_.pose.covariance[14] = 1e6;  // Large z covariance
  odom_.pose.covariance[21] = 1e6;
  odom_.pose.covariance[28] = 1e6;
  odom_.pose.covariance[35] = yaw_cov;

  odom_.twist.covariance[0] = vxy_cov;
  odom_.twist.covariance[7] = vxy_cov;
  odom_.twist.covariance[14] = 1e6;
  odom_.twist.covariance[21] = 1e6;
  odom_.twist.covariance[28] = 1e6;
  odom_.twist.covariance[35] = vyaw_cov;
}

void OdometryPublisher::update(double left_vel, double right_vel,
                                const rclcpp::Time & stamp)
{
  double dt = (stamp - last_time_).seconds();
  if (dt <= 0.0 || dt > 1.0) {
    last_time_ = stamp;
    return;
  }

  // Differential drive kinematics
  double v = (right_vel + left_vel) * wheel_radius_ / 2.0;
  double w = (right_vel - left_vel) * wheel_radius_ / wheel_separation_;

  // Update pose using exact integration
  double dth = w * dt;
  double dx, dy;
  if (std::abs(w) < 1e-6) {
    // Straight line motion
    dx = v * dt * std::cos(theta_);
    dy = v * dt * std::sin(theta_);
  } else {
    // Arc motion
    double r = v / w;
    dx = r * (std::sin(theta_ + dth) - std::sin(theta_));
    dy = -r * (std::cos(theta_ + dth) - std::cos(theta_));
  }

  x_ += dx;
  y_ += dy;
  theta_ += dth;

  // Normalize theta
  while (theta_ > M_PI) theta_ -= 2.0 * M_PI;
  while (theta_ < -M_PI) theta_ += 2.0 * M_PI;

  // Update odometry message
  odom_.header.stamp = stamp;
  odom_.pose.pose.position.x = x_;
  odom_.pose.pose.position.y = y_;
  odom_.pose.pose.position.z = 0.0;

  tf2::Quaternion q;
  q.setRPY(0, 0, theta_);
  odom_.pose.pose.orientation.x = q.x();
  odom_.pose.pose.orientation.y = q.y();
  odom_.pose.pose.orientation.z = q.z();
  odom_.pose.pose.orientation.w = q.w();

  odom_.twist.twist.linear.x = v;
  odom_.twist.twist.angular.z = w;

  last_time_ = stamp;
}

void OdometryPublisher::publish(const rclcpp::Time & stamp)
{
  odom_.header.stamp = stamp;
  pub_->publish(odom_);

  // Broadcast TF
  geometry_msgs::msg::TransformStamped tf;
  tf.header.stamp = stamp;
  tf.header.frame_id = odom_frame_;
  tf.child_frame_id = base_frame_;
  tf.transform.translation.x = x_;
  tf.transform.translation.y = y_;
  tf.transform.translation.z = 0.0;

  tf2::Quaternion q;
  q.setRPY(0, 0, theta_);
  tf.transform.rotation.x = q.x();
  tf.transform.rotation.y = q.y();
  tf.transform.rotation.z = q.z();
  tf.transform.rotation.w = q.w();

  tf_broadcaster_->sendTransform(tf);
}

}  // namespace agv_control
