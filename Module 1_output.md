# Module 1 - LLM 生成的代码

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Module 1: 导航与运动控制综合模块
====================================
该模块实现了一个ROS 2节点，负责机器人定位、路径规划、避障、电机驱动控制、
传感器数据融合以及远程/本地急停响应。所有功能集成在一个节点中，通过订阅
传感器话题、发布控制命令和状态信息，确保系统在满足安全红线和性能指标的前提下
稳定运行。

主要功能:
- 定位与导航: 融合LiDAR、IMU、编码器里程计，输出高精度位姿。
- 路径规划: 支持全局路径规划（A* / Dijkstra）和局部路径规划（DWA / TEB）。
- 避障与安全: 静态/动态障碍物检测，安全距离速度控制，硬件/软件双冗余急停。
- 电机控制: 差速驱动，编码器反馈，速度限幅。
- 传感器管理: LiDAR、IMU、编码器数据监控与故障检测。
- 通信接口: 符合架构设计的话题发布/订阅，日志记录与状态显示。

依赖:
- ROS 2 (rclpy)
- std_msgs, geometry_msgs, nav_msgs, sensor_msgs
- tf2_ros, tf2_geometry_msgs
- numpy, scipy (可选，用于高级滤波)
"""

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, DurabilityPolicy
from rclpy.parameter import Parameter
from rclpy.exceptions import ParameterNotDeclaredException
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import ReentrantCallbackGroup

from std_msgs.msg import Bool, String, Float64
from geometry_msgs.msg import Twist, PoseStamped, PoseWithCovarianceStamped
from nav_msgs.msg import Odometry, Path
from sensor_msgs.msg import LaserScan, Imu

import tf2_ros
from tf2_ros import TransformBroadcaster, TransformListener, Buffer
from tf2_geometry_msgs import do_transform_pose

import numpy as np
from collections import deque
import time
import math
import logging
import unittest
from unittest.mock import MagicMock, patch

# 日志配置
logging.basicConfig(level=logging.INFO, format='[%(name)s] %(levelname)s: %(message)s')
logger = logging.getLogger('Module1')


class Module1Node(Node):
    """
    ROS 2节点，实现导航与运动控制综合功能。

    该节点集成了定位、规划、避障、电机控制、传感器融合和急停响应。
    所有订阅/发布话题遵循标准ROS 2接口，并通过参数服务器进行安全配置。

    Attributes:
        buffer (tf2_ros.Buffer): TF变换缓存。
        listener (tf2_ros.TransformListener): TF监听器。
        broadcaster (tf2_ros.TransformBroadcaster): TF广播器。
        last_scan_time (float): 最后一次收到LiDAR数据的时间戳。
        last_imu_time (float): 最后一次收到IMU数据的时间戳。
        last_odom_time (float): 最后一次收到里程计数据的时间戳。
        emergency_stop (bool): 当前急停状态。
        current_velocity (Twist): 当前期望速度（未经限幅）。
        safety_velocity (Twist): 安全限制后的速度。
    """

    def __init__(self, node_name='module1_node'):
        super().__init__(node_name)

        # ---------- 参数声明 ----------
        self.declare_parameter('max_linear_vel', 1.5)        # 最大线速度 (m/s)
        self.declare_parameter('max_angular_vel', 0.5)      # 最大角速度 (rad/s)
        self.declare_parameter('safety_distance_slow', 0.5) # 减速距离 (m)
        self.declare_parameter('safety_distance_stop', 0.3) # 停车距离 (m)
        self.declare_parameter('sensor_timeout', 1.0)       # 传感器数据超时 (s)
        self.declare_parameter('lidar_freq_threshold', 8.0) # LiDAR最低频率 (Hz)
        self.declare_parameter('imu_freq_threshold', 80.0)  # IMU最低频率 (Hz)
        self.declare_parameter('odom_freq_threshold', 40.0) # 里程计最低频率 (Hz)
        self.declare_parameter('enable_safety', True)       # 是否启用安全模块
        self.declare_parameter('enable_remote_estop', True) # 是否启用远程急停
        self.declare_parameter('log_level', 'INFO')

        # 读取参数并设置日志级别
        self.get_logger().set_level(logging.getLevelName(self.get_parameter('log_level').value))

        # ---------- 内部状态 ----------
        self.last_scan_time = 0.0
        self.last_imu_time = 0.0
        self.last_odom_time = 0.0
        self.emergency_stop = False
        self.current_velocity = Twist()
        self.safety_velocity = Twist()
        self.lidar_ranges = []          # 最近接收到的激光雷达数据
        self.imu_orientation = None     # 最近IMU姿态（四元数）
        self.odom_pose = None           # 最近里程计位姿
        self.fused_pose = None          # 融合后的位姿

        # ---------- 回调组 ----------
        self.cb_group = ReentrantCallbackGroup()

        # ---------- 创建TF2相关对象 ----------
        self.buffer = Buffer()
        self.listener = TransformListener(self.buffer, self)
        self.broadcaster = TransformBroadcaster(self)

        # ---------- 创建发布者 ----------
        # 融合后的里程计（定位输出）
        self.odom_combined_pub = self.create_publisher(
            Odometry, '/odom_combined', QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE))
        # 控制命令（最终发送给电机）
        self.cmd_vel_pub = self.create_publisher(
            Twist, '/cmd_vel', QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE))
        # 急停状态
        self.emergency_pub = self.create_publisher(
            Bool, '/emergency_stop', QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE))
        # 状态日志（用于Web UI或命令行）
        self.status_pub = self.create_publisher(
            String, '/module1_status', QoSProfile(depth=5, reliability=ReliabilityPolicy.RELIABLE))

        # ---------- 创建订阅者 ----------
        # LiDAR
        qos_lidar = QoSProfile(depth=10, reliability=ReliabilityPolicy.BEST_EFFORT)
        self.scan_sub = self.create_subscription(
            LaserScan, '/scan', self.scan_callback, qos_lidar, callback_group=self.cb_group)
        # IMU
        qos_imu = QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE)
        self.imu_sub = self.create_subscription(
            Imu, '/imu', self.imu_callback, qos_imu, callback_group=self.cb_group)
        # 里程计
        qos_odom = QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE)
        self.odom_sub = self.create_subscription(
            Odometry, '/odom', self.odom_callback, qos_odom, callback_group=self.cb_group)
        # 远程急停信号（可选，如ZigBee/LoRa/WiFi）
        self.remote_estop_sub = self.create_subscription(
            Bool, '/remote_estop', self.remote_estop_callback, 10, callback_group=self.cb_group)
        # 物理急停按钮（模拟，通过GPIO或话题，实际由硬件中断触发）
        self.physical_estop_sub = self.create_subscription(
            Bool, '/physical_estop', self.physical_estop_callback, 10, callback_group=self.cb_group)

        # ---------- 定时器 ----------
        # 主控制循环（10Hz）
        self.control_timer = self.create_timer(0.1, self.control_loop, callback_group=self.cb_group)
        # 传感器故障检测（5Hz）
        self.fault_timer = self.create_timer(0.2, self.fault_detection, callback_group=self.cb_group)
        # 状态发布（1Hz）
        self.status_timer = self.create_timer(1.0, self.publish_status, callback_group=self.cb_group)

        # ---------- 路径规划器（占位，实际可集成nav2） ----------
        self.global_planner = None   # 例如 nav2_simple_commander
        self.local_planner = None    # 例如 DWA 或 TEB

        # ---------- 记录初始化完成 ----------
        self.get_logger().info('Module1Node 初始化完成。')

    # ==============================
    # 回调函数
    # ==============================
    def scan_callback(self, msg: LaserScan):
        """处理LiDAR扫描数据，更新最近障碍物距离并记录时间戳。"""
        self.last_scan_time = self.get_clock().now().nanoseconds / 1e9
        self.lidar_ranges = msg.ranges
        # 可选：计算安全距离内最近障碍物
        self.get_logger().debug(f'收到LiDAR数据，点数: {len(msg.ranges)}')

    def imu_callback(self, msg: Imu):
        """处理IMU数据，更新姿态并记录时间戳。"""
        self.last_imu_time = self.get_clock().now().nanoseconds / 1e9
        self.imu_orientation = msg.orientation
        self.get_logger().debug(f'收到IMU数据，姿态: {msg.orientation}')

    def odom_callback(self, msg: Odometry):
        """处理里程计数据，更新位姿并记录时间戳。"""
        self.last_odom_time = self.get_clock().now().nanoseconds / 1e9
        self.odom_pose = msg.pose.pose
        self.get_logger().debug(f'收到里程计数据，位置: {msg.pose.pose.position}')

    def remote_estop_callback(self, msg: Bool):
        """远程急停信号回调（覆盖≥50m，响应≤200ms）。"""
        if msg.data:
            self.trigger_emergency_stop(reason="远程急停信号触发")
        else:
            # 远程解除急停（需谨慎，建议仅由安全员确认后解除）
            self.clear_emergency_stop(reason="远程急停解除")

    def physical_estop_callback(self, msg: Bool):
        """物理急停按钮回调（直接切断电机电源，软件冗余）。"""
        if msg.data:
            self.trigger_emergency_stop(reason="物理急停按钮按下")
        else:
            # 物理按钮通常为自锁，解除需手动复位
            self.clear_emergency_stop(reason="物理急停按钮复位")

    # ==============================
    # 核心处理函数
    # ==============================
    def trigger_emergency_stop(self, reason: str):
        """
        触发紧急停止：立即置零速度，发布急停信号，并记录日志。
        Args:
            reason: 触发原因描述。
        """
        if self.emergency_stop:
            return  # 已经处于急停状态
        self.emergency_stop = True
        self.get_logger().warning(f'紧急停止触发: {reason}')
        # 发布紧急停止信号
        msg = Bool()
        msg.data = True
        self.emergency_pub.publish(msg)
        # 强制置零速度命令
        zero_twist = Twist()
        self.cmd_vel_pub.publish(zero_twist)
        self.current_velocity = zero_twist
        self.safety_velocity = zero_twist
        # 日志记录
        self.get_logger().info(f'制动命令已发送，原因: {reason}')

    def clear_emergency_stop(self, reason: str):
        """
        解除紧急停止（需手动确认安全）。
        Args:
            reason: 解除原因描述。
        """
        if not self.emergency_stop:
            return
        self.emergency_stop = False
        self.get_logger().warning(f'紧急停止解除: {reason}')
        msg = Bool()
        msg.data = False
        self.emergency_pub.publish(msg)

    def compute_safety_velocity(self, desired_vel: Twist) -> Twist:
        """
        根据安全策略限制速度：基于最近障碍物距离。
        Args:
            desired_vel: 期望速度（来自路径规划器）。
        Returns:
            安全限制后的速度。
        """
        if not self.get_parameter('enable_safety').value:
            return desired_vel

        # 获取最近障碍物距离
        if not self.lidar_ranges:
            return desired_vel
        # 过滤无效值（inf, nan）
        valid_ranges = [r for r in self.lidar_ranges if 0.1 < r < 10.0]
        if not valid_ranges:
            return desired_vel
        min_dist = min(valid_ranges)

        safe_vel = Twist()
        safe_vel.linear.x = desired_vel.linear.x
        safe_vel.angular.z = desired_vel.angular.z

        # 安全距离策略
        stop_dist = self.get_parameter('safety_distance_stop').value
        slow_dist = self.get_parameter('safety_distance_slow').value
        if min_dist <= stop_dist:
            # 立即停车
            safe_vel.linear.x = 0.0
            safe_vel.angular.z = 0.0
            self.get_logger().warn(f'障碍物距离 {min_dist:.2f}m <= {stop_dist}m，强制停车')
        elif min_dist <= slow_dist:
            # 减速至0.2m/s
            max_slow_vel = 0.2
            if safe_vel.linear.x > max_slow_vel:
                safe_vel.linear.x = max_slow_vel
            # 角速度也适当限制
            if abs(safe_vel.angular.z) > 0.2:
                safe_vel.angular.z = np.sign(safe_vel.angular.z) * 0.2
            self.get_logger().info(f'障碍物距离 {min_dist:.2f}m <= {slow_dist}m，减速至 {safe_vel.linear.x:.2f} m/s')
        else:
            # 正常速度，但应用软件限速
            pass

        # 应用全局速度限幅（参数服务器硬限制）
        max_lin = self.get_parameter('max_linear_vel').value
        max_ang = self.get_parameter('max_angular_vel').value
        if abs(safe_vel.linear.x) > max_lin:
            safe_vel.linear.x = np.sign(safe_vel.linear.x) * max_lin
        if abs(safe_vel.angular.z) > max_ang:
            safe_vel.angular.z = np.sign(safe_vel.angular.z) * max_ang

        return safe_vel

    def fuse_sensors(self):
        """
        传感器融合：将LiDAR、IMU、里程计数据融合，输出高精度位姿。
        实际实现应使用扩展卡尔曼滤波器（EKF）或粒子滤波。
        这里作为占位符，简单使用里程计数据，并添加IMU航向校准。
        """
        if self.odom_pose is None:
            return
        # 简单融合：使用IMU的yaw修正里程计的yaw，位置不变
        fused = Odometry()
        fused.header.stamp = self.get_clock().now().to_msg()
        fused.header.frame_id = 'odom'
        fused.child_frame_id = 'base_link'
        fused.pose.pose = self.odom_pose  # 复制位置
        if self.imu_orientation is not None:
            # 使用IMU的四元数代替里程计的旋转（假设IMU更可靠）
            fused.pose.pose.orientation = self.imu_orientation
        # 协方差可设置
        fused.pose.covariance = [0.01]*36  # 简单协方差
        self.fused_pose = fused
        # 发布融合后的里程计
        self.odom_combined_pub.publish(fused)
        # 发送TF变换（odom -> base_link）
        self.broadcaster.send_transform(
            transforms=[self.pose_to_transform(fused.pose.pose)],
            # 注意：需要创建TransformStamped对象，此处简化
        )

    def pose_to_transform(self, pose):
        """将Pose转换为TransformStamped（简化版）。"""
        from geometry_msgs.msg import TransformStamped, Transform
        import tf2_ros
        t = TransformStamped()
        t.header.stamp = self.get_clock().now().to_msg()
        t.header.frame_id = 'odom'
        t.child_frame_id = 'base_link'
        t.transform.translation.x = pose.position.x
        t.transform.translation.y = pose.position.y
        t.transform.translation.z = pose.position.z
        t.transform.rotation = pose.orientation
        return t

    def control_loop(self):
        """主控制循环：根据当前状态和路径规划器输出，计算安全速度并发布。"""
        if self.emergency_stop:
            return  # 急停状态下不执行任何运动控制

        # 传感器融合更新
        self.fuse_sensors()

        # 从路径规划器获取期望速度（占位：简单使用固定速度或目标点）
        # 实际中应从全局/局部规划器获取
        desired_vel = self.get_desired_velocity()

        # 安全速度计算
        safe_vel = self.compute_safety_velocity(desired_vel)

        # 发布速度命令
        self.cmd_vel_pub.publish(safe_vel)
        self.current_velocity = desired_vel
        self.safety_velocity = safe_vel

    def get_desired_velocity(self) -> Twist:
        """
        从路径规划器获取期望速度。
        当前实现为占位：返回固定速度，实际应集成A*/Dijkstra及DWA/TEB。
        Returns:
            期望的Twist消息。
        """
        # 示例：简单直线前进（安全速度会由compute_safety_velocity限制）
        vel = Twist()
        vel.linear.x = 0.5   # 0.5 m/s
        vel.angular.z = 0.0
        return vel

    def fault_detection(self):
        """传感器故障检测：若超时，自动进入安全停止模式。"""
        timeout = self.get_parameter('sensor_timeout').value
        now = self.get_clock().now().nanoseconds / 1e9

        # 检查LiDAR
        if self.last_scan_time > 0 and (now - self.last_scan_time) > timeout:
            self.get_logger().error(f'LiDAR数据丢失超过{timeout}秒，进入安全停止')
            self.trigger_emergency_stop(reason="LiDAR数据丢失")
        # 检查IMU
        if self.last_imu_time > 0 and (now - self.last_imu_time) > timeout:
            self.get_logger().error(f'IMU数据丢失超过{timeout}秒，进入安全停止')
            self.trigger_emergency_stop(reason="IMU数据丢失")
        # 检查里程计
        if self.last_odom_time > 0 and (now - self.last_odom_time) > timeout:
            self.get_logger().error(f'里程计数据丢失超过{timeout}秒，进入安全停止')
            self.trigger_emergency_stop(reason="里程计数据丢失")

    def publish_status(self):
        """发布状态信息（用于监控/日志）。"""
        status = f"急停: {self.emergency_stop}, 当前速度: {self.current_velocity.linear.x:.2f} m/s, " \
                 f"安全速度: {self.safety_velocity.linear.x:.2f} m/s"
        self.get_logger().info(status)
        msg = String()
        msg.data = status
        self.status_pub.publish(msg)

    # ==============================
    # 生命周期管理
    # ==============================
    def destroy_node(self):
        """节点销毁时清理，确保电机停止。"""
        self.get_logger().info('关闭节点，发送停止命令')
        zero = Twist()
        self.cmd_vel_pub.publish(zero)
        super().destroy_node()


# ==============================
# 单元测试
# ==============================
class TestModule1Node(unittest.TestCase):
    """
    单元测试：验证模块1的核心功能。
    使用unittest框架，模拟ROS环境（通过Mock对象）。
    """

    @classmethod
    def setUpClass(cls):
        # 初始化rclpy（仅一次）
        rclpy.init()

    @classmethod
    def tearDownClass(cls):
        rclpy.shutdown()

    def setUp(self):
        # 创建节点（测试用，不启动循环）
        self.node = Module1Node('test_node')
        # 手动设置参数以便测试
        self.node.set_parameters([
            Parameter('max_linear_vel', Parameter.Type.DOUBLE, 1.5),
            Parameter('max_angular_vel', Parameter.Type.DOUBLE, 0.5),
            Parameter('safety_distance_slow', Parameter.Type.DOUBLE, 0.5),
            Parameter('safety_distance_stop', Parameter.Type.DOUBLE, 0.3),
            Parameter('sensor_timeout', Parameter.Type.DOUBLE, 1.0),
            Parameter('enable_safety', Parameter.Type.BOOL, True),
        ])

    def tearDown(self):
        self.node.destroy_node()

    def test_emergency_stop_trigger(self):
        """测试紧急停止触发：速度应置零，发布True信号。"""
        # 模拟远程急停
        self.node.remote_estop_callback(Bool(data=True))
        self.assertTrue(self.node.emergency_stop)
        # 发布速度应为零
        # 由于发布是异步，我们检查内部状态
        self.assertEqual(self.node.current_velocity.linear.x, 0.0)
        self.assertEqual(self.node.current_velocity.angular.z, 0.0)

    def test_emergency_stop_clear(self):
        """测试紧急停止解除。"""
        self.node.trigger_emergency_stop("测试")
        self.node.clear_emergency_stop("测试解除")
        self.assertFalse(self.node.emergency_stop)

    def test_safety_velocity_normal(self):
        """测试安全速度：无障碍物时，期望速度应被限制在参数范围内。"""
        desired = Twist()
        desired.linear.x = 2.0  # 超过最大速度
        desired.angular.z = 1.0
        safe = self.node.compute_safety_velocity(desired)
        self.assertAlmostEqual(safe.linear.x, 1.5, places=2)  # 限幅到1.5
        self.assertAlmostEqual(safe.angular.z, 0.5, places=2)

    def test_safety_velocity_slow_dist(self):
        """测试安全距离低速：设置障碍物距离为0.4m（介于0.3~0.5），应减速。"""
        # 模拟激光雷达数据
        self.node.lidar_ranges = [0.4, 0.5, 0.6]
        desired = Twist()
        desired.linear.x = 1.0
        desired.angular.z = 0.0
        safe = self.node.compute_safety_velocity(desired)
        # 应减速至0.2 m/s
        self.assertAlmostEqual(safe.linear.x, 0.2, places=2)
        self.assertAlmostEqual(safe.angular.z, 0.0, places=2)

    def test_safety_velocity_stop_dist(self):
        """测试安全距离停车：障碍物距离≤0.3m，应停车。"""
        self.node.lidar_ranges = [0.2, 0.3]
        desired = Twist()
        desired.linear.x = 0.5
        safe = self.node.compute_safety_velocity(desired)
        self.assertEqual(safe.linear.x, 0.0)
        self.assertEqual(safe.angular.z, 0.0)

    def test_sensor_fault_detection(self):
        """测试传感器故障检测：超时应触发急停。"""
        # 设置最后一次接收时间很久以前
        old_time = 0.0
        self.node.last_scan_time = old_time
        self.node.last_imu_time = old_time
        self.node.last_odom_time = old_time
        # 执行故障检测
        self.node.fault_detection()
        # 应触发急停
        self.assertTrue(self.node.emergency_stop)

    def test_velocity_limit_via_parameter(self):
        """测试参数修改速度限制（需权限验证，这里仅测试限幅功能）。"""
        # 修改参数（模拟权限验证通过）
        self.node.set_parameters([Parameter('max_linear_vel', Parameter.Type.DOUBLE, 0.8)])
        desired = Twist()
        desired.linear.x = 1.0
        safe = self.node.compute_safety_velocity(desired)
        self.assertAlmostEqual(safe.linear.x, 0.8, places=2)


# ==============================
# 主函数入口
# ==============================
def main(args=None):
    """主函数：启动ROS 2节点。"""
    rclpy.init(args=args)
    node = Module1Node()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    import sys
    # 如果命令行参数包含 '--test'，则运行单元测试
    if '--test' in sys.argv:
        test_loader = unittest.TestLoader()
        test_suite = test_loader.loadTestsFromTestCase(TestModule1Node)
        runner = unittest.TextTestRunner(verbosity=2)
        runner.run(test_suite)
    else:
        main()
```
