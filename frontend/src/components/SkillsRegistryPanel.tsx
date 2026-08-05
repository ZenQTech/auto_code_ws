/**
 * # ============================================================
 * # SkillsRegistryPanel (v1.0.0)
 * # Cycle 70 G70-01
 * # ====================================
 * # 核心作用：展示 5 位置 Skills 注册表（Codex 风格）
 * # 功能：
 * #   1. 5 位置状态（defaults/system/admin/user/repo）
 * #   2. Skills 列表（带位置徽章、启用/禁用、tag）
 * #   3. 隐式匹配（输入 query → 显示 top-K 匹配）
 * #   4. 显式调用（$skill-name 风格按钮）
 * #   5. 冲突列表（高优先级覆盖低优先级）
 * #   6. 重新扫描（指定 repo_root）
 * # 输入参数：isOpen, onClose
 * # 输出结果：可交互的 Skills 管理面板
 * # 对标：Codex CLI v0.124.0+ Skills UI
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-05 | v1.0.0 | Cycle 70 G70-01 初次创建
 * # ====================================
 */

import React, { useState, useEffect, useMemo } from 'react';
import { useSkillsV2, type SkillV2, type SkillLocationV2 } from '../hooks/useSkillsV2';
import { useSkillInvocation } from '../hooks/useSkillInvocation';

interface SkillsRegistryPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'list' | 'match' | 'conflicts' | 'history';

// 位置徽章颜色
const LOCATION_COLORS: Record<SkillLocationV2, string> = {
  defaults: 'bg-purple-100 text-purple-700',
  system: 'bg-blue-100 text-blue-700',
  admin: 'bg-orange-100 text-orange-700',
  user: 'bg-green-100 text-green-700',
  repo: 'bg-pink-100 text-pink-700',
};

const LOCATION_LABELS: Record<SkillLocationV2, string> = {
  defaults: '内置',
  system: '系统',
  admin: '管理员',
  user: '用户',
  repo: '仓库',
};

