/**
 * # ============================================================
 * # Knative Serving Generator - 单元测试 (Cycle 56 G56-01)
 * # ============================================================
 * # 测试覆盖：流量切分 + Service/Configuration/Route/Revision 构建
 * # ====================================
 */

import { describe, it, expect } from 'vitest';
import {
  buildAutoScalingAnnotations,
  buildTrafficTargets,
  buildRevisionName,
  generateRevisionId,
  sanitizeRevisionSuffix,
  createKnativeService,
  createKnativeConfiguration,
  createKnativeRoute,
  createKnativeRevision,
  buildKnativeApplicationStack,
  validateTrafficSplit,
  buildKnativeManifestYaml,
} from './knativeServingGenerator';

describe('G56-01 Knative Serving Generator', () => {
  describe('buildAutoScalingAnnotations', () => {
    it('应生成空注解（无配置）', () => {
      expect(buildAutoScalingAnnotations({})).toEqual({});
    });

    it('应生成 minScale / maxScale 注解', () => {
      const ann = buildAutoScalingAnnotations({ minScale: 1, maxScale: 10 });
      expect(ann['autoscaling.knative.dev/min-scale']).toBe('1');
      expect(ann['autoscaling.knative.dev/max-scale']).toBe('10');
    });

    it('应生成 target 并设置 metric=concurrency', () => {
      const ann = buildAutoScalingAnnotations({ target: 100 });
      expect(ann['autoscaling.knative.dev/metric']).toBe('concurrency');
      expect(ann['autoscaling.knative.dev/target']).toBe('100');
    });

    it('应允许缩容到 0', () => {
      const ann = buildAutoScalingAnnotations({ allowZero: true });
      expect(ann['autoscaling.knative.dev/allow-zero-scale']).toBe('true');
    });
  });

  describe('buildTrafficTargets', () => {
    it('默认 100% 到 latest', () => {
      const targets = buildTrafficTargets();
      expect(targets).toEqual([{ percent: 100, latestRevision: true }]);
    });

    it('allToLatest=true 应返回 100% latest', () => {
      const targets = buildTrafficTargets({ allToLatest: true });
      expect(targets[0]?.percent).toBe(100);
      expect(targets[0]?.latestRevision).toBe(true);
    });

    it('customSplit 应返回分版本切分', () => {
      const targets = buildTrafficTargets({
        customSplit: { 'web-v1': 80, 'web-v2': 20 },
      });
      expect(targets).toHaveLength(2);
      expect(targets[0]?.revisionName).toBe('web-v1');
      expect(targets[0]?.percent).toBe(80);
    });

    it('customSplit 总和不为 100 应抛错', () => {
      expect(() =>
        buildTrafficTargets({ customSplit: { 'web-v1': 50, 'web-v2': 30 } })
      ).toThrow(/总和必须为 100%/);
    });

    it('tagSplit 应带标签', () => {
      const targets = buildTrafficTargets({
        tagSplit: {
          stable: { revisionName: 'web-v1', percent: 70 },
          canary: { revisionName: 'web-v2', percent: 30 },
        },
      });
      expect(targets[0]?.tag).toBe('stable');
      expect(targets[1]?.tag).toBe('canary');
    });

    it('blueGreen 应返回 blue + green 流量', () => {
      const targets = buildTrafficTargets({
        blueGreen: { bluePercent: 90, greenPercent: 10 },
      });
      expect(targets[0]?.tag).toBe('blue');
      expect(targets[0]?.percent).toBe(90);
      expect(targets[1]?.tag).toBe('green');
      expect(targets[1]?.percent).toBe(10);
    });
  });

  describe('buildRevisionName', () => {
    it('应使用服务名+标签拼接', () => {
      expect(buildRevisionName('web', 'v1.0.0')).toBe('web-v1.0.0');
    });

    it('无标签时应生成随机 ID', () => {
      const name = buildRevisionName('web');
      expect(name).toMatch(/^web-[a-z0-9]+-[a-z0-9]+$/);
    });
  });

  describe('generateRevisionId', () => {
    it('应生成符合格式的 ID', () => {
      const id = generateRevisionId();
      expect(id).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);
    });

    it('多次生成应得到不同 ID', () => {
      const ids = new Set();
      for (let i = 0; i < 10; i++) ids.add(generateRevisionId());
      expect(ids.size).toBeGreaterThan(1);
    });
  });

  describe('sanitizeRevisionSuffix', () => {
    it('应转小写并替换非法字符', () => {
      expect(sanitizeRevisionSuffix('V1.0.0_BUILD!')).toBe('v1.0.0-build-');
    });

    it('应截断到 64 字符', () => {
      const long = 'a'.repeat(100);
      expect(sanitizeRevisionSuffix(long).length).toBe(64);
    });
  });

  describe('createKnativeService', () => {
    it('应创建基本 Service 资源', () => {
      const svc = createKnativeService({
        name: 'web',
        image: 'nginx',
        imageTag: '1.25',
        namespace: 'default',
      });
      expect(svc.kind).toBe('Service');
      expect(svc.apiVersion).toBe('serving.knative.dev/v1');
      expect(svc.metadata.name).toBe('web');
      expect(svc.metadata.namespace).toBe('default');
      expect(svc.spec.template.spec.containers[0]?.image).toBe('nginx:1.25');
    });

    it('应生成自动扩缩容注解', () => {
      const svc = createKnativeService({
        name: 'web',
        image: 'nginx',
        autoScaling: { minScale: 2, maxScale: 20, target: 50 },
      });
      expect(svc.metadata.annotations?.['autoscaling.knative.dev/min-scale']).toBe('2');
      expect(svc.metadata.annotations?.['autoscaling.knative.dev/max-scale']).toBe('20');
    });

    it('blue-green 策略应设置 rollout-duration=0', () => {
      const svc = createKnativeService({
        name: 'web',
        image: 'nginx',
        strategy: 'blue-green',
      });
      expect(svc.metadata.annotations?.['serving.knative.dev/rollout-duration']).toBe('0s');
    });

    it('canary 策略应设置 rollout-duration=300s', () => {
      const svc = createKnativeService({
        name: 'web',
        image: 'nginx',
        strategy: 'canary',
      });
      expect(svc.metadata.annotations?.['serving.knative.dev/rollout-duration']).toBe('300s');
    });

    it('应传递环境变量', () => {
      const svc = createKnativeService({
        name: 'web',
        image: 'nginx',
        env: { LOG_LEVEL: 'info', DEBUG: 'true' },
      });
      const env = svc.spec.template.spec.containers[0]?.env;
      expect(env).toHaveLength(2);
      expect(env?.find((e) => e.name === 'LOG_LEVEL')?.value).toBe('info');
    });
  });

  describe('createKnativeConfiguration', () => {
    it('应创建 Configuration 资源', () => {
      const cfg = createKnativeConfiguration({
        name: 'web',
        image: 'nginx:1.25',
        containerConcurrency: 50,
      });
      expect(cfg.kind).toBe('Configuration');
      expect(cfg.spec.template.spec.containers[0]?.image).toBe('nginx:1.25');
      expect(cfg.spec.template.spec.containerConcurrency).toBe(50);
    });
  });

  describe('createKnativeRoute', () => {
    it('应创建 Route 资源', () => {
      const route = createKnativeRoute({
        name: 'web',
        configurationName: 'web',
        traffic: { allToLatest: true },
      });
      expect(route.kind).toBe('Route');
      expect(route.spec.traffic).toHaveLength(1);
    });
  });

  describe('createKnativeRevision', () => {
    it('应包含 configurationRef 引用', () => {
      const rev = createKnativeRevision({
        serviceName: 'web',
        revisionName: 'web-v1',
        image: 'nginx:1.25',
      });
      expect(rev.kind).toBe('Revision');
      expect(rev.spec.configurationRef?.name).toBe('web');
      expect(rev.metadata.labels?.['serving.knative.dev/configuration']).toBe('web');
    });
  });

  describe('buildKnativeApplicationStack', () => {
    it('应返回 Service + Configuration + Route + Revision', () => {
      const stack = buildKnativeApplicationStack({
        name: 'web',
        image: 'nginx',
        imageTag: '1.25',
      });
      expect(stack.service.kind).toBe('Service');
      expect(stack.configuration.kind).toBe('Configuration');
      expect(stack.route.kind).toBe('Route');
      expect(stack.revision.kind).toBe('Revision');
    });

    it('Service URL 应基于服务名', () => {
      const stack = buildKnativeApplicationStack({
        name: 'web',
        image: 'nginx',
        namespace: 'demo',
      });
      // 验证 Service 已创建
      expect(stack.service.metadata.name).toBe('web');
      expect(stack.service.metadata.namespace).toBe('demo');
    });
  });

  describe('validateTrafficSplit', () => {
    it('空数组应无效', () => {
      const r = validateTrafficSplit([]);
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
    });

    it('100% 单目标应有效', () => {
      const r = validateTrafficSplit([{ percent: 100, latestRevision: true }]);
      expect(r.valid).toBe(true);
    });

    it('总和不为 100 应无效', () => {
      const r = validateTrafficSplit([
        { percent: 60, revisionName: 'v1' },
        { percent: 30, revisionName: 'v2' },
      ]);
      expect(r.valid).toBe(false);
      expect(r.errors.some((e) => e.includes('总和'))).toBe(true);
    });

    it('缺 revisionName 且非 latest 应无效', () => {
      const r = validateTrafficSplit([{ percent: 100 }]);
      expect(r.valid).toBe(false);
    });
  });

  describe('buildKnativeManifestYaml', () => {
    it('应序列化为多文档 YAML', () => {
      const stack = buildKnativeApplicationStack({
        name: 'web',
        image: 'nginx',
      });
      const yaml = buildKnativeManifestYaml([
        stack.service,
        stack.configuration,
        stack.route,
        stack.revision,
      ]);
      expect(yaml).toContain('apiVersion: serving.knative.dev/v1');
      expect(yaml).toContain('kind: Service');
      expect(yaml).toContain('kind: Configuration');
      expect(yaml).toContain('kind: Route');
      expect(yaml).toContain('kind: Revision');
      expect(yaml).toContain('---');
    });
  });
});
