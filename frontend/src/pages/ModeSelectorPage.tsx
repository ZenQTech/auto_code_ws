/**
 * # ============================================================
 * ModeSelectorPage - 模式选择页 (v1.1.0) - Cycle 58 G58-01
 * # ============================================================
 * 核心作用：根路由页面,显示 chat/coding/vibe-coding 三模式选择
 * 修改记录：
 *   - 2026-07-27 | v1.0.0 | Cycle 7 P1-2 新建 - 提取自 App.tsx
 *   - 2026-08-03 | v1.1.0 | Cycle 58 G58-01 新增 vibe-coding 模式卡片
 * ============================================================
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';

import { useModals } from '../hooks/useModals';

type ModeKey = 'chat' | 'coding' | 'vibe-coding';

interface ModeMeta {
  key: ModeKey;
  emoji: string;
  title: string;
  description: string;
  highlight: string;
  gradient: string;
}

const MODES: ModeMeta[] = [
  {
    key: 'chat',
    emoji: '💬',
    title: '日常办公闲聊模式',
    description: '日常对话、翻译、总结、问答等通用办公场景,简单快捷的 AI 助手体验',
    highlight: '通用办公',
    gradient: 'from-hermes-400 to-hermes-600',
  },
  {
    key: 'coding',
    emoji: '⚡',
    title: '编程模式',
    description: '提示词优化、任务规划、代码生成与调度,面向专业开发的全链路编程工作台',
    highlight: '专业开发',
    gradient: 'from-blue-400 to-indigo-600',
  },
  {
    key: 'vibe-coding',
    emoji: '🌊',
    title: 'Vibe Coding 模式',
    description: '对标 Codex/TRAE Solo 的全流程 vibe coding 体验:Loop 状态机持续可见、Auto-Follow 工具联动、ClaudeCodeShell 真实调用、Plan 真正可执行',
    highlight: 'NEW · 对标 Codex/TRAE',
    gradient: 'from-fuchsia-500 via-purple-500 to-cyan-500',
  },
];

const ModeSelectorPage: React.FC = () => {
  const navigate = useNavigate();
  // 占位以保持与 App.tsx 兼容,后续可清理
  useModals();

  const handleSelectMode = (mode: ModeKey) => {
    if (mode === 'vibe-coding') {
      navigate('/vibe-coding');
      return;
    }
    navigate(`/${mode}/new`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br
                    from-surface-50 via-white to-hermes-50/30 p-4">
      <div className="max-w-3xl w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 mb-4
                          rounded-full bg-gradient-to-br from-hermes-400 to-hermes-600
                          shadow-lg shadow-hermes-500/30">
            <span className="text-3xl">⚡</span>
          </div>
          <h1 className="text-3xl font-bold text-surface-800 mb-2">
            欢迎使用 Hermes 智能调度平台
          </h1>
          <p className="text-base text-surface-500">请选择您的工作模式</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {MODES.map((mode) => (
            <button
              key={mode.key}
              onClick={() => handleSelectMode(mode.key)}
              className="group relative bg-white border-2 border-surface-200 rounded-2xl p-6
                         text-left hover:border-hermes-400 hover:shadow-lg
                         transition-all duration-200 overflow-hidden"
              data-testid={`mode-card-${mode.key}`}
            >
              <div className={`absolute inset-x-0 top-0 h-1 bg-gradient-to-r ${mode.gradient}`} />
              <div className="text-3xl mb-3">{mode.emoji}</div>
              <h2 className="text-lg font-semibold text-surface-800 mb-1">{mode.title}</h2>
              <p className="text-sm text-surface-500 mb-3">{mode.description}</p>
              <div className="text-xs text-hermes-600 font-medium">{mode.highlight}</div>
            </button>
          ))}
        </div>

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/settings')}
            className="text-sm text-surface-500 hover:text-hermes-600 transition-colors"
          >
            前往设置 →
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModeSelectorPage;
