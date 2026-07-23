"""
# ============================================================
# 后端核心服务 - 硬实时规范校验器
# ============================================================
# 核心作用：对机器人实时控制代码进行硬实时规范校验，包括
#           线程优先级、实时循环约束、内存锁定三个维度的检查
# 运行流程：
#   1. 接收待校验的源代码目录路径
#   2. 扫描所有 C/C++ 和 Python 源文件
#   3. 对每个文件执行三个维度的校验：
#      a. 线程优先级校验：检查优先级是否符合"安全>控制>感知"分级
#      b. 实时循环约束校验：检查实时循环内是否有违规操作
#      c. 内存锁定校验：检查是否正确锁定内存和预分配栈
#   4. 汇总所有校验结果，返回完整报告
# 输入参数：
#   - source_path: str，源代码根目录路径
#   - target_files: Optional[List[str]]，指定校验的文件列表（为空则扫描全部）
# 输出结果：RealtimeValidationReport 对象，包含各维度校验结果和问题列表
# ============================================================
# 修改记录：
#   版本 1.0.0 | 2026-06-24 | 初始创建，实现硬实时规范三维校验
# ============================================================
"""

import logging
import os
import re
import ast
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Set, Tuple
from enum import Enum

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class RealtimeSeverity(str, Enum):
    """硬实时校验严重程度枚举"""
    CRITICAL = "critical"   # 严重违规，可能导致实时性崩溃
    ERROR = "error"         # 违规，必须修复
    WARNING = "warning"     # 警告，建议修复
    INFO = "info"           # 信息提示


@dataclass
class RealtimeViolation:
    """
    硬实时规范违规记录
    字段说明：
      - severity: 严重程度（critical/error/warning/info）
      - category: 违规类别（thread_priority/realtime_loop/memory_locking）
      - description: 违规描述
      - location: 违规位置（文件路径:行号）
      - suggestion: 修复建议
    """
    severity: RealtimeSeverity = RealtimeSeverity.WARNING
    category: str = ""
    description: str = ""
    location: str = ""
    suggestion: str = ""


@dataclass
class RealtimeValidationReport:
    """
    硬实时规范校验报告
    字段说明：
      - source_path: 校验的源代码路径
      - files_scanned: 扫描的文件数量
      - violations: 所有违规记录列表
      - thread_priorities_ok: 线程优先级校验是否通过
      - realtime_loops_ok: 实时循环约束校验是否通过
      - memory_locking_ok: 内存锁定校验是否通过
      - overall_score: 综合评分（0-100）
      - summary: 校验摘要
    """
    source_path: str = ""
    files_scanned: int = 0
    violations: List[RealtimeViolation] = field(default_factory=list)
    thread_priorities_ok: bool = True
    realtime_loops_ok: bool = True
    memory_locking_ok: bool = True
    overall_score: float = 100.0
    summary: str = ""


# ============================================================
# 硬实时规范校验器
# ============================================================

