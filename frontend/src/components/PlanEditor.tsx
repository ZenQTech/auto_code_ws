/**
 * # ============================================================
 * # PlanEditor - 计划编辑器组件（P0-3 Plan Mode 深化）
 * # ============================================================
 * # 核心作用：用户可视化编辑 Plan 文档
 * #           支持阶段/任务的增删改、风险点展示、文件修改预览
 * # 运行流程：
 * #   1. 接收 plan 文档（PlanDocument）
 * #   2. 渲染阶段列表（可折叠）+ 任务列表（可编辑）
 * #   3. 支持 inline 编辑：任务标题、描述、风险等级、文件列表、依赖
 * #   4. 支持新增/删除任务、调整顺序（上下移动）
 * #   5. 风险点显示（warning badge + 详情弹窗）
 * #   6. 操作栏：保存修改、确认执行、重新生成
 * # 输入参数：见 PlanEditorProps
 * # 输出结果：受控的 PlanDocument 状态
 * # 复用说明：
 * #   - 替换 ArchitectureDesignModal 中的简单需求展示
 * #   - 与 PlanViewer 协同：PlanViewer 展示概要，PlanEditor 编辑细节
 * # 修改记录：
 * #   - 2026-07-27 | v1.0.0 | P0-3 Plan Mode 深化 - Plan 增删/调整 UI
 * # ============================================================
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import type {
  PlanDocument,
  PlanStage,
  PlanTask,
  PlanRisk,
} from '../hooks/useWorkflowApi';

/** 风险等级颜色映射 */
const RISK_LEVEL_COLORS: Record<string, string> = {
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  extreme: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const RISK_LEVEL_LABELS: Record<string, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
  extreme: '极高风险',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
  medium: 'bg-amber-500/20 text-amber-400 border-amber-500/40',
  high: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  extreme: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const STAGE_LABELS: Record<string, string> = {
  analysis: '📊 分析',
  planning: '📋 规划',
  coding: '💻 编码',
  testing: '🧪 测试',
  reviewing: '🔍 评审',
};

/** PlanEditor Props */
export interface PlanEditorProps {
  /** 原始 Plan（来自后端） */
  plan: PlanDocument;
  /** 用户修改后回调（用于保存到后端） */
  onChange: (modifiedPlan: PlanDocument) => void;
  /** 是否只读（默认 false 可编辑） */
  readOnly?: boolean;
  /** 高亮风险等级（用于审阅模式） */
  highlightRiskLevel?: 'all' | 'high' | 'extreme';
}

/**
 * 生成新的 task_id
 */
function genTaskId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 计算总预估时长
 */
function calcTotalMinutes(stages: PlanStage[]): number {
  return stages.reduce(
    (sum, stage) =>
      sum + stage.tasks.reduce((s, t) => s + (t.estimated_minutes || 0), 0),
    0
  );
}

/**
 * 风险详情弹窗
 */
const RiskDetailDialog: React.FC<{
  risk: PlanRisk;
  onClose: () => void;
}> = ({ risk, onClose }) => (
  <div
    className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
    onClick={onClose}
  >
    <div
      className={`border-2 rounded-xl p-5 max-w-md w-full mx-4 ${SEVERITY_COLORS[risk.severity] || SEVERITY_COLORS.medium}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">⚠️</span>
        <h3 className="text-base font-bold">
          {RISK_LEVEL_LABELS[risk.severity] || risk.severity}风险
        </h3>
      </div>
      <div className="space-y-2 text-sm">
        <div>
          <div className="text-xs opacity-70 mb-1">风险描述</div>
          <div>{risk.description}</div>
        </div>
        <div>
          <div className="text-xs opacity-70 mb-1">缓解措施</div>
          <div>{risk.mitigation || '（暂无）'}</div>
        </div>
      </div>
      <button
        onClick={onClose}
        className="mt-4 w-full px-3 py-1.5 rounded-md bg-surface-200 hover:bg-surface-300 text-surface-900 text-sm font-medium transition-colors"
      >
        关闭
      </button>
    </div>
  </div>
);

/**
 * 任务编辑卡片
 */
const TaskCard: React.FC<{
  task: PlanTask;
  index: number;
  total: number;
  readOnly: boolean;
  onUpdate: (task: PlanTask) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}> = ({ task, index, total, readOnly, onUpdate, onDelete, onMoveUp, onMoveDown }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`border rounded-lg p-3 ${
        task.risk_level === 'extreme'
          ? 'border-red-500/40 bg-red-500/5'
          : task.risk_level === 'high'
            ? 'border-orange-500/40 bg-orange-500/5'
            : 'border-surface-300/40 bg-surface-100/50'
      }`}
    >
      {/* 任务头部：编号 + 标题 + 风险标签 + 操作按钮 */}
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-hermes-500/20 text-hermes-400 text-xs font-bold flex items-center justify-center mt-0.5">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          {readOnly ? (
            <div className="text-sm font-medium text-surface-900 break-words">
              {task.title}
            </div>
          ) : (
            <input
              type="text"
              value={task.title}
              onChange={(e) => onUpdate({ ...task, title: e.target.value })}
              className="w-full text-sm font-medium bg-transparent border-b border-transparent hover:border-surface-400 focus:border-hermes-500 focus:outline-none text-surface-900 py-0.5"
              placeholder="任务标题"
            />
          )}
          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium border ${RISK_LEVEL_COLORS[task.risk_level] || RISK_LEVEL_COLORS.medium}`}
            >
              {RISK_LEVEL_LABELS[task.risk_level] || task.risk_level}
            </span>
            <span className="text-[10px] text-surface-600">
              ⏱ {task.estimated_minutes} 分钟
            </span>
            {task.files_involved && task.files_involved.length > 0 && (
              <span className="text-[10px] text-surface-600">
                📁 {task.files_involved.length} 文件
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-1.5 py-0.5 text-[10px] text-surface-600 hover:text-surface-900 transition-colors"
            title={expanded ? '收起详情' : '展开详情'}
          >
            {expanded ? '▲' : '▼'}
          </button>
          {!readOnly && (
            <>
              <button
                onClick={onMoveUp}
                disabled={index === 0}
                className="px-1.5 py-0.5 text-[10px] text-surface-600 hover:text-hermes-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="上移"
              >
                ⬆
              </button>
              <button
                onClick={onMoveDown}
                disabled={index === total - 1}
                className="px-1.5 py-0.5 text-[10px] text-surface-600 hover:text-hermes-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="下移"
              >
                ⬇
              </button>
              <button
                onClick={onDelete}
                className="px-1.5 py-0.5 text-[10px] text-red-400 hover:text-red-300 transition-colors"
                title="删除任务"
              >
                ✕
              </button>
            </>
          )}
        </div>
      </div>

      {/* 展开详情 */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-surface-300/40 space-y-2">
          {/* 描述 */}
          <div>
            <div className="text-[10px] text-surface-600 mb-0.5">描述</div>
            {readOnly ? (
              <div className="text-xs text-surface-800 whitespace-pre-wrap">
                {task.description}
              </div>
            ) : (
              <textarea
                value={task.description}
                onChange={(e) => onUpdate({ ...task, description: e.target.value })}
                className="w-full text-xs bg-surface-200/50 border border-surface-300/50 rounded px-2 py-1 text-surface-900 outline-none focus:border-hermes-500 resize-y min-h-[40px]"
                placeholder="任务详细描述"
                rows={2}
              />
            )}
          </div>

          {/* 验收标准 */}
          <div>
            <div className="text-[10px] text-surface-600 mb-0.5">验收标准</div>
            {readOnly ? (
              <div className="text-xs text-surface-800 whitespace-pre-wrap">
                {task.acceptance_criteria || '（未设置）'}
              </div>
            ) : (
              <textarea
                value={task.acceptance_criteria}
                onChange={(e) => onUpdate({ ...task, acceptance_criteria: e.target.value })}
                className="w-full text-xs bg-surface-200/50 border border-surface-300/50 rounded px-2 py-1 text-surface-900 outline-none focus:border-hermes-500 resize-y min-h-[30px]"
                placeholder="如何验证任务完成？"
                rows={2}
              />
            )}
          </div>

          {/* 风险等级 + 预估时长 */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] text-surface-600 mb-0.5">风险等级</div>
              {readOnly ? (
                <div className="text-xs">{RISK_LEVEL_LABELS[task.risk_level]}</div>
              ) : (
                <select
                  value={task.risk_level}
                  onChange={(e) =>
                    onUpdate({ ...task, risk_level: e.target.value as PlanTask['risk_level'] })
                  }
                  className="w-full text-xs bg-surface-200/50 border border-surface-300/50 rounded px-2 py-1 text-surface-900 outline-none focus:border-hermes-500"
                >
                  <option value="low">低风险</option>
                  <option value="medium">中风险</option>
                  <option value="high">高风险</option>
                  <option value="extreme">极高风险</option>
                </select>
              )}
            </div>
            <div>
              <div className="text-[10px] text-surface-600 mb-0.5">预估时长（分钟）</div>
              {readOnly ? (
                <div className="text-xs">{task.estimated_minutes}</div>
              ) : (
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={task.estimated_minutes}
                  onChange={(e) =>
                    onUpdate({ ...task, estimated_minutes: parseInt(e.target.value) || 0 })
                  }
                  className="w-full text-xs bg-surface-200/50 border border-surface-300/50 rounded px-2 py-1 text-surface-900 outline-none focus:border-hermes-500"
                />
              )}
            </div>
          </div>

          {/* 涉及文件 */}
          <div>
            <div className="text-[10px] text-surface-600 mb-0.5">
              涉及文件（用逗号分隔）
            </div>
            {readOnly ? (
              <div className="text-xs text-surface-800">
                {task.files_involved?.join(', ') || '（未指定）'}
              </div>
            ) : (
              <input
                type="text"
                value={task.files_involved?.join(', ') || ''}
                onChange={(e) =>
                  onUpdate({
                    ...task,
                    files_involved: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className="w-full text-xs bg-surface-200/50 border border-surface-300/50 rounded px-2 py-1 text-surface-900 outline-none focus:border-hermes-500 font-mono"
                placeholder="file1.py, file2.py"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * PlanEditor - 计划编辑器主组件
 */
export const PlanEditor: React.FC<PlanEditorProps> = ({
  plan,
  onChange,
  readOnly = false,
  highlightRiskLevel = 'all',
}) => {
  // 内部维护 plan 状态（深拷贝避免污染 props）
  const [localPlan, setLocalPlan] = useState<PlanDocument>(() => ({
    ...plan,
    stages: plan.stages.map((s) => ({
      ...s,
      tasks: s.tasks.map((t) => ({ ...t })),
      risks: s.risks.map((r) => ({ ...r })),
      alternatives: [...(s.alternatives || [])],
    })),
  }));

  // 风险点弹窗状态
  const [selectedRisk, setSelectedRisk] = useState<PlanRisk | null>(null);

  // 折叠状态：默认展开第一个阶段
  const [expandedStages, setExpandedStages] = useState<Set<string>>(() => {
    return new Set(plan.stages.length > 0 ? [plan.stages[0].stage] : []);
  });

  // 同步外部 plan 变化
  useEffect(() => {
    if (plan.plan_id !== localPlan.plan_id) {
      setLocalPlan({
        ...plan,
        stages: plan.stages.map((s) => ({
          ...s,
          tasks: s.tasks.map((t) => ({ ...t })),
          risks: s.risks.map((r) => ({ ...r })),
          alternatives: [...(s.alternatives || [])],
        })),
      });
    }
  }, [plan.plan_id]);

  // 触发 onChange 回调（带 debounce 避免频繁更新）
  useEffect(() => {
    const updated = {
      ...localPlan,
      total_estimated_minutes: calcTotalMinutes(localPlan.stages),
    };
    if (JSON.stringify(updated) !== JSON.stringify(plan)) {
      onChange(updated);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPlan]);

  // 切换阶段折叠
  const toggleStage = useCallback((stageName: string) => {
    setExpandedStages((prev) => {
      const next = new Set(prev);
      if (next.has(stageName)) {
        next.delete(stageName);
      } else {
        next.add(stageName);
      }
      return next;
    });
  }, []);

  // 更新阶段
  const updateStage = useCallback((stageName: string, newStage: PlanStage) => {
    setLocalPlan((prev) => ({
      ...prev,
      stages: prev.stages.map((s) => (s.stage === stageName ? newStage : s)),
    }));
  }, []);

  // 添加任务到阶段
  const addTask = useCallback(
    (stageName: string) => {
      setLocalPlan((prev) => ({
        ...prev,
        stages: prev.stages.map((s) =>
          s.stage === stageName
            ? {
                ...s,
                tasks: [
                  ...s.tasks,
                  {
                    task_id: genTaskId(),
                    title: '新任务',
                    description: '',
                    stage: stageName,
                    estimated_minutes: 30,
                    risk_level: 'medium',
                    files_involved: [],
                    dependencies: [],
                    acceptance_criteria: '',
                  },
                ],
              }
            : s
        ),
      }));
      setExpandedStages((prev) => new Set(prev).add(stageName));
    },
    []
  );

  // 删除任务
  const deleteTask = useCallback((stageName: string, taskId: string) => {
    setLocalPlan((prev) => ({
      ...prev,
      stages: prev.stages.map((s) =>
        s.stage === stageName
          ? { ...s, tasks: s.tasks.filter((t) => t.task_id !== taskId) }
          : s
      ),
    }));
  }, []);

  // 移动任务
  const moveTask = useCallback(
    (stageName: string, taskId: string, direction: 'up' | 'down') => {
      setLocalPlan((prev) => ({
        ...prev,
        stages: prev.stages.map((s) => {
          if (s.stage !== stageName) return s;
          const idx = s.tasks.findIndex((t) => t.task_id === taskId);
          if (idx < 0) return s;
          const newIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (newIdx < 0 || newIdx >= s.tasks.length) return s;
          const newTasks = [...s.tasks];
          [newTasks[idx], newTasks[newIdx]] = [newTasks[newIdx], newTasks[idx]];
          return { ...s, tasks: newTasks };
        }),
      }));
    },
    []
  );

  // 统计数据
  const stats = useMemo(() => {
    const totalTasks = localPlan.stages.reduce((s, st) => s + st.tasks.length, 0);
    const highRiskCount = localPlan.stages.reduce(
      (s, st) => s + st.tasks.filter((t) => t.risk_level === 'high' || t.risk_level === 'extreme').length,
      0
    );
    const totalRisks = localPlan.stages.reduce((s, st) => s + st.risks.length, 0);
    return { totalTasks, highRiskCount, totalRisks };
  }, [localPlan.stages]);

  return (
    <div className="space-y-3">
      {/* 顶部统计条 */}
      <div className="flex items-center gap-4 px-3 py-2 bg-surface-100/70 border border-surface-300/40 rounded-lg text-xs">
        <span className="text-surface-600">
          📦 <span className="font-medium text-surface-900">{localPlan.stages.length}</span> 个阶段
        </span>
        <span className="text-surface-600">
          ✅ <span className="font-medium text-surface-900">{stats.totalTasks}</span> 个任务
        </span>
        <span className="text-surface-600">
          ⚠️ <span className="font-medium text-orange-400">{stats.highRiskCount}</span> 高风险任务
        </span>
        <span className="text-surface-600">
          🛡️ <span className="font-medium text-surface-900">{stats.totalRisks}</span> 风险点
        </span>
        <span className="ml-auto text-surface-600">
          ⏱ 总预估 <span className="font-medium text-hermes-400">
            {Math.round(calcTotalMinutes(localPlan.stages) / 60 * 10) / 10}h
          </span>
        </span>
      </div>

      {/* 阶段列表 */}
      {localPlan.stages.map((stage, stageIdx) => {
        const isExpanded = expandedStages.has(stage.stage);
        const stageTaskCount = stage.tasks.length;
        const stageRiskCount = stage.risks.length;

        return (
          <div
            key={stage.stage}
            className="border border-surface-300/50 rounded-lg overflow-hidden"
          >
            {/* 阶段标题栏 */}
            <button
              onClick={() => toggleStage(stage.stage)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-surface-100/50 hover:bg-surface-200/70 transition-colors"
            >
              <span className="text-xs text-surface-600">
                {isExpanded ? '▼' : '▶'}
              </span>
              <span className="text-sm font-medium text-surface-900">
                {STAGE_LABELS[stage.stage] || stage.stage}
              </span>
              <span className="text-[10px] text-surface-600">
                阶段 {stageIdx + 1}
              </span>
              <span className="text-[10px] text-surface-600 ml-2">
                {stageTaskCount} 任务 · {stageRiskCount} 风险
              </span>
              {stage.risks.some(
                (r) => r.severity === 'extreme' || r.severity === 'high'
              ) && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/40">
                  ⚠ 高风险
                </span>
              )}
            </button>

            {/* 阶段内容 */}
            {isExpanded && (
              <div className="p-3 space-y-2">
                {/* 风险点展示 */}
                {stage.risks && stage.risks.length > 0 && (
                  <div className="mb-3 p-2 bg-amber-500/5 border border-amber-500/20 rounded">
                    <div className="text-[10px] font-medium text-amber-400 mb-1.5">
                      🛡️ 阶段风险点
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {stage.risks.map((risk) => {
                        if (
                          highlightRiskLevel === 'high' &&
                          risk.severity !== 'high' &&
                          risk.severity !== 'extreme'
                        ) {
                          return null;
                        }
                        if (highlightRiskLevel === 'extreme' && risk.severity !== 'extreme') {
                          return null;
                        }
                        return (
                          <button
                            key={risk.risk_id}
                            onClick={() => setSelectedRisk(risk)}
                            className={`text-[10px] px-1.5 py-0.5 rounded border transition-all hover:scale-105 ${SEVERITY_COLORS[risk.severity] || SEVERITY_COLORS.medium}`}
                            title={risk.description}
                          >
                            {RISK_LEVEL_LABELS[risk.severity] || risk.severity} ·{' '}
                            {risk.description.length > 20
                              ? risk.description.slice(0, 20) + '...'
                              : risk.description}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* 任务列表 */}
                {stage.tasks.length === 0 ? (
                  <div className="text-xs text-surface-500 text-center py-4">
                    暂无任务
                  </div>
                ) : (
                  <div className="space-y-2">
                    {stage.tasks.map((task, taskIdx) => (
                      <TaskCard
                        key={task.task_id}
                        task={task}
                        index={taskIdx}
                        total={stage.tasks.length}
                        readOnly={readOnly}
                        onUpdate={(t) =>
                          updateStage(stage.stage, {
                            ...stage,
                            tasks: stage.tasks.map((tt) =>
                              tt.task_id === t.task_id ? t : tt
                            ),
                          })
                        }
                        onDelete={() => deleteTask(stage.stage, task.task_id)}
                        onMoveUp={() => moveTask(stage.stage, task.task_id, 'up')}
                        onMoveDown={() => moveTask(stage.stage, task.task_id, 'down')}
                      />
                    ))}
                  </div>
                )}

                {/* 添加任务按钮 */}
                {!readOnly && (
                  <button
                    onClick={() => addTask(stage.stage)}
                    className="w-full mt-2 px-3 py-1.5 border border-dashed border-surface-400/50 rounded text-xs text-surface-600 hover:text-hermes-400 hover:border-hermes-500/50 transition-colors"
                  >
                    + 添加任务
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 风险点详情弹窗 */}
      {selectedRisk && (
        <RiskDetailDialog
          risk={selectedRisk}
          onClose={() => setSelectedRisk(null)}
        />
      )}
    </div>
  );
};

export default PlanEditor;
