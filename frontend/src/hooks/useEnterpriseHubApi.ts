/**
 * # ============================================================
 * useEnterpriseHubApi - 企业级 Plugin Hub API 客户端
 * # ============================================================
 * 核心作用：封装 /api/enterprise-hub 端点调用
 * 创建日期：2026-07-28
 * 模块版本：v1.0.0 (Cycle 14 P0-3)
 * 修改记录：
 *   - 2026-07-28 | v1.0.0 | 新建
 *   - 2026-07-28 | v1.0.0 | 32 端点全量封装
 * ============================================================
 */

const API_BASE = '/api';
const HUB_BASE = `${API_BASE}/enterprise-hub`;

async function apiFetch(path: string, options: RequestInit = {}): Promise<any> {
  const url = `${HUB_BASE}${path}`;
  const resp = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }));
    throw new Error(err.detail || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ============================================================
// 类型定义
// ============================================================

export type PluginSource = 'official' | 'community' | 'local';
export type PricingModel = 'free' | 'paid' | 'usage_based' | 'subscription';
export type MemberRole = 'admin' | 'manager' | 'developer' | 'viewer';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type OrgPlan = 'free' | 'pro' | 'enterprise';

export interface PluginCatalogItem {
  plugin_id: string;
  name: string;
  version: string;
  source: PluginSource;
  category: string;
  vendor: string;
  license: string;
  description: string;
  long_description: string;
  icon_url: string;
  screenshots: string[];
  tags: string[];
  pricing_model: PricingModel;
  price_usd: number;
  enterprise_ready: boolean;
  soc2_compliant: boolean;
  data_residency: string[];
  permissions_required: string[];
  downloads: number;
  rating: number;
  rating_count: number;
  install_commands: number;
  last_updated: string;
  verified: boolean;
  signature: string;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  description: string;
}

export interface Organization {
  org_id: string;
  name: string;
  plan: OrgPlan;
  owner: string;
  created_at: string;
  settings: Record<string, any>;
  quotas: Record<string, any>;
  billing_email: string;
}

export interface Team {
  team_id: string;
  org_id: string;
  name: string;
  description: string;
  members: string[];
  budget_usd: number;
  created_at: string;
  lead: string | null;
}

export interface Member {
  member_id: string;
  org_id: string;
  email: string;
  name: string;
  role: MemberRole;
  teams: string[];
  joined_at: string;
  last_active: string | null;
  status: string;
}

export interface ApprovalRequest {
  request_id: string;
  plugin_id: string;
  requested_by: string;
  team_id: string;
  reason: string;
  status: ApprovalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_comment: string | null;
  created_at: string;
}

export interface CostSummary {
  org_id: string;
  period: string;
  total_usd: number;
  budget_usd: number;
  remaining_usd: number;
  usage_pct: number;
  record_count: number;
  over_budget: boolean;
}

export interface CostBreakdown {
  org_id: string;
  period: string;
  by_plugin: Record<string, number>;
  by_team: Record<string, number>;
  by_member: Record<string, number>;
  top_plugins: Array<{ plugin_id: string; cost_usd: number }>;
  top_members: Array<{ member_id: string; cost_usd: number }>;
}

export interface AuditLog {
  log_id: string;
  org_id: string;
  actor: string;
  action: string;
  target: string;
  metadata: Record<string, any>;
  ip_address: string | null;
  user_agent: string | null;
  severity: 'info' | 'warn' | 'error';
  created_at: string;
}

export interface DashboardSnapshot {
  snapshot_id: string;
  org_id: string;
  period: string;
  total_plugins: number;
  active_plugins: number;
  total_installs: number;
  active_users: number;
  top_plugins: Array<{ plugin_id: string; name: string; installs: number; rating: number }>;
  usage_by_category: Record<string, number>;
  cost_summary: Record<string, number>;
  productivity_score: number;
  generated_at: string;
}

export interface ProductivityReport {
  org_id: string;
  score: number;
  members: number;
  active_users: number;
  active_rate_pct: number;
  teams: number;
  installs: number;
  generated_at: string;
}

export interface PermissionsReport {
  actor: string;
  org_id: string;
  role: MemberRole;
  permissions: string[];
}

// ============================================================
// API 客户端
// ============================================================

export const enterpriseHubApi = {
  // Health & Stats
  health: () => apiFetch('/health'),
  stats: () => apiFetch('/stats'),

  // 插件目录
  listCatalog: (params?: {
    q?: string;
    category?: string;
    source?: PluginSource;
    enterprise_only?: boolean;
    soc2_only?: boolean;
    free_only?: boolean;
    limit?: number;
  }) => {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.set('q', params.q);
    if (params?.category) searchParams.set('category', params.category);
    if (params?.source) searchParams.set('source', params.source);
    if (params?.enterprise_only) searchParams.set('enterprise_only', 'true');
    if (params?.soc2_only) searchParams.set('soc2_only', 'true');
    if (params?.free_only) searchParams.set('free_only', 'true');
    if (params?.limit) searchParams.set('limit', String(params.limit));
    const qs = searchParams.toString();
    return apiFetch(`/catalog${qs ? '?' + qs : ''}`);
  },
  featuredPlugins: (limit = 10) => apiFetch(`/catalog/featured?limit=${limit}`),
  categories: () => apiFetch('/categories'),
  getPlugin: (pluginId: string) => apiFetch(`/catalog/${encodeURIComponent(pluginId)}`),

  // 组织
  createOrg: (name: string, owner: string, plan = 'free', actor = owner) =>
    apiFetch('/orgs', {
      method: 'POST',
      body: JSON.stringify({ name, owner, plan, actor }),
    }),
  listOrgs: () => apiFetch('/orgs'),
  getOrg: (orgId: string) => apiFetch(`/orgs/${encodeURIComponent(orgId)}`),
  setQuotas: (orgId: string, quotas: Record<string, any>, actor: string) =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/quotas`, {
      method: 'POST',
      body: JSON.stringify({ quotas, actor }),
    }),
  getQuotas: (orgId: string) => apiFetch(`/orgs/${encodeURIComponent(orgId)}/quotas`),

  // 团队
  createTeam: (orgId: string, name: string, actor: string, description = '', budgetUsd = 0) =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/teams`, {
      method: 'POST',
      body: JSON.stringify({ name, description, budget_usd: budgetUsd, actor }),
    }),
  listTeams: (orgId: string) => apiFetch(`/orgs/${encodeURIComponent(orgId)}/teams`),

  // 成员
  inviteMember: (orgId: string, email: string, actor: string, name = '', role = 'developer') =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/members`, {
      method: 'POST',
      body: JSON.stringify({ email, name, role, actor }),
    }),
  listMembers: (orgId: string) => apiFetch(`/orgs/${encodeURIComponent(orgId)}/members`),
  updateMemberRole: (orgId: string, memberId: string, role: MemberRole, actor: string) =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(memberId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role, actor }),
    }),
  getPermissions: (orgId: string, actor: string) =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/permissions?actor=${encodeURIComponent(actor)}`),

  // 成本
  recordCost: (
    orgId: string,
    pluginId: string,
    memberId: string,
    costUsd: number,
    actor: string,
    teamId?: string,
    usageCount = 1
  ) =>
    apiFetch('/cost/records', {
      method: 'POST',
      body: JSON.stringify({
        org_id: orgId,
        plugin_id: pluginId,
        member_id: memberId,
        cost_usd: costUsd,
        actor,
        team_id: teamId,
        usage_count: usageCount,
      }),
    }),
  costSummary: (orgId: string, period?: string) =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/cost/summary${period ? '?period=' + period : ''}`),
  costBreakdown: (orgId: string, period?: string) =>
    apiFetch(`/orgs/${encodeURIComponent(orgId)}/cost/breakdown${period ? '?period=' + period : ''}`),

  // 审批
  createApproval: (
    orgId: string,
    pluginId: string,
    requestedBy: string,
    reason = '',
    teamId = ''
  ) =>
    apiFetch('/approvals', {
      method: 'POST',
      body: JSON.stringify({
        org_id: orgId,
        plugin_id: pluginId,
        requested_by: requestedBy,
        reason,
        team_id: teamId,
      }),
    }),
  listApprovals: (params?: { status?: ApprovalStatus; team_id?: string; plugin_id?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.team_id) sp.set('team_id', params.team_id);
    if (params?.plugin_id) sp.set('plugin_id', params.plugin_id);
    const qs = sp.toString();
    return apiFetch(`/approvals${qs ? '?' + qs : ''}`);
  },
  approveRequest: (requestId: string, orgId: string, reviewer: string, comment = '') =>
    apiFetch(`/approvals/${encodeURIComponent(requestId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, reviewer, comment }),
    }),
  rejectRequest: (requestId: string, orgId: string, reviewer: string, comment = '') =>
    apiFetch(`/approvals/${encodeURIComponent(requestId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, reviewer, comment }),
    }),

  // 审计
  queryAudit: (params?: { org_id?: string; actor?: string; action?: string; severity?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.org_id) sp.set('org_id', params.org_id);
    if (params?.actor) sp.set('actor', params.actor);
    if (params?.action) sp.set('action', params.action);
    if (params?.severity) sp.set('severity', params.severity);
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return apiFetch(`/audit/logs${qs ? '?' + qs : ''}`);
  },
  exportAudit: (orgId?: string, format: 'jsonl' | 'json' = 'jsonl') =>
    apiFetch(`/audit/export${orgId ? '?org_id=' + encodeURIComponent(orgId) : ''}&format=${format}`),
  logSecurityEvent: (orgId: string, actor: string, event: string, target: string, metadata?: Record<string, any>) =>
    apiFetch('/audit/security-event', {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, actor, event, target, metadata }),
    }),

  // Dashboard
  dashboard: (orgId: string) => apiFetch(`/dashboard/${encodeURIComponent(orgId)}`),
  topPlugins: (orgId: string, limit = 10) =>
    apiFetch(`/dashboard/${encodeURIComponent(orgId)}/top-plugins?limit=${limit}`),
  productivity: (orgId: string) => apiFetch(`/dashboard/${encodeURIComponent(orgId)}/productivity`),

  // 安装/卸载
  installPlugin: (orgId: string, pluginId: string, memberId: string, costUsd = 0) =>
    apiFetch('/install', {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, plugin_id: pluginId, member_id: memberId, cost_usd: costUsd }),
    }),
  uninstallPlugin: (orgId: string, pluginId: string, memberId: string) =>
    apiFetch('/uninstall', {
      method: 'POST',
      body: JSON.stringify({ org_id: orgId, plugin_id: pluginId, member_id: memberId }),
    }),
};

export default enterpriseHubApi;
