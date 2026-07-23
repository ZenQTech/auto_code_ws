"""
# ============================================================
# 配置管理模块（V4.1 升级版）
# ============================================================
# 核心作用：读取 config/auto_code_config.yaml 配置文件，
#           将配置项封装为 Python 对象供各模块使用
# 运行流程：
#   1. 优先读取 auto_code_config.yaml（V4.1 全局配置中心）
#   2. 降级读取 settings.yaml（兼容旧版）
#   3. 解析为嵌套字典
#   4. 通过 Settings 类提供类型安全的属性访问
# 输入参数：无（自动读取配置文件）
# 输出结果：Settings 单例对象，包含所有配置项
# 修改记录：
#   - 2026-06-17 | v1.0.0 | 初始版本，读取 settings.yaml
#   - 2026-06-24 | v4.1.0 | 升级为读取 auto_code_config.yaml，
#     新增配额、上下文、架构、评测、Git、记忆库、安全等配置属性
# ============================================================
"""

import os
import re
import json
import logging
import yaml
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)


def _load_claude_cli_env_fallback() -> Dict[str, str]:
    """
    从 ~/.claude/settings.json 加载 env 块作为兜底
    作用：当项目配置中的 ${ANTHROPIC_AUTH_TOKEN} 占位符无法在进程环境变量中展开时，
         从 Claude CLI 用户级配置中读取有效凭据，避免每次调用都因无效 token 180s 超时
    调用方：Settings._load_config() 兜底
    被调用方：无
    输入参数：无
    输出结果：环境变量字典
    修改记录：
      - 2026-07-22 | v4.1.1 | 新增 ~/.claude/settings.json 兜底加载
    """
    candidates = [
        Path.home() / ".claude" / "settings.json",
        Path("/root/.claude/settings.json"),
    ]
    for path in candidates:
        try:
            if not path.is_file():
                continue
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            env_block = data.get("env", {}) if isinstance(data, dict) else {}
            if env_block and isinstance(env_block, dict):
                logger.info(
                    "从 %s 加载 Claude CLI env 兜底 (keys=%s)",
                    path,
                    list(env_block.keys()),
                )
                return {str(k): str(v) for k, v in env_block.items()}
        except Exception as exc:
            logger.debug("加载 %s 失败: %s", path, exc)
    return {}


def expand_env_vars(value):
    """
    展开配置值中的 ${VAR} 环境变量引用
    作用：将字符串中的 ${VAR} 模式替换为实际环境变量值，
         若环境变量未设置则保留原占位符
    调用方：Settings._load_config()
    被调用方：无（纯工具函数）
    输入参数：value - 待展开的值（str/dict/list/其他）
    输出结果：展开后的值
    """
    if isinstance(value, str):
        pattern = re.compile(r'\$\{(\w+)\}')
        # 1) 优先查进程环境变量
        # 2) 兜底从 ~/.claude/settings.json 读取（Claude CLI 用户级配置）
        fallback = _load_claude_cli_env_fallback()

        def _sub(m):
            name = m.group(1)
            in_process = os.environ.get(name)
            if in_process:
                return in_process
            in_fallback = fallback.get(name)
            if in_fallback:
                return in_fallback
            return m.group(0)
        return pattern.sub(_sub, value)
    elif isinstance(value, dict):
        return {k: expand_env_vars(v) for k, v in value.items()}
    elif isinstance(value, list):
        return [expand_env_vars(v) for v in value]
    return value


