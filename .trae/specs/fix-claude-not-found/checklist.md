# Checklist: 修复 CLIExecutor 找不到 claude 命令 Bug

> **基于 Spec**: [spec.md](file:///home/qizheng/auto_code_ws/.trae/specs/fix-claude-not-found/spec.md)

---

## 核心修复

- [x] `BaseCLIExecutor._resolve_executable` 静态方法已实现
- [x] 标准 PATH 中的命令能被 `shutil.which` 找到并解析
- [x] nvm 目录 `~/.nvm/versions/node/*/bin/` 能被自动遍历
- [x] `~/.local/bin/`、`/usr/local/bin/`、npm 全局目录能被搜索
- [x] 深度 5 搜索 `~` 下的可执行文件作为兜底
- [x] 完全找不到时保留原值并打 WARN 日志
- [x] `_get_process_env` 中将发现的 bin 目录合并到 PATH

## 配置更新

- [x] `backend/app/config.py` 中 `cli.executable` 有注释说明
- [x] `config/auto_code_config.yaml` 中 `cli.executable` 有注释

## 测试覆盖

- [x] 绝对路径透传测试通过
- [x] 标准 PATH 命令解析测试通过
- [x] 模拟 nvm 目录自动发现测试通过
- [x] 找不到时 WARN 日志测试通过
- [x] subprocess 继承 PATH 测试通过
- **总计**: `pytest tests/test_executor_path.py -v` → **11 passed in 1.30s**

## 回归测试

- [x] 后端服务能正常启动（启动日志含 `CLI 可执行文件已解析: claude -> /home/qizheng/.nvm/versions/node/v24.15.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe`）
- [x] `/api/hermes/optimize` POST **不再返回 "claude: not found"**（`claude.exe 命令执行成功，耗时 45.11s`）
- [x] 响应证据 `09c_hermes_after_fix.json` 已保存

## 闭环

- [x] `online-runtime-testing/checklist.md` 中 Bug 3 已标记修复（附 fix-claude-not-found 引用）

## 验收刚性标准

> **判定本 Bug 修复任务完成必须同时满足**：
> 1. 单元测试全部通过 → **✅ 11/11 通过**
> 2. `/api/hermes/optimize` POST 不再返回 "claude not found" → **✅ claude 实际执行 45.11 秒**
> 3. 重启后端服务后，online-runtime-testing 中的 Bug 3 描述与现状不符 → **✅ 闭环登记已更新**
