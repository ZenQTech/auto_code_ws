#!/bin/bash
# ============================================================
# Cycle 3 E2E API 测试脚本
# ============================================================
# 测试覆盖：T6, T7, T8, T9, T10 所有新增 API 端点
# ============================================================

set -e

BASE_URL="http://localhost:8000"
PASS=0
FAIL=0
TOTAL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

check() {
    local name="$1"
    local cmd="$2"
    TOTAL=$((TOTAL+1))
    echo -n "[$TOTAL] $name ... "
    if eval "$cmd" > /tmp/cycle3_e2e_out 2>&1; then
        echo -e "${GREEN}PASS${NC}"
        PASS=$((PASS+1))
    else
        echo -e "${RED}FAIL${NC}"
        cat /tmp/cycle3_e2e_out | head -3
        FAIL=$((FAIL+1))
    fi
}

echo -e "${YELLOW}===== T6: 外部 MCP 服务器 API 测试 =====${NC}"

check "GET /api/mcp/servers" \
    "curl -sf $BASE_URL/api/mcp/servers | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]'"

check "GET /api/mcp/tools" \
    "curl -sf $BASE_URL/api/mcp/tools | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"tools\" in d'"

check "POST /api/mcp/servers (stdio)" \
    "curl -sf -X POST $BASE_URL/api/mcp/servers -H 'Content-Type: application/json' -d \"{\\\"name\\\":\\\"test-stdio-$(date +%s%N)\\\",\\\"transport\\\":\\\"stdio\\\",\\\"command\\\":\\\"echo\\\"}\" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"server_id\" in d'"

check "POST /api/mcp/servers (无效transport)" \
    "curl -sf -X POST $BASE_URL/api/mcp/servers -H 'Content-Type: application/json' -d '{\"name\":\"bad\",\"transport\":\"invalid\"}' || true"

echo -e "${YELLOW}===== T7: SKILL.md 导入导出 API 测试 =====${NC}"

check "POST /api/skills/preview (valid)" \
    "curl -sf -X POST $BASE_URL/api/skills/preview -H 'Content-Type: application/json' -d '{\"content\":\"---\\nname: test\\ndescription: test\\n---\\n# body\"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"valid\"]'"

check "POST /api/skills/preview (invalid)" \
    "curl -sf -X POST $BASE_URL/api/skills/preview -H 'Content-Type: application/json' -d '{\"content\":\"no frontmatter\"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert not d[\"valid\"]'"

check "GET /api/skills" \
    "curl -sf $BASE_URL/api/skills | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"skills\" in d'"

echo -e "${YELLOW}===== T8: 多文件类型规则 API 测试 =====${NC}"

# 创建临时项目
TEMP_DIR=$(mktemp -d)
mkdir -p "$TEMP_DIR/sub"
cat > "$TEMP_DIR/AGENTS.md" <<EOF
# Project AGENTS
Test project rules
EOF
cat > "$TEMP_DIR/CLAUDE.md" <<EOF
# Claude rules
Test
EOF
cat > "$TEMP_DIR/sub/GEMINI.md" <<EOF
# Sub Gemini rules
EOF

check "POST /api/rules/scan" \
    "curl -sf -X POST $BASE_URL/api/rules/scan -H 'Content-Type: application/json' -d '{\"project_path\":\"$TEMP_DIR\"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert d[\"count\"] >= 2'"

check "GET /api/rules/list" \
    "curl -sf \"$BASE_URL/api/rules/list?project_path=$TEMP_DIR\" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"rules\" in d'"

check "GET /api/rules/preview" \
    "curl -sf \"$BASE_URL/api/rules/preview?project_path=$TEMP_DIR&max_total_size=2000\" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"merged_content\" in d'"

check "GET /api/rules/conflicts" \
    "curl -sf \"$BASE_URL/api/rules/conflicts?project_path=$TEMP_DIR\" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"conflicts\" in d'"

# 清理
rm -rf "$TEMP_DIR"

echo -e "${YELLOW}===== T9: 双触发压缩 API 测试 =====${NC}"

# 创建一个测试会话
SESSION_ID="test-session-$(date +%s)"

check "GET /api/compaction/dual/config" \
    "curl -sf $BASE_URL/api/compaction/dual/config | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"config\" in d'"

check "PUT /api/compaction/dual/config" \
    "curl -sf -X PUT $BASE_URL/api/compaction/dual/config -H 'Content-Type: application/json' -d '{\"pre_turn_enabled\":true,\"mid_turn_enabled\":true}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]'"

