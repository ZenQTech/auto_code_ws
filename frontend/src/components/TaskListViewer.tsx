/**
 * # ============================================================
 * # TaskListViewer 任务列表查看器组件
 * # ============================================================
 * # 核心作用：展示任务树结构，包含依赖连线、风险等级标签、
 * #           优先级徽章、可展开任务详情、全局接口规范区域
 * # 运行流程：
 * #   1. 接收任务树节点数组作为输入
 * #   2. 递归渲染任务树，每层显示缩进和依赖连线
 * #   3. 每个节点显示风险等级（颜色标签）、优先级徽章
 * #   4. 点击节点可展开/收起任务详情
 * #   5. 底部显示全局接口规范引用区域
 * # 输入参数：
 * #   - tasks: TaskTreeNode[]，任务树根节点数组
 * #   - interfaceSpec?: string，全局接口规范 Markdown 内容
 * #   - loading?: boolean，加载状态
 * # 输出结果：任务列表查看器 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现任务列表查看器
 * # ============================================================
 */

import { useState } from 'react';
import type { TaskTreeNode, RiskLevel, TaskPriority } from '../types';

interface Props {
  /** 任务树根节点数组 */
  tasks: TaskTreeNode[];
  /** 全局接口规范 Markdown 内容 */
  interfaceSpec?: string;
  /** 加载状态 */
  loading?: boolean;
}

/**
 * 风险等级颜色映射
 * 作用：将风险等级映射为对应的 Tailwind 颜色类名
 * 极高=红色，高=橙色，一般=黄色，低=绿色
 */
