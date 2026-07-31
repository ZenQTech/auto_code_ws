# Cycle 10 差距分析 - 与 Codex v0.145+ / TRAE Solo v3.5.79+ 对比

> **周期**: Cycle 10
> **分析时间**: 2026-07-28
> **对比基准**: Hermes v6.8.0 vs Codex v0.145.0 / TRAE Solo v3.5.79
> **关联**: [CYCLE10_RESEARCH_REPORT.md](CYCLE10_RESEARCH_REPORT.md)

---

## 一、当前 Hermes 能力矩阵

| 功能领域 | 当前状态 | 已有版本 | 关联任务 |
|---|---|---|---|
| Loop Engineering 工作流 | ✅ 完整 | v6.2.0 | Cycle 8 P1-4 |
| Slash Commands 系统 | ✅ 12+ 内置 | v1.0.0 | Cycle 8 P0-12 |
| Custom Skills/Commands | ✅ 已实现 | v1.0.0 | Cycle 8 P0-13 |
| Custom Models + Bearer Token | ✅ 已实现 | v1.0.0 | Cycle 8 P0-14 |
| Multi-Agent v2 | ✅ Path Tree | v5.12.0 | Cycle 7 P0-10 |
| TRACE 规则管理 | ✅ 已实现 | v5.13.0 | Cycle 7 P0-11 |
| OAuth 2.1 + PKCE | ✅ 已实现 | v1.0.0 | Cycle 7 P0-8 |
| Session Rollout JSONL | ✅ 已实现 | v1.0.0 | Cycle 7 P0-9 |
| React Router SPA | ✅ 已实现 | v1.2.0 | Cycle 7 P1-2 |
| .trae/agents/ 子智能体 | ✅ 完整 | v1.0.0 | Cycle 9 P0-17 |
| .trae/hooks/ 事件增强 | ✅ 完整 | v1.0.0 | Cycle 9 P0-18 |
| .trae/rules/ 多级嵌套 | ✅ 完整 | v1.0.0 | Cycle 9 P1-6 |
| SKILL.md Progressive Disclosure | ✅ 完整 | v1.0.0 | Cycle 9 P1-5 |
| DiffView 增强 | ✅ 后端+UI 完整 | v2.0.0 | Cycle 9 P1-7 |

## 二、新发现的关键差距

### 2.1 P1-8 Memory 功能（智能体长期记忆）⭐ 核心差距

**TRAE 已有能力**（2026-06-24 起）：
- Global Memory 跨会话保留所有历史
- Dual-Track Memory（Core + MCP）
- Knowledge Graph 实体+关系
- Self-Improvement 自动学习

**Codex 已有能力**（v0.145.0）：
- /import 跨平台 memory 迁移
- 项目级 memory 持久化

**当前 Hermes 状态**：
- ❌ **完全缺失** 智能体长期记忆
- 仅有 Session 持久化（会话级）
- 已有 Project Memory（项目级 .trae/memory/）但未与智能体打通

**差距量化**：
- 智能体无法跨会话保留学习成果
- 用户每次新会话需重新解释偏好
- 错误解决经验无法复用

**优先级**：⭐⭐⭐⭐⭐ 最高（核心能力缺失）

**建议规格**：见 `CYCLE10_SPEC_MEMORY.md`（待创建）

### 2.2 P1-10 Verification Loop in AGENTS.md ⭐ 核心差距

**Codex Goal Mode 三大支柱**（v0.133.0 GA）：
1. **Three-File Trust Architecture**: spec.md / checklist.md / tasks.md
2. **Configuring Cost Guardrails**: token 预算
3. **Separate Verifier Pattern**: 独立验证器

**TRAE Agent Enhancements 闭环质量**：
- verification-before-completion skill
- 必须测试通过 + 构建成功 + bug 消失
- 失败自动 retry

**当前 Hermes 状态**：
- ✅ Loop Engineering workflow 已有 5 阶段（triage/plan/execute/verify）
- ✅ spec.md / task.md / checklist.md 三件套
- ❌ **缺失** 独立 Verifier Pattern
- ❌ **缺失** 强约束 verification-before-completion
- ❌ **缺失** 失败自动 retry + 上报机制

