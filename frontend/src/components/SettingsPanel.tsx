/**
 * # ============================================================
 * # 全局设置面板组件（SettingsPanel）
 * # ============================================================
 * # 核心作用：提供平台全局配置的可视化编辑界面，
 * #           支持按 section 分组折叠、类型感知输入、部分更新保存
 * # 运行流程：
 * #   1. 组件挂载时调用 fetchConfig() 获取完整配置
 * #   2. 将配置按 section 分组展示，每 section 可折叠/展开
 * #   3. 用户编辑配置项后记录到 editedValues
 * #   4. 点击「保存设置」时调用 updateConfig() 仅提交变更的 section
 * #   5. 保存成功后调用 showToast 通知，并调用 onClose 关闭面板
 * # 输入参数（Props）：
 * #   - onClose: () => void，关闭设置面板回调
 * #   - showToast: (msg: string, type: string) => void，显示通知回调
 * # 输出结果：纯 UI 组件，无返回值
 * # ============================================================
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | Task 7 初始版本，实现全局设置面板
 * # ============================================================
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { fetchConfig, updateConfig } from '../hooks/useApi';
import type { FullConfig } from '../hooks/useApi';

// ============================================================
// Props 接口定义
// ============================================================

interface Props {
  /** 关闭设置面板回调 */
  onClose: () => void;
  /** 显示 Toast 通知回调：msg=消息文本，type=类型（success/error） */
  showToast: (msg: string, type?: 'success' | 'error' | 'warning' | 'info') => void;
}

// ============================================================
// Section 定义：中文标签 + YAML key + 显示顺序
// ============================================================

/** 每个配置分组的中文标签与 YAML 键名映射 */
const SECTION_DEFINITIONS: { key: keyof FullConfig; label: string; order: number }[] = [
  { key: 'server', label: '服务配置', order: 1 },
  { key: 'quota', label: '配额管控', order: 2 },
  { key: 'context', label: '上下文管理', order: 3 },
  { key: 'architecture', label: '架构设计', order: 4 },
  { key: 'evaluation', label: '系统评测', order: 5 },
  { key: 'human_review', label: '人工审核', order: 6 },
  { key: 'git', label: 'Git 管理', order: 7 },
  { key: 'memory_store', label: '记忆库', order: 8 },
  { key: 'security', label: '安全管控', order: 9 },
  { key: 'notification', label: '告警通知', order: 10 },
];

// ============================================================
// 辅助函数
// ============================================================

/**
 * 判断值类型，用于渲染对应的输入控件
 * @param val - 配置值
 * @returns 类型字符串：'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'
 */
function getValueType(val: unknown): 'string' | 'number' | 'boolean' | 'array' | 'object' | 'null' {
  if (val === null || val === undefined) return 'null';
  if (typeof val === 'boolean') return 'boolean';
  if (typeof val === 'number') return 'number';
  if (Array.isArray(val)) return 'array';
  if (typeof val === 'object') return 'object';
  return 'string';
}

/**
 * 将配置项的键名转换为可读的中文标签（fallback 为原始 key）
 * @param key - 配置项键名（如 host、port）
 * @returns 可读的中文标签（如「主机地址」「端口号」）
 */
