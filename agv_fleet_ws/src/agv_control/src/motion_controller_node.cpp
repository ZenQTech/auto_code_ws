/**
 * @file motion_controller_node.cpp
 * @brief Main motion controller node for AGV
 *
 * Subscribes to:
 *   - /cmd_vel (from local planner)
 *   - /cmd_vel_limited (from safety watchdog)
 *   - /joint_states (from Gazebo)
 * Publishes:
 *   - /odom (computed odometry)
 *   - /cmd_vel_safe (to Gazebo, after safety filtering)
 */

#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/twist.hpp>
#include <sensor_msgs/msg/joint_state.hpp>
#include <nav_msgs/msg/odometry.hpp>

#include "agv_control/cmd_mux.h"
#include "agv_control/odometry_publisher.h"
#include "agv_core/utils.h"

using namespace std::chrono_literals;

class MotionControllerNode : public rclcpp::Node
{
public:
  MotionControllerNode()
  : Node("motion_controller")
  {
    // Declare parameters
    this->declare_parameter("wheel_separation", 0.5);
    this->declare_parameter("wheel_radius", 0.1);
    this->declare_parameter("max_linear_speed", 1.5);
    this->declare_parameter("max_angular_speed", 1.5);
    this->declare_parameter("control_rate", 100.0);

    double wheel_sep = this->get_parameter("wheel_separation").as_double();
    double wheel_rad = this->get_parameter("wheel_radius").as_double();
    double control_rate = this->get_parameter("control_rate").as_double();

    // Initialize odometry publisher
    odom_pub_.init(this, "odom", "base_link", wheel_sep, wheel_rad);

    // Configure command multiplexer
    cmd_mux_.set_timeout(agv_control::CmdSource::LOCAL_PLANNER, 200);   // 200ms
    cmd_mux_.set_timeout(agv_control::CmdSource::GLOBAL_PLANNER, 500);  // 500ms

    // Subscribers
    sub_cmd_vel_ = this->create_subscription<geometry_msgs::msg::Twist>(
      "cmd_vel", 10,
      [this](const geometry_msgs::msg::Twist::SharedPtr msg) {
        cmd_mux_.submit(*msg, agv_control::CmdSource::LOCAL_PLANNER);
      });

    sub_cmd_vel_limited_ = this->create_subscription<geometry_msgs::msg::Twist>(
      "cmd_vel_limited", 10,
      [this](const geometry_msgs::msg::Twist::SharedPtr msg) {
        cmd_mux_.submit(*msg, agv_control::CmdSource::SAFETY);
      });

    sub_joint_states_ = this->create_subscription<sensor_msgs::msg::JointState>(
      "joint_states", 10,
      [this](const sensor_msgs::msg::JointState::SharedPtr msg) {
        joint_state_callback(msg);
      });

    // Publisher for safe velocity command
    pub_cmd_vel_safe_ = this->create_publisher<geometry_msgs::msg::Twist>(
      "cmd_vel_safe", 10);

    // Control loop timer
    auto period = std::chrono::duration<double>(1.0 / control_rate);
    timer_ = this->create_wall_timer(
      period, [this]() { control_loop(); });

    RCLCPP_INFO(this->get_logger(), "Motion controller started");
  }

private:
  void joint_state_callback(const sensor_msgs::msg::JointState::SharedPtr msg)
  {
    double left_vel = 0.0, right_vel = 0.0;

    for (size_t i = 0; i < msg->name.size(); ++i) {
      if (msg->name[i] == "left_wheel_joint") {
        left_vel = msg->velocity[i];
      } else if (msg->name[i] == "right_wheel_joint") {
        right_vel = msg->velocity[i];
      }
    }

    odom_pub_.update(left_vel, right_vel, msg->header.stamp);
  }

  void control_loop()
  {
    auto now = this->now();

    // Get effective command from multiplexer
    auto cmd = cmd_mux_.get_effective();

    // Apply speed limits
    double max_linear = this->get_parameter("max_linear_speed").as_double();
    double max_angular = this->get_parameter("max_angular_speed").as_double();

    cmd.linear.x = agv_core::utils::clamp(cmd.linear.x, -max_linear, max_linear);
    cmd.angular.z = agv_core::utils::clamp(cmd.angular.z, -max_angular, max_angular);

    // Publish safe command
    pub_cmd_vel_safe_->publish(cmd);

    // Publish odometry
    odom_pub_.publish(now);
  }

  // Subscribers
  rclcpp::Subscription<geometry_msgs::msg::Twist>::SharedPtr sub_cmd_vel_;
  rclcpp::Subscription<geometry_msgs::msg::Twist>::SharedPtr sub_cmd_vel_limited_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr sub_joint_states_;

  // Publishers
  rclcpp::Publisher<geometry_msgs::msg::Twist>::SharedPtr pub_cmd_vel_safe_;

  // Components
  agv_control::CmdMux cmd_mux_;
  agv_control::OdometryPublisher odom_pub_;

  // Timer
  rclcpp::TimerBase::SharedPtr timer_;
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<MotionControllerNode>();
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}
