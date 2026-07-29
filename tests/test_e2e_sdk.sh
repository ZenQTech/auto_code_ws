#!/usr/bin/env bash
# ============================================================
# Hermes SDK E2E 测试脚本
# ============================================================
# 核心作用：端到端验证 Hermes Python/TypeScript SDK
# 覆盖：
#   1. 健康检查
#   2. Thread 启动/恢复/状态/关闭
#   3. 同步 Run
#   4. 流式 Run
#   5. Python SDK E2E
#   6. TypeScript SDK 编译 + E2E
# 测试要求：后端服务运行在 http://localhost:8000
# Cycle 13 P0-2 新建
# ============================================================

set -e

BASE_URL="${HERMES_BASE_URL:-http://localhost:8000}"
PYTHONPATH="$(cd "$(dirname "$0")/.." && pwd)/sdks/python"
TS_DIR="$(cd "$(dirname "$0")/.." && pwd)/sdks/typescript"

# 颜色输出
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0
TOTAL_COUNT=0

assert_true() {
    local description="$1"
    local actual="$2"
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    if [ -n "$actual" ] && [ "$actual" != "false" ] && [ "$actual" != "0" ]; then
        echo -e "  ${GREEN}✔${NC} $description"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}✗${NC} $description (got: $actual)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_contains() {
    local description="$1"
    local haystack="$2"
    local needle="$3"
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "  ${GREEN}✔${NC} $description"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}✗${NC} $description (missing: $needle)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

assert_equals() {
    local description="$1"
    local actual="$2"
    local expected="$3"
    TOTAL_COUNT=$((TOTAL_COUNT + 1))
    if [ "$actual" = "$expected" ]; then
        echo -e "  ${GREEN}✔${NC} $description"
        PASS_COUNT=$((PASS_COUNT + 1))
    else
        echo -e "  ${RED}✗${NC} $description (expected: $expected, got: $actual)"
        FAIL_COUNT=$((FAIL_COUNT + 1))
    fi
}

echo "=========================================="
echo "Hermes SDK E2E 测试"
echo "Base URL: $BASE_URL"
echo "=========================================="
echo ""

# ============================================================
# Test 1: 健康检查
# ============================================================
echo "Test 1: SDK 健康检查"
RESP=$(curl -s -X GET "$BASE_URL/api/sdk/health")
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "service=hermes-sdk" "$RESP" '"service":"hermes-sdk"'
assert_contains "version=1.0.0" "$RESP" '"version":"1.0.0"'
assert_contains "包含 thread_start" "$RESP" 'thread_start'
assert_contains "包含 run_sync" "$RESP" 'run_sync'
assert_contains "包含 run_stream" "$RESP" 'run_stream'
echo ""

# ============================================================
# Test 2: Thread 启动（curl）
# ============================================================
echo "Test 2: Thread 启动"
RESP=$(curl -s -X POST "$BASE_URL/api/sdk/threads" \
    -H "Content-Type: application/json" \
    -d '{"sandbox":"workspace_write","model":"claude-sonnet-4.5","project_id":"e2e-sdk-test","working_directory":"/tmp/test-sdk","system_prompt":"You are a helpful assistant."}')
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "包含 thread_id" "$RESP" '"thread_id":"th_'
assert_contains "sandbox=workspace_write" "$RESP" '"sandbox":"workspace_write"'
assert_contains "model=claude-sonnet-4.5" "$RESP" '"model":"claude-sonnet-4.5"'
THREAD_ID=$(echo "$RESP" | python3 -c "import sys, json; print(json.load(sys.stdin)['thread_id'])")
echo "  Thread ID: $THREAD_ID"
echo ""

# ============================================================
# Test 3: 列出 Thread
# ============================================================
echo "Test 3: 列出 Thread"
RESP=$(curl -s -X GET "$BASE_URL/api/sdk/threads")
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "包含 threads 数组" "$RESP" '"threads":'
assert_contains "包含刚创建的 thread" "$RESP" "$THREAD_ID"
echo ""

