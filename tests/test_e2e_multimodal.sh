#!/bin/bash
# ============================================================
# 多模态模块 - 端到端测试
# ============================================================
# 核心作用：测试 multimodal 模块的所有 REST API 端点
# 运行流程：先启动后端，curl 调用所有端点，验证响应
# 覆盖：健康检查、统计、上传、Vision、Audio、消息 CRUD
# 修改记录：
#   - 2026-07-28 | v6.27.0 | Cycle 14 P0-2 初始版本
# ============================================================

set -e

BASE_URL="${BASE_URL:-http://localhost:8000}"
TMP_DIR=$(mktemp -d)
trap "rm -rf $TMP_DIR" EXIT

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 计数器
PASS=0
FAIL=0

# 辅助函数
assert_eq() {
    if [ "$1" = "$2" ]; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

assert_contains() {
    if echo "$1" | grep -q "$2"; then
        echo -e "${GREEN}✓${NC} $3"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $3 (expected to contain '$2', got '$1')"
        FAIL=$((FAIL + 1))
    fi
}

assert_true() {
    if [ "$1" = "true" ] || [ "$1" = "True" ] || [ "$1" -gt 0 ] 2>/dev/null; then
        echo -e "${GREEN}✓${NC} $2"
        PASS=$((PASS + 1))
    else
        echo -e "${RED}✗${NC} $2"
        FAIL=$((FAIL + 1))
    fi
}

# 创建测试 PNG 文件 (最小有效 PNG)
make_png() {
    local out="$1"
    local width="${2:-100}"
    local height="${3:-100}"
    python3 -c "
import struct, zlib, sys
def chunk(n, d):
    return struct.pack('>I', len(d)) + n + d + struct.pack('>I', zlib.crc32(n+d) & 0xFFFFFFFF)
w, h = $width, $height
ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
raw = b''
for _ in range(h):
    raw += b'\x00' + b'\xff\x00\x00' * w
idat = zlib.compress(raw)
data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
sys.stdout.buffer.write(data)
" > "$out"
}

# 创建测试 WAV 文件
make_wav() {
    local out="$1"
    local duration="${2:-1.0}"
    python3 -c "
import struct, math, sys
duration = $duration
sample_rate = 8000
num_samples = int(duration * sample_rate)
data = b''
for i in range(num_samples):
    sample = int(32767 * 0.5 * math.sin(2 * math.pi * 440 * i / sample_rate))
    data += struct.pack('<h', sample)
chunk_size = 36 + len(data)
wav = b'RIFF' + struct.pack('<I', chunk_size) + b'WAVE'
wav += b'fmt ' + struct.pack('<I', 16) + struct.pack('<H', 1) + struct.pack('<H', 1)
wav += struct.pack('<I', sample_rate) + struct.pack('<I', sample_rate * 2)
wav += struct.pack('<H', 2) + struct.pack('<H', 16)
wav += b'data' + struct.pack('<I', len(data)) + data
sys.stdout.buffer.write(wav)
" > "$out"
}

echo -e "${YELLOW}=== 多模态模块 E2E 测试 (v6.27.0) ===${NC}"
echo "Base URL: $BASE_URL"
echo ""

# ============================================================
# 1. 健康检查
# ============================================================
echo -e "${YELLOW}[1] 健康检查${NC}"

RESP=$(curl -s "$BASE_URL/api/multimodal/health")
assert_contains "$RESP" '"service":"multimodal"' "health returns service"
assert_contains "$RESP" '"status":"healthy"' "health returns healthy"
assert_contains "$RESP" '"storage_dir"' "health includes storage_dir"

# ============================================================
# 2. 统计信息
# ============================================================
echo -e "\n${YELLOW}[2] 统计信息${NC}"

RESP=$(curl -s "$BASE_URL/api/multimodal/stats")
assert_contains "$RESP" '"success":true' "stats success"
assert_contains "$RESP" '"total_media"' "stats total_media"
assert_contains "$RESP" '"image_count"' "stats image_count"
assert_contains "$RESP" '"audio_count"' "stats audio_count"

# ============================================================
# 3. 图像上传
# ============================================================
echo -e "\n${YELLOW}[3] 图像上传${NC}"

PNG_PATH="$TMP_DIR/test.png"
make_png "$PNG_PATH" 800 600

RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/upload/image" \
    -F "file=@$PNG_PATH" \
    -F "uploaded_by=e2e_user" \
    -F "session_id=e2e_session_1")
assert_contains "$RESP" '"success":true' "upload image success"
assert_contains "$RESP" '"type":"image"' "type is image"
assert_contains "$RESP" '"mime_type":"image/png"' "mime is png"
assert_contains "$RESP" '"width":800' "width 800"
assert_contains "$RESP" '"height":600' "height 600"
assert_contains "$RESP" '"thumbnail_path"' "thumbnail created"

IMG_MEDIA_ID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['media']['media_id'])" 2>/dev/null || echo "")

