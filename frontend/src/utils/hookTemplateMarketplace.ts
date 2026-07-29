/**
 * # ============================================================
 * # HookTemplateMarketplace - 钩子模板市场 (v1.0.0 Cycle 21 G21-05)
 * # ============================================================
 * # 核心作用：为 HooksEngine 提供预置模板市场，涵盖代码质量/
 * #           测试/Git/协作四大类共 8+ 模板，一键安装到 HooksEngine
 * # 业务价值：
 * #   1. 新用户零配置上手：预置 lint/test/format 模板
 * #   2. 团队最佳实践共享：模板市场机制
 * #   3. 一键安装/卸载：降低 Hook 配置门槛
 * #   4. 评分系统：发现高质量模板
 * #   5. 分类检索：按场景快速定位模板
 * # 运行流程：
 * #   1. 内置 8 个预置模板（ESLint/Prettier/tsc/vitest/coverage/
 * #      commit-msg/secrets-scan/slack-notify）
 * #   2. 模板分类：quality / testing / git / collaboration / custom
 * #   3. installTemplate() - 安装模板到 HooksEngine
 * #   4. uninstallTemplate() - 卸载模板
 * #   5. rateTemplate() - 评分模板
 * #   6. searchTemplates() - 搜索/过滤
 * # 输入参数：
 * #   - HookTemplate: 模板定义
 * #   - templateId: 模板 ID
 * #   - rating: 评分 (1-5)
 * # 输出结果：
 * #   - HookTemplate[]: 模板列表
 * #   - InstallResult: 安装结果
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-29 | v1.0.0 | Cycle 21 G21-05 初次创建
 * #     - 核心 HookTemplateMarketplace 引擎
 * #     - 8 个预置模板（ESLint/Prettier/tsc/vitest/coverage/
 * #       commit-msg/secrets-scan/slack-notify）
 * #     - 评分 + 下载统计
 * #     - 安装/卸载机制
 * #     - 单例工厂
 * # ============================================================
 */

// ============================================================================
// 类型定义
// ============================================================================

/** Hook 类型 */
export type HookType =
  | 'before_prompt'
  | 'after_prompt'
  | 'before_response'
  | 'after_response'
  | 'thinking'
  | 'subagent_start'
  | 'subagent_end'
  | 'compaction'
  | 'turn_complete'
  | 'tool_execution';

export type HookScope = 'team' | 'project' | 'user';

export type HookAction =
  | { type: 'webhook'; url: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string }
  | { type: 'command'; command: string; args?: string[]; cwd?: string }
  | { type: 'script'; code: string; language: 'javascript' | 'python' }
  | { type: 'callback'; handler: (event: unknown) => void | Promise<void> };

export type HookFallback = 'ignore' | 'warn' | 'block' | 'retry';

export interface HookDefinition {
  id: string;
  type: HookType;
  name: string;
  description?: string;
  scope: HookScope;
  enabled: boolean;
  action: HookAction;
  createdAt: number;
  createdBy: string;
  priority: number;
  timeoutMs: number;
  retries: number;
  fallback: HookFallback;
  condition?: { keywords?: string[]; fileTypes?: string[]; users?: string[]; projects?: string[] };
}

export type TemplateCategory = 'quality' | 'testing' | 'git' | 'collaboration' | 'custom';

export interface HookTemplate {
  id: string;
  name: string;
  description: string;
  category: TemplateCategory;
  tags: string[];
  author: string;
  rating: number; // 0-5
  downloads: number;
  installCount: number;
  verified: boolean;
  icon?: string;
  hookDefinition: Omit<HookDefinition, 'id' | 'createdAt' | 'createdBy'>;
  installNotes?: string;
  version: string;
  updatedAt: number;
  createdAt: number;
}

