/**
 * # ============================================================
 * # 智能体聊天框组件 - Hermes 风格
 * # ============================================================
 * # 核心作用：单个子 Claude Code CLI 实例的聊天框，
 * #           支持展开/收起切换
 * # 运行流程：
 * #   收起状态：显示任务摘要、Token/API 统计
 * #   展开状态：显示完整对话记录和任务细节
 * # 配色方案：深色背景 + Hermes 金橙色主色调 + 过渡动画
 * # ============================================================
 * # 修改记录：
 * #   v1.0.0 - 2026-06-17：初始版本
 * #   v1.1.0 - 2026-06-17：Hermes 风格 UI 重构，替换配色方案、添加过渡动画
 * #   v1.2.0 - 2026-06-23：替换 card-hermes 为 .card-hoverable，应用 .glow-hermes-sm
 * # ============================================================
 */

import { useState, useEffect, useRef } from 'react';
import { useTasks, useConversations } from '../hooks/useApi';
import type { Agent, Task } from '../types';

interface Props {
  agent: Agent;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onAgentChanged: () => void;
}

/** 根据种子生成渐变色头像 */
function generateAvatarGradient(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 70%, 50%), hsl(${h2}, 70%, 40%))`;
}

/** 状态颜色映射 */
const statusColors: Record<string, string> = {
  online: 'bg-green-500',
  busy: 'bg-hermes-400',
  offline: 'bg-surface-500',
  error: 'bg-red-500',
};

/** 任务状态标签 */
const taskStatusLabels: Record<string, { text: string; color: string }> = {
  pending: { text: '等待中', color: 'text-surface-600' },
  running: { text: '执行中', color: 'text-hermes-400' },
  validating: { text: '验证中', color: 'text-hermes-400' },
  completed: { text: '已完成', color: 'text-emerald-400' },
  failed: { text: '失败', color: 'text-red-400' },
  cancelled: { text: '已取消', color: 'text-surface-500' },
};

export default function AgentChatCard({ agent, isExpanded, onToggleExpand, onAgentChanged }: Props) {
  const { tasks, refetch: refetchTasks } = useTasks(agent.id);
  const { conversations, refetch: refetchConversations } = useConversations(undefined, agent.id);

  // v1.3.0：使用 useRef 保持 onAgentChanged 引用最新，避免定时器因回调变化而重建
  const onAgentChangedRef = useRef(onAgentChanged);
  onAgentChangedRef.current = onAgentChanged;

  // 定时刷新
  useEffect(() => {
    const interval = setInterval(() => {
      refetchTasks();
      refetchConversations();
      onAgentChangedRef.current();
    }, 10000);
    return () => clearInterval(interval);
  }, [refetchTasks, refetchConversations]);

  const avatarGradient = generateAvatarGradient(agent.avatar_seed);

  return (
    <div
      className={`bg-surface-100 border border-surface-400 rounded-lg overflow-hidden transition-all duration-300 cursor-pointer card-hoverable
        ${isExpanded ? 'col-span-full shadow-lg shadow-hermes-900/20' : ''}`}
      onClick={onToggleExpand}
    >
      {/* 头部：头像 + 名称 + 状态 */}
      <div className="p-4 flex items-center gap-3">
        <div
          className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm"
          style={{ background: avatarGradient }}
        >
          {agent.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-surface-800 truncate">{agent.name}</span>
            <span className={`w-2 h-2 rounded-full ${statusColors[agent.status] || 'bg-surface-500'}`} />
          </div>
          <div className="text-xs text-surface-600">
            {agent.status === 'online' ? '在线' :
             agent.status === 'busy' ? '忙碌' :
             agent.status === 'offline' ? '离线' : '异常'}
            {' · '}任务 {agent.current_tasks}/{agent.max_concurrent}
          </div>
        </div>
        <div className="text-xs text-surface-600 text-right flex-shrink-0">
          <div>Token: {agent.total_tokens.toLocaleString()}</div>
          <div>API: {agent.total_api_calls}</div>
        </div>
      </div>

      {/* 收起状态：任务摘要 */}
      {!isExpanded && (
        <div className="px-4 pb-4 animate-fade-in">
          {tasks.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">📋</span>
              <span>暂无任务</span>
            </div>
          ) : (
            <div className="space-y-1.5 max-h-32 overflow-y-auto">
              {tasks.slice(0, 5).map(task => (
                <div key={task.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={`${taskStatusLabels[task.status]?.color || 'text-surface-600'} ${
                      task.status === 'running' || task.status === 'validating' ? 'inline-block glow-hermes-sm rounded-full' : ''
                    }`}
                  >
                    ●
                  </span>
                  <span className="text-surface-600 truncate flex-1">{task.title}</span>
                  <span className={taskStatusLabels[task.status]?.color || 'text-surface-600'}>
                    {taskStatusLabels[task.status]?.text || task.status}
                  </span>
                </div>
              ))}
              {tasks.length > 5 && (
                <div className="text-xs text-surface-500">...还有 {tasks.length - 5} 个任务</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 展开状态：完整对话和任务细节 */}
      {isExpanded && (
        <div className="border-t border-surface-400 animate-slide-down">
          <div className="p-4 max-h-96 overflow-y-auto space-y-3">
            {/* 任务列表 */}
            {tasks.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-surface-700 mb-2">任务列表</h4>
                <div className="space-y-2">
                  {tasks.map(task => (
                    <div key={task.id} className="bg-surface-200 rounded-md p-3 card-hoverable">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-surface-800">{task.title}</span>
                        <span className={`text-xs ${taskStatusLabels[task.status]?.color}`}>
                          {taskStatusLabels[task.status]?.text}
                        </span>
                      </div>
                      <div className="text-xs text-surface-600 flex gap-3">
                        <span>模式: {task.execution_mode}</span>
                        <span>复杂度: {task.complexity_score.toFixed(2)}</span>
                        <span>迭代: {task.iteration_count}/{task.max_iterations}</span>
                        {task.token_consumed > 0 && <span>Token: {task.token_consumed}</span>}
                      </div>
                      {task.error_message && (
                        <div className="text-xs text-red-400 mt-1">{task.error_message}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 对话记录 */}
            {conversations.length > 0 && (
              <div>
                <h4 className="text-sm font-medium text-surface-700 mb-2">对话记录</h4>
                <div className="space-y-2">
                  {conversations.map(conv => (
                    <div
                      key={conv.id}
                      className={`p-3 rounded-lg transition-all duration-300 ${
                        conv.role === 'user' ? 'bg-blue-900/20 ml-4 border border-blue-900/30' :
                        conv.role === 'assistant' ? 'bg-surface-200 mr-4 border border-surface-400' :
                        'bg-hermes-900/10 border border-hermes-900/20'
                      }`}
                    >
                      <div className="text-xs text-surface-600 mb-1">
                        {conv.role === 'user' ? '用户' :
                         conv.role === 'assistant' ? agent.name : '系统'}
                        {' · '}{new Date(conv.created_at).toLocaleTimeString()}
                      </div>
                      <div className="text-sm text-surface-700 whitespace-pre-wrap max-h-48 overflow-y-auto">
                        {conv.content.length > 1000
                          ? conv.content.slice(0, 1000) + '...'
                          : conv.content}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {tasks.length === 0 && conversations.length === 0 && (
              <div className="empty-state">
                <span className="empty-icon">💬</span>
                <span>暂无交互记录，请通过上方输入框提交任务</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
