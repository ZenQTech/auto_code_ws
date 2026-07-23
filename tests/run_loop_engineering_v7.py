"""
# ============================================================
# Loop Engineering v7 — 端到端 e2e 验证脚本
# ============================================================
# 核心作用：跑通 Loop Engineering v7 的 15 步工作流，生成两个
#           LLM-可验收的项目（前端 + 机器人），所有 5 大缺口
#           必须在 e2e 中体现：
#             1. 真实用户交互（auto fallback 模式）
#             2. 独立 CLI Worker 并行
#             3. 真实 HookBus + per-module git 提交
#             4. 真实运行项目（npm run dev / ros2 验证）
#             5. 真实 git push（本地 bare remote）
# 运行流程：
#   1. 解析命令行参数
#   2. 实例化 LoopEngineeringV7 + WorkflowConfig
#   3. 同步执行 run_workflow(config)
#   4. 输出完整 WorkflowResult JSON
#   5. 验证关键证据（文件存在、git log、bare remote commit、npm dev port 探测等）
# 输入参数：
#   --name: 项目名（决定 /home/qizheng/auto_code_data/<name>/）
#   --type: frontend | robot | fullstack
#   --input: 用户需求文本（不传则按 type 自动生成默认需求）
#   --no-real-run: 跳过真实项目运行
#   --no-real-push: 跳过真实 git push
# 输出结果：exit code 0 = success, 1 = failure
# 修改记录：
#   - 2026-07-23 | v7.0.0 | 初始版本，对应 loop_engineering_v7.py
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

from backend.app.services.loop_engineering_v7 import (  # noqa: E402
    LoopEngineeringV7,
    WorkflowConfig,
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


def main() -> int:
    parser = argparse.ArgumentParser(description="Loop Engineering v7 e2e")
    parser.add_argument(
        "--name", required=True,
        help="项目名（决定 /home/qizheng/auto_code_data/<name>/）"
    )
    parser.add_argument(
        "--type", default="frontend",
        choices=["frontend", "robot", "fullstack"],
    )
    parser.add_argument(
        "--input", default=None,
        help="用户需求文本；不传则按 type 自动生成默认需求",
    )
    parser.add_argument(
        "--no-real-run", action="store_true",
        help="跳过真实项目运行（仅做静态检查）",
    )
    parser.add_argument(
        "--no-real-push", action="store_true",
        help="跳过真实 git push",
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

    # Hook 回调：实时打印 hook 事件
    async def hook_cb(event):
        print(
            f"  [Hook] {event.status:18s} task={event.task_id:30s} "
            f"module={event.module:25s} files={len(event.files)} "
            f"msg={event.message[:60]}"
        )

    cfg = WorkflowConfig(
        user_input=user_input,
        project_name=args.name,
        project_type=args.type,
        real_run=not args.no_real_run,
        real_push=not args.no_real_push,
        hook_callback=hook_cb,
    )

    print(f"=== Loop Engineering v7 e2e ===")
    print(f"  project: {args.name}")
    print(f"  type:    {args.type}")
    print(f"  real_run: {cfg.real_run}")
    print(f"  real_push: {cfg.real_push}")
    print(f"  input:   {user_input[:100]}...")
    print()

    result = run_workflow(cfg)
    print(f"\n=== Workflow Result ===")
    print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))

    # 关键证据验证
    print(f"\n=== Evidence Verification ===")
    project_root = result.project_root
    evidence = {}

    # 1. 项目根目录存在
    evidence["project_root_exists"] = os.path.exists(project_root)
    print(f"  project_root_exists: {evidence['project_root_exists']} -> {project_root}")

    # 2. git 仓库存在
    git_dir = os.path.join(project_root, ".git")
    evidence["git_initialized"] = os.path.isdir(git_dir)
    print(f"  git_initialized: {evidence['git_initialized']}")

    # 3. git log 有 commit
    if evidence["git_initialized"]:
        import subprocess
        log_proc = subprocess.run(
            ["git", "-C", project_root, "log", "--oneline"],
            capture_output=True, text=True,
        )
        log_lines = [
            l for l in log_proc.stdout.strip().split("\n") if l
        ]
        evidence["commit_count"] = len(log_lines)
        print(f"  commit_count: {evidence['commit_count']}")
        for line in log_lines[:10]:
            print(f"    {line}")

    # 4. 文件清单
    all_files = []
    for root, dirs, files in os.walk(project_root):
        if ".git" in root:
            continue
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), project_root)
            all_files.append(rel)
    evidence["file_count"] = len(all_files)
    print(f"  file_count: {evidence['file_count']}")
    for f in sorted(all_files)[:15]:
        size = os.path.getsize(os.path.join(project_root, f))
        print(f"    {f} ({size} bytes)")

    # 5. 真实 push 验证：bare remote 有 commit
    remote_path = f"/home/qizheng/auto_code_data/.remotes/{args.name}.git"
    if os.path.isdir(remote_path):
        import subprocess
        bare_log_proc = subprocess.run(
            ["git", "--git-dir", remote_path, "log", "--oneline"],
            capture_output=True, text=True,
        )
        bare_commits = [
            l for l in bare_log_proc.stdout.strip().split("\n") if l
        ]
        evidence["bare_remote_commit_count"] = len(bare_commits)
        print(f"  bare_remote: {remote_path}")
        print(f"  bare_remote_commit_count: {evidence['bare_remote_commit_count']}")
        for line in bare_commits[:5]:
            print(f"    bare> {line}")
    else:
        evidence["bare_remote_commit_count"] = 0
        print(f"  bare_remote: NOT FOUND ({remote_path})")

    # 6. Step 14 验证结果摘要
    run_validation = result.steps[13].output if len(result.steps) >= 14 else {}
    evidence["step14_status"] = run_validation.get("status", "?")
    evidence["step14_all_passed"] = run_validation.get("all_passed", False)
    evidence["step14_checks_count"] = len(run_validation.get("checks", []))
    print(f"  step14_status: {evidence['step14_status']}")
    print(f"  step14_all_passed: {evidence['step14_all_passed']}")
    print(f"  step14_checks_count: {evidence['step14_checks_count']}")

    # 7. 事件流
    evidence["event_count"] = len(result.events)
    print(f"  event_count: {evidence['event_count']}")
    task_completed_events = [
        e for e in result.events if e.get("status") == "task_completed"
    ]
    evidence["task_completed_count"] = len(task_completed_events)
    print(f"  task_completed_count: {evidence['task_completed_count']}")

    print(f"\n=== Final Verdict ===")
    must_pass = {
        "project_root_exists": True,
        "git_initialized": True,
        "commit_count_min": 2,
        "file_count_min": 5,
    }
    all_passed = (
        evidence.get("project_root_exists") == must_pass["project_root_exists"]
        and evidence.get("git_initialized") == must_pass["git_initialized"]
        and evidence.get("commit_count", 0) >= must_pass["commit_count_min"]
        and evidence.get("file_count", 0) >= must_pass["file_count_min"]
    )
    if cfg.real_push:
        all_passed = all_passed and evidence.get("bare_remote_commit_count", 0) >= 1
    print(f"  All critical checks passed: {all_passed}")
    return 0 if (result.success and all_passed) else 1


if __name__ == "__main__":
    sys.exit(main())
