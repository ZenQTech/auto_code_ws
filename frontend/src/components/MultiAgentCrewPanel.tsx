/**
 * # ============================================================
 * # MultiAgentCrewPanel - 多 Agent 协作面板 (v1.0.0 Cycle 38 G38-01)
 * # ============================================================
 * # 核心作用：UI 面板，提供 Manager-Worker 多 Agent 协作
 * #           任务分解 → Worker 调度 → 结果融合
 * # 对标产品：AutoGen / LangGraph / CrewAI
 * # ============================================================
 */

import { useState, useEffect, useCallback } from 'react';
import {
  MultiAgentEngine,
  type AgentDefinition,
  type AgentRole,
  type Crew,
  type CrewResult,
  type TaskDefinition,
} from '../utils/multiAgentEngine';

export interface MultiAgentCrewPanelProps {
  onClose?: () => void;
}

type TabType = 'overview' | 'agents' | 'crews' | 'execute' | 'history';

const DEFAULT_AGENT_TEMPLATES: AgentDefinition[] = [
  {
    id: 'researcher',
    name: '研究员',
    role: 'worker',
    capabilities: [
      { name: 'search', proficiency: 0.9 },
      { name: 'analyze', proficiency: 0.85 },
      { name: 'summarize', proficiency: 0.8 },
    ],
    systemPrompt: '你是一名研究员，擅长信息收集和数据分析。',
  },
  {
    id: 'coder',
    name: '程序员',
    role: 'worker',
    capabilities: [
      { name: 'code', proficiency: 0.95 },
      { name: 'debug', proficiency: 0.85 },
      { name: 'refactor', proficiency: 0.8 },
    ],
    systemPrompt: '你是一名程序员，擅长编写高质量代码。',
  },
  {
    id: 'reviewer',
    name: '审核员',
    role: 'reviewer',
    capabilities: [
      { name: 'review', proficiency: 0.9 },
      { name: 'test', proficiency: 0.85 },
      { name: 'feedback', proficiency: 0.8 },
    ],
    systemPrompt: '你是一名审核员，擅长发现问题和提供改进建议。',
  },
];

