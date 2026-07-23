"""
# ============================================================
# 后端核心服务 - 机器人高频场景适配校验器
# ============================================================
# 核心作用：对机器人六大高频应用场景的代码进行专项适配校验，
#           自动检测代码所属场景并执行对应的规范校验，
#           确保代码符合各场景的工程化标准与安全约束
# 运行流程：
#   1. 接收待校验的代码路径（code_path）
#   2. 自动检测代码所属的机器人场景类型
#   3. 根据检测到的场景类型执行对应的专项校验：
#      a. 机械臂操作场景：MoveIt! 配置、关节限位、运动规划、急停接口
#      b. SLAM 导航场景：导航插件接口、costmap/行为树/控制器规范、传感器适配
#      c. 视觉感知场景：cv_bridge 使用、标准消息类型、节点异常处理
#      d. 运动控制场景：分层控制架构、运动学/动力学解算、步态控制、安全与实时性
#      e. 强化学习场景：算法工程分离、模型推理规范、安全约束、可复现性
#      f. 自动驾驶场景：分层架构、感知定位、决策规划、运动控制、安全冗余
#   4. 汇总校验结果，返回完整报告
# 输入参数：
#   - code_path: str，待校验的代码文件或目录路径
# 输出结果：SceneValidationReport 对象，包含场景类型、校验结果、问题列表
# 修改记录：
#   版本 1.0.0 | 2026-06-24 | 初始创建，实现六大机器人场景专项校验
#   版本 1.0.1 | 2026-06-24 | 修复 full_validate 中 detected_scene 字段类型错误（字符串→枚举）
# ============================================================
"""

import logging
import os
import re
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from backend.app.config import settings

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class SceneType(str, Enum):
    """
    机器人场景类型枚举
    取值：
      - MANIPULATOR: 机械臂操作场景（MoveIt! 运动规划）
      - SLAM_NAVIGATION: SLAM 与自主导航场景
      - VISION_PERCEPTION: 视觉感知场景
      - MOTION_CONTROL: 运动控制场景（足式/轮式机器人）
      - REINFORCEMENT_LEARNING: 强化学习场景
      - AUTONOMOUS_DRIVING: 自动驾驶场景
      - UNKNOWN: 无法识别的场景类型
    """
    MANIPULATOR = "manipulator"
    SLAM_NAVIGATION = "slam_navigation"
    VISION_PERCEPTION = "vision_perception"
    MOTION_CONTROL = "motion_control"
    REINFORCEMENT_LEARNING = "reinforcement_learning"
    AUTONOMOUS_DRIVING = "autonomous_driving"
    UNKNOWN = "unknown"


class ValidationSeverity(str, Enum):
    """校验严重程度枚举"""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class SceneViolation:
    """
    场景校验违规记录
    字段说明：
      - severity: 严重程度（error/warning/info）
      - category: 违规类别（如 joint_limits / motion_planning / emergency_stop）
      - description: 违规描述
      - location: 违规位置（文件路径:行号）
      - suggestion: 修复建议
    """
    severity: ValidationSeverity = ValidationSeverity.WARNING
    category: str = ""
    description: str = ""
    location: str = ""
    suggestion: str = ""


@dataclass
class SceneValidationReport:
    """
    场景校验综合报告
    字段说明：
      - code_path: 被校验的代码路径
      - detected_scene: 检测到的场景类型
      - scene_confidence: 场景检测置信度（0.0-1.0）
      - violations: 所有违规记录列表
      - overall_score: 综合评分（0-100）
      - summary: 校验摘要
      - passed: 是否通过校验
    """
    code_path: str = ""
    detected_scene: str = ""
    scene_confidence: float = 0.0
    violations: List[SceneViolation] = field(default_factory=list)
    overall_score: float = 100.0
    summary: str = ""
    passed: bool = True


# ============================================================
# 机器人高频场景适配校验器
# ============================================================

