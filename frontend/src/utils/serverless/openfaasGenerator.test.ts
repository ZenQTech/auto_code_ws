/**
 * # ============================================================
 * # OpenFaaS Generator - 单元测试 (Cycle 56 G56-03)
 * # ============================================================
 */

import { describe, it, expect } from 'vitest';
import {
  createOpenFaasFunction,
  createOpenFaasProfile,
  buildWatchdogConfig,
  browseStore,
  deployFromStore,
  getStoreFunction,
  buildOpenFaasApplicationStack,
  buildOpenFaasManifestYaml,
  validateFunctionName,
  estimateColdStart,
} from './openfaasGenerator';
import { OFFICIAL_FUNCTION_STORE, STORE_CATEGORIES } from './openfaasStore';

describe('G56-03 OpenFaaS Generator', () => {
  describe('createOpenFaasFunction', () => {
    it('应创建基本 Function', () => {
      const fn = createOpenFaasFunction({
        name: 'hello',
        image: 'ghcr.io/me/hello:latest',
        handler: 'node20',
      });
      expect(fn.kind).toBe('Function');
      expect(fn.apiVersion).toBe('openfaas.com/v1');
      expect(fn.spec.image).toBe('ghcr.io/me/hello:latest');
      expect(fn.spec.handler).toBe('node20');
      expect(fn.spec.trigger).toBe('http');
    });

    it('应设置 faas_function 标签', () => {
      const fn = createOpenFaasFunction({ name: 'web', image: 'web:1' });
      expect(fn.metadata.labels?.['faas_function']).toBe('web');
    });

    it('应注入 Prometheus 注解', () => {
      const fn = createOpenFaasFunction({ name: 'web', image: 'web:1' });
      expect(fn.metadata.annotations?.['prometheus.io/scrape']).toBe('true');
    });

    it('readOnlyRootFilesystem 应设置注解', () => {
      const fn = createOpenFaasFunction({
        name: 'web',
        image: 'web:1',
        readOnlyRootFilesystem: true,
      });
      expect(fn.metadata.annotations?.['com.openfaas.readonly_root_filesystem']).toBe('true');
    });

    it('环境变量应转换', () => {
      const fn = createOpenFaasFunction({
        name: 'web',
        image: 'web:1',
        environment: { LOG_LEVEL: 'info', DEBUG: 'true' },
      });
      expect(fn.spec.environment).toHaveLength(2);
    });
  });

  describe('createOpenFaasProfile', () => {
    it('应创建 Profile', () => {
      const p = createOpenFaasProfile({
        name: 'prod-profile',
        resources: { memory: '256Mi', cpu: '500m' },
      });
      expect(p.kind).toBe('Profile');
      expect(p.spec.resources?.memory).toBe('256Mi');
    });
  });

  describe('buildWatchdogConfig', () => {
    it('应生成 HTTP 模式配置', () => {
      const c = buildWatchdogConfig({ mode: 'http', upstreamUrl: 'http://app:3000' });
      expect(c.mode).toBe('http');
      expect(c.upstreamUrl).toBe('http://app:3000');
    });

    it('应生成 TCP 模式配置', () => {
      const c = buildWatchdogConfig({ mode: 'tcp', port: 8080 });
      expect(c.mode).toBe('tcp');
      expect(c.port).toBe(8080);
    });

    it('应生成 cluster 模式配置', () => {
      const c = buildWatchdogConfig({ mode: 'cluster', clusterFunction: 'auth-svc' });
      expect(c.mode).toBe('cluster');
      expect(c.clusterFunction).toBe('auth-svc');
    });
  });

  describe('browseStore', () => {
    it('应返回官方函数', () => {
      const list = browseStore({ officialOnly: true });
      expect(list.every((f) => f.official)).toBe(true);
    });

    it('应支持分类过滤', () => {
      const list = browseStore({ category: 'AI/ML' });
      expect(list.every((f) => f.category === 'AI/ML')).toBe(true);
    });

    it('应支持语言过滤', () => {
      const list = browseStore({ language: 'go1.21' });
      expect(list.every((f) => f.language === 'go1.21')).toBe(true);
    });

    it('应支持关键字搜索', () => {
      const list = browseStore({ query: 'hash' });
      expect(list.some((f) => f.name === 'hash')).toBe(true);
    });

    it('应返回所有函数（无过滤）', () => {
      const list = browseStore({});
      expect(list.length).toBeGreaterThan(0);
    });
  });

  describe('deployFromStore', () => {
    it('应从 Store 部署函数', () => {
      const fn = deployFromStore(OFFICIAL_FUNCTION_STORE[0]!);
      expect(fn.spec.image).toBe(OFFICIAL_FUNCTION_STORE[0]!.image);
    });

    it('应支持覆盖名称和环境变量', () => {
      const fn = deployFromStore(OFFICIAL_FUNCTION_STORE[0]!, {
        name: 'custom-name',
        environment: { EXTRA: 'value' },
      });
      expect(fn.metadata.name).toBe('custom-name');
      expect(fn.spec.environment?.find((e) => e.name === 'EXTRA')?.value).toBe('value');
    });
  });

  describe('getStoreFunction', () => {
    it('应找到存在的函数', () => {
      const fn = getStoreFunction('hash');
      expect(fn).toBeDefined();
      expect(fn?.name).toBe('hash');
    });

    it('不存在的函数应返回 undefined', () => {
      const fn = getStoreFunction('not-exist-fn');
      expect(fn).toBeUndefined();
    });
  });

  describe('buildOpenFaasApplicationStack', () => {
    it('应返回 Function', () => {
      const stack = buildOpenFaasApplicationStack({
        name: 'web',
        image: 'web:1',
      });
      expect(stack.function.kind).toBe('Function');
      expect(stack.profile).toBeUndefined();
    });

    it('应同时返回 Function + Profile', () => {
      const stack = buildOpenFaasApplicationStack({
        name: 'web',
        image: 'web:1',
        profileName: 'prod',
      });
      expect(stack.profile?.kind).toBe('Profile');
    });
  });

  describe('buildOpenFaasManifestYaml', () => {
    it('应序列化为 YAML', () => {
      const stack = buildOpenFaasApplicationStack({
        name: 'web',
        image: 'web:1',
        profileName: 'prod',
      });
      const yaml = buildOpenFaasManifestYaml(stack.function, stack.profile);
      expect(yaml).toContain('apiVersion: openfaas.com/v1');
      expect(yaml).toContain('kind: Function');
      expect(yaml).toContain('kind: Profile');
    });
  });

  describe('validateFunctionName', () => {
    it('小写字母+数字+连字符应通过', () => {
      const r = validateFunctionName('web-api-v1');
      expect(r.valid).toBe(true);
    });

    it('空字符串应失败', () => {
      const r = validateFunctionName('');
      expect(r.valid).toBe(false);
    });

    it('大写字母应失败', () => {
      const r = validateFunctionName('WebAPI');
      expect(r.valid).toBe(false);
    });
  });

  describe('estimateColdStart', () => {
    it('Go 应较快（~30ms）', () => {
      const t = estimateColdStart('go1.21');
      expect(t).toBeLessThan(50);
    });

    it('Java 应较慢（~800ms）', () => {
      const t = estimateColdStart('java17');
      expect(t).toBeGreaterThan(500);
    });

    it('大内存应略快', () => {
      const t = estimateColdStart('java17', '1Gi');
      expect(t).toBeLessThan(estimateColdStart('java17', '128Mi'));
    });
  });

  describe('STORE_CATEGORIES', () => {
    it('应包含 6 大分类', () => {
      expect(STORE_CATEGORIES.length).toBe(6);
      expect(STORE_CATEGORIES).toContain('AI/ML');
      expect(STORE_CATEGORIES).toContain('Data');
    });
  });
});
