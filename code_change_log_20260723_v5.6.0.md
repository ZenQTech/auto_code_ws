# 代码修改日志 — 2026-07-23 v5.6.0 填补 executing→reviewing GAP

## 任务目标

实现 `_run_executing_phase` 方法，填补 Loop Engineering 流水线中
`executing → reviewing` 阶段没有自动 runner 的 GAP，使
`_run_prompting_phase` 推进到 `executing` 后由后台异步任务真正调用
LLM 生成代码、写入工作区、Git 自动提交、并推进到 `reviewing` 阶段。

## 修改文件

- `/home/qizheng/auto_code_ws/backend/app/services/workflow_engine.py`

## 已完成的任务

### 1. 新增 `_run_executing_phase` 方法（约 355 行）
- 方法签名：`async def _run_executing_phase(self, workflow_id: str) -> Dict[str, Any]`
- 完整中文 docstring（核心作用、调用方、被调用方、运行步骤、参数、返回值）
- 实现 6 步流程：
  1. 加载 workflow 记录，解析 `__PROMPTS__:` JSON 段
  2. 确定工作区路径（`git_manager.workspace_path` → `repo_path` → 兜底 `agent_workspace`）
  3. 对每个模块构造代码生成 Prompt（要求 `# FILE: path` 标记格式）并
     通过 `self.hermes_service.executor.execute(command='-p "..."', timeout=180)`
     调用真实 LLM
  4. 解析 LLM 输出中的 ```python\n# FILE: ...\n...\n```  块，按路径
     安全检查后写入工作区（兜底：整段保存为 `<module>_output.md`）
  5. 自动 Git 提交（`auto_commit` 异步 / 同步版均有适配，失败时降级为
     `subprocess.run("git add -A && git commit -m ...")`）
  6. 标记 executing 阶段为 COMPLETED，调用 `advance_stage` 推进到 reviewing

### 2. 调度 `_run_executing_phase` 后台任务（`_run_prompting_phase` 末尾）
- 在 `_run_prompting_phase` 完成 `advance_stage(workflow_id)` 推进到
  `executing` 之后，添加：
  - 主路径：`asyncio.create_task(self._run_executing_phase(workflow_id))`
  - 降级路径：`RuntimeError` 时 `await self._run_executing_phase(workflow_id)`
- 完整中文注释说明 v5.6.0 修复目的

### 3. 更新文件头修改记录
- 新增条目：
  `- 2026-07-23 | v5.6.0 | 新增 _run_executing_phase 真实 LLM 代码生成：填补
   executing→reviewing 自动推进 GAP；...`
- 位置：原 v5.1.0 条目之后

## 关键设计约束

- **真实 LLM 调用**：未引入任何模板兜底（LLM 输出无 `# FILE:` 标记时仅
  整段保存为 `.md` 文档，不替换为模板代码）
- **路径安全**：使用 `rel_path.replace("..", "_").lstrip("/")` 防止
  路径穿越攻击
- **错误隔离**：每个模块独立 try/except，单个失败不影响其他模块
- **优雅降级**：所有外部依赖（executor、git_manager）均做可用性检查
- **资源清理**：所有会话使用 `async with self.session_factory() as db` 上下文

## 验证结果

1. 语法检查：`python3 -m py_compile backend/app/services/workflow_engine.py` → OK
2. 导入检查：`from backend.app.services.workflow_engine import WorkflowEngine` → OK
3. 方法存在：`hasattr(WorkflowEngine, '_run_executing_phase')` → True
4. 签名正确：`(self, workflow_id: str) -> Dict[str, Any]`，`iscoroutinefunction` → True
5. 调度代码存在：`asyncio.create_task(self._run_executing_phase(workflow_id))` 已插入
6. 头注释更新：v5.6.0 修改记录已添加

## 未完成 / 遗留任务

- 无
