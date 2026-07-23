"""
Module 3: Navigation and Obstacle Avoidance Controller
======================================================

This module implements the core navigation and obstacle avoidance control system for an AGV.
It integrates global path planning (A*), local trajectory planning (DWA), motor drive control,
sensor data processing, and safety protection logic.

Key features:
- Global path planning using A* on a static grid map.
- Local path planning using Dynamic Window Approach (DWA) for real-time obstacle avoidance.
- Safety distance monitoring: 0.5m -> decelerate to 0.2 m/s, 0.3m -> emergency stop (manual resume).
- Sensor fault detection (LiDAR/IMU timeout >1s triggers emergency brake).
- Soft speed limits (max linear 1.5 m/s, max angular 0.5 rad/s) enforced via logging and parameter server.
- Emergency stop logic (hardware independent + software topic /emergency_stop).

Requirements:
- ROS Noetic, rospy, numpy, scipy (for A*), unittest.
- Simulation or real robot with /scan, /odom_combined, /imu topics.

Usage:
    python main.py --test   # Run unit tests
    python main.py          # Start ROS node (requires ROS environment)

Author: NAV Team
License: MIT
"""

import rospy
import numpy as np
import math
import heapq
import time
from dataclasses import dataclass, field
from typing import List, Tuple, Optional
from geometry_msgs.msg import Twist, PoseStamped, Pose, Point, Quaternion
from sensor_msgs.msg import LaserScan, Imu
from nav_msgs.msg import Odometry, Path, OccupancyGrid
from std_msgs.msg import Bool, Float64
from tf.transformations import euler_from_quaternion

# =============================================================================
# Data Structures
# =============================================================================

@dataclass
class RobotState:
    """Current robot state (position, orientation, velocities)."""
    x: float = 0.0
    y: float = 0.0
    theta: float = 0.0
    vx: float = 0.0
    vy: float = 0.0
    vtheta: float = 0.0

@dataclass
class TrajectoryPoint:
    """A single point in a trajectory (used in DWA)."""
    x: float
    y: float
    theta: float
    vx: float
    vy: float
    vtheta: float
    time: float

@dataclass
class SafetyConfig:
    """Safety parameters (must be loaded from ROS parameter server)."""
    min_obstacle_distance: float = 0.5       # meters
    emergency_stop_distance: float = 0.3     # meters
    decelerate_speed: float = 0.2            # m/s
    max_linear_speed: float = 1.5            # m/s (software limit)
    max_angular_speed: float = 0.5           # rad/s (software limit)
    sensor_timeout: float = 1.0              # seconds

# =============================================================================
# Global Path Planner (A*)
# =============================================================================

