/**
 * # ============================================================
 * # MCP Errors 单元测试 (v1.0.0 Cycle 39 G39-01)
 * # ============================================================
 * # 覆盖：错误类型 + 错误码映射 + JSON 序列化
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  McpError,
  McpParseError,
  McpInvalidRequestError,
  McpMethodNotFoundError,
  McpInvalidParamsError,
  McpInternalError,
  McpConnectionError,
  McpTimeoutError,
  McpServerError,
  McpNotConnectedError,
  McpClosedError,
  createMcpErrorFromCode,
} from './mcpErrors';
import {
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_INVALID_REQUEST,
  JSON_RPC_METHOD_NOT_FOUND,
  JSON_RPC_INVALID_PARAMS,
  JSON_RPC_INTERNAL_ERROR,
  JSON_RPC_SERVER_ERROR_END,
} from './mcpTypes';

describe('MCP 错误类', () => {
  describe('McpError 基类', () => {
    it('包含 code 和 message', () => {
      const err = new McpError('test', -1);
      expect(err.message).toBe('test');
      expect(err.code).toBe(-1);
      expect(err.name).toBe('McpError');
    });

    it('包含 data', () => {
      const err = new McpError('test', -1, { foo: 'bar' });
      expect(err.data).toEqual({ foo: 'bar' });
    });

    it('转换为 JSON-RPC 错误对象', () => {
      const err = new McpError('test', -1, { x: 1 });
      const jsonRpc = err.toJsonRpcError();
      expect(jsonRpc.code).toBe(-1);
      expect(jsonRpc.message).toBe('test');
      expect(jsonRpc.data).toEqual({ x: 1 });
    });

    it('isConnectionError 正确', () => {
      const connErr = new McpConnectionError('x');
      const otherErr = new McpError('x', -1);
      expect(connErr.isConnectionError()).toBe(true);
      expect(otherErr.isConnectionError()).toBe(false);
    });

    it('isTimeoutError 正确', () => {
      const tErr = new McpTimeoutError('m', 1000);
      const otherErr = new McpError('x', -1);
      expect(tErr.isTimeoutError()).toBe(true);
      expect(otherErr.isTimeoutError()).toBe(false);
    });
  });

  describe('McpParseError', () => {
    it('默认消息和错误码', () => {
      const err = new McpParseError();
      expect(err.code).toBe(JSON_RPC_PARSE_ERROR);
      expect(err.message).toBe('Parse error');
      expect(err.name).toBe('McpParseError');
    });

    it('自定义消息', () => {
      const err = new McpParseError('bad json');
      expect(err.message).toBe('bad json');
    });
  });

  describe('McpInvalidRequestError', () => {
    it('默认错误码', () => {
      const err = new McpInvalidRequestError();
      expect(err.code).toBe(JSON_RPC_INVALID_REQUEST);
    });
  });

  describe('McpMethodNotFoundError', () => {
    it('包含方法名', () => {
      const err = new McpMethodNotFoundError('unknown_method');
      expect(err.message).toContain('unknown_method');
      expect(err.code).toBe(JSON_RPC_METHOD_NOT_FOUND);
    });
  });

  describe('McpInvalidParamsError', () => {
    it('默认错误码', () => {
      const err = new McpInvalidParamsError();
      expect(err.code).toBe(JSON_RPC_INVALID_PARAMS);
    });
  });

  describe('McpInternalError', () => {
    it('默认错误码', () => {
      const err = new McpInternalError();
      expect(err.code).toBe(JSON_RPC_INTERNAL_ERROR);
    });
  });

  describe('McpConnectionError', () => {
    it('默认错误码', () => {
      const err = new McpConnectionError();
      expect(err.code).toBe(JSON_RPC_SERVER_ERROR_END);
    });
  });

  describe('McpTimeoutError', () => {
    it('包含方法和超时时间', () => {
      const err = new McpTimeoutError('slow_method', 5000);
      expect(err.message).toContain('slow_method');
      expect(err.message).toContain('5000');
      expect(err.method).toBe('slow_method');
      expect(err.timeoutMs).toBe(5000);
      expect(err.code).toBe(JSON_RPC_SERVER_ERROR_END + 1);
    });
  });

  describe('McpServerError', () => {
    it('服务器错误在合法范围内', () => {
      const err = new McpServerError('server fail', -32050);
      expect(err.code).toBe(-32050);
    });

    it('超出范围时使用默认服务器错误码', () => {
      const err = new McpServerError('out of range', -100);
      expect(err.code).toBe(-32099);
    });
  });

  describe('McpNotConnectedError', () => {
    it('默认消息', () => {
      const err = new McpNotConnectedError();
      expect(err.message).toBe('Client not connected');
    });
  });

  describe('McpClosedError', () => {
    it('默认消息', () => {
      const err = new McpClosedError();
      expect(err.message).toBe('Client has been closed');
    });
  });

  describe('createMcpErrorFromCode', () => {
    it('parse error → McpParseError', () => {
      const err = createMcpErrorFromCode(JSON_RPC_PARSE_ERROR, 'x');
      expect(err).toBeInstanceOf(McpParseError);
    });

    it('invalid request → McpInvalidRequestError', () => {
      const err = createMcpErrorFromCode(JSON_RPC_INVALID_REQUEST, 'x');
      expect(err).toBeInstanceOf(McpInvalidRequestError);
    });

    it('method not found → McpMethodNotFoundError', () => {
      const err = createMcpErrorFromCode(JSON_RPC_METHOD_NOT_FOUND, 'x', undefined, 'foo');
      expect(err).toBeInstanceOf(McpMethodNotFoundError);
    });

    it('invalid params → McpInvalidParamsError', () => {
      const err = createMcpErrorFromCode(JSON_RPC_INVALID_PARAMS, 'x');
      expect(err).toBeInstanceOf(McpInvalidParamsError);
    });

    it('internal → McpInternalError', () => {
      const err = createMcpErrorFromCode(JSON_RPC_INTERNAL_ERROR, 'x');
      expect(err).toBeInstanceOf(McpInternalError);
    });

    it('connection → McpConnectionError', () => {
      const err = createMcpErrorFromCode(JSON_RPC_SERVER_ERROR_END, 'x');
      expect(err).toBeInstanceOf(McpConnectionError);
    });

    it('timeout → McpTimeoutError', () => {
      const err = createMcpErrorFromCode(
        JSON_RPC_SERVER_ERROR_END + 1,
        'x',
        undefined,
        'm',
        1000,
      );
      expect(err).toBeInstanceOf(McpTimeoutError);
    });

    it('未知代码 → McpError', () => {
      const err = createMcpErrorFromCode(-99999, 'x');
      expect(err).toBeInstanceOf(McpError);
    });
  });
});
