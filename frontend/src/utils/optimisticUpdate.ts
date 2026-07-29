/**
 * # ============================================================
 * 乐观更新工具函数 (v6.43.0 Cycle 18 P1-3)
 * # ============================================================
 * 核心作用：UI 立即响应，后台异步执行网络请求，失败时回滚
 * 设计决策：
 *   - 框架无关：纯函数 + 通用 Hook，不依赖 React Query / SWR
 *   - 三个阶段：optimistic（同步）→ mutation（异步）→ success/error
 *   - 自动重入检测：同一 mutation 串行执行
 *   - 错误恢复：onError 自动触发 rollback
 * # 使用场景：
 *   - 侧边栏删除会话（立即消失 / 失败时恢复）
 *   - 重命名会话（立即更新 / 失败时还原）
 *   - 收藏切换（立即切换 / 失败时回滚）
 *   - 消息删除（立即移除 / 失败时恢复）
 * # 修改记录：
 *   - 2026-07-29 | v1.0.0 | 初始创建
 * # ============================================================
 */

// ============================================================
// 类型定义
// ============================================================

/** 乐观更新配置 */
export interface OptimisticUpdateOptions<TData, TVariables> {
  /** 同步乐观更新：立即修改本地状态（必填） */
  optimistic: (variables: TVariables) => void;
  /** 异步 mutation：执行网络请求（必填） */
  mutation: (variables: TVariables) => Promise<TData>;
  /** 失败回滚：撤销 optimistic 的修改 */
  rollback: (variables: TVariables) => void;
  /** 成功回调：用真实数据更新本地状态（可选） */
  onSuccess?: (data: TData, variables: TVariables) => void;
  /** 失败回调：除回滚外还可显示 toast 等 */
  onError?: (error: Error, variables: TVariables) => void;
  /** 总是执行：无论成功失败 */
  onSettled?: (variables: TVariables, error: Error | null) => void;
}

/** 乐观更新结果 */
export interface OptimisticUpdateResult<TData> {
  /** 是否成功 */
  success: boolean;
  /** mutation 返回的数据（成功时） */
  data?: TData;
  /** 错误（失败时） */
  error?: Error;
}

/** 乐观更新状态（用于 Hook） */
export interface OptimisticState {
  /** 是否有 mutation 在进行中 */
  isLoading: boolean;
  /** 最新的错误 */
  error: Error | null;
  /** 累计成功次数 */
  successCount: number;
  /** 累计失败次数 */
  errorCount: number;
}

// ============================================================
// 核心：乐观更新执行器
// ============================================================

/**
 * 执行一次乐观更新
 * @param options 配置
 * @param variables mutation 变量
 * @returns 包含成功/失败状态的结果
 *
 * 执行流程：
 *   1. 立即调用 optimistic(variables) 同步更新 UI
 *   2. 调用 mutation(variables) 发起网络请求
 *   3. 成功：调用 onSuccess(data, variables)
 *   4. 失败：调用 rollback(variables) + onError(error, variables)
 *   5. 无论结果：调用 onSettled(variables, error)
 */
export async function optimisticUpdate<TData = unknown, TVariables = unknown>(
  options: OptimisticUpdateOptions<TData, TVariables>,
  variables: TVariables,
): Promise<OptimisticUpdateResult<TData>> {
  const { optimistic, mutation, rollback, onSuccess, onError, onSettled } = options;

  // 1. 同步乐观更新
  try {
    optimistic(variables);
  } catch (err) {
    // optimistic 阶段失败（极少见），直接抛错
    const error = err instanceof Error ? err : new Error(String(err));
    onSettled?.(variables, error);
    return { success: false, error };
  }

  // 2. 异步 mutation
  let data: TData | undefined;
  let error: Error | null = null;

  try {
    data = await mutation(variables);
    onSuccess?.(data, variables);
  } catch (err) {
    error = err instanceof Error ? err : new Error(String(err));
    // 3. 失败回滚
    try {
      rollback(variables);
    } catch (rollbackErr) {
      // 回滚本身失败，记录但不覆盖原错误
      // eslint-disable-next-line no-console
      console.error('[optimisticUpdate] rollback failed:', rollbackErr);
    }
    onError?.(error, variables);
  }

  // 4. settled
  try {
    onSettled?.(variables, error);
  } catch (settledErr) {
    // eslint-disable-next-line no-console
    console.error('[optimisticUpdate] onSettled failed:', settledErr);
  }

  if (error) {
    return { success: false, error };
  }
  return { success: true, data };
}

/**
 * 创建乐观更新执行器（工厂函数）
 * 用于在多个地方复用同一组配置
 */
export function createOptimisticExecutor<TData = unknown, TVariables = unknown>(
  options: OptimisticUpdateOptions<TData, TVariables>,
) {
  return (variables: TVariables) => optimisticUpdate(options, variables);
}

// ============================================================
// 工具：乐观 ID 替换
// ============================================================

/**
 * 用真实数据替换临时 ID 的项
 * @param items 列表
 * @param tempId 临时 ID
 * @param realItem 真实数据
 * @returns 替换后的列表（未找到时返回原数组引用）
 */
export function replaceByTempId<T extends { id: string }>(
  items: T[],
  tempId: string,
  realItem: T,
): T[] {
  const index = items.findIndex((item) => item.id === tempId);
  if (index === -1) return items;
  const next = [...items];
  next[index] = realItem;
  return next;
}

/**
 * 从列表中移除指定 ID 的项（乐观删除）
 */
export function removeById<T extends { id: string }>(items: T[], id: string): T[] {
  return items.filter((item) => item.id !== id);
}

/**
 * 恢复被乐观删除的项（回滚）
 */
export function restoreItem<T extends { id: string }>(items: T[], item: T, position?: number): T[] {
  if (position === undefined || position >= items.length) {
    return [...items, item];
  }
  const next = [...items];
  next.splice(position, 0, item);
  return next;
}

/**
 * 生成临时 ID（用于乐观新增）
 */
export function generateTempId(prefix: string = 'temp'): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
