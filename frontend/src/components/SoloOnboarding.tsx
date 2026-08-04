/**
 * # ============================================================
 * SoloOnboarding - Solo 模式入门引导 (v1.0.0)
 * Cycle 60+ Solo 重构 - 让用户快速上手
 * # ============================================================
 * 核心作用：用户首次进入 Solo 模式时显示的引导卡
 * 设计要点：
 *   - 简洁 4 步走介绍
 *   - ⌘K 命令面板 / ⌘/ 快捷键帮助 / ⌘T 新建任务
 *   - 仅显示一次（localStorage 标记）
 *   - 暗色/亮色适配
 *   - 一键关闭 + 重看入口
 * 输入参数：
 *   - onDismiss?: () => void
 *   - onStartChat?: () => void
 *   - onOpenPalette?: () => void
 * 输出结果：UI 组件
 * ====================================
 * 修改记录：
 *   - 2026-08-04 | v1.0.0 | Solo 重构 - 初次创建
 * ====================================
 */

import React, { useState, useEffect } from 'react';

// ============================================================
// 类型
// ====================================

export interface SoloOnboardingProps {
  onDismiss?: () => void;
  onStartChat?: () => void;
  onOpenPalette?: () => void;
  'data-testid'?: string;
}

// ============================================================
// 持久化
// ====================================

const STORAGE_KEY = 'hermes.solo.onboarding.dismissed';

function readDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // 忽略
  }
}

// ============================================================
// 步骤定义
// ====================================

const STEPS = [
  {
    emoji: '💬',
    title: '输入提示词',
    description: '在主舞台底部的输入框中描述你想要 AI 完成的任务',
  },
  {
    emoji: '⌘K',
    title: '打开命令面板',
    description: '随时按 ⌘K（macOS）或 Ctrl+K（Windows/Linux）打开命令面板，快速访问 100+ 功能',
  },
  {
    emoji: '📋',
    title: '选择 Plan 模式',
    description: 'Plan 模式：先让 AI 输出计划，你确认后再执行，更可控',
  },
  {
    emoji: '📊',
    title: '实时跟随执行',
    description: '开启 Auto-Follow 后，AI 执行时主舞台自动滚动到最新步骤',
  },
  {
    emoji: '🧰',
    title: '使用右栏工具',
    description: '编辑器、终端、浏览器、代码变更、内存等工具内嵌在右栏',
  },
];

// ============================================================
// 组件
// ====================================

export const SoloOnboarding: React.FC<SoloOnboardingProps> = ({
  onDismiss,
  onStartChat,
  onOpenPalette,
  'data-testid': testId = 'solo-onboarding',
}) => {
  const [dismissed, setDismissed] = useState<boolean>(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    setDismissed(readDismissed());
  }, []);

  const handleDismiss = () => {
    writeDismissed();
    setDismissed(true);
    onDismiss?.();
  };

  const handleStart = () => {
    handleDismiss();
    onStartChat?.();
  };

  const handlePalette = () => {
    onOpenPalette?.();
  };

  if (dismissed) return null;

  const currentStep = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center
                 bg-black/40 backdrop-blur-sm"
      data-testid={testId}
    >
      <div
        className="w-[520px] max-w-[90vw] rounded-xl shadow-2xl overflow-hidden
                   bg-[var(--bg-panel)] border border-[var(--border-color)]"
      >
        {/* 头部 */}
        <div className="px-5 py-4 border-b border-[var(--border-color)] flex items-center gap-3">
          <div className="text-2xl">🚀</div>
          <div className="flex-1">
            <div className="text-base font-semibold">欢迎使用 Solo 模式</div>
            <div className="text-xs text-[var(--text-secondary)]">
              对标 Codex / Trae Solo 的一体化 AI 工作台
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="px-2 py-1 text-sm rounded
                       hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
            title="跳过引导"
            data-testid={`${testId}-skip`}
          >
            ✕
          </button>
        </div>

        {/* 当前步骤 */}
        <div className="px-5 py-6 min-h-[160px]">
          <div className="flex items-start gap-3 mb-4">
            <div className="text-4xl flex-shrink-0">{currentStep.emoji}</div>
            <div>
              <div className="text-base font-medium mb-1">
                {currentStep.title}
              </div>
              <div className="text-sm text-[var(--text-secondary)]">
                {currentStep.description}
              </div>
            </div>
          </div>

          {/* 步骤指示器 */}
          <div className="flex items-center gap-1.5 mt-4">
            {STEPS.map((_, idx) => (
              <div
                key={idx}
                onClick={() => setStep(idx)}
                className={`h-1.5 flex-1 rounded-full cursor-pointer transition-colors
                            ${idx === step
                              ? 'bg-[var(--hermes-500)]'
                              : idx < step
                                ? 'bg-[var(--hermes-300)]'
                                : 'bg-[var(--bg-elevated)]'
                            }`}
                data-testid={`${testId}-step-${idx}`}
              />
            ))}
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="px-5 py-3 border-t border-[var(--border-color)]
                        flex items-center justify-between">
          <button
            onClick={handlePalette}
            className="text-xs text-[var(--text-secondary)]
                       hover:text-[var(--text-primary)] underline"
            data-testid={`${testId}-try-palette`}
          >
            先试试 ⌘K 命令面板
          </button>
          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="px-3 py-1.5 text-sm rounded
                           hover:bg-[var(--bg-elevated)] text-[var(--text-secondary)]"
                data-testid={`${testId}-prev`}
              >
                上一步
              </button>
            )}
            {!isLast ? (
              <button
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
                className="px-3 py-1.5 text-sm rounded
                           bg-[var(--hermes-500)] text-white hover:bg-[var(--hermes-600)]"
                data-testid={`${testId}-next`}
              >
                下一步
              </button>
            ) : (
              <button
                onClick={handleStart}
                className="px-3 py-1.5 text-sm rounded
                           bg-[var(--hermes-500)] text-white hover:bg-[var(--hermes-600)]"
                data-testid={`${testId}-start`}
              >
                开始使用
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/** 重置 onboarding（用于"重看引导"按钮） */
export function resetSoloOnboarding(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 忽略
  }
}

export default SoloOnboarding;
