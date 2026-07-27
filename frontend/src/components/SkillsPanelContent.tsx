/**
 * # ============================================================
 * Skills 面板内容组件 (v2.0.0) - Cycle 8 P0-13
 * # ============================================================
 * 核心作用：弹窗中显示 .trae/commands/ 自定义命令 + 已有 Skills
 * 升级内容：
 *   - 双视图：项目级 / 全局级 Tab 切换
 *   - 分类树形展示
 *   - 自定义命令预览
 *   - 执行命令（生成提示词）
 *   - 重新扫描 + 创建/删除
 * 创建日期：2026-07-27
 * 模块版本：v2.0.0 - Cycle 8 P0-13
 * ============================================================
 */

import React, { useMemo, useState } from 'react';
import { useSkills, type Skill } from '../hooks/useCycle2Api';
import {
  useCustomCommandsList,
  useCustomCommandSummary,
  useExecuteCustomCommand,
  useRefreshCustomCommands,
  useDeleteCustomCommand,
  type CustomCommand,
  type CustomCommandScope,
} from '../hooks/useCustomCommands';

interface SkillsPanelContentProps {
  onClose?: () => void;
}

type TabType = 'project' | 'global' | 'builtin';

export const SkillsPanelContent: React.FC<SkillsPanelContentProps> = () => {
  const [activeTab, setActiveTab] = useState<TabType>('project');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [previewCommand, setPreviewCommand] = useState<CustomCommand | null>(null);
  const [executeResult, setExecuteResult] = useState<string | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [newCommand, setNewCommand] = useState({
    name: '',
    description: '',
    instructions: '',
    category: 'general',
    icon: '📦',
  });

  // 内置 Skills (来自原有 useCycle2Api)
  const { skills, loading: skillsLoading } = useSkills();

  // 自定义命令 (来自 useCustomCommands)
  const scope: CustomCommandScope | undefined =
    activeTab === 'project' ? 'project' : activeTab === 'global' ? 'global' : undefined;
  const {
    commands,
    categories,
    loading: commandsLoading,
    refetch: refetchCommands,
  } = useCustomCommandsList({ scope });

  const { summary, refetch: refetchSummary } = useCustomCommandSummary();
  const { execute, executing } = useExecuteCustomCommand();
  const { refresh, refreshing } = useRefreshCustomCommands();
  const { remove, deleting } = useDeleteCustomCommand();

  // 过滤命令
  const filteredCommands = useMemo(() => {
    let result = commands;
    if (selectedCategory) {
      result = result.filter(
        (c) => c.category === selectedCategory || c.parent_category === selectedCategory
      );
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.description.toLowerCase().includes(q) ||
          c.aliases.some((a) => a.toLowerCase().includes(q))
      );
    }
    return result;
  }, [commands, selectedCategory, searchQuery]);

  // 按分类分组
  const groupedByCategory = useMemo(() => {
    const groups: Record<string, CustomCommand[]> = {};
    for (const cmd of filteredCommands) {
      const cat = cmd.parent_category || cmd.category || 'general';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(cmd);
    }
    return groups;
  }, [filteredCommands]);

  // 处理刷新
  const handleRefresh = async () => {
    const result = await refresh();
    if (result) {
      refetchCommands();
      refetchSummary();
    }
  };

  // 处理执行
  const handleExecute = async (cmd: CustomCommand) => {
    setExecuteResult('正在生成提示词...');
    const result = await execute(cmd.name, {});
    if (result && result.success) {
      setExecuteResult(result.instructions);
    } else {
      setExecuteResult(`错误: ${result?.error || '执行失败'}`);
    }
  };

  // 处理删除
  const handleDelete = async (cmd: CustomCommand) => {
    if (!confirm(`确定要注销自定义命令 "${cmd.name}" 吗？`)) return;
    const success = await remove(cmd.name);
    if (success) {
      refetchCommands();
      refetchSummary();
    }
  };

  // 处理创建
  const handleCreate = async () => {
    if (!newCommand.name || !newCommand.description || !newCommand.instructions) {
      alert('请填写所有必填字段');
      return;
    }
    try {
      await fetch('/api/custom-commands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newCommand.name,
          description: newCommand.description,
          instructions: newCommand.instructions,
          category: newCommand.category,
          icon: newCommand.icon,
          scope: activeTab === 'global' ? 'global' : 'project',
        }),
      });
      setCreateMode(false);
      setNewCommand({ name: '', description: '', instructions: '', category: 'general', icon: '📦' });
      refetchCommands();
      refetchSummary();
    } catch (e) {
      console.error('创建失败', e);
    }
  };

  return (
    <div>
      {/* 摘要统计 */}
      {summary && (
        <div className="grid grid-cols-4 gap-2 mb-4">
          <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-3 rounded-lg">
            <div className="text-xs text-blue-600 font-medium">总命令</div>
            <div className="text-2xl font-bold text-blue-900">{summary.total}</div>
          </div>
          <div className="bg-gradient-to-br from-green-50 to-green-100 p-3 rounded-lg">
            <div className="text-xs text-green-600 font-medium">项目级</div>
            <div className="text-2xl font-bold text-green-900">{summary.by_scope.project}</div>
          </div>
          <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-3 rounded-lg">
            <div className="text-xs text-purple-600 font-medium">全局级</div>
            <div className="text-2xl font-bold text-purple-900">{summary.by_scope.global}</div>
          </div>
          <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-3 rounded-lg">
            <div className="text-xs text-orange-600 font-medium">分类数</div>
            <div className="text-2xl font-bold text-orange-900">
              {summary.categories.length}
            </div>
          </div>
        </div>
      )}

      {/* Tab 切换 */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex bg-surface-100 rounded-lg p-0.5">
          {(
            [
              { key: 'project' as const, label: '项目级', icon: '📁' },
              { key: 'global' as const, label: '全局级', icon: '🌐' },
              { key: 'builtin' as const, label: '内置 Skills', icon: '🧩' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.key}
              onClick={() => {
                setActiveTab(tab.key);
                setSelectedCategory(null);
              }}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-white text-hermes-600 shadow-sm font-medium'
                  : 'text-surface-600 hover:text-surface-900'
              }`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-sm bg-surface-100 text-surface-700 rounded-lg hover:bg-surface-200 disabled:opacity-50"
          >
            {refreshing ? '刷新中...' : '🔄 刷新'}
          </button>
          {activeTab !== 'builtin' && (
            <button
              onClick={() => setCreateMode(!createMode)}
              className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded-lg hover:bg-hermes-600"
            >
              {createMode ? '取消' : '+ 新建命令'}
            </button>
          )}
        </div>
      </div>

      {/* 搜索框 + 分类过滤 */}
      {activeTab !== 'builtin' && (
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="搜索命令..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-3 py-1.5 text-sm border border-surface-200 rounded-lg"
          />
          {categories.length > 0 && (
            <select
              value={selectedCategory || ''}
              onChange={(e) => setSelectedCategory(e.target.value || null)}
              className="px-3 py-1.5 text-sm border border-surface-200 rounded-lg"
            >
              <option value="">全部分类</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {/* 创建表单 */}
      {createMode && (
        <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
          <input
            type="text"
            placeholder="命令名 (kebab-case)"
            value={newCommand.name}
            onChange={(e) => setNewCommand({ ...newCommand, name: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg"
          />
          <input
            type="text"
            placeholder="描述"
            value={newCommand.description}
            onChange={(e) => setNewCommand({ ...newCommand, description: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg"
          />
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="分类"
              value={newCommand.category}
              onChange={(e) => setNewCommand({ ...newCommand, category: e.target.value })}
              className="flex-1 px-3 py-2 text-sm border border-surface-200 rounded-lg"
            />
            <input
              type="text"
              placeholder="图标"
              value={newCommand.icon}
              onChange={(e) => setNewCommand({ ...newCommand, icon: e.target.value })}
              className="w-20 px-3 py-2 text-sm border border-surface-200 rounded-lg"
            />
          </div>
          <textarea
            placeholder="Instructions (LLM 提示词内容)"
            value={newCommand.instructions}
            onChange={(e) => setNewCommand({ ...newCommand, instructions: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg font-mono"
          />
          <button
            onClick={handleCreate}
            className="w-full px-3 py-2 text-sm bg-hermes-500 text-white rounded-lg hover:bg-hermes-600"
          >
            创建命令
          </button>
        </div>
      )}

      {/* 执行结果预览 */}
      {executeResult && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-green-700">📝 渲染后的提示词</span>
            <button
              onClick={() => setExecuteResult(null)}
              className="text-xs text-green-600 hover:text-green-800"
            >
              ✕
            </button>
          </div>
          <pre className="text-xs text-green-900 whitespace-pre-wrap max-h-40 overflow-y-auto">
            {executeResult}
          </pre>
        </div>
      )}

      {/* 命令列表 */}
      <div className="max-h-96 overflow-y-auto">
        {activeTab === 'builtin' ? (
          // 内置 Skills
          skillsLoading ? (
            <div className="text-center py-8 text-surface-500">加载中...</div>
          ) : skills.length === 0 ? (
            <div className="text-center py-8 text-surface-500">暂无内置 Skills</div>
          ) : (
            <div className="space-y-2">
              {skills.map((skill: Skill) => (
                <div
                  key={skill.id}
                  className="p-3 border border-surface-200 rounded-lg"
                >
                  <div className="font-medium text-surface-900">
                    {skill.display_name}{' '}
                    <span className="text-xs text-surface-500 font-mono">
                      {skill.name}
                    </span>
                  </div>
                  <p className="text-sm text-surface-600 mt-1">{skill.description}</p>
                </div>
              ))}
            </div>
          )
        ) : commandsLoading ? (
          <div className="text-center py-8 text-surface-500">加载中...</div>
        ) : filteredCommands.length === 0 ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-2">📦</div>
            <div className="text-surface-500 text-sm">
              {activeTab === 'project'
                ? '项目级目录 .trae/commands/ 中暂无命令'
                : '全局级目录 ~/.trae/commands/ 中暂无命令'}
            </div>
            <div className="text-xs text-surface-400 mt-1">
              在对应目录创建 .md 文件后点击刷新
            </div>
          </div>
        ) : (
          // 按分类分组
          <div className="space-y-3">
            {Object.entries(groupedByCategory).map(([cat, cmds]) => (
              <div key={cat}>
                <div className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-1 px-1">
                  📂 {cat}
                </div>
                <div className="space-y-1">
                  {cmds.map((cmd) => (
                    <div
                      key={cmd.name}
                      className="p-2.5 border border-surface-200 rounded-lg hover:border-hermes-300 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{cmd.icon}</span>
                            <code className="text-sm font-mono font-semibold text-hermes-700">
                              /{cmd.name}
                            </code>
                            {cmd.aliases.length > 0 && (
                              <span className="text-xs text-surface-400">
                                ({cmd.aliases.join(', ')})
                              </span>
                            )}
                            <span
                              className={`text-xs px-1.5 py-0.5 rounded ${
                                cmd.scope === 'project'
                                  ? 'bg-blue-50 text-blue-600'
                                  : 'bg-purple-50 text-purple-600'
                              }`}
                            >
                              {cmd.scope}
                            </span>
                          </div>
                          <p className="text-xs text-surface-600 mt-0.5 truncate">
                            {cmd.description}
                          </p>
                          {cmd.args.length > 0 && (
                            <div className="text-xs text-surface-500 mt-1">
                              参数: {cmd.args.map((a) => a.name + (a.required ? '*' : '')).join(', ')}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => setPreviewCommand(cmd)}
                            className="px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded"
                            title="查看详情"
                          >
                            👁
                          </button>
                          <button
                            onClick={() => handleExecute(cmd)}
                            disabled={executing}
                            className="px-2 py-1 text-xs text-green-600 hover:bg-green-50 rounded disabled:opacity-50"
                            title="执行"
                          >
                            ▶
                          </button>
                          <button
                            onClick={() => handleDelete(cmd)}
                            disabled={deleting}
                            className="px-2 py-1 text-xs text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                            title="注销"
                          >
                            🗑
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 命令详情预览 */}
      {previewCommand && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={() => setPreviewCommand(null)}
        >
          <div
            className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-surface-900">
                {previewCommand.icon} /{previewCommand.name}
              </h3>
              <button
                onClick={() => setPreviewCommand(null)}
                className="text-surface-400 hover:text-surface-600"
              >
                ✕
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <div className="text-xs font-medium text-surface-500">描述</div>
                <div className="text-sm text-surface-800">{previewCommand.description}</div>
              </div>
              {previewCommand.aliases.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-surface-500">别名</div>
                  <div className="text-sm text-surface-800">
                    {previewCommand.aliases.join(', ')}
                  </div>
                </div>
              )}
              {previewCommand.args.length > 0 && (
                <div>
                  <div className="text-xs font-medium text-surface-500">参数</div>
                  <div className="space-y-1">
                    {previewCommand.args.map((arg) => (
                      <div key={arg.name} className="text-sm">
                        <code className="text-hermes-600">{arg.name}</code>
                        {arg.required && <span className="text-red-500">*</span>}
                        <span className="text-surface-600"> - {arg.description}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs font-medium text-surface-500">Instructions</div>
                <pre className="text-xs text-surface-800 bg-surface-50 p-3 rounded-lg whitespace-pre-wrap">
                  {previewCommand.instructions}
                </pre>
              </div>
              <div>
                <div className="text-xs font-medium text-surface-500">文件路径</div>
                <code className="text-xs text-surface-600 break-all">
                  {previewCommand.file_path}
                </code>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SkillsPanelContent;
