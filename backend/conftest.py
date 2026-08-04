"""
# ============================================================
# pytest 全局配置
# ====================================
# 核心作用：
#   1. 将项目根目录添加到 sys.path，使得 cli_integration.executor 等外部模块可以被正确导入
#   2. 为所有测试提供统一的路径配置
# 输入参数：无
# 输出结果：修改 sys.path
# ====================================
# 修改记录：
#   - 2026-08-04 | v1.0.0 | Cycle 64 G64 创建 conftest.py 以解决全量测试收集时的 ImportError
# ====================================
"""

import sys
from pathlib import Path

# 项目根目录
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))
