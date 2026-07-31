/**
 * # ============================================================
 * # HumanApprovalPanel - 人机协作审批面板 (v1.0.0 Cycle 38 G38-04)
 * # ============================================================
 * # 核心作用：UI 面板，提供危险操作人工审批
 * #           风险分级 + 审批队列 + 审计日志
 * # 对标产品：Salesforce Flow Approvals / ServiceNow
 * # ============================================================
 */

import { useState, useEffect } from 'react';
import {
  HumanApprovalEngine,
  type ApprovalRequest,
  type OperationDescriptor,
  type RiskLevel,
  type OperationType,
  type ApproverRole,
  type AuditLogEntry,
} from '../utils/humanApprovalEngine';

export interface HumanApprovalPanelProps {
  onClose?: () => void;
}

type TabType = 'overview' | 'submit' | 'pending' | 'history' | 'audit' | 'policies';

const RISK_COLORS: Record<RiskLevel, string> = {
  safe: '#dcfce7',
  moderate: '#dbeafe',
  dangerous: '#fed7aa',
  critical: '#fecaca',
};

const RISK_LABELS: Record<RiskLevel, string> = {
  safe: '安全',
  moderate: '中等',
  dangerous: '高风险',
  critical: '极高',
};

export function HumanApprovalPanel({ onClose }: HumanApprovalPanelProps) {
  const [engine] = useState(() => new HumanApprovalEngine({ enableAutoExpiry: false }));
  const [tab, setTab] = useState<TabType>('overview');
  const [opType, setOpType] = useState<OperationType>('file_access');
  const [opName, setOpName] = useState('delete_temp_file');
  const [opArgs, setOpArgs] = useState('{"path":"/tmp/test.txt"}');
  const [reversible, setReversible] = useState(true);
  const [impact, setImpact] = useState('删除临时文件');
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [auditLog, setAuditLog] = useState<AuditLogEntry[]>([]);
  const [stats, setStats] = useState(engine.getStats());

  useEffect(() => {
    const refresh = () => {
      setRequests(engine.listRequests());
      setAuditLog(engine.getAuditLog());
      setStats(engine.getStats());
    };
    refresh();
    const interval = setInterval(refresh, 1500);
    return () => clearInterval(interval);
  }, [engine]);

  const handleSubmit = async () => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(opArgs);
    } catch {
      alert('参数 JSON 格式错误');
      return;
    }
    const op: OperationDescriptor = {
      type: opType,
      name: opName,
      args,
      reversible,
      estimatedImpact: impact,
    };
    await engine.submitForApproval(op);
    setRequests(engine.listRequests());
    setStats(engine.getStats());
  };

  const handleApprove = (id: string) => {
    try {
      engine.approve(id, 'admin-ui', 'admin', 'UI 审批通过');
    } catch (err) {
      alert(`审批失败：${(err as Error).message}`);
    }
  };

  const handleReject = (id: string) => {
    const reason = prompt('拒绝原因：');
    if (reason === null) return;
    try {
      engine.reject(id, 'admin-ui', 'admin', reason);
    } catch (err) {
      alert(`拒绝失败：${(err as Error).message}`);
    }
  };

  const pendingRequests = requests.filter((r) => r.status === 'pending');
  const resolvedRequests = requests.filter((r) => r.status !== 'pending' && r.status !== 'auto-approved');

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
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>🛡️ 人机协作审批</h2>
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
        {(['overview', 'submit', 'pending', 'history', 'audit', 'policies'] as TabType[]).map((t) => (
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
            {t === 'overview' ? '概览' : t === 'submit' ? '提交' : t === 'pending' ? '待审批' : t === 'history' ? '历史' : t === 'audit' ? '审计' : '策略'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {tab === 'overview' && (
          <div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 8,
                marginBottom: 12,
              }}
            >
              {(['safe', 'moderate', 'dangerous', 'critical'] as RiskLevel[]).map((level) => (
                <div
                  key={level}
                  style={{
                    padding: 10,
                    background: RISK_COLORS[level],
                    borderRadius: 6,
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{RISK_LABELS[level]}</div>
                  <div style={{ fontSize: 20, fontWeight: 600, color: '#1f2937' }}>
                    {stats.byRiskLevel[level] ?? 0}
                  </div>
                </div>
              ))}
            </div>
            <div
              style={{
                padding: 12,
                background: '#eff6ff',
                borderRadius: 6,
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280' }}>总请求</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#1e40af' }}>
                {stats.totalRequests}
              </div>
            </div>
            <div
              style={{
                padding: 12,
                background: '#fef3c7',
                borderRadius: 6,
              }}
            >
              <div style={{ fontSize: 12, color: '#6b7280' }}>待审批</div>
              <div style={{ fontSize: 24, fontWeight: 600, color: '#b45309' }}>
                {stats.pendingCount}
              </div>
            </div>
          </div>
        )}

        {tab === 'submit' && (
          <div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                操作类型
              </label>
              <select
                value={opType}
                onChange={(e) => setOpType(e.target.value as OperationType)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                }}
              >
                <option value="tool_call">工具调用</option>
                <option value="file_access">文件访问</option>
                <option value="system_command">系统命令</option>
                <option value="network_request">网络请求</option>
                <option value="agent_action">Agent 动作</option>
                <option value="llm_output">LLM 输出</option>
              </select>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                操作名称
              </label>
              <input
                type="text"
                value={opName}
                onChange={(e) => setOpName(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                参数（JSON）
              </label>
              <textarea
                value={opArgs}
                onChange={(e) => setOpArgs(e.target.value)}
                style={{
                  width: '100%',
                  minHeight: 50,
                  padding: 8,
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  boxSizing: 'border-box',
                  fontFamily: 'monospace',
                }}
              />
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280' }}>
                <input
                  type="checkbox"
                  checked={reversible}
                  onChange={(e) => setReversible(e.target.checked)}
                />
                可逆
              </label>
            </div>
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 4 }}>
                预计影响
              </label>
              <input
                type="text"
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <button
              onClick={handleSubmit}
              style={{
                padding: '8px 16px',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              提交审批
            </button>
          </div>
        )}

        {tab === 'pending' && (
          <div>
            {pendingRequests.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>暂无待审批请求</div>
            )}
            {pendingRequests.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 4,
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.title}</div>
                  <span
                    style={{
                      padding: '2px 6px',
                      background: RISK_COLORS[r.riskLevel],
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    {RISK_LABELS[r.riskLevel]}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{r.description}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  需要 {r.requiredApprovers} 人审批 | 当前 {r.currentApprovals.length}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    onClick={() => handleApprove(r.id)}
                    style={{
                      padding: '4px 10px',
                      background: '#10b981',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    批准
                  </button>
                  <button
                    onClick={() => handleReject(r.id)}
                    style={{
                      padding: '4px 10px',
                      background: '#ef4444',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: 'pointer',
                      fontSize: 12,
                    }}
                  >
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div>
            {resolvedRequests.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>暂无历史</div>
            )}
            {resolvedRequests.map((r) => (
              <div
                key={r.id}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{r.title}</div>
                  <span
                    style={{
                      padding: '2px 6px',
                      background:
                        r.status === 'approved' ? '#dcfce7' : r.status === 'rejected' ? '#fecaca' : '#e5e7eb',
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    {r.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  {new Date(r.resolvedAt ?? 0).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'audit' && (
          <div>
            {auditLog.length === 0 && (
              <div style={{ color: '#6b7280', fontSize: 13 }}>暂无审计日志</div>
            )}
            {auditLog
              .slice()
              .reverse()
              .map((e) => (
                <div
                  key={e.id}
                  style={{
                    padding: 8,
                    borderLeft: '3px solid ' + (e.result === 'success' ? '#10b981' : e.result === 'denied' ? '#ef4444' : '#f59e0b'),
                    background: '#f9fafb',
                    borderRadius: 4,
                    marginBottom: 6,
                    fontSize: 12,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {e.action} | {e.actor}
                  </div>
                  <div style={{ color: '#6b7280' }}>
                    {new Date(e.timestamp).toLocaleString()} | {e.result}
                  </div>
                </div>
              ))}
          </div>
        )}

        {tab === 'policies' && (
          <div>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 12 }}>
              当前风险等级策略：
            </p>
            {(['safe', 'moderate', 'dangerous', 'critical'] as RiskLevel[]).map((level) => (
              <div
                key={level}
                style={{
                  padding: 10,
                  border: '1px solid #e5e7eb',
                  borderRadius: 6,
                  marginBottom: 8,
                  fontSize: 13,
                }}
              >
                <div style={{ fontWeight: 600 }}>{RISK_LABELS[level]}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  自动审批：{level === 'safe' ? '是' : '否'} | 需要{' '}
                  {level === 'safe' ? 0 : level === 'critical' ? 2 : 1} 人
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default HumanApprovalPanel;