if [ -z "$IMG_MEDIA_ID" ]; then
    echo -e "${RED}Failed to extract image media_id${NC}"
    exit 1
fi
echo "  → Image media_id: $IMG_MEDIA_ID"

# ============================================================
# 4. 音频上传
# ============================================================
echo -e "\n${YELLOW}[4] 音频上传${NC}"

WAV_PATH="$TMP_DIR/test.wav"
make_wav "$WAV_PATH" 2.0

RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/upload/audio" \
    -F "file=@$WAV_PATH" \
    -F "uploaded_by=e2e_user" \
    -F "session_id=e2e_session_1")
assert_contains "$RESP" '"success":true' "upload audio success"
assert_contains "$RESP" '"type":"audio"' "type is audio"
assert_contains "$RESP" '"mime_type":"audio/wav"' "mime is wav"
assert_contains "$RESP" '"duration"' "duration present"

AUD_MEDIA_ID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['media']['media_id'])" 2>/dev/null || echo "")

if [ -z "$AUD_MEDIA_ID" ]; then
    echo -e "${RED}Failed to extract audio media_id${NC}"
    exit 1
fi
echo "  → Audio media_id: $AUD_MEDIA_ID"

# ============================================================
# 5. 上传错误格式
# ============================================================
echo -e "\n${YELLOW}[5] 上传错误格式${NC}"

TXT_PATH="$TMP_DIR/test.txt"
echo "not an image" > "$TXT_PATH"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/multimodal/upload/image" \
    -F "file=@$TXT_PATH" \
    -F "uploaded_by=e2e_user")
assert_eq "$HTTP_CODE" "400" "rejects invalid image format"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/multimodal/upload/audio" \
    -F "file=@$TXT_PATH" \
    -F "uploaded_by=e2e_user")
assert_eq "$HTTP_CODE" "400" "rejects invalid audio format"

# ============================================================
# 6. 获取媒体详情
# ============================================================
echo -e "\n${YELLOW}[6] 获取媒体详情${NC}"

RESP=$(curl -s "$BASE_URL/api/multimodal/media/$IMG_MEDIA_ID")
assert_contains "$RESP" '"success":true' "get media success"
assert_contains "$RESP" "$IMG_MEDIA_ID" "media_id matches"
assert_contains "$RESP" '"width":800' "width present"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/multimodal/media/nonexistent_id")
assert_eq "$HTTP_CODE" "404" "missing media returns 404"

# ============================================================
# 7. 列出媒体
# ============================================================
echo -e "\n${YELLOW}[7] 列出媒体${NC}"

RESP=$(curl -s "$BASE_URL/api/multimodal/media?limit=10")
assert_contains "$RESP" '"success":true' "list media success"
assert_contains "$RESP" '"count"' "count present"
assert_contains "$RESP" "$IMG_MEDIA_ID" "list contains uploaded image"

# 按类型过滤
RESP=$(curl -s "$BASE_URL/api/multimodal/media?type=image&limit=5")
assert_contains "$RESP" '"type":"image"' "filter by type image"

RESP=$(curl -s "$BASE_URL/api/multimodal/media?type=audio&limit=5")
assert_contains "$RESP" '"type":"audio"' "filter by type audio"

# 按用户过滤
RESP=$(curl -s "$BASE_URL/api/multimodal/media?uploaded_by=e2e_user&limit=10")
assert_contains "$RESP" '"uploaded_by":"e2e_user"' "filter by user"

# ============================================================
# 8. Vision 分析
# ============================================================
echo -e "\n${YELLOW}[8] Vision 分析${NC}"

