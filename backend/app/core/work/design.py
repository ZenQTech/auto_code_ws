"""
# TRAE Work - Design Mode
# ============================================================
# 核心作用：实现 TRAE Work 的设计模式（Design Mode）
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
#
# 能力：
#   - 6 类模板：web | mobile | landing | components | poster | dashboard
#   - 设计系统管理（颜色、字体、间距、组件令牌）
#   - 自然语言批量编辑（颜色/圆角/字体/间距/对齐）
#   - 设计 → 代码导出（HTML / React / Tailwind / Vue）
#
# 算法：
#   - 模板生成：基于骨架 + 用户描述拼接 HTML
#   - NL 编辑：基于规则匹配识别编辑意图
#   - 颜色/字号提取：正则匹配 hex/rgb/named colors
#   - 复杂度：O(N) N = 组件数
# ============================================================
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from .models import (
    DesignDraft,
    DesignExportFormat,
    DesignSystem,
    DesignTemplate,
    NLEditChange,
    _new_id,
    _now_iso,
)


# ============================================================
# 模板定义
# ============================================================

# 每个模板的基础骨架（HTML + 组件列表）
TEMPLATES: Dict[str, Dict[str, Any]] = {
    DesignTemplate.WEB.value: {
        "name": "通用 Web 页面",
        "components": ["nav", "hero", "features", "footer"],
        "skeleton": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{name}</title>
  <style>
    body {{ font-family: {font_family}; margin: 0; padding: 0; color: {text_color}; background: {bg_color}; }}
    .nav {{ display: flex; justify-content: space-between; padding: 1rem 2rem; background: {primary_color}; color: white; }}
    .hero {{ padding: 4rem 2rem; text-align: center; background: {bg_color}; }}
    .hero h1 {{ font-size: 2.5rem; color: {primary_color}; margin: 0 0 1rem 0; }}
    .hero p {{ font-size: 1.2rem; color: {text_color}; }}
    .features {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem; padding: 3rem 2rem; }}
    .feature-card {{ background: {card_color}; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }}
    .footer {{ background: {primary_color}; color: white; padding: 2rem; text-align: center; }}
    button {{ background: {primary_color}; color: white; border: none; padding: 0.75rem 1.5rem; border-radius: {btn_radius}; cursor: pointer; font-size: 1rem; }}
    button:hover {{ opacity: 0.9; }}
  </style>
</head>
<body>
  <nav class="nav"><div class="logo">{name}</div><div class="links">首页 | 关于 | 联系</div></nav>
  <section class="hero"><h1>{title}</h1><p>{description}</p><button>了解更多</button></section>
  <section class="features">
    <div class="feature-card"><h3>特性 1</h3><p>高效易用</p></div>
    <div class="feature-card"><h3>特性 2</h3><p>稳定可靠</p></div>
    <div class="feature-card"><h3>特性 3</h3><p>安全可信</p></div>
  </section>
  <footer class="footer">© 2026 {name}. All rights reserved.</footer>
</body>
</html>""",
    },
    DesignTemplate.MOBILE.value: {
        "name": "移动端 App",
        "components": ["statusbar", "header", "content", "tabbar"],
        "skeleton": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{name}</title>
  <style>
    body {{ font-family: {font_family}; margin: 0; background: {bg_color}; color: {text_color}; max-width: 414px; margin: 0 auto; }}
    .statusbar {{ height: 24px; background: {primary_color}; }}
    .header {{ background: {primary_color}; color: white; padding: 1rem; text-align: center; font-size: 1.2rem; font-weight: 600; }}
    .content {{ padding: 1rem; }}
    .card {{ background: {card_color}; padding: 1rem; border-radius: 12px; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }}
    .tabbar {{ position: fixed; bottom: 0; left: 0; right: 0; max-width: 414px; margin: 0 auto; background: {card_color}; display: flex; justify-content: space-around; padding: 0.5rem 0; box-shadow: 0 -1px 3px rgba(0,0,0,0.1); }}
    .tabbar .tab {{ padding: 0.5rem 1rem; color: {text_color}; }}
  </style>
</head>
<body>
  <div class="statusbar"></div>
  <div class="header">{name}</div>
  <div class="content">
    <div class="card"><h3>推荐</h3><p>{description}</p></div>
    <div class="card"><h3>消息</h3><p>您有 3 条新消息</p></div>
  </div>
  <div class="tabbar"><div class="tab">首页</div><div class="tab">消息</div><div class="tab">我的</div></div>
</body>
</html>""",
    },
    DesignTemplate.LANDING.value: {
        "name": "落地页",
        "components": ["nav", "hero", "cta", "testimonials", "footer"],
        "skeleton": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{name} - {description}</title>
  <style>
    body {{ font-family: {font_family}; margin: 0; color: {text_color}; background: {bg_color}; }}
    .nav {{ display: flex; justify-content: space-between; padding: 1.5rem 3rem; }}
    .nav .logo {{ font-size: 1.5rem; font-weight: bold; color: {primary_color}; }}
    .hero {{ padding: 6rem 3rem; text-align: center; background: linear-gradient(135deg, {primary_color}, {secondary_color}); color: white; }}
    .hero h1 {{ font-size: 3.5rem; margin: 0 0 1rem 0; }}
    .hero p {{ font-size: 1.3rem; margin: 0 0 2rem 0; opacity: 0.9; }}
    .cta {{ background: white; color: {primary_color}; padding: 1rem 2.5rem; border: none; border-radius: {btn_radius}; font-size: 1.1rem; font-weight: 600; cursor: pointer; }}
    .testimonials {{ padding: 4rem 3rem; text-align: center; }}
    .footer {{ background: {card_color}; padding: 2rem 3rem; text-align: center; color: {text_color}; }}
  </style>
</head>
<body>
  <nav class="nav"><div class="logo">{name}</div><div>登录 | 注册</div></nav>
  <section class="hero"><h1>{title}</h1><p>{description}</p><button class="cta">立即开始</button></section>
  <section class="testimonials"><h2>用户怎么说</h2><p>"非常棒的产品！" - 客户 A</p></section>
  <footer class="footer">© 2026 {name}</footer>
</body>
</html>""",
    },
    DesignTemplate.COMPONENTS.value: {
        "name": "组件库",
        "components": ["button", "input", "card", "badge", "alert"],
        "skeleton": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>{name} - 组件库</title>
  <style>
    body {{ font-family: {font_family}; padding: 2rem; background: {bg_color}; color: {text_color}; }}
    h2 {{ color: {primary_color}; border-bottom: 2px solid {primary_color}; padding-bottom: 0.5rem; }}
    .demo {{ background: {card_color}; padding: 1.5rem; margin: 1rem 0; border-radius: 8px; }}
    .btn {{ background: {primary_color}; color: white; border: none; padding: 0.5rem 1.25rem; border-radius: {btn_radius}; margin: 0.25rem; cursor: pointer; }}
    .btn-secondary {{ background: {secondary_color}; }}
    .input {{ padding: 0.5rem 1rem; border: 1px solid {secondary_color}; border-radius: {btn_radius}; margin: 0.25rem; }}
    .badge {{ background: {primary_color}; color: white; padding: 0.25rem 0.75rem; border-radius: 12px; font-size: 0.85rem; display: inline-block; margin: 0.25rem; }}
    .alert {{ background: {card_color}; border-left: 4px solid {primary_color}; padding: 1rem; margin: 0.5rem 0; border-radius: 4px; }}
  </style>
</head>
<body>
  <h1>{name} 组件库</h1>
  <h2>按钮 Button</h2>
  <div class="demo"><button class="btn">主要按钮</button><button class="btn btn-secondary">次要按钮</button></div>
  <h2>输入框 Input</h2>
  <div class="demo"><input class="input" placeholder="请输入..."><input class="input" type="password" placeholder="密码"></div>
  <h2>徽章 Badge</h2>
  <div class="demo"><span class="badge">新</span><span class="badge">推荐</span></div>
  <h2>提示 Alert</h2>
  <div class="alert">这是一条提示信息</div>
</body>
</html>""",
    },
    DesignTemplate.POSTER.value: {
        "name": "海报",
        "components": ["title", "subtitle", "image", "cta"],
        "skeleton": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>{name}</title>
  <style>
    body {{ font-family: {font_family}; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, {primary_color}, {secondary_color}); }}
    .poster {{ background: {card_color}; padding: 4rem 3rem; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); text-align: center; max-width: 600px; }}
    .poster h1 {{ font-size: 4rem; color: {primary_color}; margin: 0 0 1rem 0; font-weight: 800; }}
    .poster p {{ font-size: 1.4rem; color: {text_color}; margin: 0 0 2rem 0; }}
    .poster .cta {{ background: {primary_color}; color: white; padding: 1rem 2.5rem; border: none; border-radius: {btn_radius}; font-size: 1.1rem; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="poster">
    <h1>{title}</h1>
    <p>{description}</p>
    <button class="cta">了解更多</button>
  </div>
</body>
</html>""",
    },
    DesignTemplate.DASHBOARD.value: {
        "name": "仪表盘",
        "components": ["sidebar", "stats", "chart", "table"],
        "skeleton": """<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>{name} - 仪表盘</title>
  <style>
    body {{ font-family: {font_family}; margin: 0; display: flex; background: {bg_color}; color: {text_color}; }}
    .sidebar {{ width: 220px; background: {primary_color}; color: white; min-height: 100vh; padding: 2rem 1rem; }}
    .sidebar .item {{ padding: 0.75rem 1rem; margin: 0.25rem 0; border-radius: {btn_radius}; }}
    .sidebar .item.active {{ background: {secondary_color}; }}
    .main {{ flex: 1; padding: 2rem; }}
    .stats {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1.5rem; margin-bottom: 2rem; }}
    .stat-card {{ background: {card_color}; padding: 1.5rem; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }}
    .stat-card .value {{ font-size: 2rem; font-weight: bold; color: {primary_color}; }}
    .chart {{ background: {card_color}; padding: 2rem; border-radius: 8px; min-height: 200px; }}
  </style>
</head>
<body>
  <div class="sidebar">
    <h3>{name}</h3>
    <div class="item active">概览</div>
    <div class="item">用户</div>
    <div class="item">订单</div>
    <div class="item">设置</div>
  </div>
  <div class="main">
    <h1>概览</h1>
    <div class="stats">
      <div class="stat-card"><div>总用户数</div><div class="value">12,345</div></div>
      <div class="stat-card"><div>今日访问</div><div class="value">1,234</div></div>
      <div class="stat-card"><div>订单数</div><div class="value">567</div></div>
    </div>
    <div class="chart">[数据可视化区域]</div>
  </div>
</body>
</html>""",
    },
}


