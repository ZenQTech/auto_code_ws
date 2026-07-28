# Cycle 9 P1-7 DiffView 增强 — 任务总结

## 概述

在 Cycle 9 P1-7 阶段，针对 Code Review 流程中的 DiffView 组件实施企业级增强，实现多格式 diff 输出、工作区快照管理、任意 ref 对比、行级 inline 解析与暂存控制等核心能力，与 Codex v0.140+ / TRAE Solo v3.5+ 的 DiffView 体验对齐。

## 交付物

| 文件 | 行数 | 角色 | 版本 |
|---|---|---|---|
| `backend/app/services/diff_view.py` | 1018 | 核心服务（多格式 diff + 快照 + ref 对比 + 暂存） | v1.0.0 |
| `backend/app/api/diff_view.py` | 320 | REST API 路由（11 个端点） | v1.0.0 |
| `tests/test_diff_view_units.py` | 880 | 单元测试（71 个用例） | v1.0.0 |
| `tests/test_e2e_diff_view.sh` | 510 | E2E 测试（15 个测试模块，90 个断言） | v1.0.0 |
| `backend/app/main.py` | +8 | 路由注册（v6.7.0 升级） | v6.7.0 |

## 核心特性

### 1. 多格式 diff 输出

支持 4 种输出格式，覆盖现代 IDE / Code Review 工具主流需求：

| 格式 | API 值 | 用途 |
|---|---|---|
| Unified | `unified` | 标准 unified diff 文本，兼容 git/Codex CLI 输出 |
| Side-by-Side | `side_by_side` | 并排双列 diff，left/right 同步渲染 |
| JSON Patch | `json_patch` | RFC 6902 风格的 op/line/content 结构化输出 |
| Stats | `stats` | 仅统计信息（文件数/新增/删除），轻量级 |

### 2. 三类 diff 场景

| 场景 | 端点 | 描述 |
|---|---|---|
| 工作区 diff | `POST /api/diff-view/workspace` | 当前工作区未暂存或已暂存的修改 |
| 任意 ref 对比 | `POST /api/diff-view/compare` | commit / branch / tag 之间的差异 |
| 快照对比 | `POST /api/diff-view/snapshot-vs-worktree` | 快照与当前工作区的差异 |

### 3. 完整快照管理

| 操作 | 端点 | 描述 |
|---|---|---|
| 创建快照 | `POST /api/diff-view/snapshots` | 支持 label/description/glob 过滤 |
| 列出快照 | `GET /api/diff-view/snapshots?project_path=...` | 倒序排列（最新优先） |
| 恢复快照 | `POST /api/diff-view/snapshots/{id}/restore` | 覆盖工作区文件 |
| 删除快照 | `DELETE /api/diff-view/snapshots/{id}` | 同时清理磁盘 |

- 存储：`<project>/.diffview/snap_<id>/{metadata.json, files/}`
- 容量：单项目最大 200 个快照，超限自动淘汰最早
- 单文件大小限制：50MB（可配置）
- 排除目录：`.git / .diffview / __pycache__ / node_modules`

### 4. 暂存控制

| 操作 | 端点 | Git 命令 |
|---|---|---|
| 暂存文件 | `POST /api/diff-view/stage` | `git add -- <path>` |
| 取消暂存 | `POST /api/diff-view/unstage` | `git reset HEAD -- <path>` |
| 全部暂存 | `POST /api/diff-view/stage-all` | `git add -A` |

### 5. 行级 patch 解析

