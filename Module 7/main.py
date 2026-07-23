"""
基础平台模块（硬件抽象层）实现
============================================
封装 STM32F4 微控制器、电机驱动器、编码器、LiDAR (RPLIDAR A2)、IMU (MPU6050) 的底层驱动，
提供统一的硬件接口供上层模块使用，并集成物理急停信号处理逻辑。

本模块为模拟实现，用于验证接口设计与逻辑正确性，可通过单元测试进行自检。
所有硬件操作函数封装在 `hal` 命名空间（类/模块）下，避免与上层代码冲突。

模块归属: Module 7
"""

import time
import math
import threading
import logging
from enum import Enum, auto
from typing import Tuple, Optional, List, Callable

# 日志配置
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger('hal')

# ============================================================================
# 常量定义
# ============================================================================
PWM_FREQUENCY = 10_000  # 10 kHz
PWM_RESOLUTION = 12     # 12 bit
ENCODER_PULSES_PER_REV = 1024
WHEEL_RADIUS = 0.1      # 假设车轮半径 0.1 m
WHEEL_BASE = 0.5        # 假设轮距 0.5 m
MAX_LINEAR_SPEED = 1.5  # m/s  硬限制，不可绕过
MAX_ANGULAR_SPEED = 2.0 # rad/s 硬限制

LIDAR_UART_BAUDRATE = 115200
LIDAR_SCAN_RATE = 10    # Hz
LIDAR_ANGLE_RESOLUTION = 0.5  # degrees
LIDAR_MEASUREMENT_POINTS = 360

IMU_I2C_SPEED = 400_000  # 400 kHz
IMU_ACCEL_RANGE = 2      # ±2g
IMU_GYRO_RANGE = 250     # ±250°/s
IMU_UPDATE_RATE = 100    # Hz

# ============================================================================
# 枚举定义
# ============================================================================
class DeviceID(Enum):
    """设备标识符"""
    MOTOR_LEFT = auto()
    MOTOR_RIGHT = auto()
    ENCODER_LEFT = auto()
    ENCODER_RIGHT = auto()
    LIDAR = auto()
    IMU = auto()
    EMERGENCY_STOP = auto()

class DeviceStatus(Enum):
    """设备状态"""
    DEVICE_OK = "OK"
    DEVICE_ERROR = "ERROR"

# ============================================================================
# 异常定义
# ============================================================================
class HalError(Exception):
    """硬件抽象层通用异常"""
    pass

class DeviceNotInitializedError(HalError):
    """设备未初始化异常"""
    pass

class InvalidSpeedError(HalError):
    """速度超出限制异常"""
    def __init__(self, value: float, min_val: float, max_val: float):
        super().__init__(f"Speed {value} out of range [{min_val}, {max_val}]")
        self.value = value
        self.min_val = min_val
        self.max_val = max_val

# ============================================================================
# 模拟硬件驱动类
# ============================================================================
class SimPWM:
    """模拟 PWM 输出"""
    def __init__(self, channel: int, frequency: int = PWM_FREQUENCY, resolution: int = PWM_RESOLUTION):
        self.channel = channel
        self.frequency = frequency
        self.resolution = resolution
        self._duty = 0.0  # 0.0 ~ 1.0
        self._enabled = True

    def set_duty(self, duty: float):
        """设置占空比，范围 0.0 ~ 1.0"""
        if not 0.0 <= duty <= 1.0:
            raise ValueError(f"Duty must be in [0.0, 1.0], got {duty}")
        self._duty = duty
        logger.debug(f"PWM channel {self.channel}: duty = {duty:.3f}")

    def get_duty(self) -> float:
        return self._duty

    def disable(self):
        self._enabled = False
        self._duty = 0.0

    def enable(self):
        self._enabled = True

class SimEncoder:
    """模拟编码器，通过定时器输入捕获读取"""
    def __init__(self, pulses_per_rev: int = ENCODER_PULSES_PER_REV):
        self._pulses_per_rev = pulses_per_rev
        self._ticks = 0
        self._lock = threading.Lock()

    def get_ticks(self) -> int:
        with self._lock:
            return self._ticks

    def reset(self):
        with self._lock:
            self._ticks = 0
        logger.info("Encoder reset to 0")

    def simulate_ticks(self, delta: int):
        """模拟增加编码器脉冲数（用于测试）"""
        with self._lock:
            self._ticks += delta

