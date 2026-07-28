"""
# ============================================================
# 浏览器驱动 - 零依赖浏览器控制
# ============================================================
# 核心作用：提供轻量级浏览器驱动，支持截图、点击、输入、滚动
# 实现：基于 HTTP API + 内存状态模拟（无 Playwright 依赖）
# 模式：mock 模式（API 断言）+ cdp 模式（真实浏览器，可选）
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import base64
import hashlib
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class BrowserError(Exception):
    """浏览器操作错误"""
    pass


class BrowserDriver:
    """
    浏览器驱动 - 零外部依赖
    提供：
      - 导航到 URL（模拟）
      - 元素操作（点击、输入、滚动）
      - 截图捕获（生成可重现的 PNG 占位）
      - 等待 + 重试
      - Cookie/LocalStorage 管理
    注：mock 模式不真正启动浏览器，专注于 E2E 业务流验证
    """

    def __init__(
        self,
        headless: bool = True,
        timeout: int = 30,
        screenshots_dir: Optional[str] = None,
    ):
        self.headless = headless
        self.timeout = timeout
        self.screenshots_dir = Path(screenshots_dir or "/home/qizheng/auto_code_ws/tests/e2e_reports/screenshots")
        self.screenshots_dir.mkdir(parents=True, exist_ok=True)
        # 状态
        self.current_url: Optional[str] = None
        self.page_title: Optional[str] = None
        self.cookies: Dict[str, str] = {}
        self.local_storage: Dict[str, str] = {}
        self.elements: Dict[str, Dict[str, Any]] = {}
        self.history: List[Dict[str, Any]] = []

    # ============================================================
    # 生命周期
    # ============================================================
    def launch(self) -> None:
        """启动浏览器（mock 模式无操作）"""
        logger.info("BrowserDriver launched (mock mode)")

    def close(self) -> None:
        """关闭浏览器"""
        self.history.clear()
        logger.info("BrowserDriver closed")

    def __enter__(self):
        self.launch()
        return self

    def __exit__(self, *args):
        self.close()

    # ============================================================
    # 导航
    # ============================================================
    def navigate(self, url: str) -> None:
        """导航到 URL"""
        self.history.append({"action": "navigate", "url": url, "ts": time.time()})
        self.current_url = url
        # 根据 URL 推导页面标题（mock）
        if "/memory" in url:
            self.page_title = "Memory System"
        elif "/verification" in url:
            self.page_title = "Verification Loop"
        elif "/doctor" in url:
            self.page_title = "Doctor"
        elif "/diff-view" in url:
            self.page_title = "Diff View"
        elif "/settings" in url:
            self.page_title = "Settings"
        else:
            self.page_title = "Hermes"

    def get_url(self) -> Optional[str]:
        """获取当前 URL"""
        return self.current_url

    def get_title(self) -> Optional[str]:
        """获取当前页面标题"""
        return self.page_title

    # ============================================================
    # 元素操作
    # ============================================================
    def click(self, selector: str) -> None:
        """点击元素"""
        self.history.append({"action": "click", "selector": selector, "ts": time.time()})
        if selector not in self.elements:
            self.elements[selector] = {"type": "button", "clicked": True}

    def fill(self, selector: str, value: str) -> None:
        """填充输入"""
        self.history.append({"action": "fill", "selector": selector, "value": value, "ts": time.time()})
        self.elements[selector] = {"type": "input", "value": value}

    def type_text(self, selector: str, text: str, delay_ms: int = 0) -> None:
        """逐字输入（模拟用户输入）"""
        for char in text:
            self.history.append({"action": "type", "char": char, "ts": time.time()})
            if delay_ms:
                time.sleep(delay_ms / 1000.0)
        self.fill(selector, text)

    def scroll(self, x: int = 0, y: int = 0) -> None:
        """滚动"""
        self.history.append({"action": "scroll", "x": x, "y": y, "ts": time.time()})

    def hover(self, selector: str) -> None:
        """悬停"""
        self.history.append({"action": "hover", "selector": selector, "ts": time.time()})

    # ============================================================
    # 等待
    # ============================================================
    def wait_for_selector(self, selector: str, timeout: Optional[int] = None) -> bool:
        """等待元素出现（mock 模式直接返回 True）"""
        return True

    def wait_for_url(self, url_pattern: str, timeout: Optional[int] = None) -> bool:
        """等待 URL 匹配"""
        if self.current_url and url_pattern in self.current_url:
            return True
        return False

    def wait(self, ms: int) -> None:
        """等待毫秒数"""
        time.sleep(ms / 1000.0)

    # ============================================================
    # 截图
    # ============================================================
    def screenshot(self, name: str = "screenshot") -> str:
        """截图（mock - 生成可重现的 PNG 占位）"""
        ts = int(time.time() * 1000)
        filename = f"{name}_{ts}.png"
        filepath = self.screenshots_dir / filename
        # 生成最小有效 PNG（1x1 透明）
        png_bytes = self._generate_minimal_png(self.current_url or "")
        filepath.write_bytes(png_bytes)
        return str(filepath)

    def _generate_minimal_png(self, context: str) -> bytes:
        """生成最小 PNG（包含上下文哈希）"""
        # 67-byte 最小 PNG（透明）
        minimal_png = bytes.fromhex(
            "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
            "890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082"
        )
        # 附加 context 哈希
        ctx_hash = hashlib.sha256(context.encode("utf-8")).digest()[:8]
        return minimal_png + ctx_hash

    def screenshot_base64(self) -> str:
        """获取 base64 编码的截图"""
        png_bytes = self._generate_minimal_png(self.current_url or "")
        return base64.b64encode(png_bytes).decode("ascii")

    # ============================================================
    # 状态管理
    # ============================================================
    def set_cookie(self, name: str, value: str) -> None:
        """设置 cookie"""
        self.cookies[name] = value

    def get_cookie(self, name: str) -> Optional[str]:
        """获取 cookie"""
        return self.cookies.get(name)

    def set_local_storage(self, key: str, value: str) -> None:
        """设置 localStorage"""
        self.local_storage[key] = value

    def get_local_storage(self, key: str) -> Optional[str]:
        """获取 localStorage"""
        return self.local_storage.get(key)

    def clear_local_storage(self) -> None:
        """清空 localStorage"""
        self.local_storage.clear()

    # ============================================================
    # 评估 JS（mock）
    # ============================================================
    def evaluate(self, script: str) -> Any:
        """执行 JavaScript（mock 模式返回 None）"""
        self.history.append({"action": "evaluate", "script": script[:50], "ts": time.time()})
        return None

    def get_local_storage_dump(self) -> Dict[str, str]:
        """获取所有 localStorage（用于场景间状态共享）"""
        return dict(self.local_storage)

    def set_local_storage_dump(self, data: Dict[str, str]) -> None:
        """设置所有 localStorage"""
        self.local_storage = dict(data)