**差距量化**：
- 当前 verify 子命令仅检查输出文本，未强制运行测试/构建
- 主 agent 与 verifier 未分离，可能存在自我放行风险
- 失败任务无统一重试策略

**优先级**：⭐⭐⭐⭐⭐ 最高（质量保障核心）

**建议规格**：见 `CYCLE10_SPEC_VERIFICATION.md`（待创建）

### 2.3 P3-1 /import 跨平台配置迁移（中优先级）

**Codex v0.145.0 新增**：
- 从 Cursor / Claude Code 一键导入
- 支持：MCP servers / plugins / sessions / commands / project memory

**当前 Hermes 状态**：
- ❌ **缺失** 跨平台配置迁移

**差距量化**：
- 用户从其他 IDE 切换到 Hermes 需手动配置
- MCP server、custom command 等需重新添加

**优先级**：⭐⭐⭐ 中等

### 2.4 P2-2 codex doctor 诊断（中优先级）

**Codex v0.135.0 功能**：
- 环境诊断：Node.js / Python / Git 版本
- 仓库状态：git status / 远程连接
- 终端能力：颜色 / Unicode
- app-server 连接
- thread 库存

**当前 Hermes 状态**：
- ✅ 已有 /health 端点（DB + LLM API）
- ❌ **缺失** 完整环境诊断

**差距量化**：
- 用户遇到问题无法自助排查
- 错误信息不够详细

**优先级**：⭐⭐⭐ 中等

### 2.5 P2-1 Playwright E2E 完整前端自动化（低优先级）

**需求来源**：
- Hermes 仅有后端 E2E 测试
- 前端关键流程未自动化（DiffView / 计划生成 / 多 agent 协作）
- CI/CD 集成缺失

**当前 Hermes 状态**：
- ❌ **缺失** Playwright 集成

**差距量化**：
- 前端代码变更需手动验证
- 难以保证 UI 跨设备一致性

**优先级**：⭐⭐ 较低（不影响核心功能）

---

## 三、优先级分布

| 优先级 | 任务数 | 预估工时 |
|---|---|---|
| P1（核心） | 2 | 14-20h |
| P3（中） | 2 | 7-10h |
| P2（低） | 1 | 8-10h |
| **总计** | **5** | **29-40h** |

---

## 四、详细任务规格

### 4.1 P1-8 Memory 功能规格

**功能名称**：Hermes Memory System - Dual-Track Persistent Memory

**核心模块**：
1. **Core Memory**（会话级）
   - Key-value observations
   - 自动写入（关键事件触发）
   - 容量：~20 条/scope
   - 存储：SQLite session_memory 表

2. **MCP Memory**（跨会话）
   - Knowledge Graph（entities + relations）
   - 显式写入（memory-kernel skill）
   - 容量：无限制
   - 存储：JSONL 文件 + 内存索引

3. **Memory Router**（Step 0 Universal Pre-check）
   - 所有任务开始前先查 MCP Memory
   - 降级策略：MCP 不可用 → Core Memory
   - 降级策略：Core 不足 → 全文件扫描

4. **Memory Skills**
   - `memory-kernel`: R/W/U 协议 + 质量门控
   - `self-improvement`: 自动学习与晋升
   - `memory-recall`: 跨会话记忆检索

**API 端点**：
- `POST /api/memory/entities` - 创建实体
- `GET /api/memory/entities/:name` - 查询实体
- `POST /api/memory/observations` - 添加 observation
- `POST /api/memory/relations` - 创建关系
- `GET /api/memory/search` - 关键词搜索
- `GET /api/memory/graph` - 整个图谱
- `POST /api/memory/skill/memory-kernel` - R/W/U skill 接口
- `POST /api/memory/skill/self-improvement` - self-improvement 接口
- `GET /api/memory/health`

**数据模型**：
```python
class MemoryEntity(BaseModel):
    name: str  # snake_case + 项目前缀
    type: str  # project / pattern / preference / profile
    observations: List[str]  # [YYYY-MM-DD] xxx 格式
    created_at: datetime
    updated_at: datetime

class MemoryRelation(BaseModel):
    source: str  # entity name
    target: str  # entity name
    type: str  # 关系类型
    created_at: datetime

class CoreMemoryEntry(BaseModel):
    session_id: str
    key: str
    value: str
    created_at: datetime
    expires_at: datetime  # 会话结束失效
```

