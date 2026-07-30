/**
 * # ============================================================
 * # Usage Attribution Panel - 用量归因 UI (v1.0.0 Cycle 28 G28-03)
 * # ============================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getDefaultUsageAttributionEngine } from '../utils/usageAttributionEngine';
import { AttributionReport } from '../utils/usageAttributionEngine';

interface UsageAttributionPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export const UsageAttributionPanel: React.FC<UsageAttributionPanelProps> = ({ isOpen, onClose }) => {
  const engine = useMemo(() => getDefaultUsageAttributionEngine(), []);
  const [refreshKey, setRefreshKey] = useState(0);
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [exportedJson, setExportedJson] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setReport(engine.generateReport());
  }, [isOpen, refreshKey, engine]);

  const handleExport = () => {
    setExportedJson(engine.exportJson());
  };

  const handleAddMock = () => {
    engine.addRecord({
      timestamp: Date.now(),
      agentPath: '/root/' + Math.random().toString(36).slice(2, 6),
      taskId: 'task-' + Math.random().toString(36).slice(2, 6),
      sessionId: 'session-' + Math.random().toString(36).slice(2, 6),
      modelId: Math.random() > 0.5 ? 'gpt-5.3-codex' : 'claude-sonnet-4.6',
      inputTokens: Math.floor(Math.random() * 5000) + 500,
      outputTokens: Math.floor(Math.random() * 3000) + 200,
      costUsd: Math.random() * 0.1,
    });
    setRefreshKey((k) => k + 1);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="usage-attribution-panel">
      <div className="bg-white rounded-lg shadow-xl w-[960px] max-w-[95vw] h-[680px] max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">📊</span>
            <h2 className="text-lg font-semibold">用量归因 (Usage Attribution)</h2>
            <span className="text-xs text-gray-500">JSON report / 计费 chargeback</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" data-testid="usage-attribution-close">✕</button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {report && (
            <div className="space-y-4" data-testid="usage-attribution-content">
              <div className="flex gap-2">
                <button onClick={handleAddMock} className="px-3 py-1 bg-indigo-500 text-white rounded text-sm" data-testid="usage-attribution-add-mock">+ 添加测试记录</button>
                <button onClick={handleExport} className="px-3 py-1 bg-gray-100 border rounded text-sm" data-testid="usage-attribution-export">导出 JSON</button>
              </div>

              <div className="grid grid-cols-5 gap-2">
                <Stat label="记录数" value={report.summary.recordCount} />
                <Stat label="输入 tokens" value={report.summary.totalInputTokens.toLocaleString()} />
                <Stat label="输出 tokens" value={report.summary.totalOutputTokens.toLocaleString()} />
                <Stat label="总 tokens" value={report.summary.totalTokens.toLocaleString()} />
                <Stat label="总成本" value={`$${report.summary.totalCostUsd.toFixed(4)}`} color="green" />
              </div>

              <Section title="按 Agent 拆分">
                <Table headers={['Agent Path', 'Cost', 'Tokens', 'Records']}>
                  {report.byAgent.map((r) => (
                    <tr key={r.agentPath}>
                      <td className="px-2 py-1 font-mono text-xs">{r.agentPath}</td>
                      <td className="px-2 py-1 text-right">${r.costUsd.toFixed(4)}</td>
                      <td className="px-2 py-1 text-right">{r.tokens.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{r.recordCount}</td>
                    </tr>
                  ))}
                </Table>
              </Section>

              <Section title="按 Model 拆分">
                <Table headers={['Model', 'Cost', 'Tokens', 'Records']}>
                  {report.byModel.map((r) => (
                    <tr key={r.modelId}>
                      <td className="px-2 py-1 font-mono text-xs">{r.modelId}</td>
                      <td className="px-2 py-1 text-right">${r.costUsd.toFixed(4)}</td>
                      <td className="px-2 py-1 text-right">{r.tokens.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right">{r.recordCount}</td>
                    </tr>
                  ))}
                </Table>
              </Section>

              {exportedJson && (
                <Section title="JSON 报告">
                  <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto max-h-60">{exportedJson}</pre>
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string | number; color?: string }> = ({ label, value, color }) => (
  <div className="border rounded p-2 text-center">
    <div className="text-xs text-gray-500">{label}</div>
    <div className={`text-lg font-bold ${color === 'green' ? 'text-green-600' : 'text-gray-700'}`}>{value}</div>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="border rounded p-3">
    <h3 className="text-sm font-semibold mb-2">{title}</h3>
    {children}
  </div>
);

const Table: React.FC<{ headers: string[]; children: React.ReactNode }> = ({ headers, children }) => (
  <table className="w-full text-sm">
    <thead>
      <tr className="border-b">
        {headers.map((h) => <th key={h} className="px-2 py-1 text-left text-xs text-gray-500">{h}</th>)}
      </tr>
    </thead>
    <tbody>{children}</tbody>
  </table>
);

export default UsageAttributionPanel;