class AStarPlanner:
    """
    A* algorithm for global path planning on a 2D grid occupancy map.
    The map is assumed to be a ROS OccupancyGrid (costmap).
    """

    @staticmethod
    def heuristic(a: Tuple[int, int], b: Tuple[int, int]) -> float:
        """Euclidean distance heuristic."""
        return math.hypot(a[0] - b[0], a[1] - b[1])

    def __init__(self, occupancy_grid: Optional[OccupancyGrid] = None):
        """
        Initialize planner.
        :param occupancy_grid: ROS OccupancyGrid message. If None, a default empty map is created.
        """
        if occupancy_grid is not None:
            self._init_from_grid(occupancy_grid)
        else:
            # Default empty map 10x10, resolution 0.1m, origin at (0,0)
            self.width = 100
            self.height = 100
            self.resolution = 0.1
            self.origin_x = 0.0
            self.origin_y = 0.0
            self.costmap = np.zeros((self.height, self.width), dtype=np.uint8)

    def _init_from_grid(self, grid: OccupancyGrid):
        self.width = grid.info.width
        self.height = grid.info.height
        self.resolution = grid.info.resolution
        self.origin_x = grid.info.origin.position.x
        self.origin_y = grid.info.origin.position.y
        # Convert to 2D numpy array (0=free, 100=occupied, -1=unknown)
        self.costmap = np.array(grid.data).reshape((self.height, self.width))

    def world_to_grid(self, x: float, y: float) -> Tuple[int, int]:
        """Convert world coordinates to grid indices."""
        col = int((x - self.origin_x) / self.resolution)
        row = int((y - self.origin_y) / self.resolution)
        return col, row

    def grid_to_world(self, col: int, row: int) -> Tuple[float, float]:
        """Convert grid indices to world coordinates (center of cell)."""
        x = self.origin_x + (col + 0.5) * self.resolution
        y = self.origin_y + (row + 0.5) * self.resolution
        return x, y

    def plan(self, start: Tuple[float, float], goal: Tuple[float, float]) -> List[Tuple[float, float]]:
        """
        Compute A* path from start to goal in world coordinates.
        :param start: (x, y) starting point.
        :param goal: (x, y) target point.
        :return: List of (x, y) waypoints (world coords). Empty if no path found.
        :raises ValueError: If start or goal is outside map or occupied.
        """
        sx, sy = self.world_to_grid(*start)
        gx, gy = self.world_to_grid(*goal)

        # Check bounds
        if not (0 <= sx < self.width and 0 <= sy < self.height):
            raise ValueError("Start point is outside the map.")
        if not (0 <= gx < self.width and 0 <= gy < self.height):
            raise ValueError("Goal point is outside the map.")
        if self.costmap[sy][sx] > 50:
            raise ValueError("Start cell is occupied.")
        if self.costmap[gy][gx] > 50:
            raise ValueError("Goal cell is occupied.")

        # A* algorithm
        open_set = []
        heapq.heappush(open_set, (0.0, sx, sy))
        came_from = {}
        g_score = { (sx, sy): 0.0 }
        f_score = { (sx, sy): self.heuristic((sx, sy), (gx, gy)) }

        while open_set:
            _, current_x, current_y = heapq.heappop(open_set)
            current = (current_x, current_y)

            if current == (gx, gy):
                # Reconstruct path
                path = []
                while current in came_from:
                    world_x, world_y = self.grid_to_world(*current)
                    path.append((world_x, world_y))
                    current = came_from[current]
                # Add start
                start_world = self.grid_to_world(sx, sy)
                path.append(start_world)
                path.reverse()
                return path

            # Explore neighbors (8-connected)
            for dx, dy in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
                nx, ny = current_x + dx, current_y + dy
                if not (0 <= nx < self.width and 0 <= ny < self.height):
                    continue
                if self.costmap[ny][nx] > 50:  # occupied
                    continue
                tentative_g = g_score[current] + math.hypot(dx, dy)
                neighbor = (nx, ny)
                if neighbor not in g_score or tentative_g < g_score[neighbor]:
                    came_from[neighbor] = current
                    g_score[neighbor] = tentative_g
                    f = tentative_g + self.heuristic(neighbor, (gx, gy))
                    heapq.heappush(open_set, (f, nx, ny))

        # No path found
        return []

# =============================================================================
# Local Planner (DWA - simplified)
# =============================================================================