# 完整分析
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$IMG_MEDIA_ID\",\"analysis_type\":\"full\"}")
assert_contains "$RESP" '"success":true' "vision full success"
assert_contains "$RESP" '"description"' "description present"
assert_contains "$RESP" '"confidence"' "confidence present"
assert_contains "$RESP" '"model":"mock-vision-v1"' "model version"

VIS_ANALYSIS_ID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['analysis']['analysis_id'])" 2>/dev/null || echo "")
echo "  → Vision analysis_id: $VIS_ANALYSIS_ID"

# OCR only
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$IMG_MEDIA_ID\",\"analysis_type\":\"ocr\"}")
assert_contains "$RESP" '"success":true' "vision ocr success"
assert_contains "$RESP" '"ocr_text"' "ocr_text present"
assert_contains "$RESP" '"analysis_type":"ocr"' "type ocr"

# Objects only
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$IMG_MEDIA_ID\",\"analysis_type\":\"objects\"}")
assert_contains "$RESP" '"detected_objects"' "detected_objects present"

# UI only
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$IMG_MEDIA_ID\",\"analysis_type\":\"ui\"}")
assert_contains "$RESP" '"ui_elements"' "ui_elements present"

# 非图像不能分析
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$AUD_MEDIA_ID\",\"analysis_type\":\"full\"}")
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$AUD_MEDIA_ID\",\"analysis_type\":\"full\"}")
assert_eq "$HTTP_CODE" "400" "rejects audio for vision analysis"

# ============================================================
# 9. 列出 Vision 分析
# ============================================================
echo -e "\n${YELLOW}[9] 列出 Vision 分析${NC}"

RESP=$(curl -s "$BASE_URL/api/multimodal/vision/analyses?limit=20")
assert_contains "$RESP" '"success":true' "list vision analyses success"
assert_contains "$RESP" "$VIS_ANALYSIS_ID" "list contains analysis"

RESP=$(curl -s "$BASE_URL/api/multimodal/vision/analyses?media_id=$IMG_MEDIA_ID&limit=20")
assert_contains "$RESP" "$VIS_ANALYSIS_ID" "filter by media_id"

# ============================================================
# 10. Audio 分析
# ============================================================
echo -e "\n${YELLOW}[10] Audio 分析${NC}"

RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/audio/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$AUD_MEDIA_ID\",\"language_hint\":\"zh-CN\"}")
assert_contains "$RESP" '"success":true' "audio analyze success"
assert_contains "$RESP" '"transcript"' "transcript present"
assert_contains "$RESP" '"language":"zh-CN"' "language zh-CN"
assert_contains "$RESP" '"sentiment"' "sentiment present"
assert_contains "$RESP" '"duration"' "duration present"
assert_contains "$RESP" '"key_segments"' "key_segments present"

AUD_ANALYSIS_ID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['analysis']['analysis_id'])" 2>/dev/null || echo "")
echo "  → Audio analysis_id: $AUD_ANALYSIS_ID"

# 不指定语言
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/audio/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$AUD_MEDIA_ID\"}")
assert_contains "$RESP" '"success":true' "audio analyze without language"

# 非音频不能分析
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/multimodal/audio/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$IMG_MEDIA_ID\"}")
assert_eq "$HTTP_CODE" "400" "rejects image for audio analysis"

# ============================================================
# 11. 列出 Audio 分析
# ============================================================
echo -e "\n${YELLOW}[11] 列出 Audio 分析${NC}"

RESP=$(curl -s "$BASE_URL/api/multimodal/audio/analyses?limit=20")
assert_contains "$RESP" '"success":true' "list audio analyses success"
assert_contains "$RESP" "$AUD_ANALYSIS_ID" "list contains analysis"

RESP=$(curl -s "$BASE_URL/api/multimodal/audio/analyses?media_id=$AUD_MEDIA_ID&limit=20")
assert_contains "$RESP" "$AUD_ANALYSIS_ID" "filter by media_id"

# ============================================================
# 12. 多模态消息
# ============================================================
echo -e "\n${YELLOW}[12] 多模态消息${NC}"

# 纯文本消息
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/chat/send" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"e2e_session_1\",\"text\":\"hello world\",\"uploaded_by\":\"e2e_user\"}")
assert_contains "$RESP" '"success":true' "send text message success"
assert_contains "$RESP" '"role":"user"' "role user"
assert_contains "$RESP" '"text_content":"hello world"' "text preserved"

