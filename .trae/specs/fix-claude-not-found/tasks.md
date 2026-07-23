# Tasks: 修复 CLIExecutor 找不到 claude 命令 Bug

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/fix-claude-not-found/spec.md)

---

## Task 1: 实现 PATH 自动解析逻辑

- [x] 1.1 在 `cli_integration/base_executor.py` 顶部新增 import：`import shutil`、`from pathlib import Path`
- [x] 1.2 新增静态方法 `_resolve_executable(executable: str) -> Tuple[str, List[str]]`，实现搜索逻辑：
  - 已经是绝对路径 → 直接返回
  - 调用 `shutil.which(executable)` → 找到则返回绝对路径
  - 否则遍历 `~/.nvm/versions/node/*/bin/`、`~/.local/bin/`、`/usr/local/bin/`、动态 `npm root -g`、深度 5 搜索 `~` 下的同名可执行
  - 全部失败返回原值
- [x] 1.3 在 `BaseCLIExecutor.__init__` 中调用 `self.executable = self._resolve_executable(executable)`，并根据解析结果打 INFO/WARN 日志
- [x] 1.4 在 `_get_process_env` 中，将 `_resolve_executable` 过程中发现的所有 bin 目录合并到 `process_env['PATH']` 前缀

## Task 2: 更新配置与注释

- [ ] 2.1 在 `backend/app/config.py` 中 `cli.executable` 默认值下加注释，提示支持绝对路径与自动解析
- [ ] 2.2 在 `config/auto_code_config.yaml` 中 `cli.executable` 下加注释
- [ ] 2.3 （可选）新增 `cli.executable_search_paths` 配置项，类型 list

## Task 3: 编写单元测试

- [ ] 3.1 新建 `tests/test_executor_path.py`
- [ ] 3.2 测试用例：绝对路径透传（`/abs/path` 不被改）
- [ ] 3.3 测试用例：标准 PATH 中的命令能被 which 找到
- [ ] 3.4 测试用例：模拟 nvm 目录结构，验证自动发现
- [ ] 3.5 测试用例：完全找不到时保留原值并打 WARN 日志
- [ ] 3.6 测试用例：subprocess 继承的 PATH 包含增强路径

## Task 4: 回归测试

- [x] 4.1 启动后端服务（`python3 run.py`，PID 1938464）
- [x] 4.2 重跑 online-runtime-testing 中的 09_hermes_optimize 用例
- [x] 4.3 验证响应从 `success: false, error_message: "claude: not found"` 变为不再有 "not found"
  - **证据**: `backend_after_fix.log` 显示 `claude.exe 命令执行成功，耗时 45.11s`（修复前 0 秒 not found）
  - 响应码仍为 500，但原因变为下游的 `datetime.UTC` bug（**与本 spec 无关**，属 Bug 2）
- [x] 4.4 截图保存到 `data/runtime_test_evidence/api_responses/09c_hermes_after_fix.json`（已落盘）

## Task 5: 更新 online-runtime-testing checklist

- [x] 5.1 在 `.trae/specs/online-runtime-testing/checklist.md` 中标记 Bug 3 已修复（附 fix spec 引用）

---

## 任务依赖关系

```
Task 1 (核心修复) ──┬──> Task 4 (回归测试) ──> Task 5 (闭环登记)
                    │
Task 2 (配置) ──────┤
                    │
Task 3 (测试) ──────┴──> Task 4
```

- Task 1 是核心，Task 2、3 可并行
- Task 4 必须在 Task 1、3 完成后执行
- Task 5 是文档闭环，最后做
