# 智能体生成源代码项目结构化仓库 + 编译运行验证 Spec

## Why
当前 `_run_executing_phase` 把每个模块的 LLM 输出直接落到 `auto_code_ws/Module N/main.py` 这种"分模组平铺"结构，既污染了平台自身的工作区，也完全不是智能体自主决定的项目形态。在全链路评审阶段，用户期望看到的是"智能体真正生成了一个能编译运行的项目"。**关键约束：每个模块的代码文件放置位置应该由 LLM 自主决定**——平台只负责：(1) 在 `/home/qizheng/auto_code_data/<项目同名目录>/` 下创建独立的项目仓库根目录；(2) 在提示词注入这一步告诉 Claude Code CLI 实例中的 LLM "这是代码编写任务"；(3) 让 LLM 自行决定模块的所有代码文件放置位置；(4) 评审阶段调用 `colcon build` + `ros2 launch` 真正跑起来。**不应**硬编码 `src/<pkg>/` 路径前缀（不是所有项目都是 ROS2 包；即使是 ROS2 包也应由 LLM 决定 `src/...` 路径）。

## What Changes
- **新增**: `/home/qizheng/auto_code_data/<项目同名目录>/` 作为智能体生成代码的独立项目根目录（不污染平台工作区 `/home/qizheng/auto_code_ws/`）
- **修改**: `_run_executing_phase` 中 `workspace` 解析逻辑，改为：当用户已新建项目时，定位到 `/home/qizheng/auto_code_data/<项目同名目录>/`；否则降级到 `/home/qizheng/auto_code_data/<new_project_name>/`
- **修改**: LLM 代码合并逻辑：保持多块 `# FILE: <rel_path>` 标记解析，但**移除 `src/<pkg>/` 前缀强制约束**——只要路径在 `<project_root>/` 之内（防路径穿越）就接受
- **修改**: LLM 提示词：明确告诉 LLM "你是代码生成智能体，**自行决定所有代码文件的放置位置**"，而不是建议 ROS2 特定路径
- **移除**: 不再自动生成 ROS2 模板（`package.xml` / `setup.py` / `launch/` / `config/`）——这是 LLM 的职责，不是平台职责
- **新增**: 全链路评审（reviewing 阶段）增加 `build_and_launch` 步骤：探测项目类型（ROS2 colcon / Python package / 其它）后执行编译并尝试启动
- **BREAKING**: 不再向 `/home/qizheng/auto_code_ws/Module*/` 写入任何智能体生成的源代码；现有 `Module 1_output.md`、`Module 2/` 等遗留文件保留（不清除）但不再被新流程使用
- **BREAKING**: 移除了 v5.8.0 早期版本的 `src/<pkg>/` 前缀校验和自动 ROS2 模板生成

## Impact
- Affected specs: 平台项目结构（无现有 spec 匹配，新建）
- Affected code:
  - `/home/qizheng/auto_code_ws/backend/app/services/workflow_engine.py`（`_run_executing_phase` 改造：workspace 解析 + 路径校验放宽 + 不再生成 ROS2 模板）
  - `/home/qizheng/auto_code_ws/backend/app/api/workflow.py`（可能新增 `build_and_launch` 端点）
  - 新增 `/home/qizheng/auto_code_data/` 目录（用户级数据目录）
- 新增依赖: 探测 ROS2 colcon 环境（应在 `/home/qizheng/auto_code_ws/3d_coverage_ws/` 已部署）

## ADDED Requirements

### Requirement: 独立的项目仓库根目录
系统 SHALL 在 `/home/qizheng/auto_code_data/<project_name>/` 下创建独立的项目仓库根目录，与平台工作区 `/home/qizheng/auto_code_ws/` 物理隔离。

#### Scenario: 用户已有同名项目目录
- **WHEN** 用户在 `/home/qizheng/auto_code_data/` 下已存在与当前 session/项目同名的目录
- **THEN** 直接以该目录为项目根目录，**不创建新目录**
- **AND** 智能体生成的所有代码文件落入该目录

