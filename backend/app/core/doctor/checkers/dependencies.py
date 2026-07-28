"""
# ============================================================
# Dependencies Checker - 依赖检查
# ============================================================
# 检查项：fastapi / sqlalchemy / httpx / pydantic / uvicorn /
#        frontend_node_modules / dist_exists
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

import importlib.metadata
from pathlib import Path
from typing import List, Optional, Tuple

from ..base import (
    BaseChecker,
    CheckItem,
    CheckStatus,
    _compare_versions,
)


class DependenciesChecker(BaseChecker):
    """依赖检查器"""

    category = "dependencies"
    title = "依赖项"
    default_timeout = 5.0

    # 核心包及其最低版本要求
    REQUIRED_PACKAGES = {
        "fastapi": "0.100.0",
        "sqlalchemy": "2.0.0",
        "httpx": "0.24.0",
        "pydantic": "2.0.0",
        "uvicorn": "0.23.0",
        "pytest": "7.0.0",
    }

    def run_checks(self) -> List[CheckItem]:
        items: List[CheckItem] = []
        for pkg, min_version in self.REQUIRED_PACKAGES.items():
            items.append(self._check_python_package(pkg, min_version))
        items.append(self._check_frontend_node_modules())
        items.append(self._check_frontend_dist())
        return items

    def _get_package_version(self, package_name: str) -> Optional[str]:
        """获取已安装包的版本"""
        try:
            return importlib.metadata.version(package_name)
        except importlib.metadata.PackageNotFoundError:
            return None
        except Exception:
            return None

    def _check_python_package(self, package_name: str, min_version: str) -> CheckItem:
        """Python 包版本检查"""
        version = self._get_package_version(package_name)
        check_id = f"dependencies.{package_name}"
        if not version:
            return self.make_item(
                check_id=check_id,
                name=package_name,
                description=f"Python 包 {package_name}",
                status=CheckStatus.ERROR.value,
                value=None,
                expected=f">= {min_version}",
                message=f"{package_name} 未安装",
                fix_suggestion=f"pip install {package_name}>={min_version}",
            )
        ok = _compare_versions(version, min_version) == 1
        return self.make_item(
            check_id=check_id,
            name=package_name,
            description=f"Python 包 {package_name}",
            status=CheckStatus.OK.value if ok else CheckStatus.WARNING.value,
            value=version,
            expected=f">= {min_version}",
            message=f"{package_name} {version}" + (f" (< {min_version})" if not ok else ""),
            fix_suggestion=f"pip install --upgrade {package_name}" if not ok else None,
        )

    def _check_frontend_node_modules(self) -> CheckItem:
        """前端 node_modules 检查"""
        # 从项目路径推断 frontend 目录
        candidates = [
            self.project_path / "frontend" / "node_modules",
            self.project_path / "node_modules",
        ]
        for path in candidates:
            if path.exists() and path.is_dir():
                # 检查 package.json 是否存在
                pkg_json = path.parent / "package.json"
                if pkg_json.exists():
                    return self.make_item(
                        check_id="dependencies.frontend_node_modules",
                        name="Frontend Node Modules",
                        description="前端依赖目录",
                        status=CheckStatus.OK.value,
                        value=str(path),
                        message=f"node_modules 存在: {path}",
                    )
        return self.make_item(
            check_id="dependencies.frontend_node_modules",
            name="Frontend Node Modules",
            description="前端依赖目录",
            status=CheckStatus.WARNING.value,
            value=None,
            message="node_modules 不存在",
            fix_suggestion="cd frontend && npm install",
        )

    def _check_frontend_dist(self) -> CheckItem:
        """前端 dist 目录检查"""
        candidates = [
            self.project_path / "frontend" / "dist",
            self.project_path / "dist",
        ]
        for path in candidates:
            if path.exists() and path.is_dir():
                # 检查是否有 index.html
                index_html = path / "index.html"
                if index_html.exists():
                    return self.make_item(
                        check_id="dependencies.dist_exists",
                        name="Frontend dist",
                        description="前端构建产物",
                        status=CheckStatus.OK.value,
                        value=str(path),
                        message=f"dist/ 存在: {path}",
                    )
        return self.make_item(
            check_id="dependencies.dist_exists",
            name="Frontend dist",
            description="前端构建产物",
            status=CheckStatus.WARNING.value,
            value=None,
            message="dist/ 不存在",
            fix_suggestion="cd frontend && npm run build",
        )