# ============================================================
# NL 编辑指令识别
# ============================================================

# 颜色映射（含 hex 与命名颜色）
COLOR_MAP = {
    "red": "#EF4444", "红": "#EF4444", "红色": "#EF4444",
    "blue": "#3B82F6", "蓝": "#3B82F6", "蓝色": "#3B82F6",
    "green": "#10B981", "绿": "#10B981", "绿色": "#10B981",
    "yellow": "#F59E0B", "黄": "#F59E0B", "黄色": "#F59E0B",
    "purple": "#8B5CF6", "紫": "#8B5CF6", "紫色": "#8B5CF6",
    "pink": "#EC4899", "粉": "#EC4899", "粉色": "#EC4899",
    "orange": "#F97316", "橙": "#F97316", "橙色": "#F97316",
    "black": "#000000", "黑": "#000000", "黑色": "#000000",
    "white": "#FFFFFF", "白": "#FFFFFF", "白色": "#FFFFFF",
    "gray": "#6B7280", "灰": "#6B7280", "灰色": "#6B7280",
    "indigo": "#4F46E5", "靛蓝": "#4F46E5",
    "teal": "#14B8A6", "青": "#14B8A6",
}

# 圆角预设
RADIUS_MAP = {
    "圆角": "8px",
    "rounded": "8px",
    "圆形": "50%",
    "round": "50%",
    "无圆角": "0",
    "sharp": "0",
    "小圆角": "4px",
    "大圆角": "16px",
}