#### Scenario: 用户首次创建项目
- **WHEN** `/home/qizheng/auto_code_data/<project_name>/` 不存在
- **THEN** 创建该目录作为项目根目录
- **AND** 不预设任何目录结构（让 LLM 决定）

#### Scenario: 项目名解析
- **WHEN** workflow 关联的 session title 包含中文/英文/数字/下划线
- **THEN** 提取英文字母数字下划线作为目录名；中文部分按拼音首字母或保留为 `project_<id_short>/`
- **AND** 极端情况下 fallback 到 `project_<workflow_id_short>/`

---

### Requirement: LLM 自主决定代码文件放置位置
系统 SHALL 把代码文件放置的最终决定权交给 LLM，**不**硬编码任何特定路径前缀（如 `src/<pkg>/`）。

#### Scenario: LLM 输出含 `# FILE:` 多块标记
- **WHEN** LLM 返回的代码包含 ```python\n# FILE: <rel_path>\n<code>\n``` 多个块
- **THEN** 按标记的相对路径依次写入 `<project_root>/<rel_path>`
- **AND** 标记的路径仅校验：在 `<project_root>/` 之内（防 `..` 路径穿越）、非绝对路径
- **AND** **不**强制路径必须以 `src/<pkg>/` 或任何特定前缀开头
- **AND** **不**自动生成 ROS2 模板文件（`package.xml` / `setup.py` / `launch/` / `config/`）——这些是 LLM 的职责

#### Scenario: LLM 输出不含 `# FILE:` 标记（整段单块）
- **WHEN** LLM 返回的代码只有一个 ```python 块（无 `# FILE:` 标记）
- **THEN** 提取块顶部 docstring 中的模块名作为 `<node_name>`
- **AND** 写入 `<project_root>/<node_name>.py`（项目根目录直接放，不再嵌套 `Module N/`）

#### Scenario: LLM 提示词明确代码生成角色
- **WHEN** 平台注入代码生成提示词给 LLM
- **THEN** 提示词明确说明：
  - "你是一个代码生成智能体"
  - "**你自行决定这个模块所有代码文件的放置位置**"
  - "使用 `# FILE: <rel_path>` 标记每个文件的相对路径（相对于项目根目录）"
  - "可使用 `src/<pkg>/...`、`lib/...`、`pkg/...` 等任何合理路径"
- **AND** 提示词**不**预设 ROS2 包结构（除非 LLM 主动选择）

---

### Requirement: 全链路评审阶段编译并运行
系统 SHALL 在 reviewing 阶段自动探测项目类型并执行编译和运行验证。

#### Scenario: 探测到 ROS2 colcon workspace
- **WHEN** `<project_root>/src/<pkg>/package.xml` 存在（ROS2 ament_python 或 ament_cmake）
- **THEN** 执行 `cd <project_root> && colcon build --packages-select <pkg>`
- **AND** 编译成功后执行 `cd <project_root> && source install/setup.bash && ros2 launch <pkg> <pkg>.launch.py` 后台启动 5 秒
- **AND** 检测 `ros2 node list` 是否包含主节点名

#### Scenario: 探测到纯 Python 项目
- **WHEN** `<project_root>/setup.py` 或 `pyproject.toml` 存在但**没有** ROS2 package.xml
- **THEN** 执行 `cd <project_root> && pip install -e .`（如果 setup.py）或 `python3 -m pip install .`（如果 pyproject.toml）
- **AND** 找到主入口（setup.py 的 entry_points / pyproject.toml 的 [project.scripts]）并尝试后台运行 5 秒
- **AND** 检测进程是否存活

#### Scenario: 探测到无构建系统
- **WHEN** 项目根目录没有 setup.py / pyproject.toml / package.xml
- **THEN** 状态置为 `compile_skipped_no_build_system`
- **AND** WARNING 日志说明项目无可识别的构建系统
- **AND** 跳过编译和运行验证，**不**视为失败

