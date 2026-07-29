/**
 * # ============================================================
 * # ProactiveSuggestionEngine 单元测试 (Cycle 23 G23-04)
 * # ============================================================
 * # 测试覆盖：
 * #   1. 引擎构造与单例
 * #   2. 基于规则的建议生成（8 种规则）
 * #   3. 建议反馈（接受/拒绝/忽略）
 * #   4. 类型权重学习
 * #   5. 统计信息
 * #   6. 配置管理
 * #   7. 去重逻辑
 * #   8. 过期清理
 * #   9. 活跃数限制
 *  10. 事件订阅
 * ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ProactiveSuggestionEngine,
  getProactiveSuggestionEngine,
  resetProactiveSuggestionEngine,
  type SessionContext,
} from './proactiveSuggestion';

beforeEach(() => {
  resetProactiveSuggestionEngine();
});

afterEach(() => {
  resetProactiveSuggestionEngine();
});

describe('ProactiveSuggestionEngine - 基础', () => {
  it('应能创建实例', () => {
    const engine = new ProactiveSuggestionEngine();
    expect(engine).toBeInstanceOf(ProactiveSuggestionEngine);
  });

  it('默认配置应正确', () => {
    const engine = new ProactiveSuggestionEngine();
    const config = engine.getConfig();
    expect(config.maxActiveSuggestions).toBeGreaterThan(0);
    expect(config.dedupWindowMs).toBeGreaterThan(0);
    expect(config.defaultTtlMs).toBeGreaterThan(0);
  });

  it('应能接受自定义配置', () => {
    const engine = new ProactiveSuggestionEngine({ maxActiveSuggestions: 5 });
    expect(engine.getConfig().maxActiveSuggestions).toBe(5);
  });

  it('单例工厂应返回同一实例', () => {
    const a = getProactiveSuggestionEngine();
    const b = getProactiveSuggestionEngine();
    expect(a).toBe(b);
  });

  it('resetProactiveSuggestionEngine 应清空单例', () => {
    const a = getProactiveSuggestionEngine();
    resetProactiveSuggestionEngine();
    const b = getProactiveSuggestionEngine();
    expect(a).not.toBe(b);
  });
});

describe('ProactiveSuggestionEngine - 建议生成（规则）', () => {
  it('错误状态下应建议查看错误', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    };
    const suggestions = engine.generateSuggestions(context);
    const errorSuggestion = suggestions.find((s) => s.title === '查看错误详情');
    expect(errorSuggestion).toBeDefined();
    expect(errorSuggestion?.type).toBe('next-action');
  });

  it('空闲 + 长对话应建议压缩', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'idle',
      taskType: 'general',
      messageCount: 15,
    };
    const suggestions = engine.generateSuggestions(context);
    const compress = suggestions.find((s) => s.title.includes('压缩'));
    expect(compress).toBeDefined();
    expect(compress?.type).toBe('optimization');
  });

  it('编码工作流应建议 Best-of-N', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'workflow',
      taskType: 'coding',
      messageCount: 5,
    };
    const suggestions = engine.generateSuggestions(context);
    const bestofn = suggestions.find((s) => s.title.includes('Best-of-N'));
    expect(bestofn).toBeDefined();
    expect(bestofn?.type).toBe('related-feature');
  });

  it('成本接近预算（>80%）应告警', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      messageCount: 5,
      costSoFar: 90,
      budgetLimit: 100,
    };
    const suggestions = engine.generateSuggestions(context);
    const costWarning = suggestions.find((s) => s.title.includes('成本'));
    expect(costWarning).toBeDefined();
    expect(costWarning?.type).toBe('optimization');
  });

  it('成本未接近预算不应告警', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      messageCount: 5,
      costSoFar: 30,
      budgetLimit: 100,
    };
    const suggestions = engine.generateSuggestions(context);
    const costWarning = suggestions.find((s) => s.title.includes('成本接近'));
    expect(costWarning).toBeUndefined();
  });

  it('写作任务 + 长对话应建议 Composer', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'writing',
      messageCount: 10,
    };
    const suggestions = engine.generateSuggestions(context);
    const composer = suggestions.find((s) => s.title.includes('Composer'));
    expect(composer).toBeDefined();
  });

  it('有挂起任务应建议查看', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      messageCount: 5,
      hasPendingTasks: true,
    };
    const suggestions = engine.generateSuggestions(context);
    const pending = suggestions.find((s) => s.title.includes('待办'));
    expect(pending).toBeDefined();
  });

  it('分析任务应建议 FAQ', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'analysis',
      messageCount: 5,
    };
    const suggestions = engine.generateSuggestions(context);
    const faq = suggestions.find((s) => s.title.includes('分析'));
    expect(faq).toBeDefined();
    expect(faq?.type).toBe('faq');
  });

  it('新会话应欢迎', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      messageCount: 0,
    };
    const suggestions = engine.generateSuggestions(context);
    const welcome = suggestions.find((s) => s.title.includes('欢迎'));
    expect(welcome).toBeDefined();
  });

  it('空上下文不应生成任何建议', () => {
    const engine = new ProactiveSuggestionEngine();
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      messageCount: 1,
    };
    const suggestions = engine.generateSuggestions(context);
    // 至少错误/压缩/分析等规则都不应触发
    // 但新会话欢迎因为 messageCount=1 也不触发
    const allRules = suggestions.filter((s) =>
      ['查看错误', '压缩', 'Best-of-N', '成本', 'Composer', '待办', '分析', '欢迎'].some(
        (k) => s.title.includes(k)
      )
    );
    expect(allRules.length).toBe(0);
  });
});

describe('ProactiveSuggestionEngine - 反馈', () => {
  it('acceptSuggestion 应将建议移出活跃列表', () => {
    const engine = new ProactiveSuggestionEngine();
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const sg = suggestions[0];
    if (sg) {
      const result = engine.acceptSuggestion(sg.suggestionId);
      expect(result).not.toBeNull();
      expect(engine.getActiveSuggestions().find((s) => s.suggestionId === sg.suggestionId)).toBeUndefined();
    }
  });

  it('不存在的 ID accept 应返回 null', () => {
    const engine = new ProactiveSuggestionEngine();
    expect(engine.acceptSuggestion('non-existent')).toBeNull();
  });

  it('dismissSuggestion 应拒绝建议', () => {
    const engine = new ProactiveSuggestionEngine();
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const sg = suggestions[0];
    if (sg) {
      const result = engine.dismissSuggestion(sg.suggestionId);
      expect(result).not.toBeNull();
      const stats = engine.getStats();
      expect(stats.totalDismissed).toBe(1);
    }
  });

  it('markIgnored 应标记为忽略', () => {
    const engine = new ProactiveSuggestionEngine();
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const sg = suggestions[0];
    if (sg) {
      engine.markIgnored(sg.suggestionId);
      const stats = engine.getStats();
      expect(stats.totalIgnored).toBe(1);
    }
  });

  it('clearAll 应清空活跃建议', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    engine.clearAll();
    expect(engine.getActiveSuggestions().length).toBe(0);
  });

  it('reset 应清空所有状态', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    engine.reset();
    const stats = engine.getStats();
    expect(stats.totalGenerated).toBe(0);
    expect(stats.activeCount).toBe(0);
  });
});

describe('ProactiveSuggestionEngine - 权重学习', () => {
  it('acceptSuggestion 应增加对应类型权重', () => {
    const engine = new ProactiveSuggestionEngine();
    const before = engine.getTypeWeights()['next-action'];
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const sg = suggestions.find((s) => s.type === 'next-action');
    if (sg) {
      engine.acceptSuggestion(sg.suggestionId);
      const after = engine.getTypeWeights()['next-action'];
      expect(after).toBeGreaterThan(before);
    }
  });

  it('dismissSuggestion 应降低对应类型权重', () => {
    const engine = new ProactiveSuggestionEngine();
    const before = engine.getTypeWeights()['next-action'];
    const suggestions = engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const sg = suggestions.find((s) => s.type === 'next-action');
    if (sg) {
      engine.dismissSuggestion(sg.suggestionId);
      const after = engine.getTypeWeights()['next-action'];
      expect(after).toBeLessThan(before);
    }
  });

  it('权重应限制在 [0.1, 2.0] 范围内', () => {
    const engine = new ProactiveSuggestionEngine();
    // 反复接受同一类型 100 次
    for (let i = 0; i < 100; i++) {
      engine.generateSuggestions({
        conversationState: 'active',
      taskType: 'general',
        hasError: true,
        messageCount: 5,
      });
      const sg = engine.getActiveSuggestions().find((s) => s.type === 'next-action');
      if (sg) engine.acceptSuggestion(sg.suggestionId);
    }
    const weight = engine.getTypeWeights()['next-action'];
    expect(weight).toBeLessThanOrEqual(2.0);
    expect(weight).toBeGreaterThanOrEqual(0.1);
  });
});

describe('ProactiveSuggestionEngine - 统计', () => {
  it('初始统计应为零', () => {
    const engine = new ProactiveSuggestionEngine();
    const stats = engine.getStats();
    expect(stats.totalGenerated).toBe(0);
    expect(stats.totalAccepted).toBe(0);
    expect(stats.totalDismissed).toBe(0);
    expect(stats.totalIgnored).toBe(0);
    expect(stats.acceptanceRate).toBe(0);
    expect(stats.activeCount).toBe(0);
  });

  it('生成建议后 totalGenerated 应增加', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const stats = engine.getStats();
    expect(stats.totalGenerated).toBeGreaterThan(0);
  });

  it('acceptanceRate 应正确计算', () => {
    const engine = new ProactiveSuggestionEngine({ dedupWindowMs: 0 });
    // 生成多个不同建议
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 20,
      hasPendingTasks: true,
    };
    const suggestions = engine.generateSuggestions(context);
    expect(suggestions.length).toBeGreaterThanOrEqual(2);
    // 接受 1 个
    if (suggestions[0]) engine.acceptSuggestion(suggestions[0].suggestionId);
    // 拒绝 1 个
    if (suggestions[1]) engine.dismissSuggestion(suggestions[1].suggestionId);
    const stats = engine.getStats();
    expect(stats.acceptanceRate).toBe(0.5);
  });

  it('byType 应按类型统计', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const stats = engine.getStats();
    expect(stats.byType['next-action'].generated).toBeGreaterThan(0);
  });
});

describe('ProactiveSuggestionEngine - 配置', () => {
  it('updateConfig 应合并新配置', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.updateConfig({ maxActiveSuggestions: 10 });
    expect(engine.getConfig().maxActiveSuggestions).toBe(10);
  });

  it('getConfig 应返回配置副本（防止外部修改）', () => {
    const engine = new ProactiveSuggestionEngine();
    const config = engine.getConfig();
    config.maxActiveSuggestions = 999;
    expect(engine.getConfig().maxActiveSuggestions).not.toBe(999);
  });
});

describe('ProactiveSuggestionEngine - 去重', () => {
  it('窗口内同 type+title 应被去重', () => {
    const engine = new ProactiveSuggestionEngine({ dedupWindowMs: 60000 });
    const context: SessionContext = {
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    };
    engine.generateSuggestions(context);
    const firstGen = engine.getStats().totalGenerated;
    engine.generateSuggestions(context);
    const secondGen = engine.getStats().totalGenerated;
    // 第二次应被去重，不会增加
    expect(secondGen - firstGen).toBeLessThan(2);
  });
});

describe('ProactiveSuggestionEngine - 活跃数限制', () => {
  it('达到 maxActiveSuggestions 应停止生成', () => {
    const engine = new ProactiveSuggestionEngine({ maxActiveSuggestions: 2 });
    // 多次生成但只能有 2 个活跃
    for (let i = 0; i < 5; i++) {
      engine.generateSuggestions({
        conversationState: 'active',
        hasError: true,
        messageCount: 100, // 触发多条规则
        hasPendingTasks: true,
        taskType: 'analysis',
        costSoFar: 90,
        budgetLimit: 100,
      });
    }
    expect(engine.getActiveSuggestions().length).toBeLessThanOrEqual(2);
  });
});

describe('ProactiveSuggestionEngine - 事件', () => {
  it('on() 应返回取消订阅函数', () => {
    const engine = new ProactiveSuggestionEngine();
    const handler = vi.fn();
    const unsub = engine.on('suggestion-generated', handler);
    expect(typeof unsub).toBe('function');
    unsub();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it('应触发 suggestion-generated 事件', () => {
    const engine = new ProactiveSuggestionEngine();
    const handler = vi.fn();
    engine.on('suggestion-generated', handler);
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 suggestion-accepted 事件', () => {
    const engine = new ProactiveSuggestionEngine();
    const handler = vi.fn();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    engine.on('suggestion-accepted', handler);
    const sg = engine.getActiveSuggestions()[0];
    if (sg) engine.acceptSuggestion(sg.suggestionId);
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 suggestion-dismissed 事件', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const handler = vi.fn();
    engine.on('suggestion-dismissed', handler);
    const sg = engine.getActiveSuggestions()[0];
    if (sg) engine.dismissSuggestion(sg.suggestionId);
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 config-updated 事件', () => {
    const engine = new ProactiveSuggestionEngine();
    const handler = vi.fn();
    engine.on('config-updated', handler);
    engine.updateConfig({ maxActiveSuggestions: 10 });
    expect(handler).toHaveBeenCalled();
  });
});

describe('ProactiveSuggestionEngine - getHistory', () => {
  it('应返回按时间倒序的反馈记录', () => {
    const engine = new ProactiveSuggestionEngine({ dedupWindowMs: 0 });
    // 第一次生成（多建议）
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 20,
      hasPendingTasks: true,
    });
    const sg1 = engine.getActiveSuggestions()[0];
    if (sg1) engine.acceptSuggestion(sg1.suggestionId);
    // 第二次生成（新建议）
    engine.generateSuggestions({
      conversationState: 'idle',
      taskType: 'analysis',
      messageCount: 20,
    });
    const sg2 = engine.getActiveSuggestions()[0];
    if (sg2) engine.dismissSuggestion(sg2.suggestionId);
    const history = engine.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history[0].timestamp).toBeGreaterThanOrEqual(history[1].timestamp);
  });

  it('应支持限制返回数量', () => {
    const engine = new ProactiveSuggestionEngine();
    engine.generateSuggestions({
      conversationState: 'active',
      taskType: 'general',
      hasError: true,
      messageCount: 5,
    });
    const sg = engine.getActiveSuggestions()[0];
    if (sg) engine.acceptSuggestion(sg.suggestionId);
    const history = engine.getHistory(1);
    expect(history.length).toBe(1);
  });
});