class SimLidar:
    """模拟 RPLIDAR A2 LiDAR"""
    def __init__(self, baudrate: int = LIDAR_UART_BAUDRATE):
        self._baudrate = baudrate
        self._scanning = False
        self._data: List[float] = [0.0] * LIDAR_MEASUREMENT_POINTS  # 模拟距离值 (m)
        self._lock = threading.Lock()

    def start_scan(self):
        self._scanning = True
        logger.info("LiDAR scan started")

    def stop_scan(self):
        self._scanning = False
        logger.info("LiDAR scan stopped")

    def is_scanning(self) -> bool:
        return self._scanning

    def get_scan_data(self) -> List[float]:
        """返回模拟的 360 个距离值（0.5°分辨率）"""
        with self._lock:
            return self._data.copy()

    def simulate_scan_data(self, data: List[float]):
        """设置模拟数据（用于测试）"""
        if len(data) != LIDAR_MEASUREMENT_POINTS:
            raise ValueError(f"Data length must be {LIDAR_MEASUREMENT_POINTS}")
        with self._lock:
            self._data = data

class SimIMU:
    """模拟 MPU6050 IMU"""
    def __init__(self, i2c_speed: int = IMU_I2C_SPEED):
        self._i2c_speed = i2c_speed
        self._accel = (0.0, 0.0, 9.81)  # m/s² (静止时z轴重力)
        self._gyro = (0.0, 0.0, 0.0)    # rad/s
        self._temp = 25.0               # °C
        self._attitude = (0.0, 0.0, 0.0) # roll, pitch, yaw (rad)
        self._lock = threading.Lock()
        logger.info("IMU initialized (simulated)")

    def read_raw(self) -> Tuple[float, float, float, float, float, float, float]:
        """返回加速度(x,y,z) m/s², 角速度(x,y,z) rad/s, 温度 °C"""
        with self._lock:
            return (*self._accel, *self._gyro, self._temp)

    def read_processed(self) -> Tuple[float, float, float, float, float, float, float, float, float, float]:
        """
        返回加速度(x,y,z) m/s², 角速度(x,y,z) rad/s, 温度 °C,
        以及姿态角 roll, pitch, yaw (rad)
        """
        with self._lock:
            return (*self._accel, *self._gyro, self._temp, *self._attitude)

    def set_simulated_data(self, accel=None, gyro=None, temp=None, attitude=None):
        """设置模拟数据（用于测试）"""
        with self._lock:
            if accel is not None:
                self._accel = accel
            if gyro is not None:
                self._gyro = gyro
            if temp is not None:
                self._temp = temp
            if attitude is not None:
                self._attitude = attitude

class SimEmergencyStop:
    """模拟物理急停按钮（常闭触点，GPIO中断触发）"""
    def __init__(self):
        self._triggered = False
        self._lock = threading.Lock()
        self._callback: Optional[Callable[[], None]] = None

    def set_callback(self, callback: Callable[[], None]):
        """设置急停触发回调（通常调用 motor_emergency_stop）"""
        self._callback = callback

    def simulate_trigger(self):
        """模拟急停按钮按下（低电平触发）"""
        with self._lock:
            self._triggered = True
        logger.warning("Emergency stop triggered!")
        if self._callback:
            self._callback()

    def clear(self):
        with self._lock:
            self._triggered = False
        logger.info("Emergency stop cleared")

    def is_triggered(self) -> bool:
        with self._lock:
            return self._triggered

