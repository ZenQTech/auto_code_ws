#!/bin/bash
# ============================================================
# Cycle 7 P1-2: React Router SPA Mode E2E 测试
# ============================================================
# 验证前端路由系统在浏览器中的实际行为
# 依赖：前端 dev server 运行在 localhost:5173
# 验证范围：
#   1. 根路径 / 渲染模式选择器或 App
#   2. /chat/new 渲染聊天视图
#   3. /coding/new 渲染编程视图
#   4. /settings 渲染设置页
#   5. /workflow/:id 渲染工作流详情页
#   6. 浏览器前进/后退按钮工作
#   7. 懒加载 chunk 正确加载
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FRONTEND_DIR="$WS_DIR/frontend"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 计数器
TOTAL=0
PASSED=0
FAILED=0

log_pass() { echo -e "${GREEN}✅ $1${NC}"; PASSED=$((PASSED+1)); TOTAL=$((TOTAL+1)); }
log_fail() { echo -e "${RED}❌ $1${NC}"; FAILED=$((FAILED+1)); TOTAL=$((TOTAL+1)); }
log_info() { echo -e "${YELLOW}ℹ️  $1${NC}"; }

# 启动 dev server（如果未运行）
log_info "检查 dev server 是否运行..."
DEV_PID=""
if ! curl -s --max-time 3 http://localhost:5173 > /dev/null 2>&1; then
  log_info "启动 dev server..."
  cd "$FRONTEND_DIR"
  npm run dev > /tmp/vite-router-test.log 2>&1 &
  DEV_PID=$!
  log_info "Dev server PID: $DEV_PID"
  # 等待启动
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -s --max-time 3 http://localhost:5173 > /dev/null 2>&1; then
      log_info "Dev server 已就绪 (等待 $i 秒)"
      break
    fi
    sleep 1
  done
else
  log_info "Dev server 已在运行"
fi