# 字号预设
FONT_SIZE_MAP = {
    "小": "0.875rem", "小号": "0.875rem", "small": "0.875rem",
    "中": "1rem", "中号": "1rem", "medium": "1rem",
    "大": "1.25rem", "大号": "1.25rem", "large": "1.25rem",
    "特大": "1.5rem", "巨大": "2rem",
}

# 字体预设
FONT_FAMILY_MAP = {
    "思源": '"Source Han Sans", sans-serif',
    "黑体": '"Microsoft YaHei", sans-serif',
    "宋体": 'SimSun, serif',
    "等宽": 'Menlo, Monaco, monospace',
    "等线": '"DengXian", sans-serif',
    "inter": '"Inter", sans-serif',
    "roboto": '"Roboto", sans-serif',
}


def _extract_hex_color(text: str) -> Optional[str]:
    """从文本中提取 hex 颜色"""
    m = re.search(r"#[0-9A-Fa-f]{6}\b", text)
    if m:
        return m.group(0).upper()
    return None


def _extract_named_color(text: str) -> Optional[str]:
    """从文本中提取命名颜色"""
    text_lower = text.lower()
    for name, hex_code in COLOR_MAP.items():
        if name in text_lower:
            return hex_code
    return None


def _extract_radius(text: str) -> Optional[str]:
    """提取圆角值"""
    text_lower = text.lower()
    for name, value in RADIUS_MAP.items():
        if name in text_lower:
            return value
    # 匹配 "8px" "16px" 等
    m = re.search(r"(\d+)\s*px", text)
    if m:
        return f"{m.group(1)}px"
    return None


