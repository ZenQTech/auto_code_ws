#!/usr/bin/env python3
"""
# ============================================================
# SubAgent Memory API E2E 测试（v1.0.0）- Python 版本（无 jq 依赖）
# ============================================================
# 用法：python3 tests/test_e2e_subagent_memory.py
# 前置：后端服务运行在 http://127.0.0.1:8000
# ============================================================
"""
import json
import sys
import time
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:8000"
TIMEOUT = 10

PASS = 0
FAIL = 0
TOTAL = 0


def report_pass(name, detail=""):
    global PASS, TOTAL
    PASS += 1
    TOTAL += 1
    print(f"  \033[0;32m✓\033[0m {name}" + (f" — {detail}" if detail else ""))


def report_fail(name, detail=""):
    global FAIL, TOTAL
    FAIL += 1
    TOTAL += 1
    print(f"  \033[0;31m✗\033[0m {name}")
    if detail:
        print(f"    \033[0;31mDetail:\033[0m {str(detail)[:300]}")


def http(method, path, body=None, expect_status=None):
    """发起 HTTP 请求并返回 (status_code, json_body)"""
    url = f"{BASE_URL}{path}"
    data = None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    if body is not None:
        data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            status = resp.status
            text = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        status = e.code
        text = e.read().decode("utf-8")
    except Exception as e:
        return None, f"Exception: {e}"
    try:
        body_json = json.loads(text) if text else {}
    except Exception:
        body_json = text
    if expect_status is not None and status != expect_status:
        return status, body_json
    return status, body_json


def wait_for_backend():
    print("\033[1;33m⏳ 等待后端启动...\033[0m")
    for i in range(30):
        try:
            urllib.request.urlopen(f"{BASE_URL}/health", timeout=2).read()
            print("\033[0;32m✓ 后端已就绪\033[0m")
            return True
        except Exception:
            time.sleep(1)
    print("\033[0;31m✗ 后端未在 30s 内启动\033[0m")
    return False


