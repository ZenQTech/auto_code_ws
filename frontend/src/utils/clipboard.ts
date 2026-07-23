/**
 * # ============================================================
 * # 剪贴板工具函数
 * # ============================================================
 * # 核心作用：封装 navigator.clipboard API，提供统一的剪贴板操作
 * # 运行流程：
 * #   1. 检查 navigator.clipboard 是否可用
 * #   2. 调用 writeText 写入剪贴板
 * #   3. 成功时调用 onSuccess 回调
 * #   4. 失败时 console.warn 并调用 onError 回调
 * # 输入参数：
 * #   - text: string，待复制的文本内容
 * #   - onSuccess?: () => void，复制成功后的回调
 * #   - onError?: (e: Error) => void，复制失败后的回调
 * # 输出结果：void
 * # 修改记录：
 * #   - 2026-06-26 | v1.0.0 | 从 MessageBubble.tsx 提取，作为通用工具函数
 * # ============================================================
 */

/**
 * 复制文本到剪贴板
 * 参数：
 *   - text: 待复制的文本内容
 *   - onSuccess?: 复制成功后的回调
 *   - onError?: 复制失败后的回调
 * 返回值：void
 */
export function copyToClipboard(
  text: string,
  onSuccess?: () => void,
  onError?: (e: Error) => void,
): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    navigator.clipboard
      .writeText(text)
      .then(() => onSuccess?.())
      .catch((e) => {
        console.warn('复制到剪贴板失败：', e);
        onError?.(e);
      });
  }
}
