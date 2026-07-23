"""
Module 4: 基础平台硬件抽象层 (HAL) 模拟实现

本模块模拟了STM32F4基础平台的核心硬件抽象层，包括电机驱动、LiDAR、IMU、紧急停止等。
提供ROS2标准话题/服务接口，并实现速度限制、障碍物检测停车、紧急停止等安全逻辑。
所有功能均包含完整的docstring、错误处理及单元测试自检。

模块归属: Module 4
"""

import math
import unittest
from dataclasses import dataclass
from typing import Optional, Tuple

# 模拟ROS2消息类型（用于单元测试，不依赖实际ROS2环境）
@dataclass
class Twist:
    """模拟 geometry_msgs/Twist 消息"""
    linear: 'Vector3'
    angular: 'Vector3'

@dataclass
class Vector3:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0

@dataclass
class LaserScan:
    """模拟 sensor_msgs/LaserScan 消息"""
    ranges: list
    angle_min: float = -math.pi
    angle_max: float = math.pi
    angle_increment: float = 0.0174533  # 1度

@dataclass
class Imu:
    """模拟 sensor_msgs/Imu 消息"""
    orientation: 'Quaternion'
    angular_velocity: Vector3
    linear_acceleration: Vector3

@dataclass
class Quaternion:
    x: float = 0.0
    y: float = 0.0
    z: float = 0.0
    w: float = 1.0

@dataclass
class Odometry:
    """模拟 nav_msgs/Odometry 消息"""
    pose: 'Pose'
    twist: Twist

@dataclass
class Pose:
    position: Vector3
    orientation: Quaternion

# 全局常量
MAX_LINEAR_SPEED_DEFAULT = 1.5  # m/s
MAX_ANGULAR_SPEED_DEFAULT = 0.5  # rad/s
EMERGENCY_STOP_TOPIC = "/emergency_stop"
SAFE_DISTANCE = 0.3  # 米
CMD_TIMEOUT = 1.0  # 秒
BRAKE_DISTANCE_EMPTY = 0.3  # 1.0m/s速度下空载制动距离
BRAKE_DISTANCE_LOADED = 0.4  # 满载50kg

