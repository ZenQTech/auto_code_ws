/**
 * # ============================================================
 * ClaudeCLIWorkbenchPage - Claude CLI Workbench 独立访问页面 (v1.0.0)
 * Cycle 61 G61-03-T5
 * # ====================================
 * # 修改记录：
 * #   - 2026-08-04 | v1.0.0 | Cycle 61 G61-03-T5 初次创建
 * ====================================
 */

import React from 'react';
import ClaudeCLIWorkbench from '../components/ClaudeCLIWorkbench';

const ClaudeCLIWorkbenchPage: React.FC = () => {
  return (
    <div className="h-screen w-screen flex flex-col">
      <header className="px-4 py-2 border-b border-[var(--border-color)] bg-[var(--bg-panel)]">
        <h1 className="text-lg font-semibold text-[var(--text-primary)]">
          🌊 Claude CLI Workbench
        </h1>
        <p className="text-xs text-[var(--text-secondary)]">
          G61-01 (Claude Code CLI subprocess) + G61-03 (Auto-Follow v2) 集成演示
        </p>
      </header>
      <main className="flex-1 min-h-0">
        <ClaudeCLIWorkbench testId="claude-cli-workbench" />
      </main>
    </div>
  );
};

export default ClaudeCLIWorkbenchPage;
