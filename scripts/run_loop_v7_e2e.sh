#!/bin/bash
# Loop Engineering v7 端到端测试脚本
# 启动两个项目的完整 15 步工作流（前端 warehouse_v7_e2e + 机器人 agv_fleet_v7_e2e）
# 用途：端到端验证 v7 工作流是否按 15 步完整执行
set -e
cd /home/qizheng/auto_code_ws

PROJECT_TYPE=${1:-frontend}
PROJECT_NAME=${2:-warehouse_v7_e2e}
LOG_FILE=/home/qizheng/auto_code_ws/logs/loop_v7_e2e_${PROJECT_NAME}.log

echo "[$(date '+%H:%M:%S')] ============================================"
echo "[$(date '+%H:%M:%S')] 启动 v7 端到端测试: project=$PROJECT_NAME type=$PROJECT_TYPE"
echo "[$(date '+%H:%M:%S')] ============================================"

USER_INPUT="请设计一个智能仓库调度系统的${PROJECT_TYPE}端。要求：(1) 支持多 AGV 协作调度；(2) 实时可视化仓库地图和 AGV 位置；(3) 任务下发、紧急停止、告警面板；(4) ROS2 Humble 集成（如 robot 项目）或 React 18 + Vite + TypeScript（如 frontend 项目）；(5) 性能指标：响应时间<200ms，路径规划成功率>99%；(6) 端到端可运行。"

# 准备 user_answers（5 轮澄清，每轮选方案A）
USER_ANSWERS_JSON='["方案A", "方案A", "方案A", "方案A", "方案A"]'

curl -s -X POST "http://127.0.0.1:8000/api/workflow/loop-v7/start" \
  -H "Content-Type: application/json" \
  -d "{
    \"user_input\": \"${USER_INPUT}\",
    \"project_name\": \"${PROJECT_NAME}\",
    \"project_type\": \"${PROJECT_TYPE}\",
    \"real_run\": true,
    \"real_push\": true,
    \"user_answers\": ${USER_ANSWERS_JSON},
    \"qa_max_rounds\": 2,
    \"llm_timeout\": 600
  }" \
  | tee ${LOG_FILE}

echo ""
echo "[$(date '+%H:%M:%S')] v7 工作流完成: $PROJECT_NAME"