export function MultiAgentCrewPanel({ onClose }: MultiAgentCrewPanelProps) {
  const [engine] = useState(() => new MultiAgentEngine({ maxConcurrentTasks: 3 }));
  const [tab, setTab] = useState<TabType>('overview');
  const [crewName, setCrewName] = useState('default_crew');
  const [taskGoal, setTaskGoal] = useState('分析当前代码库性能瓶颈并提出优化建议');
  const [isRunning, setIsRunning] = useState(false);
  const [currentResult, setCurrentResult] = useState<CrewResult | null>(null);
  const [history, setHistory] = useState<CrewResult[]>([]);
  const [messageCount, setMessageCount] = useState(0);

  // 初始化默认 Agent
  useEffect(() => {
    for (const tpl of DEFAULT_AGENT_TEMPLATES) {
      if (!engine.getAgent(tpl.id)) {
        engine.registerAgent(tpl);
      }
    }
  }, [engine]);

  // 订阅消息
  useEffect(() => {
    const bus = engine.getMessageBus();
    const off = bus.subscribe('observer', () => {
      setMessageCount(bus.size());
    });
    return off;
  }, [engine]);

  const handleCreateCrew = useCallback(() => {
    const agents = engine.listAgents();
    if (agents.length < 2) {
      alert('至少需要 2 个 Agent 才能创建 Crew');
      return;
    }
    const tasks: TaskDefinition[] = [
      {
        id: 'task-1',
        title: '分析任务',
        description: taskGoal,
        requiredCapabilities: ['analyze'],
        priority: 'high',
      },
      {
        id: 'task-2',
        title: '执行任务',
        description: '基于分析结果执行具体操作',
        requiredCapabilities: ['code', 'search'],
        priority: 'high',
        dependencies: ['task-1'],
      },
      {
        id: 'task-3',
        title: '审核输出',
        description: '对结果进行质量审核',
        requiredCapabilities: ['review'],
        priority: 'normal',
        dependencies: ['task-2'],
      },
    ];
    engine.createCrew({
      name: crewName,
      description: `Crew ${crewName}`,
      agents,
      tasks,
      executionMode: 'parallel',
    });
    alert(`Crew ${crewName} 已创建`);
  }, [engine, crewName, taskGoal]);

  const handleExecute = useCallback(async () => {
    const crews = engine.listCrews();
    if (crews.length === 0) {
      alert('请先创建 Crew');
      return;
    }
    if (isRunning) return;
    setIsRunning(true);
    try {
      const crew = crews[0];
      const result = await engine.executeCrew(crew.id, {
        onTaskStart: () => {},
        onTaskComplete: () => {},
      });
      setCurrentResult(result);
      setHistory((prev) => [result, ...prev].slice(0, 10));
    } catch (err) {
      console.error('执行失败:', err);
    } finally {
      setIsRunning(false);
    }
  }, [engine, isRunning]);

  const agents = engine.listAgents();
  const crews = engine.listCrews();

  return (
    <div
      style={{
        padding: 16,
        background: '#fff',
        borderRadius: 8,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          borderBottom: '1px solid #e5e7eb',
          paddingBottom: 12,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>👥 多 Agent 协作</h2>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              padding: '4px 12px',
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            关闭
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['overview', 'agents', 'crews', 'execute', 'history'] as TabType[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 12px',
              background: tab === t ? '#3b82f6' : '#f3f4f6',
              color: tab === t ? '#fff' : '#374151',
              border: '1px solid ' + (tab === t ? '#3b82f6' : '#d1d5db'),
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            {t === 'overview' ? '概览' : t === 'agents' ? 'Agent' : t === 'crews' ? 'Crew' : t === 'execute' ? '执行' : '历史'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'overview' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            <div style={{ padding: 12, background: '#eff6ff', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Agent 数</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#1e40af' }}>{agents.length}</div>
            </div>
            <div style={{ padding: 12, background: '#fef3c7', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Crew 数</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#b45309' }}>{crews.length}</div>
            </div>
            <div style={{ padding: 12, background: '#dcfce7', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>消息数</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#15803d' }}>{messageCount}</div>
            </div>
            <div style={{ padding: 12, background: '#fce7f3', borderRadius: 6 }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>历史执行</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#be185d' }}>{history.length}</div>
            </div>
          </div>
        )}

        {tab === 'agents' && (
          <div>
            <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>已注册 Agent</h3>
            {agents.map((a) => (
              <div
                key={a.id}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>角色：{a.role}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>能力：{a.capabilities.join(', ')}</div>
              </div>
            ))}
          </div>
        )}

        {tab === 'crews' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                value={crewName}
                onChange={(e) => setCrewName(e.target.value)}
                placeholder="Crew 名称"
                style={{
                  flex: 1,
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                }}
              />
              <button
                onClick={handleCreateCrew}
                style={{
                  padding: '6px 12px',
                  background: '#3b82f6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                创建 Crew
              </button>
            </div>
            {crews.map((c) => (
              <div
                key={c.id}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>状态：{c.status}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Worker 数：{c.agents.filter((a) => a.role === 'worker').length}</div>
              </div>
            ))}
          </div>
        )}

        {tab === 'execute' && (
          <div>
            <textarea
              value={taskGoal}
              onChange={(e) => setTaskGoal(e.target.value)}
              placeholder="任务目标"
              style={{
                width: '100%',
                minHeight: 80,
                padding: 8,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                fontSize: 13,
                marginBottom: 8,
                boxSizing: 'border-box',
              }}
            />
            <button
              onClick={handleExecute}
              disabled={isRunning}
              style={{
                padding: '8px 16px',
                background: isRunning ? '#9ca3af' : '#10b981',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: isRunning ? 'not-allowed' : 'pointer',
                marginBottom: 12,
              }}
            >
              {isRunning ? '执行中…' : '启动执行'}
            </button>
            {currentResult && (
              <div
                style={{
                  padding: 10,
                  background: '#f9fafb',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  执行结果：成功 {currentResult.successfulTasks}/{currentResult.totalTasks}
                </div>
                <div style={{ color: '#6b7280' }}>耗时：{currentResult.totalDurationMs}ms</div>
                <div style={{ color: '#6b7280' }}>
                  任务数：{currentResult.taskResults?.length ?? 0}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'history' && (
          <div>
            {history.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>暂无历史执行</div>
            )}
            {history.map((r, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>#{i + 1} · 成功 {r.successfulTasks}/{r.totalTasks}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>耗时：{r.totalDurationMs}ms</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MultiAgentCrewPanel;
