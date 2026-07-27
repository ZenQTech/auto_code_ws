/**
 * # ============================================================
 * # HumanReviewReminder 人工审核超时提醒组件
 * # ============================================================
 * # 核心作用：显示待处理人工审核的倒计时，颜色随截止时间
 * #           逼近而变化（绿→黄→红），可点击跳转到审核页面
 * # 运行流程：
 * #   1. 接收审核节点数据作为输入
 * #   2. 每秒更新倒计时显示
 * #   3. 根据剩余时间动态调整颜色（>30min 绿色，10-30min 黄色，<10min 红色）
 * #   4. 点击组件触发 onNavigate 回调跳转到审核页面
 * # 输入参数：
 * #   - nodes: HumanReviewNode[]，待审核节点列表
 * #   - onNavigate?: (nodeId: string) => void，点击跳转回调
 * #   - loading?: boolean，加载状态
 * # 输出结果：人工审核提醒 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现人工审核提醒
 * # ============================================================
 */

import { useState, useEffect } from 'react';
import type { HumanReviewNode } from '../types';

interface Props {
  /** 待审核节点列表 */
  nodes: HumanReviewNode[];
  /** 点击跳转回调，传入节点 ID */
  onNavigate?: (nodeId: string) => void;
  /** 加载状态 */
  loading?: boolean;
}

/**
 * 格式化剩余秒数为可读时间
 * 作用：将秒数转换为 "Xh Ym Zs" 或 "Xm Ys" 格式
 * @param seconds - 剩余秒数
 * @returns 格式化后的时间字符串
 */
function formatRemaining(seconds: number): string {
  if (seconds <= 0) return '已超时';

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) return `${h}时 ${m}分 ${s}秒`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

/**
 * 根据剩余秒数返回颜色方案
 * 作用：根据剩余时间动态确定颜色
 * >1800s（30min）= 绿色安全，600-1800s（10-30min）= 黄色注意，<600s（10min）= 红色紧急
 * @param seconds - 剩余秒数
 * @returns Tailwind 颜色类名集合
 */
function getUrgencyStyle(seconds: number): {
  bg: string;
  text: string;
  border: string;
  pulse: boolean;
} {
  if (seconds <= 0) return { bg: 'bg-red-500/20', text: 'text-red-400', border: 'border-red-500/30', pulse: false };
  if (seconds < 600) return { bg: 'bg-red-500/10', text: 'text-red-400', border: 'border-red-500/20', pulse: true };
  if (seconds < 1800) return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-yellow-500/20', pulse: true };
  return { bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/20', pulse: false };
}

/**
 * 单个审核提醒节点组件
 * 作用：渲染单个审核节点的倒计时和状态
 */
function ReviewNodeItem({ node, onNavigate }: { node: HumanReviewNode; onNavigate?: (id: string) => void }) {
  /** 当前剩余秒数，每秒更新 */
  const [remaining, setRemaining] = useState(node.remaining_seconds);

  /**
   * 倒计时更新 effect
   * 每秒递减 remaining，直到归零
   */
  useEffect(() => {
    setRemaining(node.remaining_seconds);
    const timer = setInterval(() => {
      setRemaining(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [node.remaining_seconds]);

  const urgency = getUrgencyStyle(remaining);

  return (
    <div
      onClick={() => onNavigate?.(node.id)}
      className={`rounded-lg p-3 border cursor-pointer transition-all duration-300
                  hover:shadow-level-2 hover:-translate-y-0.5
                  ${urgency.bg} ${urgency.border}`}
    >
      {/* 节点名称 + 审核类型 */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-surface-900">{node.name}</span>
        <span className="px-1.5 py-0.5 rounded text-xs bg-surface-200 text-surface-600">
          {node.type}
        </span>
      </div>

      {/* 倒计时显示 */}
      <div className="flex items-center gap-2">
        {/* 脉冲指示器（紧急时） */}
        {urgency.pulse && (
          <span className={`w-2 h-2 rounded-full ${urgency.text.replace('text-', 'bg-')} animate-pulse`} />
        )}
        <span className={`text-lg font-bold font-mono ${urgency.text}`}>
          {formatRemaining(remaining)}
        </span>
      </div>

      {/* 截止时间 */}
      <div className="text-xs text-surface-500 mt-1.5">
        截止：{new Date(node.deadline).toLocaleString('zh-CN')}
      </div>

      {/* 超时提示 */}
      {remaining <= 0 && (
        <div className="mt-2 px-2 py-1 rounded bg-red-500/20 text-red-400 text-xs font-medium text-center">
          ⚠️ 审核已超时，请立即处理
        </div>
      )}
    </div>
  );
}

export default function HumanReviewReminder({ nodes, onNavigate, loading }: Props) {
  // ============================================================
  // 加载态
  // ============================================================
  if (loading) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="skeleton h-6 w-40 rounded mb-4" />
        <div className="space-y-3">
          {[1, 2].map(i => (
            <div key={i} className="skeleton h-20 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  // ============================================================
  // 空数据态（无待审核项）
  // ============================================================
  if (!nodes || nodes.length === 0) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">人工审核</h3>
        </div>
        <div className="text-sm text-emerald-400 text-center py-4">
          ✅ 暂无待审核项
        </div>
      </div>
    );
  }

  // 统计超时和紧急数量
  const overdueCount = nodes.filter(n => n.remaining_seconds <= 0).length;
  const urgentCount = nodes.filter(n => n.remaining_seconds > 0 && n.remaining_seconds < 600).length;

  return (
    <div className="glass rounded-xl p-5 animate-fade-in">
      {/* ============================================================
       * 标题栏：图标 + 标题 + 统计徽章
       * ============================================================ */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          {/* 审核图标 */}
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            overdueCount > 0
              ? 'bg-red-500/20'
              : urgentCount > 0
                ? 'bg-yellow-500/20'
                : 'bg-hermes-500/20'
          }`}>
            <svg className={`w-5 h-5 ${
              overdueCount > 0 ? 'text-red-400' : urgentCount > 0 ? 'text-yellow-400' : 'text-hermes-400'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-surface-950">人工审核</h3>
        </div>

        {/* 统计徽章 */}
        <div className="flex items-center gap-2">
          {overdueCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
              {overdueCount} 项超时
            </span>
          )}
          {urgentCount > 0 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-500/20 text-yellow-400">
              {urgentCount} 项紧急
            </span>
          )}
          <span className="text-xs text-surface-500">
            共 {nodes.length} 项
          </span>
        </div>
      </div>

      {/* ============================================================
       * 审核节点列表
       * ============================================================ */}
      <div className="space-y-2">
        {nodes.map(node => (
          <ReviewNodeItem
            key={node.id}
            node={node}
            onNavigate={onNavigate}
          />
        ))}
      </div>
    </div>
  );
}
