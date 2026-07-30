/**
 * # ============================================================
 * # AgentCheckpointPanel 组件测试 (v1.0.0 Cycle 27 G27-02)
 * # ============================================================
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
// @vitest-environment happy-dom
import { AgentCheckpointPanel } from './AgentCheckpointPanel';
import { AgentCheckpointEngine, IAgentEngine } from '../utils/agentCheckpointEngine';

class MockAgentEngine implements IAgentEngine {
  private nodes: Array<{ uuid: string; tokensUsed: number; config: { name: string; role: string } }> = [];
  private tree: any = { version: '1.0.0', rootUuid: 'root', nodes: [], exportedAt: 0 };

  addNode(uuid: string, name = 'node') {
    this.nodes.push({ uuid, tokensUsed: 100, config: { name, role: 'worker' } });
    this.tree = {
      version: '1.0.0',
      rootUuid: this.nodes[0]?.uuid || 'root',
      nodes: this.nodes.map((n) => ({ uuid: n.uuid, path: `/${n.config.name}`, config: n.config, depth: 0, status: 'completed', children: [], completedTasks: 0, failedTasks: 0, createdAt: 0, tokensUsed: n.tokensUsed, contextUsage: 0, metadata: {} })),
      exportedAt: Date.now(),
    };
  }

  exportTree(): any {
    return this.tree;
  }

  importTree(data: any): string {
    this.tree = data;
    this.nodes = data.nodes.map((n: any) => ({ uuid: n.uuid, tokensUsed: n.tokensUsed, config: n.config }));
    return data.rootUuid;
  }

  getAllNodes() {
    return this.nodes;
  }

  clear() {
    this.nodes = [];
    this.tree = { version: '1.0.0', rootUuid: 'root', nodes: [], exportedAt: 0 };
  }
}

describe('AgentCheckpointPanel', () => {
  let engine: AgentCheckpointEngine;
  let agentEngine: MockAgentEngine;

  beforeEach(() => {
    engine = new AgentCheckpointEngine();
    engine.clear();
    agentEngine = new MockAgentEngine();
    vi.spyOn(window, 'alert').mockImplementation(() => {});
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  it('打开时显示面板', () => {
    render(
      <AgentCheckpointPanel
        isOpen={true}
        onClose={() => {}}
        engine={engine}
        agentEngine={agentEngine}
      />
    );
    expect(screen.getByTestId('agent-checkpoint-panel')).toBeTruthy();
    expect(screen.getByText(/代理检查点/)).toBeTruthy();
  });

  it('关闭时不渲染', () => {
    const { container } = render(
      <AgentCheckpointPanel isOpen={false} onClose={() => {}} engine={engine} agentEngine={agentEngine} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('没有 agentEngine 时禁用保存按钮', () => {
    render(<AgentCheckpointPanel isOpen={true} onClose={() => {}} engine={engine} />);
    const saveBtn = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(true);
  });

  it('有 agentEngine 时启用保存按钮', () => {
    render(<AgentCheckpointPanel isOpen={true} onClose={() => {}} engine={engine} agentEngine={agentEngine} />);
    const saveBtn = screen.getByTestId('save-button') as HTMLButtonElement;
    expect(saveBtn.disabled).toBe(false);
  });

  it('点击保存按钮显示保存表单', async () => {
    render(
      <AgentCheckpointPanel
        isOpen={true}
        onClose={() => {}}
        engine={engine}
        agentEngine={agentEngine}
        availableRoots={[{ uuid: 'root-1', path: '/root' }]}
      />
    );
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(screen.getByTestId('save-form')).toBeTruthy();
    });
  });

  it('保存检查点', async () => {
    agentEngine.addNode('root-1', 'root');
    render(
      <AgentCheckpointPanel
        isOpen={true}
        onClose={() => {}}
        engine={engine}
        agentEngine={agentEngine}
        availableRoots={[{ uuid: 'root-1', path: '/root' }]}
      />
    );
    fireEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => {
      expect(screen.getByTestId('save-form')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('save-submit'));
    await waitFor(() => {
      expect(engine.listCheckpoints().length).toBe(1);
    });
  });

  it('保存带名称和标签', async () => {
    agentEngine.addNode('root-1', 'root');
    render(
      <AgentCheckpointPanel
        isOpen={true}
        onClose={() => {}}
        engine={engine}
        agentEngine={agentEngine}
        availableRoots={[{ uuid: 'root-1', path: '/root' }]}
      />
    );
    fireEvent.click(screen.getByTestId('save-button'));
    fireEvent.change(screen.getByTestId('name-input'), { target: { value: 'my-checkpoint' } });
    fireEvent.change(screen.getByTestId('tags-input'), { target: { value: 'v1, stable' } });
    fireEvent.click(screen.getByTestId('save-submit'));
    await waitFor(() => {
      const cps = engine.listCheckpoints();
      expect(cps.length).toBe(1);
      expect(cps[0].name).toBe('my-checkpoint');
      expect(cps[0].tags).toEqual(['v1', 'stable']);
    });
  });

  it('点击列表项显示详情', async () => {
    agentEngine.addNode('root-1', 'root');
    const cp = engine.saveCheckpoint(agentEngine, 'root-1', { name: 'test-cp' });
    render(
      <AgentCheckpointPanel isOpen={true} onClose={() => {}} engine={engine} agentEngine={agentEngine} />
    );
    await waitFor(() => {
      expect(screen.getByTestId(`checkpoint-item-${cp.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`checkpoint-item-${cp.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('checkpoint-detail')).toBeTruthy();
    });
  });

  it('重命名检查点', async () => {
    agentEngine.addNode('root-1', 'root');
    const cp = engine.saveCheckpoint(agentEngine, 'root-1', { name: 'old' });
    render(
      <AgentCheckpointPanel isOpen={true} onClose={() => {}} engine={engine} agentEngine={agentEngine} />
    );
    await waitFor(() => {
      expect(screen.getByTestId(`checkpoint-item-${cp.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`checkpoint-item-${cp.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('checkpoint-detail')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('checkpoint-name'));
    const input = screen.getByTestId('rename-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'new-name' } });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(engine.getCheckpoint(cp.id)?.name).toBe('new-name');
    });
  });

  it('添加标签', async () => {
    agentEngine.addNode('root-1', 'root');
    const cp = engine.saveCheckpoint(agentEngine, 'root-1', { name: 'cp' });
    render(
      <AgentCheckpointPanel isOpen={true} onClose={() => {}} engine={engine} agentEngine={agentEngine} />
    );
    await waitFor(() => {
      expect(screen.getByTestId(`checkpoint-item-${cp.id}`)).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId(`checkpoint-item-${cp.id}`));
    await waitFor(() => {
      expect(screen.getByTestId('checkpoint-detail')).toBeTruthy();
    });
    const tagInput = screen.getByTestId('tag-input') as HTMLInputElement;
    fireEvent.change(tagInput, { target: { value: 'new-tag' } });
    fireEvent.click(screen.getByTestId('add-tag-button'));
    await waitFor(() => {
      expect(engine.getCheckpoint(cp.id)?.tags).toContain('new-tag');
    });
  });

  it('关闭按钮回调', () => {
    const onClose = vi.fn();
    render(<AgentCheckpointPanel isOpen={true} onClose={onClose} engine={engine} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalled();
  });

  it('清空所有检查点', async () => {
    agentEngine.addNode('root-1', 'root');
    engine.saveCheckpoint(agentEngine, 'root-1');
    render(<AgentCheckpointPanel isOpen={true} onClose={() => {}} engine={engine} agentEngine={agentEngine} />);
    await waitFor(() => {
      expect(engine.listCheckpoints().length).toBe(1);
    });
    fireEvent.click(screen.getByTestId('clear-all-button'));
    await waitFor(() => {
      expect(engine.listCheckpoints().length).toBe(0);
    });
  });
});