class Settings:
    """
    全局配置单例类（V4.1 升级版）
    作用：加载并管理平台所有配置项，提供类型安全的属性访问
    调用方：所有需要读取配置的模块
    被调用方：无（顶层配置）
    """

    _instance = None
    _config: Dict[str, Any] = {}

    def __new__(cls):
        """单例模式：确保全局只有一个配置实例"""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._load_config()
        return cls._instance

    def _load_config(self):
        """
        加载 YAML 配置文件
        运行步骤：
          1. 定位项目根目录（backend 的父目录）
          2. 读取 config/auto_code_config.yaml
          3. 解析 YAML 内容为字典
          4. 文件不存在时使用默认配置
        """
        project_root = Path(__file__).resolve().parent.parent.parent

        config_path = project_root / "config" / "auto_code_config.yaml"

        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                self._config = yaml.safe_load(f) or {}
        else:
            logger.warning(
                "配置文件 config/auto_code_config.yaml 不存在，使用默认配置启动"
            )
            self._config = self._default_config()

        # 展开配置值中的 ${VAR} 环境变量引用
        self._config = expand_env_vars(self._config)

    def _default_config(self) -> Dict[str, Any]:
        """返回默认配置（配置文件缺失时的兜底方案）"""
        return {
            "server": {"host": "0.0.0.0", "port": 8080, "cors_origins": ["*"]},
            "database": {"type": "sqlite", "path": "data/platform.db"},
            "cli": {
                # CLI 可执行文件名或绝对路径
                # - 默认 "claude"：通过 BaseCLIExecutor._resolve_executable 自动解析
                #   （支持 nvm/npm 全局安装路径，如 ~/.nvm/versions/node/*/bin/）
                # - 也可配置为绝对路径绕过自动解析，例如："/usr/local/bin/claude"
                "executable": "claude",
                "default_timeout": 600,
                "max_retries": 3,
                "retry_base_delay": 2,
                "max_concurrent": 5,
                "env": {
                    "ANTHROPIC_AUTH_TOKEN": "",
                    "ANTHROPIC_BASE_URL": "https://ark.cn-beijing.volces.com/api/coding",
                    "ANTHROPIC_MODEL": "deepseek-v4-pro[1m]",
                    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "deepseek-v4-flash",
                    "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-v4-flash",
                    "CLAUDE_CODE_EFFORT_LEVEL": "max",
                    "API_TIMEOUT_MS": "3000000",
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC": "1",
                },
            },
            "scheduling": {
                "strategy": "least_loaded",
                "max_iterations": 5,
                "health_check_interval": 30,
            },
            "hermes": {
                "executable": "hermes",
                "default_timeout": 600,
                "max_retries": 3,
                "retry_base_delay": 2,
            },
            "logging": {
                "level": "INFO",
                "dir": "logs",
                "max_bytes": 10485760,
                "backup_count": 5,
            },
            "storage": {"data_dir": "data", "workspace_dir": "workspace"},
            "quota": {
                "per_5_hours": 6000,
                "per_week": 45000,
                "per_month": 90000,
                "alert_level_1": 50,
                "alert_level_2": 80,
                "alert_level_3": 100,
                "max_parallel_normal": 5,
                "max_parallel_level_1": 3,
                "max_parallel_level_2": 2,
                "max_parallel_level_3": 1,
                "max_calls_per_minute_normal": 20,
                "max_calls_per_minute_level_1": 15,
                "max_calls_per_minute_level_2": 10,
                "max_calls_per_minute_level_3": 5,
                "auto_restart_high_priority": True,
                "auto_restart_wait_minutes": 60,
                "low_priority_starvation_hours": 24,
            },
            "context": {
                "compression_threshold": 70,
                "max_context_tokens": 200000,
                "reserved_constraint_tokens": 50000,
            },
            "architecture": {
                "max_critic_iterations": 3,
                "max_human_rejections": 2,
            },
            "evaluation": {"max_iterations": 2},
            "human_review": {
                "default_timeout_hours": 24,
                "stall_days": 7,
            },
            "git": {
                "branch_strategy": "default",
                "auto_commit_mode": "milestone",
                "protected_branches": ["main", "master"],
            },
            "security": {
                "max_review_iterations": 3,
                "tools": {
                    "cppcheck_enabled": True,
                    "clang_tidy_enabled": True,
                    "pylint_enabled": True,
                    "roslint_enabled": True,
                },
            },
            "notification": {"channel": "log_only", "min_alert_level": "warning"},
            "github": {
                "token": "",
                "default_visibility": "private",
                "auto_push_enabled": True,
                "max_push_retries": 3,
                "push_retry_delay": 5,
            },
        }

    # ============================================================
    # 基础配置属性（兼容旧版）
    # ============================================================

    @property
    def server(self) -> Dict[str, Any]:
        """服务器配置：host、port、cors_origins"""
        return self._config.get("server", {})

    @property
    def database(self) -> Dict[str, Any]:
        """数据库配置：type、path"""
        return self._config.get("database", {})

    @property
    def cli(self) -> Dict[str, Any]:
        """CLI 集成配置：executable、timeout、retries 等"""
        return self._config.get("cli", {})

    @property
    def scheduling(self) -> Dict[str, Any]:
        """调度配置：strategy、max_iterations、health_check_interval"""
        return self._config.get("scheduling", {})

    @property
    def hermes(self) -> Dict[str, Any]:
        """Hermes 配置：executable、default_timeout、max_retries"""
        return self._config.get("hermes", {})

    @property
    def logging_config(self) -> Dict[str, Any]:
        """日志配置：level、dir、max_bytes、backup_count"""
        return self._config.get("logging", {})

    @property
    def storage(self) -> Dict[str, Any]:
        """存储配置：data_dir、workspace_dir"""
        return self._config.get("storage", {})

    # ============================================================
    # V4.1 新增配置属性
    # ============================================================

    @property
    def quota(self) -> Dict[str, Any]:
        """
        配额管控配置
        包含：per_5_hours、per_week、per_month、alert_level_1/2/3、
             max_parallel_*、max_calls_per_minute_*、auto_restart_*、
             low_priority_starvation_hours
        """
        return self._config.get("quota", {})

    @property
    def context(self) -> Dict[str, Any]:
        """
        上下文生命周期管理配置
        包含：compression_threshold、max_context_tokens、
             reserved_constraint_tokens
        """
        return self._config.get("context", {})

    @property
    def architecture(self) -> Dict[str, Any]:
        """
        架构设计批判迭代配置
        包含：max_critic_iterations、max_human_rejections
        """
        return self._config.get("architecture", {})

    @property
    def evaluation(self) -> Dict[str, Any]:
        """
        系统评测配置
        包含：max_iterations
        """
        return self._config.get("evaluation", {})

    @property
    def human_review(self) -> Dict[str, Any]:
        """
        人工确认节点超时配置
        包含：default_timeout_hours、stall_days、nodes
        """
        return self._config.get("human_review", {})

    @property
    def task_timeout(self) -> Dict[str, Any]:
        """
        任务超时默认标准配置
        包含各任务类型的 default 和 max 超时时间
        """
        return self._config.get("task_timeout", {})

    @property
    def api_error_handling(self) -> Dict[str, Any]:
        """
        API 调用异常处理配置
        包含各错误类型的重试次数和退避策略
        """
        return self._config.get("api_error_handling", {})

    @property
    def git_config(self) -> Dict[str, Any]:
        """
        Git 版本管理配置
        包含：branch_strategy、auto_commit_mode、protected_branches、
             commit_extensions、ignore_patterns
        """
        return self._config.get("git", {})

    @property
    def memory_store(self) -> Dict[str, Any]:
        """
        记忆库配置
        包含：embedding_model、code_embedding_model、local_model_path、
             similarity_threshold、max_search_results
        """
        return self._config.get("memory_store", {})

    @property
    def security(self) -> Dict[str, Any]:
        """
        安全管控配置
        包含：max_review_iterations、tools
        """
        return self._config.get("security", {})

    @property
    def notification(self) -> Dict[str, Any]:
        """
        告警通知配置
        包含：channel、webhook_url、min_alert_level
        """
        return self._config.get("notification", {})

    @property
    def local_intercept(self) -> Dict[str, Any]:
        """
        本地拦截层配置
        包含：enabled、cache_ttl_seconds、knowledge_base_path
        """
        return self._config.get("local_intercept", {})

    @property
    def github(self) -> Dict[str, Any]:
        """
        GitHub 自动推送配置
        包含：token、default_visibility、auto_push_enabled、
             max_push_retries、push_retry_delay
        """
        return self._config.get("github", {})

    # ============================================================
    # 工具方法
    # ============================================================

    def get_project_root(self) -> Path:
        """获取项目根目录路径"""
        return Path(__file__).resolve().parent.parent.parent

    def reload(self):
        """
        运行时重载配置
        用于用户修改配置文件后无需重启即可生效
        """
        self._load_config()


# 全局配置单例
settings = Settings()
