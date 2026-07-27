# ============================================================
# Claude Code 调度平台 - 后端服务 Docker 镜像
# ============================================================
# 核心作用：构建可运行的 FastAPI 后端容器镜像
# 运行流程：
#   1. 基于 python:3.10-slim 最小化镜像体积
#   2. 安装 Python 依赖（来自 backend/requirements.txt）
#   3. 拷贝后端代码、平台启动脚本与配置文件
#   4. 暴露 8000 端口，启动 uvicorn
# 输入参数：
#   - 构建时无需参数
#   - 运行时应通过 docker-compose 注入 DATABASE_URL / ANTHROPIC_AUTH_TOKEN 等环境变量
# 输出结果：可运行后端服务的 Docker 镜像
# 修改记录：
#   - 2026-07-24 | v1.0.0 | Module F2 - 基础设施升级：基于 python:3.10-slim 的后端镜像
# ============================================================
FROM python:3.10-slim
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY auto_code_config.yaml .
COPY run.py .
EXPOSE 8000
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
