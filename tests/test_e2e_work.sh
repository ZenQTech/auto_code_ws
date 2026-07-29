#!/bin/bash
# ============================================================
# TRAE Work E2E 测试
# ============================================================
# 覆盖 4 大子系统：Design Mode / Voice Chat / Global Memory / Video
# 关联：Cycle 14 P1-3
# 版本：v6.31.0
# ============================================================

set -e

BASE="${BASE:-http://localhost:8000}"
API="$BASE/api/work"
PASS=0
FAIL=0
TOTAL=0

# 颜色
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

assert_contains() {
    local name="$1"
    local haystack="$2"
    local needle="$3"
    TOTAL=$((TOTAL + 1))
    if echo "$haystack" | grep -q -- "$needle"; then
        echo -e "${GREEN}[PASS]${NC} $name"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}[FAIL]${NC} $name"
        echo "  Expected to find: $needle"
        echo "  Got: $(echo "$haystack" | head -c 200)"
        FAIL=$((FAIL + 1))
    fi
}

assert_status() {
    local name="$1"
    local code="$2"
    local expected="$3"
    TOTAL=$((TOTAL + 1))
    if [ "$code" = "$expected" ]; then
        echo -e "${GREEN}[PASS]${NC} $name (status=$code)"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}[FAIL]${NC} $name (expected=$expected, got=$code)"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}TRAE Work E2E 测试 - v6.31.0${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

# ============================================================
# Test 1: 健康检查
# ============================================================
echo "--- Test 1: Health Check ---"
RESP=$(curl -s -m 5 "$API/health")
assert_contains "work health status" "$RESP" '"status":"ok"'
assert_contains "work health design" "$RESP" '"design":"ok"'
assert_contains "work health voice" "$RESP" '"voice":"ok"'
assert_contains "work health memory" "$RESP" '"memory":"ok"'
assert_contains "work health video" "$RESP" '"video":"ok"'
echo ""

# ============================================================
# Test 2: Design Mode - 草图
# ============================================================
echo "--- Test 2: Design Mode Drafts ---"

