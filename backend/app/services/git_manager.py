"""
# ============================================================
# Git 版本管理服务模块（V4.1）
# ============================================================
# 核心作用：提供完整的 Git 版本管理能力，包括仓库初始化、
#           分支管理、自动提交、版本标签、合并冲突检测、
#           人工修改检测等功能
# 运行流程：
#   1. 初始化时读取 Git 配置（分支策略、提交模式等）
#   2. 自动检测/初始化 Git 仓库
#   3. 根据配置创建/管理分支
#   4. 按模块/里程碑模式执行自动提交
#   5. 语义化版本标签管理
#   6. 合并前冲突检测与人工修改检测
# 输入参数：
#   - repo_path: str，Git 仓库路径（默认为项目根目录）
#   - config: dict，Git 配置字典（从 settings.git_config 读取）
# 输出结果：GitManager 实例，提供各类 Git 操作方法
# 修改记录：
#   - 2026-06-24 | v4.1.0 | 初始版本，实现完整 Git 版本管理能力
#   - 2026-06-26 | v4.2.0 | 新增 commit_module_changes、push_module_branch 方法，
#     支持模块级提交与推送，供 CommitHookHandler 调用
#   - 2026-06-26 | v4.3.0 | 重构 commit_module_changes、push_module_branch 为异步方法，
#     基于 worktree 目录执行 git 操作；新增 setup_remote（集成 GitHubRepoManager）、
#     push_main_branch（合并 module/* 分支后推送 main）、check_uncommitted_changes、
#     auto_commit_fallback（兜底自动提交）、_find_worktree_for_module 辅助方法
#   - 2026-07-23 | v4.4.0 | Bug 4 修复：新增 init_and_push_docs 异步方法，
#     封装 _init_repository + 文件写入 + git add/commit 流程，
#     解决 ArchitectureWorkflowService._create_git_repo_and_commit 调用
#     不存在方法的问题
# ============================================================
"""

import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum

import git
from git import Repo, GitCommandError, InvalidGitRepositoryError, NoSuchPathError

logger = logging.getLogger(__name__)


# ============================================================
# 枚举与数据类定义
# ============================================================

class BranchStrategy(str, Enum):
    """
    分支策略枚举
    取值：
      - DEFAULT: 默认双分支模式（main + dev）
      - GITFLOW: Gitflow 兼容模式（master/develop/feature/release）
      - CUSTOM: 用户自定义分支名
    """
    DEFAULT = "default"
    GITFLOW = "gitflow"
    CUSTOM = "custom"


class CommitMode(str, Enum):
    """
    自动提交模式枚举
    取值：
      - PER_MODULE: 每个模块完成 dev-check-test 循环后提交
      - MILESTONE: 在 4 个关键里程碑节点提交
      - DISABLED: 关闭自动提交
    """
    PER_MODULE = "per_module"
    MILESTONE = "milestone"
    DISABLED = "disabled"


class MilestoneType(str, Enum):
    """
    里程碑类型枚举
    取值：
      - ARCHITECTURE_CONFIRMED: 架构确认完成
      - ALL_MODULES_DONE: 所有模块开发完成
      - INTEGRATION_PASSED: 集成校验通过
      - FINAL_DELIVERY: 最终交付
    """
    ARCHITECTURE_CONFIRMED = "architecture_confirmed"
    ALL_MODULES_DONE = "all_modules_done"
    INTEGRATION_PASSED = "integration_passed"
    FINAL_DELIVERY = "final_delivery"


@dataclass
class GitStatus:
    """
    Git 仓库状态数据类
    字段说明：
      - is_repo: 是否为有效的 Git 仓库
      - current_branch: 当前分支名
      - is_clean: 工作区是否干净（无未提交变更）
      - modified_files: 已修改但未暂存的文件列表
      - staged_files: 已暂存但未提交的文件列表
      - untracked_files: 未跟踪的新文件列表
      - ahead_count: 领先远程的提交数
      - behind_count: 落后远程的提交数
      - last_commit: 最近一次提交信息
      - tags: 当前分支上的标签列表
    """
    is_repo: bool = False
    current_branch: str = ""
    is_clean: bool = True
    modified_files: List[str] = field(default_factory=list)
    staged_files: List[str] = field(default_factory=list)
    untracked_files: List[str] = field(default_factory=list)
    ahead_count: int = 0
    behind_count: int = 0
    last_commit: str = ""
    tags: List[str] = field(default_factory=list)


@dataclass
class CommitResult:
    """
    提交结果数据类
    字段说明：
      - success: 是否提交成功
      - commit_hash: 提交哈希值
      - message: 提交信息
      - files_changed: 变更文件列表
      - human_changes_detected: 是否检测到人工修改
      - human_changes_warning: 人工修改警告信息
    """
    success: bool = False
    commit_hash: str = ""
    message: str = ""
    files_changed: List[str] = field(default_factory=list)
    human_changes_detected: bool = False
    human_changes_warning: str = ""


@dataclass
class TagResult:
    """
    标签创建结果数据类
    字段说明：
      - success: 是否创建成功
      - tag_name: 标签名称
      - commit_hash: 标签指向的提交哈希
      - message: 标签附注信息
    """
    success: bool = False
    tag_name: str = ""
    commit_hash: str = ""
    message: str = ""


@dataclass
class MergeCheckResult:
    """
    合并冲突检测结果数据类
    字段说明：
      - can_merge: 是否可以安全合并
      - has_conflicts: 是否存在冲突
      - conflict_files: 冲突文件列表
      - source_branch: 源分支名
      - target_branch: 目标分支名
      - details: 详细说明
    """
    can_merge: bool = False
    has_conflicts: bool = False
    conflict_files: List[str] = field(default_factory=list)
    source_branch: str = ""
    target_branch: str = ""
    details: str = ""


@dataclass
class BranchInfo:
    """
    分支信息数据类
    字段说明：
      - name: 分支名称
      - is_current: 是否为当前分支
      - is_protected: 是否为保护分支
      - last_commit: 最近一次提交信息
      - last_commit_date: 最近一次提交日期
    """
    name: str = ""
    is_current: bool = False
    is_protected: bool = False
    last_commit: str = ""
    last_commit_date: str = ""


@dataclass
class CommitLogEntry:
    """
    提交日志条目数据类
    字段说明：
      - hash: 提交哈希值
      - author: 提交作者
      - date: 提交日期
      - message: 提交信息
      - is_auto_commit: 是否为自动提交
    """
    hash: str = ""
    author: str = ""
    date: str = ""
    message: str = ""
    is_auto_commit: bool = False


@dataclass
class FileDiffEntry:
    """
    文件级 diff 数据类（v4.5.0 新增 - Module D DiffView 增强）
    字段说明：
      - path: 文件路径
      - status: 变更类型（modified / added / deleted / renamed / untracked）
      - additions: 新增行数
      - deletions: 删除行数
      - patch: 完整 diff patch 文本（已加行/已减行/上下文）
      - is_staged: 是否已暂存
    """
    path: str = ""
    status: str = "modified"
    additions: int = 0
    deletions: int = 0
    patch: str = ""
    is_staged: bool = False


# ============================================================
# 默认 .gitignore 模板
# ============================================================

# 标准忽略模式列表：日志文件、构建产物、临时文件、IDE 配置等
DEFAULT_GITIGNORE_PATTERNS = [
    "# ============================================================",
    "# 智能体调度平台 - .gitignore（自动生成）",
    "# ============================================================",
    "",
    "# ---- Python ----",
    "*.py[cod]",
    "__pycache__/",
    "*.pyo",
    "*.egg-info/",
    "dist/",
    "build/",
    "*.egg",
    ".eggs/",
    "",
    "# ---- 虚拟环境 ----",
    "venv/",
    ".venv/",
    "env/",
    ".env",
    "",
    "# ---- 日志文件 ----",
    "logs/",
    "*.log",
    "",
    "# ---- 数据库 ----",
    "*.db",
    "*.sqlite3",
    "",
    "# ---- IDE 配置 ----",
    ".vscode/",
    ".idea/",
    "*.swp",
    "*.swo",
    "*~",
    "",
    "# ---- 操作系统 ----",
    ".DS_Store",
    "Thumbs.db",
    "",
    "# ---- 编译产物 ----",
    "*.o",
    "*.so",
    "*.a",
    "*.dylib",
    "*.dll",
    "",
    "# ---- 前端 ----",
    "node_modules/",
    "frontend/dist/",
    "*.tsbuildinfo",
    "",
    "# ---- 测试与覆盖率 ----",
    ".pytest_cache/",
    ".coverage",
    "htmlcov/",
    "",
    "# ---- 临时文件 ----",
    "*.tmp",
    "*.temp",
    "*.bak",
    ".cache/",
    "",
    "# ---- 工作空间 ----",
    "workspace/",
    "",
    "# ---- 记忆库数据 ----",
    "data/knowledge_base/",
    "",
    "# ---- 安全敏感文件 ----",
    "*.pem",
    "*.key",
    "credentials.json",
]