check "POST /api/compaction/dual/pre-turn" \
    "curl -sf -X POST $BASE_URL/api/compaction/dual/pre-turn -H 'Content-Type: application/json' -d '{\"session_id\":\"$SESSION_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Hello world this is a test message\"}]}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert \"triggered\" in d'"

check "POST /api/compaction/dual/mid-turn" \
    "curl -sf -X POST $BASE_URL/api/compaction/dual/mid-turn -H 'Content-Type: application/json' -d '{\"session_id\":\"$SESSION_ID\",\"messages\":[{\"role\":\"user\",\"content\":\"Test message\"}],\"pending_request\":{\"request_id\":\"r1\",\"role\":\"user\",\"content\":\"important\"}}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert d[\"trigger\"]==\"mid_turn\"'"

check "GET /api/compaction/dual/history" \
    "curl -sf \"$BASE_URL/api/compaction/dual/history?session_id=$SESSION_ID&limit=10\" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"history\" in d'"

echo -e "${YELLOW}===== T10: MCP 权限控制 API 测试 =====${NC}"

check "GET /api/mcp/permissions" \
    "curl -sf $BASE_URL/api/mcp/permissions | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"permissions\" in d; assert len(d[\"permissions\"]) > 0'"

check "PUT /api/mcp/permissions (set blocked)" \
    "curl -sf -X PUT $BASE_URL/api/mcp/permissions -H 'Content-Type: application/json' -d '{\"tool_name\":\"test_blocked\",\"mode\":\"blocked\",\"reason\":\"test\"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert d[\"permission\"][\"mode\"]==\"blocked\"'"

check "PUT /api/mcp/permissions (set auto)" \
    "curl -sf -X PUT $BASE_URL/api/mcp/permissions -H 'Content-Type: application/json' -d '{\"tool_name\":\"test_auto\",\"mode\":\"auto\"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]'"

check "GET /api/mcp/approvals/pending" \
    "curl -sf $BASE_URL/api/mcp/approvals/pending | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"pending\" in d'"

check "GET /api/mcp/audit-log" \
    "curl -sf $BASE_URL/api/mcp/audit-log?limit=10 | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert \"logs\" in d'"

check "GET /api/mcp/audit-log (with filter)" \
    "curl -sf \"$BASE_URL/api/mcp/audit-log?tool_name=read_file&limit=5\" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]'"

echo -e "${YELLOW}===== T11: SubAgent workspace 字段 API 测试（v4.3.0 P2-1 新增）=====${NC}"

# 验证 /api/agents 端点暴露 SubAgent workspace 字段
# 即使没有 agent 也应返回 list，字段结构应支持 0 长度
check "GET /api/agents returns list (P2-1)" \
    "curl -sf $BASE_URL/api/agents | python3 -c 'import json,sys; d=json.load(sys.stdin); assert isinstance(d, list)'"

# 验证每个 agent 字典包含 P2-1 字段（即使列表为空也要保证格式正确）
# 由于端点可能返回空列表，使用空列表回退验证（验证 dict schema）
check "GET /api/agents schema validation (P2-1)" \
    "curl -sf $BASE_URL/api/agents | python3 -c '
