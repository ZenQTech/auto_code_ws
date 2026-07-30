/**
 * # ============================================================
 * # Marketplace Samples - 技能市场示例数据 (v1.0.0 Cycle 29 G29-02)
 * # ============================================================
 * # 核心作用：提供 Skills Marketplace 的初始技能样本数据
 * # 数据来源：模拟 skills-hub.ai，6 个示例技能
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 29 G29-02 初次创建
 * # ============================================================
 */

import type { MarketplaceSkill, MarketplaceComment } from './marketplaceTypes';

const now = 1717200000000; // 2024-06-01 基准时间戳
const day = 24 * 60 * 60 * 1000;

export const SAMPLE_MARKETPLACE_SKILLS: MarketplaceSkill[] = [
  {
    id: 'mp-code-review-pro',
    name: 'code-review-pro',
    displayName: 'Code Review Pro',
    description: '高级代码审查：架构、命名、安全、性能多维度评审',
    longDescription:
      '结合 SonarQube + ESLint + 安全扫描的最佳实践，提供 12 维度代码审查，输出严重度分级报告。' +
      '支持 20+ 编程语言，可与 CI/CD 集成。',
    author: 'Hermes Team',
    authorVerified: true,
    category: 'code-quality',
    tags: ['review', 'quality', 'lint', 'static-analysis'],
    version: '2.4.1',
    publishedAt: now - 90 * day,
    updatedAt: now - 7 * day,
    installs: 18420,
    weeklyActiveUsers: 4321,
    rating: 4.8,
    ratingCount: 921,
    thumbnail: '🔍',
    repositoryUrl: 'https://github.com/hermes-ai/code-review-pro',
    documentationUrl: 'https://docs.hermes-ai.dev/skills/code-review-pro',
    installed: false,
    compatibility: ['codex', 'claude-code', 'hermes'],
    requiredPermissions: ['file:read', 'git:read'],
    estimatedTokenCost: 850,
  },
  {
    id: 'mp-refactor-assistant',
    name: 'refactor-assistant',
    displayName: 'Refactor Assistant',
    description: '智能重构助手：识别代码异味 + 自动生成重构方案',
    longDescription:
      '基于 Martin Fowler《重构》第二版的目录结构，识别 60+ 种代码异味，' +
      '自动推荐 Extract Method / Move Method / Replace Conditional with Polymorphism 等重构手法。',
    author: 'RefactorPro',
    authorVerified: true,
    category: 'refactoring',
    tags: ['refactor', 'clean-code', 'patterns'],
    version: '1.8.3',
    publishedAt: now - 60 * day,
    updatedAt: now - 14 * day,
    installs: 12380,
    weeklyActiveUsers: 2871,
    rating: 4.6,
    ratingCount: 542,
    thumbnail: '🔧',
    repositoryUrl: 'https://github.com/refactorpro/assistant',
    documentationUrl: 'https://docs.refactorpro.dev',
    installed: false,
    compatibility: ['claude-code', 'hermes'],
    requiredPermissions: ['file:read', 'file:write'],
    estimatedTokenCost: 1200,
  },
  {
    id: 'mp-ci-cd-pipeline',
    name: 'ci-cd-pipeline',
    displayName: 'CI/CD Pipeline Generator',
    description: '一键生成多平台 CI/CD 流水线配置',
    longDescription:
      '支持 GitHub Actions / GitLab CI / CircleCI / Jenkins / Drone 等 8 种平台，' +
      '自动检测项目类型（Node/Python/Go/Rust/Java）并生成最优流水线。',
    author: 'DevOpsKit',
    authorVerified: true,
    category: 'devops',
    tags: ['ci', 'cd', 'github-actions', 'gitlab', 'pipeline'],
    version: '3.1.0',
    publishedAt: now - 120 * day,
    updatedAt: now - 3 * day,
    installs: 9821,
    weeklyActiveUsers: 1892,
    rating: 4.7,
    ratingCount: 412,
    thumbnail: '⚙️',
    repositoryUrl: 'https://github.com/devopskit/pipeline',
    installed: false,
    compatibility: ['codex', 'claude-code', 'hermes'],
    requiredPermissions: ['file:write', 'git:write'],
    estimatedTokenCost: 650,
  },
  {
    id: 'mp-security-audit',
    name: 'security-audit',
    displayName: 'Security Audit Pro',
    description: 'OWASP Top 10 + CWE 完整安全审计',
    longDescription:
      '覆盖 OWASP Top 10 2021 + CWE Top 25 危险弱点，' +
      '包含 SQL 注入 / XSS / CSRF / SSRF / 路径遍历 / 不安全反序列化等检测。' +
      '支持 SAST + DAST 双模式，输出 CVSS 评分。',
    author: 'SecOps',
    authorVerified: true,
    category: 'security',
    tags: ['security', 'owasp', 'cwe', 'sast', 'dast'],
    version: '4.2.0',
    publishedAt: now - 200 * day,
    updatedAt: now - 1 * day,
    installs: 15432,
    weeklyActiveUsers: 3421,
    rating: 4.9,
    ratingCount: 721,
    thumbnail: '🔒',
    repositoryUrl: 'https://github.com/secops/audit',
    documentationUrl: 'https://secops.dev/docs',
    installed: false,
    compatibility: ['codex', 'claude-code', 'hermes'],
    requiredPermissions: ['file:read', 'network:read'],
    estimatedTokenCost: 1500,
  },
  {
    id: 'mp-api-design',
    name: 'api-design',
    displayName: 'API Design Advisor',
    description: 'RESTful / GraphQL / gRPC API 设计建议',
    longDescription:
      '基于 Google API Design Guide + Microsoft REST API Guidelines，' +
      '提供 URL 命名、版本控制、错误处理、限流、安全认证等 20+ 维度的设计建议。' +
      '支持 OpenAPI 3.0 规范自动生成。',
    author: 'APIGurus',
    authorVerified: true,
    category: 'integration',
    tags: ['api', 'rest', 'graphql', 'grpc', 'openapi'],
    version: '2.0.5',
    publishedAt: now - 150 * day,
    updatedAt: now - 21 * day,
    installs: 7821,
    weeklyActiveUsers: 1421,
    rating: 4.5,
    ratingCount: 312,
    thumbnail: '🔌',
    repositoryUrl: 'https://github.com/apigurus/design-advisor',
    installed: false,
    compatibility: ['claude-code', 'hermes'],
    requiredPermissions: ['file:read'],
    estimatedTokenCost: 750,
  },
  {
    id: 'mp-quickstart',
    name: 'quickstart',
    displayName: 'Project Quickstart',
    description: '项目脚手架生成器：20+ 框架模板',
    longDescription:
      '内置 React/Vue/Angular/Next.js/Nuxt/Svelte/Express/FastAPI/Django/Spring Boot 等 20+ 框架模板，' +
      '一键生成项目脚手架，包含 ESLint/Prettier/TypeScript/Husky/CI 等最佳实践配置。',
    author: 'Hermes Team',
    authorVerified: true,
    category: 'productivity',
    tags: ['scaffold', 'template', 'boilerplate', 'starter'],
    version: '5.3.2',
    publishedAt: now - 300 * day,
    updatedAt: now - 2 * day,
    installs: 24521,
    weeklyActiveUsers: 5421,
    rating: 4.7,
    ratingCount: 1121,
    thumbnail: '⚡',
    repositoryUrl: 'https://github.com/hermes-ai/quickstart',
    documentationUrl: 'https://docs.hermes-ai.dev/quickstart',
    installed: false,
    compatibility: ['codex', 'claude-code', 'hermes'],
    requiredPermissions: ['file:write'],
    estimatedTokenCost: 450,
  },
];

