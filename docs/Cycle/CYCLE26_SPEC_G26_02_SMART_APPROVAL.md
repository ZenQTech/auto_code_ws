# Cycle 26 G26-02 SPEC: 智能审批引擎

**版本**: v1.0.0
**日期**: 2026-07-30
**Cycle**: 26
**优先级**: P0
**来源**: Codex CLI Smart Approvals (v0.120+, 2026-05)

---

## 一、概述

### 1.1 目标

实现 Hermes 平台的细粒度命令/操作审批系统。基于 JSON DSL 定义规则，对 API 调用、shell 命令、文件操作、网络请求等进行 allow/block/prompt 三种决策，并提供完整审计日志。

### 1.2 核心场景

- **场景 A：命令审批** — 拦截 `rm -rf` 等危险命令，强制 prompt
- **场景 B：API 限流** — 限制高频端点，自动 allow 低频查询
- **场景 C：文件保护** — 禁止修改 `.env`、`.git/`、`node_modules/`
- **场景 D：网络隔离** — 内网 API allow，外网 prompt
- **场景 E：审计追溯** — 完整记录每次决策的规则、原因、时间戳

### 1.3 价值

- 解决 Hermes 平台命令/工具执行的安全审批问题
- 复用 `API Interceptor`、`GlobalErrorHandler`、`HooksEngine`
- 适配企业级安全合规需求

---

## 二、核心数据模型

### 2.1 类型定义（smartApprovalTypes.ts）

```typescript
export type Decision = 'allow' | 'block' | 'prompt';

export type ActionType =
  | 'shell'        // shell 命令
  | 'file:read'    // 读文件
  | 'file:write'   // 写文件
  | 'file:delete'  // 删文件
  | 'api:get'      // GET 请求
  | 'api:post'     // POST 请求
  | 'api:delete'   // DELETE 请求
  | 'network'      // 网络请求
  | 'tool'         // 工具调用
  | 'subagent';    // 子智能体派发

export type MatchType =
  | 'prefix'       // 前缀匹配
  | 'contains'     // 包含
  | 'regex'        // 正则
  | 'exact'        // 完全相等
  | 'length'       // 长度
  | 'cmd-in-cmd';  // 命令嵌套

export interface MatchExpr {
  type: MatchType;
  value: string;
  flags?: string;  // regex flags
  caseSensitive?: boolean;
}

export type CompositeExpr =
  | { all: MatchExpr[] }                          // 全部匹配
  | { any: MatchExpr[] }                          // 任一匹配
  | { not: MatchExpr }                            // 不匹配
  | { type: MatchType; value: string; flags?: string }; // 简单匹配

export interface SmartApprovalRule {
  id: string;
  name: string;
  description: string;
  /** 适用操作类型 */
  actionTypes: ActionType[];
  /** 匹配表达式 */
  match: CompositeExpr;
  /** 决策 */
  decision: Decision;
  /** 原因 */
  reason: string;
  /** 优先级（数字越大越优先） */
  priority: number;
  /** 启用 */
  enabled: boolean;
  /** 创建时间 */
  createdAt: number;
  /** 修改时间 */
  updatedAt: number;
  /** 标签（分类用） */
  tags: string[];
}

export interface ApprovalRequest {
  /** 唯一 ID */
  id: string;
  /** 操作类型 */
  actionType: ActionType;
  /** 操作内容（如 shell 命令、URL、文件路径） */
  payload: string;
  /** 附加元数据 */
  metadata?: Record<string, unknown>;
  /** 请求时间 */
  timestamp: number;
  /** 来源（user/agent/system） */
  source: 'user' | 'agent' | 'system';
}

export interface ApprovalDecision {
  requestId: string;
  decision: Decision;
  /** 命中的规则 ID（allow/block） */
  ruleId?: string;
  /** 决策原因 */
  reason: string;
  /** 决策时间（ms） */
  duration: number;
  /** 是否被人工覆盖 */
  overridden: boolean;
  /** 覆盖时的人工输入 */
  overrideReason?: string;
}

export interface AuditLog {
  id: string;
  request: ApprovalRequest;
  decision: ApprovalDecision;
  timestamp: number;
}

export interface SmartApprovalConfig {
  /** 缺省决策（无规则命中时） */
  defaultDecision: Decision;
  /** 启用审计 */
  enableAudit: boolean;
  /** 审计最大条数（环形覆盖） */
  maxAuditLogs: number;
  /** 持久化 */
  persist: boolean;
}
```

