/**
 * # ============================================================
 * # SessionReplayEngine 单元测试 (Cycle 23 G23-02)
 * # ============================================================
 * # 测试覆盖：
 * #   1. 录制 (startRecording / addFrame / stopRecording)
 * #   2. 取消录制 (cancelRecording)
 * #   3. 回放管理 (createReplay / loadReplay / listReplays / deleteReplay)
 * #   4. 播放控制 (play / pause / stop / seekTo / next / prev)
 * #   5. 播放速度 (setSpeed)
 * #   6. 帧查询 (getCurrentFrame)
 * #   7. 状态 (getState)
 * #   8. 导出 (exportReplay - json/html/markdown)
 * #   9. 分享 (createShareLink / getReplayByShare)
 * #  10. 事件订阅 (on)
 * #  11. 单例管理
 * # ============================================================
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  SessionReplayEngine,
  getSessionReplayEngine,
  resetSessionReplayEngine,
} from './sessionReplay';
import type {
  MessageFrameData,
  ToolCallFrameData,
  ThinkingFrameData,
  ReplaySession,
} from './sessionReplay';

beforeEach(() => {
  resetSessionReplayEngine();
});

afterEach(() => {
  resetSessionReplayEngine();
});

describe('SessionReplayEngine - 录制', () => {
  it('startRecording 后 isRecording 应返回 true', () => {
    const engine = new SessionReplayEngine();
    expect(engine.isRecording()).toBe(false);
    engine.startRecording('session-1', 'Test');
    expect(engine.isRecording()).toBe(true);
  });

  it('应能使用默认标题', () => {
    const engine = new SessionReplayEngine();
    engine.startRecording('session-long-id');
    engine.addFrame('message', { role: 'user', content: 'hi' } as MessageFrameData);
    const replay = engine.stopRecording();
    expect(replay?.title).toContain('Session');
  });

  it('addFrame 应返回带 frameId 的帧对象', () => {
    const engine = new SessionReplayEngine();
    engine.startRecording('session-1');
    const frame = engine.addFrame('message', { role: 'user', content: 'hi' } as MessageFrameData);
    expect(frame).not.toBeNull();
    expect(frame?.frameId).toBeDefined();
    expect(frame?.type).toBe('message');
  });

  it('未启动录制时 addFrame 应返回 null', () => {
    const engine = new SessionReplayEngine();
    const frame = engine.addFrame('message', { role: 'user', content: 'hi' } as MessageFrameData);
    expect(frame).toBeNull();
  });

  it('stopRecording 应生成回放并保存到存储', () => {
    const engine = new SessionReplayEngine();
    engine.startRecording('session-1', 'Test');
    engine.addFrame('message', { role: 'user', content: 'hi' } as MessageFrameData);
    engine.addFrame('message', { role: 'assistant', content: 'hello' } as MessageFrameData);
    const replay = engine.stopRecording();
    expect(replay).not.toBeNull();
    expect(replay?.frames.length).toBe(2);
    expect(replay?.sessionId).toBe('session-1');
    expect(engine.isRecording()).toBe(false);
    // 应能列出
    const listed = engine.listReplays();
    expect(listed.length).toBe(1);
  });

  it('未启动录制时 stopRecording 应返回 null', () => {
    const engine = new SessionReplayEngine();
    expect(engine.stopRecording()).toBeNull();
  });

  it('cancelRecording 应清除当前录制状态', () => {
    const engine = new SessionReplayEngine();
    engine.startRecording('session-1');
    engine.addFrame('message', { role: 'user', content: 'hi' } as MessageFrameData);
    engine.cancelRecording();
    expect(engine.isRecording()).toBe(false);
    expect(engine.stopRecording()).toBeNull();
  });
});

describe('SessionReplayEngine - 回放管理', () => {
  it('createReplay 应直接从会话数据创建', () => {
    const engine = new SessionReplayEngine();
    const sessionData = {
      sessionId: 'sess-1',
      title: 'Test Session',
      startedAt: Date.now() - 10000,
      endedAt: Date.now(),
      frames: [
        {
          frameId: 'f1',
          type: 'message' as const,
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user' as const, content: 'hi' },
        },
      ],
    };
    const replay = engine.createReplay(sessionData);
    expect(replay.replayId).toBeDefined();
    expect(replay.sessionId).toBe('sess-1');
    expect(replay.frames.length).toBe(1);
    expect(replay.metadata.totalMessages).toBe(1);
  });

  it('loadReplay 应加载并设为当前回放', () => {
    const engine = new SessionReplayEngine();
    const sessionData = {
      sessionId: 'sess-1',
      title: 'Test',
      startedAt: 0,
      endedAt: 0,
      frames: [
        {
          frameId: 'f1',
          type: 'message' as const,
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user' as const, content: 'hi' },
        },
      ],
    };
    const replay = engine.createReplay(sessionData);
    const loaded = engine.loadReplay(replay.replayId);
    expect(loaded).not.toBeNull();
    expect(engine.getCurrentReplay()?.replayId).toBe(replay.replayId);
    expect(engine.getState().currentReplayId).toBe(replay.replayId);
  });

  it('加载不存在的 replayId 应返回 null', () => {
    const engine = new SessionReplayEngine();
    expect(engine.loadReplay('non-existent')).toBeNull();
  });

  it('deleteReplay 应从存储中删除', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [],
    });
    expect(engine.listReplays().length).toBe(1);
    engine.deleteReplay(replay.replayId);
    expect(engine.listReplays().length).toBe(0);
  });

  it('deleteReplay 当前回放应停止播放并清理', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [
        {
          frameId: 'f1',
          type: 'message' as const,
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user' as const, content: 'hi' },
        },
      ],
    });
    engine.loadReplay(replay.replayId);
    engine.deleteReplay(replay.replayId);
    expect(engine.getCurrentReplay()).toBeNull();
    expect(engine.getState().currentReplayId).toBeNull();
  });
});

describe('SessionReplayEngine - 播放控制', () => {
  const buildReplay = (engine: SessionReplayEngine): ReplaySession => {
    return engine.createReplay({
      sessionId: 's1',
      frames: [
        {
          frameId: 'f1',
          type: 'message' as const,
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user' as const, content: 'hi' },
        },
        {
          frameId: 'f2',
          type: 'message' as const,
          timestamp: 1000,
          durationMs: 0,
          data: { role: 'assistant' as const, content: 'hello' },
        },
        {
          frameId: 'f3',
          type: 'message' as const,
          timestamp: 2000,
          durationMs: 0,
          data: { role: 'user' as const, content: 'how are you' },
        },
      ],
    });
  };

  it('play 应设置 isPlaying 为 true', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.play();
    expect(engine.getState().isPlaying).toBe(true);
    engine.pause();
  });

  it('空回放 play 不应改变状态', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({ sessionId: 's1', frames: [] });
    engine.loadReplay(replay.replayId);
    engine.play();
    expect(engine.getState().isPlaying).toBe(false);
  });

  it('pause 应设置 isPlaying 为 false', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.play();
    engine.pause();
    expect(engine.getState().isPlaying).toBe(false);
  });

  it('stop 应重置到开头', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.seekTo(2);
    engine.stop();
    expect(engine.getState().currentFrameIndex).toBe(0);
    expect(engine.getState().currentTime).toBe(0);
  });

  it('seekTo 应跳转到指定帧', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    const frame = engine.seekTo(1);
    expect(frame?.frameId).toBe('f2');
    expect(engine.getState().currentFrameIndex).toBe(1);
  });

  it('seekTo 越界应被裁剪', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.seekTo(100);
    expect(engine.getState().currentFrameIndex).toBe(2);
    engine.seekTo(-1);
    expect(engine.getState().currentFrameIndex).toBe(0);
  });

  it('next 应前进到下一帧', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.next();
    expect(engine.getState().currentFrameIndex).toBe(1);
  });

  it('next 在末尾应触发 ended 事件', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.seekTo(2);
    const handler = vi.fn();
    engine.on('ended', handler);
    engine.next();
    expect(handler).toHaveBeenCalled();
  });

  it('prev 应回退到上一帧', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.seekTo(2);
    engine.prev();
    expect(engine.getState().currentFrameIndex).toBe(1);
  });

  it('getCurrentFrame 应返回当前帧', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    engine.loadReplay(replay.replayId);
    engine.seekTo(1);
    expect(engine.getCurrentFrame()?.frameId).toBe('f2');
  });
});

describe('SessionReplayEngine - 播放速度', () => {
  it('setSpeed 应限制在 [0.25, 8] 范围内', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [
        {
          frameId: 'f1',
          type: 'message' as const,
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user' as const, content: 'hi' },
        },
      ],
    });
    engine.loadReplay(replay.replayId);
    engine.setSpeed(100);
    expect(engine.getState().playbackSpeed).toBe(8);
    engine.setSpeed(0.01);
    expect(engine.getState().playbackSpeed).toBe(0.25);
    engine.setSpeed(2);
    expect(engine.getState().playbackSpeed).toBe(2);
  });
});

describe('SessionReplayEngine - 导出', () => {
  const buildReplay = (engine: SessionReplayEngine): ReplaySession => {
    return engine.createReplay({
      sessionId: 's1',
      frames: [
        {
          frameId: 'f1',
          type: 'message' as const,
          timestamp: 0,
          durationMs: 0,
          data: { role: 'user' as const, content: 'hello world' },
          highlight: 'user-action' as const,
          description: 'User greeting',
        },
        {
          frameId: 'f2',
          type: 'thinking' as const,
          timestamp: 1000,
          durationMs: 500,
          data: { content: 'thinking...', model: 'claude' } as ThinkingFrameData,
        },
        {
          frameId: 'f3',
          type: 'tool-call' as const,
          timestamp: 2000,
          durationMs: 100,
          data: { toolName: 'read', args: { path: 'a.txt' } } as unknown as ToolCallFrameData,
        },
      ],
    });
  };

  it('exportReplay JSON 格式应正确', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    const json = engine.exportReplay(replay.replayId, 'json');
    const parsed = JSON.parse(json);
    expect(parsed.replayId).toBe(replay.replayId);
    expect(parsed.frames.length).toBe(3);
  });

  it('exportReplay JSON 格式可排除元数据', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    const json = engine.exportReplay(replay.replayId, 'json', { includeMetadata: false });
    const parsed = JSON.parse(json);
    expect(parsed.metadata).toBeUndefined();
  });

  it('exportReplay HTML 格式应包含样式和元数据', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    const html = engine.exportReplay(replay.replayId, 'html');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('hello world');
    expect(html).toContain('thinking...');
  });

  it('exportReplay Markdown 格式应包含帧内容', () => {
    const engine = new SessionReplayEngine();
    const replay = buildReplay(engine);
    const md = engine.exportReplay(replay.replayId, 'markdown');
    expect(md).toContain('#');
    expect(md).toContain('hello world');
    expect(md).toContain('thinking...');
  });

  it('exportReplay 不存在的 ID 应抛出错误', () => {
    const engine = new SessionReplayEngine();
    expect(() => engine.exportReplay('non-existent', 'json')).toThrow();
  });
});

describe('SessionReplayEngine - 分享', () => {
  it('createShareLink 应生成 URL', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [],
    });
    const share = engine.createShareLink(replay.replayId);
    expect(share.shareId).toBeDefined();
    expect(share.url).toContain('http');
    expect(share.expiresAt).toBeGreaterThan(Date.now());
    expect(share.readonly).toBe(true);
  });

  it('createShareLink 应支持自定义配置', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [],
    });
    const share = engine.createShareLink(replay.replayId, {
      baseUrl: 'https://custom.example.com',
      expiresInDays: 1,
      readonly: false,
    });
    expect(share.url).toContain('custom.example.com');
    expect(share.readonly).toBe(false);
  });

  it('getReplayByShare 应能获取回放', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [],
    });
    const share = engine.createShareLink(replay.replayId);
    const found = engine.getReplayByShare(share.shareId);
    expect(found?.replayId).toBe(replay.replayId);
  });

  it('getReplayByShare 过期分享应返回 null', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({
      sessionId: 's1',
      frames: [],
    });
    const share = engine.createShareLink(replay.replayId, { expiresInDays: -1 });
    expect(engine.getReplayByShare(share.shareId)).toBeNull();
  });

  it('createShareLink 不存在的 ID 应抛出错误', () => {
    const engine = new SessionReplayEngine();
    expect(() => engine.createShareLink('non-existent')).toThrow();
  });

  it('setShareConfig 应更新默认配置', () => {
    const engine = new SessionReplayEngine();
    engine.setShareConfig({ baseUrl: 'https://new.example.com' });
    const replay = engine.createReplay({ sessionId: 's1', frames: [] });
    const share = engine.createShareLink(replay.replayId);
    expect(share.url).toContain('new.example.com');
  });
});

describe('SessionReplayEngine - 事件订阅', () => {
  it('on() 应返回取消订阅函数', () => {
    const engine = new SessionReplayEngine();
    const handler = vi.fn();
    const unsub = engine.on('replay-created', handler);
    expect(typeof unsub).toBe('function');
    unsub();
    engine.createReplay({ sessionId: 's1', frames: [] });
    expect(handler).not.toHaveBeenCalled();
  });

  it('应触发 frame-added 事件', () => {
    const engine = new SessionReplayEngine();
    engine.startRecording('s1');
    const handler = vi.fn();
    engine.on('frame-added', handler);
    engine.addFrame('message', { role: 'user', content: 'hi' } as MessageFrameData);
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 replay-created 事件（createReplay 路径）', () => {
    const engine = new SessionReplayEngine();
    const handler = vi.fn();
    engine.on('replay-created', handler);
    engine.createReplay({ sessionId: 's1', frames: [] });
    expect(handler).toHaveBeenCalled();
  });

  it('应触发 export 事件', () => {
    const engine = new SessionReplayEngine();
    const replay = engine.createReplay({ sessionId: 's1', frames: [] });
    const handler = vi.fn();
    engine.on('exported', handler);
    engine.exportReplay(replay.replayId, 'json');
    expect(handler).toHaveBeenCalled();
  });
});

describe('SessionReplayEngine - 单例', () => {
  it('getSessionReplayEngine 应返回同一实例', () => {
    const a = getSessionReplayEngine();
    const b = getSessionReplayEngine();
    expect(a).toBe(b);
  });

  it('resetSessionReplayEngine 应清空单例', () => {
    const a = getSessionReplayEngine();
    resetSessionReplayEngine();
    const b = getSessionReplayEngine();
    expect(a).not.toBe(b);
  });
});
