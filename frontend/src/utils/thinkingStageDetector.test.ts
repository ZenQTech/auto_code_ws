/**
 * # ============================================================
 * # 思考阶段检测工具测试 (Cycle 15 P1-10)
 * # ============================================================
 * # 核心作用：覆盖 detectStage / inferStageFromProgress / resolveStage 的
 * #           全部边界场景，确保 ThinkingBlock 阶段标签自动检测的正确性
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  detectStage,
  inferStageFromProgress,
  resolveStage,
  type StageHistoryEntry,
} from './thinkingStageDetector';

describe('detectStage - 基础功能', () => {
  it('空内容应返回 idle 阶段', () => {
    const result = detectStage('');
    expect(result.currentStage).toBe('idle');
    expect(result.confidence).toBe(0);
    expect(result.history).toEqual([]);
  });

  it('纯空白内容应返回 idle 阶段', () => {
    const result = detectStage('   \n\n  \t  ');
    expect(result.currentStage).toBe('idle');
    expect(result.confidence).toBe(0);
  });

  it('无任何关键词的纯文本应默认 analysis 阶段（低置信度）', () => {
    const result = detectStage('Some random content without any keywords.');
    expect(result.currentStage).toBe('analysis');
    expect(result.confidence).toBeLessThan(0.5);
  });
});

describe('detectStage - 关键词匹配', () => {
  it('应识别 analysis 阶段关键词（中文）', () => {
    const result = detectStage('让我先分析一下用户的需求');
    expect(result.currentStage).toBe('analysis');
  });

  it('应识别 analysis 阶段关键词（英文）', () => {
    const result = detectStage('Let me analyze the requirements first.');
    expect(result.currentStage).toBe('analysis');
  });

  it('应识别 planning 阶段关键词（中文）', () => {
    const result = detectStage('我需要设计方案');
    expect(result.currentStage).toBe('planning');
  });

  it('应识别 planning 阶段关键词（英文）', () => {
    const result = detectStage('My plan is to design a new architecture.');
    expect(result.currentStage).toBe('planning');
  });

  it('应识别 coding 阶段关键词（中文）', () => {
    const result = detectStage('现在我开始编写代码');
    expect(result.currentStage).toBe('coding');
  });

  it('应识别 coding 阶段关键词（英文）', () => {
    const result = detectStage('Let me write the function implementation.');
    expect(result.currentStage).toBe('coding');
  });

  it('应识别 testing 阶段关键词（中文）', () => {
    const result = detectStage('代码写完了，我来测试一下');
    expect(result.currentStage).toBe('testing');
  });

  it('应识别 testing 阶段关键词（英文）', () => {
    const result = detectStage('Let me test the code now.');
    expect(result.currentStage).toBe('testing');
  });

  it('多阶段关键词时取最后一个出现的阶段', () => {
    const content = `
      让我先分析需求
      然后设计方案
      开始写代码
    `;
    const result = detectStage(content);
    expect(result.currentStage).toBe('coding');
  });
});

describe('detectStage - 阶段边界（最高置信度）', () => {
  it('应识别 "## 分析:" 边界', () => {
    const result = detectStage('## 分析:\n让我理解需求\n\n## 实现:\n开始写代码');
    expect(result.currentStage).toBe('coding');
    expect(result.confidence).toBe(1.0);
  });

  it('应识别 "## 设计:" 边界', () => {
    const result = detectStage('## 设计:\n我打算这样设计\n\n## 测试:\n验证一下');
    expect(result.currentStage).toBe('testing');
    expect(result.confidence).toBe(1.0);
  });

  it('应识别 "Plan:" 英文边界', () => {
    const result = detectStage('Plan: I will design this.\n\nCode:\nfunction foo() {}');
    expect(result.currentStage).toBe('coding');
  });

  it('应识别 "Testing:" 英文边界', () => {
    const result = detectStage('Test: I will verify the code works.');
    expect(result.currentStage).toBe('testing');
  });
});

describe('detectStage - 阶段历史', () => {
  it('无边界时应返回空历史数组', () => {
    const result = detectStage('随便写点什么');
    expect(result.history).toEqual([]);
  });

  it('多边界时应返回完整历史', () => {
    const content = `## 分析:
理解需求是什么

## 设计:
设计实现方案

## 实现:
编写代码

## 测试:
验证结果`;
    const result = detectStage(content);
    expect(result.history.length).toBe(4);
    expect(result.history[0].stage).toBe('analysis');
    expect(result.history[1].stage).toBe('planning');
    expect(result.history[2].stage).toBe('coding');
    expect(result.history[3].stage).toBe('testing');
  });

  it('阶段历史应包含 startPos / endPos / summary', () => {
    const content = `## 分析:
理解需求

## 实现:
开始写代码`;
    const result = detectStage(content);
    expect(result.history.length).toBe(2);
    result.history.forEach((entry: StageHistoryEntry) => {
      expect(entry).toHaveProperty('stage');
      expect(entry).toHaveProperty('startPos');
      expect(entry).toHaveProperty('endPos');
      expect(entry).toHaveProperty('summary');
      expect(typeof entry.startPos).toBe('number');
      expect(typeof entry.endPos).toBe('number');
      expect(entry.endPos).toBeGreaterThan(entry.startPos);
    });
  });

  it('最后一个阶段 endPos 应为文本末尾', () => {
    const content = `## 分析:
需求理解
## 实现:
代码实现`;
    const result = detectStage(content);
    const lastEntry = result.history[result.history.length - 1];
    expect(lastEntry.endPos).toBe(content.length);
  });
});

describe('detectStage - 边界场景', () => {
  it('超长文本应能在合理时间内完成（性能验证）', () => {
    const longContent = '分析'.repeat(1000) + '实现' + '代码'.repeat(1000);
    const start = Date.now();
    const result = detectStage(longContent);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500); // 500ms 内完成
    // 末尾出现 "代码" 应该是 coding
    expect(result.currentStage).toBe('coding');
  });

  it('特殊字符不应干扰关键词匹配', () => {
    const result = detectStage('【分析】需求是这样的！@#$%^&*()');
    expect(result.currentStage).toBe('analysis');
  });

  it('关键词大小写不敏感（英文）', () => {
    const r1 = detectStage('Let me ANALYZE this');
    const r2 = detectStage('Let me analyze this');
    expect(r1.currentStage).toBe('analysis');
    expect(r2.currentStage).toBe('analysis');
  });

  it('阶段历史摘要应截断超长内容', () => {
    const content = `## 分析:
${'需求理解内容'.repeat(50)}`;
    const result = detectStage(content);
    expect(result.history[0].summary.length).toBeLessThanOrEqual(60);
  });
});

describe('inferStageFromProgress - 进度推断', () => {
  it('0% 进度应返回 analysis', () => {
    expect(inferStageFromProgress(0)).toBe('analysis');
  });

  it('24% 进度应返回 analysis', () => {
    expect(inferStageFromProgress(0.24)).toBe('analysis');
  });

  it('25% 进度应返回 planning', () => {
    expect(inferStageFromProgress(0.25)).toBe('planning');
  });

  it('49% 进度应返回 planning', () => {
    expect(inferStageFromProgress(0.49)).toBe('planning');
  });

  it('50% 进度应返回 coding', () => {
    expect(inferStageFromProgress(0.5)).toBe('coding');
  });

  it('79% 进度应返回 coding', () => {
    expect(inferStageFromProgress(0.79)).toBe('coding');
  });

  it('80% 进度应返回 testing', () => {
    expect(inferStageFromProgress(0.8)).toBe('testing');
  });

  it('100% 进度应返回 testing', () => {
    expect(inferStageFromProgress(1.0)).toBe('testing');
  });
});

describe('resolveStage - 综合解析', () => {
  it('显式阶段优先级最高', () => {
    const result = resolveStage('testing', '让我分析需求', 0.1);
    expect(result).toBe('testing');
  });

  it('无显式阶段时使用内容检测', () => {
    const result = resolveStage(undefined, '现在编写代码', 0.1);
    expect(result).toBe('coding');
  });

  it('显式阶段为 idle 时使用内容检测', () => {
    const result = resolveStage('idle', '现在编写代码', 0.1);
    expect(result).toBe('coding');
  });

  it('无显式阶段 + 无关键词匹配时使用进度推断', () => {
    const result = resolveStage(undefined, 'random text', 0.6);
    expect(result).toBe('coding');
  });

  it('检测应优先于进度推断', () => {
    // 进度 0.1（推断为 analysis），但内容末尾出现 "测试一下"
    const result = resolveStage(undefined, 'random prefix\n测试一下', 0.1);
    expect(result).toBe('testing');
  });
});
