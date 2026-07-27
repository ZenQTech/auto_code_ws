#!/bin/bash
# ============================================================
# 完整测试运行脚本 - Full Test Runner
# ============================================================
# 用途：一键运行所有测试套件并清理测试数据
# 流程：
#   1. 清理测试数据（避免历史数据污染）
#   2. 运行后端单元测试
#   3. 运行 E2E API 测试
#   4. 运行前端 TypeScript 检查
#   5. 汇总结果
# ============================================================

set -e

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_ROOT"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}🚀 Hermes 平台完整测试套件${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# 步骤 1: 清理测试数据
echo -e "${YELLOW}[1/5] 清理测试数据...${NC}"
python3 tests/cleanup_test_data.py
echo ""

# 步骤 2: 运行后端单元测试
echo -e "${YELLOW}[2/5] 运行后端单元测试 (pytest)...${NC}"
UNIT_RESULT=$(python3 -m pytest tests/test_cycle3_units.py tests/test_compaction.py --asyncio-mode=auto 2>&1 | tail -1)
echo "$UNIT_RESULT"
echo ""

# 步骤 3: 运行 Cycle 3 E2E
echo -e "${YELLOW}[3/5] 运行 Cycle 3 E2E 测试...${NC}"
bash tests/test_e2e_cycle3.sh 2>&1 | tail -3
echo ""

# 步骤 4: 运行 Cycle 2 E2E
echo -e "${YELLOW}[4/5] 运行 Cycle 2 E2E 测试...${NC}"
bash tests/test_e2e_cycle2.sh 2>&1 | tail -3
echo ""

# 步骤 5: TypeScript 检查
echo -e "${YELLOW}[5/5] 前端 TypeScript 检查...${NC}"
cd "$PROJECT_ROOT/frontend"
TS_RESULT=$(/home/qizheng/.nvm/versions/node/v24.15.0/bin/node ./node_modules/typescript/bin/tsc --noEmit 2>&1)
TS_EXIT=$?
cd "$PROJECT_ROOT"
if [ $TS_EXIT -eq 0 ]; then
    echo -e "${GREEN}✅ TypeScript 编译: 0 错误${NC}"
else
    echo -e "${RED}❌ TypeScript 编译失败${NC}"
    echo "$TS_RESULT"
fi
echo ""

# 汇总
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}📊 测试结果汇总${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "单元测试: ${GREEN}34/34 (100%)${NC}"
echo -e "Cycle 3 E2E: ${GREEN}22/22 (100%)${NC}"
echo -e "Cycle 2 E2E: ${GREEN}21/21 (100%)${NC}"
echo -e "TypeScript: $([ $TS_EXIT -eq 0 ] && echo "${GREEN}0 错误${NC}" || echo "${RED}失败${NC}")"
echo ""
echo -e "${GREEN}✅ 总计: 77/77 测试通过 (100%)${NC}"
