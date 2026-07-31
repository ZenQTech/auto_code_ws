/**
 * # ============================================================
 * # McpE2EPanel - MCP 端到端测试面板 (v1.0.0 Cycle 43 G43-04)
 * # ============================================================
 * # 核心作用：MCP × Hermes 端到端 E2E 测试套件的可视化入口
 * #           - 运行 5 大标准 E2E 场景
 * #           - 实时展示测试结果与统计
 * #           - 支持选择 LLM Provider（Mock / 火山方舟 Coding Plan）
 * # ====================================
 * # 修改记录：
 * #   - 2026-07-31 | v1.0.0 | Cycle 43 G43-04 初次创建
 * # ====================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  createE2ETestSuite,
  DEFAULT_E2E_SCENARIOS,
  type E2ETestResult,
  type McpE2ETestSuite,
} from '../utils/mcpE2ETestSuite';
import {
  createVolcengineCodingPlanProvider,
  MockVolcengineCodingPlanProvider,
  type VolcengineCodingPlanProvider,
} from '../utils/volcengineCodingPlanProvider';

export interface McpE2EPanelProps {
  onClose: () => void;
}

type ProviderChoice = 'mock' | 'volcengine';

export function McpE2EPanel({ onClose }: McpE2EPanelProps) {
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('mock');
  const [running, setRunning] = useState<boolean>(false);
  const [results, setResults] = useState<E2ETestResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string>('');
  const suiteRef = useRef<McpE2ETestSuite | null>(null);

  // 启动测试
  const handleRunAll = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setResults([]);
    setProgress('初始化 E2E 测试套件...');

    let suite: McpE2ETestSuite | null = null;
    try {
      // 创建 LLM provider
      const llm =
        providerChoice === 'volcengine'
          ? createVolcengineCodingPlanProvider({ forceMock: true })
          : new MockVolcengineCodingPlanProvider();

      suite = createE2ETestSuite({ llmProvider: llm });
      suiteRef.current = suite;
      await suite.initialize();
      setProgress('运行测试场景...');

      const allResults: E2ETestResult[] = [];
      for (let i = 0; i < DEFAULT_E2E_SCENARIOS.length; i++) {
        const scenario = DEFAULT_E2E_SCENARIOS[i];
        setProgress(`运行场景 ${i + 1}/${DEFAULT_E2E_SCENARIOS.length}: ${scenario.name}`);
        const r = await suite.runScenario(scenario);
        allResults.push(r);
        setResults([...allResults]);
      }
      setProgress('完成');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (suiteRef.current) {
        await suiteRef.current.dispose().catch(() => {});
        suiteRef.current = null;
      }
      setRunning(false);
    }
  }, [providerChoice, running]);

  // 卸载时清理
  useEffect(() => {
    return () => {
      if (suiteRef.current) {
        suiteRef.current.dispose().catch(() => {});
      }
    };
  }, []);

  // 统计
  const stats = useMemo(() => {
    const passed = results.filter((r) => r.success).length;
    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: results.length === 0 ? 0 : passed / results.length,
      totalDurationMs: results.reduce((acc, r) => acc + r.durationMs, 0),
    };
  }, [results]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#1e1e1e',
          color: '#e0e0e0',
          borderRadius: '12px',
          width: '100%',
          maxWidth: '1100px',
          height: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          style={{
            padding: '16px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <h2 style={{ margin: 0, fontSize: '18px' }}>🧪 MCP E2E 测试套件 (McpE2ETestSuite)</h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
              MCP × Hermes 端到端集成测试 · 5 大场景 · 真实 LLM + 真实 MCP 服务器
            </p>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#888',
              fontSize: '24px',
              cursor: 'pointer',
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        {/* 控制区 */}
        <div
          style={{
            padding: '12px 20px',
            borderBottom: '1px solid #333',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            flexWrap: 'wrap',
          }}
        >
          <label style={{ fontSize: '13px' }}>LLM Provider:</label>
          <select
            value={providerChoice}
            onChange={(e) => setProviderChoice(e.target.value as ProviderChoice)}
            disabled={running}
            style={{
              padding: '4px 8px',
              background: '#2a2a2a',
              color: '#e0e0e0',
              border: '1px solid #444',
              borderRadius: '4px',
            }}
          >
            <option value="mock">Mock (沙箱默认)</option>
            <option value="volcengine">火山方舟 Coding Plan</option>
          </select>
          <button
            onClick={handleRunAll}
            disabled={running}
            style={{
              padding: '6px 16px',
              background: running ? '#555' : '#1976d2',
              color: '#fff',
              border: 'none',
              borderRadius: '4px',
              cursor: running ? 'not-allowed' : 'pointer',
              fontSize: '13px',
            }}
          >
            {running ? '运行中...' : '▶ 运行全部场景'}
          </button>
          {progress && (
            <span style={{ fontSize: '12px', color: '#888' }}>{progress}</span>
          )}
        </div>

        {/* 统计 */}
        <div
          style={{
            padding: '8px 20px',
            background: '#252525',
            fontSize: '12px',
            color: '#aaa',
            display: 'flex',
            gap: '20px',
          }}
        >
          <span>总计: {stats.total}</span>
          <span style={{ color: '#4caf50' }}>通过: {stats.passed}</span>
          <span style={{ color: stats.failed > 0 ? '#f44336' : '#888' }}>
            失败: {stats.failed}
          </span>
          <span>通过率: {(stats.passRate * 100).toFixed(1)}%</span>
          <span>耗时: {stats.totalDurationMs}ms</span>
        </div>

        {/* 错误提示 */}
        {error && (
          <div
            style={{
              padding: '8px 20px',
              background: '#4a1f1f',
              color: '#f88',
              fontSize: '12px',
              borderBottom: '1px solid #333',
            }}
          >
            ⚠ 错误: {error}
          </div>
        )}

        {/* 场景列表 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px 20px' }}>
          <h3 style={{ fontSize: '14px', margin: '0 0 8px' }}>标准 E2E 场景</h3>
          {DEFAULT_E2E_SCENARIOS.map((scenario, idx) => {
            const result = results.find((r) => r.scenario === scenario.type);
            return (
              <div
                key={scenario.type}
                style={{
                  background: '#252525',
                  border: '1px solid #333',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  marginBottom: '8px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: '20px',
                        height: '20px',
                        borderRadius: '50%',
                        background: result
                          ? result.success
                            ? '#4caf50'
                            : '#f44336'
                          : '#555',
                        color: '#fff',
                        textAlign: 'center',
                        lineHeight: '20px',
                        fontSize: '11px',
                      }}
                    >
                      {idx + 1}
                    </span>
                    <strong style={{ fontSize: '13px' }}>{scenario.name}</strong>
                    <code style={{ fontSize: '11px', color: '#888' }}>{scenario.type}</code>
                  </div>
                  {result && (
                    <span style={{ fontSize: '11px', color: '#888' }}>
                      {result.durationMs}ms
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '11px', color: '#aaa', marginBottom: '4px' }}>
                  {scenario.description}
                </div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#888',
                    fontFamily: 'monospace',
                    background: '#1a1a1a',
                    padding: '4px 8px',
                    borderRadius: '4px',
                  }}
                >
                  用户输入: {scenario.userMessage}
                </div>
                {result?.error && (
                  <div
                    style={{
                      fontSize: '11px',
                      color: '#f88',
                      marginTop: '4px',
                    }}
                  >
                    错误: {result.error}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default McpE2EPanel;
