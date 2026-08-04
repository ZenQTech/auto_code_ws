#!/usr/bin/env python3
"""
# ============================================================
# Mock CLI 测试脚本 (v1.0.0)
# Cycle 65 G65-01
# ============================================================
# 核心作用：模拟 Claude/Hermes CLI 的 JSONL 输出
# 运行流程：
#   1. 接收命令行参数（task / role / mode）
#   2. 输出 session_start 事件
#   3. 模拟工具调用序列（输出 tool_use / tool_result）
#   4. 输出 content_delta 流（模拟 LLM 输出）
#   5. 输出 progress 事件
#   6. 输出 session_end 事件
# 设计要点：
#   - 完全模拟 JSONL 协议（每行一个事件）
#   - 支持延迟模拟（--delay 参数）
#   - 支持错误注入（--fail 参数）
#   - 支持自定义工具序列（--tools 参数）
# 输入参数：
#   --role: 角色名
#   --task: 任务描述
#   --delay: 每个事件间延迟（秒，默认 0.01）
#   --fail: 注入错误（默认 False）
#   --exit-code: 退出码（默认 0）
#   --tools: 自定义工具序列（逗号分隔）
#   --output-format: jsonl（固定）
# 输出结果：JSONL 事件流到 stdout
# 对标：Codex v0.133 CLI JSONL 协议
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 65 G65-01 初次创建
# ====================================
"""

import argparse
import json
import os
import sys
import time


def emit(event_type: str, **data) -> None:
    """输出 JSONL 事件到 stdout"""
    event = {
        "type": event_type,
        "timestamp": time.time(),
        **data,
    }
    line = json.dumps(event, ensure_ascii=False)
    print(line, flush=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Mock CLI for testing")
    parser.add_argument("--role", default="default", help="角色名")
    parser.add_argument("--task", default="", help="任务描述")
    parser.add_argument("--nickname", default="", help="实例昵称")
    parser.add_argument("--model", default=None, help="模型")
    parser.add_argument("--reasoning", default=None, help="推理力度")
    parser.add_argument("--sandbox", default=None, help="沙箱模式")
    parser.add_argument("--delay", type=float, default=0.01, help="事件间延迟（秒）")
    parser.add_argument("--fail", action="store_true", help="注入错误")
    parser.add_argument("--exit-code", type=int, default=0, help="退出码")
    parser.add_argument(
        "--tools",
        default="read,output",
        help="逗号分隔的工具序列",
    )
    parser.add_argument("--output-format", default="jsonl", help="输出格式")
    parser.add_argument("--content-chunks", type=int, default=3, help="内容块数量")
    parser.add_argument("--no-session-start", action="store_true", help="跳过 session_start")
    parser.add_argument("--no-session-end", action="store_true", help="跳过 session_end")
    args = parser.parse_args()

    # 允许通过环境变量控制行为（便于在 cli_path 固定时切换模式）
    env_fail = os.environ.get("MOCK_CLI_FAIL", "0") == "1"
    if env_fail:
        args.fail = True
        if not os.environ.get("MOCK_CLI_EXIT_CODE"):
            args.exit_code = 1  # fail 默认伴随非零退出码
    env_exit_code = os.environ.get("MOCK_CLI_EXIT_CODE")
    if env_exit_code:
        try:
            args.exit_code = int(env_exit_code)
        except ValueError:
            pass
    env_delay = os.environ.get("MOCK_CLI_DELAY")
    if env_delay:
        try:
            args.delay = float(env_delay)
        except ValueError:
            pass
    env_tools = os.environ.get("MOCK_CLI_TOOLS")
    if env_tools:
        args.tools = env_tools
    env_content_chunks = os.environ.get("MOCK_CLI_CONTENT_CHUNKS")
    if env_content_chunks:
        try:
            args.content_chunks = int(env_content_chunks)
        except ValueError:
            pass

    # 1. session_start 事件
    if not args.no_session_start:
        emit(
            "session_start",
            session_id="sess-001",
            role=args.role,
            task=args.task,
            nickname=args.nickname,
            model=args.model,
        )
        time.sleep(args.delay)

    # 2. 模拟工具调用序列
    tools = [t.strip() for t in args.tools.split(",") if t.strip()]
    for i, tool in enumerate(tools):
        # tool_use
        emit(
            "tool_use",
            id=f"tu-{i}",
            name=tool,
            input={"path": f"/workspace/file_{i}.py"} if tool == "read" else {"cmd": "echo hi"},
        )
        time.sleep(args.delay)
        # tool_result
        emit(
            "tool_result",
            id=f"tu-{i}",
            output=f"Result of {tool}",
            duration_ms=int(args.delay * 1000),
        )
        time.sleep(args.delay)
        # progress
        emit(
            "progress",
            percent=(i + 1) / max(len(tools), 1),
            message=f"Completed {tool}",
        )
        time.sleep(args.delay)

    # 3. 模拟 LLM 输出流
    if args.fail:
        emit(
            "error",
            error_type="TestError",
            message="Mock failure injected via --fail",
        )
    else:
        for j in range(args.content_chunks):
            emit(
                "content_delta",
                text=f"Chunk {j + 1}: processing {args.task}...",
            )
            time.sleep(args.delay)

    # 4. session_end 事件
    if not args.no_session_end and not args.fail:
        emit(
            "session_end",
            status="success" if args.exit_code == 0 else "failed",
            result="Mock task completed",
            exit_code=args.exit_code,
        )

    return args.exit_code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:  # noqa: BLE001
        print(
            json.dumps(
                {
                    "type": "error",
                    "error_type": type(e).__name__,
                    "message": str(e),
                }
            ),
            file=sys.stderr,
            flush=True,
        )
        sys.exit(1)