function getItemLabel(key: string): string {
  const labelMap: Record<string, string> = {
    host: '主机地址',
    port: '端口号',
    cors_origins: '跨域来源',
    type: '类型',
    path: '路径',
    executable: '可执行程序',
    default_timeout: '默认超时（秒）',
    max_retries: '最大重试次数',
    retry_base_delay: '重试基础延迟（秒）',
    max_concurrent: '最大并发数',
    env: '环境变量',
    strategy: '调度策略',
    max_iterations: '最大迭代次数',
    health_check_interval: '健康检查间隔（秒）',
    level: '日志级别',
    dir: '日志目录',
    max_bytes: '最大文件大小（字节）',
    backup_count: '备份数量',
    data_dir: '数据目录',
    workspace_dir: '工作区目录',
    per_5_hours: '每 5 小时配额',
    per_week: '每周配额',
    per_month: '每月配额',
    alert_level_1: '一级告警阈值（%）',
    alert_level_2: '二级告警阈值（%）',
    alert_level_3: '三级告警阈值（%）',
    max_parallel_normal: '无告警时最大并行数',
    max_parallel_level_1: '一级告警时最大并行数',
    max_parallel_level_2: '二级告警时最大并行数',
    max_parallel_level_3: '三级告警时最大并行数',
    max_calls_per_minute_normal: '无告警时每分钟最大调用',
    max_calls_per_minute_level_1: '一级告警时每分钟最大调用',
    max_calls_per_minute_level_2: '二级告警时每分钟最大调用',
    max_calls_per_minute_level_3: '三级告警时每分钟最大调用',
    auto_restart_high_priority: '熔断后自动重启高优任务',
    auto_restart_wait_minutes: '等待用户确认分钟数',
    low_priority_starvation_hours: '低优任务防饿死（小时）',
    compression_threshold: '压缩触发阈值（%）',
    max_context_tokens: '最大上下文 Token 数',
    reserved_constraint_tokens: '全局约束保留 Token 数',
    max_critic_iterations: '架构批判最大迭代次数',
    max_human_rejections: '人工驳回最大次数',
    default_timeout_hours: '默认超时时限（小时）',
    stall_days: '暂停标记天数',
    nodes: '节点超时配置',
    branch_strategy: '分支策略',
    auto_commit_mode: '自动提交模式',
    protected_branches: '保护分支列表',
    commit_extensions: '提交文件扩展名',
    ignore_patterns: '忽略文件模式',
    default_branches: '默认分支',
    gitflow_branches: 'Gitflow 分支',
    embedding_model: '嵌入模型',
    code_embedding_model: '代码嵌入模型',
    local_model_path: '本地模型路径',
    similarity_threshold: '相似度阈值',
    max_search_results: '最大检索结果数',
    max_review_iterations: '安全审查最大迭代次数',
    tools: '安全校验工具',
    cppcheck_enabled: 'CppCheck 启用',
    clang_tidy_enabled: 'Clang-Tidy 启用',
    pylint_enabled: 'Pylint 启用',
    roslint_enabled: 'ROS Lint 启用',
    channel: '通知渠道',
    webhook_url: 'Webhook URL',
    min_alert_level: '最低告警级别',
    enabled: '启用',
    cache_ttl_seconds: '缓存 TTL（秒）',
    knowledge_base_path: '知识库路径',
    ANTHROPIC_AUTH_TOKEN: 'API 认证 Token',
    ANTHROPIC_BASE_URL: 'API 基础地址',
    ANTHROPIC_MODEL: '默认模型',
    ANTHROPIC_DEFAULT_OPUS_MODEL: 'Opus 默认模型',
    ANTHROPIC_DEFAULT_SONNET_MODEL: 'Sonnet 默认模型',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Haiku 默认模型',
    CLAUDE_CODE_SUBAGENT_MODEL: '子代理模型',
    CLAUDE_CODE_EFFORT_LEVEL: '努力级别',
    API_TIMEOUT_MS: 'API 超时（毫秒）',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '禁用非必要流量',
    network_error_max_retries: '网络错误最大重试',
    network_error_backoff_base: '退避基础间隔（秒）',
    network_error_backoff_multiplier: '退避乘数',
    timeout_consecutive_limit: '连续超时限制',
    platform_error_max_retries: '平台错误最大重试',
    format_error_max_rewrites: '格式错误最大重写',
  };
  return labelMap[key] || key;
}

// ============================================================
// 配置项渲染子组件
// ============================================================

/**
 * 配置项的值输入控件
 * 作用：根据值类型渲染对应的输入控件（文本、数字、布尔开关、数组/对象展示）
 * 调用方：SettingsPanel 主组件
 * 被调用方：无
 * 参数：
 *   - keyName: string，配置项键名
 *   - value: unknown，当前值
 *   - onChange: (key: string, value: unknown) => void，值变更回调
 */
