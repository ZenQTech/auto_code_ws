/**
 * # ============================================================
 * # Cycle 27 端到端集成测试 (v1.0.0)
 * # ============================================================
 * # 核心作用：覆盖 Cycle 27 五大新功能的端到端工作流
 * #   G27-01: 嵌套子代理 (NestedSubAgents)
 * #   G27-02: 代理检查点 (Agent Checkpointing)
 * #   G27-04: 代理消息 (Agent Messaging)
 * #   G27-05: 代理模板 (Agent Templates)
 * #   G27-06: 远程控制 (Remote Control)
 * # 测试维度：
 * #   1. 引擎/适配器单元链路
 * #   2. 组件 + 引擎集成
 * #   3. 多面板协同
 * #   4. 持久化与重载
 * #   5. 错误处理与边界
 * # ============================================================
 * # 修改记录：
 * #   - 2026-07-30 | v1.0.0 | Cycle 27 E2E 初次创建
 * # ============================================================
 */

// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NestedSubAgentPanel } from '../components/NestedSubAgentPanel';
import { AgentCheckpointPanel } from '../components/AgentCheckpointPanel';
import { AgentMessagingPanel } from '../components/AgentMessagingPanel';
import { AgentTemplatePanel } from '../components/AgentTemplatePanel';
import { RemoteControlPanel } from '../components/RemoteControlPanel';
import {
  getDefaultNestedSubAgentEngine,
  resetDefaultNestedSubAgentEngine,
} from '../utils/nestedSubAgentEngine';
import {
  getDefaultAgentCheckpointEngine,
  resetDefaultAgentCheckpointEngine,
} from '../utils/agentCheckpointEngine';
import {
  getDefaultAgentMessagingEngine,
  resetDefaultAgentMessagingEngine,
} from '../utils/agentMessagingEngine';
import {
  getDefaultAgentTemplateEngine,
  resetDefaultAgentTemplateEngine,
} from '../utils/agentTemplateEngine';
import {
  getDefaultRemoteControlEngine,
  resetDefaultRemoteControlEngine,
} from '../utils/remoteControlEngine';

/**
 * 创建简单子代理的辅助函数
 */
function makeSubAgentConfig(name: string, role: any = 'worker'): any {
  return {
    name,
    role,
    description: `Test ${name}`,
    model: 'sonnet',
    reasoningEffort: 'medium',
    systemPrompt: `Test ${name}`,
    tools: ['Read'],
    constraints: [],
    contextWindow: 8000,
    timeoutMs: 10000,
  };
}

describe('Cycle 27 E2E - 引擎初始化', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultNestedSubAgentEngine();
    resetDefaultAgentCheckpointEngine();
    resetDefaultAgentMessagingEngine();
    resetDefaultAgentTemplateEngine();
    resetDefaultRemoteControlEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('五个引擎独立实例化', () => {
    const nested = getDefaultNestedSubAgentEngine();
    const checkpoint = getDefaultAgentCheckpointEngine();
    const messaging = getDefaultAgentMessagingEngine();
    const template = getDefaultAgentTemplateEngine();
    const remote = getDefaultRemoteControlEngine();

    expect(nested).toBeDefined();
    expect(checkpoint).toBeDefined();
    expect(messaging).toBeDefined();
    expect(template).toBeDefined();
    expect(remote).toBeDefined();
  });

  it('五个引擎事件订阅/触发独立', () => {
    const nested = getDefaultNestedSubAgentEngine();
    const messaging = getDefaultAgentMessagingEngine();
    const template = getDefaultAgentTemplateEngine();
    const remote = getDefaultRemoteControlEngine();

    const nestedCalls: any[] = [];
    const messagingCalls: any[] = [];
    const templateCalls: any[] = [];
    const remoteCalls: any[] = [];

    nested.on('agent-created', (e) => nestedCalls.push(e));
    messaging.on('message-sent', (e) => messagingCalls.push(e));
    template.on('template-installed', (e) => templateCalls.push(e));
    remote.on('pairing-started', (e) => remoteCalls.push(e));

    // 嵌套子代理 - 创建根代理
    const rootUuid = nested.createRootAgent(makeSubAgentConfig('root', 'coordinator'));
    expect(rootUuid).toBeTruthy();
    expect(nestedCalls.length).toBe(1);

    // 模板 - 安装内置模板
    template.installTemplate('builtin-code-reviewer');
    expect(templateCalls.length).toBe(1);

    // 远程控制 - 启动配对
    remote.startPairing();
    expect(remoteCalls.length).toBe(1);

    // 消息 - 发送消息
    const msg = messaging.sendMessage({
      from: '/root/coordinator',
      to: '/root/worker',
      type: 'request_reply',
      priority: 'normal',
      content: 'test',
    });
    expect(msg).toBeTruthy();
    expect(messagingCalls.length).toBe(1);
  });
});