export const SkillsRegistryPanel: React.FC<SkillsRegistryPanelProps> = ({ isOpen, onClose }) => {
  const {
    skills,
    locations,
    conflicts,
    loading,
    error,
    repoRoot,
    refresh,
    rescan,
    setEnabled,
  } = useSkillsV2({ autoRefresh: false });

  const { matches, history, match, invoke, refreshHistory, lastInvocation } =
    useSkillInvocation();

  const [activeTab, setActiveTab] = useState<Tab>('list');
  const [matchQuery, setMatchQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<SkillV2 | null>(null);
  const [rescanRepoRoot, setRescanRepoRoot] = useState('');
  const [rescanning, setRescanning] = useState(false);
  const [invokeArgs, setInvokeArgs] = useState('{}');
  const [locationFilter, setLocationFilter] = useState<SkillLocationV2 | 'all'>('all');

  useEffect(() => {
    if (isOpen) {
      // hook 内部 useEffect 已经在 isOpen=true 时调用 refresh + loadLocations + loadConflicts
      // 这里只需要调用 hook 之外的额外副作用（refreshHistory）
      void refreshHistory();
    }
  }, [isOpen, refreshHistory]);

  useEffect(() => {
    if (repoRoot && !rescanRepoRoot) {
      setRescanRepoRoot(repoRoot);
    }
  }, [repoRoot, rescanRepoRoot]);

  const filteredSkills = useMemo(() => {
    if (locationFilter === 'all') return skills;
    return skills.filter((s) => s.location === locationFilter);
  }, [skills, locationFilter]);

  const handleMatch = async () => {
    if (!matchQuery.trim()) return;
    await match(matchQuery);
  };

  const handleInvoke = async (name: string) => {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(invokeArgs);
    } catch {
      args = {};
    }
    await invoke(name, args, matchQuery);
    void refreshHistory();
  };

  const handleRescan = async () => {
    setRescanning(true);
    try {
      await rescan(rescanRepoRoot || undefined);
    } finally {
      setRescanning(false);
    }
  };

  const handleToggle = async (skill: SkillV2) => {
    await setEnabled(skill.id, !skill.enabled);
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      data-testid="skills-registry-panel"
    >
      <div className="bg-white rounded-lg shadow-xl w-[1080px] max-w-[95vw] h-[720px] max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🎯</span>
            <h2 className="text-lg font-semibold">技能注册表 (Skills Registry)</h2>
            <span className="text-xs text-gray-500">5 位置 · Codex 兼容</span>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-xl"
            data-testid="skills-registry-close"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-50 text-red-700 text-sm border-b border-red-200 flex justify-between">
            <span>{error}</span>
            <button onClick={() => {}} className="text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b px-5">
          {(['list', 'match', 'conflicts', 'history'] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 text-sm border-b-2 ${
                activeTab === tab
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500'
              }`}
              data-testid={`skills-tab-${tab}`}
            >
              {tab === 'list' && `列表 (${skills.length})`}
              {tab === 'match' && `匹配 (${matches.length})`}
              {tab === 'conflicts' && `冲突 (${conflicts.length})`}
              {tab === 'history' && `历史 (${history.length})`}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-5">
          {activeTab === 'list' && (
            <div data-testid="skills-registry-list">
              {/* 位置状态 */}
              <div className="mb-4 grid grid-cols-5 gap-2">
                {(['defaults', 'system', 'admin', 'user', 'repo'] as SkillLocationV2[]).map(
                  (loc) => {
                    const status = locations.find((l) => l.name === loc);
                    return (
                      <div
                        key={loc}
                        className={`border rounded p-2 text-center cursor-pointer hover:border-indigo-300 ${
                          locationFilter === loc ? 'border-indigo-500 bg-indigo-50' : ''
                        }`}
                        onClick={() =>
                          setLocationFilter(locationFilter === loc ? 'all' : loc)
                        }
                        data-testid={`location-card-${loc}`}
                      >
                        <div className="text-xs text-gray-500">
                          {LOCATION_LABELS[loc]}
                        </div>
                        <div className="text-lg font-bold text-indigo-600">
                          {status?.skill_count ?? 0}
                        </div>
                        <div className="text-xs text-gray-400">
                          {status?.exists ? '已加载' : '不存在'}
                        </div>
                      </div>
                    );
                  }
                )}
              </div>

              {/* 重新扫描 */}
              <div className="mb-3 p-2 bg-gray-50 rounded flex gap-2 items-center">
                <span className="text-xs text-gray-500 whitespace-nowrap">仓库根:</span>
                <input
                  value={rescanRepoRoot}
                  onChange={(e) => setRescanRepoRoot(e.target.value)}
                  placeholder="/path/to/repo"
                  className="flex-1 px-2 py-1 text-xs border rounded font-mono"
                  data-testid="rescan-repo-root"
                />
                <button
                  onClick={handleRescan}
                  disabled={rescanning}
                  className="px-3 py-1 text-xs bg-indigo-500 text-white rounded hover:bg-indigo-600 disabled:opacity-50"
                  data-testid="rescan-btn"
                >
                  {rescanning ? '扫描中…' : '重新扫描'}
                </button>
                {locationFilter !== 'all' && (
                  <button
                    onClick={() => setLocationFilter('all')}
                    className="px-2 py-1 text-xs border rounded hover:bg-gray-100"
                    data-testid="clear-filter-btn"
                  >
                    清除过滤
                  </button>
                )}
              </div>

              {loading && <div className="text-center py-4 text-gray-500">加载中…</div>}

              {/* Skills 列表 */}
              <div className="space-y-2">
                {filteredSkills.map((s) => (
                  <div
                    key={s.id}
                    className="border rounded p-3 hover:bg-gray-50"
                    data-testid={`skill-item-${s.name}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-sm font-semibold">{s.name}</span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              LOCATION_COLORS[s.location] || 'bg-gray-100 text-gray-700'
                            }`}
                            data-testid={`skill-location-${s.name}`}
                          >
                            {LOCATION_LABELS[s.location]}
                          </span>
                          {s.allowed_tools.length > 0 && (
                            <span className="text-xs text-gray-500">
                              工具: {s.allowed_tools.join(', ')}
                            </span>
                          )}
                          <span className="text-xs text-gray-400">v{s.version}</span>
                          {!s.enabled && (
                            <span className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                              已禁用
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-600 mt-1 line-clamp-2">
                          {s.description || '（无描述）'}
                        </div>
                        {s.tags.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {s.tags.map((t) => (
                              <span
                                key={t}
                                className="text-xs bg-gray-100 text-gray-600 px-1.5 rounded"
                              >
                                #{t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1 ml-2 flex-shrink-0">
                        <button
                          onClick={() => setSelectedSkill(s)}
                          className="text-xs px-2 py-1 border rounded hover:bg-gray-100"
                          data-testid={`skill-detail-${s.name}`}
                        >
                          详情
                        </button>
                        <button
                          onClick={() => handleToggle(s)}
                          className={`text-xs px-2 py-1 rounded ${
                            s.enabled
                              ? 'bg-red-50 text-red-600 border border-red-200'
                              : 'bg-green-50 text-green-600 border border-green-200'
                          }`}
                          data-testid={`skill-toggle-${s.name}`}
                        >
                          {s.enabled ? '禁用' : '启用'}
                        </button>
                        <button
                          onClick={() => handleInvoke(s.name)}
                          className="text-xs px-2 py-1 bg-indigo-500 text-white rounded hover:bg-indigo-600"
                          data-testid={`skill-invoke-${s.name}`}
                        >
                          调用
                        </button>
                      </div>
                    </div>
                  </div>
                ))}

                {!loading && filteredSkills.length === 0 && (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    暂无 Skill
                    {locationFilter !== 'all' && '（可点击位置卡片清除过滤）'}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'match' && (
            <div data-testid="skills-registry-match" className="space-y-3">
              <div className="flex gap-2">
                <input
                  value={matchQuery}
                  onChange={(e) => setMatchQuery(e.target.value)}
                  placeholder="输入任务描述，匹配相关 Skill..."
                  className="flex-1 border rounded px-3 py-2 text-sm"
                  data-testid="match-query-input"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleMatch();
                  }}
                />
                <button
                  onClick={handleMatch}
                  disabled={loading}
                  className="px-4 py-2 bg-indigo-500 text-white rounded hover:bg-indigo-600 text-sm disabled:opacity-50"
                  data-testid="match-btn"
                >
                  匹配
                </button>
              </div>
              <div className="text-xs text-gray-500">
                支持隐式匹配（基于混合相似度）和显式调用 <code className="bg-gray-100 px-1 rounded">$skill-name</code>
              </div>
              <div className="space-y-2">
                {matches.map((m) => (
                  <div
                    key={m.skill.id}
                    className="border rounded p-3"
                    data-testid={`match-item-${m.skill.name}`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">
                            {m.skill.name}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              LOCATION_COLORS[m.skill.location] || 'bg-gray-100 text-gray-700'
                            }`}
                          >
                            {LOCATION_LABELS[m.skill.location]}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 mt-1">
                          {m.skill.description}
                        </div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {m.matched_tokens.map((t) => (
                            <span
                              key={t}
                              className="text-xs bg-yellow-100 text-yellow-700 px-1.5 rounded"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Score</div>
                        <div className="text-lg font-bold text-indigo-600">
                          {(m.similarity * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {matches.length === 0 && !loading && matchQuery && (
                  <div className="text-center py-4 text-gray-500 text-sm">无匹配结果</div>
                )}
              </div>
              {lastInvocation && (
                <div className="border-t pt-3 mt-3">
                  <div className="text-xs font-semibold text-gray-700 mb-1">
                    最近调用结果
                  </div>
                  <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto whitespace-pre-wrap">
                    {JSON.stringify(lastInvocation, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {activeTab === 'conflicts' && (
            <div data-testid="skills-registry-conflicts" className="space-y-2">
              {conflicts.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">无冲突</div>
              ) : (
                conflicts.map((c) => (
                  <div
                    key={c.skill_name}
                    className="border border-yellow-200 bg-yellow-50 rounded p-3"
                    data-testid={`conflict-item-${c.skill_name}`}
                  >
                    <div className="font-mono text-sm font-semibold">{c.skill_name}</div>
                    <div className="text-xs text-gray-600 mt-1">
                      保留 ({c.override_location}) · 覆盖 (
                      {c.overridden.location})
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'history' && (
            <div data-testid="skills-registry-history" className="space-y-2">
              {history.length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">无调用历史</div>
              ) : (
                history.map((h) => (
                  <div
                    key={h.id}
                    className="border rounded p-3"
                    data-testid={`history-item-${h.id}`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-semibold">
                            {h.skill_name}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              h.invocation_type === 'explicit'
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-green-100 text-green-700'
                            }`}
                          >
                            {h.invocation_type}
                          </span>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              h.status === 'success'
                                ? 'bg-green-100 text-green-700'
                                : 'bg-red-100 text-red-700'
                            }`}
                          >
                            {h.status}
                          </span>
                        </div>
                        <div className="text-xs text-gray-600 mt-1 line-clamp-1">
                          {h.query}
                        </div>
                      </div>
                      <div className="text-right text-xs text-gray-500">
                        <div>{h.duration_ms}ms</div>
                        <div>{new Date(h.timestamp).toLocaleTimeString()}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* 详情模态框 */}
        {selectedSkill && (
          <div
            className="absolute inset-0 bg-black/50 flex items-center justify-center"
            data-testid="skill-detail-modal"
          >
            <div className="bg-white rounded-lg p-5 w-[640px] max-w-[90vw] max-h-[80vh] overflow-auto">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold font-mono">
                  {selectedSkill.name}
                </h3>
                <button
                  onClick={() => setSelectedSkill(null)}
                  className="text-gray-500 hover:text-gray-700"
                  data-testid="skill-detail-close"
                >
                  ✕
                </button>
              </div>
              <div className="space-y-2 text-sm">
                <p>
                  <strong>位置:</strong>
                  <span
                    className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                      LOCATION_COLORS[selectedSkill.location]
                    }`}
                  >
                    {LOCATION_LABELS[selectedSkill.location]}
                  </span>
                </p>
                <p>
                  <strong>描述:</strong> {selectedSkill.description}
                </p>
                <p>
                  <strong>版本:</strong> {selectedSkill.version}
                </p>
                <p>
                  <strong>状态:</strong> {selectedSkill.enabled ? '✅ 启用' : '❌ 禁用'}
                </p>
                <p>
                  <strong>路径:</strong>{' '}
                  <code className="text-xs">{selectedSkill.path}</code>
                </p>
                <p>
                  <strong>允许工具:</strong>{' '}
                  {selectedSkill.allowed_tools.join(', ') || '无'}
                </p>
                <p>
                  <strong>用户可调用:</strong>{' '}
                  {selectedSkill.user_invocable ? '是' : '否'}
                </p>
                <p>
                  <strong>禁用模型调用:</strong>{' '}
                  {selectedSkill.disable_model_invocation ? '是' : '否'}
                </p>
                {selectedSkill.tags.length > 0 && (
                  <p>
                    <strong>Tags:</strong>{' '}
                    {selectedSkill.tags.map((t) => (
                      <span
                        key={t}
                        className="text-xs bg-gray-100 text-gray-600 px-1.5 rounded mr-1"
                      >
                        #{t}
                      </span>
                    ))}
                  </p>
                )}
                <p>
                  <strong>脚本:</strong> {selectedSkill.scripts.length} 个
                </p>
                <p>
                  <strong>引用:</strong> {selectedSkill.references.length} 个
                </p>
                {selectedSkill.system_prompt && (
                  <div>
                    <strong>系统提示词:</strong>
                    <pre className="text-xs bg-gray-50 p-2 rounded mt-1 overflow-x-auto whitespace-pre-wrap">
                      {selectedSkill.system_prompt}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default SkillsRegistryPanel;