#### Scenario: 编译失败
- **WHEN** 编译命令返回非 0
- **THEN** reviewing 阶段状态为 `failed_compile`
- **AND** 收集编译错误保存到 `workflow.execution_log`
- **AND** commit message 标记 `[compile_failed]`

#### Scenario: 编译成功但运行失败
- **WHEN** 编译 0 但启动后 5 秒内进程退出 / 节点未注册
- **THEN** reviewing 阶段状态为 `compile_ok_run_failed`
- **AND** 收集 stderr 到 `workflow.execution_log`
- **AND** commit message 标记 `[compile_ok_run_failed]`

#### Scenario: 编译成功且运行成功
- **WHEN** 编译 0 且节点注册 / 进程存活
- **THEN** reviewing 阶段最终状态为 `compile_and_run_ok`
- **AND** commit message 包含 `[verified:ran_locally]`

#### Scenario: 环境无 ROS2 / pip
- **WHEN** ROS2 不存在或 pip 不可用
- **THEN** 降级为 `compile_skipped_no_runtime`
- **AND** commit message 标记 `[no_runtime]`

---

### Requirement: 旧乱放文件隔离
系统 SHALL 不再向 `/home/qizheng/auto_code_ws/Module*/` 路径写入任何智能体生成的源代码。

#### Scenario: v5.6.0 旧行为已废弃
- **WHEN** `_run_executing_phase` 被调用
- **THEN** 不创建 `Module 1/`、`Module 2/` 等顶层目录
- **AND** 所有生成代码落到 `<project_root>/<LLM_decided_path>`

#### Scenario: 历史遗留文件保留
- **WHEN** `/home/qizheng/auto_code_ws/Module*/` 已存在历史文件
- **THEN** 不删除、不移动（用户可能需要参考）
- **AND** 这些文件**不参与**新 workflow 的 git commit

---

## MODIFIED Requirements

### Requirement: `_run_executing_phase` workspace 解析（v5.6.0 → v5.9.0）
原 v5.6.0 行为：使用 `git_manager.workspace_path` 或 `os.getcwd()/agent_workspace` 作为根目录，所有文件按 `Module N/main.py` 平铺。
v5.9.0 新行为：
- 第一优先级：`<project_root> = /home/qizheng/auto_code_data/<project_name>/`
- 第二优先级（项目目录不存在）：自动创建 `<project_root>`（不预设任何子目录结构）
- 第三优先级（极端异常）：fallback 到 `/home/qizheng/auto_code_data/project_<workflow_id_short>/` 并 WARNING 日志

`git_manager.workspace_path` 不再作为合法 workspace（与 v5.6.0 行为相反）。

## REMOVED Requirements

### Requirement: 强制 `src/<pkg>/` 路径前缀（v5.8.0 早期版本，已回退）
**Reason**: 用户明确要求"代码文件放置位置应该由 LLM 自主决定"。v5.8.0 早期版本硬编码 `src/<pkg>/` 前缀校验和 ROS2 模板自动生成，这违反了 LLM 自主决定原则。
**Migration**: v5.9.0 移除 `src/<pkg>/` 前缀校验；移除自动生成的 `package.xml` / `setup.py` / `setup.cfg` / `resource/<pkg>` / `<pkg>/__init__.py` / `launch/<pkg>.launch.py` / `config/<pkg>.yaml` / `README.md`（这些都交给 LLM 决定）。如果 LLM 决定做 ROS2 包，它自然会生成 `package.xml`；如果 LLM 决定做纯 Python 项目，它会生成 `setup.py`。

### Requirement: v5.6.0 单一 main.py 平铺模式
**Reason**: 用户明确要求"不应该分模组存放代码，每个模组文件夹内都是直接存放所有代码文件"，应该由 LLM 决定项目结构。
**Migration**: 新行为由 LLM 决定文件位置；旧 `Module N/main.py` 文件保留在 `auto_code_ws/` 不删除，但不再生成新的。
