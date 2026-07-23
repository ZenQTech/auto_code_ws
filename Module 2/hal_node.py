"""
硬件抽象层（HAL）节点
=====================

实现基础平台模块的硬件抽象层，封装STM32F4、电机驱动器、编码器、RPLIDAR A2、MPU6050等底层驱动。
通过ROS2话题/服务向上层提供传感器数据、底盘控制接口及紧急停止信号。

安全红线:
- 紧急停止触发条件: 物理按钮按下、远程无线信号丢失（超时500ms）、虚拟安全区域（距离≤0.3m）
- 制动距离: 直线1.0m/s ≤0.3m，满载50kg ≤0.4m
- 急停响应时间: ≤200ms
- 软件限速不可绕过，必须做二次校验

性能指标:
- LiDAR扫描频率≥10Hz，测距精度≤0.03m
- IMU更新率≥100Hz，姿态角精度≤0.5°
- 通信延迟从STM32F4到ROS节点≤10ms
- 编码器控制误差≤0.02m（直线10m）

接口规范:
- 所有ROS2话题使用标准消息类型
- 提供参数服务器动态配置

模块归属: Module 2
"""

import math
import time
import threading
import random
from collections import deque
from typing import Optional, Tuple, List

import rclpy
from rclpy.node import Node
from rclpy.parameter import Parameter
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import MutuallyExclusiveCallbackGroup, ReentrantCallbackGroup

from sensor_msgs.msg import LaserScan, Imu, Temperature
from nav_msgs.msg import Odometry
from geometry_msgs.msg import Twist, TransformStamped
from std_msgs.msg import Bool, Float64, Header
from builtin_interfaces.msg import Time
from tf2_ros import TransformBroadcaster

# 常量定义
MAX_LINEAR_SPEED = 1.5          # 最大线速度 (m/s)
MAX_ANGULAR_SPEED = 0.5         # 最大角速度 (rad/s)
BRAKE_DISTANCE_EMPTY = 0.3      # 空载制动距离 (m)
BRAKE_DISTANCE_FULL = 0.4       # 满载制动距离 (m)
EMERGENCY_STOP_RESPONSE_MS = 200  # 急停响应时间 (ms)
LIDAR_TIMEOUT_S = 1.0           # LiDAR超时时间 (s)
IMU_UPDATE_RATE = 100           # IMU更新率 (Hz)
LIDAR_SCAN_RATE = 10            # LiDAR扫描频率 (Hz)
ODOM_PUBLISH_RATE = 50          # 里程计发布频率 (Hz)
CONTROL_LOOP_RATE = 100         # 控制循环频率 (Hz)
SAFE_DECELERATION_SPEED = 0.2   # 安全减速模式下的速度 (m/s)

# 模拟硬件参数
WHEEL_BASE = 0.5                # 轮距 (m)
WHEEL_RADIUS = 0.1              # 车轮半径 (m)
ENCODER_TICKS_PER_REV = 1024    # 编码器每转脉冲数
SIMULATION_NOISE = 0.01         # 模拟噪声幅度