# 多模态消息
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/chat/send" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"e2e_session_1\",\"text\":\"分析这张图\",\"media_ids\":[\"$IMG_MEDIA_ID\"],\"uploaded_by\":\"e2e_user\"}")
assert_contains "$RESP" '"success":true' "send multimodal message success"
assert_contains "$RESP" "\"$IMG_MEDIA_ID\"" "media ref present"
assert_contains "$RESP" '"reply"' "assistant reply present"

# 列出消息
RESP=$(curl -s "$BASE_URL/api/multimodal/chat/messages/e2e_session_1?limit=20")
assert_contains "$RESP" '"success":true' "list messages success"
assert_contains "$RESP" '"count"' "count present"
assert_contains "$RESP" '"role":"user"' "user messages in list"
assert_contains "$RESP" '"role":"assistant"' "assistant messages in list"

# 无效媒体引用
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/multimodal/chat/send" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"e2e_session_1\",\"text\":\"x\",\"media_ids\":[\"med_invalid\"],\"uploaded_by\":\"e2e_user\"}")
assert_eq "$HTTP_CODE" "400" "rejects invalid media ref"

# ============================================================
# 13. 删除媒体
# ============================================================
echo -e "\n${YELLOW}[13] 删除媒体${NC}"

# 创建测试媒体
TMP_PNG="$TMP_DIR/delete_test.png"
make_png "$TMP_PNG" 200 200
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/upload/image" \
    -F "file=@$TMP_PNG" \
    -F "uploaded_by=delete_user")
DEL_MEDIA_ID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['media']['media_id'])" 2>/dev/null || echo "")

if [ -n "$DEL_MEDIA_ID" ]; then
    # 删除
    RESP=$(curl -s -X DELETE "$BASE_URL/api/multimodal/media/$DEL_MEDIA_ID?uploaded_by=delete_user")
    assert_contains "$RESP" '"success":true' "delete media success"
    assert_contains "$RESP" '"removed":true' "removed true"

    # 验证已删除
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/multimodal/media/$DEL_MEDIA_ID")
    assert_eq "$HTTP_CODE" "404" "deleted media returns 404"
fi

# 跨用户删除被拒
TMP_PNG2="$TMP_DIR/perm_test.png"
make_png "$TMP_PNG2" 200 200
RESP=$(curl -s -X POST "$BASE_URL/api/multimodal/upload/image" \
    -F "file=@$TMP_PNG2" \
    -F "uploaded_by=owner_user")
PERM_MEDIA_ID=$(echo "$RESP" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d['media']['media_id'])" 2>/dev/null || echo "")

if [ -n "$PERM_MEDIA_ID" ]; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$BASE_URL/api/multimodal/media/$PERM_MEDIA_ID?uploaded_by=other_user")
    assert_eq "$HTTP_CODE" "403" "cross-user delete rejected"
fi

# ============================================================
# 14. 错误处理
# ============================================================
echo -e "\n${YELLOW}[14] 错误处理${NC}"

# 无效的 analysis_type
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/api/multimodal/vision/analyze" \
    -H "Content-Type: application/json" \
    -d "{\"media_id\":\"$IMG_MEDIA_ID\",\"analysis_type\":\"invalid_type\"}")
# 422 for validation error or 400
if [ "$HTTP_CODE" = "422" ] || [ "$HTTP_CODE" = "400" ]; then
    assert_eq "$HTTP_CODE" "$HTTP_CODE" "rejects invalid analysis_type"
else
    assert_eq "$HTTP_CODE" "422" "rejects invalid analysis_type"
fi

# ============================================================
# 总结
# ============================================================
echo ""
echo -e "${YELLOW}=== 测试总结 ===${NC}"
echo "通过: $PASS"
echo "失败: $FAIL"
TOTAL=$((PASS + FAIL))
echo "总计: $TOTAL"
PERCENT=$(echo "scale=1; $PASS * 100 / $TOTAL" | bc 2>/dev/null || echo "100.0")
echo "通过率: ${PERCENT}%"

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}✓ 全部通过！${NC}"
    exit 0
else
    echo -e "${RED}✗ 有失败用例${NC}"
    exit 1
fi
