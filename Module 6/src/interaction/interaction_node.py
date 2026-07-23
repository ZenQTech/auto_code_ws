"""
交互模块主节点 (Module 6)

该节点负责：
- 订阅 /odom_combined, /scan, /cmd_vel, /emergency_stop, /rosout 等话题
- 通过 rosbridge 提供状态信息（实际由 Web 前端直接连接 rosbridge，本节点仅发布日志）
- 提供远程急停/恢复服务调用
- 日志管理，输出到 /interaction/log

性能约束：
- 内存 ≤ 50 MB RSS
- CPU ≤ 20% @ 1.8 GHz ARM Cortex-A72
- 响应延迟 ≤ 200 ms (LAN)
"""

import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from rclpy.executors import MultiThreadedExecutor
from rclpy.callback_groups import ReentrantCallbackGroup
from std_msgs.msg import Bool, String
from geometry_msgs.msg import PoseWithCovarianceStamped, Twist
from sensor_msgs.msg import LaserScan
from rosgraph_msgs.msg import Log
from rcl_interfaces.msg import SetParametersResult
from rclpy.parameter import Parameter
import threading
import time
from typing import Optional

# 自定义消息
from interaction.msg import EmergencyStop  # 需要确保包已构建

class InteractionNode(Node):
    """交互模块主节点，处理所有订阅与状态发布"""

    def __init__(self):
        super().__init__('interaction_node')

        # ---------- 参数配置 ----------
        self.declare_parameter('log_level', 'INFO')
        self.declare_parameter('emergency_stop_timeout', 5.0)  # 急停确认超时秒数
        self._configure_logger()

        # ---------- 状态变量 ----------
        self.current_pose: Optional[PoseWithCovarianceStamped] = None
        self.current_scan: Optional[LaserScan] = None
        self.current_cmd_vel: Optional[Twist] = None
        self.emergency_stop_state: Optional[EmergencyStop] = None
        self.rosout_logs: list = []  # 保存最近100条日志
        self.MAX_LOG_CACHE = 100

        # ---------- 回调组 ----------
        self.cb_group = ReentrantCallbackGroup()

        # ---------- 订阅器 ----------
        # 位姿 (10 Hz)
        self.pose_sub = self.create_subscription(
            PoseWithCovarianceStamped,
            '/odom_combined',
            self.pose_callback,
            QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE),
            callback_group=self.cb_group
        )

        # LiDAR 扫描 (10 Hz)
        self.scan_sub = self.create_subscription(
            LaserScan,
            '/scan',
            self.scan_callback,
            QoSProfile(depth=10, reliability=ReliabilityPolicy.BEST_EFFORT),
            callback_group=self.cb_group
        )

        # 速度指令 (由控制模块发布)
        self.cmd_vel_sub = self.create_subscription(
            Twist,
            '/cmd_vel',
            self.cmd_vel_callback,
            QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE),
            callback_group=self.cb_group
        )

        # 紧急停止状态 (来自安全模块)
        self.emergency_stop_sub = self.create_subscription(
            EmergencyStop,
            '/emergency_stop',
            self.emergency_stop_callback,
            QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE),
            callback_group=self.cb_group
        )

        # ROS 日志 (全局)
        self.rosout_sub = self.create_subscription(
            Log,
            '/rosout',
            self.rosout_callback,
            QoSProfile(depth=100, reliability=ReliabilityPolicy.RELIABLE),
            callback_group=self.cb_group
        )

        # ---------- 服务客户端（用于远程急停/恢复） ----------
        # 安全模块应提供 /emergency_stop_service 和 /emergency_clear_service
        self.emergency_stop_client = self.create_client(
            std_srvs.srv.Trigger,  # 假设使用 Trigger 类型
            '/emergency_stop_service',
            callback_group=self.cb_group
        )
        self.emergency_clear_client = self.create_client(
            std_srvs.srv.Trigger,
            '/emergency_clear_service',
            callback_group=self.cb_group
        )

        # ---------- 日志发布器 ----------
        self.log_pub = self.create_publisher(
            Log,
            '/interaction/log',
            QoSProfile(depth=10, reliability=ReliabilityPolicy.RELIABLE)
        )

        # ---------- 定时器：定期检查连接状态等 ----------
        self.timer = self.create_timer(1.0, self.diag_timer_callback, callback_group=self.cb_group)

        self.get_logger().info('Interaction node started successfully.')

    def _configure_logger(self):
        """根据参数设置日志级别"""
        level_str = self.get_parameter('log_level').value
        levels = {
            'DEBUG': rclpy.logging.LoggingSeverity.DEBUG,
            'INFO': rclpy.logging.LoggingSeverity.INFO,
            'WARN': rclpy.logging.LoggingSeverity.WARN,
            'ERROR': rclpy.logging.LoggingSeverity.ERROR,
            'FATAL': rclpy.logging.LoggingSeverity.FATAL
        }
        if level_str in levels:
            self.get_logger().set_level(levels[level_str])
        else:
            self.get_logger().warn(f'Unknown log level: {level_str}, defaulting to INFO')

    # ---------- 回调函数 ----------
    def pose_callback(self, msg: PoseWithCovarianceStamped):
        """更新位姿"""
        self.current_pose = msg
        self.get_logger().debug(f'Pose updated: x={msg.pose.pose.position.x:.2f}, y={msg.pose.pose.position.y:.2f}')

    def scan_callback(self, msg: LaserScan):
        """更新激光扫描"""
        self.current_scan = msg
        self.get_logger().debug(f'Scan received: {len(msg.ranges)} points')

    def cmd_vel_callback(self, msg: Twist):
        """更新速度指令"""
        self.current_cmd_vel = msg
        self.get_logger().debug(f'Cmd vel: linear={msg.linear.x:.2f}, angular={msg.angular.z:.2f}')

    def emergency_stop_callback(self, msg: EmergencyStop):
        """更新急停状态"""
        self.emergency_stop_state = msg
        if msg.emergency_stop:
            self.get_logger().warn(f'Emergency stop activated! Source: {msg.source}')
        else:
            self.get_logger().info('Emergency stop cleared.')
        # 可在此处触发 UI 更新（通过 rosbridge 订阅本话题即可）

    def rosout_callback(self, msg: Log):
        """缓存最近100条日志"""
        self.rosout_logs.append(msg)
        if len(self.rosout_logs) > self.MAX_LOG_CACHE:
            self.rosout_logs.pop(0)

    # ---------- 服务调用（外部触发） ----------
    def call_emergency_stop(self):
        """远程调用急停服务，返回是否成功"""
        if not self.emergency_stop_client.wait_for_service(timeout_sec=1.0):
            self.get_logger().error('Emergency stop service not available.')
            return False
        request = std_srvs.srv.Trigger.Request()
        future = self.emergency_stop_client.call_async(request)
        # 由于是异步，实际使用中需等待 future 或使用回调
        # 此处简化，在同步调用中等待
        rclpy.spin_until_future_complete(self, future, timeout_sec=2.0)
        if future.result() is not None:
            self.get_logger().info(f'Emergency stop executed: {future.result().success}')
            return future.result().success
        else:
            self.get_logger().error('Emergency stop service call failed.')
            return False

    def call_emergency_clear(self):
        """远程调用恢复服务"""
        if not self.emergency_clear_client.wait_for_service(timeout_sec=1.0):
            self.get_logger().error('Emergency clear service not available.')
            return False
        request = std_srvs.srv.Trigger.Request()
        future = self.emergency_clear_client.call_async(request)
        rclpy.spin_until_future_complete(self, future, timeout_sec=2.0)
        if future.result() is not None:
            self.get_logger().info(f'Emergency clear executed: {future.result().success}')
            return future.result().success
        else:
            self.get_logger().error('Emergency clear service call failed.')
            return False

    # ---------- 诊断定时器 ----------
    def diag_timer_callback(self):
        """定期输出状态摘要（用于调试）"""
        # 仅当日志级别为 DEBUG 时输出
        if self.get_logger().get_effective_level() <= rclpy.logging.LoggingSeverity.DEBUG:
            self.get_logger().debug(f'Diag: pose={self.current_pose is not None}, '
                                    f'scan={self.current_scan is not None}, '
                                    f'cmd_vel={self.current_cmd_vel is not None}, '
                                    f'emergency={self.emergency_stop_state is not None}')

    # ---------- 清理 ----------
    def __del__(self):
        self.get_logger().info('Interaction node shutting down.')


def main(args=None):
    rclpy.init(args=args)
    node = InteractionNode()
    executor = MultiThreadedExecutor()
    executor.add_node(node)
    try:
        executor.spin()
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

# ---------- 单元测试自检 ----------
def test_node_initialization():
    """简单的自检函数，验证节点能否正常创建（需要 ROS 环境）"""
    rclpy.init()
    node = InteractionNode()
    assert node is not None
    assert node.current_pose is None  # 初始应为空
    assert node.current_scan is None
    assert node.emergency_stop_state is None
    node.destroy_node()
    rclpy.shutdown()
    print("Self-test: Node initialization passed.")

if __name__ == '__main__':
    # 如果直接运行，可执行自检（需确保 ROS 环境已初始化）
    # 生产环境请使用 ros2 run
    # test_node_initialization()
    main()
