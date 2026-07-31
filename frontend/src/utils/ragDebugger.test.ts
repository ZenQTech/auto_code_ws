/**
 * # RAGDebugger 单元测试 (v1.0.0 Cycle 46 G46-03)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RAGDebugger, type RAGSession, type TraceEvent } from './ragDebugger';

describe('RAGDebugger', () => {
  let debugger_: RAGDebugger;

  beforeEach(() => {
    debugger_ = new RAGDebugger();
  });

  describe('Session 管理', () => {
    it('应该创建 Session', () => {
      const session = debugger_.startSession('test query');
      expect(session.id).toBeDefined();
      expect(session.query).toBe('test query');
      expect(session.status).toBe('running');
      expect(session.events.length).toBe(1); // 自动 query-input 事件
    });

    it('应该结束 Session', () => {
      const session = debugger_.startSession('test');
      const ended = debugger_.endSession(session.id, 'answer', { input: 10, output: 20, total: 30 });
      expect(ended?.status).toBe('completed');
      expect(ended?.finalAnswer).toBe('answer');
      expect(ended?.tokens?.total).toBe(30);
    });

    it('应该支持失败 Session', () => {
      const session = debugger_.startSession('test');
      const failed = debugger_.failSession(new Error('Test error'), session.id);
      expect(failed?.status).toBe('failed');
    });

    it('应该自动记录 query-input 事件', () => {
      const session = debugger_.startSession('my query', { foo: 'bar' });
      const event = session.events[0];
      expect(event.stage).toBe('query-input');
      expect(event.name).toBe('User Query');
      expect((event.input as any).query).toBe('my query');
    });
  });

  describe('事件记录', () => {
    it('应该添加 trace 事件', () => {
      const session = debugger_.startSession('test');
      const event = debugger_.addEvent({
        stage: 'retrieval',
        name: 'Vector Search',
        input: { query: 'test' },
        output: { hits: [] },
      });
      expect(event.id).toBeDefined();
      expect(event.sessionId).toBe(session.id);
    });

    it('应该支持 trace 包装器（自动计算耗时）', async () => {
      debugger_.startSession('test');
      const result = await debugger_.trace('retrieval', 'Vector Search', async () => {
        await new Promise((r) => setTimeout(r, 10));
        return { hits: ['a', 'b'] };
      });
      expect(result.hits.length).toBe(2);
      const session = debugger_.getCurrentSession();
      const lastEvent = session?.events[session.events.length - 1];
      expect(lastEvent?.durationMs).toBeGreaterThanOrEqual(10);
    });

    it('应该捕获 trace 中的错误', async () => {
      debugger_.startSession('test');
      await expect(
        debugger_.trace('llm-call', 'Call', () => {
          throw new Error('Test failure');
        })
      ).rejects.toThrow('Test failure');
      const session = debugger_.getCurrentSession();
      const lastEvent = session?.events[session.events.length - 1];
      expect(lastEvent?.error?.message).toBe('Test failure');
    });

    it('应该支持嵌套 trace（parentId）', () => {
      debugger_.startSession('test');
      const parent = debugger_.addEvent({ stage: 'retrieval', name: 'Parent' });
      const child = debugger_.addEvent({ stage: 'retrieval', name: 'Child', parentId: parent.id });
      expect(child.parentId).toBe(parent.id);
    });

    it('应该支持 tags', () => {
      debugger_.startSession('test');
      const event = debugger_.addEvent({ stage: 'retrieval', name: 'Tagged', tags: ['important'] });
      expect(event.tags).toContain('important');
    });
  });

  describe('查询 / 检索', () => {
    it('应该获取所有 Session', () => {
      debugger_.startSession('q1');
      debugger_.endSession();
      debugger_.startSession('q2');
      debugger_.endSession();
      const sessions = debugger_.getAllSessions();
      expect(sessions.length).toBe(2);
    });

    it('应该获取最近 N 个 Session', () => {
      for (let i = 0; i < 5; i++) {
        const s = debugger_.startSession(`q${i}`);
        debugger_.endSession(s.id);
      }
      const recent = debugger_.getRecentSessions(3);
      expect(recent.length).toBe(3);
    });

    it('应该按 stage 过滤事件', () => {
      debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1' });
      debugger_.addEvent({ stage: 'llm-call', name: 'L1' });
      debugger_.addEvent({ stage: 'retrieval', name: 'R2' });
      const session = debugger_.getCurrentSession()!;
      const retrievalEvents = debugger_.getSessionEvents(session.id, 'retrieval');
      expect(retrievalEvents.length).toBe(2);
    });

    it('应该处理 Session 不存在的情况', () => {
      const s = debugger_.getSession('non-existent');
      expect(s).toBeUndefined();
      const events = debugger_.getSessionEvents('non-existent');
      expect(events.length).toBe(0);
    });
  });

  describe('分析', () => {
    it('应该分析各阶段耗时', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1', durationMs: 100 });
      debugger_.addEvent({ stage: 'llm-call', name: 'L1', durationMs: 500 });
      debugger_.addEvent({ stage: 'retrieval', name: 'R2', durationMs: 200 });
      debugger_.endSession(session.id);
      const analysis = debugger_.analyzeStages(session.id);
      expect(analysis.length).toBe(2);
      const retrieval = analysis.find((a) => a.stage === 'retrieval')!;
      expect(retrieval.eventCount).toBe(2);
      expect(retrieval.totalDurationMs).toBe(300);
      expect(retrieval.avgDurationMs).toBe(150);
    });

    it('应该识别瓶颈', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1', durationMs: 100 });
      debugger_.addEvent({ stage: 'llm-call', name: 'L1', durationMs: 5000 });
      debugger_.addEvent({ stage: 'citation-extract', name: 'C1', durationMs: 50 });
      debugger_.endSession(session.id);
      const bottleneck = debugger_.identifyBottleneck(session.id);
      expect(bottleneck?.stage).toBe('llm-call');
    });

    it('应该处理无事件的 Session', () => {
      const analysis = debugger_.analyzeStages('non-existent');
      expect(analysis.length).toBe(0);
      const bottleneck = debugger_.identifyBottleneck('non-existent');
      expect(bottleneck).toBeUndefined();
    });
  });

  describe('回放', () => {
    it('应该开始回放', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1' });
      const control = debugger_.startReplay(session.id, 2.0);
      expect(control.speed).toBe(2.0);
      expect(control.paused).toBe(false);
    });

    it('应该推进回放（按事件）', async () => {
      const session = debugger_.startSession('test');
      await new Promise((r) => setTimeout(r, 5));
      debugger_.addEvent({ stage: 'retrieval', name: 'R1' });
      await new Promise((r) => setTimeout(r, 5));
      debugger_.addEvent({ stage: 'llm-call', name: 'L1' });
      debugger_.startReplay(session.id);
      const control1 = debugger_.advanceReplay(session.id);
      expect(control1?.currentEventIndex).toBe(1);
      const control2 = debugger_.advanceReplay(session.id);
      expect(control2?.currentEventIndex).toBe(2);
    });

    it('应该推进回放（按毫秒）', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1', durationMs: 100 });
      debugger_.addEvent({ stage: 'llm-call', name: 'L1', durationMs: 200 });
      debugger_.startReplay(session.id, 1.0);
      const control = debugger_.advanceReplay(session.id, 150);
      expect(control?.currentTimeMs).toBe(150);
    });

    it('应该暂停和继续', () => {
      const session = debugger_.startSession('test');
      debugger_.startReplay(session.id);
      debugger_.pauseReplay(session.id);
      const control = debugger_.getReplayControl(session.id);
      expect(control?.paused).toBe(true);
      debugger_.resumeReplay(session.id);
      expect(control?.paused).toBe(false);
    });

    it('应该获取当前可见事件', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1' });
      debugger_.addEvent({ stage: 'llm-call', name: 'L1' });
      debugger_.addEvent({ stage: 'retrieval', name: 'R2' });
      debugger_.startReplay(session.id);
      debugger_.advanceReplay(session.id); // 推进 1 个事件
      const visible = debugger_.getVisibleEvents(session.id);
      expect(visible.length).toBe(2);
    });
  });

  describe('导出', () => {
    it('应该导出 JSON', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1', durationMs: 100 });
      debugger_.endSession(session.id, 'answer');
      const json = debugger_.exportSession(session.id);
      const parsed = JSON.parse(json);
      expect(parsed.session.id).toBe(session.id);
    });

    it('应该导出 Markdown', () => {
      const session = debugger_.startSession('test query');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1', durationMs: 100 });
      debugger_.endSession(session.id, 'answer');
      const md = debugger_.exportSessionAsMarkdown(session.id);
      expect(md).toContain('# RAG Session');
      expect(md).toContain('test query');
      expect(md).toContain('Stage Analysis');
    });

    it('应该导出 Mermaid', () => {
      const session = debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1', durationMs: 100 });
      debugger_.endSession(session.id, 'answer');
      const mermaid = debugger_.exportSessionAsMermaid(session.id);
      expect(mermaid).toContain('```mermaid');
      expect(mermaid).toContain('sequenceDiagram');
    });
  });

  describe('事件订阅', () => {
    it('应该发出 session-started 事件', () => {
      let received: RAGSession | undefined;
      debugger_.on('session-started', (data) => { received = data as RAGSession; });
      debugger_.startSession('test');
      expect(received).toBeDefined();
    });

    it('应该发出 event-added 事件', () => {
      let receivedEvent: TraceEvent | undefined;
      debugger_.on('event-added', (data) => { receivedEvent = data as TraceEvent; });
      debugger_.startSession('test');
      debugger_.addEvent({ stage: 'retrieval', name: 'R1' });
      expect(receivedEvent).toBeDefined();
    });

    it('应该支持退订', () => {
      const unsub = debugger_.on('session-started', () => {});
      expect(typeof unsub).toBe('function');
      unsub();
    });

    it('应该在清空时发出 cleared 事件', () => {
      let cleared = false;
      debugger_.on('cleared', () => { cleared = true; });
      debugger_.clearAll();
      expect(cleared).toBe(true);
    });
  });

  describe('清理', () => {
    it('应该清空所有 Session', () => {
      debugger_.startSession('q1');
      debugger_.startSession('q2');
      debugger_.clearAll();
      expect(debugger_.getAllSessions().length).toBe(0);
    });
  });

  describe('边界', () => {
    it('应该处理 maxSessions 限制', () => {
      const dbg = new RAGDebugger(3);
      for (let i = 0; i < 5; i++) {
        const s = dbg.startSession(`q${i}`);
        dbg.endSession(s.id);
      }
      expect(dbg.getAllSessions().length).toBe(3);
    });

    it('应该处理无活动 Session 的 addEvent', () => {
      expect(() => {
        debugger_.addEvent({ stage: 'retrieval', name: 'R1' });
      }).toThrow();
    });
  });
});