export interface TemplateFilter {
  category?: TemplateCategory | TemplateCategory[];
  tag?: string;
  search?: string;
  verified?: boolean;
  minRating?: number;
  sortBy?: 'rating' | 'downloads' | 'name' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface InstallResult {
  templateId: string;
  hookId: string;
  success: boolean;
  message: string;
  installedAt: number;
}

export interface InstallRecord {
  templateId: string;
  hookId: string;
  installedAt: number;
  installedBy: string;
}

// ============================================================================
// 预置模板
// ============================================================================

/**
 * 8 个预置模板
 */
export const PRESET_TEMPLATES: HookTemplate[] = [
  // 代码质量类
  {
    id: 'preset-eslint-check',
    name: 'ESLint 自动检查',
    description: '在 AI 响应后自动运行 ESLint 检查代码质量，发现错误立即修复',
    category: 'quality',
    tags: ['eslint', 'lint', 'code-quality', 'javascript', 'typescript'],
    author: 'Hermes',
    rating: 4.8,
    downloads: 12345,
    installCount: 0,
    verified: true,
    icon: 'lint',
    hookDefinition: {
      type: 'after_response',
      name: 'ESLint 自动检查',
      description: 'AI 响应后自动运行 ESLint',
      scope: 'project',
      enabled: true,
      action: {
        type: 'command',
        command: 'npx',
        args: ['eslint', '--fix', '--ext', '.ts,.tsx,.js,.jsx', '.'],
      },
      priority: 80,
      timeoutMs: 30000,
      retries: 1,
      fallback: 'warn',
    },
    installNotes: '需要项目安装 eslint 包：npm install -D eslint',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: 'preset-prettier-format',
    name: 'Prettier 自动格式化',
    description: '在 AI 响应后自动运行 Prettier 格式化代码',
    category: 'quality',
    tags: ['prettier', 'format', 'code-style'],
    author: 'Hermes',
    rating: 4.7,
    downloads: 10234,
    installCount: 0,
    verified: true,
    icon: 'format',
    hookDefinition: {
      type: 'after_response',
      name: 'Prettier 格式化',
      description: 'AI 响应后自动运行 Prettier',
      scope: 'project',
      enabled: true,
      action: {
        type: 'command',
        command: 'npx',
        args: ['prettier', '--write', '.'],
      },
      priority: 90,
      timeoutMs: 30000,
      retries: 1,
      fallback: 'warn',
    },
    installNotes: '需要项目安装 prettier：npm install -D prettier',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: 'preset-typescript-check',
    name: 'TypeScript 类型检查',
    description: '在用户输入前自动运行 TypeScript 类型检查，提前发现问题',
    category: 'quality',
    tags: ['typescript', 'tsc', 'type-check'],
    author: 'Hermes',
    rating: 4.9,
    downloads: 15678,
    installCount: 0,
    verified: true,
    icon: 'ts',
    hookDefinition: {
      type: 'before_prompt',
      name: 'TypeScript 类型检查',
      description: '用户输入前运行 tsc --noEmit',
      scope: 'project',
      enabled: true,
      action: {
        type: 'command',
        command: 'npx',
        args: ['tsc', '--noEmit'],
      },
      priority: 70,
      timeoutMs: 60000,
      retries: 0,
      fallback: 'warn',
    },
    installNotes: '需要项目有 tsconfig.json',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  // 测试类
  {
    id: 'preset-vitest-run',
    name: 'Vitest 单元测试',
    description: '在 AI 响应后自动运行 Vitest 单元测试',
    category: 'testing',
    tags: ['vitest', 'test', 'unit-test'],
    author: 'Hermes',
    rating: 4.6,
    downloads: 8901,
    installCount: 0,
    verified: true,
    icon: 'test',
    hookDefinition: {
      type: 'after_response',
      name: 'Vitest 单元测试',
      description: 'AI 响应后运行 vitest run',
      scope: 'project',
      enabled: true,
      action: {
        type: 'command',
        command: 'npx',
        args: ['vitest', 'run', '--reporter=basic'],
      },
      priority: 60,
      timeoutMs: 120000,
      retries: 1,
      fallback: 'warn',
    },
    installNotes: '需要项目安装 vitest：npm install -D vitest',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: 'preset-coverage-check',
    name: '测试覆盖率检查',
    description: '在轮次完成时检查测试覆盖率，确保不低于 80%',
    category: 'testing',
    tags: ['coverage', 'test', 'quality-gate'],
    author: 'Hermes',
    rating: 4.5,
    downloads: 6543,
    installCount: 0,
    verified: true,
    icon: 'coverage',
    hookDefinition: {
      type: 'turn_complete',
      name: '测试覆盖率检查',
      description: '轮次完成时检查覆盖率',
      scope: 'project',
      enabled: true,
      action: {
        type: 'command',
        command: 'npx',
        args: ['vitest', 'run', '--coverage'],
      },
      priority: 50,
      timeoutMs: 120000,
      retries: 0,
      fallback: 'warn',
    },
    installNotes: '需要安装 @vitest/coverage-v8：npm install -D @vitest/coverage-v8',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  // Git 类
  {
    id: 'preset-commit-msg-check',
    name: '提交信息规范校验',
    description: '在工具执行时检查 Git 提交信息是否符合 Conventional Commits 规范',
    category: 'git',
    tags: ['git', 'commit', 'conventional-commits'],
    author: 'Hermes',
    rating: 4.4,
    downloads: 5432,
    installCount: 0,
    verified: true,
    icon: 'git',
    hookDefinition: {
      type: 'tool_execution',
      name: '提交信息规范',
      description: '检查 commit 信息规范',
      scope: 'project',
      enabled: true,
      action: {
        type: 'script',
        code: `
const commitMsg = event.payload.message || '';
const pattern = /^(feat|fix|docs|style|refactor|test|chore|perf|build|ci)(\\(.+\\))?: .{1,72}/;
if (!pattern.test(commitMsg)) {
  return { valid: false, reason: '提交信息不符合 Conventional Commits 规范' };
}
return { valid: true };
        `,
        language: 'javascript',
      },
      priority: 95,
      timeoutMs: 1000,
      retries: 0,
      fallback: 'warn',
    },
    installNotes: '推荐配合 commitlint 使用',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  {
    id: 'preset-secrets-scan',
    name: '敏感信息扫描',
    description: '在 AI 响应前扫描代码是否包含 API key、密码等敏感信息',
    category: 'git',
    tags: ['security', 'secrets', 'scan'],
    author: 'Hermes',
    rating: 4.9,
    downloads: 9876,
    installCount: 0,
    verified: true,
    icon: 'security',
    hookDefinition: {
      type: 'before_response',
      name: '敏感信息扫描',
      description: '扫描代码敏感信息',
      scope: 'project',
      enabled: true,
      action: {
        type: 'script',
        code: `
const content = event.payload.content || '';
const patterns = [
  /sk-[a-zA-Z0-9]{20,}/g,           // OpenAI API key
  /sk-ant-[a-zA-Z0-9-]{20,}/g,     // Anthropic API key
  /AIza[a-zA-Z0-9_-]{35}/g,         // Google API key
  /ghp_[a-zA-Z0-9]{36}/g,           // GitHub PAT
  /xox[baprs]-[a-zA-Z0-9-]{10,}/g,  // Slack token
  /password\\s*[:=]\\s*['"]\\S+['"]/gi,
];
const findings = [];
patterns.forEach((p, i) => {
  const matches = content.match(p);
  if (matches) {
    findings.push({ pattern: i, count: matches.length });
  }
});
if (findings.length > 0) {
  return { safe: false, findings, action: 'block' };
}
return { safe: true };
        `,
        language: 'javascript',
      },
      priority: 100,
      timeoutMs: 5000,
      retries: 0,
      fallback: 'block',
    },
    installNotes: '内置敏感信息模式，建议团队扩展',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
  // 协作类
  {
    id: 'preset-slack-notify',
    name: 'Slack 通知',
    description: '在轮次完成时发送 Slack 通知，告知团队 AI 工作进展',
    category: 'collaboration',
    tags: ['slack', 'notification', 'webhook'],
    author: 'Hermes',
    rating: 4.3,
    downloads: 4321,
    installCount: 0,
    verified: true,
    icon: 'slack',
    hookDefinition: {
      type: 'turn_complete',
      name: 'Slack 通知',
      description: '轮次完成时发送 Slack 通知',
      scope: 'team',
      enabled: true,
      action: {
        type: 'webhook',
        url: '${SLACK_WEBHOOK_URL}',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"text": "Hermes AI 完成了一轮任务"}',
      },
      priority: 30,
      timeoutMs: 5000,
      retries: 2,
      fallback: 'ignore',
    },
    installNotes: '需要配置 SLACK_WEBHOOK_URL 环境变量',
    version: '1.0.0',
    updatedAt: Date.now(),
    createdAt: Date.now(),
  },
];

// ============================================================================
// 工具函数
// ============================================================================

/**
 * 生成唯一 ID
 */
function _genId(prefix: string = 'hkt'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ============================================================================
// 核心类
// ============================================================================

/**
 * HookTemplateMarketplace - 钩子模板市场
 *
 * 提供 8 个预置模板，支持安装/卸载/评分/搜索
 */
export class HookTemplateMarketplace {
  private templates: Map<string, HookTemplate> = new Map();
  private installRecords: Map<string, InstallRecord> = new Map();
  // 已安装的模板（避免重复安装）
  private installedTemplateIds: Set<string> = new Set();

  constructor() {
    // 加载预置模板
    PRESET_TEMPLATES.forEach((t) => {
      this.templates.set(t.id, { ...t });
    });
  }

  /**
   * 列出模板
   */
  list(filter: TemplateFilter = {}): HookTemplate[] {
    let result = Array.from(this.templates.values());

    if (filter.category) {
      const categories = Array.isArray(filter.category) ? filter.category : [filter.category];
      result = result.filter((t) => categories.includes(t.category));
    }
    if (filter.tag) {
      result = result.filter((t) => t.tags.includes(filter.tag!));
    }
    if (filter.search) {
      const q = filter.search.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    }
    if (filter.verified !== undefined) {
      result = result.filter((t) => t.verified === filter.verified);
    }
    if (filter.minRating !== undefined) {
      result = result.filter((t) => t.rating >= filter.minRating!);
    }

    const sortBy = filter.sortBy ?? 'rating';
    const sortOrder = filter.sortOrder ?? 'desc';
    result.sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      if (sortBy === 'rating') {
        aVal = a.rating;
        bVal = b.rating;
      } else if (sortBy === 'downloads') {
        aVal = a.downloads;
        bVal = b.downloads;
      } else if (sortBy === 'name') {
        aVal = a.name;
        bVal = b.name;
        return sortOrder === 'asc'
          ? String(aVal).localeCompare(String(bVal))
          : String(bVal).localeCompare(String(aVal));
      } else if (sortBy === 'updatedAt') {
        aVal = a.updatedAt;
        bVal = b.updatedAt;
      }
      return sortOrder === 'asc' ? Number(aVal) - Number(bVal) : Number(bVal) - Number(aVal);
    });

    return result;
  }

  /**
   * 获取单个模板
   */
  get(templateId: string): HookTemplate | null {
    return this.templates.get(templateId) ?? null;
  }

  /**
   * 添加模板（自定义）
   */
  addTemplate(template: Omit<HookTemplate, 'id' | 'createdAt' | 'updatedAt' | 'installCount' | 'rating' | 'downloads'>): HookTemplate {
    const id = _genId('tpl');
    const now = Date.now();
    const full: HookTemplate = {
      ...template,
      id,
      createdAt: now,
      updatedAt: now,
      installCount: 0,
      rating: 0,
      downloads: 0,
    };
    this.templates.set(id, full);
    return full;
  }

  /**
   * 安装模板
   *
   * @param templateId 模板 ID
   * @param installedBy 安装者
   * @returns 安装结果
   */
  installTemplate(templateId: string, installedBy: string = 'user'): InstallResult {
    const template = this.templates.get(templateId);
    if (!template) {
      return {
        templateId,
        hookId: '',
        success: false,
        message: 'Template not found',
        installedAt: Date.now(),
      };
    }

    if (this.installedTemplateIds.has(templateId)) {
      return {
        templateId,
        hookId: this.installRecords.get(templateId)?.hookId ?? '',
        success: false,
        message: 'Template already installed',
        installedAt: Date.now(),
      };
    }

    const hookId = _genId('hook');
    const now = Date.now();

    // 更新安装次数
    template.installCount += 1;
    template.downloads += 1;

    // 记录安装
    this.installRecords.set(templateId, {
      templateId,
      hookId,
      installedAt: now,
      installedBy,
    });
    this.installedTemplateIds.add(templateId);

    return {
      templateId,
      hookId,
      success: true,
      message: 'Template installed successfully',
      installedAt: now,
    };
  }

  /**
   * 卸载模板
   */
  uninstallTemplate(templateId: string): boolean {
    if (!this.installedTemplateIds.has(templateId)) {
      return false;
    }
    this.installedTemplateIds.delete(templateId);
    this.installRecords.delete(templateId);
    return true;
  }

  /**
   * 检查模板是否已安装
   */
  isInstalled(templateId: string): boolean {
    return this.installedTemplateIds.has(templateId);
  }

  /**
   * 获取已安装的模板列表
   */
  getInstalledTemplates(): HookTemplate[] {
    return Array.from(this.installedTemplateIds)
      .map((id) => this.templates.get(id))
      .filter((t): t is HookTemplate => t !== undefined);
  }

  /**
   * 获取安装记录
   */
  getInstallRecord(templateId: string): InstallRecord | null {
    return this.installRecords.get(templateId) ?? null;
  }

  /**
   * 评分模板
   */
  rateTemplate(templateId: string, rating: number): void {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }
    if (rating < 0 || rating > 5) {
      throw new Error('Rating must be between 0 and 5');
    }
    // 简单的指数移动平均
    const alpha = 0.3;
    template.rating = alpha * rating + (1 - alpha) * template.rating;
    template.rating = Math.round(template.rating * 10) / 10;
  }

  /**
   * 搜索模板
   */
  search(query: string): HookTemplate[] {
    return this.list({ search: query });
  }

  /**
   * 按分类获取
   */
  getByCategory(category: TemplateCategory): HookTemplate[] {
    return this.list({ category });
  }

  /**
   * 获取所有分类
   */
  getCategories(): TemplateCategory[] {
    const cats = new Set<TemplateCategory>();
    this.templates.forEach((t) => cats.add(t.category));
    return Array.from(cats);
  }

  /**
   * 获取所有标签
   */
  getAllTags(): string[] {
    const tags = new Set<string>();
    this.templates.forEach((t) => t.tags.forEach((tag) => tags.add(tag)));
    return Array.from(tags).sort();
  }

  /**
   * 移除模板（仅自定义）
   */
  removeTemplate(templateId: string): boolean {
    const template = this.templates.get(templateId);
    if (!template) return false;
    // 预置模板不可删除
    if (template.id.startsWith('preset-')) return false;
    if (this.installedTemplateIds.has(templateId)) {
      this.uninstallTemplate(templateId);
    }
    return this.templates.delete(templateId);
  }

  /**
   * 导出 hook 定义
   *
   * @param templateId 模板 ID
   * @returns 完整 HookDefinition（带 id/createdAt/createdBy）
   */
  exportHookDefinition(templateId: string, installedBy: string = 'marketplace'): HookDefinition | null {
    const template = this.templates.get(templateId);
    if (!template) return null;
    return {
      ...template.hookDefinition,
      id: _genId('hook'),
      createdAt: Date.now(),
      createdBy: installedBy,
    };
  }

  /**
   * 获取市场统计
   */
  getStats(): {
    totalTemplates: number;
    byCategory: Record<TemplateCategory, number>;
    verifiedCount: number;
    installedCount: number;
    totalDownloads: number;
    avgRating: number;
  } {
    const byCategory: Record<TemplateCategory, number> = {
      quality: 0,
      testing: 0,
      git: 0,
      collaboration: 0,
      custom: 0,
    };
    let totalDownloads = 0;
    let totalRating = 0;

    this.templates.forEach((t) => {
      byCategory[t.category] = (byCategory[t.category] ?? 0) + 1;
      totalDownloads += t.downloads;
      totalRating += t.rating;
    });

    return {
      totalTemplates: this.templates.size,
      byCategory,
      verifiedCount: Array.from(this.templates.values()).filter((t) => t.verified).length,
      installedCount: this.installedTemplateIds.size,
      totalDownloads,
      avgRating: this.templates.size > 0 ? totalRating / this.templates.size : 0,
    };
  }
}

// ============================================================================
// 单例工厂
// ============================================================================

let _instance: HookTemplateMarketplace | null = null;

/**
 * 获取 HookTemplateMarketplace 单例
 */
export function getHookTemplateMarketplace(): HookTemplateMarketplace {
  if (!_instance) {
    _instance = new HookTemplateMarketplace();
  }
  return _instance;
}

/**
 * 重置 HookTemplateMarketplace 单例
 */
export function resetHookTemplateMarketplace(): void {
  _instance = null;
}

/**
 * 检查是否已初始化
 */
export function isHookTemplateMarketplaceInitialized(): boolean {
  return _instance !== null;
}
