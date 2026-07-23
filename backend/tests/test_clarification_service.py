"""
# ============================================================
# 需求澄清桥接服务 & 阶段感知 Prompt 切换 & API 端点 测试脚本
# ============================================================
# 核心作用：测试 ClarificationService、HermesService（阶段感知 Prompt）、
#           API 端点（clarify/respond、clarify/questions、clarify/confirm）
# 运行流程：
#   1. 语法编译检查 - 导入所有模块验证无语法错误
#   2. 单元测试 - 测试各模块独立功能
#   3. 集成测试 - 测试 API 端点
# 输入参数：无（独立运行）
# 输出结果：测试报告（PASS/FAIL + 详细错误信息）
# ============================================================
"""

import sys
import os
import asyncio
import json

# 确保项目根目录在 Python 路径中
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..'))  # workspace root

# ============================================================
# 测试结果统计
# ============================================================
passed = 0
failed = 0
errors = []


def test_result(name: str, condition: bool, detail: str = ""):
    """记录测试结果"""
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ PASS: {name}")
    else:
        failed += 1
        print(f"  ❌ FAIL: {name}")
        if detail:
            print(f"     详情: {detail}")
            errors.append(f"{name}: {detail}")


# ============================================================
# 维度 1: 语法编译检查
# ============================================================
def test_syntax_and_imports():
    """测试所有模块可以正确导入"""
    print("\n" + "=" * 60)
    print("维度 1: 语法编译检查")
    print("=" * 60)

    # 1.1 测试 ClarificationService 模块导入
    try:
        from app.services.clarification_service import (
            ClarificationState,
            ClarificationService,
        )
        test_result("ClarificationService 模块导入", True)
    except Exception as e:
        test_result("ClarificationService 模块导入", False, str(e))
        return

    # 1.2 测试 ClarificationState 数据类
    try:
        state = ClarificationState(workflow_id="test-wf-001")
        test_result("ClarificationState 实例化", True)
        test_result("ClarificationState 默认 round_number=0",
                     state.round_number == 0)
        test_result("ClarificationState 默认 max_rounds=5",
                     state.max_rounds == 5)
        test_result("ClarificationState 默认 is_complete=False",
                     state.is_complete is False)
        test_result("ClarificationState 默认 questions=[]",
                     state.questions == [])
        test_result("ClarificationState 默认 conversation_history=[]",
                     state.conversation_history == [])
        test_result("ClarificationState 默认 requirement_doc=''",
                     state.requirement_doc == "")
    except Exception as e:
        test_result("ClarificationState 数据类测试", False, str(e))

    # 1.3 测试 ClarificationState 自定义参数
    try:
        state = ClarificationState(
            workflow_id="wf-custom",
            round_number=3,
            max_rounds=10,
            questions=[{"dimension": "功能需求", "question": "测试问题", "importance": "high"}],
            conversation_history=[{"role": "user", "content": "测试"}],
            is_complete=True,
            requirement_doc="# 需求文档\n测试内容",
        )
        test_result("ClarificationState 自定义参数", True)
        test_result("ClarificationState round_number=3", state.round_number == 3)
        test_result("ClarificationState max_rounds=10", state.max_rounds == 10)
        test_result("ClarificationState questions 长度=1", len(state.questions) == 1)
        test_result("ClarificationState conversation_history 长度=1",
                     len(state.conversation_history) == 1)
    except Exception as e:
        test_result("ClarificationState 自定义参数", False, str(e))

    # 1.4 测试 HermesService 模块导入（含新方法）
    try:
        from app.services.hermes_service import (
            HermesService,
            HermesChatResult,
            HermesOptimizeResult,
            HermesConfirmResult,
        )
        test_result("HermesService 模块导入", True)
    except Exception as e:
        test_result("HermesService 模块导入", False, str(e))

    # 1.5 测试 API 端点模块导入
    try:
        from app.api.hermes import ClarifyRespondRequest
        test_result("ClarifyRespondRequest 模型导入", True)

        req = ClarifyRespondRequest(
            session_id="sess-001",
            workflow_id="wf-001",
            message="测试澄清回复",
        )
        test_result("ClarifyRespondRequest 实例化", True)
        test_result("ClarifyRespondRequest session_id", req.session_id == "sess-001")
        test_result("ClarifyRespondRequest workflow_id", req.workflow_id == "wf-001")
        test_result("ClarifyRespondRequest message", req.message == "测试澄清回复")
    except Exception as e:
        test_result("ClarifyRespondRequest 模型测试", False, str(e))

    # 1.6 测试 ClarifyConfirmRequest 模型
    try:
        from app.api.workflow import ClarifyConfirmRequest

        req = ClarifyConfirmRequest(confirmed=True)
        test_result("ClarifyConfirmRequest 实例化 (confirmed=True)", True)
        test_result("ClarifyConfirmRequest confirmed", req.confirmed is True)

        req2 = ClarifyConfirmRequest(confirmed=False)
        test_result("ClarifyConfirmRequest 实例化 (confirmed=False)", req2.confirmed is False)
    except Exception as e:
        test_result("ClarifyConfirmRequest 模型测试", False, str(e))

    # 1.7 测试 _format_clarify_result_for_sse 方法存在
    try:
        from app.services.hermes_service import HermesService
        has_method = hasattr(HermesService, '_format_clarify_result_for_sse')
        test_result("HermesService._format_clarify_result_for_sse 方法存在", has_method)
    except Exception as e:
        test_result("_format_clarify_result_for_sse 方法检查", False, str(e))


