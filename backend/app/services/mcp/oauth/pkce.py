"""
# ============================================================
# PKCE (Proof Key for Code Exchange) 实现 - RFC 7636
# ============================================================
# 核心作用：实现 PKCE S256 算法的 code_verifier 和 code_challenge
# 安全要求：
#   - code_verifier: 43-128 字符，A-Z/a-z/0-9/-/_ 中的随机字符串
#   - code_challenge: BASE64URL(SHA256(code_verifier))
#   - 仅支持 S256 method（强制）
# 关联规范：RFC 7636 §4.1, §4.2
# 创建日期：2026-07-27
# 模块版本：v1.0.0 - Cycle 7 P0-8
# ============================================================
"""

import secrets
import hashlib
import base64
import string
import re
from typing import Final

# PKCE 参数常量
PKCE_MIN_VERIFIER_LENGTH: Final[int] = 43
PKCE_MAX_VERIFIER_LENGTH: Final[int] = 128
PKCE_VERIFIER_ALPHABET: Final[str] = string.ascii_letters + string.digits + "-._~"

# code_verifier 字符集校验（RFC 7636 §4.1）
PKCE_VERIFIER_PATTERN: Final[re.Pattern] = re.compile(r"^[A-Za-z0-9\-._~]+$")


def generate_code_verifier(length: int = 64) -> str:
    """
    生成符合 RFC 7636 §4.1 的 PKCE code_verifier

    参数：
        length: code_verifier 长度（43-128 字符），默认 64

    返回：
        随机生成的 code_verifier 字符串

    异常：
        ValueError: 当 length 不在 [43, 128] 范围内
    """
    if length < PKCE_MIN_VERIFIER_LENGTH or length > PKCE_MAX_VERIFIER_LENGTH:
        raise ValueError(
            f"code_verifier 长度必须在 [{PKCE_MIN_VERIFIER_LENGTH}, {PKCE_MAX_VERIFIER_LENGTH}] 范围内，得到 {length}"
        )

    # 使用 secrets 模块的 choice 函数保证密码学安全
    return "".join(secrets.choice(PKCE_VERIFIER_ALPHABET) for _ in range(length))


def compute_code_challenge_s256(code_verifier: str) -> str:
    """
    计算 PKCE S256 code_challenge（RFC 7636 §4.2）

    算法：BASE64URL(SHA256(code_verifier))

    参数：
        code_verifier: 之前生成的 code_verifier

    返回：
        43 字符的 BASE64URL 编码的 code_challenge

    异常：
        ValueError: 当 code_verifier 格式无效
    """
    # 校验长度
    if len(code_verifier) < PKCE_MIN_VERIFIER_LENGTH or len(code_verifier) > PKCE_MAX_VERIFIER_LENGTH:
        raise ValueError(
            f"code_verifier 长度必须在 [{PKCE_MIN_VERIFIER_LENGTH}, {PKCE_MAX_VERIFIER_LENGTH}] 范围内，得到 {len(code_verifier)}"
        )

    # 校验字符集
    if not PKCE_VERIFIER_PATTERN.match(code_verifier):
        raise ValueError(
            f"code_verifier 包含非法字符，仅允许 [A-Z/a-z/0-9/-/./_/~]"
        )

    # 计算 SHA256 摘要
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()

    # BASE64URL 编码（无 padding，替换 +/ 为 -_）
    challenge = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")

    return challenge


def verify_pkce_pair(code_verifier: str, code_challenge: str, method: str = "S256") -> bool:
    """
    验证 PKCE code_verifier 与 code_challenge 是否匹配

    参数：
        code_verifier: 客户端提交的 code_verifier
        code_challenge: 注册时保存的 code_challenge
        method: 挑战方法（仅支持 S256，禁用 plain）

    返回：
        匹配返回 True，否则 False

    异常：
        ValueError: 当 method 不是 S256（安全策略强制）
    """
    # 安全策略：仅允许 S256（防降级攻击）
    if method != "S256":
        raise ValueError(
            f"不支持的 PKCE method: {method}，仅允许 S256（MCP 规范 2026-06-18 强制）"
        )

    # 重新计算挑战并比对
    try:
        expected_challenge = compute_code_challenge_s256(code_verifier)
    except ValueError:
        return False

    # 使用恒定时间比较防计时攻击
    return secrets.compare_digest(expected_challenge, code_challenge)
