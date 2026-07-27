"""
# ============================================================
# 智能体管理 API
# ============================================================
# 核心作用：提供子 Claude Code CLI 实例的查询接口（只读）
# 运行流程：
#   - GET /api/agents: 获取所有智能体列表
#   - GET /api/agents/{id}: 获取指定智能体详情
#   - DELETE /api/agents/{id}: 注销智能体
#   - GET /api/agents/{id}/health: 健康检查
# 注意：所有 Claude Code CLI 实例由 Hermes 按需动态创建，
#       不提供手动创建接口（POST 已移除）
# 输入参数：通过路径参数传递
# 输出结果：JSON 格式的智能体信息
# 修改记录：
#   v1.0.0 - 2026-06-17：初始版本
#   v1.1.0 - 2026-06-17：移除 POST 创建端点，实例由 Hermes 管理
#   v1.2.0 - 2026-07-27：P2-1 SubAgent workspace 前端展示支持，
#     返回 branch_name / worktree_id / module_name / file_count /
#     commit_count / progress_percent 字段
# ============================================================
"""

import logging
import os
from typing import List
from fastapi import APIRouter, Request, HTTPException

logger = logging.getLogger(__name__)

router = APIRouter()


def _count_workspace_files(workspace: str) -> int:
    """
    统计 workspace 目录下的文件数量
    参数：
      - workspace: workspace 绝对路径
    返回值：文件数量（包含所有后缀，递归）
    """
    if not workspace or not os.path.isdir(workspace):
        return 0
    try:
        count = 0
        for _root, _dirs, files in os.walk(workspace):
            # 跳过 .git 目录
            if "/.git/" in _root or _root.endswith("/.git"):
                continue
            count += len(files)
        return count
    except Exception:
        return 0


def _count_workspace_commits(workspace: str) -> int:
    """
    统计 workspace Git 仓库的提交数
    参数：
      - workspace: workspace 绝对路径
    返回值：提交数（若非 Git 仓库返回 0）
    """
    if not workspace or not os.path.isdir(workspace):
        return 0
    try:
        import subprocess
        result = subprocess.run(
            ["git", "-C", workspace, "rev-list", "--count", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0 and result.stdout.strip():
            return int(result.stdout.strip())
        return 0
    except Exception:
        return 0


def _get_workspace_branch(workspace: str) -> str:
    """
    获取 workspace 当前所在 Git 分支
    参数：
      - workspace: workspace 绝对路径
    返回值：分支名（若非 Git 仓库返回 ""）
    """
    if not workspace or not os.path.isdir(workspace):
        return ""
    try:
        import subprocess
        result = subprocess.run(
            ["git", "-C", workspace, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            branch = result.stdout.strip()
            if branch and branch != "HEAD":
                return branch
        return ""
    except Exception:
        return ""


def _agent_to_dict(a):
    """将 AgentInfo 转换为字典（v1.2.0 扩展 SubAgent workspace 字段）"""
    workspace = a.workspace or ""
    # 若 AgentInfo 已有 branch_name（由 prompt_engineer 注入），直接使用；
    # 否则通过 git 命令动态探测
    branch_name = a.branch_name or _get_workspace_branch(workspace)
    file_count = a.file_count or _count_workspace_files(workspace)
    commit_count = a.commit_count or _count_workspace_commits(workspace)
    return {
        "id": a.id,
        "name": a.name,
        "avatar_seed": a.avatar_seed,
        "status": a.status.value,
        "cli_path": a.cli_path,
        "workspace": workspace,
        "branch_name": branch_name,
        "worktree_id": a.worktree_id or "",
        "module_name": a.module_name or "",
        "file_count": file_count,
        "commit_count": commit_count,
        "progress_percent": a.progress_percent or 0.0,
        "max_concurrent": a.max_concurrent,
        "current_tasks": a.current_tasks,
        "total_tokens": a.total_tokens,
        "total_api_calls": a.total_api_calls,
    }


# ============================================================
# API 端点
# ============================================================

@router.get("")
async def list_agents(request: Request):
    """
    获取所有智能体列表（只读）
    调用方：前端主界面
    被调用方：AgentManager
    返回值：智能体信息列表
    """
    agent_manager = request.app.state.agent_manager
    agents = await agent_manager.get_all_agents()
    return [_agent_to_dict(a) for a in agents]


@router.get("/{agent_id}")
async def get_agent(request: Request, agent_id: str):
    """
    获取指定智能体详情
    调用方：前端聊天框
    被调用方：AgentManager
    参数：
      - agent_id: 智能体 ID
    返回值：智能体信息字典
    """
    agent_manager = request.app.state.agent_manager
    agent = await agent_manager.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="智能体不存在")
    return _agent_to_dict(agent)


@router.delete("/{agent_id}")
async def delete_agent(request: Request, agent_id: str):
    """
    注销智能体
    运行步骤：
      1. 检查智能体是否存在
      2. 调用 AgentManager 注销
      3. 返回操作结果
    调用方：前端管理面板
    被调用方：AgentManager
    参数：
      - agent_id: 智能体 ID
    返回值：操作结果消息
    """
    agent_manager = request.app.state.agent_manager
    success = await agent_manager.unregister_agent(agent_id)
    if not success:
        raise HTTPException(status_code=404, detail="智能体不存在")
    return {"message": "智能体已注销", "agent_id": agent_id}


@router.get("/{agent_id}/health")
async def check_agent_health(request: Request, agent_id: str):
    """
    智能体健康检查
    调用方：前端管理面板、调度器
    被调用方：AgentManager
    参数：
      - agent_id: 智能体 ID
    返回值：健康状态信息
    """
    agent_manager = request.app.state.agent_manager
    agent = await agent_manager.get_agent(agent_id)
    if agent is None:
        raise HTTPException(status_code=404, detail="智能体不存在")
    return {
        "agent_id": agent_id,
        "name": agent.name,
        "status": agent.status.value,
        "current_tasks": agent.current_tasks,
        "max_concurrent": agent.max_concurrent,
        "healthy": agent.status.value in ("online", "busy"),
    }
