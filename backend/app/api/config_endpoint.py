"""
# ============================================================
# 全局配置中心 API 路由（V4.1 新增 - Task 3）
# ============================================================
# 核心作用：提供全局配置的读取和更新 API 端点
# 运行流程：
#   1. GET /api/config：读取 config/auto_code_config.yaml，返回完整配置 JSON
#   2. PUT /api/config：接收部分配置更新，合并写入 YAML 文件，
#      并调用 settings.reload() 重载内存配置
# 输入参数：
#   - GET：无参数
#   - PUT：JSON body，键值对应于 auto_code_config.yaml 的顶层 section
# 输出结果：ConfigResponse 模型，包含所有 section 的嵌套字典
# 修改记录：
#   - 2026-06-24 | v4.1.0 | Task 3 初始版本，实现 GET/PUT /api/config
# ============================================================
"""

import logging
from pathlib import Path
from typing import Any, Dict, Optional

import yaml
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.app.config import settings

logger = logging.getLogger(__name__)

router = APIRouter()

# ============================================================
# Pydantic 响应模型
# ============================================================


class ConfigResponse(BaseModel):
    """
    全局配置响应模型
    作用：定义 GET /api/config 返回的完整配置结构
    调用方：前端 SettingsPanel.tsx 配置面板
    被调用方：GET /api/config 端点
    各字段说明：
      - server: 服务配置（host、port、cors_origins）
      - database: 数据库配置（type、path）
      - cli: CLI 集成配置（executable、timeout、retries、env 等）
      - scheduling: 调度策略配置
      - hermes: Hermes 配置
      - logging: 日志配置
      - storage: 存储配置
      - quota: 配额管控配置
      - context: 上下文管理配置
      - architecture: 架构设计配置
      - evaluation: 系统评测配置
      - human_review: 人工审核配置
      - task_timeout: 任务超时配置
      - api_error_handling: API 异常处理配置
      - git: Git 版本管理配置
      - memory_store: 记忆库配置
      - security: 安全管控配置
      - notification: 告警通知配置
      - local_intercept: 本地拦截层配置
    """
    server: Dict[str, Any] = {}
    database: Dict[str, Any] = {}
    cli: Dict[str, Any] = {}
    scheduling: Dict[str, Any] = {}
    hermes: Dict[str, Any] = {}
    logging: Dict[str, Any] = {}
    storage: Dict[str, Any] = {}
    quota: Dict[str, Any] = {}
    context: Dict[str, Any] = {}
    architecture: Dict[str, Any] = {}
    evaluation: Dict[str, Any] = {}
    human_review: Dict[str, Any] = {}
    task_timeout: Dict[str, Any] = {}
    api_error_handling: Dict[str, Any] = {}
    git: Dict[str, Any] = {}
    memory_store: Dict[str, Any] = {}
    security: Dict[str, Any] = {}
    notification: Dict[str, Any] = {}
    local_intercept: Dict[str, Any] = {}


class ConfigUpdateRequest(BaseModel):
    """
    部分配置更新请求模型
    作用：定义 PUT /api/config 接收的请求体结构
    调用方：前端 SettingsPanel.tsx 保存按钮
    被调用方：PUT /api/config 端点
    说明：所有字段均为可选，仅传入需要更新的 section
    """
    server: Optional[Dict[str, Any]] = None
    database: Optional[Dict[str, Any]] = None
    cli: Optional[Dict[str, Any]] = None
    scheduling: Optional[Dict[str, Any]] = None
    hermes: Optional[Dict[str, Any]] = None
    logging: Optional[Dict[str, Any]] = None
    storage: Optional[Dict[str, Any]] = None
    quota: Optional[Dict[str, Any]] = None
    context: Optional[Dict[str, Any]] = None
    architecture: Optional[Dict[str, Any]] = None
    evaluation: Optional[Dict[str, Any]] = None
    human_review: Optional[Dict[str, Any]] = None
    task_timeout: Optional[Dict[str, Any]] = None
    api_error_handling: Optional[Dict[str, Any]] = None
    git: Optional[Dict[str, Any]] = None
    memory_store: Optional[Dict[str, Any]] = None
    security: Optional[Dict[str, Any]] = None
    notification: Optional[Dict[str, Any]] = None
    local_intercept: Optional[Dict[str, Any]] = None


