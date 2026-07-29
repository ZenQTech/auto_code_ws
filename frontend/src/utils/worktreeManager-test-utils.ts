/**
 * WorktreeManager 测试工具 - MemoryWorktreeStorage
 * 独立导出以避免循环依赖
 */

import type { WorktreeInfo, WorktreeStorage } from './worktreeManager';

export class MemoryWorktreeStorage implements WorktreeStorage {
  private data: WorktreeInfo[] = [];

  save(worktrees: WorktreeInfo[]): void {
    this.data = [...worktrees];
  }

  load(): WorktreeInfo[] {
    return [...this.data];
  }

  clear(): void {
    this.data = [];
  }
}
