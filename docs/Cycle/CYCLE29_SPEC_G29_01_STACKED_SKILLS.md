# Cycle 29 G29-01 SPEC: Stacked Skills Engine

**周期**：Cycle 29
**任务 ID**：G29-01
**优先级**：P0
**对应版本**：v6.77.0
**日期**：2026-07-30
**状态**：📋 SPEC 编写中

---

## 一、目标

实现 **Stacked Skills（堆叠技能）** 能力，参考 Claude Code v2.1.199 特性：
- 一次调用最多堆叠 5 个技能
- 技能组合而非单独调用
- 共享上下文 + 工具权限冲突检测

**对应 Codex 对应能力**：详见 [CYCLE29_CODEX_TRAE_RESEARCH.md §3.1](file:///home/qizheng/auto_code_ws/CYCLE29_CODEX_TRAE_RESEARCH.md)

---

## 二、数据模型

### 2.1 核心接口

```typescript
// 堆叠命令
export interface StackedCommand {
  /** 技能名称列表（最多 5 个） */
  skillNames: string[];
  /** 共享的命令参数 */
  args: string;
  /** 是否共享上下文（默认 false，每个技能独立上下文） */
  sharedContext: boolean;
  /** 解析时间戳 */
  parsedAt: number;
}

// 技能冲突
export interface SkillConflict {
  type: 'tool-overlap' | 'context-incompatible' | 'permission-conflict';
  skills: [string, string];
  details: string;
}

// 组合检查结果
export interface CompositionCheckResult {
  valid: boolean;
  conflicts: SkillConflict[];
  warnings: string[];
  effectiveTools: string[];
}

// 单个技能执行结果
export interface StackedSkillResult {
  skillName: string;
  result: SkillExecutionResult;
  durationMs: number;
  order: number;
}

// 整体执行结果
export interface StackedExecutionResult {
  command: StackedCommand;
  results: StackedSkillResult[];
  aggregatedOutput: string;
  totalDurationMs: number;
  conflicts: SkillConflict[];
  successCount: number;
  failureCount: number;
}

// 引擎配置
export interface StackedSkillConfig {
  maxStackSize: number;        // 默认 5
  allowSharedContext: boolean; // 默认 true
  parallelExecution: boolean;  // 默认 true
  stopOnFirstFailure: boolean; // 默认 false
  persist: boolean;            // 默认 true
}

// 事件
export type StackedSkillEventType =
  | 'stack-parsed'
  | 'stack-validated'
  | 'skill-started'
  | 'skill-completed'
  | 'skill-failed'
  | 'stack-completed';

export interface StackedSkillEvent {
  type: StackedSkillEventType;
  timestamp: number;
  data: Record<string, unknown>;
}
```

---

## 三、核心 API

### 3.1 类定义

```typescript
export class StackedSkillEngine {
  constructor(
    private skillEngine: SkillEngine,
    config?: Partial<StackedSkillConfig>
  );

  // ============ 解析 ============

  /**
   * 解析堆叠技能命令
   * @param input 形如 "/code-review /security-scanner src/foo.ts"
   * @returns 解析后的命令，无法解析时返回 null
   */
  parseStackedCommand(input: string): StackedCommand | null;

  // ============ 验证 ============

  /**
   * 验证技能组合是否合法
   * @param skillNames 技能名称列表
   * @returns 验证结果 + 冲突 + 警告
   */
  validateComposition(skillNames: string[]): CompositionCheckResult;

  // ============ 执行 ============

  /**
   * 执行堆叠技能
   * @param input 堆叠命令字符串
   * @param options 执行选项
   */
  async executeStack(
    input: string,
    options?: {
      sharedContext?: boolean;
      parallelExecution?: boolean;
      stopOnFirstFailure?: boolean;
    }
  ): Promise<StackedExecutionResult>;

  /**
   * 直接执行（已解析的命令）
   */
  async executeParsed(
    command: StackedCommand,
    options?: {
      parallelExecution?: boolean;
      stopOnFirstFailure?: boolean;
    }
  ): Promise<StackedExecutionResult>;

  // ============ 工具冲突检测 ============

  /**
   * 检测技能间 allowedTools 冲突
   * @returns 冲突的工具列表
   */
  detectToolConflicts(skillNames: string[]): Array<{
    tool: string;
    skills: string[];
    modes: string[];
  }>;

  // ============ 事件订阅 ============

  on(event: StackedSkillEventType, listener: (e: StackedSkillEvent) => void): () => void;

  // ============ 持久化 ============

  load(): void;
  save(): void;
}

export function getDefaultStackedSkillEngine(): StackedSkillEngine;
export function resetDefaultStackedSkillEngine(): void;
```

### 3.2 关键算法

#### 3.2.1 解析算法

```
输入："/code-review /security-scanner --strict /refactor src/foo.ts"
步骤：
1. 拆分 tokens（/command 开头视为技能）
2. 第一个 / 后是第一个技能名
3. 后续 /xxx 也是技能（直到非 / 开头）
4. 非 / 开头的 token 视为 args
输出：
  skillNames: ['code-review', 'security-scanner', 'refactor']
  args: '--strict src/foo.ts'
```

#### 3.2.2 工具冲突检测

```
输入：skillNames = ['code-review', 'security-scanner']
code-review.allowedTools: ['read', 'search', 'diff']
security-scanner.allowedTools: ['read', 'grep', 'exec']
输出：
  conflicts: [
    { tool: 'read', skills: ['code-review', 'security-scanner'], modes: ['allow', 'allow'] }
  ]
```

#### 3.2.3 并行执行

```
输入：3 个技能，parallelExecution = true
执行：
  await Promise.all([
    skillEngine.invokeSkill('code-review', args),
    skillEngine.invokeSkill('security-scanner', args),
    skillEngine.invokeSkill('refactor', args),
  ])
注意：所有超时控制 + 错误捕获
```

#### 3.2.4 串行执行

```
输入：3 个技能，parallelExecution = false
执行：
  for (const name of skillNames) {
    const result = await skillEngine.invokeSkill(name, args);
    if (stopOnFirstFailure && !result.success) break;
  }
```

---

## 四、UI 组件

### 4.1 StackedSkillsPanel.tsx

**位置**：`frontend/src/components/StackedSkillsPanel.tsx`

**功能**：
- 三个 Tab：组合（Builder）/ 历史（History）/ 统计（Stats）
- Builder Tab：
  - 技能选择器（最多选 5 个）
  - 命令参数输入
  - 实时组合验证（显示冲突/警告）
  - "执行" 按钮
  - 执行结果展示（按顺序展示每个技能输出）
- History Tab：
  - 历史堆叠执行记录（最近 50 条）
  - 成功/失败标识
  - 总耗时 + 各技能耗时
- Stats Tab：
  - 最常用组合 Top 10
  - 平均成功率
  - 平均耗时

**Props**：
```typescript
interface StackedSkillsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  triggerCommand?: string;  // 外部触发命令
}
```

**data-testid 规范**：
- `stacked-skills-panel`
- `stacked-skills-tab-builder` / `stacked-skills-tab-history` / `stacked-skills-tab-stats`
- `stacked-skills-skill-selector` / `stacked-skills-args-input` / `stacked-skills-execute-btn`
- `stacked-skills-result-skill-{name}` / `stacked-skills-conflict-{type}`

---

## 五、测试策略

### 5.1 单元测试 (skillEngineStacked.test.ts)

**目标**：25+ 个测试用例

```typescript
describe('StackedSkillEngine', () => {
  describe('parseStackedCommand', () => {
    it('解析单技能命令');
    it('解析 2-5 个堆叠技能');
    it('拒绝超过 5 个技能');
    it('拒绝包含非 / 开头的 token 在中间');
    it('解析带参数的命令');
    it('解析纯 / 命令返回 null');
  });

  describe('validateComposition', () => {
    it('验证 1 个技能（无冲突）');
    it('检测工具冲突');
    it('检测权限冲突');
    it('检测禁用技能');
    it('检测不存在的技能');
  });

  describe('executeStack - 串行', () => {
    it('按顺序执行');
    it('stopOnFirstFailure=true 时中断');
    it('全部成功时 aggregatedOutput 拼接');
  });

  describe('executeStack - 并行', () => {
    it('并行执行所有技能');
    it('部分失败时其他继续');
    it('全部失败时返回失败结果');
  });

  describe('detectToolConflicts', () => {
    it('无冲突返回空数组');
    it('检测重叠的 allowedTools');
    it('检测冲突的 permissions');
  });

  describe('事件系统', () => {
    it('订阅 stack-parsed');
    it('订阅 skill-completed');
    it('订阅 stack-completed');
    it('取消订阅');
  });

  describe('持久化', () => {
    it('执行历史写入 localStorage');
    it('从 localStorage 恢复');
  });
});
```

### 5.2 组件测试 (StackedSkillsPanel.test.tsx)

**目标**：8-10 个测试用例

```typescript
describe('StackedSkillsPanel', () => {
  it('打开/关闭面板');
  it('切换三个 Tab');
  it('选择技能 + 输入参数 + 执行');
  it('显示组合冲突警告');
  it('显示执行结果');
  it('历史 Tab 展示记录');
  it('统计 Tab 展示数据');
  it('拒绝超过 5 个技能');
  it('外部 triggerCommand 触发执行');
});
```

### 5.3 E2E 测试

添加到 `Cycle29E2E.test.tsx`：
- Stacked Skills 端到端
- 与 UsageAttribution 集成
- 与 CostBudget 集成

---

## 六、文件清单

### 6.1 新增文件
- `frontend/src/utils/stackedSkillEngine.ts` (~400 行)
- `frontend/src/utils/stackedSkillEngine.test.ts` (~250 行)
- `frontend/src/components/StackedSkillsPanel.tsx` (~300 行)
- `frontend/src/components/StackedSkillsPanel.test.tsx` (~150 行)
- `frontend/src/components/Cycle29E2E.test.tsx` (E2E)

### 6.2 修改文件
- `frontend/src/components/AppLayout.tsx` (新增 prop onOpenStackedSkills)
- `frontend/src/components/BrandHeader.tsx` (新增菜单项 + prop)
- `frontend/src/App.tsx` (集成新面板)

---

## 七、依赖关系

```
StackedSkillEngine
  ├─> SkillEngine (Cycle 28 G28-01)
  ├─> localStorage
  └─> EventEmitter (内置)
```

不依赖其他 Cycle 29 任务，可独立开发。

---

## 八、成功标准

- ✅ 25+ 单元测试全部通过
- ✅ 8+ 组件测试全部通过
- ✅ 5+ E2E 测试全部通过
- ✅ TypeScript 严格模式 0 错误
- ✅ 顶部菜单可见入口
- ✅ 不破坏现有测试（3357 个全通过）

---

## 九、参考资源

- [Claude Code v2.1.199 Stacked Skills](https://dreaming.press/posts/claude-code-july-2026-stacked-skills-pause-by-default.html)
- [Codex SKILL.md 标准](https://github.com/The-MDC/codex-cli-best-practice/blob/main/docs/SKILLS.md)
- [Cycle 28 G28-01 Skills 实现](file:///home/qizheng/auto_code_ws/frontend/src/utils/skillEngine.ts)