class DWAPlanner:
    """
    Dynamic Window Approach for local trajectory generation.
    This is a simplified version for demonstration; a full implementation would
    consider dynamics, acceleration limits, and cost evaluation.
    """

    def __init__(self, max_linear: float = 1.5, max_angular: float = 0.5,
                 linear_accel: float = 0.5, angular_accel: float = 0.5,
                 dt: float = 0.1, prediction_horizon: float = 1.0):
        self.max_linear = max_linear
        self.max_angular = max_angular
        self.linear_accel = linear_accel
        self.angular_accel = angular_accel
        self.dt = dt
        self.prediction_horizon = prediction_horizon

    def generate_trajectory(self, state: RobotState, vx: float, vtheta: float,
                            obstacles: List[Tuple[float, float]]) -> Tuple[float, float, float]:
        """
        Evaluate a candidate velocity (vx, vtheta) and return a cost.
        Lower cost = better trajectory.
        This simplified version just checks for collisions and returns a binary cost.
        A real DWA would also consider progress, speed, etc.

        :param state: Current robot state.
        :param vx: Candidate linear velocity (m/s).
        :param vtheta: Candidate angular velocity (rad/s).
        :param obstacles: List of (x, y) positions of nearby obstacles (from LiDAR).
        :return: (cost, vx, vtheta) where cost is infinite if collision predicted.
        """
        # Simulate trajectory for a few steps
        x, y, theta = state.x, state.y, state.theta
        for _ in range(int(self.prediction_horizon / self.dt)):
            x += vx * math.cos(theta) * self.dt
            y += vx * math.sin(theta) * self.dt
            theta += vtheta * self.dt
            # Check collision with any obstacle (simplified: robot radius 0.25m)
            for ox, oy in obstacles:
                if math.hypot(x - ox, y - oy) < 0.3:  # robot radius + margin
                    return (float('inf'), vx, vtheta)
        # Cost = distance to goal (placeholder) + speed penalty (to prefer slow)
        # For simplicity, return a small cost
        return (0.1, vx, vtheta)

    def plan(self, state: RobotState, goal: Tuple[float, float],
             obstacles: List[Tuple[float, float]]) -> Tuple[float, float]:
        """
        Choose the best velocity command from the dynamic window.
        :param state: Current robot state.
        :param goal: (x, y) local goal (from global path).
        :param obstacles: List of obstacle points in world coordinates.
        :return: (vx, vtheta) best velocity command.
        """
        # Dynamic window: possible velocities achievable in one dt
        min_vx = max(0.0, state.vx - self.linear_accel * self.dt)
        max_vx = min(self.max_linear, state.vx + self.linear_accel * self.dt)
        min_vtheta = max(-self.max_angular, state.vtheta - self.angular_accel * self.dt)
        max_vtheta = min(self.max_angular, state.vtheta + self.angular_accel * self.dt)

        # Sample velocities
        best_cost = float('inf')
        best_vx = 0.0
        best_vtheta = 0.0
        for vx in np.linspace(min_vx, max_vx, 5):
            for vtheta in np.linspace(min_vtheta, max_vtheta, 5):
                cost, _, _ = self.generate_trajectory(state, vx, vtheta, obstacles)
                if cost < best_cost:
                    best_cost = cost
                    best_vx = vx
                    best_vtheta = vtheta

        # If no safe trajectory, stop
        if best_cost == float('inf'):
            return (0.0, 0.0)
        return (best_vx, best_vtheta)

# =============================================================================
# Safety Monitor
# =============================================================================

class SafetyMonitor:
    """
    Monitors safety conditions and enforces speed limits, emergency stops.
    This class is independent of the main control loop (hardware interlock assumed).
    It provides software-level checks and publishes /emergency_stop.
    """

    def __init__(self, config: SafetyConfig):
        self.config = config
        self.last_lidar_time = 0.0
        self.last_imu_time = 0.0
        self.emergency_stop_active = False
        self.emergency_stop_pub = rospy.Publisher('/emergency_stop', Bool, queue_size=1, latch=True)
        self.speed_limit_pub = rospy.Publisher('/speed_limit_violation', Float64, queue_size=10)
        rospy.loginfo("SafetyMonitor initialized.")

    def update_lidar(self, msg: LaserScan):
        self.last_lidar_time = rospy.Time.now().to_sec()

    def update_imu(self, msg: Imu):
        self.last_imu_time = rospy.Time.now().to_sec()

    def check_sensor_timeout(self) -> bool:
        """Check if LiDAR or IMU data has timed out. If so, trigger emergency stop."""
        now = rospy.Time.now().to_sec()
        if now - self.last_lidar_time > self.config.sensor_timeout:
            rospy.logerr_throttle(1.0, "LiDAR timeout! Emergency stop triggered.")
            self.activate_emergency_stop()
            return True
        if now - self.last_imu_time > self.config.sensor_timeout:
            rospy.logerr_throttle(1.0, "IMU timeout! Emergency stop triggered.")
            self.activate_emergency_stop()
            return True
        return False

    def check_obstacle_distance(self, min_distance: float) -> Optional[str]:
        """
        Check obstacle distance and return action: 'decelerate', 'stop', or None.
        """
        if min_distance <= self.config.emergency_stop_distance:
            rospy.logwarn_throttle(0.5, f"Obstacle < {self.config.emergency_stop_distance}m: Emergency stop!")
            self.activate_emergency_stop()
            return 'stop'
        elif min_distance <= self.config.min_obstacle_distance:
            rospy.loginfo_throttle(0.5, f"Obstacle < {self.config.min_obstacle_distance}m: Decelerate to {self.config.decelerate_speed}")
            return 'decelerate'
        return None

    def enforce_speed_limit(self, vx: float, vtheta: float) -> Tuple[float, float]:
        """Clamp velocities to soft limits and log violations."""
        if vx > self.config.max_linear_speed:
            rospy.logwarn(f"Linear speed limit violation: {vx} > {self.config.max_linear_speed}, clamped.")
            self.speed_limit_pub.publish(vx)
            vx = self.config.max_linear_speed
        if vtheta > self.config.max_angular_speed:
            rospy.logwarn(f"Angular speed limit violation: {vtheta} > {self.config.max_angular_speed}, clamped.")
            self.speed_limit_pub.publish(vtheta)
            vtheta = self.config.max_angular_speed
        return vx, vtheta

    def activate_emergency_stop(self):
        """Publish emergency stop signal and set flag. Note: manual reset required."""
        if not self.emergency_stop_active:
            rospy.logfatal("EMERGENCY STOP ACTIVATED!")
            self.emergency_stop_pub.publish(Bool(True))
            self.emergency_stop_active = True

    def reset_emergency_stop(self):
        """Reset emergency stop (manual confirmation required)."""
        self.emergency_stop_pub.publish(Bool(False))
        self.emergency_stop_active = False
        rospy.loginfo("Emergency stop reset (manual)")

    def is_emergency_active(self) -> bool:
        return self.emergency_stop_active

