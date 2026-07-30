/**
 * # ============================================================
 * # Agent Template Engine - 代理模板引擎 (v1.0.0 Cycle 27 G27-05)
 * # ============================================================
 * # 核心作用：实现代理模板的安装、卸载、评分、市场管理
 * # 参考：Claude Code 2026-06 subagent + Codex /agents
 * # 运行流程：
 * #   1. 启动时加载 builtin 模板（不可卸载）
 * #   2. 从 localStorage 恢复用户安装的模板
 * #   3. 模拟社区市场（mock 数据）
 * #   4. 支持模板导入/导出（YAML/JSON）
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 G27-05 初次创建
 * # ============================================================
 */

import {
  AgentTemplate,
  AgentTemplateConfig,
  AgentTemplateEvent,
  AgentTemplateEventType,
  AgentTemplateInstall,
  AgentTemplateMarketEntry,
  AgentTemplateRating,
  AgentTemplateScope,
  DEFAULT_AGENT_TEMPLATE_CONFIG,
  generateTemplateId,
  isValidTemplateName,
} from './agentTemplateTypes';
import { BUILTIN_AGENT_TEMPLATES, COMMUNITY_AGENT_TEMPLATES } from './agentTemplateBuiltins';

/**
 * 代理模板引擎
 */
export class AgentTemplateEngine {
  private config: AgentTemplateConfig;
  /** 模板表（key = id） */
  private templates: Map<string, AgentTemplate> = new Map();
  /** 安装记录 */
  private installs: Map<string, AgentTemplateInstall> = new Map();
  /** 评分记录（去重：每个用户每个模板一条） */
  private ratings: AgentTemplateRating[] = [];
  /** 事件监听 */
  private listeners: Map<AgentTemplateEventType, Set<(e: AgentTemplateEvent) => void>> = new Map();
  private storageKey = 'hermes.agentTemplates';

  constructor(config: Partial<AgentTemplateConfig> = {}) {
    this.config = { ...DEFAULT_AGENT_TEMPLATE_CONFIG, ...config };
    this.loadBuiltins();
    if (this.config.persist) {
      this.load();
    }
  }

  // ============ 持久化 ============