describe('Cycle 27 E2E - G27-01 嵌套子代理', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultNestedSubAgentEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('创建根 → 子 → 孙 三级嵌套', () => {
    const engine = getDefaultNestedSubAgentEngine();
    const rootUuid = engine.createRootAgent(makeSubAgentConfig('root', 'coordinator'));
    const childUuid = engine.createChildAgent(rootUuid, makeSubAgentConfig('child'));
    expect(childUuid).toBeTruthy();
    const grandchildUuid = engine.createChildAgent(childUuid, makeSubAgentConfig('grandchild'));
    expect(grandchildUuid).toBeTruthy();
    const tree = engine.getTree(rootUuid);
    expect(tree?.totalAgents).toBe(3);
  });

  it('超过最大深度抛出错误', () => {
    const engine = getDefaultNestedSubAgentEngine();
    const rootUuid = engine.createRootAgent(makeSubAgentConfig('root', 'coordinator'));
    const childUuid = engine.createChildAgent(rootUuid, makeSubAgentConfig('child'));
    const grandchildUuid = engine.createChildAgent(childUuid, makeSubAgentConfig('grandchild'));
    // 默认 maxDepth=3，根 depth=0，子 depth=1，孙 depth=2，试图创建 depth=3 应失败
    expect(() =>
      engine.createChildAgent(grandchildUuid, makeSubAgentConfig('great-grandchild'))
    ).toThrow();
  });

  it('NestedSubAgentPanel 渲染', () => {
    const { container } = render(<NestedSubAgentPanel isOpen={true} onClose={() => {}} />);
    expect(container.querySelector('[data-testid="nested-sub-agent-panel"]')).toBeTruthy();
  });

  it('取消代理 + 清理', () => {
    const engine = getDefaultNestedSubAgentEngine();
    const rootUuid = engine.createRootAgent(makeSubAgentConfig('root', 'coordinator'));
    const childUuid = engine.createChildAgent(rootUuid, makeSubAgentConfig('child'));
    engine.cancelAgent(childUuid);
    expect(engine.getAgent(childUuid)?.status).toBe('cancelled');
  });
});

describe('Cycle 27 E2E - G27-02 代理检查点', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultNestedSubAgentEngine();
    resetDefaultAgentCheckpointEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('保存/列出/删除检查点', () => {
    const nested = getDefaultNestedSubAgentEngine();
    const checkpoint = getDefaultAgentCheckpointEngine();

    const rootUuid = nested.createRootAgent(makeSubAgentConfig('root', 'coordinator'));

    const cp = checkpoint.saveCheckpoint(nested, rootUuid, { name: 'test-cp' });
    expect(cp.id).toBeTruthy();
    expect(checkpoint.listCheckpoints().length).toBe(1);

    checkpoint.deleteCheckpoint(cp.id);
    expect(checkpoint.listCheckpoints().length).toBe(0);
  });

  it('重命名 + 标签', () => {
    const nested = getDefaultNestedSubAgentEngine();
    const checkpoint = getDefaultAgentCheckpointEngine();

    const rootUuid = nested.createRootAgent(makeSubAgentConfig('root', 'coordinator'));
    const cp = checkpoint.saveCheckpoint(nested, rootUuid, { name: 'original' });

    checkpoint.renameCheckpoint(cp.id, 'renamed');
    expect(checkpoint.getCheckpoint(cp.id)?.name).toBe('renamed');

    checkpoint.addTag(cp.id, 'tag1');
    expect(checkpoint.getCheckpoint(cp.id)?.tags).toContain('tag1');
  });

  it('AgentCheckpointPanel 渲染', () => {
    render(<AgentCheckpointPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('agent-checkpoint-panel')).toBeTruthy();
  });
});

