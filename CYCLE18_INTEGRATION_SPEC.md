# CYCLE18_INTEGRATION_SPEC - Composer 引用解析与规则系统集成

> **日期**: 2026-07-29
> **Cycle**: Cycle 18 P0-1
> **版本**: v6.38.0
> **目标**: 将已实现的 referenceResolvers + hermesRules 集成到 Composer 引擎
> **关联文件**:
> - [CYCLE18_GAP_ANALYSIS.md](./CYCLE18_GAP_ANALYSIS.md)
> - [CYCLE18_SPEC_REFERENCES.md](./CYCLE18_SPEC_REFERENCES.md)
> - [CYCLE18_SPEC_PROJECT_RULES.md](./CYCLE18_SPEC_PROJECT_RULES.md)

---

## 一、背景

### 1.1 当前状态

- `referenceResolvers.ts` (654 行) + 31 测试 100% 通过
  - 实现了 `resolveCodebase` / `resolveGit` / `resolveDiff` 三个 resolver
  - 实现了 `formatCodebaseForPrompt` / `formatGitForPrompt` / `formatDiffForPrompt` 格式化函数
  - 实现了 LRU 缓存 + 敏感路径过滤
- `hermesRules.ts` (580 行) + 32 测试 100% 通过
  - 实现了 `validateRules` / `parseYaml` / `parseAndValidateYaml`
  - 实现了 `RULES_TEMPLATES` 5 套预置模板
  - 实现了 `injectRulesIntoPrompt` 注入到 system prompt

### 1.2 缺口

- Composer **解析** @codebase / @git / @diff 后，**没有真正调用** resolver 去获取数据
- 解析后的 `ParsedReference` 仅记录 `type + value`，缺少 `resolved context` 字段
- 项目级规则只在文件层存在，**没有** Composer Engine 集成
- 用户看不到哪些规则生效、哪些引用被解析

---

## 二、目标

### 2.1 引用解析集成（P0）

#### 解析层

1. `parseReferences` 完成后，**自动** 调用对应的 resolver：
   - `codebase` → `resolveCodebase(value)`
   - `git:log` / `git:blame` → `resolveGit(...)`
   - `diff:working` / `diff:HEAD` → `resolveDiff(...)`
2. 解析结果添加 `resolvedContext` 字段（type + data + source + resolvedAt）
3. 解析失败不阻塞流程，记录到 `resolutionErrors`

#### 上下文组装

1. `composerEngine.buildPromptContext()` 新增 `resolvedReferences: ResolvedReference[]`
2. `buildPromptContext` 输出按顺序拼接：
   - system prompt（含 rules 注入）
   - 项目级 rules summary
   - resolved references（按 type 分组）
   - 文件级 references
   - 用户 prompt

#### UI 层

1. `MentionMenu` 解析后的引用有"已解析/解析中/解析失败"三种状态徽章
2. Composer 输入框上方显示"已注入 N 个引用"提示
3. 点击引用显示 resolved context 详情（codebase snippet / git commit / diff stats）

### 2.2 规则系统集成（P0）

#### 规则加载

1. Composer 启动时加载 `.hermesrules.yaml`（项目根目录）
2. 加载失败 → fallback 到 `DEFAULT_RULES` + Toast 警告
3. 规则变更时实时同步到 Composer state

#### 规则注入

1. `composerEngine.injectRules()` 把 `HermesRules` 转为 system prompt 段落
2. 注入位置：user prompt **之前**
3. 注入格式：`<hermes_rules>...</hermes_rules>` 包裹便于 LLM 识别

#### UI 层

1. `RulesPanel` 模态：可视化编辑 + 实时预览
2. 5 套预置模板选择（TypeScript Strict / Python PEP8 / React Best / Vue Best / Generic）
3. 当前规则摘要显示在 Composer 底部状态栏

---

## 三、API 设计

### 3.1 扩展 ParsedReference

```typescript
interface ParsedReference {
  type: ContextType;
  value: string;
  range: { start: number; end: number };
  // 新增字段
  resolutionState?: 'pending' | 'resolving' | 'resolved' | 'failed';
  resolvedContext?: CodebaseContext | GitContext | DiffContext;
  resolutionError?: ResolverError;
}
```

### 3.2 Composer 引擎 API

```typescript
class ComposerEngine {
  // 新增 API
  resolveAllReferences(): Promise<ResolvedReference[]>;
  getResolvedReferences(): ResolvedReference[];
  loadProjectRules(): Promise<HermesRules>;
  setProjectRules(rules: HermesRules): void;
  getProjectRules(): HermesRules;
  injectRules(rules: HermesRules): string;
  buildPromptContext(): PromptContext;
}
```

### 3.3 useComposer Hook 暴露

```typescript
const {
  // 现有 API
  // ...
  // 新增
  resolvedReferences,
  resolutionErrors,
  resolveAllReferences,
  projectRules,
  setProjectRules,
  reloadProjectRules,
} = useComposer();
```

---

## 四、UI 组件

### 4.1 ResolvedReferencesBar

- 位置：Composer 输入框上方
- 内容：横排小卡片，每个 reference 一个
  - 图标（按 type 不同）
  - 名称（value）
  - 状态徽章（pending / resolved / failed）
  - 悬停显示 resolved context 摘要

### 4.2 RulesStatusBadge

- 位置：Composer 底部状态栏
- 内容：当前规则模板名 + 规则数 + 点击打开 RulesPanel

### 4.3 RulesPanel（模态）

- 5 个预置模板卡片
- 当前规则的可视化编辑（折叠面板）
- 实时 YAML 预览
- 验证错误高亮
- 保存/取消/重置按钮

### 4.4 ReferenceDetailModal

- 点击已解析引用时显示
- 根据 type 显示：
  - codebase：文件路径 + snippet + score
  - git：commit 列表 / blame 信息 / branch status
  - diff：文件状态 + hunk 内容

---

## 五、测试策略

### 5.1 单元测试

- `composerEngine.references.test.ts` 新增：解析后自动调用 resolver
- `composerEngine.rules.test.ts` 新增：规则加载 + 注入
- `useComposer.test.tsx` 新增：暴露新 API

### 5.2 集成测试

- `composer-references-integration.test.tsx`：解析 + 解析 + 注入
- `composer-rules-integration.test.tsx`：规则加载 + 注入 + UI 联动

### 5.3 E2E 验证

- `test_e2e_cycle18_p0_1.sh`：文件存在 + API 覆盖 + 测试通过 + TypeScript

---

## 六、验收标准

- ✅ 单元测试覆盖 ≥ 90% 关键路径
- ✅ 集成测试覆盖 UI 交互流
- ✅ E2E 验证脚本 ≥ 30 断言
- ✅ TypeScript 零错误
- ✅ 完整测试套件 100% 通过
- ✅ Loop Engineering 工作流不破坏
- ✅ 文档齐全（Spec + Summary + E2E 脚本）