# ============================================================
# Test 4: 获取 Thread 状态
# ============================================================
echo "Test 4: 获取 Thread 状态"
RESP=$(curl -s -X GET "$BASE_URL/api/sdk/threads/$THREAD_ID" \
    -H "Authorization: Bearer test-key")
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "status=active" "$RESP" '"status":"active"'
assert_contains "包含 model" "$RESP" '"model":"claude-sonnet-4.5"'
echo ""

# ============================================================
# Test 5: 同步 Run
# ============================================================
echo "Test 5: 同步 Run"
RESP=$(curl -s -X POST "$BASE_URL/api/sdk/threads/$THREAD_ID/runs" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-key" \
    -d '{"prompt":"Hello, please introduce yourself briefly."}')
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "thread_id 一致" "$RESP" "\"thread_id\":\"$THREAD_ID\""
assert_contains "包含 run_id" "$RESP" '"run_id":"run_'
assert_contains "status=completed" "$RESP" '"status":"completed"'
assert_contains "包含 final_response" "$RESP" '"final_response":'
assert_contains "包含 usage" "$RESP" '"usage":'
assert_contains "usage.prompt_tokens" "$RESP" '"prompt_tokens":'
assert_contains "usage.completion_tokens" "$RESP" '"completion_tokens":'
assert_contains "usage.total_tokens" "$RESP" '"total_tokens":'
echo ""

# ============================================================
# Test 6: 流式 Run
# ============================================================
echo "Test 6: 流式 Run"
RESP=$(curl -s -X POST "$BASE_URL/api/sdk/threads/$THREAD_ID/runs/stream" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-key" \
    -d '{"prompt":"Write a haiku about coding.","stream":true}')
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "包含 events 数组" "$RESP" '"events":'
assert_contains "包含 run_started 事件" "$RESP" '"type":"run_started"'
assert_contains "包含 text_delta 事件" "$RESP" '"type":"text_delta"'
assert_contains "包含 run_completed 事件" "$RESP" '"type":"run_completed"'
assert_contains "包含 final" "$RESP" '"final":'
echo ""

# ============================================================
# Test 7: 输出 schema（结构化输出）
# ============================================================
echo "Test 7: 结构化输出"
RESP=$(curl -s -X POST "$BASE_URL/api/sdk/threads/$THREAD_ID/runs" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-key" \
    -d '{"prompt":"Test structured","output_schema":{"type":"object","properties":{"answer":{"type":"string"}}},"metadata":{"key":"value"}}')
assert_contains "返回 success" "$RESP" '"success":true'
assert_contains "包含 metadata.elapsed_ms" "$RESP" '"elapsed_ms":'
echo ""

# ============================================================
# Test 8: 错误：sandbox 非法
# ============================================================
echo "Test 8: sandbox 校验"
RESP=$(curl -s -X POST "$BASE_URL/api/sdk/threads" \
    -H "Content-Type: application/json" \
    -d '{"sandbox":"invalid_sandbox"}')
assert_contains "返回 400" "$RESP" '"detail":"Invalid sandbox'
echo ""

# ============================================================
# Test 9: 错误：Thread 不存在
# ============================================================
echo "Test 9: Thread 不存在"
RESP=$(curl -s -X GET "$BASE_URL/api/sdk/threads/th_nonexistent" \
    -H "Authorization: Bearer test-key")
assert_contains "返回 404" "$RESP" '"detail":"Thread not found'
echo ""

# ============================================================
# Test 10: 错误：关闭后 Run
# ============================================================
echo "Test 10: 关闭 Thread 后 Run"
RESP=$(curl -s -X DELETE "$BASE_URL/api/sdk/threads/$THREAD_ID" \
    -H "Authorization: Bearer test-key")
assert_contains "status=closed" "$RESP" '"status":"closed"'
RESP=$(curl -s -X POST "$BASE_URL/api/sdk/threads/$THREAD_ID/runs" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer test-key" \
    -d '{"prompt":"This should fail"}')
assert_contains "返回 400" "$RESP" '"detail":"Thread is closed'
echo ""

# ============================================================
# Test 11: Python SDK E2E（直接调用）
# ============================================================
echo "Test 11: Python SDK E2E 调用"
PYTHON_OUTPUT=$(PYTHONPATH="$PYTHONPATH" python3 -c "
import json
from hermes_sdk import Hermes, Sandbox
with Hermes(api_key='test-key', base_url='$BASE_URL') as hermes:
    # 启动 Thread
    thread = hermes.thread_start(sandbox=Sandbox.WORKSPACE_WRITE, project_id='py-e2e')
    tid = thread.id
    # 同步 Run
    result = thread.run('Hello from Python SDK')
    fr = result.final_response
    usage = result.usage.to_dict()
    # 关闭
    thread.close()
    print(json.dumps({'thread_id': tid, 'final_response': fr, 'usage': usage}))
" 2>&1)
assert_contains "Python SDK 调用成功" "$PYTHON_OUTPUT" '"thread_id":'
assert_contains "包含 final_response" "$PYTHON_OUTPUT" '"final_response":'
assert_contains "包含 usage.total_tokens" "$PYTHON_OUTPUT" '"total_tokens":'
echo ""

# ============================================================
# Test 12: Python SDK 异步 E2E
# ============================================================
echo "Test 12: Python SDK 异步 E2E"
ASYNC_OUTPUT=$(PYTHONPATH="$PYTHONPATH" python3 -c "
import asyncio
import json
from hermes_sdk import Hermes, Sandbox

async def main():
    hermes = Hermes(api_key='test-key', base_url='$BASE_URL')
    thread = hermes.thread_start(sandbox=Sandbox.READ_ONLY)
    result = await thread.arun('Async hello')
    await thread.aclose()
    print(json.dumps({'async': True, 'thread_id': thread.id, 'final': result.final_response}))

asyncio.run(main())
" 2>&1)
assert_contains "Python SDK 异步成功" "$ASYNC_OUTPUT" '"async": true'
assert_contains "包含 final" "$ASYNC_OUTPUT" '"final":'
echo ""

# ============================================================
# Test 13: Python SDK 异常处理
# ============================================================
echo "Test 13: Python SDK 异常处理"
ERR_OUTPUT=$(PYTHONPATH="$PYTHONPATH" python3 -c "
from hermes_sdk import Hermes, HermesNotFoundError
hermes = Hermes(api_key='test-key', base_url='$BASE_URL')
try:
    hermes.resume_thread('th_does_not_exist_zzz')
except HermesNotFoundError as e:
    print('CAUGHT_NOTFOUND')
except Exception as e:
    print('UNEXPECTED:' + type(e).__name__)
" 2>&1)
assert_contains "捕获到 NotFound 异常" "$ERR_OUTPUT" 'CAUGHT_NOTFOUND'
echo ""

# ============================================================
# Test 14: TypeScript SDK E2E
# ============================================================
echo "Test 14: TypeScript SDK E2E"
TS_OUTPUT=$(cd "$TS_DIR" && export PATH=/home/qizheng/.nvm/versions/node/v24.15.0/bin:\$PATH && HERMES_BASE_URL="$BASE_URL" node -e "
import('./dist/index.js').then(async (mod) => {
  const hermes = new mod.Hermes({ apiKey: 'test-key', baseUrl: process.env.HERMES_BASE_URL });
  const thread = await hermes.threadStart({ sandbox: mod.Sandbox.WORKSPACE_WRITE });
  const result = await thread.run('Hello from TypeScript SDK');
  await thread.close();
  console.log(JSON.stringify({ ts: true, threadId: thread.id, final: result.finalResponse, tokens: result.usage.totalTokens }));
}).catch(err => { console.error('TS_ERROR:', err.message); process.exit(1); });
" 2>&1)
assert_contains "TypeScript SDK 调用成功" "$TS_OUTPUT" '"ts":true'
assert_contains "包含 final" "$TS_OUTPUT" '"final":'
assert_contains "包含 tokens" "$TS_OUTPUT" '"tokens":'
echo ""

# ============================================================
# 总结
# ============================================================
echo "=========================================="
TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo "测试结果：$PASS_COUNT / $TOTAL 通过"
if [ $FAIL_COUNT -eq 0 ]; then
    echo -e "${GREEN}✔ 全部通过${NC}"
    exit 0
else
    echo -e "${RED}✗ $FAIL_COUNT 项失败${NC}"
    exit 1
fi
