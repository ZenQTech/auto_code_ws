/**
 * # ============================================================
 * # AgentLoopPanel - 智能体循环面板 (v1.0.0 Cycle 37 G37-03)
 * # ============================================================
 * # 核心作用：UI 面板，提供 ReAct / Plan-Execute 智能体循环
 * #           展示 Thought / Action / Observation 决策链路
 * # ============================================================
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AgentLoopEngine,
  createAgentLoopEngine,
  AgentState,
  AgentStep,
} from '../utils/agentLoopEngine';
import { getDefaultLLMProviderRegistry, MockProvider } from '../utils/llmProviderAdapter';
import { createToolUseEngine, registerBuiltinTools } from '../utils/toolUseEngine';

export interface AgentLoopPanelProps {
  initialEngine?: AgentLoopEngine;
  onClose?: () => void;
}

type TabType = 'run' | 'history' | 'checkpoints' | 'stats';

export function AgentLoopPanel({ initialEngine, onClose }: AgentLoopPanelProps) {
  const [engine] = useState(() => {
    if (initialEngine) return initialEngine;
    // 默认创建
    const registry = getDefaultLLMProviderRegistry();
    if (!registry.get('mock')) {
      registry.register('mock', new MockProvider());
    }
    const toolEngine = createToolUseEngine({ maxRetries: 0, timeoutMs: 5000 });
    registerBuiltinTools(toolEngine);
    return createAgentLoopEngine({
      llmProvider: registry.get('mock')!,
      toolEngine,
    });
  });

  const [tab, setTab] = useState<TabType>('run');
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<'react' | 'plan-execute'>('react');
  const [isRunning, setIsRunning] = useState(false);
  const [currentState, setCurrentState] = useState<AgentState | null>(null);
  const [history, setHistory] = useState<AgentState[]>([]);
  const [checkpoints, setCheckpoints] = useState<{ id: string; description?: string; step: number; createdAt: number }[]>([]);

  const [stats, setStats] = useState({
    totalRuns: 0,
    successRuns: 0,
    failedRuns: 0,
    avgDurationMs: 0,
  });

  const handleRun = async () => {
    if (!goal.trim() || isRunning) return;
    setIsRunning(true);
    setCurrentState(null);
    try {
      const state = mode === 'react'
        ? await engine.runReact(goal, { autoCheckpoint: true })
        : await engine.runPlanExecute(goal, { autoCheckpoint: true });
      setCurrentState(state);
      setHistory(prev => [state, ...prev].slice(0, 10));
      setCheckpoints(engine.listCheckpoints(state.agentId).map(cp => ({
        id: cp.id || '',
        description: cp.description,
        step: cp.state.currentStep,
        createdAt: cp.createdAt,
      })));
    } catch (err) {
      console.error('运行失败:', err);
    } finally {
      setIsRunning(false);
    }
  };

  useEffect(() => {
    setStats(engine.getStats());
  }, [engine, history, currentState]);

  return (
    <div style={{ padding: 16, background: '#fff', borderRadius: 8, height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, borderBottom: '1px solid #e5e7eb', paddingBottom: 12 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🤖 智能体循环</h2>
        {onClose && <button onClick={onClose} style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}>关闭</button>}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['run', 'history', 'checkpoints', 'stats'] as TabType[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              background: tab === t ? '#3b82f6' : '#f3f4f6',
              color: tab === t ? '#fff' : '#374151',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t === 'run' ? '运行' : t === 'history' ? '历史' : t === 'checkpoints' ? '检查点' : '统计'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {tab === 'run' && (
          <div>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, display: 'block', marginBottom: 4 }}>目标：</label>
              <textarea
                value={goal}
                onChange={e => setGoal(e.target.value)}
                placeholder="输入智能体要完成的目标..."
                style={{ width: '100%', minHeight: 60, padding: 6, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, resize: 'vertical' }}
              />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, marginRight: 8 }}>模式：</label>
              <select
                value={mode}
                onChange={e => setMode(e.target.value as 'react' | 'plan-execute')}
                style={{ padding: 4, border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13 }}
              >
                <option value="react">ReAct（Reason + Act）</option>
                <option value="plan-execute">Plan-Execute（规划+执行）</option>
              </select>
            </div>

            <button
              onClick={handleRun}
              disabled={!goal.trim() || isRunning}
              style={{ padding: '6px 12px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13 }}
            >
              {isRunning ? '运行中...' : '开始运行'}
            </button>

            {currentState && (
              <div style={{ marginTop: 16 }}>
                <div style={{ padding: 10, background: currentState.status === 'completed' ? '#f0fdf4' : currentState.status === 'failed' ? '#fee2e2' : '#fef3c7', borderRadius: 6, border: '1px solid #d1d5db', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
                    状态: {currentState.status} · 步数: {currentState.currentStep} · 终止原因: {currentState.terminationReason || 'N/A'}
                  </div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>
                    耗时: {currentState.completedAt ? currentState.completedAt - currentState.startedAt : 0}ms
                  </div>
                </div>

                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>决策链路</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {currentState.history.map((step: AgentStep) => (
                    <div key={step.id} style={{
                      padding: 8,
                      background: step.type === 'thought' ? '#eff6ff' : step.type === 'action' ? '#fef3c7' : step.type === 'observation' ? '#f0fdf4' : '#fce7f3',
                      borderRadius: 4,
                      border: '1px solid #d1d5db',
                      fontSize: 12,
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        {step.type === 'thought' ? '💭 Thought' :
                          step.type === 'action' ? '⚡ Action' :
                            step.type === 'observation' ? '👁️ Observation' :
                              step.type === 'final' ? '✅ Final' : '📋 Plan'}
                        <span style={{ marginLeft: 6, color: '#6b7280', fontWeight: 400 }}>步骤 {step.index}</span>
                      </div>
                      <div style={{ color: '#1f2937' }}>{step.content}</div>
                      {step.toolCall && (
                        <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>
                          工具: {step.toolCall.name}({JSON.stringify(step.toolCall.arguments)})
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {history.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>暂无历史</p>
            ) : (
              history.map((state, i) => (
                <div key={state.agentId} style={{ padding: 10, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>#{i + 1} · {state.mode} · {state.status}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>目标: {state.goal}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>步数: {state.currentStep} · 终止: {state.terminationReason}</div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'checkpoints' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {checkpoints.length === 0 ? (
              <p style={{ color: '#6b7280', fontSize: 13 }}>暂无检查点</p>
            ) : (
              checkpoints.map(cp => (
                <div key={cp.id} style={{ padding: 10, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{cp.description || 'Auto-checkpoint'}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                    步骤: {cp.step} · 时间: {new Date(cp.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'stats' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <StatCard label="总运行" value={stats.totalRuns} />
            <StatCard label="成功" value={stats.successRuns} />
            <StatCard label="失败" value={stats.failedRuns} />
            <StatCard label="平均耗时" value={`${stats.avgDurationMs}ms`} />
            <StatCard label="历史记录" value={history.length} />
            <StatCard label="检查点" value={checkpoints.length} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ padding: 12, background: '#f9fafb', borderRadius: 6, border: '1px solid #e5e7eb' }}>
      <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 600, color: '#1f2937' }}>{value}</div>
    </div>
  );
}

export default AgentLoopPanel;