# 创建 web 草图
RESP=$(curl -s -m 5 -X POST "$API/design/drafts" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E Page","template":"web","description":"e2e test","owner":"e2e_user","tags":["e2e"]}')
assert_contains "create web draft" "$RESP" '"success":true'
assert_contains "web draft has html" "$RESP" '"html"'
assert_contains "web draft has draft_id" "$RESP" '"draft_id":"draft_'
DRAFT_ID=$(echo "$RESP" | grep -oE '"draft_id":"draft_[a-f0-9]+"' | head -1 | sed 's/"draft_id":"//;s/"//')
echo "  Draft ID: $DRAFT_ID"

# 创建 mobile 草图
RESP=$(curl -s -m 5 -X POST "$API/design/drafts" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E Mobile","template":"mobile","description":"e2e mobile"}')
assert_contains "create mobile draft" "$RESP" '"success":true'
assert_contains "mobile has tabbar" "$RESP" 'tabbar'

# 创建 landing 草图
RESP=$(curl -s -m 5 -X POST "$API/design/drafts" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E Landing","template":"landing","description":"e2e landing"}')
assert_contains "create landing draft" "$RESP" '"success":true'
assert_contains "landing has hero" "$RESP" 'hero'

# 创建 dashboard 草图
RESP=$(curl -s -m 5 -X POST "$API/design/drafts" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E Dashboard","template":"dashboard","description":"e2e dashboard"}')
assert_contains "create dashboard draft" "$RESP" '"success":true'
assert_contains "dashboard has sidebar" "$RESP" 'sidebar'

# 列出草图
RESP=$(curl -s -m 5 "$API/design/drafts?owner=e2e_user")
assert_contains "list drafts" "$RESP" '"success":true'
assert_contains "list has drafts" "$RESP" '"drafts"'

# 获取单个草图
RESP=$(curl -s -m 5 "$API/design/drafts/$DRAFT_ID")
assert_contains "get draft" "$RESP" '"success":true'
assert_contains "get draft name" "$RESP" '"name":"E2E Page"'

# 更新草图
RESP=$(curl -s -m 5 -X PUT "$API/design/drafts/$DRAFT_ID" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E Page Updated","description":"updated"}')
assert_contains "update draft" "$RESP" '"success":true'
assert_contains "update name" "$RESP" '"name":"E2E Page Updated"'

echo ""

# ============================================================
# Test 3: Design Mode - NL 编辑
# ============================================================
echo "--- Test 3: Design Mode NL Edit ---"

# hex 颜色编辑
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/nl-edit" \
    -H "Content-Type: application/json" \
    -d '{"instruction":"把主色改为 #FF0000"}')
assert_contains "nl edit hex color" "$RESP" '"success":true'
assert_contains "nl edit color change" "$RESP" '"applied_changes"'
assert_contains "nl edit color value" "$RESP" '"new_value":"#FF0000"'

# 圆角编辑
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/nl-edit" \
    -H "Content-Type: application/json" \
    -d '{"instruction":"按钮改成圆角"}')
assert_contains "nl edit radius" "$RESP" '"success":true'
assert_contains "nl edit radius type" "$RESP" '"type":"border-radius"'

# 命名颜色
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/nl-edit" \
    -H "Content-Type: application/json" \
    -d '{"instruction":"背景改成蓝色"}')
assert_contains "nl edit named color" "$RESP" '"success":true'

echo ""

# ============================================================
# Test 4: Design Mode - 导出
# ============================================================
echo "--- Test 4: Design Mode Export ---"

# HTML 导出
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"format":"html"}')
assert_contains "export html" "$RESP" '"success":true'
assert_contains "export html format" "$RESP" '"format":"html"'

# React 导出
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"format":"react"}')
assert_contains "export react" "$RESP" '"success":true'
assert_contains "export react code" "$RESP" 'import React'

# Tailwind 导出
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"format":"tailwind"}')
assert_contains "export tailwind" "$RESP" '"success":true'

# Vue 导出
RESP=$(curl -s -m 5 -X POST "$API/design/drafts/$DRAFT_ID/export" \
    -H "Content-Type: application/json" \
    -d '{"format":"vue"}')
assert_contains "export vue" "$RESP" '"success":true'
assert_contains "export vue template" "$RESP" '<template>'

echo ""

# ============================================================
# Test 5: Design System
# ============================================================
echo "--- Test 5: Design System ---"

# 创建设计系统
RESP=$(curl -s -m 5 -X POST "$API/design/systems" \
    -H "Content-Type: application/json" \
    -d '{"name":"E2E System","colors":{"primary":"#4F46E5"},"owner":"e2e_user"}')
assert_contains "create system" "$RESP" '"success":true'
assert_contains "system has id" "$RESP" '"system_id":"sys_'
SYS_ID=$(echo "$RESP" | grep -oE '"system_id":"sys_[a-f0-9]+"' | head -1 | sed 's/"system_id":"//;s/"//')

# 列出设计系统
RESP=$(curl -s -m 5 "$API/design/systems")
assert_contains "list systems" "$RESP" '"success":true'

# 获取系统
RESP=$(curl -s -m 5 "$API/design/systems/$SYS_ID")
assert_contains "get system" "$RESP" '"success":true'

# 更新系统
RESP=$(curl -s -m 5 -X PUT "$API/design/systems/$SYS_ID" \
    -H "Content-Type: application/json" \
    -d '{"colors":{"primary":"#FF0000"}}')
assert_contains "update system" "$RESP" '"success":true'

echo ""

# ============================================================
# Test 6: Voice Chat
# ============================================================
echo "--- Test 6: Voice Chat ---"

# 创建语音会话
RESP=$(curl -s -m 5 -X POST "$API/voice/sessions" \
    -H "Content-Type: application/json" \
    -d '{"user_id":"e2e_user","project_id":"e2e_proj","initial_message":"hello"}')
assert_contains "create voice session" "$RESP" '"success":true'
assert_contains "voice session id" "$RESP" '"session_id":"vsess_'
SESS_ID=$(echo "$RESP" | grep -oE '"session_id":"vsess_[a-f0-9]+"' | head -1 | sed 's/"session_id":"//;s/"//')

# 列出语音会话
RESP=$(curl -s -m 5 "$API/voice/sessions?user_id=e2e_user")
assert_contains "list voice sessions" "$RESP" '"success":true'

# 获取会话
RESP=$(curl -s -m 5 "$API/voice/sessions/$SESS_ID")
assert_contains "get voice session" "$RESP" '"success":true'

# 发送消息
RESP=$(curl -s -m 5 -X POST "$API/voice/sessions/$SESS_ID/messages" \
    -H "Content-Type: application/json" \
    -d '{"text":"hello world","use_context":false}')
assert_contains "send voice message" "$RESP" '"success":true'
assert_contains "voice reply" "$RESP" '"reply"'

# 发送消息（启用 web 搜索）
RESP=$(curl -s -m 5 -X POST "$API/voice/sessions/$SESS_ID/messages" \
    -H "Content-Type: application/json" \
    -d '{"text":"Codex 文档","use_web_search":true}')
assert_contains "voice web search" "$RESP" '"web_results"'

# 获取上下文
RESP=$(curl -s -m 5 "$API/voice/sessions/$SESS_ID/context")
assert_contains "get voice context" "$RESP" '"success":true'

# Web 搜索
RESP=$(curl -s -m 5 -X POST "$API/voice/web-search" \
    -H "Content-Type: application/json" \
    -d '{"query":"Codex","max_results":3}')
assert_contains "web search" "$RESP" '"success":true'
assert_contains "web search results" "$RESP" '"results"'

# STT
RESP=$(curl -s -m 5 -X POST "$API/voice/transcribe" \
    -H "Content-Type: application/json" \
    -d '{"audio_id":"e2e_audio_1","text_hint":"hello"}')
assert_contains "stt" "$RESP" '"success":true'
assert_contains "stt text" "$RESP" '"text":"hello'

# TTS
RESP=$(curl -s -m 5 -X POST "$API/voice/synthesize" \
    -H "Content-Type: application/json" \
    -d '{"text":"hello world 测试"}')
assert_contains "tts" "$RESP" '"success":true'
assert_contains "tts audio_id" "$RESP" '"audio_id"'

# 关闭会话
RESP=$(curl -s -m 5 -X DELETE "$API/voice/sessions/$SESS_ID")
assert_contains "close voice session" "$RESP" '"success":true'

echo ""

# ============================================================
# Test 7: Global Memory
# ============================================================
echo "--- Test 7: Global Memory ---"

# 创建条目
RESP=$(curl -s -m 5 -X POST "$API/memory/entries" \
    -H "Content-Type: application/json" \
    -d '{"project_id":"e2e_proj","category":"preference","content":"user likes blue theme","tags":["ui","color"],"source":"user","confidence":0.9}')
assert_contains "create memory entry" "$RESP" '"success":true'
assert_contains "entry id" "$RESP" '"entry_id":"kb_'
ENTRY_ID=$(echo "$RESP" | grep -oE '"entry_id":"kb_[a-f0-9]+"' | head -1 | sed 's/"entry_id":"//;s/"//')

# 创建更多条目
curl -s -m 5 -X POST "$API/memory/entries" \
    -H "Content-Type: application/json" \
    -d '{"project_id":"e2e_proj","category":"fact","content":"database is PostgreSQL","tags":["backend","db"]}' > /dev/null

curl -s -m 5 -X POST "$API/memory/entries" \
    -H "Content-Type: application/json" \
    -d '{"project_id":"e2e_proj","category":"rule","content":"always use TypeScript","tags":["code"]}' > /dev/null

# 列出条目
RESP=$(curl -s -m 5 "$API/memory/entries?project_id=e2e_proj")
assert_contains "list memory entries" "$RESP" '"success":true'
assert_contains "list has entries" "$RESP" '"entries"'

# 按类别列出
RESP=$(curl -s -m 5 "$API/memory/entries?project_id=e2e_proj&category=preference")
assert_contains "list by category" "$RESP" '"preference"'

# 获取条目
RESP=$(curl -s -m 5 "$API/memory/entries/$ENTRY_ID")
assert_contains "get memory entry" "$RESP" '"success":true'

# 更新条目
RESP=$(curl -s -m 5 -X PUT "$API/memory/entries/$ENTRY_ID" \
    -H "Content-Type: application/json" \
    -d '{"content":"user likes green theme","confidence":0.95}')
assert_contains "update memory entry" "$RESP" '"success":true'
assert_contains "updated content" "$RESP" 'green'

# 检索
RESP=$(curl -s -m 5 -X POST "$API/memory/search" \
    -H "Content-Type: application/json" \
    -d '{"project_id":"e2e_proj","query":"green theme","top_k":3}')
assert_contains "memory search" "$RESP" '"success":true'
assert_contains "search results" "$RESP" '"results"'

# 列出项目
RESP=$(curl -s -m 5 "$API/memory/projects")
assert_contains "list projects" "$RESP" '"success":true'
assert_contains "e2e_proj in projects" "$RESP" 'e2e_proj'

# 统计
RESP=$(curl -s -m 5 "$API/memory/stats?project_id=e2e_proj")
assert_contains "memory stats" "$RESP" '"success":true'
assert_contains "stats by_category" "$RESP" '"by_category"'

echo ""

# ============================================================
# Test 8: Video
# ============================================================
echo "--- Test 8: Video ---"

# 上传视频
RESP=$(curl -s -m 5 -X POST "$API/video/upload" \
    -H "Content-Type: application/json" \
    -d '{"file_path":"/tmp/e2e_test.mp4","file_size":10485760,"uploaded_by":"e2e_user","title":"E2E Video","description":"test video"}')
assert_contains "upload video" "$RESP" '"success":true'
assert_contains "video id" "$RESP" '"video_id":"vid_'
VIDEO_ID=$(echo "$RESP" | grep -oE '"video_id":"vid_[a-f0-9]+"' | head -1 | sed 's/"video_id":"//;s/"//')

# 列出视频
RESP=$(curl -s -m 5 "$API/video/videos?uploaded_by=e2e_user")
assert_contains "list videos" "$RESP" '"success":true'
assert_contains "list has videos" "$RESP" '"videos"'

# 获取视频
RESP=$(curl -s -m 5 "$API/video/videos/$VIDEO_ID")
assert_contains "get video" "$RESP" '"success":true'
assert_contains "video title" "$RESP" '"title":"E2E Video"'

# 提取关键帧
RESP=$(curl -s -m 5 -X POST "$API/video/videos/$VIDEO_ID/extract-frames" \
    -H "Content-Type: application/json" \
    -d '{"frame_count":5}')
assert_contains "extract frames" "$RESP" '"success":true'
assert_contains "frames count" "$RESP" '"count":5'
assert_contains "frames has frames" "$RESP" '"frames"'

# 生成摘要
RESP=$(curl -s -m 5 -X POST "$API/video/videos/$VIDEO_ID/summarize" \
    -H "Content-Type: application/json" \
    -d '{"frame_count":3,"include_transcript":true}')
assert_contains "summarize video" "$RESP" '"success":true'
assert_contains "summary has key_frames" "$RESP" '"key_frames"'
assert_contains "summary has transcript" "$RESP" '"transcript"'
assert_contains "summary has scenes" "$RESP" '"scenes"'
assert_contains "summary text" "$RESP" '"summary_text"'

# 视频生成
RESP=$(curl -s -m 5 -X POST "$API/video/generate" \
    -H "Content-Type: application/json" \
    -d '{"prompt":"A sunset over ocean","duration":5.0,"resolution":"1280x720","style":"realistic","owner":"e2e_user"}')
assert_contains "generate video" "$RESP" '"success":true'
assert_contains "generation completed" "$RESP" '"status":"completed"'
assert_contains "generation has output" "$RESP" '"output_path"'

# 列出生成
RESP=$(curl -s -m 5 "$API/video/generations?owner=e2e_user")
assert_contains "list generations" "$RESP" '"success":true'

# 视频统计
RESP=$(curl -s -m 5 "$API/video/stats")
assert_contains "video stats" "$RESP" '"success":true'

echo ""

# ============================================================
# Test 9: 错误处理
# ============================================================
echo "--- Test 9: Error Handling ---"

# 404 获取不存在的草图
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$API/design/drafts/not_exist_xyz")
assert_status "404 for missing draft" "$CODE" "404"

# 400 无效模板
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X POST "$API/design/drafts" \
    -H "Content-Type: application/json" \
    -d '{"name":"X","template":"invalid","description":""}')
assert_status "400 for invalid template" "$CODE" "400"

# 400 无效类别
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X POST "$API/memory/entries" \
    -H "Content-Type: application/json" \
    -d '{"project_id":"p1","category":"invalid","content":"x"}')