# ============================================================
# API 端点
# ============================================================


def _get_config_path() -> Path:
    """
    获取配置文件绝对路径
    作用：定位 config/auto_code_config.yaml 的完整路径
    返回值：Path 对象
    """
    project_root = settings.get_project_root()
    return project_root / "config" / "auto_code_config.yaml"


def _read_config() -> Dict[str, Any]:
    """
    从 YAML 文件读取完整配置
    作用：读取 auto_code_config.yaml 并解析为字典
    返回值：完整的配置字典
    异常处理：文件不存在时返回空字典
    """
    config_path = _get_config_path()
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def _write_config(config: Dict[str, Any]):
    """
    将配置字典写回 YAML 文件
    作用：将更新后的完整配置写回 auto_code_config.yaml
    参数：
      - config: Dict[str, Any]，完整配置字典
    异常处理：写入失败时抛出 IOError
    """
    config_path = _get_config_path()
    # 确保父目录存在
    config_path.parent.mkdir(parents=True, exist_ok=True)
    with open(config_path, "w", encoding="utf-8") as f:
        yaml.dump(config, f, allow_unicode=True, default_flow_style=False, sort_keys=False)


@router.get("", response_model=ConfigResponse)
async def get_config():
    """
    获取完整全局配置
    作用：读取 config/auto_code_config.yaml 并以 JSON 返回所有配置项
    调用方：前端 SettingsPanel.tsx（组件挂载时）、其他需要读取配置的模块
    被调用方：无
    返回值：ConfigResponse，包含所有 section 的配置字典
    运行步骤：
      1. 读取 YAML 文件
      2. 将各 section 映射到 ConfigResponse 对应字段
      3. 返回 JSON 响应
    """
    try:
        config = _read_config()
        # 构建响应，仅传入已存在的 section（兼容部分 section 缺失的旧配置）
        response_data = {}
        section_keys = [
            "server", "database", "cli", "scheduling", "hermes", "logging",
            "storage", "quota", "context", "architecture", "evaluation",
            "human_review", "task_timeout", "api_error_handling", "git",
            "memory_store", "security", "notification", "local_intercept",
        ]
        for key in section_keys:
            response_data[key] = config.get(key, {})
        return ConfigResponse(**response_data)
    except Exception as e:
        logger.error(f"读取配置失败: {e}")
        raise HTTPException(status_code=500, detail=f"读取配置失败: {str(e)}")


@router.put("", response_model=ConfigResponse)
async def update_config(update: ConfigUpdateRequest):
    """
    更新全局配置（部分更新）
    作用：接收前端传递的部分配置更新，合并到现有 YAML 文件，
          然后调用 settings.reload() 重载内存配置
    调用方：前端 SettingsPanel.tsx「保存设置」按钮
    被调用方：settings.reload() 重载配置
    参数：
      - update: ConfigUpdateRequest，仅包含需要更新的 section 字段
    返回值：ConfigResponse，更新后的完整配置
    运行步骤：
      1. 读取现有 YAML 文件
      2. 遍历 update 中的非空字段，合并到现有配置
      3. 写回 YAML 文件
      4. 调用 settings.reload() 使内存配置生效
      5. 返回更新后的完整配置
    """
    try:
        # 1. 读取现有配置
        config = _read_config()
        # 2. 将 update 中的非空字段合并到现有配置
        update_dict = update.model_dump(exclude_none=True)
        for key, value in update_dict.items():
            if value is not None:
                config[key] = value
        # 3. 写回 YAML 文件
        _write_config(config)
        # 4. 重载内存配置（使运行时配置立即生效）
        settings.reload()
        logger.info("全局配置已更新并重载")
        # 5. 返回更新后的完整配置
        response_data = {}
        section_keys = [
            "server", "database", "cli", "scheduling", "hermes", "logging",
            "storage", "quota", "context", "architecture", "evaluation",
            "human_review", "task_timeout", "api_error_handling", "git",
            "memory_store", "security", "notification", "local_intercept",
        ]
        for key in section_keys:
            response_data[key] = config.get(key, {})
        return ConfigResponse(**response_data)
    except Exception as e:
        logger.error(f"更新配置失败: {e}")
        raise HTTPException(status_code=500, detail=f"更新配置失败: {str(e)}")
