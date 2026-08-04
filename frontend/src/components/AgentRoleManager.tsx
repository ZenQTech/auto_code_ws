/**
 * # ============================================================
 * # AgentRoleManager 组件 (v1.0.0)
 * # Cycle 63 G63-02
 * # ====================================
 * # 核心作用：Agent 角色管理 UI（4 个内置角色 + 自定义）
 * # 运行流程：
 * #   1. 列出所有角色（内置标记徽章）
 * #   2. 查看/编辑/删除自定义角色
 * #   3. 注册新角色（name/description/model/sandbox...）
 * #   4. spawn 实例（带 nickname 轮转）
 * #   5. 查看运行中实例 / 取消实例
 * # 输入参数：testId
 * # 输出结果：UI 组件
 * # 对标：Codex CLI v0.105+ sub-agent 系统
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 63 G63-02 初次创建
 * # ====================================
 */

import { useEffect, useState } from 'react';
import { useAgentRoles, type AgentRole } from '../hooks/useAgentRoles';

export interface AgentRoleManagerProps {
  testId?: string;
  onRoleSelect?: (role: AgentRole) => void;
  onInstanceSpawned?: (agentId: string) => void;
}

const SANDBOX_MODES = [
  { value: 'read-only', label: '只读', icon: '🔒' },
  { value: 'workspace-write', label: '工作区可写', icon: '✏️' },
  { value: 'danger-full-access', label: '完全访问', icon: '⚠️' },
  { value: 'none', label: '无沙箱', icon: '🚫' },
];

const REASONING_EFFORTS = [
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
];

const STATUS_COLORS: Record<string, string> = {
  spawning: 'var(--accent-warning)',
  running: 'var(--accent-success)',
  idle: 'var(--text-secondary)',
  failed: 'var(--accent-error)',
  dead: 'var(--text-secondary)',
};

const STATUS_LABELS: Record<string, string> = {
  spawning: '启动中',
  running: '运行中',
  idle: '已完成',
  failed: '失败',
  dead: '已取消',
};

