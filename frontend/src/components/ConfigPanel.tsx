/**
 * # ============================================================
 * # ConfigPanel 全局配置中心组件
 * # ============================================================
 * # 核心作用：以只读方式展示所有可配置参数，按分组（配额、
 * #           上下文、架构、评测、Git、安全、通知）组织显示
 * # 运行流程：
 * #   1. 组件挂载时通过 useConfigSections() 拉取配置分组数据
 * #   2. 按分组渲染可折叠的配置区域
 * #   3. 每个配置项显示键名、当前值、描述、默认值、取值范围
 * # 输入参数：无（通过 useConfigSections hook 获取数据）
 * # 输出结果：全局配置中心 UI
 * # 修改记录：
 * #   - 2026-06-24 | v1.0.0 | 初始创建，实现全局配置中心
 * # ============================================================
 */

import { useState } from 'react';
import { useConfigSections } from '../hooks/useApi';
import PanelSkeleton from './PanelSkeleton';

/**
 * 格式化配置值显示
 * 作用：根据配置值类型进行格式化显示
 * - boolean → "是"/"否"
 * - number → 千分位格式化
 * - string → 原样显示
 * @param value - 配置值
 * @returns 格式化后的显示字符串
 */
function formatConfigValue(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

/**
 * 根据配置值类型返回显示颜色
 * 作用：不同类型的配置值使用不同颜色高亮
 * @param value - 配置值
 * @returns Tailwind 颜色类名
 */
function getValueColor(value: string | number | boolean): string {
  if (typeof value === 'boolean') return value ? 'text-emerald-400' : 'text-red-400';
  if (typeof value === 'number') return 'text-hermes-400';
  return 'text-surface-800';
}

export default function ConfigPanel() {
  /** 配置分组数据 */
  const { sections, loading } = useConfigSections();
  /** 展开的分组 key 集合 */
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  /**
   * 切换分组展开/收起状态
   * 作用：点击分组标题时切换该分组的展开状态
   * @param key - 分组标识
   */
  const toggleSection = (key: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // ============================================================
  // 加载态（v1.1.0：使用 PanelSkeleton 统一组件）
  // ============================================================
  if (loading && sections.length === 0) {
    return <PanelSkeleton variant="config" />;
  }

  // ============================================================
  // 空数据态
  // ============================================================
  if (sections.length === 0) {
    return (
      <div className="glass rounded-xl p-5 animate-fade-in">
        <div className="empty-state">
          <span className="empty-icon">⚙️</span>
          <span>暂无配置数据</span>
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
        {/* 配置图标 */}
        <div className="w-8 h-8 rounded-lg bg-hermes-500/20 flex items-center justify-center">
          <svg className="w-5 h-5 text-hermes-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </div>
        <h3 className="text-base font-semibold text-surface-950">全局配置</h3>
        {/* 配置项总数 */}
        <span className="text-xs text-surface-500 bg-surface-200 px-2 py-0.5 rounded">
          {sections.reduce((sum, s) => sum + s.items.length, 0)} 项
        </span>
      </div>

      {/* ============================================================
       * 配置分组列表（可折叠）
       * ============================================================ */}
      <div className="flex-1 overflow-y-auto pr-2 min-h-0 space-y-2">
        {sections.map(section => {
          const isExpanded = expandedSections.has(section.key);

          return (
            <div key={section.key} className="border border-surface-300 rounded-lg overflow-hidden">
              {/* 分组标题栏（可点击展开/收起） */}
              <button
                onClick={() => toggleSection(section.key)}
                className="w-full flex items-center gap-3 px-4 py-3 bg-surface-100/50 hover:bg-surface-100/70 transition-colors text-left"
              >
                {/* 展开箭头 */}
                <span className={`text-surface-500 transition-transform duration-200 text-xs ${isExpanded ? 'rotate-90' : ''}`}>
                  ▶
                </span>
                {/* 分组名称 */}
                <span className="text-sm font-medium text-surface-900 flex-1">
                  {section.name}
                </span>
                {/* 配置项数量 */}
                <span className="text-xs text-surface-500">
                  {section.items.length} 项
                </span>
              </button>

              {/* 配置项列表（展开时显示） */}
              {isExpanded && (
                <div className="px-4 pb-3 animate-fade-in">
                  <div className="space-y-1.5">
                    {section.items.map(item => (
                      <div
                        key={item.key}
                        className="bg-surface-100/30 rounded-lg p-3 border border-surface-300"
                      >
                        {/* 配置键名 + 当前值 */}
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-mono text-surface-700">{item.key}</span>
                          <span className={`text-sm font-semibold font-mono ${getValueColor(item.value)}`}>
                            {formatConfigValue(item.value)}
                          </span>
                        </div>

                        {/* 配置描述 */}
                        <p className="text-xs text-surface-500 mb-1.5">{item.description}</p>

                        {/* 默认值 + 取值范围 */}
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-surface-500">
                            默认：<span className="text-surface-600 font-mono">{formatConfigValue(item.default_value)}</span>
                          </span>
                          {item.range && (
                            <span className="text-surface-500">
                              范围：<span className="text-surface-600">{item.range}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