function ConfigValueInput({
  keyName,
  value,
  onChange,
}: {
  keyName: string;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
}) {
  const valType = getValueType(value);

  // 布尔值：渲染开关 toggle
  if (valType === 'boolean') {
    return (
      <label className="relative inline-flex items-center cursor-pointer">
        <input
          type="checkbox"
          checked={value as boolean}
          onChange={(e) => onChange(keyName, e.target.checked)}
          className="sr-only peer"
        />
        <div
          className="w-9 h-5 bg-surface-500/40 peer-focus:outline-none rounded-full
                      peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full
                      peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px]
                      after:start-[2px] after:bg-white after:rounded-full after:h-4 after:w-4
                      after:transition-all peer-checked:bg-hermes-500"
        />
      </label>
    );
  }

  // 数字：渲染 number input
  if (valType === 'number') {
    return (
      <input
        type="number"
        value={value as number}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          onChange(keyName, isNaN(parsed) ? 0 : parsed);
        }}
        className="w-full px-3 py-1.5 text-sm rounded-md
                   bg-surface-300/60 border border-surface-500/40
                   text-surface-900 placeholder-surface-600
                   focus:outline-none focus:border-hermes-500/60 focus:ring-1 focus:ring-hermes-500/30
                   transition-colors"
      />
    );
  }

  // 数组：渲染为逗号分隔的字符串输入
  if (valType === 'array') {
    const arrValue = Array.isArray(value) ? value : [];
    const strValue = arrValue.join(', ');
    return (
      <input
        type="text"
        value={strValue}
        onChange={(e) => {
          const items = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
          onChange(keyName, items);
        }}
        placeholder="用逗号分隔..."
        className="w-full px-3 py-1.5 text-sm rounded-md
                   bg-surface-300/60 border border-surface-500/40
                   text-surface-900 placeholder-surface-600
                   focus:outline-none focus:border-hermes-500/60 focus:ring-1 focus:ring-hermes-500/30
                   transition-colors"
      />
    );
  }

  // 对象：以只读 JSON 展示
  if (valType === 'object') {
    return (
      <textarea
        rows={3}
        value={JSON.stringify(value, null, 2)}
        readOnly
        className="w-full px-3 py-1.5 text-xs rounded-md font-mono
                   bg-surface-300/60 border border-surface-500/40
                   text-surface-700 opacity-80 resize-none cursor-default"
      />
    );
  }

  // 字符串：渲染 text input
  return (
    <input
      type="text"
      value={value as string}
      onChange={(e) => onChange(keyName, e.target.value)}
      className="w-full px-3 py-1.5 text-sm rounded-md
                 bg-surface-300/60 border border-surface-500/40
                 text-surface-900 placeholder-surface-600
                 focus:outline-none focus:border-hermes-500/60 focus:ring-1 focus:ring-hermes-500/30
                 transition-colors"
    />
  );
}

// ============================================================
// 主组件
// ============================================================

