/**
 * # ============================================================
 * # AtomicTaskListViewer 原子任务清单查看器组件
 * # ============================================================
 * # 核心作用：展示原子任务清单，包含整体进度条、模块级任务列表、
 * #           折叠/展开、任务状态指示、依赖关系、阻塞标记
 * # 运行流程：
 * #   1. 接收 atomicTasks 数据作为输入
 * #   2. 渲染整体进度条（百分比 + 颜色变化）
 * #   3. 渲染每个模块的任务列表，支持折叠/展开
 * #   4. 每个任务显示名称、状态圆点、依赖关系
 * #   5. 标记被阻塞的任务（blocked 状态用橙色警告）
 * #   6. 处理加载态和空数据态
 * # 输入参数：
 * #   - atomicTasks: AtomicTaskListData | null，原子任务清单数据
 * #   - loading?: boolean，加载状态
 * # 输出结果：原子任务清单查看器 UI
 * # 修改记录：
 * #   - 2026-06-29 | v2.2.0 | 初始创建，实现原子任务清单查看器
 * # ============================================================
 */

import { useState } from 'react';

// ============================================================
// 类型定义
// ============================================================

/** 原子任务项 */
interface AtomicTask {
  id: string;
  name: string;
  description: string;
  status: string; // pending/running/completed/failed
  priority: string; // high/medium/low
  dependencies: string[];
  acceptance_criteria: string;
  module_name: string;
}

/** 模块任务信息 */
interface AtomicModule {
  module_name: string;
  status: string; // pending/running/completed/failed
  tasks: AtomicTask[];
}

/** 原子任务清单数据（来自 API） */
export interface AtomicTaskListData {
  id: string;
  workflow_id: string;
  modules: AtomicModule[];
  tasks_json: {
    tasks: AtomicTask[];
    dependency_graph: Record<string, string[]>;
    total_tasks: number;
    total_modules: number;
    blocked_tasks: string[];
  };
  progress: number;
  status: string;
  created_at: string | null;
  updated_at: string | null;
}

interface Props {
  /** 原子任务清单数据 */
  atomicTasks: AtomicTaskListData | null;
  /** 加载状态 */
  loading?: boolean;
}

// ============================================================
// 颜色映射
// ============================================================

/**
 * 任务状态颜色映射
 * 作用：将任务状态映射为对应的 Tailwind 颜色类名
 * pending=灰色，running=紫色(动画)，completed=绿色，failed=红色
 */
const statusColorMap: Record<string, { dot: string; text: string; bg: string }> = {
  pending:   { dot: 'bg-surface-400', text: 'text-surface-500', bg: 'bg-surface-100/50' },
  running:   { dot: 'bg-hermes-400 animate-pulse', text: 'text-hermes-400', bg: 'bg-hermes-500/10' },
  completed: { dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  done:      { dot: 'bg-emerald-400', text: 'text-emerald-400', bg: 'bg-emerald-500/10' },
  failed:    { dot: 'bg-red-400', text: 'text-red-400', bg: 'bg-red-500/10' },
};

/** 状态中文标签 */
const statusLabelMap: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  completed: '已完成',
  done: '已完成',
  failed: '失败',
};
void statusLabelMap; // 标记为有意保留（防止 TS6133 noUnusedLocals 报警；后续重构可能引用）

/** 优先级中文标签 */
const priorityLabelMap: Record<string, string> = {
  high: '高',
  medium: '中',
  low: '低',
};

/** 优先级颜色 */
const priorityColorMap: Record<string, string> = {
  high: 'text-red-400 bg-red-500/20',
  medium: 'text-orange-400 bg-orange-500/20',
  low: 'text-surface-500 bg-surface-300/50',
};

/**
 * 进度条颜色映射
 * 作用：根据进度百分比返回对应的 Tailwind 颜色类名
 * <30=红色，30-60=黄色，60-90=蓝色，>=90=绿色
 */
function getProgressColor(progress: number): string {
  if (progress >= 90) return 'bg-emerald-500';
  if (progress >= 60) return 'bg-blue-500';
  if (progress >= 30) return 'bg-yellow-500';
  return 'bg-red-500';
}

// ============================================================
// 子组件
// ============================================================

/**
 * 模块折叠卡片组件
 * 作用：渲染单个模块及其下的任务列表，支持折叠/展开
 * 参数：
 *   - module: AtomicModule，模块数据
 *   - blockedTaskIds: Set<string>，被阻塞的任务 ID 集合
 */
