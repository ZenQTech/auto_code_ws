/**
 * # ============================================================
 * # Skills Panel - 技能系统 UI (v1.0.0 Cycle 28 G28-01)
 * # ============================================================
 * # 核心作用：展示 Skills 列表、详情、匹配、调用
 * # ============================================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { getDefaultSkillEngine } from '../utils/skillEngine';
import { Skill, SkillStats, SkillMatch } from '../utils/skillTypes';

interface SkillsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /** 可选：注入 prompt 触发匹配 */
  triggerPrompt?: string;
}

type Tab = 'installed' | 'match' | 'stats';

export const SkillsPanel: React.FC<SkillsPanelProps> = ({ isOpen, onClose, triggerPrompt }) => {
  const engine = useMemo(() => getDefaultSkillEngine(), []);
  const [activeTab, setActiveTab] = useState<Tab>('installed');
  const [refreshKey, setRefreshKey] = useState(0);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [stats, setStats] = useState<SkillStats | null>(null);
  const [matchPrompt, setMatchPrompt] = useState(triggerPrompt || '');
  const [matches, setMatches] = useState<SkillMatch[]>([]);
  const [selected, setSelected] = useState<Skill | null>(null);
  const [invokeResult, setInvokeResult] = useState<string>('');

  useEffect(() => {
    if (!isOpen) return;
    setSkills(engine.listSkills());
    setStats(engine.getStats());
  }, [isOpen, refreshKey, engine]);

  useEffect(() => {
    if (triggerPrompt) {
      setMatchPrompt(triggerPrompt);
      setActiveTab('match');
      handleMatch(triggerPrompt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triggerPrompt]);

  const refresh = () => setRefreshKey((k) => k + 1);

  const handleMatch = (prompt?: string) => {
    const p = prompt || matchPrompt;
    if (!p) return;
    const m = engine.matchSkills(p);
    setMatches(m);
  };

  const handleInvoke = async (skillName: string) => {
    const r = await engine.invokeSkill(skillName, { source: 'ui' });
    setInvokeResult(JSON.stringify(r, null, 2));
    refresh();
  };

  const handleToggle = (skill: Skill) => {
    if (skill.enabled) {
      engine.disableSkill(skill.id);
    } else {
      engine.enableSkill(skill.id);
    }
    refresh();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" data-testid="skills-panel">
      <div className="bg-white rounded-lg shadow-xl w-[960px] max-w-[95vw] h-[680px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎯</span>
            <h2 className="text-lg font-semibold">技能系统 (Skills)</h2>
            <span className="text-xs text-gray-500">Codex 2025-12 兼容</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700" data-testid="skills-close">
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b px-5">
          {(['installed', 'match', 'stats'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm border-b-2 ${activeTab === tab ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500'}`}
              data-testid={`skills-tab-${tab}`}
            >
              {tab === 'installed' && '已安装'}
              {tab === 'match' && '匹配'}
              {tab === 'stats' && '统计'}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {activeTab === 'installed' && (
            <div className="space-y-2" data-testid="skills-installed-list">
              {skills.map((s) => (
                <div key={s.id} className="border rounded p-3 flex items-center justify-between hover:bg-gray-50">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{s.name}</span>
                      {s.builtin && <span className="text-xs bg-indigo-100 text-indigo-700 px-2 rounded">内置</span>}
                      <span className="text-xs text-gray-500">v{s.version}</span>
                    </div>
                    <div className="text-sm text-gray-600 mt-1 line-clamp-2">{s.description}</div>
                    <div className="flex gap-1 mt-1">
                      {s.tags.map((t) => (
                        <span key={t} className="text-xs bg-gray-100 text-gray-600 px-1.5 rounded">{t}</span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSelected(s)}
                      className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                      data-testid={`skills-detail-${s.name}`}
                    >
                      详情
                    </button>
                    <button
                      onClick={() => handleToggle(s)}
                      className={`text-xs px-2 py-1 rounded ${s.enabled ? 'bg-red-50 text-red-600 border border-red-200' : 'bg-green-50 text-green-600 border border-green-200'}`}
                      data-testid={`skills-toggle-${s.name}`}
                    >
                      {s.enabled ? '禁用' : '启用'}
                    </button>
                    <button
                      onClick={() => handleInvoke(s.name)}
                      className="text-xs px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600"
                      data-testid={`skills-invoke-${s.name}`}
                    >
                      调用
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'match' && (
            <div className="space-y-3" data-testid="skills-match-section">
              <div className="flex gap-2">
                <input
                  value={matchPrompt}
                  onChange={(e) => setMatchPrompt(e.target.value)}
                  placeholder="输入任务描述，匹配相关 Skill..."
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  data-testid="skills-match-input"
                />
                <button
                  onClick={() => handleMatch()}
                  className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm"
                  data-testid="skills-match-btn"
                >
                  匹配
                </button>
              </div>
              <div className="space-y-2">
                {matches.map((m) => (
                  <div key={m.skill.id} className="border rounded p-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-mono text-sm font-semibold">{m.skill.name}</div>
                        <div className="text-sm text-gray-600">{m.skill.description}</div>
                        <div className="flex gap-1 mt-1">
                          {m.matchedKeywords.map((k) => (
                            <span key={k} className="text-xs bg-yellow-100 text-yellow-700 px-1.5 rounded">{k}</span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Score</div>
                        <div className="text-lg font-bold text-indigo-600">{(m.score * 100).toFixed(0)}%</div>
                      </div>
                    </div>
                  </div>
                ))}
                {matches.length === 0 && matchPrompt && (
                  <div className="text-center text-sm text-gray-500 py-4">无匹配结果</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'stats' && stats && (
            <div className="space-y-4" data-testid="skills-stats">
              <div className="grid grid-cols-4 gap-3">
                <Stat label="总数" value={stats.total} />
                <Stat label="已启用" value={stats.enabled} />
                <Stat label="内置" value={stats.builtin} />
                <Stat label="用户" value={stats.user} />
              </div>
              <div className="border rounded p-3">
                <h3 className="text-sm font-semibold mb-2">Top Used</h3>
                <div className="space-y-1">
                  {stats.topUsed.map((t) => (
                    <div key={t.name} className="flex justify-between text-sm">
                      <span className="font-mono">{t.name}</span>
                      <span className="text-gray-500">{t.count} 次</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="border rounded p-3">
                <h3 className="text-sm font-semibold mb-2">总使用次数</h3>
                <div className="text-2xl font-bold text-indigo-600">{stats.totalUsage}</div>
              </div>
            </div>
          )}
        </div>

        {invokeResult && (
          <div className="px-5 py-2 border-t bg-gray-50 text-xs">
            <div className="flex justify-between">
              <span className="font-semibold">最近调用结果:</span>
              <button onClick={() => setInvokeResult('')} className="text-gray-500">关闭</button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap mt-1">{invokeResult}</pre>
          </div>
        )}

        {selected && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center" data-testid="skills-detail-modal">
            <div className="bg-white rounded-lg p-5 w-[640px] max-w-[90vw] max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold font-mono">{selected.name}</h3>
                <button onClick={() => setSelected(null)} className="text-gray-500">✕</button>
              </div>
              <div className="space-y-2 text-sm">
                <p><strong>描述:</strong> {selected.description}</p>
                <p><strong>版本:</strong> {selected.version}</p>
                <p><strong>作者:</strong> {selected.author}</p>
                <p><strong>路径:</strong> <code className="text-xs">{selected.path}</code></p>
                <p><strong>使用次数:</strong> {selected.usageCount}</p>
                <p><strong>允许工具:</strong> {selected.allowedTools.join(', ') || '无'}</p>
                <p><strong>约束:</strong> {selected.constraints.join(', ') || '无'}</p>
                <p><strong>脚本:</strong> {selected.scripts.length} 个</p>
                <p><strong>引用:</strong> {selected.references.length} 个</p>
                <div>
                  <strong>正文:</strong>
                  <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">{selected.body}</pre>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="border rounded p-3 text-center">
    <div className="text-xs text-gray-500">{label}</div>
    <div className="text-2xl font-bold text-indigo-600">{value}</div>
  </div>
);

export default SkillsPanel;