### 2.2 事件类型

```typescript
export type SmartApprovalEvent =
  | { type: 'rule-added'; rule: SmartApprovalRule }
  | { type: 'rule-updated'; rule: SmartApprovalRule }
  | { type: 'rule-removed'; ruleId: string }
  | { type: 'rule-toggled'; ruleId: string; enabled: boolean }
  | { type: 'request-submitted'; request: ApprovalRequest }
  | { type: 'decision-made'; request: ApprovalRequest; decision: ApprovalDecision }
  | { type: 'override'; requestId: string; reason: string };
```

---

## 三、核心 API 设计

### 3.1 引擎主类（smartApprovalEngine.ts）

```typescript
export class SmartApprovalEngine {
  constructor(config?: Partial<SmartApprovalConfig>);

  // 规则管理
  addRule(rule: Omit<SmartApprovalRule, 'id' | 'createdAt' | 'updatedAt'>): SmartApprovalRule;
  updateRule(ruleId: string, updates: Partial<SmartApprovalRule>): SmartApprovalRule | undefined;
  removeRule(ruleId: string): boolean;
  toggleRule(ruleId: string, enabled: boolean): boolean;
  getRule(ruleId: string): SmartApprovalRule | undefined;
  getAllRules(): SmartApprovalRule[];

  // 规则匹配
  matchRequest(request: ApprovalRequest): SmartApprovalRule | undefined;
  evaluateExpression(expr: CompositeExpr, request: ApprovalRequest): boolean;
  evaluateSimple(expr: MatchExpr, value: string): boolean;

  // 决策
  request(request: ApprovalRequest): ApprovalDecision;
  requestBatch(requests: ApprovalRequest[]): ApprovalDecision[];

  // 人工覆盖
  override(requestId: string, decision: Decision, reason: string): boolean;

  // 审计
  getAuditLog(filters?: { ruleId?: string; decision?: Decision; since?: number }): AuditLog[];
  clearAuditLog(): void;
  exportAuditLog(): string;

  // DSL 工具
  parseRuleDSL(dsl: string): Omit<SmartApprovalRule, 'id' | 'createdAt' | 'updatedAt'>;
  serializeRule(rule: SmartApprovalRule): string;

  // 统计
  getStats(): {
    rules: number;
    enabled: number;
    decisions: { allow: number; block: number; prompt: number };
    overrides: number;
  };

  // 事件订阅
  on(event: SmartApprovalEventType, listener: Function): () => void;
}
```

### 3.2 DSL 示例（JSON 格式）

**简单规则**：
```json
{
  "name": "禁止 rm -rf",
  "actionTypes": ["shell"],
  "match": { "type": "contains", "value": "rm -rf" },
  "decision": "block",
  "reason": "禁止递归强制删除",
  "priority": 100,
  "tags": ["security", "dangerous"]
}
```

**组合规则**：
```json
{
  "name": "Git 只读操作",
  "actionTypes": ["shell"],
  "match": {
    "all": [
      { "type": "prefix", "value": "git " },
      { "not": { "type": "contains", "value": "push --force" } },
      { "not": { "type": "contains", "value": "reset --hard" } },
      { "not": { "type": "contains", "value": "clean -fdx" } }
    ]
  },
  "decision": "allow",
  "reason": "Git 只读操作安全",
  "priority": 50,
  "tags": ["git", "safe"]
}
```

**正则规则**：
```json
{
  "name": "敏感文件保护",
  "actionTypes": ["file:read", "file:write", "file:delete"],
  "match": { "type": "regex", "value": "(\\.(env|env\\..*)|\\.git/|node_modules/)", "flags": "i" },
  "decision": "block",
  "reason": "敏感文件不允许访问",
  "priority": 100,
  "tags": ["security", "sensitive"]
}
```

---

## 四、内置规则库（40+ 规则）