class RealtimeValidator:
    """
    硬实时规范校验器
    作用：对机器人实时控制代码进行线程优先级、实时循环约束、
          内存锁定三个维度的自动化校验
    调用方：任务验证引擎、代码审查流程
    被调用方：无（独立工具类）
    """

    # ----------------------------------------------------------
    # 线程优先级分级定义
    # ----------------------------------------------------------
    # 优先级分级原则：安全最高 > 控制次之 > 感知再次之 > 非实时最低
    # 安全相关线程（急停、碰撞检测、安全监控）：90-98
    # 控制相关线程（运动控制、伺服控制）：80-89
    # 感知相关线程（传感器处理、状态估计）：60-79
    # 非实时线程（日志、监控、通信）：< 50

    THREAD_PRIORITY_RANGES: Dict[str, Tuple[int, int]] = {
        "safety": (90, 98),       # 安全线程优先级范围
        "control": (80, 89),      # 控制线程优先级范围
        "perception": (60, 79),   # 感知线程优先级范围
        "non_realtime": (1, 49),  # 非实时线程优先级范围
    }

    # 安全线程关键词（用于识别线程类型）
    SAFETY_THREAD_KEYWORDS: Set[str] = {
        "safety", "emergency", "estop", "watchdog", "collision",
        "fault", "protection", "guard", "monitor_safety",
    }

    # 控制线程关键词
    CONTROL_THREAD_KEYWORDS: Set[str] = {
        "control", "controller", "servo", "actuator", "motor",
        "joint", "trajectory", "pid", "motion", "velocity",
        "position", "torque", "effort",
    }

    # 感知线程关键词
    PERCEPTION_THREAD_KEYWORDS: Set[str] = {
        "perception", "sensor", "camera", "lidar", "imu",
        "odometry", "localization", "mapping", "detection",
        "tracking", "fusion", "filter", "estimate",
    }

    # ----------------------------------------------------------
    # 实时循环内禁止的操作模式
    # ----------------------------------------------------------

    # 禁止的动态内存分配操作（C++）
    FORBIDDEN_ALLOC_PATTERNS: List[str] = [
        r'\bnew\s+',              # new 操作符
        r'\bdelete\b',            # delete 操作符
        r'\bdelete\[\]',          # delete[] 操作符
        r'\bmalloc\s*\(',         # malloc 调用
        r'\bcalloc\s*\(',         # calloc 调用
        r'\brealloc\s*\(',        # realloc 调用
        r'\bfree\s*\(',           # free 调用
        r'\balloca\s*\(',         # alloca 调用（栈上动态分配）
    ]

    # 禁止的阻塞调用模式
    FORBIDDEN_BLOCKING_PATTERNS: List[str] = [
        r'\bsleep\s*\(',          # sleep 调用
        r'\busleep\s*\(',         # usleep 调用
        r'\bnanosleep\s*\(',      # nanosleep 调用
        r'\bstd::this_thread::sleep',  # C++ 线程睡眠
        r'\bpthread_mutex_lock\s*\(',  # 互斥锁（可能阻塞）
        r'\bstd::mutex::lock\b',  # C++ 互斥锁
        r'\bstd::unique_lock\b',  # C++ 独占锁
        r'\bstd::lock_guard\b',   # C++ 锁守卫
        r'\bstd::condition_variable',  # 条件变量
        r'\bwait\s*\(',           # wait 调用
        r'\bselect\s*\(',         # select 调用
        r'\bpoll\s*\(',           # poll 调用
        r'\bepoll\b',             # epoll 调用
    ]

    # 禁止的系统调用模式
    FORBIDDEN_SYSCALL_PATTERNS: List[str] = [
        r'\bsystem\s*\(',         # system 调用
        r'\bexec[lv]',            # exec 系列
        r'\bfork\s*\(',           # fork 调用
        r'\bclone\s*\(',          # clone 调用
        r'\bgetpid\s*\(',         # getpid（通常安全，但在实时循环中应避免）
        r'\bsched_yield\s*\(',    # 调度让出
    ]

    # 禁止的文件 IO 操作模式
    FORBIDDEN_FILEIO_PATTERNS: List[str] = [
        r'\bfopen\s*\(',          # fopen 调用
        r'\bfclose\s*\(',         # fclose 调用
        r'\bfread\s*\(',          # fread 调用
        r'\bfwrite\s*\(',         # fwrite 调用
        r'\bfprintf\s*\(',        # fprintf 调用
        r'\bfscanf\s*\(',         # fscanf 调用
        r'\bopen\s*\(',           # open 系统调用
        r'\bclose\s*\(',          # close 系统调用
        r'\bread\s*\(',           # read 系统调用
        r'\bwrite\s*\(',          # write 系统调用
        r'\bstd::ofstream\b',     # C++ 输出文件流
        r'\bstd::ifstream\b',     # C++ 输入文件流
        r'\bstd::fstream\b',      # C++ 文件流
        r'\bstd::cout\b',         # 标准输出（实时循环中避免）
        r'\bstd::cerr\b',         # 标准错误（实时循环中避免）
    ]

    # 禁止的日志打印模式（DEBUG/INFO 级别）
    FORBIDDEN_LOG_PATTERNS: List[str] = [
        r'RCLCPP_DEBUG\b',        # ROS2 DEBUG 日志
        r'RCLCPP_INFO\b',         # ROS2 INFO 日志
        r'ROS_DEBUG\b',           # ROS1 DEBUG 日志
        r'ROS_INFO\b',            # ROS1 INFO 日志
        r'RCUTILS_LOG_DEBUG\b',   # rcutils DEBUG 日志
        r'RCUTILS_LOG_INFO\b',    # rcutils INFO 日志
        r'logging\.debug\b',      # Python logging DEBUG
        r'logging\.info\b',       # Python logging INFO
        r'logger\.debug\b',       # Python logger DEBUG
        r'logger\.info\b',        # Python logger INFO
        r'printf\s*\(',           # printf（实时循环中避免）
        r'cout\s*<<',             # cout 输出（实时循环中避免）
        r'print\s*\(',            # Python print
    ]

    def __init__(self):
        """初始化硬实时校验器，无外部依赖"""
        pass

    # ==========================================================
    # 公开方法：完整校验入口
    # ==========================================================

    def full_validate(
        self, source_path: str, target_files: Optional[List[str]] = None
    ) -> RealtimeValidationReport:
        """
        执行完整的硬实时规范校验
        运行步骤：
          1. 扫描源代码目录，收集所有源文件
          2. 对每个文件执行线程优先级校验
          3. 对每个文件执行实时循环约束校验
          4. 对每个文件执行内存锁定校验
          5. 汇总结果，计算综合评分
        参数：
          - source_path: 源代码根目录路径
          - target_files: 指定校验的文件列表（为空则扫描全部）
        返回值：RealtimeValidationReport 对象
        """
        # 源代码路径合法性校验
        if not source_path or not os.path.isdir(source_path):
            report = RealtimeValidationReport(source_path=source_path)
            report.violations.append(RealtimeViolation(
                severity=RealtimeSeverity.ERROR,
                category="workspace",
                description=f"源代码路径不存在或无效: {source_path}",
                location=source_path,
                suggestion="请提供有效的源代码根目录路径",
            ))
            report.overall_score = 0.0
            report.summary = "源代码路径无效，无法执行校验"
            return report

        logger.info(f"开始硬实时规范校验: {source_path}")

        # 步骤 1：收集所有源文件
        if target_files:
            # 使用指定的文件列表
            all_files = [f for f in target_files if os.path.isfile(f)]
        else:
            all_files = self._collect_source_files(source_path)

        if not all_files:
            report = RealtimeValidationReport(source_path=source_path)
            report.violations.append(RealtimeViolation(
                severity=RealtimeSeverity.WARNING,
                category="workspace",
                description="未发现任何 C/C++ 或 Python 源文件",
                location=source_path,
                suggestion="请确认源代码路径正确",
            ))
            report.overall_score = 50.0
            report.summary = "未发现源文件"
            return report

        report = RealtimeValidationReport(
            source_path=source_path,
            files_scanned=len(all_files),
        )

        # 步骤 2-4：逐文件执行三维校验
        all_violations: List[RealtimeViolation] = []

        for file_path in all_files:
            # 线程优先级校验
            priority_violations = self.validate_thread_priorities(file_path)
            all_violations.extend(priority_violations)

            # 实时循环约束校验
            loop_violations = self.validate_realtime_loops(file_path)
            all_violations.extend(loop_violations)

            # 内存锁定校验
            memory_violations = self.validate_memory_locking(file_path)
            all_violations.extend(memory_violations)

        report.violations = all_violations

        # 步骤 5：汇总各维度结果
        report.thread_priorities_ok = not any(
            v.category == "thread_priority" and v.severity in (
                RealtimeSeverity.CRITICAL, RealtimeSeverity.ERROR
            )
            for v in all_violations
        )
        report.realtime_loops_ok = not any(
            v.category == "realtime_loop" and v.severity in (
                RealtimeSeverity.CRITICAL, RealtimeSeverity.ERROR
            )
            for v in all_violations
        )
        report.memory_locking_ok = not any(
            v.category == "memory_locking" and v.severity in (
                RealtimeSeverity.CRITICAL, RealtimeSeverity.ERROR
            )
            for v in all_violations
        )

        # 计算综合评分：critical 扣 20 分，error 扣 10 分，warning 扣 3 分
        critical_count = sum(1 for v in all_violations if v.severity == RealtimeSeverity.CRITICAL)
        error_count = sum(1 for v in all_violations if v.severity == RealtimeSeverity.ERROR)
        warning_count = sum(1 for v in all_violations if v.severity == RealtimeSeverity.WARNING)
        report.overall_score = max(
            0.0,
            100.0 - critical_count * 20.0 - error_count * 10.0 - warning_count * 3.0,
        )

        # 生成摘要
        report.summary = (
            f"校验完成：扫描 {len(all_files)} 个文件，"
            f"发现 {critical_count} 个严重违规、{error_count} 个错误、{warning_count} 个警告，"
            f"综合评分 {report.overall_score:.1f}/100"
        )

        logger.info(report.summary)
        return report

    # ==========================================================
    # 维度一：线程优先级校验
    # ==========================================================

    def validate_thread_priorities(self, file_path: str) -> List[RealtimeViolation]:
        """
        校验线程优先级设置是否符合硬实时分级原则
        运行步骤：
          1. 读取源文件内容
          2. 检测线程创建和优先级设置代码
          3. 根据线程名称/关键词推断线程类型
          4. 验证优先级值是否在对应类型的合法范围内
        参数：
          - file_path: 源文件路径
        返回值：违规记录列表
        """
        violations: List[RealtimeViolation] = []

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            logger.warning(f"读取 {file_path} 失败: {e}")
            return violations

        # 检测 C++ 线程优先级设置模式
        # 匹配模式：pthread_setschedparam / setpriority / sched_setscheduler 等
        # 以及 ROS2 的线程优先级设置
        priority_patterns = [
            # pthread 优先级设置
            r'pthread_setschedparam\s*\([^)]*,\s*(\d+)\s*[,)]',
            # sched_setscheduler
            r'sched_setscheduler\s*\([^)]*,\s*(\d+)\s*[,)]',
            # setpriority
            r'setpriority\s*\([^)]*,\s*(\d+)\s*[,)]',
            # nice 值设置
            r'nice\s*\(\s*(-?\d+)\s*\)',
            # ROS2 线程优先级设置
            r'set_thread_priority\s*\(\s*(\d+)\s*\)',
            # 通用优先级常量赋值
            r'(?:thread_priority|sched_priority|rt_priority)\s*=\s*(\d+)',
            # C++11 thread 优先级（通过 native_handle）
            r'pthread_attr_setschedparam\s*\([^)]*,\s*\{[^}]*,\s*(\d+)\s*\}',
        ]

        lines = content.split("\n")

        for pattern in priority_patterns:
            for match in re.finditer(pattern, content):
                priority_value = int(match.group(1))
                # 计算匹配所在的行号
                pos = match.start()
                line_num = content[:pos].count("\n") + 1

                # 获取上下文（前后各 5 行）用于推断线程类型
                context_start = max(0, line_num - 6)
                context_end = min(len(lines), line_num + 5)
                context = "\n".join(lines[context_start:context_end]).lower()

                # 推断线程类型
                thread_type = self._infer_thread_type(context)

                # 获取该类型的合法优先级范围
                if thread_type in self.THREAD_PRIORITY_RANGES:
                    min_pri, max_pri = self.THREAD_PRIORITY_RANGES[thread_type]

                    # 校验优先级值是否在合法范围内
                    if priority_value < min_pri:
                        violations.append(RealtimeViolation(
                            severity=RealtimeSeverity.ERROR,
                            category="thread_priority",
                            description=(
                                f"{thread_type} 类型线程优先级 {priority_value} 过低，"
                                f"应在 [{min_pri}, {max_pri}] 范围内"
                            ),
                            location=f"{file_path}:{line_num}",
                            suggestion=f"请将 {thread_type} 线程优先级提升至 {min_pri}-{max_pri}",
                        ))
                    elif priority_value > max_pri:
                        violations.append(RealtimeViolation(
                            severity=RealtimeSeverity.WARNING,
                            category="thread_priority",
                            description=(
                                f"{thread_type} 类型线程优先级 {priority_value} 超出推荐范围 "
                                f"[{min_pri}, {max_pri}]"
                            ),
                            location=f"{file_path}:{line_num}",
                            suggestion=f"请确认 {thread_type} 线程优先级是否合理，"
                                       f"避免与内核中断优先级冲突",
                        ))

        return violations

    def _infer_thread_type(self, context: str) -> str:
        """
        根据上下文关键词推断线程类型
        运行步骤：
          1. 检查上下文是否包含安全相关关键词
          2. 检查上下文是否包含控制相关关键词
          3. 检查上下文是否包含感知相关关键词
          4. 默认返回非实时类型
        参数：
          - context: 线程创建代码的上下文字符串（已转小写）
        返回值：线程类型字符串（safety/control/perception/non_realtime）
        """
        # 按优先级从高到低检查（安全 > 控制 > 感知）
        for keyword in self.SAFETY_THREAD_KEYWORDS:
            if keyword in context:
                return "safety"

        for keyword in self.CONTROL_THREAD_KEYWORDS:
            if keyword in context:
                return "control"

        for keyword in self.PERCEPTION_THREAD_KEYWORDS:
            if keyword in context:
                return "perception"

        return "non_realtime"

    # ==========================================================
    # 维度二：实时循环约束校验
    # ==========================================================

    def validate_realtime_loops(self, file_path: str) -> List[RealtimeViolation]:
        """
        校验实时循环内的代码是否符合硬实时约束
        运行步骤：
          1. 读取源文件内容
          2. 识别实时循环（while 循环、定时器回调、ROS 回调函数）
          3. 在实时循环体内检测违规操作：
             a. 动态内存分配（new/delete/malloc/free）
             b. 阻塞调用（sleep/mutex_lock/wait）
             c. 系统调用（system/fork/exec）
             d. 文件 IO（fopen/fread/fwrite/cout）
             e. DEBUG/INFO 级别日志打印
        参数：
          - file_path: 源文件路径
        返回值：违规记录列表
        """
        violations: List[RealtimeViolation] = []

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            logger.warning(f"读取 {file_path} 失败: {e}")
            return violations

        lines = content.split("\n")

        # 识别实时循环体
        # 实时循环包括：
        #   1. while(running) / while(ok()) 等控制循环
        #   2. ROS 定时器回调函数
        #   3. ROS subscriber 回调函数
        #   4. 显式标注的实时函数
        loop_bodies = self._extract_realtime_loop_bodies(content, lines)

        for loop_info in loop_bodies:
            loop_body = loop_info["body"]
            loop_start_line = loop_info["start_line"]
            loop_type = loop_info["type"]

            # 子校验 a：动态内存分配检测
            alloc_violations = self._check_forbidden_patterns(
                loop_body, self.FORBIDDEN_ALLOC_PATTERNS,
                "动态内存分配", "allocation",
                file_path, loop_start_line, loop_type,
            )
            violations.extend(alloc_violations)

            # 子校验 b：阻塞调用检测
            blocking_violations = self._check_forbidden_patterns(
                loop_body, self.FORBIDDEN_BLOCKING_PATTERNS,
                "阻塞调用", "blocking",
                file_path, loop_start_line, loop_type,
            )
            violations.extend(blocking_violations)

            # 子校验 c：系统调用检测
            syscall_violations = self._check_forbidden_patterns(
                loop_body, self.FORBIDDEN_SYSCALL_PATTERNS,
                "系统调用", "syscall",
                file_path, loop_start_line, loop_type,
            )
            violations.extend(syscall_violations)

            # 子校验 d：文件 IO 检测
            fileio_violations = self._check_forbidden_patterns(
                loop_body, self.FORBIDDEN_FILEIO_PATTERNS,
                "文件 IO 操作", "fileio",
                file_path, loop_start_line, loop_type,
            )
            violations.extend(fileio_violations)

            # 子校验 e：日志打印检测
            log_violations = self._check_forbidden_patterns(
                loop_body, self.FORBIDDEN_LOG_PATTERNS,
                "DEBUG/INFO 日志打印", "logging",
                file_path, loop_start_line, loop_type,
            )
            violations.extend(log_violations)

        return violations

    def _extract_realtime_loop_bodies(
        self, content: str, lines: List[str]
    ) -> List[Dict]:
        """
        从源代码中提取实时循环体
        运行步骤：
          1. 使用正则匹配 while 循环（含 running/ok/rclcpp::ok 等控制条件）
          2. 使用正则匹配 ROS 定时器回调函数
          3. 使用正则匹配 ROS subscriber 回调函数
          4. 使用大括号匹配提取循环体内容
        参数：
          - content: 文件完整内容
          - lines: 按行分割的内容列表
        返回值：循环体信息列表，每项包含 body/start_line/type
        """
        loop_bodies: List[Dict] = []

        # 匹配实时 while 循环的模式
        # while (rclcpp::ok()) { ... }
        # while (running) { ... }
        # while (ros::ok()) { ... }
        realtime_while_patterns = [
            r'while\s*\(\s*(?:rclcpp::ok|ros::ok|running|is_running|keep_running|!should_stop)\s*\([^)]*\)\s*\)',
            r'while\s*\(\s*(?:rclcpp::ok|ros::ok|running|is_running|keep_running)\s*\)',
        ]

        for pattern in realtime_while_patterns:
            for match in re.finditer(pattern, content):
                start_pos = match.start()
                line_num = content[:start_pos].count("\n") + 1

                # 从匹配位置开始提取大括号内的循环体
                body_start = content.find("{", match.end())
                if body_start == -1:
                    continue

                # 使用大括号计数提取完整循环体
                brace_count = 0
                body_end = body_start
                for i in range(body_start, len(content)):
                    if content[i] == "{":
                        brace_count += 1
                    elif content[i] == "}":
                        brace_count -= 1
                        if brace_count == 0:
                            body_end = i + 1
                            break

                loop_body = content[body_start:body_end]
                loop_bodies.append({
                    "body": loop_body,
                    "start_line": line_num,
                    "type": "while_loop",
                })

        # 匹配 ROS 定时器回调函数
        # void timer_callback() { ... }
        # auto timer_callback = [](...) { ... }
        timer_patterns = [
            r'(?:void|auto)\s+(\w*timer\w*)\s*\([^)]*\)\s*\{',
            r'create_wall_timer\s*\([^)]*,\s*\[[^\]]*\][^)]*\)',
        ]

        for pattern in timer_patterns:
            for match in re.finditer(pattern, content):
                start_pos = match.start()
                line_num = content[:start_pos].count("\n") + 1

                body_start = content.find("{", match.end() - 1)
                if body_start == -1:
                    continue

                brace_count = 0
                body_end = body_start
                for i in range(body_start, len(content)):
                    if content[i] == "{":
                        brace_count += 1
                    elif content[i] == "}":
                        brace_count -= 1
                        if brace_count == 0:
                            body_end = i + 1
                            break

                loop_body = content[body_start:body_end]
                loop_bodies.append({
                    "body": loop_body,
                    "start_line": line_num,
                    "type": "timer_callback",
                })

        # 匹配 ROS subscriber 回调函数
        # void topic_callback(const MsgType::SharedPtr msg) { ... }
        sub_pattern = r'(?:void|auto)\s+(\w*callback\w*|on_\w+)\s*\([^)]*(?:SharedPtr|ConstPtr|msg)[^)]*\)\s*\{'

        for match in re.finditer(sub_pattern, content):
            start_pos = match.start()
            line_num = content[:start_pos].count("\n") + 1

            body_start = content.find("{", match.end() - 1)
            if body_start == -1:
                continue

            brace_count = 0
            body_end = body_start
            for i in range(body_start, len(content)):
                if content[i] == "{":
                    brace_count += 1
                elif content[i] == "}":
                    brace_count -= 1
                    if brace_count == 0:
                        body_end = i + 1
                        break

            loop_body = content[body_start:body_end]
            loop_bodies.append({
                "body": loop_body,
                "start_line": line_num,
                "type": "subscriber_callback",
            })

        return loop_bodies

    def _check_forbidden_patterns(
        self,
        loop_body: str,
        patterns: List[str],
        category_name: str,
        sub_category: str,
        file_path: str,
        loop_start_line: int,
        loop_type: str,
    ) -> List[RealtimeViolation]:
        """
        在循环体内检测禁止的操作模式
        运行步骤：
          1. 遍历所有禁止模式正则
          2. 在循环体内搜索匹配
          3. 为每个匹配生成违规记录
        参数：
          - loop_body: 循环体内容
          - patterns: 禁止模式正则列表
          - category_name: 违规类别中文名
          - sub_category: 违规子类别
          - file_path: 文件路径
          - loop_start_line: 循环起始行号
          - loop_type: 循环类型
        返回值：违规记录列表
        """
        violations: List[RealtimeViolation] = []

        for pattern in patterns:
            for match in re.finditer(pattern, loop_body):
                # 计算循环体内的相对行号
                offset_pos = match.start()
                relative_line = loop_body[:offset_pos].count("\n")
                actual_line = loop_start_line + relative_line

                matched_text = match.group(0).strip()

                violations.append(RealtimeViolation(
                    severity=RealtimeSeverity.CRITICAL,
                    category="realtime_loop",
                    description=(
                        f"在 {loop_type} 实时循环内检测到{category_name}: "
                        f"'{matched_text}'"
                    ),
                    location=f"{file_path}:{actual_line}",
                    suggestion=(
                        f"实时循环内严禁{category_name}操作，"
                        f"请将此类操作移至非实时线程或初始化阶段执行"
                    ),
                ))

        return violations

    # ==========================================================
    # 维度三：内存锁定校验
    # ==========================================================

    def validate_memory_locking(self, file_path: str) -> List[RealtimeViolation]:
        """
        校验内存锁定和栈预分配是否符合硬实时要求
        运行步骤：
          1. 读取源文件内容
          2. 检查是否调用了 mlockall 锁定物理内存
          3. 检查实时线程是否预分配了栈空间
          4. 检查是否禁用了内存过度提交
        参数：
          - file_path: 源文件路径
        返回值：违规记录列表
        """
        violations: List[RealtimeViolation] = []

        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception as e:
            logger.warning(f"读取 {file_path} 失败: {e}")
            return violations

        lines = content.split("\n")

        # 检测文件是否包含实时线程创建代码
        has_realtime_thread = self._has_realtime_thread(content)

        if not has_realtime_thread:
            # 文件不包含实时线程，跳过内存锁定校验
            return violations

        # 子校验 1：检查 mlockall 调用
        mlockall_patterns = [
            r'mlockall\s*\(\s*MCL_CURRENT\s*\|\s*MCL_FUTURE\s*\)',
            r'mlockall\s*\(\s*MCL_FUTURE\s*\|\s*MCL_CURRENT\s*\)',
            r'mlockall\s*\(\s*MCL_CURRENT\s*\)',
            r'mlockall\s*\(\s*MCL_FUTURE\s*\)',
        ]

        has_mlockall = any(
            re.search(pattern, content) for pattern in mlockall_patterns
        )

        if not has_mlockall:
            violations.append(RealtimeViolation(
                severity=RealtimeSeverity.ERROR,
                category="memory_locking",
                description="实时线程代码中未调用 mlockall 锁定物理内存",
                location=file_path,
                suggestion=(
                    "请在初始化阶段调用 mlockall(MCL_CURRENT | MCL_FUTURE) "
                    "锁定进程的虚拟地址空间，防止页面换出导致的延迟"
                ),
            ))
        else:
            # 检查是否同时使用了 MCL_CURRENT 和 MCL_FUTURE（最佳实践）
            has_both_flags = re.search(
                r'mlockall\s*\(\s*MCL_CURRENT\s*\|\s*MCL_FUTURE\s*\)', content
            ) or re.search(
                r'mlockall\s*\(\s*MCL_FUTURE\s*\|\s*MCL_CURRENT\s*\)', content
            )
            if not has_both_flags:
                violations.append(RealtimeViolation(
                    severity=RealtimeSeverity.WARNING,
                    category="memory_locking",
                    description="mlockall 未同时使用 MCL_CURRENT | MCL_FUTURE 标志",
                    location=file_path,
                    suggestion=(
                        "建议使用 mlockall(MCL_CURRENT | MCL_FUTURE) "
                        "同时锁定当前和未来的内存分配"
                    ),
                ))

        # 子校验 2：检查实时线程栈预分配
        stack_prealloc_patterns = [
            r'pthread_attr_setstacksize\s*\(',
            r'pthread_attr_setstack\s*\(',
            r'PTHREAD_STACK_MIN',
            r'stack_size\s*=',
            r'stacksize\s*=',
        ]

        has_stack_prealloc = any(
            re.search(pattern, content) for pattern in stack_prealloc_patterns
        )

        if not has_stack_prealloc:
            violations.append(RealtimeViolation(
                severity=RealtimeSeverity.WARNING,
                category="memory_locking",
                description="实时线程未显式预分配栈空间",
                location=file_path,
                suggestion=(
                    "建议使用 pthread_attr_setstacksize() 为实时线程预分配栈空间，"
                    "避免运行时栈扩展导致的缺页中断"
                ),
            ))

        # 子校验 3：检查是否禁用了内存过度提交（Linux 特有）
        # 检查是否有设置 vm.overcommit_memory 的代码或注释
        overcommit_patterns = [
            r'overcommit',
            r'vm\.overcommit',
            r'/proc/sys/vm/overcommit',
        ]

        has_overcommit_config = any(
            re.search(pattern, content, re.IGNORECASE)
            for pattern in overcommit_patterns
        )

        if not has_overcommit_config:
            violations.append(RealtimeViolation(
                severity=RealtimeSeverity.INFO,
                category="memory_locking",
                description="未检测到内存过度提交配置（overcommit）相关设置",
                location=file_path,
                suggestion=(
                    "建议在系统初始化时设置 vm.overcommit_memory=2 "
                    "或通过配置文件禁用内存过度提交，避免 OOM 导致的延迟"
                ),
            ))

        # 子校验 4：检查实时线程中是否有堆内存预分配（预热）
        # 检测是否有在初始化阶段预分配关键数据结构的代码
        prealloc_patterns = [
            r'\.reserve\s*\(',     # std::vector::reserve
            r'prealloc',           # 预分配关键词
            r'pre_alloc',          # 预分配关键词
            r'warmup',             # 预热关键词
            r'warm_up',            # 预热关键词
        ]

        has_prealloc = any(
            re.search(pattern, content) for pattern in prealloc_patterns
        )

        if not has_prealloc:
            violations.append(RealtimeViolation(
                severity=RealtimeSeverity.INFO,
                category="memory_locking",
                description="未检测到实时数据结构的预分配/预热代码",
                location=file_path,
                suggestion=(
                    "建议在初始化阶段对实时循环中使用的容器（如 std::vector）"
                    "调用 reserve() 预分配内存，避免运行时动态扩容"
                ),
            ))

        return violations

    def _has_realtime_thread(self, content: str) -> bool:
        """
        检测文件是否包含实时线程相关代码
        运行步骤：
          1. 检查是否包含实时线程创建关键词
          2. 检查是否包含实时调度策略设置
          3. 检查是否包含实时优先级设置
        参数：
          - content: 文件内容
        返回值：是否包含实时线程代码
        """
        realtime_indicators = [
            r'pthread_create\b',
            r'std::thread\b',
            r'SCHED_FIFO',
            r'SCHED_RR',
            r'pthread_setschedparam',
            r'sched_setscheduler',
            r'thread_priority',
            r'rt_priority',
            r'realtime',
            r'real_time',
            r'mlockall',
            r'cpu_set',
            r'CPU_SET',
            r'pthread_attr_setschedpolicy',
            r'pthread_attr_setinheritsched',
        ]

        for indicator in realtime_indicators:
            if re.search(indicator, content):
                return True

        return False

    # ==========================================================
    # 辅助方法：文件收集
    # ==========================================================

    def _collect_source_files(self, directory: str) -> List[str]:
        """
        递归收集目录下所有 C/C++ 和 Python 源文件
        运行步骤：
          1. 递归遍历目录
          2. 过滤出 C/C++ 和 Python 源文件
          3. 跳过构建目录和隐藏目录
        参数：
          - directory: 搜索根目录
        返回值：源文件路径列表
        """
        source_extensions = {
            ".cpp", ".cc", ".cxx", ".c", ".h", ".hpp", ".hxx", ".hh", ".py",
        }
        source_files: List[str] = []
        skip_dirs = {"build", "install", "log", ".git", "__pycache__", "devel", "node_modules"}

        try:
            for root, dirs, files in os.walk(directory):
                # 跳过不需要遍历的目录
                dirs[:] = [
                    d for d in dirs
                    if d not in skip_dirs and not d.startswith(".")
                ]
                for f in files:
                    ext = os.path.splitext(f)[1].lower()
                    if ext in source_extensions:
                        source_files.append(os.path.join(root, f))
        except Exception as e:
            logger.error(f"收集源文件时出错: {e}")

        return source_files