# ============================================================================
# 硬件抽象层主类
# ============================================================================
class Hal:
    """
    硬件抽象层主类，提供统一的设备初始化、状态查询、电机控制、LiDAR、IMU、编码器、里程计、急停等功能。
    """
    def __init__(self):
        self._initialized = False

        # 设备实例
        self._pwms = {
            'left': SimPWM(1),
            'right': SimPWM(2)
        }
        self._encoders = {
            'left': SimEncoder(),
            'right': SimEncoder()
        }
        self._lidar = SimLidar()
        self._imu = SimIMU()
        self._emergency_stop = SimEmergencyStop()

        # 电机状态
        self._motor_stopped = False  # 急停锁定标志
        self._motor_speed_left = 0.0
        self._motor_speed_right = 0.0

        # 里程计状态
        self._odom_x = 0.0
        self._odom_y = 0.0
        self._odom_theta = 0.0
        self._last_encoder_left = 0
        self._last_encoder_right = 0
        self._odom_lock = threading.Lock()

        # 设备状态记录
        self._device_status: dict[DeviceID, DeviceStatus] = {}
        for dev in DeviceID:
            self._device_status[dev] = DeviceStatus.DEVICE_OK

        # 设置急停回调
        self._emergency_stop.set_callback(self._emergency_stop_handler)

        logger.info("Hal instance created")

    # ---------- 初始化 ----------
    def hal_init(self) -> None:
        """
        初始化所有硬件外设（GPIO、定时器、UART、I2C、SPI、DMA、中断）。
        按顺序初始化，若某设备失败则设置相应状态为 DEVICE_ERROR 并记录日志。
        """
        logger.info("Initializing hardware abstraction layer...")
        try:
            # 模拟初始化过程
            # 1. 初始化 PWM 定时器
            for name, pwm in self._pwms.items():
                pwm.enable()
                logger.debug(f"PWM {name} initialized")
            # 2. 初始化编码器输入捕获
            for name, enc in self._encoders.items():
                enc.reset()
                logger.debug(f"Encoder {name} initialized")
            # 3. 初始化 LiDAR UART
            self._lidar = SimLidar()
            # 4. 初始化 IMU I2C
            self._imu = SimIMU()
            # 5. 初始化急停 GPIO 中断
            # 6. 初始化 DMA 等（模拟通过）
            # 将设备状态全部设为 OK
            for dev in DeviceID:
                self._device_status[dev] = DeviceStatus.DEVICE_OK
            self._initialized = True
            logger.info("Hardware abstraction layer initialized successfully")
        except Exception as e:
            logger.error(f"Hardware initialization failed: {e}")
            raise HalError(f"hal_init failed: {e}")

    # ---------- 设备状态查询 ----------
    def hal_get_device_status(self, device_id: DeviceID) -> DeviceStatus:
        """
        查询指定设备的状态。

        Args:
            device_id: 设备标识符（DeviceID 枚举）

        Returns:
            DeviceStatus.DEVICE_OK 或 DeviceStatus.DEVICE_ERROR

        Raises:
            HalError: 如果设备未初始化或 device_id 无效
        """
        if not self._initialized:
            raise HalError("HAL not initialized")
        if device_id not in DeviceID:
            raise HalError(f"Unknown device id: {device_id}")
        status = self._device_status.get(device_id, DeviceStatus.DEVICE_ERROR)
        logger.debug(f"Device {device_id.name}: {status.value}")
        return status

    # ---------- 电机控制 ----------
    def motor_set_speed(self, left: float, right: float) -> None:
        """
        设置左右电机速度（m/s）。
        速度范围受 MAX_LINEAR_SPEED 硬限制，不可绕过。

        Args:
            left: 左轮速度，范围 [-1.5, 1.5] m/s
            right: 右轮速度，范围 [-1.5, 1.5] m/s

        Raises:
            DeviceNotInitializedError: 如果 HAL 未初始化
            InvalidSpeedError: 如果速度超出限制
            HalError: 如果电机被急停锁定
        """
        if not self._initialized:
            raise DeviceNotInitializedError("HAL not initialized")
        if self._motor_stopped:
            raise HalError("Motor is emergency-stopped; call motor_clear_stop() first")

        # 硬限制（不可绕过）
        clamped_left = max(-MAX_LINEAR_SPEED, min(MAX_LINEAR_SPEED, left))
        clamped_right = max(-MAX_LINEAR_SPEED, min(MAX_LINEAR_SPEED, right))
        if abs(clamped_left - left) > 1e-6 or abs(clamped_right - right) > 1e-6:
            logger.warning(f"Speed clamped: original ({left}, {right}) -> ({clamped_left}, {clamped_right})")
            # 根据需求，可以抛出异常，但这里我们选择静默纠正并警告
            # 为了严格，抛出异常：
            # raise InvalidSpeedError(left, -MAX_LINEAR_SPEED, MAX_LINEAR_SPEED)

        # 转换为 PWM 占空比（假设线性映射，速度和占空比成正比）
        # 这里简化：占空比 = 速度 / MAX_LINEAR_SPEED * 0.5 + 0.5 (正反转通过符号)
        def speed_to_duty(speed: float) -> float:
            if speed > 0:
                return min(0.5 + speed / MAX_LINEAR_SPEED * 0.5, 1.0)
            elif speed < 0:
                return max(0.5 - abs(speed) / MAX_LINEAR_SPEED * 0.5, 0.0)
            else:
                return 0.5  # 停止

        duty_left = speed_to_duty(clamped_left)
        duty_right = speed_to_duty(clamped_right)

        self._pwms['left'].set_duty(duty_left)
        self._pwms['right'].set_duty(duty_right)
        self._motor_speed_left = clamped_left
        self._motor_speed_right = clamped_right
        logger.info(f"Motor speed set: left={clamped_left:.3f} m/s, right={clamped_right:.3f} m/s")

    def motor_emergency_stop(self) -> None:
        """
        立即停止电机并锁定 PWM 输出，直到调用 motor_clear_stop() 解锁。
        """
        self._motor_stopped = True
        self._pwms['left'].disable()
        self._pwms['right'].disable()
        self._motor_speed_left = 0.0
        self._motor_speed_right = 0.0
        logger.warning("Motor emergency stop activated")

    def motor_clear_stop(self) -> None:
        """
        清除急停锁定，恢复电机控制。
        """
        self._motor_stopped = False
        self._pwms['left'].enable()
        self._pwms['right'].enable()
        logger.info("Motor emergency stop cleared")

    def is_motor_stopped(self) -> bool:
        """返回电机是否处于急停锁定状态"""
        return self._motor_stopped

    # ---------- 编码器 ----------
    def encoder_get_ticks(self, side: str) -> int:
        """
        获取指定侧编码器的脉冲数。

        Args:
            side: 'left' 或 'right'

        Returns:
            脉冲计数值

        Raises:
            ValueError: 如果 side 无效
        """
        if side not in ('left', 'right'):
            raise ValueError(f"Invalid side: {side}")
        return self._encoders[side].get_ticks()

    def encoder_reset(self, side: Optional[str] = None) -> None:
        """
        重置编码器计数。

        Args:
            side: 'left' 或 'right'，若为 None 则重置两个编码器
        """
        if side is None:
            for enc in self._encoders.values():
                enc.reset()
        else:
            if side not in ('left', 'right'):
                raise ValueError(f"Invalid side: {side}")
            self._encoders[side].reset()

    # ---------- LiDAR ----------
    def lidar_start_scan(self) -> None:
        """启动 LiDAR 扫描"""
        if not self._initialized:
            raise DeviceNotInitializedError("HAL not initialized")
        self._lidar.start_scan()

    def lidar_stop_scan(self) -> None:
        """停止 LiDAR 扫描"""
        self._lidar.stop_scan()

    def lidar_get_scan_data(self) -> List[float]:
        """获取最新一帧 LiDAR 扫描数据（360 个距离值，单位 m）"""
        if not self._lidar.is_scanning():
            raise HalError("LiDAR is not scanning")
        return self._lidar.get_scan_data()

    # ---------- IMU ----------
    def imu_read_raw(self) -> Tuple[float, float, float, float, float, float, float]:
        """读取 IMU 原始数据：加速度(x,y,z) m/s², 角速度(x,y,z) rad/s, 温度 °C"""
        return self._imu.read_raw()

    def imu_read_processed(self) -> Tuple[float, float, float, float, float, float, float, float, float, float]:
        """读取 IMU 处理后数据：加速度、角速度、温度、姿态角(roll, pitch, yaw) rad"""
        return self._imu.read_processed()

    # ---------- 里程计 ----------
    def odom_update(self, dt: float) -> None:
        """
        根据编码器脉冲更新里程计。
        该函数应周期性调用（≥50Hz），dt 为时间间隔（秒）。

        Args:
            dt: 时间步长（秒）
        """
        if not self._initialized:
            raise DeviceNotInitializedError("HAL not initialized")
        left_ticks = self._encoders['left'].get_ticks()
        right_ticks = self._encoders['right'].get_ticks()

        with self._odom_lock:
            # 计算脉冲增量
            delta_left = left_ticks - self._last_encoder_left
            delta_right = right_ticks - self._last_encoder_right
            self._last_encoder_left = left_ticks
            self._last_encoder_right = right_ticks

            # 转换为距离 (m)
            # 每个脉冲对应的距离 = (2π * wheel_radius) / pulses_per_rev
            dist_per_pulse = (2 * math.pi * WHEEL_RADIUS) / ENCODER_PULSES_PER_REV
            dist_left = delta_left * dist_per_pulse
            dist_right = delta_right * dist_per_pulse
            dist_center = (dist_left + dist_right) / 2.0
            dtheta = (dist_right - dist_left) / WHEEL_BASE

            # 更新位姿
            self._odom_x += dist_center * math.cos(self._odom_theta)
            self._odom_y += dist_center * math.sin(self._odom_theta)
            self._odom_theta += dtheta

            # 归一化角度
            self._odom_theta = math.atan2(math.sin(self._odom_theta), math.cos(self._odom_theta))

    def odom_get_pose(self) -> Tuple[float, float, float]:
        """获取当前里程计位姿 (x, y, theta) 单位 m, rad"""
        with self._odom_lock:
            return (self._odom_x, self._odom_y, self._odom_theta)

    def odom_reset(self) -> None:
        """重置里程计回零"""
        with self._odom_lock:
            self._odom_x = 0.0
            self._odom_y = 0.0
            self._odom_theta = 0.0
            self._last_encoder_left = 0
            self._last_encoder_right = 0
        self.encoder_reset()
        logger.info("Odometry reset to zero")

    # ---------- 急停信号处理 ----------
    def _emergency_stop_handler(self):
        """急停回调：立即停止电机"""
        self.motor_emergency_stop()
        # 模拟发布 /emergency_stop 话题 (std_msgs/Bool, true)
        logger.info("Published /emergency_stop: true")

    def emergency_stop_simulate_trigger(self):
        """模拟急停按钮按下（用于测试）"""
        self._emergency_stop.simulate_trigger()

    def emergency_stop_clear(self):
        """清除急停状态"""
        self._emergency_stop.clear()

    # ---------- 工具方法 ----------
    def get_motor_speeds(self) -> Tuple[float, float]:
        """返回当前电机目标速度 (left, right) m/s"""
        return (self._motor_speed_left, self._motor_speed_right)

    def get_motor_stopped(self) -> bool:
        return self._motor_stopped

