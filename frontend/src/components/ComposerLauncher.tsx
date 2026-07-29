/**
 * # ============================================================
 * ComposerLauncher 入口组件 (v6.36.0 Cycle 16 P0-1)
 * # ============================================================
 * 核心作用：作为 Composer 面板的应用级入口
 * 使用场景：包裹在 App 根组件中，提供跨组件共享的 ComposerEngine 实例
 * 设计说明：
 *   - 使用 Context 在整个应用中共享同一个 ComposerEngine
 *   - 默认隐藏面板（通过 Cmd/Ctrl+I 或外部 toggle 触发）
 *   - 不渲染任何可见 UI（透明容器）
 * ============================================================
 */

import { useEffect } from 'react';
import { ComposerProvider } from '../hooks/useComposer';
import { ComposerPanel } from './ComposerPanel';
import { createComposerEngine, type ComposerEngine } from '../utils/composerEngine';

export interface ComposerLauncherProps {
  /** 外部控制面板显隐 */
  externalIsOpen?: boolean;
  /** 外部控制全屏状态 */
  externalIsFullscreen?: boolean;
  /** 显隐变化回调 */
  onVisibilityChange?: (visible: boolean) => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * ComposerLauncher - 应用级 Composer 入口
 * 内部使用 ComposerProvider 共享 engine 实例
 */
export function ComposerLauncher({
  externalIsOpen,
  externalIsFullscreen,
  onVisibilityChange,
  className = '',
}: ComposerLauncherProps) {
  // 共享一个 engine 实例（在所有消费者之间复用）
  const engine = useSharedEngine();
  const isOpen = externalIsOpen ?? false;
  return (
    <ComposerProvider engine={engine}>
      <ComposerPanel
        externalIsOpen={externalIsOpen}
        externalIsFullscreen={externalIsFullscreen}
        className={className}
      />
      <VisibilityBridge
        isOpen={isOpen}
        onVisibilityChange={onVisibilityChange}
      />
    </ComposerProvider>
  );
}

/**
 * 可见性桥接组件：监听 isOpen 变化，回调给父组件
 */
function VisibilityBridge({
  isOpen,
  onVisibilityChange,
}: {
  isOpen: boolean;
  onVisibilityChange?: (visible: boolean) => void;
}) {
  useEffect(() => {
    onVisibilityChange?.(isOpen);
  }, [isOpen, onVisibilityChange]);
  return null;
}

// ============================================================
// useSharedEngine - 模块级单例 Hook
// ============================================================

let _sharedEngine: ComposerEngine | null = null;

/**
 * 获取共享的 ComposerEngine 实例（懒初始化）
 * 所有 ComposerLauncher 在同一应用中共享同一实例
 */
export function useSharedEngine(): ComposerEngine {
  if (!_sharedEngine) {
    _sharedEngine = createComposerEngine();
  }
  return _sharedEngine;
}

/**
 * 重置共享实例（用于测试或用户主动重置）
 */
export function resetSharedEngine(): void {
  if (_sharedEngine) {
    _sharedEngine.destroy();
    _sharedEngine = null;
  }
}

export default ComposerLauncher;
