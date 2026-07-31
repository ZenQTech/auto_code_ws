# Code Modification Log

> 本文件记录本项目的所有代码修改，遵循"全程可追溯"原则。每条修改包含：时间戳、模块、Task ID、角色、操作内容。

## 2026-07-31 | v1.1.0 | 修复 ModuleNotFoundError: No module named 'app'

| 字段 | 内容 |
|------|------|
| **时间戳** | 2026-07-31 16:56:21 |
| **模块** | `/home/qizheng/auto_code_ws/run.py` |
| **Task ID** | BUG-20260731-001 |
| **角色** | 后端工程师 |
| **问题** | `python3 run.py` 启动失败：`ModuleNotFoundError: No module named 'app'` |
| **根因** | `backend/app/api/*.py` 中部分文件（如 `plugins.py`、`marketplace.py`、`goal.py`、`llm_judge.py` 等）使用绝对导入 `from app.xxx import yyy`，而 `run.py` 仅将项目根目录 `/home/qizheng/auto_code_ws/` 加入 `sys.path`。绝对导入要求 `backend/` 目录在 `sys.path` 中以使 `app` 包可解析。 |
| **修复方案** | 在 `run.py` 中将 `backend/` 目录加入 `sys.path`（优先级 0），同时保留项目根目录（用于 `backend.app.main:app` 形式的 uvicorn 入口）。 |
| **修改前** | 仅 `sys.path.insert(0, str(Path(__file__).resolve().parent))` |
| **修改后** | 同时插入 `项目根目录` 与 `backend/` 目录：<br>`sys.path.insert(0, str(_PROJECT_ROOT))`<br>`sys.path.insert(0, str(_PROJECT_ROOT / "backend"))` |
| **验证** | 1. 单测：app.core.plugins 绝对导入 + backend.app.main 入口均成功<br>2. 实测：`python3 run.py` 正常启动 763 个路由<br>3. HTTP：/health 200, /docs 200, /api/workflow/loop-v7/health 200 |
| **影响范围** | 启动脚本，仅影响 `python3 run.py` 入口 |
| **状态** | ✅ 已修复 |

### 修改详情

```python
# /home/qizheng/auto_code_ws/run.py

# 修复前
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backend.app.config import settings

# 修复后
_PROJECT_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(_PROJECT_ROOT))

_BACKEND_DIR = _PROJECT_ROOT / "backend"
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

from backend.app.config import settings
```

### 复用说明

- **可复用片段**：无（仅适用于本项目特定目录结构）
- **触发条件**：当 `from app.xxx` 与 `from backend.app.xxx` 两种导入风格在同一项目共存时，启动脚本必须将两个父目录都加入 `sys.path`
- **适配建议**：统一改为相对导入（`from ..core.plugins import`）可避免此类问题，但需要全量重构

## 历史记录

- 2026-07-24 | v5.8.0 | 智能体心跳超时修复（health_check_interval 30s → 90s）
- 2026-07-24 | v1.2.0 | React Hooks 调用顺序修复（"跳过不确定项"按钮可点击）
- 2026-07-24 | Loop v7 端到端工作流首次完整跑通（warehouse_v7_e2e、agv_fleet_v7_e2e、warehouse_v7_final 三个项目，15 步全部 success=True）
