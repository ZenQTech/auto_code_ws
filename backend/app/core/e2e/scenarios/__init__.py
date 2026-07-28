"""
# ============================================================
# 8 大核心场景 - P2-1 Playwright E2E
# ============================================================
# 核心作用：实现 8 大核心 E2E 场景
# 包含：启动/路由、模式切换、Session 管理、消息流式、
#       需求澄清、架构设计、Doctor 诊断、全链路回归
# Cycle 11 P2-1 新建
# ============================================================
"""

from .s1_app_startup import S1AppStartup
from .s2_mode_switch import S2ModeSwitch
from .s3_session_management import S3SessionManagement
from .s4_message_streaming import S4MessageStreaming
from .s5_clarification import S5Clarification
from .s6_architecture_design import S6ArchitectureDesign
from .s7_doctor_diagnosis import S7DoctorDiagnosis
from .s8_e2e_regression import S8E2ERegression

__all__ = [
    "S1AppStartup",
    "S2ModeSwitch",
    "S3SessionManagement",
    "S4MessageStreaming",
    "S5Clarification",
    "S6ArchitectureDesign",
    "S7DoctorDiagnosis",
    "S8E2ERegression",
]
