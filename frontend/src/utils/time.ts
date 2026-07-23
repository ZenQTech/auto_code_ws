/**
 * # ============================================================
 * # 共享时间格式化工具
 * # ============================================================
 * # 核心作用：将 ISO 时间戳格式化为相对时间描述
 * # 输入参数：
 * #   - iso: string，ISO 8601 时间字符串
 * # 返回值：string，相对时间字符串
 * # 修改记录：
 * #   - 2026-06-25 | v1.0.0 | 从 SessionListItem.tsx / GitPanel.tsx 提取合并
 * # ============================================================
 */

/**
 * 相对时间格式化
 * 作用：将 ISO 时间戳格式化为"刚刚 / X 分钟前 / X 小时前 / 昨天 HH:mm / X 天前 / MM-DD"等可读格式
 * 参数：
 *   - iso: string，ISO 8601 时间字符串
 * 返回值：string，相对时间字符串
 */
export function formatRelativeTime(iso: string): string {
  const target = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - target.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHour = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHour / 24);

  // 1 分钟以内：刚刚
  if (diffMin < 1) return '刚刚';
  // 1 小时内：X 分钟前
  if (diffMin < 60) return `${diffMin} 分钟前`;
  // 24 小时内：X 小时前
  if (diffHour < 24) return `${diffHour} 小时前`;
  // 昨天：昨天 HH:mm
  if (diffDay === 1) {
    return `昨天 ${target.getHours().toString().padStart(2, '0')}:${target.getMinutes().toString().padStart(2, '0')}`;
  }
  // 7 天内：X 天前
  if (diffDay < 7) return `${diffDay} 天前`;
  // 超过 7 天：MM-DD
  return `${(target.getMonth() + 1).toString().padStart(2, '0')}-${target.getDate().toString().padStart(2, '0')}`;
}
