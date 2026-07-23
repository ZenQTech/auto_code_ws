/**
 * # ============================================================
 * # ErrorBoundary 错误边界组件
 * # ============================================================
 * # 核心作用：捕获子组件树中抛出的未处理错误，防止整个应用白屏崩溃，
 * #           展示友好的错误回退界面，并提供刷新页面的恢复入口
 * # 运行流程：
 * #   1. 通过 getDerivedStateFromError 捕获子组件渲染错误，更新 state.hasError
 * #   2. 通过 componentDidCatch 记录错误详情到 state.errorMessage
 * #   3. 当 hasError=true 时，渲染 fallback UI（玻璃拟态卡片 + 错误信息 + 刷新按钮）
 * #   4. 当 hasError=false 时，正常渲染子组件（this.props.children）
 * # 输入参数：
 * #   - children: React.ReactNode，需要被错误边界包裹的子组件
 * # 输出结果：无返回值，纯 UI 组件
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 初始创建，实现 React ErrorBoundary 模式
 * # ============================================================
 */

import React from 'react';

/** ErrorBoundary 组件的 Props 类型定义 */
interface ErrorBoundaryProps {
  /** 需要被错误边界包裹的子组件 */
  children: React.ReactNode;
}

/** ErrorBoundary 组件的 State 类型定义 */
interface ErrorBoundaryState {
  /** 是否发生了错误 */
  hasError: boolean;
  /** 错误消息文本，用于展示给用户 */
  errorMessage: string;
}

/**
 * ErrorBoundary 错误边界组件
 * 调用方：App.tsx 主应用组件，包裹主内容区域
 * 被调用方：无（React 内部机制触发）
 * 实现 React 的错误边界模式，使用 class 组件（React 要求）
 */
export default class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  /**
   * 初始化 state
   * hasError: 初始为 false，表示未发生错误
   * errorMessage: 初始为空字符串
   */
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  /**
   * 静态方法：从错误对象派生新的 state
   * 调用方：React 内部机制，在子组件渲染抛出错误时自动调用
   * 参数：
   *   - error: Error，子组件抛出的错误对象
   * 返回值：Partial<ErrorBoundaryState>，合并到当前 state
   * 运行步骤：
   *   1. 设置 hasError=true，触发 fallback UI 渲染
   *   2. 提取 error.message 作为用户可读的错误信息
   */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      errorMessage: error.message || '未知错误',
    };
  }

  /**
   * 错误捕获回调：记录错误详情到 state 并输出到控制台
   * 调用方：React 内部机制，在子组件渲染抛出错误后自动调用
   * 参数：
   *   - error: Error，子组件抛出的错误对象
   *   - errorInfo: React.ErrorInfo，包含组件调用栈信息
   * 运行步骤：
   *   1. 将错误消息写入 state.errorMessage（若 getDerivedStateFromError 未设置）
   *   2. 将错误详情输出到 console.error，便于开发调试
   */
  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    // 若 getDerivedStateFromError 已设置 errorMessage，此处作为补充兜底
    if (!this.state.errorMessage || this.state.errorMessage === '未知错误') {
      this.setState({ errorMessage: error.message || '未知错误' });
    }
    // 输出完整错误信息到控制台，包含组件调用栈，便于开发调试定位问题
    console.error('[ErrorBoundary] 捕获到未处理错误：', error);
    console.error('[ErrorBoundary] 组件调用栈：', errorInfo.componentStack);
  }

  /**
   * 刷新页面回调
   * 运行步骤：调用 window.location.reload() 强制刷新整个页面
   * 注意：刷新后应用将重新初始化，错误状态会自然清除
   */
  handleReload = (): void => {
    window.location.reload();
  };

  /**
   * 渲染方法
   * 运行步骤：
   *   1. 检查 state.hasError
   *   2. 若为 true：渲染错误回退界面（玻璃拟态卡片）
   *   3. 若为 false：正常渲染子组件（this.props.children）
   */
  render(): React.ReactNode {
    // 发生错误时渲染 fallback UI
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-surface-50 flex items-center justify-center p-6">
          {/* 错误卡片：玻璃拟态 + 居中 + 入场动画 */}
          <div
            className="glass-strong rounded-2xl px-8 py-10 max-w-md w-full text-center
                       animate-scale-in border border-red-500/20"
          >
            {/* 错误图标：⚠️ 警告符号 */}
            <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-red-500/15 flex items-center justify-center">
              <svg
                className="w-8 h-8 text-red-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>

            {/* 错误标题 */}
            <h2 className="text-h2 text-surface-900 mb-3">
              页面出现错误
            </h2>

            {/* 错误详情 */}
            <p className="text-body text-surface-700 mb-2">
              应用运行过程中发生了意外错误，请尝试刷新页面恢复。
            </p>

            {/* 具体错误消息：使用等宽字体 + 半透明背景，便于技术排查 */}
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3 mb-6">
              <p className="text-xs text-red-400 font-mono break-all leading-relaxed">
                {this.state.errorMessage}
              </p>
            </div>

            {/* 刷新页面按钮：使用项目统一的 btn-primary 样式 */}
            <button
              onClick={this.handleReload}
              className="btn-primary w-full"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              刷新页面
            </button>
          </div>
        </div>
      );
    }

    // 未发生错误时正常渲染子组件
    return this.props.children;
  }
}
