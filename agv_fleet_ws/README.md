# AGV Fleet Workspace - README
# Multi-AGV Intelligent Scheduling and Safety Coordination Platform

## Overview

This workspace contains the ROS2 implementation of a multi-AGV intelligent scheduling
and safety coordination platform designed for warehouse automation.

## System Requirements

- Ubuntu 22.04 LTS
- ROS2 Humble Hawksbill
- Gazebo Ignition Fortress (or Garden)
- C++17 compiler (GCC 11+)
- Python 3.10+

## Quick Start

```bash
# 1. Source ROS2
source /opt/ros/humble/setup.bash

# 2. Build the workspace
cd agv_fleet_ws
colcon build --symlink-install

# 3. Source the workspace
source install/setup.bash

# 4. Launch full system (simulation + 5 AGVs)
ros2 launch agv_bringup full_system.launch.py num_agvs:=5
```

## Package Structure

| Package | Type | Description |
|---------|------|-------------|
| `agv_msgs` | Messages | Custom ROS2 message, service, and action definitions |
| `agv_core` | Library | Shared types, constants, and utilities |
| `agv_scheduler` | Node | Central task scheduler |
| `agv_fleet_manager` | Node | Fleet state management |
| `agv_traffic_control` | Node | Traffic control and deadlock resolution |
| `agv_navigation` | Node | Global and local path planning |
| `agv_localization` | Node | Multi-sensor fusion localization |
| `agv_control` | Node | Motion control and odometry |
| `agv_safety` | Node | Safety watchdog and monitor |
| `agv_simulation` | Node | Gazebo simulation worlds and models |
| `agv_api_gateway` | Node | REST API and WebSocket server |
| `agv_visualization` | Node | Rviz2 config and Foxglove bridge |
| `agv_tools` | Scripts | Utility scripts for testing and analysis |

## Launch Files

| Launch File | Description |
|-------------|-------------|
| `simulation.launch.py` | Start Gazebo simulation with warehouse world |
| `agv_single.launch.py` | Launch a single AGV (param: agv_id) |
| `central_server.launch.py` | Start all central server nodes |
| `full_system.launch.py` | Launch everything (sim + central + AGVs) |
| `test_scenario.launch.py` | Launch with predefined test scenarios |

## Documentation

See `docs/` for detailed architecture documentation.