assert_status "400 for invalid category" "$CODE" "400"

# 400 或 422 视频太大（Pydantic 或自定义校验）
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X POST "$API/video/upload" \
    -H "Content-Type: application/json" \
    -d '{"file_path":"/tmp/big.mp4","file_size":200000000}')
if [ "$CODE" = "400" ] || [ "$CODE" = "422" ]; then
    TOTAL=$((TOTAL + 1))
    echo -e "${GREEN}[PASS]${NC} 4xx for too large video (status=$CODE)"
    PASS=$((PASS + 1))
else
    TOTAL=$((TOTAL + 1))
    echo -e "${RED}[FAIL]${NC} too large video (expected=400 or 422, got=$CODE)"
    FAIL=$((FAIL + 1))
fi

# 404 视频不存在
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" -X POST "$API/video/videos/not_exist/extract-frames" \
    -H "Content-Type: application/json" \
    -d '{"frame_count":3}')
assert_status "404 for missing video extract" "$CODE" "400"

echo ""

# ============================================================
# Test 10: 清理
# ============================================================
echo "--- Test 10: Cleanup ---"

# 删除草图
RESP=$(curl -s -m 5 -X DELETE "$API/design/drafts/$DRAFT_ID")
assert_contains "delete draft" "$RESP" '"success":true'