**前端组件**：
- `MemoryGraphView.tsx` - 知识图谱可视化（D3.js）
- `MemoryListPanel.tsx` - 实体列表 + 搜索
- `MemoryEditor.tsx` - 添加/编辑实体
- `MemoryRecallButton.tsx` - 顶部"还记得吗"快捷入口

**测试维度**：
1. 数据模型：CRUD + 关系维护
2. Memory Router：Step 0 路由逻辑
3. memory-kernel skill：R/W/U 协议 + 质量门控
4. self-improvement：自动学习触发
5. Core Memory：会话级隔离 + 自动失效
6. MCP Memory：跨会话持久化
7. 降级策略：MCP 不可用时回退
8. 性能：1000 entities 检索 < 100ms

### 4.2 P1-10 Verification Loop 规格

**功能名称**：Hermes Verification Loop - Three-File Trust Architecture

**核心模块**：
1. **AGENTS.md Verification 章节**
   - 自动生成 verification 章节
   - 包含：测试命令 / 构建命令 / lint 命令 / 验收标准
   - 跨项目持久化

2. **Independent Verifier Pattern**
   - 独立 verifier 角色（与主 agent 分离）
   - 使用不同 model（防止 bias）
   - 严格通过/失败判定

3. **verification-before-completion Skill**
   - 必须运行测试 + 构建
   - 检查 bug 消失
   - 失败必须 retry（最多 3 次）
   - 最终失败上报用户

4. **Cost Guardrails**
   - Token 预算配置
   - 单价上限
   - 软停止（预算 80% 警告）
   - 硬停止（预算 100% 暂停）

5. **Task Failure Recovery**
   - 失败任务自动 retry（指数退避）
   - 重试失败后转人工
   - 错误模式学习（写入 Memory）

**API 端点**：
- `POST /api/verify/run` - 触发独立验证
- `GET /api/verify/status/:id` - 验证状态
- `POST /api/agents.md/generate` - 生成 AGENTS.md
- `GET /api/agents.md/:project` - 获取 AGENTS.md
- `POST /api/cost/guard` - 配置成本护栏
- `GET /api/cost/status` - 当前消耗

**验证流程**：
```
主 agent 提交任务
   ↓
独立 verifier 接管
   ↓
1. 运行测试（pytest / npm test）
2. 运行构建（npm run build）
3. 运行 lint
4. 检查 git status
5. 对比 spec 要求
   ↓
全通过 → 标记 verified = true
有失败 → 进入 retry 队列
   ↓
retry 3 次仍失败 → 上报用户
```

**前端组件**：
- `VerificationPanel.tsx` - 验证状态展示
- `VerifierCard.tsx` - 独立 verifier 卡片
- `CostGuardPanel.tsx` - 成本护栏配置
- `AGENTS.mdEditor.tsx` - AGENTS.md 编辑器

**测试维度**：
1. AGENTS.md 生成
2. 独立 verifier 隔离
3. 验证流程完整性
4. Retry 机制
5. Cost guardrails
6. 失败上报

### 4.3 P3-1 /import 命令规格

**功能名称**：Cross-Platform Configuration Import

**支持源**：
- Claude Code（~/.claude/）
- Cursor（~/.cursor/）
- OpenAI Codex（~/.codex/）
- TRAE（~/.trae/）

**导入内容**：
- MCP 服务器配置
- 自定义命令
- 会话历史
- 项目级 memory
- 插件

**API 端点**：
- `POST /api/import/detect` - 检测已安装的 IDE
- `POST /api/import/run` - 执行导入
- `GET /api/import/status/:id` - 导入状态
- `GET /api/import/preview` - 预览待导入内容

### 4.4 P2-2 codex doctor 规格

**功能名称**：Hermes Doctor - Environment Diagnostics

**诊断项**：
- Node.js / Python / Git 版本
- 仓库状态（git status / 远程）
- 终端能力（颜色 / Unicode）
- app-server 连接
- LLM API 可达性
- Database 连接
- 磁盘空间
- 内存/CPU 使用

**API 端点**：
- `GET /api/doctor/run` - 执行完整诊断
- `GET /api/doctor/:category` - 单项诊断

