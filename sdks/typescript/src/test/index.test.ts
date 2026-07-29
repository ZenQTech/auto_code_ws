/**
 * Hermes TypeScript SDK - 单元测试
 * =================================
 *
 * 核心作用：测试 Hermes TypeScript SDK 的核心功能
 * 覆盖：配置、客户端、Thread、Run、Stream、异常、URL构建
 * Cycle 13 P0-2 新建
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  Hermes,
  HermesClient,
  HermesError,
  HermesApiError,
  HermesAuthError,
  HermesNotFoundError,
  HermesTimeoutError,
  Sandbox,
  Thread,
  parseRunResult,
  parseStreamResult,
} from "../index.js";

const ok: (value: unknown, message?: string) => asserts value = assert.ok;
const equal: (actual: unknown, expected: unknown, message?: string) => void = assert.equal;
const deepEqual: (actual: unknown, expected: unknown, message?: string) => void = assert.deepEqual;
const notEqual: (actual: unknown, expected: unknown, message?: string) => void = assert.notEqual;
const fail: (message?: string) => never = assert.fail;

// ============================================================
// 测试：配置
// ============================================================
describe("HermesConfig", () => {
  test("默认配置", () => {
    const client = new HermesClient();
    equal(client.config.baseUrl, "http://localhost:8000");
    equal(client.config.timeoutMs, 60_000);
    equal(client.config.maxRetries, 2);
    equal(client.config.defaultModel, "claude-sonnet-4.5");
    equal(client.config.defaultSandbox, "workspace_write");
  });

  test("自定义配置", () => {
    const client = new HermesClient({
      apiKey: "test-key",
      baseUrl: "http://example.com:9000",
      timeoutMs: 30_000,
      maxRetries: 5,
      backoffFactor: 0.3,
      defaultModel: "claude-opus",
      defaultSandbox: "read_only",
      projectId: "proj-1",
      extraHeaders: { "X-Trace": "1" },
    });
    equal(client.config.apiKey, "test-key");
    equal(client.config.baseUrl, "http://example.com:9000");
    equal(client.config.timeoutMs, 30_000);
    equal(client.config.maxRetries, 5);
    equal(client.config.backoffFactor, 0.3);
    equal(client.config.defaultModel, "claude-opus");
    equal(client.config.defaultSandbox, "read_only");
    equal(client.config.projectId, "proj-1");
    deepEqual(client.config.extraHeaders, { "X-Trace": "1" });
  });
});

// ============================================================
// 测试：Sandbox
// ============================================================
describe("Sandbox", () => {
  test("Sandbox 值正确", () => {
    equal(Sandbox.READ_ONLY, "read_only");
    equal(Sandbox.WORKSPACE_WRITE, "workspace_write");
    equal(Sandbox.FULL_ACCESS, "full_access");
  });
});

// ============================================================
// 测试：异常
// ============================================================
describe("Exceptions", () => {
  test("HermesError 基础类", () => {
    const e: HermesError = new HermesError("base error");
    ok(e instanceof Error);
    ok(e instanceof HermesError);
    equal(e.message, "base error");
    deepEqual(e.payload, {});
  });

  test("HermesApiError 包含 statusCode", () => {
    const e: HermesApiError = new HermesApiError("api error", 400);
    ok(e instanceof HermesError);
    ok(e instanceof HermesApiError);
    equal(e.statusCode, 400);
  });

  test("HermesAuthError", () => {
    const e: HermesAuthError = new HermesAuthError("auth error");
    ok(e instanceof HermesApiError);
    equal(e.statusCode, 401);
  });

  test("HermesNotFoundError", () => {
    const e: HermesNotFoundError = new HermesNotFoundError("not found");
    ok(e instanceof HermesApiError);
    equal(e.statusCode, 404);
  });

  test("HermesTimeoutError", () => {
    const e: HermesTimeoutError = new HermesTimeoutError("timeout");
    ok(e instanceof HermesError);
    ok(e instanceof HermesTimeoutError);
    equal(e.message, "timeout");
  });
});

// ============================================================
// 测试：URL 构建
// ============================================================
describe("URL Construction", () => {
  test("基本 URL 构建（无参数）", () => {
    const client = new HermesClient({ baseUrl: "http://api.example.com" });
    const url = client.http.buildUrl("/api/sdk/threads");
    equal(url, "http://api.example.com/api/sdk/threads");
  });

  test("URL 去除尾部斜杠", () => {
    const client = new HermesClient({ baseUrl: "http://api.example.com/" });
    const url = client.http.buildUrl("/threads");
    equal(url, "http://api.example.com/threads");
  });

  test("URL 添加自动前导斜杠", () => {
    const client = new HermesClient({ baseUrl: "http://api.example.com" });
    const url = client.http.buildUrl("threads");
    equal(url, "http://api.example.com/threads");
  });

  test("URL 过滤空值参数", () => {
    const client = new HermesClient({ baseUrl: "http://api.example.com" });
    const url = client.http.buildUrl("/list", { a: "1", b: undefined, c: "" });
    equal(url, "http://api.example.com/list?a=1");
  });

  test("URL 添加参数", () => {
    const client = new HermesClient({ baseUrl: "http://api.example.com" });
    const url = client.http.buildUrl("/list", { a: "1", b: "2" });
    equal(url, "http://api.example.com/list?a=1&b=2");
  });
});

// ============================================================
// 测试：parseRunResult
// ============================================================
describe("parseRunResult", () => {
  test("解析完整 run 数据", () => {
    const data = {
      thread_id: "th_1",
      run_id: "run_1",
      status: "completed",
      final_response: "Hello",
      text: "Hello",
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      collected_items: [{ type: "text" }],
      metadata: { foo: "bar" },
    };
    const result = parseRunResult(data);
    equal(result.threadId, "th_1");
    equal(result.runId, "run_1");
    equal(result.status, "completed");
    equal(result.finalResponse, "Hello");
    equal(result.usage.promptTokens, 10);
    equal(result.usage.completionTokens, 5);
    equal(result.usage.totalTokens, 15);
    equal(result.collectedItems.length, 1);
    equal(result.metadata.foo, "bar");
  });

  test("解析缺失字段", () => {
    const result = parseRunResult({});
    equal(result.threadId, "");
    equal(result.runId, "");
    equal(result.status, "completed");
    equal(result.finalResponse, "");
    equal(result.usage.promptTokens, 0);
    equal(result.usage.completionTokens, 0);
    equal(result.usage.totalTokens, 0);
  });

  test("优先 final_response，再 text", () => {
    const result = parseRunResult({ final_response: "A", text: "B" });
    equal(result.finalResponse, "A");
  });

  test("只提供 text", () => {
    const result = parseRunResult({ text: "B" });
    equal(result.finalResponse, "B");
  });
});

// ============================================================
// 测试：parseStreamResult
// ============================================================
describe("parseStreamResult", () => {
  test("解析 stream 响应", () => {
    const data = {
      events: [
        { type: "run_started", run_id: "run_1", thread_id: "th_1" },
        { type: "text_delta", text: "Hello", delta: "Hello", run_id: "run_1" },
        { type: "text_delta", text: " world", delta: " world", run_id: "run_1" },
        { type: "run_completed", run_id: "run_1" },
      ],
      final: {
        thread_id: "th_1",
        run_id: "run_1",
        status: "completed",
        final_response: "Hello world",
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
      },
    };
    const result = parseStreamResult(data);
    equal(result.events.length, 4);
    equal(result.events[0].type, "run_started");
    equal(result.events[1].text, "Hello");
    equal(result.events[2].text, " world");
    equal(result.final.finalResponse, "Hello world");
    equal(result.final.usage.totalTokens, 8);
  });

  test("空事件流", () => {
    const result = parseStreamResult({ events: [], final: {} });
    equal(result.events.length, 0);
    equal(result.final.finalResponse, "");
  });
});

// ============================================================
// 测试：HermesClient 别名
// ============================================================
describe("Hermes alias", () => {
  test("Hermes 是 HermesClient 的别名", () => {
    equal(Hermes, HermesClient);
  });
});

// ============================================================
// 测试：HttpClient 错误映射（通过 fetch mock）
// ============================================================
describe("HttpClient error mapping", () => {
  test("400 映射为 HermesApiError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ detail: "Bad Request" }), {
        status: 400,
        statusText: "Bad Request",
      });
    }) as unknown as typeof fetch;
    try {
      const client = new HermesClient({ baseUrl: "http://api.test", maxRetries: 0 });
      try {
        await client.http.request("/api/sdk/test");
        fail("should have thrown");
      } catch (e) {
        ok(e instanceof HermesApiError);
        equal((e as HermesApiError).statusCode, 400);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("401 映射为 HermesAuthError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ detail: "Unauthorized" }), {
        status: 401,
        statusText: "Unauthorized",
      });
    }) as unknown as typeof fetch;
    try {
      const client = new HermesClient({ baseUrl: "http://api.test", maxRetries: 0 });
      try {
        await client.http.request("/api/sdk/test");
        fail("should have thrown");
      } catch (e) {
        ok(e instanceof HermesAuthError);
        equal((e as HermesAuthError).statusCode, 401);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("404 映射为 HermesNotFoundError", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ detail: "Not Found" }), {
        status: 404,
        statusText: "Not Found",
      });
    }) as unknown as typeof fetch;
    try {
      const client = new HermesClient({ baseUrl: "http://api.test", maxRetries: 0 });
      try {
        await client.http.request("/api/sdk/test");
        fail("should have thrown");
      } catch (e) {
        ok(e instanceof HermesNotFoundError);
        equal((e as HermesNotFoundError).statusCode, 404);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ============================================================
// 测试：Thread 构造
// ============================================================
describe("Thread", () => {
  test("构造 Thread", () => {
    const client = new HermesClient({ baseUrl: "http://api.test" });
    const thread = new Thread(
      client as unknown as HermesClient,
      "th_1",
      {
        sandbox: "workspace_write",
        model: "claude-sonnet-4.5",
        projectId: "proj-1",
        workingDirectory: "/tmp/proj",
        systemPrompt: "You are a helpful assistant.",
      }
    );
    equal(thread.id, "th_1");
    equal(thread.config.sandbox, "workspace_write");
    equal(thread.config.model, "claude-sonnet-4.5");
    equal(thread.config.projectId, "proj-1");
    equal(thread.config.workingDirectory, "/tmp/proj");
    equal(thread.config.systemPrompt, "You are a helpful assistant.");
  });
});