  private loadBuiltins(): void {
    for (const t of BUILTIN_AGENT_TEMPLATES) {
      this.templates.set(t.id, { ...t });
    }
  }

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.userTemplates)) {
        for (const t of data.userTemplates) {
          if (t.scope === 'user' || t.scope === 'team') {
            // 跳过 builtin（已被内置）
            this.templates.set(t.id, t);
          }
        }
      }
      if (data && Array.isArray(data.installs)) {
        for (const ins of data.installs) {
          this.installs.set(ins.templateId, ins);
        }
      }
      if (data && Array.isArray(data.ratings)) {
        this.ratings = data.ratings;
      }
    } catch (e) {
      console.warn('AgentTemplateEngine: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        // 只保存用户/团队模板（builtin 不需要）
        userTemplates: Array.from(this.templates.values()).filter(
          (t) => t.scope === 'user' || t.scope === 'team'
        ),
        installs: Array.from(this.installs.values()),
        ratings: this.ratings,
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('AgentTemplateEngine: failed to save', e);
    }
  }

  // ============ 事件系统 ============

  on(event: AgentTemplateEventType, listener: (e: AgentTemplateEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: AgentTemplateEventType, listener: (e: AgentTemplateEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: AgentTemplateEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('AgentTemplateEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 模板查询 ============

  /**
   * 获取模板
   */
  getTemplate(id: string): AgentTemplate | undefined {
    return this.templates.get(id);
  }

  /**
   * 通过名称获取模板
   */
  getTemplateByName(name: string, scope?: AgentTemplateScope): AgentTemplate | undefined {
    for (const t of this.templates.values()) {
      if (t.name === name && (!scope || t.scope === scope)) {
        return t;
      }
    }
    return undefined;
  }

  /**
   * 列出已安装模板（按 scope + category 过滤）
   */
  listInstalled(filter?: { scope?: AgentTemplateScope; category?: string; search?: string }): AgentTemplate[] {
    let result = Array.from(this.templates.values());
    if (filter) {
      if (filter.scope) result = result.filter((t) => t.scope === filter.scope);
      if (filter.category) result = result.filter((t) => t.category === filter.category);
      if (filter.search) {
        const s = filter.search.toLowerCase();
        result = result.filter(
          (t) =>
            t.name.toLowerCase().includes(s) ||
            t.displayName.toLowerCase().includes(s) ||
            t.description.toLowerCase().includes(s) ||
            t.tags.some((tag) => tag.toLowerCase().includes(s))
        );
      }
    }
    return result.sort((a, b) => {
      // builtin 在前，其他按 displayName 排序
      if (a.scope === 'builtin' && b.scope !== 'builtin') return -1;
      if (a.scope !== 'builtin' && b.scope === 'builtin') return 1;
      return a.displayName.localeCompare(b.displayName);
    });
  }

  /**
   * 获取市场列表（builtin + 社区，可选用户/团队）
   */
  getMarketList(filter?: { search?: string; category?: string }): AgentTemplateMarketEntry[] {
    const community = this.config.enableCommunity ? COMMUNITY_AGENT_TEMPLATES : [];
    const userAndTeam = Array.from(this.templates.values()).filter(
      (t) => t.scope === 'user' || t.scope === 'team'
    );

    const all = [...BUILTIN_AGENT_TEMPLATES, ...userAndTeam, ...community];
    let filtered = all;

    if (filter?.search) {
      const s = filter.search.toLowerCase();
      filtered = filtered.filter(
        (t) =>
          t.name.toLowerCase().includes(s) ||
          t.displayName.toLowerCase().includes(s) ||
          t.description.toLowerCase().includes(s) ||
          t.tags.some((tag) => tag.toLowerCase().includes(s))
      );
    }
    if (filter?.category) {
      filtered = filtered.filter((t) => t.category === filter.category);
    }

    return filtered.map((t) => {
      const installed = this.templates.has(t.id);
      const installRec = this.installs.get(t.id);
      const hasUpdate = installRec ? installRec.version !== t.version : false;
      return {
        template: t,
        installed,
        installedAt: installRec?.installedAt,
        installedVersion: installRec?.version,
        hasUpdate,
      };
    });
  }

  // ============ 用户模板管理 ============

  /**
   * 创建用户模板
   */
  createUserTemplate(input: Omit<AgentTemplate, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'scope'> & { name: string }): AgentTemplate {
    if (!isValidTemplateName(input.name)) {
      throw new Error(`Invalid template name: ${input.name}. Must match kebab-case.`);
    }
    const id = generateTemplateId('user', input.name);
    if (this.templates.has(id)) {
      throw new Error(`Template with id ${id} already exists`);
    }
    const now = Date.now();
    const template: AgentTemplate = {
      ...input,
      id,
      scope: 'user',
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
    };
    this.templates.set(id, template);
    this.save();
    this.emit({
      type: 'template-installed',
      timestamp: now,
      templateId: id,
      data: { source: 'created', name: input.name },
    });
    return template;
  }

  /**
   * 更新用户模板
   */
  updateUserTemplate(id: string, updates: Partial<AgentTemplate>): AgentTemplate {
    const t = this.templates.get(id);
    if (!t) throw new Error(`Template not found: ${id}`);
    if (t.scope === 'builtin') {
      throw new Error('Cannot update builtin template directly. Create a new template or fork it.');
    }
    const updated: AgentTemplate = {
      ...t,
      ...updates,
      id: t.id, // 不允许改 id
      scope: t.scope, // 不允许改 scope
      updatedAt: Date.now(),
    };
    this.templates.set(id, updated);
    this.save();
    this.emit({
      type: 'template-updated',
      timestamp: Date.now(),
      templateId: id,
      data: { changes: Object.keys(updates) },
    });
    return updated;
  }

  /**
   * 删除用户模板
   */
  deleteUserTemplate(id: string): boolean {
    const t = this.templates.get(id);
    if (!t) return false;
    if (t.scope === 'builtin') {
      throw new Error('Cannot delete builtin template');
    }
    this.templates.delete(id);
    this.installs.delete(id);
    this.save();
    this.emit({
      type: 'template-uninstalled',
      timestamp: Date.now(),
      templateId: id,
      data: { source: 'deleted' },
    });
    return true;
  }

  // ============ 模板市场（社区/builtin 安装） ============

  /**
   * 安装模板（从社区市场）
   */
  installTemplate(id: string): AgentTemplate {
    let t = this.templates.get(id);
    if (!t) {
      // 从社区市场查找
      const communityT = COMMUNITY_AGENT_TEMPLATES.find((c) => c.id === id);
      if (!communityT) throw new Error(`Template not found: ${id}`);
      // 复制到 templates
      t = { ...communityT };
      this.templates.set(id, t);
    }
    this.installs.set(id, {
      templateId: id,
      installedAt: Date.now(),
      version: t.version,
    });
    this.save();
    this.emit({
      type: 'template-installed',
      timestamp: Date.now(),
      templateId: id,
      data: { name: t.name, version: t.version },
    });
    return t;
  }

  /**
   * 卸载模板（仅卸载社区/用户模板，builtin 不可卸载）
   */
  uninstallTemplate(id: string): boolean {
    const t = this.templates.get(id);
    if (!t) return false;
    if (t.scope === 'builtin') {
      throw new Error('Cannot uninstall builtin template');
    }
    this.templates.delete(id);
    this.installs.delete(id);
    this.save();
    this.emit({
      type: 'template-uninstalled',
      timestamp: Date.now(),
      templateId: id,
      data: { name: t.name },
    });
    return true;
  }

  /**
   * 更新模板
   */
  updateTemplate(id: string): AgentTemplate {
    const t = this.templates.get(id);
    if (!t) throw new Error(`Template not found: ${id}`);
    if (t.scope === 'user' || t.scope === 'team') {
      // 用户/团队模板：bump patch version
      const newVersion = bumpVersion(t.version, 'patch');
      const updated: AgentTemplate = {
        ...t,
        version: newVersion,
        updatedAt: Date.now(),
      };
      this.templates.set(id, updated);
      this.installs.set(id, {
        templateId: id,
        installedAt: Date.now(),
        version: newVersion,
      });
      this.save();
      this.emit({
        type: 'template-updated',
        timestamp: Date.now(),
        templateId: id,
        data: { oldVersion: t.version, newVersion },
      });
      return updated;
    } else if (t.scope === 'community') {
      // 社区模板：刷新为最新版本
      const communityT = COMMUNITY_AGENT_TEMPLATES.find((c) => c.id === id);
      if (!communityT) throw new Error('Community template not found');
      const updated: AgentTemplate = { ...communityT };
      this.templates.set(id, updated);
      this.installs.set(id, {
        templateId: id,
        installedAt: Date.now(),
        version: updated.version,
      });
      this.save();
      this.emit({
        type: 'template-updated',
        timestamp: Date.now(),
        templateId: id,
        data: { newVersion: updated.version },
      });
      return updated;
    } else {
      // builtin：固定版本，不更新
      return t;
    }
  }

  // ============ 评分 ============

  /**
   * 评分模板
   */
  rateTemplate(id: string, score: number, comment?: string): AgentTemplate {
    if (score < 0 || score > 5) {
      throw new Error('Score must be between 0 and 5');
    }
    const t = this.templates.get(id);
    if (!t) throw new Error(`Template not found: ${id}`);
    const now = Date.now();
    // 移除旧评分
    this.ratings = this.ratings.filter((r) => r.templateId !== id);
    this.ratings.push({ templateId: id, score, comment, ratedAt: now });
    // 更新模板的聚合评分
    const updated: AgentTemplate = {
      ...t,
      rating: score,
      ratingCount: 1,
      updatedAt: now,
    };
    this.templates.set(id, updated);
    this.save();
    this.emit({
      type: 'template-rated',
      timestamp: now,
      templateId: id,
      data: { score, comment },
    });
    return updated;
  }

  // ============ 导入/导出 ============

  /**
   * 导出模板为 JSON
   */
  exportTemplate(id: string): string {
    const t = this.templates.get(id);
    if (!t) throw new Error(`Template not found: ${id}`);
    return JSON.stringify(t, null, 2);
  }

  /**
   * 导出所有用户模板
   */
  exportAllUserTemplates(): string {
    const userTemplates = Array.from(this.templates.values()).filter(
      (t) => t.scope === 'user' || t.scope === 'team'
    );
    return JSON.stringify({ templates: userTemplates, exportedAt: Date.now() }, null, 2);
  }

  /**
   * 导入模板（从 JSON 字符串）
   */
  importTemplates(json: string): AgentTemplate[] {
    let parsed: any;
    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error('Invalid JSON: ' + (e instanceof Error ? e.message : String(e)));
    }
    const list: AgentTemplate[] = [];
    const items = Array.isArray(parsed) ? parsed : parsed.templates ? parsed.templates : [parsed];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      // 必须有 name
      if (!item.name || !isValidTemplateName(item.name)) continue;
      // 强制 user scope（导入）
      const now = Date.now();
      const id = generateTemplateId('user', item.name);
      const template: AgentTemplate = {
        id,
        name: item.name,
        scope: 'user',
        category: item.category || 'general',
        displayName: item.displayName || item.name,
        description: item.description || '',
        role: item.role || 'worker',
        model: item.model || 'sonnet',
        reasoningEffort: item.reasoningEffort || 'medium',
        systemPrompt: item.systemPrompt || '',
        tools: Array.isArray(item.tools) ? item.tools : [],
        constraints: Array.isArray(item.constraints) ? item.constraints : [],
        contextWindow: item.contextWindow || 12000,
        timeoutMs: item.timeoutMs || 90000,
        worktreeIsolation: !!item.worktreeIsolation,
        tags: Array.isArray(item.tags) ? item.tags : [],
        author: item.author,
        version: item.version || '1.0.0',
        createdAt: now,
        updatedAt: now,
        icon: item.icon || '🤖',
      };
      this.templates.set(id, template);
      list.push(template);
    }
    this.save();
    if (list.length > 0) {
      this.emit({
        type: 'template-imported',
        timestamp: Date.now(),
        data: { count: list.length, ids: list.map((t) => t.id) },
      });
    }
    return list;
  }

  // ============ 模板派生（fork） ============

  /**
   * 派生模板（从 builtin 或 community fork）
   */
  forkTemplate(sourceId: string, newName: string): AgentTemplate {
    if (!isValidTemplateName(newName)) {
      throw new Error(`Invalid name: ${newName}`);
    }
    const source = this.templates.get(sourceId) || COMMUNITY_AGENT_TEMPLATES.find((c) => c.id === sourceId);
    if (!source) throw new Error(`Source template not found: ${sourceId}`);
    const newId = generateTemplateId('user', newName);
    if (this.templates.has(newId)) {
      throw new Error(`Template ${newId} already exists`);
    }
    const now = Date.now();
    const forked: AgentTemplate = {
      ...source,
      id: newId,
      name: newName,
      scope: 'user',
      version: '1.0.0',
      createdAt: now,
      updatedAt: now,
      // 重置评分与安装数
      installCount: undefined,
      rating: undefined,
      ratingCount: undefined,
    };
    this.templates.set(newId, forked);
    this.save();
    this.emit({
      type: 'template-installed',
      timestamp: now,
      templateId: newId,
      data: { source: 'fork', from: sourceId, name: newName },
    });
    return forked;
  }

  // ============ 统计 ============

  /**
   * 获取统计
   */
  getStats(): {
    totalTemplates: number;
    builtinCount: number;
    userCount: number;
    teamCount: number;
    communityCount: number;
    byCategory: Record<string, number>;
    totalInstalls: number;
    averageRating: number;
  } {
    const templates = Array.from(this.templates.values());
    const builtin = templates.filter((t) => t.scope === 'builtin').length;
    const user = templates.filter((t) => t.scope === 'user').length;
    const team = templates.filter((t) => t.scope === 'team').length;
    const community = templates.filter((t) => t.scope === 'community').length;

    const byCategory: Record<string, number> = {};
    for (const t of templates) {
      byCategory[t.category] = (byCategory[t.category] || 0) + 1;
    }

    const rated = this.ratings.filter((r) => r.score > 0);
    const totalRating = rated.reduce((sum, r) => sum + r.score, 0);
    const averageRating = rated.length > 0 ? totalRating / rated.length : 0;

    return {
      totalTemplates: templates.length,
      builtinCount: builtin,
      userCount: user,
      teamCount: team,
      communityCount: community,
      byCategory,
      totalInstalls: this.installs.size,
      averageRating,
    };
  }

  /**
   * 清空（保留 builtin）
   */
  clearUserTemplates(): void {
    const builtinIds = new Set(BUILTIN_AGENT_TEMPLATES.map((t) => t.id));
    for (const id of Array.from(this.templates.keys())) {
      if (!builtinIds.has(id)) {
        this.templates.delete(id);
      }
    }
    this.installs.clear();
    this.ratings = [];
    this.save();
  }
}

/**
 * SemVer 版本号 bump 工具
 */
function bumpVersion(version: string, type: 'major' | 'minor' | 'patch'): string {
  const parts = version.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return '1.0.0';
  const [major, minor, patch] = parts;
  if (type === 'major') return `${major + 1}.0.0`;
  if (type === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// ============ 单例 ============

let defaultInstance: AgentTemplateEngine | null = null;

export function getDefaultAgentTemplateEngine(): AgentTemplateEngine {
  if (!defaultInstance) {
    defaultInstance = new AgentTemplateEngine();
  }
  return defaultInstance;
}

export function resetDefaultAgentTemplateEngine(): void {
  defaultInstance = null;
}
