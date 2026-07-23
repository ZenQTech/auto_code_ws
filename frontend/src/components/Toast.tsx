/**
 * # ============================================================
 * # Toast 模态弹窗组件
 * # ============================================================
 * # 核心作用：页面顶部居中显示的模态弹窗，用于通知用户
 * #           操作完成状态（如"提示词优化完成"）
 * # 运行流程：
 * #   1. 接收 message 文本作为显示内容
 * #   2. 根据 type 类型显示不同颜色的图标和边框
 * #   3. 以淡入动画显示在页面顶部居中位置
 * #   4. 自动 3 秒后以淡出动画消失
 * #   5. 用户可点击关闭按钮提前关闭
 * # 输入参数：
 * #   - message: string，弹窗显示的文本内容
 * #   - visible: boolean，控制弹窗显示/隐藏
 * #   - type: 'success' | 'error' | 'warning' | 'info'，弹窗类型
 * #   - onClose: () => void，关闭回调函数
 * # 输出结果：无返回值，纯 UI 组件
 * # 修改记录：
 * #   - 2026-06-17 | v1.0.0 | 初始创建，实现 Hermes 风格 Toast 弹窗
 * #   - 2026-06-17 | v1.1.0 | 统一 Hermes 金色配色方案，新增 type 属性支持多类型弹窗
 * #   - 2026-06-23 | v1.2.0 | 容器升级为 .glass 玻璃拟态；关闭按钮替换为 .icon-btn
 * #   - 2026-06-24 | v1.3.0 | success 类型颜色从 Hermes 金色改为 emerald 绿色，统一四种类型的语义色方案
 * # ============================================================
 */

import { useEffect } from 'react';

/** Toast 弹窗类型 */
type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Props {
  /** 弹窗显示的文本内容 */
  message: string;
  /** 控制弹窗显示/隐藏 */
  visible: boolean;
  /** 弹窗类型，决定图标和边框颜色，默认为 'success' */
  type?: ToastType;
  /** 关闭回调函数 */
  onClose: () => void;
}

/**
 * 根据弹窗类型获取对应的样式配置
 * 参数：
 *   - type: ToastType，弹窗类型
 * 返回值：{ borderClass, iconBgClass, iconColorClass, IconComponent }
 */
function getTypeConfig(type: ToastType) {
  switch (type) {
    case 'error':
      return {
        borderClass: 'border-red-500/30',
        iconBgClass: 'bg-red-500/20',
        iconColorClass: 'text-red-400',
      };
    case 'warning':
      return {
        borderClass: 'border-yellow-500/30',
        iconBgClass: 'bg-yellow-500/20',
        iconColorClass: 'text-yellow-400',
      };
    case 'info':
      return {
        borderClass: 'border-blue-500/30',
        iconBgClass: 'bg-blue-500/20',
        iconColorClass: 'text-blue-400',
      };
    case 'success':
    default:
      return {
        borderClass: 'border-emerald-500/30',
        iconBgClass: 'bg-emerald-500/20',
        iconColorClass: 'text-emerald-400',
      };
  }
}

export default function Toast({ message, visible, type = 'success', onClose }: Props) {
  /**
   * 自动消失定时器
   * 变量说明：
   *   - 当 visible 为 true 时启动 3 秒定时器
   *   - 定时器到期后自动调用 onClose
   *   - 组件卸载或 visible 变化时清理定时器
   */
  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => {
      onClose();
    }, 3000);
    return () => clearTimeout(timer);
  }, [visible, onClose]);

  // 不可见时不渲染
  if (!visible) return null;

  const { borderClass, iconBgClass, iconColorClass } = getTypeConfig(type);

  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex justify-center pt-6 pointer-events-none">
      {/* 弹窗主体：Hermes 深色风格，玻璃拟态 + 淡入动画 */}
      <div
        className={`pointer-events-auto flex items-center gap-3 px-6 py-3 rounded-lg
                   glass ${borderClass}
                   animate-toast-in`}
      >
        {/* 类型图标指示器 */}
        <div className={`w-5 h-5 rounded-full ${iconBgClass} flex items-center justify-center flex-shrink-0`}>
          {type === 'success' && (
            <svg className={`w-3 h-3 ${iconColorClass}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'error' && (
            <svg className={`w-3 h-3 ${iconColorClass}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {type === 'warning' && (
            <svg className={`w-3 h-3 ${iconColorClass}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          )}
          {type === 'info' && (
            <svg className={`w-3 h-3 ${iconColorClass}`} fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
          )}
        </div>

        {/* 消息文本 */}
        <span className="text-sm text-surface-900 font-medium">{message}</span>

        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          aria-label="关闭通知"
          className="icon-btn !w-5 !h-5 !rounded-full ml-2"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