export const SAMPLE_MARKETPLACE_COMMENTS: MarketplaceComment[] = [
  {
    id: 'cmt-1',
    skillId: 'mp-code-review-pro',
    author: 'frontend_dev',
    rating: 5,
    content: '非常好用的代码审查工具，集成到 CI 后团队代码质量明显提升。',
    sentiment: 'positive',
    createdAt: now - 5 * day,
    helpful: 23,
    flagged: false,
  },
  {
    id: 'cmt-2',
    skillId: 'mp-code-review-pro',
    author: 'backend_lead',
    rating: 4,
    content: '对 TypeScript 项目支持很好，Python 类型推断有待提升。',
    sentiment: 'positive',
    createdAt: now - 12 * day,
    helpful: 15,
    flagged: false,
  },
  {
    id: 'cmt-3',
    skillId: 'mp-refactor-assistant',
    author: 'clean_coder',
    rating: 5,
    content: '基于经典重构手法，效果惊艳，强烈推荐。',
    sentiment: 'positive',
    createdAt: now - 7 * day,
    helpful: 31,
    flagged: false,
  },
  {
    id: 'cmt-4',
    skillId: 'mp-security-audit',
    author: 'security_pro',
    rating: 5,
    content: '覆盖 OWASP Top 10 完整，CWE 评分准确，比商业工具便宜。',
    sentiment: 'positive',
    createdAt: now - 3 * day,
    helpful: 42,
    flagged: false,
  },
  {
    id: 'cmt-5',
    skillId: 'mp-quickstart',
    author: 'newbie',
    rating: 4,
    content: '脚手架很全面，模板有些过时。',
    sentiment: 'neutral',
    createdAt: now - 18 * day,
    helpful: 8,
    flagged: false,
  },
];