export default function SettingsPanel({ onClose, showToast }: Props) {
  /** 完整配置数据 */
  const [config, setConfig] = useState<FullConfig | null>(null);
  /** 加载状态 */
  const [loading, setLoading] = useState(true);
  /** 展开的 section 集合（key 集合） */
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  /** 用户编辑后的值：key 格式为 "sectionKey.itemKey" */
  const [editedValues, setEditedValues] = useState<Record<string, unknown>>({});
  /** 保存中状态 */
  const [saving, setSaving] = useState(false);

  // v1.1.0：使用 useRef 保持 showToast 引用最新，避免 useEffect 因回调变化而重复触发 fetchConfig
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;

  // ============================================================
  // 挂载时加载配置
  // ============================================================
  useEffect(() => {
    setLoading(true);
    fetchConfig()
      .then((data) => {
        setConfig(data);
        // 默认展开第一个 section
        if (SECTION_DEFINITIONS.length > 0) {
          setExpandedSections(new Set([SECTION_DEFINITIONS[0].key]));
        }
      })
      .catch((e) => {
        showToastRef.current(`加载配置失败：${(e as Error).message}`, 'error');
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- showToast 通过 ref 访问，无需作为依赖
  }, []);

  // ============================================================
  // 切换 section 折叠/展开
  // ============================================================
  const toggleSection = useCallback((sectionKey: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  }, []);

  // ============================================================
  // 编辑值变更处理
  // ============================================================
  const handleValueChange = useCallback((compositeKey: string, newValue: unknown) => {
    setEditedValues(prev => ({ ...prev, [compositeKey]: newValue }));
  }, []);

  // ============================================================
  // 保存设置
  // ============================================================
  const handleSave = useCallback(async () => {
    if (!config) return;

    // 将 editedValues 按 section 分组，构建 patch
    const patch: Partial<FullConfig> = {};
    for (const compositeKey of Object.keys(editedValues)) {
      const dotIndex = compositeKey.indexOf('.');
      const sectionKey = compositeKey.substring(0, dotIndex) as keyof FullConfig;
      const itemKey = compositeKey.substring(dotIndex + 1);

      if (!patch[sectionKey]) {
        // 复制原始 section 值作为基础
        patch[sectionKey] = { ...(config[sectionKey] as Record<string, unknown>) };
      }
      (patch[sectionKey] as Record<string, unknown>)[itemKey] = editedValues[compositeKey];
    }

    if (Object.keys(patch).length === 0) {
      showToast('没有需要保存的更改', 'info');
      return;
    }

    setSaving(true);
    try {
      const updated = await updateConfig(patch);
      setConfig(updated);
      setEditedValues({});
      showToast('设置已保存，配置已实时生效', 'success');
    } catch (e) {
      showToast(`保存失败：${(e as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [config, editedValues, showToast]);

  // ============================================================
  // 按 order 排序的 section 列表
  // ============================================================
  const sortedSections = useMemo(
    () => [...SECTION_DEFINITIONS].sort((a, b) => a.order - b.order),
    [],
  );

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* ============================================================ */}
      {/* 标题栏：返回按钮 + 标题 + 保存按钮 */}
      {/* ============================================================ */}
      <header
        className="flex items-center justify-between px-6 py-4 flex-shrink-0
                   bg-surface-100/80 backdrop-blur-md border-b border-surface-300/50"
      >
        <div className="flex items-center gap-3">
          {/* 返回按钮 */}
          <button
            onClick={onClose}
            className="icon-btn"
            title="返回主界面"
            aria-label="返回主界面"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <h1 className="text-lg font-bold text-white tracking-tight">全局设置</h1>
        </div>

        {/* 保存按钮 */}
        <button
          onClick={handleSave}
          disabled={loading || saving || Object.keys(editedValues).length === 0}
          className="btn-primary !rounded-lg text-sm flex items-center gap-2
                     disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saving ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              保存中...
            </>
          ) : (
            '保存设置'
          )}
        </button>
      </header>

      {/* ============================================================ */}
      {/* 配置分组列表（可滚动） */}
      {/* ============================================================ */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {/* 加载骨架屏 */}
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton h-20 w-full rounded-xl" />
            ))}
          </div>
        )}

        {/* 配置分组 */}
        {config &&
          sortedSections.map(sectionDef => {
            const sectionKey = sectionDef.key;
            const sectionData = config[sectionKey] as Record<string, unknown> | undefined;
            // 跳过空 section
            if (!sectionData || Object.keys(sectionData).length === 0) return null;

            const isExpanded = expandedSections.has(sectionKey);
            // 统计该 section 中已修改的项数
            const sectionEditedCount = Object.keys(editedValues).filter(k =>
              k.startsWith(sectionKey + '.'),
            ).length;

            return (
              <div
                key={sectionKey}
                className="glass rounded-xl border border-surface-300/40 overflow-hidden
                           transition-all duration-200"
              >
                {/* ============================================================ */}
                {/* Section 标题栏（可点击折叠/展开） */}
                {/* ============================================================ */}
                <button
                  onClick={() => toggleSection(sectionKey)}
                  className="w-full flex items-center justify-between px-4 py-3
                             hover:bg-surface-200/40 transition-colors duration-150
                             text-left"
                >
                  <div className="flex items-center gap-3">
                    {/* 折叠/展开箭头 */}
                    <svg
                      className={`w-4 h-4 text-surface-600 transition-transform duration-200
                                  ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M9 5l7 7-7 7" />
                    </svg>
                    {/* Section 名称 */}
                    <span className="text-sm font-semibold text-surface-900">
                      {sectionDef.label}
                    </span>
                    {/* 配置项数量 */}
                    <span className="text-xs text-surface-600">
                      ({Object.keys(sectionData).length} 项)
                    </span>
                  </div>
                  {/* 已修改标记 */}
                  {sectionEditedCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded-full
                                     bg-hermes-500/20 text-hermes-400 font-medium">
                      {sectionEditedCount} 项已修改
                    </span>
                  )}
                </button>

                {/* ============================================================ */}
                {/* Section 内容（展开时显示） */}
                {/* ============================================================ */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-surface-300/40 pt-3">
                    {Object.entries(sectionData).map(([itemKey, itemValue]) => {
                      // 跳过值为对象或数组类型中深层嵌套的复杂对象（如 cli.env、human_review.nodes）
                      // 仅在该 section 顶层渲染一级子项
                      const compositeKey = `${sectionKey}.${itemKey}`;
                      const editedValue = editedValues[compositeKey];
                      const displayValue = editedValue !== undefined ? editedValue : itemValue;

                      return (
                        <div key={itemKey} className="flex items-start gap-4">
                          {/* 配置项标签 */}
                          <label className="w-44 flex-shrink-0 pt-1.5 text-xs text-surface-700
                                            font-medium leading-tight">
                            {getItemLabel(itemKey)}
                          </label>
                          {/* 配置项值 */}
                          <div className="flex-1">
                            <ConfigValueInput
                              keyName={compositeKey}
                              value={displayValue}
                              onChange={handleValueChange}
                            />
                            {/* 原始键名提示（hover 显示） */}
                            <span className="text-[10px] text-surface-500 mt-0.5 block truncate"
                                  title={itemKey}>
                              {itemKey}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

        {/* 空状态 */}
        {!loading && !config && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <svg className="w-12 h-12 text-surface-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="text-sm text-surface-600">配置加载失败</p>
          </div>
        )}
      </div>
    </div>
  );
}