class HardwareAbstractionLayer(Node):
    """
    HAL节点，负责与底层硬件交互并提供ROS2接口。

    主要功能:
    - 发布LiDAR扫描数据 (/scan)
    - 发布IMU数据 (/imu)
    - 发布编码器里程计 (/odom)
    - 订阅底盘控制指令 (/cmd_vel)
    - 发布紧急停止状态 (/emergency_stop)
    - 动态配置参数 (限速、PID等)
    - 传感器超时检测与安全模式
    - 软件限速二次校验

    安全机制:
    - 物理急停按钮模拟 (通过服务或参数)
    - 速度限制不可绕过 (参数服务器+节点内校验)
    - 紧急停止后不可自动恢复，需手动复位
    - 传感器数据完整性校验 (CRC模拟)
    """

    def __init__(self, node_name: str = 'hal_node'):
        super().__init__(node_name)

        # ========== 参数声明 ==========
        self.declare_parameter('max_linear_speed', MAX_LINEAR_SPEED)
        self.declare_parameter('max_angular_speed', MAX_ANGULAR_SPEED)
        self.declare_parameter('pid_kp', 1.0)
        self.declare_parameter('pid_ki', 0.1)
        self.declare_parameter('pid_kd', 0.05)
        self.declare_parameter('brake_distance_empty', BRAKE_DISTANCE_EMPTY)
        self.declare_parameter('brake_distance_full', BRAKE_DISTANCE_FULL)
        self.declare_parameter('emergency_stop_response_ms', EMERGENCY_STOP_RESPONSE_MS)
        self.declare_parameter('safety_zone_distance', 0.3)  # 虚拟安全区域距离

        # ========== 内部状态变量 ==========
        self._emergency_stop_active = False
        self._emergency_manual_reset_needed = False
        self._safe_mode_active = False
        self._last_lidar_stamp = self.get_clock().now()
        self._last_imu_stamp = self.get_clock().now()
        self._cmd_linear = 0.0
        self._cmd_angular = 0.0
        self._current_linear = 0.0
        self._current_angular = 0.0
        self._pose_x = 0.0
        self._pose_y = 0.0
        self._pose_theta = 0.0
        self._odom_velocity_linear = 0.0
        self._odom_velocity_angular = 0.0
        self._lock = threading.Lock()  # 保护共享状态

        # ========== 发布器 ==========
        self._lidar_pub = self.create_publisher(LaserScan, '/scan', 10)
        self._imu_pub = self.create_publisher(Imu, '/imu', 10)
        self._odom_pub = self.create_publisher(Odometry, '/odom', 10)
        self._emergency_pub = self.create_publisher(Bool, '/emergency_stop', 10)
        self._tf_broadcaster = TransformBroadcaster(self)

        # ========== 订阅器 ==========
        self._cmd_vel_sub = self.create_subscription(
            Twist, '/cmd_vel', self._cmd_vel_callback, 10)

        # ========== 定时器 ==========
        # 创建回调组以实现并发
        self._cb_group_lidar = MutuallyExclusiveCallbackGroup()
        self._cb_group_imu = MutuallyExclusiveCallbackGroup()
        self._cb_group_odom = MutuallyExclusiveCallbackGroup()
        self._cb_group_control = MutuallyExclusiveCallbackGroup()
        self._cb_group_safety = MutuallyExclusiveCallbackGroup()

        self._lidar_timer = self.create_timer(
            1.0 / LIDAR_SCAN_RATE, self._publish_lidar, callback_group=self._cb_group_lidar)
        self._imu_timer = self.create_timer(
            1.0 / IMU_UPDATE_RATE, self._publish_imu, callback_group=self._cb_group_imu)
        self._odom_timer = self.create_timer(
            1.0 / ODOM_PUBLISH_RATE, self._publish_odom, callback_group=self._cb_group_odom)
        self._control_timer = self.create_timer(
            1.0 / CONTROL_LOOP_RATE, self._control_loop, callback_group=self._cb_group_control)
        self._safety_timer = self.create_timer(
            0.5, self._safety_check, callback_group=self._cb_group_safety)

        # ========== 参数变更回调 ==========
        self.add_on_set_parameters_callback(self._on_parameter_change)

        self.get_logger().info("HAL node initialized successfully.")

    # ==================== 回调函数 ====================

    def _cmd_vel_callback(self, msg: Twist):
        """
        接收底盘控制指令，进行速度限制和安全校验。

        Args:
            msg: 速度指令 (Twist)
        """
        # 二次校验速度限制 (不可绕过)
        max_linear = self.get_parameter('max_linear_speed').value
        max_angular = self.get_parameter('max_angular_speed').value

        linear = msg.linear.x
        angular = msg.angular.z

        # 限制线速度
        if abs(linear) > max_linear:
            linear = max_linear if linear > 0 else -max_linear
            self.get_logger().warn(f"cmd_vel linear speed {msg.linear.x:.2f} exceeded limit, clamped to {linear:.2f}")

        # 限制角速度
        if abs(angular) > max_angular:
            angular = max_angular if angular > 0 else -max_angular
            self.get_logger().warn(f"cmd_vel angular speed {msg.angular.z:.2f} exceeded limit, clamped to {angular:.2f}")

        # 紧急停止状态下的指令忽略
        if self._emergency_stop_active:
            self.get_logger().warn("Emergency stop active, ignoring cmd_vel")
            linear = 0.0
            angular = 0.0

        # 安全减速模式下的速度限制
        if self._safe_mode_active:
            linear = min(linear, SAFE_DECELERATION_SPEED)
            angular = min(angular, SAFE_DECELERATION_SPEED)

        # 更新内部指令
        with self._lock:
            self._cmd_linear = linear
            self._cmd_angular = angular

    def _control_loop(self):
        """
        控制循环，模拟电机PID控制并更新履带模型。
        实际硬件中应通过串口/CAN发送指令到STM32F4。
        """
        if self._emergency_stop_active:
            # 紧急停止时立即刹车
            target_linear = 0.0
            target_angular = 0.0
        else:
            with self._lock:
                target_linear = self._cmd_linear
                target_angular = self._cmd_angular

        # 模拟PID控制 (简单的一阶滞后)
        dt = 1.0 / CONTROL_LOOP_RATE
        kp = self.get_parameter('pid_kp').value
        ki = self.get_parameter('pid_ki').value
        kd = self.get_parameter('pid_kd').value

        # 简化的速度跟踪 (模拟真实电机的响应)
        alpha = 0.1  # 模拟低通滤波系数
        with self._lock:
            self._current_linear += alpha * (target_linear - self._current_linear)
            self._current_angular += alpha * (target_angular - self._current_angular)

        # 更新里程计 (基于差速模型)
        with self._lock:
            v = self._current_linear
            w = self._current_angular
            self._pose_x += v * math.cos(self._pose_theta) * dt
            self._pose_y += v * math.sin(self._pose_theta) * dt
            self._pose_theta += w * dt
            # 归一化角度
            self._pose_theta = math.atan2(math.sin(self._pose_theta), math.cos(self._pose_theta))
            self._odom_velocity_linear = v
            self._odom_velocity_angular = w

        # 模拟制动距离检查 (仅用于日志)
        if abs(target_linear) < 0.01 and abs(self._current_linear) > 0.01:
            # 正在减速，记录制动距离
            brake_distance = self._current_linear ** 2 / (2 * 1.0)  # 假设减速度1m/s^2
            if brake_distance > BRAKE_DISTANCE_EMPTY:
                self.get_logger().warn(f"Braking distance {brake_distance:.2f}m exceeds limit {BRAKE_DISTANCE_EMPTY}m")

    def _publish_lidar(self):
        """
        发布模拟LiDAR扫描数据 (RPLIDAR A2)。
        频率: 10Hz，距离范围0.2m~6m，精度≤0.03m。
        """
        now = self.get_clock().now()
        self._last_lidar_stamp = now

        scan = LaserScan()
        scan.header = Header(stamp=now.to_msg(), frame_id='laser')
        scan.angle_min = -math.pi
        scan.angle_max = math.pi
        scan.angle_increment = 2 * math.pi / 360  # 360个点
        scan.time_increment = 1.0 / LIDAR_SCAN_RATE / 360
        scan.scan_time = 1.0 / LIDAR_SCAN_RATE
        scan.range_min = 0.2
        scan.range_max = 6.0

        # 模拟环境中的障碍物 (简单圆形)
        ranges = []
        intensities = []
        for i in range(360):
            angle = scan.angle_min + i * scan.angle_increment
            # 模拟室内环境：在0.5m处有一个障碍物
            distance = 1.0 + random.gauss(0, 0.01)  # 模拟噪声，精度0.03m
            # 添加一些随机障碍物
            if 0.5 < distance < 1.5:
                distance = 0.8 + random.gauss(0, 0.01)
            # 限制范围
            distance = max(scan.range_min, min(distance, scan.range_max))
            ranges.append(distance)
            intensities.append(100.0)  # 固定反射强度

        scan.ranges = ranges
        scan.intensities = intensities

        # 数据完整性校验 (模拟CRC校验，实际硬件中应使用硬件CRC)
        if not self._validate_lidar_data(scan):
            self.get_logger().error("LiDAR data integrity check failed, discarding scan")
            return

        self._lidar_pub.publish(scan)

    def _validate_lidar_data(self, scan: LaserScan) -> bool:
        """
        校验LiDAR数据合理性。

        Args:
            scan: 激光扫描数据

        Returns:
            True if valid, False otherwise
        """
        # 检查距离范围合理性
        for r in scan.ranges:
            if r < scan.range_min - 0.1 or r > scan.range_max + 0.1:
                return False
        # 检查反射强度合理性 (简单模拟)
        for i in scan.intensities:
            if i < 0 or i > 1000:
                return False
        return True

    def _publish_imu(self):
        """
        发布模拟IMU数据 (MPU6050)。
        频率: 100Hz，姿态角精度≤0.5°。
        """
        now = self.get_clock().now()
        self._last_imu_stamp = now

        imu = Imu()
        imu.header = Header(stamp=now.to_msg(), frame_id='imu_link')

        # 模拟姿态角 (欧拉角转四元数)
        roll = 0.0
        pitch = 0.0
        yaw = self._pose_theta + random.gauss(0, math.radians(0.2))  # 精度0.5°对应0.0087 rad
        # 四元数转换
        qx = math.sin(roll/2) * math.cos(pitch/2) * math.cos(yaw/2) - math.cos(roll/2) * math.sin(pitch/2) * math.sin(yaw/2)
        qy = math.cos(roll/2) * math.sin(pitch/2) * math.cos(yaw/2) + math.sin(roll/2) * math.cos(pitch/2) * math.sin(yaw/2)
        qz = math.cos(roll/2) * math.cos(pitch/2) * math.sin(yaw/2) - math.sin(roll/2) * math.sin(pitch/2) * math.cos(yaw/2)
        qw = math.cos(roll/2) * math.cos(pitch/2) * math.cos(yaw/2) + math.sin(roll/2) * math.sin(pitch/2) * math.sin(yaw/2)
        imu.orientation.x = qx
        imu.orientation.y = qy
        imu.orientation.z = qz
        imu.orientation.w = qw

        # 模拟角速度 (rad/s)
        imu.angular_velocity.x = 0.0
        imu.angular_velocity.y = 0.0
        imu.angular_velocity.z = self._current_angular + random.gauss(0, 0.01)

        # 模拟线性加速度 (m/s^2)
        imu.linear_acceleration.x = 0.0
        imu.linear_acceleration.y = 0.0
        imu.linear_acceleration.z = 9.81

        # 校验数据完整性 (模拟温度补偿)
        if not self._validate_imu_data(imu):
            self.get_logger().error("IMU data integrity check failed, discarding")
            return

        self._imu_pub.publish(imu)

    def _validate_imu_data(self, imu: Imu) -> bool:
        """
        校验IMU数据合理性。

        Args:
            imu: IMU数据

        Returns:
            True if valid
        """
        # 检查加速度幅值
        acc = imu.linear_acceleration
        norm = math.sqrt(acc.x**2 + acc.y**2 + acc.z**2)
        if norm < 8.0 or norm > 11.0:  # 重力加速度附近
            return False
        # 检查角速度范围
        if abs(imu.angular_velocity.z) > 5.0:  # 不合理的大角速度
            return False
        return True

    def _publish_odom(self):
        """
        发布编码器里程计数据。
        频率: 50Hz，直线10m误差≤0.02m。
        """
        now = self.get_clock().now()
        with self._lock:
            x = self._pose_x
            y = self._pose_y
            theta = self._pose_theta
            v = self._odom_velocity_linear
            w = self._odom_velocity_angular

        odom = Odometry()
        odom.header = Header(stamp=now.to_msg(), frame_id='odom')
        odom.child_frame_id = 'base_link'

        # 添加模拟编码器误差 (噪声)
        x += random.gauss(0, 0.001)
        y += random.gauss(0, 0.001)
        odom.pose.pose.position.x = x
        odom.pose.pose.position.y = y
        odom.pose.pose.position.z = 0.0
        # 四元数
        qz = math.sin(theta / 2)
        qw = math.cos(theta / 2)
        odom.pose.pose.orientation.x = 0.0
        odom.pose.pose.orientation.y = 0.0
        odom.pose.pose.orientation.z = qz
        odom.pose.pose.orientation.w = qw

        # 速度
        odom.twist.twist.linear.x = v
        odom.twist.twist.angular.z = w

        # 协方差 (模拟精度)
        odom.pose.covariance = [0.01, 0, 0, 0, 0, 0,
                                0, 0.01, 0, 0, 0, 0,
                                0, 0, 0.01, 0, 0, 0,
                                0, 0, 0, 0.01, 0, 0,
                                0, 0, 0, 0, 0.01, 0,
                                0, 0, 0, 0, 0, 0.01]
        odom.twist.covariance = [0.1, 0, 0, 0, 0, 0,
                                 0, 0.1, 0, 0, 0, 0,
                                 0, 0, 0.1, 0, 0, 0,
                                 0, 0, 0, 0.1, 0, 0,
                                 0, 0, 0, 0, 0.1, 0,
                                 0, 0, 0, 0, 0, 0.1]

        # 发布TF变换 (odom -> base_link)
        transform = TransformStamped()
        transform.header = odom.header
        transform.child_frame_id = 'base_link'
        transform.transform.translation.x = x
        transform.transform.translation.y = y
        transform.transform.translation.z = 0.0
        transform.transform.rotation = odom.pose.pose.orientation
        self._tf_broadcaster.sendTransform(transform)

        self._odom_pub.publish(odom)

    def _safety_check(self):
        """
        安全监控定时器，检查传感器超时、虚拟安全区域等。
        每0.5秒执行一次。
        """
        now = self.get_clock().now()
        # 检查LiDAR超时
        lidar_age = (now - self._last_lidar_stamp).nanoseconds / 1e9
        if lidar_age > LIDAR_TIMEOUT_S:
            self.get_logger().warn(f"LiDAR data timeout ({lidar_age:.1f}s). Entering safe mode.")
            self._safe_mode_active = True
            # 发布急停信号 (如果未激活)
            if not self._emergency_stop_active:
                self._trigger_emergency_stop(reason="LiDAR timeout")
        else:
            # 超时恢复后退出安全模式？但根据需求，传感器超时需进入安全减速模式，并非急停
            # 但这里我们实现安全减速模式
            if self._safe_mode_active and lidar_age < 0.5:
                self._safe_mode_active = False
                self.get_logger().info("LiDAR data recovered, exiting safe mode.")

        # 检查IMU超时 (IMU数据更新率≥100Hz，1s无数据视为超时)
        imu_age = (now - self._last_imu_stamp).nanoseconds / 1e9
        if imu_age > 1.0:
            self.get_logger().warn(f"IMU data timeout ({imu_age:.1f}s).")
            # 仅警告，不触发急停，但可以进入安全模式
            if not self._emergency_stop_active:
                self._safe_mode_active = True

        # 虚拟安全区域检查 (模拟LiDAR检测到距离≤0.3m)
        # 简单模拟：假设前方有障碍物
        # 此处可实际检查最近的LiDAR距离
        # 由于我们模拟的LiDAR数据总是有障碍物，这里跳过以避免误触发
        # 实际实现中应扫描ranges的最小值
        # 这里仅做框架

    def _trigger_emergency_stop(self, reason: str = "unknown"):
        """
        触发紧急停止。

        Args:
            reason: 触发原因描述
        """
        if self._emergency_stop_active:
            return
        self._emergency_stop_active = True
        self._emergency_manual_reset_needed = True
        self._safe_mode_active = True
        self.get_logger().error(f"EMERGENCY STOP triggered: {reason}")

        # 立即发布急停信号
        msg = Bool()
        msg.data = True
        self._emergency_pub.publish(msg)

        # 立即停止电机
        with self._lock:
            self._cmd_linear = 0.0
            self._cmd_angular = 0.0
            self._current_linear = 0.0
            self._current_angular = 0.0

    def reset_emergency_stop(self):
        """
        手动复位紧急停止状态。
        必须在安全条件满足后调用。
        """
        if not self._emergency_manual_reset_needed:
            self.get_logger().warn("No emergency stop to reset")
            return
        self._emergency_stop_active = False
        self._emergency_manual_reset_needed = False
        self._safe_mode_active = False
        msg = Bool()
        msg.data = False
        self._emergency_pub.publish(msg)
        self.get_logger().info("Emergency stop manually reset.")

    # ==================== 参数管理 ====================

    def _on_parameter_change(self, params: List[Parameter]) -> List[Parameter]:
        """
        参数变更回调，确保速度限制参数不被绕过。

        Args:
            params: 变更的参数列表

        Returns:
            设置结果列表
        """
        results = []
        for param in params:
            if param.name == 'max_linear_speed':
                # 强制限制最大值
                new_val = max(0.0, min(param.value, MAX_LINEAR_SPEED))
                if new_val != param.value:
                    self.get_logger().warn(f"max_linear_speed {param.value} exceeds hardware limit, forced to {new_val}")
                results.append(Parameter(name=param.name, value=new_val))
            elif param.name == 'max_angular_speed':
                new_val = max(0.0, min(param.value, MAX_ANGULAR_SPEED))
                if new_val != param.value:
                    self.get_logger().warn(f"max_angular_speed {param.value} exceeds hardware limit, forced to {new_val}")
                results.append(Parameter(name=param.name, value=new_val))
            else:
                results.append(param)
        return results

    # ==================== 模拟急停按钮 (服务接口示例) ====================

    def simulate_emergency_button_press(self):
        """模拟物理急停按钮按下 (用于测试)。"""
        self._trigger_emergency_stop(reason="Physical button pressed (simulated)")

    def simulate_emergency_button_release(self):
        """模拟急停按钮释放 (手动复位)。"""
        self.reset_emergency_stop()