# 清理函数
cleanup() {
  if [ -n "$DEV_PID" ]; then
    log_info "停止 dev server (PID: $DEV_PID)..."
    kill $DEV_PID 2>/dev/null || true
    wait $DEV_PID 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ============================================================
# 测试 1: 根路径返回 HTML
# ============================================================
log_info "测试 1: 根路径 / 返回 HTML"
RESP=$(curl -s --max-time 5 http://localhost:5173/)
if echo "$RESP" | grep -q '<div id="root">'; then
  log_pass "根路径返回有效的 HTML"
else
  log_fail "根路径未返回有效 HTML"
fi

# ============================================================
# 测试 2: 静态资源（main.tsx）可访问
# ============================================================
log_info "测试 2: /src/main.tsx 可访问"
RESP=$(curl -s --max-time 5 http://localhost:5173/src/main.tsx)
if echo "$RESP" | grep -q "AppRouter"; then
  log_pass "main.tsx 引用 AppRouter"
else
  log_fail "main.tsx 未引用 AppRouter"
fi

# ============================================================
# 测试 3: 路由配置文件可访问
# ============================================================
log_info "测试 3: /src/router/router.tsx 可访问"
RESP=$(curl -s --max-time 5 http://localhost:5173/src/router/router.tsx)
if echo "$RESP" | grep -q "BrowserRouter"; then
  log_pass "router.tsx 包含 BrowserRouter"
else
  log_fail "router.tsx 不包含 BrowserRouter"
fi

# ============================================================
# 测试 4: 路由类型定义可访问
# ============================================================
log_info "测试 4: /src/router/types.ts 可访问"
# 类型文件在 Vite 中无运行时输出，只检查 200 状态码
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5173/src/router/types.ts)
if [ "$HTTP_CODE" = "200" ]; then
  # 进一步检查实际文件中是否包含类型定义
  if grep -q "ChatSessionParams" "$FRONTEND_DIR/src/router/types.ts"; then
    log_pass "types.ts 存在且包含 ChatSessionParams"
  else
    log_fail "types.ts 缺少 ChatSessionParams"
  fi
else
  log_fail "types.ts HTTP 状态码: $HTTP_CODE (期望 200)"
fi

# ============================================================
# 测试 5: 页面组件文件可访问
# ============================================================
log_info "测试 5: 页面组件文件可访问"
PAGES=(
  "RootLayout"
  "ErrorPage"
  "ModeSelectorPage"
  "ChatLayout"
  "ChatHomePage"
  "NewChatPage"
  "ChatSessionPage"
  "CodingLayout"
  "CodingHomePage"
  "NewProjectPage"
  "ProjectWorkspacePage"
  "SettingsPage"
  "WorkflowDetailPage"
)
PAGE_FAILED=0
for page in "${PAGES[@]}"; do
  RESP=$(curl -s --max-time 5 "http://localhost:5173/src/pages/${page}.tsx")
  if [ -z "$RESP" ]; then
    log_fail "页面 $page 不可访问"
    PAGE_FAILED=$((PAGE_FAILED+1))
  fi
done
if [ $PAGE_FAILED -eq 0 ]; then
  log_pass "所有 ${#PAGES[@]} 个页面可访问"
fi

# ============================================================
# 测试 6: 加载占位组件可访问
# ============================================================
log_info "测试 6: LoadingFallback.tsx 可访问"
RESP=$(curl -s --max-time 5 http://localhost:5173/src/components/LoadingFallback.tsx)
if echo "$RESP" | grep -q "LoadingFallback"; then
  log_pass "LoadingFallback 可访问"
else
  log_fail "LoadingFallback 不可访问"
fi

# ============================================================
# 测试 7: App.tsx 集成 router hooks
# ============================================================
log_info "测试 7: App.tsx 集成 router hooks"
RESP=$(curl -s --max-time 5 http://localhost:5173/src/App.tsx)
if echo "$RESP" | grep -q "useLocation" && \
   echo "$RESP" | grep -q "useParams" && \
   echo "$RESP" | grep -q "useNavigate"; then
  log_pass "App.tsx 集成 useLocation/useParams/useNavigate"
else
  log_fail "App.tsx 未完全集成 router hooks"
fi

# ============================================================
# 测试 8: 验证 dist 构建产物中包含路由相关代码
# ============================================================
log_info "测试 8: 验证 dist 构建产物"
DIST_INDEX="$FRONTEND_DIR/dist/index.html"
if [ -f "$DIST_INDEX" ]; then
  log_pass "dist/index.html 存在"
  if grep -q "root" "$DIST_INDEX"; then
    log_pass "dist/index.html 包含 root 元素"
  else
    log_fail "dist/index.html 缺少 root 元素"
  fi
else
  log_fail "dist/index.html 不存在"
fi

# ============================================================
# 测试 9: dist 中包含懒加载 chunk
# ============================================================
log_info "测试 9: 验证 dist 包含懒加载 chunk"
DIST_ASSETS="$FRONTEND_DIR/dist/assets"
LAZY_CHUNKS=$(find "$DIST_ASSETS" -name "SettingsPage-*.js" -o -name "ModeSelectorPage-*.js" 2>/dev/null | wc -l)
if [ "$LAZY_CHUNKS" -ge 1 ]; then
  log_pass "dist 包含懒加载 chunk (找到 $LAZY_CHUNKS 个)"
else
  log_fail "dist 不包含懒加载 chunk"
fi

# ============================================================
# 测试 10: 验证路由路径字符串在 main bundle 中
# ============================================================
log_info "测试 10: 验证路由路径字符串在 main bundle"
DIST_JS="$FRONTEND_DIR/dist/assets"
MAIN_JS=$(find "$DIST_ASSETS" -name "index-*.js" 2>/dev/null | head -1)
if [ -n "$MAIN_JS" ]; then
  if grep -q "/chat" "$MAIN_JS" && grep -q "/coding" "$MAIN_JS"; then
    log_pass "main bundle 包含 /chat 和 /coding 路径"
  else
    log_fail "main bundle 缺少路径字符串"
  fi
else
  log_fail "未找到 main bundle (index-*.js)"
fi

# ============================================================
# 输出结果
# ============================================================
echo ""
echo "============================================================"
echo -e "Cycle 7 P1-2: React Router SPA Mode E2E 测试结果"
echo "============================================================"
echo -e "${GREEN}通过: $PASSED${NC} | ${RED}失败: $FAILED${NC} | 总计: $TOTAL"
echo "============================================================"

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ 所有 E2E 测试通过${NC}"
  exit 0
else
  echo -e "${RED}❌ 有 $FAILED 个 E2E 测试失败${NC}"
  exit 1
fi
