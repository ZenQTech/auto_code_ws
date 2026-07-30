# Cycle 28 G28-01 Skills System SPEC

**Cycle**: 28 G28-01
**Date**: 2026-07-30
**Reference**: OpenAI Codex 2025-12 Agent Skills
**Base Version**: v6.72.0

---

## 1. 概述

实现 Codex 风格的 Agent Skills 机制，将 Cycle 27 的 AgentTemplate 升级为**可执行技能包**，支持 SKILL.md 结构化定义、渐进式披露、隐式匹配、显式调用。

## 2. 核心能力

### 2.1 SKILL.md 结构
```yaml
---
name: code-review
description: 自动审查代码变更，输出结构化报告。触发词：review, 审查, 代码评审, code review
version: 1.0.0
author: hermes
tags: [code-quality, automation]
allowed-tools: [read, search, diff]
constraints: [no-modify, no-execute]
---

# Code Review Skill

## 触发条件
- 用户说"review 这个 PR"
- 用户说"审查代码"
- 任务描述包含 "code review" 关键词

## 执行步骤
1. 读取 diff
2. 检查代码风格
3. 运行静态分析
4. 输出报告

## 脚本
- scripts/lint.sh
- scripts/format.sh

## 参考资料
- references/style-guide.md
```

### 2.2 渐进式披露
- 启动时仅加载 `name` + `description` + `path`
- 总量上限 2% context window 或 8000 字符
- 触发使用时才读取完整内容
- 安装过多 Skill 时按 description 长度排序

### 2.3 匹配机制
- **显式调用**: 用户输入 `$code-review` 或 `/code-review`
- **隐式匹配**: description 与任务描述相似度 > 阈值
- 匹配阈值默认 0.6，可配置
- 命中后自动激活 Skill

### 2.4 目录结构
```
skills/
  code-review/
    SKILL.md              # 必需
    scripts/              # 可选
      lint.sh
      format.sh
    references/           # 可选
      style-guide.md
    assets/               # 可选
      template.md
    agents/
      openai.yaml         # 可选
```

## 3. 数据模型

### Skill 类型
```typescript
interface Skill {
  id: string;                  // UUID
  name: string;                // kebab-case，唯一
  description: string;         // 匹配用
  version: string;             // semver
  author: string;
  tags: string[];
  path: string;                // 目录路径
  allowedTools: string[];      // 工具白名单
  constraints: string[];       // 约束条件
  body: string;                // SKILL.md 正文
  scripts: SkillScript[];      // 脚本列表
  references: SkillReference[]; // 参考资料
  assets: SkillAsset[];        // 资源列表
  builtin: boolean;            // 是否内置
  installed: boolean;          // 是否已安装
  enabled: boolean;            // 是否启用
  installedAt?: number;
  usageCount: number;
  lastUsedAt?: number;
  metadata: Record<string, unknown>;
}

interface SkillScript {
  name: string;
  path: string;
  language: 'bash' | 'python' | 'node' | 'other';
  description: string;
}

interface SkillReference {
  name: string;
  path: string;
  type: 'doc' | 'example' | 'spec';
}

interface SkillAsset {
  name: string;
  path: string;
  type: 'template' | 'image' | 'binary';
}
```

### 事件类型
- `skill-installed` / `skill-uninstalled`
- `skill-enabled` / `skill-disabled`
- `skill-matched` (隐式匹配成功)
- `skill-invoked` (显式调用)
- `skill-completed` / `skill-failed`
- `skill-usage-tracked` (使用统计)

## 4. 核心 API

### SkillEngine

```typescript
class SkillEngine {
  // 生命周期
  installSkill(source: string | Skill): Skill;
  uninstallSkill(skillId: string): boolean;
  enableSkill(skillId: string): boolean;
  disableSkill(skillId: string): boolean;
  
  // 匹配
  matchSkills(prompt: string, options?: { topK?: number; threshold?: number }): SkillMatch[];
  invokeSkill(skillName: string, args: Record<string, unknown>): Promise<SkillExecutionResult>;
  
  // 渐进式披露
  loadSkillSummary(skillId: string): SkillSummary;
  loadSkillFull(skillId: string): Skill;
  
  // CRUD
  createSkill(config: SkillConfig): Skill;
  updateSkill(skillId: string, updates: Partial<Skill>): Skill;
  getSkill(skillId: string): Skill | undefined;
  getSkillByName(name: string): Skill | undefined;
  listSkills(filter?: { enabled?: boolean; builtin?: boolean; tag?: string }): Skill[];
  
  // 导入导出
  exportSkill(skillId: string): string;  // 返回 SKILL.md 内容
  importSkill(skillContent: string, basePath: string): Skill;
  
  // 统计
  getStats(): SkillStats;
  recordUsage(skillId: string, success: boolean): void;
  
  // 事件
  on(event: SkillEventType, listener: (e: SkillEvent) => void): () => void;
}
```

### 内置 Skills (Cycle 28 内置 5 个)
1. **code-review**: 自动代码审查
2. **test-generator**: 自动生成单元测试
3. **refactor-assistant**: 安全重构助手
4. **doc-generator**: 自动生成 API 文档
5. **security-scanner**: 安全漏洞扫描

## 5. 测试策略

### 单元测试 (~30 个)
- SKILL.md 解析
- 名称校验（kebab-case）
- description 长度校验
- 渐进式披露：仅加载 name/description/path
- 隐式匹配：阈值与 topK
- 显式调用：`$skill-name` 解析
- 安装/卸载/启用/禁用
- 导入/导出
- 持久化（localStorage）
- 事件订阅

### 组件测试 (~15 个)
- SkillsPanel 列表/详情/创建
- Skill 详情查看
- 创建表单
- 搜索过滤
- 启用/禁用开关

### E2E 测试 (5 个)
- 完整安装流程
- 隐式匹配到调用
- 显式调用
- 持久化与重载
- 统计与使用记录

## 6. 验收标准

- [x] SkillEngine 实现
- [x] 5 个内置 Skills
- [x] 渐进式披露生效
- [x] 隐式匹配准确率 > 80%
- [x] 显式调用稳定
- [x] SkillsPanel UI 完整
- [x] App.tsx 集成
- [x] BrandHeader 菜单项
- [x] 30+ 单元测试通过
- [x] 15+ 组件测试通过
- [x] 5+ E2E 测试通过
- [x] TypeScript 零错误

## 7. 后续扩展

- Skills Marketplace（跨项目分享）
- Skills 版本管理
- Skills 依赖关系
- Skills 测试用例

---

**G28-01 SPEC 完成度**: 100%