# ============================================================
# 维度 2: 模块独立功能测试
# ============================================================
def test_module_functionality():
    """测试各模块独立功能"""
    print("\n" + "=" * 60)
    print("维度 2: 模块独立功能测试")
    print("=" * 60)

    # 2.1 测试 _format_clarify_result_for_sse
    try:
        from app.services.hermes_service import HermesService
        from app.services.agent_roles.requirement_clarifier import (
            ClarifyResult,
            ClarificationQuestion,
        )

        # 创建一个 mock HermesService（不需要完整初始化）
        class MockHermesService(HermesService):
            def __init__(self):
                pass

        svc = MockHermesService()

        # 测试有 questions 和 summary 的结果
        result = ClarifyResult(
            summary="这是测试总结",
            questions=[
                ClarificationQuestion(
                    dimension="功能需求",
                    question="具体功能是什么？",
                    importance="high",
                ),
            ],
            clarification_complete=False,
        )
        events = svc._format_clarify_result_for_sse(result)
        test_result("_format_clarify_result_for_sse 返回列表", isinstance(events, list))
        test_result("_format_clarify_result_for_sse 至少 2 个事件", len(events) >= 2)
        test_result("第一个事件是 text 类型", events[0]["type"] == "text")
        test_result("第一个事件包含 summary", "测试总结" in events[0]["content"])
        test_result("第二个事件包含问题", "功能需求" in events[1]["content"])

        # 测试 clarification_complete=True
        result2 = ClarifyResult(
            summary="澄清已完成",
            questions=[],
            clarification_complete=True,
        )
        events2 = svc._format_clarify_result_for_sse(result2)
        has_complete_event = any(
            e.get("type") == "clarify_complete" for e in events2
        )
        test_result("clarify_complete=True 时包含 clarify_complete 事件", has_complete_event)

        # 测试空 questions
        result3 = ClarifyResult(
            summary="只有总结",
            questions=[],
            clarification_complete=False,
        )
        events3 = svc._format_clarify_result_for_sse(result3)
        test_result("空 questions 时只有 summary 事件", len(events3) == 1)

        # 测试 ClarificationQuestion 对象和 Dict 兼容
        result4 = ClarifyResult(
            summary="测试",
            questions=[{"dimension": "约束条件", "question": "ROS 版本？", "importance": "medium"}],
            clarification_complete=False,
        )
        events4 = svc._format_clarify_result_for_sse(result4)
        test_result("Dict 格式 questions 兼容", len(events4) >= 2)
        test_result("Dict 格式 questions 正确显示", "约束条件" in events4[1]["content"])

    except Exception as e:
        test_result("_format_clarify_result_for_sse 功能测试", False, str(e))

    # 2.2 测试 ClarificationService 初始化
    try:
        from app.services.clarification_service import ClarificationService

        class MockSessionFactory:
            pass

        class MockRequirementClarifier:
            async def clarify(self, user_input, context):
                from app.services.agent_roles.requirement_clarifier import ClarifyResult, ClarificationQuestion
                return ClarifyResult(
                    summary="mock 总结",
                    questions=[ClarificationQuestion(
                        dimension="功能需求", question="mock 问题", importance="high"
                    )],
                    clarification_complete=False,
                )

            async def clarify_round(self, user_input, conversation_history, round_number, max_rounds):
                from app.services.agent_roles.requirement_clarifier import ClarifyResult
                return ClarifyResult(
                    summary=f"第 {round_number} 轮总结",
                    questions=[],
                    clarification_complete=(round_number >= max_rounds),
                )

            async def generate_requirement_doc(self, conversation_history):
                return "# 需求文档\nmock 生成的需求文档"

        svc = ClarificationService(
            session_factory=MockSessionFactory(),
            requirement_clarifier=MockRequirementClarifier(),
        )
        test_result("ClarificationService 初始化", True)
        test_result("ClarificationService._states 初始为空", len(svc._states) == 0)
        test_result("ClarificationService 有 session_factory", svc.session_factory is not None)
        test_result("ClarificationService 有 requirement_clarifier",
                     svc.requirement_clarifier is not None)
    except Exception as e:
        test_result("ClarificationService 初始化", False, str(e))

    # 2.3 测试 _get_or_create_state
    try:
        from app.services.clarification_service import ClarificationService, ClarificationState

        class MockSessionFactory:
            pass

        class MockRC:
            pass

        svc = ClarificationService(
            session_factory=MockSessionFactory(),
            requirement_clarifier=MockRC(),
        )

        # 首次获取应创建新状态
        state1 = svc._get_or_create_state("wf-test-001")
        test_result("_get_or_create_state 创建新状态", isinstance(state1, ClarificationState))
        test_result("_get_or_create_state workflow_id 正确",
                     state1.workflow_id == "wf-test-001")
        test_result("_states 中已存储", "wf-test-001" in svc._states)

        # 再次获取应返回同一对象
        state2 = svc._get_or_create_state("wf-test-001")
        test_result("_get_or_create_state 返回同一状态", state1 is state2)

        # 不同 workflow_id 创建不同状态
        state3 = svc._get_or_create_state("wf-test-002")
        test_result("不同 workflow_id 创建不同状态", state1 is not state3)
    except Exception as e:
        test_result("_get_or_create_state 测试", False, str(e))

    # 2.4 测试 is_clarification_complete
    try:
        from app.services.clarification_service import ClarificationService, ClarificationState

        class MockSF:
            pass

        class MockRC:
            pass

        svc = ClarificationService(
            session_factory=MockSF(),
            requirement_clarifier=MockRC(),
        )

        # 不存在的 workflow 返回 False
        test_result("is_clarification_complete(不存在) = False",
                     svc.is_clarification_complete("nonexistent") is False)

        # 创建状态但未完成
        state = svc._get_or_create_state("wf-pending")
        state.is_complete = False
        test_result("is_clarification_complete(未完成) = False",
                     svc.is_clarification_complete("wf-pending") is False)

        # 标记完成
        state.is_complete = True
        test_result("is_clarification_complete(已完成) = True",
                     svc.is_clarification_complete("wf-pending") is True)
    except Exception as e:
        test_result("is_clarification_complete 测试", False, str(e))


