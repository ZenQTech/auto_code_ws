/**
 * # ============================================================
 * # Skill Engine - 技能系统核心实现 (v1.0.0 Cycle 28 G28-01)
 * # ============================================================
 * # 核心作用：实现 Codex 风格的 Agent Skills 机制
 * # 运行流程：
 * #   1. installSkill 安装 SKILL.md 格式技能
 * #   2. 渐进式披露：仅加载 summary（name/description/path）
 * #   3. matchSkills 隐式匹配（description 相似度）
 * #   4. invokeSkill 显式调用（$skill-name）
 * #   5. 事件总线实时通知
 * # 输入参数：installSkill(content) / matchSkills(prompt) / invokeSkill(name, args)
 * # 输出结果：Skill / SkillMatch / SkillExecutionResult
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 28 G28-01 初次创建
 * # ============================================================
 */

import {
  Skill,
  SkillEvent,
  SkillEventType,
  SkillMatch,
  SkillSummary,
  SkillEngineConfig,
  SkillStats,
  SkillExecutionContext,
  SkillExecutionResult,
  DEFAULT_SKILL_ENGINE_CONFIG,
  generateSkillId,
  isValidSkillName,
  isValidSkillVersion,
  calculateSimilarity,
  truncateDescription,
  extractTriggerKeywords,
} from './skillTypes';
import { BUILTIN_SKILLS_MD } from './skillBuiltins';

// ============ 引擎类 ============

/**
 * 技能引擎
 */
export class SkillEngine {
  private config: SkillEngineConfig;
  private skills: Map<string, Skill> = new Map();
  private summaries: Map<string, SkillSummary> = new Map();
  private listeners: Map<SkillEventType, Set<(e: SkillEvent) => void>> = new Map();
  private executionHistory: SkillExecutionContext[] = [];
  private storageKey = 'hermes.skills';

  constructor(config: Partial<SkillEngineConfig> = {}) {
    this.config = { ...DEFAULT_SKILL_ENGINE_CONFIG, ...config };
    if (this.config.persist) {
      this.load();
    }
    // 自动初始化内置 Skills
    this.initializeBuiltinSkills();
  }

  // ============ 持久化 ============