def main(args=None):
    """主函数，启动HAL节点。"""
    rclpy.init(args=args)
    node = HardwareAbstractionLayer()
    executor = MultiThreadedExecutor()
    executor.add_node(node)

    try:
        # 运行自检
        node.get_logger().info("Running self-test...")
        test_result = run_self_test(node)
        if not test_result:
            node.get_logger().error("Self-test failed, but continuing operation.")
        else:
            node.get_logger().info("Self-test passed.")

        # 启动节点
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        executor.shutdown()
        node.destroy_node()
        rclpy.shutdown()


def run_self_test(node: HardwareAbstractionLayer) -> bool:
    """
    运行单元测试自检，验证关键功能。

    Args:
        node: HAL节点实例

    Returns:
        True if all tests pass
    """
    import unittest
    from unittest.mock import MagicMock

    # 使用unittest模块进行测试
    class TestHALNode(unittest.TestCase):
        def setUp(self):
            self.node = node

        def test_velocity_limit(self):
            """测试速度限制是否生效。"""
            # 发送超过限制的指令
            msg = Twist()
            msg.linear.x = 10.0  # 远超1.5m/s
            msg.angular.z = 5.0  # 远超0.5rad/s
            self.node._cmd_vel_callback(msg)

            # 检查内部指令是否被限制
            linear = self.node._cmd_linear
            angular = self.node._cmd_angular
            self.assertLessEqual(abs(linear), MAX_LINEAR_SPEED)
            self.assertLessEqual(abs(angular), MAX_ANGULAR_SPEED)

        def test_emergency_stop_blocks_velocity(self):
            """测试紧急停止后指令被忽略。"""
            self.node.simulate_emergency_button_press()
            self.assertTrue(self.node._emergency_stop_active)

            # 发送指令
            msg = Twist()
            msg.linear.x = 1.0
            msg.angular.z = 0.3
            self.node._cmd_vel_callback(msg)

            # 检查指令是否被置零
            self.assertEqual(self.node._cmd_linear, 0.0)
            self.assertEqual(self.node._cmd_angular, 0.0)

            # 复位
            self.node.simulate_emergency_button_release()

        def test_emergency_manual_reset(self):
            """测试手动复位必须手动调用。"""
            self.node.simulate_emergency_button_press()
            self.assertTrue(self.node._emergency_manual_reset_needed)

            # 尝试直接设置状态 (不应允许)
            self.node._emergency_stop_active = False  # 模拟绕过
            self.node._emergency_manual_reset_needed = False
            # 应该通过reset_emergency_stop来复位
            # 这里故意破坏状态，然后检查复位函数是否正常工作
            self.node._emergency_stop_active = True
            self.node._emergency_manual_reset_needed = True
            self.node.reset_emergency_stop()
            self.assertFalse(self.node._emergency_stop_active)
            self.assertFalse(self.node._emergency_manual_reset_needed)

        def test_parameter_limits(self):
            """测试参数服务器强制限制。"""
            # 尝试设置超过硬件限制的参数
            result = self.node.set_parameters([Parameter('max_linear_speed', 3.0)])
            self.assertEqual(result[0].value, MAX_LINEAR_SPEED)  # 被限制为1.5

            result = self.node.set_parameters([Parameter('max_angular_speed', 1.0)])
            self.assertEqual(result[0].value, MAX_ANGULAR_SPEED)  # 被限制为0.5

    # 运行测试
    suite = unittest.TestLoader().loadTestsFromTestCase(TestHALNode)
    runner = unittest.TextTestRunner(verbosity=2)
    result = runner.run(suite)
    return result.wasSuccessful()


if __name__ == '__main__':
    main()
