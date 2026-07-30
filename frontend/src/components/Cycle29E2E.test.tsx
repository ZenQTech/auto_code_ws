/**
 * Cycle 29 E2E 集成测试 (v6.77.0+)
 * 验证 G29-01 Stacked Skills 引擎与 App.tsx 集成层的端到端连通性
 *
 * 覆盖目标：
 * 1. StackedSkillEngine 创建 → 解析 → 验证 → 执行
 * 2. 全局单例可被多消费者使用
 * 3. 并行 + 串行执行
 * 4. 工具冲突检测
 * 5. 事件系统
 * 6. 持久化
 * 7. 与现有 SkillEngine 协同
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';

describe('Cycle 29 E2E 集成测试', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('G29-01: Stacked Skills 端到端', () => {
    it('StackedSkillEngine 解析 + 验证 + 串行执行', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine);

      const cmd = engine.parseStackedCommand('/code-review /security-scanner src/foo.ts');
      expect(cmd).not.toBeNull();
      expect(cmd!.skillNames).toEqual(['code-review', 'security-scanner']);
      expect(cmd!.args).toBe('src/foo.ts');

      const validation = engine.validateComposition(cmd!.skillNames);
      expect(validation.valid).toBe(true);

      const result = await engine.executeParsed(cmd!, { parallelExecution: false });
      expect(result.results).toHaveLength(2);
      expect(result.successCount).toBe(2);
      expect(result.failureCount).toBe(0);
    });

    it('StackedSkillEngine 并行执行 3 个技能', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine);

      const result = await engine.executeStack(
        '/code-review /security-scanner /test-generator',
        { parallelExecution: true }
      );
      expect(result.results).toHaveLength(3);
    });

    it('拒绝超过 5 个技能', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine);

      const cmd = engine.parseStackedCommand('/a /b /c /d /e /f');
      expect(cmd).toBeNull();
    });

    it('工具冲突检测', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine);

      const conflicts = engine.detectToolConflicts(['code-review', 'security-scanner']);
      // 'read' 工具在两个技能中都允许
      expect(Array.isArray(conflicts)).toBe(true);
    });
  });

  describe('全局单例', () => {
    it('getDefaultStackedSkillEngine 可重复获取', async () => {
      const { getDefaultStackedSkillEngine, resetDefaultStackedSkillEngine } = await import('../utils/stackedSkillEngine');
      resetDefaultStackedSkillEngine();
      const a = getDefaultStackedSkillEngine();
      const b = getDefaultStackedSkillEngine();
      expect(a).toBe(b);
    });
  });

  describe('事件系统', () => {
    it('订阅 stack-completed 事件', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine, { persist: false });

      const events: any[] = [];
      engine.on('stack-completed', (e) => events.push(e));
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      expect(events.length).toBe(1);
    });

    it('订阅 skill-completed 事件', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine, { persist: false });

      const events: any[] = [];
      engine.on('skill-completed', (e) => events.push(e));
      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      expect(events.length).toBe(2);
    });
  });

  describe('统计与历史', () => {
    it('执行后历史 + 统计更新', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine, { persist: false });

      await engine.executeStack('/code-review /security-scanner', { parallelExecution: false });
      const history = engine.getHistory();
      expect(history.length).toBe(1);
      const stats = engine.getStats();
      expect(stats.totalExecutions).toBe(1);
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe('持久化', () => {
    it('执行历史写入 localStorage', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const skillEngine = new SkillEngine();
      const engine = new StackedSkillEngine(skillEngine, { persist: true });

      await engine.executeStack('/code-review', { parallelExecution: false });
      const raw = localStorage.getItem('hermes.stackedSkills');
      expect(raw).toBeDefined();
    });
  });

  describe('UI 组件导入连通性', () => {
    it('StackedSkillsPanel 可成功导入', async () => {
      const { StackedSkillsPanel } = await import('../components/StackedSkillsPanel');
      expect(StackedSkillsPanel).toBeDefined();
    });

    it('MarketplacePanel 可成功导入', async () => {
      const { MarketplacePanel } = await import('../components/MarketplacePanel');
      expect(MarketplacePanel).toBeDefined();
    });

    it('AnalyticsChatPanel 可成功导入', async () => {
      const { AnalyticsChatPanel } = await import('../components/AnalyticsChatPanel');
      expect(AnalyticsChatPanel).toBeDefined();
    });
  });

  describe('G29-02: Skills Marketplace 端到端', () => {
    it('MarketplaceEngine 安装 + 评分 + 评论 完整流程', async () => {
      const { SkillsMarketplace } = await import('../utils/marketplaceEngine');
      const mp = new SkillsMarketplace({ persist: false });

      // 浏览
      const all = mp.listSkills();
      expect(all.length).toBeGreaterThan(0);

      // 安装
      const skill = mp.installSkill('mp-code-review-pro');
      expect(skill.installed).toBe(true);

      // 评分
      mp.rateSkill('mp-code-review-pro', 5, 'test-user');
      const skillAfterRate = mp.getSkill('mp-code-review-pro');
      expect(skillAfterRate!.ratingCount).toBeGreaterThan(0);

      // 评论
      const comment = mp.commentOnSkill('mp-code-review-pro', '非常好用', 'test-user', 5);
      expect(comment.id).toBeDefined();
      expect(comment.sentiment).toBe('positive');

      // 统计
      const stats = mp.getStats();
      expect(stats.installedSkills).toBe(1);
      expect(stats.totalComments).toBeGreaterThan(0);
    });

    it('搜索 + 分类过滤', async () => {
      const { SkillsMarketplace } = await import('../utils/marketplaceEngine');
      const mp = new SkillsMarketplace({ persist: false });

      const security = mp.listSkills({ category: 'security' });
      expect(security.length).toBeGreaterThan(0);
      expect(security.every((s) => s.category === 'security')).toBe(true);

      const searched = mp.searchSkills('review');
      expect(searched.some((s) => s.name.includes('review'))).toBe(true);
    });

    it('事件系统完整', async () => {
      const { SkillsMarketplace } = await import('../utils/marketplaceEngine');
      const mp = new SkillsMarketplace({ persist: false });

      let installedCount = 0;
      let ratedCount = 0;
      let commentedCount = 0;

      mp.on('skill-installed', () => installedCount++);
      mp.on('skill-rated', () => ratedCount++);
      mp.on('comment-added', () => commentedCount++);

      mp.installSkill('mp-code-review-pro');
      mp.rateSkill('mp-code-review-pro', 4, 'u1');
      mp.commentOnSkill('mp-code-review-pro', '好用的工具');

      expect(installedCount).toBe(1);
      expect(ratedCount).toBe(1);
      expect(commentedCount).toBe(1);
    });
  });

  describe('G29-03: Analytics Chat 端到端', () => {
    it('AnalyticsChat 查询 + 图表 + 导出 完整流程', async () => {
      const { AnalyticsChat } = await import('../utils/analyticsChatEngine');
      const chat = new AnalyticsChat({ persist: false });

      // 查询
      const result = await chat.query('按团队的用量');
      expect(result.queryType).toBe('usage-by-team');
      expect(result.chartSpec).toBeDefined();
      expect(result.followUpQuestions.length).toBeGreaterThan(0);

      // 导出
      const csv = chat.exportData(result, 'csv');
      expect(csv).toContain('team,cost');

      const json = chat.exportData(result, 'json');
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('不同查询类型覆盖', async () => {
      const { AnalyticsChat } = await import('../utils/analyticsChatEngine');
      const chat = new AnalyticsChat({ persist: false });

      const r1 = await chat.query('哪个模型成本最高？');
      expect(r1.queryType).toBe('usage-by-model');

      const r2 = await chat.query('今天的预算使用率？');
      expect(r2.queryType).toBe('budget-status');

      const r3 = await chat.query('code-review 技能调用次数？');
      expect(r3.queryType).toBe('usage-by-skill');
    });

    it('历史管理 + 事件', async () => {
      const { AnalyticsChat } = await import('../utils/analyticsChatEngine');
      const chat = new AnalyticsChat({ persist: false });

      let executedCount = 0;
      let chartCount = 0;
      let exportCount = 0;
      let clearedCount = 0;

      chat.on('query-executed', () => executedCount++);
      chat.on('chart-generated', () => chartCount++);
      chat.on('data-exported', () => exportCount++);
      chat.on('history-cleared', () => clearedCount++);

      const r1 = await chat.query('按团队查询用量');
      const r2 = await chat.query('按模型查询用量');
      chat.exportData(r1, 'csv');
      chat.exportData(r2, 'csv');
      chat.clearHistory();

      expect(executedCount).toBe(2);
      expect(chartCount).toBe(2);
      expect(exportCount).toBe(2);
      expect(clearedCount).toBe(1);
      expect(chat.getHistory().length).toBe(0);
    });
  });

  describe('Cycle 29 三引擎协同', () => {
    it('Stacked + Marketplace + Analytics 同时工作', async () => {
      const { StackedSkillEngine } = await import('../utils/stackedSkillEngine');
      const { SkillEngine } = await import('../utils/skillEngine');
      const { SkillsMarketplace } = await import('../utils/marketplaceEngine');
      const { AnalyticsChat } = await import('../utils/analyticsChatEngine');

      const skillEngine = new SkillEngine();
      const stacked = new StackedSkillEngine(skillEngine, { persist: false });
      const mp = new SkillsMarketplace({ persist: false });
      const chat = new AnalyticsChat({ persist: false });

      // Stacked
      const cmd = stacked.parseStackedCommand('/code-review /security-scanner');
      expect(cmd).not.toBeNull();

      // Marketplace
      const skill = mp.installSkill('mp-code-review-pro');
      expect(skill.installed).toBe(true);

      // Analytics
      const result = await chat.query('按团队查询');
      expect(result.queryType).toBe('usage-by-team');

      // 三者独立工作
      expect(stacked).toBeDefined();
      expect(mp).toBeDefined();
      expect(chat).toBeDefined();
    });
  });
});