- 自动识别 `+++` / `---` / `@@` / `+` / `-` / `\` 行首标记
- 跟踪 `old_line_no` / `new_line_no`（基于 hunk header）
- 区分 add / del / ctx / meta 四种 line_type
- 支持复杂多 hunk 场景

### 6. 安全与健壮性

- 路径白名单：`_normalize_path` 拒绝项目外 / 路径越界（`../`）
- Pydantic 校验：`file_path` 限制 `1..1024` 字符
- 线程安全：`SnapshotManager` / `DiffViewService` 均使用 `RLock`
- 异常隔离：每个端点 try/except 兜底，避免栈追踪泄漏
- Git 容错：`subprocess.run` + `timeout` 保护 + 详细错误码

## 测试覆盖

### 单元测试（71/71 通过）

- **测试维度 1：数据模型与常量**（8 tests）— 枚举值、Dataclass 序列化、常量边界
- **测试维度 2：工具函数**（10 tests）— `_normalize_path` / `_safe_relpath` / `_file_sha256` / `_now_iso` 边界
- **测试维度 3：行级 patch 解析**（6 tests）— add/del/ctx/meta 解析 + hunk header + 复杂多行
- **测试维度 4：并排视图构造**（4 tests）— 上下文/删除/新增/meta 行渲染
- **测试维度 5：JSON Patch 构造**（4 tests）— add/remove/mixed op
- **测试维度 6：多文件 diff 拆分**（3 tests）— 单文件/多文件/空
- **测试维度 7：untracked patch 构造**（1 test）— 完整 patch 输出
- **测试维度 8：快照管理**（8 tests）— create/list/get/restore/delete + 异常路径
- **测试维度 9：工作区 diff**（8 tests）— 4 种格式 + path_filter + status_filter + staged
- **测试维度 10：任意 ref 对比**（3 tests）— HEAD~1/HEAD + identical + empty args
- **测试维度 11：快照 vs 工作区**（4 tests）— modified/deleted/added/nonexistent
- **测试维度 12：暂存控制**（5 tests）— stage/unstage/stage-all + 路径越界
- **测试维度 13：全局单例**（3 tests）— singleton + 线程安全 + 异常
- **测试维度 14：异常路径**（3 tests）— 项目不存在 / 空路径 / 超长路径

### E2E 测试（90/90 通过，15 个测试模块）

| 模块 | 断言数 | 覆盖点 |
|---|---|---|
| Test 1: 健康检查 | 9 | success/action/service/version/supported_formats |
| Test 2: 列出格式 | 7 | 4 种格式定义 |
| Test 3: unified diff | 9 | 完整工作区 diff |
| Test 4: side_by_side | 7 | 并排视图 + path_filter |
| Test 5: json_patch | 5 | op/line/content |
| Test 6: stats | 5 | total_files/total_additions/by_status |
| Test 7: status_filter | 3 | 仅 untracked 过滤 |
| Test 8: 任意 ref 对比 | 6 | HEAD/WORKTREE + HEAD~1/HEAD |
| Test 9: 创建快照 | 8 | 完整字段 + snapshot_id 提取 |
| Test 10: 列出快照 | 5 | 倒序排列 |
| Test 11: 快照 vs 工作区 | 5 | modified 检测 + base_ref |
| Test 12: 恢复快照 | 5 | 文件内容验证 |
| Test 13: 暂存控制 | 7 | stage/unstage/stage-all |
| Test 14: 删除快照 | 4 | 删除后列表验证 |
| Test 15: 异常路径 | 5 | 4xx/404/400 错误码 |

## API 端点清单（11 个）

```
POST   /api/diff-view/workspace                  工作区 diff（多格式）
POST   /api/diff-view/compare                    任意 ref 对比
POST   /api/diff-view/snapshot-vs-worktree       快照 vs 工作区
GET    /api/diff-view/snapshots                  列出快照
POST   /api/diff-view/snapshots                  创建快照
POST   /api/diff-view/snapshots/{id}/restore     恢复快照
DELETE /api/diff-view/snapshots/{id}             删除快照
POST   /api/diff-view/stage                      暂存文件
POST   /api/diff-view/unstage                    取消暂存
POST   /api/diff-view/stage-all                  全部暂存
GET    /api/diff-view/health                     健康检查
GET    /api/diff-view/formats                    支持的输出格式
```

## 设计亮点

1. **零外部依赖**：仅使用标准库 `subprocess / shutil / difflib / hashlib`，避免引入新 pip 包
2. **线程安全**：所有 mutation 操作通过 `RLock` 保护，并发场景下安全
3. **数据类输出**：`@dataclass + asdict` 避免 ORM 耦合，便于 Pydantic / JSON 序列化
4. **Git 容错**：子进程超时保护 + 错误码透传，单次失败不影响整体响应
5. **路径白名单**：四层防御（长度限制 + 越界检测 + 路径规范化 + Pydantic 校验）

## 与 P0-17 / P1-5 / P1-6 的关系

- **P0-17 (.trae/agents/)**：子智能体目录路由，已完成
- **P1-5 (SKILL.md Progressive Disclosure)**：技能渐进式加载，已完成
- **P1-6 (.trae/rules/ Multi-Level Loader)**：规则多级嵌套，已完成
- **P1-7 (DiffView 增强，本任务)**：完成

四个 P1 任务共同形成 Codex v0.140+ / TRAE v3.5+ 的核心 IDE 能力集。

## 下一步

- **P0-2 阶段 3**：创建子组件
- **Phase 5**：UI/UX 优化（基于本次 DiffView 后端能力，前端 DiffView.tsx 升级为多格式切换 + 快照管理 UI）
- **Phase 6**：loop engineering 工作流端到端验证
- **Phase 7**：循环重启准备

## 验证清单

- [x] 后端服务成功启动，所有 11 个端点注册成功
- [x] 71 个单元测试 100% 通过
- [x] 90 个 E2E 断言 100% 通过
- [x] 工作区 4 种格式 diff 端到端验证
- [x] 任意 ref 对比端到端验证
- [x] 快照创建 / 列表 / 恢复 / 删除端到端验证
- [x] 暂存 / 取消暂存 / 全部暂存端到端验证
- [x] 异常路径（路径越界 / 格式非法 / 快照不存在）端到端验证
- [x] OpenAPI 文档自动生成（11 个端点）

## 文件清单

- `backend/app/services/diff_view.py` — 核心服务（1018 行）
- `backend/app/api/diff_view.py` — REST API（320 行）
- `backend/app/main.py` — 路由注册（已更新到 v6.7.0）
- `tests/test_diff_view_units.py` — 单元测试（880 行）
- `tests/test_e2e_diff_view.sh` — E2E 测试（510 行）
- `CYCLE9_P1_7_SUMMARY.md` — 本文档
- `代码修改日志.md` — 项目变更记录（待追加 P1-7 章节）
