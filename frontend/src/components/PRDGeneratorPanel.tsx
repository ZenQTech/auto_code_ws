/**
 * # ============================================================
 * # PRDGeneratorPanel 组件 (v1.0.0)
 * # Cycle 63 G63-01
 * # ====================================
 * # 核心作用：PRD 生成器 UI 面板
 * # 运行流程：
 * #   1. 用户输入自然语言需求
 * #   2. 调用 usePRDGenerator.generatePRD 生成结构化 PRD
 * #   3. 展示目标/场景/验收/任务/风险
 * #   4. 支持基于反馈迭代（生成新版本 + diff）
 * #   5. 支持历史版本切换
 * # 输入参数：testId, onPRDGenerated, onPRDIterated
 * # 输出结果：UI 组件
 * # 对标：Trae SOLO Builder / Codex sub-agent PRD 工作流
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-01 初次创建
 * # ====================================
 */

import { useEffect, useState } from 'react';
import { usePRDGenerator, type PRDDocument } from '../hooks/usePRDGenerator';

export interface PRDGeneratorPanelProps {
  testId?: string;
  onPRDGenerated?: (prd: PRDDocument) => void;
  onPRDIterated?: (prd: PRDDocument) => void;
}

const STAGE_LABELS: Record<string, { icon: string; label: string; color: string }> = {
  prd: { icon: '📋', label: '需求分析', color: 'var(--accent-primary)' },
  coding: { icon: '💻', label: '编码', color: 'var(--accent-success)' },
  preview: { icon: '👀', label: '预览', color: 'var(--accent-warning)' },
  deploy: { icon: '🚀', label: '部署', color: 'var(--accent-info)' },
};

const RISK_COLORS: Record<string, string> = {
  low: 'var(--accent-success)',
  medium: 'var(--accent-warning)',
  high: 'var(--accent-error)',
  extreme: 'var(--accent-error)',
};