def _extract_font_size(text: str) -> Optional[str]:
    """提取字号"""
    text_lower = text.lower()
    for name, value in FONT_SIZE_MAP.items():
        if name in text_lower:
            return value
    m = re.search(r"(\d+)\s*px", text)
    if m:
        return f"{int(m.group(1)) / 16:.3f}rem"
    return None


def _extract_font_family(text: str) -> Optional[str]:
    """提取字体"""
    text_lower = text.lower()
    for name, value in FONT_FAMILY_MAP.items():
        if name in text_lower:
            return value
    return None


def _extract_target(text: str) -> str:
    """识别编辑目标"""
    text_lower = text.lower()
    if any(k in text_lower for k in ["按钮", "button", "btn"]):
        return "button"
    if any(k in text_lower for k in ["标题", "h1", "title", "heading"]):
        return "h1"
    if any(k in text_lower for k in ["正文", "段落", "paragraph", "text", "p "]):
        return "p"
    if any(k in text_lower for k in ["输入框", "input", "input框"]):
        return "input"
    if any(k in text_lower for k in ["卡片", "card"]):
        return "card"
    if any(k in text_lower for k in ["导航", "nav"]):
        return "nav"
    if any(k in text_lower for k in ["主色", "primary", "主题色", "主颜色"]):
        return "primary"
    if any(k in text_lower for k in ["背景", "background", "bg"]):
        return "bg"
    if any(k in text_lower for k in ["全部", "所有", "all", "every"]):
        return "all"
    return "all"


# ============================================================
# Design Mode 服务类
# ============================================================


