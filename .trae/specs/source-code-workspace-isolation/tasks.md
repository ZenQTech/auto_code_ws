# Tasks

- [x] **Task 1: 创建项目仓库根目录解析工具**
  - [x] SubTask 1.1: 在 `backend/app/services/source_project_resolver.py` 新建模块，实现 `resolve_project_root(workflow_id, session_id, title) -> Path` 函数
  - [x] SubTask 1.2: 解析规则：先查 `/home/qizheng/auto_code_data/<sanitized_title>/`；不存在则查 `/home/qizheng/auto_code_data/project_<wf_id_short>/`；都不存在则**创建空目录**（v5.9.0：不再预设 src/ 或 .ros2_workspace 标记）
  - [x] SubTask 1.3: 验证 `pathlib.Path` 路径存在性、目录创建权限；v5.9.0 同时实现 `detect_project_type` / `find_ros2_package` / `find_python_entry_point` 三个辅助函数

- [x] **Task 2: 修改 `_run_executing_phase` 写入逻辑（v5.9.0：让 LLM 自主决定）**
  - [x] SubTask 2.1: 把 `workspace` 解析改为调用 `source_project_resolver.resolve_project_root(...)`
  - [x] SubTask 2.2: 改 LLM 提示词：明确告诉 LLM "你是一个代码生成智能体，**你自行决定所有代码文件的放置位置**"，列举 ROS2 ament_python / ament_cmake / 纯 Python 等多种可能
  - [x] SubTask 2.3: 路径校验只保留防 `..` 路径穿越和绝对路径；**移除** v5.8.0 早期版本的 `src/<pkg>/` 前缀强制约束
  - [x] SubTask 2.4: 无 `# FILE:` 标记时，提取 docstring 头部的模块名，写到 `<project_root>/<name>.py`（项目根目录直接放，不再嵌套 `Module N/`）
  - [x] SubTask 2.5: 验证写入文件大小、字符数、Python 语法 `python3 -m py_compile`

- [x] **Task 3: 移除 ROS2 模板自动生成（v5.9.0：让 LLM 决定）**
  - [x] SubTask 3.1: 删除 `_run_executing_phase` 中的 Step 3.5 ROS2 模板生成块（package.xml / setup.py / setup.cfg / resource/<pkg> / __init__.py / launch/<pkg>.launch.py / config/<pkg>.yaml / README.md 全部不再自动生成）
  - [x] SubTask 3.2: 删除模块级辅助函数 `_generate_package_xml_template` / `_generate_setup_py_template` / `_generate_launch_template` 和 `__getattr__`
  - [x] SubTask 3.3: 验证：`_pkg_name = None`（允许 LLM 自主决定）；commit message 改为 v5.9.0

- [ ] **Task 4: reviewing 阶段增加 build_and_launch 验证**
  - [ ] SubTask 4.1: 在 `workflow_engine.py` 新增 `_run_reviewing_phase(workflow_id)` 方法
  - [ ] SubTask 4.2: 调用 `source_project_resolver.detect_project_root(workspace)` 探测项目类型（ros2_ament_python / ros2_ament_cmake / python_setup_py / python_pyproject / unknown）
  - [ ] SubTask 4.3: ROS2 项目：执行 `colcon build --packages-select <pkg>` + `ros2 launch <pkg> <pkg>.launch.py` 后台启动 5 秒
  - [ ] SubTask 4.4: 纯 Python 项目：执行 `pip install -e .` + 找 entry_point 后台运行 5 秒
  - [ ] SubTask 4.5: 未知项目：状态 `compile_skipped_no_build_system`，跳过验证（**不**视为失败）
  - [ ] SubTask 4.6: 在 `_run_prompting_phase` 末尾调度 `asyncio.create_task(self._run_reviewing_phase(workflow_id))`

- [ ] **Task 5: git commit 路径改到项目仓库**
  - [ ] SubTask 5.1: 验证 v5.7.0 的 `feature/auto-code-<wf_short>` 分支创建逻辑在 `<project_root>`（即 `/home/qizheng/auto_code_data/.../`）而非 `auto_code_ws/` 工作
  - [ ] SubTask 5.2: 验证：如果 `<project_root>` 还没初始化为 git 仓库，先 `git init`
  - [ ] SubTask 5.3: commit message 已更新为 v5.9.0 标识

- [ ] **Task 6: 端到端验证（参考 3d_coverage_ws 智能体自由发挥）**
  - [ ] SubTask 6.1: 复用已有 v8 工作流（`ebe3570c-11f8-4004-bf25-d79341c81423`），手动 push 到 reviewing 阶段
  - [ ] SubTask 6.2: 验证 7 个模块的代码由 LLM **自主决定**放置位置（可能 `src/<pkg>/...`、可能 `lib/...`、可能 `pkg/...` 等）
  - [ ] SubTask 6.3: 验证**不**再生成 `Module 1_output.md`、`Module 2/` 等 v5.6.0 旧结构
  - [ ] SubTask 6.4: 验证 `package.xml`、`setup.py`、`launch/`、`config/` 由 LLM 决定是否生成（不强制）
  - [ ] SubTask 6.5: 验证 git commit 落在 `/home/qizheng/auto_code_data/<project>/.git/`，分支名为 `feature/auto-code-<wf_short>`
  - [ ] SubTask 6.6: 写一个 e2e smoke test 脚本 `tests/test_source_project_structure.py`，可被未来回归测试使用

# Task Dependencies
- [Task 2] depends on [Task 1]（解析工具必须先有，executing_phase 才能用）
- [Task 3] depends on [Task 2]（v5.9.0：移除模板生成是 Step 2 改造的自然结果）
- [Task 4] depends on [Task 1, 2]（必须先有 `detect_project_type` + LLM 写入完整代码才能验证）
- [Task 5] depends on [Task 1, 2]（commit 路径依赖项目目录的最终结构）
- [Task 6] depends on [Task 1, 2, 3, 4, 5]（必须所有前面的实现都完成才能跑端到端验证）