**前端组件**：
- `DoctorPanel.tsx` - 诊断面板（带 ✅/⚠️/❌ 状态）

### 4.5 P2-1 Playwright E2E 规格

**功能名称**：Playwright Frontend E2E Automation

**覆盖场景**：
- 聊天模式：发送消息 → 接收 SSE 流式响应
- 编程模式：选择项目 → 浏览文件 → 打开文件 → 查看代码
- DiffView：切换格式 → 创建快照 → 恢复快照
- 计划生成：触发 plan → 查看 stage → 确认/拒绝
- Multi-Agent：查看 agent 树 → 切换子 agent
- 设置：修改配置 → 保存 → 验证生效

**CI/CD 集成**：
- GitHub Actions 工作流
- 截图对比（visual regression）
- 自动重试 + 报告

---

## 五、任务依赖关系

```
P1-8 Memory (核心) ─┬─→ P1-10 Verification (使用 memory 记录错误模式)
                  └─→ P2-2 Doctor (可集成 memory 诊断)

P1-10 Verification ─┬─→ P2-1 Playwright (验证前端)
                   └─→ P3-1 /import (可验证导入配置正确性)
```

**推荐执行顺序**：
1. **P1-8 Memory** - 基础能力
2. **P1-10 Verification** - 质量保障
3. **P2-2 Doctor** - 用户体验
4. **P3-1 /import** - 生态扩展
5. **P2-1 Playwright** - 测试基础设施

---

## 六、验收标准

### 6.1 P1-8 Memory
- [ ] Dual-Track Memory 完整实现
- [ ] memory-kernel skill 可用
- [ ] self-improvement 自动触发
- [ ] 跨会话记忆保留测试通过
- [ ] 知识图谱可视化前端
- [ ] 单元测试 80+ 用例
- [ ] E2E 测试 50+ 断言
- [ ] 测试通过率 100%

### 6.2 P1-10 Verification
- [ ] 独立 verifier 与主 agent 物理隔离
- [ ] 强制测试 + 构建验证
- [ ] 失败自动 retry（最多 3 次）
- [ ] Cost guardrails 生效
- [ ] AGENTS.md 自动生成
- [ ] 单元测试 60+ 用例
- [ ] E2E 测试 40+ 断言
- [ ] 测试通过率 100%

### 6.3 P2-2 Doctor
- [ ] 6 大类诊断完整
- [ ] 用户友好报告
- [ ] 一键修复建议
- [ ] 单元测试 30+ 用例

### 6.4 P3-1 /import
- [ ] 支持 4 个源平台
- [ ] 自动路径检测
- [ ] 权限验证 + 失败降级
- [ ] 单元测试 40+ 用例

### 6.5 P2-1 Playwright
- [ ] 覆盖 6 大核心场景
- [ ] 视觉回归测试
- [ ] CI/CD 集成
- [ ] 截图覆盖率 100%

---

## 七、资源预估

| 任务 | 代码行数（预估） | 测试用例 | 工时 |
|---|---|---|---|
| P1-8 Memory | 1500-2000 | 80+ | 8-12h |
| P1-10 Verification | 1000-1500 | 60+ | 6-8h |
| P2-2 Doctor | 500-800 | 30+ | 3-4h |
| P3-1 /import | 800-1200 | 40+ | 4-6h |
| P2-1 Playwright | N/A（测试） | 30+ | 8-10h |
| **总计** | **3800-5500** | **240+** | **29-40h** |

---

## 八、下一步行动

1. **创建 P1-8 Memory spec 详细文档**
   - `.trae/specs/cycle10/memory/spec.md`
   - `.trae/specs/cycle10/memory/task.md`
   - `.trae/specs/cycle10/memory/checklist.md`

2. **创建 P1-10 Verification spec 详细文档**
   - `.trae/specs/cycle10/verification/spec.md`
   - `.trae/specs/cycle10/verification/task.md`
   - `.trae/specs/cycle10/verification/checklist.md`

3. **按优先级实现**
   - 先 P1-8 Memory
   - 再 P1-10 Verification
   - 依此类推

4. **每完成一个任务**
   - 写单元测试 + E2E 测试
   - 创建 CYCLE10_PX_X_SUMMARY.md
   - 更新 代码修改日志.md
   - 提交到 git
