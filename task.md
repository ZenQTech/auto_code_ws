-|
| 感知模块       | 发布/scan（LiDAR）、/imu（IMU）、/odom（编码器里程计）                |
| 定位模块       | 订阅上述传感器话题，融合后发布/odom_combined（位姿，精度≤0.05m）      |
| 规划模块       | 订阅/odom_combined与/scan，发布/cmd_vel（目标速度与角速度）           |
| 控制模块       | 订阅/cmd_vel，通过串口或CAN下发指令至STM32F4，执行闭环控制           |
| 安全模块       | 订阅/scan、/odom_combined、急停信号，必要时发布/emergency_stop        |
| 人机交互模块   | 提供Web UI或ROS命令行接口，显示状态、日志、急停状态                 |
| 基础平台模块   | 硬件初始化、寄存器配置、中断处理、通信协议（UART / I2C / SPI）       |

## 2. 接口契约

### 模块间通信（ROS2话题/服务）
| 主题/服务名         | 类型                       | 发布方         | 订阅方         | 数据格式/说明                                 |
|