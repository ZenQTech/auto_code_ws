"""
# ============================================================
# 平台启动脚本
# ============================================================
# 核心作用：启动 Claude Code CLI 智能体调度平台后端服务
# 运行流程：
#   1. 配置日志
#   2. 启动 Uvicorn 服务器
#   3. 监听本地 IP 端口
# 输入参数：无（通过配置文件读取）
# 输出结果：运行中的 Web 服务
# 修改记录：
#   - 2026-07-31 | v1.1.0 | 修复 ModuleNotFoundError: No module named 'app'
#     原因：backend/app/api/*.py 中部分文件使用绝对导入（from app.xxx import），
#     而 run.py 仅把项目根目录加入 sys.path，导致 'app' 不可见。
#     修复：在启动 uvicorn 前将 backend/ 加入 sys.path，使绝对导入与
#     'backend.app.main' 形式的相对路径同时可用。
# ============================================================
"""

import sys
import uvicorn
from pathlib import Path

# 确保项目根目录在 Python 路径中（用于 backend.app.main 这种导入）
_PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_PROJECT_ROOT))

# 同时把 backend/ 加入 sys.path，使 from app.xxx import 这种绝对导入
# （如 backend/app/api/plugins.py 中的 from app.core.plugins import）能够解析
_BACKEND_DIR = _PROJECT_ROOT / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from backend.app.config import settings


def main():
    """主启动函数"""
    server_config = settings.server

    print("=" * 60)
    print("  Claude Code CLI 代码智能体调度平台")
    print("=" * 60)
    print(f"  监听地址: http://{server_config.get('host', '0.0.0.0')}:{server_config.get('port', 8080)}")
    print(f"  API 文档: http://localhost:{server_config.get('port', 8080)}/docs")
    print(f"  健康检查: http://localhost:{server_config.get('port', 8080)}/health")
    print("=" * 60)

    uvicorn.run(
        "backend.app.main:app",
        host=server_config.get("host", "0.0.0.0"),
        port=server_config.get("port", 8080),
        reload=False,
        log_level=settings.logging_config.get("level", "info").lower(),
    )


if __name__ == "__main__":
    main()