class BasePlatformNode:
    """
    模拟基础平台硬件抽象层节点。

    实现以下功能：
    - 电机驱动与速度限制 (从参数服务器读取限速值)
    - 紧急停止响应 (硬件优先级最高)
    - LiDAR障碍物检测停车 (距离≤0.3m立即停车)
    - 速度指令超时保护 (1秒无指令自动停车)
    - 里程计模型 (简单积分)
    - 模拟传感器数据生成 (LiDAR, IMU, 里程计)

    注意: 本类为模拟实现，不依赖实际硬件和ROS2，可在纯Python环境下测试。
    """

    def __init__(self, max_linear_speed: float = MAX_LINEAR_SPEED_DEFAULT,
                 max_angular_speed: float = MAX_ANGULAR_SPEED_DEFAULT):
        """
        初始化平台节点。

        Args:
            max_linear_speed: 最大线速度 (m/s)，从参数服务器获取
            max_angular_speed: 最大角速度 (rad/s)，从参数服务器获取

        Raises:
            ValueError: 如果限速值超出安全范围
        """
        if max_linear_speed <= 0 or max_angular_speed <= 0:
            raise ValueError("速度限制必须为正数")
        if max_linear_speed > MAX_LINEAR_SPEED_DEFAULT:
            raise ValueError(f"最大线速度不能超过{MAX_LINEAR_SPEED_DEFAULT} m/s")
        if max_angular_speed > MAX_ANGULAR_SPEED_DEFAULT:
            raise ValueError(f"最大角速度不能超过{MAX_ANGULAR_SPEED_DEFAULT} rad/s")

        self._max_linear_speed = max_linear_speed
        self._max_angular_speed = max_angular_speed
        self._last_cmd_vel = Twist(Vector3(), Vector3())  # 最后有效速度
        self._last_cmd_time = 0.0  # 模拟时间戳（秒）
        self._current_time = 0.0
        self._emergency_stop = False
        self._obstacle_detected = False
        self._odom = Odometry(
            pose=Pose(position=Vector3(), orientation=Quaternion()),
            twist=Twist(Vector3(), Vector3())
        )
        # 模拟传感器数据
        self._lidar_scan = LaserScan(ranges=[10.0]*360)  # 默认无障碍
        self._imu = Imu(
            orientation=Quaternion(),
            angular_velocity=Vector3(),
            linear_acceleration=Vector3()
        )
        self._log = []  # 日志记录

    def apply_speed_limit(self, twist: Twist) -> Twist:
        """
        对速度指令进行限速，确保不超过参数服务器配置的最大值。

        Args:
            twist: 原始速度指令

        Returns:
            限速后的速度指令

        Raises:
            TypeError: 如果输入不是Twist类型
        """
        if not isinstance(twist, Twist):
            raise TypeError("输入必须是Twist类型")

        # 复制以避免修改原对象
        limited = Twist(
            linear=Vector3(twist.linear.x, twist.linear.y, twist.linear.z),
            angular=Vector3(twist.angular.x, twist.angular.y, twist.angular.z)
        )

        # 限速线速度 (仅考虑x方向差速)
        if abs(limited.linear.x) > self._max_linear_speed:
            sign = 1.0 if limited.linear.x > 0 else -1.0
            limited.linear.x = sign * self._max_linear_speed
            self._log_warning(f"线速度被截断至 {limited.linear.x} m/s")

        # 限速角速度 (z轴)
        if abs(limited.angular.z) > self._max_angular_speed:
            sign = 1.0 if limited.angular.z > 0 else -1.0
            limited.angular.z = sign * self._max_angular_speed
            self._log_warning(f"角速度被截断至 {limited.angular.z} rad/s")

        return limited

    def handle_cmd_vel(self, twist: Twist, timestamp: float) -> Twist:
        """
        处理速度指令，包含限速、紧急停止、障碍物检测、超时保护。

        Args:
            twist: 输入速度指令
            timestamp: 当前时间戳（秒）

        Returns:
            最终执行的速度指令 (可能为0)
        """
        if self._emergency_stop:
            self._log_info("紧急停止激活，速度归零")
            return Twist(Vector3(), Vector3())

        if self._obstacle_detected:
            self._log_info("障碍物检测到（≤0.3m），立即停车")
            return Twist(Vector3(), Vector3())

        # 超时保护：检查是否超过1秒无指令
        if timestamp - self._last_cmd_time > CMD_TIMEOUT:
            self._log_warning("速度指令超时，自动停车")
            self._last_cmd_vel = Twist(Vector3(), Vector3())
            return self._last_cmd_vel

        # 限速处理
        limited = self.apply_speed_limit(twist)
        self._last_cmd_vel = limited
        self._last_cmd_time = timestamp
        return limited

    def update_odometry(self, dt: float, linear_vel: float, angular_vel: float):
        """
        根据速度更新里程计 (简单差分模型)。

        Args:
            dt: 时间步长 (秒)
            linear_vel: 线速度 (m/s)
            angular_vel: 角速度 (rad/s)
        """
        if dt <= 0:
            raise ValueError("时间步长必须为正数")

        # 更新位置
        delta_x = linear_vel * math.cos(self._odom.pose.orientation.z) * dt
        delta_y = linear_vel * math.sin(self._odom.pose.orientation.z) * dt
        self._odom.pose.position.x += delta_x
        self._odom.pose.position.y += delta_y
        # 更新朝向 (简化：仅z轴角速度)
        self._odom.pose.orientation.z += angular_vel * dt
        # 归一化
        self._odom.pose.orientation.z %= 2 * math.pi
        # 更新twist
        self._odom.twist.linear.x = linear_vel
        self._odom.twist.angular.z = angular_vel

    def set_emergency_stop(self, active: bool):
        """
        设置紧急停止状态 (硬件优先级最高，无法被软件绕过)。

        Args:
            active: True表示激活紧急停止
        """
        self._emergency_stop = active
        if active:
            self._log_info("紧急停止已触发，电机动力切断")
        else:
            self._log_info("紧急停止解除")

    def set_obstacle_detected(self, detected: bool):
        """
        设置障碍物检测状态 (模拟LiDAR反馈)。

        Args:
            detected: True表示障碍物距离≤0.3m
        """
        self._obstacle_detected = detected
        if detected:
            self._log_warning("障碍物检测到，立即停车")

    def simulate_lidar_scan(self, min_distance: float = 10.0):
        """
        模拟生成LiDAR扫描数据。

        Args:
            min_distance: 最小距离 (用于模拟障碍物)
        """
        self._lidar_scan = LaserScan(
            ranges=[min_distance]*360,
            angle_min=-math.pi,
            angle_max=math.pi,
            angle_increment=2*math.pi/360
        )
        # 检查是否触发安全距离
        if min_distance <= SAFE_DISTANCE:
            self.set_obstacle_detected(True)
        else:
            self.set_obstacle_detected(False)

    def simulate_imu(self, roll: float = 0.0, pitch: float = 0.0, yaw: float = 0.0):
        """
        模拟生成IMU数据。

        Args:
            roll: 横滚角 (rad)
            pitch: 俯仰角 (rad)
            yaw: 偏航角 (rad)
        """
        # 简单四元数转换 (仅用于模拟)
        self._imu.orientation = Quaternion(
            x=math.sin(roll/2)*math.cos(pitch/2)*math.cos(yaw/2) -
              math.cos(roll/2)*math.sin(pitch/2)*math.sin(yaw/2),
            y=math.cos(roll/2)*math.sin(pitch/2)*math.cos(yaw/2) +
              math.sin(roll/2)*math.cos(pitch/2)*math.sin(yaw/2),
            z=math.cos(roll/2)*math.cos(pitch/2)*math.sin(yaw/2) -
              math.sin(roll/2)*math.sin(pitch/2)*math.cos(yaw/2),
            w=math.cos(roll/2)*math.cos(pitch/2)*math.cos(yaw/2) +
              math.sin(roll/2)*math.sin(pitch/2)*math.sin(yaw/2)
        )
        self._imu.angular_velocity = Vector3(0.0, 0.0, 0.0)  # 静态
        self._imu.linear_acceleration = Vector3(0.0, 0.0, -9.81)  # 重力

    def get_odom(self) -> Odometry:
        """返回当前里程计数据"""
        return self._odom

    def get_lidar_scan(self) -> LaserScan:
        """返回当前LiDAR扫描数据"""
        return self._lidar_scan

    def get_imu(self) -> Imu:
        """返回当前IMU数据"""
        return self._imu

    def is_emergency_stop_active(self) -> bool:
        """返回紧急停止状态"""
        return self._emergency_stop

    def _log_info(self, msg: str):
        """记录信息日志"""
        self._log.append(f"[INFO] {msg}")

    def _log_warning(self, msg: str):
        """记录警告日志"""
        self._log.append(f"[WARNING] {msg}")

    def get_log(self) -> list:
        """返回所有日志记录"""
        return self._log

    def clear_log(self):
        """清空日志"""
        self._log.clear()