describe('Cycle 27 E2E - G27-04 代理消息', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultAgentMessagingEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('send_message / markReplied / followup_task 完整流程', () => {
    const engine = getDefaultAgentMessagingEngine();
    const msg = engine.sendMessage({
      from: '/root/coordinator',
      to: '/root/worker',
      type: 'request_reply',
      priority: 'normal',
      content: '请处理任务',
    });
    expect(msg.id).toBeTruthy();
    expect(msg.status).toBe('sent');

    engine.markReplied(msg.id, '已完成');
    expect(engine.getMessage(msg.id)?.status).toBe('replied');

    const followup = engine.scheduleFollowup(msg.id, '/root/worker', '后续清理');
    expect(followup.id).toBeTruthy();
  });

  it('AgentMessagingPanel 渲染', () => {
    render(<AgentMessagingPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('agent-messaging-panel')).toBeTruthy();
  });
});

describe('Cycle 27 E2E - G27-05 代理模板', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultAgentTemplateEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('内置模板查询', () => {
    const engine = getDefaultAgentTemplateEngine();
    const tpl = engine.getTemplate('builtin-code-reviewer');
    expect(tpl).toBeDefined();
    expect(tpl?.scope).toBe('builtin');
  });

  it('用户模板 CRUD', () => {
    const engine = getDefaultAgentTemplateEngine();
    const userTpl = engine.createUserTemplate({
      name: 'e2e-user-tpl',
      displayName: 'E2E 用户模板',
      description: 'For E2E testing',
      category: 'general',
      role: 'worker',
      model: 'sonnet',
      reasoningEffort: 'medium',
      systemPrompt: 'You are a test agent',
      tools: ['Read'],
      constraints: [],
      contextWindow: 8000,
      timeoutMs: 10000,
      worktreeIsolation: false,
      tags: ['e2e'],
      icon: '🧪',
    });
    expect(userTpl.id).toBeTruthy();
    expect(userTpl.scope).toBe('user');

    engine.updateUserTemplate(userTpl.id, { description: 'Updated' });
    expect(engine.getTemplate(userTpl.id)?.description).toBe('Updated');

    engine.deleteUserTemplate(userTpl.id);
    expect(engine.getTemplate(userTpl.id)).toBeUndefined();
  });

  it('模板评分 + 导入导出', () => {
    const engine = getDefaultAgentTemplateEngine();
    engine.rateTemplate('builtin-code-reviewer', 5, '很好用');
    const tpl = engine.getTemplate('builtin-code-reviewer');
    expect(tpl?.rating).toBeGreaterThanOrEqual(4);

    const json = engine.exportTemplate('builtin-code-reviewer');
    expect(json).toContain('code-reviewer');
  });

  it('AgentTemplatePanel 渲染', () => {
    render(<AgentTemplatePanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('agent-template-panel')).toBeTruthy();
  });
});

describe('Cycle 27 E2E - G27-06 远程控制', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultRemoteControlEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('配对 → 完成 → 撤销完整流程', async () => {
    const engine = getDefaultRemoteControlEngine();
    const session = engine.startPairing();
    expect(session.id).toBeTruthy();
    expect(session.status).toBe('pending');

    const device = await engine.completePairing(session.id, {
      name: 'Test Phone',
      type: 'mobile',
      platform: 'android',
    });
    expect(device.id).toBeTruthy();
    expect(device.status).toBe('paired');

    const ok = engine.revokeDevice(device.id);
    expect(ok).toBe(true);
    expect(engine.getDevice(device.id)?.status).toBe('revoked');
  });

  it('Thread 迁移', async () => {
    const engine = getDefaultRemoteControlEngine();
    const session = engine.startPairing({ threadId: 'thread-001' });
    const device = await engine.completePairing(session.id, {
      name: 'Test Tablet',
      type: 'tablet',
      platform: 'ios',
    });

    // 同一设备自迁移：fromDeviceId = toDeviceId
    const handoff = engine.startHandoff({
      threadId: 'thread-001',
      fromDeviceId: device.id,
      toDeviceId: device.id,
      threadName: 'E2E Test Thread',
      messageCount: 0,
      sizeBytes: 0,
    });
    expect(handoff.id).toBeTruthy();
    expect(handoff.status).toBe('pending');

    const ok = await engine.executeHandoff(handoff.id);
    expect(ok).toBe(true);
    const list = engine.listHandoffs();
    const found = list.find((h) => h.id === handoff.id);
    expect(found?.status).toBe('completed');
  });

  it('RemoteControlPanel 渲染', () => {
    render(<RemoteControlPanel isOpen={true} onClose={() => {}} />);
    expect(screen.getByTestId('remote-control-panel')).toBeTruthy();
  });
});