function ModuleCard({ module, blockedTaskIds }: { module: AtomicModule; blockedTaskIds: Set<string> }) {
  const [expanded, setExpanded] = useState(true); // 默认展开

  const tasks = module.tasks || [];
  const completedCount = tasks.filter(t => t.status === 'completed' || t.status === 'done').length;
  const moduleStatus = module.status;

  return (
    <div className="bg-surface-100/50 rounded-lg border border-surface-300 overflow-hidden transition-all duration-200">
      {/* 模块标题栏 */}
      <button
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-surface-100/70 transition-colors duration-150 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {/* 展开/收起箭头 */}
        <span className={`text-surface-500 transition-transform duration-200 text-xs flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}>
          ▶
        </span>

        {/* 模块名称 */}
        <span className="text-sm font-medium text-surface-900 flex-1 truncate">
          {module.module_name}
        </span>

        {/* 模块状态指示 */}
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
          moduleStatus === 'completed' ? 'bg-emerald-400' :
          moduleStatus === 'running' ? 'bg-hermes-400 animate-pulse' :
          moduleStatus === 'failed' ? 'bg-red-400' :
          'bg-surface-400'
        }`} />

        {/* 任务统计 */}
        <span className="text-xs text-surface-500 flex-shrink-0">
          {completedCount}/{tasks.length}
        </span>
      </button>

      {/* 展开的任务列表 */}
      {expanded && tasks.length > 0 && (
        <div className="border-t border-surface-300">
          {tasks.map((task, index) => {
            const statusStyle = statusColorMap[task.status] || statusColorMap.pending;
            const isBlocked = blockedTaskIds.has(task.id);

            return (
              <div
                key={task.id || index}
                className={`px-4 py-2.5 flex items-center gap-3 transition-colors duration-150
                  ${index < tasks.length - 1 ? 'border-b border-surface-200' : ''}
                  ${isBlocked ? 'bg-orange-500/5' : ''}`}
              >
                {/* 任务状态圆点 */}
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${statusStyle.dot}`} />

                {/* 任务名称 */}
                <span className={`text-sm flex-1 truncate ${isBlocked ? 'text-orange-500' : statusStyle.text}`}>
                  {task.name}
                  {/* 阻塞标记 */}
                  {isBlocked && (
                    <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium bg-orange-500/20 text-orange-400">
                      阻塞
                    </span>
                  )}
                </span>

                {/* 优先级徽章 */}
                {task.priority && task.priority !== 'medium' && (
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${priorityColorMap[task.priority] || ''}`}>
                    {priorityLabelMap[task.priority] || task.priority}
                  </span>
                )}

                {/* 依赖数量提示 */}
                {task.dependencies && task.dependencies.length > 0 && (
                  <span className="text-xs text-surface-400 flex-shrink-0" title={task.dependencies.join(', ')}>
                    ↳{task.dependencies.length}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 空任务列表 */}
      {expanded && tasks.length === 0 && (
        <div className="border-t border-surface-300 px-4 py-3 text-xs text-surface-500">
          该模块暂无任务
        </div>
      )}
    </div>
  );
}

// ============================================================
// 主组件
// ============================================================

export default function AtomicTaskListViewer({ atomicTasks, loading }: Props) {
  // ============================================================
  // 加载态
  // ============================================================
  if (loading) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-40 rounded mb-4" />
        <div className="skeleton h-4 w-full rounded mb-2" />
        <div className="skeleton h-3 w-full rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="skeleton h-16 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (!atomicTasks || !atomicTasks.modules || atomicTasks.modules.length === 0) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">📋</span>
          <span>暂无原子任务清单数据</span>
          <span className="text-xs text-surface-400 mt-1">
            请先启动工作流并完成架构设计阶段
          </span>
        </div>
      </div>
    );
  }

  // ============================================================
  // 数据提取
  // ============================================================
  const { modules, tasks_json, progress, status } = atomicTasks;
  const blockedTaskIds = new Set(tasks_json?.blocked_tasks || []);
  const totalTasks = tasks_json?.total_tasks || 0;
  const totalModules = tasks_json?.total_modules || modules.length;

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏
       * ============================================================ */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-surface-300">
        {/* 图标 */}
        <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-surface-950">原子任务清单</h3>

        {/* 统计信息 */}
        <span className="text-xs text-surface-500 bg-surface-200 px-2 py-0.5 rounded">
          {totalModules} 个模块
        </span>
        <span className="text-xs text-surface-500 bg-surface-200 px-2 py-0.5 rounded">
          {totalTasks} 个任务
        </span>

        {/* 清单状态 */}
        <span className={`text-xs px-2 py-0.5 rounded flex-shrink-0 ml-auto ${
          status === 'active' ? 'bg-emerald-500/20 text-emerald-400' :
          status === 'aggregating' ? 'bg-hermes-500/20 text-hermes-400' :
          status === 'completed' ? 'bg-blue-500/20 text-blue-400' :
          'bg-surface-200 text-surface-500'
        }`}>
          {status === 'active' ? '活跃' :
           status === 'aggregating' ? '聚合中' :
           status === 'completed' ? '已完成' : status}
        </span>
      </div>

      {/* ============================================================
       * 整体进度条
       * ============================================================ */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-medium text-surface-600">整体进度</span>
          <span className="text-xs font-mono font-medium text-surface-700">
            {progress.toFixed(1)}%
          </span>
        </div>
        <div className="w-full h-2.5 bg-surface-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ease-out ${getProgressColor(progress)}`}
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      </div>

      {/* ============================================================
       * 模块任务列表
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0 space-y-2">
        {modules.map((module, index) => (
          <ModuleCard
            key={module.module_name || index}
            module={module}
            blockedTaskIds={blockedTaskIds}
          />
        ))}
      </div>

      {/* ============================================================
       * 底部阻塞任务统计
       * ============================================================ */}
      {blockedTaskIds.size > 0 && (
        <div className="mt-4 pt-3 border-t border-surface-300">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400 flex-shrink-0" />
            <span className="text-xs text-orange-400 font-medium">
              {blockedTaskIds.size} 个任务被阻塞（依赖未完成）
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
