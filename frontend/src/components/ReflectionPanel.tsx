/**
 * # ============================================================
 * # ReflectionPanel - 反思与自我修正面板 (v1.0.0 Cycle 38 G38-03)
 * # ============================================================
 * # 核心作用：UI 面板，提供 Reflexion 风格 Agent 自我反思
 * #           执行 → 评估 → 反思 → 调整 → 重执行
 * # 对标产品：Reflexion (Stanford) / Self-Refine (MIT)
 * # ============================================================
 */

import { useState, useEffect } from 'react';
import {
  ReflectionEngine,
  type ReflexionSession,
  type Reflection,
  type TaskExecutionResult,
} from '../utils/reflectionEngine';

export interface ReflectionPanelProps {
  onClose?: () => void;
}

type TabType = 'run' | 'iterations' | 'reflections' | 'history';

export function ReflectionPanel({ onClose }: ReflectionPanelProps) {
  const [engine] = useState(() => new ReflectionEngine());
  const [tab, setTab] = useState<TabType>('run');
  const [task, setTask] = useState('设计一个高性能分布式缓存系统');
  const [qualityThreshold, setQualityThreshold] = useState(0.7);
  const [maxIterations, setMaxIterations] = useState(3);
  const [isRunning, setIsRunning] = useState(false);
  const [currentSession, setCurrentSession] = useState<ReflexionSession | null>(null);
  const [history, setHistory] = useState<ReflexionSession[]>([]);
  const [reflections, setReflections] = useState<Reflection[]>([]);

  useEffect(() => {
    setReflections(engine.getReflections());
  }, [engine, currentSession]);

  /**
   * 模拟执行器：根据策略生成对应质量的输出
   */
  const mockExecutor = async (strategy: string, iteration: number): Promise<TaskExecutionResult> => {
    // 模拟异步延迟
    await new Promise((r) => setTimeout(r, 100));
    // 每次迭代输出质量提升
    const qualityBoost = Math.min(0.95, 0.4 + iteration * 0.15);
    const outputLength = Math.floor(qualityBoost * 400);
    return {
      output: `${strategy}\n\n${'这是一个高质量的回答。'.repeat(Math.max(1, outputLength / 12))}`,
      success: qualityBoost > 0.5,
      durationMs: 100,
      steps: [
        { thought: '分析任务', action: 'plan', observation: '需要分布式架构' },
        { thought: '设计数据分片', action: 'design', observation: '采用一致性哈希' },
      ],
    };
  };

  const handleRun = async () => {
    if (!task.trim() || isRunning) return;
    setIsRunning(true);
    setCurrentSession(null);
    try {
      const session = await engine.executeWithReflection(task, mockExecutor, {
        qualityThreshold,
        maxIterations,
      });
      setCurrentSession(session);
      setHistory((prev) => [session, ...prev].slice(0, 10));
    } catch (err) {
      console.error('反思迭代失败:', err);
    } finally {
      setIsRunning(false);
    }
  };

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
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🔁 反思与自我修正</h2>
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
        {(['run', 'iterations', 'reflections', 'history'] as TabType[]).map((t) => (
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
            {t === 'run' ? '运行' : t === 'iterations' ? '迭代' : t === 'reflections' ? '反思' : '历史'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'run' && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                任务描述
              </label>
              <textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 60,
                  padding: 8,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                  质量阈值：{qualityThreshold}
                </label>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={qualityThreshold}
                  onChange={(e) => setQualityThreshold(parseFloat(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                  最大迭代：{maxIterations}
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  step="1"
                  value={maxIterations}
                  onChange={(e) => setMaxIterations(parseInt(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <button
              onClick={handleRun}
              disabled={isRunning}
              style={{
                padding: '8px 16px',
                background: isRunning ? '#9ca3af' : '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: isRunning ? 'not-allowed' : 'pointer',
              }}
            >
              {isRunning ? '执行中…' : '启动反思'}
            </button>

            {currentSession && (
              <div
                style={{
                  marginTop: 12,
                  padding: 12,
                  background: '#f0fdf4',
                  borderRadius: 6,
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>完成：{currentSession.terminationReason}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  迭代数：{currentSession.iterations.length}
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  耗时：{currentSession.totalDurationMs}ms
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'iterations' && (
          <div>
            {currentSession?.iterations.map((rec) => (
              <div
                key={rec.iteration}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>迭代 {rec.iteration}</div>
                  <div
                    style={{
                      padding: '2px 8px',
                      background:
                        rec.evaluation.score >= 0.8 ? '#dcfce7' : rec.evaluation.score >= 0.5 ? '#fef3c7' : '#fecaca',
                      color: '#1f2937',
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  >
                    {rec.evaluation.score.toFixed(2)}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  策略：{rec.strategy.slice(0, 80)}…
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  反思类型：{rec.reflection.type} | 情感：{rec.reflection.emotionalTone}
                </div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                  教训：{rec.reflection.lessonsLearned.join('; ')}
                </div>
              </div>
            ))}
            {!currentSession && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>请先运行反思</div>
            )}
          </div>
        )}

        {tab === 'reflections' && (
          <div>
            {reflections.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>暂无反思</div>
            )}
            {reflections.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>迭代 {r.iteration}</div>
                  <span
                    style={{
                      padding: '2px 6px',
                      background:
                        r.type === 'success' ? '#dcfce7' : r.type === 'failure' ? '#fecaca' : '#fef3c7',
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    {r.type}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>{r.evaluation}</div>
                <div style={{ fontSize: 12, color: '#374151', marginTop: 4 }}>
                  建议：{r.improvementSuggestions.join('; ')}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div>
            {history.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>暂无历史</div>
            )}
            {history.map((s) => (
              <div
                key={s.id}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.taskDescription.slice(0, 50)}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {s.terminationReason} | {s.iterations.length} 轮 | {s.totalDurationMs}ms
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default ReflectionPanel;