### 4.1 安全类（10 条）
- 禁止 rm -rf
- 禁止 sudo
- 禁止 chmod 777
- 禁止 dd 命令
- 禁止 mkfs 格式化
- 禁止 curl | sh 模式
- 禁止 eval / new Function
- 禁止 fork bomb
- 禁止 git push --force
- 禁止 git reset --hard

### 4.2 Git 类（8 条）
- git status → allow
- git log → allow
- git diff → allow
- git add → allow
- git commit → prompt
- git push → prompt
- git checkout → prompt
- git branch -D → block

### 4.3 文件类（10 条）
- 读 .env → block
- 写 .env → block
- 删 .env → block
- 读 .git/ → block
- 写 node_modules/ → block
- 读 package.json → allow
- 写 src/** → prompt
- 删 *~ → allow（清理临时文件）
- 读 *.lock → allow
- 写 dist/ → prompt

### 4.4 网络类（8 条）
- API localhost:* → allow
- API 127.0.0.1:* → allow
- API 10.*.*.* → allow
- API *.internal → allow
- API github.com → allow
- API npm registry → allow
- API 其他外部 → prompt
- API *.gov → prompt

### 4.5 工具类（6 条）
- bestOfN 调用 → allow
- subagent 派发 → allow
- web search → allow
- browser fetch → prompt
- clipboard write → prompt
- file system access → prompt

---

## 五、UI 设计（SmartApprovalPanel.tsx）

### 5.1 整体布局

```
┌─────────────────────────────────────────────────────────────────┐
│  🛡️ 智能审批引擎                                    [Esc] 关闭  │
├─────────────────────────────────────────────────────────────────┤
│  [规则管理]  [审计日志]  [测试]  [设置]                          │
├─────────────────────────────────────────────────────────────────┤
│  📋 规则列表 (40)                              [+ 新增规则]      │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ [✓] [P100] 🚫 禁止 rm -rf         | shell | block      │  │
│  │     禁止递归强制删除                            [编辑][删除]│  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ [✓] [P50] ✅ Git 只读操作         | shell | allow      │  │
│  │     Git 只读操作安全                            [编辑][删除]│  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ [✗] [P30] ⚠️ API 外部请求         | network | prompt   │  │
│  │     外部 API 需要人工确认                        [编辑][删除]│  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                  │
│  筛选: [全部▼] [全部类型▼] [全部决策▼]  [搜索...]                 │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  📝 编辑规则 (modal)                                             │
│  名称: [禁止 rm -rf]                                              │
│  操作类型: [shell▼]                                              │
│  匹配表达式:                                                     │
│    模式: [contains▼] 值: [rm -rf]                                │
│    或: [+ 嵌套]  [+ 全部匹配]  [+ 任一匹配]  [+ 取反]            │
│  决策: [🚫 block▼]                                               │
│  原因: [禁止递归强制删除]                                        │
│  优先级: [100]  启用: [✓]  标签: [security]                      │
│                                                                  │
│  [取消]  [保存]  [测试规则]                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.2 审计日志 Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  🛡️ 智能审批引擎 > 审计日志                                     │
├─────────────────────────────────────────────────────────────────┤
│  筛选: [全部决策▼] [全部时间▼] [全部规则▼] [清空] [导出]         │
│                                                                  │
│  13:45:23  ALLOW   | rule-12 | git status                       │
│  13:45:25  BLOCK   | rule-1  | rm -rf /                         │
│  13:45:28  PROMPT  | rule-30 | curl https://external.com        │
│  13:45:30  ALLOW   | (override) | npm install                   │
│  ...                                                              │
│                                                                  │
│  总计: 1245 决策 | 80% allow | 5% block | 15% prompt            │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 测试 Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  🛡️ 智能审批引擎 > 测试规则                                     │
├─────────────────────────────────────────────────────────────────┤
│  操作类型: [shell▼]                                              │
│  测试输入:                                                        │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ rm -rf /tmp/test                                          │  │
│  └──────────────────────────────────────────────────────────┘  │
│  [▶ 测试]                                                        │
│                                                                  │
│  决策结果:                                                        │
│  🚫 BLOCK                                                        │
│  命中规则: rule-1 (禁止 rm -rf)                                  │
│  原因: 禁止递归强制删除                                          │
│  评估耗时: 0.12ms                                                │
│                                                                  │
│  匹配路径:                                                        │
│  ✓ all: [prefix "rm "]                                           │
│  ✓ all: [contains "rm -rf"]                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 5.4 核心交互

1. **规则 CRUD**：新增/编辑/删除/启用切换
2. **DSL 可视化编辑**：嵌套条件可视化
3. **规则测试**：输入测试 payload 验证规则
4. **审计查询**：按规则/决策/时间过滤
5. **批量操作**：批量启用/禁用/删除
6. **导入/导出**：JSON 格式
7. **快捷键**：
   - `Esc` 关闭面板
   - `Ctrl+N` 新增规则
   - `Ctrl+T` 切换到测试 Tab
   - `Ctrl+L` 切换到审计 Tab
   - `Ctrl+R` 切换到规则 Tab
   - `Ctrl+S` 保存当前编辑
   - `?` 显示帮助

---

## 六、与现有能力集成

| 现有能力 | 集成方式 |
|---|---|
| `API Interceptor` | 在 fetch/axios 拦截点调用 `engine.request()` |
| `GlobalErrorHandler` | block 决策触发后写入错误日志 |
| `HooksEngine` | 触发 `pre-tool-use`、`post-tool-use` 事件 |
| `HookChainTracker` | 记录审批决策链路 |
| `SmartRouter` (Cycle 26 规划) | 不同决策路由到不同模型 |
| `MTCAdapter` (Cycle 26 规划) | MTC 文件处理审批 |

---

## 七、测试策略

### 7.1 单元测试（smartApprovalEngine.test.ts，目标 40+ 用例）

- ✅ 简单匹配：prefix/contains/regex/exact/length
- ✅ 组合逻辑：all/any/not
- ✅ 规则优先级：数值大者优先
- ✅ 启用/禁用：禁用规则不参与评估
- ✅ 默认决策：无规则命中时使用
- ✅ 审计日志：完整记录
- ✅ 人工覆盖：override 流程
- ✅ DSL 解析/序列化
- ✅ 40+ 内置规则全部覆盖
- ✅ 性能：单次评估 < 1ms
- ✅ 持久化与恢复

### 7.2 组件测试（SmartApprovalPanel.test.tsx，目标 20+ 用例）

- ✅ Tab 切换：规则/审计/测试/设置
- ✅ 规则 CRUD 流程
- ✅ DSL 可视化编辑
- ✅ 测试输入与结果展示
- ✅ 审计查询与导出
- ✅ 批量操作
- ✅ 快捷键
- ✅ localStorage 持久化
- ✅ 空状态展示

### 7.3 集成测试（cycle26-integration.test.ts，目标 5+ 用例）

- ✅ 三大引擎独立工作
- ✅ Smart Approval + API Interceptor 联动
- ✅ Smart Approval + HooksEngine 联动
- ✅ 决策 + 审计 + 覆盖全链路
- ✅ 与全局错误处理集成

---

## 八、验收标准

| 维度 | 标准 |
|---|---|
| 功能完整度 | 40+ 内置规则 + DSL 完整实现 |
| 测试通过率 | 100%（65+ 用例） |
| TypeScript | 0 错误 |
| 性能 | 单次评估 < 1ms，1000 规则查找 < 10ms |
| 审计完整性 | 100% 决策可追溯 |
| 文档 | DSL + 内置规则 + 最佳实践完整 |

---

## 九、交付物清单

1. ✅ `frontend/src/utils/smartApprovalTypes.ts` — 类型定义
2. ✅ `frontend/src/utils/smartApprovalEngine.ts` — 核心引擎
3. ✅ `frontend/src/utils/smartApprovalRules.ts` — 40+ 内置规则
4. ✅ `frontend/src/utils/smartApprovalEngine.test.ts` — 单元测试
5. ✅ `frontend/src/components/SmartApprovalPanel.tsx` — UI 组件
6. ✅ `frontend/src/components/SmartApprovalPanel.test.tsx` — 组件测试
7. ✅ 集成到 `App.tsx`、`AppLayout.tsx`、`BrandHeader.tsx`
8. ✅ 菜单项 `🛡️ 智能审批` + 图标

---

**G26-02 SPEC 状态**: ✅ 已完成
**预计代码量**: ~1800 行（含测试）
**预计交付日期**: Cycle 26 Phase 4