class GitManager:
    """
    Git 版本管理服务类
    作用：提供完整的 Git 版本管理能力，封装所有 Git 操作
    调用方：API 路由层、任务执行引擎、工作流编排层
    被调用方：gitpython 库（底层 Git 操作）
    """

    # 自动提交信息前缀，用于识别自动提交
    AUTO_COMMIT_PREFIX = "[auto-commit]"

    def __init__(self, repo_path: Optional[str] = None, config: Optional[Dict[str, Any]] = None):
        """
        初始化 Git 管理器
        运行步骤：
          1. 确定仓库路径（默认项目根目录）
          2. 加载 Git 配置
          3. 自动初始化仓库（如不存在）
          4. 根据分支策略创建/管理分支
        参数：
          - repo_path: Git 仓库路径，默认为项目根目录
          - config: Git 配置字典，从 settings.git_config 读取
        """
        # 确定仓库路径：默认使用项目根目录
        if repo_path is None:
            repo_path = str(Path(__file__).resolve().parent.parent.parent.parent)
        self.repo_path = repo_path

        # 加载配置：未传入时使用默认值
        if config is None:
            config = {}
        self.config = config

        # 解析分支策略配置
        self.branch_strategy = BranchStrategy(
            config.get("branch_strategy", "default")
        )
        self.auto_commit_mode = CommitMode(
            config.get("auto_commit_mode", "milestone")
        )
        self.protected_branches: List[str] = config.get("protected_branches", ["main", "master"])
        self.commit_extensions: List[str] = config.get("commit_extensions", [
            ".py", ".cpp", ".h", ".hpp", ".yaml", ".yml", ".xml",
            ".launch", ".md", ".txt", ".cfg", ".cmake"
        ])
        self.ignore_patterns: List[str] = config.get("ignore_patterns", [
            "*.pyc", "__pycache__", "*.o", "*.so", "build/", "devel/",
            "install/", "logs/", "*.log", ".data/"
        ])

        # 默认分支配置
        self.default_branches = config.get("default_branches", {
            "stable": "main",
            "development": "dev",
        })
        self.gitflow_branches = config.get("gitflow_branches", {
            "stable": "master",
            "development": "develop",
            "feature_prefix": "feature/",
            "release_prefix": "release/",
        })

        # 仓库实例（延迟初始化）
        self._repo: Optional[Repo] = None

        # 初始化仓库
        self._init_repository()

    # ============================================================
    # 1. 仓库初始化
    # ============================================================

    def _init_repository(self):
        """
        初始化 Git 仓库
        运行步骤：
          1. 检查仓库路径是否存在
          2. 尝试打开已有仓库
          3. 若不存在则自动初始化
          4. 配置 .gitignore 文件
          5. 根据分支策略创建初始分支
        """
        # 检查路径是否存在
        if not os.path.exists(self.repo_path):
            logger.warning(f"仓库路径不存在: {self.repo_path}，跳过 Git 初始化")
            return

        try:
            # 尝试打开已有仓库（复用已有仓库，不强制覆盖）
            self._repo = Repo(self.repo_path)
            logger.info(f"复用已有 Git 仓库: {self.repo_path}")
        except (InvalidGitRepositoryError, NoSuchPathError):
            # 仓库不存在，自动初始化
            logger.info(f"Git 仓库不存在，自动初始化: {self.repo_path}")
            self._repo = Repo.init(self.repo_path)
            logger.info(f"Git 仓库初始化完成: {self.repo_path}")

        # 配置 .gitignore（仅在文件不存在时创建，避免覆盖用户自定义）
        self._ensure_gitignore()

        # 根据分支策略初始化分支
        self._ensure_branches()

    def _ensure_gitignore(self):
        """
        确保 .gitignore 文件存在并包含标准忽略模式
        运行步骤：
          1. 检查 .gitignore 文件是否存在
          2. 若不存在则创建并写入默认模式
          3. 若已存在则跳过（保留用户自定义）
        """
        gitignore_path = os.path.join(self.repo_path, ".gitignore")
        if os.path.exists(gitignore_path):
            logger.debug(f".gitignore 已存在，跳过创建: {gitignore_path}")
            return

        try:
            with open(gitignore_path, "w", encoding="utf-8") as f:
                f.write("\n".join(DEFAULT_GITIGNORE_PATTERNS) + "\n")
            logger.info(f".gitignore 文件已创建: {gitignore_path}")
        except OSError as e:
            logger.error(f"创建 .gitignore 失败: {e}")

    # ============================================================
    # 2. 分支管理
    # ============================================================

    def _ensure_branches(self):
        """
        根据分支策略确保必要分支存在
        运行步骤：
          1. 获取当前分支策略
          2. 根据策略创建对应分支
          3. 不强制切换分支，仅确保分支存在
        """
        if self._repo is None:
            return

        try:
            if self.branch_strategy == BranchStrategy.DEFAULT:
                self._ensure_default_branches()
            elif self.branch_strategy == BranchStrategy.GITFLOW:
                self._ensure_gitflow_branches()
            elif self.branch_strategy == BranchStrategy.CUSTOM:
                # 用户自定义模式：仅确保保护分支存在
                self._ensure_custom_branches()
        except Exception as e:
            logger.error(f"分支初始化失败: {e}")

    def _ensure_default_branches(self):
        """
        默认双分支模式：确保 main（稳定）和 dev（开发）分支存在
        运行步骤：
          1. 获取当前默认分支名
          2. 检查 stable 分支是否存在，不存在则创建
          3. 检查 development 分支是否存在，不存在则从 stable 创建
        """
        stable = self.default_branches.get("stable", "main")
        development = self.default_branches.get("development", "dev")

        # 确保 stable 分支存在
        if stable not in self._repo.heads:
            # 如果当前在某个分支上，基于当前分支创建 stable
            try:
                current = self._repo.active_branch.name
                self._repo.create_head(stable, self._repo.heads[current])
                logger.info(f"已创建稳定分支: {stable}（基于 {current}）")
            except Exception as e:
                logger.warning(f"创建稳定分支 {stable} 失败: {e}")

        # 确保 development 分支存在
        if development not in self._repo.heads:
            try:
                # 基于 stable 分支创建 development
                if stable in self._repo.heads:
                    self._repo.create_head(development, self._repo.heads[stable])
                    logger.info(f"已创建开发分支: {development}（基于 {stable}）")
            except Exception as e:
                logger.warning(f"创建开发分支 {development} 失败: {e}")

    def _ensure_gitflow_branches(self):
        """
        Gitflow 兼容模式：确保 master/develop 分支存在
        运行步骤：
          1. 确保 master（稳定）分支存在
          2. 确保 develop（开发）分支存在
        """
        stable = self.gitflow_branches.get("stable", "master")
        development = self.gitflow_branches.get("development", "develop")

        # 确保 master 分支存在
        if stable not in self._repo.heads:
            try:
                current = self._repo.active_branch.name
                self._repo.create_head(stable, self._repo.heads[current])
                logger.info(f"已创建稳定分支: {stable}（基于 {current}）")
            except Exception as e:
                logger.warning(f"创建稳定分支 {stable} 失败: {e}")

        # 确保 develop 分支存在
        if development not in self._repo.heads:
            try:
                if stable in self._repo.heads:
                    self._repo.create_head(development, self._repo.heads[stable])
                    logger.info(f"已创建开发分支: {development}（基于 {stable}）")
            except Exception as e:
                logger.warning(f"创建开发分支 {development} 失败: {e}")

    def _ensure_custom_branches(self):
        """
        用户自定义分支模式：仅确保保护分支存在
        运行步骤：
          1. 遍历保护分支列表
          2. 对每个不存在的保护分支进行创建
        """
        for branch_name in self.protected_branches:
            if branch_name not in self._repo.heads:
                try:
                    current = self._repo.active_branch.name
                    self._repo.create_head(branch_name, self._repo.heads[current])
                    logger.info(f"已创建保护分支: {branch_name}（基于 {current}）")
                except Exception as e:
                    logger.warning(f"创建保护分支 {branch_name} 失败: {e}")

    def is_protected_branch(self, branch_name: str) -> bool:
        """
        判断指定分支是否为保护分支
        参数：
          - branch_name: 分支名称
        返回值：True 表示保护分支，False 表示非保护分支
        """
        return branch_name in self.protected_branches

    def get_current_branch(self) -> Optional[str]:
        """
        获取当前分支名
        返回值：当前分支名称，若仓库未初始化则返回 None
        """
        if self._repo is None:
            return None
        try:
            return self._repo.active_branch.name
        except Exception:
            # 处于 detached HEAD 状态
            return None

    def get_branches(self) -> List[BranchInfo]:
        """
        获取所有分支信息列表
        运行步骤：
          1. 遍历所有本地分支
          2. 获取每个分支的最近提交信息
          3. 标记当前分支和保护分支
        返回值：BranchInfo 列表
        """
        if self._repo is None:
            return []

        branches: List[BranchInfo] = []
        try:
            current_branch = self.get_current_branch()
            for head in self._repo.heads:
                branch_name = head.name
                # 获取最近一次提交信息
                last_commit_msg = ""
                last_commit_date = ""
                try:
                    commit = head.commit
                    last_commit_msg = commit.message.strip().split("\n")[0][:80]
                    last_commit_date = datetime.fromtimestamp(
                        commit.committed_date
                    ).strftime("%Y-%m-%d %H:%M:%S")
                except Exception:
                    pass

                branches.append(BranchInfo(
                    name=branch_name,
                    is_current=(branch_name == current_branch),
                    is_protected=self.is_protected_branch(branch_name),
                    last_commit=last_commit_msg,
                    last_commit_date=last_commit_date,
                ))
        except Exception as e:
            logger.error(f"获取分支列表失败: {e}")

        return branches

    def create_branch(self, branch_name: str, base_branch: Optional[str] = None) -> bool:
        """
        创建新分支
        运行步骤：
          1. 校验分支名是否已存在
          2. 确定基准分支（默认当前分支）
          3. 创建新分支
        参数：
          - branch_name: 新分支名称
          - base_branch: 基准分支名，默认为当前分支
        返回值：True 表示创建成功，False 表示失败
        """
        if self._repo is None:
            logger.error("仓库未初始化，无法创建分支")
            return False

        # 检查分支是否已存在
        if branch_name in self._repo.heads:
            logger.warning(f"分支已存在: {branch_name}")
            return False

        # 确定基准分支
        if base_branch is None:
            base_branch = self.get_current_branch()
        if base_branch is None or base_branch not in self._repo.heads:
            logger.error(f"基准分支不存在: {base_branch}")
            return False

        try:
            self._repo.create_head(branch_name, self._repo.heads[base_branch])
            logger.info(f"分支已创建: {branch_name}（基于 {base_branch}）")
            return True
        except Exception as e:
            logger.error(f"创建分支失败: {e}")
            return False

    def switch_branch(self, branch_name: str) -> bool:
        """
        切换到指定分支
        运行步骤：
          1. 校验分支是否存在
          2. 检查工作区是否干净（有未提交变更时拒绝切换）
          3. 执行分支切换
        参数：
          - branch_name: 目标分支名
        返回值：True 表示切换成功，False 表示失败
        """
        if self._repo is None:
            logger.error("仓库未初始化，无法切换分支")
            return False

        if branch_name not in self._repo.heads:
            logger.error(f"分支不存在: {branch_name}")
            return False

        try:
            # 检查工作区是否干净
            if self._repo.is_dirty(untracked_files=True):
                logger.warning(f"工作区有未提交变更，切换分支前请先提交或暂存")
                return False

            self._repo.heads[branch_name].checkout()
            logger.info(f"已切换到分支: {branch_name}")
            return True
        except Exception as e:
            logger.error(f"切换分支失败: {e}")
            return False

    # ============================================================
    # 3. 自动提交
    # ============================================================

    def auto_commit(
        self,
        task_id: str = "",
        task_name: str = "",
        mode: Optional[CommitMode] = None,
        milestone: Optional[MilestoneType] = None,
    ) -> CommitResult:
        """
        执行自动提交
        运行步骤：
          1. 检查自动提交模式是否启用
          2. 检查当前分支是否为保护分支（保护分支禁止自动提交）
          3. 检测人工修改
          4. 构建提交信息
          5. 执行 git add + git commit
        参数：
          - task_id: 任务 ID
          - task_name: 任务名称
          - mode: 提交模式（覆盖配置中的默认模式）
          - milestone: 里程碑类型（里程碑模式时使用）
        返回值：CommitResult 对象，包含提交结果详情
        """
        if self._repo is None:
            return CommitResult(
                success=False,
                message="仓库未初始化，无法执行自动提交",
            )

        # 确定提交模式
        effective_mode = mode or self.auto_commit_mode
        if effective_mode == CommitMode.DISABLED:
            return CommitResult(
                success=False,
                message="自动提交已关闭（auto_commit_mode=disabled）",
            )

        # 检查当前分支是否为保护分支
        current_branch = self.get_current_branch()
        if current_branch and self.is_protected_branch(current_branch):
            return CommitResult(
                success=False,
                message=f"当前分支 [{current_branch}] 为保护分支，禁止自动提交",
            )

        # 检测人工修改
        human_changes = self._detect_human_changes()
        if human_changes["has_human_changes"]:
            logger.warning(
                f"检测到人工修改: {human_changes['details']}，"
                f"请确认是否包含在自动提交中"
            )
            # 返回警告但不阻止提交（由调用方决定是否继续）
            return CommitResult(
                success=False,
                message="检测到人工修改，请确认后再提交",
                human_changes_detected=True,
                human_changes_warning=human_changes["details"],
            )

        # 检查是否有可提交的变更
        if not self._repo.is_dirty(untracked_files=True):
            return CommitResult(
                success=False,
                message="工作区无变更，无需提交",
            )

        # 构建提交信息
        commit_message = self._build_commit_message(task_id, task_name, milestone)

        try:
            # 添加所有变更文件到暂存区
            self._repo.git.add(A=True)

            # 执行提交
            commit = self._repo.index.commit(commit_message)
            commit_hash = commit.hexsha[:8]

            # 获取变更文件列表
            files_changed = self._get_changed_files(commit)

            logger.info(
                f"自动提交成功: [{commit_hash}] {commit_message}"
            )
            return CommitResult(
                success=True,
                commit_hash=commit_hash,
                message=commit_message,
                files_changed=files_changed,
            )
        except GitCommandError as e:
            logger.error(f"自动提交失败: {e}")
            return CommitResult(
                success=False,
                message=f"Git 命令执行失败: {str(e)}",
            )
        except Exception as e:
            logger.error(f"自动提交异常: {e}")
            return CommitResult(
                success=False,
                message=f"自动提交异常: {str(e)}",
            )

    def _build_commit_message(
        self,
        task_id: str,
        task_name: str,
        milestone: Optional[MilestoneType] = None,
    ) -> str:
        """
        构建自动提交信息
        格式：[auto-commit] 完成任务：[task_id] - [task_name]
        里程碑模式额外添加里程碑标记
        参数：
          - task_id: 任务 ID
          - task_name: 任务名称
          - milestone: 里程碑类型
        返回值：格式化的提交信息字符串
        """
        if milestone:
            # 里程碑模式：添加里程碑标记
            milestone_labels = {
                MilestoneType.ARCHITECTURE_CONFIRMED: "架构确认完成",
                MilestoneType.ALL_MODULES_DONE: "所有模块开发完成",
                MilestoneType.INTEGRATION_PASSED: "集成校验通过",
                MilestoneType.FINAL_DELIVERY: "最终交付",
            }
            milestone_label = milestone_labels.get(milestone, milestone.value)
            return (
                f"{self.AUTO_COMMIT_PREFIX} 里程碑：{milestone_label} - "
                f"任务：[{task_id}] - {task_name}"
            )
        else:
            # 模块模式：标准格式
            task_id_str = task_id[:8] if task_id else "unknown"
            task_name_str = task_name or "未命名任务"
            return (
                f"{self.AUTO_COMMIT_PREFIX} 完成任务：[{task_id_str}] - {task_name_str}"
            )

    def _get_changed_files(self, commit) -> List[str]:
        """
        获取某次提交的变更文件列表
        参数：
          - commit: gitpython Commit 对象
        返回值：变更文件路径列表
        """
        files: List[str] = []
        try:
            if commit.parents:
                # 有父提交：比较差异
                diff = commit.parents[0].diff(commit)
            else:
                # 首次提交：列出所有文件
                diff = commit.diff(git.NULL_TREE)
            for change in diff:
                if change.a_path:
                    files.append(change.a_path)
        except Exception as e:
            logger.warning(f"获取变更文件列表失败: {e}")
        return files

    # ============================================================
    # 4. 版本标签
    # ============================================================

    def create_tag(
        self,
        version: str,
        message: str = "",
        changes: str = "",
    ) -> TagResult:
        """
        创建语义化版本标签
        运行步骤：
          1. 校验版本号格式（MAJOR.MINOR.PATCH）
          2. 检查标签是否已存在（标签不可变）
          3. 构建标签附注信息（版本号 + 日期 + 核心变更）
          4. 创建附注标签
        参数：
          - version: 语义化版本号，格式 MAJOR.MINOR.PATCH
          - message: 标签附注信息
          - changes: 核心变更说明
        返回值：TagResult 对象，包含标签创建结果
        """
        if self._repo is None:
            return TagResult(
                success=False,
                message="仓库未初始化，无法创建标签",
            )

        # 校验版本号格式
        if not self._validate_semver(version):
            return TagResult(
                success=False,
                message=f"无效的语义化版本号: {version}，格式应为 MAJOR.MINOR.PATCH",
            )

        # 构建标签名称
        tag_name = f"v{version}"

        # 检查标签是否已存在（标签不可变）
        if tag_name in [tag.name for tag in self._repo.tags]:
            return TagResult(
                success=False,
                message=f"标签 {tag_name} 已存在，标签创建后不可修改",
            )

        # 构建标签附注信息
        date_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        tag_message = message or f"版本 {version}"
        if changes:
            tag_message += f"\n\n核心变更:\n{changes}"
        tag_message += f"\n\n创建日期: {date_str}"

        try:
            # 创建附注标签（annotated tag）
            new_tag = self._repo.create_tag(
                tag_name,
                message=tag_message,
                annotate=True,
            )
            commit_hash = new_tag.commit.hexsha[:8]

            logger.info(f"版本标签已创建: {tag_name} -> {commit_hash}")
            return TagResult(
                success=True,
                tag_name=tag_name,
                commit_hash=commit_hash,
                message=tag_message,
            )
        except GitCommandError as e:
            logger.error(f"创建标签失败: {e}")
            return TagResult(
                success=False,
                message=f"Git 命令执行失败: {str(e)}",
            )
        except Exception as e:
            logger.error(f"创建标签异常: {e}")
            return TagResult(
                success=False,
                message=f"创建标签异常: {str(e)}",
            )

    def _validate_semver(self, version: str) -> bool:
        """
        校验语义化版本号格式
        参数：
          - version: 版本号字符串
        返回值：True 表示格式有效，False 表示无效
        """
        # 语义化版本正则：MAJOR.MINOR.PATCH，允许预发布和构建元数据后缀
        semver_pattern = re.compile(
            r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)"
            r"(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?"
            r"(\+[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?$"
        )
        return bool(semver_pattern.match(version))

    def get_tags(self) -> List[Dict[str, str]]:
        """
        获取所有版本标签列表
        返回值：标签信息字典列表，每项包含 name、commit、message、date
        """
        if self._repo is None:
            return []

        tags: List[Dict[str, str]] = []
        try:
            for tag in self._repo.tags:
                try:
                    commit = tag.commit
                    tags.append({
                        "name": tag.name,
                        "commit": commit.hexsha[:8],
                        "message": tag.tag.message.strip() if hasattr(tag.tag, 'message') and tag.tag.message else "",
                        "date": datetime.fromtimestamp(
                            commit.committed_date
                        ).strftime("%Y-%m-%d %H:%M:%S"),
                    })
                except Exception:
                    # 跳过无法解析的标签
                    continue
        except Exception as e:
            logger.error(f"获取标签列表失败: {e}")

        # 按日期倒序排列
        tags.sort(key=lambda t: t["date"], reverse=True)
        return tags

    # ============================================================
    # 5. 合并冲突检测
    # ============================================================

    def check_merge_conflicts(
        self,
        source_branch: str,
        target_branch: str,
    ) -> MergeCheckResult:
        """
        合并前冲突检测
        运行步骤：
          1. 校验源分支和目标分支是否存在
          2. 检查目标分支是否为保护分支
          3. 使用 git merge-tree 模拟合并
          4. 检测是否存在冲突
          5. 返回检测结果（有冲突时暂停合并并告警）
        参数：
          - source_branch: 源分支名
          - target_branch: 目标分支名
        返回值：MergeCheckResult 对象，包含冲突检测结果
        """
        if self._repo is None:
            return MergeCheckResult(
                can_merge=False,
                details="仓库未初始化，无法检测合并冲突",
                source_branch=source_branch,
                target_branch=target_branch,
            )

        # 校验分支是否存在
        if source_branch not in self._repo.heads:
            return MergeCheckResult(
                can_merge=False,
                details=f"源分支不存在: {source_branch}",
                source_branch=source_branch,
                target_branch=target_branch,
            )

        if target_branch not in self._repo.heads:
            return MergeCheckResult(
                can_merge=False,
                details=f"目标分支不存在: {target_branch}",
                source_branch=source_branch,
                target_branch=target_branch,
            )

        # 检查目标分支是否为保护分支
        if not self.is_protected_branch(target_branch):
            logger.info(
                f"目标分支 [{target_branch}] 非保护分支，跳过冲突检测"
            )
            return MergeCheckResult(
                can_merge=True,
                has_conflicts=False,
                source_branch=source_branch,
                target_branch=target_branch,
                details="目标分支非保护分支，允许合并",
            )

        try:
            # 获取两个分支的最新提交
            source_commit = self._repo.heads[source_branch].commit
            target_commit = self._repo.heads[target_branch].commit

            # 使用 merge-base 找到共同祖先
            merge_base = self._repo.merge_base(source_commit, target_commit)
            if not merge_base:
                return MergeCheckResult(
                    can_merge=False,
                    details="无法找到两个分支的共同祖先",
                    source_branch=source_branch,
                    target_branch=target_branch,
                )

            # 使用 git merge-tree 模拟合并并检测冲突
            merge_base_commit = merge_base[0]
            try:
                # merge-tree 输出中包含冲突标记 <<<<<<< 表示有冲突
                merge_result = self._repo.git.merge_tree(
                    merge_base_commit.hexsha,
                    source_commit.hexsha,
                    target_commit.hexsha,
                )
            except GitCommandError as git_err:
                # merge-tree 返回非零退出码通常表示有冲突
                merge_result = str(git_err)

            # 检测冲突标记
            conflict_files = self._parse_merge_conflicts(merge_result)

            if conflict_files:
                logger.warning(
                    f"合并冲突检测：{source_branch} -> {target_branch} "
                    f"存在 {len(conflict_files)} 个冲突文件"
                )
                return MergeCheckResult(
                    can_merge=False,
                    has_conflicts=True,
                    conflict_files=conflict_files,
                    source_branch=source_branch,
                    target_branch=target_branch,
                    details=(
                        f"检测到 {len(conflict_files)} 个冲突文件，"
                        f"请手动解决冲突后再合并。严禁强制合并或自动解决冲突。"
                    ),
                )
            else:
                logger.info(
                    f"合并冲突检测通过: {source_branch} -> {target_branch}"
                )
                return MergeCheckResult(
                    can_merge=True,
                    has_conflicts=False,
                    source_branch=source_branch,
                    target_branch=target_branch,
                    details="未检测到冲突，可以安全合并",
                )

        except Exception as e:
            logger.error(f"合并冲突检测异常: {e}")
            return MergeCheckResult(
                can_merge=False,
                details=f"冲突检测过程异常: {str(e)}",
                source_branch=source_branch,
                target_branch=target_branch,
            )

    def _parse_merge_conflicts(self, merge_output: str) -> List[str]:
        """
        从 merge-tree 输出中解析冲突文件列表
        参数：
          - merge_output: git merge-tree 的输出
        返回值：冲突文件路径列表
        """
        conflict_files: List[str] = []
        # 检测冲突标记：<<<<<<< 或 changed in both
        lines = merge_output.split("\n")
        current_file = ""

        for line in lines:
            # merge-tree 输出中 "changed in both" 表示双方都有修改
            if "changed in both" in line:
                # 提取文件路径
                parts = line.split()
                if parts:
                    current_file = parts[-1]
                    if current_file not in conflict_files:
                        conflict_files.append(current_file)

        return conflict_files

    def merge_branch(
        self,
        source_branch: str,
        target_branch: str,
        no_ff: bool = False,
    ) -> Dict[str, Any]:
        """
        执行分支合并（带冲突检测）
        运行步骤：
          1. 先执行冲突检测
          2. 若有冲突则拒绝合并
          3. 切换到目标分支
          4. 执行合并
          5. 返回合并结果
        参数：
          - source_branch: 源分支名
          - target_branch: 目标分支名
          - no_ff: 是否禁用快进合并（默认 False）
        返回值：合并结果字典，包含 success、message、commit_hash
        """
        # 先执行冲突检测
        check_result = self.check_merge_conflicts(source_branch, target_branch)
        if not check_result.can_merge:
            return {
                "success": False,
                "message": check_result.details,
                "commit_hash": "",
                "conflict_files": check_result.conflict_files,
            }

        # 保存当前分支以便合并后恢复
        original_branch = self.get_current_branch()

        try:
            # 切换到目标分支
            if not self.switch_branch(target_branch):
                return {
                    "success": False,
                    "message": f"无法切换到目标分支: {target_branch}",
                    "commit_hash": "",
                }

            # 执行合并
            merge_kwargs = {}
            if no_ff:
                merge_kwargs["no_ff"] = True

            self._repo.git.merge(source_branch, **merge_kwargs)

            # 获取合并提交哈希
            commit_hash = self._repo.head.commit.hexsha[:8]

            logger.info(f"合并成功: {source_branch} -> {target_branch} [{commit_hash}]")
            return {
                "success": True,
                "message": f"合并成功: {source_branch} -> {target_branch}",
                "commit_hash": commit_hash,
            }

        except GitCommandError as e:
            logger.error(f"合并失败: {e}")
            # 尝试中止合并
            try:
                self._repo.git.merge("--abort")
            except Exception:
                pass
            return {
                "success": False,
                "message": f"合并失败: {str(e)}",
                "commit_hash": "",
            }
        except Exception as e:
            logger.error(f"合并异常: {e}")
            return {
                "success": False,
                "message": f"合并异常: {str(e)}",
                "commit_hash": "",
            }
        finally:
            # 尝试恢复到原始分支
            if original_branch and original_branch != self.get_current_branch():
                try:
                    self._repo.heads[original_branch].checkout()
                except Exception:
                    pass

    # ============================================================
    # 6. 人工修改检测
    # ============================================================

    def _detect_human_changes(self) -> Dict[str, Any]:
        """
        检测工作区中的人工修改
        运行步骤：
          1. 获取工作区变更文件列表
          2. 对比最近一次自动提交后的变更
          3. 识别非自动提交产生的修改
          4. 返回检测结果
        返回值：字典，包含 has_human_changes、details、files
        """
        if self._repo is None:
            return {"has_human_changes": False, "details": "", "files": []}

        try:
            # 获取工作区变更
            modified = [item.a_path for item in self._repo.index.diff(None)]
            untracked = self._repo.untracked_files

            all_changes = modified + untracked
            if not all_changes:
                return {"has_human_changes": False, "details": "", "files": []}

            # 检查最近一次提交是否为自动提交
            try:
                last_commit = self._repo.head.commit
                last_message = last_commit.message.strip()
                is_last_auto = last_message.startswith(self.AUTO_COMMIT_PREFIX)
            except Exception:
                is_last_auto = False

            # 如果最近提交不是自动提交，说明可能有未提交的人工修改
            if not is_last_auto:
                return {
                    "has_human_changes": True,
                    "details": (
                        f"最近一次提交非自动提交，工作区有 {len(all_changes)} 个变更文件，"
                        f"可能包含人工修改"
                    ),
                    "files": all_changes[:20],  # 最多返回 20 个文件
                }

            # 最近是自动提交，检查是否有超出自动提交范围的变更
            # 过滤出代码文件（非自动生成的文件）
            code_changes = [
                f for f in all_changes
                if any(f.endswith(ext) for ext in self.commit_extensions)
            ]

            if code_changes:
                return {
                    "has_human_changes": True,
                    "details": (
                        f"检测到 {len(code_changes)} 个代码文件变更，"
                        f"可能包含人工修改"
                    ),
                    "files": code_changes[:20],
                }

            return {"has_human_changes": False, "details": "", "files": []}

        except Exception as e:
            logger.error(f"人工修改检测异常: {e}")
            return {
                "has_human_changes": False,
                "details": f"检测异常: {str(e)}",
                "files": [],
            }

    def check_human_modifications(self) -> Dict[str, Any]:
        """
        检查工作区中的人工修改（公开方法，供 API 调用）
        返回值：字典，包含 has_modifications、details、modified_files、untracked_files
        """
        if self._repo is None:
            return {
                "has_modifications": False,
                "details": "仓库未初始化",
                "modified_files": [],
                "untracked_files": [],
            }

        try:
            modified = [item.a_path for item in self._repo.index.diff(None)]
            staged = [item.a_path for item in self._repo.index.diff(self._repo.head.commit)]
            untracked = self._repo.untracked_files

            has_mods = bool(modified or staged or untracked)

            return {
                "has_modifications": has_mods,
                "details": (
                    f"修改: {len(modified)} 文件, "
                    f"暂存: {len(staged)} 文件, "
                    f"未跟踪: {len(untracked)} 文件"
                ) if has_mods else "工作区干净",
                "modified_files": modified,
                "staged_files": staged,
                "untracked_files": untracked,
            }
        except Exception as e:
            logger.error(f"检查人工修改异常: {e}")
            return {
                "has_modifications": False,
                "details": f"检查异常: {str(e)}",
                "modified_files": [],
                "untracked_files": [],
            }

    # ============================================================
    # 7. 仓库状态查询
    # ============================================================

    def get_status(self) -> GitStatus:
        """
        获取 Git 仓库完整状态
        运行步骤：
          1. 检查仓库是否有效
          2. 获取当前分支
          3. 获取工作区变更状态
          4. 获取与远程的差异
          5. 获取最近提交和标签
        返回值：GitStatus 对象
        """
        if self._repo is None:
            return GitStatus(is_repo=False)

        try:
            # 当前分支
            current_branch = self.get_current_branch() or ""

            # 工作区状态
            is_clean = not self._repo.is_dirty(untracked_files=True)
            modified_files = [item.a_path for item in self._repo.index.diff(None)]
            staged_files = [item.a_path for item in self._repo.index.diff("HEAD")]
            untracked_files = self._repo.untracked_files

            # 与远程的差异
            ahead_count = 0
            behind_count = 0
            try:
                # 获取 tracking branch 信息
                for remote in self._repo.remotes:
                    try:
                        remote.fetch()
                    except Exception:
                        pass
                # 尝试获取 ahead/behind 计数
                if current_branch:
                    try:
                        tracking = self._repo.active_branch.tracking_branch()
                        if tracking:
                            commits_behind = list(
                                self._repo.iter_commits(
                                    f"{current_branch}..{tracking.name}"
                                )
                            )
                            commits_ahead = list(
                                self._repo.iter_commits(
                                    f"{tracking.name}..{current_branch}"
                                )
                            )
                            behind_count = len(commits_behind)
                            ahead_count = len(commits_ahead)
                    except Exception:
                        pass
            except Exception:
                pass

            # 最近一次提交
            last_commit = ""
            try:
                commit = self._repo.head.commit
                last_commit = (
                    f"[{commit.hexsha[:8]}] "
                    f"{commit.message.strip().split(chr(10))[0][:100]}"
                )
            except Exception:
                last_commit = "无提交记录"

            # 当前分支上的标签
            tags: List[str] = []
            try:
                for tag in self._repo.tags:
                    if tag.commit == self._repo.head.commit:
                        tags.append(tag.name)
            except Exception:
                pass

            return GitStatus(
                is_repo=True,
                current_branch=current_branch,
                is_clean=is_clean,
                modified_files=modified_files,
                staged_files=staged_files,
                untracked_files=untracked_files,
                ahead_count=ahead_count,
                behind_count=behind_count,
                last_commit=last_commit,
                tags=tags,
            )
        except Exception as e:
            logger.error(f"获取仓库状态异常: {e}")
            return GitStatus(is_repo=True, last_commit=f"状态获取异常: {str(e)}")

    def get_commit_log(
        self,
        max_count: int = 50,
        branch: Optional[str] = None,
    ) -> List[CommitLogEntry]:
        """
        获取提交历史
        运行步骤：
          1. 确定查询分支
          2. 遍历提交记录
          3. 标记自动提交
          4. 返回提交日志列表
        参数：
          - max_count: 最大返回条数（默认 50）
          - branch: 指定分支名，默认当前分支
        返回值：CommitLogEntry 列表
        """
        if self._repo is None:
            return []

        entries: List[CommitLogEntry] = []
        try:
            # 确定查询的引用
            ref = branch if branch and branch in self._repo.heads else "HEAD"
            commits = list(self._repo.iter_commits(ref, max_count=max_count))

            for commit in commits:
                message = commit.message.strip()
                is_auto = message.startswith(self.AUTO_COMMIT_PREFIX)

                entries.append(CommitLogEntry(
                    hash=commit.hexsha[:8],
                    author=str(commit.author),
                    date=datetime.fromtimestamp(
                        commit.committed_date
                    ).strftime("%Y-%m-%d %H:%M:%S"),
                    message=message.split("\n")[0][:200],
                    is_auto_commit=is_auto,
                ))
        except Exception as e:
            logger.error(f"获取提交历史失败: {e}")

        return entries

    # ============================================================
    # 8. 工具方法
    # ============================================================

    @property
    def is_available(self) -> bool:
        """检查 Git 仓库是否可用"""
        return self._repo is not None

    @property
    def repo(self):
        """公开的 Git 仓库实例属性，供外部模块访问（如 CommitHookHandler）"""
        return self._repo

    def get_config_summary(self) -> Dict[str, Any]:
        """
        获取当前 Git 配置摘要
        返回值：配置信息字典
        """
        return {
            "repo_path": self.repo_path,
            "is_available": self.is_available,
            "branch_strategy": self.branch_strategy.value,
            "auto_commit_mode": self.auto_commit_mode.value,
            "protected_branches": self.protected_branches,
            "current_branch": self.get_current_branch(),
        }

    # ============================================================
    # 8.5 初始化并推送文档 (v5.5.0 新增 - Bug 4 修复)
    # ============================================================

    async def init_and_push_docs(
        self,
        project_name: str,
        files: Optional[Dict[str, str]] = None,
        commit_message: str = "feat: 初始化项目文档",
    ) -> Dict[str, Any]:
        """
        初始化仓库并提交初始文档
        作用：替代缺失的 init_and_push_docs 方法 (v5.5.0 修复 Bug 4)
        调用方：ArchitectureWorkflowService._create_git_repo_and_commit
        运行步骤：
          1. 确保本地仓库已初始化（_init_repository）
          2. 将 files 字典中的文件写入本地仓库
          3. 使用 git add + commit 提交所有变更
          4. 返回结果字典
        参数：
          - project_name: 项目名（用于日志/目录命名，调用方传 arch-xxxxxxxx）
          - files: 文件名 -> 内容 字典
          - commit_message: 提交信息
        返回值：Dict {success, repo_url, commit_sha, message}
        """
        try:
            # 1. 确保本地仓库已初始化
            # 重新打开/初始化 self.repo_path 上的仓库
            try:
                self._repo = Repo(self.repo_path)
                logger.info(
                    f"init_and_push_docs: 复用已有仓库 {self.repo_path}"
                )
            except (InvalidGitRepositoryError, NoSuchPathError, Exception):
                if not os.path.exists(self.repo_path):
                    os.makedirs(self.repo_path, exist_ok=True)
                self._repo = Repo.init(self.repo_path)
                logger.info(
                    f"init_and_push_docs: 已初始化新仓库 {self.repo_path}"
                )

            # 2. 写入文件到本地仓库
            commit_sha = ""
            if files:
                for filename, content in files.items():
                    if not filename:
                        continue
                    filepath = os.path.join(self.repo_path, filename)
                    parent_dir = os.path.dirname(filepath)
                    if parent_dir and parent_dir != self.repo_path:
                        os.makedirs(parent_dir, exist_ok=True)
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(content or "")

                # 2.5 v5.5.0 修复：若未配置 git user.name/email 则设置兜底值，
                # 避免在干净环境下 commit 失败
                for cfg_key, cfg_val in [
                    ("user.name", "auto-code-bot"),
                    ("user.email", "auto-code-bot@local"),
                ]:
                    chk_proc = await asyncio.create_subprocess_exec(
                        "git", "-C", self.repo_path, "config", "--get", cfg_key,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    await chk_proc.communicate()
                    if chk_proc.returncode != 0:
                        set_proc = await asyncio.create_subprocess_exec(
                            "git", "-C", self.repo_path, "config",
                            cfg_key, cfg_val,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await set_proc.communicate()
                        logger.debug(
                            f"init_and_push_docs: 设置兜底 {cfg_key}={cfg_val}"
                        )

                # 3. git add + commit（使用 subprocess 保证可靠）
                add_proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "add", "-A",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, add_err = await add_proc.communicate()
                if add_proc.returncode != 0:
                    err_msg = (
                        add_err.decode().strip() if add_err else "git add failed"
                    )
                    logger.error(f"init_and_push_docs: git add 失败: {err_msg}")
                    return {
                        "success": False,
                        "repo_url": "",
                        "message": f"git add 失败: {err_msg}",
                    }

                # 检查是否有变更可提交
                status_proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "status", "--porcelain",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                status_out, _ = await status_proc.communicate()
                if not status_out.strip():
                    logger.info(
                        "init_and_push_docs: 无变更可提交，跳过 commit"
                    )
                    return {
                        "success": True,
                        "repo_url": "",
                        "commit_sha": "",
                        "message": "无变更",
                    }

                commit_proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path,
                    "commit", "-m", commit_message,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                _, commit_err = await commit_proc.communicate()
                if commit_proc.returncode != 0:
                    err_msg = (
                        commit_err.decode().strip() if commit_err
                        else "git commit failed"
                    )
                    logger.error(
                        f"init_and_push_docs: git commit 失败: {err_msg}"
                    )
                    return {
                        "success": False,
                        "repo_url": "",
                        "message": f"git commit 失败: {err_msg}",
                    }

                # 获取最新 commit SHA
                rev_proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path,
                    "rev-parse", "HEAD",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                rev_out, _ = await rev_proc.communicate()
                if rev_proc.returncode == 0:
                    commit_sha = rev_out.decode().strip()

            logger.info(
                f"init_and_push_docs 完成: project={project_name} "
                f"commit_sha={commit_sha[:8] if commit_sha else 'N/A'}"
            )
            return {
                "success": True,
                "repo_url": "",
                "commit_sha": commit_sha,
                "message": f"init_and_push_docs OK ({project_name})",
            }
        except FileNotFoundError:
            logger.error("init_and_push_docs: git 命令不可用")
            return {
                "success": False,
                "repo_url": "",
                "message": "git 命令不可用",
            }
        except Exception as e:
            logger.exception(f"init_and_push_docs 异常: {e}")
            return {
                "success": False,
                "repo_url": "",
                "message": str(e),
            }

    # ============================================================
    # 9. 远程仓库设置（v4.3.0 重构为异步方法，基于 asyncio subprocess）
    # ============================================================

    async def setup_remote(self, repo_name: str) -> Dict[str, Any]:
        """
        设置 Git 远程仓库（异步方法）
        运行步骤：
          1. 导入 GitHubRepoManager 并创建远程仓库
          2. 获取 clone_url
          3. 设置本地 git remote origin（add 或 set-url）
          4. 返回设置结果
        参数：
          - repo_name: 仓库名称
        返回值：字典，包含 success、repo_url、message
        """
        try:
            # 步骤 1：导入 GitHubRepoManager 并创建远程仓库
            from backend.app.services.github_repo_manager import GitHubRepoManager

            github_manager = GitHubRepoManager()
            create_result = await github_manager.create_repository(repo_name)

            if not create_result.get("success"):
                error_msg = create_result.get("message", "创建远程仓库失败")
                logger.error(f"创建 GitHub 远程仓库失败: {error_msg}")
                return {
                    "success": False,
                    "repo_url": "",
                    "message": error_msg,
                }

            clone_url = create_result.get("clone_url", "")
            if not clone_url:
                logger.error("创建远程仓库成功但未获取到 clone_url")
                return {
                    "success": False,
                    "repo_url": "",
                    "message": "创建远程仓库成功但未获取到 clone_url",
                }

            # 步骤 2：检查本地是否已配置 origin 远程
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "remote", "get-url", "origin",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode == 0:
                # origin 已存在，使用 set-url 更新
                logger.info(f"远程 origin 已存在，更新 URL: {clone_url}")
                proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "remote", "set-url", "origin", clone_url,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode != 0:
                    err_msg = stderr.decode().strip() if stderr else "unknown"
                    logger.error(f"更新远程 origin URL 失败: {err_msg}")
                    return {
                        "success": False,
                        "repo_url": clone_url,
                        "message": f"更新远程 origin URL 失败: {err_msg}",
                    }
            else:
                # origin 不存在，使用 add 添加
                logger.info(f"添加远程 origin: {clone_url}")
                proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "remote", "add", "origin", clone_url,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode != 0:
                    err_msg = stderr.decode().strip() if stderr else "unknown"
                    logger.error(f"添加远程 origin 失败: {err_msg}")
                    return {
                        "success": False,
                        "repo_url": clone_url,
                        "message": f"添加远程 origin 失败: {err_msg}",
                    }

            logger.info(f"远程仓库设置成功: {repo_name} -> {clone_url}")
            return {
                "success": True,
                "repo_url": clone_url,
                "message": f"远程仓库 {repo_name} 设置成功",
            }

        except ImportError as e:
            logger.error(f"导入 GitHubRepoManager 失败: {e}")
            return {
                "success": False,
                "repo_url": "",
                "message": f"导入 GitHubRepoManager 失败: {str(e)}",
            }
        except FileNotFoundError:
            logger.error("git 命令不可用，无法设置远程仓库")
            return {
                "success": False,
                "repo_url": "",
                "message": "git 命令不可用",
            }
        except Exception as e:
            logger.error(f"设置远程仓库异常 [{repo_name}]: {e}")
            return {
                "success": False,
                "repo_url": "",
                "message": f"设置远程仓库异常: {str(e)}",
            }

    # ============================================================
    # 10. 主分支推送（v4.3.0 重构为异步方法，基于 asyncio subprocess）
    # ============================================================

    async def push_main_branch(self) -> Dict[str, Any]:
        """
        切换到 main 分支，合并所有 module/* 分支后推送到远程（异步方法）
        运行步骤：
          1. 切换到 main 分支（不存在则尝试 master）
          2. 查找所有 module/* 格式的分支
          3. 逐个合并 module 分支到 main
          4. 执行 git push origin main
          5. 返回推送结果
        返回值：字典，包含 success、message
        """
        try:
            # 步骤 1：切换到 main 分支
            main_branch = "main"
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "checkout", main_branch,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                # main 不存在，尝试 master
                logger.info("main 分支不存在，尝试切换到 master")
                main_branch = "master"
                proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "checkout", main_branch,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode != 0:
                    err_msg = stderr.decode().strip() if stderr else "unknown"
                    logger.error(f"无法切换到 main/master 分支: {err_msg}")
                    return {
                        "success": False,
                        "message": f"无法切换到 main/master 分支: {err_msg}",
                    }

            logger.info(f"已切换到分支: {main_branch}")

            # 步骤 2：查找所有 module/* 格式的分支
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "branch", "--list", "module/*",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                logger.error(f"获取 module 分支列表失败: {err_msg}")
                return {
                    "success": False,
                    "message": f"获取 module 分支列表失败: {err_msg}",
                }

            # 解析分支列表（去除 * 和空格前缀）
            module_branches: List[str] = []
            for line in stdout.decode().strip().split("\n"):
                line = line.strip()
                if line.startswith("*"):
                    line = line[1:].strip()
                if line:
                    module_branches.append(line)

            if not module_branches:
                logger.info("没有 module/* 分支需要合并")
                # 即使没有 module 分支，也尝试推送 main
                proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "push", "origin", main_branch,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode != 0:
                    err_msg = stderr.decode().strip() if stderr else "unknown"
                    # 检查是否有远程 origin
                    if "No configured push destination" in err_msg or "remote 'origin' does not exist" in err_msg:
                        return {
                            "success": True,
                            "message": "未配置远程仓库，跳过推送",
                        }
                    logger.warning(f"推送 main 分支失败: {err_msg}")
                    return {
                        "success": False,
                        "message": f"推送失败: {err_msg}",
                    }

                return {
                    "success": True,
                    "message": f"已推送 {main_branch}（无 module 分支需合并）",
                }

            # 步骤 3：逐个合并 module 分支到 main
            merged_branches: List[str] = []
            failed_branches: List[str] = []
            for branch in module_branches:
                proc = await asyncio.create_subprocess_exec(
                    "git", "-C", self.repo_path, "merge", branch,
                    "--no-ff", "-m", f"merge: {branch}",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, stderr = await proc.communicate()

                if proc.returncode != 0:
                    err_msg = stderr.decode().strip() if stderr else "unknown"
                    logger.warning(f"合并分支失败 [{branch}]: {err_msg}")
                    failed_branches.append(branch)
                    # 尝试中止合并
                    try:
                        abort_proc = await asyncio.create_subprocess_exec(
                            "git", "-C", self.repo_path, "merge", "--abort",
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                        )
                        await abort_proc.communicate()
                    except Exception:
                        pass
                else:
                    merged_branches.append(branch)
                    logger.info(f"已合并分支: {branch}")

            logger.info(
                f"合并完成: 成功 {len(merged_branches)} 个, "
                f"失败 {len(failed_branches)} 个"
            )

            # 步骤 4：执行 git push origin main
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "push", "origin", main_branch,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                if "No configured push destination" in err_msg or "remote 'origin' does not exist" in err_msg:
                    return {
                        "success": True,
                        "message": "未配置远程仓库，跳过推送",
                    }
                logger.error(f"推送 main 分支失败: {err_msg}")
                return {
                    "success": False,
                    "message": f"推送失败: {err_msg}",
                }

            # 构建结果消息
            msg_parts = [f"已推送 {main_branch}"]
            if merged_branches:
                msg_parts.append(f"已合并 {len(merged_branches)} 个模块分支")
            if failed_branches:
                msg_parts.append(f"{len(failed_branches)} 个分支合并失败: {', '.join(failed_branches)}")

            return {
                "success": True,
                "message": "；".join(msg_parts),
            }

        except FileNotFoundError:
            logger.error("git 命令不可用，无法执行主分支推送")
            return {
                "success": False,
                "message": "git 命令不可用",
            }
        except Exception as e:
            logger.error(f"主分支推送异常: {e}")
            return {
                "success": False,
                "message": f"主分支推送异常: {str(e)}",
            }

    def auto_push(self, branch: Optional[str] = None) -> Dict[str, Any]:
        """
        自动 Push 到远程分支
        运行步骤：
          1. 确定推送分支
          2. 检查远程是否存在
          3. 执行 git push
        参数：
          - branch: 分支名（默认当前分支）
        返回值：推送结果字典
        """
        if self._repo is None:
            return {"success": False, "message": "仓库未初始化"}

        try:
            target_branch = branch or self.get_current_branch()
            if not target_branch:
                return {"success": False, "message": "无法确定推送分支"}

            # 检查远程
            if "origin" not in [r.name for r in self._repo.remotes]:
                return {"success": False, "message": "未配置远程仓库 origin"}

            origin = self._repo.remotes["origin"]
            result = origin.push(target_branch)

            pushed = False
            for info in result:
                if info.flags & info.ERROR:
                    return {"success": False, "message": f"推送失败: {info.summary}"}
                if info.flags & (info.NEW_HEAD | info.FAST_FORWARD | info.FORCED_UPDATE):
                    pushed = True

            if pushed:
                logger.info(f"自动 Push 成功: {target_branch}")
                return {"success": True, "message": f"已推送 {target_branch}", "branch": target_branch}
            else:
                return {"success": True, "message": "远程已是最新", "branch": target_branch}

        except Exception as e:
            logger.error(f"自动 Push 失败: {e}")
            return {"success": False, "message": str(e)}

    # ============================================================
    # 11. 模块级提交与推送（v4.3.0 重构为异步方法，基于 worktree 目录操作）
    # ============================================================

    def _find_worktree_for_module(self, module_name: str) -> Optional[str]:
        """
        查找指定模块的 worktree 目录路径
        运行步骤：
          1. 构建 worktree 根目录路径（<repo_path>/.worktrees/）
          2. 遍历 worktree 目录，匹配包含模块名的子目录
          3. 返回第一个匹配的 worktree 路径
        参数：
          - module_name: 模块名称
        返回值：worktree 目录路径字符串，未找到时返回 None
        """
        # 将模块名中的特殊字符替换为连字符，与 worktree 创建时的命名规则一致
        safe_module = module_name.replace("/", "-").replace(" ", "-")[:30]
        worktrees_root = Path(self.repo_path) / ".worktrees"

        if not worktrees_root.exists():
            logger.warning(f"worktree 根目录不存在: {worktrees_root}")
            return None

        # 遍历 .worktrees/ 目录，查找匹配 safe_module 前缀的子目录
        for wt_dir in sorted(worktrees_root.iterdir(), reverse=True):
            if wt_dir.is_dir() and wt_dir.name.startswith(safe_module):
                logger.info(f"找到模块 [{module_name}] 的 worktree: {wt_dir}")
                return str(wt_dir)

        logger.warning(f"未找到模块 [{module_name}] 的 worktree 目录")
        return None

    async def commit_module_changes(
        self,
        module_name: str,
        changed_files: List[str],
        commit_message: str,
    ) -> Dict[str, Any]:
        """
        提交指定模块的变更文件（异步方法，基于 worktree 目录操作）
        运行步骤：
          1. 查找模块对应的 worktree 目录
          2. 在 worktree 目录下执行 git add 添加变更文件
          3. 执行 git commit 提交变更
          4. 若无变更则返回 {success: true, message: "无变更"}
          5. 异常时优雅降级，返回错误信息
        参数：
          - module_name: 模块名称
          - changed_files: 变更文件路径列表（相对于 worktree 根目录）
          - commit_message: 提交信息
        返回值：字典，包含 success、commit_hash、message
        """
        # 查找模块对应的 worktree 目录
        worktree_path = self._find_worktree_for_module(module_name)
        if worktree_path is None:
            # 降级：使用主仓库路径
            logger.warning(
                f"模块 [{module_name}] 无 worktree，使用主仓库路径提交"
            )
            worktree_path = self.repo_path

        try:
            # 步骤 1：执行 git add 添加变更文件
            if changed_files:
                for f in changed_files:
                    # 使用 asyncio.create_subprocess_exec 执行 git add
                    proc = await asyncio.create_subprocess_exec(
                        "git", "-C", worktree_path, "add", f,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE,
                    )
                    stdout, stderr = await proc.communicate()
                    if proc.returncode != 0:
                        err_msg = stderr.decode().strip() if stderr else "unknown"
                        logger.warning(
                            f"git add 文件失败 [{f}]: {err_msg}"
                        )
            else:
                # 无指定文件时添加所有变更
                proc = await asyncio.create_subprocess_exec(
                    "git", "-C", worktree_path, "add", "-A",
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                await proc.communicate()

            # 步骤 2：检查是否有暂存变更（git diff --cached --quiet）
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "diff", "--cached", "--quiet",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

            if proc.returncode == 0:
                # 返回码 0 表示无暂存变更
                logger.info(f"模块 [{module_name}] 无暂存变更，跳过提交")
                return {
                    "success": True,
                    "commit_hash": "",
                    "message": "无变更",
                }

            # 步骤 3：执行 git commit
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "commit", "-m", commit_message,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                logger.error(f"git commit 失败 [{module_name}]: {err_msg}")
                return {
                    "success": False,
                    "commit_hash": "",
                    "message": f"Git 提交失败: {err_msg}",
                }

            # 步骤 4：获取提交哈希值
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "rev-parse", "--short", "HEAD",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            commit_hash = stdout.decode().strip() if stdout else ""

            logger.info(
                f"模块提交成功: [{commit_hash}] {module_name} - {commit_message}"
            )
            return {
                "success": True,
                "commit_hash": commit_hash,
                "message": commit_message,
            }

        except FileNotFoundError:
            logger.error("git 命令不可用，无法执行模块提交")
            return {
                "success": False,
                "commit_hash": "",
                "message": "git 命令不可用",
            }
        except Exception as e:
            logger.error(f"模块提交异常 [{module_name}]: {e}")
            return {
                "success": False,
                "commit_hash": "",
                "message": f"提交异常: {str(e)}",
            }

    async def push_module_branch(self, module_name: str) -> Dict[str, Any]:
        """
        推送模块分支到远程仓库（异步方法）
        运行步骤：
          1. 构建分支名：module/{module_name}
          2. 检查远程仓库 origin 是否存在
          3. 执行 git push origin module/{module_name}
          4. 返回推送结果
        参数：
          - module_name: 模块名称
        返回值：字典，包含 success、message、branch
        """
        # 构建模块分支名
        safe_module = module_name.replace("/", "-").replace(" ", "-")[:30]
        branch_name = f"module/{safe_module}"

        try:
            # 步骤 1：检查远程仓库 origin 是否存在
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "remote", "get-url", "origin",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                logger.warning(
                    f"未配置远程仓库 origin，跳过推送: {module_name}"
                )
                return {
                    "success": True,
                    "message": "未配置远程仓库，跳过推送",
                    "branch": branch_name,
                }

            # 步骤 2：检查本地分支是否存在
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "rev-parse", "--verify", branch_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

            if proc.returncode != 0:
                logger.warning(
                    f"本地分支 [{branch_name}] 不存在，跳过推送: {module_name}"
                )
                return {
                    "success": True,
                    "message": f"本地分支 {branch_name} 不存在，跳过推送",
                    "branch": branch_name,
                }

            # 步骤 3：执行 git push
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", self.repo_path, "push", "origin", branch_name,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                logger.error(f"推送模块分支失败 [{branch_name}]: {err_msg}")
                return {
                    "success": False,
                    "message": f"推送失败: {err_msg}",
                    "branch": branch_name,
                }

            output = stdout.decode().strip() if stdout else ""
            logger.info(
                f"模块分支推送成功: {module_name} -> {branch_name}"
            )
            return {
                "success": True,
                "message": f"已推送分支 {branch_name}",
                "branch": branch_name,
            }

        except FileNotFoundError:
            logger.error("git 命令不可用，无法执行模块推送")
            return {
                "success": False,
                "message": "git 命令不可用",
                "branch": branch_name,
            }
        except Exception as e:
            logger.error(f"模块分支推送异常 [{module_name}]: {e}")
            return {
                "success": False,
                "message": f"推送异常: {str(e)}",
                "branch": branch_name,
            }

    # ============================================================
    # 12. 未提交变更检查（v4.3.0 新增）
    # ============================================================

    async def check_uncommitted_changes(self, module_name: str) -> bool:
        """
        检查指定模块的 worktree 是否有未提交变更（异步方法）
        运行步骤：
          1. 查找模块对应的 worktree 目录
          2. 执行 git status --porcelain 检查工作区状态
          3. 若有输出则表示存在未提交变更
        参数：
          - module_name: 模块名称
        返回值：True 表示存在未提交变更，False 表示工作区干净
        """
        # 查找模块对应的 worktree 目录
        worktree_path = self._find_worktree_for_module(module_name)
        if worktree_path is None:
            # 降级：使用主仓库路径
            worktree_path = self.repo_path

        try:
            # 执行 git status --porcelain 检查工作区状态
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "status", "--porcelain",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                logger.error(f"检查未提交变更失败 [{module_name}]: {err_msg}")
                return False

            # 若 stdout 有输出，表示存在未提交变更
            output = stdout.decode().strip()
            has_changes = bool(output)

            if has_changes:
                # 统计变更文件数量
                change_lines = output.split("\n")
                logger.info(
                    f"模块 [{module_name}] 存在 {len(change_lines)} 个未提交变更"
                )
            else:
                logger.debug(f"模块 [{module_name}] 工作区干净")

            return has_changes

        except FileNotFoundError:
            logger.error("git 命令不可用，无法检查未提交变更")
            return False
        except Exception as e:
            logger.error(f"检查未提交变更异常 [{module_name}]: {e}")
            return False

    # ============================================================
    # 13. 兜底自动提交（v4.3.0 新增）
    # ============================================================

    async def auto_commit_fallback(self, module_name: str) -> Dict[str, Any]:
        """
        兜底自动提交：模块标记完成但未收到 hook 通知时的兜底处理（异步方法）
        运行步骤：
          1. 查找模块对应的 worktree 目录
          2. 执行 git add -A 添加所有变更
          3. 执行 git commit -m "auto: {module_name} 模块代码"
          4. 推送到模块分支
          5. 记录兜底提交日志
        参数：
          - module_name: 模块名称
        返回值：字典，包含 success、commit_hash、message、branch
        """
        # 构建兜底提交信息
        safe_module = module_name.replace("/", "-").replace(" ", "-")[:30]
        commit_message = f"auto: {safe_module} 模块代码"
        branch_name = f"module/{safe_module}"

        # 查找模块对应的 worktree 目录
        worktree_path = self._find_worktree_for_module(module_name)
        if worktree_path is None:
            worktree_path = self.repo_path

        try:
            # 步骤 1：执行 git add -A 添加所有变更
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "add", "-A",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                logger.error(f"兜底提交 git add 失败 [{module_name}]: {err_msg}")
                return {
                    "success": False,
                    "commit_hash": "",
                    "message": f"git add 失败: {err_msg}",
                    "branch": branch_name,
                }

            # 步骤 2：检查是否有暂存变更
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "diff", "--cached", "--quiet",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

            if proc.returncode == 0:
                # 无暂存变更
                logger.info(
                    f"模块 [{module_name}] 无变更，兜底提交跳过"
                )
                return {
                    "success": True,
                    "commit_hash": "",
                    "message": "无变更，跳过兜底提交",
                    "branch": branch_name,
                }

            # 步骤 3：执行 git commit
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "commit", "-m", commit_message,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err_msg = stderr.decode().strip() if stderr else "unknown"
                logger.error(f"兜底提交 git commit 失败 [{module_name}]: {err_msg}")
                return {
                    "success": False,
                    "commit_hash": "",
                    "message": f"git commit 失败: {err_msg}",
                    "branch": branch_name,
                }

            # 步骤 4：获取提交哈希值
            proc = await asyncio.create_subprocess_exec(
                "git", "-C", worktree_path, "rev-parse", "--short", "HEAD",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            commit_hash = stdout.decode().strip() if stdout else ""

            # 步骤 5：记录兜底提交日志
            logger.info(
                f"模块 {module_name} 未通过 hook 通知，由调度平台兜底提交"
            )

            # 步骤 6：推送到模块分支
            push_result = await self.push_module_branch(module_name)
            if not push_result.get("success"):
                logger.warning(
                    f"兜底提交后推送失败 [{module_name}]: {push_result.get('message')}"
                )

            return {
                "success": True,
                "commit_hash": commit_hash,
                "message": commit_message,
                "branch": branch_name,
            }

        except FileNotFoundError:
            logger.error("git 命令不可用，无法执行兜底提交")
            return {
                "success": False,
                "commit_hash": "",
                "message": "git 命令不可用",
                "branch": branch_name,
            }
        except Exception as e:
            logger.error(f"兜底提交异常 [{module_name}]: {e}")
            return {
                "success": False,
                "commit_hash": "",
                "message": f"兜底提交异常: {str(e)}",
                "branch": branch_name,
            }

    # ============================================================
    # 14. 智能提交信息生成（v2.1.0）
    # ============================================================

    async def generate_commit_message(
        self, changes: List[str], module_context: str = ""
    ) -> str:
        """
        使用 LLM 生成智能 commit message
        参数：
          - changes: 变更文件列表
          - module_context: 模块上下文
        返回值：commit message 字符串
        """
        if not changes:
            return "chore: 自动提交"

        # 基于变更文件生成语义化 commit message
        prefixes = {
            ".py": "feat",
            ".ts": "feat",
            ".tsx": "feat",
            ".js": "feat",
            ".cpp": "feat",
            ".c": "feat",
            ".h": "feat",
            ".json": "chore",
            ".yaml": "chore",
            ".yml": "chore",
            ".md": "docs",
            ".css": "style",
            ".html": "feat",
        }

        # 统计文件类型
        type_counts: Dict[str, int] = {}
        for f in changes:
            ext = Path(f).suffix
            type_counts[ext] = type_counts.get(ext, 0) + 1

        # 确定主要变更类型
        if not type_counts:
            return "chore: 自动提交"

        main_ext = max(type_counts, key=type_counts.get)
        prefix = prefixes.get(main_ext, "chore")

        # 构建 scope
        if module_context:
            scope = module_context[:30].lower().replace(" ", "-")
        else:
            # 从文件路径推断 scope
            dirs = set()
            for f in changes[:5]:
                parts = Path(f).parts
                if len(parts) > 1:
                    dirs.add(parts[0])
            scope = "-".join(sorted(dirs)[:2]) if dirs else "update"

        # 构建描述
        file_count = len(changes)
        if file_count == 1:
            desc = f"更新 {Path(changes[0]).name}"
        elif file_count <= 3:
            desc = f"更新 {', '.join(Path(f).name for f in changes)}"
        else:
            desc = f"更新 {file_count} 个文件"

        return f"{prefix}({scope}): {desc}"

    # ============================================================
    # v4.5.0 新增 - Module D DiffView 增强
    # 作用：提供文件级 diff 与单文件回退能力，
    #       供前端 DiffView 组件（保留/回退）使用
    # ============================================================

    def get_diff_files(self, staged: bool = False) -> List[FileDiffEntry]:
        """
        获取工作区中所有变更文件的 diff 列表（v4.5.0 新增）
        作用：返回每个变更文件的 path / status / additions / deletions / patch，
                     前端 DiffView 据此渲染文件列表与单文件 diff 视图
        运行步骤：
          1. 检查仓库有效性，无效返回空列表
          2. 根据 staged 参数选择 diff 目标（None=未暂存；HEAD=已暂存；UntrackedFiles=未跟踪）
          3. 对每个变更项调用 _build_file_diff 构建 FileDiffEntry
          4. 未跟踪文件附加处理（status=untracked, patch=全文件内容）
          5. 异常隔离：单文件 diff 构建失败不影响其他文件
        参数：
          - staged: 是否仅返回已暂存变更（默认 False=未暂存）
        返回值：FileDiffEntry 列表
        """
        if self._repo is None:
            return []

        entries: List[FileDiffEntry] = []
        try:
            # 选择 diff 目标：None 表示未暂存（vs working tree），"HEAD" 表示已暂存（vs HEAD）
            diff_target = "HEAD" if staged else None
            changed_items = list(self._repo.index.diff(diff_target))
        except Exception as e:
            logger.error(f"读取 diff 列表失败: {e}")
            return []

        for item in changed_items:
            try:
                entry = self._build_file_diff(item, staged=staged)
                if entry is not None:
                    entries.append(entry)
            except Exception as e:
                # 单文件 diff 构建失败不影响其他文件
                logger.warning(
                    f"构建 diff 失败: a_path={item.a_path}, error={e}"
                )

        # 附加未跟踪文件
        try:
            for untracked_path in self._repo.untracked_files:
                try:
                    abs_path = os.path.join(self.repo_path, untracked_path)
                    content = ""
                    if os.path.isfile(abs_path):
                        with open(abs_path, "r", encoding="utf-8", errors="replace") as f:
                            content = f.read()
                    patch_lines = [
                        f"+++ b/{untracked_path}",
                        f"@@ -0,0 +1,{content.count(chr(10)) + 1} @@",
                    ]
                    for line in content.splitlines():
                        patch_lines.append(f"+{line}")
                    entries.append(FileDiffEntry(
                        path=untracked_path,
                        status="untracked",
                        additions=content.count(chr(10)) + (0 if not content else 1),
                        deletions=0,
                        patch="\n".join(patch_lines),
                        is_staged=False,
                    ))
                except Exception as e:
                    logger.warning(f"构建未跟踪文件 diff 失败: {untracked_path}, {e}")
        except Exception:
            pass

        return entries

    def _build_file_diff(
        self, item, staged: bool = False
    ) -> Optional[FileDiffEntry]:
        """
        根据 GitPython 的 DiffEntry 构建单文件 FileDiffEntry（v4.5.0 新增）
        运行步骤：
          1. 推断文件状态：新增(A)/修改(M)/删除(D)/重命名(R)
          2. 解析 diff blob 得到 patch 文本
          3. 统计 additions / deletions 行数
          4. 区分 staged 标记
        参数：
          - item: git.DiffEntry 对象
          - staged: 是否已暂存
        返回值：FileDiffEntry 或 None（无效输入）
        """
        path = item.a_path or item.b_path or ""
        if not path:
            return None

        # 推断状态
        if item.new_file:
            status = "added"
        elif item.deleted_file:
            status = "deleted"
        elif item.renamed_file:
            status = "renamed"
        else:
            status = "modified"

        # 获取 patch 文本
        try:
            patch = item.diff.decode("utf-8", errors="replace") if item.diff else ""
        except Exception:
            patch = ""

        # 统计 +/- 行数
        additions = 0
        deletions = 0
        for line in patch.splitlines():
            if line.startswith("+") and not line.startswith("+++"):
                additions += 1
            elif line.startswith("-") and not line.startswith("---"):
                deletions += 1

        return FileDiffEntry(
            path=path,
            status=status,
            additions=additions,
            deletions=deletions,
            patch=patch,
            is_staged=staged,
        )

    def checkout_file(self, file_path: str) -> Dict[str, Any]:
        """
        回退（撤销）指定文件的工作区修改（v4.5.0 新增）
        作用：前端 DiffView 点击"回退"按钮时调用，
              撤销该文件的所有未提交修改（恢复为 HEAD 状态）。
        运行步骤：
          1. 校验仓库有效性与文件路径
          2. 调用 git.checkout 恢复文件
          3. 未跟踪文件直接删除
          4. 返回执行结果
        参数：
          - file_path: 文件相对仓库路径
        返回值：执行结果字典
            - success: bool，是否成功
            - message: str，描述信息
            - file_path: str，回退的文件路径
        """
        if self._repo is None:
            return {
                "success": False,
                "message": "Git 仓库不可用",
                "file_path": file_path,
            }

        if not file_path or not isinstance(file_path, str):
            return {
                "success": False,
                "message": "文件路径无效",
                "file_path": str(file_path),
            }

        try:
            # 未跟踪文件：直接删除
            if file_path in self._repo.untracked_files:
                abs_path = os.path.join(self.repo_path, file_path)
                if os.path.isfile(abs_path):
                    os.remove(abs_path)
                return {
                    "success": True,
                    "message": f"已删除未跟踪文件: {file_path}",
                    "file_path": file_path,
                }

            # 已跟踪文件：执行 git checkout 恢复为 HEAD 状态
            self._repo.git.checkout("HEAD", "--", file_path)
            return {
                "success": True,
                "message": f"已回退文件: {file_path}",
                "file_path": file_path,
            }
        except GitCommandError as e:
            logger.error(f"回退文件失败: {file_path}, {e}")
            return {
                "success": False,
                "message": f"回退失败: {e}",
                "file_path": file_path,
            }
        except Exception as e:
            logger.error(f"回退文件异常: {file_path}, {e}")
            return {
                "success": False,
                "message": f"回退异常: {e}",
                "file_path": file_path,
            }


# 全局 Git 管理器单例
git_manager = GitManager()
