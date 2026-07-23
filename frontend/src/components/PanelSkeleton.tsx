/**
 * # ============================================================
 * # 面板加载骨架屏组件 - PanelSkeleton
 * # ============================================================
 * # 核心作用：为 QuotaPanel / GitPanel / ConfigPanel / SecurityReviewPanel
 * #           提供统一的可复用加载态骨架屏，避免各面板重复编写骨架代码
 * # 运行流程：
 * #   1. 接收 variant 参数决定骨架屏布局样式
 * #   2. 渲染 glass 容器 + 标题骨架 + 内容骨架行
 * # 输入参数：
 * #   - variant: 'quota' | 'git' | 'config' | 'security'，决定骨架布局
 * #   - titleWidth?: string，标题骨架宽度（默认 'w-36'）
 * # 输出结果：加载态骨架屏 JSX
 * # 修改记录：
 * #   - 2026-06-26 | v1.0.0 | 初始版本，从各面板提取骨架屏为统一组件
 * # ============================================================
 */

import type { ReactNode } from 'react';

interface Props {
  /** 骨架屏布局变体 */
  variant: 'quota' | 'git' | 'config' | 'security';
  /** 标题骨架宽度（Tailwind class），默认 'w-36' */
  titleWidth?: string;
}

/**
 * 面板加载骨架屏组件
 * 参数：
 *   - variant: 布局变体
 *   - titleWidth: 标题骨架宽度
 * 返回值：JSX 元素
 */
export default function PanelSkeleton({ variant, titleWidth = 'w-36' }: Props) {
  let content: ReactNode;

  switch (variant) {
    case 'quota':
      content = (
        <div className="space-y-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-4 w-24 rounded" />
              <div className="skeleton h-2 w-full rounded-full" />
            </div>
          ))}
          <div className="grid grid-cols-2 gap-3 mt-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="skeleton h-16 rounded-lg" />
            ))}
          </div>
        </div>
      );
      break;

    case 'git':
      content = (
        <>
          <div className="skeleton h-20 rounded-lg mb-3" />
          <div className="space-y-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="skeleton h-10 rounded" />
            ))}
          </div>
        </>
      );
      break;

    case 'config':
      content = (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="space-y-2">
              <div className="skeleton h-8 rounded" />
              <div className="skeleton h-6 w-3/4 rounded" />
              <div className="skeleton h-6 w-1/2 rounded" />
            </div>
          ))}
        </div>
      );
      break;

    case 'security':
      content = (
        <>
          <div className="skeleton h-12 rounded-lg mb-3" />
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="skeleton h-10 rounded" />
            ))}
          </div>
        </>
      );
      break;
  }

  return (
    <div className="glass rounded-xl p-5 animate-fade-in">
      <div className={`skeleton h-6 ${titleWidth} rounded mb-4`} />
      {content}
    </div>
  );
}