class DesignMode:
    """设计模式服务

    功能：
        - 创建草图（6 模板）
        - 自然语言编辑
        - 设计系统管理
        - 代码导出
    """

    def __init__(self) -> None:
        # 内存缓存：draft_id -> DesignDraft
        self._drafts: Dict[str, DesignDraft] = {}
        # 内存缓存：system_id -> DesignSystem
        self._systems: Dict[str, DesignSystem] = {}
        # 线程安全
        import threading
        self._lock = threading.RLock()
        # 统计
        self._stats = {"drafts": 0, "systems": 0, "nl_edits": 0, "exports": 0}

    # ============================================================
    # 草图管理
    # ============================================================

    def create_draft(
        self,
        name: str,
        template: str,
        description: str,
        owner: str = "default_user",
        style: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
    ) -> DesignDraft:
        """创建设计草图

        Args:
            name: 草图名称
            template: 模板类型
            description: 描述
            owner: 所有者
            style: 自定义样式
            tags: 标签列表

        Returns:
            DesignDraft 实例
        """
        if template not in TEMPLATES:
            raise ValueError(f"Unknown template: {template}")
        tpl = TEMPLATES[template]

        # 解析样式
        merged_style = self._default_style()
        if style:
            merged_style.update(style)

        # 生成 HTML
        html = self._render_skeleton(tpl["skeleton"], name, description, merged_style)

        # 提取组件列表
        components = [
            {"type": c, "label": c, "props": {}} for c in tpl["components"]
        ]

        draft = DesignDraft(
            draft_id=_new_id("draft"),
            name=name,
            template=template,
            description=description,
            style=merged_style,
            components=components,
            html=html,
            owner=owner,
            tags=tags or [],
        )

        with self._lock:
            self._drafts[draft.draft_id] = draft
            self._stats["drafts"] += 1

        return draft

    def get_draft(self, draft_id: str) -> Optional[DesignDraft]:
        """获取草图"""
        with self._lock:
            return self._drafts.get(draft_id)

    def list_drafts(
        self,
        owner: Optional[str] = None,
        template: Optional[str] = None,
        limit: int = 50,
    ) -> List[DesignDraft]:
        """列出草图"""
        with self._lock:
            results = list(self._drafts.values())
        if owner:
            results = [d for d in results if d.owner == owner]
        if template:
            results = [d for d in results if d.template == template]
        # 按 updated_at 倒序
        results.sort(key=lambda d: d.updated_at, reverse=True)
        return results[:limit]

    def update_draft(
        self,
        draft_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
        style: Optional[Dict[str, Any]] = None,
        tags: Optional[List[str]] = None,
    ) -> Optional[DesignDraft]:
        """更新草图"""
        with self._lock:
            draft = self._drafts.get(draft_id)
            if not draft:
                return None
            if name is not None:
                draft.name = name
            if description is not None:
                draft.description = description
            if style is not None:
                draft.style.update(style)
            if tags is not None:
                draft.tags = tags
            # 重新渲染 HTML
            tpl = TEMPLATES.get(draft.template)
            if tpl:
                draft.html = self._render_skeleton(
                    tpl["skeleton"], draft.name, draft.description, draft.style
                )
            draft.updated_at = _now_iso()
            draft.version += 1
            return draft

    def delete_draft(self, draft_id: str) -> bool:
        """删除草图"""
        with self._lock:
            if draft_id in self._drafts:
                del self._drafts[draft_id]
                return True
            return False

    # ============================================================
    # 自然语言编辑
    # ============================================================

    def apply_nl_edit(
        self,
        draft_id: str,
        instruction: str,
    ) -> Tuple[Optional[DesignDraft], List[NLEditChange]]:
        """应用自然语言编辑

        Args:
            draft_id: 草图 ID
            instruction: 编辑指令

        Returns:
            (更新后的草图, 变更列表)
        """
        with self._lock:
            draft = self._drafts.get(draft_id)
            if not draft:
                return None, []

        changes: List[NLEditChange] = []
        new_style = dict(draft.style)
        new_html = draft.html

        # 1. 颜色编辑
        new_color = _extract_hex_color(instruction) or _extract_named_color(instruction)
        if new_color:
            target = _extract_target(instruction)
            old = None
            if target == "primary" or target == "all" or "主色" in instruction:
                old = new_style.get("primary_color")
                new_style["primary_color"] = new_color
                # 替换 HTML 中的主色
                if old:
                    new_html = new_html.replace(old, new_color)
                changes.append(
                    NLEditChange(
                        change_id=_new_id("chg"),
                        type="color",
                        target="primary",
                        old_value=old,
                        new_value=new_color,
                        instruction=instruction,
                    )
                )
            elif target == "bg" or "背景" in instruction:
                old = new_style.get("bg_color")
                new_style["bg_color"] = new_color
                if old:
                    new_html = new_html.replace(old, new_color)
                changes.append(
                    NLEditChange(
                        change_id=_new_id("chg"),
                        type="color",
                        target="bg",
                        old_value=old,
                        new_value=new_color,
                        instruction=instruction,
                    )
                )
            elif target == "button" or "按钮" in instruction:
                # 替换 HTML 中 button 相关颜色
                old_btn = new_style.get("primary_color")
                new_html = new_html.replace(old_btn, new_color)
                changes.append(
                    NLEditChange(
                        change_id=_new_id("chg"),
                        type="color",
                        target="button",
                        old_value=old_btn,
                        new_value=new_color,
                        instruction=instruction,
                    )
                )

        # 2. 圆角编辑
        new_radius = _extract_radius(instruction)
        if new_radius and ("圆角" in instruction or "rounded" in instruction.lower() or "圆形" in instruction):
            old = new_style.get("btn_radius")
            new_style["btn_radius"] = new_radius
            if old:
                new_html = re.sub(
                    r"border-radius:\s*" + re.escape(old),
                    f"border-radius: {new_radius}",
                    new_html,
                )
            changes.append(
                NLEditChange(
                    change_id=_new_id("chg"),
                    type="border-radius",
                    target="button",
                    old_value=old,
                    new_value=new_radius,
                    instruction=instruction,
                )
            )

        # 3. 字号编辑
        new_size = _extract_font_size(instruction)
        if new_size and ("字号" in instruction or "字体大小" in instruction or "font-size" in instruction.lower()):
            old = new_style.get("base_font_size", "1rem")
            new_style["base_font_size"] = new_size
            changes.append(
                NLEditChange(
                    change_id=_new_id("chg"),
                    type="font-size",
                    target="all",
                    old_value=old,
                    new_value=new_size,
                    instruction=instruction,
                )
            )

        # 4. 字体编辑
        new_font = _extract_font_family(instruction)
        if new_font and ("字体" in instruction or "font" in instruction.lower()):
            old = new_style.get("font_family")
            new_style["font_family"] = new_font
            if old:
                new_html = new_html.replace(old, new_font)
            changes.append(
                NLEditChange(
                    change_id=_new_id("chg"),
                    type="font-family",
                    target="all",
                    old_value=old,
                    new_value=new_font,
                    instruction=instruction,
                )
            )

        # 5. 间距编辑
        m = re.search(r"间距?\s*[:：]?\s*(\d+)\s*px", instruction)
        if m:
            spacing_val = f"{m.group(1)}px"
            old = new_style.get("spacing_md", "1rem")
            new_style["spacing_md"] = spacing_val
            changes.append(
                NLEditChange(
                    change_id=_new_id("chg"),
                    type="spacing",
                    target="all",
                    old_value=old,
                    new_value=spacing_val,
                    instruction=instruction,
                )
            )

        # 应用变更
        with self._lock:
            draft.style = new_style
            draft.html = new_html
            draft.updated_at = _now_iso()
            draft.version += 1
            self._stats["nl_edits"] += 1

        return draft, changes

    # ============================================================
    # 代码导出
    # ============================================================

    def export_code(
        self,
        draft_id: str,
        export_format: str = "html",
    ) -> Optional[Dict[str, Any]]:
        """导出代码

        Args:
            draft_id: 草图 ID
            export_format: 导出格式

        Returns:
            {"format": ..., "code": ..., "filename": ...}
        """
        with self._lock:
            draft = self._drafts.get(draft_id)
            if not draft:
                return None

        fmt = export_format.lower()
        if fmt == DesignExportFormat.HTML.value:
            code = draft.html
            ext = "html"
        elif fmt == DesignExportFormat.REACT.value:
            code = self._export_react(draft)
            ext = "jsx"
        elif fmt == DesignExportFormat.TAILWIND.value:
            code = self._export_tailwind(draft)
            ext = "html"
        elif fmt == DesignExportFormat.VUE.value:
            code = self._export_vue(draft)
            ext = "vue"
        else:
            raise ValueError(f"Unsupported export format: {export_format}")

        with self._lock:
            self._stats["exports"] += 1

        return {
            "format": fmt,
            "code": code,
            "filename": f"{draft.name}.{ext}",
            "draft_id": draft.draft_id,
            "version": draft.version,
        }

    # ============================================================
    # 设计系统管理
    # ============================================================

    def create_system(
        self,
        name: str,
        colors: Optional[Dict[str, str]] = None,
        typography: Optional[Dict[str, Any]] = None,
        spacing: Optional[Dict[str, int]] = None,
        components: Optional[Dict[str, Any]] = None,
        owner: str = "default_user",
    ) -> DesignSystem:
        """创建设计系统"""
        system = DesignSystem(
            system_id=_new_id("sys"),
            name=name,
            colors=colors or self._default_colors(),
            typography=typography or self._default_typography(),
            spacing=spacing or self._default_spacing(),
            components=components or {},
            owner=owner,
        )
        with self._lock:
            self._systems[system.system_id] = system
            self._stats["systems"] += 1
        return system

    def get_system(self, system_id: str) -> Optional[DesignSystem]:
        """获取设计系统"""
        with self._lock:
            return self._systems.get(system_id)

    def list_systems(self, owner: Optional[str] = None) -> List[DesignSystem]:
        """列出设计系统"""
        with self._lock:
            results = list(self._systems.values())
        if owner:
            results = [s for s in results if s.owner == owner]
        return results

    def update_system(
        self,
        system_id: str,
        colors: Optional[Dict[str, str]] = None,
        typography: Optional[Dict[str, Any]] = None,
        spacing: Optional[Dict[str, int]] = None,
        components: Optional[Dict[str, Any]] = None,
    ) -> Optional[DesignSystem]:
        """更新设计系统"""
        with self._lock:
            system = self._systems.get(system_id)
            if not system:
                return None
            if colors is not None:
                system.colors.update(colors)
            if typography is not None:
                system.typography.update(typography)
            if spacing is not None:
                system.spacing.update(spacing)
            if components is not None:
                system.components.update(components)
            system.updated_at = _now_iso()
            return system

    def delete_system(self, system_id: str) -> bool:
        """删除设计系统"""
        with self._lock:
            if system_id in self._systems:
                del self._systems[system_id]
                return True
            return False

    # ============================================================
    # 内部辅助
    # ============================================================

    def _default_style(self) -> Dict[str, Any]:
        """默认样式"""
        return {
            "primary_color": "#4F46E5",
            "secondary_color": "#10B981",
            "bg_color": "#FFFFFF",
            "card_color": "#F9FAFB",
            "text_color": "#111827",
            "font_family": '"Inter", "Microsoft YaHei", sans-serif',
            "btn_radius": "8px",
            "spacing_md": "1rem",
        }

    def _default_colors(self) -> Dict[str, str]:
        return {
            "primary": "#4F46E5",
            "secondary": "#10B981",
            "accent": "#F59E0B",
            "neutral": "#6B7280",
            "background": "#FFFFFF",
            "surface": "#F9FAFB",
            "text": "#111827",
            "text_secondary": "#6B7280",
        }

    def _default_typography(self) -> Dict[str, Any]:
        return {
            "font_family": '"Inter", "Microsoft YaHei", sans-serif',
            "sizes": {"xs": "0.75rem", "sm": "0.875rem", "md": "1rem", "lg": "1.25rem", "xl": "1.5rem", "2xl": "2rem"},
            "weights": {"regular": 400, "medium": 500, "semibold": 600, "bold": 700},
        }

    def _default_spacing(self) -> Dict[str, int]:
        return {"xs": 4, "sm": 8, "md": 16, "lg": 24, "xl": 32, "2xl": 48}

    def _render_skeleton(
        self,
        skeleton: str,
        name: str,
        description: str,
        style: Dict[str, Any],
    ) -> str:
        """渲染模板骨架"""
        # 安全过滤：去除可能的注入字符
        safe_name = name.replace("{", "").replace("}", "").replace("<", "").replace(">", "")
        safe_desc = description.replace("{", "").replace("}", "").replace("<", "").replace(">", "")
        return skeleton.format(
            name=safe_name,
            title=safe_name,
            description=safe_desc,
            **style,
        )

    def _export_react(self, draft: DesignDraft) -> str:
        """导出为 React JSX"""
        # 简单实现：返回 dangerouslySetInnerHTML 的 React 组件
        escaped_html = draft.html.replace("`", "\\`")
        return f"""import React from 'react';

export default function {self._to_pascal(draft.name)}() {{
  return (
    <div dangerouslySetInnerHTML={{{{ __html: `{escaped_html}` }}}} />
  );
}}
"""

    def _export_tailwind(self, draft: DesignDraft) -> str:
        """导出为 Tailwind 风格 HTML（注释中提示）"""
        return f"""<!-- Tailwind version (建议使用 Tailwind CDN) -->
<!-- Source: TRAE Work Design Mode -->
<!-- Template: {draft.template} -->
{draft.html}
"""

    def _export_vue(self, draft: DesignDraft) -> str:
        """导出为 Vue 组件"""
        escaped_html = draft.html.replace("`", "\\`")
        return f"""<template>
  <div v-html="html"></div>
</template>

<script>
export default {{
  name: '{self._to_pascal(draft.name)}',
  data() {{
    return {{
      html: `{escaped_html}`
    }};
  }}
}};
</script>
"""

    def _to_pascal(self, name: str) -> str:
        """转换为 PascalCase"""
        parts = re.split(r"[\s_-]+", name)
        return "".join(p.capitalize() for p in parts if p)

    def get_stats(self) -> Dict[str, Any]:
        """获取统计"""
        with self._lock:
            return dict(self._stats)


# 全局单例
GLOBAL_DESIGN_MODE = DesignMode()
