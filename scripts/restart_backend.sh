#!/bin/bash
# 重启后端 uvicorn 服务（v5.8.0 新增）
# 用途：代码修改后快速重启后端进程
# 用法：./scripts/restart_backend.sh
set -e
cd /home/qizheng/auto_code_ws

# 停止旧进程
PID=$(ps aux | grep "uvicorn app.main" | grep -v grep | awk '{print $2}' | head -1)
if [ -n "$PID" ]; then
  echo "[$(date '+%H:%M:%S')] Stopping uvicorn PID=$PID"
  kill -TERM $PID 2>/dev/null || true
  sleep 2
  kill -9 $PID 2>/dev/null || true
fi

# 启动新进程
cd backend
nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --log-level info \
  >> /home/qizheng/auto_code_ws/logs/platform_$(date +%Y%m%d).log 2>&1 &
sleep 3
NEW_PID=$(ps aux | grep "uvicorn app.main" | grep -v grep | awk '{print $2}' | head -1)
echo "[$(date '+%H:%M:%S')] New PID=$NEW_PID"