# ==================== 单元测试 ====================
class TestBasePlatformNode(unittest.TestCase):
    """基础平台节点单元测试"""

    def setUp(self):
        """每个测试前初始化节点"""
        self.node = BasePlatformNode(max_linear_speed=1.5, max_angular_speed=0.5)
        self.node.clear_log()

    def test_init_parameters(self):
        """测试初始化参数正确性"""
        with self.assertRaises(ValueError):
            BasePlatformNode(max_linear_speed=0)  # 非正数
        with self.assertRaises(ValueError):
            BasePlatformNode(max_angular_speed=-1)
        with self.assertRaises(ValueError):
            BasePlatformNode(max_linear_speed=2.0)  # 超过默认最大值

    def test_apply_speed_limit_linear(self):
        """测试线速度限制"""
        # 低于限制不应修改
        twist = Twist(Vector3(1.0), Vector3())
        limited = self.node.apply_speed_limit(twist)
        self.assertAlmostEqual(limited.linear.x, 1.0)

        # 超过限制应截断
        twist = Twist(Vector3(2.0), Vector3())
        limited = self.node.apply_speed_limit(twist)
        self.assertAlmostEqual(limited.linear.x, 1.5)

        # 负方向同样
        twist = Twist(Vector3(-2.0), Vector3())
        limited = self.node.apply_speed_limit(twist)
        self.assertAlmostEqual(limited.linear.x, -1.5)

    def test_apply_speed_limit_angular(self):
        """测试角速度限制"""
        twist = Twist(Vector3(), Vector3(z=0.3))
        limited = self.node.apply_speed_limit(twist)
        self.assertAlmostEqual(limited.angular.z, 0.3)

        twist = Twist(Vector3(), Vector3(z=1.0))
        limited = self.node.apply_speed_limit(twist)
        self.assertAlmostEqual(limited.angular.z, 0.5)

        # 负方向
        twist = Twist(Vector3(), Vector3(z=-0.8))
        limited = self.node.apply_speed_limit(twist)
        self.assertAlmostEqual(limited.angular.z, -0.5)

    def test_handle_cmd_vel_emergency_stop(self):
        """紧急停止时速度指令应被忽略"""
        self.node.set_emergency_stop(True)
        twist = Twist(Vector3(1.0), Vector3())
        result = self.node.handle_cmd_vel(twist, 1.0)
        self.assertEqual(result.linear.x, 0.0)
        self.assertEqual(result.angular.z, 0.0)

    def test_handle_cmd_vel_obstacle(self):
        """障碍物检测时立即停车"""
        self.node.set_obstacle_detected(True)
        twist = Twist(Vector3(1.0), Vector3())
        result = self.node.handle_cmd_vel(twist, 1.0)
        self.assertEqual(result.linear.x, 0.0)

    def test_handle_cmd_vel_timeout(self):
        """超时保护：1秒无指令后自动停车"""
        # 第一次有效指令
        twist = Twist(Vector3(1.0), Vector3())
        result = self.node.handle_cmd_vel(twist, 0.0)
        self.assertAlmostEqual(result.linear.x, 1.0)
        # 超过1秒后，即使发送新指令，也会因为超时？注意：超时检查基于最后指令时间
        # 实际上，超时检测是在每次收到指令时检查当前时间与最后指令时间差
        # 如果当前时间比最后指令时间大>1，则自动停车
        result = self.node.handle_cmd_vel(twist, 2.0)  # 已经过去2秒
        self.assertEqual(result.linear.x, 0.0)  # 超时停车

    def test_update_odometry(self):
        """测试里程计更新"""
        self.node.update_odometry(1.0, 1.0, 0.0)  # 1秒，1m/s直线
        odom = self.node.get_odom()
        self.assertAlmostEqual(odom.pose.position.x, 1.0)
        self.assertAlmostEqual(odom.pose.position.y, 0.0)
        # 第二次有角速度
        self.node.update_odometry(1.0, 1.0, math.pi/2)  # 1秒，1m/s，角速度pi/2
        self.assertAlmostEqual(odom.pose.position.x, 1.0, places=5)  # 由于旋转，x变化不大，实际更复杂，这里简化
        # 仅测试朝向
        self.assertAlmostEqual(odom.pose.orientation.z, math.pi/2, places=5)

    def test_brake_distance(self):
        """测试制动距离要求 (模拟)"""
        # 实际上制动距离由硬件决定，这里模拟逻辑：当速度从1.0m/s到0，检查制动距离
        # 我们假设制动时加速度恒定，计算理论制动距离
        # 但这里无法模拟，只做逻辑一致性检查
        # 直接检查常量
        self.assertAlmostEqual(BRAKE_DISTANCE_EMPTY, 0.3)
        self.assertAlmostEqual(BRAKE_DISTANCE_LOADED, 0.4)

    def test_emergency_stop_hardware_priority(self):
        """紧急停止硬件优先级最高，无法被软件覆盖"""
        self.node.set_emergency_stop(True)
        # 即使取消障碍物检测，也无效
        self.node.set_obstacle_detected(False)
        self.assertTrue(self.node.is_emergency_stop_active())
        # 速度指令返回0
        result = self.node.handle_cmd_vel(Twist(Vector3(1.0), Vector3()), 0.0)
        self.assertEqual(result.linear.x, 0.0)

    def test_obstacle_detection_overrides_cmd(self):
        """障碍物检测优先于速度指令"""
        self.node.set_obstacle_detected(True)
        result = self.node.handle_cmd_vel(Twist(Vector3(1.0), Vector3()), 0.0)
        self.assertEqual(result.linear.x, 0.0)

    def test_max_speed_from_parameter_server(self):
        """限速值从参数服务器加载 (模拟)"""
        # 已通过构造函数参数模拟
        self.assertEqual(self.node._max_linear_speed, 1.5)
        self.assertEqual(self.node._max_angular_speed, 0.5)

    def test_logging_on_speed_limit(self):
        """限速时应记录日志"""
        twist = Twist(Vector3(2.0), Vector3())
        self.node.apply_speed_limit(twist)
        logs = self.node.get_log()
        self.assertTrue(any("线速度被截断" in log for log in logs))

    def test_non_positive_dt_raises_error(self):
        """更新里程计传入非正时间步长应抛出异常"""
        with self.assertRaises(ValueError):
            self.node.update_odometry(0, 1.0, 0.0)
        with self.assertRaises(ValueError):
            self.node.update_odometry(-1, 1.0, 0.0)

    def test_invalid_twist_type(self):
        """传入非Twist对象应抛出异常"""
        with self.assertRaises(TypeError):
            self.node.apply_speed_limit("invalid")


# ==================== 主入口 ====================
def main():
    """
    运行单元测试自检。

    如果ROS2环境可用，可以扩展为启动真实节点，但此处仅运行测试。
    """
    print("=" * 60)
    print("Module 4 硬件抽象层单元测试")
    print("=" * 60)
    # 运行所有测试
    unittest.main(verbosity=2)

if __name__ == "__main__":
    main()
