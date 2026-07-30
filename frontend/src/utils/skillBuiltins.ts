/**
 * # ============================================================
 * # Built-in Skills - 内置技能 (v1.0.0 Cycle 28 G28-01)
 * # ============================================================
 * # 核心作用：提供 5 个内置 Skills（SKILL.md 字符串）
 * # 包含：code-review / test-generator / refactor-assistant
 * #       doc-generator / security-scanner
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-01 初次创建
 * # ============================================================
 */

/**
 * 5 个内置 Skills 的 SKILL.md 原始内容
 */
export const BUILTIN_SKILLS_MD: Record<string, string> = {
  'code-review': `---
name: code-review
description: 自动审查代码变更，输出结构化报告。触发词：review, 审查, 代码评审, code review, pr review
version: 1.0.0
author: hermes
tags: [code-quality, automation, review]
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

## 输出
- 严重度分级（critical / major / minor）
- 分类统计（bug / performance / style / security）
- 修复建议
`,

  'test-generator': `---
name: test-generator
description: 自动生成单元测试。触发词：test, 测试, unit test, generate test, 写测试
version: 1.0.0
author: hermes
tags: [testing, automation, quality]
allowed-tools: [read, write, search]
constraints: [no-execute]
---

# Test Generator Skill

## 触发条件
- 用户说"给这个文件加测试"
- 用户说"生成单元测试"
- 任务描述包含 "test" 或 "测试" 关键词

## 执行步骤
1. 读取源文件
2. 分析函数签名
3. 生成 happy path / edge case / error case 测试
4. 输出测试代码

## 输出
- 完整测试文件
- 覆盖率说明
`,

  'refactor-assistant': `---
name: refactor-assistant
description: 安全重构助手。触发词：refactor, 重构, optimize, 优化, 改善
version: 1.0.0
author: hermes
tags: [refactor, quality, optimization]
allowed-tools: [read, write, search, diff]
constraints: [require-test-pass]
---

# Refactor Assistant Skill

## 触发条件
- 用户说"重构这个模块"
- 用户说"优化代码"
- 任务描述包含 "refactor" 或 "重构" 关键词

## 执行步骤
1. 读取目标文件
2. 检查现有测试
3. 制定重构计划
4. 应用重构
5. 验证测试通过

## 输出
- 重构前后 diff
- 重构理由说明
`,

  'doc-generator': `---
name: doc-generator
description: 自动生成 API 文档。触发词：document, 文档, doc, api doc, 生成文档
version: 1.0.0
author: hermes
tags: [documentation, automation]
allowed-tools: [read, search]
constraints: [no-modify]
---

# Doc Generator Skill

## 触发条件
- 用户说"生成 API 文档"
- 用户说"补充注释"
- 任务描述包含 "doc" 或 "文档" 关键词

## 执行步骤
1. 扫描导出符号
2. 提取 JSDoc / 类型签名
3. 生成 Markdown 文档
4. 生成 changelog 片段

## 输出
- API.md
- CHANGELOG 片段
`,

  'security-scanner': `---
name: security-scanner
description: 安全漏洞扫描。触发词：security, 安全, scan, 扫描, vulnerability, 漏洞
version: 1.0.0
author: hermes
tags: [security, scan, audit]
allowed-tools: [read, search]
constraints: [no-modify, no-execute]
---

# Security Scanner Skill

## 触发条件
- 用户说"扫描安全漏洞"
- 用户说"security scan"
- 任务描述包含 "security" 或 "安全" 关键词

## 执行步骤
1. 扫描依赖（npm audit）
2. 扫描代码（XSS / SQLi / 硬编码密钥）
3. 检查权限配置
4. 输出报告

## 输出
- 漏洞列表（含严重度）
- 修复建议
- CVE 编号
`,
};

/**
 * 获取内置 Skill 的元数据（用于初始化）
 */
export const BUILTIN_SKILL_METADATA: Record<
  string,
  { name: string; description: string; version: string; tags: string[]; allowedTools: string[]; constraints: string[] }
> = {
  'code-review': {
    name: 'code-review',
    description: '自动审查代码变更，输出结构化报告。触发词：review, 审查, 代码评审, code review, pr review',
    version: '1.0.0',
    tags: ['code-quality', 'automation', 'review'],
    allowedTools: ['read', 'search', 'diff'],
    constraints: ['no-modify', 'no-execute'],
  },
  'test-generator': {
    name: 'test-generator',
    description: '自动生成单元测试。触发词：test, 测试, unit test, generate test, 写测试',
    version: '1.0.0',
    tags: ['testing', 'automation', 'quality'],
    allowedTools: ['read', 'write', 'search'],
    constraints: ['no-execute'],
  },
  'refactor-assistant': {
    name: 'refactor-assistant',
    description: '安全重构助手。触发词：refactor, 重构, optimize, 优化, 改善',
    version: '1.0.0',
    tags: ['refactor', 'quality', 'optimization'],
    allowedTools: ['read', 'write', 'search', 'diff'],
    constraints: ['require-test-pass'],
  },
  'doc-generator': {
    name: 'doc-generator',
    description: '自动生成 API 文档。触发词：document, 文档, doc, api doc, 生成文档',
    version: '1.0.0',
    tags: ['documentation', 'automation'],
    allowedTools: ['read', 'search'],
    constraints: ['no-modify'],
  },
  'security-scanner': {
    name: 'security-scanner',
    description: '安全漏洞扫描。触发词：security, 安全, scan, 扫描, vulnerability, 漏洞',
    version: '1.0.0',
    tags: ['security', 'scan', 'audit'],
    allowedTools: ['read', 'search'],
    constraints: ['no-modify', 'no-execute'],
  },
};
