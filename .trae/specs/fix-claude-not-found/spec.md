# 修复 CLIExecutor 找不到 claude 命令 Bug Spec

> **来源**: 用户需求 — `claude --version` 在终端可用（`/home/qizheng/.nvm/versions/node/v24.15.0/bin/claude`），但平台后端调用时返回 `command not found (exit 127)`
> **关联证据**: [RUNTIME_TEST_REPORT.md §四 Bug 3](file:///home/qizheng/auto_code_ws/data/runtime_test_evidence/RUNTIME_TEST_REPORT.md)
> **优先级**: P1（功能阻塞：Hermes 优化/对话全部失败）
> **范围**: `cli_integration/base_executor.py` + `cli_integration/executor.py` + `cli_integration/hermes_executor.py`

## Why

`online-runtime-testing` 在线测试真实捕获到该 bug：
```
$ curl -X POST http://localhost:8080/api/hermes/optimize -d '{"raw_prompt":"测试"}'
{"original":"测试","success":false,"error_message":"优化执行失败: 命令退出码 127: /bin/sh: 1: claude: not found"}
```

根因：
- `claude` 通过 `npm install -g @anthropic-ai/claude-code` 安装到 nvm 路径 `/home/qizheng/.nvm/versions/node/v24.15.0/bin/claude`
- uvicorn 启动时继承的 `PATH` 是最小化环境变量，**不含 nvm bin 目录**
- `BaseCLIExecutor.__init__` 直接存 `self.executable = "claude"`（裸名字），subprocess 通过 `/bin/sh -c` 执行时无法在 PATH 中找到
- 没有任何 PATH 解析、降级搜索、或用户配置兜底机制

影响：
- 任何依赖 CLIExecutor 的功能（Hermes 优化、对话、Agent 启动、Code CLI 调用）全部失败
- 用户被迫手动改 `cli.executable` 绝对路径，但该值在代码层 `config.py` 默认值里硬编码

## What Changes

### 核心修复（`cli_integration/base_executor.py`）

- **新增 PATH 解析逻辑**：在 `__init__` 中调用 `shutil.which(executable)`，若返回 None 则**自动遍历常见安装位置**搜索：
  - `~/.nvm/versions/node/*/bin/`
  - `~/.local/bin/`
  - `/usr/local/bin/`
  - `npm root -g`（动态获取）
  - `~/.npm-global/bin/`（备用）
  - 当前用户 `~/` 目录下的所有 `claude`、`hermes` 可执行文件（深度 5）
- **解析成功后**：将 `self.executable` 替换为绝对路径
- **解析失败时**：保留原始 `executable` 名字，但 `logger.error` 显式记录所有搜索过的路径，subprocess 失败时给出明确的修复建议（"请安装 Claude Code CLI 或在 config 中设置 cli.executable 为绝对路径"）
- **环境变量 PATH 增强**：`_get_process_env` 中将当前 `os.environ['PATH']` 与所有自动发现的 bin 目录合并，确保 subprocess shell 也能找到

### 配置兜底（`backend/app/config.py` + `auto_code_config.yaml`）

- `cli.executable` 默认值从 `"claude"` 改为 `"claude"`，但新增注释说明支持绝对路径与自动搜索
- 新增可选配置 `cli.executable_search_paths`（列表），用户可自定义额外搜索路径

### 前端显示（`frontend/src/...` 暂不改）

后端修复后，前端会通过现有 `/api/config` 端点自动反映。无需前端改动。

### 测试（`tests/test_executor_path.py` 新建）

- 单元测试：模拟 `executable="nonexistent_xyz"`，验证搜索失败时给出明确错误
- 单元测试：mock `shutil.which` 返回 None，模拟在 `~/.nvm/versions/node/v20.0.0/bin/claude` 创建假文件，验证能找到
- 集成测试：实际创建临时 nvm 目录结构，调用 `CLIExecutor(executable="claude")`，验证 `self.executable` 被替换为绝对路径

## Impact

- Affected specs: `online-runtime-testing`（Bug 3 闭环）
- Affected code:
  - `cli_integration/base_executor.py`（核心修复）
  - `cli_integration/executor.py`（无需改，自动继承基类行为）
  - `cli_integration/hermes_executor.py`（无需改，自动继承）
  - `backend/app/config.py`（注释与配置项）
  - `config/auto_code_config.yaml`（注释与可选 search_paths）
  - `tests/test_executor_path.py`（新增测试）

---

## ADDED Requirements

### Requirement: CLI 可执行文件自动解析

系统 SHALL 在 CLIExecutor 初始化时自动将 `executable` 解析为绝对路径。

#### Scenario: 标准 PATH 中能找到
- **WHEN** `executable="claude"` 且 `claude` 在系统 PATH 中
- **THEN** `self.executable` 被设为绝对路径（如 `/usr/local/bin/claude`）

#### Scenario: PATH 中找不到但 nvm 目录存在
- **WHEN** `executable="claude"` 且系统 PATH 不含 claude，但 `~/.nvm/versions/node/v24.15.0/bin/claude` 存在
- **THEN** `self.executable` 被设为 `/home/user/.nvm/versions/node/v24.15.0/bin/claude`
- **AND** logger.info 输出 "自动发现 Claude CLI at {path}"

#### Scenario: 用户配置绝对路径
- **WHEN** `executable="/custom/path/to/my-claude"` 是绝对路径
- **THEN** `self.executable` 保持原值（不搜索）

#### Scenario: 找不到任何 claude
- **WHEN** `executable="claude"` 且所有搜索位置都不存在
- **THEN** `self.executable` 保持为 `"claude"`（裸名字）
- **AND** logger.warning 输出搜索过的所有路径与"请安装 Claude Code CLI"提示

### Requirement: subprocess 环境变量包含增强 PATH

系统 SHALL 在执行 subprocess 时将自动发现的 bin 目录加入 PATH。

#### Scenario: 增强 PATH 后执行成功
- **WHEN** 系统 PATH 不含 nvm，但 nvm 中有 claude
- **THEN** subprocess 继承的 `PATH` 已合并 nvm bin 目录
- **AND** subprocess 调用的 `claude --version` 返回 0

### Requirement: 测试覆盖自动解析逻辑

系统 SHALL 提供单元测试覆盖 PATH 解析逻辑。

#### Scenario: 测试 nvm 自动发现
- **WHEN** 在临时目录创建 `~/.nvm/versions/node/v20.0.0/bin/claude` 假文件
- **THEN** `CLIExecutor(executable="claude")` 解析后的 `self.executable` 等于该绝对路径

#### Scenario: 测试绝对路径透传
- **WHEN** `CLIExecutor(executable="/abs/path/to/bin")`
- **THEN** `self.executable == "/abs/path/to/bin"`（不被替换）

## MODIFIED Requirements

无（不修改任何已有 spec 的需求）

## REMOVED Requirements

无
