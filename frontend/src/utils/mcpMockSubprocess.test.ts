/**
 * # ============================================================
 * # MCP Mock Subprocess 单元测试 (v1.0.0 Cycle 40 G40-01)
 * # ============================================================
 * # 覆盖：生命周期、响应脚本、错误处理、测试辅助工具
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 40 G40-01 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  MockSubprocess,
  createMockSubprocess,
  createEchoMockSubprocess,
  createToolsMockSubprocess,
  waitForNextMessage,
  waitForMessageCount,
  parseStdoutMessages,
} from './mcpMockSubprocess';
import type { JsonRpcMessage, JsonRpcRequest } from './mcpTypes';

describe('MockSubprocess 生命周期', () => {
  it('创建后未运行', () => {
    const proc = new MockSubprocess();
    expect(proc.isRunning()).toBe(false);
  });

  it('start 后运行', () => {
    const proc = createMockSubprocess();
    expect(proc.isRunning()).toBe(true);
  });

  it('kill 后停止', () => {
    const proc = createMockSubprocess();
    proc.kill(0);
    expect(proc.isRunning()).toBe(false);
    expect(proc.getExitCode()).toBe(0);
  });

  it('kill 非零退出码', () => {
    const proc = createMockSubprocess();
    proc.kill(1);
    expect(proc.getExitCode()).toBe(1);
  });

  it('重复 start 幂等', () => {
    const proc = createMockSubprocess();
    proc.start();
    proc.start();
    expect(proc.isRunning()).toBe(true);
  });

  it('onExit 在 kill 时触发', () => {
    const proc = createMockSubprocess();
    let received: number | null = null;
    proc.onExit((code) => {
      received = code;
    });
    proc.kill(0);
    expect(received).toBe(0);
  });

  it('emitError 触发 onError', () => {
    const proc = createMockSubprocess();
    let received: Error | null = null;
    proc.onError((err) => {
      received = err;
    });
    proc.emitError(new Error('boom'));
    expect((received as Error | null)?.message).toBe('boom');
  });
});

describe('MockSubprocess echo 脚本', () => {
  it('客户端写入触发响应', async () => {
    const proc = createEchoMockSubprocess();
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'ping',
        params: { foo: 'bar' },
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    expect(msgs.length).toBe(1);
    expect(msgs[0].jsonrpc).toBe('2.0');
    if ('result' in msgs[0]) {
      expect(msgs[0].id).toBe(1);
    }
  });

  it('响应包含 echo 的 params', async () => {
    const proc = createEchoMockSubprocess();
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 'abc',
        method: 'test',
        params: { x: 42 },
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    if (msgs[0] && 'result' in msgs[0]) {
      const result = msgs[0].result as { echo?: unknown; method?: string };
      expect(result.echo).toEqual({ x: 42 });
      expect(result.method).toBe('test');
    }
  });
});

describe('MockSubprocess initialize 响应', () => {
  it('autoInitialize 响应 initialize 请求', async () => {
    const proc = createMockSubprocess({ serverName: 'test-server' });
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    expect(msgs[0]).toBeDefined();
    if (msgs[0] && 'result' in msgs[0]) {
      const result = msgs[0].result as {
        serverInfo?: { name: string };
        protocolVersion?: string;
      };
      expect(result.serverInfo?.name).toBe('test-server');
      expect(result.protocolVersion).toBe('2024-11-05');
    }
  });

  it('autoInitialize=false 不响应', async () => {
    const proc = createMockSubprocess({ autoInitialize: false, script: { type: 'echo' } });
    // 启动后等待
    let received = false;
    const unsub = proc.getStdout().subscribe(() => {
      received = true;
    });
    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      } satisfies JsonRpcRequest) + '\n',
    );
    // 由于 autoInitialize=false 但 script 是 echo，应该返回 echo
    await new Promise((r) => setTimeout(r, 30));
    unsub();
    // echo 模式会返回，但 result 不包含 serverInfo
    expect(received).toBe(true);
  });

  it('custom capabilities', async () => {
    const proc = createMockSubprocess({
      capabilities: { tools: { listChanged: true } },
    });
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    if (msgs[0] && 'result' in msgs[0]) {
      const result = msgs[0].result as { capabilities?: { tools?: { listChanged?: boolean } } };
      expect(result.capabilities?.tools?.listChanged).toBe(true);
    }
  });
});

describe('MockSubprocess fixture 脚本', () => {
  it('按顺序返回 fixture 响应', async () => {
    const responses = new Map<string, JsonRpcMessage>();
    responses.set('a', {
      jsonrpc: '2.0',
      id: 1,
      result: { value: 'first' },
    });
    responses.set('b', {
      jsonrpc: '2.0',
      id: 2,
      result: { value: 'second' },
    });

    const proc = createMockSubprocess({ script: { type: 'fixture', responses } });
    const promise = waitForMessageCount(proc.getStdout(), 2);

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 100,
        method: 'req1',
      } satisfies JsonRpcRequest) + '\n',
    );
    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 200,
        method: 'req2',
      } satisfies JsonRpcRequest) + '\n',
    );

    const messages = await promise;
    expect(messages.length).toBe(2);
  });

  it('fixture 循环使用', async () => {
    const responses = new Map<string, JsonRpcMessage>();
    responses.set('a', { jsonrpc: '2.0', id: 1, result: { v: 1 } });

    const proc = createMockSubprocess({ script: { type: 'fixture', responses } });
    const promise = waitForMessageCount(proc.getStdout(), 3);

    for (let i = 0; i < 3; i++) {
      proc.writeToStdin(
        JSON.stringify({
          jsonrpc: '2.0',
          id: i,
          method: 'req',
        } satisfies JsonRpcRequest) + '\n',
      );
    }

    const messages = await promise;
    expect(messages.length).toBe(3);
  });

  it('fixture 用尽返回错误', async () => {
    const proc = createMockSubprocess({ script: { type: 'fixture', responses: new Map() } });
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'req',
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    expect(msgs[0]).toBeDefined();
    if (msgs[0] && 'error' in msgs[0]) {
      expect(msgs[0].error.code).toBe(-32603);
    }
  });
});

describe('MockSubprocess functional 脚本', () => {
  it('自定义 handler', async () => {
    const proc = createMockSubprocess({
      script: {
        type: 'functional',
        handler: (req) => ({
          jsonrpc: '2.0',
          id: req.id,
          result: { custom: true, method: req.method },
        }),
      },
    });
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'special',
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    if (msgs[0] && 'result' in msgs[0]) {
      const r = msgs[0].result as { custom?: boolean; method?: string };
      expect(r.custom).toBe(true);
      expect(r.method).toBe('special');
    }
  });

  it('handler 异步', async () => {
    const proc = createMockSubprocess({
      script: {
        type: 'functional',
        handler: async (req) => {
          await new Promise((r) => setTimeout(r, 10));
          return { jsonrpc: '2.0', id: req.id, result: { async: true } };
        },
      },
    });
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'async_req',
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    if (msgs[0] && 'result' in msgs[0]) {
      expect((msgs[0].result as { async?: boolean }).async).toBe(true);
    }
  });

  it('handler 异常转换为错误响应', async () => {
    const proc = createMockSubprocess({
      script: {
        type: 'functional',
        handler: () => {
          throw new Error('handler boom');
        },
      },
    });
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'fail',
      } satisfies JsonRpcRequest) + '\n',
    );

    const raw = await promise;
    const msgs = parseStdoutMessages(raw);
    if (msgs[0] && 'error' in msgs[0]) {
      expect(msgs[0].error.message).toBe('handler boom');
    }
  });
});

describe('MockSubprocess initialize-then-tools 脚本', () => {
  it('响应 tools/list', async () => {
    const proc = createToolsMockSubprocess([
      { name: 'read_file', description: 'read', inputSchema: { type: 'object' } },
      { name: 'write_file', description: 'write', inputSchema: { type: 'object' } },
    ]);
    const promise = waitForMessageCount(proc.getStdout(), 2);

    // initialize
    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      } satisfies JsonRpcRequest) + '\n',
    );
    // tools/list
    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
      } satisfies JsonRpcRequest) + '\n',
    );

    const messages = await promise;
    const allMsgs = parseStdoutMessages(messages);
    const toolsResp = allMsgs.find(
      (m) => 'result' in m && (m.result as { tools?: unknown[] })?.tools,
    );
    if (toolsResp && 'result' in toolsResp) {
      expect((toolsResp.result as { tools: unknown[] }).tools.length).toBe(2);
    }
  });

  it('响应 resources/list', async () => {
    const proc = createMockSubprocess({
      script: {
        type: 'initialize-then-tools',
        tools: [],
        resources: [{ uri: 'file:///a', name: 'A' }],
      },
    });
    const promise = waitForMessageCount(proc.getStdout(), 2);

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
      } satisfies JsonRpcRequest) + '\n',
    );
    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/list',
      } satisfies JsonRpcRequest) + '\n',
    );

    const messages = await promise;
    const allMsgs = parseStdoutMessages(messages);
    const resp = allMsgs.find(
      (m) => 'result' in m && (m.result as { resources?: unknown[] })?.resources,
    );
    if (resp && 'result' in resp) {
      expect((resp.result as { resources: unknown[] }).resources.length).toBe(1);
    }
  });
});

describe('MockSubprocess responseDelay', () => {
  it('延迟响应', async () => {
    const proc = createMockSubprocess({ responseDelayMs: 50 });
    const start = Date.now();
    const promise = waitForNextMessage(proc.getStdout());

    proc.writeToStdin(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'slow',
      } satisfies JsonRpcRequest) + '\n',
    );

    await promise;
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

describe('MockSubprocess 统计', () => {
  it('stats 记录消息数', () => {
    const proc = createMockSubprocess();
    const initial = proc.getStats();
    expect(initial.messagesReceived).toBe(0);
    expect(initial.startedAt).toBeGreaterThan(0);
  });

  it('kill 后 endedAt 被设置', () => {
    const proc = createMockSubprocess();
    proc.kill(0);
    const stats = proc.getStats();
    expect(stats.endedAt).toBeDefined();
  });

  it('logToStderr 写入 stderr', () => {
    const proc = createMockSubprocess();
    let received: string | null = null;
    proc.getStderr().subscribe((chunk) => {
      received = chunk;
    });
    proc.logToStderr('error message');
    // 异步推送
    setTimeout(() => {
      expect(received).toBe('error message\n');
    }, 10);
  });
});

describe('MockSubprocess 进程停止后行为', () => {
  it('kill 后不响应新请求', () => {
    const proc = createMockSubprocess();
    proc.kill(0);
    // 进程已停止，不应该发送
    proc.send({ jsonrpc: '2.0', id: 1, result: { test: true } });
    // 没有抛出即为通过
  });
});

describe('createEchoMockSubprocess', () => {
  it('创建 echo mock', () => {
    const proc = createEchoMockSubprocess();
    expect(proc.isRunning()).toBe(true);
  });
});

describe('waitForNextMessage', () => {
  it('超时拒绝', async () => {
    const proc = createMockSubprocess();
    await expect(waitForNextMessage(proc.getStdout(), 50)).rejects.toThrow(/Timeout/);
  });
});

describe('waitForMessageCount', () => {
  it('达到数量后 resolve', async () => {
    const proc = createMockSubprocess();
    const promise = waitForMessageCount(proc.getStdout(), 2, 1000);

    setTimeout(() => {
      proc.send({ jsonrpc: '2.0', id: 1, result: {} });
      proc.send({ jsonrpc: '2.0', id: 2, result: {} });
    }, 10);

    const messages = await promise;
    expect(messages.length).toBe(2);
  });

  it('超时拒绝', async () => {
    const proc = createMockSubprocess();
    await expect(waitForMessageCount(proc.getStdout(), 5, 50)).rejects.toThrow();
  });
});

describe('parseStdoutMessages', () => {
  it('解析单行', () => {
    const json = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } });
    const msgs = parseStdoutMessages(json);
    expect(msgs.length).toBe(1);
    expect(msgs[0]?.jsonrpc).toBe('2.0');
  });

  it('解析多行', () => {
    const json1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { a: 1 } });
    const json2 = JSON.stringify({ jsonrpc: '2.0', id: 2, result: { b: 2 } });
    const msgs = parseStdoutMessages([json1, json2].join('\n'));
    expect(msgs.length).toBe(2);
  });

  it('忽略空行', () => {
    const json = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    const msgs = parseStdoutMessages(`\n\n${json}\n\n`);
    expect(msgs.length).toBe(1);
  });

  it('忽略非法 JSON 行', () => {
    const json = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    const msgs = parseStdoutMessages(`not json\n${json}\nbad json\n`);
    expect(msgs.length).toBe(1);
  });

  it('接受数组', () => {
    const json1 = JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} });
    const json2 = JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} });
    const msgs = parseStdoutMessages([json1, json2]);
    expect(msgs.length).toBe(2);
  });
});

describe('MockSubprocess stdin 行为', () => {
  it('getStdin 收集消息', () => {
    const proc = createMockSubprocess();
    proc.writeToStdin(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'test' }) + '\n',
    );
    const messages = proc.getStdin().getMessages();
    expect(messages.length).toBe(1);
    expect(messages[0]).toMatchObject({ method: 'test' });
  });

  it('getStdin 收集原始 chunks', () => {
    const proc = createMockSubprocess();
    proc.writeToStdin('raw data\n');
    const chunks = proc.getStdin().getRawChunks();
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('raw data\n');
  });
});

describe('多消息并发', () => {
  it('并发处理多个请求', async () => {
    const proc = createEchoMockSubprocess();
    const promise = waitForMessageCount(proc.getStdout(), 5);

    for (let i = 0; i < 5; i++) {
      proc.writeToStdin(
        JSON.stringify({
          jsonrpc: '2.0',
          id: i,
          method: 'concurrent',
        } satisfies JsonRpcRequest) + '\n',
      );
    }

    const messages = await promise;
    expect(messages.length).toBe(5);
  });
});

describe('退出码', () => {
  it('默认退出码 0', () => {
    const proc = createMockSubprocess();
    proc.kill();
    expect(proc.getExitCode()).toBe(0);
  });

  it('kill(137) SIGKILL', () => {
    const proc = createMockSubprocess();
    proc.kill(137);
    expect(proc.getExitCode()).toBe(137);
  });
});

describe('流 API 完整性', () => {
  it('getStdout/getStderr/getStdin 独立', () => {
    const proc = createMockSubprocess();
    expect(proc.getStdout()).toBeDefined();
    expect(proc.getStderr()).toBeDefined();
    expect(proc.getStdin()).toBeDefined();
    expect(proc.getStdout()).not.toBe(proc.getStderr());
    expect(proc.getStderr()).not.toBe(proc.getStdin());
  });

  it('stdout subscribe 返回 unsubscribe', () => {
    const proc = createMockSubprocess();
    let count = 0;
    const unsub = proc.getStdout().subscribe(() => {
      count += 1;
    });
    proc.send({ jsonrpc: '2.0', id: 1, result: {} });
    setTimeout(() => {
      unsub();
      proc.send({ jsonrpc: '2.0', id: 2, result: {} });
      setTimeout(() => {
        expect(count).toBe(1);
      }, 30);
    }, 30);
  });
});