def main():
    print("=" * 60)
    print("  SubAgent Memory API E2E 测试")
    print(f"  BASE_URL: {BASE_URL}")
    print("=" * 60)

    if not wait_for_backend():
        return 1

    # 1. 初始 summary
    print("\n[1] GET /api/agents/memory/summary (初始)")
    status, body = http("GET", "/api/agents/memory/summary")
    if status == 200 and "total_subagents" in body:
        report_pass("summary 接口可用", f"total_subagents={body.get('total_subagents')}")
    else:
        report_fail("summary 接口失败", body)

    # 2. 初始 list
    print("\n[2] GET /api/agents/memory/list (初始)")
    status, body = http("GET", "/api/agents/memory/list")
    if status == 200 and "count" in body:
        report_pass("list 接口可用", f"count={body.get('count')}")
    else:
        report_fail("list 接口失败", body)

    # 3. 创建父 SubAgent
    print("\n[3] POST /api/agents/parent-sa-1/memory/initialize")
    status, body = http("POST", "/api/agents/parent-sa-1/memory/initialize", body={
        "name": "MainArchitect",
        "skill_set": ["architecture", "review"],
        "output_dir": "/tmp/parent",
        "isolated": True,
        "metadata": {"role": "main"},
    })
    if status == 200 and body.get("success"):
        report_pass("父 SubAgent 初始化成功")
    else:
        report_fail("父 SubAgent 初始化失败", body)

    # 4. 父追加消息
    print("\n[4] POST /api/agents/parent-sa-1/memory/append (2 条)")
    for i, content in enumerate(["请设计系统整体架构", "已生成 spec.md"]):
        status, body = http("POST", "/api/agents/parent-sa-1/memory/append", body={
            "role": "user" if i == 0 else "assistant",
            "content": content,
            "metadata": {"i": i},
        })
        if status == 200 and body.get("entry", {}).get("entry_id"):
            report_pass(f"父追加第 {i+1} 条消息成功", f"entry_id={body['entry']['entry_id'][:8]}")
        else:
            report_fail(f"父追加第 {i+1} 条消息失败", body)

    # 5. 创建子 SubAgent
    print("\n[5] POST /api/agents/child-sa-1/memory/initialize (parent=parent-sa-1)")
    status, body = http("POST", "/api/agents/child-sa-1/memory/initialize", body={
        "name": "ModuleA_Dev",
        "parent_id": "parent-sa-1",
        "skill_set": ["python", "fastapi"],
        "output_dir": "/tmp/child-1",
        "isolated": True,
    })
    if status == 200 and body.get("success"):
        report_pass("子 SubAgent 初始化成功")
        auto_inherit = body.get("auto_inherit", "")
        if "继承" in auto_inherit:
            report_pass("自动从父继承触发", auto_inherit)
        else:
            report_fail("未触发自动继承", auto_inherit)
    else:
        report_fail("子 SubAgent 初始化失败", body)

    # 6. 子追加 isolated 消息
    print("\n[6] POST /api/agents/child-sa-1/memory/append (isolated)")
    status, body = http("POST", "/api/agents/child-sa-1/memory/append", body={
        "role": "assistant",
        "content": "实现 ModuleA API 端点",
        "metadata": {"files": ["api.py", "models.py"]},
    })
    if status == 200 and body.get("success"):
        report_pass("子追加 isolated 消息成功")
    else:
        report_fail("子追加 isolated 消息失败", body)

    # 7. 获取完整消息
    print("\n[7] GET /api/agents/child-sa-1/memory?include_parent=true")
    status, body = http("GET", "/api/agents/child-sa-1/memory?include_parent=true")
    if status == 200 and body.get("count", 0) >= 3:
        report_pass("完整消息数 >= 3", f"实际 {body['count']}")
    else:
        report_fail("完整消息数不足", f"count={body.get('count')}")

    # 8. 获取 isolated only
    print("\n[8] GET /api/agents/child-sa-1/memory?include_parent=false")
    status, body = http("GET", "/api/agents/child-sa-1/memory?include_parent=false")
    if status == 200 and body.get("count") == 1:
        report_pass("isolated 消息数 = 1", "符合预期")
    else:
        report_fail("isolated 消息数异常", f"count={body.get('count')}")

    # 9. 显式 inherit
    print("\n[9] 创建 child-sa-2 + 显式 inherit")
    status, _ = http("POST", "/api/agents/child-sa-2/memory/initialize", body={
        "name": "ModuleB_Dev",
        "parent_id": "parent-sa-1",
        "skill_set": ["cpp"],
        "output_dir": "/tmp/child-2",
    })
    status, body = http("POST", "/api/agents/child-sa-2/memory/inherit", body={
        "parent_id": "parent-sa-1",
    })
    if status == 200 and body.get("inherited_count", 0) >= 2:
        report_pass("显式继承成功", f"继承 {body['inherited_count']} 条")
    else:
        report_fail("显式继承失败", body)

    # 10. 清空子 isolated
    print("\n[10] DELETE /api/agents/child-sa-1/memory")
    status, body = http("DELETE", "/api/agents/child-sa-1/memory")
    if status == 200 and body.get("success"):
        report_pass("清空 isolated 成功")
        # 验证：isolated 数量变 0，但 parent_snapshot 保留
        _, iso = http("GET", "/api/agents/child-sa-1/memory?include_parent=false")
        _, full = http("GET", "/api/agents/child-sa-1/memory?include_parent=true")
        if iso.get("count") == 0 and full.get("count", 0) >= 2:
            report_pass("清空后 isolated=0, parent_snapshot 保留", f"完整={full['count']}")
        else:
            report_fail("清空状态异常", f"iso={iso.get('count')} full={full.get('count')}")
    else:
        report_fail("清空失败", body)

    # 11. 错误用例：append 到不存在的 ID
    print("\n[11] POST /api/agents/ghost/memory/append (期望 404)")
    status, body = http("POST", "/api/agents/ghost/memory/append", body={
        "role": "user", "content": "x",
    })
    if status == 404:
        report_pass("不存在的 ID 返回 404")
    else:
        report_fail("错误处理异常", f"HTTP {status}")

    # 12. 错误用例：inherit 不存在的父
    print("\n[12] POST /api/agents/child-sa-1/memory/inherit (期望 404)")
    status, body = http("POST", "/api/agents/child-sa-1/memory/inherit", body={
        "parent_id": "ghost-parent",
    })
    if status == 404:
        report_pass("inherit 不存在的父返回 404")
    else:
        report_fail("inherit 错误处理异常", f"HTTP {status}")

    # 13. 列出所有 SubAgent
    print("\n[13] GET /api/agents/memory/list (最终)")
    status, body = http("GET", "/api/agents/memory/list")
    if status == 200 and body.get("count", 0) >= 2:
        report_pass("list 包含多个 SubAgent", f"count={body['count']}")
    else:
        report_fail("list 异常", body)

    # 14. summary 最终
    print("\n[14] GET /api/agents/memory/summary (最终)")
    status, body = http("GET", "/api/agents/memory/summary")
    print(f"  Response: {body}")
    if status == 200 and body.get("total_subagents", 0) >= 2:
        report_pass("summary 反映真实状态", f"total={body['total_subagents']}, "
                f"isolated={body['isolated_subagents']}, "
                f"with_parent={body['with_parent_inheritance']}")
    else:
        report_fail("summary 异常", body)

    # 最终
    print("\n" + "=" * 60)
    color = "\033[0;32m" if FAIL == 0 else "\033[0;31m"
    print(f"  {color}测试结果：{PASS} 通过 / {FAIL} 失败 / {TOTAL} 总计\033[0m")
    print("=" * 60)

    if FAIL > 0:
        return 1
    print("\033[0;32m✓ 所有 E2E 测试通过\033[0m")
    return 0


if __name__ == "__main__":
    sys.exit(main())