describe('Cycle 27 E2E - 多面板协同与持久化', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDefaultNestedSubAgentEngine();
    resetDefaultAgentMessagingEngine();
    resetDefaultAgentTemplateEngine();
    resetDefaultRemoteControlEngine();
    resetDefaultAgentCheckpointEngine();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('五个面板同时打开不冲突', () => {
    const onClose = () => {};
    render(
      <div>
        <NestedSubAgentPanel isOpen={true} onClose={onClose} />
        <AgentCheckpointPanel isOpen={true} onClose={onClose} />
        <AgentMessagingPanel isOpen={true} onClose={onClose} />
        <AgentTemplatePanel isOpen={true} onClose={onClose} />
        <RemoteControlPanel isOpen={true} onClose={onClose} />
      </div>
    );
    expect(screen.getByTestId('nested-sub-agent-panel')).toBeTruthy();
    expect(screen.getByTestId('agent-checkpoint-panel')).toBeTruthy();
    expect(screen.getByTestId('agent-messaging-panel')).toBeTruthy();
    expect(screen.getByTestId('agent-template-panel')).toBeTruthy();
    expect(screen.getByTestId('remote-control-panel')).toBeTruthy();
  });

  it('持久化: 模板创建后 reload 仍存在', async () => {
    const engine1 = getDefaultAgentTemplateEngine();
    engine1.createUserTemplate({
      name: 'persist-tpl',
      displayName: '持久化测试模板',
      description: 'Test persistence',
      category: 'general',
      role: 'worker',
      model: 'sonnet',
      reasoningEffort: 'medium',
      systemPrompt: 'Test',
      tools: ['Read'],
      constraints: [],
      contextWindow: 8000,
      timeoutMs: 10000,
      worktreeIsolation: false,
      tags: ['persist'],
      icon: '💾',
    });
    // 等待 save 异步完成
    await new Promise((resolve) => setTimeout(resolve, 100));
    // 重新获取实例（模拟 reload）
    resetDefaultAgentTemplateEngine();
    const engine2 = getDefaultAgentTemplateEngine();
    const tpl = engine2.getTemplate('user-persist-tpl');
    expect(tpl?.displayName).toBe('持久化测试模板');
  });

  it('多引擎协同: 嵌套子代理 + 消息 + 检查点', async () => {
    const nested = getDefaultNestedSubAgentEngine();
    const messaging = getDefaultAgentMessagingEngine();
    const checkpoint = getDefaultAgentCheckpointEngine();

    // 1. 创建嵌套代理树
    const rootUuid = nested.createRootAgent(makeSubAgentConfig('root', 'coordinator'));
    const childUuid = nested.createChildAgent(rootUuid, makeSubAgentConfig('child'));

    // 2. 通过消息系统向子代理发送任务
    const rootNode = nested.getAgent(rootUuid);
    const childNode = nested.getAgent(childUuid);
    expect(rootNode).toBeDefined();
    expect(childNode).toBeDefined();

    const msg = messaging.sendMessage({
      from: rootNode!.path,
      to: childNode!.path,
      type: 'request_reply',
      priority: 'high',
      content: '请完成子任务',
    });
    expect(msg).toBeTruthy();

    // 3. 保存检查点
    const cp = checkpoint.saveCheckpoint(nested, rootUuid, { name: 'after-msg' });
    expect(cp.id).toBeTruthy();
    expect(cp.nodeCount).toBe(2);
  });
});
