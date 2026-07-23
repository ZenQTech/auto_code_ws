"""
# ============================================================
# Loop Engineering v6 — 端到端 e2e 运行脚本
# ============================================================
# 核心作用：端到端跑通 15 步工作流，生成两个 LLM-可验收的项目：
#           1) warehouse_visualizer  前端可视化大屏（React+Vite+TS+Tailwind）
#           2) agv_fleet_robot        机器人全栈项目（ROS2 ament_python）
# 运行流程：
#   1. 解析命令行参数（项目类型 / 项目名）
#   2. 实例化 LoopEngineeringWorkflow
#   3. 顺序执行 15 步
#   4. 验证项目结构、关键文件、git log
#   5. 输出 JSON 结果
# 输入参数：
#   --name: 项目名（默认 warehouse_visualizer）
#   --type: frontend | robot | fullstack
#   --input: 用户需求文本
# 输出结果：WorkflowResult JSON
# 修改记录：
#   - 2026-07-23 | v6.0.0 | 初始版本，对应 loop_engineering_v6.py
# ============================================================
"""

import argparse
import json
import os
import sys
from pathlib import Path

# 加入工作区根目录
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# 在导入前注入 LLM token 环境变量（兜底）
os.environ.setdefault(
    "ANTHROPIC_AUTH_TOKEN",
    "cdb90dbc-9f97-43bf-a762-406a986c5881",
)
os.environ.setdefault(
    "ANTHROPIC_BASE_URL",
    "https://ark.cn-beijing.volces.com/api/coding",
)
os.environ.setdefault("ANTHROPIC_MODEL", "deepseek-v4-flash")

from backend.app.services.loop_engineering_v6 import (  # noqa: E402
    LoopEngineeringWorkflow,
    run_workflow,
)

DEFAULT_FRONTEND_INPUT = (
    "智能仓储多机器人调度与控制系统的**前端可视化大屏**：\n"
    "1. 实时展示 3 台 AGV 在 500 平米仓库内的位置与轨迹\n"
    "2. KPI 卡片：当前任务数、完成任务数、AGV 在线数、平均响应时间\n"
    "3. 任务调度面板：显示当前任务队列，支持优先级排序\n"
    "4. 告警面板：实时显示急停、碰撞、电量低等告警\n"
    "5. 仓库平面图：可缩放、可点击 AGV 查详情\n"
    "6. 仿真主循环：3 台 AGV 模拟移动（每 1-2 秒位置更新）\n"
    "7. 响应式布局：1280×800 及以上\n"
    "技术栈：React 18 + Vite 5 + TypeScript 5 + Tailwind 3 + Zustand 4\n"
    "部署：纯前端，无后端依赖"
)

DEFAULT_ROBOT_INPUT = (
    "智能仓储多机器人调度与控制系统的**机器人全栈项目**：\n"
    "1. ROS2 Humble 环境，3 台 AGV 协同\n"
    "2. 节点：perception_node、path_planner_node、motion_controller_node、"
    "safety_node、interaction_node\n"
    "3. 感知融合：LiDAR + IMU + 轮式里程计，EKF 滤波\n"
    "4. 路径规划：A* 全局 + DWA 局部\n"
    "5. 运动控制：PID 双闭环\n"
    "6. 安全：物理碰撞检测 + 虚拟安全区 + 急停\n"
    "7. 任务调度 API：REST 风格（rclpy + http server）\n"
    "技术栈：ROS2 Humble + Python 3.10 + ament_python + launch 启动\n"
    "部署：colcon build + ros2 launch 一键启动\n"
    "测试：unit + integration，pytest"
)


def main():
    parser = argparse.ArgumentParser(description="Loop Engineering v6 e2e")
    parser.add_argument(
        "--name", required=True, help="项目名（决定 /home/qizheng/auto_code_data/<name>/）"
    )
    parser.add_argument(
        "--type",
        default="frontend",
        choices=["frontend", "robot", "fullstack"],
    )
    parser.add_argument(
        "--input",
        default=None,
        help="用户需求文本；不传则按 type 自动生成默认需求",
    )
    args = parser.parse_args()

    user_input = args.input
    if not user_input:
        if args.type == "frontend":
            user_input = DEFAULT_FRONTEND_INPUT
        elif args.type == "robot":
            user_input = DEFAULT_ROBOT_INPUT
        else:
            user_input = DEFAULT_FRONTEND_INPUT + "\n\n" + DEFAULT_ROBOT_INPUT

    print(f"=== Loop Engineering v6 e2e ===")
    print(f"  project: {args.name}")
    print(f"  type:    {args.type}")
    print(f"  input:   {user_input[:100]}...")
    print()

    result = run_workflow(user_input, args.name, args.type)
    print(f"=== Workflow Result ===")
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))

    # 验证项目结构
    print(f"\n=== Project Validation ===")
    project_root = f"/home/qizheng/auto_code_data/{args.name}"
    print(f"  project_root: {project_root}")
    print(f"  exists: {os.path.exists(project_root)}")
    if os.path.exists(project_root):
        # 列出所有非 .git 文件
        all_files = []
        for root, dirs, files in os.walk(project_root):
            if ".git" in root:
                continue
            for f in files:
                rel = os.path.relpath(os.path.join(root, f), project_root)
                all_files.append(rel)
        print(f"  file count: {len(all_files)}")
        for f in sorted(all_files)[:30]:
            size = os.path.getsize(os.path.join(project_root, f))
            print(f"    {f} ({size} bytes)")

    return 0 if result.success else 1


if __name__ == "__main__":
    sys.exit(main())
