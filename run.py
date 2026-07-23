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
# ============================================================
"""

import sys
import uvicorn
from pathlib import Path

# 确保项目根目录在 Python 路径中
sys.path.insert(0, str(Path(__file__).resolve().parent))

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