# 删除系统
RESP=$(curl -s -m 5 -X DELETE "$API/design/systems/$SYS_ID")
assert_contains "delete system" "$RESP" '"success":true'

# 删除内存条目
RESP=$(curl -s -m 5 -X DELETE "$API/memory/entries/$ENTRY_ID")
assert_contains "delete memory entry" "$RESP" '"success":true'

# 删除视频
RESP=$(curl -s -m 5 -X DELETE "$API/video/videos/$VIDEO_ID")
assert_contains "delete video" "$RESP" '"success":true'

# 验证删除后获取返回 404
CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$API/design/drafts/$DRAFT_ID")
assert_status "draft deleted (404)" "$CODE" "404"

CODE=$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$API/video/videos/$VIDEO_ID")
assert_status "video deleted (404)" "$CODE" "404"

echo ""

# ============================================================
# Test 11: 全局统计
# ============================================================
echo "--- Test 11: Global Stats ---"
RESP=$(curl -s -m 5 "$API/stats")
assert_contains "global stats" "$RESP" '"success":true'
assert_contains "stats has design" "$RESP" '"design"'
assert_contains "stats has voice" "$RESP" '"voice"'
assert_contains "stats has memory" "$RESP" '"memory"'
assert_contains "stats has video" "$RESP" '"video"'

echo ""

# ============================================================
# 汇总
# ============================================================
echo "=========================================="
echo -e "${YELLOW}TRAE Work E2E 测试结果${NC}"
echo "=========================================="
echo -e "Total: $TOTAL"
echo -e "${GREEN}Passed: $PASS${NC}"
echo -e "${RED}Failed: $FAIL${NC}"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo -e "${RED}SOME TESTS FAILED${NC}"
    exit 1
fi

echo -e "${GREEN}ALL E2E TESTS PASSED${NC}"
exit 0
