"""
# ============================================================
# GitHub 仓库管理服务模块（V1.0.0）
# ============================================================
# 核心作用：通过 GitHub REST API 管理 GitHub 仓库，提供仓库的
#           创建、查询、列表、删除等操作，封装 HTTP 请求与异常处理
# 运行流程：
#   1. 初始化时从环境变量 GITHUB_TOKEN 读取认证令牌
#   2. 若令牌缺失则记录 WARNING 日志，所有方法返回 {success: false}
#   3. 各方法通过 httpx.AsyncClient 向 GitHub API 发送请求
#   4. 统一处理 HTTP 错误、网络异常，所有方法永不抛出异常
#   5. get_username() 首次调用后缓存用户名，避免重复请求
# 输入参数：
#   - GITHUB_TOKEN: str，环境变量，GitHub 个人访问令牌（必填）
# 输出结果：各方法返回 Dict / List[Dict] / Optional[Dict] / str
# 修改记录：
#   - 2026-06-26 | v1.0.0 | 初始版本，实现 GitHub 仓库 CRUD 管理
# ============================================================
"""

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# GitHub API 基础 URL
GITHUB_API_BASE = "https://api.github.com"


class GitHubRepoManager:
    """
    GitHub 仓库管理服务类
    作用：封装 GitHub REST API 调用，提供仓库的创建、查询、列表、删除功能
    调用方：API 路由层、工作流编排层
    被调用方：httpx.AsyncClient（HTTP 客户端）
    """

    def __init__(self):
        """
        初始化 GitHub 仓库管理器
        运行步骤：
          1. 从环境变量 GITHUB_TOKEN 读取认证令牌
          2. 若令牌缺失则记录 WARNING 日志，self.token 置为 None
          3. 初始化 httpx.AsyncClient 实例（延迟创建，按需复用）
          4. 初始化用户名缓存 _username
        """
        # 从环境变量读取 GitHub 个人访问令牌
        self.token: Optional[str] = os.environ.get("GITHUB_TOKEN")

        if self.token is None:
            logger.warning(
                "GITHUB_TOKEN 环境变量未设置，GitHub 仓库管理功能不可用"
            )
        else:
            # 日志中仅输出令牌前 4 位 + ****，严禁泄露完整令牌
            logger.info(
                f"GitHub 仓库管理器已初始化，令牌: {self.token[:4]}****"
            )

        # HTTP 客户端实例（延迟初始化，确保在异步上下文中创建）
        self._client: Optional[httpx.AsyncClient] = None

        # 用户名缓存（首次调用 get_username() 后缓存）
        self._username: Optional[str] = None

    # ============================================================
    # 内部工具方法
    # ============================================================

    async def _get_client(self) -> httpx.AsyncClient:
        """
        获取或创建 httpx.AsyncClient 实例（延迟初始化）
        运行步骤：
          1. 若 _client 已存在且未关闭则直接返回
          2. 否则创建新的 AsyncClient，配置通用请求头
        返回值：httpx.AsyncClient 实例
        """
        if self._client is None or self._client.is_closed:
            # 构建通用请求头：User-Agent 为 GitHub API 强制要求
            headers = {
                "Accept": "application/vnd.github+json",
                "User-Agent": "auto-code-platform",
            }
            if self.token:
                headers["Authorization"] = f"Bearer {self.token}"

            self._client = httpx.AsyncClient(
                headers=headers,
                timeout=httpx.Timeout(30.0),
            )
        return self._client

    def _check_token(self) -> Optional[Dict[str, Any]]:
        """
        检查令牌是否可用，不可用时返回错误响应
        返回值：若令牌缺失返回 {success: False, message: ...}，否则返回 None
        """
        if self.token is None:
            return {
                "success": False,
                "message": "GITHUB_TOKEN 环境变量未设置，无法执行 GitHub 操作",
            }
        return None

    async def _request(
        self,
        method: str,
        url: str,
        json_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        统一 HTTP 请求封装，处理异常并返回标准化响应
        运行步骤：
          1. 获取 httpx 客户端
          2. 发送 HTTP 请求
          3. 解析响应状态码与 JSON 内容
          4. 捕获所有异常并返回错误字典
        参数：
          - method: HTTP 方法（GET/POST/DELETE）
          - url: 请求 URL
          - json_data: 请求体 JSON 数据（可选）
        返回值：字典，包含 status_code、json、success 等字段
        """
        try:
            client = await self._get_client()
            response = await client.request(
                method=method,
                url=url,
                json=json_data,
            )
            # 尝试解析 JSON 响应体
            try:
                body = response.json()
            except Exception:
                body = {"message": response.text}

            return {
                "success": response.is_success,
                "status_code": response.status_code,
                "json": body,
                "headers": dict(response.headers),
            }
        except httpx.TimeoutException:
            logger.error(f"GitHub API 请求超时: {method} {url}")
            return {
                "success": False,
                "status_code": 0,
                "json": {"message": "请求超时"},
                "headers": {},
            }
        except httpx.NetworkError as e:
            logger.error(f"GitHub API 网络错误: {method} {url} - {e}")
            return {
                "success": False,
                "status_code": 0,
                "json": {"message": f"网络错误: {str(e)}"},
                "headers": {},
            }
        except Exception as e:
            logger.error(f"GitHub API 请求异常: {method} {url} - {e}")
            return {
                "success": False,
                "status_code": 0,
                "json": {"message": f"请求异常: {str(e)}"},
                "headers": {},
            }

    # ============================================================
    # 公共方法
    # ============================================================

    async def get_username(self) -> str:
        """
        获取当前认证用户的 GitHub 用户名
        运行步骤：
          1. 检查令牌是否可用
          2. 若已缓存则直接返回缓存值
          3. 调用 GET /user 获取用户信息
          4. 缓存 login 字段并返回
        返回值：GitHub 用户名（login），失败时返回空字符串
        """
        token_error = self._check_token()
        if token_error:
            return ""

        # 优先返回缓存值，减少 API 调用
        if self._username is not None:
            return self._username

        result = await self._request("GET", f"{GITHUB_API_BASE}/user")
        if result["success"]:
            self._username = result["json"].get("login", "")
            logger.debug(f"已获取 GitHub 用户名: {self._username}")
            return self._username

        logger.error(f"获取 GitHub 用户名失败: {result['json'].get('message', '未知错误')}")
        return ""

    async def create_repository(
        self,
        repo_name: str,
        description: str = "",
        private: bool = True,
    ) -> Dict[str, Any]:
        """
        创建 GitHub 仓库
        运行步骤：
          1. 检查令牌是否可用
          2. 构建请求体（name、description、private）
          3. 调用 POST /user/repos 创建仓库
          4. 若返回 409（仓库已存在），则获取已有仓库信息并返回成功
          5. 提取 repo_url、clone_url、html_url 并返回
        参数：
          - repo_name: 仓库名称（必填）
          - description: 仓库描述（可选，默认空字符串）
          - private: 是否私有仓库（默认 True）
        返回值：字典，包含 success、repo_url、clone_url、html_url、message
        """
        token_error = self._check_token()
        if token_error:
            return token_error

        # 构建请求体
        request_body = {
            "name": repo_name,
            "description": description,
            "private": private,
        }

        logger.info(f"正在创建 GitHub 仓库: {repo_name}")

        result = await self._request(
            "POST",
            f"{GITHUB_API_BASE}/user/repos",
            json_data=request_body,
        )

        # 处理仓库已存在的情况（HTTP 409）
        if result["status_code"] == 409:
            logger.info(f"仓库 {repo_name} 已存在，尝试获取已有仓库信息")
            existing = await self.get_repository(repo_name)
            if existing:
                return {
                    "success": True,
                    "repo_url": existing.get("url", ""),
                    "clone_url": existing.get("clone_url", ""),
                    "html_url": existing.get("html_url", ""),
                    "message": f"仓库 {repo_name} 已存在",
                }
            return {
                "success": False,
                "repo_url": "",
                "clone_url": "",
                "html_url": "",
                "message": f"仓库 {repo_name} 已存在，但获取详情失败",
            }

        if result["success"]:
            repo_data = result["json"]
            logger.info(f"GitHub 仓库创建成功: {repo_name}")
            return {
                "success": True,
                "repo_url": repo_data.get("url", ""),
                "clone_url": repo_data.get("clone_url", ""),
                "html_url": repo_data.get("html_url", ""),
                "message": f"仓库 {repo_name} 创建成功",
            }

        # 创建失败
        error_msg = result["json"].get("message", "未知错误")
        logger.error(f"创建 GitHub 仓库失败: {repo_name} - {error_msg}")
        return {
            "success": False,
            "repo_url": "",
            "clone_url": "",
            "html_url": "",
            "message": f"创建仓库失败: {error_msg}",
        }

    async def get_repository(self, repo_name: str) -> Optional[Dict[str, Any]]:
        """
        获取指定仓库的详细信息
        运行步骤：
          1. 检查令牌是否可用
          2. 获取当前用户名
          3. 调用 GET /repos/{username}/{repo_name}
          4. 返回仓库信息字典或 None
        参数：
          - repo_name: 仓库名称
        返回值：仓库信息字典（成功）或 None（失败/不存在）
        """
        token_error = self._check_token()
        if token_error:
            return None

        username = await self.get_username()
        if not username:
            logger.error("无法获取 GitHub 用户名，get_repository 失败")
            return None

        result = await self._request(
            "GET",
            f"{GITHUB_API_BASE}/repos/{username}/{repo_name}",
        )

        if result["success"]:
            return result["json"]

        # 仓库不存在时返回 None，不记录 ERROR（属于正常业务场景）
        if result["status_code"] == 404:
            logger.debug(f"仓库不存在: {username}/{repo_name}")
            return None

        logger.error(
            f"获取仓库信息失败: {username}/{repo_name} - "
            f"{result['json'].get('message', '未知错误')}"
        )
        return None

    async def list_repositories(self) -> List[Dict[str, Any]]:
        """
        获取当前用户的所有仓库列表（最多 100 个）
        运行步骤：
          1. 检查令牌是否可用
          2. 调用 GET /user/repos?per_page=100
          3. 返回仓库信息列表
        返回值：仓库信息字典列表，失败时返回空列表
        """
        token_error = self._check_token()
        if token_error:
            return []

        logger.debug("正在获取 GitHub 仓库列表")

        result = await self._request(
            "GET",
            f"{GITHUB_API_BASE}/user/repos?per_page=100",
        )

        if result["success"]:
            repos = result["json"]
            logger.debug(f"获取到 {len(repos)} 个 GitHub 仓库")
            return repos

        logger.error(
            f"获取仓库列表失败: {result['json'].get('message', '未知错误')}"
        )
        return []

    async def delete_repository(self, repo_name: str) -> Dict[str, Any]:
        """
        删除指定仓库
        运行步骤：
          1. 检查令牌是否可用
          2. 获取当前用户名
          3. 调用 DELETE /repos/{username}/{repo_name}
          4. 返回删除结果
        参数：
          - repo_name: 仓库名称
        返回值：字典，包含 success、message
        """
        token_error = self._check_token()
        if token_error:
            return token_error

        username = await self.get_username()
        if not username:
            return {
                "success": False,
                "message": "无法获取 GitHub 用户名，delete_repository 失败",
            }

        logger.info(f"正在删除 GitHub 仓库: {username}/{repo_name}")

        result = await self._request(
            "DELETE",
            f"{GITHUB_API_BASE}/repos/{username}/{repo_name}",
        )

        if result["success"] or result["status_code"] == 204:
            logger.info(f"GitHub 仓库已删除: {username}/{repo_name}")
            return {
                "success": True,
                "message": f"仓库 {repo_name} 已删除",
            }

        # 仓库不存在
        if result["status_code"] == 404:
            logger.warning(f"仓库不存在，无法删除: {username}/{repo_name}")
            return {
                "success": False,
                "message": f"仓库 {repo_name} 不存在",
            }

        error_msg = result["json"].get("message", "未知错误")
        logger.error(f"删除仓库失败: {username}/{repo_name} - {error_msg}")
        return {
            "success": False,
            "message": f"删除仓库失败: {error_msg}",
        }

    async def close(self):
        """
        关闭 HTTP 客户端连接，释放资源
        运行步骤：
          1. 检查 _client 是否存在且未关闭
          2. 调用 aclose() 关闭连接
        """
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()
            logger.debug("GitHub HTTP 客户端已关闭")