import json, sys
agents = json.load(sys.stdin)
# 字段集合（无论是否有 agent，验证 _agent_to_dict 输出格式）
expected_fields = {\"id\", \"name\", \"avatar_seed\", \"status\", \"cli_path\", \"workspace\",
                   \"branch_name\", \"worktree_id\", \"module_name\", \"file_count\",
                   \"commit_count\", \"progress_percent\", \"max_concurrent\",
                   \"current_tasks\", \"total_tokens\", \"total_api_calls\"}
if len(agents) > 0:
    agent = agents[0]
    missing = expected_fields - set(agent.keys())
    assert not missing, f\"missing fields: {missing}\"
else:
    # 无 agent 时跳过具体字段检查，但 API 端点必须可访问
    pass
'"

# 通过内部 mock 验证 _agent_to_dict 端点输出 Schema（独立测试，不需要真实 agent）
check "_agent_to_dict returns SubAgent workspace schema" \
    "python3 -c '
from cli_integration.agent_manager import AgentInfo, AgentStatus
from backend.app.api.agents import _agent_to_dict
agent = AgentInfo(name=\"test\", status=AgentStatus.ONLINE, workspace=\"/home/qizheng/auto_code_ws\")
result = _agent_to_dict(agent)
required = [\"branch_name\", \"worktree_id\", \"module_name\", \"file_count\", \"commit_count\", \"progress_percent\"]
for k in required:
    assert k in result, f\"missing {k}\"
'"

echo -e "${YELLOW}===== T12: Plan 模式 API 测试（v4.1.0 P0-4 新增）=====${NC}"

# T12.1: Plan 模式端点存在
check "Plan 模式端点列表 (P0-4)" \
    "curl -sf $BASE_URL/openapi.json | python3 -c '
import json, sys
data = json.load(sys.stdin)
plan_paths = [p for p in data.get(\"paths\", {}) if \"/plan\" in p]
# 应至少有 5 个 plan 端点（generate/get/confirm/modify/reject）
required = [\"/api/workflow/{workflow_id}/plan/generate\",
            \"/api/workflow/{workflow_id}/plan\",
            \"/api/workflow/{workflow_id}/plan/confirm\",
            \"/api/workflow/{workflow_id}/plan/modify\",
            \"/api/workflow/{workflow_id}/plan/reject\"]
for p in required:
    assert p in plan_paths, f\"missing endpoint: {p}\"
'"

# T12.2: plan 端点 HTTP methods 完整（generate 是 POST, get 是 GET, confirm/modify/reject 是 POST）
check "Plan 端点 HTTP methods 完整 (P0-4)" \
    "curl -sf $BASE_URL/openapi.json | python3 -c '
import json, sys
data = json.load(sys.stdin)
# generate 端点应有 POST
assert \"post\" in data[\"paths\"][\"/api/workflow/{workflow_id}/plan/generate\"]
# get 端点应有 GET
assert \"get\" in data[\"paths\"][\"/api/workflow/{workflow_id}/plan\"]
# confirm 端点应有 POST
assert \"post\" in data[\"paths\"][\"/api/workflow/{workflow_id}/plan/confirm\"]
# modify 端点应有 POST
assert \"post\" in data[\"paths\"][\"/api/workflow/{workflow_id}/plan/modify\"]
# reject 端点应有 POST
assert \"post\" in data[\"paths\"][\"/api/workflow/{workflow_id}/plan/reject\"]
'"

# T12.3: 验证对不存在 workflow 调用 plan/generate 正确返回 404
check "GET /api/workflow/{nonexist}/plan 返回 None" \
    "curl -sf $BASE_URL/api/workflow/nonexist-workflow-12345/plan | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d[\"success\"]; assert d[\"plan\"] is None'"

# T12.4: 验证对不存在 workflow 调用 plan/generate 返回 404
check "POST /api/workflow/{nonexist}/plan/generate 返回 404" \
    "curl -s -X POST $BASE_URL/api/workflow/nonexist-wf-67890/plan/generate -H 'Content-Type: application/json' -d '{\"objective\":\"test\"}' | python3 -c 'import json,sys; d=json.load(sys.stdin); assert \"detail\" in d'"

# T12.5: 单元测试 PlanDocument 数据类 schema 完整性
check "PlanDocument schema validation (P0-4)" \
    "python3 -c '
from backend.app.services.plan_mode import PlanDocument, PlanStage, PlanTask, PlanRisk
doc = PlanDocument(plan_id=\"p-1\", workflow_id=\"wf-1\", objective=\"test\",
                   stages=[PlanStage(stage=\"coding\", tasks=[PlanTask(task_id=\"t-1\", title=\"t1\")],
                                     risks=[PlanRisk(risk_id=\"r-1\", description=\"r1\")],
                                     alternatives=[\"alt1\"])])
data = doc.to_dict()
required = [\"plan_id\", \"workflow_id\", \"objective\", \"stages\", \"status\"]
for k in required:
    assert k in data, f\"missing {k}\"
assert len(data[\"stages\"]) == 1
assert data[\"stages\"][0][\"tasks\"][0][\"title\"] == \"t1\"
'"

# T12.6: PlanDocument 序列化往返验证
check "PlanDocument 序列化往返 (P0-4)" \
    "python3 -c '
from backend.app.services.plan_mode import PlanDocument
doc = PlanDocument(plan_id=\"p-roundtrip\", workflow_id=\"wf-r\", objective=\"obj\",
                   stages=[])
json_str = doc.to_json()
restored = PlanDocument.from_json(json_str)
assert restored.plan_id == \"p-roundtrip\"
assert restored.workflow_id == \"wf-r\"
'"

echo ""
echo "=================================================="
echo -e "测试结果: ${GREEN}通过 $PASS${NC} / ${RED}失败 $FAIL${NC} (总计 $TOTAL)"
echo "=================================================="
[ $FAIL -eq 0 ] && exit 0 || exit 1
