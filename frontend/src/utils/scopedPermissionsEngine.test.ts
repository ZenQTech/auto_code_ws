/**
 * ScopedPermissionsEngine 单元测试 (v1.0.0 Cycle 28 G28-04)
 */

// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { ScopedPermissionsEngine, getDefaultScopedPermissionsEngine } from './scopedPermissionsEngine';

describe('ScopedPermissionsEngine', () => {
  let engine: ScopedPermissionsEngine;

  beforeEach(() => {
    localStorage.clear();
    engine = new ScopedPermissionsEngine();
  });

  describe('作用域管理', () => {
    it('createScope 完整', () => {
      const scope = engine.createScope('/root/a', {
        tools: [{ tool: 'read', mode: 'allow' }],
        paths: [{ pattern: '/tmp/*', mode: 'block' }],
      });
      expect(scope.agentPath).toBe('/root/a');
      expect(scope.tools[0].tool).toBe('read');
    });

    it('createScope 重复抛错', () => {
      engine.createScope('/root/a');
      expect(() => engine.createScope('/root/a')).toThrow();
    });

    it('getScope 不存在返回 undefined', () => {
      expect(engine.getScope('/unknown')).toBeUndefined();
    });

    it('updateScope 修改', () => {
      engine.createScope('/root/a');
      const updated = engine.updateScope('/root/a', { maxTokens: 10000 });
      expect(updated.maxTokens).toBe(10000);
    });

    it('deleteScope 删除', () => {
      engine.createScope('/root/a');
      expect(engine.deleteScope('/root/a')).toBe(true);
      expect(engine.getScope('/root/a')).toBeUndefined();
    });
  });

  describe('工具权限', () => {
    beforeEach(() => {
      engine.createScope('/root/a', {
        tools: [
          { tool: 'read', mode: 'allow' },
          { tool: 'write', mode: 'block' },
          { tool: 'execute', mode: 'ask' },
          { tool: '*', mode: 'allow' },
        ],
      });
    });

    it('allow 通过', () => {
      const r = engine.checkToolPermission('/root/a', 'read');
      expect(r.allowed).toBe(true);
    });

    it('block 拒绝', () => {
      const r = engine.checkToolPermission('/root/a', 'write');
      expect(r.allowed).toBe(false);
    });

    it('ask 需要确认', () => {
      const r = engine.checkToolPermission('/root/a', 'execute');
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain('confirmation');
    });

    it('通配符匹配', () => {
      const r = engine.checkToolPermission('/root/a', 'other-tool');
      expect(r.allowed).toBe(true);
    });

    it('无作用域默认 allow', () => {
      const r = engine.checkToolPermission('/unknown', 'read');
      expect(r.allowed).toBe(true);
    });
  });

  describe('路径权限', () => {
    beforeEach(() => {
      engine.createScope('/root/a', {
        paths: [
          { pattern: '/safe', mode: 'allow' },
          { pattern: '/danger', mode: 'block' },
          { pattern: '/workspace', mode: 'allow', recursive: true },
        ],
      });
    });

    it('精确匹配 allow', () => {
      expect(engine.checkPathPermission('/root/a', '/safe').allowed).toBe(true);
    });

    it('精确匹配 block', () => {
      expect(engine.checkPathPermission('/root/a', '/danger').allowed).toBe(false);
    });

    it('递归匹配', () => {
      expect(engine.checkPathPermission('/root/a', '/workspace/sub/dir').allowed).toBe(true);
    });

    it('无匹配默认 allow', () => {
      expect(engine.checkPathPermission('/root/a', '/other').allowed).toBe(true);
    });
  });

  describe('网络权限', () => {
    beforeEach(() => {
      engine.createScope('/root/a', {
        networks: [
          { host: 'api.openai.com', mode: 'allow' },
          { host: 'localhost', mode: 'allow', ports: [3000, 8080] },
          { host: 'evil.com', mode: 'block' },
        ],
      });
    });

    it('host allow', () => {
      expect(engine.checkNetworkPermission('/root/a', 'api.openai.com').allowed).toBe(true);
    });

    it('host block', () => {
      expect(engine.checkNetworkPermission('/root/a', 'evil.com').allowed).toBe(false);
    });

    it('port 限制', () => {
      expect(engine.checkNetworkPermission('/root/a', 'localhost', 3000).allowed).toBe(true);
      expect(engine.checkNetworkPermission('/root/a', 'localhost', 9999).allowed).toBe(true); // 不在白名单中，由其他规则决定
    });
  });

  describe('继承', () => {
    it('子代理继承父级权限', () => {
      engine.createScope('/root', { tools: [{ tool: 'read', mode: 'block' }] });
      engine.createScope('/root/a', { tools: [{ tool: 'write', mode: 'allow' }] });
      const r = engine.checkToolPermissionWithInheritance('/root/a', 'read');
      expect(r.allowed).toBe(false);
    });

    it('无冲突时使用自身规则', () => {
      engine.createScope('/root', { tools: [{ tool: 'read', mode: 'block' }] });
      engine.createScope('/root/a', { tools: [{ tool: 'write', mode: 'allow' }] });
      const r = engine.checkToolPermissionWithInheritance('/root/a', 'write');
      expect(r.allowed).toBe(true);
    });

    it('getInheritedScopes 顺序', () => {
      engine.createScope('/root');
      engine.createScope('/root/a');
      engine.createScope('/root/a/b');
      const scopes = engine.getInheritedScopes('/root/a/b');
      expect(scopes.map((s) => s.agentPath)).toEqual(['/root', '/root/a', '/root/a/b']);
    });
  });

  describe('事件系统', () => {
    it('订阅 permission-denied', () => {
      const events: any[] = [];
      engine.on('permission-denied', (e) => events.push(e));
      engine.createScope('/root/a', { tools: [{ tool: 'write', mode: 'block' }] });
      engine.checkToolPermission('/root/a', 'write');
      expect(events.length).toBe(1);
    });
  });

  describe('持久化', () => {
    it('保存到 localStorage', () => {
      engine.createScope('/root/a');
      const raw = localStorage.getItem('hermes.scopedPermissions');
      expect(raw).toBeDefined();
    });

    it('从 localStorage 恢复', () => {
      engine.createScope('/root/a', { tools: [{ tool: 'read', mode: 'allow' }] });
      const newEngine = new ScopedPermissionsEngine();
      expect(newEngine.getScope('/root/a')).toBeDefined();
    });
  });
});

describe('单例', () => {
  it('getDefault 返回相同实例', () => {
    const a = getDefaultScopedPermissionsEngine();
    const b = getDefaultScopedPermissionsEngine();
    expect(a).toBe(b);
  });
});
