/**
 * # ============================================================
 * # MCP Sampling 单元测试 (v1.0.0 Cycle 41 G41-03)
 * # ============================================================
 * # 覆盖：SamplingHandler 全功能
 * #       - 默认执行器
 * #       - 自定义执行器
 * #       - 审批器
 * #       - 事件分发
 * #       - 历史记录
 * #       - 统计
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 41 G41-03 初次创建
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SamplingHandler,
  createSamplingHandler,
  defaultSamplingExecutor,
  type SamplingCreateRequest,
  type SamplingCreateResponse,
  type SamplingExecutor,
  type SamplingApprover,
  type SamplingEvent,
} from './mcpSampling';

// ============ 工具函数 ============

function makeTextRequest(text: string = 'hello'): SamplingCreateRequest {
  return {
    messages: [{ role: 'user', content: { type: 'text', text } }],
    maxTokens: 1000,
  };
}

// ============ 默认执行器测试 ============

describe('defaultSamplingExecutor', () => {
  it('回显最后一条用户消息', async () => {
    const resp = await defaultSamplingExecutor(makeTextRequest('hi there'));
    expect(resp.content.type).toBe('text');
    if (resp.content.type === 'text') {
      expect(resp.content.text).toContain('hi there');
    }
  });

  it('没有用户消息时回显空', async () => {
    const resp = await defaultSamplingExecutor({
      messages: [],
      maxTokens: 100,
    });
    if (resp.content.type === 'text') {
      expect(resp.content.text).toBe('[echo] ');
    }
  });
});

// ============ 基础功能测试 ============

describe('SamplingHandler - 基础', () => {
  it('创建实例', () => {
    const h = new SamplingHandler();
    expect(h.getStats().total).toBe(0);
    expect(h.getHistory()).toEqual([]);
  });

  it('工厂函数创建', () => {
    const h = createSamplingHandler();
    expect(h).toBeInstanceOf(SamplingHandler);
  });
});

// ============ 执行器测试 ============

describe('SamplingHandler - 执行器', () => {
  it('使用自定义执行器', async () => {
    const customExec: SamplingExecutor = async (req) => ({
      model: 'custom',
      stopReason: 'endTurn',
      role: 'assistant',
      content: { type: 'text', text: 'custom response' },
    });
    const h = new SamplingHandler({ executor: customExec });
    const resp = await h.handle(makeTextRequest());
    expect(resp.model).toBe('custom');
    expect(resp.content.type).toBe('text');
    if (resp.content.type === 'text') {
      expect(resp.content.text).toBe('custom response');
    }
  });

  it('动态切换执行器', async () => {
    const h = new SamplingHandler();
    h.setExecutor(async () => ({
      model: 'a',
      stopReason: 'endTurn',
      role: 'assistant',
      content: { type: 'text', text: 'A' },
    }));
    let r = await h.handle(makeTextRequest());
    if (r.content.type === 'text') expect(r.content.text).toBe('A');

    h.setExecutor(async () => ({
      model: 'b',
      stopReason: 'endTurn',
      role: 'assistant',
      content: { type: 'text', text: 'B' },
    }));
    r = await h.handle(makeTextRequest());
    if (r.content.type === 'text') expect(r.content.text).toBe('B');
  });

  it('执行器错误传播', async () => {
    const h = new SamplingHandler({
      executor: async () => {
        throw new Error('LLM error');
      },
    });
    await expect(h.handle(makeTextRequest())).rejects.toThrow('LLM error');
  });
});

// ============ 审批器测试 ============

describe('SamplingHandler - 审批器', () => {
  it('审批通过', async () => {
    const approver: SamplingApprover = async () => true;
    const h = new SamplingHandler({ approver });
    const resp = await h.handle(makeTextRequest());
    expect(resp).toBeDefined();
    expect(h.getStats().approved).toBe(1);
    expect(h.getStats().rejected).toBe(0);
  });

  it('审批拒绝', async () => {
    const approver: SamplingApprover = async () => false;
    const h = new SamplingHandler({ approver });
    await expect(h.handle(makeTextRequest())).rejects.toThrow('rejected');
    expect(h.getStats().rejected).toBe(1);
  });

  it('审批器抛错', async () => {
    const approver: SamplingApprover = async () => {
      throw new Error('UI failure');
    };
    const h = new SamplingHandler({ approver });
    await expect(h.handle(makeTextRequest())).rejects.toThrow('UI failure');
    expect(h.getStats().errors).toBe(1);
  });

  it('审批器收到正确请求', async () => {
    const approver = vi.fn(async () => true);
    const h = new SamplingHandler({ approver });
    const req = makeTextRequest('test123');
    await h.handle(req);
    expect(approver).toHaveBeenCalledWith(req);
  });

  it('动态切换审批器', async () => {
    const h = new SamplingHandler();
    h.setApprover(async () => false);
    await expect(h.handle(makeTextRequest())).rejects.toThrow('rejected');
    h.setApprover(null);
    const resp = await h.handle(makeTextRequest());
    expect(resp).toBeDefined();
  });
});

// ============ 事件分发测试 ============

describe('SamplingHandler - 事件', () => {
  it('request 事件', async () => {
    const h = new SamplingHandler();
    const events: SamplingEvent[] = [];
    h.on((e) => events.push(e));
    await h.handle(makeTextRequest());
    expect(events.find((e) => e.type === 'request')).toBeDefined();
  });

  it('approved 事件', async () => {
    const h = new SamplingHandler({ approver: async () => true });
    const events: SamplingEvent[] = [];
    h.on((e) => events.push(e));
    await h.handle(makeTextRequest());
    expect(events.find((e) => e.type === 'approved')).toBeDefined();
  });

  it('rejected 事件', async () => {
    const h = new SamplingHandler({ approver: async () => false });
    const events: SamplingEvent[] = [];
    h.on((e) => events.push(e));
    await expect(h.handle(makeTextRequest())).rejects.toThrow();
    expect(events.find((e) => e.type === 'rejected')).toBeDefined();
  });

  it('completed 事件', async () => {
    const h = new SamplingHandler();
    const events: SamplingEvent[] = [];
    h.on((e) => events.push(e));
    await h.handle(makeTextRequest());
    expect(events.find((e) => e.type === 'completed')).toBeDefined();
  });

  it('error 事件', async () => {
    const h = new SamplingHandler({
      executor: async () => {
        throw new Error('fail');
      },
    });
    const events: SamplingEvent[] = [];
    h.on((e) => events.push(e));
    await expect(h.handle(makeTextRequest())).rejects.toThrow();
    expect(events.find((e) => e.type === 'error')).toBeDefined();
  });

  it('取消事件订阅', async () => {
    const h = new SamplingHandler();
    const off = h.on(() => {});
    off();
    await h.handle(makeTextRequest());
    expect(h.getStats().total).toBe(1);
  });
});

// ============ 历史记录测试 ============

describe('SamplingHandler - 历史', () => {
  it('记录完成请求', async () => {
    const h = new SamplingHandler();
    await h.handle(makeTextRequest());
    expect(h.getHistory().length).toBe(1);
    expect(h.getHistory()[0].status).toBe('completed');
  });

  it('记录拒绝请求', async () => {
    const h = new SamplingHandler({ approver: async () => false });
    await expect(h.handle(makeTextRequest())).rejects.toThrow();
    expect(h.getHistory()[0].status).toBe('rejected');
  });

  it('记录错误请求', async () => {
    const h = new SamplingHandler({
      executor: async () => {
        throw new Error('e');
      },
    });
    await expect(h.handle(makeTextRequest())).rejects.toThrow();
    expect(h.getHistory()[0].status).toBe('error');
    expect(h.getHistory()[0].error?.message).toBe('e');
  });

  it('超过 maxHistory 时丢弃旧的', async () => {
    const h = new SamplingHandler({ maxHistory: 5 });
    for (let i = 0; i < 10; i++) {
      await h.handle(makeTextRequest(`msg${i}`));
    }
    expect(h.getHistory().length).toBe(5);
  });

  it('clearHistory 清空', async () => {
    const h = new SamplingHandler();
    await h.handle(makeTextRequest());
    h.clearHistory();
    expect(h.getHistory().length).toBe(0);
  });
});

// ============ 统计测试 ============

describe('SamplingHandler - 统计', () => {
  it('统计总数', async () => {
    const h = new SamplingHandler();
    for (let i = 0; i < 3; i++) {
      await h.handle(makeTextRequest());
    }
    expect(h.getStats().total).toBe(3);
  });

  it('统计通过/拒绝', async () => {
    const h = new SamplingHandler({ approver: async (req) => req.messages.length > 0 });
    await h.handle(makeTextRequest());
    await h.handle(makeTextRequest());
    expect(h.getStats().approved).toBe(2);
    expect(h.getStats().rejected).toBe(0);
  });

  it('统计错误', async () => {
    const h = new SamplingHandler({
      executor: async () => {
        throw new Error('x');
      },
    });
    await expect(h.handle(makeTextRequest())).rejects.toThrow();
    expect(h.getStats().errors).toBe(1);
  });
});

// ============ 多模态内容测试 ============

describe('SamplingHandler - 多模态', () => {
  it('处理图像内容', async () => {
    const exec: SamplingExecutor = async () => ({
      model: 'vision',
      stopReason: 'endTurn',
      role: 'assistant',
      content: { type: 'text', text: 'I see an image' },
    });
    const h = new SamplingHandler({ executor: exec });
    const resp = await h.handle({
      messages: [
        { role: 'user', content: { type: 'image', data: 'BASE64', mimeType: 'image/png' } },
      ],
      maxTokens: 100,
    });
    if (resp.content.type === 'text') {
      expect(resp.content.text).toBe('I see an image');
    }
  });

  it('处理音频内容', async () => {
    const exec: SamplingExecutor = async () => ({
      model: 'audio',
      stopReason: 'endTurn',
      role: 'assistant',
      content: { type: 'text', text: 'I hear audio' },
    });
    const h = new SamplingHandler({ executor: exec });
    const resp = await h.handle({
      messages: [
        { role: 'user', content: { type: 'audio', data: 'BASE64', mimeType: 'audio/mp3' } },
      ],
      maxTokens: 100,
    });
    if (resp.content.type === 'text') {
      expect(resp.content.text).toBe('I hear audio');
    }
  });
});

// ============ 性能测试 ============

describe('SamplingHandler - 性能', () => {
  it('1000 次处理 < 1s（无审批）', async () => {
    const h = new SamplingHandler();
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      await h.handle(makeTextRequest());
    }
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });
});