export default function AgentRoleManager(props: AgentRoleManagerProps) {
  const { testId = 'agent-role-manager', onRoleSelect, onInstanceSpawned } = props;
  const api = useAgentRoles({ autoRefreshMs: 5000 });
  const [showCreate, setShowCreate] = useState(false);
  const [spawnRole, setSpawnRole] = useState<AgentRole | null>(null);
  const [spawnTask, setSpawnTask] = useState('');
  const [spawnNickname, setSpawnNickname] = useState('');

  // 新角色表单状态
  const [form, setForm] = useState({
    name: '',
    description: '',
    developer_instructions: '',
    nickname_candidates: '',
    model: '',
    model_reasoning_effort: 'medium',
    sandbox_mode: 'workspace-write',
    mcp_servers: '',
    skills: '',
  });

  useEffect(() => {
    api.loadRoles();
    api.loadInstances();
    api.loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCreate = async () => {
    const req = {
      name: form.name.trim(),
      description: form.description,
      developer_instructions: form.developer_instructions,
      nickname_candidates: form.nickname_candidates
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      model: form.model || null,
      model_reasoning_effort: form.model_reasoning_effort,
      sandbox_mode: form.sandbox_mode,
      mcp_servers: form.mcp_servers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      skills: form.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (!req.name) return;
    const role = await api.createRole(req);
    if (role) {
      setShowCreate(false);
      setForm({
        name: '',
        description: '',
        developer_instructions: '',
        nickname_candidates: '',
        model: '',
        model_reasoning_effort: 'medium',
        sandbox_mode: 'workspace-write',
        mcp_servers: '',
        skills: '',
      });
    }
  };

  const handleSpawn = async () => {
    if (!spawnRole || !spawnTask.trim()) return;
    const inst = await api.spawnInstance(spawnRole.name, {
      task: spawnTask,
      nickname: spawnNickname || undefined,
    });
    if (inst && onInstanceSpawned) {
      onInstanceSpawned(inst.agent_id);
    }
    setSpawnRole(null);
    setSpawnTask('');
    setSpawnNickname('');
  };

  const handleDelete = async (name: string) => {
    if (confirm(`确定删除自定义角色 "${name}"？`)) {
      await api.deleteRole(name);
    }
  };

  return (
    <div
      data-testid={testId}
      className="flex flex-col h-full bg-[var(--bg-panel)] text-[var(--text-primary)] rounded-lg overflow-hidden"
    >
      {/* Header */}
      <div
        data-testid={`${testId}-header`}
        className="px-4 py-3 border-b border-[var(--border-color)] flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">🤖</span>
          <h2 className="text-sm font-semibold">Agent 角色管理</h2>
          {api.stats && (
            <span
              data-testid={`${testId}-stats`}
              className="text-xs text-[var(--text-secondary)]"
            >
              {api.stats.total_roles} 个角色 · {api.stats.running_instances} 个运行中
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid={`${testId}-new-role`}
            onClick={() => setShowCreate(true)}
            className="text-xs px-2 py-1 bg-[var(--accent-primary)] text-white rounded hover:opacity-90"
          >
            ➕ 新建角色
          </button>
          <button
            data-testid={`${testId}-refresh`}
            onClick={() => {
              api.loadRoles();
              api.loadInstances();
              api.loadStats();
            }}
            className="text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            🔄
          </button>
        </div>
      </div>

      {api.error && (
        <div
          data-testid={`${testId}-error`}
          className="m-3 p-2 text-xs text-[var(--accent-error)] bg-[var(--bg-elevated)] rounded flex items-center justify-between"
        >
          <span>❌ {api.error}</span>
          <button
            onClick={api.clearError}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex-1 grid grid-cols-2 gap-3 p-3 overflow-hidden">
        {/* 左侧：角色列表 */}
        <div
          data-testid={`${testId}-role-list`}
          className="flex flex-col overflow-hidden border border-[var(--border-color)] rounded"
        >
          <div className="px-3 py-2 text-xs font-semibold border-b border-[var(--border-color)]">
            角色
          </div>
          <div className="flex-1 overflow-y-auto">
            {api.loading && api.roles.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--text-secondary)]">加载中…</div>
            )}
            {api.roles.map((role) => (
              <div
                key={role.name}
                data-testid={`${testId}-role-${role.name}`}
                onClick={() => onRoleSelect?.(role)}
                className="px-3 py-2 border-b border-[var(--border-color)] cursor-pointer hover:bg-[var(--bg-elevated)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{role.name}</span>
                    {role.builtin && (
                      <span
                        data-testid={`${testId}-role-${role.name}-builtin`}
                        className="text-xs px-1.5 py-0.5 rounded"
                        style={{
                          color: 'var(--accent-info)',
                          borderColor: 'var(--accent-info)',
                          borderWidth: 1,
                        }}
                      >
                        内置
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      data-testid={`${testId}-role-${role.name}-spawn`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSpawnRole(role);
                      }}
                      className="text-xs px-1.5 py-0.5 bg-[var(--accent-primary)] text-white rounded hover:opacity-90"
                    >
                      ▶
                    </button>
                    {!role.builtin && (
                      <button
                        data-testid={`${testId}-role-${role.name}-delete`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(role.name);
                        }}
                        className="text-xs text-[var(--text-secondary)] hover:text-[var(--accent-error)]"
                      >
                        🗑️
                      </button>
                    )}
                  </div>
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                  {role.description || '(无描述)'}
                </div>
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {role.sandbox_mode && (
                    <span className="text-xs px-1 py-0.5 bg-[var(--bg-elevated)] rounded">
                      {SANDBOX_MODES.find((s) => s.value === role.sandbox_mode)?.icon}{' '}
                      {role.sandbox_mode}
                    </span>
                  )}
                  {role.model && (
                    <span className="text-xs px-1 py-0.5 bg-[var(--bg-elevated)] rounded">
                      🤖 {role.model}
                    </span>
                  )}
                  {role.mcp_servers.length > 0 && (
                    <span className="text-xs px-1 py-0.5 bg-[var(--bg-elevated)] rounded">
                      🔌 {role.mcp_servers.length}
                    </span>
                  )}
                  {role.skills.length > 0 && (
                    <span className="text-xs px-1 py-0.5 bg-[var(--bg-elevated)] rounded">
                      🛠️ {role.skills.length}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 右侧：实例列表 */}
        <div
          data-testid={`${testId}-instance-list`}
          className="flex flex-col overflow-hidden border border-[var(--border-color)] rounded"
        >
          <div className="px-3 py-2 text-xs font-semibold border-b border-[var(--border-color)] flex items-center justify-between">
            <span>运行中实例</span>
            {api.instances.length > 0 && (
              <span className="text-[var(--text-secondary)]">{api.instances.length}</span>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            {api.instances.length === 0 && (
              <div className="p-4 text-center text-xs text-[var(--text-secondary)]">
                暂无运行实例
              </div>
            )}
            {api.instances.map((inst) => (
              <div
                key={inst.agent_id}
                data-testid={`${testId}-instance-${inst.agent_id}`}
                className="px-3 py-2 border-b border-[var(--border-color)]"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-xs px-1.5 py-0.5 rounded"
                      style={{
                        color: STATUS_COLORS[inst.status] || 'var(--text-secondary)',
                        borderColor: STATUS_COLORS[inst.status] || 'var(--border-color)',
                        borderWidth: 1,
                      }}
                    >
                      {STATUS_LABELS[inst.status] || inst.status}
                    </span>
                    <span className="text-sm font-medium">{inst.nickname}</span>
                    <span className="text-xs text-[var(--text-secondary)]">
                      ({inst.role_name})
                    </span>
                  </div>
                  {inst.status === 'running' || inst.status === 'spawning' ? (
                    <button
                      data-testid={`${testId}-instance-${inst.agent_id}-cancel`}
                      onClick={() => api.cancelInstance(inst.agent_id)}
                      className="text-xs text-[var(--accent-error)] hover:underline"
                    >
                      取消
                    </button>
                  ) : null}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-1 line-clamp-2">
                  {inst.task}
                </div>
                <div className="text-xs text-[var(--text-secondary)] mt-0.5">
                  {new Date(inst.started_at * 1000).toLocaleString()}
                  {inst.finished_at && (
                    <span className="ml-2">· {Math.round(inst.finished_at - inst.started_at)}s</span>
                  )}
                </div>
                {inst.error && (
                  <div className="text-xs text-[var(--accent-error)] mt-1">{inst.error}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 新建角色 Modal */}
      {showCreate && (
        <div
          data-testid={`${testId}-create-modal`}
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-[var(--bg-panel)] rounded-lg shadow-lg p-4 w-[500px] max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-3">新建 Agent 角色</h3>
            <Field label="名称（必填）">
              <input
                data-testid={`${testId}-create-name`}
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="my-reviewer"
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="描述">
              <input
                data-testid={`${testId}-create-description`}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="开发者指令">
              <textarea
                data-testid={`${testId}-create-instructions`}
                value={form.developer_instructions}
                onChange={(e) => setForm({ ...form, developer_instructions: e.target.value })}
                rows={3}
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="Nickname 候选（逗号分隔）">
              <input
                data-testid={`${testId}-create-nicknames`}
                value={form.nickname_candidates}
                onChange={(e) => setForm({ ...form, nickname_candidates: e.target.value })}
                placeholder="A1, A2, A3"
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="模型（留空用默认）">
              <input
                data-testid={`${testId}-create-model`}
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="gpt-5.5"
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="推理强度">
              <select
                data-testid={`${testId}-create-effort`}
                value={form.model_reasoning_effort}
                onChange={(e) => setForm({ ...form, model_reasoning_effort: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              >
                {REASONING_EFFORTS.map((e) => (
                  <option key={e.value} value={e.value}>
                    {e.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="沙箱模式">
              <select
                data-testid={`${testId}-create-sandbox`}
                value={form.sandbox_mode}
                onChange={(e) => setForm({ ...form, sandbox_mode: e.target.value })}
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              >
                {SANDBOX_MODES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.icon} {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="MCP Servers（逗号分隔）">
              <input
                data-testid={`${testId}-create-mcp`}
                value={form.mcp_servers}
                onChange={(e) => setForm({ ...form, mcp_servers: e.target.value })}
                placeholder="github-mcp, slack-mcp"
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="Skills（逗号分隔）">
              <input
                data-testid={`${testId}-create-skills`}
                value={form.skills}
                onChange={(e) => setForm({ ...form, skills: e.target.value })}
                placeholder="code-review, test-gen"
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setShowCreate(false)}
                className="text-sm px-3 py-1 bg-[var(--bg-elevated)] rounded"
              >
                取消
              </button>
              <button
                data-testid={`${testId}-create-submit`}
                onClick={handleCreate}
                disabled={!form.name.trim()}
                className="text-sm px-3 py-1 bg-[var(--accent-primary)] text-white rounded disabled:opacity-50 hover:opacity-90"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spawn 实例 Modal */}
      {spawnRole && (
        <div
          data-testid={`${testId}-spawn-modal`}
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setSpawnRole(null)}
        >
          <div
            className="bg-[var(--bg-panel)] rounded-lg shadow-lg p-4 w-[500px]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-base font-semibold mb-3">
              启动实例：{spawnRole.name} ({spawnRole.nickname_candidates[0] || 'agent'})
            </h3>
            <Field label="任务描述">
              <textarea
                data-testid={`${testId}-spawn-task`}
                value={spawnTask}
                onChange={(e) => setSpawnTask(e.target.value)}
                rows={3}
                placeholder="描述 Agent 要执行的任务..."
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <Field label="Nickname（可选，留空则轮转）">
              <input
                data-testid={`${testId}-spawn-nickname`}
                value={spawnNickname}
                onChange={(e) => setSpawnNickname(e.target.value)}
                placeholder={spawnRole.nickname_candidates[0] || ''}
                className="w-full px-2 py-1 text-sm bg-[var(--bg-elevated)] border border-[var(--border-color)] rounded"
              />
            </Field>
            <div className="flex justify-end gap-2 mt-3">
              <button
                onClick={() => setSpawnRole(null)}
                className="text-sm px-3 py-1 bg-[var(--bg-elevated)] rounded"
              >
                取消
              </button>
              <button
                data-testid={`${testId}-spawn-submit`}
                onClick={handleSpawn}
                disabled={!spawnTask.trim() || api.spawning}
                className="text-sm px-3 py-1 bg-[var(--accent-primary)] text-white rounded disabled:opacity-50 hover:opacity-90"
              >
                {api.spawning ? '启动中…' : '▶ 启动'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-2">
      <label className="block text-xs text-[var(--text-secondary)] mb-1">{props.label}</label>
      {props.children}
    </div>
  );
}