# ============================================================
# 维度 3: API 端点集成测试
# ============================================================
async def test_api_endpoints():
    """测试 API 端点（需要 FastAPI TestClient）"""
    print("\n" + "=" * 60)
    print("维度 3: API 端点集成测试")
    print("=" * 60)

    try:
        from fastapi.testclient import TestClient
    except ImportError:
        print("  ⚠️  SKIP: httpx/TestClient 未安装，跳过 API 集成测试")
        return

    try:
        # 创建测试应用
        from app.main import app
        client = TestClient(app)
        test_result("FastAPI TestClient 创建成功", True)
    except Exception as e:
        test_result("FastAPI TestClient 创建", False, str(e))
        return

    # 3.1 测试 clarify/respond 端点请求验证
    try:
        # 测试缺少必填字段
        response = client.post("/api/hermes/clarify/respond", json={})
        test_result("clarify/respond 缺少字段返回 422", response.status_code == 422)

        # 测试 message 为空
        response = client.post("/api/hermes/clarify/respond", json={
            "session_id": "sess-001",
            "workflow_id": "wf-001",
            "message": "",
        })
        test_result("clarify/respond 空消息返回 422", response.status_code == 422)

        # 测试合法请求（测试环境无 lifespan，app.state 未初始化，预期 500）
        response = client.post("/api/hermes/clarify/respond", json={
            "session_id": "sess-001",
            "workflow_id": "wf-001",
            "message": "我需要实现一个 ROS 2 节点",
        })
        # 测试环境下 app.state 未初始化，预期返回非 200（500 或 422）
        test_result("clarify/respond 合法请求可到达路由（非 404）",
                     response.status_code != 404)
        print(f"     响应状态码: {response.status_code}（测试环境无 lifespan，预期非 200）")
    except Exception as e:
        test_result("clarify/respond 端点测试", False, str(e))

    # 3.2 测试 clarify/questions 端点
    try:
        response = client.get("/api/workflow/nonexistent-id/clarify/questions")
        # 测试环境下 app.state 未初始化，预期返回 500 而非 404
        test_result("clarify/questions 端点可访问（非 404）",
                     response.status_code != 404)
        print(f"     响应状态码: {response.status_code}（测试环境无 lifespan，预期非 200）")
    except Exception as e:
        test_result("clarify/questions 端点测试", False, str(e))

    # 3.3 测试 clarify/confirm 端点请求验证
    try:
        # 测试缺少必填字段
        response = client.post("/api/workflow/wf-001/clarify/confirm", json={})
        test_result("clarify/confirm 缺少字段返回 422", response.status_code == 422)

        # 测试合法请求
        response = client.post("/api/workflow/wf-001/clarify/confirm", json={
            "confirmed": True,
        })
        # 测试环境下 app.state 未初始化，预期返回非 200（500）
        test_result("clarify/confirm 合法请求可到达路由（非 404）",
                     response.status_code != 404)
        print(f"     响应状态码: {response.status_code}（测试环境无 lifespan，预期非 200）")
    except Exception as e:
        test_result("clarify/confirm 端点测试", False, str(e))

    # 3.4 测试 SSE 响应格式
    try:
        from app.services.hermes_service import HermesService
        from app.services.agent_roles.requirement_clarifier import ClarifyResult

        class MockHS(HermesService):
            def __init__(self):
                pass

        svc = MockHS()
        result = ClarifyResult(
            summary="测试总结",
            questions=[],
            clarification_complete=True,
        )
        events = svc._format_clarify_result_for_sse(result)
        # 验证所有事件都可 JSON 序列化
        for event in events:
            json_str = json.dumps(event, ensure_ascii=False)
            test_result(f"SSE 事件可 JSON 序列化: type={event['type']}",
                         isinstance(json.loads(json_str), dict))
        test_result("SSE 事件 JSON 序列化全部通过", True)
    except Exception as e:
        test_result("SSE 响应格式测试", False, str(e))

    # 3.5 测试 clarify/respond SSE 端点
    try:
        # 使用 stream=True 测试 SSE 流式端点
        with client.stream("POST", "/api/hermes/clarify/respond", json={
            "session_id": "sess-001",
            "workflow_id": "wf-001",
            "message": "测试消息",
        }) as response:
            # 测试环境下 app.state 未初始化，检查 Content-Type（可能为 application/json 或 text/event-stream）
            content_type = response.headers.get("content-type", "")
            # 测试环境返回 500，但路由可访问即通过
            test_result("clarify/respond SSE 端点可访问（非 404）",
                         response.status_code != 404)
            print(f"     Content-Type: {content_type}")
            print(f"     响应状态码: {response.status_code}（测试环境无 lifespan，预期非 200）")
    except Exception as e:
        test_result("clarify/respond SSE 端点测试", False, str(e))

    # 3.6 测试路由注册
    try:
        # 验证所有路由已注册
        routes = [r.path for r in app.routes if hasattr(r, 'path')]
        has_clarify_respond = any(
            "/api/hermes/clarify/respond" in r for r in routes
        )
        has_clarify_questions = any(
            "clarify/questions" in r for r in routes
        )
        has_clarify_confirm = any(
            "clarify/confirm" in r for r in routes
        )
        test_result("路由 /api/hermes/clarify/respond 已注册", has_clarify_respond)
        test_result("路由 clarify/questions 已注册", has_clarify_questions)
        test_result("路由 clarify/confirm 已注册", has_clarify_confirm)
    except Exception as e:
        test_result("路由注册检查", False, str(e))


# ============================================================
# 主测试入口
# ============================================================
def main():
    print("=" * 60)
    print("需求澄清服务 & 阶段感知 Prompt & API 端点 全量测试")
    print("=" * 60)

    # 维度 1: 语法编译检查
    test_syntax_and_imports()

    # 维度 2: 模块独立功能测试
    test_module_functionality()

    # 维度 3: API 端点集成测试
    asyncio.run(test_api_endpoints())

    # 输出测试总结
    print("\n" + "=" * 60)
    print("测试总结")
    print("=" * 60)
    total = passed + failed
    print(f"  总计: {total} 项测试")
    print(f"  通过: {passed} 项 ✅")
    print(f"  失败: {failed} 项 ❌")

    if errors:
        print(f"\n失败详情:")
        for err in errors:
            print(f"  - {err}")

    if failed > 0:
        print("\n⚠️  存在失败测试，请检查上述错误")
        sys.exit(1)
    else:
        print("\n🎉 全部测试通过！")
        sys.exit(0)


if __name__ == "__main__":
    main()