# =============================================================================
# Main Controller Node
# =============================================================================

class NavigationController:
    """
    Main ROS node that integrates global planning, local planning, safety, and motor control.
    Subscribes to /scan, /odom_combined, /imu, and goal topic.
    Publishes /cmd_vel and /emergency_stop.
    """

    def __init__(self):
        rospy.init_node('navigation_controller', anonymous=False)

        # Load parameters from ROS parameter server (with defaults)
        self.max_linear_speed = rospy.get_param('~max_linear_speed', 1.5)
        self.max_angular_speed = rospy.get_param('~max_angular_speed', 0.5)
        self.min_obstacle_distance = rospy.get_param('~min_obstacle_distance', 0.5)
        self.emergency_stop_distance = rospy.get_param('~emergency_stop_distance', 0.3)
        self.decelerate_speed = rospy.get_param('~decelerate_speed', 0.2)

        # Safety config
        safety_config = SafetyConfig(
            max_linear_speed=self.max_linear_speed,
            max_angular_speed=self.max_angular_speed,
            min_obstacle_distance=self.min_obstacle_distance,
            emergency_stop_distance=self.emergency_stop_distance,
            decelerate_speed=self.decelerate_speed,
            sensor_timeout=1.0
        )
        self.safety = SafetyMonitor(safety_config)

        # Planners
        self.global_planner = AStarPlanner()  # Will be updated when map received
        self.local_planner = DWAPlanner(max_linear=self.max_linear_speed,
                                        max_angular=self.max_angular_speed)

        # State
        self.robot_state = RobotState()
        self.global_path = []  # List of (x,y)
        self.local_goal_index = 0
        self.obstacle_points = []  # Current LiDAR points in world frame
        self.goal_received = None  # (x,y) world goal

        # Subscribers
        rospy.Subscriber('/scan', LaserScan, self.scan_callback)
        rospy.Subscriber('/odom_combined', Odometry, self.odom_callback)
        rospy.Subscriber('/imu', Imu, self.imu_callback)
        rospy.Subscriber('/move_base_simple/goal', PoseStamped, self.goal_callback)
        # Emergency stop reset (manual)
        rospy.Subscriber('/emergency_stop_reset', Bool, self.reset_emergency_callback)

        # Publishers
        self.cmd_vel_pub = rospy.Publisher('/cmd_vel', Twist, queue_size=1)
        self.global_path_pub = rospy.Publisher('/global_plan', Path, queue_size=1, latch=True)

        # Control loop timer (50 Hz)
        self.control_rate = rospy.Rate(50)
        self.last_control_time = rospy.Time.now().to_sec()

        rospy.loginfo("NavigationController initialized.")

    def scan_callback(self, msg: LaserScan):
        """Process LiDAR scan: convert to world obstacle points."""
        self.safety.update_lidar(msg)
        # Convert polar to Cartesian in robot frame, then transform to world frame
        obstacles = []
        angle = msg.angle_min
        for r in msg.ranges:
            if msg.range_min < r < msg.range_max:
                # Robot frame
                lx = r * math.cos(angle)
                ly = r * math.sin(angle)
                # Transform to world frame (simple rotation + translation)
                wx = self.robot_state.x + lx * math.cos(self.robot_state.theta) - ly * math.sin(self.robot_state.theta)
                wy = self.robot_state.y + lx * math.sin(self.robot_state.theta) + ly * math.cos(self.robot_state.theta)
                obstacles.append((wx, wy))
            angle += msg.angle_increment
        self.obstacle_points = obstacles

        # Compute minimum distance to any obstacle (for safety)
        min_dist = float('inf')
        for ox, oy in obstacles:
            dist = math.hypot(ox - self.robot_state.x, oy - self.robot_state.y)
            if dist < min_dist:
                min_dist = dist
        self.last_min_distance = min_dist

    def odom_callback(self, msg: Odometry):
        """Update robot state from odometry."""
        self.robot_state.x = msg.pose.pose.position.x
        self.robot_state.y = msg.pose.pose.position.y
        orientation = msg.pose.pose.orientation
        _, _, theta = euler_from_quaternion([orientation.x, orientation.y, orientation.z, orientation.w])
        self.robot_state.theta = theta
        self.robot_state.vx = msg.twist.twist.linear.x
        self.robot_state.vy = msg.twist.twist.linear.y
        self.robot_state.vtheta = msg.twist.twist.angular.z

    def imu_callback(self, msg: Imu):
        self.safety.update_imu(msg)

    def goal_callback(self, msg: PoseStamped):
        """Receive new navigation goal."""
        self.goal_received = (msg.pose.position.x, msg.pose.position.y)
        rospy.loginfo(f"New goal received: {self.goal_received}")
        # Replan global path
        self._replan_global_path()

    def reset_emergency_callback(self, msg: Bool):
        if msg.data:
            self.safety.reset_emergency_stop()

    def _replan_global_path(self):
        if self.goal_received is None:
            return
        try:
            start = (self.robot_state.x, self.robot_state.y)
            self.global_path = self.global_planner.plan(start, self.goal_received)
            if not self.global_path:
                rospy.logerr("Global path planning failed (no path found).")
            else:
                self.local_goal_index = 0
                # Publish path for visualization
                path_msg = Path()
                path_msg.header.frame_id = "map"
                path_msg.header.stamp = rospy.Time.now()
                for (x, y) in self.global_path:
                    p = PoseStamped()
                    p.pose.position.x = x
                    p.pose.position.y = y
                    p.pose.orientation.w = 1.0
                    path_msg.poses.append(p)
                self.global_path_pub.publish(path_msg)
                rospy.loginfo(f"Global path planned: {len(self.global_path)} waypoints.")
        except Exception as e:
            rospy.logerr(f"Global planning error: {e}")

    def _get_local_goal(self) -> Optional[Tuple[float, float]]:
        """Get the next waypoint from global path that is far enough (lookahead)."""
        if not self.global_path or self.local_goal_index >= len(self.global_path):
            return None
        # Look for a point at least 0.5m ahead
        target = self.global_path[self.local_goal_index]
        dist = math.hypot(target[0] - self.robot_state.x, target[1] - self.robot_state.y)
        if dist < 0.2:
            self.local_goal_index += 1
            if self.local_goal_index >= len(self.global_path):
                return None
            target = self.global_path[self.local_goal_index]
        return target

    def run(self):
        """Main control loop."""
        rospy.loginfo("Controller loop started.")
        while not rospy.is_shutdown():
            # 1. Safety checks
            if self.safety.is_emergency_active():
                # Send zero velocity and continue
                self.cmd_vel_pub.publish(Twist())
                self.control_rate.sleep()
                continue

            # Sensor timeout check
            if self.safety.check_sensor_timeout():
                continue

            # Obstacle distance check
            min_dist = self.last_min_distance if hasattr(self, 'last_min_distance') else float('inf')
            action = self.safety.check_obstacle_distance(min_dist)

            # 2. Compute desired velocity
            cmd = Twist()
            if action == 'stop':
                cmd.linear.x = 0.0
                cmd.angular.z = 0.0
            elif action == 'decelerate':
                # Use DWA with speed limit = decelerate_speed
                local_goal = self._get_local_goal()
                if local_goal is not None:
                    vx, vtheta = self.local_planner.plan(self.robot_state, local_goal,
                                                         self.obstacle_points)
                    # Clamp to decelerate speed
                    vx = min(vx, self.decelerate_speed)
                    cmd.linear.x = vx
                    cmd.angular.z = vtheta
                else:
                    cmd.linear.x = 0.0
                    cmd.angular.z = 0.0
            else:
                # Normal operation
                local_goal = self._get_local_goal()
                if local_goal is not None:
                    vx, vtheta = self.local_planner.plan(self.robot_state, local_goal,
                                                         self.obstacle_points)
                    cmd.linear.x = vx
                    cmd.angular.z = vtheta
                else:
                    # Reached goal or no path
                    cmd.linear.x = 0.0
                    cmd.angular.z = 0.0
                    if self.goal_received is not None and self.global_path:
                        # Check if close enough to goal
                        dist_to_goal = math.hypot(self.robot_state.x - self.goal_received[0],
                                                  self.robot_state.y - self.goal_received[1])
                        if dist_to_goal < 0.1:
                            rospy.loginfo("Goal reached!")
                            self.goal_received = None
                            self.global_path = []

            # 3. Enforce speed limits
            cmd.linear.x, cmd.angular.z = self.safety.enforce_speed_limit(cmd.linear.x, cmd.angular.z)

            # 4. Publish command
            self.cmd_vel_pub.publish(cmd)

            self.control_rate.sleep()