  private load(): void {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(this.storageKey) : null;
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.skills)) {
        for (const s of data.skills) {
          this.skills.set(s.id, s);
          this.summaries.set(s.id, this.buildSummary(s));
        }
      }
      if (data && Array.isArray(data.history)) {
        this.executionHistory = data.history.slice(-50);
      }
    } catch (e) {
      console.warn('SkillEngine: failed to load', e);
    }
  }

  private save(): void {
    if (!this.config.persist) return;
    try {
      const data = {
        skills: Array.from(this.skills.values()),
        history: this.executionHistory.slice(-50),
      };
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(this.storageKey, JSON.stringify(data));
      }
    } catch (e) {
      console.warn('SkillEngine: failed to save', e);
    }
  }

  // ============ 事件系统 ============

  on(event: SkillEventType, listener: (e: SkillEvent) => void): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: SkillEventType, listener: (e: SkillEvent) => void): void {
    this.listeners.get(event)?.delete(listener);
  }

  private emit(event: SkillEvent): void {
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try {
          h(event);
        } catch (err) {
          console.error('SkillEngine: error in handler', err);
        }
      }
    }
  }

  // ============ 渐进式披露 ============

  private buildSummary(skill: Skill): SkillSummary {
    return {
      id: skill.id,
      name: skill.name,
      description: truncateDescription(skill.description, 200),
      path: skill.path,
      enabled: skill.enabled,
      builtin: skill.builtin,
      tags: skill.tags,
      usageCount: skill.usageCount,
    };
  }

  /**
   * 获取所有 Skill 的 summaries（用于 LLM 加载）
   * 遵守 summary 字符限制
   */
  getAllSummaries(): SkillSummary[] {
    const all = Array.from(this.summaries.values());
    return this.enforceProgressiveDisclosure(all);
  }

  /**
   * 强制渐进式披露：按字符限制截断
   */
  private enforceProgressiveDisclosure(summaries: SkillSummary[]): SkillSummary[] {
    const limit = this.config.summaryCharLimit;
    let total = 0;
    const result: SkillSummary[] = [];
    // 优先显示已启用 + 使用次数多的
    const sorted = [...summaries].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return b.usageCount - a.usageCount;
    });
    for (const s of sorted) {
      const size = s.name.length + s.description.length + 10;
      if (total + size > limit) {
        // 截断 description
        const remaining = limit - total - s.name.length - 10;
        if (remaining > 20) {
          result.push({ ...s, description: truncateDescription(s.description, remaining) });
          total += s.name.length + remaining + 10;
        }
        break;
      }
      result.push(s);
      total += size;
    }
    return result;
  }

  /**
   * 加载 Skill 完整内容（仅在确定使用后调用）
   */
  loadSkillFull(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  // ============ 解析 SKILL.md ============

  /**
   * 解析 SKILL.md 内容为 Skill 对象
   */
  parseSkillMarkdown(content: string, basePath: string = ''): Skill {
    const lines = content.split('\n');
    let inFrontmatter = false;
    let frontmatterText = '';
    let bodyStart = 0;

    // 解析 frontmatter
    for (let i = 0; i < lines.length; i++) {
      if (i === 0 && lines[i].trim() === '---') {
        inFrontmatter = true;
        continue;
      }
      if (inFrontmatter && lines[i].trim() === '---') {
        bodyStart = i + 1;
        break;
      }
      if (inFrontmatter) {
        frontmatterText += lines[i] + '\n';
      }
    }

    // 解析 frontmatter 字段
    const fields = this.parseFrontmatter(frontmatterText);

    // 解析 body 中的脚本、引用、资源
    const body = lines.slice(bodyStart).join('\n');
    const scripts = this.parseScripts(body, basePath);
    const references = this.parseReferences(body, basePath);
    const assets = this.parseAssets(body, basePath);

    if (!fields.name) {
      throw new Error('SKILL.md must have a name field');
    }
    if (!isValidSkillName(fields.name)) {
      throw new Error(`Invalid skill name: ${fields.name}`);
    }
    if (fields.version && !isValidSkillVersion(fields.version)) {
      throw new Error(`Invalid version: ${fields.version}`);
    }

    return {
      id: generateSkillId(),
      name: fields.name,
      description: fields.description || '',
      version: fields.version || '1.0.0',
      author: fields.author || 'unknown',
      tags: fields.tags || [],
      path: basePath || fields.name,
      allowedTools: fields.allowedTools || [],
      constraints: fields.constraints || [],
      body,
      scripts,
      references,
      assets,
      builtin: false,
      installed: true,
      enabled: true,
      installedAt: Date.now(),
      usageCount: 0,
      metadata: {},
    };
  }

  /**
   * 解析 frontmatter
   */
  private parseFrontmatter(text: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = text.split('\n');
    for (const line of lines) {
      const m = line.match(/^([a-zA-Z][a-zA-Z0-9_-]*):\s*(.*)$/);
      if (m) {
        const rawKey = m[1];
        // kebab-case 转 camelCase
        const key = rawKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        let value: any = m[2].trim();
        // 数组值 [a, b, c]
        if (value.startsWith('[') && value.endsWith(']')) {
          value = value
            .slice(1, -1)
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
        result[key] = value;
      }
    }
    return result;
  }

  /**
   * 解析脚本（简化版：检测 scripts/ 引用）
   */
  private parseScripts(body: string, basePath: string): Skill['scripts'] {
    const scripts: Skill['scripts'] = [];
    const re = /scripts\/([^\s)`]+)/g;
    const seen = new Set<string>();
    let m;
    while ((m = re.exec(body)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const ext = name.split('.').pop() || '';
      const language: 'bash' | 'python' | 'node' | 'other' =
        ext === 'sh' || ext === 'bash' ? 'bash' :
        ext === 'py' ? 'python' :
        ext === 'js' || ext === 'ts' ? 'node' : 'other';
      scripts.push({ name, path: `${basePath}/scripts/${name}`, language, description: '' });
    }
    return scripts;
  }

  /**
   * 解析引用
   */
  private parseReferences(body: string, basePath: string): Skill['references'] {
    const refs: Skill['references'] = [];
    const re = /references\/([^\s)`]+)/g;
    const seen = new Set<string>();
    let m;
    while ((m = re.exec(body)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const type: 'doc' | 'example' | 'spec' =
        name.includes('example') ? 'example' :
        name.includes('spec') ? 'spec' : 'doc';
      refs.push({ name, path: `${basePath}/references/${name}`, type });
    }
    return refs;
  }

  /**
   * 解析资源
   */
  private parseAssets(body: string, basePath: string): Skill['assets'] {
    const assets: Skill['assets'] = [];
    const re = /assets\/([^\s)`]+)/g;
    const seen = new Set<string>();
    let m;
    while ((m = re.exec(body)) !== null) {
      const name = m[1];
      if (seen.has(name)) continue;
      seen.add(name);
      const ext = name.split('.').pop() || '';
      const type: 'template' | 'image' | 'binary' =
        ext === 'png' || ext === 'jpg' || ext === 'svg' ? 'image' :
        ext === 'md' ? 'template' : 'binary';
      assets.push({ name, path: `${basePath}/assets/${name}`, type });
    }
    return assets;
  }

  // ============ 初始化内置 Skills ============

  private initializeBuiltinSkills(): void {
    for (const [name, content] of Object.entries(BUILTIN_SKILLS_MD)) {
      // 仅在未安装时初始化
      if (this.getSkillByName(name)) continue;
      try {
        const skill = this.parseSkillMarkdown(content, `builtin/${name}`);
        skill.builtin = true;
        skill.id = 'builtin-' + name;
        this.skills.set(skill.id, skill);
        this.summaries.set(skill.id, this.buildSummary(skill));
      } catch (e) {
        console.warn(`SkillEngine: failed to load builtin skill ${name}`, e);
      }
    }
  }

  // ============ 安装/卸载/启用/禁用 ============

  installSkill(source: string | Skill): Skill {
    let skill: Skill;
    if (typeof source === 'string') {
      skill = this.parseSkillMarkdown(source);
    } else {
      skill = { ...source, installed: true, installedAt: Date.now() };
    }
    // 唯一性检查
    if (this.getSkillByName(skill.name)) {
      throw new Error(`Skill already exists: ${skill.name}`);
    }
    this.skills.set(skill.id, skill);
    this.summaries.set(skill.id, this.buildSummary(skill));
    this.save();
    this.emit({
      type: 'skill-installed',
      timestamp: Date.now(),
      skillId: skill.id,
      skillName: skill.name,
    });
    return skill;
  }

  uninstallSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    if (skill.builtin) {
      // 内置 skill 仅禁用，不删除
      return this.disableSkill(skillId);
    }
    this.skills.delete(skillId);
    this.summaries.delete(skillId);
    this.save();
    this.emit({
      type: 'skill-uninstalled',
      timestamp: Date.now(),
      skillId,
      skillName: skill.name,
    });
    return true;
  }

  enableSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    skill.enabled = true;
    this.summaries.set(skillId, this.buildSummary(skill));
    this.save();
    this.emit({
      type: 'skill-enabled',
      timestamp: Date.now(),
      skillId,
      skillName: skill.name,
    });
    return true;
  }

  disableSkill(skillId: string): boolean {
    const skill = this.skills.get(skillId);
    if (!skill) return false;
    skill.enabled = false;
    this.summaries.set(skillId, this.buildSummary(skill));
    this.save();
    this.emit({
      type: 'skill-disabled',
      timestamp: Date.now(),
      skillId,
      skillName: skill.name,
    });
    return true;
  }

  // ============ 匹配 ============

  matchSkills(prompt: string, options?: { topK?: number; threshold?: number }): SkillMatch[] {
    const topK = options?.topK ?? this.config.topK;
    const threshold = options?.threshold ?? this.config.matchThreshold;
    const matches: SkillMatch[] = [];
    for (const summary of this.summaries.values()) {
      if (!summary.enabled) continue;
      // 计算相似度（description vs prompt）
      const descScore = calculateSimilarity(summary.description, prompt);
      // 关键词加分
      const keywords = extractTriggerKeywords(summary.description);
      const promptLower = prompt.toLowerCase();
      let keywordScore = 0;
      const matchedKeywords: string[] = [];
      for (const kw of keywords) {
        if (promptLower.includes(kw)) {
          keywordScore += 0.1;
          matchedKeywords.push(kw);
        }
      }
      // 名称完全匹配加分
      let nameScore = 0;
      if (promptLower.includes(summary.name.toLowerCase())) {
        nameScore = 0.5;
        matchedKeywords.push(summary.name);
      }
      // 显式调用格式：$skill-name
      if (promptLower.includes(`$${summary.name}`)) {
        nameScore = Math.max(nameScore, 1.0);
        matchedKeywords.push(`$${summary.name}`);
      }
      const totalScore = Math.min(1, descScore * 0.5 + keywordScore + nameScore);
      if (totalScore >= threshold) {
        matches.push({ skill: summary, score: totalScore, matchedKeywords });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    const top = matches.slice(0, topK);
    if (top.length > 0) {
      this.emit({
        type: 'skill-matched',
        timestamp: Date.now(),
        skillId: top[0].skill.id,
        skillName: top[0].skill.name,
        data: { count: top.length, topScore: top[0].score },
      });
    }
    return top;
  }

  // ============ 调用 ============

  async invokeSkill(skillName: string, args: Record<string, unknown> = {}): Promise<SkillExecutionResult> {
    const skill = this.getSkillByName(skillName);
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`);
    }
    if (!skill.enabled) {
      throw new Error(`Skill is disabled: ${skillName}`);
    }
    const startedAt = Date.now();
    const ctx: SkillExecutionContext = {
      skillName,
      args,
      startedAt,
      success: false,
    };
    this.emit({
      type: 'skill-invoked',
      timestamp: startedAt,
      skillId: skill.id,
      skillName: skill.name,
      data: { args },
    });
    try {
      // 模拟执行（生产环境会真正调用 scripts 和 LLM）
      const output = `[${skill.name}] 模拟执行完成: ${JSON.stringify(args)}`;
      ctx.output = output;
      ctx.success = true;
      ctx.completedAt = Date.now();
      this.recordUsage(skill.id, true);
      this.executionHistory.push(ctx);
      this.save();
      this.emit({
        type: 'skill-completed',
        timestamp: ctx.completedAt,
        skillId: skill.id,
        skillName: skill.name,
        data: { durationMs: ctx.completedAt - startedAt, output },
      });
      return {
        success: true,
        output,
        durationMs: ctx.completedAt - startedAt,
        skillId: skill.id,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      ctx.error = error;
      ctx.completedAt = Date.now();
      this.recordUsage(skill.id, false);
      this.executionHistory.push(ctx);
      this.save();
      this.emit({
        type: 'skill-failed',
        timestamp: ctx.completedAt,
        skillId: skill.id,
        skillName: skill.name,
        data: { error },
      });
      return {
        success: false,
        output: '',
        error,
        durationMs: ctx.completedAt - startedAt,
        skillId: skill.id,
      };
    }
  }

  // ============ CRUD ============

  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  getSkillByName(name: string): Skill | undefined {
    for (const s of this.skills.values()) {
      if (s.name === name) return s;
    }
    return undefined;
  }

  listSkills(filter?: { enabled?: boolean; builtin?: boolean; tag?: string }): Skill[] {
    let result = Array.from(this.skills.values());
    if (filter?.enabled !== undefined) {
      result = result.filter((s) => s.enabled === filter.enabled);
    }
    if (filter?.builtin !== undefined) {
      result = result.filter((s) => s.builtin === filter.builtin);
    }
    if (filter?.tag) {
      result = result.filter((s) => s.tags.includes(filter.tag!));
    }
    return result.sort((a, b) => a.name.localeCompare(b.name));
  }

  // ============ 导入导出 ============

  exportSkill(skillId: string): string {
    const skill = this.skills.get(skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);
    // 重新序列化为 SKILL.md
    const lines: string[] = ['---'];
    lines.push(`name: ${skill.name}`);
    lines.push(`description: ${skill.description}`);
    lines.push(`version: ${skill.version}`);
    lines.push(`author: ${skill.author}`);
    if (skill.tags.length > 0) {
      lines.push(`tags: [${skill.tags.join(', ')}]`);
    }
    if (skill.allowedTools.length > 0) {
      lines.push(`allowed-tools: [${skill.allowedTools.join(', ')}]`);
    }
    if (skill.constraints.length > 0) {
      lines.push(`constraints: [${skill.constraints.join(', ')}]`);
    }
    lines.push('---');
    lines.push('');
    lines.push(skill.body);
    return lines.join('\n');
  }

  importSkill(skillContent: string, _basePath: string = ''): Skill {
    return this.installSkill(skillContent);
  }

  // ============ 统计 ============

  recordUsage(skillId: string, success: boolean): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;
    skill.usageCount++;
    skill.lastUsedAt = Date.now();
    this.summaries.set(skillId, this.buildSummary(skill));
    this.save();
    this.emit({
      type: 'skill-usage-tracked',
      timestamp: Date.now(),
      skillId,
      skillName: skill.name,
      data: { success, totalCount: skill.usageCount },
    });
  }

  getStats(): SkillStats {
    const all = Array.from(this.skills.values());
    const enabled = all.filter((s) => s.enabled);
    const builtin = all.filter((s) => s.builtin);
    const user = all.filter((s) => !s.builtin);
    const topUsed = all
      .map((s) => ({ name: s.name, count: s.usageCount }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    const recentMatches = this.executionHistory
      .filter((e) => e.success)
      .slice(-10)
      .map((e) => ({ name: e.skillName, score: 1.0, timestamp: e.startedAt }));
    return {
      total: all.length,
      enabled: enabled.length,
      builtin: builtin.length,
      user: user.length,
      totalUsage: all.reduce((sum, s) => sum + s.usageCount, 0),
      topUsed,
      recentMatches,
    };
  }
}

// ============ 单例 ============

let defaultEngine: SkillEngine | null = null;

export function getDefaultSkillEngine(): SkillEngine {
  if (!defaultEngine) {
    defaultEngine = new SkillEngine();
  }
  return defaultEngine;
}

export function resetDefaultSkillEngine(): void {
  defaultEngine = null;
}