export default function PRDGeneratorPanel(props: PRDGeneratorPanelProps) {
  const { testId = 'prd-generator-panel', onPRDGenerated, onPRDIterated } = props;
  const prdApi = usePRDGenerator({ autoRefreshMs: 0 });
  const [requirement, setRequirement] = useState('');
  const [feedback, setFeedback] = useState('');
  const [selectedStage, setSelectedStage] = useState<string | null>(null);

  useEffect(() => {
    prdApi.listPRDs();
    prdApi.loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    const prd = await prdApi.generatePRD({ requirement });
    if (prd && onPRDGenerated) {
      onPRDGenerated(prd);
    }
  };

  const handleIterate = async () => {
    if (!prdApi.currentPRD) return;
    const prd = await prdApi.iteratePRD(prdApi.currentPRD.prd_id, { feedback });
    if (prd && onPRDIterated) {
      onPRDIterated(prd);
    }
    setFeedback('');
  };

  const handleSelect = async (prdId: string) => {
    await prdApi.loadPRD(prdId, undefined, true);
  };

  const handleDelete = async (prdId: string) => {
    if (confirm('确定删除该 PRD？此操作不可恢复。')) {
      await prdApi.deletePRD(prdId);
    }
  };

  const handleStageFilter = (stage: string | null) => {
    setSelectedStage(stage);
  };

  // 过滤后的 PRD 列表（按创建阶段）
  const filteredPRDs = selectedStage
    ? prdApi.prds.filter((p) => p.current_version > 0)
    : prdApi.prds;

  return (
    <div
      data-testid={testId}
      className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)] rounded-lg overflow-hidden"
    >
      {/* 顶部：标题 + 统计 */}
      <div
        data-testid={`${testId}-header`}
        className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">📋</span>
          <h2 className="text-sm font-semibold">PRD 生成器</h2>
          {prdApi.stats && (
            <span
              data-testid={`${testId}-stats`}
              className="text-xs text-[var(--text-secondary)]"
            >
              {prdApi.stats.total_prds} 个 PRD · {prdApi.stats.total_versions} 个版本
            </span>
          )}
        </div>
        <button
          data-testid={`${testId}-refresh`}
          onClick={() => {
            prdApi.listPRDs();
            prdApi.loadStats();
          }}
          className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          disabled={prdApi.loading}
        >
          🔄 刷新
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* 左侧：PRD 列表 + 生成表单 */}
        <div
          data-testid={`${testId}-sidebar`}
          className="w-80 border-r border-[var(--border-color)] flex flex-col"
        >
          {/* 阶段过滤 */}
          <div
            data-testid={`${testId}-stage-filter`}
            className="px-3 py-2 border-b border-[var(--border-color)] flex gap-1 flex-wrap"
          >
            <button
              onClick={() => handleStageFilter(null)}
              data-testid={`${testId}-stage-all`}
              className={`px-2 py-0.5 text-xs rounded ${
                selectedStage === null
                  ? 'bg-[var(--accent-primary)] text-white'
                  : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
              }`}
            >
              全部
            </button>
            {Object.entries(STAGE_LABELS).map(([key, info]) => (
              <button
                key={key}
                onClick={() => handleStageFilter(key)}
                data-testid={`${testId}-stage-${key}`}
                className={`px-2 py-0.5 text-xs rounded flex items-center gap-1 ${
                  selectedStage === key
                    ? 'bg-[var(--accent-primary)] text-white'
                    : 'bg-[var(--bg-elevated)] text-[var(--text-secondary)]'
                }`}
              >
                <span>{info.icon}</span>
                {info.label}
              </button>
            ))}
          </div>

          {/* 生成表单 */}
          <div
            data-testid={`${testId}-generate-form`}
            className="px-3 py-3 border-b border-[var(--border-color)]"
          >
            <label className="text-xs text-[var(--text-secondary)] mb-1 block">
              自然语言需求（≥ 10 字符）
            </label>
            <textarea
              data-testid={`${testId}-requirement`}
              value={requirement}
              onChange={(e) => setRequirement(e.target.value)}
              placeholder="例如：实现一个支持多用户的实时协作笔记应用"
              className="w-full h-20 px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded resize-none focus:outline-none focus:border-[var(--accent-primary)]"
            />
            <button
              data-testid={`${testId}-generate-btn`}
              onClick={handleGenerate}
              disabled={prdApi.generating || requirement.trim().length < 10}
              className="mt-2 w-full px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
            >
              {prdApi.generating ? '生成中…' : '✨ 生成 PRD'}
            </button>
          </div>

          {/* PRD 列表 */}
          <div
            data-testid={`${testId}-prd-list`}
            className="flex-1 overflow-y-auto"
          >
            {prdApi.loading && filteredPRDs.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--text-secondary)]">加载中…</div>
            )}
            {!prdApi.loading && filteredPRDs.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--text-secondary)]">
                暂无 PRD，输入需求开始
              </div>
            )}
            {filteredPRDs.map((p) => (
              <div
                key={p.prd_id}
                data-testid={`${testId}-prd-item-${p.prd_id}`}
                onClick={() => handleSelect(p.prd_id)}
                className={`px-3 py-2 border-b border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-elevated)] ${
                  prdApi.currentPRD?.prd_id === p.prd_id ? 'bg-[var(--bg-elevated)]' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium truncate flex-1" title={p.title}>
                    {p.title}
                  </span>
                  <span className="text-xs text-[var(--text-secondary)] ml-2">v{p.current_version}</span>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-[var(--text-secondary)]">
                    {new Date(p.updated_at * 1000).toLocaleString()}
                  </span>
                  <button
                    data-testid={`${testId}-prd-delete-${p.prd_id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(p.prd_id);
                    }}
                    className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-error)]"
                  >
                    🗑️
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：PRD 详情 */}
        <div
          data-testid={`${testId}-detail`}
          className="flex-1 flex flex-col overflow-hidden"
        >
          {prdApi.error && (
            <div
              data-testid={`${testId}-error`}
              className="m-3 p-2 text-xs text-[var(--accent-error)] bg-[var(--bg-elevated)] rounded flex items-center justify-between"
            >
              <span>❌ {prdApi.error}</span>
              <button
                onClick={prdApi.clearError}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                ✕
              </button>
            </div>
          )}

          {!prdApi.currentPRD ? (
            <div
              data-testid={`${testId}-empty`}
              className="flex-1 flex items-center justify-center text-[var(--text-secondary)]"
            >
              <div className="text-center">
                <div className="text-4xl mb-2">📋</div>
                <p className="text-sm">选择左侧 PRD 查看详情，或输入需求生成新 PRD</p>
              </div>
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* 标题 + 版本 */}
              <div
                data-testid={`${testId}-prd-title`}
                className="flex items-center justify-between"
              >
                <h3 className="text-lg font-semibold">{prdApi.currentPRD.title}</h3>
                <span
                  data-testid={`${testId}-prd-version`}
                  className="text-xs text-[var(--text-secondary)]"
                >
                  v{prdApi.currentPRD.version} ·{' '}
                  {new Date(prdApi.currentPRD.updated_at * 1000).toLocaleString()}
                </span>
              </div>

              {/* 目标 */}
              <Section title="🎯 目标" testId={`${testId}-goals`}>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {prdApi.currentPRD.goals.map((g, i) => (
                    <li key={i}>{g}</li>
                  ))}
                </ul>
              </Section>

              {/* 用户场景 */}
              <Section title="👥 用户场景" testId={`${testId}-scenarios`}>
                {prdApi.currentPRD.user_scenarios.map((s, i) => (
                  <div
                    key={i}
                    data-testid={`${testId}-scenario-${i}`}
                    className="mb-2 p-2 bg-[var(--bg-elevated)] rounded"
                  >
                    <div className="text-sm font-medium">{s.name}</div>
                    <div className="text-xs text-[var(--text-secondary)] mt-1">{s.description}</div>
                    {s.steps.length > 0 && (
                      <ol className="list-decimal list-inside text-xs text-[var(--text-secondary)] mt-1">
                        {s.steps.map((step, j) => (
                          <li key={j}>{step}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                ))}
              </Section>

              {/* 验收标准 */}
              <Section title="✅ 验收标准" testId={`${testId}-criteria`}>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-[var(--text-secondary)]">
                      <th className="text-left py-1">ID</th>
                      <th className="text-left py-1">描述</th>
                      <th className="text-left py-1">指标</th>
                      <th className="text-left py-1">目标</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prdApi.currentPRD.acceptance_criteria.map((c) => (
                      <tr
                        key={c.id}
                        data-testid={`${testId}-criterion-${c.id}`}
                        className="border-t border-[var(--border-color)]"
                      >
                        <td className="py-1 pr-2 font-mono text-xs">{c.id}</td>
                        <td className="py-1 pr-2">{c.description}</td>
                        <td className="py-1 pr-2 text-xs text-[var(--text-secondary)]">
                          {c.metric}
                        </td>
                        <td className="py-1 text-xs text-[var(--text-secondary)]">
                          {c.target}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Section>

              {/* 任务分解 */}
              <Section title="📦 任务分解" testId={`${testId}-tasks`}>
                {prdApi.currentPRD.tasks.map((t) => (
                  <div
                    key={t.id}
                    data-testid={`${testId}-task-${t.id}`}
                    className="flex items-center justify-between p-2 mb-1 bg-[var(--bg-elevated)] rounded"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-[var(--text-secondary)]">
                          {t.id}
                        </span>
                        <span className="text-sm font-medium">{t.name}</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            color: RISK_COLORS[t.risk_level] || 'var(--text-secondary)',
                            borderColor: RISK_COLORS[t.risk_level] || 'var(--border-color)',
                            borderWidth: 1,
                          }}
                        >
                          {t.risk_level}
                        </span>
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                        {t.description} · {t.estimated_hours}h
                        {t.dependencies.length > 0 && (
                          <span className="ml-2">依赖: {t.dependencies.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </Section>

              {/* 风险 */}
              <Section title="⚠️ 风险" testId={`${testId}-risks`}>
                <ul className="list-disc list-inside text-sm space-y-1">
                  {prdApi.currentPRD.risks.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </Section>

              {/* 迭代 */}
              <Section title="🔄 迭代反馈" testId={`${testId}-iterate`}>
                <textarea
                  data-testid={`${testId}-feedback`}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="例如：增加多语言支持，扩展为 SaaS"
                  className="w-full h-16 px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded resize-none focus:outline-none focus:border-[var(--accent-primary)]"
                />
                <button
                  data-testid={`${testId}-iterate-btn`}
                  onClick={handleIterate}
                  disabled={prdApi.iterating || feedback.trim().length < 5}
                  className="mt-2 px-3 py-1.5 text-sm bg-[var(--accent-primary)] text-white rounded disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90"
                >
                  {prdApi.iterating ? '迭代中…' : '🔄 迭代 v' + (prdApi.currentPRD.version + 1)}
                </button>
              </Section>

              {/* Diff */}
              {prdApi.currentDiff.length > 0 && (
                <Section title="📊 本次变更" testId={`${testId}-diff`}>
                  <ul className="text-sm space-y-1">
                    {prdApi.currentDiff.map((d, i) => (
                      <li
                        key={i}
                        data-testid={`${testId}-diff-${i}`}
                        className="flex items-start gap-2"
                      >
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            color:
                              d.op === 'added'
                                ? 'var(--accent-success)'
                                : d.op === 'removed'
                                ? 'var(--accent-error)'
                                : 'var(--accent-warning)',
                            borderColor: 'var(--border-color)',
                            borderWidth: 1,
                          }}
                        >
                          {d.op}
                        </span>
                        <span className="flex-1">{d.summary}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              {/* 版本历史 */}
              {prdApi.currentVersions.length > 1 && (
                <Section title="📚 版本历史" testId={`${testId}-history`}>
                  {prdApi.currentVersions.map((v) => (
                    <div
                      key={v.version}
                      data-testid={`${testId}-version-${v.version}`}
                      className={`p-2 mb-1 rounded cursor-pointer hover:bg-[var(--bg-elevated)] ${
                        v.version === prdApi.currentPRD?.version ? 'bg-[var(--bg-elevated)]' : ''
                      }`}
                      onClick={() => prdApi.loadPRD(prdApi.currentPRD!.prd_id, v.version, false)}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">v{v.version}</span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {new Date(v.created_at * 1000).toLocaleString()}
                        </span>
                      </div>
                      {v.diff_summary && (
                        <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                          {v.diff_summary}
                        </div>
                      )}
                    </div>
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Section(props: { title: string; testId?: string; children: React.ReactNode }) {
  return (
    <div data-testid={props.testId} className="border border-[var(--border-color)] rounded p-3">
      <h4 className="text-sm font-semibold mb-2">{props.title}</h4>
      {props.children}
    </div>
  );
}