class RobotSceneValidator:
    """
    机器人高频场景适配校验器
    作用：自动检测代码所属的机器人场景，并执行对应的专项规范校验
    调用方：任务执行引擎、代码审查模块
    被调用方：文件系统（读取代码文件）
    """

    # ----------------------------------------------------------
    # 场景检测关键词映射（类属性，所有实例共享）
    # ----------------------------------------------------------
    # 每个场景对应一组关键词，用于自动检测代码所属场景
    SCENE_KEYWORDS: Dict[SceneType, List[str]] = {
        SceneType.MANIPULATOR: [
            "moveit", "move_group", "planning_scene", "robot_model",
            "joint_trajectory", "gripper", "manipulator", "end_effector",
            "ik_solver", "kinematics", "trajectory_execution",
            "planning_pipeline", "ompl", "chomp", "stomp",
            "follow_joint_trajectory", "grasp", "pick_and_place",
            "moveit_cpp", "move_group_interface",
        ],
        SceneType.SLAM_NAVIGATION: [
            "slam", "gmapping", "cartographer", "hector_slam",
            "amcl", "localization", "nav2", "navigation",
            "costmap", "planner", "controller", "behavior_tree",
            "global_planner", "local_planner", "dwa", "teb",
            "navfn", "map_server", "odometry", "tf2",
            "sensor_fusion", "ekf", "ukf", "robot_localization",
        ],
        SceneType.VISION_PERCEPTION: [
            "cv_bridge", "opencv", "cv::", "image_transport",
            "camera_info", "point_cloud", "pcl", "depth_image",
            "object_detection", "yolo", "segmentation", "tracking",
            "feature_extraction", "stereo", "rgbd", "realsense",
            "image_pipeline", "vision", "perception",
        ],
        SceneType.MOTION_CONTROL: [
            "motion_control", "gait", "walking", "trot", "bound",
            "inverse_kinematics", "forward_kinematics", "jacobian",
            "dynamics", "torque", "impedance_control", "admittance",
            "pid", "mpc", "lqr", "trajectory_tracking",
            "foot_planner", "swing", "stance", "com",
            "zero_moment_point", "zmp", "capture_point",
            "whole_body_control", "wbc", "task_space",
        ],
        SceneType.REINFORCEMENT_LEARNING: [
            "reinforcement_learning", "rl", "policy", "agent",
            "environment", "reward", "state_space", "action_space",
            "gym", "gymnasium", "stable_baselines", "sb3",
            "ppo", "sac", "td3", "ddpg", "dqn",
            "model_inference", "onnx", "tensorrt", "torch.jit",
            "domain_randomization", "sim_to_real", "curriculum",
            "checkpoint", "episode", "rollout",
        ],
        SceneType.AUTONOMOUS_DRIVING: [
            "autonomous_driving", "self_driving", "autoware",
            "lane_detection", "traffic_light", "obstacle",
            "path_planning", "behavior_planner", "motion_planner",
            "pure_pursuit", "stanley", "lattice_planner",
            "sensor_fusion", "lidar", "radar", "camera",
            "can_bus", "drive_by_wire", "steering", "throttle",
            "safety_monitor", "redundancy", "fail_safe",
        ],
    }

    # ----------------------------------------------------------
    # 各场景的必须文件/目录检查项
    # ----------------------------------------------------------
    SCENE_REQUIRED_PATTERNS: Dict[SceneType, List[Dict[str, Any]]] = {
        SceneType.MANIPULATOR: [
            {"name": "MoveIt 配置包", "pattern": r"moveit_config|config.*moveit", "required": True},
            {"name": "SRDF 文件", "pattern": r"\.srdf", "required": True},
            {"name": "关节限位配置", "pattern": r"joint_limits|joint_limit", "required": True},
            {"name": "运动规划接口", "pattern": r"planning_pipeline|ompl_planning", "required": True},
        ],
        SceneType.SLAM_NAVIGATION: [
            {"name": "导航参数配置", "pattern": r"nav2_params|navigation.*yaml|costmap.*yaml", "required": True},
            {"name": "行为树配置", "pattern": r"behavior_tree|bt_navigator", "required": True},
            {"name": "控制器插件", "pattern": r"controller_server|planner_server", "required": True},
        ],
        SceneType.VISION_PERCEPTION: [
            {"name": "cv_bridge 使用", "pattern": r"cv_bridge|CvBridge|bridge\.imgmsg_to_cv2", "required": True},
            {"name": "标准消息类型", "pattern": r"sensor_msgs/Image|sensor_msgs/PointCloud2", "required": True},
        ],
        SceneType.MOTION_CONTROL: [
            {"name": "运动学解算", "pattern": r"inverse_kinematics|forward_kinematics|jacobian", "required": True},
            {"name": "安全限幅", "pattern": r"clamp|limit|saturate|max.*torque|max.*velocity", "required": True},
        ],
        SceneType.REINFORCEMENT_LEARNING: [
            {"name": "算法与工程分离", "pattern": r"class.*Env|class.*Policy|class.*Agent", "required": True},
            {"name": "模型推理接口", "pattern": r"predict|inference|forward|onnx|torch\.jit", "required": True},
        ],
        SceneType.AUTONOMOUS_DRIVING: [
            {"name": "分层架构", "pattern": r"perception|planning|control|localization", "required": True},
            {"name": "安全冗余", "pattern": r"safety|redundancy|fail.?safe|monitor", "required": True},
        ],
    }

    def __init__(self):
        """
        初始化机器人场景校验器
        运行步骤：
          1. 从全局配置读取安全相关配置
          2. 初始化日志记录器
        """
        self._security_config = settings.security
        self._max_review_iterations = self._security_config.get(
            "max_review_iterations", 3
        )
        logger.info(
            f"机器人场景校验器初始化完成，"
            f"支持 {len(self.SCENE_KEYWORDS)} 种场景类型"
        )

    # ==========================================================
    # 场景自动检测
    # ==========================================================

    def detect_scene_type(self, code_path: str) -> Tuple[SceneType, float]:
        """
        自动检测代码所属的机器人场景类型
        运行步骤：
          1. 收集代码路径下所有源文件内容
          2. 对每种场景的关键词进行匹配计数
          3. 选择匹配数最多的场景作为检测结果
          4. 计算置信度（最高匹配场景的匹配数 / 总匹配数）
        参数：
          - code_path: 代码文件或目录路径
        返回值：(SceneType, 置信度) 元组
        """
        if not code_path or not os.path.exists(code_path):
            logger.warning(f"代码路径不存在: {code_path}")
            return SceneType.UNKNOWN, 0.0

        # 收集所有代码内容
        code_content = self._collect_code_content(code_path)
        if not code_content:
            logger.warning(f"未找到可分析的代码文件: {code_path}")
            return SceneType.UNKNOWN, 0.0

        # 统计每种场景的关键词匹配数
        content_lower = code_content.lower()
        scene_scores: Dict[SceneType, int] = {}

        for scene_type, keywords in self.SCENE_KEYWORDS.items():
            match_count = 0
            for keyword in keywords:
                # 对每个关键词进行不区分大小写的匹配
                if keyword.lower() in content_lower:
                    match_count += 1
            scene_scores[scene_type] = match_count

        # 找到匹配数最多的场景
        if not scene_scores:
            return SceneType.UNKNOWN, 0.0

        best_scene = max(scene_scores, key=lambda k: scene_scores[k])
        best_count = scene_scores[best_scene]
        total_matches = sum(scene_scores.values())

        # 计算置信度
        if best_count == 0:
            confidence = 0.0
        elif total_matches > 0:
            confidence = best_count / total_matches
        else:
            confidence = 0.0

        # 置信度低于 0.3 时标记为 UNKNOWN
        if confidence < 0.3:
            logger.info(
                f"场景检测置信度过低 ({confidence:.2f})，标记为 UNKNOWN"
            )
            return SceneType.UNKNOWN, confidence

        logger.info(
            f"检测到场景类型: {best_scene.value}，"
            f"置信度: {confidence:.2f}，"
            f"匹配关键词数: {best_count}"
        )
        return best_scene, confidence

    def _collect_code_content(self, code_path: str) -> str:
        """
        收集代码路径下的所有源代码内容
        运行步骤：
          1. 判断路径是文件还是目录
          2. 如果是文件，直接读取
          3. 如果是目录，递归收集所有源代码文件
          4. 拼接所有文件内容
        参数：
          - code_path: 代码路径
        返回值：拼接后的代码内容字符串
        """
        extensions = {".py", ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx",
                      ".yaml", ".yml", ".xml", ".launch", ".srdf", ".urdf", ".xacro"}

        if os.path.isfile(code_path):
            try:
                with open(code_path, "r", encoding="utf-8", errors="ignore") as f:
                    return f.read()
            except Exception as e:
                logger.warning(f"读取文件失败 {code_path}: {e}")
                return ""

        contents: List[str] = []
        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel", "node_modules"}

        try:
            for root, dirs, files in os.walk(code_path):
                dirs[:] = [d for d in dirs if d not in skip_dirs and not d.startswith(".")]
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in extensions:
                        file_path = os.path.join(root, f)
                        try:
                            with open(file_path, "r", encoding="utf-8", errors="ignore") as fh:
                                contents.append(fh.read())
                        except Exception as e:
                            logger.debug(f"读取文件失败 {file_path}: {e}")
        except Exception as e:
            logger.error(f"收集代码内容失败: {e}")

        return "\n".join(contents)

    # ==========================================================
    # 综合校验入口
    # ==========================================================

    def full_validate(self, code_path: str) -> SceneValidationReport:
        """
        自动检测场景并执行对应的完整校验
        运行步骤：
          1. 自动检测代码所属场景类型
          2. 根据场景类型调用对应的专项校验方法
          3. 汇总校验结果
          4. 计算综合评分
        参数：
          - code_path: 代码文件或目录路径
        返回值：SceneValidationReport 对象
        """
        # 步骤 1：检测场景类型
        scene_type, confidence = self.detect_scene_type(code_path)

        if scene_type == SceneType.UNKNOWN:
            return SceneValidationReport(
                code_path=code_path,
                detected_scene=SceneType.UNKNOWN,
                scene_confidence=confidence,
                violations=[
                    SceneViolation(
                        severity=ValidationSeverity.WARNING,
                        category="scene_detection",
                        description="无法识别代码所属的机器人场景类型",
                        location=code_path,
                        suggestion="请确认代码路径正确，或手动指定场景类型",
                    )
                ],
                overall_score=50.0,
                summary="无法识别机器人场景类型，无法执行专项校验",
                passed=False,
            )

        # 步骤 2：根据场景类型执行专项校验
        validate_methods = {
            SceneType.MANIPULATOR: self.validate_manipulator_moveit,
            SceneType.SLAM_NAVIGATION: self.validate_slam_navigation,
            SceneType.VISION_PERCEPTION: self.validate_vision_perception,
            SceneType.MOTION_CONTROL: self.validate_motion_control,
            SceneType.REINFORCEMENT_LEARNING: self.validate_reinforcement_learning,
            SceneType.AUTONOMOUS_DRIVING: self.validate_autonomous_driving,
        }

        validate_func = validate_methods.get(scene_type)
        if validate_func is None:
            return SceneValidationReport(
                code_path=code_path,
                detected_scene=scene_type,
                scene_confidence=confidence,
                overall_score=0.0,
                summary=f"场景类型 '{scene_type.value}' 暂无对应的校验方法",
                passed=False,
            )

        # 步骤 3：执行校验
        violations = validate_func(code_path)

        # 步骤 4：计算评分
        error_count = sum(1 for v in violations if v.severity == ValidationSeverity.ERROR)
        warning_count = sum(1 for v in violations if v.severity == ValidationSeverity.WARNING)
        info_count = sum(1 for v in violations if v.severity == ValidationSeverity.INFO)

        # 评分计算：基础分 100，每个 error 扣 15 分，每个 warning 扣 5 分，每个 info 扣 1 分
        overall_score = max(0.0, 100.0 - error_count * 15.0 - warning_count * 5.0 - info_count * 1.0)
        passed = error_count == 0

        scene_names = {
            SceneType.MANIPULATOR: "机械臂操作",
            SceneType.SLAM_NAVIGATION: "SLAM 导航",
            SceneType.VISION_PERCEPTION: "视觉感知",
            SceneType.MOTION_CONTROL: "运动控制",
            SceneType.REINFORCEMENT_LEARNING: "强化学习",
            SceneType.AUTONOMOUS_DRIVING: "自动驾驶",
        }
        scene_display = scene_names.get(scene_type, scene_type.value)

        return SceneValidationReport(
            code_path=code_path,
            detected_scene=scene_type,
            scene_confidence=confidence,
            violations=violations,
            overall_score=overall_score,
            summary=(
                f"【{scene_display}】场景校验{'通过' if passed else '未通过'}，"
                f"综合评分: {overall_score:.1f}，"
                f"错误: {error_count}，警告: {warning_count}，信息: {info_count}"
            ),
            passed=passed,
        )

    # ==========================================================
    # 场景一：机械臂操作场景校验（MoveIt!）
    # ==========================================================

    def validate_manipulator_moveit(self, code_path: str) -> List[SceneViolation]:
        """
        校验机械臂操作场景的 MoveIt! 配置与接口规范
        运行步骤：
          1. 检查 MoveIt! 配置包结构完整性
          2. 检查关节限位与安全约束配置
          3. 检查运动规划接口使用规范
          4. 检查急停接口实现
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []
        code_content = self._collect_code_content(code_path)

        # ---- 子校验 1：MoveIt! 配置包结构 ----
        violations.extend(self._check_moveit_config_structure(code_path))

        # ---- 子校验 2：关节限位与安全约束 ----
        violations.extend(self._check_joint_limits_safety(code_content, code_path))

        # ---- 子校验 3：运动规划接口规范 ----
        violations.extend(self._check_motion_planning_interface(code_content, code_path))

        # ---- 子校验 4：急停接口 ----
        violations.extend(self._check_emergency_stop_interface(code_content, code_path))

        return violations

    def _check_moveit_config_structure(
        self, code_path: str
    ) -> List[SceneViolation]:
        """
        检查 MoveIt! 配置包结构完整性
        运行步骤：
          1. 检查是否存在 config 目录
          2. 检查是否存在 SRDF 文件（语义机器人描述格式）
          3. 检查是否存在 joint_limits.yaml
          4. 检查是否存在 kinematics.yaml
          5. 检查是否存在 ompl_planning.yaml
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # MoveIt! 配置包必须包含的关键文件
        required_config_files = [
            ("joint_limits.yaml", "关节限位配置文件"),
            ("kinematics.yaml", "运动学求解器配置文件"),
            ("ompl_planning.yaml", "OMPL 运动规划器配置文件"),
        ]

        # 在代码路径中递归查找 config 目录
        config_dir = None
        if os.path.isdir(code_path):
            for root, dirs, _ in os.walk(code_path):
                if os.path.basename(root) == "config":
                    config_dir = root
                    break

        if config_dir:
            for filename, description in required_config_files:
                file_path = os.path.join(config_dir, filename)
                if not os.path.isfile(file_path):
                    violations.append(SceneViolation(
                        severity=ValidationSeverity.WARNING,
                        category="moveit_config",
                        description=f"MoveIt! 配置包缺少 {description}: {filename}",
                        location=config_dir,
                        suggestion=f"请在 config 目录下创建 {filename} 配置文件",
                    ))
        else:
            # 检查代码内容中是否引用了这些配置
            for filename, description in required_config_files:
                if filename not in code_path and filename.replace(".yaml", "") not in code_path:
                    violations.append(SceneViolation(
                        severity=ValidationSeverity.WARNING,
                        category="moveit_config",
                        description=f"未找到 {description}: {filename}",
                        location=code_path,
                        suggestion=f"请确保 MoveIt! 配置包包含 {filename}",
                    ))

        # 检查 SRDF 文件
        has_srdf = False
        if os.path.isdir(code_path):
            for root, _, files in os.walk(code_path):
                for f in files:
                    if f.endswith(".srdf"):
                        has_srdf = True
                        break
                if has_srdf:
                    break

        if not has_srdf:
            # 检查代码内容中是否引用了 SRDF
            if ".srdf" not in code_path and "srdf" not in code_path.lower():
                violations.append(SceneViolation(
                    severity=ValidationSeverity.ERROR,
                    category="moveit_config",
                    description="未找到 SRDF（语义机器人描述格式）文件",
                    location=code_path,
                    suggestion="MoveIt! 配置包必须包含 .srdf 文件，定义规划组和位姿",
                ))

        return violations

    def _check_joint_limits_safety(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查关节限位与安全约束配置
        运行步骤：
          1. 检测是否配置了关节位置限位
          2. 检测是否配置了关节速度限位
          3. 检测是否配置了关节加速度限位
          4. 检测是否配置了关节力矩限位
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测关节限位配置关键词
        has_position_limits = bool(re.search(
            r'joint_limits|joint_limit|position_limit|max_position|min_position',
            code_content, re.IGNORECASE,
        ))
        has_velocity_limits = bool(re.search(
            r'max_velocity|velocity_limit|velocity_scaling|max_vel',
            code_content, re.IGNORECASE,
        ))
        has_acceleration_limits = bool(re.search(
            r'max_acceleration|acceleration_limit|acceleration_scaling|max_acc',
            code_content, re.IGNORECASE,
        ))
        has_effort_limits = bool(re.search(
            r'max_effort|effort_limit|torque_limit|max_torque',
            code_content, re.IGNORECASE,
        ))

        if not has_position_limits:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="joint_limits",
                description="未配置关节位置限位（position limits）",
                location=code_path,
                suggestion="请在 joint_limits.yaml 中为每个关节配置 min_position 和 max_position",
            ))

        if not has_velocity_limits:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="joint_limits",
                description="未配置关节速度限位（velocity limits）",
                location=code_path,
                suggestion="请在 joint_limits.yaml 中为每个关节配置 max_velocity",
            ))

        if not has_acceleration_limits:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="joint_limits",
                description="未配置关节加速度限位（acceleration limits）",
                location=code_path,
                suggestion="建议在 joint_limits.yaml 中为每个关节配置 max_acceleration",
            ))

        if not has_effort_limits:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="joint_limits",
                description="未配置关节力矩/力限位（effort limits）",
                location=code_path,
                suggestion="请在 joint_limits.yaml 中为每个关节配置 max_effort",
            ))

        return violations

    def _check_motion_planning_interface(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查运动规划接口使用规范
        运行步骤：
          1. 检测是否使用了 MoveGroupInterface（C++）或 MoveGroupCommander（Python）
          2. 检测规划前是否设置了起始状态
          3. 检测是否添加了规划场景碰撞对象
          4. 检测规划结果是否进行了校验
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测是否使用了 MoveIt! 运动规划接口
        has_move_group = bool(re.search(
            r'MoveGroupInterface|MoveGroupCommander|move_group',
            code_content,
        ))

        if not has_move_group:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="motion_planning",
                description="未检测到 MoveIt! 运动规划接口（MoveGroupInterface/MoveGroupCommander）",
                location=code_path,
                suggestion="请使用 MoveIt! 官方运动规划接口进行运动规划",
            ))
            return violations

        # 检测规划前是否设置了起始状态
        has_start_state = bool(re.search(
            r'setStartState|start_state|setJointValueTarget|setPoseTarget',
            code_content,
        ))
        if not has_start_state:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="motion_planning",
                description="运动规划前未显式设置起始状态",
                location=code_path,
                suggestion="请在调用 plan() 前使用 setStartState() 或 setStartStateToCurrentState()",
            ))

        # 检测规划结果校验
        has_plan_validation = bool(re.search(
            r'plan\s*\.\s*trajectory|plan\s*\.\s*joint_trajectory|'
            r'plan\s*\[.*\]\s*\.\s*trajectory|moveit::planning_interface::MoveGroupInterface::Plan',
            code_content,
        ))
        # 检测 execute 前的校验
        has_execute_check = bool(re.search(
            r'if\s*\(.*success|if\s+.*plan|execute\s*\(.*plan',
            code_content,
        ))

        if not has_execute_check and has_move_group:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="motion_planning",
                description="运动规划执行前未校验规划结果是否成功",
                location=code_path,
                suggestion="请在 execute(plan) 前检查 plan 的有效性，确保规划成功后再执行",
            ))

        return violations

    def _check_emergency_stop_interface(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查急停接口实现
        运行步骤：
          1. 检测是否有急停/停止运动的相关接口
          2. 检测是否有异常情况下的安全停止逻辑
          3. 检测是否有轨迹执行中断机制
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测急停相关关键词
        has_emergency_stop = bool(re.search(
            r'emergency_stop|e_stop|stop\(\)|halt|abort|'
            r'cancelAllGoals|cancel_all_goals|clearPoseTargets',
            code_content, re.IGNORECASE,
        ))

        if not has_emergency_stop:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="emergency_stop",
                description="未检测到急停/停止运动接口",
                location=code_path,
                suggestion="机械臂控制代码必须实现急停逻辑，包括 stop()/halt()/abort() 等接口",
            ))

        # 检测是否有异常处理保护
        has_exception_handling = bool(re.search(
            r'try\s*[:\{]|catch\s*\(|except\s+\w+',
            code_content,
        ))
        if not has_exception_handling:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="emergency_stop",
                description="运动控制代码缺少异常处理保护",
                location=code_path,
                suggestion="请为运动规划执行添加 try-catch/except 异常保护",
            ))

        return violations

    # ==========================================================
    # 场景二：SLAM 导航场景校验
    # ==========================================================

    def validate_slam_navigation(self, code_path: str) -> List[SceneViolation]:
        """
        校验 SLAM 导航场景的插件接口与配置规范
        运行步骤：
          1. 检查导航插件接口标准符合性
          2. 检查 costmap / 行为树 / 控制器插件规范
          3. 检查传感器数据适配
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []
        code_content = self._collect_code_content(code_path)

        # ---- 子校验 1：导航插件接口标准 ----
        violations.extend(self._check_nav_plugin_interfaces(code_content, code_path))

        # ---- 子校验 2：costmap / 行为树 / 控制器规范 ----
        violations.extend(self._check_costmap_bt_controller(code_content, code_path))

        # ---- 子校验 3：传感器数据适配 ----
        violations.extend(self._check_sensor_data_adaptation(code_content, code_path))

        return violations

    def _check_nav_plugin_interfaces(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查导航插件接口标准符合性
        运行步骤：
          1. 检测是否继承或实现了 nav2_core 标准插件接口
          2. 检测插件是否使用 pluginlib 注册
          3. 检测是否配置了 plugin 描述文件
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测是否使用了 nav2_core 标准接口
        has_nav2_core = bool(re.search(
            r'nav2_core|nav2_util|nav2_msgs',
            code_content,
        ))

        # 检测插件注册
        has_plugin_register = bool(re.search(
            r'PLUGINLIB_EXPORT_CLASS|pluginlib_export|register_plugin',
            code_content,
        ))

        if has_nav2_core and not has_plugin_register:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="nav_plugin",
                description="使用了 nav2_core 接口但未检测到 pluginlib 插件注册",
                location=code_path,
                suggestion="请使用 PLUGINLIB_EXPORT_CLASS 宏注册导航插件",
            ))

        # 检测插件描述文件
        has_plugin_xml = False
        if os.path.isdir(code_path):
            for root, _, files in os.walk(code_path):
                for f in files:
                    if f.endswith("_plugin.xml") or f == "plugins.xml":
                        has_plugin_xml = True
                        break
                if has_plugin_xml:
                    break

        if has_nav2_core and not has_plugin_xml:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="nav_plugin",
                description="未找到导航插件描述文件（plugins.xml）",
                location=code_path,
                suggestion="请创建 plugins.xml 文件描述导航插件，并在 package.xml 中通过 export 标签导出",
            ))

        return violations

    def _check_costmap_bt_controller(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查 costmap / 行为树 / 控制器插件规范
        运行步骤：
          1. 检测 costmap 配置是否包含必要的图层
          2. 检测行为树配置是否完整
          3. 检测控制器插件是否配置了必要的参数
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测 costmap 配置
        has_costmap_config = bool(re.search(
            r'costmap|inflation_layer|obstacle_layer|static_layer|voxel_layer',
            code_content, re.IGNORECASE,
        ))

        if has_costmap_config:
            # 检查是否配置了膨胀层
            has_inflation = bool(re.search(
                r'inflation_layer|inflation_radius',
                code_content, re.IGNORECASE,
            ))
            if not has_inflation:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.WARNING,
                    category="costmap",
                    description="costmap 配置中未检测到膨胀层（inflation_layer）",
                    location=code_path,
                    suggestion="请在 costmap 配置中添加 inflation_layer 以提供安全膨胀区域",
                ))

            # 检查是否配置了障碍物层
            has_obstacle = bool(re.search(
                r'obstacle_layer|obstacle_range',
                code_content, re.IGNORECASE,
            ))
            if not has_obstacle:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.WARNING,
                    category="costmap",
                    description="costmap 配置中未检测到障碍物层（obstacle_layer）",
                    location=code_path,
                    suggestion="请在 costmap 配置中添加 obstacle_layer 以感知动态障碍物",
                ))

        # 检测行为树配置
        has_bt_config = bool(re.search(
            r'behavior_tree|bt_navigator|BT\.xml|behavior\.xml',
            code_content, re.IGNORECASE,
        ))

        if has_bt_config:
            # 检查行为树是否包含必要的节点
            has_recovery = bool(re.search(
                r'Recovery|recovery|ClearCostmap|Spin|Wait|BackUp',
                code_content,
            ))
            if not has_recovery:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.WARNING,
                    category="behavior_tree",
                    description="行为树配置中未检测到恢复行为（Recovery）节点",
                    location=code_path,
                    suggestion="请在行为树中添加恢复行为节点（如 ClearCostmap、Spin、BackUp）",
                ))

        # 检测控制器配置
        has_controller_config = bool(re.search(
            r'controller_server|FollowPath|dwa|teb|mpc|regulated_pure_pursuit',
            code_content, re.IGNORECASE,
        ))

        if has_controller_config:
            # 检查是否配置了速度限幅
            has_velocity_limit = bool(re.search(
                r'max_vel_x|max_vel_theta|max_linear|max_angular',
                code_content, re.IGNORECASE,
            ))
            if not has_velocity_limit:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.ERROR,
                    category="controller",
                    description="控制器配置中未设置速度限幅参数",
                    location=code_path,
                    suggestion="请为控制器配置 max_vel_x、max_vel_theta 等速度限幅参数",
                ))

        return violations

    def _check_sensor_data_adaptation(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查传感器数据适配
        运行步骤：
          1. 检测是否使用了 message_filters 进行时间同步
          2. 检测传感器数据是否有有效性校验
          3. 检测是否有传感器数据丢包/延迟处理
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测是否使用了多传感器数据
        has_multiple_sensors = len(re.findall(
            r'create_subscription|Subscriber|message_filters',
            code_content,
        )) >= 2

        if has_multiple_sensors:
            # 检测是否使用了 message_filters 时间同步
            has_time_sync = bool(re.search(
                r'message_filters|TimeSynchronizer|ApproximateTime',
                code_content,
            ))
            if not has_time_sync:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.WARNING,
                    category="sensor_adaptation",
                    description="多传感器数据融合未使用 message_filters 进行时间同步",
                    location=code_path,
                    suggestion="请使用 ROS 官方的 message_filters 库实现传感器数据时间同步",
                ))

        # 检测传感器数据有效性校验
        has_data_validation = bool(re.search(
            r'isnan|isfinite|isinf|valid|check|validate|empty\(',
            code_content,
        ))
        if not has_data_validation:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="sensor_adaptation",
                description="传感器数据使用前未进行有效性校验",
                location=code_path,
                suggestion="请在使用传感器数据前进行 NaN/Inf/空值校验",
            ))

        # 检测丢包/延迟处理
        has_drop_delay_handling = bool(re.search(
            r'timeout|stale|drop|latency|delay|queue_size|buffer',
            code_content, re.IGNORECASE,
        ))
        if not has_drop_delay_handling:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="sensor_adaptation",
                description="未检测到传感器数据丢包/延迟的兜底处理逻辑",
                location=code_path,
                suggestion="建议添加传感器数据超时检测和丢包兜底处理",
            ))

        return violations

    # ==========================================================
    # 场景三：视觉感知场景校验
    # ==========================================================

    def validate_vision_perception(self, code_path: str) -> List[SceneViolation]:
        """
        校验视觉感知场景的 cv_bridge 使用与节点规范
        运行步骤：
          1. 检查 cv_bridge 使用规范
          2. 检查标准消息类型使用
          3. 检查节点异常处理
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []
        code_content = self._collect_code_content(code_path)

        # ---- 子校验 1：cv_bridge 使用规范 ----
        violations.extend(self._check_cv_bridge_usage(code_content, code_path))

        # ---- 子校验 2：标准消息类型 ----
        violations.extend(self._check_vision_message_types(code_content, code_path))

        # ---- 子校验 3：节点异常处理 ----
        violations.extend(self._check_vision_exception_handling(code_content, code_path))

        return violations

    def _check_cv_bridge_usage(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查 cv_bridge 使用规范
        运行步骤：
          1. 检测是否正确导入 cv_bridge
          2. 检测图像编码格式是否显式指定
          3. 检测是否处理了编码转换异常
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测是否使用了 cv_bridge
        uses_cv_bridge = bool(re.search(
            r'cv_bridge|CvBridge|from cv_bridge',
            code_content,
        ))

        if not uses_cv_bridge:
            return violations

        # 检测图像编码格式是否显式指定
        has_encoding = bool(re.search(
            r'encoding\s*=|imgmsg_to_cv2.*encoding|bgr8|rgb8|mono8|bgra8',
            code_content,
        ))
        if not has_encoding:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="cv_bridge",
                description="cv_bridge 图像转换时未显式指定编码格式（encoding）",
                location=code_path,
                suggestion="请在 imgmsg_to_cv2() 中显式指定 encoding 参数（如 'bgr8'、'rgb8'）",
            ))

        # 检测是否处理了 CvBridgeError 异常
        has_cv_bridge_error = bool(re.search(
            r'CvBridgeError|cv_bridge.*error|except.*cv_bridge',
            code_content, re.IGNORECASE,
        ))
        if not has_cv_bridge_error:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="cv_bridge",
                description="cv_bridge 图像转换未捕获 CvBridgeError 异常",
                location=code_path,
                suggestion="请使用 try-except 捕获 CvBridgeError 异常，处理不支持的编码格式",
            ))

        return violations

    def _check_vision_message_types(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查视觉感知场景的标准消息类型使用
        运行步骤：
          1. 检测是否使用了标准 ROS 图像消息类型
          2. 检测是否使用了 image_transport 进行高效传输
          3. 检测 CameraInfo 是否与 Image 配对使用
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测标准消息类型
        uses_image_msg = bool(re.search(
            r'sensor_msgs/Image|sensor_msgs\.msg\.Image|Image\s*\(',
            code_content,
        ))
        uses_camera_info = bool(re.search(
            r'sensor_msgs/CameraInfo|CameraInfo',
            code_content,
        ))

        if uses_image_msg and not uses_camera_info:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="vision_message",
                description="使用了 Image 消息但未检测到 CameraInfo 消息",
                location=code_path,
                suggestion="建议同时订阅 CameraInfo 话题以获取相机内参和畸变参数",
            ))

        # 检测是否使用了 image_transport
        has_image_transport = bool(re.search(
            r'image_transport|ImageTransport',
            code_content,
        ))
        if uses_image_msg and not has_image_transport:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="vision_message",
                description="未使用 image_transport 进行图像传输",
                location=code_path,
                suggestion="建议使用 image_transport 替代普通 Publisher/Subscriber 以支持压缩传输",
            ))

        return violations

    def _check_vision_exception_handling(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查视觉感知节点的异常处理
        运行步骤：
          1. 检测图像回调中是否有异常处理
          2. 检测空图像处理
          3. 检测图像尺寸/格式校验
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测空图像处理
        has_empty_check = bool(re.search(
            r'\.empty\(\)|if\s+.*image|if\s+.*img|is\s+None|nullptr',
            code_content,
        ))
        if not has_empty_check:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="vision_exception",
                description="图像回调中未检测到空图像检查",
                location=code_path,
                suggestion="请在使用图像数据前检查图像是否为空（image.empty() 或 is None）",
            ))

        # 检测图像尺寸校验
        has_size_check = bool(re.search(
            r'\.rows|\.cols|\.size\(\)|shape\[|width|height',
            code_content,
        ))
        if not has_size_check:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="vision_exception",
                description="未检测到图像尺寸校验",
                location=code_path,
                suggestion="建议在处理前校验图像尺寸是否符合预期",
            ))

        return violations

    # ==========================================================
    # 场景四：运动控制场景校验
    # ==========================================================

    def validate_motion_control(self, code_path: str) -> List[SceneViolation]:
        """
        校验运动控制场景的分层架构与安全实时性规范
        运行步骤：
          1. 检查分层控制架构
          2. 检查运动学/动力学解算
          3. 检查步态控制
          4. 检查安全与实时性规范
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []
        code_content = self._collect_code_content(code_path)

        # ---- 子校验 1：分层控制架构 ----
        violations.extend(self._check_layered_control_architecture(code_content, code_path))

        # ---- 子校验 2：运动学/动力学解算 ----
        violations.extend(self._check_kinematics_dynamics(code_content, code_path))

        # ---- 子校验 3：步态控制 ----
        violations.extend(self._check_gait_control(code_content, code_path))

        # ---- 子校验 4：安全与实时性规范 ----
        violations.extend(self._check_motion_safety_realtime(code_content, code_path))

        return violations

    def _check_layered_control_architecture(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查分层控制架构
        运行步骤：
          1. 检测是否实现了高层规划层
          2. 检测是否实现了中层控制层
          3. 检测是否实现了底层驱动层
          4. 检测各层之间的接口是否清晰
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测分层架构关键词
        has_high_level = bool(re.search(
            r'planner|trajectory_generat|path_plan|footstep|gait_plan',
            code_content, re.IGNORECASE,
        ))
        has_mid_level = bool(re.search(
            r'controller|wbc|whole_body|mpc|task_space|impedance',
            code_content, re.IGNORECASE,
        ))
        has_low_level = bool(re.search(
            r'joint_controller|motor|actuator|servo|pwm|can|ethercat',
            code_content, re.IGNORECASE,
        ))

        if not has_high_level:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="control_architecture",
                description="未检测到高层规划层（planner/trajectory_generator）",
                location=code_path,
                suggestion="运动控制系统应包含高层规划层，负责步态规划和轨迹生成",
            ))

        if not has_mid_level:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="control_architecture",
                description="未检测到中层控制层（WBC/MPC/impedance_control）",
                location=code_path,
                suggestion="运动控制系统应包含中层控制层，负责全身动力学控制和力分配",
            ))

        if not has_low_level:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="control_architecture",
                description="未检测到底层驱动层（joint_controller/motor/actuator）",
                location=code_path,
                suggestion="运动控制系统应包含底层驱动层，负责关节电机控制",
            ))

        return violations

    def _check_kinematics_dynamics(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查运动学/动力学解算
        运行步骤：
          1. 检测是否实现了正运动学（FK）
          2. 检测是否实现了逆运动学（IK）
          3. 检测是否实现了动力学模型
          4. 检测解算结果是否有合法性校验
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        has_fk = bool(re.search(
            r'forward_kinematics|fk\b|FK\b',
            code_content,
        ))
        has_ik = bool(re.search(
            r'inverse_kinematics|ik\b|IK\b',
            code_content,
        ))
        has_dynamics = bool(re.search(
            r'dynamics|inertia|mass_matrix|coriolis|gravity',
            code_content, re.IGNORECASE,
        ))

        if not has_ik and not has_fk:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="kinematics",
                description="未检测到运动学解算（FK/IK）实现",
                location=code_path,
                suggestion="运动控制系统应包含正/逆运动学解算模块",
            ))

        if not has_dynamics:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="dynamics",
                description="未检测到动力学模型实现",
                location=code_path,
                suggestion="建议实现动力学模型以提高控制精度（如使用 Pinocchio、RBDL 等库）",
            ))

        # 检测解算结果的合法性校验
        has_solution_check = bool(re.search(
            r'isnan|isfinite|isinf|clamp|limit|bound|saturate',
            code_content,
        ))
        if (has_ik or has_fk) and not has_solution_check:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="kinematics",
                description="运动学解算结果未进行合法性校验（NaN/Inf/限幅检查）",
                location=code_path,
                suggestion="请对解算结果进行合法性校验，包括 NaN/Inf 检查和输出限幅",
            ))

        return violations

    def _check_gait_control(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查步态控制实现
        运行步骤：
          1. 检测是否实现了步态状态机
          2. 检测是否实现了足端轨迹规划
          3. 检测步态切换是否有平滑过渡
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        has_gait_state_machine = bool(re.search(
            r'gait|stance|swing|trot|bound|pace|gallop|walk',
            code_content, re.IGNORECASE,
        ))

        if has_gait_state_machine:
            # 检测步态状态机实现
            has_state_machine = bool(re.search(
                r'state_machine|fsm|FSM|enum.*gait|GaitState|gait_state',
                code_content,
            ))
            if not has_state_machine:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.WARNING,
                    category="gait_control",
                    description="检测到步态相关代码但未实现步态状态机",
                    location=code_path,
                    suggestion="请使用状态机（FSM）管理步态切换，确保步态转换的确定性",
                ))

            # 检测步态切换的平滑过渡
            has_smooth_transition = bool(re.search(
                r'interpolat|smooth|transition|blend|fade',
                code_content, re.IGNORECASE,
            ))
            if not has_smooth_transition:
                violations.append(SceneViolation(
                    severity=ValidationSeverity.INFO,
                    category="gait_control",
                    description="步态切换未检测到平滑过渡处理",
                    location=code_path,
                    suggestion="建议在步态切换时使用插值/平滑过渡，避免运动突变",
                ))

        return violations

    def _check_motion_safety_realtime(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查运动控制的安全与实时性规范
        运行步骤：
          1. 检测是否有双层极限值约束
          2. 检测是否有急停逻辑
          3. 检测实时循环中是否有违规操作（动态内存分配、阻塞调用、日志打印）
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测双层极限值约束
        has_limits = bool(re.search(
            r'clamp|limit|bound|saturate|min\s*\(|max\s*\(|std::clamp',
            code_content,
        ))
        if not has_limits:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="motion_safety",
                description="运动控制代码未检测到双层极限值约束",
                location=code_path,
                suggestion="请为所有运动控制指令添加双层极限值约束（软件限位 + 硬件限位）",
            ))

        # 检测急停逻辑
        has_emergency_stop = bool(re.search(
            r'emergency_stop|e_stop|E_STOP|emergency|halt|shutdown|safe_mode',
            code_content, re.IGNORECASE,
        ))
        if not has_emergency_stop:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="motion_safety",
                description="运动控制代码未检测到急停逻辑",
                location=code_path,
                suggestion="机器人运动控制代码必须实现急停逻辑，包括紧急停止信号处理和电机断电",
            ))

        # 检测实时循环中的违规操作
        has_dynamic_alloc = bool(re.search(
            r'\b(new\s+|delete\s+|malloc\s*\(|free\s*\()',
            code_content,
        ))
        has_blocking_call = bool(re.search(
            r'\b(sleep\s*\(|usleep\s*\(|nanosleep\s*\(|wait\s*\()',
            code_content,
        ))
        has_file_io = bool(re.search(
            r'\b(fopen|fwrite|fread|fprintf|ofstream|ifstream)\b',
            code_content,
        ))

        if has_dynamic_alloc:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="motion_realtime",
                description="检测到动态内存分配操作（new/delete/malloc/free），违反实时性要求",
                location=code_path,
                suggestion="实时控制循环中严禁动态内存分配，请使用预分配内存池或栈上分配",
            ))

        if has_blocking_call:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="motion_realtime",
                description="检测到阻塞调用（sleep/wait），违反实时性要求",
                location=code_path,
                suggestion="实时控制循环中严禁阻塞调用，请使用非阻塞异步机制",
            ))

        if has_file_io:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="motion_realtime",
                description="检测到文件 IO 操作，违反实时性要求",
                location=code_path,
                suggestion="实时控制循环中严禁文件 IO 操作",
            ))

        return violations

    # ==========================================================
    # 场景五：强化学习场景校验
    # ==========================================================

    def validate_reinforcement_learning(self, code_path: str) -> List[SceneViolation]:
        """
        校验强化学习场景的算法工程分离与安全约束
        运行步骤：
          1. 检查算法与工程接口分离
          2. 检查模型推理规范
          3. 检查安全约束
          4. 检查可复现性
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []
        code_content = self._collect_code_content(code_path)

        # ---- 子校验 1：算法与工程分离 ----
        violations.extend(self._check_algorithm_engineering_separation(code_content, code_path))

        # ---- 子校验 2：模型推理规范 ----
        violations.extend(self._check_model_inference_specs(code_content, code_path))

        # ---- 子校验 3：安全约束 ----
        violations.extend(self._check_rl_safety_constraints(code_content, code_path))

        # ---- 子校验 4：可复现性 ----
        violations.extend(self._check_reproducibility(code_content, code_path))

        return violations

    def _check_algorithm_engineering_separation(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查算法核心逻辑与工程接口的分离
        运行步骤：
          1. 检测算法核心逻辑是否独立于 ROS 节点封装
          2. 检测是否有独立的 Policy/Agent 类
          3. 检测环境接口是否抽象化
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测是否有独立的算法类
        has_policy_class = bool(re.search(
            r'class\s+\w*Policy|class\s+\w*Agent|class\s+\w*Model',
            code_content,
        ))
        has_env_class = bool(re.search(
            r'class\s+\w*Env|class\s+\w*Environment',
            code_content,
        ))

        if not has_policy_class:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_separation",
                description="未检测到独立的 Policy/Agent 算法类",
                location=code_path,
                suggestion="请将算法核心逻辑封装为独立的 Policy/Agent 类，与 ROS 节点解耦",
            ))

        if not has_env_class:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_separation",
                description="未检测到独立的环境接口类",
                location=code_path,
                suggestion="请将环境交互逻辑封装为独立的 Env 类，支持仿真和真机切换",
            ))

        # 检测 ROS 节点是否直接包含算法逻辑
        has_ros_node = bool(re.search(
            r'rclcpp::Node|rospy|rclpy|class\s+\w*Node',
            code_content,
        ))
        has_ros_in_algorithm = has_ros_node and (
            "rclcpp::Node" in code_content or "rospy" in code_content
        )

        if has_ros_in_algorithm and has_policy_class:
            # 检测 ROS 节点是否与算法类分离（不在同一个文件中混合）
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="rl_separation",
                description="建议将 ROS 节点封装与算法核心逻辑分离到不同文件",
                location=code_path,
                suggestion="将算法类放在独立的 Python 模块或 C++ 头文件中，ROS 节点仅负责接口适配",
            ))

        return violations

    def _check_model_inference_specs(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查模型推理规范
        运行步骤：
          1. 检测推理代码是否独立于训练代码
          2. 检测是否使用了优化的推理格式（ONNX/TensorRT）
          3. 检测推理是否有批处理/流水线优化
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测推理相关代码
        has_inference = bool(re.search(
            r'predict|inference|forward|eval\s*\(|model\.eval',
            code_content,
        ))
        has_training = bool(re.search(
            r'train|backward|optimizer|loss|gradient|\.train\(',
            code_content,
        ))

        if has_inference and has_training:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_inference",
                description="推理代码与训练代码混合在同一文件中",
                location=code_path,
                suggestion="请将推理代码与训练代码分离，部署时仅包含推理逻辑",
            ))

        # 检测是否使用了优化的推理格式
        has_optimized_inference = bool(re.search(
            r'onnx|tensorrt|torch\.jit|torchscript|tflite|openvino',
            code_content, re.IGNORECASE,
        ))
        if has_inference and not has_optimized_inference:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="rl_inference",
                description="未使用优化的推理格式（ONNX/TensorRT/TorchScript）",
                location=code_path,
                suggestion="建议将模型导出为 ONNX 或 TensorRT 格式以提升推理性能",
            ))

        # 检测推理是否有异常处理
        has_inference_exception = bool(re.search(
            r'try|except|catch|with\s+torch\.no_grad',
            code_content,
        ))
        if has_inference and not has_inference_exception:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_inference",
                description="模型推理代码缺少异常处理和 no_grad 上下文",
                location=code_path,
                suggestion="请使用 torch.no_grad() 上下文并添加异常处理",
            ))

        return violations

    def _check_rl_safety_constraints(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查强化学习的安全约束
        运行步骤：
          1. 检测动作输出是否有限幅
          2. 检测是否有安全层/安全过滤器
          3. 检测是否有探索与利用的安全边界
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测动作输出限幅
        has_action_clamp = bool(re.search(
            r'clamp|clip|limit|bound|action.*min|action.*max|tanh',
            code_content, re.IGNORECASE,
        ))
        if not has_action_clamp:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="rl_safety",
                description="策略输出未进行动作限幅（action clamping）",
                location=code_path,
                suggestion="请对策略输出的动作进行限幅处理，确保在安全范围内",
            ))

        # 检测安全层/安全过滤器
        has_safety_filter = bool(re.search(
            r'safety_filter|safe_action|action_filter|safety_layer|shield',
            code_content, re.IGNORECASE,
        ))
        if not has_safety_filter:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_safety",
                description="未检测到安全层/安全过滤器（safety filter）",
                location=code_path,
                suggestion="建议在策略输出后添加安全过滤器，拦截危险动作",
            ))

        # 检测急停机制
        has_emergency_stop = bool(re.search(
            r'emergency|estop|halt|terminate|abort',
            code_content, re.IGNORECASE,
        ))
        if not has_emergency_stop:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="rl_safety",
                description="未检测到急停/终止机制",
                location=code_path,
                suggestion="强化学习控制必须包含急停机制，在检测到异常时立即终止",
            ))

        return violations

    def _check_reproducibility(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查强化学习实验的可复现性
        运行步骤：
          1. 检测是否设置了随机种子
          2. 检测是否记录了超参数
          3. 检测是否有 checkpoint 保存/加载机制
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测随机种子设置
        has_seed = bool(re.search(
            r'seed|random\.seed|np\.random\.seed|torch\.manual_seed|set_seed',
            code_content,
        ))
        if not has_seed:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_reproducibility",
                description="未设置随机种子，实验结果不可复现",
                location=code_path,
                suggestion="请设置随机种子（random.seed、np.random.seed、torch.manual_seed）",
            ))

        # 检测 checkpoint 机制
        has_checkpoint = bool(re.search(
            r'checkpoint|save_model|load_model|state_dict|save\(|load\(',
            code_content,
        ))
        if not has_checkpoint:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="rl_reproducibility",
                description="未检测到模型 checkpoint 保存/加载机制",
                location=code_path,
                suggestion="请实现模型 checkpoint 的保存和加载功能",
            ))

        # 检测超参数记录
        has_hyperparams = bool(re.search(
            r'hyperparam|config|yaml|argparse|hydra|gin',
            code_content, re.IGNORECASE,
        ))
        if not has_hyperparams:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="rl_reproducibility",
                description="未检测到超参数配置管理",
                location=code_path,
                suggestion="建议使用 YAML 配置文件或 argparse/hydra 管理超参数",
            ))

        return violations

    # ==========================================================
    # 场景六：自动驾驶场景校验
    # ==========================================================

    def validate_autonomous_driving(self, code_path: str) -> List[SceneViolation]:
        """
        校验自动驾驶场景的分层架构与安全冗余
        运行步骤：
          1. 检查分层架构（感知、定位、决策、规划、控制）
          2. 检查感知与定位模块
          3. 检查决策与规划模块
          4. 检查运动控制模块
          5. 检查安全冗余机制
        参数：
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []
        code_content = self._collect_code_content(code_path)

        # ---- 子校验 1：分层架构 ----
        violations.extend(self._check_ad_layered_architecture(code_content, code_path))

        # ---- 子校验 2：感知与定位 ----
        violations.extend(self._check_ad_perception_localization(code_content, code_path))

        # ---- 子校验 3：决策与规划 ----
        violations.extend(self._check_ad_decision_planning(code_content, code_path))

        # ---- 子校验 4：运动控制 ----
        violations.extend(self._check_ad_motion_control(code_content, code_path))

        # ---- 子校验 5：安全冗余 ----
        violations.extend(self._check_ad_safety_redundancy(code_content, code_path))

        return violations

    def _check_ad_layered_architecture(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查自动驾驶分层架构完整性
        运行步骤：
          1. 检测感知层模块
          2. 检测定位层模块
          3. 检测决策规划层模块
          4. 检测运动控制层模块
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测各层模块
        has_perception = bool(re.search(
            r'perception|detection|recognition|segmentation|tracking',
            code_content, re.IGNORECASE,
        ))
        has_localization = bool(re.search(
            r'localization|localisation|pose_estimat|odometry|gps|imu|gnss',
            code_content, re.IGNORECASE,
        ))
        has_planning = bool(re.search(
            r'planning|planner|path_plan|trajectory|behavior_plan',
            code_content, re.IGNORECASE,
        ))
        has_control = bool(re.search(
            r'control|steering|throttle|brake|actuator|drive_by_wire',
            code_content, re.IGNORECASE,
        ))

        if not has_perception:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_architecture",
                description="未检测到感知层模块（perception/detection/recognition）",
                location=code_path,
                suggestion="自动驾驶系统应包含感知层，负责环境感知和目标检测",
            ))

        if not has_localization:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_architecture",
                description="未检测到定位层模块（localization/pose_estimation）",
                location=code_path,
                suggestion="自动驾驶系统应包含定位层，负责车辆位姿估计",
            ))

        if not has_planning:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_architecture",
                description="未检测到决策规划层模块（planning/path_planning）",
                location=code_path,
                suggestion="自动驾驶系统应包含决策规划层，负责路径规划和行为决策",
            ))

        if not has_control:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_architecture",
                description="未检测到运动控制层模块（control/steering/throttle）",
                location=code_path,
                suggestion="自动驾驶系统应包含运动控制层，负责车辆执行控制",
            ))

        return violations

    def _check_ad_perception_localization(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查感知与定位模块规范
        运行步骤：
          1. 检测多传感器融合是否实现
          2. 检测传感器数据是否有时间同步
          3. 检测定位是否有冗余方案
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测多传感器融合
        has_sensor_fusion = bool(re.search(
            r'sensor_fusion|fusion|multi.?sensor|kalman|ekf|ukf|particle',
            code_content, re.IGNORECASE,
        ))
        has_multiple_sensors = len(re.findall(
            r'lidar|radar|camera|ultrasonic|gps|imu',
            code_content, re.IGNORECASE,
        )) >= 2

        if has_multiple_sensors and not has_sensor_fusion:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_perception",
                description="检测到多种传感器但未实现传感器融合",
                location=code_path,
                suggestion="请实现多传感器融合算法（如 EKF/UKF/粒子滤波）",
            ))

        # 检测传感器数据时间同步
        has_time_sync = bool(re.search(
            r'time_sync|timestamp|synchroniz|message_filters',
            code_content, re.IGNORECASE,
        ))
        if has_multiple_sensors and not has_time_sync:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_perception",
                description="多传感器数据未进行时间同步",
                location=code_path,
                suggestion="请实现传感器数据的时间同步机制",
            ))

        # 检测定位冗余
        has_redundant_localization = bool(re.search(
            r'gps.*imu|imu.*gps|fusion.*localization|redundant.*localization',
            code_content, re.IGNORECASE,
        ))
        if not has_redundant_localization:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="ad_localization",
                description="定位模块未检测到冗余方案（如 GPS+IMU 融合）",
                location=code_path,
                suggestion="建议实现 GPS/IMU/轮速计等多源融合定位，提供冗余保障",
            ))

        return violations

    def _check_ad_decision_planning(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查决策与规划模块规范
        运行步骤：
          1. 检测是否实现了行为决策层
          2. 检测是否实现了运动规划层
          3. 检测规划结果是否有碰撞检测
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测行为决策
        has_behavior_decision = bool(re.search(
            r'behavior_decision|behavior_planner|state_machine|fsm|decision_making',
            code_content, re.IGNORECASE,
        ))
        if not has_behavior_decision:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_planning",
                description="未检测到行为决策模块（behavior_planner/state_machine）",
                location=code_path,
                suggestion="自动驾驶系统应包含行为决策层，负责车道保持、变道、跟车等决策",
            ))

        # 检测碰撞检测
        has_collision_check = bool(re.search(
            r'collision|obstacle|safety_distance|ttc|time_to_collision',
            code_content, re.IGNORECASE,
        ))
        if not has_collision_check:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="ad_planning",
                description="规划模块未检测到碰撞检测/安全距离校验",
                location=code_path,
                suggestion="自动驾驶规划必须包含碰撞检测和安全距离校验",
            ))

        # 检测路径平滑
        has_path_smoothing = bool(re.search(
            r'smooth|spline|bezier|polynomial|interpolat|curvature',
            code_content, re.IGNORECASE,
        ))
        if not has_path_smoothing:
            violations.append(SceneViolation(
                severity=ValidationSeverity.INFO,
                category="ad_planning",
                description="规划路径未检测到平滑处理",
                location=code_path,
                suggestion="建议对规划路径进行平滑处理（样条曲线/贝塞尔曲线），确保可行驶性",
            ))

        return violations

    def _check_ad_motion_control(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查运动控制模块规范
        运行步骤：
          1. 检测是否实现了轨迹跟踪控制
          2. 检测控制指令是否有输出限幅
          3. 检测是否有控制模式切换
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测轨迹跟踪
        has_trajectory_tracking = bool(re.search(
            r'trajectory_tracking|pure_pursuit|stanley|mpc|lqr|pid',
            code_content, re.IGNORECASE,
        ))
        if not has_trajectory_tracking:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_control",
                description="未检测到轨迹跟踪控制器（pure_pursuit/stanley/MPC/LQR）",
                location=code_path,
                suggestion="自动驾驶系统应包含轨迹跟踪控制器",
            ))

        # 检测输出限幅
        has_output_limit = bool(re.search(
            r'clamp|limit|bound|max_steering|max_throttle|max_brake',
            code_content, re.IGNORECASE,
        ))
        if not has_output_limit:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="ad_control",
                description="控制指令输出未进行限幅处理",
                location=code_path,
                suggestion="请为转向角、油门、刹车等控制指令添加输出限幅",
            ))

        # 检测控制模式切换
        has_mode_switch = bool(re.search(
            r'mode_switch|control_mode|manual.*auto|auto.*manual|takeover|disengage',
            code_content, re.IGNORECASE,
        ))
        if not has_mode_switch:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_control",
                description="未检测到控制模式切换（手动/自动切换）机制",
                location=code_path,
                suggestion="自动驾驶系统应支持手动/自动模式的安全切换",
            ))

        return violations

    def _check_ad_safety_redundancy(
        self, code_content: str, code_path: str
    ) -> List[SceneViolation]:
        """
        检查安全冗余机制
        运行步骤：
          1. 检测是否有安全监控模块
          2. 检测是否有故障降级策略
          3. 检测是否有冗余执行机构
          4. 检测是否有紧急制动逻辑
        参数：
          - code_content: 代码内容字符串
          - code_path: 代码路径
        返回值：违规记录列表
        """
        violations: List[SceneViolation] = []

        # 检测安全监控
        has_safety_monitor = bool(re.search(
            r'safety_monitor|health_monitor|watchdog|diagnostic|fault_detection',
            code_content, re.IGNORECASE,
        ))
        if not has_safety_monitor:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="ad_safety",
                description="未检测到安全监控模块（safety_monitor/watchdog）",
                location=code_path,
                suggestion="自动驾驶系统必须包含安全监控模块，实时检测系统健康状态",
            ))

        # 检测故障降级
        has_degradation = bool(re.search(
            r'degrad|fallback|fail.?safe|fail.?operational|limp.?mode',
            code_content, re.IGNORECASE,
        ))
        if not has_degradation:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="ad_safety",
                description="未检测到故障降级策略（degradation/fallback/fail-safe）",
                location=code_path,
                suggestion="自动驾驶系统必须实现故障降级策略，确保单点故障不影响安全",
            ))

        # 检测紧急制动
        has_emergency_brake = bool(re.search(
            r'emergency_brake|aeb|autonomous_emergency|collision_avoidance|'
            r'emergency_stop|hard_brake',
            code_content, re.IGNORECASE,
        ))
        if not has_emergency_brake:
            violations.append(SceneViolation(
                severity=ValidationSeverity.ERROR,
                category="ad_safety",
                description="未检测到紧急制动逻辑（AEB/emergency_brake）",
                location=code_path,
                suggestion="自动驾驶系统必须包含紧急制动（AEB）功能",
            ))

        # 检测冗余执行机构
        has_redundant_actuator = bool(re.search(
            r'redundant.*actuator|dual.*motor|backup.*steering|backup.*brake|'
            r'secondary.*system',
            code_content, re.IGNORECASE,
        ))
        if not has_redundant_actuator:
            violations.append(SceneViolation(
                severity=ValidationSeverity.WARNING,
                category="ad_safety",
                description="未检测到冗余执行机构设计",
                location=code_path,
                suggestion="高等级自动驾驶系统建议设计冗余执行机构（双电机/备份转向/备份制动）",
            ))

        return violations