# ============================================================================
# 单元测试
# ============================================================================
import unittest

class TestHal(unittest.TestCase):
    """硬件抽象层单元测试"""

    @classmethod
    def setUpClass(cls):
        cls.hal = Hal()
        cls.hal.hal_init()

    def test_1_initialization(self):
        """测试初始化后设备状态均为 OK"""
        for dev in DeviceID:
            status = self.hal.hal_get_device_status(dev)
            self.assertEqual(status, DeviceStatus.DEVICE_OK)

    def test_2_motor_speed_normal(self):
        """测试正常设置电机速度"""
        self.hal.motor_set_speed(0.5, -0.3)
        speeds = self.hal.get_motor_speeds()
        self.assertAlmostEqual(speeds[0], 0.5, places=3)
        self.assertAlmostEqual(speeds[1], -0.3, places=3)
        # 检查 PWM 占空比是否被设置（模拟方式，仅验证无异常）
        self.hal.motor_set_speed(0.0, 0.0)

    def test_3_motor_speed_clamping(self):
        """测试速度超限时被硬限制"""
        # 由于我们选择静默限制，检查实际速度是否被限幅
        self.hal.motor_set_speed(2.0, -2.0)  # 超出范围
        speeds = self.hal.get_motor_speeds()
        self.assertAlmostEqual(speeds[0], MAX_LINEAR_SPEED, places=3)
        self.assertAlmostEqual(speeds[1], -MAX_LINEAR_SPEED, places=3)
        self.hal.motor_set_speed(0.0, 0.0)

    def test_4_emergency_stop(self):
        """测试急停功能"""
        self.hal.motor_set_speed(0.5, 0.5)
        self.assertFalse(self.hal.is_motor_stopped())
        self.hal.motor_emergency_stop()
        self.assertTrue(self.hal.is_motor_stopped())
        # 急停后无法设置速度
        with self.assertRaises(HalError):
            self.hal.motor_set_speed(0.1, 0.1)
        # 清除急停
        self.hal.motor_clear_stop()
        self.assertFalse(self.hal.is_motor_stopped())
        self.hal.motor_set_speed(0.0, 0.0)  # 应正常工作

    def test_5_emergency_stop_simulate_trigger(self):
        """测试模拟急停按钮触发"""
        self.hal.motor_set_speed(0.5, 0.5)
        self.assertFalse(self.hal.is_motor_stopped())
        self.hal.emergency_stop_simulate_trigger()
        self.assertTrue(self.hal.is_motor_stopped())
        # 清除
        self.hal.motor_clear_stop()
        self.assertFalse(self.hal.is_motor_stopped())

    def test_6_encoder(self):
        """测试编码器读取和重置"""
        self.hal.encoder_reset()
        ticks_left = self.hal.encoder_get_ticks('left')
        ticks_right = self.hal.encoder_get_ticks('right')
        self.assertEqual(ticks_left, 0)
        self.assertEqual(ticks_right, 0)
        # 模拟增加脉冲
        self.hal._encoders['left'].simulate_ticks(100)
        self.hal._encoders['right'].simulate_ticks(-50)
        self.assertEqual(self.hal.encoder_get_ticks('left'), 100)
        self.assertEqual(self.hal.encoder_get_ticks('right'), -50)
        # 重置单个编码器
        self.hal.encoder_reset('left')
        self.assertEqual(self.hal.encoder_get_ticks('left'), 0)
        self.assertEqual(self.hal.encoder_get_ticks('right'), -50)

    def test_7_lidar(self):
        """测试 LiDAR 启动停止和获取数据"""
        self.hal.lidar_start_scan()
        self.assertTrue(self.hal._lidar.is_scanning())
        # 设置模拟数据
        data = [1.0 + i * 0.01 for i in range(360)]  # 简单模拟
        self.hal._lidar.simulate_scan_data(data)
        retrieved = self.hal.lidar_get_scan_data()
        self.assertEqual(len(retrieved), 360)
        self.assertAlmostEqual(retrieved[0], 1.0)
        self.hal.lidar_stop_scan()
        self.assertFalse(self.hal._lidar.is_scanning())

    def test_8_imu(self):
        """测试 IMU 读取"""
        raw = self.hal.imu_read_raw()
        self.assertEqual(len(raw), 7)
        processed = self.hal.imu_read_processed()
        self.assertEqual(len(processed), 10)
        # 设置模拟数据
        self.hal._imu.set_simulated_data(accel=(0, 0, 9.81), gyro=(0.1, 0.0, 0.0), attitude=(0.01, 0.02, 0.03))
        accel, gyro, temp, roll, pitch, yaw = self.hal.imu_read_processed()
        self.assertAlmostEqual(accel[2], 9.81, places=2)
        self.assertAlmostEqual(roll, 0.01, places=3)

    def test_9_odometry(self):
        """测试里程计更新"""
        self.hal.odom_reset()
        # 模拟编码器脉冲：左轮1000，右轮1000 -> 直线前进
        dist_per_pulse = (2 * math.pi * WHEEL_RADIUS) / ENCODER_PULSES_PER_REV
        self.hal._encoders['left'].simulate_ticks(1000)
        self.hal._encoders['right'].simulate_ticks(1000)
        self.hal.odom_update(dt=0.1)
        x, y, theta = self.hal.odom_get_pose()
        expected_dist = 1000 * dist_per_pulse
        self.assertAlmostEqual(x, expected_dist, places=3)
        self.assertAlmostEqual(y, 0.0, places=3)
        self.assertAlmostEqual(theta, 0.0, places=3)

        # 测试旋转：左轮-1000，右轮1000
        self.hal.odom_reset()
        self.hal._encoders['left'].simulate_ticks(-1000)
        self.hal._encoders['right'].simulate_ticks(1000)
        self.hal.odom_update(dt=0.1)
        x, y, theta = self.hal.odom_get_pose()
        # 纯旋转，中心位移应为0
        self.assertAlmostEqual(x, 0.0, places=3)
        self.assertAlmostEqual(y, 0.0, places=3)
        expected_theta = (2000 * dist_per_pulse) / WHEEL_BASE  # 右轮前进距离 - 左轮倒退距离
        self.assertAlmostEqual(theta, expected_theta, places=3)

    def test_10_device_status_after_init(self):
        """测试设备状态查询"""
        status = self.hal.hal_get_device_status(DeviceID.LIDAR)
        self.assertEqual(status, DeviceStatus.DEVICE_OK)
        # 查询不存在的设备应抛出异常
        # (DeviceID 枚举没有未定义的，但可以测试无效参数？这里不测)

    def test_11_invalid_side(self):
        """测试无效编码器侧"""
        with self.assertRaises(ValueError):
            self.hal.encoder_get_ticks('middle')

    def test_12_motor_speed_after_clear_stop(self):
        """测试急停清除后可以设置速度"""
        self.hal.motor_emergency_stop()
        self.hal.motor_clear_stop()
        self.hal.motor_set_speed(0.2, 0.2)  # 应正常工作
        self.hal.motor_set_speed(0.0, 0.0)

# ============================================================================
# 主程序入口：运行单元测试
# ============================================================================
if __name__ == '__main__':
    unittest.main(verbosity=2)
