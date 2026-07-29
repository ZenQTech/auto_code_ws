/**
 * # ============================================================
 * EnterpriseHubPanel - 企业级 Plugin Hub 管理面板 (v1.0.0 - Cycle 14 P0-3)
 * # ============================================================
 * 核心作用：可视化展示企业级 Plugin Hub（90+ 插件目录/团队管理/RBAC/
 *           成本控制/审批/审计/Dashboard），支持 12 分类浏览与 32 个 API 操作
 * 运行流程：
 *   1. 挂载时拉取健康检查 + 目录统计
 *   2. Tab 切换：浏览 / 团队 / 成本 / 审批 / 审计 / Dashboard
 *   3. 浏览：搜索/分类/企业级过滤；点击插件查看详情
 *   4. 团队：组织/团队/成员三级 CRUD
 *   5. 成本：摘要/明细/Top 插件
 *   6. 审批：创建/批准/拒绝
 *   7. 审计：日志查询/导出
 *   8. Dashboard：快照/Top 插件/生产力分析
 * 输入参数：
 *   - onClose?: 关闭回调
 *   - standalone?: 是否独立页面模式
 * 输出结果：完整的 React 组件
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  enterpriseHubApi,
  type PluginCatalogItem,
  type Category,
  type Organization,
  type Team,
  type Member,
  type CostSummary,
  type CostBreakdown,
  type ApprovalRequest,
  type AuditLog,
  type DashboardSnapshot,
  type ProductivityReport,
} from '../hooks/useEnterpriseHubApi';
import { useToast } from '../hooks/useToast';

type TabKey = 'browse' | 'team' | 'cost' | 'approval' | 'audit' | 'dashboard';
type TeamView = 'orgs' | 'teams' | 'members';

interface EnterpriseHubPanelProps {
  onClose?: () => void;
  standalone?: boolean;
}

const EnterpriseHubPanel: React.FC<EnterpriseHubPanelProps> = ({ onClose, standalone }) => {
  const toast = useToast();
  const [tab, setTab] = useState<TabKey>('browse');
  const [health, setHealth] = useState<any>(null);

  // 浏览状态
  const [plugins, setPlugins] = useState<PluginCatalogItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [filterEnterprise, setFilterEnterprise] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginCatalogItem | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  // 团队状态
  const [teamView, setTeamView] = useState<TeamView>('orgs');
  const [orgs, setOrgs] = useState<Organization[]>([]);
  const [selectedOrg, setSelectedOrg] = useState<Organization | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [members, setMembers] = useState<Member[]>([]);

  // 成本状态
  const [costSummary, setCostSummary] = useState<CostSummary | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);

  // 审批状态
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);

  // 审计状态
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);

  // Dashboard 状态
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [productivity, setProductivity] = useState<ProductivityReport | null>(null);

  // ============================================================
  // 加载
  // ============================================================
  const loadHealth = useCallback(async () => {
    try {
      const h = await enterpriseHubApi.health();
      setHealth(h);
    } catch (e: any) {
      toast.showToast('健康检查失败: ' + e.message, 'error');
    }
  }, [toast]);

  const loadBrowse = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const [c, p] = await Promise.all([
        enterpriseHubApi.categories(),
        enterpriseHubApi.listCatalog({
          q: searchQuery || undefined,
          category: filterCategory || undefined,
          enterprise_only: filterEnterprise || undefined,
          limit: 200,
        }),
      ]);
      setCategories(c.items);
      setPlugins(p.items);
    } catch (e: any) {
      toast.showToast('加载目录失败: ' + e.message, 'error');
    } finally {
      setBrowseLoading(false);
    }
  }, [searchQuery, filterCategory, filterEnterprise, toast]);

  const loadOrgs = useCallback(async () => {
    try {
      const r = await enterpriseHubApi.listOrgs();
      setOrgs(r.items);
    } catch (e: any) {
      toast.showToast('加载组织失败: ' + e.message, 'error');
    }
  }, [toast]);

  const loadOrgDetails = useCallback(
    async (org: Organization) => {
      try {
        setSelectedOrg(org);
        const [t, m] = await Promise.all([
          enterpriseHubApi.listTeams(org.org_id),
          enterpriseHubApi.listMembers(org.org_id),
        ]);
        setTeams(t.items);
        setMembers(m.items);
      } catch (e: any) {
        toast.showToast('加载组织详情失败: ' + e.message, 'error');
      }
    },
    [toast]
  );

  const loadCost = useCallback(async () => {
    if (!selectedOrg) {
      toast.showToast('请先选择组织', 'warning');
      return;
    }
    try {
      const [s, b] = await Promise.all([
        enterpriseHubApi.costSummary(selectedOrg.org_id),
        enterpriseHubApi.costBreakdown(selectedOrg.org_id),
      ]);
      setCostSummary(s);
      setCostBreakdown(b);
    } catch (e: any) {
      toast.showToast('加载成本失败: ' + e.message, 'error');
    }
  }, [selectedOrg, toast]);

  const loadApprovals = useCallback(async () => {
    try {
      const r = await enterpriseHubApi.listApprovals();
      setApprovals(r.items);
    } catch (e: any) {
      toast.showToast('加载审批失败: ' + e.message, 'error');
    }
  }, [toast]);

  const loadAudit = useCallback(async () => {
    try {
      const r = await enterpriseHubApi.queryAudit({ limit: 100 });
      setAuditLogs(r.items);
    } catch (e: any) {
      toast.showToast('加载审计失败: ' + e.message, 'error');
    }
  }, [toast]);

  const loadDashboard = useCallback(async () => {
    if (!selectedOrg) {
      toast.showToast('请先选择组织', 'warning');
      return;
    }
    try {
      const [d, p] = await Promise.all([
        enterpriseHubApi.dashboard(selectedOrg.org_id),
        enterpriseHubApi.productivity(selectedOrg.org_id),
      ]);
      setDashboard(d);
      setProductivity(p);
    } catch (e: any) {
      toast.showToast('加载 Dashboard 失败: ' + e.message, 'error');
    }
  }, [selectedOrg, toast]);

  useEffect(() => {
    loadHealth();
  }, [loadHealth]);

  useEffect(() => {
    if (tab === 'browse') loadBrowse();
    if (tab === 'team') loadOrgs();
    if (tab === 'cost') loadCost();
    if (tab === 'approval') loadApprovals();
    if (tab === 'audit') loadAudit();
    if (tab === 'dashboard') loadDashboard();
  }, [tab, loadBrowse, loadOrgs, loadCost, loadApprovals, loadAudit, loadDashboard]);

  // ============================================================
  // 操作
  // ============================================================
  const handleCreateOrg = async () => {
    const name = prompt('输入组织名:');
    if (!name) return;
    const owner = prompt('输入 owner email:');
    if (!owner) return;
    try {
      await enterpriseHubApi.createOrg(name, owner, 'free', owner);
      toast.showToast('组织已创建', 'success');
      loadOrgs();
    } catch (e: any) {
      toast.showToast(e.message, 'error');
    }
  };

  const handleCreateTeam = async () => {
    if (!selectedOrg) return;
    const name = prompt('输入团队名:');
    if (!name) return;
    try {
      await enterpriseHubApi.createTeam(selectedOrg.org_id, name, selectedOrg.owner);
      toast.showToast('团队已创建', 'success');
      loadOrgDetails(selectedOrg);
    } catch (e: any) {
      toast.showToast(e.message, 'error');
    }
  };

  const handleInviteMember = async () => {
    if (!selectedOrg) return;
    const email = prompt('输入成员邮箱:');
    if (!email) return;
    const role = prompt('输入角色 (admin/manager/developer/viewer):', 'developer') || 'developer';
    try {
      await enterpriseHubApi.inviteMember(selectedOrg.org_id, email, selectedOrg.owner, '', role);
      toast.showToast('成员已邀请', 'success');
      loadOrgDetails(selectedOrg);
    } catch (e: any) {
      toast.showToast(e.message, 'error');
    }
  };

  const handleApprove = async (req: ApprovalRequest) => {
    if (!selectedOrg) return;
    try {
      await enterpriseHubApi.approveRequest(req.request_id, selectedOrg.org_id, selectedOrg.owner);
      toast.showToast('已批准', 'success');
      loadApprovals();
    } catch (e: any) {
      toast.showToast(e.message, 'error');
    }
  };

  const handleReject = async (req: ApprovalRequest) => {
    if (!selectedOrg) return;
    const comment = prompt('拒绝理由:') || '';
    try {
      await enterpriseHubApi.rejectRequest(req.request_id, selectedOrg.org_id, selectedOrg.owner, comment);
      toast.showToast('已拒绝', 'success');
      loadApprovals();
    } catch (e: any) {
      toast.showToast(e.message, 'error');
    }
  };

  // ============================================================
  // 渲染
  // ============================================================
  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: 'browse', label: '浏览', icon: '🗂️' },
    { key: 'team', label: '团队', icon: '👥' },
    { key: 'cost', label: '成本', icon: '💰' },
    { key: 'approval', label: '审批', icon: '✅' },
    { key: 'audit', label: '审计', icon: '🔍' },
    { key: 'dashboard', label: 'Dashboard', icon: '📊' },
  ];

  return (
    <div className={`flex flex-col h-full bg-white ${standalone ? 'p-6' : 'rounded-lg shadow-lg'} overflow-hidden`}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🏢</span>
          <div>
            <h2 className="text-lg font-semibold text-gray-800">Enterprise Plugin Hub</h2>
            <p className="text-xs text-gray-500">
              {health?.status === 'ok'
                ? `健康 · ${health?.components?.catalog?.total || 0} 插件 · ${categories.length} 分类`
                : '加载中…'}
            </p>
          </div>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
          >
            ✕ 关闭
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-gray-50">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? 'border-indigo-500 text-indigo-600 bg-white'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            <span>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'browse' && (
          <div>
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <input
                type="text"
                placeholder="🔍 搜索插件..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm w-64"
              />
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="px-3 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="">所有分类</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={filterEnterprise}
                  onChange={(e) => setFilterEnterprise(e.target.checked)}
                />
                仅企业级
              </label>
              <button
                onClick={loadBrowse}
                className="px-3 py-1.5 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600"
              >
                刷新
              </button>
              <span className="text-sm text-gray-500 ml-2">{plugins.length} 个插件</span>
            </div>

            {selectedPlugin ? (
              <PluginDetail plugin={selectedPlugin} onBack={() => setSelectedPlugin(null)} />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {browseLoading ? (
                  <div className="col-span-full text-center py-8 text-gray-500">加载中...</div>
                ) : (
                  plugins.map((p) => (
                    <div
                      key={p.plugin_id}
                      onClick={() => setSelectedPlugin(p)}
                      className="p-3 border border-gray-200 rounded-lg hover:border-indigo-400 hover:shadow cursor-pointer bg-white"
                    >
                      <div className="flex items-start justify-between mb-1">
                        <h3 className="font-medium text-gray-800 text-sm">{p.name}</h3>
                        {p.enterprise_ready && (
                          <span className="px-1.5 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                            🏢 企业级
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-2 mb-2">{p.description}</p>
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                          {p.category}
                        </span>
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-600 rounded">
                          v{p.version}
                        </span>
                        {p.soc2_compliant && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
                            SOC2
                          </span>
                        )}
                        {p.pricing_model !== 'free' && (
                          <span className="px-1.5 py-0.5 bg-orange-100 text-orange-700 rounded">
                            ${p.price_usd}
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'team' && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={() => setTeamView('orgs')}
                className={`px-3 py-1.5 rounded text-sm ${
                  teamView === 'orgs' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'
                }`}
              >
                组织
              </button>
              <button
                onClick={() => setTeamView('teams')}
                className={`px-3 py-1.5 rounded text-sm ${
                  teamView === 'teams' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'
                }`}
                disabled={!selectedOrg}
              >
                团队
              </button>
              <button
                onClick={() => setTeamView('members')}
                className={`px-3 py-1.5 rounded text-sm ${
                  teamView === 'members' ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700'
                }`}
                disabled={!selectedOrg}
              >
                成员
              </button>
              {selectedOrg && (
                <span className="text-sm text-gray-500 ml-2">当前组织: {selectedOrg.name}</span>
              )}
            </div>

            {teamView === 'orgs' && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={handleCreateOrg}
                    className="px-3 py-1.5 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600"
                  >
                    + 创建组织
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {orgs.map((o) => (
                    <div
                      key={o.org_id}
                      onClick={() => loadOrgDetails(o)}
                      className={`p-3 border rounded-lg cursor-pointer transition ${
                        selectedOrg?.org_id === o.org_id
                          ? 'border-indigo-500 bg-indigo-50'
                          : 'border-gray-200 hover:border-indigo-300 bg-white'
                      }`}
                    >
                      <h3 className="font-medium text-gray-800">{o.name}</h3>
                      <p className="text-xs text-gray-500 mt-1">{o.owner}</p>
                      <span className="inline-block mt-2 px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">
                        {o.plan}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {teamView === 'teams' && selectedOrg && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={handleCreateTeam}
                    className="px-3 py-1.5 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600"
                  >
                    + 创建团队
                  </button>
                </div>
                <div className="space-y-2">
                  {teams.map((t) => (
                    <div
                      key={t.team_id}
                      className="p-3 border border-gray-200 rounded-lg bg-white flex justify-between items-center"
                    >
                      <div>
                        <h3 className="font-medium text-gray-800">{t.name}</h3>
                        <p className="text-xs text-gray-500">{t.description || '(无描述)'}</p>
                      </div>
                      <div className="text-xs text-gray-500">
                        {t.members.length} 成员 · 预算 ${t.budget_usd}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {teamView === 'members' && selectedOrg && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={handleInviteMember}
                    className="px-3 py-1.5 bg-indigo-500 text-white rounded text-sm hover:bg-indigo-600"
                  >
                    + 邀请成员
                  </button>
                </div>
                <div className="space-y-2">
                  {members.map((m) => (
                    <div
                      key={m.member_id}
                      className="p-3 border border-gray-200 rounded-lg bg-white flex justify-between items-center"
                    >
                      <div>
                        <h3 className="font-medium text-gray-800">{m.name || m.email}</h3>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                      <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded">
                        {m.role}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'cost' && (
          <div>
            {!selectedOrg ? (
              <div className="text-center py-8 text-gray-500">请先在「团队」标签选择组织</div>
            ) : (
              <div className="space-y-4">
                {costSummary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <StatCard label="总成本" value={`$${costSummary.total_usd.toFixed(2)}`} color="blue" />
                    <StatCard label="预算" value={`$${costSummary.budget_usd.toFixed(2)}`} color="green" />
                    <StatCard label="剩余" value={`$${costSummary.remaining_usd.toFixed(2)}`} color="purple" />
                    <StatCard
                      label="使用率"
                      value={`${costSummary.usage_pct.toFixed(1)}%`}
                      color={costSummary.over_budget ? 'red' : 'indigo'}
                    />
                  </div>
                )}
                {costBreakdown && (
                  <div>
                    <h3 className="font-medium text-gray-800 mb-2">按插件 Top 10</h3>
                    <div className="space-y-1">
                      {costBreakdown.top_plugins.map((p) => (
                        <div
                          key={p.plugin_id}
                          className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm"
                        >
                          <span className="text-gray-700 font-mono text-xs">{p.plugin_id}</span>
                          <span className="text-gray-900 font-medium">${p.cost_usd.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {tab === 'approval' && (
          <div>
            <h3 className="font-medium text-gray-800 mb-3">审批请求</h3>
            {approvals.length === 0 ? (
              <div className="text-center py-8 text-gray-500">暂无审批请求</div>
            ) : (
              <div className="space-y-2">
                {approvals.map((a) => (
                  <div
                    key={a.request_id}
                    className="p-3 border border-gray-200 rounded-lg bg-white flex justify-between items-center"
                  >
                    <div>
                      <h3 className="font-medium text-gray-800 text-sm font-mono">{a.plugin_id}</h3>
                      <p className="text-xs text-gray-500 mt-1">{a.reason || '(无理由)'}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{a.created_at}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 text-xs rounded ${
                          a.status === 'pending'
                            ? 'bg-yellow-100 text-yellow-700'
                            : a.status === 'approved'
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}
                      >
                        {a.status}
                      </span>
                      {a.status === 'pending' && selectedOrg && (
                        <>
                          <button
                            onClick={() => handleApprove(a)}
                            className="px-2 py-1 bg-green-500 text-white rounded text-xs hover:bg-green-600"
                          >
                            批准
                          </button>
                          <button
                            onClick={() => handleReject(a)}
                            className="px-2 py-1 bg-red-500 text-white rounded text-xs hover:bg-red-600"
                          >
                            拒绝
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'audit' && (
          <div>
            <h3 className="font-medium text-gray-800 mb-3">审计日志 (SOC2)</h3>
            {auditLogs.length === 0 ? (
              <div className="text-center py-8 text-gray-500">暂无审计日志</div>
            ) : (
              <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
                {auditLogs.map((l) => (
                  <div
                    key={l.log_id}
                    className={`p-2 rounded text-xs flex items-center justify-between ${
                      l.severity === 'error'
                        ? 'bg-red-50'
                        : l.severity === 'warn'
                        ? 'bg-yellow-50'
                        : 'bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-1.5 py-0.5 rounded ${
                          l.severity === 'error'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-gray-200 text-gray-700'
                        }`}
                      >
                        {l.severity}
                      </span>
                      <span className="font-mono text-gray-700">{l.action}</span>
                      <span className="text-gray-500">→ {l.target}</span>
                    </div>
                    <div className="text-gray-500">
                      {l.actor} · {l.created_at}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'dashboard' && (
          <div>
            {!selectedOrg ? (
              <div className="text-center py-8 text-gray-500">请先在「团队」标签选择组织</div>
            ) : (
              <div className="space-y-4">
                {dashboard && (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <StatCard
                        label="总插件"
                        value={dashboard.total_plugins.toString()}
                        color="indigo"
                      />
                      <StatCard
                        label="活跃插件"
                        value={dashboard.active_plugins.toString()}
                        color="green"
                      />
                      <StatCard
                        label="总安装"
                        value={dashboard.total_installs.toString()}
                        color="blue"
                      />
                      <StatCard
                        label="生产力评分"
                        value={dashboard.productivity_score.toFixed(1)}
                        color="purple"
                      />
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800 mb-2">Top 插件</h3>
                      <div className="space-y-1">
                        {dashboard.top_plugins.map((p) => (
                          <div
                            key={p.plugin_id}
                            className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm"
                          >
                            <span className="text-gray-700">{p.name}</span>
                            <span className="text-gray-500">{p.installs} 次安装</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h3 className="font-medium text-gray-800 mb-2">按分类使用</h3>
                      <div className="space-y-1">
                        {Object.entries(dashboard.usage_by_category).map(([cat, count]) => (
                          <div
                            key={cat}
                            className="flex justify-between items-center p-2 bg-gray-50 rounded text-sm"
                          >
                            <span className="text-gray-700">{cat}</span>
                            <span className="text-gray-500">{count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {productivity && (
                  <div className="p-4 bg-indigo-50 rounded-lg">
                    <h3 className="font-medium text-indigo-900 mb-2">生产力分析</h3>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <p className="text-indigo-700">活跃率</p>
                        <p className="text-2xl font-bold text-indigo-900">
                          {productivity.active_rate_pct.toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-indigo-700">活跃用户</p>
                        <p className="text-2xl font-bold text-indigo-900">
                          {productivity.active_users}/{productivity.members}
                        </p>
                      </div>
                      <div>
                        <p className="text-indigo-700">综合评分</p>
                        <p className="text-2xl font-bold text-indigo-900">
                          {productivity.score.toFixed(1)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ============================================================
// 辅助组件
// ============================================================

const StatCard: React.FC<{ label: string; value: string; color: string }> = ({ label, value, color }) => {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
    purple: 'bg-purple-50 text-purple-700',
    indigo: 'bg-indigo-50 text-indigo-700',
  };
  return (
    <div className={`p-3 rounded-lg ${colorMap[color] || 'bg-gray-50'}`}>
      <p className="text-xs opacity-80">{label}</p>
      <p className="text-xl font-bold mt-0.5">{value}</p>
    </div>
  );
};

const PluginDetail: React.FC<{ plugin: PluginCatalogItem; onBack: () => void }> = ({ plugin, onBack }) => {
  return (
    <div className="bg-white">
      <button
        onClick={onBack}
        className="mb-3 px-3 py-1 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
      >
        ← 返回列表
      </button>
      <div className="border border-gray-200 rounded-lg p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-xl font-semibold text-gray-900">{plugin.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              {plugin.vendor} · v{plugin.version} · {plugin.license}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {plugin.enterprise_ready && (
              <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">🏢 企业级</span>
            )}
            {plugin.soc2_compliant && (
              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded">✓ SOC2</span>
            )}
            {plugin.verified && (
              <span className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded">✓ 已验证</span>
            )}
          </div>
        </div>
        <p className="text-gray-700 mb-3">{plugin.description}</p>
        <p className="text-sm text-gray-600 mb-4">{plugin.long_description}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Field label="分类" value={plugin.category} />
          <Field label="来源" value={plugin.source} />
          <Field label="定价" value={plugin.pricing_model} />
          <Field label="价格" value={`$${plugin.price_usd}`} />
        </div>
        {plugin.tags.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-1">标签</p>
            <div className="flex flex-wrap gap-1.5">
              {plugin.tags.map((t) => (
                <span key={t} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
        {plugin.data_residency.length > 0 && (
          <div className="mt-3">
            <p className="text-xs text-gray-500 mb-1">数据驻留</p>
            <div className="flex flex-wrap gap-1.5">
              {plugin.data_residency.map((d) => (
                <span key={d} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                  {d}
                </span>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-4 font-mono break-all">签名: {plugin.signature}</p>
      </div>
    </div>
  );
};

const Field: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <p className="text-xs text-gray-500">{label}</p>
    <p className="text-gray-900 font-medium">{value}</p>
  </div>
);

export default EnterpriseHubPanel;
