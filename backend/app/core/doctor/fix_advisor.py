"""
# ============================================================
# Hermes Doctor - 修复建议生成器
# ============================================================
# 核心作用：为每个 error / warning 检查项提供修复步骤
# 运行流程：
#   1. 维护 FIX_TEMPLATES 字典（check_id -> 修复模板）
#   2. 提供 get_fix(check_id) 查询接口
#   3. 提供 list_all() 列出所有可用修复
# 输出结果：FixSuggestion 对象
# 修改记录：
#   - 2026-07-28 | v1.0.0 | Cycle 11 P2-2 新建
# ============================================================
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from .base import FixSuggestion


# ============================================================
# 修复模板：覆盖 6 大类共 42+ 检查项
# ============================================================
FIX_TEMPLATES: Dict[str, Dict[str, Any]] = {
    # ============================================================
    # Environment
    # ============================================================
    "environment.python_version": {
        "title": "升级 Python 到 3.10+",
        "steps": [
            "# Ubuntu / Debian",
            "sudo apt update",
            "sudo apt install python3.11 python3.11-venv",
            "# 创建软链接（可选）",
            "sudo update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.11 1",
        ],
        "risk_level": "medium",
        "estimated_time": "5m",
    },
    "environment.node_version": {
        "title": "升级 Node.js 到 18+",
        "steps": [
            "# 使用 nvm",
            "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash",
            "source ~/.bashrc",
            "nvm install 18",
            "nvm use 18",
        ],
        "risk_level": "low",
        "estimated_time": "3m",
    },
    "environment.git_version": {
        "title": "升级 Git 到 2.30+",
        "steps": [
            "sudo apt update",
            "sudo apt install -y git",
            "git --version  # 验证",
        ],
        "risk_level": "low",
        "estimated_time": "2m",
    },
    "environment.os": {
        "title": "切换到支持的操作系统",
        "steps": [
            "Hermes 支持 Linux / macOS / WSL2",
            "Windows 原生不支持，请使用 WSL2：",
            "wsl --install",
        ],
        "risk_level": "medium",
        "estimated_time": "10m",
    },
    "environment.shell": {
        "title": "切换到 bash 或 zsh",
        "steps": [
            "# 临时切换",
            "bash",
            "# 永久切换",
            "chsh -s /bin/bash",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "environment.encoding": {
        "title": "设置 UTF-8 编码",
        "steps": [
            "export LANG=en_US.UTF-8",
            "export LC_ALL=en_US.UTF-8",
            "# 永久生效",
            "echo 'export LANG=en_US.UTF-8' >> ~/.bashrc",
            "source ~/.bashrc",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "environment.anthropic_api_key": {
        "title": "设置 ANTHROPIC_API_KEY 环境变量",
        "steps": [
            "# 临时设置",
            "export ANTHROPIC_API_KEY=sk-ant-api03-...",
            "# 永久生效（推荐）",
            "echo 'export ANTHROPIC_API_KEY=sk-ant-...' >> ~/.bashrc",
            "source ~/.bashrc",
            "# 验证",
            "echo $ANTHROPIC_API_KEY | head -c 8",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "environment.anthropic_base_url": {
        "title": "检查 ANTHROPIC_BASE_URL 可达性",
        "steps": [
            "# 检查 URL 是否正确",
            "echo $ANTHROPIC_BASE_URL",
            "# 测试连通性",
            f"curl -m 5 ${{ANTHROPIC_BASE_URL:-https://api.anthropic.com}}/",
            "# 如使用代理，设置 HTTPS_PROXY",
            "export HTTPS_PROXY=http://127.0.0.1:7890",
        ],
        "risk_level": "low",
        "estimated_time": "2m",
    },
    "environment.home_dir": {
        "title": "修复 $HOME 目录权限",
        "steps": [
            "ls -ld $HOME",
            "chmod 755 $HOME",
            "ls -ld $HOME  # 应为 drwxr-xr-x",
        ],
        "risk_level": "medium",
        "estimated_time": "1m",
    },
    "environment.hermes_home": {
        "title": "初始化 Hermes 配置目录",
        "steps": [
            "mkdir -p ~/.hermes",
            "hermes init",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },

    # ============================================================
    # Workspace
    # ============================================================
    "workspace.current_path": {
        "title": "进入项目目录",
        "steps": [
            "cd /home/qizheng/auto_code_ws",
            "# 或您的工作目录",
            "pwd",
        ],
        "risk_level": "low",
        "estimated_time": "10s",
    },
    "workspace.git_status": {
        "title": "清理未提交的修改",
        "steps": [
            "git status  # 查看未提交内容",
            "git add .",
            "git commit -m 'chore: cleanup before doctor'",
            "# 或暂存",
            "git stash",
        ],
        "risk_level": "medium",
        "estimated_time": "1m",
    },
    "workspace.remote": {
        "title": "配置 git 远程仓库",
        "steps": [
            "git remote -v",
            "git remote add origin <repository-url>",
            "git push -u origin main",
        ],
        "risk_level": "medium",
        "estimated_time": "1m",
    },
    "workspace.trae_dir": {
        "title": "创建 .trae 配置目录",
        "steps": [
            "mkdir -p .trae/specs",
            "mkdir -p .trae/agents",
            "mkdir -p .trae/hooks",
        ],
        "risk_level": "low",
        "estimated_time": "10s",
    },
    "workspace.agents_md": {
        "title": "创建 AGENTS.md",
        "steps": [
            "# 复制模板",
            "cp .trae/templates/AGENTS.md.template AGENTS.md",
            "# 或手动创建基础内容",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "workspace.specs_dir": {
        "title": "创建 .trae/specs/ 目录",
        "steps": [
            "mkdir -p .trae/specs",
        ],
        "risk_level": "low",
        "estimated_time": "5s",
    },
    "workspace.disk_space": {
        "title": "释放磁盘空间",
        "steps": [
            "df -h",
            "# 清理 docker",
            "docker system prune -a",
            "# 清理旧日志",
            "find /var/log -name '*.log' -mtime +30 -delete",
            "# 清理 pip 缓存",
            "pip cache purge",
        ],
        "risk_level": "medium",
        "estimated_time": "5m",
    },
    "workspace.file_count": {
        "title": "减少项目文件数",
        "steps": [
            "# 添加到 .gitignore",
            "echo 'node_modules/' >> .gitignore",
            "echo '__pycache__/' >> .gitignore",
            "echo '.venv/' >> .gitignore",
            "find . -name 'node_modules' -type d -prune -exec rm -rf {} +",
        ],
        "risk_level": "medium",
        "estimated_time": "2m",
    },

    # ============================================================
    # LLM
    # ============================================================
    "llm.api_reachable": {
        "title": "检查 LLM API 可达性",
        "steps": [
            "echo $ANTHROPIC_BASE_URL",
            "curl -m 5 -v $ANTHROPIC_BASE_URL/",
            "# 检查代理",
            "echo $HTTPS_PROXY",
            "# 检查 DNS",
            "nslookup $(echo $ANTHROPIC_BASE_URL | awk -F/ '{print $3}')",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "llm.api_latency": {
        "title": "优化 LLM API 延迟",
        "steps": [
            "# 切换到更近的 region",
            "# 使用 streaming 减少首字延迟",
            "# 升级到更快的模型",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "llm.models_available": {
        "title": "检查模型可用性",
        "steps": [
            "curl -H 'x-api-key: $ANTHROPIC_API_KEY' \\",
            "  $ANTHROPIC_BASE_URL/v1/models",
            "# 升级 API 套餐以解锁更多模型",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "llm.token_quota": {
        "title": "管理 Token 配额",
        "steps": [
            "# 查看当前用量",
            "hermes quota",
            "# 等待配额重置（5h / 周 / 月）",
            "# 或升级套餐",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "llm.streaming": {
        "title": "启用流式响应",
        "steps": [
            "# 检查 API 网关是否支持 SSE",
            "curl -N -H 'x-api-key: $ANTHROPIC_API_KEY' \\",
            "  $ANTHROPIC_BASE_URL/v1/messages -d '...stream:true'",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "llm.tool_use": {
        "title": "升级到支持 Tool Use 的模型",
        "steps": [
            "# Claude 3.5 Sonnet 及以上支持 tool use",
            "hermes model set claude-3-5-sonnet",
        ],
        "risk_level": "low",
        "estimated_time": "10s",
    },

    # ============================================================
    # Database
    # ============================================================
    "database.connection": {
        "title": "检查数据库连接",
        "steps": [
            "echo $DATABASE_URL",
            "# SQLite（默认）",
            "ls -la ~/.hermes/data/hermes.db",
            "# PostgreSQL",
            "psql $DATABASE_URL -c 'SELECT 1'",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "database.migration": {
        "title": "应用最新数据库迁移",
        "steps": [
            "cd /home/qizheng/auto_code_ws/backend",
            "alembic current",
            "alembic upgrade head",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },
    "database.tables": {
        "title": "创建缺失的数据库表",
        "steps": [
            "cd /home/qizheng/auto_code_ws/backend",
            "alembic upgrade head",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },
    "database.indexes": {
        "title": "重建数据库索引",
        "steps": [
            "cd /home/qizheng/auto_code_ws/backend",
            "alembic upgrade head",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },
    "database.size": {
        "title": "归档历史数据",
        "steps": [
            "# 备份",
            "cp ~/.hermes/data/hermes.db ~/.hermes/data/hermes.db.bak",
            "# 清理 session > 30 天",
            "sqlite3 ~/.hermes/data/hermes.db \"DELETE FROM sessions WHERE created_at < datetime('now', '-30 days');\"",
            "sqlite3 ~/.hermes/data/hermes.db VACUUM;",
        ],
        "risk_level": "high",
        "estimated_time": "5m",
    },
    "database.wal_mode": {
        "title": "启用 SQLite WAL 模式",
        "steps": [
            "sqlite3 ~/.hermes/data/hermes.db 'PRAGMA journal_mode=WAL;'",
        ],
        "risk_level": "low",
        "estimated_time": "5s",
    },

    # ============================================================
    # MCP
    # ============================================================
    "mcp.config_exists": {
        "title": "创建 MCP 配置文件",
        "steps": [
            "mkdir -p ~/.hermes",
            "cat > ~/.hermes/mcp.json <<'EOF'",
            "{",
            "  \"mcpServers\": {",
            "    \"filesystem\": {",
            "      \"command\": \"npx\",",
            "      \"args\": [\"-y\", \"@modelcontextprotocol/server-filesystem\"]",
            "    }",
            "  }",
            "}",
            "EOF",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "mcp.config_valid": {
        "title": "修复 MCP 配置文件格式",
        "steps": [
            "cat ~/.hermes/mcp.json | jq .",
            "# 修复 JSON 语法错误",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "mcp.servers_declared": {
        "title": "添加 MCP 服务器",
        "steps": [
            "hermes mcp add filesystem -- npx -y @modelcontextprotocol/server-filesystem",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "mcp.servers_reachable": {
        "title": "重启 MCP 服务器",
        "steps": [
            "hermes mcp list",
            "hermes mcp restart <server-name>",
            "# 检查日志",
            "hermes mcp logs <server-name>",
        ],
        "risk_level": "medium",
        "estimated_time": "1m",
    },
    "mcp.protocol_version": {
        "title": "升级 MCP 协议",
        "steps": [
            "pip install --upgrade mcp",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
    "mcp.tools_listed": {
        "title": "检查 MCP 服务器工具",
        "steps": [
            "hermes mcp list-tools <server-name>",
            "# 重启服务器",
            "hermes mcp restart <server-name>",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },

    # ============================================================
    # Dependencies
    # ============================================================
    "dependencies.fastapi": {
        "title": "升级 FastAPI",
        "steps": [
            "pip install --upgrade fastapi",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },
    "dependencies.sqlalchemy": {
        "title": "升级 SQLAlchemy",
        "steps": [
            "pip install --upgrade sqlalchemy",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },
    "dependencies.httpx": {
        "title": "升级 httpx",
        "steps": [
            "pip install --upgrade httpx",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "dependencies.pydantic": {
        "title": "升级 Pydantic",
        "steps": [
            "pip install --upgrade pydantic",
        ],
        "risk_level": "medium",
        "estimated_time": "30s",
    },
    "dependencies.uvicorn": {
        "title": "升级 Uvicorn",
        "steps": [
            "pip install --upgrade uvicorn",
        ],
        "risk_level": "low",
        "estimated_time": "30s",
    },
    "dependencies.frontend_node_modules": {
        "title": "安装前端依赖",
        "steps": [
            "cd /home/qizheng/auto_code_ws/frontend",
            "npm install",
        ],
        "risk_level": "low",
        "estimated_time": "2m",
    },
    "dependencies.dist_exists": {
        "title": "构建前端",
        "steps": [
            "cd /home/qizheng/auto_code_ws/frontend",
            "npm run build",
        ],
        "risk_level": "low",
        "estimated_time": "1m",
    },
}


# ============================================================
# 修复建议生成器
# ============================================================
class FixAdvisor:
    """修复建议生成器"""

    def __init__(self):
        self._templates = FIX_TEMPLATES.copy()

    def get_fix(self, check_id: str) -> Optional[FixSuggestion]:
        """根据 check_id 获取修复建议"""
        template = self._templates.get(check_id)
        if not template:
            return None
        return FixSuggestion(
            check_id=check_id,
            title=template["title"],
            steps=template["steps"],
            risk_level=template.get("risk_level", "low"),
            automated=template.get("automated", False),
            estimated_time=template.get("estimated_time", "1m"),
        )

    def list_all(self) -> Dict[str, Dict[str, Any]]:
        """列出所有可用修复（按分类）"""
        result: Dict[str, Dict[str, Any]] = {}
        for check_id, template in self._templates.items():
            category = check_id.split(".")[0]
            if category not in result:
                result[category] = {}
            result[category][check_id] = template
        return result

    def get_fixes_for_category(self, category: str) -> List[FixSuggestion]:
        """获取某分类下的所有修复建议"""
        fixes = []
        for check_id, template in self._templates.items():
            if check_id.startswith(f"{category}."):
                fixes.append(FixSuggestion(
                    check_id=check_id,
                    title=template["title"],
                    steps=template["steps"],
                    risk_level=template.get("risk_level", "low"),
                    automated=template.get("automated", False),
                    estimated_time=template.get("estimated_time", "1m"),
                ))
        return fixes

    def get_fixes_for_items(self, items: list) -> List[FixSuggestion]:
        """根据 CheckItem 列表获取对应的修复建议"""
        fixes = []
        for item in items:
            if item.status in ("error", "warning"):
                fix = self.get_fix(item.id)
                if fix:
                    fixes.append(fix)
                elif item.fix_suggestion:
                    # 使用 CheckItem 自带的修复建议
                    fixes.append(FixSuggestion(
                        check_id=item.id,
                        title=item.name,
                        steps=[item.fix_suggestion],
                        risk_level="low",
                    ))
        return fixes


# 全局单例
_advisor_instance: Optional[FixAdvisor] = None


def get_fix_advisor() -> FixAdvisor:
    """获取全局 FixAdvisor 单例"""
    global _advisor_instance
    if _advisor_instance is None:
        _advisor_instance = FixAdvisor()
    return _advisor_instance