# =============================================================================
# Unit Tests
# =============================================================================

import unittest
from unittest.mock import MagicMock, patch

class TestAStarPlanner(unittest.TestCase):
    def setUp(self):
        # Create a simple map: 10x10, all free
        self.planner = AStarPlanner()
        self.planner.width = 10
        self.planner.height = 10
        self.planner.resolution = 0.1
        self.planner.origin_x = 0.0
        self.planner.origin_y = 0.0
        self.planner.costmap = np.zeros((10, 10), dtype=np.uint8)

    def test_path_exists(self):
        path = self.planner.plan((0.1, 0.1), (0.9, 0.9))
        self.assertGreater(len(path), 0)
        self.assertAlmostEqual(path[-1][0], 0.9, delta=0.1)
        self.assertAlmostEqual(path[-1][1], 0.9, delta=0.1)

    def test_no_path_obstacle(self):
        # Fill entire map with obstacles
        self.planner.costmap[:, :] = 100
        with self.assertRaises(ValueError):
            self.planner.plan((0.1, 0.1), (0.9, 0.9))

    def test_out_of_map(self):
        with self.assertRaises(ValueError):
            self.planner.plan((100, 100), (0.9, 0.9))

class TestDWAPlanner(unittest.TestCase):
    def setUp(self):
        self.planner = DWAPlanner(max_linear=1.0, max_angular=0.5, linear_accel=0.5, angular_accel=0.5, dt=0.1, prediction_horizon=0.5)

    def test_no_obstacles(self):
        state = RobotState(x=0, y=0, theta=0, vx=0, vy=0, vtheta=0)
        goal = (1.0, 0.0)
        vx, vtheta = self.planner.plan(state, goal, obstacles=[])
        # Should move forward
        self.assertGreater(vx, 0)
        self.assertAlmostEqual(vtheta, 0, delta=0.1)

    def test_obstacle_avoidance(self):
        state = RobotState(x=0, y=0, theta=0, vx=0, vy=0, vtheta=0)
        goal = (0.5, 0.0)
        obstacles = [(0.3, 0.0)]  # directly in front
        vx, vtheta = self.planner.plan(state, goal, obstacles)
        # Should not move forward (or rotate)
        self.assertEqual(vx, 0.0)
        self.assertEqual(vtheta, 0.0)

class TestSafetyMonitor(unittest.TestCase):
    def setUp(self):
        config = SafetyConfig()
        self.safety = SafetyMonitor(config)
        # Mock rospy publishers
        rospy.Publisher = MagicMock()

    def test_speed_limit(self):
        vx, vtheta = self.safety.enforce_speed_limit(2.0, 0.6)
        self.assertAlmostEqual(vx, 1.5)
        self.assertAlmostEqual(vtheta, 0.5)

    def test_emergency_distance(self):
        action = self.safety.check_obstacle_distance(0.2)
        self.assertEqual(action, 'stop')
        self.assertTrue(self.safety.is_emergency_active())

    def test_decelerate_distance(self):
        action = self.safety.check_obstacle_distance(0.4)
        self.assertEqual(action, 'decelerate')
        self.assertFalse(self.safety.is_emergency_active())

if __name__ == '__main__':
    import sys
    if '--test' in sys.argv:
        # Run unit tests
        unittest.main(argv=[sys.argv[0]])
    else:
        try:
            controller = NavigationController()
            controller.run()
        except rospy.ROSInterruptException:
            pass
