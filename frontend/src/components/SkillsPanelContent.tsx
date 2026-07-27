/**
 * # ============================================================
 * Skills 面板内容组件 - Cycle 2 辅助组件
 * # ============================================================
 * 核心作用：在弹窗中显示 Skills 列表，支持启用/禁用/创建/删除
 * 创建日期：2026-07-27
 * 模块版本：v1.0.0
 * ============================================================
 */

import React, { useState } from 'react';
import { useSkills, type Skill } from '../hooks/useCycle2Api';

interface SkillsPanelContentProps {
  onClose?: () => void;
}

export const SkillsPanelContent: React.FC<SkillsPanelContentProps> = () => {
  const { skills, loading, setSkillEnabled, createSkill, deleteSkill } = useSkills();
  const [showCreate, setShowCreate] = useState(false);
  const [newSkill, setNewSkill] = useState({
    name: '',
    display_name: '',
    description: '',
    system_prompt: '',
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!newSkill.name || !newSkill.display_name || !newSkill.system_prompt) {
      setError('请填写所有必填字段');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      await createSkill({
        name: newSkill.name,
        display_name: newSkill.display_name,
        description: newSkill.description,
        system_prompt: newSkill.system_prompt,
      });
      setShowCreate(false);
      setNewSkill({ name: '', display_name: '', description: '', system_prompt: '' });
    } catch (e: any) {
      setError(e.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个 Skill 吗？')) return;
    try {
      await deleteSkill(id);
    } catch (e: any) {
      setError(e.message || '删除失败');
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-surface-500">加载中...</div>;
  }

  return (
    <div>
      {error && (
        <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">{error}</div>
      )}

      <div className="mb-4 flex justify-between items-center">
        <div className="text-sm text-surface-600">
          共 {skills.length} 个 Skills（{skills.filter((s) => s.enabled).length} 已启用）
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="px-3 py-1.5 text-sm bg-hermes-500 text-white rounded-lg hover:bg-hermes-600"
        >
          {showCreate ? '取消' : '+ 新建 Skill'}
        </button>
      </div>

      {showCreate && (
        <div className="mb-4 p-4 bg-surface-50 rounded-lg space-y-3">
          <input
            type="text"
            placeholder="名称 (英文，如 code-reviewer)"
            value={newSkill.name}
            onChange={(e) => setNewSkill({ ...newSkill, name: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg"
          />
          <input
            type="text"
            placeholder="显示名称 (如 Code Reviewer)"
            value={newSkill.display_name}
            onChange={(e) => setNewSkill({ ...newSkill, display_name: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg"
          />
          <input
            type="text"
            placeholder="描述 (一句话说明)"
            value={newSkill.description}
            onChange={(e) => setNewSkill({ ...newSkill, description: e.target.value })}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg"
          />
          <textarea
            placeholder="System Prompt (注入到 LLM 的提示词)"
            value={newSkill.system_prompt}
            onChange={(e) => setNewSkill({ ...newSkill, system_prompt: e.target.value })}
            rows={4}
            className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg font-mono"
          />
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full px-3 py-2 text-sm bg-hermes-500 text-white rounded-lg hover:bg-hermes-600 disabled:opacity-50"
          >
            {creating ? '创建中...' : '创建 Skill'}
          </button>
        </div>
      )}

      <div className="space-y-2">
        {skills.length === 0 ? (
          <div className="text-center py-8 text-surface-500">暂无 Skills</div>
        ) : (
          skills.map((skill: Skill) => (
            <div
              key={skill.id}
              className="p-3 border border-surface-200 rounded-lg hover:border-hermes-300 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-surface-900">
                      {skill.display_name}
                    </span>
                    <span className="text-xs text-surface-500 font-mono">
                      {skill.name} v{skill.version}
                    </span>
                    {skill.id?.startsWith('builtin-') && (
                      <span className="text-xs px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded">
                        内置
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-surface-600 mt-1">{skill.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={(e) => setSkillEnabled(skill.id, e.target.checked)}
                      className="w-4 h-4"
                    />
                    <span className="text-sm text-surface-600">
                      {skill.enabled ? '已启用' : '已禁用'}
                    </span>
                  </label>
                  {!skill.id?.startsWith('builtin-') && (
                    <button
                      onClick={() => handleDelete(skill.id)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default SkillsPanelContent;