const riskColorMap: Record<RiskLevel, { bg: string; text: string; border: string }> = {
  '极高': { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30' },
  '高':   { bg: 'bg-orange-500/20', text: 'text-orange-400', border: 'border-orange-500/30' },
  '一般': { bg: 'bg-yellow-500/20', text: 'text-yellow-400', border: 'border-yellow-500/30' },
  '低':   { bg: 'bg-emerald-500/20', text: 'text-emerald-400', border: 'border-emerald-500/30' },
};

/**
 * 优先级颜色映射
 * 作用：将任务优先级映射为对应的 Tailwind 颜色类名
 * high=红色高优，medium=橙色中优，low=灰色低优
 */
const priorityColorMap: Record<TaskPriority, { bg: string; text: string; label: string }> = {
  high:   { bg: 'bg-red-500/20', text: 'text-red-400', label: '高' },
  medium: { bg: 'bg-orange-500/20', text: 'text-orange-400', label: '中' },
  low:    { bg: 'bg-surface-300/50', text: 'text-surface-600', label: '低' },
};

/**
 * 任务状态中文标签
 * 作用：将任务状态枚举值映射为中文显示文本
 */
const statusLabelMap: Record<string, string> = {
  pending: '等待中',
  running: '执行中',
  validating: '验证中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

/**
 * 单个任务树节点组件
 * 作用：递归渲染单个任务节点及其子节点，支持展开/收起
 * 参数：
 *   - node: TaskTreeNode，当前任务节点
 *   - depth: number，当前缩进深度（用于计算左边距）
 *   - isLast: boolean，是否为同级最后一个节点（影响连线样式）
 */
function TaskNode({ node, depth, isLast }: { node: TaskTreeNode; depth: number; isLast: boolean }) {
  /** 控制任务详情是否展开 */
  const [expanded, setExpanded] = useState(false);

  const riskStyle = riskColorMap[node.risk_level];
  const priorityStyle = priorityColorMap[node.priority];
  const hasChildren = node.children && node.children.length > 0;

  return (
    <div className="relative">
      {/* ============================================================
       * 依赖连线：左侧竖线表示层级关系
       * ============================================================ */}
      {depth > 0 && (
        <div className="absolute left-0 top-0 bottom-0" style={{ left: `${(depth - 1) * 20 + 8}px` }}>
          {/* 水平连接线 */}
          <div className="absolute top-5 w-3 border-t border-surface-400" style={{ left: '12px' }} />
          {/* 垂直连接线（非最后一个节点时延伸到下一个节点） */}
          {!isLast && (
            <div className="absolute top-5 bottom-0 border-l border-surface-400" style={{ left: '12px' }} />
          )}
        </div>
      )}

      {/* ============================================================
       * 任务节点主体
       * ============================================================ */}
      <div
        className="ml-0 transition-all duration-200"
        style={{ marginLeft: `${depth * 20}px` }}
      >
        <div
          className={`bg-surface-100/50 rounded-lg border border-surface-300 p-3 mb-1.5
                      hover:border-hermes-500/30 transition-all duration-200 cursor-pointer
                      ${expanded ? 'border-hermes-500/20 bg-surface-100/70' : ''}`}
          onClick={() => setExpanded(!expanded)}
        >
          {/* 第一行：展开箭头 + 标题 + 风险等级 + 优先级 */}
          <div className="flex items-center gap-2">
            {/* 展开/收起箭头 */}
            <span className={`text-surface-500 transition-transform duration-200 text-xs ${expanded ? 'rotate-90' : ''}`}>
              ▶
            </span>

            {/* 任务标题 */}
            <span className="text-sm font-medium text-surface-900 flex-1 truncate">
              {node.title}
            </span>

            {/* 风险等级标签 */}
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${riskStyle.bg} ${riskStyle.text}`}>
              {node.risk_level}
            </span>

            {/* 优先级徽章 */}
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium flex-shrink-0 ${priorityStyle.bg} ${priorityStyle.text}`}>
              {priorityStyle.label}
            </span>

            {/* 状态指示器 */}
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              node.status === 'completed' ? 'bg-emerald-400' :
              node.status === 'running' ? 'bg-hermes-400 animate-pulse' :
              node.status === 'failed' ? 'bg-red-400' :
              'bg-surface-400'
            }`} />
          </div>

          {/* 第二行：状态 + 复杂度 + 子任务数 */}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-surface-500">
            <span>{statusLabelMap[node.status] || node.status}</span>
            <span>复杂度：{node.complexity_score}</span>
            {hasChildren && <span>{node.children.length} 个子任务</span>}
            {node.dependencies.length > 0 && (
              <span>依赖：{node.dependencies.length} 项</span>
            )}
          </div>

          {/* ============================================================
           * 展开详情区域
           * ============================================================ */}
          {expanded && (
            <div className="mt-3 pt-3 border-t border-surface-300 space-y-2 animate-fade-in">
              {/* 任务描述 */}
              {node.description && (
                <div>
                  <span className="text-xs font-medium text-surface-600">描述</span>
                  <p className="text-xs text-surface-700 mt-0.5">{node.description}</p>
                </div>
              )}

              {/* 依赖任务列表 */}
              {node.dependencies.length > 0 && (
                <div>
                  <span className="text-xs font-medium text-surface-600">依赖任务</span>
                  <div className="flex flex-wrap gap-1 mt-0.5">
                    {node.dependencies.map(depId => (
                      <span key={depId} className="px-1.5 py-0.5 rounded text-xs bg-surface-200 text-surface-600">
                        {depId}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* 接口规范引用 */}
              {node.interface_spec_ref && (
                <div>
                  <span className="text-xs font-medium text-surface-600">接口规范引用</span>
                  <p className="text-xs text-hermes-400 mt-0.5">{node.interface_spec_ref}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ============================================================
         * 递归渲染子任务节点
         * ============================================================ */}
        {hasChildren && (
          <div>
            {node.children.map((child, index) => (
              <TaskNode
                key={child.id}
                node={child}
                depth={depth + 1}
                isLast={index === node.children.length - 1}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function TaskListViewer({ tasks, interfaceSpec, loading }: Props) {
  // ============================================================
  // 加载态
  // ============================================================
  if (loading) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-32 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="skeleton h-12 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (!tasks || tasks.length === 0) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">📋</span>
          <span>暂无任务数据</span>
        </div>
      </div>
    );
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in flex flex-col max-h-[70vh]">
      {/* ============================================================
       * 标题栏
       * ============================================================ */}
      <div className="flex items-center gap-3 mb-4 pb-3 border-b border-surface-300">
        {/* 任务图标 */}
        <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-surface-950">任务列表</h3>
        {/* 任务总数 */}
        <span className="text-xs text-surface-500 bg-surface-200 px-2 py-0.5 rounded">
          {tasks.length} 个根任务
        </span>
      </div>

      {/* ============================================================
       * 任务树渲染区域
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0">
        {tasks.map((task, index) => (
          <TaskNode
            key={task.id}
            node={task}
            depth={0}
            isLast={index === tasks.length - 1}
          />
        ))}
      </div>

      {/* ============================================================
       * 全局接口规范区域
       * ============================================================ */}
      {interfaceSpec && (
        <div className="mt-4 pt-3 border-t border-surface-300">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-4 h-4 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
            <span className="text-sm font-semibold text-surface-800">全局接口规范</span>
          </div>
          <div className="bg-surface-100/50 rounded-lg p-3 border border-surface-300 text-xs text-surface-700 font-mono leading-relaxed max-h-32 overflow-y-auto">
            {interfaceSpec}
          </div>
        </div>
      )}
    </div>
  );
}
