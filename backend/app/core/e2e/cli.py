"""
# ============================================================
# E2E CLI - 命令行工具
# ============================================================
# 核心作用：提供 E2E 测试框架的命令行入口
# 子命令：health / list / run / report / baseline
# Cycle 11 P2-1 新建
# ============================================================
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from typing import List, Optional

from .base import E2EConfig
from .runner import PlaywrightE2ERunner


def cmd_health(args, runner: PlaywrightE2ERunner) -> int:
    """健康检查"""
    scenarios = runner.list_scenarios()
    print(f"✓ E2E Runner healthy")
    print(f"  - Scenarios: {len(scenarios)}")
    for s in scenarios:
        print(f"    • {s['scenario_id']:30s} priority={s['priority']:3d} {s['name']}")
    return 0


def cmd_list(args, runner: PlaywrightE2ERunner) -> int:
    """列出所有场景"""
    scenarios = runner.list_scenarios()
    print(f"Total scenarios: {len(scenarios)}")
    for s in scenarios:
        print(f"  - {s['scenario_id']}: {s['name']} (priority={s['priority']}, tags={s['tags']})")
    return 0


async def _run(args, runner: PlaywrightE2ERunner) -> int:
    """执行测试（异步包装，在独立线程中跑同步的 run_all）"""
    import asyncio
    import concurrent.futures

    scenario_ids = args.scenario if args.scenario else None

    def _execute():
        return runner.run_all(scenario_ids=scenario_ids, parallel=args.parallel)

    loop = asyncio.get_event_loop()
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
        future = ex.submit(_execute)
        report = await loop.run_in_executor(None, future.result)

    print(f"✓ Test run complete: {report.report_id}")
    print(f"  - Total: {report.total_scenarios}")
    print(f"  - Passed: {report.passed}")
    print(f"  - Failed: {report.failed}")
    print(f"  - Error: {report.error}")
    print(f"  - Skipped: {report.skipped}")
    print(f"  - Pass rate: {report.pass_rate():.1%}")
    print(f"  - Duration: {report.duration_ms}ms")
    if report.metadata.get("report_paths"):
        print(f"  - Reports:")
        for fmt, path in report.metadata["report_paths"].items():
            print(f"    • {fmt}: {path}")
    return 0 if report.passed == report.total_scenarios else 1


def cmd_run(args, runner: PlaywrightE2ERunner) -> int:
    """执行测试同步入口"""
    return asyncio.run(_run(args, runner))


def cmd_report(args, runner: PlaywrightE2ERunner) -> int:
    """报告操作"""
    if args.action == "list":
        reports = runner.list_reports(limit=args.limit)
        print(f"Recent reports (latest {len(reports)}):")
        for r in reports:
            print(f"  - {r['report_id']}: {r['passed']}/{r['total_scenarios']} passed ({r['duration_ms']}ms)")
    elif args.action == "show":
        if not args.report_id:
            print("error: --report-id is required for 'show'", file=sys.stderr)
            return 1
        report = runner.get_report(args.report_id)
        if not report:
            print(f"error: report {args.report_id} not found", file=sys.stderr)
            return 1
        print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def cmd_baseline(args, runner: PlaywrightE2ERunner) -> int:
    """基线操作"""
    if args.action == "list":
        baselines = runner.visual.list_baselines()
        print(f"Total baselines: {len(baselines)}")
        for b in baselines:
            print(f"  - {b['name']}: {b['size']} bytes, fp={b['fingerprint'][:16]}...")
    elif args.action == "delete":
        if not args.name:
            print("error: --name is required for 'delete'", file=sys.stderr)
            return 1
        ok = runner.visual.delete_baseline(args.name)
        if ok:
            print(f"✓ Deleted baseline: {args.name}")
        else:
            print(f"✗ Baseline not found: {args.name}", file=sys.stderr)
            return 1
    return 0


def main(argv: Optional[List[str]] = None) -> int:
    """主入口"""
    parser = argparse.ArgumentParser(
        prog="e2e",
        description="Hermes E2E Test Framework (Cycle 11 P2-1)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    # health
    sub_health = subparsers.add_parser("health", help="健康检查")

    # list
    sub_list = subparsers.add_parser("list", help="列出所有场景")

    # run
    sub_run = subparsers.add_parser("run", help="执行测试")
    sub_run.add_argument("--scenario", nargs="+", help="指定场景 ID 列表")
    sub_run.add_argument("--parallel", action="store_true", help="并行执行")

    # report
    sub_report = subparsers.add_parser("report", help="报告管理")
    sub_report.add_argument("action", choices=["list", "show"], help="操作")
    sub_report.add_argument("--limit", type=int, default=10, help="列出数量")
    sub_report.add_argument("--report-id", help="报告 ID（show 操作）")

    # baseline
    sub_baseline = subparsers.add_parser("baseline", help="基线管理")
    sub_baseline.add_argument("action", choices=["list", "delete"], help="操作")
    sub_baseline.add_argument("--name", help="基线名称")

    args = parser.parse_args(argv)
    runner = PlaywrightE2ERunner()

    if args.command == "health":
        return cmd_health(args, runner)
    elif args.command == "list":
        return cmd_list(args, runner)
    elif args.command == "run":
        return cmd_run(args, runner)
    elif args.command == "report":
        return cmd_report(args, runner)
    elif args.command == "baseline":
        return cmd_baseline(args, runner)

    return 0


if __name__ == "__main__":
    sys.exit(main())
